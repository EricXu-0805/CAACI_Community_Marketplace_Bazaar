#!/usr/bin/env node
// Run inside the pinned Storage image, mounted at /app/copy-storage-file-backend.mjs.
// The image supplies fs-xattr. Source must be a quiesced, read-only volume;
// destination must be an empty volume that is not yet served by Storage.
import assert from 'node:assert/strict'
import { constants, createReadStream } from 'node:fs'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'

const hash = value => createHash('sha256').update(value).digest('hex')
const inside = (parent, child) => child === parent || child.startsWith(parent + path.sep)
async function fileHash(file) {
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(file)) digest.update(chunk)
  return digest.digest('hex')
}

async function main() {
  assert.equal(process.platform, 'linux', 'Run this helper in the Linux Storage image')
  assert.equal(process.argv.length, 4, 'Usage: node copy-storage-file-backend.mjs SOURCE EMPTY_DESTINATION')
  const [sourceArg, targetArg] = process.argv.slice(2)
  assert.ok(path.isAbsolute(sourceArg) && path.isAbsolute(targetArg), 'Use absolute mount paths')
  const source = await fs.realpath(sourceArg), target = await fs.realpath(targetArg)
  assert.ok(source !== '/' && target !== '/', 'Filesystem root is not a snapshot mount')
  assert.ok(!inside(source, target) && !inside(target, source), 'Snapshot mounts must not overlap')
  assert.ok((await fs.stat(source)).isDirectory() && (await fs.stat(target)).isDirectory(), 'Both mounts must be directories')
  assert.equal((await fs.readdir(target)).length, 0, 'Destination is not empty; refusing to overwrite it')
  const xattr = createRequire(import.meta.url)('fs-xattr')
  const inventory = []
  const required = ['user.supabase.cache-control', 'user.supabase.content-type']

  async function attributes(file) {
    const names = (await xattr.list(file)).sort()
    return Promise.all(names.map(async name => [name, Buffer.from(await xattr.get(file, name))]))
  }
  const attributeDigest = values => hash(JSON.stringify(values.map(([name, value]) => [name, value.toString('base64')])))

  async function visit(relative = '') {
    for (const name of (await fs.readdir(path.join(source, relative))).sort()) {
      const child = path.join(relative, name), from = path.join(source, child), to = path.join(target, child)
      const stat = await fs.lstat(from)
      assert.ok(!stat.isSymbolicLink(), 'Snapshot contains a symlink; refusing to follow it')
      if (stat.isDirectory()) {
        await fs.mkdir(to)
        await visit(child)
        await fs.chown(to, stat.uid, stat.gid)
        await fs.chmod(to, stat.mode & 0o7777)
        await fs.utimes(to, stat.atime, stat.mtime)
        continue
      }
      assert.ok(stat.isFile(), 'Snapshot contains a non-regular file')
      const before = await attributes(from)
      assert.ok(required.every(name => before.some(([key]) => key === name)), 'Source object is missing required Storage metadata')
      await fs.copyFile(from, to, constants.COPYFILE_EXCL)
      await fs.chown(to, stat.uid, stat.gid)
      await fs.chmod(to, stat.mode & 0o7777)
      for (const [name, value] of before) await xattr.set(to, name, value)
      await fs.utimes(to, stat.atime, stat.mtime)
      const after = await attributes(to)
      const sourceHash = await fileHash(from), targetHash = await fileHash(to)
      assert.equal(targetHash, sourceHash, 'Copied object bytes differ')
      assert.equal(attributeDigest(after), attributeDigest(before), 'Copied object metadata differs')
      const finalSource = await fs.lstat(from)
      assert.ok(finalSource.size === stat.size && finalSource.mtimeMs === stat.mtimeMs && finalSource.ctimeMs === stat.ctimeMs, 'Source changed during copy; quiesce all writers before retrying')
      const handle = await fs.open(to, 'r')
      try { await handle.sync() } finally { await handle.close() }
      inventory.push({ pathHash: hash(child), bytes: stat.size, sha256: sourceHash, attributes: before.length, attributesSha256: attributeDigest(before) })
    }
  }
  await visit()
  console.log(JSON.stringify({ pass: true, files: inventory.length, bytes: inventory.reduce((n, f) => n + f.bytes, 0), inventory }))
}

main().catch(error => {
  // Never log file contents, xattr values, credentials or object names.
  const message = error instanceof assert.AssertionError ? error.message.split('\n')[0] : 'Copy failed; inspect the private environment before retrying'
  console.error(JSON.stringify({ pass: false, code: error.code || 'snapshot_copy_failed', message }))
  process.exitCode = 1
})
