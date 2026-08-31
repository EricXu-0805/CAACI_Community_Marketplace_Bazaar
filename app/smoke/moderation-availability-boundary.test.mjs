import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const CONTENT_SAFETY_URL = new URL('../src/utils/contentSafety.ts', import.meta.url)

/**
 * remoteModerate gates six write paths — publishing, editing, plaza posts and
 * comments, the profile, and every chat message — and it fails closed, so any
 * failure it reports costs the user their write. The deadline it enforces is
 * much shorter than the endpoint's own: /api/moderate verifies the JWT against
 * Supabase, charges the rate counter and then calls the provider, each with a
 * multi-second budget of its own.
 *
 * Production 2026-08-31 showed what that gap costs. The first real listing was
 * refused with 'moderation_unavailable' at 3.5s; the Vercel log for that same
 * request says 200. The seller retried by hand and it went through.
 *
 * These run the real function against a stubbed transport, so they answer how
 * many requests it makes and when it gives up, rather than how it is spelled.
 */
async function loadContentSafety(stub) {
  globalThis.__MODERATION_STUB__ = stub
  const compiled = ts.transpileModule(
    (await readFile(CONTENT_SAFETY_URL, 'utf8'))
      .replace(/import \{ BASE_URL \} from '\.\.\/config\/runtime'\n/, "const BASE_URL = 'https://stub.invalid'\n")
      .replace(/import \{ readBoundedJson \} from '\.\.\/api\/responseBody'\n/,
        'const readBoundedJson = globalThis.__MODERATION_STUB__.readBoundedJson\n')
      .replace(/import \{\n(?:[^}]*)\} from '\.\.\/composables\/accountScope'\n/,
        'const { captureAccountRequest, getActiveAccountId, isAccountRequestCurrent } = globalThis.__MODERATION_STUB__\n')
      .replace(/await import\('\.\.\/composables\/useSupabase'\)/, 'globalThis.__MODERATION_STUB__'),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } },
  ).outputText
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
}

const ACCOUNT = { userId: 'u-1' }

/** A transport whose per-call behaviour is scripted; records what it received. */
function harness(script) {
  const calls = []
  return {
    calls,
    getActiveAccountId: () => ACCOUNT.userId,
    captureAccountRequest: () => ACCOUNT,
    isAccountRequestCurrent: () => true,
    readBoundedJson: async response => response.__body,
    useSupabase: () => ({
      supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'jwt', user: { id: ACCOUNT.userId } } }, error: null }) } },
    }),
    platformFetch: async (url, init) => {
      const step = script[calls.length]
      calls.push(url)
      if (!step) throw new Error(`unscripted moderation call #${calls.length}`)
      if (step.hang) {
        // Never settles on its own; only the function's own abort ends it.
        return new Promise((_, reject) => {
          init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
        })
      }
      if (step.throws) throw new Error('network down')
      return { ok: step.ok !== false, __body: step.body }
    },
  }
}

const CLEAN = { flagged: false, categories: [] }

test('a moderation call that only overran the deadline is retried once', async () => {
  const stub = harness([{ hang: true }, { body: CLEAN }])
  const { remoteModerate } = await loadContentSafety(stub)
  assert.deepEqual(await remoteModerate('a lamp for sale'), CLEAN)
  assert.equal(stub.calls.length, 2, 'the timed-out request was not retried')
})

test('the retry is bounded to one', async () => {
  const stub = harness([{ hang: true }, { hang: true }])
  const { remoteModerate } = await loadContentSafety(stub)
  await assert.rejects(remoteModerate('a lamp for sale'), /moderation_unavailable/)
  assert.equal(stub.calls.length, 2, 'a second timeout must not start a third attempt')
})

test('an answer from the server is never retried, however unwelcome', async () => {
  // Control for the retry tests above: if they passed by retrying everything,
  // these would make three calls apiece instead of one. 429 in particular is
  // the per-user rate limiter, where asking again is exactly wrong.
  for (const step of [{ ok: false }, { throws: true }, { body: { flagged: 'yes' } }]) {
    const stub = harness([step, { body: CLEAN }, { body: CLEAN }])
    const { remoteModerate } = await loadContentSafety(stub)
    await assert.rejects(remoteModerate('a lamp for sale'), /moderation_unavailable/)
    assert.equal(stub.calls.length, 1, `retried a server answer: ${JSON.stringify(step)}`)
  }
})

test('a verdict that arrives first time costs exactly one request', async () => {
  const flagged = { flagged: true, categories: ['hate'] }
  const stub = harness([{ body: flagged }])
  const { remoteModerate } = await loadContentSafety(stub)
  assert.deepEqual(await remoteModerate('something vile'), flagged)
  assert.equal(stub.calls.length, 1)
})

test('configured remote moderation cannot turn transport or payload failure into allow', async () => {
  const source = await readFile(CONTENT_SAFETY_URL, 'utf8')
  const body = source.match(
    /export async function remoteModerate[\s\S]*?\n}\n\n\/\* ---------- Duplicate-within-session/,
  )?.[0] || ''

  assert.match(body, /const accountToken = expectedAccountToken[\s\S]{0,160}captureAccountRequest\(entryUserId\)/)
  assert.match(
    body,
    /sessionError[\s\S]{0,80}\|\| !jwt[\s\S]{0,100}sess\.session\?\.user\.id !== accountToken\.userId[\s\S]{0,100}!isAccountRequestCurrent\(accountToken\)[\s\S]{0,80}throw new Error\('moderation_unavailable'\)/,
  )
  assert.match(body, /if \(!r\.ok\) throw new Error\('moderation_unavailable'\)/)
  assert.match(body, /j\?\.skipped === true && j\?\.reason === 'no_key'/)
  // A clean verdict may only be returned from the two places that are not a
  // moderation result at all: empty input, and the provider having no key.
  // Any third one is a transport or payload failure being reported as safe.
  // (Spelled as a count because the catch block is now longer than any window
  // a 'no return near catch' regex could span.)
  assert.equal([...body.matchAll(/return \{ flagged: false/g)].length, 2)
  assert.doesNotMatch(body, /text\.slice\(0, 8000\)/)
})
