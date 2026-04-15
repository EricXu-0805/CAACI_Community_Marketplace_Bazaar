<template>
  <view class="page" v-if="item">
    <!-- Image Carousel -->
    <view class="img-area">
      <swiper class="img-swiper" :current="currentImg" @change="currentImg = $event.detail.current" circular>
        <swiper-item v-for="(img, i) in item.images" :key="i">
          <image :src="img" mode="aspectFill" class="swiper-img" @click="previewImage(i)" />
        </swiper-item>
        <swiper-item v-if="item.images.length === 0">
          <view class="no-img">{{ t('detail.noPhotos') }}</view>
        </swiper-item>
      </swiper>
      <!-- Overlay buttons -->
      <view class="img-back" @click="goBack">
        <text>←</text>
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
        <text class="tag">{{ categoryLabels[item.category] }}</text>
        <text class="tag">{{ conditionLabels[item.condition] }}</text>
        <text class="tag">📍 {{ item.location }}</text>
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
        <text class="fav-icon">{{ isFav ? '❤️' : '🤍' }}</text>
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
    <text class="loading-text">Loading...</text>
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
import { CATEGORY_LABELS, CONDITION_LABELS, type Item } from '../../types'
import { MOCK_ITEMS } from '../../composables/useMockData'

const { t } = useI18n()
const { fetchItem } = useItems()
const { currentUser, requireAuth } = useAuth()
const { getOrCreateConversation } = useMessages()
const { isFavorited: checkFavorited, toggleFavorite: doToggleFavorite, getFavoriteCount, loadMyFavorites } = useFavorites()

const categoryLabels = CATEGORY_LABELS
const conditionLabels = CONDITION_LABELS

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
  display: flex; align-items: center; justify-content: center;
  background: #e8e8ed; color: #999; font-size: 15px;
}
.img-back {
  position: absolute; top: 12px; left: 12px; z-index: 10;
  width: 36px; height: 36px; border-radius: 50%;
  background: rgba(0,0,0,0.3); backdrop-filter: blur(8px);
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 18px; cursor: pointer;
  &:active { background: rgba(0,0,0,0.5); }
}
.img-counter {
  position: absolute; bottom: 12px; right: 12px; z-index: 10;
  padding: 3px 10px; border-radius: 10px;
  background: rgba(0,0,0,0.45); backdrop-filter: blur(4px);
  color: #fff; font-size: 12px; font-weight: 500;
}

/* ========== Info Card ========== */
.info-card {
  background: #fff; padding: 16px; margin-top: -12px;
  border-radius: 14px 14px 0 0; position: relative; z-index: 5;
}
.price-row { display: flex; align-items: baseline; gap: 8px; }
.price { font-size: 28px; font-weight: 800; color: #FF6B35; letter-spacing: -0.5px; }
.obo {
  font-size: 11px; font-weight: 700; color: #FF6B35;
  border: 1.5px solid #FF6B35; padding: 2px 6px; border-radius: 4px;
}
.title {
  display: block; font-size: 18px; color: #1d1d1f; font-weight: 600;
  margin-top: 10px; line-height: 1.5;
}
.tags { display: flex; gap: 6px; margin-top: 12px; flex-wrap: wrap; }
.tag {
  font-size: 12px; padding: 4px 10px;
  background: #f5f5f7; color: #666; border-radius: 6px;
}

/* ========== Sections ========== */
.section {
  background: #fff; padding: 16px; margin-top: 8px;
}
.section-label {
  font-size: 14px; font-weight: 600; color: #1d1d1f;
  margin-bottom: 10px; display: block;
}
.desc-text {
  font-size: 14px; color: #666; line-height: 1.7;
  &.clamped {
    display: -webkit-box; -webkit-line-clamp: 3;
    -webkit-box-orient: vertical; overflow: hidden;
  }
}
.expand-btn {
  display: block; margin-top: 6px;
  font-size: 13px; color: #FF6B35; cursor: pointer; font-weight: 500;
}

/* ========== Seller Card ========== */
.seller-card { display: flex; flex-direction: column; gap: 14px; }
.seller-row { display: flex; align-items: center; gap: 12px; }
.seller-avatar { width: 48px; height: 48px; border-radius: 50%; background: #f0f0f0; flex-shrink: 0; }
.seller-info { flex: 1; }
.seller-name { font-size: 16px; font-weight: 600; color: #1d1d1f; display: block; }
.seller-meta { font-size: 12px; color: #999; margin-top: 3px; }
.stats-row {
  display: flex; gap: 24px;
  padding-top: 12px; border-top: 1px solid #f0f0f0;
}
.stat { display: flex; align-items: baseline; gap: 4px; }
.stat-num { font-size: 16px; font-weight: 700; color: #1d1d1f; }
.stat-label { font-size: 12px; color: #999; }

/* ========== Bottom Action Bar ========== */
.action-bar {
  position: fixed; bottom: 0; left: 0; right: 0;
  display: flex; align-items: center; gap: 16px;
  padding: 12px 16px;
  padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px));
  background: rgba(255,255,255,0.92);
  backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
  border-top: 1px solid rgba(0,0,0,0.06);
  z-index: 100;
  max-width: 640px;
  margin: 0 auto;
}
.fav-btn {
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  padding: 0 10px; cursor: pointer;
  &:active { transform: scale(0.9); }
}
.fav-icon { font-size: 22px; transition: transform 0.2s; }
.fav-label { font-size: 10px; color: #999; }
.chat-btn {
  flex: 1; height: 46px; background: #FF6B35; color: #fff;
  border-radius: 23px; font-size: 16px; font-weight: 600;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  &:active { opacity: 0.85; }
}

/* ========== Loading ========== */
.loading-page {
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  height: 100vh; gap: 12px;
}
.loading-spinner {
  width: 28px; height: 28px;
  border: 3px solid #f0f0f0; border-top-color: #FF6B35;
  border-radius: 50%; animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.loading-text { font-size: 14px; color: #999; }

/* ========== Desktop ========== */
@media (min-width: 768px) {
  .page { max-width: 640px; margin: 0 auto; }
  .img-swiper { height: 460px; }
  .info-card { border-radius: 0; }
}
</style>
