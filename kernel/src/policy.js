// Policy and authority: may this actor do this, here, now?
//
// Pure. No clock, no database: the caller passes `now` and whatever it has
// counted (actions today, spend this month). That is what lets every rule in
// 02_Architecture/04_AI_Agent_Spec.md §2 be pinned by a unit test instead of
// being true until somebody changes a query.
//
// Decisions, in order of how much they let happen:
//   allow            execute now
//   require_approval create an approval request; execute when a human approves
//   prepare_only     save a draft with no external effect
//   deny             nothing
//
// Two properties the tests hold this file to:
//   1. A missing fact never raises a decision. Unknown condition → one step down.
//   2. An L6 action is never executed by an agent, whatever the grant says.

export const LEVELS = Object.freeze({ OBSERVE: 0, RECOMMEND: 1, PREPARE: 2, APPROVE: 3, STANDING: 4, REVERSIBLE: 5, HUMAN: 6 });

const H = LEVELS.HUMAN;

// kind: observe | recommend | prepare | execute
// max: hard ceiling for an agent. `H` means a human must execute.
// humanVerb: capability a human needs (company/institution verbs, or "subject" for the person it's about)
// system: the platform itself may perform it (cascades, expiries)
// conditions: facts that must be true for L4+ execution
// undoMinutes: for L4/L5, the window in which the effect can be reversed
export const ACTIONS = Object.freeze({
  "opportunity.match": { kind: "recommend", max: 1, def: 1, humanVerb: "subject" },
  "application.prepare": { kind: "prepare", max: 2, def: 2, humanVerb: "subject" },
  "application.submit.native": {
    kind: "execute", max: 4, def: 3, humanVerb: "subject",
    conditions: ["intent_match", "band_match", "resume_version_pinned", "posting_unchanged"], undoMinutes: 30,
  },
  "application.submit.external": { kind: "execute", max: 3, def: 3, humanVerb: "subject" },
  "message.draft": { kind: "prepare", max: 2, def: 2, humanVerb: "any" },
  "message.send.routine": { kind: "execute", max: 4, def: 3, humanVerb: "any", conditions: ["existing_thread", "template_bound"] },
  "message.send.outreach": { kind: "execute", max: 3, def: 3, humanVerb: "any" },
  "interview.schedule": { kind: "execute", max: 5, def: 3, humanVerb: "leaveFeedback", conditions: ["calendars_granted", "slot_in_window"], undoMinutes: 1440 },
  "demand.draft": { kind: "prepare", max: 2, def: 2, humanVerb: "createDemand" },
  "demand.publish": { kind: "execute", max: 3, def: 3, humanVerb: "approveDemand" },
  "demand.allocate": { kind: "execute", max: 4, def: 4, humanVerb: "approveDemand", system: true },
  "demand.pause": { kind: "execute", max: 3, def: 3, humanVerb: "approveDemand" },
  "demand.record_fill": { kind: "execute", max: 4, def: 4, humanVerb: "approveDemand", system: true },
  "demand.close": { kind: "execute", max: 3, def: 3, humanVerb: "approveDemand" },
  "configuration.recommend": { kind: "recommend", max: 1, def: 1, humanVerb: "approveConfiguration" },
  "shortlist.propose": { kind: "recommend", max: 1, def: 1, humanVerb: "moveCandidates" },
  "engagement.advance": { kind: "execute", max: 4, def: 3, humanVerb: "moveCandidates", conditions: ["org_rule_satisfied"] },
  "candidate.reject": { kind: "execute", max: H, def: H, humanVerb: "decideCandidate" },
  "offer.send": { kind: "execute", max: H, def: H, humanVerb: "decideCandidate" },
  "offer.accept": { kind: "execute", max: H, def: H, humanVerb: "subject" },
  "offer.decline": { kind: "execute", max: H, def: H, humanVerb: "subject" },
  "engagement.withdraw": { kind: "execute", max: H, def: H, humanVerb: "subject" },
  "engagement.prestart": { kind: "execute", max: 3, def: 3, humanVerb: "moveCandidates" },
  "engagement.activate": { kind: "execute", max: 3, def: 3, humanVerb: "moveCandidates", conditions: ["prestart_checklist_complete"] },
  "engagement.pause": { kind: "execute", max: 3, def: 3, humanVerb: "moveCandidates" },
  "engagement.resume": { kind: "execute", max: 3, def: 3, humanVerb: "moveCandidates" },
  "engagement.complete": { kind: "execute", max: 3, def: 3, humanVerb: "recordOutcome" },
  "engagement.terminate": { kind: "execute", max: H, def: H, humanVerb: "decideCandidate" },
  "engagement.await_outcome": { kind: "execute", max: 5, def: 4, humanVerb: "recordOutcome", system: true },
  "engagement.close": { kind: "execute", max: 3, def: 3, humanVerb: "recordOutcome" },
  "engagement.expire": { kind: "execute", max: 5, def: 4, humanVerb: "moveCandidates", system: true },
  "engagement.close_by_demand": { kind: "execute", max: 5, def: 5, humanVerb: "approveDemand", system: true },
  "capacity.reserve.soft": { kind: "execute", max: 5, def: 4, humanVerb: "moveCandidates", conditions: ["capacity_consented"], undoMinutes: 4320 },
  "capacity.reserve.hard": { kind: "execute", max: 3, def: 3, humanVerb: "decideCandidate" },
  "assignment.create": { kind: "execute", max: 5, def: 4, humanVerb: "moveCandidates", conditions: ["engagement_active"] },
  "assignment.remind": { kind: "execute", max: 5, def: 4, humanVerb: "moveCandidates", conditions: ["engagement_active"] },
  "evidence.record": { kind: "execute", max: 5, def: 4, humanVerb: "subject", conditions: ["source_connected"] },
  "evidence.attest": { kind: "execute", max: H, def: H, humanVerb: "attest" },
  "outcome.draft": { kind: "prepare", max: 2, def: 2, humanVerb: "recordOutcome" },
  "outcome.confirm": { kind: "execute", max: H, def: H, humanVerb: "recordOutcome" },
  "disclosure.change": { kind: "execute", max: H, def: H, humanVerb: "subject" },
  "authority.grant": { kind: "execute", max: H, def: H, humanVerb: "grantAgentAuthority" },
});

const KIND_LEVEL = { observe: 0, recommend: 1, prepare: 2 };

const MAX_GRANT_DAYS = 90;

function decision(result, reason, extra = {}) {
  return Object.freeze({ result, reason, ...extra });
}

/**
 * Is this grant well-formed and within what its grantor may give?
 * Returns a list of problems; empty means valid.
 */
export function validateGrant(grant, grantor) {
  const problems = [];
  if (!grant || typeof grant !== "object") return ["grant missing"];
  if (!Array.isArray(grant.actions) || grant.actions.length === 0) problems.push("grant names no actions");
  if (!Number.isInteger(grant.level) || grant.level < 0 || grant.level > 5) {
    // 6 is not grantable: it means "a human does it".
    problems.push("grant level must be an integer 0..5");
  }
  for (const name of grant.actions || []) {
    const a = ACTIONS[name];
    if (!a) {
      problems.push(`unknown action ${name}`);
      continue;
    }
    if (a.max !== H && grant.level > a.max) problems.push(`${name} is capped at L${a.max}; grant asks for L${grant.level}`);
    if (!grantorHolds(grantor, a, grant)) problems.push(`grantor lacks ${a.humanVerb} needed for ${name}`);
  }
  const from = Date.parse(grant.validFrom);
  const until = Date.parse(grant.validUntil);
  if (!Number.isFinite(from) || !Number.isFinite(until) || until <= from) problems.push("grant validity window is invalid");
  else if (until - from > MAX_GRANT_DAYS * 86_400_000) problems.push(`grant longer than ${MAX_GRANT_DAYS} days`);
  return problems;
}

function grantorHolds(grantor, action, grant) {
  if (!grantor) return false;
  if (action.humanVerb === "any") return true;
  if (action.humanVerb === "subject") return grant.onBehalfOf === grantor.id;
  return Array.isArray(grantor.verbs) && grantor.verbs.includes(action.humanVerb);
}

function humanMayAct(actor, action, context) {
  if (action.humanVerb === "any") return true;
  if (action.humanVerb === "subject") return context.subjectIds?.includes(actor.id) ?? false;
  return Array.isArray(actor.verbs) && actor.verbs.includes(action.humanVerb);
}

function grantCovers(grant, actionName, context, now) {
  if (!grant) return "no_authority";
  if (grant.revokedAt && Date.parse(grant.revokedAt) <= now) return "grant_revoked";
  if (now < Date.parse(grant.validFrom) || now >= Date.parse(grant.validUntil)) return "grant_expired";
  if (!grant.actions.includes(actionName)) return "action_not_granted";
  if (grant.onBehalfOf && context.onBehalfOf && grant.onBehalfOf !== context.onBehalfOf) return "wrong_principal";
  const types = grant.scope?.objectTypes;
  if (types && context.objectType && !types.includes(context.objectType)) return "object_out_of_scope";
  const ids = grant.scope?.objectIds;
  if (ids && context.objectId && !ids.includes(context.objectId)) return "object_out_of_scope";
  return null;
}

/**
 * Decide one action.
 *
 * @param {object} p
 * @param {string} p.action           one of ACTIONS
 * @param {object} p.actor            { type: "human"|"agent"|"system", id, verbs? }
 * @param {object} [p.grant]          authority grant (agents)
 * @param {object} [p.switches]       { system: bool, tenant: bool, agent: bool } — false = disabled
 * @param {number} [p.tenantCeiling]  0..5, default 5
 * @param {object} [p.context]        { subjectIds, onBehalfOf, objectType, objectId, checks, usedToday, spentThisMonthInr, estimatedCostInr, approvalId, channel }
 * @param {number} p.now              epoch ms
 */
export function evaluate({ action: actionName, actor, grant = null, switches = {}, tenantCeiling = 5, context = {}, now }) {
  const action = ACTIONS[actionName];
  if (!action) return decision("deny", "unknown_action");
  if (!actor || !actor.type) return decision("deny", "no_actor");
  if (!Number.isFinite(now)) throw new Error("evaluate() needs `now`");

  if (actor.type === "human") {
    return humanMayAct(actor, action, context)
      ? decision("allow", "human_with_verb", { level: H })
      : decision("deny", "human_lacks_verb");
  }

  if (actor.type === "system") {
    return action.system ? decision("allow", "system_action") : decision("deny", "not_a_system_action");
  }

  if (actor.type !== "agent") return decision("deny", "unknown_actor_type");

  // Agents from here on.
  if (switches.system === false || switches.tenant === false || switches.agent === false) {
    return decision("deny", "agents_disabled");
  }
  const coverage = grantCovers(grant, actionName, context, now);
  if (coverage) return decision("deny", coverage);

  const ceiling = Math.min(5, Math.max(0, tenantCeiling));
  const effective = Math.min(grant.level, ceiling, action.max === H ? 5 : action.max);

  if (action.max === H) {
    return effective >= LEVELS.PREPARE
      ? decision("prepare_only", "human_decision_required", { level: effective })
      : decision("deny", "level_too_low", { level: effective });
  }

  if (action.kind !== "execute") {
    const needed = KIND_LEVEL[action.kind];
    return effective >= needed
      ? decision("allow", `${action.kind}_permitted`, { level: effective })
      : decision("deny", "level_too_low", { level: effective });
  }

  if (effective <= LEVELS.RECOMMEND) return decision("deny", "level_too_low", { level: effective });
  if (effective === LEVELS.PREPARE) return decision("prepare_only", "grant_is_prepare_level", { level: effective });

  // An approval for this exact instance turns an L3 request into an execution.
  const approved = Boolean(context.approvalId);

  if (effective === LEVELS.APPROVE) {
    return approved
      ? decision("allow", "approved_instance", { level: effective, approvalId: context.approvalId })
      : decision("require_approval", "approve_to_execute", { level: effective });
  }

  // L4 / L5: standing authority, subject to conditions and limits.
  const missing = (action.conditions || []).filter((c) => context.checks?.[c] !== true);
  if (missing.length > 0) {
    return approved
      ? decision("allow", "approved_instance", { level: effective, approvalId: context.approvalId })
      : decision("require_approval", "conditions_unmet", { level: effective, missing });
  }
  const perDay = grant.limits?.perDay;
  if (Number.isFinite(perDay) && (context.usedToday ?? 0) >= perDay) {
    return approved
      ? decision("allow", "approved_instance", { level: effective, approvalId: context.approvalId })
      : decision("require_approval", "daily_cap_reached", { level: effective });
  }
  const budget = grant.limits?.budgetInrPerMonth;
  if (Number.isFinite(budget)) {
    const spent = context.spentThisMonthInr ?? 0;
    const est = context.estimatedCostInr ?? 0;
    if (spent + est > budget) return decision("require_approval", "budget_exhausted", { level: effective });
  }
  return decision("allow", "standing_authority", {
    level: effective,
    undoMinutes: effective >= LEVELS.STANDING ? action.undoMinutes ?? null : null,
  });
}

/** The action that governs `submitted`, which depends on where it's going. */
export function submitActionFor(channel) {
  if (channel === "native") return "application.submit.native";
  if (channel === "external") return "application.submit.external";
  throw new Error(`unknown submission channel ${channel}`);
}
