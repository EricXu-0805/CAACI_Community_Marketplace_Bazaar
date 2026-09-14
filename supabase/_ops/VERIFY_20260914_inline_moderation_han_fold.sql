\set ON_ERROR_STOP on
BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
DO $verify$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid='public.content_moderation_fold_han(text)'::regprocedure
    AND NOT p.prosecdef AND p.provolatile='i' AND p.proconfig IS NULL
    AND p.prolang=(SELECT oid FROM pg_catalog.pg_language WHERE lanname='sql')
    AND p.prosrc LIKE '%pg_catalog.translate(COALESCE(raw,%')
    OR public.content_moderation_fold_han('寫購職單結過證辦開發醫') <> '写购职单结过证办开发医'
    OR public.content_moderation_fold_han(NULL) <> ''
    OR public.content_moderation_fold_han('幹乾後髮 café 😀') <> '幹乾後髮 café 😀'
  THEN RAISE EXCEPTION 'inline_moderation_han_fold_verification_failed'; END IF;
END $verify$;
ROLLBACK;
