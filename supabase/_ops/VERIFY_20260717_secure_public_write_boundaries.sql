-- Read-only post-deploy assertions for
-- 20260717092804_secure_public_write_boundaries.sql.
-- Run immediately after staging deploy, then production deploy. Any failed
-- invariant raises an exception and should block promotion.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;

DO $verify$
DECLARE
  search_overload_count integer;
  missing_profile_count bigint;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class
    WHERE oid IN (
      'public.items'::pg_catalog.regclass,
      'public.posts'::pg_catalog.regclass
    )
      AND NOT relrowsecurity
  ) THEN
    RAISE EXCEPTION 'verify_failed: items/posts RLS is disabled';
  END IF;

  IF EXISTS (SELECT 1 FROM public.items WHERE price < 0) THEN
    RAISE EXCEPTION 'verify_failed: negative item price remains';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.items'::pg_catalog.regclass
      AND conname = 'items_price_nonnegative'
      AND convalidated = true
  ) THEN
    RAISE EXCEPTION 'verify_failed: validated price constraint missing';
  END IF;

  SELECT count(*) INTO missing_profile_count
  FROM auth.users AS auth_user
  LEFT JOIN public.profiles AS profile ON profile.id = auth_user.id
  WHERE profile.id IS NULL;
  IF missing_profile_count <> 0 THEN
    RAISE EXCEPTION 'verify_failed: % auth users still lack profiles', missing_profile_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class
    WHERE oid = 'public.banners_live'::pg_catalog.regclass
      AND reloptions @> ARRAY['security_invoker=true']::text[]
  ) THEN
    RAISE EXCEPTION 'verify_failed: banners_live is not security_invoker';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.notifications'::pg_catalog.regclass
      AND attname = 'conversation_id'
      AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'verify_failed: notifications.conversation_id missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS notification_fk
    WHERE notification_fk.conrelid = 'public.notifications'::pg_catalog.regclass
      AND notification_fk.confrelid = 'public.conversations'::pg_catalog.regclass
      AND notification_fk.conname = 'notifications_conversation_id_fkey'
      AND notification_fk.contype = 'f'
      AND notification_fk.confdeltype = 'n'
      AND notification_fk.convalidated = true
      AND notification_fk.conkey = ARRAY[
        (
          SELECT local_column.attnum
          FROM pg_catalog.pg_attribute AS local_column
          WHERE local_column.attrelid = 'public.notifications'::pg_catalog.regclass
            AND local_column.attname = 'conversation_id'
            AND NOT local_column.attisdropped
        )
      ]::smallint[]
      AND notification_fk.confkey = ARRAY[
        (
          SELECT referenced_column.attnum
          FROM pg_catalog.pg_attribute AS referenced_column
          WHERE referenced_column.attrelid = 'public.conversations'::pg_catalog.regclass
            AND referenced_column.attname = 'id'
            AND NOT referenced_column.attisdropped
        )
      ]::smallint[]
  ) THEN
    RAISE EXCEPTION 'verify_failed: notifications conversation FK semantics';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'notifications'
      AND indexname = 'notifications_conversation_idx'
  ) THEN
    RAISE EXCEPTION 'verify_failed: notifications conversation index missing';
  END IF;

  IF pg_catalog.has_function_privilege(
       'anon', 'public.attach_notification_conversation()', 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'authenticated', 'public.attach_notification_conversation()', 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'service_role', 'public.attach_notification_conversation()', 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'verify_failed: notification trigger function is callable';
  END IF;

  IF pg_catalog.has_table_privilege(
       'authenticated', 'public.notifications', 'INSERT'
     ) THEN
    RAISE EXCEPTION 'verify_failed: authenticated notification INSERT remains';
  END IF;

  IF pg_catalog.has_column_privilege(
       'authenticated', 'public.notifications', 'conversation_id', 'UPDATE'
     )
     OR NOT pg_catalog.has_column_privilege(
       'authenticated', 'public.notifications', 'is_read', 'UPDATE'
     ) THEN
    RAISE EXCEPTION 'verify_failed: notification UPDATE column grants';
  END IF;

  IF pg_catalog.has_function_privilege(
       'anon', 'public.get_last_messages(uuid[])', 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'service_role', 'public.get_last_messages(uuid[])', 'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'authenticated', 'public.get_last_messages(uuid[])', 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'verify_failed: get_last_messages ACL';
  END IF;

  IF pg_catalog.has_function_privilege(
       'anon', 'public.increment_view_count(uuid)', 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'service_role', 'public.increment_view_count(uuid)', 'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'authenticated', 'public.increment_view_count(uuid)', 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'verify_failed: increment_view_count ACL';
  END IF;

  IF pg_catalog.has_function_privilege(
       'authenticated', 'public.recompute_seller_response(uuid)', 'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'service_role', 'public.recompute_seller_response(uuid)', 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'verify_failed: recompute_seller_response ACL';
  END IF;

  IF pg_catalog.has_function_privilege(
       'authenticated', 'public.edge_rate_hit(text,integer,integer)', 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'anon', 'public.edge_rate_hit(text,integer,integer)', 'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'service_role', 'public.edge_rate_hit(text,integer,integer)', 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'verify_failed: edge_rate_hit ACL';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc
    WHERE pronamespace = 'public'::pg_catalog.regnamespace
      AND proname IN (
        'handle_new_user', 'get_last_messages', 'increment_view_count',
        'recompute_seller_response', 'edge_rate_hit',
        'attach_notification_conversation', 'guard_illini_verify_columns'
      )
      AND NOT (
        COALESCE(proconfig, ARRAY[]::text[]) @> ARRAY['search_path=pg_catalog']::text[]
      )
  ) THEN
    RAISE EXCEPTION 'verify_failed: privileged function search_path';
  END IF;

  IF pg_catalog.to_regprocedure('public.guard_illini_verify_columns()') IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_proc AS function
       WHERE function.oid =
         'public.guard_illini_verify_columns()'::pg_catalog.regprocedure
         AND NOT function.prosecdef
         AND COALESCE(function.proconfig, ARRAY[]::text[])
           @> ARRAY['search_path=pg_catalog']::text[]
     ) THEN
    RAISE EXCEPTION 'verify_failed: guard_illini_verify_columns security/search_path';
  END IF;

  IF pg_catalog.has_function_privilege(
       'anon', 'public.handle_new_user()', 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'authenticated', 'public.handle_new_user()', 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'service_role', 'public.handle_new_user()', 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'anon', 'public.guard_illini_verify_columns()', 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'authenticated',
       'public.guard_illini_verify_columns()',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'service_role',
       'public.guard_illini_verify_columns()',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'verify_failed: auth/profile trigger function is callable';
  END IF;

  IF pg_catalog.to_regprocedure('public.record_consent(text,uuid)') IS NULL
     OR pg_catalog.to_regprocedure('public.mark_onboarded(text,text,uuid,text)') IS NULL
     OR pg_catalog.to_regprocedure('public.record_consent(text)') IS NULL
     OR pg_catalog.to_regprocedure('public.mark_onboarded(text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'verify_failed: rolling account-intent RPC overload missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS function
    WHERE function.oid IN (
      'public.record_consent(text,uuid)'::pg_catalog.regprocedure,
      'public.mark_onboarded(text,text,uuid,text)'::pg_catalog.regprocedure,
      'public.record_consent(text)'::pg_catalog.regprocedure,
      'public.mark_onboarded(text,text,text)'::pg_catalog.regprocedure
    )
      AND (
        NOT function.prosecdef
        OR NOT (
          COALESCE(function.proconfig, ARRAY[]::text[])
            @> ARRAY['search_path=pg_catalog']::text[]
        )
      )
  ) THEN
    RAISE EXCEPTION 'verify_failed: rolling account-intent RPC security/search_path';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('public.record_consent(text,uuid)'::pg_catalog.regprocedure),
      ('public.mark_onboarded(text,text,uuid,text)'::pg_catalog.regprocedure),
      ('public.record_consent(text)'::pg_catalog.regprocedure),
      ('public.mark_onboarded(text,text,text)'::pg_catalog.regprocedure)
    ) AS required_rpc(rpc)
    WHERE NOT pg_catalog.has_function_privilege(
            'authenticated', required_rpc.rpc, 'EXECUTE'
          )
       OR pg_catalog.has_function_privilege(
            'anon', required_rpc.rpc, 'EXECUTE'
          )
       OR pg_catalog.has_function_privilege(
            'service_role', required_rpc.rpc, 'EXECUTE'
          )
       OR EXISTS (
            SELECT 1
            FROM pg_catalog.pg_proc AS function
            CROSS JOIN LATERAL pg_catalog.aclexplode(
              COALESCE(
                function.proacl,
                pg_catalog.acldefault('f', function.proowner)
              )
            ) AS function_acl
            WHERE function.oid = required_rpc.rpc
              AND function_acl.grantee = 0
              AND function_acl.privilege_type = 'EXECUTE'
          )
  ) THEN
    RAISE EXCEPTION 'verify_failed: rolling account-intent RPC ACL';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.profiles'::pg_catalog.regclass
      AND conname = 'profiles_tos_version_release_allowlist'
      AND convalidated
      AND pg_catalog.pg_get_constraintdef(oid)
        LIKE '%2026-04-20%2026-07-18%'
  ) OR EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE tos_version IS NULL
       OR tos_version NOT IN ('0', '2026-04-20', '2026-07-18')
  ) THEN
    RAISE EXCEPTION 'verify_failed: consent release allowlist';
  END IF;

  IF pg_catalog.strpos(
       pg_catalog.pg_get_functiondef(
         'public.record_consent(text,uuid)'::pg_catalog.regprocedure
       ),
       '2026-07-18'
     ) = 0
     OR pg_catalog.strpos(
       pg_catalog.pg_get_functiondef(
         'public.record_consent(text,uuid)'::pg_catalog.regprocedure
       ),
       'account_changed'
     ) = 0
     OR pg_catalog.strpos(
       pg_catalog.pg_get_functiondef(
         'public.record_consent(text)'::pg_catalog.regprocedure
       ),
       '2026-04-20'
     ) = 0
     OR pg_catalog.strpos(
       pg_catalog.pg_get_functiondef(
         'public.record_consent(text)'::pg_catalog.regprocedure
       ),
       '2026-07-18'
     ) <> 0
     OR pg_catalog.strpos(
       pg_catalog.pg_get_functiondef(
         'public.mark_onboarded(text,text,text)'::pg_catalog.regprocedure
       ),
       'onboarded_at IS NULL'
     ) = 0 THEN
    RAISE EXCEPTION 'verify_failed: rolling account-intent release/first-write guard';
  END IF;

  SELECT count(*) INTO search_overload_count
  FROM pg_catalog.pg_proc
  WHERE pronamespace = 'public'::pg_catalog.regnamespace
    AND proname = 'search_items_fuzzy';
  IF search_overload_count <> 1 THEN
    RAISE EXCEPTION 'verify_failed: search_items_fuzzy has % overloads', search_overload_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc
    WHERE pronamespace = 'public'::pg_catalog.regnamespace
      AND proname = 'search_items_fuzzy'
      AND pronargs = 11
      AND pronargdefaults = 10
      AND prosecdef = false
  ) THEN
    RAISE EXCEPTION 'verify_failed: search_items_fuzzy signature/defaults/security';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
       'anon',
       'public.search_items_fuzzy(text[],public.item_category,public.item_condition,numeric,numeric,uuid,text,integer,integer,text,boolean)',
       'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'authenticated',
       'public.search_items_fuzzy(text[],public.item_category,public.item_condition,numeric,numeric,uuid,text,integer,integer,text,boolean)',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'service_role',
       'public.search_items_fuzzy(text[],public.item_category,public.item_condition,numeric,numeric,uuid,text,integer,integer,text,boolean)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'verify_failed: search_items_fuzzy ACL';
  END IF;

  IF NOT pg_catalog.has_column_privilege(
       'authenticated', 'public.messages', 'id', 'INSERT'
     )
     OR pg_catalog.has_column_privilege(
       'anon', 'public.messages', 'id', 'INSERT'
     ) THEN
    RAISE EXCEPTION 'verify_failed: message idempotency id INSERT grant';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('items', 'created_at'),
      ('items', 'view_count'),
      ('items', 'favorite_count'),
      ('items', 'location_verified'),
      ('posts', 'created_at'),
      ('posts', 'is_pinned'),
      ('posts', 'like_count'),
      ('posts', 'comment_count'),
      ('messages', 'created_at'),
      ('messages', 'is_read'),
      ('post_comments', 'created_at'),
      ('post_comments', 'like_count'),
      ('post_comments', 'status'),
      ('reports', 'created_at'),
      ('reports', 'status'),
      ('profiles', 'trust_score'),
      ('profiles', 'shadow_banned'),
      ('profiles', 'suspension_level'),
      ('profiles', 'is_illini_verified'),
      ('ratings', 'created_at'),
      ('conversations', 'created_at'),
      ('conversations', 'last_message_at')
    ) AS managed(table_name, column_name)
    WHERE pg_catalog.has_column_privilege(
      'authenticated',
      'public.' || managed.table_name,
      managed.column_name,
      'INSERT'
    )
  ) THEN
    RAISE EXCEPTION 'verify_failed: authenticated can INSERT a server-managed column';
  END IF;

  IF pg_catalog.has_column_privilege(
       'authenticated', 'public.items', 'location_verified', 'UPDATE'
     )
     OR pg_catalog.has_column_privilege(
       'authenticated', 'public.items', 'listing_type', 'UPDATE'
     )
     OR pg_catalog.has_column_privilege(
       'authenticated', 'public.items', 'created_at', 'UPDATE'
     )
     OR pg_catalog.has_column_privilege(
       'authenticated', 'public.items', 'view_count', 'UPDATE'
     )
     OR pg_catalog.has_column_privilege(
       'authenticated', 'public.items', 'favorite_count', 'UPDATE'
     ) THEN
    RAISE EXCEPTION 'verify_failed: authenticated can UPDATE protected item column';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('profiles'), ('reports'), ('ratings')
    ) AS denied(table_name)
    WHERE pg_catalog.has_table_privilege(
      'authenticated', 'public.' || denied.table_name, 'DELETE'
    )
  ) THEN
    RAISE EXCEPTION 'verify_failed: authenticated DELETE on denied table';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('items'), ('posts'), ('messages'), ('post_comments'),
      ('reports'), ('profiles'), ('ratings'), ('conversations'),
      ('notifications')
    ) AS exposed(table_name)
    WHERE pg_catalog.has_table_privilege(
      'anon', 'public.' || exposed.table_name, 'DELETE'
    )
  ) THEN
    RAISE EXCEPTION 'verify_failed: anon still has DELETE';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('items', false),
      ('posts', false),
      ('messages', true),
      ('post_comments', false),
      ('conversations', true),
      ('notifications', false)
    ) AS needed(table_name, removed_by_evidence_retention)
    WHERE (
      NOT needed.removed_by_evidence_retention
      OR pg_catalog.to_regclass('public.conversation_archives') IS NULL
    )
      AND NOT pg_catalog.has_table_privilege(
        'authenticated', 'public.' || needed.table_name, 'DELETE'
      )
  ) THEN
    RAISE EXCEPTION 'verify_failed: required authenticated DELETE missing';
  END IF;
END
$verify$;

-- Human-readable evidence after the assertion block.
SELECT
  pg_catalog.pg_get_function_identity_arguments(oid) AS signature,
  pronargdefaults,
  prosecdef,
  proconfig,
  proacl
FROM pg_catalog.pg_proc
WHERE pronamespace = 'public'::pg_catalog.regnamespace
  AND proname = 'search_items_fuzzy';

SELECT
  policyname,
  roles,
  cmd,
  with_check
FROM pg_catalog.pg_policies
WHERE schemaname = 'public'
  AND tablename = 'ratings'
  AND policyname = 'Participants can rate sold items';

ROLLBACK;
