# Marketplace load tests

These are destructive **synthetic staging/local** scenarios. They create posts,
messages and reports and intentionally hit rate limits. They are not evidence of
production capacity until run against an isolated, representative deployment.
There are deliberately no production URL defaults. A label such as `staging`
cannot override the independent check for known production targets.

## Prepare

Install k6 following https://grafana.com/docs/k6/latest/set-up/install-k6/ .
Prepare consented, unrestricted synthetic accounts in an isolated dataset. Save
one `email:password` per line in `output/k6/accounts.txt` (ignored by Git). Colons
inside passwords are supported. Missing/empty files stop the run.

For message tests use only the buyer/seller of one synthetic conversation. Every
account is checked for membership before load begins. For reports choose a
separate synthetic target with no pending reports from these accounts. Remove
the disposable dataset after the run; do not reuse exhausted rate-limit buckets
and interpret the next run as an independent capacity measurement.

```sh
export SUPABASE_URL="https://<staging-ref>.supabase.co"
export SUPABASE_PUBLISHABLE_KEY="sb_publishable_..."
export APP_ORIGIN="https://<staging-app-host>"
export K6_TARGET_ENV="staging"
export K6_EXPECTED_SUPABASE_URL="https://<reviewed-staging-ref>.supabase.co"
export K6_EXPECTED_APP_ORIGIN="https://<reviewed-staging-app-host>"
export K6_DATASET_IS_SYNTHETIC=true
export TEST_ACCOUNTS_FILE="./output/k6/accounts.txt"

k6 run tests/k6/publish_spam.js
CONVERSATION_ID="<synthetic-conversation-uuid>" k6 run tests/k6/message_flood.js
TARGET_PROFILE_ID="<synthetic-target-uuid>" k6 run tests/k6/report_abuse.js
k6 run tests/k6/moderate_endpoint.js
```

A local target must be loopback. A hosted target must use HTTPS. Both origins
must match separately reviewed expected values. Production requires
`K6_TARGET_ENV=production` and
`K6_ALLOW_PRODUCTION_LOAD_TESTS=I_UNDERSTAND_THIS_WILL_LOAD_PRODUCTION` from an
approved maintenance plan, plus a synthetic dataset. No production run is part
of the default workflow.

## What the scenarios actually measure

| Scenario | Load | Required evidence |
|---|---|---|
| publish_spam | up to 30 VUs, 100 seconds | clean **posts** accepted, profanity rejected, posts p95 < 1.5 s |
| message_flood | 20 iterations/s, 60 seconds | member messages accepted, profanity rejected or specifically rate limited, p95 < 1.2 s |
| report_abuse | 10 VUs, 30 seconds | initial reports accepted and subsequent requests hit the exact pending-report unique constraint or named rate limit; p95 < 1.2 s |
| moderate_endpoint | up to 50 iterations/s, 65 seconds | authenticated real verdicts or explicit 429; p95 < 2 s; missing provider/skipped verdicts fail |

Each suite requires **100% of business checks** to pass. Arbitrary 400, 401,
403, schema/constraint failures, redirects and connection failures are not valid
proof of moderation or rate limiting. Expected business rejections are excluded
from the HTTP transport failure metric but still checked by their exact code.
Positive counters prevent an entirely refused workload from looking healthy.
Arrival-rate suites also fail if iterations are dropped.

Accounts authenticate once in setup. The business workload does not repeatedly
password-login on every iteration. Requests have a 10-second timeout and do not
follow redirects carrying credentials. Do not enable verbose HTTP tracing or
publish raw session/response data. The moderation scenario invokes external
providers and may incur staging usage charges.

Contact handles and everyday price negotiation are allowed by current policy.
These tests no longer classify those messages as spam. The publish suite tests
posts; it does not claim to benchmark item uploads, image processing or storage.
For one end-to-end listing with a photo use the guarded
`scripts/verify-staging-write-path.mjs` staging probe. Use separate workloads for
browse/search, fan-out, realtime reconnect storms, media uploads and deletion
backlogs before making user-capacity claims.
