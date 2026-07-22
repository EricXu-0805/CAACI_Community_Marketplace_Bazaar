<template>
  <image
    :key="remoteSrc || fallback"
    class="u-avatar-image"
    :src="resolvedSrc"
    :alt="alt"
    mode="aspectFill"
    :lazy-load="lazy"
    :loading="lazy ? 'lazy' : 'eager'"
    @error="onImageError"
  />
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { safeAvatarThumbUrl } from '../utils/publicResource'

/**
 * Display-only avatar boundary.
 *
 * Remote profile images are accepted only when their storage path belongs to
 * the exact profile being rendered. The 96px transform avoids downloading a
 * full listing-sized upload into small list rows, while the local design-system
 * avatar remains available for invalid URLs and real network/image failures.
 * Local edit/onboarding previews intentionally do not use this component.
 */
const props = withDefaults(defineProps<{
  src?: string | null
  owner?: string | null
  fallback: string
  alt?: string
  lazy?: boolean
}>(), {
  src: '',
  owner: null,
  alt: '',
  lazy: false,
})

const remoteFailed = ref(false)
const remoteSrc = computed(() => safeAvatarThumbUrl(props.src, props.owner))
const resolvedSrc = computed(() => (
  remoteFailed.value ? props.fallback : (remoteSrc.value || props.fallback)
))

watch([() => props.src, () => props.owner], () => {
  remoteFailed.value = false
})

function onImageError() {
  // Avoid an error loop if the bundled fallback itself cannot be resolved.
  if (remoteSrc.value && resolvedSrc.value === remoteSrc.value) {
    remoteFailed.value = true
  }
}
</script>

<style scoped>
.u-avatar-image {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: inherit;
}
</style>
