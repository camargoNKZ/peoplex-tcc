const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { supabaseAdmin, isConfigured } = require('../config/supabase');
const { mergeFeatures } = require('../policies/features');

// supabaseAdmin.auth.getUser(token) é uma chamada de rede ao Supabase Auth
// a cada requisição autenticada -- a verificação local do JWT (payload mais
// abaixo) já existe como fallback, mas não é o caminho principal porque
// este projeto não tem, de forma confiável, o material de assinatura do
// Supabase pra validar a assinatura localmente sem risco de derrubar login
// de todo mundo se algo estiver errado. Como meio-termo seguro: um cache
// bem curto em memória evita bater de novo no Supabase quando a mesma
// sessão faz várias requisições em sequência rápida (navegar entre telas,
// por exemplo); a checagem de "colaborador ainda ativo" continua sempre ao
// vivo no banco, então isso só reduz validação de token repetida, nunca a
// autorização em si.
const userCache = new Map(); // sha256(token) -> { user, expiresAt }
const USER_CACHE_TTL_MS = 30 * 1000;
const USER_CACHE_MAX_ENTRIES = 500;

function cacheGetUser(tokenHash) {
  const hit = userCache.get(tokenHash);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) { userCache.delete(tokenHash); return null; }
  return hit.user;
}

function cacheSetUser(tokenHash, user) {
  if (userCache.size >= USER_CACHE_MAX_ENTRIES) {
    userCache.delete(userCache.keys().next().value);
  }
  userCache.set(tokenHash, { user, expiresAt: Date.now() + USER_CACHE_TTL_MS });
}

async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Token não enviado.' });
  if (!authHeader.startsWith('Bearer '))
    return res.status(401).json({ error: 'Formato inválido. Use: Bearer <token>' });

  const token = authHeader.slice(7).trim();
  if (!token)   return res.status(401).json({ error: 'Formato inválido. Use: Bearer <token>' });

  if (isConfigured) {
    try {
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      let user = cacheGetUser(tokenHash);
      if (!user) {
        const { data, error } = await supabaseAdmin.auth.getUser(token);
        if (!error && data.user) { user = data.user; cacheSetUser(tokenHash, user); }
      }
      if (user) {
        // auth_user_id agora pode pertencer a mais de uma empresa (mesma
        // identidade do Supabase Auth dona de vários tenants) -- sem um
        // critério explícito, um LIMIT 1 puro escolheria uma arbitrariamente
        // a cada requisição. O front manda qual empresa está ativa no header
        // X-Company-Id (gravado no login, trocável sem deslogar); na
        // ausência dele, cai numa escolha determinística (a empresa mais
        // antiga dessa pessoa) em vez de uma aleatória.
        const companyIdHeader = req.headers['x-company-id'];
        const params = [user.id];
        let companyFilter = '';
        if (companyIdHeader && /^\d+$/.test(companyIdHeader)) {
          params.push(Number(companyIdHeader));
          companyFilter = 'AND u.company_id=$2';
        }
        const mapped = await db.query(
          `SELECT u.id,u.company_id,u.is_owner,c.features AS company_features,u.features AS user_features,
                  g.permissions AS group_permissions
             FROM users u
             JOIN companies c ON c.id=u.company_id AND c.active=true
             LEFT JOIN access_groups g ON g.id=u.access_group_id AND g.company_id=u.company_id
            WHERE u.auth_user_id=$1 AND u.active=true ${companyFilter}
            ORDER BY u.created_at ASC LIMIT 1`,
          params
        );
        if (mapped.rows[0]) {
          req.userId = mapped.rows[0].id;
          req.companyId = mapped.rows[0].company_id;
          req.isOwner = mapped.rows[0].is_owner;
          req.groupPermissions = mapped.rows[0].group_permissions || {};
          req.features = mergeFeatures(mapped.rows[0].company_features, mapped.rows[0].user_features);
          req.authUserId = user.id;
          return next();
        }
      }
    } catch (error) {
      console.warn('[Auth Supabase]', error.message);
    }
  }

  try {
    const payload  = jwt.verify(token, process.env.JWT_SECRET);
    const mapped = await db.query(
      `SELECT u.id,u.company_id,u.is_owner,c.features AS company_features,u.features AS user_features,
              g.permissions AS group_permissions
         FROM users u
         JOIN companies c ON c.id=u.company_id AND c.active=true
         LEFT JOIN access_groups g ON g.id=u.access_group_id AND g.company_id=u.company_id
        WHERE u.id=$1 AND u.company_id=$2 AND u.active=true LIMIT 1`,
      [payload.userId, payload.companyId]
    );
    if (!mapped.rows[0]) return res.status(401).json({ error: 'Conta ou empresa inativa.' });
    req.userId     = mapped.rows[0].id;
    req.companyId  = mapped.rows[0].company_id;
    req.isOwner    = mapped.rows[0].is_owner;
    req.groupPermissions = mapped.rows[0].group_permissions || {};
    req.features   = mergeFeatures(mapped.rows[0].company_features, mapped.rows[0].user_features);
    next();
  } catch (err) {
    const msg = err.name === 'TokenExpiredError' ? 'Token expirado.' : 'Token inválido.';
    return res.status(401).json({ error: msg });
  }
}

module.exports = authMiddleware;
