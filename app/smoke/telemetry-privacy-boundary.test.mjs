import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import ts from 'typescript'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = (relativePath) => readFileSync(resolve(appRoot, relativePath), 'utf8')

async function loadPrivacyHelpers() {
  const compiled = ts.transpileModule(source('src/utils/telemetryPrivacy.ts'), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
}

async function loadSentryHarness() {
  const captures = []
  const breadcrumbs = []
  let options

  globalThis.__SENTRY_TEST_ENV__ = {
    VITE_SENTRY_DSN: 'https://public@example.ingest.sentry.io/1',
    VITE_DEPLOY_ENV: 'preview',
    VITE_RELEASE: 'test-release',
  }
  globalThis.__SENTRY_STUB__ = {
    init(value) { options = value },
    browserTracingIntegration(value) { return { name: 'BrowserTracing', value } },
    captureException(error, context) { captures.push({ error, context }) },
    addBreadcrumb(crumb) { breadcrumbs.push(crumb) },
  }

  const privacySource = source('src/utils/telemetryPrivacy.ts')
  const sentrySource = source('src/utils/sentry.ts')
    .replace(/import type \{ App \} from 'vue'\n/, '')
    .replace(/import \{[\s\S]*?\} from '\.\/telemetryPrivacy'\n/, '')
    .replace(/import \* as Sentry from '@sentry\/vue'/, 'const Sentry = globalThis.__SENTRY_STUB__')
    .replaceAll('import.meta.env', 'globalThis.__SENTRY_TEST_ENV__')

  const compiled = ts.transpileModule(`${privacySource}\n${sentrySource}`, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  }).outputText
  const mod = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}#${Date.now()}`)
  mod.initSentry({})

  return {
    mod,
    captures,
    breadcrumbs,
    getOptions: () => options,
    cleanup() {
      delete globalThis.__SENTRY_TEST_ENV__
      delete globalThis.__SENTRY_STUB__
    },
  }
}

test('Sentry never starts a pageload trace before auth URL cleanup', () => {
  const sentry = source('src/utils/sentry.ts')
  assert.match(sentry, /browserTracingIntegration\(\{ instrumentPageLoad: false \}\)/)
  assert.match(sentry, /attachProps: false/)
  assert.match(sentry, /beforeBreadcrumb\(breadcrumb\)/)
  assert.match(sentry, /beforeSendTransaction\(event\)/)
  assert.match(sentry, /beforeSendSpan\(span\)/)
  assert.match(sentry, /scrubTelemetryRequest\(event\.request/)
  assert.match(sentry, /event\.spans\?\.forEach\(\(span\) => scrubTelemetrySpan\(span\)\)/)
})

test('public banners open only HTTPS or canonical in-app routes', () => {
  const banner = source('src/components/PlazaBannerCarousel.vue')
  assert.match(banner, /if \(\/\^https:\\\/\\\/\/i\.test\(url\)\)/)
  assert.doesNotMatch(banner, /\^https\?:/)
  assert.match(banner, /!url\.startsWith\('\/pages\/'\)/)
  assert.match(banner, /window\.open\(url, '_blank', 'noopener,noreferrer'\)/)
})

test('transaction and span sanitizers remove recovery tokens and location queries', async () => {
  const privacy = await loadPrivacyHelpers()

  assert.equal(
    privacy.scrubTraceText('GET https://illinimarket.com/#access_token=secret&refresh_token=secret2'),
    'GET https://illinimarket.com/',
  )
  assert.equal(
    privacy.scrubTraceText('GET /api/geocode?lat=40.1106&lon=-88.2073'),
    'GET /api/geocode',
  )

  const request = privacy.scrubTelemetryRequest({
    url: 'https://illinimarket.com/?code=pkce&state=csrf#/pages/reset-password/index',
    query_string: 'code=pkce&state=csrf',
    cookies: { session: 'secret' },
    headers: { authorization: 'Bearer secret' },
    data: { refresh_token: 'secret' },
  })
  assert.equal(request.url, 'https://illinimarket.com/')
  assert.equal('query_string' in request, false)
  assert.equal('cookies' in request, false)
  assert.equal('headers' in request, false)
  assert.equal('data' in request, false)

  const span = privacy.scrubTelemetrySpan({
    description: 'GET /api/geocode?lat=40.1106&lon=-88.2073',
    data: {
      'http.url': 'https://illinimarket.com/api/geocode?lat=40.1106&lon=-88.2073',
      'url.query': 'lat=40.1106&lon=-88.2073',
      authorization: 'Bearer secret',
    },
  })
  assert.equal(span.description, 'GET /api/geocode')
  assert.equal(span.data['http.url'], 'https://illinimarket.com/api/geocode')
  assert.equal(span.data['url.query'], '[redacted]')
  assert.equal(span.data.authorization, '[redacted]')
})

test('Sentry hooks discard UGC and keep only bounded diagnostic fields', async (t) => {
  const harness = await loadSentryHarness()
  t.after(() => harness.cleanup())
  const options = harness.getOptions()
  assert.ok(options)
  assert.equal(options.attachProps, false)
  assert.equal(options.environment, 'preview')

  const chat = 'CHAT_MARKER_9f6a_private_message'
  const listing = 'LISTING_MARKER_9f6a_secret_title'
  const appeal = 'APPEAL_MARKER_9f6a_private_reason'
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJwcml2YXRlLXVzZXIifQ.signature-marker-12345'
  const sensitiveUrl = `https://api.example.com/rest/v1/items?lat=40.1106&lon=-88.2073&q=${listing}&token=${jwt}#${appeal}`

  assert.equal(options.beforeBreadcrumb({
    category: 'console',
    message: chat,
    data: { arguments: [chat, { details: appeal }] },
  }), null)

  const fetchCrumb = options.beforeBreadcrumb({
    category: 'fetch',
    type: 'http',
    data: { method: 'post', status_code: 409, url: sensitiveUrl, body: chat },
  })
  assert.deepEqual(fetchCrumb.data, {
    method: 'POST',
    status_code: 409,
    url: 'https://api.example.com/rest/v1/items',
  })

  const navigationCrumb = options.beforeBreadcrumb({
    category: 'navigation',
    data: {
      from: `https://market.example/search?q=${listing}`,
      to: `https://market.example/appeal?reason=${appeal}#${jwt}`,
    },
  })
  assert.deepEqual(navigationCrumb.data, {
    from: 'https://market.example/search',
    to: 'https://market.example/appeal',
  })

  const event = {
    message: chat,
    user: { id: 'private-user' },
    request: {
      url: sensitiveUrl,
      query_string: `q=${listing}`,
      headers: { authorization: `Bearer ${jwt}` },
      data: { appeal },
    },
    tags: { source: 'chat.send', unsafe: appeal },
    extra: { listing, appeal },
    logentry: { message: chat },
    contexts: {
      vue: { componentName: 'ChatThread', propsData: { chat, listing } },
    },
    exception: {
      values: [{
        type: 'TypeError',
        value: chat,
        stacktrace: {
          frames: [{
            filename: sensitiveUrl,
            abs_path: sensitiveUrl,
            vars: { appeal },
            context_line: listing,
          }],
        },
        mechanism: { type: 'generic', data: { appeal } },
      }],
    },
    breadcrumbs: [
      { category: 'console', message: chat, data: { arguments: [appeal] } },
      { category: 'plaza', message: listing, data: { postId: 'private-id', err: appeal } },
      { category: 'fetch', data: { method: 'GET', status_code: 400, url: sensitiveUrl } },
    ],
  }
  const sanitized = options.beforeSend(event, {})
  const serialized = JSON.stringify(sanitized)
  for (const marker of [chat, listing, appeal, '40.1106', '-88.2073', jwt, '?lat=', '#']) {
    assert.equal(serialized.includes(marker), false, `event leaked ${marker}`)
  }
  assert.equal(sanitized.request.url, 'https://api.example.com/rest/v1/items')
  assert.deepEqual(sanitized.tags, { source: 'chat.send' })
  assert.equal('propsData' in sanitized.contexts.vue, false)
  assert.deepEqual(sanitized.breadcrumbs, [
    { category: 'plaza', message: 'event:plaza' },
    {
      category: 'fetch',
      data: { method: 'GET', status_code: 400, url: 'https://api.example.com/rest/v1/items' },
    },
  ])

  const uniEvent = options.beforeSend({
    exception: { values: [{ type: 'Object', value: appeal }] },
    breadcrumbs: [],
  }, { originalException: { errMsg: `${chat} ${jwt}` } })
  assert.deepEqual(uniEvent.exception, {
    values: [{ type: 'UniAppRejection', value: 'Captured UniAppRejection' }],
  })
  assert.equal(JSON.stringify(uniEvent).includes(chat), false)
  assert.equal(JSON.stringify(uniEvent).includes(jwt), false)
})

test('captureException never forwards provider messages or arbitrary context', async (t) => {
  const harness = await loadSentryHarness()
  t.after(() => harness.cleanup())
  const { mod, captures, breadcrumbs } = harness
  const marker = 'PRIVATE_CHAT_LISTING_APPEAL_MARKER_4d02'
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJwcml2YXRlLXVzZXIifQ.signature-marker-12345'

  mod.captureException({
    name: 'PostgrestError',
    code: '23505',
    message: marker,
    details: `${marker} ${jwt}`,
  }, {
    tags: { source: 'plaza.create', unsafe: marker, orphan_risk: 'true' },
    extra: { body: marker },
    level: 'warning',
  })

  const original = new TypeError(marker)
  original.stack = `TypeError: ${marker}\n    at submit (https://market.example/app.js?q=${marker}&lat=40.1106#${jwt})`
  mod.captureException(original, { tags: { source: 'chat.send' }, level: 'error' })
  mod.addBreadcrumb({
    category: 'plaza',
    message: marker,
    data: { body: marker, location: '40.1106,-88.2073', jwt },
  })

  assert.equal(captures.length, 2)
  assert.equal(captures[0].error.name, 'PostgrestError')
  assert.equal(captures[0].error.message, 'Captured PostgrestError (23505)')
  assert.deepEqual(captures[0].context, {
    tags: {
      source: 'plaza.create',
      error_name: 'PostgrestError',
      error_code: '23505',
      orphan_risk: 'true',
    },
    level: 'warning',
  })
  assert.equal(captures[1].error.name, 'TypeError')
  assert.match(captures[1].error.stack, /at https:\/\/market\.example\/app\.js$/)
  assert.deepEqual(breadcrumbs, [{
    category: 'plaza',
    message: 'event:plaza',
    level: 'info',
  }])

  const serialized = JSON.stringify({
    captures: captures.map(({ error, context }) => ({
      name: error.name,
      message: error.message,
      stack: error.stack,
      context,
    })),
    breadcrumbs,
  })
  for (const secret of [marker, jwt, '40.1106', '-88.2073']) {
    assert.equal(serialized.includes(secret), false, `capture path leaked ${secret}`)
  }
})
