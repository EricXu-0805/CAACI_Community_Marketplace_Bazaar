# ENGINEERING：玉米地的系统事实与数据合同

写于 2026-11-12（America/Chicago），作者：V5 方案编写会话（Claude，在 Eric 的 Mac 上运行，只读源码）。

证据标签（定义见 [README.md](README.md)）：本文件没有另注的事实都是 [源码 7b18f20]，即 Illini main `7b18f2052e52a4268c25407d0584748477cbf978`；标 [源码 005ca9d] 的来自 PR #369 候选分支；标 [源码 caaciorg@f62f62f] 的来自官网仓库。以「判断：」开头的句子是工程判断，不是事实。「Illini Market」在本文件里只指现有代码、部署和改名任务。「仓库 RUNBOOK.md」「仓库 README.md」指 Illini 仓库根目录的两个文件；V5 自己的 RUNBOOK、README 一律写成链接。

本文件管：数据归属、可复用模块、改名与域名的技术清单、地区字段、各批次数据库变更、客户端读写合同、兼容矩阵、活动接入合同、法律底座的技术部分、迁移与发布规程的出处、CI 解读、事实缺口。界面文案在 [SPEC.md](SPEC.md)，任务编号与 DoD 在 [BACKLOG.md](BACKLOG.md)，当前 CI 结果和计数在 [STATUS.md](STATUS.md)，命令步骤在 [RUNBOOK.md](RUNBOOK.md)，决定与理由在 [DECISIONS.md](DECISIONS.md)。

---

## 1. 数据归属（全文只此一张）

| 数据 | 唯一来源 | 玉米地怎么用 | 玉米地不做 |
|---|---|---|---|
| 账号与资料 | Illini Supabase `auth.users` + `public.profiles`（生产 `lfhvgprfphyfvhidegum`，测试 staging-smoke `hygkwxugskijadgfisji`） | 话题、回复、活动都挂 `profiles.id` | 不另建论坛用户库，不读官网 `members` |
| 校园邮箱验证 | `profiles.is_illini_verified`、`verified_illini_email`，经 `api/auth/send-illini-code.js`、`verify-illini-code.js` 写入 | 徽章「校园邮箱已验证」；网友发起活动的资格 | 字段、路由 `pages/illini-verify`、接口文件名都不改 |
| 话题、动态、回复、点赞 | `public.posts`、`post_comments`、`post_likes` | 话题 = `title IS NOT NULL AND category IS NOT NULL` | 不建第二张帖子表 |
| 板块清单 | 常量 `POST_CATEGORIES`（`app/src/utils/communityPost.ts`，[源码 005ca9d]）+ 约束 `posts_topic_metadata_check` | 两处同改；显示名在 i18n `plaza.category.<slug>` | 不建板块表，不建二级板块 |
| 地区清单 | `app/src/utils/region.ts`（REGION.2 新建）+ 约束 `posts_region_check`、`community_events_region_check` | 见 §4 | 不按地区改品牌名 |
| 商品、价格、状态 | `public.items`；状态枚举 `ItemStatus`（`app/src/types/index.ts:21`） | 话题经 `post_items` 引用，引用卡实时读商品 | 帖子不缓存价格和状态 |
| 私信 | `conversations` / `messages`（`app/src/composables/useMessages.ts`） | 「私信发起人」复用直接私信 | 不另建消息系统 |
| 站内通知 | `public.notifications`，唯一写入口 `private.enqueue_activity_notification`（`20260903070000_in_app_activity_notifications.sql:53`） | 见 §5.3 通知表 | 不直接 insert `notifications` |
| 举报、处置、申诉、审计 | `reports`、`admin_mutation_requests`、`admin_audit_log`、`suspensions` | 管理动作都经 `admin_execute_mutation` | 数据保留任务不得扫这些表（仓库 RUNBOOK.md「Ephemeral data retention」:407） |
| 版权通知 | `public.copyright_notices`（§5.4 新建） | LEGAL.4 登记与处置 | 同上，不进保留任务 |
| 订阅、收藏话题 | `post_follows`、`post_bookmarks`（P3.1） | | 不复用 `follows`（关注用户）、`favorites`（只有 `item_id`） |
| CAACI 活动与报名 | 官网 Supabase `wslzeqhipvibeflmxznh` 的 `events`、`event_registrations` [源码 caaciorg@f62f62f] | 只经 `GET /api/public-events` 同步一份投影进 `community_events`（`source_type='caaci'`） | 不直连官网 Supabase，不存报名人，不显示报名人数 |
| 合作组织活动 | `community_events`（`source_type='partner'`），官方账号经管理端录入 | 书面同意凭证在 CAACI「授权记录」表（[RUNBOOK.md](RUNBOOK.md) §11 E11），行里只存编号 `consent_ref` | 不转海报、图片和原文 |
| UIUC 活动 | calendars.illinois.edu | 只收 D-33 选定日历的投影（`source_type='campus'`），接入方式见 §9.3 | 不导入超过 1 MB 的日历，不存 DESCRIPTION、ORGANIZER、CONTACT |
| 网友发起活动 | `community_events`（`source_type='member'`）+ 一条「找搭子」话题 | 话题就是讨论帖 | 不做站内报名 |
| 官网文章、周报 | 官网 `articles`；周报由 OpenClaw cron 经 Brevo 发送 | V5 不接（P6.1 候选） | OMO 不碰 Brevo 和周报 cron |
| 冷启动问题库、授权记录 | CAACI 名下 Google Drive 私有表格（E11） | 不进仓库、数据库、日志 | OMO 不访问 |
| 法律文本 | `app/src/legal/{terms,privacy,guidelines}.{zh,en}.ts`；版本常量经 `app/src/legal/index.ts` 的 `CURRENT_CONSENT_VERSION` 驱动 reconsent | 公开页 `/terms`、`/privacy` 由 `app/public-brand-pages.ts` 构建时生成 | 版本号改动必须先过 §10.1 的数据库顺序 |
| 官方账号 | 每个环境一个 profile（admin@caaciorg.com，D-13）；id 存 Vercel 环境变量 `COMMUNITY_OFFICIAL_PROFILE_ID` | api 层校验；`posts.is_official` 只由管理动作写 | 客户端写不了 `is_official`（`010_plaza_and_uid_and_chat_flags.sql:161` 的 `NOT is_official`） |
| 试点指标 | `scripts/pilot-metrics.sql`（P5.5）从 Illini 库只读计算 | 定义见 DECISIONS.md 指标表 | |
| 生产部署 | Vercel 项目，正式域名 illinimarket.com；`vercel.json` 的 `git.deploymentEnabled=false` | 发布见 §11 | 任何分支都不自动部署 |
| 公开 demo | 独立的 Vercel 项目（illini-community-demo.vercel.app，静态原型，不连数据库）；项目名由 P1.13 记入 STATUS_LOG | | |
| 小程序 | 微信后台，AppID `wxc3da81aa8852a6ff` | 名称、类目、提审归 Eric | |
| DNS | Cloudflare（illinimarket.com，2026-06-25 注册） | | |
| 邮件发送 | Resend，发件域 `send.illinimarket.com`；Auth 邮件模板以 Supabase 后台为准，`supabase/email-templates/` 只是仓库副本 | | |

---

## 2. 可复用模块（逐个路径对 7b18f20 核对过，全部存在）

| 能力 | 路径 | V5 用在哪 |
|---|---|---|
| 客户端预分配 ID | `app/src/api/clientMessageId.ts:7` `createClientMessageId()` | P2.8 `composerPostId`、P4.6 `post_id_in` |
| 预分配 ID 加回读恢复的先例 | `supabase/migrations/20260909201600_idempotent_item_create.sql`（`GRANT INSERT (id) ON public.items`）；`app/src/composables/useItems.ts:519-545`（`itemId`、`retryCreate`、`recoverCreatedItem`） | P2.8 照搬 |
| 按账号隔离的本地存储 | `app/src/api/accountLocalPrivacy.ts:180` `writeAccountPrivateStorage` | P2.8、P4.6 草稿 |
| 换号清理 | `app/src/composables/accountScope.ts:99` `onAccountTransition` | P2.7 待关联商品 |
| 草稿图片恢复 | `app/src/utils/publishDraft.ts:4` `restorableDraftImages` | P2.8 |
| keyset 游标先例 | `useItems.ts:50,284,446` `latestFeedCursors`；`20260912024614_index_active_feed_cursor.sql` | P3.4 |
| 文字审核 | `app/src/utils/contentSafety.ts:226` `remoteModerate`（请求同源 `/api/moderate`）；`:310` 内存去重 `DUP_WINDOW_MS = 30_000` | 发话题、发起活动 |
| 小程序内容安全 | `app/src/composables/useWechatSecCheck.ts`、`api/wechat-seccheck.js` | P4.6 小程序端 |
| 小程序外链改复制 | `app/src/components/OsmAttribution.vue:28-35`、`PlazaBannerCarousel.vue:159-166`（`uni.setClipboardData`） | P4.8 `openExternalLink` |
| 图片来源限制 | `app/src/utils/publicResource.ts:35` `safeManagedBannerUrl`；`vercel.json` CSP `img-src 'self' data: blob: https://*.supabase.co` | 活动卡不渲染外部图片 |
| 校园时区换算（不依赖 Intl） | `app/src/utils/campusTime.ts:174` `campusWallClockToInstant`、`:185` `campusPartsNoIntl` | P4 时间显示与导入 |
| 有界外部请求 | `api/_http-boundary.js` `fetchBounded`（`timeoutMs`、`maxBytes`、`redirect:'manual'`，遇跳转抛 `upstream_redirect`） | P4 同步 |
| 生产 cron 身份门 | `api/_cron-release.js` `releasedCron`；Production GET核对已发布身份，非生产仍转入monitoredCron（:75-79） | 它不限制P4只在生产执行；CAACI同步开关只能设置在Production，设删后须重新部署（§9.2，D-59） |
| 每分钟后台任务 | `api/background-jobs.js`（`vercel.json` `* * * * *`；单次预算 `RUN_TIMEOUT_MS = 25_000`，单调用 `CALL_TIMEOUT_MS = 5_000`） | P4.4、P4.7 挂在这里 |
| 通知写入 | `private.enqueue_activity_notification`：自通知过滤、拉黑检查、`source_event_key` 唯一去重（20260903070000:53-97） | P3.3 |
| 通知跳转 | `app/src/api/notifications.ts:117` 白名单只认 `post_comment`、`post_like`、`post_comment_like` | P3.3 加 key |
| 邮件摘要 | `api/notification-digest.js:391-394` `SAFE_UNROUTED_NOTIFICATION_TYPES` 含 `post_comment`、`system` | P3.3 按 body key 排除新通知 |
| 管理动作 | `api/admin/index.js`（:476-486 结果形状、:700 `MODERATION_ACTIONS`、:708 `OWNER_ACTIONS`、:746 `roleCanMutate`）+ `admin_execute_mutation` + `app/src/pages/admin/index.vue`（`pages.json:150` 只在 H5 编入） | P3.5、P4.5、P4.9、LEGAL.4 |
| 分享预览 | `api/share.js`、`api/share-post.js`（读 `posts_visible`） | P2.9、BRAND.2 |
| 部署边界 | `api/_deployment-boundary.js`（`DEPLOYMENT_APP_ORIGIN`、`SUPABASE_EXPECTED_PROJECT_REF`、`DEPLOYMENT_EXPECTED_VERCEL_ENV`） | S-2、BRAND.6 |
| 公开读预检 | `scripts/verify-public-read-schema.mjs` | P2.1、P3、P4 |
| RPC 存在性检查 | `scripts/verify-deployed-rpcs.mjs`（仓库 RUNBOOK.md「Schema-coupled release order」） | 发布前 |
| 生产对象存在性 | `scripts/schema-drift-probe.mjs`；ledger 行数不可信（仓库 README.md:135-142） | Eric 发布前 |
| 小程序包体 | `scripts/verify-miniprogram.mjs`：主包 1.5 MiB、分包 1.6 MiB；CI 不调用它 | P2.10、P3.8 |
| 全链回放 | `supabase/_ops/LOCAL_BOOTSTRAP_20260722_full_clean_supabase_base.sql`（同会话先 `SET caaci.local_bootstrap='20260722-disposable-pg17'`） | L-SQL |
| 法律文本与公开页 | `app/src/legal/index.ts:34` `LegalDocType`；`app/public-brand-pages.ts:76-96`；`app/src/pages/legal/index.vue:102-107`（`onLoad` 读 `type` 参数） | LEGAL.2、LEGAL.4 |
| 图标与 logo | `app/src/components/icons/registry.ts`、`app/src/static/logo-mark.svg`、`logo-mark-dark.svg`、`app-icon.svg`、`app-icon-192.png`、`app-icon-512.png` | BRAND.4 |

---

## 3. 改名技术清单（D-20、D-23、D-27）

### 3.1 要改的文件（BRAND.1–BRAND.3）

下表的行数用 BACKLOG BRAND.2 ⑤ 的检索式在 7b18f20 上数得，合计 76 行、19 个文件，与 005ca9d 相同。

| 文件 | 行数 | 改什么 | 任务 |
|---|---|---|---|
| `app/public-brand-pages.ts` | 11 | `/about`、`/community`、`/privacy`、`/terms` 四个公开页的站名与说明 | BRAND.1 |
| `app/src/static/h5/account-deletion.html` | 10 | 站名 | BRAND.1 |
| `app/src/composables/i18n/messages/zh.ts`、`en.ts` | 各 8 | `app.name`（:177）、`app.desc`（:178）、新增 `app.tagline`、`app.formerly`；`moderation.adBody`（zh :473 / en :475，删去「只用于同学之间交易物品」）；`share.marketplace`、`share.plaza`、`share.profile`（zh :1418-1420） | BRAND.1、BRAND.2 |
| 同上两个文件 | zh 6 / en 4 | 徽章：`profile.illiniVerified`、`profile.verifyTitle`、`profile.verifyHint`、`illini.title`、`illini.intro`、`login.illiniEmail`（zh :505-515、en :507-517）；只改值，key 不改 | BRAND.3 |
| `app/index.html` | 5 | `<title>` 与 meta | BRAND.1 |
| `api/share-post.js` | 5 | `og:site_name`（:197）、兜底标题（:171-173）、加载文字（:205） | BRAND.2 |
| `api/notification-digest.js` | 5 | `DIGEST_FROM` 默认显示名、正文 | BRAND.2 |
| `api/share.js` | 4 | `og:site_name`、兜底标题 | BRAND.2 |
| `api/meetup-notify.js`、`api/auth/send-illini-code.js` | 各 4 | 邮件正文与发件显示名 | BRAND.2 |
| `api/unsubscribe.js` | 2 | 页面文字 | BRAND.2 |
| `app/src/static/manifest.webmanifest` | 2 | `name`「玉米地 · 伊利诺伊华人论坛」、`short_name`「玉米地」、`description` | BRAND.1 |
| `app/src/pages/legal/index.vue` | 2 | 摘要里的服务名（:99-100）；同一句的运营方「Guoyi (Eric) Xu」等 LEGAL.2 | BRAND.1 |
| `app/src/manifest.json` | 1 | `name`（:2）改「玉米地」；`description`（:4）改论坛描述 | BRAND.1 |
| `app/src/pages.json` | 1 | `globalStyle.navigationBarTitleText`（:182） | BRAND.1 |
| `app/src/pages/index/index.vue`、`pages/detail/index.vue` | 各 1 | `navigator.share` 标题 | BRAND.1 |
| `app/src/static/robots.txt` | 1 | 注释里的站名 | BRAND.1 |
| `api/moderate.js` | 1 | 分类提示词里的产品描述 | BRAND.1 |
| `supabase/email-templates/` 的 confirm-signup、reset-password | — | 仓库副本；生效版本由 Eric 粘贴到 Supabase 后台（E10） | BRAND.2 |
| 断言品牌的测试 | — | `api/_share-boundary.test.mjs`、`api/_email-brand-boundary.test.mjs`（:24、:60 断言 `DIGEST_FROM` 默认值）、`api/_deployment-boundary.test.mjs` | BRAND.2 |
| `app/src/legal/*.ts` | 17 | 服务名与运营方，D-37 之后 | LEGAL.2 |

`app/src/manifest.json` 的 `name` 会被 uni-app 写进构建产物 `dist/build/mp-weixin/project.config.json` 的 `projectname`：005ca9d 的构建产物里这个值是 `"Illini Market"`，而仓库里没有受版本控制的 `project.config.json`（`git ls-files` 无此文件）。所以 BRAND.5 的「本地名同步」不改源码，只在 BRAND.1 之后重新构建并核对这个字段。

「原 Illini Market」说明用新 key `app.formerly`（文案见 SPEC §1.1），只放关于页和登录页。移除日期 = BRAND 生产发布日 + 90 天，发布日由 Eric 记入 STATUS_LOG。

### 3.2 不改的标识

仓库名、Supabase 项目名、Vercel 项目名、Sentry 项目名；路由 `pages/illini-verify`；字段 `is_illini_verified`、`verified_illini_email`；接口文件 `api/auth/send-illini-code.js`、`verify-illini-code.js`；存储 key（例如 `app/src/api/acquisition.ts:6` 的 `illini_campaign_session_v1`）；所有 i18n key 名；域名 `illinimarket.com`、发件域 `send.illinimarket.com`、客服邮箱 `help@illinimarket.com`（`app/src/config/runtime.ts:57`、`app/src/api/adminSupportReply.ts:2`）。

### 3.3 小程序改名的约束（BRAND.5，E7）

- 入口：微信后台「设置 → 基本信息 → 小程序名称 → 修改」，管理员扫码确认。
- 名称 4–30 个字符，一个汉字算 2 个；「玉米地」是 6 个字符。不能与其他主体的公众号或小程序重名；命中保护词要再审，最多 7 个工作日。来源：Oray 2023 指南（naming.md「改名影响范围」二）。
- 改名次数：个人主体发布前 3 次、发布后每年 2 次；企业主体改名要走微信认证（300 元）。来源是 ifanr 2017 年的两篇第三方文章，未核实，以后台提示为准（D-30）。
- 名称带「论坛」可能要求社交或论坛类目及资质（来源只有 2018 年 V2EX 帖子）。D-27 定的显示名是「玉米地」，不带「论坛」。现有服务类目是否覆盖用户发帖，属 D-30。
- 改名不影响代码：AppID 写在 `app/src/manifest.json:42`，request 合法域名是 `https://www.illinimarket.com`（`docs/WECHAT_MP_SETUP.md:36`），两者都不变。

### 3.4 新域名与 illinimarket.com 的 301（BRAND.6，D-36 答复之后）

规则：
- 页面 GET 一律 301 到新域名，路径和 query 原样带上。H5 用 hash 路由（`/#/pages/...`），fragment 不发给服务器；Location 不带 fragment 时，浏览器会沿用原 fragment（RFC 7231 §7.1.2），所以旧深链 `/#/pages/post/index?id=<uuid>` 跳转后仍落到同一页。
- `/api/*`、`/share/*`、`/share-post/*` 在两个域名上都直接服务，任何 POST 都不跳转。已打开的旧 H5 标签页还会请求旧域名。
- 小程序的 request 合法域名在过渡期保持 `https://www.illinimarket.com`。改小程序请求域名要单独发一个小程序版本，不和 BRAND.6 同批。
- 跳转写成 `vercel.json` 的 `redirects`：每条带 `has: [{ "type": "host", "value": "illinimarket.com" }]`（www 另写一条）、`statusCode: 301`，source 排除 `/api/` 和 `/share` 前缀。这要改 `vercel.json`，而 STOP 清单不允许改它，所以 Eric 答复 D-36 时要一并批准这一处修改；没批准就不开工。
- 最早停止跳转的日期 = 新域名启用日 + 1 年，写进 DECISIONS D-23。

代码里写死旧域名的位置（`git grep -lI 'illinimarket\.com' -- api app/src ':!*.test.mjs'` 共 22 个文件，下面是要改的那部分）：

| 位置 | 内容 | 不改的后果 |
|---|---|---|
| `api/_cron-release.js:11-12` | `PRODUCTION_CRON_ORIGIN`、`PRODUCTION_APP_ORIGINS` | 生产 origin 换成新域名后，五个 cron 全部被身份门拒绝 |
| `api/auth/send-illini-code.js:22-23`、`verify-illini-code.js:16-17`、`api/geocode.js:25-26`、`api/moderate.js:31-32`、`api/translate.js:31-32` | CORS 白名单 | 新域名下发不出验证码、审核和翻译失败 |
| `api/meetup-notify.js:33,414`、`api/notification-digest.js:31,373` | `DEFAULT_APP_URL` 与邮件页脚 | 邮件链接仍指向旧域名（有 301，可用但多一跳） |
| `app/src/api/acquisition.ts:14` | 只在这两个 hostname 下记录来源 | 新域名下不记来源 |
| `app/public-brand-pages.ts:35` | canonical | 搜索引擎仍以旧域名为准 |
| i18n `wechat.codeWarning`、`wechat.websiteOnly`（zh/en :90、:122） | 文案里的域名 | 用户被引到旧域名 |

外部系统（全部由 Eric 改）：Cloudflare DNS；Vercel 项目域名与 `DEPLOYMENT_APP_ORIGIN`；Supabase Auth 的 Site URL 与 Redirect URLs（过渡期两个域名都留）；Google 登录的 OAuth 客户端（`app/public-brand-pages.ts:67` 写明站点提供 Google 登录，授权域名和应用名称都要改，见 §13 缺口 6）；Sentry；Resend（继续用 `send.illinimarket.com`，新发件域通过 SPF、DKIM、DMARC 验证后再换）。

---

## 4. 地区字段（D-21，REGION.1、REGION.2）

- `posts.region text NOT NULL DEFAULT 'cu'`，约束 `posts_region_check CHECK (region IN ('cu'))`。PostgreSQL 11 起，带常量默认值的 `ADD COLUMN` 只改目录、不重写表；新 CHECK 要扫一遍全表，由迁移开头的 `lock_timeout` 兜住。
- 权限：`GRANT SELECT (region) ON public.posts TO anon, authenticated`。不授 INSERT、UPDATE，新帖一律取默认值。
- `search_community_posts` 增加参数 `region_in text DEFAULT 'cu'`，条件 `p.region = region_in`。
- `community_events.region` 同样的写法（§5.5）。
- 客户端：`app/src/utils/region.ts` 导出 `REGIONS = [{ slug: 'cu', zh: '香槟', en: 'Champaign-Urbana' }]` 和 `ACTIVE_REGION = 'cu'`。社区列表、搜索、首页、活动的每个查询都带 `region = ACTIVE_REGION`。`POST_COLUMNS` 加 `region`。
- `items` 不加地区列。判断：二手只服务香槟，开第二个地区时再议（P6.1）。
- 开第二个地区（如 `chi`）要做五件事，品牌名不变：① 新迁移把两个 CHECK 改成 `IN ('cu','chi')`；② `GRANT INSERT (region) ON public.posts TO authenticated`，发帖时由客户端传地区；③ 把 `idx_posts_category_feed` 换成以 `region` 开头的索引（P3.1 的新索引已经以 `region` 开头）；④ `REGIONS` 加一项，切换器在两项时自动出现（REGION.2 ③）；⑤ 新地区的板块沿用同一套 slug。

---

## 5. 数据库变更（按批次）

### 5.0 每个批次都守的规则

1. 新迁移文件名 `supabase/migrations/<UTC YYYYMMDDHHMMSS>_<name>.sql`。同一提交更新 `supabase/migrations/manifest.sha256`、仓库 README.md「数据库迁移清单」里的文件计数句，以及 `scripts/release-migration-count-boundary.test.mjs` 的计数断言（P2 已把 180 改为 181，[源码 005ca9d]）。
2. 配套三个文件，命名照 `20261003175231` 的三件套：`supabase/_ops/PRECHECK_<ts>_<name>.sql`（只读事务，断言迁移前的形状）、`VERIFY_<ts>_<name>.sql`（只读，断言迁移后的列、约束、索引、ACL、函数属性）、`REGRESSION_<ts>_<name>.sql`（会写数据的回归）。REGRESSION 只在 L-SQL 跑；托管库上不跑，因为回滚的 insert 仍会推进 `bigserial` 序列（仓库 RUNBOOK.md「2026-07 candidate release sequence」第 15 条，:1316 附近）。
3. 迁移开头写 `BEGIN; SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '60s';`。仓库先例：`20261003175231:5-6`（5s / 2min）、`20260912024614:5-6`（2s / 30s）。对 anon 开放的 RPC 另加函数级 `SET statement_timeout = '3s'`。
4. 只追加。已应用到任何托管库的文件不改；`20261112120000` 在 STATUS_LOG 写下「冻结」后同样不改，后续变更另起迁移。
5. 用 `CREATE OR REPLACE` 改写已有函数之前，用 `git log origin/main --since=<该函数最新定义的日期> -- supabase/migrations` 和 `git grep -l <函数名> origin/main -- supabase/migrations` 证明 main 上没有更新的定义；PRECHECK 对托管库断言 `md5(prosrc)` 等于 L-SQL 回放到上一条迁移时的值（OMO 回放后把值写进 PRECHECK）。
6. 新表先 `REVOKE ALL ... FROM PUBLIC, anon, authenticated`，再逐列授权。SECURITY DEFINER 函数固定 `search_path`，`REVOKE ALL FROM PUBLIC` 后只授给需要的角色。
7. 数据库回归测试放 `scripts/<name>.test.mjs`，用 P1.3 的 PostgreSQL 查找函数；L-SQL 从 001 全链回放（[RUNBOOK.md](RUNBOOK.md) §5.1）。

### 5.1 P2：`20261112120000_community_post_topics.sql`（P2.5 冻结前修订）

现状 [源码 005ca9d]：547 行，以 `BEGIN;` 开头，没有超时设置；新增 `title`、`category` 两列和约束 `posts_topic_metadata_check`（标题 1–120 字、≤480 字节、不含换行，板块属五个 slug）；`GRANT SELECT (title, category)` 给 anon、authenticated，`GRANT INSERT (title, category)` 给 authenticated；BEFORE 触发器 `validate_post_topic`；索引 `idx_posts_category_feed (category, is_pinned DESC, created_at DESC, id DESC) WHERE status='active'` 和 `idx_posts_title_trgm`；新 RPC `search_community_posts(text[], text, int, int, text)`（SECURITY INVOKER，最多 8 个词、每词 100 字，`limit` 上限 100）；同签名重发 `capture_report_target_snapshot` 与 `admin_get_report_detail`，只多了 post 分支（与 `20260717194334` 相比）。这个文件没有应用到任何托管库。

冻结前要加的改动：

| # | 改动 | 依据 |
|---|---|---|
| 1 | `BEGIN;` 之后加 `SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '60s';` | §5.0 第 3 条 |
| 2 | `posts.region` 列、`posts_region_check`、`GRANT SELECT (region)` | REGION.1，§4 |
| 3 | 约束 `posts_topic_body_check CHECK (title IS NULL OR btrim(content) <> '')`；`validate_post_topic` 在约束之前先 `RAISE EXCEPTION 'post_topic_body_required' USING ERRCODE = '23514'` | 旧客户端至少能看到正文；044 的去重只比正文（`044_rate_limit_window_buffer.sql:105-112`），无正文话题会互相撞 `duplicate_post` |
| 4 | `GRANT INSERT (id) ON public.posts TO authenticated` | P2.8；V4 审核（appendix/review/V4_REVIEW_2026-11-12.md）把这一步定为单独的 P2b 迁移，V5 并入本文件 |
| 5 | `search_community_posts` 加第 6 个参数 `region_in text DEFAULT 'cu'`；新签名 `(text[], text, int, int, text, text)`；`ALTER FUNCTION public.search_community_posts(text[], text, int, int, text, text) SET statement_timeout = '3s'` | REGION.1 ③ |
| 6 | 重建 `posts_visible`：沿用 `20260718160000_reconcile_expired_suspension_visibility.sql:516-537` 的 11 列、`security_invoker = true`、`security_barrier = true`、REVOKE/GRANT 写法，在末尾追加 `source_lang, title, category, region` | 见下 |
| 7 | 其余保持 005ca9d 原样 | |

第 6 条为什么多加 `source_lang`：`api/share-post.js:159-160` 从 `posts_visible` 读 `id,content,images,user_id,source_lang`，这一行由 #335（2026-09-17）加入；而仓库里 `posts_visible` 的最新定义（20260718160000:516-533）没有 `source_lang`。在按仓库回放的库上，这个请求会返回 400，`readPublicRows`（share-post.js:87-89）返回空数组，所有帖子的 OG 标题都退化成兜底文字。生产上的视图是否已有 `source_lang` 未核实（§13 缺口 1）。`CREATE OR REPLACE VIEW` 只允许在末尾追加列，所以两种情况都能接受同一份迁移：生产缺 `source_lang` 时一起补上；生产已在第 12 列手工加过它时，位置正好一致。

PRECHECK（只读）断言：
- `posts` 上还没有 `title`、`category`、`region`；`search_community_posts` 不存在；`search_posts_fuzzy(text[], text, int, int)` 存在。
- `posts_visible` 的列依次是 20260718160000 的 11 列，最多再跟一个 `source_lang`；出现别的列就停。
- `capture_report_target_snapshot`、`admin_get_report_detail` 的 `md5(prosrc)` 等于 L-SQL 回放到 `20261003175231` 后的值。

VERIFY（只读）断言：
- 三列可空性与默认值：`title`、`category` 可空，`region` 非空、默认 `'cu'`。
- `posts_topic_metadata_check`、`posts_topic_body_check`、`posts_region_check` 存在且已 VALIDATE；两个索引存在。
- 列权限：anon、authenticated 对 `title, category, region` 有 SELECT；authenticated 对 `title, category` 有 INSERT；与 `20260719151729_reconcile_plaza_base_table_acl.sql:397-409` 相比，authenticated 只多了 `INSERT (id)`，没有新的 UPDATE。
- `search_community_posts` 为 SECURITY INVOKER，`proconfig` 含 `statement_timeout=3s`，EXECUTE 只授 anon、authenticated。
- `capture_report_target_snapshot`、`admin_get_report_detail` 只有 service_role 能执行。
- `posts_visible` 的列表与属性符合第 6 条。

REGRESSION（只在 L-SQL）：以 anon、A、B、停权用户、被拉黑用户身份（`SET ROLE` 加 `request.jwt.claim.sub`）对 `posts`、`post_items`、`search_community_posts` 做读写断言，覆盖 BACKLOG P2.11 ① 的 7 项拒绝。`scripts/community-post-topics.test.mjs`（[源码 005ca9d]）同步扩充。

已知副作用：历史文件 `supabase/_ops/VERIFY_20260718_reconcile_app_table_acl_boundaries.sql:85-88、:196-200` 钉死了 posts 的 SELECT、INSERT 列清单。应用本迁移后再跑它会报漂移（多出 `title, category, region` 的 SELECT 和 `id, title, category` 的 INSERT）。这是预期结果，记入 STATUS_LOG，不改那个历史文件。

### 5.2 P2 的客户端读写合同

`createPost`（`usePlaza.ts`）：
- 入参增加 `postId`（UUIDv4，校验照 `useItems.ts:530`）和 `retryCreate`。
- 返回 `{ id, partial: false }`，或 `{ id, partial: 'items_failed', failedItemIds }`，或 `{ id, partial: 'refetch_failed' }`。最后一种不提示用户。
- 遇到 `retryCreate`、`23505`、`duplicate_post`（BEFORE INSERT 去重触发器先于主键冲突抛出）或结果未知时，先 `from('posts').select(POST_SELECT).eq('id', postId).eq('user_id', uid).maybeSingle()` 回读，再判定成败。
- 话题路径删掉 005ca9d `usePlaza.ts:388` 的 `trimmed || ' '`：话题必须带正文。

本地状态：

| key | 存储 | 字段 | 清理 |
|---|---|---|---|
| `pending-post-items:<accountId>:<postId>` | usePlaza 模块级 Map，镜像到 sessionStorage | `itemIds`（按原顺序） | `onAccountTransition`；重试成功或用户选「不关联了」 |
| `plaza_composer_draft_v1` | `writeAccountPrivateStorage` | `postId, mode, title, category, text, itemIds, images（非 blob）, outcomeUncertain` | 换号；发布成功；用户选「不保留」 |
| `events_create_draft_v1` | `writeAccountPrivateStorage` | 发起活动表单字段加 `postId` | 同上（P4.6） |

补关联：先查该帖已有的 `post_items`，只插缺的，`display_order` 沿用原顺序；`23505` 算成功；`42501` 表示 RLS 拒绝（商品已不在售或账号受限，策略见 `20260719151729`「Post owner can attach own items」）；`post_items_cap_exceeded` 来自 `041_post_items_join_table.sql` 的 BEFORE INSERT 触发器。不需要新迁移。

错误码到 i18n 的映射写在 `app/src/utils/index.ts:271` `friendlyErrorMessage` 及其 `CONTENT_MESSAGES`（文案见 SPEC.md 状态与文案表）：

| 错误 | 来源 |
|---|---|
| `post_topic_required`、`post_title_invalid` | 客户端 `normalizePostTopic`（[源码 005ca9d]） |
| `public_write_boundary:post_title_size` | `private.assert_text_boundary`（`validate_post_topic` 调用） |
| `posts_topic_metadata_check`（23514） | 约束名，映射到 `post_topic_required` |
| `post_topic_body_required`（23514） | §5.1 第 3 条 |
| `duplicate_post` | 044 `rl_posts_before_insert`，60 秒窗口 |
| `post_items_cap_exceeded` | 041 |
| `post_locked` | P3.1（§5.3） |
| `member_event_*`、`event_discussion_closed` | P4（§5.5、§9.9） |

板块显示：新增 `boardLabel(slug)`（`app/src/utils/communityPost.ts`）。`t()` 找不到 key 时原样返回 key（`app/src/composables/useI18n.ts:134`），`boardLabel` 在这种情况下改回 slug，旧客户端遇到将来新增的板块时不会显示 `plaza.category.xxx`。

标题翻译：P2 标题不翻译，英文界面显示原文标题。服务端英文补全触发器 `queue_public_post_english`（`20260917034051_public_content_english.sql:37`）只监听 `content, content_i18n, status`，客户端 `togglePostTranslate` 也只翻正文。`title_i18n` 列入 P6.1 候选，做法可照商品的 `title_i18n`。

### 5.3 P3：`<UTC ts>_community_watch_save_activity.sql`（P3.1）

PR #369 合并前只在本地写迁移并跑 L-SQL；合并后从 main 新建 `codex/community-p3-<日期>`（BACKLOG P3.1）。

```sql
create table public.post_follows (
  user_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);
create index post_follows_post_idx on public.post_follows (post_id, created_at);

create table public.post_bookmarks (
  user_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);
create index post_bookmarks_user_idx on public.post_bookmarks (user_id, created_at desc, post_id);

alter table public.posts
  add column last_activity_at timestamptz,
  add column answered_at timestamptz,
  add column is_featured boolean not null default false,
  add column locked_at timestamptz,
  add constraint posts_featured_official_only check (not is_featured or is_official);

update public.posts p set last_activity_at = greatest(p.created_at,
  coalesce((select max(c.created_at) from public.post_comments c
            where c.post_id = p.id and c.status = 'active'), p.created_at));
update public.posts p set answered_at = (select min(c.created_at) from public.post_comments c
  where c.post_id = p.id and c.status = 'active' and c.user_id <> p.user_id);
alter table public.posts
  alter column last_activity_at set not null,
  alter column last_activity_at set default now();

create index posts_board_activity_idx on public.posts (region, category, last_activity_at desc, id desc)
  where status = 'active';
create index posts_activity_idx on public.posts (region, last_activity_at desc, id desc)
  where status = 'active';
create index posts_unanswered_idx on public.posts (region, created_at desc, id desc)
  where status = 'active' and title is not null and answered_at is null;
```

- `answered_at` 是本批新增的工程字段：第一条非作者的有效回复写入时由触发器填上，之后不再清空（回复被删，话题也不回到「待回答」）。判断：用它代替每次查询都算 `NOT EXISTS`，「待回答」才能走索引分页。
- RLS（两张新表相同）：SELECT、DELETE 限 `user_id = (select auth.uid())`；INSERT 的 WITH CHECK 同时要求本人、帖子 `status = 'active' and moderation_private.profile_content_visible(post.user_id)`、`public.blocks` 中双方没有任一方向的记录。列权限：`GRANT SELECT (user_id, post_id, created_at), INSERT (user_id, post_id), DELETE TO authenticated`；不授 anon。
- posts 新列：`GRANT SELECT (last_activity_at, answered_at, is_featured, locked_at) TO anon, authenticated`，不授 INSERT、UPDATE；只有管理动作能改 `is_featured`、`locked_at`。
- 触发器：
  - 改写 `public.update_post_comment_count()`（最新定义 `085_meetup_state_and_comment_count.sql:280-296`）：INSERT 分支一次 UPDATE 同时写 `comment_count + 1`、`last_activity_at = greatest(last_activity_at, new.created_at)`、`answered_at = coalesce(answered_at, case when new.user_id <> 帖子作者 then new.created_at end)`。不另加第二个 UPDATE。按 §5.0 第 5 条核对没有更新的定义。
  - 新增 `private.reject_reply_to_locked_post()`：BEFORE INSERT ON `post_comments`，帖子 `locked_at` 非空时 `RAISE EXCEPTION 'post_locked'`。
  - 新增 `private.notify_topic_reply()`：AFTER INSERT ON `post_comments`，规则见下面的通知表。
- `search_community_posts`：返回列加 `last_activity_at`、`answered_at`，`sort_in` 增加 `active`、`unanswered`，`hot` 只算 14 天内发布的帖子。返回类型变了，要在同一事务里 `DROP FUNCTION` 后重建，并重发 REVOKE、GRANT 与 `statement_timeout`。
- 排序与翻页（P3.4）：`active` = `last_activity_at desc, id desc`，`recent` = `created_at desc, id desc`，两者用 keyset 游标 `{ 时间, id }`；置顶帖只在第一页取一次，之后的页加 `is_pinned = false`。`unanswered` = 话题、`answered_at is null`、发布 ≤30 天，keyset 按 `created_at`。`hot` 和搜索保留 offset，搜索最多 100 条。
- P3 不做帖子编辑：authenticated 对 posts 只有 `UPDATE (content_i18n)`（`20260719151729:409`）。

通知注册表（P3.3；文案见 SPEC.md 通知类型表）：

| body key | type | 接收人 | `source_event_key` | 跳转 | 进摘要邮件 |
|---|---|---|---|---|---|
| `post_comment:<post_id>`（现有） | `post_comment` | 帖子作者 | `post-comment:<comment_id>` | 话题详情 | 是 |
| `post_like:<post_id>`、`post_comment_like:<post_id>`（现有） | `post_like` | 帖子或回复作者 | 现有格式 | 话题详情 | 是 |
| `comment_reply:<post_id>`（新） | `post_comment` | 被回复的那条回复的作者（coalesce(reply_to_comment_id, parent_comment_id)）；排除回复者本人和帖子作者（作者已收到 `post_comment`） | `comment-reply:<comment_id>` | 话题详情 | 否 |
| `followed_post_reply:<post_id>`（新） | `post_comment` | 订阅者；排除回复者、帖子作者、被回复的那条回复的作者（coalesce(reply_to_comment_id, parent_comment_id)）；按 `post_follows.created_at` 升序取前 500 人 | `followed-reply:<comment_id>:<recipient_id>` | 话题详情 | 否 |

- type 沿用现有值，`notifications_type_check`（20260903070000:40-45）不改。
- 客户端：`notifications.ts:117` 白名单加两个新 key；同一话题未读期间合并成一行；目标被隐藏后点开显示「已不可见」。
- 摘要邮件：`api/notification-digest.js` 按 body key 前缀排除这两个新 key（type 白名单 :391-394 仍含 `post_comment`），`api/_digest-body-copy-boundary.test.mjs` 加断言。
- 帖子或回复不是 active 时不发。单次扇出上限 500，第 501 位及以后的订阅者不发。

治理动作（P3.5）。每个动作同时改五处：① `admin_mutation_requests_action_check`（当前定义 `20260720035037_harden_admin_appeal_decisions_and_session_metadata.sql:283-296`）；② `admin_execute_mutation` 的分支；③ `admin_audit_log_event_kind_check`（同文件 :302-317）；④ `api/admin/index.js` 的入参校验、结果形状集合（:476-486）、角色集合（:700、:708）；⑤ `pages/admin/index.vue` 的按钮。另同步 `api/_admin-input-boundary.test.mjs`。

| 动作 | 审计 event_kind | 角色集合 | 规则 |
|---|---|---|---|
| `restore_content` | `content_restored` | MODERATION | post、comment、item 从 hidden 改回 active，媒体移出隔离区；移回失败返回 `media_restore_pending` |
| `set_post_official` | `post_official_changed` | OWNER | 只接受 `user_id = COMMUNITY_OFFICIAL_PROFILE_ID` 的帖子，由 api 层校验 |
| `set_post_featured` | `post_featured_changed` | OWNER | 数据库约束 `posts_featured_official_only` 兜底 |
| `set_post_locked` | `post_lock_changed` | MODERATION | 写或清 `locked_at` |
| `set_post_category` | `post_category_changed` | MODERATION | 只接受五个 slug |

判断：官方署名和「新来先看」只给 owner 角色（Eric），日常处置给 moderation 角色。


#### 第八批（D-54）补记：迁移相对本节新增的对象（STOP-16a，L158）

① 表 private.community_reply_notice_config（singleton boolean 主键、DEFAULT true、CHECK (singleton)；enabled boolean NOT NULL DEFAULT false；ENABLE ROW LEVEL SECURITY，没有策略；REVOKE ALL FROM PUBLIC, anon, authenticated, service_role；迁移里插入一行）。② 列 public.post_comments.reply_to_comment_id uuid，可空，外键 post_comments(id) ON DELETE SET NULL（约束名 post_comments_reply_to_comment_id_fkey）；部分索引 post_comments_reply_to_comment_id_idx (reply_to_comment_id) WHERE reply_to_comment_id IS NOT NULL；`GRANT INSERT (reply_to_comment_id) TO authenticated`，不授 SELECT、UPDATE。③ 函数 private.validate_comment_reply_target()（SECURITY DEFINER，search_path=pg_catalog，对 API 角色全部 REVOKE）与触发器 enforce_reply_target（BEFORE INSERT ON post_comments，按名字排在 enforce_actor_post_comments、enforce_locked_post_reply 之后）；新错误名 comment_reply_target_invalid（23514）。④ private.notify_topic_reply() 改了：先看开关；作者被影子隐藏时不发；comment_reply 发给 coalesce(reply_to_comment_id, parent_comment_id) 的作者；订阅者与回复者或话题作者之间有任一方向的拉黑就不发。通知表（§5.3）里 comment_reply 的接收人应改成「被回复的那条回复的作者（没指明时是楼主）」。⑤ public.list_own_hidden_posts(uuid) 的返回列是 id、title、category、content、created_at，没有 hidden_reason。⑥ 迁移开头在漂移守卫之后加了 `LOCK TABLE public.post_comments, public.posts IN ACCESS EXCLUSIVE MODE`；漂移守卫多钉了 moderation_private.current_profile_state(uuid) 9c0b020a…。函数体 md5（P4 要重算的依据）：private.notify_topic_reply() aca99f42836280e42523f3e64f722908，private.validate_comment_reply_target() 4795236eac69a88568327a0c0cd61563，public.list_own_hidden_posts(uuid) c9f99d66e033e5d9f99429cde0508a8b；其余 11 个本迁移发的函数体没变。

#### 第九批（D-55）补记：P3 迁移相对本节改变的对象（STOP-16a，L183）

- `public.admin_execute_community_governance(text,uuid,text,text,jsonb)` 的 `restore_content`、`target_type = comment` 一支：恢复一条回复时对所属话题多写两列，`last_activity_at = greatest(last_activity_at, 回复的 created_at)`，`answered_at = coalesce(answered_at, 回复者 <> 楼主时回复的 created_at)`；`comment_count + 1` 照旧。签名、SECURITY DEFINER、search_path、属主、授权都没变；md5(prosrc) `e6ddf89b765c544d9434a843478ccf42` → `fedabd431c829a5b2303e4a46961a855`（mig:P3-B8-1）。
- 新对象 0 个；本迁移发的其余 13 个函数体、表、列、约束、索引、授权、策略、触发器、加锁顺序都没变。迁移头补了一句：`post_comments` 有没有 SELECT 授权的列，API 角色用 `select=*` 会报 42501，客户端必须列出列名（mig:P3-B8-2，静态测试见 L184）。

### 5.4 LEGAL：两个迁移

**`<UTC ts>_accept_cornfield_consent_version.sql`（LEGAL.2）**：照同类迁移的写法（最新一条是 `20260919090100_accept_acquisition_privacy.sql:12-44`），把新版本号加进约束 `profiles_tos_version_release_allowlist` 和 `record_consent` 的 CASE。原因与顺序见 §10.1。

**`<UTC ts>_copyright_notices.sql`（LEGAL.4）**：

```sql
create table public.copyright_notices (
  id uuid primary key default gen_random_uuid(),
  received_at timestamptz not null,
  channel text not null check (channel in ('email','postal','platform','other')),
  legal_basis text not null check (legal_basis in ('us_dmca','cn_civil_code','other')),
  claimant_name text not null check (char_length(claimant_name) between 1 and 200),
  claimant_contact text not null check (char_length(claimant_contact) between 3 and 320),
  work_description text not null check (char_length(work_description) between 1 and 2000),
  target_type text check (target_type in ('post','comment','item','message','user','event')),
  target_id uuid,
  target_url text check (char_length(target_url) <= 500),
  elements_complete boolean not null,
  forwarded_to_poster_at timestamptz,
  action text not null default 'pending'
    check (action in ('pending','removed','disabled','rejected_incomplete','no_action')),
  action_at timestamptz,
  counter_notice_at timestamptz,
  restored_at timestamptz,
  admin_note text check (char_length(admin_note) <= 1000),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((action = 'pending') = (action_at is null))
);
create index copyright_notices_queue_idx on public.copyright_notices (received_at) where action = 'pending';
```

- 不对 anon、authenticated 授任何权限，只经管理动作读写：新增一个管理动作 `record_copyright_notice`（不带 id 时新建，带 id 时更新状态字段；审计 event_kind `copyright_notice_recorded`，OWNER 角色），按 §5.3 的五处同步。
- `claimant_contact` 是个人信息，不进日志、Sentry、STATUS_LOG。保留期写进隐私政策（LEGAL.2 起草，Eric 审定）；这张表不加入数据保留任务。

### 5.5 P4：`<UTC ts>_community_events.sql`（P4.2）

依赖：同一回放链里已有 `20261112120000`（含 `INSERT (id)` 授权）；网友发起活动的通知另依赖 P3.1。

```sql
create table public.community_event_partners (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,32}$'),
  name_zh text not null check (char_length(name_zh) between 1 and 40),
  name_en text not null check (char_length(name_en) between 1 and 80),
  status text not null default 'active' check (status in ('active','paused','revoked')),
  consent_ref text not null check (consent_ref ~ '^[A-Za-z0-9-]{3,40}$'),
  consent_recorded_on date not null,
  contact_role text not null check (char_length(contact_role) between 2 and 60),
  allowed_link_hosts text[] not null default '{}' check (cardinality(allowed_link_hosts) <= 5),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'revoked') = (revoked_at is not null))
);

create table public.community_events (
  id uuid primary key default gen_random_uuid(),
  source_type text not null check (source_type in ('caaci','partner','campus','member')),
  source_key text not null check (char_length(source_key) between 1 and 600),
  region text not null default 'cu',
  organizer_name text check (char_length(organizer_name) between 2 and 80),
  partner_id uuid references public.community_event_partners(id),
  consent_ref text,
  title text check (char_length(title) <= 160),
  title_en text check (char_length(title_en) <= 160),
  summary text check (char_length(summary) <= 280),
  summary_en text check (char_length(summary_en) <= 280),
  starts_at timestamptz not null,
  ends_at timestamptz,
  all_day boolean not null default false,
  occurrence_count integer not null default 1 check (occurrence_count between 1 and 400),
  time_zone text not null default 'America/Chicago' check (time_zone = 'America/Chicago'),
  location text check (char_length(location) <= 160),
  page_url text check (char_length(page_url) <= 500),
  register_url text check (char_length(register_url) <= 500),
  registration_mode text not null check (registration_mode in
    ('caaci_site','info_only','external_link','calendar_page','discussion')),
  takes_registrations boolean,
  registration_open boolean,
  organizer_user_id uuid references public.profiles(id) on delete cascade,
  discussion_post_id uuid unique references public.posts(id) on delete set null,
  availability text not null default 'visible' check (availability in ('visible','unavailable','hidden')),
  hidden_reason text check (hidden_reason in ('admin','post_removed')),
  cancelled_at timestamptz,
  status_note text check (char_length(status_note) between 1 and 80),
  previous_starts_at timestamptz,
  schedule_changed_at timestamptz,
  revision integer not null default 1,
  review_flag text check (review_flag in ('title_says_cancelled','source_time_changed_near_start')),
  duplicate_of uuid references public.community_events(id) on delete set null,
  content_hash text,
  source_updated_at timestamptz,
  last_checked_at timestamptz,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  missing_since timestamptz,
  missing_checks smallint not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint community_events_region_check check (region in ('cu')),
  constraint community_events_source_unique unique (source_type, source_key),
  check (ends_at is null or ends_at >= starts_at),
  check (duplicate_of is null or duplicate_of <> id),
  check ((availability = 'hidden') = (hidden_reason is not null)),
  check (cancelled_at is null or source_type = 'member'),
  check (source_type = 'member' or coalesce(title, '') <> '' or coalesce(title_en, '') <> ''),
  constraint community_events_caaci_shape check (source_type <> 'caaci' or (
    source_key ~ '^[0-9a-f-]{36}$'
    and page_url ~ '^https://caaciorg[.]com/events/#[A-Za-z0-9-]+$'
    and (register_url is null or register_url ~ '^https://caaciorg[.]com/events/[a-z0-9-]+/register/$')
    and registration_mode in ('caaci_site','info_only')
    and partner_id is null and organizer_user_id is null)),
  constraint community_events_partner_shape check (source_type <> 'partner' or (
    partner_id is not null and consent_ref is not null
    and page_url ~ '^https://' and (register_url is null or register_url ~ '^https://')
    and registration_mode in ('external_link','info_only')
    and ((registration_mode = 'external_link') = (register_url is not null))
    and coalesce(summary, '') <> '' and organizer_user_id is null)),
  constraint community_events_campus_shape check (source_type <> 'campus' or (
    source_key ~ '^[0-9]{1,6}/[0-9]{1,12}$'
    and page_url = 'https://calendars.illinois.edu/detail/' || source_key
    and register_url is null and registration_mode = 'calendar_page'
    and organizer_name is not null and coalesce(title_en, '') <> ''
    and partner_id is null and organizer_user_id is null)),
  constraint community_events_member_shape check (source_type <> 'member' or (
    organizer_user_id is not null and source_key ~ '^[0-9a-f-]{36}$'
    and page_url is null and register_url is null
    and registration_mode = 'discussion' and title is null and title_en is null
    and occurrence_count = 1 and char_length(location) between 1 and 80))
);

create index community_events_list_idx on public.community_events (region, starts_at, id)
  where availability = 'visible' and duplicate_of is null;
create index community_events_organizer_idx on public.community_events (organizer_user_id, starts_at)
  where source_type = 'member';
create index community_events_campus_check_idx on public.community_events (last_checked_at nulls first)
  where source_type = 'campus' and availability <> 'hidden';

create table public.community_event_sync_state (
  source text primary key check (source in ('caaci','campus')),
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_outcome text check (last_outcome in ('ok','partial','failed')),
  last_error_code text check (last_error_code ~ '^[a-z0-9_]{1,40}$')
);
```

`source_key` 的取值：caaci 为官网活动 id；campus 为 `<日历 id>/<活动 id>`；partner 为 `<组织 slug>|<规范化 page_url>`（小写 scheme 和 host，去掉 fragment 和末尾斜杠）；member 为讨论帖 id 的文本。这样同一来源的同一场活动由唯一约束挡掉重复。

状态与列的对应（文案见 SPEC.md「活动」状态表）：

| 状态 | 由什么推导 |
|---|---|
| 正常 | `availability='visible'`，无下列条件 |
| 进行中 | `now()` 在 `starts_at` 与有效结束时间之间 |
| 时间已更新 | `schedule_changed_at` 在 14 天内，显示 `previous_starts_at` |
| 发起人已取消 | member 行 `cancelled_at` 非空；卡片留到原定结束时间 |
| 来源已撤下 | `availability='unavailable'` |
| 已下架 | `availability='hidden'`，或合作组织不再是 active（RLS 直接读不到） |
| 已结束 | `now()` 晚于有效结束时间 |

- 有效结束时间 = `coalesce(ends_at, starts_at)`，与官网判断「未结束」的规则一致（`functions/api/_volunteers.js:28`）。全天和多日的学校活动在导入时写好 `ends_at`（§9.3），所以落在 `coalesce` 第一项。SQL 和客户端 `eventEffectiveEnd`（`app/src/utils/eventTime.ts`）各写一份，用同一张 fixture 表测试。
- `cancelled_at` 只给 member 行用（约束挡住其他来源）。合作组织活动取消时由官方账号 `hide_event`；同步来源（caaci、campus）在来源提供状态字段之前不显示「已取消」，系统也不从标题或正文推断取消。

权限：
- 三张新表先 `REVOKE ALL ... FROM PUBLIC, anon, authenticated`。
- `community_events` 对 anon、authenticated 授白名单列的 SELECT。白名单不含 `content_hash`、`missing_since`、`missing_checks`、`last_checked_at`、`first_seen_at`、`last_seen_at`、`source_updated_at`、`review_flag`、`hidden_reason`、`consent_ref`、`created_by`。
- 公开读策略：`availability = 'visible' and (partner_id is null or exists (select 1 from public.community_event_partners p where p.id = partner_id and p.status = 'active')) and (source_type <> 'member' or moderation_private.profile_content_visible(organizer_user_id))`。只有 `visible` 行对外可读（P4.2 ④）。后果：「来源已撤下」「已下架」的行对读者整行不可见，详情页拿不到来源，只能显示一句通用的「这场活动已不再展示」；按来源区分的横条文案只在客户端已缓存该行时用得上。
- 发起人自读策略：`organizer_user_id = (select auth.uid())`，发起人能看到自己已被下架的活动。
- 【留给 P4.6 的迁移；20261120122054 不授，D-54 第 2 项 l】INSERT 只授 authenticated，限 `source_type, source_key, organizer_user_id, discussion_post_id, starts_at, ends_at, location, registration_mode` 这些列。WITH CHECK `source_type = 'member' and organizer_user_id = (select auth.uid())`。
- 【留给 P4.6 的迁移；20261120122054 不授】UPDATE 只授 `cancelled_at, status_note` 两列，USING 与 WITH CHECK 同上；V5 不支持改时间地点（SPEC.md「活动」网友发起一节）。不授 DELETE。
- `community_event_partners`：anon、authenticated 只有 `SELECT (id, slug, name_zh, name_en, status, allowed_link_hosts)`，策略 `status = 'active'`。
- `community_event_sync_state`：全部列对 anon、authenticated 只读，里面没有秘密。
- caaci、campus 行只经 service_role 的 RPC 写；partner 行只经管理动作写；member 行的插入被下面的守卫限定为 `create_member_event` 一条路。

触发器：
- `community_events_touch`：BEFORE UPDATE，写 `updated_at`。
- `community_events_schedule_change`：BEFORE UPDATE，caaci、partner、campus 共用。`starts_at` 变了就写 `previous_starts_at = OLD.starts_at`、`schedule_changed_at = now()`、`revision + 1`；只有 `location` 变时 `revision + 1`。
- `community_events_member_guard`：BEFORE INSERT OR UPDATE，只管 member 行；UPDATE 时在 `location`、`status_note`、`starts_at`、`ends_at` 有变化，或 `cancelled_at` 被写入、改动时检查：已写的 `cancelled_at` 不能清空或改值，新写的由服务器记成 `now()`，写入非空的 `status_note` 前先过 `assert_posting_allowed`，时间、地点、说明按下表查；外键置空等系统更新不经它。

| 检查 | 错误码 |
|---|---|
| INSERT 时讨论帖属于 `auth.uid()`、`status='active'`、`category='events-social'`，且 `post.created_at = now()`（同一事务里刚建；客户端没有 `created_at` 的 INSERT 权限，直接写表做不到） | `member_event_rpc_required` |
| `profiles.is_illini_verified` 为真；受限账号先被 `assert_posting_allowed` 以 `suspension_active` 拒绝 | `member_event_not_eligible` |
| `starts_at` 晚于 `now()`，且不晚于 `now() + interval '60 days'` | `member_event_time_out_of_range` |
| 本人未结束、未取消的活动已有 2 场 | `member_event_active_limit` |
| 讨论帖标题，以及写入或改动的 `location`、`status_note` 匹配 `(?i)(官方\|主办\|official\|hosted by)` | `member_event_reserved_wording` |
| 讨论帖标题、正文，以及写入或改动的 `location`、`status_note` 匹配 `(?i)(https?://\|www[.]\|[a-z0-9-]+[.](com\|net\|org\|edu\|cn\|io\|me\|ly\|link)\b)` | `member_event_link_not_allowed` |
| UPDATE 把已写上的 `cancelled_at` 清空或改值 | `member_event_cancel_final` |

- `community_events_post_link`：BEFORE UPDATE OF `discussion_post_id`，member 行被外键置空（作者删帖）时写 `availability='hidden'`、`hidden_reason='post_removed'`。
- `posts` 上新增 AFTER UPDATE OF `status` 触发器：话题变成 hidden 或 deleted 时，对应 member 行写同样的隐藏；话题恢复 active 时，清掉原因为 `post_removed` 的隐藏。

举报：网友发起活动的举报落在它的「找搭子」话题上（`target_type='post'`），组织活动的「信息有误」走邮件（SPEC.md「活动」详情页）。`reports_target_type_check` 不改，举报快照函数不重写。

RPC 与管理动作见 §9；VERIFY 断言上面每一条约束、策略、列权限，以及每个 RPC 的 SECURITY 属性和 EXECUTE 授权。

本批数据库不建的列（SPEC 列为 P6 候选）：首发人工核对状态、7 天新建上限、人数上限、费用、结伴关联、改期，以及官网 feed 的志愿者链接与状态字段。加这些要另起迁移。

---


#### 第八批（D-54）补记：P4 迁移相对本节新增或改变的对象（STOP-16a，L161）

- 新函数 `private.community_events_moderate_text()` 与触发器 `community_events_moderate_text`（public.community_events，BEFORE INSERT OR UPDATE OF location, status_note）：四种来源的地点和状态说明都过关键词审核；链接与保留词检查只在成员守卫里，只管成员活动。
- 新约束 `community_events_unavailable_check`；`community_events_time_order_check` 改成要求时间是有限值；合作组织行的形状约束多了 consent_ref 的格式。
- 公开 SELECT 策略多了 180 天的条件（发起人读自己活动的策略不变）。
- 迁移不再给 authenticated 成员活动的 EXECUTE、INSERT、UPDATE，留给 P4.6 的迁移授予（要授予的三项和列名写在迁移注释里）。
- `hide_event`、`unhide_event` 幂等，审计 details 多一个 changed；`unhide_event` 可能恢复成 unavailable。
- 新的拒绝：22023 `moderation_block:event_location`、`moderation_block:event_status_note`；成员路径结束时间晚于开始后 30 天（D-54 第 2 项 m）沿用 `member_event_time_out_of_range`。

#### 第九批（D-55）补记：P4 迁移相对本节新增或改变的对象（STOP-16a，L197）

- `public.admin_list_moderation_audit_log(integer,integer,text)`：本迁移 CREATE OR REPLACE，白名单只加 `event_hidden`、`event_unhidden`；`event_discussion_created` 不加，照 P3 迁移的规则留在 owner 的列表里（`admin_list_owner_audit_log` 没有白名单）。RETURNS TABLE、LANGUAGE sql STABLE SECURITY DEFINER、search_path、授权都照 P3 原样。迁移守卫与 PRECHECK 钉它在 P3 之后的 md5 `42d02d7ac06498a48e2172c35d5ff517`，VERIFY 钉本迁移给出的 `720fe81c9d72c7729ce2d184a8a8fd36`（mig:P4-B8-4）。
- `community_events_member_shape`：末项改成 `location IS NOT NULL AND location = pg_catalog.btrim(location) AND char_length(location) BETWEEN 1 AND 80`，空白和 NULL 都以 23514 被拒（mig:P4-B8-1）。
- 新约束 `community_events_all_day_end_check`：`CHECK (NOT all_day OR (ends_at IS NOT NULL AND ends_at > starts_at))`，全天活动必须有结束时间且晚于开始（mig:P4-B8-5）。
- 钉住的 P3 函数体随 P3 第九批改动重算：`admin_execute_community_governance` 改为 `fedabd431c829a5b2303e4a46961a855`（VERIFY）。
- 本迁移应用之后，P3 的 VERIFY 按设计不再通过（它钉的 `admin_list_moderation_audit_log`、`admin_execute_mutation` 与第 6 节的词表、能力行都被本迁移改过），第一条报错是 `community_watch_save_function_body:public.admin_list_moderation_audit_log(integer,integer,text):720fe81c9d72c7729ce2d184a8a8fd36:this migration`（L199）。已应用 P4 的库，回复通知开关第 1 步改看 VERIFY_20261120122054（P4 分支仓库根目录 RUNBOOK.md「Reply notice switch」）。

#### 第十一批（D-57）补记：成员活动写入开关与规整（STOP-16a）

- 前向迁移 `20261122035253_community_member_events.sql` 接在 `20261120100354`、`20261120122054` 之后。
- 新表 `private.community_member_event_config` 只有 `singleton=true` 一行，`enabled` 默认 false；启用 RLS，并撤销 PUBLIC、anon、authenticated、service_role 对表的全部权限，由 owner 操作开关。`public.community_member_events_open()` 是返回 boolean 的 STABLE、SECURITY DEFINER 函数，search_path 为 pg_catalog、statement_timeout 为 3s；只给 anon、authenticated EXECUTE，缺行也返回 false。
- 成员活动 INSERT 在开关关闭时返回 `member_events_closed`（P0001）。取消自己的活动不检查开关；不带状态说明的取消也不受发帖限制。已经成功的同账号、同 post_id 重试可以返回原关联，不再创建第二份。
- N 规整把 U+0009–000D、0020、0085、00A0、1680、2000–200A、2028、2029、202F、205F、3000、FEFF 的连续空白替换成一个普通空格，再去掉两端普通空格。RPC 将标题和地点按 N 写入；UPDATE 的状态说明 `status_note` 按 N 处理，空白结果变成 NULL。讨论帖正文仍交给帖子路径处理，不用 N 重排正文。
- `community_events_member_shape` 沿用既有的 `occurrence_count=1`；本次把地点的去空格相等条件改为等于 N(location)，保留非 NULL、长度 1–80，并增加状态说明为 NULL 或等于 N(status_note)。标题和地点的长度、链接及保留词检查以规整后的值为准。
- 本迁移授予 authenticated 以下三项，成员写入继续受现有 RLS 和触发器约束：

```sql
GRANT EXECUTE ON FUNCTION public.create_member_event(uuid, text, text, jsonb) TO authenticated;
GRANT INSERT (source_type, source_key, organizer_user_id, discussion_post_id, starts_at, ends_at, location, registration_mode) ON TABLE public.community_events TO authenticated;
GRANT UPDATE (cancelled_at, status_note) ON TABLE public.community_events TO authenticated;
```

- 开关默认关闭；打开的权限、前提和 VERIFY 顺序见代码分支 RUNBOOK「Member events switch」。托管应用、staging S-1 和实际打开开关由 Eric 或他点名批准的人执行。

## 6. 兼容矩阵与发布顺序（P2.9 ④）

小程序从未提审、发布（见 [STATUS.md](STATUS.md)），没有已安装的旧版小程序，矩阵里不列。

| 客户端 × 帖子 | 列表 | 详情 | 搜索 | 分享预览 |
|---|---|---|---|---|
| 旧 H5（7b18f20，未刷新的标签页）× 动态 | 不变 | 不变 | `search_posts_fuzzy`，不变 | 由服务端版本决定（末行） |
| 旧 H5 × 话题 | 显示成无标题的动态卡，只有正文（旧 `POST_COLUMNS` 不含 `title`，`usePlaza.ts:72-73`） | 同列表 | `search_posts_fuzzy` 只匹配正文和昵称，标题里的词搜不到 [本地测：scripts/community-post-topics.test.mjs，用只在标题里的词调旧 RPC 得 0 条] | 同上 |
| 新 H5 × 动态 | 原卡片 | 原样 | `search_community_posts`，匹配正文 | 同上 |
| 新 H5 × 话题 | 标题、板块、元信息行 | 标题加正文 | `search_community_posts`，匹配标题和正文 [本地测：P2.4 的 community-post-topics.spec.ts；PG 断言见 scripts/community-post-topics.test.mjs] | 同上 |
| 新小程序 × 动态、话题 | 同新 H5 | 同新 H5 | 同新 H5 | 走 `onShareAppMessage`，话题用标题（≤50 字，P2.10），不经 share-post.js |
| 服务端 share-post.js | — | — | — | P2.9 部署前：OG 标题 = 正文首行（`posts_visible` 缺 `source_lang` 时一律是兜底文字，§13 缺口 1）；部署后（#369 P2.9）：`title` 去掉首尾空白后非空就用 `title`（最多 120 字），否则用正文首行，后面都接「— 作者」[本地测：api/_share-boundary.test.mjs 四种情况]。新 share-post.js 的查询带 `title`，如果早于 20261112120000 上线，`posts_visible` 没有 `title` 列会返回 400，所有帖子都退回兜底文字，所以同样必须先迁移 |

- 英文界面里的标题按原文显示（§5.2），P2 阶段标题不翻译；`title_i18n` 已在 BACKLOG P6.1 的候选里。
- 新客户端连到未迁移的库：`POST_COLUMNS` 读 `title, category` 返回 400，社区页打不开。CI run 43212596901 的两例公开巡检失败就是这种情况（STATUS.md）。所以顺序永远是先迁移、后前端（仓库 RUNBOOK.md「Schema-coupled release order」）。
- 发布顺序（D-12）：Eric 在生产应用迁移并跑 VERIFY → H5 按 `docs/SUPERVISED_RELEASE.md` 发布，小程序同一天提审和发布（P5.2）。
- 小程序首次发布之后的硬规则：后续迁移只能新增可空或带默认值的列，不删除、不改名已发布版本会读的列和 RPC 参数；RPC 的返回形状要变时用新函数名（先例：`search_community_posts` 与 `search_posts_fuzzy` 并存）。
- 回退：H5 按 仓库 RUNBOOK.md「Deploy rollback」把上一个生产部署 promote 回来；小程序走微信后台的版本回退。首个版本没有可回退的旧版本，出问题只能暂停服务，这项能力未核实（§13 缺口 4）。数据库只向前修（仓库 RUNBOOK.md「A specific migration broke the DB」、「Migration roll-forward」）。

---

## 7. 首页数据读取（HOME.2、HOME.3）

首页不新增 RPC。社区页加载时并行发下面这些请求，结果交给纯函数 `buildHomeSections(posts, items, events, now, viewport)`（`app/src/utils/communityHome.ts`）。

| # | 请求 | 用途 |
|---|---|---|
| 1–5 | 每个板块一个：`posts` `.eq('region', ACTIVE_REGION).eq('status','active').eq('category', slug).order('is_pinned',{ascending:false}).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(8)` | 板块卡（取 8 条，给同作者 ≤2 条和去重留余量）；走 `idx_posts_category_feed` |
| 6 | 全站最新：同上但不按板块，加 `.not('title','is',null)`，`limit(40)` | 「全站最新」 |
| 7 | 本周计数：`posts` `.select('category')`，条件同上，加 `.gte('created_at', now - 7 天)`，`limit(1000)`，在客户端计数 | 「本周 N 新帖」（每周超过 1,000 条话题之前结果准确） |
| 8 | 二手：现有商品 feed 首页，`limit(6)`，只取 active | 「二手好物」 |
| 9 | 热议候选（只在 #7 里有 ≥5 条 7 天内、`comment_count ≥ 3` 的话题时才发）：取这些帖的 `post_comments` `select('post_id,user_id')`，在客户端数不同的非作者用户 | 「本周热议」阈值 |
| 10 | 活动（P4.8 之后）：`list_community_events` 取未来 30 天、只要 caaci、partner、campus，`limit_in = 3` | 「近期活动」 |

- 首页只取话题（`title IS NOT NULL`）。动态只出现在「全部讨论」。
- P3.1 合并后，#1–#6 改按 `last_activity_at` 排序。
- 判断：冷启动阶段有 20–60 条帖子，10 个并行请求可以接受；首页加载的 p95 超过 1.5 秒时，再合并成一个 SECURITY INVOKER 的 RPC。

---

## 8. 文件与页面结构（P2–P4 新增）

| 路径 | 包 | 说明 |
|---|---|---|
| `app/src/utils/region.ts` | — | §4 |
| `app/src/utils/communityHome.ts` | — | §7 |
| `app/src/utils/eventTime.ts` | — | 基于 `campusPartsNoIntl`，小程序没有 Intl 也能用 |
| `app/src/utils/eventLinks.ts` | — | `openExternalLink(url, extraHosts)` 与中文链接换算，§9.8 |
| `pages/events/index` | 主包 | P4.10 之后是 tab 页，tab 页必须在主包 |
| `pages/event/detail/index`、`pages/event/create/index` | 分包 root `pages/event` | 分包根目录下的文件都归该分包；详情若放在 `pages/events/` 下，会把 tab 页一起带进分包，所以另起 `pages/event/` |
| P3 新页面（我的收藏、订阅的话题等） | 各自分包 | P3.8 |
| `api/_community-events.js` | — | 归一化、状态推导、去重、外链白名单的纯函数 |
| `api/_community-events-sync.js` | — | 同步模块，由 `api/background-jobs.js` 调用 |
| `api/_campus-ics.js` | — | ICS 解析 |
| `api/_campus-time.js` | — | 复制 `campusWallClockToInstant` 的算法，配对照测试 |
| `scripts/sync-community-events.mjs` | — | `--dry-run --source caaci`，只读请求一次，打印归一化结果，不写库 |

同步模块的文件名带下划线前缀：`api/` 下不带下划线的文件会成为独立的 Vercel 函数（`scripts/vercel-function-boundary.test.mjs:50` 按下划线前缀排除），多出一个公开入口，函数清单测试也会变。

---

## 9. 活动接入（P4）

产品规则（四种来源、卡片、状态、去重、网友发起限额、空态）在 SPEC.md「活动」。本节写表以外的接口合同、同步、RPC 与管理动作、错误码和测试。

### 9.1 官网接口 `GET /api/public-events` v1（P4.3，D-11）

- 仓库与文件：`a2751012962/caaciorg` 新增 `functions/api/public-events.js`，只导出 `onRequestGet`。读取用 `sb(env).select('events', { columns: 'id,slug,title,title_zh,description,description_zh,starts_at,ends_at,location,registration_questions,published', order: 'starts_at.asc,id.asc', limit: 201 })`，不需要官网迁移。
- 交付路径：OMO 在 fork `EricXu-0805/caaciorg`（D-31 / E8 给权限之后）建分支 `feat/public-events-feed`，PR 开向 `preview`；本地在 Node 20 和 24 上跑通 caaciorg CI 的同一组步骤（命令见 BACKLOG P4.3）。官网维护者（GitHub a2751012962，身份待 Eric 确认，§13 缺口 7）审阅、合并，再发布 `preview → main`。官网 `main` 只收 `preview`、`release/*`、`hotfix/*`（caaciorg 仓库 README.md:83-90）；beta 和分支预览都在 Cloudflare Access 后面，Illini 服务端读不到，所以只能在上线后验收。

参数：

| 参数 | 含义 | 错误 |
|---|---|---|
| `window=upcoming`（默认） | `published` 且 `(ends_at ?? starts_at) >= now`，与 `functions/api/_volunteers.js:28` 的 `upcomingEventFilters` 同一规则 | — |
| `window=recent` | 下限改为 now − 180 天 | — |
| `id=<uuid>` | 单条；未发布和不存在都回 404 `{"error":"not_found"}` | — |
| `window` 取其他值 | — | 400 `{"error":"invalid_window"}` |

响应（200，`cache-control: public, max-age=60`；不加 CORS 头，不读 Authorization）：

```json
{
  "schema": "caaci.public-events.v1",
  "generated_at": "2026-11-12T20:00:00Z",
  "complete": true,
  "events": [{
    "id": "uuid",
    "slug": "lunar-new-year-2027 或 null",
    "title_en": "string（取 events.title，可能是中文）",
    "title_zh": "string 或 null",
    "summary_en": "description 转纯文本、折叠空白、取前 280 字；或 null",
    "summary_zh": "同上，取 description_zh；或 null",
    "starts_at": "ISO 8601 UTC",
    "ends_at": "ISO 8601 UTC 或 null",
    "time_zone": "America/Chicago",
    "location": "string 或 null",
    "takes_registrations": true,
    "registration_open": false,
    "page_url": "https://caaciorg.com/events/#<slug 或 id>",
    "register_url": "https://caaciorg.com/events/<slug>/register/ 或 null",
    "content_hash": "sha256:<对以上字段的规范化 JSON 求值>"
  }]
}
```

- `complete`：取 201 行，实际行数 ≤200 时为 true。
- `takes_registrations` = `slug` 非空且 `registration_questions` 是数组，与 `web/src/lib/events.ts:194` 的 `takesRegistration` 相同；`registration_open` 复用 `functions/api/_event-form.js:235` 的 `registrationOpen`。
- 链接规则照 `web/src/lib/events.ts:196-216`：`page_url` 用 `eventAnchor`（`slug ?? id`）；`register_url` 只在 `takes_registrations` 为真时给出。官网另有志愿者页 `/events/<slug>/volunteer/`（`events.ts:201-208`），SPEC 没有志愿者按钮，v1 不输出它。
- 不输出：`registration_questions`、`volunteer_questions` 原文、`perk_*`、`image_url`、`created_at`，以及任何报名、志愿者、会员数据或计数。
- 500 固定回 `{"error":"unavailable"}`，不回传 `e.message`。现有 `functions/api/articles.js:97-99` 出错时用 `bad(e.message, 500)` 把上游原文带进正文，新接口不照抄这个写法。
- 官网测试：`test/api-auth-gates.test.js` 的 `UNGATED`（:48 起）加一条 `'functions/api/public-events.js onRequestGet'`，理由写「只含已发布活动；字段已在 /events/ 公开；不含报名人和会员数据」。新增 `test/public-events.test.js`，至少断言三件事：选的列不含报名表原文；`slug` 为 null 时 `page_url` 用 `#<id>`、`register_url` 为 null；500 正文里没有 `supabase`。
- 上线验收（P4.3 ⑤）：从工作站请求一次 `https://caaciorg.com/api/public-events?window=upcoming`，返回 200 JSON；Vercel 生产出口能否访问，由 P4.11b 的同步结果（`last_outcome = 'ok'`）证明。返回 403 时请官网维护者在 Cloudflare 放行该路径，社区侧不伪造 UA、不走代理。判别：handler 自己的错误一律是 `application/json` 加 `{"error":...}`；边缘拦截通常是 `text/html`，常带 `cf-mitigated` 头。
- v2（P6.1 候选）：官网新增迁移 `0042_event_status.sql`，给 `events` 加 `status text not null default 'scheduled' check (status in ('scheduled','cancelled','postponed'))` 和 `updated_at timestamptz not null default now()`；`functions/api/admin/events.js` 的 POST 每次写 `updated_at`；feed 升为 `caaci.public-events.v2`。官网 `events` 表现在只有 `published` 布尔，没有状态和更新时间（`supabase/migrations/0001_init.sql:40-51`），删除是硬删除，所以 v1 只能推出「来源已撤下」，推不出「已取消」。

### 9.2 社区侧同步 CAACI 活动（P4.4）

- 触发：`api/background-jobs.js` 在孤儿上传清理循环结束后、`purge_completed_background_jobs` 之前，开关打开且剩余预算 >12 秒才调用 `api/_community-events-sync.js`；不足时新增的同步计数为 `skipped_budget`。不新增 cron，不改 `vercel.json`。不能把 `releasedCron` 当成「只在生产执行」的开关：非生产也转入 `monitoredCron`（`api/_cron-release.js:75-79`），Production 才额外核发布身份。
- 开关只认 `process.env.COMMUNITY_SYNC_CAACI_EVENTS === '1'`；只在 Vercel 的 Production 设置，由 Eric 操作。没设或值不是 `1` 时，不请求、不调同步 RPC、不写 sync_state，background-jobs 响应的键与原来相同。开关打开时 counts 增加本次 outcome；claim 返回 false 为 `not_due`。学校开关 `COMMUNITY_SYNC_CAMPUS_EVENTS` 由 D-61 接线：同样只认 '1'，只设在 Production，由 Eric 操作；没设时不请求、不调任何学校 RPC，background-jobs 响应的键不变。D-61 只做刷新，导入留 D-62，所以开关打开以后、有学校行之前，worker 只领取和收尾。
- 设置、删除开关之后都要新的生产部署才生效，发布照 E13。要立即停止后续领取、不等部署，由 Eric 在 SQL 编辑器以 postgres 执行 `INSERT INTO public.community_event_sync_state (source, last_attempt_at) VALUES ('caaci', 'infinity') ON CONFLICT (source) DO UPDATE SET last_attempt_at = 'infinity'`；没有状态行时也有效。恢复时把该行 last_attempt_at 改回 NULL。finish 不写 last_attempt_at，所以 infinity 会一直阻止 claim。关掉同步后，已入库行既不更新，也不再记缺席。开关前置和应用顺序见仓库根 RUNBOOK 的「Community P4」「CAACI events sync」。
- 前向迁移 A（`20261123201501_community_event_sync.sql`，sha256 前 8 位 bb2f91e6，全值以 manifest 为准）仅提供三个函数（B `20261125004742_community_event_sync_cap.sql` 只用 CREATE OR REPLACE 换掉其中的 apply_caaci_event_snapshot，把缺席计数封顶为 2）：`claim_community_event_sync(source_in text, interval_in interval) returns boolean`、`apply_caaci_event_snapshot(complete_in boolean, rows_in jsonb) returns jsonb`、`finish_community_event_sync(source_in text, outcome_in text, error_code_in text) returns boolean`。三者均 SECURITY DEFINER、owner postgres、`SET search_path = pg_catalog`；撤销 PUBLIC/anon/authenticated EXECUTE，只授 service_role，不改既有表、触发器、策略或授权。claim/finish 结果只认 `=== true`；不用 void，避免 PostgREST 的204空正文被 rpc() 记成 provider_malformed。
- 领取用一条语句解决初次没有状态行和并发：
  `INSERT INTO public.community_event_sync_state AS s (source, last_attempt_at) VALUES (source_in, now()) ON CONFLICT (source) DO UPDATE SET last_attempt_at = now() WHERE s.last_attempt_at IS NULL OR s.last_attempt_at < now() - interval_in RETURNING true`。
  返回行就是 true，没有返回行就是 false；间隔边界严格小于，正好相隔 interval 不领取，infinity 也不领取。source_in 只允许 caaci/campus，其他值由既有表约束报23514。CAACI 间隔为12分钟，是同步模块导出的常量，测试读同一个常量（D-59.2b）。
- 预算：模块只收 deadline、call 和注入的 fetch，不收 serviceCall、不读 Supabase 密钥、不自行构造 RPC 请求。background-jobs 的 call 只增加可选第三参 timeoutMs，执行 `rpc(origin, name, args, timeoutMs == null ? timeLeft() : Math.min(timeoutMs, timeLeft()))`；原调用不改，不传第三参时行为与原来相同。claim、上游、apply、finish 每步开始前重新计算 `min(5000, deadline - Date.now() - 5000)`，给 call 第三参或 fetchBounded.timeoutMs，给 purge/status 保留至少5秒。
- 某一步的预算不足1000毫秒就停在它之前，outcome=failed、code=deadline。已claim但finish也放不下时，只记日志、不调finish；因此deadline不写入sync_state，下一次须等满领取间隔。claim本身报错则code=claim_failed，不调finish；没有成功领取，因此可能每分钟报告一次，打开开关前必须确认 Community P4 列出的全部迁移已应用并 VERIFY。
- 请求用 `fetchBounded`：固定 `https://caaciorg.com/api/public-events?window=recent`，上限256 KB，`redirect: 'manual'`，超时按上述预算且最多5秒；请求头只有 `accept: application/json` 和 `user-agent: CornfieldSync/1 (+https://www.illinimarket.com)`，不携带授权或cookie。D-59期间真实请求0次；dry-run脚本只实现 `--dry-run --source caaci`，等P4.3上线后，才按RUNBOOK §12第2条允许一次GET，不读数据库环境变量、不写库。
- 归一化仍用 `normalizeCaaciEvents`（`api/_community-events.js`）：schema不符为schema_mismatch；隐私字段检测照原样，任何id不是UUID仍使整份bad_json。投影只选数据库白名单列，不能把含partner_name_zh、allowed_link_hosts、comment_count等的卡片对象直接交给apply。
  - `source_key ← id.toLowerCase()`；`title ← title_zh`、`title_en ← title_en`、`summary ← summary_zh`、`summary_en ← summary_en`、`organizer_name ← 'CAACI'`、`registration_mode = takes_registrations ? 'caaci_site' : 'info_only'`，其余同名白名单字段；starts_at、非空ends_at投影时都用 `new Date(v).toISOString()`。
  - 中文链接仍由 `app/src/utils/eventLinks.ts` 把 `/events/` 换成 `/zh/events/`、报名页加 `?lang=zh`；前端不从slug另拼地址。
- apply在一个事务内按来源/key对账，只认caaci行和白名单列：
  1. 有效行upsert，写last_seen_at（新行另写first_seen_at）、复位missing_checks/missing_since；unavailable重现时回visible，hidden可更新字段但保持hidden。
  2. 改期交给既有community_events_schedule_change；新的开始时间在48小时内时标source_time_changed_near_start。既有触发器不改。
  3. 每一行单独的PL/pgSQL子事务只捕获23514、23502、23505、22001、22023；其他错误让整个apply失败，不能吞掉。被拒但key有效的行仍算看到了：原visible/hidden复位缺席计数、清空missing_since，其他字段和可见性不动；原unavailable保持状态、计数和missing_since全部不动。返回rejected计数；有拒绝行时outcome仍可为ok/partial，error_code写rows_rejected。
  4. apply再查source_key格式；任一坏key使该行计入rejected，整份降成partial，只upsert其余行，不记缺席，防止坏数据把整库活动撤下。
     返回JSON仅含 `{ complete: boolean, rejected: integer }`；complete为最终值，worker以它决定ok/partial，避免坏key降级信息丢失（D-59实现选择）。
  5. 只有最终complete为true才处理未出现且有效结束时间≥now()−179天的caaci行：missing_checks加1并封顶2（B 起为 `LEAST(missing_checks + 1, 2)`；A 原式没有上限，列是smallint，一行连续缺席约273–296天后每次完整apply都报22003整体回滚，推算）；第一次缺席时写missing_since；连续两次完整快照都缺席转unavailable，hidden保持hidden。rows_in为空的最终完整快照照常记缺席，不设守卫（v1 唯一的取消信号是删除，守卫会让最后几场被删的活动撤不下来）；worker 把这次的码记为 empty_snapshot，outcome 仍为 ok，不报 Sentry。读missing_checks的只有unavailable_check和unhide_event，都判>=2。partial只upsert，最终last_outcome为partial。
- 撤稿时限仍为30分钟。推算（非实测）：来源缓存最坏60秒，cron每分钟一次、每拍0–10秒抖动，claim严格小于；14分钟领取间隔最坏约31分钟，改12分钟后约27分钟。此推算假定每一拍剩余预算都>12秒；被预算跳过的拍会顺延撤稿时间。确定性节奏测试遍历完整周期内每一秒撤下的情形，并分别用「成功领取的拍10秒、其他拍0秒」、全0、全10三种抖动；把模块常量改成14分钟必须使30分钟断言变红。
- finish只写last_outcome、last_error_code，以及ok或partial时的last_success_at；failed保留旧last_success_at，不写last_attempt_at。SPEC的核对灰字读取last_success_at。模块不会向background-jobs外层抛错：错误只分类，能放下finish时记failed；finish自己失败只记一次日志，不重试finish，后续purge/status仍执行。
- failed、partial或rejected>0时，在background_job_status之后、return之前，按现有reportToSentry用法报告一次：message固定 `community events sync needs attention`，extra仅 `{ outcome, code, rejected }`；code与finish参数一致，没调finish的deadline/claim_failed也报告。不在同步与purge之间等待Sentry；日志、Sentry和finish参数不含上游正文。
- 内容现状：2026-11-12活动设计调研从Mac请求官网 `/api/volunteer`，返回0场未结束的已发布活动。官网有活动之前，活动页主要靠学校和合作组织来源。

### 9.3 UIUC 校历（P4.7；接入方式由 D-33 选）

2026-11-12 活动设计调研的只读请求（每个地址一次）测得下面这些事实，P4.7 第一步由 OMO 重新请求核对，写进 `appendix/research/campus-events.md`：
- 单条活动的日历文件：`https://calendars.illinois.edu/icalGmail/{calendarId}/{eventId}.ics?hourOffset=0&timeZone=America%2FChicago`，不需要 key。`3715/33558080` 返回 200 `text/calendar`，1,359 字节；不存在的 id 返回 404 `text/html`。被撤下的活动返回什么没有验证（§13 缺口 8）。
- 系列活动 `852/33560645` 返回 92 个 VEVENT、150,535 字节，UID 从 `33560645-1@illinois.edu` 排到 `-92@illinois.edu`。
- 综合日历 7 的导出有 1,533 条、约 2.2 MB，跨天展览按天拆开，一场展览占 92 条；国际学生办公室日历（ISSS）3715 有 46 条，其中 11月12日至 12月14日的 22 条里有 14 条是咨询时段或学期日期。DTSTART 有三种写法：不带参数的浮动时间、`;VALUE=DATE-TIME`、`;VALUE=DATE`；每个 VEVENT 另有一行不合标准位置的 `TZID:America/Chicago` 属性。
- 日历 7、3715、852 里都没有 STATUS 属性；ORGANIZER、CONTACT 是个人邮箱；URL 属性是带 key 参数的 http 地址。
- XML 接口要向 Illinois Web Services 申请 key。V5 两种方式都只用公开的 ICS 导出，不申请 key。
- 整本日历导出的地址格式没有记录，由 `campus-events.md` 给出；拿不到官方导出、只能抓 HTML 时，停（STOP 清单）。

两种接入方式共用的部分：
- 允许的日历写成常量 `CAMPUS_CALENDARS = [{ id, name_zh, name_en, exclude_patterns }]`（`api/_community-events.js`）。D-33 之前它为空，所有学校活动的写入都返回 `campus_calendar_not_allowed`。
- 解析 `api/_campus-ics.js`：先展开折行（CRLF 后跟空格或 tab），再反转义 `\\`、`\;`、`\,`、`\n`；只读 UID、SUMMARY、DTSTART、DTEND、LOCATION、LAST-MODIFIED 和 TZID 属性；DESCRIPTION、ORGANIZER、CONTACT、URL 丢弃，不进返回对象。TZID 不是 America/Chicago → `campus_unexpected_tz`；一份文件里 VEVENT 累计超过 400 个（整份累计，不按 UID 分组，api/_campus-ics.js 第 74 行）→ `campus_too_many_occurrences`；normalizeCampusEvent 另外检查单行的 occurrence_count。VEVENT 层出现 RRULE、RDATE、EXDATE、EXRULE、RECURRENCE-ID、DURATION（不分大小写，D-61 第 8 项）整份报 bad_ics（v1 不展开重复规则，也不用 DURATION 推结束）；同一 UID 组全天和定时混用报 bad_ics；只读的七个属性（UID、SUMMARY、DTSTART、DTEND、LOCATION、LAST-MODIFIED、TZID）带引号且含冒号的参数值（如 `LOCATION;ALTREP="cid:…"`）整份报 bad_ics：解析器在第一个冒号处切行，切出的半截引号过不了参数正则（第 57、86 行）。其余属性在解析参数之前就整行丢弃（第 82 行），所以 `ORGANIZER;CN="Office: …"`、`DESCRIPTION;ALTREP="cid:…"` 不报错。方式 A 没有整本导出可核（campus-events.md §1）：白名单打开之前，按 D-33 授权，对选定日历的若干条单条 ICS 各请求一次，核对这几种写法。
- 墙钟时间转 UTC 用 `api/_campus-time.js`（复制 `campusWallClockToInstant`）。对照值 [本地测 2026-11-12：Node 25.9.0 `--experimental-strip-types` 直接运行 7b18f20 的 `campusTime.ts`]：`2026-11-01 01:30 → 2026-11-01T07:30:00Z`（重复的那一小时取 CST）、`2027-03-14 02:30 → 2027-03-14T07:30:00Z`、`2026-11-20 11:30 → 2026-11-20T17:30:00Z`。
- 全天活动（`VALUE=DATE`）：`all_day = true`，开始取当地 00:00，`ends_at` 取 DTEND 的当地 00:00；没有 DTEND 时取开始日期的下一个香槟本地 00:00，不是 +24 小时（2027-03-14 夏令时开始那天两者不同，配这一天的夹具；D-55 3f）。DTEND 等于 DTSTART 的全天活动按没有 DTEND 处理；全天活动的结束必须落在香槟本地 00:00，由导入函数保证（D-56 4i）。多场次：同一 UID 基础编号合成一行，`occurrence_count = N`，`starts_at` 取第一场未结束场次，`ends_at` 取最后一场的结束；定时系列最后一场没有 DTEND 时取它的开始时间；全天场次没有 DTEND 时 parseOccurrence 已补成下一个香槟本地 00:00（api/_campus-ics.js 第 32–36 行），系列结束随之取这个值。
- 映射：`source_key = '<日历 id>/<活动 id>'`，`title_en ← SUMMARY`（trim 后不超过 160 个码点，截断不切开代理对），`location ← LOCATION`（同样按码点截到 160），`source_updated_at ← LAST-MODIFIED`；`content_hash` 对标题、开始、结束、地点、场次数求 sha256。标题匹配 `^(cancel+ed|postponed)\b`（不分大小写）时写 `review_flag = 'title_says_cancelled'`，系统不自动改状态，由管理员决定是否 `hide_event`。
- 系列自然顺延（旧场次数 >1、场次数和结束时间都不变、开始时间后移、旧开始时间 ≤ now()，判据同下面的刷新一条）不算改期：apply 用第二条 UPDATE 把冻结的 community_events_schedule_change 触发器（20261120122054 第 344–369 行）写的 previous_starts_at 和 schedule_changed_at 写回原值，revision 仍 +1，不改触发器。
- campus 行的详情第 11 行读 last_seen_at，经一个 SECURITY DEFINER 的只读函数给 anon、authenticated，不加列级授权（VERIFY 钉着 anon 的列清单）。D-61 的迁移 C 提供 `community_campus_event_checked_at(event_id_in uuid) returns timestamptz`：STABLE，statement_timeout 3s，只对 visible、有效结束时间在 180 天内的 campus 行返回 last_seen_at，只授 anon、authenticated；客户端调用和 public schema 探针留 D-62：PR 开 CI 之前 staging 要有 C（PR 的 public smoke 连 staging），合并之前生产也要有 C（main 的 public smoke 连生产，verify-public-read-schema 在浏览器之前跑；ci.yml@a60aa563 第 388–392、427–429 行）。学校的 26 小时灰字维持 D-59（只做 CAACI）。

方式 A 逐条收录（管理端 `preview_campus_event` 只读预览 → `import_campus_event` 写入）（导入留 D-62）：
- 链接匹配 `^https://calendars[.]illinois[.]edu/detail/([0-9]{1,6})/([0-9]{1,12})/?$`，日历 id 在白名单里；UID 基础编号不等于链接里的活动 id → `campus_uid_mismatch`。
- `fetchBounded` 只请求上面的单条 ICS，origin 限 `https://calendars.illinois.edu`，超时 5 秒，上限 256 KB，不跟跳转。
- 录入人填 `organizer_name`（照校历页的主办方）、`title`（可空）、`summary`（≤120 字，用自己的话写）。
- 刷新（D-61 迁移 C 和 worker，默认关）：门复用 A 的 `claim_community_event_sync('campus', interval '30 seconds')` 和 `finish_community_event_sync('campus', …)`，两者一字不改，急停照 CAACI 写 `('campus', 'infinity')`；30 秒严格小于 cron 相邻两拍的最小间隔（约 50 秒），每拍都能领到。过了门以后 `claim_campus_event_checks(limit_in)`（limit_in 只许 1–2，worker 每次 2）领取：campus 行、`availability <> 'hidden'`、有效结束时间 ≥ now()、`last_checked_at` 为空或早于 6 小时前，按 `last_checked_at nulls first, id`，FOR UPDATE SKIP LOCKED，谓词与冻结的 community_events_campus_check_idx 一致；领取时就写 `last_checked_at = now()` 当租约，不论请求成败，每行每 6 小时最多请求一次。hidden 行不领取，缺席计数停在下架那一刻，unhide 后按冻结的 missing_checks 回到 visible 或 unavailable，下一轮再纠正。逐条请求单条 ICS（白名单在请求之前检查），结果交给 `apply_campus_event_check(event_id_in, outcome_in, row_in)`：`ok` 只更新 title_en、starts_at、ends_at、all_day、occurrence_count、location、source_updated_at、content_hash、review_flag 九列（row_in 的键必须恰好是这九个，review_flag 只许空或 title_says_cancelled，否则 22023），写 last_seen_at、last_checked_at，清零缺席计数，unavailable 回 visible，hidden 保持；行级子事务只捕获 23514、23502、23505、22001、22023，被拒时只写 last_checked_at（原 visible、hidden 的清缺席计数，unavailable 的不动），返回 rejected=true；系列自然顺延（旧场次数 >1、场次数和结束时间都不变、开始时间后移、旧开始时间 ≤ now()）用第二条 UPDATE 把 previous_starts_at、schedule_changed_at 写回原值，revision 仍 +1；不是顺延、而新开始时间在 48 小时内的写 source_time_changed_near_start，row_in 带 title_says_cancelled 的写它，其余保留原值。`not_found`（404）：写 last_checked_at；第一次写 missing_since、missing_checks = 1；只有 missing_since ≤ now() − interval '12 hours' 时才写 missing_checks = 2 并改 `unavailable`（hidden 保持 hidden），计数封顶 2，任何能走到的状态里 `missing_checks >= 2` 都意味着第一次 404 在 12 小时以前，冻结的 unhide_event（20261120122054 第 1249 行）不用改就满足 DoD ④。`error` 只写 last_checked_at；收到 503 时本次剩余请求全部停止。返回值恰好是 `{availability, missing_checks, rejected}`。worker 的 outcome：全部 ok、not_found 或零行为 ok；有行级错误或被拒为 partial，code 取第一个码（被拒记 rows_rejected）；claim_campus_event_checks 失败或返回形状不对为 failed（`checks_*`、`checks_result_invalid`），apply 失败或返回形状不对为 failed（`apply_*`、`apply_result_invalid`）；deadline 不调 finish。failed、partial 或 rejected>0 时报一次 Sentry，message 固定 `community campus checks need attention`，extra 只有 {outcome, code, rejected}。来源撤下之后最坏约 18 小时转 unavailable（最多 6 小时才轮到第一次 404，再加 12 小时窗口，推算）；从第一次 404 算起约 12 小时。sync_state 的 campus 行由第一次领取插入，anon 可读，只给 finish 记 last_outcome；学校的 26 小时灰字维持 D-59。空 VCALENDAR 报 bad_ics、按 error 处理，如果 UIUC 对撤下的活动返回 200 加空日历或 410，这一行永远撤不下来（§13 缺口 8）。
- 方式 A 的单条 ICS 上限 256 KB：按 92 个 VEVENT 150,535 字节推算约装 160 场（推算，没实测），对真实数据先触发 too_large，400 场上限走不到。

方式 B 按选定日历同步：
- 同步模块对白名单里每个日历按 60 分钟间隔（`claim_community_event_sync('campus', interval '60 minutes')`）请求一次整本导出，上限 1 MB；超过 1 MB 的日历（例如 2.2 MB 的综合日历 7）不能选。
- 1 MB 按同一比例（约 1,636 字节/VEVENT）推算约 641 个 VEVENT（推算，没实测），先触发的是整份 400 个 VEVENT 的上限，不是 too_large；方式 B 选的日历，导出要同时满足 ≤1 MB 和 VEVENT ≤400。方式 A、B 共用 sync_state 的 campus 行（source 只许 caaci、campus，20261120122054 第 248 行）：方式 A 的刷新已经用了这一行的门和 last_outcome，D-33 只能二选一；两种都要的，另起前向迁移改这条约束。
- 只收开始时间在未来 180 天内、标题不匹配该日历 `exclude_patterns`（D-33 一并定，例如咨询时段、学期日期）的条目；`organizer_name` 取白名单里的日历显示名；`summary` 为空，卡片只显示标题、时间、地点。
- 对账照 §9.2 的规则：同一日历连续两次完整导出都缺席才改 `unavailable`。撤下时限约 2 小时。

判断：选定日历的导出在 1 MB 以内时 B 省人力；条目多、噪声大的日历只能用 A。建议写在 DECISIONS D-33。「全部」视图里学校活动每周最多 10 条，由客户端分组时截断（SPEC.md「活动」）。

### 9.4 合作组织（P4.5）

- `upsert_event_partner`、`set_event_partner_status` 管理组织；D-32 的书面同意登记之前不建 partner 行。
- `create_partner_event`、`update_partner_event`：OWNER 角色，`created_by` 写 `COMMUNITY_OFFICIAL_PROFILE_ID`。校验：组织 active；`page_url` 走与 `isAllowedEventLink(page_url, 该组织 allowed_link_hosts)`（api/_community-events.js 第 166 行一带）相同的白名单：https、≤500 字、不带 userinfo 和端口，host 是 caaciorg.com、illinois.edu 或其子域（forms.illinois.edu 除外）或该组织登记的域名，否则 `event_link_not_allowed`；有报名链接时 `register_url` 的 host 小写后必须完全等于该组织 `allowed_link_hosts` 中的一项，不带 userinfo 和端口；`consent_ref` 由管理端必填，RPC 与组织记录逐字比较，不等返回 `partner_consent_mismatch`，写入的是组织记录里的值；合作组织行的 `organizer_name` 写 NULL（组织名由 list_community_events 的 partner_name_* 给出；name_zh 允许 1 字，organizer_name 要求 2–80 字）；地点必填，去两端空白后 1–160 字；`summary` 1–120 字；`starts_at` 在 `[now(), now() + 180 days]`；`update_partner_event` 不能改 page_url、partner_id、consent_ref（source_key 依赖 page_url），要换原页先 hide_event 再新建；四个动作都只给 OWNER；`upsert_event_partner` 逐项校验 allowed_link_hosts（小写 DNS 名、不带 scheme 和端口、去重、不能是 forms.illinois.edu）。
- 取消或撤回：单场取消用 `hide_event`；组织撤回同意时改为 `revoked`，公开读策略立刻隐藏它的全部活动，不需要逐行更新。

### 9.5 网友发起（P4.6）

`create_member_event(post_id_in uuid, title_in text, content_in text, event_in jsonb) returns jsonb`，SECURITY INVOKER：
1. 调用前，客户端按发话题的同一路径用 `remoteModerate` 审标题、正文、地点；小程序另走 `wechat-seccheck`。
2. 函数内先校验标题 ≤60 字（`member_event_title_too_long`）、地点 1–80 字（`member_event_location_invalid`；去空白要覆盖 Unicode 空白，制表符、换行、U+3000、U+00A0，函数和表约束一致，D-56 4i），再插 `posts`（`id = post_id_in`，`category = 'events-social'`，作者是调用者，受 posts 现有 RLS 和触发器约束，含 044 的发帖限流），然后插 `community_events`（`source_key = post_id_in::text`，`discussion_post_id = post_id_in`）。两步在同一事务里；§5.5 的守卫再查一遍资格、时间、限额、保留词和链接。
3. 遇到 `23505`，且已有帖子属于本人、id 相同时，按重试成功处理，返回已有的 `{ post_id, event_id }`。`post_id_in` 由 `createClientMessageId()` 在打开表单时生成，结果未知时用同一个 id 重试；草稿 key 见 §5.2。

取消：客户端直接 `from('community_events').update({ cancelled_at: new Date().toISOString(), status_note }).eq('id', id)`，受 §5.5 的列权限、策略和守卫约束；`status_note` 可空。取消后不能恢复，话题保留。

删号：`organizer_user_id` 外键 `on delete cascade`，posts 的 `user_id` 也是 `on delete cascade`（`010_plaza_and_uid_and_chat_flags.sql:137`）。P4.6 要先读 `api/auth/delete-account.js` 的删除顺序，再加一条断言：删号任务跑完后，任何角色都读不到此人的网友发起活动（§13 缺口 12）。

### 9.6 活动列表 RPC

`list_community_events(region_in text default 'cu', source_in text default null, window_in text default 'upcoming', limit_in int default 200)`，SECURITY INVOKER、STABLE、固定 `search_path`、函数级 `statement_timeout = '3s'`，`limit_in` 上限 200：
- `upcoming`：有效结束时间 ≥ now()，`starts_at <= now() + 180 days`，`duplicate_of is null`；按 `starts_at`、来源优先级（caaci、partner、campus、member）、`id` 升序。
- `past`：有效结束时间落在 `[now() - 180 days, now())`，按 `starts_at` 降序。
- member 行 join `posts`（status active），在调用者权限下执行，沿用 posts 的 RLS：调用者看不到的话题，对应活动也不返回。
- 返回：事件字段（member 行的显示标题取 `posts.title`）、合作组织 `name_zh`、`name_en`、`allowed_link_hosts`、链接、时间、地点、状态列、发起人昵称头像和 `is_illini_verified`、`discussion_post_id`、讨论数（`posts.comment_count`）。
- 「网友发起每个日期组最多显示 2 张」「学校每周 ≤10 条」都在客户端做，不在 RPC 里做。

### 9.7 讨论帖与下架（P4.9）

- 管理动作 `create_event_discussion {event_id}`（OWNER 角色），只用于 caaci、partner、campus 行：
  - 事件可见且 `duplicate_of is null`，否则拒绝；`availability <> 'visible'` 时返回 `event_discussion_closed`。
  - `select ... for update` 锁住事件行，已有 `discussion_post_id` 就直接返回它。
  - 插入帖子：`user_id = COMMUNITY_OFFICIAL_PROFILE_ID`（api 层从环境变量传入；没设时返回 `official_profile_not_configured`）、`is_official = true`、`category = 'events-social'`、`title = left(coalesce(nullif(title, ''), title_en), 120)`，正文固定为「这里是这场活动的讨论帖，时间和地点以活动页为准。」（SPEC §6.7.6；D-59.9d按D-43采用20261120122054现有正文，不改冻结迁移；英文界面也为中文，撤回走前向迁移；不写具体时间地点，改期后仍有效）。官方帖不受 044 发帖限流（`044_rate_limit_window_buffer.sql:85-87`）。
  - 同一事务里 `update public.community_events set discussion_post_id = <新帖> where id = <事件> and discussion_post_id is null`；更新 0 行就回滚，返回已有的帖子。重复点击只产生 1 个话题。
- `hide_event`、`unhide_event`（MODERATION 角色）写或清 `availability = 'hidden'`、`hidden_reason = 'admin'`。
- `create_event_discussion`、`hide_event`、`unhide_event`，以及 `upsert_event_partner`、`set_event_partner_status`、`create_partner_event`、`update_partner_event`、`import_campus_event`（只在方式 A 下有）都按 §5.3 的五处同步；审计 event_kind 依次命名为 `event_discussion_created`、`event_hidden`、`event_unhidden`、`event_partner_changed`、`event_partner_status_changed`、`partner_event_created`、`partner_event_updated`、`campus_event_imported`。
- member 行的讨论帖就是它自己的「找搭子」话题，不经这个动作。
- 话题详情页用 `community_events?discussion_post_id=eq.<post_id>&select=<白名单列>&limit=1` 查关联活动，有就在正文上方渲染活动引用卡。首页「站务帖整页 ≤3 条」的规则把这些官方讨论帖也算在内。

### 9.8 去重与外链

- 写入时去重（`api/_community-events.js#duplicateCandidates`，P4.1）：新行与已有行的 `register_url` 或 `page_url` 规范化后相同（小写 scheme 和 host，去掉 fragment、末尾斜杠和 `utm_*` 参数），就给来源优先级低的那条写 `duplicate_of`，优先级 caaci > partner > campus > member。列表只返回 `duplicate_of is null` 的行。模糊匹配（时间相近、标题相似）和人工合并是 P6.1 候选。
- `openExternalLink(url, extraHosts)`（`app/src/utils/eventLinks.ts`）：只接受 https，拒绝 userinfo 和端口；host 必须是 `caaciorg.com`、`illinois.edu` 或其子域，或在 `extraHosts`（该行合作组织的 `allowed_link_hosts`）里，否则不显示按钮。H5 用 `window.open(url, '_blank', 'noopener,noreferrer')`；mp-weixin 用 `uni.setClipboardData` 加提示，做法同 `OsmAttribution.vue:28-35`；不用 web-view。
- 图片：v1 不同步、不渲染任何来源的图片，不改 CSP，不加小程序 downloadFile 域名。

### 9.9 错误码

同步错误码（只记状态码和分类码，不记上游正文）：

| 码 | 含义 | 对已入库的行 |
|---|---|---|
| `http_403_edge` | 403且是text/html或带cf-mitigated；推断为边缘拦截 | CAACI不动已入库行，last_outcome=failed |
| `http_403`、`http_4xx` | 非边缘403；其余4xx（429另列） | CAACI不动已入库行，last_outcome=failed |
| `http_404` | 来源返回404 | 学校方式 A 刷新记 not_found，本次 outcome 仍可为 ok；CAACI不动已入库行，last_outcome=failed |
| `http_429`、`http_503`、`http_5xx` | 限流或服务端错误 | 不动；503时本次停止，CAACI记failed |
| `timeout`、`too_large`、`upstream_redirect` | 超过预算超时（最多5秒）/正文上限/遇到跳转 | 不动，CAACI记failed |
| `bad_json`、`bad_ics`、`schema_mismatch`、`unexpected_private_fields` | 200非JSON或解析失败、形状/隐私字段不合约 | 不动，last_outcome=failed |
| `deadline` | 某步剩余可用预算不足1000毫秒 | 停在该步之前；finish也放不下时不记sync_state，已claim的须等满间隔，报告Sentry |
| `claim_failed` | 领取RPC报错 | 不发上游请求、不调finish；可能每分钟报告，开关前须 Community P4 列出的全部迁移 VERIFY 通过 |
| `unexpected_failure` | 不能归入上述已知类别的I/O或实现异常，沿用既有background-jobs通用码 | 不外抛、不记录任意异常消息；已claim且预算足够时finish记failed |
| `rows_rejected` | apply拒绝了至少一行 | outcome仍为ok或partial；有效key算已见，unavailable被拒行保持状态及缺席计数，坏key使整份partial |
| `campus_unexpected_tz`、`campus_uid_mismatch`、`campus_too_many_occurrences`、`campus_calendar_not_allowed` | 校历数据异常或日历不在白名单 | 写入时拒绝；刷新时不请求（白名单外）或按 error 只写 last_checked_at |
| `event_link_not_allowed`、`partner_consent_mismatch`、`event_partner_not_active`、`partner_event_exists` | 合作组织写入未满足外链、授权编号、组织状态或唯一性条件 | 写入时拒绝 |
| `apply_http_<状态码>`、`apply_timeout`、`apply_failed`、`apply_result_invalid` | Supabase 的 apply 调用失败或返回形状不对；apply_failed 也包括同一个 try 里、发出 apply 调用之前的投影异常（投影输入已由 normalizeCaaciEvents 校验），以及请求没到达 Supabase 的网络、DNS、TLS 失败（fetch 抛出的错误由 api/background-jobs.js 第 130–134 行原样重抛）；apply 是一个事务，本次快照没写入；400 通常是 apply 里行级名单以外的 SQL 错误，404 通常是函数不存在或 schema cache 没刷新（PostgREST 文档的映射，没实测）；学校刷新的 apply_campus_event_check 失败同样记 `apply_*`| 已入库行不动，last_outcome=failed；查 Supabase 的 Postgres/API 日志，不查官网；apply_failed 而 Supabase 日志里没有这次 apply 请求的，是投影异常或请求没到达 Supabase：同一次运行的 Vercel 函数日志里有 `[community-events-sync] finish not recorded` 或 `[background-jobs] worker incomplete` 的，多半是连不上 Supabase；两行都没有的，从日志分不出这两种（apply 失败本身不写日志，Sentry 只带 outcome、code、rejected） |
| `empty_snapshot` | 最终完整、rows_in 为空的快照 | 照常记缺席；outcome=ok，不报 Sentry |
| `checks_http_<状态码>`、`checks_timeout`、`checks_failed`、`checks_result_invalid` | 学校刷新的 claim_campus_event_checks 调用失败或返回形状不对 | 已入库行不动，已领取的行等满 6 小时租约；last_outcome=failed |

`finish_*` 码只进日志，不写 sync_state；`schema_mismatch` 只指上游 schema 不符

面向用户的错误码各对应一个 i18n key，key 与文案在 SPEC.md §11「P4 活动」：`member_event_rpc_required`、`member_event_not_eligible`、`member_event_time_out_of_range`、`member_event_active_limit`、`member_event_reserved_wording`、`member_event_link_not_allowed`、`member_event_title_too_long`、`member_event_location_invalid`、`member_event_cancel_final`、`event_discussion_closed`、`official_profile_not_configured`、`member_events_closed`（P0001，D-57）。

### 9.10 测试与 fixtures

- fixtures 放 `api/__fixtures__/community-events/`（下划线目录不会被当成函数，`node --test ../api/*.test.mjs` 也不会扫进去）。邮箱一律写 `organizer@example.test`，描述一律写 `Synthetic description.`，不提交真实组织者邮箱和校历原文。
  - P4.1 规定的 12 个：`caaci-v1-complete`、`caaci-v1-incomplete`、`caaci-slug-null`、`caaci-ended-with-form`、`caaci-rescheduled`、`caaci-edge-403.html`、`caaci-500-upstream.txt`、`campus-sample`、`campus-malformed`、`partner-valid`、`member-valid`、`cross-source-duplicate`。
  - 另加：`caaci-missing-twice`、`caaci-event-register-signed-in`（解析函数必须拒绝它）、`campus-series-3.ics`、`campus-allday.ics`、`campus-dst-fallback-2026-11-01.ics`、`campus-dst-spring-2027-03-14.ics`、`campus-escaped.ics`、`campus-cancel-title.ics`、`campus-other-tz.ics`、`campus-404.html`。
- 单元测试：`api/_community-events.test.mjs`（断言测试期间 `fetch` 调用 0 次）、`api/_community-events-sync.test.mjs`（请求头只有 `accept` 和 `user-agent`）、`api/_campus-ics.test.mjs`（断言输出里没有 organizer、contact、description）、`api/_campus-time.test.mjs`（对照 `campusTime.ts` 的三个值）、`app/src/utils/eventLinks.test.mjs`（mock uni，分 H5 和 mp 两支）。
- 数据库测试 `scripts/community-events.test.mjs`（L-SQL），分别以 anon、A、B、停权用户、未验证用户、service_role 身份断言：anon 只读到可见行；未验证用户发起报 `member_event_not_eligible`；第 3 场未结束活动报 `member_event_active_limit`；开始时间超过 60 天报错；带链接、带保留词报错；直接写表（不经 RPC）报 `member_event_rpc_required`；取消后清空 `cancelled_at` 报 `member_event_cancel_final`；话题被隐藏或删除后对应活动不可见；两个连接同时 `create_event_discussion` 只产生 1 篇帖子；撤回同意的组织的活动不可见；`consent_ref` 为空的 partner 行被拒；快照的 complete、partial、连续两次缺席三种情况；夏令时切换的两天；`create_member_event` 用同一 `post_id_in` 重试只得到一行。汇总必须是 `# fail 0`。
- 边界测试 `scripts/community-events-boundary.test.mjs`：`app/src` 或 `api/` 出现 `wslzeqhipvibeflmxznh` 即失败；活动相关页面出现 `<web-view` 或渲染图片字段即失败。
- `scripts/verify-public-read-schema.mjs` 加 `['community events', 'community_events', 'id,source_type,starts_at,availability']`，并对 `rpc/list_community_events` 发 `{ limit_in: 1 }` 探测；同步改 `scripts/public-read-schema.test.mjs`。候选库缺迁移时，CI 在启动浏览器前就失败。
- Playwright `app/smoke/community-events.spec.ts` 用路由拦截喂 fixture，覆盖 390 与 1280。P4.8 合并后，公开巡检加入 `pages/events/index`。
- D-61：scripts/community-campus-checks.test.mjs（普通 PostgreSQL：三个同步函数合同不变、新函数授权、guard 拒绝重复和缺 B、PRECHECK_C/VERIFY_C 和五个负对照、领取顺序与租约、两连接 SKIP LOCKED、not_found 四步与封顶、error、ok、系列顺延与真改期、地点被拒、详情第 11 行、真实投影进真实 RPC）；api/_community-campus-checks.test.mjs（开关、门、白名单、请求形状、九列投影、404/503/UID、结果与码、预算）；api/_community-events-sync-worker.test.mjs 的三条学校用例；REGRESSION_<C> 11 例（L-SQL）；发布清单测试的两节。所有测试真实 fetch 0 次，白名单只经参数注入。

### 9.11 禁止事项

不建报名表，不存报名人数据，不显示「已报名」或人数；不直连官网 Supabase，不建第二个 Supabase client，不把 `/api/volunteer` 或 `/api/event-register` 当数据源；同步请求不带 Authorization 或 Cookie；不整本导入超过 1 MB 的日历，不存 DESCRIPTION、ORGANIZER、CONTACT，不直接链到 forms.illinois.edu；不显示、不热链任何来源的图片；同意书登记之前不建 partner 行；不给每场活动自动开讨论帖。

---

## 10. 法律底座的技术部分（LEGAL.2、LEGAL.4、LEGAL.5）

### 10.1 法律文本版本与 reconsent 的数据库耦合（LEGAL.2）

- 版本常量：`TERMS_VERSION = '2026-07-18'`（`app/src/legal/terms.en.ts:1`）、`PRIVACY_VERSION = '2026-09-19'`、`GUIDELINES_VERSION = '2026-09-03'`；`CURRENT_CONSENT_VERSION` 取三者最大值（`app/src/legal/index.ts:31-32`）。登录用户的 `profile.tos_version` 小于它时，App 把用户送到 `pages/reconsent`，这个页面只能经 `record_consent` 放行，而 `record_consent` 用写死的 CASE 校验版本号。
- 2026-08-06 的事故：前端先上线了新版本号，生产的 `record_consent` 还不认它，所有登录用户卡在 reconsent，每次同意都返回 `22023 invalid_version`（仓库 RUNBOOK.md「Schema-coupled release order」）。
- 所以 LEGAL.2 只升一次版本，三份文本用同一个日期，并配迁移 `<UTC ts>_accept_cornfield_consent_version.sql`（§5.4）。Eric 先在 staging 和生产应用这个迁移，再发布带新版本号的前端。`scripts/consent-version-deploy-order-boundary.test.mjs` 守仓库这一半：新版本号必须已被仓库里最新的 `record_consent` 接受。
- 运营方现在写在 `app/src/legal/terms.en.ts:9` 和 `app/src/pages/legal/index.vue:99-100`（Guoyi (Eric) Xu）。D-37 落实前不改；LEGAL.2 两处一起改。
- 现有版权条款只有一句：DMCA 通知发到 help@illinimarket.com（`terms.en.ts:54`、`terms.zh.ts:52`）。LEGAL.2 加四条版权与授权条款和重复侵权者政策，投诉入口指向 §10.2。

### 10.2 版权投诉与撤稿入口（LEGAL.4）

- 页面位置：
  - 应用内：`pages/legal/index` 增加第四种文档 `copyright`（`LegalDocType` 加一项，`onLoad` 接受 `type=copyright`），H5 和小程序都能打开。
  - 公开网页：在 `app/public-brand-pages.ts` 生成的 `/terms` 页里加一节 `id="copyright"`，公开地址 `https://www.illinimarket.com/terms#copyright`。不新增 `/copyright` 路由，因为那要改 `vercel.json` 的 rewrites。
- 正文来源：新文件 `app/src/legal/copyright.zh.ts`、`copyright.en.ts`。内容含 17 U.S.C. §512(c)(3) 的六项要素、民法典第 1195 条要求的通知内容、处理流程、DMCA 指定代理人信息（照 LEGAL.3 的登记，D-38）和收件邮箱（D-39）。版权页不进 reconsent 版本计算；它不是用户同意的文本。
- 流程与数据：收到通知 → 管理端 `record_copyright_notice` 登记（`elements_complete` 记要素是否齐全）→ 要素齐全的转送发帖人（写 `forwarded_to_poster_at`）→ 对内容执行 `takedown_content`（现有动作，媒体进隔离区），再用 `record_copyright_notice` 写 `action = 'removed'` 或 `'disabled'` → 收到反通知写 `counter_notice_at`，恢复时用 P3.5 的 `restore_content` 并写 `restored_at`。
- 48 小时目标：管理端队列按 `received_at` 升序，超过 24 小时标黄、超过 48 小时标红，复用 P3.6 的举报队列着色。
- 重复侵权者：管理端按被处置内容的作者统计过去 12 个月 `action in ('removed','disabled')` 的通知数。判断：建议 3 次成立即停权，阈值写进用户协议，由 Eric 在 LEGAL.2 审定。

### 10.3 举报原因

- 站内举报原因不变，仍是五项（i18n `report.reasonSpam`、`reasonProhibited`、`reasonAbuse`、`reasonMisleading`、`reasonOther`，zh.ts:538-542）。`reports.reason` 是自由文本，客户端截到 50 字（`app/src/composables/useModeration.ts:157`），数据库没有原因的 CHECK。
- 版权投诉不走站内举报：DMCA 通知要求权利人身份和声明，举报人也常常不是站内用户。举报面板加一行链接到 §10.2 的页面（文案见 SPEC.md）。
- 举报对象：`reports_target_type_check` 是 item、user、message、post、comment（`022_reports_post_target.sql`），V5 不改；网友发起活动的举报落在它的话题上（§5.5）。

### 10.4 审核措辞与「新来先看」边界（LEGAL.5）

- 社区守则和管理端文案只把审核写成「违法内容、垃圾信息、个人隐私信息筛查」，不写编辑精选。依据：Mavrix 案认定，按实质标准先审后发可能让平台失去 §512(c) 安全港（appendix/research/cold-start-legal.md 风险矩阵）。
- 数据库层：约束 `posts_featured_official_only CHECK (NOT is_featured OR is_official)`（§5.3），用户帖子进不了「新来先看」。
- 基线：`git grep -nI -E '精选|编辑推荐' -- app/src` 在 005ca9d 上为 0 行，保持为 0。
- 审核记录：`admin_audit_log` 不在数据保留任务的范围里（仓库 RUNBOOK.md:407），沿用。

---

## 11. 迁移与发布规程（只引用仓库文档，不另写一套）

| 事项 | 出处 |
|---|---|
| 迁移文件规则：只新增唯一时间戳迁移，不改已上线文件，配套 PRECHECK、VERIFY、REGRESSION | 仓库 README.md「贡献约定」:251 |
| 执行顺序：PRECHECK → 备份或 staging → 迁移 → VERIFY / REGRESSION / canary；不在任何现有环境盲跑 `db push` | 仓库 README.md「数据库迁移清单」:135-142 |
| 生产对象是否存在：用 `scripts/schema-drift-probe.mjs`，不读 ledger | 仓库 README.md:135-142；仓库 RUNBOOK.md「Checking whether production actually matches the repo」 |
| 托管迁移：staging-smoke `hygkwxugskijadgfisji` 是唯一获准的托管可丢弃目标；只读 PRECHECK → Supabase 官方 ledger-aware migrations 端点按确切名称应用一次 → 独立只读连接跑 VERIFY；禁止 raw psql、`db push`、dashboard SQL、手写 ledger 行；明确失败只做只读核查，不重试；托管库不跑完整 REGRESSION | 仓库 RUNBOOK.md「2026-07 candidate release sequence」第 15–16 条（:1290-1360），V5 文档简称「仓库 RUNBOOK 托管迁移节」 |
| 先迁移、后前端 | 仓库 RUNBOOK.md「Schema-coupled release order」:438-521 |
| 正式发布：七个 job 全部成功；自动 Git 部署保持关闭；经已授权的 connector 建一次候选部署，nonce 核对身份后 promote | docs/SUPERVISED_RELEASE.md 第 1–7 步 |
| 回退 | 仓库 RUNBOOK.md「Deploy rollback」:414；「Migration roll-forward」:803 |

- staging 和生产的每一次迁移、每一次发布都由 Eric 单独批准、本人执行（E4、E13）。OMO 只准备文件、核对 sha256、读 VERIFY 输出、重跑 CI。
- 仓库文档自身有一处过时：仓库 RUNBOOK.md:443 写「Merging to main deploys the frontend」，而 `vercel.json` 是 `git.deploymentEnabled=false`，合并不会部署。以 SUPERVISED_RELEASE.md 为准；这处不在 V5 范围内修改。
- 每次托管迁移之前，在 STATUS_LOG 记下迁移文件和三个伴随文件的 sha256（`20261112120000` 见 P2.5 ⑩）。

---

## 12. CI 解读（`.github/workflows/ci.yml`，main 7b18f20）

触发：push 到 main、开向 main 的 PR、每周一 09:00 UTC 定时（`'0 9 * * 1'`）、手动。`NODE_VERSION: '22'`。同一 ref 的新运行会取消旧运行，定时运行除外。

| job | 在 PR 上应当是 | 说明 |
|---|---|---|
| Type-check | pass | `vue-tsc --noEmit`。P1.2 之后多一步打印 `node -v`、`npm -v`，npm 不是 10.9.x 时失败；ci.yml:160 的注释写 Node 22 自带 npm 10.9.8，P1.2 以日志实际值为准 |
| Boundary regressions | pass，汇总 `# fail 0`、`# skipped 1` | 依次跑：迁移文件完整性（`shasum -a 256 -c manifest.sha256`）、装 PGDG `postgresql-17`（:99-114）、`node --test ../api/*.test.mjs ../scripts/*.test.mjs smoke/*.test.mjs`（:116-118）。唯一允许的 skip 是 `scripts/vercel-function-boundary.test.mjs:173`「an existing local Vercel Build Output exactly matches runtime API sources」（本地没有 `.vercel/output` 时跳过）。出现含 PostgreSQL 或 initdb 的 SKIP 就是环境失败；P1.3 之后 `CI=true` 下找不到 PG17 会直接失败 |
| └ 依赖审计步骤 | 只在 PR 改了 `app/package.json` 或 `app/package-lock.json` 时运行（:140-157） | push、定时、手动运行时总是执行。这一步先 `npm install -g npm@11`（:172-174），再 `npm audit --audit-level=moderate`，最多三次。所以 P1.2 的 npm 版本声明不影响审计用的 npm。现状和处理方案见 STATUS.md 与 D-41 |
| Build H5 | pass | 构建后跑 `verify-build-artifact.mjs dist/build/h5 ci`，再 `npx playwright install --with-deps chromium webkit` 和编译版管理端验收。runner 用 `ubuntu-latest`，即 Ubuntu 26.04；Playwright 1.60 在 26.04 上装不了浏览器，P1.5 升到 1.65.0 后才能通过 |
| Build mp-weixin | pass | 构建加 `verify-build-artifact.mjs dist/build/mp-weixin none`；不跑 `verify-miniprogram.mjs` 包体预算 |
| Smoke (public page sweep) | pass | PR 上的 `VITE_SUPABASE_URL` 取仓库变量 `vars.PR_SMOKE_SUPABASE_URL`，即 staging-smoke。先跑 `verify-public-read-schema.mjs`，再跑全量未登录巡检。它依赖 staging-smoke 的 schema：PR 带了新迁移而 staging 没应用时必然失败，重跑多少次都一样，要等 Eric 按 E4 应用迁移（P2.6、P3.7、P4.11a）。P2.1 之后，缺迁移会在浏览器启动前以 `public_schema_mismatch` 失败 |
| Smoke (protected staging account) | skipped | 只在 push 到 main 或在 main 上手动触发时运行（:392-396），用受保护的 `staging-smoke` Environment；PR 代码拿不到账号凭据 |
| Production release readiness | skipped | 只在 main 上运行，要求前六个 job 全部成功（:499-512）。正式发布要求七个 job 都成功（SUPERVISED_RELEASE.md 第 1 步） |

OMO 的 GitHub 令牌没有 Variables 权限（D-07），读不到 `PR_SMOKE_SUPABASE_ANON_KEY`。同一个公开 key 由 Eric 写进工作站的 `~/.config/illini/staging.env`（[RUNBOOK.md](RUNBOOK.md) §11 E3）。

---

## 13. 事实缺口（每条一个负责人）

| # | 缺口 | 影响 | 负责人 | 怎么查 / 截止 |
|---|---|---|---|---|
| 1 | 生产和 staging-smoke 上的 `posts_visible` 有没有 `source_lang` 列 | 决定分享预览是否从 2026-09-17 起一直退化成兜底标题；P2.5 PRECHECK 的分支 | staging：OMO；生产：Eric | staging 用 anon key 请求 `/rest/v1/posts_visible?select=source_lang&limit=0`（200 或 400）；生产由 Eric 在 SQL 编辑器跑只读 `select column_name from information_schema.columns where table_schema='public' and table_name='posts_visible' order by ordinal_position`。P2.5 冻结前 |
| 2 | 生产的 `profiles_tos_version_release_allowlist` 与 `record_consent` 是否等于仓库最新定义（20260919090100） | LEGAL.2 迁移的 PRECHECK | Eric | `scripts/schema-drift-probe.mjs` 加只读 `pg_get_functiondef`。LEGAL.2 应用前 |
| 3 | 生产的 `capture_report_target_snapshot`、`admin_get_report_detail`、`update_post_comment_count` 函数体是否等于仓库最新定义 | P2.5 改写前两个，P3.1 改写第三个 | Eric | 只读 `md5(prosrc)`，与 L-SQL 的值比对。各批次应用前 |
| 4 | 微信后台对首个发布版本能否回退或暂停 | §6 回退方案 | Eric | 微信后台「版本管理」。P5.1 之前 |
| 5 | 带用户发帖和网友发起活动的小程序要哪个服务类目和资质 | 提审能否通过 | Eric | D-30。BRAND.5、P5.2 之前 |
| 6 | Google 登录的 OAuth 客户端：应用名称、授权域名改名后是否触发品牌重新验证 | 改名和新域名期间 Google 登录是否可用 | Eric | Google Cloud Console 的 OAuth 同意屏幕。BRAND.1 合并前 |
| 7 | 官网维护者是否就是 GitHub a2751012962；Vercel 出口请求 `caaciorg.com/api/public-events` 会不会被 Cloudflare 拦截 | P4.3 审阅与上线验收 | Eric（确认维护者）/ 官网维护者（查 Cloudflare Security Events） | P4.3 开 PR 前 / 合并上线后 |
| 8 | UIUC 校历里被撤下的活动，单条 ICS 返回什么（只测过不存在的 id，得到 404） | §9.3 缺席判定 | OMO | 只读官方文档写进 `appendix/research/campus-events.md`；文档没写就记「未知」，不靠抓 HTML 验证。P4.7 第一步 |
| 9 | 官网生产库的 `events` RLS 和列是否与仓库迁移一致（官网没有迁移账本） | 9.1 的读取列 | 官网维护者 | 合并 P4.3 前在生产只读核对 |
| 10 | Supabase 后台生效的 Auth 邮件模板是否等于仓库 `supabase/email-templates/` 副本 | BRAND.2 之后的邮件品牌 | Eric | E10 粘贴前先对比 |
| 11 | Vercel `redirects` 用 host 条件加 `statusCode: 301`、排除 `/api/` 时的实际行为 | BRAND.6 的 DoD ①② | OMO | 在 demo 项目的预览部署上验证（不碰生产）。BRAND.6 开工后 |
| 12 | `api/auth/delete-account.js` 的删除顺序与网友发起活动的外键是否冲突 | P4.6 删号断言 | OMO | 读源码后在 L-SQL 跑一次删号。P4.6 |
| 13 | 成员活动守卫的 Z（20261122035253 第 103 行）和客户端 EVENT_INVISIBLE（app/src/utils/communityEvents.ts 第 6 行）各 21 码位；在它们和 W（同文件第 5 行）之外，Unicode 的 Default_Ignorable_Code_Point 还剩 U+034F、U+061C、U+115F–U+1160、U+17B4–U+17B5、U+180B–U+180D、U+180F、U+2065、U+206A–U+206F、U+3164、U+FE00–U+FE0F、U+FFA0、U+FFF0–U+FFF8、U+1BCA0–U+1BCA3、U+1D173–U+1D17A、U+E0000–U+E0FFF（U+2065、U+FFF0–U+FFF8 和 E0000–E0FFF 里的空位未分配）。插进保留词或链接能绕过两道预检；标题、说明、地点只由这些码位组成时服务端和客户端都放行，可能显示为空。只有 U+200B、U+3164、U+034F、U+061C 实测过（在 main 的话题、评论、商品上，L403），其余按 Unicode 属性推出，没做渲染测试 | 开成员活动之前是否先建立可见文本边界；范围不只地点 | Eric（决定） | D-59.8 的探针见 STATUS_LOG L402–L403；修就按整类 Default_Ignorable 定边界，不逐个补码位；本批不修，由 Eric 决定 |
| 14 | §9.4的page_url只要求https，而SPEC §6.7.9外链要求域名白名单；§9.4从组织记录复制consent_ref，而SPEC §6.7.11要求管理端填写授权编号 | 合作组织原页按钮可能被客户端隐藏；授权编号录入责任不一致 | OMO（D-60） | 已对齐（D-60）：见 §9.4、SPEC §6.7.11、BACKLOG P4.5 ① |

