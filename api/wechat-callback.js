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
 * POST accepts only WeChat security mode: msg_signature authenticates Token,
 * timestamp, nonce and the encrypted body; AES-256-CBC decryption then verifies
 * the trailing AppID before any database or Storage operation. Plaintext POSTs
 * and compatibility-mode envelopes carrying extra plaintext fields are
 * rejected without side effects.
 *
 * A config-save GET handshake is still supported. Verdict processing is
 * deliberately fail-closed:
 * WeChat only receives "success" after every required Supabase operation has
 * completed, so a transient mapping/Storage failure remains retryable.
 *
 * Env: WECHAT_APPID, WECHAT_PUSH_TOKEN, WECHAT_ENCODING_AES_KEY,
 * WECHAT_MEDIA_ASYNC_ENABLED, SUPABASE_URL, SUPABASE_SECRET_KEY. Legacy
 * SUPABASE_SERVICE_ROLE_KEY remains a rolling fallback.
 */

function env(name, fallback) {
  return process.env[name] || fallback
}

const PUSH_TOKEN       = env('WECHAT_PUSH_TOKEN', '')
const WECHAT_APPID      = env('WECHAT_APPID', '')
const ENCODING_AES_KEY  = env('WECHAT_ENCODING_AES_KEY', '')
const WECHAT_MEDIA_ASYNC_ENABLED = process.env.WECHAT_MEDIA_ASYNC_ENABLED === 'true'
const SUPABASE_URL     = env('SUPABASE_URL', env('VITE_SUPABASE_URL', ''))
const SUPABASE_SERVICE = env('SUPABASE_SECRET_KEY', env('SUPABASE_SERVICE_ROLE_KEY', ''))

const MAX_CALLBACK_BYTES = 32 * 1024
const MAX_SUPABASE_BYTES = 16 * 1024
const UPSTREAM_TIMEOUT_MS = 5_000
const STREAM_TIMEOUT_MS = 5_000
const CALLBACK_MAX_PAST_SECONDS = 5 * 60
const CALLBACK_MAX_FUTURE_SECONDS = 60
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const APP_ID_RE = /^wx[0-9a-f]{16}$/i
const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

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

async function readBoundedBytes(stream, declaredLength, maxBytes) {
  if (declaredLength != null) {
    if (!/^\d+$/.test(declaredLength)) throw new Error('bad_length')
    if (Number(declaredLength) > maxBytes) throw new Error('body_too_large')
  }
  if (!stream) throw new Error('bad_json')
  const reader = stream.getReader()
  let total = 0
  const chunks = []
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
      chunks.push(value)
    }
    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return bytes
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

async function readBoundedText(stream, declaredLength, maxBytes) {
  return new TextDecoder().decode(await readBoundedBytes(stream, declaredLength, maxBytes))
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
      redirect: 'manual',
    })
  } finally {
    clearTimeout(timer)
  }
}

async function sha1Hex(s) {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function sha256Hex(value) {
  const buf = await crypto.subtle.digest('SHA-256', value)
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i += 1) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return mismatch === 0
}

function decodeCanonicalBase64(value, maxBytes = MAX_CALLBACK_BYTES) {
  if (typeof value !== 'string' || !value || value.length > Math.ceil(maxBytes / 3) * 4 + 4
    || value.length % 4 !== 0 || !BASE64_RE.test(value)) return null
  try {
    const binary = atob(value)
    if (binary.length > maxBytes || btoa(binary) !== value) return null
    return Uint8Array.from(binary, character => character.charCodeAt(0))
  } catch {
    return null
  }
}

function decodeEncodingAesKey(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}$/.test(value)) return null
  const decoded = decodeCanonicalBase64(`${value}=`, 32)
  return decoded?.byteLength === 32 ? decoded : null
}

const ENCODING_AES_KEY_BYTES = decodeEncodingAesKey(ENCODING_AES_KEY)

function secureMediaConfigurationValid() {
  return APP_ID_RE.test(WECHAT_APPID)
    && typeof PUSH_TOKEN === 'string'
    && PUSH_TOKEN.length >= 1
    && PUSH_TOKEN.length <= 256
    && !/[\u0000-\u001f\u007f]/.test(PUSH_TOKEN)
    && ENCODING_AES_KEY_BYTES !== null
}

function encryptedQuery(params) {
  const exactQueryValue = name => {
    const values = params.getAll(name)
    return values.length === 1 ? values[0] : ''
  }
  const encryptType = exactQueryValue('encrypt_type')
  const msgSignature = exactQueryValue('msg_signature')
  const timestamp = exactQueryValue('timestamp')
  const nonce = exactQueryValue('nonce')
  if (encryptType !== 'aes'
    || !/^[0-9a-f]{40}$/i.test(msgSignature)
    || !/^\d{1,12}$/.test(timestamp)
    || !/^[A-Za-z0-9_-]{1,128}$/.test(nonce)
    || !freshTimestamp(timestamp)) return null
  return { msgSignature: msgSignature.toLowerCase(), timestamp, nonce }
}

function exactXmlText(xml, tag) {
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const expression = new RegExp(
    `<${escapedTag}\\s*>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))<\\/${escapedTag}\\s*>`,
    'g',
  )
  const matches = [...xml.matchAll(expression)]
  if (matches.length !== 1) return null
  const value = (matches[0][1] ?? matches[0][2] ?? '').trim()
  if (!value || (matches[0][1] == null && value.includes('&'))) return null
  return value
}

function encryptedEnvelope(raw) {
  const value = raw.trim()
  if (value.startsWith('{')) {
    let envelope
    try { envelope = JSON.parse(value) } catch { return null }
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)
      || typeof envelope.ToUserName !== 'string' || !envelope.ToUserName
      || typeof envelope.Encrypt !== 'string'
      || Object.keys(envelope).length !== 2
      || !Object.hasOwn(envelope, 'ToUserName')
      || !Object.hasOwn(envelope, 'Encrypt')) return null
    return envelope.Encrypt
  }
  if (!value.startsWith('<')
    || /<!DOCTYPE|<!ENTITY/i.test(value)
    || !/^\s*(?:<\?xml[^?]*\?>\s*)?<xml\s*>[\s\S]*<\/xml\s*>\s*$/.test(value)) return null
  const encrypted = exactXmlText(value, 'Encrypt')
  const toUserName = exactXmlText(value, 'ToUserName')
  if (!encrypted || !toUserName) return null
  const inner = value
    .replace(/^\s*(?:<\?xml[^?]*\?>\s*)?<xml\s*>/, '')
    .replace(/<\/xml\s*>\s*$/, '')
    .replace(/<ToUserName\s*>(?:<!\[CDATA\[[\s\S]*?\]\]>|[^<]*)<\/ToUserName\s*>/, '')
    .replace(/<Encrypt\s*>(?:<!\[CDATA\[[\s\S]*?\]\]>|[^<]*)<\/Encrypt\s*>/, '')
  return inner.trim() ? null : encrypted
}

async function decryptSecurityModeMessage(bodyBytes, query) {
  if (!ENCODING_AES_KEY_BYTES) return null
  let raw
  try { raw = new TextDecoder('utf-8', { fatal: true }).decode(bodyBytes) } catch { return null }
  const encrypted = encryptedEnvelope(raw)
  const ciphertext = decodeCanonicalBase64(encrypted)
  if (!encrypted || !ciphertext || ciphertext.byteLength === 0 || ciphertext.byteLength % 32 !== 0) {
    return null
  }
  const expected = await sha1Hex([PUSH_TOKEN, query.timestamp, query.nonce, encrypted].sort().join(''))
  if (!constantTimeEqual(expected, query.msgSignature)) return null

  let full
  try {
    const key = await crypto.subtle.importKey(
      'raw', ENCODING_AES_KEY_BYTES, { name: 'AES-CBC' }, false, ['encrypt', 'decrypt'],
    )
    /* WebCrypto always applies AES-block (16-byte) PKCS#7, while WeChat's
       official protocol pads to K=32 and may therefore end in 17..32. Append
       one authenticated-local sentinel block whose plaintext is valid 0x10
       padding, let WebCrypto remove only that block, then validate/remove the
       original WeChat K=32 padding ourselves. CBC leaves all earlier blocks
       unchanged when a final block is appended. */
    const lastCipherBlock = ciphertext.slice(ciphertext.byteLength - 16)
    const sentinelPlain = new Uint8Array(16).fill(16)
    const sentinelCipherWithPadding = new Uint8Array(await crypto.subtle.encrypt(
      { name: 'AES-CBC', iv: lastCipherBlock }, key, sentinelPlain,
    ))
    const extendedCiphertext = new Uint8Array(ciphertext.byteLength + 16)
    extendedCiphertext.set(ciphertext)
    extendedCiphertext.set(sentinelCipherWithPadding.slice(0, 16), ciphertext.byteLength)
    const padded = new Uint8Array(await crypto.subtle.decrypt(
      { name: 'AES-CBC', iv: ENCODING_AES_KEY_BYTES.slice(0, 16) },
      key,
      extendedCiphertext,
    ))
    const padding = padded[padded.byteLength - 1]
    if (padding < 1 || padding > 32 || padding > padded.byteLength) return null
    for (let index = padded.byteLength - padding; index < padded.byteLength; index += 1) {
      if (padded[index] !== padding) return null
    }
    full = padded.slice(0, padded.byteLength - padding)
  } catch {
    return null
  }
  if (full.byteLength < 20) return null
  const messageLength = new DataView(full.buffer, full.byteOffset + 16, 4).getUint32(0, false)
  const messageStart = 20
  const messageEnd = messageStart + messageLength
  if (messageLength === 0 || messageEnd > full.byteLength) return null

  let appId
  let message
  try {
    appId = new TextDecoder('utf-8', { fatal: true }).decode(full.slice(messageEnd))
    message = new TextDecoder('utf-8', { fatal: true }).decode(full.slice(messageStart, messageEnd))
  } catch {
    return null
  }
  if (!constantTimeEqual(appId, WECHAT_APPID)) return null
  return message
}

function parseXmlMediaEvent(xml) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)
    || !/^\s*(?:<\?xml[^?]*\?>\s*)?<xml\s*>[\s\S]*<\/xml\s*>\s*$/.test(xml)) return null
  const resultMatches = [...xml.matchAll(/<result\s*>([\s\S]*?)<\/result\s*>/g)]
  if (resultMatches.length !== 1) return null
  /* The official event also carries detail[]. Its nested errcode/suggest tags
     must not be mistaken for the top-level validity code or aggregate result. */
  const topLevel = xml
    .replace(/<detail\s*>[\s\S]*?<\/detail\s*>/g, '')
    .replace(/<result\s*>[\s\S]*?<\/result\s*>/g, '')
  const errcode = exactXmlText(topLevel, 'errcode')
  const version = exactXmlText(topLevel, 'version')
  return {
    MsgType: exactXmlText(topLevel, 'MsgType'),
    Event: exactXmlText(topLevel, 'Event'),
    appid: exactXmlText(topLevel, 'appid'),
    trace_id: exactXmlText(topLevel, 'trace_id'),
    errcode: errcode != null && /^-?\d+$/.test(errcode) ? Number(errcode) : null,
    version: version != null && /^\d+$/.test(version) ? Number(version) : null,
    result: { suggest: exactXmlText(resultMatches[0][1], 'suggest') },
  }
}

function parseMediaEvent(plaintext) {
  const value = plaintext.trim()
  if (value.startsWith('{')) {
    try {
      const event = JSON.parse(value)
      return event && typeof event === 'object' && !Array.isArray(event) ? event : null
    } catch {
      return null
    }
  }
  return value.startsWith('<') ? parseXmlMediaEvent(value) : null
}

/* WeChat's signature covers token+timestamp+nonce, dictionary-sorted. */
async function verifiedSignature(params) {
  const signatureValues = params.getAll('signature')
  const timestampValues = params.getAll('timestamp')
  const nonceValues = params.getAll('nonce')
  const signature = signatureValues.length === 1 ? signatureValues[0] : ''
  const timestamp = timestampValues.length === 1 ? timestampValues[0] : ''
  const nonce = nonceValues.length === 1 ? nonceValues[0] : ''
  if (
    !PUSH_TOKEN
    || !/^[0-9a-f]{40}$/i.test(signature)
    || !/^\d{1,12}$/.test(timestamp)
    || !/^[A-Za-z0-9_-]{1,128}$/.test(nonce)
  ) return null
  const expected = await sha1Hex([PUSH_TOKEN, timestamp, nonce].sort().join(''))
  if (!constantTimeEqual(expected, signature.toLowerCase())) return null
  return { timestamp }
}

function freshTimestamp(timestamp) {
  const seconds = Number(timestamp)
  if (!Number.isSafeInteger(seconds)) return false
  const now = Math.floor(Date.now() / 1000)
  return seconds >= now - CALLBACK_MAX_PAST_SECONDS
    && seconds <= now + CALLBACK_MAX_FUTURE_SECONDS
}

const svcHeaders = supabaseHeaders(SUPABASE_SERVICE, '', {
  'Content-Type': 'application/json',
})

async function callbackRpc(name, body) {
  const response = await fetchWithTimeout(
    `${SUPABASE_URL}/rest/v1/rpc/${name}`,
    { method: 'POST', headers: svcHeaders, body: JSON.stringify(body) },
  )
  if (!response.ok) throw new Error('rpc_failed')
  return readJsonResponse(response)
}

async function releaseClaim(claim) {
  if (!claim) return
  try {
    await callbackRpc('release_wechat_callback_receipt', {
      event_key_in: claim.eventKey,
      payload_sha256_in: claim.payloadHash,
      claim_token_in: claim.claimToken,
    })
  } catch {
    /* The bounded lease remains the recovery path if release is unavailable. */
    console.error('wechat-callback: receipt_release_failed')
  }
}

async function retryableFailure(code, claim = null) {
  console.error(`wechat-callback: ${code}`)
  await releaseClaim(claim)
  return plain('retry', 503, { 'Retry-After': '2' })
}

async function completeClaim(claim, traceId = null) {
  try {
    return await callbackRpc('complete_wechat_callback_receipt', {
      event_key_in: claim.eventKey,
      payload_sha256_in: claim.payloadHash,
      claim_token_in: claim.claimToken,
      trace_id_in: traceId,
    }) === true
  } catch {
    return false
  }
}

export default async function handler(request) {
  const deploymentError = deploymentBoundaryResponse(evaluateDeploymentBoundary({ supabaseUrl: SUPABASE_URL }))
  if (deploymentError) return deploymentError
  const url = new URL(request.url)

  /* Config-save handshake: echo back the challenge. */
  if (request.method === 'GET') {
    const verified = await verifiedSignature(url.searchParams)
    if (!verified) return plain('forbidden', 403)
    if (!freshTimestamp(verified.timestamp)) return plain('forbidden', 403)
    const echo = url.searchParams.get('echostr') || ''
    if (!echo || echo.length > 256 || /[\u0000-\u001f\u007f]/.test(echo)) {
      return plain('bad request', 400)
    }
    return plain(echo, 200)
  }
  if (request.method !== 'POST') {
    return plain('method not allowed', 405, { Allow: 'GET, POST' })
  }
  /* GET remains available for configuration handshake, but POST cannot read a
     body, claim an event or reach Storage while media async is disabled. */
  if (!WECHAT_MEDIA_ASYNC_ENABLED) {
    return plain('media async disabled', 503, { 'Retry-After': '60' })
  }
  if (!secureMediaConfigurationValid()) {
    return retryableFailure('secure_callback_configuration_unavailable')
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE) {
    return retryableFailure('service_configuration_unavailable')
  }
  const secureQuery = encryptedQuery(url.searchParams)
  if (!secureQuery) return plain('forbidden', 403)

  let bodyBytes
  try {
    bodyBytes = await readBoundedBytes(
      request.body,
      request.headers.get('content-length'),
      MAX_CALLBACK_BYTES,
    )
  } catch (error) {
    if (error?.message === 'body_timeout') return plain('request timeout', 408)
    return plain(
      error?.message === 'body_too_large' ? 'payload too large' : 'bad request',
      error?.message === 'body_too_large' ? 413 : 400,
    )
  }

  const plaintext = await decryptSecurityModeMessage(bodyBytes, secureQuery)
  if (!plaintext) return plain('forbidden', 403)
  const event = parseMediaEvent(plaintext)
  if (!event) return plain('bad request', 400)

  /* Parse and validate the sole supported event before a durable claim. A
     malformed body must never reserve a real provider trace_id forever. */
  const traceId = event.trace_id
  const suggest = event?.result?.suggest
  if (event.MsgType !== 'event'
    || event.Event !== 'wxa_media_check'
    || event.appid !== WECHAT_APPID
    || event.version !== 2
    || event.errcode !== 0
    || !event.result || typeof event.result !== 'object' || Array.isArray(event.result)
    || typeof traceId !== 'string' || !/^[A-Za-z0-9_-]{4,128}$/.test(traceId)
    || !['pass', 'review', 'risky'].includes(suggest)) {
    return plain('bad request', 400)
  }

  /* Only stable business fields participate in the digest. JSON/XML choice,
     key order, extra provider metadata and a new signed query must not create
     a second execution of the same authenticated provider trace. */
  const canonicalPayload = JSON.stringify({
    Event: 'wxa_media_check',
    trace_id: traceId,
    suggest,
  })
  const claim = {
    eventKey: `wxa_media_check:${traceId}`,
    payloadHash: await sha256Hex(new TextEncoder().encode(canonicalPayload)),
    claimToken: crypto.randomUUID(),
  }
  let claimState
  try {
    claimState = await callbackRpc('claim_wechat_callback_receipt', {
      event_key_in: claim.eventKey,
      payload_sha256_in: claim.payloadHash,
      callback_timestamp_in: secureQuery.timestamp,
      claim_token_in: claim.claimToken,
    })
  } catch {
    return retryableFailure('receipt_claim_failed')
  }

  if (claimState === 'completed') return plain('success', 200)
  if (claimState === 'conflict' || claimState === 'stale') return plain('forbidden', 403)
  if (claimState === 'busy') return retryableFailure('receipt_busy')
  if (claimState !== 'claimed') return retryableFailure('receipt_claim_invalid')

  const q = `${SUPABASE_URL}/rest/v1/wechat_media_checks?trace_id=eq.${encodeURIComponent(traceId)}`

  if (suggest === 'risky') {
      let mappingResponse
      try {
        mappingResponse = await fetchWithTimeout(
          `${q}&select=bucket,storage_path,user_id&limit=2`,
          { headers: svcHeaders },
        )
      } catch {
        return retryableFailure('mapping_lookup_failed', claim)
      }
      if (!mappingResponse.ok) {
        return retryableFailure('mapping_lookup_rejected', claim)
      }

      let rows
      try {
        rows = await readJsonResponse(mappingResponse)
      } catch {
        return retryableFailure('mapping_lookup_invalid', claim)
      }
      if (!Array.isArray(rows) || rows.length !== 1) {
        return retryableFailure('mapping_missing', claim)
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
        return retryableFailure('unsafe_media_mapping', claim)
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
        return retryableFailure('storage_deletion_failed', claim)
      }
      /* 404 is a confirmed-absent object and makes a retried callback
         idempotent after Storage succeeded but mapping cleanup failed. */
      if (!storageDelete.ok && storageDelete.status !== 404) {
        return retryableFailure('storage_deletion_rejected', claim)
      }
  }

  /* Mapping cleanup (zero or one row) and receipt completion commit in one
     database transaction. Zero supports a DB-first rolling window. Risky
     verdicts still require the validated mapping above before Storage delete. */
  if (!(await completeClaim(claim, traceId))) {
    return retryableFailure('receipt_completion_failed', claim)
  }
  return plain('success', 200)
}
