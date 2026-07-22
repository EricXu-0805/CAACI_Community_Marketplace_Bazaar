import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { createClient } from '@supabase/supabase-js'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = relativePath => readFileSync(resolve(appRoot, relativePath), 'utf8')

async function loadRecoveryBoundary() {
  const compiled = ts.transpileModule(source('src/api/recoveryPassword.ts'), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
}

function tokenFor(userId) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({
    aud: 'authenticated',
    exp: now + 3600,
    iat: now,
    role: 'authenticated',
    sub: userId,
  })}.${encode({ sig: 'test' })}`
}

function makeUser(id, email) {
  return {
    id,
    email,
    aud: 'authenticated',
    role: 'authenticated',
    app_metadata: {},
    user_metadata: {},
    created_at: '2026-01-01T00:00:00.000Z',
  }
}

function makeSession(user) {
  return {
    access_token: tokenFor(user.id),
    refresh_token: `refresh-${user.id}`,
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'bearer',
    user,
  }
}

function memoryStorage() {
  const values = new Map()
  return {
    values,
    adapter: {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, value) },
      removeItem: key => { values.delete(key) },
    },
  }
}

function authClient(fetcher, options = {}) {
  return createClient('https://recovery-boundary-test.supabase.co', 'anon-test-key', {
    auth: {
      persistSession: options.persistSession ?? false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storage: options.storage,
      storageKey: options.storageKey,
    },
    global: { fetch: fetcher },
  })
}

function fakeAuthServer(recoverySession, sessions) {
  const usersByToken = new Map(sessions.map(session => [session.access_token, session.user]))
  const passwordWrites = []
  const fetcher = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url)
    const method = String(init.method || 'GET').toUpperCase()
    const headers = new Headers(init.headers)
    const bearer = String(headers.get('authorization') || '').replace(/^Bearer\s+/i, '')

    if (url.pathname.endsWith('/verify') && method === 'POST') {
      return Response.json(recoverySession)
    }

    if (url.pathname.endsWith('/user') && method === 'GET') {
      const user = usersByToken.get(bearer)
      return user
        ? Response.json({ user })
        : Response.json({ message: 'invalid token' }, { status: 401 })
    }

    if (url.pathname.endsWith('/user') && method === 'PUT') {
      const user = usersByToken.get(bearer)
      if (!user) return Response.json({ message: 'invalid token' }, { status: 401 })
      passwordWrites.push({ userId: user.id, token: bearer, body: JSON.parse(String(init.body || '{}')) })
      return Response.json({ user })
    }

    return Response.json({ message: `unexpected ${method} ${url.pathname}` }, { status: 500 })
  }
  return { fetcher, passwordWrites }
}

test('installed auth-js reproduces the old A-to-B ambient-session password race', async () => {
  const userA = makeUser('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a@example.com')
  const userB = makeUser('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b@example.com')
  const sessionA = makeSession(userA)
  const sessionB = makeSession(userB)
  const server = fakeAuthServer(sessionA, [sessionA, sessionB])
  const shared = memoryStorage()
  const storageKey = 'sb-recovery-race-auth-token'
  const tabA = authClient(server.fetcher, { persistSession: true, storage: shared.adapter, storageKey })
  const tabB = authClient(server.fetcher, { persistSession: true, storage: shared.adapter, storageKey })

  const verified = await tabA.auth.verifyOtp({ email: userA.email, token: '111111', type: 'recovery' })
  assert.equal(verified.error, null)
  assert.equal(verified.data.user?.id, userA.id)

  // The second tab signs B in after A's recovery verification resolves.
  assert.equal((await tabB.auth.setSession({
    access_token: sessionB.access_token,
    refresh_token: sessionB.refresh_token,
  })).error, null)

  // This was the page's old call. updateUser reloads the shared session and
  // therefore sends B's token even though the preceding OTP verified A.
  assert.equal((await tabA.auth.updateUser({ password: 'New-password-123!' })).error, null)
  assert.equal(server.passwordWrites.length, 1)
  assert.equal(server.passwordWrites[0].userId, userB.id)
  assert.equal(server.passwordWrites[0].token, sessionB.access_token)

  await tabA.auth.stopAutoRefresh()
  await tabB.auth.stopAutoRefresh()
})

test('isolated A recovery leaves the ambient persisted B session unchanged end to end', async () => {
  const { updateRecoveryPasswordWithBoundSession } = await loadRecoveryBoundary()
  const userA = makeUser('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'A@Example.com')
  const userB = makeUser('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b@example.com')
  const sessionA = makeSession(userA)
  const sessionB = makeSession(userB)
  const server = fakeAuthServer(sessionA, [sessionA, sessionB])
  const shared = memoryStorage()
  const storageKey = 'sb-recovery-safe-auth-token'
  const tabB = authClient(server.fetcher, { persistSession: true, storage: shared.adapter, storageKey })

  // B is already the authoritative app session before A starts recovery.
  assert.equal((await tabB.auth.setSession({
    access_token: sessionB.access_token,
    refresh_token: sessionB.refresh_token,
  })).error, null)
  const persistedB = shared.values.get(storageKey)

  // The page now performs both calls on this same non-persisted client.
  const isolated = authClient(server.fetcher, { persistSession: false })
  const verification = await isolated.auth.verifyOtp({ email: userA.email, token: '111111', type: 'recovery' })
  assert.equal(verification.error, null)
  assert.equal(shared.values.get(storageKey), persistedB, 'isolated verifyOtp must not replace ambient B')
  const result = await updateRecoveryPasswordWithBoundSession(
    isolated,
    verification.data,
    'a@example.com',
    'New-password-123!',
  )

  assert.equal(result.error, null)
  assert.equal(result.data.user?.id, userA.id)
  assert.equal(server.passwordWrites.length, 1)
  assert.equal(server.passwordWrites[0].userId, userA.id)
  assert.equal(server.passwordWrites[0].token, sessionA.access_token)
  assert.equal(shared.values.get(storageKey), persistedB, 'isolated update must not replace ambient B')
  assert.match(persistedB, new RegExp(userB.id))

  await tabB.auth.stopAutoRefresh()
  await isolated.auth.stopAutoRefresh()
})

test('identity disagreement fails closed before updateUser is called', async () => {
  const {
    RECOVERY_IDENTITY_MISMATCH,
    updateRecoveryPasswordWithBoundSession,
  } = await loadRecoveryBoundary()
  const userA = makeUser('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a@example.com')
  const userB = makeUser('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b@example.com')
  const sessionA = makeSession(userA)
  let updateCalls = 0
  const mismatchedClient = {
    auth: {
      async setSession() {
        return { data: { user: userB, session: makeSession(userB) }, error: null }
      },
      async updateUser() {
        updateCalls += 1
        return { data: { user: userB }, error: null }
      },
    },
  }

  const result = await updateRecoveryPasswordWithBoundSession(
    mismatchedClient,
    { user: userA, session: sessionA },
    userA.email,
    'New-password-123!',
  )
  assert.equal(result.error?.code, RECOVERY_IDENTITY_MISMATCH)
  assert.equal(updateCalls, 0)
})

test('page and client factory enforce the non-ambient recovery contract and clear flow residue', () => {
  const reset = source('src/pages/reset-password/index.vue')
  const login = source('src/pages/login/index.vue')
  const supabase = source('src/composables/useSupabase.ts')

  assert.match(reset, /const recoveryClient = createEphemeralSupabaseClient\(\)[^]*data: verification[^]*recoveryClient\.auth\.verifyOtp\([^]*updateRecoveryPasswordWithBoundSession\([^]*recoveryClient[^]*verification[^]*submittedPassword/)
  assert.doesNotMatch(reset, /supabase\.auth\.verifyOtp\(/)
  assert.doesNotMatch(reset, /supabase\.auth\.updateUser\(/)
  assert.match(supabase, /createEphemeralSupabaseClient\(\)[^]*persistSession: false[^]*autoRefreshToken: false[^]*detectSessionInUrl: false/)

  assert.match(reset, /watch\([^]*email\.value\.trim\(\)\.toLowerCase\(\)[^]*code\.value = ''[^]*newPassword\.value = ''[^]*confirmPw\.value = ''[^]*clearCooldown\(\)/)
  assert.match(login, /function setMode\([^]*password\.value = ''[^]*showPw\.value = false/)
  assert.match(login, /function leaveSignupConfirmation\([^]*pendingEmail\.value = ''[^]*confirmCode\.value = ''[^]*clearConfirmCooldown\(\)/)
  assert.match(login, /const submittedEmail = email\.value\.trim\(\)\.toLowerCase\(\)[^]*signUp\(submittedEmail, submittedPassword, submittedNickname\)[^]*startSignupConfirmation\(submittedEmail\)/)
})
