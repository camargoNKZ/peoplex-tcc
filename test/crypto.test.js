// Unitário e rápido (sem rede/banco) -- protege a criptografia da senha de
// SMTP de cada empresa (src/utils/crypto.js), que não tinha nenhum teste.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SMTP_CREDENTIALS_KEY = process.env.SMTP_CREDENTIALS_KEY
  || '0'.repeat(64); // chave só pra rodar o teste; produção usa a real, vinda do ambiente

const { encrypt, decrypt } = require('../src/utils/crypto');

test('encrypt/decrypt fazem ida e volta sem perder o conteúdo', () => {
  const original = 'senha-super-secreta-123!@#';
  const encrypted = encrypt(original);
  assert.notEqual(encrypted, original);
  assert.equal(decrypt(encrypted), original);
});

test('duas criptografias do mesmo valor nao sao iguais (IV aleatorio)', () => {
  const a = encrypt('mesma-senha');
  const b = encrypt('mesma-senha');
  assert.notEqual(a, b);
  assert.equal(decrypt(a), 'mesma-senha');
  assert.equal(decrypt(b), 'mesma-senha');
});

test('decrypt rejeita payload adulterado (tag de autenticacao)', () => {
  const encrypted = encrypt('dado-original');
  const tampered = encrypted.slice(0, -4) + 'AAAA';
  assert.throws(() => decrypt(tampered));
});

test('sem SMTP_CREDENTIALS_KEY valida, encrypt recusa (nunca grava em texto puro)', () => {
  const saved = process.env.SMTP_CREDENTIALS_KEY;
  delete process.env.SMTP_CREDENTIALS_KEY;
  delete require.cache[require.resolve('../src/utils/crypto')];
  const { encrypt: encryptSemChave } = require('../src/utils/crypto');
  assert.throws(() => encryptSemChave('qualquer coisa'));
  process.env.SMTP_CREDENTIALS_KEY = saved;
  delete require.cache[require.resolve('../src/utils/crypto')];
});
