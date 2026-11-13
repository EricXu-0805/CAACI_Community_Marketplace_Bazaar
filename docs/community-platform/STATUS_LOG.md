# STATUS_LOG

只追加。旧条目不改不删；发现错误时另起一条，标题写「更正 Lnn」。最新状态看 [STATUS.md](STATUS.md)，证据标签定义见 [README.md](README.md#证据标签)。

## 格式

每条标题为 `### Lnn · YYYY-MM-DD HH:MM CT · 做了什么`（时刻不知道就写「时刻未记录」），下面固定 9 个字段，需要补充环境细节时末尾加一行「附」：

```text
- task_id:
- code_sha:
- docs_sha:
- 环境: L-SQL | L-UI | S-1 | S-2 | CI | 生产 | 本地 | 真人
- 命令:
- 计数: tests / pass / fail / skipped，或该任务 DoD 规定的计数，后附证据标签
- ci_run_url:
- 未测项:
- 下一条:
```

不写入：凭据、合成账号密码、staging.env 的内容、真实用户数据、外站帖子原文。

## 记录

### L01 · 2026-11-09 时刻未记录 · main 定时 CI
- task_id: —（V5 之前；P1.5、P1.6 的基线）
- code_sha: 7b18f2052e52a4268c25407d0584748477cbf978
- docs_sha: —
- 环境: CI（runner Image: ubuntu-26.04）
- 命令: `gh run view 42684660097 --repo EricXu-0805/CAACI_Community_Marketplace_Bazaar --log`
- 计数: Boundary regressions 测试 1989 / 1988 pass / 0 fail / 1 skipped，但 `npm audit --audit-level=moderate` 报 44 个漏洞（9 moderate、35 high；含 @intlify/core-base、@intlify/shared、follow-redirects、glob、minimatch、qs；vite 6.4.4 无修复版本）退出 1；Build H5 报「Playwright does not support chromium on ubuntu26.04-x64」；Smoke (public page sweep) 报「Playwright does not support webkit on ubuntu26.04-x64」[CI run#42684660097]
- ci_run_url: https://github.com/EricXu-0805/CAACI_Community_Marketplace_Bazaar/actions/runs/42684660097
- 未测项: 其余 job 的结论没有记录
- 下一条: P1.5（Playwright 1.65.0）、P1.6（D-41）

### L02 · 2026-11-12 06:21 CT · PR #369 CI 结束
- task_id: —（V5 之前；P2.1、P2.6 的基线）
- code_sha: 005ca9d6b5ac23346dfeb38f3deb95984bffd27b
- docs_sha: 4e459bd81df766b15c97b85109ffbb7067c7ebcd
- 环境: CI
- 命令: `gh run view 43212596901 --repo EricXu-0805/CAACI_Community_Marketplace_Bazaar`
- 计数: conclusion failure。Type-check、Build H5、Build mp-weixin success；Boundary regressions 1997 tests / 1996 pass / 0 fail / 1 skipped；Smoke (public page sweep) 437 passed / 2 failed / 6 skipped，失败为 pages/plaza/index 浅色、深色各一次 400「[plaza] fetch posts failed」；Smoke (protected staging account)、Production release readiness skipped [CI run#43212596901]
- ci_run_url: https://github.com/EricXu-0805/CAACI_Community_Marketplace_Bazaar/actions/runs/43212596901
- 未测项: 日志里看不到 400 的响应体。「候选库缺 title、category 列」是由 usePlaza.ts:73-74 的 POST_COLUMNS 和 staging-smoke 未应用 20261112120000 推断的；预检 verify-public-read-schema.mjs:20 没查这两列，所以放行到浏览器阶段 [源码 005ca9d]
- 下一条: P2.1（预检）、P2.5（冻结迁移）、P2.6（Eric 应用后重跑）

### L03 · 2026-11-12 时刻未记录 · tony-ws 环境搭建与 005ca9d 本地全量
- task_id: —（P1.1 的前置）
- code_sha: 005ca9d6b5ac23346dfeb38f3deb95984bffd27b
- docs_sha: 4e459bd81df766b15c97b85109ffbb7067c7ebcd
- 环境: 本地 tony-ws：Ubuntu 26.04.1、内核 7.0、i7-5930K 12 线程、30 GiB 内存（约 18 GiB 可用）、根盘约 314 GB 空闲、时区 UTC；用户 guoyi，无 sudo，家目录 750，.bashrc 设 umask 022；rootless podman 5.7（--userns=keep-id 可用）；与 Tony、danny 共用；经 WireGuard 与 ssh 别名 tony-ws 访问
- 命令: `~/work/illini-dev-env/run-checks.sh ~/work/illini install typecheck h5 mp migrations test smoke`
- 计数: install、typecheck、h5、mp、migrations 退出 0；test 1997 = 1996 pass / 0 fail / 1 skipped；smoke（community-post-topics.spec.ts、plaza-attach-picker-is-modal.spec.ts）9 passed。首轮 14 个失败都是环境原因（缺 en_US.UTF-8、目录组可写），修好后重跑通过。新镜像第一次 keep-id 运行约 10 分钟做 ID 映射，之后全量约 100 秒 [本地测：~/work/illini-dev-env/logs/]
- ci_run_url: —
- 未测项: L-SQL 全链回放；S-1；Playwright 1.65；Containerfile 与 run-checks.sh 的 sha256（P1.9 ④）
- 下一条: P1.1
- 附：镜像 localhost/illini-dev:pw1.60-node22-pg17 = mcr.microsoft.com/playwright:v1.60.0-noble 加 Node 22.23.5、npm 10.8.2、PostgreSQL 17.11、en_US.UTF-8，Containerfile 与 run-checks.sh 在 ~/work/illini-dev-env/。主机默认 Node 22.23.5（~/.local/opt/node 软链）+ npm 10.8.2，另有 Node 26.13.0。gh 以 EricXu-0805 登录，细粒度令牌只限本仓库（D-07）。Vercel CLI 65.15.0（node22 前缀）登录 ericxu-0805，team ericxu-0805s-projects（Pro），telemetry 关闭，家目录没有 .vercel。仓库 ~/work/illini 在 codex/community-topics-20261112 @005ca9d，~/work/illini-docs 是 worktree，在 codex/community-platform-v4-20261112 @4e459bd。OMO = OmO Native 5.1.68（5.1.69 未升级），tmux 会话 omo；Claude 号池 4 个 CAACI Team 号，fill-first，顺序 default → account-2 → account-3 → account-4；ChatGPT 2 个号（default admin@caaciorg.com、login-2 dev@caaciorg.onmicrosoft.com，都走 SIWC）；备用链 opus-5-5 / fable-5-2 → gpt-6-astra、sonnet-5-5 → gpt-6.1-sol、haiku-5-5 → gpt-6-luna-fast。omo 的 `/gpt-account add` 有 device ID bug，加 ChatGPT 号改用 `/login chatgpt-subscription`（追加，不覆盖）。

### L04 · 2026-11-12 13:09 CT 前 · V4 审核完成
- task_id: —（V5 的输入）
- code_sha: 对照 Illini main 7b18f20、P2 分支 005ca9d、caaciorg f62f62f
- docs_sha: 4e459bd81df766b15c97b85109ffbb7067c7ebcd（被审的 V4）
- 环境: 本地 Eric 的 Mac，只读
- 命令: 6 个只读审核 agent（product-ux、engineering、integration、execution、writing、design-direction）各审一个角度，1 个汇总 agent 对照源码逐条核实、去重、排序
- 计数: 20 条发现全部核实（7 阻断 / 12 重要 / 1 次要），15 处事实更正 [源码 005ca9d]
- ci_run_url: —
- 未测项: 六份原文 2026-11-12 只在 Eric 的 Mac（/Users/xiaogangxu/Projects/CAACI_Community_Marketplace_Bazaar/docs/community-platform/review/V4_REVIEW_2026-11-12.raw.json），还没放进 appendix/review/
- 下一条: Eric 决定（L06）

### L05 · 2026-11-12 13:09 CT 前 · 改名、首页、冷启动法律调研
- task_id: —（V5 的输入）
- code_sha: 7b18f20（改名影响面）
- docs_sha: —
- 环境: 公开网页只读（dig、注册局 WHOIS/RDAP、官方条款页）
- 命令: 人工与 agent 只读调研，产出 appendix/research/naming.md、homepage.md、cold-start-legal.md（复核稿）、cold-start-legal-original.md、naming-homepage-legal.raw.json
- 计数: naming.md 查 8 个候选名、按 .com/.org/.net/.app 查域名，改名影响 55 个文件 242 行；cold-start-legal.md 改 6 处事实、风险矩阵加 3 行、补 5 处遗漏
- ci_run_url: —
- 未测项: naming.md 的 55 / 242 没写检索式，BRAND 任务的 DoD 改用 L07 的命令；cold-start-legal.md「这次仍未核实」列了 8 项（含小程序论坛类目资质）
- 下一条: Eric 决定（L06）

### L06 · 2026-11-12 时刻未记录 · Eric 决定 D-01–D-27
- task_id: —
- code_sha: —
- docs_sha: —
- 环境: 真人（Eric 弹窗选择；D-20 由 Eric 与 CAACI 主席讨论后选定；D-07 是 tony-ws 核对结果）
- 命令: —
- 计数: 已定 27 项，全文与原话见 DECISIONS.md「已定」[真人：Eric]
- ci_run_url: —
- 未测项: —
- 下一条: V5 文档（L10）

### L07 · 2026-11-12 时刻未记录 · 远端、demo 与源码基线核对
- task_id: —（BRAND.2、BRAND.3、LEGAL.2、P1.3、P1.4 的基线）
- code_sha: 005ca9d6b5ac23346dfeb38f3deb95984bffd27b（基线计数在 7b18f20 与 005ca9d 上相同）
- docs_sha: 4e459bd81df766b15c97b85109ffbb7067c7ebcd
- 环境: 本地 Eric 的 Mac；公开网址
- 命令: `git ls-remote origin`；`curl -sI https://illini-community-demo.vercel.app/`；BACKLOG BRAND.2 ⑤、BRAND.3 ②、LEGAL.2 ⑤、P1.3 ②、P1.4 ③ 里的 git grep 命令
- 计数: main = 7b18f2052e52a4268c25407d0584748477cbf978；codex/community-topics-20261112 = 005ca9d6b5ac23346dfeb38f3deb95984bffd27b；codex/community-platform-v4-20261112 = 4e459bd81df766b15c97b85109ffbb7067c7ebcd；codex/community-plan-v5 远端不存在。7b18f20..005ca9d 共 3 个提交（e4c776b 功能、c52badf CI 固定 ubuntu-24.04、005ca9d 测试），20 个文件 +1165/−34。品牌字符串去注释后 76 行 / 19 个文件，app/src/legal 另有 17 行；徽章措辞 10 行（zh 6、en 4）；旧品牌色 #C74A2F / rgba(199,74,47) 在界面代码 15 行；写死 /usr/lib/postgresql/17/bin 的测试文件 33 个，读 PG_BIN_DIR 的 2 个 [源码 005ca9d]；demo 返回 HTTP 200，内容是 V4 原型 [生产]
- ci_run_url: —
- 未测项: —
- 下一条: P1.1

### L08 · 2026-11-12 14:18 CT · 三张视觉稿 A/B/C
- task_id: HOME.1（①–③）
- code_sha: 渲染用 /Users/xiaogangxu/Downloads/CAACI/Community-Platform/implementation/app 的 Playwright 1.60.0（自带 Chromium 148）
- docs_sha: 4e459bd（design/ 未提交）
- 环境: 本地 Eric 的 Mac
- 命令: 生成脚本 content.mjs、svg.mjs、css.mjs、build.mjs、shoot.cjs、menus.cjs（只在 Eric 的 Mac 会话临时目录，未入库）
- 计数: design/direction-a.html 304 行、direction-b.html 337 行、direction-c.html 353 行，README 113 行，screenshots/ 27 张 PNG（91,833–813,085 字节）。12 个页面×视口组合：<12px 文本节点 0；最小文字对比度 4.74:1，低于 4.5:1 的 0 个（分隔点「·」按设计排除，1.9–2.2:1）；390 宽横向溢出 0px；1280 下第二行板块卡底边 A 614px、B 522px、C 596px [本地测]
- ci_run_url: —
- 未测项: axe（对比度由脚本计算）；Windows、Android、微信小程序渲染；深色与英文界面（没画）；C 的 CSS column-count 在 mp-weixin；真人评审。生成脚本不在仓库，后续改稿要三份 HTML 同步手改
- 下一条: D-35（Eric 三选一）

### L09 · 2026-11-12 时刻未记录 · 活动区设计与来源实测
- task_id: —（P4 的输入）
- code_sha: Illini 7b18f20、005ca9d；caaciorg f62f62f
- docs_sha: —
- 环境: 公开网址只读（calendars.illinois.edu、caaciorg.com，每个地址请求一次）
- 命令: 只读 GET；读 caaciorg 源码
- 计数: caaciorg.com `/api/volunteer` 返回 0 场未结束活动；calendars.illinois.edu 3715/33558080 单条 ICS 返回 200 text/calendar（1,359 字节），不存在的 id 返回 404；其余实测数字写在 ENGINEERING §9.3 [生产]
- ci_run_url: —
- 未测项: 被撤下的校历活动访问单条 ICS 返回什么；从 Vercel 出口请求 caaciorg.com 会不会被 Cloudflare 拦截（Mac 出口返回 200）
- 下一条: P4.1、D-31、D-33

### L10 · 2026-11-12 14:45 CT · V5 文档写入本机 worktree
- task_id: —（D-14）
- code_sha: 005ca9d6b5ac23346dfeb38f3deb95984bffd27b
- docs_sha: 4e459bd81df766b15c97b85109ffbb7067c7ebcd（V5 文件未提交、未推送）
- 环境: 本地 Eric 的 Mac，/Users/xiaogangxu/Downloads/CAACI/Community-Platform/plan-v5（分支 codex/community-plan-v5）
- 命令: 本条写入 README.md、STATUS.md、STATUS_LOG.md、DECISIONS.md、OMO_PROMPT.md；BACKLOG.md、SPEC.md、ENGINEERING.md、RUNBOOK.md 由同日另外的编写步骤写入
- 计数: README 59 行、STATUS 79 行
- ci_run_url: —
- 未测项: 9 个文件之间的链接、任务编号、D 编号一致性没有自动检查；appendix/ 与 design/ 未提交；根目录 V4 旧文件尚未移入 appendix/history/
- 下一条: E1（Eric 审阅后推送并开草稿 PR）→ P1.1

### L11 · 2026-11-12 16:05 CT · V5 十个文件交叉核对与 V4 材料归档
- task_id: —（D-14）
- code_sha: 005ca9d6b5ac23346dfeb38f3deb95984bffd27b
- docs_sha: 4e459bd81df766b15c97b85109ffbb7067c7ebcd（V5 文件与本条改动未提交、未推送）
- 环境: 本地 Eric 的 Mac，/Users/xiaogangxu/Downloads/CAACI/Community-Platform/plan-v5（分支 codex/community-plan-v5）
- 命令: 对 README、STATUS、STATUS_LOG、DECISIONS、OMO_PROMPT、SPEC、ENGINEERING、BACKLOG、RUNBOOK、design/README 逐条核对术语、编号、SHA、路径和章节引用；在 7b18f20 与 005ca9d 上重跑 BACKLOG 里的基线 grep；`git rm` 14 份 HTML 镜像和 release/public-demo/（11 个文件）；`git mv` V4 的 PLAN、VERIFICATION、handoff/、release/、research/ 到 appendix/history/v4/，revisions/v3 到 appendix/history/v3/，prototype/ 到 appendix/prototype/；复制 V2 全文到 appendix/history/v2/、V4 审核原始 JSON 到 appendix/review/
- 计数: 基线与 BACKLOG 一致：品牌字符串 76 行 / 19 个文件（7b18f20、005ca9d 相同），legal 17 行，徽章 10 行，旧品牌色 15 行，写死 PG 路径 32 个文件（7b18f20）/ 33 个（005ca9d），zh.ts「广场」12 行（过滤后 9），「评论」18 行，迁移 181 个（005ca9d）[源码 005ca9d]。文档间链接 0 个断链 [本地测]
- ci_run_url: —
- 未测项: BACKLOG、RUNBOOK 里的命令都没有在 tony-ws 上跑过；「§x」式章节引用只核对了编号存在，没有逐句核对被引内容
- 下一条: E1（Eric 审阅后推送并开草稿 PR）→ P1.1

### L12 · 2026-11-12 23:16 CT · V5 终稿一致性核对与修正
- task_id: —（D-14）
- code_sha: 005ca9d6b5ac23346dfeb38f3deb95984bffd27b
- docs_sha: 4e459bd81df766b15c97b85109ffbb7067c7ebcd（V5 文件与本条改动未提交、未推送）
- 环境: 本地 Eric 的 Mac，/Users/xiaogangxu/Downloads/CAACI/Community-Platform/plan-v5（分支 codex/community-plan-v5）
- 命令: 十个文件的相对链接与锚点脚本检查；「SPEC/ENGINEERING/RUNBOOK/BACKLOG §x」章节号检查；任务编号、D 编号、E 编号、SHA、run id 与 spine 逐项比对；在 7b18f20 与 005ca9d 上核对 usePlaza.ts、verify-public-read-schema.mjs、plaza/index.vue、zh.ts、ci.yml、uni.scss、App.vue、manifest.sha256、仓库 RUNBOOK.md 的行号；`git -C <plan-v5> ls-remote --heads origin`
- 计数: 断链 0；不存在的章节号 0；不在 spine 里的任务编号 0，D 编号只有 D-01–D-41，E 编号只有 E1–E14；迁移 181 个、写死 PG 路径 32 个（7b18f20）/ 33 个（005ca9d）与 BACKLOG 一致 [源码 005ca9d]。远端 codex/community-platform-v4-20261112 = 4e459bd、codex/community-topics-20261112 = 005ca9d，codex/community-plan-v5 仍不存在 [本地测]。改了 11 处：RUNBOOK §2 读 next_task_id 的 grep 与 STATUS 的反引号格式对不上；§2.1 重复执行会因分支已存在而报错；E1 缺提交步骤（V5 文件是未跟踪文件）；run-checks.sh 备份名写成 P1.9 而实际在 P1.2 替换；§13 Vercel 护栏回退与 BACKLOG P1.13 互相指向；P1.9 存档清单含 P1.10–P1.13 才建的脚本；SPEC 衬线「22px 以上」与 20px 日期数字、17px 字标冲突，CAACI 来源标签 D-35 前的样式没写；ENGINEERING §5.4 引了 BACKLOG 里不存在的 20260916210800；README 带了 SHA；DECISIONS D-29 的 ci.yml 与仓库 RUNBOOK 行号没注明对应的提交。design/README.md 的衬线字号和「选定前怎么排版」两句改成指向 SPEC §9.1、§9.2
- ci_run_url: —
- 未测项: BACKLOG、RUNBOOK 的命令在 tony-ws 上都没跑过；只核对了被引用行号的一部分（上面列出的文件）
- 下一条: E1（Eric 审阅后提交、推送并开草稿 PR）→ P1.1

### L13 · 2026-11-12 23:25 CT · E1 完成：V5 提交、推送、开草稿 PR
- task_id: E1（D-14）
- code_sha: 005ca9d6b5ac23346dfeb38f3deb95984bffd27b
- docs_sha: 617055e7e573e53c40b73c25b2153a3b00d07e5f
- 环境: 本地 Eric 的 Mac，/Users/xiaogangxu/Downloads/CAACI/Community-Platform/plan-v5（分支 codex/community-plan-v5）
- 命令: 提交前对 docs/community-platform 做密钥扫描；`git add -A docs/community-platform && git commit`；`git push -u origin codex/community-plan-v5`；`gh pr create --draft --base main --head codex/community-plan-v5`；`git ls-remote --heads origin`
- 计数: 密钥扫描 0 命中 [本地测]。远端 codex/community-plan-v5 = 617055e、codex/community-topics-20261112 = 005ca9d、main = 7b18f20 [本地测]。PR #370 草稿 OPEN，base main；检查 1 项 skipped（文档改动）[本地测：gh]
- ci_run_url: —
- 未测项: tony-ws 上 ~/work/illini-docs 还在 4e459bd，切换由 P1.1 ④ 做；本条改动（STATUS、本条、OMO_PROMPT 第 3 行）是 617055e 之后的单独提交
- 下一条: P1.1

### L14 · 2026-11-12 23:40 CT · tony-ws 上 gh pr checks 返回 403，CI 读法改走 Actions 接口
- task_id: —（P1.1 前的环境核对）
- code_sha: 005ca9d6b5ac23346dfeb38f3deb95984bffd27b
- docs_sha: 3b2ac973892e84a14559282a5f16f419cb1a9543
- 环境: 本地 tony-ws（gh 登录 EricXu-0805，细粒度令牌）
- 命令: `gh pr checks 369`；`gh api repos/$REPO/commits/005ca9d/check-runs`；`gh api repos/$REPO/commits/005ca9d/status`；`gh run list --branch codex/community-topics-20261112 --workflow ci.yml --event pull_request --limit 1`；`gh run view 43212596901 --json headSha,status,conclusion,jobs`；`gh run watch 43212596901`
- 计数: gh pr checks 与 check-runs 接口都返回 403「Resource not accessible by personal access token」；commit status、Actions 的 run 列表、run view、run watch 都可读 [本地测]。run 43212596901 headSha 005ca9d，7 个 job：Type-check、Boundary regressions、Build H5、Build mp-weixin 为 success，Smoke (public page sweep) 为 failure，另两个 skipped，与 STATUS 的 CI 表一致 [CI run#43212596901]
- ci_run_url: https://github.com/EricXu-0805/CAACI_Community_Marketplace_Bazaar/actions/runs/43212596901
- 未测项: 没有试给令牌加 Checks 权限；改走 Actions 接口后不需要。OMO_PROMPT 第 3 条、RUNBOOK §7、BACKLOG P1.7 / P2.6 / P2.13 / P3.7 的 DoD、ENGINEERING CI 表的 skipping 都已改成 Actions 接口的写法（success / failure / skipped）
- 下一条: P1.1

### L15 · 2026-11-12 23:30 CT · P1.1 工作站、仓库与登录状态核对通过
- task_id: P1.1
- code_sha: 005ca9d6b5ac23346dfeb38f3deb95984bffd27b
- docs_sha: 29b50d884b359e5dcce5c9cf4f9943fc8787da76
- 环境: 本地 tony-ws
- 命令: OMO 启动的五条预检（原样输出见「附」）；RUNBOOK §2 开工核对整段与 §2.1，输出在 ~/work/evidence/P1.1/20261113T053016Z-preflight.txt（gh auth status 只取计数，没有含 Token 的行）
- 计数: ① node v22.23.5；② gh 登录 EricXu-0805 计数 1；③ ~/work/illini status --porcelain 无输出，HEAD = @{u} = 005ca9d6b5ac23346dfeb38f3deb95984bffd27b；④ ~/work/illini-docs 的 @{u} 是 origin/codex/community-plan-v5，HEAD 29b50d8；⑤ vercel whoami 输出 ericxu-0805，find ~/work -name .vercel -type d 无输出；⑥ podman images 有 localhost/illini-dev:pw1.60-node22-pg17。另：npm 10.8.2（已知偏差，P1.2 ④ 处理）、umask 0022、podman 5.7.0、残留容器 0、df 空闲 291G [本地测]
- ci_run_url: https://github.com/EricXu-0805/CAACI_Community_Marketplace_Bazaar/actions/runs/43212596901（headSha 005ca9d，conclusion failure，与 STATUS CI 表一致）
- 未测项: 无
- 下一条: P1.2
- 附（五条预检原样输出）:
  1. `git -C ~/work/illini fetch origin && git -C ~/work/illini status --porcelain && git -C ~/work/illini rev-parse HEAD` → `005ca9d6b5ac23346dfeb38f3deb95984bffd27b`
  2. `git -C ~/work/illini-docs fetch origin && git -C ~/work/illini-docs switch --track origin/codex/community-plan-v5` → `Switched to a new branch 'codex/community-plan-v5'` / `branch 'codex/community-plan-v5' set up to track 'origin/codex/community-plan-v5'.`
  3. `gh run list --repo EricXu-0805/CAACI_Community_Marketplace_Bazaar --branch codex/community-topics-20261112 --workflow ci.yml --event pull_request --limit 1 --json databaseId,headSha,conclusion` → `[{"conclusion":"failure","databaseId":43212596901,"headSha":"005ca9d6b5ac23346dfeb38f3deb95984bffd27b"}]`
  4. `node -v && npm -v` → `v22.23.5` / `10.8.2`
  5. `cat ~/work/illini-docs/docs/community-platform/STATUS.md` → 与材料分支 29b50d8 上的 STATUS.md 相同（写于 2026-11-12 23:25 CT，next_task_id: P1.1）

### L16 · 2026-11-13 00:03 CT · P1.2 npm 版本声明对齐 CI，宿主机 npm 恢复 10.9.9
- task_id: P1.2
- code_sha: affb8ac38e8a42cb7396f45c8e73f7a6ffdf539c（codex/config-fixes-20261112，与 P1.3、P1.4 一起推送，远端 head cc63ab5）
- docs_sha: d168faff0e221ead412b78abb9c32db5e920a5fd
- 环境: 本地 tony-ws，镜像 localhost/illini-dev:pw1.60-node22-pg17
- 命令: 按 RUNBOOK §4.3 ①② 装新 run-checks.sh（sha256 a813612b…a14b，备份 run-checks.sh.before-P1.2-20261112）与 mp-size.mjs（sha256 7708271c…60e1），`run-checks.sh --selftest` 三行都符合；`git worktree add -b codex/config-fixes-20261112 ~/work/illini-config origin/main`；NPMV 取自 run 43212596901 的 Type-check job 日志（`gh run view --log` 返回空，tony-ws 的 /tmp/gh-cli-cache 属于另一个用户，改用 TMPDIR=~/.cache/omo-tmp 和 `gh api repos/$REPO/actions/jobs/131163844850/logs`）；RUNBOOK §2.2 换宿主机 npm（备份 ~/.local/opt/npm-10.8.2.before-P1.2-20261112）；`~/work/illini-dev-env/run-checks.sh ~/work/illini-config install`，log ~/work/illini-dev-env/logs/check-20261113T053227Z.log；证据 ~/work/evidence/P1.2/；`git push -u origin codex/config-fixes-20261112`（pre-push 宿主机 boundary、typecheck、h5、mp 全过，日志 ~/work/evidence/P1.2/push-config.log）
- 计数: ① worktree HEAD 7b18f20；② 两份 package.json 都是 npm@10.9.9（CI 日志 `npm: 10.9.9`）；③ ci.yml 只多 Toolchain versions 一步；④ 宿主机 npm -v 10.9.9（交互 shell 同）；⑤ install rc=0（含 lockfile sha256 比对）；⑥ diffstat 只列 3 个文件 [本地测]
- ci_run_url: —（ci.yml 只在 pull_request 到 main 时触发，P1.7 开 PR 后才有 run）
- 未测项: CI 上的 Toolchain versions 步骤（P1.7）
- 下一条: P1.3
- 附: 提交身份：tony-ws 没配 git 身份，用户跳过了这个问题，OMO 按判断用 `git -c user.name="OMO (tony-ws)" -c user.email="omo@tony-ws.invalid"` 逐条传入，不改 ~/.gitconfig。P1.1 第一次核对脚本的转义写坏，只有 node、podman 等只读命令报错退出，没有改动任何东西。

### L17 · 2026-11-13 00:03 CT · P1.3 缺 PostgreSQL 17 时 CI 失败，所有测试改用 postgresBinDir()
- task_id: P1.3
- code_sha: 7ec020a5dc886f6a1239c5a08f66d6326cb75889（codex/config-fixes-20261112）
- docs_sha: 76fb233b6be4179ee687e983d518280736c4f9d1
- 环境: 本地 tony-ws，镜像 pw1.60-node22-pg17
- 命令: 新增 scripts/_postgres-bin.mjs（postgresBinDir、LINUX_PG17_BIN）与 scripts/postgres-bin.test.mjs；31 个文件的查找改为 postgresBinDir()，删掉 PG16 回退和 PATH 搜索，并删掉因此不再用的导入；ci-hook-contract-boundary.test.mjs 对 ci.yml 的路径断言改用 LINUX_PG17_BIN；`RUN_CMD='cd app && PG_BIN_DIR=/nonexistent node --test ../scripts/admin-support-email-ledger.test.mjs' ~/work/illini-dev-env/run-checks.sh ~/work/illini-config cmd`（log check-20261113T053430Z-cmd.log）；`~/work/illini-dev-env/run-checks.sh ~/work/illini-config install test`（log check-20261113T053438Z.log）；证据 ~/work/evidence/P1.3/
- 计数: ① postgres-bin.test.mjs 5 tests / 5 pass（4 个子测试对应 4 种情况）；② 写死路径的文件 32 → 1（只剩 scripts/_postgres-bin.mjs）；③ cmd rc=1，日志含 `postgresql_17_required_in_ci: no initdb in /nonexistent`；④ TEST tests=1994 pass=1993 fail=0 skipped=1 pg_skips=0，唯一 SKIP 是 Vercel Build Output（main 基线 1989 + 新增 5）[本地测]
- ci_run_url: —（P1.7）
- 未测项: 无
- 下一条: P1.4
- 附: simulate-listing-recovery.mjs 不是测试但也写死了路径，一并改用 postgresBinDir()（它原本就在找不到时 assert 失败，行为不变）。

### L18 · 2026-11-13 00:03 CT · P1.4 品牌色统一 #B9452C
- task_id: P1.4
- code_sha: cc63ab59bc41a498adfba55cf91dc6a976c67cd4（codex/config-fixes-20261112）
- docs_sha: 8558860bf011b9f6b8d022b7e67a6a28b4ac8ecc
- 环境: 本地 tony-ws，镜像 pw1.60-node22-pg17
- 命令: uni.scss:16 改 #B9452C；App.vue、ChatThread.vue、pages/index、pages/post、pages/profile 的 rgba(199,74,47,…) 改 rgba(185,69,44,…)，透明度不变；BACKLOG 的旧色 grep（证据 ~/work/evidence/P1.4/*-oldcolor-{before,after}.txt）；`~/work/illini-dev-env/run-checks.sh ~/work/illini-config install typecheck h5 mp`（log check-20261113T054031Z.log）
- 计数: ① 旧色 grep 15 → 0；② illustrations、stickers 的 diff 为空，App.vue diff 里 E47B5F 计数 0；③ install、typecheck、h5、mp 全部 rc=0 [本地测]
- ci_run_url: —（P1.7）
- 未测项: 无
- 下一条: P1.5
- 附: 范围外仍有旧色 #C74A2F：api/auth/send-illini-code.js、api/meetup-notify.js、api/notification-digest.js、api/unsubscribe.js 的邮件内联样式，以及 supabase/email-templates 两个模板，另有 App.vue 3 行注释。P1.4 只管 app/src，没有改；建议在 BRAND.2（邮件显示名）时一并处理，或由 Eric 另定。

### L19 · 2026-11-13 00:03 CT · P1.5 Playwright 升到 1.65.0：STOP-8 后经 Eric 批准，fsevents 删除算在 D-16 范围内
- task_id: P1.5
- code_sha: 14b4e4ae60bfc953783b2b1f72b84ec549ed457d（codex/config-fixes-20261112，本地提交，P1.9 全量通过后再推）
- docs_sha: 095985f48edcc964406aea22b8539613676f223d
- 环境: 本地 tony-ws，宿主机 npm 10.9.9
- 命令: 第一次：`cd ~/work/illini-config/app && npm install --legacy-peer-deps --no-audit --no-fund --save-dev @playwright/test@^1.65.0`，DoD ② 的 grep 只列出 `-    "node_modules/playwright/node_modules/fsevents": {`，即第 4 个包，按 STOP-8 / §14 第 7 行停这条，补丁存 ~/work/evidence/P1.5/20261113T054220Z-p1.5-attempt.patch，两个文件退回 P1.4 状态。Eric 答复（经 Claude 代答）：「算在范围内……fsevents 是 Playwright 1.65 自己去掉的 macOS 可选依赖，属于 D-16 批准的 Playwright 升级本身带来的变化。lockfile 里如果还有这三个包和 fsevents 以外的变化，仍按 STOP-8 停」。第二次照同一命令重做，app/package.json 只保留版本行（npm 会把 devDependencies 重新排序，没有带进提交）；lockfile diff 存 ~/work/evidence/P1.5/20261113T055600Z-lock.diff（98 行）
- 计数: ① app/package.json 为 ^1.65.0；② lockfile 变化：@playwright/test、playwright、playwright-core 1.60.0→1.65.0（engines node >=18→>=20），删除 node_modules/playwright/node_modules/fsevents 2.3.2（playwright 不再声明 optionalDependencies fsevents），没有其他变化；③ ci.yml 无 ubuntu-24.04 [本地测]
- ci_run_url: —
- 未测项: ④ 等 P1.9 的 pw1.65 镜像；⑤ 等 P1.7 的 PR CI
- 下一条: P1.9

### L20 · 2026-11-13 00:03 CT · P1.13 Vercel CLI 护栏与 demo 项目关联；link 拉下的 .env.local 已删除
- task_id: P1.13
- code_sha: —（工作站任务，不改仓库）
- docs_sha: 78373c87403c6566cc1576955ef88ce8145f50d7
- 环境: 本地 tony-ws，Vercel CLI 65.15.0
- 命令: RUNBOOK §9 ①：护栏写入 ~/.local/bin/vercel（sha256 ff453b2636cb2ee2471dd09a60640704de604aba75bba7bccf8191174e5e1e7b），vc 链接；②：备份 ~/.bashrc.before-P1.13-20261112、~/.profile.before-P1.13-20261112，两文件末尾加 PATH 一行，Node 前缀的 vercel、vc 改指护栏；③：`vercel project ls`、`vercel inspect illini-community-demo.vercel.app`（证据 ~/work/evidence/P1.13/20261113T054239Z-*.txt，禁用标识计数 0），项目名写入 ~/.config/illini/vercel-demo-project（目录新建，700），`vercel link --yes --project=illini-community-demo --scope ericxu-0805s-projects`；自测 ~/work/evidence/P1.13/20261113T055524Z-guard.txt
- 计数: ① demo 项目名 illini-community-demo（生产部署 dpl_E3AmucjjeUZfCmPQ7NQRi2eiaAv6，别名 illini-community-demo.vercel.app）；② 新交互 shell 里 `vercel deploy --prod`、`vercel env pull`、直接调用 ~/.local/opt/node/bin/vercel deploy --prod、在 ~ 下 deploy 都被拒，exit=1；demo 目录内 VERCEL_REAL=/bin/echo 放行；whoami 为 ericxu-0805；③ find 只有 /home/guoyi/work/demo-publish/.vercel；④ ls -A 为 .gitignore、.vercel，没有 .env* [本地测]
- ci_run_url: —
- 未测项: 无
- 下一条: P1.9
- 附: STOP-7 一次：CLI 65.15.0 的 `vercel link --yes` 自动下载 demo 项目的短期 VERCEL_OIDC_TOKEN，写入 ~/work/demo-publish/.env.local（1377 字节）。OMO 没读内容，先 chmod 600 再停下提问；Eric（经 Claude 代答）答复「删文件并继续」，已直接 rm（不进回收站），证据文件里令牌计数 0。按同一答复，RUNBOOK §9 ③ 补了 link 之后删 .env*.local 的步骤（随 P1.2 的材料提交一并提交）；同一提交还按 PR #370 第二条留言改写了 DECISIONS 的 D-41。
