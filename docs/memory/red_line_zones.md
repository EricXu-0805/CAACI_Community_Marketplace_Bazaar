---
name: Red-line zones — Eric-only ops, never Claude
description: Eric-only territory: migrations, Storage batch mutations, Auth Dashboard, third-party prod calls (Resend/OpenAI/Cloudflare), PKCE, CSP, sibling auth fn symmetry, vite chunk override, page-token shim; Supabase CLI db push/pull FORBIDDEN, always Dashboard SQL Editor
type: feedback
---

Red-line zones (Eric runs manually, Claude/Claude Code never touches): DB migrations, Storage batch mutations, Auth Dashboard config, third-party prod data calls (Resend / OpenAI / Cloudflare), PKCE flow, CSP directives, sibling auth function symmetry, vite chunk override, page-token shim. Supabase CLI db push/db pull is FORBIDDEN — always use Dashboard SQL Editor.
