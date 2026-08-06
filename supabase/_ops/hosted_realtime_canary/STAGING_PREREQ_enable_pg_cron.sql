-- STAGING-ONLY prerequisite for the hosted Realtime canary.
--
-- Was `supabase/migrations/20260801082937_enable_pg_cron_for_hosted_realtime_
-- activation.sql`, auto-generated when pg_cron was enabled on the staging
-- project from the Supabase dashboard. Migration history deploys to
-- production, and production neither runs nor needs the canary's TTL job, so
-- this belongs with the rest of the staging-only package instead.
--
-- Run it only against the exact approved staging project, before ACTIVATE.sql.
-- Never against production (`lfhvgprfphyfvhidegum`), which as of 2026-08-06
-- has no pg_cron extension installed. `create extension` is intentionally left
-- unguarded: on a project that already has it, this must fail loudly rather
-- than silently confirm an assumption about which database is attached.

create extension pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;
