import { ref } from 'vue'
import { useSupabase } from './useSupabase'
import { captureActiveAccountRequest, isAccountRequestCurrent } from './accountScope'
import { startPrivateRealtimeChannel } from '../api/privateRealtime'
import type { Offer } from '../types'

/*
 * Structured negotiation offers (migration 051). All writes go through the
 * SECURITY DEFINER RPCs make_offer / respond_to_offer — the client only ever
 * SELECTs (RLS limits that to conversation participants) and calls the RPCs,
 * which own the state machine + notifications.
 *
 * Realtime: H5 subscribes to postgres_changes on the offers table so the
 * other party's offer/accept/decline/counter shows live. mp-weixin can't speak
 * the Phoenix channel protocol (same limitation as messages), so there it
 * degrades to "refetch when the chat re-shows" — best-effort, never blocking.
 */
const OFFER_FIELDS =
  'id, conversation_id, item_id, from_user, to_user, price, status, parent_offer_id, note, expires_at, created_at, updated_at'

export function useOffers() {
  const { supabase } = useSupabase()
  const offers = ref<Offer[]>([])
  let latestFetchId = 0
  let latestAppliedFetchId = 0
  let activeFetchConversationId: string | null = null
  let activeFetchEpoch = 0

  function resetOffers() {
    // Invalidate a query already awaiting PostgREST before erasing its rows.
    // Clearing the ref alone lets that old completion repopulate A's offers.
    activeFetchEpoch += 1
    activeFetchConversationId = null
    latestAppliedFetchId = 0
    offers.value = []
  }

  async function fetchOffers(conversationId: string): Promise<Offer[]> {
    if (activeFetchConversationId !== conversationId) {
      activeFetchConversationId = conversationId
      activeFetchEpoch += 1
      latestAppliedFetchId = 0
    }
    const requestEpoch = activeFetchEpoch
    const requestId = ++latestFetchId
    const { data, error } = await supabase
      .from('offers')
      .select(OFFER_FIELDS)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
    if (
      requestEpoch !== activeFetchEpoch ||
      activeFetchConversationId !== conversationId ||
      requestId < latestAppliedFetchId
    ) return offers.value
    // Stale failures are ignored just like stale data; otherwise a request
    // from an abandoned A activation can surface an error over the later B/A
    // owner even though it is no longer allowed to update that owner.
    if (error) throw error
    latestAppliedFetchId = requestId
    offers.value = (data || []) as Offer[]
    return offers.value
  }

  async function makeOffer(conversationId: string, price: number, note?: string): Promise<Offer> {
    const accountToken = captureActiveAccountRequest()
    if (!accountToken) throw new Error('Not authenticated')
    const { data, error } = await supabase.rpc('make_offer', {
      p_conversation_id: conversationId,
      p_price: price,
      expected_user_id_in: accountToken.userId,
      p_note: note ?? null,
    })
    if (!isAccountRequestCurrent(accountToken)) throw new Error('Account changed during offer')
    if (error) throw error
    return data as Offer
  }

  async function respondToOffer(
    offerId: string,
    action: 'accept' | 'decline' | 'counter',
    counterPrice?: number,
    counterNote?: string,
  ): Promise<Offer> {
    const accountToken = captureActiveAccountRequest()
    if (!accountToken) throw new Error('Not authenticated')
    const { data, error } = await supabase.rpc('respond_to_offer', {
      p_offer_id: offerId,
      p_action: action,
      expected_user_id_in: accountToken.userId,
      p_counter_price: counterPrice ?? null,
      p_counter_note: counterNote ?? null,
    })
    if (!isAccountRequestCurrent(accountToken)) throw new Error('Account changed during offer response')
    if (error) throw error
    return data as Offer
  }

  function subscribeToOffers(
    conversationId: string,
    onChange: () => void,
    onReady?: () => void,
  ): () => void {
    // #ifdef H5
    // H5 exposes a real readiness barrier; ChatThread uses it for an
    // authoritative post-SUBSCRIBED snapshot.
    let readySent = false
    return startPrivateRealtimeChannel({
      supabase,
      topic: `offers:${conversationId}`,
      configure: (privateChannel) => privateChannel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'offers', filter: `conversation_id=eq.${conversationId}` },
        () => onChange(),
      ),
      onStatus: (status) => {
        if (status === 'SUBSCRIBED' && !readySent) {
          readySent = true
          onReady?.()
        }
      },
    })
    // #endif
    // #ifndef H5
    /* mp can't speak the Phoenix channel, and offer RPCs write no messages
       row, so the chat's message poll can't carry these events either — a
       no-op here meant two users negotiating on mp never saw each other's
       offer appear or change state until they re-entered the chat. Poll
       instead: onChange() is a cheap idempotent refetch of one conversation's
       offers, so an 8s interval is plenty for a bargaining flow. This tier
       has no cursor handshake: ChatThread installs the recurring full-snapshot
       poll before its initial full snapshot, so any overlap converges on a
       later tick instead of leaving a permanent gap. */
    const timer = setInterval(() => { try { onChange() } catch { /* refetch errors surface in the caller */ } }, 8000)
    return () => clearInterval(timer)
    // #endif
  }

  return { offers, fetchOffers, resetOffers, makeOffer, respondToOffer, subscribeToOffers }
}
