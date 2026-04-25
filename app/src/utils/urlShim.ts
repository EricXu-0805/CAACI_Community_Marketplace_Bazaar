/*
 * Minimal URL constructor shim for WeChat mini-program JSCore.
 *
 * Why this file exists:
 *   @supabase/supabase-js >=2.49.5 calls `new URL(supabaseUrl)` inside
 *   validateSupabaseUrl() during createClient(). On WeChat mp's JSCore
 *   the global URL constructor either doesn't exist OR isn't reachable
 *   via bare-identifier lookup (it may exist on globalThis but bare
 *   `URL` resolves to undefined). Result: every cold start threw
 *     `Error: Invalid supabaseUrl: Provided URL is malformed.`
 *   from validateSupabaseUrl's try/catch. Vue's setup() bailed,
 *   mp-weixin still mounted the template, every {{ binding }}
 *   rendered as undefined → page shell visible but NO TEXT.
 *   Two days of "blank text on mp-weixin" was this single missing API.
 *
 * What this implements: ONLY the URL surface that supabase-js touches:
 *   · `new URL(absoluteUrl)`              — absolute parse
 *   · `new URL(relativePath, baseURL)`    — base+relative resolve
 *   · `.protocol` (read + write)          — used to swap http→ws
 *   · `.hostname`                         — split('.')[0] for storageKey
 *   · `.href`                             — final string for fetch URLs
 *   · `.pathname`, `.search`, `.hash`,
 *     `.host`, `.port`, `.origin`         — completeness for any other
 *                                            transitive supabase code
 *
 * What this does NOT implement (intentionally — keeps the shim tiny):
 *   · `.searchParams`                     — supabase doesn't use it at
 *                                            client-init time, and our
 *                                            mpFetch shim handles all
 *                                            actual HTTP queries
 *   · username/password authority         — supabase URLs never have them
 *   · IDN / unicode hostname normalization — supabase URLs are ASCII
 *   · WHATWG-spec edge cases              — not needed for our use
 *
 * Why not `core-js/web/url` or `whatwg-url`:
 *   · core-js URL is ~40 KB gzip — significant for a 1.2 MB mp budget
 *   · whatwg-url is much heavier and pulls in IDN tables
 *   · `url-polyfill` (npm) only attaches to global/window/self/this and
 *     mp-weixin's runtime has none of those — IIFE receives undefined
 *     and the assignment silently fails, so it's a no-op on mp.
 *   · This shim is ~80 lines, attaches to globalThis explicitly, and
 *     covers the exact supabase-js surface verified against
 *     node_modules/@supabase/supabase-js/dist/main/SupabaseClient.js.
 *
 * Activation: call installUrlShim() exactly once before
 * @supabase/supabase-js is imported. Idempotent — repeat calls
 * short-circuit. No-op when a working native URL is detected (so H5
 * and Node never pay the cost; conditional compilation also gates it).
 */

const ABS_URL_RE = /^([a-z][a-z0-9+.-]*:)\/\/([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/i

interface ParsedUrl {
  protocol: string
  host: string
  hostname: string
  port: string
  pathname: string
  search: string
  hash: string
}

function parseAbsolute(url: string): ParsedUrl {
  const m = ABS_URL_RE.exec(url)
  if (!m) throw new TypeError('Invalid URL: ' + url)
  const protocol = m[1].toLowerCase()
  const authority = m[2] || ''
  const pathRaw = m[3] || ''
  const search = m[4] || ''
  const hash = m[5] || ''
  const colonIdx = authority.lastIndexOf(':')
  const hostname = colonIdx >= 0 ? authority.slice(0, colonIdx) : authority
  const port = colonIdx >= 0 ? authority.slice(colonIdx + 1) : ''
  return {
    protocol,
    host: authority,
    hostname,
    port,
    pathname: pathRaw || '/',
    search,
    hash,
  }
}

function resolveRelative(rel: string, baseHref: string): string {
  if (ABS_URL_RE.test(rel)) return rel
  const baseParsed = parseAbsolute(baseHref)
  const baseDir =
    baseParsed.pathname.endsWith('/')
      ? baseParsed.pathname
      : baseParsed.pathname.replace(/\/[^/]*$/, '/') || '/'
  let path: string
  if (rel.startsWith('/')) path = rel
  else if (!rel) path = baseDir
  else path = baseDir + rel
  return baseParsed.protocol + '//' + baseParsed.host + path
}

class MiniURL {
  protocol: string
  hostname: string
  host: string
  port: string
  pathname: string
  search: string
  hash: string

  constructor(input: string, base?: string | MiniURL) {
    let resolved: string
    if (base !== undefined && base !== null) {
      const baseHref =
        typeof base === 'string' ? base : (base as MiniURL).href
      resolved = resolveRelative(String(input), baseHref)
    } else {
      resolved = String(input)
    }
    const parsed = parseAbsolute(resolved)
    this.protocol = parsed.protocol
    this.hostname = parsed.hostname
    this.host = parsed.host
    this.port = parsed.port
    this.pathname = parsed.pathname
    this.search = parsed.search
    this.hash = parsed.hash
  }

  get href(): string {
    return (
      this.protocol +
      '//' +
      this.host +
      this.pathname +
      this.search +
      this.hash
    )
  }

  get origin(): string {
    return this.protocol + '//' + this.host
  }

  toString(): string {
    return this.href
  }

  toJSON(): string {
    return this.href
  }
}

let installed = false

export function installUrlShim(): void {
  if (installed) return
  installed = true

  const g = globalThis as any

  /*
   * Force-install on every mp build, no probing. WeChat DevTools
   * on 3.15.x has a quirk where `globalThis.URL` *appears* to work
   * (probe succeeds) but the bare-identifier `URL` lookup inside
   * vendor.js (where supabase-js lives) still fails. Probing native
   * therefore false-positives and skips installation, leaving the
   * actual call site broken.
   *
   * This entry point is only reached from #ifdef MP-WEIXIN code in
   * useSupabase.ts, so we know we're on a mp platform here. Always
   * overwrite globalThis.URL with our shim — it's WHATWG-subset-
   * compliant for supabase-js's needs and 1.5 KB minified, so the
   * cost of overriding even when native works is negligible.
   *
   * Also assign onto common alternate global handles in case the mp
   * runtime exposes URL via a different path (legacy `wx.URL`,
   * uni-vendor injected `globalContext`, etc).
   */
  g.URL = MiniURL as unknown as typeof URL
  try {
    if (typeof g.global !== 'undefined') g.global.URL = MiniURL
  } catch {}
  try {
    if (typeof g.window !== 'undefined') g.window.URL = MiniURL
  } catch {}
  try {
    if (typeof g.self !== 'undefined') g.self.URL = MiniURL
  } catch {}

  try {
    console.warn('[urlShim] installed MiniURL on globalThis.URL')
  } catch {}
}
