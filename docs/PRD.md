# Illini Market 产品需求文档

> 版本：Release Candidate 2026-07
> 最后更新：2026-07-19
> 状态：核心产品已实现；生产数据库已按精确 ledger 应用候选链 34/35，稳定
> 应用 bundle 仍是旧版本。正式 beta 仍受 matching canary、WeChat 密钥与凭据
> 退役、HIBP、首位 Owner、真实账号/provider/真机和运营门禁约束。

## 1. 产品定位

Illini Market 是面向 UIUC / Champaign–Urbana 社区的中英双语校园二手
交易与社区信息平台。平台帮助用户发现商品、发布求购/出售信息、在站内协商
价格与见面地点，并通过社区广场建立本地信任。

当前产品是**信息与交易协作平台**：

- 不保管货款，不提供平台支付、托管或物流；
- 不承诺商品真实性，提供举报、屏蔽、停权、申诉和人工复核能力；
- 不把“有过聊天”当成真实成交，只有 accepted offer + 卖家确认的精确成交
  归属才能开放双方评分；
- 不把设备指纹当自动处罚证据；只作为管理员人工调查信号；
- 不包含原初设想中的 CAACI 会员卡、coupon、商户投流、自动新闻或 Apple
  Wallet。它们不是当前 release 的隐性承诺。

## 2. 目标用户与核心任务

| 用户 | 最重要任务 |
|---|---|
| 未登录访客 | 浏览当前可见商品、广场内容、公开卖家资料和法律/安全说明 |
| 普通用户 | 发布/编辑商品与帖子，收藏/关注/评论，私信协商，管理通知和隐私 |
| 买家/求购方 | 搜索，发起站内会话，报价，安排 meetup，确认交易反馈 |
| 卖家/供给方 | 管理 active/reserved/sold 状态，接受报价，确认成交方，获得评价 |
| 已停权或需重签协议用户 | 看到原因、期限和可用申诉路径，不能绕过写入门禁 |
| 管理员 | 以独立 bearer/capability 处理举报、内容、停权、申诉、token 和 banner，并留下可追责 audit |

## 3. 信息架构

主导航为五个 Tab：

1. **首页**：商品瀑布流、出售/求购切换、分类、搜索与 saved search；
2. **广场**：中英社区帖子、图片、评论/点赞、关联商品和受控 banner；
3. **发布**：商品发布/编辑；广场在自身页面发布帖子；
4. **消息**：会话列表、未读、pin/mute/archive 和私信；
5. **我的**：资料、商品状态、历史、关注/屏蔽、通知、验证、设置与注销。

`pages.json` 中声明的其余页面用于详情、卖家资料、认证/onboarding、恢复密码、
协议重签、停权、管理员和法律内容。路由数量不是产品成功指标；每个入口必须
有可恢复的 loading/empty/error/auth 状态。

## 4. 核心功能与验收

### 4.1 认证、同意与账号隔离

- Email/password 与已配置的微信 passwordless provider；
- onboarding 在完整 profile、当前 consent 和账号 intent 都满足后完成；
- Illinois 邮箱验证码通过原子 RPC 生成/消费，不能因并发重复使用；
- recovery code 只绑定发起恢复的 session，URL token/code 会尽快从地址栏
  和持久化存储移除；
- 登出、删除账号、A→B 换号和 A→匿名必须清理账号级内存、Storage cache、
  Realtime、toast、翻译和页面异步结果；
- suspended、reconsent、profile incomplete 不能靠深链或旧页面状态进入写流程。

验收要求：同一浏览器两个账号交替操作时，B 永远看不到 A 的草稿、历史、会话、
未读、私有 toast 或晚到响应；服务端仍以 JWT + RLS/RPC 为最终边界。

### 4.2 商品发现与发布

- 发布出售/求购，填写标题、描述、价格、分类、成色、区域和图片；
- 图片仅接受受支持 raster 格式，客户端压缩；Storage 验证 owner path、5 MiB
  单文件限制、数量与总字节 quota；
- 搜索、分类、价格、状态和中英 synonym；saved search 对 `%`/`_` 按文字而非
  wildcard；
- 收藏、关注、浏览去重与公开卖家信息；
- active → reserved → sold/deleted 状态机由数据库强制；sold/deleted 为受控
  终态，不能靠客户端直写回滚；
- 上传和数据库写入绑定同一 account generation。明确拒绝才补偿对象；超时/
  响应丢失按 outcome unknown 处理并允许幂等恢复。

### 4.3 广场

- 用户发布文字/图片帖子、点赞、评论和关联自己的可见商品；
- 文本长度、控制字符、NFKC、联系方式/二维码与 moderation 状态在客户端和
  数据库双重约束；
- 匿名/普通用户只能看到 active、未因作者停权或 moderation 隐藏的内容；
- 新建或变更 banner 图片必须来自管理员 managed upload ledger，不能把任意
  HTTPS 图像当成受信资源；
- 空态使用真实本地资源，手机/桌面布局无横向溢出，键盘可操作主要控件。

### 4.4 私信、报价与 meetup

- 两位 participant 的精确 conversation；block 任一方向后双方都不能继续发送；
- 文本、emoji、内置 sticker 与结构化 offer/meetup/system 事件；当前公共聊天
  **不支持图片或视频附件**，代码、Storage policy、文案和测试必须保持一致；
- 消息 ID 在客户端发送前生成；retry/response-lost 复用同一 ID，防止重复消息；
- private Realtime channel + account-bound polling fallback；换号/离页立即 teardown；
- offer 支持出价、还价、接受/拒绝/过期；meetup 支持 propose/reschedule/
  confirm/cancel，并使用 campus time；
- 删除会话入口只 archive 当前用户的 inbox，不删除另一方共享记录；新活动可按
  明确规则恢复；
- 举报具体消息必须保留 message target/evidence attribution，不能退化为举报用户。

### 4.5 成交与评分

- 卖家只能从该商品 conversation 中精确 accepted offer 确认成交；
- 私有成交 ledger 固定 listing、offer、conversation、双方、同意价格和时间；
- 每方只能对该成交中的另一方评价一次；无关 conversation 不产生资格；
- 公开 listing/评分不泄露 accepted offer、buyer、conversation 或私有 ledger；
- 删除/注销后的留存与外键行为必须与隐私政策一致并由回归证明。

### 4.6 通知与邮件

- in-app 通知有 typed payload、conversation attribution、未读与 mark-all-read；
- meetup/unread reminder 由一个原子 RPC seed；
- immediate meetup 与 daily digest 共享数据库 claim/lease/provider idempotency
  key，不能重复外发同一 notification；
- block、未知类型、缺失 conversation attribution 或权限查询失败时不发送；
- live 邮件要求显式开关、严格 HTTPS app origin、verified sender 和 cron secret；
  test 地址只收到 synthetic sample，不得预览生产用户内容；
- 用户可以退订外发提醒，站内必要通知语义单独说明。

### 4.7 信任、安全与管理员后台

- 举报 user/item/post/comment/message；pending 去重，resolved 后可对新事件再举报；
- 停权 level 与期限有权威 row，过期/提前解除后 public view、写门禁、页面和 admin
  一致恢复；
- 申诉绑定当前账号、目标 sanction 与 intent；人工复核，不承诺固定处理结果；
- per-admin token 分 operator/security/owner capability；无共享 env key fallback；
- 所有业务 mutation 原子验证 token 活性/角色/actor、写业务结果、幂等 journal 和
  required audit；required audit 失败即回滚；
- banner upload 是 prepare/upload/complete saga，异常对象由 leased GC 清理；
- 管理页面 token 只驻留内存，错误消息不暴露 provider/schema 细节。

## 5. 数据、隐私与注销

- 公开与私密字段按最小权限分离；客户端不获取 email、phone、fingerprint、
  trust score、admin token hash 或成交私有归属；
- Sentry/provider 日志使用净化 URL、固定事件码和 bounded context，不记录 token、
  恢复 code、正文、邮件、精确位置或任意 upstream message；
- 注销是 durable saga：先持久 job/tombstone，再删 owner Storage、Auth/业务数据、
  旧 provider 凭据，最后擦除 job 临时标识；失败可单调续跑；
- report snapshot 可保留受限文本/metadata evidence；图片 URL 不是二进制副本；
- retention 只清理明确定义的 ephemeral operational rows，不用 broad delete 代替
  法律/治理决策。

完整用户承诺以当前中英文 privacy/terms/guidelines 为准；若实现、数据库或
provider 配置改变，必须先评估是否触发新 consent version。

## 6. 非功能指标

| 维度 | 发布要求 |
|---|---|
| 安全 | anon/A/B/suspended/reconsent/admin/service-role 权限矩阵；生产 secrets 不进客户端；所有外部请求有认证、限流、总超时、响应上限和重定向策略 |
| 可靠性 | async 操作可取消/幂等/可恢复；账号切换 fail-closed；数据库迁移可重放；cron backlog 可观测 |
| 性能 | H5 只用浏览器原生 HEIC 解码、无内置 decoder；图片有尺寸/缩略图/lazy load；字体使用 unicode-range + immutable hash；无不必要全表/全对象扫描 |
| 可访问性 | 手机/桌面、light/dark、键盘、焦点、role/name、dialog Escape/restore；VoiceOver/TalkBack/微信读屏为真机门禁 |
| 国际化 | 中英文 key 完全对齐；错误、管理员、法律和恢复流程不能只翻译 happy path |
| 运维 | Node 22 deterministic CI、production dependency audit、两库 PG replay、Vercel build、staging provider canary、监控和可回滚发布 |

## 7. 明确不在当前 release

- 平台支付、托管、物流、押金或交易担保；
- CAACI 会员卡、收费会员、coupon、商户广告/投流；
- 用户自定义 sticker/media chat；
- 自动新闻抓取或自动处罚；
- iOS/Android 原生 App 和 Apple Wallet；
- 没有经过人工治理批准的 production load test、数据清理或迁移。

这些功能进入排期前必须重新做隐私、安全、运营、可恢复性和真实交付评估，不能
仅因旧 PRD 曾列出就视为承诺。
