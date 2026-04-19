# 开发路线图 (ROADMAP)

> 最后更新：2026-04-19 (late v2 session)
> 状态：规划中

---

## 总体阶段规划

```
Phase 0          Phase 1           Phase 2           Phase 3
规划 & 设计   →   MVP 开发      →   试运行 & 迭代  →   正式上线 & 扩展
(当前)           小程序 + Web       内测 + 反馈       App + 商户体系
```

---

## Phase 0：规划 & 设计（当前）

### 产品规划
- [x] 核心功能模块确认（4 Tab 结构）
- [x] 会员体系框架设计
- [x] 商户合作体系初步规划
- [x] 多端部署策略确定
- [ ] 详细 UI/UX 设计稿
- [ ] 用户流程图 (User Flow)
- [ ] 数据库模型设计

### 技术选型
- [ ] 前端框架选型（考虑小程序 + Web 跨端）
- [ ] 后端技术栈确定
- [ ] 数据库选型
- [ ] 云服务 & 部署方案
- [ ] 第三方服务选型（推送、短信、对象存储等）

### 基础设施
- [ ] 域名注册
- [ ] 微信小程序账号申请
- [ ] 开发环境搭建
- [ ] CI/CD 流水线搭建

---

## Phase 1：MVP 开发

### 微信小程序 (P0)
- [ ] 项目初始化 & 基础架构
- [ ] 用户注册/登录（手机号 + 邮箱）
- [ ] Tab 1: 二手交易 — 发布 & 浏览 & 搜索
- [ ] Tab 2: 社区论坛 — 发帖 & 回复（官方区 + 用户区）
- [ ] Tab 3: 私信 — 基础聊天功能
- [ ] Tab 4: 个人中心 — 基础资料 & 发布管理
- [ ] 基础内容审核（关键词过滤）

### Web 网站 (P0)
- [ ] 响应式布局（手机端 ≈ 小程序，桌面端顶部导航）
- [ ] 与小程序共享后端 API
- [ ] 核心功能对齐小程序

### 后端服务
- [ ] 用户系统（注册、登录、鉴权）
- [ ] 商品 CRUD API
- [ ] 帖子 CRUD API
- [ ] 私信/即时通讯服务
- [ ] 图片上传 & 对象存储
- [ ] 搜索 & 筛选服务

---

## Phase 2：试运行 & 迭代

### 功能完善
- [ ] 会员卡系统（等级、认证、coupon）
- [ ] 华协账户关联
- [ ] 官方信息频道内容管理后台
- [ ] 本地新闻自动爬取 Agent
- [ ] 通知推送系统
- [ ] 搜索算法优化

### 安全加固
- [ ] CAPTCHA 人机验证
- [ ] 内容审核系统上线
- [ ] 网络安全套餐接入
- [ ] 用户数据加密 & 隔离

### 运营准备
- [ ] 用户反馈收集机制
- [ ] 数据埋点 & 分析
- [ ] 运营后台开发
- [ ] 免责声明 & 用户协议

---

## Phase 3：正式上线 & 扩展

### iOS App (P1)
- [ ] 原生 App 开发 / 混合方案
- [ ] Apple Store 申请 & 审核
- [ ] Apple Wallet 会员卡集成

### 商户体系
- [ ] 商户入驻流程
- [ ] 广告投放系统
- [ ] 商户管理后台
- [ ] 收费标准 & 合作协议

### 华协官网优化
- [ ] Server 重建
- [ ] Newsletter 功能
- [ ] 捐款模块优化
- [ ] 微信公众号内容同步
- [ ] 平台入口 Tab 添加

### 增长 & 变现
- [ ] 用户增长策略执行
- [ ] 商家精细化投流工具
- [ ] 活动合作系统
- [ ] 会员定价方案上线

---

## 里程碑时间线

| 里程碑 | 目标 | 预计时间 |
|--------|------|---------|
| M0: 规划完成 | 技术选型、设计稿、数据模型完成 | TBD |
| M1: MVP 上线 | 小程序 + Web 核心功能可用 | TBD |
| M2: 内测 | 小范围用户测试 | TBD |
| M3: 公测 | 华协社区内推广 | TBD |
| M4: 商户上线 | 商户合作体系启动 | TBD |
| M5: App 上架 | iOS App 上架 Apple Store | TBD |

---

## Backlog：2026-Q2 想法池（未排期）

> 来源：session 转录、用户反馈。排期前需要 PM 过滤 + 细化。每一项都不是小活，实现前要拆 ticket + 独立 branch。

### 表情包系统 (M)
- [ ] 内置表情包:聊天输入框旁加表情 icon,弹出面板
- [ ] 一两套 DIY 主题(奶龙之类的梗图)
- [ ] 用户自定义:允许上传自己的小表情,以某个人为主角
- **风险**:内容审核(谁都能上传梗图 → 可能涉版权/低俗),需审核流程
- **依赖**:chat 的 message 字段要支持 emoji/image 混合

### 帖子搜索 + 模糊匹配完善 (M)
- [ ] 帖子(Plaza posts)的搜索框 —— 目前只有商品能搜
- [ ] 商品搜索的模糊匹配:typo-tolerant(trigram index 已有,效果没达到预期)
- [ ] 中英互转搜索:搜 "book" 也能命中中文标题 "书籍",反之亦然
- [ ] 关联搜索:搜 "iphone" 带出 "apple / 苹果 / 手机 / phone"
- **依赖**:已有 migration 007(trigram),可能需要 008+ 加 synonyms 表

### 用户状态 (S)
- [ ] profile 加 "status" 字段(类似微信个性签名/状态)
- [ ] 头像旁显示 emoji + 短句 ("🎓 期末ing")
- [ ] 可空,可自行清除

### 分享深链 + 卡片预览 (L)
- [ ] 商品和帖子都生成短链(/share/:id)
- [ ] 微信里转发时展示卡片(og:image + 微信 SDK 的 wx.updateAppMessageShareData)
- [ ] B 站/微信风格:标题 + 缩略图 + 价格,不是裸链接
- **依赖**:需要 server-side render `og:` meta 或 H5 page meta;微信分享必须走 JS-SDK 签名
- **风险**:微信 JS-SDK 需要公众号 appId 和 secret,华协侧要配合

### 小 bug / 打磨
- [x] 2026-04-18 卖家主页 stats 间距(未售/已售/加入时间文字挤在一起)→ 已修
- [x] 2026-04-18 已预定状态不能取消 → 已加 "取消预定" 按钮
- [x] 2026-04-18 安全地点 verified badge → 已加(geo 验证 v1)
- [x] 2026-04-19 Safe-zone 3 态 → `location_verified` 字段,只认 geo 验证
- [x] 2026-04-19 首页滚动卡顿 → aspect-ratio 3:4 预留空间
- [x] 2026-04-19 Profile 页加取消预留入口
- [x] 2026-04-19 用户状态(WeChat 式)→ 已上线
- [x] 2026-04-19 Plaza 帖子分享卡片(OG meta)→ 已上线
- [x] 2026-04-19 Plaza 帖子搜索 + 中英互转 → 已上线
- [x] 2026-04-19 (late) 表情包 v1 内置 emoji 面板 → 已上线(6 分类 ~200 emoji + Recent)
- [x] 2026-04-19 (late) Schema fallback 硬化:migration 未跑时降级而非 500
- [x] 2026-04-19 (late) Chat retrySend 未定义 bug / Plaza 举报缺 reason 崩溃 → 修
- [x] 2026-04-19 (late) SEARCH_SYNONYMS 140 → 330 对(含品牌/外设/电器/母婴/UIUC)
- [x] 2026-04-19 (late) useI18n.t() 支持 {param} 插值
- [x] 2026-04-19 (late) 项目 TypeScript 错误 18 → 0
- [x] 2026-04-19 (late) migration 021 补 GRANT (status_text/emoji 之前对 anon 隐藏)
- [x] 2026-04-19 (late v2) 首页 xhs 风瀑布流 (naturalWidth 驱动 aspect-ratio)
- [x] 2026-04-19 (late v2) Plaza 单图帖 widthFix,多图 grid 按数量分类
- [x] 2026-04-19 (late v2) 商品详情页显示卖家 status chip
- [x] 2026-04-19 (late v2) 长按商品 / 长按帖子 → 举报菜单 + migration 022
- [x] 2026-04-19 (late v2) Emoji tap-to-send WeChat 式,按钮透明度占位
- [x] 2026-04-19 (late v2) friendlyErrorMessage 兜底 23514/42703
- [x] 2026-04-19 (late v2) Vercel Canceled 事故 fix (关 Require Verified Commits toggle)

### 下一 session 候选
- [ ] **表情包 v2 — sticker PNG**(奶龙等梗图)
  - 建 `supabase/storage/stickers/` bucket + public read policy
  - 准备 5-10 张 PNG 放进去(版权预先审核)
  - `messages.message_type` 增 `'sticker'` 枚举值,或约定 `content = "sticker://<key>"`
  - chat 渲染 img tag,面板追加 "贴纸" 分类
- [ ] **表情包 v3 — 用户 DIY 自上传**(需举报/版权审核流先定好再做)
- [ ] OG meta → 微信 JS-SDK 卡片(需要华协公众号 appId/secret)
- [ ] 拆分大文件 `pages/index` (1110 LOC) / `pages/plaza` (998) / `pages/detail` (878) → 独立 PR
- [ ] 集成 CI(GitHub Actions 跑 `type-check` + `build:h5`)防回归

### 技术债 / 后续优化
- [ ] 大文件拆分:home / plaza / chat / detail 各 ~4000 LOC,需拆 components
- [ ] TypeScript 4.9 → 5.x 升级(独立 PR)
- [ ] @dcloudio/core 4080 → 5000 升级(alpha,需回归)
- [ ] vue 3.4 → 3.5(之前 markRaw 有 edge case,再等等)
