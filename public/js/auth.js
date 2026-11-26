// ─────────────────────────────────────────────
// auth.js — Gerenciamento de sessão no navegador
// ─────────────────────────────────────────────

const AUTH_KEYS = {
  token: 'hr_token',
  nome:  'hr_nome',
  isOwner: 'hr_is_owner',
  email: 'hr_email',
  refresh: 'hr_refresh_token',
  expires: 'hr_expires_at',
  companyId: 'hr_company_id',
};

function salvarSessao({ token, refreshToken, expiresAt, name, isOwner, email, companyId }) {
  if (token !== 'demo-token') localStorage.removeItem('hr_demo');
  localStorage.setItem(AUTH_KEYS.token, token);
  localStorage.setItem(AUTH_KEYS.nome,  name);
  localStorage.setItem(AUTH_KEYS.isOwner, isOwner ? 'true' : 'false');
  localStorage.setItem(AUTH_KEYS.email, email || '');
  if (refreshToken) localStorage.setItem(AUTH_KEYS.refresh, refreshToken);
  if (expiresAt) localStorage.setItem(AUTH_KEYS.expires, String(expiresAt));
  // O token do Supabase Auth não é por empresa -- essa é a empresa ativa
  // escolhida (no login, ou depois trocada pelo seletor de workspace sem
  // precisar de um novo login), mandada em todo request via X-Company-Id.
  if (companyId != null) localStorage.setItem(AUTH_KEYS.companyId, String(companyId));
}

// Troca a empresa ativa da sessão atual, sem mexer no token -- usado pelo
// seletor de workspace. Quem chama ainda precisa recarregar a página pra
// todo o estado em memória (listas já carregadas etc.) refletir a nova
// empresa.
function trocarEmpresaAtiva(companyId, { isOwner, name } = {}) {
  if (isOwner !== undefined) localStorage.setItem(AUTH_KEYS.isOwner, isOwner ? 'true' : 'false');
  if (name) localStorage.setItem(AUTH_KEYS.nome, name);
  localStorage.setItem(AUTH_KEYS.companyId, String(companyId));
}

function getToken()   { return localStorage.getItem(AUTH_KEYS.token); }
function getCompanyId() { return localStorage.getItem(AUTH_KEYS.companyId); }
function getNome()    { return localStorage.getItem(AUTH_KEYS.nome);  }
function getEmail()   { return localStorage.getItem(AUTH_KEYS.email); }
function getRefreshToken() { return localStorage.getItem(AUTH_KEYS.refresh); }
function atualizarIdentidade({ name, email }) {
  if (name !== undefined) localStorage.setItem(AUTH_KEYS.nome, name);
  if (email !== undefined) localStorage.setItem(AUTH_KEYS.email, email);
}
// Nome mantido por compatibilidade com o resto do front-end, mas não
// existe mais hierarquia de papéis -- isso é só "é o dono da conta?".
function isAdmin()    { return localStorage.getItem(AUTH_KEYS.isOwner) === 'true'; }
function estaLogado() { return !!getToken(); }

function logout() {
  Object.values(AUTH_KEYS).forEach(k => localStorage.removeItem(k));
  localStorage.removeItem('hr_demo');
  window.location.href = '/login.html';
}

function exigirAuth() {
  if (!estaLogado()) { window.location.href = '/login.html'; return false; }
  return true;
}

function exigirAdmin() {
  if (!exigirAuth()) return false;
  if (!isAdmin()) { window.location.href = '/dashboard.html'; return false; }
  return true;
}

async function renovarSessao() {
  const refreshToken = getRefreshToken();
  if (!refreshToken || refreshToken === 'demo-refresh') return false;
  try {
    const response = await fetch('/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!response.ok) return false;
    const data = await response.json();
    localStorage.setItem(AUTH_KEYS.token, data.token);
    localStorage.setItem(AUTH_KEYS.refresh, data.refreshToken);
    if (data.expiresAt) localStorage.setItem(AUTH_KEYS.expires, String(data.expiresAt));
    window.dispatchEvent(new CustomEvent('peoplex:token-refreshed', { detail: { token: data.token } }));
    return true;
  } catch {
    return false;
  }
}
