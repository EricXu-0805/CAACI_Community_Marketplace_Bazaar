import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Where a seeded session has to be written.
 *
 * The app derives its auth storage key from the Supabase URL it was compiled
 * against — authStorageKeyForUrl() in composables/useSupabase.ts takes the
 * first hostname label. A spec that hardcodes a project ref therefore only
 * seeds a usable session when the dev server happens to point at that same
 * project, and fails everywhere else as a page full of plausible text rather
 * than as a missing session.
 *
 * That has now cost two red mains. The authenticated CI job pins
 * VITE_SUPABASE_URL to staging, so a hardcoded production ref writes a key
 * nobody reads: every gated route falls through to the login page, and a
 * sweep that reads the document as a whole finds the login page's heading and
 * passes. read-failure-states.spec.ts hit it in #250;
 * a11y-authenticated.spec.ts had been passing that way for far longer,
 * because nothing looked closely enough to notice which page it was on.
 *
 * Resolve it the way Vite does — process env first, then app/.env — and throw
 * rather than fall back to anything.
 */
export function supabaseUrlForBuild(): string {
  const fromEnv = process.env.VITE_SUPABASE_URL
  if (fromEnv) return fromEnv
  const dotenv = readFileSync(resolve(process.cwd(), '.env'), 'utf8')
  const match = /^\s*VITE_SUPABASE_URL\s*=\s*(.+?)\s*$/m.exec(dotenv)
  if (!match) throw new Error('no VITE_SUPABASE_URL in the environment or app/.env — cannot seed a session')
  return match[1].replace(/^["']|["']$/g, '')
}

/** First hostname label — the project ref the app builds its storage key from. */
export function supabaseRefForBuild(): string {
  return new URL(supabaseUrlForBuild()).hostname.split('.')[0]
}
