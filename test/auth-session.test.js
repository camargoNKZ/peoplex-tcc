// Integração opcional. Nunca usa produção por padrão.
const test = require('node:test');
const assert = require('node:assert/strict');
const BASE_URL = process.env.PEOPLEX_BASE_URL || '';
const RUN = Boolean(BASE_URL) && process.env.PEOPLEX_RUN_INTEGRATION === '1';
const SLUG = process.env.PEOPLEX_TEST_SLUG || '';
const EMAIL = process.env.PEOPLEX_TEST_EMAIL || '';
const PASSWORD = process.env.PEOPLEX_TEST_PASSWORD || '';
const HAS_KNOWN_USER = Boolean(process.env.PEOPLEX_TEST_EXISTING_SLUG && process.env.PEOPLEX_TEST_EXISTING_EMAIL);
const KNOWN_SLUG = process.env.PEOPLEX_TEST_EXISTING_SLUG || '';
const KNOWN_EMAIL = process.env.PEOPLEX_TEST_EXISTING_EMAIL || '';

async function call(path, { token, method = 'GET', body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE_URL}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch { /* resposta vazia */ }
  return { status: res.status, data };
}

const options = { skip: !RUN };
test('login sem campos obrigatórios retorna 400', options, async () => {
  assert.equal((await call('/auth/login', { method: 'POST', body: { email: 'x@example.invalid' } })).status, 400);
});
test('senha errada retorna 401 sem token', { skip: (!RUN || !HAS_KNOWN_USER) }, async () => {
  const result = await call('/auth/login', { method: 'POST', body: { slug: KNOWN_SLUG, email: KNOWN_EMAIL, password: 'senha-certamente-errada' } });
  assert.equal(result.status, 401); assert.equal(result.data?.token, undefined);
});
test('slug inexistente retorna 401', options, async () => {
  assert.equal((await call('/auth/login', { method: 'POST', body: { slug: 'fixture-inexistente', email: 'a@example.invalid', password: 'wrong' } })).status, 401);
});
test('login não revela se falhou usuário ou senha', { skip: (!RUN || !HAS_KNOWN_USER) }, async () => {
  const a = await call('/auth/login', { method: 'POST', body: { slug: KNOWN_SLUG, email: 'missing@example.invalid', password: 'wrong' } });
  const b = await call('/auth/login', { method: 'POST', body: { slug: KNOWN_SLUG, email: KNOWN_EMAIL, password: 'senha-certamente-errada' } });
  assert.equal(a.status, b.status); assert.equal(a.data?.error, b.data?.error);
});
test('token inválido ou expirado é rejeitado', options, async () => {
  assert.equal((await call('/users/profile', { token: 'synthetic.invalid.expired.token' })).status, 401);
});
test('refresh sem token retorna 400', options, async () => {
  assert.equal((await call('/auth/refresh', { method: 'POST', body: {} })).status, 400);
});
test('refresh inválido não gera token', options, async () => {
  const result = await call('/auth/refresh', { method: 'POST', body: { refreshToken: 'invalid-refresh-token' } });
  assert.equal(result.status, 401); assert.equal(result.data?.token, undefined);
});
test('login válido retorna token utilizável', { skip: (!RUN || !SLUG || !EMAIL || !PASSWORD) }, async () => {
  const login = await call('/auth/login', { method: 'POST', body: { slug: SLUG, email: EMAIL, password: PASSWORD } });
  assert.equal(login.status, 200); assert.ok(login.data.token);
  const profile = await call('/users/profile', { token: login.data.token });
  assert.equal(profile.status, 200); assert.equal(profile.data.email, EMAIL.toLowerCase());
});
