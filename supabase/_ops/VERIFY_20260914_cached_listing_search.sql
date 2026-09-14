-- Read-only integrity and privilege verification after the matching migration.
\set ON_ERROR_STOP on
BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
DO $verify$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid='search_private.item_fields'::regclass)
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid='search_private.item_fields'::regclass
      AND polname='visible_listing' AND polcmd='r'
      AND pg_catalog.pg_get_expr(polqual,polrelid) LIKE '%items%')
    OR EXISTS (SELECT 1 FROM public.items i FULL JOIN search_private.item_fields f ON f.item_id=i.id
      WHERE i.id IS NULL OR f.item_id IS NULL
      OR f.fields IS DISTINCT FROM search_private.build_fields(i.title,i.title_i18n,i.description,i.description_i18n,i.listing_details))
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_extension e JOIN pg_catalog.pg_namespace n ON n.oid=e.extnamespace
      WHERE e.extname='intarray' AND e.extversion='1.5' AND n.nspname='search_private')
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE oid IN
      ('public.search_items_fuzzy'::regproc,'public.search_items_fuzzy_v2'::regproc) AND prosecdef)
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE oid='search_private.sync_item_fields'::regproc
      AND prosecdef AND proconfig=ARRAY['search_path=pg_catalog'])
    OR (SELECT count(*) FROM pg_catalog.pg_trigger WHERE tgrelid='public.items'::regclass
      AND tgname IN ('sync_listing_search_insert','sync_listing_search_update') AND tgenabled='O')<>2
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p,
      LATERAL pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
      WHERE p.pronamespace='search_private'::regnamespace AND a.grantee=0
        -- Hosted Supabase owns trusted extension functions as supabase_admin;
        -- postgres cannot revoke those managed defaults. They are pure native
        -- utilities, not app helpers with table access. Check them separately.
        AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d
          WHERE d.classid='pg_catalog.pg_proc'::regclass AND d.objid=p.oid
            AND d.refclassid='pg_catalog.pg_extension'::regclass AND d.deptype='e'
            AND d.refobjid=(SELECT oid FROM pg_catalog.pg_extension WHERE extname='intarray')))
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_depend d
      ON d.classid='pg_catalog.pg_proc'::regclass AND d.objid=p.oid
      WHERE d.refclassid='pg_catalog.pg_extension'::regclass AND d.deptype='e'
        AND d.refobjid=(SELECT oid FROM pg_catalog.pg_extension WHERE extname='intarray')
        AND (p.prosecdef OR p.provolatile='v'))
  THEN RAISE EXCEPTION 'cached_listing_search_integrity_failed'; END IF;
  IF EXISTS (SELECT 1 FROM (VALUES ('anon'),('authenticated'),('service_role')) r(name)
    WHERE NOT has_table_privilege(name,'search_private.item_fields','SELECT')
      OR has_table_privilege(name,'search_private.item_fields','INSERT,UPDATE,DELETE,TRUNCATE')
      OR has_schema_privilege(name,'search_private','CREATE')
      OR has_function_privilege(name,'search_private.sync_item_fields()','EXECUTE')
      OR has_function_privilege(name,'search_private.build_fields(text,jsonb,text,jsonb,jsonb)','EXECUTE'))
  THEN RAISE EXCEPTION 'cached_listing_search_acl_failed'; END IF;
END $verify$;
ROLLBACK;
