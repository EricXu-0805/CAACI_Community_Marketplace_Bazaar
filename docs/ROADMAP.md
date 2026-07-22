# Illini Market 发布路线图

> 最后更新：2026-07-23
> 当前阶段：合并前生产数据库 34/38 → 三条生产 tail 后 37/38 → matching-bundle canary/production readiness
> 原则：以可复查证据关闭门禁，不以文件存在、测试小计或文档勾选冒充上线。

## 当前状态

核心 H5/微信小程序、Supabase 数据模型、Vercel Edge API 和管理员后台已经存在。
2026-07 全项目审计把大量身份、RLS/ACL、Storage、Realtime、管理员、邮件、
注销、可访问性和依赖缺陷修成 38 条候选链。合并前生产数据库已经按精确 SQL
与 ledger 原子应用 34/38；按顺序完成 145042、152000、161200 三条生产 tail
后为 37/38，届时仅 `18140000` 仍须等待 passwordless WeChat canary。稳定
H5/API bundle 仍是旧版本。

因此目前不是“规划期”，也不是“正式上线”：它是需要严格上线演练的 release
candidate。

## R0：本地 release candidate（本轮）

- [x] Node 22、npm 10、CI/pre-push/runtime 基线；
- [x] 全部页面/账号异步状态、A→B/匿名隔离和恢复/重签/停权门禁；
- [x] 公共写入 ACL + RLS + 列权限 + trigger/RPC；
- [x] 双向 block、证据快照、archive、durable 注销；
- [x] 精确成交归属与双方评分；
- [x] 公开图片/Storage quota/owner path 与 private Realtime；
- [x] per-admin role/capability、原子 mutation/audit/idempotency、banner saga；
- [x] notification attribution、原子 reminder、email claim/lease；
- [x] Sentry/client/server log privacy boundary；
- [x] 真实本地 type-check、H5/mp/Vercel build、deterministic tests、两套 PG16 replay
  和应用内浏览器旅程（最终数字与限制写入当次审计报告）；
- [x] 移除 H5 LGPL fallback decoder；保留原生 HEIC 解码并在不支持的浏览器明确拒绝；
- [ ] DCloud 官方支持安全 Vite line 后完成协调升级。

上面的 `[x]` 指候选和本地证据；合并前数据库为 34/38，三条生产 tail 完成后
为 37/38，且仅微信凭据退役仍待；这不代表 matching
H5/API/微信小程序 bundle、provider、管理员 Owner 或真实设备门已经关闭。

## R1：staging 放行门禁

负责人需要在与生产等价、可丢弃的环境完成：

1. 导入 production-like ledger/schema/storage metadata，跑全部只读 PRECHECK；
2. 按 runbook 顺序部署完整候选链，跑 VERIFY、事务内 REGRESSION、候选重入和
   schema/grant/policy/function diff；
3. additive 配置 publishable/secret key，保留 legacy client compatibility；
4. 两个真实测试账号覆盖注册、验证、reconsent、发布、搜索、收藏、关注、帖子、
   评论、block、消息、offer、meetup、成交、评分、通知、archive、换号和注销；
5. operator/security/owner 三角色后台覆盖错误 token、过期/撤销、举报、停权、
   申诉、banner、required audit 回滚和 owner recovery；
6. Resend test → live canary、OpenAI moderation/translation、Nominatim、Sentry、
   WeChat login/seccheck/callback、Realtime websocket/fallback 故障注入；
7. iPhone Safari、Android Chrome、微信 iOS/Android 真机，含弱网、后台恢复、
   HEIC、键盘、VoiceOver/TalkBack/微信读屏；
8. 验证 help/support、rights request、appeal、unsubscribe 和事故值班渠道真的有人
   接收和处理。

任一核心步骤只有模拟 fixture、静态测试或浏览器截图时，状态必须写“部分验证”，
不能升级为 pass。

## R2：生产迁移与受限 beta

生产写操作必须另获明确授权：

1. 冻结非必要变更；导出 ledger、schema、grants、policies、functions、Auth 统计
   与 Storage bytes，完成数据库和对象备份/恢复演练；
2. 先跑生产只读 PRECHECK；漂移不明即停；
3. 按 runbook 分阶段部署 API/H5/mp 与 migration，WeChat legacy credential 退役
   先 dry-run、再授权 apply，不能跳过 guard；
4. 每阶段立即跑 VERIFY、最小 anon/A/B/admin canary，监控 401/403/409/429/5xx、
   Realtime、Storage、cron、Sentry、database advisor 和慢查询；
5. 验证 rollback/forward-fix；不要对有真实用户写入的新 schema 做盲目 down
   migration；
6. 安全注销或管理员路径验收后，再处理上轮 disposable 测试账号残留；不得直接
   篡改 Supabase Auth/Storage 内部表；
7. 只有连续观察窗稳定且运营支持 ready，才逐步扩大 beta。

## R3：beta 稳定化

- 建立每周权限/drift/advisor/依赖/cron/支持工单复盘；
- 给头像、商品、广场、举报 evidence 和历史行建立引用感知媒体 GC；
- 将 provider delivery、email backlog、account-deletion pending、banner GC、
  admin audit failure 变成可告警指标；
- 把 optional authenticated smoke 升级为有受管 staging secrets 的 required
  journey，同时避免 fork PR 获得 secrets；
- 拆分 `ChatThread`、admin、home、plaza、publish/detail 等大型 SFC，并生成/更新
  Supabase Database types；
- 用真实流量数据做索引/查询优化，不用破坏性 k6 默认指向生产。

## R4：产品扩展（需要新决策）

以下不是当前 release 延期项，而是独立产品项目：

- CAACI/Illini 会员、coupon、商户合作和收费；
- 平台支付、托管、物流或交易保障；
- 用户自定义 sticker、聊天媒体或群聊；
- 更强搜索/推荐、官方内容和活动；
- 原生 iOS/Android、Apple Wallet；
- 独立管理员域、短时 WebAuthn/session、双人审批等更强治理。

每项必须先明确用户价值、运营 owner、数据来源、滥用模型、支持/恢复路径、合规
义务和可逆发布方案，再进入实现。

## 持续技术债队列

| 优先级 | 项目 | 关闭条件 |
|---|---|---|
| P0 release | production ledger/schema drift | 有备份、staging rehearsal、生产 PRECHECK/VERIFY 和签字证据 |
| P0 release | 真实 provider/双账号/管理员/真机 | 完整 journey 证据；失败重试和恢复也通过 |
| P0 release | support/rights/appeal 值班 | 地址、SLA 表述、owner、演练与 audit trail 全部真实 |
| P1 supply chain | DCloud + Vite | 官方兼容版本、clean install、双端/真机回归、full audit 无未评审 high |
| P1 performance | CJK fonts / HEIC / large SFC | 按真实 waterfall/interaction 指标优化，无视觉/多端回归 |
| P1 ops | cross-reference media GC | 私有引用 ledger、lease、dry-run、恢复与误删保护 |
| P2 product | 会员/商户/支付等 | 新 PRD、threat model、运营 owner 和阶段性验收 |

最终权威状态见最新 [`docs/audit/`](./audit/) 报告和
[`RUNBOOK.md`](../RUNBOOK.md)，不是旧 session 记录。
