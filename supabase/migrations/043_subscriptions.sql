-- ============================================
-- 043 Subscriptions — Stripe membership + CAACI subscription management
-- ============================================
--
-- Background
-- ----------
-- PRD §3/§6 describe a paid membership system (基础/高级/至尊) on top of the
-- existing marketplace. Until now there was zero code for it. This migration
-- lays the *backend data layer*; the user-facing pages and the CAACI admin
-- dashboard UI are built in a later session on top of these tables.
--
-- Money flow (PRD §9.2): checkout happens ONLY on the webpage via Stripe
-- Checkout + Customer Portal. A Stripe webhook (api/stripe/webhook.js) is the
-- single writer of subscription/invoice state. The WeChat mini-program is
-- read-only and renders the same `subscriptions` rows.
--
-- Design choices
-- --------------
-- · Plans live in a DB table (subscription_plans) so CAACI can add/edit
--   tiers + prices without a code deploy. Each row references a Stripe
--   Price via stripe_price_id; the platform never stores card data.
-- · `currency` is free-form 3-letter text (usd/cad/cny) — pricing currency
--   is still TBD (PRD B5), so we don't hard-enum it.
-- · All writes to subscriptions/invoices/refunds go through service_role
--   (webhook + admin edge). Users get SELECT-only RLS on their own rows.
-- · Audit reuses the existing admin_audit_log + record_audit (migration 031)
--   rather than a new operation_logs table — we just widen the event_kind
--   whitelist below.
-- · Notifications reuse the existing public.notifications table (migration
--   005); we only widen its `type` CHECK to allow 'subscription'.
--
-- Rollback
-- --------
--   DROP TABLE public.refunds, public.invoices, public.subscriptions,
--             public.subscription_plans, public.stripe_events CASCADE;
--   ALTER TABLE public.profiles DROP COLUMN IF EXISTS stripe_customer_id;
--   (then revert the two CHECK-constraint widenings below)
-- ============================================

-- ---------- profiles: link to Stripe customer ----------
-- One Stripe customer per profile, reused across checkouts/portal sessions.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS stripe_customer_id text;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_stripe_customer_id_key
  ON public.profiles (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

-- ============================================
-- 1. subscription_plans — CAACI-configurable catalogue
-- ============================================
CREATE TABLE IF NOT EXISTS public.subscription_plans (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code            text NOT NULL UNIQUE,                 -- stable key, e.g. 'basic_monthly_usd'
  name            text NOT NULL,
  name_zh         text,
  description     text,
  description_zh  text,
  stripe_price_id text,                                 -- set by CAACI after creating the Stripe Price
  interval        text NOT NULL CHECK (interval IN ('month', 'year')),
  amount_cents    integer NOT NULL CHECK (amount_cents >= 0),
  currency        text NOT NULL DEFAULT 'usd' CHECK (length(currency) = 3),
  benefits        jsonb NOT NULL DEFAULT '[]'::jsonb,   -- CAACI-editable benefit list
  is_active       boolean NOT NULL DEFAULT true,
  sort_order      integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS subscription_plans_active_idx
  ON public.subscription_plans (is_active, sort_order);

CREATE INDEX IF NOT EXISTS subscription_plans_price_idx
  ON public.subscription_plans (stripe_price_id)
  WHERE stripe_price_id IS NOT NULL;

CREATE TRIGGER set_subscription_plans_updated_at
  BEFORE UPDATE ON public.subscription_plans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;

-- Anyone may read active plans (the pricing page). Writes are service_role only.
DROP POLICY IF EXISTS subscription_plans_read_active ON public.subscription_plans;
CREATE POLICY subscription_plans_read_active ON public.subscription_plans
  FOR SELECT
  USING (is_active = true);

-- ============================================
-- 2. subscriptions — per-user state, written by webhook/admin only
-- ============================================
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  plan_id                uuid REFERENCES public.subscription_plans(id) ON DELETE SET NULL,
  stripe_subscription_id text UNIQUE,
  status                 text NOT NULL CHECK (status IN (
                           'trialing', 'active', 'past_due', 'canceled',
                           'incomplete', 'incomplete_expired', 'unpaid', 'paused'
                         )),
  current_period_start   timestamptz,
  current_period_end     timestamptz,
  trial_end              timestamptz,
  cancel_at_period_end   boolean NOT NULL DEFAULT false,
  canceled_at            timestamptz,
  source                 text NOT NULL DEFAULT 'stripe',   -- 'stripe' | 'manual' (CAACI comp)
  notes                  text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS subscriptions_user_idx
  ON public.subscriptions (user_id, status);

CREATE INDEX IF NOT EXISTS subscriptions_status_idx
  ON public.subscriptions (status, current_period_end);

CREATE TRIGGER set_subscriptions_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- Users may read their own subscription. No write policy = service_role only.
DROP POLICY IF EXISTS subscriptions_read_own ON public.subscriptions;
CREATE POLICY subscriptions_read_own ON public.subscriptions
  FOR SELECT
  USING (auth.uid() = user_id);

-- ============================================
-- 3. invoices — billing history (reconciliation, PRD §11)
-- ============================================
CREATE TABLE IF NOT EXISTS public.invoices (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id   uuid REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  user_id           uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  stripe_invoice_id text UNIQUE,
  amount_cents      integer,
  currency          text,
  status            text,                               -- Stripe invoice status (paid/open/void/...)
  paid_at           timestamptz,
  hosted_invoice_url text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invoices_user_idx
  ON public.invoices (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS invoices_subscription_idx
  ON public.invoices (subscription_id, created_at DESC);

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

-- Users may read their own invoices. Writes are service_role only.
DROP POLICY IF EXISTS invoices_read_own ON public.invoices;
CREATE POLICY invoices_read_own ON public.invoices
  FOR SELECT
  USING (auth.uid() = user_id);

-- ============================================
-- 4. refunds — admin-initiated refunds (PRD §4.3)
-- ============================================
CREATE TABLE IF NOT EXISTS public.refunds (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id       uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  stripe_refund_id text UNIQUE,
  amount_cents     integer,
  currency         text,
  reason           text,
  operator_id      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,  -- admin who issued it
  status           text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS refunds_invoice_idx
  ON public.refunds (invoice_id, created_at DESC);

ALTER TABLE public.refunds ENABLE ROW LEVEL SECURITY;
-- No policies = no client access. service_role (admin edge) only.

-- ============================================
-- 5. stripe_events — webhook idempotency (PRD §7 "按 event.id 幂等")
-- ============================================
CREATE TABLE IF NOT EXISTS public.stripe_events (
  event_id    text PRIMARY KEY,
  type        text,
  received_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.stripe_events ENABLE ROW LEVEL SECURITY;
-- No policies = no client access. service_role only.

-- ============================================
-- 6. Widen existing CHECK constraints
-- ============================================

-- 6a. admin_audit_log.event_kind — add subscription/refund event kinds.
ALTER TABLE public.admin_audit_log
  DROP CONSTRAINT IF EXISTS admin_audit_log_event_kind_check;
ALTER TABLE public.admin_audit_log
  ADD CONSTRAINT admin_audit_log_event_kind_check CHECK (event_kind IN (
    'ban_applied',
    'suspension_lifted',
    'report_status_changed',
    'actor_blocked',
    'admin_login',
    'admin_unauthorized',
    'plan_upserted',
    'subscription_canceled',
    'subscription_granted',
    'subscription_changed',
    'refund_issued'
  ));

-- 6b. notifications.type — allow 'subscription' so renewal/failure alerts
--     can reuse the existing notifications table (migration 005).
ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check CHECK (type IN (
    'price_drop', 'system', 'sold', 'subscription'
  ));

-- ============================================
-- 7. Grants (service_role bypasses RLS but explicit grants document intent)
-- ============================================
GRANT SELECT, INSERT, UPDATE, DELETE ON public.subscription_plans TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.subscriptions      TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoices           TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.refunds            TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stripe_events      TO service_role;
GRANT SELECT ON public.subscription_plans TO anon, authenticated;
GRANT SELECT ON public.subscriptions      TO authenticated;
GRANT SELECT ON public.invoices           TO authenticated;

-- ============================================
-- 8. Admin read/stat RPCs (SECURITY DEFINER, service_role only)
-- ============================================
-- These mirror the existing admin_* RPC pattern (migrations 029/031): the
-- /api/admin edge function calls them with the service-role key; PostgREST
-- exposes them only to service_role.

-- ---------- admin_list_subscriptions ----------
CREATE OR REPLACE FUNCTION public.admin_list_subscriptions(
  limit_in      integer DEFAULT 50,
  offset_in     integer DEFAULT 0,
  status_filter text    DEFAULT NULL,
  plan_filter   uuid    DEFAULT NULL,
  search_in     text    DEFAULT NULL
)
RETURNS TABLE (
  id                     uuid,
  user_id                uuid,
  nickname               text,
  email                  text,
  plan_id                uuid,
  plan_name              text,
  status                 text,
  source                 text,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean,
  stripe_subscription_id text,
  created_at             timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id, s.user_id, p.nickname, p.email,
         s.plan_id, pl.name AS plan_name,
         s.status, s.source, s.current_period_end,
         s.cancel_at_period_end, s.stripe_subscription_id, s.created_at
    FROM public.subscriptions s
    LEFT JOIN public.profiles p          ON p.id = s.user_id
    LEFT JOIN public.subscription_plans pl ON pl.id = s.plan_id
   WHERE (status_filter IS NULL OR s.status = status_filter)
     AND (plan_filter   IS NULL OR s.plan_id = plan_filter)
     AND (search_in IS NULL OR search_in = ''
          OR p.nickname ILIKE '%' || search_in || '%'
          OR p.email    ILIKE '%' || search_in || '%')
   ORDER BY s.created_at DESC
   LIMIT  GREATEST(1, LEAST(200, limit_in))
   OFFSET GREATEST(0, offset_in);
$$;

REVOKE ALL ON FUNCTION public.admin_list_subscriptions(integer, integer, text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_subscriptions(integer, integer, text, uuid, text) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_list_subscriptions(integer, integer, text, uuid, text) TO service_role;

-- ---------- admin_get_subscription_detail ----------
CREATE OR REPLACE FUNCTION public.admin_get_subscription_detail(id_in uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'subscription', to_jsonb(s.*),
    'profile', jsonb_build_object(
      'id', p.id, 'nickname', p.nickname, 'email', p.email,
      'stripe_customer_id', p.stripe_customer_id
    ),
    'plan', to_jsonb(pl.*),
    'invoices', COALESCE((
      SELECT jsonb_agg(to_jsonb(i.*) ORDER BY i.created_at DESC)
        FROM public.invoices i
       WHERE i.subscription_id = s.id
    ), '[]'::jsonb)
  )
    FROM public.subscriptions s
    LEFT JOIN public.profiles p          ON p.id = s.user_id
    LEFT JOIN public.subscription_plans pl ON pl.id = s.plan_id
   WHERE s.id = id_in;
$$;

REVOKE ALL ON FUNCTION public.admin_get_subscription_detail(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_subscription_detail(uuid) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_get_subscription_detail(uuid) TO service_role;

-- ---------- admin_list_invoices ----------
CREATE OR REPLACE FUNCTION public.admin_list_invoices(
  limit_in      integer DEFAULT 50,
  offset_in     integer DEFAULT 0,
  status_filter text    DEFAULT NULL
)
RETURNS TABLE (
  id                 uuid,
  user_id            uuid,
  nickname           text,
  email              text,
  subscription_id    uuid,
  stripe_invoice_id  text,
  amount_cents       integer,
  currency           text,
  status             text,
  paid_at            timestamptz,
  hosted_invoice_url text,
  created_at         timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT i.id, i.user_id, p.nickname, p.email,
         i.subscription_id, i.stripe_invoice_id, i.amount_cents,
         i.currency, i.status, i.paid_at, i.hosted_invoice_url, i.created_at
    FROM public.invoices i
    LEFT JOIN public.profiles p ON p.id = i.user_id
   WHERE (status_filter IS NULL OR i.status = status_filter)
   ORDER BY i.created_at DESC
   LIMIT  GREATEST(1, LEAST(200, limit_in))
   OFFSET GREATEST(0, offset_in);
$$;

REVOKE ALL ON FUNCTION public.admin_list_invoices(integer, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_invoices(integer, integer, text) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_list_invoices(integer, integer, text) TO service_role;

-- ---------- admin_subscription_metrics ----------
-- Dashboard KPIs (PRD §5, P0). MRR is normalised to a monthly figure per
-- currency (annual plans / 12). Churn = canceled in the trailing 30 days.
CREATE OR REPLACE FUNCTION public.admin_subscription_metrics()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'active_count', (
      SELECT count(*) FROM public.subscriptions
       WHERE status IN ('active', 'trialing')
    ),
    'past_due_count', (
      SELECT count(*) FROM public.subscriptions WHERE status = 'past_due'
    ),
    'canceled_30d', (
      SELECT count(*) FROM public.subscriptions
       WHERE status = 'canceled' AND canceled_at >= now() - interval '30 days'
    ),
    'new_30d', (
      SELECT count(*) FROM public.subscriptions
       WHERE created_at >= now() - interval '30 days'
    ),
    'by_plan', COALESCE((
      SELECT jsonb_agg(t) FROM (
        SELECT pl.id AS plan_id, pl.name AS plan_name, count(s.id) AS active
          FROM public.subscription_plans pl
          LEFT JOIN public.subscriptions s
            ON s.plan_id = pl.id AND s.status IN ('active', 'trialing')
         GROUP BY pl.id, pl.name
         ORDER BY pl.sort_order
      ) t
    ), '[]'::jsonb),
    'mrr_by_currency', COALESCE((
      SELECT jsonb_agg(t) FROM (
        SELECT pl.currency,
               sum(CASE WHEN pl.interval = 'year'
                        THEN pl.amount_cents / 12.0
                        ELSE pl.amount_cents END)::bigint AS mrr_cents
          FROM public.subscriptions s
          JOIN public.subscription_plans pl ON pl.id = s.plan_id
         WHERE s.status IN ('active', 'trialing')
         GROUP BY pl.currency
      ) t
    ), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.admin_subscription_metrics() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_subscription_metrics() FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_subscription_metrics() TO service_role;

NOTIFY pgrst, 'reload schema';
