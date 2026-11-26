const db = require('../config/db');
const { RESOURCES, hasPermission } = require('../policies/permissions');
const { resumoParaDashboard } = require('./climateController');

function resolvedPermissions(req) {
  const out = {};
  for (const resource of Object.keys(RESOURCES)) {
    out[resource] = {};
    for (const action of Object.keys(RESOURCES[resource])) out[resource][action] = hasPermission(req, resource, action);
  }
  return out;
}

async function overview(req, res) {
  try {
    const [company, people, requests, notices, messages, celebrations, climate] = await Promise.all([
      db.query('SELECT id, name, slug, logo_url, plan, user_limit, features FROM companies WHERE id=$1 AND active=true', [req.companyId]),
      db.query(`SELECT COUNT(*) FILTER (WHERE active)::int AS active,
                       COUNT(*) FILTER (WHERE active AND created_at >= date_trunc('month', NOW()))::int AS new_this_month
                  FROM users WHERE company_id=$1`, [req.companyId]),
      db.query(`SELECT COUNT(*) FILTER (WHERE r.status='pending')::int AS pending,
                       COUNT(*) FILTER (
                         WHERE r.status IN ('pending','in_review') AND r.due_at IS NOT NULL
                           AND (r.due_at AT TIME ZONE c.timezone)::date = (NOW() AT TIME ZONE c.timezone)::date
                       )::int AS due_today,
                       COUNT(*) FILTER (WHERE r.status='approved' AND r.updated_at >= date_trunc('month', NOW()))::int AS approved_month,
                       ROUND(AVG(EXTRACT(EPOCH FROM (r.updated_at-r.created_at))/3600)
                         FILTER (WHERE r.status <> 'pending'), 1) AS avg_resolution_hours
                  FROM requests r JOIN companies c ON c.id=r.company_id
                 WHERE r.company_id=$1`, [req.companyId]),
      db.query(`SELECT COUNT(*) FILTER (WHERE active)::int AS active,
                       COUNT(*) FILTER (WHERE active AND priority='urgent')::int AS urgent
                  FROM notices WHERE company_id=$1`, [req.companyId]),
      db.query(`SELECT COUNT(*)::int AS unread, COUNT(DISTINCT m.conversation_id)::int AS unread_conversations
                  FROM messages m
                  JOIN conversation_members cm
                    ON cm.conversation_id=m.conversation_id AND cm.company_id=m.company_id
                 WHERE m.company_id=$1 AND cm.user_id=$2 AND m.sender_id<>$2
                   AND m.deleted_at IS NULL
                   AND NOT EXISTS (
                     SELECT 1 FROM message_reads mr
                      WHERE mr.company_id=m.company_id AND mr.message_id=m.id AND mr.user_id=$2
                   )`, [req.companyId, req.userId]),
      db.query(
        `SELECT u.id, u.name,
                EXTRACT(YEAR FROM AGE((CURRENT_TIMESTAMP AT TIME ZONE c.timezone)::date, u.hire_date))::int AS years
           FROM users u JOIN companies c ON c.id=u.company_id
          WHERE u.company_id=$1 AND u.active=true AND u.hire_date IS NOT NULL AND u.id <> $2
            AND EXTRACT(MONTH FROM u.hire_date) = EXTRACT(MONTH FROM (CURRENT_TIMESTAMP AT TIME ZONE c.timezone)::date)
            AND EXTRACT(DAY FROM u.hire_date) = EXTRACT(DAY FROM (CURRENT_TIMESTAMP AT TIME ZONE c.timezone)::date)
            AND EXTRACT(YEAR FROM u.hire_date) < EXTRACT(YEAR FROM (CURRENT_TIMESTAMP AT TIME ZONE c.timezone)::date)
          ORDER BY hire_date ASC
          LIMIT 1`,
        [req.companyId, req.userId]
      ),
      resumoParaDashboard(req.companyId, req.userId),
    ]);
    if (!company.rows[0]) return res.status(404).json({ error: 'Empresa não encontrada.' });
    res.json({
      company: company.rows[0],
      // Features efetivas do colaborador logado (empresa ∩ colaborador,
      // já mescladas pelo middleware de auth) -- é isso que a interface
      // deve usar pra decidir o que mostrar, não company.features sozinho.
      features: req.features,
      isOwner: Boolean(req.isOwner),
      permissions: resolvedPermissions(req),
      people: people.rows[0],
      requests: requests.rows[0],
      notices: notices.rows[0],
      messages: messages.rows[0],
      celebration: celebrations.rows[0] || null,
      climate: climate,
    });
  } catch (error) {
    console.error('[Dashboard overview]', error);
    res.status(500).json({ error: 'Não foi possível carregar os indicadores.' });
  }
}

async function analytics(req, res) {
  try {
    const [headcount, departments, communications] = await Promise.all([
      db.query(
        `WITH months AS (
           SELECT date_trunc('month', CURRENT_DATE) - make_interval(months => value) AS month
             FROM generate_series(5,0,-1) AS series(value)
         )
         SELECT month::date,
                COUNT(u.id) FILTER (
                  WHERE u.hire_date < month + INTERVAL '1 month'
                    AND (u.terminated_at IS NULL OR u.terminated_at >= month + INTERVAL '1 month')
                )::int AS headcount,
                COUNT(u.id) FILTER (
                  WHERE u.hire_date >= month AND u.hire_date < month + INTERVAL '1 month'
                )::int AS hires,
                COUNT(u.id) FILTER (
                  WHERE u.terminated_at >= month AND u.terminated_at < month + INTERVAL '1 month'
                )::int AS exits
           FROM months
           LEFT JOIN users u ON u.company_id=$1
          GROUP BY month ORDER BY month`,
        [req.companyId]
      ),
      db.query(
        `SELECT COALESCE(d.name,'Sem área') AS name,COUNT(*)::int AS total
           FROM users u
           LEFT JOIN departments d ON d.id=u.department_id AND d.company_id=u.company_id
          WHERE u.company_id=$1 AND u.active=true
          GROUP BY d.name ORDER BY total DESC,name`,
        [req.companyId]
      ),
      db.query(
        `WITH active AS (
           SELECT COUNT(*)::numeric AS total FROM users WHERE company_id=$1 AND active=true
         ), published AS (
           SELECT id FROM notices
            WHERE company_id=$1 AND active=true
              AND published_at >= date_trunc('month',CURRENT_DATE)
         ), per_notice AS (
           SELECT p.id,COUNT(nr.user_id)::numeric AS reads
             FROM published p
             LEFT JOIN notice_reads nr ON nr.notice_id=p.id AND nr.company_id=$1
            GROUP BY p.id
         )
         SELECT (SELECT COUNT(*)::int FROM published) AS published_month,
                (SELECT total::int FROM active) AS active_people,
                (SELECT COUNT(DISTINCT nr.user_id)::int
                   FROM notice_reads nr JOIN published p ON p.id=nr.notice_id
                  WHERE nr.company_id=$1) AS people_reached,
                COALESCE((SELECT ROUND(AVG(reads*100/NULLIF(active.total,0)))::int
                            FROM per_notice CROSS JOIN active),0) AS read_rate`,
        [req.companyId]
      ),
    ]);
    res.json({
      headcount: headcount.rows,
      departments: departments.rows,
      communications: communications.rows[0],
    });
  } catch (error) {
    console.error('[Dashboard analytics]', error);
    res.status(500).json({ error: 'Não foi possível carregar os indicadores.' });
  }
}

function realtimeConfig(req, res) {
  const url = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !publishableKey) {
    return res.status(503).json({ error: 'Realtime indisponível.' });
  }
  res.json({ url, publishableKey });
}

module.exports = { overview, analytics, realtimeConfig };
