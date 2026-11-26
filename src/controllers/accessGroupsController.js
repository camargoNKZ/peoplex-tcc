const db = require('../config/db');
const { RESOURCES, hasPermission, exceedsOwnCeiling } = require('../policies/permissions');

function normalizePermissions(input = {}) {
  const out = {};
  for (const resource of Object.keys(RESOURCES)) {
    if (!input[resource] || typeof input[resource] !== 'object') continue;
    out[resource] = {};
    for (const action of Object.keys(RESOURCES[resource])) {
      if (typeof input[resource][action] === 'boolean') out[resource][action] = input[resource][action];
    }
  }
  return out;
}

// Dono vê pra gerenciar; quem tem permissão de criar grupo ou de cadastrar
// usuário também precisa listar -- o primeiro pra montar o editor, o
// segundo pra escolher o grupo do colaborador na admissão.
function podeListar(req) {
  return req.isOwner || hasPermission(req, 'access_groups', 'create') || hasPermission(req, 'users', 'create');
}

async function listar(req, res) {
  if (!podeListar(req)) return res.status(403).json({ error: 'Acesso restrito.' });
  try {
    const r = await db.query(
      `SELECT g.id,g.name,g.permissions,g.created_at,g.updated_at,
              (SELECT COUNT(*)::int FROM users u WHERE u.access_group_id=g.id AND u.company_id=g.company_id) AS membros
         FROM access_groups g WHERE g.company_id=$1 ORDER BY g.name`,
      [req.companyId]
    );
    res.json(r.rows);
  } catch (err) {
    console.error('[AccessGroups listar]', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
}

async function criar(req, res) {
  if (!req.isOwner && !hasPermission(req, 'access_groups', 'create'))
    return res.status(403).json({ error: 'Acesso restrito.' });
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Nome do grupo é obrigatório.' });
  if (name.length > 80) return res.status(400).json({ error: 'Nome deve ter no máximo 80 caracteres.' });
  const permissions = normalizePermissions(req.body.permissions);
  if (exceedsOwnCeiling(req, permissions))
    return res.status(403).json({ error: 'Você não pode conceder permissões que você mesmo não tem.' });
  try {
    const r = await db.query(
      'INSERT INTO access_groups (company_id,name,permissions) VALUES ($1,$2,$3) RETURNING *',
      [req.companyId, name, JSON.stringify(permissions)]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Já existe um grupo com esse nome.' });
    console.error('[AccessGroups criar]', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
}

async function atualizar(req, res) {
  if (!req.isOwner) return res.status(403).json({ error: 'Acesso restrito ao dono da conta.' });
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Grupo inválido.' });
  const { name, permissions } = req.body;
  if (name !== undefined && (!String(name).trim() || String(name).trim().length > 80))
    return res.status(400).json({ error: 'Nome inválido.' });

  const campos = [], vals = [];
  let i = 1;
  if (name !== undefined) { campos.push(`name=$${i++}`); vals.push(String(name).trim()); }
  if (permissions !== undefined) { campos.push(`permissions=$${i++}`); vals.push(JSON.stringify(normalizePermissions(permissions))); }
  if (!campos.length) return res.status(400).json({ error: 'Nenhum campo para atualizar.' });
  campos.push('updated_at=NOW()');
  vals.push(id, req.companyId);

  try {
    const r = await db.query(
      `UPDATE access_groups SET ${campos.join(',')} WHERE id=$${i++} AND company_id=$${i++} RETURNING *`,
      vals
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Grupo não encontrado.' });
    res.json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Já existe um grupo com esse nome.' });
    console.error('[AccessGroups atualizar]', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
}

async function excluir(req, res) {
  if (!req.isOwner) return res.status(403).json({ error: 'Acesso restrito ao dono da conta.' });
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Grupo inválido.' });
  try {
    // Sem cascata de propósito: membros do grupo voltam pro padrão (sem
    // grupo) em vez de a FK bloquear a exclusão.
    await db.query('UPDATE users SET access_group_id=NULL WHERE access_group_id=$1 AND company_id=$2', [id, req.companyId]);
    await db.query('DELETE FROM access_groups WHERE id=$1 AND company_id=$2', [id, req.companyId]);
    res.status(204).send();
  } catch (err) {
    console.error('[AccessGroups excluir]', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
}

module.exports = { listar, criar, atualizar, excluir };
