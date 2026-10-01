# Aco's Employment

Live operating console for Aco's Employment V2. One engagement record, three views: job seeker, employer, institution. Staffing options are not mocked — `GET /api/compile` runs the reference kernel (`compiler@2.0.0`) on the Kesar Foods proof-loop scenario.

## What is live

- Seeker: ready-for-you, engagements board, capability passport, timeline, automation ceilings
- Employer: demand draft, configurations from the compiler, pipeline, decision card, outcome
- Institution: cohort map, placement report
- Offers, declines, and disclosure stay with a person. External boards stay at "you press submit".

## Run

```bash
npm install
npm test
npm run dev
```

- App: http://localhost:3000
- Compiler: http://localhost:3000/api/compile
- Health: http://localhost:3000/api/health

Kernel tests live in `kernel/tests` (node:test, no dependencies). SQL migrations for a later Postgres apply are in `db/sql`.
