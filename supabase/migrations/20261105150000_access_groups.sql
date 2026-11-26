BEGIN;

-- Substitui o papel fixo (owner/admin/hr/manager/employee) por grupos de
-- acesso configuráveis pelo RH, com uma matriz de permissões por ação
-- (view_all/create/edit/delete/approve) em vez de um nível hierárquico
-- único. is_owner é a única coisa que continua fixa: exatamente 1 pessoa
-- por empresa, sempre com acesso total, não depende de grupo -- rede de
-- segurança para a empresa nunca ficar sem ninguém capaz de gerenciar
-- grupos/pessoas.

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_owner BOOLEAN NOT NULL DEFAULT false;

-- Promove quem já é 'owner' hoje. Se por algum motivo uma empresa não tiver
-- ninguém com role='owner' (não deveria acontecer, mas não custa garantir),
-- promove o colaborador ativo mais antigo dela.
UPDATE users u SET is_owner = true
  WHERE u.role = 'owner'
    AND u.id = (
      SELECT id FROM users u2
       WHERE u2.company_id = u.company_id AND u2.role = 'owner'
       ORDER BY u2.created_at ASC LIMIT 1
    );

UPDATE users u SET is_owner = true
  WHERE u.id = (
    SELECT id FROM users u2
     WHERE u2.company_id = u.company_id AND u2.active = true
     ORDER BY CASE u2.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'hr' THEN 2 WHEN 'manager' THEN 3 ELSE 4 END,
              u2.created_at ASC
     LIMIT 1
  )
  AND NOT EXISTS (SELECT 1 FROM users u3 WHERE u3.company_id = u.company_id AND u3.is_owner = true);

CREATE UNIQUE INDEX IF NOT EXISTS users_one_owner_per_company
  ON users (company_id) WHERE is_owner = true;

CREATE TABLE IF NOT EXISTS access_groups (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name VARCHAR(80) NOT NULL,
  permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, name), UNIQUE (id, company_id)
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS access_group_id BIGINT;

DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_access_group_tenant_fk
    FOREIGN KEY (access_group_id, company_id) REFERENCES access_groups(id, company_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS users_access_group_idx ON users (access_group_id);

ALTER TABLE access_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_select ON access_groups;
DROP POLICY IF EXISTS tenant_isolation_insert ON access_groups;
DROP POLICY IF EXISTS tenant_isolation_update ON access_groups;

CREATE POLICY tenant_isolation_select ON access_groups FOR SELECT TO authenticated
  USING (company_id = private.auth_company_id());
CREATE POLICY tenant_isolation_insert ON access_groups FOR INSERT TO authenticated
  WITH CHECK (company_id = private.auth_company_id());
CREATE POLICY tenant_isolation_update ON access_groups FOR UPDATE TO authenticated
  USING (company_id = private.auth_company_id()) WITH CHECK (company_id = private.auth_company_id());

COMMIT;
