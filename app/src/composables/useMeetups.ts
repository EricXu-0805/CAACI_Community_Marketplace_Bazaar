import { ref } from 'vue'
import { useSupabase, platformFetch } from './useSupabase'
import { BASE_URL } from '../config/runtime'
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

function meetupNotifyBase(): string {
  // #ifdef H5
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin + '/api/meetup-notify'
  }
  // #endif
  return `${BASE_URL}/api/meetup-notify`
}

export function useMeetups() {
  const { supabase } = useSupabase()
  const meetups = ref<Meetup[]>([])

  /*
   * QA8 #8 — instant email to the other party after a meetup action.
   * Fire-and-forget: the notification ROW (written by the RPC) is the source
   * of truth and rides the daily digest as fallback, so a failure here is
   * silently absorbed — the meetup action itself already succeeded.
   */
  function notifyMeetupEmail(meetup: Meetup | null | undefined) {
    const id = meetup?.id
    if (!id) return
    ;(async () => {
      const { data: sess } = await supabase.auth.getSession()
      const jwt = sess.session?.access_token
      if (!jwt) return
      await platformFetch(meetupNotifyBase(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ meetup_id: id }),
      })
    })().catch(() => { /* digest is the fallback path */ })
  }

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
    notifyMeetupEmail(data as Meetup)
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
    notifyMeetupEmail(data as Meetup)
    return data as Meetup
  }

  /*
   * Reschedule an ALREADY-ACCEPTED meetup (migration 060). Unlike
   * respond_to_meetup('reschedule') — which is recipient-only and pending-only
   * — either participant can change a confirmed time/place. The RPC marks the
   * accepted record 'rescheduled' and inserts a fresh pending proposal to the
   * other party, so the change still needs their re-confirmation.
   */
  async function rescheduleAccepted(
    meetupId: string,
    spot: string,
    meetAt: string,
    note?: string,
  ): Promise<Meetup> {
    const { data, error } = await supabase.rpc('reschedule_accepted_meetup', {
      p_meetup_id: meetupId,
      p_new_spot: spot,
      p_new_meet_at: meetAt,
      p_new_note: note ?? null,
    })
    if (error) throw error
    notifyMeetupEmail(data as Meetup)
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
    /* Same rationale as subscribeToOffers' mp branch: meetup RPCs write no
       messages row, so without this poll an mp user waiting in-chat never
       saw the counterparty's confirm/reschedule. onChange() refetch is
       cheap and idempotent. */
    const timer = setInterval(() => { try { onChange() } catch { /* refetch errors surface in the caller */ } }, 8000)
    return () => clearInterval(timer)
    // #endif
  }

  return { meetups, fetchMeetups, proposeMeetup, respondToMeetup, rescheduleAccepted, subscribeToMeetups }
}
