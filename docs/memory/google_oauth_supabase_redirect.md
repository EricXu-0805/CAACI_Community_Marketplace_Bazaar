---
name: Google OAuth — "continue to supabase.co" page is correct, not a bug
description: Google sign-in shows "to continue to lfhvgprfphyfvhidegum.supabase.co" because Supabase hosts OAuth client; only fix is Supabase Custom Domain feature (red-line, post-launch)
type: project
originSessionId: 9852fdfb-dfb7-46b2-9864-95942d5727dd
---
Google OAuth UX clarification: Google sign-in page shows "to continue to lfhvgprfphyfvhidegum.supabase.co" — correct, not a bug. Supabase hosts OAuth client; Google can only redirect to supabase.co/auth/v1/callback, which bounces to app. After caaciorg.com binding, the final hop changes but Google's "continue to supabase.co" page stays. Customizing it requires Supabase Custom Domain feature (red-line, post-launch).
