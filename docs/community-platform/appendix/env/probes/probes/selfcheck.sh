#!/usr/bin/env bash
# Print only RUNBOOK 5.2 self-check outputs; never source the environment.
set -uo pipefail
file=$HOME/.config/illini/staging.env
permission=$(stat -c %a "$file") || exit 3
forbidden=$(grep -cE 'service_role|sb_secret|lfhvgprf''phyfvhidegum|wslzeqhip''vibeflmxznh' "$file")
url=$(grep -c '^STAGING_SUPABASE_URL=https://hygkwxugskijadgfisji.supabase.co$' "$file")
names=$(cut -d= -f1 "$file" | sort | tr '\n' ' ')
printf '%s\n%s\n%s\n%s\n' "$permission" "$forbidden" "$url" "$names"
[ "$permission" = 600 ] && [ "$forbidden" = 0 ] && [ "$url" = 1 ] \
  && [ "$names" = 'STAGING_SUPABASE_ANON_KEY STAGING_SUPABASE_URL SYN_A_EMAIL SYN_A_PASSWORD SYN_B_EMAIL SYN_B_PASSWORD SYN_C_EMAIL SYN_C_PASSWORD ' ]
