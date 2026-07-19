import test from 'node:test'
import assert from 'node:assert/strict'
import {
  fetchBounded,
  normalizeStorageObjectUrl,
  normalizeSupabaseOrigin,
} from './http-boundary.mjs'

test('privileged Supabase destinations are strict origins', () => {
  assert.equal(normalizeSupabaseOrigin('https://project.supabase.co/'), 'https://project.supabase.co')
  assert.equal(normalizeSupabaseOrigin('http://127.0.0.1:54321'), 'http://127.0.0.1:54321')
  assert.equal(normalizeSupabaseOrigin('http://localhost:54321/'), 'http://localhost:54321')
  for (const unsafe of [
    'http://project.supabase.co',
    'https://project.supabase.co/rest/v1',
    'https://user:pass@project.supabase.co',
    'https://project.supabase.co?redirect=evil',
    'file:///tmp/database',
  ]) assert.equal(normalizeSupabaseOrigin(unsafe), '', unsafe)
})

test('image backfill accepts only configured Storage object URLs', () => {
  const origin = 'https://project.supabase.co'
  assert.equal(
    normalizeStorageObjectUrl(
      'https://project.supabase.co/storage/v1/object/public/item-images/a/b.jpg',
      origin,
    ),
    'https://project.supabase.co/storage/v1/object/public/item-images/a/b.jpg',
  )
  assert.match(
    normalizeStorageObjectUrl(
      'https://project.supabase.co/storage/v1/object/sign/item-images/a.jpg?token=signed',
      origin,
    ),
    /^https:\/\/project\.supabase\.co\/storage\/v1\/object\/sign\//,
  )
  for (const unsafe of [
    'http://169.254.169.254/latest/meta-data',
    'https://evil.example/storage/v1/object/public/a.jpg',
    'https://project.supabase.co/rest/v1/secrets',
    'https://project.supabase.co/storage/v1/object/public/a.jpg#fragment',
    'file:///etc/passwd',
  ]) assert.equal(normalizeStorageObjectUrl(unsafe, origin), '', unsafe)
})

test('bounded fetch parses small JSON and forces no-store plus redirect rejection', async () => {
  let observedInit
  const result = await fetchBounded(async (_input, init) => {
    observedInit = init
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'content-type': 'application/json', 'content-length': '11' },
    })
  }, 'https://project.supabase.co/rest/v1/test', {}, { maxBytes: 64 })

  assert.deepEqual(await result.json(), { ok: true })
  assert.equal(observedInit.cache, 'no-store')
  assert.equal(observedInit.redirect, 'error')
  assert.ok(observedInit.signal instanceof AbortSignal)
})

test('declared and streamed oversized bodies fail closed and cancel the reader', async () => {
  let declaredCancelled = 0
  const declared = new ReadableStream({
    pull() {},
    cancel() { declaredCancelled += 1 },
  })
  await assert.rejects(
    fetchBounded(
      async () => new Response(declared, { headers: { 'content-length': '65' } }),
      'https://example.test',
      {},
      { maxBytes: 64 },
    ),
    /response_too_large/,
  )
  assert.equal(declaredCancelled, 1)

  let streamedCancelled = 0
  const streamed = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(40))
      controller.enqueue(new Uint8Array(40))
    },
    cancel() { streamedCancelled += 1 },
  })
  await assert.rejects(
    fetchBounded(async () => new Response(streamed), 'https://example.test', {}, { maxBytes: 64 }),
    /response_too_large/,
  )
  assert.equal(streamedCancelled, 1)
})

test('one timeout remains active through a stalled response body', async () => {
  let cancelled = 0
  const fetchImpl = async (_input, init) => {
    let streamController
    const stream = new ReadableStream({
      start(controller) {
        streamController = controller
        controller.enqueue(new TextEncoder().encode('{'))
        init.signal.addEventListener('abort', () => controller.error(init.signal.reason), { once: true })
      },
      cancel() { cancelled += 1 },
    })
    // Retain the variable until the abort listener fires; this mirrors a real
    // fetch body whose transport is owned by the request signal.
    assert.ok(streamController)
    return new Response(stream)
  }

  await assert.rejects(
    fetchBounded(fetchImpl, 'https://example.test', {}, { timeoutMs: 20, maxBytes: 64 }),
    /request_timeout|aborted/i,
  )
  assert.equal(cancelled, 0, 'errored streams close through the abort signal rather than reader.cancel')
})
