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

- **D-45 第二批核查后由 supervisor 定的事**（2026-11-13 07:45 CT，Claude（Eric 自己账号上的 supervisor 会话）按 D-43 定并写入）：依据是 Eric 2026-11-13 01:51 CT 原话「OK，你就继续弄就行了，自己的号作为supervisor控制」，以及 D-43「明显会批准的事直接做」。D-42 第 0 项的优先级不变，【硬】条照旧高于本条；Eric 看最终报告后可以改其中任何一项。背景：supervisor 对第二批报告做了独立核查（五个只读检查，再由本会话复核高风险项）。第 1 项是报告要改的地方，第 2–7 项是现在还能做、不需要 Eric 的事。
  1. **先改报告和 STATUS（只改文档）。** 每条先自己核实；核实不成立的不改，在 STATUS_LOG 写明理由。
     - ④⑥⑦ 关于 #372 冲突「取 #372」的说法是错的。`git merge-tree` 试合：#369×#372 冲突在 api/share-post.js、en.ts、zh.ts；#374×#372 另有 app.name / app.desc / app.tagline / app.formerly 一块。share-post.js 冲突块里 #369 一侧是 P2.9 的 topicTitle / headline 逻辑，en/zh 的 `suspended.sub`、`suspended.subPerma` 里 #369 一侧是 P2.2 的「回复 / reply」措辞，取 #372 会把这两项悄悄撤掉。改成：手工合，保留 #369 的逻辑和措辞，只取 #372 的品牌字串。
     - ④ 加一条，放在合并顺序前面：#369 合进 main 就是把前端发布到 illinimarket.com 生产。合之前必须先在生产应用 20261112120000 并跑它的 VERIFY（ENGINEERING §6），否则新前端按 POST_COLUMNS 查询会 400，社区页打不开；BACKLOG 还要求 #369 合并前 P2.13 通过。
     - ④ 里 #373「解锁 Boundary 只剩 vite」写准确：CI 的 `npm audit --audit-level=moderate`（ci.yml 第 187 行附近）没有例外清单，vite 6.4.4 的 moderate 还在，合了 #371、#373 以后 Boundary 照样红。让 CI 认例外清单要改 workflow，归 Eric。
     - ⑥「首页已按设计只编进 H5」不成立：SPEC §8 和 D-12 没有这条豁免，是 HOME.5 子任务为了主包预算做的取舍（L54 的「21 处与 SPEC 的出入」之一）。挪进 ③（标 [OMO自决]），④ 写成请 Eric 定的事；本条第 4、7 项先尝试补上。另外 20 处出入现在只在 tony-ws 的 evidence/HOME.5，摘进 STATUS_LOG。
     - 数字更正：HOME.5 合并后 smoke 总数（核查方数到 7 份 spec 共 79 条，83 可能把 community-post-topics 的 4 条算了两次）；③ L52「四份旧 spec」（a756081 实际改了 9 份）；L54「断言的行为不变」（P2.10 board-link 用例在 390/1280 上 URL、选中信号、搜索框三处断言都变了，390 上「搜索框为空」变成「搜索框不存在」加一次性计数）；P2.9 的 2022/2021 是在 bd6fee5 上量的；L47/L48 说 #369「随 bd6fee5 重跑」，但 run 43412348642 被取消；① 的起点时间按 24d141a / 5abcb86 的提交时间。
     - ④ 补漏：P2.5 DoD ④ 生产那一半由 Eric 核；E4 应用迁移后 VERIFY_20260718_reconcile_app_table_acl_boundaries 会报预期内的 posts 列漂移（L46），提前写给 Eric；L49 暗色侧栏「发布」按钮对比度 2.87:1；#369、#371 合并后删分支之前，先把 #374、#373 的 base 改成 main（删 base 分支会把依赖它的 PR 关掉，且不能重开）；④ 按解锁任务数从多到少排（D-42 第 10 项）。
     - STATUS.md 过期处：CI 表的 Boundary 计数（run 43422815812 实际 2044/2043/0/1）；「首页分支没建」；「~/work/illini 在 be2ebb6」；P2.8「本地提交」（46e69b8 已推送）；「上一次 run」的标号；BRAND.7 写的 D-35 阻塞（实际等 HOME.4）；P2.13 还等 E5（P1.8）；「其余 job success」改成 4 个 success、2 个 skipped。
     - STOP-16a：P2.8 把 SPEC §11 的 6 个 key 改了名（draftCloseTitle→closeComposer 等），STATUS_LOG 没记。按第 5 项改回 SPEC 的名字。
     - L44–L54 的 [OMO自决] 按 D-42 第 3 项补齐标签、依据条款和撤回命令；L44 补记归档 lsql-replay.sh 的 sha256（RUNBOOK §4 ⑤）；L45 补记 path-scurry 下 lru-cache 11.3.5→11.5.3。
  2. **PR 文案。** 只用 `gh pr edit` 改标题和描述，不转 ready。#369 的描述还是 V4 时的，按 P2.13 DoD ① 改成已完成任务清单加 STATUS 链接；#374 的标题改成覆盖 P2.12、HOME.3、HOME.5；#373 标题和描述里的 `@intlify` 加反引号（裸写 @ 会通知 GitHub 上的 intlify 账号，10:01Z 已经通知过一次）。以后 PR、提交说明里的包名一律加反引号。
  3. **本地集成试合，不推送。** 在 tony-ws 上建一个只在本地的分支（不推送、不开 PR）：#373 head（含 #371）＋ #374 head（含 #369）＋ #372 head，按第 1 项的规则手工解冲突。跑全量 install、typecheck、test、h5、mp、smoke，用仓库的 verify-build-artifact.mjs 量小程序主包字节数，结果写进 STATUS_LOG 和报告。目的：确认合并顺序，并量出五个 PR 都合上以后的主包余量（现在的 4,056 字节只算了 #369＋#374）。
  4. **小程序主包腾空间，单独开草稿 PR。** 分支 `codex/community-mp-budget-20261113`，从 #369 head 切出，base 设成 `codex/community-topics-20261112`。优先用不改页面路径的办法：主包里的大图和静态资源、只被分包用到的组件和代码挪进分包、去掉没用到的东西。要移动页面路径时，H5 和小程序的旧链接（SPEC §4.5、分享卡、邮件里的链接）都必须还能打开，做不到就不移。tab 页留在主包（verify-miniprogram.mjs:42）；不加新依赖。目标：主包余量至少 64 KiB；做不到就写清最多能腾出多少、卡在哪。
  5. **代码对齐 SPEC §11（D-17 常规工作）。** 核查方拿 68eb43b 对 SPEC §11 比出 26 行不一致或缺失。按 SPEC 改代码，不改 SPEC：补上缺的 key（plaza.publishing、uploadingImages、restrictedPost）；plaza.posted、plaza.notFound 按 SPEC；P2.8 改过名的 key 改回 SPEC 的名字；#374 的「关注的人」tab 按 SPEC §6.2，文案用 SPEC 那两句，列表放关注的人发的帖子，不是关注的人名单。「关注的人发的帖子」如果要新迁移，停下记进 ④，不建迁移。认为 SPEC 本身写错的（例如 L49 的 ref.more），代码先照 SPEC，理由记进 ④ 由 Eric 定。#369 范围内的 key 在 #369 改，首页部分在 #374 改。每次改完量一次主包。
  6. **HOME.4。** 依赖 HOME.3、HOME.1 已通过，D-35 已定 A，按 BACKLOG §0.1 现在就能做。在 #374 分支上做，DoD 照 BACKLOG。
  7. **小程序论坛首页（D-12）。** D-12 要求 H5 和小程序同一天上线。第 4 项腾出空间后，把论坛首页、新页头、板块页补进小程序，放在 #374；空间不够就停，写进 ④。
  8. **不做：** 不改 `.github/workflows/`（ubuntu-26.04 runner 上 Playwright 1.60 装不上浏览器、audit 例外清单，这两件归 Eric）；不改 SPEC；不合并、不转 ready、不 force push、不 rebase 已推送的分支；20261112120000 一个字节都不动；不新建迁移。
  9. **顺序和报告：** 1 → 2 → 3 → 4 → 5、6 → 7。每项最多试 3 次，过不了就转【跳过】，写清停在哪。全部做完或停下以后，在 FINAL.md 末尾加一节「第三批（D-45）」，八节格式，FINAL 和 STATUS 放在同一个提交（D-43 第 5 项）。用 create_goal 设新目标，范围是本条第 1–7 项，并在 STATUS_LOG 记下目标已设。额度照 D-43 第 6 项。

- **D-46 第三批核查后由 supervisor 定的事**（2026-11-13 11:40 CT，Claude（Eric 自己账号上的 supervisor 会话）按 D-43 定并写入）：依据同 D-45（Eric 2026-11-13 01:51 CT 原话「OK，你就继续弄就行了，自己的号作为supervisor控制」，D-43「明显会批准的事直接做」）。D-42 第 0 项的优先级不变，【硬】条照旧高于本条；Eric 看最终报告后可以改其中任何一项。背景：supervisor 对第三批报告做了六个只读核查（分支完整性、CI 与 PR、报告一致性、测试与 SPEC §11、条件编译、主包重测）。分支没被改写，禁区没碰，20261112120000 的 sha256 没变，两个 merge 没丢改动，主包数字能复现（差 91 字节，见第 1 项）。D-45 第 7 项按完成算：1.5 MiB 硬预算守住了；64 KiB 的余量要求改由本条第 4 项、按五个 PR 合上后的集成构建去达成。第 1–2 项是报告和 PR 文案要改的地方，第 3–6 项是现在还能做、不需要 Eric 的事。
  1. **报告和 STATUS（只改文档）。** 每条先自己核实；核实不成立的不改，在 STATUS_LOG 写明理由。
     - 第三批 ④ 自相矛盾：「五个 PR 都合上后约 57 KiB」是 L58 在第 7 项之前的估算，删掉；「22,230 字节」只含 #369＋#375＋#374，不是五个 PR 的数，改标签。五个 PR 的数用本条第 5 项重测的结果。#375 描述里的「约 57 KiB」一起改。
     - #375 的 base 也是 `codex/community-topics-20261112`。删 #369 分支之前要先把 #374、#375 的 base 都改成 main；STATUS 第 12 条、④、⑦、#369 描述现在只写了 #374 / #373。另写明：#369 如果 squash 合并，改完 base 以后 #374、#375 要再 merge 一次 origin/main。
     - #372 冲突图过期：`git merge-tree` 86ffd0e × ba070e7 现在还在 app/src/pages/plaza/index.vue 冲突（c16f0a1 删了「关注的人」名单，#372 的 BRAND.3 徽章改的正是那一段）。手工合并规则补上这一处怎么处理。
     - D-45 第 5 项没有全部完成：SPEC §11「HOME.3 首页」节有 11 个 key 不在语言包（home.weekNew、collapsed、fillPrefix、firstPost、typeGuide、typeRules、events、allEvents、market、marketNew、marketFill），文字写死在 utils/communityHome.ts，英文和 SPEC 不同；plaza.boardDesc.<slug>、plaza.boardAsk.<slug> 也不在语言包。② 的 D-45.5b 先改成「部分」，第 3 项 e 做完再改回。
     - STATUS 又过期了：run 43448423151 的 Boundary 是 2053 / 2052 / 0 / 1（表里还是 2044）；「上一次 run」应为 43422815812；表头时间和 docs_sha；~/work 下各 worktree 的 head；BRAND.7 的依赖（BRAND.1/3/4、P2.2、HOME.4、P1.13）都已做完，只等合并，写清楚等哪几个 PR。
     - ② 的措辞：D-45.5a「其余通过」改成 4 个 success、2 个 skipped。D-45.5b「7 个 key 待服务端」拆开写：ref.removed、ref.unlink、hidden、hiddenOwner、appeal 要服务端（SELECT 策略或 RPC）；restrictedReply、restrictedPost 只要拆 App.vue 门禁（本条第 3 项 f）；emptyUnanswered 随 P3.4。restrictedPost 现在是提交失败以后的 toast，SPEC §6.5.1 要求不打开面板。L56「三个标题都换了」不对，#369 没改名。L60「新增 14 个 key」实为 13 个（ref.more 原来就有，只改了英文）；「两条单测」实为三条，还有 read-failure-states.spec.ts 里的一条 Playwright 用例。
     - ⑥「H5 截图逐字节不变」写准确：86ffd0e 在 CommunityHeader.vue 给手机页头加了一层不带条件编译的 `cx-regions`，H5 的 DOM 变了，像素应当不变。⑥「首页 9 个并发请求，微信上限 10」漏了小程序上一直挂着的 inbox 长轮询和每 20 秒一次的通知轮询：登录用户会到 10 个，碰上通知轮询到 11 个（本条第 3 项 c 处理）。
     - ⑧ 的撤回办法：4a3cbe6 已经由 fb9c6b9 合进 #374，「关闭 #375」撤不掉 #374 里的那一份。再写明 revert 合并提交的坑：以后 #375 单独合进 main 的话，#374 上的 `git revert -m 1 fb9c6b9` 会在 #374 合并时把 #375 的改动再删一次。
     - [OMO自决] 补齐：L56 标题缺标签、依据条款和撤回命令；「#374 合入 #375」没有 STATUS_LOG 编号；L59、L60 的依据写成 BACKLOG §14 第 28 行（那一行说以源码为准，意思正相反），实际依据是 D-45 第 5 项；L61 保留 26 / 16px、没按 SPEC 的 22 / 15px，这处出入写进 ④。第三批 ④ 按解锁任务数排序；① 的起点用 f8e2b97 的提交时间 07:39 CT。
     - 主包以后一律用 CI 的 build-mp-weixin 环境量（ci.yml 301–303 行，`https://ci-stub.supabase.co`）。第三批的数是用 H5 job 的 stub URL 量的，每个主包数比 CI 环境多 91 字节；表里注明环境，或者按 CI 环境重写。
     - 第三批没提 #370 在 f43bdd1 上的 CI 红（run 43470604328：ubuntu-26.04 上 Playwright 装不上浏览器，和 main 同一个基础设施问题，归 Eric）。补进 ⑥。
  2. **PR 文案。** 先用 `gh pr edit`，不行就照 L56 用 REST PATCH（只传 title、body），不转 ready。#369 描述按 b7bcf3a 更新：任务表加 D-45.5a 那一行，最新 run 写 43448423151，提到 #375，删分支前要改 #374 和 #375 的 base。#374 描述上半部分和后加的「D-45 更新」互相矛盾（「只编进 H5」「余 4,056」「diff 里只有三件事」），整篇按现状重写，标题补上 HOME.4 和小程序首页。#375 描述按第 1 项改余量。#371 描述里的 `@playwright/test`、`@intlify/*` 加反引号。
  3. **代码修复（D-17 常规工作）。** 每条先写一个修复前会失败的测试（带对照），确认问题存在再改；核实不成立就不改，写进 STATUS_LOG。每次改完用 CI 环境量一次主包。
     - a. **小程序非 tab 页没有消息和通知提醒（4a3cbe6 引入，在 #375 修，再 merge 进 #374）。** AppSidebar 在小程序上原来只靠 CSS 隐藏，组件照样挂载，setup 里的 useUnread()、useNotifications() 就是会话级消息和通知监听的启动点。4a3cbe6 把它包进 `#ifdef H5` 以后，小程序上 detail、post、seller 等非 tab 页没有地方再启动这两个监听；从分享卡直接打开商品页的用户，进任意 tab 页之前收不到新消息提示。修法例如在小程序上一次性启动这两个监听；不能把 AppSidebar 加回主包。
     - b. **小程序 showModal 的英文按钮（在 #369 修，再 merge 进 #375、#374）。** plaza/index.vue 关闭发帖面板的弹窗用 confirmText 'Keep draft'、cancelText 'Discard'。微信 showModal 的按钮文字最多 4 个字符，超长时整个弹窗调用失败（本仓库 2026-07 的小程序审计踩过）。先查微信官方文档确认，再把社区相关代码里所有 showModal / showActionSheet 的中英按钮文字查一遍。小程序上换成不超长的交互（例如 showActionSheet），H5 照 SPEC 不动；SPEC 文字在小程序上实在放不下的，写进 ④ 请 Eric 定。
     - c. **首页并发请求（在 #374）。** useCommunityHome.ts 一次并发 9 个请求，加上 /api/realtime-poll 长轮询和通知轮询，登录用户在小程序上会到 10–11 个，微信 request 并发上限是 10。把首页同时在飞的请求压到 6 个以内（分两批，或者把 5 个板块的 feed 并成一次查询），H5 显示结果不变。
     - d. **「关注的人」帖子流（在 #374）。** 现在切到这个 tab 先 await loadMyFollowing，期间上一个 tab 的全站帖子挂在「关注的人」下面；读关注列表失败时没有递增 latestRequestId，上一个 tab 还在飞的请求落地后会把全站帖子填进来。改成切 tab 时先清空帖子、作废旧请求。另外查询前先去掉已屏蔽的用户（useFollow.fetchFollowingFeed 已经这样做），避免一整页都被过滤掉时显示「你关注的人还没有发帖」而 hasMore 仍为 true。
     - e. **SPEC §11「HOME.3 首页」节和板块文案进语言包（在 #374，D-45 第 5 项的剩余部分）。** 第 1 项列的 11 个 home.* key，以及 plaza.boardDesc.<slug>、plaza.boardAsk.<slug>，中英文按 SPEC §11。认为 SPEC 写错的，代码照 SPEC，理由进 ④。
     - f. **受限账号门禁按 SPEC §6.5.1 拆开（在 #369，再 merge 进 #375、#374）。** 现在 App.vue:150-167 把所有有效的 suspension 都送去 pages/suspended。按 SPEC §6.5.1：受限账号可以浏览，回复时提示 restrictedReply，发帖时在打开面板之前 toast restrictedPost；永久封禁照旧去 pages/suspended。开工前先确认服务端已经拦住受限账号的写入（触发器或 RLS）；没拦住就停，写进 ④，不建迁移、不改 RLS。每一级 suspension 都要有测试。
  4. **主包第二轮腾空间。** 目标：五个 PR 都合上以后（第 5 项的集成构建）主包余量至少 64 KiB。办法同 D-45 第 4 项：优先不改页面路径，只被分包用到的代码和组件挪进分包，去掉没用到的东西；tab 页留在主包，不加依赖。在 #375 上做，再 merge 进 #374（只 merge，不 rebase）。做不到就写清最多腾出多少、卡在哪。
  5. **按当前 head 重做本地集成试合，不推送。** 第 3、4 项做完以后，用 #373、#374 最新 head、#372 重新试合，按第 1 项更新后的规则手工解冲突（含 plaza/index.vue），跑全量 install、typecheck、test、h5、mp、smoke，用 CI 的 mp 环境量主包。这个数写进 ④，作为「五个 PR 都合上后」的余量。
  6. **BRAND.7。** 依赖都已做完，只是分散在没合并的 #372、#369、#374 上。按 BACKLOG 里 BRAND.7 的 DoD 判断：能在一个现有分支上做、不需要把 #372 合进别的 PR 分支，就做；做不了就在 STATUS 写清它等哪几个 PR 合并，列进 ⑦。
  7. **不做：** 同 D-45 第 8 项：不改 `.github/workflows/`，不改 SPEC，不合并、不转 ready、不 force push、不 rebase 已推送的分支，20261112120000 一个字节都不动，不新建迁移，不改 RLS 和服务端函数。
  8. **顺序和报告：** 1 → 2 → 3a → 3b → 3d → 3c → 3e → 3f → 4 → 5 → 6。每项最多试 3 次，过不了就转【跳过】，写清停在哪。全部做完或停下以后，在 FINAL.md 末尾加一节「第四批（D-46）」，八节格式，FINAL 和 STATUS 放在同一个提交。用 create_goal 设新目标，范围是本条第 1–6 项，并在 STATUS_LOG 记下目标已设。额度照 D-43 第 6 项。

- **D-47 D-46 中途核查后由 supervisor 补的事**（2026-11-13 13:30 CT，Claude（Eric 自己账号上的 supervisor 会话）按 D-43 定并写入）：依据同 D-46。D-46 照旧有效，本条只做补充；【硬】条照旧高于本条，Eric 看最终报告后可以改其中任何一项。背景：supervisor 对 D-46 第 2 项和 3a、3c、3d、3e 做了六个独立核查：每个修复的测试拿到父提交上跑，做了变异测试，按 CI 环境量了主包，查了 PR 文案。四个修复功能都对，修复前测试都会失败；分支没被改写，禁区没碰。下面是要补的地方。
  1. **执行顺序和 STATUS（只改文档）。**
     - 3d（17:59Z）、3c（18:30Z）比 3a（18:38Z）先提交，3b 到现在没推送。STATUS_LOG 没记顺序变了，`next_task_id` 从 3b 直接跳到 3f。按 D-42 第 3 项补一条 [OMO自决]，写清哪几项并行、为什么、3b 现在停在哪。`next_task_id` 按 BACKLOG §0.1 第 2 条，取第一条没完成的任务。以后可以并行，但同一个分支同一时间只让一个子任务推送；顺序一变当场记。
     - 3a 的后半「再 merge 进 #374」还没做，#374（6d6c598）里仍带着 4a3cbe6 的回归。可以和第 4 项一起 merge，但 merge 之前 STATUS 要写明 #374 还缺 3a。
     - STATUS.md 每做完一项都要按 RUNBOOK §8 第 4 步整篇改写。现在表头还是「写于 11:39 CT」，docs_sha 还是 35dabd8，#374、#375 的远端和 worktree head 还是 86ffd0e / 4a3cbe6，HOME.5 行和阻塞第 13 条的主包还是 1,550,634（H5 stub 的数）。主包一律写 CI 环境的数。
     - FINAL ② 的 D-45.5b 行：状态改成了通过，同一行却还写着「还没进语言包（D-46 第 3 项 e）」。改掉这句，并写清还没接上的 key 剩哪些、各自等什么。
     - D-46 第 1 项写错了一处：「7 个 key」后面列了 8 个名字。plaza.restrictedPost 是 b7bcf3a（#369）加的，不在 c16f0a1 新增的 13 个里。引用这句的地方（④、D-45.5b 行、L60 的更正、#374 描述）改成 8 个，或者把 restrictedPost 单独写。
     - 「HOME.3 首页」节的 key 数，L64 写 28，L69 写 29。SPEC 表是 29 行（含 LEGAL.1 后才启用的 home.aboutBodyCaaci），统一写 29。
     - #370 在 5f66faa、08f036c、bd397ce 上又红了三次（run 43475385858、43484767294、43487337489），原因和 43470604328 一样，都是 ubuntu-26.04 上装不上 Playwright 浏览器。补进 ⑥。
     - L69 写「没有与 SPEC 的分歧」不对，见第 2 项 a。
  2. **3e 补完（在 #374）。**
     - a. 英文补位行少了分隔符。SPEC §7（SPEC.md 第 879 行）是「Good for: {topics} · Post the first one ›」，代码拼出来是「Good for: … Post the first one ›」，新测试钉住的正是这个不合 SPEC 的串。中文照 SPEC：「适合在这里问：{补位话题} 发第一帖 ›」。代码和测试一起改。
     - b. home.typeGuide、home.typeRules 进了语言包，但没有地方用。SPEC §5.2 S1 要求「新来先看」每行标题前加 12px 类型标签「守则」或「指南」，现在只渲染了标题。按 SPEC 补上（手机 §5.3 ④ 同样处理）。一条帖子算守则还是指南按 SPEC 判断，SPEC 判断不了就写进 ④。
     - c. home.events、home.allEvents 没有地方用，这是对的：近期活动区块依赖 P4.8（SPEC §5.2 S2、§5.3 ⑤ 和第 374 行）。在 STATUS 写明这两个 key 等 P4.8，现在不做活动区块。
     - d. 新的语言包测试对照的是手抄进测试文件的 SPEC 表，不是 SPEC.md（代码分支上没有 SPEC.md）。测试可以保留；在测试文件开头写明抄自哪一版 SPEC §11（docs_sha），并在 STATUS_LOG 写明：SPEC 改了要同步改这张表。
  3. **3c 补完（在 #374）。**
     - a. 并发上限只有小程序需要。H5 首页现在要多等一轮网络往返（原来一轮出结果，现在两轮）。把六个的上限改成只在小程序上生效，H5 照原样一次发出。平台判断用仓库已有的写法；在 .ts 里用条件编译时，块里声明的东西不许在块外用。两个平台各要有测试。
     - b. 作废的旧请求还在排队。clearHome() 或再次 loadHome() 以后，上一轮排着的请求照样发出去，而且排在新一轮前面；核查方的探针显示新一轮因此从两轮往返变成三轮。拿到槽位时如果这一轮已经作废，就不发请求，直接把槽位交给下一个。
     - c. 测试补三条，每条先在故意改坏的代码上确认会红：读失败或抛错时槽位会还回去；回帖查询也走槽位；两个 useCommunityHome() 实例共用六个槽位。
     - d. D-46 第 3 项 c 的前提算少了，把更正写进 ⑥：小程序上两个轮询在每次对账时各有 2 个并发请求（收件箱对账是 refreshUnreadCount 加 runConversationRefresh，通知对账是列表加计数）。登录用户停在首页时，稳态最坏是 6＋2＋2＝10，正好到微信上限；碰上 App.onShow 的资料刷新会到 11。微信基础库 3.8.10 起，超过并发上限的请求会排队（wx.request 文档里 RequestProfile 的 queueStart、queueEnd）；更老的基础库可能直接失败，而 manifest 没设最低基础库。这件事写进 ④ 的手动验证清单，由 Eric 在开发者工具里看；不加全局限流器。
  4. **3d 测试补两条（在 #374）。** 每条先在父提交 86ffd0e 上确认会红：关注的人全被我屏蔽时，不发帖子查询，hasMore 为 false，显示 SPEC §6.2 对应的空态；关注列表读成功以后按这些人查帖子。现在的桩里 loadMyFollowing 从不把 followingLoaded 设成 true，三条相关用例走的都是失败分支。另外，读关注列表失败那一处的 invalidatePosts() 没有测试钉住；补一条，或者在 STATUS_LOG 写明为什么不需要。
  5. **3a 的副作用交给 3f 一起看。** 3a 以后，小程序冷启动直接进 suspended、reconsent、profile-recovery、onboarding、welcome、login 的登录用户也会开始收消息和通知，新消息 toast 和通知横幅可能盖在 suspended、reconsent 页上。做 3f 时按 SPEC §6.5.1 判断这些页面该不该出提示；不该就在这些页面不弹（监听照开）。每一级 suspension 都要有测试。
  6. **主包。** 核查方按 CI 环境把 #374（6d6c598）和 3d24a8e 试合：主包 1,551,949 字节，余 20,915。离 D-46 第 4 项的 64 KiB 还差 44,621 字节，这还没算 #369 上的 3b、3f 和 #372、#373。这一轮四个修复一共加了 1,406 字节，其中 3e 占 937。第 4 项照常做；本条第 2、3 项做完各量一次。
  7. **PR 文案。** #374、#375 的描述是 17:40Z 改的，之后代码又推了三次，描述「已知问题」里列的并发、关注帖子流、11 个 key、AppSidebar 监听都已经修了。本批收尾、写 FINAL 之前，按当时的 head 把 #369、#374、#375 的描述再对一遍，照旧不转 ready。#370 描述还写着「D-01 至 D-41」，一起改。
  8. **顺序和报告：** 第 1 项在下一次写 STATUS 时做。第 2–5 项排在 3f 之后、D-46 第 5 项（集成试合）之前；第 4 项（腾空间）照常进行。第 7 项在收尾时做。每项最多试 3 次。目标范围扩到 D-46 第 1–6 项加本条，在 STATUS_LOG 记一笔。「第四批（D-46）」报告里，本条各项单独成行。

- **D-48 3b、3f、第 4 项核查后由 supervisor 定的事**（2026-11-13 14:10 CT，Claude（Eric 自己账号上的 supervisor 会话）按 D-43 定并写入）：依据同 D-46。D-46、D-47 照旧有效，本条只做补充；【硬】条照旧高于本条，Eric 看最终报告后可以改其中任何一项。背景：supervisor 对 3b（3588c24）、3f（520e55a）、第 4 项（8972507、1443d5c、ecc330b）和 D-47 第 1 项的文档做了五个独立核查。其中一项在本机 PG17 上载入迁移里的真实函数体，用 L0–L5 账号逐个跑了写入。第 4 项超额完成；3b 要改一处；3f 要撤回门禁放开的那一半。
  1. **3f：撤回 App.vue 门禁的放开（在 #369，最先做）。** D-46 第 3 项 f 的前提是：服务端已经拦住受限账号的写入，没拦住就停。L71 只核对了 posts、post_comments、items、messages 四个 BEFORE INSERT 触发器，可 520e55a 放开的是整个 app，不只是社区。核查方实测，有效级别 L2–L4 的账号做下面这些写入，服务端都不拦：
     - 商品会话 INSERT（20260916050227 第 58–62 行只在 is_direct 时查限制）；
     - make_offer、respond_to_offer（报价附言最多 300 字，会给卖家发通知）；
     - propose_meetup、respond_to_meetup、reschedule_accepted_meetup（地点和附言，会发通知，并经 /api/meetup-notify 发邮件）；
     - submit_transaction_rating（公开评价，最多 500 字）；
     - items UPDATE（改已有商品的标题、描述、价格、图片；降价会把新标题推给收藏的人）；
     - profiles UPDATE、头像上传、follows、post_likes、post_comment_likes（后三个会给对方发通知）。
     等于给受限账号开了一条私信通道，和服务条款 L2「不能发帖、发消息、上架」、suspended.sub 的文案都矛盾。另外，L2–L4 从此没有入口进 pages/suspended，看不到限制详情，也用不了应用内申诉；已经停在 pages/suspended 的 L2–L4 用户会卡在那一页。
     改法：在 #369 上用一个新提交，把 requiredGatePath() 恢复成 3588c24 的样子，所有有效的 L2–L5 都去 pages/suspended；然后照常 merge 进 #375、#374。520e55a 已经随 30c4b4d merge 进了 #375，不要在 #375 上 revert 那个 merge 提交：以后 #369 合进 main 时，那个 revert 会把 #369 的改动再撤一次。plaza、post 里「打开面板之前拦」和回复栏的受限提示可以保留：L2–L4 暂时走不到，以后放开时用得上。community-restricted-account.test.mjs 按恢复后的行为改，L2–L5 每一级都断言去 pages/suspended，过期的 L2–L5 一切正常；先确认改后的测试在 520e55a 上会红。不建迁移，不改 RLS。
     写进 ④ 请 Eric 定两条路：一是先用新迁移在服务端拦住上面这些写入，再按 SPEC §6.5.1 让受限账号浏览；二是只放开社区几页，其余页面照旧挡住（只靠客户端，服务端照样不拦）。附上写入路径表；supervisor 的核查结果只作线索，OMO 自己逐条再核一遍再写。③ 里给 L71 记一笔更正：前提只核对了四个 INSERT 触发器。FINAL ② D-45.5b 行写明 restrictedReply、restrictedPost 代码已接上，但撤回门禁以后 L2–L4 暂时看不到。
  2. **3b：操作菜单的标题没显示（在 #369）。** uni-app 小程序运行时（@dcloudio/uni-mp-weixin 3.0.0-4080420251103001，dist/uni.api.esm.js 第 1161–1164 行）对 showActionSheet 有参数映射 `toArgs.alertText = fromArgs.title`，调用方自己传的 alertText 会被覆盖成 undefined。所以 3588c24 的操作菜单在任何基础库上都没有「关闭发帖面板？」这个标题，只剩「保留草稿 / 不保留 / 取消」，不合 SPEC。改成传 `title`。测试要能抓住这一点：现在删掉 alertText 那一行，8 条照样全过。
  3. **#369 merge 进 #374 有冲突。先做完第 1、2 项再 merge。** 核查方试合 6d6c598 × 520e55a，四个文件冲突：plaza/index.vue、post/index.vue（3 处）、community-board-deeplink.test.mjs、community-post-topics.spec.ts。en.ts、zh.ts 会自动合并，但 plaza.restrictedReply 各出现两次，typecheck 报 TS1117。L71「如果冲突取同一个值」的预判不对；STATUS 第 11 条补一张 #369→#374 的冲突图。#374 的 openComposer(board?) 和它新加的六个入口也要带上 #369 的拦截。merge 完跑 community-restricted-account、community-mp-dialogs 和全量检查。
  4. **第 4 项收尾（在 #375）。**
     - 目标已达到。核查方按 CI 环境试合（没推送）：#375 单独余 250,545 字节；#374＋#375 余 201,481；#375＋#369 余 248,614。STATUS 阻塞第 13 条和试合行里的「还差 44,621」改掉。五个 PR 都合上的数等 D-46 第 5 项。
     - mini-program-subpackage-routes.test.mjs 第 6 条（分包里的代码只从本分包引用）在 3d24a8e 上只因为对照断言而红，没证明过能抓到真正的跨包引用。做一次变异：在主包页面 import 一个分包里的模块，确认这条会红。L73「修复前 1 条失败」实为 2 条，更正。
     - pages.json 新加的注释把 chat 写成「app 自己会打开的页面」，不对。chat 留在主包，是因为它只是 ChatThread 外面 2 KB 的壳。改注释。
     - 没有 preloadRule：login、search、notifications、settings、legal 等页第一次打开要先下载分包，下载失败没有提示。写进 ④ 的手动验证清单，由 Eric 在开发者工具里看；现在不加。
  5. **范围外的 showModal 英文按钮（只记录）。** 核查方查了全 app：main（已在生产）上 index/index.vue:887 的「Got it」、:949 的「Restore」「Cancel」，detail/index.vue:1204、profile/index.vue:766 的「Messages」，都超过 4 个字符，小程序上走得到。微信文档只写「最多 4 个字符」，没说英文怎么数，也没说超长时是整个弹窗失败还是截断。写进 ④：请 Eric 在开发者工具的英文环境点一次，确认会失败再修。
  6. **文档。** STATUS 的 docs_sha 还是 81196fa；按 RUNBOOK §8 第 2 步，应当是本次写回之前材料分支的 HEAD。
  7. **顺序：** 1 → 2 → 3 → D-47 第 2–5 项 → 本条第 4 项 → D-46 第 5、6 项 → D-47 第 7 项。每项最多试 3 次。目标范围加上本条，在 STATUS_LOG 记一笔。「第四批（D-46）」报告里，本条各项单独成行。

- **D-49 受限账号按通行做法处理：先在服务端拦住写入，再放开浏览**（2026-11-13 14:20 CT。Eric 2026-11-13 14:11 CT 对 D-48 第 1 项两条路的原话：「这个你按照一般标准来吧」。supervisor（Claude，Eric 自己账号上的会话）据此选第一条并写入）：限制如果只靠客户端挡，绕过客户端的人就等于没被限制；常见平台的临时限制（只读模式）都是服务端拒绝写入，客户端只负责提示。D-48 第 1 项「写进 ④ 请 Eric 定两条路」改为：Eric 已定，按本条做。【硬】条照旧高于本条。
  1. **D-48 第 1 项照做。** #369 恢复成所有有效的 L2–L5 都去 pages/suspended。#369 按原计划上线，不等本条。
  2. **本条另开一个草稿 PR。** 分支 `codex/community-restricted-20261113`，从 D-48 第 1、2 项做完后的 #369 head 切出，base 设成 `codex/community-topics-20261112`（#369 合进 main 以后改成 main，写进 ⑦）。本条第 3–5 项都在这个分支上做。D-45 到 D-48 的「不新建迁移」只对这个分支解除，而且只限本条的一个新迁移；其余分支照旧。不改已经存在的迁移，20261112120000 一个字节都不动，不改 `.github/workflows/`，不改 RLS 以外的权限模型。
  3. **迁移：有效级别 L2–L5 的账号，服务端拒绝下面这些写入。** 用现有的 moderation_private.current_profile_state（或 is_posting_allowed）判断，报和 trg_enforce_actor 同样的错误 `suspension_active:<level>:<until>`。
     - 要拦（会被别人看到或通知到别人）：商品会话 INSERT（is_direct 以外那一支）；make_offer、respond_to_offer（含还价）；propose_meetup、respond_to_meetup、reschedule_accepted_meetup；submit_transaction_rating；follows INSERT；post_likes、post_comment_likes INSERT；items UPDATE 中改内容的列（标题、描述、价格、图片、位置、分类、listing_details、negotiable、condition）以及把商品重新上架；客户端能改内容的 posts、post_comments UPDATE；profiles UPDATE 中公开显示的列（昵称、简介、状态、位置、头像）；item-images 存储桶上传。
     - 照旧允许：所有读；删自己的内容；把自己的商品下架或标为已售；举报、屏蔽、收藏、保存的搜索、隐藏、通知已读，会话的置顶、静音、已读和归档；submit_appeal；同意新版条款（record_consent）；注销账号；登录和邮箱相关。
     - 动手前，把 D-48 第 1 项的路径表当线索逐条核对，再自己从迁移里把所有写入路径过一遍，有遗漏的补进来；判断不了归哪边的写进 ④。
     - 迁移照 ENGINEERING §6 和 P2.5 的做法，配 PRECHECK、VERIFY、REGRESSION，在本地 L-SQL 环境重放。REGRESSION 要覆盖：L0、L1 和过期的 L2–L5，每条写入都成功；有效的 L2–L5，每条要拦的写入都报 suspension_active，每条照旧允许的都成功。迁移定稿后算 sha256 冻结，记进 STATUS_LOG。应用到 staging 和生产都归 Eric，列进 ④ 和 ⑦。
  4. **客户端。**
     - App.vue requiredGatePath()：只有有效的 L5 去 pages/suspended，L2–L4 可以浏览（即 520e55a 的改法）。
     - L2–L4 要能在 app 里看到限制详情、用到申诉：加一个不挡操作的提示条，点开进 pages/suspended；pages/suspended 对 L2–L4 要有回首页的路，不能卡住。文字用 SPEC §6.5.1 和 §11 已有的 key；SPEC 里没有的文字写进 ④，代码先用最接近的 SPEC 文字。
     - 第 3 项拦住的那些入口（聊天发送、报价、约见、评价、发布和编辑商品、改资料、关注、点赞），客户端先拦一道：提示受限和恢复日期，不让用户填完表单、传完图片才失败。服务端照样拦。
     - utils/index.ts 把 suspension_active 映射成 SPEC 的「账号受限」文字并带恢复日期；不再当 error 报 Sentry；聊天发送被拒时不显示「点击重试」。
     - L0–L5 和过期的每一级都要有测试，先在修改前的代码上确认会红。
  5. **上线顺序。** 本 PR 的迁移要先在生产应用并跑通 VERIFY，前端才能合；顺序反过来，就会出现「客户端放开了、服务端还没拦」的空档。这一条写进 ④、⑦、PR 描述，并按 RUNBOOK 现有的「Schema-coupled release order」一节补一条上线检查项（2026-08 那次 consent 版本和迁移不同步，把全站锁死了几个小时）。
  6. **顺序：** 本条排在 D-48 全部和 D-47 第 2–5 项之后、D-46 第 5、6 项之前。第 3 项在本地 L-SQL 重放过不了，就停下写清停在哪。目标范围加上本条，在 STATUS_LOG 记一笔。「第四批（D-46）」报告里本条单独一节。

- **D-50 小程序 showModal 按钮文字按微信基础库的实际规则算**（2026-11-13 14:45 CT。Eric 2026-11-13 14:11 CT 让 supervisor 去模拟，原话「这个你去模拟一下」；supervisor（Claude，Eric 自己账号上的会话）按结果写入）：开发者工具的服务端口在安全设置里，是关着的，supervisor 没去开，改为解开本机开发者工具缓存的基础库 3.15.0、3.15.1、3.15.2，读 WAServiceMainContext.js。开发者工具模拟器和手机都运行这份代码。三个版本的检查完全一样：`confirmText.replace(/[^\x00-\xff]/g,"##").length > 8` 时以「showModal:fail confirmText length should not larger than 4 Chinese characters」失败，弹窗不出现；cancelText 同理。也就是说，中文等非 ASCII 字符每个算 2，英文、数字、空格每个算 1，上限 8。拿这条规则过了 main 7b18f20、#369 520e55a、#374 6d6c598、#375 30c4b4d 上全部 showModal 调用，中英文都算了。
  1. 生产上的「Got it」（6）、「Restore」（7）、「Cancel」（6）、「Messages」（8）都没超。D-48 第 5 项撤销，不写进 ④。
  2. 超限的只有「Keep draft」（10）。#369、#375 上它只在 H5 走到（3b 已改）；#374 6d6c598 还没有 3b，小程序上照样会失败，D-48 第 3 项 merge 以后消失。3b 的改法仍然成立。
  3. community-mp-dialogs.test.mjs 第 40 行按「不超过 4 个字符」判断，比实际严。改成上面这条规则并注明出处（基础库版本和文件名），范围扩到全 app 小程序走得到的 showModal，不只社区页面；然后用一个 9 单位的英文串、一个 5 个汉字的串各做一次变异，确认会红。en.ts 第 473、724 行和 plaza/index.vue 第 1526 行的注释写的是「4 个字符」，一起改准。改在 #369，随 D-48 第 3 项 merge 到 #374、#375。
  4. 限制：只核了 3.15.0–3.15.2，更老的基础库没有核；manifest 没设最低基础库。showActionSheet 只查 itemList 不超过 6 项，alertText 和每一项都没有长度检查。
  5. 顺序：第 3 项排在 D-48 第 2 项后面，同一个提交或紧接着做都行。
  6. **这一批做完就停。** Eric 2026-11-13 14:16 CT 原话「然后等你这一大轮跑完可以听一下」（语音输入，按「停一下」理解）。D-46 到 D-50 都做完或停下、FINAL「第四批（D-46）」和 STATUS 一起提交以后，结束当前目标，不再自己设新目标，也不从 BACKLOG 往下接新任务，等 Eric 或 supervisor 的下一条指示。

- **D-51 第五批：修第四批核查发现的问题，重启 D-49，开一个只改 ci.yml 的草稿 PR**（2026-11-19 CT，Claude（Eric 自己账号上的 supervisor 会话）按 D-43 定并写入）：依据是 Eric 2026-11-19 17:18 CT 原话「先把号都重新登录了，后面的都给你批准你去监督跑就行了」，18:18 CT 原话「任务和之前的要求都一致」，以及他同日在弹窗里的三个选择：staging 现在应用 20261112120000（由 supervisor 做，见第 6 项）；让 OMO 开只改 ci.yml 的草稿 PR（第 4 项）；demo 里「转发 · CSSA」的虚构活动保留现状（第 7 项）。范围由 supervisor 定：第 1–7 项做完就停。第 4 项按 Eric 批准给 STOP-9a 加了一条例外，已经写进 RUNBOOK §12 第 9a 条；其余【硬】条照旧高于本条。背景：supervisor 对第四批报告做了五个独立核查（每个配一个反驳方），没有阻断项，也没有大问题；集成 412e14d 的主包 1,374,461、全量 2248 / 2247 / 0 / 1、typecheck、npm audit、117 次推送全是快进、冻结迁移逐字节一致，都在 supervisor 的机器上复现了。本条下发前又过了一轮独立审阅。下面是要补的地方。
  1. **号池与额度（一直有效）。**
     - 2026-11-19 18:15 CT supervisor 实查：Claude 号池里 default（admin@）、account-2（board@）、account-5（Eric 当天新加的 Claude Ultra 号）、account-4（LuciaMin@）都已登录、可用；account-3（event_manager@）Eric 近期不登，别指望它。ChatGPT 的 default、login-2 都能用。
     - 用号顺序是 Eric 2026-11-19 18:01 CT 定的，原话「然后后面优先admin和board，然后这个号，然后chatgpt的号，然后再是Lucia的号」。Claude 号池的顺序 supervisor 已经用 account_order 设成 default → account-2 → account-5 → account-4。ChatGPT 是另一个 provider，插不进这个顺序：前三个 Claude 号都接近 60% 时，supervisor 把主线程切到 ChatGPT，ChatGPT 也用完了再切回来用 account-4。
     - 每个号的周用量（7d）最多用到 60%。这一条取代 D-43 第 6 项的「可以全部用掉」。OMO 能做的只有两件：挑子任务类别时，某类别首模型所在的号已到 60%，就不挑这个类别；在 STATUS「阻塞」里记一笔。OMO 不改 ~/.omo，不切主线程的模型，不改号的顺序（D-42 第 7 项照旧）；这些由 supervisor 做。所有能用的号都到 60%：停下，把已完成的部分写进 STATUS 和 FINAL。
     - supervisor 2026-11-13 18:10 那条「子任务只用 ChatGPT 打头的类别」解除。子任务因为登录或额度中断，照那条的做法记进失败子任务表，然后改派或由主线程接手。
  2. **第四批报告和文档的更正（材料分支和 tony-ws 本机；STATUS_LOG 只追加）。**
     - a. FINAL 第四批开头、⑦ 和 STATUS 的 next_task_id 把停止规则引成了「D-50 第 2 项」，应为第 6 项。
     - b. 第四批 ② 的 docs_sha 一列有 13 行写的是「记录这条的提交」，不是 FINAL 第 17 行定义的「写回前的材料分支 head」（D-46.1、D-46.2、D-46.3a/3d/3c/3e/3b/3f、D-46.4、D-47.1、D-49、D-46.5、D-46.6）。按 STATUS_LOG 对应条目的 docs_sha 改，整列一个含义。
     - c. D-47.6、D-48.5（被 D-50.1 撤销）、D-48.6、D-50.1 各补一行；标着「D-48.2 / D-50.1」的那行按实际内容改标签；③ 补一行 L71 的更正（前提只核了四个 INSERT 触发器）。
     - d. #370 的红 run 漏列了：⑥ 少 43528915421（c4557c0）、43538315477（ed26304）、43542174637（abbd6b0）、43543108152（f20f44c）、43552639055（82b4ccf）；STATUS 除这五个外还少 43547172052（45add2a）。失败步骤都和 43493142000 一样。可以逐个补，也可以写成「f43bdd1 以后 #370 每次 run 都是同一失败，43509639602 另有一处」。
     - e. STATUS 过时的几处：CI 节「上一次」应是 43503547193（ae058c2）；验收表 D-46 第 4 项那行和 3b、3f 两行改成当前 head 和字节数；「版本」表的「四个都是草稿」改对数目。
     - f. ④ 里 #372 手工合并规则的 api/share-post.js 一条写窄了：412e14d 里兜底的标题和描述都取 #372（含「A post on Cornfield」和无帖时的描述），照实写。
     - g. 「五个旧名和「示例」」实为四个旧名（Illini Market、Illini 集市、校园广场、Campus Plaza）加「示例」，改正。
     - h. 本批约 19 次代码推送用了 `--no-verify`，STATUS_LOG 只记了 L66、L77、L90 那几次。追加一条补记：逐个列出 SHA 和推送前那次 run-checks 的日志名。以后每次 `--no-verify` 都写进「命令」字段。RUNBOOK 第 128 行说宿主机 SQL 测试「会跳过」，实际有 4 个会报 `initdb ENOENT` 失败；改成实情（#371 的 postgresBinDir 会消掉这个问题）。
     - i. RUNBOOK §3 写着「`git worktree list` 只应列出上表里的目录」。长期用的 illini-mpbudget、illini-deps、illini-restricted、illini-d46-integration、illini-docs-brand7，以及本批第 3 项 b、第 4 项新建的目录，补进表里。下面 6 个证明用的 worktree 逐个处理，不用通配（~/.cache/illini-dev 是容器的 HOME，不是 worktree，别碰）：~/.cache/illini-d50-dialog-proof、~/.cache/illini-following-d47-proof、~/.cache/illini-home-proof-st01a1d65b、~/.cache/illini-subpackage-d48-baseline、~/.cache/illini-subpackage-d48-mutation、~/work/evidence/D50-followup/history-tree。要留的证据先存进 $EV：history-tree 有未提交的改动，把 `git diff` 的输出、`git ls-files --others --exclude-standard` 的清单和那些文件都存好。然后用不带 `--force` 的 `git worktree remove`。被拒（有改动或未跟踪文件）就留着，写进 STATUS_LOG，不另找办法删。
     - j. run-checks 每份日志的开头加上 `git write-tree` 的结果，有 MERGE_HEAD 时一并写，这样「推送的树就是检查的树」能在日志里查到。分三步：先 `cp -p ~/work/illini-dev-env/run-checks.sh ~/work/illini-dev-env/run-checks.sh.before-D51-20261119`；再改实际脚本；同一个材料分支提交里更新 appendix/env/run-checks.sh，并记下新旧 sha256。
     - k. 以后的 STATUS_LOG 条目都写全 9 个固定字段（L80–L89 有缺）。已写的不改，更正一律追加新条目。
  3. **#374 和 #372 的两处代码小修。**
     - a. #374 的 app/src/pages/post/index.vue：第 314 行 `<view v-if="replyFailed" ... @click="retryReply">`（显示 `t('plaza.replyFailed')`，中文「没发出去，点此重试」）和第 288 行的 `v-if="replyRestricted"`、第 291 行的 `v-else` 平级，受限时两条会一起出现。改成受限时不显示重试，retryReply 在受限时也直接返回。测试先在 2e0f582 上确认会红。这一行只在 #374 上（来自 c16f0a1），D-49 的分支看不到它，所以在 #374 上修。聊天的「发送失败 - 点击重试」（chat.sendFailed）归第 5 项的 D-49 客户端，不在这里改。
     - b. 「集」字印章：CommunityHome.vue 第 108、123 行的两个 `u-thumb-ph-seal` 占位还是「集」。#374 比 #372 先上线，那时其他页面也还是「集」，所以 #374 上不改。改法：在 #372 上加一条测试，拒绝 app/src 下任何 `u-thumb-ph-seal` 占位里的「集」（#372 单独跑时照样通过）；FINAL ④ 的 #372 手工合并规则加一句「CommunityHome.vue 两处占位改成玉」；新建一个本地集成分支 `wip/d51-seal-integration`（目录 ~/work/illini-d51-seal，不推送），照 412e14d 的做法把五个 PR 再合一遍，确认这条测试改之前会红、改了以后会绿。
  4. **只改 ci.yml 的草稿 PR（Eric 2026-11-19 弹窗批准；STOP-9a 只对这个分支、只对下面两处改动解除，已写进 RUNBOOK §12 第 9a 条）。**
     - 新分支 `codex/config-ci-runner-20261119`（目录 ~/work/illini-ci-runner），从 origin/main 7b18f20 切出，只改 .github/workflows/ci.yml 一个文件。
     - 改动一：`git cherry-pick c52badf`，逐字节一致。这是 Eric 2026-11-12 在 #369 上的提交，把 build-h5、public-smoke、authenticated-smoke 三个装浏览器的 job 钉到 ubuntu-24.04。只钉这三个，其余 job 照旧 ubuntu-latest。这是 #371（Playwright 1.65）合进 main 之前让 main 先变绿的临时办法，和 D-16 一致；#371 合并以后要不要回到 ubuntu-latest（P1.5 DoD ③），由 Eric 定，写进 ④。验证：对 04edaa3、2e0f582、571be45、b259105、55716ba 各跑一次 `git merge-tree`，ci.yml 要 0 冲突。
     - 改动二：npm audit 那一步保持 moderate 门槛，只放行一条 GHSA-8g5g-mxqh-grgj，其他 moderate 及以上照样失败。命令里保留 `npm audit --audit-level=moderate` 这个子串（比如后面再加 `--json`）和现有的 `if:` 门。#320、#321 留下的行为（只对传输失败重试、180 秒封顶、用 npm 11）和 #329 加的依赖门（只有 PR 改了 app/package.json 或 package-lock.json 才审计）都不变，路径判断不改。放行条目写上复查日期 2026-12-13，过了这一天就不再放行，并输出一条 `::warning::`。注意：上游 vite 6.4.5 已经修了这个问题；仓库装的是本地重建的 6.4.4 归档（app/package.json 里的 `file:./vendor/source-builds/...`），npm 没法自动修，所以才要暂时放行。另一条路是在 6.4.5 上重建这个归档；这属于依赖变化，本批不做。PR 描述把两条路都写清楚，由 Eric 选。
     - 两处改动都要让 scripts/ci-hook-contract-boundary.test.mjs 等现有测试原样通过。要改测试才能过，就停下，写进 ④。
     - 验证：把 ci.yml 里审计那一步的 run 块原样抽出来，用 run-checks 的 `cmd` 在容器里跑三次，日志都进证据目录：(a) 用 7b18f20 的 lockfile，预期 exit 不是 0，失败列表里没有 GHSA-8g5g-mxqh-grgj；(b) 用只剩 vite 这一条的 lockfile（55716ba 或 412e14d），预期 exit 0；(c) 喂一份多一条 moderate 的 audit JSON，预期失败。YAML 要能解析，能跑 actionlint 就跑。PR 自己的 CI 上审计这一步显示 skipped 是预期，PR 描述里写明：放行逻辑要等合进 main 以后的 push 或每周定时任务才第一次真跑；main 上的 Boundary 要等 #371、#373 合并后才会绿。
     - PR 保持草稿，base 是 main，描述写清改了什么、为什么、怎么看结果。它和 #369、#374、#375 上的 c52badf 逐字节一致，合并时不冲突；可以先合。
     - 推送如果因为令牌没有 workflow 权限被拒：不换别的路子，分支留在本地，用 `git format-patch` 导出到证据目录，写进 ④。supervisor 会从 Eric 的机器上推。
  5. **重启 D-49（分支 codex/community-restricted-20261113，base #369）。** D-49 第 1–5 项照旧有效，本项只解开上次停下的地方：
     - 批准新增一个只给本地用的文件 `supabase/_ops/LOCAL_BOOTSTRAP_20260916211900_storage_objects_version.sql`，给本地 storage.objects 补 version 列（为了和托管的 Storage 一致，也补 owner_id）。时间戳按 D-44 第 2 项的惯例，取第一个用到这一列的迁移：20260916211900_chat_media_storage_preflight.sql 第 20 行，在 private.enforce_chat_media_upload() 里；上次真正报错的是 20260919064706 的 queue_chat_video_review()，也在这一列之后。文件头和守卫照 LOCAL_BOOTSTRAP_20260916073035_auth_users_ban_delete.sql 的写法（RUNBOOK §5.1 第 3 条）；漏了 `IS DISTINCT FROM 'lsql-replay'` 守卫，回放脚本会悄悄跳过这个文件。列的来源写 supabase/storage 某个 tag 下的迁移文件名。
     - 强制失败验证：去掉 version 列再跑一次。这两个函数都是 plpgsql，建函数时不解析列，所以预期回放照样 181/181，报错出现在 REGRESSION（或夹具）第一条往 storage.objects 插行的语句上：`record "new" has no field "version"`。失败出在夹具，不出在迁移，这就算验证成立，不算尝试次数。两次日志都留下。
     - 已有的文件一个都不改。两份 manifest 里已有的行不动；LOCAL_BOOTSTRAP 文件不进 manifest；D-49 的新迁移照 ENGINEERING §5.0 第 1 条往 manifest 追加一行，README 计数句和计数断言一并改。
     - PG 查找不算阻塞：Node 回归可以像 P2.5 的 scripts/community-post-topics.test.mjs 第 8 行那样写死 PostgreSQL 17 的路径；#371 合进 main 以后，按 P1.8 改成 postgresBinDir()。
     - 正式回放之前，先在一次回放出来的库上单独跑 REGRESSION 的夹具和目录查询，把自己 SQL 写错的地方先修掉（上次第 2 次失败的 `text || "char"` 就属于这种）。这类单独试跑不算尝试次数。新文件提交以后，完整回放重新给 3 次机会。
     - 然后照 D-49 第 3–5 项做：迁移加 PRECHECK、VERIFY、REGRESSION，全等级回归，sha256 冻结，客户端，上线顺序，开草稿 PR（base `codex/community-topics-20261112`）。PR 描述开头加粗写明：本 PR 的迁移要先在 staging 和生产上应用并跑通 VERIFY，前端才能合。帖子回复那一行归第 3 项 a。
     - 3 次还过不了：停下，写清停在哪条迁移、哪个夹具、还缺什么。
  6. **staging 上的 20261112120000（supervisor 已做完，OMO 只做后续）。** Eric 2026-11-19 批准 supervisor 把它应用到 staging-smoke（hygkwxugskijadgfisji），生产不动。这次由 supervisor 代做，取代 E4 第 3–4 步的「Eric 本人执行、在 PR 留言」。D-29 / E2（书面确认 staging 只有合成数据）仍没完成，P2.6 照旧等它。
     - 应用前：做了只读核对，台账里没有这一条；PRECHECK 去掉 `\set` 那一行后，用 execute_sql 跑，返回空、没有报错；三个运行期才解析的依赖都在，authenticated 的 INSERT / UPDATE 列和 anon 不可写都符合预期，没有长事务。
     - 应用：2026-11-19 18:01 CT，用 apply_migration 跑了一次。name 写的是完整的 `20261112120000_community_post_topics`；发送内容只去掉了第 3 行 `BEGIN;` 和第 599 行 `COMMIT;`，sha256 e5738298d3fb3de12494ab2098d95367d20a199e78424761bd7e21c4e95461b3；迁移文件本身的 sha256 仍是 e2a85c3e…。
     - 应用后：台账从 197 行变成 198 行，新的一行是 version 20261120000144、name `20261112120000_community_post_topics`。VERIFY 也去掉 `\set` 那一行后跑，返回空、没有报错。四个函数体的 md5 和按文件推算的完全一致：validate_post_topic e639a99441841a7d79080db62b304ad1，search_community_posts 1dfd91b93a4d7979d7f9e9dd121295b8，admin_get_report_detail acaae3fedb31e79a867e7a685ad326b5，capture_report_target_snapshot 299b759951355b171870963af375c3f8。触发器是 BEFORE INSERT OR UPDATE OF title, category，tgenabled=O；validate_post_topic 是 SECURITY DEFINER、search_path=pg_catalog、只有 postgres 能执行；posts_visible 仍带 status='active' 和 profile_content_visible 两个过滤条件。
     - staging 另缺 3 条和本迁移无关的旧迁移（20260811140018、20260811143207、20261003175231），这次不补，写进 ④。
     - 在 STATUS_LOG 补记三个伴随文件的 sha256（ENGINEERING §11 要求，L46 只记了迁移本身）：PRECHECK a4e6250914f7cd244d26c9852956793872b4046ed6fe56b16974943cdf6d6624，VERIFY de45bb91e09a1ebb22c8f23774994417eb84f139b105e4d6e042a777c5d277ac，REGRESSION e7d4caedc836bec780d1311b950ead706306210a3ca81f020aa324a1cd3c52f2。
     - public sweep 不再算「等 E4 的预期失败」，D-42 第 3 项「不重跑」对它解除。按 RUNBOOK §7 的第 3 种办法在 #369 上推一个空提交，重跑一次 CI，code_sha 跟着更新。记结果时用 `gh run view <id> --log | grep -m3 'Image: ubuntu'` 一并记下 runner 镜像：停在 Install Playwright、镜像又是 26.04，就写「schema 预检已过，卡在第 4 项要修的 runner 问题」。verify-public-read-schema 通过，就在 STATUS 把 E4（staging 那一半）标成完成；没通过就照实写。P2.6、P2.13 仍然等 E2、E3、E5，不因为这一项开工。
     - staging 上 posts_visible 的写权限是 041 建视图时的默认权限，留着没收回（视图是 security_invoker，经视图写入仍按 posts 的列权限判，不算提权）。本批任何迁移都不做这件事，写进 ④ 由 Eric 定。
  7. **Eric 定的事和 E12 的说明。** demo 里「转发 · CSSA」的虚构活动保留现状（Eric 2026-11-19）。④ 的 E12 一行加一句：预览在真实 Chrome 里会报 1 条 CSP 错误，来源是 Vercel 给预览页注入的工具栏脚本（vercel.live），被 demo 自己的 `script-src 'self'` 拦下，不是 demo 本身的问题，生产不会注入。
  8. **目标、顺序和报告。**
     - 读到本条后，用 create_goal 设一个新目标：范围是本条第 1–7 项，完成线是 FINAL「第五批（D-51）」和 STATUS 在同一个提交推送。按 D-42 第 8 项重建一个 3600 秒的续跑提醒（建之前先 list，只留一个）。两件事都在 STATUS_LOG 记一笔。D-50 第 6 项「不再自己设新目标」这次不适用。
     - 顺序：先做第 1 项。第 3 项 a 和第 4 项先做（都小）；然后是第 5 项；第 2 项、第 3 项 b、第 6 项穿插着做。同一个分支同一时间只让一个子任务推送；顺序一变，当场在 STATUS_LOG 记 [OMO自决]。每项最多试 3 次，第 5 项按它自己的次数算。
     - 做完或停下以后，写 FINAL「第五批（D-51）」，八节格式照旧，每项单独成行，D-49 单独一节，和 STATUS 一起提交。然后结束目标，取消续跑提醒，不从 BACKLOG 往下接任务，等下一条指示。

- **D-52 第六批：把 #377 叠到 #374 上、补发帖的客户端预检、加固 #376 的放行逻辑、更正第五批报告**（2026-11-20 CT，Claude（Eric 自己账号上的 supervisor 会话）按 D-43 定并写入）：依据是 Eric 2026-11-19 17:18 CT 原话「后面的都给你批准你去监督跑就行了」、2026-11-19 23:56 CT 原话「继续」、2026-11-20 01:16 CT 原话「可以了，我暂时先转public，然后你继续操作吧」。【硬】条照旧高于本条，D-51 第 4 项那一条 STOP-9a 例外照旧只限 #376 的分支。背景：supervisor 对第五批做了五个独立核查（每个配一个反驳方），没有阻断项。在 supervisor 的机器上复现了：Docker 本地 L-SQL 回放 182/182；D-49 全等级回归改后 3,390/0，在 04edaa3 上 2,442/948；8 个重写的函数除了限制检查只有两处已披露的改动。本条下发前又过了一轮独立审阅。
  0. **用号规则（取代 D-51 第 1 项的相应部分，一直有效）。** Eric 2026-11-19 选「照样用」：default（admin@）、account-2（board@）不设 60% 上限，用到额度耗尽为止；account-5、account-4 和 ChatGPT 的两个号仍按 60%。supervisor 已在 2026-11-19 23:56 CT 用 account_order 把顺序设回 default → account-2 → account-5 → account-4，取消了 account-5 的置顶；STATUS_LOG L95 里「admin、board 在本周额度重置前不用」作废。切到 ChatGPT 仍由 supervisor 做，OMO 不改顺序、不切模型。停下条件：default、account-2 都用尽，其余号也都到 60%。
  1. **#377 叠到 #374 上（分支 codex/community-restricted-20261113）。** 现在 #377 的 base 是 #369 的分支，可它和 #375、#374 合不到一起：在 app/src/pages/detail/useRatings.ts（#375 把 composables/useRatings.ts 挪到了这里）和 app/smoke/chat-realtime-handshake.test.mjs 上冲突；手工解完以后，全量还有 16 条失败。
     - 用 `git merge 6bdca97` 把 #374（已含 #369、#375）合进 #377，不 rebase。useRatings 的冲突：保留挪过去的文件，把 `assertWritesAllowed` 的 import 改成 `'../../composables/useRestriction'`；chat-realtime-handshake 两边都留。
     - 16 条失败里，10 条在 app/smoke/restricted-account-actions.test.mjs：第 546 行还按旧路径载入 composables/useRatings.ts，改成 pages/detail/useRatings.ts；第 548–551 行 mock 的键（'./useSupabase'、'./useAuth'、'./accountScope'、'./useRestriction'）改成新文件里实际的 import 路径（'../../composables/useSupabase' 等）。第 21 行是通用的读文件 helper，不改。
     - 另外 6 条在 #375 的 account-gate-prompts.test.mjs：第 221 行断言 L2–L4 进 pages/suspended，第 226 行断言 L2–L4 不弹入站提示。合并后的代码已经让 L2–L4 在可浏览的页面上弹新消息和通知横幅。照这个行为改：依据是 SPEC §11 的 suspended.sub 和 D-49 第 3 项「照旧允许：所有读」，受限只限写。第 221、226 行改成只有有效 L5 进 pages/suspended、L2–L4 照常弹提示；pages/suspended 上仍按 D-47 第 5 项不弹。
     - 合完跑全量、vue-tsc、h5、mpci 和 smoke。smoke 的 SMOKE_SPECS 要包含 restricted-account-notice.spec.ts：它是 D-49 提示条唯一的浏览器测试，run-checks 默认不跑它。在 STATUS_LOG 追加一条更正：第五批的「smoke 35」没跑这条 spec。用 390 和 1280 宽各截一张社区首页带提示条的图，只存在 ~/work/evidence，不进仓库。主包按 CI 环境量（核查方在同一组合上量到 1,379,997，余 192,867）。
     - 然后用 GitHub REST 把 #377 的 base 改成 `codex/community-home-20261112`，PATCH 只传 base 一个字段，PR 仍是草稿。本项取代 D-49 第 2 项括号里「#369 合进 main 以后改成 main」的 base 规则，以后按第 4 项 b 走。RUNBOOK §3 的 illini-restricted 那一行和 STATUS 的版本行里关于 base 的说法一并改。
  2. **发帖的客户端预检（在 #377 上，第 1 项之后做；这是本条新加的要求）。** usePlaza 的 createPost 发请求前没有 assertWritesAllowed，只有打开发帖面板（openComposer）那里查。回复在页面层发请求前查了，createComment 本身没查。两处都在 composable 层补上 assertWritesAllowed；测试也写在 composable 层，先在合并后的 #377 上确认会红（页面层的测试在那儿不会红）。CommunityHome 商品区补位卡「发布第一件 ›」的 openPublish 是 switchTab 到商品发布页，那一页自己有拦截，不改，在 STATUS_LOG 记一笔。
  3. **#376 的放行逻辑加固（只在分支 codex/config-ci-runner-20261119 上）。** ci.yml 的加固仍算 D-51 第 4 项那一处 STOP-9a 例外里的「改动二」。这个分支上除了 ci.yml，只多改 docs/NPM_DEPENDENCY_TRIAGE.md 一个文件：STOP-9a 不管 docs/，这里放宽的是 D-51 第 4 项「只改 ci.yml」的分支范围。
     - 失败也放行的漏洞：现在 npm 非零退出、但 JSON 能解析出空的 vulnerabilities（或者 vulnerabilities 是数组、或带 error 字段）时，脚本会放行。改成：npm 非零退出、又没有匹配到任何被放行的公告，就失败；报告带 error 字段，或者 vulnerabilities 不是对象，也失败。
     - 放行条件除了 GHSA 编号，还要求包名是 vite、严重程度不高于 moderate。同一个编号出现在别的包上，或者严重程度升级了，都不放行。被拦下的每条公告把依赖路径打到日志里。
     - docs/NPM_DEPENDENCY_TRIAGE.md：加一段带日期的「Status 2026-11-20」，写清四件事：仓库装的是本地重建的 vite 6.4.4；GHSA-8g5g-mxqh-grgj（moderate）放行到 2026-12-13；路线 B 要把 braces 3.0.3 的回补在 vite 6.4.5 或 6.4.6 上重做一遍，直接装 registry 上的 6.4.5 能让审计变绿，却会悄悄丢掉这个回补；2026-10-05 那份快照标成历史。
     - 测试照 D-51 第 4 项的办法：抽出 run 块，至少跑下面这些用例，日志放在 ~/work/evidence：真实依赖树；多一条 moderate；非零退出加空 JSON；带 error；vulnerabilities 是数组；同一编号出现在别的包上；严重程度升到 high；过了到期日。scripts/ci-hook-contract-boundary.test.mjs 等现有测试要原样通过。对 8257318、6bdca97、571be45、9c10a7e、d6f393d、b259105、55716ba 各跑一次 merge-tree，ci.yml 都要 0 冲突。
     - 同步改三处：#376 的标题和描述（REST 只改 title、body，仍是草稿；A/B 两条路里写上 braces 回补那句）；RUNBOOK §3 里 #376 那一行；第六批 ⑧ 加一行，取代 D-51.4「按公告编号、不按包名」的理由。
  4. **第五批报告和文档的更正（材料分支；STATUS_LOG 只追加）。**
     - a. **GitHub Actions 停过一段**：从 2026-11-20 约 01:25Z 起，#370 的 run 44653535391、44660742581、44671115623 都在 4–5 秒内结束（job 只有 2–3 秒），没有一个步骤跑起来。注解原话是「The job was not started because recent account payments have failed or your spending limit needs to be increased.」Eric 2026-11-20 01:16 CT 把仓库改成了公开，07:15Z 起是 PUBLIC，Dependabot 的 job 已经能拿到 runner，可 ci.yml 公开以后还没跑过。把这段写进 STATUS 的 CI 节和第六批 ⑥。本批第一次推送触发的 run，每个 job 都要有步骤（steps>0），也没有付款注解，才算 CI 恢复。要是 run 又在几秒内结束、0 个步骤、注解是付款失败：不重跑、不推空提交，记进 STATUS 的 CI 节和 ④，接着用本地结果。
     - a2. **仓库现在是公开的**：推上去的提交、PR 描述、PR 评论和 CI 日志，任何人都能看到。从本批起，不往仓库里加新的原始日志、带真实数据的截图、账号邮箱、凭据和 /home 开头的绝对路径。RUNBOOK §3 和 STATUS_LOG「命令」字段里已经在用的 ~/work/... 目录名照旧写，不算违规。④ 加一行给 Eric：材料分支、DECISIONS（含 D-51 里的账号邮箱缩写）和几个 PR 描述里已经有账号邮箱和工作站路径，现在都是公开的；OMO 不改写历史去删它们，要不要处理由 Eric 定。
     - b. **合并与迁移顺序**（以下写给 Eric，OMO 不执行；托管库的事属于 STOP-2/3）。写成一条完整顺序：
       - #376 随时可以合；#371 → #373。
       - P2.13 通过后，依次合 #369 → #375 → #374；#372 在 #374 之后任何时候手工合，规则见 STATUS 第 11 条，含 CommunityHome.vue 两处占位改「玉」，以及 #372 和 #369 在 share-post.js、en.ts、zh.ts 的冲突规则。
       - #377 最后合，前提是 staging 和生产上都已经应用并 VERIFY 了 20261112120000，再 PRECHECK、应用、VERIFY 了 20261114015420（生产上必须先有前一条，否则 D-49 的 PRECHECK 会报 restricted_account_writes_column_missing）。
       - 删 #374 的分支之前，先把 #377 的 base 改成 main；如果 #374 是 squash 合并的，改完 base 以后还要往 #377 里 merge 一次 origin/main。#377 的 base 改成 main 之前没有 CI。
       - 各部分分别写进 STATUS 阻塞第 1 条（迁移和 P2.13）、第 11 条（#372 规则）、第 12 条（改 base）、第 14 条（D-49），以及第六批的 ④、⑦。
     - c. 仓库 RUNBOOK 的 D-49 一条（de0950f 加的，在 #377 上）补三句：第 0 步，这个项目上已经应用并 VERIFY 过 20261112120000；尽量在低流量时段应用，因为它会在 10 张表上短暂加锁，包括 storage.objects 上的 ACCESS EXCLUSIVE；因 lock_timeout 或死锁中止，整个事务会回滚，重试就行。这一处推送排在第 1、2 项推送之后。#377 的 PR 描述最后按最终 head 重写：写上新的 base、发布顺序，并把待定政策问题补成和 FINAL 一样的 12 条（现在是 11 条）。
     - d. ⑤ 说 20261112120000 在 #372 上也一样，可 #372 根本没有这个文件，改正。
     - e. STATUS 过时的几处：
       - 「版本」表第 1 行还写「远端 04edaa3」，应为 8257318；worktree 一行改成当前的样子；
       - 第 8 行的用号规则按第 0 项改；
       - 阻塞第 4 条：CI 例外已由 #376 提供；
       - 阻塞第 13 条：#374 的 head 是 6bdca97；
       - 阻塞第 17 条：只用 ChatGPT 打头的类别那条限制已经解除，换成第 0 项的用号规则；
       - 阻塞第 19 条：按第 4 项 g 改；
       - 补记 #372 d6f393d 的 CI run 44651530274（Build H5 和 public sweep 失败在装浏览器那一步，是 ubuntu-26.04 的老问题）；
       - FINAL 第 443 行「（D-51 第 3 项 b 的测试）」重复了一遍，删掉一个；
       - STATUS_LOG 追加一条更正：第五批 ② 的 D-51.5 和 D-51.1 改成「部分」，理由分别是没写 D-49 第 2 项要求的改 base，以及第 1 项要求的阻塞记录没写。
     - f. ~/work/illini-restricted-client 是个活着的 worktree，不在 RUNBOOK §3 的表里。如果 local/d49-client-20261120 已经全部合进 #377、工作区也干净，就用不带 `--force` 的 `git worktree remove` 删掉；删不掉就补进表里。
     - g. SIGSEGV 的说法改准：本地镜像 17.6.1.104（和生产的数据库版本一样）上，用 postgres 或 supabase_admin 登录，再 `SET ROLE` 到 anon、authenticated 或 service_role 去调用没有 EXECUTE 权限的函数，后端会 SIGSEGV；以 authenticator 登录（也就是走 PostgREST）是正常的 42501。所以 App 用户大概率触发不了，运维会话会；托管库上的 supautils 和 PostgREST 版本可能和本地不同，这一点没核。写进第六批 ⑥、STATUS 阻塞第 19 条和 ④，④ 那一行写成给运维的提醒，并附上 17.6.1.167 这个可选版本（核查方在这个版本上没复现崩溃）。
  5. **目标、顺序和报告。**
     - 读到本条后用 create_goal 设目标，范围是本条第 0–4 项，完成线是 FINAL「第六批（D-52）」和 STATUS 在同一个提交推送；按 D-42 第 8 项重建一个 3600 秒的续跑提醒（先 list，只留一个）；两件事在 STATUS_LOG 记一笔。
     - #377 分支上的顺序：第 1 项 → 第 2 项 → 第 4 项 c，PR 描述最后写。第 3 项和第 4 项其余部分穿插着做。同一个分支同一时间只让一个子任务推送（D-47 第 1 项）。每项最多试 3 次。
     - 做完写 FINAL「第六批（D-52）」，八节格式照旧，每项单独成行，和 STATUS 一起提交；然后结束目标，取消提醒，不从 BACKLOG 往下接任务，等下一条指示。

- **D-53 第七批：记下 Eric 的决定和 supervisor 代做的事，收第六批的尾，vite 走 B 路线，P3、P4 在叠加分支上开发，跑 staging 验收**（2026-11-20 CT，Claude（Eric 自己账号上的 supervisor 会话）按 D-43 定并写入）：依据是 Eric 2026-11-20 03:17 CT 原话「可以，所有东西我都批准了，你继续弄吧，反正还有额度，直接猛攻」，以及他同日在弹窗里的四个选择（第 0 项 a、d、e、f）。【硬】条照旧高于本条，对 OMO 一条都不放开；本条第 0 项 g 列的是 supervisor（不是 OMO）根据 Eric 这次批准做或将做的事。用号照 D-52 第 0 项。背景：supervisor 对第六批做了三个独立核查（每个配一个反驳方），没有阻断项，也没有 major。本条下发前过了一轮独立审阅，按审阅意见改过。
  0. **Eric 的决定和 supervisor 代做的事（照抄进 STATUS、RUNBOOK §11 的状态和第七批报告）。**
     - a. 【Eric 选】生产上线走「先验收再上线」：合 #369 之前，P1.11、P1.12、P2.6、P2.11 要在 staging 上通过，P2.13 也要完成（PR 描述、#369 的 CI 全绿、仍是草稿）。
     - b. 【supervisor 做】E2 / D-29：supervisor 2026-11-20 约 03:20 CT 只读查了 staging-smoke。auth.users 有 5 个 example.invalid 的合成号和 1 个 illinimarket.com 的冒烟号，没有真实用户；约 03:45 CT 又抽看了 profiles 9 行、items 2 行、posts 0 行、messages 2 行，归属全是合成号或冒烟号。加上 Eric 03:17 的总批准，D-29 定为 A，E2 记为完成；原「待定」里的 D-29 一节移除，结论记在这里。RUNBOOK §5.2 前提第一句、P1.11 和 P2.6 里「Eric 在 #369 留言」的要求，由本项代替；P2.6 的 DoD ① 由 D-51 第 6 项（staging 已应用并 VERIFY）代替。OMO 不在 #369 代 Eric 留言。
     - c. 【supervisor 做】E3 已完成。Eric 2026-11-20 03:25 CT 原话「给你权限，直接用我的浏览器做」。
       - supervisor 先在 Supabase 后台把 staging-smoke 的「Confirm email」临时关掉，约 03:36–03:40 CT。
       - 然后在 tony-ws 上跑 `~/omo-ctl/e3-auto.py`：本机随机生成 3 个 24 位密码，注册 syn-a、syn-b、syn-c@example.test（都已确认），写 ~/.config/illini/staging.env（600，8 个字段），再逐个试登录，都是 HTTP 200。
       - 之后把「Confirm email」开回去，/auth/v1/settings 复核 mailer_autoconfirm=false。
       - 密码只在 staging.env 里，没出现在任何输出、日志或对话中；RUNBOOK §5.2 的自检都过了。
       - OMO 对 staging.env：不 cat、不打印、不改；§5.2 的自检和 probe 步骤照常。
     - d. 【Eric 选】品牌和 demo「现在就上」。
       - E12 由 supervisor 在 2026-11-20 约 03:22 CT 做完：vercel promote 预览 dpl_3bG2SKTAmQsa7jEmScy2cHHpnk1y，新的生产部署是 dpl_7p18WL7JTqxbK8VKqNVVnYepLj1b（03:21:47 CT 建），`curl … | grep -c 玉米地` 等于 6；回退用 dpl_E3AmucjjeUZfCmPQ7NQRi2eiaAv6。BRAND.7 的 DoD ④ 记为完成。
       - #372 在 app 里的品牌改名，按第 0 项 g 的上线顺序由 supervisor 手工合。
       - D-37（董事会同意）仍未拿到，LEGAL.1 照旧开着，这是 Eric 的取舍，照实记。
     - e. 【Eric 选】#376 的 vite 走 B 路线，见第 3 项。
     - f. 【Eric 选】D-49 的 12 条待定政策问题全部按「不新增权限」定。
       - 行为类：保留商品是否算下架、清空资料字段、绑定新微信身份、打字和在线状态与广播、街区核验回执与微信媒体审核、限制前已排队的通知和邮件、L5 能到哪些清理页面、跟受限的人开新会话、请求中途生效的管理员操作。这几条一律维持现在的服务端行为。
       - 措辞类：非发帖操作、提示条、回首页的措辞，有限期 L5 与无限期 L2–L4 的措辞，Storage 走 HTTP 的错误文字。这几条沿用现有文字。
       - 逐条写进第七批报告，#377 描述里那一节从「待定」改成「已定（D-53）」。代码不用改。
     - g. 【supervisor 做或将做，依据 Eric 03:17 的批准和 a 项的选择；这是对授权边界表「每次单独」的一次有名有姓的例外，只授权 supervisor，不授权 OMO】：
       - 已做：E2、E3、E12。
       - 合并（都由 supervisor 做）：vite PR 合进 #373 的分支 → #373 合进 #371 的分支 → #371 合进 main（E5）。
       - 验收（第 0 项 a）通过以后的上线顺序：
         - 生产应用 20261112120000 并 VERIFY；
         - 依次合 #369 → #375 → #374；
         - staging、生产先后对 20261114015420 做 PRECHECK、应用、VERIFY，然后合 #377；
         - 手工合 #372；
         - 每一步之后看生产。
       - P3、P4 的迁移不在本批上线范围。
       - RUNBOOK §11 的 E2、E3、E5、E12 照此标状态，第七批 ④ 不再把它们列成等 Eric。
  1. **第六批的收尾（材料分支；STATUS_LOG 只追加）。**
     - FINAL 第六批 ① 的开始时间改成 01:35 CT。
     - STATUS 的 CI 段落把 L110 改成 L111；验收表 D-52 第 4 项一行引 L111–L115、L119、L120。
     - L117 截图张数的更正：社区首页 2 张，二手首页 4 张，共 6 张。
     - 补记 #370 的 run 44698816891、44703187712：Build H5 和 public sweep 失败在装浏览器那一步，是 ubuntu-26.04 的老问题，不是付款问题。
     - STATUS 里「c52badf 钉的」改成「87e57c3（c52badf 的 cherry-pick）钉的」。
     - 追加一条确认：第六批的目标在 08:31:28Z 结束，续跑提醒已取消。
  2. **#376 再补一处（只在分支 codex/config-ci-runner-20261119 上；仍属 STOP-9a 例外的「改动二」，加上 D-52 第 3 项放宽的那一个文档文件）。**
     - npm 正常退出（exit 0）时也要读报告：报告解析不了、带 error 字段、vulnerabilities 不是对象、没有 metadata，都失败；正常的空报告照样通过。
     - 在放行的 vite 公告旁边，任何自身严重程度在 moderate 及以上的条目，如果 via 里既没有公告对象、也没有能在报告里找到的包名，就失败。不加「metadata 计数相等」那种检查（npm 按包计数、脚本按公告计数，两边单位不同）。
     - docs/NPM_DEPENDENCY_TRIAGE.md 的 2026-11-20 那段补一句：B 路线原先引用的 GHSA-vfj7-8cjw-p6xm 已在 2026-10-23 被 GitHub 撤回，braces 回补的价值按「限制递归深度」本身写。
     - 用例照 D-52 第 3 项，再加：exit 0 加乱码、exit 0 加空输出、exit 0 加 error 字段、via 为 [null] 的 critical、via 为空的 high、via 名字不在报告里的。现有测试原样通过；对各 PR 当前的 head 跑 merge-tree，ci.yml 都要 0 冲突。#376 描述同步改。
     - #376 合不合：vite PR 和 #371 进了 main 以后，#376 的钉版本和放行都用不上了，supervisor 会把它关掉或留作草稿，在 ④ 写明。
  3. **vite 走 B 路线（新分支 codex/config-vite-645-20261120，base 是 #373 的分支 `codex/deps-crossmajor-20261113`；Eric 批准，STOP-8b 只对这一次升级解除，已写进 RUNBOOK §12 第 8 条）。** 仓库里现有的重建配方（app/build-compat/source-builds/vite/）只认 macOS arm64 的 Node 22.23.3，manifest 也钉死了 6.4.4 的 commit、源码哈希、补过的 package.json 和 pnpm-lock；package-build.py 只能原样重建已审过的归档，不能生成新清单。所以这次要为 6.4.5 新写一套配方，6.4.4 那套不动：
     - 目标版本：上游 vite 6.4.5，或已发布的更新的 6.4.x 补丁版（GHSA-8g5g-mxqh-grgj 的首个修复版是 6.4.5）。
     - 在 6.4.5 的源码上重新生成 braces 3.0.3 的回补补丁，新写一份 manifest：commit、源码归档 sha256、补丁和 patched_inputs、dist 清单。
     - 运行时：这份新配方认 tony-ws 测试容器里的 Node 22.23.5 linux-x64，并在 manifest 里写明。
     - 在容器里从干净状态独立构建两次，两次的归档要逐字节一致，两份日志都留下。
     - 新归档的 sha256、integrity、fileHashes 写进 app/vendor/source-builds/manifest.json，来源写进新的 vite manifest 和 CAACI-BUILD-PROVENANCE.json，README 加一段带日期的说明；CAACI-PATCH-NOTICE 不写归档自己的哈希。scripts/bundled-braces-source.test.mjs 等守卫照新清单通过，测试只按新版本改数据，不删断言。
     - app/package.json 的 `file:` 引用和 lockfile 跟着改，只升 vite；lockfile 里 vite 以外的变化逐条列原因。
     - 验证：install、typecheck、test、h5、mp、mpci、smoke 都过；在这个分支上 `npm audit --audit-level=moderate` 应当 0 告警；主包和 h5 产物大小与 55716ba 对比。
     - 草稿 PR，描述写清新配方、两次构建一致的证据，以及 supervisor 会独立复核。
     - 最多试 3 次，做不到就记【跳过】，原因写进 ④；那时上线改走「先合 #376 拿到放行」的后备。
     - 后备日期：#373 到 2026-12-06 还没合，由 Eric 定是把 vite PR 改到 #371 或 main 上，还是延长 #376 的放行。写进 ④。
  4. **P3、P4 在叠加分支上开发（猛攻部分；只开发和本地验证，不合并、不上线）。**
     - 解除旧限制：BACKLOG 写 P3.1 依赖 P2.13、P4.2 依赖 #369 合并，这里说的是上线顺序；现在就可以在叠加分支上开发，合并顺序不变，排在 #377 之后。D-45 第 8 项、D-46 第 7 项、D-49 第 2 项里「不新建迁移、不改 RLS 和函数」，对下面两个分支解除；BACKLOG §1 的 wip 规则和 RUNBOOK §3 里 illini-p3、illini-events 两行的 wip 流程，由本项取代。
     - **P3：一个分支、一个草稿 PR。** 分支 `codex/community-p3-20261120`，目录 ~/work/illini-p3，从 #377 的 head dd44f98 切出，PR 的 base 是 `codex/community-restricted-20261113`。P3 的库改动（P3.1、P3.3、P3.4、P3.5）照 ENGINEERING §5.3 放进同一个迁移，先做、先冻结，再做客户端。顺序：P3.1（连同上面那几项的库改动）→ P3.2、P3.3、P3.4 → P3.5 → P3.6 → P3.8。
     - **P4：一个分支、一个草稿 PR。** 分支 `codex/community-events-20261120`，目录 ~/work/illini-events（现有那个 worktree 上的 wip/P4.1 保留不动；放不下就另开目录，并补进 RUNBOOK §3 的表），从 P3 分支冻结迁移以后的 head 切出，先 `git merge wip/P4.1`（5f62ddd，只 merge，不 rebase），PR 的 base 是 P3 的分支。顺序：P4.2（community_events 与同步状态的迁移）→ P4.8（活动页和首页「近期活动」，接上 home.events、home.allEvents）→ P4.9。
     - 迁移：照 ENGINEERING §5、§6 和 P2.5 的做法，配 PRECHECK、VERIFY、REGRESSION，本地 L-SQL 回放，sha256 冻结，manifest 追加一行。时间戳一律晚于它下面所有分支上的迁移（20261114015420 之后，P4 的晚于 P3 的）。改写已有函数时，比对基准用叠加分支的 base head，不用 origin/main；PRECHECK 里的 md5(prosrc) 取 L-SQL 回放到 20261114015420（P4 则是回放到 P3 的迁移）之后的值。应用到托管库不在本批。
     - 受限账号：新写入路径照 D-49 的标准归类。post_bookmarks 算「收藏」，允许；post_follows（订阅话题）只有自己看得到、不通知别人，允许。任何会被别人看到或通知到别人的新写入，挂上 D-49 的拦截。REGRESSION 覆盖 L0、L1、过期的 L2–L5 和有效的 L2–L5。
     - E6 没到位：P3.5、P4.9 读 COMMUNITY_OFFICIAL_PROFILE_ID；没设时一律拒绝，返回具名错误 `official_profile_not_configured`，不落库，每个动作各配一条测试；DoD 里要 E6 的那一半写进 ④。
     - 主包每个分支都量（CI 环境），余量守住 64 KiB（D-46 第 4 项）；不够就在 ④ 写明，不硬塞。
     - 删 base 分支之前先改 base（写进 STATUS 阻塞第 12 条）：删 #373 的分支之前，先把 vite PR 的 base 改成 main；删 #377 的分支之前，先把 P3 PR 的 base 改成 main；删 P3 的分支之前，先改 P4 PR 的 base。base 是 squash 合并的，改完以后都要再 merge 一次 origin/main。
  5. **staging 验收（E3 已到位）。** 照 BACKLOG 和 RUNBOOK §5.2 做 P1.11、P1.12（main 基线）、P2.6、P2.11（#369），合成内容按 §5.2 清理。同一时间只跑一个 S-1。
     - P1.8 要等 #371 合进 main：先用 `git merge-base --is-ancestor b259105 origin/main` 核实。
     - 核实以后，在 #369 上 merge origin/main，按 BACKLOG 改用 postgresBinDir，并 `git revert c52badf` 去掉三处 ubuntu-24.04。#371 带来的 Playwright 1.65 已能在 ubuntu-26.04 上跑，这和 D-16 一致；这一个 revert 是 STOP-9a 的具名例外，已写进 RUNBOOK §12 第 9a 条。
     - 然后做 P2.13。P1.8 之后先不往 #375、#374、#377、P3、P4 合并，等上线时一起处理。
     - 第 0–4 项做完时 #371 还没合：P1.8、P2.13 记【跳过】（等 E5），照常收尾。
  6. **目标、顺序和报告。** 读到本条后用 create_goal 设目标，范围是第 0–5 项，完成线是 FINAL「第七批（D-53）」和 STATUS 在同一个提交推送；按 D-42 第 8 项重建一个 3600 秒的续跑提醒（先 list，只留一个）；两件事在 STATUS_LOG 记一笔。顺序：第 0、1 项先做（只改文档）；第 2、3、4、5 项可以并行（不同分支、不同目录），staging 一次只跑一个 S-1。同一个分支同一时间只让一个子任务推送；每项最多试 3 次。仓库仍是公开的，D-52 第 4 项 a2 和 supervisor 的安全补充照旧有效。做完写 FINAL「第七批（D-53）」，八节格式照旧，每项单独成行，并标出哪些是 Eric 的选择、哪些是 supervisor 代做；和 STATUS 一起提交，然后结束目标，取消提醒，不从 BACKLOG 往下接任务，等下一条指示。

  7. **补充（2026-11-20 04:00 CT，派出后的复核；本项优先于第 0–6 项里与之冲突的字句）。**
     - a. **P1.8 的开工条件改掉。** main 要求线性历史，#371 只能 squash 合并，b259105 永远不会是 origin/main 的祖先。改成：`gh pr view 371 --json state,mergeCommit` 里 state 是 MERGED，并且 `git merge-base --is-ancestor <mergeCommit.oid> origin/main` 成立。D-42 第 6 项里「E5 看 main 是否含有 P1.7 的提交」也照这个办法核。第 0–4 项做完时 #371 还没合，不要马上把 P1.8、P2.13 记【跳过】：目标继续开着，每次 3600 秒的续跑提醒都重新核一遍，直到 #371 合并，或者 supervisor 经控制通道通知「E5 延后」，或者到 2026-11-21 12:00 CT；三者先到哪个按哪个办，后两种情况再记【跳过】（等 E5）并收尾。
     - b. **后备合并补进第 0 项 g。** 第 3 项（vite）如果记【跳过】，supervisor 先把 #376 合进 main（拿到放行），再合 #371。
     - c. **去掉钉版本要带到下游。** P1.8 在 #369 上 `git revert c52badf` 以后，用 `git merge` 把 #369 新的 head 依次合进 #375、#374、#377，再从 #377 合进 P3、P4 的分支，这样各 PR 都不再带三处 ubuntu-24.04。第 5 项里「P1.8 之后先不往下游合并」对这一次合并解除。这一步也属 RUNBOOK §12 第 9a 条的同一个例外。
     - d. **容器一次只跑一个。** 第 6 项的「并行」只指改代码和推送。所有容器步骤（run-checks 各步、vite 的两次重建、L-SQL 回放、S-1 probe）照 RUNBOOK §1：同一时间最多 1 个 run-checks 类容器（vite 重建算一个）加 1 个 L-SQL 容器，用一把锁排队，比如 `flock ~/work/illini-dev-env/.containers.lock <命令>`。磁盘剩余低于 50 GB 就停下。tony-ws 是和 Tony、danny 共用的机器，STOP-13 照旧。

## 待定

### D-28 轮值伙伴与四项职责的小时数
- 现状：D-08 定 Eric 先兼任四项。轮值伙伴没有人选，「运营负责人」表的小时数四格全空。
- 选项：A 指定 1 位轮值伙伴，和 Eric 两人轮流；B 按板块分给 2–3 位董事或志愿者。
- 建议：A。内测只有 30–60 人，一个固定搭档比多人分摊好交接（判断）。排班要保证每天有一人看一次举报队列和版权投诉邮箱，因为举报（P3.6）、版权投诉（LEGAL.4）和合作组织撤回后的下架（SPEC 6.7.11）都定了 48 小时。
- 谁定：Eric。截止：LEGAL.6（P5.1 之前）。任一格为空就不进 P5。

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
