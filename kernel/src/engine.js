// A small in-memory engine that wires the pure pieces together the way the
// real service will: idempotency → state guard → policy → state + event +
// outbox, committed together or not at all.
//
// In production each `commit` is one Postgres transaction (see
// 03_Technical/sql/002_v2_state_and_events.sql). Here it is one synchronous
// function, which gives the same all-or-nothing property for the tests and
// the demo.

import { randomUUID } from "node:crypto";
import { evaluate } from "./policy.js";
import { engagementAction, demandAction, TransitionError } from "./stateMachine.js";
import { makeEvent, createIdempotencyStore } from "./events.js";
import { DEMAND_CLOSE_CASCADE_FROM } from "./states.js";

export function createEngine({ clock = () => Date.now(), switches = {} } = {}) {
  const demands = new Map();
  const engagements = new Map();
  const events = [];
  const outbox = [];
  const approvals = new Map();
  const policyDecisions = [];
  const idem = createIdempotencyStore();

  // Every object is built (and every event validated) before this is called,
  // so nothing here can throw halfway: it all lands or none of it was attempted.
  function commit({ entity, table, event, extraEntities = [], extraEvents = [], outboxMessages = [] }) {
    const toWrite = [event, ...extraEvents];
    table.set(entity.id, entity);
    for (const x of extraEntities) x.table.set(x.entity.id, x.entity);
    for (const e of toWrite) events.push(e);
    for (const m of outboxMessages) outbox.push({ id: randomUUID(), delivered: false, ...m });
  }

  function recordDecision(d, action, actor) {
    const row = { id: randomUUID(), action, actorId: actor.id, ...d, at: new Date(clock()).toISOString() };
    policyDecisions.push(row);
    return row;
  }

  function createDemand({ id = randomUUID(), orgId, title, requirements, actor, correlationId = randomUUID() }) {
    const d = { id, orgId, title, requirements, state: "draft", version: 1 };
    const ev = makeEvent({
      type: "DemandCreated", entityType: "demand", entityId: id, entityVersion: 1, actorId: actor.id,
      tenantId: orgId, correlationId, idempotencyKey: `demand:create:${id}`, payload: { title }, now: clock(),
    });
    commit({ entity: d, table: demands, event: ev });
    return d;
  }

  function transitionDemand({ demandId, to, actor, grant, context = {}, idempotencyKey, correlationId = randomUUID() }) {
    return idem.run(idempotencyKey, { demandId, to, actor: actor.id }, () => {
      const d = demands.get(demandId);
      if (!d) throw new TransitionError("not_found");
      const action = demandAction(d.state, to);
      const pd = recordDecision(evaluate({ action, actor, grant, switches, context, now: clock() }), action, actor);
      if (pd.result !== "allow") return { status: pd.result, reason: pd.reason, policyDecisionId: pd.id };

      const next = { ...d, state: to, version: d.version + 1 };
      const ev = makeEvent({
        type: to === "closed" ? "DemandClosed" : to === "published" ? "DemandPublished" : "DemandTransitioned",
        entityType: "demand", entityId: d.id, entityVersion: next.version, actorId: actor.id, authorityId: grant?.id ?? null,
        tenantId: d.orgId, correlationId, idempotencyKey, payload: { from: d.state, to }, policyDecisionId: pd.id, now: clock(),
      });

      // Closing a demand closes its not-yet-accepted engagements in the same commit.
      const cascade = [];
      const cascadeEntities = [];
      if (to === "closed") {
        for (const e of engagements.values()) {
          if (e.demandId !== d.id || !DEMAND_CLOSE_CASCADE_FROM.includes(e.state)) continue;
          const closed = { ...e, state: "closed", closeReason: "demand_closed", version: e.version + 1 };
          cascadeEntities.push({ table: engagements, entity: closed });
          cascade.push(
            makeEvent({
              type: "EngagementTransitioned", entityType: "engagement", entityId: e.id, entityVersion: closed.version,
              actorId: "system", tenantId: d.orgId, correlationId, causationId: ev.event_id,
              idempotencyKey: `${idempotencyKey}:cascade:${e.id}`, payload: { from: e.state, to: "closed", reason: "demand_closed" },
              now: clock(),
            })
          );
        }
      }
      commit({
        entity: next, table: demands, event: ev, extraEntities: cascadeEntities, extraEvents: cascade,
        outboxMessages: cascade.map((c) => ({ kind: "notify", eventId: c.event_id, template: "role_closed_by_employer" })),
      });
      return { status: "applied", event: ev, cascaded: cascade.length, demand: next };
    });
  }

  function createEngagement({ id = randomUUID(), demandId, configurationId, participants, actor, correlationId = randomUUID(), state = "discovered" }) {
    const d = demands.get(demandId);
    if (!d) throw new TransitionError("not_found", "demand not found");
    const e = { id, demandId, configurationId, participants, state, version: 1, outcomeId: null, closeReason: null, tenantId: d.orgId };
    const ev = makeEvent({
      type: "EngagementCreated", entityType: "engagement", entityId: id, entityVersion: 1, actorId: actor.id,
      tenantId: d.orgId, correlationId, idempotencyKey: `engagement:create:${id}`, payload: { demandId, configurationId, state },
      now: clock(),
    });
    commit({ entity: e, table: engagements, event: ev });
    return e;
  }

  /**
   * The one way an engagement's state changes.
   * Returns { status: applied | require_approval | prepare_only | deny, ... }
   */
  function transition({ engagementId, to, actor, grant = null, context = {}, idempotencyKey, correlationId = randomUUID() }) {
    return idem.run(idempotencyKey, { engagementId, to, actor: actor.id, context }, () => {
      const e = engagements.get(engagementId);
      if (!e) throw new TransitionError("not_found");
      const action = engagementAction(e, to, context); // throws on illegal move / failed guard
      const ctx = { ...context, subjectIds: e.participants.map((p) => p.actorId), onBehalfOf: context.onBehalfOf };
      const pd = recordDecision(evaluate({ action, actor, grant, switches, context: ctx, now: clock() }), action, actor);

      if (pd.result === "require_approval") {
        const approvalId = randomUUID();
        approvals.set(approvalId, { id: approvalId, engagementId, to, action, requestedBy: actor.id, context, status: "pending" });
        outbox.push({ id: randomUUID(), delivered: false, kind: "approval_request", approvalId });
        return { status: "require_approval", approvalId, reason: pd.reason, policyDecisionId: pd.id };
      }
      if (pd.result !== "allow") return { status: pd.result, reason: pd.reason, policyDecisionId: pd.id };

      const next = {
        ...e,
        state: to,
        version: e.version + 1,
        closeReason: to === "closed" ? context.reason || (context.waiverReason ? `waived:${context.waiverReason}` : "outcome_recorded") : e.closeReason,
        resumeVersionId: to === "submitted" ? context.resumeVersionId : e.resumeVersionId,
      };
      const ev = makeEvent({
        type: "EngagementTransitioned", entityType: "engagement", entityId: e.id, entityVersion: next.version,
        actorId: actor.id, authorityId: grant?.id ?? null, tenantId: e.tenantId, correlationId, idempotencyKey,
        payload: { from: e.state, to, action, reason: next.closeReason ?? null }, evidenceRefs: context.evidenceRefs || [],
        policyDecisionId: pd.id, now: clock(),
      });
      commit({ entity: next, table: engagements, event: ev, outboxMessages: [{ kind: "notify", eventId: ev.event_id, template: `engagement_${to}` }] });
      return { status: "applied", event: ev, engagement: next, undoMinutes: pd.undoMinutes ?? null };
    });
  }

  function approve({ approvalId, approver, idempotencyKey }) {
    const a = approvals.get(approvalId);
    if (!a || a.status !== "pending") throw new TransitionError("approval_not_pending");
    a.status = "approved";
    a.approvedBy = approver.id;
    // Re-run as the original agent, now carrying the approval for this instance.
    return { approvalId, ...a };
  }

  function acceptOffer({ engagementId, actor }) {
    const e = engagements.get(engagementId);
    if (!e) throw new TransitionError("not_found");
    if (e.state !== "offered") throw new TransitionError("invalid_transition", "no open offer");
    const participants = e.participants.map((p) =>
      p.actorId === actor.id ? { ...p, acceptedAt: new Date(clock()).toISOString() } : p
    );
    if (!e.participants.some((p) => p.actorId === actor.id)) throw new TransitionError("not_a_participant");
    engagements.set(e.id, { ...e, participants });
    events.push(
      makeEvent({
        type: "OfferAcceptedByParticipant", entityType: "engagement", entityId: e.id, entityVersion: e.version,
        actorId: actor.id, tenantId: e.tenantId, correlationId: randomUUID(), idempotencyKey: `accept:${e.id}:${actor.id}`,
        privacyClass: "subject", payload: {}, now: clock(),
      })
    );
    return engagements.get(e.id);
  }

  function recordOutcome({ engagementId, outcome }) {
    const e = engagements.get(engagementId);
    if (!e) throw new TransitionError("not_found");
    const id = randomUUID();
    engagements.set(e.id, { ...e, outcomeId: id });
    events.push(
      makeEvent({
        type: "OutcomeRecorded", entityType: "outcome", entityId: id, entityVersion: 1, actorId: outcome.confirmedBy,
        tenantId: e.tenantId, correlationId: randomUUID(), idempotencyKey: `outcome:${e.id}`, payload: { engagementId: e.id, ...outcome },
        evidenceRefs: outcome.evidenceRefs || [], now: clock(),
      })
    );
    return id;
  }

  /** Rebuild engagement states from events alone. Must equal the materialised table. */
  function replayEngagements() {
    const state = new Map();
    for (const ev of events) {
      if (ev.entity_type !== "engagement") continue;
      if (ev.event_type === "EngagementCreated") state.set(ev.entity_id, { state: ev.payload.state, version: 1 });
      if (ev.event_type === "EngagementTransitioned") state.set(ev.entity_id, { state: ev.payload.to, version: ev.entity_version });
    }
    return state;
  }

  return {
    createDemand, transitionDemand, createEngagement, transition, approve, acceptOffer, recordOutcome, replayEngagements,
    get demands() { return demands; },
    get engagements() { return engagements; },
    get events() { return events; },
    get outbox() { return outbox; },
    get approvals() { return approvals; },
    get policyDecisions() { return policyDecisions; },
  };
}
