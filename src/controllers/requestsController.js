const db = require('../config/db');
const emailSvc = require('../services/emailService');
const queueService = require('../services/queueService');
const { canTransitionRequest } = require('../policies/access');
const { hasPermission } = require('../policies/permissions');

const requestSelect = `
  SELECT r.id, u.name AS funcionario, rt.name AS tipo,
         r.status, r.description, r.resolution_note, r.priority,
         r.due_at, r.created_at, r.updated_at,
         CASE
           WHEN r.status IN ('approved','rejected','cancelled') THEN 'Concluída'
           WHEN r.due_at IS NULL THEN 'Sem SLA'
           WHEN r.due_at < NOW() THEN 'SLA vencido'
           ELSE CEIL(EXTRACT(EPOCH FROM (r.due_at-NOW()))/3600)::int || 'h restantes'
         END AS sla
    FROM requests r
    JOIN users u ON u.id=r.user_id AND u.company_id=r.company_id
    JOIN request_types rt ON rt.id=r.request_type_id AND rt.company_id=r.company_id`;

async function listar(req, res) {
  const { companyId, userId } = req;
  try {
    const params = [companyId];
    const canViewAll = hasPermission(req, 'requests', 'view_all');
    const ownerFilter = canViewAll ? '' : ' AND r.user_id=$2';
    if (!canViewAll) params.push(userId);
    const result = await db.query(
      `${requestSelect} WHERE r.company_id=$1${ownerFilter} ORDER BY r.created_at DESC`,
      params
    );
    res.json(result.rows);
  } catch (error) {
    console.error('[Requests listar]', error);
    res.status(500).json({ error: 'Erro interno.' });
  }
}

async function criar(req, res) {
  const { companyId, userId } = req;
  if (!hasPermission(req, 'requests', 'create'))
    return res.status(403).json({ error: 'Você não tem permissão para criar solicitações.' });
  const requestTypeId = Number(req.body.requestTypeId);
  const description = String(req.body.description || '').trim();
  if (!Number.isInteger(requestTypeId))
    return res.status(400).json({ error: 'Tipo de solicitação obrigatório.' });
  if (description.length > 5000)
    return res.status(400).json({ error: 'A descrição deve ter no máximo 5.000 caracteres.' });

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const type = await client.query(
      `SELECT id,sla_hours FROM request_types
        WHERE id=$1 AND company_id=$2 AND active=true`,
      [requestTypeId, companyId]
    );
    if (!type.rows[0]) throw Object.assign(new Error('Tipo de solicitação inválido.'), { status: 400 });
    const result = await client.query(
      `INSERT INTO requests (company_id,user_id,request_type_id,description,due_at)
       VALUES ($1,$2,$3,$4,NOW()+make_interval(hours => $5)) RETURNING *`,
      [companyId, userId, requestTypeId, description || null, type.rows[0].sla_hours]
    );
    await client.query(
      `INSERT INTO request_events (company_id,request_id,actor_id,event_type,to_status)
       VALUES ($1,$2,$3,'created','pending')`,
      [companyId, result.rows[0].id, userId]
    );
    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error('[Requests criar]', error);
    res.status(500).json({ error: 'Erro interno.' });
  } finally {
    client.release();
  }
}

async function atualizarStatus(req, res) {
  const { companyId, userId } = req;
  const id = Number(req.params.id);
  const { status, resolutionNote } = req.body;
  if (!hasPermission(req, 'requests', 'approve') || !hasPermission(req, 'requests', 'view_all'))
    return res.status(403).json({ error: 'Você não tem permissão para gerenciar solicitações.' });
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Solicitação inválida.' });
  if (!['in_review','approved','rejected','cancelled'].includes(status))
    return res.status(400).json({ error: 'Status inválido.' });
  if (resolutionNote && String(resolutionNote).length > 5000)
    return res.status(400).json({ error: 'A observação deve ter no máximo 5.000 caracteres.' });

  const client = await db.connect();
  let updated;
  try {
    await client.query('BEGIN');
    const current = await client.query(
      'SELECT id,user_id,status FROM requests WHERE id=$1 AND company_id=$2 FOR UPDATE',
      [id, companyId]
    );
    if (!current.rows[0]) throw Object.assign(new Error('Solicitação não encontrada.'), { status: 404 });
    // O dono da conta pode aprovar a própria -- numa empresa pequena ele
    // pode ser o único com permissão de aprovar, e bloquear isso travaria
    // a própria solicitação de férias dele, por exemplo.
    if (!req.isOwner && Number(current.rows[0].user_id) === Number(userId))
      throw Object.assign(new Error('Você não pode aprovar/alterar sua própria solicitação.'), { status: 403 });
    if (!canTransitionRequest(current.rows[0].status, status))
      throw Object.assign(new Error(`Não é possível alterar de ${current.rows[0].status} para ${status}.`), { status: 409 });

    const result = await client.query(
      `UPDATE requests SET status=$1::varchar,resolution_note=COALESCE($2::text,resolution_note),updated_at=NOW(),
         closed_at=CASE WHEN $1::varchar IN ('approved','rejected','cancelled') THEN NOW() ELSE NULL END
       WHERE id=$3::bigint AND company_id=$4::bigint RETURNING *`,
      [status, resolutionNote || null, id, companyId]
    );
    updated = result.rows[0];
    await client.query(
      `INSERT INTO request_events
        (company_id,request_id,actor_id,event_type,from_status,to_status,note)
       VALUES ($1,$2,$3,'status_changed',$4,$5,$6)`,
      [companyId, id, userId, current.rows[0].status, status, resolutionNote || null]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error('[Requests atualizarStatus]', error);
    return res.status(500).json({ error: 'Erro interno.' });
  } finally {
    client.release();
  }

  // Em serverless não existe segundo plano garantido após a resposta (ver
  // server.js), então enfileiramos e processamos aqui mesmo, antes de
  // responder. Falha na notificação não deve derrubar a resposta: a
  // mudança de status já foi commitada acima.
  try {
    const { rows } = await db.query(
      `SELECT u.email,u.name,rt.name AS tipo
         FROM requests req
         JOIN users u ON u.id=req.user_id AND u.company_id=req.company_id
         JOIN request_types rt ON rt.id=req.request_type_id AND rt.company_id=req.company_id
        WHERE req.id=$1 AND req.company_id=$2`,
      [id, companyId]
    );
    if (rows.length) {
      const { email, name, tipo } = rows[0];
      const html = emailSvc.templateStatusSolicitacao({ nome: name, tipo, status });
      const statusLabel = { in_review: 'em análise', approved: 'aprovada', rejected: 'rejeitada', cancelled: 'cancelada' }[status];
      const subject = `[peopleX] Solicitação de ${tipo} ${statusLabel}`;
      const log = await db.query(
        `INSERT INTO email_logs (company_id,sender_id,recipients,subject,body,status)
         VALUES ($1,$2,$3,$4,$5,'queued') RETURNING id`,
        [companyId, userId, JSON.stringify([email]), subject, html]
      );
      await queueService.enqueueEmail({
        companyId, to: email, subject, html,
        relatedType: 'email_log', relatedId: log.rows[0].id,
      });
      await queueService.processPendingQueue();
    }
  } catch (error) {
    console.warn('[Email status]', error.message);
  }

  res.json(updated);
}

// editar/excluir só valem enquanto a solicitação está pendente -- depois
// que o RH começou a tratar (in_review em diante), mexer destruiria o
// histórico que o SLA e os request_events dependem; a saída pra esse caso
// continua sendo "cancelar" via atualizarStatus.
async function editar(req, res) {
  const { companyId, userId } = req;
  const id = Number(req.params.id);
  const description = String(req.body.description || '').trim();
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Solicitação inválida.' });
  if (!hasPermission(req, 'requests', 'edit'))
    return res.status(403).json({ error: 'Você não tem permissão para editar solicitações.' });
  if (description.length > 5000)
    return res.status(400).json({ error: 'A descrição deve ter no máximo 5.000 caracteres.' });

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query(
      'SELECT id,user_id,status FROM requests WHERE id=$1 AND company_id=$2 FOR UPDATE',
      [id, companyId]
    );
    if (!current.rows[0]) throw Object.assign(new Error('Solicitação não encontrada.'), { status: 404 });
    const isOwnRequest = Number(current.rows[0].user_id) === Number(userId);
    if (!isOwnRequest && !hasPermission(req, 'requests', 'view_all'))
      throw Object.assign(new Error('Solicitação não encontrada.'), { status: 404 });
    if (current.rows[0].status !== 'pending')
      throw Object.assign(new Error('Só é possível editar enquanto a solicitação está pendente.'), { status: 409 });

    const result = await client.query(
      `UPDATE requests SET description=$1,updated_at=NOW() WHERE id=$2 AND company_id=$3 RETURNING *`,
      [description || null, id, companyId]
    );
    await client.query(
      `INSERT INTO request_events (company_id,request_id,actor_id,event_type) VALUES ($1,$2,$3,'edited')`,
      [companyId, id, userId]
    );
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error('[Requests editar]', error);
    res.status(500).json({ error: 'Erro interno.' });
  } finally {
    client.release();
  }
}

async function excluir(req, res) {
  const { companyId, userId } = req;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Solicitação inválida.' });
  if (!hasPermission(req, 'requests', 'delete'))
    return res.status(403).json({ error: 'Você não tem permissão para excluir solicitações.' });

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query(
      'SELECT id,user_id,status FROM requests WHERE id=$1 AND company_id=$2 FOR UPDATE',
      [id, companyId]
    );
    if (!current.rows[0]) throw Object.assign(new Error('Solicitação não encontrada.'), { status: 404 });
    const isOwnRequest = Number(current.rows[0].user_id) === Number(userId);
    if (!isOwnRequest && !hasPermission(req, 'requests', 'view_all'))
      throw Object.assign(new Error('Solicitação não encontrada.'), { status: 404 });
    if (current.rows[0].status !== 'pending')
      throw Object.assign(new Error('Só é possível excluir enquanto a solicitação está pendente.'), { status: 409 });

    // request_events cai junto via ON DELETE CASCADE (FK request_events_request_tenant_fk).
    await client.query('DELETE FROM requests WHERE id=$1 AND company_id=$2', [id, companyId]);
    await client.query('COMMIT');
    res.status(204).send();
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error('[Requests excluir]', error);
    res.status(500).json({ error: 'Erro interno.' });
  } finally {
    client.release();
  }
}

async function listarTipos(req, res) {
  try {
    const result = await db.query(
      'SELECT id,name,requires_attachment FROM request_types WHERE company_id=$1 AND active=true ORDER BY name',
      [req.companyId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('[Requests listarTipos]', error);
    res.status(500).json({ error: 'Erro interno.' });
  }
}

// Tela de gestão dos tipos (nome/SLA/anexo obrigatório) -- diferente de
// listarTipos acima, que só alimenta o dropdown de "Nova solicitação" e por
// isso só traz os ativos. Aqui precisa ver os inativos também, pra poder
// reativar.
async function listarTiposAdmin(req, res) {
  if (!hasPermission(req, 'request_types', 'create') && !hasPermission(req, 'request_types', 'edit') && !hasPermission(req, 'request_types', 'delete'))
    return res.status(403).json({ error: 'Você não tem permissão para ver os tipos de solicitação.' });
  try {
    const result = await db.query(
      'SELECT id,name,description,sla_hours,requires_attachment,active FROM request_types WHERE company_id=$1 ORDER BY active DESC, name',
      [req.companyId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('[Requests listarTiposAdmin]', error);
    res.status(500).json({ error: 'Erro interno.' });
  }
}

async function criarTipo(req, res) {
  if (!hasPermission(req, 'request_types', 'create'))
    return res.status(403).json({ error: 'Você não tem permissão para cadastrar tipos de solicitação.' });
  const name = String(req.body.name || '').trim();
  const slaHours = Number(req.body.sla_hours);
  const requiresAttachment = Boolean(req.body.requires_attachment);
  const description = req.body.description ? String(req.body.description).trim() : null;
  if (!name || name.length > 120) return res.status(400).json({ error: 'Nome é obrigatório e deve ter no máximo 120 caracteres.' });
  if (!Number.isInteger(slaHours) || slaHours <= 0) return res.status(400).json({ error: 'SLA deve ser um número de horas maior que zero.' });

  try {
    const r = await db.query(
      `INSERT INTO request_types (company_id,name,description,sla_hours,requires_attachment)
       VALUES ($1,$2,$3,$4,$5) RETURNING id,name,description,sla_hours,requires_attachment,active`,
      [req.companyId, name, description, slaHours, requiresAttachment]
    );
    res.status(201).json(r.rows[0]);
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Já existe um tipo de solicitação com esse nome.' });
    console.error('[Requests criarTipo]', error);
    res.status(500).json({ error: 'Erro interno.' });
  }
}

async function atualizarTipo(req, res) {
  if (!hasPermission(req, 'request_types', 'edit'))
    return res.status(403).json({ error: 'Você não tem permissão para editar tipos de solicitação.' });
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Tipo de solicitação inválido.' });
  const { name, description, sla_hours, requires_attachment, active } = req.body;
  if (name !== undefined && (!String(name).trim() || String(name).trim().length > 120))
    return res.status(400).json({ error: 'Nome inválido.' });
  if (sla_hours !== undefined && (!Number.isInteger(Number(sla_hours)) || Number(sla_hours) <= 0))
    return res.status(400).json({ error: 'SLA deve ser um número de horas maior que zero.' });

  const campos = [], vals = [];
  let i = 1;
  if (name !== undefined) { campos.push(`name=$${i++}`); vals.push(String(name).trim()); }
  if (description !== undefined) { campos.push(`description=$${i++}`); vals.push(description ? String(description).trim() : null); }
  if (sla_hours !== undefined) { campos.push(`sla_hours=$${i++}`); vals.push(Number(sla_hours)); }
  if (requires_attachment !== undefined) { campos.push(`requires_attachment=$${i++}`); vals.push(Boolean(requires_attachment)); }
  if (active !== undefined) { campos.push(`active=$${i++}`); vals.push(Boolean(active)); }
  if (!campos.length) return res.status(400).json({ error: 'Nenhum campo para atualizar.' });
  vals.push(id, req.companyId);

  try {
    const r = await db.query(
      `UPDATE request_types SET ${campos.join(',')} WHERE id=$${i++} AND company_id=$${i++}
       RETURNING id,name,description,sla_hours,requires_attachment,active`,
      vals
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Tipo de solicitação não encontrado.' });
    res.json(r.rows[0]);
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Já existe um tipo de solicitação com esse nome.' });
    console.error('[Requests atualizarTipo]', error);
    res.status(500).json({ error: 'Erro interno.' });
  }
}

async function excluirTipo(req, res) {
  if (!hasPermission(req, 'request_types', 'delete'))
    return res.status(403).json({ error: 'Você não tem permissão para excluir tipos de solicitação.' });
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Tipo de solicitação inválido.' });
  try {
    // Desativa em vez de apagar -- solicitações já criadas referenciam o
    // tipo (request_type_id é NOT NULL), apagar de verdade quebraria o
    // histórico delas.
    const r = await db.query(
      'UPDATE request_types SET active=false WHERE id=$1 AND company_id=$2 RETURNING id',
      [id, req.companyId]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Tipo de solicitação não encontrado.' });
    res.status(204).send();
  } catch (error) {
    console.error('[Requests excluirTipo]', error);
    res.status(500).json({ error: 'Erro interno.' });
  }
}

module.exports = { listar, criar, atualizarStatus, editar, excluir, listarTipos, listarTiposAdmin, criarTipo, atualizarTipo, excluirTipo };
