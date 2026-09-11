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
 * Starts its own H5 server on SMOKE_PORT (default :5173). Local developers
 * may explicitly opt into reuse with SMOKE_REUSE_SERVER=true.
 * The logged-in flow is gated on SMOKE_EMAIL / SMOKE_PASSWORD plus
 * SMOKE_ACCOUNT_IS_SYNTHETIC=true and SMOKE_DATASET_IS_SYNTHETIC=true, plus an
 * exact protected staging project ref and expected synthetic user UUID. CI
 * fails configuration mismatches and verifies the authenticated session UUID;
 * credentials do not live in the repo. CI also disables every browser artifact; local runs keep
 * failure screenshots for interactive debugging.
 */
const isCi = process.env.CI === 'true'
const smokePort = Number(process.env.SMOKE_PORT || '5173')
if (!Number.isInteger(smokePort) || smokePort < 1024 || smokePort > 65535) {
  throw new Error('SMOKE_PORT must be an integer between 1024 and 65535')
}
const smokeOrigin = `http://localhost:${smokePort}`

export default defineConfig({
  testDir: './smoke',
  // Keep deterministic node:test boundary suites out of Playwright. Without
  // this, Playwright imports *.test.mjs, causing their tests to execute once as
  // module side effects and again as malformed Playwright cases.
  testMatch: '**/*.spec.ts',
  // Missing hashed chunks only exist in the compiled-build acceptance gate.
  testIgnore: '**/compiled-chunk-recovery.spec.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: smokeOrigin,
    ...devices['iPhone 13'],
    screenshot: isCi ? 'off' : 'only-on-failure',
    trace: 'off',
    video: 'off',
  },
  webServer: {
    command: `npm run dev:h5 -- --port ${smokePort}`,
    url: smokeOrigin,
    // An unrelated checkout on the same port must not supply a false green.
    reuseExistingServer: !isCi && process.env.SMOKE_REUSE_SERVER === 'true',
    timeout: 120_000,
  },
})
