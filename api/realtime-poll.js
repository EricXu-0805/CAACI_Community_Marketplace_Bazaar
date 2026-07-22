import { deploymentBoundaryResponse, evaluateDeploymentBoundary } from './_deployment-boundary.js'

export const config = { runtime: 'edge' }

/*
 * Server-side long-poll substitute for Supabase Realtime on WeChat mp.
 *
 * mp cannot speak the Phoenix protocol, so useRealtimeFallback.ts
 * defaults to a client 3s poll of PostgREST. This endpoint lets mp
 * promote that to a ~1s-latency long-poll:
 *
 *   1. Client opens GET /api/realtime-poll?scope=conversation&id=X&since=CURSOR
 *   2. Edge function tight-polls Supabase every 800ms internally
 *   3. Returns 200 {rows:[...]} as soon as rows appear, OR 200
 *      {rows:[]} after ~20s (under Vercel's 25s edge cap)
 *   4. Client reconnects immediately with the new "since" cursor
 *
 * Net effect: apparent latency ~1s instead of 3s, fewer client->
 * network round trips. Gracefully degrades — if this endpoint 5xx's
 * or is absent, useRealtimeFallback stays on direct 3s PostgREST polls.
 *
 * Requires an Authorization header: RLS (anon key + caller JWT) already
 * keeps the data safe, but each request holds an edge invocation up to
 * 20s and fires ~25 internal PostgREST queries — without the gate that
 * is a free anonymous amplification vector. The only legitimate caller
 * is the logged-in mp client, which always attaches its JWT; everyone
 * else gets 401 and useRealtimeFallback degrades to direct 3s polls.
 */

const MAX_HOLD_MS = 20000
const TICK_MS = 800
const ROW_LIMIT = 25
// This accelerator must stay below the edge execution cap even when Auth,
// rate-limit and the final poll all approach their deadline.  A slow upstream
// is safer as an explicit fallback trigger than as an unbounded held request.
const UPSTREAM_TIMEOUT_MS = 1500
const MAX_CONTROL_RESPONSE_BYTES = 16 * 1024
const MAX_ROWS_RESPONSE_BYTES = 512 * 1024

function env(name, fallback) {
  return process.env[name] || fallback
}

const SUPABASE_URL = env('SUPABASE_URL', env('VITE_SUPABASE_URL', ''))
const ANON_KEY = env(
  'SUPABASE_PUBLISHABLE_KEY',
  env('SUPABASE_ANON_KEY', env('VITE_SUPABASE_PUBLISHABLE_KEY', env('VITE_SUPABASE_ANON_KEY', ''))),
)
const SERVICE_KEY = env('SUPABASE_SECRET_KEY', env('SUPABASE_SERVICE_ROLE_KEY', ''))
// PostgreSQL's uuid type accepts all bit patterns. Validate structure without
// rejecting legitimate non-RFC-versioned UUIDs created by imports or fixtures.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TIMESTAMPTZ_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/
const CURSOR_SEPARATOR = '|'

function supabaseHeaders(key, authorization = '', extra = {}) {
  const headers = { apikey: key, ...extra }
  if (authorization) headers.Authorization = authorization
  else if (!/^sb_(?:publishable|secret)_/.test(key)) headers.Authorization = `Bearer ${key}`
  return headers
}

function isTimestampCursor(value) {
  return typeof value === 'string' && TIMESTAMPTZ_RE.test(value) && Number.isFinite(Date.parse(value))
}

/* Cursor v2 is `<created_at>|<id>`. created_at alone remains accepted so a
   cached older mini-program can reconnect during a rolling deploy; its first
   non-empty response is upgraded to v2. The id tie-breaker is required because
   PostgreSQL rows created in one transaction can share created_at, and a
   timestamp-only `gt` cursor drops rows beyond ROW_LIMIT forever. */
function parseMessageCursor(value) {
  if (value === '') return { createdAt: '', id: null }
  if (typeof value !== 'string') return null
  const separatorAt = value.lastIndexOf(CURSOR_SEPARATOR)
  if (separatorAt < 0) {
    return isTimestampCursor(value)
      ? { createdAt: value, id: null }
      : null
  }
  const createdAt = value.slice(0, separatorAt)
  const id = value.slice(separatorAt + CURSOR_SEPARATOR.length)
  if (!isTimestampCursor(createdAt) || !UUID_RE.test(id)) return null
  return { createdAt, id }
}

function serializeRowCursor(row) {
  const createdAt = row?.created_at
  const id = row?.id
  if (
    typeof createdAt !== 'string' ||
    !isTimestampCursor(createdAt) ||
    typeof id !== 'string' ||
    !UUID_RE.test(id)
  ) {
    throw new Error('postgrest_malformed')
  }
  return `${createdAt}${CURSOR_SEPARATOR}${id}`
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  })
}

async function fetchJsonWithTimeout(input, init, maxBytes) {
  const controller = new AbortController()
  let reader = null
  let timer

  const operation = (async () => {
    const response = await fetch(input, {
      ...(init || {}),
      signal: controller.signal,
      redirect: 'manual',
    })
    // Callers need only the status for non-2xx responses. Do not wait for an
    // attacker- or proxy-controlled error body before failing closed.
    if (!response.ok) return { response, data: null }

    const declared = response.headers.get('content-length')
    if (declared != null) {
      if (!/^\d+$/.test(declared) || Number(declared) > maxBytes) {
        throw new Error('upstream_malformed')
      }
    }
    if (!response.body) throw new Error('upstream_malformed')

    reader = response.body.getReader()
    const decoder = new TextDecoder()
    let total = 0
    let raw = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        void reader.cancel().catch(() => {})
        throw new Error('upstream_malformed')
      }
      raw += decoder.decode(value, { stream: true })
    }
    raw += decoder.decode()
    let data
    try { data = JSON.parse(raw) } catch { throw new Error('upstream_malformed') }
    return { response, data }
  })()

  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      if (reader) void reader.cancel().catch(() => {})
      reject(new Error('upstream_timeout'))
    }, UPSTREAM_TIMEOUT_MS)
  })

  try {
    return await Promise.race([operation, timeout])
  } finally {
    clearTimeout(timer)
  }
}

function publicFetchError(error) {
  return error?.message === 'postgrest_malformed'
    ? 'postgrest_malformed'
    : 'fetch_error'
}

/* ADM-SEC-07: validate the caller's Supabase access token. The presence-only
   check used to let a forged/expired bearer enter the long-poll hold; a junk
   token now gets a clean 401 before the loop instead of relying on the first
   PostgREST fetch to reject it. ~1 round trip, negligible vs the 20s hold. */
async function verifyUser(bearer) {
  if (!bearer || !SUPABASE_URL || !ANON_KEY) return null
  try {
    const { response, data: user } = await fetchJsonWithTimeout(`${SUPABASE_URL}/auth/v1/user`, {
      headers: supabaseHeaders(ANON_KEY, bearer),
    }, MAX_CONTROL_RESPONSE_BYTES)
    if (!response.ok) return null
    return user?.id || null
  } catch {
    return null
  }
}

/* A valid account could otherwise open unbounded 20-second holds, each of
   which fans out to ~25 PostgREST reads. Keep this optional accelerator
   fail-closed: the mp client already falls back to its direct 3s RLS poll. */
async function rateHit(userId) {
  if (!SUPABASE_URL || !SERVICE_KEY) return null
  try {
    const { response, data: decision } = await fetchJsonWithTimeout(`${SUPABASE_URL}/rest/v1/rpc/edge_rate_hit`, {
      method: 'POST',
      headers: supabaseHeaders(SERVICE_KEY, '', {
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify({
        bucket_in: `realtime-poll:${userId}`,
        max_in: 30,
        window_secs_in: 60,
      }),
    }, MAX_CONTROL_RESPONSE_BYTES)
    if (!response.ok) return null
    if (decision === true) return true
    if (decision === false) return false
    return null
  } catch {
    return null
  }
}

async function fetchRows(scope, id, since, userJwt) {
  const encId = encodeURIComponent(id)
  const cursor = parseMessageCursor(since)
  if (!cursor) throw new Error('bad_cursor')
  let sinceFilter = ''
  if (cursor.createdAt && cursor.id) {
    const keyset = `(created_at.gt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.gt.${cursor.id}))`
    sinceFilter = `&or=${encodeURIComponent(keyset)}`
  } else if (cursor.createdAt) {
    // Rolling compatibility for a timestamp-only v1 cursor. Its first result
    // publishes a v2 keyset cursor; preserve the old strict-gt semantics for
    // cached clients so the transition does not replay an inbox toast.
    sinceFilter = `&created_at=gt.${encodeURIComponent(cursor.createdAt)}`
  }
  let url
  if (scope === 'conversation') {
    url = `${SUPABASE_URL}/rest/v1/messages`
      + `?conversation_id=eq.${encId}${sinceFilter}`
      + `&order=created_at.asc,id.asc&limit=${ROW_LIMIT}&select=*`
  } else if (scope === 'inbox') {
    url = `${SUPABASE_URL}/rest/v1/messages`
      + `?sender_id=neq.${encId}${sinceFilter}`
      + `&order=created_at.asc,id.asc&limit=${ROW_LIMIT}`
      + `&select=id,conversation_id,sender_id,created_at`
  } else {
    throw new Error('bad_scope')
  }

  const { response, data: rows } = await fetchJsonWithTimeout(url, {
    headers: supabaseHeaders(ANON_KEY, userJwt, {
      Accept: 'application/json',
    }),
  }, MAX_ROWS_RESPONSE_BYTES)
  if (!response.ok) throw new Error(`postgrest_${response.status}`)
  if (!Array.isArray(rows)) throw new Error('postgrest_malformed')
  return rows
}

/* Resolve the initial cursor from PostgreSQL's own timestamps, not the edge
   runtime clock.  A fast edge clock can otherwise advance the cursor beyond
   rows that PostgreSQL creates later and make those messages invisible
   forever.  The caller JWT is deliberately forwarded here as well: the seed
   must describe only rows visible through the same RLS boundary as the poll. */
async function fetchSeedCursor(scope, id, userJwt) {
  const encId = encodeURIComponent(id)
  let url
  if (scope === 'conversation') {
    url = `${SUPABASE_URL}/rest/v1/messages`
      + `?conversation_id=eq.${encId}`
      + '&order=created_at.desc,id.desc&limit=1&select=id,created_at'
  } else if (scope === 'inbox') {
    url = `${SUPABASE_URL}/rest/v1/messages`
      + `?sender_id=neq.${encId}`
      + '&order=created_at.desc,id.desc&limit=1&select=id,created_at'
  } else {
    throw new Error('bad_scope')
  }

  const { response, data: rows } = await fetchJsonWithTimeout(url, {
    headers: supabaseHeaders(ANON_KEY, userJwt, {
      Accept: 'application/json',
    }),
  }, MAX_ROWS_RESPONSE_BYTES)
  if (!response.ok) throw new Error(`postgrest_${response.status}`)
  if (!Array.isArray(rows)) throw new Error('postgrest_malformed')
  if (rows[0] == null) return ''
  return serializeRowCursor(rows[0])
}

export default async function handler(request) {
  const deploymentError = deploymentBoundaryResponse(evaluateDeploymentBoundary({ supabaseUrl: SUPABASE_URL }))
  if (deploymentError) return deploymentError
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 })
  if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405)

  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) return json({ error: 'not_configured' }, 503)

  const url = new URL(request.url)
  const scope = url.searchParams.get('scope') || ''
  const id = url.searchParams.get('id') || ''
  let since = url.searchParams.get('since') || ''
  // 'now' is a handshake sentinel. It is resolved below from the newest row's
  // PostgreSQL-created timestamp and returned immediately; using the edge
  // runtime's clock here would reintroduce a cross-machine clock-skew gap.
  const seedFromDatabase = since === 'now'

  if (scope !== 'conversation' && scope !== 'inbox') {
    return json({ error: 'bad_scope' }, 400)
  }
  if (!id) return json({ error: 'missing_id' }, 400)
  if (!UUID_RE.test(id)) return json({ error: 'bad_id' }, 400)
  if (since && !seedFromDatabase && !parseMessageCursor(since)) {
    return json({ error: 'bad_since' }, 400)
  }

  /* Forward the caller's Supabase JWT so PostgREST evaluates RLS as
     the real user — service_role would bypass RLS and leak messages
     across conversations. No JWT → 401 (see header comment). */
  const userJwt = request.headers.get('authorization') || ''
  if (!userJwt) return json({ error: 'auth_required' }, 401)
  const userId = await verifyUser(userJwt)
  if (!userId) return json({ error: 'auth_required' }, 401)
  if (scope === 'inbox' && id !== userId) return json({ error: 'forbidden' }, 403)

  const allowed = await rateHit(userId)
  if (allowed === null) return json({ error: 'rate_limit_unavailable' }, 503)
  if (!allowed) return json({ error: 'rate_limited' }, 429)

  if (seedFromDatabase) {
    try {
      since = await fetchSeedCursor(scope, id, userJwt)
      // Do not enter the hold on the seed request. The client establishes this
      // cursor, reconciles its snapshot/subscription gap, then reconnects.
      return json({ rows: [], next_since: since })
    } catch (err) {
      return json({ error: publicFetchError(err) }, 500)
    }
  }

  const deadline = Date.now() + MAX_HOLD_MS

  while (Date.now() < deadline) {
    try {
      const rows = await fetchRows(scope, id, since, userJwt)
      if (Array.isArray(rows) && rows.length > 0) {
        let nextSince
        try {
          for (const row of rows) nextSince = serializeRowCursor(row)
        } catch {
          return json({ error: 'postgrest_malformed' }, 500)
        }
        return json({ rows, next_since: nextSince })
      }
    } catch (err) {
      return json({ error: publicFetchError(err) }, 500)
    }
    const remaining = deadline - Date.now()
    if (remaining <= TICK_MS) break
    await new Promise((res) => setTimeout(res, TICK_MS))
  }

  return json({ rows: [], next_since: since })
}
