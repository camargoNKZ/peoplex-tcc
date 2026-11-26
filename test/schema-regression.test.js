// Integração opcional: exige ambiente de testes isolado e autorização explícita.
const test = require('node:test');
const assert = require('node:assert/strict');

const BASE_URL = process.env.PEOPLEX_BASE_URL || '';
const TOKEN = process.env.PEOPLEX_TEST_TOKEN_A || '';
const RUN = Boolean(BASE_URL) && process.env.PEOPLEX_RUN_INTEGRATION === '1';
const skip = !(RUN && TOKEN) && 'defina PEOPLEX_BASE_URL, PEOPLEX_RUN_INTEGRATION=1 e PEOPLEX_TEST_TOKEN_A em um ambiente de testes isolado';

async function get(path) {
  const res = await fetch(`${BASE_URL}${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  let data = null;
  try { data = await res.json(); } catch { /* corpo vazio, ok */ }
  return { status: res.status, data };
}

// Rotas GET que devolvem dado real de uma empresa autenticada. Cada uma
// vira um teste separado (em vez de um loop) para o nome do teste falho
// apontar direto pra rota quebrada.
const ROUTES = [
  '/users/profile',
  '/users/documents',
  '/users',
  '/requests',
  '/request-types',
  '/notices',
  '/messages/conversations',
  '/dashboard/overview',
  '/dashboard/analytics',
  '/emails/logs',
];

for (const path of ROUTES) {
  test(`GET ${path} nao quebra com 500 (regressao de schema)`, { skip }, async () => {
    const { status, data } = await get(path);
    assert.notEqual(status, 500, `${path} retornou 500: ${JSON.stringify(data)}`);
    assert.ok(status < 500, `${path} retornou erro de servidor ${status}: ${JSON.stringify(data)}`);
  });
}
