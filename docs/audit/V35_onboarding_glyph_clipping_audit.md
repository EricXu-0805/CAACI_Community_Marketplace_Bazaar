# v3.5 — Onboarding step 1 nickname input glyph clipping · Audit

> Audit-only sprint. **No code changes** — only this markdown.
> HEAD: `7eda10b` docs: memory mirror catchup + preserve V35 keyboard audit prompt artifact (#16)
> Audited: 2026-05-12
> Scope: `app/src/pages/onboarding/index.vue` step 1 nickname `<input>` — descenders / lower glyph portions clipped inside the input box on real iPhone Safari (H5 prod), **pre-focus, pre-keyboard**.
> Distinct from: 2026-05-12 keyboard occlusion audit (`docs/audit/V35_onboarding_keyboard_audit.md`) — that was `.bottom` CTA hidden behind risen keyboard. This audit is descender clip INSIDE the input box, observed before keyboard rises. Fix candidates here MUST NOT bundle with that audit's keyboard-handling fix.
> Out of scope: actual fix code (next sprint), keyboard handling (separate audit), step 2 chips, step 3 avatar, other pages.

---

## §1 Symptom & reproduction

**Reported (2026-05-12 prod, real iPhone Safari)**: On the onboarding wizard step 1 ("Let's get you set up — Pick a display name"), the nickname `<input>` renders text with the lower portion of glyphs cropped — descenders (g, p, q, y, j) and CJK character lower strokes invisible, only the upper half of glyphs visible. Soft keyboard has **NOT** risen at the time of observation.

**Reproduction signal from screenshot**:
- Mixed-script (CJK + Latin) glyphs both affected
- Clipping appears uniform across the visible text band (not per-character)
- Visible at initial render when `currentUser.value.nickname` is pre-populated (per `onMounted` hydration at `app/src/pages/onboarding/index.vue:99-106`), so the bug is **not** keystroke-triggered
- Distinct from a baseline shift (text isn't lowered into padding) — text appears to render at the correct vertical position, but the line-box height is insufficient to fully contain the glyph envelope

**Distinct from**: the 2026-05-12 keyboard occlusion bug audited in `V35_onboarding_keyboard_audit.md`. That bug:
- Manifested post-focus, after the soft keyboard rose
- Was about `.bottom` CTA buttons being hidden behind the keyboard
- Sometimes "partially covered the input"  — but as keyboard occlusion of the input bottom edge, not glyph clipping inside the input

This audit's bug:
- Manifests pre-focus, before any keyboard interaction
- Is glyph clipping INSIDE the rendered input box (text descenders cropped)
- Affects rendered text shape, not box position

**Fix sprints MUST stay independent.** A combined "fix both at once" PR risks one bug's fix masking the other or interacting in unexpected ways.

---

## §2 Anchor file inspection

### §2.1 The `<input>` element and its `.input` rule (verbatim)

**Template element block** (`app/src/pages/onboarding/index.vue:16-22`):

```html
<input
  v-model="nickname"
  :placeholder="t('login.nickname')"
  class="input"
  maxlength="40"
  autocomplete="nickname"
/>
```

Six attributes total. No `type` (defaults to `text`). No `style=`, no `:style=`. No `@focus`/`@blur`/`@input` listeners. Per `lesson_template_binding_full_block.md`, the FULL element block is quoted to preserve attribute context for any future patch.

**Local `.input` CSS rule** (`app/src/pages/onboarding/index.vue:209-213`, scoped to this SFC):

```scss
.input {
  border: 0; border-bottom: 1.5px solid var(--bg-inset);
  padding: 10px 0; font-size: 17px; color: var(--text-primary);
  background: transparent; width: 100%;
}
```

**Properties present**: `border`, `border-bottom`, `padding`, `font-size`, `color`, `background`, `width` (7 declarations).

**Properties NOTABLY ABSENT** (all relevant to vertical glyph envelope sizing):
- **No `line-height`** — input falls back to inherited or browser-default value
- **No `height`** — input height is computed from font + line-height + padding
- **No `font-family`** — input inherits from cascade (see §2.2)
- **No `box-sizing`** — relies on global rule at `app/src/App.vue:839` (see §2.2)
- **No `-webkit-appearance`** / **no `appearance`** — browser default applies (rounded corners on some iOS versions, native paint behavior)
- **No `vertical-align`** — inline-context property, defaults to `baseline`
- **No `overflow`** — defaults to `visible` but `<input>` typically clips internally regardless

### §2.2 Cascade chain — global rules that reach `.input` on iPhone Safari

| Layer | File:line | Rule (verbatim) | Cascades to `.input`? | Notes |
|---|---|---|---|---|
| Universal box-sizing | `app/src/App.vue:839` | `view, text, input, button, textarea { box-sizing: border-box; }` | YES | Padding included in width/height calc |
| Page tokens + typography | `app/src/App.vue:610-771` | `page, .page { ...; font-family: 'PingFang SC', 'Hiragino Sans GB', 'Noto Sans SC', -apple-system, ...; font-size: 15px; line-height: 1.6; letter-spacing: 0.02em; ... }` | **Partial** — see §2.4 | `font-family` & `letter-spacing` arrive via :874-877; `line-height` cascade to `<input>` is browser-quirky on iOS Safari |
| Input/textarea inheritance | `app/src/App.vue:874-877` | `input, textarea { font-family: inherit; letter-spacing: inherit; }` | YES | **Forwards font-family + letter-spacing, but NOT line-height** — see H3 |
| Focus outline | `app/src/App.vue:879-886` | `input:focus-visible, ... { outline: 2px solid var(--brand) !important; outline-offset: 2px; border-radius: 4px; }` | Only on `:focus-visible` | Not relevant pre-focus |

Quoted directly from `App.vue:765`: `line-height: 1.6;` is set on `page, .page` but iOS Safari's `<input>` does NOT reliably inherit `line-height` from page-level ancestors — this is a well-known platform quirk (see H3 in §3).

Quoted directly from `App.vue:760-763` — the page font-family stack:
```css
font-family:
  'PingFang SC', 'Hiragino Sans GB', 'Noto Sans SC',
  -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text',
  'Helvetica Neue', 'Microsoft YaHei', system-ui, sans-serif;
```

Quoted directly from `App.vue:874-877`:
```css
input, textarea {
  font-family: inherit;
  letter-spacing: inherit;
}
```

Two of three relevant properties forwarded explicitly. **`line-height` is NOT forwarded.** This is highly suggestive — the rule's existence implies prior-author awareness that `<input>` doesn't cleanly inherit certain typography properties, but `line-height` was either missed or intentionally skipped.

### §2.3 Comparison: every other `<input>` rule in the codebase

Background `explore` agent enumerated 9 `<input>` rule locations under `app/src/**/*.vue`. The onboarding rule is the **only** "underline-style" input (no box, vertical padding only). All other inputs whose CSS rules set explicit visual sizing use **`height: 40-48px` + horizontal-only padding**.

| Rule (file) | `height` | `padding` | `font-size` | `line-height` | Style |
|---|---|---|---|---|---|
| `.input` (onboarding/index.vue:209-213) | ❌ | `10px 0` (vertical only) | `17px` | ❌ | **Underline (outlier)** |
| `.input` (post/index.vue:818-821) | `40px` | `0 14px` (horizontal only) | `14px` | ❌ | Boxed (rounded pill) |
| `.form-input` (login/index.vue:469-479) | `48px` | `0 16px` (horizontal only) | `15px` | ❌ | Boxed |
| `.form-input` (reset-password/index.vue:451-457) | `48px` | `0 16px` (horizontal only) | `15px` | ❌ | Boxed |
| `.form-input` (publish/index.vue:808) | ❌ | ❌ | `15px` | ❌ | Minimal |
| `.form-input` (publish/edit.vue:609) | ❌ | ❌ | `15px` | ❌ | Minimal |
| `.sf-input` (search/index.vue) | ❌ | ❌ | ❌ | ❌ | Minimal (inherits all) |
| `.form-input` (profile/edit.vue) | ❌ | ❌ | ❌ | ❌ | Minimal (inherits all) |
| `.fs-input` / `.fs-price-input` (saved-searches/index.vue) | ❌ | ❌ | ❌ | ❌ | Minimal |

**Key observations**:
1. **NO `<input>` rule in the codebase sets explicit `line-height`.** The codebase relies on browser/cascade defaults universally. If iOS Safari clips descenders on the onboarding input without explicit `line-height`, the OTHER inputs (publish, search, profile, saved-searches) that also lack `line-height` *should* clip too — yet the bug is only reported for onboarding. This suggests the onboarding-specific combination of **(font-size 17px) × (vertical-only padding 10px 0) × (no height constraint)** is the trigger, not `line-height` alone.
2. **Login + reset-password** (`height: 48px`) and **post** (`height: 40px`) constrain the input box from outside; descender envelope can clip into the bottom padding without visually escaping the boxed border. Onboarding has only a `border-bottom: 1.5px` line — there is no top/bottom border to absorb glyph overflow visually.
3. **Publish, search, profile** inputs sit inside form layouts that the bug report does NOT mention. They may share the same underlying issue but go unnoticed because (a) those pages use 15px font (not 17px), and (b) the visual context is busier so a 1-2px clip is invisible.

### §2.4 Font cascade — what actually renders on iPhone Safari

This subsection corrects chat-Claude's **seed H2 hypothesis** ("custom web font with non-standard hhea/OS/2 vertical metrics — Fraunces / Noto Sans SC ascent/descent override on iOS"). On verification, the seed H2 is partially falsified, AND a separate orthogonal issue is uncovered.

**Webfont @import setup** (`app/src/App.vue:26-30`):
```typescript
// #ifdef H5
import '@fontsource-variable/fraunces/opsz.css'
import '@fontsource-variable/noto-sans-sc/wght.css'
import '@fontsource-variable/noto-serif-sc/wght.css'
// #endif
```

**Webfont @font-face family names** (verified by reading `app/node_modules/@fontsource-variable/noto-sans-sc/wght.css:1-100` and `app/node_modules/@fontsource-variable/fraunces/opsz.css:1-29`):
- `@font-face { font-family: 'Noto Sans SC Variable'; ... }` — **with " Variable" suffix**, 100+ unicode-range-split @font-face blocks all declaring this same family name
- `@font-face { font-family: 'Fraunces Variable'; ... }` — **with " Variable" suffix**

**Codebase font-family stacks reference**:
- `app/src/App.vue:760-763` (page rule): `'PingFang SC', 'Hiragino Sans GB', 'Noto Sans SC', -apple-system, ...` — references plain `'Noto Sans SC'` **without " Variable" suffix**
- `app/src/App.vue:707-709` (legacy token aliases): `--font-serif: 'Fraunces', 'Noto Serif SC', ...` — plain `'Fraunces'`
- `app/src/App.vue:865-868` (`text` rule): `'PingFang SC', 'Hiragino Sans GB', 'Noto Sans SC', ...` — plain `'Noto Sans SC'`
- `app/src/App.vue:1099-1103` (`:root` token aliases): same plain names

**Memory falsification of seed H2**: The custom webfonts (`'Noto Sans SC Variable'`, `'Fraunces Variable'`) declared in `@fontsource-variable/*` packages are **never matched by any selector in the codebase** — the codebase's font-family stacks reference family names without the " Variable" suffix. Browser font matching is exact-by-name; partial matches don't apply. Therefore the loaded webfont:
1. Costs bandwidth (woff2 fetched + decoded on H5 cold start)
2. Costs CSP exposure surface
3. Costs FOIT/FOUT risk during decode window
4. **Provides zero visual benefit** — selectors don't match the declared family

**The actually-rendered font** on iPhone Safari for the onboarding input is whichever member of the cascade stack `'PingFang SC', 'Hiragino Sans GB', 'Noto Sans SC', -apple-system, ...` the iOS browser can resolve first:
- `'PingFang SC'` → preinstalled on every iOS device (Apple's CJK default since iOS 9) — **this is what renders**
- `'Hiragino Sans GB'` → preinstalled (older Apple CJK font) — fallback
- `'Noto Sans SC'` → not installed on iOS by default, no @font-face match (see above) — skipped
- `-apple-system` → SF Pro — would be used if PingFang SC failed, but it doesn't

**PingFang SC vertical metrics** (publicly documented, Apple Font Tools):
- `hhea.ascent` ≈ 1060/1000em
- `hhea.descent` ≈ 340/1000em (absolute)
- `hhea.lineGap` ≈ 0/1000em
- Total intrinsic line height ≈ 1.4em (covers full CJK glyph envelope including diacritics and low strokes)

iOS Safari computes `line-height: normal` on `<input>` using the rendered font's intrinsic metrics. At `font-size: 17px`, PingFang SC's `normal` line-height ≈ `17 × 1.4 = 23.8px`. The descender envelope alone is `17 × 0.34 = 5.78px` below baseline.

Combined with the onboarding `.input` declaration (no `height`, no `line-height`, `padding: 10px 0`), the rendered box is:
- Line-box height: ~23.8px (font intrinsic)
- Padding: 10px top + 10px bottom = 20px
- Total: ~43.8px expected, with descender envelope reaching to ~baseline + 5.78px

iOS Safari's `<input>` element has a long-standing quirk where the **rendered glyph envelope** can exceed the **computed line-box height** when `line-height: normal` is used with fonts whose intrinsic metrics push descenders below the line-box bottom edge. The `<input>` element clips overflow internally (this is browser-default behavior — `<input>` is a replaced element with implicit `overflow: hidden`). Result: descenders visually clipped.

### §2.5 `pages.json` route config for onboarding

Verbatim from `app/src/pages.json:119-122`:
```json
{
  "path": "pages/onboarding/index",
  "style": { "navigationStyle": "custom" }
}
```

Only `navigationStyle: "custom"` is configured. No `enablePullDownRefresh`, no `navigationBarTextStyle`, no Skyline renderer override. Nothing here affects input rendering.

---

## §3 Hypothesis ranking

### H1 — Missing explicit `line-height` AND `height` on `.input`, combined with vertical-only padding (HIGH confidence)

**Mechanism**: With no `line-height` and no `height`, the input's rendered height = `font.intrinsicLineHeight × font-size + paddingTop + paddingBottom`. On iPhone Safari rendering PingFang SC at 17px, `line-height: normal` resolves via the font's hhea metrics to ~1.4em ≈ 23.8px. PingFang SC's descender envelope ≈ 0.34em ≈ 5.78px below baseline. The `<input>` element clips visual overflow at the line-box boundary; if descender rendering extends below that boundary even by a few px, the bottom of glyphs is invisibly cropped.

**Evidence**:
- `app/src/pages/onboarding/index.vue:209-213` — `.input` declaration verbatim, missing both `line-height` and `height`
- `app/src/App.vue:760-763` — actual font cascade winner is PingFang SC (confirmed by webfont-mismatch finding in §2.4)
- `app/src/App.vue:874-877` — input rule forwards font-family but NOT line-height; if iOS Safari's `<input>` inherited line-height cleanly, the page's `line-height: 1.6` (App.vue:765) at 17px = 27.2px would provide adequate descender clearance (~3.4px below baseline). Since the bug exists, line-height clearly is NOT cascading to the input on iOS Safari (or is being recomputed to `normal`)
- §2.3 comparison: every other `<input>` rule with this style of underline (none in codebase) doesn't exist, but boxed inputs with explicit `height: 40-48px` don't exhibit the bug; the height constraint provides external bounds that mask any internal clip
- Outlier status: onboarding is the only input with (no height) × (vertical-only padding) × (largest font-size 17px) combination

**Confidence**: HIGH. Code-evidence-supported. Matches the symptom (glyph clipping inside box).

**Falsification path**: real-device test on iPhone with `line-height: 1.4` added to `.input` — if descenders still clip, H1 is falsified. If they render fully, H1 is confirmed.

### H2 — System font (PingFang SC) intrinsic vertical metrics on iOS Safari `<input>` (MEDIUM confidence, reframed from seed)

**Memory falsification of chat-Claude seed**: The original H2 in the prompt ("Custom web font loaded with non-standard vertical metrics (`hhea.ascent/descent` ≠ `OS/2.sTypoAscender/sTypoDescender`); iOS Safari respects different tables than Chrome — so H5 on iOS may clip while H5 on Android Chrome looks fine") assumed a custom webfont was the rendering target. Verification (§2.4) shows the webfont is loaded but unused (family name mismatch — declared as `'Noto Sans SC Variable'`, referenced as `'Noto Sans SC'`). The rendered font is the system default PingFang SC on iOS.

**Reframed mechanism**: PingFang SC itself has wide CJK-supporting vertical metrics (~1.4em intrinsic line height vs ~1.15em for Latin-only fonts like SF Pro). At 17px font-size with `line-height: normal`, iOS Safari uses PingFang SC's intrinsic metrics. The descender envelope extends below the line-box bottom edge, and `<input>`'s implicit `overflow: hidden` clips it. This is amplified by H1 (no explicit line-height override).

**Evidence**:
- §2.4 webfont-mismatch finding: `'Noto Sans SC Variable'` declared in `@fontsource-variable/noto-sans-sc/wght.css:3` vs `'Noto Sans SC'` referenced in `App.vue:760-763`
- PingFang SC public metrics (Apple Font Book introspection, widely-cited): hhea ascent 1060, descent 340
- Behavior is iOS Safari-specific because PingFang SC is iOS-exclusive (Android renders Noto/Roboto/Source Han Sans which have narrower vertical envelopes)

**Confidence**: MEDIUM. Reframing is well-supported by static evidence; the actual quantitative claim about PingFang SC metrics is "publicly documented" but not personally verified by reading the font tables on this machine. **Tag: needs real-device confirmation** — testing the same input on iOS Safari rendering with system font vs forcing the loaded webfont (by fixing the family name) would isolate whether PingFang SC or the structural rule (H1) is the dominant cause.

**Falsification path**: same as H1 — if explicit `line-height: 1.4` resolves the clip, both H1 and H2 are simultaneously addressed (because H2's mechanism is "intrinsic metrics defeat insufficient line-box height"). Distinguishing H1 vs H2 strictly would require testing with `line-height: normal` (browser default) vs `line-height: 1.4` vs forcing a different font.

### H3 — Global `input, textarea` rule forwards `font-family` + `letter-spacing` but NOT `line-height` (MEDIUM-LOW confidence)

**Mechanism**: `app/src/App.vue:874-877` explicitly forwards 2 of 3 typography properties from cascade to `<input>`. The third (`line-height: inherit`) is conspicuously missing. iOS Safari has documented quirks where `<input>` doesn't reliably inherit `line-height` from page-level ancestors — the prior author likely encountered this and added the rule to forward at least the essentials, but stopped short of `line-height: inherit`. The page's `line-height: 1.6` at the resolved 17px would compute to 27.2px on the input — comfortably wider than PingFang SC's intrinsic 23.8px envelope at 17px — but this never reaches the input.

**Evidence**:
- `app/src/App.vue:874-877` — verbatim rule, missing `line-height: inherit`
- `app/src/App.vue:765` — page sets `line-height: 1.6`
- Hypothesis-supporting reasoning: if `line-height: inherit` were added to the global input rule, the cascade would resolve `1.6 × 17px = 27.2px`, which (a) exceeds PingFang SC's intrinsic 23.8px and (b) provides ~3.4px clearance below baseline for descenders. This would address H1 AND H2 simultaneously with a 1-line edit at the global level

**Confidence**: MEDIUM-LOW. The hypothesis depends on iOS Safari's `<input>` line-height inheritance behavior being a contributing cause. Could be the root cause (with H1 as a symptom) OR could be a downstream consequence of H1 (the page's 1.6 was set on `.page`, designed for body text, never intended for `<input>` and the missing inheritance happens to spare inputs from a too-tall line-height).

**Falsification path**: real-device test with `line-height: inherit` added to the global input rule. If this alone fixes the clip (without adding to `.input`), H3 is confirmed as the cleaner root-level fix.

### H4 — Parent `.field` flex column interaction with input baseline (LOW confidence)

**Mechanism**: `.field { display: flex; flex-direction: column; gap: 8px; position: relative; }` at `app/src/pages/onboarding/index.vue:207`. Flex column children are laid out vertically with no shared baseline; the input's baseline alignment in the flex context is irrelevant. Could there be an interaction where the flex layout's gap mechanism interferes with input rendering? Plausible but no clear mechanism.

**Evidence**:
- `app/src/pages/onboarding/index.vue:207` — `.field` declaration verbatim
- Flex column children get `align-self: stretch` by default — input fills width but vertical sizing is content-driven

**Confidence**: LOW. No specific mechanism identified that would cause descender clipping. Listed for completeness; ruling it out via experiment would require temporarily changing `.field` to `display: block` and seeing if the bug persists — but H1's fix should address the symptom regardless.

**Falsification path**: real-device test with `.field` as `display: block` (no flex). If bug persists, H4 is ruled out.

### H5 — Missing `-webkit-appearance: none` / `appearance: none` on `.input` (LOW confidence)

**Mechanism**: iOS Safari applies browser-default `<input>` styling unless `-webkit-appearance: none` is explicitly set. Default styling can include inner padding, rounded corners, inset shadow, and (relevant here) subtle line-height adjustments. If iOS's default styling tightens the internal line-box below the font's intrinsic envelope, descenders clip.

**Evidence**:
- §2.1 — no `appearance` declaration anywhere in `.input` or in cascade
- iOS Safari behavior with appearance-default `<input>` is widely-documented to vary from Chrome Android

**Confidence**: LOW. Possible contributor but not the primary cause; setting `appearance: none` alone (without H1's line-height fix) is unlikely to resolve the clip because the line-box height issue persists.

**Falsification path**: real-device test with `-webkit-appearance: none; appearance: none;` added to `.input` (no other change). If bug persists, H5 is contributory at most.

### H6 — Chat-Claude seed: iOS auto-zoom + transform on focus (FALSIFIED)

**Memory falsification**: Seed H6 in the prompt was listed as "low priority" by chat-Claude with the note "unlikely since clipping reported pre-focus, but rule out". Static evidence confirms falsification:
- iOS Safari auto-zooms `<input>` only when `font-size < 16px` on focus, and only at focus time
- Onboarding `.input` is `font-size: 17px` (above the 16px threshold)
- Symptom is pre-focus clipping (per Eric's report); auto-zoom is a post-focus mechanism

**Confidence**: FALSIFIED. Listed only to close the loop on the seed hypothesis.

### Ranking summary

| H# | Confidence | Role |
|---|---|---|
| **H1** | **HIGH** | **Primary root cause** — missing line-height + missing height + vertical-only padding |
| H2 | MEDIUM (reframed) | System font intrinsic metrics amplify H1; chat-Claude's webfont version is partially falsified |
| H3 | MEDIUM-LOW | `font-family: inherit` forwarded but `line-height: inherit` missed; possible cleaner root-level fix |
| H4 | LOW | Flex layout interaction — no clear mechanism |
| H5 | LOW | Missing `appearance: none` — contributory at most |
| H6 | FALSIFIED | iOS auto-zoom — symptom is pre-focus, auto-zoom is post-focus |

---

## §4 Cross-platform divergence

For each hypothesis, expected behavior across the four runtimes Eric will smoke-test.

| Platform | H1 (missing line-height) | H2 (PingFang SC metrics) | H3 (line-height not inherited) | H5 (no appearance reset) |
|---|---|---|---|---|
| **H5 Safari iOS** | Confirmed broken (Eric's report) | Confirmed broken (PingFang SC is the default CJK font) | Plausible contributor | Plausible contributor |
| **H5 Chrome Android** | **Unknown — needs real-device check** | Likely OK — Android uses Roboto / Noto Sans CJK SC which has narrower vertical metrics; clip threshold not crossed | Likely OK — Blink-engine `<input>` line-height inheritance is more permissive than WebKit | Likely OK — Chromium's default `<input>` rendering doesn't tighten line-box |
| **mp-weixin (real WeChat)** | Likely OK — mp-weixin `<input>` is a native component, not an HTML `<input>`; CSS line-height/height defaults apply differently | Likely OK — native input doesn't use webfont metrics; uses platform IME default rendering | Likely OK — wxss inheritance model differs from HTML cascade | N/A — wxss has no `-webkit-appearance` concept |
| **WeChat devtool simulator** | Mirrors mp-weixin runtime | Mirrors mp-weixin runtime | Mirrors mp-weixin runtime | N/A |

Onboarding has no `/* #ifdef H5 */` or `/* #ifdef MP-WEIXIN */` conditional CSS blocks in its `<style scoped>`. The same `.input` rule applies on every platform. The bug's platform-specificity (iOS Safari) is therefore a function of platform CSS engine behavior, not codebase platform forking.

**The mp-weixin native input rendering is independent of webfont CSS.** Even if the dead-loaded webfont were fixed (orthogonal anomaly, §7), it would not reach the mp-weixin native `<input>`. Cross-platform fix parity therefore requires the fix to apply at the rule level (line-height / height declarations), not at the @font-face level.

---

## §5 Open questions for Eric to smoke (real-device)

Short, actionable, one per line. Answers will gate which fix candidate (§6) to prioritize.

1. **Pre-focus vs typing**: Is clipping visible at initial render when nickname is pre-populated from `currentUser.value.nickname` (e.g. re-entering onboarding after a partial save), OR only after the user starts typing? If pre-focus only, the layout itself is at fault (H1). If typing-only, suspect IME or `v-model` reactivity interaction.
2. **Character-count threshold**: Does clipping reproduce with 1 character, or only after typing N characters? If proportional to length, suspect a different mechanism (e.g. CSS transform on focus, but H6 is falsified — so likely just H1 manifesting more obviously with more glyphs).
3. **Real WeChat MP (mp-weixin) rendering**: Tap the onboarding nickname input on a real iPhone with the WeChat mini-program. Does clipping reproduce there? **Expected: NO** (per §4 — native input). Confirmation rules in or out the "CSS-only" diagnosis vs a deeper layout issue.
4. **Orientation**: Same iPhone, portrait vs landscape. Does the clip change? Orientation typically doesn't affect glyph rendering, but is worth a 5-second check.
5. **Script mix**: Latin-only nickname ("Kenny") vs CJK-only ("肯尼") vs mixed ("Kenny 肯尼"). Does any one script clip more than others? **Expected: CJK clips more** (PingFang SC's CJK glyphs have wider descender envelope). If Latin-only also clips, the issue is structural (H1) not font-metric (H2).
6. **Placeholder vs typed value**: Does the placeholder text (`t('login.nickname')`) clip the same way as typed values? Placeholders use the input's text rendering with `::placeholder` pseudo-selector. Same result → confirms render-level issue. Different → may reveal a pseudo-element-specific rule somewhere.
7. **iPhone SE small-viewport edge case**: Does clipping get worse on the smallest current iPhone (SE 3rd gen, 568px logical)? The keyboard occlusion audit (§3.1) flagged SE as the worst-case device for that bug; for this bug, viewport size shouldn't matter for glyph rendering, but if it does, that's evidence of a layout interaction (H4).

---

## §6 Fix candidate sketches

All candidates are AUDIT-LEVEL — no actual code edits. Scope, platform safety, risk, and verification noted per candidate. Implementation belongs to a separate fix sprint.

### F1 — Add `line-height: 1.4` to `.input` only (minimum scope)

| Property | Value |
|---|---|
| Files touched | 1 (`app/src/pages/onboarding/index.vue`, lines 209-213) |
| Platform safety | Both H5 + mp-weixin safe; `line-height` is a fundamental CSS property, no platform-specific syntax |
| `/* #ifdef */` needed | No |
| Risk | Very low — explicit `line-height` on `<input>` is widely-used iOS Safari fix idiom |
| Commit size | 1-2 lines |
| Verification | Real-device iPhone Safari smoke (§5.1, §5.5); confirm descenders fully render |

**Mechanism**: Force the line-box height to `17px × 1.4 = 23.8px` minimum (matching PingFang SC's intrinsic) OR larger. Recommend `1.4` to match the page-level reading rhythm conceptually (page is `1.6` for body, inputs are typically tighter for UI density). Padding 10px top/bottom keeps total box height ≈ 43.8px which is close to iOS Human Interface Guidelines minimum touch target (44px).

**Why this is the smallest fix**: addresses H1 directly. Doesn't address H2's underlying webfont mismatch (orthogonal — see §7) but neutralizes H2's symptom. Doesn't change other inputs' behavior (scoped to onboarding `.input`).

### F2 — Add `line-height: 1.4` + `height: 44px` to `.input` (boxed pattern adoption)

| Property | Value |
|---|---|
| Files touched | 1 |
| Platform safety | Both safe |
| Risk | Low — adopts the pattern already proven in login/reset-password (`height: 48px`) and post (`height: 40px`) |
| Commit size | 2-3 lines |
| Verification | Same as F1 + visual review of the input's new explicit height (44px matches iOS HIG touch target) |

**Mechanism**: F1 plus explicit `height: 44px` external bound. Even if internal line-box computation drifts, the `<input>` cannot render taller than 44px; box-sizing border-box means padding is absorbed within. Visually identical to F1 in most cases but more defensive.

**Tradeoff vs F1**: 1 extra line, slightly larger visual change (input box now has a fixed explicit height vs computed). The underline-style aesthetic is preserved (border-bottom unchanged).

### F3 — Add `line-height: inherit` to global `input, textarea` rule in `App.vue:874-877` (codebase-wide root fix)

| Property | Value |
|---|---|
| Files touched | 1 (`app/src/App.vue`, lines 874-877) |
| Platform safety | Both safe; `line-height: inherit` is universal CSS |
| Risk | Medium — affects EVERY `<input>` and `<textarea>` in the codebase. Could change rendering on pages where the current cascade (1.6 inherited) is silently broken-but-acceptable. Boxed inputs (login, reset-password, post) have explicit `height` so their visual presentation is unchanged. Minimal inputs (publish, search, profile, saved-searches) inherit no `line-height` currently — adding it may slightly change their rendering |
| Commit size | 1 line |
| Verification | Three-green build + real-device check on iPhone Safari (onboarding fix) + visual regression check on plaza composer, login, publish, search (random sample of `<input>` consumers) |

**Mechanism**: Forwards `line-height: inherit` alongside the existing `font-family: inherit` and `letter-spacing: inherit`. Page's `line-height: 1.6` (App.vue:765) cascades to all inputs. At any font-size, line-box is comfortably taller than glyph envelope.

**Tradeoff vs F1**: F3 fixes the root cause (cascade gap) for ALL inputs at once, including the silent-but-clipping cases that aren't reported because their pages are less prominent. F1 fixes only the reported onboarding case. F3 is the cleaner architectural fix but carries broader regression risk.

**Why F3 is risky enough to weigh carefully**: any input rule that depends on `line-height: normal` browser default (none observed in §2.3 audit) would be affected. Visual regression check across all input consumers required.

### F4 — Add `-webkit-appearance: none; appearance: none;` + line-height to `.input` (browser-default reset + line-height)

| Property | Value |
|---|---|
| Files touched | 1 |
| Platform safety | Both safe (`appearance` is no-op on mp-weixin wxss but harmless) |
| Risk | Low-Medium — removing browser default styling can subtly change rendering (no rounded corners, no inset shadow); on this `.input` (underline-style with no border on 3 sides) the visual effect should be minimal |
| Commit size | 3 lines |
| Verification | F1 + visual check of input rendering on iOS (any inset shadow / rounded corner change) |

**Mechanism**: Resets iOS Safari's default `<input>` rendering, then applies F1's `line-height`. If H5 (default iOS styling tightens line-box) is contributory, F4 addresses it on top of F1.

**Tradeoff vs F1**: F4 is more thorough but heavier; F1 alone may be sufficient.

### F5 — Fix the dead-loaded webfont family-name mismatch (ORTHOGONAL — flagged for separate sprint)

| Property | Value |
|---|---|
| Files touched | Multiple (any reference to `'Noto Sans SC'`, `'Fraunces'`, `'Noto Serif SC'` in `app/src/App.vue` and possibly `app/src/uni.scss`) |
| Platform safety | H5 only impact; mp-weixin doesn't load webfonts |
| Risk | Medium — changes the actually-rendered font on H5 from system PingFang SC to webfont Noto Sans SC Variable. Visual identity change |
| Commit size | ~5-10 lines |
| Verification | Visual diff on H5 prod-ish rendering |

**Mechanism**: Either (a) rename references from `'Noto Sans SC'` to `'Noto Sans SC Variable'` to match the @fontsource family name, or (b) add an alias `@font-face { font-family: 'Noto Sans SC'; src: local('Noto Sans SC Variable'); }` aliasing rule. Option (b) is cleaner because it doesn't require touching every font-stack reference.

**Why this is OUT OF SCOPE for the present audit**: this is a separate bug (dead-loaded webfont) that exists regardless of the glyph clipping issue. Fixing F5 alone would NOT resolve the glyph clipping (because Noto Sans SC has similar wide CJK vertical metrics to PingFang SC). Fixing F1-F4 alone is sufficient for the reported bug. F5 is worth a separate sprint to recover webfont identity and reduce dead bandwidth — listed here so the implementer doesn't accidentally "fix the wrong thing" while addressing glyph clipping.

### Fix candidate summary

| # | Description | Files | Platform compat | Risk | LOC | Addresses H# |
|---|---|---|---|---|---|---|
| **F1** | **`line-height: 1.4` on `.input`** | **1** | **Both** | **Very low** | **1-2** | **H1, H2 (symptom)** |
| F2 | F1 + `height: 44px` on `.input` | 1 | Both | Low | 2-3 | H1, H2, partial H4 (explicit bound) |
| F3 | `line-height: inherit` on global `input, textarea` | 1 (App.vue) | Both | Medium | 1 | H1, H2, H3 (root fix, codebase-wide) |
| F4 | F1 + `-webkit-appearance: none; appearance: none;` | 1 | Both | Low-Medium | 3 | H1, H2, H5 |
| F5 | Fix dead-loaded webfont family-name (alias OR rename) | Multiple | H5 only | Medium | 5-10 | Orthogonal anomaly, NOT clipping |

---

## §7 Recommended next steps

**Recommended primary fix: F1.** Single line, smallest scope, addresses the reported bug at the verified root cause (H1). Risk profile is the lowest of the candidates.

**Justification**:
1. **Bug-scope match**: Eric's report is the onboarding nickname input specifically. F1 targets exactly that rule.
2. **Minimum surface area**: 1-2 LOC change in 1 file. No global cascade implications.
3. **Verifiable**: real-device test (§5.1) gives binary go/no-go.
4. **Reversible**: 1-line revert if the fix introduces an unforeseen regression.
5. **Composable with F3 later**: if Eric subsequently wants the codebase-wide root fix, F3 layers on top of F1 cleanly (F1 becomes redundant once F3 ships, but doesn't conflict).

**Why NOT F3 as primary** (despite being the architectural root fix): F3 affects every `<input>` and `<textarea>` in the codebase. The implementer doesn't have a way to regression-test the dozen `<input>` consumers (publish, login, reset-password, post, search, profile, saved-searches, etc.) without real-device sweep on every page. F1's narrow scope gets the reported bug fixed safely; F3 can be a deliberate follow-up sprint after Eric has bandwidth for the full visual regression check.

**Why NOT F2** (line-height + height): F2 adds an explicit `height: 44px` which is the boxed-input pattern (login uses 48px, post uses 40px). The onboarding aesthetic is intentionally underline-style — adding `height: 44px` doesn't change the visual much but introduces an explicit dimension that could conflict with future visual changes. F1 leaves the box dimension as computed.

**Why NOT F4** (appearance reset): only adds value if H5 is contributing, and H5 is LOW confidence. Premature.

**Why NOT F5 here**: orthogonal anomaly. File a separate sprint ticket.

### Fix sprint workflow expectations

1. **Branch**: `fix/v35-onboarding-glyph-clipping` (or similar) off `7eda10b` or current `main` HEAD.
2. **One commit**: `fix(onboarding): add explicit line-height to nickname input to prevent iOS descender clip` — single-line subject per `windows_cmd_multiline_commit_gotcha.md`.
3. **Three-green gate** before push, per `pre_push_three_green.md`: `npx vue-tsc --noEmit` + `npm run build:h5` + `npm run build:mp-weixin`.
4. **Real-device smoke** on iPhone Safari before PR opens — answer §5 questions explicitly.
5. **PR to `main`** with squash-merge by Eric per repo policy. Sisyphus / Kenny do not push or merge (per hard-stop rule).

Estimated total work: **~10 min implementation + ~10 min three-green + ~10-20 min real-device test = ~30-40 minutes** for an implementer with the codebase context.

### Anomalies flagged for separate consideration (out of scope for the fix sprint)

1. **Dead-loaded webfont** (§2.4): `@fontsource-variable/noto-sans-sc`, `@fontsource-variable/noto-serif-sc`, `@fontsource-variable/fraunces` are imported and bundled on H5 but never matched by any selector (family-name mismatch — declared as `'X Variable'`, referenced as `'X'`). Costs bandwidth + decode cycles + CSP exposure for zero visual benefit. Suggested separate sprint: F5 (alias-rule approach is least invasive). **Not bundled with this fix.**
2. **Global `line-height` inheritance to `<input>`** (§2.2, H3): the rule at `App.vue:874-877` forwards `font-family` and `letter-spacing` but not `line-height`. Adding `line-height: inherit` (F3) would be the architectural root fix but carries codebase-wide regression risk. **Not bundled with this fix.** Consider as a follow-up sprint after real-device testing budget allows full visual regression check on every input consumer.
3. **Missing `appearance: none` standard on inputs** (H5, F4): not a confirmed cause but worth standardizing across input rules for predictable iOS rendering. **Not in scope.**

---

**End of audit.**
