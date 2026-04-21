-- ============================================
-- 031 Admin audit log table + RPCs
-- ============================================
-- A structured record of every admin action (ban / lift / update-status)
-- and every server-enforced action (trigger-blocked post / item / etc).
--
-- Why one table instead of separate tables per event type?
--   · Audit volume is low (dozens/day) — table partitioning is overkill.
--   · The admin dashboard wants a unified timeline view, which a single
--     append-only table with an `event_kind` discriminator makes cheap.
--   · Future events (signup-blocked, appeal-filed) can be added without
--     schema changes, just a new value for event_kind.
--
-- Security model:
--   · INSERT is SECURITY DEFINER through the RPCs — no direct writes
--     from client code (RLS has no INSERT policy at all).
--   · SELECT is service_role only, exposed via admin_list_audit_log RPC.
--   · No UPDATE / DELETE policy — audit log is append-only by design.
-- ============================================

CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id          bigserial PRIMARY KEY,
  event_kind  text NOT NULL CHECK (event_kind IN (
    'ban_applied',
    'suspension_lifted',
    'report_status_changed',
    'actor_blocked',
    'admin_login',
    'admin_unauthorized'
  )),
  actor_id    uuid,
  target_id   uuid,
  details     jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_audit_log_created_idx
  ON public.admin_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_log_kind_idx
  ON public.admin_audit_log (event_kind, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_log_target_idx
  ON public.admin_audit_log (target_id) WHERE target_id IS NOT NULL;

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;
-- No policies = no client access. service_role bypasses RLS.

-- --------------------------------------------
-- record_audit(event_kind, actor_id, target_id, details)
-- Internal helper called from RPCs. service_role only.
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.record_audit(
  event_kind_in text,
  actor_id_in   uuid,
  target_id_in  uuid,
  details_in    jsonb DEFAULT '{}'::jsonb
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.admin_audit_log (event_kind, actor_id, target_id, details)
  VALUES (event_kind_in, actor_id_in, target_id_in, COALESCE(details_in, '{}'::jsonb));
EXCEPTION WHEN OTHERS THEN
  -- Never let audit failure break the parent action. Log via RAISE
  -- LOG so it ends up in Supabase's logs tab, and swallow.
  RAISE LOG 'record_audit failed: % / % / % / %', event_kind_in, actor_id_in, target_id_in, SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.record_audit(text, uuid, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_audit(text, uuid, uuid, jsonb) TO service_role;

-- --------------------------------------------
-- Wire apply_ban_level, lift_suspension, admin_update_report_status
-- to record their events.
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

  PERFORM public.record_audit(
    'ban_applied',
    auth.uid(),
    target_in,
    jsonb_build_object(
      'suspension_id', new_id,
      'level', level_in,
      'reason', reason_in,
      'category', category_in,
      'ends_at', ends_at_val
    )
  );

  RETURN new_id;
END;
$$;

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

  PERFORM public.record_audit(
    'suspension_lifted',
    auth.uid(),
    target,
    jsonb_build_object(
      'suspension_id', suspension_id,
      'reason', reason_in
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_report_status(
  report_id_in uuid,
  status_in    text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  old_status text;
BEGIN
  IF status_in NOT IN ('pending', 'reviewed', 'resolved', 'dismissed') THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;
  SELECT status INTO old_status FROM public.reports WHERE id = report_id_in;
  UPDATE public.reports SET status = status_in WHERE id = report_id_in;

  PERFORM public.record_audit(
    'report_status_changed',
    auth.uid(),
    report_id_in,
    jsonb_build_object(
      'from', old_status,
      'to',   status_in
    )
  );
END;
$$;

-- --------------------------------------------
-- trg_enforce_actor: write an audit row on every block + RAISE LOG
-- so Supabase logs tab also sees it.
-- --------------------------------------------
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

    PERFORM public.record_audit(
      'actor_blocked',
      actor_id,
      NULL,
      jsonb_build_object(
        'table', TG_TABLE_NAME,
        'level', active_level,
        'ends_at', ends_at
      )
    );

    RAISE LOG 'enforce_actor blocked % on % at level %, ends %',
      actor_id, TG_TABLE_NAME, active_level, COALESCE(ends_at::text, 'permanent');

    RAISE EXCEPTION 'suspension_active:%:%',
      active_level,
      COALESCE(to_char(ends_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'permanent');
  END IF;

  RETURN NEW;
END;
$$;

-- --------------------------------------------
-- admin_list_audit_log(limit, offset, kind_filter)
-- Feeds the Audit Log tab in the admin dashboard.
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_audit_log(
  limit_in     integer DEFAULT 100,
  offset_in    integer DEFAULT 0,
  kind_filter  text    DEFAULT NULL
)
RETURNS TABLE (
  id              bigint,
  event_kind      text,
  actor_id        uuid,
  actor_nickname  text,
  target_id       uuid,
  target_nickname text,
  details         jsonb,
  created_at      timestamptz
) LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    l.id, l.event_kind,
    l.actor_id, ap.nickname,
    l.target_id, tp.nickname,
    l.details, l.created_at
    FROM public.admin_audit_log l
    LEFT JOIN public.profiles ap ON ap.id = l.actor_id
    LEFT JOIN public.profiles tp ON tp.id = l.target_id
   WHERE (kind_filter IS NULL OR l.event_kind = kind_filter)
   ORDER BY l.created_at DESC
   LIMIT GREATEST(1, LEAST(limit_in, 500))
   OFFSET GREATEST(0, offset_in);
$$;

REVOKE ALL ON FUNCTION public.admin_list_audit_log(integer, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_audit_log(integer, integer, text) TO service_role;

NOTIFY pgrst, 'reload schema';
