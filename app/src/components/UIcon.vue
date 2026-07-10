<template>
  <!-- #ifdef H5 -->
  <view class="u-icon" :style="iconStyle">
    <view v-if="iconHTML" class="u-icon-svg" v-html="iconHTML"></view>
  </view>
  <!-- #endif -->
  <!-- #ifndef H5 -->
  <view class="u-icon" :style="maskStyle"></view>
  <!-- #endif -->
</template>

<script setup lang="ts">
/**
 * UIcon — renders one of the registry icons at a fixed size, optionally
 * tinted to a token color or hex.
 *
 * Usage:
 *   <UIcon name="home" />                        // 24px, regular weight, currentColor
 *   <UIcon name="heart" weight="filled" />       // 24px, filled
 *   <UIcon name="bell" size="lg" color="brand" />  // 32px, tinted to var(--brand)
 *   <UIcon name="search" color="#FF0000" />      // 24px, tinted to hex
 *
 * If `name-weight` not in registry, falls back to `name-regular`. If that's
 * also missing, renders nothing (no error — safe default).
 */
import { computed } from 'vue'
import { ICONS, type IconName, type IconWeight } from './icons/registry'

const props = withDefaults(defineProps<{
  name: IconName | string
  weight?: IconWeight
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  color?: string
}>(), {
  weight: 'regular',
  size: 'md',
  color: 'currentColor',
})

// xl (48) added for hero/empty-state contexts (welcome slides, empty lists)
// where a 32px chrome icon reads too small.
const SIZES: Record<string, number> = { xs: 16, sm: 20, md: 24, lg: 32, xl: 48 }

const iconHTML = computed(() => {
  const key = `${props.name}-${props.weight}`
  return ICONS[key] || ICONS[`${props.name}-regular`] || ''
})

const resolvedColor = computed(() =>
  props.color.startsWith('#') || props.color === 'currentColor'
    ? props.color
    : `var(--${props.color})`,
)

const iconStyle = computed(() => ({
  width: `${SIZES[props.size]}px`,
  height: `${SIZES[props.size]}px`,
  color: resolvedColor.value,
}))

/*
 * mp path: WeChat compiles v-html to <rich-text>, whose tag whitelist drops
 * <svg> — every icon renders blank. Instead paint the glyph as a CSS mask
 * over background-color. Inside a standalone SVG image currentColor falls
 * back to opaque black, which is exactly what a mask needs; background-color
 * then carries ALL the existing color semantics (currentColor inheritance,
 * var(--token), hex) unchanged. Built as a style STRING so the -webkit-
 * prefixed keys survive Vue's style-object normalization.
 */
const maskStyle = computed(() => {
  const size = `${SIZES[props.size]}px`
  const svg = iconHTML.value
  if (!svg) return `width:${size};height:${size}`
  const uri = `url("data:image/svg+xml,${encodeURIComponent(
    svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '),
  )}")`
  return `width:${size};height:${size};background-color:${resolvedColor.value};`
    + `-webkit-mask-image:${uri};-webkit-mask-size:100% 100%;-webkit-mask-repeat:no-repeat;`
    + `mask-image:${uri};mask-size:100% 100%;mask-repeat:no-repeat`
})
</script>

<style scoped>
.u-icon {
  display: inline-flex;
  flex-shrink: 0;
  vertical-align: middle;
  line-height: 0;
}
.u-icon-svg {
  width: 100%;
  height: 100%;
  display: block;
}
.u-icon-svg :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
}
</style>
