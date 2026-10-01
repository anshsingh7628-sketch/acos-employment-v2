-- ============================================================================
-- V2 security baseline: same posture as V1 (DECISIONS.md #1).
--
--  * RLS enabled with no policies on every v2 table = deny-all for any role
--    that doesn't bypass RLS. The backend connects as postgres.
--  * anon and authenticated hold nothing in schema v2.
--  * Functions are not executable by PUBLIC.
--
-- `npm run check:grants` and `check:fk-indexes` must be extended to schema v2;
-- the two queries at the bottom are what they should assert returns zero rows.
-- ============================================================================

DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'v2' LOOP
    EXECUTE format('ALTER TABLE v2.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;

REVOKE ALL ON SCHEMA v2 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA v2 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA v2 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA v2 FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA v2 REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA v2 REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- CI assertions (copy into check-grants / check-fk-indexes). Each must return 0 rows.
-- ---------------------------------------------------------------------------

-- A. v2 tables without RLS
-- SELECT tablename FROM pg_tables WHERE schemaname = 'v2' AND NOT rowsecurity;

-- B. any grant to anon/authenticated in v2
-- SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants
--  WHERE table_schema = 'v2' AND grantee IN ('anon', 'authenticated');

-- C. foreign keys without a leading-column index
-- (see 900_v2_tests.sql, test "every FK is indexed")
