# CAACI 入口、首发试用与未来 App 关联

2026-09-16。本轮提供实施方案和可嵌入素材；未修改 CAACI 官网、发送周报、群消息或社交帖子。现站实时核查为 https://caaciorg.com/ ，有中英文首页、资源、社区日历与会员入口。未来 CAACI/同城 App 的代码与身份系统尚未提供，不能把下面的方案记作已集成。

## 先解决“有人来，但没东西可看”

当前生产公开首页仅看到1件在售商品。首发最需要的是可买、信息完整、卖家愿意回复的真实内容。大范围投放前，先邀请愿意参与的成员发布自己的真实闲置与求购，不创建假卖家、假成交或用演示商品填充线上。

建议先找10–20位愿意回应的种子用户，目标是覆盖台灯/家具/书籍等几个常见需要；这是试点规模建议，不是容量承诺。发帖时帮他们补齐尺寸、瑕疵、包含配件和大致取货地点。每周周报可以放“怎么用”或卖家明确同意分享的真实商品链接。已售链接必须能显示已售/不可用，不能为了宣传保留过时价格。

## 官网放哪里、怎么放

1. 中文和英文首页的社区介绍之后放一张集市入口卡片，手机单列、电脑横排；文案和两个操作按钮见 `output/launch-kit-v3-20260916/caaci-entry.html`。它是独立 HTML/CSS 片段，无第三方脚本或追踪器。
2. 导航“资源”下增加“社区集市 / Community marketplace”普通链接。无需让访客在 CAACI 官网再次注册才能浏览集市。
3. 周报放一段实用短文和一个链接；本轮已有中英成稿。第一次解释网站用途，后续更新真实内容和使用经验，不重复发同一张海报。
4. 当前站点禁止 iframe 嵌入。保留安全头，用独立卡片跳到集市，不把整个网站塞进公众号/官网 iframe，不把账户令牌传给官网。

## 链接约定与来源区分

| 场景 | 当前可用入口 | 注意 |
| --- | --- | --- |
| 官网首页卡片 | `https://www.illinimarket.com/?utm_source=caaci&utm_medium=website&utm_campaign=web_trial` | 来源标签不含用户信息 |
| 周报 | `https://www.illinimarket.com/?utm_source=caaci&utm_medium=newsletter&utm_campaign=web_trial` | 正文仍显示正式域名 |
| 微信群/朋友圈 | 正式域名或本轮已校验网页版二维码 | 不能称为小程序码 |
| 分享具体商品 | 站内“分享”生成 `/share/<uuid>` | 保留已有服务端可见性检查与网页回退 |
| 分享具体动态 | 站内“分享”生成 `/share-post/<uuid>` | 私密/下架内容不应泄露 |
| 小程序 | 审核并上线后生成对应正式小程序码/官方链接 | 本轮未生成或承诺可用 |

UTM 只是预先约定的来源标签，目前不代表已实现可靠的渠道归因。不要在 URL 中放邮箱、账号ID、消息内容、授权码、refresh/access token。第一轮用已有访问统计和用户自愿反馈看来源，后续确需埋点再定义必要事件、同意和保留期。

## 未来 CAACI / 同城 App：先通路，再通账号

阶段一：App 的“社区”或“生活”页增加集市卡片，使用系统浏览器打开上述正式 HTTPS 页面；应用内遇到登录时优先系统认证会话。保留浏览器返回、登录后回到原商品、内容已删除时可返回首页。不承诺普通 WebView 和 Safari 会共享登录状态。

阶段二：有正式原生应用后，为现有 `/share/<uuid>` 和 `/share-post/<uuid>` 配置 iOS Universal Links / Android App Links；网站永远作为未安装、旧版本或关联失败时的回退。Apple 的 association 文件、Android assetlinks 需真实 team/bundle/package/签名信息，当前不能虚构。只解析允许的页面类型和 UUID；外部URL不能任意打开设置、管理页或伪造登录。

阶段三：如果两个产品需要共用身份，用经过审查的 OIDC Authorization Code + PKCE 和短时一次性授权交换。每个应用有独立客户端/redirect allowlist/audience，跨系统建立稳定subject映射；不要共享 service-role key、浏览器localStorage、用户密码，也不要仅按邮箱、昵称或任意unionid字段合并。

本轮网站↔微信关联已经保留原 user ID，但它只适用于同一微信 AppID。不同小程序/App 的 openid 不相同；unionid 也必须由微信可信返回并符合开放平台配置。已有两个带内容的账号，需要单独设计可撤销、可审计的人工/自助合并，不能直接覆盖。

## 用什么判断推广有没有用

建议优先看：新用户能否发出第一条完整商品/求购；买家是否找到相关信息并发起有效询问；卖家是否回复；多少请求因超时/发布失败而中断。不要只看曝光或注册数。

试点当天安排有人处理反馈和举报。每天检查失败率、搜索p95、消息/通知补偿与后台积压；出现越权、登录错号、持续消息缺失立即暂停扩散。现有搜索10k规模门槛没过前，不把试点结果宣传成支持大规模并发。

## 渠道与节奏建议

- 先用 CAACI 官网资源入口＋一次周报＋同意发布的社区群邀请，便于收到具体反馈。不要直接抓群成员或发送私人邀请。
- Instagram/小红书用场景主海报吸引，再用真实功能短片解释。每条聚焦一个动作；外链位置以当时账号实际功能为准。
- Reddit按目标社区规则判断能否发；说明自己是开发者，实质回答反馈，不跨版批量复制，也不通过“求反馈”绕过禁推广。
- LinkedIn准备开发过程与体验迭代版本，属于候选渠道；用户口述“零上面”的所指尚未确认。
- Discord、社团通讯和迎新资源页是可联系的补充渠道，先由负责人同意具体位置，不代发。本轮无付费投放。

来源（2026-09-16查看）：[CAACI官网](https://caaciorg.com/zh/)、[Reddit与版主协作规则](https://www.business.reddit.com/learning-hub/articles/how-to-work-with-moderators-on-reddit)、[LinkedIn视频要求与安全区域](https://www.linkedin.com/help/linkedin/answer/a7174587)。[Apple Universal Links](https://developer.apple.com/documentation/xcode/supporting-universal-links-in-your-app)、[Android App Links](https://developer.android.com/training/app-links)、[Supabase OAuth 2.1/OIDC Server](https://supabase.com/docs/guides/auth/oauth-server)。Supabase现有标准服务可作为后续身份整合的候选，但本轮未启用或配置新的OAuth客户端，正式整合前仍须验证同意页面、client_id/RLS与撤销边界。
