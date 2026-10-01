-- ============================================================================
-- V2 capability, evidence, consent, capacity.
--
-- Weights and verification rules live in code (evidence.js) and config, not
-- in SQL: they will be recalibrated against outcomes, and a number that has to
-- be changed by migration is a number nobody changes.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Disclosure / consent. Consent is an act, never a default (DECISIONS.md #12).
-- One row per grant; revocation is a timestamp, never a delete.
-- ---------------------------------------------------------------------------
CREATE TABLE v2.consents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_actor_id uuid NOT NULL REFERENCES v2.actors(id),
  purpose         text NOT NULL CHECK (purpose IN (
                    'disclose_to_recruiters',     -- be findable as supply
                    'disclose_passport',          -- evidence visible to the audience
                    'agent_automation',           -- agents may act for me (grants still needed)
                    'institution_outcome_sharing',-- my placement/project outcome in my college's report
                    'connected_source')),         -- pull evidence from a connected system
  audience        text NOT NULL,                  -- 'all_recruiters' | 'org:<uuid>' | 'institution:<uuid>'
  scope           jsonb NOT NULL DEFAULT '{}',
  notice_version  text NOT NULL,                  -- which privacy notice text they saw
  given_at        timestamptz NOT NULL DEFAULT now(),
  withdrawn_at    timestamptz,
  source          text NOT NULL DEFAULT 'aco.v2' CHECK (source IN ('aco.v2', 'aco.v1_institution_students')),
  CHECK (audience ~ '^(all_recruiters|org:[0-9a-f-]{36}|institution:[0-9a-f-]{36}|self)$')
);
CREATE INDEX consents_subject_idx ON v2.consents (subject_actor_id, purpose) WHERE withdrawn_at IS NULL;
CREATE INDEX consents_audience_idx ON v2.consents (audience, purpose) WHERE withdrawn_at IS NULL;

-- ---------------------------------------------------------------------------
-- Intents (career goals, structured). Feeds discovery.
-- ---------------------------------------------------------------------------
CREATE TABLE v2.person_intents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_actor_id uuid NOT NULL REFERENCES v2.actors(id),
  role_family   text NOT NULL,
  capability_ids text[] NOT NULL DEFAULT '{}',
  modes         text[] NOT NULL DEFAULT '{full_time}'
                CHECK (modes <@ ARRAY['full_time','internship','contract','fractional','project','apprenticeship']::text[]),
  ctc_band_min  text,
  locations     text[] NOT NULL DEFAULT '{}',
  remote_ok     boolean NOT NULL DEFAULT true,
  start_after   date,
  open_to_adjacent boolean NOT NULL DEFAULT true,
  active        boolean NOT NULL DEFAULT true,
  v1_career_goal_id uuid,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX person_intents_person_idx ON v2.person_intents (person_actor_id) WHERE active;

-- ---------------------------------------------------------------------------
-- Evidence.
-- ---------------------------------------------------------------------------
CREATE TABLE v2.evidence_artifacts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_actor_id uuid NOT NULL REFERENCES v2.actors(id),
  class           text NOT NULL CHECK (class IN ('claim','credential','practice_assessment','assessment',
                                                 'work_artifact','observed_outcome','verified_outcome')),
  kind            text NOT NULL,          -- resume, certificate, deliverable, reviewer_note, placement, …
  title           text NOT NULL,
  observed_at     timestamptz NOT NULL,
  context_tags    text[] NOT NULL DEFAULT '{}',
  source_system   text NOT NULL,          -- aco.v1:resumes, aco.v2, adapter:github, …
  source_ref      text,                   -- id/URL in the source system
  storage_key     text,                   -- private bucket key when a file exists (never a public URL)
  content_hash    text,
  engagement_id   uuid REFERENCES v2.engagements(id),
  created_by_actor_id uuid NOT NULL REFERENCES v2.actors(id),
  agent_run_id    uuid,                   -- FK added in 004
  extractor_version text,
  system_of_record boolean NOT NULL DEFAULT false,
  objective_source jsonb,                 -- {kind, url, resolves, checked_at}
  -- Derived by evidence.js verificationState() and written by the service.
  verification_state text NOT NULL DEFAULT 'provisional'
                  CHECK (verification_state IN ('provisional','probable','verified','disputed','revoked')),
  revoked_at      timestamptz,
  revoke_reason   text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX evidence_subject_idx ON v2.evidence_artifacts (subject_actor_id, class);
CREATE INDEX evidence_engagement_idx ON v2.evidence_artifacts (engagement_id);
CREATE INDEX evidence_created_by_idx ON v2.evidence_artifacts (created_by_actor_id);

CREATE TABLE v2.evidence_attestations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id   uuid NOT NULL REFERENCES v2.evidence_artifacts(id),
  attester_actor_id uuid NOT NULL REFERENCES v2.actors(id),
  capacity      text NOT NULL CHECK (capacity IN ('mentor', 'supervisor', 'reviewer', 'institution')),
  statement     text,
  authorized    boolean NOT NULL,         -- the service checked the attester's role on the engagement
  attested_at   timestamptz NOT NULL DEFAULT now(),
  revoked_at    timestamptz,
  UNIQUE (artifact_id, attester_actor_id)
);
CREATE INDEX evidence_attestations_attester_idx ON v2.evidence_attestations (attester_actor_id);

-- You cannot vouch for yourself into a higher tier.
CREATE FUNCTION v2.no_self_attestation() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM v2.evidence_artifacts a WHERE a.id = NEW.artifact_id AND a.subject_actor_id = NEW.attester_actor_id) THEN
    RAISE EXCEPTION 'self_attestation' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER evidence_attestations_not_self BEFORE INSERT OR UPDATE ON v2.evidence_attestations
  FOR EACH ROW EXECUTE FUNCTION v2.no_self_attestation();

CREATE TABLE v2.evidence_disputes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id   uuid NOT NULL REFERENCES v2.evidence_artifacts(id),
  raised_by_actor_id uuid NOT NULL REFERENCES v2.actors(id),
  reason        text NOT NULL,
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'upheld', 'rejected', 'withdrawn')),
  resolved_by_actor_id uuid REFERENCES v2.actors(id),
  raised_at     timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz
);
CREATE INDEX evidence_disputes_artifact_idx ON v2.evidence_disputes (artifact_id) WHERE status = 'open';
CREATE INDEX evidence_disputes_raised_by_idx ON v2.evidence_disputes (raised_by_actor_id);
CREATE INDEX evidence_disputes_resolved_by_idx ON v2.evidence_disputes (resolved_by_actor_id);

-- A claim is "person P can do capability C", backed by evidence links.
CREATE TABLE v2.capability_claims (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_actor_id uuid NOT NULL REFERENCES v2.actors(id),
  capability_id   text NOT NULL REFERENCES v2.capabilities(id),
  depth           smallint CHECK (depth BETWEEN 1 AND 4),
  hidden          boolean NOT NULL DEFAULT false,   -- person chose to hide it
  revoked_at      timestamptz,                      -- person deleted it; provenance kept
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (person_actor_id, capability_id)
);
CREATE INDEX capability_claims_capability_idx ON v2.capability_claims (capability_id) WHERE revoked_at IS NULL;

CREATE TABLE v2.evidence_links (
  claim_id     uuid NOT NULL REFERENCES v2.capability_claims(id),
  artifact_id  uuid NOT NULL REFERENCES v2.evidence_artifacts(id),
  context      text NOT NULL DEFAULT 'same' CHECK (context IN ('same', 'adjacent', 'different')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (claim_id, artifact_id)
);
CREATE INDEX evidence_links_artifact_idx ON v2.evidence_links (artifact_id);

CREATE TABLE v2.experience_spans (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_actor_id uuid NOT NULL REFERENCES v2.actors(id),
  org_name        text NOT NULL,
  role_title      text NOT NULL,
  started_on      date,
  ended_on        date,
  kind            text NOT NULL DEFAULT 'work' CHECK (kind IN ('work','internship','project','education','gap')),
  show_to_others  boolean NOT NULL DEFAULT true,
  context_tags    text[] NOT NULL DEFAULT '{}',
  source_artifact_id uuid REFERENCES v2.evidence_artifacts(id),
  CHECK (ended_on IS NULL OR started_on IS NULL OR ended_on >= started_on)
);
CREATE INDEX experience_spans_person_idx ON v2.experience_spans (person_actor_id);
CREATE INDEX experience_spans_source_idx ON v2.experience_spans (source_artifact_id);

-- ---------------------------------------------------------------------------
-- Capacity and reservations.
-- ---------------------------------------------------------------------------
CREATE TABLE v2.capacity_records (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_actor_id uuid NOT NULL UNIQUE REFERENCES v2.actors(id),
  weekly_hours    numeric(4,1) NOT NULL CHECK (weekly_hours BETWEEN 0 AND 80),
  committed_hours numeric(4,1) NOT NULL DEFAULT 0 CHECK (committed_hours >= 0),
  available_from  date NOT NULL,
  modes           text[] NOT NULL DEFAULT '{full_time}',
  monthly_rate_inr integer,
  ctc_band        text,                     -- V1 placement.js band ids
  notice_period_days integer,
  city            text,
  remote_ok       boolean NOT NULL DEFAULT true,
  confirmed_at    timestamptz,              -- null = pre-filled from V1, awaiting "please confirm"
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (committed_hours <= weekly_hours)
);

CREATE TABLE v2.capacity_reservations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  capacity_id     uuid NOT NULL REFERENCES v2.capacity_records(id),
  demand_id       uuid NOT NULL REFERENCES v2.demands(id),
  engagement_id   uuid REFERENCES v2.engagements(id),
  state           text NOT NULL CHECK (state IN ('soft', 'hard', 'released', 'expired', 'preempted')),
  hours_per_week  numeric(4,1) NOT NULL CHECK (hours_per_week > 0),
  period          tstzrange NOT NULL CHECK (NOT isempty(period)),
  expires_at      timestamptz,
  owner_actor_id  uuid NOT NULL REFERENCES v2.actors(id),
  authority_id    uuid REFERENCES v2.authority_grants(id),
  release_reason  text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (state <> 'soft' OR expires_at IS NOT NULL),
  CHECK (state <> 'hard' OR engagement_id IS NOT NULL)
);
CREATE INDEX capacity_reservations_live_idx ON v2.capacity_reservations USING gist (period)
  WHERE state IN ('soft', 'hard');
CREATE INDEX capacity_reservations_capacity_idx ON v2.capacity_reservations (capacity_id);
CREATE INDEX capacity_reservations_demand_idx ON v2.capacity_reservations (demand_id);
CREATE INDEX capacity_reservations_engagement_idx ON v2.capacity_reservations (engagement_id);
CREATE INDEX capacity_reservations_owner_idx ON v2.capacity_reservations (owner_actor_id);
CREATE INDEX capacity_reservations_authority_idx ON v2.capacity_reservations (authority_id);

-- Backstop for capacity.js: a HARD reservation may never push committed +
-- hard hours past weekly_hours at any instant in its period. (Soft-hold
-- arithmetic and pre-emption live in the service, which is where the
-- product rule "accepted beats maybe" belongs.) Row lock on the capacity
-- record serialises concurrent reservers.
CREATE FUNCTION v2.check_hard_capacity() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  cap v2.capacity_records%ROWTYPE;
  peak numeric;
BEGIN
  IF NEW.state <> 'hard' THEN RETURN NEW; END IF;
  SELECT * INTO cap FROM v2.capacity_records WHERE id = NEW.capacity_id FOR UPDATE;
  SELECT coalesce(max(load), 0) INTO peak FROM (
    SELECT sum(r.hours_per_week) AS load
      FROM (SELECT lower(NEW.period) AS t
            UNION SELECT lower(x.period) FROM v2.capacity_reservations x
             WHERE x.capacity_id = NEW.capacity_id AND x.state = 'hard' AND x.id <> NEW.id
               AND lower(x.period) <@ NEW.period) pts
      JOIN LATERAL (
        SELECT NEW.hours_per_week AS hours_per_week
        UNION ALL
        SELECT x.hours_per_week FROM v2.capacity_reservations x
         WHERE x.capacity_id = NEW.capacity_id AND x.state = 'hard' AND x.id <> NEW.id AND x.period @> pts.t
      ) r ON true
     GROUP BY pts.t
  ) s;
  IF peak + cap.committed_hours > cap.weekly_hours THEN
    RAISE EXCEPTION 'capacity_conflict: % h/week needed, % available', peak + cap.committed_hours, cap.weekly_hours
      USING ERRCODE = 'exclusion_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER capacity_reservations_hard_check BEFORE INSERT OR UPDATE OF state, hours_per_week, period
  ON v2.capacity_reservations FOR EACH ROW EXECUTE FUNCTION v2.check_hard_capacity();

-- Cohort membership: the V1 roster row stays the record; this links it into V2.
CREATE TABLE v2.cohort_memberships (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_actor_id uuid NOT NULL REFERENCES v2.actors(id),
  person_actor_id     uuid REFERENCES v2.actors(id),                 -- null until claimed
  v1_institution_student_id uuid NOT NULL UNIQUE REFERENCES public.institution_students(id),
  cohort_label        text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cohort_memberships_institution_idx ON v2.cohort_memberships (institution_actor_id);
CREATE INDEX cohort_memberships_person_idx ON v2.cohort_memberships (person_actor_id);
