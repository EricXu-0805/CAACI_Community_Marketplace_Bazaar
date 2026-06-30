-- 082_edge_rate_limit.sql
--
-- ADM-SEC-06 from the 2026-06-29 admin review: the /api/admin edge function had
-- no rate limit. It's already per-admin-token gated and very low traffic, so the
-- point isn't brute-forcing a 32-byte token (infeasible) — it's denying an
-- attacker the ability to hammer the endpoint (credential-stuffing probes,
-- audit-log spam, or plain request-flood DoS) for free.
--
-- A stateless edge function can't count requests on its own, so this adds a
-- tiny fixed-window counter table + an atomic "hit" RPC the edge calls per
-- request. Generic (keyed by an opaque bucket string) so other edge routes can
-- reuse it later. service_role only.

CREATE TABLE IF NOT EXISTS public.edge_rate_limits (
  bucket       text PRIMARY KEY,
  count        integer NOT NULL DEFAULT 0,
  window_start timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.edge_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.edge_rate_limits FROM PUBLIC, anon, authenticated;
GRANT  SELECT, INSERT, UPDATE ON public.edge_rate_limits TO service_role;

-- Atomic fixed-window increment. Returns true if the request is allowed (count
-- within max for the current window), false if it has exceeded the cap. The
-- window resets in-place once window_secs has elapsed, so the table stays at
-- one row per active bucket.
CREATE OR REPLACE FUNCTION public.edge_rate_hit(
  bucket_in      text,
  max_in         integer,
  window_secs_in integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  INSERT INTO public.edge_rate_limits AS e (bucket, count, window_start)
  VALUES (bucket_in, 1, now())
  ON CONFLICT (bucket) DO UPDATE
    SET count = CASE
          WHEN e.window_start < now() - make_interval(secs => window_secs_in)
          THEN 1 ELSE e.count + 1 END,
        window_start = CASE
          WHEN e.window_start < now() - make_interval(secs => window_secs_in)
          THEN now() ELSE e.window_start END
  RETURNING e.count INTO v_count;

  RETURN v_count <= max_in;
END;
$$;

REVOKE ALL ON FUNCTION public.edge_rate_hit(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.edge_rate_hit(text, integer, integer) TO service_role;
