import { test } from "node:test";
import assert from "node:assert/strict";
import { engagementAction, demandAction, allEngagementEdges, TransitionError } from "../src/stateMachine.js";
import {
  ENGAGEMENT_STATES,
  ENGAGEMENT_TRANSITIONS,
  ENGAGEMENT_TERMINAL,
  V1_JOBS_STATUS_MAP,
  V1_APPLICATION_STATUS_MAP,
  v1JobsStatusFor,
} from "../src/states.js";
import { ACTIONS } from "../src/policy.js";

const e = (state, extra = {}) => ({ state, participants: [{ actorId: "p1", role: "primary" }], ...extra });

test("every state appears in the transition table, and terminals lead nowhere", () => {
  for (const s of ENGAGEMENT_STATES) assert.ok(s in ENGAGEMENT_TRANSITIONS, s);
  for (const s of ENGAGEMENT_TERMINAL) assert.deepEqual(ENGAGEMENT_TRANSITIONS[s], {});
});

test("every non-terminal state can reach a terminal one", () => {
  const reach = (s, seen = new Set()) => {
    if (ENGAGEMENT_TERMINAL.includes(s)) return true;
    if (seen.has(s)) return false;
    seen.add(s);
    return Object.keys(ENGAGEMENT_TRANSITIONS[s]).some((t) => reach(t, seen));
  };
  for (const s of ENGAGEMENT_STATES) assert.ok(reach(s), s);
});

test("every edge names a real policy action", () => {
  for (const { from, to, action } of allEngagementEdges()) {
    const resolved = action === "application.submit" ? ["application.submit.native", "application.submit.external"] : [action];
    for (const a of resolved) assert.ok(ACTIONS[a], `${from}→${to}: ${a}`);
  }
});

test("illegal moves are refused with a code", () => {
  assert.throws(() => engagementAction(e("discovered"), "active"), (err) => err instanceof TransitionError && err.code === "invalid_transition");
  assert.throws(() => engagementAction(e("rejected"), "shortlisted"), (err) => err.code === "terminal_state");
  assert.throws(() => demandAction("closed", "published"), (err) => err.code === "invalid_transition");
});

test("a submission must pin the resume version", () => {
  assert.throws(() => engagementAction(e("prepared"), "submitted", { channel: "native" }), (err) => err.code === "resume_version_required");
  assert.equal(engagementAction(e("prepared"), "submitted", { channel: "native", resumeVersionId: "rv1" }), "application.submit.native");
  assert.equal(engagementAction(e("prepared"), "submitted", { channel: "external", resumeVersionId: "rv1" }), "application.submit.external");
});

test("accepting needs every non-mentor participant to have accepted", () => {
  const two = { state: "offered", participants: [{ actorId: "a", role: "primary", acceptedAt: "x" }, { actorId: "b", role: "contributor" }, { actorId: "m", role: "mentor" }] };
  assert.throws(() => engagementAction(two, "accepted"), (err) => err.code === "acceptance_pending" && /b/.test(err.message));
  two.participants[1].acceptedAt = "y";
  assert.equal(engagementAction(two, "accepted"), "offer.accept");
});

test("the loop can't be closed without an outcome or a named waiver", () => {
  assert.throws(() => engagementAction(e("outcome_pending"), "closed"), (err) => err.code === "outcome_required");
  assert.throws(() => engagementAction(e("outcome_pending"), "closed", { waiverReason: "forgot" }), (err) => err.code === "outcome_required");
  assert.equal(engagementAction(e("outcome_pending"), "closed", { waiverReason: "legal_hold" }), "engagement.close");
  assert.equal(engagementAction(e("outcome_pending", { outcomeId: "o1" }), "closed"), "engagement.close");
});

test("closing a demand closes pre-accept engagements only", () => {
  assert.equal(engagementAction(e("shortlisted"), "closed", { reason: "demand_closed" }), "engagement.close_by_demand");
  assert.throws(() => engagementAction(e("active"), "closed", { reason: "demand_closed" }), (err) => err.code === "invalid_transition");
});

test("activation needs the pre-start checklist", () => {
  assert.throws(() => engagementAction(e("pre_start"), "active"), (err) => err.code === "prestart_incomplete");
  assert.equal(engagementAction(e("pre_start"), "active", { checks: { prestart_checklist_complete: true } }), "engagement.activate");
});

test("every V1 status has a V2 home, and every V2 state has a V1 word", () => {
  for (const v of Object.values(V1_JOBS_STATUS_MAP)) assert.ok(ENGAGEMENT_STATES.includes(v), v);
  for (const v of Object.values(V1_APPLICATION_STATUS_MAP)) assert.ok(ENGAGEMENT_STATES.includes(v), v);
  const v1Words = ["saved", "applied", "interviewing", "offer", "rejected", "withdrawn"];
  for (const s of ENGAGEMENT_STATES) assert.ok(v1Words.includes(v1JobsStatusFor(s, "demand_closed")), s);
  assert.equal(v1JobsStatusFor("closed", "demand_closed"), "rejected");
  assert.equal(v1JobsStatusFor("closed", "outcome_recorded"), "offer");
});
