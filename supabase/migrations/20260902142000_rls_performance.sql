BEGIN;

DROP POLICY IF EXISTS conversation_member_select ON public.conversations;
CREATE POLICY conversation_member_select ON public.conversations FOR SELECT TO authenticated
USING (
  company_id = private.auth_company_id() AND EXISTS (
    SELECT 1 FROM public.conversation_members cm
    JOIN public.users u ON u.id = cm.user_id AND u.company_id = cm.company_id
    WHERE cm.conversation_id = conversations.id AND cm.company_id = conversations.company_id
      AND u.auth_user_id = (SELECT auth.uid())
  )
);

DROP POLICY IF EXISTS message_member_select ON public.messages;
CREATE POLICY message_member_select ON public.messages FOR SELECT TO authenticated
USING (
  company_id = private.auth_company_id() AND EXISTS (
    SELECT 1 FROM public.conversation_members cm
    JOIN public.users u ON u.id = cm.user_id AND u.company_id = cm.company_id
    WHERE cm.conversation_id = messages.conversation_id AND cm.company_id = messages.company_id
      AND u.auth_user_id = (SELECT auth.uid())
  )
);

DROP POLICY IF EXISTS message_member_insert ON public.messages;
CREATE POLICY message_member_insert ON public.messages FOR INSERT TO authenticated
WITH CHECK (
  company_id = private.auth_company_id() AND EXISTS (
    SELECT 1 FROM public.conversation_members cm
    JOIN public.users u ON u.id = cm.user_id AND u.company_id = cm.company_id
    WHERE cm.conversation_id = messages.conversation_id AND cm.company_id = messages.company_id
      AND u.auth_user_id = (SELECT auth.uid()) AND messages.sender_id = u.id
  )
);

DROP POLICY IF EXISTS reads_owner_select ON public.message_reads;
CREATE POLICY reads_owner_select ON public.message_reads FOR SELECT TO authenticated
USING (
  company_id = private.auth_company_id() AND EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = message_reads.user_id AND u.company_id = message_reads.company_id
      AND u.auth_user_id = (SELECT auth.uid())
  )
);

DROP POLICY IF EXISTS reads_owner_insert ON public.message_reads;
CREATE POLICY reads_owner_insert ON public.message_reads FOR INSERT TO authenticated
WITH CHECK (
  company_id = private.auth_company_id() AND EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = message_reads.user_id AND u.company_id = message_reads.company_id
      AND u.auth_user_id = (SELECT auth.uid())
  )
);

COMMIT;
