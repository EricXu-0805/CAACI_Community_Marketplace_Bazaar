import { expect, test } from '@playwright/test'
import {
  NOTIFICATION_FIELDS_LEGACY,
  NOTIFICATION_FIELDS_WITH_CONVERSATION,
  fetchNotificationRowsWithCompatibility,
  isConversationIdColumnUnavailable,
  notificationDestination,
  notificationIcon,
  notificationToastKind,
  notificationTypeLabelKey,
  type Notification,
  type NotificationListQueryResult,
} from '../src/api/notifications'

interface TestNotification {
  id: string
  title: string
  conversation_id?: string | null
}

function result(
  data: TestNotification[] | null,
  error: unknown | null = null,
): NotificationListQueryResult {
  return { data, error }
}

test('missing conversation column detection is strict to explicit codes and target column', () => {
  expect(isConversationIdColumnUnavailable({
    code: '42703',
    message: 'column notifications.conversation_id does not exist',
  })).toBe(true)
  expect(isConversationIdColumnUnavailable({
    code: 'PGRST204',
    message: "Could not find the 'conversation_id' column of 'notifications' in the schema cache",
  })).toBe(true)

  expect(isConversationIdColumnUnavailable({
    code: '42703',
    message: 'column notifications.title does not exist',
  })).toBe(false)
  expect(isConversationIdColumnUnavailable({
    code: '42501',
    message: 'permission denied for table notifications conversation_id',
  })).toBe(false)
  expect(isConversationIdColumnUnavailable({
    code: 'PGRST205',
    message: "Could not find the table 'notifications' in the schema cache",
  })).toBe(false)
})

test('uses the current projection without a legacy retry when available', async () => {
  const calls: string[] = []
  const rows = await fetchNotificationRowsWithCompatibility<TestNotification>(async (fields) => {
    calls.push(fields)
    return result([{ id: 'n1', title: 'Offer', conversation_id: 'c1' }])
  })

  expect(calls).toEqual([NOTIFICATION_FIELDS_WITH_CONVERSATION])
  expect(rows).toEqual([{ id: 'n1', title: 'Offer', conversation_id: 'c1' }])
})

test('falls back on PostgreSQL 42703 and adds a null conversation id to every row', async () => {
  const calls: string[] = []
  const legacyRows: TestNotification[] = [
    { id: 'n1', title: 'Legacy offer' },
    { id: 'n2', title: 'Legacy meetup' },
  ]

  const rows = await fetchNotificationRowsWithCompatibility<TestNotification>(async (fields) => {
    calls.push(fields)
    if (calls.length === 1) {
      return result(null, {
        code: '42703',
        message: 'column notifications.conversation_id does not exist',
      })
    }
    return result(legacyRows)
  })

  expect(calls).toEqual([
    NOTIFICATION_FIELDS_WITH_CONVERSATION,
    NOTIFICATION_FIELDS_LEGACY,
  ])
  expect(rows.map(row => row.conversation_id)).toEqual([null, null])
  expect(legacyRows.every(row => !Object.hasOwn(row, 'conversation_id'))).toBe(true)
})

test('falls back on the explicit PostgREST schema-cache column error', async () => {
  let calls = 0
  const rows = await fetchNotificationRowsWithCompatibility<TestNotification>(async () => {
    calls++
    if (calls === 1) {
      return result(null, {
        code: 'PGRST204',
        message: "Could not find the 'conversation_id' column of 'notifications' in the schema cache",
      })
    }
    return result([{ id: 'n3', title: 'Legacy system notice' }])
  })

  expect(calls).toBe(2)
  expect(rows[0]?.conversation_id).toBeNull()
})

test('does not hide permission or unrelated missing-column errors', async () => {
  const errors = [
    { code: '42501', message: 'permission denied for table notifications' },
    { code: '42703', message: 'column notifications.title does not exist' },
  ]

  for (const sourceError of errors) {
    let calls = 0
    let thrown: unknown
    try {
      await fetchNotificationRowsWithCompatibility<TestNotification>(async () => {
        calls++
        return result(null, sourceError)
      })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBe(sourceError)
    expect(calls).toBe(1)
  }
})

test('propagates a legacy retry failure instead of returning an empty list', async () => {
  const legacyError = { code: '42501', message: 'permission denied for table notifications' }
  let calls = 0
  let thrown: unknown
  try {
    await fetchNotificationRowsWithCompatibility<TestNotification>(async () => {
      calls++
      if (calls === 1) {
        return result(null, {
          code: '42703',
          message: 'column notifications.conversation_id does not exist',
        })
      }
      return result(null, legacyError)
    })
  } catch (error) {
    thrown = error
  }

  expect(thrown).toBe(legacyError)
  expect(calls).toBe(2)
})

test('legacy unread-message reminders always open the Messages tab', () => {
  const reminder: Notification = {
    id: 'n-unread',
    user_id: 'user-1',
    type: 'unread_message',
    title: 'Unread messages',
    body: 'You have unread messages',
    item_id: null,
    is_read: false,
    created_at: '2026-07-17T00:00:00.000Z',
  }

  expect(notificationDestination(reminder)).toEqual({
    url: '/pages/messages/index',
    switchTab: true,
  })
})

test('unread-message reminders keep the safe inbox destination with future payloads', () => {
  const reminder: Notification = {
    id: 'n-unread-future',
    user_id: 'user-1',
    type: 'unread_message',
    title: 'Unread messages',
    body: 'You have unread messages',
    item_id: 'item-should-not-win',
    conversation_id: 'conversation-should-not-win',
    is_read: false,
    created_at: '2026-07-17T00:00:00.000Z',
  }

  expect(notificationDestination(reminder)).toEqual({
    url: '/pages/messages/index',
    switchTab: true,
  })
  expect(notificationIcon(reminder.type)).toBe('messages')
  expect(notificationTypeLabelKey(reminder.type)).toBe('nav.messages')
  expect(notificationToastKind(reminder.type)).toBe('message')
})
