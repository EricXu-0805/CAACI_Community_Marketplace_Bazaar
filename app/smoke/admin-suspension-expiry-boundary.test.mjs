import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const source = await readFile(
  new URL('../src/pages/admin/index.vue', import.meta.url),
  'utf8',
)

test('expired suspension and appeal cards are labelled without a stale lift action', () => {
  assert.match(
    source,
    /v-if="!s\.lifted_at && !isExpired\(s\.ends_at\)"[^>]*@click="onLiftSuspension\(s\)"/,
  )
  assert.match(
    source,
    /v-if="isExpired\(a\.ends_at\)" class="pill pill-expired"/,
  )
  assert.match(
    source,
    /v-if="!isExpired\(a\.ends_at\)"[^>]*@click="onLiftSuspension\(a\)"/,
  )
  assert.match(
    source,
    /v-if="!detailRow\.lifted_at && !isExpired\(detailRow\.ends_at\)"[^>]*@click="onLiftSuspension\(detailRow\)"/,
  )
})
