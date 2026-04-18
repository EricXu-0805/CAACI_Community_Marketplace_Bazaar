# Performance Audit Round 2 — Complete Index

## 📚 Documentation Files

### 1. **PERF_AUDIT_QUICK_START.md** (4.5 KB)
**Start here!** Copy-paste ready code for the top 3 wins.

- ✅ Detail page sequential awaits (200-400ms, 15 min)
- ✅ Non-blocking auth init (100-200ms, 5 min)
- ✅ CSS class deduplication (8-12 KB, 10 min)
- Implementation order (Tier 1/2/3)
- Expected results table

**Read time:** 5 minutes  
**Implementation time:** 35 minutes (top 3 wins)

---

### 2. **PERF_AUDIT_ROUND2.md** (22 KB)
**Complete audit report** with all 15 findings.

- 15 detailed findings with code examples
- Impact estimates (KB saved, ms saved)
- Priority rankings (🔴 HIGH, 🟡 MEDIUM, 🟢 LOW)
- Composable memory pattern analysis
- uni-app lazy-loading documentation
- Summary table and prioritized action list

**Read time:** 20 minutes  
**Reference:** Throughout implementation

---

## 🎯 Quick Navigation

### By Priority

**🔴 HIGH (Do First)**
- [1] Sequential awaits in detail page → 200-400ms, 15 min
  - File: `pages/detail/index.vue:310-346`

**🟡 MEDIUM (Do Next)**
- [2] Module-level state leaks → 50-200 KB, 30 min
- [3] onShow refetch without SWR → 500ms-1s, 20 min
- [6] Home page 1063 LOC → 5 KB, 45 min
- [7] Image transform + WebP → 50-100 KB, 20 min
- [8] Service worker → 200-300 KB, 30 min
- [11] Auth init blocks paint → 100-200ms, 5 min

**🟢 LOW (Polish)**
- [4] CSS class duplication → 8-12 KB, 10 min
- [5] Realtime channel cleanup → 5-10 KB, 5 min
- [9] Vite chunk split → 20-30 KB, 15 min
- [10] Image preload → 50-100ms, 10 min

**✅ ALREADY OPTIMIZED**
- [12] System fonts only
- [13] No third-party trackers
- [14] Lazy-load on 8 surfaces
- [15] Supabase column projection

---

### By File

| File | Findings | Impact |
|------|----------|--------|
| `pages/detail/index.vue` | [1] Sequential awaits | 200-400ms |
| `composables/useAuth.ts` | [11] Auth init blocks | 100-200ms |
| `src/uni.scss` + 13 pages | [4] CSS duplication | 8-12 KB |
| `composables/useMessages.ts` | [2] State leaks, [3] SWR | 50-200 KB, 500ms-1s |
| `composables/useItems.ts` | [2] State leaks | 50-200 KB |
| `composables/usePlaza.ts` | [2] State leaks | 50-200 KB |
| `composables/useUnread.ts` | [5] Channel cleanup | 5-10 KB |
| `pages/index/index.vue` | [6] Extract composable | 5 KB |
| `utils/index.ts` | [7] Image transform | 50-100 KB |
| `index.html` + `public/sw.js` | [8] Service worker | 200-300 KB |
| `vite.config.ts` | [9] Chunk split | 20-30 KB |
| `App.vue` | [10] Image preload | 50-100ms |

---

## 📊 Impact Summary

### By Category

| Category | Savings | Effort |
|----------|---------|--------|
| **First Load** | 100-200ms | 25 min |
| **Detail Page** | 200-400ms | 15 min |
| **Repeat Visits** | 200-300 KB + 500ms-1s | 30 min |
| **Memory** | 50-200 KB | 30 min |
| **Bundle Size** | 8-30 KB | 50 min |
| **TOTAL** | **~1-2s + 50-300 KB** | **~2.5 hours** |

### By Metric

| Metric | Before | After | Savings |
|--------|--------|-------|---------|
| First Load | ~2.5s | ~2.3s | 100-200ms |
| Detail Page | ~1.2s | ~0.8s | 200-400ms |
| Repeat Visits | ~2.5s | ~1.5s | 500ms-1s |
| Bundle Size | 928 KB | 900-920 KB | 8-30 KB |
| Memory (nav) | +100-200 KB | +0-50 KB | 50-200 KB |

---

## 🚀 Implementation Roadmap

### Phase 1: Quick Wins (35 minutes)
1. Detail page sequential awaits (15 min)
2. Non-blocking auth init (5 min)
3. Realtime channel cleanup (5 min)
4. CSS class deduplication (10 min)

**Expected:** 300-400ms faster, 8-12 KB smaller

### Phase 2: Medium Wins (100 minutes)
5. SWR cache for onShow (20 min)
6. Image transform + WebP (20 min)
7. Service worker (30 min)
8. Extract home page filters (45 min)

**Expected:** 500ms-1s faster on repeat visits, 50-100 KB smaller

### Phase 3: Polish (25 minutes)
9. Further Vite chunk split (15 min)
10. Preload common images (10 min)

**Expected:** 50-100ms faster first paint, 20-30 KB smaller

---

## 🔍 Key Insights

### Route-Level Code Splitting
- uni-app supports `preloadRule` in `pages.json`
- Currently not used
- Could preload detail/plaza on home page
- Potential 50-100ms savings

### Composable Memory Patterns
- 9 composables with module-level state
- 4 intentional singletons (auth, history, moderation, follow)
- 3 page-scoped lists need cleanup (items, messages, plaza)
- 2 realtime subscriptions need explicit unsubscribe

### Supabase Optimization
- ✅ Column projection optimized (no select '*')
- ⚠️ Image transforms working but no WebP/srcset
- ✅ Realtime channels properly scoped
- ✅ Estimated counts in use

### Bundle Analysis
- uni.js (255 KB) — largest chunk, well-split
- supabase.js (190 KB) — well-split
- Page chunks 7-19 KB each — reasonable
- CSS properly scoped but duplicated across pages

---

## ✅ Round 1 Wins (Already Shipped)

Commits e54847a..203f4c9:
- ✅ Image lazy-load on 8 list surfaces
- ✅ Supabase list column projection (LIST_ITEM_FIELDS)
- ✅ Estimated counts (favorites/sold)
- ✅ thumbUrl() helper with size-specific params
- ✅ Vite manualChunks (vue/supabase/@dcloudio)
- ✅ esbuild drop console+debugger in production

---

## 📋 Checklist

### Before Starting
- [ ] Read PERF_AUDIT_QUICK_START.md
- [ ] Review PERF_AUDIT_ROUND2.md for full context
- [ ] Set up Chrome DevTools for slow 3G testing

### Phase 1 Implementation
- [ ] Detail page sequential awaits
- [ ] Non-blocking auth init
- [ ] Realtime channel cleanup
- [ ] CSS class deduplication
- [ ] Test on slow 3G
- [ ] Measure with Lighthouse

### Phase 2 Implementation
- [ ] SWR cache for onShow
- [ ] Image transform + WebP
- [ ] Service worker
- [ ] Extract home page filters
- [ ] Test on slow 3G
- [ ] Measure with Lighthouse

### Phase 3 Implementation
- [ ] Further Vite chunk split
- [ ] Preload common images
- [ ] Final Lighthouse audit
- [ ] Deploy to Vercel
- [ ] Monitor with Vercel Analytics

---

## 🔗 Related Files

### Configuration
- `app/vite.config.ts` — Build configuration
- `app/src/pages.json` — Route configuration
- `app/src/manifest.json` — PWA manifest
- `app/index.html` — HTML template

### Core
- `app/src/App.vue` — Root component
- `app/src/main.ts` — Entry point
- `app/src/uni.scss` — Global styles

### Composables
- `app/src/composables/useAuth.ts` — Authentication
- `app/src/composables/useItems.ts` — Item list
- `app/src/composables/useMessages.ts` — Messages
- `app/src/composables/useFavorites.ts` — Favorites
- `app/src/composables/useUnread.ts` — Unread count
- `app/src/composables/usePlaza.ts` — Plaza posts

### Pages
- `app/src/pages/index/index.vue` — Home (1063 LOC)
- `app/src/pages/detail/index.vue` — Item detail (852 LOC)
- `app/src/pages/messages/index.vue` — Messages (464 LOC)
- `app/src/pages/profile/index.vue` — Profile (549 LOC)
- `app/src/pages/plaza/index.vue` — Plaza (916 LOC)

### Utilities
- `app/src/utils/index.ts` — Helper functions (394 LOC)

---

## 📞 Questions?

Refer to the detailed findings in **PERF_AUDIT_ROUND2.md** for:
- Code examples for each fix
- Detailed impact analysis
- Alternative approaches
- Potential trade-offs

---

**Last Updated:** April 18, 2024  
**Audit Scope:** 23 Vue files, 17 composables, 928 KB build  
**Total Findings:** 15 (1 HIGH, 7 MEDIUM, 4 LOW, 3 ALREADY OPTIMIZED)
