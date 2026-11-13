# STATUS

写于 2026-11-13 14:16 CT · 作者：OMO（tony-ws）。OMO 每完成一个任务改写本文件，并在 [STATUS_LOG.md](STATUS_LOG.md) 末尾追加一条。证据标签定义见 [README.md](README.md#证据标签)。

`next_task_id: D-48 第 1 项（恢复有效 L2–L5 的全局门禁）`
`latest_batch: appendix/batch/FINAL.md`

next_task_id 按 D-48 第 7 项的新优先顺序取第一条未完成项：D-48 1 → 2 → 3 → D-47 2–5 → D-48 4 → D-49 → D-46 5、6 → D-47 7。D-48.1 未通过并合入相关分支前，520e55a 的全局门禁放行不可发布；不 revert #375 的合并提交。

## 版本

| 项 | 值 |
|---|---|
| 代码分支 / PR | codex/community-topics-20261112 / #369（草稿，OPEN），远端 520e55a [本地测：2026-11-13 git ls-remote] |
| code_sha | 520e55a430331b6c2e2f4fdb144e4974a60ebc05（D-46 3b 3588c24、3f 520e55a 一起推送后的 #369 head，b7bcf3a..520e55a） |
| 基线 main | 7b18f2052e52a4268c25407d0584748477cbf978（2026-11-13 git ls-remote） |
| 材料分支 / PR | codex/community-plan-v5 / #370（草稿，OPEN，不合并）[本地测：2026-11-13 git ls-remote] |
| docs_sha | ffb68d4982c217c89b184c31a919dea0cce2c043（本次写回之前材料分支的 HEAD） |
| 其余代码分支（远端 head） | #374 codex/community-home-20261112 6d6c598（P2.12、HOME.3、HOME.4、HOME.5、SPEC §11、小程序首页、D-46 3d / 3c / 3e；已合入 #369 b7bcf3a 与 #375 4a3cbe6，依赖 #375）。**#374 还不含 3a（3d24a8e），也不含 #369 上的 3b（3588c24）、3f（520e55a）**，所以 #374 上仍有 4a3cbe6 带来的小程序非 tab 页不启动消息与通知监听的问题。#375 codex/community-mp-budget-20261113 30c4b4d（小程序主包腾空间 4a3cbe6、D-46 3a 3d24a8e、D-46 第 4 项 8972507 / 1443d5c / ecc330b，30c4b4d 合入 #369 520e55a 的 3b、3f；base #369 分支）。#373 codex/deps-crossmajor-20261113 55716ba（P1.6 跨大版本，base #371）。#372 codex/brand-cornfield-20261112 ba070e7（BRAND.1–BRAND.4）。#371 codex/config-fixes-20261112 b259105（P1.2–P1.7）[本地测：git ls-remote] |
| tony-ws worktree | ~/work/illini 520e55a（#369，与远端一致）；illini-home 6d6c598（#374，与远端一致）；illini-mpbudget 30c4b4d（#375，与远端一致；D-47 第 5 项子任务进行中）；illini-deps 55716ba（#373）；illini-brand ba070e7（#372）；illini-config b259105（#371）；illini-events wip/P4.1 5f62ddd（本地不推送）；illini-main 7b18f20（origin/main 只读对照）；illini-docs-brand7 本地分支 local/brand7-20261113，在 bd397ce（D-46 第 6 项 BRAND.7 进行中，还没有新提交）；~/work/caaciorg 本地 feat/public-events-feed 28d59b1（不推送）；~/work/illini-docs 在 codex/community-plan-v5 [本地测] |
| 公开 demo | https://illini-community-demo.vercel.app/ 返回 200，内容仍是 V4 原型 [生产：2026-11-12 curl] |
| 小程序 | wxc3da81aa8852a6ff「香槟市集」，开发版 2026-10-26 上传，未提审 [真人：Eric 记录] |

## CI

PR #369 · run [43491206333](https://github.com/EricXu-0805/CAACI_Community_Marketplace_Bazaar/actions/runs/43491206333) · head 520e55a · conclusion failure（public sweep 停在预检，等 E4；Type-check、Boundary 2153 / 2152 / 0 / 1、Build H5、Build mp-weixin 4 个 success，protected staging 与 release readiness 2 个 skipped）[CI run#43491206333]

| job | 结论 | 计数 / 原因 |
|---|---|---|
| Type-check | success | |
| Boundary regressions | success | 2153 tests：2152 pass / 0 fail / 1 skipped [CI run#43491206333] |
| Build H5 | success | |
| Build mp-weixin | success | |
| Smoke (public page sweep) | failure | 预期中：停在「Verify public read schema before browser startup」预检。staging-smoke 还没应用 20261112120000（等 E4） |
| Smoke (protected staging account) | skipped | |

上一次：run 43448423151 · head b7bcf3a · failure（public sweep 停在预检，等 E4；Type-check、Boundary 2053 / 2052 / 0 / 1、Build H5、Build mp-weixin 4 个 success，protected staging 与 release readiness 2 个 skipped）[CI run#43448423151]。

材料分支 #370 · 连续 failure，原因都一样：Build H5 的「Install browsers for compiled admin acceptance」和 public sweep 的「Install Playwright (webkit + chromium)」在 ubuntu-26.04 上装不上浏览器（日志「Cannot install dependencies for ubuntu26.04-x64 with Playwright 1.60.0!」），和 main 同一个基础设施问题，改 workflow 归 Eric。run 43470604328（f43bdd1）、43475385858（5f66faa）、43484767294（08f036c）、43487337489（bd397ce）、43490982420（81196fa，Boundary、Type-check、Build mp-weixin success）[CI run#43487337489][CI run#43490982420]。另有 43474247871（35dabd8）、43474954537（b2cd9ac）被取消。

主包测量环境：一律按 CI build-mp-weixin 环境（https://ci-stub.supabase.co，ci.yml 第 301–303 行；run-checks 的 `mpci` 步骤）量。第三批及以前的数用 H5 job 的 stub URL 量，每个比 CI 环境多 91 字节。预算 1,572,864 字节。

| 分支 / 组合 | 主包（CI 环境） | 余量 | 来源 |
|---|---|---|---|
| #369 520e55a | 1,560,420 | 12,444 | check-20261113T190341Z [本地测] |
| #375 3d24a8e | 1,502,862 | 70,002 | check-20261113T182923Z [本地测] |
| #375 ecc330b（D-46 第 4 项） | 1,322,319 | 250,545 | check-20261113T191554Z，L73 [本地测] |
| #375 30c4b4d（合入 #369 3b、3f） | 1,324,250 | 248,614 | check-20261113T193317Z：test 2162 / 2161 / 0 / 1，smoke 105 passed、只有 4 条已知 pages.smoke 失败 [本地测] |
| #374 6d6c598 | 1,551,820 | 21,044 | check-20261113T183852Z [本地测] |
| #374 6d6c598 ＋ 3d24a8e 试合（supervisor） | 1,551,949 | 20,915 | D-47 第 6 项；离 D-46 第 4 项的 64 KiB 还差 44,621，没算 #369 的 3b、3f 和 #372、#373 |

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
| BRAND.7 | 按 D-48 顺序暂停 | ~/work/illini-docs-brand7 的原型改动保留，未提交、未部署；已有截图早于最后两次修改，恢复时须重拍。待 D-48 前置修正和 D-46 第 5 项后继续 |
| HOME.1 | 通过 | ①–③ 以 design/ 为准（L08）；④ axe 4.14.0：12 个组合 color-contrast 0、<12px 0、溢出 0 [本地测]；⑤ D-35 已定 A |
| HOME.2 | 通过 | bd6fee5，19 条规则单测 [本地测] |
| HOME.3 | 通过 | #374 a756081；首页 19 条用例全过，AXE 0、<12px 0 [本地测]；SPEC §11「HOME.3 首页」节 29 个 key 已由 6d6c598 进语言包（L69）；home.events、home.allEvents 等 P4.8（近期活动区块，现在不做）；英文补位行少「 · 」与 home.typeGuide / typeRules 没用上，由 D-47 第 2 项 a、b 改 |
| HOME.5 | 通过 | #374 2d18576；#374 现 6d6c598（含 HOME.4、SPEC §11、小程序首页、D-46 3c / 3d / 3e，已合入 #369 b7bcf3a 与 #375 4a3cbe6；不含 3a、3b、3f）；小程序主包（CI 环境）1,551,820（余 21,044）[本地测] |
| P2.12 | 通过 | 草稿 PR #374（244a8e7）；12 张截图 <12px 0、axe 0；首屏 390 5 行、1280 9 行 [本地测] |
| HOME.4 | 通过 | #374 010f8f6；12 组 axe 0、<12px 0、溢出 0；截图 appendix/visual/HOME.4/ [本地测] |
| D-46 第 1、2 项 | 通过 | L64、L65 |
| D-46 第 3 项 a | 部分 | 修复 3d24a8e 在 #375（L66）；「再 merge 进 #374」未做 |
| D-46 第 3 项 b | 通过（merge 未做） | 3588c24 在 #369，test 2061 / 2060 / 0 / 1，主包（CI 环境）1,559,431（L70）；「再 merge 进 #375、#374」未做 |
| D-46 第 3 项 c、d、e | 通过（D-47 补完未做） | 73206a0、eca5a8d、6d6c598 在 #374（L67–L69）；D-47 第 2–4 项在 #374 上补 |
| D-46 第 3 项 f | 部分撤回待验证，不可发布 | 520e55a 的全局放行超出了四个 INSERT 守卫的核查范围；按 D-48.1 在 #369 新提交恢复有效 L2–L5 → suspended，保留社区发帖前拦截和回复提示。已改恢复测试，修复前红测排队中；源码尚未恢复（L74） |
| D-46 第 4 项 | 通过（#375 单独）；五个 PR 合上后的余量待第 5 项 | #375 8972507、1443d5c、ecc330b（已推送）；主包（CI 环境）1,322,319（L73）[本地测] |
| D-46 第 5、6 项 | 未做 / 进行中 | 第 5 项（集成试合）排在第 3、4 项和 D-47 第 2–5 项之后；第 6 项见 BRAND.7 行 |
| D-49 | 待前置项 | Eric 已定先服务端限制写入；D-48 全部、D-47 第 2–5 项后，从修正后的 #369 创建 codex/community-restricted-20261113 草稿 PR，base #369。仅此分支获准一个新迁移；先生产应用并 VERIFY，再合前端。#369 恢复旧门禁后不等待此 PR（L75） |
| D-47 第 1 项 | 通过 | 本次写回（L72） |
| D-47 第 2–5 项 | 按 D-48 暂停后续实现 | #374 第 2 项已有未提交修复和正在运行的全量检查；第 3、4 项测试草稿只在 evidence/ 临时目录。#375 第 5 项只有未提交测试，未改生产代码；待 D-48 第 1–3 项完成后恢复 |
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
12. 删 #369 的分支之前，先把 #374、#375 的 base 都改成 main；删 #371 的分支之前，先把 #373 的 base 改成 main（删 base 分支会关闭依赖它的 PR，且不能重开）。#369 若 squash 合并，改完 base 后 #374、#375 要再 merge 一次 origin/main。
13. 首页、新页头、板块页、「全部讨论」已编进小程序（#374，D-45 第 7 项，L62）。主包（CI 环境）：#374 6d6c598 1,551,820（余 21,044，只含 #369 b7bcf3a＋#375 4a3cbe6＋#374）；supervisor 把 #374 和 3a 试合是 1,551,949（余 20,915），离 D-46 第 4 项的 64 KiB 还差 44,621，还没算 #369 的 3b、3f 和 #372、#373；五个 PR 都合上的数等 D-46 第 5 项。小程序渲染、胶囊对齐与运行时行为没在微信开发者工具或真机上跑过，请 Eric 用开发者工具确认，其中包括 3b 的关闭草稿操作菜单（alertText 要基础库 2.14.0 起，manifest 没设最低基础库）和 3f 的受限提示；小程序的「关于本站」复制链接，构建需要 VITE_BASE_URL。暗色侧栏「发布」按钮对比度已在 HOME.4 修好（L61）。

14. D-49：服务端路线已定，不再等待二选一。新草稿 PR 的唯一迁移先在生产应用、VERIFY 通过，前端才能合；staging/生产应用均由 Eric 做。#369 合入 main 后该 PR 的 base 改成 main。D-48 六类路径已由 OMO 追踪最新迁移/调用方做源码核查；未执行新的 PG17 复现，不代表已检查托管库实际状态（证据见 L75）。
