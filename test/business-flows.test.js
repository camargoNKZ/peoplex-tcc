// Integração opcional: exige ambiente de testes isolado e autorização explícita.
const test = require('node:test');
const assert = require('node:assert/strict');

const BASE_URL = process.env.PEOPLEX_BASE_URL || '';
const TOKEN = process.env.PEOPLEX_TEST_TOKEN_A || '';
const RUN = Boolean(BASE_URL) && process.env.PEOPLEX_RUN_INTEGRATION === '1';
const skip = !(RUN && TOKEN) && 'defina PEOPLEX_BASE_URL, PEOPLEX_RUN_INTEGRATION=1 e PEOPLEX_TEST_TOKEN_A em um ambiente de testes isolado';

async function call(path, { method = 'GET', body } = {}) {
  const headers = { Authorization: `Bearer ${TOKEN}` };
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE_URL}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await res.json(); } catch { /* corpo vazio, ok */ }
  return { status: res.status, data };
}

test('fluxo completo: criar solicitacao -> mudar status -> status persiste', { skip }, async () => {
  const types = await call('/request-types');
  assert.equal(types.status, 200);
  assert.ok(types.data.length > 0, 'empresa de teste precisa de ao menos 1 tipo de solicitacao ativo');
  const requestTypeId = types.data[0].id;

  const created = await call('/requests', {
    method: 'POST',
    body: { requestTypeId, description: 'teste automatizado de fluxo de negocio' },
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.status, 'pending');
  const requestId = created.data.id;

  const updated = await call(`/requests/${requestId}/status`, {
    method: 'PATCH',
    body: { status: 'in_review' },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.status, 'in_review');

  const list = await call('/requests');
  assert.equal(list.status, 200);
  const persisted = list.data.find(item => String(item.id) === String(requestId));
  assert.ok(persisted, 'a solicitacao criada deveria aparecer na listagem');
  assert.equal(persisted.status, 'in_review');
});

test('solicitacao sem tipo e rejeitada com 400', { skip }, async () => {
  const { status } = await call('/requests', { method: 'POST', body: { description: 'sem tipo' } });
  assert.equal(status, 400);
});

test('mudar status para um valor invalido e rejeitado com 400', { skip }, async () => {
  const types = await call('/request-types');
  const created = await call('/requests', {
    method: 'POST',
    body: { requestTypeId: types.data[0].id, description: 'teste de status invalido' },
  });
  assert.equal(created.status, 201);

  const { status } = await call(`/requests/${created.data.id}/status`, {
    method: 'PATCH',
    body: { status: 'status-que-nao-existe' },
  });
  assert.equal(status, 400);
});

test('conversa direta exige exatamente 2 pessoas diferentes', { skip }, async () => {
  const { status } = await call('/messages/conversations', {
    method: 'POST',
    body: { type: 'direct', memberIds: [] }, // so o proprio usuario -> 1 pessoa unica
  });
  assert.equal(status, 400);
});

test('mensagem sem corpo e sem anexo e rejeitada com 400', { skip }, async () => {
  const conversations = await call('/messages/conversations');
  assert.equal(conversations.status, 200);
  assert.ok(conversations.data.length > 0, 'empresa de teste precisa de ao menos 1 conversa (crie uma manualmente se faltar)');
  const conversationId = conversations.data[0].id;

  const { status } = await call(`/messages/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: { body: '' },
  });
  assert.equal(status, 400);
});
