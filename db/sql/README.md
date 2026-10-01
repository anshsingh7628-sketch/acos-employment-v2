# V2 SQL migrations

| File | What | Run on production? |
|---|---|---|
| `000_v1_stub_FOR_LOCAL_VALIDATION_ONLY.sql` | minimal copies of the V1 tables V2 references | **Never** — V1 already has them |
| `001_v2_foundation.sql` | schema, actors (+8 agent actors), taxonomy, grants, kill switches (agents **off**), policy log, idempotency | yes, via staging first |
| `002_v2_state_and_events.sql` | events (append-only), outbox, demand, engagement, generated transition table, `transition_engagement()`, `close_demand()` | yes |
| `003_v2_capability_evidence_capacity.sql` | consents, intents, evidence, claims, capacity, reservations (hard-capacity trigger), cohort memberships | yes |
| `004_v2_work_outcome_runtime.sql` | snapshots, external refs, compiler runs, assignments, deliverables, outcomes, agent runs, durable jobs, `claim_jobs()`, AI cache | yes |
| `005_v2_v1_bridge.sql` | status maps, compat views, dry-run backfills, orphan report | yes |
| `006_v2_security.sql` | RLS on every v2 table, revoke everything from anon/authenticated/PUBLIC | yes |
| `900_v2_tests.sql` | 18 behavioural tests, wrapped in a transaction that rolls back | staging / CI only |

## Verified

On 30 Sep 2026, on a fresh PostgreSQL **16.13** database: 000 → 006 applied with `ON_ERROR_STOP=1`, and `900_v2_tests.sql` printed `ALL V2 SQL TESTS PASSED` (T1–T18). Production runs Postgres **17** — re-run on a Supabase branch/staging project before applying.

```bash
createdb v2test
for f in 000_*.sql 00[1-6]_*.sql 900_*.sql; do psql -v ON_ERROR_STOP=1 -d v2test -f "$f"; done
```

## Applying to Supabase

1. Use `apply_migration` one file at a time, 001 → 006. It stamps its own timestamp: rename each file to match afterwards and run `npm run check:migrations` (CONTRIBUTING.md).
2. Extend `check:grants` and `check:fk-indexes` to schema `v2` (queries in 006 and 900 T17/T18).
3. `002` contains a transition table generated from `07_Reference_Kernel/v2-core`. If the kernel changes, regenerate — `tests/sqlParity.test.js` fails until you do.
4. Agents ship switched off (`agent_switches` system row). Turn on per tenant during alpha.
