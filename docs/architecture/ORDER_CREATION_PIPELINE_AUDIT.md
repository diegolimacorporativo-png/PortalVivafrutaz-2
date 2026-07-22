# ORDER CREATION PIPELINE — AUDITORIA ARQUITETURAL

**Documento:** Especificação Oficial do Domínio Orders  
**Data:** 2026-07-21  
**Status:** Aprovado para uso como referência antes de qualquer nova funcionalidade  
**Escopo:** Auditoria completa de todos os pontos de criação de pedido no Portal VivaFrutaz ERP

---

## Sumário

1. [Todos os pontos de criação de pedido](#1-todos-os-pontos-de-criação-de-pedido)
2. [Criações que bypassam o OrdersService](#2-criações-que-bypassam-o-ordersservice)
3. [Ciclo de vida completo de um pedido](#3-ciclo-de-vida-completo-de-um-pedido)
4. [Tudo que acontece após a criação](#4-tudo-que-acontece-após-a-criação)
5. [Código duplicado identificado](#5-código-duplicado-identificado)
6. [Responsabilidades espalhadas](#6-responsabilidades-espalhadas)
7. [Order Creation Pipeline — Fluxo Oficial Proposto](#7-order-creation-pipeline--fluxo-oficial-proposto)
8. [Refatorações necessárias antes do Pedido Recorrente](#8-refatorações-necessárias-antes-do-pedido-recorrente)

---

## 1. Todos os pontos de criação de pedido

### 1.1 `OrdersService.create()` — Caminho principal

**Arquivo:** `server/modules/orders/orders.service.ts:349`  
**Método:** `async create(body: { order: any; items: any[] }, actor: ActorContext)`  
**Acionado por:** `POST /api/orders` (v1 e v2) via `OrdersController`  
**Guards aplicados:**
- Maintenance mode (sistema em manutenção)
- Per-user test mode (role `SISTEMA_TESTE` ou flag `testMode`)
- Global test mode (flag `test_mode` no banco)
- Duplicate submission window (60 segundos por `companyId:deliveryDate:orderWindowId`)
- Date-lock guard (um pedido não-cancelado por data de entrega por empresa)
- Normalização de `totalPrice` por item e `totalValue` do pedido

**Status persistido:** `CONFIRMED`  
**workflowStatus:** não definido explicitamente (usa default do schema: `CREATED`)  
**Fluxo pós-criação:** chama `afterCreate()` via `setImmediate`

---

### 1.2 `OrdersService.createWithDelivery()` — Criação com entrega

**Arquivo:** `server/modules/orders/orders.service.ts:616`  
**Método:** `async createWithDelivery(body: any, actor: ActorContext)`  
**Acionado por:** `POST /api/orders/create-with-delivery` (v1 e v2)  
**Guards aplicados:**
- Requer `actor.userId` (operação administrativa)
- Requer `companyId` presente
- Aplica novo motor de precificação com log de divergência
- Força status: `ACTIVE`, `nota_pendente`, `nao_exportado`

**Observação:** Este método cria o pedido E a entrega em sequência. Usa `this.repo.create()` internamente.

---

### 1.3 `orders.repository.create()` — Camada de repositório

**Arquivo:** `server/modules/orders/orders.repository.ts:121`  
**Método:** `async create(order: InsertOrder, items: InsertOrderItem[]): Promise<Order>`  
**Responsabilidade:** Proxy para `storage.createOrder()` com enforcement de tenant.

```typescript
// O repositório injeta o tenantId obrigatório — nunca confia no body da request
const tenantId = requireTenantId();
const safeOrder = { ...order, companyId: tenantId } as InsertOrder;
const safeItems = items.map((it) => ({ ...it, empresaId: tenantId }));
return storage.createOrder(safeOrder, safeItems as any);
```

**Papel arquitetural:** É a única camada que garante isolamento multi-tenant na persistência. Toda criação de pedido deveria passar por aqui.

---

### 1.4 `storage.createOrder()` — Persistência core

**Arquivo:** `server/services/storage.ts:1080`  
**Método:** `async createOrder(order: InsertOrder, items: InsertOrderItem[]): Promise<Order>`  
**Responsabilidade:** Transação atômica de persistência. Não contém lógica de negócio.

```
1. INSERT orders → obtém ID
2. Gera orderCode: VF-{YEAR}-{ID com padding 6 dígitos}
3. UPDATE orders SET orderCode
4. INSERT orderItems (se items.length > 0)
5. .then: invalidateUsageCache(companyId)
```

**Nota:** Este é o único lugar onde o `orderCode` é gerado de forma padronizada. Todos os caminhos que chamam `storage.createOrder()` obtêm o código automaticamente. Caminhos que bypassam este método precisam gerar o código por conta própria — e erram.

---

### 1.5 `routes.ts` POST `/api/orders` — Rota legada duplicada

**Arquivo:** `server/routes/routes.ts:592`  
**Método:** handler inline (não é um serviço)  
**Acionado por:** `POST /api/orders` — mesma rota do `OrdersController`

> ⚠️ **Esta rota coexiste com `OrdersController` no mesmo path.** O comportamento de qual handler vence depende da ordem de montagem dos routers no `server/index.ts`.

**Guards implementados (duplicados de `OrdersService.create()`):**
- Maintenance mode (linha 598)
- Test mode (linha 604 — cria em `test_orders`)
- Duplicate submission window 60s (linha 645)
- Date-lock guard (linha 654)

**Persistência:** `storage.createOrder({ ...order, status: 'CONFIRMED' }, items)` (linha 670)  
**afterCreate:** **NÃO é chamado.** A resposta é `res.status(201).json(newOrder)` direto.

**Impacto do bypass de `afterCreate`:**
- Nenhum audit log de `ORDER_CREATED`
- Nenhum push notification para o cliente
- Nenhum e-mail ao cliente (`sendOrderPlaced`)
- Nenhum e-mail aos admins (`sendAdminNewOrder`)
- **Nenhuma entrega logística criada** (linha `deliveries` ausente)

---

### 1.6 `CompaniesService.generateOrdersFromScope()` — Geração automática por contrato

**Arquivo:** `server/modules/companies/companies.service.ts:310`  
**Método:** `async generateOrdersFromScope(companyId: number)`  
**Acionado por:** `POST /api/companies/:id/generate-orders`

**Comportamento:** Lê escopos contratuais da empresa, calcula datas de entrega da semana, e cria um pedido por dia com itens derivados dos escopos.  
**Persistência:** `storage.createOrder(...)` diretamente (linha 383) — bypassa `OrdersService` e `orders.repository`.

**Status persistido:** `ACTIVE` + `nota_pendente` + `nao_exportado`  
**Não aplica:** maintenance mode, date-lock, duplicate window  
**afterCreate:** **NÃO é chamado.**  
**Tenant guard:** **NÃO é aplicado** (`requireTenantId()` não é chamado).

---

### 1.7 `recurring-orders.cron.ts` — Cron semanal

**Arquivo:** `server/jobs/recurring-orders.cron.ts:204`  
**Método:** `runRecurringOrdersCron()` (loop interno)  
**Acionado por:** `node-cron` toda segunda-feira às 06:00 UTC (⚠️ deveria ser 09:00 UTC para BRT 06:00)

**Persistência:** `tx.insert(orders)` diretamente (linha 204) — bypassa `storage`, `orders.repository`, e `OrdersService`.

**Gera `orderCode` inline:**
```typescript
const orderCode = `VF-${year}-${String(newOrder.id).padStart(6, "0")}`;
await tx.update(orders).set({ orderCode }).where(eq(orders.id, newOrder.id));
```
Duplica exatamente a lógica de `storage.createOrder()`.

**Não aplica:** maintenance mode, date-lock, duplicate window (usa idempotência própria via `recurringOrderLogs`)  
**afterCreate:** **NÃO é chamado.** Ausência de:
- Audit log
- Push notification
- E-mail ao cliente
- **Linha de entrega logística** (crítico — operador vai ao painel de logística e não encontra o pedido)

---

### 1.8 Scripts de teste — Acesso direto ao banco

**Arquivos:**
- `scripts/test-billing-equivalence.ts:285` — função local `createOrder()` com `db.insert(orders)`
- `scripts/test-fase5-full-validation.ts:257` — idem
- `scripts/test-fiscal-step2.ts:162` — idem

**Uso:** Setup de dados para testes de integração.  
**Risco:** Baixo para produção (scripts não rodam no servidor), mas podem inserir pedidos em ambiente de desenvolvimento sem aplicar nenhuma regra de negócio, causando estado inconsistente nos testes.

---

### 1.9 Clara IA / Portal do Cliente

Após busca em `server/services/aiDeveloper.ts`, `server/services/memoryModule.ts`, e todos os módulos de IA, **não foi encontrado nenhum ponto de criação de pedido via Clara IA ou Portal do Cliente** no código atual. Estes são vetores de criação futuros ainda não implementados.

---

## 2. Criações que bypassam o OrdersService

### Mapa de bypass

| Arquivo | Método | Bypassa | Motivo provável | Risco | Impacto |
|---|---|---|---|---|---|
| `server/routes/routes.ts:592` | handler inline | `OrdersService.create()` | Rota legada anterior ao módulo Orders | 🔴 Alto | afterCreate não executa: sem entrega, sem notificação, sem audit |
| `server/modules/companies/companies.service.ts:383` | `generateOrdersFromScope()` | `OrdersService` + `repository` | Implementado fora do módulo Orders | 🔴 Alto | Sem tenant guard, sem afterCreate, status inconsistente (`ACTIVE` vs `CONFIRMED`) |
| `server/jobs/recurring-orders.cron.ts:204` | `runRecurringOrdersCron()` | `OrdersService` + `storage` + `repository` | Implementado isoladamente | 🔴 Alto | Sem entrega logística, sem notificação, `orderCode` duplicado, status inconsistente |
| `scripts/test-billing-equivalence.ts:285` | `createOrder()` local | Tudo | Script de teste | 🟡 Baixo | Apenas em dev/test |
| `scripts/test-fase5-full-validation.ts:257` | `createOrder()` local | Tudo | Script de teste | 🟡 Baixo | Apenas em dev/test |
| `scripts/test-fiscal-step2.ts:162` | `createOrder()` local | Tudo | Script de teste | 🟡 Baixo | Apenas em dev/test |

### Análise detalhada dos bypasses críticos

#### Bypass 1 — `routes.ts:592` (Legada)

```
routes.ts handler
  └── storage.createOrder()        ← persistence OK (orderCode gerado)
  └── res.status(201).json()       ← responde imediatamente
  ✗ afterCreate() nunca chamado
  ✗ deliveries row nunca criado
  ✗ audit log nunca escrito
  ✗ push/email nunca enviados
```

#### Bypass 2 — `companies.service.ts:383` (generateOrdersFromScope)

```
CompaniesService.generateOrdersFromScope()
  └── storage.createOrder()        ← persistence OK
  ✗ requireTenantId() nunca chamado
  ✗ afterCreate() nunca chamado
  ✗ status "ACTIVE" ≠ "CONFIRMED" (OrdersService padrão)
  ✗ workflowStatus não definido (usa default "CREATED")
```

#### Bypass 3 — `recurring-orders.cron.ts:204` (Cron)

```
runRecurringOrdersCron()
  └── tx.insert(orders)            ← persistence RAW (bypassa storage)
  └── tx.update(orders).set({orderCode})  ← orderCode duplicado inline
  └── tx.insert(orderItems)
  └── tx.insert(recurringOrderLogs)
  ✗ storage.createOrder() nunca chamado
  ✗ orders.repository.create() nunca chamado
  ✗ requireTenantId() nunca chamado
  ✗ afterCreate() nunca chamado
  ✗ deliveries row nunca criado  ← BUG OPERACIONAL CONFIRMADO
  ✗ status "ACTIVE" ≠ "CONFIRMED"
```

---

## 3. Ciclo de vida completo de um pedido

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ENTRADA                                             │
│                                                                             │
│  HTTP POST /api/orders          → OrdersController.create()                │
│  HTTP POST /api/orders/c-w-d    → OrdersController.createWithDelivery()    │
│  [futuro] Portal do Cliente     → a definir                                 │
│  [futuro] Clara IA              → a definir                                 │
│  [futuro] Cron Recorrente       → RecurringOrderScheduler (proposto)        │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                         VALIDAÇÃO                                           │
│                                                                             │
│  Nível de rota:                                                             │
│    • requireActiveSubscription  (assinatura ativa)                         │
│    • checkPlanLimit("pedidos")  (limite do plano)                          │
│    • Zod schema validation      (createOrderBodySchema)                    │
│                                                                             │
│  Nível de serviço (OrdersService.create):                                  │
│    • Maintenance mode guard     (setting "maintenance_mode")               │
│    • Test mode interception     (role/flag → desvia para test_orders)      │
│    • Duplicate window (60s)     (chave companyId:deliveryDate:windowId)    │
│    • Date-lock guard            (1 pedido ativo/data/empresa)              │
│    • Item price normalization   (totalPrice = unitPrice × qty se ausente)  │
│    • Total value normalization  (soma dos itens se totalValue ausente)     │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PERSISTÊNCIA                                        │
│                                                                             │
│  orders.repository.create()                                                 │
│    └── requireTenantId()        (injeta companyId do contexto ALS)         │
│    └── storage.createOrder()                                                │
│          └── db.transaction()                                               │
│                ├── INSERT orders       → obtém ID                          │
│                ├── orderCode = VF-{YEAR}-{ID:6d}                           │
│                ├── UPDATE orders SET orderCode                              │
│                └── INSERT orderItems (N linhas)                            │
│          └── .then: invalidateUsageCache(companyId)                        │
│                                                                             │
│  Estado inicial: status="CONFIRMED", workflowStatus="CREATED"              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                         EVENTOS PÓS-CRIAÇÃO (afterCreate)                  │
│                         [via setImmediate — não bloqueia resposta HTTP]    │
│                                                                             │
│  1. Audit log → INSERT system_logs (action: ORDER_CREATED)                 │
│  2. Push notification → fireNotification(order_created)                    │
│  3. E-mail cliente → sendOrderPlaced(company, order, items)                │
│  4. E-mail admins → sendAdminNewOrder(admins, order)                       │
│  5. Auto-logistics → INSERT deliveries (status: pendente)                  │
│     └── endereço extraído do perfil da empresa                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                         RESPOSTA HTTP                                       │
│                                                                             │
│  201 Created → { order }                                                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                         WORKFLOW (transições de estado)                    │
│                                                                             │
│  Estado: CREATED                                                            │
│    ↓ (Comercial/Admin)                                                      │
│  PENDING_APPROVAL                                                           │
│    ↓ (Admin/Director/Financeiro/Operations)                                 │
│  APPROVED                                                                   │
│    Side effects (executeWorkflowTransaction):                               │
│      • Gera preNotaNumber (VF-NF-{orderId:6d})                             │
│      • SELECT ... FOR UPDATE em inventory_settings por item                 │
│      • Valida currentStock >= qty (BadRequestError se insuficiente)        │
│      • UPDATE inventory_settings current_stock -= qty                       │
│      • INSERT inventory_movements (EXIT, referenceType: order)             │
│      • Ordena items por productId ASC (previne deadlock)                   │
│      • INSERT workflow_events (outbox)                                      │
│    ↓ (Financeiro/Admin)                                                     │
│  INVOICED                                                                   │
│    Side effects:                                                            │
│      • INSERT accounts_receivable (vencimento +30 dias)                    │
│      • Gera PIX payload (buildPixPayload)                                  │
│      • INSERT workflow_events (outbox)                                      │
│    ↓ (Logistics/Admin)                                                      │
│  SHIPPED                                                                    │
│    Side effects:                                                            │
│      • UPDATE deliveries SET status='em_rota' WHERE status='pendente'      │
│      • Financial gap guard (logSecurity se AR ausente — não bloqueia)      │
│      • INSERT workflow_events (outbox)                                      │
│    ↓ (Logistics/Admin)                                                      │
│  DELIVERED                                                                  │
│    Side effects:                                                            │
│      • UPDATE deliveries SET status='entregue', delivered_at=NOW()         │
│      • INSERT system_logs (DELIVERY_COMPLETED)                             │
│      • INSERT workflow_events (outbox)                                      │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                  TRANSACTIONAL OUTBOX WORKER                                │
│                  (orders.outbox.worker.ts — polling a cada 5s)             │
│                                                                             │
│  Para cada workflow_event não processado:                                   │
│    • Push notification → fireNotification(order_updated / order_cancelled) │
│    • Audit log → INSERT system_logs (WORKFLOW_TRANSITION)                  │
│    • Retry com exponential backoff                                          │
│    • Dead Letter Queue após 5 falhas (flag dead_letter = true)             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Máquina de estados — diagrama de transições

```
CREATED → PENDING_APPROVAL → APPROVED → PROCESSING → READY → INVOICED → SHIPPED → DELIVERED
   ↓              ↓              ↓           ↓          ↓        ↓           ↓
CANCELLED      REJECTED       CANCELLED  CANCELLED  CANCELLED CANCELLED  (terminal)
(terminal)    (terminal)     (terminal)
```

### Mapeamento workflowStatus → status (legado)

| workflowStatus | status (legado) |
|---|---|
| CREATED | ACTIVE |
| PENDING_APPROVAL | ACTIVE |
| APPROVED | CONFIRMED |
| PROCESSING | CONFIRMED |
| READY | CONFIRMED |
| INVOICED | CONFIRMED |
| SHIPPED | CONFIRMED |
| DELIVERED | DELIVERED |
| REJECTED | CANCELLED |
| CANCELLED | CANCELLED |

---

## 4. Tudo que acontece após a criação

### 4.1 Efeitos imediatos (setImmediate — assíncrono, não bloqueia HTTP)

| Efeito | Arquivo | Detalhe |
|---|---|---|
| Audit log | `orders.service.ts:afterCreate` | `INSERT system_logs` com action `ORDER_CREATED` |
| Push notification | `orders.service.ts:afterCreate` | `fireNotification(order_created)` com companyName, itemCount, totalValue, orderCode |
| E-mail cliente | `orders.service.ts:afterCreate` | `sendOrderPlaced(company, order, items)` |
| E-mail admins | `orders.service.ts:afterCreate` | `sendAdminNewOrder(admins, order)` — para cada usuário ADMIN |
| Entrega logística | `orders.service.ts:afterCreate` | `INSERT deliveries` com status `pendente`, endereço da empresa |

### 4.2 Efeitos por transição de estado (executeWorkflowTransaction)

| Transição | Efeito | Arquivo |
|---|---|---|
| → APPROVED | Geração de preNotaNumber | `orders.transaction.ts:219` |
| → APPROVED | Dedução de estoque (SELECT FOR UPDATE + UPDATE) | `orders.transaction.ts:235–358` |
| → APPROVED | INSERT inventory_movements (EXIT) | `orders.transaction.ts:343` |
| → INVOICED | INSERT accounts_receivable | `orders.transaction.ts:391` |
| → INVOICED | Geração de PIX payload | `orders.transaction.ts:382` |
| → SHIPPED | UPDATE deliveries → em_rota | `orders.transaction.ts:454` |
| → SHIPPED | Financial gap guard (logSecurity) | `orders.transaction.ts:432` |
| → DELIVERED | UPDATE deliveries → entregue | `orders.transaction.ts:479` |
| → DELIVERED | INSERT system_logs (DELIVERY_COMPLETED) | `orders.transaction.ts:494` |
| Toda transição | INSERT workflow_events (outbox) | `orders.transaction.ts:537` |

### 4.3 Efeitos do Outbox Worker (assíncrono, polling 5s)

| Evento | Efeito | Arquivo |
|---|---|---|
| TRANSITION | Push notification (order_updated / order_cancelled) | `orders.outbox.worker.ts` |
| TRANSITION | INSERT system_logs (WORKFLOW_TRANSITION) | `orders.outbox.worker.ts` |
| Falha | Exponential backoff (até 5 tentativas) | `orders.outbox.worker.ts:15` |
| 5 falhas | Dead Letter Queue (dead_letter = true) | `orders.outbox.worker.ts:20` |

### 4.4 Concorrência e integridade transacional

O `executeWorkflowTransaction` implementa três camadas de proteção:

1. **`pg_try_advisory_xact_lock(orderId)`** — lock distribuído, funciona em múltiplos processos Node.js sem Redis ou infraestrutura extra. Falha rápida (não faz fila), retorna 409 imediatamente.
2. **Optimistic lock** — re-lê `workflow_status` após o lock. Se mudou desde a leitura pré-transação, outra requisição já commitou — retorna 409.
3. **`SELECT … FOR UPDATE` em inventory_settings** — ordena por `productId ASC` antes de lockear (previne deadlock quando dois pedidos têm os mesmos produtos).

---

## 5. Código duplicado identificado

### 5.1 Geração do `orderCode`

Lógica implementada em **dois lugares distintos**:

| Local | Implementação | Diferença |
|---|---|---|
| `storage.ts:1090` | `VF-${year}-${String(id).padStart(6, '0')}` | Canônico |
| `recurring-orders.cron.ts:220` | `VF-${year}-${String(newOrder.id).padStart(6, "0")}` | Idêntico mas duplicado |

**Risco:** Qualquer mudança no padrão de `orderCode` (ex: adicionar UF, ou mudar de 6 para 8 dígitos) precisa ser atualizada em dois lugares. A versão do cron pode divergir silenciosamente.

---

### 5.2 Guards de criação (maintenance mode, test mode, date-lock, duplicate window)

Lógica implementada em **dois lugares**:

| Guard | `OrdersService.create()` | `routes.ts:592` |
|---|---|---|
| Maintenance mode | ✓ linha 356 | ✓ linha 598 |
| Test mode (per-user) | ✓ linha 366 | ✓ linha 604 |
| Test mode (global) | ✓ linha 393 | ✓ linha 604 |
| Duplicate window 60s | ✓ linha 438 | ✓ linha 645 |
| Date-lock | ✓ linha 447 | ✓ linha 654 |

**Risco:** Qualquer ajuste em um guard (ex: aumentar o duplicate window de 60s para 120s, ou mudar a regra de date-lock) precisa ser feito em dois arquivos. Já divergiram em comportamento: `routes.ts` não chama `afterCreate`.

---

### 5.3 Cálculo de `totalValue`

Lógica de normalização implementada em três lugares:

| Local | Implementação |
|---|---|
| `OrdersService.create():475` | `normalisedItems.reduce(sum + Number(totalPrice), 0)` |
| `recurring-orders.cron.ts:196` | `scopes.reduce(sum + price * qty, 0)` |
| `companies.service.ts:388` | `Math.round(totalValue * 100) / 100` |

**Risco:** As três implementações usam precisão numérica diferente. O cron usa `parseFloat` sem arredondamento explícito. `companies.service` usa `Math.round * 100 / 100`. `OrdersService` usa `.toFixed(2)`. Podem produzir valores diferentes para o mesmo conjunto de itens.

---

### 5.4 Status inicial do pedido — inconsistência entre origens

| Origem | `status` (legado) | `workflowStatus` |
|---|---|---|
| `OrdersService.create()` | `CONFIRMED` | `CREATED` (default) |
| `routes.ts:670` | `CONFIRMED` | `CREATED` (default) |
| `recurring-orders.cron.ts:208` | `ACTIVE` | `PENDING_APPROVAL` |
| `companies.service.ts:389` | `ACTIVE` | `CREATED` (default) |
| `OrdersService.createWithDelivery()` | `ACTIVE` | (não definido) |

**Risco:** `OrdersService.create()` cria pedidos com `status=CONFIRMED` mas `workflowStatus=CREATED`. Isso é incoerente com o mapeamento canônico (`CREATED` → legado `ACTIVE`). O pedido recorrente usa `status=ACTIVE` + `workflowStatus=PENDING_APPROVAL` que é coerente. A rota legada e o serviço principal estão com status divergente do workflow.

---

### 5.5 Transação de criação

```
storage.createOrder()
  └── tx.insert(orders)
  └── tx.update(orders) SET orderCode
  └── tx.insert(orderItems)

recurring-orders.cron.ts
  └── tx.insert(orders)       ← duplica
  └── tx.update(orders)       ← duplica
  └── tx.insert(orderItems)   ← duplica
  └── tx.insert(recurringOrderLogs)  ← adicional
```

---

## 6. Responsabilidades espalhadas

### O que pertence ao `OrdersService` mas está fora

| Responsabilidade | Onde está hoje | Deveria estar em |
|---|---|---|
| Guards de criação (maintenance, test, date-lock) | `OrdersService` + `routes.ts` duplicado | `OrdersService` exclusivamente |
| Geração de `orderCode` | `storage.ts` (canônico) + `cron` (duplicado) | `storage.createOrder()` exclusivamente |
| Cálculo de `totalValue` | `OrdersService`, `cron`, `companies.service` | `OrdersService` exclusivamente |
| Criação da linha de entrega | `OrdersService.afterCreate()` (correto) | — |
| Idempotência de criação recorrente | `recurring-orders.cron.ts` inline | `orders/recurring/recurring.idempotency.ts` |
| Leitura de escopos contratuais para pedidos | `recurring-orders.cron.ts` + `companies.service` | `orders/recurring/recurring.scheduler.ts` |

### O que está no `OrdersService` mas não deveria

| Responsabilidade | Onde está hoje | Onde deveria ir |
|---|---|---|
| Envio de e-mail | `afterCreate()` em `orders.service.ts` | `mailer.ts` / serviço de notificação |
| Push notification | `afterCreate()` em `orders.service.ts` | `pushService.ts` |
| Criação de entrega logística | `afterCreate()` em `orders.service.ts` | `logistics` module (já existe) |

**Nota:** Mover estas responsabilidades de `afterCreate` é uma refatoração **futura** (🟡). A arquitetura atual é funcional. O risco imediato é a ausência de `afterCreate` nos caminhos que bypassam `OrdersService`.

---

## 7. Order Creation Pipeline — Fluxo Oficial Proposto

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  ENTRADA (qualquer origem)                                                  │
│                                                                             │
│  HTTP Manual      → OrdersController                                       │
│  Cron Recorrente  → RecurringOrderScheduler                                │
│  Portal Cliente   → [futuro] PortalOrderStrategy                           │
│  Clara IA         → [futuro] ClaraOrderStrategy                            │
│  Extraordinário   → [futuro] ExtraordinaryOrderStrategy                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│  VALIDATION (nível de rota — aplicável a entradas HTTP)                    │
│                                                                             │
│  requireActiveSubscription                                                  │
│  checkPlanLimit("pedidos")                                                  │
│  Zod schema validation                                                      │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│  OrdersService.create() | createFromContractScopes() | createFrom<X>()     │
│                                                                             │
│  Guards aplicados condicionalmente por origem:                              │
│    • Maintenance mode          (todas as origens HTTP)                     │
│    • Test mode interception    (todas as origens HTTP com actor.userId)    │
│    • Duplicate window 60s      (origens HTTP interativas)                  │
│    • Date-lock guard           (origens HTTP interativas)                  │
│    • Idempotência externa      (origens automatizadas — cron, Clara)       │
│                                                                             │
│  Normalização (todas as origens):                                           │
│    • totalPrice por item       (unitPrice × qty se ausente)                │
│    • totalValue do pedido      (soma dos itens se ausente)                 │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│  orders.repository.create()                                                 │
│    • requireTenantId()         (enforcement multi-tenant obrigatório)      │
│    • injeta companyId e empresaId do contexto ALS                          │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│  storage.createOrder() — transação atômica                                 │
│    • INSERT orders                                                          │
│    • orderCode = VF-{YEAR}-{ID:6d}                                         │
│    • UPDATE orders SET orderCode                                            │
│    • INSERT orderItems                                                      │
│    • invalidateUsageCache(companyId)                                        │
│    [+ INSERT recurringOrderLogs se origem = Recorrente]                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│  afterCreate() — setImmediate (não bloqueia resposta)                      │
│    • INSERT system_logs        (ORDER_CREATED)                             │
│    • fireNotification          (order_created)                             │
│    • sendOrderPlaced           (e-mail cliente)                            │
│    • sendAdminNewOrder         (e-mail admins)                             │
│    • INSERT deliveries         (status: pendente)                          │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│  RESPOSTA / RESULTADO                                                       │
│    HTTP: 201 Created → { order }                                           │
│    Cron: RecurringRunResult { created, skipped, errors, durationMs }       │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│  WORKFLOW (via executeWorkflowTransaction — quando acionado)               │
│    • pg_try_advisory_xact_lock  → 409 se concorrência                     │
│    • Optimistic lock check      → 409 se estado mudou                     │
│    • APPROVED: estoque, preNota                                            │
│    • INVOICED: AR, PIX                                                     │
│    • SHIPPED: delivery → em_rota                                           │
│    • DELIVERED: delivery → entregue                                        │
│    • INSERT workflow_events     (outbox garantido transacionalmente)       │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│  OUTBOX WORKER (polling 5s)                                                 │
│    • Push notifications de status                                          │
│    • Audit logs de transição                                               │
│    • Retry + DLQ                                                           │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 8. Refatorações necessárias antes do Pedido Recorrente

### 🔴 Obrigatório — Bloqueador para qualquer nova origem de criação

#### R1 — `OrdersService` deve ser a única porta de criação

**Problema:** `recurring-orders.cron.ts` faz `db.insert(orders)` diretamente, saltando toda a pilha.  
**Solução:** `recurring-orders.cron.ts` deve chamar `OrdersService.createFromContractScopes()`, que usa `orders.repository.create()` → `storage.createOrder()`.  
**Impacto se não corrigido:** Pedidos Recorrentes entram no sistema sem linha de entrega logística. O operador aprova o pedido, ele vai para SHIPPED, e o `executeWorkflowTransaction` tenta `UPDATE deliveries` — encontra zero linhas. A entrega nunca acontece no sistema.

---

#### R2 — `afterCreate` deve ser chamado por toda origem de criação

**Problema:** `routes.ts`, `companies.service`, e `recurring-orders.cron.ts` não chamam `afterCreate`.  
**Solução:** Quando `OrdersService.createFromContractScopes()` existir, `afterCreate` passa a ser chamado automaticamente como parte do pipeline.  
**Nota sobre `companies.service.generateOrdersFromScope()`:** Este método deve ser migrado para chamar `OrdersService` em vez de `storage.createOrder()` diretamente.

---

#### R3 — `recurring-orders.cron.ts` deve usar UTC 09:00 (= BRT 06:00)

**Problema:** O cron está agendado para `0 6 * * 1` (06:00 UTC = 03:00 BRT). Se for intenção rodar às 06:00 BRT, o horário correto é `0 9 * * 1` (09:00 UTC).  
**Evidência:** O `nfeGenerator.ts` teve exatamente este bug (cStat=703) e foi corrigido. O cron tem o mesmo problema latente.

---

#### R4 — Status inicial deve ser consistente entre todas as origens

**Problema:** `OrdersService.create()` persiste `status=CONFIRMED` mas `workflowStatus=CREATED`. O mapeamento canônico em `orders.workflow.ts` diz que `CREATED` → legado `ACTIVE`. Há uma inconsistência: o pedido nasce como `CONFIRMED` no legado mas `CREATED` no workflow, quando deveria ser `ACTIVE` (ou o mapeamento deveria ser atualizado).  
**Ação mínima:** Definir qual é o status inicial canônico e aplicar a toda origem. O pedido recorrente usa `status=ACTIVE` + `workflowStatus=PENDING_APPROVAL` — este é o modelo mais correto para automações.

---

### 🟠 Recomendado — Antes de entrar em produção com Pedido Recorrente

#### R5 — `companies.service.generateOrdersFromScope()` deve usar `OrdersService`

**Problema:** `companies.service.ts:383` chama `storage.createOrder()` diretamente, sem tenant guard e sem `afterCreate`.  
**Solução:** Substituir por chamada ao `OrdersService` (ou ao futuro `createFromContractScopes` se os inputs forem similares).

---

#### R6 — Remover ou migrar a rota legada `routes.ts:592`

**Problema:** A rota `POST /api/orders` em `routes.ts` duplica todos os guards de `OrdersService.create()` e os chama na mesma URL. Qualquer mudança nos guards precisa ser feita em dois lugares.  
**Solução:** Verificar se esta rota ainda é ativa (ou se o `OrdersController` a substitui completamente). Se inativa, remover. Se ativa, redirecionar para `OrdersController`.

---

#### R7 — Integrar `recurring-orders.cron.ts` à infraestrutura de jobs

**Problema:** O cron não usa `registerJob`, `startJobRun`, `finishJobRun`, `isJobRunning`, `runWithRequestContext`. O `faturamento.cron.ts` já usa toda essa infraestrutura.  
**Solução:** Aplicar o mesmo padrão. Sem isso, o job não aparece no painel de observabilidade e não tem proteção anti-sobreposição.

---

### 🟡 Futuro — Não bloqueia Pedido Recorrente

#### R8 — Centralizar cálculo de `totalValue`

**Problema:** Três implementações com precisão numérica diferente em `OrdersService`, `cron`, e `companies.service`.  
**Solução:** Extrair função utilitária `calculateOrderTotal(items: OrderItem[]): string` em `orders/orders.utils.ts`.

---

#### R9 — Extrair `afterCreate` para serviços específicos

**Problema:** `OrdersService.afterCreate()` conhece e depende de: mailer, pushService, logistics (deliveries). Isso cria acoplamento entre o domínio Orders e esses módulos.  
**Solução futura:** Emitir evento de domínio `OrderCreated` e deixar cada módulo reagir via listener. Isso é uma mudança arquitetural maior — não é bloqueador para o Pedido Recorrente.

---

#### R10 — Scripts de teste devem usar factories, não `db.insert()` direto

**Problema:** Scripts de teste em `/scripts/` usam `db.insert(orders)` bruto, criando pedidos em estado inconsistente.  
**Solução:** Criar uma `OrderTestFactory` que chama o repository com um contexto de teste sintético.

---

## Sumário executivo

O domínio Orders tem **um serviço principal bem construído** (`OrdersService`) cercado por **três bypasses críticos** que não chamam `afterCreate` e um **quarto bypass** que é uma rota legada duplicada. O resultado é que pedidos criados por `companies.service.generateOrdersFromScope()` e pelo cron atual entram no sistema sem linha de entrega logística — o que é um bug operacional silencioso.

O requisito mínimo antes da implementação do Pedido Recorrente é: **toda criação de pedido deve passar por `OrdersService` e garantir que `afterCreate` seja chamado.** Isso elimina R1, R2 e o bug da entrega logística em um único movimento.

---

*Este documento deve ser revisado e atualizado a cada nova origem de criação de pedido adicionada ao sistema.*
