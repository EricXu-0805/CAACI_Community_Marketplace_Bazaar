---
name: V3 Phase 1 — Dark mode fixes ready 2026-05-10 (branch ready, awaiting Eric merge)
description: 7 new dark tokens + 9 changed values in App.vue both [data-theme] AND @media prefers-dark blocks; 6 atomic commits on feat/v3-p1-dark-mode-fixes; 5 component-level surfaces fixed; legacy --bg-* aliases extended for visible effect; mp-weixin survived (no longer needs deferral for P1 only); avatar sweep on 12 other surfaces deferred to v3.5
type: project
---

V3 visual refresh sprint Phase 1 implemented on `feat/v3-p1-dark-mode-fixes` (6 atomic commits cca517d→94dbf31, base 18443a0). +284/-34 lines across 10 files.

**What changed (token surface):**
- Dark canvas deepened `#1C1A17 → #15130F`, surface-alt and paper-3 lightened (`#2E2A23 → #36322B`, `#332F28 → #423D33`) — widens the surface ΔE so cards lift visibly
- Warm-deep shadows replace pure-black alpha: `rgba(8,6,4,0.6)` etc instead of `rgba(0,0,0,0.3)`
- Parchment depth flipped — tab bar now sits BELOW canvas at `#13110D`
- 5 new component-state tokens: `--ink-placeholder` (.62α), `--ink-strong` (.92α), `--campus-blue-chip-bg`, `--campus-blue-chip-border`, `--user-card-grad-dark`
- `--canvas-rgb` updated to match new `--canvas` (frosted-glass headers depend on it)
- Legacy `--bg-*` aliases (`--bg-page` `--bg-elev-2` `--bg-subtle` `--bg-inset` `--paper-2`) extended to mirror the new values — required because components heavily use legacy names (`--bg-subtle: 112 uses`, `--bg-inset: 41 uses`, `--surface-alt: 0 uses`)

**Component fixes (5 surfaces):**
- `pages/profile/index.vue` — user-card desaturated gradient in dark (`var(--user-card-grad-dark)`); light untouched
- `pages/detail/index.vue` — sold-button drops `--shadow-cta` glow + canonical disabled state (opacity .55 + cursor not-allowed + ink-soft text + ink-faint bg)
- `pages/messages/index.vue` + `pages/chat/index.vue` — theme-aware default-avatar fallback via `useTheme().isDark` computed + paired `default-avatar-dark.svg` asset (`#36322B` bg + `rgba(240,232,214,0.32)` figure stroke)
- `components/PlazaBannerCarousel.vue` — per-slide `::after` canvas-tinted gradient mutes user-uploaded image saturation in dark
- `pages/profile + publish + plaza` — ph-title softener to `--ink-strong` (per-page, not global — global override would be dead code per scope specificity)

**Composable change:**
- `composables/useTheme.ts` extended to export `isDark` computed (combines manual pref + system `matchMedia('(prefers-color-scheme: dark)')`). H5-only via `#ifdef`. mp-weixin lacks matchMedia → `isDark = false` always there.

**Build status:**
- ✅ `npm run type-check` (vue-tsc --noEmit) clean
- ✅ `npm run build:h5` clean
- ✅ `npm run build:mp-weixin` clean (was allowed to red per spec §CC-1; turned out P1 changes are mp-compatible — deferral remains documented for P2+ component work)

**Why:** Eric called out 15 dark-mode painpoints across 6 prod screenshots on 2026-05-10. Phase 1 of the 4-phase v3 refresh per `docs/audit/V3_VISUAL_REFRESH_SPEC.md`.

**OpenCode-surfaced deviations from spec** (all reasonable, all documented in handoff):
1. **Legacy alias extension** — strict spec only changed semantic tokens (`--canvas`, `--surface-alt`, `--paper-3`, `--parchment`); OpenCode also updated legacy aliases (`--bg-page`, `--bg-elev-2`, `--bg-subtle`, `--bg-inset`, `--paper-2`) because the codebase uses legacy names ~10× more. Without this, the spec's "widen ΔE" intent would have produced zero visible effect.
2. **`--canvas-rgb` updated** — frosted-glass headers do `rgba(var(--canvas-rgb), …)` and would have shown a color edge mismatch.
3. **`@media prefers-dark` block expanded to mirror shadow tokens** — closes a pre-existing latent bug where OS-dark users (no manual data-theme) inherited LIGHT shadow alphas on dark canvas.
4. **`useTheme().isDark` added** — the spec's Task 1.4 sample assumed it existed; OpenCode added with matchMedia listener.
5. **SPEC text was wrong about two surfaces** (now patched with build-time corrections in `V3_VISUAL_REFRESH_SPEC.md` §1.2 §1.5):
   - `profile .user-card` is solid `var(--campus-blue-surface)`, not a `linear-gradient(--campus-blue, --campus-blue-deep)`
   - `PlazaBannerCarousel` renders user-uploaded Supabase images, not pastel gradient banners
   - Fix direction in both cases still mapped cleanly to actual code
6. **npm not pnpm** — project uses `npm --legacy-peer-deps`
7. **Task 1.6 went straight to per-page edit, skipped global** — global rule would be dead code per scope specificity (page-level scoped styles all explicitly set color)
8. **Task 1.4 capped at messages + chat** — spec said "if other pages, repeat the pattern"; OpenCode held to diff budget. 12 other surfaces flagged for v3.5 sweep.

**Visual smoke test NOT executed by OpenCode** (honestly flagged):
- Required Eric's local `.env` (Supabase creds); OpenCode declined to inject
- 5 of 6 target surfaces need authenticated user + real DB rows to render meaningfully
- Eric runs `dev:h5` with real env as part of pre-push routine — far higher signal
- `dev:h5` is long-running, doesn't fit OpenCode background-task pattern

**Follow-ups for v3.5 / later phases:**
- Avatar dark-fallback sweep to 12 remaining surfaces (`index/index.vue:261`, `plaza/index.vue:96+210+242`, `post/index.vue:21+101+133`, `detail/index.vue:97`, `profile/index.vue:38`, `profile/edit.vue:15`, `seller/index.vue:15`, `history/index.vue:48`, `following/index.vue:38`, `admin/index.vue:101+129+149`, `blocked/index.vue:16`, `onboarding/index.vue:48`)
- `.banner-skeleton` in `PlazaBannerCarousel.vue:122` uses hardcoded light hex — bright stripes on dark
- `--frame` semantic divergence from `--bg-inset`/`--paper-3` (was alias, now diverges per spec's "middle anchor"); may want naming clarification
- Sass `legacy-js-api` deprecation warnings (pre-existing, ~10× per build)

**How to apply going forward:**
- Prefer the new tokens for dark-mode work: `--ink-placeholder` for input placeholder, `--ink-strong` for hero titles, `--campus-blue-chip-*` for campus chips, `--user-card-grad-dark` for the profile passport panel
- Bind theme-aware assets to `useTheme().isDark` (computed), not `pref` directly — `pref === 'auto'` is the default for new users
- Per-page `[data-theme="dark"] .selector` + `@media prefers-dark` override pattern is the established way to scope dark-only CSS (introduced in P1; previously only App.vue used it)

**Status:** branch ready, working tree clean, NOT pushed (per actors model — Eric pushes). 5 untracked items pre-existed and were intentionally not bundled (zip + screenshots + this file's source SPEC + OpenCode prompt + this memory mirror should land in a separate docs commit on the same branch).

PR title (recommended): `feat(theme): v3 P1 dark-mode fixes — tokens + 5 component surfaces`

Update this memory after PR squash-merges to main with the merge SHA.
