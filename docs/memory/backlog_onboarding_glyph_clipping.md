---
name: Backlog — Onboarding step 1 nickname input glyph clipping (audit shipped 2026-05-12, fix queued)
description: Real iPhone Safari H5 prod — onboarding step 1 nickname `<input>` clips descenders / lower glyph portions inside the input box, observed pre-focus / pre-keyboard. Audit `docs/audit/V35_onboarding_glyph_clipping_audit.md` (437 lines) shipped 2026-05-12 via `audit/v35-onboarding-glyph-clipping` branch. F1 recommended: `line-height: 1.4` on `.input` (1-2 LOC single-file). 7 real-device smoke questions pending before fix sprint kickoff. ORTHOGONAL anomaly captured: F5 = dead-loaded webfont family-name mismatch (separate sprint).
type: project
originSessionId: b350322d-3f7f-470f-b423-3a74dd2cb691
---
**Symptom**: On `app/src/pages/onboarding/index.vue` step 1 (the post-signup "Let's get you set up — Pick a display name" screen), real iPhone Safari H5 prod, nickname `<input>` renders user-typed (or hydrated) text with descenders / lower glyph portions cropped. Only top half of CJK + Latin characters visible. Soft keyboard has **NOT** risen — bug manifests pre-focus, at initial render when `currentUser.value.nickname` is hydrated from `onMounted` (`app/src/pages/onboarding/index.vue:99-106`). Reported by Eric 2026-05-12 from prod `*-bazaar.vercel.app` screenshot (status bar timestamp 16:11).

**Distinct from**: `backlog_onboarding_keyboard_occlusion.md` (2026-05-12 audit) — that bug is about `.bottom` CTA buttons being hidden behind the risen soft keyboard. This bug is glyph clipping INSIDE the rendered input box, observed pre-focus / pre-keyboard. **Fix sprints MUST stay independent** — one bug's fix could mask or interact with the other.

**Status**: ✅ **AUDIT SHIPPED 2026-05-12** via `audit/v35-onboarding-glyph-clipping` branch (off main HEAD `7eda10b` — PR #16 squash). 1 atomic commit on feature branch: `docs(audit): v3.5 onboarding nickname glyph clipping audit` (437-line audit md at `docs/audit/V35_onboarding_glyph_clipping_audit.md`). Three-green pre-push gate cleared (vue-tsc exit 0 + build:h5 exit 0 + build:mp-weixin exit 0).

Fix sprint **queued**, not yet kicked off — pending Eric's real-device smoke of audit §5 questions.

**Audit root cause (H1, HIGH confidence)**: `.input` rule at `app/src/pages/onboarding/index.vue:209-213` has NO `line-height`, NO `height`, vertical-only `padding: 10px 0`, `font-size: 17px`. iOS Safari `<input>` does NOT reliably inherit page-level `line-height: 1.6` (`App.vue:765`); at `line-height: normal` resolved via system font (PingFang SC on iOS) intrinsic metrics (~1.4em ≈ 23.8px at 17px), descender envelope (~0.34em ≈ 5.78px below baseline) clips against the `<input>` element's implicit `overflow: hidden`. Codebase has 9 `<input>` rules in `app/src/**/*.vue`; onboarding is the only "underline-style + no height + vertical-only padding + 17px" outlier — all others either have explicit `height: 40-48px` (login/reset-password/post boxed pattern) or `font-size: 15px` (publish/search/profile minimal).

**Memory falsifications (audit corrected these — preserved for future similar bugs)**:

1. **Seed H2 ("custom webfont with non-standard `hhea`/`OS/2` metrics") FALSIFIED**: `@fontsource-variable/noto-sans-sc`, `/noto-serif-sc`, `/fraunces` are imported on H5 at `App.vue:26-30`. Their `@font-face` declares family names `'Noto Sans SC Variable'`, `'Fraunces Variable'` (**with " Variable" suffix**). But the codebase's font stacks at `App.vue:760-763`, `:707-709`, `:865-868`, `:1099-1103` reference plain `'Noto Sans SC'`, `'Fraunces'` (**without suffix**). Browser font matching is exact-by-name — webfonts are loaded but NEVER MATCHED. Actually-rendered font on iOS is system PingFang SC (first cascade member preinstalled on iOS). H2 reframed to "system font (PingFang SC) intrinsic metrics" (MEDIUM confidence).
2. **Seed H6 ("iOS auto-zoom + transform on focus") FALSIFIED**: iOS auto-zoom triggers only when `font-size < 16px` on focus. Onboarding `.input` is 17px (above threshold) + symptom is pre-focus (auto-zoom is post-focus). Falsified by static reasoning, closed-loop.

**Recommended fix (F1 from audit §6)**: add `line-height: 1.4;` (or `1.5`/`1.6` — implementer judgment) to `.input` rule at `app/src/pages/onboarding/index.vue:209-213`. 1-2 LOC, single-file, no `/* #ifdef */` conditional needed (CSS universal — H5 + mp-weixin both safe). Risk: very low. F1 addresses H1 directly + neutralizes H2 symptom. F1 does NOT bundle:

- **F3** (global `input, textarea { line-height: inherit }` at `App.vue:874-877` — architectural root fix, MEDIUM regression risk codebase-wide, deferred to follow-up sprint after Eric has bandwidth for full input-consumer visual regression sweep on plaza composer / login / publish / search / profile / saved-searches / post / reset-password)
- **F5** (dead-loaded webfont — orthogonal anomaly, separate sprint)

**Pending before fix sprint kickoff (audit §5 — 7 real-device smoke questions)**:

1. **Pre-focus vs typing**: clipping at initial render with persisted nickname, or only typing-triggered?
2. **Character-count threshold**: 1 char reproduces or only after N chars?
3. **Real WeChat MP rendering**: expected NO clip (native input), confirm
4. **iPhone orientation**: portrait vs landscape change anything?
5. **Script mix**: Latin-only vs CJK-only vs mixed; expected CJK clips more
6. **Placeholder vs typed value**: same clip behavior or different?
7. **iPhone SE small-viewport edge case**: 568px logical worsen the clip?

Eric to smoke real-device before chat-Claude writes the fix-only OpenCode prompt.

**Why this was audit-only first (per `sprint_form_audit_only_vs_one_pass.md`)** — preserved for similar future bugs:

- iOS Safari rendering quirk (cross-platform: H5 Safari iOS vs H5 Chrome Android vs mp-weixin native input)
- Quirky API: iOS Safari `<input>` `line-height` inheritance non-determinism, `<input>` implicit `overflow: hidden`
- Webfont family-name mismatch was a surprise finding not in seed hypotheses — audit-only let us catch it before any code change
- F3 (codebase-wide `line-height: inherit`) would have been the wrong-as-primary fix without first identifying that the 8 other `<input>` consumers already work; audit ruled F3 out as primary, kept as follow-up candidate

**Orthogonal anomaly captured (audit §7 #1, F5 candidate)**: `@fontsource-variable/*` webfonts are imported, bundled by Vite, fetched as woff2 on H5 cold start, decoded, and never matched by any selector due to family-name suffix mismatch. Pure bandwidth + decode + CSP cost for zero visual benefit. Fix sketch F5: either rename codebase references from `'Noto Sans SC'` → `'Noto Sans SC Variable'` (touches multiple App.vue lines) OR add aliasing `@font-face { font-family: 'Noto Sans SC'; src: local('Noto Sans SC Variable'); }` (cleaner, fewer touch points). **NOT BUNDLED with glyph-clipping fix sprint** — separate work after glyph fix lands.

**How to apply going forward**: do NOT bundle this fix with other UI sprints without re-reading audit's §5 open questions. If Eric asks to "just fix it quick," push back — F3 would have been the wrong primary fix; F1 is the right call but requires real-device verification on iPhone Safari. Once §5 questions are answered, fix-only OpenCode prompt scope-capped to `app/src/pages/onboarding/index.vue:209-213` `.input` rule addition.
