<template>
  <view class="page" :class="mpThemeClass" :style="mpChrome">
    <!-- #ifndef H5 -->
    <AppToast />
    <!-- #endif -->
    <view class="header">
      <view class="back-btn" role="button" :aria-label="t('a11y.back')" @click="goBack">
        <UIcon name="chevron-left" size="xs" color="accent-primary" />
      </view>
      <text class="header-title" role="heading" aria-level="1">{{ t('profile.myItemsTitle') }}</text>
    </view>

    <view class="tabs" role="tablist" :aria-label="t('profile.myItemsTitle')">
      <view
        v-for="key in TAB_ORDER"
        :key="key"
        :class="['tab', { active: tab === key }]"
        role="tab"
        :tabindex="tab === key ? 0 : -1"
        :aria-selected="tab === key ? 'true' : 'false'"
        aria-controls="my-items-panel"
        @click="tab = key"
        @keydown="onTabKeydown($event, key)"
      >
        <text>{{ t(TAB_LABEL_KEY[key]) }}</text>
        <text v-if="ready && listFor(key).length > 0" class="tab-count">{{ listFor(key).length }}</text>
      </view>
    </view>

    <view v-if="!ready" id="my-items-panel" class="grid" role="tabpanel">
      <view v-for="n in 4" :key="n" class="card">
        <view class="card-img-wrap u-sk"></view>
        <view class="card-body">
          <view class="u-sk u-sk-line"></view>
          <view class="u-sk u-sk-line short"></view>
        </view>
      </view>
    </view>

    <view v-else-if="currentList.length === 0" id="my-items-panel" class="empty" role="tabpanel">
      <UEmptyArt :name="tab === 'saved' ? 'favorites' : 'bag'" :size="104" />
      <text class="empty-text">{{ t(EMPTY_KEY[tab]) }}</text>
    </view>

    <view v-else id="my-items-panel" class="grid u-stagger" role="tabpanel">
      <view
        v-for="item in currentList"
        :key="item.id"
        class="card u-rise"
        role="button"
        :aria-label="localize(item.title_i18n, item.title)"
        @click="goDetail(item.id)"
      >
        <view class="card-img-wrap">
          <image
            v-if="thumbUrl(item.images?.[0], 'list')"
            :src="thumbUrl(item.images?.[0], 'list')"
            :alt="localize(item.title_i18n, item.title)"
            class="card-img"
            mode="aspectFill"
            lazy-load
          />
          <view v-else class="card-img u-thumb-ph u-thumb-ph--fill"><text class="u-thumb-ph-seal">集</text></view>
        </view>
        <view class="card-body">
          <text class="card-title">{{ localize(item.title_i18n, item.title) }}</text>
          <view class="card-meta">
            <text v-if="item.listing_type === 'wanted'" class="u-wanted-tag">{{ t('item.wanted') }}</text>
            <text :class="['card-price', { free: item.listing_type !== 'wanted' && (!item.price || item.price === 0) }]">{{ listingPriceLabel(item, t) }}</text>
            <text v-if="item.status === 'sold'" class="card-status sold">{{ t('status.sold') }}</text>
            <text v-else-if="item.status === 'reserved'" class="card-status reserved">{{ t('status.reserved') }}</text>
            <text v-else-if="tab === 'saved' && item.profile" class="card-seller">{{ item.profile.nickname }}</text>
          </view>
        </view>
      </view>
    </view>

    <view style="height: 40px;"></view>
  </view>
</template>

<script setup lang="ts">
/*
 * Full-list view behind the profile stat strip.
 *
 * The profile page only ever shows listings in a horizontal rail, so a user
 * with more than a handful of items had to swipe blindly to find one. Each
 * stat (发布 / 收藏 / 已售) now opens this page on the matching tab; 浏览过
 * keeps its own page at pages/history/index.
 *
 * Data comes from the same two composable calls the profile page makes, so
 * the counts a user taps and the rows they land on are the same snapshot —
 * both are TTL-cached, so arriving here right after the profile loads costs
 * no extra request.
 */
import { mpChromeVars, mpThemeClass } from '../../composables/useMpChrome'
const mpChrome = mpChromeVars()
import { ref, computed, nextTick } from 'vue'
import { onLoad, onShow, onUnload } from '@dcloudio/uni-app'
import AppToast from '../../components/AppToast.vue'
import UEmptyArt from '../../components/UEmptyArt.vue'
import UIcon from '../../components/UIcon.vue'
import { useAuth } from '../../composables/useAuth'
import { useI18n } from '../../composables/useI18n'
import { useItems } from '../../composables/useItems'
import { useFavorites } from '../../composables/useFavorites'
import { createAccountPageScope } from '../../composables/accountPageScope'
import { listingPriceLabel, navigateBackOr, thumbUrl } from '../../utils'
import type { Item } from '../../types'

type TabKey = 'listed' | 'sold' | 'saved'

const TAB_ORDER: TabKey[] = ['listed', 'sold', 'saved']
const TAB_LABEL_KEY: Record<TabKey, string> = {
  listed: 'profile.tabActive',
  sold: 'profile.tabSold',
  saved: 'profile.savedSection',
}
const EMPTY_KEY: Record<TabKey, string> = {
  listed: 'profile.noListings',
  sold: 'profile.noSold',
  saved: 'profile.noSaved',
}

const { t, localize } = useI18n()
const { currentUser, awaitAuthReady } = useAuth()
const { fetchMyItems } = useItems()
const { fetchMyFavoriteItems } = useFavorites()

const tab = ref<TabKey>('listed')
const myItems = ref<Item[]>([])
const savedItems = ref<Item[]>([])
const ready = ref(false)

const listedItems = computed(() => myItems.value.filter(i => i.status !== 'sold'))
const soldItems = computed(() => myItems.value.filter(i => i.status === 'sold'))

function listFor(key: TabKey): Item[] {
  if (key === 'saved') return savedItems.value
  if (key === 'sold') return soldItems.value
  return listedItems.value
}
const currentList = computed(() => listFor(tab.value))

// Same guard the profile page uses: a fetch started as A must never paint
// rows into B's session after a mid-flight account switch.
const pageScope = createAccountPageScope(() => {
  myItems.value = []
  savedItems.value = []
  ready.value = false
})

onLoad((query) => {
  const requested = String((query as Record<string, string> | undefined)?.tab || '')
  if (TAB_ORDER.includes(requested as TabKey)) tab.value = requested as TabKey
})

onShow(() => { void load() })
onUnload(() => { pageScope.dispose() })

async function load() {
  await awaitAuthReady()
  const uid = currentUser.value?.id
  if (!uid) {
    // Deep-linked while signed out. Nothing private can render, so send the
    // user back rather than showing three permanently empty tabs.
    ready.value = true
    uni.reLaunch({ url: '/pages/login/index' })
    return
  }
  const request = pageScope.begin(uid)
  if (!request) return
  try {
    const [items, favItems] = await Promise.all([
      fetchMyItems(uid, { accountToken: request.accountToken }),
      fetchMyFavoriteItems(uid),
    ])
    if (!pageScope.isCurrent(request)) return
    myItems.value = items
    savedItems.value = favItems
  } catch {
    if (!pageScope.isCurrent(request)) return
    uni.showToast({ title: t('error.loadFailed'), icon: 'none' })
  } finally {
    if (pageScope.isCurrent(request)) ready.value = true
  }
}

function onTabKeydown(event: KeyboardEvent, current: TabKey) {
  const index = TAB_ORDER.indexOf(current)
  let nextIndex = index
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % TAB_ORDER.length
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + TAB_ORDER.length) % TAB_ORDER.length
  else if (event.key === 'Home') nextIndex = 0
  else if (event.key === 'End') nextIndex = TAB_ORDER.length - 1
  else if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
    event.preventDefault()
    tab.value = current
    return
  } else return

  event.preventDefault()
  tab.value = TAB_ORDER[nextIndex]
  const tabList = (event.currentTarget as HTMLElement | null)?.parentElement
  nextTick(() => tabList?.querySelectorAll<HTMLElement>('[role="tab"]')[nextIndex]?.focus())
}

function goBack() { navigateBackOr(() => uni.switchTab({ url: '/pages/profile/index' })) }
function goDetail(id: string) { uni.navigateTo({ url: `/pages/detail/index?id=${id}` }) }
</script>

<style lang="scss" scoped>
.page { min-height: 100vh; background: var(--bg-subtle); max-width: 480px; margin: 0 auto; }
.header {
  display: flex; align-items: center; gap: 12px; padding: 12px 16px;
  padding-top: calc(12px + var(--mp-status-bar, env(safe-area-inset-top, 0px)));
  background: var(--bg-elev-1); border-bottom: 0.5px solid var(--line-hair);
}
.back-btn {
  width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;
  cursor: pointer; -webkit-tap-highlight-color: transparent;
  &:active { opacity: 0.6; }
}
.header-title { font-size: 17px; font-weight: 600; color: var(--text-primary); }

.tabs {
  display: flex; gap: 8px; padding: 10px 16px;
  background: var(--bg-elev-1); border-bottom: 0.5px solid var(--line-hair);
}
.tab {
  display: flex; align-items: center; gap: 5px;
  padding: 6px 14px; border-radius: 16px;
  background: var(--bg-subtle); color: var(--text-secondary);
  font-size: 13px; cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background 0.15s, color 0.15s;
  &.active { background: var(--accent-primary); color: var(--ink-inverse); }
  /* On the brand-filled active tab: white is 2.88:1 there in dark. */
  &.active .tab-count { color: var(--ink-inverse); opacity: 0.85; }
}
.tab-count { font-size: 11px; color: var(--text-muted); }

.grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
  padding: 12px 16px;
}
.card {
  background: var(--bg-elev-1);
  border-radius: var(--radius-lg);
  overflow: hidden;
  box-shadow: 0 1px 4px rgba(60, 40, 20, 0.05);
  cursor: pointer;
  transition: transform 0.15s;
  &:active { transform: scale(0.98); }
}
/* Square filled tile — same rule as the profile favorites grid: a fixed grid
   cell cannot show a whole photo without a dead letterbox band, so crop and
   let the detail page carry the full image. */
.card-img-wrap {
  width: 100%;
  aspect-ratio: 1 / 1;
  background: var(--bg-subtle);
  overflow: hidden;
}
.card-img {
  width: 100%; height: 100%;
  display: block;
  object-fit: cover;
  background: var(--bg-subtle);
}
.card-body { padding: 8px 10px 10px; }
.card-title {
  font-size: 12px; color: var(--text-primary); line-height: 1.45; letter-spacing: 0.02em;
  display: -webkit-box; -webkit-line-clamp: 2;
  -webkit-box-orient: vertical; overflow: hidden;
}
.card-meta { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-top: 5px; flex-wrap: wrap; }
.card-price {
  font-family: var(--font-serif);
  font-size: 17px; font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--brand);
  line-height: 1;
  font-feature-settings: 'tnum';
  &.free { color: var(--success); }
}
.card-status {
  font-size: 10px; padding: 1px 6px; border-radius: 4px;
  &.reserved { color: var(--warning-text); background: var(--warning-soft); }
  &.sold { color: var(--text-muted); background: var(--bg-subtle); }
}
.card-seller { font-size: 10px; color: var(--text-subtle); max-width: 60%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.u-sk-line { height: 10px; border-radius: 4px; margin-top: 6px; &.short { width: 55%; } }

.empty {
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  padding: 60px 24px;
}
.empty-text { font-size: 13px; color: var(--text-muted); }
</style>
