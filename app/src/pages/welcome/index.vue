<template>
  <view class="page" :class="mpThemeClass" :style="mpChrome">
    <swiper
      class="swiper focusable"
      :current="current"
      role="region"
      aria-roledescription="carousel"
      :aria-label="t('welcome.carouselLabel')"
      aria-describedby="welcome-carousel-instructions"
      aria-keyshortcuts="ArrowLeft ArrowRight"
      tabindex="0"
      @change="onSlideChange"
      @keydown="onCarouselKeydown"
    >
      <swiper-item
        v-for="(slide, i) in slides"
        :key="i"
        role="group"
        aria-roledescription="slide"
        :aria-label="t('welcome.slidePosition', { current: i + 1, total: slides.length })"
        :aria-hidden="current === i ? 'false' : 'true'"
      >
        <view class="slide">
          <view class="slide-art"><image :src="slide.img" alt="" mode="aspectFit" class="slide-img" /></view>
          <text class="slide-title">{{ slide.title }}</text>
          <text class="slide-desc">{{ slide.desc }}</text>
        </view>
      </swiper-item>
    </swiper>
    <text id="welcome-carousel-instructions" class="sr-only">{{ t('welcome.carouselHint') }}</text>
    <text class="sr-only" role="status" aria-live="polite" aria-atomic="true">{{ currentSlideStatus }}</text>

    <view class="dots" aria-hidden="true">
      <view v-for="(_, i) in slides" :key="i" :class="['dot', { active: current === i }]"></view>
    </view>

    <view class="bottom">
      <view v-if="current < slides.length - 1" class="skip-btn" role="button" :aria-label="t('welcome.skip')" @click="finish">
        <text class="skip-btn-label">{{ t('welcome.skip') }}</text>
      </view>
      <view v-else class="start-btn" role="button" :aria-label="t('welcome.start')" @click="finish">
        <text class="start-btn-label">{{ t('welcome.start') }}</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { mpChromeVars, mpThemeClass } from '../../composables/useMpChrome'
const mpChrome = mpChromeVars()
import { ref, computed } from 'vue'
import { useI18n } from '../../composables/useI18n'

const { t } = useI18n()
const current = ref(0)

/*
 * Reactive: was a plain array literal which called t() once at setup
 * time and froze the returned strings. Two problems on mp-weixin:
 *   1. If setLang() flips the UI lang while the user is still on
 *      welcome, slides don't re-render.
 *   2. If useI18n()'s lazy ensureLangInit() hasn't populated
 *      currentLang yet when setup() runs (a timing race we've seen
 *      on WeChat 3.15.x cold starts), t() returns the raw key
 *      string (e.g. "welcome.t1") and that string is permanently
 *      baked into the array. Slides then render as the raw keys.
 * computed() both defers evaluation to render time AND makes slides
 * re-run on currentLang changes.
 */
const slides = computed(() => [
  { img: '/static/welcome/discover.png', title: t('welcome.t1'), desc: t('welcome.d1') },
  { img: '/static/welcome/meetup.png', title: t('welcome.t2'), desc: t('welcome.d2') },
  { img: '/static/welcome/safe.png', title: t('welcome.t3'), desc: t('welcome.d3') },
])
const currentSlideStatus = computed(() => {
  const slide = slides.value[current.value] || slides.value[0]
  return t('welcome.slideStatus', {
    current: current.value + 1,
    total: slides.value.length,
    title: slide?.title || '',
  })
})

function setCurrentSlide(next: number) {
  current.value = Math.max(0, Math.min(slides.value.length - 1, next))
}

function onSlideChange(event: { detail?: { current?: number } }) {
  const next = Number(event.detail?.current)
  if (Number.isInteger(next)) setCurrentSlide(next)
}

function onCarouselKeydown(event: KeyboardEvent) {
  let next = current.value
  if (event.key === 'ArrowLeft') next -= 1
  else if (event.key === 'ArrowRight') next += 1
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = slides.value.length - 1
  else return
  event.preventDefault()
  setCurrentSlide(next)
}

function finish() {
  try { uni.setStorageSync('welcomed', '1') } catch {}
  uni.reLaunch({ url: '/pages/index/index' })
}
</script>

<style lang="scss" scoped>
.page {
  height: 100vh; height: 100dvh; background: var(--bg-page); display: flex;
  flex-direction: column; max-width: 480px; margin: 0 auto;
}
.swiper { flex: 1; }
.slide {
  height: 100%; display: flex; flex-direction: column;
  align-items: center; justify-content: center; padding: 0 40px; gap: 16px;
}
.slide-art {
  width: 248px; height: 248px;
  border-radius: 22px; overflow: hidden;
  background: #f8f3e8;
  box-shadow: var(--shadow-soft);
  margin-bottom: 4px;
}
.slide-img { width: 100%; height: 100%; display: block; }
.slide-title {
  font-family: var(--font-serif); font-size: 22px; font-weight: 600;
  letter-spacing: -0.02em; color: var(--text-primary); text-align: center;
}
.slide-desc { font-size: 14px; color: var(--text-muted); text-align: center; line-height: 1.6; }

.dots { display: flex; justify-content: center; gap: 8px; padding: 16px 0; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--border-strong); transition: all 0.2s; }
.dot.active { width: 24px; border-radius: 4px; background: var(--accent-primary); }

.bottom { padding: 16px 24px 40px; }
.skip-btn {
  text-align: center; padding: 14px;
  .skip-btn-label { font-size: 15px; color: var(--text-muted); }
}
.start-btn {
  background: var(--accent-primary); border-radius: 24px; padding: 14px; text-align: center;
  box-shadow: var(--shadow-cta);
  .start-btn-label { font-size: 15px; font-weight: 600; color: #fff; }
}
</style>
