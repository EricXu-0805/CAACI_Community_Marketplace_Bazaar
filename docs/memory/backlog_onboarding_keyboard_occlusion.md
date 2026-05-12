---
name: Backlog — Onboarding step 1 nickname input keyboard occlusion
description: New users on `pages/onboarding/index.vue` step 1 see nickname input partially covered by soft keyboard; cross-platform keyboard quirk; audit-only first per workflow memory; surfaced 2026-05-12
type: project
---

**Symptom**: On `app/src/pages/onboarding/index.vue` step 1 (the post-signup profile setup screen where new users fill nickname / campus area / avatar), when the user taps the nickname `<input>` to type, the soft keyboard rises and **partially covers the input field or the bottom CTA buttons**. Reported by Eric 2026-05-12 during post-wipe smoke test.

**Code area**:
- `app/src/pages/onboarding/index.vue` — step 1 template at lines ~11-25 (nickname `<input>` element), `.bottom` CTA block at lines ~60-67
- Likely root cause family: `position: fixed` `.bottom` interacting with soft keyboard rise; H5 vs mp-weixin diverge here (H5 has no `adjust-position`, mp-weixin has it but `position: fixed` elements don't auto-lift)

**Why this is audit-only first (per `sprint_form_audit_only_vs_one_pass.md`)**:
- Cross-platform code paths diverge: H5 uses `visualViewport` API, mp-weixin uses `uni.onKeyboardHeightChange` / `cursor-spacing`
- Quirky platform API: `adjust-position` (mp-only), iOS Safari historical behavior on `position: fixed`
- Prior precedent: D3 keyboard dock sprint (2026-05-09 to 05-10) was audit-only first and caught 7 quirks before any code was written
- Wrong fix choice (e.g. blanket `cursor-spacing="100"`) could introduce new layout bugs on the other platform

**Status**: deferred 2026-05-12. The v3.5 launch-blocker bundle PR (avatar dark fallback × 12 surfaces + banner skeleton token-ization) **does NOT include the fix** — it was descoped from one-pass to keep the audit-only discipline.

**Next step**: write a separate audit-only OpenCode prompt that produces `docs/audit/V35_ONBOARDING_KEYBOARD_AUDIT.md`. The audit md should:
1. Document current layout (CSS `position`, safe-area, input attrs `adjust-position` / `cursor-spacing` / `confirm-type` / `hold-keyboard` / `auto-focus` actual values)
2. Document cross-platform keyboard behavior (H5 vs mp-weixin) with line-cited evidence from this file
3. Rank 3-4 root-cause hypotheses (mechanism + evidence + confidence)
4. Rank 3-5 fix candidates (one-liner + files touched + platform compat + risk + commit size)
5. Recommend one fix path with rationale

After audit ships, chat-Claude reviews the hypothesis ranking and recommended path, then writes a small fix-only OpenCode prompt (1 atomic commit, scope-capped).

**How to apply going forward**: do NOT bundle this fix with other UI sprints without an audit first. If Eric asks to "just fix it quick," push back per workflow memory — keyboard handling has burned us before.
