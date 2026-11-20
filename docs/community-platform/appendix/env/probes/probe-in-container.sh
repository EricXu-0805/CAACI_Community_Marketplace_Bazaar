#!/usr/bin/env bash
# RUNBOOK 5.2: run one staging-only acceptance probe.
set -uo pipefail
set -a; . /run/illini/staging.env; set +a
[ "$STAGING_SUPABASE_URL" = https://hygkwxugskijadgfisji.supabase.co ] || { echo wrong_staging_target >&2; exit 3; }
export VITE_SUPABASE_URL="$STAGING_SUPABASE_URL" VITE_SUPABASE_ANON_KEY="$STAGING_SUPABASE_ANON_KEY" VITE_BASE_URL=https://ci-app-stub.invalid
cd app || exit 2
node ../scripts/verify-public-read-schema.mjs || exit 1
case "$PROBE_FILE" in
  *.spec.ts) exec npx playwright test --config .probes/playwright.probe.config.ts "$PROBE_FILE" ;;
  *.mjs) exec node ".probes/$PROBE_FILE" ;;
  *) echo "probe file must end with .spec.ts or .mjs" >&2; exit 2 ;;
esac
