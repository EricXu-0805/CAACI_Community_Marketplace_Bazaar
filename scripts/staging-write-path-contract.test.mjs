import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ACCEPTED_TITLE,
  assertSafeTarget,
  FORBIDDEN_ENV_KEYS,
  KNOWN_PRODUCTION_PROJECT_REFS,
  moderationRefusal,
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
    moderationRefusal(400, { message: 'moderation_block:contact_info' }),
    { status: 400, category: 'contact_info' },
  )
  assert.deepEqual(
    moderationRefusal(400, { message: 'moderation_block:sensitive_word' }),
    { status: 400, category: 'sensitive_word' },
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
  // regression guard on 20260818162716 and becomes a generic smoke test.
  assert.match(ACCEPTED_TITLE, /Selling my TV, Xbox and a desk$/)
  assert.ok(ACCEPTED_TITLE.startsWith(TITLE_PREFIX))
  assert.ok(REFUSED_TITLE.startsWith(TITLE_PREFIX),
    'both titles must carry the prefix or the stray sweep cannot find them')
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
