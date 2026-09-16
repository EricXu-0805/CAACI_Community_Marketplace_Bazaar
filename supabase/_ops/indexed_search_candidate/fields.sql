-- Local experimental extension to the cached-search candidate; not production DDL.
CREATE TABLE search_private.knn_fields AS
SELECT item_id,ordinality AS slot,(f).value,(f).folded,(f).present_v1,(f).title_v1,(f).title_v2,cardinality((f).tokens) AS token_count,(f).tokens
FROM search_private.item_fields CROSS JOIN LATERAL unnest(fields) WITH ORDINALITY AS f;
ALTER TABLE search_private.knn_fields ADD PRIMARY KEY(item_id,slot);
ALTER TABLE search_private.knn_fields ADD FOREIGN KEY(item_id) REFERENCES search_private.item_fields(item_id) ON DELETE CASCADE;
ALTER TABLE search_private.knn_fields ENABLE ROW LEVEL SECURITY;
CREATE POLICY visible_listing ON search_private.knn_fields FOR SELECT TO anon,authenticated USING(item_id IN(SELECT id FROM public.items));
REVOKE ALL ON search_private.knn_fields FROM PUBLIC,anon,authenticated;
GRANT SELECT ON search_private.knn_fields TO anon,authenticated,service_role;
CREATE INDEX knn_title ON search_private.knn_fields USING gist(value extensions.gist_trgm_ops(siglen=128)) WHERE title_v2;
CREATE FUNCTION search_private.sync_knn_fields() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 DELETE FROM search_private.knn_fields WHERE item_id=NEW.item_id;
 INSERT INTO search_private.knn_fields(item_id,slot,value,folded,present_v1,title_v1,title_v2,token_count,tokens)
 SELECT NEW.item_id,ordinality,(f).value,(f).folded,(f).present_v1,(f).title_v1,(f).title_v2,cardinality((f).tokens),(f).tokens
 FROM unnest(NEW.fields) WITH ORDINALITY AS f;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION search_private.sync_knn_fields() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER sync_knn_fields AFTER INSERT OR UPDATE OF fields ON search_private.item_fields
FOR EACH ROW EXECUTE FUNCTION search_private.sync_knn_fields();
CREATE INDEX knn_desc_token_count ON search_private.knn_fields(token_count) WHERE NOT title_v2;
CREATE INDEX knn_desc_exact ON search_private.knn_fields(folded,item_id)
WHERE NOT title_v2 AND token_count<=64 AND octet_length(folded)<=512;
ANALYZE search_private.knn_fields;
