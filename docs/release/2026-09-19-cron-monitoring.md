# Detect a scheduler that never calls the worker

Authenticated production GET requests can send start/end check-ins to an existing
Sentry Cron monitor. Unauthorized calls, browser POSTs and Preview deployments
cannot report a successful run. A thrown error or unsuccessful HTTP response ends
as an error; reporting failure never changes the business response.

`SENTRY_CRON_MONITORS` is an explicit comma-separated allowlist from
`background-jobs,notification-digest,data-retention,banner-upload-gc,delete-account`.
The default is empty. A pre-existing monitor may have a different immutable slug;
set `SENTRY_CRON_SLUG_BACKGROUND_JOBS` (or equivalent upper-case job name) to that
actual slug. A display-name change does not change a slug.

The code does not send `monitor_config` and does not auto-create paid monitors.
Provision schedule, UTC timezone, grace interval, recipient and budget first.
The September 19 operational change opted in only the minute-by-minute background
worker to the first free monitor. The other four routes have instrumentation but
are not individually monitored until separately configured. Do not claim the whole
scheduler is covered by a single worker check-in.

Acceptance: observe a real scheduled start/completion on the deployed release;
then prove a missed-run alert and its recovery reach the on-call recipient. Existing
Sentry error-email receipt is not itself proof of this new missing-run alert.
Rollback removes the job from the allowlist; also pause/remove its external monitor
to prevent misleading missed-run alerts. Keep the responsible owner's identity in
the private operations checklist, not in public source control.
