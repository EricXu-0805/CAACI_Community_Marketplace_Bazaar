# Supabase Email Templates

Custom branded email templates for Illini Market. Bilingual (中英), warm
terracotta brand, code-based (not magic links).

## How to apply

1. Open Supabase Dashboard → Authentication → Email Templates
2. For each template:
   - `Confirm signup` → paste contents of `confirm-signup.html`
   - `Reset password` → paste contents of `reset-password.html`
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
