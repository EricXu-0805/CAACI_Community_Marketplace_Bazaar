/*
 * Supabase's 2026 API-key model separates the application component key
 * (`apikey`) from a signed-in user's JWT (`Authorization: Bearer`). Legacy
 * anon/service_role keys are themselves JWTs, while sb_publishable/sb_secret
 * keys are opaque and must not be treated as user JWTs.
 */

export function isOpaqueSupabaseApiKey(value: string): boolean {
  return /^sb_(?:publishable|secret)_/.test(value)
}

export function preferredSupabasePublicKey(
  publishableKey: string | undefined,
  legacyAnonKey: string | undefined,
): string {
  const preferred = publishableKey || ''
  const fallback = legacyAnonKey || ''
  if (preferred && !/^sb_secret_/.test(preferred)) return preferred
  if (fallback && !/^sb_secret_/.test(fallback)) return fallback
  return ''
}

/**
 * supabase-js 2.103.3 still emits `Authorization: Bearer <project-key>` when
 * there is no user session. Supabase currently keeps an exact-match backward
 * compatibility exception, but the documented new-key contract is apikey-only.
 * Strip only that exact opaque-key fallback; a real user JWT is preserved.
 */
export function withSupabaseApiKeySemantics(fetchImpl: typeof fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (!init?.headers) return fetchImpl(input, init)

    const headers = new Headers(init.headers)
    const apiKey = headers.get('apikey') || ''
    const authorization = headers.get('authorization') || ''
    if (
      isOpaqueSupabaseApiKey(apiKey)
      && authorization === `Bearer ${apiKey}`
    ) {
      headers.delete('authorization')
    }

    return fetchImpl(input, { ...init, headers })
  }) as typeof fetch
}
