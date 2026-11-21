import { onAccountTransition } from './accountScope'
import { useAuth } from './useAuth'
import { useModeration } from './useModeration'
import { useSupabase } from './useSupabase'
import type { CommunityEvent } from '../utils/communityEvents'
import { ACTIVE_REGION } from '../utils/region'

/*
 * P4.8: the one read the events pages make (ENGINEERING 9.6). The function
 * runs as the reader, so it returns only the rows and columns the reader may
 * see: visible, not a duplicate, and for a member's event with a topic the
 * reader can read. The events of people the reader blocked are left out here,
 * as the home leaves out their topics.
 */
type EventWindow = 'upcoming' | 'past'
// What each list last gave this reader, so that opening a card does not ask
// again. A list replaces its own rows, an account change drops them all, and
// after five minutes a card is read afresh.
const HANDOFF_MS = 5 * 60_000
const shown: Partial<Record<EventWindow, { at: number; rows: Map<string, CommunityEvent> }>> = {}
let reader = 0
onAccountTransition(() => {
  reader += 1
  shown.upcoming = undefined
  shown.past = undefined
})

function withoutBlocked(rows: CommunityEvent[]): CommunityEvent[] {
  const blocked = useModeration().blockedIds.value
  return rows.filter(row => !row.organizer_user_id || !blocked.has(row.organizer_user_id))
}

/**
 * Keeps the rows a read of the list returned, for the page a card opens, and
 * gives back the ones to show: the reader's block list is applied first. The
 * home reads the same list for its own block and hands its rows on here.
 */
export function keepCommunityEvents(window: EventWindow, rows: CommunityEvent[]): CommunityEvent[] {
  const kept = withoutBlocked(rows)
  shown[window] = { at: Date.now(), rows: new Map(kept.map(row => [row.id, row])) }
  return kept
}

// How far ahead "upcoming" reaches in list_community_events (ENGINEERING 9.6).
const UPCOMING_MS = 180 * 86_400_000
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
  const { currentUser, awaitAuthReady } = useAuth()
  const moderation = useModeration()

  async function listEvents(window: EventWindow = 'upcoming'): Promise<CommunityEvent[]> {
    // Who is reading decides what is left out, so the session is settled and the block list read first.
    // A list that cannot be checked against the block list fails; it is not shown unfiltered.
    await awaitAuthReady()
    if (currentUser.value) {
      const gate = await moderation.ensureLoaded()
      if (!gate.ok) throw new Error('moderation_gate_unavailable')
    }
    const mine = reader
    const { data, error } = await supabase.rpc('list_community_events', {
      region_in: ACTIVE_REGION, window_in: window, limit_in: 200,
    })
    if (error) throw error
    const rows = (data || []) as CommunityEvent[]
    // Rows that come back after the account changed are not kept for the next reader.
    return mine === reader ? keepCommunityEvents(window, rows) : withoutBlocked(rows)
  }

  /** One event by id, or null when readers no longer get it (hidden, withdrawn, or out of both windows). */
  async function findEvent(id: string): Promise<CommunityEvent | null> {
    const windows = ['upcoming', 'past'] as const
    for (const window of windows) {
      const held = shown[window]
      const known = held && Date.now() - held.at <= HANDOFF_MS ? held.rows.get(id) : undefined
      if (known) return known
    }
    for (const window of windows) {
      const row = (await listEvents(window)).find(event => event.id === id)
      if (row) return row
    }
    return null
  }

  /**
   * The event a topic is the discussion of, if readers are shown one (ENGINEERING 9.7): visible, not a
   * duplicate, and starting no further ahead than the list reaches, so that the card opens a page. Row security
   * alone would also return an organizer's own event after a takedown, and one that starts later than that.
   * A member's event is titled by its topic.
   */
  async function findTopicEvent(postId: string, topicTitle: string | null): Promise<CommunityEvent | null> {
    const { data, error } = await supabase.from('community_events').select(TOPIC_EVENT_FIELDS)
      .eq('discussion_post_id', postId).eq('availability', 'visible').is('duplicate_of', null)
      .lte('starts_at', new Date(Date.now() + UPCOMING_MS).toISOString()).limit(1)
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
