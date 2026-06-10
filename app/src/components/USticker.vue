<template>
  <view class="u-sticker" :style="{ width: size + 'px', height: size + 'px' }">
    <view class="u-sticker-svg" v-html="svg"></view>
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
</style>
