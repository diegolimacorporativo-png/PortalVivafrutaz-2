# MT-3C — Hardening Final: Relatório de Auditoria de Tenant Isolation

**Data:** 2026-05-08  
**Fase:** MT-3C (conclusão do ciclo Multi-Tenant 3)  
**Status:** CONCLUÍDO — todos os gaps reais corrigidos, servidor rodando limpo  
**DB:** Supabase (produção) — conectado com SSL

---

## 1. Metodologia

Auditoria completa em dois passos:

1. **Leitura silenciosa** — grep massivo em paralelo antes de qualquer mudança para mapear todos os sites de risco.
2. **Correção cirúrgica** — apenas gaps reais corrigidos; zero refactors desnecessários, zero schema migrations, zero mudanças de frontend.

---

## 2. Validação de Acesso Anônimo (Live)

Todos os endpoints críticos retornam **401** para chamadas sem sessão:

| Endpoint | Status |
|---|---|
| `GET /api/orders` | 401 ✅ |
| `GET /api/products` | 401 ✅ |
| `GET /api/executive-dashboard` | 401 ✅ |
| `GET /api/assistant/history` | 401 ✅ |
| `GET /api/nfe/preflight/1` | 401 ✅ |
| `GET /api/clara-training` | 401 ✅ |
| `GET /api/master/modulos-sistema` | 401 ✅ |
| `GET /api/nfe/eligible` | 401 ✅ |
| `GET /api/contracts/alerts` | 401 ✅ |
| `GET /api/cron/alerts/analytics` | 401 ✅ |
| `GET /api/cron/alerts/logs` | 401 ✅ |

---

## 3. Inventário de crossTenant() — 11 call sites

Todos os reads cross-tenant intencionais são marcados com `void crossTenant()` para auditoria por grep:

| Arquivo | Linha | Guard | Justificativa |
|---|---|---|---|
| `assistant.routes.ts` | 71 | `isInternal` (MASTER/ADMIN) | Clara interna cross-tenant |
| `contracts-alerts.routes.ts` | 13 | `requireRole(['MASTER','ADMIN','DIRECTOR'])` | Scan de todos os contratos |
| `executive-dashboard.routes.ts` | 22 | `requireRole(['MASTER'], {strict:true})` | KPIs executivos globais |
| `order-cleanup.routes.ts` | 18 | `requireRole(['MASTER','ADMIN','DIRECTOR','DEVELOPER'])` | Limpeza admin global |
| `order-cleanup.routes.ts` | 32 | idem | idem |
| `routes.ts` | 1057 | `requireRole(['ADMIN'])` | Import/execute global |
| `routes.ts` | 1062 | idem | idem |
| `routes.ts` | 1591 | `requireRole(['MASTER','ADMIN','DIRECTOR'])` | `cron_alert_logs` (sem coluna de tenant) |
| `routes.ts` | 1628 | idem | Analytics de alertas |

---

## 4. Gaps Encontrados e Corrigidos

### 4.1 MEDIUM — `GET /api/clara-training` sem requireRole

**Arquivo:** `server/routes/clara.routes.ts` linha 223  
**Problema:** `requireAuthCore` apenas — qualquer usuário autenticado (inclusive portais de empresa via `userId`) podia ler todo o banco de treinamento da Clara (perguntas + respostas).  
**Correção:** Adicionado `requireRole(['MASTER', 'ADMIN', 'DEVELOPER', 'DIRECTOR'])` no middleware da rota GET.  
**Referência:** MT-3C H5

---

### 4.2 MEDIUM — `GET /api/nfe/eligible` sem tenantContext

**Arquivo:** `server/routes/routes.ts` linha 1419  
**Problema:** Rota com `requireRole(["ADMIN", "FISCAL", "DIRECTOR"])` (roles per-tenant) mas sem `tenantContext` e sem filtro de `company_id` no SQL — um ADMIN de qualquer empresa via sessão poderia ver os pedidos elegíveis para NF-e de **todos os tenants**.  
**Correção:** Adicionado `tenantContext` no middleware e `AND o.company_id = ${tenantId}` na cláusula WHERE do SQL raw.  
**Referência:** MT-3C H6

---

### 4.3 MEDIUM — `GET /api/contracts/alerts` sem requireRole

**Arquivo:** `server/routes/contracts-alerts.routes.ts` linha 7  
**Problema:** `requireAuthCore` apenas — `storage.getCompanies()` é cross-tenant. Qualquer usuário autenticado (FINANCEIRO, LOGISTICS, DRIVER) podia ver alertas de contratos de **todos os clientes** (vencimentos, inadimplência).  
**Correção:** Adicionado `requireRole(['MASTER', 'ADMIN', 'DIRECTOR'])` + `void crossTenant()` marker.  
**Referência:** MT-3C H7

---

### 4.4 LOW — `GET /api/master/modulos-sistema` sem requireRole

**Arquivo:** `server/routes/master.routes.ts` linha 153  
**Problema:** `requireAuthCore` apenas, retornando o catálogo estático de módulos do sistema. Sem dados de banco, mas inconsistente com a convenção `/api/master/*` (MASTER-only).  
**Correção:** Adicionado `requireRole(['MASTER', 'ADMIN', 'DEVELOPER', 'DIRECTOR'])` por consistência.  
**Referência:** MT-3C L1

---

### 4.5 MARKER — `executive-dashboard.routes.ts` sem crossTenant()

**Arquivo:** `server/routes/executive-dashboard.routes.ts`  
**Problema:** Reads cross-tenant (`db.select().from(orders)`, `storage.getCompanies()`, `storage.getProducts()`) sem marker de auditoria. Já estava corretamente protegido com `requireRole(['MASTER'], { strict: true })`.  
**Correção:** Adicionado `import { crossTenant }` + `void crossTenant()` no corpo do handler.  
**Referência:** MT-3C M1

---

### 4.6 MARKER — `cron_alert_logs` sem crossTenant()

**Arquivo:** `server/routes/routes.ts` linhas 1591 e 1628  
**Problema:** `cron_alert_logs` é tabela de sistema sem coluna de tenant — reads são cross-tenant por design mas sem marker de auditoria.  
**Correção:** `void crossTenant()` adicionado em ambas as rotas (`/api/cron/alerts/logs` e `/api/cron/alerts/analytics`).  
**Referência:** MT-3C M2

---

## 5. Sites Auditados e Aprovados (sem alteração)

| Componente | Conclusão |
|---|---|
| `backup.ts` / `backup.routes.ts` | Cross-tenant por design (backup); gated `requireRole(['MASTER','ADMIN','DEVELOPER','DIRECTOR'])` ✅ |
| `incidents.routes.ts` GET `/api/client-incidents` | `requireSessionOrCompany` + inline role check; companies veem apenas os seus ✅ |
| `incidents.routes.ts` PATCH/DELETE/POST | Inline role check em todos os handlers ✅ |
| `empresa-config.routes.ts` | Inline role check (MASTER/ADMIN/DEVELOPER/DIRECTOR) ✅ |
| `company-validate.routes.ts` | Inline role check ✅ |
| `about-us.routes.ts` | GET: `requireSessionOrCompany`; PUT: inline role check ✅ |
| `search.routes.ts` | `tenantContext` + `currentTenantId()` + SQL `WHERE empresa_id = ${tenantId}` ✅ |
| `certificates.routes.ts` cross-tenant | `requireRole(['MASTER'])` + comentário ✅ |
| `logistics.routes.ts` deliveries | Scoped por routeId/driverId; role check inline via `isDriverOrInternal` ✅ |
| `workflowEvents` INSERT | `companyId` SEMPRE de `orderSnapshot.companyId` (linha 521) ✅ |
| `outbox worker` SELECT | Cross-tenant por design; fail-safe em `payload.companyId` (skip se null) ✅ |
| `orders.transaction.ts` outboxPayload | `companyId: orderSnapshot.companyId` — nunca undefined ✅ |
| `routes.ts` import-execute | `crossTenant()` markers presentes (MT-3B M4) ✅ |
| `assistant.routes.ts` isInternal | `crossTenant()` marker presente (MT-3B M4) ✅ |
| `pricing.routes.ts` | `tenantContext` presente (MT-3B H2) ✅ |
| `assistant.routes.ts` POST /chat | `tenantContext` + `currentTenantId()` (MT-3B M1) ✅ |

---

## 6. WorkflowEvents — Auditoria de Fluxo

**INSERT** (único site): `orders.transaction.ts` linha 537  
- `companyId` sempre preenchido de `orderSnapshot.companyId` — pedidos sempre têm `companyId` válido antes da transação ser aceita.  
- INSERT dentro da mesma transação — rollback automático se a transação falhar (zero eventos fantasma).

**SELECT** (outbox worker): `orders.outbox.worker.ts` linha 86  
- Scan global intencional (worker de sistema).  
- Fail-safe na linha 100: eventos sem `payload.companyId` são pulados (`continue`).  
- `runWithTenant(companyId, ...)` pina o contexto antes de qualquer operação de dispatch.

**Risco estrutural documentado (fora do escopo MT-3C):** `workflow_events` não tem coluna `tenant_id` direta — isolamento via `payload.companyId`. Migração futura recomendada.

---

## 7. requireRole() — Cobertura Final

Padrão de proteção por camada (da mais forte para aceitável):

1. **requireRole middleware** (ideal): bloqueia antes de executar handler.  
2. **Inline role check** (`storage.getUser` + array includes): aceitável onde middleware causaria refactor excessivo; retorna 403 antes de qualquer efeito colateral.  
3. **requireSessionOrCompany** (hybrid endpoints): correto para endpoints que atendem portal de clientes + usuários internos com lógica de scoping diferenciada.

Todos os endpoints críticos estão na camada 1 ou 2. Nenhum endpoint acessível por usuários autenticados retorna dados de outros tenants sem `crossTenant()` explícito + guard de role.

---

## 8. TypeScript

`npm run check` executado pós-mudanças. Os erros existentes são **pré-existentes** em arquivos não modificados (`quotations.routes.ts`, `security.routes.ts`, `settings.routes.ts`, `tasks.routes.ts`, `shared/schema.ts`). Nenhum erro novo introduzido pelas correções de MT-3C.

---

## 9. Resumo Executivo

| Categoria | Qtd | Status |
|---|---|---|
| Gaps MEDIUM corrigidos | 3 | ✅ |
| Gaps LOW corrigidos | 1 | ✅ |
| Markers de auditoria adicionados | 3 | ✅ |
| crossTenant() call sites totais | 9 (code) | ✅ |
| Endpoints anônimos bloqueados (401) | 11 testados | ✅ |
| Schema changes | 0 | — |
| Frontend changes | 0 | — |
| Migrations | 0 | — |

**Ciclo MT-3 (3A + 3B + 3C) concluído.** O sistema tem isolamento de tenant via AsyncLocalStorage + tenantWhere + crossTenant markers cobrindo 100% dos reads cross-tenant identificados. A única fragilidade estrutural restante (coluna `tenant_id` em `workflow_events`) está documentada e dentro do controle via `payload.companyId` + fail-safe no worker.
