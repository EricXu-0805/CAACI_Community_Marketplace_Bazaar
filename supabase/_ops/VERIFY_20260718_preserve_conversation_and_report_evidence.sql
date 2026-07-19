-- Read-only post-deploy assertions for
-- 20260717194334_preserve_conversation_and_report_evidence.sql.
-- Any failed invariant blocks promotion.
-- This verifies text/metadata evidence and URL fallback only; it cannot assert
-- that externally deleted Storage media remains available. Reporter-account
-- cascade retention is intentionally outside this migration's authorization.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;

DO $verify$
DECLARE
  archived_at_default text;
  expected_trigger_columns text;
  actual_trigger_columns text;
  offer_trigger_definition text;
  meetup_trigger_definition text;
  admin_result text;
  readable_safe_report_columns integer;
BEGIN
  IF pg_catalog.to_regclass('public.conversation_archives') IS NULL THEN
    RAISE EXCEPTION 'verify_failed: conversation_archives missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class
    WHERE oid = 'public.conversation_archives'::pg_catalog.regclass
      AND relrowsecurity
  ) THEN
    RAISE EXCEPTION 'verify_failed: conversation_archives RLS disabled';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'conversation_archives'
  ) <> 3 OR EXISTS (
    SELECT 1
    FROM (VALUES
      ('user_id', 'uuid'::text, 'NO'::text),
      ('conversation_id', 'uuid'::text, 'NO'::text),
      ('archived_at', 'timestamp with time zone'::text, 'NO'::text)
    ) AS expected(column_name, data_type, is_nullable)
    WHERE NOT EXISTS (
      SELECT 1
      FROM information_schema.columns AS actual
      WHERE actual.table_schema = 'public'
        AND actual.table_name = 'conversation_archives'
        AND actual.column_name = expected.column_name
        AND actual.data_type = expected.data_type
        AND actual.is_nullable = expected.is_nullable
    )
  ) THEN
    RAISE EXCEPTION 'verify_failed: conversation_archives column shape';
  END IF;

  SELECT pg_catalog.pg_get_expr(
    attribute_default.adbin,
    attribute_default.adrelid
  )
  INTO archived_at_default
  FROM pg_catalog.pg_attrdef AS attribute_default
  INNER JOIN pg_catalog.pg_attribute AS column_definition
    ON column_definition.attrelid = attribute_default.adrelid
   AND column_definition.attnum = attribute_default.adnum
  WHERE attribute_default.adrelid =
    'public.conversation_archives'::pg_catalog.regclass
    AND column_definition.attname = 'archived_at'
    AND NOT column_definition.attisdropped;

  IF archived_at_default IS NULL
     OR archived_at_default NOT IN ('now()', 'pg_catalog.now()') THEN
    RAISE EXCEPTION 'verify_failed: conversation archive timestamp default';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.pg_constraint AS table_constraint
    WHERE table_constraint.conrelid =
      'public.conversation_archives'::pg_catalog.regclass
      AND table_constraint.contype = 'p'
      AND table_constraint.convalidated
      AND table_constraint.conkey = ARRAY[
        (
          SELECT column_definition.attnum
          FROM pg_catalog.pg_attribute AS column_definition
          WHERE column_definition.attrelid =
            'public.conversation_archives'::pg_catalog.regclass
            AND column_definition.attname = 'user_id'
            AND NOT column_definition.attisdropped
        ),
        (
          SELECT column_definition.attnum
          FROM pg_catalog.pg_attribute AS column_definition
          WHERE column_definition.attrelid =
            'public.conversation_archives'::pg_catalog.regclass
            AND column_definition.attname = 'conversation_id'
            AND NOT column_definition.attisdropped
        )
      ]::smallint[]
  ) <> 1 THEN
    RAISE EXCEPTION 'verify_failed: conversation archive primary key';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS foreign_key
    WHERE foreign_key.conrelid =
      'public.conversation_archives'::pg_catalog.regclass
      AND foreign_key.contype = 'f'
      AND foreign_key.convalidated
      AND foreign_key.confdeltype = 'c'
      AND foreign_key.confrelid = 'public.profiles'::pg_catalog.regclass
      AND foreign_key.conkey = ARRAY[
        (
          SELECT column_definition.attnum
          FROM pg_catalog.pg_attribute AS column_definition
          WHERE column_definition.attrelid =
            'public.conversation_archives'::pg_catalog.regclass
            AND column_definition.attname = 'user_id'
            AND NOT column_definition.attisdropped
        )
      ]::smallint[]
      AND foreign_key.confkey = ARRAY[
        (
          SELECT column_definition.attnum
          FROM pg_catalog.pg_attribute AS column_definition
          WHERE column_definition.attrelid =
            'public.profiles'::pg_catalog.regclass
            AND column_definition.attname = 'id'
            AND NOT column_definition.attisdropped
        )
      ]::smallint[]
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS foreign_key
    WHERE foreign_key.conrelid =
      'public.conversation_archives'::pg_catalog.regclass
      AND foreign_key.contype = 'f'
      AND foreign_key.convalidated
      AND foreign_key.confdeltype = 'c'
      AND foreign_key.confrelid = 'public.conversations'::pg_catalog.regclass
      AND foreign_key.conkey = ARRAY[
        (
          SELECT column_definition.attnum
          FROM pg_catalog.pg_attribute AS column_definition
          WHERE column_definition.attrelid =
            'public.conversation_archives'::pg_catalog.regclass
            AND column_definition.attname = 'conversation_id'
            AND NOT column_definition.attisdropped
        )
      ]::smallint[]
      AND foreign_key.confkey = ARRAY[
        (
          SELECT column_definition.attnum
          FROM pg_catalog.pg_attribute AS column_definition
          WHERE column_definition.attrelid =
            'public.conversations'::pg_catalog.regclass
            AND column_definition.attname = 'id'
            AND NOT column_definition.attisdropped
        )
      ]::smallint[]
  ) OR (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.pg_constraint AS foreign_key
    WHERE foreign_key.conrelid =
      'public.conversation_archives'::pg_catalog.regclass
      AND foreign_key.contype = 'f'
  ) <> 2 THEN
    RAISE EXCEPTION 'verify_failed: conversation archive FK semantics';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index AS index_definition
    WHERE index_definition.indexrelid =
      pg_catalog.to_regclass('public.conversation_archives_conversation_idx')
      AND index_definition.indrelid =
        'public.conversation_archives'::pg_catalog.regclass
      AND index_definition.indisvalid
      AND index_definition.indisready
      AND index_definition.indpred IS NULL
      AND index_definition.indexprs IS NULL
      AND index_definition.indnkeyatts = 1
      AND index_definition.indkey::text = (
        SELECT column_definition.attnum::text
        FROM pg_catalog.pg_attribute AS column_definition
        WHERE column_definition.attrelid =
          'public.conversation_archives'::pg_catalog.regclass
          AND column_definition.attname = 'conversation_id'
          AND NOT column_definition.attisdropped
      )
  ) THEN
    RAISE EXCEPTION 'verify_failed: conversation archive lookup index';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'conversation_archives'
  ) <> 1 OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'conversation_archives'
      AND policyname = 'Users can view own conversation archives'
      AND cmd = 'SELECT'
      AND permissive = 'PERMISSIVE'
      AND roles::text = '{authenticated}'
  ) THEN
    RAISE EXCEPTION 'verify_failed: conversation archive policy shape';
  END IF;

  -- The original migration granted table-level SELECT. The final ACL
  -- reconciliation deliberately replaces that with an explicit projection so
  -- future columns do not become readable by accident. Accept either safe
  -- deployment stage here; the tail migration's own VERIFY enforces the exact
  -- final projection.
  IF NOT (
       pg_catalog.has_table_privilege(
         'authenticated', 'public.conversation_archives', 'SELECT'
       )
       OR (
         pg_catalog.has_column_privilege(
           'authenticated', 'public.conversation_archives', 'user_id', 'SELECT'
         )
         AND pg_catalog.has_column_privilege(
           'authenticated', 'public.conversation_archives', 'conversation_id', 'SELECT'
         )
         AND pg_catalog.has_column_privilege(
           'authenticated', 'public.conversation_archives', 'archived_at', 'SELECT'
         )
       )
     )
     OR pg_catalog.has_table_privilege(
       'authenticated', 'public.conversation_archives', 'INSERT'
     )
     OR pg_catalog.has_table_privilege(
       'authenticated', 'public.conversation_archives', 'UPDATE'
     )
     OR pg_catalog.has_table_privilege(
       'authenticated', 'public.conversation_archives', 'DELETE'
     )
     OR pg_catalog.has_table_privilege(
       'anon', 'public.conversation_archives', 'SELECT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'service_role', 'public.conversation_archives', 'SELECT,INSERT,UPDATE,DELETE'
     ) THEN
    RAISE EXCEPTION 'verify_failed: conversation archive table ACL';
  END IF;

  IF pg_catalog.to_regprocedure(
       'public.archive_conversation(uuid,uuid)'
     ) IS NULL OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS function_definition
    WHERE function_definition.oid =
      'public.archive_conversation(uuid,uuid)'::pg_catalog.regprocedure
      AND function_definition.prosecdef
      AND pg_catalog.pg_get_function_result(function_definition.oid) = 'void'
      AND function_definition.proargnames =
        ARRAY['conversation_id_in', 'expected_user_id_in']::text[]
      AND COALESCE(function_definition.proconfig, ARRAY[]::text[])
        @> ARRAY['search_path=pg_catalog']::text[]
  ) THEN
    RAISE EXCEPTION 'verify_failed: archive RPC security/signature/search_path';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
       'authenticated', 'public.archive_conversation(uuid,uuid)', 'EXECUTE'
     ) OR pg_catalog.has_function_privilege(
       'anon', 'public.archive_conversation(uuid,uuid)', 'EXECUTE'
     ) OR pg_catalog.has_function_privilege(
       'service_role', 'public.archive_conversation(uuid,uuid)', 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'verify_failed: archive RPC ACL';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS function_definition
    WHERE function_definition.oid =
      'public.clear_conversation_archives_on_activity()'::pg_catalog.regprocedure
      AND function_definition.prosecdef
      AND COALESCE(function_definition.proconfig, ARRAY[]::text[])
        @> ARRAY['search_path=pg_catalog']::text[]
  ) OR pg_catalog.has_function_privilege(
    'authenticated',
    'public.clear_conversation_archives_on_activity()',
    'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    'anon',
    'public.clear_conversation_archives_on_activity()',
    'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    'service_role',
    'public.clear_conversation_archives_on_activity()',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'verify_failed: archive clear trigger function boundary';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.pg_trigger
    WHERE NOT tgisinternal
      AND tgfoid =
        'public.clear_conversation_archives_on_activity()'::pg_catalog.regprocedure
  ) <> 5 OR EXISTS (
    SELECT 1
    FROM (VALUES
      ('trg_clear_archives_message_insert', 'public.messages', 5::smallint),
      ('trg_clear_archives_offer_insert', 'public.offers', 5::smallint),
      ('trg_clear_archives_offer_update', 'public.offers', 17::smallint),
      ('trg_clear_archives_meetup_insert', 'public.meetups', 5::smallint),
      ('trg_clear_archives_meetup_update', 'public.meetups', 17::smallint)
    ) AS expected(trigger_name, relation_name, trigger_type)
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_trigger AS actual
      WHERE actual.tgname = expected.trigger_name
        AND actual.tgrelid = expected.relation_name::pg_catalog.regclass
        AND actual.tgfoid =
          'public.clear_conversation_archives_on_activity()'::pg_catalog.regprocedure
        AND actual.tgtype = expected.trigger_type
        AND actual.tgenabled = 'O'
        AND NOT actual.tgisinternal
    )
  ) THEN
    RAISE EXCEPTION 'verify_failed: archive activity trigger set';
  END IF;

  SELECT pg_catalog.string_agg(
    column_definition.attnum::text,
    ' ' ORDER BY requested_column.ordinality
  ) INTO expected_trigger_columns
  FROM pg_catalog.unnest(ARRAY['status']::text[])
    WITH ORDINALITY AS requested_column(column_name, ordinality)
  INNER JOIN pg_catalog.pg_attribute AS column_definition
    ON column_definition.attrelid = 'public.offers'::pg_catalog.regclass
   AND column_definition.attname = requested_column.column_name
   AND NOT column_definition.attisdropped;
  SELECT trigger_definition.tgattr::text INTO actual_trigger_columns
  FROM pg_catalog.pg_trigger AS trigger_definition
  WHERE trigger_definition.tgrelid = 'public.offers'::pg_catalog.regclass
    AND trigger_definition.tgname = 'trg_clear_archives_offer_update';
  IF actual_trigger_columns IS DISTINCT FROM expected_trigger_columns THEN
    RAISE EXCEPTION 'verify_failed: offer archive trigger columns';
  END IF;

  SELECT pg_catalog.lower(
    pg_catalog.pg_get_triggerdef(trigger_definition.oid)
  ) INTO offer_trigger_definition
  FROM pg_catalog.pg_trigger AS trigger_definition
  WHERE trigger_definition.tgrelid = 'public.offers'::pg_catalog.regclass
    AND trigger_definition.tgname = 'trg_clear_archives_offer_update';
  IF offer_trigger_definition IS NULL
     OR pg_catalog.strpos(
       offer_trigger_definition,
       'new.status is distinct from old.status'
     ) = 0
     OR pg_catalog.strpos(
       offer_trigger_definition,
       'new.status <> ''expired''::text'
     ) = 0 THEN
    RAISE EXCEPTION
      'verify_failed: offer expiry must not reopen archived conversations';
  END IF;

  SELECT pg_catalog.string_agg(
    column_definition.attnum::text,
    ' ' ORDER BY requested_column.ordinality
  ) INTO expected_trigger_columns
  FROM pg_catalog.unnest(
    ARRAY['status', 'spot', 'meet_at', 'note']::text[]
  ) WITH ORDINALITY AS requested_column(column_name, ordinality)
  INNER JOIN pg_catalog.pg_attribute AS column_definition
    ON column_definition.attrelid = 'public.meetups'::pg_catalog.regclass
   AND column_definition.attname = requested_column.column_name
   AND NOT column_definition.attisdropped;
  SELECT trigger_definition.tgattr::text INTO actual_trigger_columns
  FROM pg_catalog.pg_trigger AS trigger_definition
  WHERE trigger_definition.tgrelid = 'public.meetups'::pg_catalog.regclass
    AND trigger_definition.tgname = 'trg_clear_archives_meetup_update';
  IF actual_trigger_columns IS DISTINCT FROM expected_trigger_columns THEN
    RAISE EXCEPTION 'verify_failed: meetup archive trigger columns';
  END IF;

  SELECT pg_catalog.lower(
    pg_catalog.pg_get_triggerdef(trigger_definition.oid)
  ) INTO meetup_trigger_definition
  FROM pg_catalog.pg_trigger AS trigger_definition
  WHERE trigger_definition.tgrelid = 'public.meetups'::pg_catalog.regclass
    AND trigger_definition.tgname = 'trg_clear_archives_meetup_update';
  IF meetup_trigger_definition IS NULL
     OR pg_catalog.strpos(
       meetup_trigger_definition,
       'new.status = ''expired''::text'
     ) = 0
     OR pg_catalog.strpos(
       meetup_trigger_definition,
       'not (new.spot is distinct from old.spot)'
     ) = 0
     OR pg_catalog.strpos(
       meetup_trigger_definition,
       'not (new.meet_at is distinct from old.meet_at)'
     ) = 0
     OR pg_catalog.strpos(
       meetup_trigger_definition,
       'not (new.note is distinct from old.note)'
     ) = 0 THEN
    RAISE EXCEPTION
      'verify_failed: pure meetup expiry must not reopen archived conversations';
  END IF;

  IF pg_catalog.has_table_privilege(
       'authenticated', 'public.conversations', 'DELETE'
     ) OR pg_catalog.has_table_privilege(
       'authenticated', 'public.messages', 'DELETE'
     ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('conversations', 'messages')
      AND cmd = 'DELETE'
  ) THEN
    RAISE EXCEPTION 'verify_failed: shared chat DELETE boundary';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.reports'::pg_catalog.regclass
      AND attname = 'target_snapshot'
      AND atttypid = 'jsonb'::pg_catalog.regtype
      AND NOT attnotnull
      AND NOT attisdropped
      AND NOT atthasdef
  ) THEN
    RAISE EXCEPTION 'verify_failed: reports.target_snapshot shape';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS snapshot_constraint
    WHERE snapshot_constraint.conrelid = 'public.reports'::pg_catalog.regclass
      AND snapshot_constraint.conname = 'reports_target_snapshot_object'
      AND snapshot_constraint.contype = 'c'
      AND snapshot_constraint.convalidated
      AND pg_catalog.pg_get_expr(
        snapshot_constraint.conbin,
        snapshot_constraint.conrelid
      ) = '((target_snapshot IS NULL) OR (jsonb_typeof(target_snapshot) = ''object''::text))'
  ) THEN
    RAISE EXCEPTION 'verify_failed: report snapshot constraint';
  END IF;

  IF pg_catalog.has_column_privilege(
       'authenticated', 'public.reports', 'target_snapshot', 'INSERT'
     ) OR pg_catalog.has_column_privilege(
       'authenticated', 'public.reports', 'target_snapshot', 'UPDATE'
     ) OR pg_catalog.has_column_privilege(
       'anon', 'public.reports', 'target_snapshot', 'INSERT'
     ) OR pg_catalog.has_column_privilege(
       'anon', 'public.reports', 'target_snapshot', 'UPDATE'
     ) THEN
    RAISE EXCEPTION 'verify_failed: report snapshot column ACL';
  END IF;

  IF pg_catalog.has_column_privilege(
       'authenticated', 'public.reports', 'target_snapshot', 'SELECT'
     ) OR pg_catalog.has_column_privilege(
       'anon', 'public.reports', 'target_snapshot', 'SELECT'
     ) OR NOT pg_catalog.has_column_privilege(
       'service_role', 'public.reports', 'target_snapshot', 'SELECT'
     ) THEN
    RAISE EXCEPTION 'verify_failed: report snapshot read ACL';
  END IF;

  SELECT pg_catalog.count(*) FILTER (
    WHERE pg_catalog.has_column_privilege(
      'authenticated', 'public.reports', safe_column.column_name, 'SELECT'
    )
  )
  INTO readable_safe_report_columns
  FROM pg_catalog.unnest(ARRAY[
      'id', 'reporter_id', 'target_type', 'target_id',
      'reason', 'note', 'status', 'created_at'
  ]) AS safe_column(column_name);

  -- Immediately after this migration, authenticated may read the eight safe
  -- own-report fields under RLS. The final app ACL migration removes the report
  -- read surface entirely because the shipped client only submits reports.
  -- Reject partial projections while accepting both deliberate stages.
  IF readable_safe_report_columns NOT IN (0, 8) THEN
    RAISE EXCEPTION
      'verify_failed: partial safe own-report metadata projection: %',
      readable_safe_report_columns;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.reports AS report
    WHERE report.target_snapshot IS NOT NULL
      AND (
        report.target_snapshot ->> 'target_type' IS DISTINCT FROM report.target_type
        OR report.target_snapshot ->> 'target_id' IS DISTINCT FROM report.target_id::text
        OR NOT report.target_snapshot ? 'target_user_id'
        OR NOT report.target_snapshot ? 'captured_at'
      )
  ) THEN
    RAISE EXCEPTION 'verify_failed: malformed server snapshot row';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS function_definition
    WHERE function_definition.oid =
      'public.capture_report_target_snapshot()'::pg_catalog.regprocedure
      AND NOT function_definition.prosecdef
      AND COALESCE(function_definition.proconfig, ARRAY[]::text[])
        @> ARRAY['search_path=pg_catalog']::text[]
      AND pg_catalog.pg_get_functiondef(function_definition.oid)
        LIKE '%ELSIF NEW.target_type = ''item''%'
      AND pg_catalog.pg_get_functiondef(function_definition.oid)
        LIKE '%ELSIF NEW.target_type = ''post''%'
      AND pg_catalog.pg_get_functiondef(function_definition.oid)
        LIKE '%ELSIF NEW.target_type = ''comment''%'
      AND pg_catalog.pg_get_functiondef(function_definition.oid)
        LIKE '%ELSIF NEW.target_type = ''user''%'
  ) THEN
    RAISE EXCEPTION 'verify_failed: report snapshot capture function';
  END IF;

  IF pg_catalog.has_function_privilege(
       'authenticated', 'public.capture_report_target_snapshot()', 'EXECUTE'
     ) OR pg_catalog.has_function_privilege(
       'anon', 'public.capture_report_target_snapshot()', 'EXECUTE'
     ) OR pg_catalog.has_function_privilege(
       'service_role', 'public.capture_report_target_snapshot()', 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'verify_failed: report capture trigger callable';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.reports'::pg_catalog.regclass
      AND tgname = 'trg_capture_report_target_snapshot'
      AND tgfoid =
        'public.capture_report_target_snapshot()'::pg_catalog.regprocedure
      AND tgtype = 7
      AND tgenabled = 'O'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'verify_failed: report capture trigger';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS function_definition
    WHERE function_definition.oid =
      'public.guard_report_target_snapshot_immutable()'::pg_catalog.regprocedure
      AND NOT function_definition.prosecdef
      AND COALESCE(function_definition.proconfig, ARRAY[]::text[])
        @> ARRAY['search_path=pg_catalog']::text[]
  ) OR pg_catalog.has_function_privilege(
    'authenticated',
    'public.guard_report_target_snapshot_immutable()',
    'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    'anon',
    'public.guard_report_target_snapshot_immutable()',
    'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    'service_role',
    'public.guard_report_target_snapshot_immutable()',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'verify_failed: report snapshot immutable function';
  END IF;

  SELECT pg_catalog.string_agg(
    column_definition.attnum::text,
    ' ' ORDER BY requested_column.ordinality
  ) INTO expected_trigger_columns
  FROM pg_catalog.unnest(
    ARRAY['reporter_id', 'target_type', 'target_id', 'target_snapshot']::text[]
  ) WITH ORDINALITY AS requested_column(column_name, ordinality)
  INNER JOIN pg_catalog.pg_attribute AS column_definition
    ON column_definition.attrelid = 'public.reports'::pg_catalog.regclass
   AND column_definition.attname = requested_column.column_name
   AND NOT column_definition.attisdropped;
  SELECT trigger_definition.tgattr::text INTO actual_trigger_columns
  FROM pg_catalog.pg_trigger AS trigger_definition
  WHERE trigger_definition.tgrelid = 'public.reports'::pg_catalog.regclass
    AND trigger_definition.tgname = 'trg_guard_report_target_snapshot_immutable'
    AND trigger_definition.tgfoid =
      'public.guard_report_target_snapshot_immutable()'::pg_catalog.regprocedure
    AND trigger_definition.tgtype = 19
    AND trigger_definition.tgenabled = 'O'
    AND NOT trigger_definition.tgisinternal;
  IF actual_trigger_columns IS DISTINCT FROM expected_trigger_columns THEN
    RAISE EXCEPTION 'verify_failed: report immutable trigger columns';
  END IF;

  SELECT pg_catalog.pg_get_function_result(
    'public.admin_get_report_detail(uuid)'::pg_catalog.regprocedure
  ) INTO admin_result;
  IF admin_result IS DISTINCT FROM
    'TABLE(id uuid, reporter_id uuid, reporter_nickname text, reporter_email text, target_type text, target_id uuid, target_user_id uuid, target_user_nickname text, target_preview text, target_image text, reason text, note text, status text, created_at timestamp with time zone)'
  THEN
    RAISE EXCEPTION 'verify_failed: admin report 078 return shape: %', admin_result;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS function_definition
    WHERE function_definition.oid =
      'public.admin_get_report_detail(uuid)'::pg_catalog.regprocedure
      AND function_definition.prosecdef
      AND function_definition.provolatile = 's'
      AND COALESCE(function_definition.proconfig, ARRAY[]::text[])
        @> ARRAY['search_path=pg_catalog']::text[]
      AND pg_catalog.pg_get_functiondef(function_definition.oid)
        LIKE '%target_snapshot%'
  ) THEN
    RAISE EXCEPTION 'verify_failed: admin report security/fallback';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
       'service_role', 'public.admin_get_report_detail(uuid)', 'EXECUTE'
     ) OR pg_catalog.has_function_privilege(
       'authenticated', 'public.admin_get_report_detail(uuid)', 'EXECUTE'
     ) OR pg_catalog.has_function_privilege(
       'anon', 'public.admin_get_report_detail(uuid)', 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'verify_failed: admin report detail ACL';
  END IF;
END
$verify$;

SELECT
  target_type,
  pg_catalog.count(*) AS report_count,
  pg_catalog.count(*) FILTER (WHERE target_snapshot IS NOT NULL)
    AS snapshotted,
  pg_catalog.count(*) FILTER (WHERE target_snapshot IS NULL)
    AS legacy_unverified
FROM public.reports
GROUP BY target_type
ORDER BY target_type;

ROLLBACK;
