# peopleX — versão para avaliação de TCC

Cópia acadêmica da plataforma de comunicação e gestão de pessoas peopleX, preparada para conferência da banca. O código utiliza Node.js, Express, PostgreSQL e integrações opcionais com Supabase.

Esta edição tem histórico Git próprio e contém apenas código, estrutura do banco, testes e dados de demonstração fictícios. Não inclui registros de usuários ou empresas reais, arquivos enviados, credenciais nem configuração de serviços em produção.

## Executar a demonstração

Requer Node.js 20 ou superior e npm.

```sh
npm ci
npm start
```

Acesse <http://localhost:3000> e clique em **Explorar ambiente de demonstração**. Não é necessário preencher e-mail, senha ou configurar banco. As pessoas, empresas, mensagens, datas e indicadores exibidos nesse modo são fictícios. As alterações da demonstração ficam na memória do navegador e se perdem ao recarregar.

O modo demo cobre dashboard, diretório de pessoas, solicitações, comunicados, mensagens e indicadores. Documentos, admissão, administração da plataforma, envio de e-mails e persistência exigem serviços de teste próprios. Fontes e bibliotecas da interface são carregadas de CDNs públicas e precisam de internet.

Sem banco configurado, o servidor pode registrar uma falha de conexão PostgreSQL e `/health` retorna 503; isso não impede a navegação da demonstração.

## Conferir o código

```sh
npm run check
npm test
```

Os testes locais não exigem credenciais. As suítes de integração ficam ignoradas por padrão. Para executá-las, configure explicitamente `PEOPLEX_BASE_URL`, `PEOPLEX_RUN_INTEGRATION=1` e as fixtures/tokens exigidos por cada arquivo, usando exclusivamente um ambiente de testes separado com dados fictícios. Algumas suítes criam ou alteram registros.

## Estrutura e funcionalidades

- `public/`: interface e fixtures sintéticas da demonstração.
- `src/controllers/` e `src/routes/`: APIs de sessão, pessoas, solicitações, comunicados, mensagens, clima e administração.
- `src/policies/` e `src/middlewares/`: permissões, autenticação e isolamento por empresa.
- `src/services/`: e-mail, fila de notificações e armazenamento.
- `database/`: estrutura PostgreSQL sem cadastro automático de empresas, usuários ou senhas.
- `supabase/migrations/`: evolução do banco, autenticação, armazenamento e políticas RLS, sem o seed de contas.
- `test/`: testes locais e suítes opcionais de integração.

A arquitetura utiliza `company_id` nas entidades de negócio, consultas parametrizadas e referências compostas para o isolamento entre empresas. As integrações com Supabase Auth, Storage e Realtime são opcionais e precisam de configuração própria.

## Ambiente de integração isolado

O `.env.example` documenta as variáveis, com credenciais vazias. Use um banco/projeto novo, preencha apenas credenciais desse ambiente e aplique as migrations apropriadas. O schema básico em `database/schema.sql` representa a modelagem inicial; a evolução completa está nas migrations. Não existem contas ou senhas pré-cadastradas nesta cópia.

Para criar usuários e testar autenticação, configure suas próprias fixtures isoladas. Não conecte esta edição aos serviços de produção nem adicione dados pessoais para a apresentação.

Veja [o registro da preparação](docs/SANITIZACAO.md) para o escopo da remoção e as verificações realizadas.
