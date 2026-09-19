import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
const source = readFileSync(new URL('_video-moderation.js', import.meta.url), 'utf8')
const { videoRequestHeaders, videoVerdict, moderateVideoJob } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))
const credentials = { secretId: 'AKIDexample123', secretKey: 'secretExample123', region: 'ap-guangzhou' }
const dataId = '11111111-1111-4111-8111-111111111111', lease = '22222222-2222-4222-8222-222222222222'
const path = `items/${dataId}/${lease}/33333333-3333-4333-8333-333333333333.mp4`
const env = { CHAT_VIDEO_MODERATION_ENABLED: 'true', TENCENT_VIDEO_SECRET_ID: credentials.secretId,
  TENCENT_VIDEO_SECRET_KEY: credentials.secretKey, TENCENT_VIDEO_REGION: credentials.region, TENCENT_VIDEO_BIZ_TYPE: 'private_chat' }
function fixture({ task = null, provider, failProvider, signed } = {}) {
  const calls = [], requests = []
  const job = { path, data_id: dataId, lease, task_id: task, state: task ? 'processing' : 'submitting' }
  const options = { env, origin: 'https://trusted.supabase.co', serviceHeaders: extra => ({ apikey: 'private-service', ...extra }),
    call: async (name, args) => { calls.push({ name, args }); return name === 'claim_chat_video_review' ? job : true },
    request: async (url, init) => {
      requests.push({ url: String(url), init })
      if (String(url).includes('/storage/')) return { response: new Response('{}'), text: JSON.stringify({ signedURL: signed || `/object/sign/chat-media/${path}?token=private-capability` }) }
      if (failProvider) throw Error('private credentials in raw provider error')
      return { response: new Response('{}'), text: JSON.stringify({ Response: provider || { Results: [{ Code: 'OK', DataId: dataId, TaskId: 'provider-task' }] } }) }
    } }
  return { options, calls, requests, job }
}
test('TC3 signature matches an independent Node crypto calculation', async () => {
  const body = '{"TaskId":"fixture"}', time = 1750000000, date = '2025-06-15'
  const sha = s => createHash('sha256').update(s).digest('hex')
  const mac = (k, s) => createHmac('sha256', k).update(s).digest()
  const canonical = `POST\n/\n\ncontent-type:application/json; charset=utf-8\nhost:vm.tencentcloudapi.com\n\ncontent-type;host\n${sha(body)}`
  const key = mac(mac(mac('TC3' + credentials.secretKey, date), 'vm'), 'tc3_request')
  const expected = mac(key, `TC3-HMAC-SHA256\n${time}\n${date}/vm/tc3_request\n${sha(canonical)}`).toString('hex')
  const headers = await videoRequestHeaders(credentials, 'DescribeTaskDetail', body, time)
  assert.ok(headers.Authorization.endsWith('Signature=' + expected))
  assert.equal(headers['X-TC-Version'], '2021-09-22')
})
test('disabled or invalid provider configuration never claims or bills a job', async () => {
  const f = fixture()
  assert.deepEqual(await moderateVideoJob({ ...f.options, env: {} }), { state: 'disabled' })
  assert.equal(f.calls.length, 0)
  await assert.rejects(moderateVideoJob({ ...f.options, env: { ...env, TENCENT_VIDEO_SECRET_ID: '' } }), /configuration/)
  assert.equal(f.calls.length, 0)
})
test('first submission binds the private object and persists the task without permitting delivery', async () => {
  const f = fixture(); assert.deepEqual(await moderateVideoJob(f.options), { state: 'processing' })
  const request = f.requests[1]
  assert.equal(request.url, 'https://vm.tencentcloudapi.com/')
  assert.equal(request.init.headers.apikey, undefined)
  assert.equal(JSON.parse(request.init.body).Tasks[0].DataId, dataId)
  assert.equal(f.calls.at(-1).args.state_in, 'processing')
  assert.equal(f.calls.at(-1).args.task_in, 'provider-task')
})
test('a lost creation response goes to review instead of retrying a billable request', async () => {
  const f = fixture({ failProvider: true }); assert.deepEqual(await moderateVideoJob(f.options), { state: 'review' })
  assert.equal(f.requests.length, 2); assert.equal(f.calls.at(-1).args.task_in, null)
})
test('a signed URL outside our exact immutable object is never sent to the provider', async () => {
  const f = fixture({ signed: 'https://attacker.test/video?token=stolen' })
  assert.deepEqual(await moderateVideoJob(f.options), { state: 'review' }); assert.equal(f.requests.length, 1)
})
test('only a matching completed Pass verdict permits delivery', async () => {
  const good = { TaskId: 't1', DataId: dataId, BizType: 'private_chat', Type: 'VIDEO', Status: 'FINISH', Suggestion: 'Pass' }
  const f = fixture({ task: 't1', provider: good })
  assert.deepEqual(await moderateVideoJob(f.options), { state: 'passed' })
  assert.equal(f.requests.length, 1); assert.equal(f.requests[0].init.headers['X-TC-Action'], 'DescribeTaskDetail')
  for (const [field, value] of [['TaskId', 'wrong'], ['DataId', 'wrong'], ['Type', 'LIVE_VIDEO'], ['BizType', 'wrong'], ['Status', 'unknown'], ['ErrorType', 'DECODE_ERROR']]) {
    assert.throws(() => videoVerdict({ ...good, [field]: value }, f.job, 'private_chat'), /invalid/)
  }
  for (const [suggestion, expected] of [['Review', 'review'], ['Block', 'blocked'], ['unknown', 'review']]) {
    assert.equal(videoVerdict({ ...good, Suggestion: suggestion }, f.job, 'private_chat'), expected)
  }
})
test('a polling timeout stays pending and never creates a second task', async () => {
  const f = fixture({ task: 't1', failProvider: true })
  assert.deepEqual(await moderateVideoJob(f.options), { state: 'processing' })
  assert.equal(f.requests.length, 1); assert.equal(f.calls.at(-1).args.task_in, 't1')
})
test('a stolen or expired lease cannot finalize a verdict', async () => {
  const f = fixture(); const call = f.options.call
  f.options.call = async (...args) => args[0] === 'finish_chat_video_review' ? false : call(...args)
  await assert.rejects(moderateVideoJob(f.options), /lease_lost/)
})
