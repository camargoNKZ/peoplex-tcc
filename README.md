# peopleX

peopleX é uma plataforma SaaS multi-tenant para comunicação e gestão de pessoas. Centraliza solicitações de RH, comunicados institucionais, mensageria em tempo real e indicadores de headcount para múltiplas empresas na mesma aplicação, com isolamento de dados reforçado em duas camadas: nas APIs e via Row Level Security no banco.

> **Projeto acadêmico (TCC).** Trabalho de Conclusão de Curso de Sistemas de Informação.

## Experiência de demonstração

```sh
npm ci
npm start
```

Abra `http://localhost:3000`, clique em **Explorar ambiente de demonstração** e navegue sem configurar banco. O modo demo é identificado na interface e não simula persistência de produção.

## Ambiente conectado

Pré-requisitos: Node.js 20+ e PostgreSQL 15+.

1. Copie `.env.example` para `.env` e configure credenciais próprias.
2. Crie um banco ou projeto Supabase separado para desenvolvimento.
3. Aplique as migrations de `supabase/migrations` para usar a estrutura completa. O arquivo `database/schema.sql` contém a modelagem inicial.
4. Configure suas próprias contas de teste e rode `npm start`.

As variáveis de credenciais ficam vazias no exemplo. Não existem usuários ou senhas pré-cadastrados. O modo de demonstração utiliza pessoas e contatos fictícios e não exige conexão com banco. Sem banco configurado, `/health` retorna 503 e o servidor pode registrar falha de conexão, sem impedir a navegação da demonstração. Fontes e bibliotecas da interface são carregadas de CDNs públicas e precisam de internet.

## Módulos disponíveis

- dashboard executivo com pessoas, pendências, mensagens e pulso de cultura;
- diretório de colaboradores e perfis;
- solicitações de RH com fluxo de status controlado no backend (pendente → em análise → aprovada/rejeitada);
- comunicados segmentáveis e histórico de disparos;
- mensageria direta, grupos, anexos estruturados, recibos de leitura e atualização em tempo real via Supabase Realtime;
- fila de notificações assíncrona (comunicados, mudanças de status e e-mails em massa), com até 3 retentativas e backoff progressivo em caso de falha;
- celebração automática de aniversário de empresa dos colaboradores;
- arquivos cadastrais em armazenamento privado;
- indicadores de headcount e distribuição organizacional;
- modo de demonstração local para apresentações;
- Control Center da plataforma em `/admin.html`, com criação e suspensão de tenants, planos, limites, consumo e feature flags.

## Multi-tenancy

O `company_id` existe em todas as tabelas de negócio. Referências sensíveis usam chaves estrangeiras compostas `(id, company_id)`, impedindo que uma solicitação, mensagem, documento ou participante aponte para registros de outra empresa. As APIs sempre usam o tenant contido no token autenticado — nunca o tenant enviado pelo navegador.

As migrations de `supabase/migrations` incluem políticas de Row Level Security e restrições de acesso direto às tabelas e ao armazenamento. O servidor aplica o escopo da empresa autenticada nas operações de negócio. O vínculo entre `users.auth_user_id` e Supabase Auth permite integrar as contas da aplicação à autenticação gerenciada.

## Fila de e-mails

Avisos, mudanças de status de solicitação e disparos em massa passam pela tabela `message_queue` (`src/services/queueService.js`) em vez de enviar o e-mail diretamente no controller. Cada linha é reivindicada de forma atômica (`FOR UPDATE SKIP LOCKED`), evitando que duas instâncias processem a mesma mensagem duas vezes; falhas de envio entram em backoff progressivo até `max_attempts` (padrão 3) antes de virar `failed`, e uma janela de reserva expira automaticamente linhas que travaram no meio do envio.

Como a Vercel não garante execução de código depois que a resposta HTTP é enviada, o processamento é aguardado dentro do próprio request que enfileira a mensagem (com timeout de 8s por envio), em vez de depender de um worker solto em segundo plano — um `setInterval` contínuo só é confiável com um processo sempre de pé (`npm start` local). Em produção, o endpoint `/internal/queue/process`, protegido por segredo compartilhado e acionado via Vercel Cron, cobre o caso de uma tentativa anterior ter ficado pendente.

## Qualidade e desempenho

- Suíte de testes automatizados (`node --test`) cobrindo isolamento multi-tenant, autenticação e sessão, políticas de acesso, regressão de schema e fluxos de negócio de ponta a ponta.
- Pipeline de integração contínua no GitHub Actions em cada push/PR: instalação de dependências, checagem de sintaxe, testes automatizados e auditoria de vulnerabilidades (`npm audit`).
- Configuração de execução serverless na Vercel, na região `gru1`, e envio de mensagens em uma única consulta.

Para validar o código:

```sh
npm run check
npm test
```

Os testes locais não exigem credenciais. As suítes de integração ficam desativadas por padrão e exigem `PEOPLEX_BASE_URL`, `PEOPLEX_RUN_INTEGRATION=1` e as fixtures ou tokens indicados em cada arquivo. Use um ambiente de testes isolado: algumas suítes criam ou alteram registros.

## Endpoints principais

| Área | Endpoints |
| --- | --- |
| Sessão | `POST /auth/login`, `POST /auth/refresh` |
| Dashboard | `GET /dashboard/overview` |
| Pessoas | `GET /users`, `POST /users`, `GET /users/profile` |
| Solicitações | `GET/POST /requests`, `PATCH /requests/:id/status` |
| Comunicados | `GET/POST /notices`, `DELETE /notices/:id` |
| Mensagens | `GET/POST /messages/conversations`, `GET /messages/conversations/:id`, `POST /messages/conversations/:id/messages` |
| Saúde | `GET /health` |
| Plataforma | `POST /platform/auth/login`, `GET /platform/overview`, `GET/POST /platform/tenants`, `PATCH /platform/tenants/:id`, `PATCH /platform/tenants/:id/features` |

## Administração da plataforma

O Control Center usa uma conta Supabase Auth separada das contas de cada tenant. As funcionalidades controláveis são mensageria, solicitações, comunicados, indicadores, documentos e admissão. Desativar um módulo bloqueia a API correspondente e remove sua navegação; suspender um tenant bloqueia todos os acessos da empresa. Alterações administrativas ficam registradas em `platform_audit_logs`.

## Supabase + Vercel

O servidor exporta o app Express e inclui `vercel.json`. A implantação conectada usa:

- PostgreSQL gerenciado e migrations versionadas;
- Supabase Auth com access token e renovação por refresh token;
- buckets privados `avatars` e `documents`, com URLs temporárias assinadas;
- RLS por empresa e referências compostas entre tenant e registros;
- segredos somente nas variáveis de ambiente da Vercel.

Antes do uso com dados reais, configure credenciais próprias, MFA para administradores e recuperação de senha. A proteção contra senhas vazadas requer plano Supabase Pro ou superior.

As orientações de configuração e proteção de dados estão em [Segurança](docs/SEGURANCA.md).

## Segurança

- Helmet e rate limit na autenticação;
- payload HTTP limitado;
- senha com bcrypt;
- consultas parametrizadas;
- escopo por empresa nas APIs, reforçado por Row Level Security no banco;
- uploads restritos por tipo e tamanho;
- `.env` e uploads ignorados pelo Git.

A execução conectada utiliza credenciais definidas no ambiente para autenticação, banco, armazenamento e envio de e-mails. Mantenha os ambientes de desenvolvimento, testes e produção separados.
