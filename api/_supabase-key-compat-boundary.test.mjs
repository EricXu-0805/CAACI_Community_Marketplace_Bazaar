// Leading underscore prevents Vercel from treating this test as an API Function.
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { readdir, readFile } from 'node:fs/promises'
import { inlineDeploymentBoundaryImport } from './_test-module-loader.mjs'

const API_ROOT = new URL('./', import.meta.url)
const ENV_KEYS = [
  'SUPABASE_URL', 'VITE_SUPABASE_URL',
  'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY',
  'VITE_SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_ANON_KEY',
  'CRON_SECRET', 'OPENAI_API_KEY',
]
const originalEnv = new Map(ENV_KEYS.map(key => [key, process.env[key]]))
const originalFetch = globalThis.fetch
let nonce = 0

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key)
    if (value == null) delete process.env[key]
    else process.env[key] = value
  }
  globalThis.fetch = originalFetch
})

async function loadApi(relativePath, env) {
  for (const key of ENV_KEYS) delete process.env[key]
  Object.assign(process.env, env)
  const source = await readFile(new URL(relativePath, API_ROOT), 'utf8')
  return import(
    `data:text/javascript;base64,${Buffer.from(inlineDeploymentBoundaryImport(source)).toString('base64')}#supabase-key-${nonce++}`
  )
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

test('every server route with a legacy key input also exposes its new-key replacement', async () => {
  const topLevel = (await readdir(API_ROOT, { withFileTypes: true }))
    .filter(entry => entry.isFile() && entry.name.endsWith('.js'))
    .map(entry => entry.name)
  const nested = []
  for (const directory of ['admin', 'auth']) {
    const entries = await readdir(new URL(`${directory}/`, API_ROOT), { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.js')) nested.push(`${directory}/${entry.name}`)
    }
  }

  for (const file of [...topLevel, ...nested]) {
    const source = await readFile(new URL(file, API_ROOT), 'utf8')
    const hasComponentKey = /SUPABASE_(?:SECRET|SERVICE_ROLE|PUBLISHABLE|ANON)_KEY/.test(source)
    if (source.includes("env('SUPABASE_SERVICE_ROLE_KEY")
        || source.includes('process.env.SUPABASE_SERVICE_ROLE_KEY')) {
      assert.match(source, /SUPABASE_SECRET_KEY/, `${file} lacks sb_secret configuration`)
    }
    if (source.includes("env('SUPABASE_ANON_KEY")
        || source.includes('process.env.SUPABASE_ANON_KEY')) {
      assert.match(source, /SUPABASE_PUBLISHABLE_KEY/, `${file} lacks sb_publishable configuration`)
    }
    assert.doesNotMatch(
      source,
      /Authorization:\s*`Bearer \$\{(?:SERVICE_KEY|SUPABASE_SERVICE|SUPABASE_ANON_KEY|SUPABASE_ANON)\}`/,
      `${file} still forces an opaque component key through Authorization`,
    )
    if (hasComponentKey && file !== 'db-proxy.js') {
      assert.match(source, /function supabaseHeaders\(/, `${file} bypasses the shared header contract`)
      assert.match(
        source,
        /!\/\^sb_\(\?:publishable\|secret\)_\/\.test\(key\)/,
        `${file} does not distinguish opaque component keys from JWT-shaped legacy keys`,
      )
    }
  }

  const proxy = await readFile(new URL('db-proxy.js', API_ROOT), 'utf8')
  assert.match(proxy, /headers\['apikey'\] !== SUPABASE_ANON_KEY/)
  assert.match(proxy, /\^Bearer\\s\+\\S\+\$\/i\.test\(headers\.authorization/)
})

test('opaque secret key wins over legacy service_role and is sent as apikey only', async () => {
  const calls = []
  globalThis.fetch = async (input, init = {}) => {
    calls.push({ input, init, headers: new Headers(init.headers) })
    return json([{
      edge_rate_limits_deleted: 0,
      illini_verifications_deleted: 0,
      wechat_media_checks_deleted: 0,
      has_more: false,
    }])
  }
  const { default: handler } = await loadApi('data-retention.js', {
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_SECRET_KEY: 'sb_secret_new-key',
    SUPABASE_SERVICE_ROLE_KEY: 'legacy-service-role-must-not-win',
    CRON_SECRET: 'cron-secret',
  })

  const response = await handler(new Request('https://app.test/api/data-retention', {
    headers: { Authorization: 'Bearer cron-secret' },
  }))
  assert.equal(response.status, 200)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].headers.get('apikey'), 'sb_secret_new-key')
  assert.equal(calls[0].headers.has('authorization'), false)
})

test('anonymous publishable read uses apikey only and prefers the new env name', async () => {
  const calls = []
  globalThis.fetch = async (input, init = {}) => {
    calls.push({ input, init, headers: new Headers(init.headers) })
    return json([])
  }
  const { default: handler } = await loadApi('share.js', {
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_new-key',
    SUPABASE_ANON_KEY: 'legacy-anon-must-not-win',
  })

  const response = await handler(new Request(
    'https://app.test/api/share?id=11111111-1111-4111-8111-111111111111',
  ))
  assert.equal(response.status, 200)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].headers.get('apikey'), 'sb_publishable_new-key')
  assert.equal(calls[0].headers.has('authorization'), false)
})

test('user JWT remains Authorization while opaque public and secret keys stay in apikey', async () => {
  const calls = []
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const headers = new Headers(init.headers)
    calls.push({ url, init, headers })
    if (url.pathname === '/auth/v1/user') {
      return json({ id: '11111111-1111-4111-8111-111111111111' })
    }
    if (url.pathname === '/rest/v1/rpc/edge_rate_hit') return json(true)
    if (url.pathname === '/v1/chat/completions') {
      return json({ choices: [{ message: { content: '{"translated":"你好"}' } }] })
    }
    throw new Error(`unexpected fetch ${url}`)
  }
  const { default: handler } = await loadApi('translate.js', {
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_new-key',
    SUPABASE_SECRET_KEY: 'sb_secret_new-key',
    OPENAI_API_KEY: 'openai-test-key',
  })

  const response = await handler(new Request('https://app.test/api/translate', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer user-jwt',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text: 'hello', target: 'zh' }),
  }))
  assert.equal(response.status, 200)

  const authCall = calls.find(call => call.url.pathname === '/auth/v1/user')
  assert.equal(authCall.headers.get('apikey'), 'sb_publishable_new-key')
  assert.equal(authCall.headers.get('authorization'), 'Bearer user-jwt')

  const limiterCall = calls.find(call => call.url.pathname === '/rest/v1/rpc/edge_rate_hit')
  assert.equal(limiterCall.headers.get('apikey'), 'sb_secret_new-key')
  assert.equal(limiterCall.headers.has('authorization'), false)
})
