# Bilingual consistency — 2026-09-16

## Scope and decisions

English is the fallback for unknown system locales and missing UI translations.
A saved Chinese choice and a Simplified Chinese system locale still open in Chinese.
Explicit language selection controls interface labels; user-authored text remains
intact unless an existing translation is available. Product names remain paired in
outbound emails. Public pages and unknown-recipient emails put English first while
retaining Chinese.

## Changes

- Removed mixed Chinese/English labels from seller/plaza tabs, category pairs and
  location-permission dialogs; WeChat and browsers now receive relevant permission
  instructions instead of the same Safari-specific path.
- Added visible language controls on welcome, sign-in and password recovery. The
  settings picker uses the same supported-language list as the rest of the app.
- Updated the browser title immediately on a language change, including the root
  route; retained locale persistence, native-dialog locale and account-scoped email
  preference synchronization.
- Localized mini-program share titles for home, plaza, profiles, listings and posts.
  Public web link previews use English-first system labels and preserve author
  content/language. Chinese public-policy links open the Chinese section.
- Digest system titles now use the same wording as in-app notifications. Exact
  legacy-system-title matching preserves arbitrary user text. Unknown recipients
  receive bilingual copy with English first.
- Meetup emails format the date for the selected language in America/Chicago,
  including daylight-saving offsets. Email headers, fallbacks and unsubscribe
  confirmation pages now put English first; unsubscribe still requires POST.
- Prepared English-first signup/recovery templates with Chinese paragraphs marked
  for screen readers. These files do not automatically update Supabase Auth.

## Evidence and acceptance boundary

- 61 focused boundary tests passed, covering catalogs/parameters, locale fallback,
  account email-preference synchronization, digest/meetup copy, timezone handling,
  sharing metadata and unsubscribe behavior. Type checking passed.
- Added browser regression coverage for phone/tablet/desktop entry-point switching,
  refreshed preference persistence, root-page title updates and no horizontal
  overflow. Full release checks and deployed-browser evidence are recorded in the
  release receipt after they run; their existence alone is not a pass.
- The local browser preview was blocked by Chrome (ERR_BLOCKED_BY_CLIENT).
  No browser-policy workaround was used and no local visual pass is claimed.
- Supabase dashboard access for recovery-template application was already blocked
  by automatic approval review in the prior round. This request does not remove
  that restriction. Both newly reordered Auth templates need backend application
  and fresh receipt before this new layout can be called live.
- Google's own new-authorization/security email is separate from site OTP emails;
  it remains pending and is not covered by these code tests.
- H5 viewport simulation/build evidence does not certify physical iOS/iPad input,
  WeChat experience-version behavior, or platform review.
