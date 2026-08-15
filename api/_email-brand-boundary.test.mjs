// The product has two names — `Illini Market` (en) and `香槟集市` (zh) — and four
// outbound email surfaces. The two Supabase auth templates paired both names and
// linked the domain; the two Vercel handlers named only the Chinese half, so an
// English-reading recipient got a wordmark they had never seen and no way to tie
// the mail to illinimarket.com. Nothing pinned the two sets together, so they
// drifted. This encodes the shared contract.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = rel => readFileSync(resolve(repoRoot, rel), 'utf8')

const EMAIL_SURFACES = [
  'api/notification-digest.js',
  'api/meetup-notify.js',
  'supabase/email-templates/confirm-signup.html',
  'supabase/email-templates/reset-password.html',
]

// Assert on rendered markup (`>text<`), never a bare substring. Both handlers
// carry `const FROM = env('DIGEST_FROM', 'Illini Market <noreply@send.illinimarket.com>')`,
// so a bare /Illini Market/ or /illinimarket\.com/ matches the FROM constant and
// passes even when the email body names neither. The first draft of this file
// did exactly that and stayed green against a fully reverted template.
test('every outbound email names the product in both languages', () => {
  for (const rel of EMAIL_SURFACES) {
    const source = read(rel)
    assert.match(source, /香槟集市/, `${rel} dropped the Chinese wordmark`)
    assert.match(
      source,
      />Illini Market</,
      `${rel} names the product only in Chinese in its rendered body — an `
        + 'English-reading UIUC student cannot connect it to the site they signed up for',
    )
  }
})

test('every outbound email links the domain it was sent from', () => {
  // Mail from illinimarket.com that never names illinimarket.com gives the
  // recipient nothing to verify against, and reads as phishing.
  for (const rel of EMAIL_SURFACES) {
    assert.match(
      read(rel),
      />illinimarket\.com</,
      `${rel} never shows the sending domain as link text`,
    )
  }
})

test('handler subjects do not re-spend the inbox on the brand', () => {
  // FROM already renders as "Illini Market" in the recipient's inbox. A phone
  // truncates the subject around 35-40 characters, so a brand prefix pushed the
  // English half of every bilingual subject ("... · Meetup proposed") off the end.
  for (const rel of ['api/notification-digest.js', 'api/meetup-notify.js']) {
    const source = read(rel)
    assert.match(source, /const FROM = env\('DIGEST_FROM', 'Illini Market </)
    // A subject literal is the only place a quoted string *starts* with the
    // wordmark; the footer pairing is mid-template and never quote-adjacent.
    assert.doesNotMatch(
      source,
      /[`'"](香槟集市|Illini Market)\s*·/,
      `${rel} has a subject literal repeating the brand the FROM name already shows`,
    )
  }
})
