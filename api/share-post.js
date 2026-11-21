import {
  deploymentBoundaryResponse,
  evaluateDeploymentBoundary,
  isNonProductionDeployment,
} from './_deployment-boundary.js'

export const config = { runtime: 'edge' }

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const SUPABASE_ANON_KEY = process.env.SUPABASE_PUBLISHABLE_KEY
  || process.env.SUPABASE_ANON_KEY
  || process.env.VITE_SUPABASE_PUBLISHABLE_KEY
  || process.env.VITE_SUPABASE_ANON_KEY
  || ''
const PUBLIC_SITE_RAW = process.env.DEPLOYMENT_APP_ORIGIN
  || process.env.SHARE_SITE_URL
  || process.env.DIGEST_APP_URL
  || ''

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_PUBLIC_RESPONSE_BYTES = 64 * 1024

function supabaseHeaders(key, authorization = '', extra = {}) {
  const headers = { apikey: key, ...extra }
  if (authorization) headers.Authorization = authorization
  else if (!/^sb_(?:publishable|secret)_/.test(key)) headers.Authorization = `Bearer ${key}`
  return headers
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}

function safeOrigin(raw, fallback = '') {
  try {
    const parsed = new URL(raw)
    if (parsed.protocol === 'https:' || (parsed.protocol === 'http:' && parsed.hostname === 'localhost')) {
      return parsed.origin
    }
  } catch {}
  return fallback
}

const SUPABASE_ORIGIN = safeOrigin(SUPABASE_URL, '')

// String#slice counts UTF-16 units, so a cut can land between the two halves
// of an emoji and leave a lone surrogate — U+FFFD once the response is encoded.
function truncate(s, max) {
  const cut = s.slice(0, max)
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut
}

// The apex 308-redirects to www, so a canonical on the configured apex origin
// costs every share click an extra hop. Use the www form when that is the host
// the request actually arrived on.
function canonicalSite(configured, requestUrl) {
  const host = new URL(configured).hostname
  if (requestUrl.protocol === 'https:' && requestUrl.hostname === `www.${host}`) return requestUrl.origin
  return configured
}

function safeImageUrl(value, fallback, siteOrigin) {
  if (typeof value !== 'string' || !value) return fallback
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'https:') return fallback
    if (parsed.origin !== SUPABASE_ORIGIN && parsed.origin !== siteOrigin) return fallback
    return parsed.toString()
  } catch {
    return fallback
  }
}

async function readPublicRows(path) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: supabaseHeaders(SUPABASE_ANON_KEY, '', {
        Accept: 'application/json',
      }),
      redirect: 'manual',
      signal: controller.signal,
    })
    if (!response.ok || response.redirected) {
      await response.body?.cancel().catch(() => {})
      return []
    }
    const declared = response.headers.get('content-length')
    if (declared != null && (!/^\d+$/.test(declared) || Number(declared) > MAX_PUBLIC_RESPONSE_BYTES)) {
      await response.body?.cancel().catch(() => {})
      return []
    }
    if (!response.body) return []
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let total = 0
    let raw = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_PUBLIC_RESPONSE_BYTES) {
        await reader.cancel().catch(() => {})
        return []
      }
      raw += decoder.decode(value, { stream: true })
    }
    raw += decoder.decode()
    let rows
    try { rows = JSON.parse(raw) } catch { return [] }
    return Array.isArray(rows) ? rows : []
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
}

function responseHeaders(boundary) {
  const headers = {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'public, max-age=60, s-maxage=300',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src https:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
  }
  if (isNonProductionDeployment(boundary)) {
    headers['x-robots-tag'] = 'noindex, nofollow, noarchive'
  }
  return headers
}

async function responseForRequest(req, boundary) {
  const deploymentError = deploymentBoundaryResponse(boundary)
  if (deploymentError) return deploymentError
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: {
        ...responseHeaders(boundary),
        allow: 'GET, HEAD',
        'cache-control': 'no-store, max-age=0',
      },
    })
  }
  const url = new URL(req.url)
  const rawId = url.searchParams.get('id')
  const id = UUID_RE.test(rawId || '') ? rawId : null
  const site = canonicalSite(boundary.appOrigin || safeOrigin(PUBLIC_SITE_RAW, url.origin), url)

  let post = null
  let authorName = ''
  if (id && SUPABASE_URL && SUPABASE_ANON_KEY) {
    const rows = await readPublicRows(
      `posts_visible?id=eq.${encodeURIComponent(id)}`
      + '&select=id,content,images,user_id,source_lang,title&limit=1',
    )
    post = rows[0] || null
    if (post?.user_id && UUID_RE.test(post.user_id)) {
      const profiles = await readPublicRows(
        `profiles?id=eq.${encodeURIComponent(post.user_id)}&select=nickname&limit=1`,
      )
      authorName = typeof profiles[0]?.nickname === 'string' ? profiles[0].nickname : ''
    }
  }

  const firstLine = truncate((post?.content || '').split('\n')[0], 60) || '玉米地 · 社区'
  const topicTitle = typeof post?.title === 'string' ? post.title.trim() : ''
  const headline = topicTitle ? truncate(topicTitle, 120) : firstLine
  const title = post ? `${headline} — ${authorName || 'User'}` : '玉米地 · 社区'
  const desc = post ? (truncate(post.content || '', 160) || 'A post on Cornfield') : 'Chinese community in Illinois, now open in Champaign-Urbana. 伊利诺伊华人论坛，现开放香槟地区。'
  const fallbackImage = `${site}/static/app-icon-512.png`
  const image = safeImageUrl(post?.images?.[0], fallbackImage, site)
  const destination = id ? `${site}/#/pages/post/index?id=${id}` : site
  const canonical = id ? `${site}/share-post/${id}` : site
  const escapedCanonical = escapeHtml(canonical)

  const docLang = new Set(['zh', 'en', 'ja', 'ko', 'zh-Hant']).has(post?.source_lang) ? post.source_lang : 'en'
  const html = `<!DOCTYPE html>
<html lang="${docLang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" type="image/png" href="${site}/static/app-icon-192.png">
<link rel="apple-touch-icon" href="${site}/static/app-icon-512.png">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(desc)}">
<link rel="canonical" href="${escapedCanonical}">
<meta property="og:type" content="article">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(desc)}">
<meta property="og:image" content="${escapeHtml(image)}">
<meta property="og:image:alt" content="${escapeHtml(title)}">
<meta property="og:url" content="${escapedCanonical}">
<meta property="og:site_name" content="玉米地 Cornfield">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(desc)}">
<meta name="twitter:image" content="${escapeHtml(image)}">
<meta http-equiv="refresh" content="0; url=${escapeHtml(destination)}">
<style>body{margin:0;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f2f2f7;color:#636366}</style>
</head>
<body><p lang="en">Loading Cornfield...</p></body>
</html>`

  return new Response(html, {
    status: 200,
    headers: responseHeaders(boundary),
  })
}

export default async function handler(req) {
  const boundary = evaluateDeploymentBoundary({ supabaseUrl: SUPABASE_URL })
  const response = await responseForRequest(req, boundary)
  if (req.method !== 'HEAD') return response
  return new Response(null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}
