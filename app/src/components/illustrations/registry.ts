/**
 * Empty-state illustrations — inline SVG strings keyed by name.
 *
 * Warm line-art set (Eric-approved 2026-06-12). Lines use `currentColor` so
 * they adapt per theme (muted ink on light, cream on dark); the terracotta
 * accent (#C74A2F) is baked in and reads on both. 120×120 viewBox, ~3px
 * stroke for presence at the ~130px display size. Rendered by UEmptyArt.vue,
 * which sets the wrapper color (H5 v-html; mp-weixin gracefully renders the
 * solid line via the same fallback path as UIcon).
 */
export const ILLUSTRATIONS: Record<string, string> = {
  // Marketplace / "my listings" empty — a market tote with a price tag inside.
  bag: `<svg viewBox="0 0 120 120" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M32 46h56l-5.4 55a8 8 0 0 1-8 7.2H45.4a8 8 0 0 1-8-7.2z"/><path d="M45 46v-7a15 15 0 0 1 30 0v7"/><g stroke="#C74A2F"><path d="M55 71h8.5a3 3 0 0 1 2.1.9l9.5 9.5a3 3 0 0 1 0 4.2l-5.9 5.9a3 3 0 0 1-4.2 0l-9.5-9.5a3 3 0 0 1-.9-2.1z"/><circle cx="62" cy="78" r="2.4"/></g></svg>`,

  // No search results — a magnifier with a quiet terracotta dash inside.
  search: `<svg viewBox="0 0 120 120" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="52" cy="52" r="27"/><path d="M72 72l17 17"/><path stroke="#C74A2F" d="M43 52h18"/></svg>`,

  // No messages — two overlapping speech bubbles, the second in terracotta.
  messages: `<svg viewBox="0 0 120 120" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M22 42a8 8 0 0 1 8-8h34a8 8 0 0 1 8 8v16a8 8 0 0 1-8 8H42l-12 9.5V66a8 8 0 0 1-8-8z"/><path stroke="#C74A2F" d="M60 64a7 7 0 0 1 7-7h21a7 7 0 0 1 7 7v13a7 7 0 0 1-7 7v8.5L74 84H67a7 7 0 0 1-7-7z"/></svg>`,

  // No favorites — a paper price tag with a heart (the concept piece).
  favorites: `<svg viewBox="0 0 120 120" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><g transform="rotate(-10 60 58)" stroke="currentColor"><path d="M38 40h27a5 5 0 0 1 3.5 1.5l24.5 24.5a5 5 0 0 1 0 7L75 90.5a5 5 0 0 1-7 0L43.5 66A5 5 0 0 1 42 62.5z"/><circle cx="52" cy="54" r="4.2"/></g><path stroke="#C74A2F" d="M55 76c0-4.2 3.1-6.8 6.4-6.8 2.3 0 3.9 1.4 5.1 2.9 1.2-1.5 2.8-2.9 5.1-2.9 3.3 0 6.4 2.6 6.4 6.8 0 5-6.9 9.9-11.5 13-4.6-3.1-11.5-8-11.5-13z"/></svg>`,

  // Empty plaza feed — a pinned notice board.
  posts: `<svg viewBox="0 0 120 120" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><rect x="26" y="34" width="68" height="54" rx="7"/><path d="M26 50h68"/><path d="M60 34v-7"/><circle cx="60" cy="24" r="3.4" stroke="#C74A2F"/><path stroke="#C74A2F" d="M38 63h30M38 74h18"/></svg>`,

  // Empty follow / nobody followed — a person with a heart.
  following: `<svg viewBox="0 0 120 120" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="48" cy="46" r="14"/><path d="M26 92v-2c0-13 10-21 22-21s22 8 22 21v2"/><path stroke="#C74A2F" d="M80 40c0-3.6 2.7-5.9 5.6-5.9 2 0 3.4 1.2 4.4 2.5 1-1.3 2.4-2.5 4.4-2.5 2.9 0 5.6 2.3 5.6 5.9 0 4.4-6 8.5-10 11.2-4-2.7-10-6.8-10-11.2z"/></svg>`,

  // Browsing history empty — a clock.
  history: `<svg viewBox="0 0 120 120" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="60" cy="60" r="30"/><path stroke="#C74A2F" d="M60 42v18l12 8"/></svg>`,
}
