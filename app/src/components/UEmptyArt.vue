<template>
  <view class="u-empty-art" :style="artStyle">
    <image v-if="hasImg" :src="imgSrc" alt="" aria-hidden="true" mode="aspectFill" class="u-empty-img" />
  </view>
</template>

<script setup lang="ts">
/**
 * UEmptyArt — warm hand-drawn empty-state illustrations.
 *
 *   <UEmptyArt name="favorites" />
 *   <UEmptyArt name="bag" :size="120" />
 *
 * Uses the project's hand-drawn raster assets on every platform and theme.
 * Besides compiling reliably on mini-programs, this avoids injecting raw SVG
 * markup into the page. In dark mode the warm paper ground intentionally reads
 * as a small illustrated card rather than a transparent line drawing.
 *
 * Unknown name → renders nothing (safe default, no error).
 */
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  name: string
  size?: number
  color?: string
}>(), {
  size: 128,
  color: 'var(--text-muted)',
})

const PNG_SET = new Set(['bag', 'search', 'messages', 'favorites', 'posts', 'following', 'history'])
const hasImg = computed(() => PNG_SET.has(props.name))
const imgSrc = computed(() => `/static/empty/${props.name}.png`)
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
  border-radius: 18%;
}
</style>
