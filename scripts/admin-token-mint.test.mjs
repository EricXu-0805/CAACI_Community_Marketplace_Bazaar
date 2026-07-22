import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const SCRIPT = fileURLToPath(new URL('./admin-token-mint.mjs', import.meta.url))
const SCRIPT_SOURCE = new URL('./admin-token-mint.mjs', import.meta.url)
const SOURCE_ROOT = fileURLToPath(new URL('../', import.meta.url))
const VALID_ADMIN_ID = '11111111-1111-4111-8111-111111111111'
const IDEMPOTENCY_KEY = '22222222-2222-4222-8222-222222222222'
const ADMIN_TOKEN = `iam_admin_${'a'.repeat(43)}`
const OTHER_OWNER_TOKEN = `iam_admin_${'z'.repeat(43)}`
const BASE_ARGS = [
  '--admin-id', VALID_ADMIN_ID,
  '--case-id', 'SEC-2026-001',
  '--approval-ref', 'change-1234',
]

function runMint(args, origin = 'http://127.0.0.1:9', adminToken = ADMIN_TOKEN) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      env: {
        ...process.env,
        ADMIN_API_ORIGIN: origin,
        ADMIN_TOKEN: adminToken,
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
      reject(new Error('admin-token-mint subprocess timed out'))
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
  let issueRequests = 0
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

      if (request.method === 'GET' && url.pathname === '/api/admin' && url.searchParams.get('resource') === 'whoami') {
        response.statusCode = options.preflightStatus || 200
        response.end(JSON.stringify(options.preflightBody || {
          data: {
            admin_id: options.callerAdminId || VALID_ADMIN_ID,
            role: options.callerRole || 'owner',
            capabilities: ['issue_token'],
          },
        }))
        return
      }
      if (request.method === 'GET' && url.pathname === '/api/admin' && url.searchParams.get('resource') === 'token_reconciliation') {
        response.statusCode = options.reconcileStatus || 200
        response.end(JSON.stringify(options.reconcileBody || { data: { found: false } }))
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/admin') {
        issueRequests++
        const sequenced = options.issueSequence?.[issueRequests - 1]
        if (sequenced?.drop) {
          request.socket.destroy()
          return
        }
        if (sequenced) {
          response.statusCode = sequenced.status
          response.end(JSON.stringify(sequenced.body))
          return
        }
        if (issueRequests <= (options.dropIssueResponses || 0)) {
          request.socket.destroy()
          return
        }
        response.statusCode = options.issueStatus || 200
        response.end(options.issueRawBody ?? JSON.stringify(
          options.issueBody || {
            data: {
              token_id: '33333333-3333-4333-8333-333333333333',
              admin_id: requests.at(-1)?.body?.admin_id,
              role: requests.at(-1)?.body?.role,
              expires_at: requests.at(-1)?.body?.expires_at,
            },
          },
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

async function withTempDir(fn) {
  const directory = await mkdtemp(join(tmpdir(), 'admin-token-mint-test-'))
  try {
    return await fn(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('mint rejects missing identity, governance references, legacy PII snapshots and malformed roles locally', async () => {
  for (const [args, pattern] of [
    [[], /--admin-id/],
    [['--admin-id', 'not-a-uuid', '--case-id', 'x', '--approval-ref', 'y'], /--admin-id/],
    [['--admin-id', VALID_ADMIN_ID, '--approval-ref', 'y'], /--case-id/],
    [['--admin-id', VALID_ADMIN_ID, '--case-id', 'x'], /--approval-ref/],
    [[...BASE_ARGS, '--role', 'super_admin'], /--role must be/],
    [[...BASE_ARGS, '--name', 'Alice'], /--name\/--email are not accepted/],
    [[...BASE_ARGS, '--email', 'alice@example.edu'], /--name\/--email are not accepted/],
    [[...BASE_ARGS, '--case-id', 'duplicate'], /Duplicate argument: --case-id/],
    [['--admin-id', VALID_ADMIN_ID, '--case-id', 'bad\nref', '--approval-ref', 'y'], /--case-id/],
  ]) {
    const result = await runMint(args)
    assert.equal(result.code, 1, JSON.stringify(args))
    assert.match(result.stderr, pattern)
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /iam_admin_[A-Za-z0-9_-]{43}(?! bearer)/)
  }
})

test('mint requires privileged confirmation and a two-day owner recovery floor', async () => {
  for (const role of ['security_admin', 'owner']) {
    const result = await runMint([...BASE_ARGS, '--role', role])
    assert.equal(result.code, 1)
    assert.match(result.stderr, new RegExp(`--confirm-privileged-role ${role}`))
  }
  for (const days of ['0', '366', '1.5', 'NaN']) {
    const result = await runMint([...BASE_ARGS, '--expires-days', days])
    assert.equal(result.code, 1)
    assert.match(result.stderr, /--expires-days must be an integer 1-365/)
  }
  const shortOwner = await runMint([
    ...BASE_ARGS,
    '--role', 'owner',
    '--confirm-privileged-role', 'owner',
    '--expires-days', '1',
  ])
  assert.equal(shortOwner.code, 1)
  assert.match(shortOwner.stderr, /--expires-days must be an integer 2-365 for owner/)
})

test('non-TTY apply refuses before network unless an explicit absolute output file is supplied', async () => {
  const missing = await runMint([...BASE_ARGS, '--apply'])
  assert.equal(missing.code, 1)
  assert.match(missing.stderr, /non-TTY mode requires an absolute --output-file or --resume-file/)

  const relative = await runMint([...BASE_ARGS, '--output-file', 'token.txt', '--apply'])
  assert.equal(relative.code, 1)
  assert.match(relative.stderr, /--output-file must be an absolute path/)
})

test('plaintext recovery manifests are rejected inside this source tree before network', async () => {
  const outputFile = join(SOURCE_ROOT, `iam-admin-token-recovery-test-${process.pid}.json`)
  const result = await runMint([...BASE_ARGS, '--output-file', outputFile, '--apply'])
  assert.equal(result.code, 2)
  assert.match(result.stderr, /manifest_path_inside_source_tree/)
  await assert.rejects(stat(outputFile), error => error?.code === 'ENOENT')
})

test('plaintext recovery manifests are rejected inside any Git worktree before network', async () => {
  await withTempDir(async directory => {
    await mkdir(join(directory, '.git'))
    const privateDirectory = join(directory, 'private-vault')
    await mkdir(privateDirectory, { mode: 0o700 })
    const outputFile = join(privateDirectory, 'token-recovery.json')
    const result = await runMint([...BASE_ARGS, '--output-file', outputFile, '--apply'])
    assert.equal(result.code, 2)
    assert.match(result.stderr, /manifest_path_inside_git_worktree/)
    await assert.rejects(stat(outputFile), error => error?.code === 'ENOENT')
  })
})

test('dry-run authenticates the lifecycle caller without generating a credential', async () => {
  await withMockAdmin({}, async (origin, requests) => {
    const result = await runMint(BASE_ARGS, origin)
    assert.equal(result.code, 0, result.stderr)
    assert.match(result.stdout, /DRY-RUN/)
    assert.match(result.stdout, /no credential generated/)
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /iam_admin_[A-Za-z0-9_-]{43}/)
    assert.deepEqual(requests.map(({ method, pathname, search }) => [method, pathname, search]), [
      ['GET', '/api/admin', '?resource=whoami'],
    ])
    assert.equal(requests[0].headers.authorization, `Bearer ${ADMIN_TOKEN}`)
  })
})

test('mint writes plaintext only to a new mode-0600 manifest and sends only its hash to the audited API', async () => {
  await withTempDir(async directory => {
    const outputFile = join(directory, 'new-token.txt')
    await withMockAdmin({}, async (origin, requests) => {
      const before = Date.now()
      const result = await runMint([
        ...BASE_ARGS,
        '--idempotency-key', IDEMPOTENCY_KEY,
        '--output-file', outputFile,
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
      assert.equal(request.body.action, 'issue_token')
      assert.equal(request.body.admin_id, VALID_ADMIN_ID)
      assert.equal(request.body.role, 'operator')
      assert.equal(request.body.case_id, 'SEC-2026-001')
      assert.equal(request.body.approval_ref, 'change-1234')
      assert.equal('admin_name' in request.body, false)
      assert.equal('admin_email' in request.body, false)
      assert.match(request.body.token_hash, /^[0-9a-f]{64}$/)
      const expiry = Date.parse(request.body.expires_at)
      assert.ok(expiry >= before + 89 * 86_400_000)
      assert.ok(expiry <= Date.now() + 91 * 86_400_000)

      const recovery = JSON.parse(await readFile(outputFile, 'utf8'))
      const plaintext = recovery.token
      assert.match(plaintext, /^iam_admin_[A-Za-z0-9_-]{43}$/)
      assert.equal(crypto.createHash('sha256').update(plaintext).digest('hex'), request.body.token_hash)
      assert.equal(recovery.token_hash, request.body.token_hash)
      assert.equal(recovery.idempotency_key, IDEMPOTENCY_KEY)
      assert.equal(
        recovery.issuer_token_hash,
        crypto.createHash('sha256').update(ADMIN_TOKEN).digest('hex'),
      )
      assert.equal(recovery.issuer_admin_id, VALID_ADMIN_ID)
      assert.equal(recovery.admin_id, VALID_ADMIN_ID)
      assert.equal(recovery.case_id, 'SEC-2026-001')
      assert.equal(recovery.approval_ref, 'change-1234')
      assert.equal((await stat(outputFile)).mode & 0o777, 0o600)
      assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(plaintext))
      assert.doesNotMatch(JSON.stringify(request.body), /iam_admin_[A-Za-z0-9_-]{43}/)
      assert.match(result.stdout, /plaintext was not written to stdout/)
    })
  })
})

test('mint uses exclusive create and preserves an existing output file without issuing', async () => {
  await withTempDir(async directory => {
    const outputFile = join(directory, 'existing.txt')
    await writeFile(outputFile, 'keep-me\n', { mode: 0o600 })
    await withMockAdmin({}, async (origin, requests) => {
      const result = await runMint([...BASE_ARGS, '--output-file', outputFile, '--apply'], origin)
      assert.equal(result.code, 3)
      assert.match(result.stderr, /EEXIST/)
      assert.equal(await readFile(outputFile, 'utf8'), 'keep-me\n')
      assert.deepEqual(requests.map(({ method }) => method), ['GET'])
    })
  })
})

test('mint deletes the credential file on a definitive 400 rejection without leaking plaintext', async () => {
  await withTempDir(async directory => {
    const outputFile = join(directory, 'failed-token.txt')
    await withMockAdmin({ issueStatus: 400, issueBody: { error: 'admin_mutation_invalid' } }, async (origin, requests) => {
      const result = await runMint([
        ...BASE_ARGS,
        '--idempotency-key', IDEMPOTENCY_KEY,
        '--output-file', outputFile,
        '--apply',
      ], origin)
      assert.equal(result.code, 3)
      assert.match(result.stderr, /admin_mutation_invalid/)
      assert.match(result.stderr, /recovery manifest removed/)
      await assert.rejects(stat(outputFile), error => error?.code === 'ENOENT')
      assert.equal(requests.length, 2)
      assert.doesNotMatch(`${result.stdout}${result.stderr}`, /iam_admin_[A-Za-z0-9_-]{43}/)
    })
  })
})

test('a 409 conflict never destroys the only plaintext recovery manifest', async () => {
  await withTempDir(async directory => {
    const outputFile = join(directory, 'conflict-token.json')
    await withMockAdmin({ issueStatus: 409, issueBody: { error: 'admin_mutation_conflict' } }, async (origin) => {
      const result = await runMint([
        ...BASE_ARGS,
        '--idempotency-key', IDEMPOTENCY_KEY,
        '--output-file', outputFile,
        '--apply',
      ], origin)
      assert.equal(result.code, 3)
      assert.match(result.stderr, /outcome unknown/)
      assert.match(result.stderr, /manifest retained/)
      assert.ok(await stat(outputFile))
      const recovery = JSON.parse(await readFile(outputFile, 'utf8'))
      assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(recovery.token))
    })
  })
})

test('response loss preserves a recovery manifest and resume replays the identical payload and key', async () => {
  await withTempDir(async directory => {
    const outputFile = join(directory, 'outcome-unknown.json')
    let originalPosts
    await withMockAdmin({ dropIssueResponses: 2 }, async (origin, requests) => {
      const result = await runMint([
        ...BASE_ARGS,
        '--idempotency-key', IDEMPOTENCY_KEY,
        '--output-file', outputFile,
        '--apply',
      ], origin)
      assert.equal(result.code, 3)
      assert.match(result.stderr, /outcome unknown/)
      assert.match(result.stderr, /--resume-file/)
      const recovery = JSON.parse(await readFile(outputFile, 'utf8'))
      assert.match(recovery.token, /^iam_admin_[A-Za-z0-9_-]{43}$/)
      assert.equal((await stat(outputFile)).mode & 0o777, 0o600)
      originalPosts = requests.filter(request => request.method === 'POST')
      assert.equal(originalPosts.length, 2)
      assert.deepEqual(originalPosts[0].body, originalPosts[1].body)
      assert.equal(originalPosts[0].headers['idempotency-key'], IDEMPOTENCY_KEY)
      assert.equal(originalPosts[1].headers['idempotency-key'], IDEMPOTENCY_KEY)
      assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(recovery.token))
    })

    await withMockAdmin({}, async (origin, requests) => {
      const result = await runMint(['--resume-file', outputFile, '--apply'], origin)
      assert.equal(result.code, 0, result.stderr)
      const resumedPost = requests.find(request => request.method === 'POST')
      assert.deepEqual(resumedPost.body, originalPosts[0].body)
      assert.equal(resumedPost.headers['idempotency-key'], IDEMPOTENCY_KEY)
      assert.ok(await stat(outputFile))
      const recovery = JSON.parse(await readFile(outputFile, 'utf8'))
      assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(recovery.token))
    })
  })
})

test('a definitive retry rejection cannot erase plaintext after an earlier outcome-unknown dispatch', async () => {
  await withTempDir(async directory => {
    const outputFile = join(directory, 'sticky-unknown.json')
    await withMockAdmin({
      issueSequence: [
        { drop: true },
        { status: 401, body: { error: 'admin_token_inactive' } },
      ],
    }, async (origin, requests) => {
      const result = await runMint([
        ...BASE_ARGS,
        '--idempotency-key', IDEMPOTENCY_KEY,
        '--output-file', outputFile,
        '--apply',
      ], origin)
      assert.equal(result.code, 3)
      assert.match(result.stderr, /outcome unknown/i)
      assert.equal(requests.filter(request => request.method === 'POST').length, 2)
      const recovery = JSON.parse(await readFile(outputFile, 'utf8'))
      assert.match(recovery.token, /^iam_admin_[A-Za-z0-9_-]{43}$/)
      assert.equal((await stat(outputFile)).mode & 0o777, 0o600)
      assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(recovery.token))
    })
  })
})

test('a replacement owner reconciles a response-lost manifest by authoritative token hash', async () => {
  await withTempDir(async directory => {
    const outputFile = join(directory, 'replacement-owner-reconciliation.json')
    await withMockAdmin({ dropIssueResponses: 2 }, async origin => {
      const created = await runMint([
        ...BASE_ARGS,
        '--idempotency-key', IDEMPOTENCY_KEY,
        '--output-file', outputFile,
        '--apply',
      ], origin)
      assert.equal(created.code, 3)
    })
    const recovery = JSON.parse(await readFile(outputFile, 'utf8'))

    await withMockAdmin({
      reconcileBody: {
        data: {
          found: true,
          token_id: '33333333-3333-4333-8333-333333333333',
          admin_id: recovery.admin_id,
          role: recovery.role,
          expires_at: recovery.expires_at,
          revoked_at: null,
        },
      },
    }, async (origin, requests) => {
      const reconciled = await runMint(
        ['--reconcile-file', outputFile],
        origin,
        OTHER_OWNER_TOKEN,
      )
      assert.equal(reconciled.code, 0, reconciled.stderr)
      assert.match(reconciled.stdout, /Authoritative hash reconciliation succeeded/)
      assert.deepEqual(requests.map(request => [request.method, request.search]), [
        ['GET', '?resource=whoami'],
        ['GET', '?resource=token_reconciliation'],
      ])
      assert.equal(requests[1].headers['x-admin-token-hash'], recovery.token_hash)
      assert.doesNotMatch(`${reconciled.stdout}${reconciled.stderr}`, new RegExp(recovery.token))
      assert.ok(await stat(outputFile))
    })
  })
})

test('replacement-owner reconciliation recognizes detached revocation evidence without vaulting it', async () => {
  await withTempDir(async directory => {
    const outputFile = join(directory, 'detached-reconciliation.json')
    await withMockAdmin({ dropIssueResponses: 2 }, async origin => {
      const created = await runMint([
        ...BASE_ARGS,
        '--idempotency-key', IDEMPOTENCY_KEY,
        '--output-file', outputFile,
        '--apply',
      ], origin)
      assert.equal(created.code, 3)
    })
    const recovery = JSON.parse(await readFile(outputFile, 'utf8'))
    const revokedAt = new Date().toISOString()

    await withMockAdmin({
      reconcileBody: {
        data: {
          found: true,
          token_id: '33333333-3333-4333-8333-333333333333',
          admin_id: null,
          role: recovery.role,
          expires_at: recovery.expires_at,
          revoked_at: revokedAt,
        },
      },
    }, async origin => {
      const reconciled = await runMint(
        ['--reconcile-file', outputFile],
        origin,
        OTHER_OWNER_TOKEN,
      )
      assert.equal(reconciled.code, 0, reconciled.stderr)
      assert.match(reconciled.stdout, /detached and revoked after target-account deletion/)
      assert.match(reconciled.stdout, /issuance committed, but this credential is unusable/)
      assert.match(reconciled.stdout, /Do not import this credential into a vault/)
      assert.doesNotMatch(`${reconciled.stdout}${reconciled.stderr}`, new RegExp(recovery.token))
      assert.ok(await stat(outputFile))
    })
  })
})

test('reconciliation retains the manifest on no match or mismatched 2xx metadata', async () => {
  await withTempDir(async directory => {
    const outputFile = join(directory, 'unresolved-reconciliation.json')
    await withMockAdmin({ dropIssueResponses: 2 }, async origin => {
      const created = await runMint([
        ...BASE_ARGS,
        '--output-file', outputFile,
        '--apply',
      ], origin)
      assert.equal(created.code, 3)
    })
    const recovery = JSON.parse(await readFile(outputFile, 'utf8'))
    for (const reconcileBody of [
      { data: { found: false } },
      {
        data: {
          found: true,
          token_id: '33333333-3333-4333-8333-333333333333',
          admin_id: '99999999-9999-4999-8999-999999999999',
          role: recovery.role,
          expires_at: recovery.expires_at,
          revoked_at: null,
        },
      },
    ]) {
      await withMockAdmin({ reconcileBody }, async origin => {
        const result = await runMint(['--reconcile-file', outputFile], origin, OTHER_OWNER_TOKEN)
        assert.equal(result.code, 3)
        assert.match(result.stderr, /manifest retained/i)
        assert.ok(await stat(outputFile))
      })
    }
  })
})

test('a malformed 2xx issuance result remains outcome-unknown and keeps the recovery manifest', async () => {
  await withTempDir(async directory => {
    const outputFile = join(directory, 'malformed-success.json')
    await withMockAdmin({ issueBody: { data: { success: true } } }, async (origin, requests) => {
      const result = await runMint([
        ...BASE_ARGS,
        '--idempotency-key', IDEMPOTENCY_KEY,
        '--output-file', outputFile,
        '--apply',
      ], origin)
      assert.equal(result.code, 3)
      assert.match(result.stderr, /outcome unknown/)
      assert.match(result.stderr, /--resume-file/)
      assert.equal(requests.filter(request => request.method === 'POST').length, 2)
      assert.ok(await stat(outputFile))
      const recovery = JSON.parse(await readFile(outputFile, 'utf8'))
      assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(recovery.token))
    })
  })
})

test('resume is bound to the exact original issuer token before any network request', async () => {
  await withTempDir(async directory => {
    const outputFile = join(directory, 'issuer-bound.json')
    await withMockAdmin({ dropIssueResponses: 2 }, async (origin) => {
      const created = await runMint([
        ...BASE_ARGS,
        '--idempotency-key', IDEMPOTENCY_KEY,
        '--output-file', outputFile,
        '--apply',
      ], origin)
      assert.equal(created.code, 3)
    })
    const recovery = JSON.parse(await readFile(outputFile, 'utf8'))

    await withMockAdmin({}, async (origin, requests) => {
      const resumed = await runMint(
        ['--resume-file', outputFile, '--apply'],
        origin,
        OTHER_OWNER_TOKEN,
      )
      assert.equal(resumed.code, 2)
      assert.match(resumed.stderr, /exact original owner token/)
      assert.match(resumed.stderr, /Manifest retained/)
      assert.deepEqual(requests, [])
      assert.ok(await stat(outputFile))
      assert.doesNotMatch(`${resumed.stdout}${resumed.stderr}`, new RegExp(recovery.token))
    })
  })
})

test('resume rejects a recovery manifest readable by group or other users before any API call', async () => {
  await withTempDir(async directory => {
    const outputFile = join(directory, 'permissions.json')
    await withMockAdmin({}, async (origin) => {
      const created = await runMint([
        ...BASE_ARGS,
        '--output-file', outputFile,
        '--apply',
      ], origin)
      assert.equal(created.code, 0, created.stderr)
    })
    await chmod(outputFile, 0o644)
    const recovery = JSON.parse(await readFile(outputFile, 'utf8'))
    await withMockAdmin({}, async (origin, requests) => {
      const result = await runMint(['--resume-file', outputFile, '--apply'], origin)
      assert.equal(result.code, 2)
      assert.match(result.stderr, /manifest_permissions_too_broad/)
      assert.deepEqual(requests, [])
      assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(recovery.token))
    })
  })
})

test('security_admin preflight cannot issue any credential and no output file is created', async () => {
  await withTempDir(async directory => {
    const outputFile = join(directory, 'owner-token.txt')
    await withMockAdmin({ callerRole: 'security_admin' }, async (origin, requests) => {
      const result = await runMint([
        ...BASE_ARGS,
        '--output-file', outputFile,
        '--apply',
      ], origin)
      assert.equal(result.code, 2)
      assert.match(result.stderr, /admin_token_lifecycle_capability_required/)
      assert.deepEqual(requests.map(({ method }) => method), ['GET'])
      await assert.rejects(stat(outputFile), error => error?.code === 'ENOENT')
    })
  })
})

test('owner without the deployed issue_token capability fails closed before creating a manifest', async () => {
  await withTempDir(async directory => {
    const outputFile = join(directory, 'missing-capability.json')
    await withMockAdmin({
      preflightBody: {
        data: { admin_id: VALID_ADMIN_ID, role: 'owner', capabilities: ['revoke_token'] },
      },
    }, async (origin, requests) => {
      const result = await runMint([
        ...BASE_ARGS,
        '--output-file', outputFile,
        '--apply',
      ], origin)
      assert.equal(result.code, 2)
      assert.match(result.stderr, /admin_token_lifecycle_capability_required/)
      assert.deepEqual(requests.map(({ method }) => method), ['GET'])
      await assert.rejects(stat(outputFile), error => error?.code === 'ENOENT')
    })
  })
})

test('mint source has no service-key/direct-table path and never logs plaintext', async () => {
  const source = await readFile(SCRIPT_SOURCE, 'utf8')
  assert.doesNotMatch(source, /SUPABASE_(?:URL|SECRET_KEY|SERVICE_ROLE_KEY)/)
  assert.doesNotMatch(source, /\/rest\/v1\/admin_tokens/)
  assert.match(source, /action: 'issue_token'/)
  assert.match(source, /'Idempotency-Key': manifest\.idempotency_key/)
  assert.match(source, /open\(path, 'wx', 0o600\)/)
  assert.match(source, /await handle\.sync\(\)[\s\S]*?await syncParentDirectory\(path\)/)
  assert.ok(source.indexOf('await syncParentDirectory(path)') < source.indexOf('result = await issueToken(manifest)'))
  assert.match(source, /--resume-file/)
  assert.doesNotMatch(source, /console\.(?:log|error|warn)\(\s*plaintext(?:\s*[,)]|\.)/)
  assert.ok(source.indexOf('await preflight()') < source.indexOf('crypto.randomBytes(32)'))
})
