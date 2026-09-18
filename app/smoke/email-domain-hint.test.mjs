import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const source = await readFile(new URL('../src/utils/emailDomainHint.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } })
const { suggestEmailDomain } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)

test('a provider suffix typo gets a suggestion without losing the local part or plus alias', () => {
  assert.equal(suggestEmailDomain('  Test.User+signup@HOTMAIL.CON  '), 'Test.User+signup@hotmail.com')
  assert.equal(suggestEmailDomain('student@gmail.cmo'), 'student@gmail.com')
})

test('the observed Hotmail omission offers a suggestion while preserving the plus alias', () => {
  const submitted = '  Test.User+signup@HOTMAI.COM  '
  assert.equal(suggestEmailDomain(submitted), 'Test.User+signup@hotmail.com')
  for (const value of ['a@mail.hotmai.com', 'a@hotmai.co', '@hotmai.com', 'a@@hotmai.com']) {
    assert.equal(suggestEmailDomain(value), null)
  }
})

test('valid, custom, incomplete and ambiguous domains are not guessed', () => {
  for (const email of ['a@gmail.com', 'a@gmail.co', 'a@illinois.edu', 'a@lab.con',
    'a@mail.hotmail.con', 'a@hotmail.contact', 'a@hotmial.com', 'a@', '@hotmail.con',
    'a b@hotmail.con', 'a@@hotmail.con', `${'a'.repeat(250)}@hotmail.con`]) {
    assert.equal(suggestEmailDomain(email), null, email)
  }
})
