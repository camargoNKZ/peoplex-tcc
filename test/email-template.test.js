const test = require('node:test');
const assert = require('node:assert/strict');
const { escapeHtml, templateAviso } = require('../src/services/emailService');

test('escape de HTML protege conteúdo enviado por usuários', () => {
  assert.equal(escapeHtml('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
});

test('template de comunicado não injeta HTML do conteúdo', () => {
  const html = templateAviso({
    titulo: '<script>alert(1)</script>',
    conteudo: '<a href="https://malicioso.invalid">clique</a>',
    prioridade: 'urgent',
    autor: '<b>RH</b>',
  });
  assert.equal(html.includes('<script>alert(1)</script>'), false);
  assert.equal(html.includes('<a href="https://malicioso.invalid">'), false);
  assert.equal(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), true);
});
