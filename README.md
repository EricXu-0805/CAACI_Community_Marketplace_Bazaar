# Illini Market (CAACI Community Marketplace & Bazaar)

> UIUC 校园二手交易 + 社区广场 · 中英双语 · 专为 Champaign-Urbana 华人学生社区设计

- **线上**: https://illinimarket.com
- **GitHub**: https://github.com/EricXu-0805/CAACI_Community_Marketplace_Bazaar
- **发布与审计入口**: [`docs/audit/README.md`](docs/audit/README.md)

## 产品定位

**闲鱼 + 小红书** 混合模式,聚焦 UIUC / CAACI 华协社区。线上已有 H5 版本；当前工作树是尚未部署的审计 release candidate，不能把下述候选修复视为线上已生效。

| 模块 | 说明 |
|---|---|
| **二手交易** | 发布/浏览商品,分类 + 多维度筛选 + 搜索,收藏、出价(OBO)、聊天、举报、屏蔽 |
| **广场 (Plaza)** | 官方置顶 + 用户发帖(文字 + 最多 4 图) · 评论回复 · 点赞 · 分享 |
| **私信系统** | 一对一 text/emoji/sticker · 置顶/免打扰/archive · 回复引用 · 已读 · **结构化报价 + meetup** · 在线状态/正在输入；公共聊天媒体已关闭 |
| **成交与评分** | accepted offer + 卖家确认形成私有精确成交归属；只有真实双方可互评 |
| **通知中心** | 站内通知 + 原子 reminder · 可选即时 meetup/digest 邮件 · 退订 |
| **个人中心** | 公开短 UID · 资料编辑 · 浏览记录(商品+帖子) · Illini 认证徽章 · 屏蔽列表 |
| **换汇防诈骗** | 四处安全警告:首页/发布/详情/聊天,对标杀猪盘诈骗 |

## 技术栈

```
uni-app (Vue 3 Composition API) + Vite 5 + TypeScript
          │
          ├─ H5 (Vercel, 生产)
          └─ mp-weixin (预留,未上线)

Supabase
  ├─ Postgres (table ACL + RLS + column grants + trigger/RPC)
  ├─ Auth (PKCE flow · email/password · password reset)
  ├─ Storage (item-images/<uid>/... + managed banners)
  └─ Realtime (private exact-conversation channels + source-table RLS)

Vercel Edge API
  ├─ auth/admin/moderation/translation/share/geocode/provider bridges
  └─ protected cron (digest, retention, account deletion, banner GC)
```

## 目录结构

```
/
├── app/                        # uni-app 前端
│   ├── src/
│   │   ├── pages/              # pages.json 当前 28 个页面
│   │   ├── composables/        # 账号、商品、消息、通知、翻译等 33 个 composable
│   │   ├── components/         # UIcon/UButton/ChatThread/导航等公共组件
│   │   ├── utils/              # 工具函数 (friendlyErrorMessage, expandSearch, compressImage, quickTranslate)
│   │   ├── types/              # TypeScript 类型定义
│   │   ├── static/             # 静态资源 (SVG icons, manifest)
│   │   ├── App.vue
│   │   ├── main.ts
│   │   └── pages.json          # 路由 + TabBar
│   ├── vite.config.ts
│   └── package.json
├── supabase/
│   ├── migrations/             # 历史迁移 + 时间戳候选迁移
│   └── _ops/                   # 高风险迁移的 PRECHECK/VERIFY/REGRESSION
├── docs/
│   ├── PRD.md / ROADMAP.md / TRANSCRIPT.md   # 产品文档
│   └── audit/                  # 历史报告 + 2026-07 综合审计/复审
├── api/                        # 认证、翻译、审核、邮件、分享等 Vercel functions
├── vercel.json
└── README.md
```

## 数据库迁移清单

| # | 文件 | 内容 |
|---|---|---|
| 001 | `initial_schema.sql` | profiles / items / conversations / messages / favorites + RLS |
| 002 | `add_negotiable.sql` | items.negotiable (OBO) |
| 003 | `view_count_rpc_and_conv_update.sql` | `increment_view_count` RPC + `last_message_at` trigger |
| 004 | `security_hardening.sql` | reports / blocks 表 + 策略加固 |
| 005 | `notifications_and_price_drop.sql` | 通知表 + 降价自动触发器 |
| 006 | `sold_notification_trigger.sql` | 售出时通知买家 |
| 007 | `search_trigram_index.sql` | pg_trgm GIN 索引(模糊搜索) |
| 008 | `messages_delete_policy.sql` | 消息软删除策略 |
| 009 | `emergency_fixes.sql` | auth 修复 + profile backfill |
| 010 | `plaza_and_uid_and_chat_flags.sql` | 广场三表 + `profiles.uid` + 聊天 pin/mute + `currency_exchange` 分类 |
| 011 | `rls_hardening_and_perf_indexes.sql` | 7 张表 UPDATE WITH CHECK + Storage 路径 + 5 个关键索引 |
| 012 | `rate_limiting_and_dedupe.sql` | 5 张表 BEFORE INSERT 触发器(硬性限流 + 短窗口去重) |
| 013 | `security_patches.sql` | 审计补丁:notifications INSERT deny / conv flag 隔离 / 归一化去重 |
| 014–089 | `supabase/migrations/` | 图片尺寸、Plaza、审核、管理、offer/meetup、通知、微信等后续能力（历史上 014/015 各有重复版本，见审计） |
| 20260717–19… | `supabase/migrations/` + `_ops/` | 本轮公共写入、双向屏蔽、证据/注销、停权/admin、成交评分、FK、Storage、private Realtime、邮件 attribution/claim、Data API 精确 ACL、管理员令牌生命周期、确定性分页、真实 FK 与 ACL 尾部等 **35 条候选修复**；生产数据库已按精确 ledger 应用 34/35，密码式微信凭据退役迁移仍需匹配的 passwordless canary |

仓库当前共有 90 条历史迁移与 35 条候选迁移（合计 125 条）。生产 ledger
已逐条核对为 34/35，仅 `20260718140000_retire_wechat_password_credentials.sql`
尚未应用；应用 bundle 仍需从最终提交生成并验收。不要在任何现有环境直接盲跑
`db push`。先读最新 [`docs/audit/`](docs/audit/) 报告，按 PRECHECK →
备份/staging → migration → VERIFY/REGRESSION/canary 的顺序执行。

## 本地开发

**前置**: Node `22.x` + npm `10.8.2`（见 `.nvmrc` / package engines），一个
可丢弃的开发 Supabase 项目。Node 20 已不在本仓库支持范围。

```bash
# 1. 装依赖
cd app
npm ci --legacy-peer-deps

# 2. 配环境
# 复制 app/.env.example 到 app/.env，填入:
#   VITE_SUPABASE_URL=https://<your-project>.supabase.co
#   VITE_SUPABASE_PUBLISHABLE_KEY=<sb_publishable-key>
# Legacy rolling fallback only: VITE_SUPABASE_ANON_KEY=<anon-jwt>
#   VITE_BASE_URL=https://your-local-or-staging-app.example
# 非 H5 构建必须显式提供合法 origin；不会静默回退到生产站点

# 3. 跑 migrations
# 新开发库可按仓库迁移建立；生产库必须先做 ledger/schema 对账
# 高风险迁移先运行 supabase/_ops/PRECHECK_*.sql，部署后运行 VERIFY_*.sql

# 4. 启动
npm run dev:h5          # H5 (http://localhost:5173) — Vite only, /api/* 会 404
npm run dev:vercel      # vercel dev (http://localhost:3000) — 同时跑 Vite + /api/* edge functions
npm run dev:mp-weixin   # 微信小程序 (需微信开发者工具)

# 5. 生产构建
npm run build:h5        # 产物在 app/dist/build/h5
npm run build:mp-weixin # 微信小程序产物在 app/dist/build/mp-weixin
npm run type-check      # 只做类型检查

# 6. 浏览器冒烟（本地门；CI 只在受管 secrets 可用时提供非阻断信号）
npm run smoke           # pages.json 28 页 × 亮/暗 + 语义/契约检查

# 7. 全量 deterministic boundary（在仓库根目录）
cd ..
node --test api/*.test.mjs scripts/*.test.mjs app/smoke/*.test.mjs
```

**`dev:vercel` 用途**: 当你需要本地调试 `/api/translate`、`/api/moderate`、`/api/admin` 等
serverless 函数时使用 (Vite 不会 serve `api/*` 文件)。首次使用前需 `vercel login` + 项目链接
(本仓库已 link，`.vercel/` 已存在)。`dev:h5` 适合纯前端开发；`dev:vercel` 适合需要打 API 的场景。

### 冒烟回归 `npm run smoke`

大改动前后跑一遍当回归门：路由清单会与 `pages.json` 对齐，加载全部页面（亮+暗，
WebKit/iOS Safari 引擎），并检查设置页语义、关键源码契约和意外 console/5xx。
CI 已有 smoke job，但当前仍不是 branch protection 的 required check。首次需安装对应浏览器引擎。

- 默认只跑**登出态全页巡检**(无凭据,安全)。
- 想验证**登录态页面与会话门禁**：只能使用无个人数据的专用合成账号，并显式设置
  `SMOKE_EMAIL=<邮箱> SMOKE_PASSWORD=<密码> SMOKE_ACCOUNT_IS_SYNTHETIC=true SMOKE_DATASET_IS_SYNTHETIC=true npm run smoke`。
  CI 中浏览器截图、trace、video 与 artifact 上传全部关闭；带数据的失败证据只在受控本机保存。
  ——凭据走环境变量,不入库；该自动 smoke 只读访问首页、广场、消息、个人、通知和发布页，
  **不会**真正发布商品/帖子或发送聊天消息。真实写路径需使用专用测试账号另行 E2E。
- config 会自动清理 `*_PROXY` 环境变量(本机 Clash 等代理会拦截 localhost 让就绪探针挂起;
  仅影响 Node 探针,浏览器仍直连)。
- 用例在 [app/smoke/](app/smoke/),配置 [app/playwright.config.ts](app/playwright.config.ts)。

## 部署

- **当前应用工作树仍是未部署的 release candidate**：生产发布已获明确授权，数据库已
  应用 34/35；仍须从最终提交生成全新 canary，关闭 WeChat secret、HIBP、Owner 和真实
  用户端/管理员端回归门后，才能提升为稳定应用。
- 当前 35 条候选迁移存在 API/旧客户端/WeChat 凭据/Storage/Realtime/cron/admin token 的顺序依赖；按
  [RUNBOOK 的候选发布顺序](RUNBOOK.md#2026-07-candidate-release-sequence) 执行，不要把目录排序直接等同于生产发布方案。
- **H5**: 直接 `vercel --prod` (或 git push main 自动部署)。`vercel.json` 已配好 rewrites。
- **Supabase Auth Redirect URLs** 必须包含生产域名才能收到密码重置邮件:
  - Site URL: `https://illinimarket.com`
  - Redirect URLs: `https://illinimarket.com/**`

## 安全状态

- RLS、精确 Storage 路径、限流/去重、PKCE 和安全提示等基础已经存在；
- 2026-07 候选新增了跨账号、状态机、迁移和管理员边界回归；
- 生产数据库已有 34/35 候选迁移；候选应用修复及回归脚本仍须以最终 canary 和稳定部署的真实证据为准；
- 当前发布边界和审计使用规则见 [审计索引](docs/audit/README.md)。

**排查入口**: 先读 `docs/audit/README.md` 和 `RUNBOOK.md`；`docs/SECURITY_SETUP.md`
只保留历史 activation 背景与当前安全警告，不能替代候选发布顺序。

## 贡献约定

- 分支:`feature/<topic>` / `fix/<topic>` / `chore/<topic>`
- 提交信息:开头用 `feat:` / `fix:` / `chore:` / `docs:` / `perf:` / `refactor:`
- 新功能带 i18n key 双语文案(`useI18n.ts`)
- DB 变更只新增唯一时间戳 migration，不改已上线历史文件；必须配套 PRECHECK/VERIFY/REGRESSION
- PR 前跑 `npm run type-check`

## Roadmap

当前 release gate 与后续方向详见:
- `docs/audit/README.md` — 审计归档摘要(原始体检报告见 git 历史)
- `docs/ROADMAP.md` — release candidate → staging → production beta 路线图

## License

应用源码为私有、All rights reserved。第三方依赖继续受各自许可证约束；
当前 exception inventory 与确定性许可证漂移门禁见
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) 和
[`docs/NPM_DEPENDENCY_TRIAGE.md`](docs/NPM_DEPENDENCY_TRIAGE.md)。
