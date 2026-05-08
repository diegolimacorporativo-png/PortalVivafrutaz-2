# MT-3D — Evidência SQL (Análise de Queries)

**Data:** 2026-05-08  
**Metodologia:** grep massivo + leitura direta de código-fonte

---

## 1. Tenant Filter em Orders (Drizzle ORM)

Todos os principais paths de leitura de `orders` usam o helper `tenantWhere()` ou `eq(orders.companyId, requireTenantId())`:

```typescript
// server/modules/finance/finance.repository.ts:635
.where(eq(orders.companyId, requireTenantId()))

// server/modules/finance/finance.repository.ts:664
.where(eq(orders.companyId, requireTenantId()))

// server/modules/finance/finance.repository.ts:774
.where(and(eq(orders.companyId, requireTenantId()), ...))
```

---

## 2. Tenant Filter em fiscalInvoices (Drizzle ORM)

```typescript
// server/services/storage.ts:1751
.where(eq(fiscalInvoices.empresaId, tenantId))

// server/services/storage.ts:1758
.where(and(eq(fiscalInvoices.id, id), eq(fiscalInvoices.empresaId, tenantId)))

// server/services/storage.ts:1773
.where(and(eq(fiscalInvoices.duplicateKey, key), eq(fiscalInvoices.empresaId, tenantId)))
```

---

## 3. Tenant Filter em bankAccounts (Drizzle ORM)

Via `tenantContext` + `requireTenant` em `bank.routes.ts` — storage recebe `tenantId` como argumento explícito.

---

## 4. nfeEmissoes — Subquery de Ownership (Drizzle ORM)

```typescript
// server/services/storage.ts:2202-2214
async getNfeEmissoes(filters?: { orderId?: number; status?: string; companyId?: number }) {
  const conds: any[] = [];
  if (filters?.companyId) {
    conds.push(
      inArray(
        nfeEmissoes.orderId,
        db.select({ id: orders.id }).from(orders).where(eq(orders.companyId, filters.companyId)),
      ),
    );
  }
  // ...
}
```

Equivalente SQL:
```sql
WHERE order_id IN (SELECT id FROM orders WHERE company_id = $companyId)
```

---

## 5. NF-e Eligible — Raw SQL com Tenant Filter (MT-3C fix)

```typescript
// server/routes/routes.ts:~1191 (após fix MT-3C)
sql`
  SELECT o.id, o.company_id, o.status, ...
  FROM orders o
  LEFT JOIN customers c ON ...
  WHERE o.status != 'CANCELLED'
    AND o.fiscal_status = 'nota_liberada'
    AND o.delivery_date IS NOT NULL
    AND o.company_id = ${tenantId}    -- ← ADICIONADO MT-3C
`
```

---

## 6. validateOrderTenant — Guard de Posse de Pedido

```typescript
// server/core/security/tenantGuard.ts (uso em routes.ts)
await validateOrderTenant(nfe.orderId);
// Internamente: SELECT company_id FROM orders WHERE id = $orderId
// Se company_id !== currentTenantId() → AppError(403)
```

Chamado em:
- `GET /api/nfe/:id` (routes.ts:1242)
- `POST /api/nfe` e variantes (todas as rotas de emissão)
- `PATCH /api/nfe/:id` (routes.ts:2796)
- `GET /api/nfe/:id/assinar` (routes.ts:3007)

---

## 7. Auto-Dispatch — empresa_id Hard Filter

```sql
-- server/modules/logistics/auto-dispatch.service.ts
WHERE delivery_date = ${date}::date AND empresa_id = ${companyId}
WHERE empresa_id = ${companyId}
```

Aplicado ANTES de qualquer seleção de delivery, com `companyId` vindo do agrupamento por `(company_id, delivery_date)`.

---

## 8. Faturamento Cron — runWithTenant por Row

```typescript
// server/jobs/faturamento.cron.ts:219-231
const detalhes = await processInBatches(candidates, async (row) => {
  const tenantPrincipal: TenantPrincipal = {
    kind: "admin",
    empresaId: row.company_id,  // ← company_id do pedido
    userId: 0,
    role: "SERVICE",
  };
  return runWithTenant(
    { principal: tenantPrincipal, empresaId: row.company_id },
    async () => { ... }  // toda lógica roda no contexto correto
  );
});
```

---

## 9. continuousAudit — Queries de Schema (Sem Dados de Tenant)

```sql
-- Apenas queries de introspection:
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
-- Verificação de audit de tenant_id:
WHERE tenant_id IS NULL
-- Registro de finding:
WHERE type = ${finding.type}
```

Nenhuma query acessa tabelas de dados de negócio de tenants.
