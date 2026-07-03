export const config = { runtime: 'edge' }

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}

export default async function handler(req) {
  const url = new URL(req.url)
  const rawId = url.searchParams.get('id')
  const id = UUID_RE.test(rawId || '') ? rawId : null
  const site = url.origin

  let item = null
  if (id && SUPABASE_URL && SUPABASE_ANON_KEY) {
    try {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/items?id=eq.${encodeURIComponent(id)}&select=id,title,description,price,images,listing_type&limit=1`,
        { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
      )
      const rows = await r.json()
      item = rows?.[0] || null
    } catch {}
  }

  // Price label: a wanted/ISO post's `price` is a budget (often 0) and a free
  // sell item is price 0 — neither should render a bare "$0".
  const priceLabel = !item ? ''
    : item.listing_type === 'wanted'
      ? (item.price > 0 ? `求购预算 $${item.price}` : '求购 · 预算面议')
      : (item.price > 0 ? `$${item.price}` : '免费 Free')
  const namePrefix = item && item.listing_type === 'wanted' ? '求购 / Looking for: ' : ''
  const title = item ? `${namePrefix}${item.title} · ${priceLabel}` : 'Illini Market · 校园二手交易'
  const desc = item ? (item.description?.slice(0, 160) || `${priceLabel} on Illini Market`) : 'UIUC 校园二手交易平台'
  const image = item?.images?.[0] || `${site}/static/app-icon-512.png`
  const canonical = item ? `${site}/#/pages/detail/index?id=${id}` : site

  const html = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(desc)}">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="product">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(desc)}">
<meta property="og:image" content="${escapeHtml(image)}">
<meta property="og:url" content="${canonical}">
<meta property="og:site_name" content="Illini Market">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(desc)}">
<meta name="twitter:image" content="${escapeHtml(image)}">
<meta http-equiv="refresh" content="0; url=${canonical}">
<style>body{margin:0;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f2f2f7;color:#636366}</style>
</head>
<body><p>Loading Illini Market...</p></body>
</html>`

  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=60, s-maxage=300',
    },
  })
}
