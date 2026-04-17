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
