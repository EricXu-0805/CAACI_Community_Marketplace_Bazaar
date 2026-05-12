---
name: V3 Visual Refresh — phase status tracker (P1 + P2a + v3.5 partial shipped, P2b queued)
description: Live tracker for the 4-phase v3 sprint per docs/audit/V3_VISUAL_REFRESH_SPEC.md. P1 (dark mode) shipped 2026-05-10; P2a (icon + button infrastructure) shipped 2026-05-11 via PR #12; v3.5 partial (2/6 backlog items) shipped 2026-05-13 via PR #13 squash 2243751; v3.5 onboarding keyboard audit shipped 2026-05-12 via separate audit/v35-onboarding-keyboard branch; P2b queued; P3/P4 deferred. Update this file when phase status changes
type: project
---

| Phase | Scope | Status | Notes |
|---|---|---|---|
| **P1** | Dark mode token + 5 component fixes | ✅ **SHIPPED 2026-05-10** | Main squash `162b1a9` + hotfix squash `e8becd7` (#9). Full details in `v3_p1_dark_mode_shipped.md` |
| **P2a** | UIcon + UButton + 43 icons / 52 SVGs + preview HTML | ✅ **SHIPPED 2026-05-11** | PR #12, 6 atomic commits `a8870a9` → `1234786`. Squash SHA TBD next session. Details in `v3_p2a_shipped.md` |
| **P2b** | 6 surface migration (CustomTabBar, detail, chat, profile, publish, index) | 🚀 **QUEUED — ready for OpenCode prompt** | All P2a infrastructure landed; surface migrations are pure consumption. chat-Claude to write P2b OpenCode prompt next time Eric signals "ready" |
| **P3** | Sticker set (12 essential 自绘 + Twemoji fallback) + ChatEmojiPanel rewrite + i18n emoji cleanup | ⏸ **DEFERRED 2026-05-10** | SPEC §P3 ready. Q3-A answer (Eric: a — Claude attempts SVG draws first) is locked in for restart |
| **P4** | Motion sweep + 8 component micro-interactions | ⏸ **DEFERRED 2026-05-10** | SPEC §P4 ready. Q4-A and Q4-B still open at restart time |
| **v3.5** | Polish sweep (avatar dark fallback × 12 surfaces, banner skeleton, frame token clarification, Sass deprecation, list-row contrast, partial-swipe leak) | 🚧 **PARTIAL — 2 of 6 SHIPPED 2026-05-13** | PR #13 (squash `2243751`): avatar fallback × 12 + banner skeleton tokens. 4 items + 1 new follow-up (shimmer reactivation) remaining. Details in `v35_launch_blocker_shipped.md` |
| **v3.5 KB audit** | Onboarding step 1 nickname input keyboard occlusion — audit only | ✅ **AUDIT SHIPPED 2026-05-12** | Branch `audit/v35-onboarding-keyboard` squash-merged to main. 2 commits: `chore(gitignore): whitelist docs/audit/` (class fix parallel to PR #11) + `docs(audit): v3.5 onboarding keyboard occlusion audit` (381-line audit at `docs/audit/V35_onboarding_keyboard_audit.md`). Fix sprint **queued**: F2 reuses `useKeyboardHeight.ts` from D3, ~10-15 LOC single-file. 4 real-device open questions pending (audit §7) before fix kickoff. Details in `backlog_onboarding_keyboard_occlusion.md` |

---

**When restarting any phase:** chat-Claude should ask Eric "ready to resume Px?" before writing the OpenCode prompt. SPEC sections are stable. The P2 prompt was scoped but never written (Eric deferred before chat-Claude started drafting it).

**Cross-refs:**

- Sprint spec: `docs/audit/V3_VISUAL_REFRESH_SPEC.md`
- P1 closeout details: `v3_p1_dark_mode_shipped.md`
- P2a closeout details: `v3_p2a_shipped.md`
- v3.5 partial closeout details: `v35_launch_blocker_shipped.md`
- Template-binding lesson from P1 hotfix: `lesson_template_binding_full_block.md`
- Spec-side token-check lesson from v3.5 shimmer trade-off: `lesson_spec_token_check_actual_values.md`
- V3.5 KB audit details: `backlog_onboarding_keyboard_occlusion.md` (status + audit findings + F2 fix recommendation + 4 open questions)
- V3.5 KB audit md: `docs/audit/V35_onboarding_keyboard_audit.md`
- Two-STOP `.gitignore` lesson from V3.5 KB audit: `lesson_audit_md_lowercase_suffix.md`
