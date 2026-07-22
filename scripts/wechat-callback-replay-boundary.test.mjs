import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const ROOT = new URL('../', import.meta.url)
const migrationName = '20260722024000_harden_wechat_callback_replay.sql'
const source = path => readFile(new URL(path, ROOT), 'utf8')

test('WeChat callback ledger uses validated event identity and canonical payload digest', async () => {
  const migration = await source(`supabase/migrations/${migrationName}`)

  assert.match(migration, /^BEGIN;/m)
  assert.match(migration, /COMMIT;\s*$/)
  assert.match(migration, /event_key text PRIMARY KEY/)
  assert.match(migration, /payload_sha256 text NOT NULL/)
  assert.doesNotMatch(migration, /signature_sha256 text|body_sha256 text/)
  assert.match(migration, /plaintext `signature`[\s\S]*does not authenticate or encrypt the JSON/)
  assert.match(migration, /msg_signature \+ Encrypt/)
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/)
  assert.match(migration, /REVOKE ALL PRIVILEGES ON TABLE public\.wechat_callback_receipts\s+FROM PUBLIC, anon, authenticated, service_role/)
  assert.match(migration, /existing\.payload_sha256 IS DISTINCT FROM payload_sha256_in[\s\S]*RETURN 'conflict'/)
  assert.match(migration, /existing\.state = 'completed'[\s\S]*RETURN 'completed'/)
  assert.match(migration, /callback_timestamp_in < now_epoch - 300/)
  assert.match(migration, /callback_timestamp_in > now_epoch \+ 60/)
  assert.match(migration, /IF inserted_count = 1 THEN[\s\S]*FOR UPDATE SKIP LOCKED/)
  assert.ok(
    migration.indexOf('IF inserted_count = 1 THEN') <
      migration.indexOf('FOR UPDATE SKIP LOCKED'),
    'retention must occur only after a successful fresh insert',
  )

  for (const rpc of [
    'claim_wechat_callback_receipt',
    'complete_wechat_callback_receipt',
    'release_wechat_callback_receipt',
  ]) {
    assert.match(migration, new RegExp(
      `CREATE FUNCTION public\\.${rpc}[\\s\\S]*?SECURITY DEFINER[\\s\\S]*?SET search_path = pg_catalog`,
    ))
  }

  const complete = migration.slice(
    migration.indexOf('CREATE FUNCTION public.complete_wechat_callback_receipt'),
    migration.indexOf('CREATE FUNCTION public.release_wechat_callback_receipt'),
  )
  assert.match(complete, /event_key_in IS DISTINCT FROM 'wxa_media_check:' \|\| trace_id_in/)
  assert.match(complete, /DELETE FROM public\.wechat_media_checks/)
  assert.match(complete, /changed_count NOT IN \(0, 1\)/)
  assert.doesNotMatch(complete, /changed_count <> 1[\s\S]*media_mapping/)
})

test('callback authenticates and decrypts security-mode media before claim', async () => {
  const callback = await source('api/wechat-callback.js')
  const secureQuery = callback.indexOf('const secureQuery = encryptedQuery(url.searchParams)')
  const bodyRead = callback.indexOf('bodyBytes = await readBoundedBytes(')
  const decrypt = callback.indexOf('const plaintext = await decryptSecurityModeMessage(')
  const parse = callback.indexOf('const event = parseMediaEvent(plaintext)')
  const validate = callback.indexOf("event.Event !== 'wxa_media_check'")
  const canonical = callback.indexOf('const canonicalPayload = JSON.stringify({')
  const claim = callback.indexOf("callbackRpc('claim_wechat_callback_receipt'")
  const mediaGate = callback.indexOf('if (!WECHAT_MEDIA_ASYNC_ENABLED)')

  assert.ok(mediaGate >= 0 && secureQuery > mediaGate && bodyRead > secureQuery
    && decrypt > bodyRead && parse > decrypt && validate > parse
    && canonical > validate && claim > canonical)
  assert.match(callback, /encryptType !== 'aes'/)
  assert.match(callback, /params\.getAll\(name\)/)
  assert.match(callback, /msg_signature/)
  assert.match(callback, /Object\.keys\(envelope\)\.length !== 2/)
  assert.match(callback, /return inner\.trim\(\) \? null : encrypted/)
  assert.match(callback, /\[PUSH_TOKEN, query\.timestamp, query\.nonce, encrypted\]\.sort\(\)\.join\(''\)/)
  assert.match(callback, /name: 'AES-CBC'/)
  assert.match(callback, /ciphertext\.byteLength % 32 !== 0/)
  assert.match(callback, /iv: ENCODING_AES_KEY_BYTES\.slice\(0, 16\)/)
  assert.match(callback, /getUint32\(0, false\)/)
  assert.match(callback, /constantTimeEqual\(appId, WECHAT_APPID\)/)
  assert.match(callback, /event\.appid !== WECHAT_APPID/)
  assert.match(callback, /event\.errcode !== 0/)
  assert.match(callback, /eventKey: `wxa_media_check:\$\{traceId\}`/)
  assert.match(callback, /Event: 'wxa_media_check',[\s\S]*trace_id: traceId,[\s\S]*suggest,/)
  assert.match(callback, /event_key_in: claim\.eventKey/)
  assert.match(callback, /payload_sha256_in: claim\.payloadHash/)
  assert.match(callback, /Plaintext POSTs[\s\S]*compatibility-mode envelopes carrying extra plaintext fields/)
  assert.doesNotMatch(callback, /signatureHash|bodyHash: await sha256Hex\(bodyBytes\)/)
  assert.doesNotMatch(callback, /console\.(?:error|log|warn)\([^\n]*(?:traceId|eventKey|payloadHash|bodyBytes|event)/)
})

test('media enqueue is independently fail-closed without disabling login/text credentials', async () => {
  const gate = await source('api/wechat-seccheck.js')
  assert.match(gate, /process\.env\.WECHAT_MEDIA_ASYNC_ENABLED === 'true'/)
  assert.match(gate, /body\.kind === 'image' && !WECHAT_MEDIA_ASYNC_ENABLED[\s\S]*wechat_media_async_disabled/)
  assert.match(gate, /body\.kind === 'image' && !secureMediaCallbackConfigured\(\)[\s\S]*wechat_media_async_misconfigured/)
  assert.match(gate, /WECHAT_ENCODING_AES_KEY/)
  assert.match(gate, /AppSecret also powers login and synchronous text moderation/)
  const callback = await source('api/wechat-callback.js')
  assert.match(callback, /process\.env\.WECHAT_MEDIA_ASYNC_ENABLED === 'true'/)
  assert.match(callback, /if \(!WECHAT_MEDIA_ASYNC_ENABLED\)[\s\S]*media async disabled/)
  assert.match(callback, /if \(!secureMediaConfigurationValid\(\)\)[\s\S]*secure_callback_configuration_unavailable/)
})

test('companions verify key, owner, arguments and use catalog-only denied checks', async () => {
  const [precheck, verify, regression, manifest, runbook, migration] = await Promise.all([
    source('supabase/_ops/PRECHECK_20260722024000_harden_wechat_callback_replay.sql'),
    source('supabase/_ops/VERIFY_20260722024000_harden_wechat_callback_replay.sql'),
    source('supabase/_ops/REGRESSION_20260722024000_harden_wechat_callback_replay.sql'),
    source('supabase/migrations/manifest.sha256'),
    source('RUNBOOK.md'),
    source(`supabase/migrations/${migrationName}`),
  ])

  for (const operation of [precheck, verify]) {
    assert.match(operation, /BEGIN;[\s\S]*SET TRANSACTION READ ONLY;/)
    assert.match(operation, /ROLLBACK;\s*$/)
  }
  assert.match(precheck, /ARRAY\['trace_id'\]::text\[\]/)
  assert.match(precheck, /created_at', 'timestamp with time zone'/)
  assert.match(precheck, /current_user[\s\S]*'SELECT,DELETE'/)
  assert.match(verify, /ARRAY\['event_key'\]::text\[\]/)
  assert.match(verify, /media_primary_key_columns IS DISTINCT FROM ARRAY\['trace_id'\]::text\[\]/)
  assert.match(verify, /'created_at', 'timestamp with time zone', true/)
  assert.match(verify, /receipt_owner, media_oid, 'SELECT,DELETE'/)
  assert.match(verify, /routine_definition\.proowner IS DISTINCT FROM receipt_owner/)
  assert.match(verify, /routine\.proargnames/)
  assert.match(verify, /'event_key_in', 'payload_sha256_in'/)
  assert.match(regression, /Catalog-only denial checks/)
  assert.doesNotMatch(regression, /anon_rpc_denied|authenticated_rpc_denied|service_table_denied/)
  assert.match(regression, /same event\/different verdict digest was not conflict/)
  assert.match(regression, /zero-row mixed-window mapping completion failed/)
  assert.match(regression, /ROLLBACK;\s*$/)

  const expectedHash = createHash('sha256').update(migration).digest('hex')
  assert.match(manifest, new RegExp(`^${expectedHash}  ${migrationName}$`, 'm'))
  assert.match(runbook, /Production gate:[\s\S]*msg_signature[\s\S]*Encrypt/)
  assert.match(runbook, /Do not roll back to the legacy callback/)
})
