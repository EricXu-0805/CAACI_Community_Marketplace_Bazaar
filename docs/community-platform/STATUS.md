# STATUS

写于 2026-11-21 05:32 CT · 作者：OMO（tony-ws）。OMO 每完成一个任务改写本文件，并在 [STATUS_LOG.md](STATUS_LOG.md) 末尾追加一条。证据标签定义见 [README.md](README.md#证据标签)。

`next_task_id: D-56 第 1 项（视口，子任务）、第 3 项 b–d（P3，子任务）、第 3 项 f–j（P4，等 P3 结果后派子任务）、第 0、4 项（主会话）`
`latest_batch: appendix/batch/FINAL.md`

D-56 第十批进行中（L203 起）：范围是 D-56 第 0–5 项；做完写 FINAL「第十批（D-56）」与本文件同一提交，推送之后再结束目标、取消续跑提醒。第九批已交付（L165–L202）。

## 版本

| 项 | 值 |
|---|---|
| 代码分支 / PR | #369、#375、#374、#377、#372 已由 supervisor 依次 squash 进 main（ad986c9、e9c2604、4900722、05e0959、3778952、66e14a45（#381）；D-54 第 0 项、L151，D-56 第 0 项） [本地测：2026-11-21 gh pr view] |
| code_sha | 66e14a4502a10fe8ec01f5539114f2b2db37a880（main 当前 HEAD，#381 的 squash，树与 c1cacb6 相同；2026-11-21 09:36:58Z 已由 supervisor 发布到生产 H5，D-56 第 0 项） |
| 基线 main | 7b18f2052e52a4268c25407d0584748477cbf978（2026-11-13 git ls-remote） |
| 材料分支 / PR | codex/community-plan-v5 / #370（草稿，OPEN，不合并）[本地测：2026-11-13 git ls-remote] |
| docs_sha | 88ef4ba（本次写回之前材料分支的 HEAD） |
| 其余代码分支（远端 head） | #379 codex/community-p3-20261120 fdb823a（base codex/community-restricted-20261113）；#380 codex/community-events-20261120 24ff7bf（base P3 的分支）；两个都是草稿。已合进 main：#369、#371、#372、#374、#375、#376、#377、#381（66e14a45）；#373、#378 已合进各自 base 分支 [本地测：2026-11-21 gh pr view、git ls-remote] |
| tony-ws worktree | illini 8f5fc43（#369，已合）；illini-home 75a3447（#374）；illini-mpbudget dfa1aa0（#375，远端已是 supervisor 的 700c7be）；illini-restricted 9a31e75（#377）；illini-p3 7ccb195（#379）；illini-events-20261120 24ff7bf（#380）；illini-ci-runner f0ccd8f（#376，已合）；illini-vite645 80b3eb0（#378，已合）；illini-brand f5dd044（#372，已合进 main 3778952）；illini-config b259105（#371，已合）；illini-deps 55716ba（#373，已合）；confirm-369-8f5fc43 detached 8f5fc43（C-369）。本地不推送：illini-events wip/P4.1 5f62ddd（已 merge 进 #380）、illini-d46-integration、illini-d51-seal、illini-docs-brand7；illini-main 只读 7b18f20；caaciorg 本地 28d59b1；5 个第四批证明 worktree 留着（阻塞第 23 条）；confirm-final-3778952 3778952（detached，C-final 与 D-55 main 对照，只跑不提交）；illini-seal c1cacb6（#381） [本地测：2026-11-21 git worktree list] |
| 公开 demo | https://illini-community-demo.vercel.app/ 已由 supervisor promote BRAND.7（新生产部署 dpl_7p18WL7JTqxbK8VKqNVVnYepLj1b，`grep -c 玉米地` 为 6；回退 dpl_E3AmucjjeUZfCmPQ7NQRi2eiaAv6；D-53 第 0 项 d） |
| 小程序 | wxc3da81aa8852a6ff「香槟市集」，开发版 2026-10-26 上传，未提审 [真人：Eric 记录] |

## CI

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
| P3 7ccb195（第九批） | 1,422,595（与基线差 +41,148） | 150,269 | L179，mpci packageBytes.main |
| P4 24ff7bf（第九批） | 1,459,446（与基线差 +77,999） | 113,418 | L193，mpci packageBytes.main |
| P3 fdb823a（第十批，D-56 第 3 项 b–d） | 1,422,723（与基线差 +41,276） | 150,141 | L208，mpci packageBytes.main |
| 视口 19c4657（第十批，D-56 第 1 项，#382） | 1,381,447（与基线差 0） | 191,417 | check-20261121T125522Z，mpci packageBytes.main |

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
| HOME.3 | 通过 | #374 a756081原首页；29个HOME.3语言key由6d6c598补齐。885603e补英文「 · 」和守则/指南标签，四张手机/桌面浅深截图已看，字体12px；标签判别仍有第16条的数据约定问题。home.events、home.allEvents继续等P4.8（L80）[本地测] |
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
| D-47 第 1 项 | 通过 | 见L72；后续状态按各次写回继续更新 |
| D-47 第 2 项 | 通过 | 885603e：2190/2189/0/1，132条浏览器通过，四张标签截图已看；类型字段歧义见第16条（L80） |
| D-47 第 3 项 | 通过 | c7b0634：旧代码8条中3红；新版8条全过，三类真实源码变异均被抓到；2234/2233/0/1、132条浏览器通过（L82） |
| D-47 第 4 项 | 通过 | 2942e8e：在86ffd0e上9条中7红、2个对照通过，当前9/9；仅移除失败分支invalidatePosts的变异为1红1对照通过。完整单测2237/2236/0/1；没有应用源码变动，构建沿用L82（L83） |
| D-47 第 5 项 | 通过，含冷启动补充 | 73cde94：空栈或取栈抛错不弹入站提示，页面恢复后正常；监听/计数/普通错误不变。旧实现43/39/4/0，修正后43/43；全量2208/2207/0/1。夹具修正单独8df14c5，#374合并adc6ee7后108/108及typecheck/mpci通过。依据属[OMO自决]，见L86、L88 |
| D-47 第 7 项 | 通过 | #369、#374、#375、#370 的描述按各自最终 head 重写，包名加反引号，四个仍是草稿；D-49 没开 PR（L92） |
| P3.1–P3.8 | 部分（P3.7 未做，归 Eric；P3.6 DoD ② 部分；client:P3-m8、m16、m17 部分，D-56 第 4 项 c） | #379 fdb823a（D-56 第 3 项 b–d，L208；主包 1,422,723）；之前 7ccb195：20261120100354 重新冻结 c2a18ee8…（旧 aedc9152… 作废，L179），已含 main 3778952；L-SQL 183/183、P3_TOTAL 703/703、开关默认关；全量 2799/2798/0/1，smoke 612 条 607 passed、4 条 main 上同样失败；主包 1,422,595；迁移里 last_activity_at、answered_at 两条列注释与现在的行为不符（只是注释，读这两列的代码只看是否为空），迁移已冻结不改，等下一条动到这两列的迁移顺手改（mig:P3-B9-3，D-56 第 3 项 e） |
| P4.7 第一步 | 通过 | appendix/research/campus-events.md；D-33 已按 D-43 代定 A，第二步依赖 P4.1、P4.2 |
| P4.1 | 通过 | 本地 wip/P4.1 5f62ddd，容器 test 2015/2014/0/1 [本地测]；不推送；已 merge 进 #380（de2d281） |
| P4.3 | 部分 | caaciorg 本地 28d59b1，Node 20/24 全部通过 [本地测]；推送等 E8，开 PR 由 Eric 做 |
| P4.2、P4.8、P4.9 | 部分（P4.11 未做，归 Eric；P4.2 DoD ④ 成员写入通道留给 P4.6；P4.9 的另一半等 E6，D-56 第 4 项 c） | #380 24ff7bf：20261120122054 重新冻结 a8c0e083…（旧 4d382eaa… 作废，L193），含 P3 7ccb195；L-SQL 184/184、EV_TOTAL 855/855、P3_TOTAL 703/703；全量 2898/2897/0/1，smoke 647 条 639 passed、7 条 main 上同样失败或同类；主包 1,459,446（余 113,418） |
| P4.4–P4.7、P4.10、P4.11 | 未测 | P4.5 真实数据等 D-32；P4.4 同步新鲜度、P4.6 发起活动入口与组织者菜单没做 |
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

16. D-47.2：SPEC只给了“守则/指南”标签和社区守则名称，未定义帖子类型字段。当前按官方精选帖标题中的“社区守则/Community guidelines”识别守则，其他显示指南；这不是稳定元数据规则，标题改名/其他守则文档如何分类仍需明确。近期活动的两个key继续等P4.8，不提前实现。

17. 用号按 D-52 第 0 项（2026-11-13 18:10「子任务只用 ChatGPT 打头的类别」那条已由 D-51 第 1 项解除，L95「admin、board 不用」由 D-52 第 0 项作废）：default（admin）、account-2（board）不设 60% 上限，用到额度耗尽；account-5、account-4 和 ChatGPT 两个号仍按 60%；顺序 default → account-2 → account-5 → account-4，切 ChatGPT 由 supervisor 做，OMO 不改顺序、不切模型。停下条件：default、account-2 都用尽，其余号也都到 60%。

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
28. 上线进度（【supervisor 做】，L141、L146、D-54 第 0 项）：supervisor 独立核过第七批的 vite（#378）、#376、P1.11/P1.12 第 4 次、C-369、P1.8 级联；P3、P4 的核查发现在本机清单里（不进仓库，只引编号），按 D-54 第 2 项修。生产 15:04Z 应用 20261112120000 并 VERIFY；#369、#375、#374 依次 squash 进 main（ad986c9、e9c2604、4900722）；staging 15:14Z、生产 16:02Z 应用 20261114015420 并 VERIFY；#377 加 -s ours 合并 9be6a56 后 squash 进 main 05e0959。#375 在 15:08:01Z 改 base 之后于 15:08:27Z 被关闭、15:08:29Z 重开（L141 漏记，D-54 第 1 项 e）。#372 由 OMO 手工合 main 05e0959（f5dd044，CI 44778423032 全绿）后由 supervisor squash 进 main 3778952；C-final 在 3778952 上 cfinal-1 通过（P1.11 3 passed、P1.12 1 passed，A/B/C 都未受限，L152–L153）。 D-55 第 0 项补：2026-11-20 17:24Z #372 squash 进 main（3778952），C-final 在 3778952 上通过，main 上 run 44783052160 七个 job 全过；2026-11-21 01:16Z supervisor 按 docs/SUPERVISED_RELEASE.md 把 3778952 发布到生产 H5（候选部署就绪、release readiness 通过后，Vercel 自己把两个生产域名指过去，supervisor 没有调 promote；www 与候选的 deployment-identity 都核到 3778952）；同一晚 supervisor 在 Supabase 生产后台把 Confirm signup、Reset password 两个认证邮件模板换成 3778952 的文件内容（正文 sha256 与 git 一致），SMTP 发件人名改成「玉米地 Cornfield」，发信地址和密钥没动。#374（15:32:29Z 改 base、15:32:31Z 关闭、15:32:33Z 重开）、#377（16:03:34Z、16:03:36Z、16:03:38Z）改 base 之后也各被关闭、重开过一次。账本：supervisor 2026-11-21 03:36Z 只读核过，生产 146 行、staging 199 行，都没有 20261120100354、20261120122054。 第八批验收（D-55 第 0 项，D-56 第 4 项 b 补）：supervisor 六个维度独立核查，没有阻断项；复现了 P4 4c1c666、P3 042427c 的全量、smoke、主包和 P3 的 L-SQL，四个迁移的 sha256 与 manifest 一致；C-final 在 3778952 上通过（L152–L153）。D-56 第 0 项：第九批验收，supervisor 七个维度独立核查，没有阻断项，复现了 P4 24ff7bf、P3 7ccb195 的全量、主包与 L-SQL；2026-11-21 09:08Z #381 squash 进 main（66e14a45，树与 c1cacb6 相同），随后在 Supabase 生产后台重贴 Confirm signup、Reset password 两个模板（改后与 66e14a45 的文件相同，标题和 SMTP 没动）；main 上 run 44888125550 七个 job 全过后按 docs/SUPERVISED_RELEASE.md 发布，部署 dpl_DQwi8ZByxr7eroQRw94h4UuVNAwe 09:36:58Z 就绪，Vercel 自己把两个生产域名指过去，没有调 promote，www 与候选的 deployment-identity 核到 66e14a45，发布后一小时生产日志没有 error、warning；回滚目标 dpl_AqYX8W（3778952）。L178 那段文字查清了，不是注入：三段「主会话」文字都是主会话真发的 task_send，「换账号邮箱」那段是号池换号之后 Claude Code 自己插入的 session context 提示；真正的缺陷是消息通道分不清，按 D-56 第 2 项与 RUNBOOK §12 第 17 条改。
29. E6：COMMUNITY_OFFICIAL_PROFILE_ID 没设之前，P3.5 的 set_post_official 和 P4.9 的 create_event_discussion 返回 409 official_profile_not_configured、不落库；set_post_featured、hide_event、unhide_event 不依赖它（D-54 第 1 项 b 更正）。设好后补这两项的另一半。
30. P4.6 的产品问题：被隐藏或下架的成员活动仍占组织者两个名额之一，作者自己删掉讨论帖的不占，要不要改由 Eric 定（L140）。
31. main 上同样失败、本批记录不修的 smoke 用例（D-55 第 5 项，L173、L192）：pages.smoke 首页、广场浅色深色 4 条（stub 的 supabase 主机 00000000000000000000.supabase.co 在任何环境都不存在，CI 用真实后端跑巡检，不是容器的问题；P4 上 pages/events/index 的同类失败同理；pages/my-topics/index 的巡检在 P3、P4 上都通过；D-56 第 4 项 g 更正）；marketplace-responsive.spec.ts:699（main 3778952 上时过时不过，单跑 63 次失败 10 次；D-56 第 1 项在 codex/community-viewport-20261121 上修，P3、P4 本批记「main 上同样不稳定，见 D-56 第 0 项」）。这几条不按 BACKLOG §14 第 3 行停，修要基于 main，另起一项。
32. #380 合并之前（gates:B9-1，D-56 第 3 项 i、第 4 项 h）：它的 public smoke 要在已经应用 20261120100354、20261120122054 的库上跑绿；活动页 pages/events/index 和 P4 的广场页 pages/plaza/index（P4 起也请求 rpc/list_community_events）都还没在真实后端上跑过巡检。
