import { CAMPUS_SPOTS } from '../composables/useCampusSpots'

// UIUC is an area filter, not just a substring in the seller's chosen label.
// Keep this list aligned with the SQL search predicate before LIMIT/OFFSET.
export const CAMPUS_LOCATION_TERMS = ['UIUC', ...CAMPUS_SPOTS.filter(spot => spot.safe).flatMap(spot => [spot.en, spot.zh])]
export function listingLocationTerms(area: string): string[] {
  return area.trim().toLowerCase() === 'uiuc' ? CAMPUS_LOCATION_TERMS : [area.trim()]
}
export function matchesListingLocation(location: string | null | undefined, area: string): boolean {
  if (!area.trim()) return true
  const value = (location || '').toLowerCase()
  return listingLocationTerms(area).some(term => value.includes(term.toLowerCase()))
}
