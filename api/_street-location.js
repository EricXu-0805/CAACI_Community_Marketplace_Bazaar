// Device-assisted street check. Browser coordinates are not proof of presence.
// This module never stores/returns a coordinate or a provider's full address.
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export function streetCheckInput(value, now = Date.now()) {
  if (!value || !ID.test(value.item_id || '') || !Number.isFinite(value.accuracy)
    || value.accuracy <= 0 || value.accuracy > 100 || !Number.isFinite(value.fix_at)
    || value.fix_at < now - 60_000 || value.fix_at > now + 5_000) return null
  return { itemId: value.item_id, accuracy: value.accuracy }
}
export function streetLabel(data, latitude, longitude) {
  const a = data?.address
  if (!a || typeof a !== 'object') return null
  const road = a.road || a.street || a.pedestrian
  const city = a.city || a.town || a.village || a.hamlet || a.county
  if (typeof road !== 'string' || typeof city !== 'string') return null
  const label = `${road.trim()}, ${city.trim()}`
  if (!road.trim() || !city.trim() || label.length > 80 || /[\x00-\x1f\x7f]/.test(label)) return null
  // Reverse lookup may select a distant mapped road in sparsely mapped areas.
  if (data.lat == null || data.lon == null) return null
  const lat = Number(data.lat), lon = Number(data.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat)>90 || Math.abs(lon)>180) return null
  const dy=(lat-latitude)*111_320, dx=(lon-longitude)*111_320*Math.cos(latitude*Math.PI/180)
  if (Math.hypot(dx,dy)>300) return null
  return label
}
export function verifiedSessionId(bearer, userId) {
  // Decode only AFTER Auth has verified this exact bearer; never authenticate
  // a request by decoding its claims alone.
  try {
    const claims = JSON.parse(atob(bearer.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')))
    return claims.sub === userId && ID.test(claims.session_id || '') ? claims.session_id : null
  } catch { return null }
}
