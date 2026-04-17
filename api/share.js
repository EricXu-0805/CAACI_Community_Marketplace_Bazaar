export const config = { runtime: 'edge' }

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://lfhvgprfphyfvhidegum.supabase.co'
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}

export default async function handler(req) {
  const url = new URL(req.url)
  const id = url.searchParams.get('id')
  const site = url.origin

  let item = null
  if (id && SUPABASE_ANON_KEY) {
    try {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/items?id=eq.${id}&select=id,title,description,price,images&limit=1`,
        { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
      )
      const rows = await r.json()
      item = rows?.[0] || null
    } catch {}
  }

  const title = item ? `${item.title} · $${item.price}` : 'Illini Market · 校园二手交易'
  const desc = item ? (item.description?.slice(0, 160) || `$${item.price} on Illini Market`) : 'UIUC 校园二手交易平台'
  const image = item?.images?.[0] || `${site}/static/placeholder.png`
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
