<template>
  <view class="page has-sidebar">
    <AppSidebar current="profile" />

    <!--
      Profile page — campus-market redesign.

      Structure mirrors the reference mock:
        1. Gradient user card (avatar + nickname + location + edit button)
        2. 4-stat strip (non-clickable, just numbers)
        3. Quick-actions grid (4 colorful icon buttons)
        4. 我发布的 (active listings, horizontal scroll)
        5. 已售 (sold listings, horizontal scroll, hidden when empty)
        6. 我收藏的 (favorites, 2-col grid)
        7. 更多 (settings / blocked / sign out)

      Previous 3-tab filter (listed/saved/sold) is gone — the mock
      surfaces everything sequentially so users don't hunt in tabs.
    -->
    <view class="page-header u-glass u-glass--hair-b">
      <text class="ph-title">{{ t('nav.profile') }}</text>
    </view>

    <view v-if="!isLoggedIn" class="login-section">
      <view class="avatar-placeholder">
        <view class="ap-head"></view>
        <view class="ap-body"></view>
      </view>
      <text class="login-hint">{{ t('profile.signInHint') }}</text>
      <view class="login-btn" @click="goLogin">{{ t('profile.signIn') }}</view>
    </view>

    <view v-else class="logged-in-wrap">
      <!-- User card -->
      <view class="user-card">
        <view class="user-card-bg"></view>
        <view class="user-row">
          <image :src="currentUser?.avatar_url || defaultAvatarSrc" :alt="currentUser?.nickname || 'avatar'" class="avatar-big" mode="aspectFill" />
          <view class="user-info">
            <view class="name-row">
              <text class="nickname">{{ currentUser?.nickname }}</text>
              <UBadge v-if="currentUser?.is_illini_verified" variant="illini">Illini</UBadge>
            </view>
            <view class="user-meta-row">
              <view v-if="currentUser?.uid" class="uid-row" @click.stop="copyUid">
                <text class="uid-label">{{ t('profile.uid') }}</text>
                <text class="uid-value">{{ currentUser.uid }}</text>
              </view>
              <view class="location">
                <UIcon name="location-pin" size="xs" />
                <text class="location-text">{{ currentUser?.location || 'UIUC' }}</text>
              </view>
            </view>
            <text class="user-status" v-if="currentUser?.status_text || currentUser?.status_emoji">
              <text v-if="currentUser?.status_emoji" class="us-emoji">{{ currentUser.status_emoji }}</text>
              <text v-if="currentUser?.status_text" class="us-text">{{ currentUser.status_text }}</text>
            </text>
            <text class="user-bio" v-if="currentUser?.bio">{{ currentUser.bio }}</text>
          </view>
          <view class="edit-btn" role="button" :aria-label="t('a11y.edit')" @click="onEditProfile">
            <view class="edit-icon"></view>
          </view>
        </view>

        <!-- 4-stat strip -->
        <view class="stats-row">
          <view class="stat-item">
            <text class="stat-num">{{ listedItems.length }}</text>
            <text class="stat-label">{{ t('profile.listed') }}</text>
          </view>
          <view class="stat-divider"></view>
          <view class="stat-item">
            <text class="stat-num">{{ savedItems.length }}</text>
            <text class="stat-label">{{ t('profile.saved') }}</text>
          </view>
          <view class="stat-divider"></view>
          <view class="stat-item">
            <text class="stat-num">{{ soldItems.length }}</text>
            <text class="stat-label">{{ t('profile.sold') }}</text>
          </view>
          <view class="stat-divider"></view>
          <view class="stat-item" @click="goHistory">
            <text class="stat-num">{{ totalBrowsed }}</text>
            <text class="stat-label">{{ t('profile.browsed') }}</text>
          </view>
        </view>
      </view>

      <!-- Illini verify prompt -->
      <view v-if="!currentUser?.is_illini_verified" class="verify-prompt" @click="onVerifyIllini">
        <view class="vp-icon">✓</view>
        <view class="vp-text">
          <text class="vp-title">{{ t('profile.verifyTitle') }}</text>
          <text class="vp-sub">{{ t('profile.verifySub') }}</text>
        </view>
        <view class="vp-arrow"></view>
      </view>

      <!-- Quick actions grid —
           tints picked from the 米白书院 pottery-glaze palette. All
           four sit within ~8% of paper so the circles read as
           "washed" instead of candy. -->
      <view class="section-block">
        <text class="block-title">{{ t('profile.quickActions') }}</text>
        <view class="action-grid">
          <view class="action-item" @click="goNotifications">
            <view class="action-icon action-icon--brand">
              <UIcon name="bell" color="brand" />
            </view>
            <text class="action-label">{{ t('notif.title') }}</text>
            <view v-if="unreadNotifCount > 0" class="action-badge">{{ unreadNotifCount }}</view>
          </view>
          <view class="action-item" @click="goHistory">
            <view class="action-icon action-icon--lavender">
              <UIcon name="history" color="campus-blue" />
            </view>
            <text class="action-label">{{ t('profile.history') }}</text>
          </view>
          <view class="action-item" @click="goFollowing">
            <view class="action-icon action-icon--sage">
              <UIcon name="heart" color="success" />
            </view>
            <text class="action-label">{{ t('nav.following') }}</text>
          </view>
          <view class="action-item" @click="goSavedSearches">
            <view class="action-icon action-icon--amber">
              <UIcon name="search" color="warning" />
            </view>
            <text class="action-label">{{ t('savedSearch.title') }}</text>
          </view>
        </view>
      </view>

      <!-- 我的发布 — 在售 / 已售 标签 (v5 kit; 草稿 deferred per decision) -->
      <view class="section-block">
        <view class="my-tabs">
          <view :class="['my-tab', { active: myTab === 'active' }]" role="tab" :aria-selected="myTab === 'active'" @click="myTab = 'active'">
            <text class="my-tab-label">{{ t('profile.tabActive') }}</text>
            <text v-if="listedItems.length > 0" class="my-tab-count">{{ listedItems.length }}</text>
          </view>
          <view :class="['my-tab', { active: myTab === 'sold' }]" role="tab" :aria-selected="myTab === 'sold'" @click="myTab = 'sold'">
            <text class="my-tab-label">{{ t('profile.tabSold') }}</text>
            <text v-if="soldItems.length > 0" class="my-tab-count">{{ soldItems.length }}</text>
          </view>
        </view>
        <view v-if="currentListings.length === 0" class="empty-mini">
          <UEmptyArt name="bag" :size="104" />
          <text class="empty-mini-text">{{ myTab === 'sold' ? t('profile.noSold') : t('profile.noListings') }}</text>
        </view>
        <scroll-view v-else scroll-x class="horz-scroll" :show-scrollbar="false">
          <view class="horz-row u-stagger" :key="myTab">
            <view
              v-for="item in currentListings"
              :key="item.id"
              :class="['horz-card', { sold: item.status === 'sold' }]"
              @click="goDetail(item.id)"
              @touchstart="cardLongPress.onTouchstart(item)"
              @touchend="cardLongPress.onTouchend"
              @touchcancel="cardLongPress.onTouchcancel"
              @touchmove="cardLongPress.onTouchmove"
            >
              <image
                v-if="thumbUrl(item.images?.[0], 'list')"
                :src="thumbUrl(item.images?.[0], 'list')"
                :alt="localize(item.title_i18n, item.title)"
                class="horz-img"
                mode="aspectFill"
                lazy-load
              />
              <view v-else class="horz-img u-thumb-ph u-thumb-ph--fill"><text class="u-thumb-ph-seal">集</text></view>
              <view class="horz-info">
                <text class="horz-title">{{ localize(item.title_i18n, item.title) }}</text>
                <view class="horz-price-row">
                  <text v-if="item.listing_type === 'wanted'" class="u-wanted-tag">{{ t('item.wanted') }}</text>
                  <text :class="['horz-price', { free: item.listing_type !== 'wanted' && (!item.price || item.price === 0) }]">{{ listingPriceLabel(item, t) }}</text>
                </view>
                <text v-if="item.status !== 'active'" :class="['horz-status', item.status]">
                  {{ t('status.' + item.status) }}
                </text>
              </view>
            </view>
          </view>
        </scroll-view>
      </view>

      <!-- 我收藏的 -->
      <view class="section-block">
        <view class="block-title-row">
          <text class="block-title">{{ t('profile.savedSection') }}</text>
          <text v-if="savedItems.length > 0" class="block-count">{{ savedItems.length }}</text>
        </view>
        <view v-if="savedItems.length === 0" class="empty-mini">
          <UEmptyArt name="favorites" :size="104" />
          <text class="empty-mini-text">{{ t('profile.noSaved') }}</text>
        </view>
        <view v-else class="fav-grid u-stagger">
          <view
            v-for="item in savedItems"
            :key="item.id"
            class="fav-card u-rise"
            @click="goDetail(item.id)"
          >
            <view class="fav-img-wrap">
              <image
                v-if="thumbUrl(item.images?.[0], 'list')"
                :src="thumbUrl(item.images?.[0], 'list')"
                :alt="localize(item.title_i18n, item.title)"
                class="fav-img"
                mode="aspectFit"
                :style="myImgStyleFor(item.id)"
                @load="onMyImgLoad(item.id, $event)"
                lazy-load
              />
              <view v-else class="fav-img u-thumb-ph u-thumb-ph--fill"><text class="u-thumb-ph-seal">集</text></view>
            </view>
            <view class="fav-body">
              <text class="fav-title">{{ localize(item.title_i18n, item.title) }}</text>
              <view class="fav-meta">
                <text v-if="item.listing_type === 'wanted'" class="u-wanted-tag">{{ t('item.wanted') }}</text>
                <text :class="['fav-price', { free: item.listing_type !== 'wanted' && (!item.price || item.price === 0) }]">{{ listingPriceLabel(item, t) }}</text>
                <text v-if="item.status === 'sold'" class="fav-status sold">{{ t('status.sold') }}</text>
                <text v-else-if="item.status === 'reserved'" class="fav-status reserved">{{ t('status.reserved') }}</text>
                <text v-else-if="item.profile" class="fav-seller">{{ item.profile.nickname }}</text>
              </view>
            </view>
          </view>
        </view>
      </view>

      <!-- 更多 -->
      <view class="section-block">
        <text class="block-title">{{ t('profile.moreSection') }}</text>
        <view class="list-menu">
          <view class="menu-row" @click="goSettings">
            <UIcon name="settings" size="sm" color="ink-soft" />
            <text class="menu-row-text">{{ t('settings.title') }}</text>
            <UIcon name="chevron-right" size="sm" color="text-faint" />
          </view>
        </view>
      </view>

      <view style="height: 80px;"></view>
    </view>

    <CustomTabBar current="profile" />
  </view>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { onShow, onPullDownRefresh, onShareAppMessage, onShareTimeline } from '@dcloudio/uni-app'
import { useAuth } from '../../composables/useAuth'
import { useI18n } from '../../composables/useI18n'
import { useTheme } from '../../composables/useTheme'
import AppSidebar from '../../components/AppSidebar.vue'
import CustomTabBar from '../../components/CustomTabBar.vue'
import UBadge from '../../components/UBadge.vue'
import UIcon from '../../components/UIcon.vue'
import UEmptyArt from '../../components/UEmptyArt.vue'
import { useItems } from '../../composables/useItems'
import { useFavorites } from '../../composables/useFavorites'
import { useNotifications } from '../../composables/useNotifications'
import { useLongPress } from '../../composables/useLongPress'
import type { Item } from '../../types'
import { listingPriceLabel, thumbUrl } from '../../utils'

const { t, localize } = useI18n()
const { isDark } = useTheme()
const defaultAvatarSrc = computed(() =>
  isDark.value ? '/static/default-avatar-dark.svg' : '/static/default-avatar.svg'
)
const { currentUser, isLoggedIn } = useAuth()
const { items: homeItems, fetchMyItems, updateItemStatus, deleteItem } = useItems()
const { loadMyFavorites, fetchMyFavoriteItems } = useFavorites()
const { unreadNotifCount, fetchNotifications } = useNotifications()

const myItems = ref<Item[]>([])
const savedItems = ref<Item[]>([])
const totalBrowsed = ref(0)

/*
 * Read the browse-history count from local storage. Source-of-truth for
 * what gets shown next to the "Browsed" stat on the profile.
 *
 * Pre-fix this read 'browse_history' — a key that was never written by
 * any code path. useHistory.ts has been writing to 'viewHistory' (items)
 * and 'postViewHistory' (plaza posts) since the composable was added,
 * so the count was permanently 0. Reading both keys mirrors what the
 * /pages/history/index page actually displays (items + posts in two
 * tabs), so a user who has viewed 3 items and 2 posts sees "5".
 *
 * Each storage value is a JSON-stringified array of objects (Item or
 * Post). uni storage on H5 returns the parsed object directly when
 * setStorageSync was given a non-string; on mp it returns the string.
 * Handle both shapes so we don't depend on platform quirks.
 */
function loadBrowsedCount() {
  let total = 0
  for (const key of ['viewHistory', 'postViewHistory']) {
    try {
      const raw = uni.getStorageSync(key)
      if (typeof raw === 'string' && raw) {
        const arr = JSON.parse(raw)
        if (Array.isArray(arr)) total += arr.length
      } else if (Array.isArray(raw)) {
        total += raw.length
      }
    } catch { /* corrupt key — skip */ }
  }
  totalBrowsed.value = total
}

/*
 * Per-item cover-image aspect map. Populated by @load on the <image>
 * elements; keyed by item.id so listed/saved/sold tabs share the same
 * cache (same item appears in multiple tabs). Without this, the 2-col
 * cards would need a hard aspect-ratio guess and the "plate turns into
 * oval" symptom comes right back. Once we have a DB-backed
 * image_dimensions column (see migration proposal) we can skip the
 * @load wait entirely.
 */
const itemImgAspect = ref<Record<string, number>>({})

function onMyImgLoad(id: string, ev: any) {
  const d = ev?.detail || {}
  const w = d.width || ev?.target?.naturalWidth || 0
  const h = d.height || ev?.target?.naturalHeight || 0
  if (w > 0 && h > 0) {
    itemImgAspect.value = { ...itemImgAspect.value, [id]: w / h }
  }
}

function myImgStyleFor(id: string): Record<string, string> {
  const r = itemImgAspect.value[id]
  if (!r) return {}
  const clamped = Math.max(0.6, Math.min(r, 1.6))
  return { 'aspect-ratio': String(clamped) }
}

const listedItems = computed(() => myItems.value.filter(i => i.status !== 'sold'))
const soldItems = computed(() => myItems.value.filter(i => i.status === 'sold'))

// 我的发布 — 在售 / 已售 sub-tabs (v5 kit). 草稿 (drafts) deferred per
// decision: there's no draft item status in the schema yet.
const myTab = ref<'active' | 'sold'>('active')
const currentListings = computed(() => (myTab.value === 'sold' ? soldItems.value : listedItems.value))

onShareAppMessage(() => {
  const u = currentUser.value
  if (!u) return { title: 'Illini Market · UIUC 校园二手交易', path: '/pages/index/index' }
  return {
    title: `${u.nickname || '我'} 的 Illini Market 主页`,
    path: `/pages/seller/index?id=${u.id}`,
    imageUrl: u.avatar_url || '',
  }
})

onShareTimeline(() => {
  const u = currentUser.value
  if (!u) return { title: 'Illini Market · UIUC 校园二手交易' }
  return {
    title: `${u.nickname || '我'} 的 Illini Market 主页`,
    query: `id=${u.id}`,
    imageUrl: u.avatar_url || '',
  }
})

async function loadMine() {
  if (!currentUser.value) return
  const uid = currentUser.value.id
  try {
    const [items, _favs, favItems] = await Promise.all([
      fetchMyItems(uid),
      loadMyFavorites(uid),
      fetchMyFavoriteItems(uid),
    ])
    myItems.value = items
    savedItems.value = favItems
    fetchNotifications().catch(() => {})
  } catch {
    uni.showToast({ title: t('profile.markFail'), icon: 'none' })
  }
}

onShow(async () => {
  loadBrowsedCount()
  await loadMine()
})

// Cold boot directly on this tab fires onShow before the session hydrates —
// currentUser is null, loadMine bails, and the listings/favorites stayed
// empty until the user left and re-entered the tab. Retry once auth lands.
watch(currentUser, (u, prev) => {
  if (u && !prev) loadMine()
})

/*
 * Long-press on a listing card opens an action sheet so users can still
 * edit / mark-sold / unreserve / delete without needing dedicated tap
 * targets on the card body (the new horizontal-scroll card is too small
 * to fit buttons inline).
 */
/* 3s threshold prevents accidental edit/markSold/delete from a
   thumb resting on a card while scrolling. Owner actions are
   destructive enough to warrant the longer hold. */
const cardLongPress = useLongPress<[Item]>((item) => onCardLongPress(item), 3000)

function onCardLongPress(item: Item) {
  const actions: Array<{ label: string; run: () => void | Promise<void> }> = []
  if (item.status === 'active') {
    actions.push({ label: t('profile.edit'), run: () => goEdit(item.id) })
    actions.push({ label: t('profile.markSold'), run: () => markAsSold(item.id) })
  } else if (item.status === 'reserved') {
    actions.push({ label: t('detail.unreserve'), run: () => unreserveItem(item.id) })
  }
  actions.push({ label: t('profile.delete'), run: () => onDeleteItem(item.id) })

  uni.showActionSheet({
    itemList: actions.map(a => a.label),
    success: (res) => {
      const picked = actions[res.tapIndex]
      if (picked) picked.run()
    },
  })
}

onPullDownRefresh(async () => {
  if (currentUser.value) {
    const uid = currentUser.value.id
    const [items, , favItems] = await Promise.all([
      // Explicit refresh bypasses the my-items SWR TTL guard.
      fetchMyItems(uid, { force: true }), loadMyFavorites(uid), fetchMyFavoriteItems(uid),
    ])
    myItems.value = items
    savedItems.value = favItems
  }
  uni.stopPullDownRefresh()
})

function formatJoinDate(dateStr: string): string {
  const d = new Date(dateStr)
  return `${d.getFullYear()}-${d.getMonth() + 1}`
}

function goLogin() {
  uni.navigateTo({ url: '/pages/login/index' })
}

function goDetail(id: string) {
  uni.navigateTo({ url: `/pages/detail/index?id=${id}` })
}

function goEdit(id: string) {
  uni.navigateTo({ url: `/pages/publish/edit?id=${id}` })
}

function onEditProfile() { uni.navigateTo({ url: '/pages/profile/edit' }) }

function onVerifyIllini() {
  uni.showModal({
    title: t('profile.verifyTitle'),
    content: t('profile.verifyHint'),
    confirmText: t('profile.verifyGotIt'),
    showCancel: false,
  })
}
function goNotifications() { uni.navigateTo({ url: '/pages/notifications/index' }) }
function goSettings() { uni.navigateTo({ url: '/pages/settings/index' }) }
function goHistory() { uni.navigateTo({ url: '/pages/history/index' }) }
function goFollowing() { uni.navigateTo({ url: '/pages/following/index' }) }
function goSavedSearches() { uni.navigateTo({ url: '/pages/saved-searches/index' }) }

function copyUid() {
  if (!currentUser.value?.uid) return
  uni.setClipboardData({
    data: currentUser.value.uid,
    success: () => uni.showToast({ title: t('profile.uidCopied'), icon: 'success' }),
  })
}

function markAsSold(id: string) {
  uni.showModal({
    title: t('profile.markSoldTitle'),
    content: t('profile.markSoldHint'),
    confirmText: t('profile.markSold'),
    success: async (res) => {
      if (!res.confirm) return
      try {
        await updateItemStatus(id, 'sold')
        homeItems.value = homeItems.value.filter(i => i.id !== id)
        if (currentUser.value) {
          myItems.value = await fetchMyItems(currentUser.value.id)
        }
        uni.showToast({ title: t('profile.markedSold'), icon: 'success' })
      } catch {
        uni.showToast({ title: t('profile.markFail'), icon: 'none' })
      }
    },
  })
}

async function unreserveItem(id: string) {
  try {
    await updateItemStatus(id, 'active')
    if (currentUser.value) {
      myItems.value = await fetchMyItems(currentUser.value.id)
    }
    uni.showToast({ title: t('detail.unreserved'), icon: 'success' })
  } catch {
    uni.showToast({ title: t('profile.markFail'), icon: 'none' })
  }
}

function onDeleteItem(id: string) {
  uni.showModal({
    title: t('profile.deleteTitle'),
    content: t('profile.deleteConfirm'),
    success: async (res) => {
      if (!res.confirm) return
      try {
        await deleteItem(id)
        if (currentUser.value) {
          myItems.value = await fetchMyItems(currentUser.value.id)
        }
        uni.showToast({ title: t('profile.deleted'), icon: 'success' })
      } catch {
        uni.showToast({ title: t('profile.markFail'), icon: 'none' })
      }
    },
  })
}
</script>

<style lang="scss" scoped>
.page {
  min-height: 100vh; background: var(--bg-subtle);
  max-width: 480px; margin: 0 auto; padding-bottom: calc(70px + env(safe-area-inset-bottom, 0px));
}

.page-header {
  padding: 11px 16px;
  padding-top: calc(11px + var(--status-bar-height, env(safe-area-inset-top, 0px)));
  /* fill + blur + bottom hairline come from .u-glass + .u-glass--hair-b */
  position: sticky; top: 0; z-index: 50;
}
.ph-title { font-size: 17px; font-weight: 700; color: var(--text-primary); }

/* P1 §1.6: soften page-title color in dark — pure cream-on-charcoal
 * (--text-primary → --ink #F0E8D6) hits ~14:1 contrast on the
 * deepened dark canvas, which reads as "shouting" for a header.
 * Drop to --ink-strong (0.92α) for a more comfortable ~12:1 while
 * staying well above AA. Scoped-style specificity beats the App.vue
 * global rule, so the override has to live per-page. Light unchanged. */
[data-theme="dark"] .ph-title { color: var(--ink-strong); }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .ph-title { color: var(--ink-strong); }
}
@media (min-width: 768px) {
  .page-header { display: none; }
  .page { padding-bottom: 0; max-width: none; margin: 0; }
  .logged-in-wrap,
  .login-section {
    max-width: 980px;
    margin-left: auto;
    margin-right: auto;
  }
}

.login-section {
  background: var(--bg-elev-1); display: flex; flex-direction: column;
  align-items: center; padding: 64px 16px; gap: 12px;
}

.avatar-placeholder {
  width: 72px; height: 72px; border-radius: 50%;
  background: var(--bg-subtle); position: relative;
}
.ap-head {
  position: absolute; top: 14px; left: 50%; transform: translateX(-50%);
  width: 18px; height: 18px; border-radius: 50%;
  border: 2.5px solid var(--text-faint);
}
.ap-body {
  position: absolute; bottom: 12px; left: 50%; transform: translateX(-50%);
  width: 30px; height: 14px; border-radius: 15px 15px 0 0;
  border: 2.5px solid var(--text-faint); border-bottom: none;
}

.login-hint { color: var(--text-faint); font-size: 14px; }
.login-btn {
  margin-top: 4px; padding: 10px 36px;
  background: var(--accent-primary); color: #fff; border-radius: 22px;
  font-size: 14px; font-weight: 600; cursor: pointer;
  &:active { opacity: 0.8; }
}

/*
 * Profile — campus-market redesign CSS.
 *
 * Page wrapper (.logged-in-wrap) becomes the vertical scroll container.
 * Sections (.section-block) stack one-per-concept with 12px gaps on a
 * cream page background. Each block is a white rounded card with the
 * shared shadow-soft token — matches the Xiaohongshu/campus-market feel.
 */
.logged-in-wrap {
  padding: 0 12px;
}

/* ===== User card (米白书院 passport pattern) =====
 *
 * Deep UIUC-navy panel pinned to --campus-blue-surface, a constant
 * that does NOT lift in dark mode (always #13294B). The plain
 * --campus-blue token DOES lift to a periwinkle (#6A8AC2) in dark
 * for verified-badge text legibility on soft surfaces — using it
 * here would make this large panel float visually on dark canvas,
 * breaking the "passport" read. --campus-blue-surface stays navy
 * in BOTH modes. Light: navy on cream, high contrast. Dark: navy
 * on near-black — still distinct because navy has cool hue vs the
 * warm dark canvas.
 *
 * Seal arc + avatar shadow use hardcoded Illini-orange alpha
 * (not var(--brand)) so they stay the same warm terracotta
 * tone in both themes — they're decorative, not brand-state.
 */
.user-card {
  position: relative;
  background: var(--campus-blue-surface);
  border-radius: var(--radius-xl);
  margin-top: 10px;
  padding: 22px 18px 0;
  box-shadow: var(--shadow-pop);
  overflow: hidden;
  color: var(--ink-inverse);
  /* decorative Illini-orange arc top-right — seal-like, low opacity */
  &::before {
    content: '';
    position: absolute;
    top: -40px; right: -40px;
    width: 140px; height: 140px;
    border-radius: 50%;
    background: radial-gradient(circle at 30% 30%, rgba(199, 74, 47, 0.45), rgba(199, 74, 47, 0) 65%);
    pointer-events: none;
  }
  /*
   * All direct children must stack above the terracotta arc ::before.
   * We use `view` instead of `*` because WXSS rejects the universal
   * selector + scope-attribute combo that Vue scoped CSS produces
   * (`*.data-v-xxxxx` fails to parse on WeChat lib 3.15.x). Every
   * direct child of .user-card in the template is a <view>, so this
   * covers the same set without the compat footgun.
   */
  & > view { position: relative; z-index: 1; }
}
.user-card-bg { display: none; }

/*
 * Dark-mode override for the passport panel (v3 P1, spec §1.2).
 *
 * The light treatment pins to --campus-blue-surface (constant #13294B)
 * for high contrast against the cream canvas — see the comment above
 * the .user-card rule for the full rationale. On the deepened dark
 * canvas (#15130F after P1.1) that constant navy reads muddy against
 * the warm-charcoal page background: the panel loses its "passport"
 * lift and visually merges with the canvas.
 *
 * --user-card-grad-dark (#1A2540 → #2C3E5C) is a desaturated navy pair
 * tuned for dark canvas. It keeps the cool-hue campus identity vs the
 * warm canvas, but the gradient transition restores the visual lift
 * the solid color loses. All inner card content (avatar, nickname,
 * stats-row, illini badge, edit-btn) stays pinned to ivory and reads
 * fine over either gradient stop.
 *
 * Light mode is unchanged.
 */
[data-theme="dark"] .user-card {
  background: var(--user-card-grad-dark);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .user-card {
    background: var(--user-card-grad-dark);
  }
}

.user-row { display: flex; align-items: center; gap: 14px; }
.avatar-big {
  width: 72px; height: 72px; border-radius: 50%;
  background: linear-gradient(135deg, var(--brand-soft) 0%, var(--brand) 100%);
  flex-shrink: 0;
  box-shadow: 0 6px 16px rgba(199, 74, 47, 0.35);
  border: 2px solid var(--ink-inverse);
}
.user-info { flex: 1; min-width: 0; }
.name-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
/*
 * Name + meta on the user card pin to ivory (#F5F0E6) since the
 * card background is pinned to navy. Using var(--canvas) here would
 * flip to dark in dark mode and disappear against the navy panel.
 */
.nickname {
  font-family: var(--font-serif);
  font-size: 22px;
  font-weight: 500;
  letter-spacing: -0.3px;
  color: var(--ink-inverse);
}
/* illini badge → components/UBadge.vue (variant illini). */
.user-meta-row {
  display: flex; align-items: center; gap: 8px; margin-top: 6px; flex-wrap: wrap;
}
.uid-row {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 2px 8px;
  background: rgba(245, 240, 230, 0.12);
  border-radius: var(--radius-pill);
  cursor: pointer;
  &:active { background: rgba(245, 240, 230, 0.2); }
}
.uid-label { font-size: 10px; color: rgba(245, 240, 230, 0.6); font-weight: 500; }
.uid-value {
  font-size: 11px; color: var(--ink-inverse); font-weight: 500; letter-spacing: 0.05em;
  font-family: var(--font-mono);
}
/* UIcon inherits the rgba cream via currentColor. */
.location { display: inline-flex; align-items: center; gap: 3px; color: rgba(245, 240, 230, 0.72); }
.location-text { font-size: 12px; color: rgba(245, 240, 230, 0.72); }
.user-status { display: inline-flex; align-items: center; gap: 4px; margin-top: 6px; }
.us-emoji { font-size: 14px; line-height: 1; }
.us-text { font-size: 13px; color: rgba(245, 240, 230, 0.82); line-height: 1.3; }
.user-bio { font-size: 13px; color: rgba(245, 240, 230, 0.78); margin-top: 4px; display: block; line-height: 1.4; }

.edit-btn {
  width: 36px; height: 36px; border-radius: 50%;
  background: rgba(245, 240, 230, 0.12);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; flex-shrink: 0;
  border: 0.5px solid rgba(245, 240, 230, 0.18);
  &:active { background: rgba(245, 240, 230, 0.22); }
}
.edit-icon {
  width: 14px; height: 14px; position: relative;
  &::before {
    content: ''; position: absolute; bottom: 0; left: 0;
    width: 14px; height: 2px; background: var(--ink-inverse); border-radius: 1px;
    opacity: 0.82;
  }
  &::after {
    content: ''; position: absolute; top: 0; right: 2px;
    width: 2px; height: 10px; background: var(--ink-inverse);
    border-radius: 1px; transform: rotate(-40deg);
    transform-origin: bottom center;
    opacity: 0.82;
  }
}

/* ===== 4-stat strip inside the user card =====
   Lives in the bottom edge of the navy panel; numbers render in
   serif so they feel like a "passport" data plate, not a UI counter.
   All inner text pins to ivory since the panel bg is pinned navy. */
.stats-row {
  display: flex; align-items: stretch;
  margin: 20px -18px 0;
  padding: 14px 18px 14px;
  border-top: 0.5px solid rgba(245, 240, 230, 0.12);
  background: rgba(31, 29, 27, 0.18);
}
.stat-item {
  flex: 1; text-align: center;
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active { opacity: 0.6; }
}
.stat-divider {
  width: 0.5px;
  background: rgba(245, 240, 230, 0.14);
  margin: 6px 0;
}
.stat-num {
  font-family: var(--font-serif);
  font-size: 22px;
  font-weight: 500;
  letter-spacing: -0.02em;
  color: var(--ink-inverse);
  display: block;
  line-height: 1;
  font-feature-settings: 'tnum';
}
.stat-label {
  font-size: 11px;
  color: rgba(245, 240, 230, 0.64);
  letter-spacing: 0.04em;
  display: block;
  line-height: 1;
}

/*
 * Illini verify prompt — this is the ONE place we let UIUC campus
 * blue through, because Illini verification IS an official
 * university affordance. Tokenized to --campus-blue so dark mode
 * can override it to a lighter navy if legibility demands.
 */
.verify-prompt {
  display: flex; align-items: center; gap: 12px;
  margin-top: 12px; padding: 12px 14px;
  background: var(--paper);
  border: 0.5px solid var(--border);
  border-left: 3px solid var(--campus-blue);
  border-radius: var(--radius-md);
  cursor: pointer;
  box-shadow: var(--shadow-soft);
  transition: background var(--dur-1, 120ms) var(--ease-std, ease);
  &:active { background: var(--paper-2); }
}
.vp-icon {
  width: 28px; height: 28px; border-radius: 50%;
  background: var(--campus-blue); color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-size: 14px; font-weight: 700; flex-shrink: 0;
}
.vp-text { flex: 1; min-width: 0; }
.vp-title { font-size: 13px; font-weight: 600; color: var(--campus-blue); display: block; }
.vp-sub { font-size: 11px; color: var(--ink-soft); margin-top: 2px; display: block; }
.vp-arrow {
  width: 6px; height: 6px; flex-shrink: 0;
  border-top: 1.5px solid var(--campus-blue);
  border-right: 1.5px solid var(--campus-blue);
  transform: rotate(45deg);
}

/* ===== Section blocks (shared wrapper for quick-actions / horz / fav / more) ===== */
.section-block {
  background: var(--paper);
  border: 0.5px solid var(--border);
  border-radius: var(--radius-lg);
  margin-top: 12px;
  padding: 16px 14px;
  box-shadow: var(--shadow-soft);
}
.block-title {
  font-family: var(--font-serif);
  font-size: 17px;
  font-weight: 500;
  letter-spacing: -0.2px;
  color: var(--ink);
  display: block;
  line-height: 1.2;
  &::before {
    content: '';
    display: inline-block;
    width: 3px; height: 14px;
    background: var(--brand);
    border-radius: 2px;
    margin-right: 8px;
    vertical-align: -1px;
  }
}
.block-title-row {
  display: flex; align-items: baseline; justify-content: space-between;
  margin-bottom: 12px;
}
.block-count { font-size: 12px; color: var(--text-muted); }

/* ===== 我的发布 在售/已售 sub-tabs (v5) ===== */
.my-tabs { display: flex; gap: 8px; margin-bottom: 12px; }
.my-tab {
  display: inline-flex; align-items: center; gap: 6px;
  height: 32px; padding: 0 14px;
  border-radius: var(--radius-pill);
  background: var(--surface-alt);
  cursor: pointer;
  transition: background var(--dur-1) var(--ease-std), transform var(--dur-1) var(--ease-std);
  &:active { transform: scale(0.96); }
}
.my-tab.active { background: var(--ink); }
.my-tab-label { font-size: 13px; font-weight: 500; color: var(--ink-quiet); line-height: 1; }
.my-tab.active .my-tab-label { color: var(--ink-inverse); font-weight: 600; }
.my-tab-count {
  font-family: var(--font-mono); font-size: 10px; font-weight: 600;
  min-width: 16px; height: 16px; padding: 0 4px; border-radius: 999px;
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--frame); color: var(--ink-quiet); line-height: 1;
}
.my-tab.active .my-tab-count { background: rgba(255, 255, 255, 0.22); color: var(--ink-inverse); }

/* ===== Quick actions grid (4-col colored icon buttons) ===== */
.action-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  margin-top: 12px;
}
.action-item {
  position: relative;
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  padding: 4px 0;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active { opacity: 0.6; }
}
.action-icon {
  width: 48px; height: 48px; border-radius: 14px;
  display: flex; align-items: center; justify-content: center;
  border: 0.5px solid rgba(31, 29, 27, 0.04);
}
/*
 * Pottery-glaze variants. Each tint stays within ~8% of paper so the
 * tiles read as washed ceramic rather than the old candy palette.
 * Brand/amber/sage/lavender give enough hue separation that users
 * can still pattern-match by color after 1-2 visits.
 */
.action-icon--brand    { background: var(--brand-soft); }
.action-icon--amber    { background: var(--warning-soft); }
.action-icon--sage     { background: var(--success-soft); }
.action-icon--lavender { background: var(--campus-blue-soft); }
/* QA6 r5: text-align center so the 2-line labels (Recently Viewed / Saved
   Searches) center each line under their icon instead of going flush-left
   (uni <text> defaults to text-align:start → looked misaligned vs the 1-line
   Notifications / Following). */
.action-label { font-size: 12px; color: var(--ink-soft); line-height: 1.2; text-align: center; }
.action-badge {
  position: absolute;
  top: -2px; right: calc(50% - 28px);
  min-width: 16px; height: 16px; padding: 0 4px;
  border-radius: 8px;
  background: var(--accent-danger);
  color: #fff; font-size: 10px; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
}

/* ===== Horizontal scroll card (我发布的 / 已售) ===== */
.horz-scroll { white-space: nowrap; margin: 0 -4px; }
.horz-row { display: inline-flex; gap: 10px; padding: 0 4px 4px; }
.horz-card {
  width: 130px; flex-shrink: 0;
  background: var(--bg-elev-1);
  border-radius: var(--radius-md);
  overflow: hidden;
  box-shadow: 0 1px 4px rgba(60,40,20,0.05);
  cursor: pointer;
  transition: transform 0.15s;
  &:active { transform: scale(0.97); }
  &.sold { opacity: 0.85; }
}
.horz-img {
  width: 130px; height: 130px;
  display: block;
  background: var(--bg-subtle);
}
.horz-info { padding: 8px 10px 10px; }
.horz-title {
  font-size: 12px; line-height: 1.45; letter-spacing: 0.02em;
  color: var(--text-primary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 32px;
}
/* Prices render in the 米白书院 serif ladder + terracotta — matches
   the design system's "price is the only confident number on the
   page" principle. Free items drop to sage (--success) so 免费 / Free
   reads as a positive-state affordance, not a price. */
/* QA6 r5: flex-wrap so a wanted card's [WANTED] badge + "Budget $12" serif
   price (together ~135px) wrap to two lines inside the 130px card instead of
   the price overflowing/colliding with the badge. Mirrors .fav-meta, which
   already wraps. */
.horz-price-row { display: flex; align-items: center; flex-wrap: wrap; gap: 5px; row-gap: 3px; margin-top: 4px; }
.horz-price {
  font-family: var(--font-serif);
  font-size: 17px; font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--brand);
  display: block;
  line-height: 1;
  font-feature-settings: 'tnum';
}
.horz-price.free { color: var(--success); }
.horz-status {
  font-size: 10px; padding: 1px 6px; border-radius: 4px;
  margin-top: 4px; align-self: flex-start;
  display: inline-block;
  &.reserved { color: var(--accent-warn); background: rgba(212, 146, 60, 0.10); }
  &.sold { color: var(--text-muted); background: var(--bg-subtle); }
}

/* ===== Favorites 2-col grid ===== */
.fav-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-top: 12px;
}
.fav-card {
  background: var(--bg-elev-1);
  border-radius: var(--radius-lg);
  overflow: hidden;
  box-shadow: 0 1px 4px rgba(60,40,20,0.05);
  cursor: pointer;
  transition: transform 0.15s;
  &:active { transform: scale(0.98); }
}
.fav-img-wrap {
  width: 100%;
  aspect-ratio: 4 / 5;
  background: var(--bg-subtle);
  overflow: hidden;
}
.fav-img {
  width: 100%; height: 100%;
  display: block;
  object-fit: contain;
  background: var(--bg-subtle);
}
.fav-body { padding: 8px 10px 10px; }
.fav-title {
  font-size: 12px; color: var(--text-primary); line-height: 1.45; letter-spacing: 0.02em;
  display: -webkit-box; -webkit-line-clamp: 2;
  -webkit-box-orient: vertical; overflow: hidden;
}
.fav-meta { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-top: 5px; flex-wrap: wrap; }
.fav-price {
  font-family: var(--font-serif);
  font-size: 17px; font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--brand);
  line-height: 1;
  font-feature-settings: 'tnum';
}
.fav-price.free { color: var(--success); }
.fav-seller { font-size: 10px; color: var(--text-faint); }
.fav-status {
  font-size: 10px; padding: 1px 6px; border-radius: 4px;
  &.reserved { color: var(--accent-warn); background: rgba(212, 146, 60, 0.10); }
  &.sold { color: var(--text-muted); background: var(--bg-subtle); }
}

/* ===== Empty-state mini ===== */
.empty-mini {
  display: flex; flex-direction: column; align-items: center;
  padding: 28px 16px; gap: 8px;
  text-align: center;
}
.empty-mini-text { font-size: 13px; color: var(--text-muted); }

/* ===== More menu (list) ===== */
.list-menu { margin-top: 12px; }
.menu-row {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 4px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active { opacity: 0.55; }
}
.menu-row-text { flex: 1; font-size: 14px; color: var(--text-primary); }
</style>
