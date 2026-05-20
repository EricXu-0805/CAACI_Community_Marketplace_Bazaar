---
name: Lesson — Stop blind iteration after 3 failed attempts on the same bug
description: After 3 fix attempts on the same bug all fail real-device verification, STOP iterating and reassess scope. Don't ship a 4th immediate fix. Reassess whether the entire feature is worth keeping, whether the bug can be routed around, and whether the failed attempts already constitute valuable learning. F1 sprint (2026-05-20) is the canonical example — 3 failed attempts produced 4 lesson files and led to O1 (onboarding flow removal) instead of a 4th doomed iteration.
type: lesson
originSessionId: opencode-o1-onboarding-removed-session
---
# Lesson — Stop blind iteration after 3 failed attempts on the same bug

## Source: F1 sprint paused / O1 supersedes (2026-05-20)

## The pattern (3 failed attempts at onboarding glyph clip)

| Attempt | Approach | Audit confidence | Real-device result |
|---|---|---|---|
| **F1** (`4298053`, PR #20 closed) | `line-height: 1.5` on `.input` | "HIGH — H1 confirmed" | ❌ WORSE (~50% → ~10% visible) |
| **F1b** (`4c2265e`, PR #21 first commit) | Replace with `height: 48px` override matching login `.form-input` | "HIGH — audit reality-check uncovered uni-input wrapper truth, structural fix" | ❌ New bug exposed (placeholder overlay) |
| **F1c** (`45fe92e`, PR #21 second commit) | `:deep(.uni-input-placeholder) { display: none }` | "HIGH — audit + Web Inspector data + framework CSS rule verified" | ❌ Failed (gray bar still present on iPhone Safari preview) |

Each attempt had:
- A coherent technical hypothesis with supporting evidence
- Three-green pre-push gate passed
- Mac dev smoke "OK"
- Chat-Claude approval based on internal-consistency audit confidence
- Real-device failure that revealed yet another mechanism

## The rule

**After 3 fix attempts on the same bug all fail real-device verification:**

1. **STOP** writing F1d / F2d / Mxd. Do NOT attempt a 4th immediate fix.
2. **REASSESS SCOPE:**
   - Is the entire feature worth keeping at all?
   - Can we route AROUND the bug (skip the broken surface, remove the feature, or replace with a simpler alternative)?
   - Is the bug actually orthogonal to the feature value? (i.e., are we polishing a feature that doesn't need to exist?)
3. **DOCUMENT** the 3 failed attempts as preserved learning (separate lesson files per attempt's audit insights — these are NOT failures, they're knowledge artifacts that prevent future repeats).
4. **PAUSE** the sprint and move to other work. Revisit only with NEW DIAGNOSTIC CAPABILITY:
   - Older iOS device for comparison
   - Framework GitHub issue investigation
   - Expert consultation (Oracle / outside developer)
   - A reproducible minimal case outside the project

## Why 3 specifically (not 2, not 5)

- **1 fail:** normal. Audit may have missed a detail. Iterate with refined hypothesis. The audit framework itself is still trustworthy.
- **2 fails:** audit framework needs reality-check. Consult Oracle. Reframe mechanism. The mechanism may still be identifiable with better tools.
- **3 fails:** **the pattern is now mechanism-blind**. Further iterations will likely also fail because the bug surface is producing unexpected interactions faster than the audit framework can model them. The cost-benefit shifts from "fix the bug" to "reassess whether to fix at all."

By attempt 3, you have enough information about the bug's mechanism complexity to make an informed scope decision — and crucially, you also have enough sunk cost that the "let me try just one more thing" trap becomes psychologically loud. The rule exists to override that trap.

## What pause looks like in practice (F1 → O1)

The F1 sprint pause was net-positive because:

- **3 attempt commits preserved on `fix/f1-onboarding-glyph-clipping` branch** — full learning chain visible in git log
- **4 lesson files extracted** — infrastructure-grade knowledge ready to apply to future input / iOS / framework sprints:
  - `lesson_uni_input_wrapper_not_native.md`
  - `lesson_ios_safari_realdevice_gate.md`
  - `lesson_uni_app_placeholder_overlay.md`
  - this file
- **Feature reassessment surfaced O1** (onboarding flow entirely removable; only legal consent was load-bearing) — net-positive outcome
- **Eric's energy preserved** for higher-leverage work — no further wasted iteration cycles

**Compare to the alternative:** 4th-5th-6th attempt at the glyph fix could have burned another 2-3 hours of session time, accumulated more failed-attempt screenshots, and likely still failed because the mechanism stack (iOS Safari + uni-app + scoped CSS + framework CSS + RenderThemeIOS shadow DOM) was not fully understood. Net-negative outcome with high probability.

## When to break this rule (rare)

ONLY proceed past attempt 3 if ALL THREE conditions are met:

1. **The bug is launch-blocking** AND can't be routed around (no feature removal / replacement is acceptable).
2. **New diagnostic data has appeared** that fundamentally changes the mechanism understanding (not just a new hypothesis about existing data — that's audit reality-check level, which happens between attempts 1 and 2).
3. **User judgment is fresh** — not 7+ hours into a session, not after consecutive late-night sessions, not when the user has explicitly said they're tired.

In the F1 → O1 case, NONE of these applied:
- Onboarding wasn't launch-blocking (8-month timeline + the feature itself was removable)
- No new data, only new hypotheses
- Eric was 7+ hours in by the time F1c shipped

## Adjacent rules / cross-refs

- **Real-device gate** (`lesson_ios_safari_realdevice_gate.md`): the first line of defense — Mac dev smoke is NOT sufficient for iOS Safari / mp-weixin / platform-specific UI fixes
- **Audit reality-check** (between attempts 1 and 2): when attempt 1 fails real-device, consult Oracle and verify the audit's mechanism analysis is structurally correct (not just internally consistent)
- **Forward-add only** (`opencode_no_self_decided_history_rewrite.md`): preserve the learning chain on the feature branch — failed attempts are not embarrassment, they're documentation

## Why this rule applies to chat-Claude approval, not just OpenCode execution

The "let me try just one more thing" trap is psychologically loud at the chat-Claude approval gate too. Chat-Claude is the actor who:
- Reviews the audit
- Approves the OpenCode prompt for the next iteration
- Decides "we have enough info, ship it" vs "we don't, pause"

After 3 fix attempts fail, **chat-Claude SHOULD push back on a 4th immediate iteration** even if the user requests it. The push-back should sound like:

> "We've tried 3 fixes (X / Y / Z) and all failed real-device. The pattern is now mechanism-blind. Before iteration 4, I want to either (a) reassess whether the feature is removable, (b) acquire new diagnostic capability, or (c) consult Oracle on whether this is a uni-app / iOS bug rather than our app code. Which one?"

This rule formalizes that push-back posture.

## Related

- F1 sprint history (preserved as canonical example): `docs/memory/v3_f1_glyph_clipping_shipped.md`
- O1 replacement (the "route around the bug" outcome): `docs/memory/o1_onboarding_removed.md`
- Real-device verification gate: `docs/memory/lesson_ios_safari_realdevice_gate.md`
- Workflow ordering (debug → OpenCode → smoke → memory → push): `docs/memory/workflow_audit_first.md`
- Forward-add only rule (preserves the failed-attempts learning chain): `docs/memory/opencode_no_self_decided_history_rewrite.md`
