# Sprint: v3.5 launch-blocker bundle (avatar dark fallback + banner skeleton tokens)

> OpenCode build prompt. Authored by chat-Claude 2026-05-12 for the post-wipe pre-beta polish run.
> Scope: 2 atomic commits in 1 PR. Bug 3 (onboarding keyboard occlusion) is **deferred to a separate audit-only sprint** per `docs/memory/backlog_onboarding_keyboard_occlusion.md`.

## 一、Context

Pre-beta polish run before Illini Market beta launch (target: May 2026). Two visual launch-blockers identified from `docs/memory/v3_p1_dark_mode_shipped.md` v3.5 backlog:

1. **Avatar dark-fallback sweep** to 12 remaining surfaces (P1 only covered messages + chat); on those 12 surfaces, users without an avatar see the light default SVG dropped onto dark canvas, producing visible mismatch
2. **PlazaBannerCarousel banner skeleton** uses hardcoded light hex values, flashing bright stripes while banners load on dark canvas

Both are well-understood patterns with prior P1 precedent — one-pass audit+fix is appropriate (per `docs/memory/sprint_form_audit_only_vs_one_pass.md` decision rule).

## 二、Required reading before starting

Read these first, in order. Do NOT start editing until you've confirmed each reference still matches the codebase (note any drift in your handoff):

1. `docs/memory/v3_p1_dark_mode_shipped.md` — P1 pattern source-of-truth; especially the avatar fallback section in messages + chat
2. `docs/memory/lesson_template_binding_full_block.md` — when patching Vue template bindings, show FULL element block to avoid the v3 P1 conv-row class-loss hotfix incident
3. `docs/memory/pre_push_three_green.md` — `vue-tsc` + `build:h5` + `build:mp-weixin` all required green before handoff
4. `docs/memory/opencode_no_self_decided_history_rewrite.md` — if a commit goes wrong, STOP and ask Eric; no amend / rebase / reset+recommit / force-push
5. `app/src/pages/messages/index.vue` — reference implementation: `useTheme()` + `isDark` + `defaultAvatarSrc` computed ternary (search for `defaultAvatarSrc`)
6. `app/src/composables/useTheme.ts` — confirm `isDark` is exported (v3 P1 added it; verify still present)
7. `app/src/components/PlazaBannerCarousel.vue` — bug 2 lives at the `.banner-skeleton` class block (~line 158-165)
8. `app/src/App.vue` — confirm `--bg-subtle` and `--paper-2` tokens exist in BOTH `:root` and `[data-theme="dark"]` blocks before using them in bug 2 fix

## 三、Branch + workflow

- Branch: `fix/v3p5-avatar-banner` from `main`
- 2 atomic commits in this order:
  1. `fix(avatar): dark-fallback sweep to 12 surfaces (v3.5 backlog)`
  2. `fix(plaza): banner skeleton uses tokens not hardcoded hex (v3.5 backlog)`
- Do NOT push. Do NOT merge. Output handoff at end for Eric to push (proxy via Zach or Kenny per `docs/memory/zach_git_proxy.md`)
- Do NOT amend / rebase / force-push / reset+recommit. If a commit goes wrong, STOP and surface to Eric.
- npm install with `--legacy-peer-deps` (project convention)
- Multi-line commit message: use `git commit -F <file>` not `-m` (Windows cmd.exe drops body on multi-line `-m` per `docs/memory/windows_cmd_multiline_commit_gotcha.md`)

## 四、Commit 1 — Avatar dark-fallback sweep × 12 surfaces

### Reference pattern (from `app/src/pages/messages/index.vue`)

In `<script setup>`:

```ts
import { useTheme } from '../../composables/useTheme'
// ... existing imports

const { isDark } = useTheme()

const defaultAvatarSrc = computed(() =>
  isDark.value ? '/static/default-avatar-dark.svg' : '/static/default-avatar.svg'
)
```

In template, wherever a default-avatar fallback existed previously:

```vue
<!-- Show the FULL <image> block when patching, not single attribute lines -->
<image
  :src="profile?.avatar_url || defaultAvatarSrc"
  class="..."
  mode="aspectFill"
/>
```

### Target files + cited lines (from v3.5 backlog snapshot 2026-05-10)

For each file below:

1. Read the WHOLE file first
2. Locate the `<image>` element at the cited line and confirm it's a default-avatar fallback (the original `:src` expression contains `'/static/default-avatar.svg'` literal or similar)
3. Add the `useTheme` import + `isDark` destructure + `defaultAvatarSrc` computed in `<script setup>` (skip if already present)
4. Replace the literal `'/static/default-avatar.svg'` with `defaultAvatarSrc` in the template
5. **Show the FULL `<image>` element block in your patch** (per `lesson_template_binding_full_block`) — do NOT patch single attribute lines

Files:

- `app/src/pages/index/index.vue:261`
- `app/src/pages/plaza/index.vue:96, 210, 242` (3 separate occurrences)
- `app/src/pages/post/index.vue:21, 101, 133` (3 separate occurrences)
- `app/src/pages/detail/index.vue:97`
- `app/src/pages/profile/index.vue:38`
- `app/src/pages/profile/edit.vue:15`
- `app/src/pages/seller/index.vue:15`
- `app/src/pages/history/index.vue:48`
- `app/src/pages/following/index.vue:38`
- `app/src/pages/admin/index.vue:101, 129, 149` (3 separate occurrences)
- `app/src/pages/blocked/index.vue:16`
- `app/src/pages/onboarding/index.vue:48`

### Drift handling

- If a cited line does NOT contain a default-avatar fallback (codebase drift since 2026-05-10): grep the file for `default-avatar.svg`, fix the actual occurrence(s), and note the drift in your handoff. Do NOT invent surfaces.
- If a file uses `<img>` (H5-only) instead of `<image>` (uni cross-platform): keep the existing tag, just swap the src expression.
- If a file already has `useTheme` / `isDark` imported for some other reason: reuse, don't duplicate.

### Scope cap (commit 1)

Only avatar src changes + `useTheme` imports + the new `defaultAvatarSrc` computed in these files. Do NOT touch other styles / logic / unrelated patterns. If you find a related issue, log it in handoff for a follow-up sprint — do NOT scope-creep.

## 五、Commit 2 — PlazaBannerCarousel banner-skeleton token-ization

### Current code (`app/src/components/PlazaBannerCarousel.vue:~158-165`)

```css
.banner-skeleton {
  width: 100%;
  aspect-ratio: 5 / 2;
  border-radius: 12px;
  background: linear-gradient(90deg, #eaeaef 0%, #f2f2f7 50%, #eaeaef 100%);
  background-size: 200% 100%;
  animation: shimmer 1.4s ease-in-out infinite;
}
```

### Required fix

Replace the hardcoded hex with theme-aware tokens. The shimmer needs **two contrasting subtle surface tokens** that already adapt to dark mode (per v3 P1 legacy-alias extension):

- `--bg-subtle` (slightly darker subtle surface)
- `--paper-2` (slightly lighter subtle surface)

Both are defined in BOTH `:root` and `[data-theme="dark"]` blocks of `App.vue` per v3 P1 ship. **Verify this is still the case before committing** — open `App.vue` and confirm both tokens exist in both blocks. If either is missing in the dark block, STOP and surface to Eric; do NOT pick a substitute token without his decision.

Proposed shimmer:

```css
.banner-skeleton {
  width: 100%;
  aspect-ratio: 5 / 2;
  border-radius: 12px;
  background: linear-gradient(
    90deg,
    var(--bg-subtle) 0%,
    var(--paper-2) 50%,
    var(--bg-subtle) 100%
  );
  background-size: 200% 100%;
  animation: shimmer 1.4s ease-in-out infinite;
}
```

### Visual sanity check (commit 2)

After patching, `build:h5` and open `app/dist/build/h5/index.html` locally if a static preview is feasible. Alternative: inspect the resolved token values in `App.vue` and assert the gradient stops differ in light vs dark by at least ΔE ~8 to keep shimmer perceptible.

Expected outcome:
- Light mode: subtle gray shimmer (similar to current behavior, just token-based)
- Dark mode: subtle warm-deep shimmer (no more white-flash on dark canvas)

### Scope cap (commit 2)

Only the `.banner-skeleton` block. Do NOT touch other styles in `PlazaBannerCarousel.vue` (including `.banner-wrap`, `.banner-swiper`, `::after` overlay, `@keyframes shimmer`, etc).

## 六、Verification (before handoff)

Run all three; all three MUST pass:

```bash
cd app
npm install --legacy-peer-deps    # if needed
npm run --silent type-check        # vue-tsc, expect 0 errors
npm run --silent build:h5          # H5 prod build, expect success
npm run --silent build:mp-weixin   # mp-weixin build, expect success
```

If any of the 3 fails:
- STOP. Do not commit further. Do not push.
- Surface the error verbatim to Eric in handoff.
- Do NOT amend / reset / self-debug for more than 2 retry cycles. After 2 retries, escalate.

## 七、Handoff format (output at end of run)

Provide a single markdown block at the end of the run containing:

1. **Branch name** + 2 commit SHAs + commit subjects
2. **Diff stat** per commit (`git log feat/<branch>..main` reversed, then `git show --stat <sha>` for each)
3. **Three-green verification**:
   - vue-tsc: ✅ / ❌ + error count
   - build:h5: ✅ / ❌
   - build:mp-weixin: ✅ / ❌
4. **Drift report**: any cited line numbers in commit 1 that were wrong; which file/line the actual fallback was at
5. **Token verification**: confirmation that `--bg-subtle` and `--paper-2` were found in both `:root` and `[data-theme="dark"]` blocks of `App.vue` (cite line numbers)
6. **Deferred / out-of-scope**: anything you wanted to fix but didn't (scope creep avoided)

Eric will:
- Read handoff
- Open the PR (squash-merge per `docs/memory/pr_merge_squash_policy.md`)
- Push when ready

## 八、Hard constraints (red lines)

- NO push, NO merge, NO force-push, NO amend, NO rebase, NO reset
- NO DB / migration / Supabase Dashboard touches (Eric-only red line per `red_line_zones.md`)
- NO third-party API calls (Resend / OpenAI / Cloudflare / etc)
- NO touching files outside the 13 listed (12 avatar surfaces + 1 PlazaBannerCarousel.vue)
- NO scope creep: if you notice an unrelated bug, log in handoff, do NOT fix
- NO bundling bug 3 (onboarding keyboard) in any form — it's deferred to a separate audit-only sprint per `docs/memory/backlog_onboarding_keyboard_occlusion.md`
- If three-green fails, STOP and surface; don't self-debug for >2 retry cycles
- If a cited file/line doesn't match expected pattern (codebase drift), surface in handoff, don't invent fixes

## 九、Cross-references

- Sprint context: `docs/memory/v3_p1_dark_mode_shipped.md` (v3.5 backlog section)
- Deferred bug 3: `docs/memory/backlog_onboarding_keyboard_occlusion.md`
- Workflow decision rule: `docs/memory/sprint_form_audit_only_vs_one_pass.md`
- Three-green hook: `docs/memory/pre_push_three_green.md`
- Lesson on template patching: `docs/memory/lesson_template_binding_full_block.md`
- PR conventions: `docs/memory/pr_merge_squash_policy.md`
- Commit message conventions on Windows: `docs/memory/windows_cmd_multiline_commit_gotcha.md`
- Push proxy: `docs/memory/zach_git_proxy.md`
