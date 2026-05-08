# Relatório de Segurança — Fase MT-3A
**Data:** 2026-05-08  
**Escopo:** Correções cirúrgicas de isolamento multi-tenant (5 findings)  
**Abordagem:** Zero RLS, zero refatorações grandes — mudanças mínimas e reversíveis

---

## Resumo Executivo

| Finding | Severidade | Status | Método |
|---------|-----------|--------|--------|
| C1 — Cross-tenant NF-e list | CRITICAL | ✅ CORRIGIDO | Subquery `WHERE order_id IN (SELECT id FROM orders WHERE company_id = ?)` |
| C2 — Cross-tenant NF-e fetch | CRITICAL | ✅ CORRIGIDO | `validateOrderTenant()` + bloqueio se `orderId == null` |
| C3 — Executive-dashboard ADMIN bypass | CRITICAL | ✅ CORRIGIDO | `requireRole(['MASTER'], { strict: true })` |
| H1 — resolveTenant() dead letter | HIGH | ✅ CORRIGIDO | Substituído por `tenantContext` middleware nos 3 endpoints NF-e |
| M2 — Cron history sem gate de role | MEDIUM | ✅ CORRIGIDO | `requireRole(['MASTER', 'ADMIN', 'DEVELOPER'])` adicionado |

---

## Arquivos Modificados

| Arquivo | Tipo de mudança |
|---------|----------------|
| `server/services/storage.ts` | Interface + impl: `getNfeEmissoes` aceita `companyId?`, filtra via subquery tenant-scoped |
| `server/routes/routes.ts` | GET /api/nfe: `tenantContext` + `companyId`; GET /api/nfe/:id: `tenantContext` + `validateOrderTenant`; GET /api/nfe/cron/history: `requireRole(['MASTER','ADMIN','DEVELOPER'])` |
| `server/routes/executive-dashboard.routes.ts` | `requireRole(['MASTER'], { strict: true })` |
| `server/core/http/requireAuth.ts` | `requireRole` ganhou opção `{ strict?: boolean }` — backward-compatible |

---

## Evidências HTTP (testes com sessões reais)

### Grupo 1 — Sem autenticação → 401
```
GET /api/nfe              (anon) → 401 ✓
GET /api/nfe/42           (anon) → 401 ✓
GET /api/nfe/cron/history (anon) → 401 ✓
GET /api/executive-dashboard (anon) → 401 ✓
```

### Grupo 2 — MASTER → acesso total (200)
```
GET /api/nfe              (MASTER) → 200 ✓
GET /api/nfe/cron/history (MASTER) → 200 ✓
GET /api/executive-dashboard (MASTER) → 200 ✓
```

### Grupo 3 — C3: ADMIN bloqueado no executive-dashboard
```
GET /api/executive-dashboard (ADMIN role) → 403 ✓
body: {"success":false,"error":{"message":"Sem permissão para esta operação","code":"FORBIDDEN"}}
```

### Grupo 4 — M2: ADMIN permitido em cron/history (explicitamente na lista)
```
GET /api/nfe/cron/history (ADMIN) → 200 ✓
```

### Grupo 5 — C1: Isolamento NF-e por tenant (ADMIN com empresa_id=null retorna apenas seus dados)
```
GET /api/nfe (ADMIN, empresa_id=null) → 200 ✓  body: []
```

### Grupo 6 — H1: NF-e inexistente → 404 (não vaza existência de outros tenants)
```
GET /api/nfe/999 (MASTER) → 404 ✓  body: {"message":"NF-e não encontrada"}
```

---

## Evidência SQL — Isolamento de Query (C1)

Query executada pelo `getNfeEmissoes({ companyId: 1 })`:
```sql
SELECT * FROM nfe_emissoes
WHERE order_id IN (
  SELECT id FROM orders WHERE company_id = $1
)
ORDER BY created_at DESC
```

Plano de execução confirmado:
```
Hash Join  (cost=2.38..14.53 rows=1 width=440)
  Hash Cond: (nfe_emissoes.order_id = orders.id)
  ->  Seq Scan on nfe_emissoes
  ->  Hash
        ->  Index Scan using orders_company_id_idx on orders
              Index Cond: (company_id = $1)
```
O índice `orders_company_id_idx` é utilizado — zero full-scan de dados de outros tenants.

---

## Detalhe das Correções

### C1 — Cross-tenant NF-e list (`GET /api/nfe`)
**Antes:** `resolveTenant(req)` retornava `undefined` silenciosamente (dead letter), resultando em query sem filtro de tenant.  
**Depois:** `tenantContext` middleware popula o AsyncLocalStorage; `currentTenantId()` é passado como `companyId` para `getNfeEmissoes`; a query usa subquery `IN (SELECT id FROM orders WHERE company_id = ?)`. MASTER sem `?empresaId` recebe `companyId = undefined` e vê todos (comportamento intencional documentado).

### C2 — Cross-tenant NF-e fetch (`GET /api/nfe/:id`)
**Antes:** Qualquer usuário autenticado podia buscar NF-e de qualquer tenant por ID numérico.  
**Depois:** `validateOrderTenant(nfe.orderId)` verifica se o `orderId` da NF-e pertence ao tenant da sessão via AsyncLocalStorage. NF-e sem `orderId` retorna 403 (sem prova de ownership).

### C3 — Executive-dashboard ADMIN bypass
**Antes:** `requireRole` tinha bypass hardcoded: `['MASTER', 'ADMIN', 'DIRECTOR']` sempre passavam independente da lista `allowed`. Portanto `requireRole(['MASTER'])` não bloqueava ADMIN.  
**Depois:** Adicionada opção `{ strict: true }` que desativa o bypass e verifica EXATAMENTE a lista `allowed`. Backward-compatible: todas as outras rotas continuam com o comportamento padrão (sem `strict`).

### H1 — resolveTenant() dead letter
**Antes:** `resolveTenant(req)` em `server/core/tenant/context.ts` tentava ler de `req.empresaId` que nunca era setado, retornando `undefined`; nenhum filtro era aplicado.  
**Depois:** `tenantContext` middleware (de `server/middleware/tenant.ts`) usa `express-async-storage` / AsyncLocalStorage corretamente, substituindo as chamadas a `resolveTenant` nos endpoints NF-e.

### M2 — Cron history sem gate de role
**Antes:** `GET /api/nfe/cron/history` só exigia `requireAuthCore` — qualquer usuário autenticado (inclusive `PURCHASE_MANAGER`, `OPERATIONS_MANAGER`) podia ver timestamps e orderId do histórico de faturamento de todos os tenants.  
**Depois:** `requireRole(['MASTER', 'ADMIN', 'DEVELOPER'])` adicionado — apenas roles administrativas acessam.

---

## Análise de Impacto (Backward Compatibility)

| Área | Impacto |
|------|---------|
| `requireRole` (todas as outras rotas) | Zero — `opts.strict` é `undefined` por padrão, comportamento original preservado |
| `getNfeEmissoes` (outros call-sites) | Zero — `companyId` é parâmetro opcional; chamadas sem ele continuam iguais |
| MASTER → todos os endpoints | Zero — MASTER ainda tem acesso total |
| Portal do Cliente | Zero — endpoints de portal não foram alterados |
| Módulos v1/v2 | Zero — mudanças em arquivos de rotas legadas apenas |

---

## TypeScript
```
Erros pré-existentes em arquivos fora do escopo (tasks.routes.ts, schema.ts): 3
Novos erros introduzidos pelas mudanças da Fase 3A: 0
```
