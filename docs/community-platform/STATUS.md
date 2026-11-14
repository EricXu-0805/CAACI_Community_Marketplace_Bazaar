# STATUS

写于 2026-11-13 21:36 CT · 作者：OMO（tony-ws）。OMO 每完成一个任务改写本文件，并在 [STATUS_LOG.md](STATUS_LOG.md) 末尾追加一条。证据标签定义见 [README.md](README.md#证据标签)。

`next_task_id: —（D-50 第 2 项：D-46 到 D-50 本轮已做完或按规定停下，等下一条指示，不从 BACKLOG 往下接）`
`latest_batch: appendix/batch/FINAL.md`

本轮（D-46 到 D-50，含 supervisor 18:10、18:20 两条补充）已收尾：FINAL「第四批（D-46）」与本文件在同一提交。D-49 按第 6 项停在本地 L-SQL 基线（L89），没有迁移、没有 PR。按 D-50 结束目标、取消续跑提醒，不再自设目标，不从 BACKLOG 接新任务。

## 版本

| 项 | 值 |
|---|---|
| 代码分支 / PR | codex/community-topics-20261112 / #369（草稿，OPEN），远端04edaa3 [本地测：2026-11-13 push回执] |
| code_sha | 04edaa36a6edd717c069d78dc4afad57ac1f196c（#369 最终 head；D-50 补充已传播到 #375 571be45、#374 2e0f582） |
| 基线 main | 7b18f2052e52a4268c25407d0584748477cbf978（2026-11-13 git ls-remote） |
| 材料分支 / PR | codex/community-plan-v5 / #370（草稿，OPEN，不合并）[本地测：2026-11-13 git ls-remote] |
| docs_sha | 779c07fa78848c2a0a5577b347d04ddf77bd402f（本次写回之前材料分支的 HEAD） |
| 其余代码分支（远端 head） | #374 codex/community-home-20261112 2e0f582（含 #369 04edaa3、#375 571be45）。#375 codex/community-mp-budget-20261113 571be45（base #369）。#373 55716ba（base #371）；#372 ba070e7；#371 b259105。四个都是草稿 [本地测：2026-11-14 gh pr view] |
| tony-ws worktree | illini 04edaa3；illini-home 2e0f582；illini-mpbudget 571be45，三者已推送且干净。illini-d46-integration 为本地 local/d46-final-integration-20261114 412e14d（五 PR 集成，不推送）。illini-restricted 为本地 codex/community-restricted-20261113，HEAD 04edaa3，只有 2 份未提交 _ops 草稿，未推送、无 PR。illini-docs-brand7 local/brand7-20261113 15aa47e（已合进材料分支 779c07f，干净）。illini-deps 55716ba；illini-brand ba070e7；illini-config b259105；illini-events 本地 5f62ddd 不推；illini-main 只读 7b18f20；caaciorg 本地 28d59b1 不推；材料 codex/community-plan-v5 [本地测] |
| 公开 demo | https://illini-community-demo.vercel.app/ 返回 200，仍是 V4 原型（grep 玉米地 0），回退 id dpl_E3AmucjjeUZfCmPQ7NQRi2eiaAv6 [生产：2026-11-14 curl、vercel inspect 只读]。BRAND.7 预览 https://illini-community-demo-978sy3clx-ericxu-0805s-projects.vercel.app（dpl_3bG2SKTAmQsa7jEmScy2cHHpnk1y）返回 200，等 Eric promote（E12）[本地测] |
| 小程序 | wxc3da81aa8852a6ff「香槟市集」，开发版 2026-10-26 上传，未提审 [真人：Eric 记录] |

## CI

#369当前head 04edaa3的run 43539761691已完成：Type-check、Boundary、H5、mp-weixin四项success；public sweep在schema预检报community topic columns HTTP400（E4）；两项skipped。Boundary实读2156/2155/0/1。

PR #369 · run [43539761691](https://github.com/EricXu-0805/CAACI_Community_Marketplace_Bazaar/actions/runs/43539761691) · head 04edaa3 · conclusion failure（Type-check、Boundary、Build H5、Build mp-weixin success；public sweep 停在 Verify public read schema before browser startup，等 E4；其余两项 skipped）[CI run#43539761691]

| job | 结论 | 计数 / 原因 |
|---|---|---|
| Type-check | success | |
| Boundary regressions | success | 2156 tests：2155 pass / 0 fail / 1 skipped [CI run#43539761691] |
| Build H5 | success | |
| Build mp-weixin | success | |
| Smoke (public page sweep) | failure | 预期中：停在「Verify public read schema before browser startup」预检。staging-smoke 还没应用 20261112120000（等 E4） |
| Smoke (protected staging account) | skipped | |

上一次：run 43448423151 · head b7bcf3a · failure（public sweep 停在预检，等 E4；Type-check、Boundary 2053 / 2052 / 0 / 1、Build H5、Build mp-weixin 4 个 success，protected staging 与 release readiness 2 个 skipped）[CI run#43448423151]。

材料分支 #370：多数已读失败来自ubuntu-26.04不能安装Playwright 1.60浏览器；不能把所有失败都归到这一原因。此前记录的43470604328、43475385858、43484767294、43487337489、43490982420保留；另有43474247871、43474954537取消。新增六次按Actions API和实际job日志核对如下（证据~/work/evidence/CI/supervisor-six-runs-20261113.md）。

| run / head | 失败分类 | 证据 |
|---|---|---|
| [43493142000](https://github.com/EricXu-0805/CAACI_Community_Marketplace_Bazaar/actions/runs/43493142000) / 9bc4b55 | H5/public浏览器安装步骤失败，H5日志明确ubuntu26.04与Playwright1.60不兼容；Boundary成功 | [CI run#43493142000] |
| [43495796397](https://github.com/EricXu-0805/CAACI_Community_Marketplace_Bazaar/actions/runs/43495796397) / f01d04b | H5/public浏览器安装步骤失败，H5日志明确ubuntu26.04与Playwright1.60不兼容；Boundary成功 | [CI run#43495796397] |
| [43501071827](https://github.com/EricXu-0805/CAACI_Community_Marketplace_Bazaar/actions/runs/43501071827) / d982ec8 | H5/public浏览器安装步骤失败，H5日志明确ubuntu26.04与Playwright1.60不兼容；Boundary成功 | [CI run#43501071827] |
| [43503851223](https://github.com/EricXu-0805/CAACI_Community_Marketplace_Bazaar/actions/runs/43503851223) / b4788cf | H5/public浏览器安装步骤失败，H5日志明确ubuntu26.04与Playwright1.60不兼容；Boundary成功 | [CI run#43503851223] |
| [43509639602](https://github.com/EricXu-0805/CAACI_Community_Marketplace_Bazaar/actions/runs/43509639602) / 7293b01 | 另有Boundary测试超时；H5/public浏览器安装步骤也失败 | [CI run#43509639602] |
| [43525055626](https://github.com/EricXu-0805/CAACI_Community_Marketplace_Bazaar/actions/runs/43525055626) / 1d1734c | H5/public浏览器安装步骤失败，H5日志明确ubuntu26.04与Playwright1.60不兼容；Boundary成功 | [CI run#43525055626] |

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
| P1.6 / P1.8 / P1.11、P1.12 | 部分 / 未测 | P1.6：同大版本在 #371 23ce3b6；跨大版本按 D-44 在草稿 PR #373（55716ba），容器内全量通过、审计只剩 vite，等 Eric 定合不合；P1.8 等 E5（合并 #371）；P1.11、P1.12 等 D-29（E2）与 E3 |
| P2.1 | 通过 | ①②④ 本地；③ 由 CI 的 public sweep 在 staging 上给出预期报错（本地 S-1 运行等 E3）[CI run#43377614567] |
| P2.2 | 通过 | test 2001 / 2000 / 0 / 1，smoke 35 passed [本地测]；CI Boundary 同数 [CI run#43377614567] |
| P2.3 | 通过 | 9→0；两张截图第 2 项为「社区」；smoke 14 passed、test 2001/2000/0/1 [本地测]；CI 同前 [CI run#43380822445] |
| P2.4 | 通过 | smoke 23 passed、test 2001/2000/0/1 [本地测]；CI [CI run#43383800477] |
| REGION.1 | 通过 | 列、约束、只读授权、region_in 已并入；test 2001/2000/0/1 [本地测]；④ 的 VERIFY/L-SQL 随 P2.5 |
| P2.5 | 通过 | 20261112120000 冻结（sha256 e2a85c3e…）；L-SQL 181/181，PRECHECK→REPLAY→VERIFY→REGRESSION 全过；test 2001/2000/0/1 [隔离环境 L-SQL][本地测]；④ staging 探测等 E3 |
| P2.6 | 失败 | public sweep 停在预检（上表）；等 D-29、E4 |
| P2.7 | 通过 | smoke 15 passed、test 2001/2000/0/1 [本地测]；CI [CI run#43392843858] |
| P2.8 | 通过 | 46e69b8（已推送 #369）；test 2035/2034/0/1、pg_skips=0，smoke 19 passed，typecheck rc=0；见 STATUS_LOG L51 [本地测] |
| P2.10 | 通过 | 92698d1；主包 1,558,489（CI 环境，由当时 H5 stub 环境实测的 1,558,580 按 D-46 的 91 字节差换算；预算余 14,375）[本地测] |
| P2.9 | 通过 | ece6d12，OG 标题用话题标题 [本地测] |
| REGION.2 | 通过 | 44629b4 [本地测] |
| P2.11–P2.13 | 未测 | 依赖 P2.6（等 E3/E4）；P2.13 还依赖 P1.8（等 E5） |
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
| D-46 第 3 项 b | 通过 | ae058c2的标题映射、D-50长度规则已进入#369、#375 22d9009和#374 c7b0634远端head（L77、L81） |
| D-46 第 3 项 c、d、e | 通过，D-47补完完成 | 73206a0、eca5a8d、6d6c598为原修复；e由885603e补完，c由c7b0634改为仅小程序限流并取消过期队列。d补测为2942e8e（L80、L82、L83） |
| D-46 第 3 项 f | 全局放行已撤回 | 有效L2–L5 → suspended已进入#369 ae058c2、#375 22d9009和#374 c7b0634远端head。发帖前拦截和回复提示保留；不 revert 30c4b4d。受限浏览只能在D-49新迁移证明服务端拦截后于独立PR实现（L76、L81、L82） |
| D-46 第 4 项 | 通过 | 五个 PR 本地集成主包 1,374,461、余 198,403（L90）。#375最近0eabe73主包1,324,732、余248,132；#374组合余199,807。最终六条测试在3d24a8e上6/4/2/0，真实history→detail导入变异6/5/1/0，见L84；不再用早期五条稿的单条失败代表最终版本 |
| D-46 第 5 项 | 通过 | 本地 412e14d（#374 2e0f582 + #373 + #372，不推送）：test 2248/2247/0/1、pg_skips=0，smoke 12 份 204 passed，typecheck/h5/mpci/migrations rc=0，npm audit 只剩 vite moderate；五 PR 主包 1,374,461、余 198,403（L90）[本地测] |
| D-46 第 6 项 | 通过（DoD ④ 等 Eric promote） | 见 BRAND.7 行（L91） |
| D-49 | 【跳过】按停止条件收束 | 只读盘点完成；st_01a1d7cb三次L-SQL基线均回放181条，分别停在夹具owner_id、tgenabled转text、实际缺失storage.objects.version。最终errors=1/done=0/SQLrc3；行为用例0、有效红测0、绿测0。仅PRECHECK/REGRESSION草稿；无迁移/VERIFY/Node测试/manifest修改/客户端或API实现，无草稿PR。PG helper在#371，尚未进入#369基线。保留L2–L5全局门禁；后续须先解决本地平台与helper依赖（L89） |
| D-47 第 1 项 | 通过 | 见L72；后续状态按各次写回继续更新 |
| D-47 第 2 项 | 通过 | 885603e：2190/2189/0/1，132条浏览器通过，四张标签截图已看；类型字段歧义见第16条（L80） |
| D-47 第 3 项 | 通过 | c7b0634：旧代码8条中3红；新版8条全过，三类真实源码变异均被抓到；2234/2233/0/1、132条浏览器通过（L82） |
| D-47 第 4 项 | 通过 | 2942e8e：在86ffd0e上9条中7红、2个对照通过，当前9/9；仅移除失败分支invalidatePosts的变异为1红1对照通过。完整单测2237/2236/0/1；没有应用源码变动，构建沿用L82（L83） |
| D-47 第 5 项 | 通过，含冷启动补充 | 73cde94：空栈或取栈抛错不弹入站提示，页面恢复后正常；监听/计数/普通错误不变。旧实现43/39/4/0，修正后43/43；全量2208/2207/0/1。夹具修正单独8df14c5，#374合并adc6ee7后108/108及typecheck/mpci通过。依据属[OMO自决]，见L86、L88 |
| D-47 第 7 项 | 通过 | #369、#374、#375、#370 的描述按各自最终 head 重写，包名加反引号，四个仍是草稿；D-49 没开 PR（L92） |
| P3.1–P3.8 | 未测 | 依赖 P2.13（#369 合并） |
| P4.7 第一步 | 通过 | appendix/research/campus-events.md；D-33 已按 D-43 代定 A，第二步依赖 P4.1、P4.2 |
| P4.1 | 通过 | 本地 wip/P4.1 5f62ddd，容器 test 2015/2014/0/1 [本地测]；不推送 |
| P4.3 | 部分 | caaciorg 本地 28d59b1，Node 20/24 全部通过 [本地测]；推送等 E8，开 PR 由 Eric 做 |
| P4.2、P4.4–P4.11 | 未测 | P4.5 真实数据等 D-32；P4.8 做完以后才接首页的近期活动区块（home.events、home.allEvents） |
| LEGAL.1–LEGAL.6 | 未测 | 等 D-37、D-38、D-39、D-40、D-28 |
| CONTENT.1–CONTENT.6、P5.1–P8.1 | 未测 | 依赖 LEGAL 与 P5.2 |

## 阻塞与等待 Eric

1. 合 #369 进 main 就是把前端发布到 illinimarket.com 生产：之前必须先在生产应用 20261112120000 并跑它的 VERIFY（ENGINEERING §6；P2.5 DoD ④ 生产那一半由 Eric 核；应用后 VERIFY_20260718_reconcile_app_table_acl_boundaries 报 posts 列漂移属预期，见 L46），BACKLOG 还要求合并前 P2.13 通过。
2. D-29 → E2、E3：staging-smoke 只有合成数据的书面确认与 A/B/C 账号。挡住 P1.11、P1.12、P2.6、P2.11。
3. E4：P2.5 在 STATUS_LOG 写出「20261112120000 冻结」后，Eric 把迁移应用到 hygkwxugskijadgfisji（staging-smoke）。挡住 P2.6、P2.13。
4. P1.6 跨大版本已按 D-44 做成草稿 PR #373（base #371）：合不合由 Eric 定；合之前请在带 SENTRY_AUTH_TOKEN 的发布构建里确认 source map 上传。#373 不触发 CI（ci.yml 只认 base=main）。两者都合并后 Boundary 仍红：ci.yml 第 182 行的 `npm audit --audit-level=moderate` 没有例外清单，vite 6.4.4 的 moderate 还在；让 CI 认例外清单要改 workflow，归 Eric。
5. E5：合并 P1.7 的 PR（#371）。挡住 P1.8（进而 P2.13），以及 BRAND.2 ⑦ 的 Build H5。
6. D-35 已定（A 纸本书院），HOME.4、P2.12、BRAND.7 只剩各自的任务依赖；D-34 已按 D-43 代定（B 的单字「玉」），BRAND.4 ② 由 OMO 做。
7. D-30（E7，微信后台核对）挡住 BRAND.5、P5.2；D-31 已定（A），E8（fork 与令牌权限）还没做，P4.3 只在本地写。D-40 已定（A，请律师审 LEGAL.2、LEGAL.4），LEGAL 组仍等 D-37。
8. D-37（董事会同意）挡住 LEGAL.1–LEGAL.3；D-28（轮值伙伴）挡住 LEGAL.6 与 P5；D-36 已按 D-43 代定 D（延后），BRAND.6 等内测之后，P5.1 前 Eric 要重新答复。
9. E6（官方账号 profile id）在 P3.5 与 P4.9 前需要；D-32、D-33、D-38、D-39、D-40 的截止任务见 [DECISIONS.md](DECISIONS.md)。
10. BRAND（#372）生产发布后：Eric 在 STATUS_LOG 记发布日；「原 Illini Market」（app.formerly，登录页与 /about）在发布日 + 90 天移除；同时做 E10（邮件模板、生产 DIGEST_FROM）。
11. #372 要手工合：与 #369 冲突在 api/share-post.js、en.ts、zh.ts（#374 另有 app.name / app.desc / app.tagline / app.formerly 一块）；保留 #369 的 P2.9 topicTitle / headline 逻辑与 P2.2「回复 / reply」措辞，只取 #372 的品牌字串。#374 与 #372 还在 app/src/pages/plaza/index.vue 冲突：c16f0a1 删了「关注的人」名单，#372 的 BRAND.3 徽章改的正是那段；保留 #374 的删除，这块的徽章改动丢弃（名单在 pages/following，那一页照 #372）。

   #369 → #374 冲突图（D-48.3，实合 ae058c2）：

   | 文件 | 合并规则 |
   |---|---|
   | app/src/pages/plaza/index.vue | 保留 #374 的 following 帖子流、invalidatePosts 与 openComposer(board?)；加入 replyRestricted；六个 compose/click 入口共用发帖前限制检查 |
   | app/src/pages/post/index.vue | 同时保留 authorBlocked、replyFailed 的布局/重试状态与 replyRestricted 提示及写入前拦截，三处逐块合并 |
   | app/smoke/community-board-deeplink.test.mjs | 保留社区路由测试工具，另补 isSuspensionActive，避免重复导入 |
   | app/smoke/community-post-topics.spec.ts | 保留 view=all 和 New topic/发话题；加入 L2–L5 门禁与 options.open；正常账号夹具同时提供话题与旧式动态，保留两种回复入口验证 |
   | app/src/composables/i18n/messages/en.ts、zh.ts | 自动合并会各留两份 plaza.restrictedReply，手工去重为每语言一份；未改变值 |

12. 删 #369 的分支之前，先把 #374、#375 的 base 都改成 main；删 #371 的分支之前，先把 #373 的 base 改成 main（删 base 分支会关闭依赖它的 PR，且不能重开）。#369 若 squash 合并，改完 base 后 #374、#375 要再 merge 一次 origin/main。
13. 首页、新页头、板块页、全部讨论已编进小程序。#374 2e0f582（含#369 04edaa3、#375 571be45）CI 环境主包 1,373,060、余 199,804；五个 PR 本地集成（再加 #373、#372）1,374,461、余 198,403（L90），满足 64 KiB 目标。微信开发者工具/真机仍须验证渲染、胶囊、路由、操作菜单标题、空栈提示抑制、首次分包下载/离线失败与返回栈。没有preloadRule，login/search/notifications/settings/legal等首次进入要下载；本批不加预加载规则。首页6+inbox 2+notifications 2=10，onShow资料读取可到11；D-47.3只限首页。按supervisor核查，基础库3.8.10起超并发请求才排队，更老版本可能直接失败；manifest未设最低基础库，需Eric实测并定最低版本。小程序构建须有VITE_BASE_URL。showModal加权规则只核验3.15.0–3.15.2；showActionSheet只检查itemList不超过6项，title/alertText和条目文字不限长，更早版本未核。

14. D-49服务端路线已定，但本轮在L-SQL基线阶段停止：本地Storage管理面缺version，PG17 helper未在#369基线（可在#371找到）。未实现任何新权限限制、未创建迁移、未放开L2–L4浏览、未开PR；回复重试/Sentry/提示条等客户端部分也未做。若以后继续，先解决这些本地前置并重新证明矩阵；新迁移须Eric在生产应用且VERIFY通过后才能合前端。此处是本地模拟面缺口，不等于已查出托管库缺字段。证据见L89与evidence/D49/sql/BLOCKED.md。

15. D-50撤销生产按钮超长误报；本次再补MP/VUE3条件与pages内非注册组件的扫描盲区，英文注释明确非Latin-1的每个UTF-16单元计2（单个非BMP emoji计4）。showActionSheet只查itemList≤6、文字不限长（已核基础库3.15.0–3.15.2）。所有正式FINAL④/⑥的新增内容在本轮收尾同提交真正写入；内部草稿不算正式报告。D-46到D-50完成或按规定停下后结束目标、取消续跑，不续接BACKLOG。

16. D-47.2：SPEC只给了“守则/指南”标签和社区守则名称，未定义帖子类型字段。当前按官方精选帖标题中的“社区守则/Community guidelines”识别守则，其他显示指南；这不是稳定元数据规则，标题改名/其他守则文档如何分类仍需明确。近期活动的两个key继续等P4.8，不提前实现。

17. [supervisor 指示，2026-11-13 18:10 CT] anthropic-subscription的default、account-2、account-3登录过期，须Eric本人重新登录；OMO不尝试登录。account-4已到Eric设定的60%总周上限，不再派活。剩余子任务只用首模型为ChatGPT订阅的deep-high/ultrabrain/deep-low或主线程；旧st_01a1d6e8已释放，不再恢复。BRAND.7 已由 st_01a1d67e 本地提交原型（15aa47e），主会话合进材料分支并做了预览部署（L91）。

18. BRAND.7（E12）：看预览 https://illini-community-demo-978sy3clx-ericxu-0805s-projects.vercel.app 后由 Eric promote；先在 Vercel 记下当前 production deployment id（OMO 用 vercel inspect 读到 dpl_E3AmucjjeUZfCmPQ7NQRi2eiaAv6），promote 后 `curl -s https://illini-community-demo.vercel.app/ | grep -c 玉米地` 应不小于 1。
