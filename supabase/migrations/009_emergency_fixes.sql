-- ============================================
-- 009 Emergency fixes: auth + profile + publish flows
-- ============================================
-- Addresses 3 production bugs surfaced during user testing:
-- 1. New signups cannot log in (handle_new_user may have failed silently)
-- 2. Profile save returns no error but doesn't persist (RLS policy reinforcement)
-- 3. Manually confirm any users stuck with email_confirmed_at = null due to
--    broken redirect URLs in earlier signup flow.

-- --------------------------------------------
-- 1. Ensure profile UPDATE policy is strict with WITH CHECK
-- --------------------------------------------
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- --------------------------------------------
-- 2. Ensure INSERT policy exists (needed for handle_new_user edge case
--    where auth user exists but profile row never inserted)
-- --------------------------------------------
DROP POLICY IF EXISTS "Users can create own profile" ON public.profiles;
CREATE POLICY "Users can create own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- --------------------------------------------
-- 3. Reinforce handle_new_user with EXCEPTION WHEN OTHERS so trigger
--    failures do not block auth signup. Missing profile can be backfilled
--    by the app on next login via get_my_profile fallback.
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    INSERT INTO public.profiles (id, email, nickname, is_illini_verified)
    VALUES (
      NEW.id,
      NEW.email,
      COALESCE(NEW.raw_user_meta_data->>'nickname', split_part(NEW.email, '@', 1), 'user'),
      (LOWER(COALESCE(NEW.email, '')) LIKE '%@illinois.edu')
    )
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user failed for %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

-- --------------------------------------------
-- 4. Backfill: any auth.users without a profiles row gets one now
-- --------------------------------------------
INSERT INTO public.profiles (id, email, nickname, is_illini_verified)
SELECT
  u.id,
  u.email,
  COALESCE(u.raw_user_meta_data->>'nickname', split_part(u.email, '@', 1), 'user'),
  (LOWER(COALESCE(u.email, '')) LIKE '%@illinois.edu')
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL
ON CONFLICT (id) DO NOTHING;

-- --------------------------------------------
-- 5. Auto-confirm any stuck users whose email_confirmed_at is null.
--    These got locked out by the broken redirect URL in earlier signup.
--    Only applies to @illinois.edu and @gmail.com (trusted domains during beta).
-- --------------------------------------------
UPDATE auth.users
SET email_confirmed_at = NOW()
WHERE email_confirmed_at IS NULL
  AND (LOWER(email) LIKE '%@illinois.edu' OR LOWER(email) LIKE '%@gmail.com');

-- --------------------------------------------
-- 6. Verification queries (run separately after)
-- --------------------------------------------
-- SELECT count(*) AS auth_users FROM auth.users;
-- SELECT count(*) AS profiles FROM public.profiles;
-- SELECT count(*) AS unconfirmed FROM auth.users WHERE email_confirmed_at IS NULL;
-- SELECT policyname, cmd FROM pg_policies WHERE tablename = 'profiles' ORDER BY cmd;
