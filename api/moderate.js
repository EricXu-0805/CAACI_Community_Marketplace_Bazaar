export const config = { runtime: 'edge' }

/*
 * Server-side AI moderation proxy.
 *
 * Called by the client before insert; keeps OPENAI_API_KEY off the
 * browser. Returns `{ flagged, categories }`. If OPENAI_API_KEY is
 * not set in the Vercel env, this endpoint short-circuits to
 * `{ flagged: false, skipped: true }` — safe fallback so a missing
 * key never breaks publish flows.
 */

const ALLOWED_ORIGINS = [
  'https://caaci-community-marketplace-bazaar.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
]

function cors(origin) {
  if (!ALLOWED_ORIGINS.includes(origin)) {
    return {
      Vary: 'Origin',
    }
  }
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  }
}

export default async function handler(request) {
  const origin = request.headers.get('origin') || ''
  const headers = { 'Content-Type': 'application/json', ...cors(origin) }

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers })
  }
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers })
  }

  let body
  try {
    body = await request.json()
  } catch {
    return new Response(JSON.stringify({ error: 'bad_json' }), { status: 400, headers })
  }

  const text = typeof body?.text === 'string' ? body.text.slice(0, 8000) : ''
  if (!text || text.length < 1) {
    return new Response(JSON.stringify({ flagged: false, skipped: true, reason: 'empty' }), { status: 200, headers })
  }

  const key = process.env.OPENAI_API_KEY
  if (!key) {
    return new Response(JSON.stringify({ flagged: false, skipped: true, reason: 'no_key' }), { status: 200, headers })
  }

  try {
    const r = await fetch('https://api.openai.com/v1/moderations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: 'omni-moderation-latest',
        input: text,
      }),
    })

    if (!r.ok) {
      let upstreamBody = null
      try { upstreamBody = await r.text() } catch {}
      return new Response(
        JSON.stringify({
          flagged: false,
          skipped: true,
          reason: `upstream_${r.status}`,
          debug: upstreamBody ? upstreamBody.slice(0, 400) : null,
        }),
        { status: 200, headers },
      )
    }

    const data = await r.json()
    const result = data?.results?.[0] || {}
    const categories = result.categories || {}
    const flaggedCats = Object.entries(categories)
      .filter(([, v]) => v === true)
      .map(([k]) => k)

    return new Response(
      JSON.stringify({
        flagged: !!result.flagged,
        categories: flaggedCats,
      }),
      { status: 200, headers },
    )
  } catch (e) {
    return new Response(
      JSON.stringify({ flagged: false, skipped: true, reason: 'exception' }),
      { status: 200, headers },
    )
  }
}
