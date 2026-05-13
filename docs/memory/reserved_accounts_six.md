---
name: Reserved accounts — post-wipe rebuild status (2026-05-12)
description: 6 reserved user accounts; 2026-05-11 prod wipe invalidated all old UUIDs; Eric rebuilt 2026-05-12 with new UUID + admin_tokens row; 5 others pending rebuild
type: project
originSessionId: b953b797-5c97-4889-9ddc-e30f716e29b0
---
**2026-05-11 prod data wipe** invalidated all 6 reserved account UUIDs. Old UUIDs and pinned post id `e107f8f3-8430-4e37-b0c4-7f7da734949c` are **dead references** — do NOT cite them as if they're live.

Rebuild status as of 2026-05-12:

| Account | Status | New UUID |
|---|---|---|
| Eric (eric.guoyi.xu@gmail.com) | ✅ rebuilt 2026-05-12 via Google OAuth | `55373dd3-d99e-4828-b82d-60fc9abbfb4a` |
| CAACI 小助手 (test@caaci.com, system, ex-pinned-post owner) | ⏳ pending rebuild | — |
| Kenny (yaoxinj2@illinois.edu, admin/合伙人) | ⏳ pending rebuild | — |
| Zach (zeyuzhao217@gmail.com, admin/合伙人) | ⏳ pending rebuild | — |
| Eric WeChat (old openid `oV5Bk3RAotY5-rL5mRkleaSXejUQ`) | ⏳ pending rebuild — openid may differ on new bind | — |
| jtu9@illinois.edu (utj test) | ⏳ pending rebuild | — |

**Pinned post**: old id `e107f8f3-8430-4e37-b0c4-7f7da734949c` is dead. After CAACI 小助手 rebuild, a new pinned post must be re-created; the new post id will differ. If the frontend hardcodes a pinned-post id constant anywhere, it must be updated to match.

**Admin status**: Eric has `admin_tokens` row inserted 2026-05-12 04:35:05 UTC (admin_tokens.id `7bc0a8d8-6ddf-4ee1-adb3-20f90e43aa65`, active=true). Plaintext bearer token stored in Eric's password manager — never in repo / chat / shell history.

**How to apply**: when reasoning about reserved-account identity or pinned-post id, check this memory's rebuild status before assuming any value is live. Pending-rebuild rows have no UUID yet — do not invent one. If another memory or doc references an old UUID, treat it as historical, not current.

**Update protocol**: as each pending account is rebuilt, edit this memory to fill in the new UUID + rebuild date. When all 6 are rebuilt + pinned post is re-created + frontend constants updated, consolidate this memory into a steady-state form (drop the rebuild table, keep just the identity list + admin status).
