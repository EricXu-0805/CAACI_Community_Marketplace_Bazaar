<template>
  <view class="page page-lock">
    <DesktopNav current="index" />

    <view class="mobile-header">
      <!--
        Language toggle moved to Settings → "Language" (matches the
        Instagram / WhatsApp pattern). Keeping it in the top-right of
        every page made the header feel noisy and blocked future 3rd-
        language expansion (Jp / Kr / zh-Hant). The header is now just
        brand + search + categories.
      -->
      <view class="mh-top">
        <text class="mh-brand">{{ t('app.name') }}</text>
      </view>
      <view class="mh-search">
        <!--
          Search affordance — tapping anywhere on the 'input' navigates
          to the dedicated search page (per refinement-pass: recent
          searches live there, not as a floating dropdown here). Renders
          the typed query (if any) as a static label so the user sees
          what they last searched; the live edit happens on the search
          page with a focused input.
        -->
        <view class="search-field search-proxy" @click="goToSearch" role="button" :aria-label="t('a11y.search')">
          <view class="sf-icon"></view>
          <text v-if="searchText" class="sf-text">{{ searchText }}</text>
          <text v-else class="sf-placeholder">{{ t('home.search') }}</text>
          <view v-if="searchText" class="sf-clear" role="button" :aria-label="t('a11y.searchClear')" @click.stop="onClearSearch">×</view>
        </view>
        <view class="filter-btn" role="button" :aria-label="t('a11y.filter')" @click.stop="showFilter = !showFilter">
          <view class="fb-lines"><view></view><view></view><view></view></view>
          <text class="fb-label">{{ t('home.filter') }}</text>
          <view v-if="activeFilterCount > 0" class="fb-badge">{{ activeFilterCount }}</view>
        </view>
      </view>

    </view>

    <!--
      Category rail — horizontal pill scroll per marketplace/ kit's
      HomeScreen + refinement pass. The previous 4×3 grid + tall hero
      ate too much vertical space; this compact rail matches Xianyu /
      Taobao feel and keeps the fold tight.
    -->
    <scroll-view class="cat-bar" scroll-x :show-scrollbar="false">
      <view class="cat-bar-inner">
        <view
          v-for="cat in categories"
          :key="'c'+cat.value"
          :class="['pill', 'u-press', { active: selectedCategory === cat.value }]"
          @click="selectCategory(cat.value)"
        >
          <text>{{ cat.label }}</text>
        </view>
        <!--
          Trailing transparent spacer — gives the last pill room to
          breathe past the right safe-area / scrollbar edge so it
          never gets visually clipped. Without this the rightmost pill
          sits flush against the viewport edge and looks chopped on
          devices with rounded corners or a notch on the right.
        -->
        <view class="cat-tab-spacer" aria-hidden="true"></view>
      </view>
    </scroll-view>

    <view v-if="selectedCategory === 'currency_exchange'" class="scam-banner">
      <view class="sb-icon"><view class="sb-excl"></view></view>
      <view class="sb-body">
        <text class="sb-title">{{ t('scam.bannerTitle') }}</text>
        <text class="sb-text">{{ t('scam.bannerBody') }}</text>
      </view>
    </view>

    <view
      v-if="showSemesterBanner"
      class="semester-banner u-press"
      @click="onSemesterBannerTap"
    >
      <text class="seb-arc" aria-hidden="true">I</text>
      <view class="seb-body">
        <text class="seb-stamp t-eyebrow">{{ t('app.name') }}</text>
        <text class="seb-title">{{ semesterTitle(lang as 'en' | 'zh') }}</text>
        <text class="seb-sub">{{ semesterSubtitle(lang as 'en' | 'zh') }}</text>
      </view>
      <text class="seb-arrow">›</text>
    </view>

    <!-- Active filter summary bar (shows when filters are applied, even if sheet closed) -->
    <view v-if="activeFilterCount > 0 && !showFilter" class="active-filter-bar">
      <scroll-view scroll-x class="afb-scroll">
        <view v-if="filterPriceMin || filterPriceMax" class="afb-chip" @click="showFilter = true">
          <text>${{ filterPriceMin || '0' }}–${{ filterPriceMax || '∞' }}</text>
        </view>
        <view v-if="filterCondition" class="afb-chip" @click="showFilter = true">
          <text>{{ t('condition.' + filterCondition) }}</text>
        </view>
        <view v-if="filterLocation" class="afb-chip" @click="showFilter = true">
          <text>{{ filterLocation }}</text>
        </view>
        <view v-if="sortBy !== 'latest'" class="afb-chip" @click="showFilter = true">
          <text>{{ t('sort.' + sortBy.replace('price_asc', 'priceAsc').replace('price_desc', 'priceDesc')) }}</text>
        </view>
      </scroll-view>
      <view class="afb-clear" @click="onClearAllFilters">
        <text>{{ t('home.clearFilters') }}</text>
      </view>
    </view>

    <!-- Filter Bottom Sheet -->
    <view v-if="showFilter" class="filter-mask" @click="showFilter = false"></view>
    <view :class="['filter-sheet', { open: showFilter }]">
      <view class="fs-header">
        <view class="fs-close" role="button" :aria-label="t('a11y.filterClose')" @click="showFilter = false">
          <view class="fs-x"></view>
        </view>
        <text class="fs-title">{{ t('filter.title') }}</text>
        <text class="fs-reset" role="button" :aria-label="t('a11y.filterReset')" @click="resetFilters">{{ t('filter.reset') }}</text>
      </view>

      <view class="fs-section">
        <text class="fs-label">{{ t('filter.price') }}</text>
        <view class="fs-price-row">
          <view class="fs-price-input">
            <text class="fs-dollar">$</text>
            <input v-model="filterPriceMin" type="digit" placeholder="Min" />
          </view>
          <text class="fs-dash">—</text>
          <view class="fs-price-input">
            <text class="fs-dollar">$</text>
            <input v-model="filterPriceMax" type="digit" placeholder="Max" />
          </view>
        </view>
      </view>

      <view class="fs-section">
        <text class="fs-label">{{ t('filter.condition') }}</text>
        <view class="fs-pills">
          <view
            v-for="(label, key) in conditionOpts"
            :key="key"
            :class="['fpill', { active: filterCondition === key }]"
            @click="filterCondition = filterCondition === key ? '' : (key as ItemCondition)"
          >
            <text>{{ label }}</text>
          </view>
        </view>
      </view>

      <view class="fs-section">
        <text class="fs-label">{{ t('filter.location') }}</text>
        <view class="fs-pills">
          <view
            v-for="loc in locationOpts"
            :key="loc"
            :class="['fpill', { active: filterLocation === loc }]"
            @click="filterLocation = filterLocation === loc ? '' : loc"
          >
            <text>{{ loc }}</text>
          </view>
        </view>
      </view>

      <view class="fs-section">
        <text class="fs-label">{{ t('filter.sort') }}</text>
        <view class="fs-pills">
          <view
            v-for="s in sortOpts"
            :key="s.value"
            :class="['fpill', { active: sortBy === s.value }]"
            @click="sortBy = s.value"
          >
            <text>{{ s.label }}</text>
          </view>
        </view>
      </view>

      <view class="fs-footer">
        <view class="fs-apply" @click="applyFilters">
          <text>{{ t('filter.apply') }}</text>
        </view>
      </view>
    </view>

    <!-- Waterfall Feed -->
    <scroll-view
      class="feed"
      scroll-y
      :scroll-top="scrollTopVal"
      @scrolltolower="loadMore"
      @scroll="onScroll"
      refresher-enabled
      :refresher-triggered="isRefreshing"
      @refresherrefresh="onRefresh"
    >
      <!-- Skeleton Loading -->
      <view v-if="initialLoading" class="waterfall">
        <view v-for="ci in columnCount" :key="'sk'+ci" class="wf-col">
          <view v-for="n in 3" :key="'sk'+ci+'-'+n" class="card skeleton-card">
            <view class="sk-img" :style="{ height: (130 + n * 40) + 'px' }"></view>
            <view class="sk-body">
              <view class="sk-line"></view>
              <view class="sk-line w60"></view>
              <view class="sk-row">
                <view class="sk-circle"></view>
                <view class="sk-line w40"></view>
              </view>
            </view>
          </view>
        </view>
      </view>

      <!-- Real Content -->
      <view v-else>
        <view v-if="searchText || selectedCategory" class="result-count">
          <text>{{ filteredItems.length }} {{ t('home.results') }}</text>
        </view>
        <view class="waterfall">
          <view v-for="(col, ci) in columns" :key="ci" class="wf-col">
          <view
            v-for="item in col"
            :key="item.id"
            class="card u-press"
            @click="goToDetail(item.id)"
            @touchstart="cardLongPress.onTouchstart(item)"
            @touchend="cardLongPress.onTouchend"
            @touchcancel="cardLongPress.onTouchcancel"
            @touchmove="cardLongPress.onTouchmove"
          >
            <view class="card-img-box">
              <img
                :src="thumbUrl(item.images?.[0], 'card') || '/static/placeholder.svg'"
                :class="['card-img', { 'card-img-sold': item.status === 'sold' }]"
                :style="dimsToAspectStyle(effectiveDims(item), 0)"
                :alt="item.title"
                loading="lazy"
                @load="onImgLoad($event, item, 0)"
              />
              <view v-if="item.status === 'sold'" class="sold-overlay">
                <text>{{ t('status.sold') }}</text>
              </view>
              <view v-else-if="item.status === 'reserved'" class="card-cond-badge"><UBadge variant="reserved">{{ t('status.reserved') }}</UBadge></view>
              <view v-else-if="item.condition === 'defective'" class="card-cond-badge"><UBadge variant="defect">{{ t('condition.defective') }}</UBadge></view>
              <view v-else-if="item.condition === 'new'" class="card-cond-badge"><UBadge variant="new">{{ t('condition.new') }}</UBadge></view>
              <view v-else-if="item.condition === 'like_new'" class="card-cond-badge"><UBadge variant="mint">{{ t('condition.like_new') }}</UBadge></view>
              <view v-if="item.images && item.images.length > 1" class="img-count-badge">
                <text>{{ item.images.length }}</text>
              </view>
              <view v-if="item.location_verified && matchSpot(item.location)?.safe" class="badge-safe-corner" :aria-label="t('pickup.verifiedPickup')">
                <text class="bsc-check">✓</text>
                <text class="bsc-label">{{ t('pickup.verifiedPickup') }}</text>
              </view>
            </view>
            <view class="card-info">
              <text class="card-title">{{ localizeItemTitle(item) }}</text>
              <view class="card-price-row">
                <text :class="['card-price', { 'card-price-free': item.price === 0 }]">{{ formatPrice(item.price, t('home.free')) }}</text>
                <text v-if="item.negotiable" class="obo-tag">OBO</text>
              </view>
              <view class="card-bottom">
                <view class="card-seller">
                  <image
                    :src="item.profile?.avatar_url || defaultAvatarSrc"
                    class="seller-pic"
                    mode="aspectFill"
                  />
                  <text class="seller-nick">{{ item.profile?.nickname || t('app.user') }}</text>
                  <text class="card-time">{{ formatTime(item.created_at) }}</text>
                </view>
                <view class="card-fav">
                  <text v-if="isOldItem(item.created_at)" class="old-tag">{{ t('home.oldListing') }}</text>
                  <image
                    :src="isFavorited(item.id) ? '/static/heart-filled.svg' : '/static/heart.svg'"
                    :class="['heart-img', { 'u-anim-heart-pop': isFavorited(item.id) }]"
                    role="button"
                    :aria-label="isFavorited(item.id) ? t('a11y.unfavorite') : t('a11y.favorite')"
                    @click.stop="onQuickFav(item)"
                  />
                  <text class="fav-num">{{ item.favorite_count || 0 }}</text>
                </view>
              </view>
            </view>
          </view>
        </view>
        </view>
      </view>

      <!-- Loading more -->
      <view v-if="loading && !initialLoading" class="tip">
        <view class="dots"><text>·</text><text>·</text><text>·</text></view>
        <text>{{ t('home.loading') }}</text>
      </view>
      <!-- End of list -->
      <view v-if="!hasMore && filteredItems.length > 0" class="tip">
        <text class="divider"></text>
        <text>{{ t('home.endOf') }} · {{ filteredItems.length }} {{ t('home.results') }}</text>
        <text class="divider"></text>
      </view>
      <!-- Empty -->
      <view v-if="fetchError && !loading" class="empty">
        <view class="empty-error-icon"></view>
        <text class="empty-sub">{{ fetchError }}</text>
        <view class="empty-btn" @click="onRefresh">{{ t('home.retry') }}</view>
      </view>

      <view v-else-if="!loading && !initialLoading && filteredItems.length === 0" class="empty">
        <view class="empty-bag-icon"></view>
        <text class="empty-title">{{ searchText ? t('home.noResults') : t('home.emptyTitle') }}</text>
        <text class="empty-sub">{{ searchText ? t('home.tryOther') : t('home.emptySub') }}</text>
        <view v-if="searchText" class="empty-btn" @click="searchText = ''; onSearch()">{{ t('home.clearSearch') }}</view>
        <view v-else class="empty-btn" @click="goPublish">{{ t('home.postItem') }}</view>
      </view>
    </scroll-view>

    <!-- Back to top -->
    <view v-if="showBackTop" class="back-top" role="button" :aria-label="t('a11y.backToTop')" @click="scrollToTop">
      <view class="bt-arrow"></view>
    </view>

    <CustomTabBar current="index" />
  </view>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { onShow, onShareAppMessage, onShareTimeline } from '@dcloudio/uni-app'
import { useItems } from '../../composables/useItems'
import { useI18n } from '../../composables/useI18n'
import { useAuth } from '../../composables/useAuth'
import { useTheme } from '../../composables/useTheme'
import { useFavorites } from '../../composables/useFavorites'
import { useModeration } from '../../composables/useModeration'
import { useSemester } from '../../composables/useSemester'
import { matchSpot } from '../../composables/useCampusSpots'
import { useLongPress } from '../../composables/useLongPress'
import type { ItemCategory, ItemCondition, Item } from '../../types'

import { debounce, formatTime, formatPrice, haptic, thumbUrl } from '../../utils'
import { dimsToAspectStyle, readNaturalDims } from '../../utils/imgStyle'
import type { ImageDim } from '../../types'
import DesktopNav from '../../components/DesktopNav.vue'
import CustomTabBar from '../../components/CustomTabBar.vue'
import UBadge from '../../components/UBadge.vue'

const { t, lang, localize } = useI18n()
const { isDark } = useTheme()
const defaultAvatarSrc = computed(() =>
  isDark.value ? '/static/default-avatar-dark.svg' : '/static/default-avatar.svg'
)
const { phase: semesterPhase, config: semesterConfig, title: semesterTitle, subtitle: semesterSubtitle } = useSemester()

const semesterDismissed = ref<boolean>(false)
try { semesterDismissed.value = !!uni.getStorageSync(`semester_dismissed_${semesterPhase.value}`) } catch {}

const showSemesterBanner = computed(() =>
  !semesterDismissed.value
  && semesterPhase.value !== 'fall_session'
  && semesterPhase.value !== 'spring_session'
  && semesterPhase.value !== 'summer'
  && !selectedCategory.value,
)

function onSemesterBannerTap() {
  const cat = semesterConfig.value.category as ItemCategory | undefined
  if (cat) selectCategory(cat)
}

/*
 * Thin delegate to localize().
 *
 * An earlier version branched to quickTranslate() for items whose
 * title_i18n was missing. That shortcut SKIPPED the auto-translate
 * scheduler inside localize(), so legacy rows stayed in their source
 * language forever no matter how long the user waited. Going straight
 * through localize() means a missing map still fires the background
 * fetch and the card flips to the translated title once it returns.
 */
function localizeItemTitle(it: { title: string; title_i18n?: Record<string, string> | null }): string {
  if (!it?.title) return ''
  return localize(it.title_i18n, it.title)
}

const { items, loading, hasMore, fetchError, fetchItems } = useItems()
const { currentUser } = useAuth()
const { isFavorited, toggleFavorite, loadMyFavorites } = useFavorites()
const { ensureLoaded: ensureBlockedLoaded, reportTarget } = useModeration()

const initialLoading = ref(true)

/*
 * Render-side safety net for image dims.
 *
 * Migration 014 persists image_dimensions so cards can reserve the
 * correct aspect-ratio slot on first paint. When the DB value is
 * empty/invalid (pre-migration rows OR a publish write that never
 * landed — see _ai_notes/IMAGE_PIPELINE_*.md), we fall back to
 * naturalWidth/Height measured once the image decodes. DB always
 * wins; this is the "DB didn't have data" rescue path only.
 */
const measuredDims = ref<Record<string, ImageDim[]>>({})

function effectiveDims(item: Item): ImageDim[] | null {
  const fromDb = item?.image_dimensions
  if (Array.isArray(fromDb) && fromDb.length > 0 && fromDb.some((d) => d && d.w > 0 && d.h > 0)) {
    return fromDb
  }
  return measuredDims.value[item.id] || null
}

function onImgLoad(e: any, item: Item, idx: number) {
  const fromDb = item?.image_dimensions
  if (Array.isArray(fromDb) && fromDb[idx] && fromDb[idx].w > 0 && fromDb[idx].h > 0) return
  const natural = readNaturalDims(e)
  if (!natural) return
  const prev = measuredDims.value[item.id] ? measuredDims.value[item.id].slice() : []
  prev[idx] = natural
  measuredDims.value = { ...measuredDims.value, [item.id]: prev }
}

const searchText = ref('')
const selectedCategory = ref<ItemCategory | null>(null)
const currentPage = ref(0)
const isRefreshing = ref(false)
const columnCount = ref(2)
const banners = computed(() => [
  { icon: '📦', title: t('banner.sell'), sub: t('banner.sellSub'), color: 'bg-warm', action: () => uni.switchTab({ url: '/pages/publish/index' }) },
  { icon: '🎓', title: t('banner.grad'), sub: t('banner.gradSub'), color: 'bg-blue', action: () => selectCategory('furniture') },
  { icon: '💡', title: t('banner.tip'), sub: t('banner.tipSub'), color: 'bg-green', action: () => {} },
])
const showBackTop = ref(false)
const scrollTopVal = ref(0)
const lastScrollTop = ref(0)

const showFilter = ref(false)
const filterPriceMin = ref('')
const filterPriceMax = ref('')
const filterCondition = ref<ItemCondition | ''>('')
const filterLocation = ref('')
const sortBy = ref('latest')

const categoryKeys: (ItemCategory | null)[] = [null, 'currency_exchange', 'rideshare', 'electronics', 'furniture', 'housing', 'clothing', 'books', 'vehicles', 'daily', 'food', 'other']
const categories = computed(() => categoryKeys.map(k => ({
  value: k,
  label: t(k ? 'cat.pair.' + k : 'cat.pair.all'),
})))

/*
 * Category grid tiles for the mobile hero area.
 *
 * The 4-col circle grid replaces the horizontal pill scroll. Each
 * category gets an emoji icon + soft pastel tile color. We intentionally
 * keep `null` ("All") at position 0 so tapping it clears the filter and
 * shows everything, matching the pill behavior.
 */
const conditionKeys: ItemCondition[] = ['new', 'like_new', 'good', 'fair']
const conditionOpts = computed(() => {
  const m: Record<string, string> = {}
  conditionKeys.forEach(k => { m[k] = t('condition.' + k) })
  return m
})

const locationOpts = ['Champaign', 'Urbana', 'UIUC']

const sortKeys = ['latest', 'price_asc', 'price_desc', 'popular']
const sortOpts = computed(() => sortKeys.map(k => ({ value: k, label: t('sort.' + k.replace('price_asc', 'priceAsc').replace('price_desc', 'priceDesc')) })))

const activeFilterCount = computed(() => {
  let c = 0
  if (filterPriceMin.value) c++
  if (filterPriceMax.value) c++
  if (filterCondition.value) c++
  if (filterLocation.value) c++
  if (sortBy.value !== 'latest') c++
  return c
})

const displayItems = computed(() => items.value)

function getFilterParams() {
  return {
    category: selectedCategory.value,
    search: searchText.value,
    priceMin: filterPriceMin.value ? Number(filterPriceMin.value) : undefined,
    priceMax: filterPriceMax.value ? Number(filterPriceMax.value) : undefined,
    condition: filterCondition.value || undefined,
    sort: sortBy.value,
  }
}

const filteredItems = computed(() => {
  let result = [...displayItems.value]

  if (filterLocation.value) {
    const loc = filterLocation.value.toLowerCase()
    result = result.filter(item => item.location.toLowerCase().includes(loc))
  }

  return result
})

const columns = computed(() => {
  const cols: Item[][] = Array.from({ length: columnCount.value }, () => [])
  filteredItems.value.forEach((item: Item, i: number) => {
    cols[i % columnCount.value].push(item)
  })
  return cols
})

function applyFilters() {
  showFilter.value = false
  currentPage.value = 0
  fetchItems({ ...getFilterParams(), reset: true })
}

function resetFilters() {
  filterPriceMin.value = ''
  filterPriceMax.value = ''
  filterCondition.value = ''
  filterLocation.value = ''
  sortBy.value = 'latest'
}

function onClearAllFilters() {
  resetFilters()
  currentPage.value = 0
  fetchItems({ ...getFilterParams(), reset: true })
}

onMounted(async () => {
  try {
    const info = uni.getSystemInfoSync()
    columnCount.value = info.windowWidth >= 768 ? 3 : 2
  } catch {}

  try {
    const onResize = (uni as any).onWindowResize
    if (typeof onResize === 'function') {
      onResize((res: { size: { windowWidth: number } }) => {
        columnCount.value = res.size.windowWidth >= 768 ? 3 : 2
      })
    }
  } catch {}

  if (currentUser.value) {
    await Promise.all([
      loadMyFavorites(currentUser.value.id),
      ensureBlockedLoaded(),
    ])
  }
  await fetchItems({ ...getFilterParams(), reset: true })
  initialLoading.value = false
})

function selectCategory(category: ItemCategory | null) {
  selectedCategory.value = category
  currentPage.value = 0
  fetchItems({ ...getFilterParams(), category, reset: true })
}

/*
 * Search history + focus state previously lived here as a floating
 * dropdown. Moved to /pages/search/index.vue per the refinement pass
 * so the home page isn't crowded by the recent-search pills.
 *
 * Home's search field is now a PROXY — tapping it navigateTo()'s
 * the search page, which handles recent + browse-by-category +
 * live input. The search page hands results back via two storage
 * keys (pending_search | pending_category) that we consume on
 * onShow below.
 */
function goToSearch() {
  uni.navigateTo({ url: '/pages/search/index' })
}

function consumePendingSearch() {
  try {
    const ps = uni.getStorageSync('pending_search')
    if (ps) {
      uni.removeStorageSync('pending_search')
      searchText.value = ps
      onSearch()
      return
    }
    const pc = uni.getStorageSync('pending_category')
    if (pc !== '' && pc !== undefined && pc !== null) {
      uni.removeStorageSync('pending_category')
      selectCategory(pc || null)
    }
  } catch {}
}

/*
 * Lightweight history save used when home re-fires the search via
 * the debounced fetch (e.g. after the user comes back from search
 * page and we want the filtered feed to also persist the query).
 * The full recent-search surface is maintained on the search page.
 */
const SEARCH_HISTORY_MAX = 8
function saveSearch(text: string) {
  if (!text.trim()) return
  try {
    const raw = uni.getStorageSync('searchHistory') || '[]'
    const list: string[] = JSON.parse(raw)
    const next = [text, ...list.filter((s) => s !== text)].slice(0, SEARCH_HISTORY_MAX)
    uni.setStorageSync('searchHistory', JSON.stringify(next))
  } catch {}
}

const debouncedFetch = debounce(() => {
  currentPage.value = 0
  if (searchText.value.trim()) saveSearch(searchText.value.trim())
  fetchItems({ ...getFilterParams(), reset: true })
}, 300)

async function onQuickFav(item: Item) {
  if (!currentUser.value) {
    uni.navigateTo({ url: '/pages/login/index' })
    return
  }
  haptic('light')
  const nowFav = await toggleFavorite(currentUser.value.id, item.id)
  item.favorite_count = (item.favorite_count || 0) + (nowFav ? 1 : -1)
}

/* 1.5s + haptic for the home feed report flow — a thumb resting on a
   card during scroll used to fire the report action sheet at 350ms,
   which scared users away from scrolling. Tuned 3s → 2s in batch #2,
   then 2s → 1.5s in batch #3a — 2s still tested as draggy in user
   acceptance, 1.5s preserves the deliberate-intent gate while feeling
   responsive enough that holding doesn't feel like waiting. */
const cardLongPress = useLongPress<[Item]>((item) => onCardLongPress(item), 1500)

function onCardLongPress(item: Item) {
  const favLabel = isFavorited(item.id) ? t('home.unsave') : t('detail.save')
  const isMine = currentUser.value?.id && item.user_id === currentUser.value.id
  const actions: string[] = [favLabel, t('home.shareItem')]
  if (!isMine) actions.push(t('report.reportItem'))
  uni.showActionSheet({
    itemList: actions,
    success: async (res) => {
      if (res.tapIndex === 0) {
        await onQuickFav(item)
      } else if (res.tapIndex === 1) {
        // #ifdef H5
        const url = `${window.location.origin}/share/${item.id}`
        if (navigator.share) {
          navigator.share({ title: item.title, text: `$${item.price} - ${item.title}`, url })
            .catch((err: any) => {
              if (err?.name !== 'AbortError') console.warn('[share] failed:', err)
            })
        } else {
          uni.setClipboardData({ data: url })
          uni.showToast({ title: t('detail.linkCopied'), icon: 'success' })
        }
        // #endif
        // #ifndef H5
        uni.showToast({ title: t('detail.linkCopied'), icon: 'success' })
        // #endif
      } else if (res.tapIndex === 2 && !isMine) {
        promptReportItem(item.id)
      }
    },
  })
}

function promptReportItem(itemId: string) {
  if (!currentUser.value) {
    uni.navigateTo({ url: '/pages/login/index' })
    return
  }
  const reasons = [
    t('report.reasonSpam'),
    t('report.reasonProhibited'),
    t('report.reasonMisleading'),
    t('report.reasonOther'),
  ]
  uni.showActionSheet({
    itemList: reasons,
    success: async (res) => {
      const reason = reasons[res.tapIndex]
      uni.showLoading({ title: t('report.submitting') || t('login.wait'), mask: true })
      try {
        await reportTarget('item', itemId, reason)
        uni.hideLoading()
        uni.showToast({ title: t('report.thanks'), icon: 'success' })
      } catch (err: any) {
        uni.hideLoading()
        uni.showToast({ title: err?.message || t('report.failed'), icon: 'none' })
      }
    },
  })
}

function isOldItem(createdAt: string): boolean {
  return Date.now() - new Date(createdAt).getTime() > 30 * 86400000
}

function onSearch() {
  debouncedFetch()
}

function onClearSearch() {
  searchText.value = ''
  haptic('light')
  onSearch()
}

function onScroll(e: any) {
  showBackTop.value = e.detail.scrollTop > 600
  lastScrollTop.value = e.detail.scrollTop
}

function scrollToTop() {
  scrollTopVal.value = 1
  setTimeout(() => { scrollTopVal.value = 0 }, 50)
}

onShow(() => {
  consumePendingSearch()
  if (lastScrollTop.value > 0) {
    const saved = lastScrollTop.value
    setTimeout(() => {
      scrollTopVal.value = saved
      setTimeout(() => { scrollTopVal.value = 0 }, 100)
    }, 50)
  }
})

onShareAppMessage(() => ({
  title: 'Illini Market · UIUC 校园二手交易',
  path: '/pages/index/index',
}))

onShareTimeline(() => ({
  title: 'Illini Market · UIUC 校园二手交易',
}))

function loadMore() {
  if (loading.value || !hasMore.value) return
  currentPage.value++
  fetchItems({ ...getFilterParams(), page: currentPage.value })
}

async function onRefresh() {
  if (isRefreshing.value) return
  isRefreshing.value = true
  currentPage.value = 0
  const failsafe = setTimeout(() => { isRefreshing.value = false }, 10000)
  try {
    await fetchItems({ ...getFilterParams(), reset: true })
  } finally {
    clearTimeout(failsafe)
    isRefreshing.value = false
  }
}

function goToDetail(id: string) {
  uni.navigateTo({ url: `/pages/detail/index?id=${id}` })
}

function goPublish() {
  uni.switchTab({ url: '/pages/publish/index' })
}
</script>

<style lang="scss" scoped>
/* ============================================
   CAACI Marketplace Homepage
   XHS UI + Xianyu features
   ============================================ */

.page {
  height: 100vh;
  height: 100dvh;
  display: flex; flex-direction: column;
  background: var(--bg-subtle);
  overflow: hidden;
}

/*
 * Mobile header — canvas background (not white) so the whole top of
 * the app reads as one warm sheet of paper. White card surfaces
 * below (hero, cat-grid, item cards) sit on top and get visual
 * separation from their shadows + hairline borders.
 */
.mobile-header {
  flex-shrink: 0;
  background: var(--canvas);
  padding: 0 16px 11px;
  padding-top: var(--mp-status-bar);
  z-index: 50;
}
.mh-top {
  display: flex;
  justify-content: flex-start;
  align-items: center;
  height: var(--mp-navbar-height, 44px);
  padding-right: var(--mp-navbar-right-pad, 104px);
  margin-bottom: 8px;
}
/*
 * Brand word-mark — serif masthead per refinement pass. Navy ink
 * on the canvas reads like a bookshop sign; 22px Fraunces gives
 * the weight without needing bold.
 */
.mh-brand {
  font-family: var(--font-serif);
  font-size: 22px;
  font-weight: 500;
  color: var(--ink);
  letter-spacing: 0.02em;
  line-height: 1.2;
}
/* .mh-right / .mh-lang previously housed the inline language toggle.
   Language switching moved to Settings → Language, so those rules
   are intentionally gone. Removing them keeps the header compact. */
.mh-search {
  display: flex; align-items: center; gap: 9px;
}
/*
 * Search field — refinement pattern: white surface, UIUC-blue hairline
 * border, navy text. The previous parchment-bg input blended into the
 * header and read as a placeholder slot; white-on-parchment reads as
 * an active input field.
 */
.search-field {
  flex: 1; display: flex; align-items: center;
  background: var(--surface);
  border: 0.5px solid var(--border);
  border-radius: var(--radius-md);
  padding: 9px 13px;
  gap: 8px;
  input {
    flex: 1;
    font-size: 13px;
    color: var(--ink);
    background: transparent;
    letter-spacing: 0.02em;
  }
}
.sf-icon {
  width: 14px; height: 14px; border: 1.6px solid var(--ink-faint); border-radius: 50%; position: relative; flex-shrink: 0;
}
.sf-icon::after {
  content: ''; position: absolute; bottom: -4px; right: -4px;
  width: 5px; height: 1.6px; background: var(--ink-faint); transform: rotate(45deg);
}
.sf-clear {
  width: 18px; height: 18px; border-radius: 50%; background: var(--ink-faint);
  color: #fff; font-size: 12px; font-weight: 600;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.filter-btn {
  /* Labeled pill — the bare decreasing-lines glyph read as decoration,
     not as a tappable filter entry (2026-06 meeting feedback). */
  position: relative; height: 38px; padding: 0 11px; gap: 6px;
  border-radius: var(--radius-md);
  background: var(--surface);
  border: 0.5px solid var(--border);
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0; cursor: pointer;
  &:active { background: var(--parchment); }
}
.fb-label { font-size: 12px; font-weight: 500; color: var(--text-secondary); line-height: 1; }
.fb-lines {
  display: flex; flex-direction: column; gap: 3px; width: 16px;
  view { height: 1.8px; background: var(--text-secondary); border-radius: 1px; }
  view:nth-child(1) { width: 16px; }
  view:nth-child(2) { width: 12px; }
  view:nth-child(3) { width: 8px; }
}
.fb-badge {
  position: absolute; top: 1px; right: 1px;
  width: 15px; height: 15px; border-radius: 50%;
  background: var(--accent-action); color: #fff; font-size: 9px; font-weight: 600;
  display: flex; align-items: center; justify-content: center;
}

/*
 * Category rail — the horizontal pill scroll from the marketplace/
 * kit's HomeScreen.jsx. The prior 4×3 circle grid + tall hero ate
 * more than 400px of vertical space; this compact rail keeps the
 * fold to ~50px and lets products breathe above the fold. Matches
 * how Xianyu / Taobao / Xiaohongshu handle category navigation on
 * feed pages.
 */
.cat-bar {
  flex-shrink: 0;
  padding: 8px 16px 10px;
  background: var(--canvas);
  border-bottom: 0.5px solid var(--border);
  white-space: nowrap;
}
.cat-bar-inner {
  display: inline-flex;
  gap: 6px;
  padding-right: 16px;
}
.cat-tab-spacer {
  display: inline-block;
  width: 80rpx;
  flex-shrink: 0;
  pointer-events: none;
}
.pill {
  display: inline-flex; align-items: center; justify-content: center;
  height: 30px;
  padding: 0 13px;
  border-radius: var(--radius-pill);
  font-size: 13px;
  color: var(--ink);
  background: var(--surface);
  border: 0.5px solid var(--border-strong);
  transition: all 0.15s; cursor: pointer; font-weight: 500;
  line-height: 1;
  letter-spacing: 0.02em;
  box-sizing: border-box;
  flex-shrink: 0;
  /* Color must live on the <text> child, not just the view — the global
     mp-weixin `text {}` floor in App.vue beats inherited color, which made
     the active pill label invisible (ink-on-ink). */
  text { color: var(--ink); }
  &.active {
    background: var(--ink);
    color: var(--ink-inverse);
    border-color: var(--ink);
    text { color: var(--ink-inverse); }
  }
  &:active { transform: scale(0.96); }
}

/* ========== Filter Bottom Sheet ========== */
/* z-index must be higher than .tabbar (999) — otherwise the tabbar
   floats above the sheet and covers the "Apply" button. Mask sits
   just below the sheet but still above the tabbar so it dims it too. */
.filter-mask {
  position: fixed; top: 0; right: 0; bottom: 0; left: 0; z-index: 1000;
  background: rgba(0,0,0,0.35);
}
.filter-sheet {
  position: fixed;
  bottom: 0; left: 0; right: 0; z-index: 1001;
  background: var(--bg-elev-1);
  border-radius: 16px 16px 0 0;
  padding: 0 20px 20px;
  transform: translateY(100%);
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  max-height: 70vh;
  overflow-y: auto;
  &.open { transform: translateY(0); }
}
.fs-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 18px 0 14px;
  position: sticky; top: 0; background: var(--bg-elev-1); z-index: 1;
  gap: 12px;
}
.fs-close {
  width: 28px; height: 28px; border-radius: 50%; background: var(--bg-subtle);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; flex-shrink: 0;
  &:active { background: var(--bg-inset); }
}
.fs-x {
  width: 12px; height: 12px; position: relative;
  &::before, &::after {
    content: ''; position: absolute; top: 50%; left: 0;
    width: 12px; height: 1.5px; background: var(--text-secondary); border-radius: 1px;
  }
  &::before { transform: rotate(45deg); }
  &::after { transform: rotate(-45deg); }
}
.fs-title { flex: 1; font-size: 17px; font-weight: 700; color: var(--ink); text-align: center; letter-spacing: -0.01em; }
.fs-reset { font-size: 14px; color: var(--accent-action); cursor: pointer; flex-shrink: 0; }

.scam-banner {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 10px 14px;
  background: var(--warning-soft);
  border-bottom: 0.5px solid var(--warning-soft);
  border-left: 3px solid var(--warning);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
}
.sb-icon {
  flex-shrink: 0; width: 20px; height: 20px;
  border-radius: 50%; background: var(--warning);
  display: flex; align-items: center; justify-content: center;
  margin-top: 1px;
}
.sb-excl {
  width: 2px; height: 10px; background: var(--bg-elev-1); border-radius: 1px;
  position: relative;
}
.sb-excl::after {
  content: ''; position: absolute; bottom: -5px; left: -1px;
  width: 4px; height: 3px; background: var(--bg-elev-1); border-radius: 2px;
}
.sb-body { flex: 1; display: flex; flex-direction: column; gap: 3px; }
.sb-title { font-size: 12px; font-weight: 700; color: var(--warning); letter-spacing: 0.01em; }
.sb-text { font-size: 11px; color: var(--ink-soft); line-height: 1.6; }

/*
 * Semester / move-out banner — kit ink-editorial card (index_v1.html
 * .card.feature + components-banners.html "ghosted I"). Ink fill, a
 * mono brand stamp in campus-orange, serif title in ink-inverse, and
 * a ghosted serif "I" arc bleeding off the right edge as the brand
 * accent. Replaces the prior off-system blue→orange gradient.
 */
.semester-banner {
  position: relative;
  overflow: hidden;
  display: flex; align-items: center; gap: var(--space-3);
  margin: var(--space-2) var(--space-3) var(--space-1);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-md);
  background: var(--ink);
  box-shadow: var(--shadow-pop);
  cursor: pointer;
}
/* Decorative serif "I" arc — the brand accent. Cream-ghosted so it
   reads as a watermark on the ink fill, not a literal glyph. */
.seb-arc {
  position: absolute; right: -14px; top: -34px;
  font-family: var(--font-serif);
  font-size: 140px; font-weight: 600; line-height: 1;
  letter-spacing: -0.08em;
  color: var(--brand-ghost);
  opacity: 0.1;
  pointer-events: none;
}
.seb-body {
  position: relative;
  flex: 1; display: flex; flex-direction: column; gap: 3px;
  min-width: 0;
}
/* Mono eyebrow stamp — campus-orange override of the global .t-eyebrow
   (which defaults to --ink-quiet, unreadable on ink). */
.seb-stamp {
  color: var(--campus-orange);
  margin-bottom: 2px;
}
.seb-title {
  font-family: var(--font-serif);
  font-size: 15px; font-weight: 600;
  color: var(--ink-inverse);
  letter-spacing: -0.01em;
  line-height: 1.2;
}
.seb-sub {
  font-size: 12px;
  color: var(--ink-inverse);
  opacity: 0.72;
  line-height: 1.4;
}
.seb-arrow {
  position: relative;
  font-family: var(--font-serif);
  font-size: 22px; line-height: 1;
  color: var(--brand-soft);
  flex-shrink: 0;
}

.active-filter-bar {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 12px 8px;
  background: var(--bg-elev-1);
  border-bottom: 0.5px solid var(--line-hair);
}
.afb-scroll { flex: 1; white-space: nowrap; overflow: hidden; }
.afb-chip {
  display: inline-flex; align-items: center;
  padding: 5px 11px; margin-right: 6px; border-radius: 14px;
  background: rgba(199,74,47,0.08); cursor: pointer;
  text { font-size: 12px; color: var(--accent-action); font-weight: 500; }
  &:active { background: rgba(199,74,47,0.16); }
}
.afb-clear {
  padding: 5px 10px; border-radius: 14px;
  background: var(--bg-subtle); cursor: pointer; flex-shrink: 0;
  text { font-size: 12px; color: var(--text-secondary); font-weight: 500; }
  &:active { background: var(--bg-inset); }
}
.fs-section { margin-bottom: 18px; }
.fs-label { font-size: 13px; color: var(--ink-quiet); margin-bottom: 10px; display: block; }
.fs-price-row { display: flex; align-items: center; gap: 10px; }
.fs-price-input {
  flex: 1; display: flex; align-items: center;
  background: var(--bg-subtle); border-radius: 10px; padding: 10px 12px; gap: 4px;
  input { flex: 1; font-size: 15px; color: var(--ink); background: transparent; font-family: var(--font-serif); letter-spacing: -0.01em; }
}
.fs-dollar { font-size: 15px; color: var(--ink-quiet); font-weight: 600; }
.fs-dash { color: var(--ink-faint); font-size: 16px; }
.fs-pills { display: flex; flex-wrap: wrap; gap: 8px; }
.fpill {
  padding: 7px 15px; border-radius: 8px;
  font-size: 13px; color: var(--text-secondary); background: var(--bg-subtle);
  cursor: pointer; transition: all 0.15s; font-weight: 500;
  &.active { background: var(--ink); color: var(--ink-inverse); }
}
/* Even though the sheet wins z-index (1001 > 999 on tabbar), the apply
   button visually coincided with the tabbar row, creating a jarring
   double-control illusion. Physical clearance (= tabbar height) fixes it
   on mobile. Desktop has no tabbar so the base padding is enough. */
.fs-footer { padding-top: 10px; padding-bottom: calc(10px + env(safe-area-inset-bottom, 0px)); }
@media (max-width: 767px) {
  .fs-footer { padding-bottom: calc(18px + 56px + env(safe-area-inset-bottom, 0px)); }
}
.fs-apply {
  width: 100%; padding: 14px; border-radius: var(--radius-pill);
  background: var(--accent-primary); color: #fff; font-size: 15px; font-weight: 600;
  text-align: center; cursor: pointer;
  box-shadow: var(--shadow-cta);
  &:active { opacity: 0.85; }
}

/* ========== Feed ========== */
.feed { flex: 1; min-height: 0; padding-bottom: 76px; }

/* ========== Waterfall ========== */
.waterfall { display: flex; padding: 5px; gap: 5px; padding-bottom: 54px; }
.wf-col { flex: 1; display: flex; flex-direction: column; gap: 5px; }

/* ========== Card ==========
   New visual language: slightly larger radius + soft elevation shadow
   matches the campus-market mock. The shadow color uses warm neutrals
   (brown-tinted alpha) instead of cool grey so it blends into the
   cream page background without a muddy halo. */
.card {
  background: var(--surface);
  border-radius: var(--radius-md);
  border: 0.5px solid var(--border);
  overflow: hidden;
  cursor: pointer;
  box-shadow: var(--shadow-soft);
  transition: transform 0.1s, box-shadow 0.15s;
  &:active { transform: scale(0.98); }
}
/* Xiaohongshu waterfall: each <img> carries an inline aspect-ratio
   driven by items.image_dimensions (migration 014), so the box
   reserves slot-accurate space on first paint — no CLS while the
   real image decodes. Missing dims fall back to 4/5 via
   dimsToAspectStyle. object-fit: contain is the safety net for
   freak clamped ratios. */
.card-img-box {
  position: relative; width: 100%;
  background: var(--surface-alt);
  overflow: hidden;
  min-height: 120px;
}
.card-img {
  width: 100%;
  display: block;
  object-fit: contain;
  transition: filter 0.2s;
  &.card-img-sold { filter: grayscale(1) brightness(0.85); }
}
.sold-overlay {
  position: absolute; top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  padding: 6px 14px; border-radius: 6px;
  background: rgba(0,0,0,0.6);
  text { color: #fff; font-size: 13px; font-weight: 700; letter-spacing: 1px; }
}
.img-count-badge {
  position: absolute; top: 7px; right: 7px;
  display: inline-flex; align-items: center; justify-content: center;
  padding: 2px 7px; border-radius: 10px;
  background: rgba(0,0,0,0.55); backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  /* line-height 1 + flex centering — inherited body line-height made the
     digit sit visibly below the pill's optical center. */
  text { color: #fff; font-size: 10px; font-weight: 600; line-height: 1; }
}
/* Condition pill visual lives in components/UBadge.vue now; the page only
   owns its placement (top-left over the card image). */
.card-cond-badge { position: absolute; top: 7px; left: 7px; }
/* Safe-zone "verified pickup spot" badge — bottom-left, green to signal trust.
   Placed opposite to .img-count-badge (top-right) and .badge (top-left) so it
   never collides with either. */
.badge-safe-corner {
  position: absolute; bottom: 7px; left: 7px;
  display: inline-flex; align-items: center; gap: 3px;
  padding: 2px 7px 2px 5px; border-radius: 10px;
  background: var(--success);
}
.bsc-check { font-size: 10px; color: var(--ink-inverse); font-weight: 800; line-height: 1; }
.bsc-label { font-size: 10px; color: var(--ink-inverse); font-weight: 600; line-height: 1; }
.card-time { font-size: 10px; color: var(--text-faint); margin-left: auto; }
.old-tag { font-size: 10px; color: var(--text-faint); margin-right: 2px; }

.card-info { padding: 9px 10px 11px; }
.card-title {
  font-size: 13px; color: var(--text-primary); line-height: 1.35; font-weight: 400;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden; word-break: break-all;
}
.card-price-row { display: flex; align-items: baseline; gap: 4px; margin-top: 5px; }
/* Waterfall card price in Fraunces serif + terracotta — matches the
   米白书院 "price is the only confident number on the page" rule.
   Free items shift to sage so "免费 / Free" reads as positive state. */
.card-price {
  font-family: var(--font-serif);
  font-size: 17px; font-weight: 600;
  color: var(--brand);
  letter-spacing: -0.01em;
  line-height: 1;
  font-feature-settings: 'tnum';
}
.card-price-free { color: var(--success); }
/* OBO chip — amber-toned warning pill, ivory_academy pattern. */
.obo-tag {
  font-size: 9px; font-weight: 600;
  color: var(--warning);
  background: var(--warning-soft);
  padding: 1px 4px;
  border-radius: var(--radius-xs);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.card-bottom { display: flex; justify-content: space-between; align-items: center; margin-top: 7px; }
.card-seller { display: flex; align-items: center; gap: 5px; flex: 1; min-width: 0; }
.seller-pic { width: 16px; height: 16px; border-radius: 50%; background: var(--bg-subtle); flex-shrink: 0; }
.seller-nick { font-size: 11px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card-fav { display: flex; align-items: center; gap: 4px; flex-shrink: 0; padding: 4px 2px; }
.heart-img {
  width: 18px; height: 18px; cursor: pointer;
  transition: transform 0.15s;
  &:active { transform: scale(1.25); }
}
.fav-num { font-size: 10px; color: var(--text-faint); }

/* ========== Skeleton ========== */
.skeleton-card { pointer-events: none; }
.sk-img { background: var(--bg-inset); }
.sk-body { padding: 10px; }
.sk-line {
  height: 10px; background: var(--bg-inset); border-radius: 5px; margin-bottom: 8px;
  animation: shimmer 1.5s ease-in-out infinite;
}
.sk-line.w60 { width: 60%; }
.sk-line.w40 { width: 40%; flex: 1; }
.sk-row { display: flex; gap: 6px; align-items: center; margin-top: 4px; }
.sk-circle {
  width: 18px; height: 18px; border-radius: 50%; background: var(--bg-inset); flex-shrink: 0;
  animation: shimmer 1.5s ease-in-out infinite;
}
@keyframes shimmer {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}

/* ========== States ========== */
.tip {
  display: flex; align-items: center; justify-content: center;
  padding: 20px; gap: 8px; color: var(--ink-faint); font-size: 12px;
}
.dots {
  display: flex; gap: 2px;
  text {
    animation: blink 1.4s infinite both; font-size: 20px; color: var(--accent-action);
    &:nth-child(2) { animation-delay: 0.2s; }
    &:nth-child(3) { animation-delay: 0.4s; }
  }
}
@keyframes blink { 0%, 80%, 100% { opacity: 0.2; } 40% { opacity: 1; } }
.divider { width: 28px; height: 1px; background: var(--border); }

.empty {
  display: flex; flex-direction: column; align-items: center; padding-top: 80px; gap: 8px;
}
.empty-error-icon {
  width: 40px; height: 40px; border: 2.5px solid var(--border-strong);
  border-radius: 50%; position: relative; margin-bottom: 6px;
  &::before {
    content: '!'; position: absolute; top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    font-size: 20px; font-weight: 700; color: var(--border-strong);
  }
}
.empty-bag-icon {
  width: 36px; height: 40px; border: 2.5px solid var(--border-strong);
  border-radius: 5px; position: relative; margin-bottom: 6px;
  &::before {
    content: ''; position: absolute; top: -10px; left: 5px;
    width: 22px; height: 12px;
    border: 2.5px solid var(--border-strong); border-bottom: none;
    border-radius: 11px 11px 0 0;
    /* App.vue's `view, text` border-box reset doesn't reach ::before; opt in so 22px is the outer width and the handle centers on the bag body. */
    box-sizing: border-box;
  }
}
.empty-title { font-size: 16px; color: var(--ink); font-weight: 600; }
.empty-sub { font-size: 13px; color: var(--ink-quiet); text-align: center; padding: 0 32px; }
.empty-btn {
  margin-top: 18px; padding: 11px 32px;
  background: var(--accent-primary); color: #fff; border-radius: 22px;
  font-size: 14px; font-weight: 600; cursor: pointer;
  &:active { opacity: 0.8; }
}

.banner-area { padding: 0 16px 8px; }
.banner-swiper { height: 72px; }
.banner-card {
  display: flex; align-items: center; gap: 12px; padding: 14px 16px;
  border-radius: 12px; height: 68px; cursor: pointer;
  &:active { opacity: 0.9; }
}
.bg-warm { background: var(--warning-soft); }
.bg-blue { background: var(--campus-blue-soft); }
.bg-green { background: var(--success-soft); }
.banner-emoji { font-size: 28px; flex-shrink: 0; }
.banner-text { flex: 1; }
.banner-title { font-size: 14px; font-weight: 600; color: var(--text-primary); display: block; }
.banner-sub { font-size: 11px; color: var(--text-secondary); margin-top: 2px; display: block; }

.back-top {
  position: fixed; right: 16px; bottom: calc(116px + env(safe-area-inset-bottom, 0px));
  width: 40px; height: 40px; border-radius: 50%;
  background: rgba(255,255,255,0.9); box-shadow: var(--shadow-pop);
  backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; z-index: 100;
  &:active { transform: scale(0.9); }
}
.bt-arrow {
  width: 10px; height: 10px;
  border-left: 2px solid var(--accent-primary); border-top: 2px solid var(--accent-primary);
  transform: rotate(45deg); margin-top: 3px;
}

.result-count {
  padding: 4px 16px 8px; font-size: 12px; color: var(--text-muted);
}

/*
 * Search proxy field — tapping anywhere on this bar navigates to
 * /pages/search/index. No native input; the visible text is either
 * the placeholder or the last search query (static label).
 */
.search-proxy { cursor: pointer; }
.sf-placeholder {
  flex: 1;
  font-size: 13px;
  color: var(--ink-quiet);
  letter-spacing: 0.02em;
  line-height: 1.4;
}
.sf-text {
  flex: 1;
  font-size: 13px;
  color: var(--ink);
  letter-spacing: 0.02em;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ============================================
   DESKTOP >= 768px
   ============================================ */
@media (min-width: 768px) {
  .page { max-width: 1120px; margin: 0 auto; }
  .mobile-header { display: none; }

  .cat-bar { padding: 10px 24px 12px; }
  .pill { padding: 7px 20px; font-size: 14px; height: 32px; }

  .feed { flex: 1; min-height: 0; padding-bottom: 0; }
  .waterfall { padding: 10px 24px; gap: 10px; padding-bottom: 10px; }
  .wf-col { gap: 10px; }

  .card {
    transition: transform 0.15s, box-shadow 0.15s;
    &:hover { transform: translateY(-2px); box-shadow: 0 4px 16px rgba(42, 42, 46, 0.08); }
    &:active { transform: scale(0.99); }
  }
  /*
   * Desktop cards are ~370px wide. The inline aspect-ratio from
   * image_dimensions already reserves correct height on first paint;
   * we only need a soft safety cap for freakishly tall uploads (e.g.
   * full-phone screenshots) so one rogue card can't sink the column.
   * 1200px is ~3× the card width — permissive enough that normal
   * portraits (4:5, 3:4, 2:3) render uncropped.
   */
  .card-img-box {
    max-height: 1200px;
    background: var(--bg-subtle);
    overflow: hidden;
  }
  .card-img {
    max-height: 1200px;
    width: 100%;
    object-fit: contain;
  }
  .card-info { padding: 10px 12px 12px; }
  .card-title { font-size: 14px; }
  .card-price { font-size: 18px; }
  .seller-pic { width: 20px; height: 20px; }
  .seller-nick { font-size: 12px; }
  .fav-num { font-size: 12px; }

  .filter-sheet { max-width: 480px; left: 50%; transform: translate(-50%, 100%);
    &.open { transform: translate(-50%, 0); }
  }
}
</style>
