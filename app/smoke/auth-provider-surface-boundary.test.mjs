import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = relativePath => readFile(new URL(relativePath, import.meta.url), 'utf8')

const [login, auth, wechatApi, accountPrivacy, resetPassword, sentry] = await Promise.all([
  source('../src/pages/login/index.vue'),
  source('../src/composables/useAuth.ts'),
  source('../../api/auth/wechat-login.js'),
  source('../src/api/accountLocalPrivacy.ts'),
  source('../src/pages/reset-password/index.vue'),
  source('../src/utils/sentry.ts'),
])

/** Body of one top-level `function name(` / `async function name(`, up to the next one. */
function functionBody(fileSource, name) {
  const start = fileSource.search(new RegExp(`(?:async )?function ${name}\\(`))
  assert.ok(start >= 0, `${name} not found`)
  const rest = fileSource.slice(start + 1)
  const end = rest.search(/\n(?:async )?function \w+\(|\n<\/script>/)
  return rest.slice(0, end < 0 ? undefined : end)
}

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

/*
 * Every one of these turns a provider failure into a toast and returns, which
 * is why the whole set produced no Sentry event of any kind until 2026-08-08.
 * A sending domain that stops delivering codes, a disabled OAuth provider, a
 * gotrue 5xx — all of it looked identical to a user mistyping a password.
 */
const PRE_SESSION_AUTH_PATHS = [
  { page: 'login', fn: 'onVerifySignup', sources: ['login-verify-otp'] },
  { page: 'login', fn: 'onResendSignup', sources: ['login-resend-otp'] },
  { page: 'login', fn: 'onForgotPassword', sources: ['login-reset-request'] },
  { page: 'login', fn: 'onSignInWithGoogle', sources: ['login-oauth-google'] },
  { page: 'reset', fn: 'onResend', sources: ['reset-resend'] },
  { page: 'reset', fn: 'onSave', sources: ['reset-verify-otp', 'reset-update-password', 'reset-save'] },
  { page: 'auth', fn: 'signUp', sources: ['auth-signup'] },
  { page: 'auth', fn: 'signIn', sources: ['auth-signin'] },
]

test('every pre-session auth failure path reports', () => {
  const files = { login, reset: resetPassword, auth }
  for (const { page, fn, sources } of PRE_SESSION_AUTH_PATHS) {
    const body = functionBody(files[page], fn)
    for (const tag of sources) {
      assert.match(body, new RegExp(`captureAuthFailure\\([^)]*'${tag}'\\)`), `${fn} must report ${tag}`)
    }
  }
})

test('reported auth failures exclude only what the user can fix', () => {
  const set = sentry.slice(
    sentry.indexOf('const USER_CORRECTABLE_AUTH_CODES'),
    sentry.indexOf('export function captureAuthFailure'),
  )
  for (const code of ['invalid_credentials', 'otp_expired', 'weak_password', 'user_already_exists']) {
    assert.match(set, new RegExp(`'${code}'`), `${code} is the user's to fix`)
  }
  // Quota and transport failures are the reason this exists: a collapsed
  // sending domain first shows up as new users never receiving their code.
  for (const code of ['over_email_send_rate_limit', 'over_request_rate_limit', 'provider_disabled']) {
    assert.doesNotMatch(set, new RegExp(`'${code}'`), `${code} must reach Sentry`)
  }
  assert.match(sentry, /const code = safeErrorCode\(err\)\n\s*if \(code && USER_CORRECTABLE_AUTH_CODES\.has\(code\)\) return/)
})

test('sign-out reports a server-side session that outlived the local purge', () => {
  const body = functionBody(auth, 'signOut')
  assert.match(body, /result\.remoteRevokeError[\s\S]*captureException\([\s\S]*'auth-remote-revoke'/)
  assert.match(body, /!result\.accessTokenFound[\s\S]*'auth-remote-revoke-skipped'/)
})
