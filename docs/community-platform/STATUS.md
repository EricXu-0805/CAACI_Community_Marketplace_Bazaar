# STATUS

写于 2026-11-23 16:23 CT · 作者：OMO（tony-ws）。OMO 每完成一个任务改写本文件，并在 [STATUS_LOG.md](STATUS_LOG.md) 末尾追加一条。证据标签定义见 [README.md](README.md#证据标签)。

`next_task_id: D-59.3`
`latest_batch: appendix/batch/FINAL.md`

D-59第十三批进行中（L370起）。第1项已完成：a9c271b本地完整十步、60轮和只读审阅通过，PR #384的CI45186897514通过，已由supervisor合为main321a916f且同树（L397–L408）。第8项本地182链回放完成：六类不可见文本均可原样存入，全部回滚，平台边界交Eric定（L402–L403）。第9a–e/g/h已更正，第9f等P4最终N；第5项已本地提交cdb4d13，回归与负对照通过（L410–L412），第2项已本地提交de1e58a与3e549ae（A未冻结），完整Node及同步对照通过，真实请求挂起（L414–L420）；现做第3项。

第1项CI及合并均已核；P4从fe80882c按5→2→3→4→6提交，第5项cdb4d13和第2项3e549ae已完成，现做第3项；P3不动、P4不合main。本批不请求caaciorg.com；A在最终门禁与L-SQL通过后只冻结一次，先推材料再唯一推P4。2026-11-25 12:00 CT减项、2026-11-26 12:00 CT收尾按D59.10；完成后关闭目标提醒并停止。

D-58已完成：FINAL与STATUS同提交baa2695，L369收尾7ecac74；目标已结束、提醒已取消。第十二批FINAL不改，第十三批另写更正。P4当前基线fe80882c的门禁、SQL与终审结果仍见L358–L369。

## 第十三批开工背景（D-59第0项，逐字照录）

- 第十二批验收：supervisor 做了五个维度的独立核查（P4.6 迁移、P4 客户端、门禁、P3 与视口后续、报告与过程），最后由覆盖审阅逐项核。没有阻断项，也没有 major。在 tony-ws 自己的目录里复现了：P4 fe80882c 全量 TEST 2981/2980/0/1、pg_skips 0，smoke 729 条 720 passed、8 failed、1 skipped（8 条都是首页、广场、活动页、发起页的浅色深色巡检，Received 每一行都属于三种 stub 主机报错，community-events.spec.ts 同一次 0 失败），主包 1,468,020；:699 ×60 60/60；L-SQL 185/185、P3_TOTAL 703/703、EV_TOTAL 855/855、MEV_TOTAL 38/38，VERIFY_20261122035253 的 NOTICE 是 enabled=f；P3 4e7bd214 TEST 2800/2799/0/1、主包 1,422,771；视口 cca63d95 TEST 2664/2663/0/1、主包 1,381,447，viewport-inset-consumers.spec.ts ×10 50/50、0 跳过；三个 head 的 manifest 全部核对通过，五条冻结迁移逐字节相同。
- 上线进度【supervisor 做】（UTC）：2026-11-23 07:47:52 把 #383 改成 ready 并 squash 进 main（d3bfc17e，树 ed33cf3f 与 cca63d95 相同，提交说明手写，不带 sisyphus-dev-ai 那一行）；只动了测试和注释，生产不用发布，仍是 dpl_9KmHcW（9171976e）；main 上 run 45133719064 七个 job 全过。
- 核查发现、本批要修的：胶囊静态用例只查有没有那条声明，不查它是不是排在 `padding` 简写之后（第 5 项 a）；发起页提交失败那条路径上 `stored.persist()` 的结果没人看（第 5 项 b，第十二批之前就有）；视口根高度用例只因为首页内容碰巧比视口高才会红，没有断言这个前提（第 1 项 b）；第十二批 6h 那份已知缺口清单漏了 U+034F 和 U+206A–U+206F，也没写标题、说明同样能显示成空白（第 9 项 a）；STATUS 第 34 条和 CI 那一行过期（第 9 项 b）；FINAL 第十二批一处 L 号、一条 17a 的【OMO自决】、scan17d.log 第 25 行（第 9 项 c）；第十二批终审子任务 st_01a206bf 用 subagent_type 派出、没带 category（第 0 项用号那一款）。
- 账本：supervisor 2026-11-23 08:30 UTC 前后只读核过，生产和 staging 的账本里都没有 20261120100354、20261120122054、20261122035253。
- 用号（更正 D-58 第 0 项的上限）：ChatGPT login-3 不设上限，用到 OMO 自己在 95% 跳号为止（Eric 2026-11-22 23:53 CT 原话见抬头；reset 由 Eric 做，supervisor 提醒他）；Claude 各号 7d 上限仍是 85%，顺序 default → account-2 → account-5 → account-4，account-3 登录过期排最后；ChatGPT default、login-2 登录已过期，等 Eric 重新接回。主会话在 chatgpt-subscription/gpt-6-astra 上。用量由 supervisor 看，OMO 不查用量、不切号、不切模型、不改 ~/.omo。子任务的类别（只用 D-57 第 10 项那 7 个，派子任务一律带 category，不用 subagent_type 代替）、开工时只读跑 `omo doctor --models` 核对、失败后最多改派一次、出现 fallback 或换号时记一行，都照 D-57 第 10 项，额度数字以本项为准。停下以 supervisor 的通知为准，停下时照 D-51 第 1 项把已完成的部分写进 STATUS 和 FINAL。

## 第十二批开工背景（D-58第0项，逐字照录）

- 第十一批验收：supervisor 做了五个维度的独立核查（P4.6 迁移、P4.6 客户端、P4 门禁、P3 与视口后续、报告与过程），blocker、major 配反驳方，最后由覆盖审阅逐项核。没有阻断项。在 tony-ws 自己的目录里复现了：P4 c106e23 全量 TEST 2965/2964/0/1、pg_skips 0，smoke 721 条 712 passed、8 failed、1 skipped（8 条都是首页、广场、活动页、发起页的浅色深色巡检，Received 每一行都属于三种 stub 主机报错，community-events.spec.ts 同一次 25 过 0 失败），主包 1,473,057；marketplace-responsive.spec.ts:699 ×60 60/60；P3 597b7fa TEST 2800/2799/0/1、主包 1,422,771；在 c106e23b 的 L-SQL 回放上做了列级授权和零宽字符探针，VERIFY_20261122035253 的 NOTICE 是 enabled=f（L-SQL 185/185、P3_TOTAL 703/703、EV_TOTAL 855/855、MEV_TOTAL 25/25 是 OMO L303 的结果，supervisor 没有另跑全链计数）；开关关着时没有任何能新建成员活动的路径（已有活动的发起人仍能取消、改说明，说明照旧过审核，见第 3 项 g），开关打开后名额、验证、审核都绕不过去；member_events_closed 在迁移、客户端、测试、文档里一律是 P0001。
- 核查发现、本批要修的：小程序上活动页「发起」和活动详情页菜单被微信胶囊挡住（第 3 项 a）；开关关着时入口不出现的保持窗口用例不会变红（第 3 项 b）；视口后续 PR 的根高度前提用例在页面挂载之前就量了、messages 双栏用例一直跳过（第 1 项）；地点、标题、说明里的零宽和方向控制字符能绕过保留词检查（例如在「hos」和「ted by」之间插一个 U+200B，显示仍是 hosted by），只由 U+200B 组成的地点能存进去、显示成空白（第 4 项；正文的链接检查同样受影响，一并修）；两张开关表的 VERIFY 不查列级授权（第 5 项）；第十一批报告的几处引用和 STATUS 改动（第 6 项）。
- supervisor 追认：L293 把 community-events.spec.ts:177 的「不渲染任何图片」放宽到不含 `.evc-avatar`（SPEC 6.7.3 要求成员活动卡片显示发起人 20px 头像）；d7d11f4 对两个 P3 时期 spec 的断言边界修正（期望值没变，负对照红过），本批同样搬到 P3（第 2 项）。
- 账本：supervisor 2026-11-22 21:00Z 前后只读核过，生产和 staging 的账本里都没有 20261120100354、20261120122054、20261122035253。
- 用号（Eric 2026-11-21 21:47 CT）：所有号（Claude 各号和 ChatGPT login-3）7d 上限一律 85%；Claude 顺序 default → account-2 → account-5 → account-4，default 过线时排到 account-4 后面、重置后挪回第一（supervisor 做）；ChatGPT login-3 先用，default、login-2 登录已过期，等 Eric 重新接回。主会话在 chatgpt-subscription/gpt-6-astra 上，7 个类别 ChatGPT 打头、Claude 兜底（D-57 第 0 项）。用量由 supervisor 看，OMO 不查用量、不切号、不切模型、不改 ~/.omo；子任务只用 D-57 第 10 项那 7 个类别。停下以 supervisor 的通知为准，停下时照 D-51 第 1 项把已完成的部分写进 STATUS 和 FINAL。子任务的类别、开工时 `omo doctor --models` 核对、失败后最多改派一次、出现 fallback 或换号时记一行，都照 D-57 第 10 项，额度数字以本项为准。

用号更正（D-59第0项，覆盖旧85%口径）：ChatGPT login-3不设上限，用到OMO自动95%跳号，reset由Eric做；Claude各号7d上限仍85%，顺序default → account-2 → account-5 → account-4，account-3登录过期最后；ChatGPT default/login-2已过期。用量及停下通知归supervisor；OMO不查用量、不切号或模型、不改~/.omo。所有子任务只用已核的七个category，不用subagent_type。

## 第十一批开工背景（D-57 第 0 项，逐字照录）

- 第十批验收：supervisor 做了五个维度的独立核查（视口代码、视口复现、P3、P4、报告与第 17 条），blocker、major 配反驳方，最后由覆盖审阅逐条核 26 条发现。没有阻断项。在 tony-ws 自己的目录里复现了：main 66e14a45 上 marketplace-responsive.spec.ts:699 60 次失败 16 次（都在第 705 行，期望 830、实得 480）；19c4657 上三组 ×60 共 180 次 0 失败；新用例去掉修复后 10/10 红在第 803 行；和聊天、键盘、视口相关的 13 个 spec 在修复前后结果相同；小程序产物里没有 ResizeObserver。P4 的 VERIFY_reply_notice_switch.sql 正对照和四个负对照 37 步 37 过，L-SQL 184/184、P3_TOTAL 703/703、EV_TOTAL 855/855。26 条里 22 条已修；process:B9-1、process:B9-2、report:B9-2 只做了一部分（本条第 1、2、9 项）；mig:P3-B9-3 按 D-56 只记录。
- 第十批核查新发现的两处过程缺陷：① §12 第 17a 条的口令文件都是 1 字节（主会话用 tool.bash 的 env 参数传口令，没传进去），本批没发过带口令的 steer，所以没有后果；② §12 第 17d 条的扫描在材料分支 13 次推送里只跑过一次，是 1ba07e5 那次（倒数第二次），只扫了它新增的 124 行，没扫提交说明（%B），没核 ①（身份）；最后一次 d81ca04 没有扫描记录。本条第 1、2 项改成脚本，RUNBOOK §12 第 17a、17d 条 supervisor 已同步改写。
- 上线进度【supervisor 做】（UTC）：2026-11-21 16:09:20 把 #382 squash 进 main（9171976e，树与 19c4657 相同）；main 上 run 44922991731 七个 job 全过。Claude Code 的 auto mode 先拦下了一次 create_deployment（当时什么都没建）；Eric 2026-11-21 19:41 CT 在会话里批「Yes, release it」后，按 docs/SUPERVISED_RELEASE.md 发布：create_deployment 一次得到 dpl_9KmHcWZx3f2TUKKSLxuVc62QwZRu，32 秒就绪，Vercel 自己把两个生产域名指了过去，没有调 promote；www 的 deployment-identity 用新 nonce 核到 9171976e，根域 308 跳 www；之后 background-jobs 每分钟 check-in ok。候选唯一 URL 那一项没核（Chrome 扩展没连上）。回滚目标是 dpl_DQwi8Z（66e14a45）。iPad 真机检查仍归 Eric。
- 模型与号池【supervisor 做】（2026-11-22 02:19Z 前后，在 tony-ws 上，主会话空闲、没有子任务时）：Eric 的 ChatGPT 号以 login-3 接进 chatgpt-subscription（device code 登录，走 legacy 路线），排在 default、login-2 前面（这两个登录已过期）；Eric 的 OpenAI API key 存进 provider openai（Eric 自己在 TUI 里贴的，supervisor 没经手），按 token 计费，不进任何自动链；~/.omo/agent/settings.json 的 retry.fallbackChains 加了 `chatgpt-subscription/gpt-6-astra → anthropic-subscription/claude-opus-5-5`；~/.omo/omo.json 的 categories 改成对象写法（原来的 `provider/model:档位` 字符串写法只有第一个模型生效，Claude 兜底从 2026-11-13 起一直没进运行链），deep-high、deep-low、ultrabrain、unspecified-high、unspecified-low、architect、visual-engineering 都改成 ChatGPT 打头、Claude 兜底，另加 `exclude_models: ["openai/*"]`；`omo doctor --models` 核过 7 个类别的首行都是 chatgpt-subscription/… -> anthropic-subscription/…、没有 openai；主会话经控制 socket 的 set_model 切到 chatgpt-subscription/gpt-6-astra xhigh（只改本会话，settings.json 的 defaultModel 不变）；Claude 号池顺序改成 account-2 → account-5 → account-4 → default → account-3：default 本周 7d 已用约 88%，先用余量多的号。D-52 第 0 项对 default 不设上限，Eric 2026-11-19 定的顺序是 default 打头，这次调序由 supervisor 代定，写进 ⑧；default 重置后由 supervisor 改回 default → account-2 → account-5 → account-4。备份是 ~/.omo/agent/settings.json.before-20261121-gpt-first 和 ~/.omo/omo.json.before-20261121-gpt-first，改前改后的 doctor 输出在 ~/omo-ctl/models-*.txt；RUNBOOK §10 那张表 supervisor 已追加 2026-11-21 的五行。OMO 不改 ~/.omo、不切模型、不改号的顺序（第 10 项）。

## 版本

| 项 | 值 |
|---|---|
| 代码分支 / PR | #369、#375、#374、#377、#372 已由 supervisor 依次 squash 进 main（ad986c9、e9c2604、4900722、05e0959、3778952、66e14a45（#381）；D-54 第 0 项、L151，D-56 第 0 项） [本地测：2026-11-21 gh pr view] |
| code_sha | 321a916f1d5cf41fa101d5bed35eceffc674921d（main，#384于2026-11-23 19:26:06Z合并，与已验证a9c271b同树；L408） |
| 基线 main | 321a916f1d5cf41fa101d5bed35eceffc674921d（D-59第1项合并后已核祖先及树；P4对照仍用9171976e，P4不合main） |
| 材料分支 / PR | codex/community-plan-v5 / #370（草稿，OPEN，不合并）[本地测：2026-11-13 git ls-remote] |
| docs_sha | dfe18093（本次写回之前材料分支的HEAD） |
| 其余代码分支（远端 head） | #379 codex/community-p3-20261120 4e7bd21（base codex/community-restricted-20261113，D-58已推送，L343）；#380 codex/community-events-20261120 fe80882（base P3 的分支，D-58已唯一推送并更新正文，L364–L365）；#383 codex/community-viewport-consumers-20261121 cca63d9（已合main d3bfc17e，D-59.0）；#384 codex/community-smoke-stub-20261123 a9c271b（已合main321a916f，本批仅一次代码推送）；#379、#380仍为草稿。已合进 main：#369、#371、#372、#374、#375、#376、#377、#381（66e14a45）、#382（9171976e，2026-11-21 16:09:20Z squash）、#383（d3bfc17e）、#384（321a916f）；#373、#378 已合进各自 base 分支 [当前#384由2026-11-23 gh pr view与git ls-remote核对；其余沿用D59.0或各原记录] |
| tony-ws worktree | illini 8f5fc43（#369，已合）；illini-home 75a3447（#374）；illini-mpbudget dfa1aa0（#375，远端已是 supervisor 的 700c7be）；illini-restricted 9a31e75（#377）；illini-p3 4e7bd21（D-58已推送；门禁、699六十轮及SQL通过）；illini-events-20261120 3e549ae（第5、2项已本地提交；远端仍fe80882，A未冻结）；illini-viewport-consumers cca63d9（已随#383合main，本批不改）；illini-smoke-stub a9c271b（已随#384合main321a916f，本地完整门禁、60轮及CI通过）；illini-ci-runner f0ccd8f（#376，已合）；illini-vite645 80b3eb0（#378，已合）；illini-brand f5dd044（#372，已合进 main 3778952）；illini-config b259105（#371，已合）；illini-deps 55716ba（#373，已合）；confirm-369-8f5fc43 detached 8f5fc43（C-369）。本地不推送：illini-events wip/P4.1 5f62ddd（已 merge 进 #380）、illini-d46-integration、illini-d51-seal、illini-docs-brand7；illini-main 只读 7b18f20；caaciorg 本地 28d59b1；5 个第四批证明 worktree 留着（阻塞第 23 条）；confirm-final-3778952 3778952（detached，C-final 与D-55 main对照，只跑不提交）；illini-seal c1cacb6（#381） [本地测：本批三个工作树为本次更新；其余为此前记录] |
| 公开 demo | https://illini-community-demo.vercel.app/ 已由 supervisor promote BRAND.7（新生产部署 dpl_7p18WL7JTqxbK8VKqNVVnYepLj1b，`grep -c 玉米地` 为 6；回退 dpl_E3AmucjjeUZfCmPQ7NQRi2eiaAv6；D-53 第 0 项 d） |
| 小程序 | wxc3da81aa8852a6ff「香槟市集」，开发版 2026-10-26 上传，未提审 [真人：Eric 记录] |

## CI

#384（head a9c271b，已合main321a916f）的run45186897514已completed/success：五个job成功，protected staging与production readiness按条件跳过；本地完整十步与60轮通过，合并与同树已核（L397–L401、L406、L408）；合并后main的新CI未查询。

#383已由supervisor合进main：PR最终head cca63d95的run [45103933628](https://github.com/EricXu-0805/CAACI_Community_Marketplace_Bazaar/actions/runs/45103933628) completed/success，五job成功，protected staging与production readiness按条件跳过；main d3bfc17e的run [45133719064](https://github.com/EricXu-0805/CAACI_Community_Marketplace_Bazaar/actions/runs/45133719064) 七job全部成功。本批已独立读取元数据（D-59.0/9b）；原45043777896只是较早head的历史结果。

现状（2026-11-20，D-54 第 1 项 e 更正）：main 上 run 44739894523（057d07d，run_attempt 2）七个 job 全过；之后 main 依次是 ad986c9、e9c2604、4900722、05e0959、3778952（supervisor 的 squash 合并）；3778952 上 run 44783052160 七个 job 全过（D-55 第 4 项 b 补）。下面关于 8257318、0e04aca 等的段落是历史记录。

**GitHub Actions 停过一段（D-52 第 4 项 a）。** 2026-11-20 约 01:25Z 起，#370 的 run 44653535391（f86ada1）、44660742581（7dda6cb）、44671115623（0c95cc4）都在 4–5 秒内结束，每个 job 0 个步骤，注解原话是「The job was not started because recent account payments have failed or your spending limit needs to be increased.」Eric 2026-11-20 01:16 CT 把仓库改成公开，07:15Z 起是 PUBLIC。本批第一次推送（材料分支 ea66373）触发的 run 44696137300：每个启动的 job 都有步骤（Type-check 8、Build mp-weixin 10、Boundary 13、public sweep 12、Build H5 13；protected staging 与 release readiness 按条件 skipped），没有付款注解，按 D-52 的标准 CI 已恢复（L111）。这个 run 的 Build H5、public sweep 失败在装浏览器那一步，是 #370 分支没有 c52badf、ubuntu-26.04 的老问题。#372 d6f393d 的 run 44651530274 也一样：Type-check、Boundary、Build mp-weixin 成功，Build H5「Install browsers for compiled admin acceptance」和 public sweep「Install Playwright (webkit + chromium)」失败 [CI run#44696137300][CI run#44651530274]。

#376 新 head 0e04aca 的 run 44699877648：Type-check、Boundary、Build H5、Build mp-weixin、public sweep 5 个 success（Build H5 和 public sweep 跑在 87e57c3（c52badf 的 cherry-pick）钉的 ubuntu-24.04 上），审计步骤按依赖门 skipped [CI run#44699877648]。#377 的 base 是 #374 的分支，没有 CI。#370 的 run 44698816891、44703187712：Build H5 和 public sweep 失败在装浏览器那一步，是 ubuntu-26.04 的老问题，不是付款问题（D-53 第 1 项，L122）。

#369 当前 head 8257318（空提交，树同 04edaa3）的 run 44647478789：5 个 job 全部 success，public sweep 的 schema 预检五项都是 200、浏览器巡检 472 passed；protected staging 与 release readiness 2 个 skipped（L102）。

PR #369 · run [44647478789](https://github.com/EricXu-0805/CAACI_Community_Marketplace_Bazaar/actions/runs/44647478789) · head 8257318 · conclusion success [CI run#44647478789]

| job | 结论 | 计数 / 原因 |
|---|---|---|
| Type-check | success | |
| Boundary regressions | success | 2156 tests：2155 pass / 0 fail / 1 skipped；runner ubuntu-26.04 [CI run#44647478789] |
| Build H5 | success | |
| Build mp-weixin | success | |
| Smoke (public page sweep) | success | schema 预检五项 200；472 passed（25.5 分钟）；runner ubuntu-24.04（c52badf）[CI run#44647478789] |
| Smoke (protected staging account) | skipped | |

上一次：run 43539761691 · head 04edaa3 · failure（4 个 success；public sweep 停在 schema 预检，当时 staging 还没有 20261112120000）[CI run#43539761691]。

材料分支 #370：多数已读失败来自ubuntu-26.04不能安装Playwright 1.60浏览器；不能把所有失败都归到这一原因。此前记录的43470604328、43475385858、43484767294、43487337489、43490982420保留；另有43474247871、43474954537取消。新增六次按Actions API和实际job日志核对如下（证据~/work/evidence/CI/supervisor-six-runs-20261113.md）。

| run / head | 失败分类 | 证据 |
|---|---|---|
| [43493142000](https://github.com/EricXu-0805/CAACI_Community_Marketplace_Bazaar/actions/runs/43493142000) / 9bc4b55 | H5/public浏览器安装步骤失败，H5日志明确ubuntu26.04与Playwright1.60不兼容；Boundary成功 | [CI run#43493142000] |
| [43495796397](https://github.com/EricXu-0805/CAACI_Community_Marketplace_Bazaar/actions/runs/43495796397) / f01d04b | H5/public浏览器安装步骤失败，H5日志明确ubuntu26.04与Playwright1.60不兼容；Boundary成功 | [CI run#43495796397] |
| [43501071827](https://github.com/EricXu-0805/CAACI_Community_Marketplace_Bazaar/actions/runs/43501071827) / d982ec8 | H5/public浏览器安装步骤失败，H5日志明确ubuntu26.04与Playwright1.60不兼容；Boundary成功 | [CI run#43501071827] |
| [43503851223](https://github.com/EricXu-0805/CAACI_Community_Marketplace_Bazaar/actions/runs/43503851223) / b4788cf | H5/public浏览器安装步骤失败，H5日志明确ubuntu26.04与Playwright1.60不兼容；Boundary成功 | [CI run#43503851223] |
| [43509639602](https://github.com/EricXu-0805/CAACI_Community_Marketplace_Bazaar/actions/runs/43509639602) / 7293b01 | 另有Boundary测试超时；H5/public浏览器安装步骤也失败 | [CI run#43509639602] |
| [43525055626](https://github.com/EricXu-0805/CAACI_Community_Marketplace_Bazaar/actions/runs/43525055626) / 1d1734c | H5/public浏览器安装步骤失败，H5日志明确ubuntu26.04与Playwright1.60不兼容；Boundary成功 | [CI run#43525055626] |
| [43528915421](https://github.com/EricXu-0805/CAACI_Community_Marketplace_Bazaar/actions/runs/43528915421) / c4557c0 | H5/public 浏览器安装步骤失败（同 43493142000）；Boundary 成功 | [CI run#43528915421] |
| [43538315477](https://github.com/EricXu-0805/CAACI_Community_Marketplace_Bazaar/actions/runs/43538315477) / ed26304 | H5/public 浏览器安装步骤失败（同 43493142000）；Boundary 成功 | [CI run#43538315477] |
| [43542174637](https://github.com/EricXu-0805/CAACI_Community_Marketplace_Bazaar/actions/runs/43542174637) / abbd6b0 | H5/public 浏览器安装步骤失败（同 43493142000）；Boundary 成功 | [CI run#43542174637] |
| [43543108152](https://github.com/EricXu-0805/CAACI_Community_Marketplace_Bazaar/actions/runs/43543108152) / f20f44c | H5/public 浏览器安装步骤失败（同 43493142000）；Boundary 成功 | [CI run#43543108152] |
| [43547172052](https://github.com/EricXu-0805/CAACI_Community_Marketplace_Bazaar/actions/runs/43547172052) / 45add2a | H5/public 浏览器安装步骤失败（同 43493142000）；Boundary 成功 | [CI run#43547172052] |
| [43552639055](https://github.com/EricXu-0805/CAACI_Community_Marketplace_Bazaar/actions/runs/43552639055) / 82b4ccf | H5/public 浏览器安装步骤失败（同 43493142000）；Boundary 成功 | [CI run#43552639055] |

43509639602的Boundary为1989 tests / 1987 pass / 1 fail / 1 skipped：scripts/ci-first-release-supervised-host.test.mjs:133，unknown connector response retains intent and never automatically repeats dispatch，failureType=unhandledRejection，error/code=supervised_operation_timeout。像时序不稳，但未复现或定位根因；单列为测试失败，未改测试、未跳过，也不当作Ubuntu安装问题。

主包测量环境：一律按 CI build-mp-weixin 环境（https://ci-stub.supabase.co，ci.yml 第 301–303 行；run-checks 的 `mpci` 步骤）量。第三批及以前的数用 H5 job 的 stub URL 量，每个比 CI 环境多 91 字节。预算 1,572,864 字节。

| 分支 / 组合 | 主包（CI 环境） | 余量 | 来源 |
|---|---|---|---|
| #369 ae058c2 | 1,560,392 | 12,472 | check-20261113T202910Z，L77 [本地测] |
| #369 4a44a41 | 1,560,396 | 12,468 | check-20261113T200620Z，L76 [本地测] |
| #369 520e55a | 1,560,420 | 12,444 | check-20261113T190341Z [本地测] |
| #375 73cde94 | 1,324,735 | 248,129 | 012024Z的通过构建；后续仅修测试夹具，产品输入未变，L88 [本地测] |
| #375 0eabe73 | 1,324,732 | 248,132 | check-20261113T234802Z，6/6、mpci通过，L84 [本地测] |
| #375 22d9009 | 1,324,732 | 248,132 | check-20261113T213421Z，L81 [本地测] |
| #375 3d24a8e | 1,502,862 | 70,002 | check-20261113T182923Z [本地测] |
| #375 ecc330b（D-46 第 4 项） | 1,322,319 | 250,545 | check-20261113T191554Z，L73 [本地测] |
| #375 30c4b4d（合入 #369 3b、3f） | 1,324,250 | 248,614 | check-20261113T193317Z：test 2162 / 2161 / 0 / 1，smoke 105 passed、只有 4 条已知 pages.smoke 失败 [本地测] |
| 五 PR 本地集成 412e14d（#374 2e0f582 + #373 55716ba + #372 ba070e7） | 1,374,461 | 198,403 | check-20261114T030753Z，L90 [本地测] |
| #374 2e0f582（含#369 04edaa3+#375 571be45） | 1,373,060 | 199,804 | check-20261114T025250Z，119/119、typecheck/mpci，L90 [本地测] |
| #375 571be45（含#369 04edaa3） | 1,324,735 | 248,129 | check-20261114T023656Z，119/119、typecheck/mpci，L90 [本地测] |
| #374 adc6ee7（含#375 73cde94） | 1,373,060 | 199,804 | check-20261114T014642Z，108/108、typecheck/mpci通过，L88；五PR仍待集成 [本地测] |
| #374 e495ad7（含#369 ae058c2+#375 0eabe73） | 1,373,057 | 199,807 | check-20261113T235304Z，6/6、mpci通过，L84；仍未含#372/#373 [本地测] |
| #374 c7b0634（含#369 ae058c2+#375 22d9009） | 1,373,057 | 199,807 | check-20261113T224013Z，L82；未含#372/#373 [本地测] |
| #374 885603e（D-47.2） | 1,372,454 | 200,410 | check-20261113T214641Z，L80 [本地测] |
| #374 b35cf8e（已含#369+#375） | 1,372,224 | 200,640 | check-20261113T205110Z，L79；未含#372/#373 [本地测] |
| #374 6d6c598 | 1,551,820 | 21,044 | check-20261113T183852Z [本地测] |
| #374 6d6c598 ＋ 3d24a8e 试合（supervisor） | 1,551,949 | 20,915 | D-47 第 6 项；这是第二轮拆包前的历史组合，已被本次组合实测替代，没算 #369 的 3b、3f 和 #372、#373 |
| main 3778952（D-56 第 4 项 a 的基线） | 1,381,447（与基线差 0） | 191,417 | L173，mpci packageBytes.main |
| main 66e14a45（#381 合并后；印章 c1cacb6 同树） | 1,381,447（与基线差 0） | 191,417 | L190，mpci packageBytes.main |
| main 9171976e（#382 合并后） | 1,381,447（与基线差 0） | 191,417 | 与 19c4657 同树，L213；D-57 第 9 项 b |
| P3 7ccb195（第九批） | 1,422,595（与基线差 +41,148） | 150,269 | L179，mpci packageBytes.main |
| P4 24ff7bf（第九批） | 1,459,446（与基线差 +77,999） | 113,418 | L193，mpci packageBytes.main |
| P3 fdb823a（第十批，D-56 第 3 项 b–d） | 1,422,723（与基线差 +41,276） | 150,141 | L208，mpci packageBytes.main |
| 视口 19c4657（第十批，D-56 第 1 项，#382） | 1,381,447（与基线差 0） | 191,417 | check-20261121T125522Z，mpci packageBytes.main |
| P4 02d4d4c（第十批，D-56 第 3 项 a、f–j，#380） | 1,459,574（与基线差 +78,127） | 113,290 | check-20261121T135041Z，mpci packageBytes.main |
| P3 597b7fa（第十一批） | 1,422,771（与基线差 +41,324） | 150,093 | L254；较fdb823a增加48字节，来自触摸守卫和动作行高度 |
| P4 7e61541（第十一批首轮，未作为发布版） | 1,472,398（与基线差 +90,951） | 100,466 | check-20261122T134303Z；较02d4d4c增加12,824；pages/event 31,488；该轮有WXSS失败，修后最终值另列 |
| 视口56f83cd（第十一批，#383） | 1,381,447（与基线差0） | 191,417 | check-20261122T152833Z，L288；较9171976e差0 |
| P4 d7d11f4（第十一批，头像补齐前验证） | 1,472,398（与基线差+90,951） | 100,466 | check-20261122T161609Z的mpci已通过；较02d4d4c增加12,824，pages/event 31,499；阶段全量已按规则判过，见L296 |
| P4 c106e23（第十一批，含列表头像） | 1,473,057（与基线差+91,610） | 99,807 | check-20261122T173858Z；pages/event分包31,499；较02d4d4c增加13,483、较d7d11f4增加659；最终门禁按规则通过，L303 |
| P3 4e7bd21（第十二批） | 1,422,771（与基线差+41,324） | 150,093 | check-20261123T011812Z，L340；较597b7fa差0，改动只在测试、VERIFY和RUNBOOK |
| 视口cca63d9（第十二批） | 1,381,447（与基线差0） | 191,417 | check-20261123T020537Z，L348、L351；较56f83cd差0 |
| P4 fe80882（第十二批已推送） | 1,468,020（与基线差+86,573） | 104,844 | check-20261123T033605Z；较c106e23减少5,037，pages/event为37,187；逐文件差额L361，全量按例外通过L358 |
| 本地巡检a9c271b（第十三批，#384） | 1,381,447（与基线差0） | 191,417 | check-20261123T123228Z mpci；只改测试，较d3bfc17e差0，十步及60轮L397–L398 |
| P4 cdb4d13（第十三批第5项，本地） | 1,468,020（与基线差+86,573） | 104,844 | check-20261123T194559Z候选tree与提交同树；较fe80882主包差0，pages/event为37,201（+14，catch告警分支），L412 |

main · 定时 run [42684660097](https://github.com/EricXu-0805/CAACI_Community_Marketplace_Bazaar/actions/runs/42684660097) · 2026-11-09 · runner ubuntu-26.04 [CI run#42684660097]

| job | 结论 | 原因 |
|---|---|---|
| Build H5 | failure | Playwright does not support chromium on ubuntu26.04-x64 |
| Smoke (public page sweep) | failure | Playwright does not support webkit on ubuntu26.04-x64 |
| Boundary regressions | failure | 测试 1989：1988 pass / 0 fail / 1 skipped 通过；npm audit --audit-level=moderate 报 44 个漏洞（9 moderate、35 high）退出 1（D-41） |
| 其余 job | 未记录 | |

tony-ws 本地 · 005ca9d · localhost/illini-dev:pw1.60-node22-pg17：install/typecheck/h5/mp/migrations 通过；test 1997 = 1996 pass / 0 fail / 1 skipped；smoke 9 passed（见 STATUS_LOG L03）[本地测]

## 验收表

| 任务 | 结论 | 证据 |
|---|---|---|
| P1.1 | 通过 | DoD 六项全部符合，见 STATUS_LOG L15 [本地测] |
| P1.2 | 通过 | DoD ①–⑥ 符合，见 STATUS_LOG [本地测] |
| P1.3 | 通过 | test 1994 / 1993 / 0 / 1，pg_skips=0；写死路径 32→1 [本地测] |
| P1.4 | 通过 | 旧色 grep 15→0；typecheck、h5、mp rc=0 [本地测] |
| P1.5 | 通过 | ①–④ 通过（fsevents 删除经 Eric 批准）[本地测]；⑤ #371 的 Build H5 在 ubuntu-26.04 上 success [CI run#43397680516] |
| P1.13 | 通过 | DoD ①–④ 符合；link 拉下的 .env.local 已按 Eric 答复删除 [本地测] |
| P1.9 | 通过 | 镜像 169f16e6…，全量每步 rc=0；test 1994 / 1993 / 0 / 1 [本地测] |
| P1.10 | 通过 | D-44：#369 5abcb86 新增 4 份 _ops LOCAL_BOOTSTRAP 后第 1 次计数尝试 181/181；变红验证停在 20260916073035 [隔离环境 L-SQL] |
| P1.7 | 通过 | 草稿 PR #371，head b259105；Type-check、Build H5、Build mp-weixin、public sweep success，Boundary 只卡依赖审计（# fail 0、# skipped 1）[CI run#43397680516] |
| P1.6 / P1.8 | 部分 / 通过 | P1.6：同大版本在 #371，跨大版本在 #373，vite 6.4.6 在 #378；#378 → #373 → #371 → main 已由 supervisor 合完（D-53 第 9 项，main 057d07d）。P1.8：#369 8f5fc43 先 revert c52badf 再 merge main，级联到 #375、#374、#377（L136）。P1.11、P1.12 见下面各自一行 |
| P2.1 | 通过 | ①②④ 本地；③ 由 CI 的 public sweep 在 staging 上给出预期报错（本地 S-1 运行等 E3）[CI run#43377614567] |
| P2.2 | 通过 | test 2001 / 2000 / 0 / 1，smoke 35 passed [本地测]；CI Boundary 同数 [CI run#43377614567] |
| P2.3 | 通过 | 9→0；两张截图第 2 项为「社区」；smoke 14 passed、test 2001/2000/0/1 [本地测]；CI 同前 [CI run#43380822445] |
| P2.4 | 通过 | smoke 23 passed、test 2001/2000/0/1 [本地测]；CI [CI run#43383800477] |
| REGION.1 | 通过 | 列、约束、只读授权、region_in 已并入；test 2001/2000/0/1 [本地测]；④ 的 VERIFY/L-SQL 随 P2.5 |
| P2.5 | 通过 | 20261112120000 冻结（sha256 e2a85c3e…）；L-SQL 181/181，PRECHECK→REPLAY→VERIFY→REGRESSION 全过；test 2001/2000/0/1 [隔离环境 L-SQL][本地测]；④ staging 探测等 E3 |
| P1.11 | 通过（7b18f20 基线、C-369、C-final 都过；C-final 在 main 3778952 上 cfinal-1，L152–L153） | D-53 第 8 项第 4 次：3 passed；3 个 schema 读取 200；A/B/C 同意布尔均为真、already_recorded，核实第 3 次 204×3 的同意仍在；规范首页和标题 3 秒后仍符合，3 张无账号字段截图已看。UI/SDK 共 6 次 local logout 均 HTTP 204，新会话残留 0；第 5 次未用（L129、L130）。C-369（D-53 第 10 项）在 #369 8f5fc43 上 c369-1 通过：3 passed，A/B/C 未受限、同意仍在，13 个探针与 L133 逐字节相同（L138、L139） |
| P1.12 | 通过（7b18f20 基线、C-369、C-final 都过；C-final 在 main 3778952 上 cfinal-1，用 probes-home/ 适配版，L152–L153） | D-53 第 8 项第 4 次 1 passed；control_A 与 [SYN-P1.12] 正对照通过，缓存窗口 4775ms；B 五次 inspect 四项均 0、身份均为 B，pre/post observer 51/17 次回调、泄漏最大值均 0。welcomed=1 后 page.reload（普通重载，WebKit）仍在帖子页，卡片与作者按钮可见；B 帖已删且查 0 行，验收与最后清理共 7 次 UI/SDK logout 全 204，新会话残留 0。第 5 次未用，最后清理 1 passed、库存与最终查询均 0 行（L130–L133）。C-369 c369-1 在 8f5fc43 上通过：1 passed，B 五次 inspect 与 pre/post 观察器泄漏最大值均 0，缓存窗口 4507ms，B 帖清理后 0 行，新留私信 86cec6b2（L138、L139） |
| P2.6 | 通过 | D-53 第 0 项 b 代替「Eric 留言」，D-51 第 6 项代替 DoD ①；schema 预检 5 / 5；#369 head 8257318 的 run 44647478789 五个必需 job 全过（Boundary 2156 / 2155 / 0 / 1，public 472 passed，H5 验收 52 passed）（L102、L126） |
| P2.11 | 通过 | L126 的 7 个禁止写入全被拒，匿名列表/搜索均查不到已删帖；P1.12 第 4 次通过，依赖解除（L132）。期望已改为同时匹配码与 message，但未重跑；「已改、未执行；L126 的证据出自改之前的版本」。按 §5.2 留下无删除入口的 1 件已售商品、1 个已接受报价、2 个会话，ID 见 L129 |
| P2.7 | 通过 | smoke 15 passed、test 2001/2000/0/1 [本地测]；CI [CI run#43392843858] |
| P2.8 | 通过 | 46e69b8（已推送 #369）；test 2035/2034/0/1、pg_skips=0，smoke 19 passed，typecheck rc=0；见 STATUS_LOG L51 [本地测] |
| P2.10 | 通过 | 92698d1；主包 1,558,489（CI 环境，由当时 H5 stub 环境实测的 1,558,580 按 D-46 的 91 字节差换算；预算余 14,375）[本地测] |
| P2.9 | 通过 | ece6d12，OG 标题用话题标题 [本地测] |
| REGION.2 | 通过 | 44629b4 [本地测] |
| P2.13 | 通过（等 supervisor 审阅） | #369 描述按 8f5fc43 重写；CI run 44743800313 在 8f5fc43 上 5 个必需 job success；仍是草稿（L136）。P2.11 见上面单独一行 |
| BRAND.1 | 通过 | 草稿 PR #372，全量通过、projectname 玉米地 [本地测]；CI Build H5 等 E5 [CI run#43393646871] |
| BRAND.3 | 通过 | 徽章检索 10 → 0 [本地测] |
| BRAND.2 | 通过（⑦ 等 E5） | 品牌名检索 76 → 0，test 1991/1990/0/1 [本地测]；Build H5 等 E5 [CI run#43393646871] |
| BRAND.4 | 通过 | ① 出稿在 appendix/visual/logo/；D-34 代定 B 的单字「玉」；② #372 ba070e7 替换完成 [本地测] |
| BRAND.5、BRAND.6 | 未测 | BRAND.5 等 D-30（E7）；BRAND.6 等 D-36（延后到内测后） |
| BRAND.7 | 通过（DoD ④ 等 E12） | 原型 15aa47e 合进材料分支 779c07f：verify.js 在旧原型上红、当前 271 条通过；浏览器 120 / 2000 限长、88 组审计 0 问题、16 张截图已看。预览 dpl_3bG2SKTAmQsa7jEmScy2cHHpnk1y curl 200，生产 CSP 下 Chromium 渲染无报错；生产仍是旧版，回退 id dpl_E3AmucjjeUZfCmPQ7NQRi2eiaAv6（L91）[本地测] |
| HOME.1 | 通过 | ①–③ 以 design/ 为准（L08）；④ axe 4.14.0：12 个组合 color-contrast 0、<12px 0、溢出 0 [本地测]；⑤ D-35 已定 A |
| HOME.2 | 通过 | bd6fee5，19 条规则单测 [本地测] |
| HOME.3 | 通过 | #374 a756081原首页；29个HOME.3语言key由6d6c598补齐。885603e补英文「 · 」和守则/指南标签，四张手机/桌面浅深截图已看，字体12px；标签判别仍有第16条的数据约定问题。#380 fe80882c的CommunityHome.vue已渲染home.events、home.allEvents（第41、215、217行），不再等P4.8；桌面活动页与完整视觉矩阵见独立P4.8行[本地测] |
| HOME.5 | 通过 | #374 2e0f582 已含 #369 04edaa3、#375 571be45；CI 环境主包 1,373,060、余 199,804；五个 PR 本地集成 1,374,461、余 198,403（L90）[本地测] |
| P2.12 | 通过 | 草稿 PR #374（244a8e7）；12 张截图 <12px 0、axe 0；首屏 390 5 行、1280 9 行 [本地测] |
| HOME.4 | 通过 | #374 010f8f6；12 组 axe 0、<12px 0、溢出 0；截图 appendix/visual/HOME.4/ [本地测] |
| D-46 第 1、2 项 | 通过 | L64、L65 |
| D-46 第 3 项 a | 通过 | 3d24a8e已进入#374；所有小程序页启动监听。门禁页的新入站提示由22d9009抑制，已通过c1ef194合入#374；未改普通错误提示或停监听（L81、L82） |
| D-46 第 3 项 b | 通过 | ae058c2 的标题映射和 D-50 长度规则在当前 head 上都有：#369 8257318（树同 04edaa3）、#375 571be45、#374 6bdca97（L77、L81、L90） |
| D-46 第 3 项 c、d、e | 通过，D-47补完完成 | 73206a0、eca5a8d、6d6c598为原修复；e由885603e补完，c由c7b0634改为仅小程序限流并取消过期队列。d补测为2942e8e（L80、L82、L83） |
| D-46 第 3 项 f | 全局放行已撤回 | 有效 L2–L5 → suspended 在当前 head 上都有：#369 8257318（树同 04edaa3）、#375 571be45、#374 6bdca97。发帖前拦截和回复提示保留；不 revert 30c4b4d；受限时回帖不再显示重试（D-51 3a，6bdca97）。受限浏览要等 D-49 的新迁移证明服务端拦截后在独立 PR 里做（L76、L81、L82、L98） |
| D-46 第 4 项 | 通过 | 当前 head：#375 571be45 主包 1,324,735、余 248,129；#374 6bdca97 主包 1,373,060、余 199,804；五个 PR 本地集成 412e14d 主包 1,374,461、余 198,403（L90、L98）。最终六条测试在 3d24a8e 上 6/4/2/0，真实 history→detail 导入变异 6/5/1/0（L84） |
| D-46 第 5 项 | 通过 | 本地 412e14d（#374 2e0f582 + #373 + #372，不推送）：test 2248/2247/0/1、pg_skips=0，smoke 12 份 204 passed，typecheck/h5/mpci/migrations rc=0，npm audit 只剩 vite moderate；五 PR 主包 1,374,461、余 198,403（L90）[本地测] |
| D-46 第 6 项 | 通过（DoD ④ 等 Eric promote） | 见 BRAND.7 行（L91） |
| D-49（D-51 第 5 项、D-52 第 1、2 项） | 通过（等 Eric 先应用迁移） | #377 草稿 dd44f98，base #374 的分支：merge 6bdca97 后修 16 条单测与 9 条 smoke；createPost、createComment 在 composable 层拦截（e058c98 上 L2–L5 红，a91cb74 绿）；a91cb74 全量 2655 / 2654 / 0 / 1、smoke 43（含提示条 spec）、主包 1,380,046；迁移 sha256 0dc2ceaf… 冻结未动（L106、L117、L118、L119） |
| D-52 第 3 项 | 通过 | #376 草稿 0e04aca：失败时不放行、只认 vite 上不高于 moderate 的 GHSA-8g5g-mxqh-grgj；11 个用例符合预期；现有测试 1989 / 1988 / 0 / 1（L116） |
| D-52 第 4 项 | 通过 | a、a2、b、c、d、e、f、g（L111–L115、L119、L120） |
| D-53 第 0、1 项 | 通过 | Eric 的选择与 supervisor 代做照抄进阻塞第 2、18、20、25 条；第六批收尾更正（L122） |
| D-53 第 2 项 | 通过 | #376 草稿 f0ccd8f：exit 0 也读报告、via 解不开的条目失败；21 个用例符合预期；现有测试 1989 / 1988 / 0 / 1；CI run 44715711828 全绿（L124） |
| D-53 第 3 项 | 通过 | #378 草稿 80b3eb0：vite 6.4.6 新配方，两次干净构建逐字节一致；门禁全过、audit 0；主包与 H5 大小同 55716ba（L125） |
| D-51 第 2 项 | 通过（i 按规则留下 5 个 worktree） | L94、L96、L97、L99 |
| D-51 第 3 项 a | 通过 | #374 6bdca97（L98） |
| D-51 第 3 项 b | 通过 | #372 d6f393d；本地集成改前红、改后绿（L101） |
| D-51 第 4 项 | 通过 | #376 草稿 92ff5d5，CI 全绿，审计步骤按依赖门 skipped（L100、L104） |
| D-51 第 6 项 | 通过 | #369 8257318 CI 全绿，E4 staging 那一半完成（L102） |
| D-56 第 1 项 | 通过 | #382 草稿 19c4657（base main，从 66e14a45 起）：修在 useVisualViewportInset.ts（根元素 ResizeObserver 补一次 sync），原用例第 713 行之前没改；修前 ×60 复现 7 次失败（check-20261121T113134Z），新用例先红后绿（T115316Z 5/5 红、T115651Z 5/5 绿），修后三组 ×60 共 180 次 0 失败；全量门禁 check-20261121T125522Z 判通过（另有 4 条 main 上同样失败，见 L173），Running 564；CI 44909710527 success；主包 1,381,447（L212–L215）[本地测][CI] |
| D-56 第 3 项 b–d | 通过 | #379 fdb823a：61e265d（3b）、f697460（3c）、fdb823a（3d），迁移与 manifest 没动；门禁 check-20261121T120007Z 判通过（另有 4 条 main 上同样失败，见 L173），Running 612；主包 1,422,723（L208、L210、L211）[本地测] |
| D-56 第 3 项 a、f–j | 通过 | #380 02d4d4c：53b2f8e 普通 merge P3 fdb823a；e5a39e2（3f 新增只读 VERIFY_reply_notice_switch.sql 与不连库的相等测试，3g RUNBOOK 开关第 1 步、正对照与四个负对照）、12c2b41（3h）、fd5baa7（3i，同句进 #380 描述）、02d4d4c（3j）；迁移与 manifest 没动；L-SQL 184/184、P3_TOTAL 703/703、EV_TOTAL 855/855；门禁 check-20261121T135041Z 判通过（另有 6 条：4 条 main 上同样失败，2 条同一类，见 L173），Running 647；主包 1,459,574（L216）[本地测] |
| D-47 第 1 项 | 通过 | 见L72；后续状态按各次写回继续更新 |
| D-47 第 2 项 | 通过 | 885603e：2190/2189/0/1，132条浏览器通过，四张标签截图已看；类型字段歧义见第16条（L80） |
| D-47 第 3 项 | 通过 | c7b0634：旧代码8条中3红；新版8条全过，三类真实源码变异均被抓到；2234/2233/0/1、132条浏览器通过（L82） |
| D-47 第 4 项 | 通过 | 2942e8e：在86ffd0e上9条中7红、2个对照通过，当前9/9；仅移除失败分支invalidatePosts的变异为1红1对照通过。完整单测2237/2236/0/1；没有应用源码变动，构建沿用L82（L83） |
| D-47 第 5 项 | 通过，含冷启动补充 | 73cde94：空栈或取栈抛错不弹入站提示，页面恢复后正常；监听/计数/普通错误不变。旧实现43/39/4/0，修正后43/43；全量2208/2207/0/1。夹具修正单独8df14c5，#374合并adc6ee7后108/108及typecheck/mpci通过。依据属[OMO自决]，见L86、L88 |
| D-47 第 7 项 | 通过 | #369、#374、#375、#370 的描述按各自最终 head 重写，包名加反引号，四个仍是草稿；D-49 没开 PR（L92） |
| P3.1–P3.8 | 部分（P3.7 未做，归 Eric；P3.6 DoD ② 部分；client:P3-m8、m16、m17 部分，D-56 第 4 项 c） | #379 4e7bd21（D-58已推，L334–L335、L340、L342–L343），已含main 9171976e；20261120100354冻结c2a18ee8…未改（L179）；L-SQL183/183、P3_TOTAL703/703、开关默认关，列级授权负对照及恢复通过；TEST2800/2799/0/1、pg_skips0；smoke616/611/4/1，四条main上同样失败见L173；699最终60/60；主包1,422,771、余150,093。last_activity_at、answered_at两条列注释与现行为不符，已冻结不改，仍等后续涉及这两列的迁移处理（mig:P3-B9-3，D-56第3e项） |
| P4.7 第一步 | 通过 | appendix/research/campus-events.md；D-33 已按 D-43 代定 A，第二步依赖 P4.1、P4.2 |
| P4.1 | 通过 | 本地 wip/P4.1 5f62ddd，容器 test 2015/2014/0/1 [本地测]；不推送；已 merge 进 #380（de2d281） |
| P4.3 | 部分 | caaciorg 本地 28d59b1，Node 20/24 全部通过 [本地测]；推送等 E8，开 PR 由 Eric 做 |
| P4.2、P4.9 | 部分（P4.11 未做，归 Eric；P4.2 DoD ④ 成员写入通道由 20261122035253 打开，等应用；P4.9 的另一半等 E6，D-56 第 4 项 c） | 当前#380 fe80882，继承已实现的活动列表/详情及后台动作；第十二批列表并发和胶囊修复已通过，D59第5项已本地完成cdb4d13、待本批唯一推送。20261120122054仍冻结a8c0e083…，新成员迁移重冻b93ea1ed…1bdd但托管应用未由OMO执行。最新L-SQL185/185、P3_TOTAL703、EV_TOTAL855、MEV_TOTAL38；TEST2981/2980/0/1、smoke729/720/8/1按例外通过；主包1,468,020。证据L358–L365；旧实现/冻结记录保留L193、L216。状态列所列部分项及E6依赖保持 |
| P4.8 | 部分 | #380已含列表、详情及首页近期活动；剩D-59第4项桌面页头/布局和第7项36图验收，真实后端public smoke仍待Eric在应用四条迁移后执行，不能用本地夹具替代 |
| P4.4、P4.5、P4.7、P4.11 | 未测 | P4.5 真实数据等 D-32；P4.4 的同步新鲜度等功能尚未做；其余真人验收照原依赖 |
| P4.10 | 本批不写代码，等Eric | 前提①要等P4.11应用A、P4.3上线并开CAACI同步，或D-60完成P4.7写入，使生产有可见CAACI/学校活动；与P4.11的发布依赖成环，拆分建议见阻塞36，不把建议记成已批准 |
| P4.6 | 部分，DoD⑥等Eric | D-58第3a–g、第5项及独立第4项已交付fe80882；新迁移SHA256=b93ea1edce3ecc2f2a2d4a59fb5b9ed3bbb129f52ed65211ad02cd02e8781bdd，材料先冻结后代码唯一推送。TEST2981/2980/0/1、pg_skips0；smoke729/720/8/1按D56例外通过；185链、703/855/38例、59对照和60轮通过，终审APPROVE/HIGH。主包1468020、余104844；详见L352–L365。真机/开发者工具、wechat-seccheck和staging S-1归Eric，前提仍为三条迁移、开关及已验证校园邮箱的合成账号 |
| LEGAL.1–LEGAL.6 | 未测 | 等 D-37、D-38、D-39、D-40、D-28 |
| CONTENT.1–CONTENT.6、P5.1–P8.1 | 未测 | 依赖 LEGAL 与 P5.2 |

## 阻塞与等待 Eric

1. 合并与上线顺序（D-53 第 0 项 g、D-54 第 0 项；托管库的事属于 STOP-2/3，OMO 不执行）：已由 supervisor 做完——#376（b4d615b）、#371（057d07d，含 #373、#378）、#369（ad986c9）、#375（e9c2604）、#374（4900722）、#377（05e0959）都已 squash 进 main；20261112120000 已在生产 15:04Z 应用并 VERIFY；20261114015420 已在 staging 15:14Z、生产 16:02Z 应用并 VERIFY（两边账本语句 md5 都是 48b65118…）。#372 已于 2026-11-20 17:24Z squash 进 3778952，C-final 已在 3778952 上通过（L152–L153），3778952 已于 2026-11-21 01:16Z 按 docs/SUPERVISED_RELEASE.md 发布到生产 H5（D-55 第 0 项，D-55 第 4 项 b 更正）。邮件印章分支 #381 已于 2026-11-21 09:08Z 由 supervisor squash 进 main 66e14a45，两个认证邮件模板已在生产后台重贴，66e14a45 已于 09:36:58Z 按 docs/SUPERVISED_RELEASE.md 发布到生产 H5（D-56 第 0 项，D-56 第 4 项 b 更正）。合进 main 不会上生产：vercel.json 关了自动部署，H5 生产只走 docs/SUPERVISED_RELEASE.md 的受监督发布（D-53 第 10 项 a）。P3、P4 的两个迁移由 Eric 在 staging、生产应用（P3.7、P4.11），不在这一轮上线范围；P3 迁移应用后通知开关保持关闭，P3 的 H5 和小程序都发布后，由 Eric 打开（D-54 第 2 项 c）。
2. D-29 → E2、E3：已完成（D-53 第 0 项 b、c，supervisor 代做）。D-29 定为 A：supervisor 2026-11-20 约 03:20 与 03:45 CT 只读核对 staging-smoke，auth.users 5 个 example.invalid 合成号加 1 个冒烟号、profiles 9 行、items 2 行、posts 0 行、messages 2 行都归合成号或冒烟号；E3 的 syn-a、syn-b、syn-c 已注册确认并能登录，~/.config/illini/staging.env 已写好（600）。OMO 不在 #369 代 Eric 留言；staging.env 不 cat、不打印。P1.11、P1.12、P2.6、P2.11 由第七批第 5 项跑。
3. E4：staging 那一半已完成——supervisor 按 Eric 2026-11-19 批准把 20261112120000 应用到 staging-smoke 并 VERIFY 通过（D-51 第 6 项），#369 的 public sweep 已过（L102）。P2.6 已通过（D-53 第 5 项，L126）；P2.13 已通过（L136）。
4. 【已完成：#373 已合进 #371 的分支 7c94a11，随 #371 squash 进 main 057d07d；D-55 第 4 项 b】原记录：P1.6 跨大版本已按 D-44 做成草稿 PR #373（base #371）：合不合由 Eric 定；合之前请在带 SENTRY_AUTH_TOKEN 的发布构建里确认 source map 上传。#373 不触发 CI（ci.yml 只认 base=main）。vite 6.4.4 那条 moderate 的 CI 例外已由 #376 提供（只放行 vite 包上的 GHSA-8g5g-mxqh-grgj、严重程度不高于 moderate、到 2026-12-13，见第 20 条）；#376、#371、#373 都合并后 main 上的 Boundary 才会绿。
5. E5：已完成。supervisor 2026-11-20 把 #371 squash 合进 main（mergeCommit 057d07d，主会话核过是 origin/main 的祖先；CI run 44737046939 全绿）。P1.8 已开工：#369 上先 revert c52badf，再 merge origin/main（ci.yml 与 main 一致，三处 ubuntu-24.04 由 #376 在 main 上提供），然后依次合进 #375、#374、#377；P3、P4 等它们的子任务收尾后再合。
6. D-35 已定（A 纸本书院），HOME.4、P2.12、BRAND.7 只剩各自的任务依赖；D-34 已按 D-43 代定（B 的单字「玉」），BRAND.4 ② 由 OMO 做。
7. D-30（E7，微信后台核对）挡住 BRAND.5、P5.2；D-31 已定（A），E8（fork 与令牌权限）还没做，P4.3 只在本地写。D-40 已定（A，请律师审 LEGAL.2、LEGAL.4），LEGAL 组仍等 D-37。
8. D-37（董事会同意）挡住 LEGAL.1–LEGAL.3；D-28（轮值伙伴）挡住 LEGAL.6 与 P5；D-36 已按 D-43 代定 D（延后），BRAND.6 等内测之后，P5.1 前 Eric 要重新答复。
9. E6（官方账号 profile id）在 P3.5 与 P4.9 前需要；D-32、D-33、D-38、D-39、D-40 的截止任务见 [DECISIONS.md](DECISIONS.md)。
10. BRAND（#372）生产发布后：Eric 在 STATUS_LOG 记发布日；「原 Illini Market」（app.formerly，登录页与 /about）在发布日 + 90 天移除；同时做 E10（邮件模板、生产 DIGEST_FROM）。
11. #372 要手工合：与 #369 冲突在 api/share-post.js、en.ts、zh.ts（#374 另有 app.name / app.desc / app.tagline / app.formerly 一块）；保留 #369 的 P2.9 topicTitle / headline 逻辑与 P2.2「回复 / reply」措辞；api/share-post.js 兜底的标题和描述都取 #372（无帖时标题「玉米地 · 社区」，没有正文时描述「A post on Cornfield」，无帖时描述取 #372 的双语一句），412e14d 就是这样合的。#374 与 #372 还在 app/src/pages/plaza/index.vue 冲突：c16f0a1 删了「关注的人」名单，#372 的 BRAND.3 徽章改的正是那段；保留 #374 的删除，这块的徽章改动丢弃（名单在 pages/following，那一页照 #372）。合 #372 时 app/src/components/CommunityHome.vue 两处 u-thumb-ph-seal 占位（第 108、123 行）的「集」改成「玉」，#372 d6f393d 的测试会拦住漏改（L101）。顺序上 #372 在 #374 之后任何时候合（第 1 条）。

   #369 → #374 冲突图（D-48.3，实合 ae058c2）：

   | 文件 | 合并规则 |
   |---|---|
   | app/src/pages/plaza/index.vue | 保留 #374 的 following 帖子流、invalidatePosts 与 openComposer(board?)；加入 replyRestricted；六个 compose/click 入口共用发帖前限制检查 |
   | app/src/pages/post/index.vue | 同时保留 authorBlocked、replyFailed 的布局/重试状态与 replyRestricted 提示及写入前拦截，三处逐块合并 |
   | app/smoke/community-board-deeplink.test.mjs | 保留社区路由测试工具，另补 isSuspensionActive，避免重复导入 |
   | app/smoke/community-post-topics.spec.ts | 保留 view=all 和 New topic/发话题；加入 L2–L5 门禁与 options.open；正常账号夹具同时提供话题与旧式动态，保留两种回复入口验证 |
   | app/src/composables/i18n/messages/en.ts、zh.ts | 自动合并会各留两份 plaza.restrictedReply，手工去重为每语言一份；未改变值 |

12. 改 base 与删分支（D-54 第 3 项）：#379（P3）、#380（P4）的 base 先不动，直到 P3 迁移已在 staging 应用并 VERIFY（P3.7 DoD ①）；然后把 P3 的 base 改到 main 跑 CI（P3.7 DoD ②）。P3 改 base 之前 supervisor 不删 codex/community-restricted-20261113；P4 改 base 之前不删 P3 的分支。改 base 到 main 时：只有 `git rev-parse S^{tree}` 等于 `git rev-parse H^{tree}`、并且 H 已是 P3 的祖先，才 `git merge -s ours S` 记下这次 squash；树不相等就普通 `git merge origin/main`，迁移或 manifest 冲突照 BACKLOG §14 第 14 行。#377 的 H = 9be6a56、S = 05e0959（树相同，L146）。删 base 分支会关闭依赖它的 PR 且不能重开。
13. 首页、新页头、板块页、全部讨论已编进小程序。#374 6bdca97（含 #369 04edaa3、#375 571be45）CI 环境主包 1,373,060、余 199,804；五个 PR 本地集成（再加 #373、#372）1,374,461、余 198,403（L90），满足 64 KiB 目标。微信开发者工具/真机仍须验证渲染、胶囊、路由、操作菜单标题、空栈提示抑制、首次分包下载/离线失败与返回栈。没有preloadRule，login/search/notifications/settings/legal等首次进入要下载；本批不加预加载规则。首页6+inbox 2+notifications 2=10，onShow资料读取可到11；D-47.3只限首页。按supervisor核查，基础库3.8.10起超并发请求才排队，更老版本可能直接失败；manifest未设最低基础库，需Eric实测并定最低版本。小程序构建须有VITE_BASE_URL。showModal加权规则只核验3.15.0–3.15.2；showActionSheet只检查itemList不超过6项，title/alertText和条目文字不限长，更早版本未核。

14. 【已完成：#377 已由 supervisor squash 进 main 05e0959，20261114015420 已在 staging、生产应用并 VERIFY；D-55 第 4 项 b】原记录：D-49（#377，草稿，head dd44f98，base 是 #374 的分支 codex/community-home-20261112，D-52 第 1 项）：#377 最后合。前提是 staging 和生产上都已应用并 VERIFY 了 20261112120000，再在两边依次跑 PRECHECK_20261114015420 → 应用迁移 → VERIFY（都返回空、不报错）；生产上没有前一条时 D-49 的 PRECHECK 会报 restricted_account_writes_column_missing。尽量在低流量时段应用（会在 10 张表上短暂加锁，含 storage.objects 上的 ACCESS EXCLUSIVE），因 lock_timeout 或死锁中止会整体回滚，重跑即可（仓库 RUNBOOK，dd44f98）。没有 ROLLBACK 文件，删两条新的 storage.objects 策略要用 Dashboard。删 #374 的分支之前先把 #377 的 base 改成 main（第 12 条）；#377 改成 main 之前没有 CI。12 条待定政策问题见 #377 描述与 FINAL 第五批 D-49 一节。

15. D-50撤销生产按钮超长误报；本次再补MP/VUE3条件与pages内非注册组件的扫描盲区，英文注释明确非Latin-1的每个UTF-16单元计2（单个非BMP emoji计4）。showActionSheet只查itemList≤6、文字不限长（已核基础库3.15.0–3.15.2）。所有正式FINAL④/⑥的新增内容在本轮收尾同提交真正写入；内部草稿不算正式报告。D-46到D-50完成或按规定停下后结束目标、取消续跑，不续接BACKLOG。

16. D-47.2：SPEC只给了“守则/指南”标签和社区守则名称，未定义帖子类型字段。当前按官方精选帖标题中的“社区守则/Community guidelines”识别守则，其他显示指南；这不是稳定元数据规则，标题改名/其他守则文档如何分类仍需明确。近期活动home.events、home.allEvents已在#380的CommunityHome.vue渲染；这部分不再等待P4.8，标签元数据约定仍待定。

17. 用号按D-59第0项：ChatGPT login-3不设上限，用到OMO自动95%跳号；Claude各号7d上限85%，顺序default → account-2 → account-5 → account-4，account-3已过期最后；ChatGPT default、login-2已过期。reset由Eric做，supervisor看用量并发停下通知；OMO不查用量、不切号、不切模型、不改~/.omo，收到停下通知才按D-51第1项收尾。

18. BRAND.7（E12）：已完成（D-53 第 0 项 d，supervisor 代做）。supervisor 2026-11-20 约 03:22 CT promote 预览 dpl_3bG2SKTAmQsa7jEmScy2cHHpnk1y，新生产部署 dpl_7p18WL7JTqxbK8VKqNVVnYepLj1b，`curl … | grep -c 玉米地` 为 6；回退用 dpl_E3AmucjjeUZfCmPQ7NQRi2eiaAv6。BRAND.7 的 DoD ④ 完成。「转发 · CSSA」的虚构活动按 Eric 2026-11-19 的选择保留。D-37（董事会同意）仍未拿到，LEGAL.1 照旧开着，这是 Eric 的取舍。
19. 给运维的提醒（D-52 第 4 项 g，更正 L105 的说法）：本地镜像 supabase/postgres 17.6.1.104（和生产的数据库版本一样）上，用 postgres 或 supabase_admin 登录，再 `SET ROLE` 到 anon、authenticated 或 service_role 去调用没有 EXECUTE 权限的函数，后端会 SIGSEGV、整库重启；以 authenticator 登录（也就是走 PostgREST）是正常的 42501。所以 App 用户大概率触发不了，运维会话会。托管库上的 supautils 和 PostgREST 版本可能和本地不同，这一点没核；OMO 没碰任何托管库。可选的镜像版本 17.6.1.167：核查方在这个版本上没复现崩溃。
20. #376 已在 2026-11-20 12:35Z squash 进 main（b4d615b）；Eric 选的 B 路线由 #378（vite 6.4.6）完成，已随 #373、#371 进 main（057d07d）；main 上 run 44739894523（057d07d，run_attempt 2）七个 job 全过（D-54 第 1 项 d）。#371 合并后三个浏览器 job 要不要回到 ubuntu-latest（P1.5 DoD ③）仍由 Eric 定。
21. staging 上 posts_visible 的写权限是 041 建视图时的默认权限，没收回（security_invoker，不算提权）；要不要收回由 Eric 定。
22. staging 另缺 3 条和 20261112120000 无关的旧迁移：20260811140018、20260811143207、20261003175231，这次不补。
23. 5 个留下的证明 worktree 要删得用 --force（RUNBOOK §3 不许 OMO 做）；改动和未跟踪文件已存进 ~/work/evidence/D51/worktrees/（L97）。
24. 仓库 2026-11-20 07:15Z 起公开（D-52 第 4 项 a2）：材料分支、DECISIONS（含 D-51 里的账号邮箱缩写）和几个 PR 描述里已经有账号邮箱和工作站路径，现在任何人都能看到。OMO 不改写历史去删它们，要不要处理由 Eric 定。本批起不再往仓库加原始日志、带真实数据的截图、账号邮箱、凭据和 /home 开头的绝对路径。
25. D-53 第 0 项（照抄）：a【Eric 选】生产上线走「先验收再上线」：合 #369 之前，P1.11、P1.12、P2.6、P2.11 要在 staging 上通过，P2.13 也要完成。b、c【supervisor 做】E2（D-29 定 A）、E3 已完成，见第 2 条。d【Eric 选】品牌和 demo 现在就上；E12 由 supervisor 做完，见第 18 条；#372 由 supervisor 按上线顺序手工合。e【Eric 选】vite 走 B 路线，见第 20 条。f【Eric 选】D-49 的 12 条政策问题全部按「不新增权限」定：行为类维持现在的服务端行为，措辞类沿用现有文字，代码不改。g【supervisor 做或将做，只授权 supervisor，不授权 OMO】合并：vite PR → #373 的分支 → #371 的分支 → main（E5）；验收通过后：生产应用 20261112120000 并 VERIFY，依次合 #369 → #375 → #374，staging、生产先后对 20261114015420 做 PRECHECK、应用、VERIFY 后合 #377，再手工合 #372，每步之后看生产。P3、P4 的迁移不在本批上线范围。RUNBOOK §11 的 E2、E3、E5、E12 已由 supervisor 在 362087f 按此标状态。
26. D-53 第 9 项（照抄，【supervisor 做】）：#371 在 7c94a11 上的 CI（run 44731585297）只有 Build H5 失败，ubuntu-26.04 上 WebKit 起不来；所以先把 #376 squash 合进 main（b4d615b，12:35Z），再把 main 合进 #371 的分支（6d481d0）。#376 进 main、#371 还没进的这段时间，main 的依赖审计会因 intlify、follow-redirects、glob、minimatch、qs 的 6 条公告变红，属预期，#371 合进去就好。supervisor 已独立核过：#378 在容器里用自己下载的输入重建两次，与提交的归档逐字节相同；#376 的审计步骤过了 55 种输入和真实 registry 的测试。P1.8 仍按 D-53 第 7 项 a 看 #371 的 mergeCommit。

27. D-53 第 8 项 g：P1.11、P1.12 第 4 次都在固定 7b18f20 上通过，仅证明 main 基线与探针本身；合 #369 和合 #377 之前，supervisor 仍要另派同一份探针（sha256 不变）在要合的 head 上各做确认跑，不计入这次 5 次预算。OMO 本轮不推进 main worktree、不改应用代码、不合任何 PR；第七批④、⑥按此保留候选 head 确认跑。
28. 上线进度（【supervisor 做】，L141、L146、D-54 第 0 项）：supervisor 独立核过第七批的 vite（#378）、#376、P1.11/P1.12 第 4 次、C-369、P1.8 级联；P3、P4 的核查发现在本机清单里（不进仓库，只引编号），按 D-54 第 2 项修。生产 15:04Z 应用 20261112120000 并 VERIFY；#369、#375、#374 依次 squash 进 main（ad986c9、e9c2604、4900722）；staging 15:14Z、生产 16:02Z 应用 20261114015420 并 VERIFY；#377 加 -s ours 合并 9be6a56 后 squash 进 main 05e0959。#375 在 15:08:01Z 改 base 之后于 15:08:27Z 被关闭、15:08:29Z 重开（L141 漏记，D-54 第 1 项 e）。#372 由 OMO 手工合 main 05e0959（f5dd044，CI 44778423032 全绿）后由 supervisor squash 进 main 3778952；C-final 在 3778952 上 cfinal-1 通过（P1.11 3 passed、P1.12 1 passed，A/B/C 都未受限，L152–L153）。 D-55 第 0 项补：2026-11-20 17:24Z #372 squash 进 main（3778952），C-final 在 3778952 上通过，main 上 run 44783052160 七个 job 全过；2026-11-21 01:16Z supervisor 按 docs/SUPERVISED_RELEASE.md 把 3778952 发布到生产 H5（候选部署就绪、release readiness 通过后，Vercel 自己把两个生产域名指过去，supervisor 没有调 promote；www 与候选的 deployment-identity 都核到 3778952）；同一晚 supervisor 在 Supabase 生产后台把 Confirm signup、Reset password 两个认证邮件模板换成 3778952 的文件内容（正文 sha256 与 git 一致），SMTP 发件人名改成「玉米地 Cornfield」，发信地址和密钥没动。#374（15:32:29Z 改 base、15:32:31Z 关闭、15:32:33Z 重开）、#377（16:03:34Z、16:03:36Z、16:03:38Z）改 base 之后也各被关闭、重开过一次。账本：supervisor 2026-11-21 03:36Z 只读核过，生产 146 行、staging 199 行，都没有 20261120100354、20261120122054。 第八批验收（D-55 第 0 项，D-56 第 4 项 b 补）：supervisor 六个维度独立核查，没有阻断项；复现了 P4 4c1c666、P3 042427c 的全量、smoke、主包和 P3 的 L-SQL，四个迁移的 sha256 与 manifest 一致；C-final 在 3778952 上通过（L152–L153）。D-56 第 0 项：
     - 第九批验收：supervisor 做了七个维度的独立核查（P3 迁移、P4 迁移、P3 客户端、P4 客户端、门禁、报告、L178 那段文字），每条 blocker、major 配一个反驳方，最后由一个覆盖审阅逐条核 30 条发现。没有阻断项。在 tony-ws 自己的目录里复现了：P4 24ff7bf 全量 TEST 2898/2897/0/1、pg_skips 0，smoke 647 条 640 passed、6 failed、1 skipped（失败的 6 条是首页、广场、活动页的浅色深色巡检，控制台错误与 OMO 的日志逐类同数；marketplace-responsive.spec.ts:699 那次碰巧通过），主包 1,459,446（packageBytes 与 OMO 的逐字节相同）；P3 7ccb195 TEST 2799/2798/0/1、主包 1,422,595；L-SQL 184/184、P3_TOTAL 703/703、EV_TOTAL 855/855、P3_SWITCH default=off；四个迁移的 sha256 与 manifest 一致；.github 和 vercel.json 与 main 相同；没有越过【硬】条。30 条里 25 条已修；gates:B8-1–3 的不修理由接受；report:B8-6、B8-2 只做了一半（本条第 4 项 a、b）。
     - 第九批核查确认的新发现在 tony-ws 的 `~/omo-ctl/review-b9-findings.md`（只在本机，权限 600，只引编号）。标「改进前必修」的必须修；「潜在」的按本条写明的做法；「小」的修，或在 STATUS_LOG 写明不修的理由。
     - 上线进度【supervisor 做】（UTC）：2026-11-21 09:08 把 #381 squash 进 main（66e14a45，树与 c1cacb6 相同）；随后在 Supabase 生产后台重贴 Confirm signup、Reset password 两个模板（改前核过与 3778952 的文件相同，改后与 66e14a45 的文件相同，标题和 SMTP 没动）；main 上 run 44888125550 七个 job 全过后，按 docs/SUPERVISED_RELEASE.md 发布：create_deployment 一次得到 dpl_DQwi8ZByxr7eroQRw94h4UuVNAwe，09:36:58 就绪，Vercel 自己把两个生产域名指了过去，没有调 promote；www 和候选的 deployment-identity 用新 nonce 核到 66e14a45；发布后一小时生产日志没有 error、warning，background-jobs 每分钟 check-in ok。回滚目标是 dpl_AqYX8W（3778952）。
     - L178 那段文字查清了：不是注入。三段「主会话」文字都是主会话真发的 task_send（sha256 与主会话记录里的调用参数逐条相同）；OMO 的宿主把 steer 接在工具输出后面、中间没有分隔，子任务分不出来。「换账号邮箱」那段是 06:15:09Z 号池换号之后 Claude Code 自己插入的 session context 提示，只说明当前用户邮箱，没有要求换任何东西；换号在前，提示在后。仓库没有外部 issue、评论或 PR。真正的缺陷是消息通道分不清（process:B9-1）：第八批 st_01a1f9cc 就因此没照真 steer 做，抢在 C-final 前面跑了容器。按第 2 项改。
     - D-55 第 5 项「控制台错误只有一句」是 supervisor 写错了，main 自己的失败也是三句一组。L177 按三句判、L192 把 marketplace-responsive.spec.ts:699 记成「main 上同样失败」，supervisor 复现过（main 3778952 30 次失败 4 次，P4 30 次失败 6 次，报错都是期望 830、实得 480），两处判法都予以追认。第十批起按第 5 项的新写法判。
29. E6：COMMUNITY_OFFICIAL_PROFILE_ID 没设之前，P3.5 的 set_post_official 和 P4.9 的 create_event_discussion 返回 409 official_profile_not_configured、不落库；set_post_featured、hide_event、unhide_event 不依赖它（D-54 第 1 项 b 更正）。设好后补这两项的另一半。
30. P4.6 的产品问题：被隐藏或下架的成员活动仍占组织者两个名额之一，作者自己删掉讨论帖的不占，要不要改由 Eric 定（L140）。D-57 按现行规则实现，supervisor 代定，待 Eric 确认。
31. D-59第1项已启动main派生的本地巡检夹具分支。含该夹具的head，D-56第5项四条件豁免和D-57第11项pages.smoke条款不再适用，巡检必须0失败。P3/P4以后普通merge main后，再单独提交把新增读表/RPC加入显式名单并注明原因；P4至少含list_community_events→[]、community_member_events_open→false、community_event_sync_state表读，不能夹在合并提交。本批P3不动、P4不合main，P4仍按D56四条件逐条判；699/767必须0失败，699另60轮。
32. #380合并之前（D-59.9b/10）：public smoke须在依次应用20261120100354、20261120122054、20261122035253和本批前向迁移A并VERIFY的库上跑绿；A已本地实现为20261123201501，尚未冻结；临时hash见L415，最终hash必须待全量与L-SQL通过后登记。verify-deployed-rpcs与verify-public-read-schema已要求community_member_events_open；真实后端巡检归发布步骤，本地路由夹具不能代替。
33. 成员活动开关须在staging、生产分别打开，归Eric或他点名批准的人；前提包括D-28举报值班已经有人，以及RUNBOOK「Member events switch」列出的四个条件。当前默认关闭。 成员活动开关打开之前，要不要先做可见文本边界，归 Eric 定（本地第8项六类输入均存入、三正向对照通过、回滚残留0，见L402–L403；线上未测）。
34. 已覆盖：cca63d95的wide messages用例在1280双栏下先红后绿，已随#383进main d3bfc17e（D-59.9b）。iPad真机检查仍归Eric。
35. CI public sweep的job限45分钟；用例增长可能超时。第十三批④将按P4最终Running N重算推算表，现尚未进入最终门禁；第十二批原表不改，ci.yml本批不改，选哪种处置由Eric定（D-59.9f）。
36. P4.10 DoD⑤要求随P4.11发布，P4.11又依赖P4.10，形成环。建议由Eric拆成P4.11a（迁移与#380，沿用第一步导航）和P4.11b（P4.10与小程序，等生产CAACI/学校来源可见的前提①成立）。CAACI路径须先应用A、上线P4.3并开同步；学校路径等D-60完成P4.7写入。本批不写P4.10代码、不修改BACKLOG依赖，不代替Eric批准拆分（D-59.9e）。
