# Illini Market (CAACI Community Marketplace & Bazaar)

> UIUC 校园二手交易 + 社区广场 · 中英双语 · 专为 Champaign-Urbana 华人学生社区设计

- **线上**: https://caaci-community-marketplace-bazaar.vercel.app
- **GitHub**: https://github.com/EricXu-0805/CAACI_Community_Marketplace_Bazaar

## 产品定位

**闲鱼 + 小红书** 混合模式,聚焦 UIUC / CAACI 华协社区。H5 已上线生产,持续迭代中。

| 模块 | 说明 |
|---|---|
| **二手交易** | 发布/浏览商品,分类 + 多维度筛选 + 搜索,收藏、出价(OBO)、聊天、举报、屏蔽 |
| **广场 (Plaza)** | 官方置顶 + 用户发帖(文字 + 最多 4 图) · 评论回复 · 点赞 · 分享 |
| **私信系统** | 一对一聊天 · 置顶/免打扰 · 长按回复引用 · 快捷回复 · 已读标记 |
| **通知中心** | 降价提醒 · 物品售出 · 系统通知 |
| **个人中心** | 公开短 UID · 资料编辑 · 浏览记录(商品+帖子) · Illini 认证徽章 · 屏蔽列表 |
| **换汇防诈骗** | 四处安全警告:首页/发布/详情/聊天,对标杀猪盘诈骗 |

## 技术栈

```
uni-app (Vue 3 Composition API) + Vite 5 + TypeScript
          │
          ├─ H5 (Vercel, 生产)
          └─ mp-weixin (预留,未上线)

Supabase
  ├─ Postgres (RLS 全表启用)
  ├─ Auth (PKCE flow · email/password · password reset)
  ├─ Storage (items/<uid>/... 路径受限)
  └─ Realtime (plaza posts + messages + notifications)
```

## 目录结构

```
/
├── app/                        # uni-app 前端
│   ├── src/
│   │   ├── pages/              # 18 个页面 (home, plaza, post, detail, chat, ...)
│   │   ├── composables/        # 13 个 composable (useAuth, useItems, useMessages, ...)
│   │   ├── components/         # 公共组件 (CustomTabBar, DesktopNav)
│   │   ├── utils/              # 工具函数 (friendlyErrorMessage, expandSearch, compressImage, quickTranslate)
│   │   ├── types/              # TypeScript 类型定义
│   │   ├── static/             # 静态资源 (SVG icons, manifest)
│   │   ├── App.vue
│   │   ├── main.ts
│   │   └── pages.json          # 路由 + TabBar
│   ├── vite.config.ts
│   └── package.json
├── supabase/
│   └── migrations/             # 001-013 (见下表)
├── docs/
│   ├── PRD.md / ROADMAP.md / TRANSCRIPT.md   # 产品文档
│   └── audit/                  # 代码体检报告 (2026-04)
│       ├── MASTER_REPORT.md    # 主报告 (看这个)
│       ├── SECURITY_AUDIT.md
│       ├── ACCESSIBILITY_I18N_UX_AUDIT.md
│       └── CRITICAL_FIXES.md
├── api/                        # Vercel serverless (目前空置)
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

## 本地开发

**前置**: Node ≥ 18, 一个 Supabase 项目。

```bash
# 1. 装依赖
cd app
npm install

# 2. 配环境
# 在 app/ 创建 .env.local 或直接改 useSupabase.ts,填入:
#   SUPABASE_URL=https://<your-project>.supabase.co
#   SUPABASE_ANON_KEY=<anon-key>

# 3. 跑 migrations
# 在 Supabase SQL Editor 按 001 → 013 顺序执行所有 .sql
# 或用 Supabase CLI:  supabase db push

# 4. 启动
npm run dev:h5          # H5 (http://localhost:5173) — Vite only, /api/* 会 404
npm run dev:vercel      # vercel dev (http://localhost:3000) — 同时跑 Vite + /api/* edge functions
npm run dev:mp-weixin   # 微信小程序 (需微信开发者工具)

# 5. 生产构建
npm run build:h5        # 产物在 app/dist/build/h5
npm run type-check      # 只做类型检查

# 6. 冒烟回归(手动门,非 CI)
npm run smoke           # 24 页 × 亮/暗 加载无 console 错误(webkit/iOS Safari 引擎)
```

**`dev:vercel` 用途**: 当你需要本地调试 `/api/translate`、`/api/moderate`、`/api/admin` 等
serverless 函数时使用 (Vite 不会 serve `api/*` 文件)。首次使用前需 `vercel login` + 项目链接
(本仓库已 link，`.vercel/` 已存在)。`dev:h5` 适合纯前端开发；`dev:vercel` 适合需要打 API 的场景。

### 冒烟回归 `npm run smoke`

大改动前后(尤其**接入新 UI 库时**)跑一遍当回归门:加载全部页面(亮+暗,webkit
= iOS Safari 引擎),断言无意外 console 错误。**不进 CI**(CI 保持 type-check + 双端
build 的精简矩阵);这是手动门。首次需 `npx playwright install webkit` 下引擎。

- 默认只跑**登出态全页巡检**(无凭据,安全)。
- 想验证**登录态写路径**(发布/广场/聊天):`SMOKE_EMAIL=<邮箱> SMOKE_PASSWORD=<密码> npm run smoke`
  ——凭据走环境变量,不入库。
- config 会自动清理 `*_PROXY` 环境变量(本机 Clash 等代理会拦截 localhost 让就绪探针挂起;
  仅影响 Node 探针,浏览器仍直连)。
- 用例在 [app/smoke/](app/smoke/),配置 [app/playwright.config.ts](app/playwright.config.ts)。

## 部署

- **H5**: 直接 `vercel --prod` (或 git push main 自动部署)。`vercel.json` 已配好 rewrites。
- **Supabase Auth Redirect URLs** 必须包含生产域名才能收到密码重置邮件:
  - Site URL: `https://caaci-community-marketplace-bazaar.vercel.app`
  - Redirect URLs: `https://caaci-community-marketplace-bazaar.vercel.app/**`

## 安全摘要

- ✅ 11 张表全部启用 RLS
- ✅ 所有 INSERT/UPDATE 策略带 `WITH CHECK (auth.uid() = user_id)` 防冒用
- ✅ Storage 限定 `items/<uid>/` 路径
- ✅ 012 migration 所有写入表加限流 + 去重触发器(items/posts/comments/messages/reports)
- ✅ 013 migration 补:notifications 禁止客户端直接写入 + 聊天标志位严格归属各参与方
- ✅ 换汇分类四处反杀猪盘警告
- ✅ PKCE 登录 + Supabase fetch 25s 超时(防 Safari 卡登录)

**一键排查日志**: 详见 `docs/audit/SECURITY_AUDIT.md`。

## 贡献约定

- 分支:`feature/<topic>` / `fix/<topic>` / `chore/<topic>`
- 提交信息:开头用 `feat:` / `fix:` / `chore:` / `docs:` / `perf:` / `refactor:`
- 新功能带 i18n key 双语文案(`useI18n.ts`)
- DB 变更走 migration,不要改现有文件;新编号顺延(013 → 014 → ...)
- PR 前跑 `npm run type-check`

## Roadmap

短期(2 周)+ 中期(1 月)+ 长期方向详见:
- `docs/audit/MASTER_REPORT.md` — 体检整合报告 + 新功能建议 Top 10
- `docs/ROADMAP.md` — 原始路线图

## License

Private · All rights reserved · 仅限 CAACI / UIUC 社区内部使用
