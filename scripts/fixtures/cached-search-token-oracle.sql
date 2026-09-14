CREATE TEMP TABLE token_corpus(value text PRIMARY KEY,tokens integer[]);
INSERT INTO token_corpus
SELECT DISTINCT value,search_private.token_ids(value) FROM (
 SELECT unnest(ARRAY['','a','ab','abc','abcdef','ABC','0xa','desk','camra','camera','tree','free','ten','twelve','desk desk','Desk desk','书桌','校园图书馆','é','café','é','İ','i','I','ı','ß','SS','Σ','σ','ς','K','K','中文ABC123','😀','猫😺狗','العربية','日本語','%','_','100%','\\','a\\%','éclair','㍑','東京2026']) value
 UNION ALL SELECT md5(n::text)||' 中文َ İ \n  café '||n FROM generate_series(1,70) n
) corpus;
DO $$
DECLARE mismatches integer; threshold text;
BEGIN
 SELECT count(*) INTO mismatches FROM token_corpus a CROSS JOIN token_corpus b
 CROSS JOIN LATERAL(SELECT cardinality(a.tokens OPERATOR(search_private.&) b.tokens) n) shared
 WHERE float4send(extensions.similarity(a.value,b.value)) IS DISTINCT FROM float4send(
  CASE WHEN shared.n=0 THEN 0::real ELSE shared.n::real/(cardinality(a.tokens)+cardinality(b.tokens)-shared.n)::real END);
 IF mismatches<>0 THEN RAISE EXCEPTION 'cached_similarity_mismatches:%',mismatches; END IF;
 FOREACH threshold IN ARRAY ARRAY['0','1e-20','0.3','0.30000001','0.30000002','0.33333333','0.33333334326744080','0.49999999','0.50000001','0.99999999','1'] LOOP
  PERFORM set_config('pg_trgm.similarity_threshold',threshold,true);
  SELECT count(*) INTO mismatches FROM token_corpus a CROSS JOIN token_corpus b
  CROSS JOIN LATERAL (SELECT search_private.item_rank(
    ARRAY[ROW(a.value,lower(a.value),a.tokens,true,true,true)::search_private.cached_field],
    ARRAY[ROW(b.value,'%'||lower(b.value)||'%',b.tokens)::search_private.term_input],
    ARRAY['%'||lower(b.value)||'%'],extensions.show_limit(),false,
    ('' OPERATOR(extensions.%) b.value OR '' ILIKE '%'||b.value||'%'),
    '' ILIKE '%'||b.value||'%',cardinality(b.tokens),cardinality(b.tokens)) rank) score
  WHERE (score.rank IS NOT NULL) IS DISTINCT FROM (a.value OPERATOR(extensions.%) b.value OR a.value ILIKE '%'||b.value||'%');
  IF mismatches<>0 THEN RAISE EXCEPTION 'cached_threshold_mismatches:%:%',threshold,mismatches; END IF;
 END LOOP;
END $$;
DROP TABLE token_corpus;
