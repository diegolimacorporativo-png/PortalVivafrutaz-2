# ETAPA 34 — Correção do IDOR Cross-Tenant na Timeline Operacional

**Data:** 10 de setembro de 2026  
**Escopo:** somente HIGH #1 da Etapa 33  
**Modo:** implementação direcionada, sem migration e sem alteração de dados reais

## 1. Endpoint afetado

O endpoint confirmado foi:

```text
GET /api/admin/operations/timeline/:orderId
```

Arquivo da rota:

```text
server/routes/operations.routes.ts
```

A timeline correlaciona:

- `orders`;
- `workflow_events`;
- `nfe_emissoes`;
- `nfe_training_logs`;
- `nf_drafts`;
- `accounts_receivable`;
- `event_store`.

A entidade principal é `orders`. O vínculo de tenant é `orders.companyId`.

Também foi revisado o endpoint modular `GET /api/orders/:id/timeline`. Ele já chama `validateOrderTenant` antes do service e não foi alterado nesta etapa.

## 2. Causa do IDOR

Antes da correção, a rota operacional:

1. exigia apenas autenticação e role;
2. buscava o pedido com `WHERE orders.id = :orderId`;
3. carregava em paralelo todos os dados correlacionados;
4. não executava `tenantContext`;
5. não aplicava `companyId`/tenant na query principal.

Assim, um usuário autenticado de uma empresa podia informar um `orderId` pertencente a outra empresa e receber a timeline operacional, incluindo informações de workflow, valores, dados fiscais e contas a receber.

## 3. Exploração antes da correção

Um usuário autenticado da empresa A poderia chamar:

```text
GET /api/admin/operations/timeline/{id-do-pedido-da-empresa-B}
```

O ID era suficiente para localizar o pedido porque a consulta não relacionava o ID ao tenant da sessão.

O mesmo risco alcançava os dados indiretos, pois as consultas de `workflow_events`, NF-e, drafts, contas a receber e `event_store` eram iniciadas antes de qualquer validação de ownership.

## 4. Correção aplicada

### 4.1 Tenant resolvido na borda HTTP

A rota agora executa:

```text
requireAuth
→ tenantContext
→ requireRole
→ handler
```

Isso reutiliza o mecanismo global existente e impede que body, query string ou headers substituam o tenant de uma sessão vinculada.

### 4.2 Consulta principal tenant-scoped

Para usuário tenant-bound, a consulta passou a exigir simultaneamente:

```text
orders.id = orderId
AND orders.companyId = currentTenantId()
```

Se o pedido não pertencer ao tenant, a rota retorna 404 e não revela a existência do recurso.

### 4.3 Validação antes dos dados correlacionados

A consulta do pedido é executada primeiro. Somente depois de provar ownership são carregados os eventos relacionados.

Se o pedido não for encontrado no tenant:

- nenhuma consulta detalhada é iniciada;
- nenhum dado parcial é retornado;
- a resposta é 404.

### 4.4 Política global preservada

O fluxo global existente foi preservado somente para administradores globais explícitos:

- `MASTER` sem empresa vinculada;
- `DIRECTOR` sem empresa vinculada.

`ADMIN` ou `DEVELOPER` sem tenant continuam bloqueados. Não foi criado fallback global.

## 5. Spoofing e ownership indireto

A implementação não usa estes valores enviados pelo cliente para definir o tenant:

- `empresaId`;
- `empresa_id`;
- `companyId`;
- `company_id`;
- `tenantId`;
- `tenant_id`;
- body;
- query string;
- headers.

O `orderId` do path é validado contra `orders.companyId` antes das relações indiretas serem consultadas. Portanto, um evento, delivery, registro fiscal ou conta a receber associado ao pedido B não é alcançável por um tenant A através do ID do pedido.

## 6. Testes direcionados

Arquivo criado:

```text
tests/unit/operations-timeline-tenant-isolation.test.ts
```

Cobertura:

1. empresa A acessa timeline própria: permitido;
2. empresa A acessa ID de pedido B: bloqueado;
3. `empresaId` na query não troca tenant;
4. `X-Empresa-Id` não troca tenant;
5. body com `empresaId`, `companyId` e `tenantId` não troca tenant;
6. dados correlacionados não são consultados antes da validação;
7. usuário sem sessão recebe 401;
8. usuário sem tenant fora da política global recebe 403;
9. MASTER global preserva acesso global;
10. DIRECTOR global preserva acesso global;
11. recurso de empresa B não aparece na resposta.

Resultado direcionado:

```text
7 testes
7 aprovados
0 falhas
```

## 7. Regressão

### `npm run check`

PASSOU.

### `npm run build`

PASSOU.

O build apresentou somente warnings já existentes de chunks grandes/imports dinâmicos e do bundle CommonJS do validador fiscal. Nenhum warning foi causado pela correção da timeline.

### `npm test`

PASSOU:

```text
366 testes
366 aprovados
0 falhas
```

### `git diff --check`

PASSOU, sem erros de whitespace.

## 8. Workflow e Supabase

Workflow verificado:

```text
Start application — RUNNING
```

Sinais confirmados:

- `DB_CONNECTED` com provider Supabase;
- `APP_READY`;
- servidor escutando na porta 5000;
- `GET /api/health` retornando HTTP 200;
- preview HTTP respondendo.

Nenhuma tabela, schema ou dado do Supabase foi alterado. A validação foi feita com mocks nos testes direcionados e com o workflow conectado ao Supabase apenas para confirmar o boot/health.

## 9. Arquivos alterados

Implementação:

```text
server/routes/operations.routes.ts
```

Testes:

```text
tests/unit/operations-timeline-tenant-isolation.test.ts
```

Relatório:

```text
docs/security/ETAPA_34_TIMELINE_IDOR_FIX.md
```

Não foram alterados `tenantContext` global, schema, migrations, banco, fiscal/NF-e, financeiro, inventory, GPS, deliveries fora da timeline, produtos, preços, quotations, push ou public tracking tokens.

## 10. Outros HIGH não tratados

Conforme o escopo obrigatório, os outros seis HIGH da Etapa 33 não foram corrigidos nesta etapa:

1. token de recuperação de senha armazenado em claro;
2. logging integral de corpos de resposta HTTP;
3. exposição de configuração sensível em `company-config`;
4. bypass de rate limit por `X-Forwarded-For`;
5. métodos legados de pedidos sem ownership garantido;
6. inteligência comercial/logística sem escopo tenant explícito.

## 11. Estado Git

Não foi criado commit.

Arquivos de implementação/teste desta etapa:

```text
M  server/routes/operations.routes.ts
?? tests/unit/operations-timeline-tenant-isolation.test.ts
?? docs/security/ETAPA_34_TIMELINE_IDOR_FIX.md
```

O arquivo de instruções anexado permanece como artefato não rastreado. Nenhuma alteração fora do escopo foi descartada.

## 12. Painel final

| Item | Resultado |
|---|---|
| ETAPA 1–33 | Contexto preservado |
| ETAPA 34 | IDOR da timeline operacional corrigido |
| HIGH restantes | 6 |
| MEDIUM | Não tratados nesta etapa |
| LOW | Não tratados nesta etapa |
| Testes direcionados | 7/7 |
| `npm run check` | PASS |
| `npm run build` | PASS |
| `npm test` | PASS — 366/366 |
| Workflow | PASS — `DB_CONNECTED`, `APP_READY`, HTTP 200 |
| Supabase | Conectado; sem alteração de dados |
| Git | Sem commit |
| NF-e/fiscal | Não alterado |

**Critério de aprovação:** aprovado para o escopo da Etapa 34. O IDOR cross-tenant da timeline operacional está bloqueado, o tenant spoofing está bloqueado e a consulta detalhada ocorre somente após a validação de ownership.