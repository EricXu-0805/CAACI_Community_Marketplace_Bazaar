-- ============================================
-- 027 Security C: trust score, suspensions, device fingerprint, shadowban
-- ============================================
-- This migration is the backend half of the "ban ladder" promised in
-- the Terms of Service (ToS §9). The app's content-safety stack already
-- blocks obvious bad content; this layer is about the *actor*:
--   · every profile gets a trust_score 0-100 (default 50) and a
--     shadow_banned flag
--   · active suspensions are tracked in public.suspensions with a
--     level 0-5 that maps to the ToS ladder
--   · every publish path (posts, items, comments, messages) calls
--     enforce_actor() via trigger, which raises a friendly error
--     'suspension_active:<level>:<ends_at>' if a current suspension
--     would block the action
--   · shadow_banned = true hides a user's output from OTHER users'
--     feeds but NOT from their own profile, so they can't tell they
--     are shadow-banned (matches how this is done everywhere else).
-- ============================================

-- --------------------------------------------
-- 1. Profile columns for trust state
-- --------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS trust_score        smallint NOT NULL DEFAULT 50
    CHECK (trust_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS shadow_banned      boolean  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS suspension_level   smallint NOT NULL DEFAULT 0
    CHECK (suspension_level BETWEEN 0 AND 5),
  ADD COLUMN IF NOT EXISTS suspended_until    timestamptz,
  ADD COLUMN IF NOT EXISTS last_fp_hash       text,
  ADD COLUMN IF NOT EXISTS last_fp_seen_at    timestamptz,
  ADD COLUMN IF NOT EXISTS warning_count      integer  NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS profiles_trust_score_idx
  ON public.profiles (trust_score);
CREATE INDEX IF NOT EXISTS profiles_suspension_idx
  ON public.profiles (suspended_until) WHERE suspended_until IS NOT NULL;
CREATE INDEX IF NOT EXISTS profiles_shadow_idx
  ON public.profiles (shadow_banned) WHERE shadow_banned = true;

-- --------------------------------------------
-- 2. suspensions history table
--    (immutable log; current effective suspension is cached on
--     profiles.suspension_level / suspended_until for fast triggers)
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS public.suspensions (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  level        smallint NOT NULL CHECK (level BETWEEN 0 AND 5),
  reason       text NOT NULL,
  category     text NOT NULL DEFAULT 'generic',
  issued_by    uuid,
  started_at   timestamptz NOT NULL DEFAULT now(),
  ends_at      timestamptz,
  lifted_at    timestamptz,
  lifted_by    uuid,
  lift_reason  text,
  appeal_note  text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS suspensions_profile_active_idx
  ON public.suspensions (profile_id, ends_at DESC)
  WHERE lifted_at IS NULL;
CREATE INDEX IF NOT EXISTS suspensions_created_idx
  ON public.suspensions (created_at DESC);

ALTER TABLE public.suspensions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS suspensions_self_read ON public.suspensions;
CREATE POLICY suspensions_self_read ON public.suspensions
  FOR SELECT USING (auth.uid() = profile_id);

-- No INSERT/UPDATE/DELETE policy: only service_role (admin script)
-- can mutate this table. RPCs below provide the controlled surface.

-- --------------------------------------------
-- 3. device_fingerprints table
--    Records which profiles a given device hash has logged in under.
--    Used by trust_score compute to detect multi-account patterns,
--    and by apply_ban_level() to propagate bans to known alt accounts.
--    Hashes are one-way (SHA-256 of client-derived signal); we never
--    store the raw signal. No per-user PII is visible to other users.
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS public.device_fingerprints (
  id           bigserial PRIMARY KEY,
  profile_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  fp_hash      text NOT NULL,
  first_seen   timestamptz NOT NULL DEFAULT now(),
  last_seen    timestamptz NOT NULL DEFAULT now(),
  seen_count   integer NOT NULL DEFAULT 1,
  ua_snippet   text,
  UNIQUE (profile_id, fp_hash)
);

CREATE INDEX IF NOT EXISTS device_fp_hash_idx
  ON public.device_fingerprints (fp_hash, last_seen DESC);

ALTER TABLE public.device_fingerprints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dfp_self_read ON public.device_fingerprints;
CREATE POLICY dfp_self_read ON public.device_fingerprints
  FOR SELECT USING (auth.uid() = profile_id);

-- --------------------------------------------
-- 4. record_fingerprint(hash, ua_snippet) RPC
--    Called by the client at startup. Upserts the (profile, fp)
--    pair, updates last_seen/seen_count, and mirrors the most-recent
--    hash onto profiles.last_fp_hash so triggers that don't want to
--    join into device_fingerprints can read it cheaply.
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.record_fingerprint(
  fp_hash_in    text,
  ua_snippet_in text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  caller_id    uuid := auth.uid();
  cleaned_hash text;
  cleaned_ua   text;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  cleaned_hash := btrim(COALESCE(fp_hash_in, ''));
  IF length(cleaned_hash) < 8 OR length(cleaned_hash) > 128 THEN
    RAISE EXCEPTION 'invalid_fingerprint';
  END IF;
  IF cleaned_hash !~ '^[a-zA-Z0-9_-]+$' THEN
    RAISE EXCEPTION 'invalid_fingerprint_format';
  END IF;

  cleaned_ua := left(COALESCE(ua_snippet_in, ''), 120);

  INSERT INTO public.device_fingerprints (profile_id, fp_hash, ua_snippet)
  VALUES (caller_id, cleaned_hash, cleaned_ua)
  ON CONFLICT (profile_id, fp_hash)
  DO UPDATE SET
    last_seen  = now(),
    seen_count = public.device_fingerprints.seen_count + 1,
    ua_snippet = COALESCE(EXCLUDED.ua_snippet, public.device_fingerprints.ua_snippet);

  UPDATE public.profiles
     SET last_fp_hash    = cleaned_hash,
         last_fp_seen_at = now()
   WHERE id = caller_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_fingerprint(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_fingerprint(text, text) TO authenticated;

-- --------------------------------------------
-- 5. compute_trust_score(profile_id) — pure function
--    Deterministic 0-100 score derived from signals already in the db.
--    Not cached per-call; recompute_trust_score() below writes it
--    into profiles.trust_score on demand.
--
--    Weights (intentionally conservative — the score is advisory,
--    NOT a hard gate; suspension_level is the hard gate):
--      base                               =  50
--      + min(10, days_since_signup / 7)   up to +10 over 10 weeks
--      + 2 per 4-or-5-star rating received (capped +20)
--      - 5 per pending/reviewed report against user (capped -30)
--      - 10 per suspension in last 180 days (capped -30)
--      - 15 if any active suspension
--      - 10 if shadow_banned
--      - 8  per shared-fp sibling account (max -16) — detects alts
-- --------------------------------------------
-- Parser-trap note: this function used to compute age_days as
-- EXTRACT(DAY FROM (now() - created_at)). On Supabase PG 15, the
-- `FROM` keyword inside EXTRACT confuses plpgsql's statement-boundary
-- scanner in SELECT...INTO multi-target form, causing it to misread
-- the INTO targets as SQL-level table names (42P01 relation "age_days"
-- does not exist). Fixed by splitting into two assignments and using
-- plain date subtraction instead of EXTRACT.
--
-- Also: param renamed from `p` to `profile_id_in`. The DROP FUNCTION
-- below cleans up the old signature if a previous partial run left
-- it behind (PG treats param name changes as a new overload).
DROP FUNCTION IF EXISTS public.compute_trust_score(uuid);
CREATE OR REPLACE FUNCTION public.compute_trust_score(profile_id_in uuid)
RETURNS smallint LANGUAGE plpgsql STABLE AS $$
DECLARE
  score               integer := 50;
  age_days            integer;
  good_ratings        integer;
  report_count        integer;
  recent_suspensions  integer;
  has_active_susp     boolean;
  is_shadow_banned    boolean;
  sibling_alts        integer;
  profile_created_at  timestamptz;
BEGIN
  IF profile_id_in IS NULL THEN RETURN 50::smallint; END IF;

  -- Use scalar-subquery assignment (var := (SELECT ...)) everywhere
  -- instead of SELECT...INTO. The INTO form — even single-target —
  -- has been shipping the 42P01 "relation does not exist" misparse
  -- on Supabase PG 15's editor path. Scalar subqueries sidestep the
  -- whole INTO parser state machine.
  profile_created_at := (
    SELECT pr.created_at FROM public.profiles pr WHERE pr.id = profile_id_in
  );
  is_shadow_banned := (
    SELECT pr.shadow_banned FROM public.profiles pr WHERE pr.id = profile_id_in
  );

  IF profile_created_at IS NULL THEN RETURN 50::smallint; END IF;

  age_days := GREATEST(0, (now()::date - profile_created_at::date));
  score := score + LEAST(10, age_days / 7);

  good_ratings := (
    SELECT COUNT(*) FROM public.ratings r
     WHERE r.ratee_id = profile_id_in AND r.stars >= 4
  );
  score := score + LEAST(20, good_ratings * 2);

  report_count := (
    SELECT COUNT(*) FROM public.reports rp
     WHERE rp.target_type = 'user'
       AND rp.target_id = profile_id_in
       AND rp.status IN ('pending', 'reviewed')
  );
  score := score - LEAST(30, report_count * 5);

  recent_suspensions := (
    SELECT COUNT(*) FROM public.suspensions s
     WHERE s.profile_id = profile_id_in
       AND s.started_at > now() - interval '180 days'
       AND s.level >= 2
  );
  score := score - LEAST(30, recent_suspensions * 10);

  has_active_susp := EXISTS(
    SELECT 1 FROM public.suspensions s2
     WHERE s2.profile_id = profile_id_in
       AND s2.lifted_at IS NULL
       AND (s2.ends_at IS NULL OR s2.ends_at > now())
       AND s2.level >= 2
  );
  IF has_active_susp THEN score := score - 15; END IF;

  IF is_shadow_banned THEN score := score - 10; END IF;

  sibling_alts := (
    SELECT COUNT(DISTINCT other_fp.profile_id)
      FROM public.device_fingerprints my_fp
      JOIN public.device_fingerprints other_fp
        ON other_fp.fp_hash = my_fp.fp_hash
       AND other_fp.profile_id <> my_fp.profile_id
     WHERE my_fp.profile_id = profile_id_in
  );
  score := score - LEAST(16, sibling_alts * 8);

  RETURN GREATEST(0, LEAST(100, score))::smallint;
END;
$$;

-- Materializer. Callable by the user themself (cheap) and by
-- service_role from cron. Never trust the client's claimed score.
CREATE OR REPLACE FUNCTION public.recompute_trust_score(p uuid DEFAULT NULL)
RETURNS smallint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  target uuid;
  s smallint;
BEGIN
  target := COALESCE(p, auth.uid());
  IF target IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF auth.uid() IS NOT NULL AND auth.uid() <> target THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  s := public.compute_trust_score(target);
  UPDATE public.profiles SET trust_score = s WHERE id = target;
  RETURN s;
END;
$$;

REVOKE ALL ON FUNCTION public.recompute_trust_score(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recompute_trust_score(uuid) TO authenticated;

-- --------------------------------------------
-- 6. apply_ban_level(target, level, reason)
--    Admin-only. Called via service_role. Writes to suspensions +
--    updates the cached profiles columns. For level 5 (perma), also
--    sets shadow_banned so any grace-period content stays hidden.
--    Alt-account propagation: any profile sharing a recent device fp
--    with the target is auto-shadowbanned (level-2 soft sanction).
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_ban_level(
  target_in   uuid,
  level_in    smallint,
  reason_in   text,
  category_in text DEFAULT 'generic',
  hours_in    integer DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_id       uuid;
  ban_interval interval;
  ends_at_val  timestamptz;
  alt_id       uuid;
BEGIN
  IF level_in NOT BETWEEN 0 AND 5 THEN RAISE EXCEPTION 'invalid_level'; END IF;
  IF target_in IS NULL THEN RAISE EXCEPTION 'invalid_target'; END IF;
  IF reason_in IS NULL OR length(btrim(reason_in)) = 0 THEN RAISE EXCEPTION 'reason_required'; END IF;

  ban_interval := CASE
    WHEN hours_in IS NOT NULL THEN (hours_in || ' hours')::interval
    WHEN level_in = 0 THEN NULL
    WHEN level_in = 1 THEN NULL
    WHEN level_in = 2 THEN interval '72 hours'
    WHEN level_in = 3 THEN interval '7 days'
    WHEN level_in = 4 THEN interval '30 days'
    WHEN level_in = 5 THEN NULL
  END;

  ends_at_val := CASE
    WHEN ban_interval IS NULL AND level_in = 5 THEN 'infinity'::timestamptz
    WHEN ban_interval IS NULL THEN NULL
    ELSE now() + ban_interval
  END;

  INSERT INTO public.suspensions (profile_id, level, reason, category, issued_by, ends_at)
  VALUES (target_in, level_in, reason_in, category_in, auth.uid(), ends_at_val)
  RETURNING id INTO new_id;

  UPDATE public.profiles
     SET suspension_level = level_in,
         suspended_until  = ends_at_val,
         shadow_banned    = CASE
           WHEN level_in >= 3 THEN true
           ELSE shadow_banned
         END,
         warning_count = CASE
           WHEN level_in = 1 THEN warning_count + 1
           ELSE warning_count
         END
   WHERE id = target_in;

  IF level_in >= 4 THEN
    FOR alt_id IN
      SELECT DISTINCT other.profile_id
        FROM public.device_fingerprints me
        JOIN public.device_fingerprints other
          ON other.fp_hash = me.fp_hash
         AND other.profile_id <> me.profile_id
       WHERE me.profile_id = target_in
         AND other.last_seen > now() - interval '90 days'
    LOOP
      UPDATE public.profiles
         SET shadow_banned = true
       WHERE id = alt_id AND suspension_level < 4;
    END LOOP;
  END IF;

  PERFORM public.recompute_trust_score(target_in);
  RETURN new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_ban_level(uuid, smallint, text, text, integer) FROM PUBLIC;
-- Grant to service_role only (implicit — no authenticated grant).

-- --------------------------------------------
-- 7. lift_suspension(suspension_id, reason)
--    Admin-only via service_role. Clears the suspension and
--    recomputes the cached profile columns based on whatever
--    suspensions remain.
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.lift_suspension(
  suspension_id uuid,
  reason_in     text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  target uuid;
  max_active_level smallint;
  max_active_ends  timestamptz;
BEGIN
  UPDATE public.suspensions
     SET lifted_at   = now(),
         lifted_by   = auth.uid(),
         lift_reason = reason_in
   WHERE id = suspension_id
   RETURNING profile_id INTO target;

  IF target IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;

  max_active_level := (
    SELECT COALESCE(MAX(s.level), 0)
      FROM public.suspensions s
     WHERE s.profile_id = target
       AND s.lifted_at IS NULL
       AND (s.ends_at IS NULL OR s.ends_at > now())
  );

  max_active_ends := (
    SELECT MAX(s.ends_at)
      FROM public.suspensions s
     WHERE s.profile_id = target
       AND s.lifted_at IS NULL
       AND (s.ends_at IS NULL OR s.ends_at > now())
  );

  UPDATE public.profiles
     SET suspension_level = COALESCE(max_active_level, 0),
         suspended_until  = max_active_ends,
         shadow_banned    = CASE
           WHEN COALESCE(max_active_level, 0) < 3 THEN false
           ELSE shadow_banned
         END
   WHERE id = target;

  PERFORM public.recompute_trust_score(target);
END;
$$;

REVOKE ALL ON FUNCTION public.lift_suspension(uuid, text) FROM PUBLIC;

-- --------------------------------------------
-- 8. is_posting_allowed(profile_id) — the hard gate
--    Param was named `uid` originally. Supabase's search_path makes
--    `uid` (bareword) ambiguous with auth.uid(), which can trip a
--    42883 uuid=text on SELECT planning. Renamed to profile_id_in.
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.is_posting_allowed(profile_id_in uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT NOT EXISTS(
    SELECT 1 FROM public.profiles p
     WHERE p.id = profile_id_in
       AND p.suspension_level >= 2
       AND (p.suspended_until IS NULL OR p.suspended_until > now())
  );
$$;

-- --------------------------------------------
-- 9. BEFORE INSERT trigger factory — enforce on every publish path
-- --------------------------------------------
-- Two parser pitfalls baked into this function. See migration 028
-- for the full post-mortem. Briefly:
--   1. Do NOT collapse the IF/ELSIF into a single CASE TG_TABLE_NAME
--      WHEN 'posts' THEN NEW.user_id ... END — on modern PG the
--      CASE coerces to text, breaking `WHERE id = actor_id` with 42883.
--   2. Do NOT rename active_level / ends_at back to lvl / ends —
--      `ends` is reserved in PG 14+ frame clauses and throws the
--      plpgsql parser out of sync, leading to a bogus 42P01
--      "relation lvl does not exist" at SELECT INTO.
CREATE OR REPLACE FUNCTION public.trg_enforce_actor()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  actor_id     uuid;
  active_level smallint;
  ends_at      timestamptz;
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

  active_level := (
    SELECT p.suspension_level FROM public.profiles p WHERE p.id = actor_id
  );
  ends_at := (
    SELECT p.suspended_until FROM public.profiles p WHERE p.id = actor_id
  );

  IF active_level IS NOT NULL
     AND active_level >= 2
     AND (ends_at IS NULL OR ends_at > now()) THEN
    RAISE EXCEPTION 'suspension_active:%:%',
      active_level,
      COALESCE(to_char(ends_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'permanent');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_actor_posts         ON public.posts;
DROP TRIGGER IF EXISTS enforce_actor_post_comments ON public.post_comments;
DROP TRIGGER IF EXISTS enforce_actor_items         ON public.items;
DROP TRIGGER IF EXISTS enforce_actor_messages      ON public.messages;

CREATE TRIGGER enforce_actor_posts         BEFORE INSERT ON public.posts         FOR EACH ROW EXECUTE FUNCTION public.trg_enforce_actor();
CREATE TRIGGER enforce_actor_post_comments BEFORE INSERT ON public.post_comments FOR EACH ROW EXECUTE FUNCTION public.trg_enforce_actor();
CREATE TRIGGER enforce_actor_items         BEFORE INSERT ON public.items         FOR EACH ROW EXECUTE FUNCTION public.trg_enforce_actor();
CREATE TRIGGER enforce_actor_messages      BEFORE INSERT ON public.messages      FOR EACH ROW EXECUTE FUNCTION public.trg_enforce_actor();

-- --------------------------------------------
-- 10. Feed shadow-limit view
--     Wraps items so home-feed queries can filter shadowbanned
--     authors *unless* the viewer is the author. Use this from the
--     client's fetch-items path (switch target from items to
--     items_visible). Existing queries on `items` still work; only
--     new callers opt in.
-- --------------------------------------------
CREATE OR REPLACE VIEW public.items_visible AS
SELECT i.*
  FROM public.items i
  JOIN public.profiles p ON p.id = i.user_id
 WHERE p.shadow_banned = false
    OR i.user_id = auth.uid();

GRANT SELECT ON public.items_visible TO anon, authenticated;

CREATE OR REPLACE VIEW public.posts_visible AS
SELECT po.*
  FROM public.posts po
  JOIN public.profiles p ON p.id = po.user_id
 WHERE p.shadow_banned = false
    OR po.user_id = auth.uid();

GRANT SELECT ON public.posts_visible TO anon, authenticated;

-- --------------------------------------------
-- 11. Self-appeal window: allow a banned user to append one appeal
--     note to their most recent active suspension.
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_appeal(note_in text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  sid uuid;
  cleaned text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  cleaned := btrim(COALESCE(note_in, ''));
  IF length(cleaned) < 10 OR length(cleaned) > 2000 THEN
    RAISE EXCEPTION 'invalid_appeal_length';
  END IF;

  sid := (
    SELECT s.id
      FROM public.suspensions s
     WHERE s.profile_id = auth.uid()
       AND s.lifted_at IS NULL
       AND s.appeal_note IS NULL
     ORDER BY s.created_at DESC
     LIMIT 1
  );

  IF sid IS NULL THEN RAISE EXCEPTION 'no_active_suspension'; END IF;

  UPDATE public.suspensions SET appeal_note = cleaned WHERE id = sid;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_appeal(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_appeal(text) TO authenticated;
