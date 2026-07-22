import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)
const documentPaths = [
  'README.md',
  'docs/PRD.md',
  'docs/ROADMAP.md',
  'docs/ARCHITECTURE.md',
]

test('current release documents distinguish pre-tail 34/38 from post-tail 37/38', async () => {
  const documents = await Promise.all(
    documentPaths.map(async path => [path, await readFile(new URL(path, root), 'utf8')]),
  )

  for (const [path, source] of documents) {
    assert.match(source, /34\/38/, `${path} lost the pre-tail production count`)
    assert.match(source, /37\/38/, `${path} lost the post-tail production count`)
    assert.doesNotMatch(source, /34\/35/, `${path} retained the superseded count`)
    assert.match(
      source,
      /(?:微信|WeChat)[^\n]*(?:退役|retirement)|(?:退役|retirement)[^\n]*(?:微信|WeChat)/i,
      `${path} no longer identifies WeChat credential retirement as the final gate`,
    )
  }
})

test('README migration inventory matches the repository and names all three production tail steps', async () => {
  const [readme, migrationEntries] = await Promise.all([
    readFile(new URL('README.md', root), 'utf8'),
    readdir(new URL('supabase/migrations/', root)),
  ])
  const sqlCount = migrationEntries.filter(name => name.endsWith('.sql')).length

  assert.equal(sqlCount, 132)
  assert.match(readme, new RegExp(`仓库当前共有 ${sqlCount} 个 migration SQL 文件`))
  assert.match(readme, /38 条候选/)
  assert.match(readme, /145042、152000、161200 三条/)
  assert.match(readme, /20260718140000_retire_wechat_password_credentials\.sql/)
})
