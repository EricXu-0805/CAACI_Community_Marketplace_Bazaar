import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const ROOT = new URL('../', import.meta.url)

const source = async path => readFile(new URL(path, ROOT), 'utf8')

test('pre-push runs deterministic boundary tests for executable non-client changes', async () => {
  const hook = await source('.githooks/pre-push')

  assert.match(hook, /node --test \.\.\/api\/\*\.test\.mjs \.\.\/scripts\/\*\.test\.mjs smoke\/\*\.test\.mjs/)
  assert.match(hook, /needs_boundary_tests\(\)[\s\S]*\.github\/\*[\s\S]*\*\)[\s\S]*return 0/)
  assert.match(hook, /needs_client_builds\(\)[\s\S]*\.github\/\*\|\.githooks\/\*\)[\s\S]*return 1/)
  assert.match(hook, /supabase\/migrations\/\*\.sql\)[\s\S]*return 1/)
  assert.match(hook, /api\/\*\)[\s\S]*return 1/)
  assert.match(hook, /scripts\/\*\.mjs\|scripts\/\*\.sh\)[\s\S]*return 1/)
  assert.doesNotMatch(hook, /only docs\/migrations\/scripts\/api changed[^\n]*skipping/)
})

test('pre-push uses an isolated output directory for concurrent invocations', async () => {
  const hook = await source('.githooks/pre-push')

  assert.match(hook, /mktemp -d \/tmp\/illini-pre-push\.XXXXXX/)
  assert.match(hook, /UNI_OUTPUT_DIR="\$PRE_PUSH_TMP\/h5"/)
  assert.match(hook, /UNI_OUTPUT_DIR="\$PRE_PUSH_TMP\/mp-weixin"/)
  assert.doesNotMatch(hook, /\/tmp\/pre-push-(?:gate|typecheck|build)/)
})

test('public smoke skips missing configuration while account smoke is protected main-only', async () => {
  const ci = await source('.github/workflows/ci.yml')

  assert.match(ci, /id: smoke-config[\s\S]*can_run=false/)
  // The invariant is the gate, not the engine list: a fork PR without the
  // public credentials must not spend minutes downloading browsers for a job
  // that will skip. Which engines get installed is free to change — the
  // keyboard-journey sweep added Chromium — so match any engine list and bind
  // the nearest `if:`.
  assert.match(ci, /Install Playwright \([^)]*\)[\s\S]*?if: steps\.smoke-config\.outputs\.can_run == 'true'/)
  assert.match(ci, /name: Smoke \(logged-out page sweep only\)[\s\S]*id: smoke-run/)
  const publicJob = ci.slice(ci.indexOf('  public-smoke:'), ci.indexOf('  authenticated-smoke:'))
  assert.doesNotMatch(publicJob, /SMOKE_EMAIL|SMOKE_PASSWORD/)
  assert.match(ci, /authenticated-smoke:[\s\S]*?environment: staging-smoke/)
  assert.match(ci, /github\.event_name == 'push'[\s\S]*?refs\/heads\/main[\s\S]*?github\.event_name == 'workflow_dispatch'[\s\S]*?refs\/heads\/main/)
  assert.match(ci, /SMOKE_EXPECTED_SUPABASE_PROJECT_REF:[\s\S]*?SMOKE_EXPECTED_USER_ID:/)
  assert.match(ci, /Protected smoke refused:[\s\S]*?exit 1/)
  assert.doesNotMatch(ci, /continue-on-error:\s*true/)
  assert.match(ci, /SMOKE_ACCOUNT_IS_SYNTHETIC:\s*\$\{\{ secrets\.SMOKE_ACCOUNT_IS_SYNTHETIC \}\}/)
  assert.match(ci, /SMOKE_DATASET_IS_SYNTHETIC:\s*\$\{\{ secrets\.SMOKE_DATASET_IS_SYNTHETIC \}\}/)
  assert.doesNotMatch(ci, /actions\/upload-artifact/)
  assert.doesNotMatch(ci, /app\/test-results/)
})

test('deterministic builds use an explicit non-production app origin', async () => {
  const [ci, hook] = await Promise.all([
    source('.github/workflows/ci.yml'),
    source('.githooks/pre-push'),
  ])

  assert.match(ci, /VITE_BASE_URL: https:\/\/ci-app-stub\.invalid/g)
  assert.equal((ci.match(/VITE_BASE_URL: https:\/\/ci-app-stub\.invalid/g) || []).length, 2)
  assert.match(hook, /VITE_BASE_URL="\$\{VITE_BASE_URL:-https:\/\/pre-push-app-stub\.invalid\}"/)
  assert.doesNotMatch(ci, /VITE_BASE_URL:\s*https:\/\/illinimarket\.com/)
  assert.doesNotMatch(hook, /VITE_BASE_URL[^\n]*illinimarket\.com/)
})

test('CI and pre-push verify built artifacts instead of checking only for a directory', async () => {
  const [ci, hook] = await Promise.all([
    source('.github/workflows/ci.yml'),
    source('.githooks/pre-push'),
  ])

  assert.match(ci, /verify-build-artifact\.mjs dist\/build\/h5 ci/)
  assert.match(ci, /verify-build-artifact\.mjs dist\/build\/mp-weixin none/)
  assert.match(hook, /verify-build-artifact\.mjs "\$PRE_PUSH_TMP\/h5" local/)
  assert.match(hook, /verify-build-artifact\.mjs "\$PRE_PUSH_TMP\/mp-weixin" none/)
})

test('the dependency audit is conditional, but the code it sits beside is not', async () => {
  /*
   * npm's audit endpoint answered 400 and then stopped answering for most of
   * 2026-09-03/04, and because the audit ran on every pull request, every one
   * of them waited out three 180s attempts to re-check a dependency tree it had
   * not touched. `--omit=dev` reads production dependencies, which cannot
   * change unless app/package.json or app/package-lock.json does.
   *
   * What this pins is the shape, not the wording: the audit runs behind a
   * check, that check looks at both dependency files, and something runs it
   * when no pull request does. The control at the end is the point — gating the
   * audit must never quietly gate the tests beside it.
   */
  const ci = await source('.github/workflows/ci.yml')

  assert.match(ci, /^\s{2}schedule:\s*$/m,
    'nothing runs the audit when no pull request touches the dependency files')

  const boundary = ci.slice(ci.indexOf('  boundary-tests:'), ci.indexOf('\n  build-h5:'))
  assert.ok(boundary.includes('boundary-tests'), 'the Boundary regressions job moved')

  const audit = boundary.slice(boundary.indexOf('- name: Audit production dependencies'))
  assert.match(audit, /if: steps\.\w+\.outputs\.\w+ == 'true'/,
    'the audit step is unconditional again — a registry outage will block every merge')

  // Run the check's own pattern rather than matching its spelling: what
  // matters is which paths it would notice, not how it is written.
  const grep = boundary.match(/grep -qxE '([^']+)'/)
  assert.ok(grep, 'the dependency check no longer matches paths with an extended regex')
  const matchesPath = new RegExp(grep[1])
  for (const file of ['app/package.json', 'app/package-lock.json']) {
    assert.ok(matchesPath.test(file),
      `the dependency check would not notice a change to ${file}`)
  }
  assert.equal(matchesPath.test('app/src/pages/index/index.vue'), false,
    'the dependency check fires on files that cannot change production dependencies')

  // The control. Gating the audit is only safe while the steps that verify our
  // own code keep running on every push and every pull request.
  for (const step of ['Verify migration file integrity', 'API and client boundary tests']) {
    const body = boundary.slice(boundary.indexOf(`- name: ${step}`))
    const next = body.indexOf('\n      - name:')
    assert.doesNotMatch(
      next === -1 ? body : body.slice(0, next),
      /^\s+if:/m,
      `${step} became conditional — the required check would pass without running it`,
    )
  }
})
