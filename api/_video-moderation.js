// Tencent VM 2021-09-22. Deliberately no client-supplied URL or callback.
// https://cloud.tencent.com/document/product/1265/101000
const HOST = 'vm.tencentcloudapi.com'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PATH = /^items\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(mp4|mov|webm)$/
const encoder = new TextEncoder()
const hex = bytes => Array.from(new Uint8Array(bytes), x => x.toString(16).padStart(2, '0')).join('')
const hash = value => crypto.subtle.digest('SHA-256', encoder.encode(value)).then(hex)
async function hmac(key, value) {
  const imported = await crypto.subtle.importKey('raw', typeof key === 'string' ? encoder.encode(key) : key,
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return crypto.subtle.sign('HMAC', imported, encoder.encode(value))
}

export async function videoRequestHeaders({ secretId, secretKey, region }, action, body, timestamp = Math.floor(Date.now() / 1000)) {
  if (!['CreateVideoModerationTask', 'DescribeTaskDetail'].includes(action)
    || !/^[\w-]{8,128}$/.test(secretId || '') || !/^[\w-]{8,128}$/.test(secretKey || '')
    || !/^[a-z]+-[a-z]+(?:-\d+)?$/.test(region || '') || !Number.isSafeInteger(timestamp)) throw Error('video_configuration_invalid')
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10)
  const scope = `${date}/vm/tc3_request`
  const contentType = 'application/json; charset=utf-8'
  const canonical = `POST\n/\n\ncontent-type:${contentType}\nhost:${HOST}\n\ncontent-type;host\n${await hash(body)}`
  const signingKey = await hmac(await hmac(await hmac('TC3' + secretKey, date), 'vm'), 'tc3_request')
  const signature = hex(await hmac(signingKey, `TC3-HMAC-SHA256\n${timestamp}\n${scope}\n${await hash(canonical)}`))
  return { 'Content-Type': contentType,
    Authorization: `TC3-HMAC-SHA256 Credential=${secretId}/${scope}, SignedHeaders=content-type;host, Signature=${signature}`,
    'X-TC-Action': action, 'X-TC-Version': '2021-09-22', 'X-TC-Region': region, 'X-TC-Timestamp': String(timestamp) }
}

export function videoVerdict(response, job, bizType) {
  if (!response || response.Error || response.TaskId !== job.task_id || response.DataId !== job.data_id
    || response.Type !== 'VIDEO' || response.BizType !== bizType || response.ErrorType) throw Error('video_response_invalid')
  if (['PENDING', 'RUNNING'].includes(response.Status)) return 'processing'
  if (['ERROR', 'CANCELLED'].includes(response.Status)) return 'failed'
  if (response.Status !== 'FINISH') throw Error('video_response_invalid')
  return ({ Pass: 'passed', Review: 'review', Block: 'blocked' })[response.Suggestion] || 'review'
}

export async function moderateVideoJob({ env = process.env, call, request, origin, serviceHeaders, timeoutMs = 5000 }) {
  if (env.CHAT_VIDEO_MODERATION_ENABLED !== 'true') return { state: 'disabled' }
  const credentials = { secretId: env.TENCENT_VIDEO_SECRET_ID, secretKey: env.TENCENT_VIDEO_SECRET_KEY, region: env.TENCENT_VIDEO_REGION }
  const bizType = env.TENCENT_VIDEO_BIZ_TYPE
  if (!/^[a-zA-Z0-9_]{3,32}$/.test(bizType || '')) throw Error('video_configuration_invalid')
  // Validate configuration before leasing a job.
  await videoRequestHeaders(credentials, 'DescribeTaskDetail', '{}')
  const job = await call('claim_chat_video_review')
  if (!job || job.cancelled) return { state: job?.cancelled ? 'cancelled' : 'idle' }
  if (!PATH.test(job.path || '') || !UUID.test(job.data_id || '') || !UUID.test(job.lease || '')
    || !['submitting', 'processing'].includes(job.state)) throw Error('video_claim_invalid')
  let state = 'review', task = job.task_id || null
  try {
    let action, payload
    if (job.state === 'submitting' && !task) {
      const signing = await request(new URL(`/storage/v1/object/sign/chat-media/${job.path}`, origin), {
        method: 'POST', headers: serviceHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ expiresIn: 1800 }),
      }, timeoutMs)
      if (!signing.response.ok) throw Error('video_storage_unavailable')
      const signed = JSON.parse(signing.text).signedURL
      if (typeof signed !== 'string') throw Error('video_storage_unavailable')
      const url = new URL(signed.startsWith('/object/') ? '/storage/v1' + signed : signed, origin)
      if (url.origin !== new URL(origin).origin || url.username || url.password || url.hash
        || url.pathname !== `/storage/v1/object/sign/chat-media/${job.path}` || !url.searchParams.get('token')) throw Error('video_storage_unavailable')
      action = 'CreateVideoModerationTask'
      payload = { BizType: bizType, Type: 'VIDEO', Tasks: [{ DataId: job.data_id, Input: { Type: 'URL', Url: url.href } }] }
    } else if (job.state === 'processing' && typeof task === 'string' && task.length <= 256) {
      action = 'DescribeTaskDetail'; payload = { TaskId: task, ShowAllSegments: false }
    } else throw Error('video_claim_invalid')
    const body = JSON.stringify(payload)
    const result = await request(`https://${HOST}/`, {
      method: 'POST', headers: await videoRequestHeaders(credentials, action, body), body,
    }, timeoutMs)
    if (!result.response.ok) throw Error('video_provider_unavailable')
    const response = JSON.parse(result.text)?.Response
    if (action === 'CreateVideoModerationTask') {
      const entry = response?.Results?.[0]
      if (response.Error || response.Results.length !== 1 || entry?.Code !== 'OK' || entry.DataId !== job.data_id
        || typeof entry.TaskId !== 'string' || entry.TaskId.length < 1 || entry.TaskId.length > 256) throw Error('video_response_invalid')
      task = entry.TaskId; state = 'processing'
    } else state = videoVerdict(response, job, bizType)
  } catch {
    // A creation timeout may already have spent money. Do not resubmit it.
    // Polling is read-only, so an existing task can be retried until the DB TTL.
    state = task && job.state === 'processing' ? 'processing' : 'review'
  }
  if (await call('finish_chat_video_review', { path_in: job.path, lease_in: job.lease, state_in: state, task_in: task }) !== true) throw Error('video_lease_lost')
  return { state }
}
