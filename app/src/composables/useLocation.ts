import { ref } from 'vue'

const cachedLocation = ref('')

export function useLocation() {
  const detecting = ref(false)

  async function detectLocation(): Promise<string> {
    if (cachedLocation.value) return cachedLocation.value

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
      cachedLocation.value = name
      return name
    } catch {
      return ''
    } finally {
      detecting.value = false
    }
  }

  async function reverseGeocode(lat: number, lng: number): Promise<string> {
    try {
      const resp = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=14`,
        { headers: { 'Accept-Language': 'en' } }
      )
      const data = await resp.json()
      const addr = data.address || {}
      return addr.city || addr.town || addr.suburb || addr.county || 'UIUC'
    } catch {
      return 'UIUC'
    }
  }

  return { cachedLocation, detecting, detectLocation }
}
