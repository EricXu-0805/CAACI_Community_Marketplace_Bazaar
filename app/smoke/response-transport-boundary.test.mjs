import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import ts from 'typescript'
import { createClient } from '@supabase/supabase-js'

const ROOT = new URL('../', import.meta.url)

async function loadTypeScript(relativePath) {
  const source = await readFile(new URL(relativePath, ROOT), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
}

function delayed(value, ms) {
  return new Promise(resolve => setTimeout(() => resolve(value), ms))
}

function stalledResponse(overrides = {}) {
  const never = () => new Promise(() => {})
  return {
    status: 200,
    statusText: 'OK',
    ok: true,
    url: 'https://example.test/data',
    redirected: false,
    type: 'basic',
    headers: new Headers({ 'Content-Type': 'application/json' }),
    body: {},
    bodyUsed: false,
    clone() { return stalledResponse(overrides) },
    json: never,
    text: never,
    formData: never,
    blob: never,
    arrayBuffer: never,
    ...overrides,
  }
}

test('header and structured response phases have independent deterministic deadlines', async () => {
  const { withTransportDeadlines } = await loadTypeScript('src/api/transportBoundary.ts')
  let requestSignal
  const fetcher = withTransportDeadlines((_input, init) => {
    requestSignal = init.signal
    return new Promise(() => {})
  }, {
    headerTimeoutMs: 15,
    structuredBodyTimeoutMs: 15,
    binaryBodyTimeoutMs: 100,
  })

  await assert.rejects(
    fetcher('https://example.test/headers'),
    error => error?.name === 'AbortError' && error?.message === 'response_headers_timeout',
  )
  assert.equal(requestSignal.aborted, true)

  let bodySignal
  const bodyFetcher = withTransportDeadlines(async (_input, init) => {
    bodySignal = init.signal
    return stalledResponse()
  }, {
    headerTimeoutMs: 100,
    structuredBodyTimeoutMs: 15,
    binaryBodyTimeoutMs: 100,
  })
  const response = await bodyFetcher('https://example.test/body')
  await assert.rejects(
    response.json(),
    error => error?.name === 'AbortError' && error?.message === 'response_body_timeout',
  )
  assert.equal(bodySignal.aborted, true)
})

test('a caller abort after headers still cancels response body consumption', async () => {
  const { withTransportDeadlines } = await loadTypeScript('src/api/transportBoundary.ts')
  const caller = new AbortController()
  let transportSignal
  const fetcher = withTransportDeadlines(async (_input, init) => {
    transportSignal = init.signal
    return stalledResponse()
  }, {
    headerTimeoutMs: 100,
    structuredBodyTimeoutMs: 500,
  })

  const response = await fetcher('https://example.test/body', { signal: caller.signal })
  const read = response.text()
  caller.abort()
  await assert.rejects(
    read,
    error => error?.name === 'AbortError' && error?.message === 'request_aborted',
  )
  assert.equal(transportSignal.aborted, true)

  const requestController = new AbortController()
  const requestResponse = await fetcher(new Request('https://example.test/request-object', {
    signal: requestController.signal,
  }))
  const requestRead = requestResponse.json()
  requestController.abort()
  await assert.rejects(requestRead, /request_aborted/)
})

test('large upload/download paths use longer bounded windows than JSON', async () => {
  const { withTransportDeadlines } = await loadTypeScript('src/api/transportBoundary.ts')
  const options = {
    headerTimeoutMs: 15,
    uploadHeaderTimeoutMs: 100,
    structuredBodyTimeoutMs: 15,
    binaryBodyTimeoutMs: 100,
  }

  const slowHeaders = withTransportDeadlines(
    async () => delayed(new Response('{}', { headers: { 'Content-Type': 'application/json' } }), 35),
    options,
  )
  await assert.rejects(slowHeaders('https://example.test/json'), /response_headers_timeout/)
  const uploadResponse = await slowHeaders('https://example.test/upload', {
    method: 'POST',
    body: new FormData(),
  })
  assert.deepEqual(await uploadResponse.json(), {})
  const requestUploadResponse = await slowHeaders(new Request('https://example.test/request-upload', {
    method: 'POST',
    body: new FormData(),
  }))
  assert.deepEqual(await requestUploadResponse.json(), {})

  const slowBinary = withTransportDeadlines(async () => stalledResponse({
    blob: () => delayed(new Blob(['media']), 35),
  }), options)
  const binaryResponse = await slowBinary('https://example.test/media')
  const blob = await binaryResponse.blob()
  assert.equal(await blob.text(), 'media')

  const slowJson = withTransportDeadlines(async () => stalledResponse({
    json: () => delayed({ ok: true }, 35),
  }), options)
  await assert.rejects(
    (await slowJson('https://example.test/slow-json')).json(),
    /response_body_timeout/,
  )
})

test('mini-program already-buffered response facades remain compatible without Proxy requirements', async () => {
  const { withTransportDeadlines } = await loadTypeScript('src/api/transportBoundary.ts')
  const facade = {
    status: 200,
    ok: true,
    headers: new Headers({ 'Content-Type': 'application/json' }),
    body: null,
    json: async () => ({ rows: [] }),
    text: async () => '{"rows":[]}',
  }
  const fetcher = withTransportDeadlines(async () => facade, { headerTimeoutMs: 100 })
  const response = await fetcher('https://example.test/mp')
  assert.equal(response, facade)
  assert.deepEqual(await response.json(), { rows: [] })
})

test('bounded JSON rejects declared and chunked oversize bodies plus stalled injected readers', async () => {
  const { readBoundedJson, ResponseBodyBoundaryError } = await loadTypeScript('src/api/responseBody.ts')

  await assert.rejects(
    readBoundedJson(new Response('{}', { headers: { 'Content-Length': '100' } }), { maxBytes: 10 }),
    error => error instanceof ResponseBodyBoundaryError && error.code === 'response_body_too_large',
  )
  await assert.rejects(
    readBoundedJson(new Response(JSON.stringify({ value: 'x'.repeat(100) })), { maxBytes: 20 }),
    error => error instanceof ResponseBodyBoundaryError && error.code === 'response_body_too_large',
  )

  let cancelled = false
  const chunked = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"value":"1234567890'))
      controller.enqueue(new TextEncoder().encode('1234567890"}'))
    },
    cancel() { cancelled = true },
  }))
  await assert.rejects(
    readBoundedJson(chunked, { maxBytes: 20 }),
    error => error instanceof ResponseBodyBoundaryError && error.code === 'response_body_too_large',
  )
  assert.equal(cancelled, true, 'oversized chunked streams must be cancelled before full buffering')

  await assert.rejects(
    readBoundedJson(stalledResponse(), { maxBytes: 100, timeoutMs: 15 }),
    error => error instanceof ResponseBodyBoundaryError && error.code === 'response_body_timeout',
  )
  assert.deepEqual(
    await readBoundedJson(new Response('{"value":"中文"}'), { maxBytes: 64 }),
    { value: '中文' },
  )
})

test('a shorter bounded-reader timeout aborts the shared platform transport', async () => {
  const { withTransportDeadlines } = await loadTypeScript('src/api/transportBoundary.ts')
  const { readBoundedJson, ResponseBodyBoundaryError } = await loadTypeScript('src/api/responseBody.ts')
  let transportSignal
  let cancelledStreams = 0
  const fetcher = withTransportDeadlines(async (_input, init) => {
    transportSignal = init.signal
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"pending":'))
        // Real stalled stream: no close and no remaining JSON bytes.
      },
      cancel() { cancelledStreams += 1 },
    }))
  }, {
    headerTimeoutMs: 100,
    structuredBodyTimeoutMs: 500,
  })

  const response = await fetcher('https://example.test/bounded-timeout')
  await assert.rejects(
    readBoundedJson(response, { maxBytes: 100, timeoutMs: 15 }),
    error => error instanceof ResponseBodyBoundaryError && error.code === 'response_body_timeout',
  )
  assert.equal(transportSignal.aborted, true)
  assert.equal(cancelledStreams, 1)

  const caller = new AbortController()
  const callerResponse = await fetcher('https://example.test/bounded-caller-abort', {
    signal: caller.signal,
  })
  const callerRead = readBoundedJson(callerResponse, { maxBytes: 100, timeoutMs: 500 })
  caller.abort()
  await assert.rejects(
    callerRead,
    error => error?.name === 'AbortError' && error?.message === 'request_aborted',
  )
  assert.equal(cancelledStreams, 2)
})

test('installed Supabase client accepts a deadline-wrapped native Response', async () => {
  const { withTransportDeadlines } = await loadTypeScript('src/api/transportBoundary.ts')
  const calls = []
  const client = createClient('https://project.supabase.co', 'legacy-anon-test', {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: withTransportDeadlines(async (input, init) => {
        calls.push({ input, init })
        return new Response('[]', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }, {
        headerTimeoutMs: 100,
        structuredBodyTimeoutMs: 100,
      }),
    },
  })

  const result = await client.from('profiles').select('id').limit(1)
  assert.equal(result.error, null)
  assert.deepEqual(result.data, [])
  assert.equal(calls.length, 1)
})

test('all first-party small API consumers use bounded body readers', async () => {
  const files = [
    'src/pages/admin/index.vue',
    'src/pages/illini-verify/index.vue',
    'src/composables/useTranslate.ts',
    'src/composables/i18n/translate.ts',
    'src/composables/useRealtimeFallback.ts',
    'src/composables/useWechatSecCheck.ts',
    'src/utils/contentSafety.ts',
    'src/composables/useMeetups.ts',
  ]
  for (const file of files) {
    const source = await readFile(new URL(file, ROOT), 'utf8')
    assert.match(source, /readBounded(?:Json|Text)/, file)
    assert.doesNotMatch(source, /\b[\w.]+\.json\(\)/, file)
  }

  // WeChat login lives inside the auth state machine. Its compatibility parser
  // delegates to the same streaming cap/deadline implementation, so reading
  // response.body directly cannot bypass the platform transport boundary.
  const auth = await readFile(new URL('src/composables/useAuth.ts', ROOT), 'utf8')
  const bounded = await readFile(new URL('src/api/boundedJson.ts', ROOT), 'utf8')
  assert.match(auth, /const res = await platformFetch\(endpoint,/)
  assert.match(auth, /readBoundedJsonResponse/)
  assert.match(bounded, /return await readBoundedJson<T>\(response, \{ maxBytes, timeoutMs \}\)/)
  assert.doesNotMatch(bounded, /body\.getReader\(/)
})
