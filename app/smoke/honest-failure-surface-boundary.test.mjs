import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'

/*
 * Contracts for the release checklist's P1-01, P1-02, P1-05 and P1-09.
 *
 * The shared failure mode is a UI that reports something more comfortable
 * than what happened: a dropped request rendered as "this post does not
 * exist", a success toast painted over photos that never uploaded, a raw
 * gotrue string handed to a Chinese-speaking student, an admin console
 * shipped inside a consumer Mini Program. Each assertion below is the exact
 * line that keeps one of those from coming back.
 */

const ROOT = new URL('../', import.meta.url)
const read = (rel) => readFile(new URL(rel, ROOT), 'utf8')

test('a failed post fetch is reported as a failure, not a missing post', async () => {
  const post = await read('src/pages/post/index.vue')

  // Three distinct terminal states, in this order: loading, load failed,
  // not found. Collapsing the middle one is the defect.
  assert.match(post, /const loadError = ref\(false\)/)
  assert.match(post, /v-else-if="loadError"[\s\S]{0,200}?role="alert"/)
  assert.match(post, /t\('error\.loadFailed'\)/)
  // The failure state has to offer a way forward, not just a way out.
  assert.match(post, /@click="loadPostForCurrentAccount"[\s\S]{0,80}?t\('home\.retry'\)/)
  // Reset on every attempt, set only from the transport catch.
  assert.match(post, /loadingComments\.value = true\s*\n\s*loadError\.value = false/)
  assert.match(post, /loadError\.value = true[\s\S]{0,160}?friendlyErrorMessage/)
})

test('a partial photo upload survives as the last thing the user is told', async () => {
  for (const [rel, successKey, partialKey] of [
    ['src/pages/publish/index.vue', 'publish.success', 'publish.successPartial'],
    ['src/pages/publish/edit.vue', 'publish.updated', 'publish.updatedPartial'],
    ['src/pages/plaza/index.vue', 'plaza.posted', 'plaza.postedPartial'],
  ]) {
    const source = await read(rel)
    assert.match(source, /let partialUpload: \{ done: number; total: number \} \| null = null/)
    assert.match(source, /partialUpload = \{ done: /)
    // Terminal branch: the shortfall message replaces the success toast
    // rather than being fired earlier and overwritten by it.
    assert.match(
      source,
      new RegExp(`if \\(partialUpload\\)[\\s\\S]{0,240}?t\\('${partialKey.replace('.', '\\.')}'`),
    )
    assert.match(source, new RegExp(`t\\('${successKey.replace('.', '\\.')}'\\), icon: 'success'`))
    // The old shape — warn now, succeed later — must not return.
    assert.doesNotMatch(
      source,
      /title: t\('publish\.imagesUploaded', \{ done: (uploaded|imageUrls)\.length/,
    )
  }

  for (const rel of ['src/composables/i18n/messages/en.ts', 'src/composables/i18n/messages/zh.ts']) {
    const messages = await read(rel)
    for (const key of ['publish.successPartial', 'publish.updatedPartial', 'plaza.postedPartial']) {
      assert.match(messages, new RegExp(`'${key.replace('.', '\\.')}':`), `${rel} is missing ${key}`)
    }
  }
})

test('login failures land on the field they belong to and stay put', async () => {
  const login = await read('src/pages/login/index.vue')

  for (const field of ['email', 'password', 'nickname']) {
    assert.match(login, new RegExp(`const ${field}Error = ref\\(''\\)`))
    assert.match(login, new RegExp(`id="login-${field}-error" class="field-error" role="alert"`))
    assert.match(login, new RegExp(`aria-describedby="\\w*Error \\? 'login-${field}-error' : undefined"`))
    assert.match(login, new RegExp(`:aria-invalid="${field}Error \\? 'true' : 'false'"`))
    // Editing the field clears its error; a stale message is its own defect.
    assert.match(login, new RegExp(`@input="${field}Error = ''"`))
  }
  assert.match(login, /const formError = ref\(''\)/)
  assert.match(login, /class="form-error" role="alert"/)
  // Switching tabs must not carry a sign-in failure into the sign-up form.
  assert.match(login, /clearFormErrors\(\)\s*\n\s*mode\.value = nextMode/)

  // An empty box is not a policy violation — the 8+ character line belongs
  // to sign-up only.
  assert.match(login, /passwordError\.value = t\('login\.enterPassword'\)/)
  for (const rel of ['src/composables/i18n/messages/en.ts', 'src/composables/i18n/messages/zh.ts']) {
    assert.match(await read(rel), /'login\.enterPassword':/)
  }
})

test('provider internals never reach the user as copy', async () => {
  const login = await read('src/pages/login/index.vue')
  // Google's failure is an English implementation string; it goes to the log
  // and the user gets the localized dictionary entry.
  assert.match(login, /console\.warn\('\[auth\] Google sign-in request failed'\)/)
  assert.match(login, /formError\.value = friendlyErrorMessage\(error, lang\.value as 'en' \| 'zh'\) \|\| t\('login\.googleFail'\)/)
  assert.doesNotMatch(login, /\$\{t\('login\.googleFail'\)\}: \$\{error\.message\}/)
  // Sign-in / sign-up fallbacks go through the same dictionary.
  assert.match(login, /formError\.value = friendlyErrorMessage\(error, lang\.value as 'en' \| 'zh'\) \|\| t\('login\.loginFail'\)/)
  assert.match(login, /formError\.value = friendlyErrorMessage\(error, lang\.value as 'en' \| 'zh'\) \|\| t\('login\.signupFail'\)/)
})

test('the moderation console is not compiled into the consumer Mini Program', async () => {
  const pages = await read('src/pages.json')
  // Conditional compilation, not a runtime guard: the route must not exist in
  // the mp artifact at all. Nothing in the app links to it, and a Mini Program
  // has no address bar, so on mp it was unreachable weight that still had to
  // clear WeChat review.
  assert.match(
    pages,
    /\/\/ #ifdef H5[\s\S]{0,600}?"path": "pages\/admin\/index"[\s\S]{0,200}?\/\/ #endif/,
  )
})

test('a pending email confirmation survives a reload without storing the code', async () => {
  const login = await read('src/pages/login/index.vue')

  // The panel used to be page-memory only: a refresh dropped the user back on
  // the signup form holding a code with nowhere to type it.
  assert.match(login, /const PENDING_CONFIRM_KEY = 'signup-pending-confirm'/)
  assert.match(login, /function restoreSignupConfirmation\(\)/)
  assert.match(login, /else restoreSignupConfirmation\(\)/)

  // The code is the credential and this is shared-device storage. Only the
  // address and the deadlines may be written.
  const write = login.slice(
    login.indexOf('function writePendingConfirm'),
    login.indexOf('function clearPendingConfirm'),
  )
  assert.doesNotMatch(write, /confirmCode/)
  assert.match(
    login,
    /writePendingConfirm\(\{\s*\n\s*email: submittedEmail,\s*\n\s*expiresAt:[\s\S]{0,80}?cooldownUntil: 0,/,
  )

  // Absolute deadlines, so reloading cannot reset the resend cooldown, and a
  // stale record cannot reopen the panel forever.
  assert.match(login, /const PENDING_CONFIRM_TTL_MS = 60 \* 60 \* 1000/)
  assert.match(login, /Date\.now\(\) >= parsed\.expiresAt/)
  assert.match(login, /runConfirmCooldown\(Math\.max\(0, Math\.ceil\(\(pending\.cooldownUntil - Date\.now\(\)\) \/ 1000\)\)\)/)

  // Confirming or leaving must retire the record.
  assert.match(login, /clearPendingConfirm\(\)\s*\n\s*clearConfirmCooldown\(\)/)
  assert.match(login, /if \(currentUser\.value\) clearPendingConfirm\(\)/)
})

test('an identity with no reachable mailbox is not offered email recovery', async () => {
  const utils = await read('src/utils/index.ts')
  const settings = await read('src/pages/settings/index.vue')

  // WeChat sign-in provisions wx_<openid>@wechat.placeholder. The server
  // already refuses to mail it (api/notification-digest.js, api/meetup-notify.js);
  // the client has to agree, or "change password" reports success and delivers
  // a code to an address the user cannot open.
  assert.match(utils, /export function isPlaceholderEmail\(email: string \| null \| undefined\): boolean/)
  assert.match(utils, /endsWith\("@wechat\.placeholder"\)/)

  assert.match(settings, /isPlaceholderEmail/)
  assert.match(settings, /const canRecoverByEmail = computed\(\s*\n\s*\(\) => isLoggedIn\.value && !isPlaceholderEmail\(currentUser\.value\?\.email\),/)
  assert.match(settings, /v-if="canRecoverByEmail"/)
  // Defence in depth: the handler refuses too, so a stale render or a
  // keyboard activation racing the profile load cannot send into the void.
  assert.match(settings, /if \(isPlaceholderEmail\(targetEmail\)\) \{[\s\S]{0,300}?settings\.passwordUnavailableWechat/)
})
