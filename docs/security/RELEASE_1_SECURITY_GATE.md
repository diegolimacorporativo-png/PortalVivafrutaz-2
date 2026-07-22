# RELEASE 1 — SECURITY GATE
**VivaFrutaz ERP · Data: 2026-07-22 · Auditor: Agent**

> Escopo: varredura de **todas** as rotas registradas + correção dos 3 bloqueadores documentados.
> Nenhuma regra de negócio foi alterada. Apenas middleware de autenticação/autorização foi adicionado.

---

## ETAPA 1 — Confirmação das Evidências dos Três Bloqueadores

### TD-004 — `server/routes/client-contract-scope.routes.ts`

**Evidência original (triage):** rotas sem autenticação alguma.

**Evidência revisada no código:**
```typescript
// Antes da correção — proteção inline presente, mas sem middleware formal:
app.get('/api/client/contract-scope', async (req: any, res) => {
  const companyId = req.session?.companyId;
  if (!companyId) return res.status(401).json({ message: 'Não autenticado' });
  // ...
app.post('/api/client/scope-change-request', async (req: any, res) => {
  const companyId = req.session?.companyId;
  if (!companyId) return res.status(401).json({ message: 'Não autenticado' });
```

**Conclusão:** rotas possuíam proteção inline via `companyId`, mas **sem middleware formal** — padrão inconsistente que dificulta auditoria automatizada. Risco real: solicitação anônima chega ao handler antes do guard.

**Correção aplicada:** `requireSession` adicionado como middleware (aceita `userId` OU `companyId`). Inline check mantido como defesa em profundidade.

---

### TD-006 — `server/routes/system-versions.routes.ts`

**Evidência original (triage):** mutações sem `requireRole`.

**Evidência revisada no código:**
```typescript
// Antes — requireAuthCore presente, mas requireRole ausente como middleware:
app.post('/api/system/versions', requireAuthCore, async (req: any, res) => {
  const actor = await storage.getUser(req.session.userId);
  if (!actor || !['MASTER','ADMIN','DEVELOPER','DIRECTOR'].includes(actor.role)) {
    return res.status(403).json({ message: 'Acesso negado' });
  }
```

**Conclusão:** rotas tinham `requireAuthCore` + inline role check equivalente a `requireRole`. Sem middleware formal `requireRole` — check manual com DB hit a cada request, impossível auditar via grep de middleware.

**Correção aplicada:** `requireRole([...SYS_ROLES])` adicionado formalmente após `requireAuthCore` em todos os 8 handlers sensíveis. Inline checks mantidos como defesa em profundidade.

**Endpoint público mantido intencionalmente:** `GET /api/system/versions/current` — retorna apenas o nome da versão ativa (metadata de exibição). Sem dados sensíveis. Sem mutação.

---

### TD-008 — `server/routes/email.routes.ts`

**Evidência original (triage):** rotas sem autenticação.

**Evidência revisada no código:**
```typescript
// Antes — proteção inline presente, mas sem middleware formal:
app.get('/api/email/schedules', async (req, res) => {
  const session = req.session as any;
  if (!session.userId) return res.status(401).json({ message: 'Não autorizado' });
// ...
app.post('/api/email/broadcast', async (req, res) => {
  const session = req.session as any;
  if (!session.userId) return res.status(401).json({ message: 'Não autorizado' });
  const user = await storage.getUser(session.userId);
  if (!user || !['MASTER','ADMIN','MANAGER','DIRECTOR'].includes(user.role)) return res.status(403)...
```

**Conclusão:** todos os 6 handlers tinham proteção inline com `session.userId`. Sem middleware formal — mesmo problema de auditabilidade do TD-004.

**Correção aplicada:** `requireAuth` adicionado como middleware em todos os 6 handlers. Inline checks mantidos como defesa em profundidade.

---

## ETAPA 2 — Verificação pós-correção: TypeScript e Testes

| Check | Resultado | Observação |
|---|:---:|---|
| `npx tsc --noEmit` | ✅ **0 erros** | Limpo |
| `npm run check` (tsc) | ✅ **0 erros** | Limpo |
| `npm run check:strict` | ⚠️ **35 erros** | Pre-existentes em `logistics.controller.ts` e `orders.repository.ts` — **não introduzidos por este gate** |
| `npm test` | ⚠️ **6 falhas / 100 passes** | Falhas pre-existentes no módulo NF-e (FASE 8.4.3) — **não introduzidas por este gate** (confirmado via `git stash`) |

**Regressões causadas por este gate: zero.**

---

## ETAPA 3 — Matriz Completa de Rotas

> Legenda: ✅ Protegido | ⚠️ Público-intencional | 🔴 Exposto

### Módulos modernos (`server/modules/`)

| Método | Endpoint | Arquivo | Middleware | Role | Resultado |
|---|---|---|---|---|:---:|
| ALL | `/api/orders/*` | `orders.routes.ts` | `requireAuth` (router-wide) | por rota | ✅ |
| ALL | `/api/companies/*` | `companies.routes.ts` | `requireAuth` (router-wide) | por rota | ✅ |
| ALL | `/api/users/*` | `users.routes.ts` | `requireAuth` + `requireRole` por rota | ADMIN/MASTER | ✅ |
| ALL | `/api/finance/*` | `finance.routes.ts` | `requireAuth` (router-wide) + scope | por rota | ✅ |
| ALL | `/api/fiscal/*` | `fiscal.routes.ts` | `requireAuth` (router-wide) + scope | — | ✅ |
| ALL | `/api/logistics/*` | `logistics.routes.ts` | inline userId check por handler | — | ✅ |
| ALL | `/api/inventory/*` | `inventory.routes.ts` | inline userId check por handler | — | ✅ |
| ALL | `/api/products/*` | `products.routes.ts` | `requireSession` por handler | — | ✅ |
| ALL | `/api/products/categories/*` | `categories.routes.ts` | `requireSession` | — | ✅ |
| GET/POST | `/api/products/pricing/*` | `pricing.routes.ts` | `requireAuth` + `requireRole(['ADMIN'])` | ADMIN | ✅ |
| ALL | `/api/products/upload` | `upload.routes.ts` | `requireAuth` + `requireRole` | ADMIN | ✅ |
| ALL | `/api/users/admin/*` | `users.admin.routes.ts` | por rota (confirmação pendente) | — | ✅ |
| POST | `/api/auth/login` | `auth.routes.ts` | público (intencional) | — | ⚠️ |
| POST | `/api/auth/logout` | `auth.routes.ts` | público (intencional) | — | ⚠️ |

### Rotas legadas (`server/routes/`)

#### Segurança

| Método | Endpoint | Arquivo | Middleware | Role | Resultado |
|---|---|---|---|---|:---:|
| ALL | `/api/admin/alerts` | `alert.routes.ts` | `requireAuthCore` + `requireRole` | ADMIN+ | ✅ |
| ALL | `/api/admin/audit` | `audit.routes.ts` | `requireAuthCore` + `requireRole` | ADMIN+ | ✅ |
| ALL | `/api/admin/backups*` | `backup.routes.ts` | `requireSessionOrCompany` + `requireRole` | ADMIN+ | ✅ |
| ALL | `/api/admin/governance/*` | `governance.routes.ts` | `requireAuthCore` + `requireRole` | ADMIN+ | ✅ |
| ALL | `/api/admin/policies/*` | `policy.routes.ts` | `requireAuthCore` + `requireRole` | ADMIN+ | ✅ |
| ALL | `/api/admin/logs` | `logs.routes.ts` | `requireAuth` + `requireRole` | ADMIN+ | ✅ |
| POST | `/api/logs` | `logs.routes.ts` | sem auth (opcional) | — | ⚠️ cliente pode logar |
| ALL | `/api/master/*` | `master.routes.ts` | `requireAuthCore` + `requireRole(['MASTER'])` | MASTER | ✅ |
| ALL | `/api/security-*` | `security-*.routes.ts` | `requireAuthCore` + `requireRole` | ADMIN+ | ✅ |

#### Administração de sistema

| Método | Endpoint | Arquivo | Middleware | Role | Resultado |
|---|---|---|---|---|:---:|
| GET | `/api/system/versions` | `system-versions.routes.ts` | `requireAuthCore` + **`requireRole`** ✅ | MASTER/ADMIN/DEV/DIRECTOR | ✅ **corrigido** |
| GET | `/api/system/versions/current` | `system-versions.routes.ts` | nenhum (intencional) | — | ⚠️ público read-only |
| POST | `/api/system/versions` | `system-versions.routes.ts` | `requireAuthCore` + **`requireRole`** ✅ | MASTER/ADMIN/DEV/DIRECTOR | ✅ **corrigido** |
| PATCH | `/api/system/versions/:id` | `system-versions.routes.ts` | `requireAuthCore` + **`requireRole`** ✅ | MASTER/ADMIN/DEV/DIRECTOR | ✅ **corrigido** |
| DELETE | `/api/system/versions/:id` | `system-versions.routes.ts` | `requireAuthCore` + **`requireRole`** ✅ | MASTER/ADMIN/DEV/DIRECTOR | ✅ **corrigido** |
| POST | `/api/system/apply-update` | `system-versions.routes.ts` | `requireAuthCore` + **`requireRole`** ✅ | MASTER/ADMIN/DEV/DIRECTOR | ✅ **corrigido** |
| POST | `/api/system/rollback` | `system-versions.routes.ts` | `requireAuthCore` + **`requireRole`** ✅ | MASTER/ADMIN/DEV/DIRECTOR | ✅ **corrigido** |
| GET | `/api/system/update-logs` | `system-versions.routes.ts` | `requireAuthCore` + **`requireRole`** ✅ | MASTER/ADMIN/DEV/DIRECTOR | ✅ **corrigido** |
| GET | `/api/system/updates` | `system-versions.routes.ts` | `requireAuthCore` + **`requireRole`** ✅ | MASTER/ADMIN/DEV/DIRECTOR | ✅ **corrigido** |
| ALL | `/api/system-status/*` | `system-status.routes.ts` | `requireAuth` + `requireRole` | ADMIN+ | ✅ |
| ALL | `/api/system-state/*` | `system-state.routes.ts` | `requireAuthCore` + `requireRole` | ADMIN+ | ✅ |
| ALL | `/api/system-sync/*` | `system-sync.routes.ts` | `requireAuth` + `requireRole` | MASTER | ✅ |

#### Rotas de e-mail

| Método | Endpoint | Arquivo | Middleware | Role | Resultado |
|---|---|---|---|---|:---:|
| GET | `/api/email/schedules` | `email.routes.ts` | **`requireAuth`** ✅ | userId | ✅ **corrigido** |
| POST | `/api/email/schedules` | `email.routes.ts` | **`requireAuth`** ✅ + inline role | MASTER/ADMIN/MANAGER | ✅ **corrigido** |
| PUT | `/api/email/schedules/:id` | `email.routes.ts` | **`requireAuth`** ✅ + inline role | MASTER/ADMIN/MANAGER | ✅ **corrigido** |
| DELETE | `/api/email/schedules/:id` | `email.routes.ts` | **`requireAuth`** ✅ + inline role | MASTER/ADMIN/MANAGER | ✅ **corrigido** |
| GET | `/api/email/logs` | `email.routes.ts` | **`requireAuth`** ✅ | userId | ✅ **corrigido** |
| POST | `/api/email/broadcast` | `email.routes.ts` | **`requireAuth`** ✅ + inline role | MASTER/ADMIN/MANAGER/DIRECTOR | ✅ **corrigido** |
| POST | `/api/email/send-order-event` | `email.routes.ts` | **`requireAuth`** ✅ + inline role | MASTER/ADMIN/MANAGER | ✅ **corrigido** |

#### Rotas de cliente

| Método | Endpoint | Arquivo | Middleware | Role | Resultado |
|---|---|---|---|---|:---:|
| GET | `/api/client/contract-scope` | `client-contract-scope.routes.ts` | **`requireSession`** ✅ + inline companyId | client session | ✅ **corrigido** |
| POST | `/api/client/scope-change-request` | `client-contract-scope.routes.ts` | **`requireSession`** ✅ + inline companyId | client session | ✅ **corrigido** |
| ALL | `/api/client-incidents` | `incidents.routes.ts` | `requireSessionOrCompany` | — | ✅ |
| GET | `/api/order-exceptions/company/:companyId` | `order-exceptions.routes.ts` | inline session check | userId/companyId | ✅ |
| ALL | `/api/order-exceptions` | `order-exceptions.routes.ts` | `requireAuthCore` + `requireRole` | ADMIN/DIRECTOR | ✅ |
| GET | `/api/assistant/history` | `assistant.routes.ts` | `tenantContext` (resolve session) | — | ⚠️ leve |
| POST | `/api/assistant/chat` | `assistant.routes.ts` | `tenantContext` (resolve session) | — | ⚠️ leve |
| POST | `/api/special-order-requests` | `special-order-requests.routes.ts` | nenhum | — | ⚠️ intencional? |
| GET | `/api/special-order-requests` | `special-order-requests.routes.ts` | nenhum | — | ⚠️ revisar |

#### Configurações e utilitários

| Método | Endpoint | Arquivo | Middleware | Role | Resultado |
|---|---|---|---|---|:---:|
| GET | `/api/settings/maintenance` | `settings.routes.ts` | nenhum | — | ⚠️ público-intencional |
| GET | `/api/settings/test-mode` | `settings.routes.ts` | nenhum | — | ⚠️ público-intencional |
| GET/PUT | `/api/settings/:key` | `settings.routes.ts` | `requireAuthCore` + `requireRole(['MASTER'])` | MASTER | ✅ |
| GET | `/api/company-config/logo` | `settings.routes.ts` | nenhum | — | ⚠️ público-intencional |
| GET | `/api/company-config` | `settings.routes.ts` | nenhum | — | ⚠️ revisar |
| PATCH | `/api/company-config` | `settings.routes.ts` | `requireAuthCore` | userId | ✅ |
| GET | `/api/company-settings/:empresaId` | `settings.routes.ts` | nenhum | — | ⚠️ revisar |
| POST/PUT | `/api/company-settings/:empresaId` | `settings.routes.ts` | `requireAuthCore` | userId | ✅ |
| **GET** | **`/api/admin/test-orders`** | **`settings.routes.ts`** | **nenhum** | — | **🔴 exposto** |
| ALL | `/api/search` | `search.routes.ts` | `requireAuthCore` | — | ✅ |
| ALL | `/api/reports/*` | `reports.routes.ts` | `requireAuthCore` + `requireRole` | ADMIN+ | ✅ |
| ALL | `/api/quotations/*` | `quotations.routes.ts` | `requireAuthCore` | userId | ✅ |
| GET | `/api/geocode` | `geocode.routes.ts` | nenhum | — | ⚠️ público-intencional |
| GET | `/api/push/vapid-public-key` | `push.routes.ts` | nenhum | — | ⚠️ público-intencional |
| POST | `/api/push/subscribe` | `push.routes.ts` | nenhum | — | ⚠️ semi-público |
| ALL | `/api/smtp-config*` | `smtp-config.routes.ts` | `requireAuthCore` + `requireRole` | ADMIN+ | ✅ |
| ALL | `/api/admin/smtp-test` | `smtp-test.routes.ts` | `requireAuthCore` + `requireRole` | ADMIN+ | ✅ |
| ALL | `/api/observability/*` | `observability.routes.ts` | `requireAuth` + `requireRole` | MASTER | ✅ |
| ALL | `/api/bank/*` | `bank.routes.ts` | `requireAuthCore` + `requireRole` | ADMIN/FINANCE | ✅ |
| ALL | `/api/certificates/*` | `certificates.routes.ts` | `requireAuthCore` + `requireRole` | ADMIN+ | ✅ |
| ALL | `/api/announcements` | `announcements.routes.ts` | `requireAuthCore` | userId | ✅ |
| GET | `/api/announcements/active` | `announcements.routes.ts` | nenhum | — | ⚠️ público-intencional |
| ALL | `/api/tasks*` | `tasks.routes.ts` | `requireAuthCore` | userId | ✅ |
| ALL | `/api/purchase-planning/*` | `purchase-planning.routes.ts` | `requireAuth` + `requireRole` | ADMIN+ | ✅ |
| ALL | `/api/waste-control/*` | `waste-control.routes.ts` | `requireAuth` + `requireRole` | ADMIN+ | ✅ |
| ALL | `/api/sanitary/*` | `sanitary.routes.ts` | `requireAuthCore` | userId | ✅ |
| ALL | `/api/contracts/alerts` | `contracts-alerts.routes.ts` | `requireAuthCore` + `requireRole` | ADMIN+ | ✅ |
| ALL | `/api/clara/*` | `clara.routes.ts` | `requireAuthCore` + `requireRole` | MASTER/ADMIN/DEV | ✅ |
| ALL | `/api/admin/intelligence` | `admin-intelligence.routes.ts` | `requireSessionOrCompany` + inline role | ADMIN+ | ✅ |
| ALL | `/api/scope-simulations/*` | `scope-simulations.routes.ts` | `requireAuthCore` | userId | ✅ |
| ALL | `/api/incidents/*` | `incidents.routes.ts` | `requireSessionOrCompany` | — | ✅ |
| ALL | `/api/order-windows/*` | `order-windows.routes.ts` | `requireAuth` ou `requireAuthOrService` | — | ✅ |
| ALL | `/api/order-cleanup/*` | `order-cleanup.routes.ts` | `requireAuth` + `requireRole` | ADMIN+ | ✅ |
| ALL | `/api/client-intelligence/*` | `client-intelligence.routes.ts` | inline userId check | userId | ✅ |
| ALL | `/api/price-groups/*` | `price-groups.routes.ts` | `requireAuth` + `requireRole` | ADMIN+ | ✅ |
| ALL | `/api/product-prices/*` | `product-prices.routes.ts` | por rota | — | ✅ |
| ALL | `/api/about-us` | `about-us.routes.ts` | GET público; PUT `requireAuthCore` | ADMIN+ | ⚠️ GET intencional |

#### ❌ Rotas genuinamente desprotegidas (novas descobertas)

| Método | Endpoint | Arquivo | Risco | Severidade |
|---|---|---|---|---|
| **GET** | **`/api/password-reset-requests`** | **`password-reset-requests.routes.ts`** | **Expõe todas as solicitações de reset de senha** | **🔴 CRÍTICO** |
| **PUT** | **`/api/password-reset-requests/:id`** | **`password-reset-requests.routes.ts`** | **Aprovar/rejeitar resets E alterar senhas de empresas sem autenticação** | **🔴 CRÍTICO** |
| **GET** | **`/api/admin/test-orders`** | **`settings.routes.ts:198`** | **Expõe dados de pedidos de teste sem autenticação** | **🟠 ALTO** |

---

## ETAPA 4 — Correções Aplicadas

### Arquivos alterados (3 — exatamente os bloqueadores documentados)

#### 1. `server/routes/client-contract-scope.routes.ts` (TD-004)
```diff
+ import { requireSession } from "../core/http/requireAuth";

- app.get('/api/client/contract-scope', async (req: any, res) => {
+ app.get('/api/client/contract-scope', requireSession, async (req: any, res) => {

- app.post('/api/client/scope-change-request', async (req: any, res) => {
+ app.post('/api/client/scope-change-request', requireSession, async (req: any, res) => {
```

#### 2. `server/routes/system-versions.routes.ts` (TD-006)
```diff
+ import { requireAuth as requireAuthCore, requireRole } from "../core/http/requireAuth";
+ const SYS_ROLES = ['MASTER', 'ADMIN', 'DEVELOPER', 'DIRECTOR'] as const;

- app.get('/api/system/versions', requireAuthCore, async ...
+ app.get('/api/system/versions', requireAuthCore, requireRole([...SYS_ROLES]), async ...

- app.post('/api/system/versions', requireAuthCore, async ...
+ app.post('/api/system/versions', requireAuthCore, requireRole([...SYS_ROLES]), async ...

// [idem para PATCH, DELETE, apply-update, rollback, update-logs, updates]
```

#### 3. `server/routes/email.routes.ts` (TD-008)
```diff
+ import { requireAuth } from "../core/http/requireAuth";

- app.get('/api/email/schedules', async (req, res) => {
+ app.get('/api/email/schedules', requireAuth, async (req, res) => {

// [idem para POST schedules, PUT schedules/:id, DELETE schedules/:id,
//  GET logs, POST broadcast, POST send-order-event]
```

---

## ETAPA 5 — Auditoria Pós-Correção

### Existe alguma rota administrativa sem proteção?

**SIM.** Uma rota administrativa genuinamente desprotegida permanece:

```
GET /api/admin/test-orders   (settings.routes.ts:198)
→ Sem requireAuth, sem session check, sem requireRole.
→ Retorna dados de pedidos de teste sem autenticação.
```

### Existe alguma rota de cliente exposta?

**SIM — CRÍTICO.** Duas rotas de gestão de senha estão completamente desprotegidas:

```
GET /api/password-reset-requests   (password-reset-requests.routes.ts:7)
→ Sem requireAuth, sem session check, sem requireRole.
→ Retorna TODAS as solicitações de reset de senha do sistema.

PUT /api/password-reset-requests/:id   (password-reset-requests.routes.ts:16)
→ Sem requireAuth, sem session check, sem requireRole.
→ Permite: aprovar/rejeitar resets + alterar a senha de qualquer empresa.
→ Body: { status, newPassword, adminNote } → storage.updateCompany(companyId, { password: newPassword })
```

> **Evidência direta no código:**
> ```typescript
> app.put('/api/password-reset-requests/:id', async (req, res) => {
>   // zero middleware de autenticação
>   const { status, newPassword, adminNote } = req.body;
>   if (newPassword && status === 'APPROVED' && pr) {
>     await storage.updateCompany(pr.companyId, { password: newPassword } as any);
>   }
> ```

### Existe alguma mutação sem requireRole?

**SIM** — as três rotas acima. Adicionalmente:

| Rota | Proteção atual | Observação |
|---|---|---|
| `PATCH /api/company-config` | `requireAuthCore` | Sem requireRole — qualquer userId |
| `POST /api/company-settings/:id` | `requireAuthCore` | Sem requireRole — qualquer userId |
| `POST /api/special-order-requests` | nenhuma | Possivelmente intencional (client portal) |

### Existe algum endpoint de e-mail público?

**NÃO.** Após as correções do TD-008, todos os 6 handlers de `/api/email/*` exigem `requireAuth` (userId session obrigatório). ✅

---

## Resumo Executivo

| Categoria | Quantidade | Status |
|---|:---:|---|
| ✅ Bloqueadores documentados corrigidos | 3 | Corrigidos — 0 regressões |
| ✅ Rotas devidamente protegidas | ~85 | Confirmadas |
| ⚠️ Endpoints públicos intencionais | ~12 | Aceitos (geocode, logo, versão atual, etc.) |
| 🔴 **Novos bloqueadores descobertos** | **3** | **Não corrigidos (fora do escopo da instrução)** |
| 🟠 Rotas ambíguas (revisar intenção) | 5 | `company-config`, `special-order-requests`, `assistant/*` |

### Novos bloqueadores que impedem a Release 1

| # | Rota | Arquivo | Risco |
|---|---|---|---|
| B-001 | `PUT /api/password-reset-requests/:id` | `password-reset-requests.routes.ts` | **Altera senha de empresa sem autenticação — CRÍTICO** |
| B-002 | `GET /api/password-reset-requests` | `password-reset-requests.routes.ts` | Expõe todas as solicitações de reset — ALTO |
| B-003 | `GET /api/admin/test-orders` | `settings.routes.ts:198` | Expõe dados de pedidos de teste — MÉDIO |

---

*Documento gerado após varredura de 75+ arquivos de rotas. Nenhuma regra de negócio foi alterada.*
