import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'

/*
 * D-49 client: active L2-L4 accounts browse, but every write they are refused
 * on the server stops on the client first. L5 stays on pages/suspended.
 *
 * These tests run the real composables, page functions and templates with
 * synthetic transport, and count the writes, pickers and sheets that must not
 * happen. Each refused family has an L0/L1/expired control that must still
 * reach its mutation, so a guard that blocks everyone cannot pass.
 */

const require = createRequire(import.meta.url)
const Vue = require('vue')
const compiler = require('@vue/compiler-sfc')
const SRC = new URL('../src/', import.meta.url)
const source = path => readFileSync(new URL(path, SRC), 'utf8')
const exists = path => existsSync(new URL(path, SRC))

/* uni-app conditional compilation, as the H5 / mp-weixin compilers apply it. */
function platform(input, h5) {
  const enabled = [true]
  const out = []
  for (const line of input.split('\n')) {
    const d = line.match(/^\s*(?:\/\/|<!--|\/\*)\s*#(ifdef|ifndef|endif)\b\s*([\w-]*)/)
    if (!d) { if (enabled.at(-1)) out.push(line); continue }
    if (d[1] === 'endif') { enabled.pop(); continue }
    const on = d[2] === 'H5' ? h5 : d[2] === 'MP-WEIXIN' || d[2] === 'MP' ? !h5 : false
    enabled.push(enabled.at(-1) && (d[1] === 'ifdef' ? on : !on))
  }
  assert.equal(enabled.length, 1, 'unbalanced platform directives')
  return out.join('\n')
}

const autoModule = () => new Proxy({}, {
  get: (target, key) => key === '__esModule' ? true : (target[key] ??= () => undefined),
})

/* CommonJS evaluation with explicit mocks; any other relative import becomes
   inert stubs so a module's unrelated dependencies cannot do I/O. */
const compiled = new Map()
function loadModule(path, { h5 = true, mocks = {}, env = {} } = {}) {
  const key = `${h5}:${path}`
  if (!compiled.has(key)) {
    const input = platform(source(path), h5).replaceAll('import.meta.env', '__env')
    compiled.set(key, ts.transpileModule(input, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    }).outputText)
  }
  const js = compiled.get(key)
  const module = { exports: {} }
  const all = { ...commonMocks(), ...mocks }
  const req = spec => Object.hasOwn(all, spec) ? all[spec]() : spec === 'vue' ? Vue : autoModule()
  new Function('module', 'exports', 'require', '__env', js)(module, module.exports, req, env)
  return module.exports
}

/* Composables destructure these at creation; give them inert shapes. */
const commonMocks = () => ({
  './useI18n': () => ({ useI18n: () => ({ t: key => key, lang: Vue.ref('en') }) }),
  './useModeration': () => ({ useModeration: () => ({ ensureLoaded: async () => ({ ok: true }), blockedIds: Vue.ref(new Set()) }) }),
  './useDiscovery': () => ({ useDiscovery: () => ({ hiddenIds: Vue.ref(new Set()), loadHiddenItems: async () => {} }) }),
})

const messages = {
  en: loadModule('composables/i18n/messages/en.ts').default,
  zh: loadModule('composables/i18n/messages/zh.ts').default,
}
const translate = lang => (key, params = {}) => {
  const value = messages[typeof lang === 'string' ? lang : lang.value][key]
  assert.ok(typeof value === 'string', `missing translation ${key}`)
  return value.replace(/\{(\w+)\}/g, (_, name) => String(params[name]))
}
const suspensionModule = () => loadModule('utils/suspension.ts')
const utilsModule = (h5 = true) => loadModule('utils/index.ts', {
  h5,
  mocks: {
    './suspension': suspensionModule,
    '../composables/i18n/messages': () => ({ messages }),
  },
})

const UNTIL = '2100-12-03T12:34:56Z'
const PAST = '2000-01-01T00:00:00Z'
const TOKEN = { userId: 'user-a', generation: 1 }
const profile = (level, until = level === 5 ? 'infinity' : UNTIL) => ({
  id: 'user-a', tos_version: 'current', suspension_level: level, suspended_until: until,
})
const STATES = [
  ...[0, 1, 2, 3, 4, 5].map(level => ({ name: `L${level}`, level, user: profile(level), refused: level >= 2 })),
  ...[2, 3, 4, 5].map(level => ({ name: `expired L${level}`, level, user: profile(level, PAST), refused: false })),
]
const date = (lang, until) => new Date(until).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US')
/* 「账号受限」 plus the restore date, composed from the existing catalog keys. */
const restrictionText = (lang, until = UNTIL) => {
  const m = messages[lang]
  return `${m['suspended.badge']} · ${m['suspended.endsAt']} ${until ? date(lang, until) : m['suspended.endsPerma']}`
}
const untilOf = state => state.level === 5 ? null : UNTIL

function recognized(error) {
  const parse = suspensionModule().parseSuspensionRefusal
  assert.equal(typeof parse, 'function', 'utils/suspension.ts has no parseSuspensionRefusal')
  return parse(error)
}

/*
 * The restriction state module, bound to one synthetic account. Before D-49
 * the module does not exist; callers that never import it are unaffected,
 * which is exactly what makes the guard assertions below fail on the base.
 */
function restrictionRuntime(user, { lang = 'en', h5 = true } = {}) {
  const currentUser = Vue.ref(user)
  const langRef = Vue.ref(lang)
  const toasts = [], navigations = [], hostMounts = []
  const uni = {
    showToast: toast => toasts.push(toast),
    navigateTo: options => navigations.push(options.url),
    switchTab: options => navigations.push(options.url),
  }
  globalThis.uni = uni
  let mod = null
  if (exists('composables/useRestriction.ts')) {
    const utils = utilsModule(h5)
    mod = loadModule('composables/useRestriction.ts', {
      h5,
      mocks: {
        './useAuth': () => ({ useAuth: () => ({ currentUser }) }),
        './useI18n': () => ({ useI18n: () => ({ lang: langRef, t: translate(langRef) }) }),
        '../utils': () => utils,
        '../utils/suspension': suspensionModule,
        './useAppToast': () => ({ ensureToastHost: () => hostMounts.push(1) }),
      },
    })
  }
  return { currentUser, lang: langRef, toasts, navigations, hostMounts, mod, uni }
}
const requireRestriction = rt => {
  assert.ok(rt.mod, 'composables/useRestriction.ts does not exist')
  return rt.mod
}

/* A page/component function evaluated against an explicit scope; names the
   test does not care about resolve to inert recording stubs. */
function bindFunction(path, name, scope, { h5 = true } = {}) {
  const raw = path.endsWith('.vue')
    ? compiler.parse(platform(source(path), h5), { filename: path }).descriptor.scriptSetup.content
    : platform(source(path), h5)
  const ast = ts.createSourceFile(path, raw, ts.ScriptTarget.Latest, true)
  const node = ast.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === name)
  assert.ok(node, `${path}: missing ${name}`)
  const js = ts.transpileModule(node.getText(ast), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText
  const proxy = new Proxy(scope, {
    has: (target, key) => typeof key === 'string' && key !== name && (key in target || !(key in globalThis)),
    get: (target, key) => {
      if (key === Symbol.unscopables) return undefined
      if (!(key in target)) target[key] = () => undefined
      return target[key]
    },
    set: (target, key, value) => { target[key] = value; return true },
  })
  return new Function('__scope', `with (__scope) {\n${js}\nreturn ${name}\n}`)(proxy)
}

/* Synthetic PostgREST/Storage client that only records writes. */
function fakeSupabase({ existing = null, log = [] } = {}) {
  const table = name => {
    const chain = {
      insert: () => { log.push(`${name}.insert`); return chain },
      update: () => { log.push(`${name}.update`); return chain },
      delete: () => { log.push(`${name}.delete`); return chain },
      select: () => chain, eq: () => chain, or: () => chain, in: () => chain, neq: () => chain,
      maybeSingle: async () => ({ data: existing, error: null }),
      single: async () => ({ data: existing || { id: 'created' }, error: null }),
      then: (resolve, reject) => Promise.resolve({ data: null, error: null }).then(resolve, reject),
    }
    return chain
  }
  return {
    log,
    from: table,
    rpc: async name => { log.push(`rpc.${name}`); return { data: { id: 'rpc-row' }, error: null } },
    auth: { getSession: async () => ({ data: { session: { user: { id: 'user-a' }, access_token: 'jwt' } } }) },
    storage: {
      from: bucket => ({
        getPublicUrl: path => ({ data: { publicUrl: `https://proj.supabase.co/storage/v1/object/public/${bucket}/${path}` } }),
        upload: async () => { log.push(`${bucket}.upload`); return { error: null } },
        remove: async paths => { log.push(`${bucket}.remove:${paths.length}`); return { error: null } },
      }),
    },
  }
}
const accountScope = () => ({
  captureActiveAccountRequest: () => TOKEN,
  captureAccountRequest: () => TOKEN,
  isAccountRequestCurrent: () => true,
  getActiveAccountId: () => TOKEN.userId,
  onAccountTransition: () => () => {},
})

async function expectRefusal(promise, state) {
  let error
  try { await promise } catch (caught) { error = caught }
  assert.ok(error, `${state.name}: the write was allowed`)
  assert.equal(recognized(error)?.level, state.level, `${state.name}: ${error?.message}`)
}

// ---------------------------------------------------------------- parser

test('the suspension refusal parser accepts exactly suspension_active:<level>:<UTC seconds|permanent>', () => {
  const parse = recognized
  assert.deepEqual(parse({ code: 'P0001', message: 'suspension_active:2:2026-12-03T12:34:56Z' }), { level: 2, until: '2026-12-03T12:34:56Z' })
  assert.deepEqual(parse(new Error('suspension_active:5:permanent')), { level: 5, until: null })
  assert.deepEqual(parse('suspension_active:4:2026-12-03T00:00:00Z'), { level: 4, until: '2026-12-03T00:00:00Z' })
  // Storage relays the database message in a JSON body.
  assert.deepEqual(
    parse('{"statusCode":"403","error":"Unauthorized","message":"suspension_active:3:2026-12-03T12:34:56Z"}'),
    { level: 3, until: '2026-12-03T12:34:56Z' },
  )
  for (const value of [
    'suspension_active:2:', 'suspension_active:2:not-a-date', 'suspension_active:2',
    'suspension_active:1:permanent', 'suspension_active:6:permanent', 'suspension_active:x:permanent',
    'suspension_active:2:2026-13-03T12:34:56Z', 'suspension_active:2:2026-12-03T12:34:56.123Z',
    'prefix suspension_active:2:permanent', 'suspension_active:2:permanent trailing',
    { code: '42501', message: 'suspension_active:2:permanent' },
    { code: 'P0001', message: 'listing_quota_exceeded' },
    { status: 403, message: 'Forbidden' }, new Error('new row violates row-level security policy'),
    '{"statusCode":"403","message":"new row violates row-level security policy"}', '{not json',
    null, undefined, 42, {},
  ]) {
    assert.equal(parse(value), null, JSON.stringify(value ?? String(value)))
  }
})

test('client-side restriction errors round-trip through the same parser for every level', () => {
  const { activeRestriction, restrictionError } = suspensionModule()
  assert.equal(typeof activeRestriction, 'function', 'utils/suspension.ts has no activeRestriction')
  for (const state of STATES) {
    const restriction = activeRestriction(state.user)
    if (!state.refused) { assert.equal(restriction, null, state.name); continue }
    assert.deepEqual(restriction, { level: state.level, until: untilOf(state) }, state.name)
    const error = restrictionError(restriction)
    assert.equal(error.code, 'P0001')
    assert.deepEqual(recognized(error), restriction, state.name)
  }
  assert.equal(activeRestriction(null), null)
  assert.deepEqual(activeRestriction(profile(3, null)), { level: 3, until: null })
})

// ---------------------------------------------------------------- copy

for (const lang of ['en', 'zh']) {
  test(`a recognized refusal reads 「账号受限」 with the restore date in ${lang}`, () => {
    const { friendlyErrorMessage } = utilsModule()
    for (const level of [2, 3, 4, 5]) {
      assert.equal(friendlyErrorMessage({ code: 'P0001', message: `suspension_active:${level}:${UNTIL}` }, lang), restrictionText(lang))
    }
    assert.equal(friendlyErrorMessage(new Error('suspension_active:5:permanent'), lang), restrictionText(lang, null))
    for (const message of ['suspension_active:2:', 'suspension_active:2:not-a-date', 'suspension_active:2']) {
      const text = friendlyErrorMessage(new Error(message), lang)
      assert.equal(text, messages[lang]['suspended.badge'], message)
    }
    // The mini-program build formats the same way without the H5 i18n import.
    assert.equal(utilsModule(false).friendlyErrorMessage(new Error(`suspension_active:3:${UNTIL}`), lang), restrictionText(lang))
  })
}

// ---------------------------------------------------------------- Sentry

async function loadSentry() {
  const captures = []
  let options
  globalThis.__D49_SENTRY_ENV__ = { VITE_SENTRY_DSN: 'https://public@example.ingest.sentry.io/1' }
  globalThis.__D49_SENTRY__ = {
    init(value) { options = value },
    browserTracingIntegration: value => ({ value }),
    captureException(error, context) { captures.push({ error, context }) },
    addBreadcrumb() {},
  }
  const strip = text => text.replace(/^import [\s\S]*?from '[^']+'\n/gm, '')
  const sentry = source('utils/sentry.ts')
    .replace(/import \* as Sentry from '@sentry\/vue'/, 'const Sentry = globalThis.__D49_SENTRY__')
    .replaceAll('import.meta.env', 'globalThis.__D49_SENTRY_ENV__')
  const js = ts.transpileModule(
    `${source('utils/telemetryPrivacy.ts')}\n${strip(source('utils/suspension.ts'))}\n${strip(sentry)}`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } },
  ).outputText
  const mod = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}#${Math.random()}`)
  mod.initSentry({})
  return { mod, captures, options: () => options }
}

test('Sentry skips only a recognized restriction refusal, in capture and in beforeSend', async () => {
  const { mod, captures, options } = await loadSentry()
  const refusal = Object.assign(new Error(`suspension_active:3:${UNTIL}`), { code: 'P0001' })
  const others = [
    Object.assign(new Error('listing_quota_exceeded'), { code: 'P0001' }),
    Object.assign(new Error('Forbidden'), { status: 403 }),
    new Error('suspension_active:2:not-a-date'),
    Object.assign(new Error('new row violates row-level security policy'), { code: '42501' }),
  ]
  mod.captureException(refusal, { tags: { source: 'chat.offer' } })
  mod.captureException({ code: 'P0001', message: 'suspension_active:5:permanent' })
  assert.equal(captures.length, 0, 'an expected restriction was reported as an error')
  for (const error of others) mod.captureException(error)
  assert.equal(captures.length, others.length, 'unrelated P0001/403 failures must stay observable')

  const event = () => ({ exception: { values: [{ type: 'Error', value: 'Captured Error' }] }, tags: {} })
  assert.equal(options().beforeSend(event(), { originalException: refusal }), null)
  for (const error of others) {
    assert.notEqual(options().beforeSend(event(), { originalException: error }), null, error.message)
  }
  assert.notEqual(options().beforeSend(event(), {}), null)
})

// ---------------------------------------------------------------- notice

for (const lang of ['en', 'zh']) {
  test(`the restriction notice exists only for active L2-L4 in ${lang}`, () => {
    for (const state of STATES) {
      const rt = restrictionRuntime(state.user, { lang })
      const notice = Vue.unref(requireRestriction(rt).restrictionNotice)
      const shown = state.refused && state.level < 5
      assert.equal(notice, shown ? restrictionText(lang, untilOf(state)) : '', `${state.name}`)
    }
  })
}

test('the notice opens pages/suspended and follows sign-out and account switches', () => {
  const rt = restrictionRuntime(profile(3))
  const mod = requireRestriction(rt)
  assert.equal(Vue.unref(mod.restrictionNotice), restrictionText('en'))
  mod.openRestrictionDetails()
  assert.deepEqual(rt.navigations, ['/pages/suspended/index'])
  rt.currentUser.value = null
  assert.equal(Vue.unref(mod.restrictionNotice), '', 'the notice survived sign-out')
  rt.currentUser.value = { ...profile(0), id: 'user-b' }
  assert.equal(Vue.unref(mod.restrictionNotice), '', "account A's notice leaked to account B")
  rt.currentUser.value = { ...profile(2, '2101-01-02T00:00:00Z'), id: 'user-c' }
  assert.equal(Vue.unref(mod.restrictionNotice), restrictionText('en', '2101-01-02T00:00:00Z'))
  rt.lang.value = 'zh'
  assert.equal(Vue.unref(mod.restrictionNotice), restrictionText('zh', '2101-01-02T00:00:00Z'))
})

test('the notice disappears at expiry while the app stays open', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2100-12-03T12:00:00Z') })
  const rt = restrictionRuntime(profile(4))
  const mod = requireRestriction(rt)
  mod.startRestrictionNotice()
  await Vue.nextTick()
  assert.equal(Vue.unref(mod.restrictionNotice), restrictionText('en'))
  t.mock.timers.tick(30 * 60 * 1000)
  assert.equal(Vue.unref(mod.restrictionNotice), restrictionText('en'), 'expired early')
  t.mock.timers.tick(5 * 60 * 1000)
  assert.equal(Vue.unref(mod.restrictionNotice), '', 'a stale notice outlived the restriction')
  assert.equal(mod.stopIfRestricted(), false, 'writes stayed blocked after expiry')
})

test('H5 mounts the notice host for an active restriction without any toast', async () => {
  for (const state of STATES) {
    const rt = restrictionRuntime(state.user)
    requireRestriction(rt).startRestrictionNotice()
    await Vue.nextTick()
    assert.equal(rt.hostMounts.length > 0, state.refused && state.level < 5, state.name)
  }
})

test('the H5 toast host mounts once for the notice, separate from transient toasts', async () => {
  const appended = [], mounted = []
  globalThis.document = {
    createElement: () => ({}),
    body: { appendChild: node => appended.push(node) },
  }
  try {
    const mod = loadModule('composables/useAppToast.ts', {
      mocks: {
        vue: () => ({ ...Vue, createApp: () => ({ mount: host => mounted.push(host) }) }),
        './accountScope': accountScope,
        '../components/AppToast.vue': () => ({ default: {} }),
      },
    })
    assert.equal(typeof mod.ensureToastHost, 'function', 'the H5 host can only mount on a pushed toast')
    mod.ensureToastHost()
    mod.ensureToastHost()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(appended.length, 1)
    assert.equal(mounted.length, 1)
    assert.deepEqual(mod.useAppToast().toasts.value, [], 'the notice must not ride the transient toast array')
    mod.pushToast({ kind: 'system', title: 'x' })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(mounted.length, 1, 'a second host instance was mounted')
  } finally {
    delete globalThis.document
  }
})

function renderTemplate(path, values, { h5 = true } = {}) {
  const template = compiler.parse(platform(source(path), h5), { filename: path }).descriptor.template.content
  const { code, errors } = compiler.compileTemplate({
    source: template, filename: path, id: 'd49',
    compilerOptions: { mode: 'function', prefixIdentifiers: true },
  })
  assert.deepEqual(errors, [])
  const anything = new Proxy(() => '', { get: () => anything })
  const ctx = new Proxy(values, { get: (target, key) => key in target ? target[key] : anything, has: () => true })
  const nodes = []
  function walk(node, ancestors) {
    if (Array.isArray(node)) { node.forEach(child => walk(child, ancestors)); return }
    if (!node || typeof node !== 'object') return
    const entry = { props: node.props || {}, text: '' }
    nodes.push(entry)
    const chain = [...ancestors, entry]
    if (typeof node.children === 'string') chain.forEach(a => { a.text += node.children })
    else if (node.children && typeof node.children.default === 'function') walk(node.children.default(), chain)
    else walk(node.children, chain)
  }
  const warn = console.warn
  console.warn = () => {}
  try { walk(new Function('Vue', code)(Vue)(ctx, []), []) } finally { console.warn = warn }
  return nodes
}

for (const h5 of [true, false]) {
  test(`the ${h5 ? 'H5' : 'mini-program'} AppToast host renders the notice beside an empty toast stack`, () => {
    for (const state of STATES) {
      const rt = restrictionRuntime(state.user, { h5 })
      const mod = requireRestriction(rt)
      const nodes = renderTemplate('components/AppToast.vue', {
        toasts: [], restrictionNotice: Vue.unref(mod.restrictionNotice),
        openRestrictionDetails: mod.openRestrictionDetails, i18nT: translate('en'),
      }, { h5 })
      const notice = nodes.find(n => n.props.onClick === mod.openRestrictionDetails)
      if (state.refused && state.level < 5) {
        assert.ok(notice, `${state.name}: no tappable notice`)
        assert.ok(notice.text.includes(restrictionText('en')), notice.text)
      } else {
        assert.equal(notice, undefined, state.name)
      }
    }
  })
}

// ---------------------------------------------------------------- gate page

for (const lang of ['en', 'zh']) {
  test(`pages/suspended offers L2-L4 a way home and keeps L5 in place (${lang})`, () => {
    for (const level of [2, 3, 4, 5]) {
      const nodes = renderTemplate('pages/suspended/index.vue', {
        t: translate(lang), level, appealText: '', appealSubmitted: false,
        activeSuspension: { id: 's1', level, reason: 'spam', ends_at: level === 5 ? null : UNTIL },
      })
      const home = nodes.find(n => n.text.trim() === translate(lang)('nav.home') && n.props.onClick)
      assert.equal(!!home, level < 5, `L${level}`)
    }
    const switched = []
    bindFunction('pages/suspended/index.vue', 'goHome', { uni: { switchTab: o => switched.push(o.url) } })()
    assert.deepEqual(switched, ['/pages/index/index'])
  })
}

// ---------------------------------------------------------------- composable backstops

for (const state of STATES) {
  const verb = state.refused ? 'stop before' : 'reach'
  test(`${state.name}: offers, counters and responses ${verb} the RPC`, async () => {
    const rt = restrictionRuntime(state.user)
    const supabase = fakeSupabase()
    const { useOffers } = loadModule('composables/useOffers.ts', {
      mocks: {
        './useSupabase': () => ({ useSupabase: () => ({ supabase }) }),
        './accountScope': accountScope,
        './useRestriction': () => requireRestriction(rt),
      },
    })
    const offers = useOffers()
    const calls = [
      () => offers.makeOffer('conv-1', 20),
      () => offers.respondToOffer('offer-1', 'accept'),
      () => offers.respondToOffer('offer-1', 'decline'),
      () => offers.respondToOffer('offer-1', 'counter', 18),
    ]
    for (const call of calls) {
      if (state.refused) await expectRefusal(call(), state)
      else await call()
    }
    assert.deepEqual(supabase.log.length, state.refused ? 0 : 4)
  })

  test(`${state.name}: meetup propose, respond and reschedule ${verb} the RPC and the email`, async () => {
    const rt = restrictionRuntime(state.user)
    const supabase = fakeSupabase()
    supabase.auth.getSession = async () => ({ data: { session: null } })
    const fetches = []
    const { useMeetups } = loadModule('composables/useMeetups.ts', {
      mocks: {
        './useSupabase': () => ({ useSupabase: () => ({ supabase }), platformFetch: async url => { fetches.push(url) } }),
        './accountScope': accountScope,
        '../config/runtime': () => ({ BASE_URL: 'https://app.invalid' }),
        './useRestriction': () => requireRestriction(rt),
      },
    })
    const meetups = useMeetups()
    const calls = [
      () => meetups.proposeMeetup('conv-1', 'Union', UNTIL),
      () => meetups.respondToMeetup('meet-1', 'accept'),
      () => meetups.respondToMeetup('meet-1', 'decline'),
      () => meetups.respondToMeetup('meet-1', 'reschedule', 'Union', UNTIL),
      () => meetups.rescheduleAccepted('meet-1', 'Union', UNTIL),
    ]
    for (const call of calls) {
      if (state.refused) await expectRefusal(call(), state)
      else await call()
    }
    assert.equal(supabase.log.length, state.refused ? 0 : 5)
    assert.deepEqual(fetches, [])
  })

  test(`${state.name}: a transaction rating ${verb} the RPC`, async () => {
    const rt = restrictionRuntime(state.user)
    const supabase = fakeSupabase()
    const { useRatings } = loadModule('composables/useRatings.ts', {
      mocks: {
        './useSupabase': () => ({ useSupabase: () => ({ supabase }) }),
        './useAuth': () => ({ useAuth: () => ({ currentUser: rt.currentUser }) }),
        './accountScope': accountScope,
        './useRestriction': () => requireRestriction(rt),
      },
    })
    const call = useRatings().submitRating({ rateeId: 'seller-1', itemId: 'item-1', stars: 5 })
    if (state.refused) await expectRefusal(call, state)
    else await call
    assert.equal(supabase.log.length, state.refused ? 0 : 1)
  })

  test(`${state.name}: follow ${verb} the INSERT while unfollow stays allowed`, async () => {
    const rt = restrictionRuntime(state.user)
    const supabase = fakeSupabase()
    const { useFollow } = loadModule('composables/useFollow.ts', {
      mocks: {
        './useSupabase': () => ({ useSupabase: () => ({ supabase }) }),
        './useAuth': () => ({ useAuth: () => ({ currentUser: rt.currentUser }) }),
        './useModeration': () => ({ useModeration: () => ({ ensureLoaded: async () => ({ ok: true }), blockedIds: { value: new Set() } }) }),
        './accountScope': accountScope,
        './useRestriction': () => requireRestriction(rt),
      },
    })
    const follow = useFollow()
    follow.following.value = new Set(['followed-seller'])
    assert.equal(await follow.toggleFollow('followed-seller'), false)
    if (state.refused) await expectRefusal(follow.toggleFollow('new-seller'), state)
    else assert.equal(await follow.toggleFollow('new-seller'), true)
    assert.deepEqual(supabase.log, state.refused ? ['follows.delete'] : ['follows.delete', 'follows.insert'])
  })

  test(`${state.name}: post and reply likes ${verb} the INSERT while unlike stays allowed`, async () => {
    const rt = restrictionRuntime(state.user)
    const supabase = fakeSupabase()
    const { usePlaza } = loadModule('composables/usePlaza.ts', {
      mocks: {
        './useSupabase': () => ({ useSupabase: () => ({ supabase }) }),
        './useAuth': () => ({ useAuth: () => ({ currentUser: rt.currentUser }) }),
        './useModeration': () => ({ useModeration: () => ({ blockedIds: { value: new Set() } }) }),
        './useI18n': () => ({ useI18n: () => ({ t: translate('en'), lang: { value: 'en' } }) }),
        './accountScope': accountScope,
        '../utils/communityPost': () => loadModule('utils/communityPost.ts'),
        '../utils/region': () => loadModule('utils/region.ts'),
        './useRestriction': () => requireRestriction(rt),
      },
    })
    const plaza = usePlaza()
    const liked = { id: 'post-liked', like_count: 3, liked_by_me: true }
    const likedComment = { id: 'comment-liked', like_count: 3, liked_by_me: true }
    await plaza.toggleLike(liked)
    await plaza.toggleCommentLike(likedComment)
    const post = { id: 'post-new', like_count: 3, liked_by_me: false }
    const comment = { id: 'comment-new', like_count: 3, liked_by_me: false }
    if (state.refused) {
      await expectRefusal(plaza.toggleLike(post), state)
      await expectRefusal(plaza.toggleCommentLike(comment), state)
      assert.deepEqual([post.liked_by_me, post.like_count, comment.liked_by_me, comment.like_count], [false, 3, false, 3])
    } else {
      await plaza.toggleLike(post)
      await plaza.toggleCommentLike(comment)
    }
    assert.deepEqual(supabase.log, state.refused
      ? ['post_likes.delete', 'post_comment_likes.delete']
      : ['post_likes.delete', 'post_comment_likes.delete', 'post_likes.insert', 'post_comment_likes.insert'])
  })

  test(`${state.name}: new item conversations ${verb} the INSERT; existing ones still open`, async () => {
    const rt = restrictionRuntime(state.user)
    const load = existing => {
      const supabase = fakeSupabase({ existing })
      const { useMessages } = loadModule('composables/useMessages.ts', {
        mocks: {
          './useSupabase': () => ({ useSupabase: () => ({ supabase }) }),
          './accountScope': accountScope,
          './useRestriction': () => requireRestriction(rt),
        },
      })
      return { messages: useMessages(), supabase }
    }
    const peer = '22222222-2222-4222-8222-222222222222'
    const me = '11111111-1111-4111-8111-111111111111'
    const open = load({ id: 'conv-existing' })
    assert.equal((await open.messages.getOrCreateConversation('item-1', 'user-a', 'seller-1')).id, 'conv-existing')
    assert.equal((await open.messages.getOrCreateDirectConversation(me, peer)).id, 'conv-existing')
    assert.deepEqual(open.supabase.log, [])

    const fresh = load(null)
    const calls = [
      () => fresh.messages.getOrCreateConversation('item-1', 'user-a', 'seller-1'),
      () => fresh.messages.getOrCreateDirectConversation(me, peer),
    ]
    for (const call of calls) {
      if (state.refused) await expectRefusal(call(), state)
      else await call()
    }
    assert.deepEqual(fresh.supabase.log, state.refused ? [] : ['conversations.insert', 'conversations.insert'])
  })
}

function loadItems(rt, supabase, { h5 = true, uploads = [] } = {}) {
  const moderation = []
  const uni = {
    getFileInfo: o => o.success({ size: 100 }),
    uploadFile: options => {
      const response = uploads.shift() || { statusCode: 200, data: '{}' }
      uni.uploaded.push(options.filePath)
      setImmediate(() => options.success(response))
      return {}
    },
    uploaded: [],
  }
  globalThis.uni = Object.assign(globalThis.uni || {}, uni)
  const compress = []
  const items = loadModule('composables/useItems.ts', {
    h5,
    env: { VITE_SUPABASE_URL: 'https://proj.supabase.co' },
    mocks: {
      './useSupabase': () => ({ useSupabase: () => ({ supabase }) }),
      './accountScope': accountScope,
      './useRestriction': () => requireRestriction(rt),
      '../utils/suspension': suspensionModule,
      '../utils/itemStorage': () => loadModule('utils/itemStorage.ts'),
      '../api/mutationCommit': () => loadModule('api/mutationCommit.ts'),
      '../utils': () => ({
        compressImage: async file => { compress.push(file); return file },
        getImageDimensions: async () => ({ w: 800, h: 600 }),
        storedImageDimensions: dims => dims,
        detectImageMimeType: async () => 'image/jpeg',
        friendlyErrorMessage: error => String(error?.message || error),
        expandSearch: value => [value],
      }),
      '../utils/contentSafety': () => ({
        checkContent: () => ({ ok: true }),
        remoteModerate: async () => { moderation.push(1); return { flagged: false, categories: [] } },
        isLocalDuplicate: () => false, clearLocalDuplicate: () => {},
      }),
      '../utils/publicResource': () => ({
        assertPublicMediaWrite: () => {}, assertI18nWrite: () => {}, sanitizeItemResources: item => item,
      }),
      './useWechatSecCheck': () => ({ mpTextGate: async () => {}, mpImageCheck: async () => {} }),
      '../utils/listingDetails': () => ({ listingDetailsError: () => null, listingDetailsText: () => '' }),
    },
  }).useItems()
  return { items, moderation, compress, uni: globalThis.uni }
}

for (const state of STATES) {
  const verb = state.refused ? 'stop before' : 'reach'
  test(`${state.name}: item content edit and relist ${verb} the UPDATE; reserve stays allowed`, async () => {
    const rt = restrictionRuntime(state.user)
    const supabase = fakeSupabase({ existing: { id: 'item-1' } })
    const { items, moderation } = loadItems(rt, supabase)
    const calls = [
      () => items.updateItem('item-1', { title: 'New title', description: 'New description' }),
      () => items.updateItemStatus('item-1', 'active'),
    ]
    for (const call of calls) {
      if (state.refused) await expectRefusal(call(), state)
      else await call()
    }
    await items.updateItemStatus('item-1', 'reserved')
    assert.deepEqual(supabase.log, state.refused ? ['items.update'] : ['items.update', 'items.update', 'items.update'])
    assert.equal(moderation.length, state.refused ? 0 : 1, 'remote moderation ran for a refused edit')
  })

  test(`${state.name}: item image uploads ${verb} compression and Storage (mini-program)`, async () => {
    const rt = restrictionRuntime(state.user, { h5: false })
    const supabase = fakeSupabase()
    const { items, compress, uni } = loadItems(rt, supabase, { h5: false })
    const calls = [
      () => items.uploadImagesWithDims(['a.jpg', 'b.jpg']),
      () => items.uploadOneImage('avatar.jpg'),
    ]
    for (const call of calls) {
      if (state.refused) await expectRefusal(call(), state)
      else await call()
    }
    assert.equal(compress.length, state.refused ? 0 : 3)
    assert.equal(uni.uploaded.length, state.refused ? 0 : 3)
  })
}

test('a Storage restriction refusal stops the batch and cleans every uncommitted upload', async () => {
  const rt = restrictionRuntime(profile(0), { h5: false })
  const supabase = fakeSupabase()
  const refusal = {
    statusCode: 400,
    data: JSON.stringify({ statusCode: '403', error: 'Unauthorized', message: `suspension_active:2:${UNTIL}` }),
  }
  const { items, uni } = loadItems(rt, supabase, { h5: false, uploads: [{ statusCode: 200, data: '{}' }, refusal] })
  let error
  try { await items.uploadImagesWithDims(['a.jpg', 'b.jpg', 'c.jpg']) } catch (caught) { error = caught }
  assert.ok(error, 'the batch skipped the refused image and published a reduced set')
  assert.deepEqual(recognized(error), { level: 2, until: UNTIL })
  assert.deepEqual(uni.uploaded, ['a.jpg', 'b.jpg'], 'the batch kept uploading after a refusal')
  assert.deepEqual(supabase.log.filter(entry => entry.includes('remove')), ['item-images.remove:2'])
})

test('an unrelated Storage failure still skips only that image (control)', async () => {
  const rt = restrictionRuntime(profile(0), { h5: false })
  const supabase = fakeSupabase()
  const { items, uni } = loadItems(rt, supabase, {
    h5: false, uploads: [{ statusCode: 200, data: '{}' }, { statusCode: 500, data: '{"message":"Internal"}' }],
  })
  const result = await items.uploadImagesWithDims(['a.jpg', 'b.jpg', 'c.jpg'])
  assert.deepEqual(result.sourceIndices, [0, 2])
  assert.deepEqual(uni.uploaded, ['a.jpg', 'b.jpg', 'c.jpg'])
})

test('a single-image upload keeps the exact restriction refusal instead of wrapping it', async () => {
  const rt = restrictionRuntime(profile(0), { h5: false })
  const supabase = fakeSupabase()
  const { items } = loadItems(rt, supabase, {
    h5: false,
    uploads: [{ statusCode: 400, data: JSON.stringify({ statusCode: '403', message: 'suspension_active:5:permanent' }) }],
  })
  let error
  try { await items.uploadOneImage('avatar.jpg') } catch (caught) { error = caught }
  assert.deepEqual(recognized(error), { level: 5, until: null }, error?.message)
  assert.deepEqual(supabase.log.filter(entry => entry.includes('remove')), ['item-images.remove:1'])
})

// ---------------------------------------------------------------- entry points

/* Scope for an entry-point function, with the account's restriction state. */
function entryScope(rt, extra = {}) {
  const toasts = rt.toasts
  const pickers = []
  const navigations = rt.navigations
  const uni = Object.assign(rt.uni, {
    chooseImage: options => { pickers.push('image'); options.fail?.({ errMsg: 'chooseImage:fail cancel' }) },
    chooseVideo: options => { pickers.push('video'); options.fail?.({ errMsg: 'chooseVideo:fail cancel' }) },
    navigateTo: options => navigations.push(options.url),
    switchTab: options => navigations.push(options.url),
    reLaunch: options => navigations.push(options.url),
    showToast: toast => toasts.push(toast),
  })
  const restriction = rt.mod || { stopIfRestricted: () => false, assertWritesAllowed: () => {} }
  return {
    scope: {
      uni, t: translate('en'), lang: Vue.ref('en'), currentUser: rt.currentUser,
      document: undefined, HTMLElement: class {},
      awaitAuthReady: async () => 'authenticated', requireAuth: () => true,
      isAccountRequestCurrent: () => true, captureAccountRequest: () => TOKEN,
      captureActiveAccountRequest: () => TOKEN, getActiveAccountId: () => TOKEN.userId,
      isThreadEpochCurrent: () => true, threadEpoch: 1, nextTick: fn => fn?.(),
      stopIfRestricted: restriction.stopIfRestricted, assertWritesAllowed: restriction.assertWritesAllowed,
      ...suspensionModule(),
      ...extra,
    },
    pickers, navigations, toasts,
  }
}

const entries = [
  {
    name: 'chat offer sheet', path: 'components/ChatThread.vue', fn: 'openOfferSheet',
    extra: () => ({ offerSheet: Vue.ref({ open: false }), offerPriceInput: Vue.ref(''), offerNoteInput: Vue.ref('') }),
    opened: s => s.offerSheet.value.open === true,
  },
  {
    name: 'chat counter-offer sheet', path: 'components/ChatThread.vue', fn: 'openCounter', args: [{ id: 'offer-1' }],
    extra: () => ({ offerSheet: Vue.ref({ open: false }), offerPriceInput: Vue.ref(''), offerNoteInput: Vue.ref('') }),
    opened: s => s.offerSheet.value.open === true,
  },
  ...['openMeetupSheet', 'openReschedule', 'openRescheduleAccepted'].map(fn => ({
    name: `chat meetup sheet (${fn})`, path: 'components/ChatThread.vue', fn, args: [{ id: 'meet-1', spot: 'Union' }],
    extra: () => ({
      meetupSheet: Vue.ref({ open: false }), meetupSpotInput: Vue.ref(''), hasPendingMeetup: Vue.ref(false),
      hasConfirmedMeetup: Vue.ref(false), matchSpot: () => null, itemInfo: Vue.ref(null),
    }),
    opened: s => s.meetupSheet.value.open === true,
  })),
  {
    name: 'chat photo picker', path: 'components/ChatThread.vue', fn: 'chooseChatMedia', args: ['image'],
    extra: () => ({
      sending: Vue.ref(false), conversationAccessReady: Vue.ref(true), conversationUnavailable: Vue.ref(false),
      conversationId: Vue.ref('conv-1'),
    }),
    opened: (s, h) => h.pickers.length === 1,
  },
  {
    name: 'chat quick reply', path: 'components/ChatThread.vue', fn: 'sendQuickReply', args: ['Is it available?'],
    extra: () => ({ conversationId: Vue.ref('conv-1'), sent: [], sendWithLocalEcho: async (...a) => { entriesSent.push(a) } }),
    opened: () => entriesSent.length === 1,
  },
  {
    name: 'chat sticker', path: 'components/ChatThread.vue', fn: 'onPickSticker', args: ['smile'],
    extra: () => ({ conversationId: Vue.ref('conv-1'), sending: Vue.ref(false), stickerToken: n => `[sticker:${n}]`, sendWithLocalEcho: async (...a) => { entriesSent.push(a) } }),
    opened: () => entriesSent.length === 1,
  },
  {
    name: 'rating sheet', path: 'pages/detail/index.vue', fn: 'openRating',
    extra: () => ({
      item: Vue.ref({ id: 'item-1' }), canRate: Vue.ref(true), ratingTargetId: Vue.ref('seller-1'),
      showRating: Vue.ref(false), ratingStars: Vue.ref(0), ratingComment: Vue.ref(''),
    }),
    opened: s => s.showRating.value === true,
  },
  {
    name: 'item edit from detail', path: 'pages/detail/index.vue', fn: 'goEdit',
    extra: () => ({ item: Vue.ref({ id: 'item-1' }) }),
    opened: (s, h) => h.navigations.length === 1,
  },
  {
    name: 'item edit from profile', path: 'pages/profile/index.vue', fn: 'goEdit', args: ['item-1'],
    opened: (s, h) => h.navigations.length === 1,
  },
  {
    name: 'public profile editor', path: 'pages/profile/index.vue', fn: 'onEditProfile',
    opened: (s, h) => h.navigations.length === 1,
  },
  {
    name: 'avatar picker', path: 'pages/profile/edit.vue', fn: 'onChangeAvatar',
    extra: () => ({ profileEditReady: Vue.ref(true), pageAccountToken: TOKEN }),
    opened: (s, h) => h.pickers.length === 1,
  },
  {
    name: 'listing photo picker', path: 'pages/publish/index.vue', fn: 'chooseImage',
    extra: () => ({ submitting: Vue.ref(false), publishPageAccountToken: TOKEN, imageList: Vue.ref([]), MAX_IMAGES_PUBLISH: 9 }),
    opened: (s, h) => h.pickers.length === 1,
  },
  {
    name: 'edit photo picker', path: 'pages/publish/edit.vue', fn: 'chooseImage',
    extra: () => ({ submitting: Vue.ref(false), editReady: Vue.ref(true), editPageAccountToken: TOKEN, imageList: Vue.ref([]), MAX_IMAGES_PUBLISH: 9 }),
    opened: (s, h) => h.pickers.length === 1,
  },
  {
    name: 'tab bar publish', path: 'components/CustomTabBar.vue', fn: 'go', args: ['/pages/publish/index'],
    opened: (s, h) => h.navigations.length === 1,
  },
  {
    name: 'sidebar publish', path: 'components/AppSidebar.vue', fn: 'go', args: ['/pages/publish/index'],
    opened: (s, h) => h.navigations.length === 1,
  },
  {
    name: 'home publish intent', path: 'pages/index/index.vue', fn: 'goPublish',
    extra: () => ({ listingType: Vue.ref('sell'), selectedCategory: Vue.ref('') }),
    opened: (s, h) => h.navigations.length === 1,
  },
]
let entriesSent = []

for (const entry of entries) {
  for (const state of STATES) {
    test(`${state.name}: ${entry.name} ${state.refused ? 'does not open' : 'opens'}`, async () => {
      entriesSent = []
      const rt = restrictionRuntime(state.user)
      const h = entryScope(rt, entry.extra?.())
      await bindFunction(entry.path, entry.fn, h.scope)(...(entry.args || []))
      assert.equal(entry.opened(h.scope, h), !state.refused)
      if (state.refused) {
        assert.equal(h.pickers.length, 0)
        if (state.level < 5) assert.deepEqual(h.toasts.map(t => t.title), [restrictionText('en')])
      }
    })
  }
}

test('non-publish tab switches stay available to restricted accounts (control)', () => {
  const rt = restrictionRuntime(profile(3))
  const h = entryScope(rt)
  bindFunction('components/CustomTabBar.vue', 'go', h.scope)('/pages/messages/index')
  bindFunction('components/AppSidebar.vue', 'go', h.scope)('/pages/plaza/index')
  assert.deepEqual(h.navigations, ['/pages/messages/index', '/pages/plaza/index'])
})

// ---------------------------------------------------------------- chat send

function chatFixture(user, { lang = 'en', send } = {}) {
  const rt = restrictionRuntime(user, { lang })
  const sends = []
  const h = entryScope(rt, {
    lang: Vue.ref(lang), t: translate(lang),
    inputText: Vue.ref('hello there'), conversationId: Vue.ref('conv-1'), sending: Vue.ref(false),
    replyToMsg: Vue.ref(null), messages: Vue.ref([]), chatInputRef: Vue.ref(null), inputFocused: Vue.ref(false),
    friendlyErrorMessage: utilsModule().friendlyErrorMessage, discardPendingMessage: () => {},
    reconcileSentMessage: () => {}, refreshReadState: () => {}, scrollToBottom: () => {},
    replyPreview: msg => msg.content,
  })
  const s = h.scope
  s.setComposerText = value => { s.inputText.value = value }
  s.createOptimisticMessage = (conversationId, senderId, content) => {
    s.messages.value.push({ id: 'tmp-1', sender_id: senderId, content, message_type: 'text', _pending: true })
    return 'tmp-1'
  }
  s.sendMessage = async (...args) => {
    sends.push(args)
    if (send) return send(s)
    return { id: 'tmp-1' }
  }
  s.failOptimisticMessage = bindFunction('components/ChatThread.vue', 'failOptimisticMessage', s)
  return {
    ...h, scope: s, sends,
    onSend: bindFunction('components/ChatThread.vue', 'onSend', s),
    retrySend: bindFunction('components/ChatThread.vue', 'retrySend', s),
  }
}

/* The bubble status the ChatThread template renders for one of my messages:
   the first matching branch of its v-if / v-else-if chain. */
function chatStatus(msg) {
  const path = 'components/ChatThread.vue'
  const ast = compiler.parse(platform(source(path), true), { filename: path }).descriptor.template.ast
  const condition = node => node.props?.find(p => p.type === 7 && ['if', 'else-if'].includes(p.name))
  let chain = null
  ;(function find(node) {
    if (chain || !node.children) return
    const start = node.children.findIndex(child =>
      condition(child)?.name === 'if' && /_pending/.test(condition(child).exp.content)
      && /msg-status/.test(child.props.find(p => p.name === 'class')?.value?.content || ''))
    if (start >= 0) {
      chain = []
      for (const child of node.children.slice(start)) {
        if (child.type !== 1) continue
        const c = condition(child)
        const isElse = child.props?.some(p => p.type === 7 && p.name === 'else')
        if (chain.length && !(c?.name === 'else-if' || isElse)) break
        chain.push(child)
        if (isElse) break
      }
      return
    }
    node.children.forEach(find)
  })(ast)
  assert.ok(chain?.length >= 3, 'ChatThread status chain not found')
  const currentUser = { id: 'user-a' }
  const branch = chain.find(node => {
    const c = condition(node)
    return !c || new Function('entry', 'currentUser', `return (${c.exp.content})`)({ msg }, currentUser)
  })
  const text = JSON.stringify(branch.children)
  return {
    retry: branch.props.some(p => p.type === 7 && p.name === 'on' && p.arg?.content === 'click'),
    sendFailed: text.includes('chat.sendFailed'),
  }
}

const refusalError = () => Object.assign(new Error(`suspension_active:3:${UNTIL}`), { code: 'P0001' })

for (const state of STATES) {
  test(`${state.name}: typed chat send ${state.refused ? 'is stopped before the optimistic bubble' : 'is sent'}`, async () => {
    const h = chatFixture(state.user)
    await h.onSend()
    assert.equal(h.sends.length, state.refused ? 0 : 1)
    if (state.refused) {
      assert.equal(h.scope.inputText.value, 'hello there', 'the draft was cleared')
      assert.deepEqual(h.scope.messages.value, [])
      if (state.level < 5) assert.deepEqual(h.toasts.map(t => t.title), [restrictionText('en')])
    }
  })
}

for (const lang of ['en', 'zh']) {
  test(`a server restriction refusal is terminal, with no retry, and returns the draft (${lang})`, async () => {
    const h = chatFixture(profile(0), { lang, send: () => { throw refusalError() } })
    await h.onSend()
    assert.equal(h.sends.length, 1)
    assert.equal(h.scope.inputText.value, 'hello there', 'the refused text was lost')
    assert.equal(h.scope.messages.value.some(m => chatStatus(m).retry), false, 'a retry affordance was offered')
    assert.deepEqual(h.toasts.map(t => t.title), [restrictionText(lang)])
  })
}

test('a refusal never overwrites a newer draft; the refused bubble stays without retry', async () => {
  const h = chatFixture(profile(0), {
    send: s => { s.inputText.value = 'a newer draft'; throw refusalError() },
  })
  await h.onSend()
  assert.equal(h.scope.inputText.value, 'a newer draft')
  assert.equal(h.scope.messages.value.length, 1)
  const status = chatStatus(h.scope.messages.value[0])
  assert.deepEqual(status, { retry: false, sendFailed: false })
  await h.retrySend(h.scope.messages.value[0])
  assert.equal(h.sends.length, 1, 'a refused bubble was resent')
})

test('a retry refused by the server becomes terminal instead of retryable again', async () => {
  const h = chatFixture(profile(0), { send: () => { throw refusalError() } })
  const msg = { id: 'tmp-9', sender_id: 'user-a', content: 'resend me', message_type: 'text', _failed: true }
  h.scope.messages.value.push(msg)
  await h.retrySend(msg)
  assert.equal(h.sends.length, 1)
  assert.deepEqual(chatStatus(h.scope.messages.value[0]), { retry: false, sendFailed: false })
})

test('a retry while the account is known to be restricted sends nothing', async () => {
  const h = chatFixture(profile(2))
  const msg = { id: 'tmp-9', sender_id: 'user-a', content: 'resend me', message_type: 'text', _failed: true }
  h.scope.messages.value.push(msg)
  await h.retrySend(msg)
  assert.equal(h.sends.length, 0)
  assert.equal(chatStatus(h.scope.messages.value[0]).retry, false)
})

test('unknown-delivery and network failures keep the existing tap-to-retry bubble (control)', async () => {
  const h = chatFixture(profile(0), { send: () => { throw new TypeError('Failed to fetch') } })
  await h.onSend()
  assert.equal(h.scope.messages.value.length, 1)
  assert.equal(h.scope.messages.value[0]._failed, true)
  assert.deepEqual(chatStatus(h.scope.messages.value[0]), { retry: true, sendFailed: true })
  assert.equal(h.scope.inputText.value, '')
})
