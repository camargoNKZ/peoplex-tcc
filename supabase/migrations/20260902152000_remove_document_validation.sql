BEGIN;

ALTER TABLE public.user_documents
  DROP CONSTRAINT IF EXISTS documents_validator_tenant_fk,
  DROP CONSTRAINT IF EXISTS documents_status_check,
  DROP COLUMN IF EXISTS validated_by,
  DROP COLUMN IF EXISTS validated_at,
  DROP COLUMN IF EXISTS rejection_note,
  DROP COLUMN IF EXISTS status;

COMMIT;
