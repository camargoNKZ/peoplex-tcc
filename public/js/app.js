/* peopleX app shell — API first, with an explicit local demonstration mode. */
const sessionToken = getToken();
if (sessionToken && sessionToken !== 'demo-token') localStorage.removeItem('hr_demo');
const state = {
  demo: sessionToken === 'demo-token',
  currentView: 'overview',
  activeConversation: 1,
  conversationFilter: 'all',
  requestFilter: 'all',
  peopleShowInactive: true,
  peopleSortBy: 'name',
  activeMessages: [],
  pendingAttachment: null,
  pendingMessageId: null,
  sendingMessage: false,
  celebrationUser: null,
  conversations: [],
  people: [],
  accessGroups: [],
  requests: [],
  notices: [],
  analytics: null,
  features: {},
  permissions: { requests: {}, notices: {}, request_types: {}, climate: {} },
  climate: null,
  realtimeClient: null,
  realtimeChannel: null,
  realtimeConnected: false,
  realtimeSync: Promise.resolve(),
  chatFallbackTimer: null,
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (value = '') => String(value).replace(/[&<>'"]/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[char]));
const initials = name => String(name || 'PX').split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
const FEATURE_LABELS = {
  messaging: 'Mensageria',
  requests: 'Solicitações',
  notices: 'Comunicados',
  analytics: 'Indicadores',
  documents: 'Arquivos do colaborador',
  onboarding: 'Admissão',
  email_broadcast: 'E-mail em massa',
};
// Gerenciar pessoas (grupo, status, exclusão) é exclusivo do dono da conta
// -- isso só esconde os controles que o servidor recusaria de qualquer
// forma. A autorização de verdade é sempre revalidada na API.
function podeGerenciarPessoa(target) {
  if (target.is_owner) return false;
  return isAdmin();
}
const statusLabel = status => ({ pending: 'Pendente', in_review: 'Em análise', approved: 'Aprovada', rejected: 'Rejeitada', cancelled: 'Cancelada' }[status] || status);
const statusPillClass = status => ({ pending: 'pending', in_review: 'review', approved: 'approved', rejected: 'rejected', cancelled: 'cancelled' }[status] || '');
const formatDate = date => new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' }).format(new Date(date));
const lucideRefresh = () => window.lucide?.createIcons({ attrs: { 'aria-hidden': 'true' } });
const viewFeature = { messages: 'messaging', requests: 'requests', communications: 'notices', analytics: 'analytics' };

// Fixtures criadas para avaliação: pessoas, mensagens e indicadores fictícios.
const demo = {
  people: [
    { id: 1, name: 'Pessoa Demo 01', email: 'pessoa01@example.invalid', role: 'admin', department: 'Pessoas & Cultura', job_title: 'Head de Pessoas', active: true, hire_date: '2024-09-02', tone: 'violet' },
    { id: 2, name: 'Pessoa Demo 02', email: 'pessoa02@example.invalid', role: 'employee', department: 'Produto', job_title: 'Product Designer', active: true, hire_date: '2025-09-02', tone: 'yellow' },
    { id: 3, name: 'Pessoa Demo 03', email: 'pessoa03@example.invalid', role: 'manager', department: 'Comercial', job_title: 'Gerente Comercial', active: true, hire_date: '2024-01-15', tone: 'coral' },
    { id: 4, name: 'Pessoa Demo 04', email: 'pessoa04@example.invalid', role: 'employee', department: 'Tecnologia', job_title: 'Engenheiro de Software', active: true, hire_date: '2025-03-10', tone: 'blue' },
    { id: 5, name: 'Pessoa Demo 05', email: 'pessoa05@example.invalid', role: 'hr', department: 'Pessoas & Cultura', job_title: 'People Partner', active: true, hire_date: '2025-06-03', tone: 'sand' },
    { id: 6, name: 'Pessoa Demo 06', email: 'pessoa06@example.invalid', role: 'employee', department: 'Operações', job_title: 'Analista de Operações', active: true, hire_date: '2025-11-12', tone: 'mint' },
    { id: 7, name: 'Pessoa Demo 07', email: 'pessoa07@example.invalid', role: 'employee', department: 'Marketing', job_title: 'Content Lead', active: true, hire_date: '2026-02-02', tone: 'violet' },
    { id: 8, name: 'Pessoa Demo 08', email: 'pessoa08@example.invalid', role: 'manager', department: 'Financeiro', job_title: 'Controller', active: true, hire_date: '2023-08-21', tone: 'blue' },
  ],
  requests: [
    { id: 1048, tipo: 'Reembolso', funcionario: 'Pessoa Demo 06', status: 'pending', created_at: '2026-09-02T10:30:00', sla: '2h restantes', description: 'Visita ao cliente — agosto' },
    { id: 1047, tipo: 'Férias', funcionario: 'Pessoa Demo 02', status: 'in_review', created_at: '2026-09-02T09:10:00', sla: '18h restantes', description: '15 dias a partir de 05/10' },
    { id: 1046, tipo: 'Atualização cadastral', funcionario: 'Pessoa Demo 07', status: 'pending', created_at: '2026-09-01T15:20:00', sla: 'Vence hoje', description: 'Alteração de dados bancários' },
    { id: 1045, tipo: 'Declaração', funcionario: 'Pessoa Demo 04', status: 'approved', created_at: '2026-09-01T11:00:00', sla: 'Concluída', description: 'Declaração de vínculo' },
    { id: 1044, tipo: 'Reembolso', funcionario: 'Pessoa Demo 03', status: 'rejected', created_at: '2026-08-31T14:30:00', sla: 'Concluída', description: 'Almoço comercial' },
  ],
  notices: [
    { id: 1, title: 'Novo benefício: terapia online', content: 'A partir deste mês, todas as pessoas terão acesso a quatro sessões mensais pela plataforma parceira.', priority: 'important', created_at: '2026-09-02', autor: 'Pessoa Demo 01', read: 94 },
    { id: 2, title: 'Pesquisa de clima — setembro', content: 'A pesquisa leva menos de cinco minutos. As respostas são confidenciais e ficam abertas até sexta-feira.', priority: 'normal', created_at: '2026-09-01', autor: 'Pessoa Demo 05', read: 82 },
    { id: 3, title: 'Manutenção programada no escritório', content: 'O 3º andar ficará indisponível na próxima segunda. Recomendamos trabalho remoto para as equipes afetadas.', priority: 'urgent', created_at: '2026-08-29', autor: 'Operações', read: 100 },
    { id: 4, title: 'Boas-vindas às novas pessoas', content: 'Recebemos três novas pessoas nos times de Produto, Comercial e Marketing. Dê um oi no canal #geral!', priority: 'normal', created_at: '2026-08-27', autor: 'Pessoa Demo 01', read: 89 },
    { id: 5, title: 'Calendário de feriados 2027', content: 'O calendário preliminar já está disponível na central de documentos para planejamento das equipes.', priority: 'normal', created_at: '2026-08-25', autor: 'Pessoas & Cultura', read: 76 },
    { id: 6, title: 'Resultados do trimestre', content: 'Superamos a meta em 12%. Obrigado pelo foco e pela colaboração entre os times neste ciclo.', priority: 'important', created_at: '2026-08-22', autor: 'Diretoria', read: 97 },
  ],
  conversations: [
    { id: 1, name: 'Pessoas & Cultura', type: 'group', last_message: 'Demo 05: Atualizei a política de férias', time: '10:42', unread_count: 2, tone: 'mint', initials: 'PC' },
    { id: 2, name: 'Pessoa Demo 03', type: 'direct', last_message: 'Perfeito, obrigada pela ajuda!', time: '09:18', unread_count: 1, tone: 'coral', initials: 'CS' },
    { id: 3, name: 'Lideranças', type: 'group', last_message: 'Demo 01: O material já está no drive', time: 'Ontem', unread_count: 1, tone: 'violet', initials: 'LI' },
    { id: 4, name: 'Pessoa Demo 02', type: 'direct', last_message: 'Você: Parabéns pelo primeiro ano!', time: 'Ontem', unread_count: 0, tone: 'yellow', initials: 'JS' },
    { id: 5, name: 'Geral • Empresa Demonstração', type: 'announcement', last_message: 'Pesquisa de clima disponível', time: 'Seg', unread_count: 0, tone: 'blue', initials: 'EA' },
  ],
  messages: {
    1: [
      { id: 1, sender_name: 'Pessoa Demo 05', body: 'Bom dia, time! Compartilhei a versão revisada da política de férias. As mudanças estão destacadas no documento.', created_at: '2026-09-02T09:34:00', own: false, tone: 'sand' },
      { id: 2, sender_name: 'Pessoa Demo 01', body: 'Mensagem fictícia recebida. A regra de fracionamento ficou bem mais clara agora.', created_at: '2026-09-02T09:48:00', own: true, tone: 'violet' },
      { id: 3, sender_name: 'Pessoa Demo 04', body: 'Podemos divulgar no canal geral ainda hoje? O time de Produto tinha algumas dúvidas sobre esse ponto.', created_at: '2026-09-02T10:16:00', own: false, tone: 'blue' },
      { id: 4, sender_name: 'Pessoa Demo 05', body: 'Sim! Vou preparar um comunicado curto com o link para a política completa.', created_at: '2026-09-02T10:42:00', own: false, tone: 'sand' },
    ],
    2: [{ id: 5, sender_name: 'Pessoa Demo 03', body: 'Olá, Demo 01! Consegui ajustar as aprovações do meu time. Perfeito, obrigada pela ajuda!', created_at: '2026-09-02T09:18:00', own: false, tone: 'coral' }],
    3: [{ id: 6, sender_name: 'Pessoa Demo 01', body: 'O material da reunião mensal já está disponível para revisão.', created_at: '2026-09-01T16:20:00', own: true, tone: 'violet' }],
    4: [{ id: 7, sender_name: 'Pessoa Demo 01', body: 'Parabéns pelo primeiro ano com a gente, Demo 02! 🎉', created_at: '2026-09-01T14:00:00', own: true, tone: 'violet' }],
    5: [{ id: 8, sender_name: 'Pessoas & Cultura', body: 'A pesquisa de clima de setembro já está disponível.', created_at: '2026-08-31T12:00:00', own: false, tone: 'mint' }],
  },
};

const AVATAR_TONES = ['violet', 'mint', 'yellow', 'blue', 'coral', 'sand'];
// Nenhum controller do backend manda uma cor de avatar -- sem isso, todo
// mundo caía no tone padrão e a lista de pessoas/conversas/mensagens real
// ficava inteira da mesma cor, só o modo demo (que passa o tone à mão)
// mostrava a variedade. Hash determinístico: a mesma pessoa sempre cai na
// mesma cor, sem precisar de nada vindo do servidor.
function toneFor(seed) {
  const s = String(seed || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return AVATAR_TONES[Math.abs(h) % AVATAR_TONES.length];
}
function avatar(name, tone) {
  const value = /^[A-Z0-9]{1,3}$/.test(String(name)) ? String(name) : initials(name);
  return `<span class="avatar avatar-${esc(tone || toneFor(name))}">${esc(value)}</span>`;
}

function showToast(message, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<i data-lucide="${type === 'error' ? 'circle-alert' : 'circle-check'}"></i><span>${esc(message)}</span>`;
  $('#toast-stack').appendChild(el);
  lucideRefresh();
  setTimeout(() => el.remove(), 3800);
}

function setIdentity() {
  const name = state.demo ? 'Pessoa Demo 01' : (getNome() || 'Usuário');
  const owner = state.demo ? true : isAdmin();
  $('#first-name').textContent = name.split(' ')[0];
  $('#side-user').textContent = name;
  $('#side-role').textContent = owner ? 'Dono da conta' : 'Colaborador';
  $('#side-avatar').textContent = initials(name);
  $$('.top-profile .avatar').forEach(el => el.textContent = initials(name));
  $$('.admin-only').forEach(el => el.hidden = !owner);
  if (!state.demo) $('#demo-chip').hidden = true;
}

function setDataSaudacao() {
  const agora = new Date();
  const hora = agora.getHours();
  $('#greeting').textContent = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';
  const data = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(agora);
  $('#today-date').textContent = data.charAt(0).toUpperCase() + data.slice(1);
}

function applyAvatarPhoto(photoUrl) {
  if (!photoUrl) return;
  $$('#side-avatar, .top-profile .avatar').forEach(el => {
    el.innerHTML = `<img src="${esc(photoUrl)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
  });
}

function applyFeatures() {
  $$('[data-feature]').forEach(element => {
    if (element.dataset.permission) return; // combinado com a checagem de permissão abaixo
    element.hidden = state.features[element.dataset.feature] === false;
  });
  $$('[data-permission]').forEach(element => {
    // Aceita uma ou mais permissões separadas por vírgula (ex.: "request_types.create,request_types.edit") -- visível se tiver qualquer uma delas.
    const pares = element.dataset.permission.split(',').map(p => p.trim().split('.'));
    const permitido = state.demo || isAdmin() || pares.some(([resource, action]) => Boolean(state.permissions[resource]?.[action]));
    const featureKey = element.dataset.feature;
    const featureOk = !featureKey || state.features[featureKey] !== false;
    element.hidden = !(permitido && featureOk);
  });
}

function climateLabel(geral) {
  if (geral >= 8) return 'Excelente';
  if (geral >= 6) return 'Bom';
  if (geral >= 4) return 'Regular';
  return 'Preocupante';
}

function renderClimate() {
  const c = state.climate;
  const fmt = n => n.toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 1 });

  $('#climate-prompt').hidden = !c?.pendingResponse;

  if (!c?.atual) {
    $('#metric-climate').innerHTML = '—<em>/10</em>';
    $('#metric-climate-delta').textContent = 'Nenhuma pesquisa aberta ainda';
    $('#culture-pct').innerHTML = '—<small>%</small>';
    $('#culture-label').textContent = 'Sem dados';
    $('#culture-period').textContent = 'Nenhuma rodada';
    $('#climate-admin-sub').textContent = 'Nenhuma pesquisa foi aberta ainda.';
    const ring = $('.score-ring');
    if (ring) ring.style.background = '#e8efec';
    ['comunicacao', 'lideranca', 'bem_estar'].forEach(key => {
      const bar = $(`#bar-${key}`);
      if (bar) bar.style.width = '0%';
      const val = $(`#val-${key}`);
      if (val) val.textContent = '—';
    });
    return;
  }

  const { geral, comunicacao, lideranca, bem_estar, respostas } = c.atual;
  const culturePct = Math.round(geral * 10);
  $('#metric-climate').innerHTML = `${fmt(geral)}<em>/10</em>`;
  $('#culture-pct').innerHTML = `${culturePct}<small>%</small>`;
  const ring = $('.score-ring');
  if (ring) ring.style.background = `conic-gradient(var(--teal) 0 ${culturePct}%, #e8efec ${culturePct}% 100%)`;

  $('#culture-label').textContent = climateLabel(geral);
  $('#culture-period').textContent = c.openRoundId ? `Rodada aberta · ${respostas} ${respostas === 1 ? 'resposta' : 'respostas'}` : `Última rodada · ${respostas} ${respostas === 1 ? 'resposta' : 'respostas'}`;

  const deltaEl = $('#metric-climate-delta');
  const cultureDeltaEl = $('#culture-delta');
  if (c.anterior) {
    const delta = geral - c.anterior.geral;
    const sinal = delta >= 0 ? '+' : '';
    const classe = delta >= 0 ? 'positive' : 'negative';
    deltaEl.className = classe;
    deltaEl.innerHTML = `<i data-lucide="${delta >= 0 ? 'arrow-up' : 'arrow-down'}"></i> ${sinal}${fmt(delta)} vs. rodada anterior`;
    cultureDeltaEl.className = classe;
    cultureDeltaEl.innerHTML = `<i data-lucide="${delta >= 0 ? 'trending-up' : 'trending-down'}"></i> ${sinal}${Math.round(delta * 10)}% no período`;
  } else {
    deltaEl.textContent = 'Primeira rodada';
    cultureDeltaEl.textContent = '';
  }

  ['comunicacao', 'lideranca', 'bem_estar'].forEach(key => {
    $(`#bar-${key}`).style.width = `${c.atual[key] * 10}%`;
    $(`#val-${key}`).textContent = fmt(c.atual[key]);
  });

  $('#climate-admin-sub').textContent = c.openRoundId
    ? `Rodada aberta, ${respostas} ${respostas === 1 ? 'resposta até agora' : 'respostas até agora'}.`
    : `Última rodada fechada, ${respostas} ${respostas === 1 ? 'resposta' : 'respostas'}.`;
  lucideRefresh();
}

function abrirRespostaClima() {
  ['comunicacao', 'lideranca', 'bem_estar'].forEach(key => { $(`#climate-${key}`).value = ''; });
  $('#climate-modal').classList.add('open');
  $('#climate-modal').setAttribute('aria-hidden', 'false');
}

async function enviarRespostaClima() {
  const valores = {};
  for (const key of ['comunicacao', 'lideranca', 'bem_estar']) {
    const valor = Number($(`#climate-${key}`).value);
    if (!Number.isInteger(valor) || valor < 0 || valor > 10) return showToast('Preencha as três notas de 0 a 10.', 'error');
    valores[key] = valor;
  }
  const btn = $('#climate-enviar');
  btn.textContent = 'Enviando…'; btn.disabled = true;
  const response = await Climate.responder(valores);
  btn.textContent = 'Enviar resposta'; btn.disabled = false;
  if (!response?.ok) return showToast(response?.data?.error || 'Não foi possível enviar sua resposta.', 'error');
  closeModal();
  showToast('Resposta enviada, obrigado!', 'success');
  if (state.climate) state.climate.pendingResponse = false;
  await loadOverview();
}

async function abrirNovaRodadaClima() {
  if (!window.confirm('Abrir uma nova rodada de pesquisa de clima? Isso fecha a rodada atual (se houver aberta).')) return;
  const response = await Climate.abrirRodada();
  if (!response?.ok) return showToast(response?.data?.error || 'Não foi possível abrir uma nova rodada.', 'error');
  showToast('Nova rodada de pesquisa de clima aberta.', 'success');
  await loadOverview();
}

async function loadOverview() {
  if (!state.demo) {
    const [response, requestResponse, profileResponse] = await Promise.all([Dashboard.overview(), Requests.listar(), Users.perfil()]);
    if (profileResponse?.ok) applyAvatarPhoto(profileResponse.data.photo_url);
    if (response?.ok) {
      const data = response.data;
      trocarEmpresaAtiva(data.company.id, { isOwner: data.isOwner, name: profileResponse?.data?.name });
      setIdentity();
      $('#tenant-name').textContent = data.company.name;
      $('#workspace-logo').textContent = initials(data.company.name);
      $('#metric-people').textContent = data.people.active;
      $('#metric-people-delta').innerHTML = data.people.new_this_month > 0
        ? `<i data-lucide="trending-up"></i> +${data.people.new_this_month} este mês`
        : 'Nenhuma admissão este mês';
      $('#metric-people-delta').className = data.people.new_this_month > 0 ? 'positive' : '';
      $('#metric-pending').textContent = data.requests.pending;
      $('#metric-due-today').textContent = data.requests.due_today;
      $('#metric-unread').textContent = data.messages.unread;
      $('#metric-unread-detail').textContent = data.messages.unread
        ? `em ${data.messages.unread_conversations} ${data.messages.unread_conversations === 1 ? 'conversa' : 'conversas'}`
        : 'Tudo em dia';
      $('#message-badge').textContent = data.messages.unread;
      $('#request-badge').textContent = data.requests.pending;
      const planPct = Math.min(100, Math.round((data.people.active / data.company.user_limit) * 100));
      $('#plan-name').textContent = `Plano ${{ starter: 'Starter', growth: 'Growth', enterprise: 'Enterprise' }[data.company.plan] || data.company.plan}`;
      $('#plan-pct').textContent = `${planPct}% utilizado`;
      $('#plan-usage').textContent = `${data.people.active} de ${data.company.user_limit} colaboradores`;
      $('.plan-card .progress span').style.width = `${planPct}%`;
      $('#people-summary').textContent = `${data.people.active} colaboradores ativos.`;
      state.features = data.features || data.company.features || {};
      state.permissions = data.permissions || { requests: {}, notices: {}, request_types: {}, climate: {}, access_groups: {}, users: {} };
      state.climate = data.climate || null;
      applyFeatures();
      renderClimate();
    }
    if (requestResponse?.ok) state.requests = requestResponse.data;
    renderCelebration(response?.ok ? response.data.celebration : null);
  }
  renderPriorities();
  renderActivity();
}

// Seletor de workspace -- lista as empresas em que a mesma identidade
// (mesmo e-mail/senha do Supabase Auth) tem uma conta ativa, e troca a
// empresa ativa da sessão sem precisar de um novo login.
async function toggleWorkspaceMenu() {
  const menu = $('#workspace-menu');
  if (!menu.hidden) { menu.hidden = true; return; }
  if (state.demo) {
    menu.innerHTML = '<div class="workspace-menu-empty">Indisponível no modo demonstração.</div>';
    menu.hidden = false;
    return;
  }
  menu.innerHTML = '<div class="workspace-menu-empty">Carregando…</div>';
  menu.hidden = false;
  const r = await Auth.minhasEmpresas();
  if (!r?.ok) { menu.innerHTML = '<div class="workspace-menu-empty">Não foi possível carregar suas empresas.</div>'; return; }
  if (r.data.length <= 1) { menu.innerHTML = '<div class="workspace-menu-empty">Essa conta não está em mais nenhuma empresa.</div>'; return; }
  state.companies = r.data;
  const currentId = Number(getCompanyId());
  menu.innerHTML = r.data.map(company => `
    <button type="button" class="${Number(company.id) === currentId ? 'active' : ''}" data-switch-company="${company.id}">
      <span class="workspace-logo">${esc(initials(company.name))}</span>
      <span class="ws-name">${esc(company.name)}</span>
      ${Number(company.id) === currentId ? '<i data-lucide="check"></i>' : ''}
    </button>`).join('');
  lucideRefresh();
}

function switchCompany(companyId) {
  if (Number(companyId) === Number(getCompanyId())) { $('#workspace-menu').hidden = true; return; }
  const company = state.companies.find(item => Number(item.id) === Number(companyId));
  trocarEmpresaAtiva(companyId, { isOwner: company?.is_owner, name: company?.user_name });
  window.location.href = '/dashboard.html';
}

function renderCelebration(celebration) {
  const panel = $('#celebration-panel');
  if (!panel) return;
  if (!celebration || state.features.messaging === false) {
    panel.hidden = true;
    state.celebrationUser = null;
    return;
  }
  panel.hidden = false;
  state.celebrationUser = celebration;
  const anos = celebration.years === 1 ? '1 ano' : `${celebration.years} anos`;
  $('#celebration-avatar').textContent = initials(celebration.name);
  $('#celebration-title').textContent = `${anos} de casa! 🎉`;
  $('#celebration-text').textContent = `${celebration.name} completa hoje ${anos} com a gente.`;
  const button = $('#celebration-btn');
  button.disabled = false;
  button.innerHTML = '<i data-lucide="party-popper"></i> Enviar parabéns';
  lucideRefresh();
}

async function sendCelebration() {
  if (state.demo) return showToast('Parabéns enviado para Demo 02! 🎉');
  const celebration = state.celebrationUser;
  if (!celebration) return;
  const button = $('#celebration-btn');
  button.disabled = true;
  const conversation = await Messages.criarConversa({ type: 'direct', memberIds: [celebration.id] });
  if (!conversation?.ok) {
    button.disabled = false;
    return showToast(conversation?.data?.error || 'Não foi possível enviar os parabéns.', 'error');
  }
  const anos = celebration.years === 1 ? '1º ano' : `${celebration.years}º ano`;
  const message = await Messages.enviar(conversation.data.id, {
    body: `Parabéns pelo ${anos} com a gente, ${celebration.name}! 🎉`,
  });
  if (!message?.ok) {
    button.disabled = false;
    return showToast(message?.data?.error || 'Não foi possível enviar os parabéns.', 'error');
  }
  button.innerHTML = '<i data-lucide="check"></i> Parabéns enviado';
  lucideRefresh();
  showToast(`Parabéns enviado para ${celebration.name}! 🎉`);
}

function renderPriorities() {
  const rows = (state.demo ? demo.requests : state.requests)
    .filter(item => ['pending','in_review'].includes(item.status)).slice(0, 3);
  if (!rows.length) {
    $('#priority-list').innerHTML = '<div style="padding:32px 0;text-align:center;color:#8b9794;font-size:11px">Nenhuma prioridade pendente. Tudo em dia.</div>';
    return;
  }
  const iconMap = { Reembolso: ['receipt-text', 'coral'], 'Férias': ['palmtree', 'gold'], 'Atualização cadastral': ['landmark', 'sky'] };
  $('#priority-list').innerHTML = rows.map((item, index) => {
    const [icon, tone] = iconMap[item.tipo] || ['clipboard-check', 'sky'];
    const status = state.demo
      ? (index === 0 ? ['urgent', item.sla] : item.status === 'in_review' ? ['review', item.sla] : ['pending', item.sla])
      : [String(item.sla).includes('vencido') ? 'danger' : item.status === 'in_review' ? 'review' : 'pending', item.sla || statusLabel(item.status)];
    return `<div class="priority-row"><span class="priority-icon ${tone}"><i data-lucide="${icon}"></i></span><div><h3>${esc(item.tipo)}</h3><p>${esc(item.description || 'Solicitação enviada para o RH')}</p></div><span class="priority-owner">${avatar(item.funcionario || 'Colaborador', ['coral','yellow','blue'][index])}${esc(item.funcionario || 'Colaborador')}</span><span class="status-pill ${status[0]}">${status[1]}</span></div>`;
  }).join('');
  lucideRefresh();
}

function renderActivity() {
  if (!state.demo) {
    $('#activity-feed').innerHTML = '<div style="padding:34px 0;text-align:center;color:#8b9794;font-size:11px">O histórico aparecerá conforme a equipe utilizar o peopleX.</div>';
    return;
  }
  const feed = [
    ['MC','sand','Pessoa Demo 05','publicou um novo comunicado','há 12 min'],
    ['JS','yellow','Pessoa Demo 02','completou seu perfil','há 38 min'],
    ['CS','coral','Pessoa Demo 03','aprovou uma solicitação de férias','há 1h'],
    ['LR','blue','Pessoa Demo 09','enviou um documento para validação','há 2h'],
  ];
  $('#activity-feed').innerHTML = feed.map(item => `<div class="activity-item">${avatar(item[0], item[1])}<div><p><strong>${item[2]}</strong> ${item[3]}</p><small>${item[4]}</small></div><span>•••</span></div>`).join('');
}

async function loadPeople() {
  if (state.people.length) return renderPeople();
  if (state.demo) state.people = demo.people;
  else {
    const [response, groupsResponse] = await Promise.all([Users.listar(), AccessGroups.listar()]);
    if (groupsResponse?.ok) state.accessGroups = groupsResponse.data;
    if (response?.ok) state.people = response.data.map(person => ({ ...person, department: person.department || 'Não informado', job_title: person.job_title || (person.is_owner ? 'Dono da conta' : 'Colaborador') }));
  }
  renderPeople();
}

function renderPeople(filter = '') {
  const query = filter.toLowerCase();
  let people = state.people.filter(person => [person.name, person.email, person.department, person.job_title].join(' ').toLowerCase().includes(query));
  if (!state.peopleShowInactive) people = people.filter(person => person.active !== false);
  people = [...people].sort((a, b) => state.peopleSortBy === 'hire_date'
    ? new Date(b.hire_date || 0) - new Date(a.hire_date || 0)
    : String(a.name).localeCompare(String(b.name)));
  $('#people-toggle-inactive-label').textContent = state.peopleShowInactive ? 'Mostrar inativos' : 'Ocultando inativos';
  $('#people-toggle-inactive').classList.toggle('active', !state.peopleShowInactive);
  $('#people-sort-label').textContent = state.peopleSortBy === 'hire_date' ? 'Admissão' : 'Nome';
  $('#people-table').innerHTML = people.map(person => {
    const isActive = person.active !== false;
    const gerenciavel = podeGerenciarPessoa(person);
    const grupoCell = gerenciavel
      ? `<select class="role-select" data-user-group data-user-id="${esc(person.id)}" data-user-name="${esc(person.name)}"><option value="">Nenhum</option>${state.accessGroups.map(g => `<option value="${g.id}" ${g.id === person.access_group_id ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select>`
      : esc((state.accessGroups.find(g => g.id === person.access_group_id) || {}).name || '—');
    const acoesCell = gerenciavel
      ? `<button class="user-status-action" data-user-features data-user-id="${esc(person.id)}" data-user-name="${esc(person.name)}" title="Funcionalidades de ${esc(person.name)}"><i data-lucide="sliders-horizontal"></i><span>Recursos</span></button>
         <button class="user-status-action ${isActive ? 'danger' : 'restore'}" data-user-status data-user-id="${esc(person.id)}" data-user-name="${esc(person.name)}" data-active="${isActive}" title="${isActive ? 'Desativar' : 'Reativar'} ${esc(person.name)}"><i data-lucide="${isActive ? 'user-x' : 'user-check'}"></i><span>${isActive ? 'Desativar' : 'Reativar'}</span></button>
         <button class="user-status-action danger" data-user-delete data-user-id="${esc(person.id)}" data-user-name="${esc(person.name)}" title="Excluir ${esc(person.name)}"><i data-lucide="trash-2"></i><span>Excluir</span></button>`
      : '<span class="muted">—</span>';
    return `<tr class="${isActive ? '' : 'inactive-row'}"><td><div class="person-cell">${avatar(person.name, person.tone)}<span><strong>${esc(person.name)}</strong><small>${esc(person.email)}</small></span></div></td><td>${esc(person.department || '—')}</td><td>${grupoCell}</td><td><span class="active-pill ${isActive ? '' : 'inactive'}">${isActive ? 'Ativo' : 'Inativo'}</span></td><td>${person.hire_date ? formatDate(person.hire_date) : '—'}</td><td>${acoesCell}</td></tr>`;
  }).join('');
  $('#people-table-summary').textContent = `Exibindo ${people.length} de ${state.people.length} pessoas`;
  lucideRefresh();
}

async function togglePersonStatus(button) {
  const id = Number(button.dataset.userId);
  const name = button.dataset.userName;
  const nextActive = button.dataset.active !== 'true';
  const action = nextActive ? 'reativar' : 'desativar';
  const detail = nextActive
    ? `Reativar o acesso de ${name}?`
    : `Desativar ${name}? O histórico será preservado e o acesso ao sistema será bloqueado.`;
  if (!window.confirm(detail)) return;

  button.disabled = true;
  if (state.demo) {
    const person = state.people.find(item => Number(item.id) === id);
    if (person) person.active = nextActive;
    renderPeople($('#people-search').value);
    showToast(`${name} foi ${nextActive ? 'reativado' : 'desativado'} no ambiente de demonstração.`);
    return;
  }

  const response = await Users.alterarStatus(id, nextActive);
  if (!response?.ok) {
    button.disabled = false;
    showToast(response?.data?.error || `Não foi possível ${action} o colaborador.`, 'error');
    return;
  }
  const person = state.people.find(item => Number(item.id) === id);
  if (person) person.active = response.data.active;
  const activeCount = state.people.filter(item => item.active !== false).length;
  $('#metric-people').textContent = activeCount;
  $('#people-summary').textContent = `${activeCount} colaboradores ativos.`;
  renderPeople($('#people-search').value);
  showToast(`${name} foi ${nextActive ? 'reativado' : 'desativado'} com sucesso.`);
}

async function changePersonGroup(select) {
  const id = Number(select.dataset.userId);
  const name = select.dataset.userName;
  const novoGrupoId = select.value ? Number(select.value) : null;
  const person = state.people.find(item => Number(item.id) === id);
  const grupoAnterior = person?.access_group_id ?? null;
  if (!person || novoGrupoId === grupoAnterior) return;
  const novoGrupoNome = state.accessGroups.find(g => g.id === novoGrupoId)?.name || 'Nenhum';
  if (!window.confirm(`Mover ${name} para o grupo "${novoGrupoNome}"?`)) {
    select.value = grupoAnterior || '';
    return;
  }

  select.disabled = true;
  if (state.demo) {
    person.access_group_id = novoGrupoId;
    renderPeople($('#people-search').value);
    showToast(`Grupo de ${name} alterado no ambiente de demonstração.`);
    return;
  }

  const response = await Users.atualizarGrupo(id, novoGrupoId);
  if (!response?.ok) {
    select.disabled = false;
    select.value = grupoAnterior || '';
    showToast(response?.data?.error || 'Não foi possível alterar o grupo.', 'error');
    return;
  }
  person.access_group_id = response.data.access_group_id;
  renderPeople($('#people-search').value);
  showToast(`Grupo de ${name} alterado para ${novoGrupoNome}.`);
}

async function deletePerson(button) {
  const id = Number(button.dataset.userId);
  const name = button.dataset.userName;
  if (!window.confirm(`Excluir ${name} definitivamente? Essa ação não pode ser desfeita. Se ${name} já tiver mensagens, solicitações ou avisos registrados, use "Desativar" em vez disso.`)) return;

  button.disabled = true;
  if (state.demo) {
    state.people = state.people.filter(item => Number(item.id) !== id);
    renderPeople($('#people-search').value);
    showToast(`${name} foi excluído no ambiente de demonstração.`);
    return;
  }

  const response = await Users.excluir(id);
  if (!response?.ok) {
    button.disabled = false;
    showToast(response?.data?.error || 'Não foi possível excluir o colaborador.', 'error');
    return;
  }
  state.people = state.people.filter(item => Number(item.id) !== id);
  const activeCount = state.people.filter(item => item.active !== false).length;
  $('#metric-people').textContent = activeCount;
  $('#people-summary').textContent = `${activeCount} colaboradores ativos.`;
  renderPeople($('#people-search').value);
  showToast(`${name} foi excluído.`);
}

function openFeaturesModal(button) {
  const id = Number(button.dataset.userId);
  const name = button.dataset.userName;
  const person = state.people.find(item => Number(item.id) === id);
  if (!person) return;
  $('#features-modal-title').textContent = `Funcionalidades de ${name}`;
  $('#features-modal-list').innerHTML = Object.entries(FEATURE_LABELS).map(([key, label]) => {
    const checked = person.features?.[key] !== false;
    return `<label class="check-label"><input type="checkbox" data-feature-key="${key}" ${checked ? 'checked' : ''}> ${esc(label)}</label>`;
  }).join('');
  $('#features-modal-save').dataset.userId = id;
  $('#features-modal-save').dataset.userName = name;
  $('#features-modal').classList.add('open');
  $('#features-modal').setAttribute('aria-hidden', 'false');
}

async function savePersonFeatures() {
  const saveButton = $('#features-modal-save');
  const id = Number(saveButton.dataset.userId);
  const name = saveButton.dataset.userName;
  const features = Object.fromEntries($$('[data-feature-key]', $('#features-modal-list')).map(input => [input.dataset.featureKey, input.checked]));

  saveButton.disabled = true;
  if (state.demo) {
    const person = state.people.find(item => Number(item.id) === id);
    if (person) person.features = features;
    saveButton.disabled = false;
    closeModal();
    showToast(`Funcionalidades de ${name} atualizadas no ambiente de demonstração.`);
    return;
  }

  const response = await Users.atualizarFeatures(id, features);
  saveButton.disabled = false;
  if (!response?.ok) {
    showToast(response?.data?.error || 'Não foi possível salvar as funcionalidades.', 'error');
    return;
  }
  const person = state.people.find(item => Number(item.id) === id);
  if (person) person.features = response.data.features;
  closeModal();
  showToast(`Funcionalidades de ${name} atualizadas.`);
}

async function loadRequests() {
  if (!state.requests.length) {
    if (state.demo) state.requests = demo.requests;
    else {
      const response = await Requests.listar();
      if (response?.ok) state.requests = response.data;
    }
  }
  renderRequests();
}

function renderRequests(filter = '') {
  const query = filter.toLowerCase();
  const rows = state.requests.filter(item => {
    if (![item.tipo, item.funcionario, item.description].join(' ').toLowerCase().includes(query)) return false;
    if (state.requestFilter === 'closed') return ['approved','rejected','cancelled'].includes(item.status);
    return state.requestFilter === 'all' || item.status === state.requestFilter;
  });
  const canViewAll = state.demo || Boolean(state.permissions.requests?.view_all);
  const canApprove = state.demo || (Boolean(state.permissions.requests?.approve) && canViewAll);
  const actionSelect = item => {
    if (!canApprove || ['approved','rejected','cancelled'].includes(item.status)) return '';
    const actions = item.status === 'pending'
      ? [['in_review','Em análise'],['approved','Aprovar'],['rejected','Rejeitar'],['cancelled','Cancelar']]
      : [['approved','Aprovar'],['rejected','Rejeitar'],['cancelled','Cancelar']];
    return `<select class="request-status-select" data-request-status data-request-id="${esc(item.id)}"><option value="">Alterar status</option>${actions.map(([value,label]) => `<option value="${value}">${label}</option>`).join('')}</select>`;
  };
  $('#th-solicitante').hidden = !canViewAll;
  $('#requests-table').innerHTML = rows.map(item => `<tr data-request-id="${esc(item.id)}"><td class="request-desc-cell"><strong>#${esc(item.id)}</strong> · ${esc(item.tipo)}<br><small>${esc(item.description || '')}</small></td>${canViewAll ? `<td><div class="person-cell">${avatar(item.funcionario || getNome())}<strong>${esc(item.funcionario || getNome())}</strong></div></td>` : ''}<td>${formatDate(item.created_at)}</td><td><span class="sla ${String(item.sla).includes('vencido') ? 'danger' : ''}">${esc(item.sla || 'Sem SLA')}</span></td><td><span class="status-pill ${statusPillClass(item.status)}">${esc(statusLabel(item.status))}</span></td><td>${actionSelect(item)}</td></tr>`).join('');
  const summary = $$('.request-summary strong');
  const done = state.requests.filter(item => ['approved', 'rejected', 'cancelled'].includes(item.status)).length;
  [state.requests.length, state.requests.filter(item => item.status === 'pending').length, state.requests.filter(item => item.status === 'in_review').length, done].forEach((value, index) => { if (summary[index]) summary[index].textContent = value; });
  $$('[data-request-filter]').forEach(button => button.classList.toggle('active', button.dataset.requestFilter === state.requestFilter));
  lucideRefresh();
}

function openRequestDetail(id) {
  const item = state.requests.find(request => String(request.id) === String(id));
  if (!item) return;
  const canViewAll = state.demo || Boolean(state.permissions.requests?.view_all);
  $('#detail-tipo').textContent = `Solicitação #${item.id} · ${item.tipo}`;
  $('#detail-status').innerHTML = `<span class="status-pill ${statusPillClass(item.status)}">${esc(statusLabel(item.status))}</span>`;
  $('#detail-solicitante-row').hidden = !canViewAll;
  if (canViewAll) $('#detail-solicitante').textContent = item.funcionario || getNome();
  $('#detail-criada').textContent = formatDate(item.created_at);
  $('#detail-sla').textContent = item.sla || 'Sem SLA';
  $('#detail-descricao').textContent = item.description || 'Sem descrição.';
  $('#detail-nota-row').hidden = !item.resolution_note;
  if (item.resolution_note) $('#detail-nota').textContent = item.resolution_note;
  $('#request-detail-modal').classList.add('open');
  $('#request-detail-modal').setAttribute('aria-hidden', 'false');
}

async function updateRequestStatus(select) {
  if (!select.value) return;
  const id = select.dataset.requestId;
  select.disabled = true;
  const response = state.demo ? { ok: true, data: { status: select.value } } : await Requests.atualizarStatus(id, select.value);
  select.disabled = false;
  if (!response?.ok) return showToast(response?.data?.error || 'Não foi possível atualizar a solicitação.', 'error');
  const item = state.requests.find(request => String(request.id) === String(id));
  if (item) {
    item.status = response.data.status;
    if (['approved', 'rejected', 'cancelled'].includes(item.status)) item.sla = 'Concluída';
  }
  renderRequests($('#request-search').value);
  renderPriorities();
  showToast('Status da solicitação atualizado.');
}

async function loadNotices() {
  if (!state.notices.length) {
    if (state.demo) state.notices = demo.notices;
    else {
      const response = await Notices.listar();
      if (response?.ok) state.notices = response.data;
    }
  }
  $('#communications-grid').innerHTML = state.notices.map((notice, index) => {
    const read = state.demo ? (notice.read ?? Math.max(65, 96 - index * 4)) : Number(notice.read_rate || 0);
    return `<article class="comm-card"><div class="comm-card-head"><span class="priority-label ${esc(notice.priority)}">${notice.priority === 'urgent' ? 'Urgente' : notice.priority === 'important' ? 'Importante' : 'Geral'}</span><time>${formatDate(notice.created_at)}</time></div><h3>${esc(notice.title)}</h3><p>${esc(notice.content)}</p><div class="comm-card-foot"><span class="comm-reach"><i data-lucide="users"></i> Toda a empresa</span><div class="read-bar"><b><i style="width:${read}%"></i></b><span>${read}% leram</span></div></div></article>`;
  }).join('');
  if (!state.demo) {
    const unreadIds = state.notices.filter(notice => !notice.is_read).map(notice => notice.id);
    if (unreadIds.length) {
      await Notices.marcarLidas(unreadIds);
      state.analytics = null;
    }
  }
  await loadAnalyticsData();
  renderCommunicationMetrics();
  lucideRefresh();
}

async function loadAnalyticsData() {
  if (state.analytics || state.demo) return state.analytics;
  const response = await Dashboard.analytics();
  if (response?.ok) state.analytics = response.data;
  return state.analytics;
}

function renderCommunicationMetrics() {
  const metrics = state.demo
    ? { read_rate: 91, published_month: 12, people_reached: 38, active_people: 38 }
    : state.analytics?.communications;
  if (!metrics) return;
  $('#comm-read-rate').textContent = `${Number(metrics.read_rate || 0)}%`;
  $('#comm-published').textContent = Number(metrics.published_month || 0);
  $('#comm-reached').textContent = Number(metrics.people_reached || 0);
  $('#comm-reached-detail').textContent = `${Number(metrics.active_people || 0)} pessoas ativas`;
}

async function loadConversations() {
  if (!state.conversations.length) {
    if (state.demo) state.conversations = demo.conversations;
    else {
      const response = await Messages.conversas();
      if (response?.ok) state.conversations = response.data.map((conversation, index) => {
        const other = conversation.members?.find(member => member.name !== getNome());
        return { ...conversation, name: conversation.name || other?.name || 'Conversa', initials: initials(conversation.name || other?.name), time: conversation.last_message_at ? formatDate(conversation.last_message_at) : '' };
      });
    }
  }
  renderConversations();
  if (state.conversations.length) {
    $('#message-input').disabled = false;
    await openConversation(state.activeConversation || state.conversations[0].id);
  } else {
    state.activeConversation = null;
    $('#chat-name').textContent = 'Nenhuma conversa';
    $('#chat-avatar').textContent = 'PX';
    $('#chat-status').textContent = 'Crie uma conversa para começar';
    $('#message-stream').innerHTML = '<div style="height:100%;display:grid;place-items:center;color:#8b9794;font-size:11px;text-align:center">Sua caixa de mensagens está vazia.<br>Use “Nova conversa” para falar com alguém.</div>';
    $('#message-input').disabled = true;
  }
  if (!state.demo) $('.context-column').hidden = true;
}

function normalizeConversations(conversations) {
  return conversations.map(conversation => {
    const other = conversation.members?.find(member => member.name !== getNome());
    const name = conversation.name || other?.name || 'Conversa';
    return {
      ...conversation,
      name,
      initials: initials(name),
      time: conversation.last_message_at ? formatDate(conversation.last_message_at) : '',
    };
  });
}

async function syncRealtimeMessage(payload) {
  const conversationId = Number(payload?.new?.conversation_id);
  if (!conversationId) return;

  const activeId = Number(state.activeConversation);
  const [conversationResponse, messageResponse] = await Promise.all([
    Messages.conversas(),
    conversationId === activeId ? Messages.mensagens(conversationId) : Promise.resolve(null),
  ]);

  if (conversationResponse?.ok) {
    state.conversations = normalizeConversations(conversationResponse.data);
    renderConversations($('#conversation-search')?.value || '');
  }
  if (messageResponse?.ok && Number(state.activeConversation) === conversationId) {
    state.activeMessages = messageResponse.data.messages.map(message => ({
      ...message,
      own: message.sender_name === getNome(),
      tone: toneFor(message.sender_name),
    }));
    renderMessages(state.activeMessages, $('#message-search')?.value || '');
    await Messages.marcarComoLida(conversationId);
    const conversation = state.conversations.find(item => item.id == conversationId);
    if (conversation) conversation.unread_count = 0;
    renderConversations($('#conversation-search')?.value || '');
  }
}

function queueRealtimeMessage(payload) {
  state.realtimeSync = state.realtimeSync
    .catch(() => {})
    .then(() => syncRealtimeMessage(payload))
    .catch(error => console.warn('[Realtime] Falha ao sincronizar mensagem:', error));
}

function updateRealtimeFallback() {
  clearInterval(state.chatFallbackTimer);
  state.chatFallbackTimer = null;
  if (state.realtimeConnected || state.demo) return;
  state.chatFallbackTimer = setInterval(() => {
    if (state.currentView === 'messages' && state.activeConversation) {
      queueRealtimeMessage({ new: { conversation_id: state.activeConversation } });
    }
  }, 5000);
}

async function initRealtime() {
  if (state.demo || !window.supabase?.createClient) return updateRealtimeFallback();
  const response = await Dashboard.realtimeConfig();
  if (!response?.ok) return updateRealtimeFallback();

  state.realtimeClient = window.supabase.createClient(response.data.url, response.data.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  state.realtimeClient.realtime.setAuth(getToken());
  state.realtimeChannel = state.realtimeClient
    .channel('peoplex-messages')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `company_id=eq.${Number(getCompanyId())}` }, queueRealtimeMessage)
    .subscribe(status => {
      state.realtimeConnected = status === 'SUBSCRIBED';
      updateRealtimeFallback();
    });

  window.addEventListener('peoplex:token-refreshed', event => {
    if (event.detail?.token) state.realtimeClient?.realtime.setAuth(event.detail.token);
  });
  window.addEventListener('beforeunload', () => {
    if (state.realtimeChannel) state.realtimeClient?.removeChannel(state.realtimeChannel);
  }, { once: true });
}

function renderConversations(filter = '') {
  const query = filter.toLowerCase();
  const filtered = state.conversations.filter(conversation => {
    if (!conversation.name.toLowerCase().includes(query)) return false;
    if (state.conversationFilter === 'unread') return Number(conversation.unread_count) > 0;
    if (state.conversationFilter === 'groups') return ['group', 'announcement'].includes(conversation.type);
    return true;
  });
  $('#conversation-list').innerHTML = filtered.length
    ? filtered.map(conversation => `<button class="conversation-item ${conversation.id == state.activeConversation ? 'active' : ''}" data-conversation="${conversation.id}">${avatar(conversation.initials || conversation.name, conversation.tone)}<span><strong>${esc(conversation.name)}</strong><small>${esc(conversation.last_message || 'Comece uma conversa')}</small></span><span><time>${esc(conversation.time || '')}</time>${conversation.unread_count ? `<b>${conversation.unread_count}</b>` : ''}</span></button>`).join('')
    : '<div style="padding:24px 10px;text-align:center;color:#9a8589;font-size:9px">Nenhuma conversa neste filtro.</div>';
  const unread = state.conversations.reduce((total, conversation) => total + Number(conversation.unread_count || 0), 0);
  const unreadTab = $('.conversation-tabs span');
  if (unreadTab) unreadTab.textContent = unread;
  $$('[data-conversation-filter]').forEach(button => button.classList.toggle('active', button.dataset.conversationFilter === state.conversationFilter));
  $$('[data-conversation]').forEach(button => button.addEventListener('click', () => openConversation(Number(button.dataset.conversation))));
}

async function openConversation(id) {
  state.activeConversation = id;
  const conversation = state.conversations.find(item => item.id == id) || state.conversations[0];
  if (!conversation) return;
  renderConversations($('#conversation-search')?.value || '');
  $('#chat-name').textContent = conversation.name;
  $('#chat-avatar').textContent = conversation.initials || initials(conversation.name);
  $('#chat-status').textContent = `${conversation.members?.length || 0} participante(s)`;
  let messages = [];
  if (state.demo) messages = demo.messages[id] || [];
  else {
    const response = await Messages.mensagens(id);
    if (response?.ok) messages = response.data.messages.map(message => ({ ...message, own: message.sender_name === getNome(), tone: toneFor(message.sender_name) }));
    await Messages.marcarComoLida(id);
    conversation.unread_count = 0;
  }
  state.activeMessages = messages;
  renderMessages(messages);
  renderConversations($('#conversation-search')?.value || '');
}

function dayLabel(date) {
  const d = new Date(date);
  const hoje = new Date();
  const ontem = new Date(hoje);
  ontem.setDate(ontem.getDate() - 1);
  const mesmoDia = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (mesmoDia(d, hoje)) return 'Hoje';
  if (mesmoDia(d, ontem)) return 'Ontem';
  return formatDate(d);
}

function renderMessages(messages, query = '') {
  const normalized = query.trim().toLowerCase();
  const visible = normalized ? messages.filter(message => String(message.body || '').toLowerCase().includes(normalized)) : messages;
  const attachmentHtml = message => (message.attachments || []).map(attachment => `<a class="message-attachment-link" href="${esc(attachment.url || '#')}" target="_blank" rel="noopener"><i data-lucide="paperclip"></i><span>${esc(attachment.name || 'Arquivo')}</span></a>`).join('');
  let lastLabel = null;
  $('#message-stream').innerHTML = visible.length
    ? visible.map(message => {
        const label = dayLabel(message.created_at);
        const separator = label === lastLabel ? '' : `<div class="date-separator"><span>${esc(label)}</span></div>`;
        lastLabel = label;
        return `${separator}<div class="message ${message.own ? 'own' : ''}">${message.own ? '' : avatar(message.sender_name, message.tone)}<div class="message-content">${message.own ? '' : `<span>${esc(message.sender_name)}</span>`}<div class="bubble">${message.body ? esc(message.body).replace(/\n/g, '<br>') : ''}${attachmentHtml(message)}</div><small class="message-time">${new Date(message.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}${message.own ? ' · ✓✓' : ''}</small></div></div>`;
      }).join('')
    : `<div style="height:100%;display:grid;place-items:center;color:#9a8589;font-size:10px">${normalized ? 'Nenhuma mensagem encontrada.' : 'Ainda não há mensagens.'}</div>`;
  lucideRefresh();
  $('#message-stream').scrollTop = $('#message-stream').scrollHeight;
}

async function sendCurrentMessage(event) {
  event.preventDefault();
  if (state.sendingMessage) return;
  const input = $('#message-input');
  const body = input.value.trim();
  const attachments = state.pendingAttachment ? [state.pendingAttachment] : [];
  const clientMessageId = state.pendingMessageId || crypto.randomUUID();
  if (!body && !attachments.length) return;
  if (!state.activeConversation) return showToast('Crie ou selecione uma conversa primeiro.', 'error');

  state.sendingMessage = true;
  input.disabled = true;
  input.value = '';
  state.pendingAttachment = null;
  $('#message-attachment').value = '';
  $('#composer-hint').textContent = 'Enter para enviar • Shift + Enter para quebrar linha';

  try {
    if (state.demo) {
      const messages = demo.messages[state.activeConversation] ||= [];
      messages.push({ id: Date.now(), sender_name: 'Pessoa Demo 01', body, attachments, created_at: new Date(), own: true, tone: 'violet' });
      renderMessages(messages);
    } else {
      const response = await Messages.enviar(state.activeConversation, { body, attachments, clientMessageId });
      if (!response?.ok) {
        input.value = body;
        state.pendingAttachment = attachments[0] || null;
        state.pendingMessageId = clientMessageId;
        $('#composer-hint').textContent = state.pendingAttachment
          ? `Anexo: ${state.pendingAttachment.name} · tente enviar novamente`
          : 'Enter para enviar • Shift + Enter para quebrar linha';
        return showToast(response?.data?.error || 'Não foi possível enviar.', 'error');
      }
      await openConversation(state.activeConversation);
    }
    state.pendingMessageId = null;
  } finally {
    state.sendingMessage = false;
    input.disabled = false;
    input.focus();
  }
}

async function selectMessageAttachment(file) {
  if (!file) return;
  $('#composer-hint').textContent = `Enviando ${file.name}…`;
  const form = new FormData();
  form.append('file', file);
  const response = await Messages.enviarAnexo(form);
  if (!response?.ok) {
    $('#message-attachment').value = '';
    $('#composer-hint').textContent = 'Enter para enviar • Shift + Enter para quebrar linha';
    return showToast(response?.data?.error || 'Não foi possível anexar o arquivo.', 'error');
  }
  state.pendingAttachment = response.data;
  $('#composer-hint').textContent = `Anexo: ${file.name} · envie a mensagem para concluir`;
  showToast('Anexo pronto para envio.');
}

function showParticipants() {
  const conversation = state.conversations.find(item => item.id == state.activeConversation);
  if (!conversation) return showToast('Selecione uma conversa.', 'error');
  $('#participant-list').innerHTML = (conversation.members || []).map((person, index) => `<div class="participant-row">${avatar(person.name, ['mint','blue','coral','violet'][index % 4])}<span><strong>${esc(person.name)}</strong><small>${esc(person.job_title || 'Colaborador')}</small></span></div>`).join('');
  $('#participants-modal').classList.add('open');
  $('#participants-modal').setAttribute('aria-hidden', 'false');
  lucideRefresh();
}

async function markActiveConversationRead() {
  if (!state.activeConversation) return;
  const response = state.demo ? { ok: true } : await Messages.marcarComoLida(state.activeConversation);
  if (!response?.ok) return showToast('Não foi possível marcar a conversa como lida.', 'error');
  const conversation = state.conversations.find(item => item.id == state.activeConversation);
  if (conversation) conversation.unread_count = 0;
  renderConversations($('#conversation-search').value);
  showToast('Conversa marcada como lida.');
}

async function openConversationModal() {
  if (state.demo) return changeView('messages');
  const response = await Users.diretorio();
  if (!response?.ok) return showToast(response?.data?.error || 'Não foi possível carregar o diretório.', 'error');
  $('#conversation-members').innerHTML = response.data.map(person => `<option value="${esc(person.id)}">${esc(person.name)}${person.job_title ? ' · ' + esc(person.job_title) : ''}</option>`).join('');
  $('#conversation-form').reset();
  $('#conversation-name-field').hidden = true;
  $('#conversation-modal').classList.add('open');
  $('#conversation-modal').setAttribute('aria-hidden', 'false');
}

async function submitConversation(event) {
  event.preventDefault();
  const type = $('#conversation-type').value;
  const name = $('#conversation-name').value.trim();
  const memberIds = [...$('#conversation-members').selectedOptions].map(option => Number(option.value));
  if (type === 'direct' && memberIds.length !== 1) return showToast('Selecione uma pessoa para a conversa direta.', 'error');
  if (type === 'group' && (!name || memberIds.length < 2)) return showToast('Informe o nome e ao menos duas pessoas para o grupo.', 'error');
  const response = await Messages.criarConversa({ type, name, memberIds });
  if (!response?.ok) return showToast(response?.data?.error || 'Não foi possível criar a conversa.', 'error');
  $('#conversation-modal').classList.remove('open');
  state.conversations = [];
  state.activeConversation = response.data.id;
  await changeView('messages');
  showToast('Conversa criada com sucesso.');
}

async function renderAnalytics() {
  if (state.demo) {
    state.analytics = {
      headcount: [['2026-04-01',30,3,1],['2026-05-01',32,3,1],['2026-06-01',34,2,0],['2026-07-01',34,1,1],['2026-08-01',36,3,1],['2026-09-01',38,3,1]].map(([month,headcount,hires,exits]) => ({ month,headcount,hires,exits })),
      departments: [{name:'Produto',total:11},{name:'Comercial',total:9},{name:'Operações',total:7},{name:'Outras',total:11}],
      communications: { read_rate:91,published_month:12,people_reached:38,active_people:38 },
    };
  } else {
    await loadAnalyticsData();
  }
  const data = state.analytics;
  if (!data) {
    $('#headcount-chart').innerHTML = '<div class="empty-chart">Indicadores indisponíveis.</div>';
    return;
  }

  const maximum = Math.max(1, ...data.headcount.map(item => Number(item.headcount || 0)));
  $('#headcount-chart').innerHTML = data.headcount.map(item => {
    const label = new Intl.DateTimeFormat('pt-BR', { month: 'short', timeZone: 'UTC' }).format(new Date(item.month));
    const headcountHeight = Math.max(3, Number(item.headcount || 0) / maximum * 90);
    const hiresHeight = Math.max(2, Number(item.hires || 0) / maximum * 90);
    const exitsHeight = Math.max(2, Number(item.exits || 0) / maximum * 90);
    return `<div class="bar-month"><div class="bar-group"><i class="bar headcount" title="${item.headcount} pessoas" style="height:${headcountHeight}px"></i><i class="bar hires" title="${item.hires} admissões" style="height:${hiresHeight}px"></i><i class="bar exits" title="${item.exits} desligamentos" style="height:${exitsHeight}px"></i></div><span>${esc(label.replace('.', ''))}</span></div>`;
  }).join('');

  const total = data.departments.reduce((sum, item) => sum + Number(item.total || 0), 0);
  const colors = ['#981b2f','#c6283e','#e45d64','#f39aa8','#6e2634','#d98591','#b34b5d'];
  let accumulated = 0;
  const stops = data.departments.map((item, index) => {
    const start = accumulated;
    accumulated += total ? Number(item.total) / total * 100 : 0;
    return `${colors[index % colors.length]} ${start}% ${accumulated}%`;
  });
  $('.donut').style.background = stops.length ? `conic-gradient(${stops.join(',')})` : '#eee';
  $('#department-count').innerHTML = `${data.departments.length}<small>áreas</small>`;
  $('#department-total').textContent = `${total} pessoas ativas`;
  $('#department-legend').innerHTML = data.departments.map((item, index) => {
    const percent = total ? Math.round(Number(item.total) / total * 100) : 0;
    return `<span><i style="background:${colors[index % colors.length]}"></i>${esc(item.name)} <b>${percent}%</b></span>`;
  }).join('') || '<span>Sem dados organizacionais.</span>';
  lucideRefresh();
}

function exportAnalytics() {
  if (!state.analytics) return showToast('Carregue os indicadores antes de exportar.', 'error');
  const rows = [['Mês','Headcount','Admissões','Desligamentos'], ...state.analytics.headcount.map(item => [item.month,item.headcount,item.hires,item.exits])];
  const csv = rows.map(row => row.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(';')).join('\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
  link.download = `peoplex-indicadores-${new Date().toISOString().slice(0,10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function changeView(viewName) {
  const requiredFeature = viewFeature[viewName];
  if (!state.demo && requiredFeature && state.features[requiredFeature] === false) {
    showToast('Funcionalidade não habilitada para esta empresa.', 'error');
    viewName = 'overview';
  }
  state.currentView = viewName;
  $$('.view').forEach(view => view.classList.toggle('active', view.id === `view-${viewName}`));
  $$('.nav-item[data-view]').forEach(item => item.classList.toggle('active', item.dataset.view === viewName));
  $('#sidebar').classList.remove('open');
  history.replaceState(null, '', `#${viewName}`);
  if (viewName === 'messages') await loadConversations();
  if (viewName === 'people') await loadPeople();
  if (viewName === 'requests') await loadRequests();
  if (viewName === 'communications') await loadNotices();
  if (viewName === 'analytics') await renderAnalytics();
  lucideRefresh();
}

async function openRequestModal() {
  const select = $('#request-type');
  select.innerHTML = '<option value="">Selecione…</option>';
  let types = [{ id: 1, name: 'Férias' }, { id: 2, name: 'Declaração' }, { id: 3, name: 'Reembolso' }, { id: 4, name: 'Atualização cadastral' }];
  if (!state.demo) {
    const response = await RequestTypes.listar();
    if (response?.ok) types = response.data;
  }
  select.innerHTML += types.map(type => `<option value="${type.id}">${esc(type.name)}</option>`).join('');
  $('#request-modal').classList.add('open');
  $('#request-modal').setAttribute('aria-hidden', 'false');
}

function openNoticeModal() {
  if (!isAdmin() && !state.demo && !state.permissions.notices?.create)
    return showToast('Você não tem permissão para criar comunicados.', 'error');
  $('#notice-modal').classList.add('open');
  $('#notice-modal').setAttribute('aria-hidden', 'false');
  $('#notice-title').focus();
}

function closeModal() {
  $$('.modal-backdrop').forEach(modal => { modal.classList.remove('open'); modal.setAttribute('aria-hidden', 'true'); });
}

async function submitRequest(event) {
  event.preventDefault();
  const typeId = $('#request-type').value;
  const description = $('#request-description').value.trim();
  if (!typeId) return;
  if (state.demo) {
    const typeName = $('#request-type').selectedOptions[0].textContent;
    state.requests.unshift({ id: 1049, tipo: typeName, funcionario: 'Pessoa Demo 01', status: 'pending', created_at: new Date(), description, sla: '72h restantes' });
  } else {
    const response = await Requests.criar(typeId, description);
    if (!response?.ok) return showToast(response?.data?.error || 'Erro ao criar solicitação.', 'error');
    state.requests = [];
  }
  closeModal();
  event.target.reset();
  showToast('Solicitação enviada ao RH com sucesso.');
  await loadRequests();
  renderPriorities();
}

async function submitNotice(event) {
  event.preventDefault();
  const body = {
    title: $('#notice-title').value.trim(),
    content: $('#notice-content').value.trim(),
    priority: $('#notice-priority').value,
    notifyByEmail: $('#notice-email').checked,
  };
  if (!body.title || !body.content) return;
  if (state.demo) {
    demo.notices.unshift({ id: Date.now(), ...body, created_at: new Date(), autor: getNome() || 'Pessoa Demo 01', read: 0 });
    state.notices = demo.notices;
  } else {
    const response = await Notices.criar(body);
    if (!response?.ok) return showToast(response?.data?.error || 'Não foi possível publicar.', 'error');
    state.notices = [];
    state.analytics = null;
  }
  event.target.reset();
  closeModal();
  await loadNotices();
  showToast('Comunicado publicado com sucesso.');
}

function bindEvents() {
  $$('.nav-item[data-view]').forEach(item => item.addEventListener('click', () => changeView(item.dataset.view)));
  $$('[data-view-link]').forEach(item => item.addEventListener('click', () => changeView(item.dataset.viewLink)));
  $$('[data-action="new-message"]').forEach(item => item.addEventListener('click', openConversationModal));
  $$('[data-action="new-request"]').forEach(item => item.addEventListener('click', openRequestModal));
  $$('[data-close-modal]').forEach(item => item.addEventListener('click', closeModal));
  $('#request-modal').addEventListener('click', event => { if (event.target === event.currentTarget) closeModal(); });
  $('#notice-modal').addEventListener('click', event => { if (event.target === event.currentTarget) closeModal(); });
  $('#participants-modal').addEventListener('click', event => { if (event.target === event.currentTarget) closeModal(); });
  $('#request-form').addEventListener('submit', submitRequest);
  $('#notice-form').addEventListener('submit', submitNotice);
  $('#conversation-form').addEventListener('submit', submitConversation);
  $('#conversation-type').addEventListener('change', event => { $('#conversation-name-field').hidden = event.target.value !== 'group'; });
  $('#message-form').addEventListener('submit', sendCurrentMessage);
  $('#message-input').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) sendCurrentMessage(event); });
  $('#conversation-search').addEventListener('input', event => renderConversations(event.target.value));
  $$('[data-conversation-filter]').forEach(button => button.addEventListener('click', () => { state.conversationFilter = button.dataset.conversationFilter; renderConversations($('#conversation-search').value); }));
  $('#open-message-search').addEventListener('click', () => { $('#chat-search-box').hidden = false; $('#open-message-search').hidden = true; $('#message-search').focus(); });
  $('#close-message-search').addEventListener('click', () => { $('#message-search').value = ''; $('#chat-search-box').hidden = true; $('#open-message-search').hidden = false; renderMessages(state.activeMessages); });
  $('#message-search').addEventListener('input', event => renderMessages(state.activeMessages, event.target.value));
  $('#open-participants').addEventListener('click', showParticipants);
  $('#open-chat-menu').addEventListener('click', () => { $('#chat-more-menu').hidden = !$('#chat-more-menu').hidden; });
  $$('[data-chat-menu]').forEach(button => button.addEventListener('click', () => { $('#chat-more-menu').hidden = true; if (button.dataset.chatMenu === 'read') markActiveConversationRead(); else showParticipants(); }));
  $('#attach-message').addEventListener('click', () => $('#message-attachment').click());
  $('#message-attachment').addEventListener('change', event => selectMessageAttachment(event.target.files[0]));
  $('#open-emoji-menu').addEventListener('click', () => { $('#emoji-menu').hidden = !$('#emoji-menu').hidden; });
  $$('#emoji-menu button').forEach(button => button.addEventListener('click', () => { $('#message-input').value += button.textContent; $('#message-input').focus(); $('#emoji-menu').hidden = true; }));
  $('#people-search').addEventListener('input', event => renderPeople(event.target.value));
  $('#people-toggle-inactive').addEventListener('click', () => {
    state.peopleShowInactive = !state.peopleShowInactive;
    renderPeople($('#people-search').value);
  });
  $('#people-sort-toggle').addEventListener('click', () => {
    state.peopleSortBy = state.peopleSortBy === 'hire_date' ? 'name' : 'hire_date';
    renderPeople($('#people-search').value);
  });
  $('#people-table').addEventListener('click', event => {
    const statusButton = event.target.closest('[data-user-status]');
    if (statusButton) togglePersonStatus(statusButton);
    const deleteButton = event.target.closest('[data-user-delete]');
    if (deleteButton) deletePerson(deleteButton);
    const featuresButton = event.target.closest('[data-user-features]');
    if (featuresButton) openFeaturesModal(featuresButton);
  });
  $('#features-modal-save').addEventListener('click', savePersonFeatures);
  $('#people-table').addEventListener('change', event => {
    const select = event.target.closest('[data-user-group]');
    if (select) changePersonGroup(select);
  });
  $('#request-search').addEventListener('input', event => renderRequests(event.target.value));
  $$('[data-request-filter]').forEach(button => button.addEventListener('click', () => {
    state.requestFilter = button.dataset.requestFilter;
    renderRequests($('#request-search').value);
  }));
  $('#requests-table').addEventListener('change', event => { if (event.target.matches('[data-request-status]')) updateRequestStatus(event.target); });
  $('#requests-table').addEventListener('click', event => {
    if (event.target.closest('select')) return;
    const row = event.target.closest('tr[data-request-id]');
    if (row) openRequestDetail(row.dataset.requestId);
  });
  $('#open-notif-menu').addEventListener('click', () => {
    $('#profile-menu').hidden = true;
    $('#notif-menu').hidden = !$('#notif-menu').hidden;
  });
  $('#open-profile-menu').addEventListener('click', () => {
    $('#notif-menu').hidden = true;
    $('#profile-menu').hidden = !$('#profile-menu').hidden;
  });
  document.addEventListener('click', event => {
    if (!event.target.closest('#open-notif-menu, #notif-menu')) $('#notif-menu').hidden = true;
    if (!event.target.closest('#open-profile-menu, #profile-menu')) $('#profile-menu').hidden = true;
    if (!event.target.closest('#open-workspace-menu, #workspace-menu')) $('#workspace-menu').hidden = true;
  });
  $('#open-workspace-menu').addEventListener('click', toggleWorkspaceMenu);
  $('#workspace-menu').addEventListener('click', event => {
    const button = event.target.closest('[data-switch-company]');
    if (button) switchCompany(button.dataset.switchCompany);
  });
  $('#open-sidebar').addEventListener('click', () => $('#sidebar').classList.add('open'));
  $('#close-sidebar').addEventListener('click', () => $('#sidebar').classList.remove('open'));
  $$('[data-action="celebrate"]').forEach(button => button.addEventListener('click', sendCelebration));
  $('#new-notice-btn').addEventListener('click', openNoticeModal);
  $('#export-analytics').addEventListener('click', exportAnalytics);
  $$('[data-protected-link]').forEach(link => link.addEventListener('click', event => {
    if (state.demo) { event.preventDefault(); showToast('Conecte um banco para acessar documentos e admissões.'); }
  }));
  $$('[data-profile-link]').forEach(button => button.addEventListener('click', () => {
    if (state.demo) showToast('Este recurso utiliza dados reais e fica disponível no ambiente conectado.');
    else window.location.href = button.dataset.profileTarget || '/perfil.html';
  }));
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); $('#global-search').focus(); }
    if (event.key === 'Escape') closeModal();
  });
}

async function init() {
  if (!state.demo && !estaLogado()) return logout();
  state.people = state.demo ? demo.people : [];
  state.requests = state.demo ? demo.requests : [];
  state.notices = state.demo ? demo.notices : [];
  state.conversations = state.demo ? demo.conversations : [];
  setIdentity();
  setDataSaudacao();
  bindEvents();
  await loadOverview();
  await initRealtime();
  const initialView = location.hash.replace('#', '') || 'overview';
  await changeView(['overview','messages','people','requests','communications','analytics'].includes(initialView) ? initialView : 'overview');
  lucideRefresh();
}

init();
