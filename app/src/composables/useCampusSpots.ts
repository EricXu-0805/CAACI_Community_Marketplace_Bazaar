export interface CampusSpot {
  id: string
  en: string
  zh: string
  safe: boolean
}

export const CAMPUS_SPOTS: CampusSpot[] = [
  { id: 'illini_union',  en: 'Illini Union',      zh: '伊利尼学生中心',   safe: true  },
  { id: 'grainger',      en: 'Grainger Library',  zh: 'Grainger 图书馆',  safe: true  },
  { id: 'main_library',  en: 'Main Library',      zh: '主图书馆',         safe: true  },
  { id: 'siebel',        en: 'Siebel Center',     zh: 'Siebel CS 楼',     safe: true  },
  { id: 'green_st',      en: 'Green Street',      zh: '绿街',             safe: false },
  { id: 'arc',           en: 'ARC Gym',           zh: 'ARC 健身房',       safe: true  },
  { id: 'lincoln_hall',  en: 'Lincoln Hall',      zh: '林肯堂',           safe: true  },
  { id: 'foellinger',    en: 'Foellinger Aud.',   zh: 'Foellinger 礼堂',  safe: true  },
  { id: 'ikenberry',     en: 'Ikenberry Commons', zh: '伊肯贝里公共区',   safe: true  },
]

const LABEL_INDEX = new Map<string, CampusSpot>()
for (const s of CAMPUS_SPOTS) {
  LABEL_INDEX.set(s.en.toLowerCase(), s)
  LABEL_INDEX.set(s.zh, s)
}

export function matchSpot(location: string | null | undefined): CampusSpot | null {
  if (!location) return null
  const key = location.trim().toLowerCase()
  // Only an exact chip label may be translated or receive a campus marker.
  // Substring matches erased directions ("Illini Union north entrance") and
  // even endorsed exclusions ("not at Illini Union"). Free text stays intact.
  return LABEL_INDEX.get(key) || null
}

/*
 * Render a stored location string in the current UI language.
 *
 * Locations are persisted as whatever string the publisher picked
 * (so user A on zh saves '伊利尼学生中心', user B viewing in en sees
 * the raw zh string unless we localize at render time). matchSpot()
 * gives us the bilingual entry; pick the side matching `lang`.
 *
 * Falls back to the raw string when the stored value isn't a known
 * campus spot (free-form locations like '北区公寓' or 'Greg Hall').
 */
export function localizeLocation(
  raw: string | null | undefined,
  lang: 'en' | 'zh',
): string {
  if (!raw) return ''
  const spot = matchSpot(raw)
  if (!spot) return raw
  return lang === 'zh' ? spot.zh : spot.en
}

export type PickupTier = 'spot' | 'shared'

/*
 * Two-tier pickup signal, computed at render time from the stored location
 * string — no DB column, no migration. `item.location` is already returned by
 * every list/detail/search path.
 *   'spot'   — the seller chose an exact campus pickup label. This does not
 *              certify safety, opening hours, the seller, or an actual visit.
 *   'shared' — no safe-spot match, but the seller shared a real device GPS fix.
 *   null     — neither; render nothing.
 * green_st has safe:false, so "Green Street" falls through to 'shared'/null.
 */
export function pickupTier(
  location: string | null | undefined,
  locationVerified?: boolean | null,
): PickupTier | null {
  const spot = matchSpot(location)
  if (spot && spot.safe) return 'spot'
  if (locationVerified) return 'shared'
  return null
}

export function useCampusSpots() {
  return { CAMPUS_SPOTS, matchSpot, localizeLocation, pickupTier }
}
