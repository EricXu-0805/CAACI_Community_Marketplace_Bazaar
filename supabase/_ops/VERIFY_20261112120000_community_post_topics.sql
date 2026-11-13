-- Read-only verification for 20261112120000_community_post_topics.sql
-- (ENGINEERING §5.1). Column ACL baseline: 20260719151729_reconcile_plaza_base_table_acl.sql:397-409.
\set ON_ERROR_STOP on
BEGIN;
SET TRANSACTION READ ONLY;
DO $verify$
DECLARE
  role_name text;
  object_name text;
  routine record;
  column_list text;
  view_columns text[];
BEGIN
  SELECT pg_catalog.string_agg(
           attribute.attname || ':' || attribute.attnotnull::text || ':'
             || coalesce(pg_catalog.pg_get_expr(def.adbin, def.adrelid), ''),
           ',' ORDER BY attribute.attname)
    INTO column_list
    FROM pg_catalog.pg_attribute AS attribute
    LEFT JOIN pg_catalog.pg_attrdef AS def
      ON def.adrelid = attribute.attrelid AND def.adnum = attribute.attnum
   WHERE attribute.attrelid = 'public.posts'::regclass AND NOT attribute.attisdropped
     AND attribute.attname IN ('title', 'category', 'region');
  IF column_list IS DISTINCT FROM 'category:false:,region:true:''cu''::text,title:false:' THEN
    RAISE EXCEPTION 'community_topics_column_shape_invalid:%', column_list;
  END IF;

  FOREACH object_name IN ARRAY ARRAY[
    'posts_topic_metadata_check', 'posts_topic_body_check', 'posts_region_check'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                    WHERE conrelid = 'public.posts'::regclass AND conname = object_name
                      AND contype = 'c' AND convalidated) THEN
      RAISE EXCEPTION 'community_topics_constraint_missing:%', object_name;
    END IF;
  END LOOP;
  FOREACH object_name IN ARRAY ARRAY['public.idx_posts_category_feed', 'public.idx_posts_title_trgm'] LOOP
    IF pg_catalog.to_regclass(object_name) IS NULL THEN
      RAISE EXCEPTION 'community_topics_index_missing:%', object_name;
    END IF;
  END LOOP;

  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH object_name IN ARRAY ARRAY['title', 'category', 'region'] LOOP
      IF NOT pg_catalog.has_column_privilege(role_name, 'public.posts', object_name, 'SELECT') THEN
        RAISE EXCEPTION 'community_topics_select_missing:%:%', role_name, object_name;
      END IF;
    END LOOP;
    IF pg_catalog.has_column_privilege(role_name, 'public.posts', 'region', 'INSERT')
       OR pg_catalog.has_column_privilege(role_name, 'public.posts', 'region', 'UPDATE') THEN
      RAISE EXCEPTION 'community_topics_region_writable:%', role_name;
    END IF;
  END LOOP;
  IF pg_catalog.has_any_column_privilege('anon', 'public.posts', 'INSERT,UPDATE') THEN
    RAISE EXCEPTION 'community_topics_anon_writable';
  END IF;
  SELECT pg_catalog.string_agg(attname::text, ',' ORDER BY attname) INTO column_list
    FROM pg_catalog.pg_attribute
   WHERE attrelid = 'public.posts'::regclass AND attnum > 0 AND NOT attisdropped
     AND pg_catalog.has_column_privilege('authenticated', 'public.posts', attname, 'INSERT');
  IF column_list IS DISTINCT FROM
     'category,content,content_i18n,id,image_dimensions,images,source_lang,title,user_id' THEN
    RAISE EXCEPTION 'community_topics_insert_acl_drift:%', column_list;
  END IF;
  SELECT pg_catalog.string_agg(attname::text, ',' ORDER BY attname) INTO column_list
    FROM pg_catalog.pg_attribute
   WHERE attrelid = 'public.posts'::regclass AND attnum > 0 AND NOT attisdropped
     AND pg_catalog.has_column_privilege('authenticated', 'public.posts', attname, 'UPDATE');
  IF column_list IS DISTINCT FROM 'content_i18n' THEN
    RAISE EXCEPTION 'community_topics_update_acl_drift:%', column_list;
  END IF;

  SELECT * INTO routine FROM pg_catalog.pg_proc
   WHERE oid = pg_catalog.to_regprocedure(
     'public.search_community_posts(text[],text,integer,integer,text,text)');
  IF NOT FOUND OR routine.prosecdef
     OR NOT ('statement_timeout=3s' = ANY (routine.proconfig))
     OR NOT pg_catalog.has_function_privilege('anon', routine.oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated', routine.oid, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(routine.proacl) AS acl
                 WHERE acl.grantee = 0) THEN
    RAISE EXCEPTION 'community_topics_search_rpc_contract_invalid';
  END IF;

  FOREACH object_name IN ARRAY ARRAY[
    'public.capture_report_target_snapshot()', 'public.admin_get_report_detail(uuid)'] LOOP
    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF pg_catalog.has_function_privilege(role_name, object_name, 'EXECUTE') THEN
        RAISE EXCEPTION 'community_topics_evidence_function_exposed:%:%', object_name, role_name;
      END IF;
    END LOOP;
  END LOOP;
  IF NOT pg_catalog.has_function_privilege('service_role', 'public.admin_get_report_detail(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'community_topics_report_detail_service_role_missing';
  END IF;

  SELECT pg_catalog.array_agg(attname::text ORDER BY attnum) INTO view_columns
    FROM pg_catalog.pg_attribute
   WHERE attrelid = 'public.posts_visible'::regclass AND attnum > 0 AND NOT attisdropped;
  IF view_columns IS DISTINCT FROM ARRAY[
      'id', 'user_id', 'content', 'images', 'is_official', 'is_pinned', 'like_count',
      'comment_count', 'status', 'created_at', 'updated_at',
      'source_lang', 'title', 'category', 'region'] THEN
    RAISE EXCEPTION 'community_topics_posts_visible_columns:%', pg_catalog.array_to_string(view_columns, ',');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class
                  WHERE oid = 'public.posts_visible'::regclass
                    AND reloptions @> ARRAY['security_invoker=true', 'security_barrier=true']) THEN
    RAISE EXCEPTION 'community_topics_posts_visible_options';
  END IF;
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF NOT pg_catalog.has_table_privilege(role_name, 'public.posts_visible', 'SELECT') THEN
      RAISE EXCEPTION 'community_topics_posts_visible_select_missing:%', role_name;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class AS relation, pg_catalog.aclexplode(relation.relacl) AS acl
              WHERE relation.oid = 'public.posts_visible'::regclass AND acl.grantee = 0) THEN
    RAISE EXCEPTION 'community_topics_posts_visible_public_grant';
  END IF;
END;
$verify$;
ROLLBACK;
