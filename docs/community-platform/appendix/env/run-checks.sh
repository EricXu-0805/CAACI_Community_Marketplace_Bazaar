#!/usr/bin/env bash
# Runs the repo CI checks inside localhost/illini-dev:pw<playwright major.minor>-node22-pg17 (RUNBOOK §4).
# usage: run-checks.sh <repo-dir> [steps...]    |    run-checks.sh --selftest
#   steps: install typecheck h5 h5accept mp mpci migrations test smoke npmaudit cmd, and "probe <file>"
#   mpci builds mp-weixin with the CI build-mp-weixin environment; main-package bytes come from it (D-46)
#   default: install typecheck h5 mp migrations test
#   SMOKE_SPECS="a.spec.ts b.spec.ts" overrides the smoke spec list; RUN_CMD feeds the cmd step;
#   IMAGE=... forces an image (default: picked from @playwright/test in app/package-lock.json).
set -uo pipefail
ENVDIR=$HOME/work/illini-dev-env
PROBES_DIR=${PROBES_DIR:-$ENVDIR/probes}

gate() {  # $1 = node --test output; prints the TEST line; succeeds only for fail 0, skipped 1, no PostgreSQL/initdb skip
  local tests pass fail skipped pgskip
  read -r tests pass fail skipped < <(awk '/^# (tests|pass|fail|skipped) [0-9]+$/{v[$2]=$3} END{print v["tests"]+0, v["pass"]+0, v["fail"]+0, v["skipped"]+0}' "$1")
  pgskip=$(grep -ciE '# SKIP.*(postgres|initdb)' "$1")
  echo "TEST tests=$tests pass=$pass fail=$fail skipped=$skipped pg_skips=$pgskip"
  [ "$tests" -gt 0 ] && [ "$fail" -eq 0 ] && [ "$skipped" -eq 1 ] && [ "$pgskip" -eq 0 ]
}

if [ "${1:-}" = --selftest ]; then
  t=$(mktemp -d); bad=0
  printf '%s\n' '# tests 3' '# pass 1' '# fail 0' '# skipped 2' > "$t/skipped-2"
  printf '%s\n' 'ok 2 - db # SKIP PostgreSQL 17 unavailable' '# tests 2' '# pass 1' '# fail 0' '# skipped 1' > "$t/pg-skip"
  printf '%s\n' 'ok 1 - build output # SKIP no local .vercel/output function inventory' '# tests 2' '# pass 1' '# fail 0' '# skipped 1' > "$t/good"
  for c in skipped-2:1 pg-skip:1 good:0; do
    gate "$t/${c%%:*}" >/dev/null; rc=$?
    echo "SELFTEST ${c%%:*} gate_rc=$rc expected=${c##*:}"; [ "$rc" = "${c##*:}" ] || bad=1
  done
  rm "$t/skipped-2" "$t/pg-skip" "$t/good"; rmdir "$t"; exit "$bad"
fi

REPO=$(cd "${1:?usage: run-checks.sh <repo-dir> [steps...]}" && pwd -P); shift
[ $# -gt 0 ] || set -- install typecheck h5 mp migrations test
PW=$(sed -n '/"node_modules\/@playwright\/test": {/,/}/{s/.*"version": "\([0-9]*\.[0-9]*\)\.[0-9]*".*/\1/p;}' "$REPO/app/package-lock.json" | head -1)
IMAGE=${IMAGE:-localhost/illini-dev:pw${PW}-node22-pg17}
podman image exists "$IMAGE" || { echo "missing image $IMAGE (lockfile Playwright $PW); build it per RUNBOOK §4.3" >&2; exit 1; }
GIT_COMMON=$(git -C "$REPO" rev-parse --path-format=absolute --git-common-dir)
SMOKE_SPECS=${SMOKE_SPECS:-community-post-topics.spec.ts plaza-attach-picker-is-modal.spec.ts}
STAMP=$(date -u +%Y%m%dT%H%M%SZ); LOG=$ENVDIR/logs/check-$STAMP.log
STUB="VITE_SUPABASE_URL=https://00000000000000000000.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_ci-stub-key VITE_BASE_URL=https://ci-app-stub.invalid"
# The environment of ci.yml's build-mp-weixin job (lines 301-303); main-package bytes are measured here (D-46).
MPCI_STUB="VITE_SUPABASE_URL=https://ci-stub.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_ci-stub-key VITE_BASE_URL=https://ci-app-stub.invalid"
EXTRA=()
inbox() {
  podman run --rm --userns=keep-id -e HOME=/cache/home -e CI=true -e PG_BIN_DIR=/usr/lib/postgresql/17/bin \
    -v "$HOME/.cache/illini-dev:/cache" -v "$ENVDIR:/dev-env:ro" \
    -v "$REPO:$REPO" -v "$GIT_COMMON:$GIT_COMMON:ro" "${EXTRA[@]}" -w "$REPO" "$IMAGE" bash -lc "$1"
}
declare -A CMD=(
  [install]="cd app && a=\$(sha256sum package-lock.json) && npm ci --legacy-peer-deps --no-audit --no-fund && node -v && npm -v && [ \"\$a\" = \"\$(sha256sum package-lock.json)\" ]"
  [typecheck]="cd app && npm run type-check"
  [h5]="cd app && env $STUB npm run build:h5 && node ../scripts/verify-build-artifact.mjs dist/build/h5 ci"
  [h5accept]="cd app && env $STUB npx playwright test --config playwright.production-admin.config.ts"
  [mp]="cd app && env $STUB npm run build:mp-weixin && node ../scripts/verify-build-artifact.mjs dist/build/mp-weixin none && node /dev-env/mp-size.mjs dist/build/mp-weixin"
  [mpci]="cd app && env $MPCI_STUB npm run build:mp-weixin && node ../scripts/verify-build-artifact.mjs dist/build/mp-weixin none && node /dev-env/mp-size.mjs dist/build/mp-weixin"
  [migrations]="cd supabase/migrations && shasum -a 256 -c manifest.sha256 >/dev/null && echo all-migration-checksums-ok"
  [test]="cd app && node --test --test-concurrency=2 ../api/*.test.mjs ../scripts/*.test.mjs smoke/*.test.mjs"
  [smoke]="cd app && env $STUB SMOKE_PORT=5186 npx playwright test $SMOKE_SPECS"
  [npmaudit]="cd app && npx -y npm@11 audit --audit-level=moderate"
  [probe]="bash /dev-env/probe-in-container.sh"
  [cmd]="${RUN_CMD:-echo 'RUN_CMD is empty' >&2; false}"
)
# D-51 2j: the index tree (git write-tree) and any MERGE_HEAD go into the header, so a log can be matched to the
# tree that was later committed and pushed. unstaged=yes means the working tree differs from that index tree.
TREE=$(git -C "$REPO" write-tree 2>/dev/null || echo unavailable)
MERGE=$(git -C "$REPO" rev-parse -q --verify MERGE_HEAD 2>/dev/null || true)
if git -C "$REPO" diff --quiet 2>/dev/null; then UNSTAGED=no; else UNSTAGED=yes; fi
echo "repo=$REPO head=$(git -C "$REPO" rev-parse HEAD) branch=$(git -C "$REPO" rev-parse --abbrev-ref HEAD) tree=$TREE unstaged=$UNSTAGED${MERGE:+ merge_head=$MERGE} image=$IMAGE log=$LOG" | tee "$LOG"
overall=0
while [ $# -gt 0 ]; do
  s=$1; shift; EXTRA=(); label=$s
  if [ "$s" = probe ]; then
    f=${1:-}; shift || true; label=probe-${f%%.*}
    ENVF=$HOME/.config/illini/staging.env
    if [ -z "$f" ] || [ ! -f "$PROBES_DIR/$f" ] || [ "$(stat -c %a "$ENVF" 2>/dev/null)" != 600 ] \
       || grep -qE 'service_role|sb_secret|lfhvgprfphyfvhidegum|wslzeqhipvibeflmxznh' "$ENVF"; then
      echo "STEP $label rc=3 probe-file-or-staging.env-check-failed" | tee -a "$LOG"; overall=1; continue
    fi
    install -d "${EV:-$HOME/work/evidence/misc}"
    EXTRA=(-v "$PROBES_DIR:$REPO/app/.probes:ro" -v "$ENVF:/run/illini/staging.env:ro"
           -v "$HOME/work/evidence:$HOME/work/evidence" -e "PROBE_FILE=$f" -e "EV=${EV:-$HOME/work/evidence/misc}")
  fi
  if [ -z "${CMD[$s]+x}" ]; then echo "STEP $s rc=2 unknown-step" | tee -a "$LOG"; overall=1; continue; fi
  t0=$(date +%s); out=$ENVDIR/logs/check-$STAMP-$label.log
  inbox "${CMD[$s]}" > "$out" 2>&1; rc=$?
  { echo "=== $label"; cat "$out"; } >> "$LOG"
  if [ "$s" = test ]; then gate "$out" | tee -a "$LOG"; [ "${PIPESTATUS[0]}" -eq 0 ] || rc=1; fi
  echo "STEP $label rc=$rc secs=$(( $(date +%s) - t0 ))" | tee -a "$LOG"
  [ "$rc" -eq 0 ] || overall=1
done
exit "$overall"
