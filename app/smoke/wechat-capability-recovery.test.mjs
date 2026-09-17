import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

let sequence = 0
async function fixture(t, response) {
  const key = `__wechatCapability${++sequence}`
  globalThis[key] = {
    BASE_URL: 'https://example.test',
    platformFetch: async () => {
      if (response instanceof Error) throw response
      return { ok: response.ok }
    },
    readBoundedJsonResponse: async () => response.body,
  }
  t.after(() => { delete globalThis[key] })
  let source = readFileSync(new URL('../src/api/wechatAccountLink.ts', import.meta.url), 'utf8')
  source = source.replace(/^import .*$/gm, '')
  source = `const {BASE_URL,platformFetch,readBoundedJsonResponse}=globalThis.${key};\n${source}`
  const js = ts.transpileModule(source, {compilerOptions: {module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
}

test('only explicit release-disabled response is presented as not available yet', async t => {
  const api = await fixture(t, {ok:false,body:{error:'wechat_login_disabled'}})
  assert.deepEqual(await api.wechatCapabilities(), {login:false,account_link:false,unavailable:false})
})
test('network, provider configuration and malformed responses preserve a retry path', async t => {
  for (const response of [new Error('offline'),{ok:false,body:{error:'wechat_not_configured'}},
    {ok:true,body:{login:'true',account_link:true}},{ok:true,body:null}]) {
    const api = await fixture(t,response)
    assert.deepEqual(await api.wechatCapabilities(), {login:false,account_link:false,unavailable:true})
  }
})
test('a temporary failure does not poison a subsequent successful capability check', async t => {
  const response = {ok:false,body:{error:'provider_timeout'}}
  const api = await fixture(t,response)
  assert.equal((await api.wechatCapabilities()).unavailable,true)
  response.ok = true;response.body = {login:true,account_link:true}
  assert.deepEqual(await api.wechatCapabilities(), {login:true,account_link:true,unavailable:false})
})
test('account linking stays hidden when ordinary WeChat login is not enabled', async t => {
  const api = await fixture(t,{ok:true,body:{login:false,account_link:true}})
  assert.equal((await api.wechatCapabilities()).account_link,false)
})
