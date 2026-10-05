import { test, expect, type Page, type Route } from '@playwright/test'

// These compiled-H5 journeys are entirely offline. Every identity, token,
// message and receipt below is synthetic; no mailbox or provider is contacted.
test.use({ screenshot: 'off', trace: 'off', video: 'off' })

const ownerId = '11111111-1111-4111-8111-111111111111'
const tokenId = '22222222-2222-4222-8222-222222222222'
const recoveryTokenId = '33333333-3333-4333-8333-333333333333'
const providerId = '55555555-5555-4555-8555-555555555555'
const token = `iam_admin_${'a'.repeat(43)}`
const receiptKey = `caaci.support-reply.v1.${ownerId}`
const time = '2026-10-03T14:00:00.000Z'
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const draft = {
  to: 'support-fixture@example.invalid',
  subject: 'Re: Synthetic marketplace question',
  text: 'Synthetic plain-text answer.\nSecond line with <b>literal markup</b>.',
  context: 'Synthetic reference content that must never leave the composer.',
  inReplyTo: '<synthetic-original@example.invalid>',
}
const revisedText = 'Revised synthetic answer.\nNo previous wording should be sent. 谢谢'

interface SendPayload {
  action: 'send_support_reply'
  request_id: string
  to: string
  subject: string
  text: string
  in_reply_to: string | null
}

function receipt(payload: SendPayload, status: 'sent' | 'unknown') {
  return {
    request_id: payload.request_id, status,
    provider_id: status === 'sent' ? providerId : null,
    to: payload.to, subject: payload.subject, created_at: time,
  }
}

async function setup(page: Page, outcome: 'sent' | 'unknown' = 'sent') {
  await page.addInitScript(() => {
    localStorage.setItem('welcomed', '1')
    localStorage.setItem('lang', 'en')
  })
  await page.routeWebSocket(/.*/, socket => socket.close())
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return route.continue()
    if (url.hostname.endsWith('.supabase.co')) return route.fulfill({ json: [] })
    return route.abort('blockedbyclient')
  })

  const sends: Array<{ payload: SendPayload; idempotencyKey: string; authorization: string }> = []
  const receiptReads: string[] = []
  let pendingSend: Route | undefined
  await page.route(url => (url.hostname === 'localhost' || url.hostname === '127.0.0.1') && url.pathname.startsWith('/api/'), async route => {
    const request = route.request()
    const url = new URL(request.url())
    const resource = url.searchParams.get('resource')
    if (request.method() === 'POST') {
      const payload = request.postDataJSON() as SendPayload
      expect(payload.action).toBe('send_support_reply')
      sends.push({ payload, idempotencyKey: request.headers()['idempotency-key'], authorization: request.headers().authorization })
      if (outcome === 'unknown') return route.abort('failed')
      // Keep acceptance pending until the test has checked duplicate activation.
      pendingSend = route
      return
    }
    let data: unknown
    switch (resource) {
      case 'whoami':
        data = {
          admin_id: ownerId, token_id: tokenId, admin_name: 'Synthetic owner',
          admin_email: 'owner@example.invalid', role: 'owner', source: 'token',
          expires_at: null, server_now: new Date().toISOString(),
          capabilities: ['apply_ban', 'lift_suspension', 'decide_appeal', 'update_report_status', 'resolve_target_reports', 'takedown_content', 'set_post_pinned', 'upsert_banner', 'delete_banner', 'upload_banner', 'revoke_token', 'issue_token', 'revoke_admin_tokens'],
        }
        break
      case 'tokens':
        data = {
          tokens: [tokenId, recoveryTokenId].map(id => ({
            id, admin_id: ownerId, admin_name: 'Synthetic owner', admin_email: 'owner@example.invalid',
            role: 'owner', created_at: time, last_used_at: time, expires_at: null, revoked_at: null,
          })),
          owner_recovery: {
            active_owner_tokens: 2, unverified_owner_tokens: 0, expiring_owner_tokens: 0,
            non_expiring_owner_tokens: 2, nearest_owner_expiry: null, status: 'healthy',
          },
        }
        break
      case 'stats':
        data = { active_suspensions: 0, pending_reports: 0, pending_appeals: 0, shadow_banned: 0, oldest_pending_hours: null }
        break
      case 'support_email_status':
        data = { available: true, from: 'help@illinimarket.com', reply_to: 'help@illinimarket.com' }
        break
      case 'support_email_receipt': {
        const requestId = url.searchParams.get('request_id')!
        receiptReads.push(requestId)
        const send = sends.find(entry => entry.payload.request_id === requestId)
        expect(send, 'receipt lookup must use the original recorded request').toBeDefined()
        data = receipt(send!.payload, outcome)
        break
      }
      default:
        data = []
    }
    return route.fulfill({ json: { data } })
  })

  await page.goto('/#/pages/admin/index')
  await unlock(page)
  return {
    sends, receiptReads,
    async acceptPendingSend() {
      expect(pendingSend).toBeDefined()
      await pendingSend!.fulfill({ json: { data: receipt(sends[0].payload, 'sent') } })
    },
  }
}

async function unlock(page: Page) {
  await page.getByRole('textbox', { name: 'Enter personal admin token', exact: true }).fill(token)
  await page.getByRole('button', { name: 'Unlock', exact: true }).click()
  await expect(page.getByText('No reports to show.', { exact: true })).toBeVisible()
  await expect(page.getByText('Admin writes are safely paused', { exact: true })).toHaveCount(0)
}

async function openComposer(page: Page) {
  await page.getByRole('button', { name: /Support email.*Open replies/ }).click()
  await expect(page.getByRole('textbox', { name: 'Recipient', exact: true })).toBeVisible()
}

async function compose(page: Page) {
  await openComposer(page)
  await page.getByRole('textbox', { name: 'Recipient', exact: true }).fill(draft.to)
  await page.getByRole('textbox', { name: 'Reply subject', exact: true }).fill(draft.subject)
  await page.getByRole('textbox', { name: 'Original message — optional reference', exact: true }).fill(draft.context)
  await page.getByRole('textbox', { name: 'Your reply', exact: true }).fill(draft.text)
  await page.getByRole('button', { name: 'Optional advanced details', exact: true }).click()
  await page.getByRole('textbox', { name: 'Original Message-ID', exact: true }).fill(draft.inReplyTo)
}

async function expectNoPrivateStorage(page: Page) {
  const stored = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))
  // Check individual lines so JSON's escaped newlines cannot conceal a leak.
  for (const privateValue of [...Object.values(draft), revisedText, token].flatMap(value => value.split('\n'))) {
    expect(stored).not.toContain(privateValue)
  }
}

test('owner reviews the final reply and a double click makes one provider-acceptance request', async ({ page }) => {
  const harness = await setup(page)
  await compose(page)
  const preview = page.getByRole('region', { name: 'Review the complete outgoing reply', exact: true })
  const confirm = page.getByRole('button', { name: 'Confirm and send this reply', exact: true })
  await expect(confirm).toHaveCount(0)
  expect(harness.sends).toHaveLength(0)

  await page.getByRole('button', { name: 'Review reply', exact: true }).click()
  await expect(preview).toBeFocused()
  for (const value of ['help@illinimarket.com', draft.to, draft.subject, draft.inReplyTo]) {
    await expect(preview).toContainText(value)
  }
  // uni-text renders line breaks as <br>; textContent joins their adjacent
  // words. innerText checks the exact, visible outgoing plaintext instead.
  await expect.poll(() => preview.locator('.support-body').innerText()).toBe(draft.text)
  await expect(preview).not.toContainText(draft.context)
  await expect(preview.locator('b')).toHaveCount(0)
  expect(harness.sends).toHaveLength(0)
  await expectNoPrivateStorage(page)

  await page.getByRole('textbox', { name: 'Your reply', exact: true }).fill(revisedText)
  await expect(preview).toHaveCount(0)
  await expect(confirm).toHaveCount(0)
  expect(harness.sends).toHaveLength(0)
  await page.getByRole('button', { name: 'Review reply', exact: true }).click()
  await expect.poll(() => preview.locator('.support-body').innerText()).toBe(revisedText)
  await confirm.dblclick()
  await expect.poll(() => harness.sends.length).toBe(1)
  const sent = harness.sends[0]
  expect(sent.payload).toEqual({
    action: 'send_support_reply', request_id: expect.stringMatching(uuidPattern),
    to: draft.to, subject: draft.subject, text: revisedText, in_reply_to: draft.inReplyTo,
  })
  expect(sent.idempotencyKey).toBe(sent.payload.request_id)
  expect(sent.authorization).toBe(`Bearer ${token}`)
  await expect(confirm).toHaveCount(0)
  expect(await page.evaluate(key => localStorage.getItem(key), receiptKey)).toBe(sent.payload.request_id)
  await expectNoPrivateStorage(page)
  await harness.acceptPendingSend()

  const result = page.locator('.support-result')
  await expect(result).toContainText('Accepted by the email provider')
  await expect(result).toContainText('does not confirm delivery to the recipient')
  await expect(result).toContainText(providerId)
  await expect(result).not.toContainText(revisedText, { useInnerText: true })
  await expect(result).not.toContainText(draft.context)
  await expect(page.getByRole('textbox', { name: 'Your reply', exact: true })).toHaveCount(0)
  expect(harness.sends).toHaveLength(1)

  await page.getByRole('button', { name: 'Acknowledge receipt and clear', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Recipient', exact: true })).toHaveValue('')
  await expect(page.getByRole('textbox', { name: 'Your reply', exact: true })).toHaveValue('')
  expect(await page.evaluate(key => localStorage.getItem(key), receiptKey)).toBeNull()
})

test('an uncertain reply remains a read-only receipt across owner logout and unlock', async ({ page }) => {
  const harness = await setup(page, 'unknown')
  await compose(page)
  await page.getByRole('button', { name: 'Review reply', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm and send this reply', exact: true }).click()
  const result = page.locator('.support-result')
  await expect(result).toContainText('Reply outcome unknown')
  await expect(result).toContainText('It may have been sent')
  expect(harness.sends).toHaveLength(1)
  const requestId = harness.sends[0].payload.request_id
  await expect(page.getByRole('textbox', { name: 'Recipient', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Acknowledge receipt and clear', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Check receipt status', exact: true }).click()
  await expect.poll(() => harness.receiptReads.length).toBe(1)
  await expect(result).toContainText(draft.subject)
  await expectNoPrivateStorage(page)

  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Enter personal admin token', exact: true })).toHaveValue('')
  await expect(page.locator('.support')).toHaveCount(0)
  await expect(page.locator('body')).not.toContainText(draft.subject)
  await expectNoPrivateStorage(page)
  expect(await page.evaluate(key => localStorage.getItem(key), receiptKey)).toBe(requestId)

  await unlock(page)
  await page.getByRole('button', { name: /Support email.*Open replies/ }).click()
  await expect.poll(() => harness.receiptReads.length).toBe(2)
  await expect(result).toContainText('Reply outcome unknown')
  await expect(result).toContainText(requestId)
  await expect(page.getByRole('textbox', { name: 'Your reply', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Confirm and send this reply', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Acknowledge receipt and clear', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Check receipt status', exact: true }).click()
  await expect.poll(() => harness.receiptReads.length).toBe(3)
  expect(harness.receiptReads).toEqual([requestId, requestId, requestId])
  expect(harness.sends).toHaveLength(1)
  await expectNoPrivateStorage(page)
})

test('logging out clears an unsent private draft and its review before the owner unlocks again', async ({ page }) => {
  const harness = await setup(page)
  await compose(page)
  await page.getByRole('button', { name: 'Review reply', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Review the complete outgoing reply', exact: true })).toBeVisible()
  await expectNoPrivateStorage(page)
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Enter personal admin token', exact: true })).toHaveValue('')
  await expect(page.locator('.support')).toHaveCount(0)
  await expect(page.locator('body')).not.toContainText(draft.subject)

  await unlock(page)
  await openComposer(page)
  for (const name of ['Recipient', 'Reply subject', 'Original message — optional reference', 'Your reply']) {
    await expect(page.getByRole('textbox', { name, exact: true })).toHaveValue('')
  }
  await expect(page.getByRole('region', { name: 'Review the complete outgoing reply', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Confirm and send this reply', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Optional advanced details', exact: true })).toHaveAttribute('aria-expanded', 'false')
  await page.getByRole('button', { name: 'Optional advanced details', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Original Message-ID', exact: true })).toHaveValue('')
  await expectNoPrivateStorage(page)
  expect(await page.evaluate(key => localStorage.getItem(key), receiptKey)).toBeNull()
  expect(harness.sends).toHaveLength(0)
})
