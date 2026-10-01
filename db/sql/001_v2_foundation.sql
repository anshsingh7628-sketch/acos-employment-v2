-- ============================================================================
-- V2 foundation: schema, actors, capability taxonomy, authority, policy log,
-- idempotency, kill switches.
--
-- Additive only. Touches no V1 table except to reference it by foreign key.
-- Every table ships deny-all (006), exactly as V1 does (DECISIONS.md #1).
--
-- Naming: when applied through Supabase `apply_migration`, rename the file to
-- the timestamp it stamps (CONTRIBUTING.md, "migrations").
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS v2;
COMMENT ON SCHEMA v2 IS 'Aco''s Employment V2. Authoritative for demand, capacity, engagement, evidence and outcome once each domain is cut over. See 03_Technical/08_Data_Model.md.';

-- ---------------------------------------------------------------------------
-- Actors: anything that can act or be acted for. A person, an organisation,
-- an agent, or the platform itself. V1 users/companies/institutions get an
-- actor row; the V1 id is kept alongside so nothing has to be renumbered.
-- ---------------------------------------------------------------------------
CREATE TABLE v2.actors (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          text NOT NULL CHECK (kind IN ('person', 'organization', 'agent', 'system')),
  display_name  text NOT NULL,
  v1_user_id        uuid UNIQUE REFERENCES public.users(id),
  v1_company_id     uuid UNIQUE REFERENCES public.companies(id),
  v1_institution_id uuid UNIQUE REFERENCES public.institutions(id),
  org_type      text CHECK (org_type IN ('company', 'institution', 'agency', 'government')),
  agent_code    text UNIQUE,  -- 'agent:application' etc.
  created_at    timestamptz NOT NULL DEFAULT now(),
  deactivated_at timestamptz,
  CONSTRAINT actor_kind_shape CHECK (
    (kind = 'person'       AND org_type IS NULL AND agent_code IS NULL) OR
    (kind = 'organization' AND org_type IS NOT NULL AND agent_code IS NULL) OR
    (kind = 'agent'        AND agent_code IS NOT NULL AND org_type IS NULL) OR
    (kind = 'system'       AND org_type IS NULL)
  )
);

INSERT INTO v2.actors (id, kind, display_name, agent_code) VALUES
  ('00000000-0000-0000-0000-000000000001', 'system', 'Aco platform', NULL),
  (gen_random_uuid(), 'agent', 'Demand agent',        'agent:demand'),
  (gen_random_uuid(), 'agent', 'Discovery agent',     'agent:discovery'),
  (gen_random_uuid(), 'agent', 'Application agent',   'agent:application'),
  (gen_random_uuid(), 'agent', 'Allocation agent',    'agent:allocation'),
  (gen_random_uuid(), 'agent', 'Qualification agent', 'agent:qualification'),
  (gen_random_uuid(), 'agent', 'Coordination agent',  'agent:coordination'),
  (gen_random_uuid(), 'agent', 'Evidence agent',      'agent:evidence'),
  (gen_random_uuid(), 'agent', 'Outcome agent',       'agent:outcome');

-- ---------------------------------------------------------------------------
-- Capability taxonomy. Data, versioned, never edited by a model directly:
-- the Qualification agent proposes aliases, a human approves them.
-- ---------------------------------------------------------------------------
CREATE TABLE v2.capabilities (
  id          text PRIMARY KEY,                -- 'crm_admin'
  label       text NOT NULL,
  family      text NOT NULL,
  parent_id   text REFERENCES v2.capabilities(id),
  aliases     text[] NOT NULL DEFAULT '{}',
  taxonomy_version integer NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX capabilities_aliases_gin ON v2.capabilities USING gin (aliases);
CREATE INDEX capabilities_parent_idx ON v2.capabilities (parent_id);

CREATE TABLE v2.capability_edges (
  from_id text NOT NULL REFERENCES v2.capabilities(id),
  to_id   text NOT NULL REFERENCES v2.capabilities(id),
  kind    text NOT NULL CHECK (kind IN ('adjacent_to', 'requires')),
  PRIMARY KEY (from_id, to_id, kind),
  CHECK (from_id <> to_id)
);
CREATE INDEX capability_edges_to_idx ON v2.capability_edges (to_id);

-- ---------------------------------------------------------------------------
-- Authority grants: what an agent may do, for whom, until when.
-- Validity rules mirror policy.js validateGrant(); the service validates the
-- grantor's verbs (they live in V1 company_members / institution_members).
-- ---------------------------------------------------------------------------
CREATE TABLE v2.authority_grants (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grantor_actor_id uuid NOT NULL REFERENCES v2.actors(id),
  grantee_actor_id uuid NOT NULL REFERENCES v2.actors(id),
  on_behalf_of_actor_id uuid NOT NULL REFERENCES v2.actors(id),
  actions         text[] NOT NULL CHECK (cardinality(actions) > 0),
  level           smallint NOT NULL CHECK (level BETWEEN 0 AND 5),  -- 6 is "a human does it"; not grantable
  scope           jsonb NOT NULL DEFAULT '{}',
  limits          jsonb NOT NULL DEFAULT '{}',
  valid_from      timestamptz NOT NULL,
  valid_until     timestamptz NOT NULL,
  escalate_to_actor_id uuid REFERENCES v2.actors(id),
  revoked_at      timestamptz,
  revoked_by_actor_id uuid REFERENCES v2.actors(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_until > valid_from),
  CHECK (valid_until - valid_from <= interval '90 days')
);
CREATE INDEX authority_grants_grantee_idx ON v2.authority_grants (grantee_actor_id) WHERE revoked_at IS NULL;
CREATE INDEX authority_grants_grantor_idx ON v2.authority_grants (grantor_actor_id);
CREATE INDEX authority_grants_principal_idx ON v2.authority_grants (on_behalf_of_actor_id);
CREATE INDEX authority_grants_escalate_idx ON v2.authority_grants (escalate_to_actor_id);
CREATE INDEX authority_grants_revoked_by_idx ON v2.authority_grants (revoked_by_actor_id);

-- ---------------------------------------------------------------------------
-- Kill switches. The job runner reads these before every claim.
-- ---------------------------------------------------------------------------
CREATE TABLE v2.agent_switches (
  scope      text NOT NULL CHECK (scope IN ('system', 'tenant', 'agent')),
  target_id  text NOT NULL,           -- 'system' | tenant actor id | agent_code
  enabled    boolean NOT NULL,
  reason     text,
  changed_by_actor_id uuid REFERENCES v2.actors(id),
  changed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, target_id)
);
CREATE INDEX agent_switches_changed_by_idx ON v2.agent_switches (changed_by_actor_id);
INSERT INTO v2.agent_switches (scope, target_id, enabled, reason)
VALUES ('system', 'system', false, 'V2 ships with agents off; turned on per tenant during alpha');

-- ---------------------------------------------------------------------------
-- Policy decisions: every evaluation that preceded a consequential action.
-- An EngagementTransitioned event without one is a bypass (NFR, 0 allowed).
-- ---------------------------------------------------------------------------
CREATE TABLE v2.policy_decisions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action       text NOT NULL,
  actor_id     uuid NOT NULL REFERENCES v2.actors(id),
  grant_id     uuid REFERENCES v2.authority_grants(id),
  result       text NOT NULL CHECK (result IN ('allow', 'require_approval', 'prepare_only', 'deny')),
  reason       text NOT NULL,
  level        smallint,
  missing_checks text[],
  context      jsonb NOT NULL DEFAULT '{}',
  policy_version text NOT NULL,
  decided_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX policy_decisions_actor_idx ON v2.policy_decisions (actor_id, decided_at DESC);
CREATE INDEX policy_decisions_grant_idx ON v2.policy_decisions (grant_id);

-- ---------------------------------------------------------------------------
-- Idempotency: same key + same request → stored response; different request
-- with the same key → refused. Mirrors events.js createIdempotencyStore().
-- ---------------------------------------------------------------------------
CREATE TABLE v2.idempotency_keys (
  key          text PRIMARY KEY,
  scope        text NOT NULL,          -- 'engagement.transition' etc.
  request_hash text NOT NULL,
  response     jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idempotency_keys_created_idx ON v2.idempotency_keys (created_at);
