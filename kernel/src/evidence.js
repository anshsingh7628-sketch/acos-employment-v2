// Evidence: how much does what we know about a person count, and how sure are we?
//
// The numbers are defaults from 02_Architecture/05_Career_Intelligence.md §4.
// They are meant to be recalibrated against outcomes, which is why they sit in
// one exported object rather than scattered through the matcher.
//
// Two rules matter more than any number here:
//   * No evidence is `null` — unknown — never 0. A person who has not shown
//     something has not failed at it.
//   * Self-assertion is capped as a group. Ten resume lines are one claim.

export const CLASS_WEIGHT = Object.freeze({
  claim: 0.15,
  credential: 0.3,
  practice_assessment: 0.25,
  assessment: 0.45,
  work_artifact: 0.6,
  observed_outcome: 0.8,
  verified_outcome: 1.0,
});

export const STATE_MULTIPLIER = Object.freeze({
  provisional: 0.5,
  probable: 0.8,
  verified: 1.0,
  disputed: null, // excluded
  revoked: null, // excluded
});

export const CONTEXT_FACTOR = Object.freeze({ same: 1.0, adjacent: 0.8, different: 0.6 });

export const RECENCY_HALF_LIFE_MONTHS = 24;
export const STALE_AFTER_MONTHS = 36;
export const CLAIM_GROUP_CAP = 0.25;

export const LABELS = Object.freeze([
  { min: 0.6, id: "strong", text: "Strong evidence" },
  { min: 0.3, id: "some", text: "Some evidence" },
  { min: 0, id: "thin", text: "Thin evidence" },
]);

const MONTH_MS = 30.44 * 86_400_000;

export function ageMonths(observedAt, now) {
  const t = Date.parse(observedAt);
  if (!Number.isFinite(t)) throw new Error(`bad observedAt ${observedAt}`);
  return Math.max(0, (now - t) / MONTH_MS);
}

/**
 * Derived verification state of one artifact.
 *
 * Nobody sets `verified` by hand. It falls out of what is linked to the
 * artifact, and a person's attestation of their own work is ignored — you
 * cannot vouch for yourself into a higher tier.
 */
export function verificationState(artifact) {
  if (artifact.revoked) return "revoked";
  if (artifact.disputeOpen) return "disputed";
  if (artifact.systemOfRecord) return "verified";
  const attested = (artifact.attestations || []).some((a) => a.authorized && a.actorId !== artifact.subjectId);
  const objective = Boolean(artifact.objectiveSource?.resolves);
  if (attested && objective) return "verified";
  if (attested || objective) return "probable";
  return "provisional";
}

/** Weight of one evidence item for one requirement, or null if excluded. */
export function itemWeight(item, now) {
  const base = CLASS_WEIGHT[item.class];
  if (base === undefined) throw new Error(`unknown evidence class ${item.class}`);
  const state = item.state ?? verificationState(item);
  const mult = STATE_MULTIPLIER[state];
  if (mult === undefined) throw new Error(`unknown evidence state ${state}`);
  if (mult === null) return null;
  const recency = Math.pow(0.5, ageMonths(item.observedAt, now) / RECENCY_HALF_LIFE_MONTHS);
  const context = CONTEXT_FACTOR[item.context ?? "same"];
  if (context === undefined) throw new Error(`unknown context ${item.context}`);
  return base * mult * recency * context;
}

const noisyOr = (ws) => 1 - ws.reduce((acc, w) => acc * (1 - w), 1);

/**
 * Coverage of one requirement by a list of evidence items.
 * @returns {{ coverage: number|null, bestClass: string|null, recencyMonths: number|null, staleOnly: boolean, used: number }}
 */
export function coverage(items, now) {
  const live = [];
  for (const item of items || []) {
    const w = itemWeight(item, now);
    if (w !== null) live.push({ item, w });
  }
  if (live.length === 0) return { coverage: null, bestClass: null, recencyMonths: null, staleOnly: false, used: 0 };

  const claims = live.filter((x) => x.item.class === "claim").map((x) => x.w);
  const others = live.filter((x) => x.item.class !== "claim").map((x) => x.w);
  const claimGroup = claims.length ? Math.min(CLAIM_GROUP_CAP, noisyOr(claims)) : null;
  const parts = claimGroup === null ? others : [...others, claimGroup];
  const value = noisyOr(parts);

  const order = Object.keys(CLASS_WEIGHT);
  const best = live.reduce((a, b) => (order.indexOf(b.item.class) > order.indexOf(a.item.class) ? b : a));
  const freshest = Math.min(...live.map((x) => ageMonths(x.item.observedAt, now)));
  return {
    coverage: round(value),
    bestClass: best.item.class,
    recencyMonths: Math.round(freshest),
    staleOnly: freshest > STALE_AFTER_MONTHS,
    used: live.length,
  };
}

export function label(cov) {
  if (cov === null || cov === undefined) return { id: "unknown", text: "No evidence yet" };
  if (cov <= 0) return { id: "unknown", text: "No evidence yet" };
  return LABELS.find((l) => cov >= l.min);
}

/**
 * Fit of a person (or a merged configuration) against a demand's requirements.
 * `evidenceByCapability` maps capability id → evidence items.
 */
export function fitVector(requirements, evidenceByCapability, now) {
  const rows = requirements.map((r) => {
    const c = coverage(evidenceByCapability[r.capability] || [], now);
    // A must-have evidenced only by stale items does not count as strong,
    // whatever the arithmetic says (returnship rule).
    const effective = c.staleOnly && r.must && c.coverage !== null ? Math.min(c.coverage, 0.29) : c.coverage;
    return {
      requirement: r.capability,
      must: Boolean(r.must),
      coverage: effective,
      label: label(effective).id,
      bestClass: c.bestClass,
      recencyMonths: c.recencyMonths,
      staleOnly: c.staleOnly,
    };
  });
  return summarise(rows);
}

export function summarise(rows) {
  const musts = rows.filter((r) => r.must);
  const known = rows.filter((r) => r.coverage !== null);
  return {
    rows,
    mustStrong: musts.filter((r) => r.label === "strong").length,
    mustUnknown: musts.filter((r) => r.coverage === null).length,
    meanKnown: known.length ? round(known.reduce((s, r) => s + r.coverage, 0) / known.length) : null,
    unknowns: rows.filter((r) => r.coverage === null).map((r) => r.requirement),
  };
}

/**
 * Deterministic ordering for anything that must be listed in order.
 * No hidden weights: more strong must-haves, fewer unknown must-haves,
 * higher mean known coverage, then earlier availability.
 */
export function compareFit(a, b) {
  if (b.fit.mustStrong !== a.fit.mustStrong) return b.fit.mustStrong - a.fit.mustStrong;
  if (a.fit.mustUnknown !== b.fit.mustUnknown) return a.fit.mustUnknown - b.fit.mustUnknown;
  const am = a.fit.meanKnown ?? -1;
  const bm = b.fit.meanKnown ?? -1;
  if (bm !== am) return bm - am;
  return Date.parse(a.availableFrom ?? 0) - Date.parse(b.availableFrom ?? 0);
}

function round(x) {
  return Math.round(x * 1000) / 1000;
}
