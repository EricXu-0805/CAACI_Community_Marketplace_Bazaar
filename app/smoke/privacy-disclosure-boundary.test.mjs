import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const ROOT = new URL('../', import.meta.url)

test('versioned privacy copy discloses active data paths and retention limits in both languages', async () => {
  const [en, zh] = await Promise.all([
    readFile(new URL('src/legal/privacy.en.ts', ROOT), 'utf8'),
    readFile(new URL('src/legal/privacy.zh.ts', ROOT), 'utf8'),
  ])

  assert.match(en, /PRIVACY_VERSION = '2026-07-18'/)
  assert.match(zh, /版本号：2026-07-18/)
  for (const source of [en, zh]) {
    for (const provider of ['Supabase', 'Vercel', 'Resend', 'Sentry', 'OpenAI', 'OpenStreetMap', 'WeChat']) {
      const localized = provider === 'WeChat' && source === zh ? '微信' : provider
      assert.match(source, new RegExp(localized))
    }
    assert.match(source, /30 (days|天)/)
    assert.match(source, /(three decimal places|小数点后三位)/)
    assert.match(source, /(approximately 100-meter grid|约 100 米网格)/)
    assert.match(source, /(random per-install salt|安装级随机盐)/)
    assert.match(source, /(retained indefinitely|无限期保留)/)
  }
  assert.doesNotMatch(en, /session cookies to keep you signed in/i)
  assert.doesNotMatch(zh, /会话 Cookie 保持登录状态/)
  assert.doesNotMatch(en, /AWS us-east-1|Data is processed in the United States/)
  assert.doesNotMatch(zh, /AWS us-east-1|数据在美国处理/)
  assert.match(en, /full submitted text[\s\S]*account-bound openid/)
  assert.match(en, /public submitted-media URL[\s\S]*asynchronous trace mapping/)
  assert.match(zh, /完整待审文字[\s\S]*异步 trace 映射/)
  assert.match(en, /up to 30 recently viewed listings[\s\S]*up to 500 source\/translated-text cache entries/)
  assert.match(zh, /最多 30 条最近浏览商品[\s\S]*最多 500 条原文\/译文缓存/)
  assert.match(en, /private attribution record[\s\S]*exact accepted offer/)
  assert.match(en, /does not publicly reveal its selected offer[\s\S]*private sale-attribution record/)
  assert.match(en, /Ratings and review text you submit are public[\s\S]*rater, ratee, and related listing/)
  assert.match(en, /deleting the listing owner's account deletes[\s\S]*foreign-key deletion clears/)
  assert.match(zh, /私有归属记录[\s\S]*准确的已接受报价/)
  assert.match(zh, /标记已售不会公开所选报价[\s\S]*私有成交归属记录/)
  assert.match(zh, /评分与评价文字是公开的[\s\S]*评价人、被评价人和相关商品/)
  assert.match(zh, /商品发布者注销会删除[\s\S]*外键删除会清空/)
  for (const term of ['Favorites', 'saved-search', 'Offer prices', 'Blocks', 'API UUID']) {
    assert.match(en, new RegExp(term))
  }
})

test('material terms changes advance the consent version and effective date in both languages', async () => {
  const [en, zh] = await Promise.all([
    readFile(new URL('src/legal/terms.en.ts', ROOT), 'utf8'),
    readFile(new URL('src/legal/terms.zh.ts', ROOT), 'utf8'),
  ])

  assert.match(en, /TERMS_VERSION = '2026-07-18'/)
  assert.match(en, /Effective date: July 18, 2026/)
  assert.match(zh, /生效日期：2026 年 7 月 18 日/)
  assert.match(zh, /版本号：2026-07-18/)
})

test('the consent bundle includes guidelines and enforcement copy makes no unsupported recovery or SLA promise', async () => {
  const [legalIndex, en, zh, guidelinesEn, guidelinesZh, messagesEn, messagesZh] = await Promise.all([
    readFile(new URL('src/legal/index.ts', ROOT), 'utf8'),
    readFile(new URL('src/legal/terms.en.ts', ROOT), 'utf8'),
    readFile(new URL('src/legal/terms.zh.ts', ROOT), 'utf8'),
    readFile(new URL('src/legal/guidelines.en.ts', ROOT), 'utf8'),
    readFile(new URL('src/legal/guidelines.zh.ts', ROOT), 'utf8'),
    readFile(new URL('src/composables/i18n/messages/en.ts', ROOT), 'utf8'),
    readFile(new URL('src/composables/i18n/messages/zh.ts', ROOT), 'utf8'),
  ])

  assert.match(legalIndex, /GUIDELINES_VERSION as _gv/)
  assert.match(legalIndex, /\[_tv, _pv, _gv\][\s\S]*\.reduce/)
  assert.doesNotMatch(en, /reduced daily post[\s\S]*reduced feed distribution/)
  assert.doesNotMatch(zh, /每日发帖[、\s\S]*动态曝光降权/)
  assert.doesNotMatch(en, /appeal within 7 days/i)
  assert.doesNotMatch(zh, /7 日内申诉/)
  assert.match(en, /aim, but do not guarantee, to respond within 5 business days/)
  assert.match(zh, /争取但不保证在 5 个工作日内回复/)
  assert.doesNotMatch(messagesEn, /will review within 5 business days|get back to you within 5 business days/i)
  assert.doesNotMatch(messagesZh, /会在 5 个工作日内(复核|回复)/)
  assert.doesNotMatch(guidelinesEn, /we read every message/i)
  assert.doesNotMatch(guidelinesZh, /我们会读每一封/)
  assert.match(guidelinesEn, /no response time is guaranteed/)
  assert.match(guidelinesZh, /不保证回复时限/)
})

test('the H5 shell does not contact a hard-coded Supabase project before runtime configuration loads', async () => {
  const html = await readFile(new URL('index.html', ROOT), 'utf8')

  assert.doesNotMatch(html, /[a-z]{20}\.supabase\.co/i)
  assert.doesNotMatch(html, /rel=["'](?:dns-prefetch|preconnect)["'][^>]*supabase/i)
})
