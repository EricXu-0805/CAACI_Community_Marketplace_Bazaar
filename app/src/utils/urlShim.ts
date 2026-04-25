/*
 * Minimal Web-API shims for WeChat mini-program JSCore.
 *
 * Three constructors that supabase-js needs but mp's JSCore lacks:
 *
 *   · URL              — used by validateSupabaseUrl + endpoint
 *                        construction (auth/v1, rest/v1, etc).
 *   · Headers          — used by fetchWithAuth to merge apikey +
 *                        Authorization onto every outgoing request.
 *                        Without it: ReferenceError on createClient.
 *   · AbortController  — used by realtime, functions, and webauthn
 *                        for request cancellation. Without it:
 *                        ReferenceError when realtime channels are
 *                        instantiated or RPCs are timed out.
 *
 * Source-of-truth grep against node_modules/@supabase/* found these
 * three plus URLSearchParams (handled by the Vite rewrite plugin so
 * the bare-identifier call sites don't fail). No Request/Response/
 * Event constructor uses surface in production paths we exercise.
 *
 * Activation: call installMpWebApiShim() once before importing any
 * @supabase package. Idempotent. Force-installs every time on mp
 * (no probe — DevTools' globalThis.URL probe-success was a false
 * positive; the bare-identifier call site inside vendor.js still
 * failed). H5 and Node bypass this whole module via #ifdef MP-WEIXIN.
 *
 * Sized to fit: ~3 KB minified. Intentionally NOT WHATWG-compliant
 * for edge cases — covers ONLY what supabase-js actually invokes.
 * Future missing API: extend here with a probe + minimal class.
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

class MiniURLSearchParams {
  private pairs: Array<[string, string]>

  constructor(init?: any) {
    this.pairs = []
    if (!init) return
    if (typeof init === 'string') {
      const s = init.startsWith('?') ? init.slice(1) : init
      if (!s) return
      for (const part of s.split('&')) {
        if (!part) continue
        const eq = part.indexOf('=')
        const k = eq >= 0 ? part.slice(0, eq) : part
        const v = eq >= 0 ? part.slice(eq + 1) : ''
        try {
          this.pairs.push([decodeURIComponent(k), decodeURIComponent(v)])
        } catch {
          this.pairs.push([k, v])
        }
      }
      return
    }
    if (init instanceof MiniURLSearchParams) {
      this.pairs = init.pairs.slice()
      return
    }
    if (Array.isArray(init)) {
      for (const pair of init) {
        if (Array.isArray(pair) && pair.length >= 2) {
          this.pairs.push([String(pair[0]), String(pair[1])])
        }
      }
      return
    }
    if (typeof init === 'object') {
      for (const key of Object.keys(init)) {
        const value = (init as any)[key]
        if (value !== undefined && value !== null) {
          this.pairs.push([key, String(value)])
        }
      }
    }
  }

  set(name: string, value: string): void {
    const k = String(name)
    this.pairs = this.pairs.filter((p) => p[0] !== k)
    this.pairs.push([k, String(value)])
  }

  append(name: string, value: string): void {
    this.pairs.push([String(name), String(value)])
  }

  get(name: string): string | null {
    const k = String(name)
    for (const pair of this.pairs) {
      if (pair[0] === k) return pair[1]
    }
    return null
  }

  getAll(name: string): string[] {
    const k = String(name)
    return this.pairs.filter((p) => p[0] === k).map((p) => p[1])
  }

  has(name: string): boolean {
    const k = String(name)
    return this.pairs.some((p) => p[0] === k)
  }

  delete(name: string): void {
    const k = String(name)
    this.pairs = this.pairs.filter((p) => p[0] !== k)
  }

  forEach(
    cb: (value: string, key: string, parent: MiniURLSearchParams) => void,
    thisArg?: any,
  ): void {
    for (const pair of this.pairs) {
      cb.call(thisArg, pair[1], pair[0], this)
    }
  }

  toString(): string {
    return this.pairs
      .map(
        ([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v),
      )
      .join('&')
  }

  *entries(): IterableIterator<[string, string]> {
    for (const pair of this.pairs) yield [pair[0], pair[1]]
  }

  *keys(): IterableIterator<string> {
    for (const pair of this.pairs) yield pair[0]
  }

  *values(): IterableIterator<string> {
    for (const pair of this.pairs) yield pair[1]
  }
}

class MiniURL {
  protocol: string
  hostname: string
  host: string
  port: string
  pathname: string
  hash: string
  searchParams: MiniURLSearchParams

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
    this.hash = parsed.hash
    this.searchParams = new MiniURLSearchParams(parsed.search)
  }

  get search(): string {
    const s = this.searchParams.toString()
    return s ? '?' + s : ''
  }

  set search(value: string) {
    this.searchParams = new MiniURLSearchParams(value || '')
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

class MiniHeaders {
  private map: Record<string, string>

  constructor(init?: any) {
    this.map = {}
    if (!init) return
    if (init instanceof MiniHeaders) {
      this.map = { ...init.map }
      return
    }
    if (Array.isArray(init)) {
      for (const pair of init) {
        if (Array.isArray(pair) && pair.length >= 2) {
          this.set(String(pair[0]), String(pair[1]))
        }
      }
      return
    }
    if (typeof init.forEach === 'function') {
      init.forEach((value: any, key: any) => {
        this.set(String(key), String(value))
      })
      return
    }
    if (typeof init === 'object') {
      for (const key of Object.keys(init)) {
        const value = (init as any)[key]
        if (value !== undefined && value !== null) {
          this.set(String(key), String(value))
        }
      }
    }
  }

  has(name: string): boolean {
    return name.toLowerCase() in this.map
  }

  get(name: string): string | null {
    const v = this.map[name.toLowerCase()]
    return v === undefined ? null : v
  }

  set(name: string, value: string): void {
    this.map[name.toLowerCase()] = String(value)
  }

  append(name: string, value: string): void {
    const key = name.toLowerCase()
    const existing = this.map[key]
    this.map[key] = existing ? existing + ', ' + String(value) : String(value)
  }

  delete(name: string): void {
    delete this.map[name.toLowerCase()]
  }

  forEach(
    cb: (value: string, key: string, parent: MiniHeaders) => void,
    thisArg?: any,
  ): void {
    for (const key of Object.keys(this.map)) {
      cb.call(thisArg, this.map[key], key, this)
    }
  }

  *entries(): IterableIterator<[string, string]> {
    for (const key of Object.keys(this.map)) {
      yield [key, this.map[key]]
    }
  }

  *keys(): IterableIterator<string> {
    for (const key of Object.keys(this.map)) yield key
  }

  *values(): IterableIterator<string> {
    for (const key of Object.keys(this.map)) yield this.map[key]
  }
}

class MiniAbortSignal {
  aborted = false
  reason: any = undefined
  private listeners: Array<(ev: any) => void> = []
  onabort: ((ev: any) => void) | null = null

  addEventListener(type: string, cb: (ev: any) => void): void {
    if (type !== 'abort' || typeof cb !== 'function') return
    this.listeners.push(cb)
  }

  removeEventListener(type: string, cb: (ev: any) => void): void {
    if (type !== 'abort') return
    const idx = this.listeners.indexOf(cb)
    if (idx >= 0) this.listeners.splice(idx, 1)
  }

  dispatchAbort(reason: any): void {
    if (this.aborted) return
    this.aborted = true
    this.reason = reason
    const ev = { type: 'abort', target: this }
    for (const cb of this.listeners.slice()) {
      try {
        cb(ev)
      } catch {}
    }
    if (typeof this.onabort === 'function') {
      try {
        this.onabort(ev)
      } catch {}
    }
  }

  throwIfAborted(): void {
    if (this.aborted) {
      const err = this.reason ?? new Error('aborted')
      throw err
    }
  }
}

class MiniAbortController {
  signal: MiniAbortSignal

  constructor() {
    this.signal = new MiniAbortSignal()
  }

  abort(reason?: any): void {
    this.signal.dispatchAbort(reason)
  }
}

let installed = false

export function installMpWebApiShim(): void {
  if (installed) return
  installed = true

  const g = globalThis as any

  g.URL = MiniURL as unknown as typeof URL
  g.URLSearchParams = MiniURLSearchParams as unknown as typeof URLSearchParams
  g.Headers = MiniHeaders as unknown as typeof Headers
  g.AbortController = MiniAbortController as unknown as typeof AbortController
  g.AbortSignal = MiniAbortSignal as unknown as typeof AbortSignal

  for (const handle of ['global', 'window', 'self']) {
    try {
      if (typeof g[handle] !== 'undefined') {
        g[handle].URL = MiniURL
        g[handle].URLSearchParams = MiniURLSearchParams
        g[handle].Headers = MiniHeaders
        g[handle].AbortController = MiniAbortController
        g[handle].AbortSignal = MiniAbortSignal
      }
    } catch {}
  }

  try {
    console.warn(
      '[mpShim] installed URL/URLSearchParams/Headers/AbortController on globalThis',
    )
  } catch {}
}

export const installUrlShim = installMpWebApiShim
