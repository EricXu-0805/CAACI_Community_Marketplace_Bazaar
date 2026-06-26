/**
 * Icon registry — inline SVG strings keyed by `{name}-{weight}`.
 *
 * Style guide:
 * - 24x24 viewBox
 * - Regular: stroke 1.8, fill: none, stroke: currentColor, round linecap/linejoin
 * - Filled: fill: currentColor, no stroke (multi-tone detail = evenodd knockout
 *   so it reads as the background, never a hard-coded color — tints anywhere)
 *
 * 45 icon names, 54 total SVG variants. Some have regular + filled weight pair
 * (tab bar, content actions). Others stroke-only (utility, categories, etc).
 *
 * Aliases note: the search-page sublease category chip should use
 * `home-regular` (not duplicated into the registry).
 *
 * Design round 2 — Eric-approved 2026-06-12 (direction A): bumped to a more
 * confident 1.8 stroke and friendlier geometry; signature glyphs (home, plaza,
 * messages, profile, bell, heart) redrawn with a touch more character while
 * staying geometric + on the warm palette. Edit paths only with a fresh round.
 */

export type IconName =
  | 'home' | 'plaza' | 'messages' | 'profile'
  | 'heart' | 'chat-bubble' | 'bell' | 'tag' | 'lightbulb'
  | 'back' | 'share' | 'image' | 'video' | 'search' | 'filter' | 'plus' | 'close' | 'check'
  | 'more-horizontal' | 'more-vertical' | 'chevron-right' | 'chevron-left'
  | 'coffee' | 'graduation'
  | 'history' | 'user-plus' | 'bookmark' | 'layout-grid'
  | 'edit' | 'flag' | 'location-pin' | 'settings' | 'shield' | 'arrow-up' | 'reserved'
  | 'cat-currency' | 'cat-electronics' | 'cat-furniture' | 'cat-clothing' | 'cat-books'
  | 'cat-transport' | 'cat-daily' | 'cat-food' | 'cat-other'
  | 'forward' | 'send'
  | 'sun' | 'moon'

export type IconWeight = 'regular' | 'filled'

export const ICONS: Record<string, string> = {
  // Tab bar — 4 names × 2 weights
  'home-regular':     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 11.5 12 4.2l8.5 7.3"/><path d="M5.5 10.2V19a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-8.8"/><path d="M9.7 20v-4.6a1 1 0 0 1 1-1h2.6a1 1 0 0 1 1 1V20"/></svg>`,
  'home-filled':      `<svg viewBox="0 0 24 24" fill="currentColor" fill-rule="evenodd"><path d="M12 3.4 2.6 11.6c-.5.4-.2 1.2.4 1.2H5V19a1.4 1.4 0 0 0 1.4 1.4H9.6V15a1 1 0 0 1 1-1h2.8a1 1 0 0 1 1 1v5.4h3.2A1.4 1.4 0 0 0 19 19v-6.2h2c.6 0 .9-.8.4-1.2z"/></svg>`,
  'plaza-regular':    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.2" y="5.2" width="17.6" height="13.6" rx="3"/><path d="M7.2 9.6h9.6"/><path d="M7.2 13.4h6"/></svg>`,
  'plaza-filled':     `<svg viewBox="0 0 24 24" fill="currentColor" fill-rule="evenodd"><path d="M5.2 5.2h13.6a3 3 0 0 1 3 3v7.6a3 3 0 0 1-3 3H5.2a3 3 0 0 1-3-3V8.2a3 3 0 0 1 3-3zM7.2 9.6h9.6v1.6H7.2zM7.2 13.4h6V15H7.2z"/></svg>`,
  'messages-regular': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 11.6c0 4.4-3.9 7.9-8.5 7.9a9.3 9.3 0 0 1-3.3-.6L4 20l1.2-4.3a7.6 7.6 0 0 1-1.2-4.1c0-4.4 3.9-7.9 8.5-7.9s8 3.5 8 7.9z"/><circle cx="9" cy="11.7" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="11.7" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="11.7" r="1" fill="currentColor" stroke="none"/></svg>`,
  'messages-filled':  `<svg viewBox="0 0 24 24" fill="currentColor" fill-rule="evenodd"><path d="M20.5 11.6c0 4.4-3.9 7.9-8.5 7.9a9.3 9.3 0 0 1-3.3-.6L4 20l1.2-4.3a7.6 7.6 0 0 1-1.2-4.1c0-4.4 3.9-7.9 8.5-7.9s8 3.5 8 7.9zM8 11.7a1 1 0 1 0 2 0 1 1 0 0 0-2 0zM11 11.7a1 1 0 1 0 2 0 1 1 0 0 0-2 0zM14 11.7a1 1 0 1 0 2 0 1 1 0 0 0-2 0z"/></svg>`,
  'profile-regular':  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8.2" r="3.8"/><path d="M5 20v-.6c0-3.5 3.1-5.6 7-5.6s7 2.1 7 5.6V20"/></svg>`,
  'profile-filled':   `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="8.2" r="3.8"/><path d="M5 20v-.6c0-3.5 3.1-5.6 7-5.6s7 2.1 7 5.6V20z"/></svg>`,

  // Content actions — 5 names × 2 weights
  'heart-regular':       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20.6 4.3 13a5 5 0 0 1 7-7.1l.7.7.7-.7a5 5 0 0 1 7 7.1z"/></svg>`,
  'heart-filled':        `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 20.6 4.3 13a5 5 0 0 1 7-7.1l.7.7.7-.7a5 5 0 0 1 7 7.1z"/></svg>`,
  'chat-bubble-regular': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 14.5a2.5 2.5 0 0 1-2.5 2.5H7.5L3 21V5.5A2.5 2.5 0 0 1 5.5 3h13A2.5 2.5 0 0 1 21 5.5z"/></svg>`,
  'chat-bubble-filled':  `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 14.5a2.5 2.5 0 0 1-2.5 2.5H7.5L3 21V5.5A2.5 2.5 0 0 1 5.5 3h13A2.5 2.5 0 0 1 21 5.5z"/></svg>`,
  'bell-regular':        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6.2 9.5a5.8 5.8 0 0 1 11.6 0c0 5.4 2.4 7.2 2.6 7.4H3.6c.2-.2 2.6-2 2.6-7.4z"/><path d="M10.2 20.4a2 2 0 0 0 3.6 0"/></svg>`,
  'bell-filled':         `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6.2 9.5a5.8 5.8 0 0 1 11.6 0c0 5.4 2.4 7.2 2.6 7.4H3.6c.2-.2 2.6-2 2.6-7.4z"/><path d="M10.2 20.4a2 2 0 0 0 3.6 0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/></svg>`,
  'tag-regular':         `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41 13.41 20.6a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><circle cx="7" cy="7" r="1.5"/></svg>`,
  'tag-filled':          `<svg viewBox="0 0 24 24" fill="currentColor" fill-rule="evenodd"><path d="M20.59 13.41 13.41 20.6a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82zM7 5.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z"/></svg>`,
  'lightbulb-regular':   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.4.3.6.7.6 1.2v1.1c0 .6.4 1 1 1h4.8c.6 0 1-.4 1-1V16c0-.5.3-.9.6-1.2A7 7 0 0 0 12 2z"/></svg>`,
  'lightbulb-filled':    `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a7 7 0 0 0-4 12.7c.4.3.6.7.6 1.2v1.1c0 .6.4 1 1 1h4.8c.6 0 1-.4 1-1V16c0-.5.3-.9.6-1.2A7 7 0 0 0 12 2z"/><path d="M9 18.5h6v1.5H9zM10 21h4v1h-4z"/></svg>`,

  // Utility — 11 stroke-only
  'back-regular':            `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>`,
  // QA6 r6: the box+up-arrow (iOS share) read as a bare "↑" and confused users
  // ("看不懂"). Swapped for the universal 3-node share glyph (two dots linked to
  // a third) — unmistakably "share / 转发".
  'share-regular':           `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4"/><path d="m15.4 6.5-6.8 4"/></svg>`,
  'image-regular':           `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.8"/><path d="m21 15-5-5L5 21"/></svg>`,
  'video-regular':           `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="6.5" width="13" height="11" rx="2.5"/><path d="m15.5 10.5 6-3.5v10l-6-3.5"/></svg>`,
  'search-regular':          `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="10.6" cy="10.6" r="6.8"/><path d="m20.4 20.4-4.6-4.6"/></svg>`,
  'filter-regular':          `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M7 12h10"/><path d="M10 18h4"/></svg>`,
  'plus-regular':            `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4.6v14.8"/><path d="M4.6 12h14.8"/></svg>`,
  'close-regular':           `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`,
  'check-regular':           `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>`,
  'more-horizontal-regular': `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="19" cy="12" r="1.9"/></svg>`,
  'more-vertical-regular':   `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="12" cy="19" r="1.9"/></svg>`,
  'chevron-right-regular':   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>`,
  'chevron-left-regular':    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m15 6-6 6 6 6"/></svg>`,

  // Emoji replacements — 2 stroke-only
  'coffee-regular':     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 8h1a4 4 0 1 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z"/><path d="M6 2v2"/><path d="M10 2v2"/><path d="M14 2v2"/></svg>`,
  'graduation-regular': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10 12 4 2 10l10 6 10-6z"/><path d="M6 12v5c0 1.5 3 3 6 3s6-1.5 6-3v-5"/></svg>`,

  // Profile quick-actions — 4 stroke-only
  'history-regular':     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></svg>`,
  'user-plus-regular':   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="4"/><path d="M2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 5 2.7"/><path d="M19 13v6"/><path d="M16 16h6"/></svg>`,
  'bookmark-regular':    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`,
  'layout-grid-regular': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>`,

  // Detail/profile chrome — 7 stroke-only
  'edit-regular':         `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/><path d="M15 5l4 4"/></svg>`,
  'flag-regular':         `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21V4h12l-2 4 2 4H4"/></svg>`,
  'location-pin-regular': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-7.5-7-12a7 7 0 0 1 14 0c0 4.5-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/></svg>`,
  'settings-regular':     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6 1.65 1.65 0 0 0 10 3.09V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
  'shield-regular':       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
  'arrow-up-regular':     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>`,
  'send-regular':         `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/></svg>`,
  'reserved-regular':     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3v18l6-4 6 4V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z"/><circle cx="12" cy="8" r="3"/></svg>`,

  // Product categories — 9 stroke-only (sublease aliases to home — NOT a separate registry key)
  'cat-currency-regular':    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h13"/><path d="m13 5 3 3-3 3"/><path d="M21 16H8"/><path d="m11 13-3 3 3 3"/></svg>`,
  'cat-electronics-regular': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M10 6h4"/><path d="M11 19h2"/></svg>`,
  'cat-furniture-regular':   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 14a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3H3z"/><path d="M5 12V8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v4"/><path d="M5 17v2M19 17v2"/></svg>`,
  'cat-clothing-regular':    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m20 8-4-4-4 2-4-2-4 4 3 3v9h10v-9z"/></svg>`,
  'cat-books-regular':       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`,
  'cat-transport-regular':   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/></svg>`,
  'cat-daily-regular':       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h18l-1.5 13H4.5z"/><path d="M8 8V5a4 4 0 0 1 8 0v3"/></svg>`,
  'cat-food-regular':        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 13a9 9 0 0 0 18 0v-1H3z"/><path d="M7 8c0-1 1-2 2-2"/><path d="M11 8c0-1 1-2 2-2"/><path d="M15 8c0-1 1-2 2-2"/></svg>`,
  'cat-other-regular':       `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="6" cy="6" r="1.6"/><circle cx="12" cy="6" r="1.6"/><circle cx="18" cy="6" r="1.6"/><circle cx="6" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18" cy="12" r="1.6"/><circle cx="6" cy="18" r="1.6"/><circle cx="12" cy="18" r="1.6"/><circle cx="18" cy="18" r="1.6"/></svg>`,

  // Plaza interactions — 1 stroke-only
  'forward-regular': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5l6 6-6 6v-4c-4 0-8 1-10 5 0-6 4-9 10-9z"/></svg>`,

  // Theme toggle — 2 stroke-only
  'sun-regular':  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`,
  'moon-regular': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>`,
}
