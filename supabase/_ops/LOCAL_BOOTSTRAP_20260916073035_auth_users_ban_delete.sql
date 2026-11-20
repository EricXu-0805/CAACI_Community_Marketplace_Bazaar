-- LOCAL L-SQL REPLAY ONLY (RUNBOOK §5.1). Never apply to a hosted project:
-- there Supabase Auth (GoTrue) already added these columns.
--
-- Hosted surface: auth.users columns the image lacks. First read by
-- 20260916073035 (u.deleted_at, u.banned_until), then by 20260917033744.
--
-- Sources (supabase/auth v2.197.0 (4eee58f296d9698a1c2c0ae14d7a0b379c7622d3), migrations/):
--   auth.users banned_until timestamptz NULL: 20220114185340_add_banned_until.up.sql
--   auth.users deleted_at timestamptz NULL: 20230116124412_add_deleted_at.up.sql

\set ON_ERROR_STOP on

DO $guard$
BEGIN
  IF pg_catalog.current_setting('caaci.local_bootstrap', true)
       IS DISTINCT FROM 'lsql-replay' THEN
    RAISE EXCEPTION 'local L-SQL replay bootstrap only (set caaci.local_bootstrap = lsql-replay)'
      USING ERRCODE = '55000';
  END IF;
END;
$guard$;

ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS banned_until timestamptz NULL;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;
