import { expect, test } from '@playwright/test'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Item } from '../src/types'
import {
  SEARCH_LEGACY_FILTER_LIMIT,
  SEARCH_SCHEMA_UNAVAILABLE,
  isMissingSearchSignature,
  searchItemsWithCompatibility,
} from '../src/api/searchItems'

const baseParams = {
  terms: ['sushi'],
  page: 0,
  pageSize: 20,
  listingType: 'sell' as const,
}

function item(id: number, location = 'Champaign', verified = false): Item {
  return {
    id: String(id),
    user_id: 'seller',
    title: `Item ${id}`,
    description: '',
    price: id,
    category: 'other',
    condition: 'good',
    status: 'active',
    listing_type: 'sell',
    location,
    location_verified: verified,
    images: [],
    view_count: 0,
    created_at: '2026-07-17T00:00:00Z',
    updated_at: '2026-07-17T00:00:00Z',
  }
}

function mockClient(
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: any }>,
): SupabaseClient {
  return { rpc } as unknown as SupabaseClient
}

test('signature detection is strict to PGRST202', () => {
  expect(isMissingSearchSignature({ code: 'PGRST202' })).toBe(true)
  expect(isMissingSearchSignature({ code: '42501', message: 'function missing' })).toBe(false)
  expect(isMissingSearchSignature({ message: 'PGRST202' })).toBe(false)
})

test('uses the current signature when it is available', async () => {
  const calls: Record<string, unknown>[] = []
  const client = mockClient(async (_name, args) => {
    calls.push(args)
    return { data: [item(1)], error: null }
  })

  const result = await searchItemsWithCompatibility(client, baseParams)

  expect(result.backend).toBe('current')
  expect(result.data.map(row => row.id)).toEqual(['1'])
  expect(calls).toHaveLength(1)
  expect(calls[0]).toMatchObject({
    location_in: null,
    verified_only_in: false,
    limit_in: 20,
    offset_in: 0,
  })
})

test('falls back to the 9-argument signature only for PGRST202', async () => {
  const calls: Record<string, unknown>[] = []
  const client = mockClient(async (_name, args) => {
    calls.push(args)
    if (calls.length === 1) return { data: null, error: { code: 'PGRST202' } }
    return { data: [item(2)], error: null }
  })

  const result = await searchItemsWithCompatibility(client, baseParams)

  expect(result.backend).toBe('legacy')
  expect(result.data.map(row => row.id)).toEqual(['2'])
  expect(calls).toHaveLength(2)
  expect(calls[1]).not.toHaveProperty('location_in')
  expect(calls[1]).not.toHaveProperty('verified_only_in')
})

test('does not hide permission or other non-signature errors', async () => {
  const permissionError = { code: '42501', message: 'permission denied' }
  const client = mockClient(async () => ({ data: null, error: permissionError }))

  let thrown: unknown
  try {
    await searchItemsWithCompatibility(client, baseParams)
  } catch (error) {
    thrown = error
  }
  expect(thrown).toBe(permissionError)
})

test('ambiguous signatures are sanitized without attempting a legacy call', async () => {
  let calls = 0
  const client = mockClient(async () => {
    calls++
    return {
      data: null,
      error: {
        code: 'PGRST203',
        message: 'Could not choose public.search_items_fuzzy(candidate signature)',
      },
    }
  })

  let thrown: any
  try {
    await searchItemsWithCompatibility(client, baseParams)
  } catch (error) {
    thrown = error
  }
  expect(thrown?.code).toBe(SEARCH_SCHEMA_UNAVAILABLE)
  expect(String(thrown?.message)).not.toContain('search_items_fuzzy')
  expect(calls).toBe(1)
})

test('legacy location filters scan ranked pages before slicing the requested page', async () => {
  const rows = Array.from({ length: 160 }, (_, index) =>
    index % 3 === 0 ? item(index, 'Urbana Campus', true) : item(index),
  )
  let calls = 0
  const client = mockClient(async (_name, args) => {
    calls++
    if (calls === 1) return { data: null, error: { code: 'PGRST202' } }
    const offset = Number(args.offset_in)
    const limit = Number(args.limit_in)
    return { data: rows.slice(offset, offset + limit), error: null }
  })

  const result = await searchItemsWithCompatibility(client, {
    ...baseParams,
    page: 1,
    location: 'urbana',
    verifiedOnly: true,
  })

  const expected = rows
    .filter(row => row.location.includes('Urbana') && row.location_verified)
    .slice(20, 40)
    .map(row => row.id)
  expect(result.backend).toBe('legacy')
  expect(result.data.map(row => row.id)).toEqual(expected)
  expect(result.hasMore).toBe(true)
  expect(calls).toBe(3)
})

test('legacy scan ceiling fails with a stable code instead of a false empty page', async () => {
  let calls = 0
  const client = mockClient(async (_name, args) => {
    calls++
    if (calls === 1) return { data: null, error: { code: 'PGRST202' } }
    const offset = Number(args.offset_in)
    const limit = Number(args.limit_in)
    return {
      data: Array.from({ length: limit }, (_, index) => item(offset + index, 'Champaign', false)),
      error: null,
    }
  })

  let thrown: any
  try {
    await searchItemsWithCompatibility(client, {
      ...baseParams,
      location: 'Urbana',
      verifiedOnly: true,
    })
  } catch (error) {
    thrown = error
  }
  expect(thrown?.code).toBe(SEARCH_LEGACY_FILTER_LIMIT)
  expect(String(thrown?.message)).not.toContain('search_items_fuzzy')
  expect(calls).toBe(11)
})

test('missing both signatures is sanitized before reaching the UI', async () => {
  const client = mockClient(async () => ({
    data: null,
    error: {
      code: 'PGRST202',
      message: 'Could not find public.search_items_fuzzy(very, long, signature)',
    },
  }))

  let thrown: any
  try {
    await searchItemsWithCompatibility(client, baseParams)
  } catch (error) {
    thrown = error
  }
  expect(thrown?.code).toBe(SEARCH_SCHEMA_UNAVAILABLE)
  expect(String(thrown?.message)).not.toContain('search_items_fuzzy')
})
