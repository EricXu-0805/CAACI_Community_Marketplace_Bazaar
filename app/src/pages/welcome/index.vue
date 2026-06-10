<template>
  <view class="page">
    <swiper class="swiper" :current="current" @change="current = $event.detail.current">
      <swiper-item v-for="(slide, i) in slides" :key="i">
        <view class="slide">
          <view class="slide-icon"><UIcon :name="slide.icon" size="xl" color="brand" /></view>
          <text class="slide-title">{{ slide.title }}</text>
          <text class="slide-desc">{{ slide.desc }}</text>
        </view>
      </swiper-item>
    </swiper>

    <view class="dots">
      <view v-for="(_, i) in slides" :key="i" :class="['dot', { active: current === i }]"></view>
    </view>

    <view class="bottom">
      <view v-if="current < slides.length - 1" class="skip-btn" @click="finish">
        <text>{{ t('welcome.skip') }}</text>
      </view>
      <view v-else class="start-btn" @click="finish">
        <text>{{ t('welcome.start') }}</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from '../../composables/useI18n'
import UIcon from '../../components/UIcon.vue'

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
  { icon: 'tag', title: t('welcome.t1'), desc: t('welcome.d1') },
  { icon: 'chat-bubble', title: t('welcome.t2'), desc: t('welcome.d2') },
  { icon: 'shield', title: t('welcome.t3'), desc: t('welcome.d3') },
])

function finish() {
  try { uni.setStorageSync('welcomed', '1') } catch {}
  uni.reLaunch({ url: '/pages/index/index' })
}
</script>

<style lang="scss" scoped>
.page {
  height: 100vh; background: var(--bg-elev-1); display: flex;
  flex-direction: column; max-width: 480px; margin: 0 auto;
}
.swiper { flex: 1; }
.slide {
  height: 100%; display: flex; flex-direction: column;
  align-items: center; justify-content: center; padding: 0 40px; gap: 16px;
}
.slide-icon { font-size: 64px; }
.slide-title { font-size: 22px; font-weight: 700; color: var(--text-primary); text-align: center; }
.slide-desc { font-size: 14px; color: var(--text-muted); text-align: center; line-height: 1.6; }

.dots { display: flex; justify-content: center; gap: 8px; padding: 16px 0; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--border-strong); transition: all 0.2s; }
.dot.active { width: 24px; border-radius: 4px; background: var(--accent-primary); }

.bottom { padding: 16px 24px 40px; }
.skip-btn {
  text-align: center; padding: 14px;
  text { font-size: 15px; color: var(--text-muted); }
}
.start-btn {
  background: var(--accent-primary); border-radius: 24px; padding: 14px; text-align: center;
  text { font-size: 15px; font-weight: 600; color: #fff; }
  &:active { opacity: 0.8; }
}
</style>
