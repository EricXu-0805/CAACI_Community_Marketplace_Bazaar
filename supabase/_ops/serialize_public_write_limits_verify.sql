-- Read-only post-apply check. Compare the per-table RLS/ACL/policy and limiter
-- definition snapshot with pre-apply evidence separately.
\set ON_ERROR_STOP on
BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';
DO $$
DECLARE target text;
BEGIN
  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'private.serialize_public_write_actor()'::regprocedure) THEN
    RAISE EXCEPTION 'serializer must use caller privileges';
  END IF;
  IF has_function_privilege('anon', 'private.serialize_public_write_actor()', 'EXECUTE')
    OR has_function_privilege('authenticated', 'private.serialize_public_write_actor()', 'EXECUTE') THEN
    RAISE EXCEPTION 'serializer must not become a callable public RPC';
  END IF;
  FOREACH target IN ARRAY ARRAY['items','posts','post_comments','messages','reports'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger t
      WHERE t.tgrelid = ('public.' || target)::regclass
        AND t.tgname = 'serialize_public_write_actor' AND t.tgtype = 7
        AND t.tgenabled = 'O'
        AND t.tgfoid = 'private.serialize_public_write_actor()'::regprocedure
    ) THEN RAISE EXCEPTION 'missing enabled serializer: %', target; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger t
      WHERE t.tgrelid = ('public.' || target)::regclass
        AND t.tgname = 'trg_rl_' || target || '_before_insert'
        AND t.tgname > 'serialize_public_write_actor' AND t.tgenabled = 'O'
    ) THEN RAISE EXCEPTION 'missing subsequent rate limit: %', target; END IF;
  END LOOP;
END;
$$;
SELECT 'five serializers enabled, invoker-only, direct execution denied' AS verification;
ROLLBACK;
