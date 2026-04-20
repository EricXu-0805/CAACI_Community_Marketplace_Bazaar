# k6 stress tests

Load-test harness for the publish / message / report / moderate paths.

These scripts are not part of CI. Run them manually against a
**staging** Supabase project, not production. A handful of test
accounts will be blown up (rate limits tripped, accounts flagged).

## Install k6

```bash
brew install k6          # macOS
# or: https://k6.io/docs/get-started/installation/
```

## One-time setup

1. Create 10 throwaway accounts in the Supabase dashboard of your
   staging project. Write them to `accounts.txt` one line per
   account as `email:password`. Keep this file out of git.

2. Log into the app as one of those accounts and tap "Message seller"
   on any listing to create a conversation. Copy the conversation id
   from the URL — you'll need it for `message_flood.js`.

3. Pick a victim profile id (any real profile) to target for
   `report_abuse.js`.

## Run

```bash
export SUPABASE_URL="https://<proj>.supabase.co"
export SUPABASE_ANON_KEY="eyJhbGci..."
export APP_ORIGIN="https://caaci-community-marketplace-bazaar.vercel.app"
export TEST_ACCOUNTS_FILE="./accounts.txt"

# 1. Publish-path burst
k6 run tests/k6/publish_spam.js

# 2. Message flood into a single conversation
CONVERSATION_ID="<uuid>" k6 run tests/k6/message_flood.js

# 3. Report bombardment against one profile
TARGET_PROFILE_ID="<uuid>" k6 run tests/k6/report_abuse.js

# 4. Moderate endpoint stress
k6 run tests/k6/moderate_endpoint.js
```

## What each test asserts

| Script | Verifies |
|---|---|
| `publish_spam.js` | Moderation triggers on posts reject contact-info payloads; p95 < 1.5 s under 30 VUs |
| `message_flood.js` | `rate_limit_messages_minute` fires; message moderation blocks WeChat/QQ IDs; no 5xx |
| `report_abuse.js` | `reports_unique_reporter_target` + hourly rate limit stop flag-bombs |
| `moderate_endpoint.js` | `/api/moderate` stays under p95 2 s at 50 rps, no 5xx |

## Thresholds and pass/fail

Every script has `thresholds` in `options`. If any threshold is
breached, k6 exits non-zero. Output includes per-check pass rate and
per-operation latency breakdown.

## If a test fails

- **`rate_limit_*` NOT firing** — migration 012 probably hasn't
  been run on the target project. Verify `SELECT * FROM
  rate_limits LIMIT 1` works.
- **moderation block NOT firing** — migrations 024+025 missing.
  Verify `SELECT count(*) FROM moderation_keywords WHERE active`.
- **5xx from /api/moderate** — check Vercel logs. Most likely
  `OPENAI_API_KEY` env var missing or Tier 0 account hitting 429s.
