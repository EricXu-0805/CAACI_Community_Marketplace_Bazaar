# CAACI Marketplace Performance Audit Round 2

**Project:** uni-app Vue 3 + Vite 5 + Supabase H5 on Vercel  
**Date:** 2024  
**Build Size:** 928 KB (dist/build/h5/assets/)  
**Largest Chunks:** uni.js (255K), supabase.js (190K), index-DW1xD6Lb.js (59K)

---

## FINDINGS: 15 ACTIONABLE WINS

### 1. **Sequential Awaits in Detail Page onLoad** ⚡ HIGH IMPACT
**File:** `pages/detail/index.vue:310-346`  
**Issue:** After initial Promise.all, 3 sequential queries execute one-by-one:
```typescript
favCount.value = await getFavoriteCount(options.id!)  // Line 321
alreadyRated.value = await hasRated(...)              // Line 325
const { data: otherItems } = await supabase...        // Line 328
const { data: simItems } = await supabase...          // Line 335
```
These can be parallelized. `getFavoriteCount` and `hasRated` are independent.

**Fix:**
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

**Impact:** ~200-400ms saved on detail page load (3 sequential DB queries → 1 parallel batch)  
**Effort:** 15 min  
**Priority:** 🔴 HIGH

---

### 2. **Module-Level State Leaks Across Page Navigations** 🧠 MEMORY
**Files:** Multiple composables declare module-level `ref()` state:
- `useItems.ts:8-11` → `items`, `loading`, `hasMore`, `fetchError`
- `useMessages.ts:7-9` → `conversations`, `messages`, `loading`
- `usePlaza.ts:8-10` → `posts`, `loading`, `hasMore`
- `useFavorites.ts:5-6` → `favoriteIds`, `loading`
- `useHistory.ts:5-6` → `history`, `postHistory` (intentional, persisted)
- `useUnread.ts:6-9` → `unreadCount`, `unreadConvIds`, `hasMutedUnread`, `mutedConvIds`

**Problem:** When user navigates from `/pages/index` → `/pages/plaza` → back to `/pages/index`, the `items` array from the first visit is still in memory. If the user had 100 items loaded, they're never garbage-collected.

**Analysis:**
- ✅ **Intentional (singleton cache):** `useHistory`, `useAuth.currentUser`, `useModeration.blockedIds`, `useFollow.following` — these should persist
- ⚠️ **Stale data risk:** `useItems.items`, `usePlaza.posts`, `useMessages.conversations` — reset on `fetchItems(reset: true)` but only if explicitly called
- 🔴 **Memory leak:** `useUnread` channel subscription persists; `useMessages` doesn't unsubscribe on page unmount

**Fix Strategy:**
1. Add `onUnmounted` cleanup in pages that use list composables:
```typescript
// pages/index/index.vue
onUnmounted(() => {
  // Don't clear items — they're cached for fast re-entry
  // But ensure no subscriptions leak
})
```

2. For `useMessages`, add explicit cleanup:
```typescript
// composables/useMessages.ts
export function useMessages() {
  let channel: ... | null = null
  
  function cleanup() {
    if (channel) {
      supabase.removeChannel(channel)
      channel = null
    }
  }
  
  return { ..., cleanup }
}

// pages/messages/index.vue
onUnmounted(() => {
  const { cleanup } = useMessages()
  cleanup()
})
```

**Impact:** Prevents 50-200 KB memory bloat per navigation cycle  
**Effort:** 30 min  
**Priority:** 🟡 MEDIUM

---

### 3. **onShow Refetch Without SWR (Stale-While-Revalidate)** 📡 NETWORK
**Files:** 
- `pages/messages/index.vue:122-127` → `onShow` calls `fetchConversations` + `refreshUnreadCount` every tab switch
- `pages/profile/index.vue:197-212` → `onShow` calls `fetchMyItems`, `loadMyFavorites`, `fetchMyFavoriteItems` every visit

**Issue:** No cache validation. If user tabs away for 5 seconds and returns, all data refetches even if fresh.

**Fix:** Implement SWR pattern:
```typescript
// composables/useMessages.ts
const lastFetchTime = ref(0)
const CACHE_TTL = 30000 // 30 seconds

async function fetchConversations(userId: string, force = false) {
  const now = Date.now()
  if (!force && now - lastFetchTime.value < CACHE_TTL) {
    return // Use cached data
  }
  // ... fetch logic
  lastFetchTime.value = now
}

// pages/messages/index.vue
onShow(() => {
  if (currentUser.value) {
    fetchConversations(currentUser.value.id, false) // Use cache if fresh
    refreshUnreadCount()
  }
})

// Pull-to-refresh forces fresh fetch
onPullDownRefresh(async () => {
  if (currentUser.value) {
    await fetchConversations(currentUser.value.id, true) // Force refresh
    await refreshUnreadCount()
  }
  uni.stopPullDownRefresh()
})
```

**Impact:** ~500ms-1s saved per tab switch (skips unnecessary DB queries)  
**Effort:** 20 min  
**Priority:** 🟡 MEDIUM

---

### 4. **CSS Class Duplication Across Pages** 🎨 BUNDLE
**Files:** `.back-btn`, `.loc-dot` defined in 8+ pages:
- `pages/seller/index.vue` → `.back-btn`, `.loc-dot`
- `pages/settings/index.vue` → `.back-btn`
- `pages/post/index.vue` → `.back-btn`
- `pages/detail/index.vue` → `.loc-dot`
- `pages/profile/index.vue` → `.loc-dot`
- `pages/profile/edit.vue` → `.back-btn`
- `pages/history/index.vue` → `.back-btn`
- `pages/reset-password/index.vue` → `.back-btn`
- `pages/following/index.vue` → `.back-btn`
- `pages/legal/index.vue` → `.back-btn`
- `pages/saved-searches/index.vue` → `.back-btn`
- `pages/blocked/index.vue` → `.back-btn`
- `pages/notifications/index.vue` → `.back-btn`

**Fix:** Extract to `uni.scss` (global):
```scss
// src/uni.scss
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

Remove from all page `<style>` blocks.

**Impact:** ~8-12 KB CSS saved (each page ~0.6-1 KB redundant)  
**Effort:** 10 min  
**Priority:** 🟢 LOW (small win, easy)

---

### 5. **Supabase Realtime Channel Not Cleaned Up on Logout** 🔌 MEMORY
**File:** `composables/useUnread.ts:75-99`

**Issue:** `startListening()` subscribes to `user-${userId}-new-messages` channel but only unsubscribes in `stopListening()`. If user logs out without calling `stopListening()`, channel persists.

**Current:** `useAuth.signOut()` calls `supabase.removeAllChannels()` (line 114) — this is good.  
**But:** `useUnread` doesn't export `stopListening` for manual cleanup.

**Fix:** Ensure cleanup is called:
```typescript
// composables/useAuth.ts
async function signOut() {
  const { clearBlocked } = useModeration()
  const { stopListening } = useUnread()  // Add this
  stopListening()  // Add this
  await supabase.auth.signOut()
  supabase.removeAllChannels()
  currentUser.value = null
  clearBlocked()
  uni.reLaunch({ url: '/pages/index/index' })
}
```

**Impact:** Prevents 5-10 KB memory leak per logout  
**Effort:** 5 min  
**Priority:** 🟢 LOW (already mostly handled by `removeAllChannels`)

---

### 6. **Home Page (index.vue) 1063 LOC — Extract Composable** 📦 BUNDLE
**File:** `pages/index/index.vue:1-1063`

**Issue:** Massive single-file component with:
- Filter state (8 refs)
- Search history (2 functions)
- Waterfall layout logic (2 computed)
- Category selection (1 computed)
- Semester banner logic (3 computed)
- Pull-to-refresh (1 function)
- Infinite scroll (1 function)

**Fix:** Extract to `composables/useHomeFilters.ts`:
```typescript
// composables/useHomeFilters.ts
export function useHomeFilters() {
  const searchText = ref('')
  const selectedCategory = ref<ItemCategory | null>(null)
  const filterPriceMin = ref('')
  const filterPriceMax = ref('')
  const filterCondition = ref('')
  const filterLocation = ref('')
  const sortBy = ref('latest')
  
  const activeFilterCount = computed(() => { ... })
  const filteredItems = computed(() => { ... })
  
  function applyFilters() { ... }
  function resetFilters() { ... }
  function getFilterParams() { ... }
  
  return {
    searchText, selectedCategory, filterPriceMin, filterPriceMax,
    filterCondition, filterLocation, sortBy,
    activeFilterCount, filteredItems,
    applyFilters, resetFilters, getFilterParams,
  }
}
```

Then in `pages/index/index.vue`:
```typescript
const { searchText, selectedCategory, ... } = useHomeFilters()
```

**Impact:** Reduces page chunk from 19 KB → ~14 KB (5 KB saved); improves readability  
**Effort:** 45 min  
**Priority:** 🟡 MEDIUM (code quality + small bundle win)

---

### 7. **Supabase Image Transform Caching & Responsive Srcset** 🖼️ IMAGES
**File:** `utils/index.ts:4-17` (thumbUrl helper)

**Current:**
```typescript
export function thumbUrl(url: string | null | undefined, size: "list" | "card" | "detail" | "avatar" = "list"): string {
  if (!url) return ""
  if (!url.includes(SUPABASE_STORAGE_MARKER)) return url
  const rendered = url.replace(SUPABASE_STORAGE_MARKER, SUPABASE_RENDER_PATH)
  const params = size === "avatar" ? "width=96&height=96&quality=75&resize=cover"
    : size === "list" ? "width=480&quality=72&resize=cover"
    : size === "card" ? "width=640&quality=75&resize=cover"
    : "width=1280&quality=82"
  return `${rendered}?${params}`
}
```

**Issues:**
1. No cache headers specified. Supabase renders on-the-fly each request.
2. No responsive srcset for different device widths.
3. No format negotiation (WebP for modern browsers).

**Fix:**
```typescript
export function thumbUrl(
  url: string | null | undefined,
  size: "list" | "card" | "detail" | "avatar" = "list",
): string {
  if (!url) return ""
  if (!url.includes(SUPABASE_STORAGE_MARKER)) return url
  const rendered = url.replace(SUPABASE_STORAGE_MARKER, SUPABASE_RENDER_PATH)
  
  const params = size === "avatar" ? "width=96&height=96&quality=75&resize=cover&format=webp"
    : size === "list" ? "width=480&quality=72&resize=cover&format=webp"
    : size === "card" ? "width=640&quality=75&resize=cover&format=webp"
    : "width=1280&quality=82&format=webp"
  
  // Add cache-busting if needed, but Supabase should cache by URL
  return `${rendered}?${params}`
}

// New helper for srcset
export function thumbSrcset(
  url: string | null | undefined,
  size: "list" | "card" | "detail" = "list",
): string {
  if (!url) return ""
  const base = thumbUrl(url, size)
  if (!base.includes(SUPABASE_RENDER_PATH)) return base
  
  // Return srcset for 1x and 2x
  const widths = size === "list" ? [240, 480] : size === "card" ? [320, 640] : [640, 1280]
  return widths.map(w => {
    const srcUrl = base.replace(/width=\d+/, `width=${w}`)
    return `${srcUrl} ${w}w`
  }).join(', ')
}
```

Usage in templates:
```vue
<image :src="thumbUrl(item.images?.[0], 'list')" :srcset="thumbSrcset(item.images?.[0], 'list')" />
```

**Impact:** 
- WebP format: ~20-30% smaller images (if Supabase supports; check docs)
- Responsive srcset: Better UX on high-DPI devices
- Estimated: 50-100 KB saved on image-heavy pages

**Effort:** 20 min  
**Priority:** 🟡 MEDIUM

---

### 8. **No Service Worker — Add Minimal Offline Cache** 🔌 PWA
**Current:** `manifest.webmanifest` exists but no `service-worker.js`.

**Issue:** Repeat visits require full re-download of JS/CSS. No offline support.

**Fix:** Add minimal service worker:
```javascript
// public/sw.js
const CACHE_NAME = 'illini-market-v1'
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/static/logo.png',
  '/static/default-avatar.svg',
  '/static/placeholder.svg',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE)
    })
  )
})

self.addEventListener('fetch', (event) => {
  // Network-first for API calls
  if (event.request.url.includes('/rest/v1/')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const cache = caches.open(CACHE_NAME)
          cache.then((c) => c.put(event.request, response.clone()))
          return response
        })
        .catch(() => caches.match(event.request))
    )
  } else {
    // Cache-first for static assets
    event.respondWith(
      caches.match(event.request).then((response) => {
        return response || fetch(event.request)
      })
    )
  }
})
```

Register in `index.html`:
```html
<script>
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js')
  }
</script>
```

**Impact:** 
- Repeat visits: ~500ms-1s faster (cached JS/CSS)
- Offline support: Can view cached items
- Estimated: 200-300 KB saved on repeat visits

**Effort:** 30 min  
**Priority:** 🟡 MEDIUM

---

### 9. **Vite manualChunks Not Effective for uni-app** 🔀 BUNDLE
**File:** `vite.config.ts:14-20`

**Current:**
```typescript
manualChunks(id) {
  if (!id.includes("node_modules")) return;
  if (id.includes("@supabase")) return "supabase";
  if (id.includes("/vue/") || id.includes("@vue/")) return "vue";
  if (id.includes("@dcloudio")) return "uni";
}
```

**Issue:** uni-app's Vite plugin may inline these chunks into page bundles anyway. Check if `dist/build/h5/assets/` has separate `supabase.*.js` and `uni.*.js` files.

**Verification:** ✅ YES — `supabase.CmLHw_fR.js` (190K) and `uni.hA8dnbsR.js` (255K) exist separately.

**Optimization:** The split is working, but `uni.js` (255K) is huge. Check if it can be further split:

```typescript
manualChunks(id) {
  if (!id.includes("node_modules")) return;
  if (id.includes("@supabase")) return "supabase";
  if (id.includes("/vue/") || id.includes("@vue/")) return "vue";
  if (id.includes("@dcloudio/uni-h5")) return "uni-h5";
  if (id.includes("@dcloudio/uni-app")) return "uni-app";
  if (id.includes("@dcloudio")) return "uni-core";
}
```

**Impact:** Potential 20-30 KB savings if uni-h5 can be lazy-loaded  
**Effort:** 15 min  
**Priority:** 🟢 LOW (already well-split)

---

### 10. **No Preload for Critical Images** 🖼️ IMAGES
**File:** `index.html:20`

**Current:** `<!--preload-links-->` is empty.

**Fix:** Inject preload for first 4 card images on home page:
```html
<!-- index.html -->
<link rel="preload" as="image" href="/static/placeholder.svg" />
<link rel="preload" as="image" href="/static/logo.png" />
<!-- Preload first 4 items' images (dynamic, but can be hardcoded for common items) -->
```

Or better, inject dynamically in `App.vue`:
```typescript
// App.vue
onLaunch(() => {
  // Preload common static assets
  const preloadImages = [
    '/static/placeholder.svg',
    '/static/default-avatar.svg',
    '/static/heart.svg',
    '/static/heart-filled.svg',
  ]
  preloadImages.forEach(src => {
    const link = document.createElement('link')
    link.rel = 'preload'
    link.as = 'image'
    link.href = src
    document.head.appendChild(link)
  })
})
```

**Impact:** ~50-100ms faster first paint  
**Effort:** 10 min  
**Priority:** 🟢 LOW

---

### 11. **useAuth.init() Blocks First Paint** ⏱️ STARTUP
**File:** `App.vue:25-26`, `composables/useAuth.ts:18-46`

**Issue:** `onLaunch` calls `init()` which:
1. Awaits `getSession()` (network call)
2. Awaits `onAuthStateChange()` subscription setup
3. Calls `fetchProfile()` (another network call)

This blocks rendering until auth is resolved.

**Current behavior:** ✅ Actually OK — `fetchProfile` is fire-and-forget (no await), so it doesn't block.

**Verify:** Line 24 in useAuth.ts:
```typescript
fetchProfile(session.user.id).catch(err => console.warn('fetchProfile failed:', err))
```

No await — good!

**But:** `getSession()` on line 22 is awaited. This can take 100-500ms.

**Fix:** Make it non-blocking:
```typescript
async function init() {
  authSubscription?.unsubscribe()

  // Don't await getSession — fire and forget
  supabase.auth.getSession().then(({ data: { session } }) => {
    if (session?.user) {
      fetchProfile(session.user.id).catch(err => console.warn('fetchProfile failed:', err))
    }
  }).catch(err => console.warn('getSession failed:', err))

  // ... rest of init
}
```

**Impact:** ~100-200ms faster first paint  
**Effort:** 5 min  
**Priority:** 🟡 MEDIUM

---

### 12. **Fonts Are System Fonts (Free)** ✅ GOOD
**File:** `App.vue:47-48`

```css
font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text',
  'Helvetica Neue', 'PingFang SC', 'Microsoft YaHei', sans-serif;
```

✅ All system fonts — no web font downloads. No action needed.

---

### 13. **No Third-Party Trackers** ✅ GOOD
**Grep result:** No GA, Sentry, Clarity, Hotjar found.

✅ Clean. No action needed.

---

### 14. **Lazy-Load Already Implemented** ✅ GOOD
**Round 1 win:** Image lazy-load on 8 list surfaces.

Verified in:
- `pages/index/index.vue:233` → `lazy-load`
- `pages/detail/index.vue:114, 127` → `lazy-load`
- `pages/messages/index.vue:60` → `lazy-load`
- `pages/profile/index.vue:82, 111, 133` → `lazy-load`

✅ Good coverage. No action needed.

---

### 15. **Supabase Column Projection Already Optimized** ✅ GOOD
**Round 1 win:** LIST_ITEM_FIELDS, no select '*'.

Verified in:
- `composables/useItems.ts:15-16` → `LIST_ITEM_FIELDS`
- `composables/useFavorites.ts:71` → Explicit columns
- `composables/usePlaza.ts:14-16` → `POST_SELECT`

✅ Good. No action needed.

---

## SUMMARY TABLE

| # | Finding | File:Line | Fix | Impact | Effort | Priority |
|---|---------|-----------|-----|--------|--------|----------|
| 1 | Sequential awaits in detail page | detail/index.vue:310-346 | Promise.all 4 queries | 200-400ms | 15min | 🔴 HIGH |
| 2 | Module-level state leaks | useItems, useMessages, usePlaza | Add cleanup on unmount | 50-200KB mem | 30min | 🟡 MED |
| 3 | onShow refetch without SWR | messages, profile pages | Add 30s cache TTL | 500ms-1s | 20min | 🟡 MED |
| 4 | CSS class duplication | 13 pages | Extract to uni.scss | 8-12KB | 10min | 🟢 LOW |
| 5 | Realtime channel cleanup | useUnread.ts | Call stopListening on logout | 5-10KB mem | 5min | 🟢 LOW |
| 6 | Home page 1063 LOC | pages/index/index.vue | Extract useHomeFilters | 5KB + readability | 45min | 🟡 MED |
| 7 | Image transform caching | utils/index.ts | Add WebP + srcset | 50-100KB | 20min | 🟡 MED |
| 8 | No service worker | — | Add minimal SW | 200-300KB repeat | 30min | 🟡 MED |
| 9 | Vite chunks not split further | vite.config.ts | Split uni-h5 separately | 20-30KB | 15min | 🟢 LOW |
| 10 | No image preload | index.html | Preload common assets | 50-100ms | 10min | 🟢 LOW |
| 11 | Auth init blocks paint | App.vue, useAuth.ts | Non-blocking getSession | 100-200ms | 5min | 🟡 MED |
| 12 | Fonts | App.vue | ✅ System fonts | — | — | ✅ |
| 13 | Trackers | — | ✅ None | — | — | ✅ |
| 14 | Lazy-load | Multiple | ✅ Implemented | — | — | ✅ |
| 15 | Column projection | Multiple | ✅ Optimized | — | — | ✅ |

---

## TOP 10 PRIORITIZED ACTION LIST

### Tier 1: High Impact, Low Effort (Do First)

1. **[1] Sequential Awaits in Detail Page** (200-400ms, 15min)
   - Parallelize 4 DB queries in onLoad
   - File: `pages/detail/index.vue:310-346`

2. **[11] Non-Blocking Auth Init** (100-200ms, 5min)
   - Don't await getSession in App.vue
   - File: `App.vue:25-26`, `useAuth.ts:18-46`

3. **[5] Realtime Channel Cleanup** (5-10KB mem, 5min)
   - Call stopListening on logout
   - File: `useUnread.ts`, `useAuth.ts`

4. **[4] Extract CSS Classes** (8-12KB, 10min)
   - Move .back-btn, .loc-dot to uni.scss
   - Files: 13 pages

### Tier 2: Medium Impact, Medium Effort (Do Next)

5. **[3] SWR Cache for onShow** (500ms-1s, 20min)
   - Add 30s TTL to messages/profile fetches
   - Files: `useMessages.ts`, `useNotifications.ts`

6. **[7] Image Transform + WebP** (50-100KB, 20min)
   - Add format=webp, srcset to thumbUrl
   - File: `utils/index.ts:4-17`

7. **[8] Minimal Service Worker** (200-300KB repeat, 30min)
   - Cache static assets + API responses
   - Files: `public/sw.js`, `index.html`

8. **[6] Extract Home Page Filters** (5KB + readability, 45min)
   - Create useHomeFilters composable
   - File: `pages/index/index.vue`

### Tier 3: Low Impact, Low Effort (Polish)

9. **[9] Further Vite Chunk Split** (20-30KB, 15min)
   - Split uni-h5 separately
   - File: `vite.config.ts`

10. **[10] Preload Common Images** (50-100ms, 10min)
    - Inject preload links in App.vue
    - Files: `App.vue`, `index.html`

---

## ESTIMATED TOTAL IMPACT

| Category | Savings | Effort |
|----------|---------|--------|
| **First Load** | 100-200ms | 25min |
| **Detail Page Load** | 200-400ms | 15min |
| **Repeat Visits** | 200-300KB + 500ms-1s | 30min |
| **Memory** | 50-200KB | 30min |
| **Bundle Size** | 8-30KB | 50min |
| **Total** | **~1-2s + 50-300KB** | **~2.5 hours** |

---

## NOTES

### uni-app Lazy-Loading Story
uni-app supports route-level code splitting via `pages.json` preloadRule:
```json
{
  "pages": [
    { "path": "pages/index/index", "style": { "navigationStyle": "custom" } }
  ],
  "preloadRule": {
    "pages/index/index": {
      "network": "all",
      "packages": ["pages/detail/index", "pages/plaza/index"]
    }
  }
}
```

This preloads detail & plaza chunks when on home page. Currently not used — could add if needed.

### Composable Memory Pattern Summary

| Composable | State | Scope | Cleanup | Notes |
|-----------|-------|-------|---------|-------|
| useAuth | currentUser | Singleton | ✅ signOut clears | Intentional cache |
| useItems | items[] | Page-scoped | ⚠️ Manual reset | Stale on nav |
| useMessages | conversations[] | Page-scoped | ❌ No cleanup | Leak risk |
| useFavorites | favoriteIds | Singleton | ✅ loadMyFavorites resets | Intentional cache |
| useHistory | history[] | Singleton | ✅ clearHistory | Persisted to storage |
| useUnread | unreadConvIds | Singleton | ⚠️ stopListening | Channel cleanup needed |
| useModeration | blockedIds | Singleton | ✅ clearBlocked | Intentional cache |
| useFollow | following | Singleton | ✅ loadMyFollowing resets | Intentional cache |
| usePlaza | posts[] | Page-scoped | ⚠️ Manual reset | Stale on nav |

