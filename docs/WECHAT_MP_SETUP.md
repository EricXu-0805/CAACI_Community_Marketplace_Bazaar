# WeChat mini-program build — activation checklist

> **Release-candidate boundary (2026-07-19):** the repository can build an
> `mp-weixin` artifact, but this candidate has not been deployed to the current
> production schema or validated in WeChat DevTools/on a physical phone with the
> real domain allow-list, AppID secrets, Supabase keys, Storage, long-poll, or
> moderation providers. “Implemented” below means code/build coverage, not a
> production or real-device pass.

This app is built on uni-app, so `npm run build:mp-weixin` produces
a WeChat mp bundle at `app/dist/build/mp-weixin/`. But: shipping that
to WeChat's app review is a real amount of work. This doc captures
everything that is required beyond the code, in order.

## Status at a glance

| Piece | Status | Notes |
|---|---|---|
| REST calls (auth, items, posts, messages, rpc) | Candidate implementation; real provider pending | `app/src/utils/mpFetch.ts` |
| `uni.request` timeout + abort | Candidate boundary-tested | 25 s timeout, AbortSignal wired; real weak-network test pending |
| Image upload (`chooseImage`, compress, upload) | Candidate implementation; real Storage/device pending | needs `requiredPrivateInfos` (already in manifest) |
| File picker (`chooseMedia`) | Candidate implementation; real device pending | ditto |
| Supabase Realtime (chat websocket) | Candidate long-poll/direct-poll fallback; real latency pending | See §3 — `useRealtimeFallback.ts` 3-tier strategy |
| Deep-linking via `#/...` routes | Replace with `uni.navigateTo` only | no `window.location.hash` on mp |
| `fetch`/`WebSocket`/`navigator` | Use uni.* | `mpFetch` handles fetch; see §3 for WebSocket |
| OpenAI proxies (`/api/moderate`, `/api/translate`) | Candidate authenticated routes; provider/allow-list pending | needs domain allow-list and real user JWT |

## 1. Register a WeChat mini-program

1. Go to <https://mp.weixin.qq.com/> and register a new mini-program
   (小程序). You need a real organization or an individual account
   with WeChat Pay linked.
2. Copy the `AppID` (looks like `wxabcdef0123456789`).
3. Paste it into `app/src/manifest.json` → `mp-weixin.appid`.
4. Install the official WeChat DevTools (微信开发者工具):
   <https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html>

## 2. Domain allow-list

WeChat mp enforces a strict per-AppID allow-list for all outbound
network calls. Your production build will refuse requests to any
domain not on this list. During dev you can tick "不校验合法域名"
in DevTools to skip this, which is why `manifest.json` has
`setting.urlCheck = false` — but this flag is disabled automatically
for release builds.

Log into <https://mp.weixin.qq.com/> → 开发管理 → 开发设置 → 服务器域名,
then add:

**request 合法域名 (HTTPS only):**
- `https://lfhvgprfphyfvhidegum.supabase.co`   — Supabase REST + Auth
- `https://illinimarket.com`  — our /api/moderate, /api/translate

**socket 合法域名 (WSS only):**
- `wss://lfhvgprfphyfvhidegum.supabase.co`  — Supabase Realtime
  (only needed once §3 polling fallback is replaced with a real
  WebSocket adapter)

**uploadFile 合法域名:**
- `https://lfhvgprfphyfvhidegum.supabase.co`  — Supabase Storage direct upload

**downloadFile 合法域名:**
- `https://lfhvgprfphyfvhidegum.supabase.co`  — Supabase Storage GET

WeChat takes ~5 minutes to propagate the allow-list.

## 3. Supabase Realtime (chat websocket) — polling fallback

The supabase-js realtime client uses Phoenix channels over a single
WebSocket. WeChat mp has `wx.connectSocket` but it **does not round-trip
cleanly** through Phoenix's handshake. Symptom: the channel subscribes,
but `broadcast` and `postgres_changes` events never fire.

**Implemented in the candidate** by a 3-tier strategy in
`app/src/composables/useRealtimeFallback.ts`. The latency figures are design
targets; validate them with the migrated staging schema, real credentials and a
physical phone before calling this resolved:

| Platform | Path | Latency |
|---|---|---|
| H5 | `supabase.channel(...)` (Phoenix over WebSocket) | <200 ms |
| mp + long-poll OK | `GET /api/realtime-poll?scope=...&id=...&since=...` | ~1 s |
| mp + long-poll 5xx'd | Direct PostgREST `GET /rest/v1/messages` every 3 s | 3 s |

Long-poll protocol:
1. Client opens `GET /api/realtime-poll?scope=conversation&id=X&since=CURSOR`
   with its Supabase JWT in the Authorization header.
2. Edge function (`api/realtime-poll.js`) tight-polls Supabase every
   800 ms internally, held up to 20 s (under Vercel's 25 s edge cap).
3. Returns `{rows:[…], next_since: "ISO|UUID"}` on first hit, or
   `{rows:[]}` on timeout.
4. Client immediately re-opens with the new cursor.

Security:
- Message reads forward the caller's JWT with the publishable key; they never
  use privileged credentials. RLS on `public.messages` therefore evaluates
  against the real user, so a participant in conversation A cannot long-poll
  conversation B.
- The separate amplification limiter is a privileged RPC and uses
  `SUPABASE_SECRET_KEY` (temporary legacy `SUPABASE_SERVICE_ROLE_KEY`
  fallback). The route also needs `SUPABASE_PUBLISHABLE_KEY` (temporary legacy
  `SUPABASE_ANON_KEY` fallback) and `SUPABASE_URL`. An unavailable limiter
  fails closed before polling messages.

Circuit breaker: if long-poll returns 5xx / throws / aborts twice in a
row the client falls back to direct 3s PostgREST polling for the rest
of that session. Prevents a broken edge deploy from blocking chat.

Call sites (platform-agnostic):
- `useMessages.subscribeToMessages()`
- `useUnread.startListening()`

Cursor strategy: use the lexicographic `(created_at,id)` key of the last row.
The composite cursor prevents rows from being lost when more than one page has
the same server timestamp. Timestamp-only cursors remain accepted during a
rolling upgrade; the first successful response advances them to `ISO|UUID`.

## 4. Page-to-tabBar mismatch

`pages.json` declares a `tabBar`; the Plaza and Publish routes use only the
cross-platform subset currently supported by the release candidate:

- **Plaza**: public posts are text plus up to four canonical local images.
  Public chat is text-only until a private chat-media bucket and signed-delivery
  path exist. Do not re-introduce public video/media URLs as a Mini Program
  workaround; the database write boundary rejects them.
- **Publish**: `uni.chooseImage` works. Image compression in
  `utils/index.ts::compressImage` already has the correct dual
  branch — H5 uses canvas + toDataURL, non-H5 uses `uni.compressImage`
  with the same signature. ✅ Done in `src/utils/index.ts:610`.

### tabBar icons

`pages.json` currently declares `tabBar.list` with text only and no
`iconPath` / `selectedIconPath`. This is LEGAL on mp — tabs render
as text-only — but reviewers and users expect icons. When you add
them, use 81×81 PNGs (standard mp dimensions) and put them under
`src/static/tab/` since `src/static/*` is the only folder uni-app
ships verbatim to the mp bundle.

## 5. Build commands

```bash
# Dev — opens DevTools automatically if set up
npm run dev:mp-weixin

# Production
npm run build:mp-weixin
# Output: app/dist/build/mp-weixin/
# Then: File → Open in WeChat DevTools → upload for review
```

## 6. What won't work on mp (list for honesty)

- **Anything using `window.*`, `document.*`, `fetch` directly.**
  `mpFetch` handles Supabase; if you add more direct `fetch()` calls,
  wrap them with `platformFetch` from `useSupabase.ts`.
- **Realtime pushes in chat** (see §3).
- **Service workers / push notifications** — use `wx.subscribeMessage` instead.
- **`BarcodeDetector`** (used for client-side QR code detection in
  moderation). Need to fall back to `wx.scanCode` or server-side detection.
- **OpenAI moderation from mp**: the candidate calls the authenticated
  `/api/moderate` route. It still needs `illinimarket.com` in the request
  allow-list, a real user JWT, provider configuration, and DevTools/phone
  verification (§2).
- **Deep links** — use `uni.navigateTo({ url: '/pages/...' })` not
  location-hash routing.

## 7. Submission checklist (when you're ready)

- [x] `appid` filled in `manifest.json` (`wxc3da81aa8852a6ff`)
- [ ] All four domain lists populated on mp.weixin.qq.com
- [ ] `setting.urlCheck` left as `false` in manifest (the real
      check happens server-side during upload)
- [x] `requiredPrivateInfos` includes every API you actually call
      (chooseImage, chooseMedia — see manifest.json)
- [ ] Tested on a physical phone via DevTools → 真机调试
- [ ] Privacy agreement page (§3 of our Privacy Policy already
      covers this — point the mp privacy section at /pages/legal)
- [ ] Operator info / ICP beian filed (required for any mp used
      by people in mainland China)
- [ ] §8 below: WECHAT_APPID + WECHAT_APPSECRET + SUPABASE_URL +
      SUPABASE_SECRET_KEY + SUPABASE_PUBLISHABLE_KEY set on Vercel (keep the
      legacy service_role/anon aliases only during the rolling migration;
      required for wx.login to function at all)

Allow ~3–5 business days for WeChat's first review.

## 8. wx.login silent sign-in — deployment guide

Scaffolding: migration 034 (`034_wechat_auth_support.sql`) + the atomic
`edge_rate_hit` migration + edge route
(`api/auth/wechat-login.js`) + front-end (`composables/useAuth.ts`
`signInWithWeChat()`, button in `pages/login/index.vue`). The current route is
passwordless: it never derives, stores, retrieves, or submits a reusable
plaintext password. Landing the code is not enough — provision the server
configuration and apply the database prerequisites first.

### 8.1 Apply the database prerequisites

Do **not** run a blind `supabase db push` on the existing project. Its migration
ledger and live objects are known to have drifted, and the repository retains
historical 014/015 version collisions. A new environment applies the complete
ordered migration history through the reviewed bootstrap path. An existing
environment must first inventory the ledger and exact definitions, run the
release PRECHECKs, rehearse in staging, and then apply only the reviewed unique
timestamped migration tail followed by VERIFY/REGRESSION. Migration 034 and the
atomic `edge_rate_hit` capability are prerequisites, but a filename in the
repository is not proof that the matching production definition is current.

This is additive only:
- `profiles.wechat_unionid TEXT UNIQUE` column (used by the edge route)
- `public.edge_rate_hit(text, integer, integer)`, executable only by
  `service_role`, for atomic pre-WeChat and post-openid abuse limits
- profile RLS/grants that keep `wechat_openid` and `wechat_unionid` out of
  public profile reads

`upsert_wechat_user` is a historical RPC and is not used by the current route.
Do not grant it to browser roles as a shortcut around the route's identity
checks.

### 8.2 Provision five environment-scoped vars on Vercel

Project Settings → Environment Variables: Production gets production values
only. A trusted, allowlisted Preview gets a separate staging WeChat app,
staging Supabase project, and separately revocable staging secrets. Never expose
production `WECHAT_APPSECRET` or a production Supabase secret key to arbitrary
branch/PR Preview code; untrusted previews must run without privileged routes.

| Name | Value source | Guard-rails |
|---|---|---|
| `WECHAT_APPID` | mp.weixin.qq.com → 开发管理 → 开发设置 → AppID | Same value already in `src/manifest.json` — OK to bundle either side. |
| `WECHAT_APPSECRET` | Read the environment-specific approved value from the team's access-controlled secret manager | **SERVER ONLY.** Production and staging use different apps/secrets. Do not click “重置” during ordinary setup. Reset only in an approved, coordinated rotation window that updates that environment's consumers and verifies rollback/recovery; every reset invalidates the previous value. |
| `SUPABASE_PUBLISHABLE_KEY` | Supabase Dashboard → Settings → API Keys → publishable key | Public component key used by the route. The app uses the same value in `VITE_SUPABASE_PUBLISHABLE_KEY`. `SUPABASE_ANON_KEY` remains a rolling fallback for old deployments. |
| `SUPABASE_URL` | Supabase project URL | Server alias; must be an HTTPS origin with no path/query/credentials. |
| `SUPABASE_SECRET_KEY` | The matching environment's Supabase project → Settings → API Keys → a named secret key | **SERVER ONLY.** Production scope points only to production; trusted Preview points only to isolated staging. Used for Auth generate-link and conditional identity binding; sent in `apikey` only. `SUPABASE_SERVICE_ROLE_KEY` remains the same-environment rolling legacy fallback. Complete the real-provider matrix before disabling it. |

`VITE_*` values are not a substitute for the server-only service key. We do
not require `SUPABASE_JWT_SECRET` or `WECHAT_USER_PASSWORD_SALT`. The route
asks GoTrue to generate a one-time magic-link token hash, exchanges that hash
at `/auth/v1/verify`, and returns only the resulting bounded session fields.
GoTrue remains the sole JWT issuer.

Do not paste `sb_publishable_...` into the legacy anon variable or
`sb_secret_...` into the legacy service-role variable as a shortcut. New
component keys are not drop-in JWT replacements; use the new variable names
and the reviewed header semantics, then keep old and new deployments additive
until the real-provider/client matrix passes.

After setting the staging variables, include them in the next reviewed staging
deployment and run the provider matrix before any production window. Do not
push an empty commit or click an ad-hoc production “Redeploy” merely to pick up
configuration; environment changes do not affect an already-running deployment,
so configuration and artifact promotion must stay in the same approved release.

The route deliberately has no unauthenticated configuration/readiness oracle:

```bash
curl -i https://illinimarket.com/api/auth/wechat-login
```

Expect `405 method_not_allowed`. Verify readiness with a temporary WeChat
preview account and server logs keyed by the non-sensitive `X-Request-Id`.
Logs intentionally omit js_code, openid, unionid, email, token, upstream URL,
and response body.

### 8.3 Add domain to mp.weixin.qq.com allow-list

§2 lists the four domain categories. Adding `/api/auth/wechat-login`
needs:

- **request 合法域名**: `https://illinimarket.com`
  (already required for /api/moderate and /api/translate)

No new entry needed — the domain is shared with existing endpoints.

### 8.4 Test in WeChat DevTools

```bash
npm run build:mp-weixin
# DevTools → Import project → app/dist/build/mp-weixin/
# 详情 → 本地设置 → 勾 "不校验合法域名" (dev only)
# Click login page → "微信一键登录" button
```

Expected happy path:
1. Click "微信一键登录" → DevTools simulates wx.login and returns a code
2. Edge function exchanges code → openid (if AppSecret is wrong or
   code is fake, you'll see `wechat_exchange_failed` and a `wxErrcode`
   — look it up in the [WeChat error code table][wxerr])
3. Admin `generate_link(type=magiclink)` creates or reuses the hidden
   `wx_<openid>@wechat.placeholder` Auth user; `/auth/v1/verify` exchanges the
   one-time token hash for a GoTrue session; no email is sent
4. A compare-and-set profile update binds the openid/unionid only if the row is
   still unbound; a conflicting identity fails closed instead of overwriting it
5. Page reLaunches to home; in Supabase table editor, look for a row
   in profiles with `wechat_openid = o<something>` matching the
   DevTools openid

[wxerr]: https://developers.weixin.qq.com/miniprogram/dev/framework/server-ability/backend-api.html

### 8.5 Current limits and required real-device checks

- **No account linking.** An email user who later signs in with
  WeChat will get a SEPARATE profile row. No UX to merge them
  yet. Short-term workaround: force users to pick one identity
  per device. Long-term: add a settings page action "bind WeChat
  to this account" that sends the js_code along with the current
  email session JWT, and have the edge function merge if and only
  if the email session matches.
- **No user profile fetch from WeChat.** We accept `nickname` and
  `avatar_url` from the client, but the client has to call
  `wx.getUserProfile` first and pass them in. The current login
  button does not do this — it just wx.logins for openid. Add
  nickname/avatar capture to the button if you want prefilled
  profiles.
- **Placeholder email compatibility.** Existing identities keep the historical
  `wx_<openid>@wechat.placeholder` mapping. Email normalization means two
  openids differing only by case would collide; the route rejects identity
  mismatches, and the retirement script blocks on such a collision.
- **A simulator is not acceptance evidence.** Before enabling production,
  use a temporary real mini-program account to test first login, repeat login,
  two simultaneous first-login requests, expired/replayed js_code, logout and
  relogin, and a pre-bound conflicting profile. Confirm no identity overwrite.
- **Rate limits are fail-closed.** A missing/broken `edge_rate_hit` returns 503
  before WeChat or GoTrue. This is intentional, not a fallback-login failure.

### 8.6 Why GoTrue issues the session

The v1 skeleton (commit 5b7223a, superseded by b6ea34a cleanup)
signed its own HS256 JWTs using the project's JWT secret. That
architecture has one narrow weakness and one fatal future-proof
problem:

1. **Supabase migrated to asymmetric JWT Signing Keys (ES256)** in
   2024-2025. On projects that went through the migration (like
   this one — `caaci-marketplace` rotated Oct 2025), the "Current
   key" is ECC P-256 and the "Legacy HS256" is kept alive only for
   verifying previously-issued tokens. Third parties cannot extract
   the ES256 private key; Supabase intentionally blocks this.

2. **HS256 minting still works today** because the Legacy key stays
   trusted for verification. But a single "Revoke" click on the
   Legacy key in the dashboard instantly kills every HS256-minted
   token. That's a loaded footgun.

The current passwordless Admin generate-link + verify approach bypasses the
entire signing problem: GoTrue itself issues the session token, signs it with
whatever key is current, and gives us back `{ access_token, refresh_token,
user }`.
We never hold a signing key. Works the same on HS256, ES256, or any
future algorithm Supabase introduces.

Citations: <https://supabase.com/docs/guides/auth/signing-keys>,
<https://supabase.com/docs/guides/auth/jwts#using-custom-or-third-party-jwts>.

### 8.7 Retire credentials from an upgraded password-era deployment

Fresh deployments can skip this section. If production ever ran migration 035
and the password-based WeChat route, switching code does **not** invalidate the
old plaintext map or the corresponding Auth passwords. Use this order:

1. Deploy the passwordless route first. In Preview, complete the real-account
   checks from §8.5 and confirm the old route is no longer receiving traffic.
2. Inventory only (the default is non-mutating):

   ```bash
   export SUPABASE_URL=https://<project>.supabase.co
   export SUPABASE_SECRET_KEY=<sb-secret-key>
   node scripts/retire-wechat-passwords.mjs
   ```

3. Review counts and backups/incident implications. Then explicitly rotate
   every matching Auth password and remove every legacy map row:

   ```bash
   node scripts/retire-wechat-passwords.mjs \
     --apply --confirm RETIRE_WECHAT_PASSWORDS
   ```

   The script never selects the plaintext password column. It inventories the
   entire map and Auth roster, blocks case collisions or profile/Auth identity
   mismatches, rotates all matching users before the first map deletion, and
   verifies the map is empty. A failed rotation stops all deletion.

4. Apply `20260718140000_retire_wechat_password_credentials.sql` and its VERIFY
   script. The migration refuses to run while any map row remains, revokes
   legacy SELECT/INSERT/UPDATE and RPC EXECUTE access, but retains service-role
   DELETE compatibility for the account-deletion saga. Drop the table/functions
   only after that saga no longer references them.

Do this first with a disposable project/account. Password rotation may affect
existing sessions or trigger security notifications depending on current Auth
settings; verify those effects before touching the full roster.
