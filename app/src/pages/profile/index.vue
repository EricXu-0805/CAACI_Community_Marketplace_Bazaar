<template>
  <view class="page">
    <DesktopNav current="profile" />

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
    <view class="page-header">
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
          <image :src="currentUser?.avatar_url || '/static/default-avatar.svg'" class="avatar-big" mode="aspectFill" />
          <view class="user-info">
            <view class="name-row">
              <text class="nickname">{{ currentUser?.nickname }}</text>
              <view v-if="currentUser?.is_illini_verified" class="illini-badge">
                <text class="illini-badge-text">Illini</text>
              </view>
            </view>
            <view class="user-meta-row">
              <view v-if="currentUser?.uid" class="uid-row" @click.stop="copyUid">
                <text class="uid-label">{{ t('profile.uid') }}</text>
                <text class="uid-value">{{ currentUser.uid }}</text>
              </view>
              <text class="location">📍 {{ currentUser?.location || 'UIUC' }}</text>
            </view>
            <text class="user-status" v-if="currentUser?.status_text || currentUser?.status_emoji">
              <text v-if="currentUser?.status_emoji" class="us-emoji">{{ currentUser.status_emoji }}</text>
              <text v-if="currentUser?.status_text" class="us-text">{{ currentUser.status_text }}</text>
            </text>
            <text class="user-bio" v-if="currentUser?.bio">{{ currentUser.bio }}</text>
          </view>
          <view class="edit-btn" @click="onEditProfile">
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
              <text class="action-emoji">🔔</text>
            </view>
            <text class="action-label">{{ t('notif.title') }}</text>
            <view v-if="unreadNotifCount > 0" class="action-badge">{{ unreadNotifCount }}</view>
          </view>
          <view class="action-item" @click="goHistory">
            <view class="action-icon action-icon--lavender">
              <text class="action-emoji">👣</text>
            </view>
            <text class="action-label">{{ t('profile.history') }}</text>
          </view>
          <view class="action-item" @click="goFollowing">
            <view class="action-icon action-icon--sage">
              <text class="action-emoji">❤️</text>
            </view>
            <text class="action-label">{{ t('nav.following') }}</text>
          </view>
          <view class="action-item" @click="goSavedSearches">
            <view class="action-icon action-icon--amber">
              <text class="action-emoji">🔍</text>
            </view>
            <text class="action-label">{{ t('savedSearch.title') }}</text>
          </view>
        </view>
      </view>

      <!-- 我发布的 (active + reserved) -->
      <view class="section-block">
        <view class="block-title-row">
          <text class="block-title">{{ t('profile.myListings') }}</text>
          <text v-if="listedItems.length > 0" class="block-count">{{ listedItems.length }}</text>
        </view>
        <view v-if="listedItems.length === 0" class="empty-mini">
          <text class="empty-mini-emoji">🧺</text>
          <text class="empty-mini-text">{{ t('profile.noListings') }}</text>
        </view>
        <scroll-view v-else scroll-x class="horz-scroll" :show-scrollbar="false">
          <view class="horz-row">
            <view
              v-for="item in listedItems"
              :key="item.id"
              class="horz-card"
              @click="goDetail(item.id)"
              @longpress="onCardLongPress(item)"
            >
              <image
                :src="thumbUrl(item.images?.[0], 'list') || '/static/placeholder.svg'"
                class="horz-img"
                mode="aspectFill"
                lazy-load
              />
              <view class="horz-info">
                <text class="horz-title">{{ localize(item.title_i18n, item.title) }}</text>
                <text :class="['horz-price', { free: !item.price || item.price === 0 }]">{{ formatPrice(item.price, t('home.free')) }}</text>
                <text v-if="item.status !== 'active'" :class="['horz-status', item.status]">
                  {{ t('status.' + item.status) }}
                </text>
              </view>
            </view>
          </view>
        </scroll-view>
      </view>

      <!-- 已售出 -->
      <view v-if="soldItems.length > 0" class="section-block">
        <view class="block-title-row">
          <text class="block-title">{{ t('profile.soldSection') }}</text>
          <text class="block-count">{{ soldItems.length }}</text>
        </view>
        <scroll-view scroll-x class="horz-scroll" :show-scrollbar="false">
          <view class="horz-row">
            <view
              v-for="item in soldItems"
              :key="item.id"
              class="horz-card sold"
              @click="goDetail(item.id)"
            >
              <image
                :src="thumbUrl(item.images?.[0], 'list') || '/static/placeholder.svg'"
                class="horz-img"
                mode="aspectFill"
                lazy-load
              />
              <view class="horz-info">
                <text class="horz-title">{{ localize(item.title_i18n, item.title) }}</text>
                <text :class="['horz-price', { free: !item.price || item.price === 0 }]">{{ formatPrice(item.price, t('home.free')) }}</text>
                <text class="horz-status sold">{{ t('status.sold') }}</text>
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
          <text class="empty-mini-emoji">💭</text>
          <text class="empty-mini-text">{{ t('profile.noSaved') }}</text>
        </view>
        <view v-else class="fav-grid">
          <view
            v-for="item in savedItems"
            :key="item.id"
            class="fav-card"
            @click="goDetail(item.id)"
          >
            <view class="fav-img-wrap">
              <image
                :src="thumbUrl(item.images?.[0], 'list') || '/static/placeholder.svg'"
                class="fav-img"
                mode="aspectFit"
                :style="myImgStyleFor(item.id)"
                @load="onMyImgLoad(item.id, $event)"
                lazy-load
              />
            </view>
            <view class="fav-body">
              <text class="fav-title">{{ localize(item.title_i18n, item.title) }}</text>
              <view class="fav-meta">
                <text :class="['fav-price', { free: !item.price || item.price === 0 }]">{{ formatPrice(item.price, t('home.free')) }}</text>
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
            <text class="menu-row-icon">⚙️</text>
            <text class="menu-row-text">{{ t('settings.title') }}</text>
            <text class="menu-row-arrow">›</text>
          </view>
        </view>
      </view>

      <view style="height: 80px;"></view>
    </view>

    <CustomTabBar current="profile" />
  </view>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { onShow, onPullDownRefresh } from '@dcloudio/uni-app'
import { useAuth } from '../../composables/useAuth'
import { useI18n } from '../../composables/useI18n'
import DesktopNav from '../../components/DesktopNav.vue'
import CustomTabBar from '../../components/CustomTabBar.vue'
import { useItems } from '../../composables/useItems'
import { useFavorites } from '../../composables/useFavorites'
import { useNotifications } from '../../composables/useNotifications'
import type { Item } from '../../types'
import { formatPrice, thumbUrl } from '../../utils'

const { t, localize } = useI18n()
const { currentUser, isLoggedIn } = useAuth()
const { items: homeItems, fetchMyItems, updateItemStatus, deleteItem } = useItems()
const { loadMyFavorites, fetchMyFavoriteItems } = useFavorites()
const { unreadNotifCount, fetchNotifications } = useNotifications()

const myItems = ref<Item[]>([])
const savedItems = ref<Item[]>([])
const totalBrowsed = ref(0)

function loadBrowsedCount() {
  try {
    const raw = uni.getStorageSync('browse_history')
    if (typeof raw === 'string' && raw) {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr)) totalBrowsed.value = arr.length
    } else if (Array.isArray(raw)) {
      totalBrowsed.value = raw.length
    }
  } catch {}
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

onShow(async () => {
  loadBrowsedCount()
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
    fetchNotifications()
  } catch {
    uni.showToast({ title: t('profile.markFail'), icon: 'none' })
  }
})

/*
 * Long-press on a listing card opens an action sheet so users can still
 * edit / mark-sold / unreserve / delete without needing dedicated tap
 * targets on the card body (the new horizontal-scroll card is too small
 * to fit buttons inline).
 */
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
      fetchMyItems(uid), loadMyFavorites(uid), fetchMyFavoriteItems(uid),
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
  uni.navigateTo({ url: `/pages/publish/index?edit=${id}` })
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
  max-width: 480px; margin: 0 auto; padding-bottom: 76px;
}

.page-header {
  padding: 11px 16px;
  padding-top: calc(11px + env(safe-area-inset-top, 0px));
  background: rgba(var(--surface-rgb), 0.92);
  backdrop-filter: saturate(180%) blur(20px);
  -webkit-backdrop-filter: saturate(180%) blur(20px);
  position: sticky; top: 0; z-index: 50;
}
.ph-title { font-size: 17px; font-weight: 700; color: var(--text-primary); }
@media (min-width: 768px) {
  .page-header { display: none; }
  .page { padding-bottom: 0; }
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
 * Deep UIUC-navy panel (pinned to --campus-blue, NOT to --ink)
 * so it stays navy in BOTH light and dark mode instead of
 * flipping ink→cream and becoming unreadable. Ivory text on
 * navy is the stable "passport" read. Light mode: navy on
 * cream, high contrast. Dark mode: navy on near-black — still
 * distinct because navy has cool hue vs the warm dark canvas.
 *
 * Seal arc + avatar shadow use hardcoded Illini-orange alpha
 * (not var(--brand)) so they stay the same warm terracotta
 * tone in both themes — they're decorative, not brand-state.
 */
.user-card {
  position: relative;
  background: var(--campus-blue);
  border-radius: var(--radius-xl);
  margin-top: 10px;
  padding: 22px 18px 0;
  box-shadow: var(--shadow-pop);
  overflow: hidden;
  color: #F5F0E6;
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
  & > * { position: relative; z-index: 1; }
}
.user-card-bg { display: none; }
.user-row { display: flex; align-items: center; gap: 14px; }
.avatar-big {
  width: 72px; height: 72px; border-radius: 50%;
  background: linear-gradient(135deg, #F5D9CE 0%, #C74A2F 100%);
  flex-shrink: 0;
  box-shadow: 0 6px 16px rgba(199, 74, 47, 0.35);
  border: 2px solid #F5F0E6;
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
  color: #F5F0E6;
}
.illini-badge {
  display: inline-flex; align-items: center;
  background: var(--success); color: #fff;
  padding: 2px 7px; border-radius: var(--radius-xs);
  font-size: 10px; font-weight: 600;
  letter-spacing: 0.08em;
}
.illini-badge-text { color: #fff; font-size: 10px; }
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
  font-size: 11px; color: #F5F0E6; font-weight: 500; letter-spacing: 0.05em;
  font-family: var(--font-mono);
}
.location { font-size: 12px; color: rgba(245, 240, 230, 0.72); }
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
    width: 14px; height: 2px; background: #F5F0E6; border-radius: 1px;
    opacity: 0.82;
  }
  &::after {
    content: ''; position: absolute; top: 0; right: 2px;
    width: 2px; height: 10px; background: #F5F0E6;
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
  background: rgba(0, 0, 0, 0.18);
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
  color: #F5F0E6;
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
.action-icon--lavender { background: #E4E1F2; }
.action-emoji { font-size: 22px; line-height: 1; }
.action-label { font-size: 12px; color: var(--ink-soft); line-height: 1.2; }
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
.horz-price {
  font-family: var(--font-serif);
  font-size: 17px; font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--brand);
  margin-top: 4px;
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
  border-radius: var(--radius-md);
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
.empty-mini-emoji { font-size: 36px; line-height: 1; opacity: 0.7; }
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
.menu-row-icon { font-size: 18px; flex-shrink: 0; }
.menu-row-text { flex: 1; font-size: 14px; color: var(--text-primary); }
.menu-row-arrow {
  font-size: 20px; color: var(--text-faint); line-height: 1;
}
</style>
