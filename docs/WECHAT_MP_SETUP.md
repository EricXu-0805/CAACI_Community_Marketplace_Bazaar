# WeChat mini-program build — activation checklist

This app is built on uni-app, so `npm run build:mp-weixin` produces
a WeChat mp bundle at `app/dist/build/mp-weixin/`. But: shipping that
to WeChat's app review is a real amount of work. This doc captures
everything that is required beyond the code, in order.

## Status at a glance

| Piece | Status | Notes |
|---|---|---|
| REST calls (auth, items, posts, messages, rpc) | Working via `mpFetch` shim | `app/src/utils/mpFetch.ts` |
| `uni.request` timeout + abort | Working | 25 s timeout, AbortSignal wired |
| Image upload (`chooseImage`, compress, upload) | Working | needs `requiredPrivateInfos` (already in manifest) |
| File picker (`chooseMedia`) | Working | ditto |
| Supabase Realtime (chat websocket) | Polling fallback active on mp | See §3 — `useRealtimeFallback.ts` auto-switches |
| Deep-linking via `#/...` routes | Replace with `uni.navigateTo` only | no `window.location.hash` on mp |
| `fetch`/`WebSocket`/`navigator` | Use uni.* | `mpFetch` handles fetch; see §3 for WebSocket |
| OpenAI proxies (`/api/moderate`, `/api/translate`) | Work — hosted on Vercel, reachable via uni.request | needs domain allow-list |

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
- `https://caaci-community-marketplace-bazaar.vercel.app`  — our /api/moderate, /api/translate

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

**Resolved** by `app/src/composables/useRealtimeFallback.ts`:

- Exports `subscribeToConversation(id, cb)` and `subscribeToUserInbox(userId, cb)`.
- On H5 returns a real Supabase channel (existing behavior).
- On every mp target returns a polling loop with identical
  `(subscribe, unsubscribe)` ergonomics — so call sites stay
  platform-agnostic.
- Cadence: per-conversation = 3 s, user-wide inbox = 10 s.
- Cursor strategy: remembers the last row's `created_at` and asks for
  rows newer than that. `created_at` is a monotonic server clock, so
  this is simpler and safer than tracking uuids.
- Errors are swallowed per tick (offline periods don't spam logs).
- Pages sleep in mp when backgrounded, so polling auto-pauses.

Call sites already migrated:
- `useMessages.subscribeToMessages()` → delegates to fallback
- `useUnread.startListening()` → delegates to fallback

Potential upgrade path (not done; probably not worth it):
write a Vercel edge function that long-polls Supabase server-side and
streams events to the mp client via HTTP. More work, less polling
cost, but at current traffic the 3–10 s tick is invisible.

## 4. Page-to-tabBar mismatch

`pages.json` declares a `tabBar` but `pages/plaza/index.vue` and
`pages/publish/index.vue` in that tabBar rely on features not
available on mp:

- **Plaza**: works; just make sure any `<video>` tags have posters
  because mp video autoplay requires user interaction.
- **Publish**: `uni.chooseImage` works, but the image compression
  path in `utils/compressImage` currently branches on
  `#ifdef H5` only. Need an `#ifdef MP-WEIXIN` branch that uses
  `wx.compressImage` instead. **Not done yet.**

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
- **OpenAI moderation from mp**: works via `/api/moderate`, just make
  sure `caaci-community-marketplace-bazaar.vercel.app` is in the
  request allow-list (§2).
- **Deep links** — use `uni.navigateTo({ url: '/pages/...' })` not
  location-hash routing.

## 7. Submission checklist (when you're ready)

- [ ] `appid` filled in `manifest.json`
- [ ] All four domain lists populated on mp.weixin.qq.com
- [ ] `setting.urlCheck` left as `false` in manifest (the real
      check happens server-side during upload)
- [ ] `requiredPrivateInfos` includes every API you actually call
      (chooseImage, chooseMedia, getLocation if used)
- [ ] Tested on a physical phone via DevTools → 真机调试
- [ ] Privacy agreement page (§3 of our Privacy Policy already
      covers this — point the mp privacy section at /pages/legal)
- [ ] Operator info / ICP beian filed (required for any mp used
      by people in mainland China)

Allow ~3–5 business days for WeChat's first review.
