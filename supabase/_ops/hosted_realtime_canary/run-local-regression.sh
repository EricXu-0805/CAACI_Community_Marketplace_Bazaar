#!/usr/bin/env bash

set -euo pipefail
umask 077

if (( $# != 0 )); then
  echo "[LOCAL-PG] This runner accepts no arguments" >&2
  exit 1
fi

# This runner is intentionally local-only. It creates an isolated PostgreSQL
# cluster under /private/tmp, disables TCP listening, and removes the cluster
# when the regression finishes. It never accepts a database URL or credential.
for ambient_name in \
  PGHOST PGHOSTADDR PGPORT PGUSER PGDATABASE PGSERVICE PGSERVICEFILE \
  PGOPTIONS PGPASSFILE PGPASSWORD PGSSLMODE
do
  unset "$ambient_name"
done

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
initdb_bin="$(command -v initdb || true)"

if [[ -z "$initdb_bin" ]]; then
  echo "[LOCAL-PG] PostgreSQL initdb is required" >&2
  exit 1
fi

pg_bin_dir="$(cd -- "$(dirname -- "$initdb_bin")" && pwd -P)"
pg_ctl_bin="$pg_bin_dir/pg_ctl"
postgres_bin="$pg_bin_dir/postgres"
psql_bin="$pg_bin_dir/psql"

for required_bin in "$pg_ctl_bin" "$postgres_bin" "$psql_bin"; do
  if [[ ! -x "$required_bin" ]]; then
    echo "[LOCAL-PG] PostgreSQL binaries must come from one installation" >&2
    exit 1
  fi
done

postgres_version="$("$postgres_bin" --version)"
postgres_major="$(
  printf '%s\n' "$postgres_version" |
    sed -E 's/.*PostgreSQL\)? ([0-9]+)(\.[0-9]+)*.*$/\1/'
)"
if [[ "$postgres_major" != "16" && "$postgres_major" != "17" ]]; then
  echo "[LOCAL-PG] This reproducibility runner requires PostgreSQL 16.x or 17.x" >&2
  exit 1
fi

cluster_root="$(mktemp -d /private/tmp/caaci-hosted-pg-local.XXXXXX)"
cluster_data="$cluster_root/data"
cluster_socket="$cluster_root/socket"
server_log="$cluster_root/postgres.log"
regression_log="$(mktemp /private/tmp/caaci-hosted-realtime-regression.XXXXXX)"

mkdir -m 700 "$cluster_socket"

stop_and_remove_cluster() {
  if [[ -z "${cluster_root:-}" ]]; then
    return 0
  fi

  case "$cluster_root" in
    /private/tmp/caaci-hosted-pg-local.*)
      ;;
    *)
      echo "[LOCAL-PG] Refused unsafe temporary cleanup target" >&2
      return 1
      ;;
  esac

  if [[ -f "$cluster_data/postmaster.pid" ]] ||
     "$pg_ctl_bin" -D "$cluster_data" status >/dev/null 2>&1
  then
    if ! "$pg_ctl_bin" \
      -D "$cluster_data" \
      -m fast \
      -t 15 \
      -w \
      stop >/dev/null 2>&1
    then
      echo \
        "[LOCAL-PG] PostgreSQL did not stop; preserved $cluster_root" \
        >&2
      return 1
    fi
  fi

  if ! rm -rf -- "$cluster_root"; then
    echo "[LOCAL-PG] Temporary cluster cleanup failed: $cluster_root" >&2
    return 1
  fi

  cluster_root=''
  return 0
}

cleanup() {
  exit_code=$?
  trap - EXIT HUP INT TERM
  set +e

  if ! stop_and_remove_cluster; then
    exit_code=1
  fi

  if (( exit_code != 0 )) &&
     [[ -n "${regression_log:-}" && -f "$regression_log" ]]; then
    echo "[LOCAL-PG] evidence_log=$regression_log" >&2
  fi

  exit "$exit_code"
}

compute_source_manifest_sha256() {
  if command -v shasum >/dev/null 2>&1; then
    for source_file in \
      ../VERIFY_20260719164126_reconcile_managed_realtime_authorization_contract.sql \
      STAGING_PREREQ_enable_pg_cron.sql \
      ACTIVATE.sql PRECHECK.sql VERIFY.sql VERIFY_BODY.sql \
      VERIFY_CRON_BODY.sql RECOVER.sql ROLLBACK.sql \
      LOCAL_BOOTSTRAP.sql LOCAL_EXPECT_VERIFY_FAILURE.sql \
      LOCAL_REGRESSION.sql run-local-regression.sh
    do
      printf '%s\n' "$source_file"
      shasum -a 256 "$script_dir/$source_file" | awk '{ print $1 }'
    done | shasum -a 256 | awk '{ print $1 }'
  elif command -v sha256sum >/dev/null 2>&1; then
    for source_file in \
      ../VERIFY_20260719164126_reconcile_managed_realtime_authorization_contract.sql \
      STAGING_PREREQ_enable_pg_cron.sql \
      ACTIVATE.sql PRECHECK.sql VERIFY.sql VERIFY_BODY.sql \
      VERIFY_CRON_BODY.sql RECOVER.sql ROLLBACK.sql \
      LOCAL_BOOTSTRAP.sql LOCAL_EXPECT_VERIFY_FAILURE.sql \
      LOCAL_REGRESSION.sql run-local-regression.sh
    do
      printf '%s\n' "$source_file"
      sha256sum "$script_dir/$source_file" | awk '{ print $1 }'
    done | sha256sum | awk '{ print $1 }'
  else
    echo "[LOCAL-PG] SHA-256 utility is required" >&2
    return 1
  fi
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' HUP TERM

if ! "$initdb_bin" \
  -D "$cluster_data" \
  -U caaci_bootstrap \
  --auth-local=trust \
  --auth-host=reject \
  --encoding=UTF8 \
  -c createrole_self_grant= \
  -c dynamic_shared_memory_type=posix \
  --no-locale >"$cluster_root/initdb.log" 2>&1
then
  tail -n 120 "$cluster_root/initdb.log" >&2
  exit 1
fi

if ! "$pg_ctl_bin" \
  -D "$cluster_data" \
  -l "$server_log" \
  -o "-F -k $cluster_socket -c listen_addresses= -c createrole_self_grant= -c dynamic_shared_memory_type=posix" \
  -w \
  start >/dev/null 2>&1
then
  tail -n 120 "$server_log" >&2
  exit 1
fi

"$psql_bin" \
  -X \
  -v ON_ERROR_STOP=1 \
  -h "$cluster_socket" \
  -U caaci_bootstrap \
  -d postgres \
  -c "CREATE ROLE service_role NOLOGIN BYPASSRLS; CREATE ROLE supabase_admin NOLOGIN;" >/dev/null

"$psql_bin" \
  -X \
  -v ON_ERROR_STOP=1 \
  -h "$cluster_socket" \
  -U caaci_bootstrap \
  -d postgres \
  -c "CREATE ROLE postgres LOGIN NOSUPERUSER CREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS INHERIT; GRANT supabase_admin TO postgres WITH INHERIT FALSE, SET TRUE; GRANT pg_read_all_data TO postgres WITH INHERIT TRUE, SET TRUE;" >/dev/null

if [[ "$postgres_major" == "17" ]]; then
  "$psql_bin" \
    -X \
    -v ON_ERROR_STOP=1 \
    -h "$cluster_socket" \
    -U caaci_bootstrap \
    -d postgres \
    -c "GRANT pg_maintain TO postgres WITH ADMIN TRUE, INHERIT FALSE, SET FALSE;" >/dev/null
fi

"$psql_bin" \
  -X \
  -v ON_ERROR_STOP=1 \
  -h "$cluster_socket" \
  -U caaci_bootstrap \
  -d postgres \
  -c "ALTER ROLE postgres SET createrole_self_grant = '';" >/dev/null

"$psql_bin" \
  -X \
  -v ON_ERROR_STOP=1 \
  -h "$cluster_socket" \
  -U caaci_bootstrap \
  -d postgres \
  -c "CREATE DATABASE caaci_hosted_realtime_regression OWNER postgres TEMPLATE template0;" >/dev/null

operator_contract="$(
  "$psql_bin" \
    -X \
    -Aqt \
    -v ON_ERROR_STOP=1 \
    -h "$cluster_socket" \
    -U postgres \
    -d caaci_hosted_realtime_regression \
    -c "
      SELECT CASE
        WHEN current_user = 'postgres'
         AND session_user = 'postgres'
         AND pg_catalog.current_database() =
               'caaci_hosted_realtime_regression'
         AND pg_catalog.inet_server_addr() IS NULL
         AND NOT role.rolsuper
         AND role.rolcanlogin
         AND role.rolcreaterole
         AND NOT role.rolcreatedb
         AND NOT role.rolreplication
         AND NOT role.rolbypassrls
         AND role.rolinherit
         AND pg_catalog.current_setting('createrole_self_grant') = ''
         AND pg_catalog.pg_has_role(
           'postgres', 'pg_read_all_data', 'USAGE'
         )
         AND CASE
           WHEN pg_catalog.current_setting(
             'server_version_num'
           )::integer < 170000 THEN true
           ELSE pg_catalog.pg_has_role(
             'postgres', 'pg_maintain', 'MEMBER'
           )
             AND NOT pg_catalog.pg_has_role(
               'postgres', 'pg_maintain', 'USAGE'
             )
             AND NOT pg_catalog.pg_has_role(
               'postgres', 'pg_maintain', 'SET'
             )
         END
         AND (
           SELECT database_owner.rolname = 'postgres'
           FROM pg_catalog.pg_database AS database
           JOIN pg_catalog.pg_roles AS database_owner
             ON database_owner.oid = database.datdba
           WHERE database.datname = pg_catalog.current_database()
         )
         AND (
           SELECT service_role.rolbypassrls
              AND NOT service_role.rolcanlogin
              AND NOT service_role.rolsuper
           FROM pg_catalog.pg_roles AS service_role
           WHERE service_role.rolname = 'service_role'
         )
         AND NOT EXISTS (
           SELECT 1
           FROM pg_catalog.pg_auth_members AS membership
           WHERE membership.roleid =
                   pg_catalog.to_regrole('service_role')
             AND membership.member =
                   pg_catalog.to_regrole('postgres')
         )
         AND NOT EXISTS (
           SELECT 1
           FROM pg_catalog.pg_roles AS unexpected_role
           WHERE unexpected_role.rolname IN (
             'anon',
             'authenticated',
             'supabase_realtime_admin',
             'caaci_hosted_realtime_executor'
           )
         )
         AND NOT EXISTS (
           SELECT 1
           FROM pg_catalog.pg_namespace AS unexpected_schema
           WHERE unexpected_schema.nspname IN (
             'auth',
             'private',
             'extensions',
             'cron',
             'realtime'
           )
         )
        THEN 'ok'
        ELSE 'invalid'
      END
      FROM pg_catalog.pg_roles AS role
      WHERE role.rolname = current_user;
    "
)"
if [[ "$operator_contract" != "ok" ]]; then
  echo "[LOCAL-PG] Separate non-superuser operator contract failed" >&2
  exit 1
fi

source_manifest_before="$(compute_source_manifest_sha256)"
{
  echo "[LOCAL-PG] server=$postgres_version"
  echo "[LOCAL-PG] endpoint=isolated-unix-socket"
  echo "[LOCAL-PG] operator=postgres LOGIN NOSUPERUSER CREATEROLE"
  echo "[LOCAL-PG] trusted_operator_baseline=pg_read_all_data inherited"
  if [[ "$postgres_major" == "17" ]]; then
    echo "[LOCAL-PG] pg17_maintain_negative=enabled"
  fi
  echo "[LOCAL-PG] preflight=pass"
  echo "[LOCAL-PG] source_manifest_before=$source_manifest_before"
} >"$regression_log"

if ! "$psql_bin" \
  -X \
  -v ON_ERROR_STOP=1 \
  -h "$cluster_socket" \
  -U postgres \
  -d caaci_hosted_realtime_regression \
  -f "$script_dir/LOCAL_BOOTSTRAP.sql" >>"$regression_log" 2>&1
then
  echo "[LOCAL-PG] Bootstrap failed; final output follows" >&2
  tail -n 240 "$regression_log" >&2
  exit 1
fi

if ! "$psql_bin" \
  -X \
  -v ON_ERROR_STOP=1 \
  -h "$cluster_socket" \
  -U caaci_bootstrap \
  -d caaci_hosted_realtime_regression \
  -c "REVOKE supabase_admin FROM postgres;" >>"$regression_log" 2>&1
then
  echo "[LOCAL-PG] Auth-owner membership revoke failed" >&2
  exit 1
fi

local_project_ref='abcdefghijklmnopqrst'
local_dataset_lineage='local-fixture-v1'
local_sentinel_id='66666666-6666-4666-8666-666666666666'
local_fixture_revision='1'
local_actor_a_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
local_actor_b_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'
local_actor_c_id='cccccccc-cccc-4ccc-8ccc-ccccccccccc3'
local_conversation_ab_id='44444444-4444-4444-8444-444444444444'
local_conversation_ac_id='55555555-5555-4555-8555-555555555555'
local_approval_reference='local-pg-cron-prerequisite-regression'

local_fixture_fields=(
  'caaci-hosted-fixture-v1'
  "$local_project_ref"
  "$local_dataset_lineage"
  "$local_sentinel_id"
  "$local_fixture_revision"
  'member-a'
  "$local_actor_a_id"
  'member-b'
  "$local_actor_b_id"
  'member-c'
  "$local_actor_c_id"
  'ab'
  "$local_conversation_ab_id"
  'ac'
  "$local_conversation_ac_id"
)
if command -v shasum >/dev/null 2>&1; then
  local_fixture_manifest_sha256="$(
    {
      printf '%s' "${local_fixture_fields[0]}"
      for ((field_index = 1;
            field_index < ${#local_fixture_fields[@]};
            field_index++))
      do
        printf '\037%s' "${local_fixture_fields[$field_index]}"
      done
    } | shasum -a 256 | awk '{ print $1 }'
  )"
else
  local_fixture_manifest_sha256="$(
    {
      printf '%s' "${local_fixture_fields[0]}"
      for ((field_index = 1;
            field_index < ${#local_fixture_fields[@]};
            field_index++))
      do
        printf '\037%s' "${local_fixture_fields[$field_index]}"
      done
    } | sha256sum | awk '{ print $1 }'
  )"
fi
if [[ ! "$local_fixture_manifest_sha256" =~ ^[0-9a-f]{64}$ ]]; then
  echo "[LOCAL-PG] Prerequisite fixture manifest generation failed" >&2
  exit 1
fi

prerequisite_common_args=(
  -X
  -v ON_ERROR_STOP=1
  -v prerequisite_mode=local-guard-only
  -v "dataset_lineage=$local_dataset_lineage"
  -v "fixture_manifest_sha256=$local_fixture_manifest_sha256"
  -v "sentinel_id=$local_sentinel_id"
  -v "fixture_revision=$local_fixture_revision"
  -v "actor_a_id=$local_actor_a_id"
  -v "actor_b_id=$local_actor_b_id"
  -v "actor_c_id=$local_actor_c_id"
  -v "conversation_ab_id=$local_conversation_ab_id"
  -v "conversation_ac_id=$local_conversation_ac_id"
  -v "approval_reference=$local_approval_reference"
  -h "$cluster_socket"
  -U postgres
  -d caaci_hosted_realtime_regression
)

prerequisite_negative_log="$cluster_root/prerequisite-known-production.log"
if "$psql_bin" \
  "${prerequisite_common_args[@]}" \
  -v project_ref=lfhvgprfphyfvhidegum \
  -f "$script_dir/STAGING_PREREQ_enable_pg_cron.sql" \
  >"$prerequisite_negative_log" 2>&1
then
  echo "[LOCAL-PG] Known-production prerequisite negative unexpectedly passed" \
    >&2
  exit 1
fi
if ! grep -Fq \
  'staging_prerequisite_refused_known_production_project' \
  "$prerequisite_negative_log"
then
  echo "[LOCAL-PG] Known-production prerequisite failed for the wrong reason" \
    >&2
  tail -n 120 "$prerequisite_negative_log" >&2
  exit 1
fi
{
  echo "[LOCAL-PG] prerequisite_known_production_negative=pass"
  cat "$prerequisite_negative_log"
} >>"$regression_log"

if ! "$psql_bin" \
  "${prerequisite_common_args[@]}" \
  -v "project_ref=$local_project_ref" \
  -f "$script_dir/STAGING_PREREQ_enable_pg_cron.sql" \
  >>"$regression_log" 2>&1
then
  echo "[LOCAL-PG] Prerequisite target-binding regression failed" >&2
  tail -n 240 "$regression_log" >&2
  exit 1
fi
echo "[LOCAL-PG] prerequisite_target_binding=pass" >>"$regression_log"

if ! "$psql_bin" \
  -X \
  -v ON_ERROR_STOP=1 \
  -h "$cluster_socket" \
  -U postgres \
  -d caaci_hosted_realtime_regression \
  -f "$script_dir/LOCAL_REGRESSION.sql" >>"$regression_log" 2>&1
then
  echo "[LOCAL-PG] Regression failed; final output follows" >&2
  tail -n 240 "$regression_log" >&2
  exit 1
fi

leftover_count="$(
  "$psql_bin" \
    -X \
    -Aqt \
    -v ON_ERROR_STOP=1 \
    -h "$cluster_socket" \
    -U caaci_bootstrap \
    -d caaci_hosted_realtime_regression \
    -c "
      SELECT
        (pg_catalog.to_regrole('caaci_hosted_realtime_executor')
          IS NOT NULL)::integer
        + (pg_catalog.to_regprocedure(
             'public.hosted_realtime_canary_environment()'
           ) IS NOT NULL)::integer
        + (
            SELECT pg_catalog.count(*)::integer
            FROM cron.job
          )
        + (
            SELECT pg_catalog.count(*)::integer
            FROM pg_catalog.pg_class AS relation
            JOIN pg_catalog.pg_namespace AS namespace
              ON namespace.oid = relation.relnamespace
            WHERE namespace.nspname = 'private'
              AND relation.relname LIKE 'hosted_realtime_canary_%'
          )
        + (
            SELECT pg_catalog.count(*)::integer
            FROM pg_catalog.pg_proc AS procedure
            JOIN pg_catalog.pg_namespace AS namespace
              ON namespace.oid = procedure.pronamespace
            WHERE procedure.proname LIKE 'hosted_realtime_canary_%'
              AND namespace.nspname IN ('public', 'private')
          )
        + (
            SELECT pg_catalog.count(*)::integer
            FROM pg_catalog.pg_policy AS policy
            WHERE policy.polname LIKE 'hosted_realtime_canary_%'
          )
        + (
            SELECT pg_catalog.count(*)::integer
            FROM pg_catalog.pg_trigger AS trigger
            WHERE NOT trigger.tgisinternal
              AND trigger.tgname LIKE '%hosted_realtime_canary%'
          )
        + (
            SELECT pg_catalog.count(*)::integer
            FROM auth.sessions
          )
        + (
            SELECT pg_catalog.count(*)::integer
            FROM public.messages
          )
        + (
            SELECT pg_catalog.count(*)::integer
            FROM public.conversation_archives
          )
        + (
            SELECT pg_catalog.count(*)::integer
            FROM public.notifications
          )
        + (
            SELECT pg_catalog.count(*)::integer
            FROM realtime.messages
          )
        + pg_catalog.abs(
            (SELECT pg_catalog.count(*)::integer FROM auth.users) - 3
          )
        + pg_catalog.abs(
            (SELECT pg_catalog.count(*)::integer FROM public.profiles) - 3
          )
        + pg_catalog.abs(
            (SELECT pg_catalog.count(*)::integer
             FROM public.conversations) - 2
          )
        + (
            SELECT CASE
              WHEN role.rolcanlogin
               AND NOT role.rolsuper
               AND role.rolcreaterole
               AND NOT role.rolcreatedb
               AND NOT role.rolreplication
               AND NOT role.rolbypassrls
              THEN 0
              ELSE 1
            END
            FROM pg_catalog.pg_roles AS role
            WHERE role.rolname = 'postgres'
          );
    "
)"
if [[ "$leftover_count" != "0" ]]; then
  echo "[LOCAL-PG] Rollback residue check failed" >&2
  exit 1
fi

echo "[LOCAL-PG] final_residue=0" >>"$regression_log"

source_manifest_after="$(compute_source_manifest_sha256)"
if [[ "$source_manifest_after" != "$source_manifest_before" ]]; then
  echo "[LOCAL-PG] SQL sources changed during the regression" >&2
  exit 1
fi
source_manifest_sha256="$source_manifest_after"

echo "[LOCAL-PG] source_manifest_sha256=$source_manifest_sha256" \
  >>"$regression_log"

if ! stop_and_remove_cluster; then
  echo "[LOCAL-PG] Local cluster cleanup did not complete" >&2
  exit 1
fi

echo "[LOCAL-PG] cluster_cleanup=pass" >>"$regression_log"
echo "[LOCAL-PG] PASS PostgreSQL $postgres_major isolated non-superuser regression" \
  >>"$regression_log"
echo "[LOCAL-PG] source_manifest_sha256=$source_manifest_sha256"
echo "[LOCAL-PG] PASS PostgreSQL $postgres_major isolated non-superuser regression"
echo "[LOCAL-PG] evidence_log=$regression_log"
