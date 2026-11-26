BEGIN;

-- Fila real de e-mails assíncronos: avisos, mudança de status de
-- solicitação e disparos em massa passam a ser enfileirados aqui em vez de
-- serem enviados diretamente (fire-and-forget) pelo controller. Um worker
-- (setInterval local/dev a cada 5s, ou o endpoint /internal/queue/process
-- via Vercel Cron em produção) processa a fila e faz até max_attempts
-- tentativas, com backoff, antes de marcar como failed.
CREATE TABLE IF NOT EXISTS message_queue (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  to_email TEXT[] NOT NULL,
  subject VARCHAR(200) NOT NULL,
  html TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 3,
  last_error TEXT,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  related_type VARCHAR(30),
  related_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  CONSTRAINT message_queue_status_check CHECK (status IN ('pending','processing','sent','failed'))
);

CREATE INDEX IF NOT EXISTS message_queue_due_idx
  ON message_queue (next_attempt_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS message_queue_company_idx
  ON message_queue (company_id, created_at DESC);

ALTER TABLE message_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_select ON message_queue;
DROP POLICY IF EXISTS tenant_isolation_insert ON message_queue;
DROP POLICY IF EXISTS tenant_isolation_update ON message_queue;

CREATE POLICY tenant_isolation_select ON message_queue FOR SELECT TO authenticated
  USING (company_id = private.auth_company_id());
CREATE POLICY tenant_isolation_insert ON message_queue FOR INSERT TO authenticated
  WITH CHECK (company_id = private.auth_company_id());
CREATE POLICY tenant_isolation_update ON message_queue FOR UPDATE TO authenticated
  USING (company_id = private.auth_company_id()) WITH CHECK (company_id = private.auth_company_id());

COMMIT;
