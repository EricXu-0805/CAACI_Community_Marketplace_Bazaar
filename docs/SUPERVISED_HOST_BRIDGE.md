# Supervised host bridge

This is a local executable bridge for the supervised handoff, not a production
deployment and not a new authorization. Node reads GitHub/Vercel metadata through
the existing CLI adapter. The existing tools host supplies actual browser screen
observations and, only for a separately authorized exact release, calls the
existing Vercel Promote connector once. Node cannot call `tools.*`; the tools
isolate cannot import Node or use a local filesystem directly.

The bridge does not create a deployment, read credential files, install tools,
change permissions, invoke candidate business jobs, relax the runtime identity
gate, or fall back to a CLI mutation. Importing it performs no I/O. Its metadata
reads are real when the CLI is run; tests below use injected fixtures only.

## Launch and lifetime

Create an explicit scope JSON in an ordinary evidence directory. It must contain
exactly these seven fields with the **next authorized release's actual values**:
`projectId`, `teamId`, `repositoryId`, `requestedSha` (full SHA), `runId`,
`runAttempt`, `previousDeploymentId`. Do not copy the prior production SHA,
deployment ID, CI run, browser nonce, or screenshot into a new release.

```sh
node scripts/ci-first-release-supervised-host.mjs \
  --scope /absolute/path/scope.json \
  --journal /absolute/path/project-release-journal
```

The default is read-only and ends with `ready_read_only`; it never emits a
Promote request. `--execute` opts into a **separately authorized** exact Promote
after all checks. It does not authorize deployment creation. All cooperating
hosts must use the same trusted journal directory for that release. Never create
a fresh journal to get around an old intent or an uncertain outcome.

Run the process **before candidate creation**, approve actual resource/history
receipts, and keep it alive. Preparation objects are bound to this process. After
the `prepared` event, perform any separately authorized candidate creation outside
this bridge and answer `supply_candidate` with its exact ID. An existing candidate
created before preparation is rejected. Restarting cannot reconstruct preparation
from JSON. With an existing durable intent, use only:

```sh
node scripts/ci-first-release-supervised-host.mjs \
  --scope /absolute/path/scope.json \
  --journal /absolute/path/project-release-journal \
  --reconcile dpl_EXACT_RECORDED_CANDIDATE
```

Reconciliation performs fresh reads/browser observations, does not ask for
resource preparation or another candidate, and never emits Promote.

## Real local execution transport

On this Mac, a harmless actual `exec_command` experiment confirmed `tty:false`
closes stdin and exits without a reusable session. Use **`tty:true`**. The bridge
sets terminal raw mode before its first request, disabling input echo. A second
actual `exec_command` → `write_stdin` experiment confirmed the PTY can deliver a
JSON line without echoing that input. The subprocess tests also cover `/tmp`'s
symlink to `/private/tmp`; it cannot silently skip its CLI entry point.

Launch using the actual tools environment; substitute fixed local paths prepared
earlier. Do not interpolate receipts, JSON, secrets or candidate IDs into shell
commands. Keep `--execute` absent unless that exact production step is authorized.

```js
// functions.exec, not a Node script. This starts real metadata reads only after
// the host answers the first prepare_resources request.
const started = await tools.exec_command({
  cmd: '/tmp/illini-node22/node-v22.23.3-darwin-arm64/bin/node scripts/ci-first-release-supervised-host.mjs --scope /absolute/path/scope.json --journal /absolute/path/project-release-journal',
  workdir: '/tmp/illini-local-adapters-20261010',
  tty: true, yield_time_ms: 1000, max_output_tokens: 10000,
});
if (!started.session_id) throw new Error('No persistent host session');
store('supervisedSessionId', started.session_id);
store('supervisedOutputBuffer', '');
store('supervisedSeenRequestIds', []);
store('supervisedInitialChunk', started);
// Use the complete decoder below on load('supervisedInitialChunk') once.
// Display read-only requests
// for real review; do not infer approval merely from receiving one.
text(started.output);
```

Outbound request envelope:

```json
{"schema":1,"type":"request","requestId":"fresh UUIDv4","kind":"review_history","requestedAt":123,"payload":{}}
```

Inbound response envelope (JSONL, one newline):

```json
{"schema":1,"type":"response","requestId":"same UUIDv4","kind":"same kind","result":{}}
```

Respond with `tools.write_stdin({session_id, chars: JSON.stringify(response) +
'\n', yield_time_ms:1000})` in `functions.exec`. `chars` is a structured tool
argument; it is not shell code. Retain output and handle the next request from
that **same process**. Never place received text into a shell command.

The protocol accepts only these five request kinds:

| Kind | What the trusted host must actually do | Exact result fields |
| --- | --- | --- |
| `prepare_resources` | Before creating a candidate, confirm existing metadata-reader access, the already available connector, an existing authorized browser session/window, and exact release authorization if executing. Resolve capability discovery and any user action here. | `ready:true`, current `observedAt`, `evidenceRef` |
| `review_history` | Review the complete scoped inventory and the real history evidence. At `ready`, compare to the reviewed baseline and exclude the new candidate. Never claim historical READY/STAGED records were deleted or automatically authenticated. | `reviewed:true`, current `observedAt`, `evidenceRef` |
| `supply_candidate` | Return the one externally created candidate's exact ID after preparation. This message neither creates nor authorizes creation. | `deploymentId` |
| `capture_browser_identity` | Navigate the existing session to the **exact supplied** `requestedUrl`. Actually read the screen, save evidence, verify the address and visible identity. Do not generate another nonce or reuse a previous screenshot script with fixed release values. | `captureMode`, `requestedUrl`, `observedUrl`, `observedAt`, `evidenceRef`, `identity` |
| `promote` | Immediately dispatch the fixed existing connector once, with the exact three payload fields, using the prepared authorization and the already fsynced journal. | `outcome:"tool_returned"` or `outcome:"unknown"` |

`evidenceRef` is a bounded local reference, not a credential or a pasted page.
Browser `captureMode` is `existing-session-screen-confirmation`. `identity` has
exactly `schema`, `environment`, `deploymentId`, `commit`, `projectRef`,
`appOrigin`, `nonce`. The identity reader checks exact URL/nonce, metadata-bound
origin, freshness and one-use evidence. It does **not** implement automatic DOM
extraction or independently authenticate a host's visual confirmation.

The complete history may be larger than one tools output chunk. Drain and parse
the complete message with a sufficient output budget; if the tool truncates it,
stop instead of answering an incomplete inventory. The CLI projection preserves
`readySubstate` when the provider returns it; it does not expose every platform
field (for example `createdAt`/`aliasAssigned`). Comparison covers the fields
actually exposed. Classification still needs actual separately reviewed
metadata/evidence, not invented missing values or `reviewed:true` standing in for
a review. The request includes a digest of its bounded inventory and baseline so
the reviewer can bind evidence to what this run saw.

## Same-call Promote dispatch

Prepare the dispatcher **before creating a candidate**. After the final genuine
`review_history` response, continue draining the process in that same
`functions.exec` invocation. The core performs its final alias read, fsyncs intent
and emits `promote` immediately. Dispatch it in that invocation; do not print the
action and wait for another model/user turn. Requests are fresh, short-lived
actions, never stored work to replay later.

Use this complete decoder in each functions.exec that drains the session. Its
buffer/request-ID set live in `store`, not ordinary Node memory. Clear both only
when deliberately starting a new host session, never after a protocol error:

```js
function decodeCompleteMessages(chunk) {
  if (!chunk || typeof chunk.output !== 'string') throw new Error('Missing host output');
  let buffer = (load('supervisedOutputBuffer') || '') + chunk.output;
  if (buffer.length > 4 * 1024 * 1024) throw new Error('Host output limit');
  const seen = load('supervisedSeenRequestIds') || [];
  const messages = [];
  let end;
  while ((end = buffer.indexOf('\n')) !== -1) {
    let line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
    if (line.endsWith('\r')) line = line.slice(0, -1);
    const m = JSON.parse(line); // Empty/noisy/truncated lines are errors.
    if (!m || Array.isArray(m) || m.schema !== 1
      || !['request','event'].includes(m.type)) throw new Error('Invalid host envelope');
    if (m.type === 'request') {
      if (Object.keys(m).length !== 6
        || !['schema','type','requestId','kind','requestedAt','payload'].every(k => Object.hasOwn(m,k))
        || !['prepare_resources','review_history','supply_candidate','capture_browser_identity','promote'].includes(m.kind)
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(m.requestId)
        || !Number.isSafeInteger(m.requestedAt) || m.requestedAt <= 0
        || !m.payload || typeof m.payload !== 'object' || Array.isArray(m.payload)
        || seen.includes(m.requestId)) throw new Error('Invalid or duplicate host request');
      seen.push(m.requestId);
    } else if (Object.keys(m).length !== 4
      || !['schema','type','event','result'].every(k => Object.hasOwn(m,k))
      || !['prepared','finished'].includes(m.event)
      || !m.result || typeof m.result !== 'object' || Array.isArray(m.result)) {
      throw new Error('Invalid host event');
    }
    messages.push(m);
  }
  if (!chunk.session_id && buffer.length) throw new Error('Incomplete final host line');
  store('supervisedOutputBuffer', buffer);
  store('supervisedSeenRequestIds', seen);
  return messages;
}
```

The following is the actual tools-host boundary logic. `request` is the freshly
parsed JSONL request from this live process. Freeze the project/team/full-SHA/CI
scope and `journalKey` during preparation; after the separately authorized create
returns, bind its actually reviewed candidate ID to `authorized`'s exact
project/team/deployment tuple **before** answering `supply_candidate` and the
final history review. `sessionId` is the same PTY session. None is filled from an
unreviewed Promote request. This helper belongs inside the same functions.exec
poll/drain code that sends the final history response; ordinary Node cannot run it.

```js
async function dispatchPromote(request, authorized, journalKey, sessionId) {
  const exact = (x, keys) => x && typeof x === 'object' && !Array.isArray(x)
    && Object.keys(x).length === keys.length && keys.every(k => Object.hasOwn(x, k));
  if (!exact(request, ['schema','type','requestId','kind','requestedAt','payload'])
    || request.schema !== 1 || request.type !== 'request' || request.kind !== 'promote'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(request.requestId)
    || !exact(request.payload, ['projectId','teamId','deploymentId'])
    || !['projectId','teamId','deploymentId'].every(k => request.payload[k] === authorized[k])
    || !Number.isSafeInteger(request.requestedAt)
    || request.requestedAt > Date.now() || Date.now() - request.requestedAt >= 8000) {
    throw new Error('Invalid or expired Promote action; read-only reconciliation required');
  }
  const consumed = load('supervisedConsumedJournals') || [];
  if (consumed.includes(journalKey)) throw new Error('Already consumed; reconcile only');
  // Consume before await. The Node fsynced journal is the durable authority;
  // this shared host latch also prevents concurrent/repeated dispatcher calls.
  store('supervisedConsumedJournals', [...consumed, journalKey]);
  let outcome = 'unknown';
  try {
    // This exact callable name was discovered in this environment. Do not
    // accept a tool name, path, force option, extra argument or CLI fallback.
    const reply = await tools.mcp__codex_apps__vercel_request_promote({
      projectId: authorized.projectId,
      teamId: authorized.teamId,
      deploymentId: authorized.deploymentId,
    });
    // Do not log/pass the provider response body. Explicit failure, ambiguous
    // envelopes or exceptions remain unknown; aliases/identity prove success.
    if (reply && typeof reply === 'object' && !Array.isArray(reply)
      && reply.isError === false && !Object.hasOwn(reply, 'error')
      && Array.isArray(reply.content) && !Object.hasOwn(reply, 'structuredContent')) {
      outcome = 'tool_returned';
    }
  } catch { /* one attempt consumed; no retry */ }
  return await tools.write_stdin({ session_id: sessionId,
    chars: JSON.stringify({schema:1,type:'response',requestId:request.requestId,kind:'promote',result:{outcome}}) + '\n',
    yield_time_ms:1000, max_output_tokens:10000 });
}
```

For example the final-history drain structure is sequential, with no extra
planning turn between ready review and dispatch:

```js
// Each variable below was prepared/actually reviewed earlier in this live run.
let chunk = await tools.write_stdin({session_id:sessionId,
  chars:JSON.stringify(actualReadyHistoryResponse) + '\n', yield_time_ms:1000, max_output_tokens:10000});
const deadline = Date.now() + 60000;
for (;;) {
  const messages = decodeCompleteMessages(chunk);
  const requests = messages.filter(m => m.type === 'request');
  if (requests.length > 1 || requests.some(m => m.kind !== 'promote')) {
    throw new Error('Unexpected request during final dispatch; stop and reconcile');
  }
  const action = requests[0];
  if (action) { chunk = await dispatchPromote(action, authorized, journalKey, sessionId); break; }
  if (!chunk.session_id || messages.some(m => m.type === 'event' && m.event === 'finished')) break;
  if (Date.now() >= deadline) throw new Error('Host drain timeout; reconcile only');
  chunk = await tools.write_stdin({session_id:sessionId,chars:'',yield_time_ms:1000,max_output_tokens:10000});
}
// Now retain chunk and handle fresh readback/browser requests. Do not dispatch
// another Promote even if a later tool or terminal response is missing.
```

Resource/history/browser responses have a three-minute local timeout; browser
reader/core budgets may expire sooner. Promote's host response has an eight-second
budget, inside the existing connector transport's ten-second wait. A timeout is
**not** cancellation of the remote operation. If an on-time `unknown` response
arrives, normal readback can proceed. If the RPC itself times out, encounters EOF,
an extra/duplicate response, malformed UTF-8/JSON, an oversized line or stream
error, the peer closes to further work; restart with the same journal and
`--reconcile` for read-only recovery. A late result cannot authorize replay.

The peer checks a monotonic deadline when it receives a response and again after
validating it. A blocked event loop cannot turn an overdue response into an
accepted result merely because the timeout callback has not run yet. Recovery
summaries preserve `runtimeOriginBaselineVerified: false` for an older journal
without the original app-origin baseline; do not omit that limitation when
reporting a currently verified alias and identity readback.

## What this improves and what it does not prove

It moves resource/history preparation ahead of candidate creation, uses bounded
READY polling, runs fresh CI/deployment/browser checks in parallel, and connects
final alias verification → durable reservation → one connector dispatch without
an additional planning turn. Human screen/history observations remain explicit
trust boundaries; prepare those resources early and answer fresh requests promptly.

The CLI reader also starts the two independent domain reads together, overlaps
project and deployment metadata reads, and fetches exact-attempt CI jobs alongside
the initial snapshot. It validates every response and retains the final main/run
recheck; independent reads running together do not make them an atomic snapshot.

It cannot make provider Cron activation and alias promotion atomic. Candidate
requests may still arrive before the alias changes and correctly receive a 503
from the unchanged identity gate. An in-flight promotion or connector outage may
outlast the local budget. One tool invocation does not prove one underlying HTTP
attempt. Only fresh aliases, formal/candidate identity and root redirect establish
the observed release state. No fixture test asserts zero production 503s.

## Offline verification

```sh
node --test scripts/ci-first-release-supervised-host.test.mjs
node scripts/ci-first-release-supervised-handoff.mjs --demo
```

Tests use real journal/browser/connector/core modules with local streams and
injected fixture metadata. They cover default no-promotion, one dispatch after
intent, restart reconciliation, unknown outcome, forged nonce, duplicated or
malformed responses, EOF, limits/timeouts, secret-field suppression and actual
child-process `/tmp` invocation. They do not call cloud APIs or create a release.
