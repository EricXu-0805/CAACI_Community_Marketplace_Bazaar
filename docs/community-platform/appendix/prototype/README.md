# V4 原型（公开 demo 的源码）

这是 2026-11-12 线上 https://illini-community-demo.vercel.app/ 的源码，从 V4 的 `prototype/` 原样移来（4e459bd）。它只表达信息结构，不是正式规格：名称、板块名、导航、视觉、上限和活动关联都和正式版不同，逐项差异见 [SPEC.md](../../SPEC.md) §14。

- BRAND.7 改的就是这份源码，部署步骤见 [BACKLOG.md](../../BACKLOG.md) BRAND.7 与 [RUNBOOK.md](../../RUNBOOK.md) §9 ④。
- `verify.js` 是 V4 的页面检查脚本，不部署；它只检查 20 个路由渲染出的 HTML 长度，不能证明页面状态正确。
- 部署用的 `vercel.json`、`robots.txt` 不在这里，BRAND.7 从 4e459bd 的 `release/public-demo/` 取。
