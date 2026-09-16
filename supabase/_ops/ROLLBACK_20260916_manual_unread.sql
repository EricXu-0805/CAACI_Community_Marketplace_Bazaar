-- Application rollback: stop new manual-unread writes while preserving every
-- participant flag and the cross-party guard. Existing receipt reads remain.
-- Deploy the prior app before invoking this in one transaction. To resume,
-- GRANT EXECUTE on this exact function to authenticated; do not drop columns.
SET LOCAL lock_timeout='2s';
REVOKE EXECUTE ON FUNCTION public.set_conversation_read_state(uuid,uuid,boolean) FROM authenticated;
NOTIFY pgrst, 'reload schema';
