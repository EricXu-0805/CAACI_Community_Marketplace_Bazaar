# First-party acquisition report

The campaign report is prospective, starting only when the production flag is enabled. It cannot recover attribution for old untagged invitations. No third-party analytics provider is introduced. The existing security limiter retains a daily HMAC network bucket, never a raw IP in acquisition tables.

## Deployment

1. Apply `20260919090000_first_party_acquisition.sql` and `20260919090100_accept_acquisition_privacy.sql` to staging, verify, then production before shipping the September 19 consent bundle.
2. Keep `ACQUISITION_ENABLED` absent/false until tests and privacy text are reviewed. Set to `true` in Production only before the approved build. Preview events are ignored even with this variable present.
3. Run normal H5/mini and boundary checks; verify new consent is accepted before production promotion.
4. In a new tagged production browser tab verify a single session receipt, no full URL/referrer in requests, and reload deduplication. Never register fake supply. Existing accounts cannot become new acquisitions.

## Metric definitions

| Column | Meaning |
| --- | --- |
| visits | Deduplicated tagged browser-tab sessions, not distinct humans; max 24-hour reuse |
| registrations | Verified new-email/Google account created after its session began, attributed within 24 hours after the new policy is accepted |
| publishers | These new accounts with at least one non-deleted actual listing created since registration |
| contacts | These new accounts that actually sent at least one message since registration |

Publishing and contacting are parallel seller/buyer outcomes, not mandatory consecutive funnel steps. No completed-sale claim is made. Blocking scripts, GPC/DNT, untagged/direct links, cross-browser email confirmation, shared-network rate limiting, session loss and browser-tab changes can undercount. These are observed campaign cohorts, not causal advertising attribution. Consent wait, existing-account sign-ins and unconfirmed registrations are not counted as new acquisitions.

The service-only query is `SELECT * FROM public.acquisition_report(7)` (1–30 days). Browser and normal authenticated users cannot read or mutate acquisition tables or call reporting/writing RPCs. Account IDs never appear in the output. Test cohorts can be excluded by setting the corresponding private `acquisition_accounts.excluded=true`; production test receipts must be removed by their exact known session IDs, not by broad cleanup. Account deletion cascades linked data. Older-than-30-day sessions are excluded immediately and purged in bounded hourly retention batches; monitor maintenance failures.

## Campaign links

Use these channel labels exactly; no names, emails, free-text marketing copy or precise locations go in source tags.

- CAACI: `https://www.illinimarket.com/?utm_source=caaci`
- UIUC student groups: `https://www.illinimarket.com/?utm_source=wechat_students`
- CU resident groups: `https://www.illinimarket.com/?utm_source=wechat_local`
- Facebook: `https://www.illinimarket.com/?utm_source=facebook`
- Reddit: `https://www.illinimarket.com/?utm_source=reddit`
- Xiaohongshu: `https://www.illinimarket.com/?utm_source=xiaohongshu` (only where platform rules permit; do not reinsert prohibited external links into restricted posts)
- Instagram: `https://www.illinimarket.com/?utm_source=instagram`
- X: `https://www.illinimarket.com/?utm_source=x`
- LinkedIn: `https://www.illinimarket.com/?utm_source=linkedin`

## Pause / recovery

Turn `ACQUISITION_ENABLED=false` and deploy through the normal gate to stop new writes. Core auth/publishing/chat never await this service. Keep the expanded consent allowlist and retention function in place during rollback; an older frontend must not downgrade stored consent or strand users. Reporting can remain available to operators while collection is paused. Do not drop tables or old accepted policy versions as an emergency stop.
