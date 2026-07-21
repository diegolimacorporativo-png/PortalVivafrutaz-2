# Reorganização Arquitetural — Portal VivaFrutaz

**Data:** 2026-07-21  
**Autor:** Tech Lead (Auditoria Completa)  
**Escopo:** Reorganização estrutural sem alteração de comportamento  
**Versão:** 1.0

---

## Índice

1. [Mapeamento da Estrutura Atual](#1-mapeamento-da-estrutura-atual)
2. [Diagnóstico de Problemas](#2-diagnóstico-de-problemas)
3. [Estrutura Proposta](#3-estrutura-proposta)
4. [Arquivos Alterados — Plano de Migração](#4-arquivos-alterados--plano-de-migração)
5. [Justificativas por Decisão](#5-justificativas-por-decisão)
6. [Lista de Riscos](#6-lista-de-riscos)
7. [Ordem de Execução Segura](#7-ordem-de-execução-segura)

---

## 1. Mapeamento da Estrutura Atual

### 1.1 Raiz do Projeto

```
/workspace
├── client/                  # Frontend React/Vite
├── server/                  # Backend Express
├── shared/                  # Schema Drizzle + rotas compartilhadas
├── migrations/              # SQL migrations (2 arquivos)
├── tests/                   # e2e (Playwright) + unit (Vitest) + regression
├── docs/                    # Documentação (security/, guides)
├── scripts/                 # Scripts de governança, chaos, ngrok, stress test
├── script/                  # Scripts de build e verificação (duplica /scripts)
├── backup/                  # Backup pontual de companies (1 arquivo)
├── backups/                 # Backups JSON/SQL acumulados (vários)
├── logs/                    # Logs de execução
├── uploads/products/        # Assets de upload
├── attached_assets/         # Assets estáticos do projeto
├── audit/                   # Relatórios de auditoria
├── tsconfig.json
├── vite.config.ts
├── drizzle.config.ts
├── ecosystem.config.js      # PM2 config
├── package.json
└── replit.md
```

### 1.2 Client — Estrutura Atual (`client/src/`)

```
client/src/
├── App.tsx                        # ~600 linhas: rotas + guards + providers
├── main.tsx                       # Entry point
├── index.css
│
├── components/
│   ├── ContextualTip.tsx          # Domínio: UX helper
│   ├── ErrorBoundary.tsx          # Infraestrutura
│   ├── FiscalInvoiceOCR.tsx       # Domínio: Fiscal
│   ├── FloatingGuide.tsx          # Domínio: UX
│   ├── FruitCuriosities.tsx       # Domínio: Marketing
│   ├── GlobalSearch.tsx           # Domínio: Busca
│   ├── Layout.tsx                 # Infraestrutura: Layout raiz
│   ├── Modal.tsx                  # UI genérico
│   ├── NfeDiagnosticsPanel.tsx    # Domínio: NF-e
│   ├── OrderTimeline.tsx          # Domínio: Pedidos
│   ├── PWAInstallPrompt.tsx       # Infraestrutura: PWA
│   ├── TrainingMode.tsx           # Domínio: IA/Treinamento
│   ├── VirtualAssistant.tsx       # Domínio: IA
│   ├── WhatsNewModal.tsx          # Domínio: Release notes
│   ├── banking/
│   │   └── ImportarRetornoCnab.tsx
│   ├── map/
│   │   └── LeafletRouteMap.tsx
│   ├── navigation/
│   │   └── BackHeader.tsx
│   └── ui/                        # ~60 componentes Shadcn (accordion → tooltip)
│
├── hooks/
│   ├── use-admin.ts               # Hook genérico de admin queries
│   ├── use-auth.ts                # Kebab-case
│   ├── use-can-emit-nfe.ts        # Kebab-case
│   ├── use-catalog.ts             # Kebab-case
│   ├── use-emitir-lote-nfe.ts     # Kebab-case
│   ├── use-force-release-nfe.ts   # Kebab-case
│   ├── use-mobile.tsx             # Kebab-case
│   ├── use-ordering.ts            # Kebab-case
│   ├── use-push-notifications.ts  # Kebab-case
│   ├── use-safe-query.ts          # Kebab-case
│   └── use-toast.ts               # Kebab-case
│
├── lib/
│   ├── apiV2.ts                   # Cliente HTTP tipado para /api/v2
│   ├── authErrors.ts              # Mapeamento de erros de auth
│   ├── biNormalizer.ts            # Domínio: BI/Dashboard
│   ├── danfe-generator.ts         # Domínio: NF-e (kebab vs camelCase)
│   ├── fetchWithAuth.ts           # Cliente HTTP de baixo nível
│   ├── incident-pdf-generator.ts  # Domínio: Incidentes (kebab)
│   ├── normalizeResponse.ts       # Utilitário de resposta
│   ├── periodo-fechado.ts         # Domínio: Fiscal (kebab)
│   ├── queryClient.ts             # React Query config
│   ├── safeArray.ts               # Utilitário genérico
│   └── utils.ts                   # Utilitários Tailwind (cn)
│
├── pages/
│   ├── admin/
│   │   ├── companies/
│   │   │   ├── components/        # Componentes específicos de companies
│   │   │   └── dialogs/tabs/      # Dialogs de companies
│   │   ├── orders/
│   │   │   ├── components/
│   │   │   └── dialogs/
│   │   ├── products/
│   │   │   ├── components/
│   │   │   ├── dialogs/
│   │   │   └── hooks/
│   │   │       └── useCategories.ts  # ⚠️ Camel case, fora de /hooks global
│   │   ├── reports/
│   │   ├── dashboard.tsx
│   │   ├── fiscal.tsx
│   │   ├── fiscal-config.tsx
│   │   ├── nfe.tsx
│   │   ├── ...~60 arquivos
│   ├── auth/
│   │   ├── login.tsx
│   │   ├── reset-password.tsx
│   │   └── change-password.tsx
│   ├── client/
│   │   ├── dashboard.tsx
│   │   ├── create-order.tsx       # Gerencia localStorage diretamente
│   │   ├── order-history.tsx
│   │   └── ...
│   ├── not-found.tsx
│   ├── test-clara.tsx
│   ├── track.tsx
│   └── driver-map.tsx
│
├── services/
│   └── nfe.service.ts             # ⚠️ Único arquivo no diretório
│
└── utils/
    └── priceResolver.ts            # ⚠️ Único arquivo no diretório
```

### 1.3 Server — Estrutura Atual (`server/`)

```
server/
├── app.ts                         # Express setup + registro de rotas
├── index.ts                       # Bootstrap + workers
│
├── bootstrap/
│   └── scheduler.ts               # Inicialização de jobs
│
├── config/
│   └── flags.ts                   # Feature flags
│
├── controllers/                   # ⚠️ LEGADO — diretório isolado
│   └── userController.ts          # Duplica lógica de modules/users/
│
├── core/                          # Cross-cutting concerns
│   ├── alerts/
│   │   ├── alert-engine.ts        # Re-export de decision.engine (kebab)
│   │   ├── alert-notifier.ts
│   │   └── operational-alerts.service.ts
│   ├── audit/
│   │   └── security-logger.ts     # ⚠️ Kebab: grava no DB
│   ├── auth/
│   │   ├── authCore.service.ts    # ⚠️ Camel: queries em auth_attempts
│   │   └── rateSchedule.ts
│   ├── context/
│   │   └── requestContext.ts
│   ├── decision/
│   │   └── decision.engine.ts
│   ├── errors/
│   │   └── errorHandler.ts
│   ├── events/
│   │   ├── event-analytics.engine.ts
│   │   ├── event-analytics.worker.ts
│   │   ├── event.emitter.ts
│   │   ├── event.repository.ts
│   │   ├── event-stream.processor.ts
│   │   ├── realtime-snapshot.writer.ts
│   │   └── realtime-state.store.ts
│   ├── fiscal/
│   │   └── homologation.guard.ts
│   ├── http/
│   │   ├── apiResponse.ts         # ⚠️ DUPLICADO com shared/utils/apiResponse.ts
│   │   ├── asyncHandler.ts        # ⚠️ DUPLICADO com shared/utils/asyncHandler.ts
│   │   ├── rateLimit.ts
│   │   ├── requireAuth.ts
│   │   ├── requireSessionOrCompany.ts
│   │   └── session.ts
│   ├── intelligence/
│   │   └── intelligence.engine.ts
│   ├── jobs/
│   │   └── job-registry.ts
│   ├── nfe/
│   │   └── fiscal-store.ts        # Storage NF-e isolado aqui
│   ├── observability/
│   │   ├── error-store.ts
│   │   ├── logger.ts
│   │   └── metrics.ts
│   ├── policy/
│   │   ├── policy-cache.ts
│   │   └── policy-engine.service.ts
│   ├── retry/
│   │   └── withRetry.ts
│   ├── security/
│   │   ├── alertEngine.ts         # ⚠️ Camel: buffer in-memory (≠ alert-engine.ts)
│   │   ├── anomalyDetection.service.ts
│   │   ├── authRead.service.ts
│   │   ├── continuousAudit.ts
│   │   ├── fiscalGuard.ts
│   │   ├── orderSecurity.ts
│   │   ├── protective-mode.service.ts
│   │   ├── queryFirewall.ts
│   │   ├── rateLimit.ts           # ⚠️ DUPLICADO com core/http/rateLimit.ts
│   │   ├── riskDerivation.service.ts
│   │   ├── schemaEnforcement.ts
│   │   ├── securityAnalytics.engine.ts
│   │   ├── securityAnalyzer.ts
│   │   ├── securityFlags.ts
│   │   ├── securityLogger.ts      # ⚠️ Camel: buffer in-memory (≠ audit/security-logger.ts)
│   │   ├── sessionGuard.ts
│   │   ├── tenantGuard.ts
│   │   └── userRateLimit.ts
│   ├── state/
│   │   └── system-state.ts
│   ├── tenant/
│   │   ├── context.ts
│   │   ├── safeQueryRouter.ts
│   │   └── scope.ts
│   └── validation/
│       └── validateRequest.ts
│
├── database/
│   └── db.ts                      # Instância real do Drizzle (fonte da verdade)
│
├── infra/                         # ⚠️ Limítrofe com services/
│   ├── pdfParser.ts
│   ├── README.md
│   └── upload.ts
│
├── jobs/
│   └── faturamento.cron.ts
│
├── middleware/
│   ├── auth.ts
│   ├── context.ts
│   ├── requestLogger.ts
│   └── tenant.ts
│
├── modules/                       # Módulos de domínio (padrão moderno)
│   ├── ai/         README apenas   # ⚠️ Placeholder
│   ├── auth/       Completo
│   ├── banking/    itau/ subpasta
│   ├── billing/    Sem .routes
│   ├── companies/  Completo
│   ├── finance/    Completo
│   ├── fiscal/     Sem .service/.repository
│   ├── inventory/  Completo
│   ├── logistics/  Completo
│   ├── nfe/        Sem .controller/.routes/.repository
│   ├── orders/     Completo (v1+v2)
│   ├── products/   Completo
│   ├── purchases/  README apenas   # ⚠️ Placeholder
│   ├── reports/    README apenas   # ⚠️ Placeholder
│   ├── sales/      README apenas   # ⚠️ Placeholder
│   ├── security/   Sem .routes
│   └── users/      Completo
│
├── routes/                        # ⚠️ 62+ arquivos planos (padrão legado)
│   ├── routes.ts                  # Registro central + rotas inlined
│   ├── about-us.routes.ts
│   ├── admin-intelligence.routes.ts
│   ├── alert.routes.ts
│   ├── announcements.routes.ts
│   ├── assistant.routes.ts
│   ├── audit.routes.ts
│   ├── backup.routes.ts
│   ├── bank.routes.ts
│   ├── certificates.routes.ts
│   ├── clara.routes.ts
│   ├── client-contract-scope.routes.ts
│   ├── client-intelligence.routes.ts
│   ├── company-validate.routes.ts
│   ├── contracts-alerts.routes.ts
│   ├── email.routes.ts
│   ├── email-scheduler.ts         # ⚠️ NÃO é rota — é serviço (mal alocado)
│   ├── empresa-config.routes.ts
│   ├── event.routes.ts
│   ├── executive-dashboard.routes.ts
│   ├── fiscal-diagnostics.routes.ts
│   ├── fiscal-invoices.routes.ts
│   ├── geocode.routes.ts
│   ├── governance.routes.ts
│   ├── health.routes.ts
│   ├── incidents.routes.ts
│   ├── logistics.routes.ts        # ⚠️ Duplica modules/logistics/logistics.routes.ts
│   ├── logs.routes.ts
│   ├── marketplace.routes.ts
│   ├── master.routes.ts
│   ├── nfe-dashboard.routes.ts
│   ├── observability.routes.ts
│   ├── operations.routes.ts
│   ├── order-cleanup.routes.ts
│   ├── order-exceptions.routes.ts
│   ├── order-windows.routes.ts
│   ├── password-reset-requests.routes.ts
│   ├── policy.routes.ts
│   ├── price-groups.routes.ts
│   ├── product-prices.routes.ts
│   ├── purchase-planning.routes.ts
│   ├── push.routes.ts
│   ├── quotations.routes.ts
│   ├── reports.routes.ts          # ⚠️ modules/reports/ existe (vazio)
│   ├── security.routes.ts         # ⚠️ modules/security/ existe (sem .routes)
│   ├── system-sync.routes.ts
│   ├── system-versions.routes.ts
│   ├── tasks.routes.ts
│   └── waste-control.routes.ts
│
├── scripts/                       # Scripts server-side
│
├── services/                      # ⚠️ Mistura infra + domínio
│   ├── aiDeveloper/               # Domínio: IA Developer
│   ├── financeiro/                # Domínio: Financeiro
│   ├── fiscal/                    # Domínio: Fiscal
│   ├── logistics/                 # Domínio: Logística
│   ├── nfe/                       # Domínio: NF-e (geração/SOAP/assinatura)
│   ├── alerts.service.ts          # Infra: alertas
│   ├── alerts.smart.ts
│   ├── alerts.delivery.ts
│   ├── alerts.digest.ts
│   ├── alerts.export.ts
│   ├── alerts.intelligence.ts
│   ├── alerts.preferences.ts
│   ├── alerts.proactive.ts
│   ├── alerts.routing.ts
│   ├── autoLearningModule.ts      # Camel: IA
│   ├── backup.ts                  # Infra: backup
│   ├── cache.ts                   # Infra: cache in-memory
│   ├── companySettingsService.ts  # Camel: settings
│   ├── email-scheduler.ts         # Infra: email (kebab)
│   ├── logger.ts                  # Infra: logger
│   ├── mailer.ts                  # Infra: email
│   ├── memoryModule.ts            # Camel: IA
│   ├── nf.draft.builder.ts        # Domínio: NF-e draft
│   ├── nf.draft.ts                # Domínio: NF-e draft
│   ├── pushService.ts             # Camel: infra push
│   └── storage.ts                 # ⚠️ DEUS OBJETO (2400+ linhas, toda lógica de DB)
│
├── shared/                        # ⚠️ Conflita conceitualmente com /core
│   ├── db/
│   │   ├── client.ts              # Re-export de database/db.ts (1 hop)
│   │   └── index.ts               # Re-export de shared/db/client.ts (2 hops)
│   ├── errors/
│   ├── middlewares/
│   └── utils/
│       ├── apiResponse.ts         # ⚠️ DUPLICADO com core/http/apiResponse.ts
│       └── asyncHandler.ts        # ⚠️ DUPLICADO com core/http/asyncHandler.ts
│
└── utils/                         # Utilitários genéricos
```

### 1.4 Shared (`shared/`)

```
shared/
├── schema.ts    # Drizzle ORM — todas as tabelas (>2000 linhas, ~100 tabelas)
└── routes.ts    # Constantes de rotas compartilhadas entre client/server
```

---

## 2. Diagnóstico de Problemas

### 2.1 Problemas Críticos (Risco Operacional)

| # | Problema | Localização | Impacto |
|---|----------|-------------|---------|
| C1 | **DB client triplicado**: instância real em `database/db.ts`, re-exportada por `shared/db/client.ts`, re-exportada de novo por `shared/db/index.ts` | `server/database/`, `server/shared/db/` | Confusão sobre qual importar; dificulta tracing de conexões |
| C2 | **`asyncHandler` duplicado**: duas implementações distintas, módulos importam de caminhos diferentes | `core/http/asyncHandler.ts` vs `shared/utils/asyncHandler.ts` | Comportamento ligeiramente diferente (generic types vs sem) sem que o dev saiba qual está usando |
| C3 | **`apiResponse` duplicado**: mesma API, docs diferentes, módulos divididos entre os dois | `core/http/apiResponse.ts` vs `shared/utils/apiResponse.ts` | Inconsistência de envelope de resposta imperceptível |
| C4 | **`rateLimit.ts` duplicado**: arquivo homônimo em duas subpastas de core | `core/http/rateLimit.ts` vs `core/security/rateLimit.ts` | Importações erradas silenciosas |
| C5 | **`securityLogger` vs `security-logger`**: dois arquivos de log de segurança com propósitos distintos mas nomes confusos | `core/security/securityLogger.ts` vs `core/audit/security-logger.ts` | Dev grava no errado sem perceber |
| C6 | **`alertEngine` vs `alert-engine`**: dois engines de alerta com comportamentos completamente diferentes | `core/security/alertEngine.ts` vs `core/alerts/alert-engine.ts` | Ambiguidade total de qual invocar |

### 2.2 Problemas de Organização (Risco de Manutenibilidade)

| # | Problema | Localização | Impacto |
|---|----------|-------------|---------|
| O1 | **NF-e espalhada por 3 camadas**: orchestração em `modules/nfe/`, geração/SOAP em `services/nfe/`, storage em `core/nfe/` | Server-wide | Nenhum dev sabe onde colocar nova lógica de NF-e |
| O2 | **62+ arquivos planos em `server/routes/`** sem agrupamento por domínio | `server/routes/` | Impossível navegar; duplica estrutura de `modules/` |
| O3 | **`server/services/` mistura infra e domínio**: `mailer.ts` (infra) ao lado de `nfe/` (domínio) | `server/services/` | Sem separação de camadas |
| O4 | **`server/shared/` vs `server/core/`**: dois diretórios com papel de "utilitários cross-cutting" | Ambos | Novo dev não sabe qual usar |
| O5 | **`server/controllers/` legado**: `userController.ts` isolado, fora do módulo `users/` | `server/controllers/` | Um arquivo órfão sem contexto |
| O6 | **`server/infra/` limítrofe**: `pdfParser.ts` e `upload.ts` sem clara distinção de `services/` | `server/infra/` | Duplicação conceitual |
| O7 | **`storage.ts` deus-objeto**: 2400+ linhas com métodos de todos os domínios | `server/services/storage.ts` | Impossível de testar, risco alto de merge conflict |
| O8 | **Módulos placeholder**: `ai/`, `purchases/`, `reports/`, `sales/` são só README | `server/modules/` | Polui o namespace de módulos reais |
| O9 | **`script/` vs `scripts/`**: dois diretórios de scripts na raiz | Raiz | Confusão de onde colocar novo script |
| O10 | **`backup/` vs `backups/`**: dois diretórios de backup | Raiz | Dificulta limpeza e automação |

### 2.3 Problemas de Convenção de Nomes

| # | Problema | Exemplos | Regra a Adotar |
|---|----------|----------|----------------|
| N1 | **Server: kebab vs camelCase misturados** no mesmo diretório | `security-logger.ts` + `securityLogger.ts` em `core/` | Kebab-case para todos os arquivos de servidor |
| N2 | **Client hooks: kebab inconsistente** com arquivo fora de `hooks/` | `use-auth.ts` (hooks/) vs `useCategories.ts` (pages/products/hooks/) | Todos hooks em `hooks/`, todos kebab-case |
| N3 | **`lib/` mistura utilitários com domínio** | `danfe-generator.ts`, `incident-pdf-generator.ts`, `biNormalizer.ts` em `lib/` | Lib = utilitários genéricos; domínio = `services/` ou pasta própria |
| N4 | **Componentes de domínio em `components/` raiz** | `NfeDiagnosticsPanel.tsx`, `FiscalInvoiceOCR.tsx`, `OrderTimeline.tsx` | Mover para `components/[domain]/` |
| N5 | **`services/` cliente com 1 arquivo** | `services/nfe.service.ts` | Crescer ou mesclar em `lib/` |
| N6 | **`utils/` cliente com 1 arquivo** | `utils/priceResolver.ts` | Mover para `lib/` |

---

## 3. Estrutura Proposta

### 3.1 Client — Estrutura Nova (`client/src/`)

```
client/src/
│
├── App.tsx                          # Reduzido: apenas roteamento + providers
├── main.tsx                         # Entry point (sem alteração de lógica)
├── index.css
│
├── providers/                       # ✨ NOVO — providers e contextos isolados
│   ├── QueryProvider.tsx            # React Query wrapper
│   ├── AuthProvider.tsx             # AuthExpiredHandler extraído do App.tsx
│   └── KeepAliveProvider.tsx        # KeepAlive extraído do App.tsx
│
├── components/
│   ├── ui/                          # Shadcn components (sem alteração)
│   │
│   ├── layout/                      # ✨ RENOMEADO de raiz → layout/
│   │   ├── Layout.tsx
│   │   ├── BackHeader.tsx           # Movido de navigation/
│   │   └── Modal.tsx
│   │
│   ├── feedback/                    # ✨ NOVO agrupamento
│   │   ├── ErrorBoundary.tsx
│   │   ├── ContextualTip.tsx
│   │   ├── FloatingGuide.tsx
│   │   └── PWAInstallPrompt.tsx
│   │
│   ├── nfe/                         # ✨ NOVO — componentes de domínio NF-e
│   │   └── NfeDiagnosticsPanel.tsx  # Movido de components/
│   │
│   ├── fiscal/                      # ✨ NOVO — componentes de domínio Fiscal
│   │   └── FiscalInvoiceOCR.tsx     # Movido de components/
│   │
│   ├── orders/                      # ✨ NOVO — componentes de domínio Pedidos
│   │   └── OrderTimeline.tsx        # Movido de components/
│   │
│   ├── ia/                          # ✨ NOVO — componentes de IA
│   │   ├── TrainingMode.tsx
│   │   └── VirtualAssistant.tsx
│   │
│   ├── common/                      # ✨ NOVO — componentes verdadeiramente genéricos
│   │   ├── GlobalSearch.tsx
│   │   ├── FruitCuriosities.tsx
│   │   └── WhatsNewModal.tsx
│   │
│   ├── banking/                     # Sem alteração (já correto)
│   │   └── ImportarRetornoCnab.tsx
│   │
│   └── map/                         # Sem alteração (já correto)
│       └── LeafletRouteMap.tsx
│
├── hooks/                           # Todos kebab-case
│   ├── use-admin.ts
│   ├── use-auth.ts
│   ├── use-can-emit-nfe.ts
│   ├── use-catalog.ts
│   ├── use-categories.ts            # ✨ RENOMEADO + CONSOLIDADO de useCategories.ts
│   ├── use-emitir-lote-nfe.ts
│   ├── use-force-release-nfe.ts
│   ├── use-mobile.tsx
│   ├── use-ordering.ts
│   ├── use-push-notifications.ts
│   ├── use-safe-query.ts
│   └── use-toast.ts
│
├── lib/                             # Apenas utilitários verdadeiramente genéricos
│   ├── api-client.ts                # ✨ CONSOLIDADO: fetchWithAuth + apiV2 unificados
│   ├── auth-errors.ts               # RENOMEADO: authErrors → auth-errors
│   ├── normalize-response.ts        # RENOMEADO: normalizeResponse → normalize-response
│   ├── periodo-fechado.ts           # Sem alteração (já kebab)
│   ├── query-client.ts              # RENOMEADO: queryClient → query-client
│   ├── safe-array.ts                # RENOMEADO: safeArray → safe-array
│   └── utils.ts                     # Tailwind cn() (sem alteração)
│
├── services/                        # Chamadas de API por domínio
│   ├── nfe.service.ts               # Sem alteração
│   ├── fiscal.service.ts            # ✨ EXTRAÍDO de lib/periodo-fechado.ts + lib/danfe-generator.ts
│   ├── incidents.service.ts         # ✨ EXTRAÍDO de lib/incident-pdf-generator.ts
│   └── bi.service.ts                # ✨ EXTRAÍDO de lib/biNormalizer.ts
│
├── pages/                           # Sem alteração de estrutura interna
│   ├── admin/
│   │   ├── products/hooks/          # ✨ REMOVIDO — useCategories migrado para hooks/
│   │   └── ...                      # Demais páginas sem alteração
│   ├── auth/
│   └── client/
│
└── utils/                           # ✨ ELIMINADO — priceResolver movido para lib/
    # priceResolver.ts → lib/price-resolver.ts
```

### 3.2 Server — Estrutura Nova (`server/`)

```
server/
├── app.ts                           # Sem alteração de lógica
├── index.ts                         # Sem alteração de lógica
│
├── bootstrap/
│   └── scheduler.ts                 # Sem alteração
│
├── config/
│   └── flags.ts                     # Sem alteração
│
├── core/                            # Cross-cutting: HTTP, erros, auth, eventos, observabilidade
│   │                                # REGRA: sem lógica de domínio aqui
│   ├── alerts/
│   │   ├── alert-engine.ts          # Sem alteração
│   │   ├── alert-notifier.ts        # Sem alteração
│   │   └── operational-alerts.service.ts
│   │
│   ├── audit/
│   │   └── security-logger.ts       # RENOMEADO internamente: clareza de propósito
│   │                                # "DB audit logger" — grava em audit_logs
│   │
│   ├── auth/
│   │   ├── auth-core.service.ts     # RENOMEADO: authCore.service → auth-core.service
│   │   └── rate-schedule.ts         # RENOMEADO: rateSchedule → rate-schedule
│   │
│   ├── context/
│   │   └── request-context.ts       # RENOMEADO: requestContext → request-context
│   │
│   ├── decision/
│   │   └── decision.engine.ts       # Sem alteração
│   │
│   ├── errors/
│   │   └── error-handler.ts         # RENOMEADO: errorHandler → error-handler
│   │
│   ├── events/
│   │   ├── event-analytics.engine.ts
│   │   ├── event-analytics.worker.ts
│   │   ├── event.emitter.ts
│   │   ├── event.repository.ts
│   │   ├── event-stream.processor.ts
│   │   ├── realtime-snapshot.writer.ts
│   │   └── realtime-state.store.ts
│   │
│   ├── fiscal/
│   │   └── homologation.guard.ts    # Sem alteração
│   │
│   ├── http/
│   │   ├── api-response.ts          # ✨ CONSOLIDADO: absorve shared/utils/apiResponse.ts
│   │   │                            # RENOMEADO: apiResponse → api-response
│   │   ├── async-handler.ts         # ✨ CONSOLIDADO: absorve shared/utils/asyncHandler.ts
│   │   │                            # RENOMEADO: asyncHandler → async-handler
│   │   ├── rate-limit.ts            # RENOMEADO: rateLimit → rate-limit
│   │   ├── require-auth.ts          # RENOMEADO: requireAuth → require-auth
│   │   ├── require-session-or-company.ts
│   │   └── session.ts               # Sem alteração
│   │
│   ├── intelligence/
│   │   └── intelligence.engine.ts   # Sem alteração
│   │
│   ├── jobs/
│   │   └── job-registry.ts          # Sem alteração
│   │
│   ├── nfe/
│   │   └── fiscal-store.ts          # Sem alteração
│   │
│   ├── observability/
│   │   ├── error-store.ts
│   │   ├── logger.ts
│   │   └── metrics.ts
│   │
│   ├── policy/
│   │   ├── policy-cache.ts
│   │   └── policy-engine.service.ts
│   │
│   ├── retry/
│   │   └── with-retry.ts            # RENOMEADO: withRetry → with-retry
│   │
│   ├── security/
│   │   ├── alert-engine.ts          # RENOMEADO: alertEngine → alert-engine
│   │   │                            # COMENTÁRIO: "in-memory security buffer"
│   │   │                            # Distinto de core/alerts/alert-engine.ts
│   │   ├── anomaly-detection.service.ts  # RENOMEADO
│   │   ├── auth-read.service.ts     # RENOMEADO: authRead → auth-read
│   │   ├── continuous-audit.ts      # RENOMEADO: continuousAudit → continuous-audit
│   │   ├── fiscal-guard.ts          # RENOMEADO: fiscalGuard → fiscal-guard
│   │   ├── order-security.ts        # RENOMEADO: orderSecurity → order-security
│   │   ├── protective-mode.service.ts
│   │   ├── query-firewall.ts        # RENOMEADO: queryFirewall → query-firewall
│   │   ├── risk-derivation.service.ts
│   │   ├── schema-enforcement.ts    # RENOMEADO
│   │   ├── security-analytics.engine.ts
│   │   ├── security-analyzer.ts     # RENOMEADO: securityAnalyzer → security-analyzer
│   │   ├── security-flags.ts        # RENOMEADO: securityFlags → security-flags
│   │   ├── security-logger.ts       # ✨ MOVIDO: de core/security/ para cá
│   │   │                            # RENOMEADO: securityLogger → security-logger
│   │   │                            # COMENTÁRIO: "in-memory circular buffer"
│   │   │                            # Distinto de core/audit/security-logger.ts
│   │   ├── session-guard.ts         # RENOMEADO: sessionGuard → session-guard
│   │   ├── tenant-guard.ts          # RENOMEADO: tenantGuard → tenant-guard
│   │   └── user-rate-limit.ts       # RENOMEADO: userRateLimit → user-rate-limit
│   │   # ✨ REMOVIDO: rateLimit.ts (duplicado de core/http/rate-limit.ts)
│   │
│   ├── state/
│   │   └── system-state.ts          # Sem alteração
│   │
│   ├── tenant/
│   │   ├── context.ts
│   │   ├── safe-query-router.ts     # RENOMEADO: safeQueryRouter → safe-query-router
│   │   └── scope.ts
│   │
│   └── validation/
│       └── validate-request.ts      # RENOMEADO: validateRequest → validate-request
│
├── database/
│   └── db.ts                        # Sem alteração (fonte da verdade Drizzle)
│
├── infra/                           # ✨ ABSORVIDO em services/storage/
│   # pdfParser.ts → services/storage/pdf-parser.ts
│   # upload.ts    → services/storage/upload.ts
│
├── jobs/
│   └── faturamento.cron.ts          # Sem alteração
│
├── middleware/
│   ├── auth.ts
│   ├── context.ts
│   ├── request-logger.ts            # RENOMEADO: requestLogger → request-logger
│   └── tenant.ts
│
├── modules/                         # Domínios de negócio
│   ├── auth/       (completo — sem alteração)
│   ├── banking/    (completo — sem alteração)
│   ├── billing/    (sem .routes — sem alteração de conteúdo)
│   ├── companies/  (completo — sem alteração)
│   ├── finance/    (completo — sem alteração)
│   ├── fiscal/     (sem .service/.repository — sem alteração de conteúdo)
│   ├── inventory/  (completo — sem alteração)
│   ├── logistics/  (completo — sem alteração)
│   ├── nfe/        (sem .controller/.routes — sem alteração de conteúdo)
│   ├── orders/     (completo v1+v2 — sem alteração)
│   ├── products/   (completo — sem alteração)
│   ├── security/   (sem .routes — sem alteração de conteúdo)
│   └── users/      (completo — sem alteração)
│   # ✨ REMOVIDOS: ai/, purchases/, reports/, sales/ (placeholders vazios)
│   # → Criar somente quando implementados de fato
│
├── routes/                          # Rotas agrupadas por domínio
│   ├── index.ts                     # ✨ NOVO — central registry (substitui routes.ts)
│   ├── routes.ts                    # Mantido temporariamente (contém lógica inlined)
│   │
│   ├── admin/                       # ✨ NOVO agrupamento
│   │   ├── admin-intelligence.routes.ts
│   │   ├── alert.routes.ts
│   │   ├── audit.routes.ts
│   │   ├── backup.routes.ts
│   │   ├── executive-dashboard.routes.ts
│   │   ├── governance.routes.ts
│   │   ├── health.routes.ts
│   │   ├── observability.routes.ts
│   │   └── order-cleanup.routes.ts
│   │
│   ├── fiscal/                      # ✨ NOVO agrupamento
│   │   ├── certificates.routes.ts
│   │   ├── fiscal-diagnostics.routes.ts
│   │   ├── fiscal-invoices.routes.ts
│   │   └── nfe-dashboard.routes.ts
│   │
│   ├── finance/                     # ✨ NOVO agrupamento
│   │   ├── bank.routes.ts
│   │   └── purchase-planning.routes.ts
│   │
│   ├── orders/                      # ✨ NOVO agrupamento
│   │   ├── order-exceptions.routes.ts
│   │   └── order-windows.routes.ts
│   │
│   ├── products/                    # ✨ NOVO agrupamento
│   │   └── price-groups.routes.ts
│   │   └── product-prices.routes.ts
│   │
│   ├── users/                       # ✨ NOVO agrupamento
│   │   ├── password-reset-requests.routes.ts
│   │   └── master.routes.ts
│   │
│   ├── platform/                    # ✨ NOVO agrupamento (infra/plataforma)
│   │   ├── about-us.routes.ts
│   │   ├── announcements.routes.ts
│   │   ├── email.routes.ts
│   │   ├── event.routes.ts
│   │   ├── geocode.routes.ts
│   │   ├── health.routes.ts
│   │   ├── logs.routes.ts
│   │   ├── push.routes.ts
│   │   └── system-sync.routes.ts
│   │   └── system-versions.routes.ts
│   │
│   └── legacy/                      # ✨ NOVO agrupamento — rotas sem módulo ainda
│       ├── about-us.routes.ts
│       ├── assistant.routes.ts
│       ├── clara.routes.ts
│       ├── client-contract-scope.routes.ts
│       ├── client-intelligence.routes.ts
│       ├── company-validate.routes.ts
│       ├── contracts-alerts.routes.ts
│       ├── empresa-config.routes.ts
│       ├── incidents.routes.ts
│       ├── marketplace.routes.ts
│       ├── operations.routes.ts
│       ├── policy.routes.ts
│       ├── quotations.routes.ts
│       ├── tasks.routes.ts
│       └── waste-control.routes.ts
│
├── services/                        # Infraestrutura transversal + domínios sem módulo
│   │
│   ├── infra/                       # ✨ NOVO sub-diretório (absorve server/infra/)
│   │   ├── backup.ts
│   │   ├── cache.ts
│   │   ├── email-scheduler.ts       # MOVIDO de routes/ para cá
│   │   ├── logger.ts
│   │   ├── mailer.ts
│   │   ├── push-service.ts          # RENOMEADO: pushService → push-service
│   │   ├── pdf-parser.ts            # MOVIDO de infra/
│   │   └── upload.ts                # MOVIDO de infra/
│   │
│   ├── alerts/                      # ✨ NOVO sub-diretório
│   │   ├── alerts.service.ts
│   │   ├── alerts.smart.ts
│   │   ├── alerts.delivery.ts
│   │   ├── alerts.digest.ts
│   │   ├── alerts.export.ts
│   │   ├── alerts.intelligence.ts
│   │   ├── alerts.preferences.ts
│   │   ├── alerts.proactive.ts
│   │   └── alerts.routing.ts
│   │
│   ├── storage/                     # ✨ NOVO sub-diretório (inicia decomposição do deus-objeto)
│   │   └── storage.ts               # Mantido intacto — sem decomposição nesta fase
│   │
│   ├── ai/                          # ✨ RENOMEADO de aiDeveloper/
│   │   ├── ai-developer.ts          # RENOMEADO: aiDeveloper → ai-developer
│   │   ├── auto-learning-module.ts  # RENOMEADO
│   │   ├── bug-detector.ts
│   │   ├── code-analyzer.ts         # RENOMEADO: codeAnalyzer → code-analyzer
│   │   ├── lab-functions.ts         # RENOMEADO
│   │   ├── memory-module.ts         # RENOMEADO: memoryModule → memory-module
│   │   └── system-indexer.ts        # RENOMEADO
│   │
│   ├── company-settings.service.ts  # RENOMEADO: companySettingsService → company-settings.service
│   │
│   ├── financeiro/                  # Sem alteração de conteúdo
│   ├── fiscal/                      # Sem alteração de conteúdo
│   ├── logistics/                   # Sem alteração de conteúdo
│   │
│   └── nfe/                         # Sem alteração de conteúdo
│       ├── nf.draft.ts
│       ├── nf.draft.builder.ts
│       ├── diagnostics/
│       ├── nfeGenerator.ts
│       ├── nfeSender.ts
│       └── ... (demais arquivos sem alteração)
│
└── shared/                          # ✨ SIMPLIFICADO — apenas re-exports de compatibilidade
    ├── db/
    │   └── index.ts                 # Mantido (re-export) — para não quebrar imports existentes
    │                                # Deprecation notice adicionado em comentário
    ├── errors/                      # Sem alteração
    ├── middlewares/                 # Sem alteração
    └── utils/
        ├── apiResponse.ts           # ✨ Re-export de core/http/api-response.ts
        └── asyncHandler.ts          # ✨ Re-export de core/http/async-handler.ts
        # Os arquivos de conteúdo são consolidados em core/http/
        # shared/utils/ passa a ser apenas re-exports para compatibilidade
```

### 3.3 Raiz do Projeto — Estrutura Nova

```
/workspace
├── client/
├── server/
├── shared/
├── migrations/
├── tests/
├── docs/
│   └── architecture/               # ✨ NOVO — este documento e futuros ADRs
├── scripts/                        # ✨ CONSOLIDADO: script/ + scripts/ → scripts/
├── backups/                        # ✨ CONSOLIDADO: backup/ + backups/ → backups/
├── logs/
├── uploads/
└── ... (configs sem alteração)
```

---

## 4. Arquivos Alterados — Plano de Migração

### Fase 1 — Consolidações Críticas (sem risco de quebra de comportamento)

#### 4.1 Eliminar duplicações de `asyncHandler` e `apiResponse`

| Ação | Arquivo | Mudança |
|------|---------|---------|
| RENOMEAR | `server/core/http/asyncHandler.ts` | → `server/core/http/async-handler.ts` |
| RENOMEAR | `server/core/http/apiResponse.ts` | → `server/core/http/api-response.ts` |
| CONVERTER | `server/shared/utils/asyncHandler.ts` | Remover conteúdo, adicionar: `export { asyncHandler } from '../../core/http/async-handler'` |
| CONVERTER | `server/shared/utils/apiResponse.ts` | Remover conteúdo, adicionar: `export * from '../../core/http/api-response'` |
| ATUALIZAR | Todos os importadores de `core/http/asyncHandler` | Atualizar path para `async-handler` |
| ATUALIZAR | Todos os importadores de `core/http/apiResponse` | Atualizar path para `api-response` |

**Justificativa:** A versão `core/http/async-handler.ts` é a mais completa (suporta generics). A versão `shared/utils/` passa a ser re-export transparente, garantindo zero quebra de imports existentes enquanto elimina divergência futura.

#### 4.2 Eliminar duplicação de `rateLimit`

| Ação | Arquivo | Mudança |
|------|---------|---------|
| MANTER | `server/core/http/rateLimit.ts` | Renomear para `rate-limit.ts` |
| DELETAR | `server/core/security/rateLimit.ts` | Verificar se há importadores; substituir por import de `core/http/rate-limit.ts` |

#### 4.3 Simplificar DB client chain

| Ação | Arquivo | Mudança |
|------|---------|---------|
| MANTER | `server/database/db.ts` | Sem alteração (fonte da verdade) |
| SIMPLIFICAR | `server/shared/db/client.ts` | Adicionar comentário de deprecation |
| SIMPLIFICAR | `server/shared/db/index.ts` | Manter como re-export (compatibilidade) — adicionar comentário: "Prefer importing from server/database/db.ts directly" |

**Justificativa:** Não remover ainda — muitos arquivos importam de `@shared/db`. A remoção é Fase 3 (futuro).

---

### Fase 2 — Renomeação de Arquivos (kebab-case uniforme no server)

#### 4.4 Renomeações no `server/core/`

| Arquivo Atual | Arquivo Proposto | Importadores a Atualizar |
|---------------|-----------------|--------------------------|
| `core/auth/authCore.service.ts` | `core/auth/auth-core.service.ts` | `modules/auth/`, `middleware/auth.ts` |
| `core/auth/rateSchedule.ts` | `core/auth/rate-schedule.ts` | Verificar importadores |
| `core/context/requestContext.ts` | `core/context/request-context.ts` | Middleware, routes |
| `core/errors/errorHandler.ts` | `core/errors/error-handler.ts` | `app.ts`, todos os routes |
| `core/http/asyncHandler.ts` | `core/http/async-handler.ts` | ~50 arquivos de módulos |
| `core/http/apiResponse.ts` | `core/http/api-response.ts` | ~20 arquivos de módulos |
| `core/http/rateLimit.ts` | `core/http/rate-limit.ts` | Middleware |
| `core/http/requireAuth.ts` | `core/http/require-auth.ts` | Todos os routes |
| `core/retry/withRetry.ts` | `core/retry/with-retry.ts` | NF-e services |
| `core/security/alertEngine.ts` | `core/security/alert-engine.ts` | security services |
| `core/security/authRead.service.ts` | `core/security/auth-read.service.ts` | auth module |
| `core/security/continuousAudit.ts` | `core/security/continuous-audit.ts` | bootstrap |
| `core/security/fiscalGuard.ts` | `core/security/fiscal-guard.ts` | fiscal routes |
| `core/security/orderSecurity.ts` | `core/security/order-security.ts` | orders module |
| `core/security/queryFirewall.ts` | `core/security/query-firewall.ts` | middleware |
| `core/security/securityLogger.ts` | `core/security/security-logger.ts` | ~10 arquivos |
| `core/security/sessionGuard.ts` | `core/security/session-guard.ts` | middleware |
| `core/security/tenantGuard.ts` | `core/security/tenant-guard.ts` | middleware |
| `core/tenant/safeQueryRouter.ts` | `core/tenant/safe-query-router.ts` | tenant module |
| `core/validation/validateRequest.ts` | `core/validation/validate-request.ts` | routes |

#### 4.5 Renomeações no `server/services/`

| Arquivo Atual | Arquivo Proposto |
|---------------|-----------------|
| `services/pushService.ts` | `services/infra/push-service.ts` |
| `services/companySettingsService.ts` | `services/company-settings.service.ts` |
| `services/autoLearningModule.ts` | `services/ai/auto-learning-module.ts` |
| `services/memoryModule.ts` | `services/ai/memory-module.ts` |
| `services/aiDeveloper/aiDeveloper.ts` | `services/ai/ai-developer.ts` |
| `services/aiDeveloper/bugDetector.ts` | `services/ai/bug-detector.ts` |
| `services/aiDeveloper/codeAnalyzer.ts` | `services/ai/code-analyzer.ts` |
| `services/aiDeveloper/labFunctions.ts` | `services/ai/lab-functions.ts` |
| `services/aiDeveloper/systemIndexer.ts` | `services/ai/system-indexer.ts` |

#### 4.6 Mover arquivos mal alocados

| Arquivo Atual | Destino Proposto | Motivo |
|---------------|-----------------|--------|
| `server/routes/email-scheduler.ts` | `server/services/infra/email-scheduler.ts` | Não é rota, é serviço |
| `server/infra/pdfParser.ts` | `server/services/infra/pdf-parser.ts` | Consolidar infra em services/infra/ |
| `server/infra/upload.ts` | `server/services/infra/upload.ts` | Consolidar infra em services/infra/ |
| `server/controllers/userController.ts` | Verificar e mesclar em `modules/users/` | Arquivo órfão legado |

---

### Fase 3 — Reorganização de Rotas (agrupamento por domínio)

#### 4.7 Estrutura de pastas em `server/routes/`

Criar subpastas e mover os 62 arquivos:

| Subpasta | Arquivos a mover |
|----------|-----------------|
| `routes/admin/` | `admin-intelligence`, `alert`, `audit`, `backup`, `executive-dashboard`, `governance`, `health`, `observability`, `order-cleanup` |
| `routes/fiscal/` | `certificates`, `fiscal-diagnostics`, `fiscal-invoices`, `nfe-dashboard` |
| `routes/finance/` | `bank`, `purchase-planning` |
| `routes/orders/` | `order-exceptions`, `order-windows` |
| `routes/products/` | `price-groups`, `product-prices` |
| `routes/users/` | `password-reset-requests`, `master` |
| `routes/platform/` | `about-us`, `announcements`, `email`, `event`, `geocode`, `logs`, `push`, `system-sync`, `system-versions` |
| `routes/legacy/` | Todos os demais sem módulo correspondente |

Criar `routes/index.ts` como registry central que importa de todas as subpastas, substituindo a lógica de registro distribuída no `routes.ts`.

---

### Fase 4 — Reorganização Client

#### 4.8 Criar `client/src/providers/`

Extrair de `App.tsx` e `main.tsx`:

| Componente | Extração |
|-----------|---------|
| `QueryClientProvider` | → `providers/QueryProvider.tsx` |
| `AuthExpiredHandler` | → `providers/AuthProvider.tsx` |
| `KeepAlive` | → `providers/KeepAliveProvider.tsx` |

`App.tsx` passa a importar e compor esses providers, reduzindo de ~600 para ~200 linhas.

#### 4.9 Reorganizar `client/src/components/`

| Arquivo Atual | Destino |
|---------------|---------|
| `components/NfeDiagnosticsPanel.tsx` | `components/nfe/NfeDiagnosticsPanel.tsx` |
| `components/FiscalInvoiceOCR.tsx` | `components/fiscal/FiscalInvoiceOCR.tsx` |
| `components/OrderTimeline.tsx` | `components/orders/OrderTimeline.tsx` |
| `components/TrainingMode.tsx` | `components/ia/TrainingMode.tsx` |
| `components/VirtualAssistant.tsx` | `components/ia/VirtualAssistant.tsx` |
| `components/Layout.tsx` | `components/layout/Layout.tsx` |
| `components/Modal.tsx` | `components/layout/Modal.tsx` |
| `components/navigation/BackHeader.tsx` | `components/layout/BackHeader.tsx` |
| `components/ErrorBoundary.tsx` | `components/feedback/ErrorBoundary.tsx` |
| `components/ContextualTip.tsx` | `components/feedback/ContextualTip.tsx` |
| `components/FloatingGuide.tsx` | `components/feedback/FloatingGuide.tsx` |
| `components/PWAInstallPrompt.tsx` | `components/feedback/PWAInstallPrompt.tsx` |
| `components/GlobalSearch.tsx` | `components/common/GlobalSearch.tsx` |
| `components/FruitCuriosities.tsx` | `components/common/FruitCuriosities.tsx` |
| `components/WhatsNewModal.tsx` | `components/common/WhatsNewModal.tsx` |

#### 4.10 Consolidar hooks

| Ação | Detalhe |
|------|---------|
| CRIAR | `client/src/hooks/use-categories.ts` |
| CONSOLIDAR | Mesclar `pages/admin/products/hooks/useCategories.ts` → `hooks/use-categories.ts` |
| DELETAR | `pages/admin/products/hooks/useCategories.ts` |
| DELETAR | Diretório `pages/admin/products/hooks/` (se vazio após migração) |
| ATUALIZAR | Todos os importadores de `useCategories` em `pages/admin/` |

#### 4.11 Reorganizar `client/src/lib/`

| Ação | Arquivo | Destino |
|------|---------|---------|
| MOVER | `lib/danfe-generator.ts` | `services/fiscal.service.ts` (consolidar) |
| MOVER | `lib/incident-pdf-generator.ts` | `services/incidents.service.ts` |
| MOVER | `lib/biNormalizer.ts` | `services/bi.service.ts` |
| RENOMEAR | `lib/queryClient.ts` | `lib/query-client.ts` |
| RENOMEAR | `lib/normalizeResponse.ts` | `lib/normalize-response.ts` |
| RENOMEAR | `lib/authErrors.ts` | `lib/auth-errors.ts` |
| RENOMEAR | `lib/safeArray.ts` | `lib/safe-array.ts` |
| MOVER | `utils/priceResolver.ts` | `lib/price-resolver.ts` |
| DELETAR | Diretório `client/src/utils/` (após migração) |

#### 4.12 Consolidar API client

Criar `lib/api-client.ts` que unifica `fetchWithAuth.ts` e `apiV2.ts`:
- Expor a função `fetchWithAuth` atual (retrocompatibilidade)
- Expor o cliente `apiV2` (retrocompatibilidade)
- Ambos os arquivos originais passam a re-exportar de `api-client.ts`

---

### Fase 5 — Raiz

#### 4.13 Consolidar diretórios duplicados

| Ação | Origem | Destino |
|------|--------|---------|
| MOVER conteúdo | `script/build.ts` | `scripts/build.ts` |
| MOVER conteúdo | `script/check-schema-contract.mjs` | `scripts/check-schema-contract.mjs` |
| MOVER conteúdo | `script/check-strict.mjs` | `scripts/check-strict.mjs` |
| MOVER conteúdo | `script/seed-test-env.ts` | `scripts/seed-test-env.ts` |
| DELETAR | `script/` | Após mover todos os arquivos |
| ATUALIZAR | `package.json` scripts | Ajustar paths de `script/` para `scripts/` |

| Ação | Origem | Destino |
|------|--------|---------|
| CONSOLIDAR | `backup/` | `backups/` |
| DELETAR | `backup/` | Após mover |

---

## 5. Justificativas por Decisão

### 5.1 Por que kebab-case universal no servidor?

Node.js e o ecossistema Express/TypeScript adotam kebab-case para nomes de arquivo por convenção estabelecida (análogo a npm packages). O projeto já usa kebab-case para os arquivos mais novos (`async-handler`, `rate-limit`, `operational-alerts.service.ts`), e os arquivos camelCase são todos legados. Unificar elimina a decisão cognitiva de "qual convenção usar" e torna `grep` e `ls` previsíveis.

**Não muda:** exports internos, nomes de função, nomes de classe — só o nome do arquivo.

### 5.2 Por que `shared/utils/` vira re-export em vez de ser deletado?

Deletar quebraria silenciosamente todos os imports existentes para `../../shared/utils/asyncHandler`. Com re-export transparente, zero mudança necessária nos arquivos consumidores. A consolidação real ocorre gradualmente à medida que cada módulo atualiza seu import.

### 5.3 Por que não decompor `storage.ts` agora?

`storage.ts` tem 2400+ linhas e é a única fonte de acesso ao banco para a maioria das features. Decomposição requer:
1. Identificar limites de domínio dentro do objeto
2. Atualizar todos os call sites
3. Testes de regressão em cada método migrado

Isso é uma refatoração de alto risco que deve ser feita em Fase Futura dedicada, com feature flags. Nesta reorganização, mover para `services/storage/storage.ts` é suficiente para clareza de localização.

### 5.4 Por que criar `providers/` no client?

`App.tsx` com 600+ linhas mistura roteamento, lógica de guard, keep-alive e providers de contexto. Extrair providers:
- Facilita testar cada provider isoladamente
- Torna o `App.tsx` legível como "mapa de rotas"
- Segue o padrão moderno React de composition root

**Não muda:** comportamento de autenticação, redirecionamentos, providers existentes.

### 5.5 Por que agrupar rotas em subpastas?

62 arquivos planos tornam impossível descobrir quais rotas existem para um domínio. Com agrupamento:
- `routes/fiscal/` = todos os endpoints fiscais
- `routes/admin/` = todos os endpoints admin

Nenhuma URL muda. O `routes/index.ts` centraliza o registro e substitui a lista crescente dentro de `routes.ts`.

### 5.6 Por que remover módulos placeholder (`ai/`, `purchases/`, `reports/`, `sales/`)?

Módulos com apenas README criam a ilusão de que lógica existe onde não existe. Quando um dev for criar lógica de relatórios, não encontrará nada em `modules/reports/` e ficará confuso. Remover até haver implementação real mantém o namespace honesto. Os READMEs podem ser movidos para `docs/`.

### 5.7 Por que `components/[domain]/` no client?

`NfeDiagnosticsPanel.tsx` na raiz de `components/` ao lado de `ErrorBoundary.tsx` mistura domínio com infraestrutura. Componentes de domínio pertencem perto do código que os usa ou em uma subpasta nomeada do domínio. Facilita:
- Encontrar todos os componentes NF-e: `components/nfe/`
- Entender o que é infraestrutura vs domínio
- Colocar novos componentes no lugar certo

---

## 6. Lista de Riscos

### 🔴 Riscos Altos

| # | Risco | Causa | Mitigação |
|---|-------|-------|-----------|
| R1 | **Import circular após renomear arquivos** | `asyncHandler` e `apiResponse` são importados em ~70 arquivos; errar um path quebra o servidor inteiro | Fazer substituição via `sed` ou find-replace global, rodar `npm run check:strict` antes de qualquer deploy |
| R2 | **`routes.ts` tem lógica inlined de NF-e** | `POST /api/nfe/emitir`, `/api/nfe/:id/enviar` etc. estão dentro do arquivo de 3000+ linhas, não em arquivos separados | Fase 3 (rotas) deve criar `routes/index.ts` como wrapper sem mexer no conteúdo de `routes.ts` ainda |
| R3 | **`storage.ts` importa de paths relativos** | `../database/db.ts` hardcoded; mover o arquivo de lugar quebra o import | Ao mover para `services/storage/storage.ts`, atualizar o import de db antes de commit |
| R4 | **`email-scheduler.ts` pode estar registrado como rota** | O arquivo está em `server/routes/` mas não é rota — se `routes.ts` importa ele esperando `register(app)`, remover do diretório quebra | Verificar imports em `routes.ts` antes de mover |

### 🟡 Riscos Médios

| # | Risco | Causa | Mitigação |
|---|-------|-------|-----------|
| R5 | **`useCategories` duplicado pode ter comportamentos diferentes** | O hook em `pages/` pode ter sido divergido do padrão global | Comparar implementações antes de consolidar; adotar a mais completa |
| R6 | **Alias `@/*` pode não cobrir novos subdiretórios** | `components/nfe/`, `components/fiscal/` etc. são novos; o alias `@/components/nfe/X` deve funcionar automaticamente via tsconfig | Testar um import após criar a primeira subpasta antes de mover todos os arquivos |
| R7 | **`App.tsx` refatoração** | Extrair providers pode afetar a ordem de renderização se Context depende de outro Provider acima | Manter exatamente a mesma árvore de providers, apenas extrair em componentes — não reordenar |
| R8 | **`script/` referenciado em `package.json`** | Scripts de CI/build podem quebrar se `script/` for removido antes de atualizar `package.json` | Atualizar `package.json` **antes** de deletar `script/` |
| R9 | **Módulos placeholder deletados podem estar referenciados** | Se algum arquivo importa de `modules/reports/` ou `modules/ai/` esperando exports que não existem | Rodar `grep -r "modules/reports\|modules/ai\|modules/purchases\|modules/sales"` antes de remover |

### 🟢 Riscos Baixos

| # | Risco | Causa | Mitigação |
|---|-------|-------|-----------|
| R10 | **`backup/` vs `backups/` consolidação** | Arquivos de backup são históricos, não referenciados em código | Verificar se algum script aponta para `./backup/` explicitamente |
| R11 | **Renomeação de `middleware/requestLogger.ts`** | Pode estar registrado em `app.ts` com import direto | Atualizar `app.ts` e qualquer outro importador antes de renomear |
| R12 | **`server/controllers/userController.ts`** | Arquivo isolado pode ter lógica não coberta por `modules/users/` | Fazer diff completo com `modules/users/user.controller.ts` antes de qualquer ação |
| R13 | **Testes e2e com paths hardcoded** | Playwright pode importar utilitários por path relativo | Verificar `tests/` por imports de `server/` ou `client/src/` antes de mover arquivos |

---

## 7. Ordem de Execução Segura

A sequência abaixo garante que cada fase pode ser revertida independentemente:

```
Fase 1 — Consolidações críticas (zero risco de quebra de comportamento)
  └─ 1a. Converter shared/utils/ em re-exports de core/http/
  └─ 1b. Verificar rateLimit duplicado e eliminar o de security/
  └─ 1c. Adicionar comentários de deprecation em shared/db/
  └─ 1d. Rodar: npm run check:strict

Fase 2 — Renomeação de arquivos server/ (kebab-case)
  └─ 2a. Renomear um arquivo por vez + atualizar importadores
  └─ 2b. Rodar npm run check:strict após cada renomeação
  └─ 2c. Prioridade: core/http/ → core/security/ → services/ → middleware/

Fase 3 — Reorganização de rotas (agrupamento em subpastas)
  └─ 3a. Criar routes/index.ts como novo entry point
  └─ 3b. Criar subpastas (admin/, fiscal/, finance/ etc.)
  └─ 3c. Mover arquivos .routes.ts para subpastas (NÃO tocar routes.ts inlined)
  └─ 3d. Atualizar routes/index.ts para importar dos novos paths
  └─ 3e. Mover email-scheduler.ts para services/infra/
  └─ 3f. Testar todos os endpoints via smoke test

Fase 4 — Reorganização client/
  └─ 4a. Criar providers/ e extrair de App.tsx
  └─ 4b. Criar components/[domain]/ e mover um componente por vez
  └─ 4c. Consolidar use-categories.ts em hooks/
  └─ 4d. Reorganizar lib/ (renomear para kebab)
  └─ 4e. Criar services/ domain files
  └─ 4f. Rodar build: npm run build

Fase 5 — Raiz
  └─ 5a. Mover script/ → scripts/ + atualizar package.json
  └─ 5b. Consolidar backup/ → backups/
  └─ 5c. Deletar diretórios vazios
```

**Checkpoint obrigatório entre fases:** `npm run check:strict && npm run test:unit`

---

## Apêndice A — Contagem de Arquivos

| Camada | Arquivos Atual | Arquivos Pós-Reorganização | Δ |
|--------|---------------|--------------------------|---|
| `server/` | 318 `.ts` | ~318 `.ts` | 0 (renomes, sem deleções de conteúdo) |
| `client/src/` | 212 `.ts/.tsx` | ~212 `.ts/.tsx` | 0 (reorganização de pastas) |
| `server/routes/` (arquivos planos) | 62 | 62 (em subpastas) | 0 |
| Duplicações eliminadas | — | — | -3 arquivos de conteúdo real |
| Placeholders removidos | 4 | 0 | -4 READMEs |

---

## Apêndice B — Convenções a Adotar (ADR)

1. **Nomes de arquivo:** kebab-case universal (`meu-servico.ts`, não `meuServico.ts`)
2. **Nomes de export:** PascalCase para classes/componentes, camelCase para funções
3. **Nova lógica de negócio:** sempre em `server/modules/[dominio]/`
4. **Nova infraestrutura transversal:** sempre em `server/core/` ou `server/services/infra/`
5. **Novo componente de domínio:** `client/src/components/[dominio]/NomeComponente.tsx`
6. **Novo hook:** `client/src/hooks/use-nome-hook.ts` (kebab)
7. **Nova rota:** criar em `server/routes/[dominio]/nome.routes.ts`, registrar em `routes/index.ts`
8. **Sem imports de `shared/utils/` em código novo** — usar `core/http/` diretamente
