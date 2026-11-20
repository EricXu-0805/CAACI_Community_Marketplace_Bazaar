import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const SRC = fileURLToPath(new URL('../src/', import.meta.url))
const ACCOUNT_PAGES = [
  'suspended', 'reconsent', 'profile-recovery', 'onboarding', 'welcome', 'login',
].map(page => `pages/${page}/index`)
const NORMAL_PAGE = 'pages/detail/index'
const source = path => readFileSync(resolve(SRC, path), 'utf8')
const compile = input => ts.transpileModule(input, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText

function preprocess(input, platform) {
  const enabled = [true]
  return input.split('\n').filter(line => {
    const directive = line.match(/^\s*\/\/\s*#(ifdef|ifndef|endif)(?:\s+(\S+))?/)
    if (!directive) return enabled.at(-1)
    if (directive[1] === 'endif') enabled.pop()
    else enabled.push(enabled.at(-1) && (
      directive[1] === 'ifdef' ? directive[2] === platform : directive[2] !== platform
    ))
    return false
  }).join('\n')
}

function harness(platform, level = 0, bannerHost = true, expired = false) {
  const state = {
    route: NORMAL_PAGE, pageStack: 'ready', native: [], watchers: [], stops: 0,
    inbox: null, notification: null, conversations: [], rows: [], applied: [],
  }
  const user = {
    id: 'user-a', tos_version: 'current', suspension_level: level,
    suspended_until: expired ? '2000-01-01T00:00:00Z'
      : level === 5 ? 'infinity' : '2100-12-03T12:34:56Z',
  }
  const ref = value => ({ value })
  const token = { userId: user.id, generation: 1 }
  const currentUser = ref(user)
  const timers = new Map()
  let timerId = 0
  const supabase = {
    auth: { getSession: async () => ({ data: { session: { user } } }) },
    from(table) {
      assert.equal(table, 'notifications')
      let countOnly = false
      const query = {
        select(_fields, options) { countOnly = !!options?.head; return query },
        eq() { return query },
        order() { return query },
        limit() { return query },
        then(onFulfilled, onRejected) {
          return Promise.resolve({
            data: countOnly ? null : [...state.rows], error: null,
            count: state.rows.filter(row => !row.is_read).length,
          }).then(onFulfilled, onRejected)
        },
      }
      return query
    },
  }
  const scope = {
    ref, watch: (_value, callback) => { state.watchers.push(callback) },
    useSupabase: () => ({ supabase }),
    useAuth: () => ({ currentUser }),
    useI18n: () => ({ t: key => key }),
    subscribeToUserInbox: (_id, callback) => {
      state.inbox = callback
      return () => { state.stops++ }
    },
    subscribeToUserNotifications: (_id, callback) => {
      state.notification = callback
      return () => { state.stops++ }
    },
    invalidateConversations: () => {},
    applyIncomingMessage: row => { state.applied.push(row); return true },
    useMessages: () => ({ fetchConversations: async () => true }),
    useModeration: () => ({
      blockedIds: ref(new Set()), ensureLoaded: async () => ({ ok: true }),
    }),
    captureAccountRequest: () => token,
    captureActiveAccountRequest: () => token,
    getActiveAccountId: () => user.id,
    isAccountRequestCurrent: candidate => candidate === token,
    onAccountTransition: () => () => {},
    fetchArchivedConversationIds: async () => new Set(),
    readAllAscendingKeyset: async () => [...state.conversations],
  }
  const uni = { showToast: toast => state.native.push(toast) }
  const getCurrentPages = () => {
    if (state.pageStack === 'empty') return []
    if (state.pageStack === 'throws') throw new Error('page_stack_unavailable')
    return [{ route: NORMAL_PAGE }, { route: state.route }]
  }
  const cache = new Map()
  function load(path) {
    path = resolve(SRC, path)
    if (cache.has(path)) return cache.get(path)
    const module = { exports: {} }
    cache.set(path, module.exports)
    function requireModule(name) {
      if (name === 'vue') return scope
      if (name.endsWith('/useSupabase')) return scope
      if (name.endsWith('/useAuth')) return scope
      if (name.endsWith('/useI18n')) return scope
      if (name.endsWith('/useRealtimeFallback')) return scope
      if (name.endsWith('/useMessages')) return scope
      if (name.endsWith('/useModeration')) return scope
      if (name.endsWith('/accountScope')) return scope
      if (name.endsWith('/conversationArchive')) return scope
      if (name.endsWith('/paginatedRead')) return scope
      if (name === '../utils') return { formatPrice: value => String(value) }
      return load(resolve(dirname(path), `${name}.ts`))
    }
    new Function('module', 'exports', 'require', 'getCurrentPages', 'uni', 'setTimeout', 'clearTimeout',
      compile(preprocess(source(path), platform)))(
      module, module.exports, requireModule, getCurrentPages, uni,
      callback => { const id = ++timerId; timers.set(id, callback); return id },
      id => timers.delete(id),
    )
    return module.exports
  }
  const toast = load('composables/useAppToast.ts')
  if (platform !== 'H5' && bannerHost) toast.registerToastHost()
  const unread = load('composables/useUnread.ts').useUnread()
  const notifications = load('composables/useNotifications.ts').useNotifications()
  async function start() {
    for (const callback of state.watchers) callback(user, null)
    assert.equal(typeof state.inbox, 'function')
    assert.equal(typeof state.notification, 'function')
    await Promise.all([unread.refreshUnreadCount(), notifications.fetchNotifications()])
  }
  async function deliver(id) {
    const message = { id: `message-${id}`, conversation_id: `conv-${id}`, sender_id: 'user-b' }
    state.conversations.push({
      id: message.conversation_id, buyer_id: user.id, seller_id: 'user-b',
      unread_messages: [{ id: message.id }],
    })
    await state.inbox(message)
    const row = {
      id: `notif-${id}`, user_id: user.id, type: 'follow',
      title: 'New follower', body: 'new_follower', is_read: false,
    }
    state.rows.push(row)
    await state.notification(row)
  }
  function assertState(count) {
    assert.equal(unread.unreadCount.value, count, 'message count updates')
    assert.equal(unread.unreadConvIds.value.size, count, 'message IDs update')
    assert.equal(state.applied.length, count, 'live conversation state updates')
    assert.equal(notifications.unreadNotifCount.value, count, 'notification count updates')
    assert.equal(notifications.notifications.value.length, count, 'notification list updates')
    assert.equal(state.stops, 0, 'neither listener is stopped')
  }
  function assertPrompts(shown) {
    const nativeTitles = state.native.map(toast => toast.title)
    assert.equal(nativeTitles.filter(title => title === 'msg.newMessage').length, shown ? 1 : 0)
    if (platform === 'H5' || bannerHost) {
      assert.equal(toast.useAppToast().toasts.value.length, shown ? 1 : 0, 'notification banner')
    } else {
      assert.equal(nativeTitles.length, shown ? 2 : 0, 'notification native fallback')
    }
  }
  function requiredGatePath() {
    const input = source('App.vue').match(/<script setup[^>]*>([\s\S]*?)<\/script>/)[1]
    const ast = ts.createSourceFile('App.ts', input, ts.ScriptTarget.Latest, true)
    const gate = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'requiredGatePath')
    assert.ok(gate, 'App retains its account gate')
    return new Function(
      'currentUser', 'authState', 'profileLoadState', 'CURRENT_CONSENT_VERSION', 'isSuspensionActive',
      `${compile(gate.getText(ast))}\nreturn requiredGatePath()`,
    )(currentUser, ref('authenticated'), ref('ready'), 'current',
      load('utils/suspension.ts').isSuspensionActive)
  }
  return {
    state, start, deliver, assertState, assertPrompts, requiredGatePath, uni,
    appToasts: toast.useAppToast(),
    resetPrompts() { state.native.length = 0; toast.useAppToast().toasts.value = [] },
  }
}

for (const platform of ['MP-WEIXIN', 'H5']) {
  for (const pageStack of ['empty', 'throws']) {
    test(`${platform} unavailable page stack (${pageStack}) keeps incoming prompts quiet`, async () => {
      const h = harness(platform)
      h.state.pageStack = pageStack
      await h.start()
      await h.deliver('startup')
      h.assertState(1)
      h.assertPrompts(false)
      h.uni.showToast({ title: 'error.network', icon: 'none' })
      h.appToasts.pushToast({ kind: 'system', title: 'error.network' })
      assert.deepEqual(h.state.native.map(toast => toast.title), ['error.network'])
      assert.deepEqual(h.appToasts.toasts.value.map(toast => toast.title), ['error.network'])
      h.resetPrompts()
      h.state.pageStack = 'ready'
      await h.deliver('ready')
      h.assertState(2)
      h.assertPrompts(true)
      assert.equal(h.state.watchers.length, 2, 'page availability does not restart listeners')
    })
  }
  for (const route of [...ACCOUNT_PAGES, NORMAL_PAGE]) {
    test(`${platform} ${route} gates both prompts while listeners update`, async () => {
      const h = harness(platform)
      h.state.route = route
      await h.start()
      await h.deliver('first')
      h.assertState(1)
      h.assertPrompts(route === NORMAL_PAGE)
    })
  }
  for (let level = 0; level <= 5; level++) {
    // D-49: only an active L5 is gated; L2-L4 browse and keep their prompts
    // (reads stay allowed). On pages/suspended itself no prompt (D-47 item 5).
    test(`${platform} active L${level} follows the D-49 gate and keeps listener state live`, async () => {
      const h = harness(platform, level)
      const target = h.requiredGatePath()
      assert.equal(target, level === 5 ? '/pages/suspended/index' : null)
      h.state.route = target?.slice(1) || NORMAL_PAGE
      await h.start()
      await h.deliver('level')
      h.assertState(1)
      h.assertPrompts(level < 5)
    })
  }
  for (const level of [2, 3, 4, 5]) {
    test(`${platform} expired L${level} returns to normal prompts with listener updates`, async () => {
      const h = harness(platform, level, true, true)
      assert.equal(h.requiredGatePath(), null)
      await h.start()
      await h.deliver('expired')
      h.assertState(1)
      h.assertPrompts(true)
    })
  }
  test(`${platform} page changes use the foreground route without restarting listeners`, async () => {
    const h = harness(platform)
    await h.start()
    await h.deliver('normal')
    h.assertState(1)
    h.assertPrompts(true)
    h.resetPrompts()
    h.state.route = ACCOUNT_PAGES[1]
    await h.deliver('gate')
    h.assertState(2)
    h.assertPrompts(false)
    h.state.route = NORMAL_PAGE
    await h.deliver('returned')
    h.assertState(3)
    h.assertPrompts(true)
    assert.equal(h.state.watchers.length, 2, 'one watcher per listener')
  })
  test(`${platform} account pages retain ordinary native and app toasts`, async () => {
    for (const route of ACCOUNT_PAGES) {
      const h = harness(platform)
      h.state.route = route
      await h.start()
      for (const title of ['auth.required', 'validation.required', 'error.network']) {
        h.uni.showToast({ title, icon: 'none' })
      }
      assert.deepEqual(h.state.native.map(toast => toast.title), [
        'auth.required', 'validation.required', 'error.network',
      ])
      h.appToasts.pushToast({ kind: 'system', title: 'error.network' })
      assert.deepEqual(h.appToasts.toasts.value.map(toast => toast.title), ['error.network'])
    }
  })
}

test('MP account pages suppress the notification native fallback without a banner host', async () => {
  for (const route of [...ACCOUNT_PAGES, NORMAL_PAGE]) {
    const h = harness('MP-WEIXIN', 0, false)
    h.state.route = route
    await h.start()
    await h.deliver('fallback')
    h.assertState(1)
    h.assertPrompts(route === NORMAL_PAGE)
  }
})
