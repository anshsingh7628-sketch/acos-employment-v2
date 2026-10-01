import { test } from "node:test";
import assert from "node:assert/strict";
import { compile, COMPILER_VERSION } from "../src/compiler.js";
import { demand, supply, NOW } from "./fixtures.js";

const run = (d = demand, s = supply) => compile(d, s, { now: NOW });
const everyone = (r) => r.configurations.flatMap((c) => c.members.map((m) => m.actorId));

test("a student who hasn't consented never appears, whatever their evidence", () => {
  const r = run();
  assert.ok(!everyone(r).includes("p:kiran"));
  assert.deepEqual(r.excludedSupply.find((x) => x.actorId === "p:kiran").reasons, ["no_disclosure_consent_for_this_audience"]);
});

test("hard constraints filter; they are never traded against fit", () => {
  const r = run();
  // Vikram has the strongest evidence of anyone and starts too late.
  assert.ok(!everyone(r).includes("p:vikram"));
  assert.ok(r.excludedSupply.find((x) => x.actorId === "p:vikram").reasons.includes("not_available_in_window"));
});

test("people without the hours are infeasible, with the reason", () => {
  const r = run();
  const rohan = r.infeasible.find((x) => x.id === "single:p:rohan");
  assert.ok(rohan);
  assert.match(rohan.reasons.join(), /needs_30h_has_20h/);
});

test("lowering the budget removes configurations, and says why", () => {
  const r = run({ ...demand, budgetMonthlyInr: 16000 });
  for (const c of r.configurations) assert.ok(c.monthlyCostInr <= 16000, c.id);
  assert.ok(r.infeasible.some((x) => x.reasons.includes("over_budget")));
});

test("results are Pareto: nothing shown is beaten on every axis by something else", () => {
  const r = run();
  const ax = (c) => [c.fit.mustStrong, -c.fit.mustUnknown, c.fit.meanKnown ?? 0, -c.monthlyCostInr, -Date.parse(c.startDate), -c.risks.length];
  for (const a of r.configurations) {
    for (const b of r.configurations) {
      if (a === b) continue;
      const A = ax(a);
      const B = ax(b);
      const dominated = B.every((v, i) => v >= A[i]) && B.some((v, i) => v > A[i]);
      assert.ok(!dominated, `${a.id} is dominated by ${b.id}`);
    }
  }
});

test("an option with an unknown must-have is ranked below options without one", () => {
  const r = run();
  const firstUnknown = r.configurations.findIndex((c) => c.fit.mustUnknown > 0);
  const lastKnown = r.configurations.map((c) => c.fit.mustUnknown === 0).lastIndexOf(true);
  if (firstUnknown !== -1) assert.ok(firstUnknown > lastKnown);
});

test("unknowns are named, never scored as zero", () => {
  const r = run();
  const withGap = [...r.configurations, ...r.moreOptions].find((c) => (c.mustUnknown ?? c.fit?.mustUnknown) > 0);
  assert.ok(withGap, "fixture should produce at least one option with a gap");
  const full = r.configurations.find((c) => c.fit.mustUnknown > 0);
  if (full) {
    const row = full.fit.rows.find((x) => x.coverage === null);
    assert.equal(row.label, "unknown");
    assert.ok(full.unknowns.includes(row.requirement));
  }
});

test("a mentor's evidence counts at half: supervising is not doing", () => {
  const r = run();
  const wm = r.configurations.find((c) => c.id === "with_mentor:p:ananya+p:meenakshi");
  const crm = wm.fit.rows.find((x) => x.requirement === "crm_admin");
  // Ananya has no CRM evidence; it comes from the mentor at 50%.
  assert.ok(crm.coverage > 0 && crm.coverage <= 0.5, `${crm.coverage}`);
});

test("same inputs → same output and same inputs hash (needed for calibration)", () => {
  const a = run();
  const b = run();
  assert.equal(a.inputsHash, b.inputsHash);
  assert.deepEqual(a.configurations.map((c) => c.id), b.configurations.map((c) => c.id));
  assert.equal(a.compilerVersion, COMPILER_VERSION);
  const c = run({ ...demand, hoursPerWeek: 29 });
  assert.notEqual(c.inputsHash, a.inputsHash);
});

test("the naive baseline is recorded for lift measurement", () => {
  const r = run();
  assert.ok(r.baseline?.actorId);
});

test("disallowed configuration types are never produced", () => {
  const r = run({ ...demand, allowedConfigs: ["single"] });
  for (const c of [...r.configurations, ...r.moreOptions]) assert.equal(c.type, "single");
});
