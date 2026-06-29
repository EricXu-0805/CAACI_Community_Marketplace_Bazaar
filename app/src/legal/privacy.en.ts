export const PRIVACY_VERSION = '2026-04-20'

export const PRIVACY_EN = `Privacy Policy

Effective date: April 20, 2026
Version: ${PRIVACY_VERSION}

1. Scope.
This Privacy Policy explains what information Illini Market collects, how we use it, who we share it with, and what choices you have. By using the service you agree to this policy.

2. Information We Collect.

   a. Account data. Email address (required), nickname, avatar, short bio, and the campus/area you select.

   b. Listing and community data. Titles, descriptions, photos, prices, categories, and approximate pickup locations you enter. Plaza posts, comments, and messages. Items you favorite or save.

   c. Communication data. Messages between you and other users, including message timestamps and read receipts. Reports you submit about other users or content.

   d. Device and abuse-prevention data. IP address, user-agent string, approximate geolocation derived from IP, a durable device fingerprint (a hashed signal derived from your browser/device characteristics), the timing and frequency of your actions, and a computed trust score used to prioritize moderation review. This data exists for one reason: to prevent spam, fraud, ban evasion, and harassment.

   e. Optional data. If you grant location permission, precise geolocation for map features. We never collect precise location silently.

3. How We Use It.
   · Operate the marketplace, authenticate your account, deliver messages, and show you relevant listings.
   · Enforce the Terms of Service and Community Guidelines, including detecting spam, fraud, ban evasion, and harassment.
   · Troubleshoot problems and improve the service.
   · Notify you of material changes to these terms.

4. How We Share It.

   a. With other users. Your nickname, avatar, bio, and active listings are visible to other users. Your email address, phone number, device fingerprint, IP address, and trust score are NEVER shown to other users.

   b. With service providers. We use Supabase (authentication, database, storage, realtime), Vercel (hosting, edge functions), and OpenAI's Moderations API (content safety checks). These providers process data on our behalf under their own terms. We do not use OpenAI submissions for model training; moderation requests are not retained for that purpose.

   c. With law enforcement. Only in response to valid legal process (subpoena, court order) or to prevent imminent harm.

   d. We do NOT sell your personal information. We do NOT serve third-party advertising. We do NOT use third-party analytics or tracking pixels.

5. Storage and Security.
Data is stored on Supabase infrastructure (AWS us-east-1). We rely on row-level security (RLS) policies so users can only access their own private data. Passwords are hashed on Supabase; we never see them in plaintext. Transport is HTTPS-only.

6. Retention.
   · Active accounts: data retained while the account exists.
   · Deleted accounts: personal data removed within 30 days. Anonymized abuse signals (e.g., a device fingerprint tied to a banned user) may be retained up to 24 months to prevent ban evasion.
   · Messages are retained while either participant's account is active.
   · Moderation evidence (screenshots of flagged content, report history) may be retained up to 24 months.

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
We use session cookies to keep you signed in and local storage for your language preference and recent searches. We do NOT use third-party advertising cookies.

10. International Users.
Data is processed in the United States. If you access the service from outside the US, you consent to processing in the US.

11. Automated Decisions.
We use automated systems to rate the risk of spam, fraud, or abuse (the "trust score") and to pre-screen content (keyword filters and AI moderation). These systems can reduce your feed visibility, delay your posts for review, or block specific content. A human review is available for any enforcement decision upon appeal (see Terms §11).

12. Changes.
Material changes to this policy will be announced in-app and may require renewed consent. Minor clarifications may be made without separate notice. The "Version" header above always reflects the current version.

13. Contact.
Questions, access requests, or complaints: help@illinimarket.com
`
