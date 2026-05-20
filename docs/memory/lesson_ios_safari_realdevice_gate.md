---
name: Lesson — iOS Safari / mp-weixin platform-specific fixes need real-device gate before squash-merge
description: F1 incident (2026-05-19) — chat-Claude approved squash-merge with only Mac dev three-green smoke for an iOS-Safari-specific bug. Fix actually worsened the bug. New HARD gate established — Vercel preview + real-device verification required before merge for any iOS Safari, mp-weixin native, or platform-specific UI fix. Mac dev (Chrome / Mac Safari) blind to RenderThemeIOS internal rendering, can NOT reproduce most iOS Safari quirks.
type: lesson
originSessionId: opencode-f1b-fix-session
---
# Lesson — iOS Safari `<input>` / `<textarea>` fixes need real-device gate before push

## Source: F1 calibration miss (2026-05-19)

## The miss

Chat-Claude approved F1 to push with only Mac dev smoke: `vue-tsc` + `build:h5` + `build:mp-weixin` three-green. Reasoning was "Mac Safari can't reliably reproduce iOS Safari rendering, so ship as belt-and-suspenders; audit confidence is HIGH on H1."

F1 (`line-height: 1.5` added to `.input` in `pages/onboarding/index.vue`) then **failed real-device verification on Vercel preview** — visible glyph percentage actually WORSENED from ~50% (pre-F1) to ~10% (post-F1) on iPhone Safari.

Root miss: chat-Claude over-indexed on the audit's "H1 HIGH confidence" claim without verifying the audit's mechanism analysis was structurally correct. The audit was wrong about WHICH DOM element `.input` SCSS targets — it assumed native `<input>`, actually targets uni-app's outer `<uni-input>` custom element. The fix proposed by the audit (line-height on `.input`) therefore acted on the wrong element with unintended cascade effects.

PR #20 closed without merge. F1b shipped via forward-add commit (height override matching login pattern). F1 commit `4298053` preserved on the same feature branch as audit-failed historical record.

## The new rule

**Any bug fix targeting iOS Safari or mp-weixin platform-specific behavior MUST have Vercel preview + real-device verification before squash-merge.**

Mac dev smoke (Chrome / Mac Safari) IS NOT SUFFICIENT for:

- iOS Safari `<input>` / `<textarea>` rendering (line-height, height, padding, native textfield appearance)
- iOS Safari `-webkit-appearance` / `RenderThemeIOS` native-control behavior
- iOS Safari viewport / keyboard / `safe-area-inset` / orientation behavior
- iOS Safari scroll / overscroll / momentum / bfcache
- mp-weixin native component rendering (`<input>`, `<textarea>`, `<picker>`, `<button>` — all platform-conditional)
- PingFang SC / Chinese font glyph metrics (Mac PingFang SC differs from iOS PingFang SC in rendering pipeline)
- Any CSS using viewport units `vh` / `dvh` / `svh` / `lvh` (Safari toolbar quirks)
- Any uni-app component compiled to a custom element that has framework-injected CSS (uni-input, uni-textarea, uni-button, uni-picker, etc.)

## The gate (HARD, applies to chat-Claude approval flow)

1. OpenCode runs code change on feature branch + three-green pre-push hook passes
2. `git push` → Vercel auto-deploys preview (~30s)
3. **Eric opens the Vercel preview URL on real iPhone Safari** (NOT Mac, NOT Chrome DevTools mobile mode, NOT iOS simulator)
4. **Eric reproduces the original symptom + verifies fix actually resolves it**
5. **Eric pastes preview screenshot back to chat as evidence**
6. Only THEN does chat-Claude approve squash-merge to main

Skipping step 3-5 in favor of "Mac dev looked fine, ship anyway" or "audit says high confidence, ship anyway" is **no longer acceptable**. The F1 incident proved that "Mac dev can't reproduce" + "audit high confidence" is NOT equivalent to "fix verified."

## Exception cases (Mac dev smoke OK, no real-device required)

- Pure backend / SQL / API / Vercel function changes with no UI surface
- Pure docs / memory / comment-only commits (no rendered output change)
- Non-platform-specific UI fixes (logic-only, layout-only on universal CSS that's already worked across both platforms in prod)
- Pure refactor that swaps one well-known prod-verified pattern for another (e.g. UIcon/UButton P2b surface migration — the components themselves are prod-verified)

When in doubt: treat as requiring real-device gate.

## Cost analysis

Real-device preview verification adds ~5-10 minutes per fix sprint (push + wait for Vercel + open on iPhone + screenshot + paste). The F1 incident cost ~2 hours total: re-audit (Oracle consultation 10 min + synthesis 15 min) + close PR + design F1b (this commit) + new PR cycle + new real-device verification. The gate is therefore strictly net-positive for any sprint with >2% probability of platform-specific rendering quirks — which describes basically every UI fix sprint on this app.

## Lessons-of-the-lesson

1. **"Belt-and-suspenders" reasoning is not a substitute for verification.** A fix that should theoretically work and a fix that does work are different things. Ship the second.

2. **Audit confidence ≠ audit correctness.** A HIGH-confidence audit can still be structurally wrong about the mechanism. The confidence rating reflects how internally consistent the audit's reasoning is, not whether the audit identified the right cause.

3. **Mac dev is for type-checking and build smoke, not for visual verification.** When the bug is about rendering on a specific platform, only that platform can verify the fix.

4. **The first push of a platform-specific fix is a "preview deploy," not a "ship."** Treating the first push as a real-device-test trigger (then close/iterate as needed) avoids the bias of "I already pushed it, must merge it."

## Related

- F1 attempt → F1b fix history: `docs/memory/v3_f1_glyph_clipping_shipped.md`
- uni-app `<input>` DOM truth: `docs/memory/lesson_uni_input_wrapper_not_native.md`
- Three-green pre-push gate (still applies, but is now the FIRST gate not the only gate): `docs/memory/pre_push_three_green.md`
- 5-step sprint workflow (smoke test step now explicitly includes real-device for platform-specific fixes): `docs/memory/workflow_audit_first.md`
