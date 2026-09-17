import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

let sequence = 0
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return {promise,resolve} }
const withoutImports = source => source.replace(/^import[\s\S]*?from ['"][^'"]+['"];?\s*$/gm, '')
function miniSource(source) {
  const enabled = [true], lines = []
  for (const line of source.split('\n')) {
    const directive = line.match(/\/\/ #(ifdef|ifndef) (H5|MP-WEIXIN)/)
    if (directive) { enabled.push(enabled.at(-1) && (directive[1] === 'ifdef' ? directive[2] === 'MP-WEIXIN' : directive[2] !== 'MP-WEIXIN')); continue }
    if (line.includes('// #endif')) { enabled.pop(); continue }
    if (enabled.at(-1)) lines.push(line)
  }
  return lines.join('\n')
}
async function compile(source, key, bindings) {
  const input = `const {${Object.keys(bindings).join(',')}}=globalThis.${key};\n${miniSource(withoutImports(source))}`
  const js = ts.transpileModule(input, {compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
}
async function fixture(t) {
  t.mock.timers.enable({apis:['setTimeout']})
  const state = {account:'account-a',generation:0,requests:[],logins:[]}
  const bindings = {
    BASE_URL:'https://app.example.test',
    useSupabase:() => ({supabase:{auth:{getSession:() => state.sessionWait?.promise || Promise.resolve({data:{session:{user:{id:state.account},access_token:'fixture-token'}}})}}}),
    getActiveAccountId:() => state.account,
    captureAccountRequest:userId => ({userId,generation:state.generation}),
    isAccountRequestCurrent:token => token.userId === state.account && token.generation === state.generation,
    registerAccountPrivateStateHydrate:() => {},removeAccountPrivateStorage:() => {},
    platformFetch:async (url, options) => { state.requests.push({url,body:JSON.parse(options.body)}); return {ok:true} },
    readBoundedJson:async () => ({ok:true,suggest:'pass'}),
    readBoundedJsonResponse:async () => ({}),
    uni:{login:options => state.logins.push(options)},
  }
  const key = `__wechatModeration${++sequence}`
  globalThis[key] = bindings
  t.after(() => { delete globalThis[key] })
  const read = path => readFileSync(new URL(path, import.meta.url),'utf8')
  Object.assign(bindings, await compile(read('../src/api/wechatSecCheckContract.ts'),key,bindings))
  Object.assign(bindings, await compile(read('../src/api/wechatAccountLink.ts'),key,bindings))
  state.gate = await compile(read('../src/composables/useWechatSecCheck.ts'),key,bindings)
  return state
}

test('a missing wx.login callback is bounded and a late callback cannot repeat moderation',async t => {
  const state = await fixture(t)
  let status = 'pending'
  const pending = state.gate.mpTextGate('hello',4).then(() => {status='done'}, () => {status='failed'})
  await flush();assert.equal(state.logins.length,1)
  t.mock.timers.tick(15_000);await flush()
  assert.notEqual(status,'pending','publishing must not wait forever for wx.login')
  assert.equal(state.requests.length,1)
  assert.equal(state.requests[0].body.js_code,undefined,'only the server may use its trusted existing binding')
  state.logins[0].success({code:'late-code'});await flush()
  assert.equal(state.requests.length,1)
  await pending
})

test('a stalled session fails without invoking WeChat or posting content; a retry can succeed',async t => {
  const state = await fixture(t);state.sessionWait = deferred()
  let status = 'pending'
  const pending = state.gate.mpTextGate('hello',4).then(() => {status='done'},error => {status=error.message})
  await flush();t.mock.timers.tick(10_000);await flush()
  assert.equal(status,'wechat_identity_unavailable')
  assert.equal(state.logins.length,0);assert.equal(state.requests.length,0)
  state.sessionWait.resolve({data:{session:{user:{id:'account-a'},access_token:'late-token'}}});await pending;await flush()
  assert.equal(state.requests.length,0)
  state.sessionWait = null
  const retry = state.gate.mpTextGate('hello',4);await flush()
  state.logins[0].success({code:'fresh-code'});await retry
  assert.equal(state.requests.length,1);assert.equal(state.requests[0].body.js_code,'fresh-code')
})

test('switching account while waiting for WeChat blocks the old moderation request',async t => {
  const state = await fixture(t)
  const pending = state.gate.mpTextGate('hello',4)
  const rejection = assert.rejects(pending,/wechat_identity_unavailable/)
  await flush();state.account='account-b';state.generation++
  state.logins[0].success({code:'old-account-code'});await rejection
  assert.equal(state.requests.length,0)
})
