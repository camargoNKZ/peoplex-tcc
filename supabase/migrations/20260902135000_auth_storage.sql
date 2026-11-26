BEGIN;

ALTER TABLE public.users ALTER COLUMN password_hash DROP NOT NULL;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('avatars', 'avatars', false, 5242880, ARRAY['image/jpeg','image/png']),
  ('documents', 'documents', false, 5242880, ARRAY['image/jpeg','image/png','application/pdf'])
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY storage_tenant_read ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id IN ('avatars','documents')
  AND (storage.foldername(name))[1] = public.auth_company_id()::text
);

CREATE POLICY storage_tenant_insert ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id IN ('avatars','documents')
  AND (storage.foldername(name))[1] = public.auth_company_id()::text
);

CREATE POLICY storage_tenant_update ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id IN ('avatars','documents')
  AND (storage.foldername(name))[1] = public.auth_company_id()::text
)
WITH CHECK (
  bucket_id IN ('avatars','documents')
  AND (storage.foldername(name))[1] = public.auth_company_id()::text
);

CREATE POLICY storage_tenant_delete ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id IN ('avatars','documents')
  AND (storage.foldername(name))[1] = public.auth_company_id()::text
);

COMMIT;
