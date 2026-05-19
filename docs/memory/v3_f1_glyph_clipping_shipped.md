---
name: F1 — Onboarding nickname input glyph clipping fix shipped 2026-05-17
description: Fixed iOS Safari PingFang SC descender clipping on onboarding step 1 nickname input. Single-file 2-LOC SCSS fix at app/src/pages/onboarding/index.vue:209-213 — added `line-height: 1.5` declaration + inline comment. Chose 1.5 over audit primary recommendation 1.4 for sibling consistency (`.sub` already uses 1.5) + 0.86px safety margin under baseline. PR #? squash TBD. Belt-and-suspenders fix verified by audit H1 high-confidence + Eric's prod screenshot evidence; Mac dev does not reliably reproduce iOS Safari clipping.
type: project
originSessionId: opencode-f1-fix-session
---
# F1 — Onboarding nickname input glyph clipping fix shipped 2026-05-17

## Status: SHIPPED via PR #?, squash <TBD-sha>

## Scope
- Fixed iOS Safari PingFang SC descender clipping on onboarding step 1 nickname input
- Symptom: descenders (y/g/p/q + CJK 肯尼's lower strokes) clipped at input bottom edge — visible on Eric's prod screenshot (2026-05-12 16:11 timestamp, audit §1)
- Audit: `docs/audit/V35_onboarding_glyph_clipping_audit.md` (437L, shipped 2026-05-12 via PR #17 squash `f9023b1`)
- Root cause (H1 in audit, HIGH confidence): `.input` rule had no explicit `line-height`, fell back to browser default (`normal`) which on iOS Safari resolves the line-box tightly against the PingFang SC font envelope, clipping descenders below the line-box boundary

## Files touched
- `app/src/pages/onboarding/index.vue` (+2 lines at SCSS rule for `.input`, lines 209-213)
  - Inline comment above the affected declaration line explaining the iOS Safari descender fix + audit cross-ref
  - Added `line-height: 1.5` to `.input` rule on the same line as `font-size: 17px` (preserves the existing dense single-line declaration style)

## Decisions locked
- **Value: 1.5** (vs audit primary recommendation of 1.4)
  - Sibling `.sub` rule at line 206 already uses `line-height: 1.5` → file-internal consistency
  - 0.86px safety margin under baseline (vs 1.4's 0px exact-match clearance against the PingFang SC font envelope)
  - Total input height becomes ~45.5px ≥ iOS HIG 44px touch-target minimum ✅
  - Chat-Claude's prompt referenced "3.4px 余裕" for 1.4 — that figure came from audit §3 H3's discussion of `line-height: 1.6`, NOT 1.4. The 1.4 path gives 0px clearance (line-box exactly equals font envelope). Corrected during audit-readiness review before fix prompt.
- **Inline SCSS comment included** — anchors fix rationale for future readers; matches the M0 SCSS-comment pattern used in `pages/post/index.vue`
- **Branch: `fix/f1-onboarding-glyph-clipping`** — matches M0's `fix/m0-…` and F-numbering convention (F1 from audit §6 candidates)
- **Approach: single-file SCSS-only**:
  - F2 (keyboard occlusion) is a separate sprint with its own audit + backlog
  - F3 (global `input, textarea { line-height: inherit }` in `App.vue:874-877`) deferred per audit §6 risk analysis — codebase-wide regression scope
  - F4 (`-webkit-appearance: none`) not in scope — H5 hypothesis in audit was LOW confidence
  - F5 (dead-loaded webfont family-name mismatch) orthogonal anomaly, separate sprint

## Smoke
- H5 only this round (mp-weixin runtime smoke deferred to network-stable phase per Eric)
- Three-green pre-push gate cleared: `vue-tsc --noEmit` + `npm run build:h5` + `npm run build:mp-weixin` all exit 0
- Mac dev browsers (Chrome/Safari) do not reliably reproduce iOS Safari clipping — fix is belt-and-suspenders verified by:
  - Audit H1 HIGH-confidence root-cause analysis (audit §3 H1, §6 F1)
  - Eric's prod screenshot establishing pre-focus clipping path (audit §1)
- Suggested H5 smoke test strings: `Kenny ypqgj 肯尼` — descender-heavy Latin + CJK mix; iPhone SE preset (375×667) in DevTools; dark mode toggle

## Deferred / future
- F2 (keyboard occlusion, audit shipped 2026-05-12): F1 makes input ~6-8px taller, marginally worsens F2's worst case at small viewports with keyboard up. F2 sprint design absorbs the delta. Recommended F2 ships within ~1 week of F1 to limit window where the amplified worst case exists.
- F3 (global `input, textarea { line-height: inherit }` in `App.vue:874-877`): broader scope, deferred per audit §6 risk analysis. Codebase-wide regression check on all `<input>` consumers (publish, login, reset-password, post, search, profile, saved-searches) required before shipping.
- F5 (dead-loaded webfont family-name mismatch — `@fontsource-variable/noto-sans-sc`, `/noto-serif-sc`, `/fraunces` imported but never matched by any selector due to " Variable" suffix mismatch): orthogonal H5-only anomaly, captured in `backlog_onboarding_glyph_clipping.md` L46
- Real-device questions Q3 (mp-weixin native input), Q4 (orientation), Q7 (iPhone SE physical device) from audit §5: low-risk defaults assumed at ship time; verify post-deploy on real iPhone Safari when convenient. Audit predicts: Q3 = no clip on mp-weixin native, Q4 = orientation-invariant, Q7 = same on SE viewport.

## How to apply going forward
When shipping iOS Safari CSS fixes:
- Mac dev may not reproduce iOS Safari rendering — don't gate ship on dev repro if audit confidence is HIGH and there's prod screenshot evidence
- Check sibling rules in the same SFC for value-consistency idiom (this fix chose 1.5 because `.sub` already used 1.5)
- Inline comment with audit cross-ref helps future readers understand non-obvious typography fixes; matches the M0 cross-ref-comment pattern
- When adding `line-height` to inputs, recompute total box height vs iOS HIG 44px touch-target minimum to ensure UX improvement (or at least non-regression)
- For audit-driven fixes, the audit's "primary recommended value" is a starting point — file-internal stylistic precedent can justify deviation (record the decision)

## Cross-refs
- Audit md: `docs/audit/V35_onboarding_glyph_clipping_audit.md`
- Backlog (status now FIX SHIPPED): `backlog_onboarding_glyph_clipping.md`
- Sprint tracker (v3.5 GC audit + F1 fix row): `sprint_v3_phase_status.md`
- Workflow step 4 — memory rides with deliverable: `workflow_audit_first.md`
- Three-green hook: `pre_push_three_green.md`
- M0 (predecessor V3 deliverable, same week): `v3_m0_post_chip_shipped.md`
- Lesson on template-binding context: `lesson_template_binding_full_block.md`
