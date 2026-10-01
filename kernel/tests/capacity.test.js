import { test } from "node:test";
import assert from "node:assert/strict";
import { reserve, expiredHolds, freeHoursAt } from "../src/capacity.js";

const NOW = Date.parse("2026-10-15T00:00:00Z");
const cap = { id: "cap:priya", consented: true, weeklyHours: 40, committedHours: 0 };
const win = { from: "2026-11-01T00:00:00Z", to: "2027-01-01T00:00:00Z" };

test("two hard 30h reservations on a 40h week: the second is refused with the gap", () => {
  const first = reserve({ capacity: cap, existing: [], request: { demandId: "d1", kind: "hard", hoursPerWeek: 30, ...win }, now: NOW });
  assert.equal(first.ok, true);
  const second = reserve({ capacity: cap, existing: [first.reservation], request: { demandId: "d2", kind: "hard", hoursPerWeek: 30, ...win }, now: NOW });
  assert.equal(second.ok, false);
  assert.equal(second.reason, "capacity_conflict");
  assert.equal(second.available, 10);
});

test("non-overlapping windows don't conflict", () => {
  const a = reserve({ capacity: cap, existing: [], request: { demandId: "d1", kind: "hard", hoursPerWeek: 40, ...win }, now: NOW }).reservation;
  const b = reserve({
    capacity: cap, existing: [a],
    request: { demandId: "d2", kind: "hard", hoursPerWeek: 40, from: "2027-01-01T00:00:00Z", to: "2027-03-01T00:00:00Z" }, now: NOW,
  });
  assert.equal(b.ok, true);
});

test("a hard reservation pre-empts soft holds that no longer fit", () => {
  const soft = reserve({ capacity: cap, existing: [], request: { demandId: "d-soft", kind: "soft", hoursPerWeek: 20, ...win }, now: NOW }).reservation;
  const hard = reserve({ capacity: cap, existing: [soft], request: { demandId: "d-hard", kind: "hard", hoursPerWeek: 30, ...win }, now: NOW });
  assert.equal(hard.ok, true);
  assert.equal(hard.preempted.length, 1);
  assert.equal(hard.preempted[0].state, "preempted");
});

test("a soft request respects existing soft holds", () => {
  const soft = reserve({ capacity: cap, existing: [], request: { demandId: "d1", kind: "soft", hoursPerWeek: 30, ...win }, now: NOW }).reservation;
  const again = reserve({ capacity: cap, existing: [soft], request: { demandId: "d2", kind: "soft", hoursPerWeek: 20, ...win }, now: NOW });
  assert.equal(again.ok, false);
});

test("converting a demand's own soft hold to hard doesn't double count", () => {
  const soft = reserve({ capacity: cap, existing: [], request: { demandId: "d1", kind: "soft", hoursPerWeek: 30, ...win }, now: NOW }).reservation;
  const hard = reserve({ capacity: cap, existing: [soft], request: { demandId: "d1", kind: "hard", hoursPerWeek: 30, ...win }, now: NOW });
  assert.equal(hard.ok, true);
});

test("soft holds expire after 72 hours by default, and free the hours", () => {
  const soft = reserve({ capacity: cap, existing: [], request: { demandId: "d1", kind: "soft", hoursPerWeek: 40, ...win }, now: NOW }).reservation;
  const later = NOW + 73 * 3_600_000;
  assert.equal(expiredHolds([soft], later).length, 1);
  assert.equal(freeHoursAt(cap, [soft], "2026-11-15T00:00:00Z", later), 40);
  assert.equal(freeHoursAt(cap, [soft], "2026-11-15T00:00:00Z", NOW), 0);
});

test("no consent, no reservation", () => {
  const r = reserve({ capacity: { ...cap, consented: false }, existing: [], request: { demandId: "d1", kind: "soft", hoursPerWeek: 5, ...win }, now: NOW });
  assert.equal(r.reason, "capacity_not_consented");
});
