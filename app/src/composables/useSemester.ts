import { computed } from 'vue'

export type SemesterPhase =
  | 'move_in'
  | 'fall_session'
  | 'finals_fall'
  | 'winter_break'
  | 'spring_session'
  | 'finals_spring'
  | 'move_out'
  | 'summer'

interface PhaseConfig {
  phase: SemesterPhase
  titleEn: string
  titleZh: string
  subtitleEn: string
  subtitleZh: string
  category?: string
  accent: string
}

const PHASE_CONTENT: Record<SemesterPhase, PhaseConfig> = {
  move_in: {
    phase: 'move_in',
    titleEn: 'Freshman Essentials',
    titleZh: '新生必备',
    subtitleEn: 'Seniors are clearing dorm essentials this week',
    subtitleZh: '学长学姐清仓宿舍用品,快捡漏',
    category: 'furniture',
    accent: '#f59e0b',
  },
  fall_session: {
    phase: 'fall_session',
    titleEn: 'Fall Semester',
    titleZh: '秋季学期',
    subtitleEn: 'Textbooks, bikes, and more',
    subtitleZh: '教材、自行车、生活用品',
    accent: '#3b82f6',
  },
  finals_fall: {
    phase: 'finals_fall',
    titleEn: 'Finals Week — Study Buddy Gear',
    titleZh: '期末季 — 备考装备',
    subtitleEn: 'Textbooks, notes, coffee makers',
    subtitleZh: '教材、学习笔记、咖啡机',
    category: 'books',
    accent: '#8b5cf6',
  },
  winter_break: {
    phase: 'winter_break',
    titleEn: 'Winter Break Deals',
    titleZh: '寒假特惠',
    subtitleEn: 'Pre-break giveaways and quick sales',
    subtitleZh: '离校前清仓,快速出手',
    accent: '#06b6d4',
  },
  spring_session: {
    phase: 'spring_session',
    titleEn: 'Spring Semester',
    titleZh: '春季学期',
    subtitleEn: 'Fresh arrivals for the new term',
    subtitleZh: '新学期好物持续上新',
    accent: '#10b981',
  },
  finals_spring: {
    phase: 'finals_spring',
    titleEn: 'Finals Week — Study Buddy Gear',
    titleZh: '期末季 — 备考装备',
    subtitleEn: 'Textbooks, notes, coffee makers',
    subtitleZh: '教材、学习笔记、咖啡机',
    category: 'books',
    accent: '#8b5cf6',
  },
  move_out: {
    phase: 'move_out',
    titleEn: 'Move-Out Sale',
    titleZh: '毕业清仓',
    subtitleEn: 'Graduating students selling furniture, electronics, everything',
    subtitleZh: '毕业生清仓家具、电器、一切',
    accent: '#ef4444',
  },
  summer: {
    phase: 'summer',
    titleEn: 'Summer on Campus',
    titleZh: '暑期校园',
    subtitleEn: 'Sublets and summer gear',
    subtitleZh: '短租和暑期装备',
    category: 'housing',
    accent: '#f97316',
  },
}

function phaseFor(date: Date): SemesterPhase {
  const month = date.getMonth() + 1
  const day = date.getDate()
  const mmdd = month * 100 + day

  if (mmdd >= 815 && mmdd <= 905) return 'move_in'
  if (mmdd >= 906 && mmdd <= 1130) return 'fall_session'
  if (mmdd >= 1201 && mmdd <= 1220) return 'finals_fall'
  if (mmdd >= 1221 || mmdd <= 115) return 'winter_break'
  if (mmdd >= 116 && mmdd <= 430) return 'spring_session'
  if (mmdd >= 501 && mmdd <= 515) return 'finals_spring'
  if (mmdd >= 516 && mmdd <= 531) return 'move_out'
  return 'summer'
}

export function useSemester() {
  const now = new Date()
  const phase = computed(() => phaseFor(now))
  const config = computed(() => ({ ...PHASE_CONTENT[phase.value] }))

  function title(lang: 'en' | 'zh'): string {
    return lang === 'zh' ? config.value.titleZh : config.value.titleEn
  }

  function subtitle(lang: 'en' | 'zh'): string {
    return lang === 'zh' ? config.value.subtitleZh : config.value.subtitleEn
  }

  return { phase, config, title, subtitle }
}
