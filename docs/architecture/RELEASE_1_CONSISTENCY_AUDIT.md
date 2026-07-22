# RELEASE 1 — CONSISTENCY AUDIT
**VivaFrutaz ERP | Data: 2026-07-22 | Auditor: Agent (read-only)**

> Nenhum arquivo foi alterado durante esta auditoria.
> Todas as evidências são retiradas diretamente do código-fonte.

---

## Índice

1. [Mapa de Módulos](#etapa-1--mapa-de-módulos)
2. [Fluxos Críticos](#etapa-2--fluxos-críticos)
3. [Acoplamentos](#etapa-3--acoplamentos)
4. [Padrão Repository](#etapa-4--padrão-repository)
5. [Padrão Service](#etapa-5--padrão-service)
6. [Controllers](#etapa-6--controllers)
7. [Rotas](#etapa-7--rotas)
8. [Jobs e Crons](#etapa-8--jobs-e-crons)
9. [Segurança](#etapa-9--segurança)
10. [Matriz de Dívida Técnica](#etapa-10--matriz-de-dívida-técnica)

---

## ETAPA 1 — Mapa de Módulos

### 1.1 Estrutura de Módulos (`server/modules/`)

| Módulo | service | repository | controller | routes | interface | index.ts |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| auth | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| banking/itau | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| billing | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| companies | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| finance | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| fiscal | ✅* | ❌ | ✅ | ✅ | ❌ | ✅ |
| inventory | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| logistics | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| nfe | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| orders | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| products | ✅ | ✅ | ✅ | ✅ | ✅* | ✅ |
| security | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| users | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

*fiscal: serviço espalhado em `server/services/fiscal/`. products: interface existe mas cobertura parcial.

### 1.2 TODOs e FIXMEs Encontrados

| Arquivo | Linha | Conteúdo |
|---|---|---|
| `server/routes/routes.ts` | 592 | `// TODO (limpeza futura): remover este bloco inteiro quando routes.ts for` |
| `server/services/aiDeveloper/labFunctions.ts` | 384 | `// TODO: Implement` |
| `server/services/aiDeveloper/labFunctions.ts` | 395 | `// TODO: Implement` |
| `server/services/aiDeveloper/labFunctions.ts` | 406 | `// TODO: Implement` |
| `server/services/aiDeveloper/labFunctions.ts` | 417 | `// TODO: Implement` |

### 1.3 Exports Provavelmente Mortos

| Arquivo | Export | Problema |
|---|---|---|
| `server/modules/users/users.admin.routes.ts` | `usersAdminRouter` | Exportado e importado em `users/index.ts` como parte de `adminDefinition`, mas usage não confirmado no router principal |
| `server/modules/billing/billing.resolver.ts` | `resolveCompanyBillingConfig` | Nenhum import encontrado em `server/` |

### 1.4 Acesso Direto a Drizzle `db` Fora de Repositories

| Arquivo | Tipo de Acesso |
|---|---|
| `server/routes/routes.ts` | `db.execute(sql...)`, `db.insert(...)`, `db.select(...)` — centenas de ocorrências |
| `server/services/storage.ts` | `db.select()`, `db.insert()`, `db.update()` — centenas de ocorrências (god class) |
| `server/jobs/faturamento.cron.ts` | `db` direto (Drizzle) para buscar pedidos elegíveis |
| `server/jobs/recurring-orders.cron.ts` | `db` direto (Drizzle) |
| `server/modules/logistics/auto-dispatch.service.ts` | `db.execute(...)` |
| `server/modules/billing/billing.service.ts` | `db.select().from(products)` (linha 207) |
| `server/modules/orders/orders.transaction.ts` | `db.transaction(...)` |
| `server/core/tenant/scope.ts` | `withTenant` helper com `db` direto |
| `server/index.ts` | `db.execute` para inicialização/migrations |
| `server/backup.ts` | `db.select().from(...)` em todas as tabelas |

---

## ETAPA 2 — Fluxos Críticos

### 2.1 PEDIDO (Order Creation)

**Status: ✅ Unificado após R1** (1 pipeline oficial)

| Caminho | Entry Point | Método | Status |
|---|---|---|---|
| Manual (cliente) | `POST /api/orders` | `ordersService.create()` | ✅ pipeline completo |
| Administrativo | `POST /api/orders/create-with-delivery` | `ordersService.createWithDelivery()` | ✅ unificado na R1 |
| Recorrente/Sistema | interno | `ordersService.createInternal()` | ✅ pipeline completo |
| generateOrdersFromScope | `POST /api/companies/:id/generate-orders-scope` | `companiesService.generateOrdersFromScope()` → `createInternal()` | ✅ pipeline completo |

### 2.2 CLIENTE (Company Creation)

**Status: ✅ Caminho único**

Entry point: `POST /api/companies` → `companiesController.create()` → `companiesService.create()` → `companiesRepository`.

### 2.3 CONTRATO / ESCOPO

**Status: ⚠️ Caminho único, sem Service dedicado**

`generateOrdersFromScope` em `companiesService` — lógica de geração de pedidos por escopo contratual vive no módulo de companies em vez de um módulo `contracts` dedicado. Não há caminhos paralelos, mas a responsabilidade está no domínio errado.

### 2.4 SEPARAÇÃO (Picking)

**Status: ✅ Caminho único**

`POST /api/orders/:id/transition` (status `APPROVED → PROCESSING`) via `ordersService.transition()`. Workflow enforced — transição direta `APPROVED → INVOICED` bloqueada para não-privilegiados.

### 2.5 ENTREGA (Delivery Creation)

**Status: 🔴 3 caminhos paralelos**

| # | Caminho | Arquivo |
|---|---|---|
| 1 | `afterCreate()` auto-logistics (quando delivery não existe) | `orders.service.ts:641` |
| 2 | `createWithDelivery()` criação inline síncrona | `orders.service.ts:903` |
| 3 | `POST /api/logistics/deliveries` criação direta | `logistics.routes.ts` via `storage.createDelivery` |

Os caminhos 1 e 2 foram coordenados na R1 (afterCreate verifica existência antes de criar). O caminho 3 permanece independente e bypassa o service de orders completamente.

### 2.6 LOGÍSTICA (Dispatcher)

**Status: ⚠️ 2 caminhos (automático + manual — ambos intencionais)**

- Automático: `auto-dispatch.service.ts` worker (10s) — atribui entregas a rotas via otimizador
- Manual: `logistics.controller` endpoints para inserção manual de rotas e atribuição de motorista

Ambos os caminhos são intencionais e complementares, mas `auto-dispatch.service.ts` acessa `db` diretamente.

### 2.7 OCORRÊNCIA (Incident Logging)

**Status: ⚠️ 2 caminhos paralelos sem convergência**

- `POST /api/client-incidents` — para clientes/empresas
- `POST /api/internal-incidents` — para tarefas internas
- IA Clara dispara `clara_task` que é separado do sistema de incidentes estruturado

### 2.8 USUÁRIO (User Creation)

**Status: ⚠️ 2 caminhos paralelos**

| Caminho | Arquivo | Guard |
|---|---|---|
| Oficial | `usersController.create()` via `users.routes.ts` | Requer ADMIN/MASTER |
| IA-driven | `userProvisioningService` (onboarding via Clara) | Guard não confirmado |

### 2.9 PERMISSÕES

**Status: ⚠️ Centralizado mas aplicação inconsistente nas rotas**

Middleware central: `requireAuth` + `requireRole([...])` em `server/core/http/requireAuth`. Problema: diversas rotas administrativas usam apenas `requireAuthCore` sem `requireRole` (ver Etapa 9).

### 2.10 UPLOADS

**Status: ✅ 2 estratégias intencionais e documentadas**

- `server/infra/upload.ts` — memória, para OCR/PDF (ephemeral)
- `server/modules/products/upload.routes.ts` — disco em `uploads/products` (persistente)

### 2.11 IA CLARA

**Status: ⚠️ Módulo existente mas 2 rotas separadas**

- Classe: `server/services/aiDeveloper.ts` (singleton `claraIA`)
- Rotas: `server/routes/clara.routes.ts` E `server/routes/assistant.routes.ts` — duas rotas para o mesmo domínio
- `server/modules/ai/` existe mas contém apenas `README.md` — módulo declarado, não implementado

---

## ETAPA 3 — Acoplamentos

### 3.1 Services que Importam Outros Services

| Arquivo | Importa | Linha | Violação |
|---|---|---|---|
| `server/modules/banking/itau/retorno.service.ts` | `financeRepository` direto | — | Service acessa repo de outro domínio |
| `server/services/storage.ts` | `usersRepository`, `companiesRepository` | 621, 1201, 1250 | God class importando repos de domínios distintos |

### 3.2 Controllers que Importam Repository Diretamente

| Arquivo | Acesso | Linha | Violação |
|---|---|---|---|
| `server/modules/logistics/logistics.controller.ts` | `(this.service as any).repo` | 71, 106, 415, 722 | Cast forçado para acessar repo privado do service |

### 3.3 Repositories que Importam de Outro Domínio

| Arquivo | Importa | Linha | Violação |
|---|---|---|---|
| `server/modules/products/products.repository.ts` | `orders` (schema) | 40 | Cross-domain read |
| `server/modules/finance/finance.repository.ts` | `orders`, `nfeEmissoes` (schema) | 41 | Cross-domain read |
| `server/modules/orders/orders.repository.ts` | `accountsReceivable` (schema) | 23 | Cross-domain read |
| `server/modules/users/users.repository.ts` | `invalidateUsageCache` de `../billing/usage-cache` | 22 | Cross-module side-effect em repository |
| `server/modules/nfe/nfe-persist.transaction.ts` | `invalidateUsageCache` de `../../modules/billing/usage-cache` | — | Cross-module side-effect em transaction |

### 3.4 Módulos com Acesso Direto a `storage.ts` / `db`

| Arquivo | Problema |
|---|---|
| `server/routes/routes.ts` | Usa `storage` (DatabaseStorage) extensivamente — centenas de chamadas |
| `server/routes/saas.routes.ts` | Usa `storage` inline em handlers |
| `server/routes/about-us.routes.ts` | Usa `storage` inline |
| `server/routes/admin-intelligence.routes.ts` | Usa `storage` + `db` inline |
| `server/routes/fiscal-diagnostics.routes.ts` | `db.execute(sql...)` direto |
| `server/routes/executive-dashboard.routes.ts` | Drizzle direto nos handlers |
| `server/routes/alert.routes.ts` | `db` direto |
| `server/backup.ts` | `db.select()` em todas as tabelas |
| `server/jobs/faturamento.cron.ts` | `db` direto |
| `server/jobs/recurring-orders.cron.ts` | `db` direto |
| `server/modules/billing/billing.service.ts` | `db.select().from(products)` (linha 207) |
| `server/modules/logistics/auto-dispatch.service.ts` | `db.execute(...)` |

### 3.5 Dependência Invertida (core → modules)

Não encontrado. `server/core/` não importa de `server/modules/` diretamente.

### 3.6 Circular Imports Confirmados

| Ciclo | Evidência |
|---|---|
| `storage.ts` → `usersRepository` → `storage.ts` (potencial) | `storage.ts` importa `usersRepository`; `usersRepository` usa `storage` como fallback durante migração |
| `storage.ts` → `companiesRepository` → `storage.ts` (potencial) | Mesmo padrão |

---

## ETAPA 4 — Padrão Repository

### 4.1 Compliance por Repository

| Repository | Interface | expectOne() | LogEntry compartilhado | Cross-domain | Conforme |
|---|:---:|:---:|:---:|:---:|:---:|
| `companies.repository.ts` | ✅ | ✅ | ✅ | ❌ | ✅ **referência** |
| `users.repository.ts` | ✅ | ❌ | ✅ | ⚠️ billing import | ⚠️ |
| `products.repository.ts` | ✅* | ❌ | ❌ inline `SystemLogEntry` | ✅ orders | ❌ |
| `finance.repository.ts` | ❌ | ❌ | ❌ inline objects | ✅ orders + nfe | ❌ |
| `orders.repository.ts` | ❌ | ❌ | ❌ sem log | ✅ accountsReceivable | ❌ |
| `logistics.repository.ts` | ❌ | ❌ | ❌ sem log | ❌ | ❌ |
| `auth.repository.ts` | ❌ | ❌ | ❌ sem log | ❌ | ❌ |
| `inventory.repository.ts` | ❌ | ❌ | ❌ sem log | ❌ | ❌ |
| `security.repository.ts` | ❌ | ❌ | ❌ sem log | ❌ | ❌ |

### 4.2 Divergências Detalhadas

**Interfaces faltantes** (6 de 9 repositories):
- `server/modules/finance/finance.repository.ts`
- `server/modules/orders/orders.repository.ts`
- `server/modules/auth/auth.repository.ts`
- `server/modules/logistics/logistics.repository.ts`
- `server/modules/inventory/inventory.repository.ts`
- `server/modules/security/security.repository.ts`

**`expectOne()` ausente** (8 de 9): Apenas `CompaniesRepository` usa o helper. Os demais usam `rows[0]` ou array direto, sem tratamento uniforme de "not found".

**LogEntry inline** (2 ocorrências):
- `server/modules/products/products.repository.ts:128` — usa `SystemLogEntry` local em vez do tipo compartilhado
- `server/modules/finance/finance.repository.ts:513` — objeto inline sem tipo

**Export de singleton**: Todos os repositories exportam singleton no próprio arquivo (e.g., `export const ordersRepository = new OrdersRepository()`). Nenhum `index.ts` de módulo re-exporta o singleton — padrão inconsistente com módulos que exportam tudo pelo index.

---

## ETAPA 5 — Padrão Service

### 5.1 Services com Tamanho Excessivo

| Arquivo | Linhas | Problema |
|---|---|---|
| `server/services/storage.ts` | ~3030 | God class — agrega todos os domínios, acesso direto a db, importa repositories externos |
| `server/modules/orders/orders.service.ts` | ~2242 | Service de domínio grande; contém 3 métodos >200 linhas |

### 5.2 Métodos Acima de 200 Linhas

| Arquivo | Método | Linhas aprox. | Problema |
|---|---|---|---|
| `server/modules/orders/orders.service.ts` | `createWithDelivery` | ~246 (L706) | Price resolver + orchestration inline |
| `server/modules/orders/orders.service.ts` | `transition` | ~232 (L1034) | State machine + permissions + notifications |
| `server/modules/orders/orders.service.ts` | `substituteItem` | ~241 (L1727) | Item replacement + price recalc + audit inline |

### 5.3 Normalização / Validação Duplicada

| Problema | Ocorrências | Evidência |
|---|---|---|
| `assertPeriodOpen` / fiscal closure guard | 6× no mesmo service | `orders.service.ts` linhas 959, 1281, 1392, 1419, 1441, 1540 — mesma guard chamada individualmente em cada mutação |
| `userRole: "CLIENT"` hardcoded | 3× no mesmo service | `orders.service.ts` linhas 421, 1402, 1519 (linha 585 corrigida na R1) |

### 5.4 Cross-Domain via Repo Proxy

Repositories atuam como gateways agregados para outros domínios, o que faz os services parecerem isolados mas esconde acoplamento real:

| Service | Acessa via repo | Domínio cruzado |
|---|---|---|
| `orders.service.ts` | `this.repo.getCompany()`, `this.repo.getUser()`, `this.repo.getProducts()` | companies, users, products |
| `logistics.service.ts` | `this.repo.getOrders()`, `this.repo.getCompanies()` | orders, companies |
| `products.service.ts` | `this.repo.findAllOrders()`, `this.repo.findAllCompanies()`, `this.repo.findUser()` | orders, companies, users |

### 5.5 Side-Effects Inline (fora de afterCreate/hooks)

| Arquivo | Localização | Problema |
|---|---|---|
| `orders.service.ts:376,407` | Dentro de `create()` | Criação de `testOrder` inline na função principal em vez de hook separado |
| `billing.service.ts:207` | `processLegacyItems` | `db.select().from(products)` inline para evitar N+1, bypassando repo |

---

## ETAPA 6 — Controllers

### 6.1 Violações por Controller

#### `logistics.controller.ts` — 🔴 Múltiplas violações graves
| Violação | Localização | Evidência |
|---|---|---|
| SQL direto com Drizzle | `routeTracking` L550 | `db.execute(sql\`...\`)` para construir queries de rastreamento |
| Acesso a repo privado | `logAuth` L71, `requireLogisticsAdmin` L106, `deliveriesReport` L415, `routeTracking` L722 | `(this.service as any).repo` — cast forçado |
| Lógica de negócio | `routeTracking` L631-L799 | Cálculo de ETAs, filtragem por role, redação de dados |
| Handler completo sem service | `routeTracking` L550 | Fluxo completo sem chamada a service method |

#### `fiscal.controller.ts` — 🟠 Lógica de formatação no controller
| Violação | Localização | Evidência |
|---|---|---|
| Lógica de formatação CSV | `icmsSummaryExport` L85 | CSV building inline no controller |
| Lógica de formatação XLSX | `icmsSummaryExportXlsx` L127 | XLSX workbook generation inline |
| Orquestração multi-service | múltiplos | Importa e chama `nf.draft`, `icms-summary.service`, `fiscal-closure.service` diretamente |

#### `auth.controller.ts` — 🟡 Session management no controller
| Violação | Localização | Evidência |
|---|---|---|
| Session management | `login` L35 | Rotation de sessão, token version snapshot, session writes inline |
| `req.body` sem middleware | L94, L211, L252 | Parsing Zod inline em vez de middleware de validação |

#### `companies.controller.ts` — 🟡 Lógica de negócio menor
| Violação | Localização | Evidência |
|---|---|---|
| `crypto.randomBytes` | `create` L56 | Geração de senha temporária inline — responsabilidade do service |
| Sanitização de paginação | `list` L31 | Lógica de parâmetros inline |

#### `products.controller.ts` — 🟢 Violação menor
| Violação | Localização | Evidência |
|---|---|---|
| Validação de preço inline | `create` L53, `update` L71 | Numeric price validation fora de middleware/service |

### 6.2 Controllers Conformes
- `orders.controller.ts` — delega para service; sem acesso a repo
- `users.controller.ts` — delega para service; sem acesso a repo
- `finance.controller.ts` — delega para service; usa `apiResponse`
- `inventory.controller.ts` — thin adapter

---

## ETAPA 7 — Rotas

### 7.1 Handlers com Lógica Inline (bypassing controller)

Os seguintes arquivos contêm handlers que executam lógica de negócio, acesso a banco ou chamadas de service diretamente, sem passar por controller:

| Arquivo | Escopo do problema |
|---|---|
| `server/routes/routes.ts` | >90% dos handlers — db.execute, storage calls, service calls diretas, NF-e, AI-developer, Import/Export, inúmeros endpoints |
| `server/routes/saas.routes.ts` | Todos os handlers (bancos, contratos, faturas) com lógica inline |
| `server/routes/about-us.routes.ts` | `GET/PUT /api/about-us` — storage direto |
| `server/routes/admin-intelligence.routes.ts` | Todos os handlers — heavy logic + storage |
| `server/routes/fiscal-diagnostics.routes.ts` | `GET /api/admin/fiscal/diagnostics` — `db.execute(sql...)` direto |
| `server/routes/executive-dashboard.routes.ts` | `GET /api/admin/executive-dashboard/metrics` — Drizzle direto |
| `server/routes/assistant.routes.ts` | `GET /api/assistant/history`, `POST /api/assistant/chat` — db + logic inline |
| `server/routes/audit.routes.ts` | `GET /api/admin/audit` — storage inline |
| `server/routes/clara.routes.ts` | Training e chat endpoints — lógica inline |
| `server/modules/products/pricing.routes.ts` | L29, L44 — price adjustment logic inline |

### 7.2 Rotas sem Autenticação (potencial gap)

| Arquivo | Rota | Observação |
|---|---|---|
| `server/routes/client-contract-scope.routes.ts` | `GET /api/client/contract-scope`, `POST /api/client/scope-change-request` | Sem requireAuth |
| `server/routes/email.routes.ts` | Todas `/api/email/*` | Sem requireAuth |
| `server/routes/email-scheduler.ts` | Todas as rotas | Sem requireAuth |
| `server/routes/geocode.routes.ts` | `GET /api/geocode` | Sem requireAuth |
| `server/routes/password-reset-requests.routes.ts` | `GET/PUT /api/password-reset-requests/:id` | Sem requireAuth |

### 7.3 Rotas Administrativas sem `requireRole`

| Arquivo | Rota | Middleware presente | Faltante |
|---|---|---|---|
| `server/routes/saas.routes.ts` L110-180 | `POST/PATCH/DELETE /api/saas/modulos`, `/planos`, `/assinaturas` | `requireAuthCore` | `requireRole(['MASTER'])` |
| `server/routes/system-versions.routes.ts` L20-60 | `POST/PATCH/DELETE /api/system-versions` | `requireAuthCore` | `requireRole(['MASTER','ADMIN'])` |
| `server/routes/clara.routes.ts` | `POST/PUT/DELETE /api/clara-training` | `requireAuthCore` | `requireRole` |
| `server/routes/settings.routes.ts` L198 | `GET /api/admin/test-orders` | Nenhum | `requireAuth` + `requireRole` |
| `server/routes/routes.ts` L3117 | `GET/POST /api/admin/nfe/fiscal-defaults` | `requireAuthCore` | `requireRole` |
| `server/routes/routes.ts` L1700, 1718 | `GET/POST /api/admin/notifications/preferences` | `requireAuthCore` | `requireRole` |

### 7.4 Rotas com Comentários Bloqueados (código morto)

`server/routes/routes.ts` — bloco extenso de rotas comentadas (linhas 213, 691-702, 758 e outras), incluindo `/api/client-incidents`, `/api/health`, `/api/admin/backups`. Comentário TODO na linha 592 indica que o arquivo todo será removido "no futuro".

### 7.5 Shadowing entre `routes.ts` e módulos

Módulos montados via `registerModules` em `server/app.ts` ANTES de `routes.ts`. Rotas idênticas em ambos (ex.: `GET /api/orders`) ficam com o módulo ganhando precedência e `routes.ts` inacessível para essas rotas. Ambos coexistem — confusão de manutenção.

### 7.6 Cron Inline em Arquivo de Rotas

`server/routes/routes.ts:201` — `cron.schedule("0 3 * * *", ...)` para limpeza de logs, embutido diretamente no arquivo de rotas, sem guard de duplicação e com lógica inline usando `storage.cleanOldLogs`.

---

## ETAPA 8 — Jobs e Crons

### 8.1 Inventário Completo de Schedulers

| Job | Arquivo | Agendamento | Guard | `.unref()` | Acesso DB | Lógica extraída |
|---|---|---|---|---|---|---|
| Billing | `modules/billing/billing.cron.ts:106` | `0 2 * * *` | `cronStarted` + `startJobRun` | N/A (node-cron) | via `storage` | ✅ `checkBoletosVencidos()` |
| Faturamento NF-e | `jobs/faturamento.cron.ts:439` | `0 8 * * *` | `cronStarted` + `startJobRun` | N/A (node-cron) | **db direto** | ✅ `runFaturamentoCron()` |
| Recorrente | `jobs/recurring-orders.cron.ts:260` | toda segunda 06:00 | idempotência via `recurringOrderLogs` | N/A (node-cron) | **db direto** | ✅ `runRecurringOrdersCron()` |
| Backup | `server/backup.ts:605` | `0 17 * * *` | `backupScheduled` + `startJobRun` | N/A (node-cron) | **db direto** | ✅ `runBackup()` |
| Email Scheduler | `services/email-scheduler.ts:218` | `* * * * *` | `emailSchedulerStarted` + `startJobRun` | N/A (node-cron) | via `storage` | ✅ `runSchedulerTick()` |
| Outbox Worker | `modules/orders/orders.outbox.worker.ts:238` | `setInterval` 5s | `workerTimer` null check + `startJobRun` | ✅ | pool pg direto + ordersRepository | ✅ `processBatch()` |
| Auto-Dispatch | `modules/logistics/auto-dispatch.service.ts:359` | `setInterval` 10s | `workerTimer` null check + `startJobRun` | ✅ | **db.execute direto** | ✅ `autoDispatchReadyOrders()` |
| Monitor Operacional | `core/alerts/operational-alerts.service.ts:184` | `setInterval` 60s | `_monitorStarted` | ✅ | dynamic imports db/pool | ✅ closures |
| Auditoria Contínua | `core/security/continuousAudit.ts:199` | `setInterval` 15min | `started` + `running` | ✅ | db + eventRepository | ✅ `runContinuousAudit()` |
| Alertas Proativos | `services/alerts.proactive.ts:253` | `setInterval` 10min | `started` + `running` | ✅ | db + alerts.intelligence | ✅ `runProactiveAlerts()` |
| Limpeza RateLimit | `core/security/rateLimit.ts` | `setInterval` 5min | — | ✅ | maps em memória | inline |
| Limpeza UserRateLimit | `core/security/userRateLimit.ts` | `setInterval` 15min | `globalThis.__userRateLimitPruneStarted` | ✅ | maps em memória | inline |
| Limpeza AlertLogs | `services/alerts.service.ts` | `setInterval` 24h | `globalThis.__alertPruneStarted` | ✅ | via alerts.service | inline |
| **Limpeza de Logs** | **`routes/routes.ts:201`** | `0 3 * * *` | **Nenhum** | N/A | via `storage` | **❌ inline** |

### 8.2 Problemas em Jobs

| # | Arquivo | Problema |
|---|---|---|
| 1 | `jobs/faturamento.cron.ts` | Acesso `db` direto em vez de chamar service/repository |
| 2 | `jobs/recurring-orders.cron.ts` | Acesso `db` direto; o job chama `ordersService` para criação mas faz queries próprias em Drizzle |
| 3 | `routes/routes.ts:201` | Cron inline em arquivo de rota, sem guard contra duplicação, lógica inline |
| 4 | `modules/orders/orders.outbox.worker.ts` | Usa `pool` (pg direto) além de `ordersRepository` — dois níveis de acesso |

---

## ETAPA 9 — Segurança

### 9.1 Middleware de Autenticação — Três implementações paralelas

| Middleware | Arquivo | Uso |
|---|---|---|
| `requireAuth` | `server/core/http/requireAuth.ts` | Módulos modernos (orders, companies, users, finance…) |
| `requireAuthCore` | `server/core/auth/authCore.service.ts` | Rotas legadas em `routes.ts` e arquivos `*.routes.ts` soltos |
| `authenticate` | `server/shared/middlewares/authenticate.ts` | Referenciado em alguns middleware files |

**Problema:** Três implementações do mesmo conceito de "requer sessão autenticada". Inconsistência dificulta auditar cobertura real.

### 9.2 Rotas Administrativas sem `requireRole` — Severidade ALTA

| Arquivo | Rota | Risco |
|---|---|---|
| `saas.routes.ts:110-180` | `POST/PATCH/DELETE /api/saas/modulos`, `/planos`, `/assinaturas` | Qualquer usuário autenticado pode alterar planos SaaS |
| `system-versions.routes.ts:20-60` | `POST/PATCH/DELETE /api/system-versions` | Qualquer usuário autenticado pode aplicar updates de sistema |
| `clara.routes.ts` | `POST/PUT/DELETE /api/clara-training` | Qualquer usuário autenticado pode modificar training data da IA |
| `settings.routes.ts:198` | `GET /api/admin/test-orders` | Sem autenticação alguma |

### 9.3 Rotas sem Autenticação — Severidade ALTA

| Arquivo | Rotas | Avaliação |
|---|---|---|
| `client-contract-scope.routes.ts` | `GET /api/client/contract-scope`, `POST /api/client/scope-change-request` | Expõe dados de contrato de cliente sem auth |
| `email.routes.ts` | Todas `/api/email/*` | Permite disparar emails sem autenticação |
| `email-scheduler.ts` | Todas as rotas | Controle de agendamento sem auth |
| `geocode.routes.ts` | `GET /api/geocode` | Provável intencional (consulta pública) mas não confirmado |
| `password-reset-requests.routes.ts` | `GET/PUT /api/password-reset-requests/:id` | Possível gap — leitura/mutação sem auth |

### 9.4 Segredos e Credenciais

- Nenhum hardcode de secrets, tokens ou credenciais encontrado no código.
- `SESSION_SECRET` lido de `process.env` — correto.
- `SUPABASE_DATABASE_URL` via env — correto.
- `SEFAZ` certificados lidos de `companyCertificate.repository.ts` via DB — correto.

### 9.5 SQL Dinâmico / eval

- `eval()` — não encontrado.
- `new Function()` — não encontrado.
- SQL dinâmico fora de Drizzle `sql\`\`` — não encontrado.
- `db.execute(sql\`...\`)` usado em vários locais (logistics.controller, routes.ts, fiscal-diagnostics) é Drizzle tagged-template — aceitável mas deve estar em repositories.

### 9.6 CORS e Rate Limiting

- Rate limiting implementado em `server/core/http/rateLimit.ts` (global) e `server/core/security/userRateLimit.ts` (por usuário).
- CORS configurado em `server/app.ts`.
- Body size limits não auditados explicitamente — não foram encontradas configurações explícitas de `limit` no `express.json()`.

---

## ETAPA 10 — Matriz de Dívida Técnica

### 🔴 CRÍTICO

| # | Arquivo | Linha | Problema | Evidência | Impacto | Como Corrigir | Complexidade | Estimativa |
|---|---|---|---|---|---|---|---|---|
| TD-001 | `server/routes/routes.ts` | 1–4000+ | God file legado: handlers com db direto, sem controllers, lógica de negócio inline, ~100+ endpoints | `db.execute(sql...)`, `storage.*` em handlers inline | Qualquer bug neste arquivo afeta metade do sistema; impossível testar unitariamente | Migrar cada grupo de rotas para controller+service+routes modular; remover `routes.ts` progressivamente | 🔴 Alta | 3–5 sprints |
| TD-002 | `server/services/storage.ts` | 1–3030 | God class: 3030 linhas, acessa todos os domínios, importa repositories externos, acesso direto a db | `db.select()` em centenas de locais; importa `usersRepository`, `companiesRepository` | Depreciação travada pela dependência de ~100 callers em routes.ts; circular com repos | Continuar migração wave-by-wave para repositories de domínio; cada módulo migrado diminui storage | 🔴 Alta | 2–4 sprints |
| TD-003 | `server/routes/saas.routes.ts` | 110–180 | Mutações administrativas (planos, assinaturas) sem `requireRole` | `requireAuthCore` sem `requireRole(['MASTER'])` | Qualquer usuário autenticado pode modificar planos e assinaturas do SaaS | Adicionar `requireRole(['MASTER'])` nas rotas POST/PATCH/DELETE | 🟢 Baixa | 30 min |
| TD-004 | `server/routes/client-contract-scope.routes.ts` | — | Rotas de cliente sem nenhuma autenticação | Ausência de `requireAuth` ou `requireAuthCore` | Dados de contrato de cliente acessíveis publicamente | Adicionar `requireAuth` nas rotas | 🟢 Baixa | 15 min |
| TD-005 | `server/modules/logistics/logistics.controller.ts` | 550, 71, 106, 415 | Controller com SQL direto, acesso a repo via cast, lógica de negócio completa | `db.execute(sql\`...\`)`, `(this.service as any).repo`, cálculo de ETA inline | Impossível testar; falhas de SQL vão para o handler sem tratamento | Mover `routeTracking` para `logistics.service.ts`; expor repo methods necessários como métodos de service | 🟠 Média | 1–2 dias |

### 🟠 ALTO

| # | Arquivo | Linha | Problema | Evidência | Impacto | Como Corrigir | Complexidade | Estimativa |
|---|---|---|---|---|---|---|---|---|
| TD-006 | `server/routes/system-versions.routes.ts` | 20–60 | Mutações de sistema sem `requireRole` | `requireAuthCore` sem `requireRole` | Qualquer usuário autenticado pode aplicar updates de sistema | Adicionar `requireRole(['MASTER'])` | 🟢 Baixa | 15 min |
| TD-007 | `server/routes/clara.routes.ts` | — | Training mutations sem `requireRole` | `requireAuthCore` sem `requireRole` | Dados de treinamento da IA podem ser modificados por qualquer usuário autenticado | Adicionar `requireRole(['MASTER','ADMIN'])` | 🟢 Baixa | 15 min |
| TD-008 | `server/routes/email.routes.ts` | — | Rotas de email sem autenticação | Ausência de `requireAuth` | Possível abuso para disparar emails do sistema | Adicionar `requireAuth` + `requireRole` | 🟢 Baixa | 15 min |
| TD-009 | `server/jobs/faturamento.cron.ts` | 439 | Cron com acesso `db` direto, bypassa service layer | `db` Drizzle direto nas queries de elegibilidade | Queries fiscais fora do rastreamento do repo; impossível mock em testes | Mover queries para `nfe` repository ou service | 🟠 Média | 1 dia |
| TD-010 | `server/jobs/recurring-orders.cron.ts` | 260 | Acesso `db` direto para queries próprias | Queries Drizzle inline além do `ordersService.createInternal()` | Idem — queries fora do domínio | Mover queries para `orders.repository.ts` | 🟠 Média | 4 horas |
| TD-011 | `server/modules/finance/finance.repository.ts` | 41, 513 | Sem interface; cross-domain (orders, nfe); log inline | Ausência de `IFinanceRepository`; imports de tabelas externas; objeto de log inline | Impossível mockar; acoplamento implícito | Criar interface; mover cross-domain queries para views/procedures ou aceitar via parâmetro | 🟠 Média | 1 dia |
| TD-012 | `server/modules/orders/orders.repository.ts` | 23 | Sem interface; cross-domain (accountsReceivable) | Ausência de `IOrdersRepository`; import de tabela de finance | Impossível mockar; acoplamento implícito | Criar interface; remover ou isolar acesso a accountsReceivable | 🟠 Média | 4 horas |
| TD-013 | `server/modules/logistics/auto-dispatch.service.ts` | 359 | Service com `db.execute(...)` direto | Drizzle inline em service | Queries de dispatch fora do logistics.repository | Mover queries para `logistics.repository.ts` | 🟡 Baixa | 4 horas |
| TD-014 | `server/modules/billing/billing.service.ts` | 207 | `db.select().from(products)` direto em service | Bypassa products.repository para evitar N+1 | Acoplamento com schema de produtos; não testável | Criar método `products.repository.getBulkByIds()` e injetar | 🟡 Baixa | 2 horas |
| TD-015 | `server/modules/banking/itau/retorno.service.ts` | — | Service importa `financeRepository` de outro domínio | `import { financeRepository } from '../../finance/finance.repository'` | Acoplamento direto entre módulos sem passar por service | Receber financeRepository via injeção de dependência ou expor interface | 🟡 Baixa | 2 horas |

### 🟡 MÉDIO

| # | Arquivo | Linha | Problema | Evidência | Impacto | Como Corrigir | Complexidade | Estimativa |
|---|---|---|---|---|---|---|---|---|
| TD-016 | `server/modules/orders/orders.service.ts` | 421, 1402, 1519 | `userRole: "CLIENT"` hardcoded em 3 locais remanescentes | String literal sem constante ou enum | Audit log incorreto para pedidos não-cliente | Substituir por constante `OrderActorRole` ou usar actorRole do contexto | 🟢 Baixa | 1 hora |
| TD-017 | `server/modules/orders/orders.service.ts` | 959, 1281, 1392, 1419, 1441, 1540 | `assertPeriodOpen` chamado 6× separadamente | Guard duplicado em cada mutação | Risco de esquecer o guard em nova mutação | Decorator ou hook de pré-execução para operações de escrita | 🟡 Média | 4 horas |
| TD-018 | `server/modules/orders/orders.service.ts` | 1034, 1727 | Métodos `transition` e `substituteItem` >200 linhas | ~232 e ~241 linhas resp. | Difícil de ler, testar e manter | Extrair sub-métodos privados por responsabilidade | 🟡 Média | 1 dia |
| TD-019 | `server/modules/auth/auth.controller.ts` | 35, 94, 211, 252 | Session management e Zod inline no controller | `req.session.*` mutations; Zod parse inline | Lógica de sessão deveria estar em authService | Mover session rotation para `authService.login()`; usar validation middleware | 🟠 Média | 4 horas |
| TD-020 | `server/modules/fiscal/fiscal.controller.ts` | 85, 127 | CSV e XLSX building inline no controller | `csv-writer`, `xlsx` inline | Formato acoplado ao controller; não reutilizável | Mover para um `fiscal.formatter.ts` ou para o service | 🟡 Baixa | 3 horas |
| TD-021 | `server/modules/companies/companies.controller.ts` | 56 | `crypto.randomBytes` inline | Geração de senha temporária no controller | Responsabilidade do service; dificulta teste | Mover para `companiesService.generateTempPassword()` | 🟢 Baixa | 30 min |
| TD-022 | `server/modules/products/products.repository.ts` | 40, 128 | Cross-domain `orders` + `SystemLogEntry` inline | Import de tabela `orders`; tipo de log local | Acoplamento implícito; inconsistência de log | Remover cross-domain query; adotar LogEntry compartilhado | 🟡 Baixa | 2 horas |
| TD-023 | `server/modules/users/users.repository.ts` | 22 | Importa `invalidateUsageCache` de billing | Side-effect em repository | Repository não deveria ter side-effects de billing | Mover invalidação para camada de service | 🟡 Média | 2 horas |
| TD-024 | `server/routes/routes.ts` | 201 | Cron de limpeza de logs inline em arquivo de rotas | `cron.schedule("0 3 * * *", ...)` sem guard | Pode duplicar em hot-reload; lógica inline | Mover para `server/jobs/log-cleanup.cron.ts` | 🟢 Baixa | 1 hora |
| TD-025 | `server/modules/nfe/nfe-persist.transaction.ts` | — | Importa `invalidateUsageCache` de billing | Cross-module side-effect em transaction | Transaction fiscal não deveria conhecer billing | Propagar via evento ou callback | 🟡 Média | 2 horas |
| TD-026 | `server/routes/about-us.routes.ts`, `admin-intelligence.routes.ts`, `fiscal-diagnostics.routes.ts`, `executive-dashboard.routes.ts`, `audit.routes.ts` | — | Lógica de negócio e db direto em route files | `db.*`, `storage.*` inline sem controller | Impossível testar; manutenção arriscada | Criar controllers dedicados | 🟠 Alta | 2–3 dias |
| TD-027 | middleware triplicado | — | 3 implementações de "requer auth" | `requireAuth`, `requireAuthCore`, `authenticate` | Cobertura difícil de auditar; comportamentos podem divergir | Unificar em `requireAuth` de `server/core/http/requireAuth.ts` | 🟠 Média | 1 dia |
| TD-028 | ENTREGA — 3 caminhos | `orders.service.ts`, `logistics.routes.ts` | Delivery pode ser criado por 3 caminhos distintos | afterCreate, createWithDelivery, POST /api/logistics/deliveries | Risco de entregas inconsistentes (sem relação com pedido) | Centralizar criação de delivery no pipeline de orders; rota de logistics cria delivery apenas com orderId válido | 🟠 Média | 1 dia |

### 🟢 BAIXO

| # | Arquivo | Linha | Problema | Evidência | Impacto | Como Corrigir | Complexidade | Estimativa |
|---|---|---|---|---|---|---|---|---|
| TD-029 | `server/modules/billing/billing.resolver.ts` | — | `resolveCompanyBillingConfig` exportado sem import encontrado | Grep sem resultado em server/ | Dead code — risco de manutenção desnecessária | Confirmar e remover | 🟢 Baixa | 30 min |
| TD-030 | Repositories (8 de 9) | — | Ausência de `expectOne()` helper | `rows[0]` sem tratamento padronizado | "Not found" tratado de forma inconsistente | Adotar `expectOne()` como padrão | 🟢 Baixa | 4 horas |
| TD-031 | Repositories (6 de 9) | — | Ausência de interface `IXxxRepository` | Sem arquivo `interfaces/IXxxRepository.ts` | Impossível mockar em testes | Criar interfaces; referência: `ICompaniesRepository` | 🟡 Média | 1 dia |
| TD-032 | `server/services/aiDeveloper/labFunctions.ts` | 384, 395, 406, 417 | 4 funções com `// TODO: Implement` | Stubs não implementados | Feature gap documentado; pode causar silent no-ops | Implementar ou remover stubs | 🟡 Média | desconhecida |
| TD-033 | `server/modules/users/users.admin.routes.ts` | — | `usersAdminRouter` com uso não confirmado | Export sem import confirmado | Dead code potencial | Confirmar uso ou remover | 🟢 Baixa | 30 min |
| TD-034 | `server/modules/products/products.controller.ts` | 53, 71 | Validação de preço inline | Numeric check no controller | Duplicação se outros paths criarem produto | Mover para `products.validation.ts` | 🟢 Baixa | 1 hora |
| TD-035 | `server/modules/ai/` | — | Módulo declarado com apenas `README.md` | Pasta vazia de código | Clara vive em `server/services/aiDeveloper.ts`; módulo incompleto | Mover aiDeveloper para o módulo, ou remover a pasta | 🟢 Baixa | 30 min |

---

## Resumo Executivo

### Contagem de Inconsistências

| Severidade | Quantidade |
|---|:---:|
| 🔴 Crítico | 5 |
| 🟠 Alto | 11 |
| 🟡 Médio | 13 |
| 🟢 Baixo | 7 |
| **Total** | **36** |

### Top 5 Riscos Imediatos

1. **TD-003/006/007/008** — Rotas admin/SaaS/Clara sem `requireRole`, email sem auth → correctable em <2h, impacto de segurança alto
2. **TD-004** — `/api/client/contract-scope` sem autenticação → dados de contrato expostos
3. **TD-001** — `routes.ts` como god file → bloqueia qualquer melhoria de arquitetura
4. **TD-002** — `storage.ts` como god class → circular com repos, impossível testar
5. **TD-028** — 3 caminhos de criação de entrega → potencial para registros inconsistentes

### Módulos Conformes (sem dívida técnica significativa)

- `server/modules/companies/` — repository, service e controller dentro dos padrões
- `server/modules/orders/orders.service.ts` — após R1, pipeline unificado
- `server/core/jobs/job-registry.ts` — concurrency control bem implementado
- Jobs com `setImmediate` e `.unref()` — outbox worker, auto-dispatch, monitor operacional, auditoria contínua

---

*Documento gerado por auditoria automatizada. Evidências extraídas do código-fonte em 2026-07-22. Nenhum arquivo foi alterado.*
