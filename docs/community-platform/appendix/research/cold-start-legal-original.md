# 冷启动内容的法律风险（初稿，复核前）

不是法律意见。初稿与复核稿都保留；以复核稿为准。

## 结论

结论：用脚本抓 Reddit（r/UIUC）、一亩三分地、美卡论坛、小红书、知乎的帖子，再翻译或改写成站内内容，这五个来源的条款都明文禁止，版权上也站不住，风险高。冷启动换三条路：一是人工看帖、只记下问题，然后自己写原创指南；二是"自己的话写摘要 + 一句短引 + 原帖链接 + 署名"；三是请作者授权，或者干脆请作者本人来发。这三条风险低。

关键事实（2026-11-12 查）：
1. Reddit 的 robots.txt 当天实取，对所有爬虫一律 Disallow: /。User Agreement 2026-07-01 生效，第 7 条只允许在 robots.txt 范围内有条件地爬取，并写明 "scraping the Services without Reddit's prior written consent is prohibited"。第 3 条还禁止三件事：未经书面协议商业利用内容、制作内容的衍生作品、用 Reddit 内容搭建"类似或竞争的网站"。论坛正好落在最后一项里。
2. 版权归发帖人，不归平台：Reddit UA 第 5 条、Data API Terms 2.4、知乎协议三.1 都这么写。美国法下翻译属于衍生作品（17 U.S.C. §101），改编权只属于作者。每一篇翻译帖都可能让作者直接发 DMCA 通知。
3. 官方 API 也解决不了。Data API Terms 2.4（2026-07-20 修订）只许原样复制和展示，除了排版不许修改，翻译和改写都超出许可。商业用途要另签协议。2025-11-11 起 API 自助申请已关闭，改为审批制。
4. 判例：Van Buren（2021-06-03）和 hiQ（第九巡回 2022）之后，抓公开页面的 CFAA 刑事风险变低了。合同之诉却照样能赢：hiQ 在 2022-11 被判违反 LinkedIn 用户协议，最后以同意判决加禁令收场。两份判决对"违约之诉会不会被版权法排除"给了相反答案：X v. Bright Data（2024-05）认为会被排除，Reddit v. Anthropic（2026-03 发回州法院）认为不会，这个问题法律上还没定论。Reddit 2025-10 起诉 SerpApi、Perplexity 等，据二手报道，2026-07 大部分诉请过了驳回动议。
5. DMCA 安全港只保护用户自己上传的内容。运营方自己搬来的内容不在保护范围内（§512(c)）。版主或员工审核后发布的内容，也可能被算成平台自己的发布（Mavrix v. LiveJournal，2017）。
6. 中国法方面：知乎协议三.10 明禁抓取，三.5 规定转载须经原作者单独授权，三.8 允许知乎以自己名义起诉。小红书协议 4.1、4.2 与此类似。新《反不正当竞争法》2025-10-15 施行，第 13 条第 3 款禁止以避开技术管理措施等方式获取他人数据。大众点评诉百度案中，百度因大量使用大众点评的用户点评，二审判赔 300 万元加 23 万元合理费用。
7. 用 LLM 洗稿：改写后只要保留了原文的结构和细节，中美法院都可能认定实质性相似。版权局 2025-01-29 的 AI 报告第二部分认为，没有足够人类表达的 AI 产出不受保护。结果是洗出来的稿子你们自己未必有版权，却仍可能侵犯原作者的版权。Google 的垃圾内容政策也把"抓取后同义替换或翻译再发布"列为 spam。

我的判断：对一个小论坛，最现实的后果不是被起诉，而是这几样：原作者或平台发 DMCA 通知，托管商下架；微信小程序被投诉下架；在 UIUC 华人小圈子里被认出"搬运洗稿"，新论坛和 CAACI 的信誉一起受损。

这次没核实到的地方：
- Reddit Public Content Policy 原文返回 403，相关内容只能用 TechCrunch 2024-05 的报道。
- 美卡的 /tos 页面返回 403，只通过搜索摘要确认它用的是 Discourse 模板条款。
- 小红书协议看的是第三方转载版。
- Reddit v. SerpApi 案 2026-07 的裁定只看到标题和二手摘要。
- X v. Bright Data 的上诉进展没查到。
- 论坛以后上线付费或赞助后，会不会被 Reddit 认定为 monetized 产品。我倾向于会。

## 查过的来源

- Reddit User Agreement（美国及非 EEA 版）（2026-07-01 生效，2026-05-26 修订；2026-11-12 访问）：https://redditinc.com/policies/user-agreement — §3 未经书面协议不得商业利用 Content、不得制作衍生作品、不得为搭建类似或竞争网站而访问；§5 用户保留所有权，授予 Reddit 永久、可再许可的许可（含 AI 训练）；§7 只在 robots.txt 范围内有条件许可爬取，未经事先书面同意禁止 scraping；§14 适用加州法，旧金山法院管辖
- reddit.com robots.txt（2026-11-12 实取（HTTP 200））：https://www.reddit.com/robots.txt — User-agent: * / Disallow: /；注释引用 Public Content Policy，并把研究和非商业用途指向 r/reddit4researchers
- Reddit Developer Terms（2024-09-24 生效，2026-03-26 修订；2026-11-12 访问）：https://redditinc.com/policies/developer-terms — 2.1 只许复制展示 User Content，修改仅限排版；4.1 由企业使用或用于已变现的产品须另签协议；4.2 不得制作衍生作品或再分发，不得用于训练模型；5.2 User Content 归用户，须回链、注明用户名、标明来自 Reddit
- Reddit Data API Terms（2023-06-19 生效，2026-07-20 修订；2026-11-12 访问）：https://redditinc.com/policies/data-api-terms — 2.4 只许为运行 App 复制和展示，排版以外不得修改；3.1 商业用途须另签协议；3.2 不得超出批准用途使用或留存数据，不得用 API 发垃圾信息；第 4 条要求署名
- Reddit Public Content Policy（原文 403，未能读取）及 TechCrunch 报道（报道日期 2024-05-09；原文地址 support.reddithelp.com/hc/en-us/articles/26410290525844 访问被拒）：https://techcrunch.com/2024/05/09/reddit-locks-down-its-public-data-in-new-content-policy-says-use-now-requires-a-contract — 商业用途（含 AI）须签合同；合作方须同步用户删除；不得用内容识别个人。均为二手转述，弱于原文
- Reddit Responsible Builder Policy（r/redditdev 公告的第三方镜像）（公告 2025-11-11；只看到镜像，没看到官方页）：https://r.datuan.dev/r/redditdev/comments/1oug31u/introducing_the_responsible_builder_policy_new/ — 公共数据 API 自助申请关闭，开发者、研究者、版主须申请审批
- Reddit v. Anthropic 发回州法院（Crowell 律所解读）（北加州联邦地区法院，2026-03 前后；案号 25-cv-05643；没读裁定原文）：https://www.crowell.com/en/insights/client-alerts/northern-district-of-california-court-holds-state-tort-and-contract-claims-not-preempted-by-federal-copyright-act-remands-reddit-v-anthropic-to-state-court — 违约、不当得利、侵扰动产等州法诉请不被版权法排除，案件发回加州州法院
- Reddit v. SerpApi、Oxylabs、AWMProxy、Perplexity（Law360 及 Search Engine Land）（2025-10-22 在纽约南区起诉；2026-07 驳回动议大部分被拒（只看到标题和二手摘要））：https://www.law360.com/articles/2508228/reddit-ai-data-scraping-case-mostly-survives-dismissal — 通过 Google 搜索结果间接抓取 Reddit 内容；DMCA 反规避等诉请继续审理
- Van Buren v. United States（最高法院判决书）（2021-06-03 判决）：https://www.supremecourt.gov/opinions/20pdf/19-783_k53l.pdf — 'exceeds authorized access' 限于进入本无权进入的区域，收窄了 CFAA 的适用
- hiQ Labs v. LinkedIn 结案（ZwillGen 总结）（2022-11 违约简易判决，2022-12 同意判决加永久禁令）：https://www.zwillgen.com/alternative-data/hiq-v-linkedin-wrapped-up-web-scraping-lessons-learned/ — 自动抓取和假账号违反用户协议；hiQ 须停止抓取并销毁数据和代码，据报道判决金额 50 万美元
- X Corp. v. Bright Data（Proskauer 解读，附裁定 PDF）（2024-05-09，Alsup 法官；上诉状态未核实）：https://newmedialaw.proskauer.com/2024/05/14/california-court-issues-another-noteworthy-decision-dismissing-breach-of-contract-and-tort-claims-in-web-scraping-dispute/ — 基于抓取的违约之诉与版权法冲突而被排除；侵扰动产等诉请驳回
- Meta v. Bright Data（Eric Goldman 博客客座文章）（2024-01-23，Chen 法官；2024-02 Meta 撤诉）：https://blog.ericgoldman.org/archives/2024/01/game-on-bright-data-scores-major-victory-in-web-scraping-dispute-with-meta-guest-blog-post.htm — 未登录抓取公开数据不受 Meta 条款约束；登录状态下抓取另当别论
- 17 U.S.C. §101（衍生作品定义）（现行法典，2026-11-12 访问）：https://www.law.cornell.edu/uscode/text/17/101 — 衍生作品指基于已有作品创作的作品，例举中包括翻译
- 17 U.S.C. §107（合理使用）（现行法典）：https://www.law.cornell.edu/uscode/text/17/107 — 批评、评论、新闻报道、教学、研究等目的；四要素：目的与性质、作品性质、使用的数量与实质性、对市场的影响
- 17 U.S.C. §512（DMCA 安全港）（现行法典）：https://www.law.cornell.edu/uscode/text/17/512 — (c) 只覆盖用户指令存储的内容；须不知情、收到通知后迅速移除、不从可控的侵权中直接获利、指定代理人；(i) 须有重复侵权者封号政策
- 美国版权局 DMCA 指定代理人目录（2026-11-12 访问）：https://www.copyright.gov/dmca-directory/ — 想获得安全港须在线登记代理人并在网站公开联系方式；页面没写费用和续期年限
- Mavrix Photographs v. LiveJournal（第九巡回法院）（2017-08-30 修订意见，873 F.3d 1045）：https://law.justia.com/cases/federal/appellate-courts/ca9/14-56596/14-56596-2017-08-30.html — 版主审核后发布的内容可能不算用户指令存储；版主可能被认定为平台的代理人
- 美国版权局《版权与人工智能》报告（第二部分（可版权性）2025-01-29 发布）：https://www.copyright.gov/ai/ — 讨论 AI 产出的可版权性；结论（须有足够的人类表达）来自我已有的了解，本页没有逐字核对
- Google Search 垃圾内容政策（2026-11-12 访问，页面没写更新日期）：https://developers.google.com/search/docs/essentials/spam-policies — 抓取后同义替换或翻译再发布属于 spam；用生成式 AI 批量生成没有附加价值的页面属于 scaled content abuse
- FTC 消费者评价与推荐规则（联邦公报）（16 CFR Part 465，2024-10-21 生效）：https://www.govinfo.gov/content/pkg/FR-2024-08-22/html/2024-18519.htm — 禁止企业制作或传播虚假评价，包括 AI 生成的评价；是否适用于非营利组织没有核实
- 一亩三分地 Terms of Use（页面标注 2021-08-13 更新；2026-11-12 访问）：https://www.1point3acres.com/terms_of_use.html — §14(a) 不得复制、分发、发布，只限非商业个人浏览，不得用数据挖掘或机器人工具；§19(b) 禁止爬虫和未授权的自动化手段；§12 有侵权通知流程；没有写明用户内容归属
- 美卡论坛 /tos（403，经搜索摘要确认）及 robots.txt（tos 页面返回 403；robots.txt 于 2026-11-12 实取）：https://www.uscardforum.com/tos — 中文条款与 Discourse 模板一致：搜索引擎可以抓取索引，其余禁止自动化；robots.txt 屏蔽 /search 和若干 SEO 爬虫
- Discourse 服务条款模板（Discourse 官方模板帖）：https://meta.discourse.org/t/updated-terms-of-service-template/103384 — 内容归作者；平台只获得向本站用户提供、复制、分析内容的许可；禁止自动化访问，搜索引擎例外；不得移除权属标记
- 知乎用户协议（2025-03-20 更新，2025-03-25 生效）：https://www.zhihu.com/term/zhihu-terms — 三.1 原创内容著作权归用户，用户可自行授权第三方；三.4 授予知乎永久、可再许可的许可；三.5 站外转载须联系原作者取得单独授权并注明出处；三.8 知乎可以自己名义维权；三.10 未经书面许可不得抓取；二.9 禁止自动化程序
- 小红书用户服务协议（第三方法规站转载版）（2025-12-08 更新；没看官方页）：https://www.elawcn.com/agreement/2026/0301/1751.html — 3.4 未经许可不得复制、读取、统计平台内容和数据；4.1 禁止非法抓取，禁止第三方插件；4.2 用户授予非排他许可，小红书可以自己名义取证、投诉、起诉
- 小红书站外导流规则（界面新闻等报道）（2025 年前后报道）：https://www.jiemian.com/article/12228571.html — 私信或主页留微信号、外链属于导流违规，会限流或禁言；属二手报道
- 《反不正当竞争法》（2025 年修订，国家知识产权局刊载）（2025-10-15 施行）：https://www.cnipa.gov.cn/art/2026/5/20/art_104_206437.html — 第 13 条第 3 款：不得以欺诈、胁迫、避开或破坏技术管理措施等方式获取、使用其他经营者合法持有的数据
- 《著作权法》2020 年修正要点（澎湃）及 WIPO Lex 文本（2021-06-01 施行）：https://www.thepaper.cn/newsDetail_forward_12808151 — 法定赔偿上限 500 万元，惩罚性赔偿 1 至 5 倍；第 10 条（翻译权、改编权、信息网络传播权）、第 24 条（适当引用须指明作者和作品名）、第 5 条（单纯事实消息）的条文号来自我已有的了解，原文没有逐字核对，可在 https://www.wipo.int/wipolex/zh/legislation/details/21065 核对
- 大众点评诉百度不正当竞争案（澎湃、第一财经报道）（一审 2016-05-26；二审上海知识产权法院维持）：https://www.thepaper.cn/newsDetail_forward_1474673 — 百度地图使用 86,286 条大众点评用户评论，构成实质性替代，判赔 300 万元加 23 万元合理费用
- 《错位时空》改编（洗稿）案（澎湃）（2023-03-30 报道，杭州中院，浙江高院维持）：https://www.thepaper.cn/newsDetail_forward_22508818 — 改编作品与原作构成实质性相似，侵犯信息网络传播权，判赔 5 万元。这是歌曲案而非文字洗稿，作为证据偏弱
- r/UIUC 规则（第三方镜像）（镜像，日期不明）：https://axebps-redlib.hf.space/r/UIUC/wiki/rules — 规则包括 'Sales, ads, voting' 和个人信息等条目；以 Reddit 上的现行版本为准
- UIUC Student Legal Service 服务范围（旧版宣传册）：https://odosapps.odos.illinois.edu/sls/resources/brochures/docs/SLScantHelp2.pdf — SLS 不处理版权、商标、专利问题

## 风险矩阵

| 做法 | 来源 | 风险 | 理由 |
|---|---|---|---|
| (a) 批量爬取，翻译后转发 | Reddit r/UIUC | 高 | 合同和版权两头都踩线。合同上，robots.txt 对所有爬虫全禁，条款明禁 scraping，也禁止为搭建类似网站而访问 Reddit 内容。版权上，每篇译文都是未经许可的衍生作品，原作者可以直接发 DMCA 通知。这些内容是运营方自己发布的，安全港不保护。Reddit 是眼下起诉抓取方最积极的平台。不过我判断，对小论坛更现实的后果是被下架，加上在 UIUC 圈子里的名声受损。 |
| (a) 批量爬取，翻译后转发 | 一亩三分地 | 高 | 条款只允许非商业的个人浏览，明禁爬虫。一亩三分地服务的正是同一群北美华人，搬它的内容容易被看成截流，除了版权还会招来不正当竞争的指控。很多帖子要登录或花积分才能看，登录状态下抓取受合同约束更强，Meta v. Bright Data 只豁免了未登录抓取。 |
| (a) 批量爬取，翻译后转发 | 美卡论坛 | 高 | 条款里没有任何给第三方转载的许可，抓取本身也违约。美卡主要讲信用卡和理财，跟 UIUC 新生内容重合不多，我判断搬过来收益小、风险大。 |
| (a) 批量爬取，翻译后转发 | 小红书 / 知乎 | 高 | 两家都明禁抓取，也都约定平台可以用自己的名义维权。知乎还要求站外转载必须取得作者单独授权。小红书以图片为主，搬图更容易侵权。小程序跑在腾讯体系里，被投诉下架是最现实的后果。 |
| (b) 用人工或 LLM 改写，让帖子看起来像原创 | 所有来源 | 高 | 只要保留了原文的结构、情节和细节，换了词仍然是在使用原作的表达，侵权性质不变。另外还多了一层欺骗：把别人的亲身经历包装成站内原创，放在「吃喝好店」「落脚香槟」板块里就等于假评价。LLM 改写不会降低风险，反而让 CAACI 对产出没有版权。这条一旦被认出来，对新论坛信任的打击最大。FTC 规则管不管得到非营利组织，我不确定。 |
| (c) 写摘要，附一句短引、链接和署名 | Reddit r/UIUC | 低 | 条件是：人工浏览、数量少、用自己的话概括、只引一两句、不放截图、敏感话题不写用户名。合理使用是个案抗辩，不是许可。User Agreement §3 里「为搭建类似网站而访问」那句，严格读也能套到这里，我判断按低频人工摘要的做法实际风险很小。登录 Reddit 账号时，你就受这份协议约束。 |
| (c) 写摘要，附一句短引、链接和署名 | 一亩三分地 / 美卡论坛 | 中 | 版权上的分析和 Reddit 一样。区别在于这两家是同一人群的直接竞品，更容易被看成截流。要登录或花积分才能看的内容一律不引，只用公开帖，链接回原帖。 |
| (c) 写摘要，附一句短引、链接和署名 | 知乎 / 小红书 | 中 | 中国法允许为评论或说明问题适当引用，前提是引文不能成为新内容的主体。小红书笔记以图片为主，截图和搬图不算适当引用。平台协议约束的是在平台上注册过的账号。 |
| (d) 只用帖子发现常见问题，答案和指南自己写 | 所有来源 | 低 | 这是最干净的一条路。条件：人工浏览或经搜索引擎找帖，不跑脚本，跑脚本就回到 (a) 的合同风险。只记「问题、链接、日期」，不抄原文。事实用 UIUC、ISSS、MTD、市政府等官方页面核实。不照搬别人故事里的细节。 |
| (e) 请作者授权转载或翻译 | Reddit 作者 | 低 | 授权由版权人本人给，版权问题就解决了。风险在执行环节：授权要留书面凭证，私信截图或邮件都行；范围要写清，包括翻译、删改、署名、能否撤回；要确认对方确实是作者。群发私信会触发 Reddit 的反垃圾规则，只能一对一少量发。 |
| (e) 请作者授权转载或翻译 | 一亩三分地 / 美卡 / 知乎 / 小红书作者 | 低 | 作者有权授权。小红书私信里不要放微信号或站外链接，那会被算成导流违规。对方同意后，请对方告诉你方便的联系方式，再在站外完成后续。 |
| (f) 在条款范围内用 Reddit 官方 API | Reddit | 中 | 合法，但达不到你们的目的。许可只到原样复制和展示，排版以外不许修改，翻译和改写都在许可之外。要先申请审批；商业用途要另签协议；要回链、署名、同步作者的删帖。论坛以后上线付费或赞助，我判断基本会被认定为 monetized。这条只适合原样嵌入英文原帖的场景。 |
| (g) 邀请原帖作者或 r/UIUC 常客自己来发 | Reddit r/UIUC | 低 | 作者自己发，版权和署名问题自然就没有了。风险在推广方式上：发介绍帖前先问 mod；私信一对一、数量少、内容个性化，不群发。 |
| (g) 邀请原帖作者或常客自己来发 | CAACI 校友和董事网络、华人平台作者 | 低 | 最适合「学长学姐说」板块。我判断熟人网络的转化率比找陌生人高。在小红书上邀请时，私信里不要直接放链接或微信号。 |
| 上述任何做法中保留用户名或个人经历细节 | Reddit / 小红书 / 一亩三分地 | 中 | r/UIUC 发帖人多是同校学生。把帖子翻成中文搬进华人小圈子，被认出来的可能性会变大，签证、心理、室友冲突、房东纠纷这类话题尤其如此。作者在原平台删了帖，你这里的副本还在。所以这类话题去掉用户名，只保留与主题有关的信息。 |

## 建议方案

一、上线前先搭好法律底座（1 周内）
1. 写社区条款。要点：作者保留版权；授予本站非独占的展示许可，作者删帖即终止；禁止发布他人作品；转载必须注明来源并已取得授权。
2. 做一个版权投诉页，并在 copyright.gov/dmca-directory 在线登记 DMCA 指定代理人。据我所知收费 6 美元、三年续期，这次没在官网页面上核对到，登记当天以官网为准。同时写一条重复侵权者封号政策（§512(i)）。没有这两项，用户上传内容的安全港就不成立。
3. 设一个撤稿和投诉邮箱，目标是 48 小时内处理完。
4. 编辑账号一律实名，用「CAACI 编辑部·某某」这样的署名。不建马甲号，不伪造用户，不刷评论。这和 docs/community-platform/research/PLATFORM_RESEARCH.md 第 18 行「不以模拟人数、伪造评论表现热闹」是一致的。

二、哪些事永远不做
- 不对 Reddit、一亩三分地、美卡、小红书、知乎跑任何脚本、无头浏览器、代理池或登录态抓取。哪怕「只是为了找问题」也不行。
- 不把整帖机翻后转发。不把别人的帖子交给 LLM 改写，再当站内原创发布。
- 不截图、不搬小红书的图片，不碰一亩三分地要积分或登录才能看的内容。
- 签证、心理、室友冲突、房东纠纷这类敏感经历，不带用户名，也不带能认出人的细节。
- 「吃喝好店」「落脚香槟」板块不发编造或改写来的「亲身体验」评价。
- 不群发私信拉人。

三、冷启动流程（4 周，按 3 名志愿者估）
第 1 周：建问题库。每人人工浏览 r/UIUC 近一年的热帖、一亩三分地的公开 UIUC 相关帖、小红书和知乎上搜「UIUC」「香槟」的结果。表格只记五项：问题（用自己的话写一句）、对应板块、原帖链接、日期、是否敏感。目标 60–80 个问题，聚成 20 个左右的主题。
第 2 周：写原创指南，每个主题一篇。
- 「落脚香槟」：租房签约、水电网、SSN、银行、驾照、MTD 公交。
- 「校园日常」：选课、CRCE、打印。
- 「吃喝好店」：只发编辑亲自去过的店，标注「编辑亲测」。
- 「学长学姐说」：用问答格式。
事实一律引官方页面，并注明「最后核实日期」。LLM 只用来排版、润色你们自己写的稿子，不要把别人的帖子贴进去。
第 2–3 周：请真人来发。从 CAACI 校友、董事、学长学姐里找 10–20 人，每人认领 1–2 个问题，用自己的经历回答。在 r/UIUC 或华人平台上遇到写得特别好的帖子，一对一请作者授权，或请作者本人来发（模板见下）。私信每周不超过 10 条，这个数是我为避开反垃圾机制定的，没有官方依据。
第 3 周起：每周一篇「本周外站热议」，选 3–5 个讨论串。每串用自己的话写不超过 150 字的概括，最多引一句原文，附链接和署名，不放截图。
长期：维护一张授权记录表（作者、平台、授权凭证截图、授权范围、日期）。撤稿请求 48 小时内处理。每季度复查一次 Reddit、知乎、小红书的条款，Reddit 2026 年已经改过两次。

四、模板（{论坛名} 等名字定了再填）
A. 摘要署名行（中文）：
「本文是 {论坛名} 编辑根据 r/UIUC 讨论串《{原帖标题}》（发帖人 u/{用户名}，{YYYY-MM-DD}）写的中文摘要和评论，不是原文翻译。原文：{链接}。原文版权归原作者。作者如果希望修改或撤下，请写信到 {邮箱}，我们会在 48 小时内处理。」
敏感话题把「发帖人 u/{用户名}」换成「r/UIUC 网友」。
A'. 英文：
"Summary and commentary by {Forum} editors, based on the r/UIUC thread \"{title}\" by u/{username} ({date}). This is not a translation. Original: {URL}. All rights in the original belong to its author. To request edits or removal, email {email}; we respond within 48 hours."

B. 已获授权的转载署名行：
「经原作者 {作者名} 于 {日期} 书面授权{翻译/转载}，原文首发于 {平台}：{链接}。版权归原作者，转载请联系原作者。」

C. 授权请求（英文，用于 Reddit 私信）：
"Hi u/{username}, I volunteer with a free community forum for Chinese students and alumni at UIUC, supported by CAACI, a local nonprofit. Your post \"{title}\" ({link}) explains {topic} better than anything we have. Would you be OK with us translating it into Chinese and posting it on our forum, with your username and a link back to your original? We would only change what translation needs, and we would not use it in ads or paid content. You can ask us to take it down at any time at {email}. If you would rather post it yourself, we can set up an account for you. No worries at all if not. Thanks!"

D. 授权请求（中文，用于一亩三分地、知乎、小红书站内私信）：
「你好，我是 UIUC 华人学生和校友论坛 {论坛名} 的志愿者，论坛由本地非营利组织 CAACI 支持。你写的《{标题}》把 {话题} 讲得特别清楚。想问问你：我们能不能在论坛上{全文/节选}转载这篇，署上你的名字，附原文链接，不用于广告或收费内容？你可以随时让我们撤下。如果你更愿意自己来发，我们给你开账号。不方便的话也完全没关系，谢谢！」
在小红书上用时，这条私信里不放链接和微信号。对方同意后，请对方告诉你方便的联系方式，后续在站外完成。

E. 邀请对方自己来发（中英文各一句，可接在 C、D 后面）：
「你这篇对新生特别有用。愿意的话，来 {论坛名} 的「{板块}」发一份，我们会把它置顶到对应的新生指南里。」
"Would you be up for posting it yourself in our \"{board}\" section? We'd pin it in the newcomer guide."

五、需要请律师的情况
1. 想做任何规模的转载或翻译，哪怕只拿到了部分授权；或者想和 Reddit 谈数据协议。
2. 定稿社区条款、隐私政策、DMCA 政策时。还要确认运营主体是 CAACI 还是个人，这决定了出事时由谁承担责任。
3. 收到律师函、DMCA 通知或平台投诉时。
4. 小程序在中国境内分发，要过一遍内容合规（国内平台规则加中国法）。
5. 想靠合理使用做超出「一句短引」的事。
UIUC Student Legal Service 的资料写明它不处理版权和商标问题。可以去问芝加哥的 Lawyers for the Creative Arts，或伊利诺伊州律师协会的律师转介服务，两家的受理资格都没有核实。

## 说明

这份是基于公开资料的研究整理，不是法律意见，也不构成律师和当事人关系。平台条款随时会改，Reddit 的 Developer Terms 和 Data API Terms 2026 年就分别修订过一次。判例里「违约之诉会不会被版权法排除」这个问题还没定论，几个关键诉讼也还在进行。还有几份材料只拿到了二手或转载版本：Reddit Public Content Policy、美卡 tos、小红书协议、Reddit v. SerpApi 的裁定。批量转载、和平台签数据协议、确定运营主体和条款文本、收到投诉这几种情况，请先找执业律师。