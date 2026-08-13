# Hosted Realtime canary

This is a manual, write-capable laboratory harness for a dedicated synthetic
Vercel Preview + Supabase staging project. It is not part of normal smoke,
pre-push, CI, deployment, or production.

## Current state

The source-controlled allowlist in `approved-targets.ts` is intentionally
empty. Therefore `npm run smoke:hosted-realtime` fails before its first remote
request, even if every environment variable is populated. This is the expected
state until Eric explicitly approves an isolated staging target.

The harness is therefore **locally validated but not activated and not hosted
GO**. Do not replace the empty allowlist with an environment-only bypass.

## Activation prerequisites

All conditions are required before adding one public target record:

1. A dedicated, disposable Supabase staging project is confirmed not to be the
   production project. The source-controlled target record pins its exact
   project ref, dataset lineage, immutable Preview origin, full reviewed commit
   SHA, environment-sentinel UUID, fixture revision, and the SHA-256 digest of
   every same-origin JS/CSS/static asset (including lazy chunks). A hostname
   suffix, mutable alias claim, root HTML hash alone, or operator-selected URL
   is not sufficient. The browser re-hashes each asset on first use.
2. The exact deployed H5 Preview exposes `deployment-manifest.json` with
   `environment=preview`, `deployable=true`, the exact Preview origin, staging
   project ref, approved full commit SHA, and matching seven-character release.
3. Before any A/B/C password is sent to either Supabase Auth or the Preview, an
   HTTP-only anonymous preflight can call only
   `hosted_realtime_canary_environment()` and receive the matching server-owned
   sentinel. It must prove:

   - `protocol_revision=2` plus the exact project ref, lineage, sentinel UUID,
     fixture revision, and fixture manifest digest;
   - the exact reviewed provider-disable proof digest and its short-lived
     expiry from the source-controlled target;
   - `lifecycle_state=ready` before credentials and `cleaned` only after exact
     database cleanup plus ordinary Auth session revocation;
   - `synthetic_only=true` and `disposable=true`;
   - `provider_side_effects_disabled=true`;
   - `write_cleanup_supported=true`;
   - `residue_count=0`;
   - an environment expiry between one hour and seven days from the run, and a
     provider-proof expiry between one and 24 hours from the run.

   This RPC may expose only those non-secret fields. Its staging-only backing
   state must never be added to or enabled in production.
4. The harness receives exactly three distinct ordinary Auth participants,
   configured by an administrator with server-owned `app_metadata`:

   - `caaci_hosted_canary: true`
   - `caaci_dataset_lineage: <approved lineage>`
   - `caaci_canary_role: member-a`, `member-b`, or `member-c`

   User-editable `user_metadata` is never accepted.

   A separately governed protected-smoke synthetic subject may coexist in the
   staging project. It is not a canary participant: the launcher receives no
   credential or UUID for it, and it must not appear in AB/AC, canary roles,
   write ledgers, markers, or cleanup arguments. The harness therefore makes
   no claim that the whole staging Auth census contains exactly three users.
5. Fixture relationships are exact:

   - A participates in conversations AB and AC.
   - B participates only in AB.
   - C participates only in AC.

6. Only a publishable/legacy anon key and the three ordinary account
   credentials are present. Service-role, admin, deployment, provider, debug,
   and artifact credentials must be absent.
7. The revision-2 harness uses six narrow staging-only RPCs for the one-shot
   write lease:

   - `hosted_realtime_canary_begin_run(...)` lets actor A reserve the one active
     server-side run only after the anonymous sentinel reports
     `lifecycle_state=ready`.
   - `hosted_realtime_canary_insert_message(...)` accepts only a pre-registered
     run ID and UUID, one approved AB/AC fixture conversation, the current
     ordinary canary actor, and content exactly equal to
     `caaci-hosted-canary-<same UUID>`.
   - `hosted_realtime_canary_insert_scale_batch(p_run_id, p_message_ids)`
     accepts actor A's exact sorted set of 51 runner-generated UUIDs. Server
     ordinals 1-21 are A→AB and 22-51 are B→AB, all with one server-owned
     timestamp and fixed `caaci-hosted-canary-<UUID>` content.
   - `hosted_realtime_canary_insert_notification(p_run_id, p_id)` accepts the
     one runner-generated notification UUID for actor A and derives its fixed
     body marker server-side.
   - `hosted_realtime_canary_set_block(p_run_id, p_blocked_id, p_state)` lets
     only A target B or B target A; the caller identity determines the blocker.
   - `hosted_realtime_canary_cleanup_v2(...)` accepts a bounded, sorted,
     duplicate-free attempt set that must cover every server-ledgered message
     and notification. This lets an interrupted partial run clean its exact
     residue; only the complete 59-message/one-notification transcript can
     satisfy the success receipt. It must report exact delete/restore counts
     and `residue_count=0`.

   The staging database also owns a bounded TTL backstop. A cleanup mismatch is
   a failed run, never a warning. No service-role key or broad delete is used.
   The legacy authenticated `hosted_realtime_canary_cleanup(...)` remains a
   seventh RPC solely for protocol-v1 recovery compatibility. Revision 2 never
   calls it, and it fails closed as soon as a scale ledger exists.
8. The operator explicitly confirms that the run writes these small,
   uniquely identified rows to the disposable dataset.
9. A reviewed abnormal-termination recovery path covers both canary rows and
   Auth sessions. It must define the bounded TTL/backstop, stale session
   revocation or credential rotation, residue PRECHECK/VERIFY, and safe
   recovery of a stale private run root/lock. A direct `SIGKILL`, host crash or
   power loss cannot run in-process teardown and must never be reported as
   clean merely because the next local process starts.

Credentials must come from the approved local secret environment and never be
placed in this file, command arguments, shell history, source control, a
storage-state file, or a Playwright artifact.

The repository now contains a **local draft** activation unit at
`supabase/_ops/hosted_realtime_canary/` for the revision-2 sentinel,
run/message/notification/block ledgers, RPCs, TTL, provider proof, PRECHECK,
VERIFY, recovery, and rollback. It remains
outside `supabase/migrations`; it has disposable-local PostgreSQL evidence
only and has not been approved or applied to any hosted project. Before any
activation, the existing read-only
`VERIFY_20260719164126_reconcile_managed_realtime_authorization_contract.sql`
must also prove the exact managed `realtime.messages` policy and grant
catalog. Local green tests do not prove hosted Supabase role capabilities,
provider controls, fixture state, deployment identity, or cron execution.
The first target must therefore remain absent until the read-only hosted gates,
the activation transaction, its real cron heartbeat, and an independent review
all succeed under Eric's explicit approval.

## Implemented scenarios

- `AUTH-01`: AB members join private Broadcast/Presence, see the expected peer,
  and deliver one typing event.
- `AUTH-02`: legal AB and AC channels must subscribe in the same wave in which
  C→AB, B→AC, and anonymous→AB receive an explicit `CHANNEL_ERROR`; a bounded
  observation window must show no later unauthorized rejoin while the legal
  controls remain healthy. Three dedicated authenticated probes additionally
  forward exact runner-derived random-conversation, `online-users`, and
  `user:<A UUID>` private joins to hosted Realtime and require server-side
  denial; the ordinary network guard still rejects every other topic locally.
- `RLS-01`: AB and AC messages-only Postgres Changes channels may all join, but
  each unique row reaches the two members exactly once and the cross-member and
  anonymous clients zero times over a bounded negative-observation window.
- `FAIL-01`: Playwright closes the real Supabase WebSocket while leaving HTTP
  available, proves the exact conversation seed and incremental direct polls,
  observes two sticky poll cycles with no topic rejoin, then remounts, requires
  a successful exact-topic join reply, blocks REST reads, and proves a second
  row arrived through that WebSocket topic.
- `DEDUPE-01`: a message first arrives over the subscribed AB topic; a held
  snapshot fetched afterward contains the same ID and is then released. The
  DOM must retain exactly one row.
- `SWITCH-01`: a held AC snapshot is proven to contain a unique A-only witness;
  another tab signs out A and signs in B, both pages are server-verified as B,
  and releasing the response must not expose the witness or a later C→AC row.
  It then signs B out, restores A through the ordinary login path, re-verifies
  both pages, and proves a fresh AB mount without a B transport.
- `BLOCK-01`: A/B first prove an allowed private join. It then runs both A→B
  and B→A phases: the blocker mutates the exact pair, both sides rebuild and
  receive stable `CHANNEL_ERROR`, the blocker unblocks, and both rebuilt
  channels subscribe again. Cleanup retains a server-owned baseline backstop.
- `NOTIFY-01`: A/B/C/anonymous subscribe to the same A-notification source
  filter. A's runner-generated notification reaches A exactly once with its
  fixed body marker and reaches every unauthorized observer zero times.
- `SCALE-01`: actor A inserts the one fixed 51-row batch. The exact app-style
  conversation keyset poll must return `50+1`; the A inbox poll must return only
  B's 30 incoming rows as `25+5`. C and anonymous AB Postgres Changes observers
  must remain at zero.
- `LIFE-01`: browser B mounts and unmounts AB three times. Every mount requires
  one fresh successful topic join. Every unmount must settle all held reads,
  reach zero active sockets, and keep read/socket/join counters unchanged for
  3.5 seconds—longer than the 3-second conversation poll interval.

All browser traffic is deny-by-default. Exact URL, query, method, header and
body contracts run before any browser request is continued. Realtime string
frames require the exact Phoenix wire shape and reviewed event payload; binary
frames are parsed as the Supabase broadcast format and only the reviewed
private typing payload is permitted. Extra fields, opaque binary payloads,
credential-bearing refs, unknown topics and unissued or wrong-subject JWTs are
rejected before forwarding. The device-fingerprint RPC and exact AB/AC
read-receipt PATCH are answered locally and never reach staging, so the canary
cannot mutate pre-existing unread state.

The password-grant response is captured before it reaches the page. The real
refresh token remains only inside the teardown boundary; the browser receives
a fixed disabled value and no provider tokens. Every popup/new page is attached
to the same observers. Teardown first denies new password grants, waits for any
already-started grant to settle, closes the browser context, then unconditionally
revokes every exact-issued session and requires both the access-token and
refresh-token registries to be empty. The browser session is also checked in
local storage and against the exact Supabase `/auth/v1/user` endpoint.

Node Supabase clients use a separate guarded fetch and guarded WebSocket
transport with the same exact frame rules; arbitrary REST, RPC, topic, upload,
mutation, provider, analytics, first-party `/api/*`, and production traffic are
rejected.

Playwright runs only through `safe-launcher.mjs`, accepts no arguments, and
returns success only for the exact ordered ten-pass transcript plus
`pass=10 fail=0`. Raw child stdout/stderr is bounded and discarded except for
fixed scenario/status lines. The launcher resolves and pins the project-local
Playwright package and its resolved Chromium executable. It rejects ambient
Playwright and execution-affecting Node overrides before resolving that path.
The child receives a positive-list environment, an isolated HOME/TMP tree and
no ambient Node/TLS/proxy/cloud configuration;
Chromium is additionally launched with `--no-proxy-server` so a system proxy
cannot receive canary bearer traffic. One lock prevents concurrent runs; signal
or timeout shutdown first sends Playwright `SIGINT` and allows a bounded
150-second graceful teardown, then escalates to process-group `SIGTERM` and
`SIGKILL`. A second operator signal skips directly to the force-kill path.

## Deliberately still outside this harness

- hosted fault injection for each individual `setAuth` rejection, initial
  subscription rejection, `TIMED_OUT`, and background-to-foreground recovery
  path (the current `FAIL-01` forces a real socket close only);
- notification WS/poll/snapshot overlap, toast/count exactly-once behavior, and
  the three-torn-snapshot delayed-retry path in a hosted browser;
- blocked-pair Postgres Changes/source-RLS zero-payload evidence in addition to
  the current private Broadcast/Presence block journey;
- the 50+1 conversation and 25+5 inbox scale path through the deployed H5
  composables/UI (the current scenario uses the guarded app-style SDK queries);
- offer, meetup, mark-all, and broader WAL burst matrices;
- database query-plan/performance evidence beyond the behavioral 51-row
  conversation and 30-row incoming-inbox boundary;
- production, migration, Dashboard policy, deployment, or fixture seeding;
- iOS Safari, Android Chrome, and WeChat physical-device background/weak-network
  acceptance.

Those remain separate checklist items. Passing these ten hosted scenarios
would still not close the physical-device gate, Batch 02, or authorize release.
At present the ten scenarios have only local compile/boundary evidence because
the source-controlled target allowlist remains empty.

## Local checks

These commands are safe with no hosted credentials:

```text
node --test smoke/hosted-realtime-canary-boundary.test.mjs
npx tsc -p e2e/hosted/tsconfig.json
npm run smoke:hosted-realtime -- --list
```

The first two must pass. The third exercises argument rejection and must emit only
`[HOSTED-CANARY] HARNESS failed` and exit non-zero while the approved-target
list is empty. A real canary may be run only after the prerequisites above are
independently reviewed.
