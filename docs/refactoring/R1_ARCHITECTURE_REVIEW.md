# R1 — Gate de Arquitetura: Revisão Técnica

**Data**: 2026-07-22  
**Revisor**: Auditoria automática pós-R1  
**Escopo**: Validação de unificação do pipeline de criação de pedidos  
**Arquivos alterados pela R1**: nenhum foi modificado nesta revisão

---

## 1. Existe QUALQUER lugar que ainda crie um `Order` sem passar pelo `OrdersService`?

### Resposta: **Sim — 1 caminho em produção (pré-existente, não introduzido pela R1)**

#### `createWithDelivery()` — gap de `afterCreate` dentro do próprio `OrdersService`

| Campo | Valor |
|-------|-------|
| Arquivo | `server/modules/orders/orders.service.ts` |
| Linhas | 679–886 |
| Tipo | Produção |
| Criticidade | **Alta** |

`createWithDelivery()` é um método DO `OrdersService` — logo não é um bypass externo. Porém é um **segundo caminho de criação que não executa `afterCreate()`**:

```
POST /api/orders/create-with-delivery
  → OrdersService.createWithDelivery()
    → this.repo.create()         ✅ usa o pipeline de persistência correto
    → this.repo.createDelivery() ✅ cria entrega sincronamente
    ❌ NÃO chama afterCreate()
```

**Efeitos ausentes para pedidos criados via `createWithDelivery`:**
- ❌ Audit log `ORDER_CREATED`
- ❌ Push notification para o painel admin
- ❌ Email `sendOrderPlaced` para o cliente
- ❌ Email `sendAdminNewOrder` para administradores
- ⚠️ Auto-logistics (entrega criada via `repo.createDelivery` diretamente — entrega existe, mas sem o fluxo normalizado de `afterCreate`)

Este gap é **pré-existente à R1** e não foi introduzido pela refatoração. A R1 endereçou os bypasses externos (`routes.ts`, `companies.service`, `recurring-orders.cron`). O `createWithDelivery` é o único caminho de produção dentro do `OrdersService` que não executa `afterCreate`.

---

## 2. Inserts diretos na tabela `orders`

| Arquivo | Linha | Código | Produção/Teste | Classificação |
|---------|-------|--------|----------------|---------------|
| `server/services/storage.ts` | 1083 | `tx.insert(orders).values(...)` | Produção | ✅ Aceitável — é a implementação de `createOrder()`, chamada EXCLUSIVAMENTE por `orders.repository.ts:126` |
| `server/core/tenant/scope.ts` | 86 | *(JSDoc comment)* | N/A | ✅ Comentário de documentação, não código executável |
| `server/jobs/recurring-orders.cron.ts` | 27 | *(comment tombstone R1)* | N/A | ✅ Comentário explicando o que foi removido |
| `scripts/test-billing-equivalence.ts` | 294 | `db.insert(orders).values(...)` | Script dev | ⚠️ Script de validação manual, não alcançável em runtime de produção |
| `scripts/test-fase5-full-validation.ts` | 267 | `db.insert(orders).values(...)` | Script dev | ⚠️ Idem |
| `scripts/test-fiscal-step2.ts` | 171 | `db.insert(orders).values(...)` | Script dev | ⚠️ Idem |
| `tests/regression/billing-nfe-equivalence.test.ts` | 279 | `db.insert(orders).values(...)` | Teste | ⚠️ Fixture de teste — ver análise abaixo |

**Conclusão:** Em código de produção, `db.insert(orders)` aparece em **1 lugar**: dentro de `storage.createOrder()`. Esse insert é o fundo da pilha de chamadas do pipeline oficial (`OrdersService → repo.create() → storage.createOrder() → tx.insert(orders)`). Não é um bypass — é a implementação.

---

## 3. Inserts diretos em `order_items`

| Arquivo | Linha | Código | Produção/Teste | Classificação |
|---------|-------|--------|----------------|---------------|
| `server/services/storage.ts` | 1104 | `tx.insert(orderItems).values(...)` | Produção | ✅ Dentro de `createOrder()` — fundo do pipeline oficial |
| `server/services/storage.ts` | 969 | `db.insert(orderItems).values(...)` | Produção | ✅ Dentro de `updateOrderItems()` — operação de EDIÇÃO, não criação |
| `scripts/test-billing-equivalence.ts` | 306 | `db.insert(orderItems).values(...)` | Script dev | ⚠️ Fixture |
| `scripts/test-fase5-full-validation.ts` | 280 | `db.insert(orderItems).values(...)` | Script dev | ⚠️ Fixture |
| `scripts/test-fiscal-step2.ts` | 183 | `db.insert(orderItems).values(...)` | Script dev | ⚠️ Fixture |
| `tests/regression/billing-nfe-equivalence.test.ts` | 291 | `db.insert(orderItems).values(...)` | Teste | ⚠️ Fixture de teste |

**Sobre os scripts e testes:** os fixtures de teste e validação criam pedidos em estado específico (ex: `workflowStatus: "APPROVED"`) que seriam recusados ou alterados pelas guards do `OrdersService`. Isso é prática legítima para testes de integração que precisam de dados em estados específicos. **Não representam bypass em produção.**

---

## 4. `createOrder()` fora do `OrdersService`

Busca: `storage.createOrder\b` em todo o codebase (excluindo comments e definição).

| Arquivo | Linha | Contexto |
|---------|-------|---------|
| `server/modules/orders/orders.repository.ts` | 126 | `return storage.createOrder(safeOrder, safeItems)` |

**Esse é o único caller de `storage.createOrder()` em código executável.** O repositório é chamado exclusivamente pelo `OrdersService` (via `this.repo.create()`). A cadeia completa:

```
OrdersService.create() / createInternal()
  → this.repo.create()                    [orders.repository.ts:121]
    → storage.createOrder()               [storage.ts:1080]
      → tx.insert(orders)                 [storage.ts:1083]  ← fundo da pilha
      → tx.update(orders, { orderCode })  [storage.ts:1093]
      → tx.insert(orderItems)             [storage.ts:1104]
```

---

## 5. Chamadas a `repository.create()` por outros módulos

Busca: `this.repo.create(` em todos os serviços fora do módulo de orders.

| Arquivo | Linha | Tipo | Relevância |
|---------|-------|------|-----------|
| `companies.service.ts` | 58 | Criação de **empresa** | ❌ Não é pedido |
| `products.service.ts` | 95 | Criação de **produto** | ❌ Não é pedido |
| `users.service.ts` | 58 | Criação de **usuário** | ❌ Não é pedido |

**Nenhum módulo externo chama `ordersRepository.create()` diretamente.** O repositório de orders não é instanciado nem importado fora do próprio módulo de orders.

---

## 6. Caminhos que não executam `afterCreate()`

| Caminho | `afterCreate` | Observação |
|---------|:-------------:|-----------|
| `OrdersService.create()` | ✅ via `setImmediate` | Caminho HTTP cliente |
| `OrdersService.createInternal()` | ✅ via `setImmediate` | Caminho sistema (cron, admin-scope) |
| `OrdersService.createWithDelivery()` | **❌ AUSENTE** | Caminho admin HTTP |

`createWithDelivery` representa ~100% das criações de pedido pelo painel administrativo (rota `POST /api/orders/create-with-delivery`). Pedidos criados por este caminho **não geram audit log, não disparam push notification e não enviam emails**.

---

## 7. O pipeline atual é realmente único?

### Diagrama do fluxo real

```
┌─────────────────────────────────────────────────────────────────────┐
│                    CRIAÇÃO DE PEDIDOS — estado atual                 │
└─────────────────────────────────────────────────────────────────────┘

CAMINHO A — Cliente HTTP (único caminho completo)
─────────────────────────────────────────────────
POST /api/orders
  → ordersController.create
  → OrdersService.create(body, actor)
    [1] maintenance_mode guard
    [2] test_mode / SISTEMA_TESTE interception → test_orders
    [3] duplicate-submission window (60s in-memory)
    [4] date-lock guard (1 pedido por empresa/data)
    [5] normalise totalPrice / totalValue
    [6] this.repo.create() ──────────────────────────────┐
    [7] setImmediate → afterCreate()                      │
         ├── audit log ORDER_CREATED                      │
         ├── push notification order_created              │
         ├── email sendOrderPlaced (cliente)              │
         ├── email sendAdminNewOrder (admins)             │
         └── auto-logistics createDelivery               │
                                                          │
CAMINHO B — Admin HTTP  ⚠️ afterCreate AUSENTE            │
─────────────────────────────────────────────            │
POST /api/orders/create-with-delivery                     │
  → ordersController.createWithDelivery                   │
  → OrdersService.createWithDelivery(body, actor)         │
    [1] actor auth check                                  │
    [2] price resolver (feature flag useNewPricing)       │
    [3] this.repo.create() ──────────────────────────────>┤
    [4] this.repo.createDelivery() (synchronous)          │ ÚNICO PONTO
    ❌ SEM afterCreate                                    │ DE PERSISTÊNCIA
                                                          │
CAMINHO C — Sistema/Cron  ✅ completo (R1)                │
─────────────────────────────────────────────            │
Cron Monday 06:00                                         │
  → runRecurringOrdersCron()                              │
  → ordersService.createInternal()                        │
    [1] normalise totalPrice / totalValue                 │
    [2] this.repo.create() ──────────────────────────────>┤
    [3] setImmediate → afterCreate() ✅                   │
  → db.insert(recurringOrderLogs)                         │
                                                          │
CAMINHO D — Admin Scope  ✅ completo (R1)                 │
─────────────────────────────────────────────            │
POST /api/companies/:id/generate-orders-scope             │
  → companiesController → companiesService                │
  → ordersService.createInternal()                        │
    [1] normalise totalPrice / totalValue                 │
    [2] this.repo.create() ──────────────────────────────>┘
    [3] setImmediate → afterCreate() ✅
                              │
                              ▼
             orders.repository.ts:create()
                  [tenant guard]
                  storage.createOrder()
                    tx.insert(orders)
                    tx.update orders SET orderCode
                    tx.insert(orderItems)
                  invalidateUsageCache(companyId)
```

**Conclusão:** A persistência converge para um único ponto (`storage.createOrder()` via `orders.repository.ts`). A unicidade da **persistência** foi atingida pela R1. A unicidade dos **side-effects** (`afterCreate`) ainda não é completa — o Caminho B (`createWithDelivery`) é a exceção.

---

## 8. Análise crítica de `createInternal()`

### Nome

`createInternal` descreve **localização** ("interno ao serviço"), não **intenção** ("criado por sistema, sem contexto HTTP"). Um nome mais expressivo seria `createBySystem` ou `createProgrammatic`. O nome atual permite ambiguidade: qualquer método private também poderia ser chamado "internal".

**Recomendação**: renomear para `createBySystem(order, items, ctx?)` antes do Release 1.

### Responsabilidades

| Responsabilidade | Presente | Adequação |
|-----------------|:--------:|-----------|
| Normalização de totalPrice/totalValue | ✅ | Duplicada de `create()` — viola DRY |
| Persistência via repo | ✅ | Correto |
| Disparo de `afterCreate` | ✅ | Correto |
| Validação de campos obrigatórios | ❌ | Callers assumem responsabilidade — contrato implícito |
| Atribuição de actor/source no audit log | ❌ | `afterCreate` hardcoda `userRole: "CLIENT"` para TODOS os callers |

### Acoplamento

- **Baixo acoplamento externo** ✅ — não depende de `Request`/`Response`, não importa Express.
- **Acoplamento implícito por documentação** ⚠️ — o contrato "callers são responsáveis pelas invariantes que `create()` garante (date-lock, dedup)" existe apenas em JSDoc. Um caller futuro pode ignorar isso.
- **Acoplamento à `afterCreate` privada** ✅ — adequado (mesma classe).

### Reutilização

Reusado imediatamente por 2 callers (`recurring-orders.cron.ts`, `companies.service.ts`). Estrutura adequada para futuras extensões. Porém, a normalização duplicada significa que uma correção em `create()` precisa ser replicada manualmente em `createInternal()`.

### Segurança

1. **Atribuição incorreta no audit log**: `afterCreate` usa `userRole: "CLIENT"` para todos os caminhos. Pedidos gerados pelo cron (`source: "recurring-cron"`) aparecem no log como criados por `CLIENT`. Para auditoria, `SYSTEM` seria o valor correto.

2. **Sem validação de campos obrigatórios**: `companyId`, `deliveryDate`, `weekReference` são `NOT NULL` no banco. Um caller com bug que omita esses campos recebe um erro 500 da constraint em vez de um erro de validação claro.

3. **Sem guard de tenant no método**: depende de `requireTenantId()` estar setado no contexto assíncrono. Para o cron (que itera por empresas), o contexto pode estar vazio — o `orders.repository.ts` chama `requireTenantId()` mas o cron não seta um tenant antes de chamar `createInternal`. Isso merece verificação explícita.

### Compatibilidade futura

O método é `public` no `OrdersService`. Qualquer futuro módulo pode importar `ordersService` e chamar `createInternal()` sem implementar as guards que `create()` tem. Sem um teste que detecte isso, o "contrato por documentação" pode ser silenciosamente violado.

### Deve permanecer ou ser refatorado antes do Release 1?

**Deve ser ajustado antes do Release 1**, com as seguintes correções mínimas:

1. Renomear para `createBySystem()` ou adicionar `@internal` JSDoc explícito
2. Extrair normalização para `private normaliseOrderInput()` eliminando a duplicação
3. Propagar `ctx.source` para `afterCreate` para corrigir a atribuição no audit log (`userRole: "SYSTEM"` quando `source` indica cron ou admin-tool)

---

## 9. Oportunidades de simplificação

### 9.1 Normalização duplicada — crítica (DRY)

A lógica de normalização de `totalPrice`/`totalValue` existe em dois lugares idênticos:

**`create()` — linhas 470–483:**
```typescript
const normalisedItems = (items || []).map((it: any) => {
  if (it.totalPrice != null && it.totalPrice !== "") return it;
  const tp = (Number(it.unitPrice || 0) * Number(it.quantity || 0)).toFixed(2);
  return { ...it, totalPrice: tp };
});
const normalisedTotal = order.totalValue != null && order.totalValue !== ""
  ? String(order.totalValue)
  : String(normalisedItems.reduce((s, i) => s + Number(i.totalPrice || 0), 0).toFixed(2));
```

**`createInternal()` — linhas 536–548:** código idêntico.

**Solução**: extrair `private normaliseOrderInput(order, items): { order, items }`.

### 9.2 `createWithDelivery` sem `afterCreate`

`createWithDelivery` cria pedido + entrega mas não dispara nenhum dos side-effects de `afterCreate`. A entrega é criada diretamente via `repo.createDelivery()` — o que evita a criação duplicada pelo auto-logistics. A solução é adicionar uma chamada explícita a `afterCreate` com o flag `skipDelivery: true`, ou refatorar `afterCreate` para aceitar "entrega já criada".

### 9.3 Atribuição de `userRole` no audit log de `afterCreate`

`afterCreate` hardcoda `userRole: "CLIENT"` para todos os caminhos. Com a R1, existem agora 3 origens distintas (cliente HTTP, cron, admin-scope). A assinatura de `afterCreate` não recebe contexto de origem.

**Solução**: adicionar parâmetro opcional `source?: string` a `afterCreate` e derivar `userRole` a partir dele.

### 9.4 `createInternal` recebe `items` originais no `afterCreate`

Tanto `create()` quanto `createInternal()` passam os `items` originais (pré-normalização) para `afterCreate`, mas persistem os `normalisedItems`. Isso é consistente mas cria uma assimetria conceitual: `afterCreate` recebe dados que diferem do que foi gravado.

Como `afterCreate` usa apenas `items.length` para notificações, não há bug funcional. Mas se `afterCreate` for expandida no futuro (ex: disparo de NF-e automático por item), isso pode causar divergências.

### 9.5 Tipagem fraca em `createInternal`

`Record<string, any>` para `order` e `Array<Record<string, any>>` para `items` oferecem zero segurança em tempo de compilação. Com a introdução de um tipo `SystemOrderInput` (subset de `InsertOrder` com os campos obrigatórios), erros de caller seriam detectados em compilação.

### 9.6 `storage.createOrder` como camada intermediária desnecessária

A cadeia atual é:
```
orders.service → orders.repository → storage.createOrder → db.insert
```

O `storage.ts` é uma camada legada que não tem propósito arquitetural — é um object com todos os métodos de todos os domínios misturados. O `orders.repository.ts` poderia usar `db` diretamente, eliminando uma indireção e tornando a cadeia de dependência explícita. Isso é uma refatoração maior (R3+), não pertence à R1.

---

## 10. Nota arquitetural da R1

### Coesão — **B+**

O `OrdersService` concentra toda a lógica de criação. `createInternal()` é coeso em propósito (criar pedido por sistema). A normalização duplicada reduz a coesão interna — dois lugares com a mesma responsabilidade dentro do mesmo serviço.

### Acoplamento — **B**

Acoplamento externo baixo: nenhum módulo fora de `orders/` chama o repositório diretamente. O acoplamento via `ordersService` singleton é adequado. A dependência de `companies.service` em `ordersService` é cross-domain e potencialmente circular se `OrdersService` precisar de `CompaniesService` no futuro. Deve ser monitorada.

### DDD — **B-**

`OrdersService` como aggregate root da criação ✅. Porém, `storage.ts` quebra o bounded context — todos os repositórios estão no mesmo objeto. A R1 não piora essa situação, mas também não avança na direção correta (que seria um `OrdersRepository` com `db` direto).

### SOLID — **B**

- **SRP**: `createInternal` e `create` partilham código de normalização — violação menor de SRP.
- **OCP**: novo caminho de criação adicionado sem modificar o existente ✅.
- **LSP**: não aplicável diretamente.
- **ISP**: `OrdersService` tem interface ampla — aceitável dado o tamanho do domínio.
- **DIP**: `OrdersService` depende de `OrdersRepository` via interface ✅; depende de `ordersRepository` singleton em vez de injeção ⚠️ (impede mock em testes sem workaround).

### Compatibilidade — **A**

Zero breaking changes. Nenhuma rota, payload, resposta HTTP, schema de banco ou permissão foi alterada. Compatibilidade total confirmada por TypeScript check (0 erros) e suite de testes (0 novas falhas).

### Testabilidade — **C+**

`createInternal()` é `public` ✅ — pode ser testado diretamente. Porém:
- `afterCreate` é `private` — side-effects não são testáveis isoladamente sem spy.
- `ordersService` é singleton — testes que importam o serviço não podem injetar mocks do repositório sem workaround.
- Não existe nenhum teste automatizado que valide que `createInternal` dispara `afterCreate`.

### Evolução futura — **B-**

A R1 criou uma boa fundação. Os riscos para evolução futura são:
1. Callers futuros podem usar `createInternal` sem implementar as guards que `create()` tem — contrato implícito.
2. `afterCreate` cresce junto com os side-effects sem um mecanismo de extensão estruturado (ex: event bus).
3. `createWithDelivery` permanece como um segundo caminho de criação com diferentes garantias.

---

## Veredicto final

### O que a R1 fez corretamente

- ✅ Eliminou os 3 bypasses externos identificados (`routes.ts`, `companies.service`, `recurring-orders.cron`)
- ✅ A persistência converge para um único ponto em produção
- ✅ Cron e `generateOrdersFromScope` agora recebem `afterCreate` completo
- ✅ Zero breaking changes, zero regressões

### O que a R1 não resolveu (pré-existente)

- ⚠️ `createWithDelivery` não executa `afterCreate` — pedidos admin não geram audit log, push ou email
- ⚠️ Normalização duplicada entre `create()` e `createInternal()`
- ⚠️ Atribuição `userRole: "CLIENT"` para pedidos gerados pelo sistema

### Condições para Release 1

Os ajustes abaixo são necessários antes do Release 1:

| # | Item | Criticidade |
|---|------|-------------|
| A | `createWithDelivery` deve executar `afterCreate` (ou subset compatível) | Alta — pedidos admin sem audit trail |
| B | Extrair `normaliseOrderInput()` privado para eliminar duplicação | Média |
| C | `afterCreate` deve receber `source` para corrigir `userRole` no audit log | Média |
| D | Verificar se o cron seta tenant antes de chamar `createInternal` | Alta — risco de erro silencioso |

---

## 🟡 R1 precisa de ajustes

A unificação da **persistência** foi atingida com sucesso. A unificação dos **side-effects** (`afterCreate`) não é completa: `createWithDelivery` permanece como um caminho ativo de criação sem audit log, push notification ou emails. O item D (tenant do cron) requer verificação urgente. Os demais ajustes são de qualidade interna e não bloqueiam funcionalidade mas devem ser resolvidos antes do Release 1 para garantir rastreabilidade e manutenibilidade.
