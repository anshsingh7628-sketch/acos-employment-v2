import { test } from "node:test";
import assert from "node:assert/strict";
import { coverage, itemWeight, verificationState, label, fitVector, CLAIM_GROUP_CAP } from "../src/evidence.js";

const NOW = Date.parse("2026-10-15T00:00:00Z");
const fresh = "2026-10-01T00:00:00Z";

test("no evidence is unknown (null), not zero", () => {
  const c = coverage([], NOW);
  assert.equal(c.coverage, null);
  assert.equal(label(c.coverage).id, "unknown");
  assert.equal(label(c.coverage).text, "No evidence yet");
});

test("ten resume claims stay capped as one self-assertion", () => {
  const claims = Array.from({ length: 10 }, () => ({ class: "claim", state: "provisional", observedAt: fresh }));
  const c = coverage(claims, NOW);
  assert.ok(c.coverage <= CLAIM_GROUP_CAP + 1e-9, `got ${c.coverage}`);
  assert.equal(label(c.coverage).id, "thin");
});

test("one attested work artifact outranks any number of claims", () => {
  const claims = Array.from({ length: 10 }, () => ({ class: "claim", state: "provisional", observedAt: fresh }));
  const artifact = [{ class: "work_artifact", state: "probable", observedAt: fresh }];
  assert.ok(coverage(artifact, NOW).coverage > coverage(claims, NOW).coverage);
});

test("disputed and revoked evidence is excluded entirely", () => {
  assert.equal(itemWeight({ class: "verified_outcome", state: "disputed", observedAt: fresh }, NOW), null);
  assert.equal(coverage([{ class: "verified_outcome", state: "revoked", observedAt: fresh }], NOW).coverage, null);
});

test("recency halves weight every 24 months", () => {
  const now = Date.parse("2028-10-01T00:00:00Z");
  const w = itemWeight({ class: "verified_outcome", state: "verified", observedAt: "2026-10-01T00:00:00Z" }, now);
  assert.ok(Math.abs(w - 0.5) < 0.01, `got ${w}`);
});

test("you cannot attest your own work into a higher tier", () => {
  const self = { subjectId: "p1", attestations: [{ actorId: "p1", authorized: true }] };
  assert.equal(verificationState(self), "provisional");
  const mentor = { subjectId: "p1", attestations: [{ actorId: "m1", authorized: true }] };
  assert.equal(verificationState(mentor), "probable");
  assert.equal(verificationState({ ...mentor, objectiveSource: { resolves: true } }), "verified");
  assert.equal(verificationState({ ...mentor, objectiveSource: { resolves: true }, disputeOpen: true }), "disputed");
  assert.equal(verificationState({ systemOfRecord: true, revoked: true }), "revoked");
});

test("stale-only evidence never makes a must-have strong (returnship rule)", () => {
  const now = Date.parse("2026-10-15T00:00:00Z");
  const old = [
    { class: "verified_outcome", state: "verified", observedAt: "2023-06-01T00:00:00Z" },
    { class: "verified_outcome", state: "verified", observedAt: "2023-05-01T00:00:00Z" },
  ];
  // Without the rule these two would combine to ~0.5 ("some evidence").
  assert.ok(coverage(old, now).coverage > 0.45);
  const fit = fitVector([{ capability: "x", must: true }], { x: old }, now);
  assert.equal(fit.rows[0].staleOnly, true);
  assert.ok(fit.rows[0].coverage < 0.3);
});

test("a verified work artifact alone is 'some', not 'strong' — strong needs an outcome or corroboration", () => {
  const one = coverage([{ class: "work_artifact", state: "verified", observedAt: fresh }], NOW);
  assert.equal(label(one.coverage).id, "some");
  const two = coverage(
    [
      { class: "work_artifact", state: "verified", observedAt: fresh },
      { class: "assessment", state: "verified", observedAt: fresh },
    ],
    NOW
  );
  assert.equal(label(two.coverage).id, "strong");
});

test("fit vector counts unknown must-haves separately from weak ones", () => {
  const fit = fitVector(
    [
      { capability: "a", must: true },
      { capability: "b", must: true },
      { capability: "c", must: false },
    ],
    { a: [{ class: "verified_outcome", state: "verified", observedAt: fresh }] },
    NOW
  );
  assert.equal(fit.mustStrong, 1);
  assert.equal(fit.mustUnknown, 1);
  assert.deepEqual(fit.unknowns, ["b", "c"]);
  assert.equal(fit.meanKnown, fit.rows[0].coverage);
});
