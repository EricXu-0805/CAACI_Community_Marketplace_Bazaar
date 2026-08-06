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
/*
 * Required credit, not a feature. ODbL makes this non-optional wherever a
 * reverse-geocoded string is shown, and smoke/osm-attribution-boundary keeps
 * it wired into both listing flows — so it stays, but it reads as a caption
 * rather than a call to action: it inherits the 16px form gutter of the
 * control it credits, and drops the always-on underline that made it look
 * like a stray link stranded at the screen edge.
 */
.osm-attribution {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  margin: 2px 16px 0;
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
  color: var(--text-faint, var(--text-subtle));
  font-size: 10px;
  line-height: 1.4;
  text-decoration: none;
  text-underline-offset: 2px;
}

/* Underline on demand keeps the link discoverable for anyone who reaches for
   it — pointer hover, keyboard focus — without it shouting at rest. */
.osm-attribution:hover .osm-attribution__text,
.osm-attribution:focus-visible .osm-attribution__text {
  text-decoration: underline;
}
</style>
