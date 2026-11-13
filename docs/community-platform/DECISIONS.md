# DECISIONS

本文件放 Eric 和 CAACI 主席/董事会的决定。已定的写日期和出处；待定的写现状、选项、建议、谁定、截止任务。计划自己能定的技术选择写在 [SPEC.md](SPEC.md) 和 [ENGINEERING.md](ENGINEERING.md)，不进这里。

Eric 答复待定项：在 PR #369 或 V5 草稿 PR 留言「D-xx：选 A（补充说明）」（E14）。OMO 把答复抄进本文件，状态改为已定，写上日期和留言链接。OMO 不替 Eric 选；依赖未定项的任务跳过，在 STATUS 写明在等哪个编号。

## 已定

- **D-01 板块名**（2026-11-12，Eric 弹窗）：slug 不变。campus-life 校园日常 / Campus life；settling-market 落脚香槟 / Settling in；alumni-career 学长学姐说 / Ask alumni；events-social 找搭子 / Find a buddy；local-deals 吃喝好店 / Around town。Eric 的要求是「拟人化一点」「做好中英文配套」。每个板块收什么、示例标题见 SPEC §3。
- **D-02 导航分两步**（2026-11-12，Eric 弹窗）：P2.3 只把「广场」改名「社区」，tab 顺序和 pagePath 不变。P4.10 在活动接通后把中间的「发布」换成「活动」，tab 变为「社区｜二手｜活动｜消息｜我的」，启动页改为 pages/plaza/index，原「首页」改称「二手」；发商品入口移到二手页标题栏「＋ 发布」，发话题入口在社区页标题栏「＋ 发话题」。第二步的 tab 名单取自 D-24 采用的 homepage.md ⑩。
- **D-03 视觉先出稿再选**（2026-11-12，Eric 弹窗）：A 纸本书院 / B 白底高密 / C 图文双列三张稿（390 与 1280，结构按 D-24）给 Eric 选，Eric 倾向 A。选定（D-35）之前，代码不动现有视觉样式。
- **D-04 品牌主色**（2026-11-12，Eric 弹窗）：统一为 #B9452C，替换 uni.scss 的 #C74A2F 和对应阴影 rgba(199,74,47,…)（P1.4）。
- **D-05 发帖默认「话题」**（2026-11-12，Eric 弹窗）：话题有标题和板块；「动态」作为次选项保留，2027-01 评估去留（P6.1）。
- **D-06 测试库**（2026-11-12，Eric 弹窗）：用 staging-smoke（hygkwxugskijadgfisji）。Eric 本人确认只有合成数据（D-29），并应用 20261112120000（P2.6）。OMO 只拿公开 anon key 和合成账号 A/B/C，不持有 service_role 或 Supabase PAT。
- **D-07 工作站权限**（2026-11-12，tony-ws 核对，Eric 已配置）：GitHub 细粒度令牌只限 EricXu-0805/CAACI_Community_Marketplace_Bazaar（Contents、Pull requests、Workflows 读写；Actions、Commit statuses 只读；没有 Variables）；rootless podman 5.7；没有 sudo；Vercel CLI 已登录 ericxu-0805。
- **D-08 运营四项先由 Eric 兼任**（2026-11-12，Eric 弹窗）：内容维护、回复承接、举报处理、活动信息核对，Eric 先兼任，另指定一位轮值伙伴（人选与小时数见 D-28 和「运营负责人」）。
- **D-09 试点指标恢复 V2**（2026-11-12，Eric 弹窗）：求助帖 24 小时真人回复率 70%、D7 留存 25%（n≥40）、邀请 30–60 人、10–15 位贡献者、60 条审核样例；先做 5–8 人的主持任务测试。定义见「试点指标」。
- **D-10 活动页四类来源**（2026-11-12，Eric 弹窗）：CAACI 官网、官方账号转发的合作组织活动、用户发起、UIUC 学校活动。Eric 原话：「关键就是不能乱，这个得思考一下怎么处理」。防乱规则写在 SPEC 6.7.1。
- **D-11 官网 PR**（2026-11-12，Eric 弹窗）：授权 OMO 从 fork 向 a2751012962/caaciorg 提 PR，新增 GET /api/public-events，由官网维护者审阅合并。OMO 不碰 Brevo 和周报 cron。fork 权限见 D-31。
- **D-12 H5 与小程序同时发布**（2026-11-12，Eric 弹窗）：Eric 没有采纳网页先行的建议。如果 D-30 查出要换类目或换主体，这一条由 Eric 重议。
- **D-13 官方内容账号**（2026-11-12，Eric 弹窗）：admin@caaciorg.com 对应的站内账号，环境变量 COMMUNITY_OFFICIAL_PROFILE_ID。staging 与生产的 profile id 由 Eric 提供（E6）。
- **D-14 V5 文件结构**（2026-11-12，Eric 弹窗）：精简为 8 个文件（README、STATUS 加 STATUS_LOG、BACKLOG、SPEC、ENGINEERING、RUNBOOK、DECISIONS、OMO_PROMPT），旧材料进 appendix/；放分支 codex/community-plan-v5，开草稿 PR，不合 main（E1）。
- **D-15 公开 demo**（2026-11-12，Eric 弹窗）：品牌、板块名与视觉定稿后，更新到原网址 https://illini-community-demo.vercel.app/（以后可换新域名），保留旧部署可回退（BRAND.7）。
- **D-16 配置修正四项**（2026-11-12，Eric 弹窗）：npm 版本声明与 CI 一致（Node 22 自带的 npm 10.9.x）；缺 PostgreSQL 17 时 CI 下测试失败而不是静默跳过，并支持 PG_BIN_DIR；品牌色统一 #B9452C；Playwright 升到 1.65.0（1.61 起支持 Ubuntu 26.04，1.65.0 于 2026-11-05 发布），CI 不再固定 Ubuntu 24.04（P1.2–P1.5）。
- **D-17 先开工**（2026-11-12，Eric 弹窗）：V5 写完 OMO 就开工，先做不依赖视觉稿的任务（清单在 OMO_PROMPT）。
- **D-18 Vercel 护栏**（2026-11-12，Eric 弹窗）：工作站的 Vercel CLI（ericxu-0805，Pro 团队，能碰生产项目）禁止 vercel deploy --prod、禁止 vercel env pull，只能 link 到测试或预览项目；P1.13 只 link demo 项目。
- **D-19 #369 原分支续改**（2026-11-12，Eric 弹窗）：在 codex/community-topics-20261112 上继续改，保留已通过的部分。
- **D-20 产品改名**（2026-11-12，Eric 与 CAACI 主席讨论后在弹窗选定）：「玉米地 / Cornfield」，全称「玉米地 · 伊利诺伊华人论坛 / Cornfield · Chinese community in Illinois」。理由：market 听起来不像论坛；留学圈本来就把 UIUC 叫玉米地；名字不含 Illini、UIUC 等学校商标词。Eric 原话：「玉米地挺好的，后面我们的奖励 points 或者会员积分可以叫玉米粒，但是后面可能想把整个伊利诺伊州都加进来，所以这个也得考虑一下长期的协同」。naming.md 写的全称「香槟华人论坛」作废。
- **D-21 州级品牌加地区**（2026-11-12，Eric 弹窗）：首发只开「香槟 Champaign-Urbana」（slug cu）；帖子在 P2 就加地区字段（REGION.1 并入 20261112120000）；以后加芝加哥等地区只加 slug，不改名。开放第二个地区的条件列在 P6.1 候选。
- **D-22 玉米粒**（2026-11-12，Eric 弹窗）：保留为将来积分/会员积分的名字，属 P7，首批不建表、不加文案。
- **D-23 域名暂不注册**（2026-11-12，Eric 弹窗）：cornfieldforum.com/.org、cornfield.app 等 2026-11-12 查询未注册，有被抢注的风险；内测前再提醒 Eric（D-36）。illinimarket.com 保留，新域名启用后 301 跳转至少一年（BRAND.6）。旧域名跳转的最早停止日期：待 BRAND.6 写入（新域名启用日加 1 年）。
- **D-24 首页结构**（2026-11-12，Eric 弹窗）：板块网格加全站最新，规格以 appendix/research/homepage.md 为准。桌面 1280 主栏 2×3 六宫格（5 个讨论板块加二手好物，每格 4 条），下面全站最新 15 条（最新回复 / 新发布 / 待回答），右栏新来先看、近期活动、本周热议（达阈值才出现）、关于本站；手机 390 按板块分节，每节 3 条。homepage.md 与 SPEC 冲突的写法，以 SPEC 为准（SPEC §2 术语表、§5.1）。
- **D-25 冷启动低风险组合**（2026-11-12，Eric 弹窗）：内容见「冷启动内容政策」，依据 appendix/research/cold-start-legal.md。
- **D-26 以 CAACI 名义运营**（2026-11-12，Eric 弹窗）：社区条款、DMCA 指定代理人登记、转载授权都用 CAACI 名义；需主席/董事会正式同意（D-37）。后果见「运营主体」。
- **D-27 默认采用四项**（2026-11-12，Eric 授权按推荐处理，不再单独确认）：徽章「伊利诺伊认证 / Verified Illini」改为「校园邮箱已验证 / Campus email verified」（BRAND.3）；小程序显示名改为「玉米地」，不带「论坛」以避开类目资质，由 Eric 在微信后台改，改前核对服务类目、主体类型、剩余改名次数（D-30、BRAND.5）；「二手 / Market」保留为站内分区名；新 logo 用印章风格的「玉」或「玉米地」（D-34），不用 Block I 和学校的橙蓝配色。
- **D-31 caaciorg 的 fork 权限**（2026-11-12，Eric 在 Claude Code 弹窗选定、由 Claude 代发到 PR #370 留言 https://github.com/EricXu-0805/CAACI_Community_Marketplace_Bazaar/pull/370#issuecomment-6845368862）：选 A。原话：「Eric 建 fork EricXu-0805/caaciorg，把它加进 tony-ws 的令牌，给 Contents、Pull requests 读写；上游 PR 由 Eric 在网页上开」。同一留言写明 fork 和令牌权限还没加（E8），P4.3 推送前仍要等 E8 完成；在那之前 P4.3 只在本地写。
- **D-35 视觉方向**（2026-11-12，Eric 在 Claude Code 弹窗选定、由 Claude 代发到 PR #370 留言 https://github.com/EricXu-0805/CAACI_Community_Marketplace_Bazaar/pull/370#issuecomment-6845368862）：选 A（纸本书院，design/direction-a.html）。HOME.4、P2.12 按方向 A 做，BRAND.7 随后。
- **D-40 法律文本定稿前请律师**（2026-11-12，Eric 在 Claude Code 弹窗选定、由 Claude 代发到 PR #370 留言 https://github.com/EricXu-0805/CAACI_Community_Marketplace_Bazaar/pull/370#issuecomment-6845368862）：选 A。原话：「请律师，只审 LEGAL.2 的条款与隐私政策、LEGAL.4 的投诉流程」。
- **D-41 依赖安全审计**（2026-11-12，Eric 在 Claude Code 弹窗选定、由 Claude 代发到 PR #370 留言 https://github.com/EricXu-0805/CAACI_Community_Marketplace_Bazaar/pull/370#issuecomment-6845368862）：选 A。原话：「OMO 另开依赖修复 PR，先跑 npm audit fix，不带 --force，列出 lockfile 变化；需要 --force 的项和 vite 逐个报 Eric」。执行方式以第二条留言为准（2026-11-13 00:20 CT 由 Claude 代发，https://github.com/EricXu-0805/CAACI_Community_Marketplace_Bazaar/pull/370#issuecomment-6845406956）：「A 的执行方式按 BACKLOG P1.6 的写法，不另开分支。在 `codex/config-fixes-20261112` 上单独做一个以 `deps:` 开头的提交，在配置修正 PR 的描述里单列一节」；「修复范围不变：只跑 `npm audit fix`，不带 --force；需要 --force 的项和 vite 逐个报 Eric」。上一条里「另开依赖修复 PR」的说法以这条为准。

## 待定

### D-28 轮值伙伴与四项职责的小时数
- 现状：D-08 定 Eric 先兼任四项。轮值伙伴没有人选，「运营负责人」表的小时数四格全空。
- 选项：A 指定 1 位轮值伙伴，和 Eric 两人轮流；B 按板块分给 2–3 位董事或志愿者。
- 建议：A。内测只有 30–60 人，一个固定搭档比多人分摊好交接（判断）。排班要保证每天有一人看一次举报队列和版权投诉邮箱，因为举报（P3.6）、版权投诉（LEGAL.4）和合作组织撤回后的下架（SPEC 6.7.11）都定了 48 小时。
- 谁定：Eric。截止：LEGAL.6（P5.1 之前）。任一格为空就不进 P5。

### D-29 staging-smoke 只有合成数据的书面确认
- 现状：仓库根 RUNBOOK.md:1290-1291（7b18f20）指定 staging-smoke（hygkwxugskijadgfisji）为唯一获准的托管可丢弃目标；PR CI 的公开巡检经 vars.PR_SMOKE_SUPABASE_URL 连它（.github/workflows/ci.yml:321，005ca9d；main 上是 :319）。这个库没有应用 20261112120000，PR #369 的 CI 因此失败（STATUS「CI」）。库里有没有真实用户、有没有别人在用，只有 Eric 能在后台看到。
- 选项：A 只有合成数据：Eric 按 E2 留言，再做 E3、E4；B 发现真实数据或有人在用：不在这个库上应用迁移，Eric 另建一个免费 Supabase 项目当测试库，并改仓库 Actions 变量 PR_SMOKE_SUPABASE_URL、PR_SMOKE_SUPABASE_PUBLISHABLE_KEY、PR_SMOKE_SUPABASE_ANON_KEY（005ca9d 的 ci.yml:321-323 读这三个；OMO 的令牌没有 Variables 权限）。
- 建议：A，前提是 E2 逐页看过 Authentication → Users。
- 谁定：Eric。截止：P2.6（P1.11 已经需要）。

### D-30 微信后台核对结果
- 现状：AppID wxc3da81aa8852a6ff（app/src/manifest.json:42），现名「香槟市集」，开发版 2026-10-26 上传，未提审、未发布，没有已安装的用户。小程序从二手交易改成论坛，至少牵涉四件事：服务类目资质、名称能否带「论坛」、UGC 内容安全接口、个人主体能否开 UGC。cold-start-legal.md 2026-11-12 没查到这四件的官方答案。
- 要查（E7）：主体类型（个人 / 企业 / 海外）、名称剩余修改次数、现有服务类目是否覆盖用户发帖及所需资质；试填「玉米地」有没有重名或保护词提示。
- 结果怎么走：① 主体和类目都覆盖 UGC：BRAND.5 直接改名，P5.2 照常提审。② 类目不覆盖：先申请社区/论坛类目或补资质，P5.2 等资质下来。③ 个人主体不能开 UGC：主体换成组织（与 D-26 一致就用 CAACI），P5.2 推迟，Eric 重议 D-12。
- 谁定：Eric。截止：BRAND.5（改名前）、P5.2（提审前）。

### D-32 首批合作组织与书面同意
- 现状：没有任何合作组织给过书面同意，CSSA 只是举例。同意书中英文模板在 SPEC 6.7.11。
- 选项：A 首批只签 1 家（如 CSSA），跑满一个学期再加；B 一次签 2–3 家；C 首发不转发，活动页只放 CAACI 和学校活动。
- 建议：A。先用一家把核对和撤回流程跑通（判断）。D-37 之前不以 CAACI 名义签。每份同意都记进授权记录表（E11），编号写进 consent_ref。
- 谁定：Eric 和 CAACI 主席（对接合作组织）。截止：P4.5。

### D-33 学校活动收哪些 UIUC 日历
- 现状：2026-11-12 只读实测：XML 接口要向 Illinois Web Services 申请 key，公开的日历文件导出不需要；综合日历（ID 7）条目太多、展览按天拆分；ISSS 日历（ID 3715）里多数条目是咨询时段和学期日期。实测数字和两种接入方式的做法见 ENGINEERING §9.3，限量理由和排除规则见 SPEC 6.7.11。官方 feed 的使用条款是否允许站内展示，没找到书面说法。
- 选项：A 逐条收录：站务在管理台贴单条活动链接，服务端只读那一条的日历文件，候选来源为 ISSS（3715）和综合日历（7）；B 按选定日历整本同步：导出要在 1 MB 以内，配排除规则（咨询时段、学期日期等），综合日历 7 超过上限不能选；C 首发不收学校活动。
- 建议：A。人工挑选不依赖学校对整本导出的态度，也守得住「全部」视图每周 10 条的上限（判断）。ISSS 导出确认在 1 MB 内、条款允许之后，再考虑对 3715 改用 B。先等 OMO 交 appendix/research/campus-events.md（P4.7 第一步）。我判断只展示事实信息并链回原页风险低，但学校没有给过书面说法。
- 谁定：Eric。截止：P4.7。

### D-34 新 logo
- 现状：生产 logo 是 app/src/static/logo-mark.svg 的宋体「集」字印章（暗色为 logo-mark-dark.svg）。design/direction-a.html 的「玉」字印章沿用「集」印章的几何，用系统宋体的 `<text>` 渲染；替换生产文件之前必须转成轮廓路径。
- 选项：BRAND.4 出的 3 个印章稿（「玉」单字或「玉米地」三字）三选一。
- 建议：「玉」单字。24px 的 tab 图标和 favicon 上，三个字很难认（判断，看 BRAND.4 的 24px 预览再定）。
- 谁定：Eric。截止：BRAND.4。

### D-36 主域名
- 现状：2026-11-12 查询，cornfieldforum.com/.org/.net/.app、cornfieldcu.com/.org/.net/.app、cornfield.app 未注册；cornfield.com/.org/.net 在 2000 年已被注册（cornfield.com 的域名服务器在 Afternic，疑似待售，价格未知）。查询只代表当时，这些域名随时可能被人注册。完整结果在 appendix/research/naming.md。
- 选项：A cornfieldforum.com；B cornfield.app；C cornfieldcu.com；D 明确延后到内测之后。
- 建议：A。名字不带地区，和 D-21 的州级品牌一致；.com 比 .app 好记（判断）。注册时开自动续费（E9 ①）。
- 谁定：Eric。截止：P5.1（内测前必须答复）。

### D-37 CAACI 正式同意以 CAACI 名义运营
- 现状：app/src/legal/terms.en.ts:9 写「Illini Market is a community project operated by Guoyi (Eric) Xu」。cold-start-legal.md「建议方案」一：运营主体决定 FTC 规则管不管得到、DMCA 代理人用谁的名义登记、授权由谁签、出事由谁担责；「supported by CAACI」「免费」这类对外说法，定稿前要和主席确认属实。
- 选项：A 董事会决议；B 主席书面邮件，下次董事会追认；C 不同意，运营方保持 Eric 个人。
- 建议：B 先行，LEGAL.2 不必等董事会开会（判断）。同意的范围写明对外表述「由 CAACI 志愿者维护」和「免费」。
- 谁定：CAACI 主席/董事会（Eric 提请）。截止：LEGAL.1（LEGAL.2 之前）。选 C 的后果见「运营主体」第 5 条。

### D-38 DMCA 指定代理人信息
- 现状：没有登记。登记在 copyright.gov/dmca-directory，每次 6 美元，3 年后失效，续期等于重新提交再付 6 美元（cold-start-legal.md，2026-11-12 在版权局 FAQ 核实）。
- 要提供：代理人姓名或职位、CAACI 邮寄地址、电话、邮箱。
- 建议：代理人写职位（如 Vice President, CAACI），不写个人姓名；邮箱用 D-39 的统一地址。这样换届时少改一次登记（判断）。
- 谁定：Eric 和 CAACI 主席。截止：LEGAL.3。

### D-39 版权投诉与撤稿的收件邮箱
- 现状：没有。LEGAL.4 页面、模板 A 署名行、DMCA 登记都要写这个地址。
- 选项：A 在 caaciorg.com 下新建专用地址（例如 copyright@caaciorg.com），转给 Eric 和轮值伙伴；B 用 Eric 个人邮箱。
- 建议：A。换人不换地址，也和 D-26 的 CAACI 名义一致。
- 谁定：Eric。截止：LEGAL.4。

## 试点指标（D-09）

P5.5 的 scripts/pilot-metrics.sql 与本表逐字一致。改定义只改本表，并在 STATUS_LOG 记一条。

- 时间按 America/Chicago；「周」= 周一 00:00 到下周一 00:00。
- 内测开始日：待 P5.4 写入。之前的数据不计。
- 排除账号：官方账号（COMMUNITY_OFFICIAL_PROFILE_ID）和合成账号（邮箱以 @example.test 结尾）。「站务」指 Eric 和轮值伙伴的个人账号，profile id 在运行查询时传入，只在表里注明的地方排除。
- 有效互动：发话题或动态、发回复、发私信、发布商品。浏览、收藏、订阅不算。
- 写 V5 时没核对生产库有没有浏览或登录记录，所以 D7 只按写入行为算。P5.5 写查询时如果在 main 的迁移里找到可用的登录或浏览记录，OMO 在 STATUS_LOG 记下表名，由 Eric 决定是否改口径。

| 指标 | 分子 | 分母 | 统计窗口 | 目标 | 最小样本 |
|---|---|---|---|---|---|
| 求助帖 24 小时真人回复率 | 分母中发布后 24 小时内收到至少 1 条合格回复的帖子数。合格回复：作者以外、非排除账号（站务个人账号算）发的、未被隐藏或删除的回复 | 本周发布的求助帖数。求助帖：非排除账号、非站务发的话题，标题含「?」或「？」 | 每周；本周最后一帖发布满 24 小时后计算 | ≥70% | 分母 <10 帖只报数，不判定 |
| D7 留存 | 分母中在激活后第 7–13 天（激活当天为第 0 天，CT 自然日）至少有 1 次有效互动的人数 | 内测开始日后激活、且激活满 14 天的用户。激活 = 内测开始日之后的第一次有效互动；排除账号与站务不计 | 内测开始日起累计，每周一更新 | ≥25% | 分母 ≥40 才判定 |
| 贡献者 | 内测开始日起发过至少 1 条话题、且话题与回复合计 ≥5 条的用户数；排除账号与站务不计 | — | 内测开始日起累计，每周一更新 | 10–15 人 | 计数，不判比例 |
| 审核样例 | 有人工结论的审核记录条数（举报处理与发布审核），按中文/英文、违规/正常分列；另报漏检（自动放行、人工判违规）与误伤（自动拦截、人工判正常）条数 | — | 内测开始日起累计 | 60 条，其中中文、英文各 ≥20，违规、正常各 ≥20 | — |
| 邀请人数（投入） | P5.4 实际邀请的人数 | — | P5.4 | 30–60 人 | — |
| 主持任务测试（投入） | 完成的场次；AI 模拟不计 | — | P5.3 | 5–8 人，≥5 场 | — |

求助帖的「标题含问号」、贡献者的「≥1 条话题、合计 ≥5 条」、审核样例的中英与违规正常各 ≥20，是本计划定的口径（判断），P5.3 主持测试之后 Eric 可以改。V2 的原始表格在 [appendix/history/v2/original_v2_full_text.md](appendix/history/v2/original_v2_full_text.md) 第 12 节「试点指标与待确认决策」。

结果怎么用：回复率和 D7 连续 2 周达标且样本够，由 Eric 决定是否扩大邀请；任一项不达标，维持邀请范围，P6.1 每轮只改 1–2 个证据最强的问题；关键流程阻断、举报无人处理或出现越权读取，停止扩量，修好再说。

## 运营负责人（D-08、D-28）

| 职责 | 包括 | 负责人 | 每周小时 | 时限（出处） |
|---|---|---|---|---|
| 内容维护 | 新来先看 3–5 条；原创指南的「最后核实」日期；外站导读 | Eric（兼任）、轮值伙伴（D-28） | 待填 | CONTENT.2、CONTENT.5 |
| 回复承接 | 求助帖 24 小时内有人回；邀请校友作答 | Eric（兼任）、轮值伙伴（D-28） | 待填 | 「试点指标」第 1 行；CONTENT.3 |
| 举报处理 | 举报队列、隐藏与恢复、申诉、版权投诉与撤稿 | Eric（兼任）、轮值伙伴（D-28） | 待填 | 举报 48 小时（P3.6）；版权投诉 48 小时（LEGAL.4） |
| 活动信息核对 | 转发活动的录入与核对、学校活动挑选（D-33）、活动被举报后的下架 | Eric（兼任）、轮值伙伴（D-28） | 待填 | 合作组织撤回后 48 小时内下架（SPEC 6.7.11） |
| 官方账号 | admin@caaciorg.com 对应的站内账号：发站务帖与新来先看、开活动讨论 | Eric 持有登录 | — | profile id 见 E6 |

前四行任一「负责人」或「每周小时」为空，就不进 P5（LEGAL.6）。站务写的指南署名「整理：{实名}」。

## 授权边界

| 动作 | 谁批准 | 谁执行 | OMO |
|---|---|---|---|
| 改 Illini 代码，推 BACKLOG 写明的分支，开草稿 PR，写回 STATUS 与 STATUS_LOG | D-17 | OMO | 可以 |
| 合并 PR、转 ready、推 main | Eric，每次单独 | Eric（E5） | 不可以 |
| 向 a2751012962/caaciorg 提 PR | D-11，只限 public-events 接口及其 v2 | OMO 写；官网维护者审阅合并；D-31 权限到位后才推 | 只此一项 |
| staging-smoke 上用合成账号 A/B/C 做产品内的正常操作 | D-06 | OMO，只用 anon key | 可以 |
| 托管库的迁移、DDL、批量写（staging-smoke 或生产） | Eric，每次单独 | Eric（E4） | 不可以 |
| 生产发布：生产迁移、H5、小程序提审与发布 | Eric，每次单独 | Eric（E13，docs/SUPERVISED_RELEASE.md） | 不可以 |
| demo 预览部署（不带 --prod） | D-15、D-18 | OMO，只发到 P1.13 记下的 demo 项目 | 可以 |
| demo 转正（promote） | Eric | Eric（E12） | 不可以 |
| 依赖与 lockfile 变化 | D-16 的两项；其余按 D-41 批准的清单 | OMO | 只限清单 |
| 法律文本、品牌名、运营方上生产 | Eric 审定；运营方另需 D-37 | Eric 发布 | 只起草 |
| 付费：域名注册、DMCA 登记 | Eric | Eric（E9） | 不可以 |
| 微信后台改名、改类目 | Eric | Eric（E7） | 不可以 |
| 对外消息：邮件、Brevo、Discord、微信、小红书、Reddit 私信；联系合作组织、作者、官网维护者 | Eric，每次单独 | Eric 本人 | 不可以 |
| 冷启动内容：浏览外站、发授权请求、发授权转载 | D-25 | Eric、轮值伙伴、志愿者 | 不可以 |
| Brevo、CAACI 周报 cron、OpenClaw、Codex 自动化 | 不在本项目范围 | — | 不碰 |

什么情况下 OMO 必须停，见 RUNBOOK「STOP 清单」。

## 运营主体：CAACI（D-26，等 D-37）

1. D-37 之前：app/src/legal 里的运营方保持 Guoyi (Eric) Xu（terms.en.ts:9）；界面和分享卡不写「由 CAACI 志愿者维护」「免费」；LEGAL.2 不开工；不以 CAACI 名义签任何同意书或授权。
2. D-37 之后：LEGAL.2 把运营方改为 CAACI，服务名改为「玉米地（Cornfield）」并注「原 Illini Market」；DMCA 指定代理人以 CAACI 的法定名称登记（LEGAL.3、D-38），备用名称写「玉米地」「Cornfield」「Illini Market」和在用域名；授权转载（CONTENT.4）和合作组织同意书（P4.5、D-32）以 CAACI 名义签，记录放在 CAACI 名下的表格（E11）；投诉收件邮箱放在 caaciorg.com 下（D-39）；一句话介绍后面可以接「由 CAACI 志愿者维护」（SPEC 1.2）。
3. FTC 消费者评价规则：CAACI 若是真正的非营利机构，按 Community Blood Bank v. FTC（第八巡回，1969），FTC 大概率管不到。这是 cold-start-legal.md 的判断，该文只看了判决摘要。D-25 的禁令不因此放松：马甲号和假评价，谁运营都不做。
4. 小程序主体：如果 D-30 查到个人主体不能开 UGC，主体变更也以 CAACI 名义办（判断：没查到微信官方规则）。
5. D-37 选 C（不同意）：运营方仍是 Eric 个人；DMCA 登记、授权、同意书、投诉邮箱都用个人名义；FTC 规则管得到，据律所报道每次违规罚款上限 53,088 美元；Eric 重新决定 D-26，并改写本节。
6. CAACI 的中文全称以 CAACI 官网写法为准，本计划不自造。

## 冷启动内容政策（D-25）

这部分全由人做：执行任务是 CONTENT.1–CONTENT.6，OMO 不访问任何外站（RUNBOOK「STOP 清单」）。风险矩阵、判例和模板 A–E 原文在 [appendix/research/cold-start-legal.md](appendix/research/cold-start-legal.md)。

可以做：
1. 人工浏览外站（尽量不登录），只为收集常见问题。问题用自己的话写，答案写成原创指南；事实引 UIUC、ISSS、MTD、市政府等官方页面，并写「最后核实：YYYY-MM-DD」。LLM 只润色自己写的稿子。
2. 请 CAACI 校友、董事、学长学姐和好帖作者本人用自己的账号来发。
3. 特别好的外站帖，一对一请作者书面授权（模板 C、D、E，每周不超过 10 条），在正文开头用模板 B 署名，知乎内容加「发表于知乎」；每篇在授权记录表里有一行。
4. 不定期发「外站导读」：每篇 3–5 个讨论串，每串不超过 150 字的自己的概括，最多引 1 句原文，附链接和模板 A 署名；敏感话题不写用户名。

永远不做：
- 用脚本、无头浏览器、代理池或登录态抓取；经 Google 搜索结果、SERP API、redlib 一类镜像站绕道批量取内容。
- 整帖机翻转发；把别人的帖子交给 LLM 改写，再当原创发。
- 马甲号、假评价、刷评论；在「吃喝好店」「落脚香槟」发编造或改写来的亲身体验。
- 截图、搬图、用 iframe 外嵌；引用要登录或花积分才能看的内容；照抄知乎的问题原文。
- 群发私信；替别人开账号（可以帮对方注册）。
- 每周固定的「外站热议」栏目（cold-start-legal.md 定为中风险，要做先请律师）；一亩三分地不作固定来源。

站内审核只写成「违法内容、垃圾信息、个人隐私信息筛查」，不写编辑精选；「新来先看」只放官方账号的站务帖（LEGAL.5）。这样做是为了避开 Mavrix 案所说的先审后发丢失 DMCA 安全港的风险。
