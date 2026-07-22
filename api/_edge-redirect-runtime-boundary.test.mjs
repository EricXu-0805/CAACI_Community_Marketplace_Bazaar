import assert from 'node:assert/strict'
import test from 'node:test'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join, relative } from 'node:path'

const API_ROOT = fileURLToPath(new URL('.', import.meta.url))
const EXPECTED_EDGE_FILES = [
  '404.js',
  'admin/index.js',
  'auth/delete-account.js',
  'auth/send-illini-code.js',
  'auth/verify-illini-code.js',
  'auth/wechat-login.js',
  'banner-upload-gc.js',
  'data-retention.js',
  'db-proxy.js',
  'geocode.js',
  'meetup-notify.js',
  'moderate.js',
  'notification-digest.js',
  'realtime-poll.js',
  'share-post.js',
  'share.js',
  'translate.js',
  'unsubscribe.js',
  'wechat-callback.js',
  'wechat-seccheck.js',
].sort()

function executableSource(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

async function productionJavaScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await productionJavaScriptFiles(path))
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(path)
  }
  return files.sort()
}

test('every raw Vercel Edge fetch uses the runtime-compatible no-follow mode', async () => {
  const files = await productionJavaScriptFiles(API_ROOT)
  const edgeFiles = []
  const sources = new Map()

  for (const file of files) {
    const source = await readFile(file, 'utf8')
    if (!/export\s+const\s+config\s*=\s*\{\s*runtime\s*:\s*['"]edge['"]\s*,?\s*\}/.test(source)) continue
    const path = relative(API_ROOT, file)
    edgeFiles.push(path)
    sources.set(path, executableSource(source))
  }

  assert.deepEqual(edgeFiles.sort(), EXPECTED_EDGE_FILES, 'the exact Edge route inventory changed')

  for (const file of edgeFiles) {
    const source = sources.get(file)

    const fetchCount = (source.match(/\bfetch\s*\(/g) || []).length
    const manualCount = (source.match(/redirect\s*:\s*['"]manual['"]/g) || []).length
    assert.equal(
      manualCount,
      fetchCount,
      `${file} must make every raw fetch observable without following redirects`,
    )
    assert.doesNotMatch(
      source,
      /redirect:\s*['"](?:error|follow)['"]/,
      `${file} must avoid Edge-incompatible or secret-forwarding redirect modes`,
    )
  }

})
