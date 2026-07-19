-- Read-only post-deploy verification for
-- 20260717141822_enforce_symmetric_chat_block_boundary.sql.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;

DO $verify$
DECLARE
  actual_count integer;
  expected_rpc regprocedure;
  rpc_signature text;
  evidence_retention_active boolean :=
    pg_catalog.to_regclass('public.conversation_archives') IS NOT NULL;
  atomic_reminder_split_active boolean := pg_catalog.to_regprocedure(
    'public.seed_digest_reminders(integer,integer,integer)'
  ) IS NOT NULL;
BEGIN
  SELECT pg_catalog.count(*) INTO actual_count
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('blocks', 'conversations', 'messages', 'offers', 'meetups')
    AND permissive = 'PERMISSIVE';

  IF actual_count <> (CASE WHEN evidence_retention_active THEN 11 ELSE 13 END)
     OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies AS policy
    WHERE policy.schemaname = 'public'
      AND policy.tablename IN ('blocks', 'conversations', 'messages', 'offers', 'meetups')
      AND policy.permissive = 'PERMISSIVE'
      AND (policy.tablename, policy.policyname, policy.cmd) NOT IN (
        ('blocks', 'Blockers can view own blocks', 'SELECT'),
        ('blocks', 'Blockers can create own blocks', 'INSERT'),
        ('blocks', 'Blockers can remove own blocks', 'DELETE'),
        ('conversations', 'Unblocked participants can view conversations', 'SELECT'),
        ('conversations', 'Unblocked buyers can create conversations', 'INSERT'),
        ('conversations', 'Unblocked participants can update conversations', 'UPDATE'),
        ('conversations', 'Unblocked participants can delete conversations', 'DELETE'),
        ('messages', 'Unblocked participants can view messages', 'SELECT'),
        ('messages', 'Unblocked participants can send messages', 'INSERT'),
        ('messages', 'Unblocked recipients can mark messages read', 'UPDATE'),
        ('messages', 'Unblocked senders can delete own messages', 'DELETE'),
        ('offers', 'offers_select', 'SELECT'),
        ('meetups', 'meetups_select', 'SELECT')
      )
  ) OR EXISTS (
    SELECT expected.tablename, expected.policyname, expected.cmd
    FROM (VALUES
      ('blocks', 'Blockers can view own blocks', 'SELECT', false),
      ('blocks', 'Blockers can create own blocks', 'INSERT', false),
      ('blocks', 'Blockers can remove own blocks', 'DELETE', false),
      ('conversations', 'Unblocked participants can view conversations', 'SELECT', false),
      ('conversations', 'Unblocked buyers can create conversations', 'INSERT', false),
      ('conversations', 'Unblocked participants can update conversations', 'UPDATE', false),
      ('conversations', 'Unblocked participants can delete conversations', 'DELETE', true),
      ('messages', 'Unblocked participants can view messages', 'SELECT', false),
      ('messages', 'Unblocked participants can send messages', 'INSERT', false),
      ('messages', 'Unblocked recipients can mark messages read', 'UPDATE', false),
      ('messages', 'Unblocked senders can delete own messages', 'DELETE', true),
      ('offers', 'offers_select', 'SELECT', false),
      ('meetups', 'meetups_select', 'SELECT', false)
    ) AS expected(tablename, policyname, cmd, removed_by_evidence)
    WHERE NOT expected.removed_by_evidence OR NOT evidence_retention_active
    EXCEPT
    SELECT policy.tablename, policy.policyname, policy.cmd
    FROM pg_catalog.pg_policies AS policy
    WHERE policy.schemaname = 'public'
      AND policy.tablename IN ('blocks', 'conversations', 'messages', 'offers', 'meetups')
      AND policy.permissive = 'PERMISSIVE'
  ) THEN
    RAISE EXCEPTION
      'verify_failed: approved permissive chat policy set mismatch, found %',
      actual_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies AS policy
    WHERE policy.schemaname = 'public'
      AND policy.tablename IN ('blocks', 'conversations', 'messages', 'offers', 'meetups')
      AND policy.permissive = 'PERMISSIVE'
      AND policy.roles IS DISTINCT FROM ARRAY['authenticated']::name[]
  ) THEN
    RAISE EXCEPTION 'verify_failed: a chat policy is not scoped exactly to authenticated';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES ('blocks'), ('conversations'), ('messages'), ('offers'), ('meetups'))
      AS expected(table_name)
    LEFT JOIN pg_catalog.pg_class AS relation
      ON relation.oid = pg_catalog.to_regclass('public.' || expected.table_name)
    WHERE relation.oid IS NULL OR NOT relation.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'verify_failed: chat RLS is not enabled on every protected table';
  END IF;

  IF pg_catalog.to_regprocedure('private.current_user_can_access_pair(uuid,uuid)') IS NULL
     OR pg_catalog.to_regprocedure('private.current_user_can_access_conversation(uuid)') IS NULL
     OR NOT pg_catalog.has_schema_privilege('authenticated', 'private', 'USAGE')
     OR pg_catalog.has_schema_privilege('anon', 'private', 'USAGE')
     OR NOT pg_catalog.has_function_privilege(
       'authenticated', 'private.current_user_can_access_pair(uuid,uuid)', 'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'authenticated', 'private.current_user_can_access_conversation(uuid)', 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'anon', 'private.current_user_can_access_pair(uuid,uuid)', 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'anon', 'private.current_user_can_access_conversation(uuid)', 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'service_role', 'private.current_user_can_access_pair(uuid,uuid)', 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'service_role', 'private.current_user_can_access_conversation(uuid)', 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'verify_failed: private chat helper schema/function ACL';
  END IF;

  SELECT pg_catalog.count(*) INTO actual_count
  FROM pg_catalog.pg_proc AS function
  WHERE function.oid IN (
    'private.current_user_can_access_pair(uuid,uuid)'::pg_catalog.regprocedure,
    'private.current_user_can_access_conversation(uuid)'::pg_catalog.regprocedure
  )
    AND function.prosecdef
    AND COALESCE(function.proconfig, ARRAY[]::text[])
      @> ARRAY['search_path=pg_catalog']::text[];
  IF actual_count <> 2 THEN
    RAISE EXCEPTION 'verify_failed: private chat helper security/search_path';
  END IF;

  FOREACH rpc_signature IN ARRAY ARRAY[
    'public.get_last_messages(uuid[])',
    'public.make_offer(uuid,numeric,uuid,text)',
    'public.respond_to_offer(uuid,text,uuid,numeric,text)',
    'public.propose_meetup(uuid,text,timestamp with time zone,uuid,text)',
    'public.respond_to_meetup(uuid,text,uuid,text,timestamp with time zone,text)',
    'public.reschedule_accepted_meetup(uuid,text,timestamp with time zone,uuid,text)'
  ] LOOP
    expected_rpc := pg_catalog.to_regprocedure(rpc_signature);
    IF expected_rpc IS NULL
       OR NOT pg_catalog.has_function_privilege('authenticated', expected_rpc, 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', expected_rpc, 'EXECUTE')
       OR pg_catalog.has_function_privilege('service_role', expected_rpc, 'EXECUTE') THEN
      RAISE EXCEPTION 'verify_failed: chat RPC ACL for %', rpc_signature;
    END IF;
  END LOOP;

  -- Legacy overloads have no expected-user token. They may remain so stale
  -- clients receive a deterministic authorization failure, but no API role or
  -- PUBLIC may retain EXECUTE. Absence is equally safe.
  FOREACH rpc_signature IN ARRAY ARRAY[
    'public.make_offer(uuid,numeric,text)',
    'public.respond_to_offer(uuid,text,numeric,text)',
    'public.propose_meetup(uuid,text,timestamp with time zone,text)',
    'public.respond_to_meetup(uuid,text,text,timestamp with time zone,text)',
    'public.reschedule_accepted_meetup(uuid,text,timestamp with time zone,text)'
  ] LOOP
    expected_rpc := pg_catalog.to_regprocedure(rpc_signature);
    IF expected_rpc IS NOT NULL AND (
      pg_catalog.has_function_privilege('anon', expected_rpc, 'EXECUTE')
      OR pg_catalog.has_function_privilege('authenticated', expected_rpc, 'EXECUTE')
      OR pg_catalog.has_function_privilege('service_role', expected_rpc, 'EXECUTE')
      OR EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc AS legacy_function
        CROSS JOIN LATERAL pg_catalog.aclexplode(
          COALESCE(
            legacy_function.proacl,
            pg_catalog.acldefault('f', legacy_function.proowner)
          )
        ) AS legacy_acl
        WHERE legacy_function.oid = expected_rpc
          AND legacy_acl.grantee = 0
          AND legacy_acl.privilege_type = 'EXECUTE'
      )
    ) THEN
      RAISE EXCEPTION 'verify_failed: legacy chat RPC remains callable for %', rpc_signature;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS unexpected_function
    JOIN pg_catalog.pg_namespace AS unexpected_namespace
      ON unexpected_namespace.oid = unexpected_function.pronamespace
    WHERE unexpected_namespace.nspname = 'public'
      AND unexpected_function.proname IN (
        'make_offer',
        'respond_to_offer',
        'propose_meetup',
        'respond_to_meetup',
        'reschedule_accepted_meetup'
      )
      AND unexpected_function.oid NOT IN (
        'public.make_offer(uuid,numeric,uuid,text)'::pg_catalog.regprocedure,
        'public.respond_to_offer(uuid,text,uuid,numeric,text)'::pg_catalog.regprocedure,
        'public.propose_meetup(uuid,text,timestamp with time zone,uuid,text)'::pg_catalog.regprocedure,
        'public.respond_to_meetup(uuid,text,uuid,text,timestamp with time zone,text)'::pg_catalog.regprocedure,
        'public.reschedule_accepted_meetup(uuid,text,timestamp with time zone,uuid,text)'::pg_catalog.regprocedure
      )
      AND (
        pg_catalog.has_function_privilege('anon', unexpected_function.oid, 'EXECUTE')
        OR pg_catalog.has_function_privilege('authenticated', unexpected_function.oid, 'EXECUTE')
        OR pg_catalog.has_function_privilege('service_role', unexpected_function.oid, 'EXECUTE')
      )
  ) THEN
    RAISE EXCEPTION 'verify_failed: an unexpected chat write overload is API-callable';
  END IF;

  SELECT pg_catalog.count(*) INTO actual_count
  FROM pg_catalog.pg_proc AS secured_function
  WHERE secured_function.oid IN (
    'public.get_last_messages(uuid[])'::pg_catalog.regprocedure,
    'public.make_offer(uuid,numeric,uuid,text)'::pg_catalog.regprocedure,
    'public.respond_to_offer(uuid,text,uuid,numeric,text)'::pg_catalog.regprocedure,
    'public.propose_meetup(uuid,text,timestamp with time zone,uuid,text)'::pg_catalog.regprocedure,
    'public.respond_to_meetup(uuid,text,uuid,text,timestamp with time zone,text)'::pg_catalog.regprocedure,
    'public.reschedule_accepted_meetup(uuid,text,timestamp with time zone,uuid,text)'::pg_catalog.regprocedure,
    'public.enforce_chat_block_boundary()'::pg_catalog.regprocedure,
    'public.serialize_block_pair_change()'::pg_catalog.regprocedure
  )
    AND secured_function.prosecdef
    AND COALESCE(secured_function.proconfig, ARRAY[]::text[])
      @> ARRAY['search_path=pg_catalog']::text[];
  IF actual_count <> 8 THEN
    RAISE EXCEPTION 'verify_failed: public chat function security/search_path';
  END IF;

  SELECT pg_catalog.count(*) INTO actual_count
  FROM pg_catalog.pg_proc AS guarded_function
  WHERE guarded_function.oid IN (
    'public.make_offer(uuid,numeric,uuid,text)'::pg_catalog.regprocedure,
    'public.respond_to_offer(uuid,text,uuid,numeric,text)'::pg_catalog.regprocedure,
    'public.propose_meetup(uuid,text,timestamp with time zone,uuid,text)'::pg_catalog.regprocedure,
    'public.respond_to_meetup(uuid,text,uuid,text,timestamp with time zone,text)'::pg_catalog.regprocedure,
    'public.reschedule_accepted_meetup(uuid,text,timestamp with time zone,uuid,text)'::pg_catalog.regprocedure
  )
    AND pg_catalog.strpos(guarded_function.prosrc, 'account_changed') > 0
    AND pg_catalog.strpos(guarded_function.prosrc, 'expected_user_id_in') > 0;
  IF actual_count <> 5 THEN
    RAISE EXCEPTION 'verify_failed: chat write RPC account-intent guard';
  END IF;

  IF pg_catalog.has_function_privilege(
       'anon', 'public.enforce_chat_block_boundary()', 'EXECUTE'
     ) OR pg_catalog.has_function_privilege(
       'authenticated', 'public.enforce_chat_block_boundary()', 'EXECUTE'
     ) OR pg_catalog.has_function_privilege(
       'service_role', 'public.enforce_chat_block_boundary()', 'EXECUTE'
     ) OR pg_catalog.has_function_privilege(
       'anon', 'public.serialize_block_pair_change()', 'EXECUTE'
     ) OR pg_catalog.has_function_privilege(
       'authenticated', 'public.serialize_block_pair_change()', 'EXECUTE'
     ) OR pg_catalog.has_function_privilege(
       'service_role', 'public.serialize_block_pair_change()', 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'verify_failed: internal chat trigger function is callable';
  END IF;

  SELECT pg_catalog.count(*) INTO actual_count
  FROM pg_catalog.pg_trigger AS trigger
  JOIN pg_catalog.pg_class AS relation ON relation.oid = trigger.tgrelid
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE NOT trigger.tgisinternal
    AND trigger.tgfoid IN (
      'public.enforce_chat_block_boundary()'::pg_catalog.regprocedure,
      'public.serialize_block_pair_change()'::pg_catalog.regprocedure
    );
  IF actual_count <> (CASE WHEN atomic_reminder_split_active THEN 7 ELSE 5 END)
     OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS trigger
    JOIN pg_catalog.pg_class AS relation ON relation.oid = trigger.tgrelid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE NOT trigger.tgisinternal
      AND trigger.tgfoid IN (
        'public.enforce_chat_block_boundary()'::pg_catalog.regprocedure,
        'public.serialize_block_pair_change()'::pg_catalog.regprocedure
      )
      AND NOT (
        namespace.nspname = 'public'
        AND trigger.tgenabled = 'O'
        AND (
          (
            relation.relname IN ('conversations', 'offers')
            AND trigger.tgname = 'trg_chat_block_boundary'
            AND trigger.tgfoid = 'public.enforce_chat_block_boundary()'::pg_catalog.regprocedure
            AND trigger.tgtype = 23
          ) OR (
            NOT atomic_reminder_split_active
            AND relation.relname IN ('messages', 'meetups')
            AND trigger.tgname = 'trg_chat_block_boundary'
            AND trigger.tgfoid = 'public.enforce_chat_block_boundary()'::pg_catalog.regprocedure
            AND trigger.tgtype = 23
          ) OR (
            atomic_reminder_split_active
            AND relation.relname IN ('messages', 'meetups')
            AND trigger.tgfoid = 'public.enforce_chat_block_boundary()'::pg_catalog.regprocedure
            AND (
              (trigger.tgname = 'trg_chat_block_boundary' AND trigger.tgtype = 7)
              OR (
                trigger.tgname = 'trg_chat_block_boundary_update'
                AND trigger.tgtype = 19
              )
            )
          ) OR (
            relation.relname = 'blocks'
            AND trigger.tgname = 'trg_serialize_block_pair_change'
            AND trigger.tgfoid = 'public.serialize_block_pair_change()'::pg_catalog.regprocedure
            AND trigger.tgtype = 15
          )
        )
      )
  ) THEN
    RAISE EXCEPTION
      'verify_failed: chat boundary trigger set does not match final reminder state';
  END IF;

  IF pg_catalog.has_table_privilege('authenticated', 'public.blocks', 'UPDATE') THEN
    RAISE EXCEPTION 'verify_failed: authenticated can update block rows';
  END IF;
END
$verify$;

SELECT
  to_regprocedure('private.current_user_can_access_pair(uuid,uuid)')
    AS pair_helper,
  to_regprocedure('private.current_user_can_access_conversation(uuid)')
    AS access_helper,
  has_schema_privilege('authenticated', 'private', 'USAGE')
    AS authenticated_has_private_usage,
  has_function_privilege(
    'authenticated',
    'private.current_user_can_access_pair(uuid,uuid)',
    'EXECUTE'
  ) AS authenticated_can_run_pair_helper,
  has_function_privilege(
    'authenticated',
    'private.current_user_can_access_conversation(uuid)',
    'EXECUTE'
  ) AS authenticated_can_run_rls_helper,
  NOT has_function_privilege(
    'anon',
    'private.current_user_can_access_pair(uuid,uuid)',
    'EXECUTE'
  ) AS anon_cannot_run_pair_helper,
  NOT has_function_privilege(
    'anon',
    'private.current_user_can_access_conversation(uuid)',
    'EXECUTE'
  ) AS anon_cannot_run_rls_helper;

SELECT tablename, policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('blocks', 'conversations', 'messages', 'offers', 'meetups')
ORDER BY tablename, cmd, policyname;

SELECT
  event_object_table AS table_name,
  trigger_name,
  action_timing,
  event_manipulation
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND trigger_name IN ('trg_chat_block_boundary', 'trg_serialize_block_pair_change')
ORDER BY event_object_table, event_manipulation;

SELECT
  p.oid::regprocedure AS function_name,
  p.prosecdef AS security_definer,
  p.proconfig AS fixed_config,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute
FROM pg_proc AS p
JOIN pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'get_last_messages',
    'make_offer',
    'respond_to_offer',
    'propose_meetup',
    'respond_to_meetup',
    'reschedule_accepted_meetup',
    'enforce_chat_block_boundary',
    'serialize_block_pair_change'
  )
ORDER BY p.proname;

SELECT
  NOT has_table_privilege('authenticated', 'public.blocks', 'UPDATE')
    AS authenticated_cannot_update_blocks,
  NOT has_function_privilege(
    'anon', 'public.make_offer(uuid,numeric,uuid,text)', 'EXECUTE'
  ) AS anon_cannot_make_offer,
  NOT has_function_privilege(
    'anon', 'public.respond_to_offer(uuid,text,uuid,numeric,text)', 'EXECUTE'
  ) AS anon_cannot_respond_offer,
  NOT has_function_privilege(
    'anon', 'public.propose_meetup(uuid,text,timestamp with time zone,uuid,text)', 'EXECUTE'
  ) AS anon_cannot_propose_meetup;

ROLLBACK;
