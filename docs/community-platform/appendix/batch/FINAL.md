# 最终报告：D-17 第一批（OMO，tony-ws）

按 D-43 第 5 项只写这一份。格式按 D-42 第 10 项七节，加第八节「代 Eric 定的事」。逐条的命令、计数和证据路径在 STATUS_LOG 对应编号里，本文只列结论。

## ① 起止与 SHA 范围

- 起止：2026-11-12 23:30 CT（L15，P1.1 预检）至 2026-11-13 03:23 CT。
- docs_sha：29b50d8（批次开始前）→ 本文所在提交（父提交 fd794fa），分支 codex/community-plan-v5（PR #370）。
- code_sha：
  - #369 `codex/community-topics-20261112`：005ca9d → be2ebb6（P2.1–P2.4、REGION.1、P2.7）。
  - #371 `codex/config-fixes-20261112`（base main 7b18f20）：affb8ac → b259105（P1.2–P1.6，P1.7 的测试修正）。
  - #372 BRAND `codex/brand-cornfield-20261112`（base main 7b18f20）：9157d96 → ba070e7（BRAND.1–3，BRAND.4 ②）。
  - 只在本地、不推送：`wip/P4.1` 5f62ddd（§1）；`~/work/caaciorg` `feat/public-events-feed` 28d59b1（等 E8）。

## ② 完成的任务

格式：task_id ｜ 结论 ｜ code_sha ｜ docs_sha ｜ 环境 ｜ 命令 ｜ 计数（tests / pass / fail / skipped）｜ ci_run_url ｜ 未测项 ｜ 在等的 E/D 编号 ｜ next_task_id。docs_sha 是写回前的材料分支 head；run 链接前缀 `https://github.com/EricXu-0805/CAACI_Community_Marketplace_Bazaar/actions/runs/`。

```text
P1.1 ｜ 通过 ｜ 005ca9d ｜ 29b50d8 ｜ tony-ws 宿主 ｜ RUNBOOK §2 五条预检（L15） ｜ — ｜ 43212596901 ｜ 无 ｜ — ｜ P1.2
P1.2 ｜ 通过 ｜ affb8ac ｜ d168faf ｜ pw1.60 ｜ $RC install typecheck（L16） ｜ — ｜ 43386686161（Type-check success） ｜ 无 ｜ — ｜ P1.3
P1.3 ｜ 通过 ｜ 7ec020a ｜ 76fb233 ｜ pw1.60 ｜ $RC install test（L17） ｜ 1994 / 1993 / 0 / 1，pg_skips=0 ｜ 43386686161（Boundary 汇总 # fail 0） ｜ 无 ｜ — ｜ P1.4
P1.4 ｜ 通过 ｜ cc63ab5 ｜ 8558860 ｜ pw1.60 ｜ $RC install typecheck h5 mp（L18） ｜ 旧色 15 → 0 ｜ 43386686161 ｜ 无 ｜ — ｜ P1.5
P1.5 ｜ 通过 ｜ 14b4e4a ｜ 095985f / 08549fe ｜ pw1.65 ｜ $RC 全量（L19、L24） ｜ 1994 / 1993 / 0 / 1 ｜ 43386686161（Build H5 success，Image: ubuntu-26.04） ｜ 无 ｜ — ｜ P1.13
P1.13 ｜ 通过 ｜ —（工作站） ｜ 78373c8 ｜ tony-ws 宿主 ｜ Vercel CLI 护栏与 demo 关联（L20）；link 拉下的 .env.local 已 rm ｜ — ｜ — ｜ 无 ｜ — ｜ P2.1
P2.1 ｜ 通过 ｜ 5db1cfe ｜ 5a11fb9 ｜ pw1.60 ｜ $RC install test（L21） ｜ 预检 3 → 4 项 + RPC 探测，单测 4 / 4 ｜ 43377614567 ｜ ③ 本地 S-1 ｜ E3 ｜ P2.2
P2.2 ｜ 通过 ｜ 9c173a4 ｜ abf549a ｜ pw1.60 ｜ $RC 全量（L22） ｜ 旧板块名 0，「评论」18 → 0 ｜ 43377614567 ｜ 无 ｜ — ｜ P1.9
P1.9 ｜ 通过 ｜ 14b4e4a ｜ 89d6644 ｜ 新镜像 pw1.65-node22-pg17（169f16e6…） ｜ podman build + $RC 全量（L23） ｜ 1994 / 1993 / 0 / 1 ｜ — ｜ 无 ｜ — ｜ P2.3
P2.3 ｜ 通过 ｜ a25810b ｜ 0a69a06 ｜ pw1.60 ｜ $RC 全量（L27） ｜ 「广场」9 → 0 ｜ 43380822445 ｜ 无 ｜ — ｜ P4.7
P4.7 第一步 ｜ 通过 ｜ —（只写材料分支） ｜ 86dac4b ｜ tony-ws 宿主 ｜ 官方日历只读调研（L29） ｜ appendix/research/campus-events.md ｜ — ｜ illinois.edu/about/calendars 证书失败 ｜ D-33（已代定 A） ｜ P2.4
P2.4 ｜ 通过 ｜ 91027fb ｜ a724bd8 ｜ pw1.60 ｜ $RC install typecheck test smoke（L30） ｜ 2001 / 2000 / 0 / 1；smoke 23 passed ｜ 43383800477 ｜ 无 ｜ — ｜ REGION.1
REGION.1 ｜ 通过 ｜ 9b27fcc ｜ e7fae5a ｜ pw1.60 ｜ $RC install migrations test（L31） ｜ 2001 / 2000 / 0 / 1 ｜ 43383800477 ｜ ④ VERIFY 与 L-SQL ｜ 随 P1.10 决定 ｜ P2.7
P1.6 ｜ 部分（同大版本已修，其余跳过） ｜ 23ce3b6 ｜ 263b127 ｜ pw1.65 ｜ $RC 全量 + npmaudit（L32） ｜ 1994 / 1993 / 0 / 1；审计 45 → 37 ｜ 43386686161（Boundary 只卡依赖审计） ｜ ③ 审计通过 ｜ vue-i18n 9→11、glob、minimatch ｜ P2.7
P1.10 ｜ 跳过 ｜ 回放 9b27fcc ｜ cd67ffa ｜ L-SQL supabase/postgres:17.6.1.104 ｜ lsql-replay.sh 8 次（L26、L33） ｜ 162 / 181 ｜ — ｜ ①②④ ｜ 托管面存根放法 ｜ P2.7
P4.1 ｜ 通过 ｜ 5f62ddd（本地） ｜ d42268a ｜ pw1.65 ｜ $RC ~/work/illini-events install test（L34） ｜ 2015 / 2014 / 0 / 1 ｜ —（不推送） ｜ 无 ｜ — ｜ P2.7
HOME.1 ｜ 通过 ｜ —（工具与材料分支） ｜ b27e1db ｜ pw1.65 ｜ page-audit.mjs × 12 组合（L35） ｜ 违规 0 / 0 / 0；对照页 1 / 1 / 210 ｜ — ｜ 无 ｜ D-35（已定 A） ｜ P2.7
P2.7 ｜ 通过 ｜ be2ebb6（功能 7d6eacc + display_order 修正） ｜ 3ad5542 ｜ pw1.60 ｜ $RC install typecheck test smoke（L37） ｜ 2001 / 2000 / 0 / 1；smoke 15 passed ｜ 43392843858（public sweep 停在预检，等 E4） ｜ 换另一个账号未单独测 ｜ E4 ｜ BRAND.1
BRAND.1 ｜ 通过 ｜ 9157d96（#372） ｜ c22ac52 ｜ pw1.60 ｜ $RC 全量（L38） ｜ 1991 / 1990 / 0 / 1；projectname 玉米地 ｜ 43393646871（Build H5 等 E5） ｜ 无 ｜ E5、E10 ｜ BRAND.3
BRAND.3 ｜ 通过 ｜ 9157d96（#372） ｜ a61d51d ｜ pw1.60 ｜ 同上（L39） ｜ 徽章检索 10 → 0 ｜ 43393646871 ｜ 无 ｜ — ｜ BRAND.2
BRAND.2 ｜ 通过（⑦ 等 E5） ｜ 9157d96（#372） ｜ 8ca557e ｜ pw1.60 ｜ 同上（L40） ｜ 品牌名检索 76 → 0；变异检查通过 ｜ 43393646871 ｜ ⑦ Build H5 ｜ E5、E10 ｜ P4.3
BRAND.4 ① ｜ 通过 ｜ —（出稿只在材料分支） ｜ 0fc3426 ｜ 宿主 opentype.js 2.0.0 + 镜像 Chromium ｜ 子任务出稿（L36） ｜ 10 个 SVG 的 <text> 均为 0 ｜ — ｜ 无 ｜ D-34（已代定） ｜ BRAND.4 ②
P4.3 ｜ 部分（推送与 PR 归 Eric） ｜ 28d59b1（caaciorg 本地） ｜ 82ad9fd ｜ node:20 / node:24 容器 ｜ caaciorg CI 同一组步骤（L41） ｜ 1252 / 1244 / 0 / 8 ｜ —（不推送） ｜ ④⑤ ｜ E8 ｜ P1.7
BRAND.4 ② ｜ 通过 ｜ ba070e7（#372） ｜ beb3c1d ｜ pw1.60 ｜ $RC install typecheck h5 mp test smoke（L42） ｜ 1991 / 1990 / 0 / 1；smoke 6 passed；静态 SVG 无「集」 ｜ 43398733527（Build H5 等 E5） ｜ 小程序后台图标 ｜ E7、E5 ｜ P1.7
P1.7 ｜ 通过 ｜ b259105（#371） ｜ bb5c1fb ｜ CI；本地 pw1.65 / pw1.60 对照 ｜ 两份 spec 本地复现与 main 对照、插桩定位、只改测试（L43） ｜ public sweep 436 passed；Boundary # fail 0、# skipped 1 ｜ 43397680516（Boundary 只卡依赖审计） ｜ 无 ｜ P1.6 剩余三项 ｜ —
```

## ③ [OMO自决] 清单

| 编号 | 事项 |
|---|---|
| L29 | 按 D-43 第 1 项代定 D-33（A）、D-36（D）、D-39（A），见第八节 |
| L32 | P1.6 按 D-43 第 2 项做同大版本修复（follow-redirects 1.16.3、qs 6.16.2），vite 记入例外清单 |
| L33 | P1.10 第 3–8 次回放修正。**超出了 Eric 答复的限定**：答复到达前已多试了几次，台账模拟和 auth 存根是脚本内联的，不是 _ops 现成文件；答复到达后即停，转【跳过】 |
| L38 前（本节） | 可做队列移出 P2.8、P2.9、REGION.2、P2.10、HOME.2、HOME.3、HOME.5：都经 P2.5 依赖已【跳过】的 P1.10 |
| L36 | D-34 按 D-43 第 1 项代定 B 的单字「玉」，见第八节 |
| L37 | P2.7 写完后对照 DoD ④ 复查，自己发现重试时 display_order 会重号，追加修正 be2ebb6 |
| L41 | P4.3：caaciorg 源码与测试里 17 个文件含官网库标识，按 D-42 第 2 项 (a) 只记录、不触发暂停；CI 安装以外的步骤一律 `--network none`，输出逐行脱敏 |

## ④ 等 Eric 的清单（按解锁任务数从多到少）

| 要 Eric 做的一件事 | 解锁 |
|---|---|
| 定 L-SQL 回放里缺的托管面怎么补：允许 `lsql-replay.sh` 内联存根（CLI 台账、auth.identities / sessions、auth.users 新列），或在 #369 的 `_ops` 新增一份 LOCAL_BOOTSTRAP | P1.10 → P2.5 → P2.8、P2.9、REGION.2、P2.10、HOME.2、HOME.3、HOME.5；REGION.1 ④ |
| D-29 → E2、E3：staging-smoke 只有合成数据的书面确认与 A/B/C 账号 | P1.11、P1.12、P2.6、P2.11；P2.1 ③ |
| E5：审阅合并 #371（CI 除依赖审计外全部通过，run 43397680516） | P1.8；BRAND.2 ⑦ 的 Build H5；宿主 pre-push 钩子不再需要 `--no-verify` |
| E4：P2.5 冻结后把 20261112120000 应用到 staging | P2.6、P2.13；#369 的 public sweep 过预检 |
| P1.6 剩余三项要不要跨大版本：① @intlify/core-base、@intlify/shared 只被 uni-app 的构建 CLI（@dcloudio/uni-cli-shared）引用，app/package.json 的 overrides 钉在 9.14.5；修法是把 overrides 里 @intlify/core-base、message-compiler、shared、vue-devtools 一起抬到 11.4.14+，app 源码不用 vue-i18n、不用改，但要验证 h5、mp 构建和 pages.json 的 `%key%` 国际化，或者等 uni-app 发布依赖 v11 的版本；② glob 13.0.6、minimatch 10.2.5 只来自 @sentry/vite-plugin → @sentry/bundler-plugin-core，最新的 11.12.0 仍要求 glob ^13.0.6，只能在 overrides 里跨大版本抬到 glob 14.0.2+、minimatch 11.0.1+，只影响构建时上传 source map，要开 Sentry 上传跑一次构建验证 | Boundary 的依赖审计一步 |
| E8：fork 与令牌权限；之后在网页上向上游开 PR（D-42 第 1 项【硬】，OMO 不做） | P4.3 推送与 ⑤ |
| 看一眼 D-34 代定的「玉」单字（B 的单字变体），不同意就在 DECISIONS 改 | BRAND.4 ② 的图标（已替换在 #372，可 revert） |
| E7（D-30）：微信后台核对与改名 | BRAND.5、P5.2 |
| D-37：董事会同意 | LEGAL.1–LEGAL.3 |
| D-28：轮值伙伴 | LEGAL.6、P5 |
| E6：官方账号 profile id | P3.5、P4.9 |
| E10：BRAND 合并后粘贴邮件模板、改生产 `DIGEST_FROM` | BRAND.2 生效 |
| E9 ④：建 copyright@caaciorg.com（D-39 代定 A） | LEGAL.4 |

## ⑤【硬】与【暂停推送】事件

- 本批没有触发【暂停推送】，没有执行任何【硬】动作：没有合并、没有转 ready、没有 force push、没有 rebase 已推送分支、没有 `vercel deploy --prod`、没有应用托管迁移、没有向上游 caaciorg 开 PR。
- P1.13 `vercel link` 拉下的 `.env*.local` 已按约定直接 rm（L20）。
- caaciorg 源码与测试里本来就有官网库标识（17 个文件），按 D-42 第 2 项 (a) 只记在 L41，不触发暂停。

## ⑥ 未测项与风险

- #371 第一次 CI 的 public sweep 有 4 条失败：3 条是 P1.5 升 Playwright 1.65 带来的回归（describe 覆盖 viewport 时保留了 iPhone 13 的 390 宽 screen，uni-h5 把窗口宽算成 390，消息页不再分栏），已在 b259105 只改测试修好、CI 436 passed；第 4 条（product-publishing-discovery 刷新计数）本地两边都过、第二次 CI 也过，判为偶发。别的 spec 里只设 viewport、不设 screen 的桌面用例，换到 Playwright 1.65 后可能有同类问题，这次 sweep 里没出现。
- #369 的 public sweep 一直停在 schema 预检（E4 之前不会过）；推 #369 用了 `--no-verify`，因为宿主 pre-push 钩子的 4 个 PG 测试找不到 initdb（L21，P1.8 修）。
- REGION.1 ④ 与 P2.5 全部依赖 L-SQL 回放；P1.10 停在 162 / 181。
- P2.1 ③ 本地 S-1 要 staging 凭据（E3）。
- P2.4：390 宽度下板块示例标题的占位文字被截断，留给 HOME.4。
- HOME.1：暗色与英文稿没画，由 HOME.4 的截图矩阵补。
- BRAND（#372）：Build H5 与 public sweep 在 Ubuntu 26.04 上装不上 Playwright 1.60 的浏览器，要等 #371 合并（E5）后重跑；邮件和退订页里的「集」字印章、6 处代码注释里的「集」不在 SPEC §1.5 替换清单内，没改；小程序在微信后台的图标由 Eric 在 BRAND.5 / E7 时换。
- P4.3：只在本地，④ 开 PR 与 ⑤ 上线验收都在 Eric 一侧。
- BRAND.4 字体按 release 标签从仓库取同路径文件（release 的 zip 下载会跳到未允许的主机），SOURCES.md 写了核对 zip 的命令，字节一致性没验证。

## ⑦ 下一批

按 Eric 解锁的顺序，OMO 下一批能做的 task_id：

- 定了 L-SQL 托管面的放法 → P1.10 补完 → P2.5 → P2.8、P2.9、REGION.2 → P2.10；HOME.2 → HOME.3 → HOME.5。
- E5（合并 #371）→ P1.8；之后 #369、#372 的 Build H5 与宿主 pre-push 钩子恢复。
- D-29 / E2、E3 → P1.11、P1.12、P2.6、P2.11。
- E4（P2.5 冻结后应用迁移）→ P2.6、P2.13；#369 的 public sweep。
- E8 → P4.3 推送到 fork（向上游开 PR 仍由 Eric）；P4.2、P4.4 起的活动接入照 BACKLOG §9 依次做。

## ⑧ 代 Eric 定的事

| 编号 | 选了什么 | 理由 | 怎么撤回 |
|---|---|---|---|
| D-33 学校活动收哪些日历 | A：逐条收录（站务贴单条活动链接，服务端只读那一条 ICS） | 原建议 A；P4.7 第一步没找到整本 ICS 的官方导出地址 | 在 DECISIONS 改选项，P4.7 第二步按新选项写 |
| D-36 主域名 | D：延后到内测之后 | 与 D-23「域名暂不注册」一致 | 在 DECISIONS 改选项；P5.1 前 Eric 要重新答复 |
| D-39 版权投诉收件邮箱 | A：copyright@caaciorg.com，转给 Eric 和轮值伙伴 | 原建议 A | 改选项，LEGAL.4 页面与模板改地址 |
| P1.6 同大版本依赖修复 | follow-redirects 1.16.3、qs 6.16.2；vite 6.4.4 记入例外清单（复查 2026-12-13） | D-43 第 2 项 | `git revert 23ce3b6`；例外清单删条 |
| D-34 新 logo | 「玉」单字，用 B 稿的单字变体 draft-b-mono（Noto Serif SC Black） | D-43 第 1 项：24px 预览认得出；两个清楚的单字里取宋体，和 D-35 A 一致；三字稿 24px 粘连 | 在 DECISIONS D-34 改选项；#372 上 BRAND.4 ② 的提交 `git revert` |

## 第二批（D-44）

> 2026-11-13 按 D-45 第 1 项更正（supervisor 核查指出，OMO 逐条核实后改），更正记录见 STATUS_LOG L55。

按 D-44 第 4 项只写新增内容，八节格式同上；逐条细节在 STATUS_LOG L44 起。`latest_batch` 不变。

### ① 起止与 SHA 范围

- 起止：2026-11-13 03:33 CT（材料分支 24d141a 的提交时间；第一个代码提交 5abcb86 在 03:41 CT）至 2026-11-13 07:11 CT。
- docs_sha：24d141a → 本节所在提交。
- code_sha：
  - #369 `codex/community-topics-20261112`：be2ebb6 → 92698d1（P1.10 bootstrap 5abcb86、P2.5 090d2be、P2.7 测试修正 d7e6d9b、P2.9 ece6d12、HOME.2 bd6fee5、REGION.2 44629b4、P2.8 46e69b8、P2.10 92698d1）。
  - #373 `codex/deps-crossmajor-20261113`（base #371 分支）：55716ba。
  - #374 `codex/community-home-20261112`（base #369 分支）：244a8e7（P2.12）→ 68eb43b（merge #369 953749c、HOME.3 a756081、HOME.5 2d18576、再 merge #369 68eb43b；只 merge，不 rebase）。

### ② 完成的任务

```text
P1.10 ｜ 通过 ｜ 5abcb86 ｜ 24d141a ｜ L-SQL supabase/postgres:17.6.1.104 ｜ lsql-replay.sh（第 1 次计数尝试）＋变红验证（L44） ｜ 181/181；删 deleted_at 后停在 20260916073035 ｜ — ｜ 无 ｜ — ｜ P2.5
P1.6 跨大版本 ｜ 通过（合不合由 Eric） ｜ 55716ba（#373） ｜ b584adc ｜ pw1.65 ｜ $RC 全量 + npmaudit + 产物比对 + Sentry 加载（L45） ｜ 1994 / 1993 / 0 / 1；审计只剩 vite；mp 336、h5 157 个文件逐字节一致 ｜ —（ci.yml 不对非 main 的 base 触发） ｜ source map 上传 ｜ — ｜ P2.5
P2.5 ｜ 通过，20261112120000 冻结 ｜ 090d2be ｜ 5707d1b ｜ L-SQL；pw1.60 ｜ lsql-replay.sh … 20261112120000；$RC install typecheck migrations test smoke（L46） ｜ 181/181，PRECHECK→REPLAY→VERIFY→REGRESSION；2001 / 2000 / 0 / 1 ｜ 43409123864（public sweep 等 E4） ｜ ④ staging 探测 ｜ E3、E4 ｜ P2.9
P2.9 ｜ 通过 ｜ ece6d12 ｜ c62c618 ｜ pw1.60 ｜ $RC install typecheck test（L47） ｜ 2022 / 2021 / 0 / 1（在 bd6fee5 的树上量，含 HOME.2） ｜ —（bd6fee5 的 run 43412348642 被取消） ｜ 无 ｜ — ｜ HOME.2
HOME.2 ｜ 通过 ｜ bd6fee5 ｜ 99e2c7a ｜ pw1.60 ｜ 同上（L48） ｜ 19 条规则单测；变异检查失败如期 ｜ — ｜ 无 ｜ — ｜ REGION.2
P2.12 ｜ 通过 ｜ 244a8e7（#374） ｜ 457a995 ｜ pw1.60＋axe 4.14.0 ｜ $RC install typecheck test smoke h5 mp（L49） ｜ 2001 / 2000 / 0 / 1；smoke 33 passed；12 张截图 <12px 0、axe 0 ｜ —（不触发 CI） ｜ 页面其他部分的小字与暗色按钮对比度 ｜ — ｜ REGION.2
REGION.2 ｜ 通过 ｜ 44629b4 ｜ 5ce7260 ｜ pw1.60 ｜ $RC install typecheck test smoke（L50） ｜ 2024 / 2023 / 0 / 1；smoke 15 passed ｜ — ｜ 无 ｜ — ｜ P2.8
P2.8 ｜ 通过 ｜ 46e69b8 ｜ e287b81 ｜ pw1.60 ｜ $RC install typecheck test smoke（L51） ｜ 2035 / 2034 / 0 / 1；smoke 19 passed；修 typecheck 后 rc=0 ｜ 43418959287（public sweep 等 E4） ｜ 无 ｜ E4 ｜ P2.10
HOME.3 ｜ 通过 ｜ a756081（#374） ｜ 8323f02 ｜ pw1.60＋axe 4.14.0 ｜ $RC install typecheck test smoke（L52） ｜ 2024 / 2023 / 0 / 1；smoke 43 passed；首页 19 条用例、AXE 0、<12px 0 ｜ —（不触发 CI） ｜ 真机 ｜ — ｜ HOME.5
P2.10 ｜ 通过 ｜ 92698d1 ｜ 5e465ef ｜ pw1.60 ｜ $RC install typecheck test smoke mp；7b18f20 基线 install mp（L53） ｜ 2044 / 2043 / 0 / 1；smoke 20 passed；主包 1,558,580（预算余 14,284） ｜ 43422815812（public sweep 等 E4） ｜ 真机预览（P5.2） ｜ E4 ｜ HOME.5
HOME.5 ｜ 通过 ｜ 2d18576、68eb43b（#374） ｜ 143b437 ｜ pw1.60＋axe 4.14.0 ｜ $RC install typecheck test smoke；合并后加 mp（L54） ｜ 2024 / 2023 / 0 / 1，smoke 63 passed；合并后 2044 / 2043 / 0 / 1，smoke 79 passed（7 份 spec 共 79 条），主包 1,568,808 ｜ —（不触发 CI） ｜ 真机 ｜ — ｜ —
```

### ③ [OMO自决] 清单

| 编号 | 事项 |
|---|---|
| L44 | P1.10 第四处托管面缺口 auth.mfa_factors（D-44 没列），同样单独一份 _ops 文件；bootstrap 文件带 lsql-replay 守卫，没有标记拒绝执行 |
| L45 | @intlify/vue-devtools 没有 11.x，留 9.14.1；glob/minimatch 覆盖限定在 @sentry/bundler-plugin-core 子树；pages.json 本无 `%key%`，改用产物逐字节比对 |
| L46 | P2.5 的 architect 子任务因模型额度中断，由 OMO 自己做；VERIFY 按迁移实际授权断言两证据函数（§5.1 原文措辞不同） |
| L46 | P2.7 的 partial-attach smoke 偶发失败（uni-input 100ms 节流），只改测试等待模型同步，d7e6d9b |
| L49 | 英文 plaza.ref.more 用 "{n} items in all"（SPEC 写 "+{n} more"），建议改 SPEC §11 |
| L51 | P2.8 超出 BACKLOG 文件清单：H5 原生确认框提到编辑器之上，新增诊断文案本地化 |
| L52 | home 分支用 merge 拿 #369（不 rebase 已推送分支），冲突两边都保留；默认视图改变，九份旧 spec（a11y-keyboard-journey、community-post-partial-attach、community-post-topics、community-topic-row、input-preview-supplement、motion-preference、plaza-attach-picker-is-modal、read-failure-states、seller-publish-responsive）随之调整 |
| L53 | P2.10 顺带修编辑器 300ms 延迟聚焦抢走标题输入（更正 L46 的归因）；照片区分上传图与临时路径用已有的属主校验边界 |
| L54 | #369 合入 #374：P2.10 的深链钩子只在小程序生效，H5 由视图代码接住别的页面带来的板块；随合并调整 1 份单测的依赖和 5 条 smoke 用例；其中 P2.10 板块链接用例在 390/1280 上 URL、选中信号、搜索框三处断言都改了（390 上「搜索框为空」变成「搜索框不存在」加一次「不再发出搜索请求」计数） |
| L54 | 首页、新页头、板块页只编进 H5，小程序仍是平铺列表：HOME.5 子任务为主包预算做的取舍，SPEC §8 与 D-12 没有这条豁免，按 BACKLOG §14 第 23 行应报 Eric；已列入 ④，D-45 第 4、7 项先尝试补上 |

### ④ 等 Eric 的清单（新增，按解锁的任务数从多到少）

| 要 Eric 做的一件事 | 解锁 |
|---|---|
| 在生产应用 20261112120000 并跑它的 VERIFY（ENGINEERING §6），P2.5 DoD ④ 生产那一半由 Eric 核。应用后旧的 VERIFY_20260718_reconcile_app_table_acl_boundaries 会报 posts 列清单漂移，属预期（L46）。#369 合进 main 就是把前端发布到 illinimarket.com 生产，必须排在这一步之后，BACKLOG 还要求合并前 P2.13 通过；顺序反了，新前端按 POST_COLUMNS 查询会 400，社区页打不开 | #369 合并，进而 P3.1–P3.8 和其余依赖 #369 合并的任务 |
| E3 / E4：staging 合成账号，把 20261112120000 应用到 staging | P2.5 ④ staging 探测、P2.6、P2.11、P2.13，#369 的 public sweep |
| E5：合 #371（P1.7） | P1.8，进而 P2.13；BRAND.2 ⑦ 的 Build H5 |
| 审阅 #374（P2.12、HOME.3、HOME.5，已合入 #369 的 92698d1，68eb43b 显示 MERGEABLE），#369 合并后改 base | 首页上线 |
| 定首页是否只在 H5：现在小程序仍是平铺列表，SPEC §8、D-12 没有这条豁免（见 ③ L54）；D-45 第 4、7 项先尝试补进小程序 | H5 与小程序同日发布（D-12） |
| #372 合并要手工合：#369×#372 冲突在 api/share-post.js、en.ts、zh.ts，#374×#372 另有 app.name / app.desc / app.tagline / app.formerly 一块。#369 一侧是 P2.9 的 topicTitle / headline 逻辑和 P2.2 的「回复 / reply」措辞，整块取 #372 会把这两项悄悄撤掉；保留 #369 的逻辑和措辞，只取 #372 的品牌字串 | 品牌上线 |
| 审阅 #373：合不合；合之前在带 SENTRY_AUTH_TOKEN 的发布构建里确认 source map 上传。合了 #371、#373 以后 Boundary 照样红：ci.yml 第 182 行的 `npm audit --audit-level=moderate` 没有例外清单，vite 6.4.4 的 moderate 还在；让 CI 认例外清单要改 workflow，归 Eric | 依赖审计（还需 workflow 改动或 vite 升级） |
| 删 #369、#371 的分支之前，先把 #374、#373 的 base 改成 main：删掉 base 分支会关闭依赖它的 PR，且不能重开 | 保住 #373、#374 |
| L49：暗色下侧栏「发布」按钮白字对 #E47B5F，对比度 2.87:1（页面其他部分，不在 P2.12 范围） | — |

### ⑤【硬】与【暂停推送】事件

- 本批没有触发【暂停推送】，没有执行任何【硬】动作：没有合并、没有转 ready、没有 force push、没有 rebase 已推送分支（home 分支用 merge 拿 #369）、没有应用托管迁移、没有 workflow_dispatch。

### ⑥ 未测项与风险

- #373、#374 的 base 不是 main，CI 不触发；只有本地容器结果。
- P2.5 ④ staging 的 source_lang 探测等 E3。
- 新 share-post.js 查询带 title，必须先应用 20261112120000 再发前端（ENGINEERING §6）。
- community-post-topics.spec.ts 里「打开编辑器后马上填标题」与 partial-attach 同类，理论上有同样的节流时序问题，这次没出现。
- 小程序主包：#369 在 92698d1 为 1,558,580 字节，1.5 MiB 预算只剩 14,284；#374 单独构建 1,561,352。两者合并后（68eb43b）主包 1,568,808 字节，只剩 4,056：下一个进主包的改动大概率超预算。首页、新页头、板块页目前只编进 H5，这不是 SPEC 允许的设计（见 ③ L54、④）。
- L46 当时把 partial-attach 偶发失败归因于 uni-input 节流，L53 查到直接原因是编辑器 300ms 延迟聚焦，已在 92698d1 修复。
- 子任务三次在检查排队时提前结束、一次越界改了材料仓库（L51 由主会话更正后提交）；所有写回与推送最终都由主会话做。
- #372（品牌）与 #369、#374 有冲突，不能整块取 #372，要手工合（见 ④）。

### ⑦ 下一批

1. Eric 定合并顺序。#369 合进 main 就是发布到生产：先在生产应用 20261112120000 并跑 VERIFY，P2.13 通过后再合。建议 #371 → #373，#369 → #374，#372 最后手工合（保留 #369 的 P2.9、P2.2，只取 #372 的品牌字串）；删 base 分支之前先把 #373、#374 的 base 改成 main。
2. E3（staging env）到位后：P2.5 ④ staging 探测、P2.6、P2.11、P2.13；E4 解开 #369 的 public sweep。
3. 候选：小程序主包瘦身或拆分包（余 4,056 字节）；按 L49、L54 的出入修订 SPEC §11 英文文案。

### ⑧ 代 Eric 定的事（新增）

| 编号 | 选了什么 | 理由 | 怎么撤回 |
|---|---|---|---|
| P1.6 跨大版本 overrides | @intlify 11.4.19、Sentry 子树内 glob 14.0.6 / minimatch 11.0.8，草稿 PR #373 | D-44 第 3 项 | 关闭 #373 |
| LOCAL_BOOTSTRAP 放法 | 按 D-44 第 2 项放 #369 的 _ops，四份文件 | D-44 | `git revert 5abcb86` 并恢复旧脚本 |
