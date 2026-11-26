// ─────────────────────────────────────────────
// api.js — Camada centralizada de chamadas HTTP
// ─────────────────────────────────────────────

const API_BASE = window.location.origin;

async function apiRequest(method, path, body = null, isFormData = false, allowRefresh = true) {
  const token   = getToken();
  const headers = { Authorization: `Bearer ${token}` };
  if (!isFormData) headers['Content-Type'] = 'application/json';
  const companyId = typeof getCompanyId === 'function' ? getCompanyId() : null;
  if (companyId) headers['X-Company-Id'] = companyId;

  const options = { method, headers };
  if (body) options.body = isFormData ? body : JSON.stringify(body);

  try {
    const res = await fetch(`${API_BASE}${path}`, options);
    if (res.status === 401 && allowRefresh) {
      const renewed = await renovarSessao();
      if (renewed) return apiRequest(method, path, body, isFormData, false);
      logout();
      return null;
    }
    if (res.status === 204) return { ok: true, status: 204, data: {} };
    const data = await res.json();
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    console.error(`[API] ${method} ${path}:`, err.message);
    return { ok: false, status: 0, data: { error: 'Sem conexão com o servidor.' } };
  }
}

// ── Auth ──
const Auth = {
  login: (slug, email, password) =>
    fetch(`${API_BASE}/auth/login`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ slug, email, password }),
    }).then(r => ({ ok: r.ok, status: r.status, data: r.json() }))
     .then(async r => ({ ...r, data: await r.data })),
  minhasEmpresas: () => apiRequest('GET', '/auth/my-companies'),
};

// ── Solicitações ──
const Requests = {
  listar:          ()                          => apiRequest('GET',   '/requests'),
  criar:           (requestTypeId, description)=> apiRequest('POST',  '/requests', { requestTypeId, description }),
  atualizarStatus: (id, status)                => apiRequest('PATCH', `/requests/${id}/status`, { status }),
  editar:          (id, description)           => apiRequest('PATCH', `/requests/${id}`, { description }),
  excluir:         (id)                        => apiRequest('DELETE', `/requests/${id}`),
};

// ── Tipos de solicitação ──
const RequestTypes = {
  listar:      ()         => apiRequest('GET',    '/request-types'),
  listarAdmin: ()         => apiRequest('GET',    '/request-types/admin'),
  criar:       (body)     => apiRequest('POST',   '/request-types', body),
  atualizar:   (id, body) => apiRequest('PATCH',  `/request-types/${id}`, body),
  excluir:     (id)       => apiRequest('DELETE', `/request-types/${id}`),
};

// ── Usuários ──
const Users = {
  listar:           ()     => apiRequest('GET',  '/users'),
  diretorio:        ()     => apiRequest('GET',  '/users/directory'),
  cadastrar:        (body) => apiRequest('POST', '/users', body),
  alterarStatus:    (id, active) => apiRequest('PATCH', `/users/${id}/status`, { active }),
  atualizarGrupo:   (id, access_group_id) => apiRequest('PATCH', `/users/${id}/group`, { access_group_id }),
  atualizarFeatures: (id, features) => apiRequest('PATCH', `/users/${id}/features`, features),
  excluir:          (id)         => apiRequest('DELETE', `/users/${id}`),
  perfil:           ()     => apiRequest('GET',  '/users/profile'),
  atualizarPerfil:  (body) => apiRequest('PUT',  '/users/profile', body),
  uploadFoto:       (form) => apiRequest('POST', '/users/photo',     form, true),
  uploadDocumento:  (form) => apiRequest('POST', '/users/documents', form, true),
  listarDocumentos: ()     => apiRequest('GET',  '/users/documents'),
};

// ── Grupos de acesso ──
const AccessGroups = {
  listar:     ()           => apiRequest('GET',   '/access-groups'),
  criar:      (body)       => apiRequest('POST',  '/access-groups', body),
  atualizar:  (id, body)   => apiRequest('PATCH', `/access-groups/${id}`, body),
  excluir:    (id)         => apiRequest('DELETE', `/access-groups/${id}`),
};

// ── Avisos ──
const Notices = {
  listar:  ()     => apiRequest('GET',    '/notices'),
  criar:   (body) => apiRequest('POST',   '/notices', body),
  marcarLidas: (ids) => apiRequest('POST', '/notices/read', { ids }),
  editar:  (id, body) => apiRequest('PATCH', `/notices/${id}`, body),
  remover: (id)   => apiRequest('DELETE', `/notices/${id}`),
};

// ── E-mails ──
const Emails = {
  broadcast: (body) => apiRequest('POST', '/emails/broadcast', body),
  logs:      ()     => apiRequest('GET',  '/emails/logs'),
};

// ── Mensageria ──
const Messages = {
  conversas:       ()             => apiRequest('GET',  '/messages/conversations'),
  criarConversa:   (body)         => apiRequest('POST', '/messages/conversations', body),
  mensagens:       (id)           => apiRequest('GET',  `/messages/conversations/${id}`),
  enviar:          (id, body)     => apiRequest('POST', `/messages/conversations/${id}/messages`, body),
  marcarComoLida:  (id)           => apiRequest('POST', `/messages/conversations/${id}/read`),
  enviarAnexo:     (form)         => apiRequest('POST', '/messages/attachments', form, true),
  removerAnexo:    (path)         => apiRequest('DELETE', '/messages/attachments', { path }),
};

// ── Pesquisa de clima ──
const Climate = {
  status:      ()     => apiRequest('GET',  '/climate/status'),
  responder:   (body) => apiRequest('POST', '/climate/respond', body),
  abrirRodada: ()     => apiRequest('POST', '/climate/rounds'),
};

// ── Visão executiva ──
const Dashboard = {
  overview: () => apiRequest('GET', '/dashboard/overview'),
  analytics: () => apiRequest('GET', '/dashboard/analytics'),
  realtimeConfig: () => apiRequest('GET', '/dashboard/realtime-config'),
};

// ── Configurações da empresa ──
const CompanySettings = {
  obterEmail:  ()     => apiRequest('GET',    '/company/email'),
  salvarEmail: (body) => apiRequest('PUT',    '/company/email', body),
  removerEmail: ()    => apiRequest('DELETE', '/company/email'),
  testarEmail: (body) => apiRequest('POST',   '/company/email/test', body || {}),
};
