# Performance Audit Round 2 — Quick Start Guide

## 🎯 Top 3 Wins (Start Here)

### 1️⃣ **Detail Page Sequential Awaits** (200-400ms saved, 15 min)
**File:** `pages/detail/index.vue:310-346`

Replace:
```typescript
favCount.value = await getFavoriteCount(options.id!)
alreadyRated.value = await hasRated(...)
const { data: otherItems } = await supabase...
const { data: simItems } = await supabase...
```

With:
```typescript
const [favCount, alreadyRated, otherItems, simItems] = await Promise.all([
  getFavoriteCount(options.id!),
  itemData.status === 'sold' && currentUser.value && itemData.user_id !== currentUser.value.id
    ? hasRated(itemData.user_id, itemData.id)
    : Promise.resolve(false),
  supabase.from('items').select('id, title, price, images')
    .eq('user_id', itemData.user_id).eq('status', 'active')
    .neq('id', itemData.id).limit(6),
  supabase.from('items').select('id, title, price, images, user_id')
    .eq('category', itemData.category).eq('status', 'active')
    .neq('id', itemData.id).neq('user_id', itemData.user_id).limit(12),
])
favCount.value = favCount
alreadyRated.value = alreadyRated
if (alive && otherItems.data) sellerOtherItems.value = otherItems.data as Item[]
if (alive && simItems.data) similarItems.value = (simItems.data as Item[]).filter(...).slice(0, 6)
```

---

### 2️⃣ **Non-Blocking Auth Init** (100-200ms saved, 5 min)
**File:** `composables/useAuth.ts:18-46`

Change line 22 from:
```typescript
const { data: { session } } = await supabase.auth.getSession()
```

To:
```typescript
supabase.auth.getSession().then(({ data: { session } }) => {
  if (session?.user) {
    fetchProfile(session.user.id).catch(err => console.warn('fetchProfile failed:', err))
  }
}).catch(err => console.warn('getSession failed:', err))
```

And remove the `await` from the entire `init()` function call in `App.vue:26`.

---

### 3️⃣ **CSS Class Deduplication** (8-12KB saved, 10 min)
**Files:** `src/uni.scss` + 13 pages

Add to `uni.scss`:
```scss
.back-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.loc-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #FF6B35;
  
  &.safe {
    background: #22c55e;
  }
}
```

Then remove these styles from:
- `pages/seller/index.vue`
- `pages/settings/index.vue`
- `pages/post/index.vue`
- `pages/detail/index.vue`
- `pages/profile/index.vue`
- `pages/profile/edit.vue`
- `pages/history/index.vue`
- `pages/reset-password/index.vue`
- `pages/following/index.vue`
- `pages/legal/index.vue`
- `pages/saved-searches/index.vue`
- `pages/blocked/index.vue`
- `pages/notifications/index.vue`

---

## 📊 Full Audit Results

See **PERF_AUDIT_ROUND2.md** for:
- All 15 findings with detailed explanations
- Code examples for each fix
- Impact estimates (KB saved, ms saved)
- Priority rankings
- Composable memory pattern analysis
- uni-app lazy-loading documentation

---

## 🚀 Implementation Order

**Tier 1 (Do First — 35 min total):**
1. Detail page sequential awaits (15 min)
2. Non-blocking auth init (5 min)
3. Realtime channel cleanup (5 min)
4. CSS class deduplication (10 min)

**Tier 2 (Do Next — 100 min total):**
5. SWR cache for onShow (20 min)
6. Image transform + WebP (20 min)
7. Service worker (30 min)
8. Extract home page filters (45 min)

**Tier 3 (Polish — 25 min total):**
9. Further Vite chunk split (15 min)
10. Preload common images (10 min)

---

## 📈 Expected Results

| Metric | Before | After | Savings |
|--------|--------|-------|---------|
| First Load | ~2.5s | ~2.3s | 100-200ms |
| Detail Page | ~1.2s | ~0.8s | 200-400ms |
| Repeat Visits | ~2.5s | ~1.5s | 500ms-1s |
| Bundle Size | 928 KB | 900-920 KB | 8-30 KB |
| Memory (nav) | +100-200 KB | +0-50 KB | 50-200 KB |

**Total Impact:** ~1-2 seconds faster, 50-300 KB smaller

---

## ✅ Already Optimized (Round 1)

- ✅ Image lazy-load on 8 surfaces
- ✅ Supabase column projection (no select '*')
- ✅ Estimated counts (favorites/sold)
- ✅ thumbUrl() helper with size-specific params
- ✅ Vite manualChunks (vue/supabase/@dcloudio)
- ✅ esbuild drop console+debugger in prod
- ✅ System fonts only (no web fonts)
- ✅ No third-party trackers

---

## 🔗 Key Files

- **Audit:** `PERF_AUDIT_ROUND2.md`
- **Config:** `app/vite.config.ts`
- **Utils:** `app/src/utils/index.ts`
- **Auth:** `app/src/composables/useAuth.ts`
- **Detail:** `app/src/pages/detail/index.vue`
- **Home:** `app/src/pages/index/index.vue`
- **Messages:** `app/src/pages/messages/index.vue`
- **Profile:** `app/src/pages/profile/index.vue`

