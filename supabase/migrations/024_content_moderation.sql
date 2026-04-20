-- Layer-2 moderation: a keyword table + BEFORE INSERT triggers on every
-- user-writable text surface. The client-side check in app/src is
-- advisory; this table is the trust boundary.

CREATE TABLE IF NOT EXISTS public.moderation_keywords (
  id         bigserial PRIMARY KEY,
  keyword    text NOT NULL,
  category   text NOT NULL DEFAULT 'generic',
  severity   smallint NOT NULL DEFAULT 2
    CHECK (severity BETWEEN 1 AND 3),
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS moderation_keywords_kw_uniq
  ON public.moderation_keywords (LOWER(keyword));

ALTER TABLE public.moderation_keywords ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mk_service_only ON public.moderation_keywords;

CREATE OR REPLACE FUNCTION public.content_moderation_normalize(raw text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT LOWER(
    regexp_replace(
      regexp_replace(COALESCE(raw, ''), E'[\\s\\-\\._,。，、]+', '', 'g'),
      E'[\\u200B-\\u200F\\uFEFF]', '', 'g'
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.content_moderation_check(raw text)
RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE
  norm text;
  kw   record;
BEGIN
  IF raw IS NULL OR length(raw) = 0 THEN
    RETURN NULL;
  END IF;

  norm := public.content_moderation_normalize(raw);

  IF norm ~ '(?<![0-9])1[3-9][0-9]{9}(?![0-9])' THEN
    RETURN 'contact_info';
  END IF;
  IF raw ~* '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}' THEN
    RETURN 'contact_info';
  END IF;
  IF norm ~ '(微信|wechat|weixin|加v|加微|v信|vx|v我)' THEN
    RETURN 'contact_info';
  END IF;

  FOR kw IN
    SELECT LOWER(keyword) AS k
    FROM public.moderation_keywords
    WHERE active = true
  LOOP
    IF norm LIKE '%' || replace(replace(kw.k, '_', ''), ' ', '') || '%' THEN
      RETURN 'sensitive_word';
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_moderate_posts()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE result text;
BEGIN
  result := public.content_moderation_check(NEW.content);
  IF result IS NOT NULL THEN
    RAISE EXCEPTION 'moderation_block:%', result;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS moderate_posts ON public.posts;
CREATE TRIGGER moderate_posts
  BEFORE INSERT OR UPDATE OF content ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.trg_moderate_posts();

CREATE OR REPLACE FUNCTION public.trg_moderate_post_comments()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE result text;
BEGIN
  result := public.content_moderation_check(NEW.content);
  IF result IS NOT NULL THEN
    RAISE EXCEPTION 'moderation_block:%', result;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS moderate_post_comments ON public.post_comments;
CREATE TRIGGER moderate_post_comments
  BEFORE INSERT OR UPDATE OF content ON public.post_comments
  FOR EACH ROW EXECUTE FUNCTION public.trg_moderate_post_comments();

CREATE OR REPLACE FUNCTION public.trg_moderate_items()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE result text;
BEGIN
  result := public.content_moderation_check(NEW.title);
  IF result IS NOT NULL THEN
    RAISE EXCEPTION 'moderation_block:%', result;
  END IF;
  result := public.content_moderation_check(NEW.description);
  IF result IS NOT NULL THEN
    RAISE EXCEPTION 'moderation_block:%', result;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS moderate_items ON public.items;
CREATE TRIGGER moderate_items
  BEFORE INSERT OR UPDATE OF title, description ON public.items
  FOR EACH ROW EXECUTE FUNCTION public.trg_moderate_items();

CREATE OR REPLACE FUNCTION public.trg_moderate_messages()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE result text;
BEGIN
  IF NEW.message_type = 'image' THEN
    RETURN NEW;
  END IF;
  result := public.content_moderation_check(NEW.content);
  IF result IS NOT NULL THEN
    RAISE EXCEPTION 'moderation_block:%', result;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS moderate_messages ON public.messages;
CREATE TRIGGER moderate_messages
  BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.trg_moderate_messages();

INSERT INTO public.moderation_keywords (keyword, category, severity) VALUES
  ('代写', 'academic', 3),
  ('代考', 'academic', 3),
  ('代课', 'academic', 2),
  ('代发', 'spam', 2),
  ('刷单', 'spam', 3),
  ('刷赞', 'spam', 2),
  ('刷粉', 'spam', 2),
  ('招嫖', 'adult', 3),
  ('援交', 'adult', 3),
  ('约炮', 'adult', 3),
  ('一夜情', 'adult', 2),
  ('赌博', 'gambling', 3),
  ('博彩', 'gambling', 3),
  ('菠菜', 'gambling', 2),
  ('办证', 'fraud', 3),
  ('假证', 'fraud', 3),
  ('假币', 'fraud', 3),
  ('贷款', 'financial', 2),
  ('套现', 'financial', 3),
  ('黑户', 'financial', 2),
  ('大麻', 'drugs', 3),
  ('冰毒', 'drugs', 3),
  ('摇头丸', 'drugs', 3),
  ('枪支', 'weapons', 3),
  ('弹药', 'weapons', 3),
  ('偷渡', 'fraud', 3),
  ('ghostwriter', 'academic', 3),
  ('contract cheating', 'academic', 3),
  ('assignment for you', 'academic', 2),
  ('fake id', 'fraud', 3),
  ('onlyfans', 'adult', 2),
  ('escort', 'adult', 3),
  ('cocaine', 'drugs', 3),
  ('meth', 'drugs', 3),
  ('gun sale', 'weapons', 3),
  ('loan shark', 'financial', 3),
  ('casino', 'gambling', 2),
  ('kill yourself', 'harassment', 3),
  ('kys', 'harassment', 2)
ON CONFLICT DO NOTHING;
