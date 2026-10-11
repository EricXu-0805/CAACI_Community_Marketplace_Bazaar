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
   same attempt. Collect jobs from the attempt-specific GitHub endpoint,
   traverse every page, and verify the collected count against `total_count`.
   Every job also binds run_id/run_attempt/head_sha. Re-read the current main
   and the run's latest attempt immediately before the authorized action;
   source configuration alone does not prove that cloud settings have applied.
3. In the existing project's normal Deployments → Create Deployment flow,
   enter the exact verified 40-character SHA. If that SHA belongs to several
   branches, select main/Production configuration. The existing authorized
   deployment API is equivalent: bind the verified project/team and repository
   ID, set `target: production`, and supply Git source `ref: main` plus the exact
   `sha`. Metadata labels alone do not bind source. Do not substitute latest
   commit selection, uploaded local files, or project-setting overrides.
   Create once. This sequence
   needs no new token, deploy hook, permission, paid scheduler or Preview copy
   of production credentials. Do not use `--skip-domain` to park another
   production candidate while waiting for CI.
4. Preserve the deployment-ID/commit/project/nonce gate below. The coordinator
   contract below prepares **before creation** and watches the returned candidate
   immediately. Its default CLI transport blocks writes because the CLI cannot
   disable internal POST retries. The explicit native HTTPS path below provides
   a single-request transport, but needs an already approved external credential
   injection and separate release authorization. Preparation does not verify
   either condition or authorize creation; do not create a candidate assuming
   the default read-only path will promote it.
   If it fails or the outcome is unknown, inspect that existing deployment
   instead of creating a replacement or repeating Promote.
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

## Prepared READY-to-Promote coordinator

The strict coordinator below is one optional automatic handoff implementation.
Its single-HTTP-attempt and conservative inventory requirements must not be
silently changed, but they do not govern every ordinary supervised release.
The [existing-connector/browser protocol](SUPERVISED_RELEASE.md) keeps the same
exact-main CI, runtime identity, normal Promote and post-release checks while
truthfully limiting its guarantee to one host tool invocation with durable
intent and read-only recovery. Historical STAGED records are reviewed as history,
not deleted or assumed to be active work solely from that state. That protocol
needs separate production authorization and does not promise atomic Cron handoff.

The bounded supervised controller prepares before candidate creation, polls the
returned candidate, runs independent final reads together and enters the existing
connector immediately after its durable reservation. It addresses host delay,
not a platform transaction: the measured 2026-10-10 release spent 110.407 seconds
between READY and Promote, then 6.559 seconds before the www alias `updatedAt`.
One pre-alias 503 occurred during Promote itself. Even an immediate invocation
cannot therefore be presented as proof that the release gate will never reject
a naturally scheduled request. This local tool requires no application redeploy
to install or test, and leaves the runtime gate and Cron configuration intact.

**The default CLI adapter is read-only. An explicit native HTTPS transport is
implemented and tested locally; it has not been used or verified in production.**
Inspection of installed Vercel CLI 50.44.0 found that
both `api` and `promote` use an HTTP client with internal retries, with no supported
disable-retry flag. One subprocess therefore does not mean one POST. The adapter
contains no POST implementation and rejects `promote()` even with `execute: true`.
It supplies the supported explicit team scope for every Vercel read, rather than
relying on a query parameter that CLI current-team configuration can replace.

`scripts/run-ci-first-release.mjs` implements the serial coordinator and its
adapter boundary. `scripts/ci-first-release-cli-adapter.mjs` provides CLI/HTTP
reads. `scripts/ci-first-release-https-transport.mjs` adds the explicit native
write path. None makes cloud calls or reads release credentials at import time. This change
does not install a CI release job, create a deployment, change cloud settings or
activate a production release. Tests use fake CLI/read responses and local
loopback HTTPS servers with dummy tokens. Passing tests do not prove live
credentials, permissions, existing secret injection or current platform state.

Use the existing authenticated `gh` and `vercel` CLIs on one trusted release host.
The script never opens authentication files or accepts tokens in CLI arguments, override headers,
arbitrary endpoints, force flags or a caller-supplied candidate URL. CLI execution
uses argument arrays, fixed read-only API routes and bounded output/time. Anonymous
identity probes carry no credentials, reject redirects, and share a bounded
deadline with response-body consumption. A protected or unverifiable candidate
blocks the handoff; the coordinator does not add a protection bypass.

Choose **one durable project state directory shared by every invocation**, outside
ephemeral build output. Obtain the existing team ID, repository numeric ID, full
main SHA and successful CI run/attempt through authorized reads. The following
commands inspect preparation and a separately authorized candidate. They do not
authorize creation or complete an automatic release:

```sh
node scripts/run-ci-first-release.mjs prepare \
  --state-dir "$release_state" --sha "$release_sha" \
  --team-id "$release_team_id" --repo-id "$release_repository_id" \
  --run-id "$release_ci_run_id" --run-attempt "$release_ci_attempt"

# Only for a candidate created by an independently approved release path.
node scripts/run-ci-first-release.mjs watch \
  --state-dir "$release_state" --candidate-id "$release_candidate_id"
```

`prepare` is read-only on the cloud. It checks the ordinary promotion protocol
and CLI read capabilities, fresh exact main CI and all attempt-specific jobs, source Git
deployment policy, the existing project/team/repository, complete production
candidate inventory and both current domain aliases. It persists the release
scope and common previous deployment ID. Default CLI preparation reports
`executionAvailable: false`, `doNotCreateForThisHandoff: true` and the fixed
`single_attempt_promotion_transport_unavailable` blocker. `watch --execute` is
rejected before mutation. Both domains must agree. The candidate
must be created after preparation and within two minutes of it; stale preparation
or a pre-existing deployment is rejected. If preparation ages out before creation,
resolve/archive that local preparation under the same serial release discipline
and prepare again. Do not replace state after any remote outcome becomes unknown.

For the optional native transport, `--token-env` is the **name** of an environment
variable supplied by an existing approved external secret-injection mechanism.
It is not a token value. This repository does not establish that such a mechanism
exists, create a token, configure a secret, extract CLI credentials or request a
new credential. The name is validated and bound with the transport in the local
preparation record; `watch` must use the same name and transport. Preparation
never reads the value. For example, inspect the native path without executing:

```sh
node scripts/run-ci-first-release.mjs prepare \
  --state-dir "$release_state" --sha "$release_sha" \
  --team-id "$release_team_id" --repo-id "$release_repository_id" \
  --run-id "$release_ci_run_id" --run-attempt "$release_ci_attempt" \
  --transport native-https --token-env "$release_token_env"

node scripts/run-ci-first-release.mjs watch \
  --state-dir "$release_state" --candidate-id "$release_candidate_id" \
  --transport native-https --token-env "$release_token_env"
```

The native preparation reports `executionAvailable: true` only for implemented
transport capability. It also explicitly reports `credentialsVerified: false`,
`permissionsVerified: false` and `authorizesCreation: false`. Neither a token
value nor its existence is inspected. During an already authorized release,
append `--execute` to the matching native `watch` command and start it immediately
after the separately authorized creation step returns the candidate ID. Without
`--execute`, native watch remains read-only and never calls the token accessor.
With it, the environment value is accessed only inside `promote()`, after the
durable intent exists and all READY/main/CI/identity/alias guards passed. The
programmatic adapter also accepts an explicit approved token accessor with the
same timing contract. The token is never persisted or included in results/errors.

The native writer calls Node 22 `https.request()` and `end()` once, with a fresh
one-use agent (`agent: false`), fixed `api.vercel.com:443`, TLS verification enabled,
the fixed project, and validated team and candidate IDs. It has no redirect
handling, HTTP retries, CLI fallback, force flag or request body. A latch blocks
concurrent or subsequent calls to that writer instance. The total deadline
covers the token accessor, connection/TLS and bounded response-body consumption;
expiration actively destroys the request. A late credential result cannot start
a request after timeout or cancellation. Only a completed 201/202 response is
accepted; other statuses, resets, truncated/oversized bodies, missing credentials
and timeouts throw a sanitized error and cause read-only reconciliation. No
`Retry-After` value authorizes a resend. Node's own HTTP timeout event does not
abort a request, which is why this transport actively destroys it; see the
[Node 22 HTTP contract](https://nodejs.org/download/release/v22.23.3/docs/api/http.html#httprequestoptions-callback)
and [HTTPS request API](https://nodejs.org/download/release/v22.23.3/docs/api/https.html#httpsrequestoptions-callback).

This precheck establishes the protocol and read access before a candidate can
receive cron. It cannot prove future write permission or guarantee that the
Promote API will accept a later request. The ordinary API is
`POST /v10/projects/{projectId}/promote/{deploymentId}` with the existing team scope,
without a force/skip-checks/body override. An accepted response is not proof that
aliases have finished moving. See [Vercel's normal promotion API](https://vercel.com/docs/rest-api/projects/point-production-traffic-to-a-given-deployment).

`watch` follows only the supplied candidate ID, polling at one-second intervals
with a fifteen-minute READY budget and bounded individual reads. Once READY, it
does not sleep, wait for CI, pause for a prompt or rediscover the API. It verifies
the authoritative Git source, Production/team/project identity and candidate
nonce response, re-reads main and the same CI attempt with all jobs, rejects any
other unresolved candidate, and rechecks both aliases. The native writer provides
the single-attempt path; the shipped CLI adapter always declares false and
cannot be used to send that POST. The read-only watcher
reports `ready_read_only`, without writing a promotion intent or making a cloud
change while both aliases still name the previous deployment. It can persist a
read-only observation if automatic domain assignment has already begun. This
mode is for inspection, not the time-sensitive release path.

Production creation may already start automatic alias assignment. If either
formal alias has reached this candidate, the watcher sends no Promote and only
observes propagation. That observation is persisted as an immutable read-only
intent before waiting; even if aliases later return to the old deployment, a
subsequent `--execute` cannot promote again. If recording the observation fails,
the project lock is preserved. Any unrelated deployment in either alias is a conflict.
Verification requires both platform aliases to name this candidate, the www
runtime identity to match the candidate including app origin, the root to return
the expected 307/308 redirect to www, and a second alias read after those probes.
No code infers worker success or Sentry acceptance from these identity checks.

The state directory must belong to the invoking user and have no group/other
permissions (normally mode 0700). Its path is canonicalized once, and its directory
ancestry and inode are checked on each state operation. A replaced directory or
lock inode is rejected; the old process cannot remove a replacement process's
lock. The project lock uses exclusive local file creation. Preparation, candidate
binding and promotion intent are immutable files, flushed together with their
directory before the dependent step. A promotion intent is persisted **before**
calling the adapter. A timeout, lost response, interrupted process, corrupt or
partially written journal, or post-response disk failure cannot authorize a retry.
Every subsequent invocation with an intent is read-only, even with `--execute`.
The runner attempts readback after a lost response and preserves unresolved state
when it cannot verify completion. Explicit recovery is also read-only:

```sh
node scripts/run-ci-first-release.mjs reconcile \
  --state-dir "$release_state" --candidate-id "$release_candidate_id"
```

Recovery never clears a lock or intent, retries Promote, creates a replacement,
cancels a candidate or rolls back. A crashed process may leave its project lock;
read-only recovery can still inspect the bound candidate. A missing PID, elapsed
time or unchanged alias does not prove a remote write never happened. Preserve
these files as evidence. Start another release only after the previous outcome
and any surviving executor have been independently resolved and the completed
state archived under the same project serialization discipline.

The lock covers cooperating processes that use this directory, not other hosts,
the dashboard or another directory. Node's path operations are not an atomic
filesystem defense against a malicious process running as the same user; keep
the state directory and its owner-controlled ancestors trusted. Final main/CI/alias reads and Promote are not
an atomic compare-and-swap; changes can race between them, and production create
may change aliases before the watcher starts. The external create-to-watch gap,
platform READY-to-alias latency and in-flight old workers remain. The native
coordinator can remove avoidable operator/protocol-discovery waits from its local
control flow, but this has not been exercised against production and
does not establish a maximum handoff delay, zero lost ticks, zero overlap, drain
or business-effect fencing. Do not relax the runtime identity gate to hide these
limits. It still requires separately authorized production acceptance.

The adapter also fails closed on compatibility gaps: both platform alias records
must expose their deployment ID, and historical READY records need an explicit
`PROMOTED` substate to be excluded from unresolved candidates. A platform-only
root redirect with a null deployment ID or legacy metadata without that substate
needs separate read-only investigation; the script does not fabricate identity
or treat `aliasAssigned` as proof of production traffic. These current-project
shapes have not been checked by the isolated fake tests.

Remaining production prerequisites are independent verification of the existing
approved credential-injection mechanism, write authorization and a permitted,
verifiable candidate identity path. A separate authorized read on 2026-10-10
observed the current production deployment's independent URL returning HTTP 401
for anonymous `/api/deployment-identity` requests, while the official www identity
and root redirect were readable. Future candidates must not be assumed readable;
the coordinator fails closed and provides no protection bypass or protection
setting change. A separate inventory read also left historical READY deployments
unresolved under the strict candidate gate. Those blockers must be resolved by
authorized investigation before this coordinator can be used for a release.
Production credential injection, write permission and native API response behavior
were not exercised during this isolated implementation.
Local server counts prove that the client did not resend in the tested cases;
they do not prove that remote business effects happen exactly once or that cron
and alias changes are atomic.

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
   or any Sentry cron check-in. [Vercel does not retry failed cron invocations](https://vercel.com/docs/cron-jobs/manage-cron-jobs#cron-job-error-handling).
   `Retry-After: 60` is not a provider retry or business compensation guarantee.
   A later scheduled delivery checks again, but delivery is best effort; its
   HTTP 200 alone does not establish that any previously outstanding item was
   processed. Existing durable claims, cursors and idempotency remain necessary.

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
node --test scripts/ci-first-release.test.mjs scripts/run-ci-first-release.test.mjs scripts/ci-first-release-cli-adapter.test.mjs
node --test scripts/ci-first-release-https-transport.test.mjs
```

`api/_cron-release.test.mjs` executes all scheduled handlers with rejected
candidate identities, checks same-commit redeploys, fresh promotion/rollback
decisions, authentication and credential confinement, ordinary deletion POST,
and failure paths including streamed-body timeout. The deployment-file bundle
test copies only shipped API runtime sources before bundling every route.

## Platform references

- [Vercel Cron request routing](https://vercel.com/docs/cron-jobs#how-cron-jobs-work): scheduled GET requests target the production deployment URL; this is not an atomic custom-domain handoff contract.
- [Vercel skip-domain](https://vercel.com/docs/cli/deploy#skip-domain): controls automatic promotion/aliasing, not a documented pause of the candidate's Cron scheduler.
- [Vercel production deployment states](https://vercel.com/docs/deployments/promoting-a-deployment#production-deployment-state): staged/current and domain assignment are distinct from the production environment.
- [Vercel system variables](https://vercel.com/docs/environment-variables/system-environment-variables#vercel_deployment_id): deployment ID is unique and available at runtime; a production URL variable is also present in Preview and is not an approval signal.
- [Vercel prebuilt caveat](https://vercel.com/docs/cli/deploy#when-not-to-use---prebuilt): build-time system-variable availability differs for prebuilt workflows.
- [Vercel cron operations](https://vercel.com/docs/cron-jobs/manage-cron-jobs): failures are not retried, running jobs survive a deployment change, and delivery requires idempotent processing.
