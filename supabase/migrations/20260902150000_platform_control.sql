BEGIN;

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS user_limit INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS features JSONB NOT NULL DEFAULT '{"messaging":true,"requests":true,"notices":true,"analytics":true,"documents":true,"onboarding":true}'::jsonb,
  ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ;

DO $$ BEGIN
  ALTER TABLE public.companies ADD CONSTRAINT companies_user_limit_check CHECK (user_limit > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

UPDATE public.companies
SET features = '{"messaging":true,"requests":true,"notices":true,"analytics":true,"documents":true,"onboarding":true}'::jsonb
WHERE features = '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.platform_admins (
  id BIGSERIAL PRIMARY KEY,
  auth_user_id UUID NOT NULL UNIQUE,
  email extensions.citext NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.platform_audit_logs (
  id BIGSERIAL PRIMARY KEY,
  admin_id BIGINT REFERENCES public.platform_admins(id),
  action VARCHAR(100) NOT NULL,
  tenant_id BIGINT REFERENCES public.companies(id),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS platform_audit_created_idx ON public.platform_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS companies_active_plan_idx ON public.companies(active, plan);

ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_audit_logs ENABLE ROW LEVEL SECURITY;

COMMIT;
