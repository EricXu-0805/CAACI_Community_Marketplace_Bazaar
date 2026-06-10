import { ref } from 'vue'
import { useSupabase } from './useSupabase'
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

  async function fetchOffers(conversationId: string): Promise<Offer[]> {
    const { data, error } = await supabase
      .from('offers')
      .select(OFFER_FIELDS)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
    if (error) throw error
    offers.value = (data || []) as Offer[]
    return offers.value
  }

  async function makeOffer(conversationId: string, price: number, note?: string): Promise<Offer> {
    const { data, error } = await supabase.rpc('make_offer', {
      p_conversation_id: conversationId,
      p_price: price,
      p_note: note ?? null,
    })
    if (error) throw error
    return data as Offer
  }

  async function respondToOffer(
    offerId: string,
    action: 'accept' | 'decline' | 'counter',
    counterPrice?: number,
    counterNote?: string,
  ): Promise<Offer> {
    const { data, error } = await supabase.rpc('respond_to_offer', {
      p_offer_id: offerId,
      p_action: action,
      p_counter_price: counterPrice ?? null,
      p_counter_note: counterNote ?? null,
    })
    if (error) throw error
    return data as Offer
  }

  function subscribeToOffers(conversationId: string, onChange: () => void): () => void {
    // #ifdef H5
    const channel = supabase
      .channel(`offers:${conversationId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'offers', filter: `conversation_id=eq.${conversationId}` },
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

  return { offers, fetchOffers, makeOffer, respondToOffer, subscribeToOffers }
}
