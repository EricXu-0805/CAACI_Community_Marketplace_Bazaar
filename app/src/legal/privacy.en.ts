export const PRIVACY_VERSION = '2026-07-18'

export const PRIVACY_EN = `Privacy Policy

Effective date: July 18, 2026
Version: ${PRIVACY_VERSION}

1. Scope.
This Privacy Policy explains what information Illini Market collects, how we use it, who we share it with, and what choices you have. By using the service you agree to this policy.

2. Information We Collect.

   a. Account data. Email address (required), nickname, avatar, short bio, and the campus/area you select. If you optionally verify a University of Illinois affiliation, we store the verified Illinois email on your profile; while a code is pending, we store the normalized address, a hash of the short-lived code, its expiry, attempt count, and send timing/count metadata. An abandoned pending record can remain until a later verification attempt, account deletion, or a maintenance cleanup. If you use WeChat sign-in, we store the account's WeChat openid and, when supplied by WeChat, unionid; an internal placeholder email is used only to represent that identity in Supabase Auth.

   b. Listing and community data. Titles, descriptions, photos, prices, categories, and approximate pickup locations you enter. Plaza posts, comments, and messages. Items you favorite or save.

   c. Communication data. Messages between you and other users, including message timestamps and read receipts. Reports you submit about other users or content.

   d. Interaction and reputation data. Favorites, follows, likes, saved-search terms/filters, ratings and review text, and the item/account pair plus timestamp for an authenticated listing view (used to count one view per viewer). A transaction rating is accepted only from one of the two parties attributed to that exact sold listing and only about the other attributed party; an unrelated conversation does not create rating eligibility.

   e. Transaction-coordination data. Offer prices, notes, counterparties, status and expiry; meetup proposals, place, time, notes, counterparties and status. When a listing owner confirms a sale, we also keep a private attribution record linking the listing to the exact accepted offer, its conversation, the two transaction parties, agreed price, acceptance time, and confirmation time. We use that record to close the listing and authorize one rating in each direction between the actual parties. Conversation records remain visible only to their participants and authorized operators; sale attribution is returned only through account-checked functions to the attributed parties or listing owner as needed, and is never added to the public listing row.

   f. Safety and preference data. Blocks, notification records, email-notification opt-out settings and unsubscribe capability, report/enforcement records, and related timestamps. Blocks and notification preferences are private to the account and authorized operators.

   g. Network, device, and abuse-prevention data. Our hosting and API infrastructure processes IP addresses and request metadata. Application rate-limit records use pseudonymized hash or HMAC bucket keys rather than raw IP addresses. When available, we record a user-agent snippet and an installation-scoped fingerprint: a SHA-256 hash created on your device from a random local salt and coarse browser/device characteristics. It is an advisory signal, not proof that accounts belong to one person and not a basis for automatic linked-account punishment. We also process action timing/frequency and a trust score to prioritize moderation review. These signals are used to prevent spam, fraud, ban evasion, and harassment.

   h. Optional approximate location. Only after you choose "Use current location" and grant permission, the app rounds the device fix to three decimal places (an approximately 100-meter grid) before it leaves your device for our Vercel edge route and an OpenStreetMap Nominatim-compatible service. The provider is asked for a street/campus-area label, not a building-level result. The marketplace database stores the location text you choose for the listing, not the coordinate. We never request location silently.

3. How We Use It.
   · Operate the marketplace, authenticate your account, deliver messages, and show you relevant listings.
   · Enforce the Terms of Service and Community Guidelines, including detecting spam, fraud, ban evasion, and harassment.
   · Troubleshoot problems and improve the service.
   · Notify you of material changes to these terms.

4. How We Share It.

   a. Publicly and with other users. Public visitors and other users can see your nickname, avatar, bio, selected area/location, public account identifiers (including the API UUID), Illinois-verification badge, status text/emoji, join date, rating summary, active listings, and sold/non-deleted listing records or counts. Ratings and review text you submit are public and identify the rater, ratee, and related listing, so submitting one can reveal that transaction relationship. Marking a listing sold does not publicly reveal its selected offer, buyer/request fulfiller, conversation, or private sale-attribution record. Your email address, phone number, device fingerprint, IP address, and trust score are NEVER shown to other users.

   b. With service providers. Depending on the features enabled and used, we use: Supabase (authentication, database, storage, realtime); Vercel (hosting and edge functions); Resend (transactional and notification email addresses/content); Sentry (sanitized error and performance diagnostics, with default PII and request bodies disabled); OpenAI (optional content moderation and translation of user-submitted text); OpenStreetMap/Nominatim-compatible geocoding (only for a user-requested address lookup); and WeChat (mini-program login and optional safety classification). For an enabled WeChat safety check, the server sends the full submitted text and the account-bound openid, or the public submitted-media URL and that openid, to WeChat. Media checks keep an asynchronous trace mapping (trace ID, account ID, bucket and storage path) until the callback or maintenance cleanup; a risky verdict can automatically delete the uploaded media. The server resolves the openid from the current authenticated account's trusted binding or a fresh one-time login code; the client does not persist or submit it. These providers process data under their own terms. OpenAI does not use API inputs/outputs to train its models by default, but its default abuse-monitoring logs may contain content and be retained for up to 30 days unless approved data-retention controls apply.

   c. With law enforcement. Only in response to valid legal process (subpoena, court order) or to prevent imminent harm.

   d. We do NOT sell your personal information. We do NOT serve third-party advertising. We do NOT use third-party analytics or tracking pixels.

5. Storage and Security.
Application data is stored with Supabase. We rely on row-level security (RLS) policies so users can only access private data authorized for their account. Email-account passwords are submitted directly to Supabase and stored there as hashes. The current WeChat flow uses one-time token hashes rather than reusable passwords; an upgraded password-era deployment must complete the documented legacy-credential retirement before launch. Production transport is HTTPS-only.

6. Retention.
   · Active accounts: data retained while the account exists.
   · Deleted accounts: profile-linked fingerprints and most account/content data are removed through the account-deletion process. A service-role-only deletion tombstone containing the former account UUID and completion timestamps is retained indefinitely to prevent still-unexpired access tokens from writing new files. It contains no email, nickname, password, or WeChat identifier after completion. Moderation/report snapshots are a separate record and may retain identifiers or reported content as described below.
   · Shared conversations: under the current deletion design, deleting either participant's account permanently deletes that entire conversation and its messages for both participants. A report snapshot captured before deletion may remain as moderation evidence.
   · Sale attribution and ratings: deleting the listing owner's account deletes the owned listing and its private sale-attribution record. If only the counterparty deletes their account, foreign-key deletion clears the participant, offer, and conversation links from the private attribution record so the deleted identity is no longer available for rating eligibility; the sold listing and non-identifying agreed price/acceptance/confirmation timestamps may remain with the listing. Ratings linked to a deleted profile are deleted through profile foreign keys and the remaining rating summary is recomputed.
   · Moderation and enforcement records: report snapshots, suspension/appeal records, and administrator audit entries are retained while reasonably necessary to investigate abuse, resolve appeals, prevent repeat fraud, or comply with law. A report snapshot can retain text/metadata and the public URL of reported media; it is not a separate binary media copy, so account or Storage deletion can make that URL unavailable. The service does not currently enforce a single automated 24-month deletion rule across all of these records; we will publish a new policy version before introducing a fixed schedule.

7. Your Rights.
   · View and edit your profile from the Profile page.
   · Delete your account from Settings → Delete Account. This is permanent.
   · Request a copy of your data by emailing help@illinimarket.com.
   · Block other users from the Profile or Chat screens.
   · Report content or users from any listing, post, comment, or chat.
California (CCPA) and EEA (GDPR) residents may have additional rights; contact us to exercise them.

8. Children.
The service is not intended for anyone under 18. If we learn we have collected data from someone under 18, we will delete it.

9. Cookies and Local Storage.
We use first-party app/browser storage for the Supabase session; language, theme, and recent-emoji preferences; recent searches; optional drafts; up to 30 recently viewed listings and 30 recently viewed Plaza posts; and the random per-install salt used by the advisory fingerprint. To avoid repeated paid requests, the device may also keep up to 500 source/translated-text cache entries for up to 30 days. Settings → Clear Cache removes search, browsing, emoji, and translation caches. Sign-out blocks and purges the local auth generation before attempting remote token revocation and removes account-content caches and drafts; language/theme and the installation salt remain on the device. We do NOT use third-party advertising cookies.

10. International Users.
Data may be processed in the United States and other jurisdictions where our configured service providers operate. If you access the service from another country, your data may be transferred across borders under the providers' applicable terms and safeguards.

11. Automated Decisions.
We use automated systems to rate the risk of spam, fraud, or abuse (the "trust score") and to pre-screen content (keyword filters and AI moderation). These systems can block specific content and help prioritize human moderation; the trust score is not currently an automatic feed-ranking or account-punishment decision. You may request human review of an enforcement action as described in Terms §11.

12. Changes.
Material changes to this policy will be announced in-app and may require renewed consent. Minor clarifications may be made without separate notice. The "Version" header above always reflects the current version.

13. Contact.
Questions, access requests, or complaints: help@illinimarket.com
`
