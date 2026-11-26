const db = require('../config/db');
const { hasPermission } = require('../policies/permissions');

const CATEGORIES = ['comunicacao', 'lideranca', 'bem_estar'];

// Média da rodada (null se ainda não tem nenhuma resposta -- uma rodada
// recém-aberta sem respostas não deve aparecer como "0").
async function roundAverage(companyId, roundId) {
  if (!roundId) return null;
  const r = await db.query(
    `SELECT COUNT(*)::int AS respostas,
            AVG((comunicacao+lideranca+bem_estar)/3.0) AS geral,
            AVG(comunicacao) AS comunicacao, AVG(lideranca) AS lideranca, AVG(bem_estar) AS bem_estar
       FROM climate_survey_answers WHERE company_id=$1 AND round_id=$2`,
    [companyId, roundId]
  );
  const row = r.rows[0];
  if (!row || !row.respostas) return null;
  return {
    respostas: row.respostas,
    geral: Number(row.geral),
    comunicacao: Number(row.comunicacao),
    lideranca: Number(row.lideranca),
    bem_estar: Number(row.bem_estar),
  };
}

// Usado pelo dashboard overview -- não é uma rota própria, é chamado
// direto pelo dashboardController pra compor a resposta.
async function resumoParaDashboard(companyId, userId) {
  const rounds = await db.query(
    `SELECT id,status FROM climate_survey_rounds WHERE company_id=$1 ORDER BY opened_at DESC LIMIT 2`,
    [companyId]
  );
  const atual = rounds.rows[0];
  const anterior = rounds.rows[1];
  if (!atual) return { atual: null, anterior: null, openRoundId: null, pendingResponse: false };

  const [atualMedia, anteriorMedia, minhaResposta] = await Promise.all([
    roundAverage(companyId, atual.id),
    anterior ? roundAverage(companyId, anterior.id) : Promise.resolve(null),
    atual.status === 'open'
      ? db.query('SELECT 1 FROM climate_survey_responses WHERE company_id=$1 AND round_id=$2 AND user_id=$3', [companyId, atual.id, userId])
      : Promise.resolve({ rows: [] }),
  ]);
  return {
    atual: atualMedia,
    anterior: anteriorMedia,
    openRoundId: atual.status === 'open' ? atual.id : null,
    pendingResponse: atual.status === 'open' && minhaResposta.rows.length === 0,
  };
}

async function status(req, res) {
  try {
    const round = await db.query(
      `SELECT id FROM climate_survey_rounds WHERE company_id=$1 AND status='open' LIMIT 1`,
      [req.companyId]
    );
    const openRoundId = round.rows[0]?.id || null;
    let jaRespondeu = false;
    if (openRoundId) {
      const r = await db.query(
        'SELECT 1 FROM climate_survey_responses WHERE company_id=$1 AND round_id=$2 AND user_id=$3',
        [req.companyId, openRoundId, req.userId]
      );
      jaRespondeu = r.rows.length > 0;
    }
    res.json({ openRoundId, jaRespondeu, podeAbrirRodada: hasPermission(req, 'climate', 'open_round') });
  } catch (error) {
    console.error('[Climate status]', error);
    res.status(500).json({ error: 'Erro interno.' });
  }
}

async function responder(req, res) {
  const scores = CATEGORIES.map(key => Number(req.body[key]));
  if (scores.some(value => !Number.isInteger(value) || value < 0 || value > 10))
    return res.status(400).json({ error: 'Cada nota deve ser um número inteiro de 0 a 10.' });

  const client = await db.connect();
  try {
    const round = await db.query(
      `SELECT id FROM climate_survey_rounds WHERE company_id=$1 AND status='open' LIMIT 1`,
      [req.companyId]
    );
    if (!round.rows[0]) return res.status(404).json({ error: 'Não há pesquisa de clima aberta no momento.' });

    const [comunicacao, lideranca, bem_estar] = scores;
    await client.query('BEGIN');
    // A trava de "uma resposta por pessoa por rodada" vive só aqui -- quem
    // respondeu e a nota em si ficam em tabelas sem nenhuma chave em comum,
    // então a resposta é anônima de verdade, não só por convenção de query.
    await client.query(
      `INSERT INTO climate_survey_responses (company_id,round_id,user_id) VALUES ($1,$2,$3)`,
      [req.companyId, round.rows[0].id, req.userId]
    );
    await client.query(
      `INSERT INTO climate_survey_answers (company_id,round_id,comunicacao,lideranca,bem_estar)
       VALUES ($1,$2,$3,$4,$5)`,
      [req.companyId, round.rows[0].id, comunicacao, lideranca, bem_estar]
    );
    await client.query('COMMIT');
    res.status(201).json({ ok: true });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') return res.status(409).json({ error: 'Você já respondeu essa rodada.' });
    console.error('[Climate responder]', error);
    res.status(500).json({ error: 'Erro interno.' });
  } finally {
    client.release();
  }
}

async function abrirRodada(req, res) {
  if (!hasPermission(req, 'climate', 'open_round'))
    return res.status(403).json({ error: 'Você não tem permissão para abrir uma nova rodada de pesquisa de clima.' });
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE climate_survey_rounds SET status='closed',closed_at=NOW() WHERE company_id=$1 AND status='open'`,
      [req.companyId]
    );
    const r = await client.query(
      `INSERT INTO climate_survey_rounds (company_id,opened_by) VALUES ($1,$2) RETURNING id,opened_at`,
      [req.companyId, req.userId]
    );
    await client.query('COMMIT');
    res.status(201).json(r.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[Climate abrirRodada]', error);
    res.status(500).json({ error: 'Erro interno.' });
  } finally {
    client.release();
  }
}

module.exports = { status, responder, abrirRodada, resumoParaDashboard, CATEGORIES };
