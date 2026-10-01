import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, validateGrant, ACTIONS, LEVELS } from "../src/policy.js";

const NOW = Date.parse("2026-10-15T10:00:00Z");
const agent = { type: "agent", id: "agent:application" };
const seeker = { type: "human", id: "person:priya" };

function grant(over = {}) {
  return {
    id: "grant:1",
    actions: ["application.submit.native", "application.submit.external", "candidate.reject", "application.prepare"],
    level: 4,
    onBehalfOf: "person:priya",
    validFrom: "2026-10-01T00:00:00Z",
    validUntil: "2026-10-31T00:00:00Z",
    limits: { perDay: 5, budgetInrPerMonth: 200 },
    ...over,
  };
}

const allChecks = { intent_match: true, band_match: true, resume_version_pinned: true, posting_unchanged: true };

test("every action declares kind, max and a human path", () => {
  for (const [name, a] of Object.entries(ACTIONS)) {
    assert.ok(["observe", "recommend", "prepare", "execute"].includes(a.kind), name);
    assert.ok(a.max >= 0 && a.max <= 6, name);
    assert.ok(a.def <= a.max, `${name}: default above max`);
    assert.ok(a.humanVerb, `${name}: no human verb`);
  }
});

test("L6 actions are never executed by an agent, whatever the grant says", () => {
  for (const [name, a] of Object.entries(ACTIONS)) {
    if (a.max !== LEVELS.HUMAN) continue;
    const d = evaluate({ action: name, actor: agent, grant: grant({ actions: [name], level: 5 }), now: NOW, context: { approvalId: "a1" } });
    assert.notEqual(d.result, "allow", name);
  }
});

test("rejecting a candidate: agent may prepare, never send", () => {
  const d = evaluate({ action: "candidate.reject", actor: agent, grant: grant(), now: NOW });
  assert.equal(d.result, "prepare_only");
  assert.equal(d.reason, "human_decision_required");
});

test("native submit at L4 with every check true is allowed, with a 30 minute undo", () => {
  const d = evaluate({ action: "application.submit.native", actor: agent, grant: grant(), now: NOW, context: { checks: allChecks, usedToday: 0 } });
  assert.equal(d.result, "allow");
  assert.equal(d.undoMinutes, 30);
});

test("a missing check drops to approval rather than failing open", () => {
  const { posting_unchanged, ...rest } = allChecks;
  void posting_unchanged;
  const d = evaluate({ action: "application.submit.native", actor: agent, grant: grant(), now: NOW, context: { checks: rest } });
  assert.equal(d.result, "require_approval");
  assert.deepEqual(d.missing, ["posting_unchanged"]);
});

test("external submission is capped at L3 even under an L4 grant", () => {
  const d = evaluate({ action: "application.submit.external", actor: agent, grant: grant(), now: NOW, context: { checks: allChecks } });
  assert.equal(d.result, "require_approval");
  assert.equal(d.level, 3);
});

test("an approval for the instance lets an L3 action execute", () => {
  const d = evaluate({ action: "application.submit.external", actor: agent, grant: grant(), now: NOW, context: { approvalId: "appr:9" } });
  assert.equal(d.result, "allow");
  assert.equal(d.approvalId, "appr:9");
});

test("daily cap and budget both stop standing authority", () => {
  const cap = evaluate({ action: "application.submit.native", actor: agent, grant: grant(), now: NOW, context: { checks: allChecks, usedToday: 5 } });
  assert.equal(cap.reason, "daily_cap_reached");
  const money = evaluate({
    action: "application.submit.native", actor: agent, grant: grant(), now: NOW,
    context: { checks: allChecks, usedToday: 0, spentThisMonthInr: 199, estimatedCostInr: 4 },
  });
  assert.equal(money.reason, "budget_exhausted");
});

test("tenant ceiling lowers what a grant can do", () => {
  const d = evaluate({ action: "application.submit.native", actor: agent, grant: grant(), tenantCeiling: 2, now: NOW, context: { checks: allChecks } });
  assert.equal(d.result, "prepare_only");
});

test("kill switches deny every agent action", () => {
  for (const switches of [{ system: false }, { tenant: false }, { agent: false }]) {
    const d = evaluate({ action: "application.prepare", actor: agent, grant: grant(), switches, now: NOW });
    assert.equal(d.result, "deny");
    assert.equal(d.reason, "agents_disabled");
  }
});

test("expired, revoked, ungranted and out-of-scope grants are denied", () => {
  assert.equal(evaluate({ action: "application.prepare", actor: agent, grant: grant(), now: Date.parse("2026-11-02T00:00:00Z") }).reason, "grant_expired");
  assert.equal(evaluate({ action: "application.prepare", actor: agent, grant: grant({ revokedAt: "2026-10-10T00:00:00Z" }), now: NOW }).reason, "grant_revoked");
  assert.equal(evaluate({ action: "message.draft", actor: agent, grant: grant(), now: NOW }).reason, "action_not_granted");
  assert.equal(
    evaluate({ action: "application.prepare", actor: agent, grant: grant({ scope: { objectTypes: ["opportunity"] } }), now: NOW, context: { objectType: "demand" } }).reason,
    "object_out_of_scope"
  );
  assert.equal(evaluate({ action: "application.prepare", actor: agent, grant: null, now: NOW }).reason, "no_authority");
  assert.equal(
    evaluate({ action: "application.prepare", actor: agent, grant: grant(), now: NOW, context: { onBehalfOf: "person:someone_else" } }).reason,
    "wrong_principal"
  );
});

test("humans need the verb; subject-only actions need the subject", () => {
  const recruiter = { type: "human", id: "u:arjun", verbs: ["moveCandidates"] };
  assert.equal(evaluate({ action: "candidate.reject", actor: recruiter, now: NOW }).result, "deny");
  assert.equal(evaluate({ action: "engagement.advance", actor: recruiter, now: NOW }).result, "allow");
  assert.equal(evaluate({ action: "offer.accept", actor: seeker, now: NOW, context: { subjectIds: ["person:priya"] } }).result, "allow");
  assert.equal(evaluate({ action: "offer.accept", actor: recruiter, now: NOW, context: { subjectIds: ["person:priya"] } }).result, "deny");
});

test("the platform may only do what is marked as a system action", () => {
  const sys = { type: "system", id: "system" };
  assert.equal(evaluate({ action: "engagement.close_by_demand", actor: sys, now: NOW }).result, "allow");
  assert.equal(evaluate({ action: "offer.send", actor: sys, now: NOW }).result, "deny");
});

test("grants above an action's ceiling, or beyond the grantor's verbs, are invalid", () => {
  const priya = { id: "person:priya", verbs: [] };
  assert.deepEqual(validateGrant(grant({ actions: ["application.submit.native"], level: 4 }), priya), []);
  assert.match(validateGrant(grant({ actions: ["application.submit.external"], level: 4 }), priya).join(), /capped at L3/);
  assert.match(validateGrant(grant({ level: 6 }), priya).join(), /level must be/);
  const hiringManager = { id: "u:sanjay", verbs: ["moveCandidates"] };
  assert.match(validateGrant(grant({ actions: ["candidate.reject"], level: 2, onBehalfOf: "org:acme" }), hiringManager).join(), /lacks decideCandidate/);
  assert.match(validateGrant(grant({ validUntil: "2027-06-01T00:00:00Z" }), priya).join(), /longer than 90 days/);
});
