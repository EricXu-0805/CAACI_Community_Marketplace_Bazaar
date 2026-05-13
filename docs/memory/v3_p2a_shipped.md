---
name: V3 Phase 2a — Icon + Button infrastructure shipped 2026-05-11 (PR #12)
description: 43 icon names / 52 SVG variants frozen via 10 design rounds; UIcon.vue + UButton.vue + registry.ts + preview HTML on feat/v3-p2a-icon-components branch; P2b surface migration is next phase; squash SHA TBD next session
type: project
originSessionId: 8ed7d95e-d7be-4a14-ac48-2308079cb50d
---
V3 visual refresh sprint Phase 2a delivered via PR #12 on `feat/v3-p2a-icon-components` (6 atomic commits: a8870a9 → 1234786). Squash merge SHA to be back-filled next session.

**New files (committed via P2a PR):**
- `app/src/components/UIcon.vue` — props: name (43-name union), weight (regular/filled), size (xs/sm/md/lg = 16/20/24/32), color (token-name | hex | currentColor). v-html renders inline SVG from registry. Fallback chain `name-weight` → `name-regular` → empty.
- `app/src/components/UButton.vue` — 5 variants (primary/secondary/ghost/campus/danger) × 3 sizes (sm/md/lg = 32/44/52 height) × 5 states (default/hover/active/disabled/loading). Hover gated by `(hover: hover) and (min-width: 768px)`. Min-width 44px on all sizes for iOS tap target. Motion uses prod `--dur-1` / `--ease-std` tokens. Inline SVG spinner for loading state.
- `app/src/components/icons/registry.ts` — 52 inline SVG strings, frozen design. Exports `IconName` type union (43 names) + `IconWeight` ('regular' | 'filled') + `ICONS` Record. Sublease category aliases to `home-regular` at UI layer (no `cat-sublease` key per round-10 decision).
- `docs/v3-p2a-component-preview.html` — standalone HTML for visual review with light/dark theme toggle. Tokens embedded inline from `App.vue:972-1146` + `:1164-1236`. 52 icon renders + 75 button instance matrix (5 variants × 3 sizes × 5 states).
- `docs/audit/V3_P2A_OPENCODE_PROMPT.md` — build prompt archived for sprint audit trail.

**Build status:** all three green — `vue-tsc` + `build:h5` + `build:mp-weixin` pass. mp-weixin built clean because no surface yet consumes UIcon (the `v-html` runtime concern only manifests when WXSS-rendered pages try to use the components, which is P2b). Deferral per SPEC §CC-1 still nominally applies for P2b component-runtime work.

**Why:** Phase 2 of the 4-phase v3 refresh per `docs/audit/V3_VISUAL_REFRESH_SPEC.md`. Splits into 2a (infrastructure, this) + 2b (surface migration, separate run later).

**Icon design lock dates:**
- Visual review rounds 1-10: 2026-05-11
- Registry frozen 2026-05-11 (43 names / 52 SVG variants)
- P2a build merged via PR #12: 2026-05-11

**Cross-refs:**
- Icon design source-of-truth + round history: `docs/audit/V3_P2_ICON_REGISTRY_DRAFT.md`
- Build prompt: `docs/audit/V3_P2A_OPENCODE_PROMPT.md`
- Spec: `docs/audit/V3_VISUAL_REFRESH_SPEC.md` §P2
- Phase tracker: `sprint_v3_phase_status.md` (P2 status updated to "P2a SHIPPED / P2b QUEUED")

**How to use going forward:**
- **New icon needs**: add SVG to `registry.ts`, append to `IconName` union, draft via chat-Claude visualize widget for Eric review first; once accepted, append to V3_P2_ICON_REGISTRY_DRAFT.md "Accepted" section + dual-write to registry.ts via OpenCode patch run.
- **Sublease category**: import `<UIcon name="home" />` — NOT `<UIcon name="cat-sublease" />`. No such registry key exists.
- **New button surface**: use `<UButton variant="..." size="..."> 文案 </UButton>`. The `campus` variant is ONLY for the 5 official-affiliated surfaces per `design_system_two_track` memory (Illini badge / CAACI 官方 post header / 校历 entry / verified pickup / scam-official banner). NEVER for prices, regular CTAs, or default buttons.
- **System-notification + CAACI-helper avatars**: use Illini Market brand seal image asset from `Illini Market Design System/assets/logo-candidates/seal-mark.svg` (NOT a registry icon — per Eric round-4 decision).

**Pending P2b (separate OpenCode prompt + PR):**
- 6 surface migration:
  1. `app/src/components/CustomTabBar.vue` — replace 4 CSS-drawn icons (home/plaza/messages/profile) with `<UIcon>`; FAB stays
  2. `app/src/pages/detail/index.vue` — translate-btn, expand-btn, sold/disabled chat-btn, favorite-btn → `<UButton>`
  3. `app/src/pages/chat/index.vue` — send button, emoji-trigger, attach-image-btn → `<UButton>`
  4. `app/src/pages/profile/index.vue` — quick-action 4 grid (currently emoji buttons 🔔 👣 ❤️ 🔍) → `<UIcon>` + `<UButton variant="ghost">` wrapper
  5. `app/src/pages/publish/index.vue` — "发布" CTA, "添加图片", category chips → `<UButton>`
  6. `app/src/pages/index/index.vue` — filter chip rail (currently inline pills) → `<UButton variant="ghost" size="sm">`

**P2b risks (chat-Claude should consider when writing P2b OpenCode prompt):**
- Each migrated .vue has existing logic (touch handlers, animations, scoped styles) that must be preserved
- Lesson from P1 hotfix (`lesson_template_binding_full_block.md`): when patching template bindings, show FULL element block in prompt, not just attribute changes — Eric reads diffs literally
- mp-weixin v-html parity becomes a real concern in P2b — may need conditional rendering or different render path for mp-weixin
- Each surface should be a separate atomic commit so individual migrations can be reverted without affecting others
