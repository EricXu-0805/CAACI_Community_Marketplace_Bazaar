import { Buffer } from 'node:buffer'

export const TEST_WECHAT_APP_ID = 'wxba5fad812f8e6fb9'
export const TEST_WECHAT_ENCODING_AES_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

async function sha1(value) {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function plaintextCallbackSignature(token, timestamp, nonce) {
  return sha1([token, timestamp, nonce].sort().join(''))
}

export function completeMediaEvent(event = {}, appId = TEST_WECHAT_APP_ID) {
  return {
    MsgType: 'event',
    Event: 'wxa_media_check',
    appid: appId,
    version: 2,
    errcode: 0,
    ...event,
  }
}

function xmlText(value) {
  return `<![CDATA[${String(value)}]]>`
}

function mediaEventXml(event) {
  return `<xml>
<MsgType>${xmlText(event.MsgType)}</MsgType>
<Event>${xmlText(event.Event)}</Event>
<appid>${xmlText(event.appid)}</appid>
<trace_id>${xmlText(event.trace_id)}</trace_id>
<version>${event.version}</version>
<detail><item><errcode>0</errcode><suggest>${xmlText(event?.result?.suggest)}</suggest></item></detail>
<errcode>${event.errcode}</errcode>
<result><suggest>${xmlText(event?.result?.suggest)}</suggest></result>
</xml>`
}

async function encryptMessage(plaintext, encodingAesKey, appIdSuffix) {
  const keyBytes = Buffer.from(`${encodingAesKey}=`, 'base64')
  const messageBytes = new TextEncoder().encode(plaintext)
  const appIdBytes = new TextEncoder().encode(appIdSuffix)
  const full = new Uint8Array(20 + messageBytes.byteLength + appIdBytes.byteLength)
  full.set(new TextEncoder().encode('0123456789abcdef'), 0)
  new DataView(full.buffer).setUint32(16, messageBytes.byteLength, false)
  full.set(messageBytes, 20)
  full.set(appIdBytes, 20 + messageBytes.byteLength)
  const padding = 32 - (full.byteLength % 32)
  const padded = new Uint8Array(full.byteLength + padding)
  padded.set(full)
  padded.fill(padding, full.byteLength)
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-CBC' }, false, ['encrypt'])
  const ciphertextWithWebCryptoPadding = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-CBC', iv: keyBytes.subarray(0, 16) },
    key,
    padded,
  ))
  // The protocol already uses K=32 PKCS#7. WebCrypto adds one AES-block of
  // padding to aligned input, so discard that independent final CBC block.
  return Buffer.from(ciphertextWithWebCryptoPadding.slice(0, -16)).toString('base64')
}

export async function secureCallbackRequest(token, event = {}, options = {}) {
  const timestamp = options.timestamp || String(Math.floor(Date.now() / 1000))
  const nonce = options.nonce || 'nonce-a'
  const method = options.method || 'POST'
  if (method === 'GET') {
    const signature = options.signature || await plaintextCallbackSignature(token, timestamp, nonce)
    const query = new URLSearchParams({ signature, timestamp, nonce })
    if (options.echostr != null) query.set('echostr', options.echostr)
    return new Request(`https://app.test/api/wechat-callback?${query}`, { method: 'GET' })
  }

  if (options.plaintext === true) {
    const signature = options.signature || await plaintextCallbackSignature(token, timestamp, nonce)
    const query = new URLSearchParams({ signature, timestamp, nonce })
    return new Request(`https://app.test/api/wechat-callback?${query}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: options.rawBody ?? JSON.stringify(completeMediaEvent(event, options.eventAppId)),
    })
  }

  const appId = options.eventAppId || TEST_WECHAT_APP_ID
  const completed = completeMediaEvent(event, appId)
  const plaintext = options.rawBody ?? (
    options.messageFormat === 'xml' ? mediaEventXml(completed) : JSON.stringify(completed)
  )
  let encrypted = await encryptMessage(
    plaintext,
    options.encodingAesKey || TEST_WECHAT_ENCODING_AES_KEY,
    options.appIdSuffix || TEST_WECHAT_APP_ID,
  )
  if (typeof options.mutateCiphertext === 'function') {
    const bytes = Buffer.from(encrypted, 'base64')
    options.mutateCiphertext(bytes)
    encrypted = bytes.toString('base64')
  }
  if (Number.isSafeInteger(options.truncateCiphertextBytes)
    && options.truncateCiphertextBytes > 0) {
    const bytes = Buffer.from(encrypted, 'base64')
    encrypted = bytes.subarray(0, -options.truncateCiphertextBytes).toString('base64')
  }
  const msgSignature = options.msgSignature || await sha1(
    [token, timestamp, nonce, encrypted].sort().join(''),
  )
  const query = new URLSearchParams({
    timestamp,
    nonce,
    encrypt_type: options.encryptType || 'aes',
    msg_signature: msgSignature,
  })
  const body = options.envelopeFormat === 'xml'
    ? `<xml><ToUserName><![CDATA[gh_test]]></ToUserName><Encrypt><![CDATA[${encrypted}]]></Encrypt></xml>`
    : JSON.stringify({ ToUserName: 'gh_test', Encrypt: encrypted })
  return new Request(`https://app.test/api/wechat-callback?${query}`, {
    method,
    headers: {
      'Content-Type': options.envelopeFormat === 'xml' ? 'application/xml' : 'application/json',
    },
    body,
  })
}

export function secureCallbackEnv(token = 'push-token') {
  return {
    WECHAT_APPID: TEST_WECHAT_APP_ID,
    WECHAT_PUSH_TOKEN: token,
    WECHAT_ENCODING_AES_KEY: TEST_WECHAT_ENCODING_AES_KEY,
    WECHAT_MEDIA_ASYNC_ENABLED: 'true',
  }
}
