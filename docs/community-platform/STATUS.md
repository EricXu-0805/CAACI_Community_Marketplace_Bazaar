# STATUS

写于 2026-11-12 23:25 CT · 作者：V5 编写会话（Claude，Eric 的 Mac）。OMO 每完成一个任务改写本文件，并在 [STATUS_LOG.md](STATUS_LOG.md) 末尾追加一条。证据标签定义见 [README.md](README.md#证据标签)。

`next_task_id: P1.1`

## 版本

| 项 | 值 |
|---|---|
| 代码分支 / PR | codex/community-topics-20261112 / #369（草稿，OPEN）[源码 005ca9d] |
| code_sha | 005ca9d6b5ac23346dfeb38f3deb95984bffd27b（2026-11-12 git ls-remote） |
| 基线 main | 7b18f2052e52a4268c25407d0584748477cbf978（2026-11-12 git ls-remote） |
| 材料分支 / PR | codex/community-plan-v5 / #370（草稿，OPEN，不合并）[本地测：2026-11-12 git ls-remote] |
| docs_sha | 617055e7e573e53c40b73c25b2153a3b00d07e5f（写本版 STATUS 之前材料分支的 HEAD，取法见 RUNBOOK §8） |
| 配置 / 品牌 / 首页分支 | 都还没建（P1.2 / BRAND.1 / HOME.3） |
| tony-ws 仓库 | ~/work/illini 在 005ca9d；~/work/illini-docs 在 4e459bd（V4 材料分支），P1.1 ④ 切到 codex/community-plan-v5 [本地测] |
| 公开 demo | https://illini-community-demo.vercel.app/ 返回 200，内容仍是 V4 原型 [生产：2026-11-12 curl] |
| 小程序 | wxc3da81aa8852a6ff「香槟市集」，开发版 2026-10-26 上传，未提审 [真人：Eric 记录] |

## CI

PR #369 · run [43212596901](https://github.com/EricXu-0805/CAACI_Community_Marketplace_Bazaar/actions/runs/43212596901) · head 005ca9d · 2026-11-12 06:21 CT 结束 · conclusion failure [CI run#43212596901]

| job | 结论 | 计数 / 原因 |
|---|---|---|
| Type-check | success | |
| Boundary regressions | success | 1997 tests：1996 pass / 0 fail / 1 skipped |
| Build H5 | success | |
| Build mp-weixin | success | |
| Smoke (public page sweep) | failure | 437 passed / 2 failed / 6 skipped；pages/plaza/index 浅色、深色各一次 400「[plaza] fetch posts failed」。staging-smoke（hygkwxugskijadgfisji）没有应用 20261112120000 |
| Smoke (protected staging account) | skipped | |
| Production release readiness | skipped | |

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
| P1.1 | 未测 | 环境 2026-11-12 已搭好（L03），OMO 还没按 DoD 六项复核 |
| P1.2–P1.5 | 未测 | 基线：packageManager npm@10.8.2；写死 PG 路径的测试文件 33 个（7b18f20 上 32 个）；uni.scss:16 #C74A2F；@playwright/test ^1.60.0 [源码 005ca9d] |
| P1.7、P1.9、P1.10、P1.13 | 未测 | P1.7、P1.9、P1.10 依赖 P1.2–P1.5；P1.13 只依赖 P1.1 |
| P1.6 / P1.8 / P1.11、P1.12 | 未测 | 分别等 D-41 / E5（合并 P1.7 的 PR）/ D-29（E2）与 E3 |
| P2.1 | 未测 | verify-public-read-schema.mjs:20 对 posts 只查 id,item:items(id,listing_details) [源码 005ca9d] |
| P2.2–P2.4 | 未测 | zh.ts:894-898 仍是旧板块名；tabBar 首页/广场/发布/消息/我的；composerMode 默认 'update'（plaza/index.vue:946）[源码 005ca9d] |
| P2.5、REGION.1 | 未测 | 迁移 20261112120000 未应用到任何托管库，没有 lock_timeout，_ops 下缺 PRECHECK/VERIFY/REGRESSION，没有 region 列 [源码 005ca9d] |
| P2.6 | 失败 | public sweep 2 failed（上表）；等 D-29、E4 |
| P2.7–P2.13、REGION.2 | 未测 | 依赖 P2.4 / P2.5 / P2.6 |
| BRAND.1–BRAND.3 | 未测 | 基线计数写在 BACKLOG 各自 DoD |
| BRAND.4–BRAND.7 | 未测 | 等 D-34、D-30（E7）、D-36、D-35 |
| HOME.1 | 未测 | ①–③ 由 design/direction-{a,b,c}.html 与 design/screenshots/ 满足（2026-11-12 14:18 CT，L08），以 design/ 为准，不另做；④ 只跑过脚本对比度，axe 未跑；⑤ 等待 D-35 |
| HOME.2、HOME.3、HOME.5 | 未测 | 依赖 P2.5、REGION.1 |
| HOME.4、P2.12 | 未测 | 等 D-35 |
| P3.1–P3.8 | 未测 | 依赖 P2.13（#369 合并） |
| P4.1–P4.11 | 未测 | P4.1 依赖 P1.9；P4.3 可在本地写，推送等 D-31（E8）；P4.5 真实数据等 D-32；P4.7 第二步等 D-33 |
| LEGAL.1–LEGAL.6 | 未测 | 等 D-37、D-38、D-39、D-40、D-28 |
| CONTENT.1–CONTENT.6、P5.1–P8.1 | 未测 | 依赖 LEGAL 与 P5.2 |

## 阻塞与等待 Eric

1. D-29 → E2、E3：staging-smoke 只有合成数据的书面确认与 A/B/C 账号。挡住 P1.11、P1.12、P2.6、P2.11。
2. E4：P2.5 在 STATUS_LOG 写出「20261112120000 冻结」后，Eric 把迁移应用到 hygkwxugskijadgfisji。挡住 P2.6、P2.13。
3. D-41：依赖审计修复范围。未定前 P1.6 跳过，P1.7 先开草稿 PR。
4. E5：合并 P1.7 的 PR。挡住 P1.8，以及 BRAND.2 ⑦ 的 Build H5。
5. D-35（视觉）挡住 HOME.4、P2.12、BRAND.7；D-34（logo）挡住 BRAND.4 ②。
6. D-30（E7，微信后台核对）挡住 BRAND.5、P5.2；D-31（E8，fork 权限）挡住 P4.3。
7. D-37（董事会同意）挡住 LEGAL.1–LEGAL.3；D-28（轮值伙伴）挡住 LEGAL.6 与 P5；D-36（域名）挡住 BRAND.6、P5.1。
8. E6（官方账号 profile id）在 P3.5 与 P4.9 前需要；D-32、D-33、D-38、D-39、D-40 的截止任务见 [DECISIONS.md](DECISIONS.md)。
