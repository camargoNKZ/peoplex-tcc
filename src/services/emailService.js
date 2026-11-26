const nodemailer = require('nodemailer');
const db = require('../config/db');
const { decrypt } = require('../utils/crypto');

const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
}[char]));

// SMTP é por empresa -- cada uma dispara pelo próprio domínio, não por uma
// credencial global do peopleX (que nem existe em produção hoje). O
// transporter de cada empresa é montado sob demanda e fica em cache por
// pouco tempo (evita reconstruir a cada e-mail de um mesmo lote; TTL curto
// o bastante pra uma troca de senha não ficar presa no cache por muito
// tempo).
const transporterCache = new Map(); // companyId -> { transporter, expiresAt }
const TRANSPORTER_CACHE_TTL_MS = 60 * 1000;

async function getCompanySettings(companyId) {
  const r = await db.query(
    `SELECT smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass_encrypted, from_name, from_email
       FROM company_email_settings WHERE company_id=$1`,
    [companyId]
  );
  return r.rows[0] || null;
}

function buildTransporter(settings) {
  return nodemailer.createTransport({
    host: settings.smtp_host,
    port: Number(settings.smtp_port),
    secure: Boolean(settings.smtp_secure),
    auth: { user: settings.smtp_user, pass: settings.smtp_pass },
  });
}

async function getCompanyTransporter(companyId) {
  const cached = transporterCache.get(companyId);
  if (cached && cached.expiresAt > Date.now()) return cached;

  const settings = await getCompanySettings(companyId);
  if (!settings) return null;

  const entry = {
    transporter: buildTransporter({ ...settings, smtp_pass: decrypt(settings.smtp_pass_encrypted) }),
    from: `"${settings.from_name}" <${settings.from_email}>`,
    expiresAt: Date.now() + TRANSPORTER_CACHE_TTL_MS,
  };
  transporterCache.set(companyId, entry);
  return entry;
}

function invalidateCompanyTransporter(companyId) {
  transporterCache.delete(companyId);
}

async function enviarEmail({ companyId, to, subject, html, text }) {
  const entry = await getCompanyTransporter(companyId);
  if (!entry) {
    throw Object.assign(new Error('SMTP não configurado para esta empresa.'), { status: 503 });
  }
  return entry.transporter.sendMail({
    from: entry.from,
    to: Array.isArray(to) ? to.join(', ') : to,
    subject,
    html,
    text: text || html.replace(/<[^>]+>/g, ''),
    disableFileAccess: true,
    disableUrlAccess: true,
  });
}

// Usado pela tela de configurações pra testar host/porta/usuário/senha
// antes (ou depois) de salvar, sem depender do cache de transporter de
// uma configuração já salva.
async function testarConfiguracao(settings, destinatario) {
  const transporter = buildTransporter(settings);
  await transporter.verify();
  await transporter.sendMail({
    from: `"${settings.from_name}" <${settings.from_email}>`,
    to: destinatario,
    subject: 'peopleX — e-mail de teste',
    html: '<p>Se você recebeu este e-mail, a configuração de SMTP da sua empresa no peopleX está funcionando.</p>',
    text: 'Se você recebeu este e-mail, a configuração de SMTP da sua empresa no peopleX está funcionando.',
  });
}

function templateStatusSolicitacao({ nome, tipo, status }) {
  const cor   = { approved: '#22c55e', rejected: '#ef4444', pending: '#f59e0b', in_review: '#3b82f6', cancelled: '#64748b' }[status] || '#64748b';
  const label = { approved: 'Aprovada', rejected: 'Rejeitada', pending: 'Pendente', in_review: 'Em análise', cancelled: 'Cancelada' }[status] || status;
  return `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#f8fafc;">
      <div style="background:white;border-radius:16px;padding:32px;border:1px solid #e2e8f0;">
        <h1 style="color:#1e293b;font-size:20px;font-weight:600;margin:0 0 16px;">Atualização de solicitação</h1>
        <p style="color:#334155;font-size:15px;margin:0 0 16px;">Olá, <strong>${escapeHtml(nome)}</strong></p>
        <p style="color:#334155;font-size:15px;margin:0 0 16px;">
          Sua solicitação de <strong>${escapeHtml(tipo)}</strong> foi atualizada:
        </p>
        <div style="background:#f8fafc;border-radius:12px;padding:16px;border-left:4px solid ${cor};margin:0 0 24px;">
          <p style="color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:.05em;margin:0 0 4px;">Status</p>
          <p style="color:${cor};font-size:20px;font-weight:700;margin:0;">${label}</p>
        </div>
        <p style="color:#94a3b8;font-size:12px;margin:0;border-top:1px solid #f1f5f9;padding-top:16px;">
          E-mail automático — peopleX. Não responda.
        </p>
      </div>
    </div>`;
}

function templateAviso({ titulo, conteudo, prioridade, autor }) {
  const cor = { urgent: '#ef4444', important: '#f59e0b', normal: '#4f46e5' }[prioridade] || '#4f46e5';
  const lbl = { urgent: '⚠ Urgente', important: '★ Importante', normal: 'Aviso' }[prioridade] || 'Aviso';
  return `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;">
      <div style="background:white;border-radius:16px;padding:32px;border:1px solid #e2e8f0;">
        <div style="margin-bottom:16px;">
          <span style="background:${cor}22;color:${cor};font-size:11px;font-weight:700;
                       padding:4px 10px;border-radius:20px;text-transform:uppercase;">${lbl}</span>
        </div>
        <h1 style="color:#1e293b;font-size:20px;font-weight:600;margin:0 0 16px;">${escapeHtml(titulo)}</h1>
        <div style="color:#334155;font-size:15px;line-height:1.7;white-space:pre-wrap;margin:0 0 24px;">${escapeHtml(conteudo)}</div>
        <p style="color:#94a3b8;font-size:12px;margin:0;border-top:1px solid #f1f5f9;padding-top:16px;">
          Enviado por <strong>${escapeHtml(autor)}</strong> via peopleX.
        </p>
      </div>
    </div>`;
}

module.exports = {
  enviarEmail, testarConfiguracao, invalidateCompanyTransporter,
  templateStatusSolicitacao, templateAviso, escapeHtml,
};
