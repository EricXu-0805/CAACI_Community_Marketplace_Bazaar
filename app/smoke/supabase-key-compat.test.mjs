import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import ts from 'typescript'
import { createClient } from '@supabase/supabase-js'

const ROOT = new URL('../', import.meta.url)

async function loadKeyHelpers() {
  const source = await readFile(new URL('src/utils/supabaseKeys.ts', ROOT), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
}

test('public key selection prefers sb_publishable while retaining legacy anon fallback', async () => {
  const { preferredSupabasePublicKey } = await loadKeyHelpers()
  assert.equal(
    preferredSupabasePublicKey('sb_publishable_new', 'legacy-anon'),
    'sb_publishable_new',
  )
  assert.equal(preferredSupabasePublicKey('', 'legacy-anon'), 'legacy-anon')
  assert.equal(preferredSupabasePublicKey(undefined, undefined), '')
  assert.equal(preferredSupabasePublicKey('sb_secret_misconfigured', 'legacy-anon'), 'legacy-anon')
  assert.equal(preferredSupabasePublicKey('sb_secret_misconfigured', ''), '')
})

test('CI and pre-push build gates exercise the publishable-key path', async () => {
  const ci = await readFile(new URL('../.github/workflows/ci.yml', ROOT), 'utf8')
  const prePush = await readFile(new URL('../.githooks/pre-push', ROOT), 'utf8')
  const viteConfig = await readFile(new URL('vite.config.ts', ROOT), 'utf8')
  assert.match(ci, /VITE_SUPABASE_PUBLISHABLE_KEY:\s*sb_publishable_ci-stub-key/)
  assert.match(prePush, /export VITE_SUPABASE_PUBLISHABLE_KEY=/)
  assert.doesNotMatch(prePush, /export VITE_SUPABASE_ANON_KEY=/)
  assert.match(viteConfig, /rejectPrivilegedSupabaseKeyInPublicEnv/)
  assert.match(viteConfig, /payload\?\.role === "service_role"/)
  assert.doesNotMatch(viteConfig, /\$\{value\}/)
})

test('header adapter strips only the SDK opaque-key fallback and preserves a real user JWT', async () => {
  const { withSupabaseApiKeySemantics } = await loadKeyHelpers()
  const calls = []
  const wrapped = withSupabaseApiKeySemantics(async (input, init = {}) => {
    calls.push({ input, headers: new Headers(init.headers) })
    return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })
  })

  await wrapped('https://project.supabase.co/rest/v1/profiles', {
    headers: {
      apikey: 'sb_publishable_new',
      Authorization: 'Bearer sb_publishable_new',
    },
  })
  assert.equal(calls[0].headers.get('apikey'), 'sb_publishable_new')
  assert.equal(calls[0].headers.has('authorization'), false)

  await wrapped('https://project.supabase.co/rest/v1/profiles', {
    headers: {
      apikey: 'sb_publishable_new',
      Authorization: 'Bearer signed-user-jwt',
    },
  })
  assert.equal(calls[1].headers.get('authorization'), 'Bearer signed-user-jwt')

  await wrapped('https://project.supabase.co/rest/v1/profiles', {
    headers: {
      apikey: 'legacy-anon-jwt',
      Authorization: 'Bearer legacy-anon-jwt',
    },
  })
  assert.equal(calls[2].headers.get('authorization'), 'Bearer legacy-anon-jwt')
})

test('installed supabase-js works with the adapter for anonymous Data API calls', async () => {
  const { withSupabaseApiKeySemantics } = await loadKeyHelpers()
  const calls = []
  const client = createClient(
    'https://project.supabase.co',
    'sb_publishable_sdk-test',
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        fetch: withSupabaseApiKeySemantics(async (input, init = {}) => {
          calls.push({ input, headers: new Headers(init.headers) })
          return new Response('[]', {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }),
      },
    },
  )

  const { error } = await client.from('profiles').select('id').limit(1)
  assert.equal(error, null)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].headers.get('apikey'), 'sb_publishable_sdk-test')
  assert.equal(calls[0].headers.has('authorization'), false)
})

test('the client boundary documents the installed SDK compatibility behavior', async () => {
  const packageJson = JSON.parse(await readFile(
    new URL('node_modules/@supabase/supabase-js/package.json', ROOT),
    'utf8',
  ))
  const sdkFetchSource = await readFile(
    new URL('node_modules/@supabase/supabase-js/src/lib/fetch.ts', ROOT),
    'utf8',
  )
  const sdkClientSource = await readFile(
    new URL('node_modules/@supabase/supabase-js/src/SupabaseClient.ts', ROOT),
    'utf8',
  )

  assert.equal(packageJson.version, '2.103.3')
  assert.match(sdkFetchSource, /headers\.set\('apikey', supabaseKey\)/)
  assert.match(sdkFetchSource, /headers\.set\('Authorization', `Bearer \$\{accessToken\}`\)/)
  assert.match(sdkClientSource, /params: \{ \.\.\.\{ apikey: this\.supabaseKey \}/)
  assert.match(sdkClientSource, /data\.session\?\.access_token \?\? this\.supabaseKey/)
})
