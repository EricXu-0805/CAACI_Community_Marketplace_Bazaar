---
name: Git push proxies — Zach (Eric author spoof) + Kenny-JT (raw "走 B")
description: Two authorized git/push proxies; Zach (macOS, spoofs Eric author for Vercel free-plan legacy) + Kenny-JT (Windows, raw identity per "走 B" decision 2026-05-09 after Vercel Pro)
type: project
originSessionId: 9852fdfb-dfb7-46b2-9864-95942d5727dd
---
Eric does not push from his own machine. Two authorized git/push proxies operate on his behalf:

**Zach** (GitHub `Zach070805`, machine `/Users/zhaozeyu/...`, macOS)
- Set up 2026-05-08
- Machine permanently sets `git config user.email "eric.guoyi.xu@gmail.com"` + `user.name "EricXu-0805"` so commits ship as Eric
- Original driver: Vercel free plan auto-deploy required commit author = team member
- Vercel upgraded to Pro 2026-05-09 making this constraint moot, but git config kept for consistency

**Kenny** (admin/合伙人, machine `C:\Users\kenny\source\repos\...`, Windows, GitHub `Kenny-JT`)
- Activated 2026-05-09 ("走 B" decision after Vercel Pro upgrade)
- Machine uses raw Kenny-JT identity (`Kenny_JT <yaoxin.jiang@outlook.com>`), NOT spoofed as Eric
- Rationale: Vercel Pro removed author constraint → no need to spoof; Eric Decision 1 = A (accept Kenny-JT as commit author) per D3 review
- Sprints with Kenny-JT author landed on main: PR #5 (N13/N14, squash 2026-05-09), PR #6 (N7-redux D3, squash 2026-05-10)

**Choosing proxy:** ad-hoc per sprint depending on availability. Both proxies follow same hard-stop rules — no SQL, no Supabase config, no remote push / PR / merge without Eric's explicit go.

**How to apply:** when prompting OpenCode, the `Branch + identity setup` section should read identity from `git config` and STOP if it's neither Eric nor Kenny-JT (and neither matches the prior commit author on the active feature branch). Don't auto-change git config.
