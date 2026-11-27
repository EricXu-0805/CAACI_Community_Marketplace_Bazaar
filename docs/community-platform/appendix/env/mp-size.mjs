// Prints mini-program package bytes using the repo's own verifier (RUNBOOK §4.2, mp step).
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const root = path.resolve(process.argv[2] || 'dist/build/mp-weixin')
const { verifyMiniProgram } = await import(pathToFileURL(path.resolve('../scripts/verify-miniprogram.mjs')).href)
const files = (await readdir(root, { recursive: true, withFileTypes: true }))
  .filter(d => d.isFile())
  .map(d => path.relative(root, path.join(d.parentPath, d.name)).split(path.sep).join('/'))
console.log(JSON.stringify(await verifyMiniProgram(root, files)))
