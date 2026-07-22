import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const source = await readFile(
  new URL('../src/pages/admin/index.vue', import.meta.url),
  'utf8',
)

test('suspensions retain direct lift only while active and appeal decisions use the dedicated workflow', () => {
  assert.match(
    source,
    /v-if="!s\.lifted_at && !isExpired\(s\.ends_at\)"[^>]*@click="onLiftSuspension\(s\)"/,
  )
  assert.match(
    source,
    /v-else-if="isExpired\(a\.ends_at\)" class="pill pill-expired"/,
  )
  assert.match(
    source,
    /@click="onDecideAppeal\(a, 'accepted'\)"/,
  )
  assert.match(
    source,
    /@click="onDecideAppeal\(a, 'denied'\)"/,
  )
  assert.match(
    source,
    /@click="onDecideAppeal\(a, 'more_information_required'\)"/,
  )
  assert.doesNotMatch(source, /@click="onLiftSuspension\(a\)"/)
  assert.match(
    source,
    /v-if="!detailRow\.lifted_at && !isExpired\(detailRow\.ends_at\)"[^>]*@click="onLiftSuspension\(detailRow\)"/,
  )
})
