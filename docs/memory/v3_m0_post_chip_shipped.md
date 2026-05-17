---
name: M0 — Post detail attached-item chip rendering shipped 2026-05-17
description: Fixed a mig-041-era regression where pages/post/index.vue (detail) silently dropped post.post_items even though the data was already fetched via the shared POST_SELECT. Plaza list rendered chips but detail page didn't, so users couldn't see attached items after tapping into a post. Single-file fix (~30 LOC + 1-line side-fix in usePlaza.ts fetchPost order clause). PR #18, squash SHA 3299b0a. Approach: copy-paste, not extracted component — defer extraction to P2b sprint.
type: project
originSessionId: ses_1d4bddb74ffe51TTfD65sjgW33
---
**Symptom**: `pages/post/index.vue` detail page didn't render `post.post_items` even though `fetchPost(id)` returned them populated. Plaza list at `pages/plaza/index.vue:148-167` had the canonical chip template; detail page silently dropped the same data. User taps a plaza post → goes to detail → no chip surface to see / tap into the attached item. Regression present since mig 041 (2026-05-09); only caught 2026-05-17 during M0 audit.

**Root cause**: When mig 041 added `post_items` join table, Kenny shipped the plaza list chip rendering (PR #4–#6 over 5/8–5/9) but the symmetric detail-page rendering was missed. `usePlaza`'s `POST_SELECT` already included `post_items(*, item:items(...))` so both `fetchPosts` and `fetchPost(id)` returned the join data — only the template at `post/index.vue` consumer side was missing.

**Fix scope** — single file change, copy-paste from plaza, **not extracted into shared component**:

- `app/src/pages/post/index.vue` (+55/-1):
  - Template: `v-for="pi in (post.post_items || [])"` block inserted between `.images` and `.stats-row` (matches plaza's visual order: images → chip → action-row)
  - SCSS: copied `.attached-item-card` + `.aic-*` rules from plaza verbatim. Adjusted margin (`12px 0 0 0` top-only vs plaza's `8px 14px 0 54px` left-inset for avatar column). Added sibling rule `.attached-item-card + .attached-item-card { margin-top: 8px; }` to tighten cap=3 stacked chips
  - Script: 3-line `goToAttachedItem(id)` navigation handler + `thumbUrl` added to existing utils import. `t` / `localize` already available
- `app/src/composables/usePlaza.ts` (+1):
  - Added `.order('display_order', { foreignTable: 'post_items', ascending: true })` to `fetchPost(id)` chain before `.maybeSingle()`. Pre-existing tiny bug — `fetchPosts` (list) had this order clause, `fetchPost` (single) didn't, so chip order on detail page was arbitrary postgres physical order. Now deterministic.

**Why copy-paste not shared component**:

1. Bug is single-page (only post detail missing). Plaza side works.
2. SCSS is 14 lines + template is 16 lines — fully manageable to duplicate.
3. P2b sprint (queued — see `sprint_v3_phase_status.md`) is the 6-surface UIcon/UButton migration. P2b may want to wrap the chip in `UButton`-style or extract differently. Extracting now adds component-design decision to M0 scope that doesn't belong there.
4. Audit explicitly recommended X (copy-paste) over Y (extract) — see fix-spec section §3 of the audit.
5. The two copies (`plaza/index.vue:148-167 + :1498-1511` and `post/index.vue` new sections) are kept findable via grep on `attached-item-card`. SCSS in `post/index.vue` has an explicit comment block above the rules pointing back to plaza as source-of-truth and flagging the P2b extraction opportunity.

**Ship workflow** (all done by OpenCode this session per Eric explicit ask):

1. Local branch `fix/m0-post-detail-attached-chips` off `f9023b1`
2. Atomic commit `2889974` with all 4 changes (template, SCSS, handler, import) + the usePlaza .order side-fix
3. Three-green hook: vue-tsc 0 errors / build:h5 ✓ / build:mp-weixin ✓
4. Pushed `git push -u origin fix/m0-post-detail-attached-chips`
5. Eric H5 dev smoke (post fresh-wipe data — 2 items + 1 post with chips) — chip renders, navigation works, display_order ascending verified
6. PR #18 opened via `gh pr create` against main
7. 3 required checks pass (Type-check 45s / Build H5 39s / Build mp-weixin 34s)
8. Squash-merged via `gh pr merge --squash --delete-branch` → main HEAD `3299b0a`
9. Vercel auto-deploy to prod completed ~15s post-merge

**Memory deltas from M0**:

- `sprint_v3_phase_status.md`: add M0 row to the phase table (between v3.5 partial and v3.5 audits)
- `reserved_accounts_six.md`: REPLACED (the 5 pending rebuilds got auto-resolved by the scheduled-backup restore that happened during this same session — see `lesson_scheduled_backup_restore.md`)
- New memory: `lesson_scheduled_backup_restore.md` capturing the Pro-plan free daily backup vs paid $100/mo PITR + Storage-not-included caveat learnings

**How to apply going forward**: when shipping mig-driven join-table features (post_items class), audit BOTH the list view AND the detail/single view as parallel consumers. The shared `*_SELECT` in composables makes data-side parity automatic, but template-side parity is per-page. Suggested checklist next time mig 0XX adds a join table:
- [ ] List view template renders the join
- [ ] Detail view template renders the join
- [ ] Both use the same `*_SELECT` constant (or document why they differ)
- [ ] Both have `.order` if the join has a display_order column
- [ ] SCSS for the join row is either in a shared component OR duplicated with cross-referencing comments

**Open follow-ups (not blocking)**:

- P2b sprint may extract `AttachedItemChip.vue` shared component, replacing both plaza + post copies
- Memory entry assumes Eric's pre-wipe Eric account is the active prod identity (post-restore + re-wipe); admin token bearer plaintext is whatever Eric saved pre-wipe in password manager (5/12 mint `7bc0a8d8` is dead per the restore-wipe sequence)
- Pinned post id `e107f8f3-...` is **dead** (was restored to life by backup restore, then wiped again by re-wipe) — when CAACI 小助手 needs a pinned post, INSERT a fresh row, new id

Cross-refs:

- `sprint_v3_phase_status.md` — phase tracker
- `lesson_scheduled_backup_restore.md` — the data-restore saga this M0 was woven into
- Audit spec for this fix lives in chat-Claude session, not in `docs/audit/` (single-pass fix sprint, no audit md committed)
