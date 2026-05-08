# MT-3D — Riscos Residuais Catalogados

**Data:** 2026-05-08  
**Status:** Baseline oficial — nenhum desses riscos bloqueia produção multi-tenant

---

## Sumário

| Severidade | Quantidade |
|---|---|
| CRITICAL | 0 |
| HIGH | 0 |
| MEDIUM | 3 |
| LOW | 2 |
| **Total** | **5** |

---

## Riscos MEDIUM

### RR-M1: Logistics — Route Detail sem Tenant Filter

**Arquivo:** `server/modules/logistics/logistics.controller.ts:557`  
**Endpoint:** `GET /api/logistics/track/:routeId` (e stops/deliveries por routeId)  
**Descrição:** Queries de detalhamento de rota usam `WHERE lr.id = ${routeId}` sem filtro de `company_id`. Um usuário autenticado com `routeId` de outra empresa poderia ver os stops e deliveries dessa rota.  
**Mitigação atual:** Requer autenticação (session.userId check); `routeId` não é seqüencial público. Tenant context instalado pelo router-use quando há sessão.  
**Impacto:** Vazamento de dados logísticos (endereços de entrega, stops, status de rota) de outra empresa para usuário autenticado de empresa diferente.  
**Recomendação:** Adicionar `AND lr.company_id = currentTenantId()` nas queries de track. Fora do escopo MT-3D.  
**Risco aceitável para:** Plataforma de uso interno; usuários autenticados têm acesso controlado.

---

### RR-M2: Reports — companyId via Query Parameter

**Arquivo:** `server/routes/reports.routes.ts`  
**Endpoints:** `GET /api/reports/industrialized`, `GET /api/reports/purchasing`, `GET /api/reports/financial`  
**Descrição:** ADMIN ou DIRECTOR pode passar qualquer `companyId` como query parameter para ver relatórios de outra empresa. Não há validação de que o solicitante pertence à empresa do `companyId`.  
**Mitigação atual:** Gate `requireRole([ADMIN,DIRECTOR])` — apenas roles elevadas.  
**Impacto:** ADMIN de empresa A pode ver relatórios de empresa B passando `?companyId=B`.  
**Recomendação:** Adicionar validação: se não-MASTER, `companyId` deve ser `currentTenantId()`. Fora do escopo MT-3D.  
**Risco aceitável para:** ADMIN com role elevada e intencional.

---

### RR-M3: nfeEmissoes — Point Reads sem Tenant Filter na Camada de Storage

**Arquivo:** `server/services/storage.ts:2217,2222`  
**Métodos:** `getNfeEmissao(id)`, `getNfeEmissaoByOrderId(orderId)`  
**Descrição:** Métodos de storage não aplicam filtro de tenant — retornam qualquer NF-e pelo ID.  
**Mitigação atual:** Todos os callers de `getNfeEmissao(id)` em routes.ts chamam `validateOrderTenant(nfe.orderId)` ANTES de retornar dados ao usuário. NF-e sem `orderId` são bloqueadas com 403.  
**Impacto (teórico):** Se algum novo caller de `getNfeEmissao` for adicionado sem validateOrderTenant, haveria vazamento.  
**Recomendação:** Adicionar `companyId` como parâmetro obrigatório em `getNfeEmissao` para auto-enforcement. Fora do escopo MT-3D.  
**Risco aceitável para:** Todos os callers atuais são seguros; risco é de código futuro mal escrito.

---

## Riscos LOW

### RR-L1: email.routes.ts — Auth Manual (não requireAuthCore)

**Arquivo:** `server/routes/email.routes.ts`  
**Descrição:** Routes usam `if (!session.userId) return res.status(401)` ao invés de `requireAuthCore` middleware. Funcionalmente equivalente, mas inconsistente com o padrão do projeto.  
**Impacto:** Nenhum — comportamento é o mesmo. Apenas inconsistência de estilo.  
**Recomendação:** Migrar para `requireAuthCore` em refactor futuro.

---

### RR-L2: settings.routes.ts — company-config sem requireRole

**Arquivo:** `server/routes/settings.routes.ts:77,106`  
**Endpoints:** `PATCH /api/company-config`, `POST /api/company-settings/:empresaId`  
**Descrição:** Endpoints de configuração de empresa usam apenas `requireAuthCore` sem `requireRole`. Qualquer usuário autenticado pode alterar configurações de empresa.  
**Mitigação atual:** Operações apenas afetam a própria empresa do usuário (não cross-tenant).  
**Impacto:** Usuário de qualquer role pode modificar config da própria empresa — potencial vandalism interno.  
**Recomendação:** Adicionar `requireRole([ADMIN,MASTER])` nessas rotas.

---

## Riscos Descartados (Avaliados e Aceitos)

| Potencial Risco | Avaliação | Conclusão |
|---|---|---|
| `getNextNfeNumero()` sem tenant | Contador global por design — NF-e são sequenciais no sistema | DESCARTADO |
| `workflow_events` SELECT global no outbox | Fail-safe design — processamento usa `payload.companyId` | DESCARTADO |
| `continuousAudit.ts` raw SQL | Queries de `information_schema` — sem dados de negócio | DESCARTADO |
| `admin-intelligence` cross-tenant | Intencional, logado com logSecurityEvent CAMADA-2 | DESCARTADO |
| `audit.routes.ts` cross-tenant | Intencional, logado com logSecurityEvent CROSS_TENANT_READ | DESCARTADO |
| faturamento cron query global | runWithTenant por row antes de qualquer emissão | DESCARTADO |
