# 微信小程序上线与验收

> **2026-09-14 更新。** 当前已在微信开发者工具 RC 2.02.2607161 / 基础库 3.17.2
> 运行生产公开商品的首页、详情和登录引导，并检查 iPhone/iPad 模拟尺寸。
> 这不是已上传体验版、真机双账号闭环或微信审核通过。最新完整证据见
> [本轮跨平台报告](audit/2026-09-14-platform-readiness.md)。

## 1. 当前范围

首版使用同一套商品、广场、账号与聊天服务。小程序只显示**邮箱/密码登录**；
Google 登录只在 H5 显示，微信快捷登录保持关闭，后文 §8 是未来激活手册。
聊天使用经过鉴权的长轮询与直接查询降级；不能承诺原生后台消息推送或即时送达。
`app-plus` 模板也不代表已有可以提交 App Store / Google Play 的原生安装包。

| 项目 | 当前证据 | 上线前还需什么 |
|---|---|---|
| 启动、公开商品、图片、详情、登录表单 | 开发者工具实际运行；WXSS 官方编译器与产物运行检查 | 同版本体验版真机复验 |
| iPad 导航 | 本轮发现宽屏错误隐藏导航并修复；模拟器复验 | 真机横竖屏、微信分屏 |
| 邮箱登录、上传、发商品、私信 | 共用代码与自动化覆盖；没有本轮微信真实账号闭环 | 两个获授权测试账号完成一次完整交易沟通流程 |
| 相册 | 失败/拒绝权限/取消会保留表单，真实组件模拟回归 | 系统相册、HEIC、权限拒绝后恢复、iOS 有限照片权限 |
| 发布、聊天安全 | 账号隔离、服务端校验、举报/屏蔽、受限媒体 URL | 托管审核服务自然运行、微信审核方要求与后台配置 |
| 账号主体、服务类目、备案、合法域名、隐私声明 | 未读取账号后台，不可勾选完成 | 运营者在微信后台核实并保留回执 |

## 2. 服务器域名与构建配置

`mp-weixin.appid` 当前为 `wxc3da81aa8852a6ff`；`setting.urlCheck` 必须保持 **true**。
构建检查要求真实 AppID 格式、合法 HTTPS 接口 origin、包体预算、全部页面入口和
媒体/请求运行时边界。不要用“不校验合法域名”掩盖正式包的问题。

在该 AppID 的「开发管理 → 开发设置 → 服务器域名」核实以下**实际使用域名**：

| 类型 | 当前候选需要的域名 | 用途 |
|---|---|---|
| request | `https://lfhvgprfphyfvhidegum.supabase.co` | Auth、REST、RPC |
| request | `https://www.illinimarket.com` | 鉴权后的 `/api/*`，包括审核、翻译和长轮询 |
| uploadFile / downloadFile | `https://lfhvgprfphyfvhidegum.supabase.co` | 商品和头像图片；仍需体验版验证实际上传传输方式 |
| socket | 当前轮询方案不据此宣称 WebSocket 可用 | 将来启用 `wx.connectSocket` 适配时再核对 WSS 域名并实测 |

`https://illinimarket.com` 会跳转到 www；小程序 API 构建直接使用 www，避免把
重定向域名当成最终请求域名。staging 必须使用独立构建配置及对应测试域名。
后台是否接受这些域名、其备案/证书要求和当前 AppID 的配额，以真实后台结果为准；
本轮后台被工具站点安全策略阻止访问，尚未修改任何后台设置。

## 3. 聊天与容量

H5 优先使用 Supabase Realtime；小程序使用 `useRealtimeFallback.ts` 的鉴权轮询。
`api/realtime-poll.js` 按约 800ms 查询、单次最多约 20s；客户端失败后退到约 3s 的
直接查询。前台恢复、会话切换、重复发送和响应丢失都有回归测试，延迟仍取决于
网络和托管负载。真实用户容量必须覆盖活跃聊天、长轮询连接、上传和后台任务。

商品搜索在上轮 staging 的 10,001 条数据压力测试中仍出现复杂搜索超时。
不能将普通商品列表的短时并发成功外推成整个平台容量验收。

## 4. 隐私与系统能力

源码启用 `__usePrivacyCheck__: true`，但这只是启用平台机制。
运营者仍需在后台发布与实际收集行为一致的《用户隐私保护指引》，核实照片用途、
用户内容、联系方式、第三方处理者和数据删除入口，并验证拒绝后仍可浏览。
不要把所有相册 API 都写进 `requiredPrivateInfos`；按当前微信后台/API 文档的适用
字段逐项声明。当前首页/发布页的小程序不调用 H5 的浏览器 GPS 按钮。

小程序使用有图标的 `CustomTabBar.vue`，原生 tab bar 被隐藏；平板也必须保留
这条导航，因为 `AppSidebar` 是 H5 专用。不要根据 `pages.json` 的原生文字项误判
产品缺图标，也不要在未验证 WXSS 的情况下直接复用桌面 CSS。

## 5. 构建与检查

在 `app/` 内使用 Node 22 和已配置的公开 Supabase 客户端环境变量：

```bash
VITE_BASE_URL=https://www.illinimarket.com npm run build:mp-weixin
node ../scripts/verify-build-artifact.mjs dist/build/mp-weixin none
```

开发者工具导入 `app/dist/build/mp-weixin/`。当前检查采用主包/每个分包 2 MiB 的
保守原始文件预算，最终上传体积和平台规则仍以开发者工具为准。CI 和本地 push
都会运行产物检查；普通编译成功不再被当成 WXSS/运行时正确的充分证据。

## 6. 体验版验收步骤

1. 首页 → 搜索/筛选 → 商品详情 → 联系卖家 → 登录 → 返回原商品/会话。
2. 发布商品：取消相册、拒绝权限、多图、换封面、预览、断网重试、保存后编辑。
3. 两个测试账号完成消息、报价、约见、拒绝/改约、后台恢复；第三账号不能读写会话。
4. iPhone 与 iPad 原生中文输入法、联想词、emoji、横竖屏、相册权限恢复。
5. 举报/屏蔽、内容处理、账号注销、数据删除与用户反馈由运营者完成实际闭环。
6. 有真实来源的截图/记录写入验收表；合成数据、模拟器和真机分别标注。

## 7. 提审门槛

- [x] 源码 AppID 已设置，合法域名校验开启。
- [x] 本轮修复：WXSS 白屏、Web API 全局变量、H5 路由误调用、平板导航隐藏。
- [ ] 正确账号主体、服务类目、对应资质和所适用备案；不得凭“校园项目”推断豁免。
- [ ] 微信后台服务器域名、隐私声明已发布并有回执。
- [ ] 体验版真实登录、商品上传、聊天、审核服务与拒绝授权闭环。
- [ ] 两台实体设备（含 iPad）完成关键输入和相册场景。
- [ ] 容量与恢复风险有可接受的发布范围；大规模开放前补齐真实混合负载和整库恢复。
- [ ] 版本说明、截图、客服/支持入口、审核测试账号按后台要求备齐；上传、提审、审核
      通过与正式发布分别留证，不能把其中一步当作全部完成。

参考：微信开发者工具内的实际校验；[腾讯云小程序发布文档](https://docs.cloudbase.net/lowcode/app/mp)
的包体说明；[工信部 APP 备案解读](https://www.miit.gov.cn/zwgk/zcjd/art/2023/art_39b4f1acc36745b98478e0ec3e07128d.html)。
备案适用性与具体类目以该账号主体/服务范围及微信后台核实结果为准。

## 8. wx.login silent sign-in — deployment guide

> **首版状态（2026-08-01）**：本节是兼容与未来激活手册，不是当前发布步骤。
> 首版小程序只显示邮箱/密码，微信快捷登录入口隐藏；H5 的 Google OAuth 也不
> 出现在小程序。保留现有 API、旧账号注销和凭据退役代码，但在完成身份冲突、
> 找回、provider 与真机 canary 前不得重新暴露按钮或启用生产微信登录。
> `WECHAT_LOGIN_ENABLED` 必须保持缺失/false；即使内容安全共用了 AppID/secret，
> 直接 POST 登录路由也只返回 404，不能据此激活身份登录。

Scaffolding: migration 034 (`034_wechat_auth_support.sql`) + the atomic
`edge_rate_hit` migration + edge route
(`api/auth/wechat-login.js`) + front-end (`composables/useAuth.ts`
`signInWithWeChat()`, button in `pages/login/index.vue`). The current route is
passwordless: it never derives, stores, retrieves, or submits a reusable
plaintext password. Landing the code is not enough — provision the server
configuration and apply the database prerequisites first. Future activation
also requires the independent server-only `WECHAT_LOGIN_ENABLED=true`; do not
reuse `WECHAT_MEDIA_ASYNC_ENABLED` or infer login readiness from shared
content-safety credentials.

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

### 8.2 Provision login/text vars; keep media async off by default

Project Settings → Environment Variables: Production gets production values
only. A trusted, allowlisted Preview gets a separate staging WeChat app,
staging Supabase project, and separately revocable staging secrets. Never expose
production `WECHAT_APPSECRET` or a production Supabase secret key to arbitrary
branch/PR Preview code; untrusted previews must run without privileged routes.

| Name | Value source | Guard-rails |
|---|---|---|
| `WECHAT_LOGIN_ENABLED` | Deliberate release approval, not a provider credential | **SERVER ONLY, non-secret.** Keep absent/false in the first release. Only the exact string `true` enables the dormant identity route after its own staging/provider/account-recovery canary. Never reuse the media switch. |
| `WECHAT_APPID` | mp.weixin.qq.com → 开发管理 → 开发设置 → AppID | Same value already in `src/manifest.json` — OK to bundle either side. |
| `WECHAT_APPSECRET` | Read the environment-specific approved value from the team's access-controlled secret manager | **SERVER ONLY.** Production and staging use different apps/secrets. Do not click “重置” during ordinary setup. Reset only in an approved, coordinated rotation window that updates that environment's consumers and verifies rollback/recovery; every reset invalidates the previous value. |
| `WECHAT_PUSH_TOKEN` | mp.weixin.qq.com → 开发管理 → 开发设置 → 消息推送配置 → Token | **SERVER ONLY.** Use a separate random value per environment. It authenticates both the GET handshake and the encrypted POST `msg_signature`; never log or browser-prefix it. |
| `WECHAT_ENCODING_AES_KEY` | The exact 43-character EncodingAESKey in the matching environment's 消息推送配置 | **SERVER ONLY.** Do not regenerate or rotate it independently of the WeChat console. The callback Base64-decodes it to a 32-byte AES key and verifies the decrypted trailing AppID. |
| `SUPABASE_PUBLISHABLE_KEY` | Supabase Dashboard → Settings → API Keys → publishable key | Public component key used by the route. The app uses the same value in `VITE_SUPABASE_PUBLISHABLE_KEY`. `SUPABASE_ANON_KEY` remains a rolling fallback for old deployments. |
| `SUPABASE_URL` | Supabase project URL | Server alias; must be an HTTPS origin with no path/query/credentials. |
| `SUPABASE_SECRET_KEY` | The matching environment's Supabase project → Settings → API Keys → a named secret key | **SERVER ONLY.** Production scope points only to production; trusted Preview points only to isolated staging. Used for Auth generate-link and conditional identity binding; sent in `apikey` only. `SUPABASE_SERVICE_ROLE_KEY` remains the same-environment rolling legacy fallback. Complete the real-provider matrix before disabling it. |

`WECHAT_MEDIA_ASYNC_ENABLED` is a separate, optional production gate. Leave it
absent or anything other than the exact string `true` until the console is in
**安全模式** and the real-provider canary below passes. This blocks only image `media_check_async` enqueueing with
`wechat_media_async_disabled`, and makes callback POST return 503 before body,
database or Storage work; it does not disable the signed GET handshake,
wx.login or synchronous text checks that still require `WECHAT_APPSECRET`.
When the flag is `true`, image enqueue additionally requires a valid AppID,
push token and EncodingAESKey; a missing/malformed value returns
`wechat_media_async_misconfigured` before calling WeChat. The callback accepts
only `encrypt_type=aes`, verifies `msg_signature`, decrypts JSON or XML
`Encrypt` with AES-256-CBC/K=32 PKCS#7, and compares the decrypted trailing AppID
before any database or Storage work. A plaintext POST, or a compatibility-mode
envelope carrying extra plaintext event fields, is 403 with no side effect. Set
the flag to `true` only after a real-provider retry canary proves the deployed
environment and cross-signature idempotency. Never remove `WECHAT_APPSECRET` as
a workaround for callback risk.

Protocol source: WeChat's official [消息推送](https://developers.weixin.qq.com/miniprogram/dev/framework/server-ability/message-push.html)
and [多媒体内容安全识别](https://developers.weixin.qq.com/miniprogram/dev/server/API/sec-center/sec-check/api_mediacheckasync.html)
documentation. In the console choose 安全模式, not 明文模式 or 兼容模式; choose
the JSON or XML body format you will exercise in the environment canary.

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

- **request 合法域名**: `https://www.illinimarket.com`
  (already required for /api/moderate and /api/translate)

No new entry needed — the domain is shared with existing endpoints.

### 8.4 Future activation test in WeChat DevTools

```bash
npm run build:mp-weixin
# DevTools → Import project → app/dist/build/mp-weixin/
# 详情 → 本地设置：保持合法域名校验；关闭校验的本地运行不能作为验收证据
# Current first-release acceptance: login page has email/password and no
# WeChat/Google button. The steps below apply only to a separately approved
# future build that deliberately re-enables WeChat identity.
```

Future re-enable happy path:
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
