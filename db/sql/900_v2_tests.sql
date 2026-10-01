-- ============================================================================
-- Behavioural tests for 001..006. Run on a throwaway database after
-- 000 (stub) + 001..006:
--
--   psql -v ON_ERROR_STOP=1 -f 900_v2_tests.sql
--
-- Every block raises on failure. Last line prints "ALL V2 SQL TESTS PASSED".
-- Runs inside one transaction and rolls back, so it leaves nothing behind.
-- ============================================================================
BEGIN;

CREATE TEMP TABLE t_ids (k text PRIMARY KEY, v uuid);
CREATE FUNCTION pg_temp.id(k text) RETURNS uuid LANGUAGE sql AS $$ SELECT v FROM t_ids WHERE t_ids.k = $1 $$;

-- ---------- fixtures: V1 rows, then V2 actors via the backfill ----------
DO $$
DECLARE u_meera uuid; u_priya uuid; u_mentor uuid; u_kiran uuid; co uuid; inst uuid; jp uuid; res uuid;
BEGIN
  INSERT INTO public.users (email, full_name, role) VALUES ('meera@example.test', 'Meera', 'recruiter') RETURNING id INTO u_meera;
  INSERT INTO public.users (email, full_name, role) VALUES ('priya@example.test', 'Priya', 'job_seeker') RETURNING id INTO u_priya;
  INSERT INTO public.users (email, full_name, role) VALUES ('mentor@example.test', 'Meenakshi', 'job_seeker') RETURNING id INTO u_mentor;
  INSERT INTO public.users (email, full_name, role) VALUES ('kiran@example.test', 'Kiran', 'job_seeker') RETURNING id INTO u_kiran;
  INSERT INTO public.companies (owner_id, name) VALUES (u_meera, 'Kesar Foods') RETURNING id INTO co;
  INSERT INTO public.institutions (owner_id, name) VALUES (u_meera, 'Demo College') RETURNING id INTO inst;
  INSERT INTO public.institution_students (institution_id, full_name, status, claimed_by_user_id, consent_given, consent_at)
    VALUES (inst, 'Priya', 'claimed', u_priya, true, now()), (inst, 'Kiran', 'claimed', u_kiran, false, NULL);
  INSERT INTO public.job_postings (company_id, created_by, title) VALUES (co, u_meera, 'Growth intern') RETURNING id INTO jp;
  INSERT INTO public.jobs (user_id, title, company, status, source, job_posting_id)
    VALUES (u_priya, 'Deleted role', 'Gone Ltd', 'applied', 'application', NULL);
  INSERT INTO public.resumes (user_id, raw_text) VALUES (u_priya, 'resume') RETURNING id INTO res;
  INSERT INTO t_ids VALUES ('u_priya', u_priya), ('u_kiran', u_kiran), ('co', co), ('inst', inst), ('jp', jp), ('res', res),
                           ('u_meera', u_meera), ('u_mentor', u_mentor);
END $$;

-- T1 backfill is dry-run by default and idempotent
DO $$
DECLARE r record; n int;
BEGIN
  SELECT sum(would_create) INTO n FROM v2.backfill_actors();
  IF n <> 6 THEN RAISE EXCEPTION 'T1 dry run expected 6, got %', n; END IF;
  IF EXISTS (SELECT 1 FROM v2.actors WHERE v1_user_id IS NOT NULL) THEN RAISE EXCEPTION 'T1 dry run wrote rows'; END IF;
  PERFORM v2.backfill_actors(false);
  SELECT sum(would_create) INTO n FROM v2.backfill_actors(false);
  IF n <> 0 THEN RAISE EXCEPTION 'T1 second run should create nothing, got %', n; END IF;
  RAISE NOTICE 'T1 ok: backfill dry-run + idempotent';
END $$;

INSERT INTO t_ids
SELECT 'a_priya', id FROM v2.actors WHERE v1_user_id = pg_temp.id('u_priya') UNION ALL
SELECT 'a_kiran', id FROM v2.actors WHERE v1_user_id = pg_temp.id('u_kiran') UNION ALL
SELECT 'a_meera', id FROM v2.actors WHERE v1_user_id = pg_temp.id('u_meera') UNION ALL
SELECT 'a_mentor', id FROM v2.actors WHERE v1_user_id = pg_temp.id('u_mentor') UNION ALL
SELECT 'a_co', id FROM v2.actors WHERE v1_company_id = pg_temp.id('co') UNION ALL
SELECT 'a_inst', id FROM v2.actors WHERE v1_institution_id = pg_temp.id('inst') UNION ALL
SELECT 'a_agent', id FROM v2.actors WHERE agent_code = 'agent:application';

-- T2 consent backfill carries V1's gate exactly: Priya yes, Kiran no
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM v2.backfill_student_consents(false);
  IF r.created <> 1 THEN RAISE EXCEPTION 'T2 expected 1 consent, got %', r.created; END IF;
  IF EXISTS (SELECT 1 FROM v2.consents WHERE subject_actor_id = pg_temp.id('a_kiran')) THEN
    RAISE EXCEPTION 'T2 non-consenting student got a consent row';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM v2.consents WHERE subject_actor_id = pg_temp.id('a_priya')
                  AND audience = 'institution:' || pg_temp.id('a_inst')) THEN
    RAISE EXCEPTION 'T2 audience should be the institution only';
  END IF;
  RAISE NOTICE 'T2 ok: consent gate preserved';
END $$;

-- T3 orphan report finds the V1 failure case
DO $$ BEGIN
  IF (SELECT count(*) FROM v2.report_v1_orphaned_tracker_rows) <> 1 THEN RAISE EXCEPTION 'T3 orphan report'; END IF;
  RAISE NOTICE 'T3 ok: orphaned tracker rows reported';
END $$;

-- ---------- demand + engagement fixtures ----------
DO $$
DECLARE d uuid; e uuid; e2 uuid;
BEGIN
  INSERT INTO v2.demands (owner_org_id, created_by_actor_id, state, v1_job_posting_id)
    VALUES (pg_temp.id('a_co'), pg_temp.id('a_meera'), 'published', pg_temp.id('jp')) RETURNING id INTO d;
  INSERT INTO v2.demand_versions (demand_id, version, title, intent, created_by_actor_id, hours_per_week, window_start, window_end)
    VALUES (d, 1, 'Growth intern', 'Build outbound', pg_temp.id('a_meera'), 30, '2026-11-01', '2027-01-31');
  INSERT INTO v2.engagements (demand_id, demand_version, tenant_id, configuration_type, state)
    VALUES (d, 1, pg_temp.id('a_co'), 'with_mentor', 'prepared') RETURNING id INTO e;
  INSERT INTO v2.engagement_participants (engagement_id, actor_id, role) VALUES
    (e, pg_temp.id('a_priya'), 'primary'), (e, pg_temp.id('a_mentor'), 'mentor');
  INSERT INTO v2.engagements (demand_id, demand_version, tenant_id, configuration_type, state)
    VALUES (d, 1, pg_temp.id('a_co'), 'single', 'discovered') RETURNING id INTO e2;
  INSERT INTO v2.engagement_participants (engagement_id, actor_id, role) VALUES (e2, pg_temp.id('a_kiran'), 'primary');
  INSERT INTO t_ids VALUES ('d', d), ('e', e), ('e2', e2);
END $$;

CREATE FUNCTION pg_temp.allow(p_action text, p_actor uuid) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO v2.policy_decisions (action, actor_id, result, reason, level, policy_version)
  VALUES (p_action, p_actor, 'allow', 'test', 6, 'policy@2.0.0') RETURNING id $$;

-- T4 an illegal move is refused and changes nothing
DO $$
BEGIN
  BEGIN
    PERFORM v2.transition_engagement(pg_temp.id('e'), 'active', pg_temp.id('a_meera'),
      pg_temp.allow('engagement.activate', pg_temp.id('a_meera')), 't4', gen_random_uuid());
    RAISE EXCEPTION 'T4 illegal move was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF (SELECT state FROM v2.engagements WHERE id = pg_temp.id('e')) <> 'prepared' THEN RAISE EXCEPTION 'T4 state changed'; END IF;
  RAISE NOTICE 'T4 ok: invalid transition refused';
END $$;

-- T5 no policy allow, no move; wrong action, no move
DO $$
DECLARE deny uuid;
BEGIN
  INSERT INTO v2.policy_decisions (action, actor_id, result, reason, policy_version)
    VALUES ('application.submit.native', pg_temp.id('a_agent'), 'require_approval', 'approve_to_execute', 'policy@2.0.0')
    RETURNING id INTO deny;
  BEGIN
    PERFORM v2.transition_engagement(pg_temp.id('e'), 'submitted', pg_temp.id('a_agent'), deny, 't5a', gen_random_uuid(),
                                     NULL, NULL, '{}', pg_temp.id('res'));
    RAISE EXCEPTION 'T5 moved without allow';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM v2.transition_engagement(pg_temp.id('e'), 'submitted', pg_temp.id('a_agent'),
      pg_temp.allow('offer.send', pg_temp.id('a_agent')), 't5b', gen_random_uuid(), NULL, NULL, '{}', pg_temp.id('res'));
    RAISE EXCEPTION 'T5 moved under a decision for a different action';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'T5 ok: policy decision required and must match the action';
END $$;

-- T6 submission must pin a resume version (table constraint)
DO $$
BEGIN
  BEGIN
    PERFORM v2.transition_engagement(pg_temp.id('e'), 'submitted', pg_temp.id('a_agent'),
      pg_temp.allow('application.submit.native', pg_temp.id('a_agent')), 't6', gen_random_uuid());
    RAISE EXCEPTION 'T6 submitted without a resume version';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'T6 ok: resume version required on submit';
END $$;

-- T7 idempotency: same key twice = one event; same key, different request = refused
DO $$
DECLARE ev1 uuid; ev2 uuid; pd uuid := pg_temp.allow('application.submit.native', pg_temp.id('a_agent')); c int;
BEGIN
  ev1 := v2.transition_engagement(pg_temp.id('e'), 'submitted', pg_temp.id('a_agent'), pd, 't7', gen_random_uuid(),
                                  NULL, NULL, '{}', pg_temp.id('res'));
  ev2 := v2.transition_engagement(pg_temp.id('e'), 'submitted', pg_temp.id('a_agent'), pd, 't7', gen_random_uuid(),
                                  NULL, NULL, '{}', pg_temp.id('res'));
  IF ev1 <> ev2 THEN RAISE EXCEPTION 'T7 replay returned a different event'; END IF;
  SELECT count(*) INTO c FROM v2.domain_events WHERE idempotency_key = 't7';
  IF c <> 1 THEN RAISE EXCEPTION 'T7 expected 1 event, got %', c; END IF;
  IF (SELECT channel FROM v2.engagements WHERE id = pg_temp.id('e')) <> 'native' THEN RAISE EXCEPTION 'T7 channel not set'; END IF;
  BEGIN
    PERFORM v2.transition_engagement(pg_temp.id('e'), 'withdrawn', pg_temp.id('a_priya'), pd, 't7', gen_random_uuid());
    RAISE EXCEPTION 'T7 key reuse accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  RAISE NOTICE 'T7 ok: idempotent, and key reuse refused';
END $$;

-- T8 event log is append-only
DO $$
BEGIN
  BEGIN
    UPDATE v2.domain_events SET payload = '{}' WHERE idempotency_key = 't7';
    RAISE EXCEPTION 'T8 event was updated';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    DELETE FROM v2.domain_events WHERE idempotency_key = 't7';
    RAISE EXCEPTION 'T8 event was deleted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'T8 ok: domain_events append-only';
END $$;

-- T9 acceptance needs every non-mentor participant; mentor not required
DO $$
DECLARE m uuid := pg_temp.id('a_meera'); e uuid := pg_temp.id('e');
BEGIN
  PERFORM v2.transition_engagement(e, 'shortlisted', m, pg_temp.allow('engagement.advance', m), 't9a', gen_random_uuid());
  PERFORM v2.transition_engagement(e, 'decision_pending', m, pg_temp.allow('engagement.advance', m), 't9b', gen_random_uuid());
  PERFORM v2.transition_engagement(e, 'offered', m, pg_temp.allow('offer.send', m), 't9c', gen_random_uuid());
  BEGIN
    PERFORM v2.transition_engagement(e, 'accepted', pg_temp.id('a_priya'), pg_temp.allow('offer.accept', pg_temp.id('a_priya')), 't9d', gen_random_uuid());
    RAISE EXCEPTION 'T9 accepted without participant acceptance';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  UPDATE v2.engagement_participants SET accepted_at = now() WHERE engagement_id = e AND role = 'primary';
  PERFORM v2.transition_engagement(e, 'accepted', pg_temp.id('a_priya'), pg_temp.allow('offer.accept', pg_temp.id('a_priya')), 't9e', gen_random_uuid());
  RAISE NOTICE 'T9 ok: acceptance gated on participants (mentor exempt)';
END $$;

-- T10 hard capacity backstop
DO $$
DECLARE cap uuid; d uuid := pg_temp.id('d'); e uuid := pg_temp.id('e');
BEGIN
  INSERT INTO v2.capacity_records (person_actor_id, weekly_hours, committed_hours, available_from)
    VALUES (pg_temp.id('a_priya'), 40, 0, '2026-11-01') RETURNING id INTO cap;
  INSERT INTO v2.capacity_reservations (capacity_id, demand_id, engagement_id, state, hours_per_week, period, owner_actor_id)
    VALUES (cap, d, e, 'hard', 30, tstzrange('2026-11-01', '2027-01-01'), pg_temp.id('a_meera'));
  BEGIN
    INSERT INTO v2.capacity_reservations (capacity_id, demand_id, engagement_id, state, hours_per_week, period, owner_actor_id)
      VALUES (cap, d, e, 'hard', 30, tstzrange('2026-12-01', '2027-02-01'), pg_temp.id('a_meera'));
    RAISE EXCEPTION 'T10 overlapping hard reservation accepted';
  EXCEPTION WHEN exclusion_violation THEN NULL;
  END;
  -- after the first ends, fine
  INSERT INTO v2.capacity_reservations (capacity_id, demand_id, engagement_id, state, hours_per_week, period, owner_actor_id)
    VALUES (cap, d, e, 'hard', 30, tstzrange('2027-01-01', '2027-02-01'), pg_temp.id('a_meera'));
  RAISE NOTICE 'T10 ok: hard capacity never over-promised';
END $$;

-- T11 no self-attestation
DO $$
DECLARE art uuid;
BEGIN
  INSERT INTO v2.evidence_artifacts (subject_actor_id, class, kind, title, observed_at, source_system, created_by_actor_id)
    VALUES (pg_temp.id('a_priya'), 'work_artifact', 'deliverable', 'CRM setup', now(), 'aco.v2', pg_temp.id('a_priya'))
    RETURNING id INTO art;
  BEGIN
    INSERT INTO v2.evidence_attestations (artifact_id, attester_actor_id, capacity, authorized)
      VALUES (art, pg_temp.id('a_priya'), 'mentor', true);
    RAISE EXCEPTION 'T11 self attestation accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  INSERT INTO v2.evidence_attestations (artifact_id, attester_actor_id, capacity, authorized)
    VALUES (art, pg_temp.id('a_mentor'), 'mentor', true);
  RAISE NOTICE 'T11 ok: self-attestation refused, mentor attestation accepted';
END $$;

-- T12 the loop can't close without outcome or waiver
DO $$
DECLARE m uuid := pg_temp.id('a_meera'); e uuid := pg_temp.id('e'); o uuid;
BEGIN
  PERFORM v2.transition_engagement(e, 'pre_start', m, pg_temp.allow('engagement.prestart', m), 't12a', gen_random_uuid());
  PERFORM v2.transition_engagement(e, 'active', m, pg_temp.allow('engagement.activate', m), 't12b', gen_random_uuid());
  PERFORM v2.transition_engagement(e, 'completed', m, pg_temp.allow('engagement.complete', m), 't12c', gen_random_uuid());
  PERFORM v2.transition_engagement(e, 'outcome_pending', m, pg_temp.allow('engagement.await_outcome', m), 't12d', gen_random_uuid());
  BEGIN
    PERFORM v2.transition_engagement(e, 'closed', m, pg_temp.allow('engagement.close', m), 't12e', gen_random_uuid());
    RAISE EXCEPTION 'T12 closed without outcome';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  INSERT INTO v2.outcomes (engagement_id, kind, actual, result, attribution_confidence, confirmed_by_actor_id)
    VALUES (e, 'internship_result', '{"leads":412}', 'met', 'medium', m) RETURNING id INTO o;
  UPDATE v2.engagements SET outcome_id = o WHERE id = e;
  PERFORM v2.transition_engagement(e, 'closed', m, pg_temp.allow('engagement.close', m), 't12f', gen_random_uuid());
  RAISE NOTICE 'T12 ok: outcome required to close the loop';
END $$;

-- T13 closing the demand closes pre-accept engagements only, atomically
DO $$
DECLARE n int;
BEGIN
  n := v2.close_demand(pg_temp.id('d'), pg_temp.id('a_meera'), pg_temp.allow('demand.close', pg_temp.id('a_meera')),
                       't13', gen_random_uuid());
  IF n <> 1 THEN RAISE EXCEPTION 'T13 expected 1 cascaded, got %', n; END IF;
  IF (SELECT state || '/' || close_reason FROM v2.engagements WHERE id = pg_temp.id('e2')) <> 'closed/demand_closed' THEN
    RAISE EXCEPTION 'T13 open engagement not closed with reason';
  END IF;
  IF (SELECT close_reason FROM v2.engagements WHERE id = pg_temp.id('e')) <> 'outcome_recorded' THEN
    RAISE EXCEPTION 'T13 finished engagement was touched';
  END IF;
  IF v2.close_demand(pg_temp.id('d'), pg_temp.id('a_meera'), NULL, 't13', gen_random_uuid()) <> 1 THEN
    RAISE EXCEPTION 'T13 replay not idempotent';
  END IF;
  RAISE NOTICE 'T13 ok: demand close cascades atomically and idempotently';
END $$;

-- T14 compat views speak V1's vocabulary
DO $$
BEGIN
  IF (SELECT status FROM v2.compat_seeker_jobs WHERE id = pg_temp.id('e2')) <> 'rejected' THEN RAISE EXCEPTION 'T14 closed-by-demand'; END IF;
  IF (SELECT status FROM v2.compat_seeker_jobs WHERE id = pg_temp.id('e')) <> 'offer' THEN RAISE EXCEPTION 'T14 completed hire'; END IF;
  IF EXISTS (SELECT 1 FROM v2.compat_seeker_jobs j WHERE j.status NOT IN ('saved','applied','interviewing','offer','rejected','withdrawn')) THEN
    RAISE EXCEPTION 'T14 non-V1 status leaked';
  END IF;
  IF EXISTS (SELECT 1 FROM v2.compat_seeker_jobs WHERE user_id = pg_temp.id('u_mentor')) THEN
    RAISE EXCEPTION 'T14 mentor shown as applicant';
  END IF;
  RAISE NOTICE 'T14 ok: V1 compatibility views';
END $$;

-- T15 replay parity: rebuilding state from events equals the table
DO $$
DECLARE bad int;
BEGIN
  WITH last AS (
    SELECT DISTINCT ON (entity_id) entity_id, payload->>'to' AS state, entity_version
      FROM v2.domain_events WHERE entity_type = 'engagement' AND event_type = 'EngagementTransitioned'
     ORDER BY entity_id, entity_version DESC)
  SELECT count(*) INTO bad FROM last JOIN v2.engagements e ON e.id = last.entity_id
   WHERE e.state <> last.state OR e.version <> last.entity_version;
  IF bad <> 0 THEN RAISE EXCEPTION 'T15 % engagements disagree with their events', bad; END IF;
  -- every transition event carries a policy decision (0 bypasses)
  IF EXISTS (SELECT 1 FROM v2.domain_events WHERE event_type = 'EngagementTransitioned' AND policy_decision_id IS NULL) THEN
    RAISE EXCEPTION 'T15 transition without policy decision';
  END IF;
  -- every transition wrote history and an outbox row
  IF EXISTS (SELECT 1 FROM v2.domain_events ev WHERE event_type = 'EngagementTransitioned'
               AND (NOT EXISTS (SELECT 1 FROM v2.state_transitions s WHERE s.event_id = ev.event_id)
                 OR NOT EXISTS (SELECT 1 FROM v2.outbox o WHERE o.event_id = ev.event_id))) THEN
    RAISE EXCEPTION 'T15 event without history/outbox';
  END IF;
  RAISE NOTICE 'T15 ok: replay parity, 0 policy bypasses, outbox complete';
END $$;

-- T16 kill switch: system off → agent jobs not claimed, plain jobs are
DO $$
DECLARE n_agent int; n_plain int;
BEGIN
  INSERT INTO v2.jobs (kind, agent_code) VALUES ('seeker.apply', 'agent:application');
  INSERT INTO v2.jobs (kind) VALUES ('outbox.deliver');
  SELECT count(*) FILTER (WHERE agent_code IS NOT NULL), count(*) FILTER (WHERE agent_code IS NULL)
    INTO n_agent, n_plain FROM v2.claim_jobs('w1', 10);
  IF n_agent <> 0 OR n_plain <> 1 THEN RAISE EXCEPTION 'T16 off: agent %, plain %', n_agent, n_plain; END IF;
  UPDATE v2.agent_switches SET enabled = true WHERE scope = 'system';
  SELECT count(*) INTO n_agent FROM v2.claim_jobs('w1', 10);
  IF n_agent <> 1 THEN RAISE EXCEPTION 'T16 on: expected 1, got %', n_agent; END IF;
  RAISE NOTICE 'T16 ok: kill switch respected by job claiming';
END $$;

-- T17 security posture
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'v2' AND NOT rowsecurity) THEN RAISE EXCEPTION 'T17 table without RLS'; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.role_table_grants
              WHERE table_schema = 'v2' AND grantee IN ('anon', 'authenticated', 'PUBLIC')) THEN
    RAISE EXCEPTION 'T17 grant to anon/authenticated/PUBLIC';
  END IF;
  IF has_schema_privilege('anon', 'v2', 'USAGE') OR has_schema_privilege('authenticated', 'v2', 'USAGE') THEN
    RAISE EXCEPTION 'T17 schema usage granted';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'v2' AND (has_function_privilege('anon', p.oid, 'EXECUTE')
                                       OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))) THEN
    RAISE EXCEPTION 'T17 function executable by anon/authenticated';
  END IF;
  RAISE NOTICE 'T17 ok: deny-all posture';
END $$;

-- T18 every FK in v2 has an index whose leading column(s) match
DO $$
DECLARE missing text;
BEGIN
  SELECT string_agg(c.conrelid::regclass || '(' || c.conkey::text || ')', ', ') INTO missing
    FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
   WHERE c.contype = 'f' AND n.nspname = 'v2'
     AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid
                       AND (i.indkey::int2[])[0:array_length(c.conkey,1)-1] = c.conkey);
  IF missing IS NOT NULL THEN RAISE EXCEPTION 'T18 unindexed FKs: %', missing; END IF;
  RAISE NOTICE 'T18 ok: all FKs indexed';
END $$;

SELECT 'ALL V2 SQL TESTS PASSED' AS result;
ROLLBACK;
