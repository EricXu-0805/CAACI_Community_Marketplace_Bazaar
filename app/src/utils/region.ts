/** Community regions (D-21, REGION.1). Every community query names the region so a second one needs no rename. */
export interface Region {
  slug: string
  zh: string
  en: string
}

export const REGIONS: readonly Region[] = [{ slug: 'cu', zh: '香槟', en: 'Champaign-Urbana' }]
export const ACTIVE_REGION = 'cu'

export function showRegionSwitcher(regions: readonly Region[] = REGIONS): boolean {
  return regions.length > 1
}

export function regionLabel(lang: string, slug: string = ACTIVE_REGION, regions: readonly Region[] = REGIONS): string {
  const region = regions.find(candidate => candidate.slug === slug)
  if (!region) return ''
  return lang === 'zh' ? region.zh : region.en
}
