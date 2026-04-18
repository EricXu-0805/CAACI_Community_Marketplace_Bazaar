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
  { id: 'ugl',           en: 'UGL',               zh: '本科生图书馆',     safe: true  },
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
  if (LABEL_INDEX.has(key)) return LABEL_INDEX.get(key)!
  for (const s of CAMPUS_SPOTS) {
    if (key.includes(s.en.toLowerCase()) || location.includes(s.zh)) return s
  }
  return null
}

export function useCampusSpots() {
  return { CAMPUS_SPOTS, matchSpot }
}
