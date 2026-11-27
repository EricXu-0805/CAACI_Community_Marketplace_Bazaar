import test from 'node:test'
import assert from 'node:assert/strict'
import { communityNavigation, communityRouting, openCommunityBoard, POST_CATEGORIES } from './helpers/community-routing-harness.mjs'

/*
 * SPEC 4.4 and 8 in the mini program: the community tab opens on the forum
 * home, and a board page or all discussions is reached by an intent, not by an
 * address. switchTab carries no query, so another page stages its intent in
 * communityNavigation and this page takes it once when it is shown; a path that
 * does carry a query (a relaunch) names its view when the page loads.
 */
const POST = '33333333-3333-4333-8333-333333333333'
// The mini program has no window. Routing that reached for one would throw here.
const NO_WINDOW = new Proxy({}, { get(_target, key) { throw new Error(`the mini program has no window.${String(key)}`) } })

function miniProgram(window = NO_WINDOW) {
  communityNavigation.pendingBoard = null
  communityNavigation.pendingView = null
  const switches = [], toasts = [], navigations = []
  const page = communityRouting('MP-WEIXIN', {
    window,
    uni: {
      switchTab: options => switches.push(options.url),
      showToast: options => toasts.push(options.title),
      navigateTo: options => navigations.push(options.url),
    },
  })
  return { ...page, switches, toasts, navigations }
}

test('the mini program opens the community tab on the forum home', async () => {
  for (const query of [undefined, {}]) {
    const page = miniProgram()
    assert.equal(page.view.value, 'home', 'what the page renders before it has loaded')
    await page.open(query)
    assert.equal(page.view.value, 'home')
    assert.equal(page.selectedCategory.value, null)
    assert.equal(page.homeReads.length, 1, 'the first read is the home')
    assert.deepEqual(page.feedReads, [], 'the flat list is not read until it is opened')
  }
})

test('a staged board opens that board page, and a later visit does not replay it', async () => {
  for (const board of POST_CATEGORIES) {
    const page = miniProgram()
    await page.open()
    page.homeData.value = { now: 1 }
    page.searchText.value = 'old search'
    page.activeTab.value = 'following'

    openCommunityBoard(board)
    assert.deepEqual(page.switches, ['/pages/plaza/index'])
    page.onShow()
    assert.equal(page.view.value, 'board')
    assert.equal(page.selectedCategory.value, board)
    assert.deepEqual(page.feedReads, [board])
    assert.equal(page.searchText.value, '')
    assert.equal(page.activeTab.value, 'active', 'a board page has no following tab; it opens on 最新回复')
    assert.deepEqual(communityNavigation, { pendingBoard: null, pendingView: null, pendingSearch: null })

    page.showHome()
    page.onShow()
    assert.equal(page.view.value, 'home', 'the board was taken once')
    assert.deepEqual(page.feedReads, [board])
  }
})

test("a staged view 'all' opens all discussions, and a later visit does not replay it", async () => {
  const page = miniProgram()
  await page.open()
  page.homeData.value = { now: 1 }

  communityNavigation.pendingView = 'all'
  page.onShow()
  assert.equal(page.view.value, 'all')
  assert.equal(page.selectedCategory.value, null)
  assert.deepEqual(page.feedReads, [null])
  assert.deepEqual(communityNavigation, { pendingBoard: null, pendingView: null, pendingSearch: null })

  page.showHome()
  page.onShow()
  assert.equal(page.view.value, 'home', 'the view was taken once')
  assert.deepEqual(page.feedReads, [null])
})

test('an unknown staged board or view opens the home', async () => {
  for (const intent of [
    { pendingBoard: 'unknown', pendingView: null },
    { pendingBoard: '', pendingView: null },
    { pendingBoard: null, pendingView: 'unknown' },
    { pendingBoard: null, pendingView: '' },
    { pendingBoard: 'unknown', pendingView: 'unknown' },
  ]) {
    const page = miniProgram()
    await page.open()
    page.homeData.value = { now: 1 }
    page.showBoard('campus-life')
    page.searchText.value = 'old search'

    Object.assign(communityNavigation, intent)
    page.onShow()
    assert.equal(page.view.value, 'home')
    assert.equal(page.selectedCategory.value, null)
    assert.equal(page.searchText.value, '')
    assert.deepEqual(page.feedReads, ['campus-life'], 'the home reads no list')
    assert.deepEqual(communityNavigation, { pendingBoard: null, pendingView: null, pendingSearch: null })
  }
})

test('a path that carries a query opens its view when the page loads', async () => {
  for (const board of POST_CATEGORIES) {
    const page = miniProgram()
    await page.open({ board })
    assert.equal(page.view.value, 'board')
    assert.equal(page.selectedCategory.value, board)
    assert.deepEqual(page.feedReads, [board])
    assert.deepEqual(page.homeReads, [])
  }
  const all = miniProgram()
  await all.open({ view: 'all' })
  assert.equal(all.view.value, 'all')
  assert.deepEqual(all.feedReads, [null])

  // A board outranks a view, and what names neither is the home.
  const both = miniProgram()
  await both.open({ board: 'local-deals', view: 'all' })
  assert.equal(both.view.value, 'board')
  assert.equal(both.selectedCategory.value, 'local-deals')
  for (const [query, view] of [
    [{ board: 'unknown' }, 'home'], [{ view: 'unknown' }, 'home'], [{ board: '', view: '' }, 'home'],
    [{ board: 'unknown', view: 'all' }, 'all'],
  ]) {
    const page = miniProgram()
    await page.open(query)
    assert.equal(page.view.value, view)
    assert.equal(page.selectedCategory.value, null)
  }
})

test('a view is plain state in the mini program, while H5 keeps its address on the view', () => {
  const browser = () => {
    const replaced = []
    const window = {
      location: { hash: '#/pages/plaza/index' },
      history: { state: null, replaceState(_state, _title, hash) { replaced.push(hash); window.location.hash = hash } },
    }
    return { window, replaced }
  }
  const visit = page => {
    page.homeData.value = { now: 1 }
    page.showBoard('campus-life')
    page.showAll()
    page.showHome()
    return [page.view.value, page.feedReads]
  }

  const mp = browser()
  assert.deepEqual(visit(miniProgram(mp.window)), ['home', ['campus-life', null]])
  assert.deepEqual(mp.replaced, [])
  assert.equal(mp.window.location.hash, '#/pages/plaza/index')

  const h5 = browser()
  assert.deepEqual(visit(communityRouting('H5', { window: h5.window })), ['home', ['campus-life', null]])
  assert.deepEqual(h5.replaced, [
    '#/pages/plaza/index?board=campus-life', '#/pages/plaza/index?view=all', '#/pages/plaza/index',
  ])
})

test('a topic published from the mini program refreshes the home the next time it is shown', async () => {
  const page = miniProgram()
  await page.open()
  page.homeData.value = { now: 1 }
  page.onShow()
  assert.equal(page.homeReads.length, 1, 'an ordinary return keeps the snapshot')

  page.publish({ id: POST, partial: false })
  assert.deepEqual(page.navigations, [`/pages/post/index?id=${POST}`])
  page.onShow()
  assert.equal(page.homeReads.length, 2)
  page.onShow()
  assert.equal(page.homeReads.length, 2, 'one read for one publication')
})

test('the search icon opens all discussions and then focuses its field', async () => {
  const page = miniProgram()
  await page.open()
  page.openSearch()
  assert.equal(page.view.value, 'all')
  assert.deepEqual(page.feedReads, [null])
  assert.equal(page.searchFocused.value, false, 'the field does not exist until the view has rendered')
  assert.equal(page.ticks.length, 1)
  page.ticks[0]()
  assert.equal(page.searchFocused.value, true)
})
