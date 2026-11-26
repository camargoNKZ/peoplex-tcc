-- peopleX — PostgreSQL schema v2
-- Multi-tenant by design: every business table carries company_id and uses
-- composite foreign keys to prevent references across tenants.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE IF NOT EXISTS companies (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  slug VARCHAR(80) NOT NULL UNIQUE,
  legal_name VARCHAR(200),
  tax_id VARCHAR(14),
  logo_url TEXT,
  plan VARCHAR(30) NOT NULL DEFAULT 'starter',
  timezone VARCHAR(60) NOT NULL DEFAULT 'America/Sao_Paulo',
  locale VARCHAR(10) NOT NULL DEFAULT 'pt-BR',
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT companies_plan_check CHECK (plan IN ('starter','growth','enterprise'))
);

CREATE TABLE IF NOT EXISTS departments (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  cost_center VARCHAR(40),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, name), UNIQUE (id, company_id)
);

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  department_id BIGINT,
  manager_id BIGINT,
  auth_user_id UUID,
  name VARCHAR(160) NOT NULL,
  email CITEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role VARCHAR(30) NOT NULL DEFAULT 'employee',
  job_title VARCHAR(120),
  phone VARCHAR(30),
  cpf VARCHAR(11),
  rg VARCHAR(30),
  birth_date DATE,
  hire_date DATE,
  photo_url TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, email), UNIQUE (id, company_id),
  CONSTRAINT users_role_check CHECK (role IN ('owner','admin','hr','manager','employee')),
  CONSTRAINT users_department_tenant_fk FOREIGN KEY (department_id, company_id)
    REFERENCES departments(id, company_id)
);

DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_manager_tenant_fk
    FOREIGN KEY (manager_id, company_id) REFERENCES users(id, company_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS users_company_cpf_unique ON users(company_id, cpf) WHERE cpf IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_auth_user_unique ON users(auth_user_id) WHERE auth_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS request_types (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  description TEXT,
  sla_hours INTEGER NOT NULL DEFAULT 72,
  requires_attachment BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, name), UNIQUE (id, company_id),
  CONSTRAINT request_type_sla_check CHECK (sla_hours > 0)
);

CREATE TABLE IF NOT EXISTS requests (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL,
  request_type_id BIGINT NOT NULL,
  assigned_to BIGINT,
  status VARCHAR(30) NOT NULL DEFAULT 'pending',
  priority VARCHAR(20) NOT NULL DEFAULT 'normal',
  description TEXT,
  resolution_note TEXT,
  due_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  UNIQUE (id, company_id),
  CONSTRAINT requests_status_check CHECK (status IN ('pending','in_review','approved','rejected','cancelled')),
  CONSTRAINT requests_priority_check CHECK (priority IN ('low','normal','high','urgent')),
  CONSTRAINT requests_user_tenant_fk FOREIGN KEY (user_id, company_id) REFERENCES users(id, company_id) ON DELETE CASCADE,
  CONSTRAINT requests_type_tenant_fk FOREIGN KEY (request_type_id, company_id) REFERENCES request_types(id, company_id),
  CONSTRAINT requests_assignee_tenant_fk FOREIGN KEY (assigned_to, company_id) REFERENCES users(id, company_id)
);

CREATE TABLE IF NOT EXISTS request_events (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  request_id BIGINT NOT NULL,
  actor_id BIGINT,
  event_type VARCHAR(40) NOT NULL,
  from_status VARCHAR(30),
  to_status VARCHAR(30),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT request_events_request_tenant_fk FOREIGN KEY (request_id, company_id) REFERENCES requests(id, company_id) ON DELETE CASCADE,
  CONSTRAINT request_events_actor_tenant_fk FOREIGN KEY (actor_id, company_id) REFERENCES users(id, company_id)
);

CREATE TABLE IF NOT EXISTS notices (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  author_id BIGINT NOT NULL,
  title VARCHAR(180) NOT NULL,
  content TEXT NOT NULL,
  priority VARCHAR(20) NOT NULL DEFAULT 'normal',
  audience JSONB NOT NULL DEFAULT '{"type":"all"}'::jsonb,
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, company_id),
  CONSTRAINT notices_priority_check CHECK (priority IN ('normal','important','urgent')),
  CONSTRAINT notices_author_tenant_fk FOREIGN KEY (author_id, company_id) REFERENCES users(id, company_id)
);

CREATE TABLE IF NOT EXISTS notice_reads (
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  notice_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (notice_id, user_id),
  CONSTRAINT notice_reads_notice_tenant_fk FOREIGN KEY (notice_id, company_id) REFERENCES notices(id, company_id) ON DELETE CASCADE,
  CONSTRAINT notice_reads_user_tenant_fk FOREIGN KEY (user_id, company_id) REFERENCES users(id, company_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_documents (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL,
  type VARCHAR(60) NOT NULL,
  file_url TEXT NOT NULL,
  file_name TEXT,
  mime_type VARCHAR(120),
  size_bytes BIGINT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  validated_by BIGINT,
  validated_at TIMESTAMPTZ,
  rejection_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, company_id),
  CONSTRAINT documents_status_check CHECK (status IN ('pending','approved','rejected')),
  CONSTRAINT documents_user_tenant_fk FOREIGN KEY (user_id, company_id) REFERENCES users(id, company_id) ON DELETE CASCADE,
  CONSTRAINT documents_validator_tenant_fk FOREIGN KEY (validated_by, company_id) REFERENCES users(id, company_id)
);

CREATE TABLE IF NOT EXISTS conversations (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  type VARCHAR(20) NOT NULL DEFAULT 'direct',
  name VARCHAR(160),
  description TEXT,
  created_by BIGINT NOT NULL,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, company_id),
  CONSTRAINT conversations_type_check CHECK (type IN ('direct','group','announcement')),
  CONSTRAINT conversations_creator_tenant_fk FOREIGN KEY (created_by, company_id) REFERENCES users(id, company_id)
);

CREATE TABLE IF NOT EXISTS conversation_members (
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  conversation_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  member_role VARCHAR(20) NOT NULL DEFAULT 'member',
  muted_until TIMESTAMPTZ,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (conversation_id, user_id),
  CONSTRAINT conversation_members_role_check CHECK (member_role IN ('owner','admin','member')),
  CONSTRAINT conversation_members_conversation_tenant_fk FOREIGN KEY (conversation_id, company_id) REFERENCES conversations(id, company_id) ON DELETE CASCADE,
  CONSTRAINT conversation_members_user_tenant_fk FOREIGN KEY (user_id, company_id) REFERENCES users(id, company_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS messages (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  conversation_id BIGINT NOT NULL,
  sender_id BIGINT NOT NULL,
  reply_to_id BIGINT,
  body TEXT NOT NULL DEFAULT '',
  message_type VARCHAR(20) NOT NULL DEFAULT 'text',
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  edited_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, company_id),
  CONSTRAINT messages_type_check CHECK (message_type IN ('text','file','system')),
  CONSTRAINT messages_conversation_tenant_fk FOREIGN KEY (conversation_id, company_id) REFERENCES conversations(id, company_id) ON DELETE CASCADE,
  CONSTRAINT messages_sender_tenant_fk FOREIGN KEY (sender_id, company_id) REFERENCES users(id, company_id),
  CONSTRAINT messages_reply_tenant_fk FOREIGN KEY (reply_to_id, company_id) REFERENCES messages(id, company_id)
);

CREATE TABLE IF NOT EXISTS message_reads (
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  message_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, user_id),
  CONSTRAINT message_reads_message_tenant_fk FOREIGN KEY (message_id, company_id) REFERENCES messages(id, company_id) ON DELETE CASCADE,
  CONSTRAINT message_reads_user_tenant_fk FOREIGN KEY (user_id, company_id) REFERENCES users(id, company_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS email_logs (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  sender_id BIGINT NOT NULL,
  recipients JSONB NOT NULL DEFAULT '[]'::jsonb,
  subject VARCHAR(200) NOT NULL,
  body TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'sent',
  provider_id TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT email_logs_status_check CHECK (status IN ('queued','sent','failed')),
  CONSTRAINT email_logs_sender_tenant_fk FOREIGN KEY (sender_id, company_id) REFERENCES users(id, company_id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  actor_id BIGINT,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(80) NOT NULL,
  entity_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT audit_actor_tenant_fk FOREIGN KEY (actor_id, company_id) REFERENCES users(id, company_id)
);

CREATE INDEX IF NOT EXISTS users_company_active_idx ON users(company_id, active);
CREATE INDEX IF NOT EXISTS requests_company_status_idx ON requests(company_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS notices_company_active_idx ON notices(company_id, active, published_at DESC);
CREATE INDEX IF NOT EXISTS conversations_company_idx ON conversations(company_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS conversation_members_user_idx ON conversation_members(company_id, user_id);
CREATE INDEX IF NOT EXISTS messages_conversation_idx ON messages(company_id, conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS message_reads_user_idx ON message_reads(company_id, user_id);
CREATE INDEX IF NOT EXISTS audit_company_created_idx ON audit_logs(company_id, created_at DESC);

CREATE OR REPLACE FUNCTION set_tenant_context(p_company_id BIGINT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('app.company_id', p_company_id::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION current_tenant_id()
RETURNS BIGINT LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.company_id', true), '')::BIGINT;
$$;

-- Estrutura inicial sem empresas, usuários ou senhas pré-cadastrados.
COMMIT;
