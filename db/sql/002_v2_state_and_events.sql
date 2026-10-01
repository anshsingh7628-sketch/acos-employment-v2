-- ============================================================================
-- V2 state and events: demands, engagements, the event log, the outbox, and
-- the one function through which an engagement's state changes.
--
-- The transition table below is GENERATED from the reference kernel
-- (07_Reference_Kernel/v2-core/src/stateMachine.js → allEngagementEdges()),
-- so the database and the code cannot disagree about which moves exist.
-- Regenerate it; don't hand-edit it.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Domain events: business truth, replayable. Envelope = blueprint §18.2 +
-- schema_version + privacy_class. Append-only (trigger below).
-- ---------------------------------------------------------------------------
CREATE TABLE v2.domain_events (
  event_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type       text NOT NULL CHECK (event_type ~ '^[A-Z][A-Za-z]+$'),
  schema_version   smallint NOT NULL DEFAULT 1,
  entity_type      text NOT NULL,
  entity_id        uuid NOT NULL,
  entity_version   integer NOT NULL CHECK (entity_version >= 1),
  actor_id         uuid NOT NULL REFERENCES v2.actors(id),
  authority_id     uuid REFERENCES v2.authority_grants(id),
  tenant_id        uuid NOT NULL REFERENCES v2.actors(id),
  occurred_at      timestamptz NOT NULL,
  recorded_at      timestamptz NOT NULL DEFAULT now(),
  correlation_id   uuid NOT NULL,
  causation_id     uuid REFERENCES v2.domain_events(event_id),
  idempotency_key  text NOT NULL UNIQUE,
  source_system    text NOT NULL,
  privacy_class    text NOT NULL CHECK (privacy_class IN ('public', 'tenant', 'subject', 'restricted')),
  payload          jsonb NOT NULL DEFAULT '{}',
  evidence_refs    uuid[] NOT NULL DEFAULT '{}',
  policy_decision_id uuid REFERENCES v2.policy_decisions(id)
);
CREATE INDEX domain_events_entity_idx ON v2.domain_events (entity_type, entity_id, entity_version);
CREATE INDEX domain_events_correlation_idx ON v2.domain_events (correlation_id);
CREATE INDEX domain_events_tenant_time_idx ON v2.domain_events (tenant_id, recorded_at DESC);
CREATE INDEX domain_events_actor_idx ON v2.domain_events (actor_id);
CREATE INDEX domain_events_authority_idx ON v2.domain_events (authority_id);
CREATE INDEX domain_events_causation_idx ON v2.domain_events (causation_id);
CREATE INDEX domain_events_policy_idx ON v2.domain_events (policy_decision_id);

CREATE FUNCTION v2.forbid_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END $$;
CREATE TRIGGER domain_events_append_only BEFORE UPDATE OR DELETE ON v2.domain_events
  FOR EACH ROW EXECUTE FUNCTION v2.forbid_mutation();

-- ---------------------------------------------------------------------------
-- Outbox: the only way anything leaves (webhooks, notifications, email,
-- agent triggers). Written in the same transaction as the event.
-- ---------------------------------------------------------------------------
CREATE TABLE v2.outbox (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      uuid REFERENCES v2.domain_events(event_id),
  kind          text NOT NULL CHECK (kind IN ('notify', 'webhook', 'email', 'agent_trigger', 'approval_request')),
  payload       jsonb NOT NULL DEFAULT '{}',
  attempts      smallint NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  delivered_at  timestamptz,
  parked_at     timestamptz,          -- gave up; a human looks
  last_error    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outbox_pending_idx ON v2.outbox (next_attempt_at) WHERE delivered_at IS NULL AND parked_at IS NULL;
CREATE INDEX outbox_event_idx ON v2.outbox (event_id);

-- ---------------------------------------------------------------------------
-- Demand
-- ---------------------------------------------------------------------------
CREATE TABLE v2.demands (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_org_id     uuid NOT NULL REFERENCES v2.actors(id),
  created_by_actor_id uuid NOT NULL REFERENCES v2.actors(id),
  on_behalf_of_org_id uuid REFERENCES v2.actors(id),   -- agency recruiters
  cohort_institution_id uuid REFERENCES v2.actors(id), -- cohort-only demand
  state            text NOT NULL DEFAULT 'draft'
                   CHECK (state IN ('draft','published','allocating','paused','partially_filled','filled','closed')),
  current_version  integer NOT NULL DEFAULT 1,
  v1_job_posting_id uuid UNIQUE REFERENCES public.job_postings(id),
  close_reason     text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX demands_owner_state_idx ON v2.demands (owner_org_id, state);
CREATE INDEX demands_created_by_idx ON v2.demands (created_by_actor_id);
CREATE INDEX demands_on_behalf_idx ON v2.demands (on_behalf_of_org_id);
CREATE INDEX demands_cohort_idx ON v2.demands (cohort_institution_id);

-- Every published shape of a demand is kept. Engagements point at the version
-- they were created against, so an employer rewriting the ad later does not
-- rewrite what somebody applied to.
CREATE TABLE v2.demand_versions (
  demand_id        uuid NOT NULL REFERENCES v2.demands(id),
  version          integer NOT NULL,
  title            text NOT NULL,
  intent           text NOT NULL,
  success_criteria jsonb NOT NULL DEFAULT '[]',
  requirements     jsonb NOT NULL DEFAULT '[]',   -- [{capability, must, depth, recency_months}]
  hours_per_week   numeric(5,1),
  window_start     date,
  window_end       date,
  budget_band      text,                          -- LPA or monthly INR band id
  budget_monthly_inr_max integer,
  allowed_configs  text[] NOT NULL DEFAULT '{single}',
  location_policy  jsonb NOT NULL DEFAULT '{}',
  required_evidence jsonb NOT NULL DEFAULT '[]',
  ai_filled_fields text[] NOT NULL DEFAULT '{}',
  source_snapshot_id uuid,                        -- FK added in 004
  created_by_actor_id uuid NOT NULL REFERENCES v2.actors(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (demand_id, version),
  CHECK (window_end IS NULL OR window_start IS NULL OR window_end >= window_start)
);
CREATE INDEX demand_versions_created_by_idx ON v2.demand_versions (created_by_actor_id);

CREATE TABLE v2.work_atoms (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  demand_id     uuid NOT NULL,
  demand_version integer NOT NULL,
  seq           smallint NOT NULL,
  title         text NOT NULL,
  deliverable   text NOT NULL,
  evidence_hook text,                   -- what artifact proves it's done
  capability_ids text[] NOT NULL DEFAULT '{}',
  est_hours     numeric(6,1),
  FOREIGN KEY (demand_id, demand_version) REFERENCES v2.demand_versions(demand_id, version),
  UNIQUE (demand_id, demand_version, seq)
);

CREATE TABLE v2.opportunities (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  demand_id    uuid NOT NULL REFERENCES v2.demands(id),
  visibility   text NOT NULL CHECK (visibility IN ('public', 'private_link', 'cohort_only')),
  cohort_institution_id uuid REFERENCES v2.actors(id),
  published_at timestamptz,
  unpublished_at timestamptz,
  CHECK (visibility <> 'cohort_only' OR cohort_institution_id IS NOT NULL)
);
CREATE INDEX opportunities_demand_idx ON v2.opportunities (demand_id);
CREATE INDEX opportunities_cohort_idx ON v2.opportunities (cohort_institution_id);

-- ---------------------------------------------------------------------------
-- Engagement
-- ---------------------------------------------------------------------------
CREATE TABLE v2.engagements (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  demand_id        uuid NOT NULL REFERENCES v2.demands(id),
  demand_version   integer NOT NULL,
  tenant_id        uuid NOT NULL REFERENCES v2.actors(id),  -- = demand owner org
  configuration_type text NOT NULL CHECK (configuration_type IN ('single','with_mentor','split','contractor','intern_cohort')),
  compiler_run_id  uuid,                                     -- FK added in 004
  state            text NOT NULL CHECK (state IN (
                     'discovered','prepared','submitted','screening','shortlisted','assessing','decision_pending',
                     'offered','accepted','pre_start','active','paused','completed','terminated','outcome_pending',
                     'rejected','withdrawn','declined','expired','closed')),
  version          integer NOT NULL DEFAULT 1,
  channel          text CHECK (channel IN ('native', 'external', 'institution_import')),
  resume_version_id uuid REFERENCES public.resumes(id),
  outcome_id       uuid,                                     -- FK added in 004
  close_reason     text,
  -- Blueprint §07 "Settlement": V2 records settlement STATE only; money moves outside Aco.
  settlement_state text NOT NULL DEFAULT 'not_applicable'
                   CHECK (settlement_state IN ('not_applicable','pending','payable','paid','disputed','waived')),
  terms            jsonb NOT NULL DEFAULT '{}',   -- offer/proposal terms; the legal document stays authoritative
  escalated_at     timestamptz,                   -- blueprint DISPUTED/ESCALATED is a flag, not a lifecycle state
  v1_application_id uuid UNIQUE REFERENCES public.applications(id),
  source_system    text NOT NULL DEFAULT 'aco.v2',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (demand_id, demand_version) REFERENCES v2.demand_versions(demand_id, version),
  -- The pre-accept gap V1 had: a submission that doesn't say which CV went.
  CHECK (state NOT IN ('submitted','screening','shortlisted','assessing','decision_pending','offered')
         OR channel = 'institution_import' OR source_system <> 'aco.v2' OR resume_version_id IS NOT NULL)
);
CREATE INDEX engagements_demand_state_idx ON v2.engagements (demand_id, state);
CREATE INDEX engagements_demand_version_idx ON v2.engagements (demand_id, demand_version);
CREATE INDEX engagements_tenant_state_idx ON v2.engagements (tenant_id, state);
CREATE INDEX engagements_resume_idx ON v2.engagements (resume_version_id);

CREATE TABLE v2.engagement_participants (
  engagement_id uuid NOT NULL REFERENCES v2.engagements(id),
  actor_id      uuid NOT NULL REFERENCES v2.actors(id),
  role          text NOT NULL CHECK (role IN ('primary', 'contributor', 'mentor')),
  share         numeric(4,3) NOT NULL DEFAULT 1 CHECK (share > 0 AND share <= 1),
  accepted_at   timestamptz,
  PRIMARY KEY (engagement_id, actor_id)
);
CREATE INDEX engagement_participants_actor_idx ON v2.engagement_participants (actor_id);

-- Allowed moves. Generated from the kernel.
CREATE TABLE v2.engagement_transitions_allowed (
  from_state text NOT NULL,
  to_state   text NOT NULL,
  action     text NOT NULL,
  PRIMARY KEY (from_state, to_state)
);
INSERT INTO v2.engagement_transitions_allowed (from_state, to_state, action) VALUES
  ('discovered', 'prepared', 'application.prepare'),
  ('discovered', 'withdrawn', 'engagement.withdraw'),
  ('discovered', 'expired', 'engagement.expire'),
  ('prepared', 'submitted', 'application.submit'),
  ('prepared', 'withdrawn', 'engagement.withdraw'),
  ('prepared', 'expired', 'engagement.expire'),
  ('submitted', 'screening', 'engagement.advance'),
  ('submitted', 'shortlisted', 'engagement.advance'),
  ('submitted', 'rejected', 'candidate.reject'),
  ('submitted', 'withdrawn', 'engagement.withdraw'),
  ('screening', 'shortlisted', 'engagement.advance'),
  ('screening', 'rejected', 'candidate.reject'),
  ('screening', 'withdrawn', 'engagement.withdraw'),
  ('shortlisted', 'assessing', 'engagement.advance'),
  ('shortlisted', 'decision_pending', 'engagement.advance'),
  ('shortlisted', 'rejected', 'candidate.reject'),
  ('shortlisted', 'withdrawn', 'engagement.withdraw'),
  ('assessing', 'decision_pending', 'engagement.advance'),
  ('assessing', 'rejected', 'candidate.reject'),
  ('assessing', 'withdrawn', 'engagement.withdraw'),
  ('decision_pending', 'offered', 'offer.send'),
  ('decision_pending', 'assessing', 'engagement.advance'),
  ('decision_pending', 'rejected', 'candidate.reject'),
  ('decision_pending', 'withdrawn', 'engagement.withdraw'),
  ('offered', 'accepted', 'offer.accept'),
  ('offered', 'declined', 'offer.decline'),
  ('offered', 'rejected', 'candidate.reject'),
  ('offered', 'expired', 'engagement.expire'),
  ('accepted', 'pre_start', 'engagement.prestart'),
  ('accepted', 'withdrawn', 'engagement.withdraw'),
  ('pre_start', 'active', 'engagement.activate'),
  ('pre_start', 'withdrawn', 'engagement.withdraw'),
  ('pre_start', 'terminated', 'engagement.terminate'),
  ('active', 'paused', 'engagement.pause'),
  ('active', 'completed', 'engagement.complete'),
  ('active', 'terminated', 'engagement.terminate'),
  ('paused', 'active', 'engagement.resume'),
  ('paused', 'terminated', 'engagement.terminate'),
  ('completed', 'outcome_pending', 'engagement.await_outcome'),
  ('terminated', 'outcome_pending', 'engagement.await_outcome'),
  ('outcome_pending', 'closed', 'engagement.close'),
  ('discovered', 'closed', 'engagement.close_by_demand'),
  ('prepared', 'closed', 'engagement.close_by_demand'),
  ('submitted', 'closed', 'engagement.close_by_demand'),
  ('screening', 'closed', 'engagement.close_by_demand'),
  ('shortlisted', 'closed', 'engagement.close_by_demand'),
  ('assessing', 'closed', 'engagement.close_by_demand'),
  ('decision_pending', 'closed', 'engagement.close_by_demand'),
  ('offered', 'closed', 'engagement.close_by_demand');

-- History of every move, with who and under what authority.
CREATE TABLE v2.state_transitions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type   text NOT NULL CHECK (entity_type IN ('engagement', 'demand')),
  entity_id     uuid NOT NULL,
  from_state    text,
  to_state      text NOT NULL,
  actor_id      uuid NOT NULL REFERENCES v2.actors(id),
  event_id      uuid NOT NULL REFERENCES v2.domain_events(event_id),
  changed_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX state_transitions_entity_idx ON v2.state_transitions (entity_type, entity_id, changed_at);
CREATE INDEX state_transitions_actor_idx ON v2.state_transitions (actor_id);
CREATE INDEX state_transitions_event_idx ON v2.state_transitions (event_id);

CREATE TABLE v2.approval_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id   uuid REFERENCES v2.engagements(id),
  action          text NOT NULL,
  requested_by_actor_id uuid NOT NULL REFERENCES v2.actors(id),
  approver_actor_id uuid REFERENCES v2.actors(id),
  policy_decision_id uuid NOT NULL REFERENCES v2.policy_decisions(id),
  payload         jsonb NOT NULL DEFAULT '{}',
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired')),
  expires_at      timestamptz NOT NULL DEFAULT now() + interval '7 days',
  decided_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX approval_requests_pending_idx ON v2.approval_requests (approver_actor_id, status) WHERE status = 'pending';
CREATE INDEX approval_requests_engagement_idx ON v2.approval_requests (engagement_id);
CREATE INDEX approval_requests_requested_by_idx ON v2.approval_requests (requested_by_actor_id);
CREATE INDEX approval_requests_policy_idx ON v2.approval_requests (policy_decision_id);

-- ---------------------------------------------------------------------------
-- The one way an engagement's state changes.
--
-- Caller has already run policy (the service does, via policy.js) and passes
-- the decision id. This function refuses what the lifecycle forbids, writes
-- state + history + event + outbox in the caller's transaction, and is
-- idempotent on p_idempotency_key.
--
-- Returns the event id (existing one on replay).
-- ---------------------------------------------------------------------------
CREATE FUNCTION v2.transition_engagement(
  p_engagement_id    uuid,
  p_to               text,
  p_actor_id         uuid,
  p_policy_decision_id uuid,
  p_idempotency_key  text,
  p_correlation_id   uuid,
  p_authority_id     uuid DEFAULT NULL,
  p_reason           text DEFAULT NULL,
  p_payload          jsonb DEFAULT '{}',
  p_resume_version_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SET search_path = '' AS $fn$
DECLARE
  e          v2.engagements%ROWTYPE;
  allowed    v2.engagement_transitions_allowed%ROWTYPE;
  pd         v2.policy_decisions%ROWTYPE;
  existing   uuid;
  req_hash   text := md5(concat_ws('|', p_engagement_id, p_to, p_actor_id, coalesce(p_reason, '')));
  prior_hash text;
  ev_id      uuid := gen_random_uuid();
BEGIN
  SELECT request_hash INTO prior_hash FROM v2.idempotency_keys WHERE key = p_idempotency_key;
  IF FOUND THEN
    IF prior_hash <> req_hash THEN
      RAISE EXCEPTION 'idempotency_conflict: key % reused for a different request', p_idempotency_key
        USING ERRCODE = 'unique_violation';
    END IF;
    SELECT event_id INTO existing FROM v2.domain_events WHERE idempotency_key = p_idempotency_key;
    RETURN existing;
  END IF;

  SELECT * INTO e FROM v2.engagements WHERE id = p_engagement_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'no_data_found'; END IF;

  SELECT * INTO allowed FROM v2.engagement_transitions_allowed WHERE from_state = e.state AND to_state = p_to;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_transition: % -> %', e.state, p_to USING ERRCODE = 'check_violation';
  END IF;
  IF allowed.action = 'engagement.close_by_demand' AND coalesce(p_reason, '') <> 'demand_closed' THEN
    RAISE EXCEPTION 'invalid_transition: % -> closed needs reason demand_closed', e.state USING ERRCODE = 'check_violation';
  END IF;

  -- The loop only closes through an outcome or a named waiver (stateMachine.js guard).
  IF e.state = 'outcome_pending' AND p_to = 'closed' AND e.outcome_id IS NULL
     AND coalesce(p_reason, '') NOT IN ('waived:counterpart_unreachable','waived:engagement_too_short_to_measure',
                                        'waived:subject_declined_measurement','waived:legal_hold') THEN
    RAISE EXCEPTION 'outcome_required' USING ERRCODE = 'check_violation';
  END IF;

  -- Acceptance needs every non-mentor participant.
  IF p_to = 'accepted' AND EXISTS (
       SELECT 1 FROM v2.engagement_participants
        WHERE engagement_id = e.id AND role <> 'mentor' AND accepted_at IS NULL) THEN
    RAISE EXCEPTION 'acceptance_pending' USING ERRCODE = 'check_violation';
  END IF;

  -- No policy decision, or one that did not allow this, means no move.
  SELECT * INTO pd FROM v2.policy_decisions WHERE id = p_policy_decision_id;
  IF NOT FOUND OR pd.result <> 'allow' THEN
    RAISE EXCEPTION 'policy_not_allowing: decision % is %', p_policy_decision_id, coalesce(pd.result, 'missing')
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT (pd.action = allowed.action
          OR (allowed.action = 'application.submit'
              AND pd.action IN ('application.submit.native', 'application.submit.external'))) THEN
    RAISE EXCEPTION 'policy_action_mismatch: decision is for %, move needs %', pd.action, allowed.action
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO v2.domain_events (event_id, event_type, entity_type, entity_id, entity_version, actor_id, authority_id,
                                tenant_id, occurred_at, correlation_id, idempotency_key, source_system, privacy_class,
                                payload, policy_decision_id)
  VALUES (ev_id, 'EngagementTransitioned', 'engagement', e.id, e.version + 1, p_actor_id, p_authority_id,
          e.tenant_id, now(), p_correlation_id, p_idempotency_key, 'aco.v2', 'tenant',
          p_payload || jsonb_build_object('from', e.state, 'to', p_to, 'action', allowed.action, 'reason', p_reason),
          p_policy_decision_id);

  UPDATE v2.engagements
     SET state = p_to, version = version + 1, updated_at = now(),
         close_reason = CASE WHEN p_to = 'closed' THEN coalesce(p_reason, 'outcome_recorded') ELSE close_reason END,
         resume_version_id = CASE WHEN p_to = 'submitted' THEN coalesce(p_resume_version_id, resume_version_id)
                                  ELSE resume_version_id END,
         channel = CASE WHEN p_to = 'submitted' AND pd.action = 'application.submit.native' THEN 'native'
                        WHEN p_to = 'submitted' AND pd.action = 'application.submit.external' THEN 'external'
                        ELSE channel END
   WHERE id = e.id;

  INSERT INTO v2.state_transitions (entity_type, entity_id, from_state, to_state, actor_id, event_id)
  VALUES ('engagement', e.id, e.state, p_to, p_actor_id, ev_id);

  INSERT INTO v2.outbox (event_id, kind, payload)
  VALUES (ev_id, 'notify', jsonb_build_object('template', 'engagement_' || p_to, 'engagement_id', e.id));

  INSERT INTO v2.idempotency_keys (key, scope, request_hash, response)
  VALUES (p_idempotency_key, 'engagement.transition', req_hash, jsonb_build_object('event_id', ev_id));

  RETURN ev_id;
END
$fn$;

-- ---------------------------------------------------------------------------
-- Closing a demand closes its pre-accept engagements in the same transaction.
-- (The V1 failure: 22 tracker rows pointing at postings that no longer exist.)
-- ---------------------------------------------------------------------------
CREATE FUNCTION v2.close_demand(
  p_demand_id uuid, p_actor_id uuid, p_policy_decision_id uuid, p_idempotency_key text, p_correlation_id uuid,
  p_reason text DEFAULT 'closed_by_owner'
) RETURNS integer
LANGUAGE plpgsql SET search_path = '' AS $fn$
DECLARE
  d  v2.demands%ROWTYPE;
  ev uuid := gen_random_uuid();
  sys_pd uuid;
  r  record;
  n  integer := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM v2.idempotency_keys WHERE key = p_idempotency_key) THEN
    SELECT (response->>'cascaded')::int INTO n FROM v2.idempotency_keys WHERE key = p_idempotency_key;
    RETURN n;
  END IF;
  SELECT * INTO d FROM v2.demands WHERE id = p_demand_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'no_data_found'; END IF;
  IF d.state = 'closed' THEN RAISE EXCEPTION 'invalid_transition: demand already closed' USING ERRCODE = 'check_violation'; END IF;
  IF NOT EXISTS (SELECT 1 FROM v2.policy_decisions WHERE id = p_policy_decision_id AND result = 'allow' AND action = 'demand.close') THEN
    RAISE EXCEPTION 'policy_not_allowing' USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO v2.domain_events (event_id, event_type, entity_type, entity_id, entity_version, actor_id, tenant_id,
                                occurred_at, correlation_id, idempotency_key, source_system, privacy_class, payload,
                                policy_decision_id)
  VALUES (ev, 'DemandClosed', 'demand', d.id, d.current_version + 1, p_actor_id, d.owner_org_id, now(),
          p_correlation_id, p_idempotency_key, 'aco.v2', 'tenant',
          jsonb_build_object('from', d.state, 'reason', p_reason), p_policy_decision_id);
  UPDATE v2.demands SET state = 'closed', current_version = current_version + 1, close_reason = p_reason, updated_at = now()
   WHERE id = d.id;
  INSERT INTO v2.state_transitions (entity_type, entity_id, from_state, to_state, actor_id, event_id)
  VALUES ('demand', d.id, d.state, 'closed', p_actor_id, ev);

  -- The platform performs the cascade, under its own recorded decision.
  INSERT INTO v2.policy_decisions (action, actor_id, result, reason, level, policy_version)
  VALUES ('engagement.close_by_demand', '00000000-0000-0000-0000-000000000001', 'allow', 'system_action', 5, 'policy@2.0.0')
  RETURNING id INTO sys_pd;

  FOR r IN
    SELECT e.id FROM v2.engagements e
      JOIN v2.engagement_transitions_allowed t ON t.from_state = e.state AND t.to_state = 'closed'
                                              AND t.action = 'engagement.close_by_demand'
     WHERE e.demand_id = d.id
     ORDER BY e.id
  LOOP
    PERFORM v2.transition_engagement(r.id, 'closed', '00000000-0000-0000-0000-000000000001', sys_pd,
                                     p_idempotency_key || ':cascade:' || r.id, p_correlation_id, NULL, 'demand_closed');
    n := n + 1;
  END LOOP;

  INSERT INTO v2.idempotency_keys (key, scope, request_hash, response)
  VALUES (p_idempotency_key, 'demand.close', md5(p_demand_id::text), jsonb_build_object('cascaded', n));
  RETURN n;
END
$fn$;
