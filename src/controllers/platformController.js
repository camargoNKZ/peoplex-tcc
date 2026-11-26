const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { supabaseAdmin, createAuthClient, isConfigured } = require('../config/supabase');
const { FEATURE_KEYS, normalizeFeatures } = require('../policies/features');

const DEFAULT_FEATURES = Object.fromEntries(FEATURE_KEYS.map(key => [key, true]));
const PLANS = ['starter', 'growth', 'enterprise'];

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}


async function audit(adminId, action, tenantId, metadata, ip, queryable = db) {
  await queryable.query(
    `INSERT INTO platform_audit_logs (admin_id,action,tenant_id,metadata,ip_address)
     VALUES ($1,$2,$3,$4,$5)`,
    [adminId, action, tenantId || null, JSON.stringify(metadata || {}), ip || null]
  );
}

async function bootstrap(req, res) {
  if (!isConfigured || !safeEqual(req.headers['x-bootstrap-token'], process.env.PLATFORM_BOOTSTRAP_TOKEN))
    return res.status(404).json({ error: 'Rota não encontrada.' });
  const { name, email, password } = req.body;
  if (!name || !email || !password || password.length < 12)
    return res.status(400).json({ error: 'Nome, e-mail e senha forte são obrigatórios.' });

  let authUserId;
  try {
    const existing = await db.query('SELECT COUNT(*)::int AS total FROM platform_admins');
    if (existing.rows[0].total > 0) return res.status(409).json({ error: 'Administrador da plataforma já configurado.' });
    const created = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name, platform_admin: true } });
    if (created.error) throw created.error;
    authUserId = created.data.user.id;
    const result = await db.query(
      `INSERT INTO platform_admins (auth_user_id,email,name) VALUES ($1,$2,$3)
       RETURNING id,email,name`,
      [authUserId, email.toLowerCase(), name]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (authUserId) await supabaseAdmin.auth.admin.deleteUser(authUserId).catch(() => {});
    console.error('[Platform bootstrap]', error);
    res.status(500).json({ error: 'Não foi possível configurar o administrador.' });
  }
}

async function login(req, res) {
  if (!isConfigured) return res.status(503).json({ error: 'Autenticação indisponível.' });
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'E-mail e senha são obrigatórios.' });
  try {
    const { data, error } = await createAuthClient().auth.signInWithPassword({ email, password });
    if (error || !data.session) return res.status(401).json({ error: 'Credenciais inválidas.' });
    const admin = await db.query('SELECT id,email,name FROM platform_admins WHERE auth_user_id=$1 AND active=true', [data.user.id]);
    if (!admin.rows[0]) return res.status(403).json({ error: 'Conta sem acesso à plataforma.' });
    res.json({ token: data.session.access_token, refreshToken: data.session.refresh_token, expiresAt: data.session.expires_at, admin: admin.rows[0] });
  } catch (error) {
    console.error('[Platform login]', error);
    res.status(500).json({ error: 'Não foi possível entrar.' });
  }
}

async function refresh(req, res) {
  if (!isConfigured) return res.status(503).json({ error: 'Autenticação indisponível.' });
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ error: 'Refresh token obrigatório.' });
  try {
    const { data, error } = await createAuthClient().auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data.session) return res.status(401).json({ error: 'Sessão expirada.' });
    const admin = await db.query(
      'SELECT id FROM platform_admins WHERE auth_user_id=$1 AND active=true',
      [data.user.id]
    );
    if (!admin.rows[0]) return res.status(403).json({ error: 'Conta sem acesso à plataforma.' });
    res.json({
      token: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresAt: data.session.expires_at,
    });
  } catch (error) {
    console.error('[Platform refresh]', error);
    res.status(401).json({ error: 'Sessão expirada.' });
  }
}

// Mesma lógica do forgotPassword de src/controllers/authController.js, mas
// contra platform_admins em vez de users/companies -- esse login não tem
// slug de empresa. Resposta genérica pra não revelar se o e-mail existe.
async function forgotPassword(req, res) {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'E-mail é obrigatório.' });
  if (!isConfigured) return res.status(503).json({ error: 'Redefinição de senha indisponível.' });

  try {
    const result = await db.query(
      `SELECT auth_user_id FROM platform_admins WHERE email=$1 AND active=true`,
      [String(email).trim().toLowerCase()]
    );
    if (result.rows[0]?.auth_user_id) {
      // Mesma URL exata usada pelo reset de senha de empresa (authController.js) --
      // é a que já está na allow-list de Redirect URLs do Supabase. Query string
      // extra aqui quebraria a validação de redirect lá (mesmo bug que já tivemos
      // com a Site URL desatualizada), então a página decide o destino sozinha.
      const redirectTo = `${process.env.APP_URL || `https://${req.get('host')}`}/redefinir-senha.html`;
      await createAuthClient().auth.resetPasswordForEmail(String(email).trim().toLowerCase(), { redirectTo });
    }
  } catch (error) {
    console.error('[Platform forgotPassword]', error);
  }
  res.json({ ok: true });
}

async function changePassword(req, res) {
  const { password } = req.body;
  if (!password || password.length < 12) return res.status(400).json({ error: 'Use uma senha com pelo menos 12 caracteres.' });
  const { error } = await supabaseAdmin.auth.admin.updateUserById(req.platformAdmin.auth_user_id, { password });
  if (error) return res.status(400).json({ error: 'Não foi possível alterar a senha.' });
  await audit(req.platformAdmin.id, 'platform_admin.password_changed', null, {}, req.ip);
  res.json({ ok: true });
}

async function listAuditLogs(req, res) {
  try {
    const result = await db.query(`
      SELECT l.id, l.action, l.metadata, l.ip_address, l.created_at,
             a.name AS admin_name, a.email AS admin_email,
             c.name AS tenant_name, c.slug AS tenant_slug
        FROM platform_audit_logs l
        LEFT JOIN platform_admins a ON a.id = l.admin_id
        LEFT JOIN companies c ON c.id = l.tenant_id
       ORDER BY l.created_at DESC
       LIMIT 200`);
    res.json(result.rows);
  } catch (error) {
    console.error('[Platform audit logs]', error);
    res.status(500).json({ error: 'Não foi possível carregar o log de auditoria.' });
  }
}

async function listAdmins(req, res) {
  try {
    const result = await db.query(
      `SELECT id,name,email,active,last_seen_at,created_at FROM platform_admins ORDER BY created_at ASC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('[Platform admins]', error);
    res.status(500).json({ error: 'Não foi possível carregar os administradores.' });
  }
}

// Sem senha definida por ninguém além do próprio administrador: o Supabase
// manda um e-mail de convite com um magic link, que cai na mesma
// redefinir-senha.html do reset de senha (ela já trata SIGNED_IN, que é o
// evento desse tipo de link, além de PASSWORD_RECOVERY).
async function inviteAdmin(req, res) {
  if (!isConfigured) return res.status(503).json({ error: 'Convite indisponível.' });
  const { name, email } = req.body;
  if (!name || !email) return res.status(400).json({ error: 'Nome e e-mail são obrigatórios.' });
  const normalizedEmail = String(email).trim().toLowerCase();

  try {
    const duplicate = await db.query(
      'SELECT 1 FROM platform_admins WHERE email=$1 UNION ALL SELECT 1 FROM users WHERE email=$1 LIMIT 1',
      [normalizedEmail]
    );
    if (duplicate.rows.length) return res.status(409).json({ error: 'E-mail já utilizado na plataforma.' });

    const redirectTo = `${process.env.APP_URL || `https://${req.get('host')}`}/redefinir-senha.html`;
    const invited = await supabaseAdmin.auth.admin.inviteUserByEmail(normalizedEmail, {
      redirectTo,
      data: { name: name.trim(), platform_admin: true },
    });
    if (invited.error) throw invited.error;
    const authUserId = invited.data.user.id;

    try {
      const result = await db.query(
        `INSERT INTO platform_admins (auth_user_id,email,name) VALUES ($1,$2,$3)
         RETURNING id,name,email,active,last_seen_at,created_at`,
        [authUserId, normalizedEmail, name.trim()]
      );
      await audit(req.platformAdmin.id, 'platform_admin.invited', null, { email: normalizedEmail }, req.ip);
      res.status(201).json(result.rows[0]);
    } catch (dbError) {
      await supabaseAdmin.auth.admin.deleteUser(authUserId).catch(() => {});
      throw dbError;
    }
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'E-mail já cadastrado.' });
    console.error('[Platform invite admin]', error);
    res.status(500).json({ error: 'Não foi possível convidar o administrador.' });
  }
}

async function setAdminActive(req, res) {
  const id = Number(req.params.id);
  const { active } = req.body;
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Administrador inválido.' });
  if (typeof active !== 'boolean') return res.status(400).json({ error: 'Status inválido.' });
  if (id === Number(req.platformAdmin.id)) return res.status(409).json({ error: 'Você não pode desativar sua própria conta.' });

  try {
    if (!active) {
      const activeCount = await db.query('SELECT COUNT(*)::int AS total FROM platform_admins WHERE active=true');
      if (activeCount.rows[0].total <= 1)
        return res.status(409).json({ error: 'Precisa sobrar ao menos um administrador ativo.' });
    }
    const result = await db.query(
      `UPDATE platform_admins SET active=$1,updated_at=NOW() WHERE id=$2
       RETURNING id,name,email,active,last_seen_at,created_at`,
      [active, id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Administrador não encontrado.' });
    await audit(req.platformAdmin.id, active ? 'platform_admin.activated' : 'platform_admin.deactivated', null, { targetAdminId: id }, req.ip);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('[Platform admin status]', error);
    res.status(500).json({ error: 'Não foi possível atualizar o administrador.' });
  }
}

async function overview(req, res) {
  try {
    const result = await db.query(`
      SELECT
        COUNT(*)::int AS tenants_total,
        COUNT(*) FILTER (WHERE active)::int AS tenants_active,
        COALESCE((SELECT COUNT(*) FROM users WHERE active),0)::int AS users_active,
        COALESCE((SELECT COUNT(*) FROM messages WHERE created_at >= NOW()-INTERVAL '30 days' AND deleted_at IS NULL),0)::int AS messages_30d,
        COALESCE((SELECT SUM(size_bytes) FROM user_documents),0)::bigint AS storage_bytes,
        COALESCE((SELECT COUNT(*) FROM requests WHERE created_at >= NOW()-INTERVAL '30 days'),0)::int AS requests_30d
      FROM companies`);
    res.json({ ...result.rows[0], admin: { name: req.platformAdmin.name, email: req.platformAdmin.email } });
  } catch (error) {
    console.error('[Platform overview]', error);
    res.status(500).json({ error: 'Não foi possível carregar os indicadores.' });
  }
}

async function listTenants(req, res) {
  try {
    const result = await db.query(`
      SELECT c.id,c.name,c.slug,c.plan,c.active,c.user_limit,c.features,c.created_at,c.suspended_at,
        (SELECT COUNT(*)::int FROM users u WHERE u.company_id=c.id) AS users_total,
        (SELECT COUNT(*)::int FROM users u WHERE u.company_id=c.id AND u.active) AS users_active,
        (SELECT COUNT(*)::int FROM messages m WHERE m.company_id=c.id AND m.created_at>=NOW()-INTERVAL '30 days' AND m.deleted_at IS NULL) AS messages_30d,
        (SELECT COUNT(*)::int FROM requests r WHERE r.company_id=c.id AND r.created_at>=NOW()-INTERVAL '30 days') AS requests_30d,
        COALESCE((SELECT SUM(d.size_bytes) FROM user_documents d WHERE d.company_id=c.id),0)::bigint AS storage_bytes
      FROM companies c ORDER BY c.created_at DESC`);
    res.json(result.rows);
  } catch (error) {
    console.error('[Platform tenants]', error);
    res.status(500).json({ error: 'Não foi possível carregar as empresas.' });
  }
}

async function createTenant(req, res) {
  const { name, slug, plan = 'starter', userLimit = 25, adminName, adminEmail, adminPassword, features = DEFAULT_FEATURES } = req.body;
  if (!name || !slug || !adminName || !adminEmail || !adminPassword)
    return res.status(400).json({ error: 'Preencha os dados da empresa e do administrador.' });
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return res.status(400).json({ error: 'Slug inválido.' });
  if (!PLANS.includes(plan)) return res.status(400).json({ error: 'Plano inválido.' });
  if (!Number.isInteger(Number(userLimit)) || Number(userLimit) < 1) return res.status(400).json({ error: 'Limite de usuários inválido.' });
  if (adminPassword.length < 12) return res.status(400).json({ error: 'A senha inicial precisa ter pelo menos 12 caracteres.' });

  const client = await db.connect();
  let authUserId;
  let authUserIsNew = false;
  let committed = false;
  try {
    await client.query('BEGIN');
    const normalizedAdminEmail = adminEmail.trim().toLowerCase();
    // O mesmo e-mail pode ser dono/admin de várias empresas -- o isolamento
    // de dados é por company_id (UNIQUE(company_id,email) na tabela users já
    // garante isso por empresa). Só continua bloqueado contra platform_admins:
    // essa é uma identidade de operação da própria peopleX, separada dos
    // tenants, e não deve se misturar com login de empresa.
    const platformAdminClash = await client.query('SELECT 1 FROM platform_admins WHERE email=$1 LIMIT 1', [normalizedAdminEmail]);
    if (platformAdminClash.rows.length)
      throw Object.assign(new Error('Esse e-mail já é de um administrador da plataforma.'), { status: 409 });
    const company = await client.query(
      `INSERT INTO companies (name,slug,plan,user_limit,features)
       VALUES ($1,$2,$3,$4,$5) RETURNING id,name,slug,plan,user_limit,features,active,created_at`,
      [name.trim(), slug, plan, Number(userLimit), JSON.stringify(normalizeFeatures(features))]
    );
    const companyId = company.rows[0].id;
    const department = await client.query(
      `INSERT INTO departments (company_id,name,cost_center) VALUES ($1,'Pessoas & Cultura','RH') RETURNING id`,
      [companyId]
    );
    if (isConfigured) {
      const created = await supabaseAdmin.auth.admin.createUser({
        email: normalizedAdminEmail, password: adminPassword, email_confirm: true,
        user_metadata: { company_id: String(companyId), name: adminName },
      });
      if (!created.error) {
        authUserId = created.data.user.id;
        authUserIsNew = true;
      } else {
        // E-mail já tem identidade no Supabase Auth (dono de outra empresa) --
        // o Supabase Auth é global por e-mail, não por company_id, então em
        // vez de criar uma segunda identidade (impossível) reaproveita a
        // existente. Só aceita se a senha informada agora for a mesma já em
        // uso lá -- senão não tem como saber se a pessoa quis usar essa
        // conta de propósito ou só digitou o e-mail errado.
        const signIn = await createAuthClient().auth.signInWithPassword({ email: normalizedAdminEmail, password: adminPassword });
        if (signIn.error || !signIn.data.user)
          throw Object.assign(new Error('Esse e-mail já tem conta no peopleX em outra empresa, com uma senha diferente. Use a senha já existente dessa conta.'), { status: 409 });
        authUserId = signIn.data.user.id;
      }
    }
    const hash = await bcrypt.hash(adminPassword, 10);
    await client.query(
      `INSERT INTO users (company_id,department_id,auth_user_id,name,email,password_hash,is_owner,job_title,hire_date)
       VALUES ($1,$2,$3,$4,$5,$6,true,'Administrador da empresa',CURRENT_DATE)`,
      [companyId, department.rows[0].id, authUserId || null, adminName.trim(), normalizedAdminEmail, hash]
    );
    await client.query(
      `INSERT INTO request_types (company_id,name,description,sla_hours,requires_attachment) VALUES
       ($1,'Férias','Solicitação de férias',72,false),
       ($1,'Reembolso','Reembolso de despesas',48,true),
       ($1,'Documento','Envio de documento ao RH',24,true),
       ($1,'Atualização cadastral','Alteração de dados pessoais',72,false)`,
      [companyId]
    );
    await audit(req.platformAdmin.id, 'tenant.created', companyId, { slug, plan, adminEmail: normalizedAdminEmail }, req.ip, client);
    await client.query('COMMIT');
    committed = true;
    res.status(201).json(company.rows[0]);
  } catch (error) {
    if (!committed) await client.query('ROLLBACK').catch(() => {});
    // Só apaga a identidade do Supabase Auth se ela foi criada agora mesmo
    // pra essa empresa -- se foi reaproveitada de outra empresa (mesmo
    // e-mail), apagar quebraria o login de quem já usa essa conta lá.
    if (!committed && authUserId && authUserIsNew) await supabaseAdmin.auth.admin.deleteUser(authUserId).catch(() => {});
    // Sempre loga, mesmo quando a resposta já é "reconhecida" -- sem isso,
    // uma falha classificada errado não deixa rastro nenhum pra depurar.
    console.error('[Platform create tenant]', { code: error.code, constraint: error.constraint, detail: error.detail, status: error.status, message: error.message });
    if (error.status) return res.status(error.status).json({ error: error.message });
    if (error.code === '23505') {
      // "Slug ou e-mail já cadastrado" era ambíguo demais pra debugar -- com
      // e-mail agora liberado entre empresas, essa violação quase sempre é
      // o slug mesmo. Confere pelo nome da constraint E pelo detail (que
      // sempre cita a coluna), pra não depender só do nome exato que o
      // Postgres gerou pra constraint.
      const isSlug = error.constraint === 'companies_slug_key' || /\bslug\b/.test(error.detail || '');
      return res.status(409).json({ error: isSlug ? 'Esse identificador já está em uso por outra empresa.' : 'Slug ou e-mail já cadastrado.' });
    }
    res.status(500).json({ error: 'Não foi possível criar a empresa.' });
  } finally {
    client.release();
  }
}

async function updateTenant(req, res) {
  const id = Number(req.params.id);
  const { plan, userLimit, active } = req.body;
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Empresa inválida.' });
  if (plan && !PLANS.includes(plan)) return res.status(400).json({ error: 'Plano inválido.' });
  if (userLimit !== undefined && (!Number.isInteger(Number(userLimit)) || Number(userLimit) < 1))
    return res.status(400).json({ error: 'Limite de usuários inválido.' });
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query(
      `SELECT c.*,(SELECT COUNT(*)::int FROM users WHERE company_id=c.id AND active) AS active_users
       FROM companies c WHERE c.id=$1 FOR UPDATE`, [id]
    );
    if (!current.rows[0]) throw Object.assign(new Error('Empresa não encontrada.'), { status: 404 });
    if (userLimit !== undefined && Number(userLimit) < current.rows[0].active_users)
      throw Object.assign(new Error('O limite não pode ser menor que o número de usuários ativos.'), { status: 409 });
    const result = await client.query(
      `UPDATE companies SET
         plan=COALESCE($1,plan), user_limit=COALESCE($2,user_limit), active=COALESCE($3,active),
         suspended_at=CASE WHEN $3=false THEN NOW() WHEN $3=true THEN NULL ELSE suspended_at END,
         updated_at=NOW()
       WHERE id=$4 RETURNING id,name,slug,plan,user_limit,active,suspended_at`,
      [plan || null, userLimit === undefined ? null : Number(userLimit), typeof active === 'boolean' ? active : null, id]
    );
    await audit(req.platformAdmin.id, 'tenant.updated', id, req.body, req.ip, client);
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error('[Platform update tenant]', error);
    res.status(500).json({ error: 'Não foi possível atualizar a empresa.' });
  } finally {
    client.release();
  }
}

async function updateFeatures(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Empresa inválida.' });
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const features = normalizeFeatures(req.body);
    const result = await client.query(
      'UPDATE companies SET features=$1,updated_at=NOW() WHERE id=$2 RETURNING id,name,features',
      [JSON.stringify(features), id]
    );
    if (!result.rows[0]) throw Object.assign(new Error('Empresa não encontrada.'), { status: 404 });
    await audit(req.platformAdmin.id, 'tenant.features_updated', id, features, req.ip, client);
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error('[Platform features]', error);
    res.status(500).json({ error: 'Não foi possível atualizar as funcionalidades.' });
  } finally {
    client.release();
  }
}

async function updateTenantConfiguration(req, res) {
  const id = Number(req.params.id);
  const { plan, userLimit, active, features = {} } = req.body;
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Empresa inválida.' });
  if (!PLANS.includes(plan)) return res.status(400).json({ error: 'Plano inválido.' });
  if (!Number.isInteger(Number(userLimit)) || Number(userLimit) < 1)
    return res.status(400).json({ error: 'Limite de usuários inválido.' });
  if (typeof active !== 'boolean') return res.status(400).json({ error: 'Status inválido.' });

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query(
      `SELECT c.id,(SELECT COUNT(*)::int FROM users WHERE company_id=c.id AND active) AS active_users
         FROM companies c WHERE c.id=$1 FOR UPDATE`,
      [id]
    );
    if (!current.rows[0]) throw Object.assign(new Error('Empresa não encontrada.'), { status: 404 });
    if (Number(userLimit) < current.rows[0].active_users)
      throw Object.assign(new Error('O limite não pode ser menor que o número de usuários ativos.'), { status: 409 });

    const normalizedFeatures = normalizeFeatures(features);
    const result = await client.query(
      `UPDATE companies SET plan=$1,user_limit=$2,active=$3,features=$4,
         suspended_at=CASE WHEN $3=false THEN NOW() ELSE NULL END,updated_at=NOW()
       WHERE id=$5 RETURNING id,name,slug,plan,user_limit,active,features,suspended_at`,
      [plan, Number(userLimit), active, JSON.stringify(normalizedFeatures), id]
    );
    await audit(req.platformAdmin.id, 'tenant.configuration_updated', id,
      { plan, userLimit: Number(userLimit), active, features: normalizedFeatures }, req.ip, client);
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error('[Platform configuration]', error);
    res.status(500).json({ error: 'Não foi possível atualizar a empresa.' });
  } finally {
    client.release();
  }
}

module.exports = {
  bootstrap, login, refresh, forgotPassword, changePassword, overview, listTenants, createTenant,
  updateTenant, updateFeatures, updateTenantConfiguration,
  listAuditLogs, listAdmins, inviteAdmin, setAdminActive,
};
