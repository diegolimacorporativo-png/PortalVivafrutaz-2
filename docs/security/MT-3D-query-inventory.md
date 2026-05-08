# MT-3D — Inventário de Queries Raw SQL

**Data:** 2026-05-08  
**Metodologia:** grep `db.execute(sql\`...\`)` em todos os arquivos `.ts` do server/

---

## Sites de SQL Raw Identificados

### 1. `server/jobs/faturamento.cron.ts:191`

```sql
SELECT o.id, o.company_id
FROM orders o
WHERE o.status != 'CANCELLED'
  AND o.fiscal_status = 'nota_liberada'
  AND o.delivery_date IS NOT NULL
LIMIT 500
```

**Tenant scoping:** Nenhum — varredura global intencional.  
**Mitigação:** Para cada linha, `runWithTenant({ empresaId: row.company_id })` instala tenant context antes de qualquer lógica de emissão (linha 230).  
**Risco:** NONE — design correto para cron cross-tenant.

---

### 2. `server/modules/logistics/auto-dispatch.service.ts:98`

```sql
-- Múltiplos fragmentos, todos com:
WHERE delivery_date = ${date}::date AND empresa_id = ${companyId}
-- e:
WHERE empresa_id = ${companyId}
```

**Tenant scoping:** `empresa_id = ${companyId}` — HARD filter.  
**Agrupamento:** por `(company_id, delivery_date)` — FASE 8.6I.  
**Linhas sem company_id:** puladas explicitamente (log + skip).  
**Risco:** NONE — corretamente isolado.

---

### 3. `server/modules/logistics/logistics.controller.ts:557,575,585,605`

```sql
-- Route detail (routeId param):
WHERE lr.id = ${routeId}                    -- routes by ID
WHERE route_id = ${routeId}                 -- stops by route
WHERE d.route_id = ${routeId}               -- deliveries by route
WHERE driver_id = ${route.driver_id}        -- GPS by driver
```

**Tenant scoping:** Nenhum coluna de tenant — scoped por `routeId` (chave funcional).  
**Auth gate:** handler-level session check + role check (logAuth pattern).  
**Observação:** `routeId` não é inferível sem autenticação. Riscos de IDOR teórico documentados em residual risks.  
**Risco:** LOW — gateado por auth, mas sem isolamento tenant explícito por routeId.

---

### 4. `server/core/security/continuousAudit.ts:37,51,77,114`

```sql
-- Schema introspection (não acessa dados de negócio):
SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public'

-- Audit de tabelas sem tenant_id:
WHERE tenant_id IS NULL

-- Registro de finding de auditoria:
WHERE type = ${finding.type}
```

**Tenant scoping:** N/A — queries de meta-informação de schema.  
**Nenhum dado de tenant acessado.**  
**Risco:** NONE — auditoria interna de sistema.

---

### 5. `server/routes/routes.ts:1191` (nfe/eligible — MT-3C fix)

```sql
SELECT o.id, o.company_id, o.status, ...
FROM orders o
LEFT JOIN customers c ON ...
WHERE o.status != 'CANCELLED'
  AND o.fiscal_status = 'nota_liberada'
  AND o.delivery_date IS NOT NULL
  AND o.company_id = ${tenantId}    -- ← ADICIONADO MT-3C
```

**Tenant scoping:** `company_id = ${tenantId}` — HARD filter.  
**Contexto:** tenantContext middleware precedido; requireTenantId() lança 403 se ausente.  
**Risco:** NONE — corretamente isolado.

---

### 6. `server/routes/routes.ts:1591,1628` (cron alert logs)

```sql
-- Leitura de cron_alert_logs (sistema, sem tenant):
SELECT * FROM cron_alert_logs ORDER BY created_at DESC LIMIT 100
SELECT * FROM cron_alert_logs WHERE id = ${id}
```

**Tenant scoping:** Nenhum — tabela de sistema.  
**Gate:** requireRole([MASTER,ADMIN,DIRECTOR]) + crossTenant() marker.  
**Risco:** NONE — sistema-level, gateado.

---

## Sumário de Risco por Site

| Site | Arquivo | Tenant Filter | Risco |
|---|---|---|---|
| faturamento.cron:191 | faturamento.cron.ts | runWithTenant por row | NONE |
| auto-dispatch:98 | auto-dispatch.service.ts | empresa_id = companyId | NONE |
| logistics.controller:557 | logistics.controller.ts | routeId (funcional) | LOW |
| continuousAudit:37,51,77,114 | continuousAudit.ts | N/A (schema info) | NONE |
| routes.ts:1191 | routes.ts | company_id = tenantId | NONE |
| routes.ts:1591,1628 | routes.ts | sistema — crossTenant() | NONE |

**Total de sites raw SQL:** 6 locais, 10+ queries individuais  
**Sites com risco residual:** 1 (logistics routeId — LOW)
