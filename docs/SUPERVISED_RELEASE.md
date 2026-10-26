# Ordinary release using the existing connector and browser

This is a supervised operating protocol. It uses the existing authorized Vercel
connector and the existing Chrome session, with no credential export, new token,
protection bypass, new server or cloud setting. Implementing or testing these
local helpers does not authorize merging or releasing production.

The stronger native coordinator in `run-ci-first-release.mjs` retains its
single-HTTP-attempt requirement and conservative candidate inventory policy.
Those are properties of that automatic tool, not prerequisites imposed on every
ordinary release. Never label the connector `singleAttempt: true`, filter the
strict adapter's inventory behind its back, or use a force/skip-checks option.

## Required review for this ordinary release

The release host remains responsible for these checks. A local JSON review
records their evidence; it is not authentication or a programmatic replacement
for performing them.

1. Obtain authorization for the exact PR/head and ordinary production actions.
   Serialize this project's release activity. Re-read the current main and all
   seven successful jobs of its exact latest CI run/attempt after merging; keep
   automatic Git deployment disabled. PR CI is not the main release gate.
2. Inspect a complete current deployment inventory and formal aliases. Treat
   known historical READY/STAGED records as reviewed history, not active work
   solely because of STAGED. Preserve them. Stop on an unexplained new/changed
   candidate, visible active build/transition, unexpected alias, unresolved own
   release intent or known concurrent release. Do not omit records to make the
   strict automatic runner pass, and do not use a permanent historical allowlist.
3. Create the exact verified main/Production candidate once using the existing
   authorized service. If creation's result is unknown, inspect that request's
   deployment instead of creating another. Do not wait for CI after creation.
4. Read the returned candidate's fixed project/team/repository/full SHA and READY
   state. Open its metadata-derived unique URL in the existing browser with a
   fresh UUIDv4 nonce. Review the full identity, projectRef/appOrigin and nonce.
   The capture adapter validates URL, time and nonce consistency; it cannot
   authenticate a screenshot or prove HTTP status. Capture is ordinary navigation
   plus screen confirmation, not an implemented automatic Chrome DOM bridge.
5. Immediately re-read main/CI and both formal aliases. If either alias already
   points to this candidate, persist observe-only intent and read back; do not
   send Promote. If both still point to the reviewed previous deployment,
   reserve the invocation durably and invoke the existing ordinary connector
   exactly once at host level. No force, custom body or CLI fallback is allowed.
6. Regardless of the tool response, perform fresh readback of candidate metadata,
   both aliases, www runtime identity, candidate identity and root redirect.
   Use new nonces; check full deployment/SHA/project/appOrigin. A returned tool
   envelope or latest mapping `completed` alone is not release acceptance.
   A partial/conflicting result, timeout or missing evidence means read-only
   reconciliation of this same candidate. Never resend or rebuild automatically.
7. Record READY-to-alias timing and observe natural Cron/provider receipts as
   separate post-release evidence. Do not trigger Cron or send test mail without
   a separately authorized reason. Human verification can take time, so this
   protocol cannot promise instant handoff or zero missed ticks.

Historical inventory does not enumerate every provider operation. The current
evidence does not prove a historical asynchronous assignment can never arrive
late. Ordinary release therefore retains the usual provider/concurrency risk,
managed through serialization, fresh reads and stopping on conflicts. Waiting
for proof of the stronger negative claim is not an added normal-release gate.

## Local components and the current tool-host bridge

- `ci-first-release-browser-identity.mjs`: injected screen-confirmation reader
  for fixed metadata-derived origins; exact URL/UUIDv4 binding, fresh observation,
  bounded wait, replay checks and sanitized errors. No cookies or bypasses.
- `ci-first-release-connector-transport.mjs`: injected existing connector callback,
  fixed project/team/deployment parameters and a synchronous single-call latch.
  Capability is `singleToolInvocation: true`, `singleAttempt: false`, with internal
  HTTP attempts unknown. A timeout does not cancel the provider's operation.
- `ci-first-release-connector-host.mjs`: composition of those readers/transport
  plus a file bridge. `reserveConnectorInvocation` persists intent before emitting
  a request. `recordConnectorReadback` records the host's later evidence; neither
  calls the cloud. `createReleaseStore` provides the existing fsync/lock handling.
- `ci-first-release-supervised-handoff.mjs`: a bounded ordinary-release controller
  that prepares readers before creation, watches one supplied candidate, starts
  independent final reads together, and enters the injected connector immediately
  after a durable reservation. It never creates a deployment. The existing CLI
  reader now preserves an available `readySubstate` in its returned inventory;
  its historical filtering and the strict coordinator's policy are unchanged.

**Using the bounded ordinary controller.** Its entry points are `prepare()`,
`watch({ preparation, deploymentId, execute })`, and `reconcile({ deploymentId })`.
Construction and import do not start a read, browser operation or cloud call.
`prepare()` performs actual read-only preparation; it does not create a candidate
or authorize creation. The default `watch` is read-only. Only `execute: true`
permits reserving and entering the previously authorized promotion callback.

Preparation binds the exact project/team/repository, full main SHA, CI run and
attempt, and previous production deployment. All seven main jobs and disabled
automatic Git deployment are checked against the unmodified snapshot. Known
historical candidate rows are retained as an immutable baseline. The host must
classify those rows from current evidence, rather than blindly approve a list.
New IDs, removed historical rows, READY/state/substate changes, or active/unknown
history stop the attempt; the only allowed extra row is this new candidate.
The controller never empties the real inventory or calls the strict gate with
fabricated data. Fields omitted by the underlying provider/reader are not claimed
to have been compared; the host review remains responsible for the complete
historical classification, including relevant metadata and concurrent activity.

The returned preparation is deeply frozen and bound to its creating controller
instance; a JSON clone, caller edits or another instance cannot activate it.
Its first `watch` also binds exactly one candidate ID, including a failed or
read-only watch. The candidate must match the fixed repository/main SHA and must
have been created after preparation. If the process is lost after creation but
before an intent exists, do not create a replacement or forge a preparation:
inspect the same candidate read-only and use the existing supervised host review
protocol for an explicit recovery decision. An existing matching intent can be
reconciled in a new process without preparation, resource setup or another POST.

READY polling is configurable (`pollMs`, default 1000 ms), not a one-second
platform SLA: each CLI deployment read also verifies project metadata. The
`maxReadyMs` and `maxObserveMs` budgets bound their whole asynchronous phases,
including reads and waits. `operationTimeoutMs` bounds each operation; late
results cannot resume the failed orchestration or cause a new promotion.
`maxEvidenceAgeMs` defaults to 60000 ms and measures from the start of each
observation, not the completion of a slower parallel sibling. A slow browser or
history review makes stale snapshot/identity evidence stop the attempt instead
of silently extending its lifetime or repeatedly fetching all inventory.

After the verified READY observation has registered the candidate origin,
snapshot, independent candidate metadata and fresh-nonce browser identity start
in parallel. The metadata URL must remain equal to the registered URL. The host
then finishes historical classification, freshness is checked, and formal aliases
are read immediately before reservation. If any alias has already moved, only
readback runs. Otherwise the journal is fsynced and the controller directly enters
the injected `promote` method, with no report, prompt or additional read inserted.
A missing candidate from a complete inventory is accepted only when aliases show
that its automatic promotion already began. Every invoked outcome is followed
only by readback; timeout/error is never followed by a retry or a fallback.
Freshness is checked again after fsync, synchronously before entering the writer;
expired evidence consumes the intent but never sends late. New controller intents
also preserve the candidate's `runtimeAppOrigin` for restart comparisons. A legacy
host intent without that field is still read-only on recovery and explicitly
reports `runtimeOriginBaselineVerified: false`; it cannot establish that the
current origins remained unchanged from the original pre-promotion observation.

Results include per-adapter `readCounts`, all callback/wait `callCounts`, recorded
operation durations, and phase timestamps. These count adapter invocations, not
the internal HTTP requests of CLI or MCP. Readback verifies both aliases, candidate
and formal identity with independent nonces, root redirect, and aliases again;
an existing verified record must also match the exact journal scope. Browser
authentication/observation remains the trusted host's responsibility, and no
result claims atomic Cron handoff or zero missed scheduled executions.

The callback contract for a host that can call the library directly is:

```js
import { createCliAdapter } from '../scripts/ci-first-release-cli-adapter.mjs'
import { createReleaseStore } from '../scripts/run-ci-first-release.mjs'
import { createConnectorHostAdapter } from '../scripts/ci-first-release-connector-host.mjs'
import { createSupervisedHandoff } from '../scripts/ci-first-release-supervised-handoff.mjs'

// scope = { projectId, teamId, repositoryId, requestedSha, runId, runAttempt,
//           previousDeploymentId }; all values come from the reviewed release.
const reads = createCliAdapter({ teamId: scope.teamId, repositoryId: scope.repositoryId })
const adapter = createConnectorHostAdapter({ reads, teamId: scope.teamId,
  execute: releaseIsAuthorized,
  requestPromote: host.requestPromoteOnce, // Existing connector, exact three args.
  captureBrowserIdentity: host.confirmBrowserIdentity,
})
const handoff = createSupervisedHandoff({
  store: createReleaseStore(trustedJournalDirectory), adapter, scope,
  prepareHostResources: host.prepareReadOnlyResources,
  reviewHistory: host.reviewCurrentHistory,
})
const prepared = await handoff.prepare()
// Stop unless prepared.status === 'prepared'. The separately authorized creator
// supplies its one candidate ID; no create call is implemented by this module.
const result = await handoff.watch({ preparation: prepared.preparation,
  deploymentId: candidateId, execute: releaseIsAuthorized })
// Persist/review result. After any uncertain invocation: handoff.reconcile only.
```

`prepareReadOnlyResources({ scope })` confirms that the already authorized host
can use its existing readers/browser and returns `{ ready: true, evidenceRef }`.
It must not provision credentials, change permissions or create bypass links.
`reviewCurrentHistory({ phase, scope, inventory, baseline?, candidateId? })`
returns `{ reviewed: true, observedAt, evidenceRef }` only after the host actually
reviews that request's current evidence. `observedAt` is epoch milliseconds within
that callback's request interval; `phase` is `prepare` or `ready`. The browser
callback must honor the supplied URL/nonce and return the existing browser
reader's screen-confirmation receipt with fresh evidence. No boolean or local
JSON is an independent authentication proof.

Ordinary Node has no `tools` object. The example above is a library wiring example,
not a claim that Node can directly invoke the current conversation's MCP tool.
Use the [stdio host bridge](SUPERVISED_HOST_BRIDGE.md) for that environment; the
external trusted tools host performs the one MCP call and the real browser/history
review. The old one-release `capture-candidate-identity.py` and `read-main-fresh.py`
scripts are fixed to their historical deployment/commit and are not reusable
callbacks for a new nonce or release. Never supply an old screenshot receipt as
the response to a new challenge.

For an executable local demonstration with no external calls:

```sh
node scripts/ci-first-release-supervised-handoff.mjs --demo
```

The demo uses the real filesystem journal and the existing host, browser reader,
connector transport and new controller. Metadata, browser observations and the
one connector callback are explicitly fixtures; it does not launch Chrome or CLI,
access credentials or call a provider. Output labels `offline: true`, records the
durable-intent-before-dummy-call sequence and verifies that a reconstructed
controller only reads back. A successful demo proves local composition, not a
live MCP integration, production readiness or a measured reduction of 117 seconds.

Use one trusted, persistent project journal under the serialized release host.
Do not mix a strict-runner preparation with a supervised journal, clear an intent,
switch directories to evade it or start a new writer after an unknown outcome.
The lock is local, not a distributed lock across people or service workers.

The file bridge takes a non-secret JSON document with:

```js
{
  scope: { projectId, teamId, repositoryId, requestedSha, runId, runAttempt,
    deploymentId, previousDeploymentId },
  review: { scope, observedAt, evidenceRef,
    aliases: [ // exactly the current root and www records
      { alias: 'illinimarket.com', projectId, deploymentId: previousDeploymentId },
      { alias: 'www.illinimarket.com', projectId, deploymentId: previousDeploymentId }
    ] }
}
```

`scope` contains exact values obtained from the authorized release; `observedAt`
is an epoch-millisecond timestamp of the completed live review. `evidenceRef`
locates the actual CI/inventory/identity/alias evidence. The five-minute age cap
protects this helper against stale receipts; it is not a provider guarantee.

```sh
# Local inspection only; emits no cloud request and writes no invoke intent.
node scripts/ci-first-release-connector-host.mjs reserve "$release_state" "$review_file"

# Only in the separately authorized release, after the review above:
# fsync intent, then return fixed request arguments once; still no cloud call.
node scripts/ci-first-release-connector-host.mjs reserve "$release_state" "$review_file" --execute

# After actual readback, add review.status = 'verified' or 'unresolved' and
# current aliases/evidence/observation time to that non-secret review document.
node scripts/ci-first-release-connector-host.mjs readback "$release_state" "$readback_file"
```

In the current tools host, run the reservation command using the ordinary local
execution tool. Only a successfully parsed `status: reserved` provides a request;
check its three fields against the approved scope, then call the existing
`vercel_request_promote` tool once with that exact project/team/deployment.
Do not pass a request body. If command/tool delivery, timeout or response is
ambiguous, do not repeat it: the journal stays consumed and subsequent reservation
returns `reconcile_only` without request parameters. The host then performs the
normal read-only checks and records their result. No local HTTP bridge or exported
connector OAuth is necessary. A host that can inject callbacks may instead use
`createConnectorHostAdapter`; the same journal and no-resend discipline apply.

`verified_by_host_review` means the host supplied and reviewed fresh matching
evidence. It does not claim the helper independently authenticated that evidence,
proved all workflow checks or validated production through a fixture test.

## Controlled and residual risks

The measured 2026-10-10 release took 110.407 seconds from candidate READY to
the Promote invocation and another 6.559 seconds to the www alias `updatedAt`
(116.966 seconds in total). One of the two pre-alias HTTP 503 records occurred
while Promote was already in progress. These are observations of that release,
not a platform latency bound or proof of globally simultaneous routing. The
controller targets avoidable host delay in the first interval; its real reduction
must be measured during a separately authorized release. Passing local tests
does not establish zero 503s, including when READY overlaps a scheduled tick or
the provider takes longer to finish the domain change.

Vercel describes Cron GET requests as targeting the production deployment URL.
`--skip-domain` controls automatic promotion/aliasing, and promoting a staged
production deployment does not rebuild it. These documented behaviors do not
establish an atomic change of the Cron target and both custom domains. Preserve
the runtime release gate while reducing the host delay; this local tooling does
not need an application deployment, new credentials or a project-setting change
just to be installed or tested. See [Cron request routing](https://vercel.com/docs/cron-jobs#how-cron-jobs-work),
[skip-domain](https://vercel.com/docs/cli/deploy#skip-domain), and
[staged promotion](https://vercel.com/docs/deployments/promoting-a-deployment#staging-and-promoting-a-production-deployment).

Vercel explicitly does not retry a failed Cron invocation. The gate's
`Retry-After: 60` response is not a provider retry or compensation guarantee.
The next scheduled invocation is a separate delivery and is itself best effort.
Existing durable queues, leases, cursors and idempotency may let later runs
process outstanding work, but a subsequent HTTP 200 alone does not prove a
specific item was recovered or delivered. Observe natural requests and business
evidence separately; do not manually invoke a production task merely to validate
this host tool. See [Cron failure handling](https://vercel.com/docs/cron-jobs/manage-cron-jobs#cron-job-error-handling)
and [delivery and idempotency](https://vercel.com/docs/cron-jobs/manage-cron-jobs#cron-job-delivery-and-idempotency).

Durable intent plus no retries prevents a cooperating host from intentionally
reissuing after a crash or unknown result. Candidate identity and aliases detect
wrong deployments and observable conflicts. They cannot cancel an already-running
provider operation, prevent another operator from acting or prove remote HTTP
exactly-once behavior. Internal transport retry guarantees would require provider
implementation/contract evidence only if that stronger property is required.

Likewise, proof that no historical asynchronous operation remains would require
operation-level provider evidence. Strict Cron zero-loss/no-overlap would require
scheduler/business-effect coordination beyond this adapter. None is claimed by
the ordinary release protocol; a support inquiry can clarify them but need not
block normal release by default. No support inquiry is sent by these tools.
