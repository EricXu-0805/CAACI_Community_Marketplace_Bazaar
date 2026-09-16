# 微信与网站共用账号：实现与启用说明

状态：代码候选完成，数据库已在测试环境完成合成账号闭环。生产功能关闭；尚未证明真实微信体验版端到端登录。

## 用户怎么用

网站用户（包括只用 Google 登录的用户）登录 illinimarket.com → 设置 → 关联微信账号 → 生成一次性码。小程序登录页选择“用过网站？关联已有账号”，输入码，确认显示的是自己的昵称/遮挡邮箱，再点“确认关联并登录”。后续直接微信登录，沿用原 user ID、商品、收藏与聊天。

新用户可在小程序选择注册，阅读并勾选协议后用微信注册。点击“微信登录”不会默默创建新账号。已经各自有内容的两个账号不自动合并；同名、用户输入的邮箱、客户端 openid 和可编辑元数据均不是控制权证明。

## 实现边界

- 绑定码 50-bit 随机值、HMAC 存储、5 分钟有效；每个网站用户最多一条票据。重新生成使旧码失效。
- 网站 bearer 必须由 Auth 验证，JWT 内 sub/session_id 必须匹配；数据库再核对会话存活、创建时间≤30分钟、真实已验证邮箱、未停用/删除/注销中。MFA 账号暂不允许添加这个登录方式，避免降级。
- 小程序预览和确认都需要新鲜微信 code 由服务端交换。预览只返回昵称、遮挡邮箱、到期时间与独立随机确认 proof；确认原子消费并绑定真实微信身份。
- API 保留已有网络/身份限流、8 秒上游截止、2KB 请求和256KB上游响应上限。绑定码、proof、openid、邮箱、tokens 不进日志或 URL。前端响应64KB上限。
- 新绑定是服务端自定义提供方关系，不等同于 Supabase 原生 `auth.identities` 中增加一个 WeChat OAuth provider。Supabase 原生 `linkIdentity` 不能直接用来接未支持的提供方。
- bound openid 登录先查原账号，核对 Auth 返回的 user ID/email、停用/MFA/注销状态，再签发 session。Auth 返回不同用户时拒绝，不降级创建占位用户。Google 元数据不改，不发送邮件，不转移密码。
- 票据到期后由既有小时清理任务调用 `prune_wechat_link_requests()`，每批最多1000条、每轮最多5批，共用20秒截止。必须保留清理开关，即使暂停新关联。
- 只使用当前同一个微信 AppID 的 openid。今后 CAACI 主 App/其他小程序不能直接复用它；跨应用需经过审查的统一身份/OIDC 或微信开放平台关系。unionid 必须由微信返回，不能由客户端声明。

## 启用顺序

1. 部署本轮候选代码及迁移 `20260916073035_wechat_account_link_tickets.sql`；生产迁移本轮尚未应用。验证私有表/四个服务函数权限，保留原账号数据。
2. 完成 `20260718140000_retire_wechat_password_credentials.sql` 的历史密码退役证据。不能仅凭换了无密码登录接口就认定旧密码失效。
3. 用微信体验版真实账号验证：已绑定用户、Google-only网站用户、邮箱用户、新用户、已有两个账号冲突、取消/过期、后台恢复、网络断开后重试；核对生成的 Supabase session 真是原用户 ID。当前 SQL canary 与接口 mock 不替代这一步。
4. 更新正式隐私政策及相应同意版本/审核说明：说明可选微信登录和双端关联、openid/unionid、占位邮箱适用范围、哈希票据/短期确认和保留期限。当前线上政策仍描述微信未开放，不能先开功能再补文案。
5. 在目标环境启用 `WECHAT_LOGIN_ENABLED=true`、`WECHAT_ACCOUNT_LINK_ENABLED=true`、`WECHAT_LINK_RETENTION_ENABLED=true`；核对微信 AppID/Secret、合法域名、隐私接口声明、内容安全回调及审核配置。凭据只在服务端。
6. 确认设置/登录入口出现、真实流程正常、小时清理成功后，再提交平台审核。暂停新关联仅关闭 ACCOUNT_LINK，保留 LOGIN（既有关联用户仍可登录）和 RETENTION；严重登录事件按独立应急策略处理。

## 可核查证据

- `scripts/wechat-account-link.test.mjs`：真实本地 PostgreSQL 权限/竞态/重放/失效/MFA/清理。
- `api/_wechat-account-link.test.mjs`：合成提供方和 Auth 响应的端点验证，不能代表真实微信服务可用。
- `app/smoke/wechat-link-page-lifecycle.test.mjs`：实际页面脚本的控制器测试，覆盖切号/隐藏/迟到结果，不能代表实体系统输入法或相册。
- 测试环境事务 canary：真实触发器、原用户绑定、错误 proof/重放拒绝；整体回滚，复核无残留。

参考：[Supabase 身份关联](https://supabase.com/docs/guides/auth/auth-identity-linking)、[Auth 会话生命周期](https://supabase.com/docs/guides/auth/sessions)。
