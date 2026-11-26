-- Arquivos só passam pela API (service role + links assinados).
DROP POLICY IF EXISTS storage_tenant_insert ON storage.objects;
DROP POLICY IF EXISTS storage_tenant_read ON storage.objects;
DROP POLICY IF EXISTS storage_tenant_update ON storage.objects;
DROP POLICY IF EXISTS storage_tenant_delete ON storage.objects;
