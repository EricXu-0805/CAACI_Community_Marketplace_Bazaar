import { randomUUID } from 'node:crypto'
import type { Page, Route } from '@playwright/test'
import type {
  RealtimeChannel,
  SupabaseClient,
} from '@supabase/supabase-js'
import {
  assertHostedBrowserActor,
  createHostedAnonymousClient,
  createHostedDeniedProbeClient,
  expect,
  loginHostedActor,
  openHostedConversation,
  removeChannel,
  signOutHostedActor,
  test,
  type HostedNetworkController,
  type HostedSdkActor,
} from './fixtures'
import type { HostedRealtimeContract } from './realtime-contract'

test.describe.configure({ mode: 'serial' })

const TERMINAL_STATUSES = new Set([
  'SUBSCRIBED',
  'CHANNEL_ERROR',
  'TIMED_OUT',
  'CLOSED',
])
const MESSAGE_SNAPSHOT_SELECT =
  'id,conversation_id,sender_id,content,message_type,is_read,created_at,sender:profiles(id,nickname,avatar_url)'
const NEGATIVE_OBSERVATION_MS = 6_500

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

async function waitForCondition(
  condition: () => boolean | Promise<boolean>,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await condition()) return
    await delay(100)
  }
  throw new Error('hosted_realtime_condition_timeout')
}

function subscribeOutcome(
  channel: RealtimeChannel,
  timeoutMs = 15_000,
  observeStatus: (status: string) => void = () => {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error('hosted_realtime_subscription_timeout'))
    }, timeoutMs)
    channel.subscribe(status => {
      const normalized = String(status)
      observeStatus(normalized)
      if (settled || !TERMINAL_STATUSES.has(normalized)) return
      settled = true
      clearTimeout(timer)
      resolve(normalized)
    })
  })
}

function privateConversationChannel(
  actor: HostedSdkActor,
  conversationId: string,
): RealtimeChannel {
  return actor.client.channel(`conversation:${conversationId}`, {
    config: {
      private: true,
      presence: { key: actor.actor.expectedUserId },
      broadcast: { self: false, ack: true },
    },
  })
}

function postgresMessagesChannel(
  client: SupabaseClient,
  conversationId: string,
  markerId: string,
  onMarker: () => void,
): RealtimeChannel {
  return client
    .channel(`hosted-pg-${randomUUID()}`)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'messages',
      filter: `conversation_id=eq.${conversationId}`,
    }, payload => {
      if (payload?.new?.id === markerId) onMarker()
    })
}

function postgresNotificationsChannel(
  client: SupabaseClient,
  contract: HostedRealtimeContract,
  markerId: string,
  onMarker: (row: Record<string, unknown>) => void,
): RealtimeChannel {
  return client
    .channel(`hosted-notification-${contract.runId}`)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'notifications',
      filter: `user_id=eq.${contract.accounts[0].expectedUserId}`,
    }, payload => {
      if (payload?.new?.id === markerId) {
        onMarker(payload.new as Record<string, unknown>)
      }
    })
}

async function closeAnonymousClient(client: SupabaseClient): Promise<void> {
  let failed = false
  try {
    const statuses = await client.removeAllChannels()
    if (statuses.some(status => status !== 'ok')) failed = true
  } catch {
    failed = true
  }
  try {
    await Promise.resolve(client.realtime.disconnect())
  } catch {
    failed = true
  }
  if (failed) throw new Error('hosted_realtime_anonymous_teardown_failed')
}

async function navigateToSettings(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.location.hash = '/pages/settings/index'
  })
  await page.locator('.header-title').waitFor({
    state: 'visible',
    timeout: 20_000,
  })
}

async function messageNodeCount(page: Page, messageId: string): Promise<number> {
  return page.evaluate(id => (
    Array.from(document.querySelectorAll('[id]'))
      .filter(element => element.id === `m-${id}`)
      .length
  ), messageId)
}

async function expectMessageCount(
  page: Page,
  messageId: string,
  expected: number,
  timeoutMs = 20_000,
): Promise<void> {
  await waitForCondition(
    async () => await messageNodeCount(page, messageId) === expected,
    timeoutMs,
  )
  await delay(500)
  if (await messageNodeCount(page, messageId) !== expected) {
    throw new Error('hosted_realtime_message_count_failed')
  }
}

function pageContainsText(page: Page, marker: string): Promise<boolean> {
  return page.evaluate(value => (
    (document.body?.innerText || '').includes(value)
  ), marker)
}

interface UiCounters {
  readonly conversations: number
  readonly unreadDots: number
  readonly messageBadges: readonly string[]
  readonly toastCalls: number
}

function uiCounters(page: Page): Promise<UiCounters> {
  return page.evaluate(() => ({
    conversations: document.querySelectorAll('.conv-item').length,
    unreadDots: document.querySelectorAll('.unread-dot,.muted-dot').length,
    messageBadges: Array.from(document.querySelectorAll('.badge-count'))
      .map(element => (element.textContent || '').trim())
      .sort(),
    toastCalls: Number(
      (globalThis as any).__caaciHostedUiAudit?.toastCalls || 0,
    ),
  }))
}

async function installUiAudit(page: Page): Promise<void> {
  const installed = await page.evaluate(() => {
    const root = globalThis as any
    if (root.__caaciHostedUiAudit) return true
    if (!root.uni || typeof root.uni.showToast !== 'function') return false

    const audit = {
      leaked: false,
      markers: new Set<string>(),
      toastCalls: 0,
      observer: null as MutationObserver | null,
    }
    const scan = () => {
      const text = document.body?.innerText || ''
      if ([...audit.markers].some(marker => text.includes(marker))) {
        audit.leaked = true
      }
    }
    const originalShowToast = root.uni.showToast.bind(root.uni)
    root.uni.showToast = (...args: unknown[]) => {
      audit.toastCalls += 1
      return originalShowToast(...args)
    }
    audit.observer = new MutationObserver(scan)
    audit.observer.observe(document.documentElement, {
      childList: true,
      characterData: true,
      subtree: true,
    })
    root.__caaciHostedUiAudit = audit
    return true
  })
  if (!installed) throw new Error('hosted_realtime_ui_audit_failed')
}

async function addLeakMarkers(
  page: Page,
  markers: readonly string[],
): Promise<void> {
  await installUiAudit(page)
  const installed = await page.evaluate(values => {
    const audit = (globalThis as any).__caaciHostedUiAudit
    if (!audit?.markers || !(audit.markers instanceof Set)) return false
    for (const value of values) audit.markers.add(value)
    const text = document.body?.innerText || ''
    if (values.some(value => text.includes(value))) audit.leaked = true
    return true
  }, [...markers])
  if (!installed) throw new Error('hosted_realtime_ui_audit_failed')
}

async function assertNoObservedLeak(page: Page): Promise<void> {
  const leaked = await page.evaluate(() => (
    (globalThis as any).__caaciHostedUiAudit?.leaked === true
  ))
  if (leaked) throw new Error('hosted_realtime_transient_leak_observed')
}

async function stableUiCounters(page: Page): Promise<UiCounters> {
  await waitForCondition(async () => (
    await page.locator('.conv-skel,.loading-tip').count() === 0
  ), 20_000)
  await waitForCondition(async () => (
    await page.locator('.at-card').count() === 0
  ), 10_000)
  let previous = await uiCounters(page)
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await delay(500)
    const current = await uiCounters(page)
    if (JSON.stringify(current) === JSON.stringify(previous)) return current
    previous = current
  }
  throw new Error('hosted_realtime_ui_not_stable')
}

interface HeldSnapshot {
  readonly handler: (route: Route) => Promise<void>
  waitForRequest(): Promise<void>
  setExpectedMessages(messageIds: readonly string[]): void
  startFetch(): void
  waitForFetchedWitness(): Promise<void>
  release(): void
  waitForFulfilled(): Promise<void>
  waitForSettled(): Promise<void>
  assertHealthy(): void
}

function createHeldSnapshot(
  contract: HostedRealtimeContract,
  conversationId: string,
  network: HostedNetworkController,
): HeldSnapshot {
  let captured = false
  let fetchedWitness = false
  let fulfilled = false
  let failed = false
  let expectedMessageIds: readonly string[] = []
  let beginFetch: () => void = () => {}
  let releaseResponse: () => void = () => {}
  const fetchGate = new Promise<void>(resolve => {
    beginFetch = resolve
  })
  const releaseGate = new Promise<void>(resolve => {
    releaseResponse = resolve
  })

  const handler = async (route: Route) => {
    const request = route.request()
    let matchingSnapshot = false
    try {
      const url = new URL(request.url())
      matchingSnapshot = (
        request.method() === 'GET'
        && url.origin === contract.supabaseOrigin
        && url.pathname === '/rest/v1/messages'
        && url.searchParams.get('conversation_id') === `eq.${conversationId}`
        && url.searchParams.get('select') === MESSAGE_SNAPSHOT_SELECT
        && url.searchParams.get('order') === 'created_at.desc'
        && url.searchParams.get('limit') === '200'
      )
    } catch {
    }
    if (!matchingSnapshot) {
      await route.fallback()
      return
    }
    if (captured) {
      await route.abort('connectionrefused')
      return
    }

    captured = true
    try {
      await network.assertBrowserRequestAllowed(request)
      await fetchGate
      if (expectedMessageIds.length === 0) {
        throw new Error('hosted_realtime_held_snapshot_failed')
      }
      const response = await route.fetch({
        maxRedirects: 0,
        timeout: 15_000,
      })
      const contentType = response.headers()['content-type'] || ''
      const body = await response.body()
      if (
        response.url() !== request.url()
        || response.status() < 200
        || response.status() >= 300
        || !/^application\/json(?:;|$)/i.test(contentType)
        || body.byteLength > 512 * 1024
      ) throw new Error('hosted_realtime_held_snapshot_failed')
      const rows = JSON.parse(body.toString('utf8'))
      if (
        !Array.isArray(rows)
        || !expectedMessageIds.every(messageId => (
          rows.some(row => row?.id === messageId)
        ))
      ) throw new Error('hosted_realtime_held_snapshot_failed')
      fetchedWitness = true
      await releaseGate
      await route.fulfill({ response, body })
      fulfilled = true
    } catch {
      failed = true
      await route.abort('failed').catch(() => {})
    }
  }

  return {
    handler,
    waitForRequest: () => waitForCondition(() => captured || failed, 20_000),
    setExpectedMessages(messageIds) {
      const uniqueIds = [...new Set(messageIds)]
      if (
        uniqueIds.length !== messageIds.length
        || uniqueIds.some(id => (
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
            .test(id)
        ))
      ) throw new Error('hosted_realtime_held_snapshot_failed')
      expectedMessageIds = Object.freeze(uniqueIds)
    },
    startFetch() {
      beginFetch()
    },
    waitForFetchedWitness: () => waitForCondition(
      () => fetchedWitness || failed,
      20_000,
    ),
    release() {
      beginFetch()
      releaseResponse()
    },
    waitForFulfilled: () => waitForCondition(
      () => fulfilled || failed,
      20_000,
    ),
    async waitForSettled() {
      if (!captured) return
      await waitForCondition(() => fulfilled || failed, 20_000)
    },
    assertHealthy() {
      if (failed || !fulfilled) {
        throw new Error('hosted_realtime_held_snapshot_failed')
      }
    },
  }
}

test('AUTH-01', async ({ world }) => {
  const { a, b } = world.sdkActors
  const conversationId = world.contract.conversations.ab
  const typingMarker = randomUUID()
  const presenceMarkerA = randomUUID()
  const presenceMarkerB = randomUUID()
  let aSawB = false
  let bSawA = false
  let bTypingCount = 0

  const channelA = privateConversationChannel(a, conversationId)
  const channelB = privateConversationChannel(b, conversationId)
  channelA.on('presence', { event: 'sync' }, () => {
    const entries = channelA.presenceState()?.[b.actor.expectedUserId] as
      | Array<{ user_id?: unknown; presence_marker?: unknown }>
      | undefined
    aSawB = Array.isArray(entries) && entries.some(entry => (
      entry?.user_id === b.actor.expectedUserId
      && entry?.presence_marker === presenceMarkerB
    ))
  })
  channelB
    .on('presence', { event: 'sync' }, () => {
      const entries = channelB.presenceState()?.[a.actor.expectedUserId] as
        | Array<{ user_id?: unknown; presence_marker?: unknown }>
        | undefined
      bSawA = Array.isArray(entries) && entries.some(entry => (
        entry?.user_id === a.actor.expectedUserId
        && entry?.presence_marker === presenceMarkerA
      ))
    })
    .on('broadcast', { event: 'typing' }, message => {
      if (
        message?.payload?.conversation_id === conversationId
        && message?.payload?.user_id === a.actor.expectedUserId
        && message?.payload?.marker === typingMarker
      ) bTypingCount += 1
    })

  try {
    const [statusA, statusB] = await Promise.all([
      subscribeOutcome(channelA),
      subscribeOutcome(channelB),
    ])
    if (statusA !== 'SUBSCRIBED' || statusB !== 'SUBSCRIBED') {
      throw new Error('hosted_realtime_member_join_failed')
    }
    const trackResults = await Promise.all([
      channelA.track({
        user_id: a.actor.expectedUserId,
        presence_marker: presenceMarkerA,
        online_at: Date.now(),
      }),
      channelB.track({
        user_id: b.actor.expectedUserId,
        presence_marker: presenceMarkerB,
        online_at: Date.now(),
      }),
    ])
    if (trackResults.some(result => result !== 'ok')) {
      throw new Error('hosted_realtime_member_presence_track_failed')
    }
    await waitForCondition(() => aSawB && bSawA, 10_000)

    const sendResult = await channelA.send({
      type: 'broadcast',
      event: 'typing',
      payload: {
        conversation_id: conversationId,
        user_id: a.actor.expectedUserId,
        marker: typingMarker,
      },
    })
    if (sendResult !== 'ok') {
      throw new Error('hosted_realtime_member_broadcast_failed')
    }
    await waitForCondition(() => bTypingCount === 1, 10_000)
    await delay(500)
    if (bTypingCount !== 1) {
      throw new Error('hosted_realtime_member_broadcast_duplicate')
    }
  } finally {
    await Promise.all([
      removeChannel(a, channelA),
      removeChannel(b, channelB),
    ])
  }
})

test('AUTH-02', async ({ world }) => {
  const { a, b, c } = world.sdkActors
  const legalChannels = [
    { actor: a, channel: privateConversationChannel(a, world.contract.conversations.ab) },
    { actor: b, channel: privateConversationChannel(b, world.contract.conversations.ab) },
    { actor: a, channel: privateConversationChannel(a, world.contract.conversations.ac) },
    { actor: c, channel: privateConversationChannel(c, world.contract.conversations.ac) },
  ]
  const deniedChannels = [
    { actor: c, channel: privateConversationChannel(c, world.contract.conversations.ab) },
    { actor: b, channel: privateConversationChannel(b, world.contract.conversations.ac) },
  ]
  const anonymous = createHostedAnonymousClient()
  const anonymousChannel = anonymous.channel(
    `conversation:${world.contract.conversations.ab}`,
    {
      config: {
        private: true,
        presence: { key: 'anonymous-canary' },
        broadcast: { self: false, ack: true },
      },
    },
  )
  const dedicatedDeniedProbes = await Promise.all(
    (['random', 'global', 'user'] as const).map(async probe => {
      const boundary = await createHostedDeniedProbeClient(probe, a)
      return {
        boundary,
        channel: boundary.client.channel(boundary.topic, {
          config: {
            private: true,
            presence: { key: a.actor.expectedUserId },
            broadcast: { self: false, ack: true },
          },
        }),
      }
    }),
  )
  const legalStatuses = legalChannels.map(() => [] as string[])
  const deniedStatuses = [
    ...deniedChannels.map(() => [] as string[]),
    [] as string[],
    ...dedicatedDeniedProbes.map(() => [] as string[]),
  ]

  try {
    const outcomes = await Promise.all([
      ...legalChannels.map((entry, index) => subscribeOutcome(
        entry.channel,
        15_000,
        status => legalStatuses[index].push(status),
      )),
      ...deniedChannels.map((entry, index) => subscribeOutcome(
        entry.channel,
        15_000,
        status => deniedStatuses[index].push(status),
      )),
      subscribeOutcome(
        anonymousChannel,
        15_000,
        status => deniedStatuses[deniedChannels.length].push(status),
      ),
      ...dedicatedDeniedProbes.map((entry, index) => subscribeOutcome(
        entry.channel,
        15_000,
        status => deniedStatuses[deniedChannels.length + 1 + index]
          .push(status),
      )),
    ])
    const legalOutcomes = outcomes.slice(0, legalChannels.length)
    const deniedOutcomes = outcomes.slice(legalChannels.length)
    if (legalOutcomes.some(status => status !== 'SUBSCRIBED')) {
      throw new Error('hosted_realtime_same_wave_positive_failed')
    }
    if (deniedOutcomes.some(status => status !== 'CHANNEL_ERROR')) {
      throw new Error('hosted_realtime_nonmember_deny_failed')
    }
    await delay(NEGATIVE_OBSERVATION_MS)
    if (
      deniedStatuses.some(statuses => statuses.includes('SUBSCRIBED'))
      || legalStatuses.some(statuses => statuses.some(status => (
        status === 'CHANNEL_ERROR'
        || status === 'TIMED_OUT'
        || status === 'CLOSED'
      )))
    ) throw new Error('hosted_realtime_nonmember_deny_not_stable')
  } finally {
    let teardownFailed = false
    const removals = await Promise.allSettled([
      ...legalChannels.map(entry => removeChannel(entry.actor, entry.channel)),
      ...deniedChannels.map(entry => removeChannel(entry.actor, entry.channel)),
    ])
    if (removals.some(result => result.status === 'rejected')) {
      teardownFailed = true
    }
    try {
      await closeAnonymousClient(anonymous)
    } catch {
      teardownFailed = true
    }
    for (const probe of dedicatedDeniedProbes) {
      try {
        await closeAnonymousClient(probe.boundary.client)
      } catch {
        teardownFailed = true
      }
    }
    if (teardownFailed) {
      throw new Error('hosted_realtime_channel_teardown_failed')
    }
  }
})

test('RLS-01', async ({ world }) => {
  const { a, b, c } = world.sdkActors
  const cases = [
    {
      conversationId: world.contract.conversations.ab,
      receiver: world.browserActors.b,
      sender: a,
      members: new Set(['a', 'b']),
    },
    {
      conversationId: world.contract.conversations.ac,
      receiver: world.browserActors.c,
      sender: a,
      members: new Set(['a', 'c']),
    },
  ] as const

  for (const scenario of cases) {
    await navigateToSettings(scenario.receiver.page)
    await openHostedConversation(
      scenario.receiver.page,
      scenario.conversationId,
    )
    const anonymous = createHostedAnonymousClient()
    const markerId = randomUUID()
    const counts = { a: 0, b: 0, c: 0, anonymous: 0 }
    const actors = [
      { key: 'a' as const, client: a.client },
      { key: 'b' as const, client: b.client },
      { key: 'c' as const, client: c.client },
      { key: 'anonymous' as const, client: anonymous },
    ]
    const channels = actors.map(({ key, client }) => postgresMessagesChannel(
      client,
      scenario.conversationId,
      markerId,
      () => {
        counts[key] += 1
      },
    ))

    try {
      const outcomes = await Promise.all(
        channels.map(channel => subscribeOutcome(channel)),
      )
      if (outcomes.some(status => status !== 'SUBSCRIBED')) {
        throw new Error('hosted_realtime_postgres_join_failed')
      }
      const inserted = await scenario.sender.insertMessage(
        scenario.conversationId,
        markerId,
      )
      await waitForCondition(() => (
        [...scenario.members].every(key => counts[key as 'a' | 'b' | 'c'] === 1)
      ), 15_000)
      await expectMessageCount(scenario.receiver.page, inserted.id, 1)
      await delay(NEGATIVE_OBSERVATION_MS)
      if (
        counts.a !== (scenario.members.has('a') ? 1 : 0)
        || counts.b !== (scenario.members.has('b') ? 1 : 0)
        || counts.c !== (scenario.members.has('c') ? 1 : 0)
        || counts.anonymous !== 0
      ) throw new Error('hosted_realtime_messages_rls_failed')
    } finally {
      let teardownFailed = false
      const removals = await Promise.allSettled(
        channels.map((channel, index) => (
          actors[index].client.removeChannel(channel)
        )),
      )
      if (removals.some(result => (
        result.status === 'rejected' || result.value !== 'ok'
      ))) teardownFailed = true
      try {
        await closeAnonymousClient(anonymous)
      } catch {
        teardownFailed = true
      }
      if (teardownFailed) {
        throw new Error('hosted_realtime_channel_teardown_failed')
      }
    }
  }
})

test('FAIL-01', async ({ world }) => {
  const sender = world.sdkActors.a
  const receiver = world.browserActors.b
  const page = receiver.page
  const conversationId = world.contract.conversations.ab
  const topic = `realtime:messages:${conversationId}`

  await navigateToSettings(page)
  const beforeOpen = receiver.network.topicObservation(topic)
  await openHostedConversation(page, conversationId)
  await waitForCondition(() => {
    const current = receiver.network.topicObservation(topic)
    return (
      current.active
      && current.successfulJoins > beforeOpen.successfulJoins
    )
  }, 20_000)

  const joinsBeforeFault = receiver.network.topicObservation(topic)
  const readsBeforeFault =
    receiver.network.conversationReadObservation(conversationId)
  await receiver.network.faultRealtimeTopic(topic)
  await waitForCondition(() => (
    receiver.network
      .conversationReadObservation(conversationId)
      .directSeeds > readsBeforeFault.directSeeds
  ), 15_000)

  const afterSeed = receiver.network.topicObservation(topic)
  if (
    afterSeed.active
    || afterSeed.joinAttempts !== joinsBeforeFault.joinAttempts
    || afterSeed.successfulJoins !== joinsBeforeFault.successfulJoins
  ) throw new Error('hosted_realtime_fallback_rejoined')

  const pollBaseline =
    receiver.network.conversationReadObservation(conversationId).directIncrements
  const polled = await sender.insertMessage(conversationId)
  await waitForCondition(() => (
    receiver.network.conversationIncrementMessageMatches(
      conversationId,
      polled.id,
      sender.actor.expectedUserId,
      polled.marker,
    )
  ), 20_000)
  await expectMessageCount(page, polled.id, 1)
  if (!await pageContainsText(page, polled.marker)) {
    throw new Error('hosted_realtime_fallback_poll_body_failed')
  }
  const incrementsAfterMarker =
    receiver.network.conversationReadObservation(conversationId).directIncrements
  const responseTimesAfterMarker =
    receiver.network.conversationIncrementResponseTimes(conversationId)
  await waitForCondition(() => (
    receiver.network
      .conversationIncrementResponseTimes(conversationId)
      .length >= responseTimesAfterMarker.length + 2
  ), 25_000)
  const subsequentResponseTimes =
    receiver.network.conversationIncrementResponseTimes(conversationId)
      .slice(
        responseTimesAfterMarker.length,
        responseTimesAfterMarker.length + 2,
      )
  if (
    incrementsAfterMarker <= pollBaseline
    || subsequentResponseTimes.length !== 2
    || subsequentResponseTimes[1] - subsequentResponseTimes[0] < 2_500
    || !receiver.network.conversationIncrementMessageMatches(
      conversationId,
      polled.id,
      sender.actor.expectedUserId,
      polled.marker,
    )
  ) throw new Error('hosted_realtime_fallback_poll_evidence_failed')
  const beforeRemountBoundary = receiver.network.topicObservation(topic)
  if (
    beforeRemountBoundary.active
    || beforeRemountBoundary.joinAttempts !== joinsBeforeFault.joinAttempts
    || beforeRemountBoundary.successfulJoins !== joinsBeforeFault.successfulJoins
  ) throw new Error('hosted_realtime_fallback_not_sticky')

  await navigateToSettings(page)
  await receiver.network.waitForConversationReadsIdle(conversationId)
  const beforeRemount = receiver.network.topicObservation(topic)
  const successfulReadsBeforeBlock =
    receiver.network.conversationReadObservation(conversationId)
  const incrementAttemptsBeforeBlock =
    receiver.network.conversationDirectIncrementAttempts(conversationId)
  const unblockReads = receiver.network.blockConversationReads(conversationId)
  try {
    await openHostedConversation(page, conversationId)
    await waitForCondition(() => {
      const current = receiver.network.topicObservation(topic)
      return (
        current.active
        && current.successfulJoins > beforeRemount.successfulJoins
      )
    }, 20_000)
    const live = await sender.insertMessage(conversationId)
    await waitForCondition(() => (
      receiver.network.topicMessageCount(topic, live.id) === 1
    ), 15_000)
    await expectMessageCount(page, live.id, 1)
    if (!await pageContainsText(page, live.marker)) {
      throw new Error('hosted_realtime_ws_remount_body_failed')
    }
    await delay(NEGATIVE_OBSERVATION_MS)
    if (
      JSON.stringify(
        receiver.network.conversationReadObservation(conversationId),
      ) !== JSON.stringify(successfulReadsBeforeBlock)
      || receiver.network.conversationDirectIncrementAttempts(conversationId)
        !== incrementAttemptsBeforeBlock
    ) throw new Error('hosted_realtime_ws_remount_rest_leak')
  } finally {
    unblockReads()
  }
})

test('DEDUPE-01', async ({ world }) => {
  const sender = world.sdkActors.a
  const receiver = world.browserActors.b
  const page = receiver.page
  const conversationId = world.contract.conversations.ab
  const topic = `realtime:messages:${conversationId}`
  const held = createHeldSnapshot(
    world.contract,
    conversationId,
    receiver.network,
  )

  await navigateToSettings(page)
  await installUiAudit(page)
  await waitForCondition(() => (
    receiver.network.topicObservation(topic).activeSockets === 0
  ), 10_000)
  const snapshotControl = await sender.insertMessage(conversationId)
  await delay(500)
  if (
    receiver.network.topicMessageCount(topic, snapshotControl.id) !== 0
    || await messageNodeCount(page, snapshotControl.id) !== 0
  ) throw new Error('hosted_realtime_snapshot_control_not_isolated')
  await receiver.context.route('**/rest/v1/messages*', held.handler)
  try {
    const beforeOpen = receiver.network.topicObservation(topic)
    await page.evaluate(id => {
      window.location.hash = `/pages/chat/index?id=${encodeURIComponent(id)}`
    }, conversationId)
    await held.waitForRequest()
    await waitForCondition(() => {
      const current = receiver.network.topicObservation(topic)
      return (
        current.active
        && current.successfulJoins > beforeOpen.successfulJoins
      )
    }, 20_000)

    const inserted = await sender.insertMessage(conversationId)
    held.setExpectedMessages([snapshotControl.id, inserted.id])
    await waitForCondition(() => (
      receiver.network.topicMessageCount(topic, inserted.id) === 1
    ), 15_000)
    await expectMessageCount(page, inserted.id, 1)
    await expectMessageCount(page, snapshotControl.id, 0)
    const countersAfterLive = await uiCounters(page)
    held.startFetch()
    await held.waitForFetchedWitness()
    held.release()
    await held.waitForFulfilled()
    held.assertHealthy()
    await expectMessageCount(page, snapshotControl.id, 1)
    await expectMessageCount(page, inserted.id, 1)
    if (
      !await pageContainsText(page, snapshotControl.marker)
      || !await pageContainsText(page, inserted.marker)
    ) throw new Error('hosted_realtime_snapshot_reducer_failed')
    await delay(2_500)
    if (
      await messageNodeCount(page, inserted.id) !== 1
      || (await uiCounters(page)).toastCalls !== countersAfterLive.toastCalls
    ) throw new Error('hosted_realtime_snapshot_dedupe_failed')
  } finally {
    let teardownFailed = false
    held.release()
    try {
      await held.waitForSettled()
    } catch {
      teardownFailed = true
    }
    try {
      await receiver.context.unroute('**/rest/v1/messages*', held.handler)
    } catch {
      teardownFailed = true
    }
    if (teardownFailed) {
      throw new Error('hosted_realtime_held_snapshot_teardown_failed')
    }
  }
})

test('SWITCH-01', async ({ world }) => {
  const browserA = world.browserActors.a
  const actorB = world.contract.accounts[1]
  const conversationId = world.contract.conversations.ac
  const held = createHeldSnapshot(
    world.contract,
    conversationId,
    browserA.network,
  )
  let positiveChannel: RealtimeChannel | null = null

  await navigateToSettings(browserA.page)
  await browserA.context.route('**/rest/v1/messages*', held.handler)
  try {
    await browserA.page.evaluate(id => {
      window.location.hash = `/pages/chat/index?id=${encodeURIComponent(id)}`
    }, conversationId)
    await held.waitForRequest()
    const witness = await world.sdkActors.a.insertMessage(conversationId)
    held.setExpectedMessages([witness.id])
    held.startFetch()
    await held.waitForFetchedWitness()
    const oldTopic = `realtime:messages:${conversationId}`
    await waitForCondition(() => (
      browserA.network.topicObservation(oldTopic).active
    ), 20_000)

    const controlPage = await browserA.context.newPage()
    browserA.network.attachPage(controlPage)
    await controlPage.addInitScript(() => {
      localStorage.setItem('welcomed', '1')
      localStorage.setItem('lang', 'en')
    })
    await controlPage.goto(
      `${world.contract.appOrigin}/#/pages/settings/index`,
      { waitUntil: 'domcontentloaded' },
    )
    const beforeSignOut = browserA.network.topicObservation(oldTopic)
    if (
      !beforeSignOut.active
      || beforeSignOut.activeSockets < 1
      || browserA.network.actorActiveSocketCount(browserA.actor) < 1
    ) {
      throw new Error('hosted_realtime_signout_transport_not_observed')
    }
    await signOutHostedActor(controlPage)
    await waitForCondition(() => {
      const observation = browserA.network.topicObservation(oldTopic)
      return (
        observation.activeSockets === 0
        && browserA.network.actorActiveSocketCount(browserA.actor) === 0
      )
    }, 15_000)
    const afterSignOut = browserA.network.topicObservation(oldTopic)
    await delay(NEGATIVE_OBSERVATION_MS)
    const afterSignOutStable = browserA.network.topicObservation(oldTopic)
    if (
      afterSignOut.activeSockets !== 0
      || afterSignOut.joinAttempts !== beforeSignOut.joinAttempts
      || afterSignOut.successfulJoins !== beforeSignOut.successfulJoins
      || afterSignOutStable.active
      || afterSignOutStable.activeSockets !== 0
      || afterSignOutStable.joinAttempts !== afterSignOut.joinAttempts
      || afterSignOutStable.successfulJoins !== afterSignOut.successfulJoins
      || browserA.network.actorActiveSocketCount(browserA.actor) !== 0
    ) throw new Error('hosted_realtime_signout_transport_not_closed')
    await browserA.network.setActor(actorB)
    await loginHostedActor(controlPage, actorB, world.contract)
    await assertHostedBrowserActor(browserA.page, actorB, world.contract)
    await addLeakMarkers(browserA.page, [witness.marker])
    await addLeakMarkers(controlPage, [witness.marker])

    held.release()
    await held.waitForFulfilled()
    held.assertHealthy()

    await browserA.page.evaluate(id => {
      window.location.hash = `/pages/chat/index?id=${encodeURIComponent(id)}`
    }, conversationId)
    await browserA.page.locator('.cu-actions').waitFor({
      state: 'visible',
      timeout: 20_000,
    })
    await expect(browserA.page.locator('.input-bar')).toHaveCount(0)
    await delay(500)
    if (
      browserA.network.topicObservation(oldTopic).activeSockets !== 0
      || browserA.network.actorActiveSocketCount(browserA.actor) !== 0
      || await messageNodeCount(browserA.page, witness.id) !== 0
      || await pageContainsText(browserA.page, witness.marker)
    ) throw new Error('hosted_realtime_stale_account_snapshot_visible')
    await assertNoObservedLeak(browserA.page)
    await assertNoObservedLeak(controlPage)

    await controlPage.evaluate(() => {
      window.location.hash = '/pages/messages/index'
    })
    await controlPage.locator('.page-title').waitFor({
      state: 'visible',
      timeout: 20_000,
    })
    await installUiAudit(controlPage)
    const countersBefore = await stableUiCounters(controlPage)
    const postSwitchId = randomUUID()
    const postSwitchMarker = `caaci-hosted-canary-${postSwitchId}`
    if (browserA.network.topicMessageCount(oldTopic, postSwitchId) !== 0) {
      throw new Error('hosted_realtime_switch_transport_baseline_failed')
    }
    await addLeakMarkers(browserA.page, [postSwitchMarker])
    await addLeakMarkers(controlPage, [postSwitchMarker])
    let positiveCount = 0
    positiveChannel = postgresMessagesChannel(
      world.sdkActors.a.client,
      conversationId,
      postSwitchId,
      () => {
        positiveCount += 1
      },
    )
    if (await subscribeOutcome(positiveChannel) !== 'SUBSCRIBED') {
      throw new Error('hosted_realtime_switch_positive_join_failed')
    }
    const inserted = await world.sdkActors.c.insertMessage(
      conversationId,
      postSwitchId,
    )
    await waitForCondition(() => positiveCount === 1, 15_000)
    if (inserted.marker !== postSwitchMarker) {
      throw new Error('hosted_realtime_switch_marker_failed')
    }
    await delay(NEGATIVE_OBSERVATION_MS)
    const countersAfter = await uiCounters(controlPage)
    if (
      positiveCount !== 1
      || browserA.network.topicMessageCount(oldTopic, postSwitchId) !== 0
      || browserA.network.topicObservation(oldTopic).activeSockets !== 0
      || await pageContainsText(controlPage, postSwitchMarker)
      || await pageContainsText(browserA.page, postSwitchMarker)
      || JSON.stringify(countersAfter) !== JSON.stringify(countersBefore)
    ) throw new Error('hosted_realtime_account_switch_isolation_failed')
    await assertNoObservedLeak(browserA.page)
    await assertNoObservedLeak(controlPage)

    await signOutHostedActor(controlPage)
    await waitForCondition(() => (
      browserA.network.actorActiveSocketCount(actorB) === 0
    ), 15_000)
    await browserA.network.setActor(browserA.actor)
    await loginHostedActor(controlPage, browserA.actor, world.contract)
    await assertHostedBrowserActor(browserA.page, browserA.actor, world.contract)
    await assertHostedBrowserActor(controlPage, browserA.actor, world.contract)
    await navigateToSettings(browserA.page)
    const restoredTopic =
      `realtime:messages:${world.contract.conversations.ab}`
    const beforeRestoreOpen = browserA.network.topicObservation(restoredTopic)
    await openHostedConversation(
      browserA.page,
      world.contract.conversations.ab,
    )
    await waitForCondition(() => {
      const observation = browserA.network.topicObservation(restoredTopic)
      return (
        observation.active
        && observation.successfulJoins > beforeRestoreOpen.successfulJoins
      )
    }, 20_000)
    if (browserA.network.actorActiveSocketCount(actorB) !== 0) {
      throw new Error('hosted_realtime_account_restore_isolation_failed')
    }
    await navigateToSettings(browserA.page)
  } finally {
    let teardownFailed = false
    held.release()
    try {
      await held.waitForSettled()
    } catch {
      teardownFailed = true
    }
    if (positiveChannel) {
      try {
        await removeChannel(world.sdkActors.a, positiveChannel)
      } catch {
        teardownFailed = true
      }
    }
    try {
      await browserA.context.unroute(
        '**/rest/v1/messages*',
        held.handler,
      )
    } catch {
      teardownFailed = true
    }
    if (teardownFailed) {
      throw new Error('hosted_realtime_switch_teardown_failed')
    }
  }
})

test('BLOCK-01', async ({ world }) => {
  const { a, b } = world.sdkActors
  const conversationId = world.contract.conversations.ab
  const activeBlockers = new Set<HostedSdkActor>()
  let channels: Array<{ actor: HostedSdkActor; channel: RealtimeChannel }> = []

  const closeChannels = async (): Promise<void> => {
    const closing = channels
    channels = []
    const results = await Promise.allSettled(
      closing.map(entry => removeChannel(entry.actor, entry.channel)),
    )
    if (results.some(result => result.status === 'rejected')) {
      throw new Error('hosted_realtime_block_channel_teardown_failed')
    }
  }
  const pair = () => [
    { actor: a, channel: privateConversationChannel(a, conversationId) },
    { actor: b, channel: privateConversationChannel(b, conversationId) },
  ]
  const runBlockDirection = async (
    blocker: HostedSdkActor,
  ): Promise<void> => {
    await blocker.setBlock(true)
    activeBlockers.add(blocker)
    channels = pair()
    const deniedStatuses = channels.map(() => [] as string[])
    const denied = await Promise.all(channels.map((entry, index) => (
      subscribeOutcome(
        entry.channel,
        15_000,
        status => deniedStatuses[index].push(status),
      )
    )))
    if (denied.some(status => status !== 'CHANNEL_ERROR')) {
      throw new Error('hosted_realtime_block_rebuild_deny_failed')
    }
    await delay(NEGATIVE_OBSERVATION_MS)
    if (deniedStatuses.some(statuses => statuses.includes('SUBSCRIBED'))) {
      throw new Error('hosted_realtime_block_rebuild_deny_not_stable')
    }
    await closeChannels()

    await blocker.setBlock(false)
    activeBlockers.delete(blocker)
    channels = pair()
    const restored = await Promise.all(
      channels.map(entry => subscribeOutcome(entry.channel)),
    )
    if (restored.some(status => status !== 'SUBSCRIBED')) {
      throw new Error('hosted_realtime_unblock_rebuild_failed')
    }
    await closeChannels()
  }

  try {
    channels = pair()
    const initial = await Promise.all(
      channels.map(entry => subscribeOutcome(entry.channel)),
    )
    if (initial.some(status => status !== 'SUBSCRIBED')) {
      throw new Error('hosted_realtime_block_initial_join_failed')
    }
    await closeChannels()

    await runBlockDirection(a)
    await runBlockDirection(b)
  } finally {
    let teardownFailed = false
    try {
      await closeChannels()
    } catch {
      teardownFailed = true
    }
    for (const blocker of activeBlockers) {
      try {
        await blocker.setBlock(false)
        activeBlockers.delete(blocker)
      } catch {
        teardownFailed = true
      }
    }
    if (teardownFailed) {
      throw new Error('hosted_realtime_block_teardown_failed')
    }
  }
})

test('NOTIFY-01', async ({ world }) => {
  const { a, b, c } = world.sdkActors
  const anonymous = createHostedAnonymousClient()
  const markerId = world.runnerIds.notification
  const actors = [
    { key: 'a' as const, client: a.client },
    { key: 'b' as const, client: b.client },
    { key: 'c' as const, client: c.client },
    { key: 'anonymous' as const, client: anonymous },
  ]
  const counts = { a: 0, b: 0, c: 0, anonymous: 0 }
  let receivedBody: unknown
  const channels = actors.map(({ key, client }) => (
    postgresNotificationsChannel(
      client,
      world.contract,
      markerId,
      row => {
        counts[key] += 1
        if (key === 'a') receivedBody = row.body
      },
    )
  ))

  try {
    const outcomes = await Promise.all(
      channels.map(channel => subscribeOutcome(channel)),
    )
    if (outcomes.some(status => status !== 'SUBSCRIBED')) {
      throw new Error('hosted_realtime_notification_join_failed')
    }
    const inserted = await a.insertNotification()
    await waitForCondition(() => counts.a === 1, 15_000)
    await delay(NEGATIVE_OBSERVATION_MS)
    if (
      inserted.id !== markerId
      || inserted.marker !== `caaci-hosted-notification-${markerId}`
      || receivedBody !== inserted.marker
      || counts.a !== 1
      || counts.b !== 0
      || counts.c !== 0
      || counts.anonymous !== 0
    ) throw new Error('hosted_realtime_notification_rls_failed')
  } finally {
    let teardownFailed = false
    const removals = await Promise.allSettled(
      channels.slice(0, 3).map((channel, index) => (
        actors[index].client.removeChannel(channel)
      )),
    )
    if (removals.some(result => (
      result.status === 'rejected' || result.value !== 'ok'
    ))) teardownFailed = true
    try {
      await closeAnonymousClient(anonymous)
    } catch {
      teardownFailed = true
    }
    if (teardownFailed) {
      throw new Error('hosted_realtime_notification_teardown_failed')
    }
  }
})

test('SCALE-01', async ({ world }) => {
  const { a, c } = world.sdkActors
  const anonymous = createHostedAnonymousClient()
  const scaleIds = new Set(world.runnerIds.scaleMessages)
  let cCount = 0
  let anonymousCount = 0
  const cChannel = c.client
    .channel(`hosted-pg-${randomUUID()}`)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'messages',
      filter: `conversation_id=eq.${world.contract.conversations.ab}`,
    }, payload => {
      if (scaleIds.has(String(payload?.new?.id || ''))) cCount += 1
    })
  const anonymousChannel = anonymous
    .channel(`hosted-pg-${randomUUID()}`)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'messages',
      filter: `conversation_id=eq.${world.contract.conversations.ab}`,
    }, payload => {
      if (scaleIds.has(String(payload?.new?.id || ''))) anonymousCount += 1
    })

  try {
    const outcomes = await Promise.all([
      subscribeOutcome(cChannel),
      subscribeOutcome(anonymousChannel),
    ])
    if (outcomes.some(status => status !== 'SUBSCRIBED')) {
      throw new Error('hosted_realtime_scale_rls_join_failed')
    }
    await a.insertScaleBatch()
    const conversation = await a.readScaleConversation()
    const inbox = await a.readScaleInbox()
    await delay(NEGATIVE_OBSERVATION_MS)
    if (
      JSON.stringify(conversation.pageSizes) !== JSON.stringify([50, 1])
      || conversation.rows.length !== 51
      || JSON.stringify(inbox.pageSizes) !== JSON.stringify([25, 5])
      || inbox.rows.length !== 30
      || cCount !== 0
      || anonymousCount !== 0
    ) throw new Error('hosted_realtime_scale_boundary_failed')
  } finally {
    let teardownFailed = false
    try {
      await removeChannel(c, cChannel)
    } catch {
      teardownFailed = true
    }
    try {
      await closeAnonymousClient(anonymous)
    } catch {
      teardownFailed = true
    }
    if (teardownFailed) {
      throw new Error('hosted_realtime_scale_teardown_failed')
    }
  }
})

test('LIFE-01', async ({ world }) => {
  const receiver = world.browserActors.b
  const conversationId = world.contract.conversations.ab
  const topic = `realtime:messages:${conversationId}`

  await navigateToSettings(receiver.page)
  for (let cycle = 0; cycle < 3; cycle += 1) {
    const beforeOpen = receiver.network.topicObservation(topic)
    await openHostedConversation(receiver.page, conversationId)
    await waitForCondition(() => {
      const current = receiver.network.topicObservation(topic)
      return (
        current.activeSockets === 1
        && current.successfulJoins > beforeOpen.successfulJoins
      )
    }, 20_000)
    await navigateToSettings(receiver.page)
    await waitForCondition(() => (
      receiver.network.topicObservation(topic).activeSockets === 0
    ), 15_000)
    await receiver.network.waitForConversationReadsIdle(conversationId)
    const closed = receiver.network.topicObservation(topic)
    const closedReads = receiver.network.conversationReadObservation(
      conversationId,
    )
    const closedIncrementAttempts =
      receiver.network.conversationDirectIncrementAttempts(conversationId)
    await delay(3_500)
    const stable = receiver.network.topicObservation(topic)
    const stableReads = receiver.network.conversationReadObservation(
      conversationId,
    )
    if (
      stable.active
      || stable.activeSockets !== 0
      || stable.joinAttempts !== closed.joinAttempts
      || stable.successfulJoins !== closed.successfulJoins
      || JSON.stringify(stableReads) !== JSON.stringify(closedReads)
      || receiver.network.conversationDirectIncrementAttempts(conversationId)
        !== closedIncrementAttempts
    ) throw new Error('hosted_realtime_lifecycle_unmount_failed')
  }
  if (receiver.network.actorActiveSocketCount(receiver.actor) !== 0) {
    throw new Error('hosted_realtime_lifecycle_residue_failed')
  }
})
