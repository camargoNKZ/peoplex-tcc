-- access_groups tinha política de RLS pra SELECT/INSERT/UPDATE mas não pra
-- DELETE. Inofensivo hoje (tudo passa pelo pool com service role, que
-- ignora RLS), mas inconsistente com o resto do schema e bloquearia, sem
-- aviso nenhum, um futuro DELETE feito direto pelo client do Supabase.
CREATE POLICY tenant_isolation_delete ON access_groups
  FOR DELETE USING (company_id = private.auth_company_id());
