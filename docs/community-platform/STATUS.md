# STATUS

写于 2026-11-13 01:19 CT · 作者：OMO（tony-ws）。OMO 每完成一个任务改写本文件，并在 [STATUS_LOG.md](STATUS_LOG.md) 末尾追加一条。证据标签定义见 [README.md](README.md#证据标签)。

`next_task_id: REGION.1`

## 版本

| 项 | 值 |
|---|---|
| 代码分支 / PR | codex/community-topics-20261112 / #369（草稿，OPEN）[本地测：git push 9c173a4] |
| code_sha | 9b27fccf981eb9f30729585df03eacd682908f62（OMO 推送 REGION.1 后的 #369 head） |
| 基线 main | 7b18f2052e52a4268c25407d0584748477cbf978（2026-11-12 git ls-remote） |
| 材料分支 / PR | codex/community-plan-v5 / #370（草稿，OPEN，不合并）[本地测：2026-11-12 git ls-remote] |
| docs_sha | a724bd85070190ace0b54b625adff1c4042c70c4（写本版 STATUS 之前材料分支的 HEAD，取法见 RUNBOOK §8） |
| 配置 / 品牌 / 首页分支 | codex/config-fixes-20261112 远端 14b4e4a（P1.2–P1.5），没开 PR（P1.7）；品牌、首页还没建（BRAND.1 / HOME.3）[本地测] |
| tony-ws 仓库 | ~/work/illini 在 005ca9d；~/work/illini-docs 已切到 codex/community-plan-v5（P1.1 ④，见 STATUS_LOG L15）[本地测] |
| 公开 demo | https://illini-community-demo.vercel.app/ 返回 200，内容仍是 V4 原型 [生产：2026-11-12 curl] |
| 小程序 | wxc3da81aa8852a6ff「香槟市集」，开发版 2026-10-26 上传，未提审 [真人：Eric 记录] |

## CI

PR #369 · run [43383800477](https://github.com/EricXu-0805/CAACI_Community_Marketplace_Bazaar/actions/runs/43383800477) · head 9b27fcc · 2026-11-13 CT 结束 · conclusion failure（job 结论与下表相同；91027fb 的 run 被 9b27fcc 取代后取消）[CI run#43383800477]

| job | 结论 | 计数 / 原因 |
|---|---|---|
| Type-check | success | |
| Boundary regressions | success | 2001 tests：2000 pass / 0 fail / 1 skipped |
| Build H5 | success | |
| Build mp-weixin | success | |
| Smoke (public page sweep) | failure | 预期中：P2.1 的预检在启动浏览器前报「public_schema_mismatch: community topic columns returned HTTP 400」。staging-smoke（hygkwxugskijadgfisji）还没应用 20261112120000（等 E4） |
| Smoke (protected staging account) | skipped | |
| Production release readiness | skipped | |

上一次：run 43212596901 · head 005ca9d · failure（public sweep 437 passed / 2 failed，plaza 拉帖 400）[CI run#43212596901]

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
| P1.5 | 未测 | ①–④ 通过（fsevents 删除经 Eric 批准）；⑤ 等 P1.7 的 CI [本地测] |
| P1.13 | 通过 | DoD ①–④ 符合；link 拉下的 .env.local 已按 Eric 答复删除 [本地测] |
| P1.9 | 通过 | 镜像 169f16e6…，全量每步 rc=0；test 1994 / 1993 / 0 / 1 [本地测] |
| P1.10 | 失败 | 两轮修正后 129/181，停在 20260722081141（要求 postgres 角色），见 STATUS_LOG；停这条 [隔离环境 L-SQL] |
| P1.7 | 未测 | 草稿 PR #371 已开（base main，head 14b4e4a），等 CI |
| P1.6 / P1.8 / P1.11、P1.12 | 跳过 / 未测 | P1.6【跳过】（D-42 第 4 项）：7 个包要 Eric 逐项定，明细见 STATUS_LOG 与批次报告；P1.8 等 E5（合并 P1.7 的 PR）；P1.11、P1.12 等 D-29（E2）与 E3 |
| P2.1 | 通过 | ①②④ 本地；③ 由 CI 的 public sweep 在 staging 上给出预期报错（本地 S-1 运行等 E3）[CI run#43377614567] |
| P2.2 | 通过 | test 2001 / 2000 / 0 / 1，smoke 35 passed [本地测]；CI Boundary 同数 [CI run#43377614567] |
| P2.3 | 通过 | 9→0；两张截图第 2 项为「社区」；smoke 14 passed、test 2001/2000/0/1 [本地测]；CI 同前 [CI run#43380822445] |
| P2.4 | 通过 | smoke 23 passed、test 2001/2000/0/1 [本地测]；CI [CI run#43383800477] |
| P2.4（原基线） | 已完成 | zh.ts:894-898 仍是旧板块名；tabBar 首页/广场/发布/消息/我的；composerMode 默认 'update'（plaza/index.vue:946）[源码 005ca9d] |
| P2.5、REGION.1 | 未测 | 迁移 20261112120000 未应用到任何托管库，没有 lock_timeout，_ops 下缺 PRECHECK/VERIFY/REGRESSION，没有 region 列 [源码 005ca9d] |
| P2.6 | 失败 | public sweep 2 failed（上表）；等 D-29、E4 |
| P2.7–P2.13、REGION.2 | 未测 | 依赖 P2.4 / P2.5 / P2.6 |
| BRAND.1–BRAND.3 | 未测 | 基线计数写在 BACKLOG 各自 DoD |
| BRAND.4–BRAND.7 | 未测 | 等 D-34、D-30（E7）、D-36、D-35 |
| HOME.1 | 未测 | ①–③ 由 design/direction-{a,b,c}.html 与 design/screenshots/ 满足（2026-11-12 14:18 CT，L08），以 design/ 为准，不另做；④ 只跑过脚本对比度，axe 未跑；⑤ 等待 D-35 |
| HOME.2、HOME.3、HOME.5 | 未测 | 依赖 P2.5、REGION.1 |
| HOME.4、P2.12 | 未测 | 等 D-35 |
| P3.1–P3.8 | 未测 | 依赖 P2.13（#369 合并） |
| P4.7 第一步 | 通过 | appendix/research/campus-events.md；D-33 已按 D-43 代定 A，第二步依赖 P4.1、P4.2 |
| P4.1–P4.11 | 未测 | P4.1 依赖 P1.9；P4.3 可在本地写，推送等 E8；P4.5 真实数据等 D-32 |
| LEGAL.1–LEGAL.6 | 未测 | 等 D-37、D-38、D-39、D-40、D-28 |
| CONTENT.1–CONTENT.6、P5.1–P8.1 | 未测 | 依赖 LEGAL 与 P5.2 |

## 阻塞与等待 Eric

1. D-29 → E2、E3：staging-smoke 只有合成数据的书面确认与 A/B/C 账号。挡住 P1.11、P1.12、P2.6、P2.11。
2. E4：P2.5 在 STATUS_LOG 写出「20261112120000 冻结」后，Eric 把迁移应用到 hygkwxugskijadgfisji。挡住 P2.6、P2.13。
3. 【跳过】P1.6（D-42 第 4 项）：要 Eric 逐项定 7 个包——follow-redirects、qs 改 overrides 即可修；@intlify/core-base、@intlify/shared 要 vue-i18n 9→11；glob、minimatch 跨大版本；vite 没有修复版。P1.7 已照开草稿 PR #371，Boundary 只允许卡在依赖审计。
4. P1.10（L-SQL 回放工具）停这条，等答复脚本的连接角色与 bootstrap 顺序；挡住 P2.5，进而挡住 HOME.2、HOME.3、HOME.5。E5：合并 P1.7 的 PR。挡住 P1.8，以及 BRAND.2 ⑦ 的 Build H5。
5. D-35 已定（A 纸本书院），HOME.4、P2.12、BRAND.7 只剩各自的任务依赖；D-34（logo）仍挡住 BRAND.4 ②。
6. D-30（E7，微信后台核对）挡住 BRAND.5、P5.2；D-31 已定（A），E8（fork 与令牌权限）还没做，P4.3 只在本地写。D-40 已定（A，请律师审 LEGAL.2、LEGAL.4），LEGAL 组仍等 D-37。
7. D-37（董事会同意）挡住 LEGAL.1–LEGAL.3；D-28（轮值伙伴）挡住 LEGAL.6 与 P5；D-36 已按 D-43 代定 D（延后），BRAND.6 等内测之后，P5.1 前 Eric 要重新答复。
8. E6（官方账号 profile id）在 P3.5 与 P4.9 前需要；D-32、D-33、D-38、D-39、D-40 的截止任务见 [DECISIONS.md](DECISIONS.md)。
