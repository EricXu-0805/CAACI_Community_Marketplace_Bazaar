// Cleanup only: do not rerun the seven authorization checks or B's settled cleanup.
import { spawn } from 'node:child_process'

const code = await new Promise(resolve => {
  const child = spawn('npx', [
    'playwright', 'test', '--config', '.probes/playwright.probe.config.ts',
    'p2-cleanup.spec.ts', '--grep', 'cleanup synthetic A content through owner UI',
  ], { env: process.env, stdio: 'inherit' })
  child.on('exit', resolve)
})
process.exitCode = code === 0 ? 0 : 1
