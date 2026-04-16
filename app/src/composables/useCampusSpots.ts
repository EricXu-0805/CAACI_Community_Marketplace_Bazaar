export interface CampusSpot {
  id: string
  en: string
  zh: string
}

export const CAMPUS_SPOTS: CampusSpot[] = [
  { id: 'illini_union', en: 'Illini Union', zh: '伊利尼学生中心' },
  { id: 'grainger', en: 'Grainger Library', zh: 'Grainger 图书馆' },
  { id: 'main_library', en: 'Main Library', zh: '主图书馆' },
  { id: 'ugl', en: 'UGL', zh: '本科生图书馆' },
  { id: 'siebel', en: 'Siebel Center', zh: 'Siebel CS 楼' },
  { id: 'green_st', en: 'Green Street', zh: '绿街' },
  { id: 'arc', en: 'ARC Gym', zh: 'ARC 健身房' },
  { id: 'lincoln_hall', en: 'Lincoln Hall', zh: '林肯堂' },
  { id: 'foellinger', en: 'Foellinger Aud.', zh: 'Foellinger 礼堂' },
  { id: 'ikenberry', en: 'Ikenberry Commons', zh: '伊肯贝里公共区' },
]

export function useCampusSpots() {
  return { CAMPUS_SPOTS }
}
