# 技术架构文档

> 最后更新：2025-04-13
> 状态：MVP 阶段

---

## 技术栈总览

```
┌─────────────────────────────────────────────────────────┐
│                      客户端                              │
│  ┌─────────────────┐  ┌─────────────────┐               │
│  │  微信小程序       │  │  H5 Web 网页     │               │
│  │  (WeChat Mini)   │  │  (Mobile + PC)   │               │
│  └────────┬─────────┘  └────────┬─────────┘               │
│           │     uni-app (Vue 3 + TypeScript)              │
│           │         一套代码，多端编译                      │
│           └──────────────┬───────────────┘                │
└──────────────────────────┼───────────────────────────────┘
                           │ REST API / Realtime WebSocket
┌──────────────────────────┼───────────────────────────────┐
│                    Supabase (BaaS)                        │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────────┐ │
│  │   Auth   │ │ Database │ │ Storage  │ │  Realtime    │ │
│  │ 用户认证  │ │PostgreSQL│ │ 图片存储  │ │  实时消息    │ │
│  └──────────┘ └──────────┘ └──────────┘ └─────────────┘ │
│  ┌──────────────────────────────────────────────────────┐ │
│  │              Edge Functions (Deno)                   │ │
│  │           微信登录桥接 / 自定义业务逻辑                 │ │
│  └──────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

---

## 选型理由

### 前端：uni-app + Vue 3 + TypeScript + Vite

| 考量 | 说明 |
|------|------|
| 跨端需求 | 一套代码 → 微信小程序 + H5 网页（手机 + PC） |
| 学习成本 | Vue 3 比 React 上手更快，Composition API 灵活 |
| 生态 | 中文文档和社区最丰富的跨端方案，小程序适配最成熟 |
| 后续扩展 | 未来可以直接编译出 iOS/Android App |
| 替代方案 | Taro (React) — 适合 React 团队，但小程序适配不如 uni-app 成熟 |

### 后端：Supabase

| 考量 | 说明 |
|------|------|
| 开发效率 | 2 人团队无需自建后端，Auth/DB/Storage/Realtime 开箱即用 |
| 数据库 | PostgreSQL — 成熟的关系型数据库，支持复杂查询和全文搜索 |
| 认证 | 内置 email/phone 注册登录，微信登录通过 Edge Functions 桥接 |
| 文件存储 | 内置对象存储，直接存商品图片 |
| 实时通信 | 内置 Realtime，天然支持站内私信功能 |
| 安全 | Row Level Security (RLS) — 数据库层面的权限控制 |
| 扩展性 | PostgreSQL 可承载百万级数据，后续迁移成本低 |
| 成本 | 免费套餐：500MB 数据库 + 1GB 存储 + 50K MAU，MVP 绰绰有余 |
| 自定义逻辑 | Edge Functions (Deno/TypeScript) 处理微信登录等特殊需求 |

---

## 数据库设计

### 核心表结构

```sql
-- 用户表
users
├── id (uuid, PK)
├── phone (text, unique, nullable)
├── email (text, unique, nullable)
├── wechat_openid (text, unique, nullable)
├── nickname (text)
├── avatar_url (text)
├── bio (text)
├── location (text)           -- 如 "UIUC", "Champaign"
├── created_at (timestamptz)
└── updated_at (timestamptz)

-- 商品表
items
├── id (uuid, PK)
├── user_id (uuid, FK → users)
├── title (text)
├── description (text)
├── price (decimal)
├── category (text)           -- furniture, electronics, clothing, books, housing, other
├── condition (text)          -- new, like_new, good, fair
├── status (text)             -- active, sold, reserved, deleted
├── location (text)
├── images (text[])           -- 图片 URL 数组
├── contact_preference (text) -- in_app, wechat, phone
├── view_count (int, default 0)
├── created_at (timestamptz)
└── updated_at (timestamptz)

-- 会话表
conversations
├── id (uuid, PK)
├── item_id (uuid, FK → items, nullable)
├── buyer_id (uuid, FK → users)
├── seller_id (uuid, FK → users)
├── last_message_at (timestamptz)
├── created_at (timestamptz)
└── updated_at (timestamptz)

-- 消息表
messages
├── id (uuid, PK)
├── conversation_id (uuid, FK → conversations)
├── sender_id (uuid, FK → users)
├── content (text)
├── message_type (text)       -- text, image
├── is_read (boolean, default false)
├── created_at (timestamptz)
└── updated_at (timestamptz)

-- 收藏表
favorites
├── id (uuid, PK)
├── user_id (uuid, FK → users)
├── item_id (uuid, FK → items)
└── created_at (timestamptz)
```

### 索引

```sql
-- 搜索优化
items(category, status)       -- 分类筛选
items(user_id, status)        -- 用户的商品列表
items(created_at DESC)        -- 时间排序
items USING GIN (to_tsvector) -- 全文搜索

-- 消息优化
messages(conversation_id, created_at)
conversations(buyer_id)
conversations(seller_id)
```

---

## 项目结构

```
CAACI_Community_Marketplace_Bazaar/
├── README.md
├── .gitignore
├── docs/                           # 规划文档
│   ├── PRD.md
│   ├── ROADMAP.md
│   ├── ARCHITECTURE.md
│   └── TRANSCRIPT.md
├── app/                            # uni-app 前端
│   ├── src/
│   │   ├── pages/                  # 页面
│   │   │   ├── index/              # 首页 - 瀑布流浏览
│   │   │   ├── publish/            # 发布商品
│   │   │   ├── detail/             # 商品详情
│   │   │   ├── messages/           # 消息列表
│   │   │   ├── chat/               # 聊天详情
│   │   │   ├── profile/            # 个人中心
│   │   │   └── login/              # 登录注册
│   │   ├── components/             # 通用组件
│   │   │   ├── ItemCard.vue        # 商品卡片
│   │   │   ├── SearchBar.vue       # 搜索栏
│   │   │   ├── CategoryFilter.vue  # 分类筛选
│   │   │   ├── ImageUploader.vue   # 图片上传
│   │   │   └── TabBar.vue          # 底部导航
│   │   ├── composables/            # 组合式函数
│   │   │   ├── useAuth.ts          # 认证逻辑
│   │   │   ├── useItems.ts         # 商品 CRUD
│   │   │   ├── useMessages.ts      # 消息逻辑
│   │   │   └── useSupabase.ts      # Supabase 客户端
│   │   ├── stores/                 # Pinia 状态管理
│   │   │   ├── user.ts
│   │   │   └── app.ts
│   │   ├── types/                  # TypeScript 类型定义
│   │   │   └── index.ts
│   │   ├── utils/                  # 工具函数
│   │   ├── static/                 # 静态资源
│   │   ├── App.vue
│   │   ├── main.ts
│   │   ├── pages.json              # 路由 & 页面配置
│   │   ├── manifest.json           # 应用配置
│   │   └── uni.scss                # 全局样式
│   ├── package.json
│   ├── vite.config.ts
│   └── tsconfig.json
└── supabase/                       # 后端配置
    └── migrations/
        └── 001_initial_schema.sql
```

---

## MVP 页面结构

### 底部 Tab 导航 (3+1)

```
┌──────────────────────────────────┐
│            内容区域               │
├──────────┬────┬──────┬───────────┤
│  🏷 首页  │ ➕ │ 💬消息 │  👤 我的  │
│  (浏览)   │发布│ (私信) │  (个人)   │
└──────────┴────┴──────┴───────────┘
```

- **首页**：瀑布流商品浏览 + 搜索栏 + 分类筛选
- **发布** (中心凸起按钮)：发布二手商品
- **消息**：会话列表，点进去是聊天
- **我的**：个人信息 + 我发布的商品

### 页面流转

```
首页 ──点击商品──→ 商品详情 ──联系卖家──→ 聊天
  │                  │
  ├──搜索/筛选──→ 筛选结果
  │
发布 ──提交──→ 发布成功 ──→ 首页
  │
消息列表 ──点击──→ 聊天详情
  │
我的 ──我的发布──→ 商品管理（编辑/下架/删除）
  │── 编辑资料
  └── 登录/注册（未登录时）
```

---

## 安全设计

### 数据隔离原则

1. **用户数据**存储在 Supabase PostgreSQL，通过 RLS 控制访问
2. **AI 开发工具**（OpenClaw / OpenCode）只操作代码仓库，**不可直接访问生产数据库**
3. Supabase 生产环境的密钥不存入代码仓库

### Trust & safety (Security C stack)

Documented separately — see:

- [`docs/admin/IMPLEMENTATION_GUIDE.md`](./admin/IMPLEMENTATION_GUIDE.md) — admin dashboard architecture, RPC surface, edge routes
- [`docs/admin/RUNBOOK.md`](./admin/RUNBOOK.md) — daily operator workflow, ban-ladder decision tree, troubleshooting
- [`docs/WECHAT_MP_SETUP.md`](./WECHAT_MP_SETUP.md) §3 — realtime polling / long-poll fallback for mp-weixin
- Migrations 027, 028 — trust score + suspensions + device fingerprints + enforce-actor trigger
- Migrations 029–031 — admin RPCs + audit log

Key invariants:
- Admin trust boundary is OUTSIDE the user auth system (shared-secret
  `ADMIN_API_KEY` + service_role), so a stolen Supabase user session
  can't reach admin routes.
- Every admin action writes to `public.admin_audit_log` (append-only,
  RLS-gated, service_role-only SELECT). Audit failures never block
  the parent action.
- `trg_enforce_actor` blocks posts / items / comments / messages at
  INSERT time for any user with `suspension_level >= 2`. Dual-logged
  to the audit table AND Supabase's server logs via `RAISE LOG`.

### Row Level Security (RLS) 策略

```sql
-- 用户只能修改自己的信息
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view all profiles" ON users FOR SELECT USING (true);
CREATE POLICY "Users can update own profile" ON users FOR UPDATE USING (auth.uid() = id);

-- 商品：所有人可浏览，只有发布者可修改
ALTER TABLE items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view active items" ON items FOR SELECT USING (status = 'active');
CREATE POLICY "Users can manage own items" ON items FOR ALL USING (auth.uid() = user_id);

-- 消息：只有参与者可查看
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Participants can view messages" ON messages FOR SELECT
  USING (sender_id = auth.uid() OR conversation_id IN (
    SELECT id FROM conversations WHERE buyer_id = auth.uid() OR seller_id = auth.uid()
  ));
```

---

## 部署方案

| 组件 | 服务 | 说明 |
|------|------|------|
| 数据库 + API + Auth + 存储 | Supabase Cloud | 免费套餐起步 |
| H5 网页托管 | Vercel / Netlify | 免费，自动部署 |
| 微信小程序 | 微信公众平台 | 需申请小程序账号 |
| 域名 | TBD | 需要备案（如果用 .cn） |

---

## 目标区域

- **核心区域**：UIUC / Champaign-Urbana
- **扩展区域**：Chicago / Illinois
- 后续根据用户增长逐步扩展
