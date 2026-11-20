# RUNBOOK · tony-ws 操作手册

起草：2026-11-12 CT，Claude 按 Eric 2026-11-12 的决定起草。读者是 OMO：它在 tony-ws 的 tmux 会话里执行，没有任何聊天上下文。

本文件只回答「在 tony-ws 上怎么做」。其余内容各有归属：

- 做哪个任务、做到什么算完：[BACKLOG.md](BACKLOG.md)。通用变量 `$RC`、`$REPO`、`$D`、`$EV`、`$DOCS` 的定义也在那里（§0.2），本文件照用。
- 当前 SHA、CI 结论、next_task_id：[STATUS.md](STATUS.md)
- 为什么这样定：[DECISIONS.md](DECISIONS.md)
- 每个 CI job 的预期结果，以及迁移与发布规程的出处：[ENGINEERING.md](ENGINEERING.md)

证据：工作站的路径、版本和脚本内容来自 2026-11-12 对 tony-ws 的只读核对（ssh 读文件，外加一次 `podman run --rm` 查版本）[本地测]；仓库里的命令和行号来自 005ca9d 与 7b18f20 [源码]。在 tony-ws 上还没跑过的步骤，行内标「未实测」；第一次跑时把结果记进 STATUS_LOG。

章节：1 工作站约定 · 2 工具链核对 · 3 目录与 worktree · 4 测试镜像与 run-checks.sh · 5 环境矩阵（L-SQL、S-1、L-UI） · 6 测试汇报规则 · 7 读 CI 与重跑 · 8 状态写回 · 9 Vercel 护栏与 demo 预览 · 10 omo 的配置 · 11 Eric 一次性准备 E1–E14 · 12 STOP 清单 · 13 回退步骤

## 1 工作站约定

硬件、版本和账号清单记在 [STATUS_LOG.md](STATUS_LOG.md) L03。下表只列会影响操作的约定。

| 项 | 约定 |
|---|---|
| 共用 | tony-ws 与 Tony、danny 共用。只动 `/home/guoyi` 下的文件，不碰别人的进程、容器和文件，不用 sudo |
| umask | 022，写在 .bashrc 末行。新建 worktree 或文件前，`umask` 要输出 `0022`。目录组可写会让测试失败，2026-11-12 首轮 14 个失败里有一类就是这个原因 |
| 时区 | 系统时区是 UTC。run-checks 的日志和 `$EV` 下的证据文件名用 UTC 时刻（BACKLOG §0.2 的 `$TS`）；`.before-*` 备份文件的后缀用 CT 日期 `$D`；STATUS 和 STATUS_LOG 里的时间一律写 CT：`TZ=America/Chicago date '+%Y-%m-%d %H:%M CT'` |
| PATH | .bashrc 把 `~/.local/opt/node/bin`（Node 22.23.5、npm、vercel）和 `~/.local/bin`（omo）加进 PATH，只有交互 shell 生效。2026-11-12 实测 `ssh tony-ws node -v` 报 command not found；从 Mac 单跑一条命令要写成 `ssh tony-ws "bash -ic 'node -v'"` |
| 宿主机 PostgreSQL | 只有 18（/usr/lib/postgresql/18），没有 17。SQL 测试只在容器里跑；宿主机上不设 PG_BIN_DIR，也不把它指向 18 |
| 资源 | Playwright worker 不超过 6 个（仓库配置是 1，保持不动）。同一时间最多跑 1 个 run-checks 容器和 1 个 L-SQL 容器。容器一律带 `--rm` 或用完 `podman rm -f`，`podman ps -a` 里不留以 `illini-` 或 `lsql-` 开头的容器。`df -h ~` 显示空闲不到 50 GB 时，停下告诉 Eric |
| 长任务 | 在 tmux 里跑（会话 `omo`，或用 `tmux new-window -t omo` 新开窗口），ssh 断开不会中断 |

## 2 工具链核对

每次开工都按顺序执行下面的命令，注释是期望输出。第一次执行就是 BACKLOG 的 P1.1。

```bash
node -v                                    # v22.23.5
npm -v                                     # P1.2 ④ 之前是 10.8.2（已知偏差，见 §2.2）；之后是 10.9.x
umask                                      # 0022
gh auth status 2>&1 | grep -c 'account EricXu-0805'          # 1（整段输出贴进证据前删掉含 Token 的行）
podman --version                           # podman version 5.7.0
podman images --format '{{.Repository}}:{{.Tag}}' | grep illini-dev
                                           # localhost/illini-dev:pw1.60-node22-pg17（P1.9 之后另有 pw1.65-node22-pg17）
podman ps -a --format '{{.Names}}' | grep -cE '^(illini-|lsql-)'   # 0
vercel whoami                              # ericxu-0805
find ~/work -name .vercel -type d          # P1.13 之前无输出；之后只有 /home/guoyi/work/demo-publish/.vercel
git -C ~/work/illini fetch origin
git -C ~/work/illini status --porcelain    # 无输出
git -C ~/work/illini rev-parse HEAD @{u}   # 两行相同，且等于 STATUS.md 的 code_sha
git -C ~/work/illini-docs fetch origin
git -C ~/work/illini-docs status --porcelain                 # 无输出
git -C ~/work/illini-docs rev-parse --abbrev-ref @{u}        # E1 之后是 origin/codex/community-plan-v5
git -C ~/work/illini-docs pull --ff-only
grep -m1 -oE 'next_task_id: [A-Z]+[0-9]*[.][0-9]+' ~/work/illini-docs/docs/community-platform/STATUS.md
df -h ~ | awk 'NR==2{print $4}'            # 不低于 50G
```

不符时这样处理：

| 现象 | 处理 |
|---|---|
| node 不是 v22.23.5 | 不另装 Node，按 STOP-1 停下 |
| 工作区有不是本任务产生的改动 | 不 stash、不 reset、不 clean，按 STOP-1 停下 |
| HEAD 落后 @{u}，且 @{u} 等于 STATUS 的 code_sha | `git -C ~/work/illini pull --ff-only` 后继续 |
| HEAD 或 @{u} 与 STATUS 的 code_sha 不同（上一行的情况除外） | 按 STOP-1 停下 |
| 有以 `illini-` 或 `lsql-` 开头的残留容器 | rootless podman 只列出 guoyi 自己的容器，`podman rm -f <名字>` 删掉，在 STATUS_LOG 记一句 |
| `find` 找到 demo-publish 以外的 .vercel | 按 STOP-7 停下 |

### 2.1 材料 worktree 切到 V5 分支（P1.1 ④）

OMO_PROMPT 第 2 条已经切过时，下面这段只做 `pull --ff-only`，可以重复执行。

```bash
git -C ~/work/illini-docs fetch origin
if [ "$(git -C ~/work/illini-docs rev-parse --abbrev-ref HEAD)" = codex/community-plan-v5 ]; then
  git -C ~/work/illini-docs pull --ff-only
  git -C ~/work/illini-docs rev-parse --abbrev-ref @{u}      # origin/codex/community-plan-v5
elif git -C ~/work/illini-docs ls-remote --exit-code --heads origin codex/community-plan-v5 >/dev/null; then
  git -C ~/work/illini-docs switch --track origin/codex/community-plan-v5
  git -C ~/work/illini-docs rev-parse --abbrev-ref @{u}      # origin/codex/community-plan-v5
else
  echo '远端还没有 codex/community-plan-v5：STATUS_LOG 记「等待 E1」，P1.1 其余各项照做'
fi
```

### 2.2 宿主机 npm 恢复为 Node 自带版本（P1.2 ④）

2026-11-12，宿主机的 `~/.local/opt/node-v22.23.5-linux-x64/lib/node_modules/npm` 已被覆盖成 10.8.2。下面的做法只替换这一个目录，同一前缀下装的 Vercel CLI 不受影响，`~/.local/opt/node` 软链也不用动。

```bash
V=v22.23.5; P=$HOME/.local/opt/node-$V-linux-x64; T=$(mktemp -d)
cd "$T" && curl -fsSLO https://nodejs.org/dist/$V/node-$V-linux-x64.tar.xz && curl -fsSLO https://nodejs.org/dist/$V/SHASUMS256.txt
grep " node-$V-linux-x64.tar.xz\$" SHASUMS256.txt | sha256sum -c -     # node-v22.23.5-linux-x64.tar.xz: OK
mv "$P/lib/node_modules/npm" "$HOME/.local/opt/npm-10.8.2.before-P1.2-$D"
tar -xJf node-$V-linux-x64.tar.xz -C "$P" --strip-components=1 node-$V-linux-x64/lib/node_modules/npm
hash -r; npm -v                                   # 10.9.x
readlink -f ~/.local/opt/node/lib/node_modules/vercel/dist/vc.js   # 文件仍在
rm "$T"/node-$V-linux-x64.tar.xz "$T"/SHASUMS256.txt && rmdir "$T"
```

回退：把 `npm-10.8.2.before-P1.2-$D` 移回 `$P/lib/node_modules/npm`。

## 3 目录与 worktree

各分支装哪些任务、PR 怎么开，见 [BACKLOG.md](BACKLOG.md) §1。下表补充每个目录在 tony-ws 上的用途和建法。`<YYYYMMDD>` 填建分支当天的 CT 日期。

| 目录 | 分支 / HEAD | 用途 | 建法 |
|---|---|---|---|
| ~/work/illini | codex/community-topics-20261112（PR #369） | 主 clone，`.git` 在这里 | 已有 |
| ~/work/illini-docs | codex/community-plan-v5 | 读本套文件；写 STATUS、STATUS_LOG、appendix/ | 已有；按 §2.1 切分支 |
| ~/work/illini-config | codex/config-fixes-20261112 | P1.2–P1.6 | `git -C ~/work/illini worktree add -b codex/config-fixes-20261112 ~/work/illini-config origin/main` |
| ~/work/illini-main | 游离在 origin/main | S-1 的 main 基线（P1.11、P1.12），只读，不提交 | `git -C ~/work/illini worktree add --detach ~/work/illini-main origin/main`；main 前进后执行 `git -C ~/work/illini-main checkout --detach origin/main` |
| ~/work/illini-brand | codex/brand-cornfield-20261112 | BRAND.x 代码 | `git -C ~/work/illini worktree add -b codex/brand-cornfield-20261112 ~/work/illini-brand origin/main` |
| ~/work/illini-7b18f20 | 游离在 7b18f20 | P2.10 的包体基线，只读，不提交 | `git -C ~/work/illini worktree add --detach ~/work/illini-7b18f20 7b18f20`；P2.10 做完执行 `git -C ~/work/illini worktree remove ~/work/illini-7b18f20` |
| ~/work/illini-home | codex/community-home-20261112 | HOME.3–HOME.5、P2.12（HOME.2 在 #369 分支上做，BACKLOG §1） | `git -C ~/work/illini worktree add -b codex/community-home-20261112 ~/work/illini-home codex/community-topics-20261112`；#369 前进后用 `git merge` 跟进 |
| ~/work/illini-mpbudget | codex/community-mp-budget-20261113（PR #375） | 小程序主包腾空间（D-45 第 4 项、D-46 第 4 项）；base 是 #369 的分支 | `git -C ~/work/illini worktree add -b codex/community-mp-budget-20261113 ~/work/illini-mpbudget codex/community-topics-20261112` |
| ~/work/illini-deps | codex/deps-crossmajor-20261113（PR #373） | P1.6 跨大版本依赖（D-44 第 3 项）；base 是 #371 的分支 | `git -C ~/work/illini worktree add -b codex/deps-crossmajor-20261113 ~/work/illini-deps codex/config-fixes-20261112` |
| ~/work/illini-restricted | codex/community-restricted-20261113（PR #377，草稿） | D-49 受限账号的服务端拦截与客户端（D-51 第 5 项）。D-52 第 1 项起 base 是 #374 的分支 `codex/community-home-20261112`（取代 D-49 第 2 项「#369 合进 main 以后改成 main」的规则）；删 #374 的分支之前先把 #377 的 base 改成 main，#374 若 squash 合并，改完 base 再 merge 一次 origin/main | `git -C ~/work/illini worktree add -b codex/community-restricted-20261113 ~/work/illini-restricted codex/community-topics-20261112`；跟进 #374 用 `git merge` |
| ~/work/illini-ci-runner | codex/config-ci-runner-20261119（PR #376，草稿，base main） | 只改 CI 的草稿 PR（D-51 第 4 项、D-52 第 3 项）：ci.yml（§12 第 9a 条的例外）和 docs/NPM_DEPENDENCY_TRIAGE.md 两个文件 | `git -C ~/work/illini worktree add -b codex/config-ci-runner-20261119 ~/work/illini-ci-runner 7b18f20` |
| ~/work/illini-d46-integration | 本地 local/d46-final-integration-20261114 | 五个 PR 的本地集成试合（D-46 第 5 项），不推送 | 从 #374 head 建；只 merge |
| ~/work/illini-d51-seal | 本地 wip/d51-seal-integration | 「集」字印章测试的本地集成（D-51 第 3 项 b），不推送 | 从 #374 head 建；照 412e14d 的做法 merge 五个 PR |
| ~/work/illini-docs-brand7 | 本地 local/brand7-20261113 | BRAND.7 原型（已合进材料分支），不推送 | `git -C ~/work/illini worktree add -b local/brand7-20261113 ~/work/illini-docs-brand7 <材料分支 head>` |
| ~/.cache/illini-d50-dialog-proof、~/.cache/illini-following-d47-proof、~/.cache/illini-home-proof-st01a1d65b、~/.cache/illini-subpackage-d48-baseline、~/work/evidence/D50-followup/history-tree | 游离 HEAD | 第四批的红测证明用 worktree。D-51 第 2 项 i 先把改动和未跟踪文件存进 ~/work/evidence/D51/worktrees/，再用不带 `--force` 的 `git worktree remove`：这 5 个有改动或未跟踪文件，被拒，按规则留着（~/.cache/illini-subpackage-d48-mutation 干净，已删） | 不再新建；要删得由 Eric 定 |
| ~/work/illini-p3 | #369 合并前是本地 wip/P3.1，之后改名 codex/community-p3-\<YYYYMMDD\> | P3、LEGAL.2、LEGAL.4、LEGAL.5、P5.5 | 按 BACKLOG P3.1 的命令：#369 合并前从 #369 分支建 wip/P3.1；合并后在同一目录 `git merge origin/main` 再 `git branch -m`（BACKLOG §1） |
| ~/work/illini-events | #369 合并前是本地 wip/P4.1，之后改名 codex/community-events-\<YYYYMMDD\> | P4 里 Illini 仓库的部分 | 按 BACKLOG P4.1（从 origin/main 建 wip/P4.1）和 P4.2（merge 后改名）的命令 |
| ~/work/caaciorg | feat/public-events-feed；origin = fork EricXu-0805/caaciorg，upstream = a2751012962/caaciorg | P4.3 | 按 BACKLOG P4.3 的命令：E8 之前只读 clone 上游并把 remote 改名为 upstream，在本地写；E8 之后再加 fork 为 origin 并推送。git 已配置用 gh 做凭据（2026-11-12 核对） |
| ~/work/demo-publish | 不是 git 目录 | demo 预览部署（P1.13、BRAND.7）。全机只有这里允许有 .vercel | 见 §9 |
| ~/work/evidence/\<任务编号\> | 不是 git 目录 | BACKLOG 的 `$EV`：每个任务的原始输出 | `mkdir -p "$EV"` |
| ~/work/illini-dev-env | 不是 git 目录 | Containerfile、run-checks.sh、lsql-replay.sh、mp-size.mjs、probe-in-container.sh、probes/、tools/（HOME.1 的 page-audit）、logs/ | 已有 |
| ~/.cache/illini-dev | — | 容器里的 HOME 和 npm 缓存，挂载到 /cache | 已有 |
| ~/.config/illini/ | — | staging.env（权限 600，E3）；vercel-demo-project（P1.13，内容是项目名，不是机密） | E3 |

规则：

- 一个任务只在它对应的目录里改。`git worktree list` 只应列出上表里的目录。
- 跟进上游分支只用 `git merge`，和 P1.8 的做法一样。不 rebase 已推送的分支，不 force push。
- 任何目录都不执行 `git reset --hard`、`git clean`、`git checkout -- .` 或 `git worktree remove --force`。遇到不是本任务产生的改动，按 STOP-1 停下。
- 推送前，同一个 HEAD 要先用 run-checks 跑完该任务要求的步骤，全部 `rc=0`。仓库把 `core.hooksPath` 设成了 `.githooks`（2026-11-12 核对），所以宿主机 `git push` 会先跑 pre-push。它在宿主机上的结果不算证据：宿主机没有 PostgreSQL 17，多数 SQL 测试会跳过，但 4 个写死 PG 查找路径的测试（activity-notification-triggers、conversation-item-delete-cascade、record-consent-accepts-2026-09-03、report-and-appeal-outcome-notifications）会报 `spawnSync initdb ENOENT` 失败（#371 的 postgresBinDir 合进 main 以后会消掉）。pre-push 因为这类环境原因失败时，用 `git push --no-verify`，并在 STATUS_LOG 的「命令」字段写明，连同推送前那次 run-checks 的日志名。材料分支只改文档，pre-push 会把它判成纯文档、跳过检查，直接 `git push` 即可。

## 4 测试镜像与 run-checks.sh

### 4.1 2026-11-12 的现状

- `~/work/illini-dev-env/Containerfile` 基于 `mcr.microsoft.com/playwright:v1.60.0-noble`（Ubuntu 24.04.4）。它把 Node 22.23.5 装到 /usr/local/node22，用 SHASUMS256 校验；从 PGDG 装 postgresql-17；生成 en_US.UTF-8；最后执行 `npm install -g npm@10.8.2`。
- 镜像 `localhost/illini-dev:pw1.60-node22-pg17`，ID 3e3509725721，2.97 GB。容器内实测：node v22.23.5、npm 10.8.2、git 2.43.0、initdb (PostgreSQL) 17.11；/ms-playwright 下有 chromium-1223、webkit-2287、firefox-1522；`locale -a` 里有 en_US.utf8。
- `run-checks.sh` 有 7 个步骤：install、typecheck、h5、mp、migrations、test、smoke。它只把仓库挂到 /work，把 ~/.cache/illini-dev 挂到 /cache，设 `CI=1`，构建时用 CI 同款的 stub 环境变量。 例外是主包：h5、mp 步骤用 H5 job 的 stub（00000000000000000000.supabase.co），而 CI 的 build-mp-weixin 用 `https://ci-stub.supabase.co`（ci.yml 第 301 行），主包会差 91 字节；量主包一律用 `mpci` 步骤（D-46 起），它用 build-mp-weixin 的三个环境变量构建并跑 verify-build-artifact 与 mp-size。

现版有五处缺口，P1.9 修掉，新脚本见 §4.3：

1. 脚本设的是 `CI=1`，而 app/playwright.config.ts 只认 `CI === 'true'`，所以本地 smoke 不按 CI 模式跑。
2. 脚本不解析 test 的汇总，不管哪一步失败都退出 0，只能逐步看 `rc`。
3. 只挂载仓库目录。在 ~/work/illini-config 这类 worktree 里跑时，容器看不到 ~/work/illini/.git，scripts/secret-material-boundary.test.mjs 里的 `git ls-files` 会失败。这一条是推断，未实测。
4. 镜像名写死成 pw1.60。P1.5 把 lockfile 升到 Playwright 1.65 之后，浏览器版本就对不上了。
5. h5、mp 两步没有跑 CI 里的 `verify-build-artifact.mjs`。

新 run-checks.sh 要在 P1.2 之前装上，不等 P1.9。原因是缺口 3 会让 P1.3 在 ~/work/illini-config 里的 test 步骤失败。新脚本按 lockfile 选镜像，pw1.60 镜像照样能用。到 P1.9 只剩三件事：构建 pw1.65 镜像、按 DoD 复核、存档。

### 4.2 用法、耗时与读日志

```bash
$RC <仓库目录> [步骤 ...]          # $RC=~/work/illini-dev-env/run-checks.sh
$RC --selftest                    # 只检查 test 汇总的判定逻辑，不起容器
```

| 步骤 | 做什么 | 对应的 CI | 前置 |
|---|---|---|---|
| install | `npm ci --legacy-peer-deps`；打印 node、npm 版本；比对 package-lock.json 执行前后的 sha256，两次必须相同 | 各 job 的 Install | — |
| typecheck | `npm run type-check` | Type-check | install |
| h5 | 用 stub 环境变量执行 build:h5，再跑 `verify-build-artifact.mjs dist/build/h5 ci` | Build H5 前半 | install |
| h5accept | `playwright test --config playwright.production-admin.config.ts` | Build H5 后半 | h5 |
| mp | 执行 build:mp-weixin，再跑 `verify-build-artifact.mjs dist/build/mp-weixin none`（包体预算在这一步检查），最后用 mp-size.mjs 打印主包和各分包的字节数 | Build mp-weixin | install |
| migrations | `shasum -a 256 -c manifest.sha256` | Boundary 的 Verify migration file integrity | — |
| test | `node --test --test-concurrency=2 ../api/*.test.mjs ../scripts/*.test.mjs smoke/*.test.mjs`，跑完按 §6 检查汇总 | Boundary 的 API and client boundary tests | install |
| smoke | `playwright test $SMOKE_SPECS`。默认是 community-post-topics.spec.ts 和 plaza-attach-picker-is-modal.spec.ts，这两个全走 fixture，不连任何 Supabase | 无直接对应：CI 的 public sweep 连 staging，本地用 S-1 代替 | install |
| probe \<文件\> | 跑 `~/work/illini-dev-env/probes/` 里的一个 S-1 探针，见 §5.2 | 无 | install；E2、E3 |
| npmaudit | `npx -y npm@11 audit --audit-level=moderate`，需要联网。CI 也是换成 npm 11 才能用审计接口（ci.yml「Use an npm whose audit endpoint is still served」） | Boundary 的依赖审计 | install |
| cmd | 执行 `RUN_CMD` 里的命令 | — | — |

页面检查（<12px 文字、横向溢出、axe color-contrast）不单设步骤：HOME.3 新增的 `app/smoke/visual-audit.ts` 在 smoke 步骤里跑，axe-core 由 HOME.1 装在 `~/work/illini-dev-env/tools/`，经只读挂载的 `/dev-env/tools` 注入，做法见 BACKLOG §0.3「视觉验收」。

- 默认步骤：install typecheck h5 mp migrations test。
- 全量（BACKLOG §0.3 的定义）：install typecheck h5 h5accept mp migrations test smoke。
- 输出：第一行是 `repo=… head=… branch=… image=… log=…`；每步一行 `STEP <步骤> rc=<退出码> secs=<秒>`；test 步骤多一行 `TEST tests=… pass=… fail=… skipped=… pg_skips=…`。所有步骤的 rc 都是 0，脚本才退出 0。
- 耗时（2026-11-12 日志）：install 9 s、typecheck 13 s、h5 19 s、mp 14 s、migrations 1 s、smoke 51 s。test 在旧镜像首轮是 99 s；换新镜像后第一次用 keep-id 跑了 802 s，多出来的时间花在 ID 映射上，不是卡死。pw1.65 镜像第一次跑，预计也要多等这么久。

日志在 `~/work/illini-dev-env/logs/`：`check-<UTC 时刻>.log` 存全部步骤的输出，`check-<UTC 时刻>-<步骤>.log` 只存单步输出。读法：

```bash
L=$(ls -t ~/work/illini-dev-env/logs/check-*Z.log | head -1)
grep -E '^(repo=|STEP |TEST )' "$L"
grep -nE '^not ok' "${L%.log}-test.log" | head            # 失败的测试名
grep -n '# SKIP' "${L%.log}-test.log"                     # 只应有 Vercel Build Output 那 1 行
grep -E '[0-9]+ (passed|failed|skipped|flaky|did not run)' "${L%.log}-smoke.log"
```

### 4.3 新脚本、新镜像与存档（①② 在 P1.2 开头装，③④⑤ 属 P1.9）

**① run-checks.sh。** 先备份：`cp -p ~/work/illini-dev-env/run-checks.sh ~/work/illini-dev-env/run-checks.sh.before-P1.2-$D`。然后整份替换成下面的内容，再执行 `chmod 755`：

```bash
#!/usr/bin/env bash
# Runs the repo CI checks inside localhost/illini-dev:pw<playwright major.minor>-node22-pg17 (RUNBOOK §4).
# usage: run-checks.sh <repo-dir> [steps...]    |    run-checks.sh --selftest
#   steps: install typecheck h5 h5accept mp migrations test smoke npmaudit cmd, and "probe <file>"
#   default: install typecheck h5 mp migrations test
#   SMOKE_SPECS="a.spec.ts b.spec.ts" overrides the smoke spec list; RUN_CMD feeds the cmd step;
#   IMAGE=... forces an image (default: picked from @playwright/test in app/package-lock.json).
set -uo pipefail
ENVDIR=$HOME/work/illini-dev-env

gate() {  # $1 = node --test output; prints the TEST line; succeeds only for fail 0, skipped 1, no PostgreSQL/initdb skip
  local tests pass fail skipped pgskip
  read -r tests pass fail skipped < <(awk '/^# (tests|pass|fail|skipped) [0-9]+$/{v[$2]=$3} END{print v["tests"]+0, v["pass"]+0, v["fail"]+0, v["skipped"]+0}' "$1")
  pgskip=$(grep -ciE '# SKIP.*(postgres|initdb)' "$1")
  echo "TEST tests=$tests pass=$pass fail=$fail skipped=$skipped pg_skips=$pgskip"
  [ "$tests" -gt 0 ] && [ "$fail" -eq 0 ] && [ "$skipped" -eq 1 ] && [ "$pgskip" -eq 0 ]
}

if [ "${1:-}" = --selftest ]; then
  t=$(mktemp -d); bad=0
  printf '%s\n' '# tests 3' '# pass 1' '# fail 0' '# skipped 2' > "$t/skipped-2"
  printf '%s\n' 'ok 2 - db # SKIP PostgreSQL 17 unavailable' '# tests 2' '# pass 1' '# fail 0' '# skipped 1' > "$t/pg-skip"
  printf '%s\n' 'ok 1 - build output # SKIP no local .vercel/output function inventory' '# tests 2' '# pass 1' '# fail 0' '# skipped 1' > "$t/good"
  for c in skipped-2:1 pg-skip:1 good:0; do
    gate "$t/${c%%:*}" >/dev/null; rc=$?
    echo "SELFTEST ${c%%:*} gate_rc=$rc expected=${c##*:}"; [ "$rc" = "${c##*:}" ] || bad=1
  done
  rm "$t/skipped-2" "$t/pg-skip" "$t/good"; rmdir "$t"; exit "$bad"
fi

REPO=$(cd "${1:?usage: run-checks.sh <repo-dir> [steps...]}" && pwd -P); shift
[ $# -gt 0 ] || set -- install typecheck h5 mp migrations test
PW=$(sed -n '/"node_modules\/@playwright\/test": {/,/}/{s/.*"version": "\([0-9]*\.[0-9]*\)\.[0-9]*".*/\1/p;}' "$REPO/app/package-lock.json" | head -1)
IMAGE=${IMAGE:-localhost/illini-dev:pw${PW}-node22-pg17}
podman image exists "$IMAGE" || { echo "missing image $IMAGE (lockfile Playwright $PW); build it per RUNBOOK §4.3" >&2; exit 1; }
GIT_COMMON=$(git -C "$REPO" rev-parse --path-format=absolute --git-common-dir)
SMOKE_SPECS=${SMOKE_SPECS:-community-post-topics.spec.ts plaza-attach-picker-is-modal.spec.ts}
STAMP=$(date -u +%Y%m%dT%H%M%SZ); LOG=$ENVDIR/logs/check-$STAMP.log
STUB="VITE_SUPABASE_URL=https://00000000000000000000.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_ci-stub-key VITE_BASE_URL=https://ci-app-stub.invalid"
EXTRA=()
inbox() {
  podman run --rm --userns=keep-id -e HOME=/cache/home -e CI=true -e PG_BIN_DIR=/usr/lib/postgresql/17/bin \
    -v "$HOME/.cache/illini-dev:/cache" -v "$ENVDIR:/dev-env:ro" \
    -v "$REPO:$REPO" -v "$GIT_COMMON:$GIT_COMMON:ro" "${EXTRA[@]}" -w "$REPO" "$IMAGE" bash -lc "$1"
}
declare -A CMD=(
  [install]="cd app && a=\$(sha256sum package-lock.json) && npm ci --legacy-peer-deps --no-audit --no-fund && node -v && npm -v && [ \"\$a\" = \"\$(sha256sum package-lock.json)\" ]"
  [typecheck]="cd app && npm run type-check"
  [h5]="cd app && env $STUB npm run build:h5 && node ../scripts/verify-build-artifact.mjs dist/build/h5 ci"
  [h5accept]="cd app && env $STUB npx playwright test --config playwright.production-admin.config.ts"
  [mp]="cd app && env $STUB npm run build:mp-weixin && node ../scripts/verify-build-artifact.mjs dist/build/mp-weixin none && node /dev-env/mp-size.mjs dist/build/mp-weixin"
  [migrations]="cd supabase/migrations && shasum -a 256 -c manifest.sha256 >/dev/null && echo all-migration-checksums-ok"
  [test]="cd app && node --test --test-concurrency=2 ../api/*.test.mjs ../scripts/*.test.mjs smoke/*.test.mjs"
  [smoke]="cd app && env $STUB SMOKE_PORT=5186 npx playwright test $SMOKE_SPECS"
  [npmaudit]="cd app && npx -y npm@11 audit --audit-level=moderate"
  [probe]="bash /dev-env/probe-in-container.sh"
  [cmd]="${RUN_CMD:-echo 'RUN_CMD is empty' >&2; false}"
)
echo "repo=$REPO head=$(git -C "$REPO" rev-parse HEAD) branch=$(git -C "$REPO" rev-parse --abbrev-ref HEAD) image=$IMAGE log=$LOG" | tee "$LOG"
overall=0
while [ $# -gt 0 ]; do
  s=$1; shift; EXTRA=(); label=$s
  if [ "$s" = probe ]; then
    f=${1:-}; shift || true; label=probe-${f%%.*}
    ENVF=$HOME/.config/illini/staging.env
    if [ -z "$f" ] || [ ! -f "$ENVDIR/probes/$f" ] || [ "$(stat -c %a "$ENVF" 2>/dev/null)" != 600 ] \
       || grep -qE 'service_role|sb_secret|lfhvgprfphyfvhidegum|wslzeqhipvibeflmxznh' "$ENVF"; then
      echo "STEP $label rc=3 probe-file-or-staging.env-check-failed" | tee -a "$LOG"; overall=1; continue
    fi
    install -d "${EV:-$HOME/work/evidence/misc}"
    EXTRA=(-v "$ENVDIR/probes:$REPO/app/.probes:ro" -v "$ENVF:/run/illini/staging.env:ro"
           -v "$HOME/work/evidence:$HOME/work/evidence" -e "PROBE_FILE=$f" -e "EV=${EV:-$HOME/work/evidence/misc}")
  fi
  if [ -z "${CMD[$s]+x}" ]; then echo "STEP $s rc=2 unknown-step" | tee -a "$LOG"; overall=1; continue; fi
  t0=$(date +%s); out=$ENVDIR/logs/check-$STAMP-$label.log
  inbox "${CMD[$s]}" > "$out" 2>&1; rc=$?
  { echo "=== $label"; cat "$out"; } >> "$LOG"
  if [ "$s" = test ]; then gate "$out" | tee -a "$LOG"; [ "${PIPESTATUS[0]}" -eq 0 ] || rc=1; fi
  echo "STEP $label rc=$rc secs=$(( $(date +%s) - t0 ))" | tee -a "$LOG"
  [ "$rc" -eq 0 ] || overall=1
done
exit "$overall"
```

`$RC --selftest` 输出三行：`SELFTEST skipped-2 gate_rc=1`、`SELFTEST pg-skip gate_rc=1`、`SELFTEST good gate_rc=0`（各行末尾带 expected）。三行都符合时退出 0。BACKLOG P1.9 ② 按这三个 gate_rc 判。

**② mp-size.mjs。** 单独运行 `node ../scripts/verify-miniprogram.mjs` 不做任何检查：这个文件只导出函数，没有命令行入口（005ca9d 核对）。所以字节数用下面这个辅助文件取，放在 `~/work/illini-dev-env/mp-size.mjs`，由 mp 步骤调用：

```js
// Prints mini-program package bytes using the repo's own verifier (RUNBOOK §4.2, mp step).
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const root = path.resolve(process.argv[2] || 'dist/build/mp-weixin')
const { verifyMiniProgram } = await import(pathToFileURL(path.resolve('../scripts/verify-miniprogram.mjs')).href)
const files = (await readdir(root, { recursive: true, withFileTypes: true }))
  .filter(d => d.isFile())
  .map(d => path.relative(root, path.join(d.parentPath, d.name)).split(path.sep).join('/'))
console.log(JSON.stringify(await verifyMiniProgram(root, files)))
```

**③ Containerfile。** 先执行 `cp -p Containerfile Containerfile.pw1.60` 留底，再改三处：

```diff
-# Illini Market test/dev runner for hosts the repo toolchain does not support (e.g. Ubuntu 26.04).
-# Mirrors CI: Ubuntu 24.04, Playwright 1.60 browsers, Node 22, npm 10.8.2, PostgreSQL 17 at /usr/lib/postgresql/17/bin.
-FROM mcr.microsoft.com/playwright:v1.60.0-noble
+# Illini test/dev runner for hosts the repo toolchain does not support (e.g. Ubuntu 26.04).
+# Mirrors CI: Playwright 1.65 browsers, Node 22 with its bundled npm 10.9.x, PostgreSQL 17 at /usr/lib/postgresql/17/bin.
+FROM mcr.microsoft.com/playwright:v1.65.0-noble
 ...
-RUN npm install -g npm@10.8.2 && node -v && npm -v && /usr/lib/postgresql/17/bin/initdb --version
+RUN node -v && npm -v | grep -E '^10\.9\.' && /usr/lib/postgresql/17/bin/initdb --version
```

**④ 构建与核对。**

```bash
cd ~/work/illini-dev-env
podman pull mcr.microsoft.com/playwright:v1.65.0-noble        # 失败就停在 P1.9：STATUS 写阻塞，不换别的基础镜像
podman build -t localhost/illini-dev:pw1.65-node22-pg17 -f Containerfile . 2>&1 | tee logs/build-pw1.65-$(date -u +%Y%m%dT%H%M%SZ).log
podman run --rm localhost/illini-dev:pw1.65-node22-pg17 bash -lc 'node -v; npm -v; /usr/lib/postgresql/17/bin/initdb --version; ls /ms-playwright; locale -a | grep -i en_us'
                                   # v22.23.5 / 10.9.x / initdb (PostgreSQL) 17.x / chromium-* 与 webkit-* / en_US.utf8
podman image inspect localhost/illini-dev:pw1.65-node22-pg17 --format '{{.Id}}'   # 记进 STATUS_LOG
$RC --selftest
$RC ~/work/illini-config install typecheck h5 h5accept mp migrations test smoke
```

顺序：

- P1.5 改完 lockfile 以后，那个 worktree 的 smoke 只能在 pw1.65 镜像里跑。所以 P1.5 改完先做 P1.9，再回头跑 P1.5 的检查（BACKLOG §2 的顺序也是 P1.5 → P1.9）。
- lockfile 用宿主机的 npm 改（P1.2 ④ 之后是 10.9.x，与 CI 一致）：在 `~/work/illini-config/app` 里执行 `npm install --legacy-peer-deps --no-audit --no-fund --save-dev @playwright/test@^1.65.0`，改完按 P1.5 ② 核对 diff。
- 旧镜像 pw1.60 留到 P1.8 完成：P1.8 之前代码分支还在 1.60。

**⑤ 存档。** P1.9 把当时已有的 Containerfile、run-checks.sh、mp-size.mjs 复制到材料 worktree 的 `$DOCS/appendix/env/`。后面新建的文件由各自的任务在写回时复制：lsql-replay.sh（P1.10）、probe-in-container.sh 与 probes/（P1.11、P1.12，放 `$DOCS/appendix/env/probes/`）、Vercel 护栏（P1.13，复制为 `$DOCS/appendix/env/vercel-guard.sh`）。每次复制都执行 `sha256sum`，把值写进 STATUS_LOG。以后这些文件只要改了，就重新复制并更新 sha256。

### 4.4 单跑一个测试，或进容器排查

```bash
RUN_CMD='cd app && node --test ../scripts/admin-support-email-ledger.test.mjs' $RC ~/work/illini-config cmd

R=~/work/illini-config; GC=$(git -C "$R" rev-parse --path-format=absolute --git-common-dir)
podman run --rm -it --userns=keep-id -e HOME=/cache/home -e CI=true -e PG_BIN_DIR=/usr/lib/postgresql/17/bin \
  -v ~/.cache/illini-dev:/cache -v "$R:$R" -v "$GC:$GC:ro" -w "$R" localhost/illini-dev:pw1.60-node22-pg17 bash
```

P1.3 ③ 的反例（`PG_BIN_DIR=/nonexistent`）在这个镜像里只有一种情况下会失败：查找函数把「设了 PG_BIN_DIR 但目录无效」直接当错误处理。原因是 /usr/lib/postgresql/17/bin 在容器里确实存在，按查找顺序往下走就会找到它。

## 5 环境矩阵

| 代号 | 是什么 | 能证明 | 不能证明 | 谁准备 | 禁止 |
|---|---|---|---|---|---|
| L-SQL | 本机一次性容器 docker.io/supabase/postgres:17.6.1.104，`--network none`，从 001 回放（§5.1） | 迁移全链能回放；约束、RLS、列级 GRANT、RPC、触发器在 Supabase 真实角色下的行为；PRECHECK、VERIFY、REGRESSION 能执行 | 托管库的当前状态；Auth、Storage、PostgREST；网络和性能 | OMO，不需要凭据 | 连接或挂载任何托管库；改已应用到托管库的迁移；用完不删容器 |
| L-UI | 容器里的 dev:h5 加 Playwright 路由 fixture（run-checks 的 smoke 步骤，或自写 spec 后用 `SMOKE_SPECS` 跑） | 界面、文案、键盘、视口、状态切换；fixture 下请求的形状；截图矩阵 | 真实 RLS 和 Auth；/api 函数；小程序 | OMO | fixture 里放真实用户数据或外站内容；拿截图代替点击测试 |
| S-1 | 容器里的 dev:h5 指向 staging-smoke（hygkwxugskijadgfisji），用合成账号 A/B/C 登录，Playwright 只拦截 `**/api/moderate`（§5.2） | 真实的 Auth、PostgREST、Storage、RLS；双账号流程；换号隔离 | Vercel 函数（/api/*）；内容审核的真实判断；小程序 | Eric 先完成 E2、E3，OMO 再按 §5.2 操作 | 持有 service_role；写 A/B/C 以外的数据；拦截 /api/moderate 以外的请求；用 CI 的 SMOKE_EMAIL 账号；对 staging 做 DDL 或迁移 |
| S-2 | `vercel dev`，页面和 /api 同源 | /api/* 与页面一起工作 | — | 2026-11-12 不可用：D-18 只允许 link demo 项目，Eric 没有指定可 link 的非生产项目。S-2 可选，不进任何 DoD | `vercel env pull`、`vercel pull`；link 生产项目 |
| CI | GitHub Actions，PR 事件 | 每个 job 的结论（各 job 的预期见 ENGINEERING「CI 解读」）；PR 的 public sweep 连的是 staging-smoke | 本地没跑的环境 | 自动触发 | 拿旧提交的绿灯代表新提交 |
| 生产 | illinimarket.com、lfhvgprfphyfvhidegum、小程序线上版 | — | — | 只有 Eric | OMO 只做公开网址的 GET/HEAD（如 `curl -sI https://illini-community-demo.vercel.app/`）。BRAND.6 ② 的 POST 探测和一切生产库查询交给 Eric（STOP-2） |

### 5.1 L-SQL：全链回放

用于 P1.10、P2.5 ⑤、P3.1 ④、P4.2 ⑤。BACKLOG P1.10 里的逐条命令和下面的脚本等价，任选其一。要在指定迁移前后跑 PRECHECK、VERIFY、REGRESSION 时，用脚本更方便。

脚本放在 `~/work/illini-dev-env/lsql-replay.sh`，执行 `chmod 755`。下面是 2026-11-13 在 tony-ws 实测跑通 181/181 的版本（P1.10，D-44；存档 `appendix/env/lsql-replay.sh`）。和最初写在这里的草稿相比，改了四处，都只管「怎么跑」：

- 整条链用 postgres 连接回放（托管上迁移由 postgres 执行，后面的 precheck 断言 proowner = postgres）；仓库 `_ops` 里管托管 schema 的 LOCAL_BOOTSTRAP 用 supabase_admin 跑。
- 没有顶层 `BEGIN;` 的迁移由脚本包一层事务（托管的迁移端点自己开事务，`LOCK TABLE`、`SET LOCAL` 依赖它），台账行和迁移在同一个事务里提交。
- 镜像缺的托管面（CLI 迁移台账、auth.identities / sessions / mfa_factors、auth.users 的 banned_until / deleted_at）放在 #369 的 `supabase/_ops/LOCAL_BOOTSTRAP_<迁移时间戳>_*.sql`，文件头写明只用于本地回放和每列的来源；脚本在对应迁移之前、先 `SET caaci.local_bootstrap = 'lsql-replay'` 再 `\i`。只认带这个标记的文件，同一时间戳下给单条迁移用的旧 fixture 不会被带进来。
- CLI 台账出现之后，脚本先补记已经回放的迁移，之后每条迁移回放完记一行，和 CLI 应用迁移时一样。

变红验证（D-44）：把某个 bootstrap 里一列必需的列删掉再跑，回放应在第一条读这一列的迁移上报错。

```bash
#!/usr/bin/env bash
# L-SQL: replay every migration from 001 in a disposable supabase/postgres container (RUNBOOK §5.1).
# usage: lsql-replay.sh <repo-dir> [migration-timestamp ...]
#   For each timestamp: PRECHECK_<ts>_*.sql runs right before that migration, VERIFY_<ts>_*.sql right after,
#   REGRESSION_<ts>_*.sql after the whole chain.
set -uo pipefail
REPO=$(cd "${1:?usage: lsql-replay.sh <repo-dir> [ts ...]}" && pwd -P); shift
CHECK=" $* "
IMG=docker.io/supabase/postgres:17.6.1.104
NAME=lsql-$(date -u +%Y%m%dT%H%M%SZ)
LOG=$HOME/work/illini-dev-env/logs/$NAME.log
PGPW=$(openssl rand -hex 16)
podman run -d --name "$NAME" --network none -e POSTGRES_PASSWORD="$PGPW" -v "$REPO/supabase:/work:ro" "$IMG" >/dev/null || exit 2
trap 'podman rm -f "$NAME" >/dev/null' EXIT
for _ in $(seq 1 90); do podman exec "$NAME" pg_isready -h localhost -U postgres >/dev/null 2>&1 && break; sleep 2; done
PSQL=(podman exec -i -e PGPASSWORD="$PGPW" "$NAME" psql -X -h localhost -U supabase_admin -d postgres)
"${PSQL[@]}" -c 'select current_user, version()' >>"$LOG" 2>&1 || { echo "cannot connect as supabase_admin; see $LOG" >&2; exit 2; }
emit() {
  # Hosted Supabase applies migrations as postgres (non-superuser), and later prechecks assert proowner = postgres.
  # So the chain runs as postgres; only the repo's LOCAL_BOOTSTRAP fixtures for managed schemas run as supabase_admin.
  printf '%s\n' '\set ON_ERROR_STOP on' "SET caaci.local_bootstrap = '20260722-disposable-pg17';" '\i /work/_ops/LOCAL_BOOTSTRAP_20260722_full_clean_supabase_base.sql'
  printf '%s\n' '\connect postgres postgres'
  local f ts x r rec platform=0 base ledger=0 rows=()
  for f in $(cd "$REPO/supabase/migrations" && ls -1 *.sql | LC_ALL=C sort); do
    ts=${f%%_*}
    # auth.jwt() and the storage columns come from the Auth/Storage services on hosted; the repo's fixture
    # for that surface runs after the numbered 001-089 chain (its header says so).
    if [ "$platform" = 0 ] && [ ${#ts} -ge 14 ]; then
      printf '%s\n' '\connect postgres supabase_admin' '\echo BOOTSTRAP LOCAL_BOOTSTRAP_20260719_full_release_platform.sql' '\i /work/_ops/LOCAL_BOOTSTRAP_20260719_full_release_platform.sql' '\connect postgres postgres'; platform=1
    fi
    # Hosted surfaces the image lacks (CLI migration ledger, Auth tables and columns) live in _ops files that
    # declare themselves for this replay (guard marker lsql-replay); each runs right before the first migration
    # that reads it. Older LOCAL_BOOTSTRAP_<ts> fixtures for single-migration harnesses have no such marker.
    for x in "$REPO"/supabase/_ops/LOCAL_BOOTSTRAP_"$ts"_*.sql; do
      [ -f "$x" ] && grep -q "IS DISTINCT FROM 'lsql-replay'" "$x" || continue
      printf '%s\n' '\connect postgres supabase_admin' "SET caaci.local_bootstrap = 'lsql-replay';" "\\echo BOOTSTRAP ${x##*/}" "\\i /work/_ops/${x##*/}" '\connect postgres postgres'
      case "$x" in *_cli_migration_ledger.sql)
        # The CLI records every migration it applies; record the ones already replayed before the ledger existed.
        ledger=1
        for r in "${rows[@]}"; do printf "INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('%s', '%s');\n" "${r%%|*}" "${r#*|}"; done;;
      esac
    done
    # realtime.messages and realtime.topic() come from Supabase Realtime, not the image.
    if [ "$ts" = 20260718240000 ]; then
      printf '%s\n' '\connect postgres supabase_admin' '\echo BOOTSTRAP LOCAL_BOOTSTRAP_20260718_private_conversation_realtime.sql' '\i /work/_ops/LOCAL_BOOTSTRAP_20260718_private_conversation_realtime.sql' '\connect postgres postgres'
    fi
    if [[ $CHECK == *" $ts "* ]]; then for x in "$REPO"/supabase/_ops/PRECHECK_"$ts"_*.sql; do [ -f "$x" ] && printf '\\echo PRECHECK %s\n\\i /work/_ops/%s\n' "${x##*/}" "${x##*/}"; done; fi
    base=${f%.sql}
    # Record the migration in the CLI ledger once it exists; before that, remember it for the backfill.
    rec=""
    if [ "$ledger" = 1 ]; then rec=$(printf "INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('%s', '%s');" "$ts" "${base#*_}"); else rows+=("$ts|${base#*_}"); fi
    # The ledger-aware migration endpoint owns the transaction for files without a top-level BEGIN
    # (several say so); wrap them so LOCK TABLE / SET LOCAL behave as hosted, and commit the ledger row with them.
    if grep -qE '^BEGIN;' "$REPO/supabase/migrations/$f"; then
      printf '\\echo REPLAY %s\n\\i /work/migrations/%s\n' "$f" "$f"
      [ -n "$rec" ] && printf '%s\n' "$rec"
    else
      printf '\\echo REPLAY %s\nBEGIN;\n\\i /work/migrations/%s\n' "$f" "$f"
      [ -n "$rec" ] && printf '%s\n' "$rec"
      printf 'COMMIT;\n'
    fi
    if [[ $CHECK == *" $ts "* ]]; then for x in "$REPO"/supabase/_ops/VERIFY_"$ts"_*.sql; do [ -f "$x" ] && printf '\\echo VERIFY %s\n\\i /work/_ops/%s\n' "${x##*/}" "${x##*/}"; done; fi
  done
  printf '%s\n' '\connect postgres supabase_admin'
  for ts in $CHECK; do for x in "$REPO"/supabase/_ops/REGRESSION_"$ts"_*.sql; do [ -f "$x" ] && printf '\\echo REGRESSION %s\n\\i /work/_ops/%s\n' "${x##*/}" "${x##*/}"; done; done
  printf '\\echo REPLAY_DONE\n'
}
emit | "${PSQL[@]}" >>"$LOG" 2>&1; rc=$?
files=$(ls -1 "$REPO"/supabase/migrations/*.sql | wc -l)
replayed=$(grep -c '^REPLAY [0-9]' "$LOG"); errors=$(grep -c 'ERROR:' "$LOG"); done_=$(grep -c '^REPLAY_DONE$' "$LOG")
echo "LSQL head=$(git -C "$REPO" rev-parse HEAD) files=$files replayed=$replayed errors=$errors done=$done_ rc=$rc log=$LOG"
[ "$rc" -eq 0 ] && [ "$files" -eq "$replayed" ] && [ "$errors" -eq 0 ] && [ "$done_" -eq 1 ]
```

用法与判定：

- P1.10：`~/work/illini-dev-env/lsql-replay.sh ~/work/illini`。005ca9d 上有 181 个 .sql，最后一个是 20261112120000。通过的条件是最后一行 `files=N replayed=N errors=0 done=1 rc=0`，并且脚本退出 0。需要放进 `$EV` 的日志，用 `cp` 复制过去。
- P2.5 ⑤：`~/work/illini-dev-env/lsql-replay.sh ~/work/illini 20261112120000`。日志里应依次出现 `PRECHECK`、`REPLAY 20261112120000_…`、`VERIFY`，最后是 `REGRESSION`。
- 失败时，日志最后一个 `REPLAY` 行就是出错的文件。把文件名和 `ERROR:` 那一行记进 STATUS_LOG。已有的迁移文件不改；20261112120000 冻结之前可以改，冻结后不再改。
- 就绪判断用 `pg_isready -h localhost`。官方 postgres 入口脚本初始化时，临时服务只听 unix socket；用 socket 判断，可能在初始化脚本还没跑完时就开始回放。这一条是推断。
- 连接用 `supabase_admin` 加随机的 POSTGRES_PASSWORD，未实测。连不上时，另起一个容器，用 `psql -U postgres -c '\du'` 查出哪个角色带 Superuser，换成那个角色，并把改动记进 STATUS_LOG。

在 REGRESSION 文件里扮演用户（anon、A、B、停权用户、被拉黑用户），写法如下：

```sql
BEGIN;
SET LOCAL ROLE authenticated;          -- 匿名用户改成 anon，并且不设 claims
SELECT set_config('request.jwt.claims', json_build_object('sub', '<用户 uuid>', 'role', 'authenticated')::text, true),
       set_config('request.jwt.claim.sub', '<用户 uuid>', true);
-- 期望被拒的写入放进 DO 块，捕获 SQLSTATE（如 42501、23514），没被拒就 RAISE EXCEPTION
ROLLBACK;
```

用户行和 profile 由同一个文件以超级用户身份插入，整段放在事务里，最后回滚。合成用户的 uuid 写死在文件里，不用真实用户的 id。

### 5.2 S-1：staging-smoke 与合成账号

**前提与自检。** #369 上已有 Eric 按 E2 留下的书面确认（D-29），E3 已完成（2026-11-20 起两者都由 DECISIONS D-53 第 0 项 b、c 代替）。每次跑 S-1 之前先自检。不要 `cat` 这个文件：

```bash
stat -c %a ~/.config/illini/staging.env                                                    # 600
grep -cE 'service_role|sb_secret|lfhvgprfphyfvhidegum|wslzeqhipvibeflmxznh' ~/.config/illini/staging.env   # 0
grep -c '^STAGING_SUPABASE_URL=https://hygkwxugskijadgfisji.supabase.co$' ~/.config/illini/staging.env      # 1
cut -d= -f1 ~/.config/illini/staging.env | sort | tr '\n' ' '
# STAGING_SUPABASE_ANON_KEY STAGING_SUPABASE_URL SYN_A_EMAIL SYN_A_PASSWORD SYN_B_EMAIL SYN_B_PASSWORD SYN_C_EMAIL SYN_C_PASSWORD
```

**探针放在哪里。**

- S-1 的探针不进产品仓库，放在 `~/work/illini-dev-env/probes/`。
- run-checks 的 `probe` 步骤把这个目录只读挂到被测目录的 `app/.probes`。挂在 app 下面，探针里的 `@playwright/test` 和 `@supabase/supabase-js` 才能从 app/node_modules 解析到；挂在 /probes 这类仓库外的路径，模块会找不到。
- 第一次挂载时，宿主机上会留下一个空目录 `app/.probes`（容器运行时建的挂载点，未实测）。git 不跟踪空目录，所以工作区仍然干净。
- 同一套探针既能跑 main 基线（~/work/illini-main：P1.11、P1.12），也能跑 #369（~/work/illini：P2.11）。

`~/work/illini-dev-env/probe-in-container.sh` 在容器里执行，由 probe 步骤调用：

```bash
#!/usr/bin/env bash
# Runs one S-1 probe inside the test container (RUNBOOK §5.2). Called by run-checks.sh "probe <file>".
set -uo pipefail
set -a; . /run/illini/staging.env; set +a
[ "$STAGING_SUPABASE_URL" = https://hygkwxugskijadgfisji.supabase.co ] || { echo wrong_staging_target >&2; exit 3; }
export VITE_SUPABASE_URL="$STAGING_SUPABASE_URL" VITE_SUPABASE_ANON_KEY="$STAGING_SUPABASE_ANON_KEY" VITE_BASE_URL=https://ci-app-stub.invalid
cd app || exit 2
node ../scripts/verify-public-read-schema.mjs || exit 1
case "$PROBE_FILE" in
  *.spec.ts) exec npx playwright test --config .probes/playwright.probe.config.ts "$PROBE_FILE" ;;
  *.mjs) exec node ".probes/$PROBE_FILE" ;;
  *) echo "probe file must end with .spec.ts or .mjs" >&2; exit 2 ;;
esac
```

`probes/playwright.probe.config.ts` 必须满足：

1. 启动时检查 `process.env.VITE_SUPABASE_URL === 'https://hygkwxugskijadgfisji.supabase.co'`，并且三个 `SYN_*_EMAIL` 都以 `@example.test` 结尾。不满足就 throw。写法参考仓库里的 app/e2e/hosted/approved-targets.ts。
2. webServer 和 use 沿用 `../playwright.config.ts`，webServer 另加 `cwd: '..'`（dev:h5 要在 app 目录启动）；覆盖 `testDir: '.'`、`testMatch: '**/*.spec.ts'`、`testIgnore: []`；workers 1，retries 0。
3. 每个 page 只拦截 `**/api/moderate`，用 fulfill 返回 200 和 `{"flagged":false,"categories":[],"skipped":true,"reason":"no_key"}`。这和 api/moderate.js 在没有 OPENAI_API_KEY 时的返回字段一致，只多一个空的 categories。其余请求全部放行。
4. 输出只写命中计数、HTTP 状态、PostgREST code 和 user.id。不打印 localStorage、sessionStorage 原文，因为里面有 access token。需要截图的 spec 显式调用 `page.screenshot`，存到 `process.env.EV`；截图里不能出现邮箱和密码。CI=true 时 Playwright 不会自动截图。
5. 写入的内容，标题或正文以 `[SYN-<task_id>]` 开头。

用法：

```bash
EV=~/work/evidence/P1.11 $RC ~/work/illini-main install probe consent-login.spec.ts    # P1.11 ③：A、B、C 依次登录、接受同意书、截图
EV=~/work/evidence/P1.12 $RC ~/work/illini-main probe account-switch.spec.ts           # P1.12
EV=~/work/evidence/P2.11 $RC ~/work/illini probe p2-authz-matrix.mjs                   # P2.11（P2.6 之后）
```

同一时间只跑一个 S-1，因为 A/B/C 三个账号共享状态。

**合成数据集。**

| 账号 | 用途 | 预置数据（由该账号自己在 UI 里建，或以该账号身份用 supabase-js 建） |
|---|---|---|
| A　syn-a@example.test | 发帖者；私信接收者 | 2 件在售商品、1 件已售商品，标题以 `[SYN-P2.11]` 开头 |
| B　syn-b@example.test | 回复者；越权尝试者；换号后登录的账号 | 1 件在售商品 |
| C　syn-c@example.test | 发探针私信 | 无 |

- 三个账号在 P1.11 ③ 各用 UI 登录一次，并接受同意书。
- 探针私信的正文是 `SYN-P1-LEAK-<YYYYMMDD>`，日期用 CT。
- 商品图片只用脚本生成的纯色 PNG，不用真人照片或外站图片。
- 任何一步都不用 service key，也不直接写 auth 或 storage 表。

**换号探针与越权矩阵。**

- P1.12 的判定条件写在 BACKLOG P1.12 的 DoD 里。account-switch.spec.ts 按这个顺序走：C 发探针 → A 登录 → 读到探针 → A 退出 → 不刷新页面，直接登录 B → 依次打开消息、广场、帖子详情（main 上的叫法）→ 统计 `document.body.innerText`、localStorage 和 sessionStorage 里探针的命中数 → 读出 `sb-hygkwxugskijadgfisji-auth-token` 里的 user.id，与 B 比对 → 硬刷新 → 再查一遍。
- P2.11 的 p2-authz-matrix.mjs 用 supabase-js 以 A、B 的身份执行，输出 JSON（不含 token）。每个动作一行：`动作｜身份｜HTTP｜PostgREST code｜期望｜结果`，写进 STATUS_LOG 的「计数」字段。

**清理。**

- 每个 S-1 任务结束时，由内容所属的账号删除本任务写入的 `[SYN-<task_id>]` 内容，用产品内的正常删除操作：话题用作者的删除入口，商品在「我的物品」里下架或删除，探针私信由 C 删除（P1.12 ⑥）。
- 产品里没有删除入口的内容，保留，列进 STATUS_LOG「未测项」里的残留清单，写明对象和 id。
- A/B/C 三个账号保留复用，OMO 不改密码。账号被限流、停权或锁住时，停下交给 Eric。

### 5.3 L-UI 给人看

L-UI 要给人看的时候，把容器端口映射到本机回环，再从 Mac 用 ssh 转发（未实测）：

```bash
# tony-ws，在 tmux 里执行，R 是要看的仓库目录
podman run --rm --userns=keep-id -p 127.0.0.1:5173:5173 -e HOME=/cache/home -v ~/.cache/illini-dev:/cache -v "$R:$R" -w "$R/app" \
  localhost/illini-dev:pw1.65-node22-pg17 bash -lc 'env VITE_SUPABASE_URL=https://00000000000000000000.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_ci-stub-key VITE_BASE_URL=https://ci-app-stub.invalid npm run dev:h5 -- --host 0.0.0.0 --port 5173'
# Mac：ssh -N -L 5173:127.0.0.1:5173 tony-ws，然后打开 http://localhost:5173
```

## 6 测试汇报规则

- **node --test**：贴出 `# tests N`、`# pass N`、`# fail 0`、`# skipped 1` 四行。skipped 必须正好是 1，唯一的 SKIP 行必须是 `an existing local Vercel Build Output exactly matches runtime API sources # SKIP no local .vercel/output function inventory`。只要有一条 SKIP 含 PostgreSQL 或 initdb，就判为环境失败，不能写「通过」。tests 总数要不少于 STATUS 记录的基线；变少了，要查出是哪个文件没加载。
- **Playwright**：贴出 `N passed (…s)` 那一行。有 failed、flaky、skipped 或 did not run，逐个写出名字。
- **构建**：H5 要出现 `build artifact verified: ci <n> files`，mp 要出现 `build artifact verified: none <n> files`。包体字节数取 mp 步骤最后一行的 `packageBytes`。
- **迁移**：迁移文件完整性看到 `all-migration-checksums-ok`；L-SQL 看 §5.1 的最后一行。
- **S-1**：每条结论都写上「S-1：/api/moderate 用替身」，并写明项目 ref hygkwxugskijadgfisji。
- 每条结论只带一个 README 定义的证据标签。截图不能代替点击测试。旧提交的结果不能代表新提交。没测的设备、深色模式、英文界面、小程序真机，写进「未测项」。

## 7 读 CI 与重跑

```bash
REPO=EricXu-0805/CAACI_Community_Marketplace_Bazaar
# 读 PR 的 CI：令牌没有 Checks 读权限，gh pr checks 返回 403（2026-11-12 tony-ws 实测），改走 Actions 接口
RUN=$(gh run list --repo $REPO --branch <分支> --workflow ci.yml --event pull_request --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch $RUN --repo $REPO --interval 60                     # 等到跑完；已结束的 run 立即返回
gh run view $RUN --repo $REPO --json headSha,status,conclusion,jobs \
  --jq '.headSha, .status, (.jobs[] | [.name, .conclusion] | @tsv)'   # 每个 job 一行：success / failure / skipped
gh run list --repo $REPO --branch <分支> --limit 5 --json databaseId,headSha,event,status,conclusion \
  --jq '.[] | [.databaseId, .headSha[0:7], .event, .status, .conclusion] | @tsv'
gh run view <run_id> --repo $REPO --log-failed | grep -E '✘|failed|Error|not ok' | head -50
gh run view <run_id> --repo $REPO --log | grep -E '# (tests|pass|fail|skipped) [0-9]+$'    # Boundary 汇总
gh run view <run_id> --repo $REPO --log | grep -E '[0-9]+ (passed|failed|skipped|flaky)'  # Smoke 汇总
gh run view <run_id> --repo $REPO --log | grep -m3 'Image: ubuntu'                        # runner 的系统
```

- 记结论前，先确认 run 的 headSha 等于本任务的 code_sha。
- 本套文件里说「PR 的 CI」或「job 结论」，都指上面 `gh run view $RUN` 的输出。不要用 `gh pr checks`，403 时也不要去找别的令牌。
- 每个 job 的预期结果见 ENGINEERING「CI 解读」，这里不重复。
- **重跑**：令牌的 Actions 权限是只读（D-07），`gh run rerun` 预计返回 403（未实测）。所以重跑有三种办法，按顺序选：
  1. 本来就要推下一个任务的提交，推送会触发新的 run；
  2. 请 Eric 在 PR 的 Checks 页点「Re-run failed jobs」；
  3. 在该 PR 的分支上推一个空提交：`git commit --allow-empty -m "ci: re-run checks after <原因> (<task_id>)" && git push`，然后把 STATUS 的 code_sha 更新成新的 HEAD。
- **PR 评论**：OMO 和 Eric 用的是同一个 GitHub 账号 EricXu-0805。所以 OMO 发的评论第一行必须以 `[OMO]` 开头；不带这个前缀的评论，视为 Eric 本人所写。读评论：`gh api repos/$REPO/issues/<PR号>/comments --jq '.[] | [.created_at, .html_url, (.body | split("\n")[0])] | @tsv'`。Eric 对 D 编号的答复，OMO 抄进 DECISIONS，并附评论链接。

## 8 状态写回

每完成一个任务，或者每次停下，都按这个顺序写回：

1. 代码提交，推到本任务的分支；记下 `CODE_SHA=$(git -C <本任务目录> rev-parse HEAD)`。
2. `git -C ~/work/illini-docs pull --ff-only`，然后记下 `DOCS_SHA=$(git -C ~/work/illini-docs rev-parse HEAD)`。docs_sha 指写这条记录之前材料分支的 HEAD，也就是本任务开工时读到的 STATUS 版本。
3. 在 `$DOCS/STATUS_LOG.md` 末尾追加一条。格式以 STATUS_LOG 文件开头「格式」一节为准：标题是 `### Lnn · YYYY-MM-DD HH:MM CT · 做了什么`，下面是 9 个固定字段。编号接着最后一条往下编，用 `grep -oE '^### L[0-9]+' "$DOCS/STATUS_LOG.md" | tail -1` 查最后一条。日志路径写在「命令」字段里。
4. 改写 `$DOCS/STATUS.md`：写于（CT）、code_sha、docs_sha、CI 表、验收表里对应的那一行、next_task_id（只写一个，取法见 BACKLOG §0.1）、阻塞与等待 Eric 的 D 编号。
5. 有证据文件（appendix/env/、appendix/visual/ 等）时，放进同一个提交。
6. `git -C ~/work/illini-docs add docs/community-platform && git -C ~/work/illini-docs commit -m "docs(community): <task_id> status" && git -C ~/work/illini-docs push`。
7. 推送被拒（远端有新提交）时，只对本地还没推送的这个提交执行 `git -C ~/work/illini-docs pull --rebase`，然后再推。不 force push。

写回内容里不放凭据、合成账号的密码、staging.env 的内容、access token、真实用户数据和外站原文。完整日志留在 tony-ws 的 `~/work/illini-dev-env/logs/` 和 `$EV`，不提交；STATUS_LOG 里只摘汇总行和日志路径。

## 9 Vercel 护栏与 demo 预览（P1.13、D-18）

规则、命令和 DoD 以 BACKLOG P1.13 为准。下面给出符合那些规则的脚本，外加一层：把 Node 前缀里的 vercel 链接也改指护栏。这一层管的是 P1.13 之前就已经在运行的进程。比如 tmux 里的 omo，它的 PATH 里 Node 前缀排在 `~/.local/bin` 前面，改 .bashrc 和 .profile 管不到它。

**① 护栏脚本 `~/.local/bin/vercel`。** 写好后执行 `chmod 755`，再执行 `ln -sfn vercel ~/.local/bin/vc`：

```bash
#!/usr/bin/env bash
# vercel guard (P1.13, D-18; RUNBOOK §9). Installed as ~/.local/bin/vercel; the Node-prefix vercel/vc links point here too.
set -uo pipefail
DEMO_DIR=$HOME/work/demo-publish
DEMO_PROJECT=$(cat "$HOME/.config/illini/vercel-demo-project" 2>/dev/null)
block() { echo "vercel guard: $1 blocked (D-18)" >&2; exit 1; }
for a in "$@"; do
  case "$a" in
    --prod|--prod=*|--production|--target|--target=*|promote|rollback|env|pull|domains|domain|alias|aliases|dns|certs|cert|redeploy|remove|rm|switch|teams|integration|integrations|git|blob) block "$a" ;;
  esac
done
case "${1:-}" in
  --version|-v|--help|-h|help|whoami|ls|list|inspect|logs) ;;
  project|projects) case "${2:-}" in ls|list) ;; *) block "project ${2:-}" ;; esac ;;
  link) { [ -n "$DEMO_PROJECT" ] && [ "$PWD" = "$DEMO_DIR" ] && [ "$*" = "link --yes --project=$DEMO_PROJECT --scope ericxu-0805s-projects" ]; } || block "link" ;;
  ''|deploy|-*) { [ "$PWD" = "$DEMO_DIR" ] && [ -f "$DEMO_DIR/.vercel/project.json" ]; } || block "deploy outside $DEMO_DIR" ;;
  *) block "$1" ;;
esac
[ -n "${VERCEL_REAL:-}" ] && exec "$VERCEL_REAL" "$@"
exec "$HOME/.local/opt/node/bin/node" "$HOME/.local/opt/node/lib/node_modules/vercel/dist/vc.js" "$@"
```

真实 CLI 用 vc.js 加 node 调用，不用 `~/.local/opt/node/bin/vercel`。那个链接在下一步会改指护栏，用它会自己调自己。`VERCEL_REAL` 只在 BACKLOG P1.13 的自测里设成 `/bin/echo`。

**② PATH 和链接。**

```bash
cp -p ~/.bashrc ~/.bashrc.before-P1.13-$D; cp -p ~/.profile ~/.profile.before-P1.13-$D
printf '\n# vercel guard first in PATH (P1.13, D-18)\nexport PATH="$HOME/.local/bin:$PATH"\n' >> ~/.bashrc
printf '\n# vercel guard first in PATH (P1.13, D-18)\nexport PATH="$HOME/.local/bin:$PATH"\n' >> ~/.profile
ln -sfn "$HOME/.local/bin/vercel" ~/.local/opt/node/bin/vercel
ln -sfn "$HOME/.local/bin/vercel" ~/.local/opt/node/bin/vc
~/.local/opt/node/bin/vercel deploy --prod; echo "exit=$?"     # vercel guard: --prod blocked (D-18)，exit=1
```

以后不升级、不重装 Vercel CLI，因为重装会把两个链接改回去。每次执行 `npm -g` 之后，都要确认 `readlink ~/.local/opt/node/bin/vercel` 仍然指向 `~/.local/bin/vercel`。

**③ demo 项目与目录。**

```bash
vercel project ls --scope ericxu-0805s-projects 2>&1 | tee $EV/$TS-vercel-projects.txt
vercel inspect illini-community-demo.vercel.app --scope ericxu-0805s-projects 2>&1 | tee $EV/$TS-demo-inspect.txt   # 输出里的项目名
install -d -m 700 ~/.config/illini && printf '%s\n' '<上一行的项目名>' > ~/.config/illini/vercel-demo-project
mkdir -p ~/work/demo-publish && cd ~/work/demo-publish
vercel link --yes --project=$(cat ~/.config/illini/vercel-demo-project) --scope ericxu-0805s-projects   # 护栏只认这一种写法
find ~/work/demo-publish -maxdepth 1 -name '.env*.local' -print -exec rm -f -- {} +   # vercel link 会自动拉短期 VERCEL_OIDC_TOKEN 写进 .env.local（CLI 65.15.0 实测）：不读内容，直接 rm（不进回收站），删了就记进 STATUS_LOG
ls -A ~/work/demo-publish                 # 只有 .vercel 和 .gitignore；还有别的 .env* 文件，按 STOP-7 停下
find ~/work -name .vercel -type d         # 只有 /home/guoyi/work/demo-publish/.vercel
```

项目名同时写进 STATUS_LOG。以后每次在 ~/work/demo-publish 执行 `vercel link` 之后，都先跑上面那条 find，删掉 `.env*.local` 并记进 STATUS_LOG（Eric 2026-11-13 经 Claude 答复）。P1.13 时目录里只有 .vercel；demo 的运行文件在 BRAND.7 才放进来（④）。

**④ 预览部署（BRAND.7）。**

1. 按 BACKLOG BRAND.7 更新 ~/work/demo-publish 里的运行文件。只放运行文件，不放 .env、日志、聊天记录和截图。
2. 执行 `cd ~/work/demo-publish && vercel deploy --scope ericxu-0805s-projects --yes 2>&1 | tee ~/work/illini-dev-env/logs/demo-deploy-$(date -u +%Y%m%dT%H%M%SZ).log`，输出的最后一行是预览 URL。
3. 执行 `curl -s -o /dev/null -w '%{http_code}\n' <预览URL>`，期望 200。返回 401，说明这个项目开了 Deployment Protection：记下来，交给 Eric 在 E12 时用浏览器看。
4. 转正（promote）只由 Eric 做（E12）。

## 10 omo 在 tony-ws 上的配置

| 项 | 值（2026-11-12 核对） |
|---|---|
| 程序 | OmO Native 5.1.68，运行时在 ~/.omo/binary-runtime/5.1.68，命令是 ~/.local/bin/omo。5.1.69 已发布，没有升级 |
| 会话 | tmux 会话 `omo`。Eric 查看：`ssh -t tony-ws tmux attach -t omo` |
| 默认模型 | provider anthropic-subscription，model claude-opus-5-5（~/.omo/agent/settings.json） |
| Claude 号池 | 4 个 CAACI Team 号，accountStrategy 是 fill-first：一个号额度用完才换下一个，顺序 default → account-2 → account-3 → account-4 |
| 备用链 | settings.json 的 retry.fallbackChains：claude-opus-5-5、claude-fable-5-2 → chatgpt-subscription/gpt-6-astra；claude-sonnet-5-5 → gpt-6.1-sol；claude-haiku-5-5 → gpt-6-luna-fast |
| ChatGPT 号 | default 是 admin@caaciorg.com，login-2 是 dev@caaciorg.onmicrosoft.com，都走 SIWC，plan 已开 |
| 统计 | .bashrc 设了 `OMO_DISABLE_TELEMETRY=1` |
| 档位（2026-11-13） | 主会话 Opus 5.5 xhigh，由 Claude 经控制 socket 设定（D-42 第 7 项） |
| 类别路由（2026-11-13） | ~/.omo/omo.json 给 deep-low、deep-high、ultrabrain 加了 Claude 兜底，unspecified-high 用 Opus 5.5 high；其余类别用 omo 内置链 |

OMO 自己的规则：

- 不改 ~/.omo 下的配置文件，不加、不删、不切换账号，也不升级 omo。这些都由 Eric 决定。例外：schedule_prompt 写进 ~/.omo/agent/schedule/ 的续跑提醒，和 create_goal 建的目标（D-42 第 8 项）。
- 不读 ~/.omo/agent 下权限为 700 的目录，例如 anthropic-subscription*、gateway、rpc，里面是登录凭据。
- 加 ChatGPT 号由 Eric 在 omo 里执行 `/login chatgpt-subscription`，新号追加，不覆盖已有的号。`/gpt-account add` 有 device ID bug，不要用。
- 切到备用模型后，任务规则照旧。四个 Claude 号和备用链都用不了时，把当前任务提交到本地任务分支（不推送），在 STATUS 的阻塞项写「模型额度，<CT 时刻>」。不等 Eric：goal 或续跑提醒唤醒、额度恢复后，先跑 §2 核对，再从 STATUS 的 next_task_id 接着做。
- 续跑提醒（D-42 第 8 项）：`schedule_prompt` create，everySeconds 3600，提示词原文：「D-42 续跑。你正在执行任务就忽略本条。空闲时：按 RUNBOOK §2 核对；读 #369、#370 的新留言（RUNBOOK §7、D-42 第 6 项），有 E 或 D 的答复就按 BACKLOG §2 解锁；然后从 STATUS 的 next_task_id 接着做。可做队列为空就只读留言，不新开任务。」
- OMO 不靠会话记忆续接工作。会话中断后，从 STATUS 的 next_task_id 接着做。这要求每个任务都按 §8 写回。

## 11 Eric 一次性准备（E1–E14）

括号里写这一项解锁哪些任务。完成后，在相关 PR 留言或在 STATUS_LOG 留痕；OMO 读到后抄进 STATUS。

- **E1** 提交并推送 V5 分支，开草稿 PR（D-14；解锁 P1.1 ④）。**2026-11-12 已完成**（617055e，草稿 PR #370，见 STATUS_LOG L13）；以下是当时的步骤，留作重建分支时参考。在 Mac 上执行 `cd /Users/xiaogangxu/Downloads/CAACI/Community-Platform/plan-v5 && git add -A docs/community-platform && git commit -m 'docs: 玉米地社区方案 V5' && git push -u origin codex/community-plan-v5`，再执行 `gh pr create --draft --base main --head codex/community-plan-v5 --repo EricXu-0805/CAACI_Community_Marketplace_Bazaar --title 'docs: 玉米地社区方案 V5'`。不合并。
- **E2**【2026-11-20 已完成，supervisor 代做，见 DECISIONS D-53 第 0 项 b】书面确认 staging-smoke 只有合成数据（D-29；解锁 P1.11、P2.6）。在 Supabase 后台打开项目 hygkwxugskijadgfisji → Authentication → Users，逐页看邮箱，确认没有真实用户；在 Table Editor 里抽看 profiles、items、posts、messages。确认后在 PR #369 留言「YYYY-MM-DD HH:MM CT 核对：staging-smoke 只有合成数据」。
- **E3**【2026-11-20 已完成，supervisor 代做，见 DECISIONS D-53 第 0 项 c】建合成账号和凭据文件（解锁 P1.11）。
  1. 在同一项目的 Authentication → Users → Add user → Create new user 里，依次建 syn-a@example.test、syn-b@example.test、syn-c@example.test，各用 24 位随机密码，并勾选 Auto Confirm User。
  2. 在 tony-ws 上执行 `install -d -m 700 ~/.config/illini && install -m 600 /dev/null ~/.config/illini/staging.env`。
  3. 写入 8 行：`STAGING_SUPABASE_URL=https://hygkwxugskijadgfisji.supabase.co`；`STAGING_SUPABASE_ANON_KEY=`（与仓库 Actions 变量 PR_SMOKE_SUPABASE_ANON_KEY 相同的公开 key，OMO 的令牌读不到变量）；以及 SYN_A_EMAIL、SYN_A_PASSWORD、SYN_B_EMAIL、SYN_B_PASSWORD、SYN_C_EMAIL、SYN_C_PASSWORD。
  4. 不写 service_role、数据库密码或 PAT。
- **E4** 应用冻结后的迁移（P2.6；P3.7、P4.11 同一流程）。
  1. 等 OMO 在 STATUS_LOG 写出「20261112120000 冻结」和 sha256。
  2. 在 Mac 上执行 `git fetch && git switch codex/community-topics-20261112 && git pull`，再执行 `shasum -a 256 supabase/migrations/20261112120000_community_post_topics.sql`，结果要与冻结值一致。
  3. 按仓库 RUNBOOK.md 托管迁移一节（「2026-07 candidate release sequence」第 15–16 条，出处见 [ENGINEERING.md](ENGINEERING.md) §11），只对 hygkwxugskijadgfisji 依次执行：只读 PRECHECK_20261112120000、经 ledger-aware migrations 端点应用、只读 VERIFY_20261112120000。不用 db push、raw psql 或 dashboard 的 SQL 编辑器。
  4. 在 PR #369 留言应用时间和 VERIFY 的输出。
- **E5**【2026-11-20 起由 supervisor 合并，见 DECISIONS D-53 第 0 项 g】合并配置修正 PR（解锁 P1.8）。P1.7 的 PR 全绿后审阅 diff，按仓库习惯合并到 main，OMO 不合并。D-41 如果选了单独的依赖修复 PR，同样由 Eric 合并。
- **E6** 官方账号的 profile id（D-13；P3.5、P4.9、P4.11 之前）。用 admin@caaciorg.com 在 staging（本地 dev 指向 staging）和生产站点各登录一次，并接受同意书。把两个 profile id 留言到 PR，它们不是机密。P4.11 发布时，在生产 Vercel 环境变量里设 COMMUNITY_OFFICIAL_PROFILE_ID。
- **E7** 微信后台核对与改名（D-27、D-30；解锁 BRAND.5）。
  1. 登录 mp.weixin.qq.com（AppID wxc3da81aa8852a6ff）。
  2. 设置 → 基本信息：记下主体类型和名称剩余修改次数。
  3. 设置 → 服务类目：记下现有类目、是否覆盖用户发帖（社区/论坛 UGC），以及需要的资质。
  4. 在名称处试填「玉米地」，没有重名或保护词提示再提交。
  5. 同时记下版本回退的入口，以及首个线上版本出问题时怎么停用（§13 要用）。
  6. 结果留言到 PR。
- **E8** caaciorg 的 fork 权限（D-31；解锁 P4.3）。
  1. 在 GitHub 网页把 a2751012962/caaciorg fork 成 EricXu-0805/caaciorg。
  2. Settings → Developer settings → Fine-grained tokens → 编辑 tony-ws 用的令牌 → Repository access 里加入 EricXu-0805/caaciorg，给 Contents 读写和 Pull requests 读写。
  3. OMO 推分支之后，如果令牌不能在上游开 PR，就在网页点 Compare & pull request，base 选 a2751012962/caaciorg 的 preview。
- **E9** 内测前四件事（P5.1 之前）：
  1. 域名（D-36）：在 Cloudflare Registrar 注册选定的域名并开自动续费，或者明确写「延后」。
  2. 董事会同意（D-37、LEGAL.1）。
  3. DMCA 代理人登记（LEGAL.3）：copyright.gov/dmca-directory → 建账户 → Designate Agent。服务提供方填 CAACI 法定名称和地址；备用名称填「玉米地」「Cornfield」「Illini Market」和在用域名；代理人按 D-38 填。付 6 美元，记下登记号和到期日（3 年后）。
  4. 投诉邮箱（D-39）：在 caaciorg.com 邮箱后台建好，转发给 Eric 和轮值伙伴。
- **E10** 邮件模板和发件显示名（BRAND.2 合并后）。在 Supabase 后台 → Authentication → Email Templates，把仓库 supabase/email-templates 里 confirm-signup、reset-password 的新版本，分别粘到 staging 和生产。生产 Vercel 环境变量 DIGEST_FROM 如果有覆盖值，只把显示名改成「玉米地 Cornfield」，发件地址仍用 send.illinimarket.com。
- **E11** 两张私有表格（解锁 CONTENT.1、CONTENT.4）。在 CAACI 名下的 Google Drive 建两张表，只共享给 Eric 和轮值伙伴，OMO 不访问：
  - 「问题库」：问题、板块、原帖链接、日期、是否敏感；
  - 「授权记录」：作者、平台、原文链接、授权凭证截图、授权范围、展示范围、期限、能否撤回、署名方式、允许的改动、是否无偿、日期。
- **E12**【2026-11-20 已完成，supervisor 代做，见 DECISIONS D-53 第 0 项 d】demo 转正（BRAND.7）。看过 OMO 给的预览 URL 后，先在 Vercel 网页 demo 项目的 Deployments 里记下当前的 production deployment id；再对这个预览点 Promote，或者本人执行 `vercel promote <预览URL> --scope ericxu-0805s-projects`。
- **E13** 生产发布（P2、P3、P4、P5）。生产迁移按仓库 RUNBOOK 托管迁移一节，H5 按 docs/SUPERVISED_RELEASE.md，小程序在微信后台提审和发布，每次单独执行。OMO 不做。
- **E14** 答复 D-41（依赖审计）和其余待定项：D-28 轮值伙伴、D-34 logo、D-35 视觉、D-32 合作组织、D-33 学校日历、D-38 代理人信息、D-40 是否请律师。答复写在 PR 留言里，由 OMO 抄进 DECISIONS。

## 12 STOP 清单

每条末尾标了 DECISIONS D-42 定的类别。【硬】OMO 永不执行，只由 Eric 本人做；OMO 可以在本地写好、不推送。【自决】OMO 自己处理，STATUS_LOG 标题加 `[OMO自决]`，写规则编号、选择、理由、证据路径、撤回办法。【跳过】停放这条任务，等 Eric 的动作或 D 编号。三类都不停下提问，接着做下一个不受影响的任务。另标【暂停推送】的，触发条件和做法见 D-42 第 2 项。

1. **开工核对不符**：`git rev-parse HEAD` 与 STATUS.md 的 code_sha 不同，或者工作区有不是本任务产生的改动 →【自决】：按提交作者 `omo@tony-ws.invalid` 认定是不是自己的提交（不看提交说明），是就把 STATUS 对齐到实际 HEAD；远端前进且能 fast-forward 就 `pull --ff-only`，把别人推的提交列进批次报告；出现分叉、归不了因的提交或未提交改动，不 stash、不 reset、不 clean，这个目录的任务转【跳过】。
2. **生产与官网标识**：任何命令、URL、env 或日志里出现 lfhvgprfphyfvhidegum（Illini 生产库）或 wslzeqhipvibeflmxznh（官网库），或者要对 illinimarket.com、caaciorg.com 发 POST/PUT/PATCH/DELETE →【硬】，指向或到达这两个库时另加【暂停推送】（D-42 第 2 项）。唯一例外：P4.3/P4.4 对 https://caaciorg.com/api/public-events 与 /api/articles 的只读 GET。
3. **托管数据库**：对 staging-smoke 或生产执行迁移、DDL、批量写，或任何需要 service_role 的调用 → 不做，交 Eric（E4）。OMO 在 staging 只用 anon key，以合成账号 A/B/C 做产品内的正常操作。【硬】
4. **凭据**：不索取、不持有、不打印 service_role、sb_secret_*、数据库密码、Supabase PAT、Vercel token、OpenAI key；~/.config/illini/staging.env 保持 600，内容不进仓库、日志、截图、PR。继续工作需要这些 →【硬】。
5. **对外动作**：不发邮件、Brevo、Discord、微信、小红书、Reddit 私信，不在任何外站发帖，不联系合作组织、作者或官网维护者；不碰 Brevo、周报 cron、OpenClaw、Codex 自动化。caaciorg 只做 D-11 授权的 P4.3 那一个 PR，并且 D-31 的权限到位后才推；上游 PR 由 Eric 在网页上开。【硬】。例外：`[OMO]` 评论发在本仓库的 #369、#370 上，不算对外动作（D-42 第 6 项）。
6. **Git**：不 merge 任何 PR、不转 ready、不推 main、不 force push、不 rebase 已推送的分支、不删远端分支；不对他人改动执行 `git reset --hard` 或 `git clean`。以上是 6a【硬】。6b【自决】：新分支名只用 `codex/community-` 或 `codex/config-` 开头，`wip/*` 不推；已有的分支只推 BACKLOG 写明的那些（codex/config-fixes-20261112、codex/community-topics-20261112、codex/brand-cornfield-20261112、codex/community-home-20261112、codex/community-p3-*、codex/community-events-*、codex/community-plan-v5、caaciorg fork 上的功能分支）。
7. **Vercel**：禁止 `vercel deploy --prod`、promote、rollback、env pull/add/rm、domains、alias；只允许 link 到 P1.13 记录的 demo 项目，预览部署只发到该项目；要碰任何其他项目 →【硬】。
8. **依赖与 lockfile**：只允许 D-16 的两项变化（packageManager 声明；@playwright/test 1.65.0 及其 playwright、playwright-core）和 D-41 批准的清单；8a【自决】：已批准的升级自己带出的传递变化（例如 STATUS_LOG L19 的 fsevents 删除），lockfile diff 存 $EV。8b【跳过】：新增依赖，或升级批准清单以外的包（包括改 overrides），把包名、版本、原因列进批次报告（例外：DECISIONS D-53 第 3 项，只限分支 codex/config-vite-645-20261120 上把本地重建的 vite 升到 6.4.5 或更新的 6.4.x 补丁版，Eric 2026-11-20 批准）。
9. **工作流与发布配置**：9a【硬】.github/workflows 只做 P1.2 与 P1.5 写明的改动（例外：DECISIONS D-51 第 4 项，只限分支 codex/config-ci-runner-20261119 上 ci.yml 的两处改动，Eric 2026-11-19 批准；DECISIONS D-53 第 5 项，只限在 #369 做 P1.8 时 `git revert c52badf` 这一个提交，Eric 2026-11-20 批准）。9b【硬】vercel.json 不改（BRAND.6 经 D-36 的那一处除外）。9c【硬】manifest.sha256 里已有的行、已应用到托管库或已在 main 上的迁移文件都不改。9d【自决】20261112120000 在 STATUS_LOG 记下「冻结」后不再改、也永远不改名，后续变更另起迁移，冻结后交 Eric（E4）；撤销冻结仍要 Eric 留言同意。
10. **视觉**：D-35 选定之前，不改现有页面的颜色、字号、间距和组件样式；新页面只用 App.vue 已有的 token，新增 CSS 不写 hex 字面量。D-35 已定 A，按方向 A 做【自决】。
11. **外站内容**：不对 Reddit、一亩三分地、美卡、知乎、小红书做任何访问、脚本、无头浏览器、镜像站、SERP API 或代理请求；冷启动内容由真人完成（CONTENT 组）。UIUC 日历只读官方文档与官方 feed（P4.7），只有抓 HTML 才拿得到 → 这条任务【跳过】。抓取本身【硬】。
12. **法律、品牌与付费**：法律文本、品牌名、运营方的变更不发布到生产；生产发布、小程序提审、域名注册、DMCA 登记和任何付费只由 Eric 做。LEGAL.1 未完成时，不把运营方改成 CAACI。【硬】
13. **共享工作站**：不 sudo，不改系统级配置，不动 Tony、danny 的进程、容器和文件；Playwright 并行 worker ≤6；容器用完即删。【硬】
14. **重复失败**：同一个失败修了两轮仍不过 →【自决】：换思路最多再试 3 次，每次在 STATUS_LOG 写假设和改动；不加 retries、不调 timeout、不删断言、不跳测试，也不越过任何【硬】条（例如不改已应用的迁移，不改 workflows）。共 5 次仍不过 →【跳过】，附日志路径和各次的差异。
15. **待定决定**：任务依赖的 D 编号仍为 open → 不替 Eric 选，跳到下一个不依赖它的任务，在 STATUS 写明在等哪个 D 编号。【跳过】
16. **文档与源码不一致**：发现 V5 文档与源码不一致 → 16a【自决】以源码为准继续，并在 STATUS_LOG 记录。16b【跳过】：如果影响本 STOP 清单、数据归属或授权边界。

遇到【硬】或【跳过】时：

1. 在 STATUS.md 的「阻塞与等待 Eric」写一条：规则编号、task_id、要 Eric 做的一件事。
2. 记进最终报告（D-43 第 5 项）。不逐条留 PR 评论。D-43 第 1–3 项范围内的【跳过】，OMO 按推荐直接做。
3. 接着做下一个不受影响的任务。BACKLOG §0.1 的「全停」只剩【暂停推送】一种，本地任务照做。

只有【暂停推送】当场在 #370 留评论，格式：

```text
[OMO] STOP-<编号>｜<task_id>｜<一个问题，一句话>
- 触发：<命令或文件>
- 日志：~/work/illini-dev-env/logs/<文件名> 或 $EV 下的文件
- 已完成到：<最后一个通过的步骤>；接下来先做：<不受影响的 task_id>
```

## 13 回退步骤

| 对象 | 怎么回退 | 谁做 |
|---|---|---|
| OMO 推过的提交 | `git revert <sha>` 后推送，不 reset、不 force push。草稿 PR 关不关由 Eric 决定 | OMO |
| 测试镜像 | P1.8 之前保留 pw1.60 镜像和 Containerfile.pw1.60。需要时用 `IMAGE=localhost/illini-dev:pw1.60-node22-pg17 $RC …` 强制指定 | OMO |
| run-checks.sh | 换回 `run-checks.sh.before-P1.2-<D>` | OMO |
| 宿主机 npm | 把 `~/.local/opt/npm-10.8.2.before-P1.2-<D>` 移回 `~/.local/opt/node-v22.23.5-linux-x64/lib/node_modules/npm`。只在 P1.2 ④ 出问题时这样做 | OMO |
| Vercel 护栏 | P1.13 本身出错时：`cp -p ~/.bashrc.before-P1.13-<D> ~/.bashrc`、`cp -p ~/.profile.before-P1.13-<D> ~/.profile`，再执行 `ln -sfn ../lib/node_modules/vercel/dist/vc.js ~/.local/opt/node/bin/vercel` 和 `ln -sfn ../lib/node_modules/vercel/dist/vc.js ~/.local/opt/node/bin/vc`，把 `~/.local/bin/vercel`、`~/.local/bin/vc` 改名为 `vercel.disabled-<D>`、`vc.disabled-<D>`（不删除）。P1.13 通过之后不回退，只有 Eric 要求时才移除 | OMO / Eric 决定 |
| staging 上的迁移 | 不回滚。按仓库 RUNBOOK.md「Migration roll-forward (preferred over rollback)」写前向修复迁移：OMO 起草，Eric 按 E4 应用 | OMO 起草 / Eric 应用 |
| 公开 demo | 在 Vercel demo 项目的 Deployments 里，把 STATUS_LOG 记下的旧 production deployment id 重新 Promote（BRAND.7 ⑤） | Eric |
| H5 生产 | 按仓库 RUNBOOK.md「Deploy rollback」和 docs/SUPERVISED_RELEASE.md，把上一个生产部署重新 promote，再在 main 上 revert | Eric |
| 生产库 | 按仓库 RUNBOOK.md「Migration roll-forward」或「Backup & restore」 | Eric |
| 小程序 | 微信后台的版本回退，入口和次数以 E7 时记下的为准。首个线上版本没有可以回退的旧版本，按 E7 记下的停用办法处理 | Eric |
