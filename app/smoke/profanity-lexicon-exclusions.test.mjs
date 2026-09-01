import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

/**
 * content_moderation_check matches a keyword of 1-4 ASCII alphanumerics on
 * word boundaries, and anything longer as a plain substring of text that has
 * already had its separators and whitespace stripped. So a long keyword
 * collides with any phrase whose letters close up around it.
 *
 * Eight obvious profanities were left out of 20260901071645 for exactly that
 * reason, each measured against production's own matcher on a corpus of
 * listings somebody could really post. The reasons are easy to lose and
 * expensive to rediscover — "why isn't `bitch` blocked" is a question that
 * invites a one-line fix which quietly stops anyone selling rabbit food.
 *
 * This asserts the exclusions hold and that the migration still explains each
 * one. It deliberately does not reimplement the matcher: a JS mirror of the
 * PG rules would drift, and then it would be testing itself.
 */

const MIGRATION = new URL('../../supabase/migrations/20260901071645_english_profanity_keywords.sql', import.meta.url)

/** Measured 2026-09-01 against content_moderation_check's own matching rules. */
const COLLIDES = {
  bitch: 'Rabbit chow',
  retard: 'flame retardant',
  dick: "Dick's Sporting Goods",
  pussy: 'Pussy willow',
  hoe: 'Garden hoe',
  bastard: 'Bastard file',
  cock: 'Cock-a-doodle',
  damn: 'Damn Good Ramen',
}

/** The words the migration actually seeds, from its VALUES list. */
function seeded(sql) {
  const list = sql.slice(sql.indexOf('FROM (VALUES'), sql.indexOf(') AS seed('))
  return [...list.matchAll(/\('([a-z]+)'\)/g)].map(m => m[1])
}

test('the migration seeds a real list', async () => {
  // Control for both tests below: neither can pass by parsing nothing, and a
  // keyword long enough to be substring-matched must have been worth the risk.
  const words = seeded(await readFile(MIGRATION, 'utf8'))
  assert.ok(words.length >= 12, `parsed only ${words.length} keywords from the migration`)
  assert.ok(words.includes('shit'), 'the word that prompted this is missing')
  assert.ok(words.some(w => w.length > 4), 'no substring-matched keyword survived the corpus')
})

test('no keyword that collides with a plausible listing is seeded', async () => {
  const words = new Set(seeded(await readFile(MIGRATION, 'utf8')))
  const reintroduced = Object.keys(COLLIDES).filter(word => words.has(word))
  assert.deepEqual(
    reintroduced, [],
    reintroduced.map(w => `'${w}' also blocks "${COLLIDES[w]}"`).join('; '),
  )
})

test('the migration says why each one was left out', async () => {
  const sql = await readFile(MIGRATION, 'utf8')
  const undocumented = Object.entries(COLLIDES)
    .filter(([word, collision]) => !sql.includes(word) || !sql.includes(collision))
    .map(([word, collision]) => `${word} (${collision})`)
  assert.deepEqual(undocumented, [])
})
