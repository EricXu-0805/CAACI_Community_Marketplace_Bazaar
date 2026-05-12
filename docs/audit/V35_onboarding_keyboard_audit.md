# v3.5 — Onboarding step 1 keyboard occlusion · Audit

> Audit-only sprint. **No code changes** — only this markdown.
> HEAD: `2243751` fix: v3.5 launch-blocker bundle (avatar dark fallback + banner skeleton + docs) (#13)
> Audited: 2026-05-12
> Scope: `app/src/pages/onboarding/index.vue` step 1 nickname input + `.bottom` CTA + keyboard interaction across H5 / mp-weixin
> Out of scope: actual fix code (next sprint), step 2 (chips, no input), step 3 (avatar picker, no input), other pages, schema

---

## §1 Current layout baseline

The backlog memory (`docs/memory/backlog_onboarding_keyboard_occlusion.md:11`) predicted the root-cause family as "`position: fixed` `.bottom` interacting with soft keyboard rise". **This prediction is falsified by the file itself** — `app/src/pages/onboarding/index.vue:237` declares `.bottom { display: flex; gap: 10px; padding-top: 16px }`, with **no `position` property** (default `static`, participates in parent's flex column flow). Re-deriving the baseline from scratch:

### DOM tree of `.page`

```
.page                                            [static; flex column; min-height:100vh; max-width:480px;
                                                  padding 0 24px 24px (with overridden top/bottom);
                                                  padding-top: calc(20px + status-bar-height);
                                                  padding-bottom: calc(24px + safe-area-inset-bottom)]   :185–192
├── .progress                                    [static; flex row; padding 8px 0 24px]                  :193–196
│   └── .pdot × totalSteps (3)                   [24×4 progress pills + active 36×4]                     :197–203
├── .step (v-if step===1)                        [static; flex:1; flex column; gap 10px; pt 12px]        :11–25 (template),
│   │                                                                                                     :204 (CSS)
│   ├── .title                                   [22px/700]                                              :12, :205
│   ├── .sub                                     [14px/muted; mb 16px]                                   :13, :206
│   └── .field                                   [static (position:relative for absolute count);
│       │                                         flex column; gap 8px]                                  :14–24, :207
│       ├── .label                               [12px/600/upper]                                        :15, :208
│       ├── <input class="input">                [border-bottom 1.5px; w:100%; pad 10px 0; 17px]         :16–22 (template),
│       │                                                                                                 :209–213 (CSS)
│       └── .count (v-if length>=35)             [11px/faint; align-self:flex-end]                       :23, :214
│
│   (step 2 .chips :27–40 and step 3 .avatar-row :42–58 exist but DO NOT focus the keyboard → out of scope)
│
└── .bottom                                      [static; flex row; gap 10px; pt 16px]                   :60–67 (template),
    │                                                                                                     :237 (CSS)
    ├── .btn-ghost.half (v-if step>1)            [hidden on step 1]                                      :61–63
    └── .btn-primary[.half][.disabled]           [flex:1; pad 14px; radius 22px; primary fill]           :64–66, :238–252
```

### Position / z-index map

| Element | position | z-index | Layout role | File:line |
|---|---|---|---|---|
| `.page` | **static** (default) | — | flex column container; `min-height: 100vh; max-width: 480px; margin: 0 auto` | :185–192 |
| `.progress` | static | — | flex row at top of page | :193–196 |
| `.step` | static | — | `flex: 1` — absorbs all vertical space between `.progress` and `.bottom` | :204 |
| `.field` | `relative` | — | relative positioned only so `.count` can absolute-position over the input on overflow | :207 |
| `.input` | static | — | full-width text input, bottom border only, font 17px | :209–213 |
| `.bottom` | **static** (NOT fixed) | — | flex row at natural bottom of `.page`, pushed there by `.step { flex:1 }` | :237 |

**No `position: fixed` anywhere in this file. No z-index anywhere in this file.** The backlog memory's hypothesis was carried over from the D3 plaza pattern (which IS `position: fixed; z:1100`) and does not match what's actually in onboarding.

### What the existing safe-area padding solves vs doesn't

`.page` at line 190: `padding-bottom: calc(24px + env(safe-area-inset-bottom, 0px))`.

- ✅ **Solves (closed-keyboard state)**: iPhone home-bar overlap. `.bottom` sits 24px above the home bar instead of butting against it.
- ✅ **Solves (closed-keyboard state)**: visual breathing room — `.bottom` doesn't touch the bottom edge of the viewport.
- ❌ **Does NOT solve (keyboard-up state)**: keyboard occlusion. `env(safe-area-inset-bottom)` is the home-bar inset (~34px on iPhone 12+), not the keyboard inset. The keyboard rises ~250–340px above the bottom edge depending on device + IME; that's an order of magnitude larger than the safe-area padding compensates for.

### Why `.bottom` ends up occluded (and sometimes the input too)

Three combining factors:

1. **`.step` has `flex: 1` (line 204)** — it expands to absorb the gap between `.progress` and `.bottom`. The input sits at the **top** of `.step` (after title + sub + label), while `.bottom` sits at the **bottom of `.page`** (pushed there by `.step`'s expansion).
2. **`.page` has `min-height: 100vh` (line 186)**. Soft keyboard rise does NOT shrink `100vh` on H5 (visual viewport shrinks but layout viewport doesn't — see §3.1). On mp-weixin, `vh` re-evaluation against `wx.getSystemInfoSync().windowHeight` is base-library-version-dependent (see §3.2). The layout effectively stays the size of the pre-keyboard viewport.
3. **No keyboard-height handling exists in `onboarding/index.vue`.** The script imports `vue` lifecycle hooks, `useI18n`, `useAuth`, `useTheme`, `useSupabase`, `useItems`, `compressImage`, `CURRENT_CONSENT_VERSION` (lines 71–79). It does **not** import `useKeyboardHeight` (the composable that DOES exist at `app/src/composables/useKeyboardHeight.ts` — see §2.5). No `visualViewport`, no `uni.onKeyboardHeightChange`, no `@focus`/`@blur` handlers anywhere in the file (verified by reading the entire 253-line file).

Net effect: when the soft keyboard rises, it occupies the bottom ~250–340px of the visible viewport. `.bottom` (anchored to the bottom of the still-full-height `.page`) sits in that occluded band. On smaller devices (e.g. iPhone SE 3rd gen, ~568px logical viewport), the input itself can fall at viewport y ≈ 240px while the keyboard top is at viewport y ≈ 280px — the input's bottom edge clips into the keyboard. On taller devices (iPhone 14/15, Android flagships), the input is comfortably above the keyboard but `.bottom` is fully buried. Eric's "OR" wording in the bug report ("partially covers the input field **OR** the bottom CTA buttons") reflects this device-class split — both symptoms exist, on different device tiers.

---

## §2 Input element attributes audit

Verbatim attributes on the `<input>` at `app/src/pages/onboarding/index.vue:16–22`:

```html
<input
  v-model="nickname"
  :placeholder="t('login.nickname')"
  class="input"
  maxlength="40"
  autocomplete="nickname"
/>
```

Five attributes set explicitly, **six relevant attributes silently using uni-app defaults**. Per uni-app `<input>` docs:

| Attribute | Set? | Value | Platform that honors it | Default if absent |
|---|---|---|---|---|
| `v-model` | ✅ | `nickname` (ref<string>) | both | n/a |
| `placeholder` | ✅ | `t('login.nickname')` (i18n key) | both | n/a |
| `class` | ✅ | `input` (scoped, lines 209–213) | both | n/a |
| `maxlength` | ✅ | `40` | both | unlimited |
| `autocomplete` | ✅ | `nickname` | **H5 only** (mp-weixin ignores; mp uses native IME selection) | n/a (off on mp) |
| `adjust-position` | ❌ (implicit) | — | **mp-weixin only** | `true` (system scrolls focused input above keyboard) |
| `cursor-spacing` | ❌ (implicit) | — | **mp-weixin only** | `0` (no px gap above keyboard when scrolled) |
| `confirm-type` | ❌ (implicit) | — | **mp-weixin only** | `"done"` (keyboard's bottom-right key label) |
| `hold-keyboard` | ❌ (implicit) | — | **mp-weixin only** | `false` (keyboard dismisses on tap-outside) |
| `auto-focus` / `focus` | ❌ | — | both (differently — see uni-app docs) | `false` |
| `@focus` / `@blur` / `@input` | ❌ | — | both | no listeners |

### Implications of using defaults

- **mp-weixin** runs with `adjust-position="true"` implicitly. When user taps the input, the WeChat runtime scrolls the focused element into view above the keyboard, with a `cursor-spacing` of 0 (no gap). This is a **partial mitigation** — it handles the input's vertical position but does NOT lift sibling elements. `.bottom` remains buried (by design per uni-app docs and confirmed by D3 audit §3.2: `adjust-position` only moves the focused element).
- **H5** ignores all four mp-only attributes. Browsers may or may not scroll the focused input into view depending on engine — modern iOS Safari and Chrome Android typically do scroll the focused element above the keyboard, but the heuristic depends on whether the input is within a scrollable ancestor. `.page` is the body-level container and is **not** scrollable (no `overflow` declared); the document itself scrolls if `.page` exceeds viewport. In practice the input scrolls into view via document scroll, but `.bottom` (being below the input in document order) is still occluded by the keyboard. **(reasoned, not real-device verified)**

### §2.5 Composable status — `useKeyboardHeight` exists and is production-tested

A grep for `useKeyboardHeight` across `app/src/` returns two relevant matches (one definition + one consumer):

| Path | Role |
|---|---|
| `app/src/composables/useKeyboardHeight.ts` (197 lines) | The composable itself; shipped via N7-redux D3 sprint 2026-05-10; cross-platform (H5 `visualViewport` + mp-weixin `uni.onKeyboardHeightChange` via conditional compile); 50ms debounce + 50px `minThreshold` defaults; `subtractIosSafeArea` opt (default `false`); setup-scoped lifecycle |
| `app/src/pages/plaza/index.vue:435, :453` | Imports + invokes the composable (sole production consumer prior to this audit; D3 sprint deliverable) |

I separately confirmed `chat/index.vue` does NOT use `useKeyboardHeight` (it uses `adjust-position="true"` on its message input at `chat/index.vue:149` per D3 audit §2 — that's the platform-level keyboard hint, NOT the composable).

**This is the single most important finding of the audit**: the fix doesn't require building new infrastructure. Fix candidate F5 ("build new composable from scratch") is moot — the production-tested composable is available, plaza has been live with it since 2026-05-10, and the API is exactly what onboarding needs.

---

## §3 Cross-platform keyboard-up behavior (reasoned)

### §3.1 H5 (browser, mobile Safari + Chrome Android)

When the user taps the nickname input:

- **Browser viewport behavior**: iOS Safari does NOT auto-resize the layout viewport when the keyboard opens — only the visual viewport shrinks. **(verified by spec — `useKeyboardHeight.ts:18–23` documentation and D3 audit §3 cite the production-confirmed Apple behavior)**. Android Chrome 108+ default `interactive-widget=resizes-visual` matches this. **(verified by spec — Chrome release notes via D3 audit §3.4)**
- **`.page { min-height: 100vh }` consequence**: 100vh is computed against the layout viewport, which has not shrunk. `.page` keeps its full height. `.bottom` stays anchored to the bottom of that fixed-height page (which now extends below the visible-above-keyboard area). **(reasoned)**
- **Focused-input scroll-into-view**: the user agent typically scrolls the focused element to keep it visible above the keyboard. Mobile Safari (iOS 15+) does this; Chrome Android does this. The scroll target is the **input element only** — sibling `.bottom` is not part of the focused element's layout context and does not auto-scroll. **(reasoned, sourced from W3C scroll-into-view-if-needed semantics + D3 audit §1 analogous treatment of plaza composer)**
- **Result on tall devices**: input scrolled into view; `.bottom` remains at the bottom of `.page` = behind the keyboard. **CTA occluded.**
- **Result on small devices (iPhone SE 3rd gen, ~568px logical viewport)**: rough calculation of input's natural Y position pre-scroll:

  | Element | Approx height (px) | Running Y |
  |---|---|---|
  | Status bar inset | 44 | 44 |
  | `.page` padding-top (20 + status-bar-height) | ~64 total above content | 64 |
  | `.progress` (pdot 4px + padding 8 top, 24 bottom) | 36 | 100 |
  | `.step` padding-top | 12 | 112 |
  | `.title` (22px font, ~1.45 line-height) | ~32 | 144 |
  | gap (10px) | 10 | 154 |
  | `.sub` (14px font, ~1.5 line-height + margin-bottom 16) | ~37 | 191 |
  | gap (10px) | 10 | 201 |
  | `.field` `.label` + gap 8 + input pad 10 + 17px text + pad 10 | ~16 + 8 + 37 = ~61 | ~262 |

  Input bottom edge lands at ~262px; iPhone SE keyboard top is at ~280px. **The input is 18px from clipping into the keyboard** before any auto-scroll runs, and document scroll engagement depends on whether `.page` height exceeds visible viewport. With `min-height: 100vh` and no overflow declaration, document scroll may or may not engage. **(reasoned, not real-device verified)** This matches the "partially covers the input" half of Eric's report.

### §3.2 mp-weixin

- **`adjust-position` default = `true`**: the WeChat runtime scrolls the focused input above the keyboard automatically, per uni-app docs. `cursor-spacing` default `0` means it scrolls until the input's bottom edge aligns with the keyboard top. **(verified by spec — uni-app docs; D3 audit §4 corroborates)**
- **Effect on `.bottom`**: `adjust-position` only moves the focused element. `.bottom` is a sibling-of-an-ancestor of the focused input (specifically: input is inside `.step > .field`; `.bottom` is a sibling of `.step` inside `.page`). The runtime does not lift sibling elements. **(verified by spec — D3 audit §3.2 cites this constraint exactly)**
- **`.page { min-height: 100vh }` on mp-weixin**: `vh` resolves against `wx.getSystemInfoSync().windowHeight`. Some base-library versions update `windowHeight` post-keyboard; others don't. Behavior is base-library-version dependent. **(reasoned — uncertain; needs real-device verification, tagged in §7)**
- **Skyline renderer check**: `app/src/pages.json:119–122` for onboarding:
  ```json
  { "path": "pages/onboarding/index", "style": { "navigationStyle": "custom" } }
  ```
  **No `"renderer": "skyline"` configuration.** Onboarding runs the default WebView renderer on mp-weixin. The Skyline fold-collapse quirk (D3 audit §4 risk 1) is **not applicable**.
- **Result**: input scrolled into view by runtime; `.bottom` remains at the bottom of `.page` regardless of `adjust-position`; CTA occluded.

### §3.3 Cross-platform divergence summary

| Element | H5 behavior on keyboard-up | mp-weixin behavior on keyboard-up |
|---|---|---|
| `<input>` (focused) | Browser scroll-into-view (limited by `.page` non-scrollability); partially clipped on small phones | `adjust-position` lifts input bottom edge to keyboard top with 0 cursor-spacing |
| `.bottom` (CTA row) | Stays at bottom of `.page` (100vh layout viewport doesn't shrink); **occluded** | Stays at bottom of `.page` regardless of `adjust-position`; **occluded** |
| `.step` (flex:1) | No layout change — keyboard overlay only | Same as H5 (unless `vh` re-evaluates per base lib — see §3.2) |
| `.progress` (top) | Always visible (above the keyboard reach) | Always visible |

→ **The bug manifests on BOTH platforms via the SAME structural cause** (no keyboard-height awareness in onboarding's layout), with different secondary patterns:
- H5: input may also clip on small phones (no platform-level rescue).
- mp-weixin: input is rescued by runtime default (`adjust-position`), but CTA is never lifted on any platform.

---

## §4 Root-cause hypotheses (ranked)

### H1 — No keyboard-height handling in onboarding (HIGH confidence)

**Mechanism**: `.page` is `min-height: 100vh; display: flex; flex-direction: column` with `.step` as `flex:1` and `.bottom` as a static flex child at the bottom. When the soft keyboard rises, the effective-visible-viewport-height shrinks but `.page` does not — `.bottom` remains at the original viewport bottom, which is now covered by the keyboard.

**Evidence**:
- `app/src/pages/onboarding/index.vue:186` — `.page { min-height: 100vh }`
- `app/src/pages/onboarding/index.vue:204` — `.step { flex: 1 }`
- `app/src/pages/onboarding/index.vue:237` — `.bottom { display: flex; gap: 10px; padding-top: 16px }` (static, no `position` declared)
- `app/src/pages/onboarding/index.vue:71–79` — script `import`s do NOT include `useKeyboardHeight` (script has only Vue lifecycle, i18n, auth, theme, supabase, items, compressImage, consent)
- D3 audit §3.1 — confirms `min-height: 100vh` parents don't shrink for keyboard on H5

**Confidence**: HIGH. Code-evidence-supported; matches Eric's reported symptom directly (CTA occluded on tall screens; input occluded on shorter screens).

### H2 — Missing explicit `adjust-position` / `cursor-spacing` on `<input>` (MEDIUM-LOW confidence)

**Mechanism**: On mp-weixin, the input lacks explicit `:adjust-position="true"` and `:cursor-spacing` attributes. Implicit defaults DO apply (`adjust-position=true`, `cursor-spacing=0`) per uni-app docs, so the input scrolls into view automatically. **However**, the default `cursor-spacing=0` means the input sits flush against the keyboard top — no breathing room. This is a UX polish concern on mp-weixin (cramped feel), NOT the root cause for the primary symptom (CTA occlusion).

**Evidence**:
- `app/src/pages/onboarding/index.vue:16–22` — attribute audit (§2)
- `app/src/pages.json:119–122` — no Skyline renderer override
- uni-app `<input>` docs — `adjust-position` defaults to `true`; `cursor-spacing` defaults to `0`

**Confidence**: MEDIUM-LOW. Hypothesis is partially supported (defaults DO leave the input cramped on mp-weixin) but is a **secondary factor**, not a root cause for the CTA occlusion.

### H3 — `min-height: 100vh` should be `100dvh` (LOW confidence, tangential)

**Mechanism**: Project memory (`opencode/CAACI_Community_Marketplace_Bazaar.md` line 258) notes "iOS Safari toolbar 误判 vh ... 用 dvh 不用 vh (commit `5a6082b` 教训)". Onboarding still uses `100vh` (line 186) — `dvh` adoption was per-fix, not yet codebase-wide.

**Evidence**:
- `app/src/pages/onboarding/index.vue:186` — `min-height: 100vh` (not `dvh`)
- Project memory line 258 — `dvh` lesson learned but not retroactively applied

**Confidence**: LOW. `dvh` tracks dynamic browser chrome (URL bar collapse) and does NOT track keyboard. Switching to `dvh` would NOT fix keyboard occlusion. This is a **separate hygiene concern** orthogonal to the present bug; out of scope.

### H4 — Falsification: `.bottom` is NOT `position: fixed` (HIGH confidence)

**Mechanism**: The backlog memory (`docs/memory/backlog_onboarding_keyboard_occlusion.md:11`) hypothesised "`position: fixed` `.bottom` interacting with soft keyboard rise". This is **falsified** by reading `app/src/pages/onboarding/index.vue:237` — `.bottom { display: flex; gap: 10px; padding-top: 16px }` — no `position` declared. Default is `static`. It participates in the parent's flex column flow.

**Why this matters for fix design**: a fix targeted at "lift a fixed-positioned `.bottom`" (e.g. adjusting `bottom: ${kbHeight}px`) would miscarry. The actual fix must operate on a **static-flow** `.bottom`. Transform-based lifting (CSS `transform: translateY(-${kbHeight}px)`) works on any positioning context because transform is a paint-level operation. Padding-based lifting on `.page` interacts differently with static-flow children. §5 fix candidates respect this constraint.

**Evidence**:
- `app/src/pages/onboarding/index.vue:237` — verbatim CSS
- Direct file inspection (no `position:` declared for `.bottom` anywhere in the file's `<style>` block)

**Confidence**: HIGH (this is a falsification on observable code, not a hypothesis on behavior).

### Ranking summary

| H# | Confidence | Role |
|---|---|---|
| **H1** | **HIGH** | **Primary root cause** (CTA occlusion universal; input occlusion on small phones) |
| H4 | HIGH (falsification) | Forces fix design to handle static-flow `.bottom` correctly (rules out `bottom: ${k}px` patterns) |
| H2 | MEDIUM-LOW | Secondary mp-weixin polish concern (default `cursor-spacing=0` is cramped) — not root cause |
| H3 | LOW | Tangential hygiene (`dvh` adoption) — out of scope |

---

## §5 Fix candidates (ranked)

### F1 — Add explicit `:adjust-position="true"` + `:cursor-spacing="20"` (+ optional `confirm-type="done"`) to `<input>`

| Property | Value |
|---|---|
| Files touched | 1 (`app/src/pages/onboarding/index.vue` template lines 16–22) |
| Platform compat | mp-weixin only (H5 ignores all three attributes; no effect on H5 symptom) |
| Risk | Very low — makes implicit default explicit; adds 20px breathing room above keyboard on mp-weixin |
| Commit size | ~2–3 lines |

**Effect**: explicit attribute makes the mp-weixin runtime's behavior obvious to future readers; cursor-spacing 20 adds a 20px gap above the keyboard (vs default 0). **Does NOT fix CTA occlusion on either platform.**

- **H5**: zero behaviour change (mp-only attributes).
- **mp-weixin**: minor visual improvement to input (20px breathing room). CTA still occluded.
- **Step 2/3 impact**: none (no keyboard interaction).
- **i18n / dark-mode / a11y**: untouched.

### F2 — Wire `useKeyboardHeight` composable; apply `transform: translateY(-${kb.height}px)` to `.bottom`

| Property | Value |
|---|---|
| Files touched | 1 (`app/src/pages/onboarding/index.vue`) |
| Platform compat | both (composable handles cross-platform via conditional compile) |
| Risk | Low — composable is production-tested on plaza since 2026-05-10; transform is GPU-composited, no layout reflow |
| Commit size | ~10–15 lines |

**Mechanism**:
1. `import { useKeyboardHeight } from '../../composables/useKeyboardHeight'` (1 line in script imports, e.g. line ~78)
2. `const kb = useKeyboardHeight()` in `<script setup>` (1 line, near the existing refs around line ~95)
3. Bind `:style="{ transform: \`translateY(-${kb.height}px)\` }"` on `<view class="bottom">` (template line 60)
4. Add `transition: transform 0.2s ease-out; will-change: transform;` to `.bottom` SCSS (line 237, ~2 lines)

**Effect**: when the keyboard rises, `.bottom` translates upward by the exact keyboard height (px), placing the CTA immediately above the keyboard. GPU-composited animation matches the keyboard's rise/fall smoothness (per D3 audit §5 candidate A — same pattern, same rationale).

- **H5**: composable wires `visualViewport` resize+scroll events; `kb.height` updates as keyboard rises; transform lifts `.bottom` above keyboard top. CTA visible.
- **mp-weixin**: composable wires `uni.onKeyboardHeightChange` via `onLoad`/`onUnload` page lifecycle; same outcome. Combined with the implicit `adjust-position=true` default on `<input>`, both input and CTA stay visible.
- **Step 2/3 impact**: composable returns `kb.height = 0` when no keyboard is open. On steps 2 and 3 the user doesn't focus any input (chips are tap-only, avatar picker uses `uni.chooseImage` which doesn't open keyboard). Transform value stays `translateY(0)` = no visual change.
- **i18n / dark-mode / a11y**: untouched. CSS `transform` does NOT alter document order, so screen-reader navigation is unchanged.

**Step 1 viewport overlap edge case**: when `.bottom` translates upward by `kb.height`, it slides into the area previously occupied by `.step`'s `flex:1` expansion. On step 1, that area is mostly empty whitespace below the input (input sits at top of `.step`; `.step` expands to fill rest). No overlap with content. **(reasoned, not real-device verified)**

**Composable settings**: use defaults (`minThreshold = 50`, `debounceMs = 50`, `subtractIosSafeArea = false`). Matches plaza behaviour for consistency.

### F3 — F1 + F2 combined

| Property | Value |
|---|---|
| Files touched | 1 |
| Platform compat | both |
| Risk | Low (no interaction risk between F1 and F2) |
| Commit size | ~15 lines |

**Effect**: belt-and-suspenders. F1 adds mp-weixin runtime breathing room for input (small UX polish); F2 lifts CTA across both platforms (the primary fix). Solves the "OR" in Eric's symptom report — both occlusion scenarios covered.

**Tradeoff vs F2 alone**: 3 extra lines for marginal mp-weixin input polish that's already partially handled by the runtime default. Not strictly necessary for the reported bug, but cheap.

### F4 — Apply `padding-bottom: ${kb.height}px` to `.page` instead of transform on `.bottom`

| Property | Value |
|---|---|
| Files touched | 1 |
| Platform compat | both (same composable) |
| Risk | Medium — interacts with existing `padding-bottom: calc(24px + env(safe-area-inset-bottom, 0px))`; layout reflow under keyboard not fully predictable when combined with `min-height: 100vh` and `flex:1` children |
| Commit size | ~10 lines |

**Mechanism**: `:style="{ paddingBottom: \`calc(24px + env(safe-area-inset-bottom, 0px) + ${kb.height}px)\` }"` on `.page`. The flex children re-flow — `.step` shrinks (because `flex:1` reabsorbs available space), `.bottom` slides up with the shrunken parent's bottom edge.

**Effect**: similar visual outcome to F2 but via layout reflow rather than transform compositing. Animation feels slightly less smooth (layout vs paint). The `.page` `min-height: 100vh` combined with growing padding may push the document scrollable, depending on how `min-height` interacts with the padded content height — this is the medium-risk part. **(reasoned)**

**Tradeoff vs F2**: F4 is "semantically cleaner" (the modal "knows" it's smaller) but F2 is smoother, atomic to `.bottom` only, and matches the D3 plaza pattern. Pick F2 unless real-device testing surfaces a transform-specific bug.

### F5 — Build new composable from scratch

**Status**: NOT APPLICABLE. `useKeyboardHeight` already exists at `app/src/composables/useKeyboardHeight.ts` (197 lines, fully documented, shipped via N7-redux D3 sprint 2026-05-10, production-live on plaza). Listed only to acknowledge the audit template option; the value-add of this candidate is zero.

### Fix candidate summary

| # | Description | Files | Platform compat | Risk | LOC |
|---|---|---|---|---|---|
| F1 | Explicit `adjust-position` + `cursor-spacing` on `<input>` | 1 | mp only | Very low | 2–3 |
| **F2** | **Transform `.bottom` via `useKeyboardHeight`** | **1** | **both** | **Low** | **10–15** |
| F3 | F1 + F2 combined | 1 | both | Low | 15 |
| F4 | Padding-bottom on `.page` via composable | 1 | both | Medium | 10 |
| F5 | Build new composable | — | — | — | n/a (composable exists) |

---

## §6 Recommended fix path

**Recommended: F2 — wire `useKeyboardHeight` composable, transform `.bottom`.**

**Justification**:
1. **Smallest atomic fix solving the primary symptom (CTA occlusion).** ~10–15 LOC, one file, no new dependencies. H1 is the verified root cause for the universal symptom; F2 directly targets H1.
2. **Reuses production-tested infrastructure.** `useKeyboardHeight` shipped via D3 (2026-05-10), has been live on plaza ever since, and its API exactly matches what onboarding needs. No new abstractions, no new risk.
3. **Safe for the other platform.** Both H5 and mp-weixin code paths in the composable are conditional-compiled (`// #ifdef`). The CSS `transform` binding works identically on both platforms (`transform` support is universal in WXSS and modern browsers). On mp-weixin, F2 layers cleanly on top of the implicit `adjust-position=true` default — they target different elements (`adjust-position` moves the focused input; transform moves `.bottom`).
4. **One-commit, fix-only sprint.** No composable changes, no spec discussion, no design tokens, no i18n keys. The implementer reads this audit, makes 4 changes (1 import, 1 ref binding, 1 `:style`, 1 SCSS transition), commits, three-greens, done.
5. **Step 2/3 are zero-impact.** No input focus → `kb.height = 0` → no transform applied.

**Why NOT F3 (F1 + F2)**: F1 adds 20px cursor-spacing breathing room on mp-weixin only — marginal benefit since uni-app's runtime default `adjust-position=true` + `cursor-spacing=0` is already in effect. Adds 3 LOC for a quality-of-life polish that's not needed to solve Eric's reported symptom. **Recommend layering F1 in a separate follow-up sprint IF real-device testing on mp-weixin shows the input feels uncomfortably close to the keyboard top.**

**Why NOT F4**: padding-bottom on `.page` causes layout reflow (vs transform's paint-only operation). Animation is less smooth, and the interaction between growing `padding-bottom`, `min-height: 100vh`, and `flex:1` children is not fully predictable without real-device testing. F2 is strictly safer unless F2 itself surfaces a transform-specific bug.

**Why NOT F5**: composable already exists; F5 is moot.

### Post-fix verification checklist (for next sprint)

1. **Local three-green** (`npm run type-check` (vue-tsc --noEmit) + `npm run build:h5` + `npm run build:mp-weixin`). Per `docs/memory/pre_push_three_green.md`.
2. **H5 smoke test** (`npm run dev:h5`):
   - Tap nickname input → confirm `.bottom` lifts smoothly above keyboard
   - Type a character → CTA still visible
   - Tap outside input or hit "done" → keyboard dismisses, `.bottom` returns to original position with smooth transition
   - Advance to step 2 → no keyboard, no transform, layout identical to current
   - Back to step 1 → keyboard handling still works (composable still bound)
3. **Real-device test (H5)**: at minimum, iOS Safari (iPhone 14/15 + iPhone SE 3rd gen) and Android Chrome (Pixel-class device). Verify (a) CTA visible above keyboard on tall device; (b) input AND CTA visible on small device; (c) no jank during keyboard rise/fall; (d) `.bottom` slides smoothly, not jumpy.
4. **Real-device test (mp-weixin)** [deferred per `docs/memory/pre_push_three_green.md` V1.1 stance]: at least one iPhone + one Android with WeChat latest stable. Verify same checks. Confirm mp-weixin's `vh` behavior under keyboard (see §7 unknown 1).
5. **Regression check**: verify plaza composer (existing D3 consumer of `useKeyboardHeight`) still works on real device — confirming no global side-effect from a second setup-scoped consumer (should be impossible since composable is per-instance, but worth a 30-second spot check).
6. **Sprint commits as one PR**: branch `fix/v35-onboarding-keyboard` (or similar); squash-merge via PR per `docs/memory/pr_merge_squash_policy.md` (`main` is protected, direct push rejected).

Fix sprint estimated total work: **~30 min implementation + ~15 min three-green + ~30–60 min real-device test = ~1.25–1.75 hours** for an implementer familiar with the codebase.

---

## §7 Open questions / unknowns

These cannot be resolved by static audit; real-device verification or runtime experimentation needed in the fix sprint.

1. **mp-weixin `100vh` re-evaluation on keyboard open**: §3.2 hypothesised that `100vh` on mp-weixin might re-evaluate against `wx.getSystemInfoSync().windowHeight` post-keyboard, depending on base library version. If `vh` shrinks, `.bottom` partially self-lifts even without F2 — F2's transform would then over-correct (lift further than needed). However: F2's transform binds to `kb.height` which is the keyboard inset specifically (not the page-height delta), so the visible position should still be correct. Real-device verification on at least one Android mp-weixin and one iOS mp-weixin will confirm. **Tag: needs real-device check on mp-weixin.**

2. **iOS Safari minimum viewport edge case**: on iPhone SE-class screens (smallest in current iPhone lineup, ~568px logical), the input might clip into the keyboard despite browser scroll-into-view (because `.page` is the full document and document scroll may not engage when `min-height: 100vh` already covers the layout viewport). F2 doesn't help the input itself (only `.bottom`). If real-device test on iPhone SE confirms the input clips, a follow-up sprint can either (a) add F1 (mp-only — doesn't help H5 on SE), (b) reduce padding above the input (e.g. trim title font-size or progress dots padding), or (c) wrap step body in a `scroll-view` (more invasive). **Tag: needs real-device check on iPhone SE 3rd gen.**

3. **Composable `subtractIosSafeArea` default choice**: F2 uses the composable's default (`subtractIosSafeArea = false` → raw height includes iOS home-bar inset of ~34px, producing "breathing room above keyboard" on iOS mp-weixin). Matches plaza behavior for consistency. Eric may prefer the alternative (subtract → exact-to-keyboard-top, no gap, classic iMessage). Should align with plaza's actual UX preference. **Tag: needs Eric confirm of UX preference (default `false` recommended for consistency with plaza).**

4. **`onMounted` stacking with composable's own `onMounted`** (H5 path): `app/src/pages/onboarding/index.vue:99` already declares `onMounted(() => { ... profile pre-fill ... })`. The composable's H5 path internally calls `onMounted(() => { ... baseline + listener setup ... })`. Vue 3 stacks lifecycle hooks (multiple `onMounted` registrations all run); confirmed by Vue docs. **(verified by spec)** No conflict expected, but a 10-second build/run test will confirm.

5. **Reaching onboarding via `uni.reLaunch` from login** (`login/index.vue:363`): `reLaunch` discards the page stack and creates a fresh page. Both `onLoad` (mp-weixin) and `onMounted` (H5) fire on the new instance. Composable initialises cleanly. **(verified by spec — uni-app docs.)** No concern.

6. **Composable cleanup on step advance and on `uni.switchTab` exit**: stepping 1 → 2 → 3 doesn't navigate away (single page, `v-if` switches step content). The composable's listener stays registered throughout (correct — keyboard might still be summoned by external IME triggers, but in practice steps 2/3 don't focus inputs). When user finishes (`uni.switchTab` at line 170 → `pages/index/index`), the page unloads → `onUnload`/`onUnmounted` fires → composable cleans up. **(verified by spec — `useKeyboardHeight.ts:151–161` for H5, `:186–193` for mp-weixin.)** No leak.

7. **vue-tsc strict mode on `kb.height` access in template**: the composable returns `Ref<number>` for `height`. Template `${kb.height}` auto-unwraps. No type cast needed. **(verified by spec — Vue 3 + vue-tsc handles `Ref` unwrap in template context.)** Three-green should pass cleanly.

---

**End of audit.**
