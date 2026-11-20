import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// SPEC §2: every response under a post is a reply. reconsent.* belongs to LEGAL.2.
const messages = async lang => readFile(new URL(`../src/composables/i18n/messages/${lang}.ts`, import.meta.url), 'utf8')
const values = source => [...source.matchAll(/^\s*'([^']+)':\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/gm)]
  .map(([, key, single, double]) => ({ key, value: single ?? double }))
  .filter(({ key }) => !key.startsWith('reconsent.'))

test('zh calls every response under a post a reply', async () => {
  const offenders = values(await messages('zh')).filter(({ value }) => value.includes('评论'))
  assert.deepEqual(offenders, [])
})

test('en calls every response under a post a reply', async () => {
  const offenders = values(await messages('en')).filter(({ value }) => /\bcomments?\b/i.test(value))
  assert.deepEqual(offenders, [])
})

test('the five boards and list terms match the SPEC glossary', async () => {
  const zh = Object.fromEntries(values(await messages('zh')).map(({ key, value }) => [key, value]))
  const en = Object.fromEntries(values(await messages('en')).map(({ key, value }) => [key, value]))
  const boards = {
    'campus-life': ['校园日常', 'Campus life'],
    'settling-market': ['落脚香槟', 'Settling in'],
    'alumni-career': ['学长学姐说', 'Ask alumni'],
    'events-social': ['找搭子', 'Find a buddy'],
    'local-deals': ['吃喝好店', 'Around town'],
  }
  for (const [slug, [zhName, enName]] of Object.entries(boards)) {
    assert.equal(zh[`plaza.category.${slug}`], zhName)
    assert.equal(en[`plaza.category.${slug}`], enName)
  }
  assert.equal(zh['plaza.tab.recent'], '新发布')
  assert.equal(en['plaza.tab.recent'], 'New')
  for (const key of ['plaza.tab.following', 'nav.following']) {
    assert.equal(zh[key], '关注的人')
    assert.equal(en[key], 'Following')
  }
  assert.equal(zh['plaza.attachItem'], '关联商品')
  assert.equal(en['plaza.attachItem'], 'Link an item')
})
