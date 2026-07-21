# NORMALIZATION REPORT
## Portal VivaFrutaz ERP — Fase 1: Normalização Arquitetural

**Data:** 2026-07-21  
**Validação:** `npx tsc --noEmit` → **0 erros**  
**Importadores quebrados:** 0  
**Comportamento alterado:** Nenhum

---

## Resumo Executivo

| Conflito | Status |
|----------|--------|
| DB Client (triplicado) | ✅ Resolvido |
| asyncHandler (duplicado) | ✅ Resolvido |
| apiResponse (duplicado) | ✅ Resolvido |
| rateLimit (homônimos diferentes) | ✅ Resolvido |
| securityLogger (naming conflitante) | ✅ Resolvido |
| alertEngine vs alert-engine | ✅ Resolvido |

---

## 1. Arquivos Alterados

### 1.1 `server/shared/db/client.ts`
- **O quê:** Header de clareza adicionado; re-export `pool` incluído além de `db`
- **Por quê:** Tornava opaca a cadeia de 3 arquivos para o mesmo cliente Drizzle
- **Comportamento:** Idêntico — re-export de `server/database/db.ts`

### 1.2 `server/shared/db/index.ts`
- **O quê:** Header de clareza adicionado; re-export `pool` incluído
- **Por quê:** Documentar a cadeia completa e indicar o caminho canônico
- **Comportamento:** Idêntico — re-export de `./client`

### 1.3 `server/shared/utils/asyncHandler.ts`
- **O quê:** Conteúdo substituído por re-export de `core/http/asyncHandler`
- **Por quê:** Havia duas implementações idênticas; consolidar em única fonte da verdade
- **Comportamento:** Idêntico — mesma função `asyncHandler` com suporte a generics

### 1.4 `server/shared/utils/apiResponse.ts`
- **O quê:** Conteúdo substituído por re-export de `core/http/apiResponse`
- **Por quê:** Havia duas implementações idênticas; consolidar em única fonte da verdade
- **Comportamento:** Idêntico — mesmas funções `ok`, `created`, `noContent`, `fail` + tipos

### 1.5 `server/core/http/rateLimit.ts`
- **O quê:** Conteúdo substituído por re-export de `./api-rate-limit`
- **Por quê:** Arquivo renomeado para `api-rate-limit.ts` para distinguir claramente do arquivo homônimo em `core/security/rateLimit.ts`
- **Comportamento:** Idêntico — re-export de `simpleRateLimit`

### 1.6 `server/core/audit/security-logger.ts`
- **O quê:** Conteúdo substituído por re-export de `./audit-logger`
- **Por quê:** Arquivo renomeado para `audit-logger.ts` para eliminar a confusão com `core/security/securityLogger.ts`
- **Comportamento:** Idêntico — re-export de `logSecurityEvent`, `classifyRoleRisk` + tipos

### 1.7 `server/core/security/securityLogger.ts`
- **O quê:** Header do arquivo expandido com clareza de propósito e distinção explícita de `audit-logger.ts`
- **Por quê:** Dois arquivos com `logSecurityEvent` de assinaturas diferentes; header elimina a ambiguidade
- **Comportamento:** Idêntico — nenhuma linha lógica alterada

### 1.8 `server/core/security/alertEngine.ts`
- **O quê:** Header do arquivo expandido com clareza de propósito e distinção de `risk-evaluator.ts`
- **Por quê:** `alertEngine.ts` e `alert-engine.ts` tinham nomes confusamente parecidos mas responsabilidades opostas
- **Comportamento:** Idêntico — nenhuma linha lógica alterada

### 1.9 `server/core/alerts/alert-engine.ts`
- **O quê:** Conteúdo substituído por re-export de `./risk-evaluator`
- **Por quê:** Nome `alert-engine` era enganoso — o arquivo não é um engine de alertas, re-exporta `makeDecisions` do policy engine
- **Comportamento:** Idêntico — re-export de `evaluateRisk` (alias para `makeDecisions`)

---

## 2. Arquivos Criados (Fontes da Verdade)

### 2.1 `server/core/http/api-rate-limit.ts` ✨ NOVO
- **Conteúdo:** Conteúdo integral do antigo `core/http/rateLimit.ts` (42 linhas)
- **Propósito:** Rate limiter simples e genérico por IP (60 req/min, sem auth, sem audit)
- **Export:** `simpleRateLimit`

### 2.2 `server/core/audit/audit-logger.ts` ✨ NOVO
- **Conteúdo:** Conteúdo integral do antigo `core/audit/security-logger.ts` (126 linhas)
- **Propósito:** Logger de auditoria estruturado — persiste `SEC:<action>` na tabela `systemLogs` via `storage.createLog()`
- **Exports:** `logSecurityEvent(SecurityEventPayload)`, `classifyRoleRisk`, tipos
- **Distinção:** Usa `SecurityEventPayload` (estruturado, com `tenantScope`, `intent`, `allowed`); diferente do `SecurityEvent` do `securityLogger.ts`

### 2.3 `server/core/alerts/risk-evaluator.ts` ✨ NOVO
- **Conteúdo:** Conteúdo do antigo `core/alerts/alert-engine.ts` (1 linha)
- **Propósito:** Re-exporta `makeDecisions` como `evaluateRisk` do policy decision engine
- **Export:** `evaluateRisk`

---

## 3. Arquivos Preservados (Sem Alteração Lógica)

| Arquivo | Status |
|---------|--------|
| `server/database/db.ts` | ✅ Intacto — fonte da verdade do Drizzle |
| `server/core/http/asyncHandler.ts` | ✅ Intacto — fonte da verdade do asyncHandler |
| `server/core/http/apiResponse.ts` | ✅ Intacto — fonte da verdade do apiResponse |
| `server/core/security/rateLimit.ts` | ✅ Intacto — suite completa de rate limiting de segurança |
| Todos os importadores existentes | ✅ Intactos — zero arquivos de consumo alterados |

---

## 4. Re-exports Criados

| Re-export (caminho legado) | Aponta para (fonte da verdade) | Importadores existentes |
|---------------------------|-------------------------------|------------------------|
| `shared/db/client.ts` | `database/db.ts` | 0 (ninguém importava) |
| `shared/db/index.ts` | `shared/db/client.ts` | 0 (ninguém importava) |
| `shared/utils/asyncHandler.ts` | `core/http/asyncHandler.ts` | 4 arquivos (orders, users) |
| `shared/utils/apiResponse.ts` | `core/http/apiResponse.ts` | 2 arquivos (orders controllers) |
| `core/http/rateLimit.ts` | `core/http/api-rate-limit.ts` | 1 arquivo (routes/routes.ts) |
| `core/audit/security-logger.ts` | `core/audit/audit-logger.ts` | 6 arquivos (route files) |
| `core/alerts/alert-engine.ts` | `core/alerts/risk-evaluator.ts` | 0 (ninguém importava) |

---

## 5. Conflitos Resolvidos

### C1 — DB Client triplicado
**Antes:** `database/db.ts` → `shared/db/client.ts` → `shared/db/index.ts` (cadeia opaca, sem documentação)  
**Depois:** Cadeia preservada; cada arquivo documenta explicitamente seu papel e aponta para a fonte da verdade. Novo código deve importar diretamente de `database/db.ts`.

### C2 — asyncHandler duplicado
**Antes:** Duas implementações em `core/http/` e `shared/utils/`, módulos divididos entre os dois caminhos sem critério.  
**Depois:** Uma única implementação em `core/http/asyncHandler.ts`. `shared/utils/asyncHandler.ts` é re-export transparente. Nenhum importador precisa ser alterado.

### C3 — apiResponse duplicado
**Antes:** Duas implementações em `core/http/` e `shared/utils/`, docs ligeiramente diferentes, mesma API pública.  
**Depois:** Uma única implementação em `core/http/apiResponse.ts`. `shared/utils/apiResponse.ts` é re-export transparente com todos os tipos. Nenhum importador precisa ser alterado.

### C4 — rateLimit homônimos com responsabilidades diferentes
**Antes:** Dois arquivos chamados `rateLimit.ts` em `core/http/` (42 linhas, simples) e `core/security/` (508 linhas, suite completa). Nenhuma documentação os distinguia.  
**Depois:**
- `core/http/rateLimit.ts` → re-export legado de `api-rate-limit.ts`
- `core/http/api-rate-limit.ts` → **NOVO** fonte da verdade do limiter simples
- `core/security/rateLimit.ts` → preservado intacto, header clarifica que é a suite de segurança  
Nenhum importador precisa ser alterado (re-export transparente).

### C5 — securityLogger naming conflitante
**Antes:** `core/security/securityLogger.ts` (in-memory, sem DB) e `core/audit/security-logger.ts` (grava no DB), ambos exportando uma função chamada `logSecurityEvent` com assinaturas completamente diferentes. Risco alto de importar o errado.  
**Depois:**
- `core/audit/security-logger.ts` → re-export legado de `audit-logger.ts`
- `core/audit/audit-logger.ts` → **NOVO** fonte da verdade, nome honesto
- `core/security/securityLogger.ts` → preservado intacto, header expandido esclarece distinção  
Os 6 importadores de `security-logger.ts` continuam funcionando via re-export.

### C6 — alertEngine vs alert-engine
**Antes:** `core/security/alertEngine.ts` (engine real, 126 linhas) e `core/alerts/alert-engine.ts` (1 linha re-export do decision engine). Nome quase idêntico, naturezas opostas.  
**Depois:**
- `core/alerts/alert-engine.ts` → re-export legado de `risk-evaluator.ts`
- `core/alerts/risk-evaluator.ts` → **NOVO** nome honesto para o re-export do decision engine
- `core/security/alertEngine.ts` → preservado intacto, header expandido esclarece distinção  
Nenhum importador precisou ser alterado (ninguém importava `alert-engine.ts`).

---

## 6. Conflitos Restantes

> Nenhum conflito dos 6 identificados permanece em aberto.

Os itens abaixo são **inconsistências existentes conhecidas** que ficam para Fase 2 (renomeação kebab-case) e Fase 3+ conforme o plano arquitetural em `ARCHITECTURE_REORGANIZATION.md`:

| Item | Descrição | Fase |
|------|-----------|------|
| camelCase vs kebab-case | `securityLogger.ts`, `alertEngine.ts`, `authCore.service.ts`, etc. | Fase 2 |
| `storage.ts` deus-objeto | 2400+ linhas, toda lógica de DB em um arquivo | Fase Futura |
| 62 rotas planas em `routes/` | Sem agrupamento por domínio | Fase 3 |
| `server/controllers/` legado | `userController.ts` órfão | Fase 3 |
| Módulos placeholder | `ai/`, `purchases/`, `reports/`, `sales/` (README only) | Fase 3 |

---

## 7. Riscos Eliminados

| Risco | Eliminado? |
|-------|-----------|
| Dev importar `asyncHandler` de `shared/utils/` e obter implementação divergente | ✅ Ambos agora são a mesma implementação |
| Dev importar `apiResponse` de `shared/utils/` e obter envelope diferente | ✅ Ambos agora são a mesma implementação |
| Dev chamar `logSecurityEvent` da `audit/security-logger` quando queria a do `security/securityLogger` | ✅ Renomeado para `audit-logger`; nomes agora claramente distintos |
| Dev importar `alert-engine` achando que é o engine de alertas operacionais | ✅ Renomeado para `risk-evaluator`; nome agora honesto |
| Dev criar novo rate limiter simples desconhecendo a suite em `core/security/` | ✅ `api-rate-limit.ts` documenta a distinção explicitamente |
| Novo código em `shared/utils/` divergir de `core/http/` silenciosamente | ✅ `shared/utils/` agora são re-exports; não há conteúdo a divergir |

---

## 8. Instrução para Novo Código

```typescript
// ✅ DB
import { db } from "../../database/db";

// ✅ asyncHandler
import { asyncHandler } from "../../core/http/asyncHandler";

// ✅ apiResponse
import { ok, created, noContent, fail } from "../../core/http/apiResponse";

// ✅ Rate limiting simples (entry-point guard)
import { simpleRateLimit } from "../../core/http/api-rate-limit";

// ✅ Rate limiting de segurança (login, NF-e, admin, sensitive actions)
import { loginIpLimiter, nfeLimiter, adminLimiter } from "../../core/security/rateLimit";

// ✅ Logger de auditoria (persiste no DB)
import { logSecurityEvent } from "../../core/audit/audit-logger";
// Assinatura: logSecurityEvent(SecurityEventPayload)

// ✅ Logger de segurança in-memory (dashboard runtime)
import { logSecurity, logSecurityEvent } from "../../core/security/securityLogger";
// Assinatura: logSecurityEvent(Omit<SecurityEvent, "timestamp">)

// ✅ Alert engine operacional (buffer in-memory)
import { pushAlert, getAlerts } from "../../core/security/alertEngine";

// ✅ Risk evaluator (policy decisions)
import { evaluateRisk } from "../../core/alerts/risk-evaluator";
```
