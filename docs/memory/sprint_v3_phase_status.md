---
name: V3 Visual Refresh — phase status tracker (P1 shipped, P2-P4 deferred)
description: Live tracker for the 4-phase v3 sprint per docs/audit/V3_VISUAL_REFRESH_SPEC.md. P1 (dark mode) shipped 2026-05-10; P2/P3/P4 deferred indefinitely as of same date — Eric will signal restart. Update this file (not v3_p1_dark_mode_shipped.md) when phase status changes
type: project
---

| Phase | Scope | Status | Notes |
|---|---|---|---|
| **P1** | Dark mode token + 5 component fixes | ✅ **SHIPPED 2026-05-10** | Main squash `162b1a9` + hotfix squash `e8becd7` (#9). Full details in `v3_p1_dark_mode_shipped.md` |
| **P2** | UIcon + UButton + 22 SVG icons + 6 surface migration | ⏸ **DEFERRED 2026-05-10** | Eric postponed; no restart date. SPEC §P2 in `docs/audit/V3_VISUAL_REFRESH_SPEC.md` is ready when resumed |
| **P3** | Sticker set (12 essential 自绘 + Twemoji fallback) + ChatEmojiPanel rewrite + i18n emoji cleanup | ⏸ **DEFERRED 2026-05-10** | SPEC §P3 ready. Q3-A answer (Eric: a — Claude attempts SVG draws first) is locked in for restart |
| **P4** | Motion sweep + 8 component micro-interactions | ⏸ **DEFERRED 2026-05-10** | SPEC §P4 ready. Q4-A and Q4-B still open at restart time |
| **v3.5** | Polish sweep (avatar dark fallback to 12 surfaces, banner skeleton, frame token clarification, Sass deprecation, list-row contrast, partial-swipe leak) | 📋 **BACKLOG** | Itemized in `v3_p1_dark_mode_shipped.md` "v3.5 backlog" section. Best done after P2-P4 land |

---

**When restarting any phase:** chat-Claude should ask Eric "ready to resume Px?" before writing the OpenCode prompt. SPEC sections are stable. The P2 prompt was scoped but never written (Eric deferred before chat-Claude started drafting it).

**Cross-refs:**
- Sprint spec: `docs/audit/V3_VISUAL_REFRESH_SPEC.md`
- P1 closeout details: `v3_p1_dark_mode_shipped.md`
- Template-binding lesson from hotfix: `lesson_template_binding_full_block.md`
