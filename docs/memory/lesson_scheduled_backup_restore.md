---
name: Lesson — Supabase Pro plan scheduled backups (free, daily) vs PITR ($100/mo); Storage NOT included
description: 2026-05-17 — restoring pre-wipe data for dev testing. Eric initially read the PITR tab and thought he needed to upgrade to PITR add-on ($100/mo) to recover any pre-wipe state. Pro plan already has 7-day daily physical backups (free). Picked the 10 May 2026 07:15 UTC snapshot (latest pre-wipe). Restore succeeded but Storage objects are NOT included in DB backups (Dashboard warning makes this explicit) — DB rows came back with intact image URL strings but actual files in Storage buckets were gone. Decided to re-wipe transactional data (fresh start for dev) while keeping the restored profiles + admin_tokens — net win because the 5 "pending rebuild" reserved accounts came back for free.
type: project
originSessionId: ses_1d4bddb74ffe51TTfD65sjgW33
---
**Trigger**: 2026-05-17 Eric needed pre-wipe test data restored after the 5/11 launch-prep wipe. Initially confused PITR ($100/mo paid add-on) with the daily scheduled backups (free, Pro plan default).

**Key fact**: Supabase Pro plan has **two separate backup mechanisms** and only one of them costs extra.

| Mechanism | Plan | Cost | Grain | Retention | Use case |
|---|---|---|---|---|---|
| **Scheduled backups** | Pro plan default | **free** | Daily (~midnight project-region time, "Physical" type) | **7 days** | Day-grain restore — "give me back the state from N days ago" |
| **PITR** (Point In Time Recovery) | Pro add-on | **$100/mo** | Any timestamp (second-level) | 7 days (Pro PITR) / 30 days (Pro+ PITR) | Surgical restore — "the bad commit/wipe was at 14:35:08, give me 14:35:07" |
| **Restore to new project** | Beta, on Pro | free | Same as scheduled | Same | Side-by-side restore without overwriting current — useful when comparing or migrating |

**Practical guidance**:

- For a wipe that happened on a known day, **scheduled backup is enough**. Pick the snapshot from the day BEFORE the wipe (or earlier) and restore in-place.
- PITR's value is precision (down to the second). If your wipe was triggered at 14:35:08 and you want to recover at 14:35:07, you NEED PITR. For "give me back yesterday's state", scheduled is fine.
- "Restore to new project" is Beta as of 2026-05. Useful for preview-then-decide flows, but requires reconfiguring frontend env (`.env` Supabase URL + keys) — for in-place fix it's overkill.

**⚠️ Storage caveat** (Dashboard warning, verbatim): "Storage objects are not included. Database backups do not include objects stored via the Storage API, as the database only includes metadata about these objects. Restoring an old backup does not restore objects that have been deleted since then."

**Implications**:

- After a DB backup restore: `posts.images`, `profiles.avatar_url`, `items.images` URL strings come back, but the actual jpg/png/heic files in Storage buckets are NOT in the backup.
- If Storage was wiped separately (or never had the files in the first place after the wipe), restore brings back DB references that 404 on fetch.
- Frontend fallbacks (e.g. `defaultAvatarSrc`, `/static/placeholder.svg` for items, `aic-img` fallback in attached-item chips) mask this from the user — app stays functional, images show as placeholders.
- For real-image testing, Storage must be backed up separately (via Storage API + S3-compatible storage policy, or manually re-uploading test fixtures).

**Successful pattern used 2026-05-17** ("restore-then-rewipe" for fresh-start with retained identity):

1. Restore pre-wipe scheduled backup (free). Brings back: auth.users, profiles, admin_tokens, banners, moderation_keywords, **and all transactional data from pre-wipe state**.
2. Verify state via SQL Editor (count check on posts/items/profiles/admin_tokens).
3. Optionally re-wipe transactional tables only (TRUNCATE posts, post_items, post_comments, items, etc. with CASCADE). Keep auth.users + profiles + admin_tokens + config tables (banners, moderation_keywords, wechat_password_map).
4. Net result: clean transactional slate (for fresh dev test data) + retained identity (Eric's original pre-wipe profile + admin_tokens come back without needing manual rebuild).

**This made reserved_accounts_six.md's "5 pending rebuild" list OBSOLETE** — the restore brought back CAACI 小助手 / Kenny / Zach / Eric WeChat / utj9 profiles with their pre-wipe UUIDs, no manual rebuild needed. Eric just has to query `auth.users` to look up current UUIDs (which are now pre-wipe values, NOT the 5/12 rebuild values like `55373dd3-...`).

**Lost in the restore-then-rewipe pattern**:

- Any post-wipe profile rebuilds (e.g. Eric's 5/12 `55373dd3` UUID is GONE; the active prod Eric is now the pre-wipe Eric with whatever original UUID was)
- Any post-wipe admin_tokens (e.g. 5/12 mint `7bc0a8d8` is GONE; Eric needs his pre-wipe bearer from password manager, or re-mint via `scripts/admin-token-mint.mjs`)
- Any post-wipe transactional data (e.g. dev test posts, fingerprint records) — but these are usually disposable

**How to apply going forward**:

1. Before paying for PITR add-on, **always check the scheduled backups tab** — it's a different panel in Database → Backups and is free. PITR is only worth it for sub-day precision restores.
2. **Before relying on a DB restore, verify Storage state** — query `storage.objects` row count OR click into a bucket via Dashboard → Storage. If Storage was wiped separately, plan for placeholder/404 fallbacks or separate Storage seed step.
3. **The "restore-then-rewipe" pattern is the cheapest way to get a fresh dev environment that retains reserved-account identities**. Use this any time you need clean test data but don't want to manually rebuild profile rows + admin tokens.
4. **If you need true point-in-time precision** (e.g. recover from a specific bad migration timestamp), THEN evaluate PITR add-on. Don't default to PITR.

Cross-refs:

- `reserved_accounts_six.md` — now reflects post-restore state (5 pending rebuilds resolved)
- `red_line_zones.md` — DB / Storage / 第三方 prod data calls are Dashboard-only Eric-do; this lesson reinforces that boundary (OpenCode helps with SQL drafting + SQL Editor paste pattern, Eric clicks the buttons)
- `v3_m0_post_chip_shipped.md` — the M0 fix was tested against this fresh-start DB state
