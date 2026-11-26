-- SMTP é um recurso da plataforma hoje (uma credencial global, inexistente
-- em produção). Cada empresa precisa poder configurar o próprio SMTP, pra
-- disparar e-mails pelo domínio dela, não pelo do peopleX.
CREATE TABLE company_email_settings (
  company_id bigint PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  smtp_host varchar(255) NOT NULL,
  smtp_port integer NOT NULL,
  smtp_secure boolean NOT NULL DEFAULT false,
  smtp_user varchar(255) NOT NULL,
  smtp_pass_encrypted text NOT NULL,
  from_name varchar(120) NOT NULL,
  from_email varchar(255) NOT NULL,
  updated_by bigint REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

ALTER TABLE company_email_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON company_email_settings
  FOR SELECT USING (company_id = private.auth_company_id());
CREATE POLICY tenant_isolation_insert ON company_email_settings
  FOR INSERT WITH CHECK (company_id = private.auth_company_id());
CREATE POLICY tenant_isolation_update ON company_email_settings
  FOR UPDATE USING (company_id = private.auth_company_id());
CREATE POLICY tenant_isolation_delete ON company_email_settings
  FOR DELETE USING (company_id = private.auth_company_id());
