# Illini Market — 全面体检主报告

> 整合 5 份并行 agent 审计(codebase health / security / performance / a11y+i18n / 竞品)
> 生成时间:本次 session
> 项目规模: 18 pages · 6,836 LOC · 13 composables · 12 migrations

详细文件见同目录:
- `SECURITY_AUDIT.md` + `CRITICAL_FIXES.md` — 安全深审(925 行)
- `ACCESSIBILITY_I18N_UX_AUDIT.md` — a11y/i18n/UX(478 行)
- `AUDIT_SUMMARY.txt` — 执行摘要速查
- `AUDIT_INDEX.md` / `SECURITY_AUDIT_INDEX.md` — 导航
- (perf + codebase-health 结果已整合进本主报告)

---

## 📊 一句话结论

**代码健康度 7/10、安全 6/10、性能优化空间 60-70%、UI一致性 7/10。**
没有灾难级问题,有 **1 个必修的 RLS 漏洞** 和 **一批 30 分钟就能搞定的性能/a11y 快赢**。

---

## 🚨 P0 — 立刻修(本周内)

### 1. `notifications` 表缺 INSERT 策略 ⚠️ CRIT
- **文件**: `supabase/migrations/005_notifications_and_price_drop.sql:19-34`
- **风险**: 任何登录用户可以给**任何别人**伪造通知(钓鱼 / 冒充官方推送)
- **修**: 新加 migration `013_fix_notifications_insert.sql`
  ```sql
  DROP POLICY IF EXISTS "Block direct notification inserts" ON public.notifications;
  CREATE POLICY "Block direct notification inserts"
    ON public.notifications FOR INSERT
    WITH CHECK (false);  -- 只允许 SECURITY DEFINER 函数写入
  ```
- **耗时**: 5 分钟

### 2. `conversations` 标志位越权
- **文件**: `supabase/migrations/010_plaza_and_uid_and_chat_flags.sql:103-113`
- **风险**: buyer 可以把 seller 的 `is_muted_seller` 翻成 true(反之亦然)
- **修**: 拆成两条 UPDATE 策略,`WITH CHECK` 严格匹配 `auth.uid() = buyer_id` 时只允许改 `_buyer` 列
- **耗时**: 10 分钟

### 3. 去重字符串未归一化
- **文件**: `supabase/migrations/012_rate_limiting_and_dedupe.sql:79-87`
- **攻击**: "iPhone 13" → "IPHONE 13" → "iPhone 13 "(尾空格) 全部绕过 60s dedupe
- **修**: 比较时 `LOWER(TRIM(title || ' ' || description))` 再 hash
- **耗时**: 10 分钟

### 4. 硬编码中文错误未走 i18n
- **文件**: `app/src/App.vue:36`("No network connection" 写死英文)
- **文件**: `app/src/composables/usePlaza.ts`, `useMessages.ts` 各处 "Failed to load..."
- **影响**: 切到中文后仍然蹦英文
- **修**: 抽 `error.noNetwork`/`error.loadFailed`/`error.saveFailed` 统一 key
- **耗时**: 30 分钟

### 5. 图片 lazy-loading 缺失 → 首屏慢 1-2s
- **文件**: 全部 `<image>` 列表用法 — `pages/index/index.vue` / `plaza/index.vue` / `detail/index.vue`
- **修**: 给所有列表里非首屏图加 `lazy-load="true"`(uni-app H5 支持),首屏前 2 张不加
- **增益**: LCP -1~2s, 省 5-10MB 带宽
- **耗时**: 5 分钟

### 6. Supabase `select('*')` 过度拉取
- **文件**: `useItems.ts`, `useMessages.ts`, `usePlaza.ts` 多处
- **修**: 列表查询显式 `select('id,title,price,image_urls[0],user_id,created_at,status')`,详情页再单独查全字段
- **增益**: 100-200ms RTT + 20-30% JSON 体积
- **耗时**: 15 分钟

**P0 合计: 75 分钟,收益巨大。**

---

## 🟠 P1 — 下轮 Sprint(2 周内)

### 安全(续)
7. **Storage MIME 只靠客户端校验** — 加 Edge Function 做 magic bytes 校验
8. **profiles.bio 允许放手机号/微信** — 加正则检测 + 警告 modal
9. **限流 window 边界** — 60s sliding 要加 1s buffer(agent 在 012 migration 里发现)

### 性能(TOP 10 快赢还剩 7 条)
10. **首屏并行加载** — `pages/index/index.vue` 把 `fetchItems / fetchBanners / fetchUser` 改 `Promise.all` → 省 300-500ms
11. **count 改 `estimated`** — 列表翻页用估值 count 不要精确 count → 省 80-150ms/页
12. **首屏 SVG 改 data-uri 或 inline** — heart / placeholder / default-avatar 被加载 100+ 次,改 inline SVG 组件省 HTTP
13. **keepAlive tab 页** — home/plaza/messages/profile 切换不重 mount → 秒切
14. **Vite manualChunks** — 把 `@supabase/supabase-js` + `vue` 拆单 chunk,利用浏览器缓存
15. **图片 transform 参数** — Supabase Storage URL 加 `?width=400&quality=75` 给缩略图用 → 省 70-80% 带宽
16. **虚拟滚动** — 商品列表 > 50 项时切 virtual scroll

### a11y / i18n
17. **24 张图片缺 alt** — 列表卡、头像、消息图 — 过 WCAG A 的门槛
18. **4 处对比度不足** — `#999 / #ccc / #bbb / #8e8e93` 在白底上 < 4.5:1
19. **触控热区 <44px** — 关闭按钮、心形按钮 — iOS HIG 硬要求
20. **登录表单** — email input 用了 `type="text"`(手机键盘没 @);密码缺 `autocomplete`
21. **时间字符串 "5m ago" 硬写英文** — 走 i18n 的 relativeTime 格式化

### 代码质量
22. **4 个大文件 >500 LOC 拆分候选**:
    - `pages/index/index.vue` 1026 行 → 拆 `HomeHero` / `CategoryRow` / `ItemGrid`
    - `pages/plaza/index.vue` 756 行 → 拆 `PlazaComposer` / `PostCard`
    - `pages/chat/index.vue` 706 行 → 拆 `MessageList` / `ChatInput` / `QuickReplies`
    - `pages/detail/index.vue` 711 行 → 拆 `ImageCarousel` / `SellerCard` / `ItemMeta`
23. **20+ `as any`** — 大多是 Supabase 查询结果,接 `Database` types 生成后能全部去掉
24. **162 个 await / 80 个 try** — 约一半 await 没 catch,走 `friendlyErrorMessage` 包一层
25. **11 个 `console.log` 留在 src/** — prod 构建时剥离(`vite define` + `drop_console`)

**P1 合计: 1-2 天工作量,做完整体水平上一个台阶。**

---

## 🟢 P2 — 长期改进(1 个月+)

26. **dark mode** — 目前完全没有,加 CSS variable + `prefers-color-scheme`
27. **虚拟列表 + infinite scroll 统一封装** — 替掉各页重复的翻页逻辑
28. **Supabase 类型生成** — `supabase gen types typescript` 接进 CI
29. **拆 composable** — useItems 已经 400+ 行,按 list/detail/mutate 再拆
30. **e2e 测试** — 目前 0 测试,至少加 Playwright 覆盖 login→发布→消息 主流程

---

## 🎯 新功能建议 — 竞品研究 Top 10

按"campus 契合度 × 实现成本"排序(竞品 agent 详细理由见 `AUDIT_INDEX.md` 所指竞品报告):

| # | 功能 | 来源 | 价值 | 成本 | 理由 |
|---|---|---|---|---|---|
| 1 | **双向评分系统**(买卖家互评) | Mercari/Depop/OLX | ★★★★★ | S | 当前**最大的信任缺口**,一个 5 星 + 一句话点评就能立一道门槛 |
| 2 | **"想要" 按钮 + 降价推送** | 闲鱼 | ★★★★★ | S | 给当前的心形收藏加一档,收藏者在降价时被精准推 → 转化飞起 |
| 3 | **Saved Search + 关键词提醒** | FB Marketplace | ★★★★★ | S | "有人发了 ECON 101 教材时喊我" — 学生刚需,持久留存钩 |
| 4 | **标准化成色等级**(全新/近新/良好/一般/瑕疵) | 闲鱼 + Mercari | ★★★★★ | S | 替掉自由文本 condition,减少 dispute,卡片一眼可扫 |
| 5 | **发布/取货地点 picker**(Grainger / PAR / Union...) | FB + CampusLoop | ★★★★★ | S | 消除"在哪见面?"的 10 轮拉扯,直接点校园地标 |
| 6 | **"给收藏者发私享降价"** | Mercari | ★★★★★ | S | 卖家一键对所有收藏过的用户发 24h 限时折扣 → Mercari 最高转化工具 |
| 7 | **Plaza 帖子内嵌商品卡** | 小红书 | ★★★★★ | S | 发帖时 @ 一个自己挂的商品,让社区 → 交易的链路闭合 |
| 8 | **学期周期 banner**(开学/期末/毕业季) | 闲鱼学生鱼 | ★★★★★ | S | 5月自动切 "Move-Out Sale" 主题、9月切 "新生必备"、时效性拉满 |
| 9 | **关注卖家 + 新发布推送** | Depop | ★★★★★ | S | 把"某位学长在清仓"做成订阅关系 → 二次转化 |
| 10 | **出价/还价结构化 flow** | Mercari + 闲鱼 | ★★★★★ | M | 砍价是华人刚需,现在全在聊天里瞎聊,结构化能减少 ghost |

**推荐 Sprint 打包方案 —— "Trust & Discovery 更新"**:
1、3、4、5、7、8、9 七个 S-level 功能一起发版,一周左右工期,合起来就是对标闲鱼学生鱼 + Mercari 的信任层的完整答卷。

### 不建议抄的反模式
- ❌ **Depop 的颜值门槛** — 学生卖旧书不需要打光,别让算法奖励摆拍
- ❌ **OLX 的付费置顶** — 小圈子付费置顶直接杀掉"邻里感",宁可不挣这个钱
- ❌ **Mercari Smart Pricing 自动降价** — 训练买家躺平等底价,改用"发收藏者私享价"替代
- ❌ **小红书严打带货** — 我们本来就是社区 + 交易,Plaza 帖子挂商品卡应该奖励而非限制

---

## 📝 文档 / README 状态

**现 README 严重过时**(41 行,还在说"初期不做交易"、提 P0 微信小程序)。
现实:
- ✅ H5 已上线 Vercel
- ✅ 有完整 chat / favorites / reports / blocks / notifications / plaza
- ✅ 不是"信息发布平台",是完整 marketplace + community
- ✅ Tab bar 已经 5 项,UID、防杀猪盘、限流都上了

**建议新 README 结构**(待你点头后我写):
1. 项目定位(更新成当前事实)
2. 架构图(Vue3 + Vite + Supabase + Vercel)
3. 本地起步(`npm i && npm run dev:h5`)
4. 目录结构(pages / composables / migrations / docs)
5. 迁移清单(001-012 逐条功能说明)
6. 部署 & 环境变量
7. 贡献指南 / 代码规范
8. Roadmap(引用新 features 列表)

---

## ✅ 体检结论与下一步建议

**当前代码状态**: 生产可用 ⭐⭐⭐⭐ (4/5)。不是脆的那种。

**推荐下一步顺序**(每步做完可 ship):

| 批次 | 内容 | 工时 | 收益 |
|---|---|---|---|
| **Batch A** | P0 6 条 — 安全 3 + 性能 2 + i18n 1 | 75 min | 堵漏 + LCP -1~2s |
| **Batch B** | README + migrations 013 安全补丁 | 30 min | 上下文正确 + 堵漏落地 |
| **Batch C** | P1 性能 7 条 + a11y 5 条 | 4-6 hr | Lighthouse +20-30 |
| **Batch D** | "Trust & Discovery" 7 功能打包 | 1 周 | 对标闲鱼学生鱼 |
| **Batch E** | P1 剩余 + P2 长期 | 2-4 周 | 工程化跨越 |

**我的建议**: 先干 A+B(<2 小时能搞定),锁住基线;然后你指哪我打哪 — D 批次是最出产品感的,C 批次最出工程质量感,随你排。
