-- ============================================================================
-- V2 work, outcome, compiler runs, agent runtime, durable jobs, sources.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Source snapshots: immutable raw copies of anything external, stored before
-- it is interpreted (blueprint §19.2). Dedupe on (source, external_id), then
-- on content hash.
-- ---------------------------------------------------------------------------
CREATE TABLE v2.source_snapshots (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source        text NOT NULL,              -- 'adzuna', 'v1:job_postings', 'upload', …
  external_id   text,
  canonical_url text,
  content_hash  text NOT NULL,
  raw           jsonb NOT NULL,
  fetched_at    timestamptz NOT NULL DEFAULT now(),
  v1_external_job_posting_id uuid,           -- soft reference; V1 prunes stale rows
  UNIQUE (source, external_id, content_hash)
);
CREATE INDEX source_snapshots_hash_idx ON v2.source_snapshots (content_hash);

ALTER TABLE v2.demand_versions
  ADD CONSTRAINT demand_versions_source_snapshot_fk FOREIGN KEY (source_snapshot_id) REFERENCES v2.source_snapshots(id);
CREATE INDEX demand_versions_source_snapshot_idx ON v2.demand_versions (source_snapshot_id);

CREATE TABLE v2.external_refs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type   text NOT NULL CHECK (entity_type IN ('demand', 'engagement', 'actor')),
  entity_id     uuid NOT NULL,
  system        text NOT NULL,              -- 'zoho_recruit', 'gov_portal:ssc', …
  external_id   text NOT NULL,
  external_state text,
  last_synced_at timestamptz,
  sync_status   text NOT NULL DEFAULT 'ok' CHECK (sync_status IN ('ok', 'stale', 'error')),
  UNIQUE (system, external_id)
);
CREATE INDEX external_refs_entity_idx ON v2.external_refs (entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- Compiler runs: stored so the prediction can be compared with what happened.
-- ---------------------------------------------------------------------------
CREATE TABLE v2.compiler_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  demand_id       uuid NOT NULL REFERENCES v2.demands(id),
  demand_version  integer NOT NULL,
  compiler_version text NOT NULL,
  inputs_hash     text NOT NULL,
  inputs          jsonb NOT NULL,          -- supply ids + evidence snapshot used (no raw PII beyond ids)
  configurations  jsonb NOT NULL,
  dominated       jsonb NOT NULL DEFAULT '[]',
  infeasible      jsonb NOT NULL DEFAULT '[]',
  excluded_supply jsonb NOT NULL DEFAULT '[]',
  baseline        jsonb,
  chosen_configuration_id text,
  run_by_actor_id uuid NOT NULL REFERENCES v2.actors(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (demand_id, demand_version) REFERENCES v2.demand_versions(demand_id, version)
);
CREATE INDEX compiler_runs_demand_idx ON v2.compiler_runs (demand_id, demand_version);
CREATE INDEX compiler_runs_run_by_idx ON v2.compiler_runs (run_by_actor_id);

ALTER TABLE v2.engagements
  ADD CONSTRAINT engagements_compiler_run_fk FOREIGN KEY (compiler_run_id) REFERENCES v2.compiler_runs(id);
CREATE INDEX engagements_compiler_run_idx ON v2.engagements (compiler_run_id);

-- ---------------------------------------------------------------------------
-- Work.
-- ---------------------------------------------------------------------------
CREATE TABLE v2.assignments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id uuid NOT NULL REFERENCES v2.engagements(id),
  work_atom_id  uuid NOT NULL REFERENCES v2.work_atoms(id),
  assignee_actor_id uuid NOT NULL REFERENCES v2.actors(id),
  due_on        date,
  state         text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'blocked', 'submitted', 'accepted', 'reopened', 'cancelled')),
  blocker       text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (engagement_id, work_atom_id, assignee_actor_id)
);
CREATE INDEX assignments_assignee_idx ON v2.assignments (assignee_actor_id, state);
CREATE INDEX assignments_work_atom_idx ON v2.assignments (work_atom_id);

CREATE TABLE v2.deliverables (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES v2.assignments(id),
  artifact_id   uuid NOT NULL UNIQUE REFERENCES v2.evidence_artifacts(id),
  submitted_by_actor_id uuid NOT NULL REFERENCES v2.actors(id),
  submitted_at  timestamptz NOT NULL DEFAULT now(),
  review_state  text NOT NULL DEFAULT 'pending' CHECK (review_state IN ('pending', 'accepted', 'changes_requested'))
);
CREATE INDEX deliverables_assignment_idx ON v2.deliverables (assignment_id);
CREATE INDEX deliverables_submitted_by_idx ON v2.deliverables (submitted_by_actor_id);

-- ---------------------------------------------------------------------------
-- Outcomes.
-- ---------------------------------------------------------------------------
CREATE TABLE v2.outcomes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id   uuid NOT NULL UNIQUE REFERENCES v2.engagements(id),
  kind            text NOT NULL CHECK (kind IN ('project_result', 'hire_result', 'placement', 'internship_result')),
  success_criteria jsonb NOT NULL DEFAULT '[]',
  predicted       jsonb,                   -- from the compiler run the engagement came from
  actual          jsonb NOT NULL,
  result          text NOT NULL CHECK (result IN ('exceeded', 'met', 'partially_met', 'not_met', 'not_measurable')),
  contributors    jsonb NOT NULL DEFAULT '[]',   -- [{actor_id, role, share}]
  confounders     text[] NOT NULL DEFAULT '{}',
  economic_impact jsonb,                   -- blueprint §14.3: measured cost / savings / revenue / SLA / quality effect
  attribution_confidence text NOT NULL CHECK (attribution_confidence IN ('low', 'medium', 'high')),
  verification_state text NOT NULL DEFAULT 'provisional'
                  CHECK (verification_state IN ('provisional','probable','verified','disputed','revoked')),
  -- V1 placement vocabulary, carried over exactly (backend/src/config/placement.js).
  placement_status text CHECK (placement_status IN ('not_placed', 'placed', 'opted_out')),
  ctc_band        text CHECK (ctc_band IN ('under_3', '3_6', '6_10', '10_15', '15_25', '25_plus')),
  evidence_refs   uuid[] NOT NULL DEFAULT '{}',
  measured_at     timestamptz NOT NULL DEFAULT now(),
  confirmed_by_actor_id uuid NOT NULL REFERENCES v2.actors(id),
  CHECK (kind <> 'placement' OR placement_status IS NOT NULL)
);
CREATE INDEX outcomes_confirmed_by_idx ON v2.outcomes (confirmed_by_actor_id);

ALTER TABLE v2.engagements
  ADD CONSTRAINT engagements_outcome_fk FOREIGN KEY (outcome_id) REFERENCES v2.outcomes(id);
CREATE INDEX engagements_outcome_idx ON v2.engagements (outcome_id);

-- ---------------------------------------------------------------------------
-- Agent runtime.
-- ---------------------------------------------------------------------------
CREATE TABLE v2.agent_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_actor_id uuid NOT NULL REFERENCES v2.actors(id),
  workflow      text NOT NULL,             -- 'seeker.apply', 'demand.fill', …
  correlation_id uuid NOT NULL,
  grant_id      uuid REFERENCES v2.authority_grants(id),
  on_behalf_of_actor_id uuid NOT NULL REFERENCES v2.actors(id),
  state         text NOT NULL DEFAULT 'queued'
                CHECK (state IN ('queued','running','waiting','escalated','succeeded','failed','cancelled')),
  budget_inr    numeric(8,2) NOT NULL DEFAULT 10,
  cost_inr      numeric(8,2) NOT NULL DEFAULT 0,
  tokens_in     integer NOT NULL DEFAULT 0,
  tokens_out    integer NOT NULL DEFAULT 0,
  error         text,
  started_at    timestamptz,
  finished_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (cost_inr <= budget_inr * 1.05)  -- a small tolerance for the last call's estimate error
);
CREATE INDEX agent_runs_correlation_idx ON v2.agent_runs (correlation_id);
CREATE INDEX agent_runs_agent_state_idx ON v2.agent_runs (agent_actor_id, state);
CREATE INDEX agent_runs_grant_idx ON v2.agent_runs (grant_id);
CREATE INDEX agent_runs_principal_idx ON v2.agent_runs (on_behalf_of_actor_id, created_at DESC);

ALTER TABLE v2.evidence_artifacts
  ADD CONSTRAINT evidence_artifacts_agent_run_fk FOREIGN KEY (agent_run_id) REFERENCES v2.agent_runs(id);
CREATE INDEX evidence_artifacts_agent_run_idx ON v2.evidence_artifacts (agent_run_id);

CREATE TABLE v2.agent_run_checkpoints (
  run_id      uuid NOT NULL REFERENCES v2.agent_runs(id),
  step        smallint NOT NULL,
  name        text NOT NULL,
  output      jsonb NOT NULL,
  model_calls uuid[] NOT NULL DEFAULT '{}',   -- public.ai_usage ids
  policy_decision_ids uuid[] NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, step)
);

-- Durable jobs. Claimed with SELECT … FOR UPDATE SKIP LOCKED by a Vercel Cron
-- tick (beta) or a worker (GA). "Wait three days" is run_after, not a timer.
CREATE TABLE v2.jobs (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind         text NOT NULL,
  payload      jsonb NOT NULL DEFAULT '{}',
  run_id       uuid REFERENCES v2.agent_runs(id),
  tenant_actor_id uuid REFERENCES v2.actors(id),
  agent_code   text,
  state        text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'running', 'done', 'failed', 'cancelled')),
  run_after    timestamptz NOT NULL DEFAULT now(),
  attempts     smallint NOT NULL DEFAULT 0,
  max_attempts smallint NOT NULL DEFAULT 3,
  locked_by    text,
  locked_at    timestamptz,
  dedupe_key   text UNIQUE,
  last_error   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_ready_idx ON v2.jobs (run_after, id) WHERE state = 'queued';
CREATE INDEX jobs_run_idx ON v2.jobs (run_id);
CREATE INDEX jobs_tenant_idx ON v2.jobs (tenant_actor_id);

-- Claim up to p_limit ready jobs, skipping anything a kill switch has stopped.
CREATE FUNCTION v2.claim_jobs(p_worker text, p_limit integer) RETURNS SETOF v2.jobs
LANGUAGE plpgsql SET search_path = '' AS $fn$
BEGIN
  IF EXISTS (SELECT 1 FROM v2.agent_switches WHERE scope = 'system' AND target_id = 'system' AND NOT enabled) THEN
    -- Agents are off; only non-agent jobs (outbox delivery, expiry sweeps) run.
    RETURN QUERY
      UPDATE v2.jobs j SET state = 'running', locked_by = p_worker, locked_at = now(), attempts = attempts + 1
       WHERE j.id IN (SELECT id FROM v2.jobs WHERE state = 'queued' AND run_after <= now() AND agent_code IS NULL
                       ORDER BY run_after, id LIMIT p_limit FOR UPDATE SKIP LOCKED)
      RETURNING j.*;
    RETURN;
  END IF;
  RETURN QUERY
    UPDATE v2.jobs j SET state = 'running', locked_by = p_worker, locked_at = now(), attempts = attempts + 1
     WHERE j.id IN (
       SELECT q.id FROM v2.jobs q
        WHERE q.state = 'queued' AND q.run_after <= now()
          AND NOT EXISTS (SELECT 1 FROM v2.agent_switches s WHERE NOT s.enabled AND (
                (s.scope = 'agent'  AND s.target_id = q.agent_code) OR
                (s.scope = 'tenant' AND s.target_id = q.tenant_actor_id::text)))
        ORDER BY q.run_after, q.id LIMIT p_limit FOR UPDATE SKIP LOCKED)
    RETURNING j.*;
END
$fn$;

CREATE TABLE v2.worker_heartbeats (
  worker      text NOT NULL,
  ran_at      timestamptz NOT NULL DEFAULT now(),
  claimed     integer NOT NULL,
  succeeded   integer NOT NULL,
  failed      integer NOT NULL,
  replay_parity_ok boolean,              -- set by the nightly replay check
  note        text,
  PRIMARY KEY (worker, ran_at)
);

-- Model-call cache for the AI gateway: (task, model, prompt version, input hash).
CREATE TABLE v2.ai_cache (
  cache_key    text PRIMARY KEY,
  task         text NOT NULL,
  model        text NOT NULL,
  prompt_version text NOT NULL,
  output       jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL
);
CREATE INDEX ai_cache_expiry_idx ON v2.ai_cache (expires_at);
