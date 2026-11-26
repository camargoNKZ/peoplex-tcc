// Permissões por ação, não mais por papel fixo. Quem não está em nenhum
// grupo de acesso usa o padrão abaixo (equivalente ao antigo "employee").
// Um grupo pode declarar true/false explícito pra qualquer ação -- isso
// vale mesmo contrariando o padrão (o grupo pode tanto liberar quanto
// restringir). O dono da conta (is_owner) sempre pode tudo, não importa
// o que o grupo diga.
const RESOURCES = {
  requests: {
    view_all: false,
    create: true,
    edit: true,
    delete: true,
    approve: false,
  },
  notices: {
    create: false,
    edit: false,
    delete: false,
  },
  request_types: {
    create: false,
    edit: false,
    delete: false,
  },
  climate: {
    open_round: false,
  },
  access_groups: {
    create: false,
  },
  users: {
    create: false,
  },
};

function hasPermission(req, resource, action) {
  if (req.isOwner) return true;
  const groupValue = req.groupPermissions?.[resource]?.[action];
  if (typeof groupValue === 'boolean') return groupValue;
  return RESOURCES[resource]?.[action] ?? false;
}

// Verdadeiro se `permissions` concede (true) alguma ação que `req` mesmo não
// tem. Usada para impedir que quem ganhou "criar grupo de acesso" ou
// "cadastrar usuário" se autopromova: criando um grupo mais poderoso que o
// seu, ou colocando um colaborador recém-cadastrado nesse grupo. O dono da
// conta não tem teto.
function exceedsOwnCeiling(req, permissions) {
  if (req.isOwner) return false;
  for (const resource of Object.keys(RESOURCES)) {
    for (const action of Object.keys(RESOURCES[resource])) {
      if (permissions?.[resource]?.[action] === true && !hasPermission(req, resource, action)) return true;
    }
  }
  return false;
}

module.exports = { RESOURCES, hasPermission, exceedsOwnCeiling };
