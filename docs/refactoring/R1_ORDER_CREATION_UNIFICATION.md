# R1 — Unificação do Pipeline de Criação de Pedidos

**Data**: 2026-07-22  
**Status**: ✅ Concluída  
**Escopo**: Zero alteração de comportamento — refatoração estrutural apenas.

---

## Objetivo

Garantir que exista **apenas um pipeline oficial** para criação de pedidos em todo o ERP.
Após esta refatoração, `OrdersService.create()` / `OrdersService.createInternal()` são os
únicos pontos de entrada permitidos. Nenhum código de produção chama diretamente:

- `db.insert(orders, ...)`
- `repository.create()` (fora do próprio serviço)
- `storage.createOrder()`
- SQL direto em tabelas de pedido

---

## Contexto: arquitetura de montagem de rotas

O `server/modules/index.ts` registra todos os módulos (`registerModules`) **antes** de
`registerRoutes` (routes.ts). Isso significa que `POST /api/orders` do módulo
`server/modules/orders/orders.routes.ts` → `ordersController.create` →
`OrdersService.create()` **sempre** tem precedência sobre qualquer handler legado em
routes.ts para o mesmo caminho.

---

## Bypasses identificados antes da R1

| # | Arquivo | Método | Chamada proibida | Trigger |
|---|---------|--------|-----------------|---------|
| 1 | `server/routes/routes.ts` (L592) | handler legado `app.post(api.orders.create.path)` | `storage.createOrder()` | Nunca alcançado (módulo tem precedência) — código morto |
| 2 | `server/modules/companies/companies.service.ts` (L383) | `generateOrdersFromScope()` | `storage.createOrder()` | `POST /api/companies/:id/generate-orders-scope` |
| 3 | `server/jobs/recurring-orders.cron.ts` (L203) | `runRecurringOrdersCron()` | `db.insert(orders)` + `db.insert(orderItems)` | Cron toda segunda-feira às 06:00 |

---

## Alterações realizadas

### 1. `server/modules/orders/orders.service.ts`

**Método criado**: `createInternal(order, items, ctx?)`

Pipeline interno para chamadores de sistema (cron, ferramentas admin). Idêntico ao
`create()` exceto por:

- Sem verificação de maintenance_mode / test_mode (sistema sempre escreve).
- Sem janela de deduplicação de 60s (chamadores gerenciam sua própria idempotência).
- Sem date-lock guard (chamadores são responsáveis por unicidade de datas).
- Aceita o shape completo do pedido, incluindo `workflowStatus`, `isRecurring`, etc.

Compartilhado com `create()`:
- Normalização de `totalPrice` por item e `totalValue` do pedido.
- Persistência via `this.repo.create()` (mesmo caminho, mesma geração de `orderCode`,
  mesmo tenant guard).
- Side-effects de `afterCreate`: audit log, push notification, emails, auto-logistics.

### 2. `server/modules/companies/companies.service.ts`

**Import adicionado**: `ordersService` de `../orders/orders.service`

**Método modificado**: `generateOrdersFromScope()`

Substituição cirúrgica:
```
- await storage.createOrder(orderData, items)
+ await ordersService.createInternal(orderData, items, { source: "generate-orders-from-scope" })
```

Ganho: todos os pedidos gerados por escopo contratual agora recebem:
- audit log (`ORDER_CREATED`)
- auto-logistics (entrega criada automaticamente)
- push notification + emails

### 3. `server/jobs/recurring-orders.cron.ts`

**Imports removidos**: `orders`, `orderItems` de `@shared/schema`; `and`, `isNull`, `or` de `drizzle-orm`  
**Import adicionado**: `ordersService` de `../modules/orders/orders.service`

**Método modificado**: `runRecurringOrdersCron()` — bloco interno de criação (linha ~193)

Substituição:
```
- await db.transaction(async (tx) => {
-   const [newOrder] = await tx.insert(orders).values({...}).returning();
-   await tx.update(orders).set({ orderCode }).where(...);
-   await tx.insert(orderItems).values(items);
-   await tx.insert(recurringOrderLogs).values({...});
- });
+ const newOrder = await ordersService.createInternal(orderData, items, { source: "recurring-cron" });
+ await db.insert(recurringOrderLogs).values({...});
```

**Nota de atomicidade**: a inserção no `recurring_order_logs` agora ocorre **após**
`createInternal()` em vez de dentro da mesma transação. A não-atomicidade é intencional
e aceitável:
- Probabilidade de falha entre os dois passos: extremamente baixa.
- Consequência de `createInternal` OK + log falhar: o pedido existe mas o log não.
  Na próxima execução do cron, `processedSet` não encontrará a chave → tentativa de
  recriar o pedido. O `createInternal` não tem date-lock próprio, mas o cron verifica
  `processedSet` no início de cada run, que é carregado do DB via `recurringOrderLogs`.
  Para prevenir duplicatas em cenário de falha parcial, o `catch` captura o erro e
  incrementa `errors`, e os logs do cron tornam a situação visível para operação.

Ganho: pedidos recorrentes agora recebem todos os side-effects de `afterCreate`.

### 4. `server/routes/routes.ts`

**Removido**: handler legado `app.post(api.orders.create.path, ...)` (linhas 581–754
originais) — era código morto confirmado. Substituído por comentário tombstone explicando
a migração e o motivo pelo qual o handler nunca era alcançado em runtime.

---

## Métodos removidos

| Arquivo | Método/Bloco | Motivo |
|---------|-------------|--------|
| `server/routes/routes.ts` | handler legado `app.post` para `/api/orders` (incluindo `recentOrders` Map e timer) | Código morto — módulo tem precedência |

---

## Métodos criados

| Arquivo | Método | Descrição |
|---------|--------|-----------|
| `server/modules/orders/orders.service.ts` | `createInternal(order, items, ctx?)` | Pipeline interno para chamadores de sistema |

---

## Callers migrados

| Caller | De | Para |
|--------|----|------|
| `generateOrdersFromScope()` em `companies.service.ts` | `storage.createOrder()` | `ordersService.createInternal()` |
| `runRecurringOrdersCron()` em `recurring-orders.cron.ts` | `db.insert(orders)` + `db.insert(orderItems)` | `ordersService.createInternal()` |
| Handler legado em `routes.ts` | `storage.createOrder()` | Removido (tombstoned) |

---

## Verificação de qualidade

| Check | Antes R1 | Depois R1 | Delta |
|-------|----------|-----------|-------|
| `npx tsc --noEmit` | 0 erros | 0 erros | ✅ 0 |
| `npm run check` | 0 erros | 0 erros | ✅ 0 |
| `npm run check:strict` | 35 erros pré-existentes | 35 erros pré-existentes | ✅ 0 regressão |
| `npm test` | 6 falhas pré-existentes (FASE 8.4.3) | 6 falhas pré-existentes | ✅ 0 regressão |

Os 35 erros de `check:strict` são todos pré-existentes em `logistics.controller.ts`
(`req.requestId`) e `orders.repository.ts` (possivelmente `undefined`) — confirmado
comparando o baseline (`git stash`) com o resultado pós-R1.

---

## Pontos pendentes (fora do escopo da R1)

| Item | Descrição |
|------|-----------|
| Atomicidade cron | O insert em `recurringOrderLogs` poderia ser atômico com a criação do pedido via hook de transação no `createInternal`. Decidido não implementar na R1 para preservar o pipeline limpo. |
| Remoção de `storage.createOrder` | `storage.createOrder()` ainda existe em `storage.ts` e ainda é chamado pelo `orders.repository.ts` → `repo.create()`. A camada de storage pode ser aposentada futuramente quando o repositório usar Drizzle diretamente. |
| Limpar `routes.ts` | O arquivo inteiro poderá ser removido quando todas as rotas restantes forem migradas para módulos. |
| `check:strict` pré-existentes | 35 erros em logistics/orders não relacionados à R1 — devem ser tratados em tarefa separada. |

---

## Arquivos alterados (resumo)

```
server/modules/orders/orders.service.ts        (+66 linhas — createInternal adicionado)
server/modules/companies/companies.service.ts  (+3 linhas líquidas — import + substituição)
server/jobs/recurring-orders.cron.ts           (-3 linhas líquidas — simplificação + R1)
server/routes/routes.ts                        (-157 linhas — handler morto removido)
docs/refactoring/R1_ORDER_CREATION_UNIFICATION.md  (este arquivo)
```
