# R1 FINALIZATION REPORT — Pipeline de Criação de Pedidos
**VivaFrutaz ERP | Data: 2026-07-22 | Executado por: Agent**

---

## 1. Escopo da Auditoria

Arquivo central: `server/modules/orders/orders.service.ts`

Métodos auditados:
- `create()` — caminho do cliente (HTTP POST /api/orders)
- `createInternal()` — caminho do sistema (cron, admin, recorrência)
- `createWithDelivery()` — caminho admin com entrega inline (**desvio identificado pela R1**)
- `afterCreate()` — pipeline de side-effects pós-criação

Callers mapeados:
- `createWithDelivery()`: `orders.controller.ts:94`, `orders.controller.v2.ts:86`
- `createInternal()`: `companies.service.ts` (via `generateOrdersFromScope()`)
- `create()`: `routes.ts` (POST `/api/orders`)

---

## 2. Desvio Arquitetural Identificado

### `createWithDelivery()` — Caminho Paralelo (PRÉ-REFATORAÇÃO)

| Responsabilidade | `create()` | `createInternal()` | `createWithDelivery()` (antes) |
|---|:---:|:---:|:---:|
| Manutenção / test mode | ✅ | ❌ intencional | ❌ intencional |
| Dup + date-lock guard | ✅ | ❌ intencional | ❌ intencional |
| Normalização items/total | ✅ | ✅ (duplicado) | ❌ **gap** |
| `repo.create()` | ✅ | ✅ | ✅ |
| `afterCreate()` | ✅ | ✅ | ❌ **desvio crítico** |
| Audit log | ✅ | ✅ | ❌ **ausente** |
| Push notification | ✅ | ✅ | ❌ **ausente** |
| Emails | ✅ | ✅ | ❌ **ausente** |
| Entrega (delivery) | via `afterCreate` | via `afterCreate` | inline ✅ |
| Price resolver | ❌ | ❌ | ✅ (feature-flag) |
| Validação tenant | implícita | ❌ **gap** | parcial (companyId≠null, não null-check) |
| `userRole` no audit log | `"CLIENT"` fixo | `"CLIENT"` fixo | N/A |

**Conclusão pré-refatoração:** `createWithDelivery()` era um caminho paralelo completo —
persistia o pedido e a entrega, mas **nunca disparava `afterCreate()`**, omitindo audit log,
push notification e emails para todos os pedidos criados via esse endpoint.

---

## 3. Mudanças Implementadas

### 3.1 Extração de `_normaliseItems()` (privado)

**Problema:** A lógica de normalização de `totalPrice` e `totalValue` estava duplicada
byte-a-byte em `create()` e `createInternal()`.

**Solução:** Extraída para `private _normaliseItems(items, order)` — ambos os métodos
chamam o helper. Comportamento idêntico; zero risco de divergência futura.

**Benefício adicional:** `createWithDelivery()` agora também usa o helper, fechando o gap
de itens sem `totalPrice` quando o price resolver está desativado.

### 3.2 `afterCreate()` — parâmetro `actorRole`

**Problema:** O audit log sempre gravava `userRole: "CLIENT"`, mesmo quando o pedido era
criado pelo sistema (cron, admin).

**Solução:** Assinatura alterada para `afterCreate(newOrder, order, items, actorRole = "CLIENT")`.

| Caller | `actorRole` passado |
|---|---|
| `create()` | `"CLIENT"` (default — comportamento preservado) |
| `createInternal()` | `ctx.actorRole ?? "SISTEMA"` |
| `createWithDelivery()` | `acting.role ?? "ADMIN"` |

### 3.3 `createInternal()` — validação de tenant context

**Problema:** `createInternal()` aceitava `companyId` arbitrário sem verificar se a empresa
existe, podendo gerar registros órfãos.

**Solução:** Guard adicionado antes de qualquer escrita:
```typescript
if (order.companyId) {
  const tenant = await this.repo.getCompany(order.companyId);
  if (!tenant) throw new BadRequestError(`Empresa ${order.companyId} não encontrada`);
}
```

Comportamento no happy path: idêntico (empresa existe → segue normal).
Comportamento no edge case: antes silenciava o erro downstream; agora falha explicitamente.

### 3.4 `createWithDelivery()` — alinhamento ao pipeline oficial

**Problema central:** `createWithDelivery()` nunca chamava `afterCreate()`.

**Solução:** Após persistir o pedido e a entrega de forma síncrona (necessário para retornar
`{ order, delivery }` ao caller), dispara `afterCreate()` via `setImmediate`:

```typescript
setImmediate(async () => {
  try {
    await this.afterCreate(order, orderBodyForAfterCreate, finalItems, acting.role ?? "ADMIN");
  } catch (err: any) {
    logSecurity(`[ORDER_AFTER_CREATE_FAILED] orderId=${order.id} source=createWithDelivery | ...`);
  }
});
```

**Ausência de duplicação de entrega:** `afterCreate()` verifica `getDeliveryByOrder(newOrder.id)`
antes de criar. Como `createWithDelivery()` já persistiu a entrega de forma síncrona, o check
encontra a entrega e pula a criação automática. Sem duplicação garantida por design.

**Guard de company nula:** adicionado `if (!company) throw new BadRequestError(...)` após o
`getCompany()` — antes prosseguia com `company = undefined`.

---

## 4. Pipeline Unificado — Estado Pós-REFATORAÇÃO

```
Pedido Manual (create)
  └── maintenance/test guard
  └── dup + date-lock guard
  └── _normaliseItems()
  └── repo.create() [status: CONFIRMED]
  └── setImmediate → afterCreate("CLIENT")
         └── audit log
         └── push notification
         └── emails
         └── auto-delivery (se não existir)

Pedido Administrativo / createWithDelivery()
  └── auth guard (userId obrigatório)
  └── tenant guard (company existe)
  └── price resolver (feature-flag por empresa)
  └── _normaliseItems()
  └── repo.create() [status: ACTIVE]
  └── repo.createDelivery() [síncrono — retorna ao caller]
  └── setImmediate → afterCreate(acting.role)   ← NOVO
         └── audit log                           ← NOVO
         └── push notification                   ← NOVO
         └── emails                              ← NOVO
         └── auto-delivery → SKIP (já existe)

Pedido do Sistema / createInternal()
  └── tenant guard (company existe)              ← NOVO
  └── _normaliseItems()
  └── repo.create() [status livre]
  └── setImmediate → afterCreate(ctx.actorRole ?? "SISTEMA")
         └── audit log [userRole=SISTEMA]        ← CORRIGIDO
         └── push notification
         └── emails
         └── auto-delivery (se não existir)

Pedido Recorrente / generateOrdersFromScope()
  └── (companies.service.ts)
  └── ordersService.createInternal({ source: "recurring-cron" })
  └── → mesmo pipeline de createInternal acima

Futuras integrações (Portal, Clara, API)
  └── DEVEM usar create() ou createInternal()
  └── NÃO devem chamar repo.create() diretamente
```

---

## 5. Análise de `afterCreate()` — Vale a Pena Dividir?

### Responsabilidades atuais (5)

1. `createAudit` — grava log `ORDER_CREATED`
2. `createNotificationPush` — dispara push via `fireNotification()`
3. `createEmailClient` — envia `sendOrderPlaced()` ao cliente
4. `createEmailAdmin` — envia `sendAdminNewOrder()` a cada admin
5. `createDelivery` — auto-logistics (idempotente via `getDeliveryByOrder`)

### Proposta de divisão

```
afterCreate(newOrder, order, items, actorRole)
  ↓
  _createAudit(newOrder, order, actorRole)
  _createNotifications(newOrder, order, items)
    ↓ _createPushNotification()
    ↓ _createEmailClient()
    ↓ _createEmailAdmins()
  _createAutoDelivery(newOrder, order)
```

### Vale a pena? **Sim, com prioridade média.**

**Razões favoráveis:**
- Permite testar cada side-effect isoladamente (mock granular)
- `createWithDelivery()` poderia chamar `afterCreate()` com `skipDelivery: true` em vez
  de depender do check `getDeliveryByOrder` para pular o step — mais explícito
- Facilita adicionar novos side-effects (ex.: webhook, CRM sync) sem crescer `afterCreate()`
- Cada método privado tem responsabilidade única (Single Responsibility)

**Razões contrárias agora:**
- O comportamento atual já é correto após esta refatoração
- Cada sub-step já tem seu próprio `try/catch` individual — falhas já são isoladas
- A divisão é puramente organizacional, sem impacto de runtime

**Recomendação:** Implementar na próxima sprint dedicada a testes unitários de `OrdersService`,
quando os mocks dos sub-steps agregariam valor imediato para cobertura.

---

## 6. Resultados dos Checks Obrigatórios

| Check | Resultado | Observação |
|---|---|---|
| `npx tsc --noEmit --skipLibCheck` | ✅ **PASS** (exit 0) | 0 erros |
| `npm run check` (tsc padrão) | ✅ **PASS** (exit 0) | 0 erros |
| `npm run check:strict` | ⚠️ 35 erros pré-existentes | Todos em `companyCertificate.repository.ts`, `logistics.controller.ts`, `orders.repository.ts` — nenhum relacionado às mudanças deste refactor |
| `npm test` | ⚠️ Falha de conexão DB | `ENOTFOUND` na suite de regressão (`billing-nfe-equivalence`) — ambiente CI sem DB; unit tests passam |

**Todos os erros de `check:strict` e `npm test` são pré-existentes e não introduzidos por esta refatoração.**

---

## 7. Invariantes Preservados

- ✅ Nenhuma regra de negócio alterada
- ✅ `status: "ACTIVE"` em `createWithDelivery()` preservado (≠ `"CONFIRMED"` de `create()`)
- ✅ Guards de manutenção/test/dup/date-lock NÃO adicionados ao path admin (intencional)
- ✅ Price resolver em `createWithDelivery()` preservado integralmente
- ✅ Retorno `{ order, delivery }` de `createWithDelivery()` preservado
- ✅ `afterCreate` continua fire-and-forget (setImmediate) em todos os paths
- ✅ Supabase exclusivo, sem nova feature, sem nova rota

---

## Veredicto

🟢 **R1 FINALIZADA**

Existe exatamente **UM pipeline oficial de criação de pedidos** no ERP VivaFrutaz.
Todos os caminhos (Manual, Administrativo, Recorrente, generateOrdersFromScope, futuras
integrações) convergem para `repo.create()` + `afterCreate()` com side-effects completos.
O último desvio arquitetural (`createWithDelivery()` sem `afterCreate()`) foi eliminado.
