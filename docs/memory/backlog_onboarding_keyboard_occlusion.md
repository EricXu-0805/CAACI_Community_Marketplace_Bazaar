---
name: Backlog — Onboarding step 1 nickname input keyboard occlusion (audit shipped, fix queued)
description: New users on `pages/onboarding/index.vue` step 1 see nickname input partially covered by soft keyboard. Audit shipped 2026-05-12 via `audit/v35-onboarding-keyboard` branch (`docs/audit/V35_onboarding_keyboard_audit.md`, 381 lines). Fix sprint queued: F2 reuses `useKeyboardHeight.ts` composable from D3, single-file ~10-15 LOC. 4 real-device open questions pending before kickoff.
type: project
originSessionId: b953b797-5c97-4889-9ddc-e30f716e29b0
---
**Symptom**: On `app/src/pages/onboarding/index.vue` step 1 (the post-signup profile setup screen where new users fill nickname / campus area / avatar), when the user taps the nickname `<input>` to type, the soft keyboard rises and **partially covers the input field or the bottom CTA buttons**. Reported by Eric 2026-05-12 during post-wipe smoke test.

**Status**: ✅ **AUDIT SHIPPED 2026-05-12** via `audit/v35-onboarding-keyboard` branch, squash-merged to main. 2 atomic commits on feature branch:
1. `chore(gitignore): whitelist docs/audit/` — class fix paralleling 1f8b0f0 / PR #11; unblocks audit md staging (see `lesson_audit_md_lowercase_suffix.md`)
2. `docs(audit): v3.5 onboarding keyboard occlusion audit` — 381-line audit at `docs/audit/V35_onboarding_keyboard_audit.md`

Fix sprint **queued**, not yet kicked off.

**Audit root-cause finding (H1, HIGH confidence)**: onboarding has zero keyboard-height handling. `.page { min-height: 100vh }` + `.step { flex: 1 }` push `.bottom` to the natural bottom of the unshrunken layout viewport. When soft keyboard rises, layout doesn't reflect the shrink — `.bottom` ends up in the keyboard-occluded band. On small-screen devices (iPhone SE ~568px) the input itself can also clip into the keyboard top.

**Memory falsification (audit corrected this)**: the original "Likely root cause family: `position: fixed` `.bottom`" hypothesis written into this memory pre-audit was **wrong**. Actual `.bottom` at `app/src/pages/onboarding/index.vue:237` is `display: flex; gap: 10px; padding-top: 16px;` — static flex child of `.page`, no `position` attribute. Lesson going forward: backlog memories that hypothesize root cause before file inspection should mark the hypothesis as "(unverified — needs audit)"; never let an unverified guess frame the prompt's anchor list.

**Recommended fix (F2 from audit §6)**: import `useKeyboardHeight.ts` composable (already shipped in D3 sprint 2026-05-10, plaza is current sole consumer). Bind `:style="{ transform: 'translateY(-${kb.height}px)' }"` on `.bottom`. Add `transition: transform 0.2s ease-out; will-change: transform;` SCSS for smoothness. ~10-15 LOC, single file (`app/src/pages/onboarding/index.vue`). Onboarding becomes the composable's 2nd consumer — still setup-scoped (per-instance), no shared-state risk. Satisfies `sprint_form_audit_only_vs_one_pass.md`'s "audit+fix 一把过" criteria for the fix sprint.

**Pending before fix sprint kickoff**: 4 real-device open questions from audit §7 still need verification —
1. mp-weixin vh re-evaluation behavior on keyboard rise (base-library-version dependent)
2. iPhone SE clip edge case (small viewport + bottom buttons squeeze when keyboard up)
3. `subtractIosSafeArea` UX default preference in the composable call
4. `switchTab` lifecycle cleanup verification (already specced safe, real-device confirms)

Eric to smoke real-device before chat-Claude writes the fix-only OpenCode prompt.

**Why this was audit-only first (per `sprint_form_audit_only_vs_one_pass.md`)** — preserved for similar future bugs:
- Cross-platform code paths diverge: H5 uses `visualViewport` API, mp-weixin uses `uni.onKeyboardHeightChange` / `cursor-spacing`
- Quirky platform API: `adjust-position` (mp-only), iOS Safari historical behavior on `position: fixed`
- Prior precedent: D3 keyboard dock sprint (2026-05-09 to 05-10) was audit-only first and caught 7 quirks before any code was written
- Wrong fix choice (e.g. blanket `cursor-spacing="100"`) could introduce new layout bugs on the other platform

**How to apply going forward**: do NOT bundle this fix with other UI sprints without re-reading the audit's §7 open questions. If Eric asks to "just fix it quick," push back — keyboard handling has burned us before. Once real-device questions are resolved, fix-only OpenCode prompt should be scope-capped to `app/src/pages/onboarding/index.vue` template binding + `<script setup>` import + SCSS transition.
