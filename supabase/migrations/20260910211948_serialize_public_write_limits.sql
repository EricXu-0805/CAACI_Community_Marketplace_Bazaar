-- Serialize each actor's writes before the existing COUNT/deduplication
-- triggers. At READ COMMITTED their later queries then see the predecessor's
-- committed row instead of allowing parallel requests to spend one slot.
-- Different actors/tables use independent transaction-scoped locks.
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION private.serialize_public_write_actor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
  actor uuid;
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'messages' THEN actor := NEW.sender_id;
    WHEN 'reports' THEN actor := NEW.reporter_id;
    WHEN 'items', 'posts', 'post_comments' THEN actor := NEW.user_id;
    ELSE RAISE EXCEPTION 'unsupported public write table';
  END CASE;

  IF actor IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'public-write:' || TG_TABLE_NAME || ':' || actor::text, 0
    ));
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.serialize_public_write_actor() FROM PUBLIC, anon, authenticated;

-- PostgreSQL runs same-kind triggers in name order. This must precede each
-- existing trg_rl_* trigger, after payload/actor validation and moderation.
-- RLS, grants and the limit values are unchanged.
CREATE TRIGGER serialize_public_write_actor BEFORE INSERT ON public.items
  FOR EACH ROW EXECUTE FUNCTION private.serialize_public_write_actor();
CREATE TRIGGER serialize_public_write_actor BEFORE INSERT ON public.posts
  FOR EACH ROW EXECUTE FUNCTION private.serialize_public_write_actor();
CREATE TRIGGER serialize_public_write_actor BEFORE INSERT ON public.post_comments
  FOR EACH ROW EXECUTE FUNCTION private.serialize_public_write_actor();
CREATE TRIGGER serialize_public_write_actor BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION private.serialize_public_write_actor();
CREATE TRIGGER serialize_public_write_actor BEFORE INSERT ON public.reports
  FOR EACH ROW EXECUTE FUNCTION private.serialize_public_write_actor();
