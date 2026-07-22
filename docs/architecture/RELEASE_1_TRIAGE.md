# RELEASE 1 — TRIAGEM DE DÍVIDA TÉCNICA
**VivaFrutaz ERP · Data: 2026-07-22 · Modo: read-only — nenhum arquivo alterado**

> Este documento reclassifica as 36 inconsistências catalogadas em `RELEASE_1_CONSISTENCY_AUDIT.md`
> à luz do escopo oficial da Release 1 e dos módulos congelados.

---

## Módulos Congelados (fora do escopo da Release 1)

| Módulo | Status |
|---|---|
| Fiscal / NF-e | ❄️ Congelado |
| Financeiro / Finance | ❄️ Congelado |
| Cobrança / Billing | ❄️ Congelado |
| Boletos / PIX | ❄️ Congelado |
| Banking (Itaú) | ❄️ Congelado |
| SaaS / Marketplace | ❄️ Congelado |
| White-label | ❄️ Congelado |

---

## ETAPA 1 — Reanálise Individual das 36 Inconsistências

| # | Arquivo principal | Escopo R1? | Módulo congelado? | Pode esperar? | Bloqueia produção? |
|---|---|:---:|:---:|:---:|:---:|
| **TD-001** | `server/routes/routes.ts` — god file 4 k linhas, handlers com `db` direto | ✅ Sim | ❌ Não | ✅ Sim | ❌ Não |
| **TD-002** | `server/services/storage.ts` — god class 3 k linhas | ✅ Sim | ❌ Não | ✅ Sim | ❌ Não |
| **TD-003** | `server/routes/saas.routes.ts` — mutações sem `requireRole` | ❌ Não | ✅ SaaS | ✅ Sim | ❌ Não |
| **TD-004** | `server/routes/client-contract-scope.routes.ts` — sem autenticação alguma | ✅ Sim | ❌ Não | ❌ Não | ✅ **Sim** |
| **TD-005** | `server/modules/logistics/logistics.controller.ts` — SQL direto + repo via cast | ✅ Sim | ❌ Não | ✅ Sim | ❌ Não |
| **TD-006** | `server/routes/system-versions.routes.ts` — mutações sem `requireRole` | ✅ Sim | ❌ Não | ❌ Não | ✅ **Sim** |
| **TD-007** | `server/routes/clara.routes.ts` — training mutations sem `requireRole` | ✅ Sim | ❌ Não | ✅ Sim | ❌ Não |
| **TD-008** | `server/routes/email.routes.ts` — sem autenticação | ✅ Sim | ❌ Não | ❌ Não | ✅ **Sim** |
| **TD-009** | `server/jobs/faturamento.cron.ts` — `db` direto, job fiscal | ❌ Não | ✅ Fiscal/NF-e | ✅ Sim | ❌ Não |
| **TD-010** | `server/jobs/recurring-orders.cron.ts` — `db` direto + queries inline | ✅ Sim | ❌ Não | ✅ Sim | ❌ Não |
| **TD-011** | `server/modules/finance/finance.repository.ts` — sem interface; cross-domain nfe | ❌ Não | ✅ Financeiro/NF-e | ✅ Sim | ❌ Não |
| **TD-012** | `server/modules/orders/orders.repository.ts` — sem interface; cross-domain AR | ✅ Sim | ❌ Não | ✅ Sim | ❌ Não |
| **TD-013** | `server/modules/logistics/auto-dispatch.service.ts` — `db.execute` direto | ✅ Sim | ❌ Não | ✅ Sim | ❌ Não |
| **TD-014** | `server/modules/billing/billing.service.ts` — `db.select` direto em service | ❌ Não | ✅ Cobrança/SaaS | ✅ Sim | ❌ Não |
| **TD-015** | `server/modules/banking/itau/retorno.service.ts` — cross-domain via repo | ❌ Não | ✅ Financeiro/Banking | ✅ Sim | ❌ Não |
| **TD-016** | `server/modules/orders/orders.service.ts` — `userRole:"CLIENT"` hardcoded 3× | ✅ Sim | ❌ Não | ✅ Sim | ❌ Não |
| **TD-017** | `server/modules/orders/orders.service.ts` — `assertPeriodOpen` duplicado 6× | ✅ Sim | ❌ Não | ✅ Sim | ❌ Não |
| **TD-018** | `server/modules/orders/orders.service.ts` — métodos >200 linhas | ✅ Sim | ❌ Não | ✅ Sim | ❌ Não |
| **TD-019** | `server/modules/auth/auth.controller.ts` — session management inline | ✅ Sim | ❌ Não | ✅ Sim | ❌ Não |
| **TD-020** | `server/modules/fiscal/fiscal.controller.ts` — CSV/XLSX inline | ❌ Não | ✅ Fiscal | ✅ Sim | ❌ Não |
| **TD-021** | `server/modules/companies/companies.controller.ts` — `crypto.randomBytes` inline | ✅ Sim | ❌ Não | ✅ Sim | ❌ Não |
| **TD-022** | `server/modules/products/products.repository.ts` — cross-domain `orders` | ✅ Sim | ❌ Não | ✅ Sim | ❌ Não |
| **TD-023** | `server/modules/users/users.repository.ts` — side-effect billing em repository | ✅ Sim | ❌ Não | ✅ Sim | ❌ Não |
| **TD-024** | `server/routes/routes.ts:201` — cron de limpeza inline em arquivo de rotas | ✅ Sim | ❌ Não | ✅ Sim | ❌ Não |
| **TD-025** | `server/modules/nfe/nfe-persist.transaction.ts` — cross-module billing | ❌ Não | ✅ NF-e | ✅ Sim | ❌ Não |
| **TD-026** | `about-us`, `admin-intelligence`, `fiscal-diagnostics`, `executive-dashboard`, `audit.routes.ts` — lógica inline | ✅ Parcial* | ❌ Não | ✅ Sim | ❌ Não |
| **TD-027** | 3 implementações paralelas de middleware de auth | ✅ Sim | ❌ Não | ✅ Sim | ❌ Não |
| **TD-028** | 3 caminhos distintos de criação de entrega | ✅ Sim | ❌ Não | ✅ Sim | ❌ Não |
| **TD-029** | `server/modules/billing/billing.resolver.ts` — dead code sem import | ❌ Não | ✅ Cobrança | ✅ Sim | ❌ Não |
| **TD-030** | 8/9 repositories sem `expectOne()` | ✅ Sim | ❌ Não | ✅ Sim | ❌ Não |
| **TD-031** | 6/9 repositories sem interface `IXxxRepository` | ✅ Sim | ❌ Não | ✅ Sim | ❌ Não |
| **TD-032** | `server/services/aiDeveloper/labFunctions.ts` — 4 TODOs não implementados | ✅ Sim | ❌ Não | ✅ Sim | ❌ Não |
| **TD-033** | `server/modules/users/users.admin.routes.ts` — uso não confirmado | ✅ Sim | ❌ Não | ✅ Sim | ❌ Não |
| **TD-034** | `server/modules/products/products.controller.ts` — validação de preço inline | ✅ Sim | ❌ Não | ✅ Sim | ❌ Não |
| **TD-035** | `server/modules/ai/` — pasta declarada sem código | ✅ Sim | ❌ Não | ✅ Sim | ❌ Não |

> *TD-026: `fiscal-diagnostics.routes.ts` pertence ao módulo Fiscal (congelado). Os demais arquivos do grupo são de escopo R1.

---

## ETAPA 2 — Reclassificação em Quatro Grupos

---

### 🔴 BLOQUEADOR DA RELEASE

> Impedem colocar o ERP em produção. Falhas de segurança com dados de produção expostos ou ações não autorizadas possíveis.

| # | Inconsistência | Evidência no código | Risco concreto | Esforço |
|---|---|---|---|---|
| **TD-004** | `/api/client/contract-scope` e `/api/client/scope-change-request` sem nenhuma autenticação | `client-contract-scope.routes.ts` linhas 6 e 27 — `async (req, res)` sem qualquer middleware de auth | Qualquer pessoa na internet pode ler dados de contrato de clientes e submeter pedidos de alteração de escopo | 15 min |
| **TD-006** | `POST/PATCH/DELETE /api/system-versions` com `requireAuthCore` mas sem `requireRole` | `system-versions.routes.ts` linhas 20–60 — só `requireAuthCore`, sem `requireRole(['MASTER'])` | Qualquer usuário autenticado (inclusive clientes) pode aplicar uma "atualização de sistema" — risco de sabotagem ou corrupção de configuração | 15 min |
| **TD-008** | Todas as rotas `/api/email/*` sem autenticação | `email.routes.ts` linhas 12, 18, 29, 39, 49, 62, 118 — nenhum middleware de auth | Qualquer requisição não autenticada pode disparar broadcasts de email pelo sistema (spam, phishing com o domínio da VivaFrutaz) | 15 min |

**Total: 3 bloqueadores · Esforço total estimado: < 1 hora**

---

### 🟠 IMPORTANTE

> Não impedem o start em produção, mas expõem a operação a perda de dados, falha de segurança, corrupção de pedidos ou inconsistência operacional.

| # | Inconsistência | Risco operacional | Esforço |
|---|---|---|---|
| **TD-005** | `logistics.controller.ts` — SQL direto (`db.execute`) + acesso a repo privado via `(this.service as any).repo` | Falha de SQL não tratada em `routeTracking` chega ao cliente como 500 sem contexto; cálculo de ETA inline pode retornar dados incorretos em produção | 1–2 dias |
| **TD-007** | `POST/PUT/DELETE /api/clara-training` com `requireAuthCore` sem `requireRole` | Qualquer usuário autenticado pode modificar dados de treinamento da IA Clara — degradação intencional ou acidental do assistente operacional | 15 min |
| **TD-010** | `recurring-orders.cron.ts` — queries Drizzle inline fora do service layer | Job de pedidos recorrentes faz queries próprias que ignoram as regras de negócio do `ordersService`; possível geração de pedidos inconsistentes | 4 h |
| **TD-016** | `userRole: "CLIENT"` hardcoded em 3 locais do `orders.service.ts` | Logs de auditoria registram incorretamente ator como "CLIENT" em operações feitas por ADMIN/MASTER — rastreabilidade comprometida | 1 h |
| **TD-017** | `assertPeriodOpen` chamado individualmente 6× em `orders.service.ts` | Qualquer nova mutação adicionada sem o guard permite escrita fora do período fiscal — corrupção de pedidos | 4 h |
| **TD-019** | Session management e rotação de token inline no `auth.controller.ts` | Lógica de sessão no controller dificulta teste e auditoria; bug nesse fluxo afeta todos os logins | 4 h |
| **TD-027** | 3 implementações paralelas de middleware de autenticação (`requireAuth`, `requireAuthCore`, `authenticate`) | Auditoria de cobertura de rotas protegidas é imprecisa; comportamentos podem divergir silenciosamente entre as três versões | 1 dia |
| **TD-028** | 3 caminhos distintos de criação de entrega (afterCreate, createWithDelivery, POST /api/logistics/deliveries) | Rota de logística pode criar entregas desvinculadas de pedidos; risco de inconsistência operacional no despacho | 1 dia |
| **TD-026** | `about-us`, `admin-intelligence`, `executive-dashboard`, `audit.routes.ts` — lógica de negócio e `db` direto em route files (excluindo `fiscal-diagnostics`) | Erros de banco chegam ao handler sem tratamento; queries sem transação podem deixar estado parcial | 2–3 dias |

**Total: 9 itens**

---

### 🔵 DÍVIDA TÉCNICA

> Melhorias arquiteturais sem impacto operacional imediato. Devem entrar nas próximas waves de refatoração.

| # | Inconsistência | Categoria | Esforço |
|---|---|---|---|
| **TD-001** | `routes.ts` — god file ~4 k linhas, ~100+ endpoints com lógica inline | Arquitetural / migração em andamento | 3–5 sprints |
| **TD-002** | `storage.ts` — god class ~3 k linhas; migração wave-by-wave em curso | Arquitetural / migração em andamento | 2–4 sprints |
| **TD-012** | `orders.repository.ts` — sem interface `IOrdersRepository`; cross-domain `accountsReceivable` | Padrão repository | 4 h |
| **TD-013** | `auto-dispatch.service.ts` — `db.execute` direto em service de logística | Padrão repository | 4 h |
| **TD-018** | `orders.service.ts` — métodos `transition` (~232 linhas) e `substituteItem` (~241 linhas) | Complexidade / legibilidade | 1 dia |
| **TD-021** | `companies.controller.ts` — `crypto.randomBytes` inline | Responsabilidade de camada | 30 min |
| **TD-022** | `products.repository.ts` — cross-domain import de tabela `orders`; `SystemLogEntry` local | Padrão repository | 2 h |
| **TD-023** | `users.repository.ts` — side-effect `invalidateUsageCache` de billing | Inversão de dependência | 2 h |
| **TD-024** | `routes.ts:201` — cron de limpeza de logs inline, sem guard contra duplicação | Jobs / organização | 1 h |
| **TD-030** | 8/9 repositories sem `expectOne()` | Padrão repository | 4 h |
| **TD-031** | 6/9 repositories sem interface `IXxxRepository` | Testabilidade | 1 dia |
| **TD-032** | `labFunctions.ts` — 4 stubs com `// TODO: Implement` na IA Clara | Feature gap / AI | Desconhecida |
| **TD-033** | `users.admin.routes.ts` — export potencialmente não utilizado | Dead code | 30 min |
| **TD-034** | `products.controller.ts` — validação de preço inline | Padrão controller | 1 h |
| **TD-035** | `server/modules/ai/` — pasta declarada com apenas `README.md` | Organização | 30 min |

**Total: 15 itens**

---

### ❄️ CONGELADO

> Pertencem a módulos fora do escopo da Release 1. Removidos da fila. Entram em planejamento próprio quando o módulo for ativado.

| # | Inconsistência | Módulo congelado |
|---|---|---|
| **TD-003** | `saas.routes.ts` — mutações POST/PATCH/DELETE sem `requireRole(['MASTER'])` | SaaS |
| **TD-009** | `faturamento.cron.ts` — `db` direto, queries de elegibilidade fiscal inline | Fiscal / NF-e |
| **TD-011** | `finance.repository.ts` — sem interface; cross-domain `orders` + `nfeEmissoes`; log inline | Financeiro / NF-e |
| **TD-014** | `billing.service.ts` — `db.select().from(products)` direto | Cobrança / SaaS |
| **TD-015** | `banking/itau/retorno.service.ts` — importa `financeRepository` de outro domínio | Financeiro / Banking |
| **TD-020** | `fiscal.controller.ts` — CSV e XLSX building inline | Fiscal |
| **TD-025** | `nfe-persist.transaction.ts` — side-effect `invalidateUsageCache` de billing | NF-e |
| **TD-029** | `billing.resolver.ts` — dead code sem import encontrado | Cobrança |

**Total: 8 itens**

---

## ETAPA 3 — Saúde Arquitetural Recalculada

| Grupo | Qtde | Esforço estimado | Risco se ignorado |
|---|:---:|---|---|
| 🔴 **Bloqueadores** | **3** | < 1 hora total | **CRÍTICO** — dados de clientes expostos; emails não autorizados; updates de sistema por qualquer usuário |
| 🟠 **Importantes** | **9** | 2–3 semanas (paralelo) | **ALTO** — risco de corrupção de pedidos, audit log impreciso, entrega inconsistente, sessão frágil |
| 🔵 **Dívida técnica** | **15** | 4–8 sprints (waves) | **MÉDIO** — degradação progressiva de manutenibilidade; sem impacto funcional imediato |
| ❄️ **Congelados** | **8** | fora do escopo R1 | **BAIXO para R1** — risco zero para a operação interna atual |
| **Total** | **35*** | — | — |

> *O RELEASE_1_CONSISTENCY_AUDIT.md lista 36 itens; a diferença de 1 decorre de TD-026 agrupar 5 arquivos de rotas que o audit original pode ter contado separadamente.

### Distribuição visual

```
Bloqueadores  ████░░░░░░░░░░░░░░░░░░░░░░  3  (  9% — urgente)
Importantes   ████████████░░░░░░░░░░░░░░  9  ( 26% — próxima wave)
Dívida Téc.   ██████████████████████░░░░ 15  ( 43% — waves futuras)
Congelados    ████████████░░░░░░░░░░░░░░  8  ( 23% — fora de escopo)
```

### Pontos positivos confirmados no código

- Pipeline de criação de pedidos: **unificado** — 1 caminho oficial (`ordersService.create/createInternal`)
- Transação atômica na transição de pedido: **implementada** (`orders.transaction.ts`)
- Outbox worker: **correto** — padrão transactional outbox com `.unref()` e idempotência
- Controle de concorrência de cron jobs: **implementado** (`job-registry.ts`)
- Rate limiting (global + por usuário): **presente** (`rateLimit.ts`, `userRateLimit.ts`)
- Secrets via variáveis de ambiente: **correto** — nenhum hardcode encontrado
- `SESSION_SECRET` e `SUPABASE_DATABASE_URL` via `process.env`
- CORS com validação de origem antes do middleware: **implementado** (`app.ts:56`)
- Body size limit: **configurado** (`25mb` — `express.json` + `urlencoded`)
- ErrorBoundary no frontend: **presente**

---

## ETAPA 4 — O ERP consegue operar a VivaFrutaz internamente hoje?

### Resposta: NÃO — com ressalva cirúrgica

O ERP está **operacionalmente funcional** — pedidos são criados, processados, entregues e auditados por um pipeline estável e unificado. A infraestrutura de autenticação, sessão, rate limiting e jobs funciona corretamente.

**O que exatamente impede a ida a produção:**

#### Bloqueador 1 — TD-004: Dados de contrato de clientes expostos sem autenticação
```
GET  /api/client/contract-scope      → sem requireAuth
POST /api/client/scope-change-request → sem requireAuth
```
Evidência direta: `client-contract-scope.routes.ts` linhas 6 e 27. Qualquer pessoa com acesso à URL do sistema pode ler os dados de escopo contratual de clientes e submeter alterações de contrato.

#### Bloqueador 2 — TD-006: Qualquer usuário autenticado pode aplicar "atualizações de sistema"
```
POST   /api/system-versions   → requireAuthCore apenas (sem requireRole)
PATCH  /api/system-versions/* → requireAuthCore apenas
DELETE /api/system-versions/* → requireAuthCore apenas
```
Evidência direta: `system-versions.routes.ts` linhas 20–60. Um usuário CLIENT autenticado pode executar essas mutações.

#### Bloqueador 3 — TD-008: Emails do sistema disparáveis sem autenticação
```
POST /api/email/broadcast        → sem middleware
POST /api/email/send-order-event → sem middleware
GET  /api/email/schedules        → sem middleware
```
Evidência direta: `email.routes.ts` — nenhum middleware de autenticação em nenhum dos 7 handlers. Permite uso como relay de spam ou phishing com identidade da VivaFrutaz.

---

**O que falta apenas para melhorar** (não bloqueia, entra nas próximas waves):

- Consolidar os 3 middlewares de auth em um único (`requireAuth`)
- Centralizar `assertPeriodOpen` com decorator ou hook de pré-execução
- Extrair lógica de delivery para um caminho único
- Migrar progressivamente `routes.ts` e `storage.ts` para o padrão modular

---

*Documento gerado por triagem read-only em 2026-07-22. Nenhum arquivo de código foi alterado.*
