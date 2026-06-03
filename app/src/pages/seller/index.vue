<template>
  <view class="page">
    <view class="header">
      <view class="back-btn" role="button" :aria-label="t('a11y.back')" @click="goBack"><view class="back-arrow"></view></view>
      <text class="header-title">{{ seller?.nickname || t('app.user') }}</text>
    </view>

    <view v-if="blocked" class="blocked-state">
      <view class="blocked-icon"></view>
      <text class="blocked-title">{{ t('seller.blockedTitle') }}</text>
      <text class="blocked-sub">{{ t('seller.blockedSub') }}</text>
    </view>

    <view v-else-if="seller" class="seller-section">
      <image :src="seller.avatar_url || defaultAvatarSrc" class="avatar" mode="aspectFill" />
      <view class="name-row">
        <text class="nickname">{{ seller.nickname }}</text>
        <view v-if="seller.is_illini_verified" class="illini-badge">
          <text class="illini-badge-text">Illini</text>
        </view>
      </view>
      <text v-if="seller.status_text || seller.status_emoji" class="user-status">
        <text v-if="seller.status_emoji" class="us-emoji">{{ seller.status_emoji }}</text>
        <text v-if="seller.status_text" class="us-text">{{ seller.status_text }}</text>
      </text>
      <text v-if="seller.bio" class="bio">{{ seller.bio }}</text>
      <view class="loc-row">
        <view class="loc-dot"></view>
        <text class="loc-text">{{ seller.location || 'UIUC' }}</text>
      </view>

      <view
        v-if="!isOwnProfile"
        :class="['follow-btn', { following: isFollowing(seller.id) }]"
        @click="onToggleFollow"
      >
        <text>{{ isFollowing(seller.id) ? t('follow.following') : t('follow.follow') }}</text>
      </view>

      <view class="trust-row">
        <view class="trust-stat">
          <text class="trust-num">{{ activeCount }}</text>
          <text class="trust-label">{{ t('seller.active') }}</text>
        </view>
        <view class="trust-divider"></view>
        <view class="trust-stat">
          <text class="trust-num">{{ soldCount }}</text>
          <text class="trust-label">{{ t('seller.sold') }}</text>
        </view>
        <view class="trust-divider"></view>
        <view v-if="seller.rating_count && seller.rating_count > 0" class="trust-stat">
          <text class="trust-num">★ {{ (seller.avg_rating ?? 0).toFixed(1) }}</text>
          <text class="trust-label">{{ seller.rating_count }} {{ t('rating.count') }}</text>
        </view>
        <view v-else class="trust-stat">
          <text class="trust-num">{{ joinLabel }}</text>
          <text class="trust-label">{{ t('seller.joined') }}</text>
        </view>
      </view>
    </view>

    <view class="items-grid">
      <view v-for="item in sellerItems" :key="item.id" class="grid-item" @click="goDetail(item.id)">
        <view class="gi-img-wrap">
          <image :src="thumbUrl(item.images?.[0], 'list') || '/static/placeholder.svg'" :alt="item.title" class="gi-img" mode="aspectFill" lazy-load />
          <view v-if="item.location_verified && matchSpot(item.location)?.safe" class="badge-safe-corner" :aria-label="t('pickup.verifiedPickup')">
            <text class="bsc-check">✓</text>
            <text class="bsc-label">{{ t('pickup.verifiedPickup') }}</text>
          </view>
        </view>
        <view class="gi-info">
          <text class="gi-title">{{ localize(item.title_i18n, item.title) }}</text>
          <text class="gi-price">{{ formatPrice(item.price, t("home.free")) }}</text>
        </view>
      </view>
    </view>

    <view v-if="sellerItems.length === 0 && !loading" class="empty">
      <text>{{ t('seller.noItems') }}</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { onLoad, onShareAppMessage, onShareTimeline } from '@dcloudio/uni-app'
import { useSupabase } from '../../composables/useSupabase'
import { useI18n } from '../../composables/useI18n'
import { useModeration } from '../../composables/useModeration'
import { useTheme } from '../../composables/useTheme'
import { useAuth } from '../../composables/useAuth'
import { useFollow } from '../../composables/useFollow'
import { matchSpot } from '../../composables/useCampusSpots'
import type { Profile, Item } from '../../types'
import { formatPrice, thumbUrl } from '../../utils'

const { t, lang, localize } = useI18n()
const { isDark } = useTheme()
const defaultAvatarSrc = computed(() =>
  isDark.value ? '/static/default-avatar-dark.svg' : '/static/default-avatar.svg'
)
const { supabase } = useSupabase()
const { ensureLoaded, isBlocked } = useModeration()
const { currentUser, requireAuth } = useAuth()
const { isFollowing, toggleFollow, loadMyFollowing } = useFollow()

const seller = ref<Profile | null>(null)
const sellerItems = ref<Item[]>([])
const soldCount = ref(0)
const loading = ref(true)
const blocked = ref(false)

const isOwnProfile = computed(() => currentUser.value?.id && seller.value?.id === currentUser.value.id)
const activeCount = computed(() => sellerItems.value.length)

onShareAppMessage(() => {
  const s = seller.value
  if (!s) return { title: 'Illini Market · UIUC 校园二手交易', path: '/pages/index/index' }
  return {
    title: `${s.nickname || '商家'} 的 Illini Market 主页`,
    path: `/pages/seller/index?id=${s.id}`,
    imageUrl: s.avatar_url || '',
  }
})

onShareTimeline(() => {
  const s = seller.value
  if (!s) return { title: 'Illini Market · UIUC 校园二手交易' }
  return {
    title: `${s.nickname || '商家'} 的 Illini Market 主页`,
    query: `id=${s.id}`,
    imageUrl: s.avatar_url || '',
  }
})

async function onToggleFollow() {
  if (!requireAuth() || !seller.value) return
  try {
    const nowFollowing = await toggleFollow(seller.value.id)
    uni.showToast({
      title: t(nowFollowing ? 'follow.followed' : 'follow.unfollowed'),
      icon: 'none',
      duration: 1500,
    })
  } catch (err: any) {
    uni.showToast({ title: err?.message || t('error.actionFailed'), icon: 'none' })
  }
}
const joinLabel = computed(() => {
  if (!seller.value?.created_at) return '—'
  const d = new Date(seller.value.created_at)
  if (lang.value === 'zh') {
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}`
  }
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
})

onLoad(async (options) => {
  if (!options?.id) return
  const uid = options.id

  await ensureLoaded()
  if (isBlocked(uid)) {
    blocked.value = true
    loading.value = false
    return
  }

  const fetchSellerProfile = async () => {
    const full = 'id, nickname, avatar_url, bio, location, is_illini_verified, created_at, avg_rating, rating_count, status_text, status_emoji'
    const legacy = 'id, nickname, avatar_url, bio, location, is_illini_verified, created_at, avg_rating, rating_count'
    const first = await supabase.from('profiles').select(full).eq('id', uid).single()
    if (first.error?.code === '42703') {
      console.warn('[seller] profiles.status_* missing — falling back (run migration 021)')
      return await supabase.from('profiles').select(legacy).eq('id', uid).single()
    }
    return first
  }
  const [profileRes, itemsRes, soldRes] = await Promise.all([
    fetchSellerProfile(),
    supabase.from('items').select('id, title, price, images, image_dimensions, status, condition, category, created_at').eq('user_id', uid).eq('status', 'active').order('created_at', { ascending: false }),
    supabase.from('items').select('id', { count: 'estimated', head: true }).eq('user_id', uid).eq('status', 'sold'),
  ])

  if (profileRes.data) seller.value = profileRes.data as Profile
  if (itemsRes.data) sellerItems.value = itemsRes.data as Item[]
  soldCount.value = soldRes.count || 0
  loading.value = false
  if (currentUser.value) await loadMyFollowing()
})

function goBack() { uni.navigateBack() }
function goDetail(id: string) { uni.navigateTo({ url: `/pages/detail/index?id=${id}` }) }
</script>

<style lang="scss" scoped>
.page { min-height: 100vh; background: var(--bg-subtle); max-width: 480px; margin: 0 auto; }

.header {
  display: flex; align-items: center; gap: 12px; padding: 12px 16px;
  padding-top: calc(12px + var(--status-bar-height, env(safe-area-inset-top, 0px)));
  background: var(--bg-elev-1); border-bottom: 0.5px solid var(--line-hair);
}
.back-btn { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; cursor: pointer; }
.back-arrow { width: 9px; height: 9px; border-left: 2px solid var(--accent-primary); border-bottom: 2px solid var(--accent-primary); transform: rotate(45deg); margin-left: 4px; }
.header-title { font-size: 17px; font-weight: 600; color: var(--text-primary); }

.seller-section {
  background: var(--bg-elev-1); padding: 24px 16px; display: flex;
  flex-direction: column; align-items: center; gap: 6px;
}
.avatar { width: 64px; height: 64px; border-radius: 50%; background: var(--bg-subtle); }
.name-row { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
.nickname { font-size: 18px; font-weight: 700; color: var(--text-primary); }
.illini-badge {
  display: inline-flex; align-items: center;
  background: var(--campus-blue); color: #fff;
  padding: 1px 6px; border-radius: 4px;
  font-size: 10px; font-weight: 700;
}
.illini-badge-text { color: #fff; font-size: 10px; }
.bio { font-size: 13px; color: var(--text-muted); text-align: center; max-width: 280px; }
.user-status {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 10px; border-radius: 12px; background: var(--campus-blue-soft);
}
.us-emoji { font-size: 13px; line-height: 1; }
.us-text { font-size: 12px; color: var(--campus-blue); line-height: 1.45; }
.loc-row { display: flex; align-items: center; gap: 4px; }
.loc-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--accent-action); }
.loc-text { font-size: 12px; color: var(--text-faint); }

.follow-btn {
  margin-top: 12px;
  padding: 8px 22px; border-radius: 20px;
  background: var(--accent-primary); color: #fff;
  font-size: 13px; font-weight: 600;
  cursor: pointer;
  transition: all 0.12s;
  &:active { transform: scale(0.96); }
  &.following {
    background: var(--bg-elev-1); color: var(--text-primary);
    border: 1px solid var(--border-strong);
  }
}

.trust-row {
  display: flex; align-items: center; justify-content: space-around;
  gap: 10px;                  /* was 0 — stats were cramped together */
  margin-top: 14px;
  background: var(--bg-elev-2); border-radius: 10px;
  padding: 12px 20px;         /* was 10px 16px — more breathing room */
}
.trust-stat {
  display: flex; flex-direction: column; align-items: center;
  padding: 0 4px;             /* extra horizontal padding so numbers/labels don't touch the dividers */
  flex: 1; gap: 2px;
}
.trust-num { font-size: 15px; font-weight: 700; color: var(--text-primary); }
.trust-label { font-size: 11px; color: var(--text-muted); }
.trust-divider { width: 0.5px; height: 24px; background: var(--border-strong); }

.items-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 1px;
  background: var(--border); margin-top: 7px;
}
.grid-item {
  background: var(--bg-elev-1); cursor: pointer;
  &:active { opacity: 0.8; }
}
/* Seller grid deliberately opts OUT of the DB-dims pipeline: individual
   items across a shop look like a storefront only when every tile is
   the same shape. Xiaohongshu profile / Taobao storefront grids all
   adopt the same 4:5 portrait frame + aspectFill (cover) contract, so
   the grid reads as a product shelf, not a mixed feed. Center-crop is
   acceptable because the seller already chose image[0] as the hero —
   detail page preserves the full uncropped image. */
.gi-img-wrap { position: relative; aspect-ratio: 4 / 5; overflow: hidden; }
.gi-img { width: 100%; height: 100%; }
.gi-info { padding: 8px 10px; }

/* Safe-zone verified pickup badge — same style as home feed cards. */
.badge-safe-corner {
  position: absolute; bottom: 7px; left: 7px;
  display: inline-flex; align-items: center; gap: 3px;
  padding: 2px 7px 2px 5px; border-radius: var(--radius-xs);
  background: var(--success);
}
.bsc-check { font-size: 10px; color: #fff; font-weight: 800; line-height: 1; }
.bsc-label { font-size: 10px; color: #fff; font-weight: 600; line-height: 1; }
.gi-title {
  font-size: 13px; color: var(--text-primary); line-height: 1.45; letter-spacing: 0.02em;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.gi-price { font-size: 15px; font-weight: 700; color: var(--text-primary); margin-top: 4px; display: block; }

.empty { padding: 60px 16px; text-align: center; color: var(--text-faint); font-size: 14px; }

.blocked-state {
  display: flex; flex-direction: column; align-items: center;
  padding: 80px 40px 40px; gap: 10px; text-align: center;
}
.blocked-icon {
  width: 48px; height: 48px; border: 2.5px solid var(--border-strong);
  border-radius: 50%; position: relative; margin-bottom: 6px;
  &::before {
    content: ''; position: absolute; top: 50%; left: 8px; right: 8px;
    height: 2.5px; background: var(--border-strong);
    transform: rotate(-45deg);
  }
}
.blocked-title { font-size: 15px; font-weight: 600; color: var(--text-primary); }
.blocked-sub { font-size: 13px; color: var(--text-muted); line-height: 1.5; max-width: 240px; }
</style>
