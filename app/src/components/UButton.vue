<template>
  <view
    :class="[
      'u-btn',
      `u-btn-${variant}`,
      `u-btn-${size}`,
      {
        'is-disabled': disabled,
        'is-loading': loading,
        'is-block': block,
      }
    ]"
    role="button"
    :aria-disabled="disabled || loading"
    :aria-busy="loading ? 'true' : 'false'"
    :tabindex="disabled || loading ? -1 : 0"
    :hover-class="disabled || loading ? 'none' : 'u-mp-pressed'"
    :hover-stay-time="80"
    @click="onClick"
  >
    <view class="u-btn-content"><slot></slot></view>
  </view>
</template>

<script setup lang="ts">
/**
 * UButton — primary tap target component for v3.
 *
 * Variants:
 *   primary     — terracotta brand bg, white text — for confirms / 发布 / 立即联系
 *   secondary   — ink bg, canvas text — for affirm-but-not-commit (e.g. 询价)
 *   ghost       — filled-subtle paper-2 neutral bg, ink text, no border — kit
 *                 canonical "Ghost" (tokens.css .u-btn-ghost / components-buttons.html).
 *                 Matches the App.vue .u-btn-ghost utility one-to-one.
 *   campus      — UIUC navy bg, white text — ONLY for the 5 official-affiliated surfaces
 *                 (Illini badge, CAACI官方 post header, 校历 entry, verified pickup, scam-official)
 *                 per docs/memory/design_system_two_track.md
 *   danger      — danger red bg, white text — for delete / unfollow / report
 *
 * Sizes:
 *   sm  — 32px height, padding 16px horizontal, font 13
 *   md  — 44px height, padding 20px horizontal, font 15 (default, hits iOS 44pt target)
 *   lg  — 52px height, padding 24px horizontal, font 16, radius-lg (not pill)
 *
 * States: default → hover (≥768px only) → active (scale 0.97) → disabled → loading
 * Loading keeps the stable action label visible, sets aria-busy and disables
 * activation. This avoids a layout shift and preserves an accessible name.
 *
 * Motion: all transitions use prod motion tokens (--dur-1 / --ease-std) per SPEC.
 */
const props = withDefaults(defineProps<{
  variant?: 'primary' | 'secondary' | 'ghost' | 'campus' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
  loading?: boolean
  block?: boolean
}>(), {
  variant: 'primary',
  size: 'md',
  disabled: false,
  loading: false,
  block: false,
})

const emit = defineEmits<{
  (e: 'click', evt: Event): void
}>()

function onClick(evt: Event) {
  if (props.disabled || props.loading) return
  emit('click', evt)
}
</script>

<style scoped>
/* ===== Base ===== */
.u-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-hei, -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif);
  font-weight: 500;
  letter-spacing: -0.01em;
  cursor: pointer;
  border: 0;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  position: relative;
  transition:
    transform 170ms var(--ease-warm, cubic-bezier(0.2, 0.8, 0.2, 1)),
    background var(--dur-1, 120ms) var(--ease-std, cubic-bezier(0.4, 0, 0.2, 1)),
    box-shadow var(--dur-2, 220ms) var(--ease-warm, cubic-bezier(0.2, 0.8, 0.2, 1)),
    color var(--dur-1, 120ms) var(--ease-std, cubic-bezier(0.4, 0, 0.2, 1)),
    opacity var(--dur-1, 120ms) var(--ease-std, cubic-bezier(0.4, 0, 0.2, 1));
}
.u-btn:focus-visible {
  outline: 2px solid var(--brand);
  outline-offset: 2px;
}

/* ===== Sizes ===== */
.u-btn-sm { height: 32px; min-width: 44px; padding: 0 var(--space-4, 16px); font-size: 13px; border-radius: var(--radius-pill, 999px); }
.u-btn-md { height: 44px; min-width: 44px; padding: 0 var(--space-5, 20px); font-size: 15px; border-radius: var(--radius-pill, 999px); }
.u-btn-lg { height: 52px; min-width: 44px; padding: 0 var(--space-6, 24px); font-size: 16px; border-radius: var(--radius-lg, 18px); }

/* ===== Block (full width) ===== */
.u-btn.is-block { width: 100%; }

/* ===== Variants ===== */
.u-btn-primary {
  background: var(--brand);
  color: #fff;
  box-shadow: var(--shadow-cta);
}
.u-btn-primary:active:not(.is-disabled):not(.is-loading) {
  transform: scale(0.97);
  background: var(--brand-deep);
  box-shadow: var(--shadow-soft);
}

.u-btn-secondary {
  background: var(--ink);
  color: var(--canvas);
  box-shadow: var(--shadow-soft);
}
.u-btn-secondary:active:not(.is-disabled):not(.is-loading) {
  transform: scale(0.97);
  opacity: 0.9;
}

/* Kit canonical ghost = filled-subtle paper-2 neutral (tokens.css .u-btn-ghost),
   one-to-one with the App.vue .u-btn-ghost utility — NOT bordered-transparent. */
.u-btn-ghost {
  background: var(--paper-2);
  color: var(--ink);
}
.u-btn-ghost:active:not(.is-disabled):not(.is-loading) {
  background: var(--paper-3);
}

.u-btn-campus {
  background: var(--campus-blue);
  color: #fff;
  box-shadow: var(--shadow-soft);
}
.u-btn-campus:active:not(.is-disabled):not(.is-loading) {
  transform: scale(0.97);
  background: var(--campus-blue-deep);
}

.u-btn-danger {
  background: var(--danger);
  color: #fff;
  box-shadow: var(--shadow-soft);
}
.u-btn-danger:active:not(.is-disabled):not(.is-loading) {
  transform: scale(0.97);
  opacity: 0.92;
}

/* ===== Disabled ===== */
.u-btn.is-disabled {
  background: var(--ink-faint);
  color: var(--ink-quiet);
  box-shadow: none;
  cursor: not-allowed;
  opacity: 0.55;
  pointer-events: none;
}

/* ===== Loading ===== */
.u-btn.is-loading {
  pointer-events: none;
  cursor: not-allowed;
  opacity: 0.72;
}

/* ===== Hover (desktop only, ≥768px with hover capability) ===== */
@media (hover: hover) and (min-width: 768px) {
  .u-btn-primary:hover:not(.is-disabled):not(.is-loading) {
    background: var(--brand-deep);
    box-shadow: var(--shadow-pop);
  }
  .u-btn-secondary:hover:not(.is-disabled):not(.is-loading) {
    background: var(--ink-soft);
  }
  .u-btn-ghost:hover:not(.is-disabled):not(.is-loading) {
    background: var(--paper-3);
  }
  .u-btn-campus:hover:not(.is-disabled):not(.is-loading) {
    background: var(--campus-blue-deep);
    box-shadow: var(--shadow-pop);
  }
  .u-btn-danger:hover:not(.is-disabled):not(.is-loading) {
    opacity: 0.92;
    box-shadow: var(--shadow-pop);
  }
}
</style>
