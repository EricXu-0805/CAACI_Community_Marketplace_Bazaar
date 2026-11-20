import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'

const source = readFileSync(new URL('./eventLinks.ts', import.meta.url), 'utf8')
function compile(platform) {
  const selected = source.replace(/^\s*\/\/ #ifdef (H5|MP-WEIXIN)\n([\s\S]*?)^\s*\/\/ #endif/gm,
    (_, target, body) => target === platform ? body : '')
  return import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(selected)).toString('base64')}`)
}

test('event links enforce the same offline allowlist on H5 and mp-weixin', async t => {
  const saved = { fetch: globalThis.fetch, window: globalThis.window, uni: globalThis.uni }
  let fetchCalls = 0
  globalThis.fetch = () => { fetchCalls += 1; throw new Error('Network forbidden') }
  try {
    const h5 = await compile('H5')
    const mp = await compile('MP-WEIXIN')
    await t.test('server and client agree on https, exact partner domains, ports and hostname lookalikes', async () => {
      const server = await import('../../../api/_community-events.js')
      for (const url of [
        'https://caaciorg.com/events/', 'https://illinois.edu/', 'https://sub.illinois.edu/',
        'https://forms.example.test/form', 'https://sub.forms.example.test', 'https://forms.illinois.edu/',
        'http://caaciorg.com', '//illinois.edu', 'javascript:alert(1)', 'https://evilillinois.edu',
        'https://illinois.edu.evil.test', 'https://caaciorg.com.evil.test', 'https://user@illinois.edu',
        'https://illinois.edu:443/path', 'https://illinois.edu:8443', 'https://illinois.edu\\@evil.test',
        ' https://illinois.edu', 'https://illinois.edu\n/path', 'https://sub.caaciorg.com',
      ]) {
        for (const client of [h5, mp]) assert.equal(client.isAllowedEventLink(url, ['forms.example.test']), server.isAllowedEventLink(url, ['forms.example.test']), url)
      }
    })
    await t.test('Chinese official links use /zh/events/ and lang=zh without building slugs', () => {
      assert.equal(h5.localizeEventLink('https://caaciorg.com/events/#fixture', 'zh'), 'https://caaciorg.com/zh/events/#fixture')
      assert.equal(h5.localizeEventLink('https://caaciorg.com/events/synthetic/register/', 'zh'), 'https://caaciorg.com/events/synthetic/register/?lang=zh')
      assert.equal(h5.localizeEventLink('https://caaciorg.com/events/synthetic/register/?a=1&lang=en#form', 'zh'), 'https://caaciorg.com/events/synthetic/register/?a=1&lang=zh#form')
      assert.equal(h5.localizeEventLink('https://caaciorg.com/events/#fixture', 'en'), 'https://caaciorg.com/events/#fixture')
      assert.equal(h5.localizeEventLink('https://partner.example.test/events/', 'zh'), 'https://partner.example.test/events/')
    })
    await t.test('H5 opens with noopener,noreferrer and never uses the clipboard', () => {
      const calls = []
      const opened = { opener: {} }
      globalThis.window = { open: (...args) => { calls.push(args); return opened } }
      globalThis.uni = { setClipboardData: () => assert.fail('H5 copied instead of opening') }
      assert.equal(h5.openExternalLink('https://caaciorg.com/events/#fixture'), true)
      assert.deepEqual(calls, [['https://caaciorg.com/zh/events/#fixture', '_blank', 'noopener,noreferrer']])
      assert.equal(opened.opener, null)
      assert.equal(h5.openExternalLink('https://evil.example.test'), false)
      assert.equal(calls.length, 1)
      assert.equal(h5.eventExternalLinkLabel(true), '去主办方报名')
    })
    await t.test('mp-weixin copies registration and page links, then shows the prescribed toast', () => {
      const copied = [], toasts = []
      globalThis.window = { open: () => assert.fail('Mini Program opened a window') }
      globalThis.uni = {
        setClipboardData: options => { copied.push(options.data); options.success() },
        showToast: options => toasts.push(options),
      }
      assert.equal(mp.openExternalLink('https://forms.example.test/form', ['forms.example.test']), true)
      assert.deepEqual(copied, ['https://forms.example.test/form'])
      assert.deepEqual(toasts, [{ title: '链接已复制，请在浏览器打开', icon: 'none' }])
      assert.equal(mp.openExternalLink('https://evil.example.test'), false)
      assert.equal(copied.length, 1)
      assert.equal(mp.eventExternalLinkLabel(true), '复制报名链接')
      assert.equal(mp.eventExternalLinkLabel(false), '复制链接')
      assert.equal(mp.eventExternalLinkLabel(true, 'en'), 'Copy registration link')
      assert.equal(mp.openExternalLink('https://illinois.edu/', [], 'en'), true)
      assert.equal(toasts.at(-1).title, 'Link copied. Open it in your browser.')
    })
    await t.test('fetch was called zero times', () => assert.equal(fetchCalls, 0))
  } finally {
    globalThis.fetch = saved.fetch
    for (const key of ['window', 'uni']) {
      if (saved[key] === undefined) delete globalThis[key]
      else globalThis[key] = saved[key]
    }
    assert.equal(fetchCalls, 0)
  }
})
