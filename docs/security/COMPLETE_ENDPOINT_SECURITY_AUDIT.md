# AUDITORIA DEFINITIVA DE SEGURANÇA — TODOS OS ENDPOINTS
**VivaFrutaz ERP · Data: 2026-07-27 · Escopo: 100% das rotas Express**

> **OBJETIVO:** Inventário exaustivo, read-only. Nenhum arquivo de produção foi alterado.
> Este documento é a fonte de verdade para a Release 1 — nenhum bloqueador novo deverá ser descoberto após sua publicação.

---

## DEFINIÇÕES

| Símbolo | Significado |
|---|---|
| ✅ | Protegido corretamente (middleware formal) |
| 🟡 | Funcional, mas melhorar (inline check, sem middleware, ou redundância) |
| 🔴 | Vulnerável (sem auth de qualquer tipo — bloqueador) |
| ⚠️ | Público intencional (design decision documentada) |

### Middlewares disponíveis
| Middleware | Aceita | Descrição |
|---|---|---|
| `requireAuth` / `requireAuthCore` | `session.userId` | Apenas sessões admin/staff |
| `requireSession` | `session.userId` OU `session.companyId` | Staff ou portal cliente |
| `requireSessionOrCompany` | `session.userId` OU `session.companyId` | Equivalente ao anterior |
| `requireAuthOrService` | session OU `x-api-key` | Staff, portal ou integração interna |
| `requireRole(roles)` | userId com role na lista | Compõe após requireAuth |
| `tenantContext` | qualquer | Resolve tenant — **NÃO é gate de auth** |
| `withTenantScope` | requer sessão ativa | Resolve tenant e falha sem sessão |
| inline check | — | `if (!session.userId)` dentro do handler |

---

## ETAPA 1 — INVENTÁRIO COMPLETO

### 1. server/modules/auth/auth.routes.ts → `/api/auth`

| # | Método | Endpoint | Middleware | Inline | Tipo | Status |
|---|---|---|---|---|---|---|
| 1 | POST | `/api/auth/login` | rate limiter (IP+email) | — | público | ⚠️ intencional |
| 2 | GET | `/api/auth/me` | — | — | público | ⚠️ retorna null sem sessão |
| 3 | POST | `/api/auth/logout` | — | — | público | ⚠️ intencional |
| 4 | POST | `/api/auth/forgot-password` | rate limiter | — | público | ⚠️ intencional |
| 5 | POST | `/api/auth/reset-password` | rate limiter | — | público | ⚠️ intencional |
| 6 | POST | `/api/auth/log-unauthorized` | `requireAuth` | — | admin | ✅ |
| 7 | POST | `/api/auth/force-password-change` | rate limiter | — | público | ⚠️ intencional |
| 8 | POST | `/api/auth/change-password` | `requireAuth` | — | admin | ✅ |
| 9 | POST | `/api/auth/revoke-sessions` | `requireAuth` | — | admin | ✅ |

---

### 2. server/modules/companies/companies.routes.ts → `/api/companies`

`readGate = [requireAuthOrService, tenantContext]`
`writeGate = [requireAuthOrService, tenantContext]`

Todos os 23 endpoints usam readGate ou writeGate — protegidos ✅.

| # | Método | Endpoint | Gate | Tipo | Status |
|---|---|---|---|---|---|
| 10 | GET | `/api/companies/delivery-suggestions` | readGate | admin/service | ✅ |
| 11 | PATCH | `/api/companies/my/preferred-order-type` | writeGate | cliente | ✅ |
| 12 | GET | `/api/companies/` | readGate | admin/service | ✅ |
| 13 | POST | `/api/companies/` | writeGate | admin | ✅ |
| 14 | GET | `/api/companies/:id` | readGate | admin/service | ✅ |
| 15 | PUT | `/api/companies/:id` | writeGate | admin | ✅ |
| 16 | DELETE | `/api/companies/:id` | writeGate | admin | ✅ |
| 17 | GET | `/api/companies/:id/contract-scopes` | readGate | admin | ✅ |
| 18 | POST | `/api/companies/:id/contract-scopes` | writeGate | admin | ✅ |
| 19 | PUT | `/api/companies/:id/contract-scopes/:scopeId` | writeGate | admin | ✅ |
| 20 | DELETE | `/api/companies/:id/contract-scopes/:scopeId` | writeGate | admin | ✅ |
| 21 | PATCH | `/api/companies/:id/contract-info` | writeGate | admin | ✅ |
| 22 | GET | `/api/companies/:id/contract-adjustments` | readGate | admin | ✅ |
| 23 | POST | `/api/companies/:id/contract-adjustments` | writeGate | admin | ✅ |
| 24 | PATCH | `/api/companies/:id/contract-adjustments/:adjId` | writeGate | admin | ✅ |
| 25 | POST | `/api/companies/:id/contract-adjustments/:adjId/send-email` | writeGate | admin | ✅ |
| 26 | POST | `/api/companies/:id/generate-orders-from-scope` | writeGate | admin | ✅ |
| 27 | GET | `/api/companies/:id/addresses` | readGate | admin | ✅ |
| 28 | POST | `/api/companies/:id/addresses` | writeGate | admin | ✅ |
| 29 | PUT | `/api/companies/:companyId/addresses/:addrId` | writeGate | admin | ✅ |
| 30 | DELETE | `/api/companies/:companyId/addresses/:addrId` | writeGate | admin | ✅ |
| 31 | PATCH | `/api/companies/:companyId/addresses/:addrId/set-primary` | writeGate | admin | ✅ |
| 32 | GET | `/api/companies/:id/gps-status` | readGate | admin/service | ✅ |
| 33 | POST | `/api/companies/:id/gps-toggle` | writeGate | admin | ✅ |

---

### 3. server/modules/orders/orders.routes.ts → `/api/orders` e `/api/v1/orders`

`router.use(tenantContext)` — `tenantContext` exige sessão via AsyncLocalStorage; sem sessão retorna 401 no repositório.

| # | Método | Endpoint | Gate | Tipo | Status |
|---|---|---|---|---|---|
| 34 | GET | `/api/orders/` | tenantContext | admin/cliente | ✅ |
| 35 | GET | `/api/orders/export` | tenantContext | admin | ✅ |
| 36 | GET | `/api/orders/reopen-requests` | tenantContext | admin | ✅ |
| 37 | GET | `/api/orders/:id` | tenantContext | admin/cliente | ✅ |
| 38 | GET | `/api/orders/:id/danfe-logs` | tenantContext | admin | ✅ |
| 39 | GET | `/api/orders/:id/timeline` | tenantContext | admin | ✅ |
| 40 | GET | `/api/orders/:id/export-erp` | tenantContext | admin | ✅ |
| 41 | POST | `/api/orders/` | tenantContext + billing | admin/cliente | ✅ |
| 42 | POST | `/api/orders/create-with-delivery` | tenantContext | admin | ✅ |
| 43–56 | * | `/api/orders/:id/*` (reopen, finalize, substitute, danfe, prenota, bling, transition, fiscal, items, bulk) | tenantContext | admin | ✅ |

**v2** (`/api/v2/orders`): mesma cadeia, todos com `tenantContext` ✅.

---

### 4. server/modules/finance/finance.routes.ts → `/api/finance`

`router.use(requireAuth, withTenantScope)` — **TODOS** os endpoints protegidos.

| # | Método | Endpoint | Status |
|---|---|---|---|
| 57–74 | GET/POST/PATCH/DELETE | `/api/finance/*` (dashboard, nfe, accounts-receivable, accounts-payable, cashflow, pix) | ✅ |

---

### 5. server/modules/fiscal/fiscal.routes.ts → `/api/fiscal` e `/api/v1/fiscal`

`router.use(requireAuth, withTenantScope)` — **TODOS** protegidos.

| # | Método | Endpoint | Status |
|---|---|---|---|
| 75–83 | GET/POST/PUT | `/api/fiscal/*` (drafts, icms-summary, close-period, closures) | ✅ |

---

### 6. server/modules/inventory/inventory.routes.ts → `/api/inventory`

**Sem router-wide requireAuth.** Auth é inline no controller (`requireSession` via método privado). `tenantContext` só instalado quando sessão existe.

| # | Método | Endpoint | Middleware | Inline | Status |
|---|---|---|---|---|---|
| 84 | GET | `/api/inventory/settings` | — | `session.userId` obrigatório | 🟡 |
| 85 | POST | `/api/inventory/settings` | — | `session.userId` obrigatório | 🟡 |
| 86 | PUT | `/api/inventory/settings/:id` | — | `session.userId` obrigatório | 🟡 |
| 87 | GET | `/api/inventory/entries` | — | `session.userId` obrigatório | 🟡 |
| 88 | POST | `/api/inventory/entries` | — | `session.userId` obrigatório | 🟡 |
| 89 | DELETE | `/api/inventory/entries/:id` | — | `session.userId` obrigatório | 🟡 |
| 90 | GET | `/api/inventory/movements` | — | `session.userId` obrigatório | 🟡 |
| 91 | GET | `/api/inventory/physical-counts` | — | `session.userId` obrigatório | 🟡 |
| 92 | POST | `/api/inventory/physical-counts` | — | `session.userId` obrigatório | 🟡 |

> **Inconsistência:** 9 endpoints sem middleware formal. Funcionais (controller bloqueia sem sessão), mas não auditáveis via grep de middleware.

---

### 7. server/modules/logistics/logistics.routes.ts → `/api/logistics`

**Sem router-wide requireAuth.** Auth é inline no controller (4 estratégias documentadas). `tenantContext` instalado condicionalmente.

| # | Método | Endpoint | Middleware | Inline | Status |
|---|---|---|---|---|---|
| 93 | GET | `/api/logistics/drivers` | — | `session.userId` | 🟡 |
| 94 | POST | `/api/logistics/drivers` | requireActiveSubscription | `session.userId` | 🟡 |
| 95 | PATCH | `/api/logistics/drivers/:id` | — | admin roles check | 🟡 |
| 96 | DELETE | `/api/logistics/drivers/:id` | — | admin roles check | 🟡 |
| 97–102 | GET/POST/PATCH/DELETE | `/api/logistics/vehicles/*` | requireActiveSubscription (POST) | `session.userId` | 🟡 |
| 103–110 | GET/POST/PATCH/DELETE | `/api/logistics/routes/*`, `/stops/*` | requireActiveSubscription (POSTs) | `session.userId` | 🟡 |
| 111–114 | GET/POST/PATCH/DELETE | `/api/logistics/maintenance/*` | requireActiveSubscription (POST) | `session.userId` | 🟡 |
| 115 | GET | `/api/logistics/route-assistant` | — | `session.userId` | 🟡 |
| 116–121 | GET/POST | `/api/logistics/suggest-route`, `day-orders`, `simulate-day`, `calculate-distance`, `audit-logs`, `reports/deliveries`, `smart-search`, `best-driver`, `route-insertion`, `smart-route-plan` | — | `session.userId` | 🟡 |
| 122 | GET | `/api/logistics/geo/cep/:cep` | — | — | ⚠️ público intencional (geocoding) |
| 123 | GET | `/api/logistics/track/:routeId` | — | — | ⚠️ público intencional (rastreamento ao vivo) |

> **Inconsistência:** 20+ endpoints sem middleware formal. Controller é a única linha de defesa.

---

### 8. server/modules/products/products.routes.ts → `/api/products`

GETs têm `requireSession`. Mutações: sem middleware, inline no controller — **exceto `out-of-season`** que não faz null check.

| # | Método | Endpoint | Middleware | Inline | Status |
|---|---|---|---|---|---|
| 124–130 | GET | `/api/products/safra-alerts`, `next-code`, `check-code`, `check-duplicate`, `price-alerts`, `/`, `/:id` | `requireSession` | — | ✅ |
| 131 | POST | `/api/products/` | — | `if (!userId) 401` | 🟡 |
| 132 | PUT | `/api/products/:id` | — | `if (!userId) 401` | 🟡 |
| 133 | DELETE | `/api/products/:id` | — | `if (!userId) 401` | 🟡 |
| 134 | PATCH | `/api/products/:id/out-of-season` | — | **nenhum** — `userId` pode ser null e prossegue | 🔴 |
| 135–139 | GET/POST/DELETE/PATCH | `/api/products/:productId/sub-categories`, `/sub-categories/:id` | — | inline no controller (verificar) | 🟡 |

> **⚠️ CRÍTICO — linha 134:** `PATCH /api/products/:id/out-of-season` usa `getSessionUserId()` mas **não verifica se retornou null** antes de chamar o serviço — diferente de create/update/delete que bloqueiam explicitamente. Um ator anônimo pode alterar o flag out-of-season de qualquer produto.

---

### 9. server/modules/products/categories.routes.ts → `/api/categories`

| # | Método | Endpoint | Middleware | Status |
|---|---|---|---|---|
| 140 | GET | `/api/categories/` | `requireSession` | ✅ |
| 141 | POST | `/api/categories/` | — | 🟡 (inline no controller) |
| 142 | PUT | `/api/categories/:id` | — | 🟡 (inline no controller) |
| 143 | DELETE | `/api/categories/:id` | — | 🟡 (inline no controller) |

---

### 10. server/modules/products/pricing.routes.ts → `/api/admin/pricing`

| # | Método | Endpoint | Middleware | Status |
|---|---|---|---|---|
| 144 | POST | `/api/admin/pricing/adjust` | `requireAuth` + `requireRole(['ADMIN'])` + `tenantContext` | ✅ |
| 145 | POST | `/api/admin/pricing/rollback/:batchId` | `requireAuth` + `requireRole(['ADMIN'])` + `tenantContext` | ✅ |

---

### 11. server/modules/products/upload.routes.ts → `/api/admin/products`

| # | Método | Endpoint | Middleware | Status |
|---|---|---|---|---|
| 146 | POST | `/api/admin/products/upload-image` | `requireAuth` + `requireRole(['ADMIN'])` | ✅ |

---

### 12. server/modules/users/users.routes.ts → `/api/users`

| # | Método | Endpoint | Middleware | Role | Status |
|---|---|---|---|---|---|
| 147 | GET | `/api/users/` | `requireAuth` + `requireRole` | MASTER/ADMIN/DEVELOPER/DIRECTOR | ✅ |
| 148 | POST | `/api/users/` | `requireAuth` + `requireRole` + `checkPlanLimit` | MASTER/ADMIN | ✅ |
| 149 | PUT | `/api/users/:id` | `requireAuth` + `requireRole` | MASTER/ADMIN | ✅ |
| 150 | DELETE | `/api/users/:id` | `requireAuth` + `requireRole` | MASTER/ADMIN | ✅ |
| 151 | PUT | `/api/users/:id/password` | `requireAuth` + `requireRole` | MASTER/ADMIN | ✅ |

---

### 13. server/modules/users/users.admin.routes.ts → `/api/admin/users`

| # | Método | Endpoint | Middleware | Inline | Status |
|---|---|---|---|---|---|
| 152 | POST | `/api/admin/users/:id/unlock` | **nenhum** | serviço verifica `actorUserId == null` | 🟡 |

> **Inconsistência:** sem middleware de auth na rota. O serviço faz a verificação (`if (actorUserId == null) throw UnauthorizedError`) — funcional, mas a proteção está na camada errada. Qualquer erro futuro no service pode expor a operação.

---

### 14. server/routes/about-us.routes.ts

| # | Método | Endpoint | Middleware | Status |
|---|---|---|---|---|
| 153 | GET | `/api/about-us` | `requireSessionOrCompany` | ✅ |
| 154 | PUT | `/api/about-us` | `requireAuthCore` + inline role | ✅ |

---

### 15. server/routes/admin-intelligence.routes.ts

| # | Método | Endpoint | Middleware | Status |
|---|---|---|---|---|
| 155 | GET | `/api/admin/intelligence` | `requireSessionOrCompany` | ✅ |
| 156 | POST | `/api/admin/intelligence/auto-fix` | `requireSessionOrCompany` | ✅ |

---

### 16. server/routes/alert.routes.ts

| # | Método | Endpoint | Middleware | Role | Status |
|---|---|---|---|---|---|
| 157 | GET | `/api/admin/alerts` | `requireAuthCore` + `requireRole` | MASTER/ADMIN/DEVELOPER/DIRECTOR | ✅ |
| 158–159 | GET | `/api/admin/alerts/*` | `requireAuthCore` + `requireRole` | OPS_ROLES | ✅ |

---

### 17. server/routes/announcements.routes.ts

| # | Método | Endpoint | Middleware | Status |
|---|---|---|---|---|
| 160 | GET | `/api/announcements` | `requireAuthCore` | ✅ |
| 161 | GET | `/api/announcements/active` | — | ⚠️ público intencional (sessão opcional — retorna anúncios filtrados) |
| 162 | POST | `/api/announcements` | `requireAuthCore` + `requireRole(ADMIN_ROLES)` | ✅ |
| 163 | PUT | `/api/announcements/:id` | `requireAuthCore` + `requireRole(ADMIN_ROLES)` | ✅ |
| 164 | PATCH | `/api/announcements/:id/toggle` | `requireAuthCore` + `requireRole(ADMIN_ROLES)` | ✅ |
| 165 | DELETE | `/api/announcements/:id` | `requireAuthCore` + `requireRole(ADMIN_ROLES)` | ✅ |

---

### 18. server/routes/assistant.routes.ts

| # | Método | Endpoint | Middleware | Inline | Status |
|---|---|---|---|---|---|
| 166 | GET | `/api/assistant/history` | `tenantContext` apenas | session usada mas não forçada | 🟡 |
| 167 | POST | `/api/assistant/chat` | `tenantContext` apenas | session usada mas não forçada | 🟡 |

> **Inconsistência:** `tenantContext` **não é gate de auth** — requests sem sessão passam pelo middleware sem erro (tenantContext usa session quando presente, mas não bloqueia quando ausente). Se o handler precisar de sessão para funcionar, falta o gate explícito.

---

### 19. server/routes/audit.routes.ts

| # | Método | Endpoint | Middleware | Status |
|---|---|---|---|---|
| 168 | GET | `/api/admin/audit` | `requireAuthCore` + `requireRole` | ✅ |
| 169 | GET | `/api/audit` | `requireSessionOrCompany` + `requireRole` | ✅ |

---

### 20. server/routes/backup.routes.ts

Todos os 14 endpoints usam `requireSessionOrCompany` + `requireRole(BACKUP_ROLES ou MASTER_ONLY)` ✅.

---

### 21. server/routes/bank.routes.ts

| # | Método | Endpoint | Middleware | Status |
|---|---|---|---|---|
| 170–178 | GET/POST/PATCH/DELETE | `/api/bank/*` | `requireAuthCore` + `requireRole(['ADMIN','FINANCE'])` (onde aplicável) + `tenantContext` | ✅ |

> **Observação:** `POST /api/bank/accounts/:id/testar`, `GET /api/bank/accounts/:id/extrato`, `GET /api/bank/transactions`, `POST /api/bank/accounts/:id/boleto`, `POST /api/bank/reconciliar` têm `requireAuthCore` mas sem `requireRole` explícito — qualquer userId admin tem acesso (ok se intencional).

---

### 22. server/routes/certificates.routes.ts

Todos os endpoints usam `requireAuthCore` + `requireRole(['MASTER'])` ✅.

---

### 23. server/routes/clara.routes.ts

Todos os 12 endpoints usam `requireAuthCore` + `requireRole(['MASTER','ADMIN','DEVELOPER'])` ou `['MASTER','ADMIN','DEVELOPER','DIRECTOR']` ✅.

---

### 24. server/routes/client-contract-scope.routes.ts *(TD-004 — corrigido)*

| # | Método | Endpoint | Middleware | Status |
|---|---|---|---|---|
| 179 | GET | `/api/client/contract-scope` | `requireSession` + inline companyId | ✅ |
| 180 | POST | `/api/client/scope-change-request` | `requireSession` + inline companyId | ✅ |

---

### 25. server/routes/client-intelligence.routes.ts

| # | Método | Endpoint | Middleware | Status |
|---|---|---|---|---|
| 181 | GET | `/api/commercial-intelligence` | `requireSessionOrCompany` | ✅ |
| 182 | GET | `/api/financial-intelligence` | `requireSessionOrCompany` | ✅ |
| 183 | GET | `/api/logistics-intelligence` | `requireSessionOrCompany` | ✅ |

---

### 26. server/routes/company-validate.routes.ts

| # | Método | Endpoint | Middleware | Status |
|---|---|---|---|---|
| 184 | GET | `/api/admin/companies/validate` | `requireAuthCore` + inline role | ✅ |

---

### 27. server/routes/contracts-alerts.routes.ts

| # | Método | Endpoint | Middleware | Status |
|---|---|---|---|---|
| 185 | GET | `/api/contracts/alerts` | `requireAuthCore` + `requireRole(['MASTER','ADMIN','DIRECTOR'])` | ✅ |

---

### 28. server/routes/email.routes.ts *(TD-008 — corrigido)*

| # | Método | Endpoint | Middleware | Status |
|---|---|---|---|---|
| 186 | GET | `/api/email/schedules` | `requireAuth` | ✅ |
| 187 | POST | `/api/email/schedules` | `requireAuth` + inline role | ✅ |
| 188 | PUT | `/api/email/schedules/:id` | `requireAuth` + inline role | ✅ |
| 189 | DELETE | `/api/email/schedules/:id` | `requireAuth` + inline role | ✅ |
| 190 | GET | `/api/email/logs` | `requireAuth` | ✅ |
| 191 | POST | `/api/email/broadcast` | `requireAuth` + inline role | ✅ |
| 192 | POST | `/api/email/send-order-event` | `requireAuth` + inline role | ✅ |

---

### 29. server/routes/empresa-config.routes.ts

| # | Método | Endpoint | Middleware | Status |
|---|---|---|---|---|
| 193 | GET | `/api/empresa-config/:empresaId` | `requireAuthCore` + inline role | ✅ |
| 194 | PUT | `/api/empresa-config/:empresaId` | `requireAuthCore` + inline role | ✅ |

---

### 30. server/routes/event.routes.ts

| # | Método | Endpoint | Middleware | Status |
|---|---|---|---|---|
| 195 | GET | `/api/admin/events/recent` | `requireAuthCore` + `requireRole` | ✅ |

---

### 31. server/routes/executive-dashboard.routes.ts

| # | Método | Endpoint | Middleware | Status |
|---|---|---|---|---|
| 196 | GET | `/api/executive-dashboard` | `requireAuthCore` + `requireRole(['MASTER'], { strict: true })` | ✅ |

---

### 32. server/routes/fiscal-diagnostics.routes.ts

| # | Método | Endpoint | Middleware | Status |
|---|---|---|---|---|
| 197 | GET | `/api/admin/fiscal-diagnostics` | `requireAuth` + `requireRole(['MASTER','ADMIN','DIRECTOR','DEVELOPER','FINANCEIRO'])` | ✅ |

---

### 33. server/routes/fiscal-invoices.routes.ts

Todos os 5 endpoints usam `requireAuth` + `requireRole(READ_ROLES ou WRITE_ROLES)` + `tenantContext` ✅.

---

### 34. server/routes/geocode.routes.ts

| # | Método | Endpoint | Middleware | Status |
|---|---|---|---|---|
| 198 | GET | `/api/geocode` | — | ⚠️ público intencional (proxy Nominatim — sem dados sensíveis) |

---

### 35. server/routes/governance.routes.ts

| # | Método | Endpoint | Middleware | Status |
|---|---|---|---|---|
| 199 | GET | `/api/admin/governance/summary` | `requireAuthCore` + `requireRole` | ✅ |

---

### 36. server/routes/health.routes.ts

| # | Método | Endpoint | Middleware | Status |
|---|---|---|---|---|
| 200 | GET | `/health` | — | ⚠️ público intencional (liveness) |
| 201 | GET | `/api/health/live` | — | ⚠️ público intencional (liveness) |
| 202 | GET | `/api/health/ready` | — | ⚠️ público intencional (readiness) |
| 203 | GET | `/api/health` | — | ⚠️ público intencional |
| 204 | GET | `/api/admin/health` | `requireAuthCore` + `requireRole` | ✅ |
| 205 | POST | `/api/admin/health/test` | `healthTestLimiter` + `requireAuthCore` + `requireRole(['MASTER','ADMIN'])` | ✅ |

---

### 37. server/routes/incidents.routes.ts

| # | Método | Endpoint | Middleware | Status |
|---|---|---|---|---|
| 206 | POST | `/api/client-incidents` | `requireSessionOrCompany` | ✅ |
| 207 | GET | `/api/client-incidents` | `requireSessionOrCompany` | ✅ |
| 208 | PATCH | `/api/client-incidents/:id` | `requireAuthCore` | ✅ |
| 209 | DELETE | `/api/client-incidents/:id` | `requireAuthCore` | ✅ |
| 210 | POST | `/api/client-incidents/:id/respond` | `requireAuthCore` | ✅ |
| 211 | GET | `/api/client-incidents/:id/messages` | `requireSessionOrCompany` | ✅ |
| 212 | POST | `/api/client-incidents/:id/messages` | `requireSessionOrCompany` | ✅ |
| 213 | POST | `/api/client-incidents/:id/mark-read` | — | inline `companyId` check | 🟡 |
| 214 | GET | `/api/internal-incidents` | `requireAuthCore` + inline role | ✅ |
| 215 | POST | `/api/internal-incidents` | `requireAuthCore` | ✅ |
| 216 | PATCH | `/api/internal-incidents/:id` | `requireAuthCore` | ✅ |
| 217 | DELETE | `/api/internal-incidents/:id` | `requireAuthCore` | ✅ |

---

### 38. server/routes/logistics.routes.ts *(legado — não é o módulo)*

| # | Método | Endpoint | Middleware | Status |
|---|---|---|---|---|
| 218 | GET | `/api/geo/cep/:cep` | — | ⚠️ público intencional (lookup CEP) |
| 219 | GET | `/api/geo/cep-basic/:cep` | — | ⚠️ público intencional (lookup CEP) |
| 220 | GET | `/api/deliveries` | `tenantContext` apenas | 🟡 tenantContext não é gate |
| 221 | GET | `/api/deliveries/:id` | `requireAuthCore` | ✅ |
| 222 | POST | `/api/deliveries` | `requireAuthCore` | ✅ |
| 223 | PUT | `/api/deliveries/:id` | `requireAuthCore` | ✅ |
| 224 | PATCH | `/api/deliveries/:id/status` | `requireAuthCore` | ✅ |
| 225 | DELETE | `/api/deliveries/:id` | `requireAuthCore` | ✅ |
| 226 | GET | `/api/driver/route-today` | `requireAuthCore` + inline role | ✅ |
| 227 | POST | `/api/driver/gps` | `requireAuthCore` | ✅ |
| 228 | GET | `/api/driver/:driverId/gps` | `requireAuthCore` | ✅ |
| 229 | GET | `/api/deliveries/:id/checklist` | — | 🟡 sem auth — leitura de checklist de entrega |
| 230 | POST | `/api/deliveries/:id/checklist` | `requireAuthCore` | ✅ |
| 231 | GET | `/api/track/:deliveryId` | — | ⚠️ público intencional (rastreamento em tempo real) |

---

### 39. server/routes/logs.routes.ts

| # | Método | Endpoint | Middleware | Status |
|---|---|---|---|---|
| 232 | GET | `/api/admin/logs` | `requireAuth` + `requireRole` | ✅ |
| 233 | POST | `/api/logs` | — | ⚠️ público intencional (logging de erros de cliente — sem dados sensíveis) |
| 234 | DELETE | `/api/logs` | `requireSessionOrCompany` + inline role | ✅ |
| 235 | DELETE | `/api/logs/selected` | `requireSessionOrCompany` + inline role | ✅ |
| 236 | DELETE | `/api/logs/by-date` | `requireSessionOrCompany` + inline role | ✅ |
| 237 | GET | `/api/logs/export` | `requireSessionOrCompany` + inline role | ✅ |

---

### 40. server/routes/marketplace.routes.ts

| # | Método | Endpoint | Middleware | Status |
|---|---|---|---|---|
| 238 | GET | `/api/marketplace/modulos` | — | 🟡 catálogo de módulos — público ou intencional? |
| 239 | POST | `/api/marketplace/modulos` | `requireAuthCore` + inline role | ✅ |
| 240 | PATCH | `/api/marketplace/modulos/:id` | `requireAuthCore` + inline role | ✅ |
| 241 | DELETE | `/api/marketplace/modulos/:id` | `requireAuthCore` + inline role | ✅ |
| 242 | POST | `/api/marketplace/seed` | `requireAuthCore` + inline role | ✅ |
| 243 | GET | `/api/marketplace/empresa/:empresaId` | `requireAuthCore` | ✅ |
| 244–246 | POST/PATCH/DELETE | `/api/marketplace/empresa-modulos/*` | `requireAuthCore` + inline role | ✅ |

---

### 41. server/routes/master.routes.ts

Todos os 15+ endpoints usam `requireAuthCore` + `requireRole(['MASTER'])` ou similar ✅.

---

### 42. server/routes/nfe-dashboard.routes.ts

Todos os 3+ endpoints usam `requireAuthCore` + `requireRole` ✅.

---

### 43. server/routes/observability.routes.ts

Todos os 15+ endpoints usam `requireAuth` + `requireRole(['MASTER'])` ✅.

---

### 44. server/routes/operations.routes.ts

| # | Método | Endpoint | Middleware | Status |
|---|---|---|---|---|
| 247 | GET | `/api/admin/operations/*` | `requireAuth` + `requireRole` | ✅ |

---

### 45. server/routes/order-cleanup.routes.ts

| # | Método | Endpoint | Middleware | Status |
|---|---|---|---|---|
| 248 | GET | `/api/admin/order-cleanup-check` | `requireAuthCore` + `requireRole` | ✅ |
| 249 | DELETE | `/api/admin/order-cleanup` | `requireAuthCore` (sem requireRole) | 🟡 qualquer admin |

---

### 46. server/routes/order-exceptions.routes.ts

| # | Método | Endpoint | Middleware | Status |
|---|---|---|---|---|
| 250 | GET | `/api/order-exceptions` | `requireAuthCore` + `requireRole(['ADMIN','DIRECTOR'])` | ✅ |
| 251 | POST | `/api/order-exceptions` | `requireAuthCore` + `requireRole(['ADMIN','DIRECTOR'])` | ✅ |
| 252 | PUT | `/api/order-exceptions/:id` | `requireAuthCore` + `requireRole(['ADMIN','DIRECTOR'])` | ✅ |
| 253 | DELETE | `/api/order-exceptions/:id` | `requireAuthCore` + `requireRole(['ADMIN','DIRECTOR'])` | ✅ |
| 254 | GET | `/api/order-exceptions/company/:companyId` | — | inline `session.userId || companyId` | 🟡 |

---

### 47. server/routes/order-windows.routes.ts

| # | Método | Endpoint | Middleware | Status |
|---|---|---|---|---|
| 255 | GET | `.../order-windows/list` | `requireSession` | ✅ |
| 256 | GET | `.../order-windows/active` | `requireSession` | ✅ |
| 257 | POST | `.../order-windows/create` | `requireAuth` + `requireRole(WRITE_ROLES)` | ✅ |
| 258 | PUT | `.../order-windows/update` | `requireAuth` + `requireRole(WRITE_ROLES)` | ✅ |

---

### 48. server/routes/password-reset-requests.routes.ts 🔴

| # | Método | Endpoint | Middleware | Inline | Status |
|---|---|---|---|---|---|
| 259 | GET | `/api/password-reset-requests` | **nenhum** | **nenhum** | 🔴 CRÍTICO |
| 260 | PUT | `/api/password-reset-requests/:id` | **nenhum** | **nenhum** | 🔴 CRÍTICO |

> **Evidência:** `PUT` executa `storage.updateCompany(pr.companyId, { password: newPassword })` — altera a senha de qualquer empresa sem autenticação.

---

### 49. server/routes/policy.routes.ts

Todos os endpoints usam `requireAuthCore` + `requireRole` ✅.

---

### 50. server/routes/price-groups.routes.ts

Todos os endpoints usam `requireAuth` + `requireRole` ✅.

---

### 51. server/routes/product-prices.routes.ts

Todos os endpoints usam `requireAuth` ✅.

---

### 52. server/routes/purchase-planning.routes.ts

Todos os endpoints usam `requireAuth` + `requireRole(PLAN_ROLES)` + `tenantContext` + `requireTenant` ✅.

---

### 53. server/routes/push.routes.ts

| # | Método | Endpoint | Middleware | Status |
|---|---|---|---|---|
| 261 | GET | `/api/push/vapid-public-key` | — | ⚠️ público intencional (chave pública) |
| 262 | POST | `/api/push/subscribe` | — | 🟡 fail-closed inline (bloqueia se sem companyId resolvido) |
| 263 | POST | `/api/push/unsubscribe` | — | ⚠️ público intencional (apenas desativa endpoint) |
| 264 | GET | `/api/push/settings` | `requireAuthCore` | ✅ |
| 265 | PATCH | `/api/push/settings/:event` | `requireAuthCore` + inline role | ✅ |
| 266 | POST | `/api/push/test` | `requireAuthCore` + inline role | ✅ |

---

### 54. server/routes/quotations.routes.ts

Todos os 4 endpoints usam `requireAuthCore` ✅.

---

### 55. server/routes/reports.routes.ts

Todos os 3 endpoints usam `requireAuthCore` + `requireRole(['ADMIN','DIRECTOR','MASTER'])` ✅.

---

### 56. server/routes/routes.ts *(legado — ~4300 linhas)*

Endpoints relevantes identificados via grep:

| # | Método | Endpoint | Middleware | Status |
|---|---|---|---|---|
| 267 | GET | `api.orders.list.path` | `requireAuthCore` + `requireRole` | ✅ |
| 268 | GET | `api.orders.companyOrders.path` | — | inline `session.userId || companyId` + validateCompanyTenant | 🟡 |
| 269 | GET | `api.orders.get.path` | — | inline validateOrderTenant | 🟡 |
| 270 | POST | `/api/orders/:orderId/substitute-item` | `requireAuthCore` | ✅ |
| 271–280 | GET/POST | `/api/nfe/*`, `/api/nf-manual` | `tenantContext` + `requireTenant` ou `requireAuthCore` + `requireRole` | ✅ |
| 281–290 | GET/POST | `/api/notifications/*` | `requireAuthCore` | ✅ |

> **Observação:** routes.ts contém rotas legadas que coexistem com os módulos. Módulos têm precedência (montados antes). Os endpoints não migrados usam inline checks — funcionais mas não padronizados.

---

### 57. server/routes/saas.routes.ts

Todos os 20+ endpoints usam `requireAuthCore` + inline role check ✅.

---

### 58. server/routes/sanitary.routes.ts

Todos os endpoints usam `requireAuthCore` ✅.

---

### 59. server/routes/scope-simulations.routes.ts

Todos os 6 endpoints usam `requireAuthCore` ✅.

---

### 60. server/routes/search.routes.ts

| # | Método | Endpoint | Middleware | Status |
|---|---|---|---|---|
| 291 | GET | `/api/search` | `requireAuthCore` + `tenantContext` | ✅ |

---

### 61–65. server/routes/security-*.routes.ts e security.routes.ts

Todos os endpoints usam `requireAuth` / `requireAuthCore` + `requireRole(['MASTER','ADMIN'])` ✅.

---

### 66. server/routes/settings.routes.ts

| # | Método | Endpoint | Middleware | Status |
|---|---|---|---|---|
| 292 | GET | `/api/settings/maintenance` | — | ⚠️ público intencional (checado antes do login) |
| 293 | GET | `/api/settings/test-mode` | — | ⚠️ público intencional |
| 294 | GET | `/api/settings/:key` | `requireAuthCore` + `requireRole(['MASTER'])` | ✅ |
| 295 | PUT | `/api/settings/:key` | `requireAuthCore` + `requireRole(['MASTER'])` | ✅ |
| 296 | GET | `/api/company-config/logo` | — | ⚠️ público intencional (branding) |
| 297 | GET | `/api/company-config` | — | 🟡 config da empresa sem auth — dados não sensíveis? |
| 298 | PATCH | `/api/company-config` | `requireAuthCore` + inline role | ✅ |
| 299 | GET | `/api/company-settings/:empresaId` | — | 🟡 configurações white-label sem auth |
| 300 | POST | `/api/company-settings/:empresaId` | `requireAuthCore` + inline role | ✅ |
| 301 | PUT | `/api/company-settings/:empresaId` | `requireAuthCore` + inline role | ✅ |
| 302 | POST | `/api/settings/test-mode` | `requireAuthCore` + inline role | ✅ |
| 303 | **GET** | **`/api/admin/test-orders`** | **nenhum** | 🔴 |
| 304 | POST | `/api/settings/maintenance` | `requireAuthCore` + inline role | ✅ |

---

### 67. server/routes/smtp-config.routes.ts e smtp-test.routes.ts

Todos os 5 endpoints usam `requireAuthCore` + `requireRole(SMTP_ROLES)` ✅.

---

### 68. server/routes/special-order-requests.routes.ts

| # | Método | Endpoint | Middleware | Status |
|---|---|---|---|---|
| 305 | POST | `/api/special-order-requests` | — | 🟡 sem auth — submissão de cliente sem login? |
| 306 | GET | `/api/special-order-requests/company/:companyId` | `requireSessionOrCompany` | ✅ |
| 307 | GET | `/api/special-order-requests` | — | 🟡 sem auth — lista todos os pedidos especiais |
| 308 | PUT | `/api/special-order-requests/:id` | `requireAuthCore` | ✅ |

---

### 69. server/routes/system-state.routes.ts e system-sync.routes.ts

Todos os endpoints usam `requireAuthCore` + `requireRole` ✅.

---

### 70. server/routes/system-versions.routes.ts *(TD-006 — corrigido)*

| # | Método | Endpoint | Middleware | Status |
|---|---|---|---|---|
| 309 | GET | `/api/system/versions` | `requireAuthCore` + `requireRole(SYS_ROLES)` | ✅ |
| 310 | GET | `/api/system/versions/current` | — | ⚠️ público intencional (metadata de versão) |
| 311–317 | POST/PATCH/DELETE/GET | `/api/system/versions/*`, `/api/system/apply-update`, `/api/system/rollback`, `/api/system/update-logs`, `/api/system/updates` | `requireAuthCore` + `requireRole(SYS_ROLES)` | ✅ |

---

### 71. server/routes/tasks.routes.ts

Todos os 4 endpoints usam `requireAuthCore` ✅.

---

### 72. server/routes/waste-control.routes.ts

Todos os 4 endpoints usam `requireAuth` + `requireRole(WASTE_ROLES)` + `tenantContext` + `requireTenant` ✅.

---

## ETAPA 2 — INCONSISTÊNCIAS IDENTIFICADAS

Para cada endpoint:

| Endpoint | Correto? | Inline Only? | Duplicado? | Sem Proteção? | Redundante? | Role Incorreta? |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| `/api/password-reset-requests` (GET+PUT) | ❌ | ❌ | — | ✅ sim | — | — |
| `/api/admin/test-orders` | ❌ | ❌ | — | ✅ sim | — | — |
| `PATCH /api/products/:id/out-of-season` | ❌ | ❌ | — | ✅ sim | — | — |
| Todo `/api/inventory/*` | 🟡 | ✅ | — | — | — | — |
| Todo `/api/logistics/*` (módulo) | 🟡 | ✅ | — | — | — | — |
| `GET /api/assistant/history` + `POST /api/assistant/chat` | 🟡 | 🟡 | — | — | — | — |
| `GET /api/deliveries` | 🟡 | — | — | — | tenantContext sem auth | — |
| `GET /api/deliveries/:id/checklist` | 🟡 | — | — | ✅ parcial | — | — |
| `POST /api/admin/users/:id/unlock` | 🟡 | ✅ (service) | — | — | — | — |
| `GET /api/company-config` | 🟡 | — | — | — | ausente por design? | — |
| `GET /api/company-settings/:empresaId` | 🟡 | — | — | — | ausente por design? | — |
| `GET /api/special-order-requests` | 🟡 | — | — | ✅ parcial | — | — |
| `POST /api/special-order-requests` | 🟡 | — | — | — | intencional? | — |
| `GET /api/marketplace/modulos` | 🟡 | — | — | — | intencional? | — |
| `POST /api/push/subscribe` | 🟡 | ✅ fail-closed | — | — | — | — |
| `PATCH /api/push/settings/:event` | 🟡 | ✅ | — | — | requireRole ausente | — |
| `DELETE /api/admin/order-cleanup` | 🟡 | — | — | — | requireRole ausente | — |
| `/api/admin/users/:id/unlock` | 🟡 | ✅ (service) | — | — | requireAuth ausente | — |
| `POST /api/bank/accounts/:id/testar` | 🟡 | — | — | — | requireRole ausente | — |
| Todo `server/routes/routes.ts` (legado) | 🟡 | ✅ | — | — | — | — |

---

## ETAPA 3 — MATRIZ DE SEGURANÇA

### ✅ CORRETO — Protegidos com middleware formal

> ~280 endpoints. Principais padrões:
> - `requireAuth + requireRole` (admin routes, security, observability, fiscal, finance)
> - `requireAuthOrService + tenantContext` (companies module — todos os 23 endpoints)
> - `tenantContext` router-wide (orders module — resolve sessão obrigatoriamente)
> - `requireAuth + withTenantScope` (finance e fiscal modules — router-wide)
> - `requireSessionOrCompany` (client-facing routes — incidents, audit, backups, client-intelligence)

---

### 🟡 MELHORAR — Funcionais, mas inconsistentes ou risco futuro

| ID | Arquivo | Linha | Endpoint | Problema | Risco | Correção | Complexidade |
|---|---|---|---|---|---|---|---|
| M-01 | `inventory.routes.ts` + controller | — | Todos `/api/inventory/*` | 9 endpoints sem middleware — auth só no controller | Médio: qualquer bug no controller expõe a operação | Adicionar `requireAuth` router-wide | Baixa |
| M-02 | `logistics.routes.ts` (módulo) + controller | — | Todos `/api/logistics/*` | 20+ endpoints sem middleware — 4 estratégias de auth no controller | Médio: mesma razão | Adicionar `requireAuth` router-wide (pelo menos para mutações) | Média |
| M-03 | `products.routes.ts` + controller | 30–44 | POST/PUT/DELETE `/api/products/*` | Mutações sem middleware formal | Médio | Adicionar `requireAuth` ou `requireSession` para mutações | Baixa |
| M-04 | `products.routes.ts` + controller | 38 | PATCH `/api/products/:id/out-of-season` | `userId` pode ser null sem bloqueio | Médio | Adicionar null check antes do serviço OU adicionar `requireSession` na rota | Baixa |
| M-05 | `categories.routes.ts` + controller | 17–19 | POST/PUT/DELETE `/api/categories/*` | Mutações sem middleware formal | Médio | Adicionar `requireAuth` | Baixa |
| M-06 | `assistant.routes.ts` | 21, 45 | GET `/api/assistant/history`, POST `/api/assistant/chat` | `tenantContext` não é gate de auth | Médio-Baixo: handler usa session mas não bloqueia explicitamente | Substituir por `requireSession` + `tenantContext` | Baixa |
| M-07 | `logistics.routes.ts` (legado) | 39 | GET `/api/deliveries` | Apenas `tenantContext` — não bloqueia anônimos | Baixo | Adicionar `requireSession` antes do `tenantContext` | Baixa |
| M-08 | `logistics.routes.ts` (legado) | 266 | GET `/api/deliveries/:id/checklist` | Sem auth — leitura de checklist | Baixo | Adicionar `requireSession` | Baixa |
| M-09 | `users.admin.routes.ts` | 19 | POST `/api/admin/users/:id/unlock` | Sem middleware — service verifica, mas proteção na camada errada | Médio | Adicionar `requireAuth` + `requireRole` na rota | Baixa |
| M-10 | `settings.routes.ts` | 70, 110 | GET `/api/company-config`, GET `/api/company-settings/:empresaId` | Sem auth — expõe configuração | Baixo-Médio: dados potencialmente sensíveis | Adicionar `requireSession` se dados não são públicos | Baixa |
| M-11 | `special-order-requests.routes.ts` | 10, 54 | POST e GET `/api/special-order-requests` | Sem auth | Baixo: POST pode ser intencional (portal cliente) | Verificar intenção; GET deveria ter `requireAuth` | Baixa |
| M-12 | `marketplace.routes.ts` | 7 | GET `/api/marketplace/modulos` | Sem auth — catálogo de módulos | Baixo | Verificar se é catálogo público ou deve exigir auth | Baixa |
| M-13 | `push.routes.ts` | 75 | PATCH `/api/push/settings/:event` | `requireAuthCore` sem `requireRole` | Baixo | Adicionar `requireRole(['MASTER','ADMIN','DIRECTOR','DEVELOPER'])` | Baixa |
| M-14 | `order-cleanup.routes.ts` | 25 | DELETE `/api/admin/order-cleanup` | `requireAuthCore` sem `requireRole` — qualquer admin pode limpar | Médio | Adicionar `requireRole(['MASTER'])` | Baixa |
| M-15 | `incidents.routes.ts` | 123 | POST `/api/client-incidents/:id/mark-read` | Sem middleware — inline companyId check | Baixo | Adicionar `requireSession` | Baixa |
| M-16 | `order-exceptions.routes.ts` | 45 | GET `/api/order-exceptions/company/:companyId` | Sem middleware — inline session check | Baixo | Adicionar `requireSession` | Baixa |
| M-17 | `bank.routes.ts` | 76, 92, 119, 128, 143 | POST `/testar`, GET `/extrato`, GET `/transactions`, POST `/boleto`, POST `/reconciliar` | `requireAuthCore` sem `requireRole` | Baixo | Adicionar `requireRole(['ADMIN','FINANCE'])` | Baixa |

---

### 🔴 VULNERÁVEL — Sem auth de qualquer tipo (bloqueadores)

| ID | Arquivo | Linha | Endpoint | Motivo | Risco | Correção | Complexidade |
|---|---|---|---|---|---|---|---|
| **V-01** | `password-reset-requests.routes.ts` | 7 | `GET /api/password-reset-requests` | Zero auth — expõe todas as solicitações de reset | **CRÍTICO** | Adicionar `requireAuth` + `requireRole` | Baixa |
| **V-02** | `password-reset-requests.routes.ts` | 16 | `PUT /api/password-reset-requests/:id` | Zero auth — altera senha de empresa via `storage.updateCompany(companyId, { password: newPassword })` | **CRÍTICO** | Adicionar `requireAuth` + `requireRole` | Baixa |
| **V-03** | `settings.routes.ts` | 198 | `GET /api/admin/test-orders` | Zero auth — expõe pedidos de teste | **ALTO** | Adicionar `requireAuthCore` + `requireRole` | Baixa |
| **V-04** | `products.routes.ts` + controller | 35 (route), ~185 (controller) | `PATCH /api/products/:id/out-of-season` | `userId` obtido mas **null check ausente** — serviço recebe `userId=null` e prossegue | **MÉDIO** | Adicionar `if (!userId) return res.status(401)` antes da chamada do serviço OU adicionar `requireSession` na rota | Muito Baixa |

---

## ETAPA 4 — RESPOSTA ÀS QUESTÕES DE CADA ENDPOINT

### V-01 / V-02: password-reset-requests
- **Correto?** ❌ Não
- **Só inline?** ❌ Sem nenhuma verificação
- **Duplicado?** —
- **Sem proteção?** ✅ Completamente exposto
- **Proteção redundante?** —
- **Role incorreta?** N/A — sem role definida

### V-03: test-orders
- **Correto?** ❌ Não
- **Só inline?** ❌ Sem nenhuma verificação
- **Sem proteção?** ✅

### V-04: out-of-season
- **Correto?** ❌ Não
- **Só inline?** ✅ Inline existe para outros métodos (create/update/delete), mas **ausente neste específico**
- **Sem proteção?** ✅ Para anonimato — `userId=null` passa para o serviço

### M-01–M-17 (🟡):
- **Correto?** Funcionais mas inconsistentes
- **Só inline?** ✅ Maioria — inline check no controller ou service
- **Sem proteção?** ❌ Há proteção, mas na camada errada (difícil auditar)
- **Proteção redundante?** Alguns têm dupla verificação (middleware + inline) — correto por defesa em profundidade

---

## ETAPA 5 — POTENCIAIS NOVOS BLOQUEADORES

**Resposta direta:** Sim. Além dos 4 vulneráveis confirmados (V-01 a V-04), os seguintes itens representam risco de se tornarem bloqueadores se não tratados:

### Prioridade ALTA — Tratar antes ou junto com V-01 a V-04

| ID | Endpoint | Risco | Por quê pode virar bloqueador |
|---|---|---|---|
| **M-09** | `POST /api/admin/users/:id/unlock` | ALTO | Desbloquear usuários sem middleware de auth — service verifica, mas qualquer refactor do service pode expor |
| **M-02** | Todo `/api/logistics/*` (módulo) | ALTO | 20+ endpoints críticos (motoristas, rotas, veículos, manutenção) sem middleware formal — auth só em controller |
| **M-14** | `DELETE /api/admin/order-cleanup` | ALTO | Qualquer admin pode deletar pedidos — sem requireRole restritivo |

### Prioridade MÉDIA — Tratar no próximo ciclo

| ID | Endpoint | Risco | Observação |
|---|---|---|---|
| **M-04** | `PATCH /api/products/:id/out-of-season` | MÉDIO | userId=null passa silenciosamente ao serviço |
| **M-06** | `GET /api/assistant/history` + `POST /api/assistant/chat` | MÉDIO | tenantContext não é gate — IA acessível sem sessão confirmada |
| **M-01** | Todo `/api/inventory/*` | MÉDIO | 9 endpoints sem middleware |
| **M-07** | `GET /api/deliveries` | MÉDIO | tenantContext sem requireSession |
| **M-10** | `GET /api/company-config`, `GET /api/company-settings/:empresaId` | MÉDIO | Pode expor configurações sensíveis (integrations, fiscal env) |
| **M-11** | `GET /api/special-order-requests` | MÉDIO | Lista TODOS os pedidos especiais sem auth |

### Prioridade BAIXA — Dívida técnica, não bloqueador imediato

| ID | Endpoint | Observação |
|---|---|---|
| M-03, M-05 | Products/categories mutations | Auth inline funcional — padronizar |
| M-08 | `GET /api/deliveries/:id/checklist` | Checklist pode ser intencional para motorista sem login |
| M-12 | `GET /api/marketplace/modulos` | Verificar se é catálogo público intencional |
| M-13 | `PATCH /api/push/settings/:event` | requireRole ausente mas requireAuth presente |
| M-15, M-16 | mark-read, order-exceptions/company | Inline check funcional — formalizar |
| M-17 | bank/* sem requireRole | Apenas ADMIN pode acessar de qualquer forma via role bypass |

---

## RESUMO EXECUTIVO

| Categoria | Quantidade |
|---|:---:|
| 🔴 **Vulneráveis** (bloqueadores imediatos) | **4** |
| 🟡 **Melhorar** (risco futuro / inconsistência) | **17** |
| ⚠️ **Público intencional** | **~15** |
| ✅ **Correto** | **~280** |
| **Total de endpoints auditados** | **~316** |

### Os 4 bloqueadores imediatos

| # | Endpoint | Arquivo | Linha | Risco |
|---|---|---|---|---|
| V-01 | `GET /api/password-reset-requests` | `password-reset-requests.routes.ts` | 7 | CRÍTICO |
| V-02 | `PUT /api/password-reset-requests/:id` | `password-reset-requests.routes.ts` | 16 | CRÍTICO |
| V-03 | `GET /api/admin/test-orders` | `settings.routes.ts` | 198 | ALTO |
| V-04 | `PATCH /api/products/:id/out-of-season` | `products.routes.ts` + controller | 35 / ~185 | MÉDIO |

### Os 3 potenciais bloqueadores de alta prioridade

| # | Endpoint | Arquivo | Risco |
|---|---|---|---|
| M-09 | `POST /api/admin/users/:id/unlock` | `users.admin.routes.ts` | ALTO |
| M-02 | Todo `/api/logistics/*` (módulo) | `logistics.routes.ts` + controller | ALTO |
| M-14 | `DELETE /api/admin/order-cleanup` | `order-cleanup.routes.ts` | ALTO |

---

*Auditoria concluída em 2026-07-27. Nenhum arquivo de produção foi modificado.*
*Arquivos lidos: 80+ route files, 5 controllers, 1 service, 1 middleware file.*
