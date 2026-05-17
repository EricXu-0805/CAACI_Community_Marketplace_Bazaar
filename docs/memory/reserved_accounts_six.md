---
name: Reserved accounts — post-restore state (2026-05-17)
description: 6 reserved user accounts. 2026-05-11 wipe invalidated all old UUIDs. Eric did partial rebuild 2026-05-12 (UUID 55373dd3 + admin_tokens 7bc0a8d8). 2026-05-17 Eric restored from 10 May 2026 scheduled backup → pre-wipe UUIDs back for all 6 accounts; 5/12 rebuild UUIDs are GONE. Then re-wiped transactional data only (kept profiles + admin_tokens). Current state: all 6 reserved profiles live with pre-wipe UUIDs; Eric needs to re-query auth.users to populate UUID column below.
type: project
originSessionId: ses_1d4bddb74ffe51TTfD65sjgW33
---
**2026-05-11 prod data wipe** invalidated all 6 reserved account UUIDs.

**2026-05-12 partial rebuild**: Eric rebuilt his own profile via Google OAuth → got new UUID `55373dd3-d99e-4828-b82d-60fc9abbfb4a`. Minted admin_tokens row id `7bc0a8d8-6ddf-4ee1-adb3-20f90e43aa65`. 5 other reserved accounts still pending rebuild as of 5/14.

**2026-05-17 restore-then-rewipe** (see `lesson_scheduled_backup_restore.md`): Eric restored from 10 May 2026 07:15 UTC scheduled backup. Restore brought back **all 6 reserved accounts with their pre-wipe UUIDs** + Eric's pre-wipe admin_tokens (4 rows). The 5/12 rebuild UUID `55373dd3` and admin_tokens id `7bc0a8d8` were OVERWRITTEN by the restore and are GONE. Then Eric re-wiped transactional tables only (TRUNCATE posts/items/post_items/post_comments/etc. with CASCADE) — profiles + admin_tokens preserved.

**Current state as of 2026-05-17**:

| Account | Status | UUID |
|---|---|---|
| Eric (eric.guoyi.xu@gmail.com) | ✅ live, pre-wipe identity restored | **TBD** — Eric to `SELECT id FROM auth.users WHERE email = 'eric.guoyi.xu@gmail.com'` and update this row |
| CAACI 小助手 (test@caaci.com, system, ex-pinned-post owner) | ✅ live, pre-wipe identity restored | **TBD** — re-query |
| Kenny (yaoxinj2@illinois.edu, admin/合伙人) | ✅ live, pre-wipe identity restored | **TBD** — re-query |
| Zach (zeyuzhao217@gmail.com, admin/合伙人) | ✅ live, pre-wipe identity restored | **TBD** — re-query |
| Eric WeChat (pre-wipe openid `oV5Bk3RAotY5-rL5mRkleaSXejUQ`) | ✅ live, pre-wipe identity restored | **TBD** — re-query via `wechat_password_map` cross-join |
| jtu9@illinois.edu (utj test) | ✅ live, pre-wipe identity restored | **TBD** — re-query |

**Pinned post**: original id `e107f8f3-8430-4e37-b0c4-7f7da734949c` was restored to life by backup restore, then RE-WIPED by 5/17 transactional re-wipe (`posts` table truncated). **Currently dead**. To re-create the pinned post:

```sql
INSERT INTO public.posts (
  id, user_id, content, content_i18n, images,
  is_pinned, is_official, status, created_at
) VALUES (
  gen_random_uuid(),
  '<CAACI_小助手_pre-wipe_UUID>',  -- look up after re-query
  '<official welcome content>',
  '{"en": "...", "zh": "..."}'::jsonb,
  ARRAY[]::text[],
  true, true, 'active', now()
) RETURNING id;
```

The new post id will differ from `e107f8f3-...`. If the frontend hardcodes a pinned-post id constant anywhere, it must be updated. **2026-05-17 grep verified zero hardcoded references** to `e107f8f3-...` in `app/` `api/` `supabase/migrations/`.

**Admin tokens (Eric)**: `admin_tokens` table has 4 rows preserved from restore (pre-wipe Eric had 4 mints over time). The 5/12-minted row id `7bc0a8d8-6ddf-4ee1-adb3-20f90e43aa65` is **GONE** (overwritten by restore). For admin dashboard access, Eric needs **pre-wipe bearer plaintext** from password manager. If only the 5/12 bearer was retained in password manager, the 5/12 bearer is now invalid → re-mint via:

```bash
export SUPABASE_URL=https://<project>.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=<service_role>
node scripts/admin-token-mint.mjs --name "Eric" --email "eric.guoyi.xu@gmail.com" --admin-id <Eric_pre-wipe_UUID> --apply
```

Save new plaintext bearer to password manager immediately — it's only displayed once.

**How to apply going forward**:

- Treat the pre-wipe UUIDs as the current live identities. When you need a specific UUID, query `auth.users` directly via Dashboard SQL Editor — don't hardcode any of the values above.
- When this memory's `TBD` cells are filled in, drop them into the table and remove this `How to apply` note.
- The 5/11-wipe-and-rebuild cycle is now historically resolved by the 5/17 restore. Future references to "5/12 Eric UUID `55373dd3...`" or "admin_tokens `7bc0a8d8...`" are referring to dead records.

**Update protocol**: as Eric queries each pending UUID, edit this memory's table to fill it in. Once all 6 UUIDs are known + pinned post is re-created + admin_tokens state is documented (4 pre-wipe rows or new mint(s) post-2026-05-17), consolidate this memory into steady-state form.

Cross-refs:

- `lesson_scheduled_backup_restore.md` — full saga of the 5/17 restore-then-rewipe pattern
- `v3_m0_post_chip_shipped.md` — M0 fix shipped against this fresh-wipe state
