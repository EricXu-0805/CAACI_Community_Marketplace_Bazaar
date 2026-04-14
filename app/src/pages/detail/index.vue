<template>
  <view class="page" v-if="item">
    <swiper class="image-swiper" indicator-dots circular>
      <swiper-item v-for="(img, i) in item.images" :key="i">
        <image :src="img" mode="aspectFill" class="swiper-image" @click="previewImage(i)" />
      </swiper-item>
      <swiper-item v-if="item.images.length === 0">
        <view class="no-image">暂无图片</view>
      </swiper-item>
    </swiper>

    <view class="info-section">
      <text class="price">¥{{ item.price }}</text>
      <text class="title">{{ item.title }}</text>
      <view class="tags">
        <text class="tag">{{ categoryLabels[item.category] }}</text>
        <text class="tag">{{ conditionLabels[item.condition] }}</text>
        <text class="tag location">📍{{ item.location }}</text>
      </view>
    </view>

    <view class="desc-section" v-if="item.description">
      <text class="section-title">描述</text>
      <text class="desc-text">{{ item.description }}</text>
    </view>

    <view class="seller-section" v-if="item.profile">
      <image :src="item.profile.avatar_url || '/static/default-avatar.png'" class="seller-avatar" />
      <view class="seller-info">
        <text class="seller-name">{{ item.profile.nickname }}</text>
        <text class="post-time">{{ formatTime(item.created_at) }}</text>
      </view>
      <text class="view-count">{{ item.view_count }} 次浏览</text>
    </view>

    <view class="bottom-bar">
      <view class="fav-btn" @click="toggleFavorite">
        <text>{{ isFavorited ? '❤️' : '🤍' }}</text>
        <text class="fav-text">{{ isFavorited ? '已收藏' : '收藏' }}</text>
      </view>
      <button class="contact-btn" @click="contactSeller">联系卖家</button>
    </view>
  </view>

  <view v-else class="loading-page">
    <text>加载中...</text>
  </view>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { useItems } from '../../composables/useItems'
import { useAuth } from '../../composables/useAuth'
import { useMessages } from '../../composables/useMessages'
import { CATEGORY_LABELS, CONDITION_LABELS, type Item } from '../../types'

const { fetchItem } = useItems()
const { currentUser, requireAuth } = useAuth()
const { getOrCreateConversation } = useMessages()

const categoryLabels = CATEGORY_LABELS
const conditionLabels = CONDITION_LABELS

const item = ref<Item | null>(null)
const isFavorited = ref(false)

onLoad(async (options) => {
  if (options?.id) {
    try {
      item.value = await fetchItem(options.id)
    } catch (error) {
      uni.showToast({ title: '商品不存在', icon: 'none' })
      setTimeout(() => uni.navigateBack(), 1500)
    }
  }
})

function previewImage(index: number) {
  if (!item.value) return
  uni.previewImage({
    urls: item.value.images,
    current: index,
  })
}

function toggleFavorite() {
  if (!requireAuth()) return
  isFavorited.value = !isFavorited.value
  uni.showToast({ title: isFavorited.value ? '已收藏' : '取消收藏', icon: 'none' })
}

async function contactSeller() {
  if (!requireAuth()) return
  if (!item.value || !currentUser.value) return

  if (item.value.user_id === currentUser.value.id) {
    uni.showToast({ title: '这是你自己的商品', icon: 'none' })
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
    uni.showToast({ title: '发起聊天失败', icon: 'none' })
  }
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 60) return `${minutes}分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}天前`
  return date.toLocaleDateString()
}
</script>

<style lang="scss" scoped>
.page { min-height: 100vh; background: #f5f5f7; padding-bottom: 72px; max-width: 480px; margin: 0 auto; }
.image-swiper { width: 100%; height: 320px; }
.swiper-image { width: 100%; height: 100%; }
.no-image { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: #f0f0f0; color: #aeaeb2; font-size: 15px; }
.info-section { background: #fff; padding: 16px; }
.price { font-size: 26px; font-weight: 800; color: #FF6B35; letter-spacing: -0.5px; }
.title { display: block; font-size: 17px; color: #1d1d1f; margin-top: 8px; line-height: 1.5; font-weight: 500; }
.tags { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
.tag { font-size: 12px; padding: 3px 10px; background: #f5f5f7; color: #86868b; border-radius: 6px; }
.desc-section { background: #fff; padding: 16px; margin-top: 8px; }
.section-title { font-size: 15px; font-weight: 600; color: #1d1d1f; margin-bottom: 8px; display: block; }
.desc-text { font-size: 14px; color: #86868b; line-height: 1.7; }
.seller-section { background: #fff; padding: 16px; margin-top: 8px; display: flex; align-items: center; gap: 12px; }
.seller-avatar { width: 44px; height: 44px; border-radius: 50%; background: #f0f0f0; }
.seller-info { flex: 1; }
.seller-name { font-size: 15px; font-weight: 600; color: #1d1d1f; display: block; }
.post-time { font-size: 12px; color: #aeaeb2; margin-top: 2px; }
.view-count { font-size: 12px; color: #aeaeb2; }
.bottom-bar {
  position: fixed; bottom: 0; left: 50%; transform: translateX(-50%);
  width: 100%; max-width: 480px; display: flex; align-items: center;
  padding: 12px 16px; background: #fff;
  box-shadow: 0 -1px 8px rgba(0,0,0,0.06); gap: 16px;
}
.fav-btn { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 0 8px;
  .fav-text { font-size: 11px; color: #aeaeb2; }
}
.contact-btn {
  flex: 1; height: 46px; background: #FF6B35; color: #fff;
  border-radius: 23px; font-size: 16px; font-weight: 600;
  border: none; display: flex; align-items: center; justify-content: center;
}
.loading-page { display: flex; align-items: center; justify-content: center; height: 100vh; color: #aeaeb2; font-size: 15px; }
</style>
