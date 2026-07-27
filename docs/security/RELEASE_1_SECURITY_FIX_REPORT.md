# RELEASE 1 — SECURITY FIX REPORT
**Data:** 2026-07-27 · **Escopo:** Eliminação dos 4 bloqueadores documentados em `COMPLETE_ENDPOINT_SECURITY_AUDIT.md`

---

## Resumo

| Bloqueador | Arquivo | Endpoint | Risco original | Status |
|---|---|---|---|---|
| V-01 | `password-reset-requests.routes.ts:7` | `GET /api/password-reset-requests` | Crítico — sem auth | ✅ CORRIGIDO |
| V-02 | `password-reset-requests.routes.ts:16` | `PUT /api/password-reset-requests/:id` | Crítico — altera senha sem auth | ✅ CORRIGIDO |
| V-03 | `settings.routes.ts:198` | `GET /api/admin/test-orders` | Alto — endpoint admin sem auth | ✅ CORRIGIDO |
| V-04 | `products.routes.ts:35` + controller | `PATCH /api/products/:id/out-of-season` | Médio — userId=null passava ao serviço | ✅ CORRIGIDO |

---

## Detalhes de cada correção

### V-01 — `GET /api/password-reset-requests`
**Arquivo:** `server/routes/password-reset-requests.routes.ts`

**Problema:** Endpoint sem qualquer middleware de autenticação. Qualquer ator anônimo podia listar todas as solicitações de reset de senha em aberto.

**Correção aplicada:**
```diff
+ import { requireAuth as requireAuthCore, requireRole } from "../core/http/requireAuth";
+ const RESET_ROLES = ['MASTER', 'ADMIN'] as const;

- app.get('/api/password-reset-requests', async (req, res) => {
+ app.get('/api/password-reset-requests', requireAuthCore, requireRole([...RESET_ROLES]), async (req, res) => {
```

**Comportamento preservado:** Handler inalterado. Apenas MASTER e ADMIN podem listar as solicitações, que é o uso legítimo registrado no sistema.

---

### V-02 — `PUT /api/password-reset-requests/:id`
**Arquivo:** `server/routes/password-reset-requests.routes.ts`

**Problema:** Endpoint sem qualquer middleware de autenticação. A operação `storage.updateCompany(pr.companyId, { password: newPassword })` era alcançável por qualquer ator anônimo, permitindo alterar a senha de qualquer empresa.

**Correção aplicada:**
```diff
- app.put('/api/password-reset-requests/:id', async (req, res) => {
+ app.put('/api/password-reset-requests/:id', requireAuthCore, requireRole([...RESET_ROLES]), async (req, res) => {
```

**Comportamento preservado:** Handler e lógica de negócio (aprovação/rejeição, envio de email) inalterados. Apenas MASTER e ADMIN podem executar a operação.

---

### V-03 — `GET /api/admin/test-orders`
**Arquivo:** `server/routes/settings.routes.ts`

**Problema:** Endpoint no namespace `/api/admin/` sem qualquer middleware de autenticação. `requireAuthCore` já estava importado no arquivo (usado por outros handlers) — ausência foi omissão direta.

**Correção aplicada:**
```diff
- app.get('/api/admin/test-orders', async (req, res) => {
+ app.get('/api/admin/test-orders', requireAuthCore, requireRole(['MASTER', 'ADMIN', 'DEVELOPER']), async (req, res) => {
```

**Comportamento preservado:** Handler inalterado. Roles escolhidas (`MASTER`, `ADMIN`, `DEVELOPER`) são consistentes com o padrão já usado pelo endpoint adjacente `POST /api/settings/test-mode` (que usa verificação inline equivalente).

---

### V-04 — `PATCH /api/products/:id/out-of-season`
**Arquivo:** `server/modules/products/products.routes.ts`

**Problema:** O controller chamava `getSessionUserId(req)` sem verificar se retornou `null` antes de passar `userId` ao serviço — diferente de `create`, `update` e `delete` do mesmo controller, que bloqueavam explicitamente com `if (!userId) return res.status(401)`. Um ator anônimo podia alterar o flag de sazonalidade de qualquer produto.

**Correção aplicada:** Adicionado `requireSession` como middleware na rota (consistente com o padrão já estabelecido para os GETs do mesmo router):
```diff
- router.patch("/:id/out-of-season", (req, res) => productController.setOutOfSeason(req, res));
+ router.patch("/:id/out-of-season", requireSession, (req, res) => productController.setOutOfSeason(req, res));
```

**Comportamento preservado:** Controller inalterado. `requireSession` aceita `session.userId` OU `session.companyId` — coerente com o acesso misto (admin e portal cliente) que o módulo de produtos já suporta nos GETs.

---

## Validações executadas

### `npx tsc --noEmit`
```
✅ Sem erros — saída vazia
```

### `npm run check` (tsc padrão do projeto)
```
✅ Sem erros
```

### `npm run check:strict`
```
⚠️ 35 erros em logistics.controller.ts (requestId) e orders.repository.ts (possibly undefined)
→ PRÉ-EXISTENTES: confirmado via git stash antes/depois — mesmos erros sem as correções
→ Nenhuma regressão introduzida pelas correções da Release 1
```

### `npm test`
```
# tests 106
# pass  100
# fail    6
→ PRÉ-EXISTENTES: confirmado via git stash — mesmo resultado (100/106) antes das correções
→ Nenhuma regressão introduzida
```

---

## Varredura de confirmação pós-correção

Grep nos 4 endpoints após aplicação das correções:

```
password-reset-requests.routes.ts:10
  app.get('/api/password-reset-requests', requireAuthCore, requireRole([...RESET_ROLES]), ...)
  ✅ requireAuthCore + requireRole(['MASTER','ADMIN'])

password-reset-requests.routes.ts:19
  app.put('/api/password-reset-requests/:id', requireAuthCore, requireRole([...RESET_ROLES]), ...)
  ✅ requireAuthCore + requireRole(['MASTER','ADMIN'])

settings.routes.ts:199
  app.get('/api/admin/test-orders', requireAuthCore, requireRole(['MASTER','ADMIN','DEVELOPER']), ...)
  ✅ requireAuthCore + requireRole(['MASTER','ADMIN','DEVELOPER'])

products.routes.ts:36
  router.patch("/:id/out-of-season", requireSession, ...)
  ✅ requireSession
```

---

## Arquivos modificados

| Arquivo | Linhas alteradas | Tipo de mudança |
|---|---|---|
| `server/routes/password-reset-requests.routes.ts` | +11 / -8 | Import + middleware em 2 handlers |
| `server/routes/settings.routes.ts` | +2 / -1 | Middleware em 1 handler |
| `server/modules/products/products.routes.ts` | +3 / -2 | Middleware em 1 rota |

**Nenhuma regra de negócio alterada. Nenhum handler modificado. Nenhum arquivo criado fora de `docs/security/`.**

---

*Correções aplicadas em 2026-07-27. Fonte de verdade: `docs/security/COMPLETE_ENDPOINT_SECURITY_AUDIT.md`.*
