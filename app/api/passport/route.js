import { coverage, label } from "../../../kernel/src/evidence.js";

export const dynamic = "force-dynamic";

const NOW = Date.parse("2026-10-15T09:00:00Z");

const CLAIMS = [
  {
    id: "clm:writing",
    capability: "b2b_outreach_writing",
    source: "resume:priya-v3",
    extractor: "capability@2.0.0",
    items: [{ class: "work_artifact", state: "verified", observedAt: "2026-09-10T00:00:00Z", context: "same" }],
  },
  {
    id: "clm:research",
    capability: "market_research",
    source: "resume:priya-v3",
    extractor: "capability@2.0.0",
    items: [{ class: "claim", state: "provisional", observedAt: "2026-09-10T00:00:00Z", context: "same" }],
  },
  {
    id: "clm:data",
    capability: "data_cleaning",
    source: "assessment:sheet-hygiene",
    extractor: "capability@2.0.0",
    items: [{ class: "assessment", state: "verified", observedAt: "2026-08-02T00:00:00Z", context: "same" }],
  },
  {
    id: "clm:crm",
    capability: "crm_admin",
    source: null,
    extractor: null,
    items: [],
  },
];

export function GET() {
  const scored = CLAIMS.map((c) => {
    const cov = c.items.length ? coverage(c.items, NOW) : null;
    const lab = label(cov);
    return {
      ...c,
      coverage: cov,
      label: lab.id,
      unknown: cov === null,
    };
  });
  return Response.json({
    person: "Priya Sharma",
    extractor: "capability@2.0.0",
    claims: scored,
    capacity: {
      hours: 30,
      noticeDays: 15,
      band: "15–20k",
      city: "Bengaluru",
      remote: true,
      confirmed: false,
    },
    live: true,
  });
}
