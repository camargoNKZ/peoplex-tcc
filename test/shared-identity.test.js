const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

function load(file, { query, admin = {}, signIn }) {
  const stub = (path, exports) => { const id = require.resolve(path); require.cache[id] = { id, filename: id, loaded: true, exports }; };
  stub('../src/config/db', { query, connect: async () => ({ query, release() {} }) });
  stub('../src/config/supabase', { isConfigured: true, supabaseAdmin: { auth: { admin } }, createAuthClient: () => ({ auth: { signInWithPassword: signIn } }) });
  delete require.cache[require.resolve(file)];
  return require(file);
}
const response = () => ({ status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, send() { return this; } });

for (const ok of [false, true]) {
  test(`login nunca redefine senha de identidade existente (senha ${ok ? 'certa' : 'errada'})`, async () => {
    const calls = [];
    const { ensureAuthUser } = load('../src/controllers/authController', {
      query: async sql => { calls.push(sql); return { rows: [] }; },
      admin: { createUser: async () => ({ error: new Error('exists') }), updateUserById: async () => assert.fail('trocou a senha') },
      signIn: async () => ok ? { data: { user: { id: 'a' } } } : { error: new Error('x'), data: {} },
    });
    const id = await ensureAuthUser({ id: 1, company_id: 1, email: 'v@x.example', password_hash: await bcrypt.hash('atacante', 4) }, 'atacante');
    assert.equal(id, ok ? 'a' : null);
    assert.equal(calls.length, ok ? 1 : 0);
  });
  test(`excluir ${ok ? 'preserva' : 'remove'} identidade ${ok ? 'compartilhada' : 'exclusiva'}`, async () => {
    let removed = 0;
    const { excluir } = load('../src/controllers/usersController', {
      query: async sql => /FOR UPDATE/.test(sql) ? { rows: [{ id: 2, email: 'v@x', auth_user_id: 'a' }] }
        : /platform_admins/.test(sql) ? { rows: ok ? [{}] : [] } : { rows: [] },
      admin: { deleteUser: async () => { removed++; } },
    });
    const res = response();
    await excluir({ companyId: 1, userId: 1, isOwner: true, params: { id: '2' } }, res);
    assert.equal(res.code, 204);
    assert.equal(removed, ok ? 0 : 1);
  });
}

test('cadastro recusa e-mail existente em outra empresa', async () => {
  const { cadastrar } = load('../src/controllers/usersController', {
    query: async sql => /user_limit/.test(sql) ? { rows: [{ user_limit: 9, active_users: 1 }] }
      : /platform_admins/.test(sql) && !/company_id/.test(sql) ? { rows: [{}] }
      : /INSERT INTO users/.test(sql) ? assert.fail('inseriu') : { rows: [] },
  });
  const res = response();
  await cadastrar({ companyId: 1, userId: 1, isOwner: true, body: { name: 'V', email: 'v@x.example', password: 'atacante123' } }, res);
  assert.equal(res.code, 409);
});

test('troca de e-mail acompanha as outras empresas da identidade', async () => {
  const sqls = [];
  const { atualizarPerfil } = load('../src/controllers/usersController', {
    query: async (sql, p) => { sqls.push([sql, p]); return /FOR UPDATE/.test(sql) ? { rows: [{ id: 1, name: 'A', email: 'a@x.example', auth_user_id: 'a' }] } : /RETURNING/.test(sql) ? { rows: [{ id: 1 }] } : { rows: [] }; },
    admin: { updateUserById: async () => ({}) }, signIn: async () => ({ data: { user: { id: 'a' } } }),
  });
  const res = response();
  await atualizarPerfil({ companyId: 1, userId: 1, body: { email: 'b@x.example', currentPassword: 'p' } }, res);
  assert.ok(res.body, 'sem resposta');
  assert.ok(sqls.some(([s, p]) => /WHERE auth_user_id=\$2 AND id!=\$3/.test(s) && p[0] === 'b@x.example' && p[1] === 'a'));
});
