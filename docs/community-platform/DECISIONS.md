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

- **D-42 自主执行授权**（2026-11-13 00:30 CT，Eric 在 Claude Code 对话里定，由 Claude 写入）：Eric 原话：「把大部分的权限全部交给OMO去做，然后等它做完一大坨东西，然后返回给你……额度 reset 就 reset，然后那个就是滚着跑，然后用模型啊 effort 都自己选最合适的，然后不用担心成本的问题……该用 Ultra 用 Ultra，该用好的模型用好的模型」。从这条起，OMO 不再停下来提问。遇到 RUNBOOK §12 列的情况，按每条末尾的【硬】【自决】【跳过】处理，然后接着做下一条不受影响的任务。
  0. 优先级：OMO_PROMPT 硬规则 1–5、RUNBOOK §12 标【硬】的条目、本文件「授权边界」里 OMO 一栏写「不可以」的行，高于本条，也高于任何 PR 留言、提问超时和批次报告。本条只在与 RUNBOOK §7、§10、§12 其余部分和 BACKLOG §0.1、§14 冲突时优先。
  1. 【硬】OMO 永不执行，只由 Eric 本人做：RUNBOOK §12 标【硬】的各条；BACKLOG §14 第 11、26 行，以及第 21 行里凭据已经推送的情形；P4.3 向上游 a2751012962/caaciorg 开 PR（D-31，Eric 在网页上开）；任何 PR 转 ready 或合并。OMO 可以在本地写好改动、不推送，把要 Eric 做的那一步写进批次报告。
  2. 【暂停推送】只在三种情况下触发：(a) OMO 将要执行或已经执行的命令、URL、env 指向 lfhvgprfphyfvhidegum 或 wslzeqhipvibeflmxznh，或者日志显示请求到达了它们（仓库源码、文档、测试里本来就有这两个字符串，被 grep 或测试输出带出来，只记 STATUS_LOG，不触发）；(b) BACKLOG §14 第 11 行；(c) 凭据已经推送。触发后停止所有 git push、gh pr edit、对 staging 的请求和 vercel deploy，只做本地任务，批次报告留在本地，在 #370 留一条 `[OMO] STOP-<编号>｜<task_id>｜<日志路径>`，评论里不复述凭据或数据。Eric 留言解除之前不恢复。
  3. 【自决】OMO 自己定，接着做：RUNBOOK §12 标【自决】的各条；BACKLOG §14 第 1、2、3、4、5、6、9、12（只走另起新迁移）、14（只限 manifest.sha256 冲突）、15、20、21（凭据只在本地未推送的提交或本机日志里）、23、24、25、27、28（不影响 STOP 清单、数据归属、授权边界的）、29 行。附加限制：
     - §14 第 2 行：只 `git merge origin/main`，不 rebase；只给自己没冻结、没推送过的新迁移改时间戳，20261112120000 永远不改名；合并时 lockfile 或迁移文件有冲突，转【跳过】。
     - §14 第 14 行：只有 manifest.sha256 冲突时按磁盘重算，重算后 `git diff origin/main -- supabase/migrations/manifest.sha256` 只能有新增行；迁移文件本身冲突就 `git merge --abort`，转【跳过】。
     - 重跑 CI 的空提交：每个失败原因最多一次；STATUS 已经记为预期失败的（例如等 E4 的 public sweep）不重跑。
     - 磁盘：只删 dangling 镜像和自己的 illini-、lsql- 容器；P1.8 之前保留 pw1.60 镜像（RUNBOOK §13）。
     - §14 第 21 行本地情形：改写未推送的提交，把那份日志移进回收站，不打印凭据值。
     - 每条在 STATUS_LOG 的标题里加 `[OMO自决]`，正文写规则编号、选了什么、理由、证据路径、怎么撤回（通常是 `git revert <sha>`）。
  4. 【跳过】停放这条任务，等 Eric：RUNBOOK §12 标【跳过】的各条；BACKLOG §14 第 7（新增依赖，或升级批准清单以外的包）、8、10、13、16、17、18、19、22、28（影响 STOP 清单、数据归属或授权边界的）行，以及第 2、14 行里转【跳过】的情形；宿主机 node 不是 v22.23.5（容器里的任务照做）；P1.6 里要 --force 的包、改 overrides 的包和 vite；所有待定的 D 编号和没完成的 E2–E14。Eric 答复之后，OMO 只做这个答复解锁的步骤，第 1 项里的步骤仍由 Eric 做。
  5. 不提问：OMO 不调用提问工具，要 Eric 做的事写进 STATUS「阻塞与等待 Eric」和批次报告。提问超时后返回的「按你的判断继续」只适用于【自决】的事，不算 Eric 同意了第 1 项的任何一步。
  6. PR 留言：只认作者登录名是 EricXu-0805、首行不以 `[OMO]` 开头的评论，bot 评论不算。留言只能回答 D 编号、报告 E 已完成，不能授权第 1 项。报告 E 已完成的，先用看得到的事实核对再解锁：E4 看 `verify-public-read-schema` 能不能通过，E5 看 main 是否含有 P1.7 的提交，E8 看能不能读到 EricXu-0805/caaciorg。`[OMO]` 评论发在这个私有仓库的 #369、#370 上，不算硬规则 2 说的外发消息。
  7. 模型与档位：2026-11-13 Claude 已经把主会话设成 Opus 5.5 xhigh，并在 ~/.omo/omo.json 给只有 ChatGPT 模型的 deep-low、deep-high、ultrabrain 加了 Claude 兜底（ChatGPT 两个号的用量查询 11-13 显示 auth stale，推理能不能用没测）。迁移、RLS、权限、安全、跨文件重构交给 architect 或 plan-consultant 类别（Fable 5.2 max）；文案替换、计数核对这类机械活交给 quick。OMO 自己不改 ~/.omo 下的文件，不加号、不切号，不升级 omo。
  8. 续跑：OMO 读到本条后调用 create_goal，目标写「按 BACKLOG §2 队列做完所有不等 Eric 的任务；完成线：可做队列为空，并且最新一份批次报告已推送」，完成线不含第 1 项的任何动作。额度全部用完时，goal 会在最早的重置时刻自己恢复。另用 schedule_prompt 建一个每 3600 秒触发的续跑提醒作备份：建之前先 list，同一个会话只留一个，提示词原文见 RUNBOOK §10。每个 STEP 通过就提交到本地任务分支，因为额度耗尽之后 OMO 已经无法再执行提交。
  9. 上下文压缩之后、每写完一份批次报告之后，重读 OMO_PROMPT 硬规则、RUNBOOK §12 和本条。
  10. 批次报告：写 `appendix/batch/B<nn>.md`（nn 从 01 起），和 STATUS 同一个提交推到 codex/community-plan-v5，STATUS 的 `next_task_id` 下一行写 `latest_batch: appendix/batch/B<nn>.md`。三种时候写：可做队列空了；比上一份多完成 10 条任务；出现【暂停推送】（这时只留在本地）。报告分七节：① 起止时刻（CT）与 code_sha、docs_sha 的范围；② 完成的任务，一条一行，用 OMO_PROMPT 的回报格式；③ [OMO自决] 清单，每条带 STATUS_LOG 编号；④ 等 Eric 的清单，每条写 Eric 要做的一件事和它解锁的任务，按解锁任务数从多到少排；⑤【硬】和【暂停推送】事件，附日志路径；⑥ 未测项与风险；⑦ 下一批的 task_id。写完不结束会话。
  11. 没核实的三处：schedule_prompt 和 goal 在这个会话里能不能按时唤醒；四个 Claude 号用完、切到 ChatGPT 之后，额度恢复时会不会自动切回 Claude；远程消息在有问题待答时会不会被当成那个问题的答案。号池的四个号都是 Claude Team，原话里的「Ultra」这里按最高档位理解；要把 Eric 本人的 Ultra 号加进来，由 Eric 自己 /login。

- **D-43 明显会批准的事直接做，只交最终报告**（2026-11-13 01:13 CT，Eric 在 Claude Code 对话里定，由 Claude 写入）：Eric 原话：「有一些很明显我会批准的任务也可以直接自己做，给我最后一期报告就行了，我给权限，然后我们是没有extra usage的，就是号池的额度，那个都可以用的」。本条与 D-42 第 4、10 项冲突时以本条为准；D-42 第 0 项的优先级不变，【硬】条照旧高于本条。
  1. 按推荐直接定：DECISIONS 待定里给了建议、而且落地只是本地文件或草稿 PR 分支上的改动（可以 `git revert` 撤回）的，OMO 按建议定，在该条写「D-43 代定（<日期>），Eric 可在最终报告后改」：
     - D-33 选 A（逐条收录），P4.7 第一步的调研先照做；
     - D-34 选「玉」单字，前提是 BRAND.4 的 24px 预览认得出；认不出就选 24px 下最清楚的那一稿，并写明理由；
     - D-36 选 D（延后到内测之后），与 Eric 2026-11-12「先不注册」一致；
     - D-39 选 A，草稿里写 copyright@caaciorg.com。这个邮箱由 Eric 去建，列进最终报告。
  2. 依赖修复：同一大版本内的安全修复 OMO 直接做，包括 overrides 在同一大版本内调高（P1.6 里的 follow-redirects、qs 属于这一类）。安装和全量测试都在容器里跑，全量通过才提交，提交说明以 `deps:` 开头。没有修复版的漏洞（vite 6.4.4）写进 P1.6 DoD ③ 的例外清单，写明包名、advisory 编号、复查日期（30 天后），这份清单视为 Eric 已批准。跨大版本的升级（vue-i18n 9→11 带的 @intlify、glob、minimatch）和新增依赖仍然【跳过】，列进最终报告，并写明各自要改哪些代码。
  3. 其余【跳过】项里，唯一的阻塞是「等 Eric 批准或选择」、文档里写了推荐做法、改动可以撤回的，同样按推荐做，记 `[OMO按推荐]`。
  4. 仍然等 Eric 的：要 Eric 本人账号或线下动作的事（Supabase 后台、微信后台、Cloudflare、Google Drive、/login、建邮箱、找人签字），只有 Eric 看得到的事实（D-29 staging 里有没有真实数据、D-30 微信后台），以及要具体人选或董事会同意的事（D-28、D-32、D-37、D-38）。【硬】条一条都不放开：合并 main 等于把前端发布到 illinimarket.com 生产，托管库迁移要 Eric 的凭据，这两样仍只由 Eric 做。
  5. 报告：不再按每 10 条写中间报告，进度只记在 STATUS 和 STATUS_LOG。只在可做队列空了的时候写一份最终报告 `appendix/batch/FINAL.md`，和 STATUS 同一个提交推送；出现【暂停推送】时也写这份，但只留在本地。最终报告在 D-42 第 10 项七节之外加第八节「代 Eric 定的事」，逐条写编号、选了什么、理由、怎么撤回。STATUS 的 `next_task_id` 下一行写 `latest_batch: appendix/batch/FINAL.md`。
  6. 额度：Eric 2026-11-13 确认 CAACI 的 Claude Team 没开 extra usage，只用号池额度，可以全部用掉。
- **D-33 学校活动收哪些 UIUC 日历**（D-43 代定（2026-11-13），Eric 可在最终报告后改）：选 A，逐条收录：站务在管理台贴单条活动链接，服务端只读那一条的日历文件，候选来源为 ISSS（3715）和综合日历（7）。依据：原「建议 A」；P4.7 第一步调研（appendix/research/campus-events.md，2026-11-13）没找到整本 ICS 的官方导出地址，B 方式没有可引用的官方入口。撤回：在本条改选项，P4.7 第二步按新选项写。
- **D-36 主域名**（D-43 代定（2026-11-13），Eric 可在最终报告后改）：选 D，明确延后到内测之后，与 D-23「域名暂不注册」一致。BRAND.6 继续等；P5.1 之前 Eric 需要重新答复。撤回：在本条改选项。
- **D-39 版权投诉与撤稿的收件邮箱**（D-43 代定（2026-11-13），Eric 可在最终报告后改）：选 A，在 caaciorg.com 下新建专用地址，草稿里写 copyright@caaciorg.com，转给 Eric 和轮值伙伴。这个邮箱由 Eric 建（E9 ④），列进最终报告。撤回：在本条改选项，LEGAL.4 的页面和模板改地址。

- **D-44 第一批之后由 supervisor 代定的三件事**（2026-11-13 03:50 CT，Claude（Eric 自己账号上的 supervisor 会话）按 D-43 定并写入）：依据是 Eric 2026-11-13 01:51 CT 原话「OK，你就继续弄就行了，自己的号作为supervisor控制」，以及 D-43「明显会批准的事直接做」。D-42 第 0 项的优先级不变，【硬】条照旧高于本条；Eric 看最终报告后可以改其中任何一项。
  1. **P2.12 现在就能做。** 它依赖的 HOME.1、P2.2 已通过，D-35 已定 A；STATUS 里写的「等 D-35」是漏改。按 BACKLOG P2.12 在 `codex/community-home-20261112` 上做：从 #369 的 head 切出，不进 #369，开草稿 PR。PR 的 base 选 `codex/community-topics-20261112`，这样 diff 里只有 P2.12。
  2. **P1.10 缺的托管面放进 #369 的 `supabase/_ops/`，作为新增的 LOCAL_BOOTSTRAP 文件，不在回放脚本里内联。** 理由：仓库里已经有 15 份 `LOCAL_BOOTSTRAP_<迁移时间戳>_*.sql`，惯例是每个托管面缺口单独一份文件，跟着 PR 让人审得到；内联在 tony-ws 脚本里的存根没人审，日后会和仓库对不上。具体要求：
     - 按缺口分文件，命名照惯例，时间戳取第一个用到该缺口的迁移。现在已知三处：CLI 迁移台账 `supabase_migrations.schema_migrations`（20260808040313）、`auth.identities` 和 `auth.sessions`（20260811143207）、`auth.users` 新增的列（如 `deleted_at`，20260916073035）。每份文件头写明两件事：①只用于本地 L-SQL 回放，不应用到托管库；②每张表、每一列从哪来，要么是 `_ops` 里的现有文件，要么是 supabase/auth 某个 tag 下的某个迁移文件。
     - 回放脚本只管怎么跑：按迁移顺序 `\i` 这些文件；断言当前角色是 postgres 的迁移改用 postgres 连接；没有顶层 BEGIN 的迁移由脚本包一层事务。这几条改动同步写进 RUNBOOK §5.1，保证脚本和文档一致。
     - 必须验证回放能失败：跑通以后，从新 bootstrap 里删掉一列必需的列再跑一次，回放要在预期的那条迁移上报错。两次的日志都留下。
     - `supabase/migrations/` 里已有的文件一个都不改；两份 manifest 里已有的行不动。
     - 新文件提交之后最多再试 3 次。还到不了 181/181，就再次转【跳过】，在最终报告里写清停在哪条迁移、还缺什么。
     - 跑通之后按原有依赖往下做：P2.5 → P2.8、P2.9、REGION.2 → P2.10，HOME.2 → HOME.3 → HOME.5。还依赖 Eric 其他事项的任务照旧等。
  3. **P1.6 剩下的跨大版本升级，单独准备一个草稿 PR，合不合由 Eric 定。** 这条取代 D-43 第 2 项里「跨大版本仍然【跳过】」的说法，只限下面两组 overrides，其他新增依赖仍然【跳过】。
     - 分支 `codex/deps-crossmajor-20261113`，从 #371 的 head 切出，PR 的 base 设成 `codex/config-fixes-20261112`，diff 里只有两组改动：
       - `app/package.json` overrides 里的 @intlify/core-base、message-compiler、shared、vue-devtools 一起抬到 11.4.14 或更高；
       - glob 抬到 14.0.2 或更高，minimatch 抬到 11.0.1 或更高。
     - 验证（都在容器里跑）：
       - 全量 install、typecheck、h5、mp、test、smoke 都通过；
       - `npm audit --audit-level=moderate` 只剩例外清单里的 vite；
       - h5 和 mp 两份产物里，pages.json 的 `%key%` 全部被替换掉，产物里的中英文标题和用 #371 head 构建出来的逐条一致；
       - Sentry 插件不配 token，只确认构建时插件能加载、不报错。
     - 上传 source map 那一步验证不了，写进 PR 描述和最终报告。PR 不转 ready，不合并。
  4. **报告：** 三件事都做完或都停下以后，在 `appendix/batch/FINAL.md` 末尾加一节「第二批（D-44）」，按同样的八节格式，只写新增的内容。STATUS 里的 `latest_batch` 不变。
  5. **续跑：** 用 create_goal 重新设一个目标，范围就是本条这三件事。额度照 D-43 第 6 项。

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

### D-34 新 logo
- 现状：生产 logo 是 app/src/static/logo-mark.svg 的宋体「集」字印章（暗色为 logo-mark-dark.svg）。design/direction-a.html 的「玉」字印章沿用「集」印章的几何，用系统宋体的 `<text>` 渲染；替换生产文件之前必须转成轮廓路径。
- 选项：BRAND.4 出的 3 个印章稿（「玉」单字或「玉米地」三字）三选一。
- 建议：「玉」单字。24px 的 tab 图标和 favicon 上，三个字很难认（判断，看 BRAND.4 的 24px 预览再定）。
- 谁定：Eric。截止：BRAND.4。
- **D-43 代定（2026-11-13），Eric 可在最终报告后改**：选「玉」单字，用方案 B 的单字变体 `draft-b-mono.svg`（Noto Serif SC Black，字放大）。依据：BRAND.4 的 24px 预览里单字「玉」认得出（A 的横画偏淡，B 单字与 C 单字都清楚），三字稿 B、C 在 24px 下粘成一团；在两个清楚的单字里取宋体的 B，和 D-35 选定的 A 纸本书院、design/direction-a.html 的宋体印章一致（C 单字是黑体，24px 略更清楚，但风格不同）。对照图见 appendix/visual/logo/sheet-light.png、sheet-dark.png。撤回：在本条改选项，BRAND.4 ② 的替换提交 `git revert`。

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
