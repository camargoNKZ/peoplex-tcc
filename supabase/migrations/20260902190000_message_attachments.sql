BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('message-attachments', 'message-attachments', false, 5242880,
        ARRAY['image/jpeg','image/png','application/pdf'])
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS storage_tenant_read ON storage.objects;
DROP POLICY IF EXISTS storage_tenant_insert ON storage.objects;
DROP POLICY IF EXISTS storage_tenant_update ON storage.objects;
DROP POLICY IF EXISTS storage_tenant_delete ON storage.objects;

CREATE POLICY storage_tenant_read ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id IN ('avatars','documents','message-attachments')
  AND (storage.foldername(name))[1] = private.auth_company_id()::text
);

CREATE POLICY storage_tenant_insert ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id IN ('avatars','documents','message-attachments')
  AND (storage.foldername(name))[1] = private.auth_company_id()::text
);

CREATE POLICY storage_tenant_update ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id IN ('avatars','documents','message-attachments')
  AND (storage.foldername(name))[1] = private.auth_company_id()::text
)
WITH CHECK (
  bucket_id IN ('avatars','documents','message-attachments')
  AND (storage.foldername(name))[1] = private.auth_company_id()::text
);

CREATE POLICY storage_tenant_delete ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id IN ('avatars','documents','message-attachments')
  AND (storage.foldername(name))[1] = private.auth_company_id()::text
);

COMMIT;
