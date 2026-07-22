import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'

const vercelUrl = new URL('../vercel.json', import.meta.url)

test('global Referrer-Policy sends origin only and never cross-origin path/query data', async () => {
  const config = JSON.parse(await readFile(vercelUrl, 'utf8'))
  const globalHeaders = config.headers.find(rule => rule.source === '/(.*)')?.headers || []
  const policies = globalHeaders
    .filter(header => header.key.toLowerCase() === 'referrer-policy')
    .map(header => header.value)

  assert.deepEqual(policies, ['strict-origin'])
  assert.equal(policies.includes('strict-origin-when-cross-origin'), false)
  assert.equal(policies.includes('unsafe-url'), false)
})
