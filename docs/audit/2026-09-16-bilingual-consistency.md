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

- Full local pre-push boundaries, type checking, H5 and mp-weixin builds and
  compiled-artifact checks passed at b9b100c. 61 focused tests covered catalogs/parameters, locale fallback,
  account email-preference synchronization, digest/meetup copy, timezone handling,
  sharing metadata and unsubscribe behavior. Type checking passed.
- Added browser regression coverage for phone/tablet/desktop entry-point switching,
  refreshed preference persistence, root-page title updates and no horizontal
  overflow. Full release checks and deployed-browser evidence are recorded in the
  release receipt after they run; their existence alone is not a pass.
- The local browser preview was blocked by Chrome (ERR_BLOCKED_BY_CLIENT).
  No browser-policy workaround was used and no local visual pass is claimed.
- After a prior automatic-approval timeout blocked dashboard access, the user
  explicitly approved access and both template updates in this round. Signup and
  recovery subjects/body were saved through the dashboard; signup was reloaded
  and previewed to confirm persistence. A new recovery email reached the original
  Gmail alias at 17:42:43 UTC: English-first title/body, current brand, six-digit
  code and domain link verified; SPF/DKIM/DMARC passed and Gmail rendering was
  visually checked. No password was changed. The already-confirmed account did
  not receive another signup message after an accepted resend. With explicit
  approval, a new plus label of the same Gmail received a fresh signup email at
  17:47:13 UTC. The same sender/content/domain/authentication checks and actual
  Gmail rendering passed. No new Google account was created, no OTP was redeemed,
  and no onboarding or publishing was performed. Private receipts are under
  `output/bilingual-20260916/`.
- Google's own new-authorization/security email is separate from site OTP emails;
  it remains pending and is not covered by these code tests.
- H5 viewport simulation/build evidence does not certify physical iOS/iPad input,
  WeChat experience-version behavior, or platform review.

## Production verification follow-up

- PR #335 merged as `8a8b5b2` after all four required checks passed. Vercel
  production deployment `dpl_EsqC5zrAMdUM7GLnTauZT55b1oct` is READY with both
  market domains assigned; the actual Settings page displays `8a8b5b2`.
- Deployed Chrome checks passed for desktop Settings language switching and
  reload persistence, English Plaza/composer controls (1440 × 900); phone Welcome
  and Sign In switching plus refreshed language persistence (390 × 844); and
  tablet recovery/Home titles and labels (1024 × 768). Observed document widths
  matched each viewport without horizontal overflow. These are viewport checks,
  not physical-device certification. No content was submitted or password changed.
- The full PR public sweep reported 365 passed, 1 skipped and 1 failed. The sole
  failure was the previous exact `/account-deletion` href expectation: the new
  language-specific link correctly includes `#english`. The follow-up updates
  that contract and adds the equivalent Chinese policy/deletion-guide case;
  full follow-up CI must pass before reporting this regression gate as complete.
