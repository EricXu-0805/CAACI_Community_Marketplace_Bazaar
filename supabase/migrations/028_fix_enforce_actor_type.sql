-- 028 Hardened rewrite of Security-C functions hit by PG parser traps.
--
-- Three separate issues fixed in one pass. Running this migration
-- alone is sufficient to recover if 027 bombed partway.
--
--   A. 42883 uuid=text in trg_enforce_actor. plpgsql CASE
--      TG_TABLE_NAME WHEN ... THEN NEW.col END resolves to text on
--      modern PG because NEW's record type is only known at fire
--      time. Replaced with IF/ELSIF so each branch keeps its uuid.
--
--   B. 42P01 relation "lvl" does not exist. `ends` is a reserved
--      identifier in PG 14+ (frame clauses ROWS BETWEEN ... ENDS).
--      Declaring a plpgsql variable named `ends` throws the parser
--      out of sync; the following SELECT INTO is then misread as
--      SQL-level INTO with the next ident ("lvl") interpreted as
--      a table. `duration` has the same problem. Renamed every
--      DECLARE `ends` / `duration` / `uid` in the Security-C
--      functions to unambiguous names: ends_at_val / ban_interval
--      / caller_id / actor_id / profile_id_in.
--
--   C. is_posting_allowed(uid uuid) used bareword `uid` in the
--      WHERE clause. Supabase's search_path makes `uid` ambiguous
--      with auth.uid(), which can produce a text-returning
--      resolution and recreate the 42883 uuid=text failure.
--      Param renamed to profile_id_in and WHERE clause alias-qualified.

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

CREATE TRIGGER enforce_actor_posts
  BEFORE INSERT ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.trg_enforce_actor();

CREATE TRIGGER enforce_actor_post_comments
  BEFORE INSERT ON public.post_comments
  FOR EACH ROW EXECUTE FUNCTION public.trg_enforce_actor();

CREATE TRIGGER enforce_actor_items
  BEFORE INSERT ON public.items
  FOR EACH ROW EXECUTE FUNCTION public.trg_enforce_actor();

CREATE TRIGGER enforce_actor_messages
  BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.trg_enforce_actor();

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

GRANT EXECUTE ON FUNCTION public.record_fingerprint(text, text) TO authenticated;

DROP FUNCTION IF EXISTS public.is_posting_allowed(uuid);
CREATE OR REPLACE FUNCTION public.is_posting_allowed(profile_id_in uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT NOT EXISTS(
    SELECT 1 FROM public.profiles p
     WHERE p.id = profile_id_in
       AND p.suspension_level >= 2
       AND (p.suspended_until IS NULL OR p.suspended_until > now())
  );
$$;

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
