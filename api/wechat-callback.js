export const config = { runtime: 'edge' }

/*
 * /api/wechat-callback — WeChat mp 消息推送 receiver.
 *
 * Sole consumer today: media_check_async verdicts (event wxa_media_check).
 * /api/wechat-seccheck submits every mp-uploaded image and records
 * trace_id → storage object in wechat_media_checks (m087); WeChat pushes
 * the verdict here minutes later. On a risky verdict we delete the storage
 * object with the service key (the image simply 404s wherever it was
 * referenced) and drop the mapping row. 'review'/'pass' just clean up the
 * row — borderline images stay up for the normal report/admin pipeline.
 *
 * Console setup (公众平台 → 开发管理 → 开发设置 → 消息推送):
 *   URL     https://illinimarket.com/api/wechat-callback
 *   Token   = WECHAT_PUSH_TOKEN env var (any random string, must match)
 *   数据格式 JSON · 消息加解密方式 明文模式
 * Enabling the config triggers a GET handshake (signature + echostr) which
 * this handler answers; WeChat retries pushes ~3× unless we answer fast,
 * so the POST path always returns "success" once the signature checks out.
 *
 * Env: WECHAT_PUSH_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */

function env(name, fallback) {
  return process.env[name] || fallback
}

const PUSH_TOKEN       = env('WECHAT_PUSH_TOKEN', '')
const SUPABASE_URL     = env('SUPABASE_URL', env('VITE_SUPABASE_URL', ''))
const SUPABASE_SERVICE = env('SUPABASE_SERVICE_ROLE_KEY', '')

async function sha1Hex(s) {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

/* WeChat's signature covers token+timestamp+nonce, dictionary-sorted. */
async function validSignature(params) {
  const signature = params.get('signature') || ''
  const timestamp = params.get('timestamp') || ''
  const nonce = params.get('nonce') || ''
  if (!PUSH_TOKEN || !signature || !timestamp || !nonce) return false
  const expected = await sha1Hex([PUSH_TOKEN, timestamp, nonce].sort().join(''))
  return expected === signature
}

const svcHeaders = {
  apikey: SUPABASE_SERVICE,
  Authorization: `Bearer ${SUPABASE_SERVICE}`,
  'Content-Type': 'application/json',
}

export default async function handler(request) {
  const url = new URL(request.url)

  if (!(await validSignature(url.searchParams))) {
    return new Response('forbidden', { status: 403 })
  }

  /* Config-save handshake: echo back the challenge. */
  if (request.method === 'GET') {
    return new Response(url.searchParams.get('echostr') || '', { status: 200 })
  }
  if (request.method !== 'POST') {
    return new Response('method not allowed', { status: 405 })
  }

  try {
    const event = await request.json()
    if (event?.Event === 'wxa_media_check' && event?.trace_id) {
      const traceId = String(event.trace_id)
      const suggest = event?.result?.suggest || ''
      const q = `${SUPABASE_URL}/rest/v1/wechat_media_checks?trace_id=eq.${encodeURIComponent(traceId)}`
      if (suggest === 'risky') {
        const r = await fetch(`${q}&select=bucket,storage_path`, { headers: svcHeaders })
        const rows = r.ok ? await r.json() : []
        if (rows?.[0]) {
          /* seccheck derives bucket/path from a validated own-storage URL, so
             these are already ours; encode each segment (keeping / separators)
             as defense-in-depth against a malformed stored path. */
          const bkt = encodeURIComponent(String(rows[0].bucket))
          const path = String(rows[0].storage_path).split('/').map(encodeURIComponent).join('/')
          await fetch(
            `${SUPABASE_URL}/storage/v1/object/${bkt}/${path}`,
            { method: 'DELETE', headers: svcHeaders },
          )
        }
      }
      await fetch(q, { method: 'DELETE', headers: svcHeaders })
    }
  } catch {
    /* Malformed or irrelevant push — swallow; WeChat only needs "success". */
  }

  return new Response('success', { status: 200 })
}
