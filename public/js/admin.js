const TOKEN_KEY = 'px_platform_token';
const REFRESH_KEY = 'px_platform_refresh';
const state = { tenants: [], selected: null, auditLogs: [], auditLoaded: false, admins: [], adminsLoaded: false };
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const icons = () => window.lucide?.createIcons({ attrs: { 'aria-hidden': 'true' } });
const FEATURE_LABELS = {
  messaging: ['Mensageria', 'Conversas diretas, grupos e recibos de leitura'],
  requests: ['Solicitações', 'Fluxos, aprovações e SLAs de RH'],
  notices: ['Comunicados', 'Publicações e comunicação segmentada'],
  analytics: ['Indicadores', 'Headcount, áreas e visão executiva'],
  documents: ['Arquivos do colaborador', 'Upload e armazenamento privado'],
  onboarding: ['Admissão', 'Cadastro e entrada de novos colaboradores'],
  email_broadcast: ['E-mail em massa', 'Disparo segmentado por e-mail para a empresa ou um grupo'],
};
const VIEW_TITLES = { overview: 'Visão geral', tenants: 'Tenants', audit: 'Auditoria', admins: 'Administradores' };
const ACTION_LABELS = {
  'tenant.created': 'Tenant criado',
  'tenant.updated': 'Tenant atualizado',
  'tenant.features_updated': 'Funcionalidades do tenant atualizadas',
  'tenant.configuration_updated': 'Configuração do tenant atualizada',
  'platform_admin.password_changed': 'Senha administrativa alterada',
  'platform_admin.invited': 'Administrador convidado',
  'platform_admin.activated': 'Administrador reativado',
  'platform_admin.deactivated': 'Administrador desativado',
};
const actionLabel = action => ACTION_LABELS[action] || action;
const initials = name => String(name || '?').split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
// Sem isso, todo tenant/admin na tabela saía com o mesmo tenant-logo --
// mesma cor pra todo mundo não ajuda a distinguir linha nenhuma numa lista
// longa. Hash determinístico: o mesmo tenant/admin sempre cai no mesmo tom.
const TENANT_LOGO_TONES = ['', 't1', 't2', 't3', 't4', 't5'];
function tenantLogoTone(seed) {
  const s = String(seed || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return TENANT_LOGO_TONES[Math.abs(h) % TENANT_LOGO_TONES.length];
}

function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  state.auditLoaded = false;
  state.adminsLoaded = false;
}

async function renewSession() {
  const refreshToken = localStorage.getItem(REFRESH_KEY);
  if (!refreshToken) return false;
  try {
    const response = await fetch('/platform/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!response.ok) return false;
    const data = await response.json();
    localStorage.setItem(TOKEN_KEY, data.token);
    localStorage.setItem(REFRESH_KEY, data.refreshToken);
    return true;
  } catch {
    return false;
  }
}

async function request(path, options = {}, allowRefresh = true) {
  const response = await fetch(`/platform${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem(TOKEN_KEY) || ''}`, ...(options.headers || {}) },
  });
  if (response.status === 401 && allowRefresh && await renewSession()) {
    return request(path, options, false);
  }
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403) {
    clearSession();
    showLogin();
  }
  return { ok: response.ok, status: response.status, data };
}

function toast(message, type = 'success') {
  const element = document.createElement('div');
  element.className = `admin-toast ${type}`;
  element.textContent = message;
  $('#admin-toasts').appendChild(element);
  setTimeout(() => element.remove(), 3800);
}

function showLogin() { $('#control-shell').hidden = true; $('#login-shell').hidden = false; }
function showControl() { $('#login-shell').hidden = true; $('#control-shell').hidden = false; switchView('overview'); icons(); }
function open(id) { $(`#${id}`).hidden = false; icons(); }
function close(id) { $(`#${id}`).hidden = true; }
const formatNumber = value => new Intl.NumberFormat('pt-BR').format(Number(value || 0));
function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(1)} GB`;
}

async function login(event) {
  event.preventDefault();
  const button = event.submitter;
  const errorBox = $('#login-error');
  errorBox.hidden = true; button.disabled = true;
  const response = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: $('#admin-email').value.trim(), password: $('#admin-password').value }),
  });
  button.disabled = false;
  if (!response.ok) { errorBox.className = 'form-error'; errorBox.textContent = response.data.error || 'Não foi possível entrar.'; errorBox.hidden = false; return; }
  localStorage.setItem(TOKEN_KEY, response.data.token);
  localStorage.setItem(REFRESH_KEY, response.data.refreshToken);
  showControl();
  await loadData();
}

async function esqueciSenhaAdmin() {
  const errorBox = $('#login-error');
  const email = $('#admin-email').value.trim();
  if (!email) {
    errorBox.className = 'form-error';
    errorBox.textContent = 'Preencha o e-mail administrativo acima, depois clique em "Esqueci minha senha".';
    errorBox.hidden = false;
    return;
  }
  const link = $('#forgot-password-link');
  link.disabled = true;
  await request('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
  link.disabled = false;
  errorBox.className = 'form-success';
  errorBox.textContent = 'Se existir uma conta com esse e-mail, enviamos um link de redefinição de senha.';
  errorBox.hidden = false;
}

async function loadData() {
  const [overview, tenants] = await Promise.all([request('/overview'), request('/tenants')]);
  if (!overview.ok || !tenants.ok) return;
  const data = overview.data;
  $('#metric-tenants').textContent = formatNumber(data.tenants_active);
  $('#metric-tenants-total').textContent = `${formatNumber(data.tenants_total)} cadastrados`;
  $('#metric-users').textContent = formatNumber(data.users_active);
  $('#metric-messages').textContent = formatNumber(data.messages_30d);
  $('#metric-storage').textContent = formatBytes(data.storage_bytes);
  $('#admin-name').textContent = data.admin.name;
  $('#admin-email-label').textContent = data.admin.email;
  state.tenants = tenants.data;
  $('#nav-tenant-count').textContent = state.tenants.length;
  renderTenants();
  renderOverviewRecentTenants();
  loadAuditLogs(); // também alimenta o painel "Atividade recente" da Visão geral
}

function renderOverviewRecentTenants() {
  const el = $('#overview-recent-tenants');
  if (!el) return;
  const rows = [...state.tenants].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 6);
  if (!rows.length) { el.innerHTML = '<p class="panel-empty">Nenhum tenant cadastrado ainda.</p>'; return; }
  el.innerHTML = rows.map(tenant => `<div class="activity-row">
      <div><strong>${esc(tenant.name)}</strong><small>${esc(tenant.slug)} · <span class="plan-pill ${esc(tenant.plan)}">${esc(tenant.plan)}</span></small></div>
      <time>${new Date(tenant.created_at).toLocaleDateString('pt-BR')}</time>
    </div>`).join('');
}

function renderOverviewActivity() {
  const el = $('#overview-activity');
  if (!el) return;
  const rows = state.auditLogs.slice(0, 6);
  if (!rows.length) { el.innerHTML = '<p class="panel-empty">Nenhuma ação registrada ainda.</p>'; return; }
  el.innerHTML = rows.map(log => `<div class="activity-row">
      <div><strong>${esc(actionLabel(log.action))}</strong><small>${log.admin_name ? esc(log.admin_name) : 'Sistema'}${log.tenant_name ? ' · ' + esc(log.tenant_name) : ''}</small></div>
      <time>${new Date(log.created_at).toLocaleDateString('pt-BR')}</time>
    </div>`).join('');
}

function renderTenants(filter = '') {
  const query = filter.trim().toLowerCase();
  const rows = state.tenants.filter(tenant => `${tenant.name} ${tenant.slug} ${tenant.plan}`.toLowerCase().includes(query));
  $('#tenant-table').innerHTML = rows.map(tenant => {
    const usage = Math.min(100, Math.round((Number(tenant.users_active) / Number(tenant.user_limit)) * 100));
    return `<tr><td><div class="tenant-name"><span class="tenant-logo ${tenantLogoTone(tenant.id || tenant.slug || tenant.name)}">${esc(tenant.name.split(/\s+/).slice(0,2).map(part=>part[0]).join('').toUpperCase())}</span><span><strong>${esc(tenant.name)}</strong><small>${esc(tenant.slug)}</small></span></div></td><td><span class="plan-pill ${esc(tenant.plan)}">${esc(tenant.plan)}</span></td><td><div class="usage-cell"><span><b>${tenant.users_active} / ${tenant.user_limit}</b><small>${usage}%</small></span><div class="usage-bar"><i style="width:${usage}%"></i></div></div></td><td><span class="usage-detail"><i data-lucide="messages-square"></i>${formatNumber(tenant.messages_30d)} mensagens</span><span class="usage-detail"><i data-lucide="inbox"></i>${formatNumber(tenant.requests_30d)} solicitações</span></td><td>${formatBytes(tenant.storage_bytes)}</td><td><span class="status-pill ${tenant.active ? '' : 'suspended'}">${tenant.active ? 'Ativo' : 'Suspenso'}</span></td><td><button class="manage-btn" data-manage="${tenant.id}">Gerenciar</button></td></tr>`;
  }).join('');
  $('#empty-state').hidden = rows.length > 0;
  icons();
}

function manageTenant(id) {
  const tenant = state.tenants.find(item => Number(item.id) === Number(id));
  if (!tenant) return;
  state.selected = tenant;
  $('#drawer-name').textContent = tenant.name;
  $('#drawer-slug').textContent = `empresa/${tenant.slug}`;
  $('#drawer-users').textContent = `${tenant.users_active} / ${tenant.user_limit}`;
  $('#drawer-messages').textContent = formatNumber(tenant.messages_30d);
  $('#drawer-plan').value = tenant.plan;
  $('#drawer-limit').value = tenant.user_limit;
  $('#drawer-active').checked = tenant.active;
  $('#feature-list').innerHTML = Object.entries(FEATURE_LABELS).map(([key, [title, detail]]) => `<label class="feature-toggle"><span><strong>${title}</strong><small>${detail}</small></span><input type="checkbox" data-feature-key="${key}" ${tenant.features?.[key] !== false ? 'checked' : ''}><i></i></label>`).join('');
  open('tenant-drawer');
}

function switchView(view) {
  $$('.control-nav[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  $('#view-overview').hidden = view !== 'overview';
  $('#view-tenants').hidden = view !== 'tenants';
  $('#view-audit').hidden = view !== 'audit';
  $('#view-admins').hidden = view !== 'admins';
  $('#view-title').textContent = VIEW_TITLES[view];
  $('#new-tenant-open').hidden = view !== 'tenants';
  $('#invite-admin-open').hidden = view !== 'admins';
  if (view === 'audit' && !state.auditLoaded) loadAuditLogs();
  if (view === 'admins' && !state.adminsLoaded) loadAdmins();
}

async function loadAuditLogs() {
  const response = await request('/audit-logs');
  if (!response.ok) return toast(response.data.error || 'Não foi possível carregar a auditoria.', 'error');
  state.auditLoaded = true;
  state.auditLogs = response.data;
  renderAuditLogs();
  renderOverviewActivity();
}

function renderAuditLogs(filter = '') {
  const query = filter.trim().toLowerCase();
  const rows = state.auditLogs.filter(log =>
    `${actionLabel(log.action)} ${log.admin_name || ''} ${log.tenant_name || ''}`.toLowerCase().includes(query));
  $('#audit-table').innerHTML = rows.map(log => `<tr>
      <td>${new Date(log.created_at).toLocaleString('pt-BR')}</td>
      <td><span class="action-tag">${esc(actionLabel(log.action))}</span></td>
      <td>${log.admin_name ? esc(log.admin_name) : '<em>sistema</em>'}</td>
      <td>${log.tenant_name ? esc(log.tenant_name) : '—'}</td>
      <td class="mono-cell">${esc(log.ip_address || '—')}</td>
      <td><button class="manage-btn" data-audit-detail="${log.id}">Detalhes</button></td>
    </tr>`).join('');
  $('#audit-empty').hidden = rows.length > 0;
  icons();
}

function openAuditDetail(id) {
  const log = state.auditLogs.find(item => Number(item.id) === Number(id));
  if (!log) return;
  $('#audit-detail-action').textContent = actionLabel(log.action);
  $('#audit-detail-title').textContent = log.admin_name || 'Sistema';
  $('#audit-detail-meta').textContent = [
    new Date(log.created_at).toLocaleString('pt-BR'),
    log.tenant_name, log.ip_address,
  ].filter(Boolean).join(' · ');
  $('#audit-detail-json').textContent = JSON.stringify(log.metadata, null, 2);
  open('audit-detail-overlay');
}

async function loadAdmins() {
  const response = await request('/admins');
  if (!response.ok) return toast(response.data.error || 'Não foi possível carregar os administradores.', 'error');
  state.adminsLoaded = true;
  state.admins = response.data;
  renderAdmins();
}

function renderAdmins() {
  $('#admins-table').innerHTML = state.admins.map(admin => `<tr>
      <td><div class="tenant-name"><span class="tenant-logo ${tenantLogoTone(admin.id || admin.email || admin.name)}">${esc(initials(admin.name))}</span><span><strong>${esc(admin.name)}</strong><small>${esc(admin.email)}</small></span></div></td>
      <td>${admin.last_seen_at ? new Date(admin.last_seen_at).toLocaleString('pt-BR') : 'Nunca acessou'}</td>
      <td><span class="status-pill ${admin.active ? '' : 'suspended'}">${admin.active ? 'Ativo' : 'Desativado'}</span></td>
      <td><button class="manage-btn" data-toggle-admin="${admin.id}" data-next="${admin.active ? 'false' : 'true'}">${admin.active ? 'Desativar' : 'Reativar'}</button></td>
    </tr>`).join('');
  icons();
}

async function inviteAdmin(event) {
  event.preventDefault();
  const button = $('#invite-admin-submit'); button.disabled = true;
  const body = { name: $('#invite-admin-name').value.trim(), email: $('#invite-admin-email').value.trim().toLowerCase() };
  const response = await request('/admins', { method: 'POST', body: JSON.stringify(body) });
  button.disabled = false;
  if (!response.ok) return toast(response.data.error || 'Não foi possível convidar.', 'error');
  event.target.reset(); close('invite-admin-overlay'); toast(`Convite enviado para ${body.email}.`); await loadAdmins();
}

async function toggleAdmin(id, next) {
  const response = await request(`/admins/${id}/status`, { method: 'PATCH', body: JSON.stringify({ active: next }) });
  if (!response.ok) return toast(response.data.error || 'Não foi possível atualizar.', 'error');
  toast(next ? 'Administrador reativado.' : 'Administrador desativado.');
  await loadAdmins();
}

async function createTenant(event) {
  event.preventDefault();
  const button = $('#create-tenant-submit'); button.disabled = true;
  const body = {
    name: $('#tenant-name').value.trim(), slug: $('#tenant-slug').value.trim().toLowerCase(),
    plan: $('#tenant-plan').value, userLimit: Number($('#tenant-limit').value),
    adminName: $('#tenant-admin-name').value.trim(), adminEmail: $('#tenant-admin-email').value.trim().toLowerCase(),
    adminPassword: $('#tenant-admin-password').value,
  };
  const response = await request('/tenants', { method: 'POST', body: JSON.stringify(body) });
  button.disabled = false;
  if (!response.ok) return toast(response.data.error || 'Não foi possível criar o tenant.', 'error');
  event.target.reset(); close('create-overlay'); toast(`${body.name} foi criada com sucesso.`); await loadData();
}

async function saveTenant(event) {
  event.preventDefault();
  const tenant = state.selected;
  if (!tenant) return;
  const settings = { plan: $('#drawer-plan').value, userLimit: Number($('#drawer-limit').value), active: $('#drawer-active').checked };
  const features = Object.fromEntries($$('[data-feature-key]').map(input => [input.dataset.featureKey, input.checked]));
  const response = await request(`/tenants/${tenant.id}/configuration`, {
    method: 'PATCH',
    body: JSON.stringify({ ...settings, features }),
  });
  if (!response.ok) return toast(response.data.error || 'Não foi possível salvar.', 'error');
  close('tenant-drawer'); toast('Configurações atualizadas.'); await loadData();
}

async function changePassword(event) {
  event.preventDefault();
  const password = $('#new-admin-password').value;
  if (password !== $('#confirm-admin-password').value) return toast('As senhas não conferem.', 'error');
  const response = await request('/auth/change-password', { method: 'POST', body: JSON.stringify({ password }) });
  if (!response.ok) return toast(response.data.error || 'Não foi possível alterar a senha.', 'error');
  event.target.reset(); close('security-overlay'); toast('Senha administrativa alterada.');
}

$('#platform-login').addEventListener('submit', login);
$('#create-tenant-form').addEventListener('submit', createTenant);
$('#tenant-settings-form').addEventListener('submit', saveTenant);
$('#password-form').addEventListener('submit', changePassword);
$('#tenant-search').addEventListener('input', event => renderTenants(event.target.value));
$('#new-tenant-open').addEventListener('click', () => open('create-overlay'));
$('#security-open').addEventListener('click', () => open('security-overlay'));
$('#refresh-data').addEventListener('click', () => {
  if (!$('#view-audit').hidden) return loadAuditLogs();
  if (!$('#view-admins').hidden) return loadAdmins();
  return loadData();
});
$('#platform-logout').addEventListener('click', () => { clearSession(); showLogin(); });
$('#tenant-table').addEventListener('click', event => { const button = event.target.closest('[data-manage]'); if (button) manageTenant(button.dataset.manage); });
$$('.control-nav[data-view]').forEach(button => button.addEventListener('click', () => switchView(button.dataset.view)));
$('#overview-view-audit').addEventListener('click', () => switchView('audit'));
$('#overview-view-tenants').addEventListener('click', () => switchView('tenants'));
$('#audit-search').addEventListener('input', event => renderAuditLogs(event.target.value));
$('#audit-table').addEventListener('click', event => { const button = event.target.closest('[data-audit-detail]'); if (button) openAuditDetail(button.dataset.auditDetail); });
$('#invite-admin-open').addEventListener('click', () => open('invite-admin-overlay'));
$('#invite-admin-form').addEventListener('submit', inviteAdmin);
$('#admins-table').addEventListener('click', event => {
  const button = event.target.closest('[data-toggle-admin]');
  if (!button) return;
  const next = button.dataset.next === 'true';
  if (!next && !window.confirm('Desativar este administrador? Ele perde acesso ao Control Center.')) return;
  toggleAdmin(button.dataset.toggleAdmin, next);
});
$$('[data-close]').forEach(button => button.addEventListener('click', () => close(button.dataset.close)));
$$('.overlay,.drawer-overlay').forEach(overlay => overlay.addEventListener('click', event => { if (event.target === overlay) close(overlay.id); }));
$('#tenant-name').addEventListener('input', event => { if (!$('#tenant-slug').dataset.touched) $('#tenant-slug').value = event.target.value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''); });
$('#tenant-slug').addEventListener('input', event => { event.target.dataset.touched = 'true'; });

icons();
if (localStorage.getItem(TOKEN_KEY)) { showControl(); loadData(); } else showLogin();
