-- Runs inside the operator's transaction. Does not change search RPCs.
ALTER POLICY "Anyone can view active items" ON public.items USING (
 status<>'deleted' AND moderation_private.profile_content_visible(user_id)
);
DROP FUNCTION moderation_private.hidden_content_profile_ids();
NOTIFY pgrst, 'reload schema';
