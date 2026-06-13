<template>
  <view class="u-empty-art" :style="artStyle">
    <image v-if="useImage" :src="imgSrc" mode="aspectFit" class="u-empty-img" />
    <view v-else-if="artHTML" class="u-empty-art-svg" v-html="artHTML"></view>
  </view>
</template>

<script setup lang="ts">
/**
 * UEmptyArt — warm hand-drawn empty-state illustrations.
 *
 *   <UEmptyArt name="favorites" />
 *   <UEmptyArt name="bag" :size="120" />
 *
 * Two render paths, chosen so each surface gets the best-looking art:
 *   · H5 light + mp-weixin → the hand-drawn PNG in static/empty/ (cream
 *     ground blends into the light canvas; on mp this is the FIRST time
 *     empties show art at all — the inline-SVG path below compiles to an
 *     empty rich-text node on mini-program).
 *   · H5 dark → the inline currentColor line-art (registry.ts), which
 *     adapts to the graphite canvas. A cream-ground raster would sit on
 *     dark as a bright block, so dark deliberately keeps the vector.
 *
 * Unknown name → renders nothing (safe default, no error).
 */
import { computed } from 'vue'
import { ILLUSTRATIONS } from './illustrations/registry'
import { useTheme } from '../composables/useTheme'

const props = withDefaults(defineProps<{
  name: string
  size?: number
  color?: string
}>(), {
  size: 128,
  color: 'var(--text-muted)',
})

const { isDark } = useTheme()

const PNG_SET = new Set(['bag', 'search', 'messages', 'favorites', 'posts', 'following', 'history'])
const hasImg = computed(() => PNG_SET.has(props.name))
const imgSrc = computed(() => `/static/empty/${props.name}.png`)

const useImage = computed(() => {
  if (!hasImg.value) return false
  let v = true
  // #ifdef H5
  v = !isDark.value
  // #endif
  return v
})

const artHTML = computed(() => ILLUSTRATIONS[props.name] || '')
const artStyle = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
  color: props.color,
}))
</script>

<style scoped>
.u-empty-art {
  display: inline-flex;
  flex-shrink: 0;
  line-height: 0;
}
.u-empty-img {
  width: 100%;
  height: 100%;
}
.u-empty-art-svg,
.u-empty-art-svg :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
}
</style>
