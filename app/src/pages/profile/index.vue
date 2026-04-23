<template>
  <view class="page">
    <DesktopNav current="profile" />

    <!-- Mobile Header -->
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

    <view v-else class="profile-section">
      <view class="user-header">
        <image :src="currentUser?.avatar_url || '/static/default-avatar.svg'" class="avatar" mode="aspectFill" />
        <view class="user-info">
          <view class="name-row">
            <text class="nickname">{{ currentUser?.nickname }}</text>
            <view v-if="currentUser?.is_illini_verified" class="illini-badge">
              <text class="illini-badge-text">Illini</text>
            </view>
          </view>
          <view v-if="currentUser?.uid" class="uid-row" @click="copyUid">
            <text class="uid-label">{{ t('profile.uid') }}:</text>
            <text class="uid-value">{{ currentUser.uid }}</text>
            <view class="uid-copy"></view>
          </view>
          <text class="user-status" v-if="currentUser?.status_text || currentUser?.status_emoji">
            <text v-if="currentUser?.status_emoji" class="us-emoji">{{ currentUser.status_emoji }}</text>
            <text v-if="currentUser?.status_text" class="us-text">{{ currentUser.status_text }}</text>
          </text>
          <text class="user-bio" v-if="currentUser?.bio">{{ currentUser.bio }}</text>
          <view class="location-row">
            <view class="loc-dot"></view>
            <text class="location">{{ currentUser?.location || 'UIUC' }}</text>
          </view>
          <text class="join-date" v-if="currentUser?.created_at">{{ t('profile.joined') }} {{ formatJoinDate(currentUser.created_at) }}</text>
        </view>
        <view class="edit-btn" @click="onEditProfile">
          <view class="edit-icon"></view>
        </view>
      </view>

      <view v-if="!currentUser?.is_illini_verified" class="verify-prompt" @click="onVerifyIllini">
        <view class="vp-icon">✓</view>
        <view class="vp-text">
          <text class="vp-title">{{ t('profile.verifyTitle') }}</text>
          <text class="vp-sub">{{ t('profile.verifySub') }}</text>
        </view>
        <view class="vp-arrow"></view>
      </view>

      <!-- Tappable stats / tabs -->
      <view class="stats-row">
        <view :class="['stat-item', { active: currentTab === 'listed' }]" @click="currentTab = 'listed'">
          <text class="stat-num">{{ listedItems.length }}</text>
          <text class="stat-label">{{ t('profile.listed') }}</text>
        </view>
        <view :class="['stat-item', { active: currentTab === 'saved' }]" @click="currentTab = 'saved'">
          <text class="stat-num">{{ savedItems.length }}</text>
          <text class="stat-label">{{ t('profile.saved') }}</text>
        </view>
        <view :class="['stat-item', { active: currentTab === 'sold' }]" @click="currentTab = 'sold'">
          <text class="stat-num">{{ soldItems.length }}</text>
          <text class="stat-label">{{ t('profile.sold') }}</text>
        </view>
      </view>
    </view>

    <!-- Content list based on active tab -->
    <view v-if="isLoggedIn" class="section">
      <!--
        Listed / Saved / Sold all render through the same 2-column grid
        below. The previous horizontal-row layout (72×72 thumb + flex row)
        was cramped and didn't show enough of the photo — the whole point
        of the profile is to browse your own listings visually. We now
        mirror the following-page grid: width = 50%, image height tracks
        each photo's natural aspect ratio (captured via @load), so a plate
        stays a plate. Actions (edit/markSold/delete) move into the card
        body so taps still work from within the tile.
      -->
      <view v-if="currentTab === 'listed'">
        <view v-if="listedItems.length === 0" class="empty-items">
          <view class="empty-bag"></view>
          <text class="empty-text">{{ t('profile.noListings') }}</text>
        </view>
        <view v-else class="my-items">
          <view v-for="item in listedItems" :key="item.id" class="my-card" @click="goDetail(item.id)">
            <view class="mc-img-wrap">
              <image
                :src="thumbUrl(item.images?.[0], 'list') || '/static/placeholder.svg'"
                :alt="item.title"
                class="mc-img"
                mode="aspectFit"
                :style="myImgStyleFor(item.id)"
                @load="onMyImgLoad(item.id, $event)"
                lazy-load
              />
            </view>
            <view class="mc-body">
              <text class="mc-title">{{ localize(item.title_i18n, item.title) }}</text>
              <view class="mc-meta">
                <text class="mc-price">{{ formatPrice(item.price, t("home.free")) }}</text>
                <text :class="['mc-status', item.status]">{{ t('status.' + item.status) }}</text>
              </view>
              <view class="mc-actions">
                <view v-if="item.status === 'active'" class="mc-act" @click.stop="goEdit(item.id)">
                  <text>{{ t('profile.edit') }}</text>
                </view>
                <view v-if="item.status === 'active'" class="mc-act" @click.stop="markAsSold(item.id)">
                  <text>{{ t('profile.markSold') }}</text>
                </view>
                <view v-if="item.status === 'reserved'" class="mc-act" @click.stop="unreserveItem(item.id)">
                  <text>{{ t('detail.unreserve') }}</text>
                </view>
                <view class="mc-act danger" @click.stop="onDeleteItem(item.id)">
                  <text>{{ t('profile.delete') }}</text>
                </view>
              </view>
            </view>
          </view>
        </view>
      </view>

      <view v-if="currentTab === 'saved'">
        <view v-if="savedItems.length === 0" class="empty-items">
          <image src="/static/heart.svg" class="empty-heart-img" />
          <text class="empty-text">{{ t('profile.noSaved') }}</text>
        </view>
        <view v-else class="my-items">
          <view v-for="item in savedItems" :key="item.id" class="my-card" @click="goDetail(item.id)">
            <view class="mc-img-wrap">
              <image
                :src="thumbUrl(item.images?.[0], 'list') || '/static/placeholder.svg'"
                :alt="item.title"
                class="mc-img"
                mode="aspectFit"
                :style="myImgStyleFor(item.id)"
                @load="onMyImgLoad(item.id, $event)"
                lazy-load
              />
            </view>
            <view class="mc-body">
              <text class="mc-title">{{ localize(item.title_i18n, item.title) }}</text>
              <view class="mc-meta">
                <text class="mc-price">{{ formatPrice(item.price, t("home.free")) }}</text>
                <text v-if="item.status === 'sold'" class="mc-status sold">{{ t('status.sold') }}</text>
                <text v-else-if="item.status === 'reserved'" class="mc-status reserved">{{ t('status.reserved') }}</text>
                <text v-else-if="item.profile" class="mc-seller">{{ item.profile.nickname }}</text>
              </view>
            </view>
          </view>
        </view>
      </view>

      <view v-if="currentTab === 'sold'">
        <view v-if="soldItems.length === 0" class="empty-items">
          <view class="empty-check"></view>
          <text class="empty-text">{{ t('profile.noSold') }}</text>
        </view>
        <view v-else class="my-items">
          <view v-for="item in soldItems" :key="item.id" class="my-card" @click="goDetail(item.id)">
            <view class="mc-img-wrap">
              <image
                :src="thumbUrl(item.images?.[0], 'list') || '/static/placeholder.svg'"
                :alt="item.title"
                class="mc-img"
                mode="aspectFit"
                :style="myImgStyleFor(item.id)"
                @load="onMyImgLoad(item.id, $event)"
                lazy-load
              />
            </view>
            <view class="mc-body">
              <text class="mc-title">{{ localize(item.title_i18n, item.title) }}</text>
              <view class="mc-meta">
                <text class="mc-price">{{ formatPrice(item.price, t("home.free")) }}</text>
                <text class="mc-status sold">{{ t('status.sold') }}</text>
              </view>
            </view>
          </view>
        </view>
      </view>
    </view>

    <view v-if="isLoggedIn" class="menu-section">
      <view class="menu-item" @click="goNotifications">
        <text class="menu-text">{{ t('notif.title') }}</text>
        <view v-if="unreadNotifCount > 0" class="menu-badge">{{ unreadNotifCount }}</view>
        <view class="menu-arrow"></view>
      </view>
      <view class="menu-item" @click="goHistory">
        <text class="menu-text">{{ t('profile.history') }}</text>
        <view class="menu-arrow"></view>
      </view>
      <view class="menu-item" @click="goFollowing">
        <text class="menu-text">{{ t('nav.following') }}</text>
        <view class="menu-arrow"></view>
      </view>
      <view class="menu-item" @click="goSavedSearches">
        <text class="menu-text">{{ t('savedSearch.title') }}</text>
        <view class="menu-arrow"></view>
      </view>
      <view class="menu-item" @click="goSettings">
        <text class="menu-text">{{ t('settings.title') }}</text>
        <view class="menu-arrow"></view>
      </view>
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

const currentTab = ref<'listed' | 'saved' | 'sold'>('listed')
const myItems = ref<Item[]>([])
const savedItems = ref<Item[]>([])

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
  background: rgba(255,255,255,0.92);
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
 * Profile user-card.
 *
 * The new campus-market look pairs a subtle coral-to-white gradient
 * wash behind the avatar area with a pure-white card below so the
 * stats row reads cleanly. We layer the gradient via a pseudo-element
 * so it stays behind all content without disrupting taps.
 */
.profile-section {
  position: relative;
  background: var(--bg-elev-1);
  padding: 28px 16px 0;
  overflow: hidden;
  &::before {
    content: '';
    position: absolute;
    inset: 0 0 auto 0;
    height: 140px;
    background: linear-gradient(180deg, rgba(255,90,76,0.08) 0%, rgba(255,255,255,0) 100%);
    pointer-events: none;
    z-index: 0;
  }
  & > * { position: relative; z-index: 1; }
}
.user-header { display: flex; align-items: center; gap: 14px; }
.avatar {
  width: 64px; height: 64px; border-radius: 50%;
  background: linear-gradient(135deg, #FFB5AD 0%, #FF7A6E 100%);
  flex-shrink: 0;
  box-shadow: 0 4px 12px rgba(255, 90, 76, 0.18);
}
.user-info { flex: 1; }
.name-row { display: flex; align-items: center; gap: 8px; }
.nickname { font-size: 19px; font-weight: 700; color: var(--text-primary); }
.illini-badge {
  display: inline-flex; align-items: center;
  background: #13294B; color: #fff;
  padding: 2px 7px; border-radius: 4px;
  font-size: 10px; font-weight: 700;
}
.illini-badge-text { color: #fff; font-size: 10px; }
.user-bio { font-size: 13px; color: var(--text-secondary); margin-top: 2px; }
.user-status { display: inline-flex; align-items: center; gap: 4px; margin-top: 4px; }
.us-emoji { font-size: 14px; line-height: 1; }
.us-text { font-size: 13px; color: #1a7aff; line-height: 1.3; }

.uid-row {
  display: inline-flex; align-items: center; gap: 4px;
  margin-top: 3px; padding: 2px 7px;
  background: var(--bg-subtle); border-radius: 4px; cursor: pointer;
  &:active { background: var(--bg-inset); }
}
.uid-label { font-size: 10px; color: var(--text-muted); font-weight: 500; }
.uid-value { font-size: 11px; color: var(--text-primary); font-weight: 600; letter-spacing: 0.02em; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.uid-copy {
  width: 10px; height: 10px; border: 1.2px solid var(--text-muted); border-radius: 2px;
  position: relative; margin-left: 2px;
  &::before {
    content: ''; position: absolute; top: -3px; left: -3px;
    width: 8px; height: 8px; background: var(--bg-elev-1);
    border: 1.2px solid var(--text-muted); border-radius: 2px;
  }
}

.verify-prompt {
  display: flex; align-items: center; gap: 12px;
  margin: 12px 16px 0; padding: 12px 14px;
  background: #EFF4FB; border-radius: 10px;
  cursor: pointer;
  &:active { background: #E5ECF6; }
}
.vp-icon {
  width: 28px; height: 28px; border-radius: 50%;
  background: #13294B; color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-size: 14px; font-weight: 700; flex-shrink: 0;
}
.vp-text { flex: 1; min-width: 0; }
.vp-title { font-size: 13px; font-weight: 600; color: #13294B; display: block; }
.vp-sub { font-size: 11px; color: #4a5a75; margin-top: 2px; display: block; }
.vp-arrow {
  width: 6px; height: 6px; flex-shrink: 0;
  border-top: 1.5px solid #13294B; border-right: 1.5px solid #13294B;
  transform: rotate(45deg);
}
.location-row {
  display: flex; align-items: center; gap: 5px; margin-top: 4px;
}
.loc-dot {
  width: 5px; height: 5px; border-radius: 50%;
  background: var(--accent-action); flex-shrink: 0;
}
.location { font-size: 13px; color: var(--text-faint); }
.join-date { font-size: 11px; color: var(--text-faint); margin-top: 2px; }

.edit-btn {
  width: 36px; height: 36px; border-radius: 50%;
  background: var(--bg-subtle);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; flex-shrink: 0;
  &:active { background: var(--bg-inset); }
}
.edit-icon {
  width: 14px; height: 14px; position: relative;
  &::before {
    content: ''; position: absolute; bottom: 0; left: 0;
    width: 14px; height: 2px; background: var(--text-secondary); border-radius: 1px;
  }
  &::after {
    content: ''; position: absolute; top: 0; right: 2px;
    width: 2px; height: 10px; background: var(--text-secondary);
    border-radius: 1px; transform: rotate(-40deg);
    transform-origin: bottom center;
  }
}

/*
 * Profile stats row.
 *
 * 3-tab switcher (发布 / 收藏 / 已售) with the active tab indicated by
 * a coral-red bar underneath + brighter label. The hairline on top is
 * gone in favor of a dividing gap (bg-subtle below), which reads better
 * on the new warm background.
 */
.stats-row {
  display: flex; margin-top: 22px;
  padding-top: 10px;
}
.stat-item {
  flex: 1; text-align: center; padding: 14px 0 14px;
  cursor: pointer; position: relative;
  -webkit-tap-highlight-color: transparent;
  transition: background 0.1s;
  &:active { background: var(--bg-elev-2); }
  &.active::after {
    content: ''; position: absolute; bottom: 0; left: 50%;
    transform: translateX(-50%);
    width: 24px; height: 3px;
    background: var(--accent-primary);
    border-radius: 2px;
  }
}
.stat-num { font-size: 22px; font-weight: 700; color: var(--text-primary); display: block; }
.stat-label { font-size: 12px; color: var(--text-muted); margin-top: 3px; display: block; }
.stat-item.active .stat-num { color: var(--accent-primary); }
.stat-item.active .stat-label { color: var(--text-primary); font-weight: 600; }

/* ========== Content Section ========== */
.section { background: var(--bg-elev-1); margin-top: 7px; min-height: 200px; }

.empty-items {
  display: flex; flex-direction: column; align-items: center;
  padding: 48px 16px; gap: 10px;
}
.empty-bag {
  width: 36px; height: 40px; border: 2px solid #d1d1d6;
  border-radius: 4px 4px 6px 6px; position: relative; margin-bottom: 4px;
  &::before {
    content: ''; position: absolute; top: -9px; left: 50%;
    transform: translateX(-50%);
    width: 20px; height: 12px;
    border: 2px solid #d1d1d6; border-bottom: none;
    border-radius: 10px 10px 0 0;
  }
  &::after {
    content: ''; position: absolute; top: 4px; left: 50%;
    transform: translateX(-50%);
    width: 14px; height: 2px; background: #d1d1d6; border-radius: 1px;
  }
}
.empty-heart-img { width: 36px; height: 36px; opacity: 0.5; }
.empty-check {
  width: 24px; height: 24px; border: 2px solid #d1d1d6;
  border-radius: 50%; position: relative;
  &::after {
    content: ''; position: absolute; top: 5px; left: 4px;
    width: 12px; height: 7px;
    border-left: 2px solid #d1d1d6; border-bottom: 2px solid #d1d1d6;
    transform: rotate(-45deg);
  }
}
.empty-text { font-size: 14px; color: var(--text-faint); }

/*
 * 2-column grid matching the Following-feed layout. Half page width per
 * card (gap is 8px). The image wrapper defines a fallback 4/5 aspect for
 * the pre-load placeholder so the grid doesn't collapse before photos
 * arrive; once @load fires we override it inline. object-fit: contain
 * keeps the full photo visible — circles stay circles, no side-crop.
 */
.my-items {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  padding: 8px;
}
.my-card {
  background: var(--bg-elev-1);
  border-radius: var(--radius-xl);
  overflow: hidden;
  cursor: pointer;
  box-shadow: var(--shadow-soft);
  transition: transform 0.15s;
  &:active { transform: scale(0.98); opacity: 0.92; }
}
.mc-img-wrap {
  position: relative;
  width: 100%;
  aspect-ratio: 4 / 5;
  background: var(--bg-subtle);
  overflow: hidden;
}
.mc-img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: contain;
  background: var(--bg-subtle);
}
.mc-body {
  padding: 8px 10px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.mc-title {
  font-size: 13px; color: var(--text-primary); line-height: 1.3;
  display: -webkit-box; -webkit-line-clamp: 2;
  -webkit-box-orient: vertical; overflow: hidden;
}
.mc-meta {
  display: flex; align-items: center; justify-content: space-between;
  gap: 6px; margin-top: 2px; flex-wrap: wrap;
}
.mc-price { font-size: 15px; font-weight: 700; color: var(--accent-primary); }
.mc-seller { font-size: 11px; color: var(--text-faint); }
.mc-status {
  font-size: 10px; padding: 1px 6px; border-radius: 4px; align-self: center;
  &.active { color: var(--accent-good); background: rgba(52,199,89,0.1); }
  &.reserved { color: var(--accent-warn); background: rgba(255,149,0,0.1); }
  &.sold { color: var(--text-muted); background: var(--bg-subtle); }
}
.mc-actions {
  display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px;
}
.mc-act {
  padding: 3px 8px; border-radius: 5px;
  background: var(--bg-subtle); cursor: pointer;
  text { font-size: 10px; color: var(--text-secondary); font-weight: 500; }
  &:active { background: var(--bg-inset); }
  &.danger text { color: var(--accent-danger); }
}

.menu-section { margin-top: 7px; background: var(--bg-elev-1); }
.menu-item { padding: 15px 16px; display: flex; align-items: center; cursor: pointer; &:active { background: var(--bg-elev-2); } }
.menu-text { font-size: 15px; color: var(--text-primary); flex: 1; }
.menu-badge {
  min-width: 18px; height: 18px; border-radius: 9px;
  background: var(--accent-danger); color: #fff; font-size: 10px; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
  padding: 0 5px; margin-right: 8px;
}
.menu-arrow {
  width: 7px; height: 7px; border-top: 1.5px solid var(--text-faint);
  border-right: 1.5px solid var(--text-faint); transform: rotate(45deg);
}
</style>
