# Security specs — currency-exchange enforcement + Storage MIME validation

> Drafts only — these two audit findings are bigger than a one-shot migration
> and carry product/architecture decisions, so they are spec'd here for Eric to
> decide rather than applied. The two quick security fixes (rate-limit window
> buffer, bio PII screening) shipped as migrations **042** and **043**.

---

## 1. Currency-exchange: DB-level enforcement

**Finding** (SECURITY_AUDIT.md:769-788, CRITICAL_FIXES.md:326-387): the anti-scam
warnings on `currency_exchange` listings are UX-only. There is no system limit,
no escrow, no structured dispute path — a scammer can post unlimited exchange
listings.

This splits into two pieces with very different cost/risk:

### 1a. Rate cap (cheap, low-risk) — needs a policy number from Eric

A per-user daily cap on `currency_exchange` listings limits scam volume. This is
a small `BEFORE INSERT` trigger on `items`, in the same shape as the existing
`rl_items_before_insert`. **Open question: what's the cap?** `1/day` is the
audit's suggestion but may frustrate a legit user posting "selling USD" and
"buying RMB" the same day. Suggest **3/day** as a balance. Once Eric picks a
number, this becomes migration `044`:

```sql
CREATE OR REPLACE FUNCTION public.rl_currency_exchange_before_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE last_day INT;
BEGIN
  IF NEW.category <> 'currency_exchange' THEN RETURN NEW; END IF;
  SELECT COUNT(*) INTO last_day FROM public.items
    WHERE user_id = NEW.user_id AND category = 'currency_exchange'
      AND created_at > NOW() - INTERVAL '24 hours 1 second';
  IF last_day >= 3 THEN            -- <-- Eric's policy number
    RAISE EXCEPTION 'rate_limit_currency_day'
      USING HINT = 'Daily currency-exchange listing limit reached.';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_rl_currency_exchange ON public.items;
CREATE TRIGGER trg_rl_currency_exchange
  BEFORE INSERT ON public.items
  FOR EACH ROW EXECUTE FUNCTION public.rl_currency_exchange_before_insert();
```
Add a `rate_limit_currency_day` entry to `RATE_LIMIT_MESSAGES` in
`app/src/utils/index.ts` so the toast localizes.

### 1b. Escrow / transactions table (large — a product feature, not a patch)

CRITICAL_FIXES.md proposes a `transactions` table with escrow states
(pending/confirmed/disputed/completed), 2FA, and dispute resolution. This is a
multi-day **product feature**, not a security patch — it implies a payments/holds
model the app doesn't have yet, and 2FA depends on Supabase Auth capabilities.
**Recommendation:** do NOT build escrow now. Ship 1a as the immediate guard,
and treat escrow as a roadmap item to scope with Eric (it changes the product,
not just the schema). The existing four-surface scam warnings + 1a cap are a
reasonable beta posture.

---

## 2. Storage MIME validation (server-side)

**Finding** (SECURITY_AUDIT.md:304-335, CRITICAL_FIXES.md:170-226): upload MIME
type is validated **client-side only** (`detectImageMimeType` in
`app/src/utils/index.ts:1274`). A direct REST/SDK call can upload a non-image
with a spoofed `content-type`; the storage RLS policy (mig 011) only checks the
path, not the bytes.

A SQL trigger on `storage.objects` can't see the file bytes (only metadata), so
it can't do a full magic-byte allowlist — but it CAN reject by *declared*
content-type, which is enough to block the script/markup types. Two options:

- **Option A — pre-upload Edge Function (recommended).** Add
  `supabase/functions/validate-upload/` that receives the file, checks magic
  bytes server-side, and returns a short-lived signed upload URL only on pass.
  Client calls it instead of uploading directly. This is the robust fix but
  requires standing up the first Edge Function in this repo (there's no
  `supabase/functions/` dir yet) + a deploy step.
- **Option B — metadata trigger (SHIPPED as mig 045).** A `BEFORE INSERT`
  trigger on `storage.objects` that rejects script/markup content-types
  (`image/svg+xml`, `text/html`, `*xml`, javascript) in the item-images bucket.
  Fail-open denylist → never blocks a real image upload.

**Threat re-scope (why Option B is sufficient here, not "partial"):** every image
surface in this app renders via `<image>`/`<img>` `src`. SVG/HTML bytes loaded as
an `<img>` source do NOT execute script (script only runs for an inline `<svg>`
or a top-level document). So the one realistic stored-XSS vector is an object
*served with an active content-type*, which mig 045 blocks. A `content-type`-
spoofed non-image (`.exe` labeled `image/jpeg`) is served as an image and is inert
in an `<img>`; its only residual harm is storage abuse (own folder, auth'd, 5 MB
cap) — low for a campus beta.

**Decision:** Option B shipped (mig 045). **Option A** (full magic-byte validation
via an upload-proxy Edge Function) stays an OPTIONAL future hardening — it needs
the first Edge Function in this repo + a rewrite of the historically finicky
upload flow + deploy/testing, so it should be its own tested task, not a blind
batch change.

---

## Also flagged (not in this sweep)

- **`.env.local` anon key** — rotate via Supabase Dashboard → Settings → API
  (anon key, read-only, lower severity than service_role, but flagged
  "potentially compromised" since the 2026-05-05 handoff). Dashboard action.
- **caaciorg.com domain move blockers** — hardcoded `vercel.app` in
  `supabase/migrations/023_banners.sql` and the API CORS allowlists. Revisit
  when the custom domain is configured.
