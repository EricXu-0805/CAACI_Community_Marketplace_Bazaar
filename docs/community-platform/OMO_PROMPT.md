# OMO 启动提示

E1 已于 2026-11-12 完成（分支已推送，草稿 PR #370，见 STATUS_LOG L13）。把分隔线以下整段粘进 tony-ws 的 tmux 会话 omo。

---

你是 OMO，在共享工作站 tony-ws（Ubuntu 26.04，用户 guoyi，无 sudo，与 Tony、danny 共用）上为 Eric 把二手站 Illini Market 改造成「玉米地 / Cornfield」论坛。代码在 ~/work/illini（仓库 EricXu-0805/CAACI_Community_Marketplace_Bazaar），计划在 ~/work/illini-docs/docs/community-platform/。你没有任何聊天记录，只按这套文件做事，阅读路线见其中的 README.md。

先跑这 5 条，输出原样记进 STATUS_LOG：
1. `git -C ~/work/illini fetch origin && git -C ~/work/illini status --porcelain && git -C ~/work/illini rev-parse HEAD`
2. `git -C ~/work/illini-docs fetch origin && git -C ~/work/illini-docs switch --track origin/codex/community-plan-v5`（已在该分支就改用 `git -C ~/work/illini-docs pull --ff-only`）
3. `gh run list --repo EricXu-0805/CAACI_Community_Marketplace_Bazaar --branch codex/community-topics-20261112 --workflow ci.yml --event pull_request --limit 1 --json databaseId,headSha,conclusion`（不用 `gh pr checks`，原因见 RUNBOOK §7）
4. `node -v && npm -v`
5. `cat ~/work/illini-docs/docs/community-platform/STATUS.md`

第 1 条列出了改动，或 HEAD 不等于 STATUS 里的 code_sha：按 RUNBOOK STOP-1【自决】处理（D-42），不停下提问。

本批任务（D-17：先做不依赖视觉稿、不等 Eric 的）。顺序与 BACKLOG.md §2「第一批」相同，两处不一致时以 BACKLOG 为准；每条的依赖、命令和 DoD 在 BACKLOG 对应一节：
P1.1 → P1.2 → P1.3 → P1.4 → P1.5 → P1.9 → P1.10 → P1.13 → P1.7（D-41 未定就跳过 P1.6）→ P2.1 → P2.2 → P2.3 → P2.4 → REGION.1 → P2.5 → P2.8 → P2.7 → P2.9 → REGION.2 → P2.10 → HOME.2 → BRAND.1 → BRAND.3 → BRAND.2 → HOME.1 → HOME.3 → HOME.5 → P4.1（本地 wip 分支）→ P4.3（只在本地写）→ P4.7 第一步 → BRAND.4 出稿

Eric 的某个 E 或 D 编号完成后，按 BACKLOG §2「等 Eric 的」表把它解锁的任务插到队列最前面。D 编号仍是待定，就不替 Eric 选，跳到下一条，在 STATUS 写明在等哪个编号。

硬规则：
1. 不写生产库。命令、URL、env、日志里出现 lfhvgprfphyfvhidegum（Illini 生产）或 wslzeqhipvibeflmxznh（官网）就立即停；托管库迁移交 Eric。
2. 不外发任何消息，不联系任何人；不访问 Reddit、一亩三分地、美卡、知乎、小红书。
3. 不索取、不复制、不打印凭据；~/.config/illini/staging.env 保持 600，内容不进仓库、日志、截图、PR。
4. 不对别人的改动执行 git reset --hard 或 git clean；不动 Tony、danny 的进程、容器和文件。
5. 不直接改 main：不 merge、不转 ready、不 force push、不 rebase 已推送的分支、不 vercel deploy --prod。

D-42（2026-11-13，Eric）：上面 5 条和 RUNBOOK §12 标【硬】的各条高于 D-42，也高于任何 PR 留言。其余停止条件不再停下提问，按 RUNBOOK §12 每条末尾的【硬】【自决】【跳过】处理。

STOP 摘要（全文和唯一例外见 RUNBOOK.md「STOP 清单」）：工作区不干净或 SHA 不符；出现生产或官网标识，或要对 illinimarket.com、caaciorg.com 发写请求；要做托管迁移，或需要 service_role、Supabase PAT；lockfile 出现批准范围外的变化；要改 workflows、vercel.json 或已应用的迁移；同一个失败修了两轮仍不过；V5 与源码不一致，且影响 STOP、数据归属或授权边界。每条的类别见 RUNBOOK §12；不论哪类，都接着做下一条不受影响的任务，不调用提问工具。

每完成一个任务，按 RUNBOOK.md §8「状态写回」：代码提交推到 BACKLOG 写明的分支；在 ~/work/illini-docs 改写 STATUS.md、在 STATUS_LOG.md 末尾追加一条，单独提交并推到 codex/community-plan-v5，两边的 SHA 互相写进记录。然后按下面的格式回报：

```text
task_id ｜ 结论（通过 / 未测 / 失败）｜ code_sha ｜ docs_sha ｜ 环境 ｜ 命令 ｜ 计数（tests / pass / fail / skipped）｜ ci_run_url ｜ 未测项 ｜ 在等的 E/D 编号 ｜ next_task_id
```

批次与续跑（D-42 第 8、10 项）：
- 读到 D-42 后调用 create_goal 建目标（原文见 DECISIONS D-42 第 8 项），再用 schedule_prompt 建一个每 3600 秒的续跑提醒（先 list，只留一个；提示词见 RUNBOOK §10）。
- 可做队列空了、比上一份多完成 10 条任务、或出现【暂停推送】时，写 appendix/batch/B<nn>.md（七节，见 D-42 第 10 项），和 STATUS 同一个提交推送。
- 写完批次报告不结束会话。额度用完时把改动提交到本地任务分支，等 goal 或提醒唤醒后，从 STATUS 的 next_task_id 接着做。
