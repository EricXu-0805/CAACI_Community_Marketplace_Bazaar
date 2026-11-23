import { fileURLToPath } from 'node:url'
import { fetchCaaciSnapshot } from '../api/_community-events-sync.js'

export async function runDryRun(args, fetch = globalThis.fetch) {
  if (args.length !== 3 || args[0] !== '--dry-run' || args[1] !== '--source' || args[2] !== 'caaci') {
    console.error('Usage: node scripts/sync-community-events.mjs --dry-run --source caaci')
    return 2
  }
  const snapshot = await fetchCaaciSnapshot(fetch, 5000)
  console.log(JSON.stringify(snapshot, null, 2))
  return snapshot.error ? 1 : 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await runDryRun(process.argv.slice(2))
}
