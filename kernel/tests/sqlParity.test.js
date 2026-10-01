// The database and the kernel describe the same lifecycle. These tests read
// the migration files and fail if either side changes without the other.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { allEngagementEdges } from "../src/stateMachine.js";
import { ENGAGEMENT_STATES, V1_JOBS_STATUS_MAP, V1_APPLICATION_STATUS_MAP, v1JobsStatusFor } from "../src/states.js";

const sqlDir = join(dirname(fileURLToPath(import.meta.url)), "../../../03_Technical/sql");
const read = (f) => readFileSync(join(sqlDir, f), "utf8");
const haveSql = existsSync(sqlDir);

test("SQL transition table equals the kernel's edges", { skip: !haveSql }, () => {
  const sql = read("002_v2_state_and_events.sql");
  const rows = [...sql.matchAll(/^\s+\('([a-z_]+)', '([a-z_]+)', '([a-z_.]+)'\)/gm)].map((m) => `${m[1]}>${m[2]}:${m[3]}`);
  const kernel = allEngagementEdges().map((e) => `${e.from}>${e.to}:${e.action}`);
  assert.deepEqual(rows.sort(), kernel.sort());
});

test("SQL engagement state CHECK lists exactly the kernel's states", { skip: !haveSql }, () => {
  const sql = read("002_v2_state_and_events.sql");
  const block = sql.slice(sql.indexOf("CREATE TABLE v2.engagements"), sql.indexOf("CREATE INDEX engagements_demand_state_idx"));
  const check = block.slice(block.indexOf("state            text NOT NULL CHECK"), block.indexOf("version          integer"));
  const states = [...check.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual(states.sort(), [...ENGAGEMENT_STATES].sort());
});

test("SQL V1 status map equals the kernel's", { skip: !haveSql }, () => {
  const sql = read("005_v2_v1_bridge.sql");
  const pairs = [...sql.matchAll(/\('(jobs|applications)', '([a-z_]+)', '([a-z_]+)'\)/g)];
  const jobs = Object.fromEntries(pairs.filter((m) => m[1] === "jobs").map((m) => [m[2], m[3]]));
  const apps = Object.fromEntries(pairs.filter((m) => m[1] === "applications").map((m) => [m[2], m[3]]));
  assert.deepEqual(jobs, { ...V1_JOBS_STATUS_MAP });
  assert.deepEqual(apps, { ...V1_APPLICATION_STATUS_MAP });
});

test("SQL v2.v1_jobs_status() agrees with v1JobsStatusFor() for every state", { skip: !haveSql }, () => {
  const sql = read("005_v2_v1_bridge.sql");
  const fn = sql.slice(sql.indexOf("CREATE FUNCTION v2.v1_jobs_status"), sql.indexOf("$$;", sql.indexOf("CREATE FUNCTION v2.v1_jobs_status")));
  const sqlMap = {};
  for (const m of fn.matchAll(/WHEN p_state IN \(([^)]+)\) THEN '([a-z]+)'/g)) {
    for (const s of m[1].match(/'([a-z_]+)'/g).map((x) => x.slice(1, -1))) sqlMap[s] = m[2];
  }
  for (const s of ENGAGEMENT_STATES) {
    if (s === "closed") continue; // reason-dependent; covered by the SQL tests T14
    assert.equal(sqlMap[s], v1JobsStatusFor(s), s);
  }
});
