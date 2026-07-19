import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)
const lock = JSON.parse(await readFile(new URL('app/package-lock.json', root), 'utf8'))
const packages = lock.packages || {}

const reviewedMissingMetadata = new Map([
  ['node_modules/dom-walk', { version: '0.1.2', evidence: 'app/node_modules/dom-walk/README.md', marker: 'MIT Licenced' }],
  ['node_modules/exif-parser', { version: '0.1.12', evidence: 'app/node_modules/exif-parser/LICENSE.md', marker: 'The MIT License' }],
  ['node_modules/qrcode-terminal', { version: '0.12.0', evidence: 'app/node_modules/qrcode-terminal/LICENSE', marker: 'Apache License' }],
])

const reviewedCopyleft = new Map([
  ['node_modules/heic-to', { version: '1.4.2', license: 'LGPL-3.0' }],
])

test('every locked package has license metadata or exact bundled evidence', async () => {
  const missing = []
  for (const [packagePath, metadata] of Object.entries(packages)) {
    if (!packagePath || metadata.link || metadata.license) continue
    const reviewed = reviewedMissingMetadata.get(packagePath)
    if (!reviewed || reviewed.version !== metadata.version) {
      missing.push(`${packagePath}@${metadata.version || 'unknown'}`)
      continue
    }
    const evidence = await readFile(new URL(reviewed.evidence, root), 'utf8')
    assert.match(evidence, new RegExp(reviewed.marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
  assert.deepEqual(missing, [], `unreviewed package license metadata: ${missing.join(', ')}`)
})

test('new copyleft or source-available licenses require an explicit review', () => {
  const found = []
  const boundary = /(?:^|[()\s])(?:AGPL|GPL|LGPL|SSPL|BUSL|MPL|EPL|CDDL)(?:[-+0-9.]|$)/i
  for (const [packagePath, metadata] of Object.entries(packages)) {
    const license = String(metadata.license || '')
    if (!boundary.test(license)) continue
    const reviewed = reviewedCopyleft.get(packagePath)
    if (!reviewed || reviewed.version !== metadata.version || reviewed.license !== license) {
      found.push(`${packagePath}@${metadata.version || 'unknown'}:${license}`)
    }
  }
  assert.deepEqual(found, [], `unreviewed restricted-license package: ${found.join(', ')}`)
})

test('the known LGPL H5 decoder remains a visible release gate', async () => {
  const notice = await readFile(new URL('THIRD_PARTY_NOTICES.md', root), 'utf8')
  const triage = await readFile(new URL('docs/NPM_DEPENDENCY_TRIAGE.md', root), 'utf8')
  assert.match(notice, /heic-to` 1\.4\.2/)
  assert.match(notice, /software-license gate remains open/)
  assert.match(triage, /LGPL-3\.0/)
  assert.match(triage, /qualified counsel/)
})
