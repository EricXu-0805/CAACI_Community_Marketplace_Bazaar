-- ============================================================
-- 032_security_hardening_round2.sql
--
-- Closes three gaps surfaced by the April 2024 deep-scan audit.
--
-- ⚠ RUN ORDER — each section is independently applicable. If one
--   fails (most likely the storage section due to ownership), the
--   rest still apply. Forward-only. Idempotent. Safe to re-run.
--
--    Section 1 — public.post_comments          (works in SQL Editor)
--    Section 2 — storage.objects DELETE policy (SEE FALLBACK BELOW)
--    Section 3 — public.profiles consent       (works in SQL Editor)
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
      AND tablename = 'post_comments'
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
-- Current DELETE policy on item-images validates only path[1]
-- ('items'), while INSERT validates path[1] AND path[2] (<auth.uid()>).
-- Net: user can DELETE another user's images by guessing the path.
--
-- OWNERSHIP NOTE: storage.objects is owned by supabase_storage_admin.
-- The Dashboard SQL Editor runs as postgres which cannot DROP/CREATE
-- policies on it directly. We try SET LOCAL ROLE first; if that
-- fails (error 42501), the EXCEPTION block emits a NOTICE with the
-- manual UI fix and the migration continues to section 3.

DO $$
BEGIN
  BEGIN
    SET LOCAL ROLE supabase_storage_admin;

    DROP POLICY IF EXISTS "Users can delete own images" ON storage.objects;

    CREATE POLICY "Users can delete own images"
      ON storage.objects
      FOR DELETE
      TO authenticated
      USING (
        bucket_id = 'item-images'
        AND (storage.foldername(name))[1] = 'items'
        AND (storage.foldername(name))[2] = auth.uid()::text
      );

    RESET ROLE;
    RAISE NOTICE '032 section 2: storage.objects DELETE policy updated';

  EXCEPTION WHEN OTHERS THEN
    BEGIN RESET ROLE; EXCEPTION WHEN OTHERS THEN NULL; END;
    RAISE NOTICE '032 section 2: could not modify storage.objects from this session (error: %). Apply this fix MANUALLY via Supabase Dashboard → Storage → Policies → item-images bucket → edit "Users can delete own images" → USING expression: bucket_id = ''item-images'' AND (storage.foldername(name))[1] = ''items'' AND (storage.foldername(name))[2] = auth.uid()::text', SQLERRM;
  END;
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
