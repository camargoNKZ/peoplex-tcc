// Integração opcional. Nunca usa produção por padrão e não faz mutações.
const test = require('node:test');
const assert = require('node:assert/strict');
const BASE_URL = process.env.PEOPLEX_BASE_URL || '';
const RUN = Boolean(BASE_URL) && process.env.PEOPLEX_RUN_INTEGRATION === '1';
const TOKEN_A = process.env.PEOPLEX_TEST_TOKEN_A || '';
const TOKEN_B = process.env.PEOPLEX_TEST_TOKEN_B || '';

async function call(path, { token, method = 'GET' } = {}) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetch(`${BASE_URL}${path}`, { method, headers });
  let data = null; try { data = await res.json(); } catch { /* resposta vazia */ }
  return { status: res.status, data };
}

const protectedRoutes = ['/users/profile', '/users', '/requests', '/notices', '/messages/conversations', '/dashboard/overview'];
test('rotas protegidas exigem autenticação', { skip: !RUN }, async () => {
  for (const path of protectedRoutes) assert.equal((await call(path)).status, 401, path);
});
test('token inválido é rejeitado', { skip: !RUN }, async () => {
  assert.equal((await call('/users/profile', { token: 'synthetic.invalid.token' })).status, 401);
});
test('conversa inexistente retorna 404', { skip: (!RUN || !TOKEN_A) }, async () => {
  const result = await call('/messages/conversations/999999999', { token: TOKEN_A });
  assert.equal(result.status, 404); assert.equal(result.data?.messages, undefined);
});
test('recursos de A permanecem no tenant do token', { skip: (!RUN || !TOKEN_A) }, async () => {
  const overview = await call('/dashboard/overview', { token: TOKEN_A });
  assert.equal(overview.status, 200);
  assert.ok(overview.data?.company?.id);
  const conversations = await call('/messages/conversations', { token: TOKEN_A });
  assert.equal(conversations.status, 200);
  for (const conversation of conversations.data) assert.ok(Array.isArray(conversation.members));
});
test('A não acessa conversas de B sem alterar dados', { skip: (!RUN || !TOKEN_A || !TOKEN_B) }, async () => {
  const [overviewA, overviewB] = await Promise.all([
    call('/dashboard/overview', { token: TOKEN_A }), call('/dashboard/overview', { token: TOKEN_B }),
  ]);
  assert.equal(overviewA.status, 200); assert.equal(overviewB.status, 200);
  assert.notEqual(overviewA.data.company.id, overviewB.data.company.id);
  const usersA = await call('/users', { token: TOKEN_A });
  const usersB = await call('/users', { token: TOKEN_B });
  assert.equal(usersA.status, 200, 'TOKEN_A precisa ser de RH/admin para testar pessoas');
  assert.equal(usersB.status, 200, 'TOKEN_B precisa ser de RH/admin para testar pessoas');
  const idsA = new Set(usersA.data.map(user => user.id));
  for (const user of usersB.data) assert.ok(!idsA.has(user.id));
  const conversationsB = await call('/messages/conversations', { token: TOKEN_B });
  assert.equal(conversationsB.status, 200);
  if (conversationsB.data.length) {
    const crossAccess = await call(`/messages/conversations/${conversationsB.data[0].id}`, { token: TOKEN_A });
    assert.equal(crossAccess.status, 404);
  }
});
