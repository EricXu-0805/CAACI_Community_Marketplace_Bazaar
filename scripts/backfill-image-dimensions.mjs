#!/usr/bin/env node
/*
 * One-shot backfill: populate items.image_dimensions + posts.image_dimensions
 * for rows that predate migration 014, or that were created during the
 * window where trg_enforce_actor was blocking all INSERTs (migration 027
 * → 033). The client-side Phase 1/2 pipeline handles all NEW writes, and
 * STEP 1 onLoad fallback handles display for legacy rows — this script is
 * the "polish pass" that eliminates the onLoad CLS on those legacy rows.
 *
 * Strategy:
 *   1. Query items / posts with image_dimensions = [] AND images.length > 0
 *   2. For each row, for each image URL, fetch the first ~64KB (enough for
 *      JPEG/PNG/WEBP headers) and parse dimensions manually
 *   3. UPDATE the row with the resolved dims array
 *
 * Manual header parsing avoids any npm install. All Supabase-stored
 * uploads are JPEGs (compressImage output), so 99% of the logic is JPEG;
 * PNG/WEBP handlers are there as safety nets.
 *
 * Usage:
 *   export SUPABASE_URL=https://<project>.supabase.co
 *   export SUPABASE_SERVICE_ROLE_KEY=<service_role_key_from_dashboard>
 *   node scripts/backfill-image-dimensions.mjs          # dry-run first (no writes)
 *   node scripts/backfill-image-dimensions.mjs --apply  # actually write
 *
 * Get the service role key from:
 *   Supabase Dashboard → Project Settings → API → service_role (secret)
 * Do NOT commit it. Export in shell only for the duration of this run.
 */

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY
const APPLY = process.argv.includes('--apply')

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error('Missing env: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  console.error('Dashboard → Project Settings → API → service_role (secret)')
  process.exit(1)
}

const REST = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1`
const HEADERS = {
  apikey: SERVICE_ROLE,
  Authorization: `Bearer ${SERVICE_ROLE}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
}

// ---------------------------------------------------------------------
// JPEG / PNG / WEBP dimension parsers (manual, zero deps)
// ---------------------------------------------------------------------

/**
 * JPEG structure: SOI (FF D8) then segments. Each segment is FF XX
 * followed by a 2-byte big-endian length. SOFn markers (C0-CF except
 * C4, C8, CC) carry the image dimensions in the payload:
 *   [length 2B][precision 1B][height 2B][width 2B][components 1B]
 */
function parseJpeg(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null
  let i = 2
  while (i < buf.length - 8) {
    if (buf[i] !== 0xff) {
      i++
      continue
    }
    const marker = buf[i + 1]
    i += 2
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue
    const isSOF = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isSOF) {
      const h = (buf[i + 3] << 8) | buf[i + 4]
      const w = (buf[i + 5] << 8) | buf[i + 6]
      if (w > 0 && h > 0) return { w, h }
      return null
    }
    const segLen = (buf[i] << 8) | buf[i + 1]
    if (segLen < 2) return null
    i += segLen
  }
  return null
}

/**
 * PNG: 8-byte signature then IHDR chunk at fixed offset:
 *   [0..7]   signature 89 50 4E 47 0D 0A 1A 0A
 *   [8..11]  IHDR chunk length (always 13)
 *   [12..15] "IHDR"
 *   [16..19] width (big-endian)
 *   [20..23] height (big-endian)
 */
function parsePng(buf) {
  if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) return null
  const w = buf.readUInt32BE(16)
  const h = buf.readUInt32BE(20)
  if (w > 0 && h > 0) return { w, h }
  return null
}

/**
 * WEBP: RIFF container. Layout at start:
 *   [0..3]   "RIFF"
 *   [4..7]   file size
 *   [8..11]  "WEBP"
 *   [12..15] chunk type ("VP8 " | "VP8L" | "VP8X")
 * Dimension read depends on chunk type.
 */
function parseWebp(buf) {
  if (buf[0] !== 0x52 || buf[1] !== 0x49 || buf[2] !== 0x46 || buf[3] !== 0x46) return null
  if (buf[8] !== 0x57 || buf[9] !== 0x45 || buf[10] !== 0x42 || buf[11] !== 0x50) return null
  const chunk = buf.toString('ascii', 12, 16)
  if (chunk === 'VP8X') {
    const w = (buf[24] | (buf[25] << 8) | (buf[26] << 16)) + 1
    const h = (buf[27] | (buf[28] << 8) | (buf[29] << 16)) + 1
    return { w, h }
  }
  if (chunk === 'VP8 ') {
    const w = buf.readUInt16LE(26) & 0x3fff
    const h = buf.readUInt16LE(28) & 0x3fff
    return { w, h }
  }
  if (chunk === 'VP8L') {
    const bits = buf.readUInt32LE(21)
    return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 }
  }
  return null
}

async function fetchDims(url) {
  try {
    const res = await fetch(url, { headers: { Range: 'bytes=0-65535' } })
    if (!res.ok && res.status !== 206) {
      return { error: `HTTP ${res.status}`, w: 0, h: 0 }
    }
    const buf = Buffer.from(await res.arrayBuffer())
    const dim = parseJpeg(buf) || parsePng(buf) || parseWebp(buf)
    if (!dim) return { error: 'unparseable', w: 0, h: 0 }
    return dim
  } catch (e) {
    return { error: String(e), w: 0, h: 0 }
  }
}

// ---------------------------------------------------------------------
// Supabase REST helpers
// ---------------------------------------------------------------------

async function fetchRows(table) {
  const url = `${REST}/${table}?select=id,images,image_dimensions&image_dimensions=eq.%5B%5D`
  const res = await fetch(url, { headers: HEADERS })
  if (!res.ok) throw new Error(`GET ${table} → ${res.status}: ${await res.text()}`)
  return await res.json()
}

async function updateRow(table, id, dims) {
  const url = `${REST}/${table}?id=eq.${id}`
  const res = await fetch(url, {
    method: 'PATCH',
    headers: HEADERS,
    body: JSON.stringify({ image_dimensions: dims }),
  })
  if (!res.ok) throw new Error(`PATCH ${table}/${id} → ${res.status}: ${await res.text()}`)
  return await res.json()
}

// ---------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------

async function processTable(table) {
  const rows = await fetchRows(table)
  console.log(`\n[${table}] ${rows.length} row(s) with empty image_dimensions`)

  let updated = 0
  let skipped = 0
  let failed = 0

  for (const row of rows) {
    const images = Array.isArray(row.images) ? row.images : []
    if (images.length === 0) {
      skipped++
      continue
    }
    const dims = []
    for (const url of images) {
      const d = await fetchDims(url)
      if (d.error) {
        console.warn(`  [${row.id}] image ${url.slice(-40)} → ${d.error}`)
        dims.push({ w: 0, h: 0 })
      } else {
        dims.push({ w: d.w, h: d.h })
      }
    }
    const hasValid = dims.some((d) => d.w > 0 && d.h > 0)
    if (!hasValid) {
      console.warn(`  [${row.id}] all ${images.length} image(s) unparseable, skipping`)
      failed++
      continue
    }
    if (APPLY) {
      try {
        await updateRow(table, row.id, dims)
        updated++
        console.log(`  ✓ [${row.id}] dims = ${JSON.stringify(dims)}`)
      } catch (e) {
        console.error(`  ✗ [${row.id}] update failed:`, e.message)
        failed++
      }
    } else {
      console.log(`  ○ [${row.id}] would patch dims = ${JSON.stringify(dims)}`)
      updated++
    }
  }

  console.log(`[${table}] ${APPLY ? 'updated' : 'would update'} ${updated}, skipped ${skipped}, failed ${failed}`)
}

;(async () => {
  console.log(APPLY ? '🚀 APPLY mode — writes will be committed' : '🔍 DRY-RUN — no writes (use --apply to commit)')
  await processTable('items')
  await processTable('posts')
  console.log('\nDone.')
})().catch((e) => {
  console.error('Fatal:', e)
  process.exit(1)
})
