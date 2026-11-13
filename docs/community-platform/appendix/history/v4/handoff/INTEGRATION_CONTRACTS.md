# 集成接口与数据合同

日期：2026-11-12，America/Chicago。工程/部署证据见 [ENGINEERING_BASELINE.md](ENGINEERING_BASELINE.md)。本文件先区分 **已实现的接口** 与 **待实现的合同**，供后续VM按批次接入；候选名称不是线上已存在API，不要求为未来功能提前铺空服务。

## 1. 数据归属与接入顺序

| 数据 | 权威系统 | 社区持有什么 | 不做什么 |
| --- | --- | --- | --- |
| 商品、成交状态、交易聊天 | Illini现有域 | 同一item ID及按权限实时读取的卡片 | 不复制价格/成交状态为另一份真相 |
| 社区主题、评论、关注 | Illini | posts及增量字段、现有评论、后续关注记录 | 不另建用户/聊天/举报系统 |
| 官方文章与活动 | CAACI官网 | 来源ID、公开摘要、链接、更新时间、可见性投影、活动讨论关联 | 不把官网会员或报名人的资料复制到社区 |
| CAACI会员/家庭/会费/华协币 | CAACI官网 | 用户同意关联后最少量的资格结果；未接入时仅展示入口 | 不从客户端、邮箱或验卡页面推断授权 |
| Local Pass商业权益 | 未来确认的运营系统 | 公开优惠说明；将来有边界的资格查询/核销请求 | 不与CAACI会费、华协币或免费社区账号混为一体 |

依赖与顺序以 `ITERATION_BACKLOG.md` 的 P0–P8 为唯一主清单：P2 论坛字段/路径，P3 关注与治理，P4 官网公开内容适配（只读研究可并行），P7 身份/权益。接口设计先留下约束与fixture，真实适配器与迁移随其批次实现。

## 2. 已存在的接口和字段

### Illini

- 身份：Supabase Auth会话，`profiles.id = auth.users.id`；公开字段与私人资料分开。现有 `useAuth`/`accountScope`负责账号切换时的请求归属。
- 帖子显式读取：`id,user_id,content,images,image_dimensions,content_i18n,source_lang,is_official,is_pinned,like_count,comment_count,status,created_at,updated_at`；`status`为active/deleted/hidden。见 `usePlaza.ts` 的 `POST_COLUMNS`。
- 评论：`id,post_id,user_id,content,content_i18n,parent_comment_id,like_count,created_at`，当前界面将回复归到一层线程。帖子搜索用 `search_posts_fuzzy` RPC，普通列表直读 `posts`，均需保留服务器可见性。
- 商品关联：`post_items(post_id,item_id,display_order)`，最多3件本人商品，关联时商品active；后续reserved/sold从商品读取。删除或不可见时关联的展示可能为空，当前 `stripDeletedItems`会过滤无权读取的嵌入商品。
- 私信：现有 `conversations`/`messages`；`is_direct=true`表示不绑定商品的双人会话。`meetups`是交易面交邀约，不是社团活动。
- 分享：`/share/<uuid>`、`/share-post/<uuid>`经Edge验证可见性，旧链接保留。`/api/moderate`是文字审核/广告提示；`/api/admin`是现有受独立管理凭据保护的管理面。
- 现有通知包含评论、点赞、商品、关注用户、举报及申诉结果；用 `app/src/api/notifications.ts` 与 `useNotifications.ts`扩展。不要另起无归属的通知表。

### CAACI官网

以下源码来自 `a2751012962/caaciorg@f62f62f3688c1ab432a9f4c242aa97fae108ca11`。

| 已有入口 | 输入与结果 | 验证边界 |
| --- | --- | --- |
| `GET /api/articles?column=<slug>&limit=12&offset=0` | `{columns,rows,total}`；limit上限50；未知栏目返回空rows。摘要含id、slug、column_id、双语title/summary、cover/alt、author、published_at、pinned | 仅`status=published`且发布时间已到；本轮真实读通但total=0。摘要不含updated_at，不能据其做可靠增量游标。 |
| `GET /api/articles?slug=<slug>` | `{article,column,prev,next}`；detail额外含body_en/body_zh/status/updated_at | 草稿/未来定时/不存在为404；公开响应cache max-age=30。旧slug变更要用稳定id识别，不以URL作唯一键。 |
| `GET /api/site-content` | `{overrides:{key:{en?,zh?}}}` | 网站文案覆盖层，不是文章/Weekly feed；不当内容目录导入。 |
| 官网 `public.events` | `id,slug,title,title_zh,description,description_zh,starts_at,ends_at,location,image_url,perk_deadline,perk_item_en,perk_item_zh,registration_questions` | `web/src/lib/useEvents.ts`直读published=true；当前不是一个已有的 `/api/events` REST合同。 |
| `GET /api/event-register?event=<slug>` | 匿名得到公开event/questions/open；有官网会话时额外返回本人的报名和volunteer数据 | 不应向社区公共缓存转发Authorization或个人报名响应；本轮旧活动读取403，未定位。仅部分活动有报名表，不能拿该接口枚举全部活动。 |
| `POST /api/event-register` | 实际写报名、可写志愿者并发确认邮件，包含Turnstile验证 | 初期社区只跳官网报名，不代交、不镜像报名表、不后台试POST。 |
| 官网本人会员读取 | `web/src/lib/auth.tsx`读本人members行；服务端 `effectiveMembership`考虑家庭资格 | 不是给跨站客户端任意查询的接口。 |
| `GET /api/verify?m=<uuid>` | HTML验卡结果，显示限定会员信息 | 不是签名的机器可验证授权凭证；不能抓HTML决定社区权益。 |
| `/api/checkout`、`stripe-webhook`、`portal`、`tokens/*` | 官网自己的会费/支付/华协币流程 | 已有代码不等于Local Pass合同；本轮未调用真实写路径。 |

公开文章API本身未在读取的handler中声明跨域CORS；Illini现有CSP也不允许直接从浏览器连接caaciorg.com。优先以同源服务端适配读取公开数据，不靠放宽CSP到任意站点解决。首批论坛不需要新增这一服务。

## 3. 第一批主题增量合同（本地已编码，未部署）

首批固定采用 `posts.title` 与 `posts.category`。这里的 category 是独立的社区板块 text allowlist，不能传商品的 `ItemCategory`，没有复用商品 enum。隔离分支 `codex/community-topics-20261112` 基于 main `7b18f2052e52a4268c25407d0584748477cbf978`；本节描述该候选代码，不代表远程main或生产已具备这些字段。

| 字段/动作 | 本批实现合同 |
| --- | --- |
| `posts.title` | nullable text；非null必须trim后单行1–120 Unicode字符、最多480字节；旧动态null继续可读。保留原正文2000字限制，长文/富文本另批。 |
| `posts.category` | nullable text；allowlist为 `campus-life`、`settling-market`、`alumni-career`、`events-social`、`local-deals`。旧动态null出现在“全部板块”，不自动猜分类。数据库强制title/category同时null或同时有效。 |
| 新建话题 | 既有发帖面板新增“动态/话题”模式。新话题必填title和category；仍须提供正文、图片或本人商品之一。旧动态入口写入两个null；旧安装客户端省略字段仍兼容。 |
| 写权限/审核 | 沿用 `createPost`、原账号token、公共媒体边界和既有RLS；只追加新列SELECT/INSERT授权，不开放新列UPDATE或官方/置顶权限。标题进入客户端、AI/微信现有审核路径，数据库触发器复用既有私有文本校验与审核helper。 |
| 读取与筛选 | 广场、详情、个人帖子卡显示标题/板块，旧动态继续只显示正文。板块筛选在服务端分页前应用。客户端分享文案优先标题；旧URL保留。服务端 `share-post` 的OG预览暂仍使用正文，不将其写成标题SEO已完成。 |
| 搜索 | 新增 SECURITY INVOKER `search_community_posts(terms_in text[], sort_in text='recent', limit_in int=20, offset_in int=0, category_in text=null)`，返回原帖字段外加title/category/profile/rank；最多8个100字符搜索词、每页最多100条。旧 `search_posts_fuzzy(text[],text,int,int)` 原样保留，旧客户端不受返回类型变更影响。搜索结果仍与旧实现一样省略商品chips。 |
| 商品引用 | 保留最多3件本人active商品及既有数据库所有权/状态/数量校验。售出仍呈现真实状态；删除/下架受原读取边界约束。没有改成引用任意可见商品。 |
| 内容类型/标签/精选/解决 | 未实施；第一批没有新建这些字段或状态机。已有is_official/is_pinned继续由原管理面控制。 |

保留现有两步写入语义：帖子已提交但商品关联失败返回 `{id, partial:true, itemsErr}`，显示“已发布但关联失败”，并进入已提交post ID的详情；正常发布同样进入详情，避免当前搜索/板块隐藏新帖。不删除正文/媒体、不重复创建帖子。确定未提交才允许清理上传；提交结果未知或换号后发现已提交，保留重复提交保护并按原错误状态反馈。已用合成测试覆盖这三种结果。**尚无持久client_request_id、原子发布RPC或自动重试附件UI**；本批不宣称网络层恰好一次。下一批若实际需要跨重启恢复，再独立设计幂等键/事务RPC及冲突规则。

候选迁移 `20261112120000_community_post_topics.sql` 追加两列、约束、标题审核触发器、索引和新搜索RPC；以同签名重发已有举报快照/管理详情函数，仅扩展post分支保存并显示title/category。旧快照回退正文，删帖后保留标题/板块证据，管理员接口仍仅service_role可执行。发布顺序为：核对隔离数据库现状→迁移与真实API/RLS验收→部署新客户端。回滚优先回退客户端、保留nullable列及已写数据和旧RPC；不要删列丢失话题，不把本地临时PG通过等同于目标环境已应用。

## 4. 官方内容引用合同（待实现）

候选归一化形状：

```ts
type PublicSourceRef = {
  source: 'caaci';
  sourceKind: 'article' | 'event';
  sourceId: string;
  canonicalUrl: string;
  title: { en?: string; zh?: string };
  summary: { en?: string; zh?: string };
  sourceUpdatedAt: string | null;
  checkedAt: string;
  availability: 'visible' | 'unavailable' | 'unverified';
};
```

这是适配层合同，不是要求当前数据库立即存所有字段。`(source,sourceKind,sourceId)`是唯一来源键；slug/URL可变。只允许固定HTTPS来源与已批准路径，验证大小/类型/超时/跳转，避免把用户URL做成任意代理。正文即使来源官方也是不可信HTML；初期只显示文本摘要，后续富文本须使用明确的净化规则。

候选社区入口 `GET /api/community/sources?kind=article&cursor=...` 由同源服务端适配现有API，返回归一化卡片；**该路由尚未实现**。接入时定义有限页面大小、总量与缓存，不把原站offset称为稳定cursor。初期完整有界核对；如内容增长，再给官网提带稳定排序的增量feed/删除记录合同。

失败处理：超时/5xx/403/解析失败设unverified、保留上次核对时间，不伪装为空列表或判定原文删除。获得明确404或发布撤回后停止推荐，旧讨论可保留“来源不可用”标记。不能因某一页没有对象就删除本地关联；必须完成一次有界全量对账或得到明确删除证据。管理员撤稿/改为私密须能通知或在已约定刷新窗口内移出公开索引；缓存窗口要写入该批验收，不能承诺未实现的实时同步。

文章摘要接口不带updated_at，detail有；不要仅依赖published_at漏掉后续编辑。现站文章当时为0，因此第一次展示优先空态与“暂无公开文章”，不虚构官方内容。

## 5. 活动投影与讨论（待接入）

官网活动是权威源；社区建立活动投影/引用与讨论关系，不另造报名真相。

- 最小字段：source/sourceId、双语标题/摘要、canonicalUrl、UTC startsAt/endsAt、明确显示时区、公开地点、报名URL、checkedAt、availability、discussionPostId。官网当前按America/Chicago显示；未来其他城市必须显式带IANA时区。
- 源已有published布尔，但已读字段没有权威cancelled/rescheduled枚举、updated_at或完整变更序号。**未发布不等于取消**；结束不等于取消；字段缺失显示unknown，不从文案推断取消。优先给官网新增小型公开feed来传这些状态，而不是读取管理员接口。
- 同一 `(source,sourceId)` 只有一个主要讨论；创建/重试需唯一约束和事务保证，更新活动不新开重复主题。活动归档后讨论仍按论坛规则存在，报名入口关闭或清楚跳往原站。
- 初期报名按钮直接打开可信官网报名页，返回社区时仍显示“查看报名状态请到官网”；跳转不算报名成功。只有未来授权回执合同可以改变这一点。
- 不读取/同步报名者邮箱、电话、回答、家庭、志愿者名单；绝不把带官网会话的event-register响应放进公开缓存。
- 验收：改期、结束、取消unknown、草稿撤回、源403/超时、无报名表、重复导入、活动删除、讨论已被审核隐藏、手机返回，分别有fixture和适用真实读取证据。

## 6. 身份与资格连接（后续独立批次）

默认两个站分别登录；同名、相同邮箱、相同UUID文本均不证明是同一人。官网Supabase token不能直接当Illini token使用；也不共享localStorage、密码或service-role key。

未来真正需要关联时，先确认官网能提供的受审查身份授权方式。优先标准的Authorization Code + PKCE/OIDC（需要实际提供方配置与验证）；否则单独设计双方控制权证明，不临时用浏览器互传token拼SSO。此文**没有宣称官网目前提供OIDC授权端点**。

候选 `external_account_links`：community_user_id、issuer、external_subject、linked_at、revoked_at；issuer+subject唯一，必要时对每个用户/issuer限制一个有效关联。只保存服务端验证后稳定subject，不把邮箱作为主键；两端已有内容不自动合并。重放、并发抢绑、过期、错误audience/issuer、用户切号、断网结果未知、撤销都要拒绝或可安全恢复。

候选资格查询 `GET /api/community/eligibility?program=caaci-membership`：登录用户仅查自己，服务端凭证范围限资格；返回 `{program, status, validUntil, checkedAt, reasonCode}`，status至少区分active/inactive/unknown。不返回会员手机号、支付ID、家庭成员或管理员字段；停机/过期缓存返回unknown，不继续授予权益。家庭有效资格依官网 `effectiveMembership`，不能只看本人tier字段。

解绑阻止新资格查询、清缓存并保留最少审计；不会取消另一站真实会员或删除另一站账户。账户删除必须处理映射及缓存，但不能自动退款/删订单。社区管理员身份与官网编辑/管理员身份绝不随关联迁移。

## 7. 优惠与 Local Pass（后续独立批次）

公开优惠合同：offerId、provider、merchantId、双语说明、termsUrl、start/end、核验时间、eligibilityProgram、status。CAACI官网商家目录只证明公开商家信息，不能自动当作签约Local Pass商家或承诺折扣。用户优惠帖也不等于官方可核销权益。

真实资格/订单由对应运营系统负责；同名商品不得混用CAACI会员会费、华协币、赞助、捐款和Local Pass订阅。未接通时按钮只提供说明/原站入口，不显示虚假已购或生效价格。

候选核销操作应包含merchant身份、offer ID、短时单次证明、request ID；服务端验证资格和次数，在单一权威系统原子扣减。相同请求重放返回同一次结果，不重复扣款/核销；不同内容复用key拒绝。二维码不能只有永久会员UUID就允许扣减。退款/取消、离线、过期、售罄、商家权限撤回、重复和乱序支付事件各有回执。支付成功回跳不授予资格，最终以验证的服务端事件/主动查询为准。

本轮仅定边界，没有建立支付产品、订阅、商家、核销路由、webhook或真实收费。

## 8. 通知、搜索、删除与审核共同约束

| 事项 | 合同 |
| --- | --- |
| 主题关注/收藏 | 独立语义；候选唯一键user_id+post_id，关注控制新事件通知，收藏只保存本人清单。取消关注不能继续产生新提醒；已有历史通知可保留且可见性重新核对。 |
| 通知去重 | 使用服务器生成的稳定source event ID与recipient唯一组合，不能每次重试生成新ID。复用现有通知/后台任务，不让客户端指定任意接收人；明确失败、重试、投递未知。 |
| 通知内容 | 默认站内；邮件跟随现有用户偏好和实际授权，不因新主题默认群发。私信正文不放入公开feed，隐藏/删除目标的通知不得泄露原内容。 |
| 搜索 | 分清帖子/商品/活动类型，查询时应用当前可见性。删除、停权、源撤回、商品下架后不能靠缓存继续出现敏感摘要。收藏历史不绕过权限。 |
| 审核编辑 | 新标题/板块/正文/换图/对象引用一起纳入权限与审核；审核服务不可用不能标成已通过。增加角色只能经服务端权威校验。 |
| 论坛内容策略 | 原二手广告分类不能直接用来封锁所有求职/优惠讨论。正常招聘、联系方式、中英混合、图片及误判案例有单独验收。 |
| 外部删除 | 来源不可用影响公开推荐和链接，不自动删除社区作者的独立评论；保留来源失效标记与必要审计，按实际隐私请求另处理。 |

## 9. 每个接口批次的验收与发布合同

1. 固定源码SHA和目标环境；先运行只读schema/权限核对。候选字段只追加，旧显式SELECT、RPC返回形状、共享profile复合类型/视图及grant断言需一起检查。
2. 本地或隔离真实数据库覆盖匿名/A/B/admin、伪造user_id、越权对象、停权/拉黑、双提交、重放、断网结果未知、旧客户端兼容。fixture通过不替代真实API/RLS链路。
3. 浏览器覆盖完整动作、空态、源故障、迟到响应、换号/退出、手机/桌面与旧链接；需要写路径时仅用合成账号/隔离环境。官网preview共用生产库，不能当成该隔离环境。
4. 写明迁移先后、前后端兼容窗口与可逆操作；先保留旧读能力，再迁移新写，最后才考虑收紧约束。回退代码时不删已产生的数据；生产迁移采用独立明确步骤，不盲跑db push。
5. 交接记录区分已设计、已编码、本地验证、CI、隔离部署、正式生产；附失败和未验证条件，不用文档表格勾选替代实际回执。

## 10. 本合同仍待选择的项目

- 首批已固定：新话题必填title/category，旧动态入口继续允许二者null；扩大到长文/标签/解决状态需要另批验收。
- 跨重启/网络结果未知恢复仍待后续设计；首批仅保留现有部分成功与重复提交保护，没有引入原子RPC/client_request_id。
- 官网公开feed负责人、允许摘要范围、刷新/撤回时限、文章供给与Weekly入口；活动403原因。
- 跨站身份协议与资格服务的实际提供方；Local Pass真实系统、运营责任与退款/核销合同。
- 正式生产审核、申诉与内容维护负责人；AI开发不等于有人持续处理真实举报。

依据：Illini main `7b18f205...` 的上述源码；[官网文章实现](https://github.com/a2751012962/caaciorg/blob/f62f62f3688c1ab432a9f4c242aa97fae108ca11/functions/api/articles.js)、[活动读取](https://github.com/a2751012962/caaciorg/blob/f62f62f3688c1ab432a9f4c242aa97fae108ca11/web/src/lib/useEvents.ts)、[报名实现](https://github.com/a2751012962/caaciorg/blob/f62f62f3688c1ab432a9f4c242aa97fae108ca11/functions/api/event-register.js)、[身份实现](https://github.com/a2751012962/caaciorg/blob/f62f62f3688c1ab432a9f4c242aa97fae108ca11/web/src/lib/auth.tsx)、[内容合同](https://github.com/a2751012962/caaciorg/blob/f62f62f3688c1ab432a9f4c242aa97fae108ca11/docs/content-management.md)。

本地首批变更依据：隔离分支 `codex/community-topics-20261112` 的 `20261112120000_community_post_topics.sql` 与对应客户端，基线仍为上述main；新迁移增加title/category并扩充举报post证据与管理员详情，未应用托管数据库。实际检查范围与P2尚缺的失败商品关联恢复UI见 [P2_IMPLEMENTATION](../release/P2_IMPLEMENTATION.md)。远端提交由主代理写入交接记录。
