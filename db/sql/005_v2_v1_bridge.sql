-- ============================================================================
-- Bridge between V1 and V2.
--
--  1. Status maps as tables (so SQL and code share one vocabulary; generated
--     from states.js and asserted equal by the test file).
--  2. Compatibility views: what the V1 seeker board and recruiter pipeline
--     read once their domain cuts over.
--  3. Backfill functions: idempotent, dry-run by default, report what they
--     would do. They READ V1 and WRITE only to v2.*.
--
-- Nothing here alters or deletes a V1 row.
-- ============================================================================

CREATE TABLE v2.v1_status_map (
  v1_table  text NOT NULL CHECK (v1_table IN ('jobs', 'applications')),
  v1_status text NOT NULL,
  v2_state  text NOT NULL,
  PRIMARY KEY (v1_table, v1_status)
);
INSERT INTO v2.v1_status_map VALUES
  ('jobs', 'saved', 'discovered'), ('jobs', 'applied', 'submitted'), ('jobs', 'interviewing', 'assessing'),
  ('jobs', 'offer', 'offered'), ('jobs', 'rejected', 'rejected'), ('jobs', 'withdrawn', 'withdrawn'),
  ('applications', 'submitted', 'submitted'), ('applications', 'screening', 'screening'),
  ('applications', 'shortlisted', 'shortlisted'), ('applications', 'interviewing', 'assessing'),
  ('applications', 'offer', 'offered'), ('applications', 'rejected', 'rejected'), ('applications', 'hired', 'accepted');

-- V2 → V1 job-tracker word (states.js v1JobsStatusFor).
CREATE FUNCTION v2.v1_jobs_status(p_state text, p_close_reason text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN p_state = 'closed' AND p_close_reason = 'demand_closed' THEN 'rejected'
    WHEN p_state = 'closed' THEN 'offer'
    WHEN p_state IN ('discovered', 'prepared') THEN 'saved'
    WHEN p_state IN ('submitted', 'screening') THEN 'applied'
    WHEN p_state IN ('shortlisted', 'assessing', 'decision_pending') THEN 'interviewing'
    WHEN p_state IN ('offered', 'accepted', 'pre_start', 'active', 'paused', 'completed', 'terminated', 'outcome_pending') THEN 'offer'
    WHEN p_state IN ('rejected', 'expired') THEN 'rejected'
    WHEN p_state IN ('withdrawn', 'declined') THEN 'withdrawn'
  END
$$;

-- Seeker board, V1 shape, one row per engagement the person is a participant in.
CREATE VIEW v2.compat_seeker_jobs AS
SELECT e.id                                        AS id,
       a.v1_user_id                                AS user_id,
       dv.title                                    AS title,
       coalesce(org.display_name, 'Unlisted company') AS company,
       v2.v1_jobs_status(e.state, e.close_reason)  AS status,
       'application'::text                         AS source,
       d.v1_job_posting_id                         AS job_posting_id,
       e.state                                     AS v2_state,
       e.close_reason                              AS v2_close_reason,
       e.created_at, e.updated_at
  FROM v2.engagements e
  JOIN v2.engagement_participants p ON p.engagement_id = e.id AND p.role <> 'mentor'
  JOIN v2.actors a ON a.id = p.actor_id AND a.v1_user_id IS NOT NULL
  JOIN v2.demands d ON d.id = e.demand_id
  JOIN v2.demand_versions dv ON dv.demand_id = e.demand_id AND dv.version = e.demand_version
  LEFT JOIN v2.actors org ON org.id = d.owner_org_id;

-- Recruiter pipeline, V1 applications shape (pre-hire states only, as V1 had).
CREATE VIEW v2.compat_recruiter_applications AS
SELECT e.id                                     AS id,
       d.v1_job_posting_id                      AS job_posting_id,
       a.v1_user_id                             AS applicant_id,
       CASE e.state
         WHEN 'submitted' THEN 'submitted' WHEN 'screening' THEN 'screening' WHEN 'shortlisted' THEN 'shortlisted'
         WHEN 'assessing' THEN 'interviewing' WHEN 'decision_pending' THEN 'interviewing'
         WHEN 'offered' THEN 'offer' WHEN 'rejected' THEN 'rejected'
         ELSE 'hired' END                       AS status,
       e.state                                  AS v2_state,
       e.created_at, e.updated_at
  FROM v2.engagements e
  JOIN v2.engagement_participants p ON p.engagement_id = e.id AND p.role = 'primary'
  JOIN v2.actors a ON a.id = p.actor_id
  JOIN v2.demands d ON d.id = e.demand_id
 WHERE e.state NOT IN ('discovered', 'prepared', 'withdrawn', 'declined', 'expired');

-- ---------------------------------------------------------------------------
-- Backfill: actors for V1 users, companies, institutions.
-- ---------------------------------------------------------------------------
CREATE FUNCTION v2.backfill_actors(p_dry_run boolean DEFAULT true)
RETURNS TABLE (entity text, would_create integer, created integer)
LANGUAGE plpgsql SET search_path = '' AS $fn$
DECLARE u int; c int; i int;
BEGIN
  SELECT count(*) INTO u FROM public.users x WHERE x.deleted_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM v2.actors a WHERE a.v1_user_id = x.id);
  SELECT count(*) INTO c FROM public.companies x
   WHERE NOT EXISTS (SELECT 1 FROM v2.actors a WHERE a.v1_company_id = x.id);
  SELECT count(*) INTO i FROM public.institutions x
   WHERE NOT EXISTS (SELECT 1 FROM v2.actors a WHERE a.v1_institution_id = x.id);
  IF NOT p_dry_run THEN
    INSERT INTO v2.actors (kind, display_name, v1_user_id)
    SELECT 'person', coalesce(x.full_name, split_part(x.email, '@', 1)), x.id FROM public.users x
     WHERE x.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM v2.actors a WHERE a.v1_user_id = x.id);
    INSERT INTO v2.actors (kind, display_name, org_type, v1_company_id)
    SELECT 'organization', x.name, 'company', x.id FROM public.companies x
     WHERE NOT EXISTS (SELECT 1 FROM v2.actors a WHERE a.v1_company_id = x.id);
    INSERT INTO v2.actors (kind, display_name, org_type, v1_institution_id)
    SELECT 'organization', x.name, 'institution', x.id FROM public.institutions x
     WHERE NOT EXISTS (SELECT 1 FROM v2.actors a WHERE a.v1_institution_id = x.id);
  END IF;
  RETURN QUERY VALUES ('users', u, CASE WHEN p_dry_run THEN 0 ELSE u END),
                      ('companies', c, CASE WHEN p_dry_run THEN 0 ELSE c END),
                      ('institutions', i, CASE WHEN p_dry_run THEN 0 ELSE i END);
END
$fn$;

-- ---------------------------------------------------------------------------
-- Backfill: consent from the V1 roster. Only rows that pass V1's own gate
-- (claimed AND consent_given AND not deleted) become consents, with audience
-- = that institution. Nobody is widened to "all recruiters" by a migration.
-- ---------------------------------------------------------------------------
CREATE FUNCTION v2.backfill_student_consents(p_dry_run boolean DEFAULT true)
RETURNS TABLE (eligible integer, created integer)
LANGUAGE plpgsql SET search_path = '' AS $fn$
DECLARE n int; m int := 0;
BEGIN
  SELECT count(*) INTO n
    FROM public.institution_students s
    JOIN v2.actors pa ON pa.v1_user_id = s.claimed_by_user_id
    JOIN v2.actors ia ON ia.v1_institution_id = s.institution_id
   WHERE s.status = 'claimed' AND s.consent_given AND s.deleted_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM v2.consents c WHERE c.subject_actor_id = pa.id AND c.purpose = 'disclose_to_recruiters'
                       AND c.audience = 'institution:' || ia.id AND c.withdrawn_at IS NULL);
  IF NOT p_dry_run THEN
    INSERT INTO v2.consents (subject_actor_id, purpose, audience, notice_version, given_at, source)
    SELECT pa.id, 'disclose_to_recruiters', 'institution:' || ia.id, 'v1-roster-consent', coalesce(s.consent_at, now()),
           'aco.v1_institution_students'
      FROM public.institution_students s
      JOIN v2.actors pa ON pa.v1_user_id = s.claimed_by_user_id
      JOIN v2.actors ia ON ia.v1_institution_id = s.institution_id
     WHERE s.status = 'claimed' AND s.consent_given AND s.deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM v2.consents c WHERE c.subject_actor_id = pa.id AND c.purpose = 'disclose_to_recruiters'
                         AND c.audience = 'institution:' || ia.id AND c.withdrawn_at IS NULL);
    GET DIAGNOSTICS m = ROW_COUNT;
  END IF;
  RETURN QUERY SELECT n, m;
END
$fn$;

-- ---------------------------------------------------------------------------
-- Report (read-only): V1 tracker rows whose posting is gone. On 29 Sep 2026
-- production had 22 of 22 application-sourced rows in this state. Backfill
-- records them as closed engagements with reason 'v1_source_removed' only
-- after a human reviews this list.
-- ---------------------------------------------------------------------------
CREATE VIEW v2.report_v1_orphaned_tracker_rows AS
SELECT j.id, j.user_id, j.title, j.company, j.status, j.created_at
  FROM public.jobs j
 WHERE j.source = 'application' AND j.job_posting_id IS NULL;
