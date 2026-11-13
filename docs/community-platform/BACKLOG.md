# BACKLOG：玉米地（Cornfield）编号任务

V5，2026-11-12（America/Chicago）。本文件只写每条任务做什么、改哪些文件、跑哪些命令、做到什么算完、证据放哪、怎么回退。其他内容各有归属：

- 当前做到哪一条、每条的结果、CI 数字：[STATUS.md](STATUS.md)
- 界面文案、术语表、页面规格：[SPEC.md](SPEC.md)
- 表结构、迁移内容、接口合同：[ENGINEERING.md](ENGINEERING.md)
- 在 tony-ws 上怎么执行（run-checks.sh 及其 S-1 探针步骤、lsql-replay.sh、Vercel 护栏、STOP 清单、E1–E14、回退）：[RUNBOOK.md](RUNBOOK.md)
- D-01 至 D-41、指标定义、负责人表：[DECISIONS.md](DECISIONS.md)

文中「Illini Market」只指现有代码、部署和改名任务本身。

---

## 0 用法与通用约定

### 0.1 取任务

1. 当前任务是 STATUS.md 的 `next_task_id`。
2. 做完一条，按 RUNBOOK §8 写回 STATUS_LOG 和 STATUS。然后按 §2 的顺序，取第一条同时满足三个条件的任务写进 `next_task_id`：依赖都已通过；需要的 D 编号都已 decided；不在等 Eric 的动作。
3. 依赖的 D 编号仍是 open：不替 Eric 选，跳过这条，在 STATUS 阻塞项写「等待 D-xx」（RUNBOOK STOP-15）。
4. DoD 某一项照原文做不到（命令报错、基线数字对不上）：不改 DoD，把实际输出记进 STATUS_LOG，按 §14 判断表处理。
5. 「停这条」：按 RUNBOOK §12 末尾的格式留言，不再做依赖它的任务，继续做不相关的任务。「全停」：所有工作停下，等 Eric 答复。
6. 本文件和 SPEC、ENGINEERING 对同一个标识写法不同时，以 SPEC §2 术语表为准；术语表里没有的，以 ENGINEERING 为准。两种情况都在 STATUS_LOG 记一条。

### 0.2 通用变量

下面的命令都假设已设好这几个变量：

```bash
RC=~/work/illini-dev-env/run-checks.sh                    # 用法与步骤见 RUNBOOK §4.2；S-1 探针用它的 probe 步骤（RUNBOOK §5.2）
LSQL=~/work/illini-dev-env/lsql-replay.sh                 # RUNBOOK §5.1
REPO=EricXu-0805/CAACI_Community_Marketplace_Bazaar
TS=$(date -u +%Y%m%dT%H%M%SZ)                             # 证据文件名用 UTC 时刻（RUNBOOK §1）
D=$(TZ=America/Chicago date +%Y%m%d)                      # 备份文件后缀用 CT 日期（RUNBOOK §1）
EV=~/work/evidence/<任务编号>; mkdir -p "$EV"              # probe 步骤只挂载 ~/work/evidence（RUNBOOK §3）
DOCS=~/work/illini-docs/docs/community-platform
DEF="community-post-topics.spec.ts plaza-attach-picker-is-modal.spec.ts"   # smoke 缺省的两个 spec
```

### 0.3 「通过」怎么判

- **test 通过**：`$RC <目录> test` 输出的 `TEST` 行是 `fail=0 skipped=1 pg_skips=0`，tests 不少于 STATUS 的基线，唯一的 SKIP 是 Vercel Build Output 那一行。规则全文见 RUNBOOK §6。
- **smoke 通过**：`SMOKE_SPECS="$DEF <本任务的 spec>" $RC <目录> smoke`，结果全部 passed，0 failed、0 flaky。本文件写「smoke：X」时，就是把 X 加进这个变量。spec 只写文件名，不带 `app/smoke/`。
- **全量**：`$RC <目录> install typecheck h5 h5accept mp migrations test smoke`，每个 `STEP` 都是 `rc=0`。
- **包体**：`$RC <目录> install mp`。mp 步骤最后用 `mp-size.mjs` 打印主包和各分包字节数（`packageBytes`）；`verify-miniprogram.mjs` 没有命令行入口，单独运行不做检查（RUNBOOK §4.3 ②）。
- **依赖审计**：`$RC <目录> install npmaudit`（npm 11，与 CI 一致）。
- **L-SQL**：`$LSQL <目录> [迁移时间戳 …]`，最后一行是 `files=N replayed=N errors=0 done=1 rc=0`（RUNBOOK §5.1）。
- **S-1**：先按 RUNBOOK §5.2「前提与自检」跑四条自检，再 `EV=$EV $RC <目录> install probe <探针文件>`。probe 步骤核对 staging.env 的权限和禁用词，在容器里先跑 `verify-public-read-schema.mjs`，再跑 `~/work/illini-dev-env/probes/` 里的探针（RUNBOOK §5.2）。
- **视觉验收**：SPEC §9.6 列的各项。仓库里没有 axe，加依赖会触发 STOP-8，所以分两层做：
  - 仓库内：HOME.3 新建 `app/smoke/visual-audit.ts`（不是 spec，不会被当成测试），由各视觉任务的 spec 调用。它统计 <12px 文本节点数（`.u-badge` 内数字除外）、390 宽横向溢出像素，对比度用 `contrast-runtime.spec.ts` 的同一算法。
  - 工作站：HOME.1 把 axe-core 装进 `~/work/illini-dev-env/tools/`。run-checks 会把 `~/work/illini-dev-env` 只读挂到 `/dev-env`，`visual-audit.ts` 在 `/dev-env/tools/node_modules/axe-core/axe.min.js` 存在时注入 axe，跑 color-contrast，并打印 `AXE color-contrast violations=<n>`。DoD 要求 smoke 日志里有这一行且 n=0。CI 上没有这个文件，axe 那一项不跑。
- 环境代号 L-SQL / L-UI / S-1 / S-2 / CI / 生产：每一层能证明什么、禁止什么，见 RUNBOOK §5。

### 0.4 证据

- 原始输出放 `$EV/<TS>-<短名>.<扩展名>`；run-checks（含 probe）、lsql 的日志由脚本写在 `~/work/illini-dev-env/logs/`。这些都留在 tony-ws，不提交。STATUS_LOG 只摘汇总行，写日志路径。
- 给 Eric 看的截图提交到材料分支 `appendix/visual/<任务编号>/`，命名 `<页面>-<宽>-<light|dark>-<zh|en>.png`。
- 每条结论只带一个 README 定义的证据标签：[源码 SHA] [本地测] [CI run#] [隔离环境 …] [生产] [真人]。
- 证据里不得出现：凭据、合成账号密码、access token、真实用户数据、外站内容原文。
- OMO 在 PR 上的评论第一行以 `[OMO]` 开头，规则见 RUNBOOK §7「PR 评论」。

### 0.5 默认回退（各任务只写例外）

1. 没推送的提交：留在本地任务分支，不推送，STATUS 记「已放弃」和原因。
2. 已推送的提交：`git revert <sha>`，然后普通 push。不 reset，不 force push，不 rebase。
3. 迁移：冻结之前可以直接改文件。冻结或已应用到托管库之后，只能另起新迁移（仓库根 RUNBOOK.md「Migration roll-forward」）。每个新迁移交给 Eric 应用之前都要冻结：STATUS_LOG 写「<文件名> 冻结」和它的 sha256。
4. tony-ws 上的用户配置文件，改之前先 `cp -p <文件> <文件>.before-<任务编号>-$D`，回退时拷回。
5. 其余对象（镜像、run-checks.sh、宿主机 npm、Vercel 护栏、staging、demo、生产、小程序）按 RUNBOOK §13。

---

## 1 分支与 PR 归属

建 worktree 的命令和目录见 RUNBOOK §3。下表定每个任务落在哪个分支：

| 分支 | 起点 | 装哪些任务 | PR | 谁合并 |
|---|---|---|---|---|
| `codex/config-fixes-20261112` | origin/main（7b18f20，或 STATUS 记的新 main） | P1.2–P1.6 | P1.7 开草稿 PR，base main | Eric（E5） |
| `codex/community-topics-20261112` | 已有，PR #369 | P1.8、P2.1–P2.11、REGION.1–2、HOME.2 | #369，保持草稿 | Eric |
| `codex/brand-cornfield-20261112` | origin/main | BRAND.1–3、BRAND.4 的替换、BRAND.6 的代码 | 草稿 PR，base main | Eric |
| `codex/community-home-20261112` | `codex/community-topics-20261112` | HOME.3–5、P2.12 | 草稿 PR，base 先设 #369 的分支；#369 合并后 `gh pr edit <号> --base main` | Eric，在 #369 之后 |
| `codex/community-p3-<YYYYMMDD>` | #369 合并后的 origin/main | P3.1–P3.8、LEGAL.2、LEGAL.4、LEGAL.5、P5.5 | 草稿 PR，base main | Eric |
| `codex/community-events-<YYYYMMDD>` | #369 合并后的 origin/main | P4.1、P4.2、P4.4–P4.10 | 草稿 PR，base main | Eric |
| `codex/community-plan-v5` | 4e459bd | STATUS、STATUS_LOG、DECISIONS 抄录、`appendix/env/`、`appendix/visual/`、`appendix/research/campus-events.md`、`appendix/prototype/`（BRAND.7） | 草稿 PR（E1） | 不合 main（D-14） |
| fork EricXu-0805/caaciorg 的 `feat/public-events-feed` | a2751012962/caaciorg 的 preview | P4.3 | 向上游 preview 提 PR | 官网维护者 |

几条规则：

- **#369 合并之前先写的代码**：P3、P4 的任务（P3.1 迁移草稿、P4.1 纯函数）放在本地分支 `wip/<任务编号>`，不推送。P3.1 的 wip 分支从 #369 的分支建，P4.1 的从 origin/main 建，目录用 RUNBOOK §3 的 `~/work/illini-p3`、`~/work/illini-events`。#369 合并后，在同一目录 `git merge origin/main`，再 `git branch -m codex/community-<p3|events>-<YYYYMMDD>`，然后推送。这些分支从没推送过，改名和合并不违反「不 rebase 已推送分支」。
- **同一文件两支都改**（最常见的是 `zh.ts`、`en.ts`、`pages.json`）：后合并的那一支执行 `git merge origin/main`。冲突的取法：品牌名和徽章文案取 BRAND 的写法，板块名和术语取 #369 的写法。解决后跑全量。
- **冲突落在迁移文件或 `manifest.sha256` 上**：停这条（§14 第 14 行）。
- 上表以外的分支一律不推（RUNBOOK STOP-6）。

---

## 2 执行顺序

D-17 定的是：V5 写完 OMO 就开工，先做不依赖视觉稿、也不等 Eric 的任务。E1 是 OMO 在 tony-ws 上读到 V5 文件的前提。

**第一批，不等 Eric**（每次取第一条依赖已满足的）：
P1.1 → P1.2 → P1.3 → P1.4 → P1.5 → P1.9 → P1.10 → P1.13 → P1.7（D-41 未定就跳过 P1.6，草稿 PR 照开）→ P2.1 → P2.2 → P2.3 → P2.4 → REGION.1 → P2.5 → P2.8 → P2.7 → P2.9 → REGION.2 → P2.10 → HOME.2 → BRAND.1 → BRAND.3 → BRAND.2 → HOME.1 → HOME.3 → HOME.5 → P4.1（wip）→ P4.3（只在本地写，推送等 D-31）→ P4.7 第一步 → BRAND.4 出稿。

P1.5 改完 lockfile 之后，那个 worktree 的 smoke 只能在 pw1.65 镜像里跑，所以 P1.5 的 ④⑤ 等 P1.9 做完再核对（RUNBOOK §4.3 ④）。

**等 Eric 的**：左栏一到位，就把右栏的任务插到队列最前面。

| Eric 的动作或决定 | 解锁的任务 |
|---|---|
| E1（提交并推送 V5 分支） | P1.1 ④，以及所有状态写回的推送 |
| E2 + E3（D-29、合成账号） | P1.11 → P1.12 |
| E4（应用冻结迁移） | P2.6 → P2.11 → P2.13 |
| E5（合并配置修正 PR） | P1.8 |
| D-41 | P1.6 |
| D-35（视觉方向） | P2.12、HOME.4 → BRAND.7 |
| D-34（logo） | BRAND.4 的替换 |
| D-31 / E8（caaciorg fork 权限） | P4.3 推送 |
| #369 合并 | P3.1 起的 P3 正式分支、P4.2 |
| D-37 / LEGAL.1 | LEGAL.2 → LEGAL.4 → LEGAL.5 |
| D-32、D-33 | P4.5 的真实数据、P4.7 第二步 |
| D-36 | BRAND.6 |

---

## 3 P1 环境与配置修正

P1 只动配置和工作站，不改产品行为。P1.2–P1.6 在配置分支上做，P1.8 再把它并回 #369。

### P1.1 工作站、仓库与登录状态核对（只读）

**目标**：确认 tony-ws 的 Node、gh、仓库、Vercel、测试镜像与 STATUS 记录一致，不一致就不开工。
依赖：无｜负责：OMO｜Eric：无（④ 要等 E1）｜目录：`~/work/illini`、`~/work/illini-docs`
**改动**：只把 `~/work/illini-docs` 切到 V5 分支。
**命令**：RUNBOOK §2 的开工核对整段，加 §2.1。输出 `tee $EV/$TS-preflight.txt`。
**DoD**：
- ① `node -v` 输出 v22.23.5。
- ② `gh auth status` 显示已登录 EricXu-0805。
- ③ `git -C ~/work/illini status --porcelain` 无输出，HEAD 等于 005ca9d6b5ac23346dfeb38f3deb95984bffd27b（或 STATUS 的 code_sha）。不等就全停（STOP-1）。
- ④ `git -C ~/work/illini-docs rev-parse --abbrev-ref @{u}` 输出 `origin/codex/community-plan-v5`。远端还没有这个分支时，STATUS_LOG 记「等待 E1」，其余几项照做。
- ⑤ `vercel whoami` 输出 ericxu-0805；`find ~/work -name .vercel -type d` 无输出。
- ⑥ `podman images` 里有 `localhost/illini-dev:pw1.60-node22-pg17`。

**证据**：`$EV/<TS>-preflight.txt`，删掉含 Token 的行后贴进 STATUS_LOG。标签 [本地测]
**回退**：只读，不需要回退。④ 切错时执行 `git -C ~/work/illini-docs switch codex/community-platform-v4-20261112`。

### P1.2 npm 版本声明对齐 CI（D-16）

**目标**：两份 package.json 声明的 npm 版本与 CI 实际用的一致；CI 上 npm 版本不对时失败。
依赖：P1.1｜负责：OMO｜Eric：无｜分支：`codex/config-fixes-20261112`（`~/work/illini-config`）
**改动**：
- 先装工具：按 RUNBOOK §4.3 ①② 换上新的 `run-checks.sh` 和 `mp-size.mjs`。旧脚本只挂载仓库目录，在 worktree 里跑 test 会失败，所以要在本任务开头装。
- `package.json` 与 `app/package.json` 的 `packageManager`。
- `.github/workflows/ci.yml`：Type-check job 在 Setup Node 之后加一步。
- 宿主机 npm：按 RUNBOOK §2.2 恢复为 Node 22.23.5 自带的版本。

**命令**：
```bash
git -C ~/work/illini fetch origin
git -C ~/work/illini worktree add -b codex/config-fixes-20261112 ~/work/illini-config origin/main
git -C ~/work/illini-config rev-parse HEAD
NPMV=$(gh run view 43212596901 --repo $REPO --log | grep -m1 -oE 'npm: ?10[.]9[.][0-9]+' | grep -oE '10[.]9[.][0-9]+')
echo "$NPMV" | tee $EV/$TS-ci-npm.txt
# 两份 package.json："packageManager": "npm@$NPMV"
# ci.yml Type-check job，Setup Node 之后新增：
#   - name: Toolchain versions
#     run: |
#       node -v; npm -v
#       case "$(npm -v)" in 10.9.*) ;; *) echo "::error::npm $(npm -v) is not 10.9.x"; exit 1;; esac
{ node -v; npm -v; } | tee $EV/$TS-host-toolchain.txt
$RC ~/work/illini-config install
git -C ~/work/illini-config diff origin/main --stat | tee $EV/$TS-diffstat.txt
```
**DoD**：
- ① worktree 的 HEAD 等于 7b18f2052e52a4268c25407d0584748477cbf978（或 STATUS 记录的新 main）。
- ② 两份 package.json 的 `packageManager` 都是 `npm@$NPMV`，`$NPMV` 以 10.9. 开头。
- ③ ci.yml 只多了上面这一步。
- ④ 宿主机 `npm -v` 输出 10.9.x。
- ⑤ install 步骤 `rc=0`。这一步自带 lockfile 前后 sha256 比对。
- ⑥ diffstat 只列 `package.json`、`app/package.json`、`.github/workflows/ci.yml` 三个文件。

**证据**：`$EV/<TS>-ci-npm.txt`、`<TS>-host-toolchain.txt`、`<TS>-diffstat.txt`，以及 install 日志。标签 [本地测]
**回退**：默认；宿主机 npm 和 run-checks.sh 按 RUNBOOK §13。

### P1.3 缺 PostgreSQL 17 时 CI 失败，支持 PG_BIN_DIR（D-16）

**目标**：数据库测试在 CI 上找不到 PG17 时失败，不再静默跳过；所有测试只用一个查找函数。
依赖：P1.2｜负责：OMO｜Eric：无｜分支：`codex/config-fixes-20261112`
**改动**：
- 新增 `scripts/_postgres-bin.mjs`（导出 `postgresBinDir()`）和它的单测 `scripts/postgres-bin.test.mjs`。
- 7b18f20 上写死 `/usr/lib/postgresql/17/bin` 的 32 个测试文件（都在 `scripts/` 下）改为调用这个函数。#369 新增的第 33 个文件在 P1.8 里改。

`postgresBinDir()` 的规则：
1. 查找顺序：`PG_BIN` → `PG_BIN_DIR` → `/opt/homebrew/opt/postgresql@17/bin` → `/usr/lib/postgresql/17/bin`。`PG_BIN` 是 `admin-support-email-ledger.test.mjs` 现有的变量，保留。
2. `PG_BIN` 或 `PG_BIN_DIR` 已经设置时，只认它指的那个目录，不往下找。不这样做，容器里 `/usr/lib/postgresql/17/bin` 确实存在，DoD ③ 就验不出来（RUNBOOK §4.4 末段）。
3. 找不到 `initdb`：`CI=true` 时抛 `postgresql_17_required_in_ci`；不是 CI 时返回 null，由调用方 skip。
4. 现有代码里对 PG16 的回退和对 PATH 的搜索删掉，因为 CI 和测试镜像都是 PG17。

**命令**：
```bash
cd ~/work/illini-config
git grep -l '/usr/lib/postgresql/17/bin' -- scripts app api | wc -l | tee $EV/$TS-hardcoded-before.txt   # 32
# 改完后
git grep -l '/usr/lib/postgresql/17/bin' -- scripts app api | tee $EV/$TS-hardcoded-after.txt          # 只剩 scripts/_postgres-bin.mjs
RUN_CMD='cd app && PG_BIN_DIR=/nonexistent node --test ../scripts/admin-support-email-ledger.test.mjs' $RC ~/work/illini-config cmd
$RC ~/work/illini-config install test
```
**DoD**：
- ① `postgres-bin.test.mjs` 覆盖四种情况并全过：CI 下目录无效会抛错；非 CI 下目录无效返回 null；`PG_BIN_DIR` 有效时返回该目录；两个变量都没设时按顺序回退。
- ② 写死路径的文件从 32 个降到 1 个。
- ③ cmd 步骤 `rc` 非 0，日志里有 `postgresql_17_required_in_ci`。
- ④ test 通过（§0.3），`pg_skips=0`。

**证据**：上面两个 `$EV` 文件，cmd 和 test 的日志。标签 [本地测]
**回退**：默认。

### P1.4 品牌色统一 #B9452C（D-04）

**目标**：界面代码里不再出现旧品牌色 #C74A2F 和它的阴影色。D-04 已定，不受 D-35 的视觉冻结限制（SPEC §9.1 末条）。
依赖：P1.2｜负责：OMO｜Eric：无｜分支：`codex/config-fixes-20261112`
**改动**：
- `app/src/uni.scss:16` 改为 `$brand-color: #B9452C`；
- `App.vue` 的 `--shadow-cta`、`--shadow-brand`、`--shadow-fab`（1838–1840 行、2362–2365 行），以及 `ChatThread.vue`、`pages/index`、`pages/post`、`pages/profile` 里的 `rgba(199,74,47,…)`，改为 `rgba(185,69,44,…)`，透明度不变。

**命令**：
```bash
cd ~/work/illini-config
git grep -nI -iE '#C74A2F|rgba[(]199, ?74, ?47' -- app/src ':!app/src/components/illustrations' ':!app/src/components/stickers' \
  | grep -vE '^[^:]+:[0-9]+:[[:space:]]*([*]|//|/[*])' | tee $EV/$TS-oldcolor.txt | wc -l   # 改前 15，改后 0
$RC ~/work/illini-config install typecheck h5 mp
```
**DoD**：
- ① 上面的 grep 从 15 行降到 0 行。
- ② 两个 SVG 注册表和深色主题的 `--brand #E47B5F` 没动：`git diff origin/main --stat -- app/src/components/illustrations app/src/components/stickers` 无输出，`git diff origin/main -- app/src/App.vue | grep -c E47B5F` 为 0。
- ③ typecheck、h5、mp 都是 `rc=0`。

**证据**：改前、改后各一份 `$EV/<TS>-oldcolor.txt`。标签 [本地测]
**回退**：默认。

### P1.5 Playwright 升到 1.65.0，CI 浏览器 job 跑 ubuntu-latest（D-16）

**目标**：Playwright 能在 Ubuntu 26.04 的 CI runner 上装浏览器，main 的 CI 恢复绿色。
依赖：P1.2｜负责：OMO｜Eric：无｜分支：`codex/config-fixes-20261112`
**改动**：`app/package.json` 的 `@playwright/test` 改为 `^1.65.0`，`app/package-lock.json` 随之更新。main 的 ci.yml 已经是 `ubuntu-latest`，不动，也不加 `ubuntu-24.04` 固定。
**命令**（用宿主机的 npm，P1.2 之后是 10.9.x）：
```bash
cd ~/work/illini-config/app && npm install --legacy-peer-deps --no-audit --no-fund --save-dev @playwright/test@^1.65.0
cd .. && git diff origin/main -- app/package-lock.json | grep -E '^[+-][[:space:]]+"node_modules/' | tee $EV/$TS-lock-packages.txt
git grep -c 'ubuntu-24.04' -- .github/workflows/ci.yml     # 无输出
```
**DoD**：
- ① `app/package.json` 写的是 `^1.65.0`。
- ② lockfile 里变化的包只有 `@playwright/test`、`playwright`、`playwright-core` 三个。
- ③ ci.yml 里没有 `ubuntu-24.04`。
- ④ P1.9 之后，`RUN_CMD='cd app && npx playwright --version' $RC ~/work/illini-config cmd` 输出 1.65.0。
- ⑤ P1.7 的 PR CI 里，Build H5 日志含 `Image: ubuntu-26.04`，`npx playwright install --with-deps chromium webkit` 成功，不再出现 `Playwright does not support chromium on ubuntu26.04-x64`。

**证据**：`$EV/<TS>-lock-packages.txt`；⑤ 的 run 链接记在 STATUS。标签 [本地测]（⑤ 为 [CI run#]）
**回退**：默认，lockfile 一起 revert。

### P1.6 依赖安全审计修复（D-41）

**目标**：PR 改了 `app/package*.json` 之后 CI 会跑依赖审计；让这一步按 D-41 批准的范围通过。
依赖：P1.5｜负责：OMO｜Eric：D-41，批准修复范围（是否允许 `npm audit fix` 以外的大版本升级；vite 6.4.4 没有修复版本怎么处理）
**分支**：D-41 选 A 时，在 `codex/config-fixes-20261112` 上单独提交，提交说明以 `deps:` 开头，PR 描述单列一节。D-41 若写明另开分支，用 D-41 写的分支名，并且这个名字要同时加进 RUNBOOK STOP-6 的分支白名单。
**改动**：只改 D-41 批准清单里的包（`app/package*.json`）。
**命令**：
```bash
$RC ~/work/illini-config install npmaudit        # 基线；日志里找「N vulnerabilities (… moderate, … high)」
cd ~/work/illini-config/app && npm audit fix --legacy-peer-deps     # 不带 --force；只在 D-41 批准后执行
cd .. && git diff origin/main -- app/package-lock.json | grep -E '^[+-][[:space:]]+"node_modules/' > $EV/$TS-lock-packages.txt
$RC ~/work/illini-config install npmaudit
$RC ~/work/illini-config install typecheck h5 h5accept mp migrations test smoke
```
**DoD**：
- ① 基线是 44 个漏洞（9 moderate、35 high），与 run 42684660097 一致。不一致时按 §14 第 8 行处理。
- ② lockfile 里变化的包与 D-41 批准清单一一对应，另加 P1.5 的三个包。
- ③ 修复后 npmaudit 步骤 `rc=0`；或者剩下的每一项都和 D-41 批准的例外清单逐条对得上（包名、advisory 编号、复查日期）。
- ④ 全量通过。
- D-41 没定之前跳过本任务，P1.7 照样开草稿 PR。

**证据**：两次 audit 日志、`$EV/<TS>-lock-packages.txt`。标签 [本地测]
**回退**：revert 本任务的 `deps:` 提交。

### P1.7 开配置修正草稿 PR，CI 全绿

**目标**：P1.2–P1.6 的改动进一个草稿 PR，CI 证明 main 在 Ubuntu 26.04 上恢复绿色。
依赖：P1.3、P1.4、P1.5、P1.6（D-41 未定时不等 P1.6）｜负责：OMO｜Eric：E5，审阅并合并（OMO 不合并）｜分支：`codex/config-fixes-20261112`
**命令**：
```bash
cd ~/work/illini-config && git push -u origin codex/config-fixes-20261112
gh pr create --draft --base main --head codex/config-fixes-20261112 --repo $REPO \
  --title 'chore: align npm, PostgreSQL test gate, brand color and Playwright 1.65 with CI' \
  --body-file $EV/$TS-pr-body.md          # 正文：P1.2–P1.6 的完成情况、D-41 的状态、STATUS 链接
# 读结果按 RUNBOOK §7
```
**DoD**：
- ① 草稿 PR 已开，base 是 main。
- ② PR 最新 CI run 的 job 结论（RUNBOOK §7）：Type-check、Boundary regressions（含依赖审计这一步）、Build H5、Build mp-weixin、Smoke (public page sweep) 为 success；Smoke (protected staging account) 和 Production release readiness 为 skipped。D-41 未定时，Boundary 只允许失败在依赖审计那一步，STATUS 写「等待 D-41」。
- ③ Boundary 的汇总是 `# fail 0`、`# skipped 1`。
- ④ STATUS 记 PR 号、head SHA、run id 和每个 job 的结论。

**证据**：`gh run view $RUN` 的 job 列表和 Boundary 汇总行。标签 [CI run#]
**回退**：PR 保持草稿，修正提交推到同一分支。

### P1.8 把合并后的 main 并入 PR #369 分支

**目标**：#369 拿到 P1 的修正，撤掉 c52badf 加的 ubuntu-24.04 固定。
依赖：P1.7｜负责：OMO｜Eric：先完成 E5｜分支：`codex/community-topics-20261112`（`~/work/illini`）
**改动**：一个 merge commit；`scripts/community-post-topics.test.mjs` 改用 `postgresBinDir()`。ci.yml 冲突时取 main 的 `runs-on`。
**命令**：
```bash
cd ~/work/illini && git fetch origin && git merge origin/main
git grep -c 'ubuntu-24.04' -- .github/workflows/ci.yml      # 无输出
git grep -l '/usr/lib/postgresql/17/bin' -- scripts app api # 只剩 scripts/_postgres-bin.mjs
$RC ~/work/illini install typecheck h5 h5accept mp migrations test smoke
git push origin codex/community-topics-20261112
```
**DoD**：
- ① 没有 rebase、没有 force push，`git push` 是快进。
- ② ci.yml 里没有 `ubuntu-24.04`。
- ③ 写死路径的文件只剩 1 个。
- ④ 全量通过，test 的 `TEST` 行是 `fail=0 skipped=1 pg_skips=0`。

**证据**：merge commit SHA、全量日志。标签 [本地测]
**回退**：`git revert -m 1 <merge sha>`。

### P1.9 测试镜像升级到 Playwright 1.65

**目标**：工作站的测试镜像与 CI 一致（Playwright 1.65、Node 22 自带 npm、PG17）。
依赖：P1.5｜负责：OMO｜Eric：无（④ 推送要等 E1）｜目录：`~/work/illini-dev-env/`
**改动**：新 `run-checks.sh` 已在 P1.2 开头装上。本任务只做三件事：按 RUNBOOK §4.3 ③ 改 Containerfile，按 ④ 构建并核对，按 ⑤ 存档。
**命令**：RUNBOOK §4.3 ④、⑤ 的命令块。
**DoD**：
- ① `podman pull mcr.microsoft.com/playwright:v1.65.0-noble` 成功；新镜像 `localhost/illini-dev:pw1.65-node22-pg17` 里 `node -v` 输出 v22.23.5，`npm -v` 输出 10.9.x，`initdb --version` 输出 17.x，`locale -a` 含 en_US.utf8。
- ② run-checks.sh 的 test 判定行与 RUNBOOK §4.3 ① 一致：`fail` 不为 0、`skipped` 不等于 1、`pg_skips` 不为 0 时，脚本退出非 0。
- ③ 对 `~/work/illini-config` 跑全量，每个 `STEP` 都是 `rc=0`，`image=` 显示 pw1.65。
- ④ Containerfile、run-checks.sh、mp-size.mjs 已复制到材料分支 `appendix/env/`，STATUS_LOG 记这三个文件的 sha256 和镜像 ID。P1.10–P1.13 新建的脚本由各自任务按 RUNBOOK §4.3 ⑤ 复制。

**证据**：构建日志、全量日志、sha256 清单。标签 [本地测]
**回退**：RUNBOOK §13「测试镜像」。pw1.60 镜像保留到 P1.8 完成。

### P1.10 L-SQL：从 001 起全链回放迁移

**目标**：在本机一次性 PG17 容器里从空库回放全部迁移，证明迁移链没有断。
依赖：P1.9｜负责：OMO｜Eric：无｜环境：L-SQL｜目录：`~/work/illini`
**改动**：新建 `~/work/illini-dev-env/lsql-replay.sh`（内容见 RUNBOOK §5.1），不改仓库；写回时按 RUNBOOK §4.3 ⑤ 复制到 `appendix/env/`。
**命令**：
```bash
$LSQL ~/work/illini
```
**DoD**：
- ① 最后一行是 `files=181 replayed=181 errors=0 done=1 rc=0`（005ca9d 上有 181 个 .sql），脚本退出 0。
- ② 日志里最后一个 `REPLAY` 行是 `20261112120000_community_post_topics.sql`。
- ③ 第一次跑先确认连接角色（RUNBOOK §5.1「用法与判定」末条），结果记进 STATUS_LOG。
- ④ 失败时记下最后一个 `REPLAY` 行和 `ERROR:` 那一行，不改已有的迁移。

**证据**：lsql 日志。标签 [隔离环境 L-SQL]
**回退**：脚本退出时自动删容器，不需要回退。

### P1.11 staging-smoke 合成账号就绪与只读 schema 预检（S-1）

**目标**：确认 OMO 手里只有 staging 的公开 key 和合成账号，并且 main 代码在 staging 上的公开读面正常。
依赖：P1.1｜负责：OMO｜Eric：E2（书面确认 staging-smoke 只有合成数据，D-29）、E3（建 A/B/C 账号和 staging.env）｜环境：S-1｜目录：`~/work/illini-main`（RUNBOOK §3，只读）
**改动**：新建 `~/work/illini-dev-env/probe-in-container.sh` 和 `probes/playwright.probe.config.ts`（内容与要求见 RUNBOOK §5.2），以及 `probes/consent-login.spec.ts`：A、B、C 依次登录，接受同意书，各截一张图存 `$EV`。写回时按 RUNBOOK §4.3 ⑤ 复制到 `appendix/env/`。
**命令**：
```bash
git -C ~/work/illini worktree add --detach ~/work/illini-main origin/main     # RUNBOOK §3；已存在就跳过
# RUNBOOK §5.2「前提与自检」的四条，输出 tee $EV/$TS-selfcheck.txt
EV=$EV $RC ~/work/illini-main install probe consent-login.spec.ts
```
**DoD**：
- ① 自检：权限 600；禁用词计数 0；URL 行计数 1；变量名正好是那 8 个。
- ② probe 步骤先跑的 `verify-public-read-schema.mjs` 输出 3 项，全部 status 200。
- ③ A、B、C 各登录一次并接受同意书，截图 3 张存 `$EV`，截图里没有邮箱和密码。
- ④ spec 结果 3 passed。

**证据**：probe 日志、3 张截图。标签 [隔离环境 S-1]
**回退**：无。staging.env 不对时停这条，等 E3。

### P1.12 换号隔离探针（S-1）

**目标**：证明同一个浏览器里换账号之后，上一个账号的私信不会留在页面或存储里。
依赖：P1.11｜负责：OMO｜Eric：无｜环境：S-1｜目录：`~/work/illini-main`
探针用 main 代码跑。原因是 staging 应用 P2 迁移（P2.6）之前，#369 的社区页拉帖会 400。
**改动**：新增 `~/work/illini-dev-env/probes/account-switch.spec.ts`。走法见 RUNBOOK §5.2「换号探针与越权矩阵」。
**命令**：
```bash
EV=$EV $RC ~/work/illini-main probe account-switch.spec.ts
```
**DoD**：
- ① C 给 A 发私信 `SYN-P1-LEAK-<YYYYMMDD>`（CT 日期）；A 登录，看到探针后退出；不刷新页面，直接登录 B，依次打开消息、广场、帖子详情（main 上还叫「广场」「帖子」）。
- ② 在 B 的会话里，`document.body.innerText`、localStorage、sessionStorage 里探针都是 0 命中；`sb-hygkwxugskijadgfisji-auth-token` 里的 user.id 是 B。
- ③ 硬刷新后再查一遍，仍然 0 命中。
- ④ 只有 `**/api/moderate` 被拦截，返回 `200 {flagged:false,categories:[],skipped:true,reason:'no_key'}`。
- ⑤ 结果 1 passed，日志路径写进 STATUS_LOG。
- ⑥ 探针私信没有删除入口时，按 RUNBOOK §5.2「清理」记进残留清单。

**证据**：probe 日志（只含命中计数、HTTP 状态、user.id）。标签 [隔离环境 S-1]
**回退**：无。

### P1.13 Vercel CLI 护栏与 demo 项目关联（D-18）

**目标**：在工作站上从命令层面挡住 `--prod`、promote、env 这类会碰生产的 Vercel 操作，只允许关联 demo 项目。
依赖：P1.1｜负责：OMO｜Eric：无｜目录：`~/.local/bin/`、`~/.bashrc`、`~/.local/opt/node/bin/`、`~/.config/illini/vercel-demo-project`、`~/work/demo-publish`
**改动与命令**：RUNBOOK §9 的 ①–③，依次是护栏脚本、PATH 与 Node 前缀里的链接、demo 项目名与关联 demo 目录；护栏脚本写回时按 RUNBOOK §4.3 ⑤ 复制。然后在新开的交互 shell 里自测：
```bash
bash -ic 'vercel deploy --prod; echo exit=$?'              2>&1 | tee    $EV/$TS-guard.txt   # vercel guard: --prod blocked (D-18)，exit=1
bash -ic 'vercel env pull; echo exit=$?'                   2>&1 | tee -a $EV/$TS-guard.txt   # vercel guard: env blocked (D-18)，exit=1
{ ~/.local/opt/node/bin/vercel deploy --prod; echo exit=$?; } 2>&1 | tee -a $EV/$TS-guard.txt   # 同上，exit=1
bash -ic 'cd ~ && vercel deploy; echo exit=$?'             2>&1 | tee -a $EV/$TS-guard.txt   # deploy outside ~/work/demo-publish blocked，exit=1
bash -ic 'cd ~/work/demo-publish && VERCEL_REAL=/bin/echo vercel deploy --scope ericxu-0805s-projects --yes' | tee -a $EV/$TS-guard.txt   # 只回显参数：demo 目录里放行
bash -ic 'vercel whoami'                                    | tee -a $EV/$TS-guard.txt   # ericxu-0805
find ~/work -name .vercel -type d; ls -A ~/work/demo-publish
```
**DoD**：
- ① `vercel project ls` 的输出已存档；`illini-community-demo.vercel.app` 所属的项目名写进 `~/.config/illini/vercel-demo-project` 和 STATUS_LOG。
- ② 新开的交互 shell 里 `vercel deploy --prod` 和 `vercel env pull` 都被拒，退出码 1；直接调用 `~/.local/opt/node/bin/vercel deploy --prod` 也被拒；`vercel whoami` 仍输出 ericxu-0805。
- ③ `find ~/work -name .vercel -type d` 只输出 `/home/guoyi/work/demo-publish/.vercel` 这一行。
- ④ `ls -A ~/work/demo-publish` 里没有 `.env*` 文件。

**证据**：RUNBOOK §9 ③ 的项目列表日志、`$EV/<TS>-guard.txt`，以及 ③④ 的输出。标签 [本地测]
**回退**：RUNBOOK §13「Vercel 护栏」：不回退，只有 Eric 要求时才移除。

---

## 4 P2 话题与板块（PR #369）

P2 的任务都在 `codex/community-topics-20261112`（`~/work/illini`）上做，P2.12 除外。界面以 SPEC §2 术语表、§6.4 话题详情、§6.5 发话题面板、§7 状态与文案为准；迁移以 ENGINEERING §5.1 为准。

### P2.1 schema 预检提前发现缺迁移

**目标**：候选库没有应用 20261112120000 时，CI 在启动浏览器之前就失败，报错写明缺的是哪一项。
依赖：P1.1｜负责：OMO｜Eric：无（③ 要用 E3 的 staging.env）
**改动**：
- `scripts/verify-public-read-schema.mjs`：checks 加一项 `['community topic columns','posts','id,title,category,region']`；另外对 `rpc/search_community_posts` 发 `POST {terms_in:['x'],limit_in:1}`，非 2xx 就报 `public_schema_mismatch: community search rpc`。
- `scripts/public-read-schema.test.mjs`：同步加用例。

**命令**：
```bash
$RC ~/work/illini install test
( set -a; . ~/.config/illini/staging.env; set +a; cd ~/work/illini
  VITE_SUPABASE_URL=$STAGING_SUPABASE_URL VITE_SUPABASE_ANON_KEY=$STAGING_SUPABASE_ANON_KEY \
  node scripts/verify-public-read-schema.mjs ) 2>&1 | tee $EV/$TS-staging-before.txt; echo "exit=${PIPESTATUS[0]}"
```
**DoD**：
- ① 检查从 3 项变成 4 项，另加 1 个 RPC 探测。
- ② 单测覆盖三种情况：缺列返回 400、RPC 返回 404、全部 200。
- ③ 对还没应用迁移的 staging 运行，退出码 1，输出含 `public_schema_mismatch: community topic columns`。staging.env 还没有时，③ 记「未测，等 E3」。
- ④ test 通过。

**证据**：`$EV/<TS>-staging-before.txt`、test 日志。标签 [本地测]（③ 为 [隔离环境 S-1]）
**回退**：默认。

### P2.2 板块名与术语改值（D-01、术语表）

**目标**：界面上的板块名，以及「回复」「新发布」「关注的人」「关联商品」，与 SPEC §2、§3 逐字一致。
依赖：P1.1｜负责：OMO｜Eric：无
**改动**：
- `app/src/composables/i18n/messages/zh.ts`、`en.ts` 的值，key 名不变（新旧值对照见 SPEC §11）；
- 新增 `app/smoke/reply-terminology.test.mjs`；
- 现有 smoke 里的字符串断言同步改。

**命令**：
```bash
cd ~/work/illini
git grep -nE '落地与二手|校友与职业|活动与交友|本地优惠|Settling in & marketplace|Alumni & careers|Events & social' -- app/src | wc -l   # 0
grep -n 评论 app/src/composables/i18n/messages/zh.ts | grep -v reconsent | wc -l                                               # 基线 18，改后 0
SMOKE_SPECS="$DEF" $RC ~/work/illini install test smoke
```
**DoD**：
- ① `plaza.category.<slug>` 五个值等于 SPEC §3 的板块表；第一条 grep 输出 0。
- ② 帖子下的回应统一叫「回复」：zh.ts 里除 `reconsent.*` 外含「评论」的行从 18 行（005ca9d 基线）降到 0；新单测扫 en.ts 的值，除 `reconsent.*` 外 `Comment`/`comments` 0 命中。`reconsent.*` 和 `app/src/legal` 归 LEGAL.2。
- ③ `plaza.tab.recent` 改为「新发布」（en 仍为 New）；`plaza.tab.following`、`nav.following` 改为「关注的人」/ Following；`plaza.attachItem` 改为「关联商品」/ Link an item。
- ④ test、smoke 都通过。

**证据**：两条 grep 的输出，test、smoke 日志。标签 [本地测]
**回退**：默认。

### P2.3 导航第一步：「广场」改名「社区」（D-02）

**目标**：底部第 2 个 tab 和相关文案从「广场」改成「社区」，tab 顺序和路径不变。规则见 SPEC §4.1。
依赖：P2.2｜负责：OMO｜Eric：无
**改动**：
- `zh.ts` / `en.ts` 的 `nav.plaza`、`plaza.title`（「社区」/ Community）、`plaza.backToPlaza`（「返回社区」），以及 `history.tabPosts`、`admin.tabPlaza`、`admin.banner*` 里的「广场」；
- `app/src/pages.json` tabBar 第 2 项的 text；
- `CustomTabBar.vue`、`AppSidebar.vue` 里硬编码的文字；
- 新增 `app/smoke/community-tab-label.spec.ts`：在 390 和 1280 下断言第 2 个 tab 的文字是「社区」，并用 `page.screenshot` 存下 DoD ③ 的两张图。

**命令**：
```bash
cd ~/work/illini
grep -n 广场 app/src/composables/i18n/messages/zh.ts | grep -vE 'reconsent|share[.]plaza' | wc -l   # 基线 9，改后 0
grep -c 广场 app/src/pages.json                                                                  # 0
git diff 005ca9d -- app/src/pages.json | grep -E '^[+-][^+-]' | grep -v '"text"'                  # 无输出
SMOKE_SPECS="$DEF community-tab-label.spec.ts" $RC ~/work/illini install smoke
```
**DoD**：
- ① 第一条 grep 从 9 行降到 0。005ca9d 上 zh.ts 共 12 行含「广场」，其中 `reconsent.*` 2 行归 LEGAL.2，`share.plaza` 1 行归 BRAND.2。
- ② pages.json 里没有「广场」，diff 只改了 text，tab 顺序和 `pagePath` 不变。
- ③ 390 和 1280 截图里第 2 个 tab 显示「社区」。

**证据**：`appendix/visual/P2.3/tabbar-390-light-zh.png`、`tabbar-1280-light-zh.png`。标签 [本地测]
**回退**：默认。

### P2.4 发帖默认「话题」，字段顺序与就地报错（D-05）

**目标**：打开发帖面板默认是「话题」；字段顺序固定；填错的提示显示在字段下方。规格见 SPEC §6.5。
依赖：P2.2｜负责：OMO｜Eric：无
**改动**：`app/src/pages/plaza/index.vue`（005ca9d 第 946 行 `composerMode` 默认 `'update'`）；扩展 `app/smoke/community-post-topics.spec.ts`。
**DoD**：
- ① `composerMode` 默认 `'topic'`；模式按钮顺序是「话题｜动态」。
- ② 从板块页进入时预选该板块。
- ③ 字段顺序：板块 chip（必选）→ 标题（最多 120 字，剩 20 字时显示计数）→ 正文（最多 2000 字，占位文案随板块变化）→ 图片（最多 4 张）→ 关联商品（最多 3 件）。
- ④ 必填项出错时，提示显示在字段下方，焦点移到第一个出错的字段，不弹 toast。
- ⑤ smoke 断言：打开面板时「话题」是选中态；空标题提交后标题下出现「请填写标题」，页面上没有 toast。smoke 通过。

**证据**：smoke 日志；`appendix/visual/P2.4/composer-390-light-zh.png`。标签 [本地测]
**回退**：默认。

### P2.5 冻结前修订迁移 20261112120000，补伴随文件

**目标**：按仓库规程给这个迁移补齐超时、约束、地区字段、幂等权限和 PRECHECK/VERIFY/REGRESSION，然后冻结。2026-11-12 核对时它还没有应用到任何托管库，所以还能改。
依赖：P1.10、REGION.1｜负责：OMO｜Eric：无｜环境：L-SQL
**改动**：
- `supabase/migrations/20261112120000_community_post_topics.sql`：ENGINEERING §5.1「冻结前要加的改动」表第 1–6 行；
- `supabase/_ops/PRECHECK_20261112120000_community_post_topics.sql`、`VERIFY_…`、`REGRESSION_…`：按 §5.1 列的断言写；
- `supabase/migrations/manifest.sha256` 里 20261112120000 这一行。这一行在 005ca9d 上已经存在，是冻结前唯一允许改的已有行；
- `app/src/utils/communityPost.ts` 的 `normalizePostTopic`：同步校验 `post_topic_body_required`；
- `scripts/community-post-topics.test.mjs`：按 §5.1 扩充。

**命令**：
```bash
cd ~/work/illini
# ENGINEERING §5.0 第 5 条：证明 main 上没有被覆盖的函数定义
git log origin/main --since=2026-10-26 --oneline -- supabase/migrations | tee $EV/$TS-main-migrations-since.txt
git grep -l -e capture_report_target_snapshot -e admin_get_report_detail origin/main -- supabase/migrations | tee $EV/$TS-rewritten-fns.txt
# ENGINEERING §13 缺口 1 的 staging 那一半
( set -a; . ~/.config/illini/staging.env; set +a
  curl -s -o /dev/null -w '%{http_code}\n' -H "apikey: $STAGING_SUPABASE_ANON_KEY" \
  "$STAGING_SUPABASE_URL/rest/v1/posts_visible?select=source_lang&limit=0" ) | tee $EV/$TS-source-lang.txt
# 最后一次改迁移文件之后，再更新 manifest 这一行：
( cd supabase/migrations && sed -i '/20261112120000_community_post_topics.sql/d' manifest.sha256 \
  && sha256sum 20261112120000_community_post_topics.sql >> manifest.sha256 )
$LSQL ~/work/illini 20261112120000
$RC ~/work/illini install migrations test
sha256sum supabase/migrations/20261112120000_community_post_topics.sql | tee $EV/$TS-freeze.sha256
```
**DoD**：
- ① ENGINEERING §5.1 改动表第 1–6 行都已落进文件。
- ② 三个 `_ops` 文件都存在，内容覆盖 §5.1 列的 PRECHECK、VERIFY、REGRESSION 断言。
- ③ `git log` 列出的迁移里，没有一个改动过这两个被重写的函数（逐个 `git show` 核对，结论写进 STATUS_LOG）。PRECHECK 里写进 L-SQL 回放到 20261003175231 时两个函数的 `md5(prosrc)`。
- ④ staging 上 `source_lang` 的探测结果（200 或 400）已记录。staging.env 还没有时记「未测，等 E3」，生产那一半由 Eric 查。
- ⑤ L-SQL 最后一行 `errors=0 done=1 rc=0`，日志里依次出现 `PRECHECK`、`REPLAY 20261112120000_…`、`VERIFY`、`REGRESSION`；REGRESSION 里以 anon、A、B、停权用户、被拉黑用户身份对 `posts`、`post_items`、`search_community_posts` 的读写断言全部通过（ENGINEERING §5.1）。
- ⑥ migrations 步骤输出 `all-migration-checksums-ok`；test 通过。
- ⑦ STATUS_LOG 写「20261112120000 冻结」和该文件的 sha256。之后不再改这个文件。

**证据**：`$EV` 下的四个文件、lsql 日志。标签 [隔离环境 L-SQL]
**回退**：冻结前按默认做法。冻结后发现缺陷，按 §14 第 12 行处理。

### P2.6 Eric 在 staging-smoke 应用冻结迁移，OMO 核对并重跑 CI

**目标**：候选库有了 P2 的 schema，#369 的公开巡检恢复绿色。
依赖：P2.5、P2.1、P1.11｜负责：Eric（应用）/ OMO（核对）｜Eric：E2 书面确认（D-29）之后执行 E4。目标只限 hygkwxugskijadgfisji，文件 sha256 要等于 STATUS_LOG 的冻结值。
**OMO 命令**：
```bash
( set -a; . ~/.config/illini/staging.env; set +a; cd ~/work/illini
  VITE_SUPABASE_URL=$STAGING_SUPABASE_URL VITE_SUPABASE_ANON_KEY=$STAGING_SUPABASE_ANON_KEY \
  node scripts/verify-public-read-schema.mjs ) 2>&1 | tee $EV/$TS-staging-after.txt
# 重跑 CI 按 RUNBOOK §7「重跑」的三种办法依次选
```
**DoD**：
- ① Eric 在 PR #369 留言：应用时间（CT）、PRECHECK 和 VERIFY 的输出。
- ② P2.1 版的脚本对 staging 运行，5 项全部 200。
- ③ 新的 CI run（headSha 等于新的 code_sha）里，Smoke (public page sweep) 0 failed；Type-check、Boundary regressions、Build H5、Build mp-weixin 为 success。
- ④ STATUS 记 run id、passed/failed/skipped 计数和新的 code_sha。

**证据**：`$EV/<TS>-staging-after.txt`、#369 最新 CI run 的 `gh run view` 输出（RUNBOOK §7）。标签 [CI run#]
**回退**：staging 不回滚，按 RUNBOOK §13「staging 上的迁移」。

### P2.7 「话题已发布、商品没关联上」的恢复界面

**目标**：话题发出去了但关联商品失败时，作者在详情页能重试，而且重试不会重复发帖。文案见 SPEC §6.4、§7、§11。
依赖：P2.4｜负责：OMO｜Eric：无｜环境：L-UI
**改动**：
- `app/src/composables/usePlaza.ts`：`createPost` 的返回值、模块级 Map、`onAccountTransition` 清理；
- `app/src/pages/plaza/index.vue`：跳转 URL；
- `app/src/pages/post/index.vue`：作者提示条；
- `zh.ts`、`en.ts`；
- 新增 `app/smoke/community-post-partial-attach.spec.ts`。

**DoD**：
- ① `createPost` 的返回值区分 `{partial:'items_failed', failedItemIds}` 和 `{partial:'refetch_failed'}`，后一种不提示用户。
- ② 关联失败时，itemIds 写进 usePlaza 的模块级 Map，并镜像到 sessionStorage，key 为 `pending-post-items:<accountId>:<postId>`；`onAccountTransition` 时一并清理；跳转 URL 加 `&attach=pending`。
- ③ 详情页只对作者显示「话题已发布，「{首件商品名}」等 {n} 件商品没有关联上」，配「重新关联」「不关联了」两个按钮。
- ④ 重试的规则：
  - 先查这个帖子已有的 `post_items`，只插缺的，`display_order` 沿用原顺序；
  - 23505 按成功处理；42501 显示「这件商品已不在售，无法关联」，并移出待关联；超过上限显示「已达 3 件上限」；
  - 网络错误或 5xx 时保留按钮；请求没返回之前按钮禁用；
  - 绝不再调用 posts insert。
- ⑤ `plaza.partialPublish` 按模式分成两条；新增 `attachPending`、`attachRetry`、`attachDismiss`、`attachUnavailable` 的中英文。
- ⑥ smoke 全部 passed，覆盖五种情况：
  - 第一次 `post_items` 返回 500 → 提示条出现 → 重试返回 201 → 商品卡出现，posts 只有 1 行；
  - 两次操作之间商品改成 sold → 显示不可关联；
  - refetch 失败时不出提示条；
  - 换号后提示消失；
  - B 打开同一链接看不到提示条。

**证据**：smoke 日志。标签 [隔离环境 L-UI]
**回退**：默认。

### P2.8 幂等发布与草稿保存

**目标**：断网或响应丢失时，用同一个 ID 重试只产生一个帖子；关面板前能保留草稿。客户端合同见 ENGINEERING §5.2。
依赖：P2.5｜负责：OMO｜Eric：无｜环境：L-UI、L-SQL
**改动**：
- `usePlaza.ts`、`plaza/index.vue`；
- 复用 `app/src/api/clientMessageId.ts` 的 `createClientMessageId()` 和 `app/src/api/accountLocalPrivacy.ts` 的 `writeAccountPrivateStorage`；
- 新增 `app/smoke/community-post-idempotency.test.mjs`；
- `scripts/community-post-topics.test.mjs` 加 PG 断言。

**DoD**：
- ① `openComposer` 时生成 `composerPostId`，只在成功或确定性拒绝之后换新 ID。
- ② `createPost` 增加 `postId`、`retryCreate` 参数。遇到 `retryCreate`、23505、`duplicate_post` 或结果未知时，先 `select(POST_SELECT).eq('id',postId).eq('user_id',uid).maybeSingle()` 回读，再判定成败。
- ③ 结果未知时面板不关，按钮改为「检查是否已发布」。
- ④ 草稿存到 `plaza_composer_draft_v1`，字段为 postId、mode、title、category、text、itemIds、images、outcomeUncertain。关闭面板时有内容就问「保留草稿 / 不保留」；换号时删除草稿。
- ⑤ 测试：
  - 首次写入的响应丢失后，用同一 ID 重试，posts 行数为 1；
  - 收到 23505 时回读成功；
  - 收到 `duplicate_post` 且 ID 相同时回读成功；
  - PG 测试断言 authenticated 对 posts 只新增了 `INSERT(id)`。
- ⑥ test、smoke 都通过。

**证据**：test、smoke 日志。标签 [本地测]
**回退**：默认。

### P2.9 标题接入分享预览与旧读路径

**目标**：分享卡和旧读路径都读得到话题标题，并写清每种客户端组合下用户看到什么。
依赖：P2.5｜负责：OMO｜Eric：无
**改动**：
- `api/share-post.js`：从 `posts_visible` 读 title，OG 标题 = `title || 正文首行`；
- `api/_share-boundary.test.mjs`、`scripts/suspension-visibility-legacy-view-boundary.test.mjs`：加话题用例；
- 材料分支 ENGINEERING §6：OMO 按实测填兼容矩阵的格子。

**DoD**：
- ① OG 标题规则生效，两份测试都有话题用例。
- ② P2 阶段标题不翻译，英文界面显示原文标题；`title_i18n` 列入 P6.1 候选。
- ③ 兼容矩阵覆盖 {旧 H5（7b18f20）、新 H5、新小程序} × {动态、话题} × {列表、详情、搜索、分享预览}，每格写用户看到什么。小程序没发布过，没有旧版用户，不列旧小程序。
- ④ test 通过。

**证据**：test 日志、ENGINEERING 的提交 SHA。标签 [本地测]
**回退**：默认。

### P2.10 小程序同版（D-12）

**目标**：话题在小程序里能分享、能从板块深链进入，包体不超预算。差异规则见 SPEC §8。
依赖：P2.4、P2.9｜负责：OMO｜Eric：无
**改动**：
- `app/src/pages/post/index.vue`：`onShareAppMessage` 用话题标题，最多 50 字；
- 全局 store 加 `pendingBoard`：跳转前写入，社区页 `onShow` 读取并清空；
- 新增单测 `app/smoke/community-board-deeplink.test.mjs`。

**命令**：
```bash
git -C ~/work/illini worktree add --detach ~/work/illini-7b18f20 7b18f20     # 只读，对比基线用（RUNBOOK §3）
$RC ~/work/illini-7b18f20 install mp
$RC ~/work/illini install test mp
git -C ~/work/illini worktree remove ~/work/illini-7b18f20                    # 不带 --force
```
**DoD**：
- ① 分享标题、深链两项生效，单测通过。
- ② 两边的 mp 步骤都是 `rc=0`，mp 日志有 `build artifact verified: none <n> files` 和 `packageBytes`。
- ③ 主包不超过 1.5 MiB，每个分包不超过 1.6 MiB。
- ④ STATUS 记主包和各分包的字节数，以及与 7b18f20 的差值。真机预览留到 P5.2。

**证据**：两边 mp 日志的 `packageBytes` 行。标签 [本地测]
**回退**：默认。超预算按 §14 第 23 行处理。

### P2.11 staging 双账号越权矩阵（S-1）

**目标**：在真实的 RLS 下证明越权写入都被拒绝，删掉的帖子从公开读面消失。
依赖：P2.6、P1.12｜负责：OMO｜Eric：无｜环境：S-1｜目录：`~/work/illini`
**改动**：新增 `~/work/illini-dev-env/probes/p2-authz-matrix.mjs`；合成数据集按 RUNBOOK §5.2「合成数据集」。
**命令**：
```bash
EV=$EV $RC ~/work/illini install probe p2-authz-matrix.mjs
```
**DoD**：
- ① 以 A、B 的身份执行 7 项，每项记一行 `动作｜身份｜HTTP｜PostgREST code｜期望｜结果`，7 项全部被拒：
  1. A 关联 B 的商品；
  2. A 关联已售商品；
  3. A 关联第 4 件；
  4. `category='invalid'`；
  5. 标题 121 字；
  6. 话题正文为空；
  7. A UPDATE 自己帖子的 title。
- ② A 删帖后，匿名访问的社区列表和 `search_community_posts` 都不再出现这个帖子。share-post 由 P2.9 的单测覆盖。
- ③ 结果表写进 STATUS_LOG 的「计数」字段。
- ④ 只用 S-1 的 `/api/moderate` 替身。
- ⑤ 按 RUNBOOK §5.2「清理」删掉 `[SYN-P2.11]` 内容。

**证据**：probe 日志。标签 [隔离环境 S-1]
**回退**：无。

### P2.12 列表行重排（视觉选定后）

**目标**：板块页和「全部讨论」里的话题行按论坛密度重排，首屏能看到更多行。行规格见 SPEC §6.3。
依赖：HOME.1、P2.2｜负责：OMO｜Eric：D-35（视觉方向三选一）｜分支：`codex/community-home-20261112`，不进 #369
**改动**：话题行组件（`plaza/index.vue` 的列表部分，或抽出的行组件），只用 App.vue 的 token；新增 `app/smoke/community-topic-row.spec.ts`。
**DoD**：
- ① 标题最多 2 行；正文摘要 14px、2 行截断；元信息一行「{板块} · {作者} · {时间}」；回复数右对齐，用 tabular-nums。
- ② 有关联商品时加一行纯文本「关联 · {商品名} ${价格} · {状态}」；有图时右侧放 72×72、圆角 8 的首图。
- ③ 翻译、点赞、分享移到详情页；动态保留原卡片。
- ④ 视觉验收（§0.3）：<12px 文本 0 个，`AXE color-contrast violations=0`。
- ⑤ 1280×800 首屏不少于 8 行，390×844 首屏不少于 5 行。
- ⑥ 截图矩阵：浅色/深色 × 中文/英文 × 390/768/1280，共 12 张，存 `appendix/visual/P2.12/`。

**证据**：12 张截图、smoke 日志。标签 [隔离环境 L-UI]
**回退**：默认。

### P2.13 请 Eric 审 PR #369

**目标**：把 #369 交给 Eric 审阅，OMO 接着做不依赖合并的任务。
依赖：P2.1–P2.11、REGION.2、HOME.2、P1.8｜负责：OMO｜Eric：审阅 #369，决定什么时候转 ready、什么时候合并
**命令**：
```bash
gh pr edit 369 --repo $REPO --body-file $EV/$TS-369-body.md
RUN=$(gh run list --repo $REPO --branch codex/community-topics-20261112 --workflow ci.yml --event pull_request --limit 1 --json databaseId --jq '.[0].databaseId')
gh run view $RUN --repo $REPO --json headSha,conclusion,jobs --jq '.headSha, (.jobs[] | [.name, .conclusion] | @tsv)'
gh pr view 369 --repo $REPO --json isDraft
```
**DoD**：
- ① PR 描述列出已完成的任务编号和 STATUS 链接。
- ② 该 run 的 headSha 等于 code_sha，所有不是 skipped 的 job 都是 success。
- ③ `isDraft` 仍为 true，OMO 不改。
- ④ STATUS 的 `next_task_id` 指向一条不依赖合并的任务。

**证据**：`gh run view $RUN` 输出。标签 [CI run#]
**回退**：无。

---

## 5 REGION 地区字段（D-21）

规则见 SPEC §1.4、ENGINEERING §4。

### REGION.1 posts.region 字段（并进 20261112120000，冻结前做）

**目标**：帖子从第一版起就带地区字段，以后加芝加哥等地区不用改名、不用回填。
依赖：无（必须在 P2.5 冻结之前做）｜负责：OMO｜Eric：无｜分支：#369
**改动**：`20261112120000_community_post_topics.sql` 及其 VERIFY、`scripts/community-post-topics.test.mjs`。
**DoD**：
- ① 迁移里有 `ADD COLUMN region text NOT NULL DEFAULT 'cu'` 和 `CHECK (region IN ('cu'))`。
- ② `GRANT SELECT (region) ON public.posts TO anon, authenticated`，不开放 INSERT 和 UPDATE。
- ③ `search_community_posts` 增加参数 `region_in text DEFAULT 'cu'`。
- ④ VERIFY 断言默认值、非空、约束；L-SQL 回放后 `select count(*) from public.posts where region <> 'cu'` 为 0。
- ⑤ ENGINEERING §4 写明：新增地区时另写迁移改 CHECK，并开放 `INSERT(region)`。

**证据**：随 P2.5 的 lsql 日志。标签 [隔离环境 L-SQL]
**回退**：随 P2.5。

### REGION.2 前端地区常量与显示

**目标**：所有社区查询都带上地区；只有一个地区时不显示切换器，站名旁标出「香槟」。
依赖：REGION.1、P2.5｜负责：OMO｜Eric：无｜分支：#369
**改动**：新增 `app/src/utils/region.ts`；改社区列表和搜索的查询（首页查询由 HOME.2 接）；新增单测 `app/smoke/region-switcher.test.mjs`。
**DoD**：
- ① `REGIONS = [{slug:'cu', zh:'香槟', en:'Champaign-Urbana'}]`，`ACTIVE_REGION = 'cu'`。
- ② 社区列表、搜索、首页的查询都带 `region = 'cu'`（单测拦截请求后断言）。
- ③ smoke 断言 `[data-test=region-switcher]` 数量为 0；单测断言有 2 个地区时切换器出现。
- ④ 站名旁显示地区标签「香槟」/ Champaign-Urbana。
- ⑤ test、smoke 都通过。

**证据**：test、smoke 日志。标签 [本地测]
**回退**：默认。

---

## 6 BRAND 改名玉米地（D-20、D-27）

BRAND.1–3 在 `codex/brand-cornfield-20261112`（`~/work/illini-brand`）上做，单独开草稿 PR。改哪些文件、哪些标识不改、域名方案见 ENGINEERING §3；界面上的写法见 SPEC §1。

### BRAND.1 产品名替换：界面与清单文件

**目标**：用户看得到的产品名都换成「玉米地 / Cornfield」，全称和介绍按 SPEC §1.1 写。
依赖：P1.1｜负责：OMO｜Eric：无
**改动**：ENGINEERING §3.1 表里 BRAND.1 那几行，至少包括：
- i18n 的 `app.name`、`app.desc`，新增 `app.tagline`；
- `app/src/manifest.json` 的 name、`app/src/pages.json` 的 `navigationBarTitleText`、`app/src/static/manifest.webmanifest`（name、short_name、description）、`app/index.html`、`app/public-brand-pages.ts`；
- `moderation.adBody`（删掉「只用于同学之间交易物品」）、`api/moderate.js` 的分类提示词；
- `pages/index` 与 `pages/detail` 的 `navigator.share` 标题；
- `app/src/static/h5/account-deletion.html`、`app/src/static/robots.txt`；
- 关于页和登录页的「原 Illini Market」说明。

**命令**：
```bash
git -C ~/work/illini worktree add -b codex/brand-cornfield-20261112 ~/work/illini-brand origin/main
$RC ~/work/illini-brand install typecheck h5 h5accept mp migrations test smoke
grep -o '"projectname": *"[^"]*"' ~/work/illini-brand/app/dist/build/mp-weixin/project.config.json | tee $EV/$TS-projectname.txt
```
**DoD**：
- ① `app.name` =「玉米地」/ Cornfield；`app.desc` =「伊利诺伊华人论坛」/ Chinese community in Illinois；`app.tagline` 已新增。
- ② 上面列的文件都已改；mp 构建产物的 projectname 是「玉米地」（它由 manifest.json 的 name 生成，`project.config.json` 被 .gitignore 忽略）。
- ③ 关于页和登录页都有「原 Illini Market」说明。移除日期是 BRAND 生产发布日加 90 天，写进 STATUS 的待办。
- ④ `git diff origin/main --stat` 里没有 ENGINEERING §3.2 列的不改项（`pages/illini-verify`、`is_illini_verified`、存储 key、Sentry 项目名、illinimarket.com）。
- ⑤ 全量通过。

**证据**：全量日志、`$EV/<TS>-projectname.txt`。标签 [本地测]
**回退**：默认。

### BRAND.2 分享卡、邮件显示名与品牌断言测试

**目标**：分享卡、邮件里的品牌名一起换掉，并用测试防止旧名字再出现。
依赖：BRAND.1｜负责：OMO｜Eric：合并后执行 E10（Supabase 邮件模板、生产 `DIGEST_FROM` 显示名）
**改动**：
- `api/share.js`、`api/share-post.js` 的 `og:site_name` 和兜底标题；i18n 的 `share.plaza`、`share.marketplace`、`share.profile`；
- `DIGEST_FROM` 的默认值；`send-illini-code`、`notification-digest`、`meetup-notify`、`unsubscribe` 的正文；
- `supabase/email-templates/` 下的 `confirm-signup`、`reset-password`；
- 现有断言测试 `api/_share-boundary.test.mjs`、`api/_email-brand-boundary.test.mjs`、`api/_deployment-boundary.test.mjs` 改成新名；
- 新增 `scripts/brand-name-boundary.test.mjs`，把下面这条 grep 写成测试，让 CI 守住。

**命令**：
```bash
cd ~/work/illini-brand
git grep -nI -E 'Illini Market|Illini 集市|Illini集市' -- app/src app/index.html app/public-brand-pages.ts api ':!*.test.mjs' ':!app/src/legal' \
  | grep -vE '^[^:]+:[0-9]+:[[:space:]]*([*]|//|/[*]|<!--)' | grep -vE '原 Illini Market|formerly Illini Market' | tee $EV/$TS-brand-grep.txt | wc -l
$RC ~/work/illini-brand install test
git push -u origin codex/brand-cornfield-20261112
gh pr create --draft --base main --head codex/brand-cornfield-20261112 --repo $REPO --title 'feat: rename product to 玉米地 Cornfield' --body-file $EV/$TS-pr-body.md
```
**DoD**：
- ① `og:site_name` 为「玉米地 Cornfield」；兜底标题为「玉米地 · 社区」；`share.plaza` 为「社区 · 玉米地」。
- ② `DIGEST_FROM` 的默认值为 `玉米地 Cornfield <noreply@send.illinimarket.com>`，发件域名不变。
- ③ 两个邮件模板已同步。
- ④ 三份断言测试改成新名，新测试已加入。
- ⑤ 上面的 grep 从 76 行 / 19 个文件（7b18f20 与 005ca9d 相同的基线）降到 0。
- ⑥ test 通过。
- ⑦ 草稿 PR 的 CI 里，不是 skipped 的项全部 pass。Build H5 要在 26.04 上通过需要 P1.7 先合并；没合并之前这一项记「等待 E5」。

**证据**：`$EV/<TS>-brand-grep.txt`、test 日志、PR checks。标签 [本地测]
**回退**：默认。

### BRAND.3 徽章改名「校园邮箱已验证」（D-27）

**目标**：徽章和验证说明里不再出现 Illini 字样。写法见 SPEC §1.6。
依赖：BRAND.1｜负责：OMO｜Eric：无
**改动**：`profile.illiniVerified`、`profile.verifyTitle`、`profile.verifyHint`、`illini.title`、`illini.intro`、`login.illiniEmail` 的中英文值；`brand-name-boundary.test.mjs` 加入下面这条检索。徽章换颜色属于视觉改动，归 HOME.4。
**命令**：
```bash
git grep -nI -iE '伊利诺伊认证|Illini ?认证|Illini ?徽章|Illini ?身份|Verified Illini|Illini badge|Illini verification|Illini-verified|Illini verified' -- app/src api ':!*.test.mjs' \
  | grep -vE '^[^:]+:[0-9]+:[[:space:]]*([*]|//|/[*])' | tee $EV/$TS-badge-grep.txt | wc -l   # 基线 10（zh 6、en 4），改后 0
```
**DoD**：
- ① `profile.illiniVerified` =「校园邮箱已验证」/ Campus email verified，其余 5 个 key 换成不含 Illini 的说法。
- ② grep 从 10 行降到 0。
- ③ `git diff origin/main --stat` 里没有 `pages/illini-verify` 或 `is_illini_verified` 的重命名。

**证据**：`$EV/<TS>-badge-grep.txt`。标签 [本地测]
**回退**：默认。

### BRAND.4 新 logo：印章风格「玉」或「玉米地」

**目标**：出 3 个印章稿给 Eric 选，选定后替换全部图标文件。规格见 SPEC §1.5。
依赖：BRAND.1｜负责：OMO（出稿、替换）/ Eric（选定）｜Eric：D-34 三选一
**改动**：
- 出稿：`appendix/visual/logo/` 下放 3 个 SVG，各附 24px 和 512px 预览 PNG，再加 `SOURCES.md` 写字体名称和授权。
- 替换：`app/src/static/logo-mark.svg`、`logo-mark-dark.svg`、`app-icon.svg`、`app-icon-192.png`、`app-icon-512.png`、favicon、小程序图标，尺寸沿用现有文件。

**做法**：
- 字形取 SIL OFL 授权的 Noto Serif SC 或 Noto Sans SC：字体文件从 Google 与 Adobe 发布的 GitHub 仓库 notofonts/noto-cjk 的 release 下载到 `~/work/illini-dev-env/tools/fonts/`，下载地址和 sha256 写进 `SOURCES.md`；再用 `~/work/illini-dev-env/tools/` 里的 opentype.js 转成 `<path>`。SVG 里不留 `<text>`，否则 Android 和 Windows 会换成别的字体（design/README.md「代码要改什么」）。
- PNG 用测试镜像里的 Chromium 渲染（`RUN_CMD` + cmd 步骤），不新装工具。
- 不用 Block I，不用学校的橙蓝配色；主色 #B9452C。

**DoD**：
- ① 3 个方案和 6 张预览已提交，`SOURCES.md` 写明字体名称和授权。
- ② Eric 选定后完成替换；替换后的 SVG 里 `<text>` 0 个。
- ③ `git grep -c 集 -- 'app/src/static/*.svg'` 无输出。
- ④ 浅色、深色截图各 1 张，存 `appendix/visual/logo/`。

**证据**：上面这些文件。标签 [本地测]
**回退**：默认，图标文件一起 revert。

### BRAND.5 小程序显示名改「玉米地」（D-27）

**目标**：微信后台的小程序名称从「香槟市集」改成「玉米地」。约束见 ENGINEERING §3.3。
依赖：BRAND.1｜负责：Eric｜Eric：E7（核对主体类型、服务类目、剩余改名次数，即 D-30；试填「玉米地」没有重名或保护词提示后再提交）
**OMO 部分**：在 STATUS_LOG 记 BRAND.1 ② 的 projectname 核对结果。源码里没有要改的文件。
**DoD**：Eric 在 PR 留言或 STATUS_LOG 里记下新名称、提交日期、审核结果、主体类型、服务类目、剩余次数。
**证据**：Eric 的留言链接。标签 [真人]
**回退**：微信后台的改名不能撤销，所以先试填再提交。

### BRAND.6 新域名与 illinimarket.com 301（D-23）

**目标**：新域名启用后，旧域名的页面路径 301 到新域名，接口在两个域名上都直接可用。规则见 ENGINEERING §3.4。
依赖：BRAND.2｜负责：OMO（代码、只读核对）/ Eric（ENGINEERING §3.4 列的外部系统，以及 POST 探测）｜Eric：答复 D-36，并在答复里写明同意改 `vercel.json` 的 redirects 一段
D-36 没答复之前不开工。
**改动**：
- ENGINEERING §3.4 表里列的代码位置：`api/_cron-release.js` 的生产 origin、各接口的 CORS 白名单、邮件里的默认链接、canonical、i18n 里的域名；每处加测试。
- `vercel.json` 的 `redirects`：带 host 条件、`statusCode: 301`、排除 `/api/` 和 `/share` 前缀。这是 STOP-9 的唯一例外，前提是 Eric 在 D-36 的答复里同意。
- 先在 demo 项目的预览部署上验证 redirects 的写法（ENGINEERING §13 缺口 11），不碰生产。

**命令**（OMO 只做 GET/HEAD）：
```bash
curl -sI 'https://illinimarket.com/pages/index/index?x=1' | tee $EV/$TS-301.txt
```
**DoD**：
- ① 上面这条返回 301，Location 是新域名的同一路径、同一 query。
- ② Eric 对旧域名现有的一个 POST 接口发请求，返回码不是 3xx，结果留言（RUNBOOK §5 环境矩阵「生产」行）。
- ③ 每处改过的白名单都有测试覆盖两个域名；test 通过。
- ④ 旧域名跳转的最早停止日期（新域名启用日加 1 年）写进 DECISIONS 的 D-23。

**证据**：`$EV/<TS>-301.txt`、Eric 的留言。标签 [生产]
**回退**：Eric 去掉新域名上的 redirect，OMO revert 那段 `vercel.json`。

### BRAND.7 公开 demo 更新（D-15）

**目标**：原网址的公开 demo 换成玉米地的名称、板块名、视觉和首页结构，旧部署保留可回退。差异按 SPEC §14。
依赖：BRAND.1、BRAND.3、BRAND.4、P2.2、HOME.4、P1.13｜负责：OMO（预览）/ Eric（转正）｜Eric：E12，看过预览后本人 promote，并先记下当前的 production deployment id
**改动**：材料分支 `appendix/prototype/`（V4 的 `prototype/`，说明见该目录 README.md）。
**命令**：
```bash
cd ~/work/demo-publish
rsync -a --delete --exclude .vercel --exclude verify.js --exclude README.md $DOCS/appendix/prototype/ ./
git -C ~/work/illini-docs show 4e459bd:docs/community-platform/release/public-demo/vercel.json > vercel.json
git -C ~/work/illini-docs show 4e459bd:docs/community-platform/release/public-demo/robots.txt > robots.txt
# 然后按 RUNBOOK §9 ④ 部署预览并 curl
```
**DoD**：
- ① demo 用玉米地的名称、D-01 的板块名、D-35 选定的视觉和 D-24 的首页结构。
- ② 删掉每一行的「示例×××」标签，只在顶部留一条「演示站：内容均为虚构，操作只保存在这个浏览器」；标题和正文的上限改为 120 / 2000 字。
- ③ 预览部署 curl 返回 200；返回 401 时记下来，交 Eric 用浏览器看。
- ④ Eric promote 之后，`curl -s https://illini-community-demo.vercel.app/ | grep -c 玉米地` 不小于 1。
- ⑤ 回退用的旧 deployment id 记进 STATUS_LOG。

**证据**：demo-deploy 日志、curl 输出。标签 [生产]
**回退**：RUNBOOK §13「公开 demo」，Eric 做。

---

## 7 HOME 社区首页（D-24、D-03）

首页规格以 SPEC §5 为准。SPEC §5.1 写了它相对 `appendix/research/homepage.md` 改了哪些地方。HOME.2 在 #369 分支上做：它是纯函数和单测，不动界面。HOME.3–5 在 `codex/community-home-20261112`（`~/work/illini-home`，基于 #369 分支）上做。D-35 定之前，代码只用 App.vue 现有的 token，数值按 SPEC §9.2 的方向 A。

### HOME.1 三张视觉稿（D-03）

**目标**：给 Eric 选视觉方向的三份稿要经得起检查，同时装好后续任务共用的 axe。
依赖：P1.1；命令用 pw1.65 镜像，§2 的顺序已把它排在 P1.9 之后｜负责：OMO｜Eric：D-35，看稿后三选一
**现状**：三份稿已于 2026-11-12 产出，放在 `design/`（`direction-a.html` A 纸本书院，推荐；`direction-b.html` B 白底高密；`direction-c.html` C 图文双列），另有 27 张截图和 `design/README.md`。不搬到 `appendix/visual/home/`，免得 SPEC §9.1 的链接失效。OMO 不重画，只补 axe 复核：`design/README.md`「检查」一节写明对比度是脚本估算的，没有跑 axe。暗色和英文稿没有画，由 HOME.4 的截图矩阵补上。
**改动**：
- `~/work/illini-dev-env/tools/package.json`：`axe-core` 和 `opentype.js` 各固定一个版本，`playwright` 固定 1.65.0（与 pw1.65 镜像里的浏览器一致）。版本号写进 STATUS_LOG。
- `~/work/illini-dev-env/tools/page-audit.mjs`：打开静态 HTML，在 390 和 1280 下输出 axe color-contrast 违规数、<12px 文本节点数、390 宽横向溢出像素。
- 两个文件复制到 `appendix/env/tools/`，STATUS_LOG 记 sha256。
- 检查有违规时，三个 HTML 用同一种改法一起改。生成脚本不在仓库里，所以直接改 HTML。

**命令**：
```bash
cd ~/work/illini-dev-env/tools && npm install --no-audit --no-fund
for f in a b c; do for h in '' '#detail'; do
  podman run --rm --userns=keep-id -v ~/work/illini-dev-env/tools:/tools:ro -v $DOCS:/docs:ro localhost/illini-dev:pw1.65-node22-pg17 \
    node /tools/page-audit.mjs "file:///docs/design/direction-$f.html$h" --widths 390,1280; done; done | tee $EV/$TS-audit.json
```
**DoD**：
- ① `design/` 下 3 个 HTML 和 27 张 PNG 都在，文件名与 `design/README.md`「怎么看」一致。
- ② 结构符合 SPEC §5：桌面是 2×3 板块卡、全站最新、侧栏；手机按板块分节。
- ③ 站名「玉米地」，用占位印章。
- ④ 12 个页面和宽度的组合里，<12px 文本 0 个，axe color-contrast 0 违规。`·` 分隔点按 `design/README.md`「检查」一节的规定不计入。
- ⑤ STATUS 写「等待 D-35」。

**证据**：`$EV/<TS>-audit.json`。标签 [本地测]
**回退**：HTML 的改动 revert。

### HOME.2 首页数据层纯函数

**目标**：首页每一块放哪些帖子、怎么去重、什么时候隐藏，全部由一个可测的纯函数决定。读取方式见 ENGINEERING §7，区块规则和阈值见 SPEC §5.4、§5.5。
依赖：P2.5、REGION.1｜负责：OMO｜Eric：无｜分支：#369（`~/work/illini`）
**改动**：新增 `app/src/utils/communityHome.ts`，导出 `buildHomeSections(posts, items, events, now, viewport)`；新增单测 `app/smoke/community-home-sections.test.mjs`，fixture 放 `app/smoke/fixtures/community-home/`。
单测至少覆盖这些规则：
- 卡片顺序固定：校园日常｜落脚香槟／学长学姐说｜找搭子／吃喝好店｜二手好物；
- 每张卡桌面最多 4 行、手机最多 3 行；每张卡置顶最多 1 条；
- 同一作者在一张卡里最多 2 条；官方账号的帖子整页最多 3 条；
- 去重优先级：置顶 > 板块卡 > 全站最新 > 本周热议；
- 全站最新去重后不足 5 条时收成一行链接；
- 「本周 N 新帖」在 N≥3 时才显示；
- 本周热议的门槛：7 天内至少 5 帖，每帖至少 3 条回复，且来自至少 2 个不同用户；
- 7 天内写相对时间，更早的写「11月3日」这种格式；
- 计数为 0 时不显示；
- 行数不够时用该板块的补位文案「适合在这里问：… 发第一帖 ›」补齐。

**命令**：`$RC ~/work/illini install test`
**DoD**：5 组 fixture（20 帖、60 帖、某板块 0 帖、同一作者 5 帖、官方账号 5 帖）的单测全部通过；test 通过。
**证据**：test 日志。标签 [本地测]
**回退**：默认。

### HOME.3 首页结构（视觉选定前只用现有 token）

**目标**：社区 tab 的默认视图换成论坛首页，桌面和手机的布局按 SPEC §5.2、§5.3，样式暂用现有 token。
依赖：HOME.2、P2.2、P2.3｜负责：OMO｜Eric：无
**改动**：
- `app/src/pages/plaza/index.vue`：默认视图改为首页，原来的平铺列表移到「全部讨论」；
- 首页的区块组件；
- 新增 `app/smoke/visual-audit.ts`（§0.3 视觉验收在仓库内的那一层）；
- `app/smoke/contrast-runtime.spec.ts` 不用改，它已经覆盖 `pages/plaza/index`；
- 新增 `app/smoke/community-home.spec.ts`。

**命令**：
```bash
git -C ~/work/illini worktree add -b codex/community-home-20261112 ~/work/illini-home codex/community-topics-20261112
SMOKE_SPECS="$DEF community-home.spec.ts contrast-runtime.spec.ts" $RC ~/work/illini-home install test smoke
```
**DoD**：
- ① 390 宽从上到下：板块标签行、新来先看折叠条、近期活动（没有活动时不出现）、5 个板块分节各 3 条、二手新上架横滑、全站最新最多 10 条。
- ② 1280 宽：主栏 876px、侧栏 300px；主栏是 2×3 板块卡和全站最新 15 条（P3.4 之前只渲染「新发布」tab）；侧栏依次是新来先看、近期活动、本周热议、关于本站；首页不显示左侧栏。
- ③ 页头搜索的占位是「搜话题」，P4.10 之前只搜社区。
- ④ 20 帖 fixture 下，1280×800 时 6 张卡都满，全站最新收成一行；60 帖 fixture 下全站最新 15 行。
- ⑤ DOM 里每个 `data-post-id` 只出现一次；<12px 文本 0 个；页面上不出现计数「0」；新增 CSS 里 hex 字面量 0 个；smoke 日志有 `AXE color-contrast violations=0`。

**证据**：smoke 日志；`appendix/visual/HOME.3/` 下 390 和 1280 的截图。标签 [隔离环境 L-UI]
**回退**：默认。

### HOME.4 首页套用选定视觉

**目标**：首页和全站共用的视觉改动按 Eric 选定的方向落地。
依赖：HOME.3、HOME.1｜负责：OMO｜Eric：D-35
**改动**：
- 按 D-35 选定的方向改样式，只用 App.vue 的 token。选 B 或 C 时，先把选定方向的 token 表替换进 SPEC §9.2，再写代码；选 C 时还要先改 SPEC §5.4 第 3 条（SPEC §9.1）。
- SPEC §9.5 列的六项一起做。

**DoD**：
- ① SPEC §9.6 的视觉验收全部通过：<12px 文本 0 个，`AXE color-contrast violations=0`，新增 CSS 的 hex 字面量 0 个，390 横向溢出 0px。
- ② 截图矩阵：浅色/深色 × 中文/英文 × 390/768/1280，共 12 张，存 `appendix/visual/HOME.4/`，用 SPEC §9.6 的固定 fixture。
- ③ 与选定稿逐项对照的差异表写进 STATUS_LOG。

**证据**：12 张截图、smoke 日志、差异表。标签 [隔离环境 L-UI]
**回退**：默认。

### HOME.5 板块页与「全部讨论」的状态

**目标**：板块页和「全部讨论」在加载、失败、全空、没有搜索结果时都有确定的显示。规格见 SPEC §6.1、§6.2、§7。
依赖：HOME.3｜负责：OMO｜Eric：无
**改动**：板块页的页头、「全部讨论」的 tab；新增 `app/smoke/community-board-states.spec.ts`。
**DoD**：
- ① 板块页顶部有板块名、SPEC §3 的范围说明、「发话题」（预选该板块）；不足 3 条时显示补位文案。
- ② 「全部讨论」在 P3 之前有三个 tab：新发布｜热门｜关注的人。
- ③ 五种状态：
  - 加载中：3 行骨架；
  - 首次加载失败：「没加载出来，检查网络后再试」加「重试」；
  - 加载更多失败：「加载失败，点这里重试」；
  - 全空：「还没有话题。可以问一个具体的问题，比如：Urbana 哪里能买到便宜的书桌？」加「发话题」；
  - 搜索无结果：把搜索词预填进标题。
- ④ smoke 覆盖这五种状态，全部 passed。

**证据**：smoke 日志。标签 [隔离环境 L-UI]
**回退**：默认。

---

## 8 P3 订阅、收藏、通知、排序与治理

P3 的迁移在 #369 合并之前只在本地分支 `wip/P3.1` 上写，并在 L-SQL 上验；合并之后按 §1 的规则改成正式分支。表、列、RLS、触发器以 ENGINEERING §5.3 为准，每个批次都守 §5.0 的规则（同一提交里更新 manifest、README 计数句和 `release-migration-count-boundary` 的断言）。界面以 SPEC §6.4、§6.8、§6.9、§6.11 为准。

### P3.1 迁移：订阅、收藏、最后活跃时间与治理字段

**目标**：给订阅话题、收藏话题、按最新回复排序、新来先看、锁帖提供数据支撑。
依赖：P2.13｜负责：OMO｜Eric：无｜环境：L-SQL
**改动**：新迁移 `supabase/migrations/<UTC 时间戳>_community_watch_save_activity.sql`，`_ops` 下对应的 PRECHECK / VERIFY / REGRESSION，新增 PG 测试 `scripts/community-watch-save.test.mjs`。时间戳用 `date -u +%Y%m%d%H%M%S`，要晚于 main 上最新的迁移。
**命令**：
```bash
git -C ~/work/illini worktree add -b wip/P3.1 ~/work/illini-p3 codex/community-topics-20261112   # #369 合并前
$LSQL ~/work/illini-p3 <新迁移的时间戳>
$RC ~/work/illini-p3 install migrations test
# #369 合并后：cd ~/work/illini-p3 && git merge origin/main && git branch -m codex/community-p3-$(TZ=America/Chicago date +%Y%m%d)
```
**DoD**：
- ① 新建 `post_follows`、`post_bookmarks` 两张表：主键 `(user_id, post_id)`；RLS 只允许本人 SELECT 和 DELETE；INSERT 要求帖子 active、作者可见、双方没有互相拉黑。
- ② `posts` 新增三列：`last_activity_at timestamptz NOT NULL`（回填为 `greatest(created_at, 最新回复时间)`，插入回复时由触发器更新）、`is_featured boolean NOT NULL DEFAULT false`、`locked_at timestamptz`。
- ③ 索引 `(region, category, last_activity_at DESC, id DESC) WHERE status = 'active'`；迁移开头设了 `lock_timeout = '5s'`。
- ④ L-SQL 最后一行 `errors=0 done=1 rc=0`，日志里有新迁移的 PRECHECK、VERIFY、REGRESSION。
- ⑤ PG 测试全部通过：B 读不到 A 的订阅；对隐藏帖的订阅被拒；拉黑的双方互相收藏被拒。
- ⑥ 交给 Eric 之前冻结（§0.5 第 3 条）。

**证据**：lsql 日志、test 日志。标签 [隔离环境 L-SQL]
**回退**：冻结前直接改；冻结后另起迁移。

### P3.2 订阅话题与收藏话题的界面

**目标**：用户能在话题详情订阅和收藏话题，「我的」页能找到这两个列表。
依赖：P3.1｜负责：OMO｜Eric：无｜环境：L-UI
**改动**：`pages/post`（两个按钮）、我的页和收藏页、新页面（放进 subPackages）；新增 `app/smoke/community-watch-save.spec.ts`。
**DoD**：
- ① 话题详情有「订阅话题」（下面一行小字「有新回复时通知你」）和「收藏」。
- ② 「我的收藏」分「商品｜话题」两段。
- ③ 我的页顺序：头像与认证 → 通知 → 我的物品 → 我的话题 → 我的收藏 → 订阅的话题 → 关注的人 → 最近浏览 → 订阅的搜索 → 设置。
- ④ smoke：订阅、取消订阅、收藏、取消收藏之后，对应列表立即变化；全部 passed。
- ⑤ 新页面都在 subPackages 里。

**证据**：smoke 日志。标签 [隔离环境 L-UI]
**回退**：默认。

### P3.3 回复通知

**目标**：话题作者和订阅者在有新回复时收到站内通知。
依赖：P3.1｜负责：OMO｜Eric：无｜环境：L-SQL、L-UI
**改动**：
- 迁移里加 `AFTER INSERT ON post_comments` 触发器，调用 `private.enqueue_activity_notification`；
- `app/src/api/notifications.ts` 的跳转白名单；
- i18n 文案（SPEC §6.8）；
- 新增 `scripts/community-reply-notifications.test.mjs`。

**DoD**：
- ① 新增两种 body key：`comment_reply:<post_id>`（source_event_key 为 `comment-reply:<comment_id>`）和 `followed_post_reply:<post_id>`（`followed-reply:<comment_id>:<recipient>`）。排除回复者本人和已经收到同一事件的人；单次扇出最多 500 人。
- ② 白名单加入这两种 key。接收人和文案按 SPEC §6.8 与 ENGINEERING §5.3 通知表：`comment_reply` 发给被回复的那条回复的作者（「{昵称} 回复了你在「{标题前 20 字}…」下的回复」），话题作者仍收现有的 `post_comment`；`followed_post_reply` 是「你订阅的话题「…」有 {n} 条新回复」。同一话题在未读期间合并成一行；目标被隐藏后，点开显示「这条内容已不可见」。
- ③ 这两类通知不进 notification-digest 邮件。
- ④ PG 测试：C 回复 A 的话题、B 已订阅 → A 收 1 条，B 收 1 条，C 收 0 条；501 个订阅者 → 写入 500 行。全部通过。

**证据**：test 日志。标签 [隔离环境 L-SQL]
**回退**：默认。

### P3.4 排序与 keyset 翻页

**目标**：「最新回复」「待回答」两种排序可用，翻页不重复、不遗漏。
依赖：P3.1｜负责：OMO｜Eric：无
**改动**：`search_community_posts` 和列表查询（放进 P3 迁移）、`usePlaza.ts`；新增 `scripts/community-sort-keyset.test.mjs`、`app/smoke/community-sort-tabs.spec.ts`。
**DoD**：
- ① 支持 `sort_in = 'active'`（最新回复）、`'unanswered'`（待回答）、`'recent'`、`'hot'`（只算 14 天内发布的帖子），以及关注的人。
- ② 最新回复和新发布用 keyset 游标 `{last_activity_at 或 created_at, id}`；热门和搜索保留 offset。
- ③ 测试：给最旧的帖子加一条回复后，它在最新回复里排第一；两页之间插入新帖，第二页没有重复、没有遗漏。
- ④ 首页全站最新的三个 tab、「全部讨论」的五个 tab 都能用；smoke passed。

**证据**：test、smoke 日志。标签 [隔离环境 L-SQL]
**回退**：默认。

### P3.5 治理动作

**目标**：管理端能恢复、设官方、设新来先看、锁帖、改板块，每个动作都走现有的原子管理通道。
依赖：P3.1｜负责：OMO｜Eric：E6（官方账号 profile id）
**改动**：
- 新增 5 个动作：`restore_content`（hidden 改回 active，媒体移出隔离区，移回失败时返回 `media_restore_pending`）、`set_post_official`（只允许 `COMMUNITY_OFFICIAL_PROFILE_ID` 的帖子）、`set_post_featured`（只允许 `is_official` 的帖子）、`set_post_locked`、`set_post_category`。
- 每个动作同时改五处：
  1. `admin_mutation_requests.action` 的 CHECK（005ca9d 上定义在 `20260720035037_harden_admin_appeal_decisions_and_session_metadata.sql:283-296`，在新迁移里重建）；
  2. `admin_execute_mutation`；
  3. `api/admin/index.js` 的入参和结果校验；
  4. `pages/admin` 的按钮（只在 H5）；
  5. 审计动作名。
- 新增 `scripts/community-governance-actions.test.mjs`、`api/_admin-community-actions.test.mjs`。

**DoD**：
- ① 每个动作 1 条 PG 测试和 1 条 api 测试，全部通过。
- ② 对非官方帖执行 `set_post_featured` 返回错误。
- ③ 锁定的话题拒绝新回复，错误 key 为 `post_locked`。
- ④ P3 不做帖子编辑（列入 P6.1 候选）。

**证据**：test 日志。标签 [隔离环境 L-SQL]
**回退**：默认。

### P3.6 举报后各方看到什么，48 小时处理

**目标**：举报人、作者和其他人在举报前后看到的内容各自确定；管理端能看出哪条举报等得最久。规格见 SPEC §6.10。
依赖：P3.5｜负责：OMO｜Eric：无｜环境：L-UI
**改动**：举报提交后的提示、被隐藏内容的三种视图、管理端举报队列的排序和颜色；新增 `app/smoke/community-report-views.spec.ts`。
**DoD**：
- ① 举报人提交后看到「已收到，我们会在 48 小时内处理」。
- ② 被隐藏的内容：其他人看到「这条内容已被隐藏」，不显示标题、作者和图片；作者看到置灰的原文、原因和「申诉」。
- ③ 管理端举报队列按等待时长排序，超过 24 小时标黄，超过 48 小时标红。
- ④ smoke 覆盖举报人、作者、第三人三种视角，全部 passed。

**证据**：smoke 日志。标签 [隔离环境 L-UI]
**回退**：默认。

### P3.7 Eric 在 staging 应用 P3 迁移，CI 全绿

**目标**：P3 的迁移在 staging 上生效，P3 PR 的 CI 全绿。
依赖：P3.1–P3.6｜负责：Eric（应用）/ OMO（核对）｜Eric：按 E4 同一流程，把 P3 的迁移（以及 LEGAL.2、LEGAL.4 已经冻结的迁移）应用到 hygkwxugskijadgfisji
**DoD**：
- ① Eric 留言应用时间和 VERIFY 的输出。
- ② P3 PR 最新 CI run（RUNBOOK §7）里所有不是 skipped 的 job 都是 success。
- ③ STATUS 记 run id 和计数。

**证据**：PR checks。标签 [CI run#]
**回退**：RUNBOOK §13「staging 上的迁移」。

### P3.8 小程序包体核对

**目标**：P3 新加的页面不把主包撑过预算。
依赖：P3.2｜负责：OMO｜Eric：无
**命令**：`$RC ~/work/illini-p3 install mp`；基线是 #369 合并后的 main（先 `git -C ~/work/illini-main checkout --detach origin/main`，再对 `~/work/illini-main` 跑同一命令）。
**DoD**：
- ① P3 新页面都在 subPackages 里。
- ② 主包不超过 1.5 MiB，每个分包不超过 1.6 MiB。
- ③ 字节数和与基线的差值写进 STATUS。

**证据**：两边 mp 日志的 `packageBytes` 行。标签 [本地测]
**回退**：默认。

---

## 9 P4 活动（D-10）

产品规则（防乱规则、四种来源、卡片、状态、去重、网友发起的限制、空态）见 SPEC §6.7；表结构见 ENGINEERING §5.5；接入合同、同步、错误码、测试清单见 ENGINEERING §9；文件和页面路径见 ENGINEERING §8。代码标识用 SPEC §2 的写法（`source_type`、`campus`、`community_event_sync_state`、`COMMUNITY_OFFICIAL_PROFILE_ID`）。P4 的代码按 §1 先在 `wip/P4.1` 写，#369 合并后改成 `codex/community-events-<YYYYMMDD>`；P4.3 在 caaciorg 的 fork 上。

活动设计稿用 P4a–P4j 编号，对应关系如下：

| 设计稿编号 | 本清单 |
|---|---|
| P4a 纯函数与 fixture | P4.1 |
| P4b 迁移 | P4.2 |
| P4c 官网文章同步 | 不在首批，列入 P6.1 候选 |
| P4d 官网公开活动接口 PR | P4.3 |
| P4e 活动页、学校收录、合作组织管理 | P4.8、P4.7、P4.5 |
| P4f 同步任务 | P4.4 |
| P4g 活动讨论帖 | P4.9 |
| P4h 网友发起 | P4.6 |
| P4i 导航与首页侧栏 | P4.10 |
| P4j 官网接口 v2（状态字段） | 不在首批，列入 P6.1 候选 |

### P4.1 活动来源规则纯函数与 fixture

**目标**：四种来源的归一化、状态推导、跨来源去重和外链白名单，都在不联网的纯函数里写好、测好。
依赖：P1.9｜负责：OMO｜Eric：无｜分支：`wip/P4.1`（从 origin/main 建，目录 `~/work/illini-events`）
**改动**：新增 `api/_community-events.js`、`api/_community-events.test.mjs`、`app/src/utils/eventTime.ts`、`app/src/utils/eventLinks.ts`（`openExternalLink`）及其测试；fixture 放 `api/__fixtures__/community-events/`（下划线目录不会被当成 Vercel 函数，ENGINEERING §9.10）。
**命令**：
```bash
git -C ~/work/illini worktree add -b wip/P4.1 ~/work/illini-events origin/main
$RC ~/work/illini-events install test
```
**DoD**：
- ① 四种来源（caaci / partner / campus / member）都能归一化。
- ② 状态推导覆盖 SPEC §6.7.7 的每一种，至少包括：时间已更新（变动后 14 天内显示「原 {日期时间} CT」）；已结束（有效结束时间按 ENGINEERING §9）；来源已撤下；发起人已取消。
- ③ 跨来源去重：`register_url` 或 `page_url` 归一化后相同的只留一张，优先级 caaci > partner > campus > member。
- ④ 外链白名单：caaciorg.com、illinois.edu 及其子域、partner 记录里登记的域名。
- ⑤ fixture 包括 ENGINEERING §9.10 列的全部文件（P4.1 规定的 12 个加另外 10 个），邮箱一律写 `organizer@example.test`。
- ⑥ test 通过，并断言测试期间 `fetch` 被调用 0 次。

**证据**：test 日志。标签 [本地测]
**回退**：默认。

### P4.2 迁移：community_events 与同步状态

**目标**：四种来源的活动存在同一张表里，写入通道按来源分开。
依赖：P4.1、P2.13，并且 #369 已合并｜负责：OMO｜Eric：无｜环境：L-SQL
**改动**：
- 新迁移 `<UTC 时间戳>_community_events.sql`，内容按 ENGINEERING §5.5；配 PRECHECK / VERIFY / REGRESSION；按 ENGINEERING §5.0 同步 manifest、README 计数句和计数断言；
- 新增 `scripts/community-events.test.mjs`；
- `scripts/verify-public-read-schema.mjs` 加 community events 检查和 `rpc/list_community_events` 探测（ENGINEERING §9.10）。

**命令**：
```bash
cd ~/work/illini-events && git merge origin/main && git branch -m codex/community-events-$(TZ=America/Chicago date +%Y%m%d)
$LSQL ~/work/illini-events <新迁移的时间戳>
$RC ~/work/illini-events install migrations test
git push -u origin HEAD && gh pr create --draft --base main --repo $REPO --title 'feat: community events' --body-file $EV/$TS-pr-body.md
```
**DoD**：
- ① 表和列与 ENGINEERING §5.5 一致；来源字段取值只有 caaci、partner、campus、member。
- ② 同一来源的同一场活动只能有一行；没有书面同意记录的 partner 行，数据库拒绝写入。
- ③ `community_event_sync_state` 表存在。
- ④ 写入通道：anon 只能读可见行的白名单列；caaci 和 campus 行只能经 service_role 的 RPC 写；partner 行只能经 admin 动作写；member 行只能经 `create_member_event` 写。
- ⑤ L-SQL 最后一行 `errors=0 done=1 rc=0`；`community-events.test.mjs` 里本任务覆盖的 RLS 断言全部通过。
- ⑥ 草稿 PR 已开；交给 Eric 之前冻结。

**证据**：lsql 日志、test 日志。标签 [隔离环境 L-SQL]
**回退**：冻结前直接改；冻结后另起迁移。

### P4.3 官网 PR：GET /api/public-events v1（D-11）

**目标**：CAACI 官网提供一个只含已发布活动、不含任何报名或会员数据的公开接口，供社区同步。合同见 ENGINEERING §9.1。
依赖：P1.1｜负责：OMO（写 PR）/ 官网维护者（审阅、合并、上线）｜Eric：D-31 / E8（fork 权限）。令牌不能在上游开 PR 时，由 Eric 在网页开（E8 第 3 步）。
**改动**（caaciorg 仓库）：新增 `functions/api/public-events.js`（只导出 `onRequestGet`）；`test/api-auth-gates.test.js` 的 UNGATED 加一条；新增 `test/public-events.test.js`。
**命令**：
```bash
# E8 之前：只读 clone 上游，先在本地写
git clone https://github.com/a2751012962/caaciorg.git ~/work/caaciorg && cd ~/work/caaciorg
git remote rename origin upstream && git fetch upstream && git switch -c feat/public-events-feed upstream/preview
for v in 20 24; do podman run --rm --userns=keep-id -e HOME=/tmp -v ~/work/caaciorg:/w -w /w docker.io/library/node:$v-bookworm bash -lc \
  'npm ci && npm run lint && npm run typecheck && npm run format:check && npm run build -w web && npm test && npm run build'; done 2>&1 | tee $EV/$TS-caaciorg-ci.txt
# E8 之后：remote 布局与 RUNBOOK §3 一致（origin = fork，upstream = a2751012962）
git remote add origin https://github.com/EricXu-0805/caaciorg.git && git push -u origin feat/public-events-feed
# 上线之后才执行（只读 GET）
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' 'https://caaciorg.com/api/public-events?window=upcoming'
```
**DoD**：
- ① 参数、响应结构、缓存和 500 的固定正文都与 ENGINEERING §9.1 一致。
- ② 不输出报名问题、志愿者问题、`perk_*`、`image_url`，也不输出任何报名或会员数据（`test/public-events.test.js` 断言）。
- ③ caaciorg 的 lint、typecheck、format:check、build、test 在 Node 20 和 24 上都通过（与它的 CI 矩阵一致）。
- ④ PR 开向 preview，链接记进 STATUS。
- ⑤ 上线后从工作站请求一次，返回 200 JSON。Vercel 生产出口能不能访问，由 P4.11 的同步结果证明。返回 403 时，经 Eric 请官网维护者放行；不伪造 UA，不换出口。

**证据**：`$EV/<TS>-caaciorg-ci.txt`、PR 链接、curl 输出。标签 [本地测]（⑤ 为 [生产]）
**回退**：没合并时由 Eric 决定是否关 PR；合并之后由官网维护者按 caaciorg 的流程回退。

### P4.4 CAACI 活动同步

**目标**：官网活动定时同步进社区；官网撤下的活动最迟 30 分钟内不再展示。合同见 ENGINEERING §9.2。
依赖：P4.1、P4.2、P4.3｜负责：OMO｜Eric：无（生产上的开关和查看归 P4.11）
**改动**：
- 新增 `api/_community-events-sync.js`，由现有的 `api/background-jobs.js` 调用。文件名带下划线，不成为独立的 Vercel 函数；不新增 cron，不改 vercel.json。
- 新增 `scripts/sync-community-events.mjs`、`api/_community-events-sync.test.mjs`。

**命令**：
```bash
cd ~/work/illini-events && node scripts/sync-community-events.mjs --dry-run --source caaci | tee $EV/$TS-dry-run.json
$RC ~/work/illini-events install test
```
**DoD**：
- ① 只记录 HTTP 状态和错误码（ENGINEERING §9.9），不记上游的正文。
- ② 测试断言请求头里没有 `authorization` 和 `cookie`。
- ③ 连续两次完整同步都缺席才标 unavailable；L-SQL 用两次缺席的快照证明：官网撤下后最迟 30 分钟不再展示。
- ④ `--dry-run` 只读请求一次真实接口，打印归一化结果，不写库。
- ⑤ test 通过；`scripts/vercel-function-boundary.test.mjs` 的函数清单没有变化。

**证据**：`$EV/<TS>-dry-run.json`、test 日志。标签 [本地测]
**回退**：默认。生产上要停同步，由 Eric 关 ENGINEERING §9.2 写的环境变量开关。

### P4.5 合作组织转发活动

**目标**：官方账号能转发合作组织的活动；没有书面同意的转发进不了库。
依赖：P4.2｜负责：OMO｜Eric：D-32（首批合作组织名单和书面同意，每条转发都有授权记录编号）
**改动**：admin 动作（按 P3.5 的五处同步，动作名和字段按 ENGINEERING §9.4）、卡片的来源标签；测试加进 `scripts/community-events.test.mjs` 和 api 测试。同意书模板见 SPEC §6.7.11。
**DoD**：
- ① 只有官方账号能录入；必填主办方名称、原始公告链接、授权记录编号、开始时间、地点。
- ② 描述由站务自己写，不贴对方海报原文和图片；报名链接的域名必须在该组织登记的域名里。
- ③ 卡片显示「转发 · {组织名}」和「查看原页」。
- ④ 授权记录为空时数据库拒绝；PG 测试和 api 测试全部通过。
- ⑤ D-32 之前只用 L-UI fixture 验证，不录真实数据。

**证据**：test 日志。标签 [隔离环境 L-SQL]
**回退**：默认。

### P4.6 网友发起活动

**目标**：校园邮箱已验证的用户能发起活动，系统同时在「找搭子」开一条讨论话题；数量和内容都有限制。
依赖：P4.2、P3.1｜负责：OMO｜Eric：无（进生产之前 D-28 要有轮值伙伴：网友发起活动的举报要有人在 48 小时内处理）
**改动**：RPC `create_member_event`、活动页的「发起活动」入口和发起表单（分包，路径见 ENGINEERING §8）、测试。字段、限制、保留词见 SPEC §6.7.10 和 ENGINEERING §9.5；首发人工核对、改期在 V5 不做（SPEC §6.7.10 末条）。
**DoD**：
- ① 「发起活动」只对校园邮箱已验证的账号可用。
- ② `create_member_event` 在一个事务里写活动行（`source_type = 'member'`）和一条「找搭子」话题（作者是发起人），话题 id 写进 `discussion_post_id`。
- ③ 限制至少包括：每人同时最多 2 个未结束的活动；开始时间在未来 60 天内；标题最多 60 字。SPEC §6.7.10 写的其余限制一起做，每条各有测试。
- ④ 发起人可以取消，卡片显示「发起人已取消」；被举报隐藏后，卡片和话题一起隐藏。
- ⑤ PG 测试覆盖 ②–④ 的每一条，全部通过；删号断言按 ENGINEERING §13 缺口 12。
- ⑥ H5 和 mp-weixin 两个构建各走一遍发起和取消；小程序端走过 wechat-seccheck。

**证据**：test 日志、两个构建的截图。标签 [隔离环境 L-SQL]
**回退**：默认。

### P4.7 学校活动（UIUC 日历）

**目标**：先查清 UIUC 官方日历能怎么合规地接；Eric 定了之后，只收他选定的部分。
依赖：第一步只依赖 P1.1；第二步依赖 P4.1、P4.2｜负责：OMO（调研、写代码）/ Eric（D-33）｜Eric：D-33（看来源说明后定收录哪些日历、用哪种接入方式，并确认使用条款允许）
**第一步（不等 D-33）**：
- 只读 UIUC 官方日历的公开文档和 feed 说明，不抓 HTML 页面。
- 写 `appendix/research/campus-events.md`：可用的 feed 格式和地址、使用条款原文链接、候选日历清单、每周条数估计、被撤下的活动返回什么（ENGINEERING §13 缺口 8；文档没写就记「未知」）。
- ENGINEERING §9.3 已有 2026-11-12 的只读实测数，可以作为起点。重新请求核对时，每个地址只请求一次，文中写请求日期。
- 文中列出两种接入方式（逐条收录、按选定日历同步）各自的条数和风险；选哪种由 D-33 定。

**第二步（D-33 定后）**：
- 按选定的方式写代码（`api/_campus-ics.js`、`api/_campus-time.js` 及测试，ENGINEERING §8、§9.3），只收选定的日历；
- 学校活动在「全部」视图里的数量上限按 SPEC §6.7.11；
- 卡片只显示文字和「查看学校页面」，不显示图片。

**DoD**：
- ① `campus-events.md` 已提交，每个事实都有来源链接和请求日期。
- ② 第二步的 fixture 测试全部通过，`_campus-time` 的对照测试三个期望值全部通过。
- ③ 只有抓 HTML 才拿得到数据时，停这条，不写代码。

**证据**：`campus-events.md`、test 日志。标签 [源码 SHA]（第二步为 [本地测]）
**回退**：默认。

### P4.8 活动页与首页「近期活动」

**目标**：一个列表页和详情页把四种来源排清楚，首页侧栏只放近期的组织活动。规格见 SPEC §6.7.2–§6.7.12。
依赖：P4.1、P4.2｜负责：OMO｜Eric：无（视觉在 D-35 之前用现有 token）
**改动**：
- `pages/events/index`（主包，P4.10 要把它设为 tab）；详情页放分包，路径按 ENGINEERING §8；
- 页面接入 P4.1 写好的 `app/src/utils/eventLinks.ts#openExternalLink`；
- 首页的「近期活动」区块；
- 新增 `app/smoke/community-events.spec.ts`。`visual-audit.ts` 在 home 分支上：home 分支还没合并时，cherry-pick HOME.3 里新增这个文件的提交。

**DoD**：
- ① 页面拆分如上，mp 构建 `rc=0`。
- ② 筛选 chip「全部｜CAACI｜合作组织｜学校｜网友发起」；默认只列未结束、可见的活动，按开始时间升序。
- ③ 卡片包括日期块、标题（最多 2 行）、时间地点、来源标签（SPEC §2 的四种写法之一）。
- ④ 外链：先过 P4.1 的白名单；H5 用 `window.open(url,'_blank','noopener,noreferrer')`；小程序用 `setClipboardData`，按钮「复制报名链接」，toast「链接已复制，请在浏览器打开」；不用 web-view。
- ⑤ 未来 30 天没有活动时，首页「近期活动」隐藏；活动页的空态按 SPEC §6.7.12。
- ⑥ 卡片不渲染 `cover_url`、`image_url`，不改 CSP；`scripts/community-events-boundary.test.mjs` 通过（`app/src` 或 `api/` 出现 `wslzeqhipvibeflmxznh` 即失败）。
- ⑦ smoke 覆盖四种来源各 1 张卡和 SPEC §6.7.7 的状态；视觉验收通过；390 和 1280 截图存 `appendix/visual/P4.8/`。

**证据**：smoke 日志、截图。标签 [隔离环境 L-UI]
**回退**：默认。

### P4.9 活动「开讨论」与下架

**目标**：管理端能给一场活动开唯一的一条讨论话题，也能立即下架活动。合同见 ENGINEERING §9.7。
依赖：P4.2、P3.5｜负责：OMO｜Eric：E6
**改动**：admin 动作 `create_event_discussion` 和 `hide_event`，按 P3.5 的五处同步；测试。
**DoD**：
- ① `create_event_discussion`：话题作者是 `COMMUNITY_OFFICIAL_PROFILE_ID`，`is_official = true`，`category = 'events-social'`；同一个事务里执行 `update community_events set discussion_post_id = … where id = … and discussion_post_id is null`，更新 0 行就回滚，并返回已有的话题。
- ② `hide_event` 立即下架。
- ③ 两个动作都按五处同步。
- ④ 测试：两个连接同时点「开讨论」，最后只产生 1 个话题。

**证据**：test 日志。标签 [隔离环境 L-SQL]
**回退**：默认。

### P4.10 导航第二步（D-02、D-24）

**目标**：活动接通之后，底部 tab 换成「社区｜二手｜活动｜消息｜我的」，旧链接全部还能打开。规则见 SPEC §4.2、§4.5。
依赖：P4.8、P4.4｜负责：OMO｜Eric：核对前提是否满足，并在 PR 留言
**改动**：
- `app/src/pages.json`（tabBar；启动页改为 `pages/plaza/index`）、`CustomTabBar.vue`、`AppSidebar.vue`；
- `pages/index/index` 的 tab 文字改「二手」，标题栏加「＋ 发布」；社区页标题栏加「＋ 发话题」；
- 页头搜索；
- 新增 `app/smoke/legacy-routes-after-nav.spec.ts`。

**DoD**：
- ① 前提（SPEC §4.2）：P4.8 已完成，且生产上 CAACI 或学校至少一个来源有可见活动。
- ② tabBar 为 社区｜二手｜活动｜消息｜我的（Community｜Market｜Events｜Messages｜Profile）；`pages/publish` 路由保留，不删。
- ③ 页头搜索占位改为「搜话题、二手、活动」，结果分三个 tab，各自用现有的搜索。
- ④ smoke 断言 H5 上 SPEC §4.5 列的旧地址都还能打开，至少包括 `/#/pages/index/index`、`/#/pages/plaza/index`、`/#/pages/post/index?id=<uuid>`、`/share-post/<uuid>`。
- ⑤ 随 P4.11 和小程序同一版发布（D-12）。

**证据**：smoke 日志、390 和 1280 的 tab 截图。标签 [隔离环境 L-UI]
**回退**：默认。pages.json revert 后回到第一步的导航。

### P4.11 Eric：P4 迁移上 staging，生产发布

**目标**：活动功能在生产上线，同步结果正常。
依赖：P4.2、P4.4、P4.8、P4.9、P4.10｜负责：Eric｜Eric：按 E4 流程把 P4 迁移应用到 staging；生产迁移和发布按 E13；在生产设置 `COMMUNITY_OFFICIAL_PROFILE_ID`（E6）和 ENGINEERING §9.2 的同步开关
**DoD**：
- ① staging 的 VERIFY 输出留言。
- ② 生产 `community_event_sync_state` 的 `last_outcome = 'ok'`。
- ③ 生产活动页至少有 1 条非网友来源的可见活动。
- ④ 结果写进 STATUS_LOG。

**证据**：Eric 的留言。标签 [生产]
**回退**：RUNBOOK §13「H5 生产」「生产库」。

---

## 10 LEGAL 运营主体与法律底座（D-26）

依据是 `appendix/research/cold-start-legal.md`「建议方案」一、二节；技术部分见 ENGINEERING §10；运营主体的现状见 DECISIONS「运营主体」。LEGAL.2、LEGAL.4、LEGAL.5 的代码在 P3 分支上做。

### LEGAL.1 CAACI 主席或董事会正式同意以 CAACI 名义运营（D-37）

**目标**：拿到以 CAACI 名义运营玉米地的正式同意，范围包括对外表述「由 CAACI 志愿者维护」和「免费」。
依赖：无｜负责：Eric（提请）/ CAACI 主席与董事会｜Eric：向主席和董事会提请
**DoD**：STATUS_LOG 记同意日期、形式（董事会决议或主席书面邮件）和存放位置；DECISIONS 的 D-37 改为 decided。
**证据**：存放位置。标签 [真人]
**回退**：无。没有同意，LEGAL.2 不开工，运营方保持现状。

### LEGAL.2 社区条款与法律文本改为 CAACI 名义

**目标**：用户协议、隐私政策、社区守则改成由 CAACI 运营、服务名为玉米地，并加上版权与授权条款。
依赖：LEGAL.1、BRAND.1｜负责：OMO（起草）/ Eric（审定）｜Eric：审定文本；D-40 决定是否请律师
**改动**：
- `app/src/legal/{terms,privacy,guidelines}.{zh,en}.ts`、`app/src/pages/legal/index.vue:99-100` 的运营方、版本常量、i18n `reconsent.*`；
- 新迁移 `<UTC 时间戳>_accept_cornfield_consent_version.sql`，配 PRECHECK / VERIFY（ENGINEERING §5.4、§10.1）；
- 测试：`scripts/consent-version-deploy-order-boundary.test.mjs` 通过；新增 `app/smoke/legal-bilingual-parity.test.mjs`。

**DoD**：
- ① 运营方改为 CAACI。CAACI 的中文全称照抄 a2751012962/caaciorg 首页文案里的写法，PR 描述注明出处文件和行号。服务名改为「玉米地（Cornfield）」，注「原 Illini Market」。
- ② 加四条：作者保留版权；作者授予本站非独占的展示许可，范围写明网页和微信小程序，作者删帖即终止；禁止发布他人作品；转载必须已获授权并注明来源。
- ③ 加重复侵权者封号政策（17 U.S.C. §512(i)）和投诉入口（指向 LEGAL.4）。
- ④ 「广场」「评论」按术语表改。三份文本用同一个日期，版本只升一次。
- ⑤ 发布顺序：Eric 先把新版本的迁移应用到 staging 和生产，再发布升了版本的前端（ENGINEERING §10.1；2026-08-06 的事故就是顺序反了）。
- ⑥ `git grep -nI -E 'Illini Market|Illini 集市' -- app/src/legal | grep -v '原 Illini Market'` 从 17 行降到 0。
- ⑦ 中英文章节数相等的测试和现有的 legal、consent 测试全部通过；L-SQL 通过。
- ⑧ Eric 留言审定。

**证据**：test 日志、lsql 日志、Eric 的留言。标签 [本地测]（⑧ 为 [真人]）
**回退**：默认。迁移已应用之后只能另起迁移。

### LEGAL.3 DMCA 指定代理人登记（CAACI 名义）

**目标**：在美国版权局登记 CAACI 的 DMCA 指定代理人，让用户上传内容的安全港成立。
依赖：LEGAL.1｜负责：Eric｜Eric：D-38（代理人信息）；E9 第 3 步，在 copyright.gov/dmca-directory 登记并付 6 美元
**DoD**：STATUS_LOG 记登记编号、生效日、到期日（生效后 3 年）和续期提醒日（到期前 60 天）；LEGAL.4 页面上的代理人信息与登记一致。
**证据**：登记编号。标签 [真人]
**回退**：无。信息有误时重新提交。

### LEGAL.4 统一的版权投诉与撤稿入口

**目标**：一个入口同时满足美国 DMCA 和民法典第 1195–1197 条，48 小时内处理。规格见 SPEC §6.12，技术部分见 ENGINEERING §10.2。
依赖：LEGAL.2｜负责：OMO（页面、管理端）/ Eric（邮箱）｜Eric：D-39（收件邮箱）
**改动**：
- 新增 `app/src/legal/copyright.{zh,en}.ts`；`pages/legal/index` 增加 `type=copyright`；`app/public-brand-pages.ts` 的 `/terms` 页加 `id="copyright"` 一节。这份文档不进 reconsent 版本计算。
- 新迁移 `<UTC 时间戳>_copyright_notices.sql`（ENGINEERING §5.4）；admin 动作 `record_copyright_notice`（不带 id 新建、带 id 更新状态，ENGINEERING §5.4），按 P3.5 的五处同步。
- 新增 `app/smoke/copyright-page.test.mjs`。

**DoD**：
- ① H5 和小程序都能打开这个页面，中英文齐全，列出 17 U.S.C. §512(c)(3) 的六项要素，以及中国侧要求（权利人身份、作品、具体链接、权属证明、联系方式，对应民法典第 1195 条）。
- ② 流程写明：收到通知 → 转送发帖人 → 删除、屏蔽或断开链接等必要措施 → 反通知；目标 48 小时内处理。
- ③ 管理端能登记一条通知并关联被处置的内容；队列超过 24 小时标黄、超过 48 小时标红。
- ④ 测试断言两种语言都含六项要素，全部通过；L-SQL 通过。

**证据**：test 日志、页面截图。标签 [本地测]
**回退**：默认。

### LEGAL.5 审核规则的措辞与「新来先看」的边界

**目标**：守则和管理端只把审核写成违法、垃圾、隐私筛查，不出现编辑精选。规则见 ENGINEERING §10.4。
依赖：LEGAL.2、P3.5｜负责：OMO｜Eric：无
**DoD**：
- ① 社区守则和管理端文案把审核只写成「违法内容、垃圾信息、个人隐私信息筛查」。
- ② `git grep -nI -E '精选|编辑推荐' -- app/src` 保持 0 行（005ca9d 基线也是 0）。
- ③ `set_post_featured` 只接受 `is_official` 的帖子（P3.5 的测试覆盖）。
- ④ 审核记录沿用现有的审计表保留。

**证据**：grep 输出。标签 [本地测]
**回退**：默认。

### LEGAL.6 运营负责人表填满（D-08、D-28）

**目标**：四项运营职责都有人、有每周小时数。
依赖：无｜负责：Eric｜Eric：D-28（轮值伙伴人名和四项职责的每周小时数）
**DoD**：DECISIONS「运营负责人」表的四行（内容维护、回复承接、举报处理、活动信息核对）都有人名和每周小时数，没有空格。任一格为空就不进 P5。
**证据**：DECISIONS 的提交。标签 [真人]
**回退**：无。

---

## 11 CONTENT 冷启动内容（D-25）

做法和模板见 `appendix/research/cold-start-legal.md`「建议方案」三至五节；站内的写法和署名见 SPEC §13；政策见 DECISIONS「冷启动内容政策」。这一组全部由真人完成。OMO 不浏览外站，也不访问 E11 的两张私有表格（RUNBOOK STOP-11）。

### CONTENT.1 问题库（人工收集）

**目标**：从外站人工收集新生最常问的问题，只记问题，不搬内容。
依赖：无｜负责：Eric 和轮值伙伴｜Eric：E11，在 CAACI 名下建私有表格
**DoD**：
- 私有表格里有 60–80 条问题，只有 5 列：问题（用自己的话写一句）、对应板块、原帖链接、日期、是否敏感；聚成约 20 个主题。
- 全程人工浏览，尽量在未登录状态下；不跑脚本，不用无头浏览器、镜像站或 SERP。
- STATUS_LOG 只记条数和主题数。

**证据**：条数。标签 [真人]

### CONTENT.2 20 篇原创指南

**目标**：每个主题写一篇自己的指南，事实引官方来源。
依赖：CONTENT.1｜负责：Eric、轮值伙伴、志愿者｜Eric：无
**DoD**：
- 每个主题 1 篇，共 20 篇。事实引 UIUC、ISSS、MTD、市政府等官方页面，写「最后核实：YYYY-MM-DD」。
- 不照搬他人帖子的表达和细节；LLM 只用来润色自己写的稿子。
- 「吃喝好店」只写自己去过的店，标「编辑亲测」，照片自己拍。
- 生产发布后由作者本人或官方账号发出，署名「整理：{实名}」。
- STATUS_LOG 记篇数和板块分布。

**证据**：篇数。标签 [真人]

### CONTENT.3 邀请 CAACI 校友和董事作答

依赖：P5.2｜负责：Eric｜Eric：本人一对一邀请
**DoD**：10–20 位 CAACI 校友、董事、学长学姐各认领 1–2 个问题，用本人账号回答；STATUS_LOG 记确认人数和已回答数。
**证据**：人数。标签 [真人]

### CONTENT.4 一对一授权请求与授权记录

依赖：无｜负责：Eric 和轮值伙伴｜Eric：E11，授权记录表
**DoD**：
- 授权请求只用 cold-start-legal.md 第五节的模板 C、D、E，一对一发送，每周不超过 10 条；不群发，不替人开号。
- 每篇授权转载发布前都有一行授权记录，字段为作者、平台、原文链接、授权凭证截图、授权范围、展示范围（网页 / 小程序 / 是否含中国大陆）、期限、能否撤回、署名方式、允许的改动、是否无偿、日期。
- 正文开头用模板 B 的署名行；知乎内容加「发表于知乎」。

**证据**：授权记录的条数。标签 [真人]

### CONTENT.5 外站导读（不定期）

依赖：P5.2｜负责：Eric 和轮值伙伴｜Eric：每篇发布前过目
**DoD**：每篇 3–5 个讨论串；每串自己的概括不超过 150 字，最多引 1 句原文，附链接和模板 A 的署名（敏感话题不写用户名）。不做每周固定栏目；一亩三分地不作固定来源；不截图，不搬图。
**证据**：篇数。标签 [真人]

### CONTENT.6 上线内容门槛

依赖：CONTENT.2、CONTENT.3、P5.5｜负责：Eric｜Eric：在生产运行 P5.5 的只读查询
**DoD**：5 个讨论板块各有至少 4 条真人话题；二手至少 3 件在售的真实商品；新来先看 3–5 条；计数写进 STATUS_LOG。
**证据**：查询输出。标签 [生产]

---

## 12 P5 内测

### P5.1 内测门槛核对

依赖：P2.13、P3.7、P4.11、LEGAL.1–LEGAL.6、BRAND.5｜负责：OMO（整理清单）/ Eric（确认）｜Eric：答复 D-36（内测前提醒）；D-28、D-37 已定
**开始条件**：上面的依赖都已通过。
**DoD**：STATUS 门槛表的六行都是「通过」：P2、P3 已在生产（Eric 发布）；活动页至少有一个非网友来源可见；LEGAL.1–6 完成；小程序已改名、可以提审；D-36 已答复（已注册，或明确延后）；RUNBOOK §13 写了 H5 和小程序的回退办法，并补上 ENGINEERING §13 缺口 4 的结论。

### P5.2 H5 与小程序同时发布（D-12）

依赖：P5.1｜负责：Eric｜Eric：E13（H5 按 docs/SUPERVISED_RELEASE.md；小程序提审并发布）
**开始条件**：P5.1 全部通过；D-30 的服务类目核对结果允许用户发帖和网友发起活动。
**DoD**：H5 和小程序在同一天上线；iOS、Android 真机各 1 台走完发话题、回复、关联商品、复制报名链接 4 步；结果写进 STATUS_LOG。
**回退**：RUNBOOK §13。

### P5.3 5–8 人主持任务测试

依赖：P5.2、CONTENT.6｜负责：Eric 和轮值伙伴｜Eric：约测试者并主持
**DoD**：至少 5 场。每场的任务是：找一件商品并联系卖家；在合适的板块发一个问题；回复一条讨论；判断一个活动能不能报名；举报一条失效的内容。记录每项是否完成、出错处、停顿和原话。发现的问题进本清单，编号 P6.1-xx。AI 模拟的测试不计入。

### P5.4 邀请 30–60 人内测

依赖：P5.3｜负责：Eric｜Eric：定邀请文案，本人发送
**DoD**：邀请 30–60 人，STATUS_LOG 只记人数；开始日期写进 DECISIONS「试点指标」表的统计窗口。

### P5.5 试点指标只读查询

依赖：P3.1｜负责：OMO（写查询）/ Eric（在生产运行）｜分支：P3 分支｜Eric：每周在生产运行一次
**改动**：`scripts/pilot-metrics.sql`（只读，按周参数化）；`scripts/pilot-metrics.test.mjs`（在 L-SQL 合成数据上跑）。
**DoD**：查询算 4 项，排除官方账号和合成账号，在 L-SQL 合成数据上返回 4 行，定义与 DECISIONS「试点指标」表逐字一致。4 项是：求助帖 24 小时真人回复率（目标 70%，不足 10 帖只报数）、D7 留存（目标 25%，n≥40 才判定）、贡献者数（目标 10–15）、审核样例数（目标 60 条中英）。

---

## 13 P6–P8 内测之后

### P6.1 根据证据调整

依赖：P5.4｜负责：OMO 和 Eric｜Eric：每个迭代选 1–2 个问题
**开始条件**：内测跑满一个统计窗口，P5.5 至少出过一次周报。
**DoD**：每个迭代只改 1–2 个证据最强的问题，改前改后的指标都写进 STATUS_LOG。
**候选**：官网文章（周报）收录（设计稿 P4c）；官网接口 v2，让 CAACI 活动能显示「已取消」「已延期」（设计稿 P4j）；标题双语 `title_i18n`；`verify-miniprogram` 进 CI；帖子编辑；2027-01 评估「动态」的去留（D-05）；开放第二个地区（如芝加哥）的条件；首页阈值调整；到期移除「原 Illini Market」说明（日期见 BRAND.1 ③）；P5.3 发现的问题（P6.1-xx）。

### P7.1 外部身份、商业权益与「玉米粒」积分

依赖：P6.1｜负责：Eric｜Eric：运营主体、真实供给、价格和业务责任都确认之后才立项
**开始条件**：Eric 批准独立提案。
**DoD**：账户关联由用户主动证明两端身份，并且可以撤销；资格由来源服务签发，有效期和撤销的语义清楚，浏览器不能自行授予；「玉米粒」（D-22）作为积分 / 会员积分的名称；这一批完成之前，界面上不出现购买按钮或假的会员等级。

### P8.1 AI 与自有售票的独立提案

依赖：P6.1｜负责：Eric｜Eric：是否立项
**开始条件**：人工流程和数据边界都稳定之后才写提案。
**DoD**：提案写明任务、评测方法、数据来源与权限、删除如何传播、成本、失败时的提示和人工接管；售票另外需要库存、支付、退款、核销、客服和主办方授权的负责人；Eric 批准之前不写代码。

---

## 14 新情况判断表

遇到下表没有的情况，按最接近的一行处理，并在 STATUS_LOG 记一条「新情况」。「停这条」「全停」的含义见 §0.1；能对上 RUNBOOK STOP 清单的，按 STOP 清单。

| # | 情况 | 处理 | 继续还是停 |
|---|---|---|---|
| 1 | HEAD 与 STATUS 的 code_sha 不同，或工作区有不是本任务产生的改动 | 不动这些改动，按 STOP-1 留言 | 全停 |
| 2 | origin/main 比 STATUS 的基线新 | `git log <基线>..origin/main --stat`。只动了文档或与本任务无关的文件：更新 STATUS 的基线，继续。动了迁移、ci.yml、package*.json 或本任务要改的文件：报 Eric | 后一种停这条 |
| 3 | test 出现 `fail` 大于 0 | 在同一个镜像里对 `~/work/illini-main` 跑同一命令。main 也失败：既有问题，记进阻塞项。只有本分支失败：本任务修 | main 也失败时停这条 |
| 4 | `skipped` 不等于 1，或 `pg_skips` 不为 0 | 判环境失败，按 RUNBOOK §4 修镜像，不写「通过」 | 修好前停这条 |
| 5 | 同一个 spec 时过时不过 | 连跑 3 次，有 1 次失败就算失败；不加 retries，不调 timeout 掩盖问题 | 按第 29 行 |
| 6 | CI 某个 job 失败，本地通过 | 按 RUNBOOK §7 读 `--log-failed`。浏览器依赖类看 P1.5、P1.9；public sweep 的 400 先查 P2.1 的预检为什么没拦住；其他按第 29 行 | 视情况 |
| 7 | install 之后 lockfile 变了，或者要新增、升级依赖 | 不提交，记下变化 | 停这条（STOP-8） |
| 8 | 依赖审计出现基线 44 个以外的新漏洞 | 记包名和 advisory 编号，按 D-41 的方式报 Eric；不用 `--force` | 依赖修复停，其他继续 |
| 9 | 拉不到某个镜像标签（例如 v1.65.0-noble） | 停在 P1.9，STATUS 写阻塞，不换别的基础镜像（RUNBOOK §4.3 ④） | 停这条 |
| 10 | staging 用 anon key 返回 401 或 403 | 只按 RUNBOOK §5.2「前提与自检」自检，不打印 key | 停这条，等 E3 |
| 11 | staging 里看到不像合成数据的账号或内容 | 不截图、不记内容，STATUS 只写「staging 疑似有真实数据」 | 全停，等 Eric |
| 12 | 20261112120000 冻结之后发现缺陷，Eric 还没应用 | 报 Eric。Eric 在 PR 留言同意后，STATUS_LOG 写「撤销冻结」和原因，改完重新冻结。Eric 已经应用：另起新迁移 | 停这条 |
| 13 | Eric 应用迁移之后，VERIFY 的输出与 L-SQL 不一致 | 附上两边的输出 | 全停 |
| 14 | merge 冲突落在迁移文件或 `manifest.sha256` 上 | `git merge --abort` | 停这条 |
| 15 | merge 冲突在 i18n 或 pages.json | 按 §1 的取法解决，跑全量 | 继续 |
| 16 | gh 返回 403（令牌权限不够，例如读 Variables、在上游开 PR） | 不找别的令牌，记下需要的权限，交 Eric。`gh run rerun` 的 403 按 RUNBOOK §7「重跑」换别的办法 | 停这条 |
| 17 | caaciorg.com 的接口返回 403（从工作站或生产同步） | 记 `http_403_edge`，经 Eric 请官网维护者放行；不伪造 UA，不换出口 | 停这条 |
| 18 | UIUC 的数据只能靠抓 HTML 才拿得到 | 只交调研文档 | 停这条（P4.7） |
| 19 | 任务依赖的 D 编号仍是 open | 不替 Eric 选 | 跳到下一条（STOP-15） |
| 20 | Eric 的 PR 留言与 V5 文档不一致 | 不带 `[OMO]` 前缀的评论视为 Eric 本人所写。以留言为准，链接记进 STATUS_LOG；涉及决定的，把原话抄进 DECISIONS 对应的 D 编号 | 继续 |
| 21 | 仓库、日志、截图、PR 里出现了凭据 | 不推送；已经推送的报 Eric（换凭据是 Eric 的事） | 全停 |
| 22 | 预览部署 curl 返回 401（Vercel 部署保护） | 记下状态码，交 Eric 用浏览器看（E12） | 继续 |
| 23 | 小程序主包超过 1.5 MiB 或分包超过 1.6 MiB | 把新页面移进分包；移不动就报 Eric | 移不动时停这条 |
| 24 | `design/` 的稿、homepage.md 与 SPEC 写法不同 | 以 SPEC 为准（SPEC §5.1、§9.1 已列出差异） | 继续 |
| 25 | 磁盘空闲低于 RUNBOOK §1 的阈值，或别人的进程占满资源 | 不开新容器，告诉 Eric；不动 Tony、danny 的进程、容器和文件 | 等待 |
| 26 | 收到版权投诉、举报或用户来信（任何渠道） | OMO 不回复，转 Eric，走 LEGAL.4 的流程 | 继续本任务 |
| 27 | 模型额度用完，或会话要中断 | 把没提交的改动提交到本地任务分支（不推送），STATUS 写当前任务和下一步 | 停 |
| 28 | V5 文档与源码不一致 | 以源码为准继续，STATUS_LOG 记一条；影响 STOP 清单、数据归属或授权边界时停 | 视情况（STOP-16） |
| 29 | 同一个失败修了两轮还不过 | 附日志路径和两次尝试的差异 | 停这条（STOP-14） |
