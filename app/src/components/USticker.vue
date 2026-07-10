<template>
  <view class="u-sticker" :style="{ width: size + 'px', height: size + 'px' }">
    <!-- #ifdef H5 -->
    <view class="u-sticker-svg" v-html="svg"></view>
    <!-- #endif -->
    <!-- #ifndef H5 -->
    <view v-if="bgStyle" class="u-sticker-img" :style="bgStyle"></view>
    <!-- #endif -->
  </view>
</template>

<script setup lang="ts">
/**
 * USticker — renders one self-drawn sticker from the sticker registry.
 * Solid-fill artwork (no currentColor), so no color prop — stickers keep
 * their palette in both themes.
 */
import { computed } from 'vue'
import { STICKERS, type StickerName } from './stickers/registry'

const props = withDefaults(defineProps<{
  name: StickerName
  size?: number
}>(), {
  size: 32,
})

const svg = computed(() => STICKERS[props.name] || '')

/*
 * mp path: v-html → <rich-text> whose whitelist drops <svg>, so stickers
 * render as empty space. Painted as a CSS background-image data URI instead:
 * the multicolor artwork can't use UIcon's mask trick (a mask is single-
 * color), and WeChat's <image> component doesn't list SVG among its
 * supported formats — CSS background rendering is the same webview path
 * UIcon's mask already proves out. The registry strings lack xmlns, which
 * standalone SVG documents require. Quoted url("...") because
 * encodeURIComponent leaves parens unescaped.
 */
const bgStyle = computed(() => {
  if (!svg.value) return ''
  const uri = `data:image/svg+xml,${encodeURIComponent(
    svg.value.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '),
  )}`
  return `background-image:url("${uri}");background-size:100% 100%;background-repeat:no-repeat`
})
</script>

<style scoped>
.u-sticker {
  display: inline-flex;
  flex-shrink: 0;
  line-height: 0;
}
.u-sticker-svg {
  width: 100%;
  height: 100%;
  display: block;
}
.u-sticker-svg :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
}
.u-sticker-img {
  width: 100%;
  height: 100%;
  display: block;
}
</style>
