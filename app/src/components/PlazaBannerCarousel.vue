<template>
  <view v-if="loading" class="banner-wrap">
    <view class="banner-skeleton"></view>
  </view>

  <view v-else-if="banners.length > 0" class="banner-wrap">
    <swiper
      class="banner-swiper"
      :autoplay="banners.length > 1"
      :interval="interval"
      :duration="450"
      :circular="banners.length > 1"
      :indicator-dots="banners.length > 1"
      indicator-color="rgba(255,255,255,0.45)"
      indicator-active-color="#ffffff"
    >
      <swiper-item
        v-for="(b, i) in banners"
        :key="b.id"
      >
        <view class="banner-slide" @click="onTap(b)">
          <image
            :src="b.image_url"
            class="banner-img"
            mode="aspectFill"
            :lazy-load="i > 0"
          />
          <view v-if="titleOf(b)" class="banner-label">
            <text>{{ titleOf(b) }}</text>
          </view>
        </view>
      </swiper-item>
    </swiper>
  </view>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useBanners, type Banner } from '../composables/useBanners'
import { useI18n } from '../composables/useI18n'

interface Props {
  interval?: number
}
withDefaults(defineProps<Props>(), { interval: 5000 })

const { banners, loading, fetchBanners } = useBanners()
const { lang } = useI18n()

onMounted(fetchBanners)

function titleOf(b: Banner): string {
  if (lang.value === 'zh') return b.title_zh || b.title_en || b.title || ''
  return b.title_en || b.title_zh || b.title || ''
}

function onTap(b: Banner) {
  const url = b.target_url
  if (!url) return
  if (/^https?:\/\//i.test(url)) {
    // #ifdef H5
    if (typeof window !== 'undefined') window.open(url, '_blank')
    // #endif
    return
  }
  uni.navigateTo({ url }).catch(() => {
    uni.switchTab({ url }).catch(() => {})
  })
}
</script>

<style lang="scss" scoped>
.banner-wrap {
  padding: 8px 16px 4px;
  width: 100%;
  box-sizing: border-box;
}

/* 5:2 aspect ratio, derived dynamically from viewport width.
   Using aspect-ratio keeps the ratio intact while the phone rotates
   or on desktop where the plaza is capped at 480px. */
.banner-swiper {
  width: 100%;
  aspect-ratio: 5 / 2;
  border-radius: 12px;
  overflow: hidden;
  background: var(--bg-subtle);
}

.banner-slide {
  position: relative;
  width: 100%;
  height: 100%;
  cursor: pointer;
  &:active { opacity: 0.9; }
}

.banner-img {
  width: 100%;
  height: 100%;
  display: block;
}

.banner-label {
  position: absolute;
  left: 0; right: 0; bottom: 0;
  padding: 22px 14px 14px;
  background: linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.42) 100%);
  pointer-events: none;
  text {
    font-size: 13px; color: #fff; font-weight: 600;
    letter-spacing: 0.02em;
  }
}

.banner-skeleton {
  width: 100%;
  aspect-ratio: 5 / 2;
  border-radius: 12px;
  background: linear-gradient(90deg, #eaeaef 0%, #f2f2f7 50%, #eaeaef 100%);
  background-size: 200% 100%;
  animation: shimmer 1.4s ease-in-out infinite;
}
@keyframes shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
</style>
