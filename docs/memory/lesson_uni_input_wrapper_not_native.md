---
name: Lesson — uni-app H5 `<input>` is NOT native; it's a `<uni-input>` wrapper with 3-tier nested DOM
description: SCSS class rules on `<input v-model>` in a uni-app .vue SFC actually target the OUTER `<uni-input>` custom element, NOT the inner native HTML `<input>`. Framework hard-codes `uni-input { height: 1.4em; overflow: hidden }`. To stop iOS Safari descender / glyph clipping on inputs, explicit `height: 44-48px` override is required (matches login/publish/reset-password pattern). Do NOT add unitless `line-height` — it re-computes at inner input against inner font-size and can push line-box past container. Source: F1 → F1b reality-check 2026-05-19.
type: lesson
originSessionId: opencode-f1b-fix-session
---
# Lesson — uni-app H5 `<input>` is NOT native; it's a `<uni-input>` wrapper

## Source: F1 → F1b reality-check (2026-05-19)

## What we believed
The `.input` SCSS rule in `pages/onboarding/index.vue` targets the native HTML `<input>` element. Therefore "iOS Safari `<input>` behavior" research — line-height inheritance quirks, font intrinsic metrics, etc. — applies directly to that rule.

## What's actually true
uni-app H5 compiles every `<input v-model>` element written in a `.vue` SFC into a 3-tier nested DOM:

```
<uni-input class="input" data-v-xxx>      ← scoped .input SCSS lands HERE (custom element)
  <div class="uni-input-wrapper">
    <input class="uni-input-input">         ← the REAL native HTML <input>
  </div>
</uni-input>
```

Framework ships hard-coded CSS on every H5 page (`uni.<hash>.css`), verbatim:

```css
uni-input {
  display: block;
  font-size: 16px;
  line-height: 1.4em;
  height: 1.4em;
  min-height: 1.4em;
  overflow: hidden;
}
.uni-input-wrapper, .uni-input-form {
  display: flex;
  position: relative;
  width: 100%;
  height: 100%;
  flex-direction: column;
  justify-content: center;
}
.uni-input-input {
  position: relative;
  display: block;
  height: 100%;
  background: none;
  color: inherit;
  opacity: 1;
  font: inherit;
  line-height: inherit;
  letter-spacing: inherit;
  text-align: inherit;
  text-indent: inherit;
  text-transform: inherit;
  text-shadow: inherit;
}
```

## Consequences

1. **Outer height capped to 1.4em**. At our `font-size: 17px` the outer is 23.8px tall — too small for PingFang SC's glyph envelope on iOS Safari. Without an explicit `height` override on `.input` (class specificity beats type), text clips at the framework-imposed ceiling. The wrapper's `height: 100%` and the inner real `<input>`'s `height: 100%` propagate that 23.8px constraint downward.

2. **Inner `<input>` line-height inherits via `line-height: inherit`**. If `.input` declares line-height as a unitless number (e.g. `1.5`), the number inherits as-is per CSS 2.1 §10.8.1 and RE-COMPUTES at the inner against the inner's own font-size — potentially exceeding the inner's height (`1.5 × 17 = 25.5px` overflowing the 23.8px inner content-box by 1.7px). If line-height is a length (e.g. `25.5px`), it inherits as the resolved length and is safer (but height override is still the real fix).

3. **Inner real `<input>` has its OWN shadow-DOM clip**. iOS Safari (and other WebKit) routes through `RenderTextControlSingleLine` which gives the inner editable text element a UA-default `overflow: hidden` at the input's content-box. This is INDEPENDENT of the outer `<uni-input>`'s declared `overflow: hidden`. Glyph clipping inside the input happens at the inner shadow level — the outer's overflow is structurally redundant for glyph rendering.

4. **Mac DevTools blind spot**. Mac Safari does NOT route through `RenderThemeIOS::adjustTextFieldStyle()` / `paintTextFieldInnerShadow()`. iOS Safari adds ~2-4px inset on top of the inner input that is invisible to Mac DevTools inspection — visible only on real iPhone Safari. This is why Mac dev smoke (Chrome + Mac Safari) can completely miss this category of bug.

## The Idiom (use this for every input rule in this codebase)

```scss
.my-input {
  height: 44px;              /* or 48px — override framework's 1.4em */
  padding: 0 16px;           /* horizontal padding OK, no vertical */
  font-size: 15-17px;
  /* DO NOT add line-height as unitless number — risk inner overflow */
  /* DO NOT rely on framework default height */
}
```

## Verified consumers using the idiom (prod, no clip)

- `pages/login/index.vue` `.form-input` — `height: 48px`, `padding: 0 16px`, `font-size: 15px`
- `pages/reset-password/index.vue` `.form-input` — `height: 48px`, `padding: 0 16px`, `font-size: 15px`
- `pages/publish/index.vue` title/price inputs — height-override pattern
- `pages/post/index.vue` `.input` (chat-bar style) — `height: 40px`, `padding: 0 14px`, `font-size: 14px`

## Verified failed approach (F1, PR #20 closed without merge)

- Added `line-height: 1.5` (unitless number) to `.input` without height override
- Inner real `<input>` recomputed line-height to `1.5 × 17 = 25.5px` against framework's 23.8px height constraint
- Result: line-box overflowed inner content-box by 1.7px → additional bottom clip via shadow-DOM `overflow: hidden`
- Visible glyph dropped from ~50% (pre-F1) to ~10% (post-F1) on real iPhone Safari
- F1b reversed line-height, added `height: 48px`

## When to apply this lesson

- Any new uni-app `<input>` SCSS rule in this codebase
- Any glyph-clipping / font-rendering / "text looks too tall / too short" bug report on H5
- Code review: reject any input rule that adds `line-height` as unitless number without an explicit height override
- Any audit that proposes a CSS fix for an `<input>` element — verify the audit identified the OUTER `<uni-input>` cascade target, not a hypothetical native input

## Spec references

- CSS 2.1 §10.8.1 line-height computed-value rules (number vs length inheritance): https://www.w3.org/TR/CSS21/visudet.html#line-height
- CSS Flexbox L1 §4.5 (automatic minimum size — flex auto-min interaction): https://www.w3.org/TR/css-flexbox-1/#min-size-auto
- WebKit `RenderTextControlSingleLine` shadow-DOM clip: WebCore/css/html.css (search `-webkit-textfield-decoration-container`)
- WebKit Bug 209983 (flex auto-min implementation gaps): https://bugs.webkit.org/show_bug.cgi?id=209983
- WebKit `RenderThemeIOS::paintTextFieldInnerShadow`: WebCore/rendering/RenderThemeIOS.mm

## Related

- F1 → F1b fix history: `docs/memory/v3_f1_glyph_clipping_shipped.md`
- Real-device gate lesson: `docs/memory/lesson_ios_safari_realdevice_gate.md`
- Audit (was structurally wrong on selector target): `docs/audit/V35_onboarding_glyph_clipping_audit.md`
