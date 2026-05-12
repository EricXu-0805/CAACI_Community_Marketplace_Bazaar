# OpenCode prompt — V3 Phase 2a: UIcon + UButton + Icon Registry + Preview

**Paste this entire document into your OpenCode session as the kickoff message. OpenCode should treat it as the authoritative work order.**

---

## Who you are, what you're doing

You are OpenCode, executing **Phase 2a of the v3 Visual Refresh sprint** for the Illini Market codebase (CAACI Community Marketplace, uni-app + Vue 3 + Supabase + Vercel). This sprint was scoped by chat-Claude in collaboration with Eric.

P2 is split into:
- **P2a (this run)** — infrastructure: 2 new Vue components (`UIcon.vue`, `UButton.vue`), 1 icon registry (`registry.ts`) populated with 52 pre-drawn SVG strings, and 1 standalone preview HTML for Eric to visually verify. No surface migration in this run.
- **P2b (separate run later)** — actual migration of 6 surfaces (CustomTabBar, detail, chat, profile, publish, index) to use UIcon + UButton.

This split is intentional: P2a delivers visual review tooling and component infrastructure that Eric can sign off on before any surface migration happens. The SVG paths have already been chat-Claude reviewed and Eric approved through 10 design rounds — they are **frozen**. Your job is pure engineering: paste them verbatim into `registry.ts`, write the component boilerplate per spec, build the preview HTML, three-green-check the result.

---

## Source-of-truth files to read FIRST (before any edit)

In this order:

1. **`docs/audit/V3_VISUAL_REFRESH_SPEC.md` §P2** — the canonical spec for UIcon API (§2.1), UButton API (§2.3), and component requirements. Read carefully; this prompt elaborates on it, doesn't replace it.
2. **`docs/audit/V3_P2_ICON_REGISTRY_DRAFT.md`** — contains all 52 accepted SVG strings ready to paste, organized by section. The "Accepted icons" section is the source-of-truth for what goes into `registry.ts`. This prompt below ALSO contains all 52 strings inline, so you can work from either source — they are identical.
3. **`app/src/App.vue:972-1146`** — the canonical light token block. UButton.vue's variant styles reference these tokens (`--brand`, `--ink`, `--canvas`, `--shadow-cta`, etc.).
4. **`app/src/App.vue:1137-1146`** — the motion tokens (`--dur-1..5`, `--ease-*`). UButton transitions use these.
5. **`docs/memory/`** (entire dir, but especially):
   - `red_line_zones.md`
   - `pre_push_three_green.md` (modified for v3, see SPEC §CC-3 — mp-weixin can red)
   - `opencode_no_self_decided_history_rewrite.md`
   - `actors_three_role_model.md`
   - `pr_merge_squash_policy.md`
   - `windows_cmd_multiline_commit_gotcha.md`
   - `lesson_template_binding_full_block.md` (v3 P1 hotfix lesson — when patching Vue templates show full element block, not single attribute lines)
   - `lesson_memory_dual_write_must_verify.md`

After reading, audit-confirm:
- Component file paths in this prompt match the actual project structure (`app/src/components/` should exist and contain `CustomTabBar.vue`, `DesktopNav.vue`, `PlazaBannerCarousel.vue`, `ChatEmojiPanel.vue` per memory)
- No existing `UIcon.vue`, `UButton.vue`, or `icons/` directory under `app/src/components/` (this is a clean greenfield add)

If anything has drifted, STOP and surface a discrepancy report — do not start editing.

---

## Branch + workflow

**Branch:** `feat/v3-p2a-icon-components`

Create from `main`. Atomic commits per logical change:
- Commit 1: `feat(components): add icons/registry.ts with 52 inline SVG strings (43 names)`
- Commit 2: `feat(components): add UIcon.vue (consumes registry, supports 4 sizes, 2 weights, currentColor or token color)`
- Commit 3: `feat(components): add UButton.vue (5 variants × 3 sizes × full state spec per SPEC §2.3)`
- Commit 4: `docs(audit): add v3 P2a component preview HTML for visual review`
- Commit 5: `docs(audit): add V3_P2A_OPENCODE_PROMPT.md to docs/audit/` (this prompt file itself, currently untracked)

**Do NOT push.** When the branch is ready and verified, leave it as a local branch with a clean working tree. Eric or his git proxy will push.

**Do NOT touch main.** All work happens on the feature branch.

**Do NOT rewrite history.** Per memory `opencode_no_self_decided_history_rewrite`: no `git reset`, no `git rebase`, no `git commit --amend`, no `git push --force` of any kind. Forward-add only.

---

## Task 1 · Create `app/src/components/icons/registry.ts`

**New file.** Create the directory `app/src/components/icons/` first if needed.

**Content (verbatim — these 52 SVG strings have been Eric-approved through 10 design rounds, do NOT modify any path data):**

```ts
/**
 * Icon registry — inline SVG strings keyed by `{name}-{weight}`.
 *
 * Style guide (per docs/audit/V3_VISUAL_REFRESH_SPEC.md §P2.2):
 * - 24x24 viewBox
 * - Regular: stroke 1.6, fill: none, stroke: currentColor, round linecap/linejoin
 * - Filled: fill: currentColor, no stroke
 * - Visual weight anchored to Lucide regular; redrawn fresh per project style
 *
 * 43 icon names, 52 total SVG variants. Some have regular + filled weight pair
 * (tab bar, content actions). Others stroke-only (utility, categories, etc).
 *
 * Aliases note: the search-page sublease category chip should use
 * `home-regular` (not duplicated into the registry). See SPEC §P2 §2.4.
 *
 * Frozen design (Eric-approved 2026-05-11). Do not edit paths without a fresh
 * design round.
 */

export type IconName =
  | 'home' | 'plaza' | 'messages' | 'profile'
  | 'heart' | 'chat-bubble' | 'bell' | 'tag' | 'lightbulb'
  | 'back' | 'share' | 'image' | 'search' | 'filter' | 'plus' | 'close'
  | 'more-horizontal' | 'more-vertical' | 'chevron-right' | 'chevron-left'
  | 'coffee' | 'graduation'
  | 'history' | 'user-plus' | 'bookmark' | 'layout-grid'
  | 'edit' | 'flag' | 'location-pin' | 'settings' | 'shield' | 'arrow-up' | 'reserved'
  | 'cat-currency' | 'cat-electronics' | 'cat-furniture' | 'cat-clothing' | 'cat-books'
  | 'cat-transport' | 'cat-daily' | 'cat-food' | 'cat-other'
  | 'forward'

export type IconWeight = 'regular' | 'filled'

export const ICONS: Record<string, string> = {
  // Tab bar — 4 names × 2 weights
  'home-regular':     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12 12 4l9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/></svg>`,
  'home-filled':      `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3 2 12.5h2.5V21h6v-6h3v6h6v-8.5H22z"/></svg>`,
  'plaza-regular':    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 10h10"/><path d="M7 14h6"/></svg>`,
  'plaza-filled':     `<svg viewBox="0 0 24 24" fill="currentColor" fill-rule="evenodd"><path d="M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM7 9.7h10v1.6H7zM7 13.7h6v1.6H7z"/></svg>`,
  'messages-regular': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 8.5-8.5 8.5 8.5 0 0 1 8.5 8.5z"/></svg>`,
  'messages-filled':  `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 8.5-8.5 8.5 8.5 0 0 1 8.5 8.5z"/></svg>`,
  'profile-regular':  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a7 7 0 0 1 7-7h2a7 7 0 0 1 7 7v1"/></svg>`,
  'profile-filled':   `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="8" r="4"/><path d="M20 21v-1a7 7 0 0 0-7-7h-2a7 7 0 0 0-7 7v1z"/></svg>`,

  // Content actions — 5 names × 2 weights
  'heart-regular':       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`,
  'heart-filled':        `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z"/></svg>`,
  'chat-bubble-regular': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
  'chat-bubble-filled':  `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
  'bell-regular':        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>`,
  'bell-filled':         `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9z"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/></svg>`,
  'tag-regular':         `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41 13.41 20.6a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><circle cx="7" cy="7" r="1.5"/></svg>`,
  'tag-filled':          `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.59 13.41 13.41 20.6a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82zM7 5.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z"/></svg>`,
  'lightbulb-regular':   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.4.3.6.7.6 1.2v1.1c0 .6.4 1 1 1h4.8c.6 0 1-.4 1-1V16c0-.5.3-.9.6-1.2A7 7 0 0 0 12 2z"/></svg>`,
  'lightbulb-filled':    `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a7 7 0 0 0-4 12.7c.4.3.6.7.6 1.2v1.1c0 .6.4 1 1 1h4.8c.6 0 1-.4 1-1V16c0-.5.3-.9.6-1.2A7 7 0 0 0 12 2z"/><path d="M9 18.5h6v1.5H9zM10 21h4v1h-4z"/></svg>`,

  // Utility — 11 stroke-only
  'back-regular':            `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>`,
  'share-regular':           `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v12"/><path d="m8 8 4-4 4 4"/><path d="M6 11v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-8"/></svg>`,
  'image-regular':           `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/></svg>`,
  'search-regular':          `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>`,
  'filter-regular':          `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M7 12h10"/><path d="M10 18h4"/></svg>`,
  'plus-regular':            `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>`,
  'close-regular':           `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`,
  'more-horizontal-regular': `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>`,
  'more-vertical-regular':   `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>`,
  'chevron-right-regular':   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>`,
  'chevron-left-regular':    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m15 6-6 6 6 6"/></svg>`,

  // Emoji replacements — 2 stroke-only
  'coffee-regular':     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M17 8h1a4 4 0 1 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z"/><path d="M6 2v2"/><path d="M10 2v2"/><path d="M14 2v2"/></svg>`,
  'graduation-regular': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10 12 4 2 10l10 6 10-6z"/><path d="M6 12v5c0 1.5 3 3 6 3s6-1.5 6-3v-5"/></svg>`,

  // Profile quick-actions — 4 stroke-only
  'history-regular':     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></svg>`,
  'user-plus-regular':   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="4"/><path d="M2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 5 2.7"/><path d="M19 13v6"/><path d="M16 16h6"/></svg>`,
  'bookmark-regular':    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`,
  'layout-grid-regular': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>`,

  // Detail/profile chrome — 7 stroke-only
  'edit-regular':         `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/><path d="M15 5l4 4"/></svg>`,
  'flag-regular':         `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21V4h12l-2 4 2 4H4"/></svg>`,
  'location-pin-regular': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-7.5-7-12a7 7 0 0 1 14 0c0 4.5-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/></svg>`,
  'settings-regular':     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6 1.65 1.65 0 0 0 10 3.09V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
  'shield-regular':       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
  'arrow-up-regular':     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>`,
  'reserved-regular':     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3v18l6-4 6 4V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z"/><circle cx="12" cy="8" r="3"/></svg>`,

  // Product categories — 9 stroke-only (sublease aliases to home — NOT a separate registry key)
  'cat-currency-regular':    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h13"/><path d="m13 5 3 3-3 3"/><path d="M21 16H8"/><path d="m11 13-3 3 3 3"/></svg>`,
  'cat-electronics-regular': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M10 6h4"/><path d="M11 19h2"/></svg>`,
  'cat-furniture-regular':   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 14a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3H3z"/><path d="M5 12V8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v4"/><path d="M5 17v2M19 17v2"/></svg>`,
  'cat-clothing-regular':    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m20 8-4-4-4 2-4-2-4 4 3 3v9h10v-9z"/></svg>`,
  'cat-books-regular':       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`,
  'cat-transport-regular':   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/></svg>`,
  'cat-daily-regular':       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h18l-1.5 13H4.5z"/><path d="M8 8V5a4 4 0 0 1 8 0v3"/></svg>`,
  'cat-food-regular':        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 13a9 9 0 0 0 18 0v-1H3z"/><path d="M7 8c0-1 1-2 2-2"/><path d="M11 8c0-1 1-2 2-2"/><path d="M15 8c0-1 1-2 2-2"/></svg>`,
  'cat-other-regular':       `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="6" cy="6" r="1.6"/><circle cx="12" cy="6" r="1.6"/><circle cx="18" cy="6" r="1.6"/><circle cx="6" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18" cy="12" r="1.6"/><circle cx="6" cy="18" r="1.6"/><circle cx="12" cy="18" r="1.6"/><circle cx="18" cy="18" r="1.6"/></svg>`,

  // Plaza interactions — 1 stroke-only
  'forward-regular': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5l6 6-6 6v-4c-4 0-8 1-10 5 0-6 4-9 10-9z"/></svg>`,
}
```

**Verify after writing:**
- File is at `app/src/components/icons/registry.ts`
- Exports `IconName` type union (43 names), `IconWeight` type union ('regular' | 'filled'), and `ICONS` Record
- Object has exactly 52 entries (count via `Object.keys(ICONS).length` if needed)

**Commit:** `feat(components): add icons/registry.ts with 52 inline SVG strings (43 names)`

---

## Task 2 · Create `app/src/components/UIcon.vue`

**New file.** Per SPEC §2.1.

**Full contents:**

```vue
<template>
  <view class="u-icon" :style="iconStyle">
    <view v-if="iconHTML" class="u-icon-svg" v-html="iconHTML"></view>
  </view>
</template>

<script setup lang="ts">
/**
 * UIcon — renders one of the registry icons at a fixed size, optionally
 * tinted to a token color or hex.
 *
 * Usage:
 *   <UIcon name="home" />                        // 24px, regular weight, currentColor
 *   <UIcon name="heart" weight="filled" />       // 24px, filled
 *   <UIcon name="bell" size="lg" color="brand" />  // 32px, tinted to var(--brand)
 *   <UIcon name="search" color="#FF0000" />      // 24px, tinted to hex
 *
 * If `name-weight` not in registry, falls back to `name-regular`. If that's
 * also missing, renders nothing (no error — safe default).
 */
import { computed } from 'vue'
import { ICONS, type IconName, type IconWeight } from './icons/registry'

const props = withDefaults(defineProps<{
  name: IconName | string
  weight?: IconWeight
  size?: 'xs' | 'sm' | 'md' | 'lg'
  color?: string
}>(), {
  weight: 'regular',
  size: 'md',
  color: 'currentColor',
})

const SIZES: Record<string, number> = { xs: 16, sm: 20, md: 24, lg: 32 }

const iconHTML = computed(() => {
  const key = `${props.name}-${props.weight}`
  return ICONS[key] || ICONS[`${props.name}-regular`] || ''
})

const iconStyle = computed(() => ({
  width: `${SIZES[props.size]}px`,
  height: `${SIZES[props.size]}px`,
  color: props.color.startsWith('#') || props.color === 'currentColor'
    ? props.color
    : `var(--${props.color})`,
}))
</script>

<style scoped>
.u-icon {
  display: inline-flex;
  flex-shrink: 0;
  vertical-align: middle;
  line-height: 0;
}
.u-icon-svg {
  width: 100%;
  height: 100%;
  display: block;
}
.u-icon-svg :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
}
</style>
```

**Notes:**
- `name` prop accepts `IconName` union for autocomplete, but also `string` for forward-compat (so unknown names don't fail typecheck).
- `color` resolves three ways: literal `'currentColor'`, hex string (`'#...'`), or token name (`'brand'` → `var(--brand)`).
- `v-html` is the right call here — registry strings are author-controlled SVG, not user-supplied. No XSS risk.
- mp-weixin compat: `v-html` works on H5 only. mp-weixin needs a different rendering path (likely `<rich-text>`). Per SPEC §CC-1, mp-weixin is deferred to v3.5 — DO NOT add mp-specific code to UIcon.

**Commit:** `feat(components): add UIcon.vue (consumes registry, supports 4 sizes, 2 weights)`

---

## Task 3 · Create `app/src/components/UButton.vue`

**New file.** Per SPEC §2.3.

**Full contents:**

```vue
<template>
  <view
    :class="[
      'u-btn',
      `u-btn-${variant}`,
      `u-btn-${size}`,
      {
        'is-disabled': disabled,
        'is-loading': loading,
        'is-block': block,
      }
    ]"
    role="button"
    :aria-disabled="disabled || loading"
    :tabindex="disabled || loading ? -1 : 0"
    @click="onClick"
  >
    <view v-if="loading" class="u-btn-spinner" v-html="spinnerSvg"></view>
    <view v-else class="u-btn-content"><slot></slot></view>
  </view>
</template>

<script setup lang="ts">
/**
 * UButton — primary tap target component for v3.
 *
 * Variants:
 *   primary   — terracotta brand bg, white text — for confirms / 发布 / 立即联系
 *   secondary — ink bg, canvas text — for affirm-but-not-commit (e.g. 询价)
 *   ghost     — transparent bg, ink text, border — for cancel / secondary actions
 *   campus    — UIUC navy bg, white text — ONLY for the 5 official-affiliated surfaces
 *               (Illini badge, CAACI官方 post header, 校历 entry, verified pickup, scam-official)
 *               per docs/memory/design_system_two_track.md
 *   danger    — danger red bg, white text — for delete / unfollow / report
 *
 * Sizes:
 *   sm  — 32px height, padding 16px horizontal, font 13
 *   md  — 44px height, padding 20px horizontal, font 15 (default, hits iOS 44pt target)
 *   lg  — 52px height, padding 24px horizontal, font 16, radius-lg (not pill)
 *
 * States: default → hover (≥768px only) → active (scale 0.97) → disabled → loading
 * Loading replaces slot with an inline spinner; pointer-events: none.
 *
 * Motion: all transitions use prod motion tokens (--dur-1 / --ease-std) per SPEC.
 */
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  variant?: 'primary' | 'secondary' | 'ghost' | 'campus' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
  loading?: boolean
  block?: boolean
}>(), {
  variant: 'primary',
  size: 'md',
  disabled: false,
  loading: false,
  block: false,
})

const emit = defineEmits<{
  (e: 'click', evt: Event): void
}>()

// Inline SVG spinner — currentColor stroke, 14×14, animates via CSS keyframes
const spinnerSvg = computed(() => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-6.4-8.6"/></svg>`)

function onClick(evt: Event) {
  if (props.disabled || props.loading) return
  emit('click', evt)
}
</script>

<style scoped>
/* ===== Base ===== */
.u-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-hei, -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif);
  font-weight: 600;
  letter-spacing: -0.01em;
  cursor: pointer;
  border: 0;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  position: relative;
  transition:
    transform var(--dur-1, 120ms) var(--ease-std, cubic-bezier(0.4, 0, 0.2, 1)),
    background var(--dur-1, 120ms) var(--ease-std, cubic-bezier(0.4, 0, 0.2, 1)),
    box-shadow var(--dur-1, 120ms) var(--ease-std, cubic-bezier(0.4, 0, 0.2, 1)),
    color var(--dur-1, 120ms) var(--ease-std, cubic-bezier(0.4, 0, 0.2, 1)),
    opacity var(--dur-1, 120ms) var(--ease-std, cubic-bezier(0.4, 0, 0.2, 1));
}
.u-btn:focus-visible {
  outline: 2px solid var(--brand);
  outline-offset: 2px;
}

/* ===== Sizes ===== */
.u-btn-sm { height: 32px; min-width: 44px; padding: 0 var(--space-4, 16px); font-size: 13px; border-radius: var(--radius-pill, 999px); }
.u-btn-md { height: 44px; min-width: 44px; padding: 0 var(--space-5, 20px); font-size: 15px; border-radius: var(--radius-pill, 999px); }
.u-btn-lg { height: 52px; min-width: 44px; padding: 0 var(--space-6, 24px); font-size: 16px; border-radius: var(--radius-lg, 18px); }

/* ===== Block (full width) ===== */
.u-btn.is-block { width: 100%; }

/* ===== Variants ===== */
.u-btn-primary {
  background: var(--brand);
  color: #fff;
  box-shadow: var(--shadow-cta);
}
.u-btn-primary:active:not(.is-disabled):not(.is-loading) {
  transform: scale(0.97);
  background: var(--brand-deep);
  box-shadow: var(--shadow-soft);
}

.u-btn-secondary {
  background: var(--ink);
  color: var(--canvas);
  box-shadow: var(--shadow-soft);
}
.u-btn-secondary:active:not(.is-disabled):not(.is-loading) {
  transform: scale(0.97);
  opacity: 0.9;
}

.u-btn-ghost {
  background: transparent;
  color: var(--ink);
  border: 0.5px solid var(--border-strong);
}
.u-btn-ghost:active:not(.is-disabled):not(.is-loading) {
  background: var(--bg-subtle);
}

.u-btn-campus {
  background: var(--campus-blue);
  color: #fff;
  box-shadow: var(--shadow-soft);
}
.u-btn-campus:active:not(.is-disabled):not(.is-loading) {
  transform: scale(0.97);
  background: var(--campus-blue-deep);
}

.u-btn-danger {
  background: var(--danger);
  color: #fff;
  box-shadow: var(--shadow-soft);
}
.u-btn-danger:active:not(.is-disabled):not(.is-loading) {
  transform: scale(0.97);
  opacity: 0.92;
}

/* ===== Disabled ===== */
.u-btn.is-disabled {
  background: var(--ink-faint);
  color: var(--ink-quiet);
  box-shadow: none;
  cursor: not-allowed;
  opacity: 0.55;
  pointer-events: none;
}

/* ===== Loading ===== */
.u-btn.is-loading {
  pointer-events: none;
  cursor: not-allowed;
}
.u-btn-spinner {
  width: 14px;
  height: 14px;
  display: inline-flex;
  animation: u-btn-spin 0.8s linear infinite;
}
.u-btn-spinner :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
}
@keyframes u-btn-spin {
  from { transform: rotate(0); }
  to   { transform: rotate(360deg); }
}

/* ===== Hover (desktop only, ≥768px with hover capability) ===== */
@media (hover: hover) and (min-width: 768px) {
  .u-btn-primary:hover:not(.is-disabled):not(.is-loading) {
    background: var(--brand-deep);
    box-shadow: var(--shadow-pop);
  }
  .u-btn-secondary:hover:not(.is-disabled):not(.is-loading) {
    background: var(--ink-soft);
  }
  .u-btn-ghost:hover:not(.is-disabled):not(.is-loading) {
    background: var(--bg-subtle);
  }
  .u-btn-campus:hover:not(.is-disabled):not(.is-loading) {
    background: var(--campus-blue-deep);
    box-shadow: var(--shadow-pop);
  }
  .u-btn-danger:hover:not(.is-disabled):not(.is-loading) {
    opacity: 0.92;
    box-shadow: var(--shadow-pop);
  }
}
</style>
```

**Notes:**
- The min-width: 44px ensures iOS 44pt tap target even on `size=sm` (sm visual height is 32px but tap target hits 44pt minimum via padding).
- All transitions use existing prod motion tokens — no new tokens added here.
- Focus ring (`:focus-visible`) is keyboard-navigation only, doesn't trigger on mouse click.
- Loading state: spinner replaces slot content; click handler still no-ops via the conditional return.
- Class `is-disabled` is added by Vue's class binding when `disabled` prop true (different from native `disabled` attribute, which `<view>` doesn't have).

**Commit:** `feat(components): add UButton.vue (5 variants × 3 sizes × full state spec)`

---

## Task 4 · Create preview HTML for Eric visual review

**New file:** `docs/v3-p2a-component-preview.html`

**Purpose:** Standalone HTML Eric can open in any browser (file:// works) to visually verify all 43 icons + all UButton variants/sizes/states in both light and dark mode. Self-contained — no external dependencies except Google Fonts CDN for Fraunces (matches prod typography).

**Spec for the file** (write it per these requirements; full draft up to you within these constraints):

1. **Top of file**: `<!DOCTYPE html>` + minimal `<head>` with `<meta charset>`, viewport, title "v3 P2a Component Preview", Google Fonts link for Fraunces + Noto Serif SC + Noto Sans SC (3 families, no Source Serif 4, no JetBrains Mono — match prod).

2. **Embed prod tokens inline** in a `<style>` block — copy the full `:root { }` block from `app/src/App.vue:972-1146` (light tokens). Then copy the `[data-theme="dark"]` block from `:1164-1236`. The preview HTML toggles theme by setting `document.documentElement.dataset.theme = 'dark' | 'light'`.

3. **Theme toggle button** in the top-right corner — a small fixed button labeled "☀ / 🌙" that flips data-theme.

4. **Section: Icons (43 names / 52 SVGs)** — for each icon:
   - Show name as label (mono font, --ink-quiet color)
   - Show icon at md (24px) size
   - If icon has regular + filled, show both side by side
   - Group sections matching the registry doc layout (Tab bar, Content actions, Utility, Emoji replacements, Profile quick-actions, Detail chrome, Categories, Plaza interactions)
   - Icons render via inline `<svg>` directly (copy from registry strings — don't import the .ts file; this is standalone HTML)

5. **Section: UButton variants** — render every combination:
   - 5 variants × 3 sizes × 4 states (default, active-pressed-visual, disabled, loading) = 60 button instances
   - Active state is hard to show statically; simulate by adding a 5th column "active sim" with `transform: scale(0.97)` and the deepened bg color
   - Loading shows the spinning SVG (CSS animation — works in static HTML)
   - Disabled shows the dimmed style

6. **Section: Sizing & color spot-check** — pick 4-5 representative icons (e.g. home, heart, bell, search, plus) and show them at all 4 sizes (xs/sm/md/lg) in 3 colors (currentColor=ink, brand, campus-blue) so Eric can verify color tinting works.

7. **Bottom**: a small note "Generated 2026-05-11. Pre-flight visual review for v3 P2a build. If anything looks wrong, do NOT push the branch — surface to chat-Claude."

**Notes on implementation:**
- Inline all SVG (don't reference external files). The HTML must work standalone.
- Use CSS variables from the embedded prod token block — don't hardcode hex.
- Style discipline: no gradients, no shadows except prod's `--shadow-*` tokens, no decorative effects. Match prod aesthetic.
- File should be ~600-900 lines total. Don't try to be clever — just thorough.

**Commit:** `docs(audit): add v3 P2a component preview HTML for visual review`

---

## Task 5 · Add this prompt file to docs/audit/

This prompt file (`V3_P2A_OPENCODE_PROMPT.md`) currently exists in working tree as untracked (chat-Claude wrote it). Add it to git:

```powershell
git add docs/audit/V3_P2A_OPENCODE_PROMPT.md
git commit -m "docs(audit): add V3 P2a OpenCode prompt"
```

**Commit:** `docs(audit): add V3 P2a OpenCode prompt`

---

## After all 5 tasks: verification

1. **Three-green check (modified for v3 per SPEC §CC-3):**
   - `npm run type-check` (vue-tsc --noEmit) → must be green
   - `npm run build:h5` → must be green
   - `npm run build:mp-weixin` → may red, do not block (per spec §CC-1, mp-weixin compat deferred to v3.5; note in PR description if it reds)

2. **Visual smoke:** open `docs/v3-p2a-component-preview.html` in your browser (file:// works fine). Flip theme toggle. Confirm:
   - All 43 icons render at md size with correct shape
   - Filled variants render where applicable (tab bar, heart, chat-bubble, bell, tag, lightbulb)
   - All 5 button variants render at all 3 sizes
   - Loading spinner animates
   - Disabled state has reduced opacity + neutral bg
   - Dark mode theme toggle flips colors correctly

3. **Diff stat check:** `git diff main..feat/v3-p2a-icon-components --stat` should show:
   - 3 new files in `app/src/components/` (UIcon.vue, UButton.vue, icons/registry.ts)
   - 2 new files in `docs/` (audit prompt + preview HTML)
   - Total ~1000-1500 lines added (most is SVG strings + button CSS variant block, that's expected)

4. **Hand-off:** leave the branch checked out, working tree clean, NO push. Output to chat:
   - Branch name and 5 commit SHAs
   - Files created (paths)
   - Diff line count
   - Type-check / build:h5 status (and mp-weixin status, noting if red is per-spec acceptable)
   - Browser screenshot or note that preview.html visual check passed
   - Any deviations from this prompt (e.g. if you found a path that doesn't compile and had to adjust SVG escape characters in TS template literals — those backslash gotchas happen)

---

## Red lines — DO NOT TOUCH (memory `red_line_zones`)

- ❌ Any file outside the 5 listed above (UIcon.vue, UButton.vue, registry.ts, preview.html, this prompt)
- ❌ Supabase migrations, Auth Dashboard, PKCE, CSP, security headers
- ❌ Any existing .vue file (P2a doesn't migrate surfaces — that's P2b)
- ❌ `app/src/App.vue` (no token changes; you only READ it for reference)
- ❌ `app/src/static/logo.png`
- ❌ Any prod runtime code (composables, utils, pages, existing components)
- ❌ `git push` of any kind — Eric pushes
- ❌ History rewriting — see `opencode_no_self_decided_history_rewrite`

If a task seems to require touching a red-line zone, STOP and surface to Eric via chat.

---

## Failure-mode protocol

**If `vue-tsc` or `build:h5` goes red after a task:**
1. Read the error carefully. TypeScript errors are usually obvious (e.g. type mismatch on icon name union, missing import).
2. If the cause is obvious and minor (typo, missing import, wrong path, SVG escape character issue in template literal), fix it in a new follow-up commit on the same branch.
3. If the cause is unclear or implies the SVG paths themselves have issues (e.g. mismatched quotes inside a template literal), **STOP** — do not attempt deeper fixes or modify SVG path data. Surface the error verbatim + the offending line to Eric/chat-Claude.
4. Do NOT `git reset` to a prior commit. Do NOT amend. Forward-add a fix commit, or stop.

**SVG path data is FROZEN** — Eric approved them through 10 design rounds. If a path doesn't compile in TS template literal (rare — only happens with backtick or `${}` inside a path, which shouldn't be present in our 52 strings), report the offending key and stop. Don't "fix" by tweaking the path.

**If the spec contradicts the codebase reality** (e.g. App.vue line numbers don't match):
1. STOP immediately
2. Do not guess
3. Surface the discrepancy

---

## Memory updates

After P2a build is verified and ready for Eric to push, prepare (but do NOT execute — let chat-Claude do this) a memory entry suggestion for the next chat session:

```markdown
---
name: V3 Phase 2a — Icon + Button infrastructure ready
description: 43 icon names / 52 SVG variants frozen via 10 design rounds; UIcon.vue + UButton.vue + registry.ts + preview HTML on feat/v3-p2a-icon-components branch; P2b surface migration is next phase
type: project
---

V3 visual refresh sprint Phase 2a delivered on `feat/v3-p2a-icon-components`:

**New files:**
- `app/src/components/UIcon.vue` — props: name (43 union), weight (regular/filled), size (xs/sm/md/lg = 16/20/24/32), color (token or hex or currentColor). v-html renders inline SVG from registry. mp-weixin deferred.
- `app/src/components/UButton.vue` — 5 variants (primary/secondary/ghost/campus/danger) × 3 sizes (sm/md/lg = 32/44/52 height) × full state spec (default/hover/active/disabled/loading). Hover only on ≥768px hoverable. Min-width 44px for iOS tap target.
- `app/src/components/icons/registry.ts` — 52 inline SVG strings, frozen design. Sublease category aliases to home-regular at UI layer (no separate key).
- `docs/v3-p2a-component-preview.html` — standalone HTML for visual review with theme toggle.
- `docs/audit/V3_P2A_OPENCODE_PROMPT.md` — this build's OpenCode prompt (in repo for history).

**Build status:** vue-tsc + build:h5 clean. build:mp-weixin status per CC-1 spec.

**Why:** Phase 2 of 4-phase v3 refresh per docs/audit/V3_VISUAL_REFRESH_SPEC.md. Splits into 2a (infrastructure, this) + 2b (surface migration, separate).

**Lock dates:**
- Icon design rounds 1-10: 2026-05-11
- Registry frozen 2026-05-11 (43 names / 52 SVGs)
- P2a build merged: <SHA pending Eric squash>

**How to use going forward:**
- New icon needs: add SVG to `registry.ts`, append to `IconName` union, draft via chat-Claude visualize widget for Eric review first
- Sublease category: import `<UIcon name="home" />` not `<UIcon name="cat-sublease" />` — no such registry key
- New button surface: use `<UButton variant="..." size="..."> 文案 </UButton>`; campus variant ONLY for 5 official-affiliated surfaces per design_system_two_track memory
- System-notification + CAACI-helper avatars: use Illini Market brand seal image asset (NOT a registry icon)

**Pending P2b (separate run):**
- 6 surface migration: CustomTabBar.vue, detail/index.vue, chat/index.vue, profile/index.vue, publish/index.vue, index/index.vue
- Each migrates inline CSS-drawn icons / inline button styling / emoji affordances → UIcon + UButton
```

Output this as a code block in your handoff message so chat-Claude can dual-write it to both Cowork local memory AND repo `docs/memory/` (per `docs_memory_mirror_convention` and the lesson from `lesson_memory_dual_write_must_verify.md` — both MEMORY.md index and entry file in both locations).

---

## Quick-reference: env

- Repo: `C:\Users\kenny\source\repos\CAACI_Community_Marketplace_Bazaar`
- Working dir for builds: `app/`
- Package manager: `npm` (with `--legacy-peer-deps` per project memory)
- Build commands: `npm run type-check`, `npm run build:h5`, `npm run build:mp-weixin`
- Dev (only if you need to visually check beyond preview.html, which Eric can do anyway): `npm run dev:h5`
- Branch: `feat/v3-p2a-icon-components` (new, from main)
- Windows cmd.exe: per memory `windows_cmd_multiline_commit_gotcha`, multi-line `-m` commit messages don't work. Use multiple `-m` flags or `-F filepath` or single-line title.

---

## Final notes

- This is **P2a only**. Do NOT start P2b surface migration (6 .vue files Eric flagged in SPEC §2.4). That's a separate OpenCode prompt.
- Atomic commits per task above. Squash happens at PR merge time by Eric on GitHub, not by you locally.
- Three-green is two-green (vue-tsc + build:h5) for v3 phases; mp-weixin red is acceptable.
- Eric pushes. You stop at "branch ready, working tree clean, preview.html visually verified".
- When in doubt, STOP and surface. SVG paths are frozen — do not "improve" them.

Good luck. Ping back with the handoff summary when done.
