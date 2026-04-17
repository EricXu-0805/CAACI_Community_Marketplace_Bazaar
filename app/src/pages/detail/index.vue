<template>
  <view class="page" v-if="item">
    <!-- Image Carousel -->
    <view class="img-area">
      <swiper class="img-swiper" :current="currentImg" @change="currentImg = $event.detail.current" circular>
        <swiper-item v-for="(img, i) in item.images" :key="i">
          <image :src="img" mode="aspectFill" class="swiper-img" @click="previewImage(i)" />
        </swiper-item>
        <swiper-item v-if="item.images.length === 0">
          <view class="no-img">
            <view class="no-img-icon"></view>
            <text>{{ t('detail.noPhotos') }}</text>
          </view>
        </swiper-item>
      </swiper>
      <!-- Overlay buttons -->
      <view class="img-back" @click="goBack">
        <view class="back-arrow"></view>
      </view>
      <view class="img-share" @click="onShare">
        <view class="share-icon"></view>
      </view>
      <view v-if="item.images.length > 1" class="img-counter">
        <text>{{ currentImg + 1 }}/{{ item.images.length }}</text>
      </view>
    </view>

    <!-- Price + Title -->
    <view class="info-card">
      <view class="price-row">
        <text class="price">${{ item.price }}</text>
        <text v-if="item.negotiable" class="obo">OBO</text>
      </view>
      <text class="title">{{ item.title }}</text>
      <view class="tags">
        <text class="tag">{{ t('cat.' + item.category) }}</text>
        <text class="tag">{{ t('condition.' + item.condition) }}</text>
        <view class="tag tag-loc">
          <view class="loc-dot"></view>
          <text>{{ item.location }}</text>
        </view>
      </view>
    </view>

    <!-- Description -->
    <view class="section" v-if="item.description">
      <text class="section-label">{{ t('detail.description') }}</text>
      <view class="desc-wrap">
        <text :class="['desc-text', { clamped: !descExpanded }]">{{ item.description }}</text>
        <text v-if="item.description.length > 100" class="expand-btn" @click="descExpanded = !descExpanded">
          {{ descExpanded ? t('detail.showLess') : t('detail.showMore') }}
        </text>
      </view>
    </view>

    <!-- Seller Card -->
    <view class="section seller-card" v-if="item.profile">
      <view class="seller-row" @click="goSeller(item.user_id)">
        <image :src="item.profile.avatar_url || '/static/default-avatar.png'" class="seller-avatar" />
        <view class="seller-info">
          <view class="seller-name-row">
            <text class="seller-name">{{ item.profile.nickname }}</text>
            <view v-if="item.profile.is_illini_verified" class="illini-badge" :title="t('profile.illiniVerified')">
              <text class="illini-badge-text">✓ Illini</text>
            </view>
          </view>
          <text class="seller-meta">{{ formatTime(item.created_at) }}</text>
        </view>
        <view class="seller-arrow"></view>
      </view>
      <view class="stats-row">
        <view class="stat">
          <text class="stat-num">{{ item.view_count }}</text>
          <text class="stat-label">{{ t('detail.views') }}</text>
        </view>
        <view class="stat">
          <text class="stat-num">{{ favCount }}</text>
          <text class="stat-label">{{ t('detail.wants') }}</text>
        </view>
      </view>
    </view>

    <!-- Safety tip -->
    <view class="safety-tip">
      <text class="st-icon">🛡</text>
      <text class="st-text">{{ t('detail.safetyTip') }}</text>
    </view>

    <!-- More from seller -->
    <view class="section" v-if="sellerOtherItems.length > 0">
      <text class="section-label">{{ t('detail.moreFromSeller') }}</text>
      <scroll-view scroll-x class="more-scroll">
        <view class="more-list">
          <view v-for="si in sellerOtherItems" :key="si.id" class="more-card" @click="goToOtherItem(si.id)">
            <image :src="si.images?.[0] || '/static/placeholder.png'" class="mc-img" mode="aspectFill" />
            <text class="mc-price">${{ si.price }}</text>
          </view>
        </view>
      </scroll-view>
    </view>

    <!-- Similar items -->
    <view class="section" v-if="similarItems.length > 0">
      <text class="section-label">{{ t('detail.similar') }}</text>
      <scroll-view scroll-x class="more-scroll">
        <view class="more-list">
          <view v-for="si in similarItems" :key="si.id" class="more-card" @click="goToOtherItem(si.id)">
            <image :src="si.images?.[0] || '/static/placeholder.png'" class="mc-img" mode="aspectFill" />
            <text class="mc-price">${{ si.price }}</text>
          </view>
        </view>
      </scroll-view>
    </view>

    <!-- Action Bar: Buyer -->
    <view class="action-bar" v-if="item.user_id !== currentUser?.id">
      <view class="fav-btn" @click="toggleFavorite">
        <view :class="['heart-icon', { filled: isFav }]"></view>
        <text class="fav-label">{{ isFav ? t('detail.saved') : t('detail.save') }}</text>
      </view>
      <view :class="['action-btn-small', { reported: reported }]" @click="onReport">
        <text class="fav-label">{{ reported ? t('report.thanks') : t('detail.report') }}</text>
      </view>
      <view v-if="item.status === 'sold'" class="chat-btn chat-btn-disabled">
        <text>{{ t('status.sold') }}</text>
      </view>
      <view v-else class="chat-btn" @click="contactSeller">
        <text>{{ t('detail.chat') }}</text>
      </view>
    </view>
    <!-- Action Bar: Owner -->
    <view class="action-bar" v-else>
      <view class="action-btn-small" @click="goEdit" v-if="item.status === 'active'">
        <text class="fav-label">{{ t('profile.edit') }}</text>
      </view>
      <view class="action-btn-small" @click="onMarkReserved" v-if="item.status === 'active'">
        <text class="fav-label">{{ t('detail.reserve') }}</text>
      </view>
      <view v-if="item.status === 'sold'" class="chat-btn chat-btn-disabled">
        <text>{{ t('status.sold') }}</text>
      </view>
      <view v-else class="chat-btn chat-btn-confirm" @click="onMarkSold">
        <text>{{ t('profile.markSold') }}</text>
      </view>
    </view>
  </view>

  <!-- Loading state -->
  <view v-else class="loading-page">
    <view class="loading-spinner"></view>
    <text class="loading-text">{{ t('home.loading') }}</text>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { useItems } from '../../composables/useItems'
import { useHistory } from '../../composables/useHistory'
import { useSupabase } from '../../composables/useSupabase'
import { useAuth } from '../../composables/useAuth'
import { useMessages } from '../../composables/useMessages'
import { useFavorites } from '../../composables/useFavorites'
import { useI18n } from '../../composables/useI18n'
import { useModeration } from '../../composables/useModeration'
import type { Item } from '../../types'

import { formatTime } from '../../utils'

const { t } = useI18n()
const { fetchItem, updateItemStatus } = useItems()
const { addToHistory } = useHistory()
const { supabase } = useSupabase()
const { currentUser, requireAuth } = useAuth()
const { getOrCreateConversation } = useMessages()
const { isFavorited: checkFavorited, toggleFavorite: doToggleFavorite, getFavoriteCount, loadMyFavorites } = useFavorites()
const { reportTarget } = useModeration()

const item = ref<Item | null>(null)
const sellerOtherItems = ref<Item[]>([])
const similarItems = ref<Item[]>([])
const isFav = ref(false)
const favCount = ref(0)
const currentImg = ref(0)
const descExpanded = ref(false)

onLoad(async (options) => {
  if (options?.id) {
    try {
      const [, itemData] = await Promise.all([
        currentUser.value ? loadMyFavorites(currentUser.value.id) : Promise.resolve(),
        fetchItem(options.id!),
      ])
      item.value = itemData
      addToHistory(itemData)
      isFav.value = checkFavorited(options.id!)
      favCount.value = await getFavoriteCount(options.id!)

      const { data: otherItems } = await supabase
        .from('items').select('id, title, price, images')
        .eq('user_id', itemData.user_id).eq('status', 'active')
        .neq('id', itemData.id).limit(6)
      if (otherItems) sellerOtherItems.value = otherItems as Item[]

      const { blockedIds } = useModeration()
      const { data: simItems } = await supabase
        .from('items').select('id, title, price, images, user_id')
        .eq('category', itemData.category).eq('status', 'active')
        .neq('id', itemData.id).neq('user_id', itemData.user_id).limit(12)
      if (simItems) {
        similarItems.value = (simItems as Item[]).filter(i => !blockedIds.value.has(i.user_id)).slice(0, 6)
      }
    } catch (error: any) {
      console.error('Detail load error:', error)
      uni.showToast({ title: error?.message || t('detail.notFound'), icon: 'none' })
      setTimeout(() => uni.navigateBack(), 2000)
    }
  }
})

function goBack() { uni.navigateBack() }

function goToOtherItem(id: string) {
  uni.navigateTo({ url: `/pages/detail/index?id=${id}` })
}

function goSeller(uid: string) {
  uni.navigateTo({ url: `/pages/seller/index?id=${uid}` })
}

function onShare() {
  if (!item.value) return
  // #ifdef H5
  const shareUrl = `${window.location.origin}/share/${item.value.id}`
  if (navigator.share) {
    navigator.share({ title: item.value.title, text: `$${item.value.price} - ${item.value.title}`, url: shareUrl })
  } else {
    uni.setClipboardData({ data: shareUrl })
    uni.showToast({ title: t('detail.linkCopied'), icon: 'success' })
  }
  // #endif
  // #ifndef H5
  uni.showShareMenu?.({ withShareTicket: true })
  // #endif
}

const reported = ref(false)

function onReport() {
  if (!item.value || reported.value) return
  if (!requireAuth()) return
  const targetId = item.value.id
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
      try {
        await reportTarget('item', targetId, reason)
        reported.value = true
        uni.showToast({ title: t('report.thanks'), icon: 'success' })
      } catch (err: any) {
        uni.showToast({ title: err?.message || t('report.failed'), icon: 'none' })
      }
    },
  })
}

function goEdit() {
  if (!item.value) return
  uni.navigateTo({ url: `/pages/publish/index?edit=${item.value.id}` })
}

async function onMarkReserved() {
  if (!item.value) return
  try {
    await updateItemStatus(item.value.id, 'reserved')
    item.value.status = 'reserved'
    uni.showToast({ title: t('detail.reserved'), icon: 'success' })
  } catch {
    uni.showToast({ title: t('profile.markFail'), icon: 'none' })
  }
}

function onMarkSold() {
  if (!item.value) return
  const id = item.value.id
  uni.showModal({
    title: t('profile.markSoldTitle'),
    content: t('profile.markSoldHint'),
    confirmText: t('profile.markSold'),
    success: async (res) => {
      if (!res.confirm) return
      try {
        await updateItemStatus(id, 'sold')
        if (item.value) item.value.status = 'sold'
        uni.showToast({ title: t('profile.markedSold'), icon: 'success' })
      } catch {
        uni.showToast({ title: t('profile.markFail'), icon: 'none' })
      }
    },
  })
}

function previewImage(index: number) {
  if (!item.value) return
  uni.previewImage({ urls: item.value.images, current: index })
}

async function toggleFavorite() {
  if (!requireAuth()) return
  if (!item.value || !currentUser.value) return

  const nowFavorited = await doToggleFavorite(currentUser.value.id, item.value.id)
  isFav.value = nowFavorited
  favCount.value += nowFavorited ? 1 : -1
  uni.showToast({ title: nowFavorited ? t('detail.saved') : t('detail.save'), icon: 'none' })
}

async function contactSeller() {
  if (!requireAuth()) return
  if (!item.value || !currentUser.value) return

  if (item.value.user_id === currentUser.value.id) {
    uni.showToast({ title: t('detail.ownItem'), icon: 'none' })
    return
  }

  try {
    const conversation = await getOrCreateConversation(
      item.value.id,
      currentUser.value.id,
      item.value.user_id,
    )
    uni.navigateTo({ url: `/pages/chat/index?id=${conversation.id}` })
  } catch (error) {
    uni.showToast({ title: t('detail.chatFail'), icon: 'none' })
  }
}

</script>

<style lang="scss" scoped>
.page {
  min-height: 100vh;
  background: #f2f2f7;
  padding-bottom: 80px;
}

/* ========== Image Area ========== */
.img-area {
  position: relative;
  width: 100%;
  background: #e8e8ed;
}
.img-swiper { width: 100%; height: 380px; }
.swiper-img { width: 100%; height: 100%; }
.no-img {
  width: 100%; height: 100%;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  background: #e8e8ed; color: #999; font-size: 14px; gap: 8px;
}
.no-img-icon {
  width: 36px; height: 28px; border: 2px solid #c7c7cc; border-radius: 4px;
  position: relative;
  &::before {
    content: ''; position: absolute; top: 5px; left: 5px;
    width: 6px; height: 6px; border-radius: 50%; border: 1.5px solid #c7c7cc;
  }
  &::after {
    content: ''; position: absolute; bottom: 4px; left: 4px;
    width: 0; height: 0;
    border-left: 8px solid transparent; border-right: 8px solid transparent;
    border-bottom: 8px solid #c7c7cc;
  }
}

.img-back, .img-share {
  position: absolute; top: calc(12px + env(safe-area-inset-top, 0px)); z-index: 10;
  width: 36px; height: 36px; border-radius: 50%;
  background: rgba(0,0,0,0.3); backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  &:active { background: rgba(0,0,0,0.5); }
}
.img-back { left: 12px; }
.img-share { right: 12px; }

.back-arrow {
  width: 10px; height: 10px;
  border-left: 2px solid #fff; border-bottom: 2px solid #fff;
  transform: rotate(45deg); margin-left: 3px;
}
.share-icon {
  width: 14px; height: 14px; position: relative;
  &::before {
    content: ''; position: absolute; top: 0; left: 50%;
    width: 2px; height: 9px; background: #fff;
    transform: translateX(-50%);
  }
  &::after {
    content: ''; position: absolute; top: 0; left: 50%;
    width: 8px; height: 8px;
    border-top: 2px solid #fff; border-right: 2px solid #fff;
    transform: translateX(-50%) rotate(-45deg);
    transform-origin: center;
  }
}

.img-counter {
  position: absolute; bottom: 12px; right: 12px; z-index: 10;
  padding: 3px 10px; border-radius: 10px;
  background: rgba(0,0,0,0.45); backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  color: #fff; font-size: 12px; font-weight: 500;
}

/* ========== Info Card ========== */
.info-card {
  background: #fff; padding: 18px 16px 16px;
  margin-top: -14px; border-radius: 14px 14px 0 0;
  position: relative; z-index: 5;
}
.price-row { display: flex; align-items: baseline; gap: 7px; }
.price {
  font-size: 26px; font-weight: 800; color: #1a1a1a;
  letter-spacing: -0.5px; font-variant-numeric: tabular-nums;
}
.obo {
  font-size: 11px; font-weight: 700; color: #FF6B35;
  border: 1.5px solid #FF6B35; padding: 2px 6px; border-radius: 4px;
}
.title {
  display: block; font-size: 17px; color: #1d1d1f; font-weight: 600;
  margin-top: 9px; line-height: 1.45;
}
.tags { display: flex; gap: 6px; margin-top: 11px; flex-wrap: wrap; }
.tag {
  font-size: 12px; padding: 4px 10px;
  background: #f5f5f7; color: #636366; border-radius: 6px;
}
.tag-loc {
  display: inline-flex; align-items: center; gap: 4px; padding-left: 8px;
}
.loc-dot {
  width: 5px; height: 5px; border-radius: 50%;
  background: #FF6B35; flex-shrink: 0;
}

/* ========== Sections ========== */
.section {
  background: #fff; padding: 16px; margin-top: 7px;
}
.section-label {
  font-size: 14px; font-weight: 600; color: #1d1d1f;
  margin-bottom: 10px; display: block;
}
.desc-text {
  font-size: 14px; color: #636366; line-height: 1.7;
  &.clamped {
    display: -webkit-box; -webkit-line-clamp: 3;
    -webkit-box-orient: vertical; overflow: hidden;
  }
}
.expand-btn {
  display: block; margin-top: 6px;
  font-size: 13px; color: #1a1a1a; cursor: pointer;
  font-weight: 500; text-decoration: underline;
  text-underline-offset: 3px;
}

/* ========== Seller Card ========== */
.seller-card { display: flex; flex-direction: column; gap: 14px; }
.seller-row { display: flex; align-items: center; gap: 12px; cursor: pointer; }
.seller-arrow {
  width: 7px; height: 7px; flex-shrink: 0;
  border-top: 1.5px solid #c7c7cc; border-right: 1.5px solid #c7c7cc;
  transform: rotate(45deg);
}
.seller-avatar {
  width: 44px; height: 44px; border-radius: 50%;
  background: #f0f0f0; flex-shrink: 0;
}
.seller-info { flex: 1; }
.seller-name-row { display: flex; align-items: center; gap: 6px; }
.seller-name { font-size: 15px; font-weight: 600; color: #1d1d1f; }
.illini-badge {
  display: inline-flex; align-items: center;
  background: #13294B; color: #fff;
  padding: 2px 7px; border-radius: 4px;
  font-size: 10px; font-weight: 700;
  letter-spacing: 0.2px;
}
.illini-badge-text { color: #fff; font-size: 10px; }
.seller-meta { font-size: 12px; color: #aeaeb2; margin-top: 3px; }
.stats-row {
  display: flex; gap: 28px;
  padding-top: 13px; border-top: 1px solid rgba(0,0,0,0.06);
}
.stat { display: flex; align-items: baseline; gap: 4px; }
.stat-num { font-size: 16px; font-weight: 700; color: #1d1d1f; }
.stat-label { font-size: 12px; color: #aeaeb2; }

/* ========== Bottom Action Bar ========== */
.action-bar {
  position: fixed; bottom: 0; left: 0; right: 0;
  display: flex; align-items: center; gap: 16px;
  padding: 11px 16px;
  padding-bottom: calc(11px + env(safe-area-inset-bottom, 0px));
  background: rgba(255,255,255,0.92);
  backdrop-filter: saturate(180%) blur(20px);
  -webkit-backdrop-filter: saturate(180%) blur(20px);
  border-top: 0.5px solid rgba(0,0,0,0.06);
  z-index: 100;
  max-width: 640px;
  margin: 0 auto;
}
.fav-btn {
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  padding: 0 10px; cursor: pointer;
  &:active { transform: scale(0.9); }
}

/* CSS Heart Icon */
.heart-icon {
  width: 22px; height: 20px; position: relative;
  &::before, &::after {
    content: ''; position: absolute; top: 0;
    width: 11px; height: 17px; border-radius: 11px 11px 0 0;
    border: 2px solid #c7c7cc;
    background: transparent;
  }
  &::before { left: 0; transform: rotate(-45deg); transform-origin: bottom right; }
  &::after { right: 0; transform: rotate(45deg); transform-origin: bottom left; }

  &.filled::before, &.filled::after {
    border-color: #FF4D4F;
    background: #FF4D4F;
  }
}

.fav-label { font-size: 10px; color: #8e8e93; }
.safety-tip {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 16px; background: #f7f7f8; margin-top: 7px;
}
.st-icon { font-size: 14px; flex-shrink: 0; }
.st-text { font-size: 12px; color: #8e8e93; line-height: 1.4; }

.more-scroll { white-space: nowrap; }
.more-list { display: inline-flex; gap: 8px; padding: 0 0 4px; }
.more-card {
  width: 100px; flex-shrink: 0; cursor: pointer;
  &:active { opacity: 0.8; }
}
.mc-img { width: 100px; height: 100px; border-radius: 8px; background: #f2f2f7; }
.mc-price { font-size: 13px; font-weight: 700; color: #1a1a1a; margin-top: 4px; display: block; }

.action-btn-small {
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  padding: 0 10px; cursor: pointer;
  &:active { transform: scale(0.9); }
}
.chat-btn {
  flex: 1; height: 44px; background: #1a1a1a; color: #fff;
  border-radius: 22px; font-size: 15px; font-weight: 600;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  &:active { opacity: 0.8; }
}
.chat-btn-confirm { background: #34C759; }
.chat-btn-disabled {
  background: #e5e5ea; cursor: default;
  text { color: #8e8e93; }
  &:active { opacity: 1; }
}

/* ========== Loading ========== */
.loading-page {
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  height: 100vh; gap: 12px;
}
.loading-spinner {
  width: 24px; height: 24px;
  border: 2.5px solid #e8e8ed; border-top-color: #1a1a1a;
  border-radius: 50%; animation: spin 0.7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.loading-text { font-size: 13px; color: #aeaeb2; }

/* ========== Desktop ========== */
@media (min-width: 768px) {
  .page { max-width: 640px; margin: 0 auto; }
  .img-swiper { height: 460px; }
  .info-card { border-radius: 0; }
}
</style>
