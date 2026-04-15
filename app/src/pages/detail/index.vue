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
      <view class="seller-row">
        <image :src="item.profile.avatar_url || '/static/default-avatar.png'" class="seller-avatar" />
        <view class="seller-info">
          <text class="seller-name">{{ item.profile.nickname }}</text>
          <text class="seller-meta">{{ formatTime(item.created_at) }}</text>
        </view>
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

    <!-- Bottom Action Bar -->
    <view class="action-bar">
      <view class="fav-btn" @click="toggleFavorite">
        <view :class="['heart-icon', { filled: isFav }]"></view>
        <text class="fav-label">{{ isFav ? t('detail.saved') : t('detail.save') }}</text>
      </view>
      <view class="chat-btn" @click="contactSeller">
        <text>{{ t('detail.chat') }}</text>
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
import { useAuth } from '../../composables/useAuth'
import { useMessages } from '../../composables/useMessages'
import { useFavorites } from '../../composables/useFavorites'
import { useI18n } from '../../composables/useI18n'
import { type Item } from '../../types'
import { MOCK_ITEMS } from '../../composables/useMockData'

const { t } = useI18n()
const { fetchItem } = useItems()
const { currentUser, requireAuth } = useAuth()
const { getOrCreateConversation } = useMessages()
const { isFavorited: checkFavorited, toggleFavorite: doToggleFavorite, getFavoriteCount, loadMyFavorites } = useFavorites()

const item = ref<Item | null>(null)
const isMockItem = ref(false)
const isFav = ref(false)
const favCount = ref(0)
const currentImg = ref(0)
const descExpanded = ref(false)

onLoad(async (options) => {
  if (options?.id) {
    const mockItem = MOCK_ITEMS.find(m => m.id === options.id)
    if (mockItem) {
      item.value = mockItem
      isMockItem.value = true
      favCount.value = mockItem.favorite_count || 0
      return
    }

    try {
      if (currentUser.value) {
        await loadMyFavorites(currentUser.value.id)
      }
      item.value = await fetchItem(options.id!)
      isFav.value = checkFavorited(options.id!)
      favCount.value = await getFavoriteCount(options.id!)
    } catch (error) {
      uni.showToast({ title: t('detail.notFound'), icon: 'none' })
      setTimeout(() => uni.navigateBack(), 1500)
    }
  }
})

function goBack() {
  uni.navigateBack()
}

function onShare() {
  // future: share sheet
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

function formatTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return date.toLocaleDateString()
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
.seller-row { display: flex; align-items: center; gap: 12px; }
.seller-avatar {
  width: 44px; height: 44px; border-radius: 50%;
  background: #f0f0f0; flex-shrink: 0;
}
.seller-info { flex: 1; }
.seller-name { font-size: 15px; font-weight: 600; color: #1d1d1f; display: block; }
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
.chat-btn {
  flex: 1; height: 44px; background: #1a1a1a; color: #fff;
  border-radius: 22px; font-size: 15px; font-weight: 600;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  &:active { opacity: 0.8; }
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
