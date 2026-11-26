-- Optional Supabase phase — run only after linking users.auth_user_id to auth.users.id.
-- The Express API should use the service role on the server only. Never expose it to the browser.

BEGIN;

CREATE OR REPLACE FUNCTION public.auth_company_id()
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT company_id FROM public.users
  WHERE auth_user_id = auth.uid() AND active = true
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.auth_company_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_company_id() TO authenticated;

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE notice_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_company_select ON companies FOR SELECT TO authenticated
  USING (id = public.auth_company_id());

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'departments','users','request_types','requests','request_events',
    'notices','notice_reads','user_documents','email_logs','audit_logs'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY tenant_isolation_select ON %I FOR SELECT TO authenticated USING (company_id = public.auth_company_id())',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY tenant_isolation_insert ON %I FOR INSERT TO authenticated WITH CHECK (company_id = public.auth_company_id())',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY tenant_isolation_update ON %I FOR UPDATE TO authenticated USING (company_id = public.auth_company_id()) WITH CHECK (company_id = public.auth_company_id())',
      table_name
    );
  END LOOP;
END $$;

CREATE POLICY conversation_member_select ON conversations FOR SELECT TO authenticated
USING (
  company_id = public.auth_company_id() AND EXISTS (
    SELECT 1 FROM conversation_members cm
    JOIN users u ON u.id=cm.user_id AND u.company_id=cm.company_id
    WHERE cm.conversation_id=conversations.id AND cm.company_id=conversations.company_id
      AND u.auth_user_id=auth.uid()
  )
);

CREATE POLICY conversation_tenant_insert ON conversations FOR INSERT TO authenticated
  WITH CHECK (company_id = public.auth_company_id());
CREATE POLICY conversation_member_rows ON conversation_members FOR SELECT TO authenticated
  USING (company_id = public.auth_company_id());
CREATE POLICY conversation_member_insert ON conversation_members FOR INSERT TO authenticated
  WITH CHECK (company_id = public.auth_company_id());

CREATE POLICY message_member_select ON messages FOR SELECT TO authenticated
USING (
  company_id = public.auth_company_id() AND EXISTS (
    SELECT 1 FROM conversation_members cm
    JOIN users u ON u.id=cm.user_id AND u.company_id=cm.company_id
    WHERE cm.conversation_id=messages.conversation_id AND cm.company_id=messages.company_id
      AND u.auth_user_id=auth.uid()
  )
);

CREATE POLICY message_member_insert ON messages FOR INSERT TO authenticated
WITH CHECK (
  company_id = public.auth_company_id() AND EXISTS (
    SELECT 1 FROM conversation_members cm
    JOIN users u ON u.id=cm.user_id AND u.company_id=cm.company_id
    WHERE cm.conversation_id=messages.conversation_id AND cm.company_id=messages.company_id
      AND u.auth_user_id=auth.uid() AND messages.sender_id=u.id
  )
);

CREATE POLICY reads_owner_select ON message_reads FOR SELECT TO authenticated
USING (
  company_id = public.auth_company_id() AND EXISTS (
    SELECT 1 FROM users u WHERE u.id=message_reads.user_id AND u.company_id=message_reads.company_id
      AND u.auth_user_id=auth.uid()
  )
);
CREATE POLICY reads_owner_insert ON message_reads FOR INSERT TO authenticated
WITH CHECK (
  company_id = public.auth_company_id() AND EXISTS (
    SELECT 1 FROM users u WHERE u.id=message_reads.user_id AND u.company_id=message_reads.company_id
      AND u.auth_user_id=auth.uid()
  )
);

COMMIT;
