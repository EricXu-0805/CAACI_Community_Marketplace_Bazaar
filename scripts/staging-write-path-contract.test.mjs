import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

import {
  ACCEPTED_TITLE,
  assertSafeTarget,
  FOREIGN_OWNER,
  FORBIDDEN_ENV_KEYS,
  KNOWN_PRODUCTION_PROJECT_REFS,
  main,
  MEDIA_BUCKET,
  mediaObjectName,
  moderationRefusal,
  OBJECT_PREFIX,
  publicMediaUrl,
  REFUSED_TITLE,
  TITLE_PREFIX,
  uniqueTitles,
} from './verify-staging-write-path.mjs'

/**
 * The live half of this check needs a database and a session. What can be wrong
 * without either is tested here: where it agrees to write, and what it will
 * accept as proof that the moderation gate is still shut.
 *
 * The failure that matters is not "it says no". It is a check that writes to
 * the wrong database, or one that reads any rejection as "the gate works".
 * Every assertion below has a partner showing it can still go the other way.
 */

const STAGING = 'hygkwxugskijadgfisji'

const validEnv = (over = {}) => ({
  SUPABASE_URL: `https://${STAGING}.supabase.co`,
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  SMOKE_EXPECTED_SUPABASE_PROJECT_REF: STAGING,
  SMOKE_ACCOUNT_IS_SYNTHETIC: 'true',
  SMOKE_DATASET_IS_SYNTHETIC: 'true',
  SMOKE_EMAIL: 'synthetic@example.invalid',
  SMOKE_PASSWORD: 'not-a-real-password',
  ...over,
})

test('a reviewed synthetic staging target is accepted', () => {
  const target = assertSafeTarget(validEnv())
  assert.equal(target.ref, STAGING)
  assert.equal(target.url, `https://${STAGING}.supabase.co`)
})

test('a production ref is refused even when every other value agrees with it', () => {
  const prod = [...KNOWN_PRODUCTION_PROJECT_REFS][0]
  // Deliberately self-consistent: url matches the ref, both attestations say
  // synthetic. Only the independent deny stands between this and production.
  assert.throws(() => assertSafeTarget(validEnv({
    SUPABASE_URL: `https://${prod}.supabase.co`,
    SMOKE_EXPECTED_SUPABASE_PROJECT_REF: prod,
  })), /production project/)
})

test('a privileged key anywhere in the environment is refused', () => {
  for (const key of FORBIDDEN_ENV_KEYS) {
    assert.throws(() => assertSafeTarget(validEnv({ [key]: 'anything' })),
      new RegExp(key), `${key} must stop the run`)
  }
  // Control: the same environment without it is fine, so the check above is
  // reacting to the key rather than refusing everything.
  assert.ok(assertSafeTarget(validEnv()))
})

test('the url must actually be the reviewed ref, not merely a valid-looking one', () => {
  assert.throws(() => assertSafeTarget(validEnv({
    SUPABASE_URL: 'https://someotherproject00.supabase.co',
  })), /does not match/)
})

test('a missing synthetic attestation stops the run', () => {
  assert.throws(() => assertSafeTarget(validEnv({ SMOKE_DATASET_IS_SYNTHETIC: 'false' })),
    /synthetic/)
  assert.throws(() => assertSafeTarget(validEnv({ SMOKE_ACCOUNT_IS_SYNTHETIC: undefined })),
    /synthetic/)
})

test('credentials and a public key are required', () => {
  assert.throws(() => assertSafeTarget(validEnv({ SMOKE_PASSWORD: undefined })), /SMOKE_/)
  assert.throws(() => assertSafeTarget(validEnv({ SUPABASE_PUBLISHABLE_KEY: undefined })),
    /public Supabase key/)
})

test('only the moderation sentinel counts as the gate refusing', () => {
  assert.deepEqual(
    moderationRefusal(400, { message: 'moderation_block:sensitive_word' }),
    { status: 400, category: 'sensitive_word' },
  )
  // The shape private.assert_moderated_text actually raises: field first.
  assert.deepEqual(
    moderationRefusal(400, { message: 'moderation_block:item_title:sensitive_word' }),
    { status: 400, category: 'item_title:sensitive_word' },
  )

  // The failures that must NOT be mistaken for a working gate. Each of these is
  // a real way the insert can fail while moderation is gone.
  for (const body of [
    { message: 'new row violates row-level security policy for table "items"' },
    { message: 'rate_limit_items_hour' },
    { message: 'duplicate_item' },
    { message: 'permission denied for table items' },
    {},
    null,
  ]) {
    assert.equal(moderationRefusal(400, body), null,
      `"${body?.message ?? body}" is not the moderation gate refusing`)
  }
})

test('the accepted title is the sentence production actually refused', () => {
  // If someone softens this to a neutral string, the check stops being a
  // regression guard on the separator-stripped matcher (20260818162716) and
  // becomes a generic smoke test.
  assert.match(ACCEPTED_TITLE, /Selling my TV, Xbox and a desk$/)
  assert.ok(ACCEPTED_TITLE.startsWith(TITLE_PREFIX))
  assert.ok(REFUSED_TITLE.startsWith(TITLE_PREFIX),
    'both titles must carry the prefix or the stray sweep cannot find them')
})

test('the refused title is a term the lexicon migration actually seeds', async () => {
  // Without this the probe is a sentence somebody believed was blocked. It was
  // 'add me on wechat' until 2026-09-03, when contact details became
  // publishable and that title started sailing through — which would have left
  // the control green against a database with no moderation trigger at all.
  //
  // Verbatim containment, not a JS copy of the matcher: content_moderation_check
  // matches a long keyword as a substring of text whose separators have been
  // stripped, which is strictly more permissive than this, so a keyword found
  // here is one the trigger finds too.
  const lexicon = await readFile(
    new URL('../supabase/migrations/025_content_moderation_lexicon.sql', import.meta.url), 'utf8')
  const seeded = [...lexicon.matchAll(/^ {2}\('([^']+)', 'lexicon'/gm)].map(m => m[1])
  assert.ok(seeded.length >= 100, `parsed only ${seeded.length} keywords — the scan stopped reading`)

  const probe = REFUSED_TITLE.slice(TITLE_PREFIX.length).toLowerCase()
  const hits = seeded.filter(word => word.length >= 5 && probe.includes(word))
  assert.notDeepEqual(hits, [],
    `${JSON.stringify(REFUSED_TITLE)} carries no seeded keyword, so nothing says the database `
    + 'still refuses it')

  // Control: the prefix every row carries must not be what matched, or the
  // accepted title would be refused too and the whole check would be moot.
  const prefix = TITLE_PREFIX.toLowerCase()
  assert.deepEqual(seeded.filter(word => word.length >= 5 && prefix.includes(word)), [])
})

test('each run uses titles no earlier run used', () => {
  const a = uniqueTitles('1756400000000')
  const b = uniqueTitles('1756400000001')
  assert.notEqual(a.accepted, b.accepted)
  assert.notEqual(a.refused, b.refused)
  // The rate limiter rejects a repeated title within 60 seconds, so a fixed
  // title would fail the second run of any busy hour.
  assert.ok(a.accepted.startsWith(ACCEPTED_TITLE))
  assert.ok(a.refused.startsWith(REFUSED_TITLE))
  assert.notEqual(a.accepted, a.refused)
})

/* ------------------------------------------- the sequence, against a stub */

/**
 * The live steps only ever run on main — the protected-account job is skipped
 * on pull requests — so without this they would ship unexecuted. That is how a
 * `process.exit()` inside the try block once skipped the finally and left a
 * listing behind on staging: nothing had run the cleanup path.
 *
 * What this pins is the sequence and, above all, that the cleanup runs when a
 * later step fails. It cannot say anything about the real database; that is
 * what the run on main is for.
 */

const USER_ID = '11111111-2222-4333-8444-555555555555'
const URL_BASE = `https://${STAGING}.supabase.co`

function stubServer(over = {}) {
  const calls = []
  const behavior = {
    upload: { status: 200, body: { Key: 'ok' } },
    publicRead: { status: 200, contentType: 'image/png' },
    foreignUpload: { status: 403, body: { message: 'new row violates row-level security policy' } },
    insertAccepted: { status: 201, body: [{ id: 'created-row-id' }] },
    insertRefused: { status: 400, body: { message: 'moderation_block:item_title:sensitive_word' } },
    deleteRow: { status: 200, body: [{ id: 'created-row-id' }] },
    deleteObject: { status: 200, body: {} },
    ...over,
  }

  const reply = (spec) => new Response(
    spec.contentType ? 'binary' : JSON.stringify(spec.body ?? {}),
    { status: spec.status, headers: { 'content-type': spec.contentType || 'application/json' } },
  )

  const fetchStub = async (input, init = {}) => {
    const url = String(input)
    const method = (init.method || 'GET').toUpperCase()
    const path = url.slice(URL_BASE.length)
    calls.push(`${method} ${path.split('?')[0]}`)

    if (path.startsWith('/auth/v1/token')) {
      return reply({ status: 200, body: { access_token: 'stub-token', user: { id: USER_ID } } })
    }
    if (path.startsWith('/auth/v1/logout')) return reply({ status: 204 })
    if (path.startsWith(`/storage/v1/object/list/${MEDIA_BUCKET}`)) {
      return reply({ status: 200, body: [] })
    }
    if (path.startsWith(`/storage/v1/object/public/${MEDIA_BUCKET}/`)) {
      return reply(behavior.publicRead)
    }
    if (path.startsWith(`/storage/v1/object/${MEDIA_BUCKET}/`)) {
      if (method === 'DELETE') return reply(behavior.deleteObject)
      return reply(path.includes(FOREIGN_OWNER) ? behavior.foreignUpload : behavior.upload)
    }
    if (path.startsWith('/rest/v1/items')) {
      if (method === 'DELETE') return reply(behavior.deleteRow)
      const payload = JSON.parse(init.body)
      return reply(payload.title.startsWith(`${ACCEPTED_TITLE} `)
        ? behavior.insertAccepted
        : behavior.insertRefused)
    }
    throw new Error(`the check called an endpoint the stub does not model: ${method} ${path}`)
  }

  return { calls, fetchStub }
}

async function runAgainst(stub) {
  const realFetch = globalThis.fetch
  const realEnv = { ...process.env }
  const silenced = { log: console.log, warn: console.warn, error: console.error }
  globalThis.fetch = stub.fetchStub
  Object.assign(process.env, validEnv())
  delete process.env.SMOKE_EXPECTED_USER_ID
  console.log = () => {}
  console.warn = () => {}
  console.error = () => {}
  try {
    await main()
    return null
  } catch (error) {
    return error
  } finally {
    globalThis.fetch = realFetch
    Object.assign(console, silenced)
    for (const key of Object.keys(process.env)) {
      if (!(key in realEnv)) delete process.env[key]
    }
    Object.assign(process.env, realEnv)
  }
}

test('a healthy database publishes a listing with a photo and leaves nothing behind', async () => {
  const stub = stubServer()
  assert.equal(await runAgainst(stub), null)

  const objectPath = `/storage/v1/object/${MEDIA_BUCKET}/items/${USER_ID}/`
  assert.ok(stub.calls.includes(`POST /storage/v1/object/list/${MEDIA_BUCKET}`),
    'stale objects from a killed run were never swept')
  assert.ok(stub.calls.some(c => c.startsWith(`POST ${objectPath}`)), 'no photo was uploaded')
  assert.ok(stub.calls.some(c => c.startsWith(`GET /storage/v1/object/public/${MEDIA_BUCKET}/`)),
    'the photo was never read back the way a share card reads it')
  assert.ok(stub.calls.some(c => c.includes(FOREIGN_OWNER)),
    "no upload into another user's folder was attempted, so nothing keeps the first one honest")
  assert.ok(stub.calls.some(c => c.startsWith(`DELETE ${objectPath}`)), 'the photo was left behind')
  assert.ok(stub.calls.some(c => c.startsWith('DELETE /rest/v1/items')), 'the listing was left behind')
  assert.ok(stub.calls.at(-1).startsWith('POST /auth/v1/logout'), 'the session was left open')
})

test('the listing carries the photo it just uploaded', async () => {
  let published = null
  const stub = stubServer()
  const inner = stub.fetchStub
  stub.fetchStub = async (input, init = {}) => {
    if (String(input).endsWith('/rest/v1/items') && (init.method || '') === 'POST') {
      const payload = JSON.parse(init.body)
      if (payload.title.startsWith(`${ACCEPTED_TITLE} `)) published = payload
    }
    return inner(input, init)
  }
  assert.equal(await runAgainst(stub), null)

  assert.equal(published.images.length, 1)
  assert.match(published.images[0],
    new RegExp(`^${URL_BASE}/storage/v1/object/public/${MEDIA_BUCKET}/items/${USER_ID}/`),
    'the URL is not the canonical public shape local_item_media_object_name parses')
  assert.deepEqual(published.image_dimensions, [{ w: 1, h: 1 }],
    'assert_image_dimensions wants exactly one entry per image')
})

test('a refused upload stops the run before any listing is created', async () => {
  const stub = stubServer({ upload: { status: 403, body: { message: 'row-level security' } } })
  const error = await runAgainst(stub)
  assert.match(error.message, /Nobody can attach a photo/)
  assert.equal(stub.calls.some(c => c === 'POST /rest/v1/items'), false,
    'it published a listing even though the photo never uploaded')
})

test('a photo that is not publicly readable fails the run', async () => {
  const stub = stubServer({ publicRead: { status: 400, contentType: 'application/json' } })
  const error = await runAgainst(stub)
  assert.match(error.message, /not publicly readable/)
})

test("an upload into another user's folder that succeeds fails the run", async () => {
  const stub = stubServer({ foreignUpload: { status: 200, body: { Key: 'ok' } } })
  const error = await runAgainst(stub)
  assert.match(error.message, /accepted an upload into/)
  assert.ok(stub.calls.some(c => c.startsWith('DELETE') && c.includes(FOREIGN_OWNER)),
    'the object it should never have been able to write was not cleaned up')
})

test('the photo and the listing are removed even when a later step fails', async () => {
  // The gate is gone: the blocklisted term is accepted. Everything before it
  // succeeded, so the run has a row and an object to clean up while failing.
  const stub = stubServer({ insertRefused: { status: 201, body: [{ id: 'unmoderated-row-id' }] } })
  const error = await runAgainst(stub)
  assert.match(error.message, /A blocklisted term is no longer refused/)
  assert.ok(stub.calls.some(c => c.startsWith(`DELETE /storage/v1/object/${MEDIA_BUCKET}/items/${USER_ID}/`)),
    'the photo survived a failing run')
  assert.ok(stub.calls.some(c => c.startsWith('DELETE /rest/v1/items')),
    'the listing survived a failing run')
  assert.ok(stub.calls.at(-1).startsWith('POST /auth/v1/logout'),
    'the session survived a failing run')
})

test('a refusal from some other moderation rule does not count as the lexicon working', async () => {
  // The probe is a blocklisted term. If the gate answers with a different
  // category, some earlier branch caught it and the keyword lexicon — the only
  // thing this probe can speak for — went untested.
  const stub = stubServer({
    insertRefused: { status: 400, body: { message: 'moderation_block:item_title:contact_info' } },
  })
  const error = await runAgainst(stub)
  assert.match(error.message, /not the lexicon branch this probe aims at/)
})

test('the object name and public URL are the shapes the database parses', () => {
  const name = mediaObjectName(USER_ID, '1756500000000')
  assert.equal(name, `items/${USER_ID}/${OBJECT_PREFIX}1756500000000.png`)
  // private.local_item_media_object_name accepts only [A-Za-z0-9._/-] after the
  // owner prefix, and no query string or fragment anywhere.
  assert.match(name.split('/').at(-1), /^[A-Za-z0-9][A-Za-z0-9._-]*$/)
  const url = publicMediaUrl(URL_BASE, name)
  assert.equal(url, `${URL_BASE}/storage/v1/object/public/${MEDIA_BUCKET}/${name}`)
  assert.equal(url.includes('?'), false)
  assert.equal(url.includes('#'), false)
})
