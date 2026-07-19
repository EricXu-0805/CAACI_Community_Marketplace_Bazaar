-- Isolated behavioral regression for
-- 20260717143223_harden_saved_search_boundaries.sql.
--
-- Run only against a disposable/local database after the migration. Every
-- fixture is enclosed in this transaction and rolled back at the end.

BEGIN;

DO $$
DECLARE
  publisher_id uuid := 'f1000000-0000-4000-8000-000000000001';
  percent_subscriber_id uuid := 'f1000000-0000-4000-8000-000000000002';
  underscore_subscriber_id uuid := 'f1000000-0000-4000-8000-000000000003';
  normal_subscriber_id uuid := 'f1000000-0000-4000-8000-000000000004';
  percent_plain_item_id uuid := 'f2000000-0000-4000-8000-000000000001';
  percent_literal_item_id uuid := 'f2000000-0000-4000-8000-000000000002';
  underscore_plain_item_id uuid := 'f2000000-0000-4000-8000-000000000003';
  underscore_literal_item_id uuid := 'f2000000-0000-4000-8000-000000000004';
  wanted_item_id uuid := 'f2000000-0000-4000-8000-000000000005';
  matching_item_id uuid := 'f2000000-0000-4000-8000-000000000006';
  throttled_item_id uuid := 'f2000000-0000-4000-8000-000000000007';
  actual_count integer;
BEGIN
  INSERT INTO auth.users (id, email)
  VALUES
    (publisher_id, 'saved-search-publisher@example.test'),
    (percent_subscriber_id, 'saved-search-percent@example.test'),
    (underscore_subscriber_id, 'saved-search-underscore@example.test'),
    (normal_subscriber_id, 'saved-search-normal@example.test');

  -- Negative lower bounds are rejected.
  BEGIN
    INSERT INTO public.saved_searches (
      user_id, keyword, price_min, listing_type
    ) VALUES (
      percent_subscriber_id, 'negative minimum', -0.01, 'sell'
    );
    RAISE EXCEPTION 'negative price_min unexpectedly accepted';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  -- Negative upper bounds are rejected independently.
  BEGIN
    INSERT INTO public.saved_searches (
      user_id, keyword, price_max, listing_type
    ) VALUES (
      percent_subscriber_id, 'negative maximum', -0.01, 'sell'
    );
    RAISE EXCEPTION 'negative price_max unexpectedly accepted';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  -- The existing min <= max invariant remains enforced.
  BEGIN
    INSERT INTO public.saved_searches (
      user_id, keyword, price_min, price_max, listing_type
    ) VALUES (
      percent_subscriber_id, 'reversed range', 20, 10, 'sell'
    );
    RAISE EXCEPTION 'reversed price range unexpectedly accepted';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  INSERT INTO public.saved_searches (user_id, keyword, listing_type)
  VALUES
    (percent_subscriber_id, '%', 'sell'),
    (underscore_subscriber_id, '_', 'sell');

  -- Two matching searches for one subscriber exercise per-item dedupe. Price
  -- bounds and listing_type are also covered by the same fixtures.
  INSERT INTO public.saved_searches (
    user_id, keyword, category, price_min, price_max, listing_type
  ) VALUES
    (normal_subscriber_id, 'desk', 'electronics', 10, 30, 'sell'),
    (normal_subscriber_id, 'lamp', 'electronics', 10, 30, 'sell');

  INSERT INTO public.items (
    id, user_id, title, description, price, category, condition, status,
    listing_type
  ) VALUES (
    percent_plain_item_id, publisher_id, 'ordinary listing',
    'contains no special symbol', 15, 'electronics', 'good', 'active', 'sell'
  );

  SELECT count(*) INTO actual_count
  FROM public.notifications
  WHERE user_id = percent_subscriber_id
    AND item_id = percent_plain_item_id
    AND type = 'system'
    AND body = 'saved_search_match';
  IF actual_count <> 0 THEN
    RAISE EXCEPTION '%% wildcard matched without a literal percent sign';
  END IF;

  INSERT INTO public.items (
    id, user_id, title, description, price, category, condition, status,
    listing_type
  ) VALUES (
    percent_literal_item_id, publisher_id, 'literal 50% discount',
    'percent fixture', 15, 'electronics', 'good', 'active', 'sell'
  );

  SELECT count(*) INTO actual_count
  FROM public.notifications
  WHERE user_id = percent_subscriber_id
    AND item_id = percent_literal_item_id
    AND type = 'system'
    AND body = 'saved_search_match';
  IF actual_count <> 1 THEN
    RAISE EXCEPTION 'literal percent match expected 1 notification, got %', actual_count;
  END IF;

  INSERT INTO public.items (
    id, user_id, title, description, price, category, condition, status,
    listing_type
  ) VALUES (
    underscore_plain_item_id, publisher_id, 'ordinary alpha listing',
    'contains letters only', 15, 'electronics', 'good', 'active', 'sell'
  );

  SELECT count(*) INTO actual_count
  FROM public.notifications
  WHERE user_id = underscore_subscriber_id
    AND item_id = underscore_plain_item_id
    AND type = 'system'
    AND body = 'saved_search_match';
  IF actual_count <> 0 THEN
    RAISE EXCEPTION '_ wildcard matched without a literal underscore';
  END IF;

  INSERT INTO public.items (
    id, user_id, title, description, price, category, condition, status,
    listing_type
  ) VALUES (
    underscore_literal_item_id, publisher_id, 'literal_under_score',
    'underscore fixture', 15, 'electronics', 'good', 'active', 'sell'
  );

  SELECT count(*) INTO actual_count
  FROM public.notifications
  WHERE user_id = underscore_subscriber_id
    AND item_id = underscore_literal_item_id
    AND type = 'system'
    AND body = 'saved_search_match';
  IF actual_count <> 1 THEN
    RAISE EXCEPTION 'literal underscore match expected 1 notification, got %', actual_count;
  END IF;

  -- A sell-only saved search must not match a wanted listing.
  INSERT INTO public.items (
    id, user_id, title, description, price, category, condition, status,
    listing_type
  ) VALUES (
    wanted_item_id, publisher_id, 'desk lamp wanted',
    'type-filter fixture', 20, 'electronics', 'good', 'active', 'wanted'
  );

  SELECT count(*) INTO actual_count
  FROM public.notifications
  WHERE user_id = normal_subscriber_id
    AND item_id = wanted_item_id
    AND type = 'system'
    AND body = 'saved_search_match';
  IF actual_count <> 0 THEN
    RAISE EXCEPTION 'sell-only saved search matched a wanted listing';
  END IF;

  -- Both saved searches match this item, but the subscriber receives exactly
  -- one notification. This also proves normal literal keyword matching.
  INSERT INTO public.items (
    id, user_id, title, description, price, category, condition, status,
    listing_type
  ) VALUES (
    matching_item_id, publisher_id, 'walnut desk lamp',
    'normal match fixture', 20, 'electronics', 'good', 'active', 'sell'
  );

  SELECT count(*) INTO actual_count
  FROM public.notifications
  WHERE user_id = normal_subscriber_id
    AND item_id = matching_item_id
    AND type = 'system'
    AND body = 'saved_search_match';
  IF actual_count <> 1 THEN
    RAISE EXCEPTION 'deduped normal match expected 1 notification, got %', actual_count;
  END IF;

  -- A second matching item inside 24 hours is throttled.
  INSERT INTO public.items (
    id, user_id, title, description, price, category, condition, status,
    listing_type
  ) VALUES (
    throttled_item_id, publisher_id, 'second desk lamp',
    '24-hour throttle fixture', 20, 'electronics', 'good', 'active', 'sell'
  );

  SELECT count(*) INTO actual_count
  FROM public.notifications
  WHERE user_id = normal_subscriber_id
    AND item_id = throttled_item_id
    AND type = 'system'
    AND body = 'saved_search_match';
  IF actual_count <> 0 THEN
    RAISE EXCEPTION '24-hour throttle did not suppress the second match';
  END IF;
END;
$$;

ROLLBACK;
