const db       = require('../config/db');
const emailSvc = require('../services/emailService');
const queueService = require('../services/queueService');
const { hasPermission } = require('../policies/permissions');

async function listar(req, res) {
  const { companyId, userId } = req;
  try {
    const r = await db.query(
      `SELECT n.id,n.title,n.content,n.priority,n.created_at,u.name AS autor,
              EXISTS (SELECT 1 FROM notice_reads mine
                       WHERE mine.company_id=n.company_id AND mine.notice_id=n.id AND mine.user_id=$2) AS is_read,
              COALESCE(ROUND(100.0*(SELECT COUNT(*) FROM notice_reads nr
                                    WHERE nr.company_id=n.company_id AND nr.notice_id=n.id)
                / NULLIF((SELECT COUNT(*) FROM users active
                           WHERE active.company_id=n.company_id AND active.active=true),0)),0)::int AS read_rate
       FROM notices n JOIN users u ON u.id=n.author_id AND u.company_id=n.company_id
       WHERE n.company_id=$1 AND n.active=true
       ORDER BY CASE n.priority WHEN 'urgent' THEN 1 WHEN 'important' THEN 2 ELSE 3 END,
                n.created_at DESC`,
      [companyId, userId]
    );
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: 'Erro interno.' }); }
}

async function markRead(req, res) {
  const ids = [...new Set((Array.isArray(req.body.ids) ? req.body.ids : []).map(Number)
    .filter(id => Number.isInteger(id) && id > 0))].slice(0, 100);
  if (!ids.length) return res.status(204).send();
  try {
    await db.query(
      `INSERT INTO notice_reads (company_id,notice_id,user_id)
       SELECT n.company_id,n.id,$3 FROM notices n
        WHERE n.company_id=$1 AND n.active=true AND n.id=ANY($2::bigint[])
       ON CONFLICT DO NOTHING`,
      [req.companyId, ids, req.userId]
    );
    res.status(204).send();
  } catch (error) {
    console.error('[Notices markRead]', error);
    res.status(500).json({ error: 'Não foi possível registrar a leitura.' });
  }
}

async function criar(req, res) {
  const { companyId, userId } = req;
  if (!hasPermission(req, 'notices', 'create')) return res.status(403).json({ error: 'Você não tem permissão para criar comunicados.' });

  const { title, content, priority = 'normal', notifyByEmail = false } = req.body;
  if (!title || !content) return res.status(400).json({ error: 'Título e conteúdo obrigatórios.' });
  if (!['normal','important','urgent'].includes(priority))
    return res.status(400).json({ error: 'Prioridade inválida.' });
  if (String(title).trim().length > 180 || String(content).trim().length > 10000)
    return res.status(400).json({ error: 'Comunicado excede o tamanho permitido.' });

  try {
    const r = await db.query(
      'INSERT INTO notices (company_id,author_id,title,content,priority) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [companyId, userId, title, content, priority]
    );

    if (notifyByEmail) {
      const emails = await db.query(
        'SELECT email FROM users WHERE company_id=$1 AND active=true', [companyId]
      );
      const autor = await db.query('SELECT name FROM users WHERE id=$1 AND company_id=$2', [userId, companyId]);
      const html  = emailSvc.templateAviso({
        titulo: title, conteudo: content, prioridade: priority,
        autor: autor.rows[0]?.name || 'RH',
      });
      const log = await db.query(
        `INSERT INTO email_logs (company_id,sender_id,recipients,subject,body,status)
         VALUES ($1,$2,$3,$4,$5,'queued') RETURNING id`,
        [companyId, userId, JSON.stringify(emails.rows.map(u => u.email)), title, content]
      );
      await queueService.enqueueEmail({
        companyId,
        to: emails.rows.map(u => u.email),
        subject: `[peopleX] ${title}`,
        html,
        relatedType: 'email_log',
        relatedId: log.rows[0].id,
      });
      // Em serverless não existe segundo plano garantido após a resposta
      // (ver server.js), então processamos aqui mesmo, antes de responder.
      await queueService.processPendingQueue().catch(error => console.warn('[Queue]', error.message));
    }

    res.status(201).json(r.rows[0]);
  } catch (err) {
    console.error('[Notices criar]', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
}

async function remover(req, res) {
  const { companyId } = req;
  if (!hasPermission(req, 'notices', 'delete')) return res.status(403).json({ error: 'Você não tem permissão para excluir comunicados.' });
  try {
    const r = await db.query(
      'UPDATE notices SET active=false WHERE id=$1 AND company_id=$2 AND active=true RETURNING id',
      [req.params.id, companyId]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Comunicado não encontrado.' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Erro interno.' }); }
}

async function editar(req, res) {
  const { companyId } = req;
  if (!hasPermission(req, 'notices', 'edit')) return res.status(403).json({ error: 'Você não tem permissão para editar comunicados.' });

  const { title, content, priority } = req.body;
  if (priority !== undefined && !['normal','important','urgent'].includes(priority))
    return res.status(400).json({ error: 'Prioridade inválida.' });
  if (title !== undefined && String(title).trim().length > 180)
    return res.status(400).json({ error: 'Título excede o tamanho permitido.' });
  if (content !== undefined && String(content).trim().length > 10000)
    return res.status(400).json({ error: 'Conteúdo excede o tamanho permitido.' });

  try {
    const r = await db.query(
      `UPDATE notices SET
         title=COALESCE($1,title), content=COALESCE($2,content), priority=COALESCE($3,priority), updated_at=NOW()
       WHERE id=$4 AND company_id=$5 AND active=true RETURNING *`,
      [title?.trim() || null, content?.trim() || null, priority || null, req.params.id, companyId]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Comunicado não encontrado.' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error('[Notices editar]', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
}

module.exports = { listar, criar, editar, remover, markRead };
