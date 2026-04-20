-- 028 Hardened rewrite of trg_enforce_actor.
--
-- Two separate issues fixed in one pass:
--
--   A. 42883 uuid=text. plpgsql CASE TG_TABLE_NAME WHEN ... THEN
--      NEW.col END resolves to text on modern PG because NEW's
--      record type is only known at fire time. Replaced with
--      IF/ELSIF so each branch keeps its uuid type.
--
--   B. 42P01 relation "lvl" does not exist. `ends` is a reserved
--      identifier in PG 14+ (frame clauses `ROWS BETWEEN ... ENDS`).
--      Declaring a plpgsql variable named `ends` throws the parser
--      out of sync; `SELECT INTO lvl, ends` is then misread as
--      SQL-level INTO with `lvl` interpreted as a table. Renamed
--      to active_level / ends_at.
--
-- Self-contained: rebinds the four triggers at the end so this
-- migration is sufficient even if 027's trigger DDL never ran.

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

  SELECT p.suspension_level, p.suspended_until
    INTO active_level, ends_at
    FROM public.profiles p
   WHERE p.id = actor_id;

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
