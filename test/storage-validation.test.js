const test = require('node:test');
const assert = require('node:assert/strict');
const { validateUpload } = require('../src/services/storageService');

test('aceita assinatura real de PNG', async () => {
  const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(await validateUpload({ mimetype: 'image/png', buffer }), true);
});

test('rejeita arquivo disfarçado somente pelo MIME', async () => {
  const buffer = Buffer.from('conteúdo executável');
  assert.equal(await validateUpload({ mimetype: 'application/pdf', buffer }), false);
});

test('respeita os tipos permitidos para avatar', async () => {
  const buffer = Buffer.from('%PDF-1.7');
  assert.equal(await validateUpload(
    { mimetype: 'application/pdf', buffer },
    ['image/jpeg', 'image/png']
  ), false);
});
