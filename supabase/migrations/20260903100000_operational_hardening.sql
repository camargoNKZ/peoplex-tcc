BEGIN;

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS terminated_at TIMESTAMPTZ;
UPDATE public.users SET terminated_at=updated_at WHERE active=false AND terminated_at IS NULL;

CREATE INDEX IF NOT EXISTS users_company_terminated_idx
  ON public.users(company_id,terminated_at) WHERE terminated_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS users_department_tenant_idx ON public.users(department_id,company_id);
CREATE INDEX IF NOT EXISTS users_manager_tenant_idx ON public.users(manager_id,company_id);
CREATE INDEX IF NOT EXISTS requests_user_tenant_idx ON public.requests(user_id,company_id);
CREATE INDEX IF NOT EXISTS requests_type_tenant_idx ON public.requests(request_type_id,company_id);
CREATE INDEX IF NOT EXISTS request_events_request_tenant_idx ON public.request_events(request_id,company_id);
CREATE INDEX IF NOT EXISTS notice_reads_user_tenant_idx ON public.notice_reads(user_id,company_id);
CREATE INDEX IF NOT EXISTS documents_user_tenant_idx ON public.user_documents(user_id,company_id);
CREATE INDEX IF NOT EXISTS conversation_members_conversation_tenant_idx
  ON public.conversation_members(conversation_id,company_id);
CREATE INDEX IF NOT EXISTS messages_sender_tenant_idx ON public.messages(sender_id,company_id);
CREATE INDEX IF NOT EXISTS message_reads_message_tenant_idx ON public.message_reads(message_id,company_id);

COMMENT ON TABLE public.platform_admins IS
  'Platform-only data. RLS intentionally has no tenant policy; access is restricted to the server service role.';
COMMENT ON TABLE public.platform_audit_logs IS
  'Platform-only audit data. RLS intentionally has no tenant policy; access is restricted to the server service role.';

COMMIT;
