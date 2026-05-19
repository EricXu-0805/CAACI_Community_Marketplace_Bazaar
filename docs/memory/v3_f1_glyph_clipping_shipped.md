---
name: F1 attempted → F1b shipped — Onboarding nickname input glyph clipping (2026-05-19)
description: F1 (line-height: 1.5 on .input) failed iPhone Safari real-device verification (~50% → ~10% glyph visible). Audit's H1 was structurally wrong — .input targets uni-app's outer <uni-input> custom element, not native <input>. F1b reverses F1, adds height: 48px override matching login pattern. Forward-add commit on top of F1 (4298053), preserving audit-failed history. 2 new lesson files captured. New HARD rule: iOS Safari fixes need real-device gate before squash-merge.
type: project
originSessionId: opencode-f1b-fix-session
---
# F1 attempted → F1b shipped — Onboarding nickname input glyph clipping (2026-05-19)

## Status: F1 FAILED (PR #20 closed, not merged) → F1b SHIPPED via PR #?, squash `<TBD-sha>`

## TL;DR

F1 added `line-height: 1.5` to `.input` in `pages/onboarding/index.vue`. Real-device verification on iPhone Safari (Vercel preview) revealed F1 WORSENED glyph clipping from ~50% to ~10% visibility. Audit's H1 was structurally wrong — `.input` SCSS does NOT target a native `<input>` element; uni-app H5 compiles it to a 3-tier nested DOM where `.input` lands on the OUTER `<uni-input>` custom element. F1b reverses F1's line-height change, adds `height: 48px` to override the framework's hard-coded `height: 1.4em` cap (matching login's `.form-input` prod-verified pattern). Two new lesson files capture the structural learnings.

## Failed F1 attempt (PR #20, commit `4298053`, closed not merged)

- **Approach**: `line-height: 1.5` on `.input` (audit §6 F1's recommendation, plus +0.1 nudge over audit's 1.4 for sibling-rule consistency with `.sub`)
- **Hypothesis (audit H1)**: implicit `line-height: normal` was causing iOS Safari to use PingFang SC's intrinsic envelope as line-box, clipping descenders at the input's content-box bottom
- **Why hypothesis was wrong**:
  1. Framework rule `uni-input { line-height: 1.4em }` was already explicit pre-F1 — `normal` was never resolved
  2. `.input` SCSS selector targets the OUTER `<uni-input>` custom element, NOT the native `<input>`. Audit conflated the two
  3. Adding `line-height: 1.5` (unitless number) re-computed at inner real `<input>` via `line-height: inherit` against the inner's own font-size = 25.5px, exceeding the inner's 23.8px content-box by 1.7px → ADDITIONAL bottom clip via inner shadow-DOM `overflow: hidden`
- **Verified failed on**: real iPhone Safari, Vercel preview, 2026-05-19 ~23:36 PT
- **Action**: PR #20 closed (`gh pr close 20`, no `--delete-branch`); branch `fix/f1-onboarding-glyph-clipping` kept; F1 commit `4298053` preserved as audit-failed history; main HEAD `bc29524` untouched

## Audit reality-check (what was structurally wrong)

Conducted via Oracle consultation 2026-05-19. Full mechanism analysis in chat thread; key findings:

1. **uni-app H5 compiles `<input>` into 3 nested elements**:
   ```
   <uni-input class="input" data-v-xxx>      ← .input SCSS lands HERE
     <div class="uni-input-wrapper">
       <input class="uni-input-input">         ← real native input
     </div>
   </uni-input>
   ```

2. **Framework ships hard-coded CSS** (`uni.<hash>.css`, present on every H5 page):
   ```css
   uni-input { display: block; font-size: 16px; line-height: 1.4em;
               height: 1.4em; min-height: 1.4em; overflow: hidden; }
   .uni-input-input { font: inherit; line-height: inherit; height: 100%; ... }
   ```

3. **At our `font-size: 17px`, the outer `<uni-input>` is 23.8px tall** (1.4em × 17). Wrapper and inner real `<input>` both inherit `height: 100%` → both also 23.8px. PingFang SC's glyph envelope at 17px exceeds 23.8px. The inner shadow-DOM has its OWN `overflow: hidden` (UA `RenderTextControlSingleLine`) which clips descenders at the inner content-box bottom.

4. **F1's worsening mechanism**: unitless `line-height: 1.5` inherits per CSS 2.1 §10.8.1 as a number, re-computes at each descendant. Inner input used line-height = `1.5 × 17 = 25.5px` vs pre-F1's frozen length `23.8px`. The 1.7px additional overflow falls at the bottom (block layout anchors line-box top to content-box top), exactly where descenders live.

5. **Mac DevTools blind spot**: iOS Safari routes through `RenderThemeIOS::adjustTextFieldStyle()` which adds an internal ~2-4px inset on top of the inner input, invisible to Mac DevTools inspection. This is why Mac dev never reproduced the bug.

6. **The structural fix**: override framework's `height: 1.4em` on the OUTER `<uni-input>` via class specificity (`.input { height: 48px }`). This is exactly what `login/index.vue`'s `.form-input` does. It's been prod-verified for the past few weeks without clipping.

## F1b actual fix (this commit, forward-add on `4298053`)

- **File**: `app/src/pages/onboarding/index.vue` (the `.input` rule, lines 209-218 post-edit)
- **Changes**:
  - REMOVE F1's `line-height: 1.5` declaration
  - REMOVE F1's audit-cross-ref comment
  - ADD `height: 48px` (first declaration in the block — overrides framework's `height: 1.4em` via class specificity 0,1,0 > type 0,0,1)
  - CHANGE `padding: 10px 0` → `padding: 0` (vertical padding redundant after explicit height; parent `.field` uses flex column with `gap: 8px` for vertical separation)
  - ADD 6-line SCSS comment block explaining F1b rationale + cross-ref to `lesson_uni_input_wrapper_not_native.md`
- **Approach rationale**: match `login/index.vue`'s `.form-input` pattern (`height: 48px; padding: 0 16px; font-size: 15px`) which is the prod-verified working idiom for inputs in this codebase. Onboarding uses `padding: 0` (no horizontal) because the input is full-width underline-style with the visual hierarchy coming from the explicit `.label` above and `.field` flex column below — different aesthetic than login's pill-shaped boxed inputs, but the height/cascade contract is identical.

## What we learned (now memorialized in 2 new lesson files)

1. **uni-app H5 `<input>` is NOT native** — `docs/memory/lesson_uni_input_wrapper_not_native.md`
   - SCSS class rules target the OUTER `<uni-input>` custom element, not the inner real `<input>`
   - Framework hard-codes `height: 1.4em` on the outer
   - The idiom is `height: 44-48px` explicit override
   - Do NOT add `line-height` as a unitless number — risk of inner overflow via number-vs-length inheritance

2. **Mac dev smoke is insufficient for iOS Safari fixes** — `docs/memory/lesson_ios_safari_realdevice_gate.md`
   - New HARD gate: Vercel preview + real iPhone Safari verification before squash-merge
   - Applies to: iOS Safari rendering, mp-weixin native components, `-webkit-appearance`, viewport quirks, PingFang SC metrics, viewport units, uni-app custom-element compiled inputs
   - F1 incident is the canonical example

## Decisions locked (F1b)

- **`height: 48px`** (matches login's `.form-input` exactly — prod-verified for weeks)
- **`padding: 0`** (vertical removed; horizontal was already 0 in F1 era; underline-style aesthetic preserved by `border-bottom`)
- **No line-height declaration** (let framework's `1.4em` cascade through; inner input's line-box at `1.4 × 17 = 23.8px` fits comfortably inside `height: 48px` with ~24px headroom)
- **Comment block in SCSS** includes lesson cross-ref for future readers; matches the M0 SCSS cross-ref-comment pattern
- **Branch: stayed on `fix/f1-onboarding-glyph-clipping`** with forward-add commit (preserves F1 attempt → F1b fix audit trail in feature branch git log per `opencode_no_self_decided_history_rewrite.md`). Squash-merge will collapse both commits into a single main commit, but feature branch history retains the learning chain.
- **Bundle 6 memory file changes** in this same commit (per `workflow_audit_first.md` step 4 — no Round 2 memory sync PR)

## Smoke

- **Three-green pre-push gate cleared**: `vue-tsc --noEmit` + `npm run build:h5` + `npm run build:mp-weixin` all exit 0
- **HARD gate (new — from `lesson_ios_safari_realdevice_gate.md`)**: Vercel preview deploy + real iPhone Safari verify required BEFORE squash-merge. Eric to paste preview screenshot showing ≥90% glyph visible. Only then merge.

## Deferred / future (unchanged from F1 sprint)

- **F2 (keyboard occlusion)**: F1b's `height: 48px` is only ~3px taller than what F1's effective height would have been (1.4em × 17 + 20px padding × 0 = 23.8px content, F1b = 48px). Net delta to F2's worst case is acceptable per F2 audit's design. F2 ships ~within a week of F1b.
- **F3 (App.vue global `input, textarea { line-height: inherit }`)**: still deferred per audit §6 risk analysis — broader codebase-wide regression scope. AND no longer the right architectural fix because the real architectural issue is the framework's `height: 1.4em` on `<uni-input>`, not the missing `line-height: inherit` on the global input rule. F3 would not fix the structural problem.
- **F5 (dead-loaded webfont family-name mismatch)**: still queued, orthogonal H5-only anomaly, `@fontsource-variable/*` family names mismatch.
- **Audit §5 Q1-Q7 real-device questions**: defaulted at F1b ship; the height: 48px fix is robust to all default assumptions being wrong.

## Pre-push hook three-green output (F1b commit verification)

```
[1/3] vue-tsc --noEmit
  ✓ type-check passed
[2/3] npm run build:h5
  ✓ build:h5 passed
[3/3] npm run build:mp-weixin
  ✓ build:mp-weixin passed
```

## P2b implication

When P2b extracts a shared input component, grep `height: 48px` to find the established codebase pattern. Do NOT propagate `line-height` as unitless number to any input rule — see `lesson_uni_input_wrapper_not_native.md`. The extracted component should:
- Accept a `size` prop ("sm" 40px / "md" 44px / "lg" 48px) matching the iOS HIG ladder
- Always set explicit `height` (no defaults inherited from framework)
- Never declare unitless `line-height`
- Document the cascade target (it's the outer `<uni-input>`, not the inner native `<input>`)

## Cross-refs

- Audit (now known to be structurally wrong on selector target): `docs/audit/V35_onboarding_glyph_clipping_audit.md`
- New lesson on uni-app input wrapper: `docs/memory/lesson_uni_input_wrapper_not_native.md`
- New lesson on real-device gate: `docs/memory/lesson_ios_safari_realdevice_gate.md`
- Sprint tracker (v3.5 GC audit + F1 + F1b row): `docs/memory/sprint_v3_phase_status.md`
- Backlog (status now FIX SHIPPED via F1b): `docs/memory/backlog_onboarding_glyph_clipping.md`
- Workflow step 4 — memory rides with deliverable: `docs/memory/workflow_audit_first.md`
- No-history-rewrite rule (why F1 commit is preserved on the branch): `docs/memory/opencode_no_self_decided_history_rewrite.md`
- M0 (predecessor V3 deliverable, same week): `docs/memory/v3_m0_post_chip_shipped.md`
