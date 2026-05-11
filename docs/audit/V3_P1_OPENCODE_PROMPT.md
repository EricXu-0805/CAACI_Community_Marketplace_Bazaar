# OpenCode prompt — V3 Phase 1: Dark Mode Fixes

**Paste this entire document into your OpenCode session as the kickoff message. OpenCode should treat it as the authoritative work order.**

---

## Who you are, what you're doing

You are OpenCode, executing **Phase 1 of the v3 Visual Refresh sprint** for the Illini Market codebase (CAACI Community Marketplace, uni-app + Vue 3 + Supabase + Vercel). This sprint was scoped by chat-Claude in collaboration with Eric (the solo maintainer).

The authoritative spec for the entire v3 sprint lives at:

- **`docs/audit/V3_VISUAL_REFRESH_SPEC.md`** — read this fully before starting. The spec covers 4 phases (P1-P4); **you are only executing P1 in this run**. P2/P3/P4 are out of scope until a separate handoff.

Phase 1 (this run) covers dark-mode fixes: 11 new tokens + 4 token value changes in `app/src/App.vue`, plus component-level fixes in 4-5 .vue files. Total expected diff: ~150 lines.

The dark-mode painpoints come from 6 screenshots Eric provided 2026-05-10, audited by chat-Claude as 15 issues across P0/P1/P2 severity. All 15 items are addressed in spec §P1.

---

## Source-of-truth files to read FIRST (before any edit)

In this order:

1. **`docs/audit/V3_VISUAL_REFRESH_SPEC.md`** — the spec. Especially §0, §P1 (1.1 to 1.4), §CC-1, §CC-3, §CC-4, §Decision log.
2. **`app/src/App.vue:972-1146`** — the canonical light `:root { }` block (don't change).
3. **`app/src/App.vue:1164-1236`** — the dark `[data-theme="dark"]` block (this is where most P1 changes go).
4. **`app/src/App.vue:1244-1294`** — the `@media (prefers-color-scheme: dark)` mirror block (every dark token change must mirror here too).
5. **`docs/memory/`** (entire dir) — the project memory mirror. Quickly scan it. Especially:
   - `red_line_zones.md`
   - `pre_push_three_green.md` (modified for v3, see SPEC §CC-3)
   - `opencode_no_self_decided_history_rewrite.md`
   - `actors_three_role_model.md`
   - `pr_merge_squash_policy.md`
   - `windows_cmd_multiline_commit_gotcha.md` (you're on Windows)

After reading those, audit-confirm: do the file references in spec §P1 still match what's actually in the codebase? If anything has drifted, STOP and surface a discrepancy report — do not start editing.

---

## Branch + workflow

**Branch:** `feat/v3-p1-dark-mode-fixes`

Create from `main`. Make atomic commits per logical change (e.g. one commit for "add 11 dark tokens to App.vue", one for "profile user-card gradient", etc — see §P1 sub-items as natural commit boundaries).

**Do NOT push.** When the branch is ready and verified, leave it as a local branch with a clean working tree. Eric or his git proxy will push.

**Do NOT touch main.** All work happens on the feature branch.

**Do NOT rewrite history.** Per memory `opencode_no_self_decided_history_rewrite`: no `git reset`, no `git rebase`, no `git commit --amend`, no `git push --force` of any kind. Forward-add only. If you commit a mistake, fix it in a new commit on the same branch.

---

## Phase 1 task list (execute in this order)

### Task 1.1 · Add 11 new dark tokens + change 4 existing dark token values

**File:** `app/src/App.vue`

**Block A:** the `[data-theme="dark"]` selector starting at line 1164.

**Block B:** the `@media (prefers-color-scheme: dark)` mirror starting at line 1244.

**Both blocks must be kept in sync.** Every change in Block A must be made identically in Block B. The existing twin-block pattern is intentional (see App.vue line 944+ comment).

**Tokens to ADD** (insert in sensible groupings near the existing related tokens):

```css
/* P0-1: Surface — widen ΔE so cards lift visibly on dark */
--canvas:    #15130F;   /* CHANGED from #1C1A17 */
--surface-alt: #36322B; /* CHANGED from #2E2A23 */
--paper-3:   #423D33;   /* CHANGED from #332F28 */

/* P0-2: Shadow — warm-deep instead of pure black */
--shadow-soft: 0 1px 2px rgba(8,6,4,0.6), 0 4px 12px rgba(8,6,4,0.5);   /* CHANGED */
--shadow-pop:  0 2px 4px rgba(8,6,4,0.7), 0 12px 28px rgba(8,6,4,0.55); /* CHANGED */
--shadow-float:0 1px 2px rgba(8,6,4,0.7), 0 24px 56px -16px rgba(8,6,4,0.7); /* CHANGED */

/* P0-2 NEW: inner top-edge highlight (Apple Big Sur "edge light") */
--shadow-hair: inset 0 0 0 0.5px rgba(240,232,214,0.06);  /* NEW; existing --shadow-hair value differs in light, this overrides for dark */

/* P0-3: tab bar reverses depth direction in dark */
--parchment: #13110D;  /* CHANGED from #2E2A23 — now darker than canvas */

/* P1-1: placeholder text — splits ink-quiet into two roles for AA contrast */
--ink-placeholder: rgba(240,232,214,0.62);  /* NEW */

/* P1-2: campus chip surface for dark */
--campus-blue-chip-bg: rgba(19,41,75,0.45);     /* NEW */
--campus-blue-chip-border: rgba(106,138,194,0.3);  /* NEW */

/* P1-4: Profile user-card gradient (de-saturated for dark) */
--user-card-grad-dark: linear-gradient(135deg, #1A2540, #2C3E5C);  /* NEW */

/* P2-2: page-title softener — prevents 14:1 over-contrast white on charcoal */
--ink-strong: rgba(240,232,214,0.92);  /* NEW */
```

That's 4 CHANGED + 7 NEW = 11 tokens to add/modify per block, × 2 blocks = 22 token-line edits across both blocks.

**Verification after this task:** run `pnpm vue-tsc --noEmit` and `pnpm build:h5`. Both must be green. Visual smoke test not yet possible until component fixes are in.

**Commit:** `feat(theme): add P1 dark-mode tokens (surface ΔE + warm shadow + chip + user-card)`

---

### Task 1.2 · Profile user-card gradient

**File:** `app/src/pages/profile/index.vue`

**Find:** `.user-card` selector (per chat-Claude grep, around line 598; the user-card has a `linear-gradient` using `--campus-blue` + `--campus-blue-deep`).

**Read** the full `.user-card` rule and any related `.user-card-bg` rule (line 627).

**Change:** the dark-mode gradient should use `var(--user-card-grad-dark)` instead of the current `--campus-blue / --campus-blue-deep` mix. The light-mode gradient stays as-is.

Two implementation options — pick the one that least disturbs the surrounding scoped style:

**(A)** Add a sibling rule scoped to dark theme:
```scss
.user-card {
  background: linear-gradient(135deg, var(--campus-blue), var(--campus-blue-deep));
}
[data-theme="dark"] .user-card {
  background: var(--user-card-grad-dark);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .user-card {
    background: var(--user-card-grad-dark);
  }
}
```

**(B)** Use the token at the top level if possible (define `--user-card-grad` in App.vue light mode = the existing campus-blue gradient, dark mode = the new desaturated one). This is cleaner but requires also adding `--user-card-grad` to the light root.

**Pick (A) for P1** — keeps changes scoped, doesn't expand the light token surface area. Option (B) is for a future polish.

**Commit:** `feat(profile): de-saturated user-card gradient for dark mode`

---

### Task 1.3 · Detail page sold-button shadow + state

**File:** `app/src/pages/detail/index.vue`

**Find:** `.chat-btn-disabled` rule (per grep, line 1168). Also confirm two template usages exist at lines 170, 194 (both for `item.status === 'sold'`).

**Read** the full `.chat-btn-disabled` block and the parent `.chat-btn` block to understand cascaded styles.

**Problem:** the disabled state is inheriting `box-shadow: var(--shadow-cta)` (orange glow) from `.chat-btn`, which makes a sold/disabled button look "alive".

**Change:** override on `.chat-btn-disabled`:
```scss
.chat-btn-disabled {
  /* keep existing rules */
  box-shadow: var(--shadow-soft) !important;  /* override cta glow inheritance */
  opacity: 0.55;
  color: var(--ink-soft);
  cursor: not-allowed;
  pointer-events: none;
  background: var(--ink-faint);  /* if currently var(--brand), neutralize it */
}
```

Use `!important` only if cascade order doesn't naturally override; prefer cascade specificity if possible. Read the actual existing rule and choose the simpler approach.

**Commit:** `fix(detail): sold button removes brand glow + adds disabled treatment`

---

### Task 1.4 · Messages page avatar fallback for dark mode

**File:** `app/src/pages/messages/index.vue` (and possibly `app/src/pages/chat/index.vue`)

**Step 1 (asset):** Create a new SVG file at `app/src/static/default-avatar-dark.svg`. Use the existing `app/src/static/default-avatar.svg` as the base — change the background fill from white to `#36322B` (matches `--surface-alt` in dark) and the figure stroke from gray to `rgba(240,232,214,0.32)` (matches `--ink-faint`).

**Step 2 (template):** Find every `<image>` that uses `default-avatar.svg` in messages/index.vue + chat/index.vue. Add a theme-aware src (computed property based on theme):

```vue
<script setup>
import { useTheme } from '@/composables/useTheme'
const { isDark } = useTheme()
const defaultAvatar = computed(() => isDark.value
  ? '/static/default-avatar-dark.svg'
  : '/static/default-avatar.svg')
</script>

<template>
  <image :src="profile.avatar_url || defaultAvatar" ...>
</template>
```

If `useTheme` doesn't expose `isDark`, check the composable signature first — the existing import is `import { useTheme } from "./composables/useTheme"` in App.vue line 7. Read the composable to find the right reactive property.

**Step 3 (any other occurrences):** grep for `default-avatar.svg` across the codebase. If it appears in other pages, repeat the pattern. Don't change pages that don't actually render in dark mode (audit first).

**Commit:** `feat(messages, chat): theme-aware default avatar fallback`

---

### Task 1.5 · Plaza banner carousel dark-mode tint

**File:** `app/src/components/PlazaBannerCarousel.vue`

**Find:** the banner `linear-gradient(...)` declarations (per grep, 2 occurrences in this file).

**Approach:** wrap each banner in a tinted overlay rather than per-banner color logic. Add a `::after` pseudo on `.banner` (or wherever the banner root is) that's transparent in light, semi-opaque dark in dark mode:

```scss
.banner {
  position: relative;
  /* existing background gradient stays */
}
[data-theme="dark"] .banner::after,
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .banner::after {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: linear-gradient(rgba(28,26,23,0.35), rgba(28,26,23,0.1));
    border-radius: inherit;
  }
}
```

If `.banner` already has `::after` for some other purpose, find another wrapper or use `::before`.

**Commit:** `feat(plaza): dark-mode tint overlay on promo banners (de-saturate)`

---

### Task 1.6 · Page-title softening (P2-2)

**Goal:** prevent 14:1 over-contrast on `.ph-title` in dark mode by switching to `var(--ink-strong)` (the new 0.92 alpha token).

**Approach:** rather than touching every page, add a single global override in App.vue inside the dark blocks:

```css
/* In the [data-theme="dark"] block AND the prefers-dark block, add: */
.page-header .ph-title { color: var(--ink-strong); }
```

But: `App.vue`'s root style is `<style lang="scss">` — verify whether scoped styles in pages override this. If yes, the global rule won't take effect and you'll need to grep + targeted replace.

**Step 1:** add the global rule to App.vue dark blocks. Build, dark-mode visual check.

**Step 2:** if title still renders as full white, grep for `.ph-title` + `color:` across pages and add `color: var(--ink-strong)` to each scoped style under `[data-theme="dark"]`.

**Commit:** `style: soften page-title color to ink-strong in dark mode`

---

## After all 6 tasks: verification

1. **Three-green check (modified for v3):**
   - `pnpm vue-tsc --noEmit` → must be green
   - `pnpm build:h5` → must be green
   - `pnpm build:mp-weixin` → may red, do not block (per spec §CC-1, mp-weixin compat deferred to v3.5; note in PR description if it reds)

2. **Visual smoke test:** open the dev H5 build in a browser, switch to dark mode (browser DevTools or system pref), and walk through each of the 6 surfaces from Eric's screenshots:
   - Plaza compose
   - Profile (我的)
   - Home (首页)
   - Messages list (消息)
   - Chat conversation (with Eric)
   - Detail page (xgy / $9178)

   For each, confirm the spec §P1 issue is visibly resolved. If anything still looks off, surface it as a follow-up rather than over-fixing.

3. **Diff check:** `git diff main..feat/v3-p1-dark-mode-fixes --stat` should show ~5-7 files touched, ~150 lines changed. If significantly more, audit what's expanded.

4. **Hand off:** leave the branch checked out, working tree clean, no push. Output to chat:
   - Branch name
   - Files touched (list)
   - Diff line count
   - vue-tsc / build:h5 status
   - Anything you noticed that warrants a follow-up (e.g. "Found a hardcoded hex in pages/foo/index.vue:123 — flagging for v3.5 sweep")
   - Anything the spec said to do that you couldn't do or had to deviate on (with reason)

---

## Red lines — DO NOT TOUCH (memory `red_line_zones`)

- ❌ Supabase migrations (`supabase/migrations/`) — Eric only
- ❌ Supabase Auth Dashboard — Eric only
- ❌ PKCE / OAuth flow code (`app/src/composables/useAuth.ts`) — Eric only
- ❌ CSP / security headers — Eric only
- ❌ `supabase` CLI commands (`db push`, `db pull`) — FORBIDDEN
- ❌ The 6 reserved user accounts in any user-data operation
- ❌ `app/src/static/logo.png` — pending design lead, not your call
- ❌ Light-mode token values — only dark blocks change in P1
- ❌ Any file outside the 5-7 listed in this prompt
- ❌ `git push` of any kind — Eric or his proxy pushes
- ❌ History rewriting — see `opencode_no_self_decided_history_rewrite`

If a task seems to require touching a red-line zone, STOP and surface to Eric via chat.

---

## Failure-mode protocol

**If `vue-tsc` or `build:h5` goes red after a task:**
1. Read the error carefully
2. If the cause is obvious and minor (e.g. typo, missing import, wrong path), fix it in a new follow-up commit on the same branch
3. If the cause is unclear, structural, or implies the spec is wrong, **STOP** — do not attempt deeper fixes. Surface the error verbatim to Eric/chat-Claude with the failing task's task ID.
4. Do NOT `git reset` to a prior commit. Do NOT amend. Forward-add a fix commit, or stop.

**If the spec contradicts the codebase reality** (e.g. a referenced file or line doesn't exist):
1. STOP immediately
2. Do not guess
3. Surface the discrepancy: "spec says X at file:line, but actual is Y" — let Eric/chat-Claude reconcile

**If you find dead code or other tangential cleanup opportunities while working:**
- Note them in your handoff message as "follow-up candidates"
- Do NOT do the cleanup in P1 — P1 scope is dark-mode fixes only

---

## Memory updates

After P1 build is verified and ready for Eric to push, prepare (but do NOT execute — let chat-Claude do this) a memory entry suggestion for the next chat session:

```markdown
---
name: V3 Phase 1 — Dark mode fixes shipped <date>
description: 11 new dark tokens + 4 changed values in App.vue; 5-7 component-level fixes; mp-weixin compat deferred to v3.5
type: project
---

V3 visual refresh sprint Phase 1 merged: dark-mode token surface widened
(canvas/surface-alt/paper-3 ΔE up), warm-deep shadows replace pure black
alpha, parchment depth flipped (tab bar darker than canvas), 4 new
component-state tokens (placeholder/strong-ink/campus-chip/user-card-grad).
Component fixes in profile (user-card gradient), detail (sold button),
messages+chat (avatar fallback), PlazaBannerCarousel (dark tint), and
global page-title softening. mp-weixin compat NOT addressed — deferred to
v3.5. PR <#xx> squash-merged to main.

**Why:** Eric called out 15 dark-mode issues across 6 prod screenshots
2026-05-10. Phase 1 of 4-phase v3 refresh per
docs/audit/V3_VISUAL_REFRESH_SPEC.md.

**How to apply:** when working on dark mode going forward, prefer the new
tokens (--ink-placeholder, --ink-strong, --campus-blue-chip-bg,
--user-card-grad-dark) over inline alpha or hardcoded hex. The legacy
--ink-quiet stays for non-text UI scaffolding.
```

Output this as a code block in your handoff so chat-Claude can dual-write it to memory in the next session.

---

## Quick-reference: env

- Repo: `C:\Users\kenny\source\repos\CAACI_Community_Marketplace_Bazaar`
- Working dir: `app/`
- Package manager: `pnpm`
- Build commands: `pnpm vue-tsc --noEmit`, `pnpm build:h5`, `pnpm build:mp-weixin`
- Dev: `pnpm dev:h5`
- Windows cmd.exe: per memory `windows_cmd_multiline_commit_gotcha`, multi-line `-m` commit messages don't work. Use multiple `-m` flags or `-F filepath` for body. Single-line title is safest.

---

## Final notes

- This is **P1 only**. Do NOT start P2 (icon library), P3 (sticker set), or P4 (motion sweep). Each phase gets its own OpenCode prompt.
- Atomic commits. Squash happens at PR merge time, not by you.
- Three-green is now two-green (vue-tsc + build:h5) for v3.
- Eric does the push. You stop at "branch ready, verified, working tree clean".
- When in doubt, STOP and surface. Do not guess.

Good luck. Ping back with the handoff summary when done.
