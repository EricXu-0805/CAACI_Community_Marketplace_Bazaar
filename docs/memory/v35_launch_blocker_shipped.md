---
name: V3.5 partial — Launch-blocker bundle shipped 2026-05-13 (PR #13)
description: 2 of 6 v3.5 backlog items shipped via PR #13 squash 2243751; avatar dark-fallback x 12 surfaces + PlazaBannerCarousel banner-skeleton token-ization + bundled docs commit; shimmer-becomes-flat trade-off documented inline; --paper-2 -> --bg-inset is a 1-line follow-up to reactivate shimmer motion
type: project
originSessionId: b953b797-5c97-4889-9ddc-e30f716e29b0
---
V3.5 polish sweep partial ship — 2 of 6 backlog items closed in a single PR before beta launch.

- **PR**: #13 on `EricXu-0805/CAACI_Community_Marketplace_Bazaar`
- **Squash SHA**: `2243751` on main
- **Branch**: `fix/v3p5-avatar-banner` (deleted post-merge)
- **Authored**: 2026-05-12 (OpenCode build), squash-merged 2026-05-13

## What shipped (3 commits squashed to 1)

| # | Item | Files | Diff |
|---|---|---|---|
| 1 | Avatar dark-fallback × 12 surfaces | 12 .vue files (index / plaza / post / detail / profile / profile-edit / seller / history / following / admin / blocked / onboarding) | +82 / -21 |
| 2 | PlazaBannerCarousel banner-skeleton token-ization | `app/src/components/PlazaBannerCarousel.vue` | +25 / -1 |
| 3 (bundled) | docs(memory+audit) — post-wipe state + v3.5 OpenCode prompt + token-leak lesson + Bug 3 backlog | 5 doc files in `docs/memory/` + `docs/audit/` | doc only |

## Pattern used (commit 1 — avatar fallback)

Reused v3 P1's `useTheme().isDark` + paired SVG asset pattern (originally introduced in `pages/messages/index.vue` and `pages/chat/index.vue`). Each new surface adds:

- `import { useTheme } from '../../composables/useTheme'`
- `const { isDark } = useTheme()`
- `const defaultAvatarSrc = computed(() => isDark.value ? '/static/default-avatar-dark.svg' : '/static/default-avatar.svg')`
- Replaces literal `'/static/default-avatar.svg'` in template `<image :src="...">`

## Token swap (commit 2 — banner skeleton)

- **Before**: hardcoded `#eaeaef` / `#f2f2f7` light hex in `linear-gradient`. Bright white stripes on dark canvas during banner load.
- **After**: `linear-gradient(90deg, var(--bg-subtle) 0%, var(--paper-2) 50%, var(--bg-subtle) 100%)`. Theme-aware; no white-flash in dark mode.

## Known trade-off — shimmer becomes flat

OpenCode's audit revealed that `--bg-subtle` ≡ `--paper-2` within each theme (v3 P1 alias mirror; both legacy aliases point to the same canonical value). Consequently the proposed gradient resolves to a solid color in both themes (light: `#F0E9DA`, dark: `#36322B`), making the `shimmer` keyframe animation a visual no-op. The launch-blocker (bright white stripes) is fully resolved either way; only the motion polish is lost.

**1-line follow-up (not yet scheduled)**: swap `--paper-2` → `--bg-inset` to reactivate motion (ΔE 7-17 per theme). Inline comment in `PlazaBannerCarousel.vue` documents the equivalence and the recommended swap.

**Spec-side lesson** captured separately: `lesson_spec_token_check_actual_values.md` — chat-Claude must look up actual token values in `App.vue`, not just confirm existence, when speccing CSS that depends on token color differences.

## Naming inconsistency surfaced (not fixed, in scope-cap discipline)

- v3 P1 (`messages/index.vue`, `chat/index.vue`) names the computed `defaultAvatar`
- This sprint's 12 surfaces name it `defaultAvatarSrc` (per the build prompt's example)
- Net: 14 surfaces, 2 use `defaultAvatar`, 12 use `defaultAvatarSrc`. Functionally identical.
- Normalize in a future v3.5 cleanup sweep (suggest `defaultAvatar` since it's shorter + first in chronology).

## Three-green status

✅ vue-tsc (0 errors) / build:h5 / build:mp-weixin — all passed first try on fix commits. Doc commit skipped builds via pre-push hook's smart-skip (detected `docs/**` only change).

## Branch protection note (operational learning)

Direct push to main is blocked by GitHub branch protection ("3 of 3 required status checks expected"). All commits must land via PR + squash-merge. Doc-only commits also go through PR; pre-push hook's three-green skip applies but GitHub protection still requires PR. Pattern used here: cherry-pick the doc commit from local main onto the fix branch, push, single PR for fix + docs together. Avoids needing a separate doc-only PR.

## Remaining v3.5 backlog (after this ship)

From `v3_p1_dark_mode_shipped.md` v3.5 backlog section:

- **`--frame` semantic divergence** from `--bg-inset` / `--paper-3` — naming clarification
- **Sass `legacy-js-api` deprecation warnings** (build noise only, harmless)
- **Messages list-row contrast in dark too weak** — better done as part of P2 list-row systematic refactor
- **Messages partial-swipe sub-pixel leak** — same, P2 systematic refactor
- (Plus the already-superseded "OpenCode CSS-stacking analysis self-doubt" entry, no follow-up needed)
- **Shimmer reactivation** (`--paper-2` → `--bg-inset`) — new follow-up surfaced by this PR

4 items remaining + 1 new shimmer follow-up. Best done after P2b / P3 / P4 land per `sprint_v3_phase_status.md`.

## Cross-refs

- Build prompt: `docs/audit/V35_LAUNCH_BLOCKER_OPENCODE_PROMPT.md`
- Pattern source-of-truth: `v3_p1_dark_mode_shipped.md`
- Phase tracker: `sprint_v3_phase_status.md`
- Spec-side lesson: `lesson_spec_token_check_actual_values.md`
- Bug 3 (onboarding keyboard) still deferred: `backlog_onboarding_keyboard_occlusion.md`
