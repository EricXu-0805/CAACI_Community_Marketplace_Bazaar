# PR369 首轮CI环境失败与修复

检查时间：2026-11-12。目标提交 `e4c776b315d53b5c3a61db068b8911df1d681406`；Actions实际PR合并测试SHA `c4e4e2baf72f4229cc1a7a4ae1b70fbcf6554810`，合入基线 `7b18f2052e52a4268c25407d0584748477cbf978`。

[运行43210767544](https://github.com/EricXu-0805/CAACI_Community_Marketplace_Bazaar/actions/runs/43210767544) 的两个失败来自同一环境漂移：`ubuntu-latest` 已选择 Ubuntu 26.04.1，仓库锁定Playwright 1.60.0拒绝为该系统安装浏览器依赖。

| Job | 日志证据 | 结论 |
| --- | --- | --- |
| [Build H5 / 131157467821](https://github.com/EricXu-0805/CAACI_Community_Marketplace_Bazaar/actions/runs/43210767544/job/131157467821) | 11:38:12Z已输出 `DONE Build complete.`；11:38:13Z安装浏览器时报不支持chromium on ubuntu26.04-x64。 [原始日志](p2-checks/ci-job-131157467821.log) | H5编译成功，失败在随后浏览器安装；该job尚未启动浏览器验收。 |
| [Smoke / 131157467766](https://github.com/EricXu-0805/CAACI_Community_Marketplace_Bazaar/actions/runs/43210767544/job/131157467766) | 11:37:53Z既有三个公开schema读检查HTTP200；11:37:54Z安装浏览器时报不支持webkit on ubuntu26.04-x64。 [原始日志](p2-checks/ci-job-131157467766.log) | 未运行页面用例，不能认定话题页面失败或通过。 |

`ci.yml`、`app/package.json`、`app/package-lock.json` 在首批18文件提交中均未修改；本机对基线的diff为零。故这是既有CI/依赖组合遇到runner升级的失败，不是标题/板块代码产生的编译回归。相同基线在相同新runner上也会遇到此兼容问题。

本次经主代理授权，只在 `.github/workflows/ci.yml` 将实际执行 `playwright install` 的三个job——`build-h5`、`public-smoke`、`authenticated-smoke`——固定为 `ubuntu-24.04`，并添加简短原因注释。没有更改依赖、lockfile、账号权限、触发条件、测试步骤或其余job。Playwright包内的支持平台表包含ubuntu24.04-x64。

本地验证：Ruby `YAML.parse_file`通过；确认三个包含浏览器安装命令的job均指向24.04，其他job保持原值；`git diff --check`通过。以下关联测试 **12/12通过**，原始结果见 [ci-runner-tests.log](p2-checks/ci-runner-tests.log)：

```sh
node --test scripts/ci-hook-contract-boundary.test.mjs app/smoke/ci-artifact-privacy-boundary.test.mjs scripts/public-read-schema.test.mjs
ruby -e 'require "yaml"; YAML.parse_file(".github/workflows/ci.yml")'
git diff --check
```

本机是macOS，未声称在本机执行Ubuntu依赖安装；修复已推至 c52badf273aee9480f228d0d69fb47548ad53cb3，Actions运行43211362178正在确认。当前只解决浏览器尚未启动的环境阻断，不能把它记为CI已绿。

另外，首轮公开schema预检只检查原有字段，并未探测新title/category及新RPC；HTTP200不代表候选数据库已完成话题迁移。后续真实公开浏览器步骤仍须按迁移先行的合同核对隔离数据库；本轮没有应用任何托管数据库迁移。


## Runner修复后的CI与最终交接状态

后续head `c52badf`、[run43211362178](https://github.com/EricXu-0805/CAACI_Community_Marketplace_Bazaar/actions/runs/43211362178) 已越过浏览器安装阻断：

- **Build H5成功**，包括H5编译、产物边界和编译后auth恢复/admin恢复/持久草稿浏览器验收（job131159645865）。
- Type-check和Build mp-weixin均成功。
- Boundary regressions：**1994通过、1失败、1跳过**。唯一失败为 `wechat-openid-account-boundary.test.mjs` 的静态标记仍匹配 `mpTextGate(trimmed, 3, accountToken)`；本批为审核标题与正文已使用 `moderationText`，紧随调用的账号代次校验仍存在。不是遗漏账号保护，是测试未同步参数名。
- Public page sweep在停止监控前仍运行；未记录该旧run的最终结果。Protected staging account按PR触发规则跳过，不能视为通过。

仅修复两个测试文件：`app/smoke/wechat-openid-account-boundary.test.mjs` 同步准确标记；`app/smoke/community-post-topics.test.mjs` 增加“微信审核等待中换号→拒绝发布、0写入、not_committed并释放未提交重复保护”的行为验证。**没有修改产品代码。** 两文件专项 **11/11通过**，`git diff --check`通过；日志：[boundary-fix.log](p2-checks/boundary-fix.log)。

```sh
node --test app/smoke/wechat-openid-account-boundary.test.mjs app/smoke/community-post-topics.test.mjs
```

主代理已将修复提交为 **`005ca9d6b5ac23346dfeb38f3deb95984bffd27b`**。**最新head的完整CI仍待核验，不宣称全部检查通过。** 按交接决定停止旧run监控，没有启动额外全量测试；后续以PR369最新head的完整检查结果为准。真实候选数据库/托管Auth、完整RLS及双账号、微信真机与失败关联恢复UI等未完成项继续有效。
