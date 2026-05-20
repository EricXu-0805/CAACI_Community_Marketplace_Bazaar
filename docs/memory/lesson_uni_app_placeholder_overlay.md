---
name: Lesson — uni-app `.uni-input-placeholder` is an absolutely-positioned overlay element
description: uni-app H5 renders `<input :placeholder="">` as TWO sibling DOM elements inside `<div class="uni-input-wrapper">` — the real `<input class="uni-input-input">` and a separate `<span class="uni-input-placeholder">`. The placeholder is `position: absolute; top: auto !important` and resolves to wrapper content-box top (flex-column static-position fallback). It OVERLAPS the value text once the wrapper has visible height. uni-app's hydration / value-detection toggle on the placeholder element is unreliable on iOS Safari. The fix when you have a visible `<label>` above the field is to hide it unconditionally via `:deep(.uni-input-placeholder) { display: none; }`. Source: F1b → F1c reality-check 2026-05-19.
type: lesson
originSessionId: opencode-f1c-fix-session
---
# Lesson — uni-app `.uni-input-placeholder` is an absolutely-positioned overlay element

## Source: F1b → F1c reality-check (2026-05-19)

## What we learned

uni-app H5 framework renders `<input :placeholder="...">` as TWO separate DOM elements:

1. The real native `<input class="uni-input-input">` — holds typed value
2. A separate `<span class="uni-input-placeholder">` — holds placeholder text

The placeholder element is `position: absolute; top: auto !important; left: 0` and lives
as a sibling of the real input inside `<div class="uni-input-wrapper">` which has
`display: flex; flex-direction: column; justify-content: center`.

The absolute positioning removes the placeholder from flex flow. With `top: auto`, its
visual position falls back to the static-position calculation — which for an
absolutely-positioned child of a flex column container is the **top of the wrapper's
content box**.

Verbatim framework CSS (`uni.<hash>.css` shipped on every H5 page):

```css
.uni-input-wrapper, .uni-input-form {
  display: flex; position: relative;
  width: 100%; height: 100%;
  flex-direction: column; justify-content: center;
}
.uni-input-placeholder {
  position: absolute;
  top: auto !important;
  left: 0;
  width: 100%;
  color: gray;
  overflow: hidden;
  text-overflow: clip;
  white-space: pre;
  word-break: keep-all;
  pointer-events: none;
  line-height: inherit;
}
.uni-input-input {
  position: relative;
  display: block;
  height: 100%;
  /* ... */
}
```

## What this means visually

When the `<uni-input>` has enough height for both the value text (rendered inside the
inner `<input>`) and the placeholder text to coexist visibly:

- Value text renders centered in the wrapper (flex `justify-content: center`)
- Placeholder text renders at the wrapper top (absolute positioning fallback)
- **The two overlap when wrapper height > line-height** — placeholder sits ABOVE value

## The bug we hit (F1b)

F1b raised `<uni-input class="input">` height from framework's 23.8px (1.4em @ fs:17) to
48px. At 23.8px, the placeholder and value were vertically compressed into the same line,
visually mixed into the perceived "clipping." At 48px, they cleanly separate — placeholder
at top, value at center — but placeholder still renders even when value is present, because
uni-app's value-detection / hydration logic doesn't reliably toggle `display: none` on
the placeholder element on iOS Safari at the right moments.

Real-device evidence (Eric, iPhone Safari, 2026-05-19): 4 screenshots showing
- Light mode pre-focus + value: gray bar (placeholder text rendered in framework hardcoded `color: gray`) covers the upper half of the value text region; value characters' bottom half visible below
- Light mode focus + single char: similar overlap, with the placeholder's `pointer-events: none` letting taps still register on the inner input below
- Dark mode + value: placeholder text + value text both visible but low-contrast against dark page bg (dark token cascade applies to inner input via `color: inherit`, but placeholder retains framework's `color: gray` regardless)

## The fix (F1c)

Unconditionally hide the placeholder element via `:deep()`:

```scss
.my-input-class {
  /* ... explicit height override (per lesson_uni_input_wrapper_not_native.md) ... */

  :deep(.uni-input-placeholder) {
    display: none;
  }
}
```

This works because:
- `:deep()` pierces Vue's scoped CSS and matches uni-app's framework child element
- `display: none` removes the placeholder from layout entirely
- Value text now renders alone in its expected center position

UX tradeoff: input shows no inline placeholder hint. Mitigate by always providing a
visible `<label>` element above the field (we already have `.label "NICKNAME"` for
onboarding, so no UX regression there).

## When to apply this lesson

- Any uni-app `<input>` in your H5 code with `:placeholder=""` attribute
- Especially when input height is overridden to > framework's 1.4em (which is most cases — see `lesson_uni_input_wrapper_not_native.md`)
- If you have a visible label above the field, prefer this lesson over relying on
  uni-app's placeholder visibility toggling

## Alternative: conditional hide

If you NEED first-visit placeholder hint (no visible `<label>`):
- Bind a class to the wrapper based on `v-model` value emptiness, e.g. `:class="{ 'has-value': nickname.length > 0 }"`
- Use SCSS attribute or class selector to toggle placeholder visibility, e.g. `&.has-value :deep(.uni-input-placeholder) { display: none; }`
- Costs 3-5 LOC vs unconditional hide's 3 LOC
- See related: `docs/memory/lesson_uni_input_wrapper_not_native.md`

## Cross-platform note

mp-weixin uses native `<input>` (not HTML), placeholder rendering is OS-native and doesn't
exhibit this overlay bug. F1c's `:deep()` rule is H5-only effectively — `:deep` resolves at
build time per platform, and the `.uni-input-placeholder` class doesn't exist in mp-weixin
compiled output, so the rule is a no-op there. Safe to ship.

## Why this hides on iOS Safari but Mac dev never showed it

Same `RenderThemeIOS` blind spot as the F1 incident — Mac Safari does NOT route iOS's
internal text-field rendering pipeline. On Mac Safari, uni-app's placeholder hide
heuristic happens to fire correctly (likely via faster `value`-attribute polling or a
different reflow timing). On iOS Safari the hide is unreliable. The framework rule's
hardcoded `color: gray` + `position: absolute; top: auto !important` makes the leak
visually loud when it does happen.

## Related

- F1 → F1b → F1c history: `docs/memory/v3_f1_glyph_clipping_shipped.md`
- uni-app `<input>` DOM truth: `docs/memory/lesson_uni_input_wrapper_not_native.md`
- Real-device gate: `docs/memory/lesson_ios_safari_realdevice_gate.md`
- Audit (now post-mortem material — see workflow): `docs/audit/V35_onboarding_glyph_clipping_audit.md`
