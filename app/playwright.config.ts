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
 * Smoke-test harness — a manual regression gate AND a (non-required) CI job.
 *
 * Run before/after big changes (and when wiring in the new UI library) to
 * confirm every page still loads with no console errors and the core flow
 * works. CI runs this too (see .github/workflows/ci.yml `smoke` job) as a
 * non-blocking signal alongside the required type-check + dual build:
 *
 *   cd app && npm run smoke
 *
 * Auto-starts the H5 dev server on :5173 (reuses one if already running).
 * The logged-in flow is gated on SMOKE_EMAIL / SMOKE_PASSWORD plus
 * SMOKE_ACCOUNT_IS_SYNTHETIC=true and SMOKE_DATASET_IS_SYNTHETIC=true, plus an
 * exact protected staging project ref and expected synthetic user UUID. CI
 * fails configuration mismatches and verifies the authenticated session UUID;
 * credentials do not live in the repo. CI also disables every browser artifact; local runs keep
 * failure screenshots for interactive debugging.
 */
const isCi = process.env.CI === 'true'

export default defineConfig({
  testDir: './smoke',
  // Keep deterministic node:test boundary suites out of Playwright. Without
  // this, Playwright imports *.test.mjs, causing their tests to execute once as
  // module side effects and again as malformed Playwright cases.
  testMatch: '**/*.spec.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    ...devices['iPhone 13'],
    screenshot: isCi ? 'off' : 'only-on-failure',
    trace: 'off',
    video: 'off',
  },
  webServer: {
    command: 'npm run dev:h5',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
