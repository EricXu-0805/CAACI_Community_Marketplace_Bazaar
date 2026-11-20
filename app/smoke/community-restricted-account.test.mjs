import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const compiler = require('@vue/compiler-sfc')
const Vue = require('vue')
const source = path => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')
const compile = input => ts.transpileModule(input, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText
function load(path) {
  const module = { exports: {} }
  new Function('module', 'exports', compile(source(path)))(module, module.exports)
  return module.exports
}
const suspension = load('utils/suspension.ts')
const messages = {
  en: load('composables/i18n/messages/en.ts').default,
  zh: load('composables/i18n/messages/zh.ts').default,
}
const UNTIL = '2100-12-03T12:34:56Z'
const profile = (level, until = level === 5 ? 'infinity' : UNTIL) => ({
  id: 'user-a', tos_version: 'current', suspension_level: level, suspended_until: until,
})
const translate = lang => (key, params = {}) => {
  assert.ok(key in messages[lang], key)
  return messages[lang][key].replace(/\{(\w+)\}/g, (_, name) => String(params[name]))
}
const script = path => compiler.parse(source(path), { filename: path }).descriptor.scriptSetup.content
function functionSource(path, name) {
  const input = script(path)
  const ast = ts.createSourceFile(path, input, ts.ScriptTarget.Latest, true)
  const node = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)
  assert.ok(node, `${path}: missing ${name}`)
  return node.getText(ast)
}
function bind(input, name, scope) {
  return new Function(...Object.keys(scope), `${compile(input)}\nreturn ${name}`)(...Object.values(scope))
}
function replyState(path, currentUser) {
  // Evaluate the page's actual computed declaration. Before the fix there is
  // no restriction binding and the existing template always offers an input.
  const ast = ts.createSourceFile(path, script(path), ts.ScriptTarget.Latest, true)
  const declaration = ast.statements.filter(ts.isVariableStatement)
    .flatMap(node => [...node.declarationList.declarations])
    .find(node => node.name.getText(ast) === 'replyRestricted')
  if (!declaration) return {}
  return {
    replyRestricted: new Function('computed', 'currentUser', 'isSuspensionActive',
      `${compile(`const value = ${declaration.initializer.getText(ast)}`)}\nreturn value`)(
      Vue.computed, currentUser, suspension.isSuspensionActive,
    ),
  }
}
function gate(user, extra = {}) {
  return bind(functionSource('App.vue', 'requiredGatePath'), 'requiredGatePath', {
    ...suspension,
    currentUser: Vue.ref(user), authState: Vue.ref('authenticated'),
    profileLoadState: Vue.ref('ready'), CURRENT_CONSENT_VERSION: 'current', ...extra,
  })()
}
function composer(user, lang) {
  const state = { toasts: [], redirects: [], draftReads: 0 }
  const token = { userId: user?.id, generation: 1 }
  const scope = {
    ...suspension,
    currentUser: Vue.ref(user), lang: Vue.ref(lang), t: translate(lang),
    awaitAuthReady: async () => {}, requireAuth: () => !!user,
    uni: { showToast: toast => state.toasts.push(toast), reLaunch: route => state.redirects.push(route) },
    composerDialogOpener: null, activeElement: () => null,
    composerSessionId: 0, composerAccountToken: null,
    captureAccountRequest: () => token, isAccountRequestCurrent: candidate => candidate === token,
    createClientMessageId: () => 'new-post', composerRetryCreate: false,
    selectedCategory: Vue.ref('campus-life'), nextTick: callback => callback(),
    COMPOSER_DRAFT_KEY: 'draft', POST_CATEGORIES: ['campus-life'],
    readAccountPrivateStorage: () => { state.draftReads++; return { value: null } },
  }
  for (const name of [
    'composerPostId', 'outcomeUncertain', 'publicationMissing', 'draftRestored',
    'composerMode', 'composerTitle', 'composerCategory', 'composerErrors',
    'composerText', 'composerImages', 'composerAttachedItems', 'showAttachSheet',
    'composerFocused', 'showComposer',
  ]) scope[name] = Vue.ref(null)
  scope.showComposer.value = false
  return Object.assign(state, { scope, open: bind(functionSource('pages/plaza/index.vue', 'openComposer'), 'openComposer', scope) })
}
function replyFixture(path, user, lang) {
  const currentUser = Vue.ref(user)
  const token = { userId: user?.id, generation: 1 }
  const state = { writes: [], toasts: [] }
  const scope = {
    ...suspension, ...replyState(path, currentUser),
    currentUser, lang: Vue.ref(lang), t: translate(lang),
    awaitAuthReady: async () => {}, requireAuth: () => !!user,
    commentText: Vue.ref('A preserved reply'), replyTo: Vue.ref(null),
    post: Vue.ref({ id: 'post-1', comment_count: 0 }),
    commentingPost: Vue.ref({ id: 'post-1' }),
    comments: Vue.ref([]), commentSubmitting: Vue.ref(false), submitting: Vue.ref(false),
    inputFocused: Vue.ref(false), commentSheetEpoch: 1,
    captureAccountRequest: () => token, isAccountRequestCurrent: candidate => candidate === token,
    uni: { showToast: toast => state.toasts.push(toast) },
    createComment: async (...args) => {
      state.writes.push(args)
      return { id: 'reply-1', content: args[1] }
    },
    friendlyErrorMessage: error => { throw error },
  }
  return {
    ...state, scope,
    submit: bind(functionSource(path, 'onSubmitComment'), 'onSubmitComment', scope),
    select: bind(functionSource(path, 'onCommentTap'), 'onCommentTap', scope),
  }
}

// Render the actual reply container using the same Vue compiler/VNode approach
// as page-state-roots-are-one-chain.test.mjs.
function renderedReply(path, user, lang) {
  const currentUser = Vue.ref(user)
  const ast = compiler.parse(source(path), { filename: path }).descriptor.template.ast
  const containerClass = path.includes('/plaza/') ? 'comment-sheet' : 'input-wrapper'
  function find(node) {
    const classes = node.props?.find(prop => prop.type === 6 && prop.name === 'class')?.value?.content || ''
    if (classes.split(/\s+/).includes(containerClass)) return node
    return node.children?.map(find).find(Boolean)
  }
  const container = find(ast)
  assert.ok(container, `missing ${containerClass}`)
  const { code, errors } = compiler.compileTemplate({
    source: container.loc.source, filename: path, id: 'restriction',
    compilerOptions: { mode: 'function', prefixIdentifiers: true },
  })
  assert.deepEqual(errors, [])
  const bindings = replyState(path, currentUser)
  const state = {
    ...Object.fromEntries(Object.entries(bindings).map(([key, value]) => [key, Vue.unref(value)])),
    t: translate(lang), post: { id: 'post-1' }, commentingPost: { id: 'post-1' },
    comments: [], commentThreads: [], commentText: 'A preserved reply',
    replyTo: { profile: { nickname: 'Bob' } }, loadingComments: false,
    commentsError: false, expandedReplies: new Set(),
  }
  const anything = new Proxy(() => '', { get: () => anything })
  const ctx = new Proxy(state, { get: (target, key) => key in target ? target[key] : anything })
  const result = { inputs: 0, text: '', classes: [] }
  function walk(node) {
    if (typeof node === 'string') { result.text += node; return }
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (['input', 'textarea'].includes(node.type)) result.inputs++
    result.classes.push(node.props?.class || '')
    walk(node.children)
  }
  const warn = console.warn
  console.warn = () => {}
  try { walk(new Function('Vue', code)(Vue)(ctx, [])) } finally { console.warn = warn }
  return result
}

for (let level = 0; level <= 5; level++) {
  // D-49: the server now refuses L2-L5 writes, so only permanent L5 keeps the
  // account gate; active L2-L4 browse with a notice and per-action guards.
  test(`L${level} ${messages.en[`suspended.l${level}Name`]} keeps the account gate only when permanent`, () => {
    assert.equal(gate(profile(level)), level === 5 ? '/pages/suspended/index' : null)
  })
  for (const lang of ['en', 'zh']) {
    test(`L${level} composer opens or stops before touching the draft in ${lang}`, async () => {
      const h = composer(profile(level), lang)
      await h.open()
      assert.equal(h.scope.showComposer.value, level < 2)
      assert.equal(h.scope.composerFocused.value === true, level < 2)
      assert.equal(h.scope.composerPostId.value === 'new-post', level < 2)
      if (level >= 2 && level < 5) {
        const date = new Date(UNTIL).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US')
        assert.deepEqual(h.toasts.map(toast => toast.title), [translate(lang)('plaza.restrictedPost', { date })])
      } else assert.deepEqual(h.toasts, [])
      assert.equal(h.draftReads, level < 2 ? 1 : 0)
      assert.deepEqual(h.redirects, level === 5 ? [{ url: '/pages/suspended/index' }] : [])
    })
    for (const path of ['pages/plaza/index.vue', 'pages/post/index.vue']) {
      test(`L${level} ${path} renders the correct reply box in ${lang}`, () => {
        const rendered = renderedReply(path, profile(level), lang)
        assert.equal(rendered.inputs, level < 2 ? 1 : 0)
        const restrictedReply = lang === 'zh' ? '账号受限期间不能回复' : "You can't reply while your account is restricted."
        assert.equal(rendered.text.includes(restrictedReply), level >= 2)
        if (level >= 2) assert.doesNotMatch(rendered.classes.join(' '), /\b(?:ci-send|send-btn|ci-reply-bar|reply-bar)\b/)
      })
      test(`L${level} ${path} reply submission respects restriction in ${lang}`, async () => {
        const h = replyFixture(path, profile(level), lang)
        await h.submit()
        assert.equal(h.writes.length, level < 2 ? 1 : 0)
        if (level >= 2) {
          assert.equal(h.scope.commentText.value, 'A preserved reply')
          assert.deepEqual(h.scope.comments.value, [])
          assert.equal(h.scope.commentSubmitting.value, false)
          assert.equal(h.scope.submitting.value, false)
        }
      })
      test(`L${level} ${path} reply selection respects restriction in ${lang}`, async () => {
        const h = replyFixture(path, profile(level), lang)
        await h.select({ id: 'reply-target' })
        assert.equal(h.scope.replyTo.value?.id || null, level < 2 ? 'reply-target' : null)
      })
    }
  }
}

test('expired L2-L5 restrictions allow browsing and composing again', async () => {
  for (const level of [2, 3, 4, 5]) {
    const user = profile(level, '2000-01-01T00:00:00Z')
    assert.equal(gate(user), null)
    const h = composer(user, 'en')
    await h.open()
    assert.equal(h.scope.showComposer.value, true)
    for (const path of ['pages/plaza/index.vue', 'pages/post/index.vue']) {
      assert.equal(renderedReply(path, user, 'en').inputs, 1)
    }
  }
})

test('restriction changes retain profile-recovery, consent, and unauthenticated controls', async () => {
  assert.equal(gate(profile(2), { profileLoadState: Vue.ref('loading') }), '/pages/profile-recovery/index')
  assert.equal(gate({ ...profile(2), tos_version: '0' }), '/pages/reconsent/index')
  assert.equal(gate({ ...profile(5), tos_version: '0' }), '/pages/suspended/index')
  assert.equal(gate({ ...profile(1), tos_version: '0' }), '/pages/reconsent/index')
  assert.equal(gate(null), null)
  const h = composer(null, 'en')
  await h.open()
  assert.equal(h.scope.showComposer.value, false)
})
