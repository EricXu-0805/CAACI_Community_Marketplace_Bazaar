import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = relativePath => readFile(new URL(relativePath, import.meta.url), 'utf8')

const [login, auth, wechatApi, accountPrivacy] = await Promise.all([
  source('../src/pages/login/index.vue'),
  source('../src/composables/useAuth.ts'),
  source('../../api/auth/wechat-login.js'),
  source('../src/api/accountLocalPrivacy.ts'),
])

test('first-release login surface exposes email/password and H5-only Google', () => {
  assert.match(login, /v-model="email"/)
  assert.match(login, /v-model="password"/)
  assert.match(login, /@click="onSubmit"/)

  const h5Start = login.indexOf('<!-- #ifdef H5 -->')
  const h5Block = login.slice(h5Start, login.indexOf('<!-- #endif -->', h5Start))
  assert.ok(h5Start >= 0)
  assert.match(h5Block, /@click="onSignInWithGoogle"/)
  assert.match(h5Block, /login\.googleSignIn/)

  assert.doesNotMatch(login, /wechatQuick|onWeChatLogin|wx-btn|wx-icon/)
  assert.doesNotMatch(login, /linkIdentity|账号合并|绑定微信|link WeChat/i)
})

test('hidden WeChat login keeps compatibility, cleanup, and server boundaries dormant', () => {
  assert.match(auth, /async function signInWithWeChat\(/)
  assert.match(auth, /signInWithWeChat,/)
  assert.match(accountPrivacy, /wechat_seccheck_openid/)
  assert.match(wechatApi, /export default async function handler/)
  assert.match(wechatApi, /process\.env\.WECHAT_LOGIN_ENABLED === 'true'/)
  assert.match(wechatApi, /if \(!WECHAT_LOGIN_ENABLED\)[\s\S]*wechat_login_disabled[\s\S]*404/)
  const disabledGate = wechatApi.indexOf('if (!WECHAT_LOGIN_ENABLED)')
  assert.ok(disabledGate > wechatApi.indexOf("request.method !== 'POST'"))
  assert.ok(disabledGate < wechatApi.indexOf('body = await parseRequestBody(request)'))
  assert.ok(disabledGate < wechatApi.indexOf('await exchangeCodeForIdentity(jsCode)'))
})
