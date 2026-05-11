# V3 Visual Refresh — Audit + Build Spec

**Scope:** 4-phase visual refresh covering dark-mode fixes, v3 icon + button system, sticker set replacing emoji-as-button, and motion-token sweep. Triggered by Eric's 4 painpoints (2026-05-10): emoji-as-button粗糙感, dark mode 配色怪, icon/button 没质感, motion 不够.

**Status:** spec only — NO code changes have been made by this document. Eric reviews → approves phase ordering / scope cuts → individual phase PRs follow per `workflow_audit_first` (audit→spec→build→review→push→verify).

**Sprint form:** audit-only first (cross-platform + new module + animation + view-dependent — all 4 criteria from `sprint_form_audit_only_vs_one_pass` apply).

---

## 0 · Scope & Non-goals

### In scope

| Phase | Deliverable | Risk | Visible win |
|---|---|---|---|
| **P1** | Dark-mode token + component fixes (15 items) | Low | High — unblocks暗色 perceived quality |
| **P2** | v3 icon library (`UIcon.vue`) + button system (`UButton.vue`) + 6 critical surface migration | Medium | High — every screen has consistent visual weight |
| **P3** | Sticker set (12 essential 自绘 + Twemoji fallback) + ChatEmojiPanel rewrite + i18n emoji audit | Medium-High | Medium — fixes the "拿表情包当按键" complaint |
| **P4** | Motion-token sweep (40+ hardcoded transitions) + 8 component micro-interactions | Low-Medium | Medium — overall app rhythm + polish |

### Non-goals (explicitly NOT in this sprint)

- Logo replacement (`assets/logo.png` green U) — pending design lead per memory `design_system_asset_zip.md`
- Light-mode visual rework — current light is canonical 米白书院, no change
- New page-level redesigns — this is a component/system refresh, not surface-level
- Changing prod token philosophy (e.g. switching away from terracotta) — out of scope
- Adding new pages or features — pure visual/interaction refresh
- Skill/MCP server work
- Performance optimization beyond what's incidental to motion changes

### Phase ordering rationale

P1 first — lowest risk, no new abstractions, fixes the most visible暗色 bug Eric called out. Can squash-merge before any other phase.

P2 second — introduces the two foundational components (`UIcon`, `UButton`) that P3 and P4 will both consume. P3's sticker panel uses `UIcon`-style SVG patterns; P4's button micro-interactions need the `UButton` abstraction so we don't update 26 page-level button states one by one.

P3 third — depends on P2's `UIcon` for the SVG-based sticker rendering pattern, and on P1's dark mode fixes so the new sticker grid doesn't immediately feel weird in dark.

P4 last — sweeps remaining hardcoded transitions and adds micro-interactions to the now-stabilized v3 components (P2 + P3). Doing motion before component refresh would mean replacing transitions twice.

**Each phase = one squash-merge PR**, atomic-commits on a feature branch per `pr_merge_squash_policy`.

---

## Phase 1 · Dark Mode Fixes

### 1.1 Token additions / changes (App.vue:1164-1236)

**File:** `app/src/App.vue`
**Block:** `[data-theme="dark"]` selector at line 1164+ (also the `@media (prefers-color-scheme: dark)` mirror at line 1244+ — both blocks must be kept in sync per the existing pattern).

**Add these tokens** (insert into the dark block, group with the matching existing tokens):

```css
/* Surface — widen ΔE so cards lift visibly */
--canvas:    #15130F;  /* was #1C1A17 — page bg deepens 1 step */
--surface-alt: #36322B;  /* was #2E2A23 — chip bg lightens 1 step */
--paper-3:   #423D33;  /* was #332F28 — pressed/inset lightens 1 step */
/* surface (#26231E) and frame (#332F28) stay — they're the middle anchors */

/* Shadow — warm-deep instead of pure black so it's actually visible on warm bg */
--shadow-soft: 0 1px 2px rgba(8,6,4,0.6), 0 4px 12px rgba(8,6,4,0.5);
--shadow-pop:  0 2px 4px rgba(8,6,4,0.7), 0 12px 28px rgba(8,6,4,0.55);
--shadow-float:0 1px 2px rgba(8,6,4,0.7), 0 24px 56px -16px rgba(8,6,4,0.7);

/* Inner top-edge highlight — Apple Big Sur "edge light" trick for暗色 cards */
--shadow-hair: inset 0 0 0 0.5px rgba(240,232,214,0.06);

/* Tab bar reverses depth direction in dark — bar is DEEPER than canvas */
--parchment: #13110D;  /* was #2E2A23 — now darker than canvas */

/* Placeholder text — splits ink-quiet into two roles for AA contrast */
--ink-placeholder: rgba(240,232,214,0.62);

/* Page-title softener — prevents 14:1 over-contrast white on charcoal */
--ink-strong: rgba(240,232,214,0.92);

/* Campus chip surface in dark — keeps navy aesthetic without graying out */
--campus-blue-chip-bg: rgba(19,41,75,0.45);
--campus-blue-chip-border: rgba(106,138,194,0.3);

/* Profile user-card gradient (de-saturated for dark) */
--user-card-grad-dark: linear-gradient(135deg, #1A2540, #2C3E5C);
```

**Mirror to `@media (prefers-color-scheme: dark)`** at line 1244+ — every token added above must also be in the prefers-dark block, exactly the same values, per the existing twin-block pattern. ~25 lines added per block × 2 = 50 lines total in App.vue.

### 1.2 Component fixes — 4 files

**A. `app/src/pages/profile/index.vue:598-627` — user card gradient**

Current:
```scss
.user-card {
  background: linear-gradient(135deg, var(--campus-blue), var(--campus-blue-deep));
}
```

Change:
```scss
.user-card {
  background: linear-gradient(135deg, var(--campus-blue), var(--campus-blue-deep));
}
[data-theme="dark"] .user-card,
@media (prefers-color-scheme: dark) {
  .user-card { background: var(--user-card-grad-dark); }
}
```

(Or use the new `--user-card-grad-dark` token directly if the SCSS scoped style allows — confirm during build.)

> **2026-05-10 build-time correction (P1 OpenCode handoff):** the actual `.user-card` selector uses **solid `var(--campus-blue-surface)`** background, not the `linear-gradient(--campus-blue, --campus-blue-deep)` described above. The in-code comment explains the choice (constant navy intentionally doesn't lift in dark for high contrast on cream). Fix direction unchanged — sibling `[data-theme="dark"] .user-card { background: var(--user-card-grad-dark) }` rule introduces the gradient only in dark, light untouched. Spec text above is left as the original intent for historical reference; code-level reality is the OpenCode commit `974e51c`.

**B. `app/src/pages/detail/index.vue:1168` — sold button shadow + state**

Current `.chat-btn-disabled` likely retains `--shadow-cta` (orange glow) from `.chat-btn` base class (need to read full block during build to confirm).

Change pattern:
```scss
.chat-btn-disabled {
  box-shadow: var(--shadow-soft);  /* override cta glow */
  opacity: 0.55;
  color: var(--ink-soft);
  cursor: not-allowed;
  pointer-events: none;
}
```

Also confirm `.chat-btn-disabled` is the only "已售出" surface — there are 2 occurrences (line 170, 194), both share the class.

**C. `app/src/pages/messages/index.vue` — avatar fallback**

Find the `<image src="default-avatar.svg">` pattern (line TBD during build). The current `default-avatar.svg` is a flat white circle + gray figure → over-bright on dark canvas.

Either:
- (i) Add a `[data-theme="dark"]` SVG override in `static/default-avatar-dark.svg` and switch in template based on theme
- (ii) Use CSS `filter: invert(1) hue-rotate(180deg)` on the avatar in dark mode (simpler, but loses control)
- (iii) Recommend **(i)** — add a paired SVG `default-avatar-dark.svg` with `fill: #36322B` background + `stroke: rgba(240,232,214,0.32)` figure

**D. `app/src/components/PlazaBannerCarousel.vue` — 紫色 promo banner adaptation**

The banner uses `linear-gradient(...)` with hardcoded purple/blue/green pastel colors. In dark mode these saturated pastels clash with the warm-deep canvas. 2 options:

- (i) Add a `[data-theme="dark"]` block that flips each banner's gradient to a dark-equivalent (e.g. purple `#6E5A8E → #FFE0B2` becomes `#2A2238 → #4A3D5C`)
- (ii) Wrap each banner in a `<view class="banner-tint">` and overlay `linear-gradient(rgba(28,26,23,0.35), rgba(28,26,23,0.1))` on dark to mute saturation

**Recommend (ii)** — single CSS rule, no per-banner color logic. ~6 lines.

> **2026-05-10 build-time correction (P1 OpenCode handoff):** PlazaBannerCarousel actually renders **user-uploaded image banners via Supabase**, not "purple/blue/green pastel gradients" as described above. Fix approach (ii) generalizes cleanly — the `::after` overlay mutes image saturation in dark just as it would mute pastel gradient saturation. Implemented as `linear-gradient(rgba(var(--canvas-rgb), 0.35), rgba(var(--canvas-rgb), 0.1))` per slide. Spec text above is left as the original intent; actual implementation is the OpenCode commit `d6e9b67`.

### 1.3 Page-title softening (P2-2)

**Files:** every `.page-header .ph-title` (need to grep — likely 5-10 pages)

Current pattern: `color: var(--ink)` → 14:1 in dark.

Change pattern: `color: var(--ink-strong)` (the new 0.92 alpha token).

Estimate: 1 grep + targeted replace across 5-10 files. Or — add a single `.page-header .ph-title` global rule in App.vue that overrides scoped styles in dark only.

### 1.4 Phase 1 deliverable summary

- **Files touched:** 5–7 (App.vue + profile + detail + messages + PlazaBannerCarousel + maybe 2 more for page-title)
- **New files:** 1 (`static/default-avatar-dark.svg`)
- **New tokens:** 11
- **Token changes:** 4 (canvas / surface-alt / paper-3 / parchment / shadow-* darken)
- **PR scope:** 1 squash, ≤ 150 lines diff
- **Verification:** vue-tsc + build:h5 + build:mp-weixin all green; manual visual on the same 6 dark screenshots Eric provided
- **Estimated build time:** 1 sprint (~2-3 hours)

---

## Phase 2 · v3 Icon Library + Button System

### 2.1 New component: `UIcon.vue`

**File (new):** `app/src/components/UIcon.vue`

**API sketch:**
```vue
<UIcon name="home" weight="regular" size="md" />
<UIcon name="heart" weight="filled" size="lg" color="brand" />
```

**Props:**
- `name: string` — icon identifier (see registry below)
- `weight: 'regular' | 'filled'` — default `'regular'`. Inactive = regular (stroke), active = filled
- `size: 'xs' | 'sm' | 'md' | 'lg'` — 16/20/24/32px (default `md` 24)
- `color: string` — CSS variable name (e.g. 'brand', 'ink', 'ink-quiet') or hex; default `currentColor`

**Implementation pattern:**
```vue
<template>
  <view class="u-icon" :style="iconStyle">
    <text v-if="!iconHTML"></text>  <!-- fallback for missing icon -->
    <view class="u-icon-svg" v-html="iconHTML"></view>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { ICONS } from './icons/registry'  // SVG strings indexed by name+weight

const props = withDefaults(defineProps<{
  name: string
  weight?: 'regular' | 'filled'
  size?: 'xs' | 'sm' | 'md' | 'lg'
  color?: string
}>(), { weight: 'regular', size: 'md', color: 'currentColor' })

const SIZES = { xs: 16, sm: 20, md: 24, lg: 32 }

const iconHTML = computed(() => ICONS[`${props.name}-${props.weight}`] || ICONS[`${props.name}-regular`] || '')
const iconStyle = computed(() => ({
  width: `${SIZES[props.size]}px`,
  height: `${SIZES[props.size]}px`,
  color: props.color.startsWith('#') ? props.color : `var(--${props.color})`
}))
</script>

<style scoped>
.u-icon { display: inline-flex; flex-shrink: 0; }
.u-icon-svg { width: 100%; height: 100%; }
.u-icon-svg :deep(svg) { width: 100%; height: 100%; display: block; }
.u-icon-svg :deep(svg) { fill: currentColor; }
</style>
```

**Registry:** `app/src/components/icons/registry.ts` — exports `ICONS` object, key = `name-weight`, value = inline SVG string with `currentColor` fill/stroke.

### 2.2 Initial icon set — 22 icons (44 SVGs counting weights)

Tab bar (currently CSS-drawn → migrate to UIcon):
- `home` regular/filled
- `plaza` regular/filled
- `messages` regular/filled
- `profile` regular/filled

Detail / chat / publish surfaces:
- `back` regular (no filled)
- `share` regular (no filled)
- `heart` regular/filled
- `chat-bubble` regular/filled
- `image` regular (placeholder for missing photo)
- `search` regular (no filled)
- `filter` regular (no filled)
- `plus` regular (no filled — used in FAB and "add image")
- `close` regular (no filled)
- `more-horizontal` regular
- `more-vertical` regular
- `chevron-right` regular
- `chevron-left` regular (= back arrow)
- `bell` regular/filled (notification)
- `tag` regular/filled (price/category)
- `lightbulb` regular/filled (tip / new)
- `coffee` regular (replaces ☕ emoji in i18n)
- `graduation` regular (replaces 🎓 emoji in i18n)

**SVG style guide:**
- 24×24 viewBox always (sizes are CSS-scaled)
- Stroke 1.6px, no border-radius on stroke endpoints unless intentional
- `fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round` on regular variant
- `fill: currentColor; stroke: none` on filled variant
- Visual weight matches Lucide / Phosphor regular weight (anchor: lucide-react@0.383)
- Reference for shapes: lucide.dev — but **redraw**, don't copy SVG paths (Lucide is ISC-licensed but cleaner to draw fresh)

**SVG examples** (sketched here — final draws during build):
```svg
<!-- home-regular -->
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
  <path d="M3 12 12 3l9 9v9a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1z"/>
</svg>

<!-- home-filled -->
<svg viewBox="0 0 24 24" fill="currentColor">
  <path d="M3.6 11.4 12 3l8.4 8.4V21a1 1 0 0 1-1 1h-5v-7h-4.8v7H4.6a1 1 0 0 1-1-1z"/>
</svg>
```

### 2.3 New component: `UButton.vue`

**File (new):** `app/src/components/UButton.vue`

**API sketch:**
```vue
<UButton variant="primary" size="md" @click="onSubmit">发布</UButton>
<UButton variant="ghost" size="sm" disabled loading>已售出</UButton>
<UButton variant="campus" size="md">查看校历</UButton>
```

**Props:**
- `variant: 'primary' | 'secondary' | 'ghost' | 'campus' | 'danger'` — default `primary`
  - `primary` — `--brand` background, white text — for confirms / 发布 / 立即联系
  - `secondary` — `--ink` background, `--canvas` text — for affirm-but-not-commit (e.g. 询价)
  - `ghost` — transparent background, `--ink` text, `--border` border — for cancel / secondary
  - `campus` — `--campus-blue` bg, white text — only for 5 verified-official surfaces (per `design_system_two_track`)
  - `danger` — `--danger` bg, white text — for destructive (delete / unfollow / report)
- `size: 'sm' | 'md' | 'lg'` — 32 / 44 / 52 px height
- `disabled: boolean`
- `loading: boolean` — shows inline spinner, disables click
- `block: boolean` — full width (default false)
- Slot: button label (text or `<UIcon> + text`)

**State spec (per variant):**
```scss
.u-btn-primary {
  background: var(--brand);
  color: #fff;
  box-shadow: var(--shadow-cta);
  transition: transform var(--dur-1) var(--ease-std),
              background var(--dur-1) var(--ease-std),
              box-shadow var(--dur-1) var(--ease-std);
}
.u-btn-primary:hover {  /* desktop only (≥768px) */
  background: var(--brand-deep);
  box-shadow: var(--shadow-pop);
}
.u-btn-primary:active {
  transform: scale(0.97);
  background: var(--brand-deep);
  box-shadow: var(--shadow-soft);
}
.u-btn-primary:disabled,
.u-btn-primary[disabled] {
  background: var(--ink-faint);
  color: var(--ink-quiet);
  box-shadow: none;
  cursor: not-allowed;
  opacity: 0.55;  /* one consistent disabled treatment */
}
.u-btn-primary[loading] {
  pointer-events: none;
  /* spinner replaces text via slot logic, button stays primary-colored */
}
```

Same pattern for the other 4 variants (different bg/color tokens, same state mechanics).

**Quality details:**
- `border-radius: var(--radius-pill)` for sm/md, `var(--radius-lg)` for lg
- `padding: 0 var(--space-4)` for sm, `0 var(--space-5)` for md, `0 var(--space-6)` for lg
- Min tap target 44×44 even on `size=sm` (use padding to expand hit area without growing visual size)
- Focus ring (keyboard navigation): `outline: 2px solid var(--brand); outline-offset: 2px` on `:focus-visible`
- Inner top-edge highlight in dark mode: `box-shadow: var(--shadow-hair)` overlaid on the variant's primary shadow
- Loading state: inline 14×14 SVG spinner with `currentColor` stroke + `animation: spin 0.8s linear infinite`

### 2.4 Migration plan — 6 critical surfaces in P2

Don't replace all 26 page button usages in P2. Instead, replace the 6 highest-friction surfaces and ship; remaining 20 stay on inline class until P5 (sweep, future):

1. **`CustomTabBar.vue`** — replace 4 CSS-drawn icons with `<UIcon>`, FAB stays for now
2. **`pages/detail/index.vue`** — translate-btn, expand-btn, chat-btn (sold/disabled), favorite-btn → `<UButton variant="primary|ghost">`
3. **`pages/chat/index.vue`** — send button, emoji-trigger, attach-image-btn → `<UButton>`
4. **`pages/profile/index.vue`** — quick-action 4 grid (currently emoji buttons 🔔 👣 ❤️ 🔍) → `<UIcon>` + `<UButton variant="ghost">` wrapper
5. **`pages/publish/index.vue`** — "发布" CTA, "添加图片", category chips → `<UButton>`
6. **`pages/index/index.vue`** — filter chip rail (currently inline pills) → `<UButton variant="ghost" size="sm">`

### 2.5 Phase 2 deliverable summary

- **Files touched:** 6 page/component .vue + new component dir
- **New files:** 3 — `UIcon.vue`, `UButton.vue`, `icons/registry.ts`
- **New SVG icons:** 22 names × ≤2 weights = ~44 inline SVG strings
- **PR scope:** 1 squash, ~600-900 lines diff (most is SVG paths in registry)
- **Verification:** vue-tsc + build:h5 + build:mp-weixin all green; visual smoke test on all 6 migrated surfaces in light + dark
- **Estimated build time:** 2-3 sprints (icon SVG draws are slow; budget half the sprint for SVG quality)

---

## Phase 3 · Sticker Set + Emoji Cleanup

### 3.1 12 essential 自绘 stickers (Hybrid strategy 1c)

Replace the 12 highest-frequency emoji + add 4 Illini Market campus-specific stickers Eric can't get from emoji at all:

**12 high-frequency essentials (replaces top emoji usage):**
1. `smile` (replaces 😊 😀 — most-used reaction)
2. `laugh` (replaces 😂 🤣)
3. `love` (replaces 😍 🥰 ❤️)
4. `thumbs-up` (replaces 👍)
5. `thumbs-down` (replaces 👎)
6. `clap` (replaces 👏)
7. `pray` (replaces 🙏)
8. `cry` (replaces 😭 😢)
9. `surprise` (replaces 😮 😱)
10. `sparkle` (replaces ✨ 🎉)
11. `fire` (replaces 🔥)
12. `question` (replaces ❓)

**4 Illini Market campus-specific (no good emoji exists):**
13. `OBO` — terracotta tag with "OBO" lettering, replaces makeshift emoji+text
14. `verified-pickup` — green checkmark in academic seal, for safe-pickup confirmations
15. `currency-warn` — amber triangle with $ inside, for 换汇 anti-fraud (replaces ⚠️ + text)
16. `study-group` — silhouette of 3 figures around a book, for 拼车/借笔记/约自习

**Drawing style:**
- 32×32 px viewBox
- Solid fill brand colors (terracotta + olive + amber + navy from token palette)
- 2-tone where it adds clarity (e.g. `smile` is a yellow disk + brown facial features)
- Rounded chunky shapes, NOT line-art (different aesthetic from `UIcon` which is stroke-based — stickers should feel "weighty / playful")
- Reference inspiration: Notion's emoji set (chunky, brand-tinted) but redrawn original

### 3.2 Twemoji fallback for the long tail

For everything beyond the 16 essentials (the other ~200 emojis in the current ChatEmojiPanel + any user-typed unicode emoji), self-host **Twemoji v14 SVG set** under `app/src/static/twemoji/`.

**Why Twemoji:**
- ISC-licensed (CC-BY 4.0 for graphics, MIT for code)
- ~3500 SVGs total, ~12 MB unzipped — but we only need to bundle the **~150 we actually use** in the panel
- Looks consistent across all platforms
- Renders fine in mp-weixin (which doesn't honor `<text>` emoji styling)

**Selection process during build:**
- Extract the unique emoji list from `ChatEmojiPanel.vue` GROUPS
- Strip the 12 we replace with 自绘 stickers
- Download the matching ~190 Twemoji SVGs into `static/twemoji/`
- Total payload: ~190 SVGs × ~1KB each = ~190 KB (acceptable for chat-only loading; lazy-load on emoji panel open)

### 3.3 ChatEmojiPanel rewrite

**File:** `app/src/components/ChatEmojiPanel.vue`

**Template change:** replace `<text class="ep-emoji">{{ e }}</text>` with `<UStickerOrEmoji :name="e">` component that:
1. Checks if `e` matches one of the 16 essential names → renders inline self-drawn SVG sticker
2. Otherwise looks up `e` in the Twemoji map → renders `<image src="/static/twemoji/<codepoint>.svg">`
3. Final fallback if neither found → renders the unicode `<text>` (preserves backward compat for any new emoji we haven't bundled)

**Group restructure:**
- New first group: **Essentials** (16 stickers)
- Second group: **Recent**
- Third onwards: existing 6 groups (smileys / feelings / gestures / objects / life / signs) but populated with Twemoji renders

### 3.4 i18n emoji audit + cleanup

**Files:** `app/src/composables/i18n/messages/zh.ts` and `en.ts` (2 files contain emoji per grep)

**Action:** grep all emoji occurrences in i18n strings. For each:
- If the emoji is **decorative-only** (e.g. "🎉 Welcome!") — keep as-is, low priority
- If the emoji is **functional** (e.g. "🏷️ Attach item" — used as button affordance) — replace with `<UIcon name="tag">` in the consuming component, remove from i18n string
- If the emoji is **status semantic** (e.g. "🔥 Hot deal") — replace with `<UIcon name="fire" weight="filled">` inline

Estimate: 14 files have emoji per earlier grep, but only ~3-5 of those uses are "functional" (need replacement). Rest can stay or be addressed in a future sweep.

### 3.5 Phase 3 deliverable summary

- **Files touched:** ChatEmojiPanel.vue + 2 i18n files + 3-5 consuming components for functional emoji replacement
- **New files:** 16 sticker SVGs + ~190 Twemoji SVGs + 1 new wrapper component (`UStickerOrEmoji.vue`)
- **PR scope:** 1 squash, ~400-600 lines code + 200+ files (mostly small SVGs)
- **Verification:** vue-tsc + build:h5 + build:mp-weixin all green; visual smoke test of emoji panel on iOS + Android + Windows browsers + WeChat mini-app preview
- **Estimated build time:** 3-4 sprints (16 sticker draws is the bottleneck; if Eric wants to outsource sticker drawing to an illustrator, that delays this phase but improves output)

### 3.6 Open question for Eric (P3)

**Q3-A:** sticker draws — Eric draw / Claude attempts in SVG / outsource to illustrator / use Notion-style commercial set under license? Default if no answer: Claude attempts SVG draws, Eric reviews, anything not good enough gets shelved for outsourcing later.

---

## Phase 4 · Motion Sweep + Micro-interactions

### 4.1 Sweep — 40+ hardcoded transitions → motion tokens

**Files affected:** 17 files per grep (App.vue + DesktopNav + CustomTabBar + 14 pages).

**Pattern replacements:**
| Hardcoded | Replace with |
|---|---|
| `transition: 0.15s` | `transition: var(--dur-1) var(--ease-std)` |
| `transition: 0.2s ease` | `transition: var(--dur-2) var(--ease-std)` |
| `transition: 0.3s` | `transition: var(--dur-3) var(--ease-std)` |
| `transition: opacity 0.15s` | `transition: opacity var(--dur-1) var(--ease-std)` |
| `transition: all 0.2s` | (avoid `all` — list explicit properties) |

**Mechanical sweep approach:**
- Audit-first: enumerate all 40+ in a side md (`docs/audit/MOTION_SWEEP_INVENTORY.md`), each row = file:line + current value + proposed token
- Eric reviews inventory (anything unusual flagged), then build phase replaces them all in one PR

### 4.2 8 component micro-interactions

**Components to add micro-interaction to:**

1. **Tab bar press** (`CustomTabBar.vue`) — already has `scale(0.94)` + `transition: var(--dur-1)`. Add: stagger fade on label color change with `var(--ease-warm)` 220ms.

2. **Card hover** (`pages/index/index.vue` waterfall items, ≥768px desktop only) — currently just `shadow-pop`. Add: `transform: translateY(-2px)` over `var(--dur-2) var(--ease-warm)`.

3. **Chip toggle** (filter pills, category pills) — currently no animation. Add: 100ms `scale(0.96)` press + 220ms `var(--ease-warm)` color transition on active state change.

4. **Heart-tap bounce** (`ItemCard.vue`, `pages/detail/index.vue`) — currently CSS-drawn or no animation. Add: tap → `scale(1.25)` over 220ms `var(--ease-warm)` → `scale(1.0)` over 360ms `var(--ease-out)` (the celebratory beat the README originally specced).

5. **Sheet slide-in** (filter sheet, comments sheet, scam modal) — currently linear `translate3d`. Replace with `var(--dur-3) var(--ease-warm)` for a soft bounce-in feel.

6. **Toast slide-down** (uni.showToast custom replacement) — uni-app's native toast doesn't honor our motion. Audit whether to ship a custom Toast component (probably yes, separate scope decision).

7. **Page transition** (uni-app pages) — currently system default. Add `transition: opacity var(--dur-2) var(--ease-std)` on `.page` root, fades old/new during navigation. Has implications for performance — needs benchmark.

8. **FAB pulse-on-idle** (`CustomTabBar.vue` FAB) — currently static. Add `@keyframes fab-pulse` with `box-shadow` ring expansion, 2s cycle, only fires when no other tab is active for >5s (idle hint). Optional, can defer.

### 4.3 Phase 4 deliverable summary

- **Files touched:** 17 (sweep) + 5-8 (micro-interactions)
- **New files:** 0 (or 1 if custom Toast component spun out)
- **PR scope:** 2 squashes recommended — (a) mechanical sweep, separate (b) micro-interactions. Each ≤200 lines diff.
- **Verification:** vue-tsc + build:h5 + build:mp-weixin all green; manual interaction testing on each of 8 micro-interaction surfaces
- **Estimated build time:** 1.5 sprints

### 4.4 Open question for Eric (P4)

**Q4-A:** custom Toast component (replacing uni.showToast for consistency with motion system) — spin out as its own mini-spec? Default if no answer: defer to a future polish sprint, ship Phase 4 without custom toast.

**Q4-B:** FAB pulse-on-idle (#8) — ship or defer? Default: defer, optional polish.

---

## Cross-cutting concerns

### CC-1 · mp-weixin compatibility — DEFERRED to v3.5

Per Eric's decision 2026-05-10, mp-weixin compatibility is **explicitly out of scope for v3 phases P1-P4**. New tokens and components only need to work on H5 / Vercel deployment.

Implications:
- Pre-push hook for v3 PRs is **vue-tsc + build:h5 only** — `build:mp-weixin` may red and that is acceptable for v3 phases. Note in PR description: "mp-weixin compat deferred to v3.5".
- New components (`UIcon`, `UButton`, `UStickerOrEmoji`) can use `v-html` for inline SVG without the mp-weixin `<image src="data:..">` workaround.
- Existing App.vue `:root + page` twin block stays as-is for the existing tokens (don't break what works); new tokens added in P1 can go into `:root` only since H5 honors it.
- Component WXSS tag-selector ban is no longer a constraint for new components.

**Future v3.5 sprint** will sweep all v3 components for mp-weixin compatibility before any mp-weixin release. Tracking item should be added to backlog memory after Eric confirms.

### CC-2 · Dark mode parity for new components

Every new component (`UIcon`, `UButton`, `UStickerOrEmoji`) must define dark variants using the existing token system. Don't introduce hardcoded hex in new components.

### CC-3 · Pre-push hook (modified for v3, see CC-1)

Before any v3 phase PR can be pushed:
- `vue-tsc --noEmit` clean (required)
- `pnpm build:h5` clean (required)
- `pnpm build:mp-weixin` — **may red, not blocking for v3** (per CC-1 mp-weixin defer)

This is a temporary deviation from memory `pre_push_three_green`. After v3.5 sweep, the three-green requirement is restored.

If any required check (vue-tsc or build:h5) goes red, STOP and surface to Eric — no self-decided history rewrite per memory `opencode_no_self_decided_history_rewrite`.

### CC-4 · Squash-merge policy (`pr_merge_squash_policy`)

Each phase = 1 PR, atomic commits on feature branch, squash-merged to main with a descriptive title:
- `feat(theme): dark mode P0/P1/P2 fixes (15 items)` — Phase 1
- `feat(components): introduce UIcon + UButton + 6-surface migration` — Phase 2
- `feat(chat): replace emoji with sticker set + Twemoji fallback` — Phase 3
- `chore(motion): sweep 40+ hardcoded transitions to motion tokens` — Phase 4a
- `feat(motion): add 8 component micro-interactions` — Phase 4b

### CC-5 · Memory updates after each phase

After each phase merges, append a project-type memory entry summarizing what changed at the visual-system level (e.g. "v3 introduced UIcon+UButton, 6 critical surfaces migrated, remaining 20 page-level button usages on legacy class for sweep in v3.5").

---

## Decision log — what Eric chose / what's still open

| Decision | Eric's choice (2026-05-10) |
|---|---|
| Sticker strategy | (1c) hybrid 12 自绘 + Twemoji fallback |
| Dark mode method | (2c) screenshot-based针对性微调 |
| Icon + button + 质感 scope | (3a + 3b + 3c) all three combined into v3 component refresh |
| Motion depth | (4a + 4b) sweep + 8 component micro-interactions |
| Sprint pace | mini-audit → BUILD_SPEC → phase-by-phase |
| Phase ordering | P1 dark → P2 components → P3 stickers → P4 motion |

**Eric's additional decisions (2026-05-10 SPEC review):**
- mp-weixin compat → DEFERRED to v3.5 (see CC-1)
- Q3-A → (a) Claude attempts SVG sticker draws first, illustrator outsource later if quality insufficient

**Still open:**
- **Q4-A:** custom Toast component — ship or defer? (Default: defer; can be answered when P4 starts)
- **Q4-B:** FAB pulse-on-idle — ship or defer? (Default: defer; can be answered when P4 starts)

---

## Phase ordering & dependency graph

```
P1 dark mode  ─→  P2 component refresh ─→  P3 sticker set ─→  P4 motion
   (independent)         (depends on dark   (depends on UIcon  (depends on
                          tokens for dark    pattern from P2     P2's UButton
                          variants of new    + dark from P1)     for press
                          components)                            states)
```

Each phase is a **separate PR**. After each merge:
1. `pre-push hook` = three-green
2. Manual verify against the 6 dark screenshots (P1) or the new components (P2/P3/P4)
3. Memory update per CC-5
4. Open next phase branch

---

## Out of scope (for clarity)

- Logo replacement — pending design lead per memory
- Light mode visual rework — current 米白书院 light is canonical
- Page-level redesigns (new layouts, new flows) — refresh is component/system level only
- The remaining 20 page-level button usages — sweep deferred to v3.5
- Dark-mode `.skill` plugin work — separate domain
- `@fontsource-variable` font subset optimization — separate sprint if needed
- Vercel OG image regeneration — pending logo decision

---

## Sprint kick-off checklist

Before starting Phase 1 build:
- [ ] Eric approves this spec (entire document or scope cuts)
- [ ] Eric answers Q3-A (or accepts default)
- [ ] Q4-A and Q4-B can stay open until Phase 4 starts
- [ ] Memory entry added: project-type, summarizing v3 sprint kickoff (after Eric approval)
- [ ] Branch created: `feat/v3-p1-dark-mode-fixes`
- [ ] Open assignment to OpenCode (per actors model — chat-Claude does spec, OpenCode executes build, Eric reviews)

---

*Spec authored by chat-Claude during Cowork session 2026-05-10. Source-of-truth for prod tokens remains `app/src/App.vue:972-1146`. This spec proposes additions/changes only — no code change has been made as of writing.*
