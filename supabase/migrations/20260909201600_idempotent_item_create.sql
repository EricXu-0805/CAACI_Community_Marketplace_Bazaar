-- Match chat's client-owned UUID retry model. Only the INSERT id column is
-- added; owner RLS, write validation, primary-key uniqueness and UPDATE
-- restrictions remain enforced. Existing clients may still use the default.
GRANT INSERT (id) ON public.items TO authenticated;
