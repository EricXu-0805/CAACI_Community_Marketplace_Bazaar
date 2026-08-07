import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { test } from 'node:test'

// The consent gate couples a frontend constant to a database function: App.vue
// routes to /pages/reconsent whenever profile.tos_version < CURRENT_CONSENT_VERSION,
// and that screen can only be cleared through record_consent, which validates the
// version against a hardcoded CASE. On 2026-08-06 the frontend shipped the
// 2026-08-01 bundle while production still ran the 07-18 function, so every user
// hit the gate and every acceptance returned 22023 — the whole signed-in app was
// unreachable until the migration was applied by hand.
//
// This file pins the half of that failure a repository can see: the effective
// consent version must already be accepted by the newest record_consent
// definition and permitted by its release allowlist. The other half is deploy
// order, which no static check can prove — RUNBOOK carries that rule, and the
// last assertion here keeps it from being deleted.

const LEGAL_DIR = new URL('../app/src/legal/', import.meta.url)
const MIGRATIONS_DIR = new URL('../supabase/migrations/', import.meta.url)
const RUNBOOK = new URL('../RUNBOOK.md', import.meta.url)

const VERSION_SOURCES = [
  ['terms.en.ts', 'TERMS_VERSION'],
  ['privacy.en.ts', 'PRIVACY_VERSION'],
  ['guidelines.en.ts', 'GUIDELINES_VERSION'],
]

async function readDocumentVersions() {
  const versions = new Map()
  for (const [file, constant] of VERSION_SOURCES) {
    const source = await readFile(new URL(file, LEGAL_DIR), 'utf8')
    const match = source.match(
      new RegExp(`export const ${constant} = '(\\d{4}-\\d{2}-\\d{2})'`),
    )
    assert.ok(
      match,
      `${file} must export ${constant} as a literal YYYY-MM-DD string; ` +
        'the consent gate compares these lexicographically.',
    )
    versions.set(constant, match[1])
  }
  return versions
}

// Mirrors legal/index.ts: the effective version is the newest bundled document.
function effectiveConsentVersion(versions) {
  return [...versions.values()].reduce((latest, v) => (v > latest ? v : latest))
}

async function readNewestConsentMigration() {
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort()
  let newest = null
  for (const file of files) {
    const source = await readFile(new URL(file, MIGRATIONS_DIR), 'utf8')
    if (/FUNCTION\s+(?:public\.)?record_consent\b/.test(source)) newest = { file, source }
  }
  assert.ok(newest, 'no migration defines record_consent')
  return newest
}

test('the effective consent version is accepted by the newest record_consent', async () => {
  const effective = effectiveConsentVersion(await readDocumentVersions())
  const { file, source } = await readNewestConsentMigration()

  const accepted = [...source.matchAll(/WHEN\s+'(\d{4}-\d{2}-\d{2})'\s+THEN/g)].map(
    (m) => m[1],
  )
  assert.ok(accepted.length > 0, `${file} defines record_consent without a version CASE`)
  assert.ok(
    accepted.includes(effective),
    `record_consent in ${file} accepts [${accepted.join(', ')}] but the app now ` +
      `sends '${effective}'. Every acceptance would raise invalid_version and the ` +
      're-consent screen would become an inescapable loop. Add a forward migration ' +
      'teaching record_consent the new version, and apply it to production BEFORE ' +
      'the frontend deploys (see RUNBOOK → Schema-coupled release order).',
  )
})

test('the effective consent version passes the release allowlist constraint', async () => {
  const effective = effectiveConsentVersion(await readDocumentVersions())
  const { file, source } = await readNewestConsentMigration()

  // The same allowlist is repeated in the precondition probe, the backfill guard,
  // the ADD CONSTRAINT and the postcondition. All of them must permit the value
  // record_consent is about to write, or the UPDATE fails the check constraint.
  const lists = [...source.matchAll(/tos_version\s+NOT\s+IN\s*\(([^)]*)\)|tos_version\s+IN\s*\(([^)]*)\)/g)]
  assert.ok(lists.length > 0, `${file} has no tos_version allowlist to check`)
  for (const match of lists) {
    const values = (match[1] ?? match[2])
      .split(',')
      .map((v) => v.trim().replace(/^'|'$/g, ''))
      .filter(Boolean)
    assert.ok(
      values.includes(effective),
      `an allowlist in ${file} omits '${effective}': [${values.join(', ')}]`,
    )
  }
})

test('both consent write paths report failures to telemetry', async () => {
  // The consent gate has no bypass, so a rejected version locks the entire
  // signed-in app for every account at once. Before this pin both call sites
  // answered with a toast and nothing else, which is why 08-06 ran for hours
  // undetected. The tags below are what an alert rule can key on.
  const sites = [
    ['reconsent/index.vue', 'reconsent.record_consent'],
    ['onboarding/index.vue', 'onboarding.record_consent'],
  ]
  for (const [page, source] of sites) {
    const vue = await readFile(new URL(`../app/src/pages/${page}`, import.meta.url), 'utf8')
    assert.match(
      vue,
      /import \{ captureException \} from ['"][^'"]*utils\/sentry['"]/,
      `${page} must import captureException`,
    )
    assert.match(
      vue,
      new RegExp(`captureException\\([^)]*source: '${source.replace('.', '\\.')}'`),
      `${page} must report record_consent failures as ${source}`,
    )
  }

  // beforeSend rebuilds event.tags from an allowlist, so a tag the alert rule
  // needs is only delivered if safeEventTags keeps it. Dropping `source` there
  // would silence every rule above without touching the pages.
  const sentry = await readFile(new URL('../app/src/utils/sentry.ts', import.meta.url), 'utf8')
  assert.match(sentry, /const source = stableToken\(tags\.source/)
  assert.match(sentry, /if \(source\) clean\.source = source/)
})

test('RUNBOOK still carries the schema-coupled release order rule', async () => {
  const source = await readFile(RUNBOOK, 'utf8')
  assert.match(source, /## Schema-coupled release order/)
  // Merging only deploys the frontend; this is the fact that made 08-06 possible.
  assert.match(source, /no CI step applies\s+`supabase\/migrations`\s+to production/)
  assert.match(source, /apply the migration to production\s+\*\*before\*\*\s+merging/)
})
