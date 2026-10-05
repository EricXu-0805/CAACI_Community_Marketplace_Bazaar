# Production cron release gate

The five scheduled GET routes in `vercel.json` must pass `releasedCron` before
business work or Sentry cron check-ins. A production candidate can receive cron
requests while its custom domain is still waiting for release checks. Production
environment, a valid cron secret, or a matching Git commit alone is insufficient.

## Runtime contract

1. The existing deployment boundary verifies environment, Supabase project, and
   configured app origin. The cron wrapper then authenticates `CRON_SECRET`.
2. Production must have a valid runtime `VERCEL_DEPLOYMENT_ID`, full 40-character
   `VERCEL_GIT_COMMIT_SHA`, and `DEPLOYMENT_APP_ORIGIN` equal to one of the two
   source-allowlisted official origins: `https://illinimarket.com` (the current
   production configuration) or `https://www.illinimarket.com`.
3. The wrapper always fetches `https://www.illinimarket.com/api/deployment-identity` with a new
   UUID nonce. The public endpoint returns only schema, environment, deployment
   ID, commit, project ref, configured app origin, and nonce. It performs no
   database/provider work and returns no secrets.
4. Only HTTP 200 JSON with the exact nonce and every matching identity field
   permits work. The probe carries no cron secret, cookie, user authorization,
   protection bypass, or caller routing header. Redirects fail closed. Fetch and
   body consumption share a three-second timeout and a 4 KiB response limit.
5. Every invocation probes again, without a cached allow decision. A different
   deployment built from the same commit remains blocked. Missing endpoint,
   malformed/stale response, network error, or mismatch returns 503 before work
   or any Sentry cron check-in. Vercel does not retry failed cron invocations;
   `Retry-After: 60` is advisory to manual clients, and the next scheduled tick
   checks again.

The authority is fixed in reviewed source so a candidate cannot set its own
unique URL as `DEPLOYMENT_APP_ORIGIN` and authorize itself. A deliberate domain
change requires a reviewed source change. Root-origin app configuration remains
valid, but the probe itself uses `www` directly and never follows a redirect.
Reviewed Preview/local worker behavior is unchanged; this is a production
promotion gate. User-initiated account-deletion POST and OPTIONS retain their
existing authentication and processing paths.

The runtime endpoint avoids relying on deployment IDs in static/prebuilt files:
a reused artifact or same-commit redeployment is still checked against its
runtime deployment ID. There is no SHA-only fallback. No new database migration,
secret, feature flag, or cloud configuration setting is introduced.

## Release acceptance

This change needs normal review, CI, candidate deployment, and formal promotion.
Local tests alone do not complete production acceptance.

- Before release, read back existing production configuration: the app origin
  must be one of the two official origins above, and Vercel runtime system
  variables must be exposed. The root-domain configuration already in use is
  supported without changing cloud variables. The formal `www` probe must
  return directly. Do not relax the gate to accommodate missing identity.
- Inspect the candidate's read-only identity endpoint with a new UUID nonce and
  compare its deployment ID/full commit with Vercel's candidate record. This
  confirms runtime metadata, without manually triggering a destructive worker.
- Before promotion, the candidate's normal scheduled GETs must return 503 and
  perform no queue/provider operations or Sentry check-ins. During the first
  rollout, the old formal deployment lacks this endpoint, so a candidate returns
  `cron_release_unverified`; this is expected. Later candidates should return
  `cron_deployment_not_current` against an older formal deployment.
- After all existing release checks pass and the candidate is promoted, use a
  fresh nonce to verify the **formal domain** serves the same deployment ID,
  commit, project, and origin. Observe the next normal scheduled run and its
  authorized work/check-in; do not equate a read-only probe with a worker pass.
  All five schedules need observation at their normal cadence.
- During an approved rollback rehearsal, verify a new invocation of the removed
  deployment is blocked and the current deployment works. Jobs already
  authorized before a domain switch may finish; this gate does not cancel them
  or provide a distributed lock. Existing job leases/idempotency remain needed.

A deployment predating this change has no gate. Rolling back to it restores that
old behavior. Candidate cron scheduling may interrupt normal worker cadence
while release checks are pending; monitor backlog and missing check-ins. Do not
claim this patch keeps the previous deployment's scheduler active. Identity
probe outages also pause production cron intentionally. Only background-jobs
had a configured missing-run monitor in the 2026-09-19 record; the other four
monitor configurations remain separate operational work.

## Verification

Run with the project's Node 22 runtime:

```sh
node --test --test-concurrency=2 api/*.test.mjs
node --test scripts/vercel-function-boundary.test.mjs
```

`api/_cron-release.test.mjs` executes all scheduled handlers with rejected
candidate identities, checks same-commit redeploys, fresh promotion/rollback
decisions, authentication and credential confinement, ordinary deletion POST,
and failure paths including streamed-body timeout. The deployment-file bundle
test copies only shipped API runtime sources before bundling every route.

## Platform references

- [Vercel production deployment states](https://vercel.com/docs/deployments/promoting-a-deployment#production-deployment-state): staged/current and domain assignment are distinct from the production environment.
- [Vercel system variables](https://vercel.com/docs/environment-variables/system-environment-variables#vercel_deployment_id): deployment ID is unique and available at runtime; a production URL variable is also present in Preview and is not an approval signal.
- [Vercel prebuilt caveat](https://vercel.com/docs/cli/deploy#when-not-to-use---prebuilt): build-time system-variable availability differs for prebuilt workflows.
- [Vercel cron operations](https://vercel.com/docs/cron-jobs/manage-cron-jobs): failures are not retried, running jobs survive a deployment change, and delivery requires idempotent processing.
