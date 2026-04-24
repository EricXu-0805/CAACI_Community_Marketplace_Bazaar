export const config = { runtime: 'edge' }

/*
 * Server-side long-poll substitute for Supabase Realtime on WeChat mp.
 *
 * mp cannot speak the Phoenix protocol, so useRealtimeFallback.ts
 * defaults to a client 3s poll of PostgREST. This endpoint lets mp
 * promote that to a ~1s-latency long-poll:
 *
 *   1. Client opens GET /api/realtime-poll?scope=conversation&id=X&since=TS
 *   2. Edge function tight-polls Supabase every 800ms internally
 *   3. Returns 200 {rows:[...]} as soon as rows appear, OR 200
 *      {rows:[]} after ~20s (under Vercel's 25s edge cap)
 *   4. Client reconnects immediately with the new "since" cursor
 *
 * Net effect: apparent latency ~1s instead of 3s, fewer client->
 * network round trips. Gracefully degrades — if this endpoint 5xx's
 * or is absent, useRealtimeFallback stays on direct 3s PostgREST polls.
 *
 * No auth on this endpoint beyond scope/id gating: the Supabase RLS
 * policy on public.messages already restricts visibility to the two
 * participants, and we use anon key + caller-supplied JWT so the RLS
 * evaluates against the real user, not service_role.
 */

const MAX_HOLD_MS = 20000
const TICK_MS = 800
const ROW_LIMIT = 25

function env(name, fallback) {
  return process.env[name] || fallback
}

const SUPABASE_URL = env('SUPABASE_URL', env('VITE_SUPABASE_URL', ''))
const ANON_KEY     = env('SUPABASE_ANON_KEY', env('VITE_SUPABASE_ANON_KEY', ''))

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  })
}

async function fetchRows(scope, id, since, userJwt) {
  const encId = encodeURIComponent(id)
  let url
  if (scope === 'conversation') {
    const sinceFilter = since ? `&created_at=gt.${encodeURIComponent(since)}` : ''
    url = `${SUPABASE_URL}/rest/v1/messages`
      + `?conversation_id=eq.${encId}${sinceFilter}`
      + `&order=created_at.asc&limit=${ROW_LIMIT}&select=*`
  } else if (scope === 'inbox') {
    const sinceFilter = since ? `&created_at=gt.${encodeURIComponent(since)}` : ''
    url = `${SUPABASE_URL}/rest/v1/messages`
      + `?sender_id=neq.${encId}${sinceFilter}`
      + `&order=created_at.asc&limit=${ROW_LIMIT}`
      + `&select=id,conversation_id,sender_id,created_at`
  } else {
    throw new Error('bad_scope')
  }

  const r = await fetch(url, {
    headers: {
      apikey: ANON_KEY,
      Authorization: userJwt || `Bearer ${ANON_KEY}`,
      Accept: 'application/json',
    },
  })
  if (!r.ok) throw new Error(`postgrest_${r.status}`)
  return await r.json()
}

export default async function handler(request) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 })
  if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405)

  if (!SUPABASE_URL || !ANON_KEY) return json({ error: 'not_configured' }, 503)

  const url = new URL(request.url)
  const scope = url.searchParams.get('scope') || ''
  const id = url.searchParams.get('id') || ''
  let since = url.searchParams.get('since') || ''

  if (scope !== 'conversation' && scope !== 'inbox') {
    return json({ error: 'bad_scope' }, 400)
  }
  if (!id) return json({ error: 'missing_id' }, 400)

  /* Forward the caller's Supabase JWT so PostgREST evaluates RLS as
     the real user — service_role would bypass RLS and leak messages
     across conversations. If the client omits it, we fall back to
     anon access (empty result set for private messages). */
  const userJwt = request.headers.get('authorization') || ''

  const deadline = Date.now() + MAX_HOLD_MS

  while (Date.now() < deadline) {
    try {
      const rows = await fetchRows(scope, id, since, userJwt)
      if (Array.isArray(rows) && rows.length > 0) {
        return json({ rows, next_since: rows[rows.length - 1].created_at })
      }
    } catch (err) {
      return json({ error: err?.message || 'fetch_error' }, 500)
    }
    const remaining = deadline - Date.now()
    if (remaining <= TICK_MS) break
    await new Promise((res) => setTimeout(res, TICK_MS))
  }

  return json({ rows: [], next_since: since || null })
}
