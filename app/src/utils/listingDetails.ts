import { campusWallClockToInstant, campusPartsNoIntl } from './campusTime'

export type HousingDetails = {
  kind: 'housing'; available_from: string; available_to: string
  price_unit: 'month' | 'week' | 'total'; room_type: 'private' | 'shared' | 'entire'
}
export type RideshareDetails = {
  kind: 'rideshare'; origin: string; destination: string
  departure_date: string; departure_time: string; seats: number
  price_unit: 'person'; time_zone: 'America/Chicago'
}
export type ListingDetails = HousingDetails | RideshareDetails
export interface ListingDetailForm {
  available_from: string; available_to: string; price_unit: string; room_type: string
  origin: string; destination: string; departure_date: string; departure_time: string; seats: string
}
export const hasCategoryDetails = (category: string | undefined) => category === 'housing' || category === 'rideshare'
export const emptyListingDetailForm = (): ListingDetailForm => ({
  available_from: '', available_to: '', price_unit: '', room_type: '',
  origin: '', destination: '', departure_date: '', departure_time: '', seats: '',
})
export function validListingDate(value: string): boolean {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(value + 'T12:00:00Z')
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}
export function listingDetailsFromForm(category: string, form: ListingDetailForm): ListingDetails | null {
  if (category === 'housing') return {
    kind: 'housing', available_from: form.available_from, available_to: form.available_to,
    price_unit: form.price_unit as HousingDetails['price_unit'], room_type: form.room_type as HousingDetails['room_type'],
  }
  if (category === 'rideshare') return {
    kind: 'rideshare', origin: form.origin.trim(), destination: form.destination.trim(),
    departure_date: form.departure_date, departure_time: form.departure_time, seats: Number(form.seats),
    price_unit: 'person', time_zone: 'America/Chicago',
  }
  return null
}
export function listingDetailsError(category: string, value: unknown): string {
  if (value == null) return '' // Existing listings remain readable/editable without invented facts.
  if (!hasCategoryDetails(category) || typeof value !== 'object' || Array.isArray(value)) return 'listingDetails.invalid'
  const d = value as Record<string, unknown>
  if (d.kind !== category) return 'listingDetails.invalid'
  const keys = category === 'housing'
    ? ['kind', 'available_from', 'available_to', 'price_unit', 'room_type']
    : ['kind', 'origin', 'destination', 'departure_date', 'departure_time', 'seats', 'price_unit', 'time_zone']
  if (Object.keys(d).some(k => !keys.includes(k))) return 'listingDetails.invalid'
  if (category === 'housing') {
    if (typeof d.available_from !== 'string' || typeof d.available_to !== 'string'
      || !validListingDate(d.available_from) || !validListingDate(d.available_to)
      || d.available_to < d.available_from) return 'listingDetails.invalidDates'
    if (!['month', 'week', 'total'].includes(String(d.price_unit))) return 'listingDetails.chooseUnit'
    if (!['private', 'shared', 'entire'].includes(String(d.room_type))) return 'listingDetails.chooseRoom'
  } else {
    for (const key of ['origin', 'destination']) {
      const text = d[key]
      if (typeof text !== 'string' || text.trim().length < 2 || text.length > 80 || /[\u0000-\u001f]/.test(text)) return 'listingDetails.needRoute'
    }
    if (String(d.origin).trim().toLowerCase() === String(d.destination).trim().toLowerCase()) return 'listingDetails.sameRoute'
    if (typeof d.departure_date !== 'string' || !validListingDate(d.departure_date)
      || typeof d.departure_time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(d.departure_time)
      || !campusWallClockToInstant(d.departure_date, d.departure_time)) return 'listingDetails.invalidDeparture'
    const resolved = campusWallClockToInstant(d.departure_date, d.departure_time)!
    const parts = campusPartsNoIntl(resolved)
    if (`${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}` !== d.departure_time) return 'listingDetails.invalidDeparture'
    if (!Number.isInteger(d.seats) || Number(d.seats) < 1 || Number(d.seats) > 8) return 'listingDetails.invalidSeats'
    if (d.price_unit !== 'person' || d.time_zone !== 'America/Chicago') return 'listingDetails.invalid'
  }
  return ''
}
export function readListingDetails(category: string | undefined, value: unknown): ListingDetails | null {
  return value != null && !listingDetailsError(category || '', value) ? value as ListingDetails : null
}
export function listingDetailFormFromValue(category: string, value: unknown): ListingDetailForm {
  const d = readListingDetails(category, value)
  return { ...emptyListingDetailForm(), ...(d || {}), seats: d?.kind === 'rideshare' ? String(d.seats) : '' }
}
export function listingDetailsText(value: ListingDetails | null | undefined): string {
  return value?.kind === 'rideshare' ? `${value.origin}\n${value.destination}` : ''
}
