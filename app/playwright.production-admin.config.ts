import { defineConfig, devices } from '@playwright/test'

// Build H5 first. This gate must exercise the shipped compiler output, not a
// dev server whose global uni object can conceal a production-only failure.
for(const key of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy']) delete process.env[key]
export default defineConfig({
  testDir:'./smoke',testMatch:'admin-first-unlock.spec.ts',workers:1,retries:0,
  timeout:30_000,expect:{timeout:10_000},reporter:'list',
  use:{baseURL:'http://localhost:5192',screenshot:process.env.CI==='true'?'off':'only-on-failure',trace:'off',video:'off'},
  projects:[
    {name:'mac-chromium',use:{...devices['Desktop Chrome'],viewport:{width:1440,height:900}}},
    {name:'mac-webkit',use:{...devices['Desktop Safari'],viewport:{width:1440,height:900}}},
    {name:'ipad-webkit',use:{...devices['iPad Pro 11']}},
    {name:'phone-webkit',use:{...devices['iPhone 13']}},
  ],
  webServer:{command:'npx vite preview --host localhost --port 5192 --strictPort --outDir dist/build/h5',url:'http://localhost:5192',reuseExistingServer:false,timeout:30_000},
})
