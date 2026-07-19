import { deploymentBoundaryResponse, evaluateDeploymentBoundary } from './_deployment-boundary.js'

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
 * this handler answers. Verdict processing is deliberately fail-closed:
 * WeChat only receives "success" after every required Supabase operation has
 * completed, so a transient mapping/Storage failure remains retryable.
 *
 * Env: WECHAT_PUSH_TOKEN, SUPABASE_URL, SUPABASE_SECRET_KEY. Legacy
 * SUPABASE_SERVICE_ROLE_KEY remains a rolling fallback.
 */

function env(name, fallback) {
  return process.env[name] || fallback
}

const PUSH_TOKEN       = env('WECHAT_PUSH_TOKEN', '')
const SUPABASE_URL     = env('SUPABASE_URL', env('VITE_SUPABASE_URL', ''))
const SUPABASE_SERVICE = env('SUPABASE_SECRET_KEY', env('SUPABASE_SERVICE_ROLE_KEY', ''))

const MAX_CALLBACK_BYTES = 32 * 1024
const MAX_SUPABASE_BYTES = 16 * 1024
const UPSTREAM_TIMEOUT_MS = 5_000
const STREAM_TIMEOUT_MS = 5_000
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function supabaseHeaders(key, authorization = '', extra = {}) {
  const headers = { apikey: key, ...extra }
  if (authorization) headers.Authorization = authorization
  else if (!/^sb_(?:publishable|secret)_/.test(key)) headers.Authorization = `Bearer ${key}`
  return headers
}

function responseHeaders(extra = {}) {
  return {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    ...extra,
  }
}

function plain(body, status = 200, extraHeaders = {}) {
  return new Response(body, { status, headers: responseHeaders(extraHeaders) })
}

async function readBoundedText(stream, declaredLength, maxBytes) {
  if (declaredLength != null) {
    if (!/^\d+$/.test(declaredLength)) throw new Error('bad_length')
    if (Number(declaredLength) > maxBytes) throw new Error('body_too_large')
  }
  if (!stream) throw new Error('bad_json')
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let total = 0
  let text = ''
  let timer
  const consume = (async () => {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        void reader.cancel().catch(() => {})
        throw new Error('body_too_large')
      }
      text += decoder.decode(value, { stream: true })
    }
    return text + decoder.decode()
  })()
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      void reader.cancel().catch(() => {})
      reject(new Error('body_timeout'))
    }, STREAM_TIMEOUT_MS)
  })
  try {
    return await Promise.race([consume, timeout])
  } finally {
    clearTimeout(timer)
  }
}

async function readJsonBody(request) {
  const raw = await readBoundedText(
    request.body,
    request.headers.get('content-length'),
    MAX_CALLBACK_BYTES,
  )
  let value
  try { value = JSON.parse(raw) } catch { throw new Error('bad_json') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('bad_json')
  return value
}

async function readJsonResponse(response) {
  const raw = await readBoundedText(
    response.body,
    response.headers.get('content-length'),
    MAX_SUPABASE_BYTES,
  )
  return JSON.parse(raw)
}

async function fetchWithTimeout(input, init) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)
  try {
    return await fetch(input, {
      ...(init || {}),
      signal: controller.signal,
      redirect: 'error',
    })
  } finally {
    clearTimeout(timer)
  }
}

async function sha1Hex(s) {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i += 1) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return mismatch === 0
}

/* WeChat's signature covers token+timestamp+nonce, dictionary-sorted. */
async function validSignature(params) {
  const signature = params.get('signature') || ''
  const timestamp = params.get('timestamp') || ''
  const nonce = params.get('nonce') || ''
  if (
    !PUSH_TOKEN
    || !/^[0-9a-f]{40}$/i.test(signature)
    || !/^\d{1,16}$/.test(timestamp)
    || !/^[A-Za-z0-9_-]{1,128}$/.test(nonce)
  ) return false
  const expected = await sha1Hex([PUSH_TOKEN, timestamp, nonce].sort().join(''))
  return constantTimeEqual(expected, signature.toLowerCase())
}

const svcHeaders = supabaseHeaders(SUPABASE_SERVICE, '', {
  'Content-Type': 'application/json',
})

function retryableFailure(message) {
  console.error(`wechat-callback: ${message}`)
  return plain('retry', 503)
}

export default async function handler(request) {
  const deploymentError = deploymentBoundaryResponse(evaluateDeploymentBoundary({ supabaseUrl: SUPABASE_URL }))
  if (deploymentError) return deploymentError
  const url = new URL(request.url)

  if (!(await validSignature(url.searchParams))) {
    return plain('forbidden', 403)
  }

  /* Config-save handshake: echo back the challenge. */
  if (request.method === 'GET') {
    const echo = url.searchParams.get('echostr') || ''
    if (!echo || echo.length > 256 || /[\u0000-\u001f\u007f]/.test(echo)) {
      return plain('bad request', 400)
    }
    return plain(echo, 200)
  }
  if (request.method !== 'POST') {
    return plain('method not allowed', 405, { Allow: 'GET, POST' })
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE) {
    return retryableFailure('service configuration unavailable')
  }

  let event
  try {
    event = await readJsonBody(request)
  } catch (error) {
    if (error?.message === 'body_timeout') return plain('request timeout', 408)
    return plain(
      error?.message === 'body_too_large' ? 'payload too large' : 'bad request',
      error?.message === 'body_too_large' ? 413 : 400,
    )
  }

  if (event?.Event === 'wxa_media_check') {
    const traceId = event.trace_id
    const suggest = event?.result?.suggest
    if (typeof traceId !== 'string' || !/^[A-Za-z0-9_-]{4,128}$/.test(traceId)) {
      return retryableFailure('invalid media trace id')
    }
    const q = `${SUPABASE_URL}/rest/v1/wechat_media_checks?trace_id=eq.${encodeURIComponent(traceId)}`

    if (!['pass', 'review', 'risky'].includes(suggest)) {
      return retryableFailure(`unknown verdict for trace_id ${traceId}`)
    }

    if (suggest === 'risky') {
      let mappingResponse
      try {
        mappingResponse = await fetchWithTimeout(
          `${q}&select=bucket,storage_path,user_id&limit=2`,
          { headers: svcHeaders },
        )
      } catch {
        return retryableFailure(`mapping lookup failed for trace_id ${traceId}`)
      }
      if (!mappingResponse.ok) {
        return retryableFailure(`mapping lookup returned ${mappingResponse.status} for trace_id ${traceId}`)
      }

      let rows
      try {
        rows = await readJsonResponse(mappingResponse)
      } catch {
        return retryableFailure(`mapping lookup returned invalid JSON for trace_id ${traceId}`)
      }
      if (!Array.isArray(rows) || rows.length !== 1) {
        return retryableFailure(`mapping missing for risky trace_id ${traceId}`)
      }

      const bucket = String(rows[0].bucket || '')
      const owner = String(rows[0].user_id || '')
      const storagePath = String(rows[0].storage_path || '')
      const ownPrefix = `items/${owner}/`
      const fileName = storagePath.slice(ownPrefix.length)
      /* Defense in depth against old/tampered mapping rows: privileged
         deletion is restricted to the recorded owner's generated image path.
         Preserve a rejected mapping for investigation instead of consuming
         the only pointer to a potentially risky object. */
      if (bucket !== 'item-images'
        || !UUID_RE.test(owner)
        || !storagePath.startsWith(ownPrefix)
        || !/^[A-Za-z0-9._-]+$/.test(fileName)
        || fileName.includes('..')) {
        return retryableFailure(`refused unsafe media mapping for trace_id ${traceId}`)
      }

      const bkt = encodeURIComponent(bucket)
      const path = storagePath.split('/').map(encodeURIComponent).join('/')
      let storageDelete
      try {
        storageDelete = await fetchWithTimeout(
          `${SUPABASE_URL}/storage/v1/object/${bkt}/${path}`,
          { method: 'DELETE', headers: svcHeaders },
        )
      } catch {
        return retryableFailure(`Storage deletion failed for trace_id ${traceId}`)
      }
      /* 404 is a confirmed-absent object and makes a retried callback
         idempotent after Storage succeeded but mapping cleanup failed. */
      if (!storageDelete.ok && storageDelete.status !== 404) {
        return retryableFailure(`Storage deletion returned ${storageDelete.status} for trace_id ${traceId}`)
      }
    }

    let mappingDelete
    try {
      mappingDelete = await fetchWithTimeout(q, { method: 'DELETE', headers: svcHeaders })
    } catch {
      return retryableFailure(`mapping cleanup failed for trace_id ${traceId}`)
    }
    if (!mappingDelete.ok) {
      return retryableFailure(`mapping cleanup returned ${mappingDelete.status} for trace_id ${traceId}`)
    }
  }

  return plain('success', 200)
}
