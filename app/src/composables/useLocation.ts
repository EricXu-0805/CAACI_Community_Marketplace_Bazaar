import { ref } from 'vue'

/*
 * Result type for detectLocation().
 *
 * Phase 1a fix for iOS Safari silent-fail: callers previously got back
 * an empty string '' for any failure (no permission, timeout, geocode
 * miss, etc), which made it impossible to surface a useful toast. The
 * discriminated union forces callers to handle each failure reason
 * explicitly. Phase 1b will use the same shape to drive a permission-
 * recovery modal — keeping the full reason list here (including
 * permission_prompt_dismissed and unsupported, which Phase 1a does
 * not yet emit) avoids a type change when that lands.
 */
export type LocationResult =
  | { ok: true; location: string }
  | {
      ok: false
      reason:
        | 'permission_denied'
        | 'permission_prompt_dismissed'
        | 'position_unavailable'
        | 'timeout'
        | 'geocode_failed'
        | 'unsupported'
    }

const cachedLocation = ref('')

/*
 * Map a uni.getLocation failure (or H5 navigator.geolocation rejection)
 * to a LocationResult.reason. Different platforms surface different
 * error shapes:
 *   - mp-weixin: { errMsg: 'getLocation:fail auth deny' | ':fail timeout' | ... }
 *   - mp-weixin: { errCode: number } sometimes alongside errMsg
 *   - H5 (uni's polyfill over navigator.geolocation): { code: 1|2|3,
 *     message: 'User denied Geolocation' } shape leaks through
 *
 * Match generously on substrings; default to position_unavailable so
 * the user always sees *some* toast rather than nothing. The H5 code-1
 * case covers both true site-denied and "user dismissed the prompt"
 * since the W3C spec collapses them into the same PositionError; Phase
 * 1b will distinguish via a state machine using navigator.permissions.
 */
function classifyLocationError(
  err: unknown,
): Exclude<LocationResult, { ok: true }>['reason'] {
  const e = err as
    | { code?: number; errMsg?: string; errCode?: number; message?: string }
    | undefined
  const code = e?.code ?? e?.errCode
  const text = `${e?.errMsg ?? ''} ${e?.message ?? ''}`.toLowerCase()

  if (code === 1) return 'permission_denied'
  if (code === 3) return 'timeout'
  if (code === 2) return 'position_unavailable'

  if (/deni|deny|permission|auth/.test(text)) return 'permission_denied'
  if (/timeout/.test(text)) return 'timeout'
  if (/unavailable|unsupport/.test(text)) return 'position_unavailable'

  return 'position_unavailable'
}

export function useLocation() {
  const detecting = ref(false)

  async function detectLocation(): Promise<LocationResult> {
    if (cachedLocation.value) {
      return { ok: true, location: cachedLocation.value }
    }

    /*
     * Guard against runtimes where uni.getLocation is unavailable (rare
     * — happens in some embedded webviews and on quickapp). Surface as
     * 'unsupported' so the caller can show a distinct message instead
     * of a generic "location failed" toast.
     */
    if (typeof uni === 'undefined' || typeof uni.getLocation !== 'function') {
      return { ok: false, reason: 'unsupported' }
    }

    /*
     * H5 permission preflight. On iOS Safari + Android Chrome a
     * previously denied site-level permission causes
     * navigator.geolocation.getCurrentPosition to reject *immediately*
     * with code 1 — same shape as a fresh deny — making the failure
     * indistinguishable. Querying permissions.state lets us
     * short-circuit denied state without waking the geolocation
     * subsystem and emit 'permission_denied' to the caller.
     *
     * Safe to no-op on mp-weixin (no navigator global) and on older
     * browsers without Permissions API (typeof check + try/catch).
     */
    try {
      const permsApi = (typeof navigator !== 'undefined' ? navigator.permissions : undefined) as
        | {
            query: (q: { name: 'geolocation' }) => Promise<{
              state: 'granted' | 'denied' | 'prompt'
            }>
          }
        | undefined
      if (permsApi?.query) {
        const status = await permsApi.query({ name: 'geolocation' })
        if (status.state === 'denied') {
          return { ok: false, reason: 'permission_denied' }
        }
      }
    } catch {
      /* Permissions API itself failed — fall through to getLocation. */
    }

    detecting.value = true
    try {
      const res: UniApp.GetLocationSuccess = await new Promise((resolve, reject) => {
        uni.getLocation({
          type: 'wgs84',
          success: resolve,
          fail: reject,
        })
      })

      const name = await reverseGeocode(res.latitude, res.longitude)
      /*
       * reverseGeocode returns `string | null` post-Phase-1b: a real
       * geocoded address, or null when Nominatim missed / threw. The
       * old `precise || city || 'UIUC'` literal-string fallback was a
       * Phase-1a TODO (see 2026-05-23 audit anomaly A3) — Phase 1b
       * cashes in the promise of a typed-null contract. Anyone
       * receiving { ok: true, location } can trust it's a real
       * building/road/city label, never the project's default-handle
       * string. The geocode_failed reason fires only for true Nominatim
       * misses (null) or empty strings.
       */
      if (!name) {
        return { ok: false, reason: 'geocode_failed' }
      }
      cachedLocation.value = name
      return { ok: true, location: name }
    } catch (err) {
      return { ok: false, reason: classifyLocationError(err) }
    } finally {
      detecting.value = false
    }
  }

  async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
    try {
      /*
       * QA6 #12 — go through our own /api/geocode proxy instead of hitting
       * Nominatim from the browser. A direct browser call failed three ways:
       * the CSP connect-src blocks nominatim.openstreetmap.org, Nominatim 403s
       * requests without a User-Agent (browsers can't set one), and it sends
       * no CORS header. The proxy is same-origin ('self'), sets a compliant UA
       * server-side, and returns the raw `address` object so the cascade below
       * is unchanged. mp-weixin is a deferred target with no same-origin proxy,
       * so it keeps the direct call (the `email=` param is its best effort).
       */
      let url = ''
      // #ifdef H5
      url = `${typeof window !== 'undefined' ? window.location.origin : ''}/api/geocode?lat=${lat}&lon=${lng}`
      // #endif
      // #ifndef H5
      url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=18&addressdetails=1&email=illini.market.help@gmail.com`
      // #endif

      const data: any = await new Promise((resolve, reject) => {
        uni.request({
          url,
          header: { 'Accept-Language': 'en' },
          success: (res) => {
            // Bot-block / rate-limit / error JSON: anything non-200 or without
            // an address block is treated as a miss → coarse fallback below.
            if (res.statusCode && res.statusCode !== 200) { resolve(null); return }
            resolve(res.data)
          },
          fail: reject,
        })
      })

      const addr = (data && data.address) || {}

      const building = addr.building || addr.amenity || addr.shop || addr.university || addr.school
      const road = addr.road || addr.street || addr.pedestrian
      const houseNum = addr.house_number
      const neighborhood = addr.neighbourhood || addr.suburb
      const city = addr.city || addr.town || addr.village || addr.hamlet || addr.county
      const region = addr.state || addr.region || addr.county

      const parts: string[] = []
      if (building) parts.push(building)
      if (houseNum && road) parts.push(`${houseNum} ${road}`)
      else if (road) parts.push(road)
      if (neighborhood && parts.length === 0) parts.push(neighborhood)
      if (city && parts.length < 2) parts.push(city)

      const precise = parts.slice(0, 2).join(', ')
      // #4: a real coordinate must always resolve to *some* usable label so
      // "use current location" works anywhere, not just when a fine address
      // hits. Fall through precise → city → region → a coarse lat,lng so the
      // detect basically never returns geocode_failed for a valid fix.
      return precise || city || region || `${lat.toFixed(3)}, ${lng.toFixed(3)}`
    } catch {
      return null
    }
  }

  return { cachedLocation, detecting, detectLocation }
}
