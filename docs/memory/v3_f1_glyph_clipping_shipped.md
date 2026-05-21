---
name: F1 / F1b / F1c all attempted → PAUSED 2026-05-20 → superseded by O1 (onboarding removed)
description: 3 fix attempts on the onboarding nickname input glyph clipping bug — F1 (line-height 1.5), F1b (height 48px override), F1c (:deep placeholder hide) — all failed iPhone Safari real-device verification. After F1c failed, Eric decided NOT to attempt F1d. Instead, the entire onboarding flow was removed in O1 sprint (docs/memory/o1_onboarding_removed.md), eliminating the bug surface. F1 sprint preserved on fix/f1-onboarding-glyph-clipping branch as audit-failed learning chain (3 commits + 4 lesson files: lesson_uni_input_wrapper_not_native.md / lesson_ios_safari_realdevice_gate.md / lesson_uni_app_placeholder_overlay.md / lesson_blind_iteration_stop_after_3.md). Net sprint value: 4 lessons + UX simplification (O1) at cost of 3 abandoned fix attempts.
type: project
originSessionId: opencode-f1c-fix-session
---
# F1 / F1b / F1c all attempted → PAUSED → superseded by O1 (2026-05-19 → 2026-05-20)

## Status: F1 + F1b + F1c all FAILED real-device verification → PAUSED 2026-05-20
## Superseded by: O1 sprint (`docs/memory/o1_onboarding_removed.md`) — onboarding flow removed entirely

## TL;DR

Three-commit learning chain on a single feature branch:

1. **F1** (`4298053`, PR #20 closed) — added `line-height: 1.5` to `.input`. Real-device verification on iPhone Safari (Vercel preview) showed F1 WORSENED glyph clipping from ~50% to ~10% visibility. Audit's H1 was structurally wrong: `.input` targets uni-app's outer `<uni-input>` custom element, not the native `<input>`. The unitless line-height re-computed at the inner real `<input>` and overflowed its content-box.
2. **F1b** (`4c2265e`, PR #21 first commit) — reverted line-height, added `height: 48px` matching login's `.form-input` prod-verified pattern. Cleared the framework's `height: 1.4em` cap. Real-device verification revealed a NEW bug — uni-app's `.uni-input-placeholder` element (a separate `<span>` sibling of the real input, framework hardcodes `position: absolute; top: auto !important; color: gray; pointer-events: none`) overlays value text once the wrapper has visible height. At 23.8px the placeholder and value were visually fused into the "clipping" symptom; at 48px they separate, but the placeholder still renders when value is present because uni-app's hide heuristic is unreliable on iOS Safari.
3. **F1c** (THIS commit, PR #21 second commit) — adds `:deep(.uni-input-placeholder) { display: none; }` inside the `.input` rule. 3 LOC + 6-line explanatory comment. UX tradeoff accepted: `.label "NICKNAME"` above the field already provides sufficient visual hint.

All three commits preserved on `fix/f1-onboarding-glyph-clipping` (forward-add only per `opencode_no_self_decided_history_rewrite.md`). Squash-merge collapses all three into one main commit; feature branch history retains the full learning chain.

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

6. **The structural fix (F1b's hypothesis)**: override framework's `height: 1.4em` on the OUTER `<uni-input>` via class specificity (`.input { height: 48px }`). This is exactly what `login/index.vue`'s `.form-input` does.

## F1b attempted fix (commit `4c2265e`, forward-add on top of `4298053`)

- **File**: `app/src/pages/onboarding/index.vue` (the `.input` rule, lines 209-218 post-edit)
- **Changes**:
  - REMOVE F1's `line-height: 1.5` declaration
  - REMOVE F1's audit-cross-ref comment
  - ADD `height: 48px` (first declaration in the block — overrides framework's `height: 1.4em` via class specificity 0,1,0 > type 0,0,1)
  - CHANGE `padding: 10px 0` → `padding: 0` (vertical padding redundant after explicit height; parent `.field` uses flex column with `gap: 8px` for vertical separation)
  - ADD 6-line SCSS comment block explaining F1b rationale + cross-ref to `lesson_uni_input_wrapper_not_native.md`
- **Approach rationale**: match `login/index.vue`'s `.form-input` pattern (`height: 48px; padding: 0 16px; font-size: 15px`) which is the prod-verified working idiom for inputs in this codebase. Onboarding uses `padding: 0` (no horizontal) because the input is full-width underline-style with the visual hierarchy coming from the explicit `.label` above and `.field` flex column below — different aesthetic than login's pill-shaped boxed inputs, but the height/cascade contract is identical.

## Failed F1b attempt (post-real-device, 4 screenshot evidence)

- **What changed visually**: with the wrapper expanded from 23.8px to 48px, a SECOND text element became cleanly separable from the value text — uni-app's `.uni-input-placeholder` `<span>` sibling of the real `<input>`, which framework hardcodes as `position: absolute; top: auto !important; left: 0; color: gray; pointer-events: none`. The wrapper is `display: flex; flex-direction: column; justify-content: center` — for an absolutely-positioned child of a flex column container, `top: auto` resolves to the static-position fallback at the wrapper content-box TOP.
- **Result**: value text renders centered (per flex `justify-content`), placeholder text renders at top (per absolute fallback). They visibly overlap once the wrapper has 48px to spread them across. At the framework default 23.8px both were vertically compressed into one cramped line — which is what made the original bug look like a "clipping" symptom (it was always a placeholder overlay; the height made the overlap pattern legible).
- **Why uni-app's hide-on-value heuristic didn't save us**: uni-app DOES try to toggle the placeholder's display based on input value, but the hide is unreliable on iOS Safari — likely a hydration ordering issue with `onMounted` setting `nickname.value` from `currentUser`, or a reflow timing that the framework's reactive watcher misses. Mac Safari happens to fire the hide correctly; iOS Safari leaves it visible.
- **Real-device evidence** (Eric, iPhone Safari Vercel preview, 2026-05-19):
  - Light mode pre-focus + populated value: gray bar covers upper half of value text region; value char tops visible above the bar, char bottoms visible below
  - Light mode focus + 1 char typed: similar overlay pattern, value char tops blanked by gray bar
  - Light mode focus + multiple chars: position offset + blurry (focus-related antialiasing change against gray overlay)
  - Dark mode + populated value: placeholder + value both rendered low-contrast against dark page bg (placeholder retains framework's `color: gray` regardless of theme; value inherits cream via `--text-primary` cascade through inner input's `color: inherit`)
- **F1b commit `4c2265e` kept on branch** as forward-add history; F1c stacks on top per `opencode_no_self_decided_history_rewrite.md`

## F1c actual fix (this commit)

- **File**: `app/src/pages/onboarding/index.vue` (`.input` rule, ~lines 209-227 post-edit)
- **Change**: add nested `:deep(.uni-input-placeholder) { display: none; }` rule INSIDE the existing `.input` block, after the existing F1b declarations and BEFORE the closing `}`
- **3 LOC** (1 nested selector + 1 declaration + closing brace) + 6-line explanatory comment block
- **Rationale**:
  - `.label "NICKNAME"` text above the input already provides sufficient visual hint about what to enter — placeholder is redundant on the onboarding step 1 surface
  - Hiding via `display: none` removes the placeholder from layout entirely → no overlay, no overlap, value text renders alone in its expected center position
  - `:deep()` selector is required because the placeholder is a child of the `<uni-input>` custom element (framework-injected), not authored in our SFC's template — Vue's scoped CSS would otherwise not match it
- **Verified**:
  - `:deep()` syntax is already in use in 3 codebase files (`UIcon.vue`, `UButton.vue`, `chat/index.vue`) — build supports it
  - Framework CSS confirmed at `app/dist/build/h5/assets/uni.80f9db3e.css`: `.uni-input-placeholder { position: absolute; top: auto !important; left: 0; color: gray; ... pointer-events: none }`
  - Wrapper CSS confirmed: `.uni-input-wrapper { display: flex; flex-direction: column; justify-content: center }`
- **Cross-ref**: new `docs/memory/lesson_uni_app_placeholder_overlay.md`

## What we learned (now memorialized in 3 new lesson files)

1. **uni-app H5 `<input>` is NOT native** — `docs/memory/lesson_uni_input_wrapper_not_native.md`
   - SCSS class rules target the OUTER `<uni-input>` custom element, not the inner real `<input>`
   - Framework hard-codes `height: 1.4em` on the outer
   - The idiom is `height: 44-48px` explicit override
   - Do NOT add `line-height` as a unitless number — risk of inner overflow via number-vs-length inheritance

2. **Mac dev smoke is insufficient for iOS Safari fixes** — `docs/memory/lesson_ios_safari_realdevice_gate.md`
   - New HARD gate: Vercel preview + real iPhone Safari verification before squash-merge
   - Applies to: iOS Safari rendering, mp-weixin native components, `-webkit-appearance`, viewport quirks, PingFang SC metrics, viewport units, uni-app custom-element compiled inputs
   - F1 incident is the canonical example

3. **uni-app `.uni-input-placeholder` is an overlay element, not a CSS pseudo** — `docs/memory/lesson_uni_app_placeholder_overlay.md`
   - It's absolutely-positioned at wrapper top (static-position fallback in flex-column), overlapping value text when both coexist
   - Framework hardcodes `color: gray` (theme-blind) + `pointer-events: none`
   - Hide unconditionally via `:deep(.uni-input-placeholder) { display: none }` when you have a separate `<label>` above the field
   - F1b's height expansion EXPOSED this latent overlay (the small height pre-F1b compressed it visually with value text — looked like "clipping" but was always overlay)

## Decisions locked (F1c)

- **Keep F1b's `height: 48px`** (matches login's `.form-input` exactly — prod-verified for weeks; framework's `height: 1.4em` cap is still the wrong constraint to live with)
- **Keep F1b's `padding: 0`** (vertical removed; horizontal was already 0; underline-style aesthetic preserved by `border-bottom`)
- **No line-height declaration** (let framework's `1.4em` cascade through inside the larger 48px box)
- **`:deep(.uni-input-placeholder) { display: none }`** (unconditional, no value-aware toggle — `.label` above field is the visual hint)
- **Comment block in SCSS** includes lesson cross-ref for future readers; matches the M0 + F1b SCSS cross-ref-comment pattern
- **Branch: stayed on `fix/f1-onboarding-glyph-clipping`** with forward-add commit (preserves F1 → F1b → F1c learning chain in feature branch git log per `opencode_no_self_decided_history_rewrite.md`). Squash-merge will collapse all three commits into a single main commit, but feature branch history retains the learning chain.
- **Bundle 6 memory file changes** in this same commit (per `workflow_audit_first.md` step 4 — no Round 2 memory sync PR)
- **F1 + F1b commits NOT touched** (4298053 + 4c2265e); both kept as audit-failed → reality-check history

## Smoke

- **Three-green pre-push gate cleared**: `vue-tsc --noEmit` + `npm run build:h5` + `npm run build:mp-weixin` all exit 0
- **HARD gate (from `lesson_ios_safari_realdevice_gate.md`)**: Vercel preview deploy + real iPhone Safari verify required BEFORE squash-merge. Eric to:
  - Push F1c to origin → Vercel auto-deploys preview to PR #21
  - Open same preview URL on real iPhone Safari
  - Verify: no gray bar over value text in either light or dark mode; value characters fully visible (≥90% glyph); position stable through focus/blur transitions
  - Paste screenshot to chat as evidence
  - ONLY THEN squash-merge PR #21 to main

## Deferred / future (unchanged from F1 sprint)

- **F2 (keyboard occlusion)**: F1c does not change input height (still 48px from F1b). Net delta to F2's worst case is unchanged from F1b. F2 ships ~within a week of F1c.
- **F3 (App.vue global `input, textarea { line-height: inherit }`)**: still deferred per audit §6 risk analysis — and no longer the right architectural fix because the real architectural issues are (a) framework's `height: 1.4em` on `<uni-input>` (addressed by F1b's height override) and (b) framework's placeholder overlay behavior (addressed by F1c's `display: none`). F3 would not fix either.
- **F5 (dead-loaded webfont family-name mismatch)**: still queued, orthogonal H5-only anomaly.
- **Audit §5 Q1-Q7 real-device questions**: defaulted at F1b ship; F1c's `display: none` is robust to all default assumptions being wrong.
- **Audit md post-mortem**: `docs/audit/V35_onboarding_glyph_clipping_audit.md` on main is structurally wrong on selector target (H1 assumed native input, actually targets `<uni-input>` wrapper) AND missed the placeholder-overlay mechanism entirely. Decision deferred to Eric whether to rewrite §3 H1 on main or add a POST-MORTEM footer pointing to the 3 lesson files.

## Pre-push hook three-green output (F1c commit verification)

```
[1/3] vue-tsc --noEmit
  ✓ type-check passed
[2/3] npm run build:h5
  ✓ build:h5 passed
[3/3] npm run build:mp-weixin
  ✓ build:mp-weixin passed
```

## P2b implication (updated)

When P2b extracts a shared input component, grep `height: 48px` to find the established codebase pattern. Do NOT propagate `line-height` as unitless number to any input rule — see `lesson_uni_input_wrapper_not_native.md`. ALSO consider whether the extracted component should default to hiding `.uni-input-placeholder` when a sibling label is provided (most consumers in this codebase have an explicit `.label` above the field).

The extracted component should:
- Accept a `size` prop ("sm" 40px / "md" 44px / "lg" 48px) matching the iOS HIG ladder
- Always set explicit `height` (no defaults inherited from framework)
- Never declare unitless `line-height`
- Document the cascade target (it's the outer `<uni-input>`, not the inner native `<input>`)
- Provide a `hidePlaceholder` boolean prop (default true when a sibling `<label>` slot is filled, false otherwise) implemented via `:deep(.uni-input-placeholder) { display: none }`

## Sprint outcome (2026-05-20 — F1c also failed real-device → sprint PAUSED → O1 supersedes)

After F1c also failed real-device verification (Eric's iPhone Safari iOS preview showed gray bar placeholder overlay STILL present despite the `:deep(.uni-input-placeholder) { display: none }` rule that Web Inspector + framework CSS verification both predicted would work), Eric decided NOT to attempt F1d. Per the new `lesson_blind_iteration_stop_after_3.md` rule, 3 fix attempts on the same bug all failing real-device verification is the threshold to STOP iterating and reassess scope.

**Decision: remove the onboarding flow entirely** rather than attempt a 4th fix.

The reassessment surfaced that the 3-step onboarding wizard was collecting:
- **Nickname** — redundant for email signup (already in signup form), marginal for Google OAuth (`raw_user_meta_data.full_name` available), redundant for WeChat (returned by `/api/auth/wechat-login`)
- **Campus** — DEAD DATA (`campus_area` column never read elsewhere in codebase; no edit UI exists; `useCampusSpots` 10-spot list used in `profile/edit.vue` writes to a DIFFERENT column `profiles.location` that features actually use)
- **Avatar** — redundant with `profile/edit.vue` which has identical `uploadImages` plumbing and is the canonical editable surface
- **Consent record** — legally required → preserved via existing `/pages/reconsent/index`

Only the consent record was load-bearing. Everything else was redundant or dead data. The O1 sprint (`docs/memory/o1_onboarding_removed.md`) removes the wizard and relies on the existing reconsent gate branch in `App.vue` to handle new users (their `tos_version='0'` default < `CURRENT_CONSENT_VERSION` → reconsent → accept → home).

### What we kept from F1 sprint (the value isn't zero)

- **3 attempt commits preserved** on `fix/f1-onboarding-glyph-clipping` branch (F1 `4298053`, F1b `4c2265e`, F1c `45fe92e`) — audit-failed → reality-check learning chain visible in git log
- **4 lesson files extracted** during the F1 attempts — these are now infrastructure-grade knowledge that will save future input-related sprints:
  - `lesson_uni_input_wrapper_not_native.md` (uni-app DOM truth)
  - `lesson_ios_safari_realdevice_gate.md` (real-device verification HARD gate)
  - `lesson_uni_app_placeholder_overlay.md` (uni-input-placeholder mechanism)
  - `lesson_blind_iteration_stop_after_3.md` (when to stop iterating, NEW in O1 commit)
- **Verified audit findings** about uni-app DOM structure and framework CSS — institutional memory that prevents repeating the same wrong selector assumption

### What we don't know yet (deferred until / unless onboarding ever comes back)

These open questions only matter if a future sprint reintroduces input collection in onboarding:

1. Why F1c's `:deep(.uni-input-placeholder) { display: none }` didn't actually hide the placeholder element on real iOS Safari (Mac DevTools showed it should work — `:deep()` syntax compiled correctly per `:deep()` usage elsewhere in the codebase that does work)
2. Whether iOS Safari 26.x has a specific behavior with uni-app custom elements not present in earlier iOS versions
3. Whether there's a uni-app runtime bug intercepting our `:deep()` rule before browser parse
4. Whether the `<uni-input>` template render in onboarding has any timing or hydration quirk that re-asserts a `display: block` on `.uni-input-placeholder` after our scoped style applies

These are NOT blocking. See `lesson_blind_iteration_stop_after_3.md` for the framing.

## Cross-refs

- O1 sprint that superseded this work: `docs/memory/o1_onboarding_removed.md`
- Lesson on when to pause iteration: `docs/memory/lesson_blind_iteration_stop_after_3.md`
- Audit (now known to be structurally wrong on selector target AND silent on placeholder overlay): `docs/audit/V35_onboarding_glyph_clipping_audit.md`
- Lesson on uni-app input wrapper: `docs/memory/lesson_uni_input_wrapper_not_native.md`
- Lesson on real-device gate: `docs/memory/lesson_ios_safari_realdevice_gate.md`
- Lesson on placeholder overlay: `docs/memory/lesson_uni_app_placeholder_overlay.md`
- Sprint tracker (v3.5 GC audit + F1 paused + O1 shipped row): `docs/memory/sprint_v3_phase_status.md`
- Backlog (status now SUPERSEDED by O1): `docs/memory/backlog_onboarding_glyph_clipping.md`
- Workflow step 4 — memory rides with deliverable: `docs/memory/workflow_audit_first.md`
- No-history-rewrite rule (why F1 + F1b + F1c commits are preserved on the branch): `docs/memory/opencode_no_self_decided_history_rewrite.md`
- M0 (predecessor V3 deliverable, same week): `docs/memory/v3_m0_post_chip_shipped.md`
