import { useSupabase } from './useSupabase'
import type { CommunityEvent } from '../utils/communityEvents'
import { ACTIVE_REGION } from '../utils/region'

/*
 * P4.8: the one read the events pages make (ENGINEERING 9.6). The function
 * runs as the reader, so it returns only the rows and columns the reader may
 * see: visible, not a duplicate, and for a member's event with a topic the
 * reader can read.
 */
// Rows a list just showed, so opening a card does not ask for them again.
const shown = new Map<string, CommunityEvent>()

// What the reference card on a topic page shows (SPEC 6.4 row 6): the date, the title, when, where and the source.
const TOPIC_EVENT_FIELDS = 'id, source_type, region, title, title_en, starts_at, ends_at, all_day, location, availability, cancelled_at, '
  + 'previous_starts_at, schedule_changed_at, revision, discussion_post_id, partner:community_event_partners(name_zh, name_en)'
type TopicEventRow = Pick<CommunityEvent, 'id' | 'source_type' | 'region' | 'title' | 'title_en' | 'starts_at' | 'ends_at' | 'all_day'
  | 'location' | 'availability' | 'cancelled_at' | 'previous_starts_at' | 'schedule_changed_at' | 'revision' | 'discussion_post_id'>
  & { partner: { name_zh: string; name_en: string } | null }
// The fields that card does not read.
const UNREAD = {
  summary: null, summary_en: null, organizer_name: null, allowed_link_hosts: null, page_url: null, register_url: null,
  registration_mode: '', takes_registrations: null, registration_open: null, occurrence_count: 1, time_zone: '',
  status_note: null, organizer_user_id: null, organizer_nickname: null, organizer_avatar_url: null,
  organizer_is_illini_verified: null, discussion_count: null,
}

export function useCommunityEvents() {
  const { supabase } = useSupabase()

  async function listEvents(window: 'upcoming' | 'past' = 'upcoming'): Promise<CommunityEvent[]> {
    const { data, error } = await supabase.rpc('list_community_events', {
      region_in: ACTIVE_REGION, window_in: window, limit_in: 200,
    })
    if (error) throw error
    const rows = (data || []) as CommunityEvent[]
    for (const row of rows) shown.set(row.id, row)
    return rows
  }

  /** One event by id, or null when readers no longer get it (hidden, withdrawn, or out of both windows). */
  async function findEvent(id: string): Promise<CommunityEvent | null> {
    const known = shown.get(id)
    if (known) return known
    for (const window of ['upcoming', 'past'] as const) {
      const row = (await listEvents(window)).find(event => event.id === id)
      if (row) return row
    }
    return null
  }

  /** The event a topic is the discussion of, if readers can see one (ENGINEERING 9.7). A member's event is titled by its topic. */
  async function findTopicEvent(postId: string, topicTitle: string | null): Promise<CommunityEvent | null> {
    const { data, error } = await supabase.from('community_events').select(TOPIC_EVENT_FIELDS).eq('discussion_post_id', postId).limit(1)
    if (error) throw error
    const row = ((data || []) as unknown as TopicEventRow[])[0]
    if (!row) return null
    const { partner, ...event } = row
    return {
      ...UNREAD, ...event,
      title: event.source_type === 'member' ? topicTitle : event.title,
      partner_name_zh: partner?.name_zh ?? null, partner_name_en: partner?.name_en ?? null,
    }
  }

  return { listEvents, findEvent, findTopicEvent }
}
