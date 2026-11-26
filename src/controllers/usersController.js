const db              = require('../config/db');
const bcrypt          = require('bcryptjs');
const { validarCPF }  = require('../utils/validacoes');
const { supabaseAdmin, createAuthClient, isConfigured } = require('../config/supabase');
const { uploadPrivate, signedUrl, signDocuments } = require('../services/storageService');
const { normalizeFeatures } = require('../policies/features');
const { hasPermission, exceedsOwnCeiling } = require('../policies/permissions');

const validEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ''));

async function validarGrupo(companyId, accessGroupId) {
  if (accessGroupId === undefined || accessGroupId === null) return null;
  const id = Number(accessGroupId);
  if (!Number.isInteger(id)) throw Object.assign(new Error('Grupo de acesso inválido.'), { status: 400 });
  const r = await db.query('SELECT id FROM access_groups WHERE id=$1 AND company_id=$2', [id, companyId]);
  if (!r.rows[0]) throw Object.assign(new Error('Grupo de acesso inválido.'), { status: 400 });
  return id;
}

async function cadastrar(req, res) {
  const { companyId, userId: actorId } = req;
  if (!req.isOwner && !hasPermission(req, 'users', 'create'))
    return res.status(403).json({ error: 'Acesso restrito.' });

  const { name, email, password, phone, cpf, birth_date, features, access_group_id } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ error: 'Nome, e-mail e senha são obrigatórios.' });
  if (password.length < 8)
    return res.status(400).json({ error: 'Senha deve ter mínimo 8 caracteres.' });
  if (!validEmail(email)) return res.status(400).json({ error: 'E-mail inválido.' });
  if (cpf && !validarCPF(cpf))
    return res.status(400).json({ error: 'CPF inválido.' });
  // Sem "features" no corpo = sem restrição própria (herda a empresa).
  // Só grava overrides quando o formulário de admissão explicitamente
  // desmarcou algo.
  const featuresIniciais = features ? normalizeFeatures(features) : {};

  const client = await db.connect();
  try {
    const grupoId = await validarGrupo(companyId, access_group_id);
    if (!req.isOwner && grupoId) {
      // Quem não é dono só cadastra via permissão de grupo: não pode colocar
      // o novo colaborador num grupo mais poderoso que o seu (isso seria
      // criar uma conta fantasma com privilégios que o criador não tem).
      const grupo = await db.query('SELECT permissions FROM access_groups WHERE id=$1 AND company_id=$2', [grupoId, companyId]);
      if (exceedsOwnCeiling(req, grupo.rows[0]?.permissions))
        throw Object.assign(new Error('Você não pode atribuir um grupo com permissões que você mesmo não tem.'), { status: 403 });
    }
    await client.query('BEGIN');
    const capacity = await client.query(
      `SELECT c.user_limit,(SELECT COUNT(*)::int FROM users u WHERE u.company_id=c.id AND u.active) AS active_users
       FROM companies c WHERE c.id=$1 FOR UPDATE`, [companyId]);
    if (!capacity.rows[0] || capacity.rows[0].active_users >= capacity.rows[0].user_limit)
      throw Object.assign(new Error('Limite de usuários ativos atingido para o plano desta empresa.'), { status: 409 });

    const normalizedEmail = email.trim().toLowerCase();
    // Global de propósito: quem cadastra escolhe a senha inicial, então não
    // pode criar conta para um e-mail que já é de alguém em outra empresa.
    const existe = await client.query(
      'SELECT 1 FROM users WHERE email=$1 UNION ALL SELECT 1 FROM platform_admins WHERE email=$1 LIMIT 1', [normalizedEmail]);
    if (existe.rows.length) {
      throw Object.assign(
        new Error(req.isOwner
          ? 'E-mail já utilizado no peopleX.'
          : 'Não foi possível cadastrar esse colaborador. Confira os dados e tente novamente.'),
        { status: req.isOwner ? 409 : 400 }
      );
    }

    const hash   = await bcrypt.hash(password, 10);
    const cpfNum = cpf ? cpf.replace(/\D/g, '') : null;
    const r = await client.query(
      `INSERT INTO users (company_id,name,email,password_hash,phone,cpf,birth_date,features,access_group_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id,name,email,phone,features,access_group_id,created_at`,
      [companyId, name.trim(), normalizedEmail, hash, phone||null, cpfNum, birth_date||null, JSON.stringify(featuresIniciais), grupoId]
    );
    await client.query(
      `INSERT INTO audit_logs (company_id,actor_id,action,entity_type,entity_id,metadata,ip_address)
       VALUES ($1,$2,'user.created','user',$3,$4,$5)`,
      [companyId, actorId, String(r.rows[0].id), JSON.stringify({ email: normalizedEmail }), req.ip || null]
    );
    await client.query('COMMIT');
    res.status(201).json(r.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.status) return res.status(err.status).json({ error: err.message });
    if (err.code === '23505') {
      // Rara: só dispara numa corrida (duas requisições simultâneas) depois
      // que a pré-checagem acima já passou. O nome da constraint diz qual
      // das duas foi, em vez de sempre assumir CPF.
      const message = err.constraint === 'users_company_id_email_key'
        ? (req.isOwner ? 'E-mail já utilizado nesta empresa.' : 'Não foi possível cadastrar esse colaborador. Confira os dados e tente novamente.')
        : 'CPF já cadastrado.';
      return res.status(err.constraint === 'users_company_id_email_key' && !req.isOwner ? 400 : 409).json({ error: message });
    }
    console.error('[Users cadastrar]', err);
    res.status(500).json({ error: 'Erro interno.' });
  } finally {
    client.release();
  }
}

async function listar(req, res) {
  const { companyId } = req;
  if (!req.isOwner) return res.status(403).json({ error: 'Acesso restrito ao dono da conta.' });
  try {
    const r = await db.query(
      `SELECT u.id,u.name,u.email,u.job_title,u.phone,u.cpf,u.photo_url,u.is_owner,
              u.active,u.hire_date,u.created_at,u.features,u.access_group_id,g.name AS access_group_name,
              d.name AS department
       FROM users u LEFT JOIN departments d
         ON d.id=u.department_id AND d.company_id=u.company_id
         LEFT JOIN access_groups g ON g.id=u.access_group_id AND g.company_id=u.company_id
       WHERE u.company_id=$1 ORDER BY u.name`,
      [companyId]
    );
    const users = await Promise.all(r.rows.map(async user => ({
      ...user,
      photo_url: await signedUrl('avatars', user.photo_url),
    })));
    res.json(users);
  } catch (err) { res.status(500).json({ error: 'Erro interno.' }); }
}

async function listarDiretorio(req, res) {
  try {
    const r = await db.query(
      `SELECT id,name,job_title,photo_url
       FROM users
       WHERE company_id=$1 AND active=true AND id<>$2
       ORDER BY name`,
      [req.companyId, req.userId]
    );
    const users = await Promise.all(r.rows.map(async user => ({
      ...user,
      photo_url: await signedUrl('avatars', user.photo_url),
    })));
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao carregar o diretório.' });
  }
}

async function alterarStatus(req, res) {
  const { companyId, userId: actorId } = req;
  const targetId = Number(req.params.id);
  const { active } = req.body;

  if (!req.isOwner) return res.status(403).json({ error: 'Acesso restrito ao dono da conta.' });
  if (!Number.isInteger(targetId) || targetId <= 0) return res.status(400).json({ error: 'Usuário inválido.' });
  if (typeof active !== 'boolean') return res.status(400).json({ error: 'Status inválido.' });
  if (targetId === Number(actorId) && !active) return res.status(409).json({ error: 'Você não pode desativar sua própria conta.' });

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM companies WHERE id=$1 FOR UPDATE', [companyId]);
    const targetResult = await client.query(
      'SELECT id,name,email,is_owner,active FROM users WHERE id=$1 AND company_id=$2 FOR UPDATE',
      [targetId, companyId]
    );
    const target = targetResult.rows[0];
    if (!target) throw Object.assign(new Error('Colaborador não encontrado.'), { status: 404 });
    if (target.active === active) {
      await client.query('COMMIT');
      return res.json(target);
    }
    if (!active && target.is_owner)
      throw Object.assign(new Error('O dono da conta não pode ser desativado.'), { status: 409 });

    const updated = await client.query(
      `UPDATE users SET active=$1,
         terminated_at=CASE WHEN $1=false THEN NOW() ELSE NULL END,updated_at=NOW()
       WHERE id=$2 AND company_id=$3
       RETURNING id,name,email,active,updated_at`,
      [active, targetId, companyId]
    );
    await client.query(
      `INSERT INTO audit_logs (company_id,actor_id,action,entity_type,entity_id,metadata,ip_address)
       VALUES ($1,$2,$3,'user',$4,$5,$6)`,
      [companyId, actorId, active ? 'user.reactivated' : 'user.deactivated', String(targetId), JSON.stringify({ email: target.email }), req.ip || null]
    );
    await client.query('COMMIT');
    res.json(updated.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('[Users alterarStatus]', err);
    res.status(500).json({ error: 'Erro interno.' });
  } finally {
    client.release();
  }
}

async function atualizarGrupo(req, res) {
  const { companyId, userId: actorId } = req;
  const targetId = Number(req.params.id);

  if (!req.isOwner) return res.status(403).json({ error: 'Acesso restrito ao dono da conta.' });
  if (!Number.isInteger(targetId) || targetId <= 0) return res.status(400).json({ error: 'Usuário inválido.' });

  const client = await db.connect();
  try {
    const grupoId = await validarGrupo(companyId, req.body.access_group_id);
    await client.query('BEGIN');
    const targetResult = await client.query(
      'SELECT id,name,email,is_owner,access_group_id FROM users WHERE id=$1 AND company_id=$2 FOR UPDATE',
      [targetId, companyId]
    );
    const target = targetResult.rows[0];
    if (!target) throw Object.assign(new Error('Colaborador não encontrado.'), { status: 404 });
    if (target.is_owner)
      throw Object.assign(new Error('O dono da conta não participa de grupos de acesso.'), { status: 409 });

    const updated = await client.query(
      `UPDATE users SET access_group_id=$1,updated_at=NOW() WHERE id=$2 AND company_id=$3
       RETURNING id,name,email,access_group_id,updated_at`,
      [grupoId, targetId, companyId]
    );
    await client.query(
      `INSERT INTO audit_logs (company_id,actor_id,action,entity_type,entity_id,metadata,ip_address)
       VALUES ($1,$2,'user.access_group_changed','user',$3,$4,$5)`,
      [companyId, actorId, String(targetId), JSON.stringify({ from: target.access_group_id, to: grupoId }), req.ip || null]
    );
    await client.query('COMMIT');
    res.json(updated.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('[Users atualizarGrupo]', err);
    res.status(500).json({ error: 'Erro interno.' });
  } finally {
    client.release();
  }
}

async function atualizarFeatures(req, res) {
  const { companyId, userId: actorId } = req;
  const targetId = Number(req.params.id);

  if (!req.isOwner) return res.status(403).json({ error: 'Acesso restrito ao dono da conta.' });
  if (!Number.isInteger(targetId) || targetId <= 0) return res.status(400).json({ error: 'Usuário inválido.' });
  if (targetId === Number(actorId)) return res.status(409).json({ error: 'Você não pode alterar suas próprias funcionalidades.' });

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const targetResult = await client.query(
      'SELECT id,name,email FROM users WHERE id=$1 AND company_id=$2 FOR UPDATE',
      [targetId, companyId]
    );
    const target = targetResult.rows[0];
    if (!target) throw Object.assign(new Error('Colaborador não encontrado.'), { status: 404 });

    const features = normalizeFeatures(req.body);
    const updated = await client.query(
      `UPDATE users SET features=$1,updated_at=NOW() WHERE id=$2 AND company_id=$3
       RETURNING id,name,email,features,updated_at`,
      [JSON.stringify(features), targetId, companyId]
    );
    await client.query(
      `INSERT INTO audit_logs (company_id,actor_id,action,entity_type,entity_id,metadata,ip_address)
       VALUES ($1,$2,'user.features_updated','user',$3,$4,$5)`,
      [companyId, actorId, String(targetId), JSON.stringify(features), req.ip || null]
    );
    await client.query('COMMIT');
    res.json(updated.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('[Users atualizarFeatures]', err);
    res.status(500).json({ error: 'Erro interno.' });
  } finally {
    client.release();
  }
}

async function excluir(req, res) {
  const { companyId, userId: actorId } = req;
  const targetId = Number(req.params.id);

  if (!req.isOwner) return res.status(403).json({ error: 'Acesso restrito ao dono da conta.' });
  if (!Number.isInteger(targetId) || targetId <= 0) return res.status(400).json({ error: 'Usuário inválido.' });
  if (targetId === Number(actorId)) return res.status(409).json({ error: 'Você não pode excluir sua própria conta.' });

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const targetResult = await client.query(
      'SELECT id,name,email,is_owner,auth_user_id FROM users WHERE id=$1 AND company_id=$2 FOR UPDATE',
      [targetId, companyId]
    );
    const target = targetResult.rows[0];
    if (!target) throw Object.assign(new Error('Colaborador não encontrado.'), { status: 404 });
    if (target.is_owner)
      throw Object.assign(new Error('O dono da conta não pode ser excluído.'), { status: 409 });

    // Exclusão real só é permitida sem nenhum vínculo (mensagem, solicitação,
    // aviso, log etc.) -- o próprio banco garante isso via foreign key
    // (nenhuma dessas tabelas usa ON DELETE CASCADE a partir de users).
    // Colaborador com histórico deve ser desativado, não excluído.
    try {
      await client.query('DELETE FROM users WHERE id=$1 AND company_id=$2', [targetId, companyId]);
    } catch (deleteError) {
      if (deleteError.code === '23503') {
        throw Object.assign(
          new Error('Este colaborador já tem atividade no sistema (mensagens, solicitações, avisos ou registros de auditoria) e não pode ser excluído. Desative o acesso em vez de excluir.'),
          { status: 409 }
        );
      }
      throw deleteError;
    }
    await client.query(
      `INSERT INTO audit_logs (company_id,actor_id,action,entity_type,entity_id,metadata,ip_address)
       VALUES ($1,$2,'user.deleted','user',$3,$4,$5)`,
      [companyId, actorId, String(targetId), JSON.stringify({ email: target.email }), req.ip || null]
    );
    await client.query('COMMIT');
    const shared = target.auth_user_id ? await db.query(
      `SELECT 1 FROM users WHERE auth_user_id=$1
       UNION ALL SELECT 1 FROM platform_admins WHERE auth_user_id=$1 LIMIT 1`, [target.auth_user_id]) : null;
    if (shared && !shared.rows.length && isConfigured) {
      await supabaseAdmin.auth.admin.deleteUser(target.auth_user_id).catch(error =>
        console.warn('[Users excluir] falha ao remover conta de autenticação', error.message));
    }
    res.status(204).send();
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('[Users excluir]', err);
    res.status(500).json({ error: 'Erro interno.' });
  } finally {
    client.release();
  }
}

async function perfil(req, res) {
  const { userId, companyId } = req;
  try {
    const r = await db.query(
      `SELECT u.id,u.name,u.email,u.phone,u.cpf,u.rg,u.birth_date,
              u.photo_url,u.created_at,c.name AS empresa
       FROM users u JOIN companies c ON c.id=u.company_id
       WHERE u.id=$1 AND u.company_id=$2`,
      [userId, companyId]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Usuário não encontrado.' });
    const docs = await db.query(
      'SELECT id,type,file_url,created_at FROM user_documents WHERE user_id=$1 AND company_id=$2 ORDER BY created_at DESC',
      [userId, companyId]
    );
    res.json({
      ...r.rows[0],
      photo_url: await signedUrl('avatars', r.rows[0].photo_url),
      documentos: await signDocuments(docs.rows),
    });
  } catch (err) { res.status(500).json({ error: 'Erro interno.' }); }
}

async function atualizarPerfil(req, res) {
  const { userId, companyId } = req;
  const { name, email, phone, rg, birth_date, currentPassword, newPassword } = req.body;
  const normalizedEmail = email === undefined ? undefined : String(email).trim().toLowerCase();
  if (normalizedEmail !== undefined && !validEmail(normalizedEmail))
    return res.status(400).json({ error: 'E-mail inválido.' });
  if (newPassword && newPassword.length < 8)
    return res.status(400).json({ error: 'A nova senha deve ter pelo menos 8 caracteres.' });

  const client = await db.connect();
  let authUpdated = false;
  let previousAuth = null;
  try {
    await client.query('BEGIN');
    const currentResult = await client.query(
      `SELECT id,name,email,password_hash,auth_user_id
         FROM users WHERE id=$1 AND company_id=$2 FOR UPDATE`,
      [userId, companyId]
    );
    const current = currentResult.rows[0];
    if (!current) throw Object.assign(new Error('Usuário não encontrado.'), { status: 404 });

    const emailChanged = normalizedEmail !== undefined && normalizedEmail !== current.email.toLowerCase();
    const sensitiveChange = emailChanged || Boolean(newPassword);
    if (sensitiveChange && !currentPassword)
      throw Object.assign(new Error('Informe a senha atual para alterar e-mail ou senha.'), { status: 400 });

    if (sensitiveChange) {
      if (current.auth_user_id && isConfigured) {
        const { data, error } = await createAuthClient().auth.signInWithPassword({
          email: current.email,
          password: currentPassword,
        });
        if (error || data.user?.id !== current.auth_user_id)
          throw Object.assign(new Error('Senha atual incorreta.'), { status: 401 });
      } else {
        const valid = current.password_hash && await bcrypt.compare(currentPassword, current.password_hash);
        if (!valid) throw Object.assign(new Error('Senha atual incorreta.'), { status: 401 });
      }
    }

    if (emailChanged) {
      const dup = await client.query(
        `SELECT 1 FROM users WHERE email=$1 AND id!=$2 AND auth_user_id IS DISTINCT FROM $3::uuid
         UNION ALL SELECT 1 FROM users WHERE email=$1 AND id!=$2 AND $3::uuid IS NULL
         UNION ALL SELECT 1 FROM platform_admins WHERE email=$1 LIMIT 1`,
        [normalizedEmail, userId, current.auth_user_id || null]
      );
      if (dup.rows.length)
        throw Object.assign(new Error('E-mail já em uso.'), { status: 409 });
    }

    if (current.auth_user_id && isConfigured && (emailChanged || newPassword || name)) {
      previousAuth = {
        userId: current.auth_user_id,
        changes: {
          email: current.email,
          password: newPassword ? currentPassword : undefined,
          user_metadata: { name: current.name, company_id: String(companyId) },
        },
      };
      const authChanges = {
        ...(emailChanged ? { email: normalizedEmail } : {}),
        ...(newPassword ? { password: newPassword } : {}),
        ...(name ? { user_metadata: { name: String(name).trim(), company_id: String(companyId) } } : {}),
      };
      const { error } = await supabaseAdmin.auth.admin.updateUserById(current.auth_user_id, authChanges);
      if (error) {
        const status = /already|registered|exists/i.test(error.message || '') ? 409 : 400;
        throw Object.assign(new Error(status === 409 ? 'E-mail já utilizado no peopleX.' : 'Não foi possível atualizar as credenciais.'), { status });
      }
      authUpdated = true;
    }

    const campos = [], vals = [];
    let i = 1;
    if (name !== undefined)       { campos.push(`name=$${i++}`);       vals.push(String(name).trim()); }
    if (emailChanged)             { campos.push(`email=$${i++}`);      vals.push(normalizedEmail); }
    if (phone !== undefined)      { campos.push(`phone=$${i++}`);      vals.push(phone || null); }
    if (rg !== undefined)         { campos.push(`rg=$${i++}`);         vals.push(rg || null); }
    if (birth_date !== undefined) { campos.push(`birth_date=$${i++}`); vals.push(birth_date || null); }
    if (newPassword) {
      const h = await bcrypt.hash(newPassword, 10);
      campos.push(`password_hash=$${i++}`); vals.push(h);
    }
    if (!campos.length)
      throw Object.assign(new Error('Nenhum campo para atualizar.'), { status: 400 });
    campos.push('updated_at=NOW()');

    vals.push(userId, companyId);
    const r = await client.query(
      `UPDATE users SET ${campos.join(',')} WHERE id=$${i++} AND company_id=$${i++}
       RETURNING id,name,email,phone,rg,birth_date,photo_url,updated_at`,
      vals
    );
    if (emailChanged && current.auth_user_id) {
      // O login usa users.email, então as outras empresas da identidade acompanham.
      await client.query('UPDATE users SET email=$1,updated_at=NOW() WHERE auth_user_id=$2 AND id!=$3',
        [normalizedEmail, current.auth_user_id, userId]);
    }
    await client.query(
      `INSERT INTO audit_logs (company_id,actor_id,action,entity_type,entity_id,metadata,ip_address)
       VALUES ($1,$2,'user.profile_updated','user',$3,$4,$5)`,
      [companyId, userId, String(userId), JSON.stringify({ fields: [
        ...(name !== undefined ? ['name'] : []), ...(emailChanged ? ['email'] : []),
        ...(phone !== undefined ? ['phone'] : []), ...(rg !== undefined ? ['rg'] : []),
        ...(birth_date !== undefined ? ['birth_date'] : []), ...(newPassword ? ['password'] : []),
      ] }), req.ip || null]
    );
    await client.query('COMMIT');
    res.json(r.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (authUpdated && previousAuth) {
      const { error: compensationError } = await supabaseAdmin.auth.admin
        .updateUserById(previousAuth.userId, previousAuth.changes)
        .catch(error => ({ error }));
      if (compensationError) console.error('[Users atualizarPerfil compensação]', compensationError);
    }
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('[Users atualizarPerfil]', err);
    res.status(500).json({ error: 'Erro interno.' });
  } finally {
    client.release();
  }
}

async function uploadFoto(req, res) {
  if (!req.file) return res.status(400).json({ error: 'Nenhuma imagem enviada.' });
  try {
    const objectPath = await uploadPrivate({
      bucket: 'avatars', companyId: req.companyId, userId: req.userId, file: req.file,
      allowedMimeTypes: ['image/jpeg', 'image/png'],
    });
    const storedPath = objectPath || `/uploads/fotos/${req.file.filename}`;
    await db.query('UPDATE users SET photo_url=$1,updated_at=NOW() WHERE id=$2 AND company_id=$3',
      [storedPath, req.userId, req.companyId]);
    res.json({ photo_url: await signedUrl('avatars', storedPath) });
  } catch (err) { res.status(err.status || 500).json({ error: err.status ? err.message : 'Erro ao salvar foto.' }); }
}

async function uploadDocumento(req, res) {
  const { userId, companyId } = req;
  const { type } = req.body;
  const tipos = ['rg_frente','rg_verso','cpf','comprovante_residencia'];
  if (!tipos.includes(type)) return res.status(400).json({ error: `Tipo inválido. Use: ${tipos.join(', ')}` });
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
  try {
    const objectPath = await uploadPrivate({
      bucket: 'documents', companyId, userId, file: req.file,
    });
    const url = objectPath || `/uploads/documentos/${req.file.filename}`;
    const r = await db.query(
      `INSERT INTO user_documents
        (company_id,user_id,type,file_url,file_name,mime_type,size_bytes)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id,type,file_url,file_name,mime_type,size_bytes,created_at`,
      [companyId, userId, type, url, req.file.originalname, req.file.mimetype, req.file.size]
    );
    res.status(201).json({ ...r.rows[0], file_url: await signedUrl('documents', url) });
  } catch (err) { res.status(err.status || 500).json({ error: err.status ? err.message : 'Erro ao salvar documento.' }); }
}

async function listarDocumentos(req, res) {
  try {
    const r = await db.query(
      'SELECT id,type,file_url,created_at FROM user_documents WHERE user_id=$1 AND company_id=$2 ORDER BY created_at DESC',
      [req.userId, req.companyId]
    );
    res.json(await signDocuments(r.rows));
  } catch (err) { res.status(500).json({ error: 'Erro interno.' }); }
}

module.exports = { cadastrar, listar, listarDiretorio, alterarStatus, atualizarGrupo, atualizarFeatures, excluir, perfil, atualizarPerfil, uploadFoto, uploadDocumento, listarDocumentos };
