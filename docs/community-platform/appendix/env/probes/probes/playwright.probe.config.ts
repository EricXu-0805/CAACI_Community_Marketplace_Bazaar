import { defineConfig } from '@playwright/test'
import base from '../playwright.config'

if (process.env.VITE_SUPABASE_URL !== 'https://hygkwxugskijadgfisji.supabase.co'
  || !['A', 'B', 'C'].every(k => process.env[`SYN_${k}_EMAIL`]?.endsWith('@example.test'))) {
  throw new Error('staging_probe_target_or_synthetic_identity_invalid')
}

export default defineConfig({
  ...base,
  testDir: '.',
  testMatch: '**/*.spec.ts',
  testIgnore: [],
  workers: 1,
  retries: 0,
  timeout: 120_000,
  use: { ...base.use, screenshot: 'off', trace: 'off', video: 'off' },
  webServer: { ...base.webServer, cwd: '..' },
})
