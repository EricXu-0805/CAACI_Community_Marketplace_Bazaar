import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import test from 'node:test'

const chatSource = await readFile(
  new URL('../src/components/ChatThread.vue', import.meta.url),
  'utf8',
)
const loginSource = await readFile(
  new URL('../src/pages/login/index.vue', import.meta.url),
  'utf8',
)
const detailSource = await readFile(
  new URL('../src/pages/detail/index.vue', import.meta.url),
  'utf8',
)
const homeSource = await readFile(
  new URL('../src/pages/index/index.vue', import.meta.url),
  'utf8',
)
const resetPasswordSource = await readFile(
  new URL('../src/pages/reset-password/index.vue', import.meta.url),
  'utf8',
)
const reconsentSource = await readFile(
  new URL('../src/pages/reconsent/index.vue', import.meta.url),
  'utf8',
)
const enMessagesSource = await readFile(
  new URL('../src/composables/i18n/messages/en.ts', import.meta.url),
  'utf8',
)
const zhMessagesSource = await readFile(
  new URL('../src/composables/i18n/messages/zh.ts', import.meta.url),
  'utf8',
)
const sellerSource = await readFile(
  new URL('../src/pages/seller/index.vue', import.meta.url),
  'utf8',
)
const notificationsSource = await readFile(
  new URL('../src/pages/notifications/index.vue', import.meta.url),
  'utf8',
)
const savedSearchesSource = await readFile(
  new URL('../src/pages/saved-searches/index.vue', import.meta.url),
  'utf8',
)
const searchSource = await readFile(
  new URL('../src/pages/search/index.vue', import.meta.url),
  'utf8',
)
const plazaSource = await readFile(
  new URL('../src/pages/plaza/index.vue', import.meta.url),
  'utf8',
)
const postSource = await readFile(
  new URL('../src/pages/post/index.vue', import.meta.url),
  'utf8',
)
const ownedLoadingSource = await readFile(
  new URL('../src/composables/ownedLoading.ts', import.meta.url),
  'utf8',
)
const navigationSource = await readFile(
  new URL('../src/utils/index.ts', import.meta.url),
  'utf8',
)

async function collectVueSources(directoryUrl) {
  const entries = await readdir(directoryUrl, { withFileTypes: true })
  const collected = []
  for (const entry of entries) {
    const childUrl = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, directoryUrl)
    if (entry.isDirectory()) collected.push(...await collectVueSources(childUrl))
    else if (entry.name.endsWith('.vue')) {
      collected.push({ path: childUrl.pathname, source: await readFile(childUrl, 'utf8') })
    }
  }
  return collected
}

const navigableVueSources = [
  ...await collectVueSources(new URL('../src/pages/', import.meta.url)),
  ...await collectVueSources(new URL('../src/components/', import.meta.url)),
]

test('a reserved listing still permits the meetup step without reopening offers', () => {
  const actionBar = chatSource.slice(
    chatSource.indexOf('class="offer-bar"') - 160,
    chatSource.indexOf('<scroll-view', chatSource.indexOf('class="offer-bar"')),
  )

  assert.match(actionBar, /itemInfo\.status === 'active' \|\| itemInfo\.status === 'reserved'/)
  assert.match(actionBar, /itemInfo\.status === 'active' && itemInfo\.negotiable/)
  assert.match(actionBar, /@click="openMeetupSheet"/)
})

test('sold listings keep offer/meetup history but hide server-rejected actions', () => {
  assert.match(chatSource, /const itemAllowsTransaction = computed\(\(\) =>[\s\S]*?'active'[\s\S]*?'reserved'/)
  assert.match(chatSource, /offerIncoming\(entry\.offer\)[^\n]*&& itemAllowsTransaction/)
  assert.match(chatSource, /meetupIncoming\(entry\.meetup\)[^\n]*&& itemAllowsTransaction/)
  assert.match(chatSource, /v-if="itemAllowsTransaction" class="deal-reschedule"/)
  assert.equal((chatSource.match(/t\('chat\.itemClosed'\)/g) || []).length, 2)
})

test('forgot-password transport failures are handled and provider text is localized', () => {
  const forgot = loginSource.slice(
    loginSource.indexOf('async function onForgotPassword'),
    loginSource.indexOf('\nfunction goLegal'),
  )

  assert.match(forgot, /if \(error\) throw error/)
  assert.match(forgot, /catch \(error\)/)
  assert.match(forgot, /friendlyErrorMessage\(error, lang\.value as 'en' \| 'zh'\)/)
  assert.doesNotMatch(forgot, /content:\s*error\.message/)
  assert.match(forgot, /finally \{\s+forgotLoading\.value = false/)
})

test('detail transport failures render a retry state instead of claiming deletion', () => {
  assert.match(detailSource, /v-else-if="loadError"[\s\S]*?@click="loadDetailForCurrentAccount"/)
  const loader = detailSource.slice(
    detailSource.indexOf('async function loadDetailForCurrentAccount'),
    detailSource.indexOf('\nonLoad((options)'),
  )
  assert.match(loader, /if \(error\?\.code === 'PGRST116'\) notFound\.value = true/)
  assert.match(loader, /else loadError\.value = true/)
  assert.doesNotMatch(loader, /if \(alive\) notFound\.value = true/)
})

test('detail query attributes do not produce fragment-root console warnings', () => {
  assert.match(detailSource, /defineOptions\(\{\s*inheritAttrs:\s*false\s*\}\)/)
})

test('detail shows the public aggregate favorite counter rather than an own-row RLS count', () => {
  assert.match(detailSource, /favCount\.value = Math\.max\(0, itemData\.favorite_count \|\| 0\)/)
  assert.doesNotMatch(detailSource, /getFavoriteCount/)
  assert.match(detailSource, /favCount\.value = Math\.max\(0, favCount\.value \+ \(result\.favorited \? 1 : -1\)\)/)
})

test('sharing preserves wanted/open-budget semantics instead of calling it free', () => {
  const detailShare = detailSource.slice(
    detailSource.indexOf('onShareAppMessage'),
    detailSource.indexOf('\nasync function onReport'),
  )
  const homeShare = homeSource.slice(
    homeSource.indexOf('async function onCardLongPress'),
    homeSource.indexOf('\nfunction promptReportItem'),
  )
  assert.equal((detailShare.match(/listingPriceLabel\(/g) || []).length >= 3, true)
  assert.match(homeShare, /listingPriceLabel\(item, t\)/)
  assert.doesNotMatch(detailShare, /text:\s*`\$\$\{item\.value\.price\}/)
  assert.doesNotMatch(homeShare, /text:\s*`\$\$\{item\.price\}/)
})

test('password recovery never displays raw provider update errors', () => {
  const updateFailure = resetPasswordSource.slice(
    resetPasswordSource.indexOf('if (uErr) {'),
    resetPasswordSource.indexOf('\n    if (!mounted) return', resetPasswordSource.indexOf('if (uErr) {')),
  )
  assert.match(updateFailure, /friendlyErrorMessage\(uErr, lang\.value as 'en' \| 'zh'\)/)
  assert.doesNotMatch(updateFailure, /uErr as any\)\?\.message/)
})

test('first account consent is not mislabeled as an updated agreement', () => {
  assert.match(reconsentSource, /const firstConsent = computed\(\(\) => !currentUser\.value\?\.tos_version \|\| currentUser\.value\.tos_version === '0'\)/)
  assert.match(reconsentSource, /firstConsent \? 'reconsent\.firstBadge' : 'reconsent\.badge'/)
  assert.match(reconsentSource, /firstConsent \? 'reconsent\.firstSub' : 'reconsent\.sub'/)
  assert.match(reconsentSource, /firstConsent\.value \? 'reconsent\.firstDeclineHint' : 'reconsent\.declineHint'/)
  assert.match(enMessagesSource, /'login\.agreePrefix': "I've read the"/)
  assert.match(zhMessagesSource, /'login\.agreePrefix': '我已阅读'/)
  assert.match(enMessagesSource, /'reconsent\.firstSub': 'Your account is ready\./)
  assert.match(zhMessagesSource, /'reconsent\.firstSub': '账号已创建。/)
})

test('seller post fetch failures do not masquerade as an empty profile', () => {
  assert.match(sellerSource, /v-else-if="postsError"[\s\S]*?@click="retryPosts"/)
  const loader = sellerSource.slice(
    sellerSource.indexOf('async function loadPosts'),
    sellerSource.indexOf('\nfunction switchTab'),
  )
  assert.match(loader, /postsError\.value = false/)
  assert.match(loader, /catch \{\s+if \(sellerRequestIsCurrent\(accountToken, requestEpoch\)\) postsError\.value = true/)
  assert.match(loader, /function retryPosts\(\)/)
})

test('private list failures stay distinguishable from genuine empty states', () => {
  assert.match(notificationsSource, /v-else-if="loadError && notifications\.length === 0"[\s\S]*?@click="loadCurrentNotifications"/)
  assert.match(savedSearchesSource, /v-else-if="loadError && items\.length === 0"[\s\S]*?@click="loadSavedSearchesForCurrentAccount"/)
  assert.match(notificationsSource, /catch \(err: any\) \{[\s\S]*?loadError\.value = true/)
  assert.match(savedSearchesSource, /catch \(err: any\) \{[\s\S]*?loadError\.value = true/)
})

test('hard-entry subpages inspect the in-app stack before choosing a safe return path', () => {
  const submit = searchSource.slice(
    searchSource.indexOf('function onSubmit'),
    searchSource.indexOf('\nfunction removeOne'),
  )
  assert.equal((submit.match(/goBack\(\)/g) || []).length >= 2, true)
  assert.match(navigationSource, /hasPreviousPage = getCurrentPages\(\)\.length > 1/)
  assert.match(navigationSource, /if \(hasPreviousPage\) \{\s+uni\.navigateBack\(\)\s+return\s+\}\s+fallback\(\)/)
  assert.match(searchSource, /function goBack\(\) \{ navigateBackOr\(\(\) => uni\.switchTab\(\{ url: '\/pages\/index\/index' \}\)\) \}/)
  assert.match(notificationsSource, /function goBack\(\)[\s\S]*?navigateBackOr[\s\S]*?\/pages\/profile\/index/)
  assert.match(savedSearchesSource, /function goBack\(\)[\s\S]*?navigateBackOr[\s\S]*?\/pages\/profile\/index/)

  for (const { path, source } of navigableVueSources) {
    assert.doesNotMatch(source, /uni\.navigateBack\s*\(/, `${path} bypasses the hard-entry boundary`)
  }
})

test('report overlays are released before stale-page exits and cannot hide a newer owner', () => {
  assert.match(ownedLoadingSource, /if \(activeOwner !== owner\) return/)
  assert.match(ownedLoadingSource, /function cancel\(\)[\s\S]*?activeOwner = null[\s\S]*?uni\.hideLoading\(\)/)

  for (const source of [homeSource, plazaSource, detailSource, postSource]) {
    const report = source.slice(
      source.indexOf('const loadingOwner = reportLoading.show'),
      source.indexOf('\n    },', source.indexOf('const loadingOwner = reportLoading.show')),
    )
    assert.match(report, /await reportTarget\(/)
    assert.equal((report.match(/reportLoading\.hide\(loadingOwner\)/g) || []).length, 2)
    assert.match(report, /reportLoading\.hide\(loadingOwner\)\s+if \(!actionIsCurrent\(\)\) return/)
    assert.match(source, /reportLoading\.cancel\(\)/)
  }

  const chatReport = chatSource.slice(
    chatSource.indexOf('const loadingOwner = reportLoading.show'),
    chatSource.indexOf('\n    },', chatSource.indexOf('const loadingOwner = reportLoading.show')),
  )
  assert.equal((chatReport.match(/reportLoading\.hide\(loadingOwner\)/g) || []).length, 2)
  assert.match(chatReport, /reportLoading\.hide\(loadingOwner\)\s+if \(!isThreadEpochCurrent\(actionEpoch\)\) return/)
  assert.match(chatSource, /onUnmounted\(\(\) => \{\s+mounted = false\s+reportLoading\.cancel\(\)/)
})
