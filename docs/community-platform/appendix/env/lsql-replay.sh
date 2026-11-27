#!/usr/bin/env bash
# L-SQL: replay every migration from 001 in a disposable supabase/postgres container (RUNBOOK §5.1).
# usage: lsql-replay.sh <repo-dir> [migration-timestamp ...]
#   For each timestamp: PRECHECK_<ts>_*.sql runs right before that migration, VERIFY_<ts>_*.sql right after,
#   REGRESSION_<ts>_*.sql after the whole chain.
set -uo pipefail
REPO=$(cd "${1:?usage: lsql-replay.sh <repo-dir> [ts ...]}" && pwd -P); shift
CHECK=" $* "
IMG=docker.io/supabase/postgres:17.6.1.104
NAME=lsql-$(date -u +%Y%m%dT%H%M%SZ)
LOG=$HOME/work/illini-dev-env/logs/$NAME.log
PGPW=$(openssl rand -hex 16)
podman run -d --name "$NAME" --network none -e POSTGRES_PASSWORD="$PGPW" -v "$REPO/supabase:/work:ro" "$IMG" >/dev/null || exit 2
trap 'podman rm -f "$NAME" >/dev/null' EXIT
for _ in $(seq 1 90); do podman exec "$NAME" pg_isready -h localhost -U postgres >/dev/null 2>&1 && break; sleep 2; done
PSQL=(podman exec -i -e PGPASSWORD="$PGPW" "$NAME" psql -X -h localhost -U supabase_admin -d postgres)
"${PSQL[@]}" -c 'select current_user, version()' >>"$LOG" 2>&1 || { echo "cannot connect as supabase_admin; see $LOG" >&2; exit 2; }
emit() {
  # Hosted Supabase applies migrations as postgres (non-superuser), and later prechecks assert proowner = postgres.
  # So the chain runs as postgres; only the repo's LOCAL_BOOTSTRAP fixtures for managed schemas run as supabase_admin.
  printf '%s\n' '\set ON_ERROR_STOP on' "SET caaci.local_bootstrap = '20260722-disposable-pg17';" '\i /work/_ops/LOCAL_BOOTSTRAP_20260722_full_clean_supabase_base.sql'
  printf '%s\n' '\connect postgres postgres'
  local f ts x r rec platform=0 base ledger=0 rows=()
  for f in $(cd "$REPO/supabase/migrations" && ls -1 *.sql | LC_ALL=C sort); do
    ts=${f%%_*}
    # auth.jwt() and the storage columns come from the Auth/Storage services on hosted; the repo's fixture
    # for that surface runs after the numbered 001-089 chain (its header says so).
    if [ "$platform" = 0 ] && [ ${#ts} -ge 14 ]; then
      printf '%s\n' '\connect postgres supabase_admin' '\echo BOOTSTRAP LOCAL_BOOTSTRAP_20260719_full_release_platform.sql' '\i /work/_ops/LOCAL_BOOTSTRAP_20260719_full_release_platform.sql' '\connect postgres postgres'; platform=1
    fi
    # Hosted surfaces the image lacks (CLI migration ledger, Auth tables and columns) live in _ops files that
    # declare themselves for this replay (guard marker lsql-replay); each runs right before the first migration
    # that reads it. Older LOCAL_BOOTSTRAP_<ts> fixtures for single-migration harnesses have no such marker.
    for x in "$REPO"/supabase/_ops/LOCAL_BOOTSTRAP_"$ts"_*.sql; do
      [ -f "$x" ] && grep -q "IS DISTINCT FROM 'lsql-replay'" "$x" || continue
      printf '%s\n' '\connect postgres supabase_admin' "SET caaci.local_bootstrap = 'lsql-replay';" "\\echo BOOTSTRAP ${x##*/}" "\\i /work/_ops/${x##*/}" '\connect postgres postgres'
      case "$x" in *_cli_migration_ledger.sql)
        # The CLI records every migration it applies; record the ones already replayed before the ledger existed.
        ledger=1
        for r in "${rows[@]}"; do printf "INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('%s', '%s');\n" "${r%%|*}" "${r#*|}"; done;;
      esac
    done
    # realtime.messages and realtime.topic() come from Supabase Realtime, not the image.
    if [ "$ts" = 20260718240000 ]; then
      printf '%s\n' '\connect postgres supabase_admin' '\echo BOOTSTRAP LOCAL_BOOTSTRAP_20260718_private_conversation_realtime.sql' '\i /work/_ops/LOCAL_BOOTSTRAP_20260718_private_conversation_realtime.sql' '\connect postgres postgres'
    fi
    if [[ $CHECK == *" $ts "* ]]; then for x in "$REPO"/supabase/_ops/PRECHECK_"$ts"_*.sql; do [ -f "$x" ] && printf '\\echo PRECHECK %s\n\\i /work/_ops/%s\n' "${x##*/}" "${x##*/}"; done; fi
    base=${f%.sql}
    # Record the migration in the CLI ledger once it exists; before that, remember it for the backfill.
    rec=""
    if [ "$ledger" = 1 ]; then rec=$(printf "INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('%s', '%s');" "$ts" "${base#*_}"); else rows+=("$ts|${base#*_}"); fi
    # The ledger-aware migration endpoint owns the transaction for files without a top-level BEGIN
    # (several say so); wrap them so LOCK TABLE / SET LOCAL behave as hosted, and commit the ledger row with them.
    if grep -qE '^BEGIN;' "$REPO/supabase/migrations/$f"; then
      printf '\\echo REPLAY %s\n\\i /work/migrations/%s\n' "$f" "$f"
      [ -n "$rec" ] && printf '%s\n' "$rec"
    else
      printf '\\echo REPLAY %s\nBEGIN;\n\\i /work/migrations/%s\n' "$f" "$f"
      [ -n "$rec" ] && printf '%s\n' "$rec"
      printf 'COMMIT;\n'
    fi
    if [[ $CHECK == *" $ts "* ]]; then for x in "$REPO"/supabase/_ops/VERIFY_"$ts"_*.sql; do [ -f "$x" ] && printf '\\echo VERIFY %s\n\\i /work/_ops/%s\n' "${x##*/}" "${x##*/}"; done; fi
  done
  printf '%s\n' '\connect postgres supabase_admin'
  for ts in $CHECK; do for x in "$REPO"/supabase/_ops/REGRESSION_"$ts"_*.sql; do [ -f "$x" ] && printf '\\echo REGRESSION %s\n\\i /work/_ops/%s\n' "${x##*/}" "${x##*/}"; done; done
  printf '\\echo REPLAY_DONE\n'
}
emit | "${PSQL[@]}" >>"$LOG" 2>&1; rc=$?
files=$(ls -1 "$REPO"/supabase/migrations/*.sql | wc -l)
replayed=$(grep -c '^REPLAY [0-9]' "$LOG"); errors=$(grep -c 'ERROR:' "$LOG"); done_=$(grep -c '^REPLAY_DONE$' "$LOG")
echo "LSQL head=$(git -C "$REPO" rev-parse HEAD) files=$files replayed=$replayed errors=$errors done=$done_ rc=$rc log=$LOG"
[ "$rc" -eq 0 ] && [ "$files" -eq "$replayed" ] && [ "$errors" -eq 0 ] && [ "$done_" -eq 1 ]
