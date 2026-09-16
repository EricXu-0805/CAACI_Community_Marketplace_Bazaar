# Google authorization branding — 2026-09-16

## Problem and observed configuration

The Google Cloud project `illini-market` already used the application name
**Illini Market** and the site's 集 logo. Its branding was unverified, its
homepage still pointed at the old Vercel address, and its privacy and terms
links were blank. `illinimarket.com` was missing from its brand domain list.

The configured H5 client matches the production Supabase callback. A fresh,
unauthenticated request to the public Supabase authorize endpoint returned a
302 to Google with that same client and only `email profile` scopes. No
account sign-in was completed and no authorization state, credentials or
tokens were retained.

## Changes

- Saved the formal website and existing in-app legal links in Google Cloud,
  and added `illinimarket.com` to the branding domain inventory. Kept the
  name, logo, support/developer addresses, OAuth client credentials, scopes
  and callback unchanged.
- Ran Google's branding verification. It returned three issues: homepage
  ownership not verified, homepage detected as a login page, and insufficient
  explanation of the app's purpose. These are provider findings, not a claim
  that ordinary anonymous users cannot browse listings.
- Added script-free `/about`, `/privacy`, and `/terms` pages, emitted during
  H5 builds. The introduction explains actual marketplace functionality,
  Google sign-in and transaction boundaries, with English and Chinese copy.
- Public policy pages derive their full text from the same versioned legal
  sources used by the in-app consent screen. No policy text or consent
  version was changed. The pages link to each other, support and deletion.
- Added discoverable About / Privacy / Terms links to the desktop sidebar.
- Added the public Google Search Console ownership meta tag issued to the
  existing Google Cloud project owner's account for the www site prefix.
  This tag is intended to be publicly served; it is not an API credential.

## Validation and remaining provider steps

- Type-check and H5 build passed. Both languages of each compiled policy
  were compared to their canonical source, and the static route mappings and
  compiled ownership tag were checked.
- Local browser preview was blocked by the browser URL policy. No alternate
  browser or raw automation bypass was used; no visual-preview pass claimed.
- The first pre-push run caught unsupported tag selectors in the new sidebar
  CSS for WeChat compilation. Replaced them with class selectors and gated
  browser-only pseudo selectors to H5; did not bypass the failing check.
- Deploy the exact commit, complete Search Console ownership verification,
  then set Google's public homepage to `/about` and legal URLs to `/privacy`
  and `/terms`. Re-run branding verification and publish only when Google
  reports that the brand is ready. Provider outcome is recorded separately
  under `output/oauth-branding-20260916/STATUS.md`.
- A saved draft is not a published brand. Fresh consent-screen and security
  notification email appearance are separate user-visible evidence. Google
  controls its notification email layout; previously delivered messages do
  not change retroactively.

## References

- [Google OAuth app branding](https://support.google.com/cloud/answer/15549049?hl=en)
- [Google homepage requirements](https://support.google.com/cloud/answer/13807376)
- [Supabase Google sign-in branding](https://supabase.com/docs/guides/auth/social-login/auth-google)
