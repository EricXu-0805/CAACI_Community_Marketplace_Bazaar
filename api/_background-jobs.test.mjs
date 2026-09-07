// Leading underscore prevents Vercel from treating this test as an API Function.
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { inlineSharedApiImports } from './_test-module-loader.mjs'

const API_URL = new URL('./background-jobs.js', import.meta.url)
const CRON_SECRET = 'background-jobs-cron-secret'
const SERVICE_KEY = 'background-jobs-service-key'
const ENV_KEYS = [
  'SUPABASE_URL', 'VITE_SUPABASE_URL', 'SUPABASE_SECRET_KEY',
  'SUPABASE_SERVICE_ROLE_KEY', 'CRON_SECRET',
  // Without these the failure paths would POST to a developer's real Sentry
  // and break the fetch-call assertions below.
  'SENTRY_DSN', 'VITE_SENTRY_DSN',
]
const originalEnv = new Map(ENV_KEYS.map(key => [key, process.env[key]]))
const originalFetch = globalThis.fetch
const originalConsoleError = console.error
let importNonce = 0


afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key)
    if (value == null) delete process.env[key]
    else process.env[key] = value
  }
  globalThis.fetch = originalFetch
  console.error = originalConsoleError
})

async function loadHandler(overrides = {}) {
  for (const key of ENV_KEYS) delete process.env[key]
  Object.assign(process.env, {
    SUPABASE_URL: 'https://supabase.test',
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
    CRON_SECRET,
    ...overrides,
  })
  const source = await readFile(API_URL, 'utf8')
  const encoded = Buffer.from(inlineSharedApiImports(source)).toString('base64')
  return (await import(`data:text/javascript;base64,${encoded}#background-jobs-${importNonce++}`)).default
}

function request({ method = 'GET', secret = CRON_SECRET } = {}) {
  return new Request('https://app.test/api/background-jobs', {
    method,
    headers: secret == null ? {} : { Authorization: `Bearer ${secret}` },
  })
}

function response(payload, status = 200) {
  return new Response(typeof payload === 'string' ? payload : JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TOKEN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const OWNER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const IMAGE = `https://supabase.test/storage/v1/object/public/item-images/items/${OWNER}/test.png`
const JOB = { id: ID, lease_token: TOKEN, owner_id: OWNER, image_url: IMAGE }
const BACKLOG = { listing_pending: 0, listing_oldest_seconds: 0, media_pending: 0, media_failed: 0 }

function mock(options = {}) {
  const calls=[]
  const jobs=[...(options.jobs || [])]
  const batches=[...(options.batches || [])]
  globalThis.fetch=async (input,init={}) => {
    const url=new URL(String(input))
    const body=init.body ? JSON.parse(init.body) : null
    calls.push({url,body,init})
    if(url.pathname.endsWith('/claim_moderation_media_job')) return response(jobs.shift() ?? null)
    if(url.pathname.endsWith('/finish_moderation_media_job')) return response(options.finish ?? true)
    if(url.pathname.endsWith('/process_listing_notification_job')) return response(batches.shift() ?? options.repeatBatch ?? {worked:false,scanned:0,inserted:0})
    if(url.pathname.endsWith('/purge_completed_background_jobs')) return response(0)
    if(url.pathname.endsWith('/background_job_status')) return response(options.backlog || BACKLOG)
    if(url.pathname.startsWith('/storage/v1/cdn/item-images/')) return response(options.purgeBody ?? {message:'success'},options.purgeStatus || 200)
    if(url.pathname==='/storage/v1/object/move') {
      if(options.moveThrow) throw new Error('untrusted provider credentials and object detail')
      return response(options.moveBody || {}, options.moveStatus || 200)
    }
    throw new Error(`unexpected call ${url.pathname}`)
  }
  return calls
}

test('worker rejects unauthorized, wrong-method and unconfigured requests without touching data', async () => {
  for(const [env,req,status] of [
    [{},request({secret:null}),401],[{},request({secret:'wrong'}),401],
    [{},request({method:'POST'}),405],[{CRON_SECRET:''},request(),503],
    [{SUPABASE_URL:''},request(),503],
  ]) {
    const calls=mock();const handler=await loadHandler(env)
    assert.equal((await handler(req)).status,status);assert.equal(calls.length,0)
  }
})
test('leased evidence moves only its own key and acknowledges the exact lease', async () => {
  const calls=mock({jobs:[JOB],batches:[{worked:true,scanned:200,inserted:150}]})
  const handler=await loadHandler();const result=await handler(request())
  assert.equal(result.status,200)
  assert.deepEqual(await result.json(),{success:true,listing_batches:1,notifications:150,media_completed:1,media_retried:0,media_cancelled:0,backlog:BACKLOG})
  assert.deepEqual(calls.find(c=>c.url.pathname==='/storage/v1/object/move').body,{
    bucketId:'item-images',sourceKey:`items/${OWNER}/test.png`,destinationBucket:'moderation-evidence',destinationKey:`items/${OWNER}/test.png`,
  })
  assert.deepEqual(calls.find(c=>c.url.pathname.endsWith('/finish_moderation_media_job')).body,{
    id_in:ID,lease_in:TOKEN,outcome_in:'complete',
  })
  assert.equal(calls.filter(c=>c.url.pathname===`/storage/v1/cdn/item-images/items/${OWNER}/test.png`).length,1)
  assert.ok(calls.every(c=>c.init.redirect==='manual'))
  assert.ok(calls.every(c=>new Headers(c.init.headers).get('apikey')===SERVICE_KEY))
})
test('hostile URLs and other owners are cancelled without storage requests', async () => {
  for(const url of [IMAGE.replace('supabase.test','evil.test'),IMAGE.replace(OWNER,ID),
    IMAGE.replace('test.png','../../banners/test.png'),IMAGE.replace('test.png','%2e%2e%2fbanners%2fx.png'),
    IMAGE.replace('test.png','bad%00.png'),'not a URL']) {
    const calls=mock({jobs:[{...JOB,image_url:url}]});const handler=await loadHandler()
    assert.equal((await handler(request())).status,200)
    assert.equal(calls.filter(c=>c.url.pathname.startsWith('/storage/')).length,0)
    assert.equal(calls.find(c=>c.url.pathname.endsWith('/finish_moderation_media_job')).body.outcome_in,'invalid_reference')
  }
})
test('provider failure and redirect persist retries, exposing no private path or provider message', async () => {
  console.error=()=>{}
  for(const options of [{moveThrow:true},{moveStatus:503},{moveStatus:302},{moveStatus:400,moveBody:{error:'other',statusCode:'404'}}]) {
    const calls=mock({...options,jobs:[JOB]});const handler=await loadHandler()
    const result=await handler(request());const raw=await result.text()
    assert.equal(JSON.parse(raw).media_retried,1)
    assert.doesNotMatch(raw,/test.png|untrusted|cccccccc/)
    assert.equal(calls.find(c=>c.url.pathname.endsWith('/finish_moderation_media_job')).body.outcome_in,'storage_unavailable')
  }
})
test('a replay with a missing public source completes instead of retrying forever', async () => {
  for(const options of [{moveStatus:404},{moveStatus:400,moveBody:{statusCode:'404',error:'not_found',message:'Object not found'}}]) {
    mock({...options,jobs:[JOB]});const handler=await loadHandler()
    assert.equal((await (await handler(request())).json()).media_completed,1)
  }
})
test('a moved image stays retryable until exact-path cache invalidation is accepted', async () => {
  console.error=()=>{}
  const calls=mock({jobs:[JOB],purgeStatus:503});const handler=await loadHandler()
  const result=await (await handler(request())).json()
  assert.equal(result.media_completed,0);assert.equal(result.media_retried,1)
  assert.equal(calls.find(c=>c.url.pathname.endsWith('/finish_moderation_media_job')).body.outcome_in,'storage_unavailable')
})
test('a malformed successful purge response cannot acknowledge image processing',async()=>{
  console.error=()=>{}
  mock({jobs:[JOB],purgeBody:'<html>not a receipt</html>'});const handler=await loadHandler()
  const result=await (await handler(request())).json()
  assert.equal(result.media_completed,0);assert.equal(result.media_retried,1)
})
test('a lost lease or malformed claim returns retryable failure and cannot report completion', async () => {
  console.error=()=>{}
  for(const options of [{jobs:[JOB],finish:false},{jobs:[{...JOB,lease_token:'bad'}]}]) {
    const calls=mock(options);const handler=await loadHandler();const result=await handler(request())
    assert.equal(result.status,503);assert.equal((await result.json()).media_completed,0)
    assert.equal(calls.filter(c=>c.url.pathname.endsWith('/process_listing_notification_job')).length,0)
  }
})
test('restored content cancels without storage work', async () => {
  const calls=mock({jobs:[{cancelled:true}]});const handler=await loadHandler()
  assert.equal((await (await handler(request())).json()).media_cancelled,1)
  assert.equal(calls.filter(c=>c.url.pathname.startsWith('/storage/')).length,0)
})
test('each invocation has bounded claims and batches even with a full backlog', async () => {
  const calls=mock({jobs:Array(10).fill(JOB),repeatBatch:{worked:true,scanned:200,inserted:200}})
  const handler=await loadHandler();const result=await handler(request())
  assert.equal(result.status,200)
  assert.equal(calls.filter(c=>c.url.pathname.endsWith('/claim_moderation_media_job')).length,3)
  assert.equal(calls.filter(c=>c.url.pathname.endsWith('/process_listing_notification_job')).length,100)
})
test('terminal media failure is visible to cron monitoring and does not leak the failed object', async () => {
  console.error=()=>{};mock({backlog:{...BACKLOG,media_failed:1}})
  const handler=await loadHandler();const result=await handler(request())
  assert.equal(result.status,503);assert.equal((await result.json()).success,false)
})
test('background worker has an every-minute production schedule', async () => {
  const vercel=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'))
  assert.deepEqual(vercel.crons.filter(job=>job.path==='/api/background-jobs'),[{path:'/api/background-jobs',schedule:'* * * * *'}])
})
