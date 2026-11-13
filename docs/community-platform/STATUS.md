# STATUS

写于 2026-11-13 07:48 CT · 作者：OMO（tony-ws）。OMO 每完成一个任务改写本文件，并在 [STATUS_LOG.md](STATUS_LOG.md) 末尾追加一条。证据标签定义见 [README.md](README.md#证据标签)。

`next_task_id: D-45 第 5 项（#374 部分）与第 6 项 HOME.4`
`latest_batch: appendix/batch/FINAL.md`

## 版本

| 项 | 值 |
|---|---|
| 代码分支 / PR | codex/community-topics-20261112 / #369（草稿，OPEN）[本地测：git push 9c173a4] |
| code_sha | 92698d159021612b84005ad4c36908dda537a86c（OMO 推送 P2.10 后的 #369 head） |
| 基线 main | 7b18f2052e52a4268c25407d0584748477cbf978（2026-11-12 git ls-remote） |
| 材料分支 / PR | codex/community-plan-v5 / #370（草稿，OPEN，不合并）[本地测：2026-11-12 git ls-remote] |
| docs_sha | a64ae9919dbcc54df4dec67754809ea5bc0b0a39（本次本地状态写回之前材料分支的 HEAD，未另建材料提交） |
| 配置 / 品牌 / 首页分支 | codex/config-fixes-20261112 远端 b259105，草稿 PR #371（P1.2–P1.7）；codex/brand-cornfield-20261112 远端 ba070e7，草稿 PR #372（BRAND.1–BRAND.4）；codex/community-home-20261112 远端 68eb43b，草稿 PR #374（P2.12、HOME.3、HOME.5，已合入 #369 的 92698d1）；codex/deps-crossmajor-20261113 远端 55716ba，草稿 PR #373（P1.6 跨大版本，base #371）[本地测] |
| tony-ws 仓库 | ~/work/illini 在 92698d1（#369）；worktree：illini-config（#371）、illini-brand（#372）、illini-home（#374）、illini-deps（#373）、illini-events（wip/P4.1 5f62ddd，本地不推送）、illini-main（origin/main 只读对照）；~/work/caaciorg 本地 feat/public-events-feed 28d59b1（不推送）；~/work/illini-docs 在 codex/community-plan-v5 [本地测] |
| 公开 demo | https://illini-community-demo.vercel.app/ 返回 200，内容仍是 V4 原型 [生产：2026-11-12 curl] |
| 小程序 | wxc3da81aa8852a6ff「香槟市集」，开发版 2026-10-26 上传，未提审 [真人：Eric 记录] |

## CI

PR #369 · run [43422815812](https://github.com/EricXu-0805/CAACI_Community_Marketplace_Bazaar/actions/runs/43422815812) · head 92698d1 · 2026-11-13 CT 结束 · conclusion failure（public sweep 停在预检，等 E4；Type-check、Boundary、Build H5、Build mp-weixin 4 个 success，protected staging 与 release readiness 2 个 skipped）[CI run#43422815812]

| job | 结论 | 计数 / 原因 |
|---|---|---|
| Type-check | success | |
| Boundary regressions | success | 2044 tests：2043 pass / 0 fail / 1 skipped |
| Build H5 | success | |
| Build mp-weixin | success | |
| Smoke (public page sweep) | failure | 预期中：P2.1 的预检在启动浏览器前报「public_schema_mismatch: community topic columns returned HTTP 400」。staging-smoke（hygkwxugskijadgfisji）还没应用 20261112120000（等 E4） |
| Smoke (protected staging account) | skipped | |
| Production release readiness | skipped | |

上一次：run 43418959287 · head 46e69b8 · failure（public sweep 停在预检，等 E4；Boundary 2035/2034/0/1；其余 job 同上）[CI run#43418959287]。bd6fee5 的 run 43412348642 被取消。

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
| P2.6 | 失败 | public sweep 2 failed（上表）；等 D-29、E4 |
| P2.7 | 通过 | smoke 15 passed、test 2001/2000/0/1 [本地测]；CI [CI run#43392843858] |
| P2.8 | 通过 | 46e69b8（已推送 #369）；test 2035/2034/0/1、pg_skips=0，smoke 19 passed，typecheck rc=0；见 STATUS_LOG L51 [本地测] |
| P2.10 | 通过 | 92698d1；主包 1,558,580（预算余 14,284）[本地测] |
| P2.9 | 通过 | ece6d12，OG 标题用话题标题 [本地测] |
| REGION.2 | 通过 | 44629b4 [本地测] |
| P2.11–P2.13 | 未测 | 依赖 P2.6（等 E3/E4）；P2.13 还依赖 P1.8（等 E5） |
| BRAND.1 | 通过 | 草稿 PR #372，全量通过、projectname 玉米地 [本地测]；CI Build H5 等 E5 [CI run#43393646871] |
| BRAND.3 | 通过 | 徽章检索 10 → 0 [本地测] |
| BRAND.2 | 通过（⑦ 等 E5） | 品牌名检索 76 → 0，test 1991/1990/0/1 [本地测]；Build H5 等 E5 [CI run#43393646871] |
| BRAND.4 | 通过 | ① 出稿在 appendix/visual/logo/；D-34 代定 B 的单字「玉」；② #372 ba070e7 替换完成 [本地测] |
| BRAND.5–BRAND.7 | 未测 | BRAND.5 等 D-30（E7）；BRAND.6 等 D-36（延后到内测后）；BRAND.7 等 HOME.4（D-35 已定 A） |
| HOME.1 | 通过 | ①–③ 以 design/ 为准（L08）；④ axe 4.14.0：12 个组合 color-contrast 0、<12px 0、溢出 0 [本地测]；⑤ D-35 已定 A |
| HOME.2 | 通过 | bd6fee5，19 条规则单测 [本地测] |
| HOME.3 | 通过 | #374 a756081；首页 19 条用例全过，AXE 0、<12px 0 [本地测] |
| HOME.5 | 通过 | #374 2d18576；合并 #369 后 68eb43b，MERGEABLE；主包 1,568,808（余 4,056）[本地测] |
| P2.12 | 通过 | 草稿 PR #374（244a8e7）；12 张截图 <12px 0、axe 0；首屏 390 5 行、1280 9 行 [本地测] |
| HOME.4 | 未测 | 依赖各自任务（D-35 已定 A） |
| P3.1–P3.8 | 未测 | 依赖 P2.13（#369 合并） |
| P4.7 第一步 | 通过 | appendix/research/campus-events.md；D-33 已按 D-43 代定 A，第二步依赖 P4.1、P4.2 |
| P4.1 | 通过 | 本地 wip/P4.1 5f62ddd，容器 test 2015/2014/0/1 [本地测]；不推送 |
| P4.3 | 部分 | caaciorg 本地 28d59b1，Node 20/24 全部通过 [本地测]；推送等 E8，开 PR 由 Eric 做 |
| P4.2、P4.4–P4.11 | 未测 | P4.5 真实数据等 D-32 |
| LEGAL.1–LEGAL.6 | 未测 | 等 D-37、D-38、D-39、D-40、D-28 |
| CONTENT.1–CONTENT.6、P5.1–P8.1 | 未测 | 依赖 LEGAL 与 P5.2 |

## 阻塞与等待 Eric

1. 合 #369 进 main 就是把前端发布到 illinimarket.com 生产：之前必须先在生产应用 20261112120000 并跑它的 VERIFY（ENGINEERING §6；P2.5 DoD ④ 生产那一半由 Eric 核；应用后 VERIFY_20260718_reconcile_app_table_acl_boundaries 报 posts 列漂移属预期，见 L46），BACKLOG 还要求合并前 P2.13 通过。
2. D-29 → E2、E3：staging-smoke 只有合成数据的书面确认与 A/B/C 账号。挡住 P1.11、P1.12、P2.6、P2.11。
3. E4：P2.5 在 STATUS_LOG 写出「20261112120000 冻结」后，Eric 把迁移应用到 hygkwxugskijadgfisji。挡住 P2.6、P2.13。
4. P1.6 跨大版本已按 D-44 做成草稿 PR #373（base #371）：合不合由 Eric 定；合之前请在带 SENTRY_AUTH_TOKEN 的发布构建里确认 source map 上传。#373 不触发 CI（ci.yml 只认 base=main）。两者都合并后 Boundary 仍红：ci.yml 第 182 行的 `npm audit --audit-level=moderate` 没有例外清单，vite 6.4.4 的 moderate 还在；让 CI 认例外清单要改 workflow，归 Eric。
5. E5：合并 P1.7 的 PR（#371）。挡住 P1.8（进而 P2.13），以及 BRAND.2 ⑦ 的 Build H5。
6. D-35 已定（A 纸本书院），HOME.4、P2.12、BRAND.7 只剩各自的任务依赖；D-34 已按 D-43 代定（B 的单字「玉」），BRAND.4 ② 由 OMO 做。
7. D-30（E7，微信后台核对）挡住 BRAND.5、P5.2；D-31 已定（A），E8（fork 与令牌权限）还没做，P4.3 只在本地写。D-40 已定（A，请律师审 LEGAL.2、LEGAL.4），LEGAL 组仍等 D-37。
8. D-37（董事会同意）挡住 LEGAL.1–LEGAL.3；D-28（轮值伙伴）挡住 LEGAL.6 与 P5；D-36 已按 D-43 代定 D（延后），BRAND.6 等内测之后，P5.1 前 Eric 要重新答复。
9. E6（官方账号 profile id）在 P3.5 与 P4.9 前需要；D-32、D-33、D-38、D-39、D-40 的截止任务见 [DECISIONS.md](DECISIONS.md)。
10. BRAND（#372）生产发布后：Eric 在 STATUS_LOG 记发布日；「原 Illini Market」（app.formerly，登录页与 /about）在发布日 + 90 天移除；同时做 E10（邮件模板、生产 DIGEST_FROM）。
11. #372 要手工合：与 #369 冲突在 api/share-post.js、en.ts、zh.ts（#374 另有 app.name / app.desc / app.tagline / app.formerly 一块）；保留 #369 的 P2.9 topicTitle / headline 逻辑与 P2.2「回复 / reply」措辞，只取 #372 的品牌字串。
12. 删 #369、#371 的分支之前，先把 #374、#373 的 base 改成 main（删 base 分支会关闭依赖它的 PR，且不能重开）。
13. 首页、新页头、板块页现在只编进 H5（L54，SPEC §8、D-12 没有豁免），请 Eric 定；D-45 第 4、7 项先尝试补进小程序。暗色侧栏「发布」按钮对比度 2.87:1（L49）。
