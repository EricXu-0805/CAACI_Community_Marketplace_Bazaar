# Street checks and public English content

This release adds an optional check of a listing's approximate street area and durable English translations for public Plaza posts and comments. Manual pickup locations remain supported. The browser's device position is not an attestation of residence, identity, physical presence or transaction safety.

## User-visible behavior

A signed-in website publisher can choose Detect current location. A fresh device fix (at most 60 seconds old, reported accuracy within 100 metres) is rounded to three decimal places before a server-side street lookup. The server accepts a mapped road near that coarse fix and issues a receipt tied to the account, live session, listing ID and exact street label. Publishing within ten minutes consumes that receipt and records the check time. Changing the location, an expired receipt, an unavailable provider or an imprecise fix leaves the listing unverified and never prevents manual publication. No coordinates, house number or apartment number are stored with the receipt.

The listing says “Street area checked” and its detail view explains the time and meaning. This is a device-assisted street-area check, not an anti-spoofing claim. Public Nominatim is capped at one request per second across the application; sustained demand beyond that requires a reviewed provider change. Concurrent users can receive a clear retry/manual option. Increasing that public-provider cap is not a scaling solution.

English readers, including signed-out readers, see persisted English counterparts of translated public posts and comments. Original text remains available. Editing source content invalidates stale translations; revision and lease checks prevent an older job from overwriting a newer edit. Deleted, hidden or ineligible content is not claimed. Private chat content and files never enter this queue. Translation is asynchronous and may fail or require retry; do not advertise that every new post appears instantly translated.

The existing background worker alternates which translation queue goes first. It makes at most one provider request per queue per invocation and retains its overall deadline. Pending and failed counts are returned to the protected operator endpoint; failed jobs produce content-free diagnostics. This bounded initial throughput is not a high-volume translation service SLA.

## Database-first release

Apply these additive migrations as one reviewed transaction before deploying the client:

1. `20260917033744_street_location_checks.sql`
2. `20260917034051_public_content_english.sql`
3. `20260917034644_accept_street_public_translation_privacy.sql`

`scripts/build-street-public-release.mjs` checks the immutable manifest and prepares an install bundle with dependency, previous-consent-definition and already-installed guards. It also copies the operational rollback. The database lock timeout is five seconds. Old, unsupported verification flags are cleared; all other listing content is preserved. Do not run a bulk migration push against a remote history whose bundled migration names differ.

The test branch records this exact three-file bundle as `20260917040435 / staging_only_reviewed_street_public_english`. This mapping is one application, not three missing remote migrations. Production application is tracked separately in private release receipts.

The rollback stops new receipt issuance and public translation claims. It retains all columns, existing translations, queued jobs, accepted consent versions and listing data, permitting the previous client to run without destructive down-migrations. Outstanding receipts expire normally. Forward recovery must deliberately restore the issuer/claim functions from the reviewed definitions.

## Verification and limitations

- Actual PostgreSQL regressions cover one-use receipts, live sessions, ownership, altered labels, expiry, grants, translation leases/revisions and rollback behavior.
- The same transaction-based functional probes run against the hosted test branch and roll back all synthetic fixtures.
- Browser fixtures cover phone, iPad and desktop layouts, manual-location invalidation, coarse-position fallback, public English and Original toggling. Their GPS/provider results are simulated; they do not certify physical GPS or the iOS permission sheet.
- Public schema preflight now checks the street timestamp and comment translation columns before the browser suite.
- Sentry preserves unknown historical issues. Empty error codes now fall back to safe HTTP/network status, without logging response bodies or user content.

Remaining platform gates are unchanged: real iPhone/iPad keyboard, system picker and background lifecycle; real WeChat experience-account approval and private-media moderation; signed native builds/store review; full production Auth/database/Storage recovery. This release does not enable a WeChat location interface outside approved platform capabilities.
