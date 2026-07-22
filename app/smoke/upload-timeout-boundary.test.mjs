import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(resolve(appRoot, 'src/composables/useItems.ts'), 'utf8')

test('all public image upload transports have deadlines and late-object cleanup', () => {
  assert.match(source, /const IMAGE_UPLOAD_TIMEOUT_MS = 30_000/)
  assert.doesNotMatch(source, /VIDEO_UPLOAD_TIMEOUT_MS|uploadOneVideo/)

  const mpHelperStart = source.indexOf('function miniProgramUploadWithTimeout(')
  const mpHelperEnd = source.indexOf('\n/*', mpHelperStart)
  const mpHelper = source.slice(mpHelperStart, mpHelperEnd)
  assert.ok(mpHelperStart >= 0 && mpHelperEnd > mpHelperStart)
  assert.match(mpHelper, /task\?\.abort\?\.\(\)/)
  assert.match(mpHelper, /if \(timedOut\) \{ lateCleanup\(\); return \}/)
  assert.match(mpHelper, /onLateSettle\(\)\.catch/)

  // The helper is now the only direct uni.uploadFile call. Batch and single
  // public image uploads each invoke it with their own candidate cleanup.
  assert.equal((source.match(/uni\.uploadFile\(/g) || []).length, 1)
  assert.equal((source.match(/await miniProgramUploadWithTimeout\(/g) || []).length, 2)
  assert.equal((source.match(/await withUploadTimeout\(/g) || []).length, 2)
  assert.ok((source.match(/items\.late_upload_candidate_cleanup/g) || []).length >= 4)

  // Provider bodies may contain storage internals and must not be reflected in
  // end-user errors after non-2xx mini-program uploads.
  assert.doesNotMatch(source, /Storage upload failed:[^\n]*res\.data/)
  assert.doesNotMatch(source, /Upload HTTP[^\n]*mpResult\.data/)
})
