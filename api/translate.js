export const config = { runtime: 'edge' }

/*
 * User-content translation proxy.
 *
 * Translates item titles, descriptions, plaza posts, and comments
 * on demand via OpenAI gpt-4o-mini (cheapest model with reliable
 * bilingual output). Keeps OPENAI_API_KEY off the browser.
 *
 * Safe fallbacks:
 *   · no OPENAI_API_KEY set  → returns { skipped: true }; client
 *     falls back to the static dictionary quickTranslate() and the
 *     user sees the pre-dictionary title instead of a broken UI.
 *   · upstream 429 / 5xx     → same skipped fallback.
 *   · input empty / too long → 400 with explicit reason.
 *
 * Abuse controls:
 *   · requires a valid Supabase JWT — CORS alone cannot stop scripted
 *     callers (curl ignores it), and an open endpoint is an unmetered
 *     OpenAI proxy. Logged-out visitors degrade to the client-side
 *     quickTranslate() dictionary, not a broken UI.
 *   · input capped at 4 KB (item descriptions are capped at 3 KB
 *     client-side so 4 KB gives headroom with a little padding).
 *   · output capped at 1200 tokens, which is ~3 KB of CJK.
 *   · single-shot, no streaming, no conversation memory.
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

const MAX_INPUT_BYTES = 4 * 1024

function env(name, fallback) {
  return process.env[name] || fallback
}

const SUPABASE_URL = env('SUPABASE_URL', env('VITE_SUPABASE_URL', ''))
const ANON_KEY     = env('SUPABASE_ANON_KEY', env('VITE_SUPABASE_ANON_KEY', ''))

/* Validate the caller's Supabase access token. Any authenticated user
   passes; anonymous/forged tokens get 401 and the client falls back to
   its static dictionary. ~1 round trip to Supabase per call — fine,
   translations are click-driven and cached client-side for 30 days. */
async function verifyUser(bearer) {
  if (!bearer || !SUPABASE_URL || !ANON_KEY) return false
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: ANON_KEY, Authorization: bearer },
    })
    return r.ok
  } catch {
    return false
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

  const text = typeof body?.text === 'string' ? body.text : ''
  const target = body?.target === 'zh' ? 'zh' : body?.target === 'en' ? 'en' : null

  if (!text.trim()) {
    return new Response(JSON.stringify({ translated: '', skipped: true, reason: 'empty' }), { status: 200, headers })
  }
  if (new Blob([text]).size > MAX_INPUT_BYTES) {
    return new Response(JSON.stringify({ error: 'input_too_large' }), { status: 400, headers })
  }
  if (!target) {
    return new Response(JSON.stringify({ error: 'bad_target' }), { status: 400, headers })
  }

  if (!(await verifyUser(request.headers.get('authorization') || ''))) {
    return new Response(JSON.stringify({ error: 'auth_required' }), { status: 401, headers })
  }

  const key = process.env.OPENAI_API_KEY
  if (!key) {
    return new Response(
      JSON.stringify({ translated: '', skipped: true, reason: 'no_key' }),
      { status: 200, headers },
    )
  }

  const sys = target === 'zh'
    ? 'You translate e-commerce/marketplace copy from English into natural, concise Simplified Chinese. Preserve prices, model numbers, brand names, URLs, @mentions, and emojis exactly. Keep the translation tight — do not add marketing flourishes. Return JSON: {"translated": "..."}.'
    : 'You translate e-commerce/marketplace copy from Chinese into natural, concise English. Preserve prices, model numbers, brand names, URLs, @mentions, and emojis exactly. Keep the translation tight — do not add marketing flourishes. Return JSON: {"translated": "..."}.'

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: text },
        ],
        temperature: 0.2,
        max_tokens: 1200,
        response_format: { type: 'json_object' },
      }),
    })

    if (!r.ok) {
      return new Response(
        JSON.stringify({ translated: '', skipped: true, reason: `upstream_${r.status}` }),
        { status: 200, headers },
      )
    }

    const data = await r.json()
    const content = data?.choices?.[0]?.message?.content || ''
    let translated = ''
    try {
      const parsed = JSON.parse(content)
      translated = typeof parsed?.translated === 'string' ? parsed.translated : ''
    } catch {
      translated = content.trim()
    }

    return new Response(
      JSON.stringify({ translated, target }),
      { status: 200, headers },
    )
  } catch {
    return new Response(
      JSON.stringify({ translated: '', skipped: true, reason: 'exception' }),
      { status: 200, headers },
    )
  }
}
