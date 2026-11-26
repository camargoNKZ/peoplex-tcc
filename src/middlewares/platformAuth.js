const db = require('../config/db');
const { supabaseAdmin, isConfigured } = require('../config/supabase');

module.exports = async function platformAuth(req, res, next) {
  if (!isConfigured) return res.status(503).json({ error: 'Autenticação da plataforma indisponível.' });
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return res.status(401).json({ error: 'Sessão administrativa obrigatória.' });

  try {
    const { data, error } = await supabaseAdmin.auth.getUser(header.slice(7).trim());
    if (error || !data.user) return res.status(401).json({ error: 'Sessão administrativa inválida.' });
    const result = await db.query(
      `UPDATE platform_admins SET last_seen_at=NOW()
       WHERE auth_user_id=$1 AND active=true
       RETURNING id,auth_user_id,email,name`,
      [data.user.id]
    );
    if (!result.rows[0]) return res.status(403).json({ error: 'Acesso restrito à administração do peopleX.' });
    req.platformAdmin = result.rows[0];
    next();
  } catch (error) {
    console.error('[Platform auth]', error);
    res.status(401).json({ error: 'Sessão administrativa inválida.' });
  }
};
