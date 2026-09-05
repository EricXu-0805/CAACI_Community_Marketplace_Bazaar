#!/usr/bin/env bash
set -euo pipefail
# A disposable local PostgreSQL fixture; never connects to a hosted database.
# Use Node 22 and a locally installed PostgreSQL 16 or 17. The runner reports
# a skip if PostgreSQL is unavailable; a skip is not a deployment approval.
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"
node --test scripts/listing-notification-privacy-concurrency.test.mjs
