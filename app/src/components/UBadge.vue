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
.u-badge--new      { background: var(--brand);   color: var(--ink-inverse); }
.u-badge--mint     { background: var(--success); color: var(--ink-inverse); }
.u-badge--defect   { background: var(--danger);  color: var(--ink-inverse); }
.u-badge--reserved { background: var(--warning); color: var(--ink-inverse); }
/* post/plaza pills — verbatim lift (1px 6px, weight 700, #fff on fill). */
.u-badge--official { background: var(--accent-action); color: #fff; padding: 1px 6px; font-weight: 700; }
.u-badge--illini   { background: var(--campus-blue);   color: #fff; padding: 1px 6px; font-weight: 700; }
</style>
