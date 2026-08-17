import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile, readdir } from 'node:fs/promises'

/**
 * A seeded session has to be written under the key the build actually reads.
 *
 * authStorageKeyForUrl() in composables/useSupabase.ts derives that key from
 * the Supabase URL the app was compiled against. A spec that writes a literal
 * project ref only works when the dev server happens to point at that same
 * project — and the authenticated CI job pins VITE_SUPABASE_URL to staging.
 *
 * The failure is quiet in the worst way. No session exists, so every gated
 * route falls through to the login page, and a check that reads the document
 * as a whole finds the login page's own heading and passes. It has now cost
 * two red mains: read-failure-states.spec.ts in #250, and
 * a11y-authenticated.spec.ts, which had been sweeping the login page for ten
 * of its fourteen routes until the scoped snapshot in #253 reported them.
 *
 * So: derive it, never write it down.
 */

const SMOKE_DIR = new URL('./', import.meta.url)

/*
 * A real seed writes the key into the page's localStorage with the ref
 * interpolated. pages.smoke.spec.ts also mentions an auth-token key, but it
 * builds an in-memory Map to unit-test the envelope reader and never touches
 * a browser — matching on `-auth-token` alone flags it, and flagging a
 * correct file is how a guard gets deleted.
 */
const SEEDS_A_SESSION = /localStorage\.setItem\(\s*`sb-/
// Supabase project refs are twenty lowercase letters.
const REF_LITERAL = /['"`][a-z]{20}['"`]/

async function seedingSpecs() {
  const found = []
  for (const entry of await readdir(SMOKE_DIR)) {
    if (!entry.endsWith('.spec.ts')) continue
    const source = await readFile(new URL(entry, SMOKE_DIR), 'utf8')
    if (SEEDS_A_SESSION.test(source)) found.push([entry, source])
  }
  return found
}

test('no spec seeds a session under a hardcoded project ref', async () => {
  const offenders = []
  for (const [entry, source] of await seedingSpecs()) {
    if (!/from '\.\/supabase-ref'/.test(source)) {
      offenders.push(`${entry}: seeds a session without importing ./supabase-ref`)
      continue
    }
    const literal = REF_LITERAL.exec(source)
    if (literal) offenders.push(`${entry}: still carries a project-ref literal ${literal[0]}`)
  }
  assert.deepEqual(offenders, [], `these will seed a key nobody reads:\n  ${offenders.join('\n  ')}`)
})

/*
 * Control. The check above is vacuous if it walks an empty set — a rename of
 * the storage key, or a directory read that quietly returns nothing, would
 * leave it green while covering no spec at all.
 */
test('the check covers the specs that actually seed a session', async () => {
  const seeding = (await seedingSpecs()).map(([entry]) => entry)
  assert.ok(
    seeding.length >= 4,
    `only ${seeding.length} session-seeding specs found (${seeding.join(', ')}) — the seed probably changed shape`,
  )
})
