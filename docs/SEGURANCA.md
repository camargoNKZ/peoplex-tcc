# Segurança

## Configuração do ambiente

Use `.env.example` como referência e preencha as credenciais apenas no ambiente de execução. O exemplo não define senhas, chaves ou conexões com serviços externos. Não registre tokens ou credenciais em arquivos de código, logs ou commits.

Mantenha bancos e projetos separados para desenvolvimento, testes e produção. A demonstração utiliza dados fictícios e funciona sem credenciais; as integrações precisam de configuração própria.

## Arquivos ignorados pelo Git

O `.gitignore` faz parte da configuração versionada do projeto. Suas regras evitam a inclusão acidental de `.env`, dependências, uploads, logs, chaves, certificados, bancos locais, backups e relatórios de execução. O `.env.example` é versionado para documentar as variáveis necessárias, com credenciais vazias.

As regras de exclusão não removem arquivos já versionados. Se uma credencial for adicionada a um commit, revogue-a ou faça sua rotação no serviço correspondente e revise o histórico.

## Autenticação e isolamento

O backend aplica autenticação, permissões por recurso e escopo por empresa. As entidades de negócio usam `company_id` e referências compostas para evitar vínculos entre empresas. As migrations definem políticas de acesso no banco e no armazenamento. Chaves privilegiadas pertencem exclusivamente ao servidor.

Senhas de acesso usam hash bcrypt. Credenciais SMTP armazenadas pela aplicação usam criptografia e dependem de uma chave própria no ambiente. O armazenamento de arquivos é privado nas integrações configuradas, com acesso por URLs temporárias assinadas.

## Validação

```sh
npm run check
npm test
npm audit --omit=dev --audit-level=high
```

As suítes de integração exigem habilitação explícita e fixtures de um ambiente isolado. Algumas alteram registros. Não use dados pessoais ou credenciais de produção nos testes ou apresentações.
