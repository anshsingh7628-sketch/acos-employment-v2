# Aco's Employment

Live operating console for Aco's Employment V2. One engagement record, three views: job seeker, employer, institution. Staffing options are not mocked — `GET /api/compile` runs the reference kernel (`compiler@2.0.0`) on the Kesar Foods proof-loop scenario. Offers are checked against `POST /api/policy` and stay human-only.

## What is live

- Seeker: ready-for-you with approve / skip / undo, engagements board, capability passport, timeline, automation ceilings
- Employer: demand draft, configurations from the compiler, pipeline, L6 offer send, outcome confirm
- Institution: cohort map, consent gate, placement report
- Command bar (⌘K) and notification trail

## Run

```bash
npm install
npm test
npm run dev
```

- App: http://localhost:3000
- Compiler: http://localhost:3000/api/compile
- Policy: POST http://localhost:3000/api/policy
- Health: http://localhost:3000/api/health

Kernel tests live in `kernel/tests` (node:test, no dependencies). SQL migrations for a later Postgres apply are in `db/sql`.
