import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import test from 'node:test'

test('synthetic browser sessions isolate WebSockets as well as HTTP', async () => {
  const directory = new URL('./', import.meta.url)
  const unguarded = []
  for (const file of await readdir(directory)) {
    if (!file.endsWith('.spec.ts')) continue
    const source = await readFile(new URL(file, directory), 'utf8')
    if (/access_token\s*:\s*['"](?:stub|expired-fixture)/.test(source)
      && !source.includes('routeWebSocket(')) unguarded.push(file)
  }
  assert.deepEqual(unguarded, [], 'Mock credentials must never reach hosted Realtime')
})
