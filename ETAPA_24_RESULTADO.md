# ETAPA 24 — Contexto de Tenant Fail-Closed

## Escopo e resultado

Esta etapa consolidou a resolução central de tenant e fechou fallbacks
comprovadamente perigosos nos módulos de pedidos, empresas, usuários e
relatórios. O objetivo foi impedir que uma sessão sem empresa vinculada ou um
serviço sem alvo alcançasse um controller, service ou storage em escopo global
por acidente.

Não houve migration, alteração de tabela/coluna/índice, alteração de dados,
deploy ou commit.

## Política efetiva de resolução

1. A sessão autenticada é a fonte confiável:
   - sessão de portal com `companyId` fixa o tenant da empresa;
   - sessão de usuário é resolvida pelo `userId` no banco e usa `user.empresaId`;
   - sessão vinculada não pode ser trocada por query, header ou body.
2. `X-Empresa-Id` e `?empresaId=` só selecionam tenant em fluxos globais
   explicitamente permitidos (`MASTER`/`DIRECTOR` sem empresa) ou em chamadas de
   serviço autenticadas.
3. Header e query precisam concordar; valores inválidos, repetidos/ambíguos ou
   não positivos resultam em `403`. O body nunca participa da resolução.
4. Serviço autenticado exige exatamente um tenant alvo antes de chegar ao
   handler. Serviço sem alvo não representa visão global.
5. `MASTER` e `DIRECTOR` sem empresa continuam podendo usar as rotas globais
   classificadas como legítimas. `ADMIN` e `DEVELOPER` sem empresa falham com
   `403` e não recebem visão global implícita.
6. Ausência de sessão falha com `401`. Contexto ausente para uma operação
   tenant-scoped falha com `401`; contexto autenticado sem tenant alvo falha
   com `403`.

`resolveTenant()` legado agora apenas lê o tenant já instalado no
`AsyncLocalStorage`; não observa mais `req.user`, query, header ou body e não
retorna o marcador textual `GLOBAL_VIEW`.

## Fallbacks e vulnerabilidades corrigidos

- **Pedidos:** `OrdersRepository.assertOwned()` exige `requireTenantId()` antes
  de update, delete e replace-items. Um operador global precisa fixar o tenant
  antes de qualquer mutação; não há mais retorno antecipado que permita escrita
  global.
- **Empresas:** chamadas de serviço sem alvo são rejeitadas no middleware.
  Escritas usam `requireAuth` (não `requireAuthOrService`), preservando o
  contrato de que API key não cria/edita/exclui empresas. Listas paginadas,
  leituras e mutações do repositório exigem contexto global explícito ou
  restringem-se ao tenant atual.
- **Usuários:** `list()` e `getById()` só fazem leitura global para
  `MASTER`/`DIRECTOR` explicitamente globais. Criação, atualização, exclusão,
  alteração de senha e desbloqueio exigem tenant resolvido; `empresaId` do
  body não pode mover o alvo.
- **Segurança administrativa:** desbloqueio de empresa e listagem de contas
  bloqueadas passaram a instalar o contexto e filtram usuários/empresas pelo
  tenant quando o operador está vinculado.
- **Relatórios:** a política local existente foi preservada: `MASTER`/`DIRECTOR`
  globais continuam autorizados, enquanto perfis não globais sem empresa
  recebem `403`. `companyId` inválido em visão global agora é rejeitado, e
  tenant vinculado continua ignorando esse filtro.

## Call-sites classificados

| Superfície | Classificação | Regra |
| --- | --- | --- |
| `/api/orders` e aliases versionados | tenant-bound/mista | leituras globais somente para `MASTER`/`DIRECTOR`; mutações sempre tenant-bound |
| `/api/companies` | mista | serviço exige alvo; operador global explícito pode listar/administrar |
| `/api/users` e `/api/admin/users` | tenant-bound para CRUD | identidade/autenticação mantém lookup global separado |
| `/api/reports/*` | mista explícita | tenant vinculado é fixado; `MASTER`/`DIRECTOR` global é preservado |
| `/api/master/*` | global legítima | gate estrito `MASTER` existente |
| endpoints de módulos excluídos | fora do escopo | auditados sem alteração nesta etapa |
| endpoints públicos/legados sem contexto | suspeitos | não foram convertidos em um fallback global; os call-sites alterados exigem contexto no limite |

## Testes e validação

Foi adicionada a matriz `tests/unit/tenant-context-fail-closed.test.ts`,
cobrindo:

- sessão do tenant A contra query/header do tenant B;
- body não utilizado para escolher tenant;
- sessão anônima (`401`);
- `ADMIN`/`DEVELOPER` sem empresa (`403`);
- `MASTER`/`DIRECTOR` globais;
- serviço sem alvo e seletores conflitantes;
- `resolveTenant()` sem confiança em `req.user`;
- mutação de pedido sem tenant e mutação sob operador global;
- rotas reais de pedidos, empresas e relatórios, verificando que o handler
  não é chamado quando o contexto é inválido e que relatório vinculado recebe
  o tenant da sessão.

Resultados desta execução:

- `npm run check` — passou.
- `git diff --check` — passou.
- Testes direcionados de tenant/orders/users/reports — **39 passaram, 0 falharam**.
- `BOOT_VALIDATION_OK` apareceu durante os testes.
- `DB_CONNECTED` e `APP_READY` não foram usados como critério de aprovação,
  pois a matriz foi desenhada para não depender de banco nem iniciar o app
  completo.
- `npm run build` — passou. Os avisos existentes de chunks grandes do Vite e
  `import.meta` no bundle CJS permanecem sem erro de build.
- `npm run test:unit` — executou 338 testes: **328 passaram e 10 falharam**.
  Todas as 10 falhas estão em `tests/unit/order-deadline.test.ts` e são a
  diferença preexistente de uma hora UTC/BRT (obtido `16:00Z`, esperado
  `15:00Z`), sem relação com esta etapa.

## Limitações e itens não alterados

- Não foram alterados NF-e/fiscal, certificado A1, impostos/DANFE, GPS,
  Push, financeiro/banco, inventário, products/prices, deliveries, route
  stops, quotations ou incidents.
- Não houve refatoração geral de todos os endpoints legados. Fluxos globais
  administrativos permanecem globais apenas onde seu gate já os classifica
  explicitamente; novas migrações de superfícies legadas devem usar o mesmo
  contrato.
- A falha preexistente de UTC/BRT em `tests/unit/order-deadline.test.ts` será
  registrada somente se reaparecer na suíte completa.