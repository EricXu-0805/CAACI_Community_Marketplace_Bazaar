-- Make suspension enforcement time-correct without an expiry cron.
--
-- profiles.{suspension_level,suspended_until,shadow_banned,trust_score} are
-- retained as compatibility caches, but wall-clock expiry cannot update a
-- stored boolean by itself.  Canonical read/write decisions therefore come
-- from suspensions rows that are started, unlifted, and not expired.

BEGIN;

DO $guard$
DECLARE
  relation_name text;
  function_signature text;
  item_view_columns text[];
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'public.profiles',
    'public.suspensions',
    'public.items',
    'public.posts',
    'public.post_items',
    'public.ratings',
    'public.reports',
    'public.device_fingerprints',
    'public.items_visible',
    'public.posts_visible'
  ]::text[] LOOP
    IF pg_catalog.to_regclass(relation_name) IS NULL THEN
      RAISE EXCEPTION
        'suspension_visibility_prerequisite_missing: %', relation_name
        USING ERRCODE = '55000';
    END IF;
  END LOOP;

  FOREACH function_signature IN ARRAY ARRAY[
    'auth.uid()',
    'public.compute_trust_score(uuid)',
    'public.recompute_trust_score(uuid)',
    'public.get_my_profile()',
    'public.trg_enforce_actor()',
    'public.is_posting_allowed(uuid)',
    'public.admin_list_suspensions(integer,integer,boolean)',
    'public.admin_get_suspension_detail(uuid)',
    'public.admin_list_appeals(integer,integer)',
    'public.admin_list_warnings(integer,integer)',
    'public.admin_dashboard_stats()',
    'public.admin_search_users(text,integer)',
    'public.admin_get_linked_accounts(uuid)'
  ]::text[] LOOP
    IF pg_catalog.to_regprocedure(function_signature) IS NULL THEN
      RAISE EXCEPTION
        'suspension_visibility_prerequisite_missing: %', function_signature
        USING ERRCODE = '55000';
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('profiles', 'id', 'uuid'),
      ('profiles', 'trust_score', 'smallint'),
      ('profiles', 'shadow_banned', 'boolean'),
      ('profiles', 'suspension_level', 'smallint'),
      ('profiles', 'suspended_until', 'timestamp with time zone'),
      ('suspensions', 'id', 'uuid'),
      ('suspensions', 'profile_id', 'uuid'),
      ('suspensions', 'level', 'smallint'),
      ('suspensions', 'started_at', 'timestamp with time zone'),
      ('suspensions', 'ends_at', 'timestamp with time zone'),
      ('suspensions', 'lifted_at', 'timestamp with time zone'),
      ('items', 'user_id', 'uuid'),
      ('items', 'status', 'item_status'),
      ('items', 'listing_type', 'text'),
      ('posts', 'user_id', 'uuid'),
      ('posts', 'status', 'text'),
      ('post_items', 'post_id', 'uuid'),
      ('post_items', 'item_id', 'uuid'),
      ('post_items', 'display_order', 'integer')
    ) AS required(table_name, column_name, formatted_type)
    LEFT JOIN pg_catalog.pg_attribute AS attribute
      ON attribute.attrelid = pg_catalog.to_regclass(
        'public.' || required.table_name
      )
     AND attribute.attname = required.column_name
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped
    WHERE attribute.attname IS NULL
       OR pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)
          <> required.formatted_type
  ) THEN
    RAISE EXCEPTION
      'suspension_visibility_prerequisite_shape_mismatch'
      USING ERRCODE = '55000';
  END IF;

  SELECT pg_catalog.array_agg(attribute.attname ORDER BY attribute.attnum)
  INTO STRICT item_view_columns
  FROM pg_catalog.pg_attribute AS attribute
  WHERE attribute.attrelid = 'public.items_visible'::pg_catalog.regclass
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped;

  -- Migration 027 captured item.* before migration 054 appended listing_type.
  -- A replay has the second shape below.  Refuse any other projection drift.
  IF item_view_columns IS DISTINCT FROM ARRAY[
       'id', 'user_id', 'title', 'description', 'price', 'category',
       'condition', 'status', 'location', 'images', 'view_count',
       'created_at', 'updated_at', 'negotiable', 'image_dimensions',
       'title_i18n', 'description_i18n', 'source_lang', 'favorite_count',
       'location_verified'
     ]::text[]
     AND item_view_columns IS DISTINCT FROM ARRAY[
       'id', 'user_id', 'title', 'description', 'price', 'category',
       'condition', 'status', 'location', 'images', 'view_count',
       'created_at', 'updated_at', 'negotiable', 'image_dimensions',
       'title_i18n', 'description_i18n', 'source_lang', 'favorite_count',
       'location_verified', 'listing_type'
     ]::text[] THEN
    RAISE EXCEPTION
      'suspension_visibility_items_visible_shape_mismatch: %',
      item_view_columns
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES ('anon'), ('authenticated'), ('service_role'))
      AS required(role_name)
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_roles AS role
      WHERE role.rolname = required.role_name
    )
  ) THEN
    RAISE EXCEPTION
      'suspension_visibility_api_role_missing'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    WHERE relation.oid = 'public.items'::pg_catalog.regclass
      AND relation.relrowsecurity
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    WHERE relation.oid = 'public.posts'::pg_catalog.regclass
      AND relation.relrowsecurity
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    WHERE relation.oid = 'public.post_items'::pg_catalog.regclass
      AND relation.relrowsecurity
  ) THEN
    RAISE EXCEPTION
      'suspension_visibility_requires_feed_rls'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policy AS policy
    WHERE policy.polrelid = 'public.post_items'::pg_catalog.regclass
      AND policy.polpermissive
      AND policy.polname NOT IN (
        'Anyone can view post items',
        'Anyone can view visible post items',
        'Post owner can attach own items',
        'Post owner can detach items',
        'No updates to post_items'
      )
  ) THEN
    RAISE EXCEPTION
      'suspension_visibility_unexpected_post_item_policy'
      USING ERRCODE = '55000';
  END IF;

  -- A second permissive SELECT policy would be ORed with the replacement and
  -- silently reopen the feed.  Fail closed on schema drift.
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policy AS policy
    WHERE policy.polrelid IN (
      'public.items'::pg_catalog.regclass,
      'public.posts'::pg_catalog.regclass
    )
      AND policy.polcmd IN ('r', '*')
      AND policy.polpermissive
      AND policy.polname NOT IN (
        'Anyone can view active items',
        'Anyone can view active posts'
      )
  ) THEN
    RAISE EXCEPTION
      'suspension_visibility_unexpected_permissive_select_policy'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS function
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = function.pronamespace
    WHERE namespace.nspname = 'moderation_private'
      AND function.proname IN (
        'current_profile_state',
        'profile_content_visible'
      )
      AND function.oid NOT IN (
        COALESCE(
          pg_catalog.to_regprocedure(
            'moderation_private.current_profile_state(uuid)'
          ),
          0::oid
        ),
        COALESCE(
          pg_catalog.to_regprocedure(
            'moderation_private.profile_content_visible(uuid)'
          ),
          0::oid
        )
      )
  ) THEN
    RAISE EXCEPTION
      'suspension_visibility_unexpected_helper_overload'
      USING ERRCODE = '55000';
  END IF;
END
$guard$;

CREATE SCHEMA IF NOT EXISTS moderation_private;
REVOKE ALL ON SCHEMA moderation_private FROM PUBLIC, anon, authenticated,
  service_role;
GRANT USAGE ON SCHEMA moderation_private TO anon, authenticated, service_role;

-- One canonical state definition for every gate.  A NULL ends_at means an
-- explicit open-ended action; migration 027 represents L5 as infinity, which
-- is also naturally active under this predicate.
CREATE OR REPLACE FUNCTION moderation_private.current_profile_state(
  profile_id_in uuid
)
RETURNS TABLE (
  suspension_level smallint,
  suspended_until timestamptz,
  shadow_banned boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT
    COALESCE(
      (
        pg_catalog.array_agg(
          suspension.level
          ORDER BY
            suspension.level DESC,
            suspension.ends_at DESC NULLS FIRST,
            suspension.started_at DESC,
            suspension.id DESC
        )
      )[1],
      0::smallint
    )::smallint AS suspension_level,
    (
      pg_catalog.array_agg(
        suspension.ends_at
        ORDER BY
          suspension.level DESC,
          suspension.ends_at DESC NULLS FIRST,
          suspension.started_at DESC,
          suspension.id DESC
      )
    )[1] AS suspended_until,
    COALESCE(
      pg_catalog.bool_or(suspension.level >= 3),
      false
    ) AS shadow_banned
  FROM public.suspensions AS suspension
  WHERE suspension.profile_id = profile_id_in
    AND suspension.started_at <= pg_catalog.statement_timestamp()
    AND suspension.lifted_at IS NULL
    AND (
      suspension.ends_at IS NULL
      OR suspension.ends_at > pg_catalog.statement_timestamp()
    )
$function$;

REVOKE ALL ON FUNCTION moderation_private.current_profile_state(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- This is the only helper callable by API roles.  The schema is not exposed by
-- the Data API; EXECUTE is needed by RLS policies/security-invoker views.  It
-- returns only the same yes/no visibility answer the caller can observe by
-- reading a feed, and deliberately treats the content owner as visible.
CREATE OR REPLACE FUNCTION moderation_private.profile_content_visible(
  profile_id_in uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT
    profile_id_in = (SELECT auth.uid())
    OR NOT EXISTS (
      SELECT 1
      FROM public.suspensions AS suspension
      WHERE suspension.profile_id = profile_id_in
        AND suspension.level >= 3
        AND suspension.started_at <= pg_catalog.statement_timestamp()
        AND suspension.lifted_at IS NULL
        AND (
          suspension.ends_at IS NULL
          OR suspension.ends_at > pg_catalog.statement_timestamp()
        )
    )
$function$;

REVOKE ALL ON FUNCTION moderation_private.profile_content_visible(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION moderation_private.profile_content_visible(uuid)
  TO anon, authenticated, service_role;

CREATE INDEX IF NOT EXISTS suspensions_active_shadow_profile_idx
  ON public.suspensions (profile_id, ends_at, started_at)
  WHERE lifted_at IS NULL AND level >= 3;

-- The application reads the base tables directly for feeds/detail/search.
-- Enforcing only inside items_visible/posts_visible therefore never protected
-- those real paths.  Put the canonical predicate at the RLS trust boundary.
DROP POLICY IF EXISTS "Anyone can view active items" ON public.items;
CREATE POLICY "Anyone can view active items"
  ON public.items
  FOR SELECT
  TO anon, authenticated
  USING (
    status <> 'deleted'::public.item_status
    AND moderation_private.profile_content_visible(user_id)
  );

DROP POLICY IF EXISTS "Anyone can view active posts" ON public.posts;
CREATE POLICY "Anyone can view active posts"
  ON public.posts
  FOR SELECT
  TO anon, authenticated
  USING (
    status = 'active'
    AND moderation_private.profile_content_visible(user_id)
  );

-- The app reads posts and embeds post_items directly. RLS alone is not enough:
-- PostgreSQL checks table privileges before evaluating a policy. Historical
-- migration 041 created policies without explicit grants, which left anonymous
-- Plaza reads and every attachment write dependent on environment defaults.
GRANT SELECT ON public.posts TO anon, authenticated;
GRANT SELECT ON public.post_items TO anon, authenticated;
GRANT INSERT, DELETE ON public.post_items TO authenticated;
REVOKE UPDATE ON public.post_items FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "Anyone can view post items" ON public.post_items;
DROP POLICY IF EXISTS "Anyone can view visible post items" ON public.post_items;
CREATE POLICY "Anyone can view visible post items"
  ON public.post_items
  FOR SELECT
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.posts AS parent_post
      WHERE parent_post.id = post_id
        AND parent_post.status = 'active'
        AND moderation_private.profile_content_visible(parent_post.user_id)
    )
    AND EXISTS (
      SELECT 1
      FROM public.items AS attached_item
      WHERE attached_item.id = item_id
        AND attached_item.status <> 'deleted'::public.item_status
        AND moderation_private.profile_content_visible(attached_item.user_id)
    )
  );

DROP POLICY IF EXISTS "Post owner can attach own items" ON public.post_items;
CREATE POLICY "Post owner can attach own items"
  ON public.post_items
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.posts AS parent_post
      WHERE parent_post.id = post_id
        AND parent_post.user_id = auth.uid()
        AND parent_post.status = 'active'
    )
    AND EXISTS (
      SELECT 1
      FROM public.items AS attached_item
      WHERE attached_item.id = item_id
        AND attached_item.user_id = auth.uid()
        AND attached_item.status = 'active'::public.item_status
    )
    AND COALESCE((
      SELECT profile.suspension_level
      FROM public.get_my_profile() AS profile
    ), 5) < 2
  );

DROP POLICY IF EXISTS "Post owner can detach items" ON public.post_items;
CREATE POLICY "Post owner can detach items"
  ON public.post_items
  FOR DELETE
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.posts AS parent_post
      WHERE parent_post.id = post_id
        AND parent_post.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "No updates to post_items" ON public.post_items;
CREATE POLICY "No updates to post_items"
  ON public.post_items
  FOR UPDATE
  TO authenticated
  USING (false)
  WITH CHECK (false);

-- Privileged callers can bypass base-table RLS, so the views must repeat both
-- the lifecycle predicate and the moderation predicate.  Keep the projection
-- explicit: the original view captured the then-current items columns, while
-- listing_type was added later and is now selected by api/share.js.  Appending
-- that one required column is deliberate; future base-table columns must not
-- silently expand this public API contract.
CREATE OR REPLACE VIEW public.items_visible
WITH (security_invoker = true, security_barrier = true)
AS
SELECT
  item.id,
  item.user_id,
  item.title,
  item.description,
  item.price,
  item.category,
  item.condition,
  item.status,
  item.location,
  item.images,
  item.view_count,
  item.created_at,
  item.updated_at,
  item.negotiable,
  item.image_dimensions,
  item.title_i18n,
  item.description_i18n,
  item.source_lang,
  item.favorite_count,
  item.location_verified,
  item.listing_type
FROM public.items AS item
WHERE item.status <> 'deleted'::public.item_status
  AND moderation_private.profile_content_visible(item.user_id);

CREATE OR REPLACE VIEW public.posts_visible
WITH (security_invoker = true, security_barrier = true)
AS
SELECT
  post.id,
  post.user_id,
  post.content,
  post.images,
  post.is_official,
  post.is_pinned,
  post.like_count,
  post.comment_count,
  post.status,
  post.created_at,
  post.updated_at
FROM public.posts AS post
WHERE post.status = 'active'
  AND moderation_private.profile_content_visible(post.user_id);

REVOKE ALL ON public.items_visible, public.posts_visible FROM PUBLIC;
GRANT SELECT ON public.items_visible, public.posts_visible
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.compute_trust_score(profile_id_in uuid)
RETURNS smallint
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
DECLARE
  score integer := 50;
  age_days integer;
  good_ratings integer;
  report_count integer;
  recent_suspensions integer;
  has_active_suspension boolean;
  has_active_shadow_suspension boolean;
  sibling_alts integer;
  profile_created_at timestamptz;
  current_state record;
BEGIN
  IF profile_id_in IS NULL THEN
    RETURN 50::smallint;
  END IF;

  SELECT profile.created_at
  INTO profile_created_at
  FROM public.profiles AS profile
  WHERE profile.id = profile_id_in;

  IF profile_created_at IS NULL THEN
    RETURN 50::smallint;
  END IF;

  SELECT *
  INTO STRICT current_state
  FROM moderation_private.current_profile_state(profile_id_in);

  has_active_suspension := current_state.suspension_level >= 2;
  has_active_shadow_suspension := current_state.shadow_banned;

  age_days := GREATEST(
    0,
    pg_catalog.statement_timestamp()::date - profile_created_at::date
  );
  score := score + LEAST(10, age_days / 7);

  SELECT pg_catalog.count(*)::integer
  INTO good_ratings
  FROM public.ratings AS rating
  WHERE rating.ratee_id = profile_id_in
    AND rating.stars >= 4;
  score := score + LEAST(20, good_ratings * 2);

  SELECT pg_catalog.count(*)::integer
  INTO report_count
  FROM public.reports AS report
  WHERE report.target_type = 'user'
    AND report.target_id = profile_id_in
    AND report.status IN ('pending', 'reviewed');
  score := score - LEAST(30, report_count * 5);

  SELECT pg_catalog.count(*)::integer
  INTO recent_suspensions
  FROM public.suspensions AS suspension
  WHERE suspension.profile_id = profile_id_in
    AND suspension.started_at >
      pg_catalog.statement_timestamp() - interval '180 days'
    AND suspension.level >= 2;
  score := score - LEAST(30, recent_suspensions * 10);

  IF has_active_suspension THEN
    score := score - 15;
  END IF;
  IF has_active_shadow_suspension THEN
    score := score - 10;
  END IF;

  SELECT pg_catalog.count(DISTINCT other_fingerprint.profile_id)::integer
  INTO sibling_alts
  FROM public.device_fingerprints AS own_fingerprint
  JOIN public.device_fingerprints AS other_fingerprint
    ON other_fingerprint.fp_hash = own_fingerprint.fp_hash
   AND other_fingerprint.profile_id <> own_fingerprint.profile_id
  WHERE own_fingerprint.profile_id = profile_id_in;
  score := score - LEAST(16, sibling_alts * 8);

  RETURN GREATEST(0, LEAST(100, score))::smallint;
END
$function$;

REVOKE ALL ON FUNCTION public.compute_trust_score(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- Every server-side write gate now reads the immutable action log, so an
-- overwritten or expired profile cache cannot accidentally allow/block writes.
CREATE OR REPLACE FUNCTION public.trg_enforce_actor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  actor_id uuid;
  current_state record;
BEGIN
  IF TG_TABLE_NAME = 'posts' THEN
    actor_id := NEW.user_id;
  ELSIF TG_TABLE_NAME = 'post_comments' THEN
    actor_id := NEW.user_id;
  ELSIF TG_TABLE_NAME = 'items' THEN
    actor_id := NEW.user_id;
  ELSIF TG_TABLE_NAME = 'messages' THEN
    actor_id := NEW.sender_id;
  END IF;

  IF actor_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NOT NULL AND actor_id <> auth.uid() THEN
    RETURN NEW;
  END IF;

  SELECT *
  INTO STRICT current_state
  FROM moderation_private.current_profile_state(actor_id);

  IF current_state.suspension_level >= 2 THEN
    RAISE EXCEPTION 'suspension_active:%:%',
      current_state.suspension_level,
      CASE
        WHEN current_state.suspended_until IS NULL
          OR current_state.suspended_until = 'infinity'::timestamptz
          THEN 'permanent'
        ELSE pg_catalog.to_char(
          current_state.suspended_until AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS"Z"'
        )
      END;
  END IF;

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.trg_enforce_actor()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_posting_allowed(profile_id_in uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT state.suspension_level < 2
  FROM moderation_private.current_profile_state(profile_id_in) AS state
$function$;

REVOKE ALL ON FUNCTION public.is_posting_allowed(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_posting_allowed(uuid)
  TO service_role;

COMMENT ON FUNCTION public.is_posting_allowed(uuid) IS
  'Internal/service-only canonical posting gate. API roles must use caller-bound write policies and get_my_profile; exposing an arbitrary profile_id would reveal private suspension state.';

-- get_my_profile is the source of the app-wide suspension gate.  Override only
-- the four compatibility-cache fields in the returned composite; do not mutate
-- the stored row on reads.
CREATE OR REPLACE FUNCTION public.get_my_profile()
RETURNS public.profiles
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT pg_catalog.jsonb_populate_record(
    profile,
    pg_catalog.jsonb_build_object(
      'suspension_level', state.suspension_level,
      'suspended_until', state.suspended_until,
      'shadow_banned', state.shadow_banned,
      'trust_score', public.compute_trust_score(profile.id)
    )
  )
  FROM public.profiles AS profile
  CROSS JOIN LATERAL moderation_private.current_profile_state(profile.id)
    AS state
  WHERE profile.id = auth.uid()
  LIMIT 1
$function$;

REVOKE ALL ON FUNCTION public.get_my_profile()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_profile()
  TO authenticated;

-- Reconcile only profiles that have moderation history or non-default cached
-- state.  This avoids locking/scoring every ordinary account during deploy.
WITH moderation_state AS MATERIALIZED (
  SELECT
    profile.id,
    state.suspension_level,
    state.suspended_until,
    state.shadow_banned,
    public.compute_trust_score(profile.id) AS trust_score
  FROM public.profiles AS profile
  CROSS JOIN LATERAL moderation_private.current_profile_state(profile.id)
    AS state
  WHERE profile.suspension_level <> 0
     OR profile.suspended_until IS NOT NULL
     OR profile.shadow_banned
     OR EXISTS (
       SELECT 1
       FROM public.suspensions AS suspension
       WHERE suspension.profile_id = profile.id
     )
)
UPDATE public.profiles AS profile
SET suspension_level = state.suspension_level,
    suspended_until = state.suspended_until,
    shadow_banned = state.shadow_banned,
    trust_score = state.trust_score
FROM moderation_state AS state
WHERE profile.id = state.id
  AND (
    profile.suspension_level IS DISTINCT FROM state.suspension_level
    OR profile.suspended_until IS DISTINCT FROM state.suspended_until
    OR profile.shadow_banned IS DISTINCT FROM state.shadow_banned
    OR profile.trust_score IS DISTINCT FROM state.trust_score
  );

-- Admin surfaces must not reintroduce stale profile caches after the public
-- paths are fixed.  Keep the existing RPC signatures/output columns so the
-- edge API and dashboard remain rollout-compatible.
CREATE OR REPLACE FUNCTION public.admin_list_suspensions(
  limit_in integer DEFAULT 50,
  offset_in integer DEFAULT 0,
  active_only_in boolean DEFAULT false
)
RETURNS TABLE (
  id uuid,
  profile_id uuid,
  profile_nickname text,
  profile_avatar_url text,
  level smallint,
  reason text,
  category text,
  started_at timestamptz,
  ends_at timestamptz,
  lifted_at timestamptz,
  appeal_note text,
  has_appeal boolean,
  created_at timestamptz,
  issued_by uuid,
  issued_by_nickname text,
  lifted_by uuid,
  lifted_by_nickname text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT
    suspension.id,
    suspension.profile_id,
    profile.nickname,
    profile.avatar_url,
    suspension.level,
    suspension.reason,
    suspension.category,
    suspension.started_at,
    suspension.ends_at,
    suspension.lifted_at,
    suspension.appeal_note,
    suspension.appeal_note IS NOT NULL,
    suspension.created_at,
    suspension.issued_by,
    issuer.nickname,
    suspension.lifted_by,
    lifter.nickname
  FROM public.suspensions AS suspension
  JOIN public.profiles AS profile
    ON profile.id = suspension.profile_id
  LEFT JOIN public.profiles AS issuer
    ON issuer.id = suspension.issued_by
  LEFT JOIN public.profiles AS lifter
    ON lifter.id = suspension.lifted_by
  WHERE NOT active_only_in
     OR (
       suspension.started_at <= pg_catalog.statement_timestamp()
       AND suspension.lifted_at IS NULL
       AND (
         suspension.ends_at IS NULL
         OR suspension.ends_at > pg_catalog.statement_timestamp()
       )
     )
  ORDER BY suspension.created_at DESC
  LIMIT GREATEST(1, LEAST(limit_in, 200))
  OFFSET GREATEST(0, offset_in)
$function$;

REVOKE ALL ON FUNCTION public.admin_list_suspensions(integer, integer, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_suspensions(integer, integer, boolean)
  TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_suspension_detail(
  suspension_id_in uuid
)
RETURNS TABLE (
  id uuid,
  profile_id uuid,
  profile_nickname text,
  profile_avatar_url text,
  profile_email text,
  profile_trust_score smallint,
  profile_warning_count integer,
  level smallint,
  reason text,
  category text,
  started_at timestamptz,
  ends_at timestamptz,
  lifted_at timestamptz,
  lifted_by uuid,
  lifted_by_nickname text,
  lift_reason text,
  appeal_note text,
  issued_by uuid,
  issued_by_nickname text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT
    suspension.id,
    suspension.profile_id,
    profile.nickname,
    profile.avatar_url,
    profile.email,
    public.compute_trust_score(profile.id),
    profile.warning_count,
    suspension.level,
    suspension.reason,
    suspension.category,
    suspension.started_at,
    suspension.ends_at,
    suspension.lifted_at,
    suspension.lifted_by,
    lifter.nickname,
    suspension.lift_reason,
    suspension.appeal_note,
    suspension.issued_by,
    issuer.nickname,
    suspension.created_at
  FROM public.suspensions AS suspension
  JOIN public.profiles AS profile
    ON profile.id = suspension.profile_id
  LEFT JOIN public.profiles AS issuer
    ON issuer.id = suspension.issued_by
  LEFT JOIN public.profiles AS lifter
    ON lifter.id = suspension.lifted_by
  WHERE suspension.id = suspension_id_in
$function$;

REVOKE ALL ON FUNCTION public.admin_get_suspension_detail(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_get_suspension_detail(uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.admin_list_appeals(
  limit_in integer DEFAULT 50,
  offset_in integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  profile_id uuid,
  profile_nickname text,
  profile_avatar_url text,
  level smallint,
  reason text,
  ends_at timestamptz,
  appeal_note text,
  created_at timestamptz,
  issued_by uuid,
  issued_by_nickname text,
  lifted_by uuid,
  lifted_by_nickname text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  -- "Appeal" means pending human review, not that the underlying action is
  -- still active.  There is no separate appeal decision/status ledger yet;
  -- dropping expired rows here would silently remove unresolved cases from
  -- the only review queue.  The dashboard labels expiry and suppresses Lift.
  SELECT
    suspension.id,
    suspension.profile_id,
    profile.nickname,
    profile.avatar_url,
    suspension.level,
    suspension.reason,
    suspension.ends_at,
    suspension.appeal_note,
    suspension.created_at,
    suspension.issued_by,
    issuer.nickname,
    suspension.lifted_by,
    lifter.nickname
  FROM public.suspensions AS suspension
  JOIN public.profiles AS profile
    ON profile.id = suspension.profile_id
  LEFT JOIN public.profiles AS issuer
    ON issuer.id = suspension.issued_by
  LEFT JOIN public.profiles AS lifter
    ON lifter.id = suspension.lifted_by
  WHERE suspension.appeal_note IS NOT NULL
    AND suspension.lifted_at IS NULL
  ORDER BY suspension.created_at DESC
  LIMIT GREATEST(1, LEAST(limit_in, 200))
  OFFSET GREATEST(0, offset_in)
$function$;

REVOKE ALL ON FUNCTION public.admin_list_appeals(integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_appeals(integer, integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.admin_list_warnings(
  limit_in integer DEFAULT 50,
  offset_in integer DEFAULT 0
)
RETURNS TABLE (
  profile_id uuid,
  nickname text,
  avatar_url text,
  trust_score smallint,
  warning_count integer,
  shadow_banned boolean,
  suspension_level smallint,
  suspended_until timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  WITH candidate_ids AS MATERIALIZED (
    SELECT profile.id
    FROM public.profiles AS profile
    WHERE profile.warning_count > 0

    UNION

    SELECT suspension.profile_id
    FROM public.suspensions AS suspension
    WHERE suspension.level >= 2
      AND suspension.started_at <= pg_catalog.statement_timestamp()
      AND suspension.lifted_at IS NULL
      AND (
        suspension.ends_at IS NULL
        OR suspension.ends_at > pg_catalog.statement_timestamp()
      )
  ),
  candidates AS MATERIALIZED (
    SELECT
      profile.id,
      profile.nickname,
      profile.avatar_url,
      profile.warning_count,
      state.shadow_banned,
      state.suspension_level,
      state.suspended_until
    FROM candidate_ids
    JOIN public.profiles AS profile
      ON profile.id = candidate_ids.id
    CROSS JOIN LATERAL moderation_private.current_profile_state(profile.id)
      AS state
  ),
  scored AS MATERIALIZED (
    SELECT
      candidate.*,
      public.compute_trust_score(candidate.id) AS trust_score
    FROM candidates AS candidate
  )
  SELECT
    scored.id,
    scored.nickname,
    scored.avatar_url,
    scored.trust_score,
    scored.warning_count,
    scored.shadow_banned,
    scored.suspension_level,
    scored.suspended_until
  FROM scored
  ORDER BY
    scored.warning_count DESC,
    scored.trust_score ASC,
    scored.id
  LIMIT GREATEST(1, LEAST(limit_in, 200))
  OFFSET GREATEST(0, offset_in)
$function$;

REVOKE ALL ON FUNCTION public.admin_list_warnings(integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_warnings(integer, integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.admin_dashboard_stats()
RETURNS TABLE (
  active_suspensions integer,
  pending_reports integer,
  pending_appeals integer,
  shadow_banned integer,
  oldest_pending_hours integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT
    (
      -- Keep unresolved expired appeals in the human-review count; this is
      -- intentionally distinct from active_suspensions above.
      SELECT pg_catalog.count(*)::integer
      FROM public.suspensions AS suspension
      WHERE suspension.level >= 2
        AND suspension.started_at <= pg_catalog.statement_timestamp()
        AND suspension.lifted_at IS NULL
        AND (
          suspension.ends_at IS NULL
          OR suspension.ends_at > pg_catalog.statement_timestamp()
        )
    ),
    (
      SELECT pg_catalog.count(*)::integer
      FROM public.reports AS report
      WHERE report.status = 'pending'
    ),
    (
      SELECT pg_catalog.count(*)::integer
      FROM public.suspensions AS suspension
      WHERE suspension.appeal_note IS NOT NULL
        AND suspension.lifted_at IS NULL
    ),
    (
      SELECT pg_catalog.count(DISTINCT suspension.profile_id)::integer
      FROM public.suspensions AS suspension
      WHERE suspension.level >= 3
        AND suspension.started_at <= pg_catalog.statement_timestamp()
        AND suspension.lifted_at IS NULL
        AND (
          suspension.ends_at IS NULL
          OR suspension.ends_at > pg_catalog.statement_timestamp()
        )
    ),
    (
      SELECT pg_catalog.floor(
        EXTRACT(
          epoch FROM (
            pg_catalog.statement_timestamp() - pg_catalog.min(report.created_at)
          )
        ) / 3600
      )::integer
      FROM public.reports AS report
      WHERE report.status = 'pending'
    )
$function$;

REVOKE ALL ON FUNCTION public.admin_dashboard_stats()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_dashboard_stats()
  TO service_role;

CREATE OR REPLACE FUNCTION public.admin_search_users(
  query_in text,
  limit_in integer DEFAULT 25
)
RETURNS TABLE (
  id uuid,
  nickname text,
  email text,
  avatar_url text,
  trust_score smallint,
  warning_count integer,
  suspension_level smallint,
  suspended_until timestamptz,
  shadow_banned boolean,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT
    profile.id,
    profile.nickname,
    profile.email,
    profile.avatar_url,
    public.compute_trust_score(profile.id),
    profile.warning_count,
    state.suspension_level,
    state.suspended_until,
    state.shadow_banned,
    profile.created_at
  FROM public.profiles AS profile
  CROSS JOIN LATERAL moderation_private.current_profile_state(profile.id)
    AS state
  WHERE pg_catalog.btrim(COALESCE(query_in, '')) <> ''
    AND (
      profile.nickname ILIKE '%' || pg_catalog.btrim(query_in) || '%'
      OR profile.email ILIKE '%' || pg_catalog.btrim(query_in) || '%'
      OR profile.id::text = pg_catalog.btrim(query_in)
    )
  ORDER BY
    (state.suspension_level > 0) DESC,
    profile.warning_count DESC,
    profile.nickname,
    profile.id
  LIMIT GREATEST(
    1,
    LEAST(COALESCE(limit_in, 25), 50)
  )
$function$;

REVOKE ALL ON FUNCTION public.admin_search_users(text, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_search_users(text, integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_linked_accounts(
  profile_id_in uuid
)
RETURNS TABLE (
  id uuid,
  nickname text,
  email text,
  avatar_url text,
  suspension_level smallint,
  shadow_banned boolean,
  shared_devices bigint,
  last_seen timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  WITH linked AS (
    SELECT
      profile.id,
      profile.nickname,
      profile.email,
      profile.avatar_url,
      pg_catalog.count(DISTINCT other_fingerprint.fp_hash) AS shared_devices,
      pg_catalog.max(other_fingerprint.last_seen) AS last_seen
    FROM public.device_fingerprints AS own_fingerprint
    JOIN public.device_fingerprints AS other_fingerprint
      ON other_fingerprint.fp_hash = own_fingerprint.fp_hash
     AND other_fingerprint.profile_id <> own_fingerprint.profile_id
    JOIN public.profiles AS profile
      ON profile.id = other_fingerprint.profile_id
    WHERE own_fingerprint.profile_id = profile_id_in
    GROUP BY
      profile.id,
      profile.nickname,
      profile.email,
      profile.avatar_url
  )
  SELECT
    linked.id,
    linked.nickname,
    linked.email,
    linked.avatar_url,
    state.suspension_level,
    state.shadow_banned,
    linked.shared_devices,
    linked.last_seen
  FROM linked
  CROSS JOIN LATERAL moderation_private.current_profile_state(linked.id)
    AS state
  ORDER BY linked.shared_devices DESC, linked.last_seen DESC NULLS LAST
  LIMIT 50
$function$;

REVOKE ALL ON FUNCTION public.admin_get_linked_accounts(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_get_linked_accounts(uuid)
  TO service_role;

COMMENT ON FUNCTION moderation_private.current_profile_state(uuid) IS
  'Canonical started, unlifted, unexpired suspension state; profile moderation columns are compatibility caches only.';
COMMENT ON FUNCTION moderation_private.profile_content_visible(uuid) IS
  'RLS/view helper: content owner sees self; everyone else sees profiles without a current L3+ action.';
COMMENT ON FUNCTION public.compute_trust_score(uuid) IS
  'Computes trust from live signals; active and shadow penalties use canonical suspensions rather than cached profile booleans.';

NOTIFY pgrst, 'reload schema';

COMMIT;
