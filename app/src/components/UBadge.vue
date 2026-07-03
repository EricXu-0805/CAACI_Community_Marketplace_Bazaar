<template>
  <view class="u-badge" :class="`u-badge--${variant}`">
    <text class="u-badge-txt"><slot /></text>
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
  variant: 'new' | 'mint' | 'defect' | 'reserved' | 'official' | 'illini' | 'wanted'
}>()
</script>

<style scoped>
.u-badge {
  padding: 2px 7px;
  border-radius: var(--radius-xs);
  font-size: 10px;
  font-weight: 600;
}
/* App.vue's global `text { color: … }` element rule beats color INHERITED
   from the pill view, so the label rendered dark on light theme (求购 read
   as blue-on-black). Two classes out-specify every global theme block and
   hand color control back to the variant on the view. */
.u-badge .u-badge-txt { color: inherit; }
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
   per D1 (university-identity), matching reconcile's .badge-official recolor.
   Fills use the *-surface tokens (background-stable across themes) so white
   stays AA-legible; the plain --campus-orange/--campus-blue tokens flip to
   light TEXT values in dark mode and drop white-on-fill below 4.5:1 (QA8). */
.u-badge--official { background: var(--campus-orange-surface); color: #fff; padding: 1px 6px; font-weight: 700; }
/* illini badge leads with a ✓ so it reads explicitly as "verified", not just a
   campus label (QA7 r2 — Eric: 加一个 verified 更明了). */
.u-badge--illini   { display: inline-flex; align-items: center; gap: 3px; background: var(--campus-blue-surface); color: #fff; padding: 1px 7px; font-weight: 700; }
.u-badge--illini::before { content: '✓'; font-size: 9px; font-weight: 800; line-height: 1; }
/* wanted/ISO tag — solid campus-blue so it reads as a listing-TYPE marker,
   distinct from the frosted condition chips. */
.u-badge--wanted   { background: var(--campus-blue-surface);   color: #fff; padding: 2px 7px; font-weight: 700; letter-spacing: 0.04em; }
</style>
