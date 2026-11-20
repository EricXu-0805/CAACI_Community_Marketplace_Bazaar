// The one place tests look for PostgreSQL 17 binaries (D-16, BACKLOG P1.3).
import { existsSync } from 'node:fs'
import { join } from 'node:path'

// Where CI (ci.yml boundary-tests) and the tony-ws test image install PostgreSQL 17.
export const LINUX_PG17_BIN = '/usr/lib/postgresql/17/bin'
export const DEFAULT_PG17_DIRS = ['/opt/homebrew/opt/postgresql@17/bin', LINUX_PG17_BIN]

/**
 * Returns the directory holding initdb. PG_BIN, then PG_BIN_DIR, pins the lookup to
 * that one directory; otherwise the defaults are tried in order. When nothing is
 * found, CI=true throws postgresql_17_required_in_ci and anything else gets null,
 * which callers turn into a skip.
 */
export function postgresBinDir(env = process.env, defaults = DEFAULT_PG17_DIRS) {
  const pinned = env.PG_BIN || env.PG_BIN_DIR
  const dirs = pinned ? [pinned] : defaults
  const found = dirs.find(dir => existsSync(join(dir, 'initdb')))
  if (found) return found
  if (env.CI === 'true') throw new Error(`postgresql_17_required_in_ci: no initdb in ${dirs.join(', ')}`)
  return null
}
