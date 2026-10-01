import { test } from "node:test";
import assert from "node:assert/strict";
import { createEngine } from "../src/engine.js";
import { validateEvent, IdempotencyConflict } from "../src/events.js";
import { NOW, ORG } from "./fixtures.js";

const recruiter = { type: "human", id: "u:meera", verbs: ["createDemand", "approveDemand", "moveCandidates", "decideCandidate", "recordOutcome"] };
const priya = { type: "human", id: "p:priya" };
const agent = { type: "agent", id: "agent:application" };
const grant = {
  id: "g1", actions: ["application.submit.native", "application.submit.external"], level: 4, onBehalfOf: "p:priya",
  validFrom: "2026-10-01T00:00:00Z", validUntil: "2026-10-31T00:00:00Z", limits: { perDay: 5 },
};

function setup() {
  const eng = createEngine({ clock: () => NOW });
  const d = eng.createDemand({ orgId: ORG, title: "Growth intern", requirements: [], actor: recruiter });
  eng.transitionDemand({ demandId: d.id, to: "published", actor: recruiter, idempotencyKey: "pub-1" });
  const e = eng.createEngagement({ demandId: d.id, configurationId: "single:p:priya", participants: [{ actorId: "p:priya", role: "primary" }], actor: agent, state: "prepared" });
  return { eng, d, e };
}

const checks = { intent_match: true, band_match: true, resume_version_pinned: true, posting_unchanged: true };

test("an agent submits a native application under standing authority, with undo", () => {
  const { eng, e } = setup();
  const r = eng.transition({ engagementId: e.id, to: "submitted", actor: agent, grant, idempotencyKey: "sub-1", context: { channel: "native", resumeVersionId: "rv-7", checks, onBehalfOf: "p:priya" } });
  assert.equal(r.status, "applied");
  assert.equal(r.undoMinutes, 30);
  assert.equal(eng.engagements.get(e.id).resumeVersionId, "rv-7");
});

test("same request twice → one state change, one event", () => {
  const { eng, e } = setup();
  const req = { engagementId: e.id, to: "submitted", actor: agent, grant, idempotencyKey: "sub-dup", context: { channel: "native", resumeVersionId: "rv-7", checks, onBehalfOf: "p:priya" } };
  const before = eng.events.length;
  const a = eng.transition(req);
  const b = eng.transition(req);
  assert.equal(a.replayed, false);
  assert.equal(b.replayed, true);
  assert.equal(eng.events.length, before + 1);
});

test("same key, different request → refused", () => {
  const { eng, e } = setup();
  eng.transition({ engagementId: e.id, to: "submitted", actor: agent, grant, idempotencyKey: "k", context: { channel: "native", resumeVersionId: "rv-7", checks, onBehalfOf: "p:priya" } });
  assert.throws(
    () => eng.transition({ engagementId: e.id, to: "withdrawn", actor: priya, idempotencyKey: "k" }),
    (err) => err instanceof IdempotencyConflict
  );
});

test("external submission parks for approval instead of executing", () => {
  const { eng, e } = setup();
  const r = eng.transition({ engagementId: e.id, to: "submitted", actor: agent, grant, idempotencyKey: "ext-1", context: { channel: "external", resumeVersionId: "rv-7", onBehalfOf: "p:priya" } });
  assert.equal(r.status, "require_approval");
  assert.equal(eng.engagements.get(e.id).state, "prepared");
  assert.ok(eng.approvals.get(r.approvalId));
  assert.ok(eng.outbox.some((m) => m.kind === "approval_request" && m.approvalId === r.approvalId));
});

test("closing a demand closes its open engagements in the same commit, and tells the seeker", () => {
  const { eng, d, e } = setup();
  eng.transition({ engagementId: e.id, to: "submitted", actor: agent, grant, idempotencyKey: "s", context: { channel: "native", resumeVersionId: "rv", checks, onBehalfOf: "p:priya" } });
  const r = eng.transitionDemand({ demandId: d.id, to: "closed", actor: recruiter, idempotencyKey: "close-1" });
  assert.equal(r.cascaded, 1);
  const after = eng.engagements.get(e.id);
  assert.equal(after.state, "closed");
  assert.equal(after.closeReason, "demand_closed");
  assert.ok(eng.outbox.some((m) => m.template === "role_closed_by_employer"));
});

test("offer acceptance is human-only on both sides", () => {
  const { eng, e } = setup();
  const step = (to, actor, key, context = {}) => eng.transition({ engagementId: e.id, to, actor, idempotencyKey: key, context });
  eng.transition({ engagementId: e.id, to: "submitted", actor: agent, grant, idempotencyKey: "1", context: { channel: "native", resumeVersionId: "rv", checks, onBehalfOf: "p:priya" } });
  step("shortlisted", recruiter, "2");
  step("decision_pending", recruiter, "3");
  assert.equal(step("offered", recruiter, "4").status, "applied");
  // An agent cannot accept for Priya even with a broad grant.
  const g = { ...grant, actions: ["offer.accept"], level: 5 };
  assert.throws(() => eng.transition({ engagementId: e.id, to: "accepted", actor: agent, grant: g, idempotencyKey: "5a" }), /acceptance_pending|waiting/);
  eng.acceptOffer({ engagementId: e.id, actor: priya });
  const viaAgent = eng.transition({ engagementId: e.id, to: "accepted", actor: agent, grant: g, idempotencyKey: "5b" });
  assert.equal(viaAgent.status, "prepare_only");
  assert.equal(step("accepted", priya, "5c").status, "applied");
});

test("the full loop: every event is valid, and replay rebuilds state exactly", () => {
  const { eng, e } = setup();
  const step = (to, actor, key, context = {}) => {
    const r = eng.transition({ engagementId: e.id, to, actor, idempotencyKey: key, context });
    assert.equal(r.status, "applied", `${to}: ${r.reason}`);
  };
  eng.transition({ engagementId: e.id, to: "submitted", actor: agent, grant, idempotencyKey: "a", context: { channel: "native", resumeVersionId: "rv", checks, onBehalfOf: "p:priya" } });
  step("shortlisted", recruiter, "b");
  step("assessing", recruiter, "c");
  step("decision_pending", recruiter, "d");
  step("offered", recruiter, "e");
  eng.acceptOffer({ engagementId: e.id, actor: priya });
  step("accepted", priya, "f");
  step("pre_start", recruiter, "g");
  step("active", recruiter, "h", { checks: { prestart_checklist_complete: true } });
  step("completed", recruiter, "i");
  step("outcome_pending", recruiter, "j");
  assert.throws(() => step("closed", recruiter, "k0"), /outcome/);
  eng.recordOutcome({ engagementId: e.id, outcome: { confirmedBy: recruiter.id, result: "met", attributionConfidence: "medium" } });
  step("closed", recruiter, "k");

  for (const ev of eng.events) assert.deepEqual(validateEvent(ev), [], ev.event_type);
  const replayed = eng.replayEngagements();
  for (const [id, row] of eng.engagements) {
    assert.equal(replayed.get(id).state, row.state);
    assert.equal(replayed.get(id).version, row.version);
  }
  // Every consequential transition carries its policy decision.
  const transitions = eng.events.filter((x) => x.event_type === "EngagementTransitioned");
  assert.ok(transitions.every((x) => x.policy_decision_id));
});

test("the system kill switch stops agents but not people", () => {
  const eng = createEngine({ clock: () => NOW, switches: { system: false } });
  const d = eng.createDemand({ orgId: ORG, title: "x", requirements: [], actor: recruiter });
  const e = eng.createEngagement({ demandId: d.id, configurationId: "c", participants: [{ actorId: "p:priya", role: "primary" }], actor: agent, state: "prepared" });
  const r = eng.transition({ engagementId: e.id, to: "submitted", actor: agent, grant, idempotencyKey: "x", context: { channel: "native", resumeVersionId: "rv", checks, onBehalfOf: "p:priya" } });
  assert.equal(r.status, "deny");
  assert.equal(r.reason, "agents_disabled");
  const human = eng.transition({ engagementId: e.id, to: "withdrawn", actor: priya, idempotencyKey: "y" });
  assert.equal(human.status, "applied");
});
