import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { communityNavigation, communityRouting, openCommunityBoard, POST_CATEGORIES } from './helpers/community-routing-harness.mjs'

const source = path => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')
const compile = input => ts.transpileModule(input, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText
const moduleUrl = input => `data:text/javascript;base64,${Buffer.from(compile(input)).toString('base64')}`
const { normalizePostTopic, hiddenTopicShare } = await import(moduleUrl(source('utils/communityPost.ts')))
const { isSuspensionActive } = await import(moduleUrl(source('utils/suspension.ts')))
const plaza = source('pages/plaza/index.vue')
const postPage = source('pages/post/index.vue')
const POST = '33333333-3333-4333-8333-333333333333'

// Execute the actual page lifecycle callback, retaining its TypeScript casts.
function hook(page, name, dependencies) {
  const script = page.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const ast = ts.createSourceFile('page.ts', script, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
  const statement = ast.statements.find(node => ts.isExpressionStatement(node)
    && ts.isCallExpression(node.expression) && node.expression.expression.getText(ast) === name)
  assert.ok(statement, `${name} must be registered by the page`)
  const callback = statement.expression.arguments[0].getText(ast)
  return new Function(...Object.keys(dependencies), compile(`const callback = ${callback};\nreturn callback;`))(...Object.values(dependencies))
}

// The page's own onLoad, onShow and views, as the mini program compiles them.
function navigationFixture() {
  communityNavigation.pendingBoard = null
  communityNavigation.pendingView = null
  const switches = []
  const routing = communityRouting('MP-WEIXIN', {
    uni: {
      switchTab(options) {
        switches.push({ ...options, pendingBoard: communityNavigation.pendingBoard, pendingView: communityNavigation.pendingView })
      },
    },
  })
  routing.activeTab.value = 'following'
  routing.searchText.value = 'old search'
  // Selecting a board reads the list for it, so each read names the board that was selected.
  return { ...routing, switches, selected: routing.feedReads }
}

test('board links stage pendingBoard before switchTab and onShow consumes and clears it once', () => {
  const h = navigationFixture()
  openCommunityBoard('events-social')
  assert.deepEqual(h.switches, [{ url: '/pages/plaza/index', pendingBoard: 'events-social', pendingView: null }])
  h.onLoad({})
  h.onShow()
  assert.deepEqual(h.selected, ['events-social'])
  assert.equal(h.view.value, 'board')
  assert.equal(h.selectedCategory.value, 'events-social')
  // A board page has no 关注的人, so it opens on the first tab, 最新回复 (P3.4).
  assert.equal(h.activeTab.value, 'active')
  assert.equal(h.searchText.value, '')
  assert.deepEqual(communityNavigation, { pendingBoard: null, pendingView: null })
  h.onShow()
  assert.deepEqual(h.selected, ['events-social'], 'a later tab visit must not replay the handoff')
  assert.equal(h.view.value, 'board')
  assert.match(postPage, /@click\.stop="openCommunityBoard\(post\.category\)"/)
  assert.match(postPage, /@keydown\.enter\.prevent="openCommunityBoard\(post\.category\)"/)
})

test('direct board query parameters select each supported board and are cleared on show', async () => {
  for (const board of POST_CATEGORIES) {
    const h = navigationFixture()
    h.onLoad({ board })
    h.onShow()
    assert.equal(h.view.value, 'board')
    assert.equal(h.selectedCategory.value, board)
    await h.mounted()
    assert.deepEqual(h.selected, [board], 'the first read lists the board the path named')
    assert.deepEqual(h.homeReads, [])
    assert.deepEqual(communityNavigation, { pendingBoard: null, pendingView: null })
  }
})

// SPEC 4.4: an unknown board or view opens the forum home; view=all is the unfiltered list.
test('unknown boards and views open the forum home, and view=all the unfiltered community feed', async () => {
  for (const options of [{ board: 'unknown' }, { board: '' }, { view: 'unknown' }, { view: '' }, { board: 'unknown', view: 'unknown' }]) {
    const h = navigationFixture()
    h.onLoad(options)
    h.onShow()
    await h.mounted()
    assert.equal(h.view.value, 'home')
    assert.equal(h.selectedCategory.value, null)
    assert.deepEqual(h.selected, [], 'the home reads no list')
    assert.equal(h.homeReads.length, 1)
    assert.equal(communityNavigation.pendingBoard, null)
    assert.equal(communityNavigation.pendingView, null)
  }
  const h = navigationFixture()
  h.onLoad({ view: 'all' })
  h.onShow()
  await h.mounted()
  assert.equal(h.view.value, 'all')
  assert.deepEqual(h.selected, [null])
  assert.deepEqual(h.homeReads, [])
  assert.equal(communityNavigation.pendingBoard, null)
  assert.equal(communityNavigation.pendingView, null)
})

test('pendingView is consumed and cleared, and a later board intent replaces it', () => {
  let h = navigationFixture()
  communityNavigation.pendingView = 'all'
  h.onShow()
  assert.deepEqual(h.selected, [null])
  assert.equal(h.view.value, 'all')
  assert.deepEqual(communityNavigation, { pendingBoard: null, pendingView: null })
  h = navigationFixture()
  communityNavigation.pendingView = 'all'
  openCommunityBoard('campus-life')
  h.onShow()
  assert.deepEqual(h.selected, ['campus-life'])
  assert.equal(h.view.value, 'board')
  assert.deepEqual(communityNavigation, { pendingBoard: null, pendingView: null })
})

test('an ordinary onShow preserves the current community selection and search', () => {
  const h = navigationFixture()
  h.onShow()
  assert.deepEqual(h.selected, [])
  assert.deepEqual(h.homeReads, [])
  assert.equal(h.view.value, 'home')
  assert.equal(h.activeTab.value, 'following')
  assert.equal(h.searchText.value, 'old search')
})

test('mini-program topic shares use the original title, at most 50 Unicode characters, and the permanent post path', () => {
  for (const title of ['A campus question', '\u754c'.repeat(70), '\u{1f33d}'.repeat(70)]) {
    let translations = 0
    const post = { value: { id: POST, title, content: 'Body', content_i18n: { en: 'Translated body' }, images: ['photo'] } }
    const dependencies = { post, t: () => 'Community', localize: () => { translations++; return 'Translated body' }, goneState: { value: null }, postId: { value: POST }, hiddenTopicShare }
    const share = hook(postPage, 'onShareAppMessage', dependencies)()
    assert.equal(share.title, Array.from(title).slice(0, 50).join(''))
    assert.ok(Array.from(share.title).length <= 50)
    assert.equal(share.path, `/pages/post/index?id=${POST}`)
    assert.equal(translations, 0, 'topic titles are not translated')
    const timeline = hook(postPage, 'onShareTimeline', dependencies)()
    assert.equal(timeline.title, share.title)
    assert.equal(timeline.query, `id=${POST}`)
  }
})

test('legacy update and missing-post shares retain their existing fallbacks', () => {
  const post = { value: { id: POST, title: null, content: 'First line\nSecond line', images: [] } }
  const goneState = { value: null }
  const dependencies = { post, t: () => 'Community', localize: (_translations, content) => content, goneState, postId: { value: POST }, hiddenTopicShare }
  const share = hook(postPage, 'onShareAppMessage', dependencies)
  assert.deepEqual(share(), { title: 'First line', path: `/pages/post/index?id=${POST}`, imageUrl: '' })
  post.value = null
  assert.deepEqual(share(), { title: 'Community', path: '/pages/plaza/index' })
  // A topic that is gone, or whose state was never read, keeps the same fallback.
  goneState.value = 'missing'
  assert.deepEqual(share(), { title: 'Community', path: '/pages/plaza/index' })
})

// SPEC 6.10: the page's own share callbacks, for a topic that was hidden.
test('a hidden topic is shared as a notice about itself: no title, no text and none of its images', () => {
  const said = { 'plaza.hidden': 'HIDDEN', 'app.name': 'APP', 'share.plaza': 'Community' }
  const dependencies = {
    post: { value: null }, t: key => said[key], localize: () => assert.fail('nothing of the topic is read'),
    goneState: { value: 'hidden' }, postId: { value: POST }, hiddenTopicShare,
  }
  assert.deepEqual(hook(postPage, 'onShareAppMessage', dependencies)(),
    { title: 'HIDDEN · APP', path: `/pages/post/index?id=${POST}`, imageUrl: '/static/app-icon-192.png' })
  assert.deepEqual(hook(postPage, 'onShareTimeline', dependencies)(),
    { title: 'HIDDEN · APP', query: `id=${POST}`, imageUrl: '/static/app-icon-192.png' })
})

test('mini-program temporary HTTP photos upload while owned draft URLs are reused in order', async () => {
  const { safeItemMediaUrls } = await import(moduleUrl(source('utils/publicResource.ts')
    .replace("import { validChatMediaPath } from './chatMedia'", 'const validChatMediaPath = () => false')
    .replace('import.meta.env.VITE_SUPABASE_URL', "'https://media.supabase.co'")))
  const uid = '11111111-1111-4111-8111-111111111111'
  const owned = `https://media.supabase.co/storage/v1/object/public/item-images/items/${uid}/already.jpg`
  const uploaded = `https://media.supabase.co/storage/v1/object/public/item-images/items/${uid}/new.jpg`
  const script = plaza.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const ast = ts.createSourceFile('page.ts', script, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
  const submit = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'onSubmitPost')
  assert.ok(submit)
  for (const temporaryPhotos of [
    ['http://tmp/photo.jpg'],
    ['wxfile://tmp/photo.jpg'],
    ['http://tmp/photo.jpg', 'http://tmp/photo.jpg'],
  ]) {
    const uploads = [], writes = [], toasts = []
    const token = { userId: uid, generation: 1 }
    globalThis.uni = { showToast: value => toasts.push(value) }
    const dependencies = {
      awaitAuthReady: async () => {}, requireAuth: () => true,
      outcomeUncertain: { value: false }, composerMode: { value: 'topic' },
      composerCategory: { value: 'campus-life' }, composerTitle: { value: 'Question' },
      composerText: { value: 'Body' }, composerErrors: { value: {} }, focusComposerField() {},
      composerImages: { value: [...temporaryPhotos, owned] }, composerAttachedItems: { value: [] },
      submitting: { value: false }, composerAccountToken: token, isAccountRequestCurrent: () => true,
      composerUploadProgress: { value: null },
      normalizePostTopic, friendlyErrorMessage: error => String(error), lang: { value: 'en' }, t: key => key,
      safeItemMediaUrls,
      uploadImagesWithDims: async files => {
        uploads.push(files)
        return {
          urls: files.map((_, index) => uploaded.replace('new.jpg', `new-${index}.jpg`)),
          dims: files.map(() => ({ w: 10, h: 10 })), sourceIndices: files.map((_, index) => index),
          accountToken: token,
        }
      },
      authoredLang: () => 'en',
      composerPostId: { value: POST }, composerRetryCreate: false, confirmSuspectedAd: async () => true,
      createPost: async (_body, images) => { writes.push(images); return { id: POST, partial: false } },
      finishComposerPublication() {}, translateContentToAll: async () => ({}), updatePostI18n() {},
    }
    const onSubmit = new Function(...Object.keys(dependencies),
      compile(`${submit.getText(ast)}\nreturn onSubmitPost;`))(...Object.values(dependencies))
    await onSubmit()
    assert.deepEqual(uploads, [temporaryPhotos])
    assert.deepEqual(writes, [[...temporaryPhotos.map((_, index) => uploaded.replace('new.jpg', `new-${index}.jpg`)), owned]])
    assert.deepEqual(toasts, [])
  }
})

test('composer focus runs on the render tick without a delayed focus steal or stale session callback', async () => {
  const script = plaza.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const ast = ts.createSourceFile('page.ts', script, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
  const open = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'openComposer')
  assert.ok(open)
  for (const stale of [false, true]) {
    const ticks = []
    const token = { userId: 'user-a', generation: 1 }
    const dependencies = {
      awaitAuthReady: async () => {}, requireAuth: () => true, currentUser: { value: { id: 'user-a' } },
      isSuspensionActive,
      composerDialogOpener: null, activeElement: () => null, composerSessionId: 0, composerAccountToken: null,
      captureAccountRequest: () => token, isAccountRequestCurrent: () => true, createClientMessageId: () => POST,
      composerPostId: { value: '' }, outcomeUncertain: { value: false }, publicationMissing: { value: false },
      composerRetryCreate: false, draftRestored: { value: false }, composerMode: { value: 'topic' },
      composerTitle: { value: '' }, composerCategory: { value: null }, selectedCategory: { value: null }, POST_CATEGORIES,
      composerErrors: { value: {} }, composerText: { value: '' }, composerImages: { value: [] },
      composerAttachedItems: { value: [] }, showAttachSheet: { value: false },
      composerFocused: { value: false }, showComposer: { value: false },
      nextTick: callback => ticks.push(callback),
      setTimeout: () => assert.fail('composer focus must not run on a later timer while the member is typing'),
      readAccountPrivateStorage: () => ({ value: null }), COMPOSER_DRAFT_KEY: 'plaza_composer_draft_v1',
    }
    const runtime = new Function(...Object.keys(dependencies),
      compile(`${open.getText(ast)}\nreturn { openComposer, invalidate: () => { composerSessionId += 1 } };`))(...Object.values(dependencies))
    await runtime.openComposer()
    assert.equal(dependencies.showComposer.value, true)
    assert.equal(dependencies.composerFocused.value, false)
    assert.equal(ticks.length, 1)
    if (stale) runtime.invalidate()
    ticks[0]()
    assert.equal(dependencies.composerFocused.value, !stale)
  }
})
