import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { miniProgramAssets, pruneMiniProgramWebAssets } from '../app/mini-program-assets.mjs'

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'illini-mini-assets-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, 'static/empty'), { recursive: true })
  await writeFile(path.join(root, 'static/app-icon-512.png'), 'pwa icon')
  await writeFile(path.join(root, 'static/logo-mark.svg'), 'runtime brand')
  await writeFile(path.join(root, 'static/empty/bag.png'), 'runtime empty state')
  return root
}

test('WeChat cleanup removes the web icon, preserves runtime assets and can repeat', async t => {
  const root = await fixture(t)
  await writeFile(path.join(root, 'app.json'), '{"pages":["pages/index/index"]}')
  await writeFile(path.join(root, 'project.config.json'), '{"appid":"wx1234567890abcdef"}')
  await pruneMiniProgramWebAssets(root)
  await pruneMiniProgramWebAssets(root)
  await assert.rejects(readFile(path.join(root, 'static/app-icon-512.png')), { code: 'ENOENT' })
  assert.equal(await readFile(path.join(root, 'static/logo-mark.svg'), 'utf8'), 'runtime brand')
  assert.equal(await readFile(path.join(root, 'static/empty/bag.png'), 'utf8'), 'runtime empty state')
})

test('H5 builds retain PWA resources and a non-WeChat directory cannot be pruned', async t => {
  const root = await fixture(t)
  const plugin = miniProgramAssets('h5')
  plugin.configResolved({ root, build: { outDir: '.' } })
  await plugin.closeBundle()
  await assert.rejects(pruneMiniProgramWebAssets(root), { code: 'ENOENT' })
  assert.equal(await readFile(path.join(root, 'static/app-icon-512.png'), 'utf8'), 'pwa icon')
})
