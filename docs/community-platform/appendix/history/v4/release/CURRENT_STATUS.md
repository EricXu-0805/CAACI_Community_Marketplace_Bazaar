# 当前交付与下一批工作

更新：2026-11-12 · V4

```text
next_task_id: P1
next_action: 续接现有社区功能分支，在隔离环境补齐双账号登录/会话/换号验收，然后继续 P2 的商品关联单独补试功能、正式浏览器和失败恢复验收。
P0: 研究、原型、公开部署已完成；交接文件与 GitHub 归档见下方。
P1: 部分完成，独立开发环境和构建已建立，真实双账号会话仍待验。
P2: 第一批代码已实现并进行检查；关联失败后只补关联的 UI 尚未实现，完整验收也未完成。
P3-P8: 未实施；按依赖逐批进行。
```

## 现在可以看什么

- [公开 demo](https://illini-community-demo.vercel.app/)：示例数据、无需登录，演示操作只保存当前浏览器。
- [V4 方案](../PLAN.md)、[平台研究](../research/PLATFORM_RESEARCH.md)、[验收记录](../VERIFICATION.md)。
- [OMO 入口](../handoff/START_HERE.md)、[可复制启动提示](../handoff/OMO_PROMPT.md)。

## 已完成的产品交付

研究十个平台与 28 个官方来源；比较讨论、交易、活动、信任和企业网站的信息组织。社区首页改为讨论列表，商品与活动分别采用各自信息结构，稳定五项导航，删除口号区块、重复主入口及未接通的商业入口。具体取舍属于本轮设计建议，仍可根据用户反馈调整。

原型通过 122 项全量状态断言；最后搜索修正通过 12 项专项断言。真实浏览器已走通五条示例路径，另检查草稿、空态、转义、隐藏恢复和重置。公开部署后补验发布与商品关联。详细测试范围见验收记录。

## 公开部署版本

- Vercel team：team_y0dD6SAaCnkJ9cStgYYkzKeW。
- 新项目：illini-community-demo / prj_GneRqAKWscggYaBNaSvfDfsYKxi3。
- 部署：dpl_E3AmucjjeUZfCmPQ7NQRi2eiaAv6，READY。
- 稳定地址：https://illini-community-demo.vercel.app/
- 固定地址：https://illini-community-demo-jybiddrk5-ericxu-0805s-projects.vercel.app/
- 发布目录 public-demo/；文件及 SHA256 见 PUBLISH_MANIFEST.json。
- 普通 HTTP 访问 5 个文件均为 200，内容与本地一致；无登录信息。项目没有连接真实后端。

## 正式代码分支

- 仓库：EricXu-0805/CAACI_Community_Marketplace_Bazaar（私有）。
- 基线 main：7b18f2052e52a4268c25407d0584748477cbf978。
- 续接分支：codex/community-topics-20261112。
- 本轮新增 nullable title/category、发布/列表/详情、板块筛选与兼容搜索；保留旧动态及本人最多三件在售商品关联。
- 远端提交：`005ca9d6b5ac23346dfeb38f3deb95984bffd27b`；[草稿 PR #369](https://github.com/EricXu-0805/CAACI_Community_Marketplace_Bazaar/pull/369)，未合并。
- 已过类型检查、54项关联测试、临时合成schema PostgreSQL检查、3个新HTTP fixture浏览器用例、6个原附件/键盘用例及双端构建。Node为22.23.2，本机npm11.12.1与仓库声明10.8.2不同，声明版本由CI继续核对。
- 详细命令、原始日志与未验范围见 [P2_IMPLEMENTATION](P2_IMPLEMENTATION.md)。
- 本地 worktree 仍是未提交副本；GitHub提交读取的是当前完整工作树（含两处审查修复），VM以远端分支续接。

## 接手者下一步

先读工程基线和 P2 实施证据，取得上面的已有分支。核对当时远端与未提交工作；不要只从 main 另起一套标题/板块实现。补建真正隔离的账号、数据库、存储及通知目标，完成 P1 的 A 退出/B 登录与缓存隔离，P2 还须实现“帖子已存在时只补失败的商品关联”的恢复界面，不能只跑测试后关闭任务。之后再补 P2 的双账号发帖回复、旧链接、权限、断网、部分成功与未知提交恢复。

官网 preview 仍可能连接生产会员数据库；不能用它写测试报名或发测试会员邮件。正式功能没有合并 main、没有迁移生产数据库；下一步先完成验收并修复，再按项目发布条件交付。

## 本轮变更记录

- 2026-11-12：用户选择 Vercel 独立公开演示；已发布并取得匿名访问和浏览器结果。
- 2026-11-12：详细方案升级 V4；原 V3 与旧验收记录保留 revisions/v3，当前入口不再引用其旧状态。

## GitHub 与便携包

- 正式代码：[草稿 PR #369](https://github.com/EricXu-0805/CAACI_Community_Marketplace_Bazaar/pull/369)。
- 方案/研究/demo材料分支：`codex/community-platform-v4-20261112`，路径 `docs/community-platform/`。
- VM可直接从[材料分支](https://github.com/EricXu-0805/CAACI_Community_Marketplace_Bazaar/tree/codex/community-platform-v4-20261112/docs/community-platform)取本包，再单独跟踪正式代码分支。
- 便携包：`Illini-Community-OMO-V4-2026-11-12.zip`，入口 `Illini-Community-V4/handoff/START_HERE.md`；内容清单在 `HANDOFF_FILES.json`。
- 包内不含 `.env`、登录凭据、原聊天截图与原始对话记录。正式工程需使用 VM 自己的 GitHub 权限取得。

## GitHub 检查进度

首个提交的类型检查与微信构建通过；网页构建在编译完成后因 Ubuntu26.04 不受 Playwright1.60 支持而未能安装测试浏览器，公开页面巡检同因未启动。已在 c52badf 将三个浏览器检查 job 固定至 Ubuntu24.04，未改依赖或账号权限。该轮结果见下方追加记录；[最新提交的 CI](https://github.com/EricXu-0805/CAACI_Community_Marketplace_Bazaar/actions/runs/43212596901) 仍在运行，接手时必须重新读取。详情见 [CI 说明](P2_CI_FINDINGS.md)。

Supabase 自动预览在项目设置中关闭，本次检查标记 skipped；受保护账号测试也跳过，不能算通过。当前不具备已验证的完整候选数据库/双账号链路。

### 最后一次检查与交接边界（005ca9d）

- c52badf 版本的类型、微信构建和 H5 job 已成功；H5包括编译后登录恢复、管理界面与草稿测试。
- 同轮 Boundary 结果为1994通过、1失败、1跳过。失败来自既有静态断言仍匹配旧变量名；现已同步并补了微信审核等待期间切换账号不得写入帖子的行为检查，专项11/11通过。
- 最后提交005ca9d仅修改两个测试文件，产品代码未再修改。**新提交的完整GitHub CI尚待结束；不要把c52badf的结果改写成005ca9d全绿。** 最新结果在PR #369的Checks；前一轮公开page sweep尚未完成。
- 本次交付到研究/示例demo和可续接的正式代码草稿；P1/P2保持部分完成，不能据此应用生产迁移或开始真实用户内测。
- 本机原工程仍有20项tracked修改和8项untracked，数量与接手时相同；本轮没有把这些改动带入PR。
