const db       = require('../config/db');
const emailSvc = require('../services/emailService');
const queueService = require('../services/queueService');

async function broadcast(req, res) {
  const { companyId, userId } = req;
  if (!req.isOwner) return res.status(403).json({ error: 'Acesso restrito ao dono da conta.' });

  const { subject, body, target } = req.body;
  if (!subject || !body) return res.status(400).json({ error: 'Assunto e mensagem obrigatórios.' });
  if (String(subject).length > 160 || String(body).length > 20000) {
    return res.status(400).json({ error: 'Assunto ou mensagem excede o limite permitido.' });
  }

  try {
    let query  = 'SELECT email,name FROM users WHERE company_id=$1 AND active=true';
    const params = [companyId];

    const groupMatch = typeof target === 'string' && target.match(/^group:(\d+)$/);
    if (groupMatch) { query += ' AND access_group_id=$2'; params.push(Number(groupMatch[1])); }
    else if (target && target.includes('@')) {
      query  = 'SELECT email,name FROM users WHERE company_id=$1 AND email=$2';
      params.push(target);
    }

    const dest = await db.query(query, params);
    if (!dest.rows.length) return res.status(404).json({ error: 'Nenhum destinatário encontrado.' });

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;">
        <div style="background:white;border-radius:16px;padding:32px;border:1px solid #e2e8f0;">
          <h1 style="color:#1e293b;font-size:20px;font-weight:600;margin:0 0 20px;">${emailSvc.escapeHtml(subject)}</h1>
          <div style="color:#334155;font-size:15px;line-height:1.7;white-space:pre-wrap;">${emailSvc.escapeHtml(body)}</div>
          <p style="color:#94a3b8;font-size:12px;margin:24px 0 0;border-top:1px solid #f1f5f9;padding-top:16px;">
            peopleX — e-mail corporativo
          </p>
        </div>
      </div>`;

    const log = await db.query(
      `INSERT INTO email_logs (company_id,sender_id,recipients,subject,body,status)
       VALUES ($1,$2,$3,$4,$5,'queued') RETURNING id`,
      [companyId, userId, JSON.stringify(dest.rows.map(u => u.email)), subject, body]
    );

    await queueService.enqueueEmail({
      companyId,
      to: dest.rows.map(u => u.email),
      subject: `[peopleX] ${subject}`,
      html,
      relatedType: 'email_log',
      relatedId: log.rows[0].id,
    });
    // Em serverless não existe segundo plano garantido após a resposta
    // (ver server.js), então processamos aqui mesmo, antes de responder.
    await queueService.processPendingQueue().catch(error => console.warn('[Queue]', error.message));

    res.json({ ok: true, enviados: dest.rows.length });
  } catch (err) {
    console.error('[Email broadcast]', err);
    res.status(500).json({ error: 'Falha ao enviar. Verifique as configurações SMTP no .env' });
  }
}

async function logs(req, res) {
  const { companyId } = req;
  if (!req.isOwner) return res.status(403).json({ error: 'Acesso restrito ao dono da conta.' });
  try {
    const r = await db.query(
      `SELECT el.id,el.subject,el.recipients,el.status,el.sent_at, u.name AS enviado_por
       FROM email_logs el JOIN users u ON u.id=el.sender_id
       WHERE el.company_id=$1 ORDER BY el.sent_at DESC LIMIT 50`,
      [companyId]
    );
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: 'Erro interno.' }); }
}

module.exports = { broadcast, logs };
