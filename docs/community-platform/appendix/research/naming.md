# 论坛改名调查（2026-11-12）

Eric 与 CAACI 主席讨论后要求把产品名从 Illini Market 改成「XX论坛」类名字。本文为调查原文，决定见 DECISIONS.md。

## 结论

共列 8 个候选名，每个都查了重名，也按 .com/.org/.net/.app 查了域名（2026-11-12 用 dig 加注册局 WHOIS/RDAP）。我首推「玉米地 / Cornfield」，对外全称「玉米地 · 香槟华人论坛」。稳妥的备选是「香槟论坛 / Chambana Forum」。如果想保留现在的「集」字印章 logo，就选「香槟集 / CU Commons」。三个名字的 .com/.org/.net/.app 主拼写都还没人注册。

现名 Illini Market 的商标风险算中等，这是我的判断。UIUC 品牌站把「Illini」「Fighting Illini」「Illinois」「UI」和 Block I 都列为学校商标，「Illini」只放给注册学生组织（RSO）用在名字里。这个产品条款里写的是 Guoyi (Eric) Xu 个人运营，不是 RSO，又在规划 Premium 订阅和商家年费，所以这条放行用不上。

我直接排除了三个名字。「CU Forum」：cuforum.com 2026-01 被抢注，现在挂的是成人垃圾页；cuforum.org 是科罗拉多大学的校园刊物。「双城论坛」：中文里「双城」通常指明尼阿波利斯–圣保罗，这一条是常识判断，没找出处。「伊大论坛 / Illini Forum」：商标风险最高，留在列表里作对照。

现在改名成本最低。小程序开发版（AppID wxc3da81aa8852a6ff，现名「香槟市集」）还没提审也没发布，产品也还没公开上线。代码里有 55 个文件、242 行写了品牌名或域名。

有四处没核实：
- 微信里候选名有没有被占用。搜狗微信搜索只收录认证号，搜「UIUC」也是空的，这个方法不可靠。
- 小程序的主体类型和剩余改名次数。
- USPTO 上「ILLINI」单词商标现在的状态。
- 学校 General Rules 第三条第六款的原文。PDF 返回 403，没读到。

## 学校商标规定

一、学校怎么规定（访问日期均为 2026-11-12）
- 学校把哪些词算作商标：UIUC 品牌站 Trademarks and Licensing 页列了 Block I、体育盾牌、头盔 logo、校徽，以及「University of Illinois」「Fighting Illini」「Illinois」「U. of I.」「UI」「Illini」「Oskee Wow-Wow」。页面要求用在任何产品上之前，先拿到 Licensing and Trademark Office（licensing@illinois.edu）或 CLC 的批准。https://brand.illinois.edu/applying-the-brand/trademarks-and-licensing 。这条的弱点：页面没说网站、App、域名或线上服务名算不算「产品」，非学校实体能不能用也没写。
- RSO（注册学生组织）的规则：名字可以带「Illini」（例：Illini Chemistry Club）；不能以「University of Illinois」「Illinois」或它们的缩写开头；「Illinois」只能指州；不应使用「UIUC」；logo 不能用 Block I、校标或 Victory Shield；不能自称代表学校。https://brand.illinois.edu/applying-the-brand/registered-student-organizations 。Student Code 2-303 也允许 RSO 名称带 Illini/Illinois，这一条是从搜索摘要读到的，没打开全文。https://studentcode.illinois.edu/article2/part3/2-303 。弱点：这两处都只管 RSO。CAACI 是独立的 501(c)(3)，不是 RSO；本产品条款写的是「community project operated by Guoyi (Eric) Xu」（app/src/legal/terms.en.ts:9），套不进这条放行。
- 有约束力的原文：学校法务页指向 General Rules 第三条第六款，说学校同时持有注册商标和普通法商标。但法务页和 General Rules 的 PDF 都返回 403，原文没读到，这是本节最大的缺口。

二、联邦注册和执法先例
- 联邦注册：第三方商标聚合站显示，「ILLINOIS」有几件有效注册（如 Reg. 3692259 和 4890118，Markinton 2026-01 更新），https://markinton.com/trademark/illinois-77695312 。「FIGHTING ILLINI」有一件 1998 年的申请（serial 75415478），状态没查到。单独的「ILLINI」在聚合站上没找到有效的联邦注册。弱点：我没能直接查 USPTO（API 拒绝了请求），所以「没找到」不等于不存在。学校品牌站照样把 Illini 列为商标，普通法权利也不需要注册。
- 执法先例：2017 年 11 月学校在 USPTO 异议了校友 O'Malley 的商标申请，2018 年 3 月起诉他卖「Make Illinois Great Again」T 恤，同年 7 月和解，学校付他 7,500 美元。https://www.wcbu.org/state-news/2018-07-17/u-of-i-settles-lawsuit-against-alumnus-for-7-5k 、https://www.techdirt.com/articles/20180327/14381239516/university-illinois-attempts-to-trademark-bully-alumnus-after-failing-to-stop-his-trademark-registration.shtml 。弱点：那个案子涉及服装和 Chief 形象版权，不是线上服务名。
- 和学校无关却用 Illini 的反例：Illini Media（Daily Illini 的出版方）1911 年由州政府特许成立，是非营利机构。https://en.wikipedia.org/wiki/Illini_Media 。弱点：它比学校的授权体系早得多，又是学生媒体，不能拿来类比商业产品。

三、对现名「Illini Market」的评估（判断）
- 名字里真正有辨识度的就是「Illini」。拿它做 UIUC 社区交易平台的名字，容易让人以为是学校办的。
- 风险会随这几件事上升：收费（Premium 定价和商家年费是规划，代码里还没有）、注册 LLC（计划 2026-12）、公开推广。
- 想把「ILLINI MARKET」注册成自己的商标，大概率会被学校异议，O'Malley 案就是先例。
- 同名或近名已有两个：Devpost 上有个同名学生项目 https://devpost.com/software/illini-market ；校友会（UIAA）2022-11-01 宣布了官方的「Alma Market」，学生和本地商家都能在上面卖东西。https://prnewswire.com/news-releases/the-university-of-illinois-alumni-association-opens-a-community-based-online-marketplace-301664059.html
- 我对短期的判断：上线前的社区项目马上收到警告函的可能性不高，但不能排除。
- 现有徽章「伊利诺伊认证 / Verified Illini」（zh.ts:505、en.ts:507）读起来像学校出的认证，建议改成「校园邮箱已验证 / Campus email verified」。
- 现在的品牌色 #B9452C 和「集」字印章 logo 都没碰 Block I，也没用 Illini 橙蓝配色，这两处没问题。

四、对候选名的评估（判断）
- 玉米地、香槟论坛、香槟集、香槟街坊、香槟院子、香槟茶馆、CU Chinese Forum 都不含 Illini、Illinois 或 UIUC，学校商标风险低。
- 描述里写「服务 UIUC 及香槟地区华人」属于说明事实，可以；但别放进名字或 logo，也别出现「官方」字样。
- 「伊大论坛 / Illini Forum」风险最高。
- 「香槟」在中国是酒类地理标志：2013 年起受保护，连中文译名一起，https://drinksint.com/news/fullstory.php/aid/3839/.html 。这只约束酒类等商品，美国的论坛服务不受影响。现有小程序名「香槟市集」已经注册成功，说明「香槟」过了微信的名称检查；这个证据偏弱，因为还没经过提审。
- 以上不是法律意见。如果坚持保留 Illini，建议先给 licensing@illinois.edu 写信问清楚。

## 候选名

### 玉米地（对外全称：玉米地 · 香槟华人论坛） / Cornfield（副标题 Champaign-Urbana Chinese Community）

- 口号：香槟华人的日常、问答和二手
- 理由：这是中文留学圈对 UIUC 现成的叫法，不用解释。教育在线 2025-07-23 的文章说，校友比起「厄巴纳-香槟」更爱叫它「玉米地」（https://www.eol.cn/liuxue/lx-wyw/2025072316634.html）；新东方 2020-01-10 的文章说大家一听到 UIUC，第一反应就是「玉米地」（https://liuxue.xdf.cn/yichang/mglh_bklh_yxtj/1795289.shtml）；一亩三分地 2012 年有个热帖叫《我的玉米地-在UIUC的日子》（https://www.1point3acres.com/bbs/thread-29455-1-1.html，只看到搜索摘要）。弱点：这些都是留学机构和论坛的二手材料，没有官方出处。名字里没有任何学校商标。它和一亩三分地同属「田地」意象，但不是照搬（判断）。微信名称长度 6 字符，在 4–30 的范围内。
- 重名：网页搜索没找到同名的华人社区或 App。国内搜「玉米地 品牌」只出来鲜食玉米电商和排行页（https://www.cnpp.cn/focus/3566810.html），没有同名品牌。搜狗微信对「玉米地」返回空，但它对「UIUC」也是空，因为只收录认证号，所以这个结果不能说明没重名，微信内是否被占用要在后台试填才知道。英文 cornfield 是普通名词，cornfield.com 的域名服务器指向 Afternic 域名交易平台。
- 域名：2026-11-12 查询结果。
未注册：cornfieldforum.com/.org/.net/.app 四个、cornfieldcu.com/.org/.net/.app 四个、cornfield.app、yumidi.org、yumidi.app。
已注册：
- cornfield.com：2000-03 注册，域名服务器在 Afternic，疑似待售，价格未知
- cornfield.org、cornfield.net：均 2000 年注册
- yumidi.com：2001-06 注册，阿里云万网，网页没有标题
- yumidi.net：2026-09-16 刚被注册，挂的是 YUMI CONSULTING 页面
不确定性：「未注册」只说明查询那一刻注册局里没有记录。它可能是溢价或保留域名，也可能随时被别人注册。
- 风险：名字带一点自嘲：一亩三分地那帖里就有人拿「玉米地和坟地」开玩笑。学长学姐说、求职这类严肃内容挂在它下面，部分校友可能嫌不够正式（判断）。英文 Cornfield 在美国人看来只是「玉米田」，看不出是香槟，必须配副标题。名字本身没有「论坛」两个字，要靠副标题交代。

### 香槟论坛 / Chambana Forum

- 口号：香槟华人论坛 · 校园、生活、二手、活动
- 理由：完全照 Eric 说的「XX论坛」格式来，一看就是论坛。「香槟」是华人对 Champaign 的通用叫法。Chambana 是当地人对 Champaign-Urbana 两座城的合称俗语，能把住在 Urbana 的人也带上。ChambanaMoms.com 2009 年起就在用这个词（https://www.chambanamoms.com/about/）。
- 重名：中文搜「香槟论坛」只出来香槟酒的内容（如 https://jancisrobinson.com/zh-hans/articles/champagne-and-other-festive-fizz-2023），没有同名社区。「香槟」在中国是受保护的酒类地理标志，中文译名一起受保护（2013-05，https://drinksint.com/news/fullstory.php/aid/3839/.html），所以中文搜索和微信搜一搜里会混进大量酒水内容。chambana.com（2004）、chambana.org（2022）、chambana.net（2003）都已被别人注册。本地 CU LocalWiki（https://localwiki.org/cu/）是 wiki 不是论坛，不构成直接冲突。
- 域名：2026-11-12 查询结果。
未注册：chambanaforum.com/.org/.net/.app 四个（.com/.org/.net 另用注册局 RDAP 复核为 404）、xiangbinluntan.com/.org/.net/.app 四个、xiangbin.org、xiangbin.app、chambana.app。
已注册：xiangbin.com（2004，eName）、xiangbin.net（2010）、chambana.com/.org/.net。
不确定性同上：未注册不等于一定买得到。
- 风险：名字太通用，难有辨识度，也很难注册成自己的商标（判断）。刚来的新生未必认识 Chambana。微信里「香槟论坛」有没有被酒类账号占用，没查到。

### 香槟集 / CU Commons

- 口号：香槟华人的论坛、二手和活动
- 理由：可以保留生产环境里那枚宋体「集」字印章（app/src/static/logo-mark.svg，V4 评审记录这套视觉是 Eric 6 月批准的方向），也接得上小程序现名「香槟市集」，视觉上改动最小。「集」既是集市也是聚集，论坛、二手、活动都装得下。Commons 是公共空间的意思，适合论坛。
- 重名：没找到叫「CU Commons」的社区。本地有 Champaign Commons 购物中心（109 N. Mattis Ave，主力店 Schnucks，https://www.commercialsearch.com/commercial-property/us/il/champaign/champaign-commons），还有 University Commons、Urbana Commons 两处公寓（https://www.rentable.co/urbana-il/urbana-commons），英文名在本地容易被当成楼盘。CU 在外地还指科罗拉多大学（cuforum.org 就是 CU 校园刊物）、康奈尔、哥大。中文搜「香槟集市」没有结果。
- 域名：2026-11-12 查询：cucommons.com/.org/.net/.app、chambanacommons.com/.org/.net/.app、xiangbinji.com/.org/.net/.app 全部未注册（cucommons.com/.org 另用 RDAP 复核为 404）。
- 风险：「集」还是会让人先想到市集，和 Eric 嫌 market 不像论坛的初衷相反（判断）。名字不带「论坛」。英文名像公寓楼盘。

### 香槟街坊 / CU Neighbors

- 口号：在香槟的华人街坊
- 理由：「街坊」能把学生、校友、家属和本地华人居民都装进来，和 CAACI 社区协会的身份对得上，也不像 AI 产品名（判断）。
- 重名：搜「CU Neighbors」只出来 Champaign 市政府的社区新闻（https://champaignil.gov/category/neighborhood-news）和 CU-CitizenAccess 的报道，没有同名社区或 App。中文「香槟街坊」没有搜到结果。
- 域名：2026-11-12 查询：cuneighbors.com/.org/.net/.app 全部未注册（.com 另用 RDAP 复核为 404）。
- 风险：「街坊」口语感偏老，本科生可能嫌土（判断）。英文 Neighbors 很通用，像 Nextdoor 的本地版，难建立品牌。名字里看不出是论坛。

### 香槟华人论坛 / CU Chinese Forum

- 口号：UIUC 与香槟地区华人交流
- 理由：纯描述型的名字，用户搜什么就叫什么，在微信搜一搜和中文搜索里最容易被找到。
- 重名：本地已有 CAACI（Chinese American Association of Central Illinois）、Champaign-Urbana Chinese-American Evergreen Association（https://getholdings.com/nonprofits/ein/823256560）、CSSA 等组织，名字和它们靠得很近，外人可能以为是其中某一家的官方论坛。
- 域名：2026-11-12 查询：cuchinese.com/.org/.net/.app、cuchineseforum.com/.org/.net/.app 全部未注册。cuchinese.com 没人注册有点意外，已用 Verisign RDAP 复核为 404。
- 风险：名字长而泛，难做品牌，也难注册商标（判断）。只说「华人」，可能把想参与的非华人校友和本地人挡在外面（判断）。

### 香槟院子 / CU Yard

- 口号：香槟华人的院子
- 理由：「院子」有自家人聚在一起的感觉，比「广场」更亲近（判断）。
- 重名：Urbana 401 N. Broadway Ave 有一家 The Yard on Broadway，这条来自 Experience CU 2025-08 版地图的搜索摘要（https://www.experiencecu.org/media-library/documents/Resources/2025_Illustrated_Map_August.pdf），PDF 本身没打开核对。
- 域名：2026-11-12 查询：cuyard.com/.org/.net/.app、chambanayard.com/.org/.net/.app 全部未注册（cuyard.com 另用 RDAP 复核为 404）。
- 风险：英文 Yard 容易让人想到 Harvard Yard，或者被当成院子出租、旧家具（判断）。看不出是论坛。

### 香槟茶馆 / Chambana Teahouse

- 口号：坐下来聊聊香槟的事
- 理由：茶馆是中文圈常用的闲聊区意象（老舍《茶馆》），口语化，不像 AI 产品名（判断）。
- 重名：中文搜「香槟茶馆」没有结果，没发现同名社区。
- 域名：2026-11-12 查询：chambanateahouse.com/.org/.net/.app、cuteahouse.com/.org/.net/.app 全部未注册。cuteahouse 读起来像「cute a house」，不建议用。
- 风险：更像板块名而不是整站名（判断）。英文名长。本地哪天开了同名的茶饮店就会撞名（判断）。

### 伊大论坛（对照组，不推荐） / Illini Forum

- 口号：伊大华人论坛
- 理由：「伊大」是华人对伊利诺伊大学的常用简称，一看就知道是 UIUC。列出来主要是为了和其他候选比较风险。
- 重名：IlliniBoard.com 是需要订阅的 Illinois 体育内容站（https://illiniboard.com/），IlliniGuys 有球迷论坛（https://illiniguys.com/illiniguys-celebrate-3rd-anniversary），英文名和这类体育站容易混。「Illini」在学校商标清单上（https://brand.illinois.edu/applying-the-brand/trademarks-and-licensing）。
- 域名：2026-11-12 查询：illiniforum.com/.org/.net/.app 全部未注册（.com 另用 RDAP 复核为 404）。
- 风险：8 个候选里商标风险最高。学校只允许 RSO 在名字里用 Illini，本项目不是 RSO，还规划了收费（判断）。「伊大」也可能被理解成伊利诺伊州内其他学校（判断，没找到出处）。英文名会让人误以为是体育论坛或学校官方。

## 推荐

我的排序如下。最终由 Eric 和主席定。

1. 首推：玉米地 / Cornfield。对外全称「玉米地 · 香槟华人论坛」，英文副标题写 Champaign-Urbana Chinese Community。
- 理由一：它是这个圈子本来就在用的叫法，教育在线和新东方的留学文章都写过，口口相传成本最低。
- 理由二：不碰 Illini、Illinois、UIUC 任何一个词，商标上最干净。
- 理由三：cornfieldforum.com 和 cornfieldcu.com 都没人注册。
- 代价一：yumidi.com 和 yumidi.net 已被占，拼音域名用不了，只能用英文域名。
- 代价二：名字里没有「论坛」，要靠副标题交代。
- 代价三：有人会嫌它自嘲、不够正式。如果主席担心校友和家长觉得不够正经，就选第二名。

2. 稳妥：香槟论坛 / Chambana Forum。
- 它完全符合 Eric 说的「XX论坛」，也最不容易被误读。
- chambanaforum.com/.org/.net/.app 四个都没人注册。
- 缺点是太通用：中文搜索会被香槟酒的内容淹没，也很难注册成自己的商标。

3. 想保留现有视觉：香槟集 / CU Commons。
- 「集」字印章 logo 和小程序现名「香槟市集」都能沿用，改动最小。
- 但「集」仍然带着市集的意思，没解决「听起来不像论坛」这个问题。

不管选哪个，下面几件事都要做：
- 在小程序提审前把名字定下来，并在小程序后台「设置 → 基本信息 → 名称」里试填，确认没被占用（只试填，不提交）。
- 选定后尽快注册主域名。查询结果只代表 2026-11-12 当时的状态。
- illinimarket.com 继续保留，做 301 跳转，至少保留一年。
- 「Illini」退出产品名和徽章文案。「UIUC」只出现在描述里。
- 「二手 / Market」降为一个板块名。

拍板前最好再补三项核对：
- 在微信和小红书里搜一下这几个名字有没有同名账号。
- 把三个名字念给几位新生和一位校友听，看谁一听就懂。
- 确认小程序的主体类型和剩余改名次数。

## 改名影响范围

一、时机
现在改名最便宜。memory 记录：小程序开发版 2026-10-26 已上传，没提审，没发布；公开上线还是 NO-GO。另外，2026-11-12 的 handoff 文档 BACKGROUND_AND_DECISIONS.md 第 30 行写着「Illini Market 继续作为产品名称和社区核心；首轮不做重新命名」，改名要先把这条决定改掉，同步更新 OMO_PROMPT 和 V4 评审里写死的「Illini 集市」。

二、微信小程序（AppID wxc3da81aa8852a6ff，现名「香槟市集」）
- 改名入口：设置 → 基本信息 → 小程序名称 → 修改，管理员扫码确认。
- 改名次数：ifanr 2017-08-16 的文章说，个人主体在发布前有 3 次改名机会，发布后每年 2 次（https://www.ifanr.com/minapp/892522）。另一篇 ifanr 问答说，企业主体改名要走微信认证，认证费 300 元（https://www.ifanr.com/minapp/892392，发布日期不明）。这两篇都是旧的第三方资料，以后台实际提示为准。这个 AppID 是个人、企业还是海外主体，还没核实；已经用掉几次改名机会也不知道。
- 名称规则：4–30 个字符，一个汉字算 2 个；不能和别的主体的公众号或小程序重名；碰到保护词要再审，最多 7 个工作日（Oray 2023 指南，https://service.oray.com/question/5655.html）。
- 名字和类目要对得上：名字带「论坛」，提审时可能要求选社交或论坛类目。这类类目审核偏严，对主体资质有要求，这一点只找到 2018 年 V2EX 帖子里的经验（https://v2ex.com/t/472456），没有官方条文，要在后台「服务类目」里核对。
- 备案：如果这个小程序已经做过备案，改名可能要走变更备案。我没找到官方说法，待核。
- 改不改无所谓的：project.config.json:26 的 projectname 只是开发者工具里的本地名，跟着改就行。

三、代码和文案
2026-11-12 在当前工作树上用 grep 搜品牌名，共 55 个文件、242 行。
- 品牌名本身：app/src/manifest.json:2、app/src/pages.json:182（navigationBarTitleText）、static/manifest.webmanifest:2-3（PWA 名称和简称）、app/index.html、app/public-brand-pages.ts（13 处）。
- i18n：zh.ts:177 的 'app.name' 是「Illini 集市」，en.ts:177 是「Illini Market」；'app.desc' 两种语言里都写成二手交易平台，要改成论坛的描述。zh.ts:473 和 en.ts:475 的审核提示把产品说成「只用于同学之间交易物品」。徽章文案在 zh.ts:505-515、en.ts:507-517，建议改成「校园邮箱已验证」。
- 路由：pages/illini-verify 这类内部路由名和数据库字段 is_illini_verified 不用改，改了反而会让旧链接失效。
- 分享卡：api/share.js:197-237 和 api/share-post.js:171-205 里的 og:site_name 和兜底标题「Illini Market · Campus Plaza」要改。微信会缓存已经分享出去的卡片，旧卡片会继续显示旧名字。
- 法律文本：terms、privacy、guidelines 的中英文版都写着服务名，改完更新「最后更新」日期。
- 静态页：static/h5/account-deletion.html（10 处）、robots.txt。
- 邮件：supabase/email-templates 下的 confirm-signup 和 reset-password 只是仓库副本，实际生效的在 Supabase 后台，要手动重新粘贴。
- 测试：api/_share-boundary.test.mjs（33 处）、_email-brand-boundary.test.mjs（11 处）、_deployment-boundary.test.mjs 都断言了品牌字符串，要跟着改，否则 CI 会红。

四、域名和跳转
- illinimarket.com：2026-06-25 在 Cloudflare 注册。要长期续费保留，页面路径一律 301 到新域名，path 和 query 原样带过去。
- 接口：/api/* 和 /share/* 在过渡期两个域名都要能直接服务，不要对 POST 请求做跳转。原因是已经装上的小程序旧版本和没刷新的 H5 还在调旧域名。
- 换新域名要同步改：
  - 代码里的 CORS 白名单（例如 api/auth/send-illini-code.js:22-23）
  - Supabase Auth 的 Site URL 和 Redirect URLs
  - Vercel 项目域名
  - Cloudflare DNS
  - 小程序后台的 request 合法域名和业务域名
  - Sentry 等监控配置
- 邮件发件人：现在是 DIGEST_FROM=Illini Market <noreply@send.illinimarket.com>。可以分两步走：先只改显示名，继续用已经验证过的 send.illinimarket.com；等新域名在 Resend 里配好 SPF、DKIM、DMARC 并验证通过后再换。这样不影响邮件送达率。
- 支持邮箱：help@illinimarket.com（runtime.ts:57），跳转期间继续收信。
- 防御性注册：illinimarket.org、.net、.app 目前都没人注册，要不要买下来防止被人冒用，由 Eric 决定。

五、对外过渡
- 10 月已经用 Illini Market 这个名字私信过 300 多位本地卖家（自动化 11-02 起暂停）。站内和关于页建议写「原 Illini Market」，保留大约 3 个月。
- CAACI 官网、周报、微信群里提到新名字，都属于对外发布，要 Eric 先批准。
- 仓库名、Supabase 项目名、Codex 自动化名这些内部名称不用改。

六、「二手 / Market」改成子板块
- 把它保留为一个一级板块或 tab，中文叫「二手」，英文叫「Market」或「Marketplace」，和校园日常、落脚香槟、学长学姐说、找搭子、吃喝好店并列。
- 首页瀑布流和 pages/index、pages/detail 照常沿用，只改入口文案和页面标题。V4 评审里「广场改名社区」那一步可以和这次改名一起排期。