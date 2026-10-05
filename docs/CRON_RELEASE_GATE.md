# Production cron release gate

The five scheduled GET routes in `vercel.json` must pass `releasedCron` before
business work or Sentry cron check-ins. A production candidate can receive cron
requests while its custom domain is still waiting for release checks. Production
environment, a valid cron secret, or a matching Git commit alone is insufficient.


## CI-first production creation

`git.deploymentEnabled: false` disables automatic Git deployments for every
branch. The existing main-only `Production release readiness` check remains
mandatory, but is now a prerequisite to **creating** a production candidate,
not only to assigning its domain. Keep the existing deployment check; do not
force-promote or remove it.

For a separately authorized release:

1. Serialize release activity. Re-read this repository's current full main SHA
   and its complete `CI` run/attempt. Require the six upstream jobs and
   `Production release readiness` to have actually succeeded on that exact SHA.
   A green PR, weekly audit, skipped staging check, stale run or another workflow
   is insufficient. Resolve any outstanding production candidate before
   creating another; never cancel or promote one blindly.
2. `scripts/check-ci-first-release.mjs <snapshot.json>` is an **offline additional
   preflight**, not an authenticated API client, authorization or release lock.
   Its input contains requestedSha, mainSha, projectId, vercelConfig, an explicit
   productionCandidates `{projectId, complete, items}` inventory, the GitHub run fields, and
   jobs `{run_id, run_attempt, complete, items}` collected completely for the
   same attempt. Every job also binds run_id/run_attempt/head_sha. Re-read live
   state immediately before the authorized action;
   source configuration alone does not prove that cloud settings have applied.
3. In the existing project's normal Deployments → Create Deployment flow,
   enter the exact verified 40-character SHA. If that SHA belongs to several
   branches, select main/Production configuration. Create once. This sequence
   needs no new token, deploy hook, permission, paid scheduler or Preview copy
   of production credentials. Do not use `--skip-domain` to park another
   production candidate while waiting for CI.
4. Preserve the deployment-ID/commit/project/nonce gate below. Read the created
   candidate's runtime identity and normal platform deployment metadata. Allow
   ordinary checks/promotion; if it fails or outcome is unknown, inspect the
   existing deployment instead of creating a replacement.
5. Verify the root domain's expected redirect to www and the www runtime
   identity directly; read back both domains' platform deployment identity. Observe naturally scheduled
   runs and provider-accepted Sentry check-ins separately; a 200 worker response
   is not a Sentry receipt. Preserve each existing task's durable claim and
   idempotency state.

This prevents the observed long **CI-wait** period from beginning after a new
production candidate exists. It does **not** prove atomic cron/alias handoff,
zero missed delivery or non-overlapping old/new workers. Vercel documents
best-effort delivery, no retry, possible overlap/duplicates, and that a new
deployment does not stop in-flight functions. An old run admitted before a
switch can still finish afterward. Never relax the runtime identity gate or
forward a scheduler credential to a caller-controlled target to hide that gap.

A strict no-overlap/catch-up requirement additionally needs persistent scheduled
slots, deployment-wide admission and draining, stable business-effect keys,
and authoritative completion of in-flight effects. Unknown remote outcomes
must block release rather than be cleared by a lease timeout. Such coordination
is **not implemented by this configuration/preflight**. It requires separately
reviewed database/runtime integration and a legacy-worker bootstrap; its offline
reference model is not production code. Do not claim the overall handoff defect
is fully repaired by CI-first creation alone.

Official sequence references:
- [Git deployment policy](https://vercel.com/docs/project-configuration/git-configuration#git.deploymentenabled)
- [Create from an exact Git reference](https://vercel.com/docs/git#creating-a-deployment-from-a-git-reference)
- [Checks delay domain assignment](https://vercel.com/docs/deployment-checks#github-checks)

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
runtime deployment ID. There is no SHA-only fallback. The runtime identity gate
itself introduces no new database migration, secret, feature flag or cloud
configuration setting. The separate CI-first proposal above does change the
Git deployment policy and is not active until its authorized rollout.

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
- Any normal scheduled GET arriving at a candidate before promotion must return
  503 and perform no queue/provider operations or Sentry check-ins. Do not hold
  a ready release merely to wait for a cron invocation. During the first
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
