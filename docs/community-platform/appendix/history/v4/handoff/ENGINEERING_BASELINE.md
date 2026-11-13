# 工程基线与跨 VM 交接

核对日期：2026-11-12，America/Chicago。供下一台 VM 的 OMO/开发代理接手；记录源码、公开接口与版本证据，不代表全部功能重新验收通过。接口候选见 [INTEGRATION_CONTRACTS.md](INTEGRATION_CONTRACTS.md)。本文不含凭证。

## 1. 应从哪里继续

以 **Illini Market 现有工程**承载社区，先做“有标题、有板块的讨论：发布→列表→详情”，再接官网内容和活动。官网已有会员、活动报名、商家目录与华协币能力，不应在社区重复建设。Local Pass 尚待核实实际系统与运营主体，不能等同于 CAACI 会员或华协币。

| 系统 | 基线 | 本轮证据与边界 |
| --- | --- | --- |
| Illini Market | `EricXu-0805/CAACI_Community_Marketplace_Bazaar` main `7b18f2052e52a4268c25407d0584748477cbf978`；提交时间 2026-10-26 07:28:28 CT | 主代理核对GitHub main。本轮正式域名 `/deployment-manifest.json` HTTP 200，完整commit一致；带UUID v4 nonce的 `/api/deployment-identity` HTTP 200，部署 `dpl_CB66WF4tdkwDetCeyFMXzx1VdBxz`、environment `production`、projectRef `lfhvgprfphyfvhidegum`。证明当次运行版本，不证明真实用户旅程与全部数据库迁移通过。 |
| CAACI 官网 | `a2751012962/caaciorg` main `f62f62f3688c1ab432a9f4c242aa97fae108ca11`（2026-11-05 23:51:58 CT）；preview `fae3f5f18b9d2556f2281017fe223bf9ffc2bd43` | `git ls-remote`核对分支；官网首页HTTP 200，Cloudflare。README/SETUP将main对应 `caaciorg.com`，本轮未从Cloudflare控制台证明网站精确部署SHA。 |
| 官网文章 | `GET https://caaciorg.com/api/articles?limit=1` | HTTP 200；返回news/community/members三个栏目，`rows: []`、`total: 0`。接口可读，不等于已有文章供给。 |
| 官网报名 | `functions/api/event-register.js` 存在于上述main | 本轮匿名读取旧活动 `?event=mid-autumn-festival` 为HTTP 403，原因未定位。源码存在不等于跨站活动接口验收通过。未报名。 |
| 旧会员工程 | `JiachenTu/CAACI_web` | README描述Next.js 15 + Express + MongoDB + Stripe；是另一份工程，不是现官网。除辨认背景外未接入。 |

SHA、deployment ID与公开项目引用是版本/环境标识，不是凭证。下一轮先重新核对，若变化则更新证据。

### Mac 原目录保持原样

`/Users/xiaogangxu/Projects/CAACI_Community_Marketplace_Bazaar` 在 `codex/illini-release-gates-20261003`，HEAD `cfaa375ea489fa33491cb2fdde68a33be8ea52e3`；20个已跟踪文件修改、8个未跟踪条目，涉及 `useAuth.ts`、`useSupabase.ts`、`App.vue`、消息/个人/恢复页面和认证恢复测试。未被本轮合并或验收。

新VM从GitHub新clone；Mac实施用独立工作区。不reset/clean原目录、不把整个脏目录复制成新基线、不将 `.claude/` 或未提交认证修复混入社区PR。若首批复现登录阻断，将认证修复单独审阅验证后依赖；社区数据和展示开发可继续，真实内测不得跨过登录阻断。

## 2. Illini 可复用模块

以下路径相对仓库根，按main核对。

| 能力 | 路径 | 必须保留 |
| --- | --- | --- |
| 前端/编译 | `app/package.json`、`app/build-compat/compiler/uni.cjs`、`app/vite.config.ts`、`app/src/pages.json` | uni-app/Vue 3/TypeScript，H5与mp-weixin。main用仓库自有编译入口和锁定的本地Vite/Rollup包，不恢复成旧`uni`启动或无评估升级依赖。Node `>=22.15.0 <23`；npm 10.8.2为声明基线。 |
| 身份 | `app/src/composables/useAuth.ts`、`useSupabase.ts`、`accountScope.ts`；`app/src/api/authPersistence.ts` | `auth.users.id`/`profiles.id`是社区身份；账号代次、退出清理、迟到结果隔离。不要另建论坛用户库。 |
| 广场 | `app/src/composables/usePlaza.ts`、`app/src/pages/plaza/index.vue`、`app/src/pages/post/index.vue`、`app/src/types/index.ts` | 正文2000字、最多4图；官方/置顶、最新/热门、搜索、点赞、评论已有。独立标题、板块、标签、主题关注/收藏尚无。 |
| 商品关联 | `supabase/migrations/041_post_items_join_table.sql`、`20260719151729_reconcile_plaza_base_table_acl.sql`、`usePlaza.ts` | `post_items(post_id,item_id,display_order)`；最多3件本人商品，关联时active；读取受帖子/商品可见性限制。当前分步写，有部分成功和结果未知状态。 |
| 商品 | `app/src/composables/useItems.ts`、`app/src/api/searchItems.ts`、`app/src/pages/detail/index.vue`、`pages/publish/` | 商品是价格/状态唯一来源；sell/wanted，active/reserved/sold/deleted。帖子缓存文案不是交易状态。 |
| 私信 | `app/src/composables/useMessages.ts`、`useRealtimeFallback.ts`、`app/src/api/privateRealtime.ts`、`api/realtime-poll.js` | 交易和`is_direct`会话、参与者权限、双向拉黑、私有媒体、轮询补偿、账号切换；不另建消息系统。 |
| 通知 | `app/src/composables/useNotifications.ts`、`app/src/api/notifications.ts`、`api/notification-digest.js`、`api/background-jobs.js` | 现有评论/点赞/举报/交易通知。新增主题关注要扩展类型/文案/路由/去重，不只做按钮。 |
| 审核 | `app/src/utils/contentSafety.ts`、`api/moderate.js`、`useModeration.ts`、`api/admin/index.js`、`pages/admin/index.vue` | 文字规则/AI、举报/申诉/审计已有；用户不能设置official/pinned。H5公共图片自动审核未闭环，`mpImageCheck`在H5为no-op。 |
| 分享/环境 | `api/share.js`、`api/share-post.js`、`api/_deployment-boundary.js`、`api/deployment-identity.js`、`vercel.json` | 旧 `/share/:id`、`/share-post/:id`有效；隐藏内容不能经预览泄露。部署环境、Supabase项目、origin须匹配。 |

现有客户端主要通过Supabase SDK调用受ACL/RLS/列权限/触发器/RPC约束的对象，不是每个动作都有REST endpoint。不要为了统一名称重写全部表访问。

## 3. 官网真实边界

[当前官网工程](https://github.com/a2751012962/caaciorg/tree/f62f62f3688c1ab432a9f4c242aa97fae108ca11)：React 19 + Vite在 `web/`，Pages Functions在 `functions/api/`，`build.mjs` 将React与剩余WordPress静态镜像组装到 `dist/`。后端独立Supabase项目 `wslzeqhipvibeflmxznh`，与Illini身份空间不同。Stripe已用于官网会费/捐款；“社区暂无支付”不代表组织生态没有支付。

| 域 | 真实入口 | 接入含义 |
| --- | --- | --- |
| 文章 | `functions/api/articles.js`、`_content.js`、`web/src/lib/articles.ts`、`0040_content_cms.sql` | 公开published-only API已有；先接摘要/来源/原文，不另做CMS。 |
| 活动 | `web/src/lib/useEvents.ts`、`events.ts`、`functions/api/event-register.js`、`volunteer.js`；`0015/0018/0019/0020/0021/0035`迁移 | 官网已有活动/报名表/志愿者。列表当前直读官网Supabase published events，没有本轮确认的 `/api/events`。社区做公开活动投影与讨论，报名仍在官网。 |
| 身份/会员 | `web/src/lib/auth.tsx`、`functions/api/_lib.js`、`family.js`、`verify.js`；`0014_members_rls_lockdown.sql` | 官网 `members.id`对应其Auth用户；本人可读，写入仅服务端。`/api/verify?m=`是HTML验卡页，不是社区授权用JSON接口。 |
| 付费/商家 | `checkout.js`、`stripe-webhook.js`、`portal.js`、`business-listing.js`、`functions/api/tokens/` | 已有会费/支付/商家/华协币域；本轮未重新验收收费/核销，不等于Local Pass已具备。 |
| 管理员 | `functions/api/admin/`、`_content.js`、`docs/content-management.md` | 官网root/admin/content editor与Illini管理token不同；跨站不继承管理员身份。 |

源码规定main触发官网生产发布，功能PR先入preview；只有preview/release/*/hotfix/*可向main开PR。**官网preview使用Stripe test，但仍共享生产会员数据库和邮件能力；本地dev默认也使用生产Supabase。**这些不是可写的隔离测试环境。

官网没有正常migration ledger，`db:push`/`db:seed`主动禁用。不要解除，也不要套用Illini迁移流程。官网新增迁移先核对现场schema，再按该仓库逐条SQL流程；生产应用/发布由当轮确定的负责人处理。

## 4. 新 VM 准备与启动

首批需要：私有Illini仓库读/分支推送/PR权限，Node22（至少22.15）、npm、Python3、Git、PostgreSQL17测试工具、Playwright浏览器依赖。官网仓库按需读取。Mac连接器有权限不代表VM获得；通过服务登录或受控注入配置，文档/Git不携带token。

### 无生产数据的检查/编译

在新clone内，使用锁文件：

```sh
cd app
npm ci --legacy-peer-deps
npm run type-check
VITE_SUPABASE_URL=https://00000000000000000000.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_ci-stub-key VITE_BASE_URL=https://ci-app-stub.invalid npm run build:h5
VITE_SUPABASE_URL=https://ci-stub.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_ci-stub-key VITE_BASE_URL=https://ci-app-stub.invalid npm run build:mp-weixin
cd ..
npm run verify:migrations
npm test
```

stub仅用于编译/拦截网络的合成夹具，不能登录或证明真实链路。`npm test`包含真实本地数据库回归；缺PostgreSQL就补环境，不能跳过关键SQL测试后报全绿。命令以接手时main的package/CI为准。

- `cd app && npm run dev:h5 -- --host 127.0.0.1`：默认5173，只有前端；`/api/*`不由Vite提供。fixture需拦截相关网络，不能把404当业务故障。
- 完整联调使用独立可丢弃Supabase与合成账号。公开项目URL/key可进客户端；Edge服务端凭证只进隔离服务环境，不能进 `VITE_*`。
- `cd app && npm run dev:vercel`：通常3000，需确认Vercel项目与env都指向测试环境。`DEPLOYMENT_EXPECTED_VERCEL_ENV`、`SUPABASE_EXPECTED_PROJECT_REF`及origin须匹配，不从生产无选择地拉全套env。
- `npm run smoke`启动自己的H5服务器；登录测试使用专用合成用户，符合项目/用户匹配与synthetic标记。配置见 `app/playwright.config.ts`、CI；不使用真实成员账号。
- 官网完整本地服务8788默认连生产，本批不启动。先以脱敏fixture验证适配；以后测官网写路径须先独立配置DB/Auth/邮件/Stripe test并验证隔离。

| 服务权限 | 用途 | 首批需要程度 |
| --- | --- | --- |
| GitHub Illini contents/PR/checks | 编码、推分支、PR/CI | 需要；无需组织管理/仓库删除权限 |
| GitHub官网 | 读合同，后续feed PR | 可先只读 |
| 隔离Supabase | schema/RLS/双账号联调 | 端到端需要；不需要生产凭证 |
| Vercel隔离预览 | Edge完整预览 | 联调阶段；须证明不指向生产库 |
| Cloudflare Pages/Access | 官网预览及部署核对 | 首批论坛不需要 |
| Stripe test、邮件测试接收方 | 未来权益/通知回执 | 首批不需要；代码权限不自动启用真实收费/群发 |

## 5. 迁移、发布与回退

Illini只追加迁移，保留旧hash并更新 `supabase/migrations/manifest.sha256`。检查posts显式列ACL、可见视图、搜索RPC、分享结果、触发器与schema断言，不只改TypeScript。顺序：PRECHECK→隔离迁移→旧数据/anon/A/B/admin回归→受控预览→具体发布记录。ledger仅作线索，现场schema/function/grant才是证据。

新增字段可空，旧客户端仍能发普通动态；不强制回填历史标题或猜板块。回退前端时保留新增列，停止新写路径并向前修复，不删除已经承载真实内容的新对象。权限/RPC改动须有回退或禁写方案，且不能解除旧保护。

Illini `vercel.json`仅main启用Git部署；普通分支不自动产生Vercel预览，不能承诺“开PR就有完整preview”。本地/隔离预览/正式生产分别验收。本批不改生产cron、邮件、DNS、微信开关。

## 6. 可立即实施的第一批

1. 独立分支记录准确main、现有登录基线和受影响文件；认证在途修改另处理。
2. 为现有帖子增量增加标题和五板块，兼容旧动态；数据库/显式读取同步。字段候选见接口合同，不能混用商品category。
3. 现有发布器加标题/板块，保留图片和本人商品关联；失败/结果未知恢复、重复点击、换号通过。
4. 现有广场/详情加展示和板块筛选；匿名看可见内容，A发布、B回复，第三人不能修改/越权关联，售出/删除/停权后卡片与分享正确。

完成证据：小批次测试、必要全回归、H5/mp编译、手机/桌面真实浏览器路径与准确SHA；fixture、隔离真实链路、CI、部署、生产分别报告。官网集成、跨站身份、主题订阅、Local Pass和AI不塞进第一批。

## 7. 未决与交接更新

- 原Mac认证修改的负责人、最终范围、真实旅程证据尚待核实。
- 独立Supabase/Vercel测试环境和VM实际权限未在本轮配好。
- 官网公开活动feed的最小合同和403原因未确定；活动category目前按标题/slug推断，取消/改期语义也需明确。
- 官网文章接口当时为空；Weekly是否在CMS或另一可信来源未确认。
- Local Pass实际仓库、运营主体、商家、价格、核销与资格接口未确认；旧会员仓库不能代替。
- 本轮没有复验官网支付、会员、短信、报名、核销或全部管理安全。

## 8. 证据入口

- [Illini固定基线](https://github.com/EricXu-0805/CAACI_Community_Marketplace_Bazaar/tree/7b18f2052e52a4268c25407d0584748477cbf978)；[正式manifest](https://www.illinimarket.com/deployment-manifest.json)。
- [官网固定基线](https://github.com/a2751012962/caaciorg/tree/f62f62f3688c1ab432a9f4c242aa97fae108ca11)；[README](https://github.com/a2751012962/caaciorg/blob/f62f62f3688c1ab432a9f4c242aa97fae108ca11/README.md)；[SETUP](https://github.com/a2751012962/caaciorg/blob/f62f62f3688c1ab432a9f4c242aa97fae108ca11/SETUP.md)；[CMS合同](https://github.com/a2751012962/caaciorg/blob/f62f62f3688c1ab432a9f4c242aa97fae108ca11/docs/content-management.md)。
- [官网公开文章接口](https://caaciorg.com/api/articles?limit=1)。本轮未调用付费、报名、会员或发信写接口。

## 2026-11-12 首批代码增量记录

基于上述Illini main，在独立工作区 `/Users/xiaogangxu/Downloads/CAACI/Community-Platform/implementation`、分支 `codex/community-topics-20261112` 已完成title/category首批候选实现和本地针对性验证；原dirty目录未合入。该变化不代表远程main或生产已经更新，远端提交由主代理统一创建。范围、可重跑命令、简化数据库/HTTP mock限制及未完成的商品关联恢复UI见 [P2_IMPLEMENTATION](../release/P2_IMPLEMENTATION.md)。上文可复用能力表描述的是已核对main，不能把候选实现当作生产既有能力。
