# V3 P2 Icon Registry — Working Draft

**Status:** in progress · Eric reviewing rounds · pending 4th round (3 redraws + 3 new + 标记预留 redo)
**Last updated:** 2026-05-11
**Owner:** chat-Claude draws · Eric reviews · OpenCode bakes into `app/src/components/icons/registry.ts` once finalized

**Purpose:** cross-session source-of-truth for v3 P2 icon design state. Each round's accepted SVG paths are pinned here verbatim so that any future session can resume without re-deriving. When all icons are accepted, the contents of "Accepted" section gets copied 1:1 into `registry.ts` by OpenCode.

**Style guide (all icons):**
- 24×24 viewBox
- Regular: `stroke-width: 1.6, fill: none, stroke: currentColor, stroke-linecap: round, stroke-linejoin: round`
- Filled: `fill: currentColor` (or `fill-rule: evenodd` for cutout patterns)
- Visual weight anchored to Lucide regular; redrawn fresh (not copy-paste)

---

## Accepted icons (43 names / 52 SVG variants) — LOCKED 2026-05-11

### Tab bar — 4 names × regular+filled = 8 SVGs

```
'home-regular': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12 12 4l9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/></svg>`
'home-filled':  `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3 2 12.5h2.5V21h6v-6h3v6h6v-8.5H22z"/></svg>`

'plaza-regular': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 10h10"/><path d="M7 14h6"/></svg>`
'plaza-filled':  `<svg viewBox="0 0 24 24" fill="currentColor" fill-rule="evenodd"><path d="M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM7 9.7h10v1.6H7zM7 13.7h6v1.6H7z"/></svg>`

'messages-regular': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 8.5-8.5 8.5 8.5 0 0 1 8.5 8.5z"/></svg>`
'messages-filled':  `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 8.5-8.5 8.5 8.5 0 0 1 8.5 8.5z"/></svg>`

'profile-regular': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a7 7 0 0 1 7-7h2a7 7 0 0 1 7 7v1"/></svg>`
'profile-filled':  `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="8" r="4"/><path d="M20 21v-1a7 7 0 0 0-7-7h-2a7 7 0 0 0-7 7v1z"/></svg>`
```

### Content actions — 5 names × regular+filled = 10 SVGs

```
'heart-regular': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`
'heart-filled':  `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z"/></svg>`

'chat-bubble-regular': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`
'chat-bubble-filled':  `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`

'bell-regular': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>`
'bell-filled':  `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9z"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/></svg>`

'tag-regular': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41 13.41 20.6a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><circle cx="7" cy="7" r="1.5"/></svg>`
'tag-filled':  `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.59 13.41 13.41 20.6a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82zM7 5.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z"/></svg>`

'lightbulb-regular': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.4.3.6.7.6 1.2v1.1c0 .6.4 1 1 1h4.8c.6 0 1-.4 1-1V16c0-.5.3-.9.6-1.2A7 7 0 0 0 12 2z"/></svg>`
'lightbulb-filled':  `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a7 7 0 0 0-4 12.7c.4.3.6.7.6 1.2v1.1c0 .6.4 1 1 1h4.8c.6 0 1-.4 1-1V16c0-.5.3-.9.6-1.2A7 7 0 0 0 12 2z"/><path d="M9 18.5h6v1.5H9zM10 21h4v1h-4z"/></svg>`
```

### Utility — 11 stroke-only navigation/chrome icons

```
'back-regular':            `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>`
'share-regular':           `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v12"/><path d="m8 8 4-4 4 4"/><path d="M6 11v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-8"/></svg>`
'image-regular':           `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/></svg>`
'search-regular':          `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>`
'filter-regular':          `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M7 12h10"/><path d="M10 18h4"/></svg>`
'plus-regular':            `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>`
'close-regular':           `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`
'more-horizontal-regular': `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>`
'more-vertical-regular':   `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>`
'chevron-right-regular':   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>`
'chevron-left-regular':    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m15 6-6 6 6 6"/></svg>`
```

### Emoji replacements — 2 stroke-only

```
'coffee-regular':     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M17 8h1a4 4 0 1 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z"/><path d="M6 2v2"/><path d="M10 2v2"/><path d="M14 2v2"/></svg>`
'graduation-regular': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10 12 4 2 10l10 6 10-6z"/><path d="M6 12v5c0 1.5 3 3 6 3s6-1.5 6-3v-5"/></svg>`
```

### Profile quick-actions — 4 stroke-only

```
'history-regular':     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></svg>`
'user-plus-regular':   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="4"/><path d="M2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 5 2.7"/><path d="M19 13v6"/><path d="M16 16h6"/></svg>`
'bookmark-regular':    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`
'layout-grid-regular': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>`
```

### Detail/profile chrome — 7 stroke-only

```
'edit-regular':         `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/><path d="M15 5l4 4"/></svg>`
'flag-regular':         `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21V4h12l-2 4 2 4H4"/></svg>`
'location-pin-regular': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-7.5-7-12a7 7 0 0 1 14 0c0 4.5-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/></svg>`
'settings-regular':     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6 1.65 1.65 0 0 0 10 3.09V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`
'shield-regular':       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`
'arrow-up-regular':     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>`
'reserved-regular':     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3v18l6-4 6 4V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z"/><circle cx="12" cy="8" r="3"/></svg>`
```

### Product categories — 9 accepted stroke-only (sublease aliases to home)

**Aliasing note:** the `cat-sublease` category does NOT have its own SVG. It reuses `home-regular` from the tab bar (per Eric round-10 decision: "category icons only appear on search page, won't visually collide with tab bar home"). When the search page renders the sublease chip, use `<UIcon name="home" weight="regular" />`. Don't add `'cat-sublease-regular'` to the registry — it would just duplicate `home-regular`.

```
'cat-currency-regular':    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h13"/><path d="m13 5 3 3-3 3"/><path d="M21 16H8"/><path d="m11 13-3 3 3 3"/></svg>`
'cat-electronics-regular': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M10 6h4"/><path d="M11 19h2"/></svg>`
'cat-furniture-regular':   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 14a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3H3z"/><path d="M5 12V8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v4"/><path d="M5 17v2M19 17v2"/></svg>`
'cat-clothing-regular':    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m20 8-4-4-4 2-4-2-4 4 3 3v9h10v-9z"/></svg>`
'cat-books-regular':       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`
'cat-transport-regular':   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/></svg>`
'cat-daily-regular':       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h18l-1.5 13H4.5z"/><path d="M8 8V5a4 4 0 0 1 8 0v3"/></svg>`
'cat-food-regular':        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 13a9 9 0 0 0 18 0v-1H3z"/><path d="M7 8c0-1 1-2 2-2"/><path d="M11 8c0-1 1-2 2-2"/><path d="M15 8c0-1 1-2 2-2"/></svg>`
'cat-other-regular':       `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="6" cy="6" r="1.6"/><circle cx="12" cy="6" r="1.6"/><circle cx="18" cy="6" r="1.6"/><circle cx="6" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18" cy="12" r="1.6"/><circle cx="6" cy="18" r="1.6"/><circle cx="12" cy="18" r="1.6"/><circle cx="18" cy="18" r="1.6"/></svg>`
```

### Plaza interactions — 1 stroke-only

```
'forward-regular': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5l6 6-6 6v-4c-4 0-8 1-10 5 0-6 4-9 10-9z"/></svg>`
```

---

## Pending — NONE (all rounds closed 2026-05-11)

All 43 icon names locked. P2 icon design phase complete. Ready for P2a OpenCode prompt (build UIcon.vue + UButton.vue + registry.ts + preview.html).

### Resolution log for non-trivial decisions

**`cat-electronics-regular`** — settled on **phone (smartphone) silhouette** after headphones in rounds 3-4 rejected. Phone is a cleaner brand-neutral metaphor for electronics category.

**`cat-sublease-regular`** — NOT created. Sublease category reuses `home-regular` via UI-layer aliasing (Eric round 10: "search page chip and tab bar won't collide visually"). One less SVG to maintain.

**`cat-transport-regular`** — Lucide-style diagonal bike accepted in round 4.

**`reserved-regular`** — settled on **ribbon-medal** (closed bookmark outline + circle inside) after lock / hourglass / flag-with-dot / clipboard / clock-pause all rejected. Sits in "Detail/profile chrome" section.

**`forward-regular`** — settled on **closed-outline curved arrow (iOS Mail forward style)** after retweet-loop rejected as "unrecognizable". Sits in new "Plaza interactions" section.

### Removed from registry — use brand seal image instead

**`system-notification-regular`** — REMOVED. Per Eric round 4: 系统通知 default avatar should use the **Illini Market brand seal logo image** (the terracotta 集 seal from `Illini Market Design System/assets/logo-candidates/seal-mark.svg`), not a chrome icon. Will be wired as `<image src="..">` in notification list when default-system-avatar is needed.

**`caaci-helper-regular`** — REMOVED. Per Eric round 4: CAACI 小助手 avatar should also use **brand seal logo image** (or a variant). Same approach as system-notification.

### Scope-cut (kept from round 3)

**`briefcase-regular`** — REMOVED. Was for "我的页 测试 badge", but Eric clarified that's personal state not a chrome icon.

---

## Round history

| Round | Drawn | Accepted | Rejected/Redo |
|---|---|---|---|
| 1 | 22 names / 31 SVGs (initial set) | 21 names | plaza (both weights) — looked like settings menu |
| 2 | plaza v2 + 4 new (history/user-plus/bookmark/layout-grid) | 5 names | none |
| 3 | 8 utility + 10 category + 3 reserved options | 13 names (6 utility + 7 categories) | briefcase removed; reserved (3 options); 电子/转租/交通 |
| 4 | 3 category redraws + 3 reserved options + 3 new requests | 2 names (交通 bike + reserved ribbon-medal) | 电子, 转租 redo again; system-notification + caaci-helper removed (use brand seal image); forward redo |
| 5 | 3 redraws | 电子 (phone) | 转租 (key v3); forward (retweet-loop) |
| 6 | 2 redraws (转租 key v4 + forward closed curve) | forward (closed-outline curved arrow) | 转租 (still ugly) |
| 7 | 转租 key v5 (V-notch teeth) | _pending_ | 转租 (need pointed tip) |
| 8 | 转租 key v6 (pointed tip) | _pending_ | 转租 ("太丑了，搜搜常用设计") |
| 9 | 转租 key v7 (Lucide diagonal) | _pending_ | 转租 (still bad — change metaphor) |
| 10 | 转租 alternatives (bed / for-rent sign) | _resolved_ | Eric: reuse `home-regular` via aliasing — no new SVG |

**Final lock 2026-05-11: 43 names / 52 SVG variants accepted.**

---

## After all icons accepted

When Eric signs off on round N, OpenCode will:
1. Read this file
2. Extract each `'name-weight': \`<svg>...</svg>\`,` block from the "Accepted" sections
3. Paste them into `app/src/components/icons/registry.ts` exports object
4. Generate `app/src/components/UIcon.vue` (per SPEC §2.1)
5. Generate `app/src/components/UButton.vue` (per SPEC §2.3)
6. Generate preview HTML at `docs/v3-p2-component-preview.html`
7. Three-green check + handoff to Eric for push

The "Pending" section will be emptied by then. The "Round history" section gets archived as the audit trail.

---

## Notes for future sessions

- chat-Claude in a new session can resume by reading this file alone — no need to re-derive any accepted icon
- when adding new icons mid-stream, draft them inline in chat first (via mcp__visualize__show_widget), THEN append to "Accepted" once Eric signs off
- when redrawing rejected icons, replace the entry in "Pending" with new candidates (preserved in chat history), and only move to "Accepted" upon explicit Eric approval
- the `briefcase` removal is intentional and should NOT be re-added (Eric said it's personal state not a chrome icon)
