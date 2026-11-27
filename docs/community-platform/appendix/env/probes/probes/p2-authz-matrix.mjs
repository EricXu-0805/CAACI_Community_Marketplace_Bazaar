import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { client, identity, requireResult, signOutIdentities } from './probe-data.mjs'

const fixtures = { items: [], posts: [], retained: [], notifications: [] }
const rows = []
const ev = process.env.EV
let failed = false
let phase = 'setup'
const save = () => writeFile(`${ev}/fixtures.json`, JSON.stringify(fixtures, null, 2))
async function rejected(action, actor, operation, expectations) {
  const response = await operation
  const unrelated = /rate.?limit|too.?many|suspend|banned|locked/i.test(response.error?.message || '')
  const expectedError = expectations.some(expected => typeof expected === 'string'
    ? response.error?.code === expected
    : response.error?.code === expected.code && response.error?.message === expected.message)
  const pass = Boolean(response.error && expectedError && !unrelated)
  const row = { action, identity: actor, http: response.status, code: response.error?.code ?? null, expected: 'denied', result: pass ? 'PASS' : 'FAIL' }
  rows.push(row)
  console.log(JSON.stringify(row))
  failed ||= !pass
  // Unexpectedly accepted post writes still need normal author UI cleanup.
  if (Array.isArray(response.data)) {
    for (const post of response.data.filter(post => post.id && post.title)) {
      const existing = fixtures.posts.find(fixture => fixture.id === post.id)
      if (existing) existing.title = post.title
      else fixtures.posts.push({ id: post.id, title: post.title, owner: actor })
    }
    await save()
  }
}
try {
  const a = await identity('A')
  const b = await identity('B')
  const anon = client()
  if (existsSync(`${ev}/fixtures-attempt-2.json`)) {
    const previous = JSON.parse(await readFile(`${ev}/fixtures-attempt-2.json`, 'utf8'))
    const ids = previous.retained.filter(row => row.type === 'conversation').map(row => row.id)
    if (ids.length) {
      const remaining = requireResult(await b.db.from('conversations').select('id').in('id', ids), 'prior_conversation_cleanup_remaining')
      await writeFile(`${ev}/prior-cleanup-verification.json`, JSON.stringify({ conversations: remaining }, null, 2))
    }
  }
  const stamp = Date.now().toString(36)
  for (const [owner, user, count] of [['A', a, 5], ['B', b, 1]]) {
    for (let index = 0; index < count; index++) {
      const sold = owner === 'A' && index === 4
      const title = `[SYN-P2.11] ${stamp} ${owner} ${index}`
      const item = requireResult(await user.db.from('items').insert({
        user_id: user.id, title, description: `[SYN-P2.11] synthetic acceptance ${stamp} ${owner} ${index}`,
        price: 1, category: 'other', condition: 'good', location: 'UIUC', images: [], negotiable: true,
      }).select('id').single(), 'create_fixture_item')
      fixtures.items.push({ id: item.id, title, owner, sold: false })
      await save()
      if (sold) {
        // Item status is not client-insertable. Use the same negotiated-sale
        // RPC path as the product rather than writing lifecycle columns.
        const conversation = requireResult(await b.db.from('conversations').insert({
          item_id: item.id, buyer_id: b.id, seller_id: a.id,
        }).select('id').single(), 'create_sale_conversation')
        fixtures.retained.push({ type: 'conversation', id: conversation.id, owners: ['A', 'B'], reason: 'No product conversation deletion entry.' })
        await save()
        const offer = requireResult(await b.db.rpc('make_offer', {
          p_conversation_id: conversation.id, p_price: 1, expected_user_id_in: b.id,
          p_note: `[SYN-P2.11] ${stamp} synthetic sale`,
        }), 'make_sale_offer')
        fixtures.retained.push({ type: 'offer', id: offer.id, owners: ['A', 'B'], reason: 'Accepted sale evidence has no product deletion entry.' })
        await save()
        requireResult(await a.db.rpc('respond_to_offer', {
          p_offer_id: offer.id, p_action: 'accept', expected_user_id_in: a.id,
          p_counter_price: null, p_counter_note: null,
        }), 'accept_sale_offer')
        requireResult(await a.db.rpc('mark_item_sold', {
          p_item_id: item.id, p_offer_id: offer.id, expected_user_id_in: a.id,
        }), 'mark_fixture_sold')
        fixtures.items.find(fixture => fixture.id === item.id).sold = true
        await save()
        const messages = requireResult(await b.db.from('messages').select('id').eq('conversation_id', conversation.id), 'sale_message_inventory')
        fixtures.retained.push(...messages.map(message => ({
          type: 'message', id: message.id, conversationId: conversation.id,
          owners: ['A', 'B'], reason: 'No product message deletion entry.',
        })))
        await save()
      }
    }
  }
  const conversationIds = fixtures.retained.filter(row => row.type === 'conversation').map(row => row.id)
  for (const [owner, user] of [['A', a], ['B', b]]) {
    if (conversationIds.length) {
      const notifications = requireResult(await user.db.from('notifications').select('id').in('conversation_id', conversationIds), 'sale_notification_inventory')
      fixtures.notifications.push(...notifications.map(row => ({ id: row.id, owner })))
      await save()
    }
  }
  const title = `[SYN-P2.11] ${stamp} authorization topic`
  const payload = { user_id: a.id, title, category: 'campus-life', content: `[SYN-P2.11] ${stamp} acceptance body`, images: [] }
  const post = requireResult(await a.db.from('posts').insert(payload).select('id').single(), 'create_fixture_post')
  fixtures.posts.push({ id: post.id, title, owner: 'A' })
  await save()
  const own = fixtures.items.filter(item => item.owner === 'A' && !item.sold)
  const other = fixtures.items.find(item => item.owner === 'B')
  const sold = fixtures.items.find(item => item.sold)
  phase = 'matrix'
  await rejected('A attaches B item', 'A', a.db.from('post_items').insert({ post_id: post.id, item_id: other.id, display_order: 0 }), ['42501', 'P0001'])
  await rejected('A attaches sold item', 'A', a.db.from('post_items').insert({ post_id: post.id, item_id: sold.id, display_order: 0 }), ['42501', 'P0001', '23514'])
  // Keep the cap test independent even if either preceding forbidden attach
  // unexpectedly succeeded: preserve that FAIL and establish exactly 3 rows.
  const attached = requireResult(await a.db.from('post_items').select('item_id').eq('post_id', post.id), 'existing_matrix_associations')
  requireResult(await a.db.from('post_items').insert(own.slice(0, 3 - attached.length).map((item, index) => ({
    post_id: post.id, item_id: item.id, display_order: attached.length + index,
  }))).select('item_id'), 'establish_three_associations')
  await rejected('A attaches fourth item', 'A', a.db.from('post_items').insert({ post_id: post.id, item_id: own[3].id, display_order: 2 }), ['P0001', '23514'])
  await rejected("category='invalid'", 'B', b.db.from('posts').insert({
    ...payload, user_id: b.id, title: `[SYN-P2.11] ${stamp} invalid category`,
    content: `[SYN-P2.11] ${stamp} invalid category body`, category: 'invalid',
  }).select('id,title'), ['23514'])
  await rejected('title length 121', 'A', a.db.from('posts').insert({
    ...payload, title: '[SYN-P2.11] '.padEnd(121, 'x'),
    content: `[SYN-P2.11] ${stamp} invalid title body`,
  }).select('id,title'), [{ code: '22023', message: 'public_write_boundary:post_title_size' }])
  await rejected('empty topic body', 'B', b.db.from('posts').insert({
    ...payload, user_id: b.id, title: `[SYN-P2.11] ${stamp} empty body`, content: '',
  }).select('id,title'), [
    { code: '22023', message: 'public_write_boundary:post_content_size' },
    { code: '23514', message: 'post_topic_body_required' },
  ])
  await rejected('A updates own title', 'A', a.db.from('posts').update({
    title: `[SYN-P2.11] ${stamp} forbidden edit`,
  }).eq('id', post.id).select('id,title'), ['42501'])
  phase = 'anonymous_before_delete'
  const beforeList = requireResult(await anon.from('posts').select('id').eq('id', post.id), 'anonymous_list_before')
  const beforeSearch = requireResult(await anon.rpc('search_community_posts', { terms_in: [stamp], limit_in: 100 }), 'anonymous_search_before')
  if (!beforeList.some(p => p.id === post.id) || !beforeSearch.some(p => p.id === post.id)) throw new Error('anonymous_baseline_not_visible')
} catch (error) {
  failed = true
  console.log(JSON.stringify({ action: 'probe_failure', phase, result: 'FAIL', code: error?.code ?? null }))
} finally {
  await save()
  await writeFile(`${ev}/matrix.json`, JSON.stringify(rows, null, 2))
  // Product UI cleanup uses only the normal author delete controls.
  if (fixtures.items.length || fixtures.posts.length) {
    const code = await new Promise(resolve => {
      const child = spawn('npx', ['playwright', 'test', '--config', '.probes/playwright.probe.config.ts', 'p2-cleanup.spec.ts'], { env: process.env, stdio: 'inherit' })
      child.on('exit', resolve)
    })
    failed ||= code !== 0
  }
  await signOutIdentities()
  console.log(JSON.stringify({ action: 'matrix_totals', total: rows.length, passed: rows.filter(r => r.result === 'PASS').length, failed: rows.filter(r => r.result === 'FAIL').length }))
  process.exitCode = failed || rows.length !== 7 ? 1 : 0
}
