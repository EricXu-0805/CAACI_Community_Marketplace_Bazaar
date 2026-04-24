-- ============================================================
-- 032_security_hardening_round2.sql
--
-- Closes three gaps surfaced by the April 2024 deep-scan audit:
--
--   1. post_comments has SELECT/INSERT/DELETE policies but no
--      UPDATE policy. Postgres' default behavior with RLS enabled
--      is "deny if no policy matches", which is fine today (users
--      simply can't edit comments). But it's a footgun: if a future
--      migration adds a permissive UPDATE policy without WITH CHECK
--      it'll silently allow cross-user edits. Fix: add an explicit
--      tight policy now so any future change is an obvious diff.
--
--   2. The storage.objects DELETE policy on the item-images bucket
--      validates only the first folder segment ('items'), while the
--      INSERT policy validates BOTH segments ('items/<auth.uid()>').
--      Net: a user can DELETE another user's images by guessing
--      their object key. Fix: align DELETE with INSERT validation.
--
--   3. profiles.tos_version and profiles.onboarded_at are nullable.
--      The App.vue consent gate redirects users with NULL tos_version
--      to /pages/reconsent, which is correct — but the gate runs in
--      JavaScript, so any direct PostgREST INSERT (e.g. via Supabase
--      Studio, a buggy admin script, or a future RPC) can create a
--      profile that bypasses the gate forever, since
--      `if (!u.tos_version || u.tos_version < CURRENT_CONSENT_VERSION)`
--      only fires the FIRST time a user logs in via the app. Fix:
--      backfill nulls with the v0 baseline, then make NOT NULL.
--
-- Forward-only. Idempotent (safe to re-run on partial application).
-- ============================================================

-- ---------------- 1. post_comments UPDATE policy ----------------

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
   cannot be reassigned mid-update. Without this row, any future
   permissive UPDATE policy would be a silent regression.';


-- ---------------- 2. storage DELETE policy alignment ----------------
--
-- Only re-create if the policy already exists (don't break fresh
-- installs that haven't seen 001 yet). This statement is ordered
-- after the storage policies are first created in 001/004/011.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND policyname = 'Users can delete own images'
  ) THEN
    DROP POLICY "Users can delete own images" ON storage.objects;
  END IF;

  CREATE POLICY "Users can delete own images"
    ON storage.objects
    FOR DELETE
    TO authenticated
    USING (
      bucket_id = 'item-images'
      AND (storage.foldername(name))[1] = 'items'
      AND (storage.foldername(name))[2] = auth.uid()::text
    );
END
$$;

COMMENT ON POLICY "Users can delete own images" ON storage.objects IS
  '032: DELETE now validates BOTH path segments (items/<uid>) to
   match the INSERT policy. Previously DELETE validated only the
   bucket folder, letting any authenticated user delete any other
   user''s items/<other-uid>/<file> object by guessing the path.';


-- ---------------- 3. consent column NOT NULL ----------------
--
-- Backfill first, then constrain. The backfill targets the small
-- population of legacy rows that existed before 026 added these
-- columns, where the migration left them nullable (no DEFAULT was
-- set because the original gate was app-layer only).

UPDATE public.profiles
   SET tos_version = 0
 WHERE tos_version IS NULL;

UPDATE public.profiles
   SET onboarded_at = NULL  -- intentionally keep NULL; gate sends to /onboarding
 WHERE FALSE;  -- no-op; documenting that onboarded_at NULL is meaningful

-- tos_version: NOT NULL DEFAULT 0 so direct INSERTs always have a
-- value the gate can compare against. CURRENT_CONSENT_VERSION lives
-- in app/src/legal/index.ts and should be bumped per release that
-- changes ToS. tos_version=0 means "needs to re-consent" → gate
-- redirects to /pages/reconsent, which is the safe behavior for
-- legacy rows.

ALTER TABLE public.profiles
  ALTER COLUMN tos_version SET DEFAULT 0,
  ALTER COLUMN tos_version SET NOT NULL;

-- onboarded_at: leave nullable. NULL is the "needs onboarding"
-- signal the gate uses (App.vue:66). Adding a default would falsely
-- claim the user finished the wizard.

COMMENT ON COLUMN public.profiles.tos_version IS
  '032: NOT NULL DEFAULT 0. App.vue gate redirects to /reconsent
   when this is < CURRENT_CONSENT_VERSION (legal/index.ts).';

COMMENT ON COLUMN public.profiles.onboarded_at IS
  '032: NULLABLE on purpose. App.vue gate redirects to /onboarding
   when this is NULL. Set to now() when the wizard finishes.';
