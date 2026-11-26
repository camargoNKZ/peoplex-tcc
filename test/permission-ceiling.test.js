// Prova, batendo na API de verdade (não só a função pura em
// access-policy.test.js), que um colaborador não-dono com permissão de
// criar grupo/cadastrar usuário não consegue se autopromover: nem criando
// um grupo com mais poder do que o seu, nem atribuindo um grupo assim a um
// colaborador recém-cadastrado. Cria dados reais na empresa de teste e
// limpa tudo no final -- por isso fica atrás do mesmo opt-in explícito que
// multi-tenant-isolation.test.js usa, nunca roda contra produção por
// padrão.
const test = require('node:test');
const assert = require('node:assert/strict');

const BASE_URL = process.env.PEOPLEX_BASE_URL || '';
const RUN = Boolean(BASE_URL) && process.env.PEOPLEX_RUN_INTEGRATION === '1';
const OWNER_TOKEN = process.env.PEOPLEX_TEST_TOKEN_A || '';
const SLUG = process.env.PEOPLEX_TEST_SLUG || '';
const skip = !(RUN && OWNER_TOKEN && SLUG) &&
  'defina PEOPLEX_BASE_URL, PEOPLEX_RUN_INTEGRATION=1, PEOPLEX_TEST_TOKEN_A e PEOPLEX_TEST_SLUG para rodar este arquivo';

async function call(path, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE_URL}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await res.json(); } catch { /* corpo vazio, ok */ }
  return { status: res.status, data };
}

test('colaborador delegado não escala além do próprio teto de permissões', { skip }, async () => {
  const stamp = Date.now();
  const cleanup = [];
  try {
    // 1) Dono cria um grupo limitado: só pode criar grupo e cadastrar gente.
    const limitedGroup = await call('/access-groups', {
      method: 'POST', token: OWNER_TOKEN,
      body: { name: `QA teto ${stamp}`, permissions: { access_groups: { create: true }, users: { create: true } } },
    });
    assert.equal(limitedGroup.status, 201, JSON.stringify(limitedGroup.data));
    cleanup.push(() => call(`/access-groups/${limitedGroup.data.id}`, { method: 'DELETE', token: OWNER_TOKEN }));

    // 2) Dono cadastra um colaborador de teste nesse grupo, com senha conhecida.
    const email = `fixture-ceiling-${stamp}@peoplex.app`;
    const password = 'SenhaQATeto123!';
    const delegate = await call('/users', {
      method: 'POST', token: OWNER_TOKEN,
      body: { name: 'QA Teto Permissao', email, password, access_group_id: limitedGroup.data.id },
    });
    assert.equal(delegate.status, 201, JSON.stringify(delegate.data));
    cleanup.push(() => call(`/users/${delegate.data.id}`, { method: 'DELETE', token: OWNER_TOKEN }));

    // 3) Loga como o colaborador delegado.
    const login = await call('/auth/login', { method: 'POST', body: { slug: SLUG, email, password } });
    assert.equal(login.status, 200, JSON.stringify(login.data));
    const delegateToken = login.data.token;

    // 4) Tenta criar um grupo que concede algo que o delegado não tem (ex.: aprovar solicitações) -- deve barrar.
    const escalation = await call('/access-groups', {
      method: 'POST', token: delegateToken,
      body: { name: `QA escalada ${stamp}`, permissions: { requests: { approve: true } } },
    });
    assert.equal(escalation.status, 403);

    // 5) Cria um grupo igual ou menor que o próprio teto -- deve funcionar.
    const withinCeiling = await call('/access-groups', {
      method: 'POST', token: delegateToken,
      body: { name: `QA dentro do teto ${stamp}`, permissions: { users: { create: true } } },
    });
    assert.equal(withinCeiling.status, 201, JSON.stringify(withinCeiling.data));
    cleanup.push(() => call(`/access-groups/${withinCeiling.data.id}`, { method: 'DELETE', token: OWNER_TOKEN }));

    // 6) Dono cria um grupo mais poderoso (aprovar solicitações) só pra servir de alvo do teste seguinte.
    const powerfulGroup = await call('/access-groups', {
      method: 'POST', token: OWNER_TOKEN,
      body: { name: `QA poderoso ${stamp}`, permissions: { requests: { approve: true } } },
    });
    assert.equal(powerfulGroup.status, 201, JSON.stringify(powerfulGroup.data));
    cleanup.push(() => call(`/access-groups/${powerfulGroup.data.id}`, { method: 'DELETE', token: OWNER_TOKEN }));

    // 7) Delegado tenta cadastrar um colaborador nesse grupo mais poderoso -- deve barrar, e ninguém deve ser criado.
    const ghostEmail = `fixture-ceiling-ghost-${stamp}@peoplex.app`;
    const ghost = await call('/users', {
      method: 'POST', token: delegateToken,
      body: { name: 'QA Fantasma', email: ghostEmail, password: 'SenhaQAFantasma123!', access_group_id: powerfulGroup.data.id },
    });
    assert.equal(ghost.status, 403);

    const listAfterGhost = await call('/users', { token: OWNER_TOKEN });
    assert.equal(listAfterGhost.status, 200);
    assert.ok(!listAfterGhost.data.some(user => user.email === ghostEmail), 'o cadastro barrado não deveria ter criado ninguém');
  } finally {
    for (const undo of cleanup.reverse()) await undo().catch(() => {});
  }
});
