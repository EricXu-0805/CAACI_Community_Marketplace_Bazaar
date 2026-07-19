import { ref } from 'vue'
import { BASE_URL } from '../config/runtime'
import { onAccountTransition } from './accountScope'

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
const detecting = ref(false)
const LOCATION_CACHE_TTL_MS = 5 * 60 * 1000
const LOCATION_FIX_TIMEOUT_MS = 15_000
const GEOCODE_REQUEST_TIMEOUT_MS = 8_000
let cachedLocationAt = 0
// This epoch is intentionally independent of account ids. A -> anonymous -> B
// and even two forced anonymous transitions must invalidate a device fix that
// was already in flight; identity equality alone is not an ownership proof.
let locationRequestGeneration = 0
let locationDetectionId = 0

// A location label is private device context. Never let a shared-device
// account switch reuse the previous user's result, and do not keep a stale
// location for the lifetime of a long-running app session.
onAccountTransition(() => {
  locationRequestGeneration += 1
  locationDetectionId += 1
  cachedLocation.value = ''
  cachedLocationAt = 0
  detecting.value = false
})

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
  async function detectLocation(): Promise<LocationResult> {
    const requestGeneration = locationRequestGeneration
    const detectionId = ++locationDetectionId
    const requestStillCurrent = () => (
      requestGeneration === locationRequestGeneration
      && detectionId === locationDetectionId
    )
    if (cachedLocation.value && Date.now() - cachedLocationAt < LOCATION_CACHE_TTL_MS) {
      return { ok: true, location: cachedLocation.value }
    }
    cachedLocation.value = ''
    cachedLocationAt = 0

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
        if (!requestStillCurrent()) return { ok: false, reason: 'position_unavailable' }
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
        let settled = false
        const timer = setTimeout(() => {
          if (settled) return
          settled = true
          reject({ code: 3, message: 'location deadline exceeded' })
        }, LOCATION_FIX_TIMEOUT_MS)
        uni.getLocation({
          type: 'wgs84',
          success: (value) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            resolve(value)
          },
          fail: (error) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            reject(error)
          },
        })
      })

      const name = await reverseGeocode(res.latitude, res.longitude)
      if (!requestStillCurrent()) {
        // Never return A's device context to a page that may now be rendering B.
        // The pages also carry their own account token, but the cache boundary
        // must be safe independently of any particular caller.
        return { ok: false, reason: 'position_unavailable' }
      }
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
      cachedLocationAt = Date.now()
      return { ok: true, location: name }
    } catch (err) {
      return { ok: false, reason: classifyLocationError(err) }
    } finally {
      if (detectionId === locationDetectionId) detecting.value = false
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
       * is unchanged. mp-weixin uses the same proxy via BASE_URL: a direct
       * Nominatim call would add another domain to the WeChat allow-list and
       * OSM is not reliably reachable from mainland networks anyway.
       */
      // Minimize coordinate precision before it leaves the device or enters
      // URL/function logs. Three decimals is an approximately 100 m grid:
      // enough for a campus pickup-area label without exporting a one-metre
      // device fix to the hosting/geocoding providers. The server repeats this
      // normalization as a defensive boundary.
      const queryLat = lat.toFixed(3)
      const queryLng = lng.toFixed(3)
      let url = ''
      // #ifdef H5
      url = `${typeof window !== 'undefined' ? window.location.origin : ''}/api/geocode?lat=${queryLat}&lon=${queryLng}`
      // #endif
      // #ifndef H5
      url = `${BASE_URL}/api/geocode?lat=${queryLat}&lon=${queryLng}`
      // #endif

      const data: any = await new Promise((resolve, reject) => {
        uni.request({
          url,
          timeout: GEOCODE_REQUEST_TIMEOUT_MS,
          header: { 'Accept-Language': 'en' },
          success: (res) => {
            // Bot-block / rate-limit / error JSON: anything non-200 or without
            // an address block is treated as a miss and asks for manual input.
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
      // Never turn a precise device fix into a coordinate string that later
      // gets persisted as the listing's public location. A city/region label
      // is acceptable; if the provider has none, the caller asks the user to
      // enter a location manually.
      return precise || city || region || null
    } catch {
      return null
    }
  }

  return { cachedLocation, detecting, detectLocation }
}
