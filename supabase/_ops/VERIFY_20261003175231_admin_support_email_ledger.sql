-- Read-only verification. No email is sent and no token is stamped as used.
\set ON_ERROR_STOP on
BEGIN READ ONLY;
DO $verify$
DECLARE
  function_name text;
  function_row record;
  role_name text;
  column_names text[];
  audit_check text;
  event_name text;
  event_allowed boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class
                 WHERE oid = 'public.admin_support_email_requests'::regclass
                   AND relrowsecurity) THEN
    RAISE EXCEPTION 'support_email_rls_missing';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_policy
              WHERE polrelid = 'public.admin_support_email_requests'::regclass) THEN
    RAISE EXCEPTION 'support_email_unexpected_policy';
  END IF;
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF pg_catalog.has_table_privilege(role_name, 'public.admin_support_email_requests',
                                     'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       OR pg_catalog.has_any_column_privilege(role_name, 'public.admin_support_email_requests',
                                             'SELECT,INSERT,UPDATE,REFERENCES') THEN
      RAISE EXCEPTION 'support_email_table_acl_leak:%', role_name;
    END IF;
  END LOOP;
  SELECT pg_catalog.array_agg(attname::text ORDER BY attnum) INTO column_names
    FROM pg_catalog.pg_attribute
   WHERE attrelid = 'public.admin_support_email_requests'::regclass
     AND attnum > 0 AND NOT attisdropped;
  IF column_names IS DISTINCT FROM ARRAY[
      'request_id','actor_id','admin_token_id','intent_hash','recipient','subject',
      'status','provider_id','created_at','completed_at'] THEN
    RAISE EXCEPTION 'support_email_unexpected_retained_fields';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                 WHERE conrelid = 'public.admin_support_email_requests'::regclass
                   AND contype = 'p' AND conkey = ARRAY[1]::smallint[])
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                 WHERE conrelid = 'public.admin_support_email_requests'::regclass
                   AND contype = 'f') THEN
    RAISE EXCEPTION 'support_email_global_permanent_request_id_missing';
  END IF;
  FOREACH function_name IN ARRAY ARRAY[
    'public.admin_support_email_status(text)',
    'public.admin_support_email_claim(text,uuid,text,text,text)',
    'public.admin_support_email_receipt(text,uuid)',
    'public.admin_support_email_finish(text,uuid,text,text,text)'
  ] LOOP
    SELECT * INTO function_row FROM pg_catalog.pg_proc
     WHERE oid = pg_catalog.to_regprocedure(function_name);
    IF NOT FOUND OR NOT function_row.prosecdef
       OR function_row.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']
       OR function_row.prorettype <> 'jsonb'::regtype
       OR pg_catalog.has_function_privilege('anon', function_row.oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', function_row.oid, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('service_role', function_row.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'support_email_rpc_contract_invalid:%', function_name;
    END IF;
  END LOOP;
  FOREACH function_name IN ARRAY ARRAY[
    'public.admin_support_email_owner(text)',
    'public.admin_support_email_receipt_json(public.admin_support_email_requests)'
  ] LOOP
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      IF pg_catalog.has_function_privilege(role_name, function_name, 'EXECUTE') THEN
        RAISE EXCEPTION 'support_email_internal_helper_exposed:%:%', function_name, role_name;
      END IF;
    END LOOP;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.admin_role_action_capabilities
              WHERE action LIKE 'support_email%') THEN
    RAISE EXCEPTION 'support_email_must_not_expand_capability_map';
  END IF;
  SELECT pg_catalog.pg_get_expr(conbin, conrelid) INTO audit_check
    FROM pg_catalog.pg_constraint WHERE conrelid='public.admin_audit_log'::regclass
     AND conname='admin_audit_log_event_kind_check';
  FOREACH event_name IN ARRAY ARRAY[
    'ban_applied','suspension_lifted','report_status_changed','actor_blocked',
    'admin_login','admin_unauthorized','content_takedown','token_revoked',
    'post_pin_changed','banner_changed','token_issued','appeal_decided',
    'appeal_more_information_requested','support_email_claimed'
  ] LOOP
    EXECUTE 'SELECT ' || audit_check || ' FROM (SELECT $1::text AS event_kind) AS candidate'
      INTO event_allowed USING event_name;
    IF event_allowed IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'support_email_audit_vocabulary_lost:%',event_name;
    END IF;
  END LOOP;
END;
$verify$;
COMMIT;
