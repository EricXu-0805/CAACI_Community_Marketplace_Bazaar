-- ============================================
-- 007 Trigram search index for fuzzy title/description match
-- ============================================
-- pg_trgm accelerates ILIKE '%foo%' queries and enables similarity-based
-- fuzzy matching (typo tolerance). Existing GIN tsvector index stays for
-- exact word matches; trigram supplements it for partial/fuzzy matches.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_items_title_trgm
  ON public.items USING GIN (title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_items_description_trgm
  ON public.items USING GIN (description gin_trgm_ops);

-- RPC for future fuzzy search with typo tolerance.
-- Caller passes a query string; returns items ranked by trigram similarity.
-- Frontend can swap to this when exact ILIKE returns too few results.

CREATE OR REPLACE FUNCTION public.search_items_fuzzy(q TEXT, max_results INT DEFAULT 20)
RETURNS SETOF public.items
LANGUAGE sql
STABLE
AS $$
  SELECT i.*
  FROM public.items i
  WHERE i.status = 'active'
    AND (i.title % q OR i.description % q OR i.title ILIKE '%' || q || '%')
  ORDER BY GREATEST(similarity(i.title, q), similarity(i.description, q) * 0.6) DESC
  LIMIT max_results
$$;

GRANT EXECUTE ON FUNCTION public.search_items_fuzzy(TEXT, INT) TO anon, authenticated;
