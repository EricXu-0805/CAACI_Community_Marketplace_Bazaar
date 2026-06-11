import { ref } from 'vue'
import { useSupabase } from './useSupabase'
import type { Meetup } from '../types'

/*
 * Structured meetup scheduling (migration 052). Mirrors useOffers: all writes
 * go through the SECURITY DEFINER RPCs propose_meetup / respond_to_meetup —
 * the client only SELECTs (RLS limits that to conversation participants) and
 * calls the RPCs, which own the state machine + notifications.
 *
 * Graceful degradation: until migration 052 is applied the meetups table /
 * RPCs don't exist. fetch swallows the "relation does not exist" error and
 * returns [] so the chat never breaks; the propose entry simply produces no
 * cards. (Same posture as useOffers' "additive — never block the chat".)
 *
 * Realtime: H5 subscribes to postgres_changes; mp-weixin can't speak the
 * Phoenix protocol, so there it degrades to "refetch when the chat re-shows".
 */
const MEETUP_FIELDS =
  'id, conversation_id, item_id, from_user, to_user, spot, meet_at, status, parent_meetup_id, note, expires_at, created_at, updated_at'

export function useMeetups() {
  const { supabase } = useSupabase()
  const meetups = ref<Meetup[]>([])

  async function fetchMeetups(conversationId: string): Promise<Meetup[]> {
    const { data, error } = await supabase
      .from('meetups')
      .select(MEETUP_FIELDS)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
    if (error) {
      // 42P01 = undefined_table (migration not applied yet) → degrade to empty.
      if ((error as { code?: string }).code === '42P01') {
        meetups.value = []
        return meetups.value
      }
      throw error
    }
    meetups.value = (data || []) as Meetup[]
    return meetups.value
  }

  async function proposeMeetup(
    conversationId: string,
    spot: string,
    meetAt: string,
    note?: string,
  ): Promise<Meetup> {
    const { data, error } = await supabase.rpc('propose_meetup', {
      p_conversation_id: conversationId,
      p_spot: spot,
      p_meet_at: meetAt,
      p_note: note ?? null,
    })
    if (error) throw error
    return data as Meetup
  }

  async function respondToMeetup(
    meetupId: string,
    action: 'accept' | 'decline' | 'reschedule',
    newSpot?: string,
    newMeetAt?: string,
    newNote?: string,
  ): Promise<Meetup> {
    const { data, error } = await supabase.rpc('respond_to_meetup', {
      p_meetup_id: meetupId,
      p_action: action,
      p_new_spot: newSpot ?? null,
      p_new_meet_at: newMeetAt ?? null,
      p_new_note: newNote ?? null,
    })
    if (error) throw error
    return data as Meetup
  }

  function subscribeToMeetups(conversationId: string, onChange: () => void): () => void {
    // #ifdef H5
    const channel = supabase
      .channel(`meetups:${conversationId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'meetups', filter: `conversation_id=eq.${conversationId}` },
        () => onChange(),
      )
      .subscribe()
    return () => {
      try { supabase.removeChannel(channel) } catch { /* already torn down */ }
    }
    // #endif
    // #ifndef H5
    return () => {}
    // #endif
  }

  return { meetups, fetchMeetups, proposeMeetup, respondToMeetup, subscribeToMeetups }
}
