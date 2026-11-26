# Preparação da versão acadêmica

Esta edição foi exportada como uma nova árvore de arquivos e possui histórico independente, organizado em commits por funcionalidade, com títulos e descrições em português. Nenhum commit, branch, tag ou metadado de autoria do histórico original foi importado. Issues, pull requests, releases, artefatos, secrets, variáveis de implantação, uploads, banco e arquivos de serviços externos não fazem parte da cópia.

## Tratamento dos arquivos

- Remoção de documentos internos de estratégia e revisão operacional.
- Remoção dos seeds SQL de empresas, pessoas e senhas compartilhadas; preservação da estrutura e das migrations.
- Substituição das identidades de demonstração por `Pessoa Demo NN` e contatos no domínio reservado `example.invalid`.
- Remoção das referências específicas a produção e do destino de produção padrão nos testes.
- Variáveis de credenciais vazias no `.env.example`; exigência explícita de ambiente e habilitação para integração.
- Exclusões no `.gitignore` para configurações locais, uploads, logs, chaves, certificados, bancos, backups e relatórios de execução.
- Metadados dos commits acadêmicos sem nomes ou e-mails pessoais.

## Verificação

A validação antes da publicação compreende varredura de segredos com Gitleaks, busca complementar por dados pessoais e identificadores de infraestrutura, revisão dos arquivos, checagem de sintaxe, testes locais e conferência do histórico Git novo. A demonstração usa fixtures locais e não requer credenciais.

Strings como `demo-token`, tokens deliberadamente inválidos e senhas sintéticas de testes unitários são fixtures; não dão acesso a serviços. Definições de campos como CPF, telefone e senha pertencem ao modelo da aplicação e não contêm registros pessoais.

A varredura automatizada não equivale a uma garantia absoluta de ausência de informação sensível. Esta preparação cobre os arquivos publicados e o histórico novo; não altera nem revoga credenciais ou dados dos sistemas de origem.

## Resultado das verificações desta edição

- Gitleaks 8.30.1: nenhum segredo identificado nos arquivos preparados.
- Checagem de sintaxe: 44 arquivos JavaScript validados.
- Testes: 26 aprovados, 37 de integração ignorados e nenhuma falha.
- Navegação em Chromium: entrada pelo botão de demonstração e seis áreas principais abertas, sem erros JavaScript e sem chamadas à API pela demonstração.
- Dependências atualizadas para corrigir os avisos da auditoria npm, incluindo Nodemailer 10.6.1; a integração SMTP real não foi exercitada.

Os testes conectados, envio de e-mails, persistência e aplicação das migrations não foram executados contra serviços reais.
