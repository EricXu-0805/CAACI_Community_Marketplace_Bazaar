-- 057: function privilege hardening — close the default-EXECUTE door
--
-- Postgres grants EXECUTE to PUBLIC on every new function, so all our
-- SECURITY DEFINER functions were callable by `anon` via /rest/v1/rpc/*
-- (the class of hole migration 050 closed for the admin_* RPCs; advisors
-- flagged 41 remaining). Verified against actual client usage before
-- revoking — the ONE rpc guests legitimately call is increment_view_count
-- (logged-out browsing counts item views), which deliberately keeps anon.
--
-- Trigger-returning functions never need caller EXECUTE at all: firing a
-- trigger checks privileges on the TABLE, not the function, and PostgREST
-- refuses to expose trigger functions. Internal helpers are only invoked
-- from inside other SECURITY DEFINER functions, where the privilege check
-- runs as the function owner (postgres), not the client role.

-- ── 1. Trigger functions: no client role ever needs these ──────────────
revoke execute on function public.enforce_conversation_flag_ownership() from public, anon, authenticated;
revoke execute on function public.enforce_item_image_mime()             from public, anon, authenticated;
revoke execute on function public.enforce_post_items_cap()              from public, anon, authenticated;
revoke execute on function public.handle_new_user()                     from public, anon, authenticated;
revoke execute on function public.maintain_item_favorite_count()        from public, anon, authenticated;
revoke execute on function public.messages_after_change_response()      from public, anon, authenticated;
revoke execute on function public.notify_followers_on_new_item()        from public, anon, authenticated;
revoke execute on function public.notify_item_sold()                    from public, anon, authenticated;
revoke execute on function public.notify_price_drop()                   from public, anon, authenticated;
revoke execute on function public.notify_saved_search_matches()         from public, anon, authenticated;
revoke execute on function public.ratings_after_change()                from public, anon, authenticated;
revoke execute on function public.rl_currency_exchange_before_insert()  from public, anon, authenticated;
revoke execute on function public.rl_follows_before_insert()            from public, anon, authenticated;
revoke execute on function public.rl_items_before_insert()              from public, anon, authenticated;
revoke execute on function public.rl_messages_before_insert()           from public, anon, authenticated;
revoke execute on function public.rl_post_comments_before_insert()      from public, anon, authenticated;
revoke execute on function public.rl_posts_before_insert()              from public, anon, authenticated;
revoke execute on function public.rl_reports_before_insert()            from public, anon, authenticated;
revoke execute on function public.rl_saved_searches_before_insert()     from public, anon, authenticated;
revoke execute on function public.trg_enforce_actor()                   from public, anon, authenticated;
revoke execute on function public.trg_moderate_items()                  from public, anon, authenticated;
revoke execute on function public.trg_moderate_messages()               from public, anon, authenticated;
revoke execute on function public.trg_moderate_post_comments()          from public, anon, authenticated;
revoke execute on function public.trg_moderate_posts()                  from public, anon, authenticated;
revoke execute on function public.trg_moderate_profiles()               from public, anon, authenticated;
revoke execute on function public.update_post_comment_count()           from public, anon, authenticated;
revoke execute on function public.update_post_comment_like_count()      from public, anon, authenticated;
revoke execute on function public.update_post_like_count()              from public, anon, authenticated;

-- ── 2. Internal helpers: only called from inside SECURITY DEFINER fns ──
-- (letting anon probe content_moderation_check would hand spammers an
-- offline oracle for what passes moderation)
revoke execute on function public.content_moderation_check(text)                  from public, anon, authenticated;
revoke execute on function public.recompute_profile_rating(uuid)                  from public, anon, authenticated;
revoke execute on function public.recompute_trust_score(uuid)                     from public, anon, authenticated;
revoke execute on function public.user_insert_count(regclass, uuid, interval)     from public, anon, authenticated;

-- is_posting_allowed: invoked by rl_items_before_insert internally; keep
-- authenticated in case a logged-in flow ever probes it directly.
revoke execute on function public.is_posting_allowed(uuid) from public, anon;

-- ── 3. Auth-only client RPCs: signed-in flows, anon has no business ────
revoke execute on function public.delete_my_account()                      from public, anon;
revoke execute on function public.get_last_messages(uuid[])                from public, anon;
revoke execute on function public.get_my_profile()                         from public, anon;
revoke execute on function public.mark_onboarded(text, text, text)         from public, anon;
revoke execute on function public.record_consent(text)                     from public, anon;
revoke execute on function public.record_fingerprint(text, text)           from public, anon;
revoke execute on function public.submit_appeal(text)                      from public, anon;

-- increment_view_count(uuid) intentionally keeps anon: guests browse item
-- details without an account and views must still count.
