<template>
  <view
    class="osm-attribution"
    role="link"
    tabindex="0"
    :aria-label="t('publish.osmAttributionLabel')"
    @click="openAttribution"
    @keyup.enter="openAttribution"
    @keyup.space.prevent="openAttribution"
  >
    <text class="osm-attribution__text">{{ t('publish.osmAttribution') }}</text>
  </view>
</template>

<script setup lang="ts">
import { useI18n } from '../composables/useI18n'

const { t } = useI18n()
const ATTRIBUTION_URL = 'https://www.openstreetmap.org/copyright'

function openAttribution() {
  // #ifdef H5
  if (typeof window !== 'undefined') {
    const opened = window.open(ATTRIBUTION_URL, '_blank', 'noopener,noreferrer')
    if (opened) opened.opener = null
  }
  // #endif
  // #ifndef H5
  // Mini Programs cannot open arbitrary external URLs unless a web-view domain
  // is pre-approved. Copy the canonical copyright URL so the attribution is
  // still actionable instead of presenting a dead link.
  uni.setClipboardData({
    data: ATTRIBUTION_URL,
    success: () => uni.showToast({ title: t('detail.linkCopied'), icon: 'success' }),
  })
  // #endif
}
</script>

<style lang="scss" scoped>
.osm-attribution {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  margin-top: 4px;
  padding: 2px 0;
  cursor: pointer;
  outline: none;
}

.osm-attribution:focus-visible .osm-attribution__text {
  outline: 2px solid var(--accent-primary);
  outline-offset: 3px;
  border-radius: 2px;
}

.osm-attribution__text {
  color: var(--text-subtle);
  font-size: 11px;
  line-height: 1.4;
  text-decoration: underline;
  text-underline-offset: 2px;
}
</style>
