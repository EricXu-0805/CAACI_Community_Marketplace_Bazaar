---
name: O1 — Onboarding flow removed (2026-05-20)
description: 3-step onboarding wizard (nickname / campus / avatar) removed after F1/F1b/F1c failed real-device verification on the nickname input glyph clipping bug. App.vue gate now skips the onboarding branch and falls through directly to /pages/reconsent/index for new users (tos_version='0' < CURRENT_CONSENT_VERSION). Google OAuth nickname default upgraded from email prefix to raw_user_meta_data.full_name via handle_new_user trigger patch (migration 042). Onboarding route + campus_area column + GATE_EXEMPT_PAGES entry preserved as intentional orphans. F1 feature branch with 3 attempt commits + 4 lesson files preserved on origin as learning chain.
type: project
originSessionId: opencode-o1-onboarding-removed-session
---
# O1 — Onboarding flow removed (2026-05-20)

## Status: SHIPPED via PR #<TBD>, squash `<TBD-sha>`

## TL;DR

Onboarding 3-step wizard (nickname / campus / avatar) removed after F1/F1b/F1c failed iPhone Safari real-device verification on the nickname input glyph clipping bug. The auth gate in `App.vue` now skips its onboarding branch and falls through directly to `/pages/reconsent/index` for new users (legal consent preserved as non-negotiable; it's the only load-bearing piece). Google OAuth nickname default upgraded from email prefix (`eric.guoyi.xu`) to `raw_user_meta_data.full_name` (`Eric Xu`) via `handle_new_user` trigger patch in migration 042.

Net change: 3 commits → 1 atomic commit; the feature surface (3-step wizard) deleted; the legal requirement preserved via existing reconsent page.

## Why removed (vs further iteration on F1)

1. **3 attempts (F1 / F1b / F1c) all failed real-device verification** despite an audit-driven approach with Web Inspector data and framework CSS verification. See `docs/memory/v3_f1_glyph_clipping_shipped.md` for the full attempt history.
2. **Audit revealed the wizard was collecting mostly redundant or dead data:**
   - **Nickname:** redundant for email signup (already collected on the login form), marginal value for Google OAuth (`full_name` available in `raw_user_meta_data`), redundant for WeChat (returned by `/api/auth/wechat-login`).
   - **Campus:** `campus_area` column is **dead data** — never read by any feature, RLS, or display. Only consumed by onboarding's own hydration to pre-fill step 2 (self-reference). The "location" field that features actually use is `profiles.location` (different column, editable via `profile/edit.vue`).
   - **Avatar:** redundant with `profile/edit.vue` which has identical `uploadImages` plumbing and is the canonical editable surface.
   - **Consent record:** legally required → preserved via existing `/pages/reconsent/index`.
3. **UX simplification:** 4 conceptual steps (3 wizard + 1 consent) → 1 step (consent only) reduces signup funnel drop-off.
4. **Bug-surface elimination:** the onboarding page had at least 3 known bugs (F1 glyph clip + F2 keyboard occlusion + F5 webfont mismatch) — all eliminated by removing the page itself.
5. **Pattern recognition (per `lesson_blind_iteration_stop_after_3.md`):** after 3 fix attempts on the same bug all fail real-device, stop iterating and reassess scope.

## Changes (this commit)

### Code (2 files)

**`app/src/App.vue` (enforceConsentGate)** — removed the `if (!u.onboarded_at) → /pages/onboarding/index` branch. New users now fall through to the existing `tos_version < CURRENT_CONSENT_VERSION → /pages/reconsent/index` branch on the line below. Comment block at the top of the gate region updated to explain the O1 decision.

**`app/src/pages/login/index.vue` (signup-success path)** — changed `uni.reLaunch({ url: '/pages/onboarding/index' })` to `uni.reLaunch({ url: '/pages/index/index' })` for the auto-confirmed email signup branch. The App.vue gate catches the new user immediately after `currentUser` populates and routes them to reconsent. Added 7-line comment explaining the redirect target swap.

### Database (1 new migration, **NOT auto-applied — Eric runs in Dashboard or via supabase CLI**)

**`supabase/migrations/042_handle_new_user_oauth_fullname.sql`** — `CREATE OR REPLACE FUNCTION public.handle_new_user()` with extended `COALESCE` chain for nickname source:

```sql
COALESCE(
  NEW.raw_user_meta_data->>'nickname',     -- Email signup (useAuth.signUp passes data.nickname)
  NEW.raw_user_meta_data->>'full_name',    -- Google OAuth (O1-added)
  NEW.raw_user_meta_data->>'name',         -- Belt-and-suspenders OAuth fallback (O1-added)
  split_part(NEW.email, '@', 1),           -- Email-prefix fallback (existing 010 behavior)
  'user'                                   -- Final fallback (existing 010 behavior)
)
```

**Preserves verbatim from migration 010** (the previous latest definition):
- All 5 column writes: `id`, `email`, `nickname`, `is_illini_verified`, `uid`
- `ON CONFLICT (id) DO NOTHING` envelope
- `EXCEPTION WHEN OTHERS THEN RAISE WARNING` wrapper (so auth signup never fails on trigger error)
- `public.generate_uid()` call
- `LOWER(email) LIKE '%@illinois.edu'` Illini auto-verification

Idempotent (CREATE OR REPLACE). Safe on prod. Safe to re-run.

### Memory (6 files this commit)

NEW:
- `docs/memory/o1_onboarding_removed.md` (this file)
- `docs/memory/lesson_blind_iteration_stop_after_3.md`

EDIT:
- `docs/memory/v3_f1_glyph_clipping_shipped.md` — Status → PAUSED, outcome section appended
- `docs/memory/sprint_v3_phase_status.md` — F1 row → F1 paused / O1 shipped
- `docs/memory/MEMORY.md` — F1 entry updated + 2 new entries (O1 + lesson)
- `docs/memory/backlog_onboarding_glyph_clipping.md` — Status → SUPERSEDED

## Preserved as intentional orphans (no cleanup)

These were kept on purpose to minimize risk and preserve learning:

| Artifact | Why preserved |
|---|---|
| `/pages/onboarding/index` route in `pages.json` | Stale deep-link safety (404 prevention); zero runtime cost |
| `app/src/pages/onboarding/index.vue` source file | Same as above; can be deleted in a future cleanup migration if desired |
| `pages/onboarding/index` in `GATE_EXEMPT_PAGES` list | Harmless when route is unreachable through normal flow |
| `profiles.campus_area` column | Dead data; zero runtime cost; column DROP would require its own migration + RLS adjustments |
| `Profile.campus_area?` in `app/src/types/index.ts` | TypeScript type stays as `optional` — non-blocking |
| F1 feature branch `fix/f1-onboarding-glyph-clipping` | 3 commits (F1/F1b/F1c) preserved on origin as audit-failed learning chain |
| F1 PR #20 (closed) + PR #21 (open) | GitHub PR history preserved — chat-Claude / Eric can close #21 separately or leave open as historical artifact |

## What we kept from F1 sprint (the value isn't zero)

4 lesson files extracted during F1 attempts, all on `fix/f1-onboarding-glyph-clipping` branch and preserved by reference here:

- **`lesson_uni_input_wrapper_not_native.md`** — uni-app H5 compiles `<input>` to a 3-tier nested DOM (`<uni-input>` → `<div class="uni-input-wrapper">` → `<input class="uni-input-input">`). SCSS `.input` rule lands on the outer custom element, NOT the native input. Framework hard-codes `uni-input { height: 1.4em }`. Idiom: `height: 44-48px` override. Do NOT add unitless `line-height` — re-computes at inner input via inheritance, risks overflow.
- **`lesson_ios_safari_realdevice_gate.md`** — Mac dev (Chrome + Mac Safari) CANNOT reproduce iOS Safari's `RenderThemeIOS` internal rendering. New HARD gate: Vercel preview + real iPhone Safari verification required BEFORE squash-merge for platform-specific UI fixes. F1 incident is the canonical case study.
- **`lesson_uni_app_placeholder_overlay.md`** — uni-app's `.uni-input-placeholder` is a separate `<span>` sibling of the inner real `<input>`, framework-hardcoded as `position: absolute; top: auto !important; color: gray; pointer-events: none`. In a flex column wrapper, `top: auto` resolves to the static-position fallback at the wrapper content-box TOP. The placeholder OVERLAYS value text once the wrapper has visible height. uni-app's value-aware hide heuristic is unreliable on iOS Safari. Hide via `:deep(.uni-input-placeholder) { display: none }` when a sibling `<label>` exists.
- **`lesson_blind_iteration_stop_after_3.md`** — Stop fix iteration after 3 attempts on the same bug all fail real-device verification. Reassess scope instead. The F1 sprint is the canonical example.

These are infrastructure-grade knowledge that will save future sprints. **Net F1 sprint value: 4 new lessons + UX simplification (O1) at the cost of 3 abandoned fix attempts.**

## Smoke (chat-Claude smoke checklist — Mac dev sufficient)

Per `lesson_ios_safari_realdevice_gate.md`, real-device gate applies to platform-specific UI fixes. O1 is pure routing logic (TypeScript-level branch removal); Mac dev smoke is sufficient.

- ✅ Three-green pre-push: `vue-tsc --noEmit` + `npm run build:h5` + `npm run build:mp-weixin` all exit 0
- 🔲 **Eric to verify manually after push:**
  - Sign up fresh email account → lands on `/pages/reconsent/index` (not onboarding) → accept → home
  - Sign in with existing onboarded account → home directly (no detour)
  - (If migration 042 applied) Sign up with Google OAuth → nickname is `full_name` not email prefix
  - Direct-URL access to `/pages/onboarding/index` → page renders (orphan) but no auto-redirect

## What we don't know yet (deferred until / unless onboarding ever comes back)

These are open questions from the F1 sprint that remain unanswered. They only matter if a future sprint reintroduces input collection in onboarding:

1. Why F1c's `:deep(.uni-input-placeholder) { display: none }` didn't actually hide the placeholder element on real iOS Safari (Mac DevTools showed it should work).
2. Whether iOS Safari 26.x has a specific behavior with uni-app custom elements not present in earlier iOS versions.
3. Whether there's a uni-app runtime bug intercepting our `:deep()` rule before browser parse.

These are NOT blocking O1 ship. See `docs/memory/lesson_blind_iteration_stop_after_3.md` for the framing.

## Deferred / future (separate sprints)

- **Migration 042 apply** — Eric runs in Supabase Dashboard SQL Editor OR via `supabase db push` from local. NOT auto-applied (red-line: AI never touches Auth / SQL Editor for prod).
- **Nickname max-length canonical resolution** — signup form / profile edit / RPC have different limits (40 / 30 / 40). Pick one. Non-blocking, low priority.
- **`profile.location` vs `profile.campus_area` consolidation** — two columns serving overlapping purposes. Could consolidate to `location` only. Non-blocking, schema cleanup.
- **Optional first-visit banner** — explicitly DEFERRED per Eric decision (ship clean; add nudge later if user feedback warrants it).
- **F1 deep-dive (iOS version comparison / uni-app GitHub issue search)** — only revisit if onboarding ever needs to come back. Backlog only.
- **F2 keyboard occlusion** — independent sprint, already audited; can ship after O1 lands.
- **`/pages/onboarding/index.vue` source-file cleanup** — orphan deletion can be a follow-up sprint if Eric wants the tree cleaner. Low priority.

## Decisions locked (O1)

- **Onboarding flow removed** (3-step wizard deleted via gate-branch removal)
- **Reconsent preserved** as the canonical legal consent surface (existing page, unchanged)
- **Google OAuth nickname upgrade** via migration 042 — fixes "email prefix" UX without requiring onboarding
- **Orphan route + dead column** preserved (zero runtime cost, defensive against stale deep-links)
- **First-visit hint** NOT included in O1 — ship clean, add nudge later only if needed
- **F1 sprint commits + 4 lesson files preserved** on `fix/f1-onboarding-glyph-clipping` branch
- **Migration 042 NOT auto-applied** — Eric runs in Dashboard or via CLI (red-line preserved)
- **Branch: `feat/o1-skip-onboarding-flow` off main bc29524** — clean start from main, NOT stacked on F1 branch
- **Bundle 6 memory file changes** in this same commit (per `workflow_audit_first.md` step 4 — no Round 2 memory sync PR)

## Pre-push hook three-green output

```
[1/3] vue-tsc --noEmit
  ✓ type-check passed
[2/3] npm run build:h5
  ✓ build:h5 passed
[3/3] npm run build:mp-weixin
  ✓ build:mp-weixin passed
```

## Cross-refs

- F1 sprint history (now PAUSED): `docs/memory/v3_f1_glyph_clipping_shipped.md`
- Why F1 paused (lesson): `docs/memory/lesson_blind_iteration_stop_after_3.md`
- Real-device gate (still applies for future UI sprints): `docs/memory/lesson_ios_safari_realdevice_gate.md`
- uni-app input DOM truth (preserved learning): `docs/memory/lesson_uni_input_wrapper_not_native.md`
- uni-app placeholder overlay (preserved learning): `docs/memory/lesson_uni_app_placeholder_overlay.md`
- Sprint tracker: `docs/memory/sprint_v3_phase_status.md`
- Backlog (now SUPERSEDED): `docs/memory/backlog_onboarding_glyph_clipping.md`
- Migration: `supabase/migrations/042_handle_new_user_oauth_fullname.sql`
- Workflow step 4 — memory rides with deliverable: `docs/memory/workflow_audit_first.md`
- Red-line zones (why Eric applies migrations, not AI): `docs/memory/red_line_zones.md`
- M0 (predecessor V3 deliverable, same week): `docs/memory/v3_m0_post_chip_shipped.md`
