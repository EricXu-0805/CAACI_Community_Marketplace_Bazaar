import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile, readdir } from 'node:fs/promises'

/**
 * On a phone, an email field without `inputmode="email"` opens the ordinary
 * alphabetic keyboard. There is no `@`. The reader has to switch keyboard
 * planes to type their own address.
 *
 * Two of the three email fields in this app were in that state: password reset
 * — the likeliest first-day support request — and Illini verification, which
 * has never once succeeded in production. The login field had it.
 *
 * WHY ONLY inputmode
 * ------------------
 * The login field also carries type="email", autocomplete="email" and
 * spellcheck="false", and copying all four looks like the obvious fix. Measured
 * in a browser against the dev server on 2026-08-29, uni-app forwards exactly
 * one of them:
 *
 *   type="email"          -> rendered as type="text"     (uni rewrites it)
 *   inputmode="email"     -> rendered as inputmode="email"        ✓
 *   autocomplete="email"  -> rendered as autocomplete="off" (uni overrides)
 *   spellcheck="false"    -> not present on the element
 *
 * So asserting the other three would pin markup the browser never sees, and
 * "fixing" a page by adding them would change nothing a user could notice.
 * This asserts the one that survives.
 *
 * The detector deliberately does NOT look at inputmode. A guard that finds its
 * subjects by the attribute it is checking passes by finding nothing.
 */

const SRC = new URL('../src/', import.meta.url)

async function vueFiles(dir = SRC) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) out.push(...await vueFiles(new URL(`${entry.name}/`, dir)))
    else if (entry.name.endsWith('.vue')) out.push(new URL(entry.name, dir))
  }
  return out
}

/** Every `<input …>` tag in the app, flattened to one line each. */
async function inputTags() {
  const tags = []
  for (const file of await vueFiles()) {
    const src = await readFile(file, 'utf8')
    for (const match of src.matchAll(/<input\b[^>]*>/gs)) {
      tags.push({
        file: file.pathname.slice(file.pathname.indexOf('/src/') + 1),
        line: src.slice(0, match.index).split('\n').length,
        tag: match[0].split(/\s+/).join(' '),
      })
    }
  }
  return tags
}

/** Independent of inputmode, on purpose. */
const isEmailInput = tag =>
  /v-model="[A-Za-z]*[Ee]mail"/.test(tag) || /autocomplete="email"/.test(tag)

test('every email field asks for the email keyboard', async () => {
  const tags = await inputTags()
  assert.ok(tags.length > 10, `found ${tags.length} <input> tags — the scan stopped reading src/`)

  const emails = tags.filter(t => isEmailInput(t.tag))
  assert.ok(emails.length >= 3,
    `expected the login, reset-password and Illini-verify fields, found ${emails.length}`)
  for (const page of ['login', 'reset-password', 'illini-verify']) {
    assert.ok(emails.some(t => t.file.includes(page)), `${page}'s email field went missing`)
  }

  const plain = emails
    .filter(t => !/inputmode="email"/.test(t.tag))
    .map(t => `${t.file}:${t.line}`)
  assert.deepEqual(plain, [],
    `these open a keyboard with no @ on it:\n  ${plain.join('\n  ')}`)
})

test('the detector tells an email field from every other input', async () => {
  const tags = await inputTags()
  const others = tags.filter(t => !isEmailInput(t.tag))

  // Control: without this the first test could pass by classifying nothing, or
  // by classifying everything and finding that most inputs are not email ones.
  assert.ok(others.length >= 5,
    `only ${others.length} non-email inputs — the detector is matching too much`)
  for (const t of others) {
    assert.ok(!/@/.test(t.tag) || !/v-model="[A-Za-z]*[Ee]mail"/.test(t.tag),
      `${t.file}:${t.line} looks like an email field the detector missed`)
  }

  // And a password field must never be pulled in: inputmode="email" on one
  // would be actively wrong. uni-app spells these `:password="…"` in source and
  // only renders type="password" in the browser, so match the source form.
  const passwords = tags.filter(t => /:password=|type="password"/.test(t.tag))
  assert.ok(passwords.length >= 2,
    `expected the sign-in and reset password fields, found ${passwords.length}`)
  for (const t of passwords) {
    assert.ok(!/inputmode="email"/.test(t.tag),
      `${t.file}:${t.line} is a password field asking for an email keyboard`)
  }
})
