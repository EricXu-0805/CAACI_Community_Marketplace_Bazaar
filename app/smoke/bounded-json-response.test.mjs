import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

async function loadBoundedJson() {
  const responseBodySource = readFileSync(resolve(appRoot, 'src/api/responseBody.ts'), 'utf8')
  const responseBodyCompiled = ts.transpileModule(responseBodySource, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  }).outputText
  const responseBodyUrl = `data:text/javascript;base64,${Buffer.from(responseBodyCompiled).toString('base64')}`
  const source = readFileSync(resolve(appRoot, 'src/api/boundedJson.ts'), 'utf8')
    .replace("'./responseBody'", `'${responseBodyUrl}'`)
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
}

test('bounded JSON accepts a normal small response', async () => {
  const bounded = await loadBoundedJson()
  const response = new Response(JSON.stringify({ access_token: 'token' }), {
    headers: { 'Content-Type': 'application/json' },
  })
  assert.deepEqual(
    await bounded.readBoundedJsonResponse(response, 1024),
    { access_token: 'token' },
  )
})

test('bounded JSON rejects declared and streamed oversized bodies before parse', async () => {
  const bounded = await loadBoundedJson()
  const declared = new Response('{}', { headers: { 'Content-Length': '4096' } })
  await assert.rejects(
    bounded.readBoundedJsonResponse(declared, 128),
    error => error?.code === 'response_body_too_large',
  )

  const streamed = new Response(JSON.stringify({ value: 'x'.repeat(4096) }))
  await assert.rejects(
    bounded.readBoundedJsonResponse(streamed, 128),
    error => error?.code === 'response_body_too_large',
  )
})

test('bounded JSON rejects and cancels a real never-ending stream on deadline', async () => {
  const bounded = await loadBoundedJson()
  let cancelled = false
  const response = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"pending":'))
      // Deliberately never close or enqueue a complete JSON document.
    },
    cancel() { cancelled = true },
  }))

  await assert.rejects(
    bounded.readBoundedJsonResponse(response, 1024, 15),
    error => error?.code === 'response_body_timeout',
  )
  assert.equal(cancelled, true)
})

test('WeChat login uses the bounded parser for both success and error payloads', () => {
  const source = readFileSync(resolve(appRoot, 'src/composables/useAuth.ts'), 'utf8')
  const start = source.indexOf('async function signInWithWeChat(')
  const end = source.indexOf('\n  async function signOut(', start)
  const block = source.slice(start, end)
  assert.ok(start >= 0 && end > start)
  assert.equal((block.match(/readBoundedJsonResponse</g) || []).length, 2)
  assert.doesNotMatch(block, /res\.json\(/)
})
