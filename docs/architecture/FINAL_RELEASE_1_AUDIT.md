# FINAL_RELEASE_1_AUDIT.md
> Auditoria Arquitetural — Gate Final Release 1  
> Data: 27 de julho de 2026  
> Escopo: Somente leitura. Nenhum arquivo de produção foi modificado.

---

## 1. PIPELINES DE CRIAÇÃO

### Resumo de Pipelines Oficiais

| Entidade | Pipeline Único? | Rota Oficial | Service | Repository |
|---|---|---|---|---|
| **Orders** | ❌ Não — 3 caminhos | `POST /api/orders` (`orders.routes.ts:113`) | `OrdersService.create` (`:349`) | `OrdersRepository.create` (`:121`) |
| **Deliveries** | ❌ Não — 2 caminhos | Side-effect de order create | `OrdersService.afterCreate` (`:666`) | `OrdersRepository.createDelivery` (`:267`) |
| **Clients/Companies** | ❌ Não — 2 caminhos | `POST /api/companies` (`companies.routes.ts:101`) | `CompaniesService.create` (`:57`) | `CompaniesRepository.create` (`:122`) |
| **Users** | ✅ Sim | `POST /api/users` (`users.routes.ts:44`) | `UsersService.create` (`:56`) | `UsersRepository.create` (`:132`) |

### Caminhos Alternativos Identificados

#### Orders — 3 pipelines paralelos
| # | Arquivo | Linha | Trecho | Motivo | Impacto |
|---|---|---|---|---|---|
| 1 | `orders.routes.ts` | 121 | `POST /api/orders/create-with-delivery` → `OrdersService.createWithDelivery` | Rota combinada order+delivery duplica lógica de criação | Médio — risco de inconsistência de hooks |
| 2 | `orders.service.ts` | 518 | `OrdersService.createInternal` | Pipeline separado para recurring orders; pode divergir de validações do `create` principal | Alto — bypass de validações do controller |
| 3 | `companies.service.ts` | 387 | `CompaniesService.generateRecurringOrders` → `createInternal` | Cross-domain: service de companies cria orders diretamente | Alto — violação de domain boundary |

#### Companies — 2 pipelines paralelos
| # | Arquivo | Linha | Trecho | Motivo | Impacto |
|---|---|---|---|---|---|
| 1 | `userProvisioningService.ts` | 41 | `createCompanyFromClaraAI` → `storage.createCompany` | Bypassa `CompaniesService.create` e vai direto ao storage | Alto — sem validações de negócio, sem audit log |

#### Deliveries — sem rota oficial dedicada
- Deliveries não possuem `POST /api/deliveries` independente — são sempre side-effects de order.
- `createWithDelivery` e `afterCreate` são dois fluxos paralelos que ambos chamam `repo.createDelivery` — risco de divergência de estado.

---

## 2. BYPASSES ARQUITETURAIS

### 2.1 Drizzle ORM fora de Repositories

| # | Arquivo | Linha | Trecho | Severidade |
|---|---|---|---|---|
| 1 | `server/services/storage.ts` | 698–1654 | Centenas de `db.insert/update/delete/select` diretos | 🔴 Bloqueador — monolito paralelo |
| 2 | `server/jobs/recurring-orders.cron.ts` | 231 | `db.insert(recurringOrderLogs)` | 🟠 Alto |
| 3 | `server/jobs/faturamento.cron.ts` | 99 | `db.insert(cronFaturamentoRuns)` | 🟠 Alto |
| 4 | `server/backup-storage.service.ts` | 137 | `db.insert(backupHistory)` | 🟡 Médio |
| 5 | `server/services/fiscal/fiscal-closure.service.ts` | 70 | `db.insert(fiscalClosures)` | 🟡 Médio |

### 2.2 Storage chamado diretamente de routes/provisioning

| # | Arquivo | Linha | Trecho | Severidade |
|---|---|---|---|---|
| 1 | `userProvisioningService.ts` | 41 | `storage.createCompany(...)` | 🔴 Bloqueador — bypass total de service+repository |
| 2 | `server/routes/bank.routes.ts` | 106 | `storage.upsertBankTransaction(...)` em loop | 🟠 Alto |

### 2.3 deleteScope/deleteAddress sem filtro por companyId

| # | Arquivo | Linha | Trecho | Severidade |
|---|---|---|---|---|
| 1 | `companies.repository.ts` | 226 | `db.delete(contractScopes).where(eq(contractScopes.id, scopeId))` | 🔴 Bloqueador — sem validação de tenant |
| 2 | `companies.repository.ts` | 231 | `db.delete(addresses).where(eq(addresses.id, addressId))` | 🔴 Bloqueador — sem validação de tenant |

### 2.4 sql.raw com interpolação de string

| # | Arquivo | Linha | Trecho | Severidade |
|---|---|---|---|---|
| 1 | `server/routes/routes.ts` | ~3797 | `` sql.raw(`SELECT count(*) as cnt FROM ${tbl}`) `` | 🟠 Alto — padrão inseguro mesmo com array fixo |

---

## 3. GRAFO DE DEPENDÊNCIAS

### Fluxo correto esperado
```
Route → Controller → Service → Repository → Database
```

### Inversões Detectadas

| # | Tipo de Inversão | Arquivo | Linha | Descrição | Severidade |
|---|---|---|---|---|---|
| 1 | **Route → Storage** (bypassa service+repo) | `userProvisioningService.ts` | 41 | `storage.createCompany` chamado sem passar por `CompaniesService` | 🔴 Bloqueador |
| 2 | **Route → Storage** | `bank.routes.ts` | 106 | `storage.upsertBankTransaction` chamado diretamente em rota | 🟠 Alto |
| 3 | **Service → Service cross-domain** | `companies.service.ts` | 387 | `CompaniesService` cria orders via `OrdersService.createInternal` | 🟠 Alto |
| 4 | **Service → DB direto** | `fiscal-closure.service.ts` | 70 | `db.insert` dentro de service sem passar por repository | 🟡 Médio |
| 5 | **Job → DB direto** | `recurring-orders.cron.ts` | 231 | `db.insert` em cron job sem repository | 🟡 Médio |
| 6 | **Job → DB direto** | `faturamento.cron.ts` | 99 | `db.insert` em cron job sem repository | 🟡 Médio |
| 7 | **Service → DB direto** | `storage.ts` (inteiro) | 1–3030 | `storage.ts` age como monolito paralelo a todos os repositories | 🔴 Bloqueador (dívida estrutural herdada) |

### Módulos com grafo correto (✅ conformes)
- `orders` module: Route → Controller → Service → Repository ✅
- `users` module: Route → Controller → Service → Repository ✅
- `finance` module: Route → Controller → Service → Repository ✅
- `fiscal` module (exceto fiscal-closure.service): Route → Controller → Service → Repository ✅
- `inventory` module: Controller → Service → Repository ✅

---

## 4. AUDITORIA DE REPOSITORIES

| Repository | Interface? | expectOne? | LogEntry? | Importa storage? | Importa outro repo? | Responsabilidade Única? | RFC-001? |
|---|---|---|---|---|---|---|---|
| `orders.repository.ts` | ✅ Sim | ✅ Sim | ✅ Sim | ❌ Não | ❌ Não | ✅ Sim | ✅ Sim |
| `companies.repository.ts` | ✅ Sim | ✅ Sim | ✅ Sim | ❌ Não | ❌ Não | ⚠️ Ampla (addresses, scopes, config, GPS, certificates) | ⚠️ Parcial |
| `users.repository.ts` | ✅ Sim | ✅ Sim | ✅ Sim | ❌ Não | ❌ Não | ✅ Sim | ✅ Sim |
| `finance.repository.ts` | ✅ Sim | ⚠️ Parcial | ✅ Sim | ❌ Não | ❌ Não | ✅ Sim | ✅ Sim |
| `products.repository.ts` | ✅ Sim | ⚠️ Parcial | ⚠️ Parcial | ❌ Não | ❌ Não | ⚠️ Ampla (inclui `findAllOrders`) | 🟠 Violação — `findAllOrders` não é responsabilidade de products |
| `companyCertificate.repository.ts` | ✅ Sim | ❌ Não | ❌ Não | ❌ Não | ❌ Não | ✅ Sim | ⚠️ Parcial |

### Achados críticos nos repositories

| Arquivo | Linha | Problema | Impacto | Correção |
|---|---|---|---|---|
| `companies.repository.ts` | 226 | `deleteScope` sem filtro `companyId` no `.where()` | 🔴 Qualquer cliente pode deletar scope de outro | Adicionar `and(eq(contractScopes.id, scopeId), eq(contractScopes.companyId, companyId))` |
| `companies.repository.ts` | 231 | `deleteAddress` sem filtro `companyId` no `.where()` | 🔴 IDOR — tenant isolation breach | Mesmo padrão acima |
| `products.repository.ts` | 101 | `findAllOrders` dentro do repo de products | 🟠 Violação de responsabilidade única | Mover para `orders.repository.ts` |

---

## 5. AUDITORIA DE SERVICES

| Service | Linhas (est.) | Responsabilidades | Métodos Grandes | Duplicação | Cross-domain | Dependências |
|---|---|---|---|---|---|---|
| `storage.ts` | ~3030 | **TUDO** — auth, companies, orders, products, logistics, fiscal, SaaS | `getPurchasingReport` (92L), `createOrder` (34L), múltiplos | **Extrema** | **Extrema** | db, bcrypt, repos, cache, securityLogger, tenant core |
| `orders.service.ts` | ~950+ | Criação, atualização, recurring, withDelivery | `createWithDelivery` (200+L) | `create` vs `createInternal` | `CompaniesService` (cross-domain) | ordersRepo, deliveryRepo, storage, mailer, alerts |
| `companies.service.ts` | ~400+ | CRUD, config, GPS, recurring orders, certificates | `generateRecurringOrders` (60L+) | ⚠️ Parcial com orders | Chama `OrdersService.createInternal` | companiesRepo, ordersService, storage |
| `alerts.service.ts` | ~388 | Email, Slack, WhatsApp (mock), rate-limiting | `emitAlert` (128L) — **muito grande** | Baixa | storage, mailer | storage, mailer, alerts-log.store |
| `mailer.ts` | ~439 | SMTP, templates de email | `sendNFeAutorizadaEmail` (52L) | Baixa | storage | nodemailer, storage |
| `nf.draft.ts` | ~314 | Lifecycle de NF-e draft | `createDraftFromOrder` (75L), `updateDraft` (65L) | Baixa | storage | storage, nf.draft.builder |
| `nf.draft.builder.ts` | ~218 | Geração de itens por estratégia | `buildAverageDraft` (88L) — **muito grande** | Baixa | storage | storage |
| `alerts.delivery.ts` | ~297 | Entrega multi-canal com filtro de preferências | `deliverAlert` (89L) — **muito grande** | Baixa | mailer | storage, mailer, alerts.preferences, alerts.routing |
| `pushService.ts` | ~225 | Web Push (VAPID), preferências | Médio | Baixa | storage | web-push, storage |

### Achados críticos em Services

| Arquivo | Linha | Trecho | Motivo | Impacto | Correção | Estimativa |
|---|---|---|---|---|---|---|
| `storage.ts` | 1–3030 | Inteiro arquivo | Monolito de 3030L exercendo função de repository para todos os domínios | 🔴 Impede evolução isolada de domínios | Migrar métodos remanescentes para repositories específicos por domínio | Release 2 — 8–15d |
| `orders.service.ts` | 706 | `createWithDelivery` | Método de 200+L duplica lógica de `create` + `afterCreate` | 🟠 Bug magnético | Refatorar para reutilizar o pipeline principal | 2–3d |
| `alerts.service.ts` | ~128 | `emitAlert` | Método único de 128L mistura roteamento, entrega e rate-limit | 🟡 Testabilidade ruim | Extrair em métodos privados | 1d |
| `companies.service.ts` | 387 | `generateRecurringOrders` | Service de companies cria orders — cross-domain | 🟠 Violação de boundary | Mover para `orders.service.ts` ou criar `recurringOrders.service.ts` | 1–2d |

---

## 6. AUDITORIA DE ROTAS

### Endpoints SEM middleware de autenticação (publicamente acessíveis)

| # | Método | Rota | Arquivo | Linha | Severidade | Motivo |
|---|---|---|---|---|---|---|
| 1 | POST | `/api/logs` | `logs.routes.ts` | 20 | 🔴 Bloqueador | Log injection público — qualquer agente externo pode injetar logs |
| 2 | POST | `/api/special-order-requests` | `special-order-requests.routes.ts` | 10 | 🔴 Bloqueador | Criação de pedido especial sem auth |
| 3 | GET | `/api/special-order-requests` | `special-order-requests.routes.ts` | 54 | 🟠 Alto | Leitura de pedidos especiais sem auth |
| 4 | POST | `/api/client-incidents/:id/mark-read` | `incidents.routes.ts` | 123 | 🟠 Alto | Marca incidente sem verificar ownership |
| 5 | POST | `/api/products` | `products.routes.ts` | 30 | 🔴 Bloqueador | Criação de produto sem gate de rota |
| 6 | PUT | `/api/products/:id` | `products.routes.ts` | 31 | 🔴 Bloqueador | Update de produto sem gate de rota |
| 7 | DELETE | `/api/products/:id` | `products.routes.ts` | 32 | 🔴 Bloqueador | Deleção de produto sem gate de rota |
| 8 | POST | `/api/categories` | `categories.routes.ts` | 17 | 🔴 Bloqueador | Criação de categoria sem auth |
| 9 | PUT | `/api/categories/:id` | `categories.routes.ts` | 18 | 🔴 Bloqueador | Update de categoria sem auth |
| 10 | DELETE | `/api/categories/:id` | `categories.routes.ts` | 19 | 🔴 Bloqueador | Deleção de categoria sem auth |

### Endpoints públicos intencionais (aceitáveis)
- `GET /api/geo/cep/:cep` — consulta de CEP pública ✅ Intencional
- `GET /api/track/:deliveryId` — rastreamento público ✅ Intencional
- `GET /api/settings/maintenance` & `/test-mode` — flags de sistema ⚠️ Requer revisão
- `GET /api/marketplace/modulos` — catálogo público ✅ Intencional
- `GET /api/product-prices` — preços públicos ⚠️ Requer revisão (dados de negócio expostos)

### Módulos com proteção correta
- `finance.routes.ts` — router-wide `requireAuth` ✅
- `fiscal.routes.ts` — router-wide `requireAuth` ✅
- `orders.routes.ts` — router-wide `tenantContext` ✅
- `users.routes.ts` — `requireRole` por endpoint ✅
- `master.routes.ts` — `requireMaster` em todos ✅
- `backup.routes.ts` — `BACKUP_ROLES` e `MASTER_ONLY` ✅
- `audit.routes.ts` — `requireRole` MASTER/ADMIN/DEVELOPER/DIRECTOR ✅

---

## 7. AUDITORIA DE SEGURANÇA

### 7.1 SQL Injection

| # | Arquivo | Linha | Trecho | Severidade | Correção | Estimativa |
|---|---|---|---|---|---|---|
| 1 | `server/routes/routes.ts` | ~3797 | `` sql.raw(`SELECT count(*) as cnt FROM ${tbl}`) `` | 🟠 Alto | Substituir por query paramétrica com whitelist explícita de tabelas | 2h |

### 7.2 Bypass de Autorização

| # | Arquivo | Linha | Trecho | Severidade | Correção | Estimativa |
|---|---|---|---|---|---|---|
| 1 | `incidents.routes.ts` | 123 | `POST /api/client-incidents/:id/mark-read` sem middleware | 🟠 Alto | Adicionar `requireSessionOrCompany` antes do handler | 30min |
| 2 | `companies.controller.ts` | 180, 190, 196 | `companyId` vindo de URL param sem validação contra session | 🟠 Alto | Validar `req.params.companyId === req.session.companyId` no service | 1h |
| 3 | `products.routes.ts` | 30–32 | `POST/PUT/DELETE /api/products` sem middleware de rota | 🔴 Bloqueador | Adicionar `requireSession` ou `requireRole` no router | 30min |
| 4 | `categories.routes.ts` | 17–19 | `POST/PUT/DELETE /api/categories` sem middleware | 🔴 Bloqueador | Adicionar `requireSession` ou `requireRole` no router | 30min |
| 5 | `logs.routes.ts` | 20 | `POST /api/logs` aberto | 🔴 Bloqueador | Adicionar auth ou remover endpoint público | 30min |

### 7.3 Bypass de Tenant Isolation

| # | Arquivo | Linha | Trecho | Severidade | Correção | Estimativa |
|---|---|---|---|---|---|---|
| 1 | `incidents.routes.ts` | 123 | `storage.markIncidentReadByClient(id)` sem validação de tenant | 🔴 Bloqueador | Verificar que o incident pertence ao `companyId` da sessão | 1h |
| 2 | `companies.repository.ts` | 226 | `deleteScope` sem `companyId` no WHERE | 🔴 Bloqueador | Adicionar `and(eq(id, scopeId), eq(companyId, companyId))` | 30min |
| 3 | `companies.repository.ts` | 231 | `deleteAddress` sem `companyId` no WHERE | 🔴 Bloqueador | Mesmo padrão | 30min |

### 7.4 Bypass de Audit Log

| # | Arquivo | Linha | Trecho | Severidade | Correção | Estimativa |
|---|---|---|---|---|---|---|
| 1 | `companies.service.ts` | 73, 79, 112, 118, 174, 179, 188 | CRUD básico de company/scope/address sem `repo.log` | 🟡 Médio | Adicionar chamada de audit log em cada mutação | 2h |

### 7.5 Bypass de Transaction

| # | Arquivo | Linha | Trecho | Severidade | Correção | Estimativa |
|---|---|---|---|---|---|---|
| 1 | `companies.repository.ts` | 102–111 | `updateCompanyConfig`/`updateCompanySettings` — upsert sem `db.transaction()` | 🟡 Médio | Envolver em `db.transaction()` | 1h |

### 7.6 Exposição de Senha/Secret

| # | Arquivo | Linha | Trecho | Severidade | Correção | Estimativa |
|---|---|---|---|---|---|---|
| 1 | `companies.controller.ts` | 70 | `res.json({ ...company, temporaryPassword })` — senha em texto claro na resposta | 🟠 Alto | Retornar apenas flag `passwordGenerated: true`; enviar senha por email | 1h |
| 2 | `auth.service.ts` | 183 | `console.log(` .../reset-password?token=${token}`)` — token em log | 🟡 Médio | Remover log ou substituir por log sem o token | 30min |

---

## 8. AUDITORIA DE PERFORMANCE

### 8.1 N+1 Queries

| # | Arquivo | Linha | Trecho | Impacto | Correção | Estimativa |
|---|---|---|---|---|---|---|
| 1 | `bank.routes.ts` | 106 | Loop sobre `transacoes` chama `storage.upsertBankTransaction` (select + insert por item) | 🔴 Alto | Usar `db.transaction()` com batch insert/upsert | 2h |
| 2 | `pricing.service.ts` | 182–194, 247–259 | Loop de price changes com `tx.update` por item | 🟡 Médio | Usar bulk update ou `db.batch` | 3h |

### 8.2 SELECT * (sem seleção de colunas)

| # | Arquivo | Linha | Impacto | Correção |
|---|---|---|---|---|
| 1 | `storage.ts` | 698–1654 | 🔴 Alto — +50 ocorrências em tabelas grandes (orders, systemLogs) | Especificar colunas necessárias por query |
| 2 | `executive-dashboard.routes.ts` | 35, 39 | 🔴 Alto — fetch de todos os pedidos sem colunas | Selecionar apenas colunas usadas no dashboard |
| 3 | `products.repository.ts` | 101 | 🔴 Alto — `findAllOrders` sem paginação nem colunas | Adicionar paginação e seleção explícita |

### 8.3 Ausência de Paginação

| # | Arquivo | Linha | Rota | Impacto | Correção |
|---|---|---|---|---|---|
| 1 | `products.repository.ts` | 101 | `findAllOrders` | 🔴 Alto | Adicionar `limit`/`offset` |
| 2 | `routes.ts` | 3682 | `GET /api/nf-manual` | 🟡 Médio | Adicionar paginação |
| 3 | `bank.routes.ts` | 122 | `GET /api/bank/transactions` | 🟡 Médio | Adicionar paginação |
| 4 | `storage.ts` | 1466 | `getLogisticsRoutes` | 🟡 Médio | Adicionar `limit`/`offset` |

### 8.4 Queries Duplicadas em Mesmo Request

| # | Arquivo | Linha | Problema | Impacto |
|---|---|---|---|---|
| 1 | `executive-dashboard.routes.ts` | 35, 39 | `db.select().from(orders)` chamado 2× (com e sem filtro de data) | 🟡 Médio — dobra carga no DB |

### 8.5 Indexes Ausentes no Schema

| # | Coluna | Tabelas afetadas | Impacto | Correção |
|---|---|---|---|---|
| 1 | `empresa_id` (FK para companies) | `categories`, `products`, `product_prices`, `product_sub_categories`, `order_windows`, `order_items`, `tasks`, `internal_incidents`, `logistics_drivers` | 🔴 Alto — todas as queries tenant-scoped fazem full scan | `index('idx_table_empresa_id').on(table.empresaId)` em cada tabela |
| 2 | `company_id` | `order_exceptions`, `special_order_requests`, `password_reset_requests`, `auth_attempts` | 🟠 Alto | Adicionar índice em cada |
| 3 | `order_id` | `recurring_order_logs` | 🟢 Baixo | Adicionar índice |

### 8.6 Operações Síncronas Bloqueantes

| # | Arquivo | Linha | Trecho | Impacto |
|---|---|---|---|---|
| 1 | `nfeCert.ts` | 101 | `fs.readFileSync(nfePath)` | 🟡 Médio — bloqueia event loop durante I/O |
| 2 | `upload.routes.ts` | 25 | `fs.mkdirSync` | 🟢 Baixo |

---

## 9. DÍVIDA TÉCNICA CLASSIFICADA

| # | Item | Classificação | Impacto | Complexidade | Tempo Est. | Pode esperar R2? |
|---|---|---|---|---|---|---|
| 1 | `POST /api/logs` sem auth | 🔴 Bloqueador | Log injection público | Baixa | 30min | ❌ Não |
| 2 | `POST/PUT/DELETE /api/products` sem middleware | 🔴 Bloqueador | Qualquer usuário pode criar/destruir catálogo | Baixa | 30min | ❌ Não |
| 3 | `POST/PUT/DELETE /api/categories` sem middleware | 🔴 Bloqueador | Idem | Baixa | 30min | ❌ Não |
| 4 | `deleteScope` sem companyId no WHERE | 🔴 Bloqueador | IDOR — tenant isolation breach | Baixa | 30min | ❌ Não |
| 5 | `deleteAddress` sem companyId no WHERE | 🔴 Bloqueador | IDOR — tenant isolation breach | Baixa | 30min | ❌ Não |
| 6 | `markIncidentReadByClient` sem verificação de tenant | 🔴 Bloqueador | Usuário pode marcar incidente de outro tenant | Baixa | 1h | ❌ Não |
| 7 | `temporaryPassword` em texto claro na resposta | 🟠 Alto | Senha exposta em logs/proxies | Baixa | 1h | ❌ Não |
| 8 | `userProvisioningService.ts` bypassa service layer | 🟠 Alto | Sem validações de negócio, sem audit log na criação via Clara AI | Média | 2h | ⚠️ Com risco |
| 9 | `storage.ts` — 3030L monolito paralelo a repos | 🟠 Alto (estrutural) | Impede evolução isolada; duplicação extrema | Muito alta | 8–15d | ✅ Sim |
| 10 | `companies.service.ts` cria orders (cross-domain) | 🟠 Alto | Violação de boundary, recurring orders não passa por validações de orders | Média | 1–2d | ⚠️ Com risco |
| 11 | Indexes ausentes em `empresa_id` (9 tabelas) | 🟠 Alto | Performance degradada em produção com volume | Baixa | 2h (migration) | ⚠️ Com risco |
| 12 | N+1 em `bank.routes.ts:106` | 🟠 Alto | Trava de BD proporcional ao nº de transações | Média | 2h | ⚠️ Com risco |
| 13 | `sql.raw` com template literal | 🟠 Alto | Padrão inseguro — risco futuro de SQL injection | Baixa | 1h | ❌ Não |
| 14 | `findAllOrders` em products.repository (sem paginação) | 🟠 Alto | Memory leak com volume de pedidos | Média | 2h | ⚠️ Com risco |
| 15 | `db.insert` direto em cron jobs | 🟡 Médio | Sem audit log, sem validação de domínio | Média | 2–3h | ✅ Sim |
| 16 | Audit log ausente em CRUD básico de companies | 🟡 Médio | Rastreabilidade incompleta | Baixa | 2h | ✅ Sim |
| 17 | `emitAlert` 128L, `buildAverageDraft` 88L | 🟡 Médio | Testabilidade e manutenibilidade | Média | 1d | ✅ Sim |
| 18 | SELECT * em 50+ queries de storage.ts | 🟡 Médio | Overhead de payload; piora com volume | Alta | 3–5d | ✅ Sim |
| 19 | Token de reset em `console.log` | 🟡 Médio | Account takeover se logs forem acessíveis | Baixa | 30min | ❌ Não |
| 20 | `fs.readFileSync` em nfeCert.ts | 🟡 Médio | Bloqueia event loop durante emissão NF-e | Baixa | 1h | ✅ Sim |
| 21 | Upsert sem transaction em `updateCompanyConfig` | 🟡 Médio | Race condition | Baixa | 1h | ✅ Sim |
| 22 | `executive-dashboard` — 2× full scan de orders | 🟡 Médio | Dobra carga no DB por request | Baixa | 1h | ✅ Sim |
| 23 | `GET /api/product-prices` público | 🟢 Baixo | Dados de negócio acessíveis sem auth | Baixa | 30min | ✅ Sim |

---

## 10. PARECER FINAL

### Bloqueadores para Produção (evidências)

| # | Arquivo | Linha | Trecho | Motivo | Impacto | Correção | Estimativa |
|---|---|---|---|---|---|---|---|
| B1 | `server/routes/logs.routes.ts` | 20 | `app.post('/api/logs', ...)` sem middleware | Log injection — atacante injeta logs falsos, polui auditoria | Operacional | Adicionar `requireSession` | 30min |
| B2 | `server/modules/products/products.routes.ts` | 30–32 | `POST/PUT/DELETE /api/products` sem middleware | Catálogo mutável por qualquer agente | Integridade de dados | Adicionar `requireRole(['ADMIN','MASTER','DEVELOPER'])` no router | 30min |
| B3 | `server/modules/products/categories.routes.ts` | 17–19 | `POST/PUT/DELETE /api/categories` sem middleware | Idem | Integridade de dados | Idem | 30min |
| B4 | `server/modules/companies/companies.repository.ts` | 226 | `db.delete(contractScopes).where(eq(contractScopes.id, scopeId))` | IDOR — empresa A deleta scope da empresa B | Isolamento de tenant | Adicionar `eq(contractScopes.companyId, companyId)` no WHERE | 30min |
| B5 | `server/modules/companies/companies.repository.ts` | 231 | `db.delete(addresses).where(eq(addresses.id, addressId))` | IDOR — idem para endereços | Isolamento de tenant | Idem | 30min |
| B6 | `server/routes/incidents.routes.ts` | 123 | `storage.markIncidentReadByClient(parseInt(req.params.id))` | Marcar incidente de outro tenant como lido | Isolamento de tenant | Verificar ownership antes da chamada | 1h |
| B7 | `server/routes/routes.ts` | ~3797 | `` sql.raw(`...${tbl}`) `` | Padrão de SQL injection — unsafe mesmo com whitelist | Segurança | Parametrizar ou usar mapa tipado | 1h |
| B8 | `server/modules/companies/companies.controller.ts` | 70 | `res.json({ ...company, temporaryPassword })` | Senha temporária em plaintext na resposta HTTP | Segurança | Retornar flag; enviar via email | 1h |
| B9 | `server/services/auth.service.ts` | 183 | `console.log(.../reset-password?token=${token})` | Token de reset exposto em logs | Segurança | Remover log | 30min |

**Total de bloqueadores: 9**  
**Tempo total estimado de resolução: ~7 horas**

---

### Veredicto Final

| Pergunta | Resposta |
|---|---|
| **Release 1 está pronta para produção?** | ❌ **Não** — 9 bloqueadores de segurança/integridade não resolvidos |
| **Existe algum bloqueador restante?** | ✅ Sim — 9 bloqueadores listados acima (B1–B9) |
| **O ERP suporta 100% da operação da VivaFrutaz?** | ✅ **Sim** — todos os fluxos de negócio (pedidos, entregas, fiscal, logística, financeiro, SaaS) estão implementados e funcionais. Os bloqueadores são de segurança, não de funcionalidade. |

### Scores de Saúde

| Dimensão | Score | Justificativa |
|---|---|---|
| **Saúde Arquitetural** | **58/100** | Módulos Orders/Users/Finance bem estruturados (+); `storage.ts` monolito paralelo, cross-domain `companies→orders`, pipeline duplo de companies via Clara AI, cron jobs com db direto (-) |
| **Saúde de Segurança** | **49/100** | 9 endpoints críticos sem proteção, 2 IDOR confirmados, senha em plaintext na resposta, token em log (-); auth robusto em módulos core, requireRole bem aplicado nos módulos migrados (+) |
| **Saúde de Manutenibilidade** | **63/100** | Padrão RFC-001 bem estabelecido nos módulos Wave 1 (+); `storage.ts` de 3030L, `emitAlert` de 128L, `createWithDelivery` de 200L, SELECT * em 50+ queries (-) |
| **Saúde de Escalabilidade** | **52/100** | Cache implementado, paginação parcial (+); 9 tabelas sem índice em `empresa_id`, N+1 em bank transactions, `findAllOrders` sem paginação, SELECT * dominante em storage.ts (-) |

---

*Documento gerado exclusivamente como auditoria. Nenhum arquivo de produção foi modificado.*
