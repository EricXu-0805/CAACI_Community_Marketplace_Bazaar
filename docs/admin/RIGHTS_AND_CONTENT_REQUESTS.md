# Rights, Appeals, and Content-Complaint Runbook

This runbook is the manual bridge for privacy-rights requests, appeal outcomes,
and copyright/content complaints that are not yet represented by a complete
operator workflow in the product. It does not create a legal deadline or
replace jurisdiction-specific advice. The operator must record the law and
deadline that actually apply to each case.

## Launch gate and recurring drill

Before treating `help@illinimarket.com` as an operational support channel:

1. From a controlled external mailbox, send a uniquely identifiable test
   message to the alias.
2. Confirm that an authorized operator receives it, can reply from an approved
   address, and that the reply reaches the external mailbox without exposing
   an unintended personal address.
3. Record the date, operator, message IDs, result, and any forwarding rule in
   the restricted operations log. Do not copy message contents into Git.
4. Repeat after mail-provider or DNS changes and at least quarterly.

The repository contains policy text and this procedure, but it cannot prove
that the mailbox is currently monitored. Until the controlled send-and-reply
test passes, the public support/export/DMCA promise is a launch blocker.

## Common case controls

For every request:

- Create a non-guessable case ID and record received time, source channel,
  request type, account UUID if known, assigned operator, applicable deadline,
  verification steps, searches performed, decision, disclosures/redactions,
  delivery method, and completion time.
- Keep the case log and exported files in an approved restricted system, not
  this repository, browser local storage, chat, or a public Storage bucket.
- Never ask for a password, one-time code, recovery token, admin token, or full
  identity document by ordinary email.
- Treat links and attachments as hostile. Preview only in the approved
  isolated workflow and never run an attachment.
- Use least privilege: the operator who communicates with the requester does
  not need permanent service-role credentials. Privileged queries should be
  reviewed, attributable, and copied into the case record without secrets.
- Preserve relevant evidence when a dispute, fraud investigation, safety
  incident, or legal hold applies. Record why ordinary deletion was paused and
  seek counsel where required.

## Identity verification

Use a method proportionate to the requested data:

1. Prefer a request initiated from the signed-in account or confirmation sent
   to the account's currently verified email.
2. Match the supplied account UUID or profile URL to the authenticated account;
   do not rely on a public nickname alone.
3. If the requester cannot access the account email, collect only the minimum
   corroborating facts already present in the account and escalate for manual
   review. Do not reveal whether unrelated email addresses or accounts exist.
4. For an authorized agent, verify both the requester's identity and the
   agent's authority before disclosing or deleting data.
5. Record the verification method and outcome, not passwords, codes, or copies
   of unnecessary identity documents.

If identity cannot be established, explain what safe proof is still needed and
leave the case open or deny it according to the applicable law. Never disclose
account data merely because the sender controls a similar-looking address.

## Data access/export request

There is currently no complete self-service or one-click admin export. An
operator must assemble and review an export manually from the production
schema actually deployed at the time of the request.

The inventory should cover, when linked to the verified account and present:

- profile and public identifiers, account/affiliation-verification fields, and
  recorded legal-consent versions;
- listings, Plaza posts, comments, uploaded-media references, and messages the
  requester sent or received;
- favorites, follows, likes, saved searches, authenticated item-view records,
  ratings and review text;
- offers and meetup proposals, including counterparties, status, notes,
  timestamps, and expiry;
- the authoritative private sale-attribution row for an owned or attributed
  sold listing, including the selected accepted offer/conversation references,
  attributed roles, agreed price, and acceptance/confirmation timestamps;
- blocks, notifications, notification preferences, reports submitted by the
  requester, suspensions/appeals concerning the requester, and relevant
  device-fingerprint records;
- any account-deletion job or tombstone associated with the account, if the
  account is already in or through the deletion process.

Before delivery:

1. Reconcile the current schema and migration ledger; do not assume the list
   above is exhaustive after future releases.
2. Redact another person's private data unless disclosure is required and
   lawful. Shared messages require particular review; do not export internal
   report snapshots, reporter identity, trust signals, admin notes, security
   secrets, or third-party data merely because they reference the requester.
   For sale attribution, disclose the requester's own transaction role and
   transaction facts only after reviewing whether the other party's account
   identifiers, offer note, or conversation reference must be redacted.
3. Produce a machine-readable archive plus a short field glossary. Record row
   counts and the exact query/release version in the case log.
4. Have a second authorized operator review identity, scope, and redactions.
5. Deliver through an authenticated, encrypted, expiring channel. Send any
   decryption secret separately. Confirm receipt, then delete temporary export
   copies from operator devices and record that cleanup.

Do not promise an export completion date until the applicable jurisdiction,
identity status, and data scope have been recorded.

## Correction and deletion requests

- Direct ordinary profile corrections to the in-app profile editor where
  possible. For fields that cannot be edited, verify identity and document the
  exact old/new value and data source before a privileged change.
- Direct full account deletion to Settings -> Delete Account. The current
  deletion saga is asynchronous and can require cron recovery; an accepted job
  is not completion. Confirm the job reached its terminal completed stage and
  investigate any retryable backlog before closing the case.
- Explain the documented consequences before deletion: it is permanent, it
  currently removes the shared conversation/messages for both participants,
  and limited tombstone, moderation, enforcement, report, or audit evidence can
  remain as described in the Privacy Policy or because of a valid legal hold.
- Verify the private sale-attribution foreign keys after deletion: deleting the
  listing owner should cascade the listing/deal; deleting only the counterparty
  should clear participant, selected-offer, and conversation links without
  blocking the deletion or leaving that identity eligible to rate.
- If the user cannot sign in, verify identity first and use a reviewed
  privileged procedure. Never improvise direct table deletion: Storage, Auth,
  database rows, mappings, and durable recovery state must remain consistent.

## Enforcement appeals

> Production availability gate: while the compatibility bridge is serving,
> including any final-to-bridge rollback window, administrators may preserve
> and review the queue but must not submit appeal mutations. Resume the
> three-outcome workflow only after migration `20260720035037` VERIFY, the
> exact final Edge deployment, and a real positive administrator/audit check
> all succeed.

The app accepts one in-app appeal note per suspension. The dashboard records
accepted, denied, and more-information-required review events; accepted and
denied are terminal, while a request for more information remains in the queue
for a later terminal decision. Decision recording does not provide a
guaranteed user notification or delivery receipt.

For every appeal:

1. Link the suspension, appeal text, original evidence, policy section, and
   reviewer to the case ID. Preserve evidence before opening media that might
   later be deleted.
2. Use an operator who was not the subject of the complaint and, for severe or
   permanent actions, prefer a second-person review.
3. The reviewer must not be the appealed suspension's subject. The database
   enforces this for both structured decisions and direct lift actions; transfer
   the case instead of attempting a workaround.
4. Record `accepted`, `denied`, or `more information required`, the rationale,
   effective time, and whether the suspension remains active.
5. For acceptance, use the dashboard's **Accept** action with a specific reason
   and verify the audit event and restored effective visibility when the action
   was still active. An expired action remains expired; acceptance must not
   manufacture a lift.
6. For denial or a request for more information, leave the enforcement state
   unchanged and verify the restricted audit event. A more-information request
   is non-terminal and must remain visible in the queue.
7. For every outcome, reply through the verified support channel and record the
   delivery result in the approved case log. Neither a decision row nor removal
   from the pending queue proves that the user was notified. Accepting a still-
   active action triggers the existing in-app account-restriction-lifted notice
   only when no other active L2+ suspension continues to restrict that profile.
   If an overlapping restriction remains, the automatic notice instead says
   only that one action was lifted and another restriction is still active.
   Neither notice is a structured appeal decision or a verified delivery
   receipt; denial, more-information, and already-inactive acceptance still
   have no equivalent automatic decision notice.

## Copyright and other content complaints

Keep copyright requests separate from ordinary policy reports. A purported
DMCA notice should be reviewed for, at minimum:

- the claimant's physical or electronic signature;
- identification of the copyrighted work (or a representative list);
- identification and location of the allegedly infringing material, preferably
  with exact Illini Market URLs/IDs;
- claimant contact information;
- statements of good-faith belief and accuracy/authority under penalty of
  perjury.

Log receipt, preserve the complained-of record and report snapshot when lawful,
restrict or remove only the identified material after review, notify the
uploader when appropriate, and record every action. A counter-notice requires
its own identity and statutory-element review; do not restore content on an
invented timetable. Repeat-infringer handling, subpoenas, counter-notices,
international requests, and unclear ownership claims should be escalated to
qualified counsel. Ordinary operators must not offer legal conclusions.

Non-copyright complaints (trademark, impersonation, privacy, doxing, threats,
or illegal goods) follow the normal report/safety workflow, with emergency
escalation for credible imminent harm and legal review where required.

## Closure checklist

- Identity and authority verified at the appropriate level.
- Applicable jurisdiction/deadline and any extension recorded.
- Data sources, searches, redactions, evidence holds, and decision recorded.
- A second review completed where required.
- Response delivered through a verified channel and delivery confirmed.
- Temporary exports/evidence copies cleaned up or placed under a documented
  retention/legal hold.
- Case log closed with timestamp and operator identity.

The mailbox drill, an end-to-end sample export, an appeal accept/deny exercise,
and a sample content-complaint exercise must be completed in a staging or
controlled environment before launch. This document records the procedure; it
does not claim that any of those operational drills have passed.
