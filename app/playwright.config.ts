import { defineConfig, devices } from '@playwright/test'

// Local dev machines often run a system proxy (Clash etc.) whose
// HTTP(S)_PROXY env vars make the Node-side webServer readiness probe
// route localhost through the proxy and hang. Clearing them here only
// affects this Node process's fetches (the probe) — the browser uses its
// own networking stack and still reaches Supabase directly. Lets
// `npm run smoke` work without a manual env prefix.
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
  delete process.env[k]
}
process.env.NO_PROXY = 'localhost,127.0.0.1'

/**
 * Smoke-test harness — a manual regression gate, NOT part of CI.
 *
 * Run before/after big changes (and when wiring in the new UI library) to
 * confirm every page still loads with no console errors and the core flow
 * works. CI stays lean (type-check + dual build); this is opt-in:
 *
 *   cd app && npm run smoke
 *
 * Auto-starts the H5 dev server on :5173 (reuses one if already running).
 * The logged-in flow is gated on SMOKE_EMAIL / SMOKE_PASSWORD env vars so
 * no credentials live in the repo — without them, only the logged-out
 * sweep runs.
 */
export default defineConfig({
  testDir: './smoke',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    ...devices['iPhone 13'],
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev:h5',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
