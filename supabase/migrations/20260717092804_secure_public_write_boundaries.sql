-- =============================================================================
-- Close public write-boundary gaps found in the 2026-07-17 full-project audit.
--
-- This is deliberately forward-only: older migrations describe what was once
-- intended, while this migration makes the effective schema safe and
-- reproducible without rewriting deployed history.
--
-- Client contracts checked before narrowing grants:
--   items INSERT  useItems.createItem; UPDATE useItems.updateItem/status
--   posts INSERT  usePlaza.createPost; UPDATE async content_i18n fill
--   messages INSERT useMessages.sendMessage; UPDATE recipient is_read only
--   comments INSERT usePlaza.createComment; UPDATE policy retains content edits
--   reports INSERT useModeration.reportTarget
--   profiles UPDATE useAuth.updateProfile; fallback INSERT remains safe-column only
--   ratings INSERT useRatings.submitRating
--   conversations INSERT/getOrCreate; UPDATE per-participant pin/mute flags
--
-- Trusted postgres/service_role table writes and trigger writes are unaffected
-- by grants to the API roles. Every SECURITY DEFINER entry point below uses a
-- fixed search_path and an explicit role allow-list.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Data integrity: price is never negative at the database boundary.
--    NOT VALID avoids a long table scan while adding the constraint; VALIDATE
--    then proves existing rows also comply. If legacy bad data exists, deploy
--    fails visibly instead of silently rewriting user data.
-- -----------------------------------------------------------------------------
DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conname = 'items_price_nonnegative'
      AND conrelid = 'public.items'::pg_catalog.regclass
  ) THEN
    ALTER TABLE public.items
      ADD CONSTRAINT items_price_nonnegative CHECK (price >= 0) NOT VALID;
  END IF;
END
$migration$;

ALTER TABLE public.items VALIDATE CONSTRAINT items_price_nonnegative;

-- -----------------------------------------------------------------------------
-- 2. Signup profile creation: never leave a valid auth account without its
--    profile row. Preserve the OAuth nickname preference chain, but normalize
--    it to the UI's 30-character limit and replace rejected/broken metadata with
--    a known-safe fallback. If even the fallback insert fails, let the auth
--    transaction fail visibly rather than swallowing the error into a half-user.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  candidate_nickname text;
  safe_nickname text := 'Illini User';
BEGIN
  candidate_nickname := pg_catalog.left(
    COALESCE(
      NULLIF(pg_catalog.btrim(NEW.raw_user_meta_data ->> 'nickname'), ''),
      NULLIF(pg_catalog.btrim(NEW.raw_user_meta_data ->> 'full_name'), ''),
      NULLIF(pg_catalog.btrim(NEW.raw_user_meta_data ->> 'name'), ''),
      NULLIF(pg_catalog.btrim(pg_catalog.split_part(NEW.email, '@', 1)), ''),
      'Illini User'
    ),
    30
  );

  -- The profile moderation trigger remains authoritative. This preflight lets
  -- signup safely fall back instead of turning a rejected metadata nickname
  -- into a missing profile. Any moderation-infrastructure error also fails
  -- closed to the fallback value, without logging the user-supplied nickname.
  BEGIN
    IF public.content_moderation_check(candidate_nickname) IS NULL THEN
      safe_nickname := candidate_nickname;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user nickname preflight failed for %, using fallback (SQLSTATE %)',
      NEW.id, SQLSTATE;
  END;

  BEGIN
    INSERT INTO public.profiles (
      id,
      email,
      nickname,
      is_illini_verified,
      uid
    )
    VALUES (
      NEW.id,
      NEW.email,
      safe_nickname,
      pg_catalog.lower(COALESCE(NEW.email, '')) LIKE '%@illinois.edu',
      public.generate_uid()
    )
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    -- A constraint/moderation race in the preferred insert gets one minimal,
    -- deterministic retry. This block intentionally has no catch: a failure
    -- here aborts signup, preserving the auth<->profile invariant.
    RAISE WARNING 'handle_new_user preferred profile insert failed for %, retrying safe fallback (SQLSTATE %)',
      NEW.id, SQLSTATE;

    INSERT INTO public.profiles (
      id,
      email,
      nickname,
      is_illini_verified,
      uid
    )
    VALUES (
      NEW.id,
      NEW.email,
      'Illini User',
      pg_catalog.lower(COALESCE(NEW.email, '')) LIKE '%@illinois.edu',
      public.generate_uid()
    )
    ON CONFLICT (id) DO NOTHING;
  END;

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.handle_new_user()
  FROM PUBLIC, anon, authenticated, service_role;

-- Migration 072's verification-column trigger is SECURITY INVOKER by design,
-- but its later CREATE OR REPLACE left a role-mutable search_path.  It uses no
-- application relations, so pin it to pg_catalog without changing behavior.
ALTER FUNCTION public.guard_illini_verify_columns()
  SET search_path = pg_catalog;
REVOKE ALL ON FUNCTION public.guard_illini_verify_columns()
  FROM PUBLIC, anon, authenticated, service_role;

-- Repair any half-accounts produced by the historical swallowed-exception
-- behavior. Their original nickname metadata may be the value that moderation
-- rejected, so the backfill intentionally uses the same known-safe fallback.
INSERT INTO public.profiles (
  id,
  email,
  nickname,
  is_illini_verified,
  uid
)
SELECT
  auth_user.id,
  auth_user.email,
  'Illini User',
  pg_catalog.lower(COALESCE(auth_user.email, '')) LIKE '%@illinois.edu',
  public.generate_uid()
FROM auth.users AS auth_user
LEFT JOIN public.profiles AS existing_profile
  ON existing_profile.id = auth_user.id
WHERE existing_profile.id IS NULL
ON CONFLICT (id) DO NOTHING;

-- Account-intent overloads for consent/onboarding writes. auth.uid() alone
-- authorizes the *current* session, but a slow A-page request can otherwise
-- resume after the browser switches to B and legitimately mutate B. Requiring
-- the page-captured UID makes that stale intent fail before any write. The
-- historical signatures remain available during the rolling frontend deploy;
-- current clients use only these guarded overloads.
DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (
      VALUES
        ('tos_version'),
        ('consented_at'),
        ('onboarded_at'),
        ('campus_area')
    ) AS required_column(name)
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
      WHERE attribute.attrelid = 'public.profiles'::pg_catalog.regclass
        AND attribute.attname = required_column.name
        AND NOT attribute.attisdropped
    )
  ) THEN
    RAISE EXCEPTION 'migration_precheck_failed: profile consent/onboarding columns missing';
  END IF;
END
$migration$;

-- The client route gate compares the stored string with the current release.
-- Historically record_consent(text) accepted any short string, so a caller
-- could persist e.g. "9999" and bypass every future re-consent prompt.  Only
-- the seeded value, the immediately previous production release, and this
-- release are valid states.  Unknown/future values are untrusted evidence and
-- are reset so the user must consent again through a release-bound RPC.
UPDATE public.profiles
SET tos_version = '0',
    consented_at = NULL
WHERE tos_version IS NULL
   OR tos_version NOT IN ('0', '2026-04-20', '2026-07-18');

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.profiles'::pg_catalog.regclass
      AND conname = 'profiles_tos_version_release_allowlist'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_tos_version_release_allowlist
      CHECK (tos_version IN ('0', '2026-04-20', '2026-07-18'))
      NOT VALID;
  END IF;
END
$migration$;

ALTER TABLE public.profiles
  VALIDATE CONSTRAINT profiles_tos_version_release_allowlist;

CREATE OR REPLACE FUNCTION public.record_consent(
  version_in text,
  expected_user_id_in uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  caller_id uuid := auth.uid();
  cleaned_version text;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF expected_user_id_in IS NULL OR expected_user_id_in <> caller_id THEN
    RAISE EXCEPTION 'account_changed' USING ERRCODE = '42501';
  END IF;

  IF version_in IS DISTINCT FROM '2026-07-18' THEN
    RAISE EXCEPTION 'invalid_version' USING ERRCODE = '22023';
  END IF;
  cleaned_version := '2026-07-18';

  -- Consent versions are compared by the same sortable string contract used
  -- by App.vue.  The conditional write makes retries first-writer-wins for a
  -- version and prevents an older cached client from downgrading a newer
  -- acceptance during a rolling deploy.
  UPDATE public.profiles
  SET tos_version = cleaned_version,
      consented_at = pg_catalog.statement_timestamp()
  WHERE id = expected_user_id_in
    AND (
      tos_version IS NULL
      OR tos_version = '0'
      OR tos_version = '2026-04-20'
      OR tos_version < cleaned_version
    );

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = expected_user_id_in
  ) THEN
    RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0002';
  END IF;
END
$function$;

REVOKE ALL ON FUNCTION public.record_consent(text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_consent(text, uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_onboarded(
  nickname_in text,
  campus_in text,
  expected_user_id_in uuid,
  avatar_in text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  caller_id uuid := auth.uid();
  cleaned_nick text;
  cleaned_campus text;
  cleaned_avatar text;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF expected_user_id_in IS NULL OR expected_user_id_in <> caller_id THEN
    RAISE EXCEPTION 'account_changed' USING ERRCODE = '42501';
  END IF;

  cleaned_nick := pg_catalog.btrim(COALESCE(nickname_in, ''));
  IF pg_catalog.length(cleaned_nick) < 1
     OR pg_catalog.length(cleaned_nick) > 40 THEN
    RAISE EXCEPTION 'invalid_nickname' USING ERRCODE = '22023';
  END IF;

  cleaned_campus := pg_catalog.btrim(COALESCE(campus_in, ''));
  IF pg_catalog.length(cleaned_campus) > 80 THEN
    RAISE EXCEPTION 'invalid_campus' USING ERRCODE = '22023';
  END IF;

  cleaned_avatar := NULLIF(pg_catalog.btrim(COALESCE(avatar_in, '')), '');
  IF cleaned_avatar IS NOT NULL
     AND pg_catalog.length(cleaned_avatar) > 2048 THEN
    RAISE EXCEPTION 'invalid_avatar' USING ERRCODE = '22023';
  END IF;

  -- Onboarding is an initialization operation.  Preserve the first completed
  -- form so a delayed retry cannot overwrite a later profile state.
  UPDATE public.profiles
  SET nickname = cleaned_nick,
      campus_area = NULLIF(cleaned_campus, ''),
      avatar_url = COALESCE(cleaned_avatar, avatar_url),
      onboarded_at = pg_catalog.statement_timestamp()
  WHERE id = expected_user_id_in
    AND onboarded_at IS NULL;

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = expected_user_id_in
  ) THEN
    RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0002';
  END IF;
END
$function$;

REVOKE ALL ON FUNCTION public.mark_onboarded(text, text, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_onboarded(text, text, uuid, text)
  TO authenticated;

-- Rolling-deploy compatibility for the historical client signatures.  These
-- overloads cannot carry a page-captured expected UID, so they are deliberately
-- narrower than the new contract: they always derive the target from auth.uid,
-- validate every input, and use conditional single-statement writes so a late
-- retry cannot overwrite a completed onboarding or downgrade consent.  Keep
-- them only until adoption of the expected-account client is verified; this
-- overload accepts only the previous production release and can never attest
-- acceptance of the new release. Remove it later in a separate migration,
-- never in this deployment batch.
CREATE OR REPLACE FUNCTION public.record_consent(version_in text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  caller_id uuid := auth.uid();
  cleaned_version text;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  IF version_in IS DISTINCT FROM '2026-04-20' THEN
    RAISE EXCEPTION 'invalid_version' USING ERRCODE = '22023';
  END IF;
  cleaned_version := '2026-04-20';

  UPDATE public.profiles
  SET tos_version = cleaned_version,
      consented_at = pg_catalog.statement_timestamp()
  WHERE id = caller_id
    AND (
      tos_version IS NULL
      OR tos_version = '0'
    );

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = caller_id
  ) THEN
    RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0002';
  END IF;
END
$function$;

REVOKE ALL ON FUNCTION public.record_consent(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_consent(text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_onboarded(
  nickname_in text,
  campus_in text,
  avatar_in text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  caller_id uuid := auth.uid();
  cleaned_nick text;
  cleaned_campus text;
  cleaned_avatar text;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  cleaned_nick := pg_catalog.btrim(COALESCE(nickname_in, ''));
  IF pg_catalog.length(cleaned_nick) < 1
     OR pg_catalog.length(cleaned_nick) > 40 THEN
    RAISE EXCEPTION 'invalid_nickname' USING ERRCODE = '22023';
  END IF;

  cleaned_campus := pg_catalog.btrim(COALESCE(campus_in, ''));
  IF pg_catalog.length(cleaned_campus) > 80 THEN
    RAISE EXCEPTION 'invalid_campus' USING ERRCODE = '22023';
  END IF;

  cleaned_avatar := NULLIF(pg_catalog.btrim(COALESCE(avatar_in, '')), '');
  IF cleaned_avatar IS NOT NULL
     AND pg_catalog.length(cleaned_avatar) > 2048 THEN
    RAISE EXCEPTION 'invalid_avatar' USING ERRCODE = '22023';
  END IF;

  UPDATE public.profiles
  SET nickname = cleaned_nick,
      campus_area = NULLIF(cleaned_campus, ''),
      avatar_url = COALESCE(cleaned_avatar, avatar_url),
      onboarded_at = pg_catalog.statement_timestamp()
  WHERE id = caller_id
    AND onboarded_at IS NULL;

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = caller_id
  ) THEN
    RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0002';
  END IF;
END
$function$;

REVOKE ALL ON FUNCTION public.mark_onboarded(text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_onboarded(text, text, text)
  TO authenticated;

-- -----------------------------------------------------------------------------
-- 3. Conversation preview RPC: a caller may only request conversations they
--    participate in. $1 avoids any parameter/column-name ambiguity.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_last_messages(conv_ids uuid[])
RETURNS TABLE (
  conversation_id uuid,
  content text,
  message_type public.message_type
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT DISTINCT ON (m.conversation_id)
    m.conversation_id,
    m.content,
    m.message_type
  FROM public.messages AS m
  INNER JOIN public.conversations AS c
    ON c.id = m.conversation_id
  WHERE auth.uid() IS NOT NULL
    AND m.conversation_id = ANY ($1)
    AND auth.uid() IN (c.buyer_id, c.seller_id)
  ORDER BY m.conversation_id, m.created_at DESC
$function$;

REVOKE ALL ON FUNCTION public.get_last_messages(uuid[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_last_messages(uuid[])
  TO authenticated;

-- -----------------------------------------------------------------------------
-- 4. Ratings RLS: qualify every outer-row reference. The previous expression
--    could compile c.item_id = c.item_id, allowing a conversation about one item
--    to authorize a rating on another sold item owned by the same pair.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Participants can rate sold items" ON public.ratings;
CREATE POLICY "Participants can rate sold items"
  ON public.ratings
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = ratings.rater_id
    AND ratings.rater_id <> ratings.ratee_id
    AND EXISTS (
      SELECT 1
      FROM public.items AS rated_item
      WHERE rated_item.id = ratings.item_id
        AND rated_item.status = 'sold'
        AND rated_item.user_id IN (ratings.rater_id, ratings.ratee_id)
    )
    AND EXISTS (
      SELECT 1
      FROM public.conversations AS rating_conversation
      WHERE rating_conversation.item_id = ratings.item_id
        AND (
          (
            rating_conversation.buyer_id = ratings.rater_id
            AND rating_conversation.seller_id = ratings.ratee_id
          )
          OR
          (
            rating_conversation.buyer_id = ratings.ratee_id
            AND rating_conversation.seller_id = ratings.rater_id
          )
        )
    )
  );

-- -----------------------------------------------------------------------------
-- 5. Banner view: CREATE OR REPLACE in migration 086 reset security_invoker.
--    The base-table policy explicitly allows active defaults outside a schedule
--    because the view uses them as an otherwise-empty fallback.
-- -----------------------------------------------------------------------------
ALTER VIEW public.banners_live SET (security_invoker = true);

DROP POLICY IF EXISTS banners_read_live ON public.banners;
CREATE POLICY banners_read_live
  ON public.banners
  FOR SELECT
  TO anon, authenticated
  USING (
    active = true
    AND (
      is_default = true
      OR (
        (start_at IS NULL OR start_at <= pg_catalog.now())
        AND (end_at IS NULL OR end_at >= pg_catalog.now())
      )
    )
  );

REVOKE ALL ON public.banners_live FROM PUBLIC;
GRANT SELECT ON public.banners_live TO anon, authenticated;

-- -----------------------------------------------------------------------------
-- 6. Notification routing contract. New offer/meetup notifications inherit the
--    concrete conversation from the authenticated actor + recipient + item.
--    Legacy rows intentionally remain NULL and route to the inbox fallback.
-- -----------------------------------------------------------------------------
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS conversation_id uuid;

-- Keep reruns safe even after an interrupted/manual partial rollout where the
-- nullable column exists but its FK was never created.
DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.notifications'::pg_catalog.regclass
      AND conname = 'notifications_conversation_id_fkey'
      AND contype = 'f'
  ) THEN
    ALTER TABLE public.notifications
      ADD CONSTRAINT notifications_conversation_id_fkey
      FOREIGN KEY (conversation_id)
      REFERENCES public.conversations(id)
      ON DELETE SET NULL;
  END IF;
END
$migration$;

CREATE INDEX IF NOT EXISTS notifications_conversation_idx
  ON public.notifications(conversation_id)
  WHERE conversation_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.attach_notification_conversation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  actor_id uuid := auth.uid();
  matched_conversation_id uuid;
BEGIN
  IF NEW.conversation_id IS NOT NULL
     OR NEW.type NOT IN ('offer', 'meetup')
     OR NEW.item_id IS NULL
     OR NEW.user_id IS NULL
     OR actor_id IS NULL
     OR actor_id = NEW.user_id THEN
    RETURN NEW;
  END IF;

  SELECT conversation.id
  INTO matched_conversation_id
  FROM public.conversations AS conversation
  WHERE conversation.item_id = NEW.item_id
    AND (
      (
        conversation.buyer_id = actor_id
        AND conversation.seller_id = NEW.user_id
      )
      OR
      (
        conversation.seller_id = actor_id
        AND conversation.buyer_id = NEW.user_id
      )
    )
  ORDER BY
    conversation.last_message_at DESC NULLS LAST,
    conversation.created_at DESC,
    conversation.id DESC
  LIMIT 1;

  NEW.conversation_id := matched_conversation_id;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS attach_notification_conversation
  ON public.notifications;
CREATE TRIGGER attach_notification_conversation
  BEFORE INSERT ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.attach_notification_conversation();

REVOKE ALL ON FUNCTION public.attach_notification_conversation()
  FROM PUBLIC, anon, authenticated, service_role;

-- The app only marks notifications read and deletes its own rows. Routing,
-- payload, email state, identity and timestamps remain server-owned.
REVOKE INSERT, UPDATE, DELETE ON public.notifications
  FROM PUBLIC, anon, authenticated;
GRANT UPDATE (is_read) ON public.notifications TO authenticated;
GRANT DELETE ON public.notifications TO authenticated;

-- -----------------------------------------------------------------------------
-- 7. Internal seller-response recomputation is trigger/operations-only.
-- -----------------------------------------------------------------------------
ALTER FUNCTION public.recompute_seller_response(uuid)
  SET search_path = pg_catalog;
REVOKE ALL ON FUNCTION public.recompute_seller_response(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_seller_response(uuid)
  TO service_role;

-- -----------------------------------------------------------------------------
-- 8. Atomic edge limiter: service-role only, bounded inputs/storage, fixed
--    search_path, and a saturated counter that cannot overflow under sustained
--    abuse. Existing callers use buckets below 200 bytes, caps <= 600, and
--    windows <= one day.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.edge_rate_hit(
  bucket_in text,
  max_in integer,
  window_secs_in integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  normalized_bucket text;
  current_count integer;
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  normalized_bucket := pg_catalog.btrim(bucket_in);

  IF normalized_bucket IS NULL
     OR pg_catalog.octet_length(normalized_bucket) < 1
     OR pg_catalog.octet_length(normalized_bucket) > 200 THEN
    RAISE EXCEPTION 'invalid_rate_limit_bucket'
      USING ERRCODE = '22023';
  END IF;

  IF max_in IS NULL OR max_in < 1 OR max_in > 100000 THEN
    RAISE EXCEPTION 'invalid_rate_limit_max'
      USING ERRCODE = '22023';
  END IF;

  IF window_secs_in IS NULL OR window_secs_in < 1 OR window_secs_in > 604800 THEN
    RAISE EXCEPTION 'invalid_rate_limit_window'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.edge_rate_limits AS rate (
    bucket,
    count,
    window_start
  )
  VALUES (
    normalized_bucket,
    1,
    v_now
  )
  ON CONFLICT ON CONSTRAINT edge_rate_limits_pkey DO UPDATE
  SET count = CASE
        WHEN rate.window_start <= v_now
             - pg_catalog.make_interval(secs => window_secs_in)
          THEN 1
        ELSE LEAST(rate.count, max_in) + 1
      END,
      window_start = CASE
        WHEN rate.window_start <= v_now
             - pg_catalog.make_interval(secs => window_secs_in)
          THEN v_now
        ELSE rate.window_start
      END
  RETURNING rate.count INTO current_count;

  RETURN current_count <= max_in;
END
$function$;

REVOKE ALL ON FUNCTION public.edge_rate_hit(text, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.edge_rate_hit(text, integer, integer)
  TO service_role;

-- -----------------------------------------------------------------------------
-- 9. View counts become unique authenticated-viewer counts. The event table is
--    not exposed to clients; its primary key makes retries and concurrent opens
--    idempotent. Owners do not inflate their own listings. Existing aggregate
--    values are retained, and each account can add at most one future view per
--    item. Logged-out detail reads still work; only the best-effort counter RPC
--    is unavailable until sign-in.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.item_view_events (
  item_id uuid NOT NULL
    REFERENCES public.items(id) ON DELETE CASCADE,
  viewer_id uuid NOT NULL
    REFERENCES auth.users(id) ON DELETE CASCADE,
  viewed_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  PRIMARY KEY (item_id, viewer_id)
);

ALTER TABLE public.item_view_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.item_view_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.item_view_events TO service_role;

CREATE INDEX IF NOT EXISTS item_view_events_viewer_idx
  ON public.item_view_events(viewer_id);

CREATE OR REPLACE FUNCTION public.increment_view_count(item_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  viewer uuid := auth.uid();
  inserted_rows integer := 0;
BEGIN
  IF viewer IS NULL THEN
    RAISE EXCEPTION 'authentication_required'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.item_view_events (item_id, viewer_id)
  SELECT listed_item.id, viewer
  FROM public.items AS listed_item
  WHERE listed_item.id = $1
    AND listed_item.status <> 'deleted'
    AND listed_item.user_id <> viewer
  ON CONFLICT ON CONSTRAINT item_view_events_pkey DO NOTHING;

  GET DIAGNOSTICS inserted_rows = ROW_COUNT;

  IF inserted_rows = 1 THEN
    UPDATE public.items AS counted_item
    SET view_count = counted_item.view_count + 1
    WHERE counted_item.id = $1
      AND counted_item.status <> 'deleted';
  END IF;
END
$function$;

REVOKE ALL ON FUNCTION public.increment_view_count(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.increment_view_count(uuid)
  TO authenticated;

-- -----------------------------------------------------------------------------
-- 10. Profile recovery remains possible without granting trust/moderation/PII
--    fields. A user whose signup trigger failed may insert only a minimal row
--    for their own auth UID; defaults generate uid and all server-owned fields.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can create own profile" ON public.profiles;
CREATE POLICY "Users can create own profile"
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = id);

REVOKE INSERT ON public.profiles FROM PUBLIC, anon, authenticated;
GRANT INSERT (id, nickname, avatar_url, bio, location, status_text, status_emoji)
  ON public.profiles TO authenticated;

-- Preserve migration 084's UPDATE contract explicitly. In particular, no API
-- role can write uid/email/phone, Illini verification, ratings, response rate,
-- trust score, warning count, shadow-ban, or suspension fields.
REVOKE UPDATE ON public.profiles FROM PUBLIC, anon, authenticated;
GRANT UPDATE (nickname, avatar_url, bio, location, status_text, status_emoji)
  ON public.profiles TO authenticated;
REVOKE DELETE ON public.profiles FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 11. Exact client write grants. Defaults/triggers own timestamps, counters,
--    moderation state, pin/official flags, read state at creation, and identity
--    aggregates. RLS continues to enforce which rows each authenticated caller
--    may write.
-- -----------------------------------------------------------------------------

-- Reassert the historical 001/010 RLS boundary before relying on those
-- policies. This is idempotent on a normal deployment and fails closed after a
-- schema-only restore or accidental configuration drift where table grants
-- survived but relrowsecurity did not.
ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;

-- items: create/edit/status flows in useItems.ts.
-- location_verified was historically asserted by client GPS and therefore was
-- forgeable with one REST call. Revoke every legacy TRUE before removing write
-- access: retaining an untrusted badge would keep misleading buyers even after
-- the permission fix. The privilege guard makes this a one-time cleanup: a
-- future server-attested TRUE survives an idempotent migration replay.
DO $migration$
BEGIN
  IF pg_catalog.has_column_privilege(
       'authenticated', 'public.items', 'location_verified', 'INSERT'
     )
     OR pg_catalog.has_column_privilege(
       'authenticated', 'public.items', 'location_verified', 'UPDATE'
     ) THEN
    UPDATE public.items
    SET location_verified = false
    WHERE location_verified = true;
  END IF;
END
$migration$;

REVOKE INSERT, UPDATE, DELETE ON public.items FROM PUBLIC, anon, authenticated;
GRANT INSERT (
  user_id,
  title,
  description,
  price,
  category,
  condition,
  location,
  images,
  image_dimensions,
  title_i18n,
  description_i18n,
  source_lang,
  negotiable,
  listing_type
) ON public.items TO authenticated;
GRANT DELETE ON public.items TO authenticated;
GRANT UPDATE (
  title,
  description,
  price,
  category,
  condition,
  location,
  images,
  image_dimensions,
  title_i18n,
  description_i18n,
  source_lang,
  negotiable,
  status
) ON public.items TO authenticated;

-- posts: publish plus asynchronous translation fill. is_official, is_pinned,
-- status and counters are server/admin-owned.
REVOKE INSERT, UPDATE, DELETE ON public.posts FROM PUBLIC, anon, authenticated;
GRANT INSERT (
  user_id,
  content,
  images,
  image_dimensions,
  content_i18n,
  source_lang
) ON public.posts TO authenticated;
GRANT UPDATE (content_i18n) ON public.posts TO authenticated;
GRANT DELETE ON public.posts TO authenticated;

-- messages: the client allocates the UUID primary key before sending so a
-- response-lost retry can reuse the same identity and remain idempotent.
-- created_at/is_read/reminded_at stay server-owned; recipients may only flip
-- is_read after migration 064's recipient-keyed RLS policy.
REVOKE INSERT, UPDATE, DELETE ON public.messages FROM PUBLIC, anon, authenticated;
GRANT INSERT (id, conversation_id, sender_id, content, message_type)
  ON public.messages TO authenticated;
GRANT UPDATE (is_read) ON public.messages TO authenticated;
GRANT DELETE ON public.messages TO authenticated;

-- Plaza comments: counters, moderation status, author and timestamps are fixed.
REVOKE INSERT, UPDATE, DELETE ON public.post_comments FROM PUBLIC, anon, authenticated;
GRANT INSERT (post_id, user_id, content, parent_comment_id)
  ON public.post_comments TO authenticated;
GRANT UPDATE (content) ON public.post_comments TO authenticated;
GRANT DELETE ON public.post_comments TO authenticated;

-- Reports: reporter payload only; workflow status and timestamps are admin-owned.
REVOKE INSERT, UPDATE, DELETE ON public.reports FROM PUBLIC, anon, authenticated;
GRANT INSERT (reporter_id, target_type, target_id, reason, note)
  ON public.reports TO authenticated;

-- Ratings: aggregate fields live on profiles and created_at is database-owned.
REVOKE INSERT, UPDATE, DELETE ON public.ratings FROM PUBLIC, anon, authenticated;
GRANT INSERT (rater_id, ratee_id, item_id, stars, comment)
  ON public.ratings TO authenticated;

-- Conversations: the message trigger owns last_message_at. The existing
-- enforce_conversation_flag_ownership trigger prevents cross-party flag writes.
REVOKE INSERT, UPDATE, DELETE ON public.conversations FROM PUBLIC, anon, authenticated;
GRANT INSERT (item_id, buyer_id, seller_id)
  ON public.conversations TO authenticated;
GRANT UPDATE (
  is_pinned_buyer,
  is_pinned_seller,
  is_muted_buyer,
  is_muted_seller
) ON public.conversations TO authenticated;
GRANT DELETE ON public.conversations TO authenticated;

-- -----------------------------------------------------------------------------
-- 12. Search filtering: append optional parameters so existing named and
--    positional calls keep their 060-era meaning, while new clients can push
--    location/verified-only filtering before LIMIT/OFFSET. Dropping the old
--    signature avoids a PostgREST overload ambiguity.
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.search_items_fuzzy(
  text,
  integer
);

DROP FUNCTION IF EXISTS public.search_items_fuzzy(
  text[],
  public.item_category,
  public.item_condition,
  numeric,
  numeric,
  uuid,
  integer,
  integer
);

DROP FUNCTION IF EXISTS public.search_items_fuzzy(
  text[],
  public.item_category,
  public.item_condition,
  numeric,
  numeric,
  uuid,
  text,
  integer,
  integer
);

CREATE OR REPLACE FUNCTION public.search_items_fuzzy(
  terms_in         text[],
  category_in      public.item_category  DEFAULT NULL,
  condition_in     public.item_condition DEFAULT NULL,
  price_min_in     numeric               DEFAULT NULL,
  price_max_in     numeric               DEFAULT NULL,
  user_id_in       uuid                  DEFAULT NULL,
  listing_type_in  text                  DEFAULT NULL,
  limit_in         integer               DEFAULT 20,
  offset_in        integer               DEFAULT 0,
  location_in      text                  DEFAULT NULL,
  verified_only_in boolean               DEFAULT false
)
RETURNS TABLE (
  id                uuid,
  user_id           uuid,
  title             text,
  title_i18n        jsonb,
  description_i18n  jsonb,
  source_lang       text,
  price             numeric,
  category          public.item_category,
  condition         public.item_condition,
  status            public.item_status,
  listing_type      text,
  location          text,
  location_verified boolean,
  images            text[],
  image_dimensions  jsonb,
  view_count        integer,
  favorite_count    integer,
  negotiable        boolean,
  created_at        timestamptz,
  profile           jsonb,
  rank              real
)
LANGUAGE sql
STABLE
SECURITY INVOKER
-- pg_trgm may live in public (migration-created) or extensions (a common
-- hosted-Supabase layout). Keep both fixed in the invoker path so the same
-- migration is portable across those two existing-schema variants.
SET search_path = pg_catalog, public, extensions
AS $function$
  SELECT
    i.id,
    i.user_id,
    i.title,
    i.title_i18n,
    i.description_i18n,
    i.source_lang,
    i.price,
    i.category,
    i.condition,
    i.status,
    i.listing_type,
    i.location,
    i.location_verified,
    i.images,
    i.image_dimensions,
    i.view_count,
    i.favorite_count,
    i.negotiable,
    i.created_at,
    pg_catalog.jsonb_build_object(
      'id',                 p.id,
      'nickname',           p.nickname,
      'avatar_url',         p.avatar_url,
      'location',           p.location,
      'is_illini_verified', p.is_illini_verified,
      'status_text',        p.status_text,
      'status_emoji',       p.status_emoji
    ) AS profile,
    (
      SELECT COALESCE(pg_catalog.max(GREATEST(
        similarity(i.title, search_term),
        similarity(COALESCE(i.description, ''), search_term) * 0.6,
        CASE WHEN i.title ILIKE '%' || search_term || '%' THEN 0.4 ELSE 0 END,
        CASE
          WHEN COALESCE(i.description, '') ILIKE '%' || search_term || '%'
            THEN 0.25
          ELSE 0
        END
      )), 0)::real
      FROM pg_catalog.unnest(terms_in) AS search_term
    ) AS rank
  FROM public.items AS i
  LEFT JOIN public.profiles AS p ON p.id = i.user_id
  WHERE i.status = 'active'
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.unnest(terms_in) AS search_term
      WHERE i.title % search_term
         OR COALESCE(i.description, '') % search_term
         OR i.title ILIKE '%' || search_term || '%'
         OR COALESCE(i.description, '') ILIKE '%' || search_term || '%'
    )
    AND (category_in IS NULL OR i.category = category_in)
    AND (condition_in IS NULL OR i.condition = condition_in)
    AND (price_min_in IS NULL OR i.price >= price_min_in)
    AND (price_max_in IS NULL OR i.price <= price_max_in)
    AND (user_id_in IS NULL OR i.user_id = user_id_in)
    AND (listing_type_in IS NULL OR i.listing_type = listing_type_in)
    AND (location_in IS NULL OR i.location ILIKE '%' || location_in || '%')
    AND (verified_only_in = false OR i.location_verified = true)
  ORDER BY rank DESC, i.created_at DESC
  LIMIT GREATEST(1, LEAST(limit_in, 100))
  OFFSET GREATEST(0, offset_in)
$function$;

REVOKE ALL ON FUNCTION public.search_items_fuzzy(
  text[],
  public.item_category,
  public.item_condition,
  numeric,
  numeric,
  uuid,
  text,
  integer,
  integer,
  text,
  boolean
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_items_fuzzy(
  text[],
  public.item_category,
  public.item_condition,
  numeric,
  numeric,
  uuid,
  text,
  integer,
  integer,
  text,
  boolean
) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- -----------------------------------------------------------------------------
-- Post-deploy verification (run against staging before production):
--
-- 1. SELECT reloptions FROM pg_class
--      WHERE oid = 'public.banners_live'::regclass;
--    -> includes security_invoker=true
--
-- 2. SELECT grantee, privilege_type FROM information_schema.routine_privileges
--      WHERE specific_schema='public'
--        AND routine_name IN ('get_last_messages','increment_view_count',
--                             'recompute_seller_response');
--    -> no PUBLIC/anon; authenticated only for the two client RPCs
--
-- 3. As user A, get_last_messages(array[conversation-not-owned-by-A]) -> 0 rows.
-- 4. As user A, call increment_view_count twice for one item -> aggregate +1.
-- 5. As anon, increment_view_count -> permission denied; item SELECT still works.
-- 6. Attempt INSERT items(..., created_at='2000-01-01') -> 42501.
-- 7. Attempt INSERT posts(..., is_pinned=true) -> 42501.
-- 8. Attempt INSERT profiles(..., trust_score=100) -> 42501.
-- 9. Rating on a different item than the pair's conversation -> RLS violation.
-- 10. Existing 9-argument search call still returns the same rows.
-- 11. Search with location_in='Union', verified_only_in=true returns only
--     matching verified rows and has pagination over that filtered set.
-- 12. Insert an offer/meetup notification through make_offer() or
--     propose_meetup() -> conversation_id matches the same actor/recipient/item
--     conversation.
-- 13. Direct authenticated notification INSERT or UPDATE(conversation_id)
--     -> 42501; UPDATE(is_read) and DELETE of an owned notification still work.
-- 14. As service_role, edge_rate_hit() with max_hits=2 -> true, true, false;
--     anon/authenticated execution -> permission denied.
-- 15. Create an auth user whose nickname fails moderation -> signup succeeds
--     with profile nickname 'Illini User'; no auth user remains without profile.
-- =============================================================================
