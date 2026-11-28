import type { Page } from '@playwright/test'

const STUB_ORIGINS = new Set([
  'https://00000000000000000000.supabase.co',
  'https://ci-stub.supabase.co',
  'https://pre-push-stub.supabase.co',
])

export function stubBackendEnabled(
  supabaseUrl: string,
  environment: Readonly<Record<string, string | undefined>>,
): boolean {
  return STUB_ORIGINS.has(new URL(supabaseUrl).origin) && environment.GITHUB_ACTIONS !== 'true'
}

export interface StubBackend {
  readonly origin: string
  readonly tables: ReadonlySet<string>
  // Values are serialized JSON response bodies, indexed by exact RPC name.
  readonly rpc: ReadonlyMap<string, string>
}

export function stubSocketMatches(url: URL, origin: string): boolean {
  return url.origin === origin.replace(/^https:/, 'wss:')
}

export async function installStubBackend(page: Page, errs: string[], backend: StubBackend): Promise<ReadonlySet<string>> {
  const served = new Set<string>()
  await page.route(url => url.origin === backend.origin, async route => {
    const request = route.request()
    const method = request.method()
    const path = new URL(request.url()).pathname
    const table = /^\/rest\/v1\/([^/]+)$/.exec(path)?.[1]
    if (table && backend.tables.has(table)) {
      if (method === 'HEAD') {
        served.add(table)
        await route.fulfill({
          status: 200,
          headers: { 'content-range': '*/0', 'access-control-expose-headers': 'content-range' },
          body: '',
        })
        return
      }
      if (method === 'GET') {
        served.add(table)
        if (request.headers().accept?.includes('application/vnd.pgrst.object+json')) {
          await route.fulfill({
            status: 406,
            json: {
              code: 'PGRST116',
              details: 'The result contains 0 rows',
              hint: null,
              message: 'Cannot coerce the result to a single JSON object',
            },
          })
        } else {
          await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
        }
        return
      }
    }
    const rpc = /^\/rest\/v1\/rpc\/([^/]+)$/.exec(path)?.[1]
    const body = rpc && method === 'POST' ? backend.rpc.get(rpc) : undefined
    if (body !== undefined) {
      served.add(`rpc:${rpc}`)
      await route.fulfill({ status: 200, contentType: 'application/json', body })
      return
    }
    errs.push(`unstubbed ${method} ${path}`)
    await route.fulfill({ status: 501, json: { message: 'No smoke fixture for this request' } })
  })
  await page.routeWebSocket(url => stubSocketMatches(url, backend.origin), async socket => {
    const path = new URL(socket.url()).pathname
    if (path === '/realtime/v1/websocket') served.add('ws:realtime')
    else errs.push(`unstubbed WS ${path}`)
    await socket.close({ code: 1000, reason: 'smoke stub' })
  })
  return served
}
