// The V2 lifecycles, as data.
//
// Three state machines interlock (see 02_Architecture/03_Product_Architecture.md §1):
// demand, engagement, and capacity reservation. Evidence verification is not a
// state machine anyone drives — it is derived from links (evidence.js).
//
// Every allowed transition names the policy action that governs it. That is
// the whole bridge between "is this move legal for the lifecycle?" and "is
// this actor allowed to make it?" — stateMachine.js answers the first,
// policy.js the second, and neither knows the other's rules.

export const DEMAND_STATES = Object.freeze([
  "draft",
  "published",
  "allocating",
  "paused",
  "partially_filled",
  "filled",
  "closed",
]);

export const DEMAND_TRANSITIONS = Object.freeze({
  draft: { published: "demand.publish", closed: "demand.close" },
  published: { allocating: "demand.allocate", paused: "demand.pause", closed: "demand.close" },
  allocating: {
    partially_filled: "demand.record_fill",
    filled: "demand.record_fill",
    paused: "demand.pause",
    closed: "demand.close",
  },
  paused: { published: "demand.publish", closed: "demand.close" },
  partially_filled: { filled: "demand.record_fill", allocating: "demand.allocate", closed: "demand.close" },
  filled: { closed: "demand.close" },
  closed: {},
});

export const ENGAGEMENT_STATES = Object.freeze([
  "discovered",
  "prepared",
  "submitted",
  "screening",
  "shortlisted",
  "assessing",
  "decision_pending",
  "offered",
  "accepted",
  "pre_start",
  "active",
  "paused",
  "completed",
  "terminated",
  "outcome_pending",
  // terminal
  "rejected",
  "withdrawn",
  "declined",
  "expired",
  "closed",
]);

export const ENGAGEMENT_TERMINAL = Object.freeze(["rejected", "withdrawn", "declined", "expired", "closed"]);

// from -> { to: action }
export const ENGAGEMENT_TRANSITIONS = Object.freeze({
  discovered: { prepared: "application.prepare", withdrawn: "engagement.withdraw", expired: "engagement.expire" },
  prepared: {
    submitted: "application.submit", // resolved to .native / .external from context.channel
    withdrawn: "engagement.withdraw",
    expired: "engagement.expire",
  },
  submitted: {
    screening: "engagement.advance",
    shortlisted: "engagement.advance",
    rejected: "candidate.reject",
    withdrawn: "engagement.withdraw",
  },
  screening: { shortlisted: "engagement.advance", rejected: "candidate.reject", withdrawn: "engagement.withdraw" },
  shortlisted: {
    assessing: "engagement.advance",
    decision_pending: "engagement.advance",
    rejected: "candidate.reject",
    withdrawn: "engagement.withdraw",
  },
  assessing: { decision_pending: "engagement.advance", rejected: "candidate.reject", withdrawn: "engagement.withdraw" },
  decision_pending: {
    offered: "offer.send",
    assessing: "engagement.advance",
    rejected: "candidate.reject",
    withdrawn: "engagement.withdraw",
  },
  offered: {
    accepted: "offer.accept",
    declined: "offer.decline",
    rejected: "candidate.reject", // offer rescinded
    expired: "engagement.expire",
  },
  accepted: { pre_start: "engagement.prestart", withdrawn: "engagement.withdraw" },
  pre_start: { active: "engagement.activate", withdrawn: "engagement.withdraw", terminated: "engagement.terminate" },
  active: { paused: "engagement.pause", completed: "engagement.complete", terminated: "engagement.terminate" },
  paused: { active: "engagement.resume", terminated: "engagement.terminate" },
  completed: { outcome_pending: "engagement.await_outcome" },
  terminated: { outcome_pending: "engagement.await_outcome" },
  outcome_pending: { closed: "engagement.close" },
  rejected: {},
  withdrawn: {},
  declined: {},
  expired: {},
  closed: {},
});

// Closing a demand closes every engagement that has not yet been accepted.
// Accepted-and-later engagements keep going: the work was agreed, and a
// requisition closing does not un-hire anyone. This is the rule that makes
// V1's 22 orphaned tracker rows impossible (audit F1).
export const DEMAND_CLOSE_CASCADE_FROM = Object.freeze([
  "discovered",
  "prepared",
  "submitted",
  "screening",
  "shortlisted",
  "assessing",
  "decision_pending",
  "offered",
]);

export const RESERVATION_STATES = Object.freeze(["soft", "hard", "released", "expired", "preempted"]);

export const EVIDENCE_STATES = Object.freeze(["provisional", "probable", "verified", "disputed", "revoked"]);

// V1 vocabularies, and where each lands. Used by the backfill and by the
// compatibility views; tests assert every V1 value has a home.
export const V1_JOBS_STATUS_MAP = Object.freeze({
  saved: "discovered",
  applied: "submitted",
  interviewing: "assessing",
  offer: "offered",
  rejected: "rejected",
  withdrawn: "withdrawn",
});

export const V1_APPLICATION_STATUS_MAP = Object.freeze({
  submitted: "submitted",
  screening: "screening",
  shortlisted: "shortlisted",
  interviewing: "assessing",
  offer: "offered",
  rejected: "rejected",
  hired: "accepted",
});

// The reverse projections, for the compatibility views that keep V1 screens
// working. Post-hire V2 states have no V1 word; the V1 board shows them as the
// nearest thing V1 understands.
export const V2_TO_V1_JOBS_STATUS = Object.freeze({
  discovered: "saved",
  prepared: "saved",
  submitted: "applied",
  screening: "applied",
  shortlisted: "interviewing",
  assessing: "interviewing",
  decision_pending: "interviewing",
  offered: "offer",
  accepted: "offer",
  pre_start: "offer",
  active: "offer",
  paused: "offer",
  completed: "offer",
  terminated: "offer",
  outcome_pending: "offer",
  rejected: "rejected",
  withdrawn: "withdrawn",
  declined: "withdrawn",
  expired: "rejected",
  // closed: depends on why — see v1JobsStatusFor
});

/**
 * The V1 job-tracker word for a V2 engagement.
 *
 * `closed` is the one state that needs its reason: an engagement closed after
 * its outcome was recorded was a hire; one closed because the employer closed
 * the demand never got that far. V1 has no word for "the role went away", so
 * the compatibility view says `rejected` and the V2 board says what happened.
 */
export function v1JobsStatusFor(state, closeReason = null) {
  if (state === "closed") return closeReason === "demand_closed" ? "rejected" : "offer";
  const mapped = V2_TO_V1_JOBS_STATUS[state];
  if (!mapped) throw new Error(`no V1 status for engagement state ${state}`);
  return mapped;
}
