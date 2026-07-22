import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

async function loadCampusTime() {
  const source = readFileSync(resolve(appRoot, 'src/utils/campusTime.ts'), 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`)
}

test('campus banner dates use CST/CDT instead of UTC calendar boundaries', async () => {
  const { campusDateBounds, campusDateFromIso } = await loadCampusTime()

  assert.deepEqual(campusDateBounds('2026-01-15'), {
    startIso: '2026-01-15T06:00:00.000Z',
    endIso: '2026-01-16T05:59:59.999Z',
  })
  assert.deepEqual(campusDateBounds('2026-08-02'), {
    startIso: '2026-08-02T05:00:00.000Z',
    endIso: '2026-08-03T04:59:59.999Z',
  })
  assert.equal(campusDateFromIso('2026-08-03T04:59:59.999Z'), '2026-08-02')
})

test('campus banner dates preserve 23-hour and 25-hour DST transition days', async () => {
  const { campusDateBounds } = await loadCampusTime()

  assert.deepEqual(campusDateBounds('2026-03-08'), {
    startIso: '2026-03-08T06:00:00.000Z',
    endIso: '2026-03-09T04:59:59.999Z',
  })
  assert.deepEqual(campusDateBounds('2026-11-01'), {
    startIso: '2026-11-01T05:00:00.000Z',
    endIso: '2026-11-02T05:59:59.999Z',
  })
})

test('invalid calendar dates fail closed', async () => {
  const { campusDateBounds, campusDateFromIso } = await loadCampusTime()
  assert.throws(() => campusDateBounds('2026-02-30'), /invalid_campus_date/)
  assert.throws(() => campusDateBounds('08/02/2026'), /invalid_campus_date/)
  assert.equal(campusDateFromIso('not-a-date'), '')
})
