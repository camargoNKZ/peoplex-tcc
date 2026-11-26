BEGIN;

ALTER FUNCTION public.set_tenant_context(BIGINT) SET search_path = public, pg_temp;
ALTER FUNCTION public.current_tenant_id() SET search_path = public, pg_temp;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated, service_role, peoplex_app;

ALTER FUNCTION public.auth_company_id() SET SCHEMA private;
REVOKE ALL ON FUNCTION private.auth_company_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.auth_company_id() TO authenticated, service_role, peoplex_app;

CREATE SCHEMA IF NOT EXISTS extensions;
ALTER EXTENSION citext SET SCHEMA extensions;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role, peoplex_app;

COMMIT;
