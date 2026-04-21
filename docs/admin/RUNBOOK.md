# Admin Runbook

Practical operator guide for the moderation dashboard at
`/#/pages/admin/index`. For architecture see `IMPLEMENTATION_GUIDE.md`.

## First-time setup

You only need to do this once per Vercel project.

1. Run the SQL bundles in order in Supabase SQL Editor:
   - `RUN_ONBOARDING_MIGRATION.sql`    (if not already applied)
   - `RUN_ADMIN_MIGRATION.sql`         (9 admin_* RPCs)
   - `RUN_ADMIN_AUDIT_MIGRATION.sql`   (audit columns on suspensions)
   - `RUN_AUDIT_LOG_MIGRATION.sql`     (admin_audit_log table + wiring)

   Each ends with `NOTIFY pgrst, 'reload schema'` so PostgREST sees
   the new functions immediately. Re-running any of them is a
   safe no-op.

2. On Vercel → Project → Settings → Environment Variables, add:
   - `ADMIN_API_KEY` — 32+ char random string (e.g. `openssl rand -hex 32`)
   - `SUPABASE_URL` — same as `VITE_SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY` — from Supabase → Settings → API → service_role

3. **Redeploy** (Deployments → latest → ⋯ → Redeploy). Edge functions
   don't pick up env changes without a redeploy.

4. Visit `https://<your-domain>/#/pages/admin/index`, enter the
   `ADMIN_API_KEY` in the gate, click Unlock. The key is stored in
   localStorage — it will persist until you Sign out.

---

## Daily workflow

### 1. Triage reports

Open the dashboard → **Reports** tab. The default view shows every
report regardless of status, newest first. Click **Open** on a report
to see the full detail.

From the detail sheet you can:
- **Open target** — jumps to the actual item/post page in a new route,
  so you can see what was reported.
- **Open author profile** — jumps to the author's seller profile.
- **Apply ban to author** — opens the 5-level ban picker (see below).

Status transitions:
- `pending` — just arrived, not yet reviewed
- `reviewed` — admin has looked at it
- `resolved` — admin took action (usually a ban)
- `dismissed` — admin decided no action needed

Rule of thumb: never leave a report in `pending` for more than 24h.
Even `dismissed` is better than `pending` because the dashboard stats
(top of screen) highlight pending count.

### 2. Apply bans — the 5-level ladder

Every ban requires a `reason`. The reason is shown to the user on
their `/pages/suspended` page and is the evidence we show on appeal.
Write it as if the banned user will read it — because they will.

| Level | Duration | Use for |
|---|---|---|
| **L1 Warning** | No time limit; just warning_count++ | First offense, borderline content. User sees a warning modal on next login, can keep using the app. |
| **L2** | 72 hours | Recurring minor offense, mild abuse, repeat spammer. Blocks posts / items / comments / messages during the window. |
| **L3** | 7 days | Deceptive listings (scam attempt), targeted harassment, obvious sockpuppet. Also triggers **shadow_banned** so their existing posts are hidden from others. |
| **L4** | 30 days | Serious abuse, confirmed scam with victim, CSAM-adjacent, repeat L3. Triggers shadow-ban + **auto-bans known alt accounts** sharing device fingerprints within 90 days. |
| **L5** | Permanent | CSAM, doxing, credible threats, admin compromise, multi-strike L4. Triggers shadow-ban + alt propagation. No automatic lift. |

### 3. Lift a suspension (handle appeals)

Appeals show up in the **Appeals** tab. Each card shows the original
ban reason, the user's appeal text, and issued-by info.

Click **Lift (accept appeal)** on a card to open a reason prompt.
Your lift-reason is also written to the audit log. Be specific:

- Good: `First-time offender, apologized, agreed to re-read guidelines`
- Good: `False positive — reporter bulk-reporting competitor listings`
- Bad: `ok` / `fixed` / blank

If you deny the appeal, just leave it alone. There's currently no
"deny appeal" action — the suspension stays active, and the user can
submit only one appeal per suspension (by design).

### 4. Monitor flagged users proactively

The **Flagged** tab shows users who are NOT currently banned but
have any of:
- `warning_count > 0`
- `shadow_banned = true`
- `suspension_level >= 2`

Sorted by warning_count DESC, trust_score ASC — so the most abused
accounts float to the top. Use this to pre-empt: if someone has
warning_count=3 and trust_score=12, one more offense should be an
L3, not another L1.

### 5. Read the audit log

**Audit log** tab shows every admin action + every server-blocked
publish attempt, newest first. Filter mentally by color:

- 🔴 red `ban_applied` — admin action
- 🟢 green `suspension_lifted` — admin action
- 🔵 blue `report_status_changed` — admin action
- 🟠 orange `actor_blocked` — server-side enforcement (user tried to
  post while banned and got rejected)

`actor_blocked` events are noise-free: they only fire when someone is
actively trying to abuse. A burst of them from one user is a strong
signal that they're probing the system for a workaround — consider
escalating their ban level.

---

## Decision tree: what level to ban at

```
First offense?
├── Borderline / ambiguous
│   └── L1 warning (let them recalibrate)
└── Clear-cut
    ├── Annoying (spam, low-quality)
    │   └── L2 (72h)
    ├── Harmful (scam, harassment)
    │   └── L3 (7d) + shadow-ban existing content
    └── Severe (CSAM, doxing, threats)
        └── L5 permanent

Repeat offense?
├── Was L1 → escalate to L2
├── Was L2 → escalate to L3
├── Was L3 → escalate to L4 (auto-bans alts)
└── Was L4 → L5 permanent
```

Tie-breakers when you're unsure:
- **Victim impact first**: a scam with one confirmed victim > 10 spam
  posts with no victim. L3 vs L2.
- **Intent matters**: a posts-and-deletes accidental rule violation
  doesn't need more than L1. A coordinated evasion attempt is L4.
- **When in doubt, go lower**: appeals are a safety valve. An over-
  ban that gets appealed is recoverable. An under-ban that emboldens
  a bad actor is not.

---

## Troubleshooting

### "Could not find the function public.X in the schema cache"

Something's out of sync. Run the relevant `RUN_*_MIGRATION.sql` bundle
again — each ends with `NOTIFY pgrst, 'reload schema'` which fixes the
cache.

### Gate unlock fails with "Wrong key"

Three causes in order of likelihood:
1. `ADMIN_API_KEY` on Vercel doesn't match what you're typing. Case-
   sensitive. Check Vercel env settings.
2. You set the env var but didn't redeploy. Edge functions don't
   pick up env changes until the next deploy.
3. You're hitting a cached old deploy. Hard-refresh the browser.

### `suspension_active:N:TS` error when user tries to post

This is the trigger working correctly. The user is banned and their
attempt was blocked. No action needed unless they complain — then
check their suspension detail, check the evidence, and either lift
or leave alone.

### Audit log shows `actor_blocked` bursts from one user

They're probing for a bypass. Consider:
- Raising their ban level (e.g. L2 → L3 so shadow_banned kicks in)
- Checking device_fingerprints for sockpuppets

### A ban was applied via `service_role` directly in SQL editor

The audit log shows it as actor_nickname=null / "system". That's fine
for now, but try to always go through the dashboard so your nickname
lands on the record. One-off SQL bans are sometimes necessary (bulk
cleanups) but they hurt audit forensics.

### Ban an alt that the system didn't auto-catch

L4 and L5 auto-ban known device_fingerprint siblings from the last
90 days. Older siblings don't get caught. For older alts, just ban
them manually through the dashboard — audit log will show it's your
action, not auto-propagation.

---

## Never do this

- **Don't commit `ADMIN_API_KEY` to git.** It lives only in Vercel env
  + your browser's localStorage. If it leaks, rotate it: generate a new
  one, update Vercel, redeploy, sign out + re-unlock the dashboard.
- **Don't share `ADMIN_API_KEY` over chat.** If someone else needs
  admin access, add them a separate key (not currently supported —
  would require rewriting the auth model). For now, rotate after the
  session if you ever share it.
- **Don't click "Open target" on a permanent-banned user's item.**
  The nav works fine, but your view counts as a "visit" and can
  inflate their item stats. Open in an incognito window if you need
  to verify evidence.
- **Don't apply L5 without screenshots.** The system is designed
  to be appealed. If the user appeals an L5 and you can't remember
  why, you'll be forced to reduce it. Save evidence before banning.
