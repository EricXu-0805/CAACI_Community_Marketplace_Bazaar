import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const CONTENT_SAFETY_URL = new URL('../src/utils/contentSafety.ts', import.meta.url)

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
  assert.match(body, /catch \{ throw new Error\('moderation_unavailable'\) \}/)
  assert.match(body, /j\?\.skipped === true && j\?\.reason === 'no_key'/)
  assert.doesNotMatch(body, /catch[\s\S]{0,100}return \{ flagged: false/)
  assert.doesNotMatch(body, /text\.slice\(0, 8000\)/)
})
