-- Emergency rollback only if serialization causes a confirmed operational
-- regression. Restores the old concurrent quota race; retain other safeguards.
BEGIN;
SET LOCAL lock_timeout = '5s';
DROP TRIGGER IF EXISTS serialize_public_write_actor ON public.items;
DROP TRIGGER IF EXISTS serialize_public_write_actor ON public.posts;
DROP TRIGGER IF EXISTS serialize_public_write_actor ON public.post_comments;
DROP TRIGGER IF EXISTS serialize_public_write_actor ON public.messages;
DROP TRIGGER IF EXISTS serialize_public_write_actor ON public.reports;
DROP FUNCTION IF EXISTS private.serialize_public_write_actor();
COMMIT;
