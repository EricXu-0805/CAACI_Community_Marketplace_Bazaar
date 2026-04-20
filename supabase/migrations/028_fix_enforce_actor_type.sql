-- 028 Fix: trg_enforce_actor CASE expression resolves NEW.col as text
-- on some Postgres versions, causing `WHERE id = uid` to fail with
-- 42883 (operator uuid = text does not exist).
--
-- Root cause: plpgsql's CASE ... WHEN tablename THEN NEW.col END
-- needs a single common return type across branches. Because NEW is
-- a record whose concrete type is only known at trigger-fire time,
-- plpgsql falls back to text for the CASE result on newer builds.
--
-- Fix: replace the CASE with an IF/ELSIF cascade so each branch
-- keeps its native uuid type.

CREATE OR REPLACE FUNCTION public.trg_enforce_actor()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  uid uuid;
  lvl smallint;
  ends timestamptz;
BEGIN
  IF TG_TABLE_NAME = 'posts' THEN
    uid := NEW.user_id;
  ELSIF TG_TABLE_NAME = 'post_comments' THEN
    uid := NEW.user_id;
  ELSIF TG_TABLE_NAME = 'items' THEN
    uid := NEW.user_id;
  ELSIF TG_TABLE_NAME = 'messages' THEN
    uid := NEW.sender_id;
  END IF;

  IF uid IS NULL THEN RETURN NEW; END IF;
  IF auth.uid() IS NOT NULL AND uid <> auth.uid() THEN RETURN NEW; END IF;

  SELECT suspension_level, suspended_until
    INTO lvl, ends
    FROM public.profiles WHERE id = uid;

  IF lvl IS NOT NULL AND lvl >= 2 AND (ends IS NULL OR ends > now()) THEN
    RAISE EXCEPTION 'suspension_active:%:%',
      lvl, COALESCE(to_char(ends, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'permanent');
  END IF;

  RETURN NEW;
END;
$$;
