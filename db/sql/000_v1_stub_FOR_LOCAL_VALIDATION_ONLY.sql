-- ============================================================================
-- DO NOT RUN ON SUPABASE.
--
-- A minimal stand-in for the V1 tables the V2 migrations reference, with the
-- columns V2 actually reads (taken from the live schema on 29 Sep 2026). It
-- exists so 001..006 and the test file can be run on a throwaway Postgres to
-- prove they apply cleanly and behave. On production these tables already
-- exist, with more columns than this.
-- ============================================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  full_name text,
  role text NOT NULL,
  open_to_work text,
  notice_period_days integer,
  expected_ctc_min integer,
  expected_ctc_max integer,
  preferred_locations text,
  open_to_remote boolean,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid REFERENCES public.users(id),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.institutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid REFERENCES public.users(id),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.institution_students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES public.institutions(id),
  full_name text NOT NULL,
  email text,
  status text NOT NULL DEFAULT 'invited',
  claimed_by_user_id uuid REFERENCES public.users(id),
  consent_given boolean NOT NULL DEFAULT false,
  consent_at timestamptz,
  deleted_at timestamptz,
  placement_status text NOT NULL DEFAULT 'not_placed',
  placed_company text,
  placed_role text,
  placed_ctc_band text,
  placed_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.resumes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id),
  raw_text text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.job_postings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id),
  created_by uuid NOT NULL REFERENCES public.users(id),
  title text NOT NULL,
  description text,
  location text,
  employment_type text,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_posting_id uuid NOT NULL REFERENCES public.job_postings(id),
  applicant_id uuid NOT NULL REFERENCES public.users(id),
  resume_text text,
  status text NOT NULL DEFAULT 'submitted',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_posting_id, applicant_id)
);

CREATE TABLE IF NOT EXISTS public.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id),
  title text NOT NULL,
  company text NOT NULL,
  status text NOT NULL DEFAULT 'saved',
  source text NOT NULL DEFAULT 'manual',
  job_posting_id uuid REFERENCES public.job_postings(id) ON DELETE SET NULL,
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
