import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = (relativePath) => readFileSync(resolve(appRoot, relativePath), 'utf8')

/*
 * Realtime degrading to polling is silent on purpose — the feature keeps
 * working, so nobody notices. That is fine for users and useless for
 * operations: production logged 76 user-topic Unauthorized events in 24 hours
 * with no fallback at all, and the only reason anyone knew was a manual log
 * read. These assertions keep the takeover reportable.
 */

test('every sticky transport declares which surface it is', () => {
  const fallback = source('src/composables/useRealtimeFallback.ts')
  const calls = [...fallback.matchAll(/startStickyTransport<[^>]*>\(\{\n(\s*)([^\n]*)/g)]
  assert.ok(calls.length >= 6, `expected the known transports, found ${calls.length}`)
  for (const [, , firstProperty] of calls) {
    assert.match(
      firstProperty,
      /telemetryScope: '(conversation|notifications|inbox|snapshot)',/,
      'a transport without a scope reports as an unattributable takeover',
    )
  }
})

test('the handoff reports before it swaps transports', () => {
  const fallback = source('src/composables/useRealtimeFallback.ts')
  const handoff = fallback.slice(
    fallback.indexOf('const switchToFallback'),
    fallback.indexOf('activeUnsubscribe = options.startPrimary'),
  )
  assert.match(handoff, /captureException\(new Error\('realtime_fallback_takeover'\)/)
  assert.match(handoff, /source: `realtime\.fallback\.\$\{options\.telemetryScope\}`/)

  // Reporting must sit after the `switched` latch. Before it, a flapping
  // connection would emit one event per flap instead of one per subscription.
  const latchAt = handoff.indexOf('switched = true')
  const reportAt = handoff.indexOf('captureException(')
  assert.ok(latchAt >= 0 && reportAt > latchAt, 'report must follow the sticky latch')
})

test('the scope survives Sentry beforeSend', () => {
  // beforeSend rebuilds event.tags from an allowlist. `source` is the only
  // field carrying the scope, so dropping it there would silence the alert
  // without touching this file.
  const sentry = source('src/utils/sentry.ts')
  assert.match(sentry, /const source = stableToken\(tags\.source/)
  assert.match(sentry, /if \(source\) clean\.source = source/)
  // stableToken rejects anything outside this shape; `realtime.fallback.inbox`
  // has to survive it or the tag silently becomes 'application'.
  assert.match(sentry, /\^\[A-Za-z0-9\]\[A-Za-z0-9\._:-\]\*\$/)
})
