import { ref } from 'vue'
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
 * No JS lift. Keyboard avoidance is handled structurally by the viewport
 * meta `interactive-widget=resizes-content` (app/index.html), which shrinks
 * the layout viewport so bottom-anchored bars / fixed sheets reflow above the
 * keyboard on their own. `height` stays 0 on H5; the per-element translateY
 * bindings in consumers become no-ops. See the in-body H5 block for the full
 * rationale (QA6 #8/#9 — a single px formula could not lift both the chat
 * composer and the post composer correctly; the browser reflow does).
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
  // H5 path — interactive-widget=resizes-content (no JS lift)
  // ============================================================
  // #ifdef H5
  /*
   * H5 keyboard avoidance is now handled STRUCTURALLY by the viewport meta
   * `interactive-widget=resizes-content` (app/index.html): the soft keyboard
   * shrinks the layout viewport itself, so a bottom-anchored flex child (chat
   * `.input-bar`, plaza `.comp-bottom-stack`, post `.input-wrapper`) or a
   * `position:fixed; bottom:0` sheet (offer / meetup / comment) reflows to sit
   * directly above the keyboard with NO transform.
   *
   * Applying a translateY lift ON TOP of that reflow double-lifts the bar to
   * the top of the screen — that was QA6 #8 ("一点就跳到最上面"). The previous
   * round removed the lift's offsetTop term to fix that, which then
   * under-corrected the post composer (#9, "被键盘遮住"). A single px formula
   * could not serve both contexts; the browser-native reflow does, for free.
   * So H5 reports height 0 — every consumer's translateY binding becomes a
   * no-op and the keyboard avoidance is deterministic, not a magic number.
   *
   * Pre-Safari-17.4 / Chrome <108 fall back to the legacy `resizes-visual`
   * behaviour (keyboard overlays a fixed bar) — acceptable for a 2026 launch
   * and strictly no worse than the previously-broken manual lift. `height`
   * stays 0 here, so no visualViewport listeners are registered.
   */
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
