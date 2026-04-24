# Master Plan — CAACI Marketplace 下一阶段

**时间点:** 部署 `dcccf4b` 已上线 production (https://caaci-community-marketplace-bazaar.vercel.app)

本文件是对用户全部未完成需求的整合与排期。共 **14 个主题**，按"本 session 可做 / 需要你决策 / 需开新 session"三类分组。

---

## 一、结构化需求清单（你原话 → 归类）

| # | 你的原话 | 归入主题 |
|---|---|---|
| 1 | 图片显示还是有问题，试试等比例 | 图片呈现 |
| 2 | 看一下如何部署微信小程序 | 微信小程序 |
| 3 | 整体 UI 可以再美化一下，扁平化做得更好一点 | UI polish |
| 4 | 做自己回复自己的功能 | 广场自回复 |
| 5 | 收藏、编辑和标记预留不在一条水平线上 | 对齐 bug |
| 6 | 渐变还是没有完全 cover 到手机最右边 | tab 渐变 |
| 7 | 根据爱心数量排名商品顺序 / 更好的算法 | 排序算法 |
| 8 | 广场发布通道除了笔的标识还要做文字提示 | 广场发帖入口 |
| 9 | 商品标题语言跟随系统语言切换 | i18n 用户内容 |
| 10 | 新用户注册必须看协议、同意才可用 + 进来指引基础 set up | onboarding |
| 11 | 保证上线数据库不会崩掉；提示词安全 / 屏蔽话 / 攻击性输入 / 钓鱼链接 / 二维码引流 / 辱骂违法词 | 安全整体 |
| 12 | 一秒 100 条"发布商品"直接塞满 DB；大量假账号；刷赞；刷举报 | 抗攻击 |
| 13 | 研究小红书闲鱼安全逻辑，自动化为主人力为辅，关键词中英覆盖 | 审核架构 |
| 14 | 写强度测试脚本模拟攻击 | 压测 |
| 15 | 用户协议写清楚封禁措施、递增封禁时长、解封后限制 | ToS 重写 |
| 16 | 广场顶部新增可滚动轮播广告区 | Banner 轮播 |

---

## 二、Agent 研究成果概览（已存盘）

本次启动了 5 个并行研究 agent，产出保存在以下文件：

- `INVENTORY_REPORT.md` (873 行) — i18n / onboarding / 对齐 / 自回复 / 发帖入口 / 排序算法
- `SECURITY_AUDIT.md` (40KB) + `SECURITY_AUDIT_INDEX.md` + `SECURITY_SUMMARY.txt` — 现有安全机制与漏洞
- `/tmp/investigation_report.md` + `/tmp/CODE_PATCHES.md` + `/tmp/FINDINGS_SUMMARY.md` + `/tmp/gradient_visual.txt` — mp-weixin / 部署 / 渐变
- (库研究 topic 1-3) — Supabase 限流 / 内容审核 API / uniapp 轮播
- (小红书闲鱼研究) — Hi-Guard / GAS / UMID / 封禁阶梯 / 最小安全栈

你不必读全部，下面的计划已抽取关键点。

---

## 三、本 session 可立即做（低风险，无需你决策）

### P0-A. 修复渐变没覆盖到右边（真机仍有 16px 空白）

**根因**（agent 确认）: `.mobile-header` 有 `padding: 10px 16px 11px`，`.mc-wrap` 被卡在父 padding 内，`right: 0` 是相对于 padding 后的父节点，所以到不了物理边。

**改动**（3 行）:
```scss
.mc-wrap { margin-right: -16px; }  // 穿透父 padding
.mc-fade { right: -16px; width: 88px; }  // 延伸到真正的右边
```

### P0-B. 图片"等比例"呈现

**现状**: 卡片里 `card-img` 已经是 `width: 100%; height: auto` + `thumbUrl` 去掉了 `resize=cover`，CDN 会按原比例缩放。如果真机上仍有裁切，应该是浏览器缓存了旧版 URL。

**诊断 + 兜底**: 加一次性 URL 参数打破缓存，并为老图片对象 fallback 一次原始图（不走 CDN 变换）；再看一次真机表现。

### P0-C. 广场 compose 按钮加文字

"笔"图标旁边加"发帖"/「Post」label。需在 plaza/index.vue `.compose-btn` 内加 `<text>`，并加 aria-label。

### P0-D. 开放自回复

plaza/index.vue:540 和 post/index.vue:228 各删 1 行 `if (c.user_id === currentUser.value.id) return`。DB 层没约束，直接放开就行。

### P0-E. 收藏/编辑/标记对齐

根据 agent 结论，plaza 帖子下方的 like/comment/share 三按钮本身是对齐的。你说的"收藏/编辑/标记"应该是指 profile 页"我发布的"卡片里的那一排按钮——需我再精确看一下，也可能是 message swipe 里的 pin/read/delete（已在上一版本统一）。**待你指认具体是哪个页面**（见第五节"需要你决策"）。

### P0-F. 排序算法：加"Trending" = 时间衰减 × 参与度

现在只有 `latest / price_asc / price_desc / popular(view_count)`。新增 "Trending"：

```
score = (favorite_count*3 + comment_count*2 + view_count*0.5)
      / POWER( EXTRACT(EPOCH FROM (now() - created_at))/3600 + 2, 1.5)
```

在 supabase 里加 SQL 视图 + 在 `useItems.fetchItems` 的 sort option 加 `'trending'`。

这五项可以一次 commit 出来。

---

## 四、本 session 推荐分两次 commit 完成

### Commit 1（P0 一揽子，不触碰 DB）
- 渐变修复
- 广场"发帖"文字 label
- 自回复开放
- 图片 URL cache-buster（如真机确认还有裁切）

### Commit 2（trending 排序）
- 新 migration: `supabase/migrations/023_trending_score.sql`（SQL view/function）
- 前端加选项

---

## 五、需要你决策的问题（请选）

我列成一组选项题，你一次性回我答案我就继续做。

1. **微信小程序要现在开始适配吗？**
   - A. 立即适配（需把 supabase-js → uni.request 适配层，大改动约 1-2 天）
   - B. 先不做，等 H5 稳定 3 个月再说（推荐）
   - C. 做一个只读版（看帖不能发帖）先练手

2. **banner 轮播方案**（你的第二段任务）
   - A. 5:2 宽高比，3-8 张，5 秒自动轮播，圆角 12px，左右贴齐页面内 16px（默认推荐）
   - B. 3:1 宽高比（更扁更像公告）
   - C. 1:1 正方形（更像小红书首页卡片）
   - 数据源初期用 mock，后期接哪张表？建议新建 `banners` 表（id/image_url/target_url/priority/start_at/end_at），你同意吗？

3. **i18n 商品标题跨语言切换**
   - A. 接 DeepL 免费版 API（50 万字符/月免费），后端代理翻译并缓存（推荐）
   - B. 接 Google Translate v3（有免费额度但要信用卡）
   - C. 用 OpenAI gpt-4o-mini 做翻译（贵但翻得好）
   - D. 暂时不做，只翻译字典里的词

4. **"自动审核"的程度**
   - A. 最小：中文敏感词列表 + 二维码检测 + 联系方式 regex（本 session 就能做）
   - B. 中等：加 OpenAI omni-moderation 免费 API + Aliyun 内容安全 ($30/月)
   - C. 完整：加设备指纹 + SimHash 近似重复 + 信任分 + Shadowban（需 2-3 天）

5. **封禁阶梯**（ToS 写法）
   - A. 标准阶梯：警告 → 3 天 → 7 天 → 30 天 → 永封（推荐）
   - B. 阿里系激进：警告 → 24h → 72h → 永封
   - C. 小红书式："限流"（shadowban）作为第 0 级，用户看不见被限流

6. **onboarding 强制流程**
   - A. 注册页加"我已阅读并同意《用户协议》《隐私政策》"checkbox（必勾）+ 首次登录弹一个 3 步引导（昵称 / 头像 / 校区）（推荐）
   - B. 只加 checkbox，不加引导
   - C. 加 checkbox + 引导 + 手机号验证（会筛掉一部分真用户）

7. **压测脚本要在哪跑？**
   - A. 本地 k6（免费，模拟真实负载）
   - B. Vercel 本身就有监控，不需要额外压测
   - C. Supabase Dashboard 已有 slow query 监控 + 加一个 k6 脚本双保险（推荐）

8. **UI 美化扁平化**这块你想优先哪一块？
   - A. 首页瀑布流卡片（阴影、间距、圆角、badge 配色）
   - B. 商品详情页（信息层级、按钮形态）
   - C. 广场信息流（头像边框、互动按钮、间距）
   - D. 全部（需开新 session，工作量大）

---

## 六、建议开新 session 做的大块任务

以下每项工作量都 ≥ 半天，建议每项单独开一个 session 以便专注调试：

1. **微信小程序适配**（如你选 1-A 或 1-C）
   - 替换 supabase client 为 uni.request 封装
   - 处理所有 `window / navigator / document` 引用
   - 申请 AppID 填入 manifest.json
   - 配置服务器域名白名单（supabase + vercel）

2. **Banner 轮播**（你第二段详细任务）
   - 你已经给了完整规格，我按那个做就行，但要独立 session 因为涉及新建组件 + mock 数据 + 可能接入新表

3. **完整安全体系**（对应你选 4-C）
   - Rate limit 迁移 + 关键词库 + OpenAI moderation hook + 二维码扫描 + 信任分 + shadowban + 审核后台

4. **用户协议 / 隐私政策重写**（对应 5、6 选项）
   - 我可以先出中英双语初稿，参考小红书闲鱼写法 + 递增封禁 + 解封后限制
   - 你审阅一版后我再 finalize 进 pages/legal

5. **UI 扁平化大整改**（对应 8-D）
   - 全站设计 token 统一（色板、间距、圆角）
   - 组件库收敛（按钮、卡片、badge）
   - 需要先跑 `/design-review` 和 `/plan-design-review` 做一次系统性梳理

---

## 七、小结：你现在只要回我三件事

1. **第五节 1-8 的选择**（A/B/C 列表）
2. **第 0-E（收藏/编辑/标记对齐）你说的是哪个页面截图或位置**？（profile "我发布的"？messages？还是别的）
3. **第六节 1-5 哪些想在本次对话继续做、哪些开新 session**

收到你的回复我就按顺序推进。
