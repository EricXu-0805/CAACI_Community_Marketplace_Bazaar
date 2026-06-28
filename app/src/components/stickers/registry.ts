/**
 * Sticker registry — 16 self-drawn chunky SVGs per V3_VISUAL_REFRESH_SPEC §P3.1.
 *
 * Style guide:
 * - 32x32 viewBox, solid fills, rounded chunky shapes (NOT line-art —
 *   deliberately heavier than UIcon's stroke style)
 * - 2-tone from the token palette family: honey gold faces/hands with
 *   brown features, terracotta / sage / amber / navy accents
 * - 12 high-frequency essentials + 4 Illini Market campus-specific
 *
 * Stickers send as standalone chat messages via the `[sticker:<name>]`
 * text token (see chat/index.vue) — they are NOT unicode and never mix
 * into typed text.
 */

export type StickerName =
  | 'smile' | 'laugh' | 'love' | 'thumbs-up' | 'thumbs-down' | 'clap'
  | 'pray' | 'cry' | 'surprise' | 'sparkle' | 'fire' | 'question'
  | 'obo' | 'verified-pickup' | 'study-group'

// Palette (token family — keep in sync with App.vue tokens)
// honey #E8B84B · brown #6B3F1D · terracotta #C74A2F · deep #A33A22
// sage #5D7C4A · amber #D4923C · navy #13294B · cream #FBF6E8

export const STICKERS: Record<StickerName, string> = {
  'smile': `<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="13" fill="#E8B84B"/><circle cx="11" cy="13.5" r="1.9" fill="#6B3F1D"/><circle cx="21" cy="13.5" r="1.9" fill="#6B3F1D"/><path d="M10 19q6 5.6 12 0" fill="none" stroke="#6B3F1D" stroke-width="2.4" stroke-linecap="round"/></svg>`,

  'laugh': `<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="13" fill="#E8B84B"/><path d="M8.5 13q2.5-3 5 0" fill="none" stroke="#6B3F1D" stroke-width="2.2" stroke-linecap="round"/><path d="M18.5 13q2.5-3 5 0" fill="none" stroke="#6B3F1D" stroke-width="2.2" stroke-linecap="round"/><path d="M9.5 18h13a6.5 6.5 0 0 1-13 0z" fill="#6B3F1D"/><path d="M12 21.8a8.5 8.5 0 0 0 8 0 6 6 0 0 0-8 0z" fill="#FBF6E8"/></svg>`,

  'love': `<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="13" fill="#E8B84B"/><path d="M10.5 10.2c-1.5-1.7-4.3-.7-4.3 1.5 0 1.8 2.4 3.4 4.3 4.8 1.9-1.4 4.3-3 4.3-4.8 0-2.2-2.8-3.2-4.3-1.5z" fill="#C74A2F"/><path d="M21.5 10.2c-1.5-1.7-4.3-.7-4.3 1.5 0 1.8 2.4 3.4 4.3 4.8 1.9-1.4 4.3-3 4.3-4.8 0-2.2-2.8-3.2-4.3-1.5z" fill="#C74A2F"/><path d="M11.5 21q4.5 4 9 0" fill="none" stroke="#6B3F1D" stroke-width="2.4" stroke-linecap="round"/></svg>`,

  'thumbs-up': `<svg viewBox="0 0 32 32"><rect x="4" y="15" width="5" height="13" rx="2.2" fill="#13294B"/><path d="M12 28h9.5a3.2 3.2 0 0 0 3.2-3.2l1.2-7.2a3 3 0 0 0-3-3.6h-5.6l1.5-5.5a2.7 2.7 0 0 0-5.1-1.7L10 14.5V25a3 3 0 0 0 2 3z" fill="#E8B84B"/></svg>`,

  'thumbs-down': `<svg viewBox="0 0 32 32"><g transform="rotate(180 16 16)"><rect x="4" y="15" width="5" height="13" rx="2.2" fill="#13294B"/><path d="M12 28h9.5a3.2 3.2 0 0 0 3.2-3.2l1.2-7.2a3 3 0 0 0-3-3.6h-5.6l1.5-5.5a2.7 2.7 0 0 0-5.1-1.7L10 14.5V25a3 3 0 0 0 2 3z" fill="#E8B84B"/></g></svg>`,

  'clap': `<svg viewBox="0 0 32 32"><path d="M7 4.5 8.5 9M16 3v5M25 4.5 23.5 9" stroke="#D4923C" stroke-width="2.4" stroke-linecap="round" fill="none"/><path d="M9 14.5c4-3.5 8 .5 7 4l-3.5 8c-1 2.5-4.5 3-6.5 1s-2.5-5.5-1-8z" fill="#E8B84B" transform="rotate(-14 12 20)"/><path d="M23 14.5c-4-3.5-8 .5-7 4l3.5 8c1 2.5 4.5 3 6.5 1s2.5-5.5 1-8z" fill="#D4923C" transform="rotate(14 20 20)"/></svg>`,

  'pray': `<svg viewBox="0 0 32 32"><path d="M6.5 8 9 11M25.5 8 23 11" stroke="#D4923C" stroke-width="2.2" stroke-linecap="round" fill="none"/><path d="M15.2 5.5c-2.6 4-5.7 8.2-5.7 13.5a6.2 6.2 0 0 0 5.7 6.4z" fill="#E8B84B"/><path d="M16.8 5.5c2.6 4 5.7 8.2 5.7 13.5a6.2 6.2 0 0 1-5.7 6.4z" fill="#D4923C"/></svg>`,

  'cry': `<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="13" fill="#E8B84B"/><path d="M8.5 12.5q2.5-1.8 5 0M18.5 12.5q2.5-1.8 5 0" fill="none" stroke="#6B3F1D" stroke-width="2.2" stroke-linecap="round"/><circle cx="11" cy="15.5" r="1.7" fill="#6B3F1D"/><circle cx="21" cy="15.5" r="1.7" fill="#6B3F1D"/><path d="M11.5 22.5q4.5-3.6 9 0" fill="none" stroke="#6B3F1D" stroke-width="2.4" stroke-linecap="round"/><path d="M23.5 17c1.6 2.4 2.8 4.2 2.8 5.9a2.9 2.9 0 0 1-5.7 0c0-1.7 1.3-3.5 2.9-5.9z" fill="#13294B"/></svg>`,

  'surprise': `<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="13" fill="#E8B84B"/><path d="M8.5 9.5q2.5-2 5 0M18.5 9.5q2.5-2 5 0" fill="none" stroke="#6B3F1D" stroke-width="2" stroke-linecap="round"/><circle cx="11" cy="14" r="2.3" fill="#6B3F1D"/><circle cx="21" cy="14" r="2.3" fill="#6B3F1D"/><ellipse cx="16" cy="21.5" rx="3" ry="3.8" fill="#6B3F1D"/></svg>`,

  'sparkle': `<svg viewBox="0 0 32 32"><path d="M14 4l2.4 7.2L23.6 14l-7.2 2.8L14 24l-2.4-7.2L4.4 14l7.2-2.8z" fill="#D4923C"/><path d="M24 18l1.5 4 4 1.5-4 1.5-1.5 4-1.5-4-4-1.5 4-1.5z" fill="#C74A2F"/><circle cx="25" cy="7" r="2.2" fill="#E8B84B"/></svg>`,

  'fire': `<svg viewBox="0 0 32 32"><path d="M16 2.5c1.2 5.5-6.5 8-6.5 15a8.5 8.5 0 0 0 17 0c0-3.2-1.6-5.4-3.2-7.6 0 3.2-2.3 4.6-2.3 4.6 1.2-4.4-2-9-5-12z" fill="#C74A2F"/><path d="M16 15.5c2.2 2.6 3.4 4.2 3.4 6.3a4.1 4.1 0 0 1-8.2 0c0-3 2.6-4.2 4.8-6.3z" fill="#D4923C"/></svg>`,

  'question': `<svg viewBox="0 0 32 32"><path d="M10 11a6 6 0 1 1 8.6 5.4c-2 1-2.6 2-2.6 4.1" fill="none" stroke="#13294B" stroke-width="4.2" stroke-linecap="round"/><circle cx="16" cy="26.5" r="2.6" fill="#13294B"/></svg>`,

  'obo': `<svg viewBox="0 0 32 32"><path d="M3.8 13.2 13.2 3.8A3 3 0 0 1 15.3 3H25a4 4 0 0 1 4 4v9.7a3 3 0 0 1-.9 2.1l-9.4 9.4a4 4 0 0 1-5.6 0L3.8 18.8a4 4 0 0 1 0-5.6z" fill="#C74A2F"/><circle cx="23" cy="9" r="2.1" fill="#FBF6E8"/><text x="14" y="20.5" transform="rotate(-45 14 17)" text-anchor="middle" font-family="-apple-system,'Helvetica Neue',Arial,sans-serif" font-size="7.5" font-weight="800" fill="#FBF6E8">OBO</text></svg>`,

  'verified-pickup': `<svg viewBox="0 0 32 32"><path d="M16 2l3.1 2.3 3.8-.4 1.5 3.5 3.5 1.5-.4 3.8L29.8 16l-2.3 3.1.4 3.8-3.5 1.5-1.5 3.5-3.8-.4L16 29.8l-3.1-2.3-3.8.4-1.5-3.5-3.5-1.5.4-3.8L2.2 16l2.3-3.1-.4-3.8 3.5-1.5 1.5-3.5 3.8.4z" fill="#5D7C4A"/><circle cx="16" cy="16" r="9.5" fill="none" stroke="#FBF6E8" stroke-width="1.4"/><path d="m11.5 16.2 3.2 3.3 6-6.8" fill="none" stroke="#FBF6E8" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,

  'study-group': `<svg viewBox="0 0 32 32"><circle cx="8.5" cy="10.5" r="3" fill="#13294B"/><circle cx="23.5" cy="10.5" r="3" fill="#13294B"/><circle cx="16" cy="8" r="3.6" fill="#13294B"/><path d="M3.5 19a5 5 0 0 1 5-4.5 5 5 0 0 1 4.4 2.6M28.5 19a5 5 0 0 0-5-4.5 5 5 0 0 0-4.4 2.6M10.5 18.5a5.5 5.5 0 0 1 11 0" fill="none" stroke="#13294B" stroke-width="2.6" stroke-linecap="round"/><path d="M6 22.5q10-3.4 10 .8 0-4.2 10-.8v6q-10-3.4-10 .8 0-4.2-10-.8z" fill="#D4923C"/><path d="M16 23.3v6" stroke="#A66B1F" stroke-width="1.2"/></svg>`,
}

/** Panel display order — 12 expressives first, 4 campus tools last. */
export const STICKER_ORDER: StickerName[] = [
  'smile', 'laugh', 'love', 'thumbs-up', 'thumbs-down', 'clap',
  'pray', 'cry', 'surprise', 'sparkle', 'fire', 'question',
  'obo', 'verified-pickup', 'study-group',
]

const TOKEN_RE = /^\[sticker:([a-z-]+)\]$/

/** Parse a message body; returns the sticker name if the WHOLE body is one sticker token. */
export function parseStickerToken(content: string): StickerName | null {
  const m = TOKEN_RE.exec(content.trim())
  if (m && m[1] in STICKERS) return m[1] as StickerName
  return null
}

export function stickerToken(name: StickerName): string {
  return `[sticker:${name}]`
}
