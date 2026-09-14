-- Avoid a private suspension lookup for every item in browse and search.
-- Search RPC definitions and write policies are unchanged.
-- The private set helper preserves the existing visibility helper semantics.
DO $guard$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid='public.items'::regclass)
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE oid IN
      ('public.search_items_fuzzy'::regproc,'public.search_items_fuzzy_v2'::regproc) AND prosecdef)
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid='public.items'::regclass
      AND polname='Anyone can view active items' AND polcmd='r'
      AND (pg_catalog.pg_get_expr(polqual,polrelid) LIKE '%moderation_private.profile_content_visible(user_id)%'
        OR pg_catalog.pg_get_expr(polqual,polrelid) LIKE '%moderation_private.hidden_content_profile_ids()%'))
  THEN RAISE EXCEPTION 'listing_search_security_boundary_drift'; END IF;
END;
$guard$;

-- Preserve every current visibility rule while evaluating the row-independent
-- suspension set once per statement. STABLE is not a cross-request cache:
-- new suspensions, lifts and wall-clock expiry are re-read on the next statement.
CREATE OR REPLACE FUNCTION moderation_private.hidden_content_profile_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog
AS $$
  SELECT DISTINCT s.profile_id FROM public.suspensions s
  WHERE s.profile_id IS NOT NULL
    AND s.profile_id IS DISTINCT FROM (SELECT auth.uid())
    AND s.level>=3
    AND s.started_at<=pg_catalog.statement_timestamp()
    AND s.lifted_at IS NULL
    AND (s.ends_at IS NULL OR s.ends_at>pg_catalog.statement_timestamp())
$$;
REVOKE ALL ON FUNCTION moderation_private.hidden_content_profile_ids() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION moderation_private.hidden_content_profile_ids() TO anon,authenticated,service_role;
COMMENT ON FUNCTION moderation_private.hidden_content_profile_ids() IS
  'Private RLS helper: active level-three suspension IDs, excluding the caller. Never expose moderation_private through the Data API.';

ALTER POLICY "Anyone can view active items" ON public.items USING (
  status<>'deleted'
  AND (user_id=(SELECT auth.uid()) OR user_id IS NULL
    OR user_id NOT IN (SELECT moderation_private.hidden_content_profile_ids()))
);

NOTIFY pgrst, 'reload schema';
