<template>
  <AppSidebar current="" />
  <view class="page has-sidebar" v-if="item">
    <!-- Image Carousel -->
    <view :class="['img-area', { 'is-sold': item.status === 'sold' }]">
      <!--
        Swiper height is frozen on item.image_dimensions[0] so swipes
        between slides don't resize the viewport mid-gesture (xianyu
        contract). Capped at 70vh. aspectFit letterboxes non-hero
        slides inside the frame instead of cropping.
      -->
      <swiper
        class="img-swiper"
        :style="swiperStyle"
        :current="currentImg"
        @change="currentImg = $event.detail.current"
        circular
      >
        <swiper-item v-for="(img, i) in item.images" :key="i">
          <image
            :src="thumbUrl(img, 'detail')"
            :alt="displayTitle"
            mode="aspectFit"
            class="swiper-img"
            @load="onHeroImgLoad($event, i)"
            @click="previewImage(i)"
          />
        </swiper-item>
        <swiper-item v-if="item.images.length === 0">
          <view class="no-img">
            <view class="no-img-icon"></view>
            <text>{{ t('detail.noPhotos') }}</text>
          </view>
        </swiper-item>
      </swiper>
      <view v-if="item.status === 'sold'" class="sold-overlay">
        <text class="sold-stamp">{{ t('status.sold') }}</text>
      </view>
      <!-- Overlay buttons -->
      <view class="img-back" role="button" :aria-label="t('a11y.back')" @click="goBack">
        <view class="back-arrow"></view>
      </view>
      <view class="img-share" role="button" :aria-label="t('a11y.share')" @click="onShare">
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
        <text :class="['price', { free: !item.price || item.price === 0 }]">{{ formatPrice(item.price, t("home.free")) }}</text>
        <text v-if="item.negotiable" class="obo">OBO</text>
      </view>
      <view class="title-row">
        <text class="title">{{ displayTitle }}</text>
        <view :class="['translate-btn', { loading: translatePending }]" role="button" :aria-label="t('a11y.translate')" @click="toggleTranslate">
          <text v-if="!translatePending">{{ translated ? 'A文' : '文A' }}</text>
          <text v-else>···</text>
        </view>
      </view>
      <view class="tags">
        <text class="tag">{{ t('cat.' + item.category) }}</text>
        <text class="tag">{{ t('condition.' + item.condition) }}</text>
        <view :class="['tag', 'tag-loc', { 'tag-safe': item.location_verified && locationSpot?.safe }]">
          <view class="loc-dot"></view>
          <text>{{ displayLocation }}</text>
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
        <text :class="['desc-text', { clamped: !descExpanded }]">{{ displayDescription }}</text>
        <text v-if="item.description.length > 100" class="expand-btn" @click="descExpanded = !descExpanded">
          {{ descExpanded ? t('detail.showLess') : t('detail.showMore') }}
        </text>
      </view>
    </view>

    <!-- Seller Card -->
    <view class="section seller-card" v-if="item.profile">
      <view class="seller-row" @click="goSeller(item.user_id)">
        <image :src="item.profile.avatar_url || defaultAvatarSrc" :alt="item.profile.nickname || 'avatar'" class="seller-avatar" mode="aspectFill" />
        <view class="seller-info">
          <view class="seller-name-row">
            <text class="seller-name">{{ item.profile.nickname }}</text>
            <UBadge v-if="item.profile.is_illini_verified" variant="illini" :title="t('profile.illiniVerified')">Illini</UBadge>
          </view>
          <view v-if="soldCount > 0 || reviewCount > 0" class="seller-proof">
            <text v-if="soldCount > 0" class="sp-item"><text class="sp-strong">{{ soldCount }}</text> {{ t('detail.soldCount') }}</text>
            <text v-if="soldCount > 0 && reviewCount > 0" class="sp-dot">·</text>
            <text v-if="reviewCount > 0" class="sp-item"><text class="sp-strong">{{ avgRating }}</text> ★ · {{ reviewCount }}</text>
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

    <!-- Seller reviews — social proof -->
    <view class="section reviews-section" v-if="sellerReviews.length > 0">
      <view class="reviews-head">
        <text class="section-label">{{ t('detail.sellerReviews') }}</text>
        <text class="reviews-meta">{{ avgRating }} ★ · {{ reviewCount }} {{ t('detail.reviewsUnit') }}</text>
      </view>
      <view class="reviews-list">
        <view v-for="r in displayedReviews" :key="r.id" class="review-card">
          <image :src="r.rater?.avatar_url || defaultAvatarSrc" :alt="r.rater?.nickname || 'avatar'" class="rv-avatar" mode="aspectFill" />
          <view class="rv-body">
            <view class="rv-head">
              <text class="rv-nick">{{ r.rater?.nickname || t('app.user') }}</text>
              <UBadge v-if="r.rater?.is_illini_verified" variant="illini">Illini</UBadge>
              <view class="rv-stars">
                <text v-for="n in 5" :key="n" :class="['rv-star', { on: r.stars >= n }]">★</text>
              </view>
              <text class="rv-time">· {{ formatTime(r.created_at) }}</text>
            </view>
            <text v-if="r.comment" class="rv-text">{{ r.comment }}</text>
          </view>
        </view>
      </view>
      <view v-if="reviewCount > displayedReviews.length" class="reviews-more" @click="goSeller(item.user_id)">
        <text>{{ t('detail.seeAllReviews').replace('{n}', String(reviewCount)) }}</text>
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
            <text :class="['mc-price', { free: !si.price || si.price === 0 }]">{{ formatPrice(si.price, t("home.free")) }}</text>
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
            <text :class="['mc-price', { free: !si.price || si.price === 0 }]">{{ formatPrice(si.price, t("home.free")) }}</text>
          </view>
        </view>
      </scroll-view>
    </view>

    <!-- Action Bar: Buyer -->
    <view class="action-bar" v-if="item.user_id !== currentUser?.id">
      <view class="fav-btn" @click="toggleFavorite">
        <image :src="isFav ? '/static/heart-filled.svg' : '/static/heart.svg'" alt="" class="icon-img" />
        <text class="fav-label">{{ isFav ? t('detail.saved') : t('detail.save') }}</text>
      </view>
      <view class="fav-btn" @click="onReport">
        <UIcon name="flag" :color="reported ? 'accent-good' : 'text-secondary'" />
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
      <view class="fav-btn" @click="toggleFavorite">
        <image :src="isFav ? '/static/heart-filled.svg' : '/static/heart.svg'" alt="" class="icon-img" />
        <text class="fav-label">{{ isFav ? t('detail.saved') : t('detail.save') }}</text>
      </view>
      <view class="fav-btn" @click="goEdit" v-if="item.status === 'active'">
        <UIcon name="edit" color="text-secondary" />
        <text class="fav-label">{{ t('profile.edit') }}</text>
      </view>
      <view class="fav-btn" @click="onMarkReserved" v-if="item.status === 'active'">
        <UIcon name="reserved" color="text-secondary" />
        <text class="fav-label">{{ t('detail.reserve') }}</text>
      </view>
      <view class="fav-btn" @click="onUnreserve" v-if="item.status === 'reserved'">
        <UIcon name="reserved" color="accent-warn" />
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
      <view class="rs-close" role="button" :aria-label="t('a11y.close')" @click="showRating = false"><view class="cs-x"></view></view>
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

  <view v-else-if="notFound" class="not-found-page has-sidebar">
    <view class="nf-back" role="button" :aria-label="t('a11y.back')" @click="goBack"><view class="nf-arrow"></view></view>
    <view class="nf-icon"></view>
    <text class="nf-title">{{ t('detail.notFoundTitle') }}</text>
    <text class="nf-sub">{{ t('detail.notFoundSub') }}</text>
    <view class="nf-btn" @click="goHome">{{ t('detail.backHome') }}</view>
  </view>

  <!-- Loading state -->
  <view v-else class="loading-page has-sidebar">
    <view class="loading-spinner"></view>
    <text class="loading-text">{{ t('home.loading') }}</text>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { onLoad, onShareAppMessage, onShareTimeline } from '@dcloudio/uni-app'
import { useItems } from '../../composables/useItems'
import { useHistory } from '../../composables/useHistory'
import { useSupabase } from '../../composables/useSupabase'
import { useAuth } from '../../composables/useAuth'
import { useMessages } from '../../composables/useMessages'
import { useFavorites } from '../../composables/useFavorites'
import { useI18n } from '../../composables/useI18n'
import { useModeration } from '../../composables/useModeration'
import { useTheme } from '../../composables/useTheme'
import type { Item, Rating } from '../../types'

import { formatTime, haptic, formatPrice, quickTranslate, thumbUrl, friendlyErrorMessage } from '../../utils'
import { readNaturalDims } from '../../utils/imgStyle'
import type { ImageDim } from '../../types'
import { matchSpot, localizeLocation } from '../../composables/useCampusSpots'
import { useRatings } from '../../composables/useRatings'
import { useTranslate } from '../../composables/useTranslate'
import { computed, onUnmounted, watch } from 'vue'
import UBadge from '../../components/UBadge.vue'
import UIcon from '../../components/UIcon.vue'
import AppSidebar from '../../components/AppSidebar.vue'

const { t, lang, localize } = useI18n()
const { isDark } = useTheme()
const defaultAvatarSrc = computed(() =>
  isDark.value ? '/static/default-avatar-dark.svg' : '/static/default-avatar.svg'
)
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

/*
 * Two layers of content localization are in play:
 *   1. Pre-translated i18n map (items.title_i18n / description_i18n) —
 *      populated at publish time (migration 015). This is what most
 *      users see once the async translator has run.
 *   2. On-demand "A文" toggle — still supported for legacy rows where
 *      the i18n map is missing, and as a "retry with AI" escape hatch.
 *
 * displayTitle / displayDescription collapse the two layers into one
 * template-readable string: if user hit A文 we show the live translation;
 * otherwise we show localize(i18n map, original) which cleanly falls
 * back to the author's original text when no translation exists.
 */
const displayTitle = computed(() => {
  if (!item.value) return ''
  if (translated.value && translatedTitle.value) return translatedTitle.value
  return localize(item.value.title_i18n, item.value.title)
})
const displayDescription = computed(() => {
  if (!item.value) return ''
  if (translated.value && translatedDesc.value) return translatedDesc.value
  return localize(item.value.description_i18n, item.value.description)
})

const locationSpot = computed(() => matchSpot(item.value?.location))
const displayLocation = computed(() =>
  localizeLocation(item.value?.location, lang.value as 'en' | 'zh')
)

/*
 * Render-side safety net for the hero carousel.
 *
 * Same pattern as pages/index/index.vue + pages/post/index.vue: when
 * the DB-persisted image_dimensions are empty, we fall back to a
 * locally-measured cache that fills in via @load. Swiper height stays
 * frozen on slot 0 (xianyu contract, avoids mid-gesture viewport
 * jumps), so only measuredDims[0] actually drives sizing — but we
 * populate every slot we see decoded so the data is there if the
 * height-freeze rule ever relaxes.
 */
const measuredDims = ref<ImageDim[]>([])

function effectiveDims(): ImageDim[] | null {
  const fromDb = item.value?.image_dimensions
  if (Array.isArray(fromDb) && fromDb.length > 0 && fromDb.some((d) => d && d.w > 0 && d.h > 0)) {
    return fromDb
  }
  return measuredDims.value.length > 0 ? measuredDims.value : null
}

function onHeroImgLoad(e: any, i: number) {
  const fromDb = item.value?.image_dimensions
  if (Array.isArray(fromDb) && fromDb[i] && fromDb[i].w > 0 && fromDb[i].h > 0) return
  const natural = readNaturalDims(e)
  if (!natural) return
  const next = measuredDims.value.slice()
  next[i] = natural
  measuredDims.value = next
}

/*
 * Hero-carousel height.
 *
 * uni-app <swiper> needs a concrete height. We size it from the FIRST
 * image's dims (DB-persisted from migration 014, with @load fallback
 * for empty-DB rows) — not the currently visible slide — so swiping
 * from a 4:5 portrait to a 3:4 landscape doesn't shrink the swiper
 * mid-gesture. Xianyu / Taobao both freeze the carousel height on
 * image[0]; subsequent slides letterbox via aspectFit.
 *
 * Fallback: no dims anywhere → 4/5 (the most common vertical-phone
 * aspect). Safety net: max-height 70vh so a 9:16 portrait can't eat
 * the whole viewport and push the price/title below the fold.
 */
// Pick the most landscape-leaning aspect across all images so the swiper
// viewport doesn't get locked to an unusually tall image0. Subsequent
// slides then horizontal-letterbox (acceptable) instead of vertical-
// letterbox (the "200-300px blank band" bug Eric reported on long-image items).
function bestAspect(dims: ImageDim[] | null): number | null {
  if (!dims || !dims.length) return null
  let maxRatio = 0
  for (const d of dims) {
    if (d?.w && d?.h) maxRatio = Math.max(maxRatio, d.w / d.h)
  }
  if (maxRatio === 0) return null
  return Math.max(0.4, Math.min(maxRatio, 2.5))
}

const swiperStyle = computed(() => {
  const ratio = bestAspect(effectiveDims()) ?? (4 / 5)
  return {
    aspectRatio: String(ratio),
    maxHeight: '70vh',
    height: 'auto',
  }
})

const { submitRating, hasRated, fetchForUser } = useRatings()
const showRating = ref(false)
const ratingStars = ref(0)
const ratingComment = ref('')
const ratingSubmitting = ref(false)
const alreadyRated = ref(false)

/*
 * Seller social proof (v5 detail). Reviews + sold-count are read straight
 * from public data (ratings are public; sold items are listed), so they're
 * RLS-safe to fetch for any seller. avgRating/reviewCount are derived from
 * the fetched batch (capped at REVIEW_FETCH) — fine for a campus-scale app.
 *
 * Seller reply-rate (the kit's "95% 回复") is deliberately NOT shown: it
 * needs another user's conversation/message rows, which RLS blocks
 * client-side. It belongs on a denormalized profile column / RPC — deferred.
 */
const REVIEW_FETCH = 50
const REVIEW_PREVIEW = 6
const sellerReviews = ref<Rating[]>([])
const soldCount = ref(0)
const reviewCount = computed(() => sellerReviews.value.length)
const avgRating = computed(() => {
  if (!sellerReviews.value.length) return 0
  const sum = sellerReviews.value.reduce((acc, r) => acc + (r.stars || 0), 0)
  return Math.round((sum / sellerReviews.value.length) * 10) / 10
})
const displayedReviews = computed(() => sellerReviews.value.slice(0, REVIEW_PREVIEW))

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

// lang / localize / t all come from the top-level useI18n() destructure.
const { translate: translateText, getCached, pending: translatePending } = useTranslate()

const translatedTitle = ref('')
const translatedDesc = ref('')

function dictionaryFallback(kind: 'title' | 'desc'): string {
  if (!item.value) return ''
  const src = kind === 'title' ? item.value.title : item.value.description
  return quickTranslate(src, lang.value as 'en' | 'zh')
}

async function ensureTranslation() {
  if (!item.value) return
  const target = lang.value as 'en' | 'zh'
  const cachedT = getCached(item.value.title, target)
  const cachedD = getCached(item.value.description, target)
  translatedTitle.value = cachedT || dictionaryFallback('title')
  translatedDesc.value  = cachedD || dictionaryFallback('desc')
  if (cachedT && cachedD) return
  const [t2, d2] = await Promise.all([
    cachedT ? Promise.resolve(cachedT) : translateText(item.value.title, target),
    cachedD ? Promise.resolve(cachedD) : translateText(item.value.description, target),
  ])
  if (!item.value) return
  if (t2) translatedTitle.value = t2
  if (d2) translatedDesc.value  = d2
}

async function toggleTranslate() {
  translated.value = !translated.value
  if (translated.value) await ensureTranslation()
}

watch(lang, async () => {
  if (translated.value && item.value) {
    await ensureTranslation()
  }
})

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

    const [favCountRes, ratedRes, otherItemsRes, simItemsRes, reviewsRes, soldCountRes] = await Promise.all([
      getFavoriteCount(options.id!),
      needsRated ? hasRated(itemData.user_id, itemData.id) : Promise.resolve(false),
      supabase
        .from('items').select('id, title, price, images, image_dimensions')
        .eq('user_id', itemData.user_id).eq('status', 'active')
        .neq('id', itemData.id).limit(6),
      supabase
        .from('items').select('id, title, price, images, image_dimensions, user_id')
        .eq('category', itemData.category).eq('status', 'active')
        .neq('id', itemData.id).neq('user_id', itemData.user_id).limit(12),
      fetchForUser(itemData.user_id, REVIEW_FETCH).catch(() => [] as Rating[]),
      supabase
        .from('items').select('id', { count: 'exact', head: true })
        .eq('user_id', itemData.user_id).eq('status', 'sold'),
    ])

    if (!alive) return
    favCount.value = favCountRes
    alreadyRated.value = !!ratedRes
    sellerReviews.value = reviewsRes || []
    soldCount.value = soldCountRes?.count || 0
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

/*
 * WeChat mp share card. H5 never fires these hooks (no-op on web) —
 * the existing navigator.share / setClipboardData path in onShare()
 * handles H5 sharing. On mp, tapping the top-right "···" → "转发" uses
 * onShareAppMessage; "分享到朋友圈" uses onShareTimeline. Both return
 * a snapshot of the item; if item hasn't loaded yet we return a
 * generic app-level card so the share never appears empty.
 */
onShareAppMessage(() => {
  const it = item.value
  if (!it) return { title: 'Illini Market · UIUC 校园二手交易', path: '/pages/index/index' }
  const priceLabel = it.price && it.price > 0 ? `$${it.price}` : t('home.free')
  return {
    title: `${priceLabel} · ${it.title}`,
    path: `/pages/detail/index?id=${it.id}`,
    imageUrl: it.images?.[0] ? thumbUrl(it.images[0], 'card') : '',
  }
})

onShareTimeline(() => {
  const it = item.value
  if (!it) return { title: 'Illini Market · UIUC 校园二手交易' }
  const priceLabel = it.price && it.price > 0 ? `$${it.price}` : t('home.free')
  return {
    title: `${priceLabel} · ${it.title}`,
    query: `id=${it.id}`,
    imageUrl: it.images?.[0] ? thumbUrl(it.images[0], 'card') : '',
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
      .catch((err: any) => {
        if (err?.name !== 'AbortError') console.warn('[share] failed:', err)
      })
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
      // The 5–10s pacing lives inside reportTarget() so every call site gets it.
      uni.showLoading({ title: t('report.submitting') || t('login.wait'), mask: true })
      try {
        await reportTarget('item', targetId, reason)
        reported.value = true
        uni.hideLoading()
        uni.showToast({ title: t('report.thanks'), icon: 'success' })
      } catch (err: any) {
        uni.hideLoading()
        uni.showToast({ title: err?.message || t('report.failed'), icon: 'none' })
      }
    },
  })
}

function goEdit() {
  if (!item.value) return
  uni.navigateTo({ url: `/pages/publish/edit?id=${item.value.id}` })
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
  background: var(--bg-subtle);
  padding-bottom: calc(80px + env(safe-area-inset-bottom, 0px));
}

/* ========== Image Area ========== */
.img-area {
  position: relative;
  width: 100%;
  background: var(--bg-inset);
}
/*
 * Sold-state hero (gate §4 refine): desaturate the photo and stamp a
 * rotated serif "SOLD" over it — the kit's product_card_v2 pattern
 * (overlay rgba(31,29,27,.5) + ink-inverse stamp). Overlay is inert so
 * the back/share buttons above it stay tappable.
 */
.img-area.is-sold .swiper-img {
  filter: grayscale(1) brightness(0.92);
}
.sold-overlay {
  position: absolute; inset: 0; z-index: 6;
  display: flex; align-items: center; justify-content: center;
  background: rgba(31,29,27,0.5);
  pointer-events: none;
}
.sold-stamp {
  font-family: var(--font-serif);
  font-size: 24px; font-weight: 600;
  color: var(--ink-inverse);
  border: 2px solid var(--ink-inverse);
  padding: 6px 14px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  transform: rotate(-6deg);
}
/*
 * Height is injected via :style="swiperStyle" (aspect-ratio + max-height).
 * Keep `background` so tall portraits letterbox into a neutral surface
 * instead of showing whatever is behind during the initial @load settle.
 * Never re-introduce a hard `height: Xpx` here — it would fight the
 * aspect-ratio style and we'd be back to the squashed look.
 *
 * display: block + vertical-align: top defend against the classic
 * inline-baseline ghost-gap that browsers paint below replaced
 * elements. Without these, tall portrait images on mobile leave a
 * 4-6px sliver of bg-subtle between the swiper and the info-card,
 * which users see as "weird exposure below the image".
 */
.img-swiper {
  display: block;
  width: 100%;
  background: var(--bg-subtle);
  vertical-align: top;
}
.swiper-img {
  display: block;
  width: 100%;
  height: 100%;
  background: var(--bg-subtle);
  vertical-align: top;
}
.no-img {
  width: 100%; height: 100%;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  background: var(--bg-inset); color: var(--ink-quiet); font-size: 14px; gap: 8px;
}
.no-img-icon {
  width: 36px; height: 28px; border: 2px solid var(--text-faint); border-radius: 4px;
  position: relative;
  &::before {
    content: ''; position: absolute; top: 5px; left: 5px;
    width: 6px; height: 6px; border-radius: 50%; border: 1.5px solid var(--text-faint);
  }
  &::after {
    content: ''; position: absolute; bottom: 4px; left: 4px;
    width: 0; height: 0;
    border-left: 8px solid transparent; border-right: 8px solid transparent;
    border-bottom: 8px solid var(--text-faint);
  }
}

.img-back, .img-share {
  position: absolute; top: calc(12px + var(--status-bar-height, env(safe-area-inset-top, 0px))); z-index: 10;
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
    width: 2px; height: 9px; background: var(--bg-elev-1);
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
  &.active { background: var(--bg-elev-1); width: 16px; border-radius: 3px; }
}

/* ========== Info Card ========== */
.info-card {
  background: var(--bg-elev-1); padding: 18px 16px 16px;
  margin-top: -14px; border-radius: 14px 14px 0 0;
  position: relative; z-index: 5;
}
.price-row { display: flex; align-items: baseline; gap: 7px; }
/*
 * Price — the star of the detail page.
 *
 * 米白书院 calls for serif terracotta at ~28px with tabular numerals.
 * The previous 800-weight sans "marketplace" style was too loud next
 * to the warm canvas; Fraunces 600 at 28px reads bookshop-confident.
 * Free items drop to sage (--success) to differentiate.
 */
.price {
  font-family: var(--font-serif);
  font-size: 28px;
  font-weight: 600;
  color: var(--brand);
  letter-spacing: -0.02em;
  line-height: 1;
  font-feature-settings: 'tnum';
}
.price.free { color: var(--success); }
/*
 * OBO — "or best offer", ivory_academy puts this in amber (warning
 * tone) because it's a price-open affordance, not a CTA. Small pill,
 * mono-ish caps, fits next to the terracotta price without fighting
 * for attention.
 */
.obo {
  font-size: 10px; font-weight: 600;
  color: var(--warning);
  border: 0.5px solid var(--warning);
  padding: 2px 5px;
  border-radius: var(--radius-xs);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  line-height: 1.3;
  background: var(--warning-soft);
}
.title-row {
  display: flex; align-items: flex-start; gap: 10px; margin-top: 9px;
}
.title {
  flex: 1; display: block; font-size: 17px; color: var(--ink); font-weight: 600;
  line-height: 1.45;
}
.translate-btn {
  flex-shrink: 0; padding: 4px 8px;
  background: var(--bg-subtle); border-radius: 6px; cursor: pointer;
  text { font-size: 11px; color: var(--text-secondary); font-weight: 600; letter-spacing: 0.02em; }
  &:active { background: var(--bg-inset); }
}
.tags { display: flex; gap: 6px; margin-top: 11px; flex-wrap: wrap; }
.tag {
  font-size: 12px; padding: 4px 10px;
  background: var(--bg-subtle); color: var(--text-secondary); border-radius: 6px;
}
.tag-loc {
  display: inline-flex; align-items: center; gap: 4px; padding-left: 8px;
}
.tag-safe {
  background: var(--success-soft); color: var(--success);
}
.tag-safe .loc-dot { background: var(--accent-good); }
.safe-badge {
  font-size: 10px; font-weight: 600;
  margin-left: 6px; padding: 2px 6px;
  background: var(--accent-good); color: #fff;
  border-radius: 4px;
}
.loc-dot {
  width: 5px; height: 5px; border-radius: 50%;
  background: var(--accent-action); flex-shrink: 0;
}

.scam-card {
  margin: 7px 0 0;
  padding: 12px 14px;
  background: var(--warning-soft);
  border-left: 3px solid var(--accent-warn);
}
.sc-head {
  display: flex; align-items: center; gap: 8px; margin-bottom: 5px;
}
.sc-icon {
  width: 20px; height: 20px; border-radius: 50%; background: var(--accent-warn);
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.sc-excl {
  width: 2px; height: 10px; background: var(--bg-elev-1); border-radius: 1px; position: relative;
}
.sc-excl::after {
  content: ''; position: absolute; bottom: -5px; left: -1px;
  width: 4px; height: 3px; background: var(--bg-elev-1); border-radius: 2px;
}
.sc-title {
  font-size: 13px; font-weight: 700;
  color: var(--warning);
  filter: brightness(0.75);
}
.sc-body {
  font-size: 12px;
  color: var(--warning);
  filter: brightness(0.7);
  line-height: 1.55; display: block;
}

/* ========== Sections ========== */
.section {
  background: var(--bg-elev-1); padding: 16px; margin-top: 7px;
}
.section-label {
  font-size: 14px; font-weight: 600; color: var(--ink);
  margin-bottom: 10px; display: block;
}
.desc-text {
  font-size: 14px; color: var(--text-secondary); line-height: 1.7;
  &.clamped {
    display: -webkit-box; -webkit-line-clamp: 3;
    -webkit-box-orient: vertical; overflow: hidden;
  }
}
.expand-btn {
  display: block; margin-top: 6px;
  font-size: 13px; color: var(--text-primary); cursor: pointer;
  font-weight: 500; text-decoration: underline;
  text-underline-offset: 3px;
}

/* ========== Seller Card ========== */
.seller-card { display: flex; flex-direction: column; gap: 14px; }
.seller-row { display: flex; align-items: center; gap: 12px; cursor: pointer; }
.seller-arrow {
  width: 7px; height: 7px; flex-shrink: 0;
  border-top: 1.5px solid var(--text-faint); border-right: 1.5px solid var(--text-faint);
  transform: rotate(45deg);
}
.seller-avatar {
  width: 44px; height: 44px; border-radius: 50%;
  background: var(--bg-subtle); flex-shrink: 0;
}
.seller-info { flex: 1; }
.seller-name-row { display: flex; align-items: center; gap: 6px; }
.seller-name { font-size: 15px; font-weight: 600; color: var(--ink); }
/* illini badge → components/UBadge.vue (variant illini). */
.seller-meta { font-size: 12px; color: var(--text-faint); margin-top: 3px; }
.seller-status {
  display: inline-flex; align-items: center; gap: 4px;
  margin-top: 3px;
  padding: 2px 8px; border-radius: 10px;
  background: var(--campus-blue-soft);
  align-self: flex-start;
}
.ss-emoji { font-size: 12px; line-height: 1; }
.ss-text { font-size: 12px; color: var(--campus-blue); line-height: 1.45; }
.stats-row {
  display: flex; gap: 28px;
  padding-top: 13px; border-top: 1px solid var(--line-hair);
}
.stat { display: flex; align-items: baseline; gap: 4px; }
.stat-num { font-size: 16px; font-weight: 700; color: var(--ink); }
.stat-label { font-size: 12px; color: var(--text-faint); }

/* Seller social proof — sold count + avg rating, inline under the name. */
.seller-proof {
  display: flex; align-items: center; gap: 6px;
  margin-top: 4px;
  font-size: 12px; color: var(--ink-quiet);
}
.sp-item { display: inline-flex; align-items: center; gap: 3px; }
.sp-strong { font-family: var(--font-serif); font-weight: 600; color: var(--ink); }
.sp-dot { color: var(--ink-faint); }

/* ========== Seller reviews ========== */
.reviews-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 12px; }
.reviews-head .section-label { margin-bottom: 0; }
.reviews-meta {
  font-family: var(--font-serif); font-size: 13px; font-weight: 600;
  color: var(--brand); letter-spacing: -0.01em;
}
.reviews-list { display: flex; flex-direction: column; gap: 14px; }
.review-card { display: flex; gap: 10px; }
.rv-avatar { width: 32px; height: 32px; border-radius: 50%; background: var(--bg-subtle); flex-shrink: 0; }
.rv-body { flex: 1; min-width: 0; }
.rv-head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.rv-nick { font-size: 13px; font-weight: 600; color: var(--ink); }
.rv-stars { display: inline-flex; gap: 1px; }
.rv-star { font-size: 11px; color: var(--border-strong); line-height: 1; }
.rv-star.on { color: var(--warning); }
.rv-time { font-size: 11px; color: var(--text-faint); }
.rv-text { display: block; margin-top: 4px; font-size: 13px; color: var(--text-secondary); line-height: 1.6; }
.reviews-more {
  margin-top: 14px; text-align: center;
  font-size: 13px; color: var(--brand); font-weight: 500; cursor: pointer;
  &:active { opacity: 0.7; }
}

/* ========== Bottom Action Bar ========== */
.action-bar {
  position: fixed; bottom: 0; left: 0; right: 0;
  display: flex; align-items: center; gap: 16px;
  padding: 12px 16px;
  padding-bottom: calc(14px + env(safe-area-inset-bottom, 0px));
  background: rgba(var(--surface-rgb), 0.95);
  backdrop-filter: saturate(180%) blur(20px);
  -webkit-backdrop-filter: saturate(180%) blur(20px);
  box-shadow: 0 -4px 16px rgba(60, 40, 20, 0.06);
  border-top: 0.5px solid var(--line-hair);
  z-index: 100;
  max-width: 640px;
  margin: 0 auto;
}
.fav-btn {
  display: flex; flex-direction: column; align-items: center;
  justify-content: center;
  min-width: 48px; height: 44px;
  gap: 3px; padding: 0 6px; cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active { transform: scale(0.92); }
}

.icon-img { width: 22px; height: 22px; flex-shrink: 0; display: block; }
.heart-img { width: 22px; height: 22px; }

.fav-label { font-size: 10px; color: var(--text-muted); line-height: 1; }
.safety-tip {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 16px; background: var(--bg-elev-2); margin-top: 7px;
}
.st-icon { font-size: 14px; flex-shrink: 0; }
.st-text { font-size: 12px; color: var(--text-muted); line-height: 1.4; }

.more-scroll { white-space: nowrap; }
.more-list { display: inline-flex; gap: 8px; padding: 0 0 4px; }
.more-card {
  width: 100px; flex-shrink: 0; cursor: pointer;
  &:active { opacity: 0.8; }
}
.mc-img { width: 100px; height: 100px; border-radius: 8px; background: var(--bg-subtle); }
.mc-price {
  font-family: var(--font-serif);
  font-size: 15px; font-weight: 600;
  color: var(--brand);
  letter-spacing: -0.01em;
  margin-top: 4px;
  display: block;
  line-height: 1;
  font-feature-settings: 'tnum';
}
.mc-price.free { color: var(--success); }

.action-btn-small {
  display: flex; flex-direction: column; align-items: center;
  justify-content: center;
  min-width: 48px; height: 44px;
  gap: 3px; padding: 0 6px; cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active { transform: scale(0.92); }
}
/*
 * Primary CTA at the bottom of the detail page.
 *
 * Ivory_academy CTA ladder puts the "talk to seller" action on the
 * brand (terracotta). No gradient — flat brand + subtle CTA shadow.
 * Semantic variants:
 *   · confirm (确认交易) → sage success
 *   · rate (去评价)     → amber warning (encourages action without
 *     overpromising a "celebration" state)
 */
.chat-btn {
  flex: 1; height: 44px;
  background: var(--brand);
  color: #fff;
  border-radius: var(--radius-pill);
  font-size: 15px; font-weight: 600;
  letter-spacing: 0.02em;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  box-shadow: var(--shadow-cta);
  border: 0;
  transition: background 0.15s ease, transform 0.08s ease;
  &:active { background: var(--brand-deep); transform: translateY(1px); }
}
.chat-btn-confirm {
  background: var(--success); color: #fff;
  box-shadow: 0 6px 14px rgba(93, 124, 74, 0.28);
}
.chat-btn-rate {
  background: var(--warning); color: #fff;
  box-shadow: 0 6px 14px rgba(212, 146, 60, 0.28);
}

.sheet-mask {
  position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 1000;
}
.rating-sheet {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 1001;
  background: var(--bg-elev-1); border-radius: 18px 18px 0 0;
  padding: 18px 18px calc(24px + env(safe-area-inset-bottom));
  transform: translateY(100%); transition: transform 0.26s ease;
  &.open { transform: translateY(0); }
}
.rs-header { display: flex; align-items: center; justify-content: space-between; }
.rs-title { font-size: 17px; font-weight: 700; }
.rs-close {
  width: 28px; height: 28px; border-radius: 50%; background: var(--bg-subtle);
  display: flex; align-items: center; justify-content: center; position: relative;
}
.cs-x {
  width: 12px; height: 12px; position: relative;
  &::before, &::after {
    content: ''; position: absolute; top: 50%; left: 0; right: 0;
    height: 1.5px; background: var(--text-secondary); border-radius: 1px;
  }
  &::before { transform: rotate(45deg); }
  &::after { transform: rotate(-45deg); }
}
.rs-prompt { display: block; margin: 14px 0 8px; font-size: 14px; color: var(--text-secondary); }
.rs-stars {
  display: flex; justify-content: center; gap: 8px; padding: 14px 0;
}
.rs-star {
  font-size: 38px; line-height: 1; color: var(--border-strong);
  cursor: pointer;
  &.on { color: var(--warning); }
  &:active { transform: scale(0.9); }
}
.rs-textarea {
  width: 100%; min-height: 80px;
  background: var(--paper-2); border-radius: var(--radius-md);
  padding: 10px 12px; font-size: 14px; color: var(--text-primary);
  margin-top: 4px; box-sizing: border-box;
  border: 0.5px solid var(--border);
}
.rs-submit {
  margin-top: 14px; padding: 13px; border-radius: 12px;
  background: var(--accent-primary); color: #fff;
  text-align: center; font-size: 15px; font-weight: 600;
  cursor: pointer;
  &.disabled { background: var(--text-faint); pointer-events: none; }
  &:active { transform: scale(0.98); }
}
/*
 * Sold-state CTA — visually inert (v3 P1, spec §1.3).
 *
 * Applied alongside .chat-btn for both buyer view ("已评价 / Already
 * rated") and seller view ("已售出 / Sold"). Without this override the
 * disabled view inherits --shadow-cta (terracotta glow) from the base
 * .chat-btn rule and reads as "alive / actionable", contradicting the
 * sold semantics. Source order beats specificity here (this rule is
 * later in the stylesheet than .chat-btn), so no !important needed.
 *
 * Changes vs. previous:
 *   · box-shadow: --shadow-cta → --shadow-soft  (drop brand glow)
 *   · opacity: 1 → 0.55                          (canonical disabled)
 *   · cursor: default → not-allowed              (a11y affordance)
 *   · pointer-events: none                       (prevent accidental tap)
 *   · text color: --text-muted → --ink-soft      (legible under 0.55 opacity)
 * The &:active rule is dropped — pointer-events: none makes it unreachable.
 */
.chat-btn-disabled {
  background: var(--bg-inset);
  box-shadow: var(--shadow-soft);
  opacity: 0.55;
  cursor: not-allowed;
  pointer-events: none;
  text { color: var(--ink-soft); }
}

/* ========== Loading ========== */
.loading-page {
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  height: 100vh; gap: 12px;
}
.loading-spinner {
  width: 24px; height: 24px;
  border: 2.5px solid var(--bg-inset); border-top-color: var(--text-primary);
  border-radius: 50%; animation: spin 0.7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.loading-text { font-size: 13px; color: var(--text-faint); }

.not-found-page {
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  height: 100vh; gap: 10px; padding: 0 40px; text-align: center;
  background: var(--bg-elev-1);
}
.nf-back {
  position: absolute; top: calc(14px + var(--status-bar-height, env(safe-area-inset-top, 0px))); left: 14px;
  width: 36px; height: 36px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: var(--bg-subtle); cursor: pointer;
}
.nf-arrow { width: 9px; height: 9px; border-left: 2px solid var(--accent-primary); border-bottom: 2px solid var(--accent-primary); transform: rotate(45deg); margin-left: 3px; }
.nf-icon {
  width: 60px; height: 60px; border: 3px solid var(--border-strong);
  border-radius: 50%; position: relative; margin-bottom: 8px;
  &::before {
    content: ''; position: absolute; top: 50%; left: 14px; right: 14px; height: 3px;
    background: var(--border-strong);
    transform: translateY(-50%);
  }
}
.nf-title { font-size: 17px; font-weight: 700; color: var(--text-primary); }
.nf-sub { font-size: 14px; color: var(--text-muted); line-height: 1.5; max-width: 280px; }
.nf-btn {
  margin-top: 20px; padding: 12px 28px; background: var(--accent-primary);
  color: #fff; border-radius: 22px; font-size: 14px; font-weight: 600;
  cursor: pointer;
  &:active { opacity: 0.8; }
}

/* ========== Desktop ========== */
@media (min-width: 768px) {
  /* Sidebar rail (.has-sidebar) reserves the left via padding-left; the
     page box is rail + 640 reading column, centered, so the content sits
     in a 640 column right of the rail (box-sizing:border-box from
     .has-sidebar makes max-width include the padding). */
  .page { max-width: calc(640px + var(--sidebar-w, 240px)); margin: 0 auto; }
  /*
   * Don't hard-set height here either. The inline :style aspect-ratio
   * handles it, and the 70vh cap keeps the hero from eating the whole
   * above-the-fold on big screens.
   */
  .info-card { border-radius: 0; }
  /* Fixed bars span the post-rail band and center within it at 640 —
     the same pattern as publish's submit bar. */
  .action-bar {
    left: var(--sidebar-w, 240px); right: 0; transform: none;
    width: auto; max-width: 640px; margin-left: auto; margin-right: auto;
  }
  .rating-sheet {
    left: var(--sidebar-w, 240px); right: 0; width: auto; max-width: 640px;
    margin-left: auto; margin-right: auto; transform: translateY(100%);
  }
  .rating-sheet.open { transform: translateY(0); }
}
</style>
