# 冷启动内容的法律风险（复核后版本，2026-11-12）

不是法律意见。初稿与复核稿都保留；以复核稿为准。

## 结论

复核结论：原研究的主判断成立。用脚本抓 r/UIUC、一亩三分地、美卡、知乎、小红书，再翻译或改写成站内内容，风险高；人工找问题后自己写、请作者授权、请作者本人来发，风险低。没有哪一档需要整体翻转。要改的是 6 处事实。风险矩阵新增 3 行，1 行改法律依据。另有 5 处遗漏要补。

要改的事实（2026-11-12 逐一重开来源）：
1. Reddit Developer Terms 页面写的是 Last Revised March 24, 2026，原研究写成 03-26。Reddit 2026 年改过的是三份文件，不是两份：Developer Terms（03-24）、User Agreement（05-26 修订，07-01 生效）、Data API Terms（07-20）。
2. 原研究说两份判决给了「相反答案」，这个说法要改。X v. Bright Data 在 2024-11-26 准许 X 修改起诉状：基于访问方式和服务器损害的违约、侵扰动产诉请放行，只有基于抓取复制的违约诉请仍被版权法排除。Reddit v. Anthropic 的发回裁定（北加州联邦地区法院，2026-03-30，案号 3:25-cv-05643-TLT，裁定首页已看到）放行了违约等五项州法诉请，理由同样是协议限制的是访问方式和技术设施。Reddit v. SerpApi（纽约南区，2026-07-31）把纽约州不当得利、不正当竞争诉请按版权法排除，保留 DMCA §1201(a) 反规避诉请和民事共谋诉请。三份裁定的分界其实一致：针对「你怎么进来」的诉请能成立，只针对「你拿了内容」的诉请容易被排除。落到你们身上：跑脚本正好落进能成立的那一类；人工看帖再自己写，合同风险小很多，作者的版权却一点没少。
3. Reddit UA §7 原文是 “Access, search, or collect data from the Services by any means (automated or otherwise)”。「人工浏览不算 scraping」这句成立。但登录账号的人系统性地手工收集数据，字面上也落在 §7 里。§3 禁止「为搭建类似或竞争网站而访问」，这一条能不能套到一个中文 UIUC 华人论坛上有争议，原研究说「正好落在」是说过头了。
4. Data API Terms 开头写明：从 Reddit 拿到的任何 Materials，“whether using the Data APIs or not”，都只能按该条款使用。Reddit 主张的约束范围比原研究写的宽。没用 API 的人受不受这句约束，是另一个问题。
5. DMCA 指定代理人的费用这次在版权局 FAQ 上核实了：每次登记 6 美元，三年后失效，续期等于重新提交，再付 6 美元。
6. 知乎协议的日期和原研究引的条号（三.1、三.4、三.5、三.8、三.10）都对，但漏了两处。三.2 规定「问题及补充说明、答案总结、话题描述」的知识产权归知乎，所以连问题原文也别照抄。三.5 要求转载时在正文开头显著位置注明作者名、原始链接，并写明「发表于知乎」，授权转载的署名模板要补上这一项。

风险矩阵改动：
- 新增「每周固定的外站热议栏目」一行，定为中。偶尔写一篇摘要仍是低。按周系统汇编同一个竞品站的讨论，就接近大众点评诉百度里的「实质性替代」。那个案子并不要求每条点评都构成作品，单条再短，成规模搬竞品的用户内容也可能算不正当竞争。
- 新增「绕道抓取」一行，定为高。经 Google 搜索结果、SERP API、redlib 一类镜像站或代理池批量拿 Reddit 内容，正是 Reddit v. SerpApi 里被诉的做法。原研究自己就引了两个 Reddit 镜像站作资料来源。读一页没问题，但不能把它们做成数据管道。
- 新增「编辑先审后发或精选用户投稿」一行，定为中，依据是 Mavrix 案。
- 「保留用户名或个人经历」维持中，但法律依据要改弱。伊利诺伊州的「公开私人事实」侵权要求事实本身是私密的，公开帖子很难满足这一条。这一行的实际风险在伦理和信誉，不在诉讼。

遗漏：
1. 47 U.S.C. §230(e)(2) 把知识产权排除在外。用户发的侵权内容，只能靠 DMCA 安全港兜底。
2. 微信小程序的 UGC 必须过内容安全审核，而 Mavrix 案认定，先审后发可能让平台失去安全港。审核规则要写成「违法和垃圾内容筛查」，不能写成「编辑精选」。
3. 小程序面向中国大陆用户，中国这边的通知删除规则是民法典第 1195 到 1197 条。收到通知要转送给发帖人并及时处理，否则对扩大的损害承担连带责任。
4. 小程序从二手交易改成论坛，至少牵涉四件事：服务类目资质、名称里能不能出现「论坛」二字、UGC 接口、个人主体能不能开 UGC。这次没查到官方答案。我判断这些比冷启动内容更可能先卡住上线，改名前先去公众平台后台看「服务类目」的资质说明。
5. Reddit 自己在做机器翻译：2024-05 从法语开始，2024-09 扩到 35 个以上国家，2025-04 加了印地语，中文支不支持没查到。UA §5 也授权 Reddit 修改和改编用户内容。翻译的市场已经有人在占，合理使用第四要素（对原作市场的影响）对「翻译转发」更不利。

补充 FTC：消费者评价规则 2024-10-21 生效，2025-12-22 发出首批 10 封警告信。据律所报道，每次违规的民事罚款上限是 53,088 美元。FTC Act 只管「为自身或成员牟利」的组织，Community Blood Bank v. FTC（第八巡回，1969）据此否定了 FTC 对真正非营利机构的管辖。所以这条规则够不够得着，取决于运营主体是 CAACI 还是 Eric 个人。

这次仍未核实：
- Reddit Public Content Policy 原文，还是 403。
- Responsible Builder Policy 的官方页，还是只有镜像和第三方博客。
- 美卡 /tos 全文，还是 403，只有搜索摘要。
- 小红书官方协议页，还是只能看转载站。
- SerpApi 裁定原文，以及 Oxylabs、AWMProxy 两名被告的结果。
- X v. Bright Data 有没有上诉。
- 著作权法第 24、54 条和《信息网络传播权保护条例》第 22 条的原文。
- 微信小程序论坛类目的资质要求。

## 查过的来源

- Reddit User Agreement（美国及非 EEA 版）（页面写 Effective July 1, 2026, Last Revised May 26, 2026；2026-11-12 实取（HTTP 200），对照原文核对）：https://redditinc.com/policies/user-agreement — §3：未经书面协议不得 commercially exploit、不得 modify or prepare derivative works of Content、不得 access Content in order to build a similar or competitive website。§5：用户保留所有权，授予 Reddit 永久、可再许可的许可，范围含 modify、adapt、prepare derivative works 和 AI 训练。§7：不得 “Access, search, or collect data ... by any means (automated or otherwise)”，只在 robots.txt 范围内有条件许可爬取，未经事先书面同意禁止 scraping。§14：适用加州法，旧金山法院管辖。原研究的引述准确，但漏了 §7 里的 “or otherwise”，「论坛正好落在 §3」也说过头
- reddit.com robots.txt（2026-11-12 实取（HTTP 200））：https://www.reddit.com/robots.txt — User-agent: * / Disallow: /；注释指向 Public Content Policy 和 r/reddit4researchers。与原研究一致
- Reddit Developer Terms（页面写 Effective September 24, 2024, Last Revised March 24, 2026（原研究写 03-26，有误）；2026-11-12 实取）：https://redditinc.com/policies/developer-terms — 2.1：只许复制、展示 User Content，修改仅限排版。4.1：由企业使用、或用于已变现的产品，须另签协议。4.2 禁止的衍生作品指 Reddit Services and Data 的 features or functionality，不是 User Content。5.2：User Content 归用户，用于训练须经权利人许可，须回链、注明用户名、标明来自 Reddit。另有条款：User Content 被删除或修改后，App 须同步删除或修改
- Reddit Data API Terms（页面写 Effective June 19, 2023, Last Revised July 20, 2026；2026-11-12 实取）：https://redditinc.com/policies/data-api-terms — 开头：从 Reddit 取得的任何 Materials，“whether using the Data APIs or not”，都只能按该条款使用。2.4：User Content 归用户；只许为运行 App 复制和展示，“You may not modify the User Content except to format it”。3.1：商业用途须另签协议。3.2：不得超出批准用途使用或留存数据，不得用 API 发垃圾信息、骚扰用户。4.2：署名按开发者文档。6：终止后须删除缓存内容和衍生数据
- Reddit Public Content Policy（原文）及 TechCrunch、Axios 报道（原文 support.reddithelp.com/hc/en-us/articles/26410290525844 于 2026-11-12 仍返回 403；报道日期 2024-05-09）：https://techcrunch.com/2024/05/09/reddit-locks-down-its-public-data-in-new-content-policy-says-use-now-requires-a-contract — 商业用途须签合同；合作方须尊重用户的删除；不得用内容识别个人；r/reddit4researchers 面向非商业用途。都是二手材料，2024 年以后有没有改过未知
- Reddit Responsible Builder Policy（r/redditdev 公告的镜像，另有两篇第三方博客）（公告 2025-11-11；官方页仍没找到；另见 molehill.pages.dev、postpone.app 的博客）：https://r.datuan.dev/r/redditdev/comments/1oug31u/introducing_the_responsible_builder_policy_new/ — 公共数据 API 自助申请关闭，改为审批，申请时要交用途说明；2025-11 以前的凭证据博客说照常可用；管理员称目标是 7 天内答复。这些都来自镜像或第三方转述
- Reddit v. Anthropic 发回州法院的裁定（CourtListener 存档 PDF，已看首页）及 Loeb 律所解读（北加州联邦地区法院，案号 3:25-cv-05643-TLT，2026-03-30 提交；州法院案号 CGC-25-625892；Loeb 解读 https://www.loeb.com/en/insights/publications/2026/04/reddit-inc-v-anthropic-pbc）：https://storage.courtlistener.com/recap/gov.uscourts.cand.452341/gov.uscourts.cand.452341.60.0.pdf — 发回州法院；违约、不当得利、侵扰动产、侵权干扰合同、加州 §17200 五项州法诉请都不被版权法排除。理由是每项都有额外要件：协议限制访问方式，被告规避技术措施，被告公开宣称遵守 robots.txt
- Reddit v. SerpApi LLC（Loeb 律所解读）（纽约南区，2026-07-31 裁定，解读 2026-08 发布；据其他报道主审法官是 Engelmayer；没读裁定原文）：https://www.loeb.com/en/insights/publications/2026/08/reddit-v-serpapi-llc — 对 SerpApi 和 Perplexity 的 §1201(a)(1)(A) 规避诉请、对 SerpApi 的 §1201(a)(2) 贩运诉请继续审理；§1201(b) 驳回，理由是 SearchGuard 属于访问控制措施；纽约州不当得利、不正当竞争诉请因版权法优先被驳回；民事共谋诉请保留。Oxylabs、AWMProxy 两名被告的结果没查到
- X Corp. v. Bright Data 后续（Eric Goldman 博客客座文章）（2025-01-13 发布）：https://blog.ericgoldman.org/archives/2025/01/catching-up-on-the-heavyweight-scraping-battle-between-x-and-bright-data-guest-blog-post.htm — 2024-11-26 法院准许修改起诉状：基于访问和服务器损害的违约、侵扰动产、侵权干扰诉请放行，基于抓取的违约诉请仍被版权法排除。2024-12-17 Bright Data 提出反垄断反诉。没查到上诉
- hiQ Labs v. LinkedIn 结案（ZwillGen 总结）（2022-11 简易判决，2022-12 同意判决；2026-11-12 重读）：https://www.zwillgen.com/alternative-data/hiq-v-linkedin-wrapped-up-web-scraping-lessons-learned/ — hiQ 开公司账号时明示接受了用户协议，自动抓取加雇人建假账号构成违约。同意判决含永久禁令，要求销毁数据和代码，赔偿 50 万美元。这些是双方约定，不构成先例
- Meta v. Bright Data（Eric Goldman 博客客座文章）（2024-01-23 裁定，2024-02 Meta 撤诉；这次没重开）：https://blog.ericgoldman.org/archives/2024/01/game-on-bright-data-scores-major-victory-in-web-scraping-dispute-with-meta-guest-blog-post.htm — 未登录抓取公开数据，不受 Meta 条款约束；登录状态另当别论
- Van Buren v. United States；Mavrix Photographs v. LiveJournal（Van Buren 2021-06-03；Mavrix 873 F.3d 1045（第九巡回，2017-08-30 修订意见）；这次都没重开，日期与已知一致）：https://law.justia.com/cases/federal/appellate-courts/ca9/14-56596/14-56596-2017-08-30.html — Van Buren 收窄了 CFAA 的适用。Mavrix：版主按实质标准审核后才发布的内容，可能不算「按用户指令存储」，版主可能被认定为平台的代理人
- 17 U.S.C. §101、§103(a)、§107、§512；47 U.S.C. §230(e)(2)（现行法典；§103(a) 和 §230(e)(2) 是这次补的，依据已有了解，没有逐字核对）：https://www.law.cornell.edu/uscode/text/17/512 — 翻译属于衍生作品。§103(a)：衍生作品中非法使用原作的部分本身不受保护。§512(c) 只覆盖用户指令存储的内容，(i) 要求有重复侵权者政策。§230(e)(2) 不适用于知识产权，用户上传的侵权内容只能靠 DMCA 安全港
- 美国版权局 DMCA 指定代理人目录 FAQ（2026-11-12 访问）：https://www.copyright.gov/dmca-directory/faq.html — 每次登记、修改或重新提交收费 6 美元；登记三年后失效；续期没有单独费用，等于重新提交再付 6 美元。原研究标注「没核对到」的这一项现已核实
- 美国版权局《版权与人工智能》第二部分（IPWatchdog、Copyright Alliance 的转述）（报告 2025-01-29 发布；没读报告原文）：https://copyrightalliance.org/ai-report-part-2-copyrightability/ — 纯 AI 产出不受保护；单靠提示词不足以构成作者身份；人类对 AI 产出做了创造性的选择和编排，可以作为汇编受保护；个案判断
- Google Search 垃圾内容政策（2026-11-12 访问，页面没写更新日期）：https://developers.google.com/search/docs/essentials/spam-policies — scaled content abuse 的例子里明写 “automated transformations like synonymizing, translating, or other obfuscation techniques”；scraping 条目定义为搬运其他网站的内容。原研究的结论对，出处应是 scaled content abuse 条目
- FTC 消费者评价规则执法动态（Venable、Benesch 律所文章）（规则 2024-10-21 生效；首批警告信 2025-12-22；eCFR 原文页这次被重定向，没打开）：https://www.venable.com/insights/publications/2025/12/ftc-signals-heightened-enforcement-of-new — 首批向 10 家公司发警告信；AI 生成的评价明确在规则范围内；据律所报道每次违规罚款上限 53,088 美元
- Community Blood Bank of Kansas City Area v. FTC, 405 F.2d 1011（第八巡回，1969；只看了搜索摘要）：https://m.openjurist.org/405/f2d/1011 — FTC Act §4 的 corporation 限于为自身或成员牟利的组织；法院否定了 FTC 对真正非营利机构的管辖主张
- 一亩三分地 Terms of Use（页面写 Last updated August 13, 2021；2026-11-12 用 WebFetch 读到（curl 返回 403））：https://www.1point3acres.com/terms_of_use.html — §5：许可只限个人使用。§14(a)：不得复制、发布、录入数据库，只能为非商业个人用途浏览，禁止数据挖掘和机器人。§19(b)：禁止爬虫、浏览器插件和其他未授权的自动化手段。§11(a)：站方不预审帖子。§11(d)：用户不得删除自己的帖子。§12：侵权通知发给客服，没写明 DMCA 代理人。条款没写用户内容归属
- 美卡论坛 /tos 及 robots.txt（/tos 于 2026-11-12 仍返回 403，只看到搜索摘要；robots.txt 当天实取）：https://www.uscardforum.com/tos — 摘要显示：禁止用爬虫、浏览器插件等非浏览器程序自动访问或监控论坛，搜索引擎例外；禁止用 iframe 在其他网站展示论坛内容。robots.txt 整站屏蔽 mauibot、semrushbot、ahrefsbot、blexbot、seo spider，对所有爬虫屏蔽 /search、/my、/g 和 RSS
- Discourse 服务条款模板（2026-11-12 返回 403，这次没能复核）：https://meta.discourse.org/t/updated-terms-of-service-template/103384 — 原研究的描述（内容归作者，平台只能向本站用户提供）这次没能核实
- 知乎用户协议（更新 2025-03-20，生效 2025-03-25；2026-11-12 实取，按页面列表顺序核对了条号）：https://www.zhihu.com/term/zhihu-terms — 三.1：原创内容著作权归用户，用户可自行授权第三方。三.2（原研究漏了）：问题及补充说明、答案总结、话题描述的知识产权归知乎。三.4：用户授予知乎永久、可再许可的许可。三.5：站外转载须取得原作者单独授权，在正文开头显著位置注明作者名、原始链接，并写明「发表于知乎」。三.8：知乎可以自己的名义维权。三.10：未经书面许可不得抓取、复制、镜像。第二章开头：通过 RSS、站外 API 间接使用，也视为接受本协议
- 小红书用户服务协议（第三方法规站转载版）（2025-12-08 更新；官方页仍没找到）：https://www.elawcn.com/agreement/2026/0301/1751.html — 3.4：未经书面许可，不得复制、读取、采用、统计平台内容和数据。4.1(2)：禁止盗链、非法抓取。4.1(3)：禁止第三方插件。4.2：非排他许可，可再许可第三方，小红书可以自己的名义取证、投诉、起诉。2025-12-08 以后用非大陆手机号注册的用户适用 rednote 条款
- 《反不正当竞争法》2025 年修订（国家知识产权局转载）（页面 2026-05-20 发布，是转载；法律 2025-06-27 通过，第 41 条规定 2025-10-15 施行）：https://www.cnipa.gov.cn/art/2026/5/20/art_104_206437.html — 第 13 条第 3 款：不得以欺诈、胁迫、避开或破坏技术管理措施等不正当方式，获取、使用其他经营者合法持有的数据，前提是损害他人权益并扰乱竞争秩序。适用对象是经营者，人工浏览不触发
- 《著作权法》2020 年修正（WIPO Lex）（2021-06-01 施行；这次没能逐字核对原文）：https://www.wipo.int/wipolex/zh/legislation/details/21065 — 第 24 条开头的三步检验（不得影响作品正常使用，不得不合理损害著作权人合法权益）和第（二）项适当引用；第 54 条法定赔偿上限 500 万元、惩罚性赔偿 1 至 5 倍。依据已有了解
- 民法典第 1195、1197 条（澎湃、中伦律所解读）（2021-01-01 施行；二手解读）：https://www.zhonglun.com/research/articles/8165.html — 权利人通知后，平台须转送用户并及时采取删除、屏蔽、断开链接等必要措施，否则对扩大的损害承担连带责任；平台知道或应当知道而不处理的，承担连带责任。《信息网络传播权保护条例》第 22 条这次没查到原文
- 大众点评诉百度不正当竞争案（第一财经、澎湃）（一审 2016-05-26 浦东法院；二审 2017-08-30 上海知产法院驳回上诉，维持原判）：https://www.yicai.com/news/5340378.html — 涉及 1,055 个商户、86,286 条点评，其中 784 家商户超过 75% 的点评来自大众点评，多为全文展示且位置靠前，构成实质性替代。判赔 300 万元加 23 万元合理费用。这是不正当竞争案，不是著作权案
- 《错位时空》改编案（澎湃）（2023-03-30 报道；这次没重开）：https://www.thepaper.cn/newsDetail_forward_22508818 — 歌曲案，作为文字洗稿的证据偏弱。建议换成琼瑶诉于正（《梅花烙》与《宫锁连城》，北京高院 2015 年二审）作为情节结构实质性相似的先例，这个案子这次没核实
- Reddit 机器翻译扩张（MultiLingual、PPC Land 报道）（2024-05 从法语开始，2024-09 扩到 35 个以上国家，2025-04 加印地语）：https://multilingual.com/reddit-expands-machine-translation-to-over-35-new-countries/ — Reddit 自己在做站内翻译；中文支不支持没查到
- r/UIUC 规则（第三方镜像）（镜像，日期不明；Reddit 原站这次没读）：https://axebps-redlib.hf.space/r/UIUC/wiki/rules — 有 Sales, ads, voting 条目，禁止发布个人信息，禁止用临时账号。推广前以 Reddit 上的现行规则和 modmail 答复为准
- 微信小程序论坛类目和 UGC 资质（搜索结果）（2026-11-12 搜索，没找到官方答案）：https://www.ifanr.com/minapp/900763 — 「社交」类目下有社区/论坛子类目；有 UGC 的小程序须接入内容安全审核（分析文章说法）；个人主体能不能开 UGC、论坛类目要什么资质，都没查到官方原文

## 风险矩阵

| 做法 | 来源 | 风险 | 理由 |
|---|---|---|---|
| (a) 批量爬取，翻译后转发 | Reddit r/UIUC | 高 | 合同和版权两边都踩线。脚本访问正是 2024-11 X v. Bright Data 和 2026-03 Reddit v. Anthropic 两份裁定都放行的「访问方式」类违约诉请，不容易被版权法排除。每篇译文都是未经许可的衍生作品，运营方自己发布的内容也不受安全港保护。我判断对小论坛最现实的后果是被下架，加上在 UIUC 圈子里丢名声，而不是被起诉。 |
| (a') 绕道抓取：经 Google 搜索结果、SERP API、redlib 一类镜像站或代理池批量获取 | Reddit（也适用于其他来源） | 高 | 这正是 Reddit 眼下在起诉的做法，算不上漏洞。镜像站本身也违反 Reddit 条款。读一页镜像看看结构没问题，不能做成数据管道。 |
| (a) 批量爬取，翻译后转发 | 一亩三分地 | 高 | 条款只允许非商业的个人浏览，明禁爬虫和数据挖掘。一亩三分地服务的是同一群北美华人，搬它的内容就是截流，除了版权还可能被告不正当竞争。要登录或花积分才能看的帖子，抓取时受合同约束更强。 |
| (a) 批量爬取，翻译后转发 | 美卡论坛 | 高 | 条款没有给第三方任何转载许可，抓取本身就违约，用 iframe 外嵌也被明文禁止。我判断美卡和 UIUC 新生关心的内容重合不多，搬过来收益小、风险大。 |
| (a) 批量爬取，翻译后转发 | 小红书 / 知乎 | 高 | 两家都明禁抓取，都约定平台可以用自己的名义维权。知乎连问题原文的知识产权都归平台。小红书以图片为主，搬图更容易侵权。小程序跑在腾讯体系里，最现实的后果是被投诉下架。 |
| (b) 用人工或 LLM 改写，让帖子看起来像原创 | 所有来源 | 高 | 保留了原文的结构和细节，换了词也还是在用原作的表达。洗出来的稿子你们自己也没有版权，理由有两层：纯 AI 产出不受保护，非法使用原作的部分本身也不受保护（§103(a)）。放进「吃喝好店」「落脚香槟」就成了假评价，一旦被认出来，对新论坛的信任打击最大。FTC 管不管得到，要看运营主体：如果是 CAACI 这类真正的非营利机构，按 Community Blood Bank v. FTC（1969）大概率管不到；如果是 Eric 个人或营利实体，就管得到，据报道每次违规罚款上限 53,088 美元。 |
| (c) 偶尔人工写摘要，附一句短引、链接和署名 | Reddit r/UIUC | 低 | 条件：人工浏览，最好在未登录状态下；数量少；用自己的话概括；最多引一句；不放截图；敏感话题不写用户名。登录账号的志愿者，字面上受 §7「collect data by any means (automated or otherwise)」约束，所以频率要低。合理使用是个案里的抗辩，不是许可。 |
| (c') 每周固定的「外站热议」栏目，系统汇编外站讨论 | 所有来源，尤其是一亩三分地 | 中 | 偶尔一篇是评论，按周固定出就成了汇编。在中国法下，即使单条内容短到不构成作品，成规模搬竞品的用户内容也可能算不正当竞争。Reddit 自己在做翻译，翻译市场有人在占，第四要素对你们不利。建议改成不定期发，以链接导读为主，不把一亩三分地当固定来源。 |
| (c) 写摘要，附一句短引、链接和署名 | 一亩三分地 / 美卡论坛 | 中 | 版权分析和 Reddit 一样。区别在于两家是同一人群的直接竞品，更容易被看成截流。要登录或花积分才能看的内容一律不引，只用公开帖，并链接回原帖。 |
| (c) 写摘要，附一句短引、链接和署名 | 知乎 / 小红书 | 中 | 中国法允许为评论或说明问题适当引用，但引文不能成为新内容的主体，也不能影响原作的正常使用。知乎的问题原文归平台，别照抄。小红书 3.4 连「读取、统计」都写进去了，约束的是注册账号。截图和搬图不算适当引用。 |
| (d) 只用帖子发现常见问题，答案和指南自己写 | 所有来源 | 低 | 这是最干净的一条路。条件：人工浏览，或从搜索引擎点进原帖，不跑任何脚本。问题用自己的话写，连知乎的问题原文也不抄。事实用 UIUC、ISSS、MTD、市政府等官方页面核实。不照搬别人故事里的细节。 |
| (e) 请作者授权转载或翻译 | Reddit 作者 | 低 | 版权人本人授权，版权问题就解决了。风险在执行：要留书面凭证；范围要写清，包括翻译、展示平台（含小程序和中国大陆）、期限、能否撤回、署名方式；要确认对方确实是作者；只能一对一少量发私信。 |
| (e) 请作者授权转载或翻译 | 一亩三分地 / 美卡 / 知乎 / 小红书作者 | 低 | 作者有权授权。知乎内容转载时，要按三.5 在开头注明作者名、原始链接和「发表于知乎」。在小红书私信里不放微信号或外链，那会被算成导流违规。 |
| (f) 在条款范围内用 Reddit 官方 API | Reddit | 中 | 合法，但达不到你们的目的。许可只到原样复制和展示，排版以外不许改，翻译在许可之外。现在要先申请审批；企业使用或已变现的产品要另签协议；作者删帖要同步删除。只适合原样嵌入英文原帖的场景。 |
| (g) 邀请原帖作者或 r/UIUC 常客自己来发 | Reddit r/UIUC | 低 | 作者自己发，版权和署名问题就没有了。风险在推广方式上：发介绍帖前先问 mod，私信一对一、内容个性化，不群发。不要替别人开账号，可以帮对方注册。 |
| (g) 邀请原帖作者或常客自己来发 | CAACI 校友和董事网络、华人平台作者 | 低 | 最适合「学长学姐说」板块。我判断熟人网络比陌生人转化率高。在小红书上邀请时，私信里不直接放链接或微信号。 |
| 上线后由编辑先审后发或精选用户投稿 | 本站用户内容 | 中 | 230 条款不管知识产权，用户发的侵权内容只能靠 DMCA 安全港。如果编辑按实质标准挑选后才发布，内容可能不再算「按用户指令存储」，安全港就可能丢。可小程序的 UGC 又必须过内容安全审核。解决办法是审核规则只写违法和垃圾内容筛查，不写编辑精选，并留存规则和记录。 |
| 上述任何做法中保留用户名或个人经历细节 | Reddit / 小红书 / 一亩三分地 | 中 | 公开帖子很难满足「私人事实」这个要件，诉讼风险低。实际风险在伦理和信誉：r/UIUC 发帖人多是同校学生，翻成中文搬进华人小圈子更容易被认出来，签证、心理、室友冲突、房东纠纷这类话题尤其如此。作者在原平台删了帖，你们这里的副本还在。所以敏感话题去掉用户名和能认出人的细节。 |

## 建议方案

一、改名和上线前，先定三件事
1. 运营主体：是 CAACI，还是 Eric 个人。这件事决定 FTC 规则管不管得到，决定 DMCA 代理人用谁的名义登记，决定授权由谁签，也决定出事后由谁担责。
2. 微信小程序的类目和名称：从二手交易改成论坛，可能需要换「社区/论坛」类目，名称里出现「论坛」也可能要相应资质，UGC 还要接内容安全审核。这次没查到官方答案。改名前先在公众平台后台「设置 - 服务类目」看资质说明。
3. 与主席确认对外表述：模板里「supported by CAACI」「免费」这类说法，定稿前要确认属实。

二、上线前的法律底座（1 周内）
1. 社区条款，要点四条：
- 作者保留版权；
- 作者授予本站非独占的展示许可，范围写明网页和小程序，作者删帖即终止；
- 禁止发布他人作品；
- 转载必须已取得授权，并注明来源。
2. DMCA 代理人：在 copyright.gov/dmca-directory 用运营主体的名义登记。费用已核实：每次 6 美元，三年后失效，续期等于重新提交再付 6 美元。同时写一条重复侵权者封号政策（§512(i)）。少了这两项，用户上传内容的安全港就不成立；230 条款也不管知识产权。
3. 一个投诉入口，同时满足两套规则：美国 DMCA 通知要素，和中国民法典第 1195 条（收到通知后转送发帖人并及时处理）。撤稿和投诉的目标处理时间是 48 小时。
4. 审核规则只写违法、垃圾、隐私筛查，不写编辑精选。审核记录要留存。这是为了避开 Mavrix 案的风险。
5. 编辑账号一律实名署名，例如「CAACI 编辑部·某某」。不建马甲号，不伪造用户，不刷评论。这和 PLATFORM_RESEARCH.md 第 18 行的原则一致。

三、哪些事永远不做
- 不对 Reddit、一亩三分地、美卡、小红书、知乎跑任何脚本、无头浏览器、代理池或登录态抓取。
- 也不绕道：不经 Google 搜索结果、SERP API、redlib 一类镜像站批量拿内容。Reddit v. SerpApi 告的就是这种做法。
- 不把整帖机翻后转发。不把别人的帖子交给 LLM 改写，再当站内原创发布。
- 不截图，不搬小红书的图，不用 iframe 外嵌美卡等 Discourse 论坛的内容，不碰一亩三分地要积分或登录才能看的内容。
- 知乎的问题原文也不照抄。按协议三.2，问题和补充说明的知识产权归知乎。
- 签证、心理、室友冲突、房东纠纷这类敏感经历，不带用户名，也不带能认出人的细节。
- 「吃喝好店」「落脚香槟」不发编造或改写来的「亲身体验」。
- 不群发私信拉人，不替别人开账号。

四、冷启动流程（4 周，按 3 名志愿者估）
第 1 周，建问题库。人工浏览 r/UIUC 近一年的热帖（尽量在未登录状态下）、一亩三分地公开的 UIUC 相关帖、小红书和知乎上搜「UIUC」「香槟」的结果。表格只记五项：问题（用自己的话写一句）、对应板块、原帖链接、日期、是否敏感。目标 60–80 个问题，聚成 20 个左右的主题。
第 2 周，每个主题写一篇原创指南：
- 「落脚香槟」：租房签约、水电网、SSN、银行、驾照、MTD 公交；
- 「校园日常」：选课、CRCE、打印；
- 「吃喝好店」：只写编辑亲自去过的店，标注「编辑亲测」；
- 「学长学姐说」：用问答格式。
事实一律引官方页面，并注明「最后核实日期」。LLM 只用来润色你们自己写的稿子，不要把别人的帖子贴进去。
第 2–3 周，请真人来发。从 CAACI 校友、董事和学长学姐里找 10–20 人，每人认领 1–2 个问题，用自己的经历回答。遇到写得特别好的外站帖子，一对一请作者授权，或请作者本人来发。私信每周不超过 10 条，这个上限是我为避开反垃圾机制定的，没有官方依据。
第 3 周起，不定期发「外站导读」，不做每周固定栏目。每篇 3–5 个讨论串，以链接为主。每串用自己的话写不超过 150 字的概括，最多引一句原文，附链接和署名。一亩三分地不当固定来源。想把它做成固定周更，先请律师看一遍。
长期：
- 维护一张授权记录表，字段包括：作者、平台、原文链接、授权凭证截图、授权范围（翻译、转载或节选）、展示范围（网页、小程序、是否含中国大陆）、期限、能否撤回、署名方式、允许的改动、是否无偿、日期。
- 撤稿请求 48 小时内处理。
- 每季度复查一次 Reddit、知乎、小红书的条款。Reddit 2026 年已经改了三份文件：Developer Terms 03-24、User Agreement 05-26、Data API Terms 07-20。

五、模板（{论坛名} 等名字定了再填）
A. 摘要署名行（中文）：
「本文是 {论坛名} 编辑根据 r/UIUC 讨论串《{原帖标题}》（发帖人 u/{用户名}，{YYYY-MM-DD}）写的中文导读和评论，不是原文翻译。原文：{链接}。原文版权归原作者。作者如果希望修改或撤下，请写信到 {邮箱}，我们会在 48 小时内处理。」
敏感话题把「发帖人 u/{用户名}」换成「r/UIUC 网友」。
A'. 英文：
“Summary and commentary by {Forum} editors, based on the r/UIUC thread ‘{title}’ by u/{username} ({date}). This is not a translation. Original: {URL}. All rights in the original belong to its author. To request edits or removal, email {email}; we respond within 48 hours.”

B. 已获授权的转载署名行，放在正文开头：
「经原作者 {作者名} 于 {日期} 书面授权{翻译/转载}。原文：{链接}。版权归原作者，转载请联系原作者。」
知乎内容要在这一行里写明「发表于知乎」，这是知乎协议三.5 的要求。

C. 授权请求（英文，用于 Reddit 私信）：
“Hi u/{username}, I help run {Forum}, a free forum for Chinese students and alumni at UIUC, supported by CAACI, a local nonprofit. Your post ‘{title}’ ({link}) explains {topic} better than anything we have. Would you be OK with us translating it into Chinese and posting it on our forum (website and WeChat mini program), with your username and a link to your original? We would only change what translation needs. It would appear only in that forum post; for any other use we would ask you first. You can ask us to take it down at any time at {email}. If you would rather post it yourself, we are happy to help you sign up. No worries at all if not. Thanks!”
原模板里的「we can set up an account for you」改成了帮对方注册，因为替别人开号有冒用身份的风险。原模板还承诺「not use it in ads or paid content」，而平台研究写着将来要做付费功能，这句可能兑现不了，所以改成了「只在该帖子里展示，其他用途另行征求同意」。

D. 授权请求（中文，用于一亩三分地、知乎、小红书站内私信）：
「你好，我是 UIUC 华人学生和校友论坛 {论坛名} 的志愿者，论坛由本地非营利组织 CAACI 支持。你写的《{标题}》把 {话题} 讲得特别清楚。想问问你：我们能不能把这篇{全文/节选}转到论坛上（网页和微信小程序），署你的名字，附原文链接？内容只在这篇帖子里展示，其他用途会另外征求你的同意。你可以随时让我们撤下。如果你更愿意自己来发，我们帮你注册。不方便的话也完全没关系，谢谢！」
用在知乎时，加一句「我们会按知乎协议，在文章开头注明你的名字、原文链接和『发表于知乎』」。用在小红书时，私信里不放链接和微信号；对方同意后，请对方告诉你方便的联系方式，后续在站外完成。

E. 邀请对方自己来发（中英文各一句，可接在 C、D 后面）：
「你这篇对新生特别有用。愿意的话，来 {论坛名} 的「{板块}」发一份，我们会把它置顶到对应的新生指南里。」
“Would you be up for posting it yourself in our ‘{board}’ section? We'd pin it in the newcomer guide.”

六、需要请律师的情况
1. 想做任何规模的转载或翻译，或者想把外站导读做成固定栏目；想和 Reddit 谈数据协议。
2. 定稿社区条款、隐私政策、DMCA 政策和审核规则时，同时确定运营主体。
3. 收到律师函、DMCA 通知或平台投诉时。
4. 小程序在中国大陆分发：类目资质、UGC 合规，以及国内平台规则加中国法这一整套。
5. 想靠合理使用或适当引用，做超出「一句短引」的事。
UIUC Student Legal Service 的资料写明它不处理版权和商标问题，这一条这次没重新核实。可以去问芝加哥的 Lawyers for the Creative Arts，或伊利诺伊州律师协会的律师转介服务，两家的受理资格都没核实。

## 说明

这份是基于公开资料的研究和复核，不是法律意见，也不构成律师和当事人关系。平台条款随时会改：Reddit 2026 年就改了 Developer Terms（03-24）、User Agreement（05-26 修订，07-01 生效）和 Data API Terms（07-20）三份文件。Reddit v. Anthropic 已发回加州州法院，Reddit v. SerpApi 还在审，X v. Bright Data 有没有上诉没查到，「违约之诉会不会被版权法排除」的分界还在变。下面这些材料只看到二手或转载版本：Reddit Public Content Policy、Responsible Builder Policy、美卡 /tos、小红书协议、SerpApi 裁定细节、著作权法第 24 和 54 条原文、微信小程序论坛类目资质。遇到以下几种情况，请先找执业律师：批量转载、和平台签数据协议、确定运营主体和条款文本、小程序改类目、收到投诉。