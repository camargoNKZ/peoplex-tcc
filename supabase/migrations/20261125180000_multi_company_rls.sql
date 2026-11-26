-- Uma identidade pode estar em várias empresas: sem empresa única, falha
-- fechado em vez de escolher uma arbitrariamente.
CREATE OR REPLACE FUNCTION private.auth_company_id()
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE WHEN COUNT(*) = 1 THEN MIN(company_id) END
    FROM public.users WHERE auth_user_id = auth.uid() AND active = true;
$$;

-- O Realtime lê messages pelo navegador e não conhece a empresa ativa.
CREATE OR REPLACE FUNCTION private.is_conversation_member(p_conversation bigint, p_company bigint)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversation_members cm
      JOIN public.users u ON u.id = cm.user_id AND u.company_id = cm.company_id
      JOIN public.companies c ON c.id = u.company_id AND c.active = true
     WHERE cm.conversation_id = p_conversation AND cm.company_id = p_company
       AND u.auth_user_id = auth.uid() AND u.active = true);
$$;
REVOKE ALL ON FUNCTION private.is_conversation_member(bigint, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.is_conversation_member(bigint, bigint) TO authenticated;

DROP POLICY message_member_select ON public.messages;
CREATE POLICY message_member_select ON public.messages FOR SELECT TO authenticated
  USING (private.is_conversation_member(conversation_id, company_id));
