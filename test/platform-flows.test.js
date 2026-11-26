// Cobertura do peopleX Control (/platform/*), que não tinha nenhum teste --
// é a parte de maior privilégio do sistema (cria/suspende qualquer tenant
// da plataforma). Nunca roda contra produção por padrão e nunca muda nada:
// só leitura + um negativo que prova que a autodesativação é bloqueada
// SEM alterar o estado do próprio admin.
const test = require('node:test');
const assert = require('node:assert/strict');

const BASE_URL = process.env.PEOPLEX_BASE_URL || '';
const RUN = Boolean(BASE_URL) && process.env.PEOPLEX_RUN_INTEGRATION === '1';
const TOKEN = process.env.PEOPLEX_PLATFORM_TOKEN || '';
const skip = !(RUN && TOKEN) && 'defina PEOPLEX_BASE_URL, PEOPLEX_RUN_INTEGRATION=1 e PEOPLEX_PLATFORM_TOKEN para rodar este arquivo';
const skipNoRun = !RUN && 'defina PEOPLEX_BASE_URL e PEOPLEX_RUN_INTEGRATION=1 para rodar este arquivo';

async function call(path, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE_URL}/platform${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await res.json(); } catch { /* corpo vazio, ok */ }
  return { status: res.status, data };
}

test('rotas da plataforma exigem autenticação', { skip: skipNoRun }, async () => {
  for (const path of ['/overview', '/tenants', '/audit-logs', '/admins']) {
    assert.equal((await call(path)).status, 401, path);
  }
});

test('token administrativo inválido é rejeitado', { skip: skipNoRun }, async () => {
  assert.equal((await call('/overview', { token: 'synthetic.invalid.token' })).status, 401);
});

test('login administrativo com credenciais erradas é rejeitado', { skip: skipNoRun }, async () => {
  const { status } = await call('/auth/login', {
    method: 'POST',
    body: { email: 'nao-existe-mesmo@example.invalid', password: 'senha-errada-qualquer' },
  });
  assert.equal(status, 401);
});

test('visão geral retorna métricas agregadas da plataforma', { skip }, async () => {
  const { status, data } = await call('/overview', { token: TOKEN });
  assert.equal(status, 200);
  assert.ok(Number.isInteger(data.tenants_total));
  assert.ok(Number.isInteger(data.tenants_active));
  assert.ok(data.admin?.email);
});

test('lista tenants da plataforma', { skip }, async () => {
  const { status, data } = await call('/tenants', { token: TOKEN });
  assert.equal(status, 200);
  assert.ok(Array.isArray(data));
  for (const tenant of data) {
    assert.ok(tenant.id);
    assert.ok(tenant.slug);
    assert.ok(['starter', 'growth', 'enterprise'].includes(tenant.plan));
  }
});

test('log de auditoria retorna registros com o formato esperado', { skip }, async () => {
  const { status, data } = await call('/audit-logs', { token: TOKEN });
  assert.equal(status, 200);
  assert.ok(Array.isArray(data));
  for (const entry of data) {
    assert.ok(entry.action);
    assert.ok(entry.created_at);
  }
});

test('lista administradores da plataforma', { skip }, async () => {
  const { status, data } = await call('/admins', { token: TOKEN });
  assert.equal(status, 200);
  assert.ok(Array.isArray(data));
  assert.ok(data.some(admin => admin.active), 'deveria sobrar ao menos um administrador ativo');
});

test('administrador não consegue desativar a própria conta (e nada muda)', { skip }, async () => {
  const overview = await call('/overview', { token: TOKEN });
  assert.equal(overview.status, 200);
  const admins = await call('/admins', { token: TOKEN });
  assert.equal(admins.status, 200);
  const self = admins.data.find(admin => admin.email === overview.data.admin.email);
  assert.ok(self, 'não achei o próprio administrador na listagem');

  const attempt = await call(`/admins/${self.id}/status`, { method: 'PATCH', token: TOKEN, body: { active: false } });
  assert.equal(attempt.status, 409);

  const after = await call('/admins', { token: TOKEN });
  const selfAfter = after.data.find(admin => admin.id === self.id);
  assert.equal(selfAfter.active, true, 'a tentativa bloqueada não deveria ter mudado nada');
});
