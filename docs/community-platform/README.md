# 玉米地社区方案 V5

目标：把现有二手站 Illini Market 改造成「玉米地 · 伊利诺伊华人论坛 / Cornfield · Chinese community in Illinois」，以板块讨论为主，二手和活动作为站内分区。产品名、地区和运营方的决定见 [DECISIONS.md](DECISIONS.md) 的 D-20、D-21、D-26。

## 阅读路线

只有这一条：本文件 → [STATUS.md](STATUS.md)（读 `next_task_id`）→ [BACKLOG.md](BACKLOG.md) 里该任务那一节 → [RUNBOOK.md](RUNBOOK.md)（照着执行）。[SPEC.md](SPEC.md)、[ENGINEERING.md](ENGINEERING.md)、[DECISIONS.md](DECISIONS.md) 按需查。OMO 的启动提示是 [OMO_PROMPT.md](OMO_PROMPT.md)。

## 事实归属

一个事实只写在一个文件里，别的文件只放链接。两处说法不一致时，以下表指定的文件为准；文件与源码不一致时，以源码为准，并在 STATUS_LOG 记一条。

| 事实 | 唯一位置 |
|---|---|
| 代码分支、PR、code_sha、docs_sha、CI 结论、验收表、next_task_id、阻塞项 | [STATUS.md](STATUS.md) |
| 每次执行的命令、环境、计数、未测项；Eric 应用迁移、改名、登记等动作 | [STATUS_LOG.md](STATUS_LOG.md)（只追加） |
| 任务编号、依赖、负责人、命令、DoD、证据文件名、分支与 PR 归属 | [BACKLOG.md](BACKLOG.md) |
| 术语表、五个板块、品牌名与文案、导航、首页与逐页规格、视觉规则、i18n key | [SPEC.md](SPEC.md) |
| 数据归属、迁移内容、兼容矩阵、官网与校历接口合同、改名技术清单、CI 解读 | [ENGINEERING.md](ENGINEERING.md) |
| tony-ws 工具链、测试镜像、环境矩阵 L-SQL/L-UI/S-1/S-2、STOP 清单全文、Eric 一次性准备 E1–E14、回退 | [RUNBOOK.md](RUNBOOK.md) |
| D-01 至 D-41、试点指标定义、运营负责人、授权边界、运营主体、冷启动内容政策 | [DECISIONS.md](DECISIONS.md) |
| OMO 启动提示 | [OMO_PROMPT.md](OMO_PROMPT.md) |
| 三张视觉稿 A/B/C 与 27 张截图（等 D-35） | [design/](design/README.md) |
| V4 审核、调研、环境文件副本、logo 稿、截图矩阵、历史版本、原型 | [appendix/](appendix/) |

V4 及更早的材料按 D-14 放在 appendix/：V4 的 PLAN、VERIFICATION、handoff/、release/、research/ 在 appendix/history/v4/，V3 在 history/v3/，V2 全文在 history/v2/，原型源码在 appendix/prototype/。它们不作当前依据。HTML 镜像和 release/public-demo 副本没有移入，要看原样用 `git show origin/codex/community-platform-v4-20261112:docs/community-platform/<路径>`。

## 分支

| 分支 | 角色 | tony-ws 目录 |
|---|---|---|
| codex/community-topics-20261112 | 代码：P2 话题、板块、地区字段，PR #369（草稿） | ~/work/illini |
| codex/config-fixes-20261112 | 配置：npm、PostgreSQL 查找、品牌色、Playwright | ~/work/illini-config |
| codex/brand-cornfield-20261112 | 品牌：改名玉米地、徽章、logo 替换 | ~/work/illini-brand |
| codex/community-home-20261112 | 首页：论坛首页、板块页、列表行 | ~/work/illini-home |
| codex/community-p3-\<日期\> / codex/community-events-\<日期\> | P3 订阅与治理 / P4 活动 | ~/work/illini-p3 / ~/work/illini-events |
| codex/community-plan-v5 | 材料：本套文档，OMO 写回 STATUS 与 STATUS_LOG；不合 main | ~/work/illini-docs |
| feat/public-events-feed（fork EricXu-0805/caaciorg） | 官网活动接口，PR 开向 a2751012962/caaciorg 的 preview | ~/work/caaciorg |

每个分支的起点、装哪些任务、PR 开向哪里、谁合并，见 [BACKLOG.md](BACKLOG.md) §1；表外的分支一律不推。代码和状态分两次提交，步骤见 [RUNBOOK.md](RUNBOOK.md) §8「状态写回」。

新机器上的取法（tony-ws 上两个目录已存在，按 BACKLOG P1.1 ④ 切换，不重新 clone）：

```bash
git clone https://github.com/EricXu-0805/CAACI_Community_Marketplace_Bazaar.git ~/work/illini
git -C ~/work/illini switch --track origin/codex/community-topics-20261112
git -C ~/work/illini worktree add --track -b codex/community-plan-v5 ~/work/illini-docs origin/codex/community-plan-v5
```

## 证据标签

STATUS 与 STATUS_LOG 里每条结论只带一个标签，没有标签的句子不算证据。

- `[源码 <SHA>]`：读该 SHA 的源码得出，没有运行。
- `[本地测]`：在 tony-ws 或 Eric 的 Mac 上运行命令得出，附日志路径。
- `[CI run#<id>]`：GitHub Actions 的某次运行，附链接。
- `[隔离环境 <L-SQL|L-UI|S-1|S-2>]`：在 RUNBOOK 环境矩阵的某一层得出；S-1 用了 /api/moderate 替身，要写明。
- `[生产]`：对生产站点、生产库或公开网址的只读观察，写明谁看的。
- `[真人]`：真人操作或真人陈述，写明是谁。
