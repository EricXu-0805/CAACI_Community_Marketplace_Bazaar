# Session Handoff — 2026-04-19

## 这次 session 完成的工作

### 🐛 4 个 bug 已修
1. **首页滚动卡顿** — `.card-img-box` 改成固定 `aspect-ratio: 3/4`, `object-fit: contain` letterbox。不再 reflow,滚动丝滑。长截图会有灰底但不裁剪。(commit 86f2a66)
2. **图片显示模式** — 同上,`object-fit: contain` 保留原比例不裁剪不变形。
3. **Profile 页"取消预留"** — 在 listed tab 的 item 行加按钮,只在 status='reserved' 时显示。
4. **Safe-zone 3 态重设计** — 加 `items.location_verified` boolean(migration 020),只有 geolocation API 命中 safe zone 才 verified=true,手动选或打字一律 false。badge 逻辑全改。 **⚠️ 020 migration 需要手动跑 SQL Editor**。

### ✨ 3 个 feature 已上线
5. **用户状态(微信式)** — `profiles.status_text` + `status_emoji`(migration 021),profile/edit 页编辑,profile/seller 页展示。**⚠️ 021 migration 需要手动跑**。(commit f7eec2f)
6. **Plaza 帖子搜索** — 搜索栏 + fuzzy + 中英互转,复用 `expandSearch` 的同义词字典。(commit 70120e1)
8. **Plaza 分享 OG meta** — `/share-post/:id` edge function,微信/Twitter/Slack 粘贴自动卡片预览。(commit f7eec2f)

### ❌ 未完成 — 交下次 session

**Feat 7:表情包(L,200-400 LOC)**

**为什么没做**:相比其他 5-6 个 S/M 难度任务,这个涉及新建 Vue 组件 + 修改 chat input + 修改 message 渲染 + 可能涉及 storage 上传,单个任务能吃掉大半 context。强行做会半吊子。

**下次 session 建议拆解**:
- **v1(简单,90 分钟)**:内置 emoji 面板。建 `app/src/components/ChatEmojiPanel.vue`,12-16 个 grid 按钮,每个按钮内容是单 emoji(`😀🎓📚🍜👍💯` 之类)。点击 → 追加到 `chat/index.vue` 的输入框。`messages.content` 已是 text,原生支持 unicode emoji,不用改 DB。
- **v2(中等,2-3 小时)**:奶龙等 sticker PNG。建 `supabase/storage/stickers/` bucket + public read policy。准备 5-10 张 PNG 放进去。chat message 加 `message_type` 列或规定 content 以 `sticker://` prefix 识别。渲染 img tag。
- **v3(复杂,几天)**:DIY 用户自上传。审核队列、举报、版权声明。现在别做。

**参考文件**(下次 session 打开就能定位):
- `app/src/pages/chat/index.vue` — 输入栏在 template 底部,look for `msg-input` 或 `<textarea>`
- `app/src/composables/useMessages.ts` — sendMessage 函数
- `migrations/` 最新 021,下个 migration 应该是 `022_stickers.sql` 如果走 v2

---

## 当前项目状态(2026-04-19)

- **HEAD**: `70120e1` 推到 main,Vercel auto-deploy
- **Migrations**: 001-019 已在 DB 跑过 + **020/021 需要你手动跑**
- **Build**: 所有 commit 都 `npm run build:h5` 通过
- **线上**: https://caaci-community-marketplace-bazaar.vercel.app

### ⚠️ 立即要做的 2 件事

1. 去 Supabase dashboard SQL Editor 跑 `supabase/migrations/020_items_location_verified.sql`
2. 去同样地方跑 `supabase/migrations/021_profiles_status.sql`

**不跑会怎样**:
- 020 不跑 → 首页 / 关注 / 卖家页会报 `column items.location_verified does not exist` → 首页空白
- 021 不跑 → profile/edit 保存时 500 错,profile 页 status 读取失败(但不会 crash,只是显示空)

跑法(和之前 019 一样):dashboard → SQL Editor → 贴文件内容 → Run。

### 本次 session 的 commits(按时间)

```
70120e1 feat: plaza post search with fuzzy + zh/en synonym expansion
f7eec2f feat: user status line + plaza post share with OG meta card
86f2a66 fix: 4 bugs (scroll jank, image mode, profile unreserve, location geo-verification)
7fdff50 feat: unreserve button + safe-zone trust badge + seller stats spacing
cacd02a fix: 5 user-reported issues (images, scrollbar, z-index, favorite, multi-upload diagnostic)
```

## 下 session 开场白(复制)

```
华协 App (Illini Market)
- 本地: /Users/xiaogangxu/Projects/CAACI_Community_Marketplace_Bazaar
- 线上: https://caaci-community-marketplace-bazaar.vercel.app
- Supabase: lfhvgprfphyfvhidegum (migrations 001-021,020/021 需要手动跑)
- 技术栈: uni-app (Vue 3.4) + Vite + Supabase + Vercel H5

上个 session (2026-04-19) 完成:
- 4 bug(滚动 / 图片模式 / profile 取消预留 / safe-zone geo 验证)
- 3 feat(用户状态 / plaza 搜索 / plaza 分享 OG)
- 未做:表情包(L)见 docs/HANDOFF.md

优先事项:
1. 先确认 020/021 migration 跑了没
2. 接下来做表情包 v1(内置 emoji 面板)
```
