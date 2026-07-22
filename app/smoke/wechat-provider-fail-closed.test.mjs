import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = relativePath => readFileSync(resolve(appRoot, relativePath), 'utf8')

async function loadTypeScriptModule(relativePath) {
  const compiled = ts.transpileModule(source(relativePath), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
}

test('client response interpreter accepts only explicit disabled, pass, block, and durable trace states', async () => {
  const contract = await loadTypeScriptModule('src/api/wechatSecCheckContract.ts')

  assert.equal(contract.wechatTextGateOutcome({ ok: true, degraded: true, reason: 'not_configured' }), 'disabled')
  assert.equal(contract.wechatTextGateOutcome({ ok: true, suggest: 'pass' }), 'pass')
  assert.equal(contract.wechatTextGateOutcome({ ok: false, suggest: 'risky' }), 'block')
  assert.equal(contract.wechatTextGateOutcome({ ok: false, suggest: 'review' }), 'block')

  for (const value of [
    null,
    [],
    { ok: true },
    { ok: true, degraded: true },
    { ok: true, degraded: true, reason: 'provider_error' },
    { ok: true, suggest: 'unknown' },
    { ok: false, suggest: 'pass' },
    { ok: false, suggest: 'unknown' },
  ]) {
    assert.equal(contract.wechatTextGateOutcome(value), 'unavailable')
  }

  assert.equal(contract.hasDurableWechatMediaHandoff({ ok: true, trace_id: 'trace-valid' }), true)
  for (const value of [
    null,
    { ok: true },
    { ok: true, degraded: true, trace_id: 'trace-valid' },
    { ok: false, trace_id: 'trace-valid' },
    { ok: true, trace_id: '../../victim' },
    { ok: true, trace_id: 1234 },
  ]) {
    assert.equal(contract.hasDurableWechatMediaHandoff(value), false)
  }
})

test('configured WeChat text moderation failures block every write chain', () => {
  const gate = source('src/composables/useWechatSecCheck.ts')
  const textStart = gate.indexOf('export async function mpTextGate(')
  const textEnd = gate.indexOf('\nexport async function mpImageCheck(', textStart)
  const text = gate.slice(textStart, textEnd)

  assert.ok(textStart >= 0 && textEnd > textStart)
  assert.match(text, /failureCode: 'moderation_gate_unavailable'/)
  assert.doesNotMatch(text, /catch[\s\S]*return/)
  assert.match(text, /wechatTextGateOutcome\(data\)/)
  assert.match(text, /outcome === 'disabled' \|\| outcome === 'pass'/)
  assert.match(text, /outcome === 'block'/)
  assert.match(text, /throw new Error\('moderation_gate_unavailable'\)/)

  const messages = source('src/composables/useMessages.ts')
  const items = source('src/composables/useItems.ts')
  const plaza = source('src/composables/usePlaza.ts')
  assert.match(messages, /await mpTextGate\(content, 4, accountToken\)/)
  assert.equal((items.match(/await mpTextGate\(/g) || []).length, 2)
  assert.equal((plaza.match(/await mpTextGate\(/g) || []).length, 2)
})

test('configured WeChat media failure keeps candidates unreferenced and invokes cleanup', () => {
  const gate = source('src/composables/useWechatSecCheck.ts')
  const items = source('src/composables/useItems.ts')

  assert.match(gate, /failureCode: 'wechat_media_check_unavailable'/)
  assert.match(gate, /!hasDurableWechatMediaHandoff\(result\)/)
  assert.match(items, /await mpImageCheck\(storagePath, 'item-images', accountToken\)[\s\S]*items\.wechat_media_handoff_cleanup/)
  const firstCheck = items.indexOf("await mpImageCheck(storagePath, 'item-images', accountToken)")
  const firstPublish = items.indexOf('urls.push(candidateUrl)', firstCheck)
  assert.ok(firstCheck >= 0 && firstPublish > firstCheck)
})

test('server rejects prefixes and malformed configured-provider success payloads', () => {
  const server = source('../api/wechat-seccheck.js')

  assert.doesNotMatch(server, /slice\(0,\s*2500\)/)
  assert.match(server, /body\.content\.length > MAX_TEXT_CHARS[\s\S]*content_too_large/)
  assert.match(server, /integrationState === 'disabled'[\s\S]*reason: 'not_configured'/)
  assert.match(server, /integrationState === 'invalid'[\s\S]*wechat_misconfigured/)
  assert.match(server, /data\.errcode !== 0/)
  assert.match(server, /!\['pass', 'review', 'risky'\]\.includes\(suggest\)/)
  assert.match(server, /data\.errcode !== 0 \|\| !validTraceId\(data\.trace_id\)/)
  assert.match(server, /return json\(\{ error: 'wechat_provider_unavailable' \}, 503\)/)
})

test('callback authenticates, validates and canonicalizes before durable claim', () => {
  const callback = source('../api/wechat-callback.js')
  const auth = callback.indexOf('const secureQuery = encryptedQuery(url.searchParams)')
  const bodyRead = callback.indexOf('bodyBytes = await readBoundedBytes(')
  const decrypt = callback.indexOf('const plaintext = await decryptSecurityModeMessage(')
  const validate = callback.indexOf("event.Event !== 'wxa_media_check'")
  const payloadHash = callback.indexOf('payloadHash: await sha256Hex(')
  const claim = callback.indexOf("callbackRpc('claim_wechat_callback_receipt'")
  const parse = callback.indexOf('const event = parseMediaEvent(plaintext)')

  assert.ok(auth >= 0 && bodyRead > auth && decrypt > bodyRead && parse > decrypt
    && validate > parse && payloadHash > validate && claim > payloadHash)
  assert.match(callback, /encryptType !== 'aes'/)
  assert.match(callback, /constantTimeEqual\(appId, WECHAT_APPID\)/)
  assert.match(callback, /MAX_CALLBACK_BYTES = 32 \* 1024/)
  assert.match(callback, /signal: controller\.signal,[\s\S]*redirect: 'manual'/)
  assert.match(callback, /function retryableFailure[\s\S]*plain\('retry', 503, \{ 'Retry-After': '2' \}\)/)
  assert.match(callback, /claimState === 'completed'\) return plain\('success', 200\)/)
  assert.match(callback, /callbackRpc\('complete_wechat_callback_receipt'/)
  assert.match(callback, /Content-Security-Policy/)
  assert.match(callback, /X-Content-Type-Options/)
  assert.match(callback, /Cache-Control': 'no-store'/)
})
