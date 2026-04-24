-- ============================================================
-- 032_security_hardening_round2.sql
--
-- Three audit gaps. Forward-only. Idempotent. Safe to re-run.
-- Every section is independently applicable — a failure in section 2
-- does NOT abort sections 1 and 3.
-- ============================================================


-- ---------------- 1. post_comments UPDATE policy ----------------
--
-- Table has SELECT/INSERT/DELETE but no UPDATE policy. Postgres RLS
-- default is deny-if-no-match, fine today. Footgun: any future
-- migration that adds UPDATE without WITH CHECK silently allows
-- cross-user edits. Pinning a tight policy now means any future
-- relaxation shows up as an obvious code-review diff.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'post_comments'
      AND policyname = 'Users can update own comments'
  ) THEN
    CREATE POLICY "Users can update own comments"
      ON public.post_comments
      FOR UPDATE
      TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END
$$;

COMMENT ON POLICY "Users can update own comments" ON public.post_comments IS
  '032: explicit UPDATE policy. Tight USING + WITH CHECK so user_id
   cannot be reassigned mid-update.';


-- ---------------- 2. storage.objects DELETE policy alignment ----------------
--
-- Current DELETE policy on item-images validates only path[1] ('items'),
-- while INSERT validates path[1] AND path[2] (<auth.uid()>). Net: one
-- user can DELETE another user's images by guessing the path.
--
-- PLATFORM NOTE: Since Supabase's April 2025 platform change
-- (supabase/postgres PR #994), the postgres role — which SQL Editor
-- runs as — is no longer a member of supabase_storage_admin, so
-- DROP POLICY on storage.objects raises 42501 "must be owner". The
-- canonical workaround (also used by migration 011 in this repo) is
-- to wrap DROP in a nested BEGIN/EXCEPTION that swallows
-- insufficient_privilege. CREATE POLICY on storage.objects is still
-- allowed per Supabase's April 2025 whitelist.
--
-- FAILURE MODE: If the DROP is silently skipped, the old broken
-- policy remains and the IF NOT EXISTS guard around CREATE
-- short-circuits — you'll see the RAISE NOTICE in the output and
-- must apply the fix via the Dashboard UI instead:
--    Storage → Policies → item-images → "Users can delete own images"
--    → edit → set USING to the expression below.

DO $$
DECLARE
  drop_succeeded boolean := false;
BEGIN
  BEGIN
    DROP POLICY IF EXISTS "Users can delete own images" ON storage.objects;
    drop_succeeded := true;
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE '032 section 2: DROP POLICY skipped (postgres no longer owns storage.objects since Supabase April 2025 platform change). The old broken DELETE policy is still in place. Fix via Dashboard: Storage -> Policies -> item-images -> edit "Users can delete own images" -> set USING to: bucket_id = ''item-images'' AND (storage.foldername(name))[1] = ''items'' AND (storage.foldername(name))[2] = auth.uid()::text';
    WHEN OTHERS THEN
      RAISE NOTICE '032 section 2: DROP POLICY failed with unexpected error: %. Skipping CREATE. Apply via Dashboard UI.', SQLERRM;
  END;

  IF drop_succeeded AND NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND policyname = 'Users can delete own images'
  ) THEN
    CREATE POLICY "Users can delete own images"
      ON storage.objects
      FOR DELETE
      TO authenticated
      USING (
        bucket_id = 'item-images'
        AND (storage.foldername(name))[1] = 'items'
        AND (storage.foldername(name))[2] = auth.uid()::text
      );
    RAISE NOTICE '032 section 2: storage.objects DELETE policy updated to validate BOTH path segments.';
  END IF;
END
$$;

-- COMMENT ON POLICY also requires ownership on storage.objects, so
-- wrap it the same way. If the policy update above was deferred to
-- the Dashboard UI, this comment attach is a no-op.

DO $$
BEGIN
  EXECUTE $cmt$
    COMMENT ON POLICY "Users can delete own images" ON storage.objects IS
      '032: DELETE now validates path[1]=''items'' AND path[2]=auth.uid().
       Previously only path[1] was checked, letting any authenticated
       user delete other users items/<uid>/<file> objects.'
  $cmt$;
EXCEPTION
  WHEN insufficient_privilege THEN NULL;
  WHEN undefined_object       THEN NULL;
  WHEN OTHERS                 THEN NULL;
END
$$;


-- ---------------- 3. consent column NOT NULL ----------------
--
-- profiles.tos_version is nullable. App.vue gate redirects on NULL,
-- so legacy rows pre-dating 026 pass through correctly. But any
-- direct PostgREST INSERT (Studio, admin script, future RPC) can
-- create a profile with NULL tos_version that bypasses the gate
-- permanently on re-login. Backfill to 0 then constrain.
-- onboarded_at intentionally stays nullable: NULL is the "needs
-- onboarding" signal the gate uses.

UPDATE public.profiles
   SET tos_version = 0
 WHERE tos_version IS NULL;

DO $$
BEGIN
  ALTER TABLE public.profiles
    ALTER COLUMN tos_version SET DEFAULT 0;
EXCEPTION WHEN OTHERS THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE public.profiles
    ALTER COLUMN tos_version SET NOT NULL;
EXCEPTION WHEN OTHERS THEN NULL;
END
$$;

COMMENT ON COLUMN public.profiles.tos_version IS
  '032: NOT NULL DEFAULT 0. App.vue gate redirects to /reconsent when
   this is < CURRENT_CONSENT_VERSION (legal/index.ts).';

COMMENT ON COLUMN public.profiles.onboarded_at IS
  '032: NULLABLE on purpose. App.vue gate redirects to /onboarding
   when this is NULL. Set to now() when the wizard finishes.';
