-- ============================================
-- 20260901071645 — Seed English profanity into moderation_keywords
-- ============================================
-- The lexicon seeded in 024/025 is overwhelmingly Chinese. Measured against
-- production's own content_moderation_check on 2026-08-31: 傻逼 / 操你妈 /
-- "fuck you" / "kill yourself" are all blocked, while a listing or a chat
-- message consisting of "shit" or "bitch" passes untouched. Eric's call
-- (2026-09-01) is to close that gap before the beta.
--
-- HOW THE MATCHER TREATS A KEYWORD (content_moderation_check, 024 + 049 + 089)
-- --------------------------------------------------------------------------
-- Keywords of 1-4 ASCII alphanumerics are matched with \y word boundaries on
-- the NFKC-folded text. Everything longer is a plain substring match against
-- content_moderation_normalize(), which has already stripped separators and
-- whitespace. That second branch is why this list is shorter than it looks:
-- a long keyword collides with any phrase whose letters happen to close up
-- around it once the spaces come out.
--
-- Every candidate below was run through the real production function's own
-- matching rules against a 35-item corpus of plausible campus-marketplace
-- text. Seeded only if it flagged none of them.
--
-- DELIBERATELY NOT SEEDED — each one flagged a listing somebody could really
-- post, with the collision that did it:
--   · bitch    -> "Rabbit chow, 5 lb bag"        (rabbitchow ⊃ bitch)
--   · retard   -> "flame retardant" dorm bedding (flameretardant ⊃ retard)
--   · dick     -> "Dick's Sporting Goods gift card"
--   · pussy    -> "Pussy willow stems, dried"
--   · hoe      -> "Garden hoe and rake"
--   · bastard  -> "Bastard file, 10 inch" (the metalworking tool)
--   · cock     -> "Cock-a-doodle alarm clock"
--   · damn     -> "Damn Good Ramen cookbook", and it is mild besides
-- None of these can be fixed by wording the keyword differently: spaces and
-- underscores are stripped from the keyword before comparison, so there is no
-- way to ask for a word boundary on a keyword longer than four characters.
-- Closing them needs a change to the matcher, not to this table.
--
-- severity 3 matches the currency phrases seeded in 071; the triggers on
-- items / posts / comments / messages (024 + 049) block on any match at all,
-- so severity is descriptive rather than load-bearing.
--
-- Idempotent by NOT EXISTS: moderation_keywords has no unique index on
-- keyword, so ON CONFLICT DO NOTHING would not stop a re-run duplicating.

INSERT INTO public.moderation_keywords (keyword, category, severity)
SELECT candidate, 'profanity', 3
FROM (VALUES
  -- 1-4 chars: matched on word boundaries, so "Scunthorpe" and "cocktail"
  -- stay safe without any special casing.
  ('shit'), ('fuck'), ('cunt'), ('slut'), ('twat'), ('fag'),
  -- 5+ chars: substring matched. Each cleared the corpus above.
  ('fucking'), ('faggot'), ('asshole'), ('whore'), ('nigger'),
  ('motherfucker'), ('bullshit'), ('dumbass'), ('jackass'), ('douchebag')
) AS seed(candidate)
WHERE NOT EXISTS (
  SELECT 1 FROM public.moderation_keywords existing
  WHERE LOWER(existing.keyword) = seed.candidate
);

NOTIFY pgrst, 'reload schema';
