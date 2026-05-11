---
name: V3 Phase 1 — Dark mode fixes shipped 2026-05-10 (merged via 2 squash PRs)
description: P1 main squash 162b1a9 + hotfix squash e8becd7 (#9). 7 new dark tokens + 9 changed values; warm-deep shadows; legacy --bg-* aliases extended; 5 component surfaces fixed; 6 missing i18n keys; messages swipe-actions visibility-toggle. mp-weixin compat actually survived (deferral now P2+ only). Hotfix needed because main squash dropped 2 messages template fixes (conv-row class + :class binding colon)
type: project
---

V3 visual refresh sprint Phase 1 merged via two squash PRs:

- **Main PR squash:** `162b1a9` — `feat(theme): v3 P1 dark-mode — tokens + 5 surfaces + i18n + messages swipe fix`
- **Hotfix PR squash:** `e8becd7` (#9) — `fix(messages): restore conv-row class lost in v3 P1 (hotfix)`

Both deployed to Vercel prod after merge.

---

## What shipped (token surface)

- Dark canvas deepened `#1C1A17 → #15130F`, surface-alt and paper-3 lightened (`#2E2A23 → #36322B`, `#332F28 → #423D33`) — widens the surface ΔE so cards lift visibly
- Warm-deep shadows replace pure-black alpha: `rgba(8,6,4,0.6)` etc instead of `rgba(0,0,0,0.3)`
- Parchment depth flipped — tab bar now sits BELOW canvas at `#13110D`
- 5 new component-state tokens: `--ink-placeholder` (.62α), `--ink-strong` (.92α), `--campus-blue-chip-bg`, `--campus-blue-chip-border`, `--user-card-grad-dark`
- `--canvas-rgb` updated to match new `--canvas` (frosted-glass headers depend on it)
- Legacy `--bg-*` aliases (`--bg-page` `--bg-elev-2` `--bg-subtle` `--bg-inset` `--paper-2`) extended to mirror the new values — required because components heavily use legacy names (`--bg-subtle: 112 uses`, `--bg-inset: 41 uses`)
- 6 missing i18n keys added in zh.ts + en.ts (`plaza.tapToExpand` / `plaza.collapse` / `plaza.uploadFailed` / `login.resetFailTitle` / `resetPw.notRecovery` / `chat.imageUploadFailed`); 7 dead `|| 'fallback'` patterns removed

## Component fixes (5 surfaces)

- `pages/profile/index.vue` — user-card desaturated gradient in dark; light untouched
- `pages/detail/index.vue` — sold-button drops `--shadow-cta` glow + canonical disabled state
- `pages/messages/index.vue` + `pages/chat/index.vue` — theme-aware default-avatar fallback via `useTheme().isDark` computed + paired `default-avatar-dark.svg` asset
- `components/PlazaBannerCarousel.vue` — per-slide `::after` canvas-tinted gradient mutes user-uploaded image saturation in dark
- `pages/profile + publish + plaza` — ph-title softener to `--ink-strong`

## Composable change

`composables/useTheme.ts` extended to export `isDark` computed (combines manual pref + system `matchMedia('(prefers-color-scheme: dark)')`). H5-only via `#ifdef`.

## Build status (both PRs)

✅ vue-tsc + build:h5 + build:mp-weixin all clean. mp-weixin survived despite spec §CC-1 allowing red — turned out P1 changes are mp-compatible. Deferral remains documented for P2+ where new components / SVG inline patterns will need explicit mp work.

## Hotfix story (lesson learned)

The main P1 squash (`162b1a9`) accidentally shipped a broken `pages/messages/index.vue` template:
- Line 29 was `class="{ 'is-swiped': ... }"` — static class attribute treating the whole expression as a literal class name (no Vue binding)
- AND the original `class="conv-row"` was dropped during the `:class` refactor

Result: on main between merge and hotfix, `.conv-row` element rendered with no `conv-row` class, no `is-swiped` reactivity, and conv-item swipe shifted visibly without revealing actions (visibility-toggle CSS rule `.conv-row.is-swiped .swipe-actions` never matched).

Hotfix PR `e8becd7` restored both:
```vue
class="conv-row"
:class="{ 'is-swiped': (swipeOffsets[conv.id] || 0) < -5 }"
```

Vue's class merging combines static + binding correctly when both are present.

**Root cause of the chat-Claude side:** when guiding Eric to add a Vue binding, chat-Claude showed only the new `:class=` line as a diff, didn't make explicit that the existing `class="conv-row"` must be preserved. Eric (correctly per the diff shown) replaced the existing class line with the new `:class` binding. **Lesson:** when showing template binding changes, show the FULL element block as the patch target, not a single attribute line. Saved as feedback memory `lesson_template_binding_full_block.md`.

## Deviations from spec (from OpenCode handoff, all reasonable)

1. **Legacy alias extension** — strict spec only changed semantic tokens; OpenCode also updated legacy aliases (`--bg-page`, `--bg-elev-2`, `--bg-subtle`, `--bg-inset`, `--paper-2`) because the codebase uses legacy names ~10× more
2. **`--canvas-rgb` updated** — frosted-glass headers depend on it
3. **`@media prefers-dark` block expanded to mirror shadow tokens** — closes a pre-existing latent bug where OS-dark users inherited LIGHT shadow alphas
4. **`useTheme().isDark` added** — the spec's Task 1.4 sample assumed it existed; OpenCode added with matchMedia listener
5. **SPEC text was wrong about two surfaces** (now patched in `V3_VISUAL_REFRESH_SPEC.md` §1.2 §1.5):
   - `profile .user-card` is solid `var(--campus-blue-surface)`, not a `linear-gradient`
   - `PlazaBannerCarousel` renders user-uploaded Supabase images, not pastel gradient banners
6. **npm not pnpm** — project uses `npm --legacy-peer-deps`
7. **Task 1.6 went per-page**, skipped global override — global rule would be dead code per scope specificity
8. **Task 1.4 capped at messages + chat** — 12 other surfaces flagged for v3.5 sweep

## v3.5 backlog (new — accumulated during P1 visual smoke + hotfix iteration)

- **Avatar dark-fallback sweep** to 12 remaining surfaces beyond messages+chat: `index/index.vue:261`, `plaza/index.vue:96+210+242`, `post/index.vue:21+101+133`, `detail/index.vue:97`, `profile/index.vue:38`, `profile/edit.vue:15`, `seller/index.vue:15`, `history/index.vue:48`, `following/index.vue:38`, `admin/index.vue:101+129+149`, `blocked/index.vue:16`, `onboarding/index.vue:48`
- **`.banner-skeleton`** in `PlazaBannerCarousel.vue:122` uses hardcoded light hex — bright stripes on dark canvas during banner load
- **`--frame` semantic divergence** from `--bg-inset`/`--paper-3` (was alias, now diverges per "middle anchor"); naming clarification needed
- **Sass `legacy-js-api` deprecation warnings** (pre-existing, ~10× per build)
- **Messages list-row contrast in dark too weak** — conv-item bg `#26231E` vs page bg `#15130F` ΔE ~17, divider `--border` 0.10α cream too subtle. Profile listings have the same issue. P2 component visual refresh should include list-row bg/divider/shadow polish as a system, not single-page hack.
- **Messages partial-swipe sub-pixel leak** — visibility-toggle fix solved the resting-state leak, but during partial-swipe (conv-item translateX between 0 and -210), the `.conv-row` border-bottom region still shows swipe-action colors leaking. Root cause: `.conv-row { overflow: hidden }` + transformed `.conv-item` + sub-pixel rendering at the 0.5px border boundary. Fix candidates: (a) move divider from conv-row border-bottom to conv-item box-shadow / (b) conv-item inset shadow ring to cover edges / (c) `overflow: clip` + `translate3d` for GPU layer / (d) wrapper-based clip rework. Best done as part of P2 list-row systematic refactor.
- **OpenCode CSS-stacking analysis self-doubt** in commit `bb21100` (squashed into 162b1a9) — superseded by the visibility-toggle fix and the hotfix; commit body retains the documentation as historical record. No active follow-up needed.

## How to apply going forward

- Prefer the new tokens for dark-mode work: `--ink-placeholder` for input placeholder, `--ink-strong` for hero titles, `--campus-blue-chip-*` for campus chips, `--user-card-grad-dark` for the profile passport panel
- Bind theme-aware assets to `useTheme().isDark` (computed), not `pref` directly — `pref === 'auto'` is the default for new users
- Per-page `[data-theme="dark"] .selector` + `@media prefers-dark` override pattern is the established way to scope dark-only CSS (introduced in P1)
- When showing Vue template binding diffs in chat, paste the FULL element block — don't show single attribute lines as a patch (lesson from this hotfix)

**Status:** merged + Vercel deployed. P2 (UIcon + UButton + 22 SVG icons + 6 surface migration) is the next phase.
