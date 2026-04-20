<template>
  <view class="page" v-if="item">
    <!-- Image Carousel -->
    <view class="img-area">
      <swiper class="img-swiper" :current="currentImg" @change="currentImg = $event.detail.current" circular>
        <swiper-item v-for="(img, i) in item.images" :key="i">
          <image :src="img" mode="aspectFit" class="swiper-img" @click="previewImage(i)" />
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
      <view v-if="item.images.length > 1" class="img-dots">
        <view
          v-for="(_, i) in item.images"
          :key="i"
          :class="['img-dot', { active: currentImg === i }]"
        ></view>
      </view>
    </view>

    <view class="info-card">
      <view class="price-row">
        <text class="price">{{ formatPrice(item.price, t("home.free")) }}</text>
        <text v-if="item.negotiable" class="obo">OBO</text>
      </view>
      <view class="title-row">
        <text class="title">{{ translated ? translatedTitle : item.title }}</text>
        <view class="translate-btn" @click="toggleTranslate">
          <text>{{ translated ? 'A文' : '文A' }}</text>
        </view>
      </view>
      <view class="tags">
        <text class="tag">{{ t('cat.' + item.category) }}</text>
        <text class="tag">{{ t('condition.' + item.condition) }}</text>
        <view :class="['tag', 'tag-loc', { 'tag-safe': item.location_verified && locationSpot?.safe }]">
          <view class="loc-dot"></view>
          <text>{{ item.location }}</text>
          <text v-if="item.location_verified && locationSpot?.safe" class="safe-badge">{{ t('pickup.verifiedPickup') }}</text>
        </view>
      </view>
    </view>

    <view v-if="item.category === 'currency_exchange'" class="scam-card">
      <view class="sc-head">
        <view class="sc-icon"><view class="sc-excl"></view></view>
        <text class="sc-title">{{ t('scam.detailTitle') }}</text>
      </view>
      <text class="sc-body">{{ t('scam.detailBody') }}</text>
    </view>

    <view class="section" v-if="item.description">
      <text class="section-label">{{ t('detail.description') }}</text>
      <view class="desc-wrap">
        <text :class="['desc-text', { clamped: !descExpanded }]">{{ translated ? translatedDesc : item.description }}</text>
        <text v-if="item.description.length > 100" class="expand-btn" @click="descExpanded = !descExpanded">
          {{ descExpanded ? t('detail.showLess') : t('detail.showMore') }}
        </text>
      </view>
    </view>

    <!-- Seller Card -->
    <view class="section seller-card" v-if="item.profile">
      <view class="seller-row" @click="goSeller(item.user_id)">
        <image :src="item.profile.avatar_url || '/static/default-avatar.svg'" class="seller-avatar" mode="aspectFill" />
        <view class="seller-info">
          <view class="seller-name-row">
            <text class="seller-name">{{ item.profile.nickname }}</text>
            <view v-if="item.profile.is_illini_verified" class="illini-badge" :title="t('profile.illiniVerified')">
              <text class="illini-badge-text">Illini</text>
            </view>
          </view>
          <text v-if="item.profile.status_text || item.profile.status_emoji" class="seller-status">
            <text v-if="item.profile.status_emoji" class="ss-emoji">{{ item.profile.status_emoji }}</text>
            <text v-if="item.profile.status_text" class="ss-text">{{ item.profile.status_text }}</text>
          </text>
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
            <image :src="thumbUrl(si.images?.[0], 'list') || '/static/placeholder.svg'" :alt="si.title" class="mc-img" mode="aspectFill" lazy-load />
            <text class="mc-price">{{ formatPrice(si.price, t("home.free")) }}</text>
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
            <image :src="thumbUrl(si.images?.[0], 'list') || '/static/placeholder.svg'" :alt="si.title" class="mc-img" mode="aspectFill" lazy-load />
            <text class="mc-price">{{ formatPrice(si.price, t("home.free")) }}</text>
          </view>
        </view>
      </scroll-view>
    </view>

    <!-- Action Bar: Buyer -->
    <view class="action-bar" v-if="item.user_id !== currentUser?.id">
      <view class="fav-btn" @click="toggleFavorite">
        <image :src="isFav ? '/static/heart-filled.svg' : '/static/heart.svg'" class="heart-img" />
        <text class="fav-label">{{ isFav ? t('detail.saved') : t('detail.save') }}</text>
      </view>
      <view :class="['action-btn-small', { reported: reported }]" @click="onReport">
        <text class="fav-label">{{ reported ? t('report.thanks') : t('detail.report') }}</text>
      </view>
      <view v-if="item.status === 'sold' && !alreadyRated" class="chat-btn chat-btn-rate" @click="openRating">
        <text>★ {{ t('rating.rateSeller') }}</text>
      </view>
      <view v-else-if="item.status === 'sold'" class="chat-btn chat-btn-disabled">
        <text>{{ t('rating.alreadyRated') }}</text>
      </view>
      <view v-else class="chat-btn" @click="contactSeller">
        <text>{{ t('detail.chat') }}</text>
      </view>
    </view>
    <view class="action-bar" v-else>
      <!-- Sellers can also favorite their own item (e.g. to bookmark it for later). -->
      <view class="fav-btn" @click="toggleFavorite">
        <image :src="isFav ? '/static/heart-filled.svg' : '/static/heart.svg'" class="heart-img" />
        <text class="fav-label">{{ isFav ? t('detail.saved') : t('detail.save') }}</text>
      </view>
      <view class="action-btn-small" @click="goEdit" v-if="item.status === 'active'">
        <text class="fav-label">{{ t('profile.edit') }}</text>
      </view>
      <view class="action-btn-small" @click="onMarkReserved" v-if="item.status === 'active'">
        <text class="fav-label">{{ t('detail.reserve') }}</text>
      </view>
      <view class="action-btn-small" @click="onUnreserve" v-if="item.status === 'reserved'">
        <text class="fav-label">{{ t('detail.unreserve') }}</text>
      </view>
      <view v-if="item.status === 'sold'" class="chat-btn chat-btn-disabled">
        <text>{{ t('status.sold') }}</text>
      </view>
      <view v-else class="chat-btn chat-btn-confirm" @click="onMarkSold">
        <text>{{ t('profile.markSold') }}</text>
      </view>
    </view>
  </view>

  <view v-if="showRating" class="sheet-mask" @click="showRating = false"></view>
  <view :class="['rating-sheet', { open: showRating }]" v-if="item">
    <view class="rs-header">
      <text class="rs-title">{{ t('rating.title') }}</text>
      <view class="rs-close" @click="showRating = false"><view class="cs-x"></view></view>
    </view>
    <text class="rs-prompt">{{ t('rating.prompt').replace('{name}', item.profile?.nickname || t('app.user')) }}</text>
    <view class="rs-stars">
      <view
        v-for="n in 5"
        :key="n"
        :class="['rs-star', { on: ratingStars >= n }]"
        @click="ratingStars = n"
      >★</view>
    </view>
    <textarea
      v-model="ratingComment"
      :placeholder="t('rating.commentPh')"
      maxlength="500"
      class="rs-textarea"
    />
    <view
      :class="['rs-submit', { disabled: ratingStars === 0 || ratingSubmitting }]"
      @click="onSubmitRating"
    >
      <text>{{ t('rating.submit') }}</text>
    </view>
  </view>

  <view v-else-if="notFound" class="not-found-page">
    <view class="nf-back" @click="goBack"><view class="nf-arrow"></view></view>
    <view class="nf-icon"></view>
    <text class="nf-title">{{ t('detail.notFoundTitle') }}</text>
    <text class="nf-sub">{{ t('detail.notFoundSub') }}</text>
    <view class="nf-btn" @click="goHome">{{ t('detail.backHome') }}</view>
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

import { formatTime, haptic, formatPrice, quickTranslate, thumbUrl, friendlyErrorMessage } from '../../utils'
import { matchSpot } from '../../composables/useCampusSpots'
import { useRatings } from '../../composables/useRatings'
import { computed, onUnmounted } from 'vue'

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
const notFound = ref(false)
const translated = ref(false)

const locationSpot = computed(() => matchSpot(item.value?.location))

const { submitRating, hasRated } = useRatings()
const showRating = ref(false)
const ratingStars = ref(0)
const ratingComment = ref('')
const ratingSubmitting = ref(false)
const alreadyRated = ref(false)

async function openRating() {
  if (!requireAuth()) return
  if (!item.value || !currentUser.value) return
  if (item.value.user_id === currentUser.value.id) return
  showRating.value = true
  ratingStars.value = 0
  ratingComment.value = ''
}

async function onSubmitRating() {
  if (!item.value || ratingStars.value === 0 || ratingSubmitting.value) return
  ratingSubmitting.value = true
  try {
    await submitRating({
      rateeId: item.value.user_id,
      itemId: item.value.id,
      stars: ratingStars.value,
      comment: ratingComment.value,
    })
    alreadyRated.value = true
    showRating.value = false
    uni.showToast({ title: t('rating.submitted'), icon: 'success' })
  } catch (err: any) {
    uni.showToast({
      title: friendlyErrorMessage(err, lang.value as 'en' | 'zh'),
      icon: 'none',
      duration: 2500,
    })
  } finally {
    ratingSubmitting.value = false
  }
}

const { lang } = useI18n()

const translatedTitle = computed(() => {
  if (!item.value) return ''
  return quickTranslate(item.value.title, lang.value as 'en' | 'zh')
})
const translatedDesc = computed(() => {
  if (!item.value) return ''
  return quickTranslate(item.value.description, lang.value as 'en' | 'zh')
})

function toggleTranslate() {
  translated.value = !translated.value
}

let alive = true
onUnmounted(() => { alive = false })

onLoad(async (options) => {
  if (!options?.id) return
  try {
    const [, itemData] = await Promise.all([
      currentUser.value ? loadMyFavorites(currentUser.value.id) : Promise.resolve(),
      fetchItem(options.id!),
    ])
    if (!alive) return
    item.value = itemData
    addToHistory(itemData)
    isFav.value = checkFavorited(options.id!)

    const needsRated = itemData.status === 'sold'
      && currentUser.value
      && itemData.user_id !== currentUser.value.id

    const [favCountRes, ratedRes, otherItemsRes, simItemsRes] = await Promise.all([
      getFavoriteCount(options.id!),
      needsRated ? hasRated(itemData.user_id, itemData.id) : Promise.resolve(false),
      supabase
        .from('items').select('id, title, price, images')
        .eq('user_id', itemData.user_id).eq('status', 'active')
        .neq('id', itemData.id).limit(6),
      supabase
        .from('items').select('id, title, price, images, user_id')
        .eq('category', itemData.category).eq('status', 'active')
        .neq('id', itemData.id).neq('user_id', itemData.user_id).limit(12),
    ])

    if (!alive) return
    favCount.value = favCountRes
    alreadyRated.value = !!ratedRes
    if (otherItemsRes.data) sellerOtherItems.value = otherItemsRes.data as Item[]
    if (simItemsRes.data) {
      const { blockedIds } = useModeration()
      similarItems.value = (simItemsRes.data as Item[])
        .filter(i => !blockedIds.value.has(i.user_id))
        .slice(0, 6)
    }
  } catch (error: any) {
    console.error('Detail load error:', error)
    if (alive) notFound.value = true
  }
})

function goBack() { uni.navigateBack({ fail: () => uni.switchTab({ url: '/pages/index/index' }) }) }
function goHome() { uni.switchTab({ url: '/pages/index/index' }) }

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

async function onUnreserve() {
  if (!item.value) return
  try {
    await updateItemStatus(item.value.id, 'active')
    item.value.status = 'active'
    uni.showToast({ title: t('detail.unreserved'), icon: 'success' })
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

  haptic('light')
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
    const prefill = encodeURIComponent(t('chat.prefillInterest').replace('{title}', item.value.title))
    uni.navigateTo({ url: `/pages/chat/index?id=${conversation.id}&prefill=${prefill}` })
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
.img-swiper { width: 100%; height: 380px; background: #f2f2f7; }
.swiper-img { width: 100%; height: 100%; background: #f2f2f7; }
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
.img-dots {
  position: absolute; bottom: 12px; left: 0; right: 0;
  display: flex; justify-content: center; gap: 5px; z-index: 10;
}
.img-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: rgba(255,255,255,0.45);
  transition: all 0.2s;
  &.active { background: #fff; width: 16px; border-radius: 3px; }
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
.title-row {
  display: flex; align-items: flex-start; gap: 10px; margin-top: 9px;
}
.title {
  flex: 1; display: block; font-size: 17px; color: #1d1d1f; font-weight: 600;
  line-height: 1.45;
}
.translate-btn {
  flex-shrink: 0; padding: 4px 8px;
  background: #f2f2f7; border-radius: 6px; cursor: pointer;
  text { font-size: 11px; color: #636366; font-weight: 600; letter-spacing: 0.02em; }
  &:active { background: #e5e5ea; }
}
.tags { display: flex; gap: 6px; margin-top: 11px; flex-wrap: wrap; }
.tag {
  font-size: 12px; padding: 4px 10px;
  background: #f5f5f7; color: #636366; border-radius: 6px;
}
.tag-loc {
  display: inline-flex; align-items: center; gap: 4px; padding-left: 8px;
}
.tag-safe {
  background: #e9f7ef; color: #1a7a3d;
}
.tag-safe .loc-dot { background: #22c55e; }
.safe-badge {
  font-size: 10px; font-weight: 600;
  margin-left: 6px; padding: 2px 6px;
  background: #22c55e; color: #fff;
  border-radius: 4px;
}
.loc-dot {
  width: 5px; height: 5px; border-radius: 50%;
  background: #FF6B35; flex-shrink: 0;
}

.scam-card {
  margin: 7px 0 0;
  padding: 12px 14px;
  background: #FFF4E6;
  border-left: 3px solid #FF9500;
}
.sc-head {
  display: flex; align-items: center; gap: 8px; margin-bottom: 5px;
}
.sc-icon {
  width: 20px; height: 20px; border-radius: 50%; background: #FF9500;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.sc-excl {
  width: 2px; height: 10px; background: #fff; border-radius: 1px; position: relative;
}
.sc-excl::after {
  content: ''; position: absolute; bottom: -5px; left: -1px;
  width: 4px; height: 3px; background: #fff; border-radius: 2px;
}
.sc-title { font-size: 13px; font-weight: 700; color: #A65B00; }
.sc-body { font-size: 12px; color: #8B5000; line-height: 1.55; display: block; }

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
.seller-status {
  display: inline-flex; align-items: center; gap: 4px;
  margin-top: 3px;
  padding: 2px 8px; border-radius: 10px;
  background: rgba(26,122,255,0.08);
  align-self: flex-start;
}
.ss-emoji { font-size: 12px; line-height: 1; }
.ss-text { font-size: 12px; color: #1a7aff; line-height: 1.3; }
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

.heart-img { width: 24px; height: 24px; }

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
.chat-btn-rate { background: #fbbf24; color: #1a1a1a; font-weight: 700; }

.sheet-mask {
  position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 1000;
}
.rating-sheet {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 1001;
  background: #fff; border-radius: 18px 18px 0 0;
  padding: 18px 18px calc(24px + env(safe-area-inset-bottom));
  transform: translateY(100%); transition: transform 0.26s ease;
  &.open { transform: translateY(0); }
}
.rs-header { display: flex; align-items: center; justify-content: space-between; }
.rs-title { font-size: 17px; font-weight: 700; }
.rs-close {
  width: 28px; height: 28px; border-radius: 50%; background: #f2f2f7;
  display: flex; align-items: center; justify-content: center; position: relative;
}
.cs-x {
  width: 12px; height: 12px; position: relative;
  &::before, &::after {
    content: ''; position: absolute; top: 50%; left: 0; right: 0;
    height: 1.5px; background: #636366; border-radius: 1px;
  }
  &::before { transform: rotate(45deg); }
  &::after { transform: rotate(-45deg); }
}
.rs-prompt { display: block; margin: 14px 0 8px; font-size: 14px; color: var(--text-secondary, #5a5a63); }
.rs-stars {
  display: flex; justify-content: center; gap: 8px; padding: 14px 0;
}
.rs-star {
  font-size: 38px; line-height: 1; color: #e5e5ea;
  cursor: pointer;
  &.on { color: #fbbf24; }
  &:active { transform: scale(0.9); }
}
.rs-textarea {
  width: 100%; min-height: 80px;
  background: #f5f5f7; border-radius: 10px;
  padding: 10px 12px; font-size: 14px; color: #1a1a1a;
  margin-top: 4px; box-sizing: border-box;
}
.rs-submit {
  margin-top: 14px; padding: 13px; border-radius: 12px;
  background: #1a1a1a; color: #fff;
  text-align: center; font-size: 15px; font-weight: 600;
  cursor: pointer;
  &.disabled { background: #c7c7cc; pointer-events: none; }
  &:active { transform: scale(0.98); }
}
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

.not-found-page {
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  height: 100vh; gap: 10px; padding: 0 40px; text-align: center;
  background: #fff;
}
.nf-back {
  position: absolute; top: calc(14px + env(safe-area-inset-top, 0px)); left: 14px;
  width: 36px; height: 36px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: #f2f2f7; cursor: pointer;
}
.nf-arrow { width: 9px; height: 9px; border-left: 2px solid #1a1a1a; border-bottom: 2px solid #1a1a1a; transform: rotate(45deg); margin-left: 3px; }
.nf-icon {
  width: 60px; height: 60px; border: 3px solid #d1d1d6;
  border-radius: 50%; position: relative; margin-bottom: 8px;
  &::before {
    content: ''; position: absolute; top: 50%; left: 14px; right: 14px; height: 3px;
    background: #d1d1d6;
    transform: translateY(-50%);
  }
}
.nf-title { font-size: 17px; font-weight: 700; color: #1a1a1a; }
.nf-sub { font-size: 14px; color: #8e8e93; line-height: 1.5; max-width: 280px; }
.nf-btn {
  margin-top: 20px; padding: 12px 28px; background: #1a1a1a;
  color: #fff; border-radius: 22px; font-size: 14px; font-weight: 600;
  cursor: pointer;
  &:active { opacity: 0.8; }
}

/* ========== Desktop ========== */
@media (min-width: 768px) {
  .page { max-width: 640px; margin: 0 auto; }
  .img-swiper { height: 460px; }
  .info-card { border-radius: 0; }
}
</style>
