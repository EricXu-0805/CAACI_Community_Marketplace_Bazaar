import assert from 'node:assert/strict'
import test from 'node:test'

import {
  classify,
  clientRpcCalls,
  extractRpcCalls,
  mergeCalls,
  probeRpc,
  resolveSpread,
  scanIsMeaningless,
} from './verify-deployed-rpcs.mjs'

/** Answers PostgREST's status codes without a network. */
function stubFetch(statusByName) {
  const seen = []
  const impl = async (url, init) => {
    const name = url.slice(url.lastIndexOf('/') + 1)
    seen.push({ name, body: JSON.parse(init.body), prefer: init.headers.Prefer })
    const status = statusByName[name]
    if (status === 'throw') throw new Error('ECONNREFUSED')
    return { status: status ?? 404 }
  }
  return { impl, seen }
}

const call = (name, args = [], partial = false, file = 'app/src/x.ts') =>
  ({ name, args: new Set(args), partial, file, files: [file] })

/**
 * The live half of this check needs a database, so the parts that can be wrong
 * on their own are tested here: reading the client's calls, reading PostgREST's
 * document, and deciding what counts as a gap.
 *
 * The failure this guards against is not "the checker says no" — it is a
 * checker that says yes because it learned nothing. Every assertion below has
 * a partner that proves the thing can still go red.
 */

test('an argument object is read to its own closing brace, not the first one', () => {
  const [call] = extractRpcCalls(`
    await supabase.rpc('propose_meetup', {
      p_conversation_id: conversationId,
      p_meet_at: meetAt,
      expected_user_id_in: accountToken.userId,
      p_note: note ?? null,
    })
  `)
  assert.equal(call.name, 'propose_meetup')
  assert.deepEqual([...call.args].sort(),
    ['expected_user_id_in', 'p_conversation_id', 'p_meet_at', 'p_note'])
  assert.equal(call.partial, false)
})

test('a nested object does not end the argument list early', () => {
  const [call] = extractRpcCalls(`
    supabase.rpc('mark_onboarded', {
      nickname_in: form.nickname,
      avatar_in: { url: avatar, meta: { w: 1, h: 2 } },
      campus_in: campus,
    })
  `)
  assert.deepEqual([...call.args].sort(), ['avatar_in', 'campus_in', 'nickname_in'])
  assert.equal(call.partial, false, 'the nested keys w/h/url must not be read as arguments')
  assert.ok(!call.args.has('url') && !call.args.has('meta'))
})

test('a spread marks the call partial so its arguments are a subset, never the whole set', () => {
  const [call] = extractRpcCalls(`
    supabase.rpc('search_items_fuzzy', {
      ...commonLegacyArgs(params),
      limit_in: pageSize,
      offset_in: page * pageSize,
    })
  `)
  assert.equal(call.partial, true)
  assert.deepEqual([...call.args].sort(), ['limit_in', 'offset_in'])
})

test('an RPC called with no arguments is still probed, with an empty body', async () => {
  const [parsed] = extractRpcCalls("supabase.rpc('get_my_profile').abortSignal(signal)")
  assert.equal(parsed.name, 'get_my_profile')
  assert.equal(parsed.args.size, 0)

  const stub = stubFetch({ get_my_profile: 404 })
  const merged = mergeCalls([parsed])
  const results = new Map([['get_my_profile', await probeRpc('https://x.invalid', 'k', merged[0], stub.impl)]])
  assert.deepEqual(stub.seen[0].body, {}, 'a no-argument call must still be posted')
  assert.deepEqual(classify(merged, results).missing.map(c => c.name), ['get_my_profile'])
})

test('the exact gap that has been red on main since 2026-08-16 is reported by name', async () => {
  const calls = extractRpcCalls("supabase.rpc('set_my_email_language', { p_lang: next })",
    'app/src/composables/useI18n.ts')
  const merged = mergeCalls(calls)

  const staging = stubFetch({ set_my_email_language: 404 })
  const results = new Map([['set_my_email_language',
    await probeRpc('https://staging.invalid', 'k', merged[0], staging.impl)]])
  const gap = classify(merged, results)
  assert.deepEqual(gap.missing.map(m => m.name), ['set_my_email_language'])
  assert.deepEqual(gap.missing[0].files, ['app/src/composables/useI18n.ts'])

  // Control: the same input against a database that has it (401 = exists but
  // anon may not call it) is clean, so the assertion above reports the gap
  // rather than always objecting.
  const prod = stubFetch({ set_my_email_language: 401 })
  const ok = classify(merged, new Map([['set_my_email_language',
    await probeRpc('https://prod.invalid', 'k', merged[0], prod.impl)]]))
  assert.deepEqual(ok.missing, [])
  assert.equal(ok.present, 1)
})

test('every status that is not 404 counts as present', async () => {
  for (const status of [200, 400, 401, 403, 409, 500]) {
    const stub = stubFetch({ f: status })
    const result = await probeRpc('https://x.invalid', 'k', call('f'), stub.impl)
    assert.equal(result.status, 'present', `HTTP ${status} must not read as missing`)
  }
  const stub = stubFetch({ f: 404 })
  assert.equal((await probeRpc('https://x.invalid', 'k', call('f'), stub.impl)).status, 'missing')
})

test('the probe posts the argument names as nulls and asks for a rollback', async () => {
  const stub = stubFetch({ record_consent: 401 })
  await probeRpc('https://x.invalid/', 'k', call('record_consent', ['version_in', 'expected_user_id_in']), stub.impl)
  assert.deepEqual(stub.seen[0].body, { version_in: null, expected_user_id_in: null })
  assert.equal(stub.seen[0].prefer, 'tx=rollback')
})

test('a network fault is never reported as a schema gap', async () => {
  const stub = stubFetch({ f: 'throw' })
  const result = await probeRpc('https://x.invalid', 'k', call('f'), stub.impl)
  assert.equal(result.status, 'unreachable')
  const merged = [call('f')]
  const classified = classify(merged, new Map([['f', result]]))
  assert.deepEqual(classified.missing, [])
  assert.equal(classified.unreachable.length, 1)
  // And a run that reached nothing must not pass as agreement.
  assert.match(scanIsMeaningless(merged, classified), /nothing was learned/)
})

test('a spread call that 404s is unverified, not missing', () => {
  const merged = [call('search_items_fuzzy', ['limit_in'], true)]
  const classified = classify(merged, new Map([['search_items_fuzzy', { status: 'missing', detail: 'HTTP 404' }]]))
  assert.deepEqual(classified.missing, [], 'an unreadable argument list must not be called a gap')
  assert.deepEqual(classified.unverified.map(c => c.name), ['search_items_fuzzy'])

  // Control: the identical result on a call the scan CAN read is a gap.
  const readable = [call('search_items_fuzzy', ['limit_in'], false)]
  assert.deepEqual(
    classify(readable, new Map([['search_items_fuzzy', { status: 'missing', detail: 'HTTP 404' }]])).missing.map(c => c.name),
    ['search_items_fuzzy'],
  )
})

test('a renamed argument is caught, because PostgREST resolves on the argument set', async () => {
  // Verified against production 2026-08-27: set_my_email_language answers 401
  // for { p_lang } and 404 for { not_a_real_param }.
  const stub = stubFetch({ set_my_email_language: 404 })
  const merged = [call('set_my_email_language', ['p_lang_renamed'])]
  const results = new Map([['set_my_email_language',
    await probeRpc('https://x.invalid', 'k', merged[0], stub.impl)]])
  assert.deepEqual(classify(merged, results).missing.map(c => c.name), ['set_my_email_language'])
})

test('the real client source parses, and every call names a function', async () => {
  const calls = await clientRpcCalls()
  assert.ok(calls.length >= 20, `expected the app's rpc calls, found ${calls.length}`)
  const names = new Set(calls.map(c => c.name))
  for (const expected of ['get_my_profile', 'record_consent', 'make_offer', 'set_my_email_language']) {
    assert.ok(names.has(expected), `${expected} is called by the app but the scan missed it`)
  }
  for (const call of calls) {
    assert.match(call.name, /^[a-z][a-z0-9_]*$/)
    assert.ok(call.file, 'every call must carry the file that makes it, for the failure message')
  }
})

/* The scan that these two guard was line-based at first, which silently kept
   only the first key on a line — the shape most .rpc() calls in this app use
   for their short argument lists. */
test('every key on a single line is read, not just the first', () => {
  const [call] = extractRpcCalls("supabase.rpc('respond_to_offer', { p_offer_id: id, p_action: 'accept', expected_user_id_in: u })")
  assert.deepEqual([...call.args].sort(), ['expected_user_id_in', 'p_action', 'p_offer_id'])
})

test('a comma inside a call or a string does not split an entry', () => {
  const [call] = extractRpcCalls(`
    supabase.rpc('submit_appeal', {
      note_in: buildNote(a, b),
      label_in: 'one, two',
      expected_user_id_in: u,
    })
  `)
  assert.deepEqual([...call.args].sort(), ['expected_user_id_in', 'label_in', 'note_in'])
})

/* The anti-blindness contract, stated where a test can reach it. Without these
   two, a broken scan and a broken document both read as "everything matches". */
test('a scan that learned nothing refuses to call it agreement', () => {
  const merged = [call('get_my_profile')]
  const reached = classify(merged, new Map([['get_my_profile', { status: 'present', detail: 'HTTP 200' }]]))
  assert.match(scanIsMeaningless([], reached), /scan is broken, not the database/)
  // Control: a run that did reach the database is meaningful, so the emptiness
  // checks above are detecting emptiness rather than always objecting.
  assert.equal(scanIsMeaningless(merged, reached), null)
})


/*
 * search_items_fuzzy hid seven of its eleven arguments behind
 * `...commonLegacyArgs(params)`, so this checker could only report it as
 * unverified — leaving the app's search as the one RPC nothing speaks for. The
 * browser sweep opens /search and never types, so it is not covered there
 * either.
 *
 * The helper is a local function whose whole body is `return { … }` of plain
 * keys, which can be read with certainty. Anything less certain stays partial:
 * a guessed argument set produces exactly the false 404 that would make this
 * checker cry wolf.
 */

test('a spread of a local literal-returning helper is resolved, not guessed', () => {
  const source = `
    function commonLegacyArgs(params) {
      return {
        terms_in: params.terms,
        category_in: params.category ?? null,
        listing_type_in: params.listingType ?? null,
      }
    }
    await supabase.rpc('search_items_fuzzy', {
      ...commonLegacyArgs(params),
      limit_in: limit,
      offset_in: offset,
    })
  `
  const [call] = extractRpcCalls(source)
  assert.equal(call.partial, false, 'the arguments are all known, so nothing is a subset')
  assert.deepEqual([...call.args].sort(),
    ['category_in', 'limit_in', 'listing_type_in', 'offset_in', 'terms_in'])
})

test('anything less than certain stays partial rather than being guessed', () => {
  const cases = {
    'the helper is not in this file': `
      supabase.rpc('f', { ...importedArgs(params), limit_in: 1 })`,
    'the helper spreads something itself': `
      function build(p) { return { ...base(p), a_in: p.a } }
      supabase.rpc('f', { ...build(params), limit_in: 1 })`,
    'the helper has a computed key': `
      function build(p) { return { [dynamic]: 1, a_in: p.a } }
      supabase.rpc('f', { ...build(params), limit_in: 1 })`,
    'the helper does not return an object': `
      function build(p) { return p.everything }
      supabase.rpc('f', { ...build(params), limit_in: 1 })`,
  }
  for (const [why, source] of Object.entries(cases)) {
    const [call] = extractRpcCalls(source)
    assert.equal(call.partial, true, `should stay partial when ${why}`)
    assert.ok(call.args.has('limit_in'), 'the readable keys are still collected')
  }

  // Control: the resolvable shape from the test above is NOT partial, so the
  // assertions here are reacting to the difference rather than to everything.
  const [resolvable] = extractRpcCalls(`
    function build(p) { return { a_in: p.a } }
    supabase.rpc('f', { ...build(params), limit_in: 1 })`)
  assert.equal(resolvable.partial, false)
})

test('resolveSpread refuses a segment that is not a helper call', () => {
  for (const segment of ['...someObject', '...a.b(c)', 'plain_in: 1', '...']) {
    assert.equal(resolveSpread('function x() { return { a_in: 1 } }', segment), null)
  }
  assert.deepEqual([...resolveSpread('function x() { return { a_in: 1 } }', '...x(p)')], ['a_in'])
})

test('every RPC the client calls is now verifiable, search included', async () => {
  const merged = mergeCalls(await clientRpcCalls())
  const partial = merged.filter(call => call.partial).map(call => call.name)
  assert.deepEqual(partial, [],
    `these would be probed with an incomplete argument set: ${partial.join(', ')}`)

  // The resolved set is checked against the signature the database declares,
  // taken from pg_get_function_identity_arguments on production and staging
  // (both identical) on 2026-08-29. If a migration changes the signature, the
  // live probe answers 404 and names this function — this pins the static half.
  const search = merged.find(call => call.name === 'search_items_fuzzy')
  assert.ok(search, 'the app still searches')
  assert.deepEqual([...search.args].sort(), [
    'category_in', 'condition_in', 'limit_in', 'listing_type_in', 'location_in',
    'offset_in', 'price_max_in', 'price_min_in', 'terms_in', 'user_id_in',
    'verified_only_in',
  ])
})
