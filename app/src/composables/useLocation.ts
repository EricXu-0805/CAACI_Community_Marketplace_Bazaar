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
       * reverseGeocode preserves its legacy `precise || city || 'UIUC'`
       * fallback (line 60 above the pre-refactor cutover) so existing
       * callers that imported it directly keep their contract.
       * detectLocation, however, treats the 'UIUC' sentinel as failure:
       * it's the documented fallback string from a Nominatim miss, NOT
       * a building-level resolution. Anyone receiving { ok: true } can
       * trust the location string is a real geocoded value. Phase 2
       * will replace the sentinel with a typed null return; flagged in
       * 2026-05-23 audit anomaly.
       */
      if (!name || name === 'UIUC') {
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

  async function reverseGeocode(lat: number, lng: number): Promise<string> {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=18&addressdetails=1`

      const data: any = await new Promise((resolve, reject) => {
        uni.request({
          url,
          header: { 'Accept-Language': 'en' },
          success: (res) => resolve(res.data),
          fail: reject,
        })
      })

      const addr = data.address || {}

      const building = addr.building || addr.amenity || addr.shop || addr.university || addr.school
      const road = addr.road || addr.street || addr.pedestrian
      const houseNum = addr.house_number
      const neighborhood = addr.neighbourhood || addr.suburb
      const city = addr.city || addr.town || addr.village || addr.hamlet || addr.county

      const parts: string[] = []
      if (building) parts.push(building)
      if (houseNum && road) parts.push(`${houseNum} ${road}`)
      else if (road) parts.push(road)
      if (neighborhood && parts.length === 0) parts.push(neighborhood)
      if (city && parts.length < 2) parts.push(city)

      const precise = parts.slice(0, 2).join(', ')
      return precise || city || 'UIUC'
    } catch {
      return 'UIUC'
    }
  }

  return { cachedLocation, detecting, detectLocation }
}
