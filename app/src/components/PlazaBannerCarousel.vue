<template>
  <view v-if="loading" class="banner-wrap">
    <view class="banner-skeleton"></view>
  </view>

  <view v-else-if="banners.length > 0" class="banner-wrap">
    <!--
      Auto-advancing content needs a pause mechanism (2.2.2) and a keyboard
      equivalent: nothing here handled arrow keys, and every slide's link
      stayed in the tab order whether or not it was the visible one, so a
      keyboard user could focus a banner that had already scrolled away.
      Autoplay stops while the carousel is hovered or holds focus.
    -->
    <swiper
      class="banner-swiper"
      :autoplay="banners.length > 1 && !paused"
      :interval="interval"
      :duration="450"
      :circular="banners.length > 1"
      :indicator-dots="banners.length > 1"
      indicator-color="rgba(255,255,255,0.45)"
      indicator-active-color="#ffffff"
      role="region"
      aria-roledescription="carousel"
      :aria-label="t('admin.plazaBanners')"
      aria-keyshortcuts="ArrowLeft ArrowRight"
      tabindex="0"
      :current="current"
      @change="onSlideChange"
      @keydown="onCarouselKeydown"
      @mouseenter="paused = true"
      @mouseleave="paused = false"
      @focusin="paused = true"
      @focusout="paused = false"
    >
      <swiper-item
        v-for="(b, i) in banners"
        :key="b.id"
        role="group"
        aria-roledescription="slide"
        :aria-label="t('welcome.slidePosition', { current: i + 1, total: banners.length })"
        :aria-hidden="current === i ? 'false' : 'true'"
      >
        <view
          class="banner-slide"
          :role="b.target_url ? 'button' : undefined"
          :tabindex="b.target_url && current === i ? 0 : undefined"
          :aria-label="b.target_url ? (titleOf(b) || t('admin.plazaBanners')) : undefined"
          @click="onTap(b)"
          @keydown.enter.prevent="onTap(b)"
          @keydown.space.prevent="onTap(b)"
        >
          <image
            :src="b.image_url"
            :alt="b.target_url ? '' : (titleOf(b) || t('admin.plazaBanners'))"
            :aria-hidden="b.target_url ? 'true' : undefined"
            class="banner-img"
            mode="aspectFill"
            :lazy-load="i > 0"
          />
          <view v-if="titleOf(b)" class="banner-label">
            <text class="banner-label-text">{{ titleOf(b) }}</text>
          </view>
        </view>
      </swiper-item>
    </swiper>
  </view>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useBanners, type Banner } from '../composables/useBanners'
import { useI18n } from '../composables/useI18n'

interface Props {
  interval?: number
}
withDefaults(defineProps<Props>(), { interval: 5000 })

const { banners, loading, fetchBanners } = useBanners()
const { lang, t } = useI18n()

const current = ref(0)
const paused = ref(false)

function onSlideChange(event: any) {
  const next = Number(event?.detail?.current)
  if (Number.isInteger(next) && next >= 0 && next < banners.value.length) current.value = next
}

function onCarouselKeydown(event: KeyboardEvent) {
  const total = banners.value.length
  if (total < 2) return
  let next = current.value
  if (event.key === 'ArrowLeft') next -= 1
  else if (event.key === 'ArrowRight') next += 1
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = total - 1
  else return
  event.preventDefault()
  current.value = (next + total) % total
}

onMounted(fetchBanners)

function titleOf(b: Banner): string {
  if (lang.value === 'zh') return b.title_zh || b.title_en || b.title || ''
  return b.title_en || b.title_zh || b.title || ''
}

function onTap(b: Banner) {
  const url = b.target_url
  if (!url) return
  if (/^https:\/\//i.test(url)) {
    // #ifdef H5
    if (typeof window !== 'undefined') {
      const opened = window.open(url, '_blank', 'noopener,noreferrer')
      if (opened) opened.opener = null
    }
    // #endif
    // #ifndef H5
    /* mp can't open external URLs (webview needs the domain whitelisted in
       the MP console) — copy the link so the tap isn't silently dead. */
    uni.setClipboardData({
      data: url,
      success: () => uni.showToast({ title: t('detail.linkCopied'), icon: 'success' }),
    })
    // #endif
    return
  }
  // The admin API accepts only HTTPS links or canonical uni-app routes. Keep a
  // client-side guard too because historical/directly-written rows may predate
  // that validation.
  if (!url.startsWith('/pages/') || /[\\#]/.test(url) || /(?:^|\/)\.\.(?:\/|$)/.test(url)) return
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
  &:focus-visible { outline: 3px solid var(--brand); outline-offset: -3px; }
}

/*
 * Dark-mode saturation tint (v3 P1, spec §1.5).
 *
 * Banner images are user-uploaded promo graphics — typically bright,
 * highly-saturated marketing imagery. On the deepened dark canvas
 * (#15130F after P1.1) those colors clash and visually punch through
 * the warm-paper mood. Overlay a canvas-tinted gradient (top 0.35α,
 * bottom 0.1α) on the ::after of each slide so the upper half mutes
 * but the bottom — where .banner-label sits — keeps the caption
 * legible. Uses rgba(var(--canvas-rgb), …) so the tint tracks any
 * future canvas color updates without a hardcoded hex sync drift.
 * Light mode untouched — banner images render at full saturation.
 */
/* #ifdef H5 */
[data-theme="dark"] .banner-slide::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(
    rgba(var(--canvas-rgb), 0.35),
    rgba(var(--canvas-rgb), 0.1)
  );
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .banner-slide::after {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: linear-gradient(
      rgba(var(--canvas-rgb), 0.35),
      rgba(var(--canvas-rgb), 0.1)
    );
  }
}
/* #endif */
/* #ifdef MP-WEIXIN */
/* mp flips via the .theme-dark class on the page root (see App.vue); WXSS
   can't match the H5 [data-theme] / :root:not(...) guards above. The
   .theme-dark ancestor is the plaza page root, outside this component's
   scope — same cascade the H5 [data-theme] rule relies on. */
.theme-dark .banner-slide::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(
    rgba(var(--canvas-rgb), 0.35),
    rgba(var(--canvas-rgb), 0.1)
  );
}
/* #endif */

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
}
/*
 * Explicit class instead of nested `text { }` so the compiled output
 * stays inside the component-WXSS whitelist (.class only; tag name
 * selectors are banned inside isComponent:true SFCs). See the same
 * pattern in CustomTabBar.badge-count.
 */
.banner-label-text {
  font-size: 13px; color: #fff; font-weight: 600;
  letter-spacing: 0.02em;
}

.banner-skeleton {
  width: 100%;
  aspect-ratio: 5 / 2;
  border-radius: 12px;
  /*
   * Theme-aware skeleton surface (v3.5 launch-blocker).
   *
   * Was hardcoded light-mode hex (#eaeaef / #f2f2f7), which flashed
   * as bright stripes on the deepened dark canvas (#15130F) during
   * banner load — see v3.5 backlog in v3_p1_dark_mode_shipped.md.
   *
   * Both --bg-subtle and --paper-2 are legacy aliases of --bg-elev-2
   * (per v3 P1 alias extension) and resolve to the same value within
   * each theme, so the gradient effectively renders as a solid block:
   *   light → #F0E9DA (warm parchment)
   *   dark  → #36322B (warm-deep)
   * That trades the original shimmer animation for a flat themed
   * placeholder. Acceptable tradeoff for the launch-blocker — the
   * bright-stripes-on-dark bug is fully resolved either way, and
   * background-size + animation: shimmer are retained so a future
   * spec change to point at two ΔE-distinct tokens (e.g. --bg-subtle
   * + --bg-inset) lights the shimmer back up without a code edit.
   */
  background: linear-gradient(
    90deg,
    var(--bg-subtle) 0%,
    var(--paper-2) 50%,
    var(--bg-subtle) 100%
  );
  background-size: 200% 100%;
  animation: shimmer 1.4s ease-in-out infinite;
}
@keyframes shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
</style>
