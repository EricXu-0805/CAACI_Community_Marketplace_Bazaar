const LOOPBACK_HOST_RE = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i

function headerValue(headers, name) {
  const value = headers?.[name]
  if (Array.isArray(value)) return value[0] || ''
  return typeof value === 'string' ? value : ''
}

function sameLoopbackAuthority(value, requestHost) {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && LOOPBACK_HOST_RE.test(url.host)
      && url.host.toLowerCase() === requestHost.toLowerCase()
  } catch {
    return false
  }
}

/**
 * Vite 5.2.8 is pinned by the current Uni plugin release. That Vite line has
 * known development-server disclosure and launch-editor advisories, while the
 * latest Uni `vue3` tag still declares an exact `vite: 5.2.8` peer. Keep the
 * server loopback-only and reject browser cross-site requests before Vite's
 * own middleware sees them. Production bundles do not run this middleware.
 */
export function isAllowedDevRequest(request) {
  const host = headerValue(request?.headers, 'host').trim()
  if (!LOOPBACK_HOST_RE.test(host)) return false

  const target = typeof request?.url === 'string' ? request.url : ''
  if (/^\/__open-in-editor(?:[/?#]|$)/i.test(target)) return false

  const fetchSite = headerValue(request?.headers, 'sec-fetch-site').trim().toLowerCase()
  if (fetchSite === 'cross-site') return false

  const origin = headerValue(request?.headers, 'origin').trim()
  if (origin && !sameLoopbackAuthority(origin, host)) return false

  const referer = headerValue(request?.headers, 'referer').trim()
  if (referer && !sameLoopbackAuthority(referer, host)) return false

  return true
}

export function localDevServerBoundary() {
  return {
    name: 'local-dev-server-boundary',
    enforce: 'pre',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (isAllowedDevRequest(request)) {
          next()
          return
        }
        response.statusCode = 403
        response.setHeader('Cache-Control', 'no-store')
        response.setHeader('Content-Type', 'text/plain; charset=utf-8')
        response.end('Forbidden')
      })
    },
  }
}
