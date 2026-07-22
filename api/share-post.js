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
      redirect: 'error',
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
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
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
  const site = boundary.appOrigin || safeOrigin(PUBLIC_SITE_RAW, url.origin)

  let post = null
  let authorName = ''
  if (id && SUPABASE_URL && SUPABASE_ANON_KEY) {
    const rows = await readPublicRows(
      `posts_visible?id=eq.${encodeURIComponent(id)}`
      + '&select=id,content,images,user_id&limit=1',
    )
    post = rows[0] || null
    if (post?.user_id && UUID_RE.test(post.user_id)) {
      const profiles = await readPublicRows(
        `profiles?id=eq.${encodeURIComponent(post.user_id)}&select=nickname&limit=1`,
      )
      authorName = typeof profiles[0]?.nickname === 'string' ? profiles[0].nickname : ''
    }
  }

  const firstLine = (post?.content || '').split('\n')[0].slice(0, 60) || 'Illini Market · 校园广场'
  const title = post ? `${firstLine} — ${authorName || '用户'}` : 'Illini Market · 校园广场'
  const desc = post ? (post.content?.slice(0, 160) || 'A post on Illini Market') : 'UIUC 校园广场 · Plaza'
  const fallbackImage = `${site}/static/app-icon-512.png`
  const image = safeImageUrl(post?.images?.[0], fallbackImage, site)
  const canonical = post ? `${site}/#/pages/post/index?id=${id}` : site
  const escapedCanonical = escapeHtml(canonical)

  const html = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(desc)}">
<link rel="canonical" href="${escapedCanonical}">
<meta property="og:type" content="article">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(desc)}">
<meta property="og:image" content="${escapeHtml(image)}">
<meta property="og:url" content="${escapedCanonical}">
<meta property="og:site_name" content="Illini Market">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(desc)}">
<meta name="twitter:image" content="${escapeHtml(image)}">
<meta http-equiv="refresh" content="0; url=${escapedCanonical}">
<style>body{margin:0;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f2f2f7;color:#636366}</style>
</head>
<body><p>Loading Illini Market...</p></body>
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
