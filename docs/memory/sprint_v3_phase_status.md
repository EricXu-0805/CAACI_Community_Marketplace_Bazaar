---
name: V3 Visual Refresh — phase status tracker (P1 + P2a + v3.5 partial + M0 shipped, P2b queued)
description: Live tracker for the 4-phase v3 sprint per docs/audit/V3_VISUAL_REFRESH_SPEC.md. P1 (dark mode) shipped 2026-05-10; P2a (icon + button infrastructure) shipped 2026-05-11 via PR #12; v3.5 partial (2/6 backlog items) shipped 2026-05-13 via PR #13 squash 2243751; v3.5 onboarding keyboard audit shipped 2026-05-12 via separate audit/v35-onboarding-keyboard branch; M0 (post detail chip rendering) shipped 2026-05-17 via PR #18 squash 3299b0a; P2b queued; P3/P4 deferred. Update this file when phase status changes
type: project
originSessionId: b953b797-5c97-4889-9ddc-e30f716e29b0
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
| **v3.5 GC audit + F1 fix** | Onboarding step 1 nickname input glyph clipping | ✅ **AUDIT SHIPPED 2026-05-12 + FIX SHIPPED 2026-05-17 PR #?** | Audit on `audit/v35-onboarding-glyph-clipping` branch off main `7eda10b` (PR #17 squash `f9023b1`), 437-line audit at `docs/audit/V35_onboarding_glyph_clipping_audit.md`. F1 fix on `fix/f1-onboarding-glyph-clipping` branch (1-file 2-LOC SCSS): chose `line-height: 1.5` on `.input` over audit primary recommendation 1.4 for sibling consistency (`.sub` rule at line 206 already uses 1.5) + 0.86px safety margin under baseline. Three-green cleared for both audit and fix. Cross-ref: `v3_f1_glyph_clipping_shipped.md`. F5 orthogonal anomaly (dead-loaded webfont family-name mismatch) still queued for separate sprint. Details in `backlog_onboarding_glyph_clipping.md` + closeout md |
| **M0** | Post detail attached-item chip rendering (mig 041 regression) | ✅ **SHIPPED 2026-05-17** | PR #18, squash SHA `3299b0a`. Single-file fix (`post/index.vue` +55/-1) + 1-line side-fix in `usePlaza.ts` `fetchPost` order clause. Approach: copy-paste from plaza, NOT extracted component (defer to P2b). Eric H5 dev smoke verified post fresh-wipe DB state. Vercel auto-deploy completed ~15s. Details in `v3_m0_post_chip_shipped.md` |

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
- V3.5 GC audit details: `backlog_onboarding_glyph_clipping.md` (status + audit findings + F1 fix recommendation + 7 open questions + F5 orthogonal anomaly)
- V3.5 GC audit md: `docs/audit/V35_onboarding_glyph_clipping_audit.md`
- Cmd terminal truncation lesson from V3.5 GC audit triage: `lesson_git_show_terminal_truncation.md`
