/*
 * P4.9: what the console's events tab shows and offers for a row. A button is
 * offered only where the database would accept the action, so an administrator
 * is not sent into a refusal; the rules are the ones the three event actions
 * apply (ENGINEERING 9.7).
 */
type Language = 'zh' | 'en'
export type EventConsoleAction = 'create_event_discussion' | 'hide_event' | 'unhide_event'
/** The fields of a row of the events list that the decisions below read. */
export interface EventConsoleRow {
  source_type: 'caaci' | 'partner' | 'campus' | 'member'
  title: string | null
  title_en: string | null
  organizer_name: string | null
  availability: 'visible' | 'unavailable' | 'hidden'
  hidden_reason: 'admin' | 'post_removed' | null
  duplicate_of: string | null
  discussion_post_id: string | null
  partner: { name_zh: string; name_en: string; status: string } | null
  topic: { title: string | null; status: string } | null
}

/**
 * The title a row is named by, or '' when it has none. A member's event is
 * titled by its topic. An organization's takes its own title, the English one
 * when that is blank, as one line: the title create_event_discussion would
 * give the topic.
 */
export function eventConsoleTitle(row: EventConsoleRow): string {
  if (row.source_type === 'member') return (row.topic?.title || '').trim()
  const own = (row.title || '').replace(/^ +| +$/g, '') ? row.title : row.title_en
  return (own || '').replace(/\s+/g, ' ').trim()
}

/** Who the row names as its organizer, in the language of the console. */
export function eventConsoleOrganizer(row: EventConsoleRow, lang: Language): string {
  const partner = row.partner
  if (partner) return (lang === 'zh' ? partner.name_zh || partner.name_en : partner.name_en || partner.name_zh) || ''
  return row.organizer_name || ''
}

/** The buttons of a row, in the order they are shown. `owner` is whether the administrator may open discussions. */
export function eventConsoleActions(row: EventConsoleRow, owner: boolean): EventConsoleAction[] {
  // Only a takedown by an administrator is undone here; an event hidden with its topic comes back with the topic.
  if (row.availability === 'hidden') return row.hidden_reason === 'admin' ? ['unhide_event'] : []
  // What its source withdrew is not shown to readers, so there is nothing here to take down.
  if (row.availability === 'unavailable') return []
  const actions: EventConsoleAction[] = []
  // One discussion topic per organization's event; a member's event has its own. The action is refused for a
  // duplicate, for a partner that is not active and for a row with no title to give the topic.
  if (owner && row.source_type !== 'member' && !row.discussion_post_id && !row.duplicate_of
    && (!row.partner || row.partner.status === 'active') && eventConsoleTitle(row)) actions.push('create_event_discussion')
  actions.push('hide_event')
  return actions
}
