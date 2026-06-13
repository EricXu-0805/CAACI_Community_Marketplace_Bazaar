-- 059_revoke_offer_rpcs_from_anon.sql — close the anon EXECUTE hole on the
-- offer RPCs (audit round 2, rls-authz dimension).
--
-- make_offer / respond_to_offer (051) are SECURITY DEFINER. 051 locked them
-- with only `revoke all ... from public` + `grant ... to authenticated`, and
-- never revoked from anon. But Supabase's default privileges grant the anon
-- role an EXPLICIT execute on every new function, which a REVOKE FROM PUBLIC
-- does NOT remove — verified on the live DB in 052/053 (has_function_privilege
-- (anon, ...) stayed true until an explicit anon revoke). 057 swept the same
-- door shut for 7 other RPCs but missed this pair.
--
-- Both RPCs self-gate on auth.uid() (make_offer requires conversation
-- participation; respond_to_offer requires being the recipient), so an anon
-- call already raises an exception and cannot mutate data — this is pure
-- defense-in-depth + clears the Supabase advisor, matching the 050/052/057
-- hardening pattern. Mirror 053's public+anon revoke shape.

revoke all on function public.make_offer(uuid, numeric, text) from public;
revoke all on function public.make_offer(uuid, numeric, text) from anon;

revoke all on function public.respond_to_offer(uuid, text, numeric, text) from public;
revoke all on function public.respond_to_offer(uuid, text, numeric, text) from anon;

-- Verify:
--   select has_function_privilege('anon', 'public.make_offer(uuid,numeric,text)', 'EXECUTE');        -- expect false
--   select has_function_privilege('anon', 'public.respond_to_offer(uuid,text,numeric,text)', 'EXECUTE'); -- expect false
--   select has_function_privilege('authenticated', 'public.make_offer(uuid,numeric,text)', 'EXECUTE'); -- expect true
