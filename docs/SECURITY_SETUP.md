# Security setup — activation checklist

Two things ship in this PR that need manual activation in Supabase / Vercel.
Skip either and the app still works (safe fallback), but the second-tier
moderation won't actually fire.

---

## 1. Run the four new Supabase migrations

Paste each into **Supabase Dashboard → SQL Editor**, in order:

1. `supabase/migrations/023_banners.sql` — creates `banners` table + `banners_live` view, seeds two rows.
2. `supabase/migrations/024_content_moderation.sql` — creates `moderation_keywords` table + BEFORE INSERT triggers on `posts`, `post_comments`, `items`, `messages`. Seeds ~40 baseline terms.
3. `supabase/migrations/025_content_moderation_lexicon.sql` — bulk inserts ~2,382 terms sourced from `konsheng/Sensitive-lexicon` (MIT). Political buckets filtered out.
4. `supabase/migrations/026_profile_consent.sql` — adds `tos_version`, `consented_at`, `onboarded_at`, `campus_area` columns on `profiles`; exposes `record_consent()` and `mark_onboarded()` RPCs used by the onboarding wizard and the re-consent screen.

**Verify:**
```sql
SELECT count(*) FROM public.moderation_keywords WHERE active = true;
-- expect ~2400
SELECT count(*) FROM public.banners_live;
-- expect >= 2
SELECT column_name FROM information_schema.columns
 WHERE table_schema='public' AND table_name='profiles'
   AND column_name IN ('tos_version','onboarded_at','campus_area');
-- expect 3 rows
```

**Rollback if needed:**
```sql
DROP TRIGGER moderate_posts ON public.posts;
DROP TRIGGER moderate_post_comments ON public.post_comments;
DROP TRIGGER moderate_items ON public.items;
DROP TRIGGER moderate_messages ON public.messages;
```

---

## 2. Add OpenAI API key to Vercel (optional but recommended)

The `/api/moderate` endpoint proxies text through OpenAI's
`omni-moderation-latest` model to catch harassment / self-harm / sexual
content the keyword list can't catch. **It's free** (no per-call cost),
but needs an API key.

### Get a key

1. Go to <https://platform.openai.com/api-keys>
2. "Create new secret key"
3. Name it `caaci-moderation`, scope = "restricted", permission = "Moderation"
   only (not full access — safer)
4. Copy the `sk-...` string

### Add to Vercel

1. <https://vercel.com/ericxu-0805s-projects/caaci-community-marketplace-bazaar/settings/environment-variables>
2. "Add new"
3. Name: `OPENAI_API_KEY`
4. Value: paste the `sk-...`
5. Environment: tick **Production** AND **Preview**
6. Save

### Redeploy

```bash
git commit --allow-empty -m "chore: trigger redeploy to pick up OPENAI_API_KEY" && git push
```

Or Vercel Dashboard → Deployments → "..." on latest → "Redeploy".

### Verify it's live

```bash
curl -X POST https://caaci-community-marketplace-bazaar.vercel.app/api/moderate \
  -H 'Content-Type: application/json' \
  -d '{"text":"hello world"}'
# expect: {"flagged":false,"categories":[]}

curl -X POST https://caaci-community-marketplace-bazaar.vercel.app/api/moderate \
  -H 'Content-Type: application/json' \
  -d '{"text":"i want to kill myself"}'
# expect: {"flagged":true,"categories":["self-harm", ...]}
```

If you get `{"skipped":true,"reason":"no_key"}` the env var didn't
propagate — redeploy and re-check.

---

## 3. Moderation layers — what does what

When a user hits "Publish" on a post / item / comment / message:

| Layer | Where | What it catches | Fails open? |
|---|---|---|---|
| 1. Length | client | empty / too long | no — hard block |
| 2. Contact regex | client | phone, WeChat, QQ, email | no — hard block |
| 3. Sensitive-word (local) | client | ~40 baseline terms, homoglyph-folded | no — hard block |
| 4. Local duplicate | client memory | same text within 30 s | no — hard block |
| 5. OpenAI moderation | Vercel edge | harassment / self-harm / sexual / violence / hate | **yes** (3 s timeout → allow) |
| 6. Keyword trigger | Supabase | ~2,400 lexicon terms + contact regex | no — hard block |

Layers 1–4 run in the browser (fast, removes obvious garbage without
spending quota). Layer 5 runs on Vercel edge. Layer 6 is the final
trust boundary; **even if someone bypasses the app and hits Supabase
directly via a leaked anon key, they still trip this trigger.**

---

## 4. Adding / removing keywords later

```sql
-- Add a term (case-insensitive; stored as-given)
INSERT INTO public.moderation_keywords (keyword, category, severity)
VALUES ('specific-scam-phrase', 'scam', 3);

-- Deactivate without losing history
UPDATE public.moderation_keywords
SET active = false
WHERE keyword = 'word-that-false-positives';

-- List recent adds
SELECT keyword, category, severity, created_at
FROM public.moderation_keywords
ORDER BY created_at DESC
LIMIT 50;
```

No code deploy needed — triggers re-read the table on every write.
