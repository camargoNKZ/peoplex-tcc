const test = require('node:test');
const assert = require('node:assert/strict');
const { canTransitionRequest } = require('../src/policies/access');
const { hasPermission, exceedsOwnCeiling } = require('../src/policies/permissions');

test('sem grupo, colaborador usa o padrao (so mexe nas proprias solicitacoes)', () => {
  const req = { isOwner: false, groupPermissions: {} };
  assert.equal(hasPermission(req, 'requests', 'create'), true);
  assert.equal(hasPermission(req, 'requests', 'edit'), true);
  assert.equal(hasPermission(req, 'requests', 'delete'), true);
  assert.equal(hasPermission(req, 'requests', 'view_all'), false);
  assert.equal(hasPermission(req, 'requests', 'approve'), false);
  assert.equal(hasPermission(req, 'notices', 'create'), false);
});

test('dono da conta sempre pode tudo, mesmo sem grupo', () => {
  const req = { isOwner: true, groupPermissions: {} };
  assert.equal(hasPermission(req, 'requests', 'approve'), true);
  assert.equal(hasPermission(req, 'notices', 'delete'), true);
});

test('grupo pode restringir uma acao que o padrao libera', () => {
  const req = { isOwner: false, groupPermissions: { requests: { edit: false } } };
  assert.equal(hasPermission(req, 'requests', 'edit'), false);
  assert.equal(hasPermission(req, 'requests', 'delete'), true); // não mencionado no grupo, usa padrão
});

test('grupo pode liberar uma acao que o padrao bloqueia, mesmo pra quem nao e dono', () => {
  const req = { isOwner: false, groupPermissions: { requests: { approve: true, view_all: true } } };
  assert.equal(hasPermission(req, 'requests', 'approve'), true);
  assert.equal(hasPermission(req, 'requests', 'view_all'), true);
});

test('recurso ou acao desconhecida nunca libera por engano', () => {
  const req = { isOwner: false, groupPermissions: {} };
  assert.equal(hasPermission(req, 'inexistente', 'create'), false);
  assert.equal(hasPermission(req, 'requests', 'inexistente'), false);
});

test('dono nunca tem teto, mesmo concedendo tudo', () => {
  const req = { isOwner: true, groupPermissions: {} };
  assert.equal(exceedsOwnCeiling(req, { access_groups: { create: true }, requests: { approve: true } }), false);
});

test('colaborador sem grupo nao pode conceder o que o padrao ja nao libera', () => {
  const req = { isOwner: false, groupPermissions: {} };
  // Padrão já libera requests.create -- conceder isso não excede o teto.
  assert.equal(exceedsOwnCeiling(req, { requests: { create: true } }), false);
  // Padrão não libera access_groups.create -- conceder isso excede.
  assert.equal(exceedsOwnCeiling(req, { access_groups: { create: true } }), true);
});

test('colaborador com permissao de criar grupo so pode conceder ate o proprio teto', () => {
  const req = { isOwner: false, groupPermissions: { access_groups: { create: true }, users: { create: true } } };
  assert.equal(exceedsOwnCeiling(req, { access_groups: { create: true }, users: { create: true } }), false);
  // Tentando conceder aprovação de solicitações, que ele mesmo não tem.
  assert.equal(exceedsOwnCeiling(req, { requests: { approve: true } }), true);
});

test('conceder false ou omitir nunca excede o teto', () => {
  const req = { isOwner: false, groupPermissions: {} };
  assert.equal(exceedsOwnCeiling(req, { requests: { approve: false }, access_groups: {} }), false);
  assert.equal(exceedsOwnCeiling(req, {}), false);
  assert.equal(exceedsOwnCeiling(req, undefined), false);
});

test('solicitacoes concluidas nao podem mudar de estado', () => {
  for (const status of ['approved', 'rejected', 'cancelled']) {
    assert.equal(canTransitionRequest(status, 'in_review'), false);
    assert.equal(canTransitionRequest(status, 'approved'), false);
  }
});

test('fluxo pendente e em analise permite apenas transicoes previstas', () => {
  assert.equal(canTransitionRequest('pending', 'in_review'), true);
  assert.equal(canTransitionRequest('in_review', 'approved'), true);
  assert.equal(canTransitionRequest('in_review', 'pending'), false);
  assert.equal(canTransitionRequest('pending', 'invalid'), false);
});
