// Proof loop #1, as data: one SME demand, one college cohort, one mentor.
// Used by the compiler tests, the engine tests and demo/e2e.js, so the
// scenario the docs describe is the scenario the code actually runs.

export const NOW = Date.parse("2026-10-15T09:00:00Z");

export const ORG = "org:kesar-foods"; // an SME D2C brand
export const COLLEGE = "inst:rvce-demo";
export const COHORT = "cohort:2027-cse";

export const demand = {
  id: "dem:outbound-90d",
  orgId: ORG,
  title: "Build our first outbound sales motion",
  requirements: [
    { capability: "market_research", must: true },
    { capability: "crm_admin", must: true },
    { capability: "b2b_outreach_writing", must: true },
    { capability: "data_cleaning", must: false },
  ],
  hoursPerWeek: 30,
  window: { start: "2026-11-01T00:00:00Z", end: "2027-01-31T00:00:00Z" },
  budgetMonthlyInr: 60000,
  allowedConfigs: ["single", "with_mentor", "split", "contractor", "intern_cohort"],
  location: { remoteAllowed: true, cities: ["Bengaluru"] },
  cohortId: COHORT,
  cohortInstitutionId: COLLEGE,
};

const recent = "2026-09-10T00:00:00Z";
const lastYear = "2025-11-01T00:00:00Z";

const ev = (cls, state, observedAt = recent, context = "same") => ({ class: cls, state, observedAt, context });

export const supply = [
  {
    actorId: "p:ananya", name: "Ananya (final year, CSE)", role: "intern", cohortId: COHORT,
    consentAudiences: [`institution:${COLLEGE}`], availableFrom: "2026-11-01T00:00:00Z",
    weeklyHours: 30, committedHours: 0, monthlyRateInr: 15000, city: "Bengaluru", remoteOk: true,
    evidence: {
      market_research: [ev("work_artifact", "probable"), ev("claim", "provisional")],
      data_cleaning: [ev("assessment", "verified")],
      b2b_outreach_writing: [ev("practice_assessment", "provisional")],
    },
  },
  {
    actorId: "p:rohan", name: "Rohan (final year, CSE)", role: "intern", cohortId: COHORT,
    consentAudiences: [`institution:${COLLEGE}`], availableFrom: "2026-11-01T00:00:00Z",
    weeklyHours: 20, committedHours: 0, monthlyRateInr: 12000, city: "Mysuru", remoteOk: true,
    evidence: {
      crm_admin: [ev("credential", "verified"), ev("work_artifact", "probable", lastYear)],
      data_cleaning: [ev("claim", "provisional")],
    },
  },
  {
    actorId: "p:fatima", name: "Fatima (final year, IT)", role: "intern", cohortId: COHORT,
    consentAudiences: [`institution:${COLLEGE}`, "all"], availableFrom: "2026-11-03T00:00:00Z",
    weeklyHours: 25, committedHours: 0, monthlyRateInr: 12000, city: "Bengaluru", remoteOk: true,
    evidence: {
      b2b_outreach_writing: [ev("work_artifact", "verified")],
      market_research: [ev("claim", "provisional")],
    },
  },
  {
    // On the roster, linked, but has not consented. Must never appear.
    actorId: "p:kiran", name: "Kiran (final year, ECE)", role: "intern", cohortId: COHORT,
    consentAudiences: [], availableFrom: "2026-11-01T00:00:00Z",
    weeklyHours: 30, committedHours: 0, monthlyRateInr: 12000, city: "Bengaluru", remoteOk: true,
    evidence: { crm_admin: [ev("work_artifact", "verified")], market_research: [ev("work_artifact", "verified")] },
  },
  {
    actorId: "p:meenakshi", name: "Meenakshi (RevOps lead, mentor)", role: "mentor",
    consentAudiences: ["all"], availableFrom: "2026-10-20T00:00:00Z",
    weeklyHours: 6, committedHours: 2, monthlyRateInr: 40000, city: "Bengaluru", remoteOk: true,
    evidence: {
      crm_admin: [ev("verified_outcome", "verified")],
      b2b_outreach_writing: [ev("observed_outcome", "verified")],
      market_research: [ev("work_artifact", "verified")],
    },
  },
  {
    actorId: "p:vikram", name: "Vikram (freelance growth consultant)", role: "contractor",
    consentAudiences: ["all"], availableFrom: "2026-12-01T00:00:00Z",
    weeklyHours: 30, committedHours: 10, monthlyRateInr: 90000, city: "Pune", remoteOk: true,
    evidence: {
      crm_admin: [ev("verified_outcome", "verified")],
      b2b_outreach_writing: [ev("verified_outcome", "verified")],
      market_research: [ev("observed_outcome", "probable")],
    },
  },
];
