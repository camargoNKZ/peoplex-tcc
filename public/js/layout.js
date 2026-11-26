// ─────────────────────────────────────────────
// layout.js — Sidebar + toasts compartilhados
// Inclua em toda página protegida (após auth.js e api.js),
// junto com /css/app.css e a lib lucide.
// ─────────────────────────────────────────────

const lucideRefresh = () => window.lucide?.createIcons({ attrs: { 'aria-hidden': 'true' } });

function esc(value = '') {
  return String(value).replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[char]));
}

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', href: '/dashboard.html', icon: 'layout-dashboard', visible: () => true },
  { id: 'perfil', label: 'Meu perfil', href: '/perfil.html', icon: 'folder-lock', visible: () => true },
  { id: 'cadastro', label: 'Admissão', href: '/cadastro.html', icon: 'user-round-plus', visible: (owner, perms) => owner || Boolean(perms.users?.create) },
  { id: 'grupos', label: 'Grupos de acesso', href: '/grupos.html', icon: 'shield-check', visible: (owner, perms) => owner || Boolean(perms.access_groups?.create) },
  { id: 'tipos-solicitacao', label: 'Tipos de solicitação', href: '/tipos-solicitacao.html', icon: 'list-checks', visible: (owner, perms) => owner || Boolean(perms.request_types?.create) || Boolean(perms.request_types?.edit) || Boolean(perms.request_types?.delete) },
  { id: 'configuracoes', label: 'Configurações', href: '/configuracoes.html', icon: 'settings', visible: owner => owner },
];

function getPageId() {
  const p = window.location.pathname;
  if (p.includes('dashboard'))         return 'dashboard';
  if (p.includes('perfil'))            return 'perfil';
  if (p.includes('cadastro'))          return 'cadastro';
  if (p.includes('grupos'))            return 'grupos';
  if (p.includes('tipos-solicitacao')) return 'tipos-solicitacao';
  if (p.includes('configuracoes'))     return 'configuracoes';
  return 'dashboard';
}

async function injectSidebar() {
  const activeId = getPageId();
  const nome     = getNome() || 'Usuário';
  const owner    = isAdmin();
  let permissions = {};
  if (!owner) {
    const r = await Dashboard.overview();
    if (r?.ok) permissions = r.data.permissions || {};
  }

  const navHtml = NAV_ITEMS
    .filter(i => i.visible(owner, permissions))
    .map(i => `
      <a href="${i.href}" class="nav-item${i.id === activeId ? ' active' : ''}">
        <i data-lucide="${i.icon}"></i><span>${esc(i.label)}</span>
      </a>`).join('');

  const sidebar = document.createElement('aside');
  sidebar.id = 'sidebar';
  sidebar.className = 'sidebar';
  sidebar.innerHTML = `
    <div class="brand-row">
      <div class="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="9" cy="12" r="6" fill="#fff" fill-opacity=".92"/><circle cx="15" cy="12" r="6" fill="#fff" fill-opacity=".52"/></svg></div>
      <div><strong>peopleX</strong><span>people operating system</span></div>
      <button class="icon-btn mobile-close" id="close-sidebar" aria-label="Fechar menu">×</button>
    </div>
    <nav class="main-nav" aria-label="Navegação principal">${navHtml}</nav>
    <div class="sidebar-footer">
      <button class="user-card" type="button" onclick="window.location.href='/perfil.html'">
        <span class="avatar avatar-violet" id="sidebar-avatar">${esc(nome[0]?.toUpperCase() || '?')}</span>
        <span><strong>${esc(nome)}</strong><small>${owner ? 'Dono da conta' : 'Colaborador'}</small></span>
      </button>
      <button class="sidebar-logout" type="button" onclick="logout()"><i data-lucide="log-out"></i><span>Sair</span></button>
    </div>`;

  const shell = document.querySelector('.app-shell');
  (shell || document.body).insertAdjacentElement('afterbegin', sidebar);
}

function wireSidebarToggle() {
  document.getElementById('open-sidebar')?.addEventListener('click', () => document.getElementById('sidebar')?.classList.add('open'));
  document.getElementById('close-sidebar')?.addEventListener('click', () => document.getElementById('sidebar')?.classList.remove('open'));
}

function injectToastContainer() {
  if (document.getElementById('toast-stack')) return;
  const el = document.createElement('div');
  el.id = 'toast-stack';
  el.className = 'toast-stack';
  document.body.appendChild(el);
}

window.showToast = function (message, type = 'success') {
  const stack = document.getElementById('toast-stack');
  if (!stack) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<i data-lucide="${type === 'error' ? 'circle-alert' : 'circle-check'}"></i><span>${esc(message)}</span>`;
  stack.appendChild(el);
  lucideRefresh();
  setTimeout(() => el.remove(), 3800);
};

window.atualizarAvatarSidebar = function (photoUrl) {
  const av = document.getElementById('sidebar-avatar');
  if (av && photoUrl) av.innerHTML = `<img src="${photoUrl}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" alt="Foto"/>`;
};

// ── Inicializa ao carregar ──
(async function init() {
  if (!exigirAuth()) return;
  await injectSidebar();
  injectToastContainer();
  wireSidebarToggle();
  lucideRefresh();
})();
