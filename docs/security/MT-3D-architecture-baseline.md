# MT-3D — Baseline de Arquitetura Multi-Tenant

**Data:** 2026-05-08  
**Versão:** 1.0.0 (baseline oficial pós-MT-3)  
**Status:** Aprovado para produção multi-tenant

---

## 1. Modelo de Isolamento

VivaFrutaz usa **isolamento lógico** (sem RLS, sem schema por tenant):

- Uma única instância de banco de dados
- Uma coluna `company_id` (ou equivalente) na maioria das tabelas de negócio
- Isolamento enforçado **na camada de aplicação** via AsyncLocalStorage
- **Sem Row-Level Security** do PostgreSQL — escolha deliberada para simplicidade

---

## 2. Stack de Tenant Context

```
HTTP Request
    │
    ▼
requireAuthCore          ← verifica session.userId → retorna 401 se ausente
    │
    ▼
tenantContext (middleware)
    │  Lê: session.userId + session.companyId
    │  Resolve: getUser(userId) → user.empresaId ou query na tabela de membros
    │  Instala: runWithTenant({ principal, empresaId })
    │  Popula: AsyncLocalStorage com TenantContext
    ▼
Handler
    │  currentTenantId()    → retorna empresaId ou null (null-safe)
    │  requireTenantId()    → retorna empresaId ou lança 403
    │  tenantWhere(table)   → eq(table.companyId, requireTenantId())
    │  withTenant(t, data)  → { ...data, companyId: requireTenantId() }
    │  crossTenant()        → audit marker (sem throw)
    ▼
Storage Layer (Drizzle ORM)
    │  Queries Drizzle: .where(tenantWhere(orders))
    │  Raw SQL: AND company_id = ${requireTenantId()}
    ▼
PostgreSQL (Supabase)
```

---

## 3. Primitivas de Segurança

### 3.1 `tenantContext` Middleware
```typescript
// server/middleware/tenant.ts
export const tenantContext = async (req, res, next) => {
  // Resolve tenant a partir da sessão
  // Instala TenantContext via runWithTenant
  // Chama next() sempre — não bloqueia por si só
}
```
**Comportamento:** Instala contexto; não rejeita. Deve ser combinado com `requireTenant` ou `requireTenantId()` para enforcement.

### 3.2 `requireTenant` Middleware
```typescript
// server/middleware/tenant.ts
export const requireTenant = (req, res, next) => {
  requireTenantId(); // lança 403 se sem tenant
  next();
}
```

### 3.3 `requireTenantId()` Helper
Lança `AppError(403, "Tenant não identificado")` se sem contexto.  
Uso: dentro de handlers após `tenantContext`.

### 3.4 `crossTenant()` Marker
```typescript
// server/core/tenant/scope.ts:136
export function crossTenant(): void {
  // Registra no contexto que a operação é cross-tenant
  // Não lança; apenas para auditoria
}
```

### 3.5 `validateOrderTenant(orderId)` Guard
```typescript
// server/core/security/tenantGuard.ts
export async function validateOrderTenant(orderId: number): Promise<void> {
  const order = await db.select({ companyId: orders.companyId }).from(orders).where(eq(orders.id, orderId));
  if (!order[0] || order[0].companyId !== currentTenantId()) {
    throw new AppError(403, "Pedido não pertence ao tenant atual");
  }
}
```

---

## 4. Tabelas e Estratégia de Isolamento

| Tabela | Coluna Tenant | Estratégia |
|---|---|---|
| `orders` | `company_id` | tenantWhere() / requireTenantId() |
| `order_items` | Via orders | JOIN com orders.company_id |
| `customers` | `company_id` | tenantWhere() |
| `products` | Global (catálogo compartilhado) | Sem tenant — intencional |
| `fiscal_invoices` | `empresa_id` | tenantWhere() |
| `bank_accounts` | Via tenant context | requireTenant middleware |
| `deliveries` | `company_id` | Filtro explícito |
| `logistics_routes` | Nenhuma direta | Scoped por route/driver ID |
| `nfe_emissoes` | Nenhuma direta | Via orders.company_id (subquery) |
| `workflow_events` | `payload.companyId` | runWithTenant por evento |
| `system_alerts` | Nenhuma | Sistema-global; gateado por role |
| `system_policies` | Nenhuma | Sistema-global; gateado por role |
| `audit_logs` | Nenhuma | Sistema-global; gateado por role |
| `cron_alert_logs` | Nenhuma | Sistema-global; gateado por role + crossTenant() |

---

## 5. Roles e Autorizações

| Role | Escopo de Dados | Pode Ver Cross-Tenant? |
|---|---|---|
| `MASTER` | Tudo | Sim |
| `ADMIN` | Empresa própria + recursos admin | Parcialmente (admin views) |
| `DIRECTOR` | Empresa própria | Não (exceto admin views) |
| `DEVELOPER` | Sistema | Sim (read-only) |
| `OPERATIONS_MANAGER` | Empresa própria | Não |
| `LOGISTICS` | Empresa própria (logística) | Não |
| `FINANCE` | Empresa própria (financeiro) | Não |
| `PURCHASE_MANAGER` | Empresa própria (compras) | Não |
| `GESTOR_CONTRATOS` | Contratos multi-empresa | Parcialmente |
| `NUTRICIONISTA` | Sanitário da empresa | Não |
| `MANAGER` | Empresa própria | Não |
| `SERVICE` | Interno (jobs background) | Sim (via runWithTenant) |

---

## 6. Jobs de Background — Padrão de Tenant

Todos os jobs que processam dados multi-tenant seguem o padrão:

```typescript
// Para cada item com company_id:
return runWithTenant(
  { principal: { kind: "admin", empresaId: item.company_id, role: "SERVICE" }, empresaId: item.company_id },
  async () => {
    // toda lógica roda aqui com tenant context correto
    // currentTenantId() retorna item.company_id
    // requireTenantId() retorna item.company_id
  }
);
```

Jobs que seguem esse padrão:
- `faturamento.cron.ts` — emissão automática de NF-e
- `auto-dispatch.service.ts` — despacho automático de logística (usa empresa_id direto nas queries)
- `orders.outbox.worker.ts` — processamento de workflow events

---

## 7. Decisões de Arquitetura

| Decisão | Motivo |
|---|---|
| AsyncLocalStorage (não middleware chain) | Evita prop-drilling de tenantId por toda a stack |
| Sem RLS PostgreSQL | Simplicidade; enforcement na aplicação é suficiente |
| tenantContext = instala, requireTenant = enforça | Separação de concerns; permite rotas opcionais |
| crossTenant() como marker (não throw) | Admin precisa acessar cross-tenant legitimamente |
| nfeEmissoes sem coluna tenant | NF-e ownership inferida via orders — não muda schema |
| getNextNfeNumero() global | NF-e numbers são sequenciais no sistema inteiro |

---

## 8. Invariantes de Segurança

As seguintes invariantes DEVEM ser mantidas ao adicionar novas rotas:

1. **Toda rota que acessa dados de tenant DEVE ter `tenantContext` antes do handler**
2. **Toda rota que REQUER um único tenant DEVE ter `requireTenant` ou chamar `requireTenantId()`**
3. **Toda rota cross-tenant DEVE ter `requireRole(['MASTER',...])` E `crossTenant()`**
4. **Novos callers de `getNfeEmissao(id)` DEVEM chamar `validateOrderTenant` antes de retornar dados**
5. **Novos jobs de background DEVEM usar `runWithTenant({ empresaId: row.company_id })` por item**
6. **Queries raw SQL em tabelas com company_id DEVEM incluir `AND company_id = ${requireTenantId()}`**
