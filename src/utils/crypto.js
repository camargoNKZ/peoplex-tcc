// Criptografia simétrica pra segredos de terceiros que o app precisa poder
// LER de volta (ex.: senha de SMTP de uma empresa) -- diferente de senha de
// login, que é hash de mão única (bcrypt) e nunca precisa ser revertida.
// AES-256-GCM: cada valor leva seu próprio IV aleatório + tag de
// autenticação, concatenados e codificados em base64 num único campo.
const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getKey() {
  const hex = process.env.SMTP_CREDENTIALS_KEY;
  if (!hex || hex.length !== 64) {
    throw Object.assign(new Error('SMTP_CREDENTIALS_KEY ausente ou inválida (precisa de 64 caracteres hex / 32 bytes).'), { status: 503 });
  }
  return Buffer.from(hex, 'hex');
}

function encrypt(plainText) {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

function decrypt(payload) {
  const key = getKey();
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const encrypted = buf.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt };
