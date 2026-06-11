<template>
  <view class="u-badge" :class="`u-badge--${variant}`">
    <text><slot /></text>
  </view>
</template>

<script setup lang="ts">
/**
 * UBadge — small single-text status pill for item/post cards.
 *
 * Visual primitive extracted from the duplicated per-page condition-badge
 * CSS (M-series follow-up). Positioning is the caller's job (pass a class);
 * UBadge owns only the pill shape + variant color. Renders identically to
 * the prior `.badge .badge-*` pills.
 *
 * Variants are added consumer-driven as each page migrates — no unused
 * variants. Today: condition (new · mint=like-new · defect · reserved) +
 * official · illini (post/plaza pills; 1px 6px / weight 700 — verbatim lift).
 */
defineProps<{
  variant: 'new' | 'mint' | 'defect' | 'reserved' | 'official' | 'illini'
}>()
</script>

<style scoped>
.u-badge {
  padding: 2px 7px;
  border-radius: var(--radius-xs);
  font-size: 10px;
  font-weight: 600;
}
/* Condition pills over card images — frosted-dark glass (matching the
   image-count badge) with a small semantic-colored status dot. The dot
   carries the meaning so the white label stays legible over any photo
   or the warm placeholder, instead of a loud saturated rectangle.
   backdrop-filter degrades to the solid rgba on mp-weixin. */
.u-badge--new,
.u-badge--mint,
.u-badge--defect,
.u-badge--reserved {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 8px 3px 7px;
  border-radius: var(--radius-pill);
  background: rgba(22, 17, 12, 0.52);
  backdrop-filter: blur(8px) saturate(140%);
  -webkit-backdrop-filter: blur(8px) saturate(140%);
  color: #fff;
  font-weight: 600;
  letter-spacing: 0.04em;
}
.u-badge--new::before,
.u-badge--mint::before,
.u-badge--defect::before,
.u-badge--reserved::before {
  content: ''; width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0;
}
.u-badge--new::before      { background: var(--brand); }
.u-badge--mint::before     { background: var(--success); }
.u-badge--defect::before   { background: var(--danger); }
.u-badge--reserved::before { background: var(--warning); }
/* post/plaza pills (1px 6px, weight 700, #fff on fill). official = campus-orange
   per D1 (university-identity), matching reconcile's .badge-official recolor. */
.u-badge--official { background: var(--campus-orange); color: #fff; padding: 1px 6px; font-weight: 700; }
.u-badge--illini   { background: var(--campus-blue);   color: #fff; padding: 1px 6px; font-weight: 700; }
</style>
