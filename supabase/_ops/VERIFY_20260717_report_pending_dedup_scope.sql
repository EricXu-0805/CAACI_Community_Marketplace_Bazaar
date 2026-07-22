-- Run after 20260717143030_fix_report_pending_dedup_scope.sql.
-- Read-only structural assertions; safe to run against a deployed database.
-- Behavioral coverage lives in the isolated rollback-only regression script.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;

DO $verify$
DECLARE
  pending_index_found boolean := false;
  pending_index_unique boolean := false;
  pending_index_predicate text;
  same_key_unique_index_count integer := 0;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.reports'::regclass
      AND conname = 'reports_unique_reporter_target'
  ) THEN
    RAISE EXCEPTION 'legacy permanent report uniqueness constraint still exists';
  END IF;

  IF to_regclass('public.reports_unique_reporter_target') IS NOT NULL THEN
    RAISE EXCEPTION 'legacy permanent report uniqueness index still exists';
  END IF;

  SELECT
    true,
    report_index.indisunique,
    pg_get_expr(report_index.indpred, report_index.indrelid)
  INTO
    pending_index_found,
    pending_index_unique,
    pending_index_predicate
  FROM pg_index AS report_index
  WHERE report_index.indexrelid =
    to_regclass('public.uq_reports_pending_per_reporter_target');

  IF NOT pending_index_found THEN
    RAISE EXCEPTION 'pending-only report uniqueness index is missing';
  END IF;

  IF NOT pending_index_unique OR pending_index_predicate IS NULL THEN
    RAISE EXCEPTION 'report dedup index must be unique and partial';
  END IF;

  IF pending_index_predicate <> '(status = ''pending''::text)' THEN
    RAISE EXCEPTION
      'unexpected report dedup predicate: %', pending_index_predicate;
  END IF;

  SELECT count(*)
  INTO same_key_unique_index_count
  FROM pg_index AS candidate
  WHERE candidate.indrelid = 'public.reports'::regclass
    AND candidate.indisunique
    AND candidate.indnkeyatts = 3
    AND ARRAY(
      SELECT attribute.attname::text
      FROM unnest(candidate.indkey::smallint[]) WITH ORDINALITY
        AS key_column(attnum, position)
      JOIN pg_attribute AS attribute
        ON attribute.attrelid = candidate.indrelid
       AND attribute.attnum = key_column.attnum
      WHERE key_column.position <= candidate.indnkeyatts
      ORDER BY key_column.position
    ) = ARRAY['reporter_id', 'target_type', 'target_id']::text[];

  IF same_key_unique_index_count <> 1 THEN
    RAISE EXCEPTION
      'expected exactly one report uniqueness index on the dedup key, found %',
      same_key_unique_index_count;
  END IF;
END
$verify$;

SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'reports'
  AND indexname = 'uq_reports_pending_per_reporter_target';

ROLLBACK;
