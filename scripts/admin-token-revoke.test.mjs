import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const SCRIPT = fileURLToPath(new URL('./admin-token-revoke.mjs', import.meta.url))
const SCRIPT_SOURCE = new URL('./admin-token-revoke.mjs', import.meta.url)
const ADMIN_TOKEN = `iam_admin_${'b'.repeat(43)}`
const TOKEN_ID_A = '11111111-1111-4111-8111-111111111111'
const TOKEN_ID_B = '22222222-2222-4222-8222-222222222222'
const TOKEN_ID_C = '33333333-3333-4333-8333-333333333333'
const ADMIN_ID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ADMIN_ID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const IDEMPOTENCY_KEY = '44444444-4444-4444-8444-444444444444'
const APPLY_REFS = ['--case-id', 'SEC-2026-002', '--approval-ref', 'change-5678']

const INVENTORY = [
  {
    id: TOKEN_ID_A,
    admin_id: ADMIN_ID_A,
    admin_name: 'Alice',
    admin_email: 'old-alice@example.edu',
    role: 'operator',
    created_at: '2026-07-01T00:00:00Z',
    last_used_at: '2026-07-18T00:00:00Z',
    expires_at: '2099-01-01T00:00:00Z',
    revoked_at: null,
  },
  {
    id: TOKEN_ID_B,
    admin_id: ADMIN_ID_A,
    admin_name: 'Alice Updated',
    admin_email: 'alice-new@example.edu',
    role: 'security_admin',
    created_at: '2026-07-02T00:00:00Z',
    last_used_at: null,
    expires_at: '2099-01-01T00:00:00Z',
    revoked_at: null,
  },
  {
    id: TOKEN_ID_C,
    admin_id: ADMIN_ID_B,
    admin_name: 'Bob',
    admin_email: 'old-alice@example.edu',
    role: 'owner',
    created_at: '2026-01-01T00:00:00Z',
    last_used_at: null,
    expires_at: '2026-02-01T00:00:00Z',
    revoked_at: null,
  },
  {
    id: '55555555-5555-4555-8555-555555555555',
    admin_id: ADMIN_ID_B,
    admin_name: 'Bob',
    admin_email: 'bob@example.edu',
    role: 'operator',
    created_at: '2026-01-01T00:00:00Z',
    last_used_at: null,
    expires_at: null,
    revoked_at: '2026-06-01T00:00:00Z',
  },
]

function runRevoke(args, origin = 'http://127.0.0.1:9') {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      env: {
        ...process.env,
        ADMIN_API_ORIGIN: origin,
        ADMIN_TOKEN,
        SUPABASE_URL: '',
        SUPABASE_SECRET_KEY: '',
        SUPABASE_SERVICE_ROLE_KEY: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk })
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('admin-token-revoke subprocess timed out'))
    }, 20_000)
    child.once('error', error => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('close', (code, signal) => {
      clearTimeout(timer)
      resolve({ code, signal, stdout, stderr })
    })
  })
}

async function withMockAdmin(options, fn) {
  const requests = []
  let revokeRequests = 0
  const server = createServer(async (request, response) => {
    try {
      let rawBody = ''
      for await (const chunk of request) rawBody += chunk
      const url = new URL(request.url, 'http://mock.local')
      requests.push({
        method: request.method,
        pathname: url.pathname,
        search: url.search,
        headers: request.headers,
        body: rawBody ? JSON.parse(rawBody) : null,
      })
      response.setHeader('content-type', 'application/json')

      if (request.method === 'GET' && url.pathname === '/api/admin' && url.searchParams.get('resource') === 'tokens') {
        response.statusCode = options.inventoryStatus || 200
        response.end(options.inventoryRawBody ?? JSON.stringify(
          options.inventoryBody || { data: { tokens: options.inventory || INVENTORY } },
        ))
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/admin') {
        revokeRequests++
        if (revokeRequests <= (options.dropRevokeResponses || 0)) {
          request.socket.destroy()
          return
        }
        response.statusCode = options.revokeStatus || 200
        response.end(options.revokeRawBody ?? JSON.stringify(
          options.revokeBody || (
            requests.at(-1)?.body?.action === 'revoke_token'
              ? { success: true }
              : {
                  data: {
                    admin_id: requests.at(-1)?.body?.admin_id,
                    token_ids: [TOKEN_ID_A],
                    revoked_count: 1,
                  },
                }
          ),
        ))
        return
      }
      response.statusCode = 404
      response.end(JSON.stringify({ error: 'unexpected_test_route' }))
    } catch (error) {
      response.statusCode = 500
      response.end(JSON.stringify({ error: error.message }))
    }
  })

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  try {
    return await fn(`http://127.0.0.1:${address.port}`, requests)
  } finally {
    server.close()
    await once(server, 'close')
  }
}

test('revoke validates one authoritative selector and governance inputs before network access', async () => {
  for (const [args, pattern] of [
    [[], /Choose exactly one selector/],
    [['--list', '--id', TOKEN_ID_A], /Choose exactly one selector/],
    [['--id', 'not-a-uuid'], /--id must be a UUID/],
    [['--admin-id', 'not-a-uuid'], /--admin-id must be a UUID/],
    [['--list', '--apply'], /--list cannot be combined/],
    [['--email', 'old-alice@example.edu', '--apply'], /dry-run only/],
    [['--id', TOKEN_ID_A, '--apply'], /--case-id is required/],
    [['--id', TOKEN_ID_A, '--case-id', 'x', '--apply'], /--approval-ref is required/],
    [['--id', TOKEN_ID_A, '--idempotency-key', 'bad'], /--idempotency-key must be a UUID/],
    [['--id', TOKEN_ID_A, '--id', TOKEN_ID_B], /Duplicate argument: --id/],
    [['--id', TOKEN_ID_A, '--case-id', 'bad\nref', '--approval-ref', 'y', '--apply'], /--case-id is required/],
  ]) {
    const result = await runRevoke(args)
    assert.equal(result.code, 1, JSON.stringify(args))
    assert.match(result.stderr, pattern)
  }
})

test('inventory computes active, expired and revoked states from expires_at and role-aware rows', async () => {
  await withMockAdmin({}, async (origin, requests) => {
    const active = await runRevoke(['--list'], origin)
    assert.equal(active.code, 0, active.stderr)
    assert.match(active.stdout, /2 active, 1 expired, 1 revoked, 4 total/)
    assert.match(active.stdout, /role: operator/)
    assert.match(active.stdout, /role: security_admin/)
    assert.doesNotMatch(active.stdout, /EXPIRED/)
    assert.doesNotMatch(active.stdout, /REVOKED/)

    const all = await runRevoke(['--list', '--show-inactive'], origin)
    assert.equal(all.code, 0, all.stderr)
    assert.match(all.stdout, /EXPIRED/)
    assert.match(all.stdout, /REVOKED/)
    assert.equal(requests.length, 2)
    for (const request of requests) {
      assert.equal(request.headers.authorization, `Bearer ${ADMIN_TOKEN}`)
      assert.equal(request.search, '?resource=tokens')
    }
  })
})

test('inventory neutralizes terminal control and bidi characters from cached identity snapshots', async () => {
  const injected = [{
    ...INVENTORY[0],
    admin_name: 'Eve\u001b[31m',
    admin_email: 'eve@example.edu\u202e',
  }]
  await withMockAdmin({ inventory: injected }, async (origin) => {
    const result = await runRevoke(['--list'], origin)
    assert.equal(result.code, 0, result.stderr)
    assert.doesNotMatch(result.stdout, /\u001b/)
    assert.doesNotMatch(result.stdout, /\u202e/)
    assert.match(result.stdout, /Eve\?\[31m/)
  })
})

test('single-token apply calls revoke_token with Bearer auth and one caller idempotency key', async () => {
  await withMockAdmin({}, async (origin, requests) => {
    const result = await runRevoke([
      '--id', TOKEN_ID_A,
      ...APPLY_REFS,
      '--idempotency-key', IDEMPOTENCY_KEY,
      '--apply',
    ], origin)
    assert.equal(result.code, 0, result.stderr)
    assert.deepEqual(requests.map(({ method, pathname }) => [method, pathname]), [
      ['GET', '/api/admin'],
      ['POST', '/api/admin'],
    ])
    const request = requests[1]
    assert.equal(request.headers.authorization, `Bearer ${ADMIN_TOKEN}`)
    assert.equal(request.headers['idempotency-key'], IDEMPOTENCY_KEY)
    assert.deepEqual(request.body, {
      action: 'revoke_token',
      token_id: TOKEN_ID_A,
      case_id: 'SEC-2026-002',
      approval_ref: 'change-5678',
    })
  })
})

test('authoritative admin-id apply uses one atomic batch action instead of cached email or per-row writes', async () => {
  await withMockAdmin({
    revokeBody: {
      data: {
        admin_id: ADMIN_ID_A,
        token_ids: [TOKEN_ID_A, TOKEN_ID_B],
        revoked_count: 2,
      },
    },
  }, async (origin, requests) => {
    const result = await runRevoke([
      '--admin-id', ADMIN_ID_A,
      ...APPLY_REFS,
      '--idempotency-key', IDEMPOTENCY_KEY,
      '--apply',
    ], origin)
    assert.equal(result.code, 0, result.stderr)
    assert.match(result.stdout, /2 token\(s\) revoked/)
    assert.equal(requests.filter(request => request.method === 'POST').length, 1)
    assert.deepEqual(requests[1].body, {
      action: 'revoke_admin_tokens',
      admin_id: ADMIN_ID_A,
      case_id: 'SEC-2026-002',
      approval_ref: 'change-5678',
    })
    assert.equal('admin_email' in requests[1].body, false)
  })
})

test('email remains read-only discovery and prints authoritative admin IDs without posting', async () => {
  await withMockAdmin({}, async (origin, requests) => {
    const result = await runRevoke(['--email', 'OLD-ALICE@EXAMPLE.EDU'], origin)
    assert.equal(result.code, 0, result.stderr)
    assert.match(result.stdout, new RegExp(ADMIN_ID_A))
    assert.match(result.stdout, new RegExp(ADMIN_ID_B))
    assert.match(result.stdout, /maps to multiple admin_id values/)
    assert.match(result.stdout, /Apply is intentionally unavailable by email/)
    assert.deepEqual(requests.map(({ method }) => method), ['GET'])
  })
})

test('expired but unrevoked token remains revocable for audited stale-credential cleanup', async () => {
  await withMockAdmin({}, async (origin, requests) => {
    const result = await runRevoke([
      '--id', TOKEN_ID_C,
      ...APPLY_REFS,
      '--idempotency-key', IDEMPOTENCY_KEY,
      '--apply',
    ], origin)
    assert.equal(result.code, 0, result.stderr)
    assert.match(result.stdout, /EXPIRED/)
    assert.deepEqual(requests.map(({ method }) => method), ['GET', 'POST'])
    assert.equal(requests[1].body.action, 'revoke_token')
    assert.equal(requests[1].body.token_id, TOKEN_ID_C)
  })
})

test('revocation failure exposes only a stable error and the same reconciliation key', async () => {
  await withMockAdmin({ revokeStatus: 409, revokeBody: { error: 'last_active_admin_token' } }, async (origin) => {
    const result = await runRevoke([
      '--id', TOKEN_ID_A,
      ...APPLY_REFS,
      '--idempotency-key', IDEMPOTENCY_KEY,
      '--apply',
    ], origin)
    assert.equal(result.code, 3)
    assert.match(result.stderr, /last_active_admin_token/)
    assert.match(result.stderr, new RegExp(IDEMPOTENCY_KEY))
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(ADMIN_TOKEN))
  })
})

test('response loss can replay the same idempotency key even after inventory shows the token revoked', async () => {
  await withMockAdmin({ dropRevokeResponses: 1 }, async (origin) => {
    const result = await runRevoke([
      '--id', TOKEN_ID_A,
      ...APPLY_REFS,
      '--idempotency-key', IDEMPOTENCY_KEY,
      '--apply',
    ], origin)
    assert.equal(result.code, 3)
    assert.match(result.stderr, /admin_outcome_unknown/)
    assert.match(result.stderr, new RegExp(IDEMPOTENCY_KEY))
  })

  const replayInventory = INVENTORY.map(row => row.id === TOKEN_ID_A
    ? { ...row, revoked_at: '2026-07-19T00:00:00Z' }
    : row)
  await withMockAdmin({ inventory: replayInventory }, async (origin, requests) => {
    const result = await runRevoke([
      '--id', TOKEN_ID_A,
      ...APPLY_REFS,
      '--idempotency-key', IDEMPOTENCY_KEY,
      '--apply',
    ], origin)
    assert.equal(result.code, 0, result.stderr)
    assert.match(result.stdout, /replaying only to reconcile/)
    assert.deepEqual(requests.map(({ method }) => method), ['GET', 'POST'])
    assert.equal(requests[1].headers['idempotency-key'], IDEMPOTENCY_KEY)
    assert.equal(requests[1].body.token_id, TOKEN_ID_A)
  })
})

test('a malformed 2xx revocation result is not reported as completed', async () => {
  await withMockAdmin({ revokeBody: { data: {} } }, async (origin) => {
    const result = await runRevoke([
      '--id', TOKEN_ID_A,
      ...APPLY_REFS,
      '--idempotency-key', IDEMPOTENCY_KEY,
      '--apply',
    ], origin)
    assert.equal(result.code, 3)
    assert.match(result.stderr, /admin_outcome_unknown/)
    assert.match(result.stderr, new RegExp(IDEMPOTENCY_KEY))
    assert.doesNotMatch(result.stdout, /Revocation completed/)
  })
})

test('single and batch revocation require exact action-bound 2xx results', async () => {
  const cases = [
    {
      args: ['--id', TOKEN_ID_A],
      body: { success: true, unexpected: true },
    },
    {
      args: ['--admin-id', ADMIN_ID_A],
      body: { data: { revoked_count: 0 } },
    },
    {
      args: ['--admin-id', ADMIN_ID_A],
      body: { data: { admin_id: ADMIN_ID_B, token_ids: [TOKEN_ID_A], revoked_count: 1 } },
    },
    {
      args: ['--admin-id', ADMIN_ID_A],
      body: { data: { admin_id: ADMIN_ID_A, token_ids: [TOKEN_ID_A], revoked_count: 2 } },
    },
    {
      args: ['--admin-id', ADMIN_ID_A],
      body: { data: { admin_id: ADMIN_ID_A, token_ids: [], revoked_count: 0 } },
    },
  ]
  for (const fixture of cases) {
    await withMockAdmin({ revokeBody: fixture.body }, async origin => {
      const result = await runRevoke([
        ...fixture.args,
        ...APPLY_REFS,
        '--idempotency-key', IDEMPOTENCY_KEY,
        '--apply',
      ], origin)
      assert.equal(result.code, 3)
      assert.match(result.stderr, /admin_outcome_unknown/)
      assert.doesNotMatch(result.stdout, /Revocation completed/)
    })
  }
})

test('a revoked token can still be inspected in dry-run without claiming a replay key', async () => {
  const revokedId = INVENTORY[3].id
  await withMockAdmin({}, async (origin, requests) => {
    const result = await runRevoke(['--id', revokedId], origin)
    assert.equal(result.code, 0, result.stderr)
    assert.match(result.stdout, /REVOKED/)
    assert.match(result.stdout, /Re-run with --apply/)
    assert.deepEqual(requests.map(({ method }) => method), ['GET'])
  })
})

test('revoke source has no service-key, direct PostgREST PATCH, or email apply path', async () => {
  const source = await readFile(SCRIPT_SOURCE, 'utf8')
  assert.doesNotMatch(source, /SUPABASE_(?:URL|SECRET_KEY|SERVICE_ROLE_KEY)/)
  assert.doesNotMatch(source, /\/rest\/v1\/admin_tokens/)
  assert.doesNotMatch(source, /method:\s*['"]PATCH['"]/)
  assert.match(source, /Authorization: `Bearer \$\{ADMIN_TOKEN\}`/)
  assert.match(source, /'Idempotency-Key': idempotencyKey/)
  assert.match(source, /action: 'revoke_admin_tokens'/)
  assert.match(source, /EMAIL && APPLY[\s\S]*dry-run only/)
})
