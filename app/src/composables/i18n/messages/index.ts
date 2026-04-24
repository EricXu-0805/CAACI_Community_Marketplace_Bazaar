import type { Lang } from '../types'
import en from './en'
import zh from './zh'

export const messages: Partial<Record<Lang, Record<string, string>>> = {
  en,
  zh,
}
