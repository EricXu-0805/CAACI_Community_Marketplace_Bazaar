import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = relativePath => readFileSync(resolve(appRoot, relativePath), 'utf8')

function vueFiles(relativeDir) {
  const absoluteDir = resolve(appRoot, relativeDir)
  return readdirSync(absoluteDir, { withFileTypes: true }).flatMap(entry => {
    const child = `${relativeDir}/${entry.name}`
    if (entry.isDirectory()) return vueFiles(child)
    return entry.name.endsWith('.vue') ? [child] : []
  })
}

function expectSnippets(file, snippets) {
  const text = source(file)
  for (const snippet of snippets) {
    assert.ok(text.includes(snippet), `${file} is missing keyboard contract: ${snippet}`)
  }
}

test('role buttons have one delegated H5 focus and keyboard activation contract', () => {
  expectSnippets('src/App.vue', [
    "root.querySelectorAll<HTMLElement>('[role=\"button\"], uni-button')",
    "const isUniButton = el.matches('uni-button')",
    "el.setAttribute('role', 'button')",
    "el.setAttribute('aria-disabled', 'true')",
    "document.addEventListener('keydown'",
    "event.key !== 'Enter'",
    "event.key !== ' '",
    "'video[controls]'",
    "'audio[controls]'",
    'origin.closest(NATIVE_KEYBOARD_INTERACTIVE_SELECTOR)',
    "button.click()",
  ])
  const app = source('src/App.vue')
  assert.match(
    app,
    /const isRoleButton = el\.getAttribute\('role'\) === 'button'[\s\S]*if \(isRoleButton\) \{[\s\S]*AUTO_ARIA_DISABLED_ATTR/,
    'generic role buttons must mirror class/data disabled state into aria-disabled',
  )
  assert.match(app, /\[role="button"\]:focus-visible,[\s\S]*uni-button:focus-visible/)
})

test('every native input and textarea has an accessible name', () => {
  const fieldTag = /<(input|textarea)\b[^>]*>/gs
  for (const file of vueFiles('src')) {
    const template = source(file)
      .split('<script', 1)[0]
      .replace(/<!--[\s\S]*?-->/g, '')
    const unnamed = [...template.matchAll(fieldTag)]
      .map(match => match[0].replace(/\s+/g, ' '))
      .filter(tag => !/\s(?:v-bind:|:)?aria-label(?:ledby)?\s*=/.test(tag))
    assert.deepEqual(unnamed, [], `${file} has unnamed fields: ${unnamed.join(' | ')}`)
  }
})

test('H5 transfers uni-app form-control names to the native controls', () => {
  const app = source('src/App.vue')
  assert.match(app, /const UNI_FORM_CONTROL_SELECTOR = 'uni-input, uni-textarea'/)
  assert.match(app, /host\.querySelector<HTMLElement>\('input, textarea'\)/)
  assert.match(app, /nativeControl\.setAttribute\(sourceAttr, currentValue\)/)
  assert.match(app, /host\.removeAttribute\(sourceAttr\)/)
  assert.match(app, /mirrorUniFormControlState\(host, 'aria-describedby'\)/)
  assert.match(app, /mirrorUniFormControlState\(host, 'aria-invalid'\)/)
  assert.match(app, /attributeFilter:[\s\S]*'aria-label'[\s\S]*'aria-labelledby'[\s\S]*'aria-describedby'[\s\S]*'aria-invalid'/)
})

test('toast keyboard activation cannot bubble into the delegated role-button handler', () => {
  expectSnippets('src/components/AppToast.vue', [
    '@keydown.enter.stop.prevent="onTap(t)"',
    '@keydown.space.stop.prevent="onTap(t)"',
  ])
})

test('publish and edit expose every core selector to keyboard users', () => {
  expectSnippets('src/pages/publish/index.vue', [
    'class="listing-type-seg" role="group"',
    ':aria-pressed="form.listingType === \'sell\' ? \'true\' : \'false\'"',
    'class="image-add" role="button"',
    'aria-controls="publish-category-options"',
    'id="publish-category-options"',
    'aria-controls="publish-condition-options"',
    'id="publish-condition-options"',
    ':aria-pressed="form.negotiable ? \'true\' : \'false\'"',
  ])
  expectSnippets('src/pages/publish/edit.vue', [
    'class="image-add" role="button"',
    ':aria-label="form.listingType === \'wanted\' ? t(\'publish.wantedTitlePlaceholder\') : t(\'publish.titlePlaceholder\')"',
    ':aria-label="form.listingType === \'wanted\' ? t(\'publish.budget\') : t(\'publish.price\')"',
    ':aria-label="t(\'publish.location\')"',
    'aria-controls="edit-category-options"',
    'id="edit-category-options"',
    'aria-controls="edit-condition-options"',
    'id="edit-condition-options"',
    ':aria-pressed="form.negotiable ? \'true\' : \'false\'"',
  ])
})

test('home feed tabs, filters, cards and empty actions are keyboard reachable', () => {
  expectSnippets('src/pages/index/index.vue', [
    'class="feed-mode" role="tablist"',
    ':tabindex="listingType === \'sell\' ? 0 : -1"',
    '@keydown="onFeedModeKeydown($event, \'sell\')"',
    'function onFeedModeKeydown(event: KeyboardEvent',
    'v-if="showFilter"',
    'class="filter-sheet u-glass open"',
    'aria-modal="true"',
    'function onFilterDialogKeydown(event: KeyboardEvent)',
    'class="card u-press u-rise"\n            role="button"',
    '@keydown.self="onItemCardKeydown($event, item.id)"',
    'tabindex="0"\n                    :aria-label="isFavorited(item.id)',
    '@keydown="onQuickFavoriteKeydown($event, item)"',
    'function onItemCardKeydown(event: KeyboardEvent, itemId: string)',
    'function onQuickFavoriteKeydown(event: KeyboardEvent, item: Item)',
    'class="empty-btn" role="button"',
  ])
  const home = source('src/pages/index/index.vue')
  assert.match(home, /function onQuickFavoriteKeydown[^]*?event\.preventDefault\(\)[^]*?event\.stopPropagation\(\)[^]*?void onQuickFav\(item\)/)
})

test('detail rating dialog traps focus and exposes a roving keyboard radio group', () => {
  expectSnippets('src/pages/detail/index.vue', [
    'class="rating-sheet open"',
    '@keydown="onRatingDialogKeydown"',
    ':tabindex="ratingStars === n || (ratingStars === 0 && n === 1) ? 0 : -1"',
    '@keydown="onRatingStarKeydown($event, n)"',
    'function onRatingStarKeydown(event: KeyboardEvent',
    'function onRatingDialogKeydown(event: KeyboardEvent)',
    'function closeRating()',
  ])
})

test('message list and profile tabs implement roving tabindex and menu access', () => {
  expectSnippets('src/pages/messages/index.vue', [
    'class="msg-filters" role="tablist"',
    ':tabindex="msgFilter === f.key ? 0 : -1"',
    '@keydown="onMessageFilterKeydown($event, f.key)"',
    'class="login-btn"\n        role="button"\n        tabindex="0"',
    "@keydown=\"onPageActionKeydown($event, 'login')\"",
    "@keydown=\"onPageActionKeydown($event, 'retry')\"",
    'class="conv-item"',
    'role="button"\n          tabindex="0"',
    'aria-keyshortcuts="Shift+F10"',
    '@keydown="onConversationKeydown($event, conv)"',
    '@focus="openSwipeForKeyboard(conv.id)"',
    "@keydown=\"onSwipeActionKeydown($event, conv, 'pin')\"",
    "@keydown=\"onSwipeActionKeydown($event, conv, 'read')\"",
    "@keydown=\"onSwipeActionKeydown($event, conv, 'archive')\"",
    'function keyboardActivation(event: KeyboardEvent): boolean',
  ])
  const messages = source('src/pages/messages/index.vue')
  assert.match(messages, /function keyboardActivation[^]*?event\.preventDefault\(\)[^]*?event\.stopPropagation\(\)/)
  assert.match(messages, /function onConversationKeydown[^]*?if \(keyboardActivation\(event\)\)[^]*?onItemTap\(conv\)/)
  expectSnippets('src/pages/profile/index.vue', [
    'class="my-tabs" role="tablist"',
    ':tabindex="myTab === \'active\' ? 0 : -1"',
    '@keydown="onMyTabKeydown($event, \'active\')"',
    'function onMyTabKeydown(event: KeyboardEvent',
    'class="menu-row" role="button"',
  ])
})

test('chat keeps message keyboard actions after public media removal and discards failed temp messages locally', () => {
  const chat = source('src/components/ChatThread.vue')
  expectSnippets('src/components/ChatThread.vue', [
    '@keydown.self="onMessageKeydown($event, entry.msg)"',
    "t('chat.mediaUnavailable')",
    'v-if="offerSheet.open"\n      class="offer-sheet open"',
    'v-if="meetupSheet.open"\n      class="offer-sheet open"',
    '@keydown="onComposerSheetKeydown($event, \'offer\')"',
    'function onComposerSheetKeydown(event: KeyboardEvent',
    'const isFailedTemp = msg._failed === true',
    "actions.push(t('chat.discardFailed'))",
    'messages.value.splice(index, 1)',
  ])
  assert.doesNotMatch(chat, /:src="entry\.msg\.content"|uni\.chooseImage\(|uni\.chooseVideo\(/)
  assert.doesNotMatch(chat, /deleteMessage|chat\.deleteMsg/)
})

test('residual page click targets expose an explicit keyboard semantic', () => {
  // Quoted Vue bindings can themselves contain `>` (for example
  // `v-if="items.length > 0"`), so a plain `[^>]*` scanner silently skipped
  // real click targets. Tokenize opening tags while respecting quoted values
  // and enforce the contract across every component/page, not a hand list.
  const openingTag = /<(view|text|image|img)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gs
  for (const file of vueFiles('src')) {
    const template = source(file).split('<script', 1)[0]
    const missing = [...template.matchAll(openingTag)]
      .map(match => match[0])
      .filter(tag => /@click(?:\.\w+)*\s*=/.test(tag))
      // Backdrop clicks duplicate an Escape-capable dialog close and are not
      // standalone controls that should enter the tab order.
      .filter(tag => !/class="[^"]*(?:mask|sheet-mask)[^"]*"/.test(tag))
      .filter(tag => !/(?:^|\s):?role\s*=/.test(tag))
    assert.deepEqual(missing, [], `${file} has click-only controls: ${missing.join(' | ')}`)
  }
})

test('linked plaza banners are keyboard reachable without focusing decorative banners', () => {
  const banner = source('src/components/PlazaBannerCarousel.vue')
  assert.match(banner, /:role="b\.target_url \? 'button' : undefined"/)
  assert.match(banner, /:tabindex="b\.target_url \? 0 : undefined"/)
  assert.match(banner, /@keydown\.enter\.prevent="onTap\(b\)"/)
  assert.match(banner, /@keydown\.space\.prevent="onTap\(b\)"/)
})

test('history, legal, seller and admin tabs use roving tab semantics', () => {
  expectSnippets('src/pages/history/index.vue', [
    'class="tabs" role="tablist"',
    ':tabindex="tab === \'items\' ? 0 : -1"',
    '@keydown="onHistoryTabKeydown($event, \'items\')"',
    'function onHistoryTabKeydown(event: KeyboardEvent',
  ])
  expectSnippets('src/pages/legal/index.vue', [
    'class="tabs" role="tablist"',
    ':tabindex="docType === tab.type ? 0 : -1"',
    '@keydown="onLegalTabKeydown($event, tab.type)"',
  ])
  expectSnippets('src/pages/seller/index.vue', [
    'class="seller-tabs" role="tablist"',
    ':tabindex="activeTab === tab.key ? 0 : -1"',
    '@keydown="onSellerTabKeydown($event, tab.key)"',
  ])
  expectSnippets('src/pages/admin/index.vue', [
    'class="tabs" role="tablist"',
    ':tabindex="activeTab === tab.id ? 0 : -1"',
    '@keydown="onAdminTabKeydown($event, tab.id)"',
  ])
})

test('plaza overlays and admin details expose modal and Escape contracts', () => {
  expectSnippets('src/pages/plaza/index.vue', [
    'ref="commentSheetEl"',
    'aria-labelledby="plaza-comments-title"',
    '@keydown="onCommentDialogKeydown"',
    'ref="composerDialogEl"',
    'aria-labelledby="plaza-composer-title"',
    '@keydown="onComposerDialogKeydown"',
    'ref="attachDialogEl"',
    'aria-labelledby="plaza-attach-title"',
    '@keydown="onAttachDialogKeydown"',
    'function handleDialogKeydown(event: KeyboardEvent',
  ])
  expectSnippets('src/pages/admin/index.vue', [
    'ref="detailDialogEl"',
    'class="detail-sheet open"',
    'role="dialog"',
    'aria-modal="true"',
    '@keydown="onDetailDialogKeydown"',
    'function onDetailDialogKeydown(event: KeyboardEvent)',
    'function focusDetailDialog()',
    'function closeDetail(restoreFocus = true)',
    'watch(detailOpen, (open)',
  ])
})

test('permission and saved-search overlays trap focus and restore their opener', () => {
  expectSnippets('src/components/PermissionDeniedModal.vue', [
    'ref="dialogEl"',
    'role="dialog"',
    'aria-modal="true"',
    'tabindex="-1"',
    '@keydown="onDialogKeydown"',
    'function focusDialog(epoch: number)',
    'function restoreDialogFocus(epoch: number, target: HTMLElement | null)',
    'function onDialogKeydown(e: KeyboardEvent)',
    "if (e.key === 'Escape')",
    "if (e.key !== 'Tab'",
  ])
  expectSnippets('src/pages/saved-searches/index.vue', [
    '@click="openForm"',
    'ref="formDialogEl"',
    'role="dialog"',
    'aria-modal="true"',
    'aria-labelledby="saved-search-form-title"',
    '@keydown="onFormDialogKeydown"',
    'function openForm()',
    'function closeForm(restoreFocus = true)',
    'function onFormDialogKeydown(event: KeyboardEvent)',
    "if (event.key === 'Escape')",
    "if (event.key !== 'Tab'",
  ])
})

test('home price-range validation is exposed to assistive technology', () => {
  expectSnippets('src/pages/index/index.vue', [
    ":aria-invalid=\"priceFilterError ? 'true' : 'false'\"",
    ":aria-describedby=\"priceFilterError ? 'home-price-filter-error' : undefined\"",
    'id="home-price-filter-error" class="fs-error" role="alert"',
  ])
})

test('welcome carousel exposes current-slide semantics and keyboard navigation', () => {
  expectSnippets('src/pages/welcome/index.vue', [
    'class="swiper focusable"',
    'role="region"',
    'aria-roledescription="carousel"',
    ':aria-label="t(\'welcome.carouselLabel\')"',
    'aria-describedby="welcome-carousel-instructions"',
    'aria-keyshortcuts="ArrowLeft ArrowRight"',
    'tabindex="0"',
    '@change="onSlideChange"',
    '@keydown="onCarouselKeydown"',
    'aria-roledescription="slide"',
    ":aria-label=\"t('welcome.slidePosition', { current: i + 1, total: slides.length })\"",
    ":aria-hidden=\"current === i ? 'false' : 'true'\"",
    'role="status" aria-live="polite" aria-atomic="true"',
    'function onCarouselKeydown(event: KeyboardEvent)',
    "event.key === 'ArrowLeft'",
    "event.key === 'ArrowRight'",
  ])
})

test('asynchronous load failures announce only their rendered error panels', () => {
  const errorPanels = new Map([
    ['src/pages/blocked/index.vue', 'v-else-if="loadError && !loading" class="empty" role="alert" aria-live="assertive" aria-atomic="true"'],
    ['src/pages/messages/index.vue', 'v-else-if="conversationsError && !loading" class="empty" role="alert" aria-live="assertive" aria-atomic="true"'],
    ['src/pages/seller/index.vue', 'v-else-if="loadError" class="load-error" role="alert" aria-live="assertive" aria-atomic="true"'],
    ['src/pages/following/index.vue', 'v-else-if="loadError && !loading" class="empty" role="alert" aria-live="assertive" aria-atomic="true"'],
    ['src/pages/plaza/index.vue', 'v-else-if="fetchError && !loading" class="empty" role="alert" aria-live="assertive" aria-atomic="true"'],
    ['src/pages/index/index.vue', 'v-if="fetchError && !loading" class="empty" role="alert" aria-live="assertive" aria-atomic="true"'],
  ])
  for (const [file, panel] of errorPanels) {
    assert.ok(source(file).includes(panel), `${file} is missing its asynchronous error announcement`)
  }
  assert.ok(
    source('src/pages/plaza/index.vue').includes('v-else-if="followError" class="empty" role="alert" aria-live="assertive" aria-atomic="true"'),
    'plaza following-load errors must be announced independently of the main feed',
  )
  for (const file of ['src/pages/blocked/index.vue', 'src/pages/messages/index.vue']) {
    assert.doesNotMatch(
      source(file),
      /v-else-if="[^\"]*(?:length === 0|empty)[^\"]*"[^>]*role="alert"/,
      `${file} must not announce a normal empty state as an error`,
    )
  }
  expectSnippets('src/components/ChatThread.vue', [
    'v-else-if="moderationAccessFailed" class="cu-sub" role="alert" aria-live="assertive" aria-atomic="true"',
    'class="msg-status failed" role="button" aria-live="assertive" aria-atomic="true"',
  ])
})

test('long-press-only moderation and history actions have keyboard alternatives', () => {
  expectSnippets('src/pages/plaza/index.vue', [
    'aria-keyshortcuts="Shift+F10"',
    '@keydown="onCommentKeyboardMenu($event, thread.parent)"',
    'function onPostCardKeydown(event: KeyboardEvent, post: Post)',
  ])
  expectSnippets('src/pages/post/index.vue', [
    'aria-keyshortcuts="Shift+F10"',
    '@keydown="onCommentKeyboardMenu($event, thread.parent)"',
    'function onPostKeyboardMenu(event: KeyboardEvent)',
  ])
  expectSnippets('src/pages/history/index.vue', [
    'aria-keyshortcuts="Shift+F10 Delete"',
    'function onHistoryCardKeydown(event: KeyboardEvent',
  ])
})
