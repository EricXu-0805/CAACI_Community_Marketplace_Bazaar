import assert from 'node:assert/strict'
import test from 'node:test'

import { isAllowedDevRequest, localDevServerBoundary } from '../dev-server-boundary.mjs'

function request(url = '/', headers = {}) {
  return { url, headers: { host: '127.0.0.1:4173', ...headers } }
}

test('allows loopback navigation and same-origin Vite requests', () => {
  assert.equal(isAllowedDevRequest(request()), true)
  assert.equal(isAllowedDevRequest(request('/src/main.ts', {
    origin: 'http://127.0.0.1:4173',
    referer: 'http://127.0.0.1:4173/',
    'sec-fetch-site': 'same-origin',
  })), true)
})

test('rejects non-loopback hosts and cross-site browser requests', () => {
  assert.equal(isAllowedDevRequest(request('/', { host: '192.168.1.10:4173' })), false)
  assert.equal(isAllowedDevRequest(request('/', {
    origin: 'https://attacker.example',
  })), false)
  assert.equal(isAllowedDevRequest(request('/', {
    referer: 'https://attacker.example/page',
  })), false)
  assert.equal(isAllowedDevRequest(request('/', {
    'sec-fetch-site': 'cross-site',
  })), false)
})

test('rejects malformed authority and cross-port loopback origins', () => {
  assert.equal(isAllowedDevRequest(request('/', { host: 'localhost.evil.test:4173' })), false)
  assert.equal(isAllowedDevRequest(request('/', {
    origin: 'http://127.0.0.1:5173',
  })), false)
  assert.equal(isAllowedDevRequest(request('/', {
    origin: 'not a url',
  })), false)
})

test('disables Vite launch-editor even for same-origin callers', () => {
  assert.equal(isAllowedDevRequest(request('/__open-in-editor?file=src/App.vue')), false)
  assert.equal(isAllowedDevRequest(request('/__OPEN-IN-EDITOR/file')), false)
})

test('plugin fails closed with a no-store 403 before Vite middleware', () => {
  const middleware = []
  localDevServerBoundary().configureServer({
    middlewares: { use(fn) { middleware.push(fn) } },
  })
  assert.equal(middleware.length, 1)

  const headers = new Map()
  let statusCode = 0
  let body = ''
  let nextCalled = false
  middleware[0](
    request('/', { origin: 'https://attacker.example' }),
    {
      set statusCode(value) { statusCode = value },
      get statusCode() { return statusCode },
      setHeader(name, value) { headers.set(name.toLowerCase(), value) },
      end(value) { body = value },
    },
    () => { nextCalled = true },
  )

  assert.equal(statusCode, 403)
  assert.equal(headers.get('cache-control'), 'no-store')
  assert.equal(body, 'Forbidden')
  assert.equal(nextCalled, false)
})
