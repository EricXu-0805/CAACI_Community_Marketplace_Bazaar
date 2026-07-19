import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = relativePath => readFileSync(resolve(appRoot, relativePath), 'utf8')

test('mini-program moderation never reads, writes, or sends a cached openid', () => {
  const gate = source('src/composables/useWechatSecCheck.ts')
  const server = source('../api/wechat-seccheck.js')

  assert.doesNotMatch(gate, /getStorageSync\([^)]*wechat_seccheck_openid/)
  assert.doesNotMatch(gate, /setStorageSync\([^)]*wechat_seccheck_openid/)
  assert.doesNotMatch(gate, /body\.openid\s*=/)
  assert.doesNotMatch(gate, /data\?\.openid/)
  assert.match(gate, /body\.js_code = jsCode/)

  assert.doesNotMatch(server, /return body\.openid/)
  assert.match(server, /Legacy body\.openid is deliberately ignored/)
  assert.doesNotMatch(server, /json\([^\n]*openid/)
})

test('moderation request is generation-bound across session, wx.login, and network awaits', () => {
  const gate = source('src/composables/useWechatSecCheck.ts')
  assert.match(gate, /captureAccountRequest/)
  assert.match(gate, /isAccountRequestCurrent/)
  assert.match(gate, /registerAccountPrivateStateHydrate\(clearLegacyOpenidCache\)/)
  assert.match(gate, /removeAccountPrivateStorage\(LEGACY_OPENID_KEY\)/)

  const callStart = gate.indexOf('async function callSeccheck(')
  const callEnd = gate.indexOf('\nexport async function mpTextGate(', callStart)
  const call = gate.slice(callStart, callEnd)
  const session = call.indexOf('await authenticatedBearer(expectedAccountToken)')
  const login = call.indexOf('await freshJsCode()')
  const beforeFetchGuard = call.indexOf('assertAccountCurrent(accountToken)', login)
  const fetch = call.indexOf('await platformFetch(', beforeFetchGuard)
  const afterFetchGuard = call.indexOf('assertAccountCurrent(accountToken)', fetch)
  const parse = call.indexOf('await readBoundedJson', afterFetchGuard)
  const afterParseGuard = call.indexOf('assertAccountCurrent(accountToken)', parse)

  assert.ok(callStart >= 0 && callEnd > callStart)
  assert.ok(session >= 0 && login > session)
  assert.ok(beforeFetchGuard > login && fetch > beforeFetchGuard)
  assert.ok(afterFetchGuard > fetch && parse > afterFetchGuard && afterParseGuard > parse)

  const textGate = gate.slice(callEnd, gate.indexOf('\nexport async function mpImageCheck(', callEnd))
  assert.match(textGate, /failureCode: 'moderation_gate_unavailable'/)
  assert.doesNotMatch(textGate, /catch[\s\S]*return/)
})

test('text and media write chains revalidate the account after WeChat moderation', () => {
  const messages = source('src/composables/useMessages.ts')
  const plaza = source('src/composables/usePlaza.ts')
  const items = source('src/composables/useItems.ts')

  const messageGate = messages.indexOf('await mpTextGate(content, 4, accountToken)')
  const messageGuard = messages.indexOf('!isAccountRequestCurrent(accountToken)', messageGate)
  assert.ok(messageGate >= 0 && messageGuard > messageGate)

  for (const marker of ['await mpTextGate(trimmed, 3, accountToken)', 'await mpTextGate(trimmed, 2, accountToken)']) {
    const gate = plaza.indexOf(marker)
    const guard = plaza.indexOf('assertAccountCurrent()', gate)
    assert.ok(gate >= 0 && guard > gate, `${marker} is missing its post-gate account guard`)
  }

  for (const marker of [
    'await mpTextGate(`${input.title}\\n${input.description}`, 3, accountToken)',
    'await mpTextGate(aiInput, 3, accountToken)',
  ]) {
    const gate = items.indexOf(marker)
    const guard = items.indexOf('assertAccountCurrent(accountToken, session.user.id)', gate)
    assert.ok(gate >= 0 && guard > gate, `${marker} is missing its post-gate account guard`)
  }

  for (const marker of ["await mpImageCheck(storagePath, 'item-images', accountToken)"]) {
    const first = items.indexOf(marker)
    const firstGuard = items.indexOf('assertAccountCurrent(accountToken, session.user.id)', first)
    const second = items.indexOf(marker, first + marker.length)
    const secondGuard = items.indexOf('assertAccountCurrent(accountToken, session.user.id)', second)
    assert.ok(first >= 0 && firstGuard > first)
    assert.ok(second > first && secondGuard > second)
  }
})

test('logout clears retired WeChat identity and all translation caches', () => {
  const auth = source('src/composables/useAuth.ts')
  const privacy = source('src/api/accountLocalPrivacy.ts')
  const translate = source('src/composables/useTranslate.ts')

  assert.match(auth, /transitionAccount\(null, true\)[\s\S]*reconcileLocalPrivacy\(null, previousUserId\)/)
  assert.match(privacy, /'wechat_seccheck_openid'/)
  assert.match(privacy, /'translate_cache_v2'/)
  assert.match(privacy, /'translate_cache_v1'/)
  assert.match(translate, /registerAccountPrivateStateReset\(resetTranslationMemory\)/)
  assert.match(translate, /registerAccountPrivateStateHydrate\(loadDisk\)/)
  assert.match(translate, /removeAccountPrivateStorage\(TRANSLATE_CACHE_STORAGE_KEY\)/)
})
