-- ============================================
-- Per-user email language
-- ============================================
-- Notification and meetup mail is bilingual for everyone because the server has
-- no idea what language the recipient reads: `setLang` writes only
-- uni.setStorageSync('lang', …) (app/src/composables/useI18n.ts), and nothing
-- has ever carried that to the server. Google OAuth does not fill the gap —
-- 0 of 19 production users carry a `locale` claim, including all 8 Google
-- identities, because Supabase's default scope never requests it.
--
-- WHY A SEPARATE TABLE INSTEAD OF public.profiles.lang
-- ----------------------------------------------------
-- A profiles column looks like the obvious home and is a trap.
-- `get_my_profile()` is `RETURNS public.profiles`, so PostgreSQL 17 deparses the
-- Plaza RLS policy expressions with the table's FULL composite alias.
-- 20260719151729 pins that 33-column literal (profile_pg17_alias) and normalizes
-- the deparsed predicate against it before comparing, raising
-- `plaza_acl_policy_contract_mismatch` when it no longer matches. A fresh replay
-- would still pass — that migration runs before this one, when profiles is
-- exactly 33 columns wide — but its VERIFY/PRECHECK in supabase/_ops are
-- read-only diagnostics meant to be runnable against production at any time, and
-- a 34th column would make them fail forever after. The migration's bytes are
-- frozen (version <= 20260719174928), and
-- scripts/plaza-base-table-acl-forward-boundary.test.mjs asserts the migration,
-- PRECHECK and VERIFY all carry the SAME alias, so repairing it would mean
-- teaching that guard to accept two different aliases — weakening the pin to buy
-- a column. A separate table leaves the entire Plaza contract untouched.
--
-- ACL SHAPE
-- ---------
-- No grants to anon or authenticated at all. The only write path is the
-- SECURITY DEFINER RPC below, which derives the row from auth.uid() and can
-- therefore never be aimed at another account. The digest and meetup senders
-- read it with the service key, which bypasses RLS and column grants. RLS is
-- enabled and FORCEd anyway so a future accidental grant fails closed rather
-- than exposing which users read which language.
--
-- Deleting an account removes the row: user_id cascades from public.profiles,
-- whose id cascades from auth.users, and api/auth/delete-account.js hard-deletes
-- the auth user. No new work for the deletion saga.

CREATE TABLE IF NOT EXISTS public.user_email_prefs (
  user_id    uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  lang       text NOT NULL
             CONSTRAINT user_email_prefs_lang_check CHECK (lang IN ('zh', 'en')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_email_prefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_email_prefs FORCE ROW LEVEL SECURITY;

-- REVOKE FROM PUBLIC alone is not enough on this stack; anon and authenticated
-- must be named explicitly (the durable lesson from 064 and 069).
REVOKE ALL ON TABLE public.user_email_prefs FROM PUBLIC;
REVOKE ALL ON TABLE public.user_email_prefs FROM anon;
REVOKE ALL ON TABLE public.user_email_prefs FROM authenticated;

CREATE OR REPLACE FUNCTION public.set_my_email_language(p_lang text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  -- Mirrors SUPPORTED_LANGS in app/src/composables/i18n/types.ts. An unknown
  -- value is rejected rather than coerced, so a client bug cannot quietly park
  -- every user on a language nobody chose.
  IF p_lang IS NULL OR p_lang NOT IN ('zh', 'en') THEN
    RAISE EXCEPTION 'unsupported_language' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.user_email_prefs AS pref (user_id, lang, updated_at)
  VALUES (v_uid, p_lang, now())
  ON CONFLICT (user_id) DO UPDATE
    SET lang = EXCLUDED.lang, updated_at = now()
    WHERE pref.lang IS DISTINCT FROM EXCLUDED.lang;
END;
$$;

REVOKE ALL ON FUNCTION public.set_my_email_language(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_my_email_language(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_my_email_language(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
