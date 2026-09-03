import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

/**
 * A notification type the client has never heard of still renders: the icon
 * falls through to the bell, the small label above the title falls through to
 * "系统通知 / Notice", and the row keeps no tint. It looks fine and it is
 * wrong — a like reads as a system notice, and the nightly digest drops the
 * row entirely, because its two allowlists are closed by design.
 *
 * So the types migration 20260903070000 adds are checked against every place
 * that has to name a type: the two switches in app/src/api/notifications.ts,
 * the tinted `.ni-*` classes on the notifications page, and the digest's icon
 * map and off-platform allowlist.
 *
 * The new types are derived — this migration's CHECK minus the previous one —
 * rather than typed in here, so reverting the migration empties the set and
 * the control below goes red instead of the suite passing on nothing.
 */

const ROOT = new URL('../../', import.meta.url)
const ACTIVITY_MIGRATION = new URL(
  'supabase/migrations/20260903070000_in_app_activity_notifications.sql', ROOT)
const PREVIOUS_MIGRATION = new URL(
  'supabase/migrations/070_unread_message_reminder.sql', ROOT)
const API = new URL('app/src/api/notifications.ts', ROOT)
const PAGE = new URL('app/src/pages/notifications/index.vue', ROOT)
const DIGEST = new URL('api/notification-digest.js', ROOT)
const MESSAGES = ['en', 'zh'].map(lang =>
  new URL(`app/src/composables/i18n/messages/${lang}.ts`, ROOT))

function checkedTypes(sql) {
  const list = /check \(type in \(([\s\S]*?)\)\)/i.exec(sql)
  assert.ok(list, 'the notifications type CHECK is not declared here any more')
  return new Set([...list[1].matchAll(/'([a-z_]+)'/g)].map(match => match[1]))
}

function switchCases(source, signature) {
  const start = source.indexOf(signature)
  assert.ok(start !== -1, `${signature} is gone`)
  const end = source.indexOf('\n}\n', start)
  assert.ok(end > start, `${signature} has no closing brace at column 0`)
  const body = source.slice(start, end)
  return new Map([...body.matchAll(/case '([a-z_]+)': return '([^']+)'/g)]
    .map(match => [match[1], match[2]]))
}

async function newTypes() {
  const [now, before] = await Promise.all([
    readFile(ACTIVITY_MIGRATION, 'utf8').then(checkedTypes),
    readFile(PREVIOUS_MIGRATION, 'utf8').then(checkedTypes),
  ])
  for (const type of before) {
    assert.ok(now.has(type), `${type} was dropped from the type CHECK`)
  }
  return [...now].filter(type => !before.has(type))
}

test('the migration adds types, so there is something to cover', async () => {
  const added = await newTypes()
  assert.ok(added.length > 0, 'no new notification types were parsed out of the migration')
})

test('every new type has its own icon, label and tint in the app', async () => {
  const [added, api, page] = await Promise.all([
    newTypes(),
    readFile(API, 'utf8'),
    readFile(PAGE, 'utf8'),
  ])
  const icons = switchCases(api, 'export function notificationIcon(')
  const labels = switchCases(api, 'export function notificationTypeLabelKey(')
  const tints = new Set([...page.matchAll(/^\.ni-([a-z_]+)\s/gm)].map(match => match[1]))

  // Controls: a regex that matched nothing must not read as full coverage.
  assert.ok(icons.size >= 5, `parsed ${icons.size} icon cases`)
  assert.ok(labels.size >= 5, `parsed ${labels.size} label cases`)
  assert.ok(tints.size >= 5, `parsed ${tints.size} .ni-* tints`)

  for (const type of added) {
    assert.ok(icons.has(type), `${type} falls through to the bell icon`)
    assert.ok(labels.has(type), `${type} is labelled "system" in the list`)
    assert.ok(tints.has(type), `${type} has no .ni-${type} tint, so its icon is untinted`)
  }
})

test('every new label key exists in both languages', async () => {
  const [added, api, ...messages] = await Promise.all([
    newTypes(),
    readFile(API, 'utf8'),
    ...MESSAGES.map(url => readFile(url, 'utf8')),
  ])
  const labels = switchCases(api, 'export function notificationTypeLabelKey(')
  for (const type of added) {
    const key = labels.get(type)
    for (const [index, source] of messages.entries()) {
      assert.match(
        source,
        new RegExp(`'${key.replace('.', '\\.')}':`),
        `${key} (${type}) is missing from the ${['en', 'zh'][index]} messages`,
      )
    }
  }
})

test('every new type reaches the nightly digest instead of being dropped', async () => {
  const [added, digest] = await Promise.all([newTypes(), readFile(DIGEST, 'utf8')])

  const iconLine = /const TYPE_ICON = \{([^}]*)\}/.exec(digest)
  assert.ok(iconLine, 'TYPE_ICON is gone')
  const icons = new Set([...iconLine[1].matchAll(/([a-z_]+):/g)].map(match => match[1]))

  const allowLine = /const SAFE_UNROUTED_NOTIFICATION_TYPES = new Set\(\[([\s\S]*?)\]\)/.exec(digest)
  assert.ok(allowLine, 'the unrouted allowlist is gone')
  const allowed = new Set([...allowLine[1].matchAll(/'([a-z_]+)'/g)].map(match => match[1]))

  assert.ok(icons.size >= 5, `parsed ${icons.size} digest icons`)
  assert.ok(allowed.size >= 3, `parsed ${allowed.size} emailable types`)

  for (const type of added) {
    assert.ok(icons.has(type), `${type} has no digest icon`)
    // These rows carry no conversation, so the routed allowlist can never
    // admit them; the unrouted one is the only way they are ever emailed.
    assert.ok(allowed.has(type), `${type} is silently dropped from the digest`)
  }
})
