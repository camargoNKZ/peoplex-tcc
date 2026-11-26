const db = require('../config/db');
const emailSvc = require('./emailService');

const POLL_BATCH_SIZE = 20;
const BASE_BACKOFF_SECONDS = 15;
const MAX_BACKOFF_SECONDS = 120;
const SEND_TIMEOUT_MS = 8000;
const CLAIM_RESERVATION_SECONDS = 90;

function withTimeout(promise, ms, message) {
  let timer;
  promise.catch(() => {}); // evita unhandled rejection se resolver depois do timeout
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Uma linha por destinatário -- nunca manda vários e-mails como um único
// envio com todo mundo no To:. Antes disso, um "notificar por e-mail" de
// comunicado ou um broadcast do Control Center virava UMA linha com o
// array inteiro de destinatários, e enviarEmail() juntava todos num só
// cabeçalho To:, expondo o e-mail de cada pessoa pra todas as outras.
async function enqueueEmail({ companyId, to, subject, html, relatedType, relatedId }) {
  const recipients = Array.isArray(to) ? to : [to];
  const result = await db.query(
    `INSERT INTO message_queue (company_id, to_email, subject, html, related_type, related_id)
     SELECT $1, ARRAY[email], $3, $4, $5, $6
       FROM UNNEST($2::text[]) AS email
     RETURNING id`,
    [companyId, recipients, subject, html, relatedType || null, relatedId || null]
  );
  return result.rows.map(row => row.id);
}

// Reivindica um lote de mensagens prontas pra tentar, marcando-as como
// processing na mesma query pra que dois workers concorrentes (ex.:
// instância serverless quente + processo local) nunca peguem a mesma linha
// duas vezes. Também reivindica linhas que ficaram presas em "processing"
// além da janela de reserva (CLAIM_RESERVATION_SECONDS) — sinal de que um
// worker anterior travou ou foi cortado no meio do envio (ex.: SMTP sem
// resposta e função serverless encerrada por timeout) — evitando que uma
// mensagem fique presa pra sempre.
async function claimBatch(limit) {
  const result = await db.query(
    `UPDATE message_queue
        SET status = 'processing',
            next_attempt_at = NOW() + ($2 || ' seconds')::interval
      WHERE id IN (
        SELECT id FROM message_queue
         WHERE status IN ('pending', 'processing') AND next_attempt_at <= NOW()
         ORDER BY created_at ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED
      )
      RETURNING *`,
    [limit, CLAIM_RESERVATION_SECONDS]
  );
  return result.rows;
}

async function markSent(id) {
  await db.query(
    `UPDATE message_queue SET status='sent', sent_at=NOW(), attempts=attempts+1, last_error=NULL WHERE id=$1`,
    [id]
  );
}

async function markFailedOrRetry(row, error) {
  const attempts = row.attempts + 1;
  const exhausted = attempts >= row.max_attempts;
  const backoff = Math.min(BASE_BACKOFF_SECONDS * attempts, MAX_BACKOFF_SECONDS);
  await db.query(
    `UPDATE message_queue
        SET attempts = $2,
            status = $3,
            last_error = $4,
            next_attempt_at = NOW() + ($5 || ' seconds')::interval
      WHERE id = $1`,
    [row.id, attempts, exhausted ? 'failed' : 'pending', String(error?.message || error || 'erro desconhecido').slice(0, 500), backoff]
  );
  return exhausted;
}

async function syncEmailLog(row, { status, providerId }) {
  if (row.related_type !== 'email_log' || !row.related_id) return;
  await db.query(
    `UPDATE email_logs SET status=$1, provider_id=COALESCE($2, provider_id), sent_at=CASE WHEN $1='sent' THEN NOW() ELSE sent_at END
      WHERE id=$3 AND company_id=$4`,
    [status, providerId || null, row.related_id, row.company_id]
  ).catch(error => console.warn('[Queue] falha ao sincronizar email_logs', error.message));
}

// Processa um lote da fila. Chamado pelo worker local (setInterval a cada
// 5s) e pelo endpoint /internal/queue/process (Vercel Cron em produção).
async function processPendingQueue() {
  const batch = await claimBatch(POLL_BATCH_SIZE);
  const summary = { processed: batch.length, sent: 0, retrying: 0, failed: 0 };
  for (const row of batch) {
    try {
      const info = await withTimeout(
        emailSvc.enviarEmail({ companyId: row.company_id, to: row.to_email, subject: row.subject, html: row.html }),
        SEND_TIMEOUT_MS,
        'Tempo esgotado ao enviar e-mail (SMTP não respondeu)'
      );
      await markSent(row.id);
      await syncEmailLog(row, { status: 'sent', providerId: info?.messageId });
      summary.sent++;
    } catch (error) {
      const exhausted = await markFailedOrRetry(row, error);
      if (exhausted) {
        await syncEmailLog(row, { status: 'failed' });
        summary.failed++;
      } else {
        summary.retrying++;
      }
    }
  }
  return summary;
}

module.exports = { enqueueEmail, processPendingQueue };
