# N7-redux Deliverable 3 — Keyboard-aware Dock · Audit

> Audit-only sprint. **No code changes** — only this markdown.
> HEAD: `15a1f23` fix(plaza): N13 + N14 — composer state cleanup + picker close button (#5)
> Audited: 2026-05-09
> Scope: `app/src/pages/plaza/index.vue` composer fullpage + cross-platform keyboard handling
> Out of scope: actual fix code (next sprint), schema, i18n, design tokens

---

## §1 Current behavior baseline

### DOM tree of `v-if="showComposer"` block (plaza/index.vue:315-385)

```
.composer-fullpage         [position:fixed; inset:0; flex column; z:1100; max-w:480; padding-bottom: env(safe-area-inset-bottom)]
├── .comp-header           [flex row; padding 14px 16px; border-bottom; static in flex flow]
│   ├── .comp-cancel       [text "取消"]
│   ├── .comp-title        [text "发帖"]
│   └── .comp-submit       [text "发布"]
├── .comp-body             [flex:1; overflow-y:auto]
│   ├── <textarea>         [v-model composerText; :focus=composerFocused; :adjust-position=true; :auto-height=true]
│   └── .comp-images       [v-if composerImages.length>0; flex wrap of 72×72 thumbs]
├── .comp-dock             [v-if composerAttachedItems.length>0; flex column; padding 0 16px 8px; static in flex flow]
│   └── .comp-attached × N [chip rows w/ image + title + price + remove]
└── .comp-footer           [flex row justify-between; padding 8px 16px; border-top; static in flex flow]
    ├── .comp-tools        [flex row gap 12px]
    │   ├── .comp-add-img  [v-if composerImages.length<4; image picker btn]
    │   └── .comp-attach-btn [chip add btn]
    └── .comp-count        [字数 counter "X chars left"]
```

### Position / z-index map

| Element | position | z-index | Notes |
|---|---|---|---|
| `.composer-fullpage` | **fixed** | **1100** | covers entire viewport via `inset: 0`; max-width 480px centered |
| `.comp-header` / `.comp-body` / `.comp-dock` / `.comp-footer` | **static** (flex children) | — | participate in flex column layout inside the fixed parent |
| `.attach-sheet` | **fixed** | **1201** | sibling, overlays composer when open |
| `.sheet-mask-over-composer` | **fixed** | **1200** | sibling backdrop |
| `CustomTabBar` | hidden via `v-if="!showComposer"` | — | not stacking concern in composer mode |

**Composer existing `padding-bottom`**: ✅ already `env(safe-area-inset-bottom, 0)` on `.composer-fullpage` (line 1377). Safe-area inset for the iPhone home bar is already accounted for in the closed-keyboard state.

### Keyboard-up actual behavior (reasoned, not real-device verified)

`.composer-fullpage` is a `position: fixed; inset: 0` flex column. When the soft keyboard rises:

- **H5**: `position: fixed` containers in mobile browsers do NOT auto-resize when the keyboard opens (that's the entire reason `visualViewport` exists). The fixed container stays the full viewport height; the keyboard renders **on top of** the bottom portion. Result: `.comp-footer` (toolbar) is fully covered, `.comp-dock` (chips) is fully covered, lower part of `.comp-body` (textarea + image strip) is covered. Smoke test 9's exact symptom.
- **uni-app `:adjust-position="true"` on textarea (line 328)**: this prop tells uni-app's H5 input wrapper to scroll the focused element into view above the keyboard. But it ONLY scrolls the textarea — it does NOT lift `.comp-dock` or `.comp-footer` (those are siblings of `.comp-body` in the flex column, not part of the focused input's layout context). So you see textarea pop into view, then immediately get covered again on the bottom by chip dock + toolbar. Worse: the chip dock and toolbar themselves stay *below* the keyboard, completely invisible.
- **mp-weixin**: similar story — `:adjust-position` only adjusts the textarea; the static-flow toolbar siblings remain buried under the keyboard.

### What `position: fixed` + `env(safe-area-inset-bottom)` solves vs doesn't

- ✅ Solved: home-bar overlap on iPhone (closed keyboard state)
- ❌ Not solved: keyboard occlusion of bottom toolbar / chip dock when keyboard opens
- ❌ Not solved: animation smoothness when keyboard appears/dismisses

→ **D3 must add JS-side keyboard height tracking + apply translation/padding to lift the chip dock + footer.**

---

## §2 Existing keyboard handling in codebase

### Raw grep results (zero false positives, all hits)

| Pattern | Hits | Files |
|---|---|---|
| `visualViewport` | **0** | (none) |
| `onKeyboardHeightChange` | **0** | (none) |
| `onKeyboardHeight` | **0** | (none) |
| `onKeyboardWillShow` / `onKeyboardWillHide` | **0** | (none) |
| `keyboardHeight` (any case) | **0** | (none) |
| `uni.onKeyboard` | **0** | (none) |
| `uni.hideKeyboard` | **1** | `chat/index.vue:301` |
| `cursor-spacing` | **1** | `plaza/index.vue:290` (comment input only) |
| `adjust-position` | **3** | `chat/index.vue:149` (true), `plaza/index.vue:291` (false on comment), `plaza/index.vue:328` (true on composer textarea) |
| `:focus="..."` on inputs | **6** | chat input, search input, plaza comment input, plaza composer textarea, login fields |
| `inputmode=` | **2** | login (email + password forms) |
| `softinput` / `softInput` | **0** | (none) |
| `addEventListener('resize'` / `window.resize` | **0** | (none) |
| `env(keyboard-inset-height)` | **0** | (none) |
| `interactive-widget` viewport meta | **0** | (`manifest.json` has no keyboard-related viewport config) |

### Synthesis

- **No `visualViewport` usage anywhere**. This is the first time the codebase will track viewport height in JS.
- **No `uni.onKeyboardHeightChange` usage anywhere**. First time mp-weixin keyboard event will be wired.
- **No reusable composable** exists. All ~30 composables in `app/src/composables/` are domain-specific (auth, items, plaza, messages, etc.). `useKeyboardHeight` is greenfield.
- **`chat/index.vue` is the only sophisticated keyboard handler** but it solves a *different* problem: keeping focus on the input across send-and-blur cycles on iOS Safari (gesture-window restriction). It does NOT track keyboard height. Patterns worth borrowing:
  - The H5 `// #ifdef H5` synchronous-focus-before-await pattern (avoids iOS Safari's "focus() outside gesture stack is silently ignored" trap) — **not directly relevant to D3** but shows the team understands platform-specific keyboard quirks.
  - The `uni.hideKeyboard()` defensive call in `toggleEmoji` — relevant if D3 adds an emoji-like panel toggle inside composer (currently it doesn't).
- **`plaza/index.vue:328`** already sets `:adjust-position="true"` on the composer textarea. This is the uni-app built-in keyboard-aware scroll behavior. It's a *partial* solution that handles the textarea but not the chip dock or toolbar. D3 needs to ADD on top of this, not replace it.
- **CSS safe-area envs (`env(safe-area-inset-*)`)** are pervasive (App.vue defines `--status-bar-height`; CustomTabBar, ChatEmojiPanel, attach-sheet all consume them). The composer fullpage already uses safe-area-inset-bottom. Pattern is well-established → D3's keyboard-up offset can layer on top without conflict.
- **No CSS `env(keyboard-inset-height)`** (the new VirtualKeyboard CSS env). Confirmed unsupported on iOS Safari per librarian §3.8 — not a viable replacement for JS-side handling.

→ **D3 is greenfield for keyboard-height tracking. No existing pattern to refactor; adding a new composable doesn't conflict with anything.**

---

## §3 H5 keyboard API

### Primary API: `window.visualViewport`

- Available since iOS Safari 13, Chrome Android 51+, Firefox Android 59+ — **fully covered by uni-app H5 baseline** (modern mobile only). WeChat in-app browser inherits underlying engine support (WKWebView on iOS, Chromium on Android).
- Read-only properties relevant to D3: `width`, `height`, `offsetTop`, `scale`. **Of these, only `height` is reliable for keyboard detection** (see iOS Safari quirks below).
- Events: `resize`, `scroll`, `scrollend`. **iOS Safari requires listening to BOTH `resize` and `scroll`** (the keyboard rise on iOS Safari fires `scroll` because the visual viewport scrolls up, plus `resize` because it shrinks). Listening only to `resize` misses some triggers.

### Height computation formula (production-validated)

```ts
const baselineHeight = window.innerHeight  // captured at mount, before any keyboard interaction
const keyboardHeight = Math.max(0, baselineHeight - window.visualViewport.height)
```

**Why baseline at mount, not `window.innerHeight` per call**:
- On Android Chrome 108+ (default `resizes-visual` mode), `window.innerHeight` stays stable when keyboard opens — so `baseline` could be re-read each time.
- On iOS Safari, `window.innerHeight` ALSO stays stable (layout viewport doesn't shrink, only visual viewport does).
- **But on Android Chrome <108** (or with `interactive-widget=resizes-content`), `window.innerHeight` itself shrinks → comparing current `innerHeight` to current `visualViewport.height` always gives ~0 → keyboard appears "not detected".
- Capturing `baselineHeight = window.innerHeight` at component mount (before user has tapped any input) gives a stable reference regardless of which mode the browser is in.

### iOS Safari quirks (sourced from librarian §3, all production-confirmed)

1. **600–700ms delay between input tap and `resize` fire**. The keyboard slide-up is animated; `resize` fires *after* animation completes. Mitigation: add CSS `transition: transform 0.2s ease-out` so the visual update is smoothed even if event arrives late.
2. **iOS 26 regression: `offsetTop` doesn't reset to 0 after keyboard dismissal**. Apple bug FB20191055 / FB19889436. Mitigation: only consume `height` (already what we're doing); never trust `offsetTop`.
3. **URL bar collapse triggers `resize`** (false positive). When user scrolls the page, Safari's URL bar collapses, shrinking the visual viewport ~50px. Mitigation: threshold guard — only treat shrink ≥ 50px as keyboard.
4. **Pull-to-refresh and rubber-band overscroll trigger `resize` / `scroll`**. Mitigation: same threshold; alternatively `overscroll-behavior: none` on body.
5. **Inconsistency: sometimes Safari scrolls the page UP instead of resizing the viewport** (depends on input position + page length heuristic). Mitigation: listen to BOTH `resize` AND `scroll` events (already noted above).
6. **`window.visualViewport` itself can be `undefined`** in old Safari (iOS 12 and below). Guard with `if (typeof window !== 'undefined' && window.visualViewport)`.

### Android Chrome behavior (sourced from librarian §5)

- Chrome 108+ (Sep 2022 release, ~3.5 years old): default `interactive-widget=resizes-visual` → layout viewport stable, only visual viewport shrinks. **Standard formula works cleanly.**
- Chrome <108: both viewports shrink → standard formula still detects keyboard but with reduced reliability.
- Android 15+ edge-to-edge mode: WebView doesn't auto-shrink for system insets → standard formula correct, but separate concern (Capacitor bug, not our use case since uni-app H5 runs in browser, not WebView).

### Cleanup pattern

```ts
// onMounted
window.visualViewport?.addEventListener('resize', handler)
window.visualViewport?.addEventListener('scroll', handler)

// onUnmounted
window.visualViewport?.removeEventListener('resize', handler)
window.visualViewport?.removeEventListener('scroll', handler)
```

Failing to clean up causes stacked listeners on every page navigation → memory leak + duplicate state writes.

### SSR safety

uni-app H5 is a SPA — no SSR, no hydration. But `vue-tsc --noEmit` (CI gate) runs TypeScript strict mode and will flag `window.visualViewport.height` access without an existence check. Use:

```ts
if (typeof window === 'undefined' || !window.visualViewport) return
```

at the top of the H5 effect block.

### Future API (NOT viable as primary, can be progressive enhancement)

- **`env(keyboard-inset-height)` + VirtualKeyboard API** (Chrome 94+, Edge 94+): would let CSS handle it via `padding-bottom: env(keyboard-inset-height)`. **NOT supported on iOS Safari, no plans from WebKit** — fully half of the user base falls through. Not viable as the only mechanism. *Could* be a future progressive enhancement for Android-only path, but the marginal gain (CSS-only on Android while still needing JS for iOS) doesn't justify the complexity.
- **`interactive-widget=resizes-content` viewport meta tag** (Chrome 108+): same iOS Safari coverage gap. Same conclusion.

→ **D3 must use `visualViewport` for H5; any web-spec keyboard CSS is not yet ready.**

---

## §4 mp-weixin keyboard API

### Primary API: `uni.onKeyboardHeightChange`

Per [uni-app docs](https://uniapp.dcloud.net.cn/api/key.html) and [WeChat native docs](https://developers.weixin.qq.com/miniprogram/dev/api/ui/keyboard/wx.onKeyboardHeightChange.html):

```ts
uni.onKeyboardHeightChange((res: { height: number }) => {
  // res.height in PX (not rpx); 0 when keyboard hidden
})

uni.offKeyboardHeightChange(handler)  // cleanup; pass same fn reference
```

### Platform support

- ✅ mp-weixin (base library 2.7.0+ — universally available now)
- ✅ App-Android (HBuilderX 2.2.3+) — not relevant (V1 doesn't ship App)
- ✅ App-iOS — not relevant
- ✅ mp-alipay / mp-qq / mp-kuaishou (HBuilderX 3.6.8+) — not relevant
- ❌ H5 — confirmed not supported (use `visualViewport`)
- ❌ mp-baidu / mp-toutiao — not relevant

### Registration / cleanup timing

- **Register in `onLoad`** (uni-app page lifecycle), NOT `onMounted` (Vue lifecycle). Per librarian §4 and [box-im/chat-box.vue production pattern](https://github.com/bluexsx/box-im/blob/master/im-uniapp/pages/chat/chat-box.vue): mp-weixin's keyboard event source is page-lifecycle bound; using Vue's `onMounted` may register late or miss the first event.
- **Cleanup in `onUnload`** (page lifecycle), NOT `onBeforeUnmount`. Failing to do so leaves the listener active → fires on the NEXT page after navigation, polluting unrelated screens. Confirmed production issue from WeChat dev community.
- The cleanup MUST receive the same function reference passed to `onKeyboardHeightChange` — i.e. store a named `const handler = ...` not an inline arrow each time.

### Height value semantics

- **Unit: physical pixels (px)**, never rpx. Direct CSS use: `transform: translateY(-${height}px)`.
- **Includes safe-area on iOS** ⚠️ — the height value on iPhone includes the home-bar inset (~34px on iPhone 12+). On Android, it does NOT include any system bars. **This is the single biggest cross-device gotcha**.
- Consequence for D3: if we use the raw height, on iOS the chip dock will lift by `actual IME + 34px` — i.e. it will float 34px above the keyboard, with a visible gap. Whether that's a bug or a feature is a design call (see §8 [DECISION-NEEDED]).
- To get pure IME height: subtract `uni.getWindowInfo().safeAreaInsets.bottom` on iOS only.

### Fires when

- Keyboard appears (with `height > 0`).
- Keyboard height changes (e.g. user switches IME, switches between number-pad and full-keyboard variants).
- Keyboard disappears (with `height = 0`).
- **Does NOT fire on Bluetooth / external physical keyboard** — height stays 0. Treat 0 as "no on-screen keyboard"; if user is using a hardware keyboard, our dock-lift simply doesn't trigger, which is correct UX (no soft keyboard to lift above).

### Real-device quirks (sourced from librarian §"Known Quirks", filtered to V1-relevant)

1. **WeChat Skyline renderer (iOS/Android 8.0.30+) — fold collapse not fired**. Symptom: keyboard pops up (event fires) → user collapses keyboard with the keyboard's own ⌃ button → NO event fires → state stuck at `height > 0`. Mitigation: also listen to `<input>` / `<textarea>` `@blur` event and reset `height = 0` on blur.
2. **Android WeChat 8.0.61+ — height reported ~50–100px too high**. Mitigation: expose an optional `heightOffset` opt to the composable; if real-device test confirms this for our user base, set a default offset for that UA.
3. **iOS WeChat 8.0.66 — third-party IMEs (Sogou / Baidu) triple-fire**. Pattern: `[correct] → [wrong] → [correct]`. Mitigation: 50ms debounce filters the middle bad value.
4. **HarmonyOS WeChat 8.0.11 — spontaneous `height=0` after 3 seconds even though keyboard still visible**. Niche; mitigation: ignore `height=0` if it arrives within 2s of last `height > 0`. Skip in V1; revisit if user reports.
5. **`adjust-position="false"` on input/textarea blocks the event** (App platform only — not mp-weixin). Not relevant since D3 keeps `adjust-position="true"` on composer textarea.
6. **Rapid focus/blur swap loses height events**. Mitigation: same 50ms debounce.

### Differences from H5 path (summary)

| Aspect | H5 | mp-weixin |
|---|---|---|
| API | `window.visualViewport.addEventListener('resize', ...)` | `uni.onKeyboardHeightChange(handler)` |
| Lifecycle | `onMounted` / `onUnmounted` | `onLoad` / `onUnload` |
| Cleanup function | `removeEventListener('resize', handler)` | `uni.offKeyboardHeightChange(handler)` |
| Includes safe-area | No (raw IME) | iOS yes / Android no |
| Fires on hardware keyboard | No (no on-screen kb to detect) | No (height stays 0) |
| False positives | URL bar collapse, scroll, pull-to-refresh | None of the above; but Skyline fold-collapse missed |
| Required guards | threshold ≥ 50px, debounce | debounce; blur fallback |

→ **The composable MUST conditional-compile (`// #ifdef H5` / `// #ifdef MP-WEIXIN`) — there is no shared code path.**

---

## §5 Transform 策略候选

### Candidate A — `transform: translateY(-keyboardHeight)` on a wrapper of `.comp-dock + .comp-footer`

- **Mechanism**: introduce a new wrapping `<view>` around the existing `.comp-dock` + `.comp-footer`, e.g. `.comp-bottom-stack`. Bind `:style="{ transform: \`translateY(-${kb.height}px)\` }"` on that wrapper.
- **Triggered by**: keyboard event (visualViewport resize on H5 / onKeyboardHeightChange on mp).
- **Effect on textarea height**: zero. Textarea stays in `.comp-body` flex:1 region; transform lifts the bottom stack but doesn't change layout. Textarea may be partially covered by the lifted stack at extreme keyboard heights — acceptable per Eric's "textarea 压缩可接受" constraint.
- **Animation smoothness**: ★★★★★ — `transform` is GPU-composited; CSS `transition: transform 0.2s ease-out` runs on the compositor thread, no main-thread reflow.
- **iOS Safari rubber-band risk**: low — transform is a paint operation, doesn't interact with scroll position.
- **mp-weixin risk**: low — transform support is universal in WXSS / nvue.
- **Compatibility with existing emoji panel toggle (😊)**: emoji panel only exists in `chat/index.vue`, not plaza. **Zero conflict.** If future plaza gets an emoji panel, transform on the bottom stack will compose cleanly (the emoji panel can mount inside the same stack and lift together).

### Candidate B — `padding-bottom: ${keyboardHeight}px` on `.composer-fullpage` itself

- **Mechanism**: bind `:style="{ paddingBottom: \`calc(${kb.height}px + env(safe-area-inset-bottom))\` }"` on `.composer-fullpage`. The flex children re-flow; `.comp-body` shrinks by `keyboardHeight`, and `.comp-dock` + `.comp-footer` slide up with the resized parent.
- **Effect on textarea height**: textarea shrinks (because `.comp-body` shrinks via `flex: 1` re-distribution).
- **Animation smoothness**: ★★★ — padding-bottom changes trigger layout reflow, not GPU compositing. `transition: padding 0.2s ease` works but feels slightly less smooth than transform.
- **iOS Safari rubber-band**: low — padding is layout, doesn't fight scroll.
- **mp-weixin**: works.
- **Compatibility**: cleanest semantically (the modal "knows" it's smaller); no extra DOM wrapper needed.

### Candidate C — `position: fixed; bottom: ${keyboardHeight}px` on `.comp-dock + .comp-footer`

- **Mechanism**: take the bottom stack out of flex flow, position-fixed it. Add matching `padding-bottom` on `.comp-body` to compensate (otherwise textarea content scrolls under the floating stack).
- **Effect on textarea**: needs explicit `padding-bottom` on `.comp-body` = (chip dock height + footer height + keyboardHeight) — chip dock height is dynamic (0–3 chips, ~64px each).
- **Animation**: ★★★ — `bottom` is layout, similar to candidate B.
- **iOS Safari**: position:fixed inside a parent that is also position:fixed (the composer-fullpage) is well-supported but adds stacking context complexity.
- **mp-weixin**: position:fixed works.
- **Complexity**: highest. Need dynamic measurement of chip dock + footer heights; need to keep `.comp-body padding-bottom` in sync as user adds/removes chips.

### Recommendation: **Candidate A (transform on wrapper)**

- Smoothest animation (GPU compositing → matches Eric's "smooth" constraint).
- Zero textarea height change (matches uni-app `:adjust-position="true"` already at work on the textarea — they layer cleanly).
- Lowest implementation complexity (one new wrapper `<view>`, one `:style` binding, one CSS `transition: transform 0.2s ease-out`).
- Easy rollback: delete the `:style` binding → behavior reverts to current.

If real-device testing on iOS Safari shows transform interferes with `:adjust-position` scroll-into-view (theoretical: transform creates a containing block for fixed children, doesn't apply here since wrapper is static), fall back to **Candidate B** (padding-bottom on outer) which is more conservative.

**Candidate C** only if A and B both fail real-device acceptance — its complexity isn't justified otherwise.

---

## §6 useKeyboardHeight composable API draft

> **NOT writing the file** — this is the interface spec for Eric to approve before next sprint.

### Proposed location

`app/src/composables/useKeyboardHeight.ts` (new file, ~80–120 lines including doc comments)

### Proposed return shape

```ts
import type { Ref } from 'vue'

export interface KeyboardState {
  /** Current soft-keyboard height in CSS pixels (px), or 0 when closed/hardware-keyboard. */
  height: Ref<number>
  /** Convenience flag: true when height > minThreshold (default 50). */
  isOpen: Ref<boolean>
}

export interface UseKeyboardHeightOptions {
  /** Minimum height (px) below which we treat as "closed" — filters URL bar collapse on iOS Safari. Default 50. */
  minThreshold?: number
  /** Debounce window (ms) for noisy event sources (iOS triple-fire, rapid resize). Default 50. */
  debounceMs?: number
  /** mp-weixin only: subtract the iOS home-bar safe-area from raw height? Default false (return raw). */
  subtractIosSafeArea?: boolean
}

export function useKeyboardHeight(opts?: UseKeyboardHeightOptions): KeyboardState
```

### Implementation outline (NOT actual file content)

```ts
// app/src/composables/useKeyboardHeight.ts (NOT WRITING THIS — spec only)
import { ref } from 'vue'
import { onLoad, onUnload, onShow, onHide } from '@dcloudio/uni-app'

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
      height.value = clamped
      isOpen.value = clamped > minThreshold
    }, debounceMs)
  }

  // ============================================================
  // #ifdef H5
  // ============================================================
  let baselineHeight = 0
  function onResize() {
    if (typeof window === 'undefined' || !window.visualViewport) return
    commit(baselineHeight - window.visualViewport.height)
  }

  // Vue lifecycle (uni-app H5 has both Vue and uni-app lifecycles available;
  // for H5-only code path we use Vue's so SPA hydration works correctly)
  import { onMounted, onUnmounted } from 'vue'
  onMounted(() => {
    if (typeof window === 'undefined') return
    baselineHeight = window.innerHeight
    window.visualViewport?.addEventListener('resize', onResize)
    window.visualViewport?.addEventListener('scroll', onResize)  // iOS needs both
  })
  onUnmounted(() => {
    if (typeof window === 'undefined') return
    window.visualViewport?.removeEventListener('resize', onResize)
    window.visualViewport?.removeEventListener('scroll', onResize)
    if (debounceTimer) clearTimeout(debounceTimer)
  })
  // #endif

  // ============================================================
  // #ifdef MP-WEIXIN
  // ============================================================
  function handler(res: { height: number }) {
    let next = res.height
    if (opts.subtractIosSafeArea && next > 0) {
      const info = uni.getWindowInfo()
      const platform = (info.platform || '').toLowerCase()
      if (platform === 'ios') next -= info.safeAreaInsets?.bottom ?? 0
    }
    commit(next)
  }
  // uni-app page lifecycle (per docs + production patterns —
  // Vue lifecycle hooks fire too late on mp-weixin)
  onLoad(() => { uni.onKeyboardHeightChange(handler) })
  onUnload(() => {
    uni.offKeyboardHeightChange(handler)
    if (debounceTimer) clearTimeout(debounceTimer)
  })
  // #endif

  return { height, isOpen }
}
```

### Lifecycle scope discussion

- **H5**: Vue lifecycle (`onMounted` / `onUnmounted`) is correct. The composable is called in `<script setup>` so it's per-component-instance scoped. Each composer modal instance gets its own listener; cleanup runs when the component unmounts.
- **mp-weixin**: `onLoad` / `onUnload` are PAGE lifecycle hooks (from `@dcloudio/uni-app`). They fire once per page navigation. Per librarian §4 and production patterns, this is the correct timing for `uni.onKeyboardHeightChange`. Vue's `onMounted` fires later and may miss early events.
- The composable can be safely called multiple times in different components on the same page on H5 (each instance gets its own listener) — but on mp-weixin, calling it twice on the same page would register two listeners. **For V1, plaza's composer is the only consumer so this isn't a concern.** If future use spreads, refactor to a module-level singleton (see §8 [DECISION-NEEDED]).

### Multiple-caller / shared-state question

V1 has exactly one caller (plaza composer). Setup-scoped is fine.

If V1.x extends to chat / messages, a shared module-level singleton becomes attractive:
- Pro: only one listener registration regardless of how many components consume the value.
- Con: needs reference counting for cleanup (last consumer unregisters); slightly more complex.

Defer to V1.x — see §8.

### SSR safety

uni-app H5 is a SPA; no SSR. Guards are for `vue-tsc` strict mode (TypeScript) compliance only. The pattern `typeof window === 'undefined' || !window.visualViewport` covers both.

---

## §7 Risk enumeration (with mitigations)

1. **iOS Safari URL bar collapse triggers `resize` (false-positive)**
   *Mitigation*: `minThreshold` default 50px in composable. Confirmed sufficient against URL bar (~50px shrink is the URL bar's typical height; real keyboards are ≥250px).

2. **iOS 26 regression — `visualViewport.offsetTop` doesn't reset after keyboard dismiss**
   *Mitigation*: composable consumes only `.height`, never `.offsetTop`. If users on iOS 26 still report stuck offset, document workaround (force-scroll on detected `height = 0`) but don't ship preemptively.

3. **mp-weixin Skyline renderer fold-collapse not fired**
   *Mitigation*: in plaza/index.vue D3 fix, also bind `@blur` on the textarea to reset `height` to 0. Defense in depth; doesn't go in the composable itself.

4. **mp-weixin Android WeChat 8.0.61+ height reported ~50–100px too high**
   *Mitigation*: compose-time option `heightOffset` (not in V1 default). Ship V1 without; if real-device test on Android WeChat shows persistent over-lift, add UA-conditional offset or expose to caller.

5. **mp-weixin iOS WeChat 8.0.66 third-party IME triple-fire**
   *Mitigation*: 50ms debounce default in composable. Filters middle bad value.

6. **HarmonyOS WeChat 8.0.11 spontaneous `height=0` after 3s**
   *Mitigation*: deferred to V1.x. HarmonyOS user share is small and bug is in WeChat itself, not our code.

7. **Orientation change (portrait ↔ landscape)**
   *Mitigation*: H5 — `baselineHeight` is captured at mount only; orientation change should re-capture. Add `window.addEventListener('orientationchange', recaptureBaseline)` to composable (~3 lines). mp-weixin — `uni.onKeyboardHeightChange` is event-driven, no baseline; orientation change naturally re-fires events. ✅ no mp-weixin code needed.

8. **Bluetooth / external keyboard connected**
   *Mitigation*: `height = 0` returned on both platforms when hardware keyboard is used. Composer dock simply doesn't lift — correct UX (no soft keyboard to lift above).

9. **CN/EN IME switch causes height jump**
   *Mitigation*: CSS `transition: transform 0.2s ease-out` on the bottom stack wrapper smooths jumps. (Belongs in plaza/index.vue D3 fix, not composable.)

10. **iOS long-press selection menu**
    *Mitigation*: not a keyboard event; doesn't trigger our handlers. ✅ no action.

11. **Composer textarea `:auto-height="true"` interaction with bottom stack lift**
    *Risk*: as user types and textarea grows, plus keyboard pushes things, plus bottom stack lifts… layout could over-flow. *Mitigation*: textarea is inside `.comp-body { overflow-y: auto }` — it's already scroll-clamped. Real-device test required to confirm no edge case.

12. **mp-weixin page navigation while composer is open**
    *Risk*: user opens composer → taps an attached chip → navigates to item detail → comes back. Did the listener get cleaned up? Did it re-register?
    *Mitigation*: composer is a modal `v-if`, not a navigated page — when user opens item detail it `uni.navigateTo`s a different page. Plaza's `onLoad`-registered keyboard listener stays alive across navigations to detail (as it should — plaza page is still in stack). On return, plaza's `onShow` fires but `onLoad` does NOT — listener is still bound. ✅ correct behavior. But: if user closes the composer (`onComposerCancel`), the keyboard listener is still bound to the plaza page (correct — it might be needed for comment input later). Memory cost is minimal (one closure).

---

## §8 Open questions for Eric

- **[DECISION-NEEDED] Transform 策略选 A / B / C？** Audit recommends **A** (transform on wrapper) for GPU smoothness + zero textarea-height interference + lowest complexity. Eric to confirm or override (e.g. if there's a future emoji panel / rich-formatting bar plan that prefers padding semantics).

- **[DECISION-NEEDED] Animation transition duration**. Recommend **0.2s ease-out** (matches existing `.attach-sheet { transition: transform 0.26s ease }` family in plaza style block, slightly snappier per "keyboard feels instant" UX). Alternatives: `0.25s` (matches typical iOS keyboard rise duration of ~250ms) or `match keyboard speed exactly` (250ms ease-in-out). Eric to pick.

- **[DECISION-NEEDED] V1 composable scope: only plaza, or also refactor chat/messages keyboard handling to share?** Audit recommends **only plaza for V1**. Rationale: chat's existing `:focus + uni.hideKeyboard()` pattern solves a different problem (focus retention), not height tracking. Mixing them risks regression on N12-class auth/cold-start work that just stabilized. Defer chat/messages keyboard refactor to V1.x once D3 is real-device proven on plaza.

- **[DECISION-NEEDED] `minThreshold` default value**. Recommend **50px**. iOS Safari URL bar is ~50px; real keyboards ≥ 250px (smallest English IME) ≥ 300px (CN/JP IME with candidate bar). 50 is the lowest safe threshold. Eric override only if testing surfaces a real keyboard < 50px (unlikely).

- **[DECISION-NEEDED] mp-weixin iOS: subtract `safeAreaInsets.bottom` from raw height?** This is the iPhone home-bar question. Two outcomes:
  - **`subtractIosSafeArea: false` (default)** — chip dock lifts to (keyboard top + 34px above home bar). 34px gap above keyboard. Looks like there's "breathing room" above keyboard; some users prefer this.
  - **`subtractIosSafeArea: true`** — chip dock lifts exactly to keyboard top (no gap). More compact; classic iMessage / WeChat behavior.
  - Recommend **false (raw)** for V1 since the gap is conservatively visible and matches Tab Bar's own safe-area treatment elsewhere in the app. Eric confirms.

- **[DECISION-NEEDED] Lifecycle hook split (`onMounted/onUnmounted` for H5 vs `onLoad/onUnload` for mp-weixin)** — already settled by platform requirements (mp-weixin docs + production patterns), but flagging for visibility. Conditional compile is mandatory.

- **[DECISION-NEEDED] Composable shared singleton vs setup-scoped?** Recommend **setup-scoped for V1** (one consumer = plaza). Refactor to shared singleton when chat/messages adopt the composable in V1.x.

- **[DECISION-NEEDED] Real-device test plan**. Audit found 7+ documented quirks across iOS Safari, WeChat iOS, WeChat Android, HarmonyOS WeChat, Skyline renderer. Eric to decide minimum acceptance set:
  - V1 release blockers: iOS Safari (latest), Android Chrome (latest), WeChat iOS (latest stable), WeChat Android (latest stable). These cover ≥ 95% of users.
  - Nice-to-have / doc-only: HarmonyOS WeChat, Skyline-enabled WeChat, Bluetooth keyboard.

---

## §9 Suggested next-step

### Fix sprint estimated scope

- **Files touched**: 2
  1. **NEW** `app/src/composables/useKeyboardHeight.ts` — ~80–120 LOC including doc comments + conditional compile blocks
  2. **MODIFIED** `app/src/pages/plaza/index.vue` — ~15–25 LOC delta:
     - 1 `import { useKeyboardHeight } from '../../composables/useKeyboardHeight'`
     - 1 `const kb = useKeyboardHeight()` in `<script setup>`
     - 1 new wrapping `<view class="comp-bottom-stack" :style="{ transform: \`translateY(-${kb.height}px)\` }">` around existing `.comp-dock` + `.comp-footer` (template change)
     - 1 new SCSS rule for `.comp-bottom-stack { transition: transform 0.2s ease-out; will-change: transform; }` (~5 LOC)
- **No DB migrations, no i18n keys, no design tokens, no edge function, no env var**.

### Three-green expected pass cleanly:
- `vue-tsc --noEmit` — composable adds 1 typed export; no breaking type
- `build:h5` — visualViewport branch; should compile fine in modern target
- `build:mp-weixin` — onKeyboardHeightChange branch; should compile fine in WXSS/JS target

### Time estimate

- Implementation (composable + plaza wiring): **1.5–2 hours** for an experienced Vue 3 + uni-app dev (longer if first time conditional-compile)
- Audit re-read by implementer: **20 min**
- Three-green + commit hygiene: **15 min**
- Real-device test (iOS Safari + WeChat iOS at minimum, plus 1 Android): **1–1.5 hours**
- Final report: **15 min**
- **Total: ~3.5–4.5 hours** for the implementer in one focused sitting

### Eric's pre-fix decision matrix (minimal set)

Before unfreezing fix sprint, Eric needs to commit on:
1. Transform strategy (A / B / C)
2. Composable scope (V1 plaza-only vs include chat/messages refactor)
3. iOS safe-area subtraction (raw vs subtracted)
4. minThreshold + debounceMs values (defaults 50 / 50 acceptable, or override)

All four are listed in §8 with recommendations. Once Eric posts a one-liner like "A / V1 plaza-only / raw / defaults OK" the fix sprint is unblocked.

### What this audit deliberately did NOT do

- Did NOT write `app/src/composables/useKeyboardHeight.ts` (Eric to commission next sprint)
- Did NOT modify plaza/index.vue (audit-only)
- Did NOT git stage / commit / push anything
- Did NOT touch other pages (chat, messages, search) — they're out of D3 scope; if extension to them is wanted, separate audit
- Did NOT real-device test — Eric / next-sprint implementer to do this

---

**End of audit.**
