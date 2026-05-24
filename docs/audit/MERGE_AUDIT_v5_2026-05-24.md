# Merge Audit v5 — 2026-05-24

CAACI Marketplace Design System v5 (Hybrid 米白书院 + UIUC accent) vs production codebase.

## 0. Scope & methodology

- **Input:** `$DS_ROOT = /tmp/CAACI_DS_v5_extract` (extracted from `~/Downloads/CAACI Marketplace Design System.zip`, 19.3 MB, mtime 2026-05-24 15:47)
- **Repo HEAD:** `a6dcfc6` on `main` — clean working tree at audit time. PR #23 (Phase 1a location silent-fail) squash-merged earlier today; b7240f9 → a6dcfc6.
- **Files read (kit side):**
  - `SKILL.md` (32 lines) — brand rules, file orientation
  - `colors_and_type.css` (463 lines) — full token enumeration
  - `ui_kits/marketplace/{components.jsx, screens-main.jsx, screens-detail.jsx, screens-onboarding.jsx}` — JSX inventory only, top-level exports
  - `screenshots/{v2,v3,v4,dark,_review}/` — filename listing only
  - `preview/` listing only (24 small spec cards — not deep-read)
- **Files read (repo side):**
  - `app/src/App.vue` lines 987-1296 (the `:root` + `[data-theme="dark"]` blocks)
  - `app/src/uni.scss` (SCSS variables for uni-app framework)
  - `app/src/pages.json` (route source of truth)
  - `app/src/components/*.vue` (6 files, names only)
  - `app/src/composables/i18n/messages/{en,zh}.ts` selectively (cat.* + bilingual pair check)
  - `app/package.json` (webfont deps)
- **NOT read** (per hard scope):
  - `styleguide-standalone.html` (15.3 MB — too large, duplicate of colors_and_type.css per SKILL.md:12)
  - `uploads/IMG_*.PNG` (reference imagery — not needed for the 4 audit dimensions)
  - `ui_kits/marketplace/styles.css` (173 KB compiled output — not source of truth per kit)
  - JSX function bodies (only top-level signatures inventoried)

---

## 1. Token diff (§1 — verifiable claim verification)

**Kit's claim** (colors_and_type.css:4-7):  
> "SOURCE OF TRUTH: app/src/App.vue :root in github.com/EricXu-0805/CAACI_Community_Marketplace_Bazaar @ main. Every hex / shadow / radius / duration below is mirrored verbatim from the production codebase's design-token block."

### Token table (`:root` block only — dark mode block treated separately at end)

| Token | Kit value | Prod value | Status |
|---|---|---|---|
| `--ink` | `#2A2A2E` | `#2A2A2E` | match |
| `--ink-soft` | `#57524B` | `#57524B` | match |
| `--ink-quiet` | `#8B8478` | `#8B8478` | match |
| `--ink-faint` | `#B6AE9F` | `#B6AE9F` | match |
| `--ink-disabled` | `#C0BCB2` | (missing — only `--text-disabled: #C0BCB2`) | **kit-only** name |
| `--ink-inverse` | `#F5F0E6` | `#F5F0E6` | match |
| `--text-primary` | `var(--ink)` | `#2A2A2E` (literal, not aliased) | shape-diff (value equiv) |
| `--text-secondary` | `var(--ink-soft)` | `#57524B` | shape-diff (value equiv) |
| `--text-tertiary` | `#6B6557` | `#6B6557` | match |
| `--text-muted` | `var(--ink-quiet)` | `#8B8478` | shape-diff (value equiv) |
| `--text-faint` | `var(--ink-faint)` | `#B6AE9F` | shape-diff (value equiv) |
| `--text-disabled` | `var(--ink-disabled)` | `#C0BCB2` | shape-diff (value equiv) |
| `--canvas` | `#F5F0E6` | `#F5F0E6` | match |
| `--surface` | `#FBF8F2` | `#FBF8F2` | match |
| `--surface-alt` | `#F0E9DA` | `#F0E9DA` | match |
| `--parchment` | `#F0E9DA` | `#F0E9DA` | match |
| `--frame` | `#E8DFCC` | `#E8DFCC` | match |
| `--bg-page` | `var(--canvas)` | `#F5F0E6` | shape-diff (value equiv) |
| `--bg-elev-1` | `var(--surface)` | `#FBF8F2` | shape-diff (value equiv) |
| `--bg-elev-2` | `var(--surface-alt)` | `#F0E9DA` | shape-diff (value equiv) |
| `--bg-subtle` | `var(--surface-alt)` | `#F0E9DA` | shape-diff (value equiv) |
| `--bg-inset` | `var(--frame)` | `#E8DFCC` | shape-diff (value equiv) |
| `--paper` | `var(--surface)` | `#FBF8F2` | shape-diff (value equiv) |
| `--paper-2` | `var(--surface-alt)` | `#F0E9DA` | shape-diff (value equiv) |
| `--paper-3` | `var(--frame)` | `#E8DFCC` | shape-diff (value equiv) |
| `--surface-rgb` | `251, 248, 242` | `251, 248, 242` | match |
| `--canvas-rgb` | `245, 240, 230` | `245, 240, 230` | match |
| `--line-hair` | `rgba(42, 42, 46, 0.06)` | `rgba(42, 42, 46, 0.06)` | match |
| `--line-soft` | `rgba(42, 42, 46, 0.10)` | `rgba(42, 42, 46, 0.10)` | match |
| `--line-bold` | `rgba(42, 42, 46, 0.16)` | `rgba(42, 42, 46, 0.16)` | match |
| `--border` | `#E8DFCC` | `#E8DFCC` | match |
| `--border-strong` | `#D8CDB3` | `#D8CDB3` | match |
| `--border-hair` | `rgba(42, 42, 46, 0.05)` | `rgba(42, 42, 46, 0.05)` | match |
| `--border-warm` | `#E8DFCC` | `#E8DFCC` | match |
| `--brand` | `#C74A2F` | `#C74A2F` | match |
| `--brand-deep` | `#A03A24` | `#A03A24` | match |
| `--brand-soft` | `#F5D9CE` | `#F5D9CE` | match |
| `--brand-ghost` | `#FBEAE2` | `#FBEAE2` | match |
| `--accent-primary` | `var(--brand)` | `var(--brand)` | match |
| `--accent-primary-soft` | `var(--brand-soft)` | `var(--brand-soft)` | match |
| `--accent-primary-deep` | `var(--brand-deep)` | `var(--brand-deep)` | match |
| `--accent-action` | `var(--brand)` | `var(--brand)` | match |
| `--accent-ink` | `var(--ink)` | `var(--ink)` | match |
| `--accent-green` | (missing) | `#5D7C4A` | **prod-only** |
| `--accent-good` | `#5D7C4A` | `#5D7C4A` | match |
| `--accent-warn` | `#D4923C` | `#D4923C` | match |
| `--accent-danger` | `#B53333` | `#B53333` | match |
| `--campus-blue` | `#13294B` | `#13294B` | match |
| `--campus-blue-soft` | `#E5EAF2` | `#E5EAF2` | match |
| `--campus-blue-deep` | `#0A1A33` | `#0A1A33` | match |
| `--campus-blue-surface` | `#13294B` | `#13294B` | match |
| `--campus-orange` | `#FF5F05` | `#FF5F05` | match |
| `--campus-orange-deep` | `#B33D00` | `#B33D00` | match |
| `--campus-orange-soft` | `#FFF1E6` | `#FFF1E6` | match |
| `--success` | `#5D7C4A` | `#5D7C4A` | match |
| `--success-soft` | `#E4EADA` | `#E4EADA` | match |
| `--warning` | `#D4923C` | `#D4923C` | match |
| `--warning-soft` | `#F5E4CB` | `#F5E4CB` | match |
| `--danger` | `#B53333` | `#B53333` | match |
| `--danger-soft` | `#F0D4D4` | `#F0D4D4` | match |
| `--radius-xs` | `4px` | `4px` | match |
| `--radius-sm` | `8px` | `8px` | match |
| `--radius-md` | `12px` | `12px` | match |
| `--radius-lg` | `18px` | `18px` | match |
| `--radius-xl` | `28px` | `28px` | match |
| `--radius-pill` | `999px` | `999px` | match |
| `--space-1..8` | `4px..48px` (8 tokens) | `4px..48px` | match (all 8) |
| `--font-weight-regular` | `400` | `400` | match |
| `--font-weight-medium` | `500` | `500` | match |
| `--font-weight-semi` | `600` | `600` | match |
| `--font-weight-bold` | `700` | `700` | match |
| `--font-serif` | `'Fraunces', 'Noto Sans SC', -apple-system, …, 'Helvetica Neue', sans-serif` | `'Fraunces', 'Noto Serif SC', 'Songti SC', Georgia, 'Times New Roman', serif` | **value-diff** |
| `--font-hei` | `'Noto Sans SC', -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', 'Helvetica Neue', sans-serif` | (same) | match |
| `--font-mono` | `'JetBrains Mono', 'SF Mono', Menlo, ui-monospace, monospace` | (same) | match |
| `--font-sans` | `var(--font-hei)` (alias) | (missing) | **kit-only** |
| `--shadow-hair` | `0 0 0 1px rgba(42, 42, 46, 0.06)` | (same) | match |
| `--shadow-soft` | `0 1px 2px rgba(42,42,46,0.04), 0 4px 12px rgba(42,42,46,0.06)` | (same) | match |
| `--shadow-pop` | `0 2px 4px rgba(42,42,46,0.05), 0 12px 28px rgba(42,42,46,0.08)` | (same) | match |
| `--shadow-float` | `0 1px 2px rgba(42,42,46,0.06), 0 24px 56px -16px rgba(42,42,46,0.18)` | (same) | match |
| `--shadow-cta` | `0 2px 4px rgba(199,74,47,0.15), 0 12px 28px -8px rgba(199,74,47,0.28)` | (same) | match |
| `--shadow-brand` | `var(--shadow-cta)` | `var(--shadow-cta)` | match |
| `--shadow-fab` | `0 4px 14px rgba(199, 74, 47, 0.30)` | (missing) | **kit-only** |
| `--dur-1..5` | `120ms..900ms` (5 tokens) | `120ms..900ms` | match (all 5) |
| `--ease-std` | `cubic-bezier(0.4, 0, 0.2, 1)` | (same) | match |
| `--ease-in` | `cubic-bezier(0, 0, 0.2, 1)` | (same) | match |
| `--ease-out` | `cubic-bezier(0.4, 0, 1, 1)` | (same) | match |
| `--ease-warm` | `cubic-bezier(0.2, 0.8, 0.2, 1)` | (same) | match |
| `--ease-crisp` | `cubic-bezier(0.7, 0, 0.3, 1)` | (same) | match |
| `--t-display` | `40px` | (missing) | **kit-only** |
| `--lh-display` | `1.08` | (missing) | **kit-only** |
| `--ls-display` | `-0.025em` | (missing) | **kit-only** |
| `--t-h1` | `28px` | (missing) | **kit-only** |
| `--lh-h1` | `1.18` | (missing) | **kit-only** |
| `--ls-h1` | `-0.02em` | (missing) | **kit-only** |
| `--t-h2` | `22px` | (missing) | **kit-only** |
| `--lh-h2` | `1.25` | (missing) | **kit-only** |
| `--ls-h2` | `-0.015em` | (missing) | **kit-only** |
| `--t-h3` | `17px` | (missing) | **kit-only** |
| `--lh-h3` | `1.3` | (missing) | **kit-only** |
| `--ls-h3` | `-0.01em` | (missing) | **kit-only** |
| `--t-body` | `15px` | (missing) | **kit-only** |
| `--lh-body` | `1.6` | (missing) | **kit-only** |
| `--ls-body` | `0.02em` | (missing) | **kit-only** |
| `--t-caption` | `13px` | (missing) | **kit-only** |
| `--lh-caption` | `1.45` | (missing) | **kit-only** |
| `--t-meta` | `12px` | (missing) | **kit-only** |
| `--lh-meta` | `1.4` | (missing) | **kit-only** |
| `--t-micro` | `11px` | (missing) | **kit-only** |
| `--lh-micro` | `1.4` | (missing) | **kit-only** |
| `--t-tag` | `10px` | (missing) | **kit-only** |
| `--lh-tag` | `1` | (missing) | **kit-only** |
| `--t-price-lg/md/sm` | `22px/17px/14px` | (missing) | **kit-only** (3 tokens) |
| `--ls-price` | `-0.02em` | (missing) | **kit-only** |

### Statistics

| Bucket | Count |
|---|---|
| Total tokens enumerated (union of both sources) | **108** |
| Match (verbatim or `var(--alias)` to equivalent value) | **65** |
| Shape-diff but value-equivalent (kit uses `var(--alias)`, prod inlines literal hex) | **11** |
| **kit-only** (in kit, missing from prod `:root`) | **31** |
| **prod-only** (in prod `:root`, missing from kit) | **1** (`--accent-green`) |
| **value-diff** (different hex / different string content beyond aliasing) | **1** (`--font-serif`) |

### Claim verification verdict

**The "verbatim mirrored from app/src/App.vue :root @ main" claim is FALSE in the strict sense, but TRUE in the practical sense.**

- **Strict reading:** 31 tokens (29%) are kit-only — exclusively the SEMANTIC TYPE SCALE tokens (`--t-*`, `--lh-*`, `--ls-*`, lines 206-219 in kit) plus `--ink-disabled`, `--font-sans`, `--shadow-fab`. These tokens **DO NOT EXIST** in `app/src/App.vue:root`. The kit invented them.
- **Practical reading:** Of the 77 shared tokens, 76 match by value (65 verbatim + 11 alias-vs-literal but equivalent). Only **1** has a genuine value diff: `--font-serif` (kit falls through to sans-serif via `Noto Sans SC`, prod stays in serif chain via `Noto Serif SC` → Songti SC → Georgia → Times New Roman).
- **Color / radius / spacing / shadow / motion** = 100% verbatim. The pottery palette, paper stack, type weights, easing curves all match exactly.
- **The kit added a TYPE SCALE that prod doesn't have yet.** This is presented as "mirrored" but is in fact NEW — kit-side type tokens (`--t-display: 40px`, `--lh-body: 1.6`, `--ls-body: 0.02em`, etc.) would need to be ported to prod App.vue if Eric wants the kit to actually function as source-of-truth.

**Bottom line:** The token-VALUES claim holds (95%+ of shared tokens match). The token-NAMES claim does not — kit exposes a richer semantic-type API. Whether this is a feature (the new layer prod should adopt) or a bug (kit drifted from prod) is a product decision, flagged in §6.

### Dark mode block — brief comparison

Both files have a `[data-theme="dark"]` block. Prod App.vue:1179-1281 is **substantially richer** than kit colors_and_type.css:228-287:
- Prod includes P0/P1/P2-tagged refinements (placeholder text contrast, page-title softener, surface ladder ΔE widening, tab bar depth reversal, profile card gradient)
- Kit only carries the canonical 30 dark tokens, no P-tagged extensions
- Prod has `[data-theme="dark"], [data-theme="dark"] page, [data-theme="dark"] .page { ... }` selector triplet (mp-weixin compatibility); kit has only `[data-theme="dark"] { ... }`
- Kit's `@media (prefers-color-scheme: dark)` keys on `:root[data-theme="auto"]`; prod keys on `:root:not([data-theme="light"])` — different fall-through semantics

This is a separate diff (out of scope for the §1 claim) — surfaced for awareness.

---

## 2. Screen coverage matrix (§2)

**Production routes** (from `app/src/pages.json` — 26 paths):

| # | Route | Vue file |
|---|---|---|
| 1 | `pages/index/index` | `app/src/pages/index/index.vue` |
| 2 | `pages/plaza/index` | `app/src/pages/plaza/index.vue` |
| 3 | `pages/post/index` | `app/src/pages/post/index.vue` |
| 4 | `pages/publish/index` | `app/src/pages/publish/index.vue` |
| 5 | `pages/publish/edit` | `app/src/pages/publish/edit.vue` |
| 6 | `pages/messages/index` | `app/src/pages/messages/index.vue` |
| 7 | `pages/profile/index` | `app/src/pages/profile/index.vue` |
| 8 | `pages/detail/index` | `app/src/pages/detail/index.vue` |
| 9 | `pages/chat/index` | `app/src/pages/chat/index.vue` |
| 10 | `pages/history/index` | `app/src/pages/history/index.vue` |
| 11 | `pages/legal/index` | `app/src/pages/legal/index.vue` |
| 12 | `pages/welcome/index` | `app/src/pages/welcome/index.vue` |
| 13 | `pages/settings/index` | `app/src/pages/settings/index.vue` |
| 14 | `pages/seller/index` | `app/src/pages/seller/index.vue` |
| 15 | `pages/profile/edit` | `app/src/pages/profile/edit.vue` |
| 16 | `pages/notifications/index` | `app/src/pages/notifications/index.vue` |
| 17 | `pages/blocked/index` | `app/src/pages/blocked/index.vue` |
| 18 | `pages/reset-password/index` | `app/src/pages/reset-password/index.vue` |
| 19 | `pages/login/index` | `app/src/pages/login/index.vue` |
| 20 | `pages/following/index` | `app/src/pages/following/index.vue` |
| 21 | `pages/saved-searches/index` | `app/src/pages/saved-searches/index.vue` |
| 22 | `pages/search/index` | `app/src/pages/search/index.vue` |
| 23 | `pages/onboarding/index` | `app/src/pages/onboarding/index.vue` |
| 24 | `pages/reconsent/index` | `app/src/pages/reconsent/index.vue` |
| 25 | `pages/suspended/index` | `app/src/pages/suspended/index.vue` |
| 26 | `pages/admin/index` | `app/src/pages/admin/index.vue` |

### Coverage matrix

Aggregated kit coverage (screenshots across v2/v3/v4/dark/_review + JSX functions). Names normalized to the "screen concept" level (e.g. `01-dark-publish.png` → `publish`).

| Screen concept | Prod route exists? | Screenshot in kit? | JSX in kit? | Status |
|---|---|---|---|---|
| home / index | ✅ pages/index | ✅ home-light/dark, home-cur, home.png, 01-light-home | ✅ HomeScreen (screens-main:87) | matched |
| plaza | ✅ pages/plaza | ✅ plaza-light/dark, plaza.png, 01/02-plaza-tabs, plaza-expanded, 01-plaza-scroll | ✅ PlazaScreen (screens-main:382), PlazaHero/PlazaPost | matched |
| post-detail | ✅ pages/post | ⚠️ (no dedicated "post-detail" png — covered indirectly by plaza expanded) | ✅ ComposePostScreen (screens-main:1122) is *compose*, not viewer | partial — viewer no JSX |
| publish (new item) | ✅ pages/publish | ✅ publish-light/dark, 01/02-publish, 01-publish-v2, 02-publish-v2, 03-publish-v2, publish-bottom, publish-scrolled, dark-publish-final/v2/v3 | ✅ PublishScreen (screens-main:450) | matched |
| publish/edit | ✅ pages/publish/edit | ⚠️ (no edit-specific screenshot — uses publish screen visually) | ⚠️ (no JSX — covered by PublishScreen) | partial — visual reuse OK |
| messages | ✅ pages/messages | ✅ messages-light/dark, dark/messages | ✅ MessagesScreen (screens-main:714) | matched |
| profile | ✅ pages/profile | ✅ profile-light/dark, profile.png, 01/02-profile-dark, profile-fix1, light-profile, 01/02-profile-shortcuts, dark/profile, 01-profile-after-reload | ✅ ProfileScreen (screens-main:960), ProfileListings | matched |
| item-detail | ✅ pages/detail | ✅ detail-light/dark, 01/02-dark-detail | ✅ DetailScreen (screens-detail:8) | matched |
| chat | ✅ pages/chat | ✅ chat-light/dark, chat-typing, chat-offer-sheet, chat-scroll, dark-chat | ✅ ChatThreadScreen (screens-detail:277) | matched |
| history | ✅ pages/history | ❌ no screenshot | ❌ no JSX | coded-not-designed |
| legal | ✅ pages/legal | ❌ no screenshot | ❌ no JSX | coded-not-designed |
| welcome | ✅ pages/welcome | ❌ no screenshot | ❌ no JSX | coded-not-designed |
| settings | ✅ pages/settings | ✅ settings-light/dark, dark/settings | ✅ SettingsScreen (screens-detail:652) | matched |
| seller | ✅ pages/seller | ❌ no screenshot | ❌ no JSX | coded-not-designed |
| profile/edit | ✅ pages/profile/edit | ❌ no screenshot | ❌ no JSX | coded-not-designed |
| notifications | ✅ pages/notifications | ❌ no screenshot | ❌ no JSX | coded-not-designed |
| blocked | ✅ pages/blocked | ❌ no screenshot | ❌ no JSX | coded-not-designed |
| reset-password | ✅ pages/reset-password | ❌ no screenshot | ❌ no JSX | coded-not-designed |
| login | ✅ pages/login | ✅ login-light/dark, 01/02/03/04-dark-login | ✅ LoginScreen (screens-detail:619) | matched |
| signup | ❌ (no signup route — login handles both) | ✅ signup-light/dark | ✅ SignupScreen (screens-onboarding:11) | designed-not-coded |
| following | ✅ pages/following | ❌ no screenshot | ❌ no JSX | coded-not-designed |
| saved-searches | ✅ pages/saved-searches | ❌ no screenshot | ❌ no JSX | coded-not-designed |
| search | ✅ pages/search | ✅ search-light/dark, 01/02-search, 01-dark-search, 02-dark-search | ✅ SearchScreen (screens-detail:721) | matched |
| filter (overlay) | ⚠️ (no dedicated route — opened from search/home) | ✅ filter-light/dark, 01/02-filter, filter-open, filter-real, filter-shown | ✅ FilterSheet (components.jsx:337) | matched (as overlay) |
| onboarding | ✅ pages/onboarding (orphan post-O1 per memory line 37) | ✅ onboarding-light/dark, 01/02-onb-step2, onb-step1, onb-step2-real, onb-step3 | ✅ OnboardingFlow (screens-onboarding:152) | matched (but orphan in prod) |
| reconsent | ✅ pages/reconsent | ❌ no screenshot | ❌ no JSX | coded-not-designed |
| suspended | ✅ pages/suspended | ❌ no screenshot | ❌ no JSX | coded-not-designed |
| admin | ✅ pages/admin | ❌ no screenshot | ❌ no JSX | coded-not-designed |
| compose-post (plaza) | ⚠️ (no dedicated route — modal/sheet from plaza) | ⚠️ (no png — implicit in plaza) | ✅ ComposePostScreen (screens-main:1122) | partial |

### Coverage statistics

- **Total prod routes:** 26
- **Matched (both screenshot + JSX in kit):** 10 (home, plaza, publish, messages, profile, detail, chat, settings, login, search) + 1 onboarding (orphan)
- **Partial:** 3 (post viewer, publish/edit, compose-post — kit covers concept but not 1:1)
- **Coded-not-designed (prod has, kit doesn't):** 12 (history, legal, welcome, seller, profile/edit, notifications, blocked, reset-password, following, saved-searches, reconsent, suspended, admin)
- **Designed-not-coded (kit has, prod doesn't):** 1 (signup as separate from login)
- **Filter overlay:** designed as JSX overlay (components.jsx), not a route — match

**Headline:** 38% prod routes have full kit coverage (10/26). The kit covers the "hot path" — Home / Plaza / Publish / Messages / Profile / Detail / Chat / Settings / Login / Search — but **does not cover** 12 secondary routes (history, legal, welcome, profile/edit, notifications, blocked, reset-password, following, saved-searches, reconsent, suspended, admin). Kit README claims "Batch 4" may add some; not verified (README not fully read per scope).

---

## 3. Component inventory (§3)

**Kit JSX exports** (from `ui_kits/marketplace/components.jsx`):

| Kit JSX (file:line) | Closest prod Vue | Status | Notes |
|---|---|---|---|
| `LangProvider` (10) + `useLang` | `composables/useI18n.ts` | exists (different shape) | Vue uses composable, JSX uses React context — same role |
| `ThemeProvider` (23) + `ThemeToggle` (62) | `composables/useTheme.ts` | exists (different shape) | Vue composable + `[data-theme="..."]` on html; JSX state + className |
| `Icon` (168) | `components/UIcon.vue` | exists | both name-based + size prop; UIcon uses `currentColor` SVG registry per memory line 27 |
| `ConditionBadge` (181) | (inline in detail/list pages) | new | not extracted in prod; spec lives in screen-side template |
| `StatusBadge` (186) | (inline) | new | sold/active/etc, inline |
| `PickupBadge` (191) | inline `badge-safe-corner` (pages/index:247, etc.) | exists (different shape) | prod is inline view block, JSX is span — see audit MERGE prior |
| `IlliniBadge` (194) | inline `chip-illini` (auth chip per memory) | exists (different shape) | not a named component |
| `OfficialBadge` (195) | (no exact match found) | new | for plaza official posts |
| `OboTag` (196) | inline in publish/detail | new | shape-changed (text vs view) |
| `ImageCountBadge` (197) | inline `img-count-badge` (pages/index, etc.) | exists (different shape) | inline view |
| `PhotoFrame` (203) | (no match) | new | preview frame for prototyping only? |
| `Chrome` (213) — top bar (search + filter) | inline in index/search headers | exists (different shape) | not extracted — each page has its own header block |
| `CategoryStrip` (252) | inline `category-strip` (pages/index, plaza) | exists (different shape) | currently inline; JSX has it as reusable |
| `TabBar` (292) | `components/CustomTabBar.vue` | exists | both CSS-icon based per memory + R6 below |
| `Toast` (330) | `uni.showToast` (uni-app builtin) | exists (different shape) | prod uses native uni-app API; JSX has custom impl for demo |
| `FilterSheet` (337) | inline in search/index | exists (different shape) | prod has filter overlay logic inline; JSX has reusable sheet |
| `ActionSheet` (465) | `uni.showActionSheet` (uni-app builtin) | exists (different shape) | prod uses native API |
| `EmptyState` (492) | inline empty-state blocks across pages | exists (different shape) | not extracted |
| `LoadingState` (514) | inline `<spinner>` / skeleton blocks | exists (different shape) | partial — banner skeleton was P1 work |
| `ErrorState` (525) | inline error blocks | exists (different shape) | not extracted |
| `SkeletonCard` (543) | `PlazaBannerCarousel.vue` has banner skeleton | exists (different shape) | partial — only one surface |
| `StatusBar` (562) | (none — handled by uni-app safe-area + status-bar-height vars) | new | JSX is preview-frame chrome only |

**Prod Vue components** (`app/src/components/*.vue`, 6 total):

| Vue component (file) | Kit JSX equivalent | Status |
|---|---|---|
| `ChatEmojiPanel.vue` | (none) | prod-only |
| `CustomTabBar.vue` | `TabBar` (components.jsx:292) | exists in both |
| `DesktopNav.vue` | (none — JSX is mobile-frame only) | prod-only |
| `PlazaBannerCarousel.vue` | (none — kit plaza doesn't show banner carousel in components.jsx) | prod-only (banner skeleton was V3.5 work) |
| `UButton.vue` | `.u-btn / .u-btn-primary / .u-btn-brand / .u-btn-ghost / .u-btn-campus` (colors_and_type.css:390-412) | exists (kit as CSS utility classes, prod as Vue component) — shape-changed |
| `UIcon.vue` | `Icon` (components.jsx:168) | exists |

**Inventory summary:**
- **Kit JSX exports**: ~22 top-level (LangProvider, ThemeProvider, ThemeToggle, Icon, 7 badges, PhotoFrame, Chrome, CategoryStrip, TabBar, Toast, FilterSheet, ActionSheet, 4 state components, SkeletonCard, StatusBar)
- **Prod Vue components**: 6 explicitly extracted
- **Match count**: ~6 concepts shared (Icon/UIcon, TabBar/CustomTabBar, ThemeToggle infrastructure, LangProvider/useI18n, button utilities, PickupBadge concept)
- **Kit-only (new component candidates)**: ~14 (ConditionBadge, StatusBadge, OfficialBadge, OboTag, ImageCountBadge, PhotoFrame, Chrome, CategoryStrip, Toast wrapper, FilterSheet wrapper, ActionSheet wrapper, EmptyState, LoadingState, ErrorState, SkeletonCard, StatusBar) — most are extraction candidates from inline prod templates
- **Prod-only**: 3 (ChatEmojiPanel, DesktopNav, PlazaBannerCarousel)
- **Shape-changed**: most "exists" entries — kit is React composable/HOC pattern, prod is uni-app native API or inline view block

---

## 4. Brand rule compliance spot-check (§4)

8 hard rules from `SKILL.md` + the surrounding `colors_and_type.css` comments + README references.

### R1 — Webfont packages present

**✅ Compliant.**

- `app/package.json:56-58`: `@fontsource-variable/fraunces ^5.2.9`, `@fontsource-variable/noto-sans-sc ^5.2.10`, `@fontsource-variable/noto-serif-sc ^5.2.10` — all 3 declared
- `app/src/App.vue:27-29`: all 3 imported (`opsz.css` + `wght.css` + `wght.css`)

### R2 — Serif headlines actually applied

**⚠️ Partial.**

- `grep -rln Fraunces app/src --include=*.vue` → **3 files** use `Fraunces` literal
- `grep -rln "Noto Serif SC" app/src` → **1 file**
- Per kit type system (`colors_and_type.css:336-347`), `.t-display/.t-h1/.t-h2/.t-h3` should all be `font-family: var(--font-serif)` and these classes should be applied across hero/header surfaces. Prod doesn't appear to have the `.t-*` semantic-type-class system installed — neither at the global level (App.vue) nor in individual page files (3-file hit is low).
- **Evidence:** the type-scale tokens (`--t-display`, `--lh-h1`, etc.) ARE in the kit (lines 206-219) and used by `.t-*` classes in kit (lines 336-372) but **DON'T exist in prod App.vue :root** (per §1, 19 kit-only type tokens). Serif application is therefore not enforced via a token system in prod — it's ad-hoc per surface, and apparently only 3 surfaces have applied it directly.

### R3 — Body type metrics (15/1.6 + letter-spacing 0.02em)

**⚠️ Partial.**

- `letter-spacing: 0.02em` → 12 hits across app/src/*.vue
- `line-height: 1.6` → 7 hits
- App.vue `html, body` block (~line 1500+, not visible in scope) presumably sets these globally — but the token system to enforce this consistently (`--ls-body`, `--lh-body`, `--t-body`) is **not in prod** per §1. Spot application via raw values (12 + 7 hits) suggests partial uptake but not the kit's intended "tokens-everywhere" model.

### R4 — Warm-ink shadow (no pure black)

**⚠️ Partial — 31 hits of `rgba(0,0,0,...)` need triage.**

- `rgba(0, 0, 0, …)` → **31 hits** across app/src
- `rgba(42, 42, 46, …)` (warm ink) → **21 hits**
- Sample legitimate uses of `rgba(0,0,0,...)` (image overlays / backdrops, kit-acceptable per SKILL.md rule 5):
  - `PlazaBannerCarousel.vue:144` — linear-gradient overlay on banner image ✅
  - `publish/index.vue:756` — modal/overlay backdrop ✅
- Sample VIOLATIONS (UI chrome, not image):
  - `ChatEmojiPanel.vue:180` — border-bottom `rgba(0,0,0,0.04)` ❌ should be `var(--line-hair)`
  - `pages/post/index.vue:768,773` — border-bottom same ❌
  - `pages/admin/index.vue:684,709` — box-shadow `rgba(0,0,0,0.04)` ❌ should be `var(--shadow-soft)`
- ~5-8 violations confirmed without exhaustive triage of all 31.

### R5 — Dark mode dual-coverage (data-theme + prefers-color-scheme)

**✅ Compliant.**

- `[data-theme="dark"]` selector → **12 occurrences** across app/src
- `prefers-color-scheme` media query → **8 occurrences**
- Both triggers present (App.vue:1179 + App.vue:1289 + per-page overrides)

### R6 — CSS-icon pattern in CustomTabBar

**✅ Compliant.**

- `app/src/components/CustomTabBar.vue:150-191` — confirmed CSS-draw pattern via `::before` + `::after` pseudo-elements with borders/transforms (not SVG, not iconfont):
  - `.ico-home::before` (line 150) + `.ico-home::after` (154)
  - `.ico-plaza::before` (163) + `.ico-plaza::after` (167)
  - `.ico-msg::before` (175)
  - `.ico-me::before` (182) + `.ico-me::after` (186) — circle (head) + arc (body)
- No `<image src="...">` or `<svg>` for tab icons.

### R7 — Page layout max-widths

**✅ Compliant.**

- `max-width: 480px` → **27 hits** across app/src — mobile lock layer
- `max-width: 1120px` → **2 hits** — desktop content shelf (only on index + plaza?)
- `.page-lock` class:
  - Defined in `App.vue:817`
  - Used in `pages/chat/index.vue:2`, `pages/plaza/index.vue:2` (the H5 scroll-lock surfaces)

### R8 — Bilingual pair labels (换汇 · Currency)

**❌ Non-compliant.**

- The kit rule (SKILL.md:24): "Bilingual first — pair Chinese and English: `换汇 · Currency`, `搬家季 · Move-out week`. Never one without the other for category labels, banners, section headers."
- Evidence from i18n keys:
  - `i18n/messages/en.ts:82` — `'cat.currency_exchange': 'Currency'` (EN only)
  - `i18n/messages/zh.ts:82` — `'cat.currency_exchange': '换币'` (ZH only)
  - All 9 category labels (`cat.all/furniture/electronics/clothing/books/housing/vehicles/daily/food`) follow the same single-language pattern in both locale files
- The i18n architecture renders ONE language at a time — switching locale flips EN ↔ ZH, never shows the paired `ZH · EN` form
- Pair separator `·` IS used in some places (e.g. `'home.heroSubtitle': '好物低价 · 只在本校'` — but that's ZH · ZH, not ZH · EN)
- To comply with kit rule, category labels would need either:
  - i18n architecture change (a single key per concept that ALWAYS renders both languages), OR
  - per-surface template change to compose both languages explicitly
- Not a small fix — affects category strips on home/plaza/publish/search/filter/detail (every surface that shows `cat.*`).

### Compliance summary

| Rule | Status |
|---|---|
| R1 Webfonts present | ✅ |
| R2 Serif applied | ⚠️ partial (3 files only — no `.t-*` class system) |
| R3 Body type metrics | ⚠️ partial (12 + 7 hits, but no token enforcement) |
| R4 Warm-ink shadow | ⚠️ partial (~5-8 violations of 31 hits) |
| R5 Dark mode dual coverage | ✅ |
| R6 CSS-icon TabBar | ✅ |
| R7 Page layout | ✅ |
| R8 Bilingual pair labels | ❌ (architectural gap) |

**4 ✅ · 3 ⚠️ · 1 ❌**.

---

## 5. Assumptions made

1. **`pages.json` is the route source of truth** — did not cross-verify against `manifest.json` or page imports. Per memory line 6 (workflow_audit_first.md), this is the standard treat-of-record.
2. **Top-level JSX exports = "screens"** for §2 — counted functions starting with capital letter at column 0. Inner components inside a screen were NOT counted as separate "screens". This may under-count if a JSX file defines multiple equal-rank screens.
3. **`docs/audit/` is the correct landing pad** — verified via `.gitignore` (line 86-87 `!docs/audit/` whitelist). The `MERGE_AUDIT_v5_*.md` filename pattern matches `.gitignore:49 *_AUDIT_*.md` globally but the whitelist makes `docs/audit/` survive (per memory line 32 lesson).
4. **`v3 vs v4 vs v2` screenshot directories** — assumed these are iteration generations (v4 is latest). Did not check screenshot metadata; took filename as authoritative. The `v4/screens/*-light.png` + `*-dark.png` pattern looks like the canonical "final-pass" set.
5. **`_review/` is debug/intermediate** — counted toward kit screenshot coverage but flagged as "debug" implicitly (filenames `01-debug-scroll`, etc.).
6. **`SKILL.md` is the canonical brand rules document** — README.md (263 lines) was NOT fully read per anti-phantom rule; if there are additional brand rules in README, this audit missed them. SKILL.md:7 says "Read the README.md within this skill" — that's a designer instruction, but for THIS audit (verification of stated rules) SKILL.md is sufficient as a rule-source.
7. **`var(--alias)` vs literal hex counted as "shape-diff value-equivalent"** — the 11 such tokens are functionally identical when consumed by CSS but visibly different in source. If Eric considers literal-hex prod as "drifted from canonical aliased form", these 11 become "value-diff" instead of "match" (would push the match rate from 76/77 → 65/77 on shared tokens).
8. **`mobile-first` semantic type bumps** — kit colors_and_type.css:456-462 has a desktop media-query that bumps `--t-display` 40 → 56, `--t-h1` 28 → 38, etc. NOT counted in the §1 :root token table (only base values are). Prod has zero such bumps because no semantic type tokens exist in prod.

---

## 6. Anomalies & open questions

### Q1 — Type scale tokens: kit-only feature or kit drifted from prod?
- 19 semantic type tokens (`--t-*`, `--lh-*`, `--ls-*`) exist in kit and zero in prod App.vue
- Kit claims "verbatim mirrored from prod" but these tokens are NEW
- **Question:** is this (a) the kit's proposed addition that prod should now adopt, or (b) the kit drifted forward and Eric needs the kit to retract them?
- Same question for `--font-sans`, `--ink-disabled`, `--shadow-fab`

### Q2 — `--font-serif` real value-diff
- Kit's `--font-serif` falls through to **Noto Sans SC + sans-serif** (no CJK serif)
- Prod's `--font-serif` correctly uses **Noto Serif SC + Songti SC + Georgia + serif**
- The kit's value would render CN headlines in SANS, not SERIF — directly contradicting SKILL.md rule 3 ("Headlines are serif — Fraunces EN + Noto Serif SC 中文")
- **Verdict:** kit value is wrong; prod is right. Kit needs a fix before being treated as source-of-truth.

### Q3 — `--accent-green` (prod-only)
- App.vue:1076 has `--accent-green: #5D7C4A;` — same value as `--accent-good`
- Kit doesn't have `--accent-green` (only `--accent-good`)
- Looks like a legacy alias from before `--accent-good` was canonical. **Question:** is this still referenced anywhere in prod? Not searched in this audit. If unused, removable. If used, kit should add it back.

### Q4 — Memory line 17 says "do NOT import zip CSS" — does v5 supersede?
- `docs/memory/MEMORY.md:17` (design_system_asset_zip.md): "vision-archive snapshot; prod App.vue:972+ is source-of-truth; do NOT import zip CSS"
- That was for the OLDER zip ("Illini Market Design System"). The v5 zip is "CAACI Marketplace Design System" with EXPLICIT "mirrored from prod" claim.
- **Question:** does the "do NOT import zip CSS" rule still apply to v5, or has the source-of-truth flipped now that kit claims to mirror prod? If kit is meant to be canonical going forward, prod's `:root` becomes the consumer. If prod stays canonical, the type-scale tokens kit added are NOT ready for prod adoption without a separate spec.

### Q5 — Screenshot v3 has `onb-step1/2/3` but onboarding is removed in prod (per memory line 37 O1)
- Kit has 3 onboarding step screenshots + `OnboardingFlow` JSX (screens-onboarding.jsx:152)
- Prod onboarding flow was removed by O1 (memory line 37) — the route `/pages/onboarding/index` exists as orphan but App.vue gate-falls through to reconsent
- **Question:** does the kit reflect Eric's intent to re-introduce onboarding (would resurrect O1 work), or is the onboarding JSX a stale carry-over from the V3 iteration where onboarding still existed?

### Q6 — Memory line 18 "two-track" — is v5 still two-track?
- `design_system_two_track.md`: "ivory_academy primary commerce; marketplace ONLY campus-official"
- Kit v5 is named "CAACI Marketplace Design System" but its content is the 米白书院 ivory direction (per SKILL.md:3 "anchored in the 米白书院 ivory-and-terracotta direction with UIUC Illini Blue & Orange as reserved campus-identity accents")
- **Question:** has the two-track model collapsed into one hybrid? Or does the "marketplace" naming refer specifically to the marketplace surfaces within the hybrid model? Memory entry may need updating.

### Q7 — R8 bilingual-pair architectural gap
- Kit demands `换汇 · Currency` on category labels; prod renders one language at a time
- Implementing this is NOT a token change — it's an i18n architecture change OR a per-surface template change touching 5-8 surfaces
- **Question:** does Eric want to commit to bilingual-pair as a hard rule, or is the kit's rule aspirational? If hard rule, this becomes its own sprint.

### Q8 — `_review/` screenshot dir purpose unclear
- Contains `01-debug-scroll.png`, `01-sticky-fix.png`, `chat-typing.png`, etc. — looks like in-progress debugging captures, not canonical final screens
- **Question:** should `_review/` be considered authoritative coverage or excluded? §2 counted it conservatively (treated `chat-typing/scroll` as supplementary, not separate concepts).

### Q9 — `preview/` directory has 24 small spec cards (registered in Design System tab per SKILL.md:14)
- Files like `colors-brand.html`, `components-buttons.html`, `spacing-shadows.html` — single-concept demonstration cards
- Per scope decision, did NOT deep-read these. They might encode additional rules not covered by SKILL.md.
- **Question:** worth a follow-up scan?

### Q10 — `ui_kits/marketplace/data.js` (16 KB) not surveyed
- Likely contains JSX prop fixtures (sample item lists, sample messages, etc.) for the prototype
- Per scope decision, not surveyed. Not expected to surface brand rules but may surface naming conventions or i18n key fixtures worth aligning with prod.

---

## 7. Top-line recommendation

**Merge work size estimate: MEDIUM** (1-3 days of preparation + spec writing before any code lands).

**Why medium (not small):**

1. **Token names** (§1): 31 kit-only tokens to either adopt-in-prod (medium task — add to App.vue `:root`, audit existing surfaces for consumption opportunities) OR retract-from-kit (small task — strike from colors_and_type.css). The single value-diff (`--font-serif`) is a bug in the kit, fixable in minutes.
2. **R2/R3 type system** (§4): 19 type-scale tokens + `.t-*` semantic class system are kit-only. Adopting in prod is a 3-stage job: (a) add tokens to App.vue, (b) define `.t-display/.t-h1/...` global classes, (c) migrate ~30+ surfaces from inline `font-family: var(--font-serif); font-size: ...` to `class="t-h1"`. Not hard, just touches a lot of files.
3. **R4 rgba(0,0,0)** (§4): ~5-8 confirmed violations of 31 hits. Each is a one-liner swap (`rgba(0,0,0,0.04)` → `var(--line-hair)` or `var(--shadow-soft)`). Hour-scale work but spread across 4-5 files.
4. **R8 bilingual pair** (§4): architectural — either i18n architecture refactor (every `cat.*` becomes one bilingual string) or per-surface template change (every category strip explicitly composes both). Day-scale work + spec discussion.
5. **§2 coded-not-designed** (12 routes): admin, history, legal, welcome, profile/edit, notifications, blocked, reset-password, following, saved-searches, reconsent, suspended — these need design treatment if the kit is meant to be 1:1 coverage. May be acceptable as-is if Eric considers them low-traffic / utility surfaces.
6. **§3 component extraction**: 14 candidate components (ConditionBadge, OboTag, CategoryStrip, EmptyState, etc.) could be extracted from inline templates. Each is small (50-100 LOC); the value is consistency + future P2b work.

**Why not small:**
- More than 5 token additions + the `.t-*` class system installation
- One architectural question (R8) needs spec
- 12 routes without kit coverage need a triage decision

**Why not large:**
- Color/radius/spacing/shadow/motion ALREADY match — the heavy lifting is done
- Dark mode coverage already in place (R5)
- Layout / TabBar / Webfonts already canonical (R1/R6/R7)
- No need to redo the palette or motion system

**Suggested sequencing (Eric / chat-Claude to spec):**
1. Sync §1 kit-only / value-diff tokens — decide adopt vs retract (1-2 hr + spec)
2. Install the `.t-*` semantic type-class system in prod App.vue (2-4 hr + audit)
3. Sweep R4 rgba(0,0,0) violations (1-2 hr)
4. Triage §2 coded-not-designed list — drop / keep / design later (30 min decision)
5. R8 bilingual-pair architectural decision (spec discussion before any code)
6. §3 component extraction — opportunistic, defer to P2b sprint

This audit is read-only. No spec authored. Eric + chat-Claude to drive next steps.
