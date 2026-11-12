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
