# Support email replies

The H5 Admin support form is a release candidate. It is usable only after the
matching API, H5 build and support-email ledger migration have been deployed
and accepted. A successful local test is not a production send receipt.

## Operator workflow

1. Read the incoming message in the existing Gmail account that receives
   `help@illinimarket.com` through Cloudflare Email Routing. Confirm the actual
   sender and any Reply-To address. The application has no Gmail mailbox grant
   and does not automatically import incoming messages.
2. Copy the recipient, subject and any original message context you need before
   returning to Admin. Unlock with your existing personal **owner** token.
   Existing background/logout protection still clears private form state.
3. Open Support email, enter one recipient and the plain-text reply, then review
   the full recipient, subject and body in the confirmation step. The sending
   and reply address is always `help@illinimarket.com`; there are no CC/BCC,
   attachments, arbitrary HTML or automatic replies.
4. Confirm this specific message before sending. A valid original Message-ID
   can be supplied for mail-client threading. Without it, a matching subject
   alone is not proof that mail clients will combine the messages.
5. Keep the request/receipt identifier. **Sent means Resend accepted the
   request**, not that the recipient received or read it. Look up the receipt
   in [Resend → Emails → Sending](https://resend.com/emails). Actual delivery
   requires the provider event and, for acceptance tests, a real inbox receipt.

If sending is pending, times out, or has an unknown result, use the read-only
status check. It reads the application ledger, not Resend's delivery events.
Pending attempts older than two minutes display as unknown. If the process
stopped after provider acceptance but before recording the receipt, this state
can remain unknown indefinitely. Do not compose a replacement message to work around uncertainty.
The server records the attempt before dispatch and never automatically retries
an uncertain external send. Review the provider's existing logs using recipient,
subject, time and, where available, the `support-reply/<request UUID>` idempotency
key. Keep the original request ID; deleting its ledger entry or using a new UUID
is not a recovery procedure. This release has no automatic reconciliation or
manual override for an uncertain send.

Two explicit pre-dispatch rejections are safe to correct: the actor's ten-per-hour
limit, or a missing server mail key detected before attempting a claim. Only an
exact, request-bound `not_attempted` response to the fresh submission releases
the browser reservation. The draft remains, its preview is invalidated, and a
new send requires another review and confirmation. A timeout, unreadable reply,
schema error or failed receipt lookup never counts as this proof.

## Deployment and acceptance

- Use the existing server-only `RESEND_API_KEY`; never add a `VITE_` copy or
  expose it to the browser. Its permission to send from the verified root
  domain must be checked during authorized live acceptance. The connected
  Resend app's successful test does not prove the deployed key has the same
  domain scope. A provider rejection must not trigger a sender fallback.
- Apply the reviewed [support-email migration](../../supabase/migrations/20261003175231_admin_support_email_ledger.sql) through the normal
  migration release process before enabling the candidate UI. Missing schema
  or server configuration must leave sending unavailable.
- Existing owner authorization is checked again when claiming a send.
  Operator and security-admin roles cannot use this surface. No token or role
  provisioning is part of this feature.
- The durable ledger binds an idempotency UUID to one actor and one message
  fingerprint. Request IDs are retained permanently to prevent duplicate sends;
  current receipt metadata includes recipient and subject. It retains no email body or
  plaintext administrator token. Concurrent submissions of the same request
  cannot dispatch twice; a changed payload cannot reuse the same request.
- The browser retains only opaque recovery identifiers. Drafts, recipients,
  message bodies and credentials are not persisted in browser storage.
- Live acceptance uses only explicitly approved test addresses. Confirm the
  exact From/To, an actual inbox receipt, threading when supplied, and absence
  of duplicate sends before describing the workflow as operational.

Cloudflare forwarding remains the inbound route. This feature does not create
a separately loginable mailbox, a Gmail Send-as alias, a new provider account,
or a new credential. It does not move the domain's MX records.

## Verification artifacts

- [Read-only precheck](../../supabase/_ops/PRECHECK_20261003175231_admin_support_email_ledger.sql)
  and [read-only schema/ACL verification](../../supabase/_ops/VERIFY_20261003175231_admin_support_email_ledger.sql).
- [Rollback-only SQL regression](../../supabase/_ops/REGRESSION_20261003175231_admin_support_email_ledger.sql)
  and [isolated local PostgreSQL runner](../../supabase/_ops/run_support_email_ledger_local.py).
  The mandatory Node boundary suite invokes the runner when local PostgreSQL
  is installed and requires it in CI. Its synthetic tables test this feature's
  real SQL and authorization functions, not the complete hosted migration history.
- API tests mock Resend and PostgreSQL HTTP calls. Compiled H5 browser tests
  use synthetic owner identities and intercept external requests. Neither is
  evidence of a real recipient receiving an email.
