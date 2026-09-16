# Supabase Email Templates

Custom branded email templates for Illini Market. Bilingual (English first, with Chinese), warm
terracotta brand, code-based (not magic links).

## How to apply

1. Open Supabase Dashboard → Authentication → Email Templates
2. For each template:
   - `Confirm signup` → paste contents of `confirm-signup.html`
   - `Reset password` → paste contents of `reset-password.html`
   - Signup subject: `Illini Market · Verify your email / 确认邮箱`
   - Recovery subject: `Illini Market · Reset your password / 重置密码`
   The subject is a separate dashboard setting; changing the HTML `<title>`
   does not change the subject shown in the inbox.
3. **Both templates use `{{ .Token }}` (the 6-digit code), NOT
   `{{ .ConfirmationURL }}`.** The app's reset-password page and signup-confirm
   panel ask the user to type the code (`verifyOtp`), so the email must carry the
   code, not a link. A magic link here would break both flows (the email would
   show a link while the UI asks for a code) — and mail scanners pre-fetch
   single-use links, which is what made the old link flow show "expired" on an
   instant click.
4. Set **Authentication → Providers → Email → Email OTP length = 6**.

## Transport (Resend via custom SMTP)

These templates are owned by Supabase; Resend is only the SMTP transport so the
From address is `illinimarket.com`, not CAACI. Configure under
**Authentication → Settings → SMTP**:

- Host: `smtp.resend.com`
- Port: `465`
- Username: `resend`
- Password: a Resend API key
- Sender: `Illini Market <noreply@send.illinimarket.com>` (on the Resend-verified
  `send.illinimarket.com` domain)

## Preview

Open the `.html` files directly in a browser. `{{ .Token }}` renders literally
in the preview; Supabase substitutes the real 6-digit code at send time.

After applying, send a real signup confirmation to a Gmail `+` alias owned by
the tester. Check the received subject, sender/domain, current `Illini 集市`
branding, website wording, six-digit code and its verification. Check recovery
mail separately. Gmail aliases share the existing inbox; this does not create
a new Google identity or validate Google's own OAuth notification email.
