import { ref, onMounted, onUnmounted } from 'vue'
import type { Ref } from 'vue'
import { onLoad, onUnload } from '@dcloudio/uni-app'

/*
 * useKeyboardHeight — cross-platform soft-keyboard height tracker.
 *
 * Built for N7-redux Deliverable 3: lift the plaza composer's chip-dock +
 * footer above the keyboard instead of letting them get buried (smoke
 * test 9 regression). Returns the current keyboard height (px) so the
 * caller can apply a transform / padding / fixed-bottom offset.
 *
 * --- H5 path ---
 * Uses window.visualViewport. Listens to BOTH `resize` AND `scroll`
 * events because iOS Safari fires both when the keyboard rises (the
 * visual viewport scrolls up AND shrinks); listening to `resize` alone
 * misses some triggers. Captures `baselineHeight = window.innerHeight`
 * at onMounted (before any keyboard interaction) and computes
 * `baselineHeight - visualViewport.height` per event. Capturing at mount
 * is required for Android Chrome <108 compatibility, where
 * `window.innerHeight` itself shrinks when the keyboard opens (modern
 * Chrome 108+ keeps innerHeight stable; pre-108 mirrors visualViewport).
 *
 * --- mp-weixin path ---
 * Uses `uni.onKeyboardHeightChange`, registered via uni-app PAGE
 * lifecycle (`onLoad` / `onUnload`) — NOT Vue lifecycle. Per uni-app
 * docs and 5+ production patterns surveyed in the audit, Vue
 * `onMounted` registers too late and may miss the first event on
 * mp-weixin. Cleanup via `uni.offKeyboardHeightChange` REQUIRES the
 * same function reference passed to `on...` — the named `handler` const
 * below satisfies that contract.
 *
 * --- Debouncing ---
 * 50ms default debounce filters two known noise sources:
 *   1. iOS Safari URL bar collapse on scroll (~50px shrink) — would
 *      false-positive without minThreshold gate; debounce smooths the
 *      transient.
 *   2. iOS WeChat 8.0.66+ third-party IMEs (Sogou, Baidu) triple-fire
 *      [correct → wrong → correct] within ~30ms; 50ms collapses to
 *      the final value.
 *
 * --- Scope (V1) ---
 * Setup-scoped: each <script setup> caller registers its own listener
 * pair and lives with that component's lifecycle. V1 has exactly one
 * consumer (plaza composer); module-level singleton is deferred until
 * V1.x adds chat / messages consumers (per audit §8 Decision 7).
 *
 * --- V1 verify scope ---
 * Mobile H5 (iOS Safari + Android Chrome) is the V1 launch target.
 * mp-weixin code path compiled but real-device verify deferred to V1.x
 * batch (per Eric launch cadence). Documented mp-weixin quirks not
 * mitigated in V1: Skyline fold-collapse missing event (audit §7.3 —
 * @blur fallback when reported), Android WeChat 8.0.61+ height-too-high
 * (audit §7.4 — heightOffset opt deferred), HarmonyOS 8.0.11 self-
 * resetting height=0 (audit §7.6 — niche).
 *
 * Refs: docs/audit/N7redux_D3_keyboard_dock_audit.md (untracked, local).
 */

export interface KeyboardState {
  /**
   * Current soft-keyboard height in CSS pixels (px); 0 when keyboard
   * is closed, a hardware keyboard is in use, or the detected viewport
   * shrink is below `minThreshold` (filtered as false-positive — e.g.
   * iOS Safari URL bar collapse, pull-to-refresh).
   */
  height: Ref<number>
  /** Convenience flag: true when height > 0 (i.e. above minThreshold). Filters URL-bar / overscroll false positives. */
  isOpen: Ref<boolean>
}

export interface UseKeyboardHeightOptions {
  /**
   * Minimum height (px) below which we treat the viewport shrink as
   * "not a keyboard" — filters iOS Safari URL bar collapse (~50px) and
   * pull-to-refresh / rubber-band overscroll. Real soft keyboards are
   * always ≥ 250px (smallest English IME) ≥ 300px (CJK IME with
   * candidate bar). Default: 50.
   */
  minThreshold?: number
  /**
   * Debounce window (ms) collapsing rapid event bursts to the last
   * value. Filters iOS triple-fire from third-party IMEs and general
   * jitter from rapid focus/blur. Default: 50.
   */
  debounceMs?: number
  /**
   * mp-weixin only: when true, subtracts
   * `uni.getWindowInfo().safeAreaInsets.bottom` from the raw height on
   * iOS (where the native API includes the home-bar inset). On Android
   * mp-weixin and on H5, this option is a no-op. Default: false (return
   * raw native height; caller can subtract manually if their UX wants
   * "no gap" rather than "breathing room above keyboard").
   */
  subtractIosSafeArea?: boolean
}

export function useKeyboardHeight(opts: UseKeyboardHeightOptions = {}): KeyboardState {
  const height = ref(0)
  const isOpen = ref(false)
  const minThreshold = opts.minThreshold ?? 50
  const debounceMs = opts.debounceMs ?? 50

  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  function commit(next: number) {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      const clamped = Math.max(0, next)
      // Below minThreshold = "not a real keyboard". False positives we
      // need to suppress: iOS Safari URL bar collapse (~50px), pull-to-
      // refresh / overscroll rubber-band, and any sub-keyboard viewport
      // shrink. Gate height too (not just isOpen) — callers binding
      // transform to .height would otherwise see a 50px wrapper jump on
      // URL bar collapse even though isOpen correctly reads false.
      const gated = clamped > minThreshold ? clamped : 0
      height.value = gated
      isOpen.value = gated > 0
      debounceTimer = null
    }, debounceMs)
  }

  // ============================================================
  // H5 path — visualViewport
  // ============================================================
  // #ifdef H5
  let baselineHeight = 0

  function onResize() {
    // SSR / older-browser guard. uni-app H5 is SPA so window always
    // exists at runtime, but vue-tsc strict mode sees the global as
    // possibly-undefined at type level; this guard satisfies both.
    if (typeof window === 'undefined' || !window.visualViewport) return
    const vv = window.visualViewport
    // baseline - vv.height is the viewport shrink; ALSO subtract vv.offsetTop.
    // iOS Safari scrolls the visual viewport up when focusing a field near the
    // bottom — without subtracting that offset the computed inset over-shoots,
    // and a bottom-anchored bar lifts ABOVE the keyboard leaving a gap (QA6 #8:
    // the chat composer "jumped to the top"). Cap at baseline so a transient
    // bad reading can never translate a bar fully offscreen.
    const inset = baselineHeight - vv.height - (vv.offsetTop || 0)
    commit(Math.min(inset, baselineHeight))
  }

  onMounted(() => {
    if (typeof window === 'undefined') return
    // Capture baseline BEFORE any user interaction can pop the
    // keyboard, so subtractions are stable across Chrome <108 (where
    // innerHeight shrinks with the keyboard) and Chrome 108+ /
    // iOS Safari (where innerHeight stays stable).
    baselineHeight = window.innerHeight
    if (window.visualViewport) {
      // Both events are required on iOS Safari (see top-of-file note).
      window.visualViewport.addEventListener('resize', onResize)
      window.visualViewport.addEventListener('scroll', onResize)
    }
  })

  onUnmounted(() => {
    if (typeof window === 'undefined') return
    if (window.visualViewport) {
      window.visualViewport.removeEventListener('resize', onResize)
      window.visualViewport.removeEventListener('scroll', onResize)
    }
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
  })
  // #endif

  // ============================================================
  // mp-weixin path — uni.onKeyboardHeightChange
  // ============================================================
  // #ifdef MP-WEIXIN
  function handler(res: { height: number }) {
    let next = res.height
    if (opts.subtractIosSafeArea && next > 0) {
      // iOS reports IME height inclusive of the home-bar inset; Android does not.
      const dev = uni.getDeviceInfo()
      if ((dev.platform || '').toLowerCase() === 'ios') {
        const win = uni.getWindowInfo()
        next -= win.safeAreaInsets?.bottom ?? 0
      }
    }
    commit(next)
  }

  // Page lifecycle (NOT Vue lifecycle) — required on mp-weixin.
  onLoad(() => {
    uni.onKeyboardHeightChange(handler)
  })

  onUnload(() => {
    // Same fn reference as on...; required for native cleanup.
    uni.offKeyboardHeightChange(handler)
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
  })
  // #endif

  return { height, isOpen }
}
