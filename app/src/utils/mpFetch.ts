/*
 * WeChat mini-program `fetch` shim.
 *
 * Supabase-js speaks fetch(). WeChat mp has no DOM and no fetch —
 * only wx.request / uni.request. This file produces a function with
 * fetch's signature that internally adapts to uni.request.
 *
 * Scope and known limitations (read before extending):
 *
 *   · REST only. This shim handles GET/POST/PATCH/DELETE against
 *     Supabase's PostgREST and GoTrue endpoints. That covers every
 *     current app feature EXCEPT Supabase Realtime.
 *
 *   · Supabase Realtime (WebSockets) is NOT handled here. WeChat mp
 *     has wx.connectSocket but the Phoenix channel handshake used
 *     by supabase-realtime-js does not round-trip cleanly through
 *     it. The app degrades to polling for the chat tab on mp; see
 *     docs/WECHAT_MP_SETUP.md §3 for the current plan.
 *
 *   · Streaming responses (readable-stream body) are NOT supported.
 *     Supabase returns small JSON payloads so this is fine today.
 *
 *   · Response.clone() and Response.body are stubbed; only .text(),
 *     .json(), .status, .ok, and .headers.get() are guaranteed —
 *     which is everything supabase-js actually uses.
 */

interface UniRequestTask {
  abort?: () => void
}

export function makeMpFetch(): typeof fetch {
  // #ifdef MP-WEIXIN || MP-QQ || MP-BAIDU || MP-ALIPAY || MP-TOUTIAO
  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : (input as Request).url
    const method = (init?.method || 'GET').toUpperCase() as any
    const headers: Record<string, string> = {}

    if (init?.headers) {
      const h = init.headers as any
      if (typeof h.forEach === 'function') {
        h.forEach((v: string, k: string) => { headers[k] = v })
      } else {
        Object.assign(headers, h)
      }
    }

    let body: any = init?.body
    if (body && typeof body !== 'string' && !(body instanceof ArrayBuffer)) {
      try { body = JSON.stringify(body) } catch {}
    }

    return new Promise<Response>((resolve, reject) => {
      const task: UniRequestTask | void = uni.request({
        url,
        method,
        header: headers,
        data: body,
        dataType: '_no_intercept_',
        responseType: 'text',
        timeout: 25000,
        success: (res: any) => {
          const rawBody = typeof res.data === 'string' ? res.data : JSON.stringify(res.data)
          const respHeaders = new Map<string, string>()
          Object.entries(res.header || {}).forEach(([k, v]) => {
            respHeaders.set(String(k).toLowerCase(), String(v))
          })
          const response = {
            status: res.statusCode,
            statusText: '',
            ok: res.statusCode >= 200 && res.statusCode < 300,
            url,
            redirected: false,
            type: 'default' as ResponseType,
            headers: {
              get: (k: string) => respHeaders.get(String(k).toLowerCase()) ?? null,
              has: (k: string) => respHeaders.has(String(k).toLowerCase()),
              forEach: (cb: (value: string, key: string) => void) =>
                respHeaders.forEach((v, k) => cb(v, k)),
              entries: () => respHeaders.entries(),
              keys: () => respHeaders.keys(),
              values: () => respHeaders.values(),
              append: () => {},
              set: () => {},
              delete: () => {},
            } as unknown as Headers,
            body: null,
            bodyUsed: false,
            clone: function () { return this },
            text: () => Promise.resolve(rawBody),
            json: () => {
              try { return Promise.resolve(JSON.parse(rawBody)) }
              catch (e) { return Promise.reject(e) }
            },
            arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
            blob: () => Promise.reject(new Error('blob not supported on mp')),
            formData: () => Promise.reject(new Error('formData not supported on mp')),
          } as unknown as Response
          resolve(response)
        },
        fail: (err: any) => {
          reject(new Error(err?.errMsg || 'mp_fetch_failed'))
        },
      })

      if (init?.signal && task && typeof task.abort === 'function') {
        const onAbort = () => { try { task.abort!() } catch {} }
        if (init.signal.aborted) onAbort()
        else init.signal.addEventListener('abort', onAbort)
      }
    })
  }
  return impl as unknown as typeof fetch
  // #endif
  // #ifndef MP-WEIXIN || MP-QQ || MP-BAIDU || MP-ALIPAY || MP-TOUTIAO
  return globalThis.fetch.bind(globalThis)
  // #endif
}
