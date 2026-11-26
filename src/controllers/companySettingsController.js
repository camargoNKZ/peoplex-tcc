const db = require('../config/db');
const { encrypt, decrypt } = require('../utils/crypto');
const emailSvc = require('../services/emailService');

const validEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ''));

async function getEmailSettings(req, res) {
  if (!req.isOwner) return res.status(403).json({ error: 'Acesso restrito ao dono da conta.' });
  try {
    const r = await db.query(
      `SELECT smtp_host, smtp_port, smtp_secure, smtp_user, from_name, from_email, updated_at
         FROM company_email_settings WHERE company_id=$1`,
      [req.companyId]
    );
    if (!r.rows[0]) return res.json({ configured: false });
    // A senha nunca volta pro cliente, nem criptografada -- só a confirmação
    // de que existe uma, pra o formulário saber que pode deixar o campo em
    // branco e manter a atual.
    res.json({ configured: true, ...r.rows[0], smtp_pass_set: true });
  } catch (error) {
    console.error('[CompanySettings getEmailSettings]', error);
    res.status(500).json({ error: 'Erro interno.' });
  }
}

function validateBody(body, { passwordRequired }) {
  const { smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass, from_name, from_email } = body;
  if (!smtp_host || !String(smtp_host).trim()) return 'Host do SMTP é obrigatório.';
  const port = Number(smtp_port);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return 'Porta do SMTP inválida.';
  if (!smtp_user || !String(smtp_user).trim()) return 'Usuário do SMTP é obrigatório.';
  if (passwordRequired && !smtp_pass) return 'Senha do SMTP é obrigatória.';
  if (!from_name || !String(from_name).trim()) return 'Nome do remetente é obrigatório.';
  if (!validEmail(from_email)) return 'E-mail do remetente inválido.';
  if (typeof smtp_secure !== 'boolean') return 'Campo "conexão segura" inválido.';
  return null;
}

async function saveEmailSettings(req, res) {
  if (!req.isOwner) return res.status(403).json({ error: 'Acesso restrito ao dono da conta.' });
  const error = validateBody(req.body, { passwordRequired: false });
  if (error) return res.status(400).json({ error });

  const { smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass, from_name, from_email } = req.body;
  try {
    const existing = await db.query('SELECT smtp_pass_encrypted FROM company_email_settings WHERE company_id=$1', [req.companyId]);
    if (!existing.rows[0] && !smtp_pass) {
      return res.status(400).json({ error: 'Senha do SMTP é obrigatória na primeira configuração.' });
    }
    const passEncrypted = smtp_pass ? encrypt(smtp_pass) : existing.rows[0].smtp_pass_encrypted;

    const r = await db.query(
      `INSERT INTO company_email_settings
         (company_id,smtp_host,smtp_port,smtp_secure,smtp_user,smtp_pass_encrypted,from_name,from_email,updated_by,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
       ON CONFLICT (company_id) DO UPDATE SET
         smtp_host=EXCLUDED.smtp_host, smtp_port=EXCLUDED.smtp_port, smtp_secure=EXCLUDED.smtp_secure,
         smtp_user=EXCLUDED.smtp_user, smtp_pass_encrypted=EXCLUDED.smtp_pass_encrypted,
         from_name=EXCLUDED.from_name, from_email=EXCLUDED.from_email,
         updated_by=EXCLUDED.updated_by, updated_at=NOW()
       RETURNING smtp_host,smtp_port,smtp_secure,smtp_user,from_name,from_email,updated_at`,
      [req.companyId, String(smtp_host).trim(), Number(smtp_port), smtp_secure, String(smtp_user).trim(),
       passEncrypted, String(from_name).trim(), String(from_email).trim().toLowerCase(), req.userId]
    );
    emailSvc.invalidateCompanyTransporter(req.companyId);
    res.json({ configured: true, ...r.rows[0], smtp_pass_set: true });
  } catch (err) {
    console.error('[CompanySettings saveEmailSettings]', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
}

async function deleteEmailSettings(req, res) {
  if (!req.isOwner) return res.status(403).json({ error: 'Acesso restrito ao dono da conta.' });
  try {
    await db.query('DELETE FROM company_email_settings WHERE company_id=$1', [req.companyId]);
    emailSvc.invalidateCompanyTransporter(req.companyId);
    res.status(204).send();
  } catch (error) {
    console.error('[CompanySettings deleteEmailSettings]', error);
    res.status(500).json({ error: 'Erro interno.' });
  }
}

// Testa host/porta/usuário/senha enviando um e-mail de verdade pro próprio
// dono -- sem isso, um SMTP mal configurado só seria descoberto quando
// algum colaborador reclamasse de nunca ter recebido nada.
async function testEmailSettings(req, res) {
  if (!req.isOwner) return res.status(403).json({ error: 'Acesso restrito ao dono da conta.' });
  const usingSaved = !req.body || Object.keys(req.body).length === 0;

  try {
    let settings;
    if (usingSaved) {
      const saved = await db.query(
        'SELECT smtp_host,smtp_port,smtp_secure,smtp_user,smtp_pass_encrypted,from_name,from_email FROM company_email_settings WHERE company_id=$1',
        [req.companyId]
      );
      if (!saved.rows[0]) return res.status(404).json({ error: 'Nenhuma configuração salva pra testar.' });
      settings = { ...saved.rows[0], smtp_pass: decrypt(saved.rows[0].smtp_pass_encrypted) };
    } else {
      const error = validateBody(req.body, { passwordRequired: true });
      if (error) return res.status(400).json({ error });
      settings = req.body;
    }

    const me = await db.query('SELECT email FROM users WHERE id=$1 AND company_id=$2', [req.userId, req.companyId]);
    await emailSvc.testarConfiguracao(settings, me.rows[0].email);
    res.json({ ok: true, sentTo: me.rows[0].email });
  } catch (error) {
    console.error('[CompanySettings testEmailSettings]', error.message);
    res.status(400).json({ error: `Não foi possível enviar: ${error.message}` });
  }
}

module.exports = { getEmailSettings, saveEmailSettings, deleteEmailSettings, testEmailSettings };
