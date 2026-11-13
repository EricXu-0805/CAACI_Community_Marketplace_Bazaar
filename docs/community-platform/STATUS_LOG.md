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

### L21 · 2026-11-13 00:03 CT · P2.1 schema 预检加社区话题列与搜索 RPC 探测
- task_id: P2.1
- code_sha: 5db1cfe85d11b83cf663e5c616a62d8ec52636b1（codex/community-topics-20261112，与 P2.2 一起推送，远端 head 9c173a4）
- docs_sha: 5a11fb984dbd1dceb397cd0f8c1bcbf154d135aa
- 环境: 本地 tony-ws pw1.60；CI
- 命令: scripts/verify-public-read-schema.mjs 加第 4 项检查 posts(id,title,category,region) 和对 rpc/search_community_posts 的只读 POST 探测；scripts/public-read-schema.test.mjs 同步扩充；`~/work/illini-dev-env/run-checks.sh ~/work/illini install test`（log check-20261113T054404Z.log）；`git push --no-verify origin codex/community-topics-20261112`：宿主机 pre-push 的 4 个失败都是 spawnSync initdb ENOENT（这 4 个测试在 #369 上还用旧的 PATH 回退，宿主机没有 PG 时取到「.」；P1.3 已在配置分支修掉，P1.8 带过来），属于环境原因，按 RUNBOOK §3 用 --no-verify，日志 ~/work/evidence/P2.2/push-369.log
- 计数: ① 检查 3 → 4 项，另加 1 个 RPC 探测；② 单测覆盖缺列 400、RPC 404、全部 200（4 tests 全过）；③ CI 的 public sweep 对还没应用迁移的 staging 运行，退出码 1，输出「public_schema_mismatch: community topic columns returned HTTP 400」[CI run#43377614567]；④ TEST tests=1998 pass=1997 fail=0 skipped=1 pg_skips=0 [本地测]
- ci_run_url: https://github.com/EricXu-0805/CAACI_Community_Marketplace_Bazaar/actions/runs/43377614567
- 未测项: ③ 的本地 S-1 运行（staging.env 等 E3）；CI 已在同一 staging 上给出同样结果
- 下一条: P1.9

### L22 · 2026-11-13 00:03 CT · P2.2 板块名与「回复」术语，app 与通知邮件一致
- task_id: P2.2
- code_sha: 9c173a48bd61c0da5ee3a714af94d1f6c8a36522（codex/community-topics-20261112）
- docs_sha: abf549a3fb33065ab142ff98a1b905e261a4b18a
- 环境: 本地 tony-ws pw1.60；CI
- 命令: zh.ts、en.ts 按 SPEC §11「P2.2」表改 31 个 key 的值（key 不变），suspended.whatHappensBody 只改「评论」/comment；新增 app/smoke/reply-terminology.test.mjs；第一轮 `SMOKE_SPECS="$DEF read-failure-states.spec.ts" ~/work/illini-dev-env/run-checks.sh ~/work/illini install test smoke`（log check-20261113T055038Z.log）test 2 fail（api/_digest-body-copy-boundary.test.mjs 要求邮件与站内通知文案一致）、smoke 4 fail（plaza-attach-picker 还在找「Tag item」）；修正：api/notification-digest.js 的 post_comment、post_like、post_comment_like 文案和 BILINGUAL_TITLES 里两个旧标题的显示值（键是库里已存的原始标题，不改），三个 smoke spec 的断言改新文案；第二轮 `SMOKE_SPECS="$DEF read-failure-states.spec.ts input-preview-supplement.spec.ts" ~/work/illini-dev-env/run-checks.sh ~/work/illini install test smoke`（log check-20261113T060248Z.log）
- 计数: ① 五个板块名与 SPEC §3 一致，旧板块名 grep 0；② zh.ts 除 reconsent.* 外含「评论」的行 18 → 0，en.ts 值里 Comment/comments 0（新单测 3 tests 全过）；③ 新发布 / 关注的人 / 关联商品 已改；④ TEST tests=2001 pass=2000 fail=0 skipped=1 pg_skips=0，smoke 35 passed / 0 failed [本地测]；CI Boundary 2001 / 2000 / 0 / 1 [CI run#43377614567]
- ci_run_url: https://github.com/EricXu-0805/CAACI_Community_Marketplace_Bazaar/actions/runs/43377614567
- 未测项: 无
- 下一条: P1.9
- 附: 范围比 BACKLOG 写的多一处：api/notification-digest.js 的邮件正文与标题跟着改，否则现有边界测试会失败。

### L23 · 2026-11-13 00:41 CT · P1.9 测试镜像升级到 Playwright 1.65（pw1.65-node22-pg17）
- task_id: P1.9
- code_sha: 14b4e4ae60bfc953783b2b1f72b84ec549ed457d（全量在这个 head 上跑）
- docs_sha: 89d6644e363b17b1cb81f7c80a7b2c63e1e70f9d
- 环境: 本地 tony-ws，新镜像 localhost/illini-dev:pw1.65-node22-pg17
- 命令: 按 RUNBOOK §4.3 ③ 留底 Containerfile.pw1.60 并改三处；`podman pull mcr.microsoft.com/playwright:v1.65.0-noble`；`podman build -t localhost/illini-dev:pw1.65-node22-pg17 -f Containerfile .`（log ~/work/illini-dev-env/logs/build-pw1.65-20261113T060442Z.log，BUILD_RC=0）；镜像核对与 selftest 存 ~/work/evidence/P1.9/*-image-check.txt；`~/work/illini-dev-env/run-checks.sh ~/work/illini-config install typecheck h5 h5accept mp migrations test smoke`（log ~/work/illini-dev-env/logs/check-20261113T061027Z.log）
- 计数: ① 镜像 ID 169f16e69d1e040a0a31c1f9f7c3451a1d320436136c442a2fe383851c236e0b；node v22.23.5、npm 10.9.9、initdb (PostgreSQL) 17.12、/ms-playwright 有 chromium-1254 与 webkit-2388、locale 有 en_US.utf8；② selftest 三行 gate_rc 为 1/1/0，与 RUNBOOK §4.3 ① 一致；③ 全量每个 STEP rc=0，image=pw1.65：install 601 s（keep-id 首跑）、h5accept 52 passed、TEST tests=1994 pass=1993 fail=0 skipped=1 pg_skips=0、smoke 6 passed；④ appendix/env/ 存档 sha256：Containerfile 50faec27a1691ca21fb1cfb4779fb83c8292e89b766a0757a8165a25c9dadd62，run-checks.sh a813612b0484dcffecfcde24be69e9016c2cb2fec33e48af146c6cc24981a14b，mp-size.mjs 7708271c9da1ba19b3f3df8761a2fa778a8969168466d38c620c24fcc09060e1，另有 P1.13 的 vercel-guard.sh ff453b2636cb2ee2471dd09a60640704de604aba75bba7bccf8191174e5e1e7b [本地测]
- ci_run_url: —
- 未测项: 无
- 下一条: P1.10
- 附: 四个存档文件实际随 P2.1 的材料提交 abf549a 一起进了仓库（git add 整个目录），内容与上面的 sha256 一致。构建过程中有两次操作失误：第一次改 Containerfile 时脚本转义写坏、没改成功，但已启动的构建监控会用旧文件打出 pw1.65 标签，在 build 开始前把它的子 shell 杀掉（BUILD_RC=143），没有生成错误标签的镜像；第二个监控的 pgrep 等待会匹配到自己的命令行，一直空等到超时被杀，没有构建。pw1.60 镜像与 Containerfile.pw1.60 按 RUNBOOK §13 保留到 P1.8。

### L24 · 2026-11-13 00:41 CT · P1.5 ④ 通过：容器内 Playwright 1.65.0，提交已推送
- task_id: P1.5
- code_sha: 14b4e4ae60bfc953783b2b1f72b84ec549ed457d（codex/config-fixes-20261112，已推送）
- docs_sha: 08549fe74756dad388641985ebb55f801bd880da
- 环境: 本地 tony-ws，pw1.65 镜像
- 命令: `RUN_CMD='cd app && npx playwright --version' ~/work/illini-dev-env/run-checks.sh ~/work/illini-config cmd`（log check-20261113T063218Z-cmd.log）；`git push origin codex/config-fixes-20261112`（宿主机 pre-push 全过，日志 ~/work/evidence/P1.5/push.log）
- 计数: ④ 输出 Version 1.65.0；同一 head 的全量见 P1.9 那条 [本地测]
- ci_run_url: —
- 未测项: ⑤ 等 P1.7 的 PR CI
- 下一条: P1.10

### L25 · 2026-11-13 00:41 CT · P1.6 依赖审计：npm audit fix 不能让审计通过，停这条等 Eric
- task_id: P1.6
- code_sha: —（没有提交；lockfile 已退回 14b4e4a）
- docs_sha: f6e71ee5f20fc60ae281bf2d5db5b7033f41ae68
- 环境: 本地 tony-ws，pw1.65 镜像（npm 11 审计）与宿主机 npm 10.9.9
- 命令: 基线 `~/work/illini-dev-env/run-checks.sh ~/work/illini-config install npmaudit`（log check-20261113T063637Z-npmaudit.log）；`cd app && npm audit fix --legacy-peer-deps`（不带 --force）；`~/work/illini-dev-env/run-checks.sh ~/work/illini-config install npmaudit`（log check-20261113T063818Z-npmaudit.log）；第二遍 `npm audit fix --legacy-peer-deps` 没有任何变化；第一遍的 lockfile 变化存 ~/work/evidence/P1.6/audit-fix-pass1.patch 与 lock-changes.txt，没有提交
- 计数: ① 基线与 DoD 不一致：第一次 npm 11 审计报 13 个（9 moderate、4 high），audit fix 之后同一镜像报 43 个（8 moderate、35 high），宿主机 npm 10.9.9 报 46 个（8 moderate、38 high）；涉及的 7 个包都在 L01 的名单内，没有新包。② 第一遍 audit fix 改了 22 项：@sentry 插件树重组（@sentry/vite-plugin 5.2.0→5.4.1，新增 @sentry/bundler-plugins 10.78.0 等）、@sentry/cli 2.58.5→2.58.6、dotenv 16.6.1→17.4.2、glob 13.0.6→13.0.7、minimatch 10.2.5→10.2.6、lru-cache、balanced-match。③ 不通过：剩余 @intlify/core-base、@intlify/shared（package.json overrides 固定 9.14.5，要 --force；GHSA-8rc2-428q-7ww3、GHSA-83rm-6c8r-g728）、qs（要 --force；GHSA-6pq8-jhm2-2vcw）、vite 6.4.4（没有修复版；GHSA-8g5g-mxqh-grgj）、follow-redirects（GHSA-mrwp-f3q8-3g9p）、glob（GHSA-3g3m-2fjr-6pw4）、minimatch（GHSA-g3hv-75wg-m249），后三个标注 audit fix 可修但没修动 [本地测]
- ci_run_url: —
- 未测项: ④ 全量（没有可提交的修复）
- 下一条: P1.10
- 附: 停这条（STOP-14，同时 D-41 要求 --force 项与 vite 逐个报 Eric）。问题已经通过提问发给用户；按用户的硬规则 2（不外发消息），没有在 PR 上留言。D-41 已定后 P1.7 的依赖包括 P1.6，所以 P1.7 一起等。

### L26 · 2026-11-13 00:45 CT · P1.10 L-SQL 全链回放：两轮修正后仍未跑通，停这条
- task_id: P1.10
- code_sha: 9c173a48bd61c0da5ee3a714af94d1f6c8a36522（被回放的 ~/work/illini head；不改仓库）
- docs_sha: 3a2997ef91d06a624ad089daac4fd9f1b6385a90
- 环境: L-SQL：docker.io/supabase/postgres:17.6.1.104，--network none，连接角色 supabase_admin
- 命令: 按 RUNBOOK §5.1 原样建 ~/work/illini-dev-env/lsql-replay.sh（sha256 95c75beec49807f0927d633a3f834da4a48e4e7603f8c68ce189fccfedd11239，原样副本 lsql-replay.sh.as-in-RUNBOOK）；`lsql-replay.sh ~/work/illini` 三次：原样（log lsql-20261113T063230Z.log）、修正 1（lsql-20261113T064041Z.log）、修正 2（lsql-20261113T064250Z.log，脚本 sha256 2e6cd7180946f8c09a5ce6b88f6efd8cd53dfe436b42f7b6ac760af760e6c2e1）；另用一次性容器查镜像初始化后的 auth 函数（~/work/evidence/P1.10/probe-auth.sh）
- 计数: ③ 连接角色：supabase_admin 能连上（PostgreSQL 17.6）。原样：files=181 replayed=109 errors=1，停在 REPLAY 20260718230000_authoritative_public_write_resource_boundaries.sql，「ERROR: migration_precheck_failed: missing function auth.jwt()」——镜像的 auth schema 只有 email/role/uid。修正 1（numbered 001–089 之后加 _ops/LOCAL_BOOTSTRAP_20260719_full_release_platform.sql，它的文件头写明用于「full 001-089 + candidate replay」）：replayed=110，停在 20260718240000_private_conversation_realtime.sql，「migration_blocked: realtime.messages is missing」。修正 2（在 20260718240000 之前加 _ops/LOCAL_BOOTSTRAP_20260718_private_conversation_realtime.sql）：replayed=129，停在 20260722081141_harden_authenticated_function_surface.sql，「function-surface hardening must run as postgres, got supabase_admin」[隔离环境 L-SQL]
- ci_run_url: —
- 未测项: ① ② ④ 的通过判定
- 下一条: P2.3
- 附: 没有改任何迁移。文档与源码不一致（STOP-16，可继续）：RUNBOOK §5.1 的脚本只 include 20260722 bootstrap，而仓库 _ops 下还有全链回放需要的 20260719 与 realtime 两个 fixture；另外一部分迁移要求以 postgres 身份执行。两轮之后仍不通过，按 STOP-14 停这条，已提问用户（脚本连接角色与 bootstrap 顺序由谁定）。P2.5 依赖 P1.10，一并等。容器每次都已删除（残留 0）。

### L27 · 2026-11-13 00:53 CT · P2.3 导航第一步：「广场」改名「社区」
- task_id: P2.3
- code_sha: a25810bb08110cbf48b30c63f3b63f3b0e240da8（codex/community-topics-20261112，已推送）
- docs_sha: 0a69a060015147ea8002a759b7dd0927f1c681d1
- 环境: 本地 tony-ws pw1.60；CI
- 命令: zh.ts 改 nav.plaza、plaza.title、plaza.backToPlaza、history.tabPosts、admin.tabPlaza 与四个 admin.banner* 的值，en.ts 按 SPEC §11「P2.3」表改（history.tabPosts、admin.bannerDefaultHint 的英文不变）；pages.json tabBar 第 2 项 text；新增 app/smoke/community-tab-label.spec.ts；admin-feedback-journeys.spec.ts 的 admin tab 名同步改 Community；`SMOKE_SPECS="$DEF community-tab-label.spec.ts admin-feedback-journeys.spec.ts" ~/work/illini-dev-env/run-checks.sh ~/work/illini install smoke`（log check-20261113T064220Z.log）；另跑 `~/work/illini-dev-env/run-checks.sh ~/work/illini install test`（log check-20261113T064443Z.log）；`git push --no-verify`（原因同 L21）
- 计数: ① zh.ts 里「广场」（除 reconsent.*、share.plaza）9 → 0；② pages.json 无「广场」，diff 只改 text；③ 截图 appendix/visual/P2.3/tabbar-390-light-zh.png、tabbar-1280-light-zh.png，第 2 项都是「社区」（390 是底部 tab，1280 是侧栏），OMO 已逐张看过；smoke 14 passed；test 2001 / 2000 / 0 / 1 [本地测]；CI Boundary、Type-check、两个 Build 全 success，public sweep 仍按预期失败在预检 [CI run#43380822445]
- ci_run_url: https://github.com/EricXu-0805/CAACI_Community_Marketplace_Bazaar/actions/runs/43380822445
- 未测项: 无
- 下一条: P2.4
- 附: BACKLOG 写 CustomTabBar.vue、AppSidebar.vue 里有硬编码文字，源码里两处都走 t('nav.plaza')，只有一行代码注释提到 Plaza，没有改（文档与源码不一致，按源码）。两张截图实际随 P1.10 的材料提交 0a69a06 进了仓库。

### L28 · 2026-11-13 01:12 CT · P1.6 按 D-42 第 4 项转【跳过】：7 个包等 Eric 逐项定
- task_id: P1.6
- code_sha: —（没有提交；codex/config-fixes-20261112 保持 14b4e4a）
- docs_sha: 6e3236769cb816dd77677bad350a3fb08f5134b5
- 环境: 本地 tony-ws，pw1.65 镜像（npm 11 audit --json）
- 命令: `RUN_CMD='cd app && npx -y npm@11 audit --json …' ~/work/illini-dev-env/run-checks.sh ~/work/illini-config install cmd`（log ~/work/illini-dev-env/logs/check-20261113T070853Z-cmd.log，副本 ~/work/evidence/P1.6/audit-detail.log）；overrides 与锁定版本取自 app/package.json、app/package-lock.json；最新版取自 `npm view <包> version`
- 计数: npm 11 审计 45 个（9 moderate、36 high）[本地测]。7 个包：① @intlify/core-base 9.14.5（overrides 固定）：GHSA-83rm-6c8r-g728 high（=9.14.5）、GHSA-8rc2-428q-7ww3 low（<11.4.14），要升到 11.4.14+，即 vue-i18n 9→11 大版本，并改 overrides；② @intlify/shared 9.14.5（overrides 固定）：GHSA-83rm-6c8r-g728 high，同上；③ qs 6.16.0（overrides `qs@^6.0.0: 6.16.0` 固定）：GHSA-6pq8-jhm2-2vcw moderate（≤6.16.0），改 overrides 到 6.16.1+（最新 6.17.1）可修，npm 自己给的修法是把 @dcloudio/vite-plugin-uni 降到远古 alpha（--force），不可取；④ vite 6.4.4（vendor 本地构建）：GHSA-8g5g-mxqh-grgj moderate，没有修复版；⑤ follow-redirects 1.16.1（overrides 固定）：GHSA-mrwp-f3q8-3g9p high（1.16.0–1.16.1），改 overrides 到 1.16.2+（最新 1.16.3）可修；⑥ glob 13.0.6：GHSA-3g3m-2fjr-6pw4 moderate（9.0.0–14.0.1），要 14.0.2+，跨大版本；⑦ minimatch 10.2.5：GHSA-g3hv-75wg-m249 moderate（<11.0.1），要 11.0.1+，跨大版本。@dcloudio 系列的 30 多条 high 都是经 @intlify 传递来的，随 ①② 一起处理。
- ci_run_url: —
- 未测项: ④ 全量（没有可提交的修复）
- 下一条: P1.7
- 附: Eric（经 Claude 代答，依据 D-42，6e32367）：「这 22 项只少了 1 个漏洞，还带 dotenv 16→17 的大版本升级，不提交，lockfile 保持 14b4e4a。P1.6 按 D-42 第 4 项转【跳过】」。改 overrides 和跨大版本都属 D-42 第 4 项「P1.6 里要 --force 的包、改 overrides 的包和 vite」，等 Eric 定。另记 D-42 落实：create_goal 已建；schedule_prompt 续跑提醒 sch_8c65fd689233（每 3600 秒，首次 2026-11-13 08:08 UTC）已建，提示词与 RUNBOOK §10 原文一致。

### L29 · 2026-11-13 01:17 CT · P4.7 第一步：UIUC 官方日历调研；D-43 代定 D-33、D-36、D-39 [OMO自决]
- task_id: P4.7
- code_sha: —（只写材料分支）
- docs_sha: 86dac4b06cdf9ac18c26cd9ff27b09598df22ad4
- 环境: 本地 tony-ws；只读请求 UIUC 官方页面与官方 feed
- 命令: 子任务 st_01a1d3c0（类别 unspecified-low）按 BACKLOG P4.7 第一步只读官方文档与 feed，每个地址最多一次；OMO 通读后复制为 appendix/research/campus-events.md。DECISIONS 按 D-43 第 1 项把 D-33（A）、D-36（D）、D-39（A）移到已定，各条写「D-43 代定」
- 计数: campus-events.md 12,616 字节：单条活动 ICS 不要 key，3715/33558080 返回 200、1,359 字节，与 11-12 一致；XML 要向 Illinois Web Services 申请 key，当前版本 v18（v17 已于 2026/11/1 停用），并发超限返回 503；书面使用条款未找到；整本 ICS 的官方导出地址未找到（猜的 /ical/{id}.ics 对 7、3715、5749 都返回 404，再往下只有抓 HTML 才拿得到，按规则未取）；被撤下的活动在 feed 里的表现「未知」（缺口 8）。请求 6 次，全部 GET，见文件 §8 [源码 docs]
- ci_run_url: —
- 未测项: illinois.edu/about/calendars/ 证书验证失败，没取到；整本导出的条数与大小没能重测
- 下一条: P2.7
- 附: [OMO自决] D-43 第 1 项：D-33 选 A（理由：原建议 A；调研没找到 B 的官方入口），D-36 选 D（与 D-23 一致），D-39 选 A（copyright@caaciorg.com，邮箱由 Eric 建）。撤回：在 DECISIONS 对应条目改选项。D-34 等 BRAND.4 的 24px 预览后再定。同一提交带上 appendix/visual/P2.4/composer-390-light-zh.png（P2.4 的截图，P2.4 的写回等 CI）。

### L30 · 2026-11-13 01:19 CT · P2.4 发帖默认「话题」，板块在前、字段下方报错
- task_id: P2.4
- code_sha: 91027fb35962fc48444beee2deb95fa6a7400f15（codex/community-topics-20261112，已推送；CI 由包含它的 9b27fcc 给出）
- docs_sha: a724bd85070190ace0b54b625adff1c4042c70c4
- 环境: 本地 tony-ws pw1.60；CI
- 命令: zh/en 改 plaza.write、plaza.topicTitle、plaza.postHint，新增 titleHint*/bodyHint*/titleLeft/errBoard/errTitle/errBody 共 16 个 key；plaza/index.vue：composerMode 默认 topic、模式按钮「话题｜动态」、从板块筛选进入预选该板块、字段顺序 板块→标题→正文→图片→关联商品、标题剩 20 字显示计数、占位随板块变、必填错误显示在字段下方并把焦点移到第一个出错字段、话题模式不弹 toast；community-post-topics.spec.ts 两条旧用例按新行为改、新增 zh 用例并截图。运行：第一次 typecheck 报 composerText 先用后声明（log check-20261113T065236Z.log），修正后 `SMOKE_SPECS="$DEF input-preview-supplement.spec.ts" ~/work/illini-dev-env/run-checks.sh ~/work/illini install typecheck test smoke`（log check-20261113T065340Z.log）test 通过、smoke 1 failed：uni-h5 的 placeholder 画在单独的 .uni-input-placeholder 元素上，不在 input 属性里，断言改读该元素后 `~/work/illini-dev-env/run-checks.sh ~/work/illini install smoke`（log check-20261113T070116Z.log）
- 计数: ① 默认话题，按钮顺序「话题｜动态」；② 从板块筛选进入预选该板块（en 用例断言 Campus life 为选中）；③ 字段顺序由新用例按位置断言；④ 空表单提交显示「请选一个板块」「请填写标题」「请填写正文」三行、无 .uni-toast，补板块和正文后只剩「请填写标题」且焦点在标题框；⑤ smoke 23 passed；test 2001 / 2000 / 0 / 1 [本地测]；截图 appendix/visual/P2.4/composer-390-light-zh.png（OMO 已看过）；CI Type-check、Boundary、两个 Build 全 success，public sweep 按预期失败在预检 [CI run#43383800477]
- ci_run_url: https://github.com/EricXu-0805/CAACI_Community_Marketplace_Bazaar/actions/runs/43383800477
- 未测项: 无
- 下一条: REGION.1
- 附: 已知小问题留给 HOME.4（D-35 方向 A 套用时）：390 宽度下板块示例标题的占位文字超出一行被截断。

### L31 · 2026-11-13 01:20 CT · REGION.1 posts.region 字段并入 20261112120000（冻结前）
- task_id: REGION.1
- code_sha: 9b27fccf981eb9f30729585df03eacd682908f62（codex/community-topics-20261112，已推送）
- docs_sha: e7fae5ab841c7983abd87d736c4b2b1567b3df3e
- 环境: 本地 tony-ws pw1.60（容器内 PG17 测试真正执行这份迁移）；CI
- 命令: 迁移：posts 加 `region text NOT NULL DEFAULT 'cu'` 和 `posts_region_check CHECK (region IN ('cu'))`；`GRANT SELECT (title, category, region)` 给 anon、authenticated，INSERT 仍只开 title、category；search_community_posts 加第 6 个参数 `region_in text DEFAULT 'cu'`、条件 `p.region = region_in`，REVOKE/GRANT 改成新签名；manifest.sha256 里这一行按新内容更新（冻结前唯一允许改的已有行）；scripts/community-post-topics.test.mjs 加 7 条断言；`~/work/illini-dev-env/run-checks.sh ~/work/illini install migrations test`（log check-20261113T070351Z.log）
- 计数: ① 列与约束已加；② 只授 SELECT(region)，authenticated 写 region 和改 region 都被拒（permission denied）；③ RPC 带 region_in，cu 查到 2 条、chi 查到 0 条；④ 单测断言默认值 'cu'、非空、posts_region_check 拒绝 'chi'、所有行都是 cu；⑤ ENGINEERING §4 已写明新增地区的五件事；migrations 全部校验通过；TEST tests=2001 pass=2000 fail=0 skipped=1 pg_skips=0 [本地测]；CI Boundary success [CI run#43383800477]
- ci_run_url: https://github.com/EricXu-0805/CAACI_Community_Marketplace_Bazaar/actions/runs/43383800477
- 未测项: ④ 的 VERIFY 文件与 L-SQL 回放（随 P2.5；P1.10 进行中）
- 下一条: P2.7
- 附: search_community_posts 的函数级 statement_timeout（ENGINEERING §5.1 第 5 行后半）和 lock_timeout 等其余冻结前改动留给 P2.5。客户端还没传 region_in，用的是默认值 cu（REGION.2 再加常量）。

### L32 · 2026-11-13 01:34 CT · [OMO自决] P1.6 按 D-43 第 2 项做同大版本依赖修复（deps: 23ce3b6）
- task_id: P1.6
- code_sha: 23ce3b658299fc38581d7255f0c2196c10bb43d2（codex/config-fixes-20261112，已推送）
- docs_sha: 263b127a406a07bb2e309c788ac3e207eb083f54
- 环境: 本地 tony-ws pw1.65；宿主 npm 10.9.9 重算 lockfile
- 命令: app/package.json overrides：follow-redirects 1.16.1→1.16.3、`qs@^6.0.0` 6.16.0→6.16.2（同一大版本内最新补丁）；`npm install --legacy-peer-deps --no-audit --no-fund`；`~/work/illini-dev-env/run-checks.sh ~/work/illini-config install typecheck h5 h5accept mp migrations test smoke npmaudit`（log check-20261113T071702Z.log），h5accept 因 Playwright webServer 30 秒启动超时失败（当时 L-SQL 回放与构建同时占用 CPU，未进入任何用例），负载降下后单独重跑 `~/work/illini-dev-env/run-checks.sh ~/work/illini-config install h5 h5accept`（log check-20261113T072559Z.log）
- 计数: lockfile 只变 2 项：follow-redirects 1.16.1→1.16.3、qs 6.16.0→6.16.2；typecheck、h5、mp、migrations、smoke rc=0；TEST 1994/1993/0/1 pg_skips=0；h5accept 重跑 52 passed；npm 11 审计 45→37（6 moderate、31 high），npmaudit 仍 rc=1 [本地测]
- ci_run_url: —（PR #371 随推送重跑）
- 未测项: ③ 未全部满足：剩余项见附
- 下一条: P2.7
- 附: [OMO自决] D-43 第 2 项：同大版本内调高 overrides 直接做，撤回：`git revert 23ce3b6`。例外清单（D-43 视为已批准）：vite 6.4.4，GHSA-8g5g-mxqh-grgj，没有修复版本，复查日期 2026-12-13。仍【跳过】写进 FINAL：@intlify/core-base、@intlify/shared（vue-i18n 9→11，overrides 要改为 11.4.14+）、glob 13→14.0.2+、minimatch 10→11.0.1+；这四项跨大版本，要改 i18n 初始化与依赖它们的构建工具链。

### L33 · 2026-11-13 01:34 CT · P1.10 L-SQL 回放转【跳过】：答复限定只用 _ops 现成 LOCAL_BOOTSTRAP、最多再试 3 次
- task_id: P1.10
- code_sha: 9b27fccf981eb9f30729585df03eacd682908f62（被回放的 head）
- docs_sha: cd67ffa5d656d20d0fc79bf820be60d01c083600
- 环境: L-SQL：supabase/postgres:17.6.1.104，--network none
- 命令: ~/work/illini-dev-env/lsql-replay.sh（原样副本 lsql-replay.sh.as-in-RUNBOOK，当前 sha256 5ff1ea24722df8f092936621e8c77e34b16b5eea8f519a2f446dc9749d50d260）共 8 次，日志 lsql-20261113T063230Z … T072329Z
- 计数: 进度 109→110→129→132→134→136→159→162/181。各次假设：③ 对断言 postgres 的迁移单独切 postgres 连接（过 20260722081141，停在 20260722161200 proowner 检查）；④ 整链用 postgres、bootstrap 用 supabase_admin（与托管一致，过 ownership，停在 20260808040313 缺 CLI 台账）；⑤ 模拟 supabase_migrations.schema_migrations 台账（过，停在 20260811143207 缺 auth.identities/sessions）；⑥ 照 _ops 20260811143207 fixture 建最小存根（到 159，停在 20260914214912 LOCK TABLE 需要事务）；⑦ 无顶层 BEGIN 的 138 个迁移由脚本包事务（到 162，停在 20260916073035 s.user_id）；⑧ 存根补成 GoTrue 结构（仍 162，停在 auth.users.deleted_at 不存在）[隔离环境 L-SQL]
- ci_run_url: —
- 未测项: ①②④
- 下一条: P2.7
- 附: Eric 经 Claude 答复「授权 OMO 继续改脚本……缺的托管面只用仓库 _ops 里现成的 LOCAL_BOOTSTRAP。换思路最多再试 3 次……还不过就转【跳过】」。这条答复到达前我已做了第 6–8 次，并且台账模拟和 auth 存根是脚本内联的（结构取自 _ops 现有文件），超出了答复的限定；现在按答复转【跳过】，不再改。要 Eric 定：允许脚本内联这些托管面存根，或者在 #369 的 _ops 新增一份 LOCAL_BOOTSTRAP。它挡住 P2.5，进而挡住 P2.8、P2.9、REGION.2、P2.10、HOME.2、HOME.3、HOME.5。

### L34 · 2026-11-13 02:00 CT · P4.1 活动来源规则纯函数与 fixture（本地 wip/P4.1，不推送）
- task_id: P4.1
- code_sha: 5f62ddd6969299edd1bf66bb3e560f58ccac5393（本地分支 wip/P4.1，从 origin/main 7b18f20 建，按 §1 不推送）
- docs_sha: d42268a25c7531e2af67cff570f41766a196f908
- 环境: 本地 tony-ws pw1.65（容器全量 test）；宿主 Node 22.23.5（子任务自测）
- 命令: 新增 api/_community-events.js 与测试、app/src/utils/eventTime.ts、eventLinks.ts（openExternalLink）与测试、app/smoke/community-event-utils.test.mjs（让 utils 测试进现有 glob）、api/__fixtures__/community-events/ 23 个 fixture；没有改任何已有文件。实现由 OMO 子任务按 BACKLOG/ENGINEERING §9 写，OMO 复核。`{RC} ~/work/illini-events install test`（log 见 verify-chain-1.log 中 P4.1 段）
- 计数: ① 四种来源归一化成同一组卡片字段；② SPEC §6.7.7 各状态与中英文案、改期「原 … CT」14 天边界、有效结束时间、来源已撤下、发起人已取消，同步来源不推断取消；③ register_url / page_url 归一化后去重，优先级 caaci > partner > campus > member；④ 白名单拒绝协议、凭据、端口与相似域名；⑤ §9.10 的 22 个 fixture 齐全（另加 effective-end.json），ORGANIZER/CONTACT 一律 organizer@example.test，ICS 的 UID 用合成编号 9000000x@illinois.edu；⑥ 三组测试都断言 fetch 调用 0 次；子任务宿主自测 26/26；容器 TEST 2015/2014/0/1 pg_skips=0 [本地测]
- ci_run_url: —（本地分支，不推送）
- 未测项: 无
- 下一条: P2.7
- 附: CAMPUS_CALENDARS 先留空，等 P4.7 第二步按 D-33（A）填；ICS 解析归 P4.7。#369 合并后按 §1 改成 codex/community-events-<日期> 再推。

### L35 · 2026-11-13 02:15 CT · HOME.1 视觉稿 axe 复核：12 个页面×宽度组合 0 违规，共用 axe 工具装好
- task_id: HOME.1
- code_sha: —（只动 illini-dev-env/tools 与材料分支 appendix；三份视觉稿 HTML 未改）
- docs_sha: b27e1dbafefc8ddd671fdbcf9741400a480c7494
- 环境: 本地 tony-ws，localhost/illini-dev:pw1.65-node22-pg17（Chromium 随 Playwright 1.65.0）
- 命令: ~/work/illini-dev-env/tools/package.json 固定 axe-core 4.14.0、opentype.js 2.0.0（BRAND.4 子任务装）、playwright 1.65.0（`npm install --save-exact`，PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1，用镜像自带浏览器）；新写 page-audit.mjs：打开静态页，按宽度输出 axe color-contrast 违规数、可见且 <12px 的文字节点数、横向溢出像素，只含「·」的文字按 design/README.md「检查」不计。照 BACKLOG 命令对 direction-{a,b,c}.html 与 #detail（:target 切到话题页）各跑 390、1280；两个文件复制到 appendix/env/tools/
- 计数: ① design/ 3 个 HTML、27 张截图都在（L08）；② ③ 以 design/ 为准；④ 12 个组合 color-contrast 0、<12px 0、390 溢出 0px（~/work/evidence/HOME.1/20261113T081211Z-audit.json）；反向对照页（#bbb 对白 1.91:1、10px、600px 宽块）报出 contrast 1、small 1、overflow 210，证明三项都能报错；⑤ D-35 已定 A（#370 留言 2026-11-13 05:52 UTC），不再等待 [本地测]。sha256：package.json a8f7aea50b03687b5a82ee3606145cfdd0e59829d6ab4f5962a2ac957e0e28df，page-audit.mjs 16ba4c5dbc25008e071a8d28eb88026044aaf3d150c0f9630912779a74e5d08f
- ci_run_url: —
- 未测项: 无
- 下一条: P2.7
- 附: 没有违规，所以三份 HTML 不改。暗色与英文稿仍由 HOME.4 的截图矩阵补。

### L36 · 2026-11-13 02:31 CT · BRAND.4 印章 logo 出稿 3 稿；D-34 按 D-43 代定 B 的单字「玉」 [OMO自决]
- task_id: BRAND.4
- code_sha: —（出稿只写材料分支；替换另记）
- docs_sha: 0fc3426a1e646f4774974ea1646e352839246f05
- 环境: tony-ws 宿主 Node 22.23.5（opentype.js 2.0.0 转轮廓）；localhost/illini-dev:pw1.65-node22-pg17 的 Chromium 158 渲染 PNG
- 命令: OMO 子任务按 BACKLOG BRAND.4 做：字体取 notofonts/noto-cjk 的 Serif2.003、Sans2.004 两个 release 标签下的 SubsetOTF（release 页的 zip 下载会跳到 release-assets.githubusercontent.com，不在允许的主机里，所以按同一标签从仓库取同一路径的文件，SOURCES.md 写了核对 zip 的命令）；~/work/illini-dev-env/tools/seal-glyphs.mjs 用 opentype.js 取轮廓、自己格式化坐标（2.0.0 的 toPathData 会写出 NaN），seal-render.mjs 直接驱动镜像里的 Chromium；几何与七个颜色值沿用生产「集」印章，只换字
- 计数: ① 3 个方案（A 单字「玉」Serif Bold；B 三字 Serif Black + 单字变体；C 三字 Sans Bold + 单字变体）共 10 个 SVG（含暗色），`grep -c '<text'` 全部 0；24px、512px 预览各 3 张，另有两个单字变体的 24px 预览；浅色、深色对照图各 1 张；SOURCES.md 写字体名、标签、地址、sha256、SIL OFL 1.1。OMO 看过对照图：24px 下 A 的横画偏淡但认得出，B 单字、C 单字清楚，B、C 三字粘连 [本地测]
- ci_run_url: —
- 未测项: ② 替换（进行中）
- 下一条: BRAND.4
- 附: [OMO自决] D-43 第 1 项：D-34 选「玉」单字，取 B 的单字变体（宋体，和 D-35 A 一致），理由与撤回写在 DECISIONS D-34。

### L37 · 2026-11-13 02:32 CT · P2.7 部分成功恢复：关联失败的商品由作者在话题页补关联，绝不重发帖子
- task_id: P2.7
- code_sha: be2ebb6a3752a763cdad2f634b0db2fb88e75161（codex/community-topics-20261112，已推送；功能 7d6eacc，修正 be2ebb6）
- docs_sha: 3ad55422e3e9d6282abdae55942a78f369321062
- 环境: 本地 tony-ws pw1.60；CI
- 命令: usePlaza.ts：createPost 返回 {partial:'items_failed', failedItemIds} 或 {partial:'refetch_failed'}；待关联 itemIds 存模块级 Map 并镜像到 sessionStorage `pending-post-items:<accountId>:<postId>`，resetPlazaState（换号时）清掉；新增 retryAttachPostItems：先读已有 post_items，只插缺的，23505 算已关联，42501 算不可关联，post_items_cap_exceeded 算已满，其他错误保留待关联，从不调用 posts insert。plaza/index.vue 按模式出提示并在 URL 加 `&attach=pending`；post/index.vue 只对作者显示提示条与「重新关联」「不关联了」，请求中按钮禁用；zh/en 新增 attach* 共 9 个 key、partialPublish 按模式分两条；新增 smoke/community-post-partial-attach.spec.ts。第一次全量 typecheck 报 useSupabase() 解构错误（log check-20261113T073241Z），修正后 `SMOKE_SPECS="community-post-topics.spec.ts plaza-attach-picker-is-modal.spec.ts community-post-partial-attach.spec.ts" ~/work/illini-dev-env/run-checks.sh ~/work/illini install typecheck test smoke`（log check-20261113T073353Z）通过并提交 7d6eacc。之后对照 DoD ④ 复查代码，发现第二次重试时 display_order 用待关联列表里的下标，会和已关联的商品同号、排序不定（表上没有 (post_id, display_order) 唯一约束，所以不丢关联）；改为接在现有最大 display_order 之后，同一命令重跑（log check-20261113T081608Z）后提交 be2ebb6
- 计数: ① 两种 partial 返回值已区分，refetch_failed 不提示；② Map + sessionStorage key 与换号清理已做，URL 带 attach=pending；③ 提示条只对作者显示，文案「话题已发布，「{name}」等 {n} 件商品没有关联上」与两个按钮；④ 只插缺的且保持原顺序、23505 / 42501 / 上限 / 网络错误各自处理、请求中禁用、从不 insert posts；⑤ partialPublish 两条 + attachPending、attachRetry、attachDismiss、attachUnavailable 等中英文；⑥ smoke 15 passed，新 spec 覆盖五种情况（500 后重试 201 且 posts 只写 1 次；重试时 42501 显示不可关联；refetch 失败不出提示条；SIGNED_OUT 广播后提示条与 sessionStorage 记录都清掉；B 打开同一链接看不到提示条）；TEST 2001/2000/0/1 pg_skips=0 [本地测]；CI Type-check、Boundary、两个 Build 全 success，public sweep 照旧停在预检（E4） [CI run#43392843858]
- ci_run_url: https://github.com/EricXu-0805/CAACI_Community_Marketplace_Bazaar/actions/runs/43392843858
- 未测项: 「换号」只用 SIGNED_OUT 测了退出这一种；换成另一个账号走同一个 resetPlazaState 路径，没单独写用例
- 下一条: BRAND.1

### L38 · 2026-11-13 02:37 CT · BRAND.1 产品名换成「玉米地 / Cornfield」：界面、清单文件、公开页
- task_id: BRAND.1
- code_sha: 9157d966c48c8d6bd81cc3a30aefdc70bd033102（codex/brand-cornfield-20261112，草稿 PR #372，base main 7b18f20，已推送；BRAND.1–3 一个提交，因 zh/en 两个文案文件里三项的 key 交错）
- docs_sha: c22ac52fd12093d43598f64c1dc7d8261ca06e16
- 环境: 本地 tony-ws pw1.60（分支从 main 建，还是 Playwright 1.60）；CI
- 命令: i18n app.name、app.desc，新增 app.tagline、app.formerly；manifest.json、pages.json、manifest.webmanifest、index.html、public-brand-pages.ts、account-deletion.html、robots.txt、moderation.adBody（删「只用于同学之间交易物品」）、api/moderate.js 提示词、pages/index 与 detail 的 navigator.share 标题；登录页加 12px「原 Illini Market」一行，/about（public-brand-pages.ts 生成的静态页，不能调 t()）写死「Cornfield (formerly Illini Market)」「玉米地（原 Illini Market）」。`~/work/illini-dev-env/run-checks.sh ~/work/illini-brand install typecheck h5 h5accept mp migrations test smoke`（log check-20261113T074156Z）：test 两条失败，都是 api/_share-boundary.test.mjs 仍断言旧兜底描述；SPEC §1.1 规定分享卡描述用一句话介绍，所以改断言为新值，`~/work/illini-dev-env/run-checks.sh ~/work/illini-brand install test` 复测（log check-20261113T082329Z）通过。改动由 OMO 子任务按 SPEC §1.1–§1.7、ENGINEERING §3 写，OMO 复核并跑全量
- 计数: ① app.name 玉米地 / Cornfield，app.desc 伊利诺伊华人论坛 / Chinese community in Illinois，app.tagline 已加；② 列出的文件都已改，mp 产物 projectname 为「玉米地」（evidence/BRAND.1/*-projectname.txt）；③ 登录页与 /about 有「原 Illini Market」，移除日写进 STATUS 阻塞第 9 条；④ diff 无重命名，is_illini_verified 删 9 行加 9 行（只换 label），illinimarket.com 各地址集合不变，pages/illini-verify、存储 key、send/verify-illini-code 文件名都没动；⑤ 全量 install、typecheck、h5、h5accept、mp、migrations、smoke 通过，test 1991/1990/0/1 [本地测]；CI Type-check、Boundary（没碰依赖文件，审计按 workflow 跳过）、Build mp-weixin success；Build H5 失败在「Install browsers for compiled admin acceptance」、public sweep 失败在「Install Playwright」，都是 Ubuntu 26.04 上 Playwright 1.60 装不上浏览器，P1.5 在 #371 修，等 E5 [CI run#43393646871]
- ci_run_url: https://github.com/EricXu-0805/CAACI_Community_Marketplace_Bazaar/actions/runs/43393646871
- 未测项: 无
- 下一条: BRAND.3

### L39 · 2026-11-13 02:37 CT · BRAND.3 徽章改名「校园邮箱已验证」（D-27）
- task_id: BRAND.3
- code_sha: 9157d966c48c8d6bd81cc3a30aefdc70bd033102（codex/brand-cornfield-20261112，草稿 PR #372，base main 7b18f20，已推送；BRAND.1–3 一个提交，因 zh/en 两个文案文件里三项的 key 交错）
- docs_sha: a61d51dfeaf1418272a344600c39a34c6d8e13a1
- 环境: 本地 tony-ws pw1.60（分支从 main 建，还是 Playwright 1.60）；CI
- 命令: profile.illiniVerified、verifyTitle、verifyHint、illini.title、illini.intro、login.illiniEmail 的中英文值按 SPEC §1.6 改，key 名不变；新增 profile.verifiedShort（列表、卡片、关注、评价行用短名，title/aria-label 用全称）；9 处写死 label="Illini" 的 UBadge 改用 i18n。brand-name-boundary.test.mjs 含徽章检索。`~/work/illini-dev-env/run-checks.sh ~/work/illini-brand install typecheck h5 h5accept mp migrations test smoke`（log check-20261113T074156Z）：test 两条失败，都是 api/_share-boundary.test.mjs 仍断言旧兜底描述；SPEC §1.1 规定分享卡描述用一句话介绍，所以改断言为新值，`~/work/illini-dev-env/run-checks.sh ~/work/illini-brand install test` 复测（log check-20261113T082329Z）通过。改动由 OMO 子任务按 SPEC §1.1–§1.7、ENGINEERING §3 写，OMO 复核并跑全量
- 计数: ① profile.illiniVerified =「校园邮箱已验证 / Campus email verified」，其余 5 个 key 不含 Illini；② 徽章检索 10 → 0（evidence/BRAND.3/20261113T075437Z-badge-grep.txt）；③ diff 里 pages/illini-verify、is_illini_verified 都没有重命名 [本地测]；CI Type-check、Boundary（没碰依赖文件，审计按 workflow 跳过）、Build mp-weixin success；Build H5 失败在「Install browsers for compiled admin acceptance」、public sweep 失败在「Install Playwright」，都是 Ubuntu 26.04 上 Playwright 1.60 装不上浏览器，P1.5 在 #371 修，等 E5 [CI run#43393646871]
- ci_run_url: https://github.com/EricXu-0805/CAACI_Community_Marketplace_Bazaar/actions/runs/43393646871
- 未测项: 无
- 下一条: BRAND.2

### L40 · 2026-11-13 02:37 CT · BRAND.2 分享卡、邮件显示名与品牌断言测试；开草稿 PR #372
- task_id: BRAND.2
- code_sha: 9157d966c48c8d6bd81cc3a30aefdc70bd033102（codex/brand-cornfield-20261112，草稿 PR #372，base main 7b18f20，已推送；BRAND.1–3 一个提交，因 zh/en 两个文案文件里三项的 key 交错）
- docs_sha: 8ca557e10f784e9bf729647a7ec93bde766d8557
- 环境: 本地 tony-ws pw1.60（分支从 main 建，还是 Playwright 1.60）；CI
- 命令: api/share.js、share-post.js 的 og:site_name「玉米地 Cornfield」、兜底标题「玉米地 · 社区」、兜底描述换成一句话介绍；share.plaza / marketplace / profile 中英文；DIGEST_FROM 默认值「玉米地 Cornfield <noreply@send.illinimarket.com>」；send-illini-code、notification-digest、meetup-notify、unsubscribe 正文；supabase/email-templates 两个模板；_share-boundary、_email-brand-boundary 改新名（_deployment-boundary 只断言域名，不用改）；新增 scripts/brand-name-boundary.test.mjs 把品牌名与徽章两条检索写成测试。`git push --no-verify -u`（分支从 main 建，宿主 pre-push 的 PG 测试找不到 initdb，同 L21）；`gh pr create --draft --base main` → #372。`~/work/illini-dev-env/run-checks.sh ~/work/illini-brand install typecheck h5 h5accept mp migrations test smoke`（log check-20261113T074156Z）：test 两条失败，都是 api/_share-boundary.test.mjs 仍断言旧兜底描述；SPEC §1.1 规定分享卡描述用一句话介绍，所以改断言为新值，`~/work/illini-dev-env/run-checks.sh ~/work/illini-brand install test` 复测（log check-20261113T082329Z）通过。改动由 OMO 子任务按 SPEC §1.1–§1.7、ENGINEERING §3 写，OMO 复核并跑全量
- 计数: ① og:site_name、兜底标题、share.plaza 与 SPEC §1.7 一致；② DIGEST_FROM 默认值已改，发件域不变；③ 两个模板已同步；④ 两份断言测试改新名，新测试在容器里 2/2 通过，故意放回旧名时 1 条失败（变异检查）；⑤ 品牌名检索 76 行 / 19 个文件 → 0（evidence/BRAND.2/20261113T075437Z-brand-grep.txt）；⑥ test 1991/1990/0/1 [本地测]；⑦ CI Type-check、Boundary（没碰依赖文件，审计按 workflow 跳过）、Build mp-weixin success；Build H5 失败在「Install browsers for compiled admin acceptance」、public sweep 失败在「Install Playwright」，都是 Ubuntu 26.04 上 Playwright 1.60 装不上浏览器，P1.5 在 #371 修，等 E5 [CI run#43393646871]
- ci_run_url: https://github.com/EricXu-0805/CAACI_Community_Marketplace_Bazaar/actions/runs/43393646871
- 未测项: ⑦ Build H5 等 E5（#371 合并后重跑）
- 下一条: P4.3
- 附: E10（合并后）：Eric 把两个邮件模板粘到 Supabase 后台、生产 DIGEST_FROM 显示名改「玉米地 Cornfield」。邮件和退订页里的「集」字印章没在 BRAND.4 的替换范围里，列进最终报告。

### L41 · 2026-11-13 02:51 CT · P4.3 官网 GET /api/public-events v1 本地写好（不推送：推送等 E8，开上游 PR 是 Eric 的【硬】步骤）
- task_id: P4.3
- code_sha: 28d59b1ade3a247ac5cca0c809e4c91f614f5eab（~/work/caaciorg 本地分支 feat/public-events-feed，从 upstream/preview fae3f5f 建；只有 upstream 远端，已取消上游跟踪，没有推送）
- docs_sha: 82ad9fd019646189e1a695fe08252a296952da42
- 环境: tony-ws；docker.io/library/node:20-bookworm 与 node:24-bookworm 容器，npm ci 联网，其余步骤 --network none，输出逐行脱敏
- 命令: 新增 functions/api/public-events.js（只导出 onRequestGet：window=upcoming|recent、id=<uuid>；只读 events 表 §9.1 列出的列，limit 201；200 带 cache-control public, max-age=60；400 invalid_window、404 not_found、500 固定 {"error":"unavailable"}；takes_registrations / registration_open / page_url / register_url 规则照 web/src/lib/events.ts 与 _event-form.js；content_hash 对规范化 JSON 求 sha256）；test/public-events.test.js 5 条；test/api-auth-gates.test.js 的 UNGATED 加一条 read-only。~/work/evidence/P4.3/caaciorg-ci.sh 在 Node 20、24 上跑 caaciorg CI 的同一组步骤；第一次只有 format:check 失败（只报这两个新文件），prettier --write 后 verify-chain-5.sh 重跑 format:check、lint、test
- 计数: ① 参数、响应结构、缓存头、400/404/500 正文与 §9.1 一致（测试断言 select 列、limit 201、order、published=eq.true、complete=false 时只回 200 条、500 正文不含 supabase）；② 输出只含 v1 的 15 个字段，测试断言报名问题、志愿者问题、perk、image_url 都不出现；③ Node 20 与 24：npm ci、lint、typecheck、build -w web、test、build 在格式修正前都通过，格式修正后 format:check、lint、test 再过一遍（test 1252 / 1244 / 0，其余 8 条 skipped）；④⑤ 未做 [本地测]
- ci_run_url: —（不推送）
- 未测项: ④ 向 preview 开 PR（E8 之后由 Eric 在网页上开，D-42 第 1 项【硬】）；⑤ 上线后从工作站请求一次
- 下一条: P1.7
- 附: D-42 第 2 项 (a) 记录：caaciorg 仓库自己的源码、模板和测试里有 17 个文件含官网库标识（wslz…），是仓库原有内容，不是 OMO 的命令或请求；按规定只记这一条、不触发【暂停推送】。为此 CI 步骤除 npm ci 外全部 --network none，输出写盘前逐行脱敏；OMO 新增的三个文件里两个托管标识都是 0 次。

### L42 · 2026-11-13 03:08 CT · BRAND.4 ② 「集」印章换成「玉」：logo、应用图标、占位图（#372 ba070e7）
- task_id: BRAND.4
- code_sha: ba070e73ff53ac037721cc00c6576327efeff11a（codex/brand-cornfield-20261112，草稿 PR #372，已推送；push 用 --no-verify，同 L21）
- docs_sha: beb3c1d9465345773e0b5fbb598796a76a2da49f
- 环境: 本地 tony-ws pw1.60；截图用 pw1.65 镜像的 Chromium
- 命令: OMO 子任务按 D-34 代定结果替换：logo-mark.svg / logo-mark-dark.svg 用 draft-b-mono(-dark).svg；app-icon.svg 保留可遮罩图标的满版几何，只换字的轮廓；app-icon-192/512.png 用镜像 Chromium 重新渲染，尺寸不变；13 处占位「集」→「玉」。`~/work/illini-dev-env/run-checks.sh ~/work/illini-brand install typecheck h5 mp test smoke`（verify-chain-8.log）
- 计数: ② 替换的 SVG 里 <text> 0 个（static/ 下只剩 placeholder.svg 的「No Image」文字，它不是印章，不在 SPEC §1.5 的替换范围）；③ `git grep -c 集 -- 'app/src/static/*.svg'` 无输出；④ 浅色、深色截图各 1 张已放 appendix/visual/logo/（OMO 看过：登录页显示新印章、玉米地、原 Illini Market、伊利诺伊华人论坛）；typecheck、h5、mp、smoke 6 passed 通过，TEST 1991/1990/0/1 [本地测]
- ci_run_url: —（#372 随 ba070e7 重跑；Build H5 仍等 E5）
- 未测项: 小程序在微信后台的图标（不在仓库，BRAND.5 / E7 时 Eric 换）
- 下一条: P1.7
- 附: 邮件里的「集」字印章（send-illini-code、meetup-notify、notification-digest、unsubscribe、两个邮件模板）不在 SPEC §1.5 的替换清单里，没改，列进最终报告；另有 6 处代码注释仍写「集」印章。

### L43 · 2026-11-13 03:23 CT · P1.7 配置修正草稿 PR #371：CI 除依赖审计外全部通过；修了 Playwright 1.65 下 3 条桌面用例的回归
- task_id: P1.7
- code_sha: b259105ee8e72466cfe63350081919a9be748618（codex/config-fixes-20261112，草稿 PR #371，base main，已推送）
- docs_sha: bb5c1fb3a364a828a5fd83a5004cb3574d6e2ea2
- 环境: CI；本地 tony-ws pw1.65 / pw1.60 对照
- 命令: 第一次 CI（run 43386686161，head 23ce3b6）public sweep 有 4 条失败：marketplace-responsive 的 3 条桌面用例点第二个会话超时，product-publishing-discovery 1 条刷新计数。诊断：本地两份 spec 在配置分支复现 3 条（130 passed / 3 failed），origin/main 的只读 worktree（7b18f20，Playwright 1.60）133 条全过，product-publishing 那条两边都过（判为 CI 偶发）；在失败用例里插桩对比，main 上 screen.width 1440、点会话后留在消息页分栏，配置分支 screen.width 390、点会话跳到 /pages/chat，会话列表卸载。原因：Playwright 1.65 的测试运行器在 describe 覆盖 viewport 时保留了 iPhone 13 设备的 390 宽 screen，uni-h5 取 min(innerWidth, clientWidth, screen.width) 当窗口宽，messages 页按 windowWidth ≥ 1100 判断宽屏。修正只改测试：两个桌面 describe 的 test.use 加 `screen: { width: 1440, height: 900 }`（b259105）；本地两份 spec 133 passed，推送时宿主 pre-push 检查通过。另按 D-41 补充把 #371 描述的依赖一节改成 23ce3b6 的内容（gh pr edit 碰到 Projects classic 弃用报错，改用 REST PATCH）
- 计数: ① 草稿 PR #371，base main；② run 43397680516：Type-check、Build H5（runner Image ubuntu-26.04，P1.5 ⑤ 一并满足）、Build mp-weixin、Smoke (public page sweep) success，Smoke (protected staging account)、Production release readiness skipped，Boundary regressions 只失败在「Audit production and build dependencies」；③ Boundary 汇总 # fail 0、# skipped 1；④ 本条与 STATUS 记了 PR 号、head、run id 和各 job 结论 [CI run#43397680516]
- ci_run_url: https://github.com/EricXu-0805/CAACI_Community_Marketplace_Bazaar/actions/runs/43397680516
- 未测项: 无
- 下一条: FINAL
- 附: Boundary 的依赖审计只在 PR 改了依赖文件时才跑（#369、#372 没改，所以通过）；#371 卡在这一步是 main 上原有的 @intlify、glob、minimatch、vite 公告，等 P1.6 剩余项。宿主 pre-push 钩子在配置分支上是通过的（P1.3 的 postgresBinDir 已在这条分支），合并后 #369、#372 推送不再需要 --no-verify。

### L44 · 2026-11-13 03:57 CT · P1.10 L-SQL 全链回放 181/181：托管面缺口放进 #369 的 _ops LOCAL_BOOTSTRAP（D-44 第 2 项），变红验证通过
- task_id: P1.10
- code_sha: 5abcb861fc0736e59d66f7832c1dfefe0ceacefe（codex/community-topics-20261112，#369，已推送，push 用 --no-verify 同 L21；只新增 4 个 supabase/_ops 文件，supabase/migrations/ 与 manifest.sha256 无改动）
- docs_sha: 24d141a238711de528b9f72676aca9f36fd5fd5c
- 环境: 隔离环境 L-SQL：docker.io/supabase/postgres:17.6.1.104，--network none，一次一个容器（~/work/evidence/.container.lock）
- 命令: 按缺口分 4 份文件（时间戳取第一个用到该缺口的迁移）：LOCAL_BOOTSTRAP_20260808040313_cli_migration_ledger.sql（来源 supabase/cli v3.1.0 apps/cli/src/command-internal/migration-history.ts:27-33）、LOCAL_BOOTSTRAP_20260811143207_auth_identities_sessions.sql、LOCAL_BOOTSTRAP_20260916073035_auth_users_ban_delete.sql、LOCAL_BOOTSTRAP_20260916073035_auth_mfa_factors.sql（来源 supabase/auth v2.197.0 的 20210909172000、20231117164230、20220811173540、20221114143122、20220114185340、20230116124412、20221003041349 各迁移）。每份文件头写「只用于本地 L-SQL 回放、不应用到托管库」和每张表每一列的出处，并带守卫：会话里没有 caaci.local_bootstrap = lsql-replay 就报错退出（裸镜像上实测不带标记被拒）。~/work/illini-dev-env/lsql-replay.sh 去掉内联台账与 auth 存根，只管怎么跑：整条链用 postgres 连接；没有顶层 BEGIN 的迁移包一层事务；在每条迁移之前加载同时间戳、带 lsql-replay 守卫的 _ops 文件（同时间戳的旧单迁移 fixture 不带守卫，不会被带进来）；台账文件加载后补记已回放的迁移，之后每条迁移记一行。RUNBOOK §5.1 换成这份脚本全文（与实际脚本 diff 无输出），存档 appendix/env/lsql-replay.sh。命令：`flock ~/work/evidence/.container.lock ~/work/illini-dev-env/lsql-replay.sh ~/work/illini`；变红验证在 5abcb86 的临时 detached worktree 里删掉 auth_users_ban_delete.sql 的 deleted_at 一行后跑同一命令，跑完删除 worktree
- 计数: ① 新文件提交后第 1 次计数尝试：`files=181 replayed=181 errors=0 done=1 rc=0`，脚本退出 0（lsql-20261113T094148Z）；② 最后一个 REPLAY 行是 `REPLAY 20261112120000_community_post_topics.sql`；③ 连接角色：日志开头 `select current_user` 为 supabase_admin，链内迁移经 `\connect postgres postgres` 以 postgres 执行；④ 变红：`files=181 replayed=162 errors=1 done=0 rc=3`，最后一个 REPLAY 是 20260916073035_wechat_account_link_tickets.sql，ERROR 行 `psql:/work/migrations/20260916073035_wechat_account_link_tickets.sql:44: ERROR:  column u.deleted_at does not exist`，正是第一条读这一列的迁移（lsql-20261113T095513Z）。两份日志存 evidence/P1.10/d44-green-…、d44-red-… [隔离环境 L-SQL]
- ci_run_url: —（L-SQL 只在本地）
- 未测项: 无
- 下一条: P2.5
- 附: D-44 第 2 项要求的 3 次上限只用了 1 次。D-44 列了三处缺口，实际是四处：auth.mfa_factors 也被 20260916073035 读到（f.status = verified），按同一规则单独成文件。提交前做过两次不回放迁移的探查（裸镜像 + 已有 bootstrap 后列出 auth/storage/realtime 表列；四份新文件在裸镜像上自检与守卫测试），不算计数尝试，脚本在 evidence/P1.10/probe-surface.sh、bootstrap-selfcheck.sh。

### L45 · 2026-11-13 04:12 CT · P1.6 跨大版本按 D-44 第 3 项做成草稿 PR #373（@intlify 11.4.19、glob 14.0.6、minimatch 11.0.8），合不合由 Eric 定
- task_id: P1.6
- code_sha: 55716ba57871f86b67bb2ecea6deca005627ccb0（codex/deps-crossmajor-20261113，从 #371 head b259105 切出，草稿 PR #373，base codex/config-fixes-20261112；正常推送，宿主 pre-push 检查通过）
- docs_sha: b584adcf620eb7b8c3a5e36dc60a4ee0062301f3
- 环境: 本地 tony-ws localhost/illini-dev:pw1.65-node22-pg17；宿主 npm 10.9.9 只用于重算 lockfile
- 命令: app/package.json overrides：@intlify/core-base、message-compiler、shared 9.14.5 → 11.4.19；新增 `"@sentry/bundler-plugin-core": { "glob": "14.0.6", "minimatch": "11.0.8" }`；`npm install --package-lock-only --legacy-peer-deps`，lockfile 只变这两组及其自带依赖（path-scurry 3.0.0、@intlify/devtools-types、@isaacs/nonrecursive-glob-match、balanced-match 位置）。`~/work/illini-dev-env/run-checks.sh ~/work/illini-deps install typecheck h5 h5accept mp test smoke npmaudit`；容器里不带 token 构造 sentryVitePlugin；同一镜像、同一组 stub 变量下 `~/work/illini-dev-env/run-checks.sh ~/work/illini-config install h5 mp` 构建 #371 head 作对照，`diff -rq` 两份 dist；`npm ls` 看版本唯一。脚本与输出在 evidence/P1.6x/
- 计数: ① install、typecheck、h5、h5accept、mp、test、smoke（run-checks 默认集合）rc=0，TEST 1994/1993/0/1 pg_skips=0；② `npx npm@11 audit --audit-level=moderate` 只剩 1 个 moderate：vite 6.4.4（例外清单），#371 head 上同一命令 37 个；③ mp-weixin 336 个文件、h5 157 个文件与 #371 head 构建逐字节一致（diff -rq 0），标题一致（mp app.json「Illini Market」，h5「Illini Market」「Moderation」），`%key%` 在 src/pages.json 与两份产物里都是 0；④ Sentry 插件不带 token 构造成功，解析到 glob 14.0.6、minimatch 11.0.8；⑤ npm ls：glob、minimatch、@intlify/core-base、shared、message-compiler 各一个版本 [本地测]
- ci_run_url: —（ci.yml 只对 base 为 main 的 PR 和推送到 main 触发，#373 不跑 CI；workflow_dispatch 可能带上生产相关 job，没有手动触发）
- 未测项: Sentry source map 上传（要 token，Eric 在发布构建里确认，已写进 PR 描述）；这条分支上的完整 public sweep（CI 不触发，本地只跑了默认 smoke 集合）
- 下一条: P2.5
- 附: 与 D-44 原文的两处出入 [OMO自决]：@intlify/vue-devtools 在 npm 上没有 11.x（最新 9.14.1），留在 9.14.1，它不在审计报出的 7 个包里；glob、minimatch 的覆盖限定在 @sentry/bundler-plugin-core 子树（树里只有这一处用到它们），不做全局覆盖。pages.json 本来没有 `%key%`，所以用产物逐字节比对代替「占位全被替换」的检查。

### L46 · 2026-11-13 04:36 CT · P2.5 冻结前修订 20261112120000 并补 PRECHECK/VERIFY/REGRESSION；20261112120000 冻结
- task_id: P2.5
- code_sha: 090d2be97f8a898d011a414ad223cd6320544ad1（codex/community-topics-20261112，#369，已推送，push 用 --no-verify 同 L21）
- docs_sha: 5707d1b29110631ddaac37fe039981a406bc204c
- 环境: 隔离环境 L-SQL docker.io/supabase/postgres:17.6.1.104（--network none）；本地 tony-ws run-checks；CI
- 命令: 迁移按 ENGINEERING §5.1：① BEGIN 后 SET LOCAL lock_timeout 5s、statement_timeout 60s；② REGION.1 已有，不动；③ posts_topic_body_check CHECK (title IS NULL OR btrim(content) <> ''），validate_post_topic 先 RAISE post_topic_body_required（23514）；④ GRANT INSERT (id) ON public.posts TO authenticated；⑤ ALTER FUNCTION search_community_posts(text[],text,int,int,text,text) SET statement_timeout = '3s'；⑥ 重建 posts_visible：沿用 20260718160000 的 11 列、security_invoker/security_barrier、REVOKE/GRANT，末尾追加 source_lang, title, category, region；其余不动。新增 _ops 的 PRECHECK（只读：三列不存在、新 RPC 不存在、旧 RPC 在、posts_visible 为 11 列或 11 列加 source_lang、两函数 md5）、VERIFY（只读：列形状、三约束 convalidated、两索引、列 ACL 与 20260719151729:397-409 相比 authenticated 的 INSERT 只多 id/title/category、UPDATE 仍只有 content_i18n、anon 不可写、region 不可写、新 RPC invoker 且 proconfig 含 statement_timeout=3s、EXECUTE 只给 anon/authenticated、两证据函数不对 anon/authenticated 开放、admin_get_report_detail 给 service_role、posts_visible 列/选项/授权）、REGRESSION（只在 L-SQL、整段回滚：A、B、停权、被 A 拉黑四个合成身份加 anon）。normalizePostTopic 增加可选 content 参数，usePlaza.createPost 传入去空白正文，utils/index.ts 加 post_topic_body_required 中英文案；scripts/community-post-topics.test.mjs 补 §5.1 第 3–6 行断言（测试库补 posts_visible 与可见性函数桩）；app/smoke/community-post-topics.test.mjs 补正文校验，原「话题空正文 → content_required」一项按新规则改为 post_topic_body_required，并补「空动态 → content_required」保住原覆盖。最后一次改迁移后只换 manifest.sha256 里这一行。命令：`flock … lsql-replay.sh ~/work/illini 20261112120000`；`~/work/illini-dev-env/run-checks.sh ~/work/illini install typecheck migrations test smoke`（3 个社区 spec），改测试预期后 `~/work/illini-dev-env/run-checks.sh ~/work/illini install test` 复测。PRECHECK/VERIFY/REGRESSION 先在一个停在本迁移之前的保留容器里调通（脚本在 ~/.cache/omo-tmp/p25，容器已删）
- 计数: ① 第 1、3–6 行已落进文件 [源码]；② 三个 _ops 文件覆盖 §5.1 全部断言；变异检查：临时 GRANT UPDATE (title) 后 VERIFY 报 community_topics_update_acl_drift、REGRESSION 报 P2.11-7 accepted，撤回后两者都过 [隔离环境 L-SQL]；③ `git log origin/main --since=2026-10-26 -- supabase/migrations` 0 条；main 上含两函数的只有 029、050、078、20260717194334，都早于 20261003175231，没有被覆盖的定义；PRECHECK 钉 md5：capture_report_target_snapshot 07d707ba21ec0bb83efb52fe8fa1083a、admin_get_report_detail 6cad64c7ee3ff3a13fbbc8a0491a22e7（evidence/P2.5/20261113T094914Z-*）；④ 未测，等 E3（~/.config/illini/staging.env 不存在），生产那一半由 Eric 查；⑤ `files=181 replayed=181 errors=0 done=1 rc=0`，日志依次 PRECHECK（行 3723）→ REPLAY 20261112120000（3728）→ VERIFY（3757）→ REGRESSION（3763）；REGRESSION 15 行 REJECTED（含 P2.11 ① 七项：RLS 42501 两项、post_items_cap_exceeded、posts_topic_metadata_check、post_title_size、post_topic_body_required、permission denied），P2.11 ② 删帖后 anon 搜索与 posts_visible 均为 0，PASS（lsql-20261113T101110Z）；⑥ migrations all-migration-checksums-ok，typecheck rc=0，test 2001/2000/0/1 pg_skips=0 [本地测]；⑦ 20261112120000 冻结，sha256 e2a85c3ec33c98e8317b764a59fc8af1434c15319794e3f64a6606be70e5a92c（evidence/P2.5/20261113-freeze.sha256）。CI：Type-check、Build H5、Build mp-weixin、Boundary success，public sweep 停在 Verify public read schema before browser startup（E4）[CI run#43409123864]
- ci_run_url: https://github.com/EricXu-0805/CAACI_Community_Marketplace_Bazaar/actions/runs/43409123864
- 未测项: ④ staging source_lang 探测（等 E3）；smoke 里 community-post-partial-attach.spec.ts 的偶发失败（P2.7 的测试时序问题，另行修，见附）
- 下一条: P2.9
- 附: [OMO自决] architect 子任务因模型额度中断，只留下 DoD ③ 证据，P2.5 由 OMO 自己做。VERIFY 按迁移实际授权断言：capture_report_target_snapshot 是触发器函数，迁移对 PUBLIC、anon、authenticated、service_role 全部 REVOKE（ENGINEERING §5.1 写「只有 service_role 能执行」，实际是谁都不能直接执行），admin_get_report_detail 只给 service_role。已知副作用照 §5.1：应用本迁移后旧的 VERIFY_20260718_reconcile_app_table_acl_boundaries 会报 posts 列清单漂移，属预期，没改那个历史文件。L-SQL 日志头写的 head 是 5abcb86，因为回放读工作区，内容与 090d2be 相同。smoke 第一次跑 community-post-partial-attach.spec.ts 有 1 条失败：失败快照里标题框被清空、正文还在；uni-input 用 100ms 节流把输入同步到 v-model，测试 fill 之后马上打开挂商品面板，标题在同步前被重新渲染覆盖。与 P2.5 改动无关，修测试另提交。

### L47 · 2026-11-13 04:51 CT · P2.9 话题分享卡用话题标题，动态用正文首行；兼容矩阵按实测补证据
- task_id: P2.9
- code_sha: ece6d12（#369，已推送，head bd6fee5）
- docs_sha: c62c618af8870d0d0b6b267824a35b4eca2ce6d1
- 环境: 本地 tony-ws run-checks；宿主 Node 22（两份测试单独跑）
- 命令: api/share-post.js：posts_visible 查询加 title；OG 标题 = title 去空白后非空就用 title（最多 120 字），否则正文首行，后接「— 作者」。api/_share-boundary.test.mjs 加话题用例（有标题、title null、全空白、含 HTML 字符），并断言查询带 title；scripts/suspension-visibility-legacy-view-boundary.test.mjs 加用例：20261112120000 重建的 posts_visible 保留 11 列、两个选项、过滤条件和授权，只追加 source_lang/title/category/region，且 VERIFY 写着同一份列清单；scripts/community-post-topics.test.mjs 加断言：旧 RPC search_posts_fuzzy 用只在标题里的词搜得 0 条。材料分支 ENGINEERING §6 兼容矩阵补实测证据与部署顺序风险
- 计数: ① OG 标题规则生效，两份测试都有话题用例；变异检查：把标题改回只用首行，新用例失败；宿主 26/26；② P2 不翻译标题，英文界面显示原文，title_i18n 已在 BACKLOG P6.1 候选；③ §6 矩阵每格写明用户看到什么并补证据（旧 H5 搜索不到标题词 [本地测]、分享标题 [本地测]、新 H5 [本地测 P2.4]）；④ install、typecheck、test 2022/2021/0/1 pg_skips=0 [本地测]
- ci_run_url: —（#369 随 bd6fee5 重跑，public sweep 停在预检等 E4）
- 未测项: 无
- 下一条: HOME.2
- 附: 部署顺序：新 share-post.js 的查询带 title，若早于 20261112120000 上线，posts_visible 缺 title 会 400，所有帖子退回兜底文字，必须先迁移（已写进 §6）。#369 上 share-post.js 的兜底文案还是旧品牌名，#372 也改了同一段，两个 PR 合并时这里会冲突，要 Eric 合第二个时取 #372 的文案。

### L48 · 2026-11-13 04:51 CT · HOME.2 首页区块纯函数 buildHomeSections 与 5 组 fixture 单测
- task_id: HOME.2
- code_sha: bd6fee5（#369，已推送）
- docs_sha: 99e2c7a98e50f53d0f1591662554607803d98272
- 环境: 本地 tony-ws run-checks；宿主 Node 22
- 命令: 新增 app/src/utils/communityHome.ts（buildHomeSections(posts, items, events, now, viewport)，纯函数，用传入的 now）、app/smoke/community-home-sections.test.mjs、app/smoke/fixtures/community-home/（20 帖、60 帖、某板块 0 帖、同一作者 5 帖、官方 5 帖，加 helpers）。实现由 OMO 子任务（deep-low）写，子任务两次在检查排队时结束，OMO 接手：补丁排除它误带的 partial-attach spec 旧改动后应用，逐条对照 BACKLOG 规则复核代码，自己跑检查与变异检查
- 计数: 19 条单测覆盖：卡片顺序；桌面 4 行、手机 3 行；每卡置顶最多 1 条；同一作者每卡最多 2 条（含置顶）；官方整页最多 3 条；去重优先级 置顶 > 板块卡 > 全站最新 > 本周热议；全站最新去重后不足 5 条收成链接；本周 N≥3 才显示；本周热议门槛（7 天内、每帖 ≥3 回复且来自 ≥2 人、满 5 帖）；7 天内相对时间、更早写「11月3日」；计数 0 不显示；补位文案。宿主 19/19；变异检查：作者上限改成 3 后「同一作者 5 帖」用例失败，恢复后 19/19；容器 install、typecheck、test 2022/2021/0/1 [本地测]
- ci_run_url: —（#369 随 bd6fee5 重跑）
- 未测项: 无
- 下一条: REGION.2
- 附: 短卡只补一行补位文案，剩余高度由布局保留（HOME.3 实现）；「新来先看」取官方且 is_featured 的帖子最多 5 条，按 SPEC §5。

### L49 · 2026-11-13 04:53 CT · P2.12 话题列表行按论坛密度重排；草稿 PR #374（base #369 分支）
- task_id: P2.12
- code_sha: 244a8e7be3a82f3647eab33694c322dd64e4bf8b（codex/community-home-20261112，从 #369 be2ebb6 切出，草稿 PR #374，base codex/community-topics-20261112；push 用 --no-verify 同 L21）
- docs_sha: 457a995752c181135a09f25a1be0b43d6f384ec6
- 环境: 本地 tony-ws run-checks（容器 Chromium/WebKit），axe-core 4.14.0（tools/）
- 命令: plaza/index.vue 话题行：标题、14px 两行摘要、「{板块} · {作者} · {时间}」元信息行、右对齐 tabular-nums 回复数、0 回复 30 天内「待回答」；关联商品纯文本行；72×72 圆角 8 首图与「+N」；翻译/点赞/分享只在详情页；动态保留原卡片；zh/en 新增文案；新增 app/smoke/community-topic-row.spec.ts（①②③⑤ 用例与 ④⑥ 截图矩阵、axe）。实现由 OMO 子任务（visual-engineering）做，OMO 看过截图后提交。`SMOKE_SPECS="community-topic-row.spec.ts community-post-topics.spec.ts plaza-attach-picker-is-modal.spec.ts community-post-partial-attach.spec.ts" RC ~/work/illini-home install typecheck test smoke`，另跑 h5 mp
- 计数: ① 标题手机 2 行/桌面 1 行、摘要 14px 两行、元信息一行、回复数右对齐 tabular-nums；② 「关联 · 台灯 $15 · 已售出 · 等 3 件」「Linked · Bike $80 · Available」，72×72 圆角 8 首图；③ 话题行无点赞/分享/翻译，详情页有，动态卡不变；④ 列表范围 <12px 文本 0、axe color-contrast 0（12 个组合），横向溢出 0；⑤ 390×844 首屏 5 行、1280×800 首屏 9 行；⑥ 12 张截图存 appendix/visual/P2.12/；install、typecheck rc=0，test 2001/2000/0/1，smoke 33 passed，h5、mp rc=0（主包 1,555,969 字节）[本地测]
- ci_run_url: —（ci.yml 只对 base 为 main 的 PR 触发，#374 不跑 CI）
- 未测项: 页面其他部分不在本任务：动态卡与底栏 10–11px 文字、暗色侧栏「发布」按钮 2.87:1
- 下一条: REGION.2
- 附: [OMO自决] 英文 plaza.ref.more 用 "{n} items in all" 而不是 SPEC 的 "+{n} more"：中文「等 {n} 件」数的是总数，i18n parity 测试要求中英占位符一致，照 SPEC 会差 1；建议 Eric 把 SPEC §11 改成这一版。读不到的关联商品仍由 usePlaza 的 stripDeletedItems 丢掉，行里不显示「关联的商品已下架」，留给引用卡（SPEC 6.6）任务。HOME.3、HOME.5 要在这条分支上接着做（先把 #369 merge 进来拿 HOME.2，不 rebase）。

### L50 · 2026-11-13 05:00 CT · REGION.2 社区查询都带 region=cu；只有一个地区时不显示切换器，页头标「香槟」
- task_id: REGION.2
- code_sha: 44629b4（#369，已推送）
- docs_sha: 5ce7260bacfd1b21f19d0e3d08c4a26a8358110c
- 环境: 本地 tony-ws run-checks；宿主 Node 22
- 命令: 新增 app/src/utils/region.ts（REGIONS、ACTIVE_REGION、showRegionSwitcher、regionLabel）；usePlaza 列表查询加 .eq('region', ACTIVE_REGION)，搜索 RPC 传 region_in；plaza 页头标题旁显示地区标签（data-test=region-label），只有多个地区时渲染 data-test=region-switcher；两份加载 usePlaza 的测试加 region 模块映射；新增 app/smoke/region-switcher.test.mjs；community-post-topics.spec.ts 加切换器为 0 与地区标签断言。`SMOKE_SPECS=3 个社区 spec ~/work/illini-dev-env/run-checks.sh ~/work/illini install typecheck test smoke`
- 计数: ① REGIONS 与 ACTIVE_REGION 按 DoD；② 单测拦截请求：列表查询带 region=cu、搜索 RPC 的 region_in=cu；首页查询由 HOME.3 接入；③ smoke 断言 region-switcher 0 个，单测断言两个地区时切换器出现；④ 页头标签「香槟」/ Champaign-Urbana；⑤ typecheck rc=0，test 2024/2023/0/1，smoke 15 passed [本地测]
- ci_run_url: —（#369 随 44629b4 重跑，public sweep 等 E4）
- 未测项: 无
- 下一条: P2.8

### L51 · 2026-11-13 05:27 CT · P2.8 同一 ID 幂等发布与账号草稿（仅本地提交）
- task_id: P2.8
- code_sha: 46e69b8459af4d20668d612a9d83fdecbe3e27fa（#369，OMO 主会话已推送，push 用 --no-verify 同 L21）
- docs_sha: e287b81d1904a45cc63e02e95ee06f54eacb1e68
- 环境: 本地 tony-ws，run-checks，localhost/illini-dev:pw1.60-node22-pg17，L-UI / 本地 PG17
- 命令: 所有容器检查均经 `flock ~/work/evidence/.container.lock ~/work/illini-dev-env/run-checks.sh ~/work/illini` 串行执行；`SMOKE_SPECS="community-post-topics.spec.ts plaza-attach-picker-is-modal.spec.ts community-post-partial-attach.spec.ts"`，步骤 install typecheck test smoke。日志 `~/work/illini-dev-env/logs/check-20261113T111907Z.log`（install/test/smoke 通过，typecheck 的 image_dimensions:null 类型错误已修成 []）；修正后的 typecheck 日志 `~/work/illini-dev-env/logs/check-20261113T112638Z.log`。首轮失败诊断留在 `check-20261113T110959Z.log`。
- 计数: ① openComposer 生成 UUIDv4，恢复草稿与重试沿用；② createPost 接受 postId/retryCreate，23505、duplicate_post、未知结果回读本人相同 ID；③ 未知结果保留面板，检查按钮只读，查无后同 ID 再发；④ plaza_composer_draft_v1 保存规定字段、排除 blob，保留/不保留/恢复/清空、换号清理均接入；⑤ community-post-idempotency.test.mjs 覆盖响应丢失、23505、duplicate_post、身份边界及账号草稿清理，现有 PG row-4 断言精确 ACL 差集；⑥ TEST tests=2035 pass=2034 fail=0 skipped=1 pg_skips=0；smoke 19 passed；install/typecheck/test/smoke 最终均 rc=0 [本地测]
- ci_run_url: https://github.com/EricXu-0805/CAACI_Community_Marketplace_Bazaar/actions/runs/43418959287（Type-check、Boundary、Build H5、Build mp-weixin success；public sweep 停在预检，等 E4）
- 未测项: 无
- 下一条: P2.10
- 附: App.vue 的 H5 uni-modal 层级必须高于 composer，首轮桌面 smoke 证明旧层级使保留草稿按钮被 textarea 遮挡；utils/index.ts 补两条新诊断的中英文映射。冻结迁移未改。材料记录保留为未提交改动，避免在要求的两个代码提交之外另建提交。
- 附（主会话）：本条由子任务起草，主会话核对后提交；修正 typecheck 后的 test/smoke 由 check-20261113T113035Z（test 2042/2041/0/1、smoke 20 passed）覆盖。

### L52 · 2026-11-13 06:10 CT · HOME.3 社区 tab 默认视图改为论坛首页（#374 分支）
- task_id: HOME.3
- code_sha: a756081（codex/community-home-20261112，草稿 PR #374；含 merge #369 的 953749c；push 用 --no-verify 同 L21）
- docs_sha: 8323f0285e74cc6f95824ab39e691d23250ff9bf
- 环境: 本地 tony-ws run-checks（容器 Chromium/WebKit），axe-core 4.14.0
- 命令: 社区 tab 默认视图改为论坛首页，原平铺列表移到「全部讨论」：新增 app/src/components/CommunityHome.vue、CommunityHeader.vue、app/src/composables/useCommunityHome.ts（区块全部交给 HOME.2 的 buildHomeSections，查询都带 region=cu），plaza/index.vue 接入，zh/en 文案；新增 app/smoke/visual-audit.ts（§0.3 在仓库内的那层）与 app/smoke/community-home.spec.ts；默认视图变了，motion-preference、plaza-attach-picker-is-modal、read-failure-states、seller-publish-responsive 四份旧 spec 改成先进「全部讨论」。只用 App.vue 的 token，视觉方向按 D-35 A。实现由 OMO 子任务（visual-engineering）做，OMO 看过截图后推送。`SMOKE_SPECS="community-home.spec.ts community-board-states.spec.ts contrast-runtime.spec.ts community-topic-row.spec.ts community-post-topics.spec.ts" ~/work/illini-dev-env/run-checks.sh ~/work/illini-home install typecheck test smoke`
- 计数: ① 390：板块标签行、新来先看折叠条、近期活动（无活动不出现）、5 个板块各 3 条、二手新上架横滑、全站最新最多 10 条（用例 ①「390: chips…」与「fewer than five left…」）；② 1280：主栏 876px（2×3 板块卡 + 全站最新 15 条）、侧栏 300px 依次新来先看/近期活动/本周热议/关于本站、首页无左侧栏（用例 ②）；③ 页头搜索占位「搜话题」，只搜社区（两个尺寸各一条用例）；④ 20 帖 fixture 1280×800 六张卡满、全站最新收成一行，60 帖全站最新 15 行（用例 ④）；⑤ data-post-id 唯一、页面无计数「0」、新增 CSS hex 字面量 0、<12px 文本 0、横向溢出 0，日志 `AXE color-contrast violations=0`（390 浅/深/英、1280 浅/深/英，首页区块与整页各一行）（用例 ⑤ ×9）。community-home.spec.ts 19 条全过；install、typecheck rc=0，test 2024/2023/0/1 pg_skips=0，smoke 43 passed（check-20261113T115028Z）[本地测]。截图 13 张（含 20 帖 fixture 一张）存 appendix/visual/HOME.3/
- ci_run_url: —（ci.yml 只对 base 为 main 的 PR 触发，#374 不跑 CI）
- 未测项: 真机；#374 不在 #372 之上，截图里的站名与标识仍是旧占位，品牌以 #372 为准
- 下一条: HOME.5
- 附: [OMO自决] home 分支用 merge 拿到 #369 的 HOME.2、REGION.2（不 rebase 已推送分支），唯一冲突是两边各加的 import，两边都保留。

### L53 · 2026-11-13 06:11 CT · P2.10 小程序话题分享用标题、板块深链；包体在预算内
- task_id: P2.10
- code_sha: 92698d159021612b84005ad4c36908dda537a86c（#369，已推送；push 用 --no-verify 同 L21）
- docs_sha: 5e465ef6c5f89cc5cadd6032cc748ec9815f9439
- 环境: 本地 tony-ws run-checks（mp 构建）；CI
- 命令: app/src/pages/post/index.vue：onShareAppMessage 用话题原标题（最多 50 个 Unicode 字符），path /pages/post/index?id=；新增 app/src/api/communityNavigation.ts，pendingBoard / pendingView 在 switchTab 前写入，社区页 onShow 读取并清空一次；plaza/index.vue 接入，并修掉编辑器 300ms 延迟自动聚焦把标题输入抢到正文的问题（改为按会话守卫的渲染时机聚焦）；新增 app/smoke/community-board-deeplink.test.mjs；community-post-topics.spec.ts 补 390/1280 板块跳转。命令按 BACKLOG：临时 detached worktree ~/work/illini-7b18f20 跑 `~/work/illini-dev-env/run-checks.sh ~/work/illini-7b18f20 install mp`，`~/work/illini-dev-env/run-checks.sh ~/work/illini install typecheck test smoke mp`，之后 `git worktree remove`（不带 --force）。实现由 OMO 子任务（deep-low）做
- 计数: ① 分享标题与深链：单测「mini-program topic shares use the original title, at most 50 Unicode characters, and the permanent post path」「board links stage pendingBoard before switchTab and onShow consumes and clears it once」及直接 query、未知路由用例通过；② 两边 mp 都 rc=0，日志有 `build artifact verified: none 336 files`（7b18f20，check-20261113T112810Z）与 `none 339 files`（92698d1，check-20261113T115848Z）和 packageBytes；③ 主包 1,558,580 字节，比 1.5 MiB 少 14,284；分包都低于 1.6 MiB；④ 字节对照：

| 包 | 7b18f20 | 92698d1 | 差值 |
|---|---:|---:|---:|
| 主包 | 1,534,627 | 1,558,580 | +23,953 |
| pages/detail/ | 56,422 | 56,422 | 0 |
| pages/post/ | 35,003 | 39,465 | +4,462 |
| pages/seller/ | 28,185 | 28,677 | +492 |

install、typecheck rc=0，test 2044/2043/0/1 pg_skips=0，smoke 20 passed（check-20261113T115848Z）[本地测]；之前一轮（check-20261113T114603Z）smoke 2 条失败，原因是编辑器 300ms 延迟聚焦，修后通过
- ci_run_url: https://github.com/EricXu-0805/CAACI_Community_Marketplace_Bazaar/actions/runs/43422815812（Type-check、Boundary、Build H5、Build mp-weixin success；public sweep 停在预检，等 E4）
- 未测项: 真机预览留到 P5.2；分享卡在微信里的实际显示
- 下一条: HOME.5
- 附: 主包只剩约 14 KB 余量；#374 分支（HOME.3 加 HOME.5 进行中）单独构建主包已是 1,561,352（check-20261113T120648Z），两条分支合并后可能超过 1.5 MiB，HOME.5 提交后实测合并结果。L46 把 partial-attach 偶发失败归因于 uni-input 100ms 节流；本条查到的直接原因是编辑器 300ms 延迟聚焦把标题输入抢走，d7e6d9b 的测试等待仍然有效，应用侧的修复在本提交。

### L54 · 2026-11-13 07:10 CT · HOME.5 板块页与「全部讨论」五种状态；#369 合入 #374 分支并解决冲突
- task_id: HOME.5
- code_sha: 2d18576、68eb43b（codex/community-home-20261112，草稿 PR #374，已推送；push 用 --no-verify 同 L21）
- docs_sha: 143b4371bf0800b0932adf670c976294dbc08502
- 环境: 本地 tony-ws run-checks（容器 Chromium/WebKit），axe-core 4.14.0
- 命令: HOME.5（2d18576，子任务 visual-engineering 做）：板块页页头（名称、SPEC §3 范围说明、「发话题」预选该板块，不足 3 条在列表后补位），「全部讨论」三个 tab（新发布｜热门｜关注的人；板块页无「关注的人」），五种状态（加载中 3 行骨架、首次失败+重试、加载更多失败、全空+示例问题+发话题、搜索无结果把词预填进标题）；新增 CommunityAbout.vue、community-board-states.spec.ts；HOME.2 的 communityHome.ts 导出 boardFiller 供板块页共用。同一提交修了 HOME.3 的问题：常驻 tab 被带视图地址的链接重新打开时以地址为准（加 hashchange 跟随）。合并（68eb43b，OMO）：home 分支 merge #369 的 92698d1（P2.8、P2.10），plaza/index.vue 两块冲突——P2.10 的 onLoad/onShow 包进 #ifndef H5 放在 H5 视图代码之前；H5 的 onShow 先消费别的页面经 switchTab 带来的 pendingBoard/pendingView，经 routeOf 交给 showBoard/showAll/showHome；P2.8 的 finishComposerPublication 加 H5 首页刷新标记。随合并调整测试：community-board-deeplink.test.mjs 给 openComposer 补 POST_CATEGORIES 依赖；community-post-topics.spec.ts 的 5 条 P2.8/P2.10 用例改用「New topic」、桌面页头搜索框、板块页地址与页头，并用「跳回板块后不再发出搜索请求」断言搜索词已清空。命令：`SMOKE_SPECS="community-home.spec.ts community-board-states.spec.ts contrast-runtime.spec.ts community-topic-row.spec.ts community-post-topics.spec.ts" ~/work/illini-dev-env/run-checks.sh ~/work/illini-home install typecheck test smoke`（HOME.5）；合并后加 community-post-partial-attach、plaza-attach-picker-is-modal 两份并跑 mp
- 计数: HOME.5：① 板块页页头与补位（用例 ①×2，各跑 390/1280）；② tab（用例 ②）；③ 五种状态各一条用例；④ community-board-states.spec.ts 20 条全过；install、typecheck rc=0，test 2024/2023/0/1，smoke 63 passed（check-20261113T122311Z）；板块页与「全部讨论」390/1280 × 浅/深：社区区域 <12px 0、横向溢出 0、axe 0（AXE 行在同一日志）。合并后：typecheck rc=0；test 第一次 2044/2042/1/1（P2.10 的聚焦单测缺 POST_CATEGORIES 依赖），补依赖后 2044/2043/0/1（check-20261113T125959Z）；smoke 第一次 79 条中 5 条失败（都是 #369 新增用例按旧列表写的），调整后 community-post-topics 9 passed（check-20261113T130758Z），其余 6 份 74 passed（check-20261113T124553Z）；mp 主包 1,568,808（预算 1,572,864，余 4,056）[本地测]。#374 推到 68eb43b，GitHub 显示 MERGEABLE。截图：appendix/visual/HOME.5/ 8 张（板块页、「全部讨论」× 390/1280 × 浅/深）
- ci_run_url: —（ci.yml 只对 base 为 main 的 PR 触发，#374 不跑 CI）
- 未测项: 真机；小程序上的首页（按设计不编进 mp）
- 下一条: —（D-44 可做队列已空）
- 附: 子任务列出 21 处与 SPEC 的出入，要点：首页、新页头、板块页只编进 H5，小程序仍是平铺列表（主包预算）；「近期活动」在 P4.8 前无数据源不渲染，「新来先看」要等 P3 的 is_featured；英文文案按 buildHomeSections 返回渲染，与 SPEC §11 个别处不同；桌面字号按现有 token；app.tagline 与 #372 同位置新增同一 key，合并时取 #372；视图切换用 replaceState 不加历史；桌面板块页与「全部讨论」侧栏只有「关于本站」；发帖入口的无障碍名改为「New topic / 发话题」，九份旧 spec 随之调整。其余见子任务回报（evidence/HOME.5）。风险：主包余量只剩 4,056 字节，下一个进主包的改动大概率超预算。
