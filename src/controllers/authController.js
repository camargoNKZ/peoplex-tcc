const db     = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const { supabaseAdmin, createAuthClient, isConfigured } = require('../config/supabase');

async function ensureAuthUser(user, password) {
  if (user.auth_user_id) return user.auth_user_id;
  const validLegacyPassword = user.password_hash && await bcrypt.compare(password, user.password_hash);
  if (!validLegacyPassword) return null;

  let authUserId;
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email: user.email,
    password,
    email_confirm: true,
    user_metadata: { company_id: String(user.company_id), name: user.name },
  });
  if (!error) authUserId = data.user.id;
  else {
    // O hash local não prova posse da identidade: quem cadastrou a linha
    // escolheu a senha. Nunca redefinir a senha de uma conta existente aqui.
    const signIn = await createAuthClient().auth.signInWithPassword({ email: user.email, password });
    if (signIn.error || !signIn.data.user) return null;
    authUserId = signIn.data.user.id;
  }
  await db.query(
    'UPDATE users SET auth_user_id=$1,updated_at=NOW() WHERE id=$2 AND company_id=$3',
    [authUserId, user.id, user.company_id]
  );
  return authUserId;
}

async function login(req, res) {
  const { slug, email, password } = req.body;
  if (!slug || !email || !password)
    return res.status(400).json({ error: 'Slug, e-mail e senha são obrigatórios.' });

  try {
    const result = await db.query(
      `SELECT u.id, u.name, u.email, u.password_hash, u.is_owner, u.company_id, u.active, u.auth_user_id
       FROM users u
       JOIN companies c ON c.id = u.company_id
       WHERE c.slug = $1 AND u.email = $2 AND c.active = true`,
      [String(slug).trim().toLowerCase(), String(email).trim().toLowerCase()]
    );
    const user = result.rows[0];
    if (!user || !user.active)
      return res.status(401).json({ error: 'Credenciais inválidas.' });

    if (isConfigured) {
      const authUserId = await ensureAuthUser(user, password);
      if (!authUserId) return res.status(401).json({ error: 'Credenciais inválidas.' });
      const client = createAuthClient();
      const { data, error } = await client.auth.signInWithPassword({ email: user.email, password });
      if (error || !data.session) return res.status(401).json({ error: 'Credenciais inválidas.' });
      return res.json({
        token: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt: data.session.expires_at,
        name: user.name,
        isOwner: user.is_owner,
        email: user.email,
        companyId: user.company_id,
      });
    }

    const ok = user.password_hash && await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Credenciais inválidas.' });

    const token = jwt.sign(
      { userId: user.id, companyId: user.company_id },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );
    res.json({ token, name: user.name, isOwner: user.is_owner, email: user.email, companyId: user.company_id });
  } catch (err) {
    console.error('[Auth login]', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
}

async function refresh(req, res) {
  if (!isConfigured) return res.status(404).json({ error: 'Renovação indisponível.' });
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ error: 'Refresh token obrigatório.' });
  const { data, error } = await createAuthClient().auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data.session) return res.status(401).json({ error: 'Sessão expirada.' });
  res.json({
    token: data.session.access_token,
    refreshToken: data.session.refresh_token,
    expiresAt: data.session.expires_at,
  });
}

// Mesma lógica do login: resposta genérica tanto pra conta inexistente quanto
// pra e-mail enviado, pra não revelar se a conta existe. Só funciona pra quem
// já tem auth_user_id (ou seja, já logou alguma vez) — o Supabase Auth não
// tem o que recuperar pra uma conta que nunca existiu nele.
async function forgotPassword(req, res) {
  const { slug, email } = req.body;
  if (!slug || !email) return res.status(400).json({ error: 'Slug e e-mail são obrigatórios.' });
  if (!isConfigured) return res.status(503).json({ error: 'Redefinição de senha indisponível.' });

  try {
    const result = await db.query(
      `SELECT u.auth_user_id FROM users u JOIN companies c ON c.id = u.company_id
       WHERE c.slug = $1 AND u.email = $2 AND c.active = true AND u.active = true`,
      [String(slug).trim().toLowerCase(), String(email).trim().toLowerCase()]
    );
    if (result.rows[0]?.auth_user_id) {
      const redirectTo = `${process.env.APP_URL || `https://${req.get('host')}`}/redefinir-senha.html`;
      await createAuthClient().auth.resetPasswordForEmail(String(email).trim().toLowerCase(), { redirectTo });
    }
  } catch (err) {
    console.error('[Auth forgotPassword]', err);
  }
  res.json({ ok: true });
}

// Lista as empresas em que essa identidade (mesmo auth_user_id/e-mail) tem
// uma linha ativa -- alimenta o seletor de workspace, que troca de empresa
// sem precisar de um novo login (o token do Supabase não é por empresa).
async function myCompanies(req, res) {
  if (!isConfigured) return res.status(503).json({ error: 'Indisponível.' });
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Token não enviado.' });
  const { data, error } = await supabaseAdmin.auth.getUser(authHeader.slice(7).trim());
  if (error || !data.user) return res.status(401).json({ error: 'Sessão inválida.' });

  try {
    const result = await db.query(
      `SELECT c.id, c.name, c.slug, u.is_owner, u.name AS user_name
         FROM users u JOIN companies c ON c.id = u.company_id
        WHERE u.auth_user_id = $1 AND u.active = true AND c.active = true
        ORDER BY c.name`,
      [data.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[Auth myCompanies]', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
}

function publicConfig(req, res) {
  const url = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !publishableKey) return res.status(503).json({ error: 'Indisponível.' });
  res.json({ url, publishableKey });
}

module.exports = { ensureAuthUser, login, refresh, forgotPassword, publicConfig, myCompanies };
