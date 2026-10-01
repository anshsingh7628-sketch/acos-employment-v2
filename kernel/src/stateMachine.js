// Is this move legal for the lifecycle? (Not: is this actor allowed to make it —
// that is policy.js.)
//
// Guards live here because they are facts about the record, not about who is
// asking. A human with every verb in the company still cannot close an
// engagement that has no outcome and no waiver: the loop would be open, and
// the whole V2 thesis is that it closes.

import {
  DEMAND_TRANSITIONS,
  ENGAGEMENT_TRANSITIONS,
  ENGAGEMENT_TERMINAL,
  DEMAND_CLOSE_CASCADE_FROM,
} from "./states.js";
import { submitActionFor } from "./policy.js";

export const WAIVER_REASONS = Object.freeze([
  "counterpart_unreachable",
  "engagement_too_short_to_measure",
  "subject_declined_measurement",
  "legal_hold",
]);

export class TransitionError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

export function demandAction(from, to) {
  const action = DEMAND_TRANSITIONS[from]?.[to];
  if (!action) throw new TransitionError("invalid_transition", `demand ${from} → ${to} is not allowed`);
  return action;
}

/**
 * Resolve and guard one engagement transition.
 * @returns {string} the policy action that governs it
 * @throws TransitionError
 */
export function engagementAction(engagement, to, context = {}) {
  const from = engagement.state;
  if (ENGAGEMENT_TERMINAL.includes(from)) {
    throw new TransitionError("terminal_state", `engagement is ${from}; nothing follows a terminal state`);
  }

  // Demand closure is the one path into `closed` that skips the outcome.
  if (to === "closed" && context.reason === "demand_closed") {
    if (!DEMAND_CLOSE_CASCADE_FROM.includes(from)) {
      throw new TransitionError(
        "invalid_transition",
        `closing a demand does not close an engagement that is already ${from}`
      );
    }
    return "engagement.close_by_demand";
  }

  let action = ENGAGEMENT_TRANSITIONS[from]?.[to];
  if (!action) throw new TransitionError("invalid_transition", `engagement ${from} → ${to} is not allowed`);
  if (action === "application.submit") action = submitActionFor(context.channel);

  guard(engagement, to, context);
  return action;
}

function guard(engagement, to, context) {
  if (to === "submitted" && !context.resumeVersionId) {
    // V1 stored pasted resume text on applications. V2 pins the exact version
    // that went, or the outcome can never be traced back to it.
    throw new TransitionError("resume_version_required", "a submission must pin the resume version sent");
  }
  if (to === "accepted") {
    const primaries = (engagement.participants || []).filter((p) => p.role !== "mentor");
    if (primaries.length === 0) throw new TransitionError("no_participants", "engagement has no participants");
    const pending = primaries.filter((p) => !p.acceptedAt).map((p) => p.actorId);
    if (pending.length) {
      throw new TransitionError("acceptance_pending", `waiting for acceptance from ${pending.join(", ")}`);
    }
  }
  if (to === "active" && context.checks?.prestart_checklist_complete !== true) {
    throw new TransitionError("prestart_incomplete", "pre-start checklist is not complete");
  }
  if (to === "closed" && engagement.state === "outcome_pending") {
    const hasOutcome = Boolean(engagement.outcomeId);
    const waived = context.waiverReason && WAIVER_REASONS.includes(context.waiverReason);
    if (!hasOutcome && !waived) {
      throw new TransitionError(
        "outcome_required",
        "record an outcome, or waive it with one of: " + WAIVER_REASONS.join(", ")
      );
    }
  }
}

/** Every (from, to) pair, for docs and for the SQL transition table. */
export function allEngagementEdges() {
  const out = [];
  for (const [from, tos] of Object.entries(ENGAGEMENT_TRANSITIONS)) {
    for (const [to, action] of Object.entries(tos)) out.push({ from, to, action });
  }
  for (const from of DEMAND_CLOSE_CASCADE_FROM) out.push({ from, to: "closed", action: "engagement.close_by_demand" });
  return out;
}
