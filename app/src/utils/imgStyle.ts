/**
 * Image styling helpers driven by DB-persisted image dimensions.
 *
 * Migration 014 introduced items.image_dimensions / posts.image_dimensions
 * (jsonb array of `{ w, h }`) so cards can reserve slot-accurate space on
 * the FIRST paint — no more layout jumps while real images decode.
 *
 * Prior to this helper the column was being written but never read: SELECTs
 * returned it in a subset of queries, and templates ignored it entirely,
 * meaning every card reserved a guess (or worse, naturalWidth-measured on
 * @load after CLS already happened). See _ai_notes/IMAGE_PIPELINE_*.md.
 *
 * Usage:
 *   :style="dimsToAspectStyle(item.image_dimensions, 0)"
 *   :style="dimsToAspectStyle(post.image_dimensions, i, '1/1')"
 */
import type { ImageDim } from '../types'

/**
 * Produce a single-property CSS aspect-ratio style for an image slot.
 *
 * Unknown / missing dimensions fall back to `fallback` (default 4/5, the
 * small-red-book vertical-portrait ratio). Extreme ratios are clamped to
 * [0.4, 2.5] so a freak 9000×300 panorama can't stretch a feed cell wider
 * than a ~2.5:1 letterbox (the spec sweet spot for card grids).
 *
 * @param dims     image_dimensions array from DB, or null/undefined
 * @param idx      index into the dims array (0 for single-image, i for grid)
 * @param fallback aspect-ratio string when dims[idx] is missing / 0
 */
export function dimsToAspectStyle(
  dims: ImageDim[] | null | undefined,
  idx = 0,
  fallback = '4/5'
): Record<string, string> {
  const d = dims?.[idx]
  if (!d || !d.w || !d.h) return { 'aspect-ratio': fallback }
  const r = Math.max(0.4, Math.min(d.w / d.h, 2.5))
  return { 'aspect-ratio': String(r) }
}

/**
 * Read the natural pixel size from an image-load event.
 *
 * Used as a render-side safety net when DB-persisted image_dimensions
 * are empty: pages measure on @load and patch a local Ref so the
 * subsequent re-render reserves the correct aspect-ratio slot. DB
 * values ALWAYS win — pages call this only when dims[idx] is missing.
 *
 * Two event shapes in play:
 *   · H5 native <img>   → e.target.naturalWidth / naturalHeight
 *   · uni-app <image>   → e.detail.width / height
 * Returns null when neither source yields a positive w/h (e.g. the
 * image 404'd, or a 0×0 SVG) so callers can skip the patch.
 */
export function readNaturalDims(e: any): ImageDim | null {
  const t = e?.target
  const d = e?.detail
  const w = Number(t?.naturalWidth) || Number(d?.width) || 0
  const h = Number(t?.naturalHeight) || Number(d?.height) || 0
  if (w > 0 && h > 0) return { w, h }
  return null
}
