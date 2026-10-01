// The demand-to-capacity compiler, V2 scope.
//
// Not a ranker of people. Given a demand and the consented supply, it builds
// the feasible ways to staff it — five configuration types in V2 — and shows
// each one's evidence, cost, start date, risks and unknowns. Hard constraints
// filter; they are never traded against fit. Dominated options are hidden but
// kept, so "why not X?" always has an answer.
//
// Deterministic by design: same inputs, same output, same inputs hash. That
// is what makes the calibration report (predicted vs actual) possible without
// re-calling anything.

import { fitVector, summarise, label } from "./evidence.js";
import { hashRequest } from "./events.js";

export const COMPILER_VERSION = "compiler@2.0.0";

export const CONFIG_TYPES = Object.freeze(["single", "with_mentor", "split", "contractor", "intern_cohort"]);

const START_SLACK_DAYS = 14;
const MENTOR_SHARE = 0.1; // a mentor gives ~10% of the work's hours
const MENTOR_EVIDENCE_FACTOR = 0.5; // supervision is not doing the work
const MAX_RESULTS = 5;

/**
 * @param {object} demand   { id, orgId, requirements:[{capability, must}], hoursPerWeek, window:{start,end},
 *                            budgetMonthlyInr, allowedConfigs:[...], location:{remoteAllowed, cities:[]},
 *                            cohortId? }
 * @param {object[]} supply capacity records: { actorId, name, role: candidate|mentor|contractor|intern,
 *                            consentAudiences:[orgId|"all"|"institution:<id>"], availableFrom, weeklyHours,
 *                            committedHours, monthlyRateInr, city, remoteOk, cohortId?, evidence:{cap:[items]} }
 */
export function compile(demand, supply, { now, maxResults = MAX_RESULTS } = {}) {
  if (!Number.isFinite(now)) throw new Error("compile() needs `now`");
  const inputsHash = hashRequest({ demand, supply, version: COMPILER_VERSION });
  const excluded = [];

  const eligible = [];
  for (const s of supply) {
    const why = hardFilter(demand, s);
    if (why.length) excluded.push({ actorId: s.actorId, reasons: why });
    else eligible.push(s);
  }

  const byRole = (r) => eligible.filter((s) => s.role === r);
  const people = eligible.filter((s) => s.role === "candidate" || s.role === "intern");
  const candidates = [];

  const allowed = new Set(demand.allowedConfigs?.length ? demand.allowedConfigs : CONFIG_TYPES);

  if (allowed.has("single")) {
    for (const p of people) candidates.push(build("single", [{ cap: p, share: 1, role: "primary" }], demand, now));
  }
  if (allowed.has("contractor")) {
    for (const c of byRole("contractor")) candidates.push(build("contractor", [{ cap: c, share: 1, role: "primary" }], demand, now));
  }
  if (allowed.has("with_mentor")) {
    for (const p of people) {
      for (const m of byRole("mentor")) {
        candidates.push(
          build("with_mentor", [{ cap: p, share: 1, role: "primary" }, { cap: m, share: MENTOR_SHARE, role: "mentor" }], demand, now)
        );
      }
    }
  }
  if (allowed.has("split")) {
    for (let i = 0; i < people.length; i++) {
      for (let j = i + 1; j < people.length; j++) {
        candidates.push(
          build("split", [{ cap: people[i], share: 0.5, role: "primary" }, { cap: people[j], share: 0.5, role: "contributor" }], demand, now)
        );
      }
    }
  }
  if (allowed.has("intern_cohort") && demand.cohortId) {
    const interns = byRole("intern").filter((s) => s.cohortId === demand.cohortId).slice(0, 12);
    const mentors = byRole("mentor");
    for (const trio of combinations(interns, 3)) {
      for (const m of mentors) {
        const members = trio.map((c, k) => ({ cap: c, share: 1 / 3, role: k === 0 ? "primary" : "contributor" }));
        candidates.push(build("intern_cohort", [...members, { cap: m, share: MENTOR_SHARE, role: "mentor" }], demand, now));
      }
    }
  }

  const infeasible = candidates.filter((c) => c.infeasible.length > 0);
  const feasible = candidates.filter((c) => c.infeasible.length === 0);
  const frontier = pareto(feasible);
  frontier.sort(compareConfigs);

  return {
    compilerVersion: COMPILER_VERSION,
    inputsHash,
    demandId: demand.id,
    configurations: frontier.slice(0, maxResults),
    // Non-dominated but past the display limit — shown under "more options".
    moreOptions: frontier.slice(maxResults).map(brief),
    dominated: feasible.filter((c) => !frontier.includes(c)).map(brief),
    infeasible: infeasible.map((c) => ({ ...brief(c), reasons: c.infeasible })),
    excludedSupply: excluded,
    baseline: naiveBaseline(demand, people),
  };
}

// ---------- hard constraints ----------

function hardFilter(demand, s) {
  const reasons = [];
  const audiences = s.consentAudiences || [];
  const cohortAudience = demand.cohortId ? `institution:${demand.cohortInstitutionId}` : null;
  const consented =
    audiences.includes("all") || audiences.includes(demand.orgId) || (cohortAudience && audiences.includes(cohortAudience));
  if (!consented) reasons.push("no_disclosure_consent_for_this_audience");
  const latestStart = Date.parse(demand.window.start) + START_SLACK_DAYS * 86_400_000;
  if (Date.parse(s.availableFrom) > latestStart) reasons.push("not_available_in_window");
  const loc = demand.location || {};
  const locOk = (loc.remoteAllowed && s.remoteOk) || (loc.cities || []).includes(s.city);
  if (!locOk) reasons.push("location_mismatch");
  const free = s.weeklyHours - (s.committedHours || 0);
  if (free <= 0) reasons.push("no_free_hours");
  return reasons;
}

// ---------- building one configuration ----------

function build(type, members, demand, now) {
  const infeasible = [];
  for (const m of members) {
    const needed = demand.hoursPerWeek * m.share;
    const free = m.cap.weeklyHours - (m.cap.committedHours || 0);
    if (free + 1e-9 < needed) infeasible.push(`${m.cap.actorId}_needs_${round(needed)}h_has_${round(free)}h`);
  }
  const cost = members.reduce((s, m) => s + m.cap.monthlyRateInr * Math.min(1, m.share * (demand.hoursPerWeek / Math.max(1, m.cap.weeklyHours))), 0);
  if (Number.isFinite(demand.budgetMonthlyInr) && cost > demand.budgetMonthlyInr) infeasible.push("over_budget");

  const fit = mergedFit(members, demand, now);
  const startDate = new Date(Math.max(...members.map((m) => Date.parse(m.cap.availableFrom)), Date.parse(demand.window.start)))
    .toISOString()
    .slice(0, 10);

  const risks = [];
  if (fit.mustUnknown > 0) risks.push(`${fit.mustUnknown} must-have(s) with no evidence yet — ask in assessment`);
  const thinMust = fit.rows.filter((r) => r.must && r.label === "thin");
  if (thinMust.length) risks.push(`thin evidence on ${thinMust.map((r) => r.requirement).join(", ")}`);
  if (type === "split" || type === "intern_cohort") risks.push("coordination cost: work split across people");
  if (type === "contractor") risks.push("knowledge leaves with the contractor unless handover is a work atom");
  if (fit.rows.some((r) => r.staleOnly)) risks.push("some evidence is older than 3 years");

  return {
    id: `${type}:${members.map((m) => m.cap.actorId).join("+")}`,
    type,
    members: members.map((m) => ({ actorId: m.cap.actorId, name: m.cap.name, role: m.role, share: round(m.share) })),
    fit,
    monthlyCostInr: Math.round(cost),
    startDate,
    availableFrom: startDate,
    risks,
    unknowns: fit.unknowns,
    infeasible,
  };
}

// A configuration's coverage of a requirement is the best any member brings;
// a mentor's evidence counts at half, because supervising is not doing.
function mergedFit(members, demand, now) {
  const perMember = members.map((m) => ({
    role: m.role,
    fit: fitVector(demand.requirements, m.cap.evidence || {}, now),
  }));
  const rows = demand.requirements.map((r, i) => {
    let best = null;
    for (const pm of perMember) {
      const row = pm.fit.rows[i];
      if (row.coverage === null) continue;
      const cov = pm.role === "mentor" ? row.coverage * MENTOR_EVIDENCE_FACTOR : row.coverage;
      if (!best || cov > best.coverage) best = { ...row, coverage: round(cov), label: label(cov).id };
    }
    return best || { requirement: r.capability, must: Boolean(r.must), coverage: null, label: "unknown", bestClass: null, recencyMonths: null, staleOnly: false };
  });
  return summarise(rows);
}

// ---------- selection ----------

// Keep a configuration unless another is at least as good on every axis and
// strictly better on one. Axes: strong must-haves (↑), unknown must-haves (↓),
// mean known coverage (↑), cost (↓), start date (↓), risk count (↓).
function dominates(a, b) {
  const ax = axes(a);
  const bx = axes(b);
  let strictly = false;
  for (let k = 0; k < ax.length; k++) {
    if (ax[k] < bx[k]) return false;
    if (ax[k] > bx[k]) strictly = true;
  }
  return strictly;
}

function axes(c) {
  // all oriented so bigger is better
  return [
    c.fit.mustStrong,
    -c.fit.mustUnknown,
    c.fit.meanKnown ?? 0,
    -c.monthlyCostInr,
    -Date.parse(c.startDate),
    -c.risks.length,
  ];
}

function pareto(list) {
  return list.filter((c) => !list.some((o) => o !== c && dominates(o, c)));
}

export function compareConfigs(a, b) {
  if (b.fit.mustStrong !== a.fit.mustStrong) return b.fit.mustStrong - a.fit.mustStrong;
  if (a.fit.mustUnknown !== b.fit.mustUnknown) return a.fit.mustUnknown - b.fit.mustUnknown;
  const am = a.fit.meanKnown ?? -1;
  const bm = b.fit.meanKnown ?? -1;
  if (bm !== am) return bm - am;
  if (a.monthlyCostInr !== b.monthlyCostInr) return a.monthlyCostInr - b.monthlyCostInr;
  if (a.startDate !== b.startDate) return a.startDate < b.startDate ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// What a keyword matcher would have picked: the single person whose claims
// mention the most requirement names, evidence quality ignored. Stored so the
// calibration report can show lift against something real (FR-ALC-06).
function naiveBaseline(demand, people) {
  let best = null;
  for (const p of people) {
    const hits = demand.requirements.filter((r) => (p.evidence?.[r.capability] || []).length > 0).length;
    if (!best || hits > best.hits || (hits === best.hits && p.actorId < best.actorId)) best = { actorId: p.actorId, hits };
  }
  return best;
}

function brief(c) {
  return { id: c.id, type: c.type, monthlyCostInr: c.monthlyCostInr, startDate: c.startDate, mustStrong: c.fit.mustStrong, mustUnknown: c.fit.mustUnknown };
}

function* combinations(arr, k, start = 0, acc = []) {
  if (acc.length === k) {
    yield [...acc];
    return;
  }
  for (let i = start; i < arr.length; i++) {
    acc.push(arr[i]);
    yield* combinations(arr, k, i + 1, acc);
    acc.pop();
  }
}

function round(x) {
  return Math.round(x * 100) / 100;
}
