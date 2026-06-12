<template>
  <view class="u-empty-art" :style="artStyle">
    <view v-if="artHTML" class="u-empty-art-svg" v-html="artHTML"></view>
  </view>
</template>

<script setup lang="ts">
/**
 * UEmptyArt — renders one of the warm line-art empty-state illustrations at a
 * fixed size. Lines inherit `color` (theme-adaptive via the muted-ink default),
 * the terracotta accent is baked into the artwork.
 *
 *   <UEmptyArt name="favorites" />
 *   <UEmptyArt name="bag" :size="120" />
 *
 * Unknown name → renders nothing (safe default, no error).
 */
import { computed } from 'vue'
import { ILLUSTRATIONS } from './illustrations/registry'

const props = withDefaults(defineProps<{
  name: string
  size?: number
  color?: string
}>(), {
  size: 128,
  color: 'var(--text-muted)',
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
.u-empty-art-svg,
.u-empty-art-svg :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
}
</style>
