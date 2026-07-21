# DOMAIN MIGRATION PLAN
## Portal VivaFrutaz ERP — Fase 2: Reorganização por Domínios

**Data:** 2026-07-21  
**Referência:** ARCHITECTURE_REORGANIZATION.md + NORMALIZATION_REPORT.md  
**Status:** Plano aprovado pendente — NÃO iniciar migração sem aprovação  
**Regra:** Nenhum arquivo é movido neste documento. Apenas plano.

---

## Índice

1. [Etapa 1 — Inventário dos Domínios](#etapa-1--inventário-dos-domínios)
2. [Etapa 2 — Mapa de Dependências por Domínio](#etapa-2--mapa-de-dependências-por-domínio)
3. [Etapa 3 — Plano de Migração](#etapa-3--plano-de-migração)
4. [Etapa 4 — Detecção de Acoplamentos](#etapa-4--detecção-de-acoplamentos)
5. [Etapa 5 — Matriz de Migração](#etapa-5--matriz-de-migração)

---

## Etapa 1 — Inventário dos Domínios

### 1.1 Totais Atuais (baseline)

| Camada | Arquivos hoje |
|--------|--------------|
| `server/routes/` | 64 arquivos `.ts` (62 route files + routes.ts + email-scheduler.ts) |
| `server/modules/` | 109 arquivos `.ts` em 16 subpastas |
| `server/services/` | 53 arquivos `.ts` (incluindo subpastas) |
| `server/core/` | ~50 arquivos (cross-cutting) |
| `server/jobs/` | 1 arquivo (`faturamento.cron.ts`) |
| `server/controllers/` | 1 arquivo legado (`userController.ts`) |
| `client/src/pages/` | 121 arquivos `.tsx/.ts` |
| `client/src/hooks/` | 11 arquivos |
| `client/src/components/` | ~80 arquivos |

**Problema central:** `server/routes/routes.ts` tem **4.496 linhas**, importa de **15 módulos** diferentes e faz **134 chamadas diretas** a `storage.*`. É o maior ponto de risco da migração.

**Segundo problema central:** `server/services/storage.ts` é usado por **71 arquivos** — um objeto deus que conecta todos os domínios.

---

### 1.2 Mapeamento por Domínio Funcional

Os 15 domínios propostos abaixo seguem o modelo DDD leve solicitado:

```
server/
├── core/                     ← Cross-cutting (auth técnico, http, events, observability)
├── shared/                   ← Schema Drizzle, constantes globais
│
└── domains/                  ← (estrutura proposta)
    ├── auth/
    ├── users/
    ├── companies/
    ├── orders/
    ├── products/
    ├── planning/
    ├── logistics/
    ├── security/
    ├── ai/
    ├── reports/
    ├── settings/
    ├── communications/
    ├── platform/
    ├── fiscal/               ← CONGELADO
    └── finance/              ← CONGELADO
```

---

### 1.3 Classificação de cada arquivo existente por domínio

#### DOMÍNIO: auth

| Arquivo atual | Camada | Tipo |
|---------------|--------|------|
| `server/modules/auth/auth.controller.ts` | server | Controller |
| `server/modules/auth/auth.repository.ts` | server | Repository |
| `server/modules/auth/auth.routes.ts` | server | Routes |
| `server/modules/auth/auth.service.ts` | server | Service |
| `server/modules/auth/auth.types.ts` | server | Types/DTOs |
| `server/modules/auth/auth.validation.ts` | server | Validator |
| `server/modules/auth/userProvisioningService.ts` | server | Service |
| `server/modules/auth/index.ts` | server | Barrel |
| `server/routes/password-reset-requests.routes.ts` | server | Routes (legado) |
| `server/routes/governance.routes.ts` | server | Routes (legado) |
| `server/core/auth/authCore.service.ts` | core | Service |
| `server/core/auth/rateSchedule.ts` | core | Config |
| `server/core/http/requireAuth.ts` | core | Middleware |
| `server/core/http/session.ts` | core | Middleware |
| `server/core/http/requireSessionOrCompany.ts` | core | Middleware |
| `client/src/pages/auth/login.tsx` | client | Page |
| `client/src/pages/auth/reset-password.tsx` | client | Page |
| `client/src/pages/auth/change-password.tsx` | client | Page |
| `client/src/pages/admin/password-reset-requests.tsx` | client | Page |
| `client/src/hooks/use-auth.ts` | client | Hook |
| `client/src/lib/authErrors.ts` | client | Lib |

#### DOMÍNIO: users

| Arquivo atual | Camada | Tipo |
|---------------|--------|------|
| `server/modules/users/users.controller.ts` | server | Controller |
| `server/modules/users/users.repository.ts` | server | Repository |
| `server/modules/users/users.routes.ts` | server | Routes |
| `server/modules/users/users.admin.routes.ts` | server | Routes |
| `server/modules/users/users.service.ts` | server | Service |
| `server/modules/users/users.types.ts` | server | Types/DTOs |
| `server/modules/users/users.validation.ts` | server | Validator |
| `server/modules/users/index.ts` | server | Barrel |
| `server/controllers/userController.ts` | server | Controller (LEGADO) |
| `client/src/pages/admin/users.tsx` | client | Page |
| `client/src/hooks/use-admin.ts` | client | Hook (parcial — também usa companies) |

#### DOMÍNIO: companies

| Arquivo atual | Camada | Tipo |
|---------------|--------|------|
| `server/modules/companies/companies.controller.ts` | server | Controller |
| `server/modules/companies/companies.repository.ts` | server | Repository |
| `server/modules/companies/companies.routes.ts` | server | Routes |
| `server/modules/companies/companies.service.ts` | server | Service |
| `server/modules/companies/companies.types.ts` | server | Types/DTOs |
| `server/modules/companies/companies.validation.ts` | server | Validator |
| `server/modules/companies/companyCertificate.repository.ts` | server | Repository |
| `server/modules/companies/index.ts` | server | Barrel |
| `server/services/companySettingsService.ts` | server | Service |
| `server/routes/empresa-config.routes.ts` | server | Routes (legado) |
| `server/routes/company-validate.routes.ts` | server | Routes (legado) |
| `server/routes/client-contract-scope.routes.ts` | server | Routes (legado) |
| `server/routes/contracts-alerts.routes.ts` | server | Routes (legado) |
| `client/src/pages/admin/companies/index.tsx` | client | Page |
| `client/src/pages/admin/companies/components/CompaniesFilters.tsx` | client | Component |
| `client/src/pages/admin/companies/components/CompaniesHeader.tsx` | client | Component |
| `client/src/pages/admin/companies/components/CompaniesTable.tsx` | client | Component |
| `client/src/pages/admin/companies/components/CompanyRow.tsx` | client | Component |
| `client/src/pages/admin/companies/dialogs/AddressesTab.tsx` | client | Component |
| `client/src/pages/admin/companies/dialogs/CompanyModal.tsx` | client | Component |
| `client/src/pages/admin/companies/dialogs/ContractScopeManager.tsx` | client | Component |
| `client/src/pages/admin/companies/dialogs/TempPasswordModal.tsx` | client | Component |
| `client/src/pages/admin/companies/dialogs/tabs/TabBasico.tsx` | client | Component |
| `client/src/pages/admin/companies/dialogs/tabs/TabConfig.tsx` | client | Component |
| `client/src/pages/admin/companies/dialogs/tabs/TabEntrega.tsx` | client | Component |
| `client/src/pages/admin/companies/dialogs/tabs/TabFinanceiro.tsx` | client | Component |
| `client/src/pages/admin/companies/dialogs/tabs/TabFiscal.tsx` | client | Component |
| `client/src/pages/admin/contracts.tsx` | client | Page |

#### DOMÍNIO: orders

| Arquivo atual | Camada | Tipo |
|---------------|--------|------|
| `server/modules/orders/orders.controller.ts` | server | Controller |
| `server/modules/orders/orders.controller.v2.ts` | server | Controller |
| `server/modules/orders/orders.repository.ts` | server | Repository |
| `server/modules/orders/orders.routes.ts` | server | Routes |
| `server/modules/orders/orders.routes.v2.ts` | server | Routes |
| `server/modules/orders/orders.service.ts` | server | Service |
| `server/modules/orders/orders.transaction.ts` | server | Service (Transação) |
| `server/modules/orders/orders.outbox.worker.ts` | server | Worker |
| `server/modules/orders/orders.types.ts` | server | Types/DTOs |
| `server/modules/orders/orders.validation.ts` | server | Validator |
| `server/modules/orders/orders.workflow.ts` | server | Workflow |
| `server/modules/orders/index.ts` | server | Barrel |
| `server/routes/order-cleanup.routes.ts` | server | Routes (legado) |
| `server/routes/order-exceptions.routes.ts` | server | Routes (legado) |
| `server/routes/order-windows.routes.ts` | server | Routes (legado) |
| `server/routes/special-order-requests.routes.ts` | server | Routes (legado) |
| `server/routes/quotations.routes.ts` | server | Routes (legado) |
| `server/routes/import-data.routes.ts` | server | Routes (legado) |
| `client/src/pages/admin/orders/index.tsx` | client | Page |
| `client/src/pages/admin/orders/components/DanfePanel.tsx` | client | Component |
| `client/src/pages/admin/orders/components/OrderRow.tsx` | client | Component |
| `client/src/pages/admin/orders/components/SubCategorySelector.tsx` | client | Component |
| `client/src/pages/admin/orders/dialogs/AdminNoteModal.tsx` | client | Component |
| `client/src/pages/admin/orders/dialogs/CancelModal.tsx` | client | Component |
| `client/src/pages/admin/orders/dialogs/DeleteHistoryModal.tsx` | client | Component |
| `client/src/pages/admin/orders/dialogs/EditItemsModal.tsx` | client | Component |
| `client/src/pages/admin/orders/dialogs/ExportOrdersModal.tsx` | client | Component |
| `client/src/pages/admin/order-windows.tsx` | client | Page |
| `client/src/pages/admin/order-exceptions.tsx` | client | Page |
| `client/src/pages/admin/quotations.tsx` | client | Page |
| `client/src/pages/admin/special-orders.tsx` | client | Page |
| `client/src/pages/admin/faturamento.tsx` | client | Page |
| `client/src/pages/admin/import-data.tsx` | client | Page |
| `client/src/pages/client/create-order.tsx` | client | Page |
| `client/src/pages/client/order-history.tsx` | client | Page |
| `client/src/hooks/use-ordering.ts` | client | Hook |
| `client/src/hooks/use-force-release-nfe.ts` | client | Hook (borda orders/fiscal) |
| `client/src/components/OrderTimeline.tsx` | client | Component |

#### DOMÍNIO: products

| Arquivo atual | Camada | Tipo |
|---------------|--------|------|
| `server/modules/products/products.controller.ts` | server | Controller |
| `server/modules/products/products.repository.ts` | server | Repository |
| `server/modules/products/products.routes.ts` | server | Routes |
| `server/modules/products/products.service.ts` | server | Service |
| `server/modules/products/products.types.ts` | server | Types/DTOs |
| `server/modules/products/products.validation.ts` | server | Validator |
| `server/modules/products/categories.routes.ts` | server | Routes |
| `server/modules/products/pricing.routes.ts` | server | Routes |
| `server/modules/products/pricing.service.ts` | server | Service |
| `server/modules/products/upload.routes.ts` | server | Routes |
| `server/modules/products/index.ts` | server | Barrel |
| `server/modules/products/utils/` | server | Utils |
| `server/modules/inventory/inventory.controller.ts` | server | Controller |
| `server/modules/inventory/inventory.repository.ts` | server | Repository |
| `server/modules/inventory/inventory.routes.ts` | server | Routes |
| `server/modules/inventory/inventory.service.ts` | server | Service |
| `server/modules/inventory/inventory.types.ts` | server | Types/DTOs |
| `server/modules/inventory/index.ts` | server | Barrel |
| `server/routes/price-groups.routes.ts` | server | Routes (legado) |
| `server/routes/product-prices.routes.ts` | server | Routes (legado) |
| `server/routes/marketplace.routes.ts` | server | Routes (legado) |
| `server/infra/upload.ts` | server | Infra |
| `server/infra/pdfParser.ts` | server | Infra (importação fiscal) |
| `client/src/pages/admin/products/index.tsx` | client | Page |
| `client/src/pages/admin/products/components/` | client | Components (6 arquivos) |
| `client/src/pages/admin/products/dialogs/` | client | Components (3 arquivos) |
| `client/src/pages/admin/categories.tsx` | client | Page |
| `client/src/pages/admin/price-groups.tsx` | client | Page |
| `client/src/pages/admin/inventory.tsx` | client | Page |
| `client/src/pages/admin/marketplace.tsx` | client | Page |
| `client/src/hooks/use-catalog.ts` | client | Hook |

#### DOMÍNIO: logistics

| Arquivo atual | Camada | Tipo |
|---------------|--------|------|
| `server/modules/logistics/logistics.controller.ts` | server | Controller |
| `server/modules/logistics/logistics.repository.ts` | server | Repository |
| `server/modules/logistics/logistics.routes.ts` | server | Routes |
| `server/modules/logistics/logistics.service.ts` | server | Service |
| `server/modules/logistics/logistics.types.ts` | server | Types/DTOs |
| `server/modules/logistics/auto-dispatch.service.ts` | server | Service |
| `server/modules/logistics/driver.access.ts` | server | Service |
| `server/modules/logistics/eta.service.ts` | server | Service |
| `server/modules/logistics/index.ts` | server | Barrel |
| `server/services/logistics/geoService.ts` | server | Service (infra geo) |
| `server/services/logistics/routeOptimizer.ts` | server | Service (infra routing) |
| `server/routes/logistics.routes.ts` | server | Routes (legado) |
| `server/routes/geocode.routes.ts` | server | Routes (legado) |
| `client/src/pages/admin/logistics.tsx` | client | Page |
| `client/src/pages/admin/driver-panel.tsx` | client | Page |
| `client/src/pages/admin/logistics-intelligence.tsx` | client | Page |
| `client/src/pages/track.tsx` | client | Page (pública) |
| `client/src/pages/driver-map.tsx` | client | Page (pública) |
| `client/src/components/map/LeafletRouteMap.tsx` | client | Component |

#### DOMÍNIO: security

| Arquivo atual | Camada | Tipo |
|---------------|--------|------|
| `server/modules/security/security.blocker.ts` | server | Service |
| `server/modules/security/security.block.repository.ts` | server | Repository |
| `server/modules/security/security.controller.ts` | server | Controller |
| `server/modules/security/security.repository.ts` | server | Repository |
| `server/modules/security/security.service.ts` | server | Service |
| `server/routes/security.routes.ts` | server | Routes (legado) |
| `server/routes/security-alerts.routes.ts` | server | Routes (legado) |
| `server/routes/security-analysis.routes.ts` | server | Routes (legado) |
| `server/routes/security-events.routes.ts` | server | Routes (legado) |
| `server/routes/security-overview.routes.ts` | server | Routes (legado) |
| `server/routes/security-risk.routes.ts` | server | Routes (legado) |
| `server/routes/audit.routes.ts` | server | Routes (legado) |
| `client/src/pages/admin/security-dashboard.tsx` | client | Page |
| `client/src/pages/admin/security-audit.tsx` | client | Page |
| `client/src/pages/admin/security-intelligence.tsx` | client | Page |
| `client/src/pages/admin/governance-dashboard.tsx` | client | Page |

#### DOMÍNIO: ai

| Arquivo atual | Camada | Tipo |
|---------------|--------|------|
| `server/services/aiDeveloper/aiDeveloper.ts` | server | Service |
| `server/services/aiDeveloper/bugDetector.ts` | server | Service |
| `server/services/aiDeveloper/codeAnalyzer.ts` | server | Service |
| `server/services/aiDeveloper/labFunctions.ts` | server | Service |
| `server/services/aiDeveloper/systemIndexer.ts` | server | Service |
| `server/services/autoLearningModule.ts` | server | Service |
| `server/services/memoryModule.ts` | server | Service |
| `server/core/intelligence/intelligence.engine.ts` | core | Engine |
| `server/routes/clara.routes.ts` | server | Routes (legado) |
| `server/routes/assistant.routes.ts` | server | Routes (legado) |
| `server/routes/admin-intelligence.routes.ts` | server | Routes (legado) |
| `server/routes/client-intelligence.routes.ts` | server | Routes (legado) |
| `server/routes/executive-dashboard.routes.ts` | server | Routes (legado) |
| `server/routes/scope-simulations.routes.ts` | server | Routes (legado) |
| `client/src/pages/admin/intelligence.tsx` | client | Page |
| `client/src/pages/admin/commercial-intelligence.tsx` | client | Page |
| `client/src/pages/admin/clara-training.tsx` | client | Page |
| `client/src/pages/admin/executive-dashboard.tsx` | client | Page |
| `client/src/pages/admin/financial-intelligence.tsx` | client | Page |
| `client/src/pages/admin/logistics-intelligence.tsx` | client | Page |
| `client/src/pages/admin/treinamento.tsx` | client | Page |
| `client/src/pages/admin/ai-developer.tsx` | client | Page |
| `client/src/pages/admin/developer.tsx` | client | Page |
| `client/src/components/VirtualAssistant.tsx` | client | Component |
| `client/src/components/TrainingMode.tsx` | client | Component |

#### DOMÍNIO: reports

| Arquivo atual | Camada | Tipo |
|---------------|--------|------|
| `server/modules/reports/` (README only) | server | Placeholder |
| `server/routes/reports.routes.ts` | server | Routes (legado) |
| `client/src/pages/admin/reports/financial.tsx` | client | Page |
| `client/src/pages/admin/reports/industrialized.tsx` | client | Page |
| `client/src/pages/admin/reports/purchasing.tsx` | client | Page |

#### DOMÍNIO: planning

| Arquivo atual | Camada | Tipo |
|---------------|--------|------|
| `server/modules/purchases/` (README only) | server | Placeholder |
| `server/routes/purchase-planning.routes.ts` | server | Routes (legado) |
| `server/routes/waste-control.routes.ts` | server | Routes (legado) |
| `server/routes/sanitary.routes.ts` | server | Routes (legado) |
| `client/src/pages/admin/purchase-planning.tsx` | client | Page |
| `client/src/pages/admin/waste-control.tsx` | client | Page |
| `client/src/pages/admin/sanitary.tsx` | client | Page |

#### DOMÍNIO: settings

| Arquivo atual | Camada | Tipo |
|---------------|--------|------|
| `server/routes/settings.routes.ts` | server | Routes (legado) |
| `server/routes/smtp-config.routes.ts` | server | Routes (legado) |
| `server/routes/smtp-test.routes.ts` | server | Routes (legado) |
| `server/routes/policy.routes.ts` | server | Routes (legado) |
| `server/routes/alert.routes.ts` | server | Routes (legado) |
| `server/services/alerts.preferences.ts` | server | Service |
| `server/core/policy/policy-engine.service.ts` | core | Engine |
| `server/core/policy/policy-cache.ts` | core | Cache |
| `client/src/pages/admin/settings.tsx` | client | Page |
| `client/src/pages/admin/notification-settings.tsx` | client | Page |
| `client/src/pages/admin/smtp-config.tsx` | client | Page |
| `client/src/pages/admin/support-config.tsx` | client | Page |
| `client/src/pages/admin/white-label.tsx` | client | Page |

#### DOMÍNIO: communications

| Arquivo atual | Camada | Tipo |
|---------------|--------|------|
| `server/routes/email.routes.ts` | server | Routes (legado) |
| `server/routes/push.routes.ts` | server | Routes (legado) |
| `server/routes/announcements.routes.ts` | server | Routes (legado) |
| `server/services/mailer.ts` | server | Service (infra) |
| `server/services/email-scheduler.ts` | server | Service (infra) |
| `server/services/pushService.ts` | server | Service (infra) |
| `client/src/pages/admin/email-management.tsx` | client | Page |
| `client/src/hooks/use-push-notifications.ts` | client | Hook |

#### DOMÍNIO: platform (infra operacional)

| Arquivo atual | Camada | Tipo |
|---------------|--------|------|
| `server/routes/health.routes.ts` | server | Routes (legado) |
| `server/routes/observability.routes.ts` | server | Routes (legado) |
| `server/routes/system-state.routes.ts` | server | Routes (legado) |
| `server/routes/system-status.routes.ts` | server | Routes (legado) |
| `server/routes/system-sync.routes.ts` | server | Routes (legado) |
| `server/routes/system-versions.routes.ts` | server | Routes (legado) |
| `server/routes/logs.routes.ts` | server | Routes (legado) |
| `server/routes/event.routes.ts` | server | Routes (legado) |
| `server/routes/backup.routes.ts` | server | Routes (legado) |
| `server/routes/about-us.routes.ts` | server | Routes (legado) |
| `server/routes/master.routes.ts` | server | Routes (legado) |
| `server/routes/search.routes.ts` | server | Routes (legado) |
| `server/services/backup.ts` | server | Service (infra) |
| `server/services/cache.ts` | server | Service (infra) |
| `server/services/logger.ts` | server | Service (infra) |
| `client/src/pages/admin/system-health.tsx` | client | Page |
| `client/src/pages/admin/system-updates.tsx` | client | Page |
| `client/src/pages/admin/observability.tsx` | client | Page |
| `client/src/pages/admin/backups.tsx` | client | Page |
| `client/src/pages/admin/master-control.tsx` | client | Page |
| `client/src/pages/admin/control-center.tsx` | client | Page |

#### DOMÍNIO: fiscal (CONGELADO ❄️)

> Não será migrado nesta fase. Estrutura atual mantida intacta.

| Arquivo atual | Camada | Tipo |
|---------------|--------|------|
| `server/modules/nfe/*` (17 arquivos) | server | Module |
| `server/modules/fiscal/*` (4 arquivos) | server | Module |
| `server/services/nfe/*` (15 arquivos) | server | Services NF-e |
| `server/services/fiscal/*` (2 arquivos) | server | Services Fiscal |
| `server/services/nf.draft.ts` | server | Service |
| `server/services/nf.draft.builder.ts` | server | Service |
| `server/jobs/faturamento.cron.ts` | server | Job |
| `server/routes/fiscal-invoices.routes.ts` | server | Routes |
| `server/routes/fiscal-diagnostics.routes.ts` | server | Routes |
| `server/routes/nfe-dashboard.routes.ts` | server | Routes |
| `server/routes/certificates.routes.ts` | server | Routes |
| `client/src/pages/admin/fiscal.tsx` | client | Page |
| `client/src/pages/admin/nfe.tsx` | client | Page |
| `client/src/pages/admin/nfe-dashboard.tsx` | client | Page |
| `client/src/pages/admin/nfe-recovery.tsx` | client | Page |
| `client/src/pages/admin/fiscal-config.tsx` | client | Page |
| `client/src/pages/admin/fiscal-diagnostics.tsx` | client | Page |
| `client/src/pages/admin/insert-nf-manual.tsx` | client | Page |
| `client/src/hooks/use-can-emit-nfe.ts` | client | Hook |
| `client/src/hooks/use-emitir-lote-nfe.ts` | client | Hook |
| `client/src/components/FiscalInvoiceOCR.tsx` | client | Component |
| `client/src/components/NfeDiagnosticsPanel.tsx` | client | Component |
| `client/src/services/nfe.service.ts` | client | Service |
| `client/src/lib/danfe-generator.ts` | client | Lib |

#### DOMÍNIO: finance (CONGELADO ❄️)

> Não será migrado nesta fase. Estrutura atual mantida intacta.

| Arquivo atual | Camada | Tipo |
|---------------|--------|------|
| `server/modules/finance/*` (7 arquivos) | server | Module |
| `server/modules/billing/*` (7 arquivos) | server | Module |
| `server/modules/banking/itau/*` | server | Module |
| `server/services/financeiro/*` (2 arquivos) | server | Services |
| `server/routes/bank.routes.ts` | server | Routes |
| `server/routes/saas.routes.ts` | server | Routes |
| `client/src/pages/admin/finance.tsx` | client | Page |
| `client/src/pages/admin/saas-financeiro.tsx` | client | Page |
| `client/src/pages/admin/saas-dashboard.tsx` | client | Page |
| `client/src/pages/admin/banco.tsx` | client | Page |
| `client/src/components/banking/ImportarRetornoCnab.tsx` | client | Component |

---

## Etapa 2 — Mapa de Dependências por Domínio

### Legenda
- **→** depende de (importa de)
- **←** é dependência de (importado por)
- **⚠️** acoplamento problemático

### 2.1 auth

```
auth.service.ts       → core/auth/authCore.service.ts
                      → core/security/rateLimit (markEmailAsStrategic)
                      → database/db.ts
                      ← routes/routes.ts (inlined NF-e + orders)
                      ← modules/users/ (provisioning)
                      ← routes/assistant.routes.ts (userProvisioningService)

auth.routes.ts        → core/http/asyncHandler
                      → core/http/requireAuth
                      → core/security/rateLimit (loginIpLimiter etc.)

Middlewares próprios: nenhum específico (usa core/http/)
Componentes client:   pages/auth/, hooks/use-auth.ts
```

### 2.2 users

```
users.controller.ts   → core/http/apiResponse
                      → services/storage.ts ⚠️
users.routes.ts       → core/http/asyncHandler (shared/utils re-export)
                      → core/http/requireAuth

controllers/userController.ts → services/storage.ts ⚠️ (LEGADO isolado)

Componentes client:   pages/admin/users.tsx
Hooks client:         use-admin.ts (parcial — também /companies, /price-groups)
```

### 2.3 companies

```
companies.service.ts      → database/db.ts
companies.repository.ts   → database/db.ts
companies.controller.ts   → core/http/apiResponse
                          → services/storage.ts ⚠️ (via controller)

companyCertificate.repository.ts → database/db.ts
                                 ← services/nfe/nfeCertDynamic.ts ⚠️ (fiscal usa companies)

services/companySettingsService.ts → services/storage.ts ⚠️

routes/empresa-config.routes.ts    → services/storage.ts ⚠️
routes/company-validate.routes.ts  → services/storage.ts ⚠️

Componentes client:   pages/admin/companies/ (14 arquivos)
```

### 2.4 orders

```
orders.service.ts         → database/db.ts
                          → core/security/securityLogger (logSecurity)
orders.repository.ts      → database/db.ts
orders.transaction.ts     → database/db.ts
                          → core/security/securityLogger (logSecurity)
orders.outbox.worker.ts   → database/db.ts
                          ← routes/observability.routes.ts ⚠️ (platform usa orders)

orders.routes.ts          → core/http/asyncHandler (shared/utils)
orders.routes.v2.ts       → core/http/asyncHandler (shared/utils)
orders.controller.v2.ts   → core/http/apiResponse (shared/utils)

routes/order-cleanup.routes.ts  → services/storage.ts ⚠️
                                → core/audit/security-logger (logSecurityEvent)
routes/order-windows.routes.ts  → services/storage.ts ⚠️
routes/special-order-requests   → services/storage.ts ⚠️
routes/quotations.routes.ts     → services/storage.ts ⚠️

Dependências de saída (orders → outro domínio):
  NENHUMA — módulo orders é o mais limpo da base ✅

Componentes client:   pages/admin/orders/ (9 arquivos), pages/client/create-order, order-history
Hooks client:         use-ordering.ts, use-force-release-nfe.ts
```

### 2.5 products

```
products.repository.ts  → database/db.ts
products.service.ts     → database/db.ts
pricing.service.ts      → database/db.ts

products.routes.ts      → core/http/asyncHandler
inventory.routes.ts     → core/http/asyncHandler

routes/price-groups     → services/storage.ts ⚠️
routes/product-prices   → services/storage.ts ⚠️
routes/marketplace      → services/storage.ts ⚠️

Componentes client:   pages/admin/products/ (10 arquivos), categories, inventory, marketplace
Hooks client:         use-catalog.ts
```

### 2.6 logistics

```
logistics.service.ts       → database/db.ts (via auto-dispatch)
auto-dispatch.service.ts   → database/db.ts
                           → core/security/securityLogger (logSecurity)
driver.access.ts           → database/db.ts
logistics.controller.ts    → database/db.ts

services/logistics/geoService.ts       → (externo: geocodificação)
services/logistics/routeOptimizer.ts   → geoService.ts

routes/logistics.routes.ts → services/storage.ts ⚠️
                           → database/db.ts
routes/geocode.routes.ts   → services/logistics/geoService.ts

Componentes client:   pages/admin/logistics, driver-panel, pages/track, driver-map
Components:           LeafletRouteMap.tsx
```

### 2.7 security

```
security.service.ts          → database/db.ts
security.block.repository.ts → database/db.ts
security.repository.ts       → database/db.ts

routes/security-events.routes.ts  → core/security/securityLogger (logSecurityEvent, getSecurityEvents)
routes/security-alerts.routes.ts  → core/security/alertEngine (getAlerts)
routes/security-overview.routes.ts → core/security/securityLogger
routes/security-risk.routes.ts     → core/security/* (anomalyDetection, riskDerivation)
routes/audit.routes.ts             → core/audit/audit-logger (logSecurityEvent)

Nota: security depende fortemente de core/security/ — é uma relação correta (domain usa core)

Componentes client:   pages/admin/security-* (3 páginas), governance-dashboard
```

### 2.8 ai

```
services/aiDeveloper/*    → services/storage.ts ⚠️ (systemIndexer faz queries)
services/autoLearning*    → services/storage.ts ⚠️
services/memoryModule.ts  → services/storage.ts ⚠️

routes/assistant.routes.ts      → modules/auth/userProvisioningService ⚠️ (ai → auth)
                                → core/audit/audit-logger (logSecurityEvent)
routes/clara.routes.ts          → core/audit/audit-logger
routes/admin-intelligence       → core/audit/audit-logger
                                → database/db.ts (direct!)
routes/executive-dashboard      → database/db.ts (direct!)

Componentes client:   pages/admin/intelligence, commercial-intelligence, clara-training,
                      executive-dashboard, financial-intelligence, logistics-intelligence,
                      treinamento, ai-developer, developer
Components:           VirtualAssistant.tsx, TrainingMode.tsx
```

### 2.9 reports

```
routes/reports.routes.ts  → services/storage.ts ⚠️

Módulo server/modules/reports/ = VAZIO (apenas README)
Toda lógica de relatórios está inlined em routes.ts ou em reports.routes.ts

Componentes client:   pages/admin/reports/ (3 páginas: financial, industrialized, purchasing)
```

### 2.10 planning

```
routes/purchase-planning.routes.ts → services/storage.ts ⚠️
routes/waste-control.routes.ts     → services/storage.ts ⚠️
routes/sanitary.routes.ts          → services/storage.ts ⚠️

Módulo server/modules/purchases/ = VAZIO (apenas README)

Componentes client:   pages/admin/purchase-planning, waste-control, sanitary
```

### 2.11 settings

```
routes/settings.routes.ts     → services/storage.ts ⚠️
routes/smtp-*.routes.ts       → services/mailer.ts (communications)
routes/policy.routes.ts       → core/policy/policy-engine.service.ts
routes/alert.routes.ts        → services/alerts.* (routing, preferences)

services/alerts.preferences.ts → services/storage.ts ⚠️

Componentes client:   pages/admin/settings, notification-settings, smtp-config, support-config, white-label
```

### 2.12 communications

```
services/mailer.ts          → (externo: SMTP/email)
services/email-scheduler.ts → services/mailer.ts
services/pushService.ts     → core/security/securityLogger (logSecurity)
                            → services/storage.ts ⚠️

routes/email.routes.ts      → services/mailer.ts
routes/push.routes.ts       → services/pushService.ts
routes/announcements.routes.ts → services/storage.ts ⚠️

Hooks client:         use-push-notifications.ts
```

### 2.13 platform

```
routes/health.routes.ts          → core/security/rateLimit (healthTestLimiter)
                                 → core/audit/audit-logger
routes/observability.routes.ts   → modules/orders/orders.outbox.worker ⚠️ (platform → orders)
routes/backup.routes.ts          → services/backup.ts
                                 → core/security/securityLogger (logSecurity)
routes/system-state.routes.ts    → database/db.ts (direct!)
                                 → core/security/securityLogger
routes/logs.routes.ts            → services/storage.ts ⚠️
routes/master.routes.ts          → modules/billing/subscription.middleware ⚠️ (platform → finance)

services/backup.ts               → services/storage.ts ⚠️
services/cache.ts                → (in-memory, sem dependências)

Componentes client:   system-health, system-updates, observability, backups, master-control, control-center
```

---

## Etapa 3 — Plano de Migração

> **REGRA:** Nenhum arquivo é movido até este plano ser aprovado.  
> **MÉTODO:** Para cada arquivo migrado, criar o novo arquivo no destino + re-export no caminho antigo.  
> Isso garante zero quebra de importadores existentes durante a transição.

### 3.1 Estrutura de Destino Proposta

```
server/
├── core/                        ← Intacto (cross-cutting)
├── shared/                      ← Intacto
├── database/                    ← Intacto
├── middleware/                  ← Intacto
├── bootstrap/                   ← Intacto
├── config/                      ← Intacto
│
├── domains/                     ← NOVO — todos os módulos de negócio
│   ├── auth/
│   │   ├── auth.controller.ts
│   │   ├── auth.repository.ts
│   │   ├── auth.routes.ts
│   │   ├── auth.service.ts
│   │   ├── auth.types.ts
│   │   ├── auth.validation.ts
│   │   ├── user-provisioning.service.ts
│   │   ├── password-reset.routes.ts    ← de routes/
│   │   ├── governance.routes.ts        ← de routes/
│   │   └── index.ts
│   │
│   ├── users/
│   │   ├── users.controller.ts
│   │   ├── users.repository.ts
│   │   ├── users.routes.ts
│   │   ├── users.admin.routes.ts
│   │   ├── users.service.ts
│   │   ├── users.types.ts
│   │   ├── users.validation.ts
│   │   └── index.ts
│   │   # Nota: controllers/userController.ts → verificar overlap antes de mover
│   │
│   ├── companies/
│   │   ├── companies.controller.ts
│   │   ├── companies.repository.ts
│   │   ├── companies.routes.ts
│   │   ├── companies.service.ts
│   │   ├── companies.types.ts
│   │   ├── companies.validation.ts
│   │   ├── certificate.repository.ts
│   │   ├── company-settings.service.ts  ← de services/
│   │   ├── empresa-config.routes.ts     ← de routes/
│   │   ├── company-validate.routes.ts   ← de routes/
│   │   ├── client-contract-scope.routes.ts ← de routes/
│   │   ├── contracts-alerts.routes.ts   ← de routes/
│   │   └── index.ts
│   │
│   ├── orders/
│   │   ├── orders.controller.ts
│   │   ├── orders.controller.v2.ts
│   │   ├── orders.repository.ts
│   │   ├── orders.routes.ts
│   │   ├── orders.routes.v2.ts
│   │   ├── orders.service.ts
│   │   ├── orders.transaction.ts
│   │   ├── orders.outbox.worker.ts
│   │   ├── orders.types.ts
│   │   ├── orders.validation.ts
│   │   ├── orders.workflow.ts
│   │   ├── order-cleanup.routes.ts      ← de routes/
│   │   ├── order-exceptions.routes.ts   ← de routes/
│   │   ├── order-windows.routes.ts      ← de routes/
│   │   ├── special-order-requests.routes.ts ← de routes/
│   │   ├── quotations.routes.ts         ← de routes/
│   │   ├── import-data.routes.ts        ← de routes/
│   │   └── index.ts
│   │
│   ├── products/
│   │   ├── products.controller.ts
│   │   ├── products.repository.ts
│   │   ├── products.routes.ts
│   │   ├── products.service.ts
│   │   ├── products.types.ts
│   │   ├── products.validation.ts
│   │   ├── categories.routes.ts
│   │   ├── pricing.routes.ts
│   │   ├── pricing.service.ts
│   │   ├── upload.routes.ts
│   │   ├── price-groups.routes.ts       ← de routes/
│   │   ├── product-prices.routes.ts     ← de routes/
│   │   ├── marketplace.routes.ts        ← de routes/
│   │   ├── utils/
│   │   └── index.ts
│   │
│   ├── inventory/                       ← subdomínio de products
│   │   ├── inventory.controller.ts
│   │   ├── inventory.repository.ts
│   │   ├── inventory.routes.ts
│   │   ├── inventory.service.ts
│   │   ├── inventory.types.ts
│   │   └── index.ts
│   │
│   ├── logistics/
│   │   ├── logistics.controller.ts
│   │   ├── logistics.repository.ts
│   │   ├── logistics.routes.ts
│   │   ├── logistics.service.ts
│   │   ├── logistics.types.ts
│   │   ├── auto-dispatch.service.ts
│   │   ├── driver.access.ts
│   │   ├── eta.service.ts
│   │   ├── geocode.routes.ts            ← de routes/
│   │   ├── geo.service.ts               ← de services/logistics/
│   │   ├── route-optimizer.service.ts   ← de services/logistics/
│   │   └── index.ts
│   │
│   ├── security/
│   │   ├── security.blocker.ts
│   │   ├── security.block.repository.ts
│   │   ├── security.controller.ts
│   │   ├── security.repository.ts
│   │   ├── security.service.ts
│   │   ├── security.routes.ts           ← de routes/
│   │   ├── security-alerts.routes.ts    ← de routes/
│   │   ├── security-analysis.routes.ts  ← de routes/
│   │   ├── security-events.routes.ts    ← de routes/
│   │   ├── security-overview.routes.ts  ← de routes/
│   │   ├── security-risk.routes.ts      ← de routes/
│   │   ├── audit.routes.ts              ← de routes/
│   │   └── index.ts
│   │
│   ├── ai/
│   │   ├── ai-developer.service.ts      ← de services/aiDeveloper/
│   │   ├── bug-detector.service.ts      ← de services/aiDeveloper/
│   │   ├── code-analyzer.service.ts     ← de services/aiDeveloper/
│   │   ├── lab-functions.ts             ← de services/aiDeveloper/
│   │   ├── system-indexer.service.ts    ← de services/aiDeveloper/
│   │   ├── auto-learning.module.ts      ← de services/
│   │   ├── memory.module.ts             ← de services/
│   │   ├── clara.routes.ts              ← de routes/
│   │   ├── assistant.routes.ts          ← de routes/
│   │   ├── admin-intelligence.routes.ts ← de routes/
│   │   ├── client-intelligence.routes.ts ← de routes/
│   │   ├── executive-dashboard.routes.ts ← de routes/
│   │   ├── scope-simulations.routes.ts  ← de routes/
│   │   └── index.ts
│   │
│   ├── reports/
│   │   ├── reports.routes.ts            ← de routes/
│   │   └── index.ts
│   │
│   ├── planning/
│   │   ├── purchase-planning.routes.ts  ← de routes/
│   │   ├── waste-control.routes.ts      ← de routes/
│   │   ├── sanitary.routes.ts           ← de routes/
│   │   └── index.ts
│   │
│   ├── settings/
│   │   ├── settings.routes.ts           ← de routes/
│   │   ├── smtp-config.routes.ts        ← de routes/
│   │   ├── smtp-test.routes.ts          ← de routes/
│   │   ├── policy.routes.ts             ← de routes/
│   │   ├── alert.routes.ts              ← de routes/
│   │   ├── alerts.preferences.service.ts ← de services/
│   │   └── index.ts
│   │
│   ├── communications/
│   │   ├── mailer.service.ts            ← de services/
│   │   ├── email-scheduler.service.ts   ← de services/
│   │   ├── push.service.ts              ← de services/
│   │   ├── email.routes.ts              ← de routes/
│   │   ├── push.routes.ts               ← de routes/
│   │   ├── announcements.routes.ts      ← de routes/
│   │   └── index.ts
│   │
│   ├── platform/
│   │   ├── health.routes.ts             ← de routes/
│   │   ├── observability.routes.ts      ← de routes/
│   │   ├── system-state.routes.ts       ← de routes/
│   │   ├── system-status.routes.ts      ← de routes/
│   │   ├── system-sync.routes.ts        ← de routes/
│   │   ├── system-versions.routes.ts    ← de routes/
│   │   ├── logs.routes.ts               ← de routes/
│   │   ├── event.routes.ts              ← de routes/
│   │   ├── backup.routes.ts             ← de routes/
│   │   ├── about-us.routes.ts           ← de routes/
│   │   ├── master.routes.ts             ← de routes/
│   │   ├── search.routes.ts             ← de routes/
│   │   ├── backup.service.ts            ← de services/
│   │   ├── cache.service.ts             ← de services/
│   │   ├── logger.service.ts            ← de services/
│   │   └── index.ts
│   │
│   ├── fiscal/           ← CONGELADO ❄️ — não migrar
│   └── finance/          ← CONGELADO ❄️ — não migrar
│
├── infra/                               ← Consolida server/infra/ + services/infra
│   ├── pdf-parser.ts
│   ├── upload.ts
│   └── storage/
│       └── storage.ts                   ← Mantido intacto (deus-objeto)
│
├── routes/                              ← Mantido como legacy durante transição
│   ├── index.ts                         ← Novo registry central
│   └── routes.ts                        ← Mantido (4.496 linhas, migrar gradualmente)
│
├── jobs/
│   └── faturamento.cron.ts              ← Mantido (pertence a fiscal, congelado)
│
└── modules/                             ← Esvaziado gradualmente durante migração
    └── (re-exports de compatibilidade enquanto domains/ cresce)
```

### 3.2 Tabela de Migração Arquivo por Arquivo

| Origem | Destino | Re-export necessário? | Importadores afetados |
|--------|---------|----------------------|----------------------|
| `server/modules/auth/*` | `server/domains/auth/*` | ✅ Sim | routes/routes.ts, middleware/auth.ts |
| `server/modules/users/*` | `server/domains/users/*` | ✅ Sim | routes/routes.ts |
| `server/controllers/userController.ts` | Absorver em `domains/users/` | ✅ Sim | routes/routes.ts |
| `server/modules/companies/*` | `server/domains/companies/*` | ✅ Sim | routes/routes.ts, services/nfe/ |
| `server/services/companySettingsService.ts` | `server/domains/companies/` | ✅ Sim | routes/ |
| `server/routes/empresa-config.routes.ts` | `server/domains/companies/` | ✅ Sim | routes/routes.ts |
| `server/routes/company-validate.routes.ts` | `server/domains/companies/` | ✅ Sim | routes/routes.ts |
| `server/modules/orders/*` | `server/domains/orders/*` | ✅ Sim | routes/routes.ts, server/index.ts |
| `server/routes/order-*.routes.ts` | `server/domains/orders/` | ✅ Sim | routes/routes.ts |
| `server/modules/products/*` | `server/domains/products/*` | ✅ Sim | routes/routes.ts |
| `server/modules/inventory/*` | `server/domains/inventory/*` | ✅ Sim | routes/routes.ts |
| `server/routes/price-groups.routes.ts` | `server/domains/products/` | ✅ Sim | routes/routes.ts |
| `server/modules/logistics/*` | `server/domains/logistics/*` | ✅ Sim | routes/routes.ts |
| `server/services/logistics/*` | `server/domains/logistics/` | ✅ Sim | routes/geocode.routes.ts |
| `server/modules/security/*` | `server/domains/security/*` | ✅ Sim | routes/security*.routes.ts |
| `server/routes/security*.routes.ts` | `server/domains/security/` | ✅ Sim | routes/routes.ts |
| `server/services/aiDeveloper/*` | `server/domains/ai/` | ✅ Sim | routes/ai*.routes.ts |
| `server/services/autoLearningModule.ts` | `server/domains/ai/` | ✅ Sim | routes/routes.ts |
| `server/services/memoryModule.ts` | `server/domains/ai/` | ✅ Sim | routes/routes.ts |
| `server/routes/clara.routes.ts` | `server/domains/ai/` | ✅ Sim | routes/routes.ts |
| `server/routes/reports.routes.ts` | `server/domains/reports/` | ✅ Sim | routes/routes.ts |
| `server/routes/purchase-planning.routes.ts` | `server/domains/planning/` | ✅ Sim | routes/routes.ts |
| `server/routes/settings.routes.ts` | `server/domains/settings/` | ✅ Sim | routes/routes.ts |
| `server/routes/smtp-*.routes.ts` | `server/domains/settings/` | ✅ Sim | routes/routes.ts |
| `server/services/alerts.preferences.ts` | `server/domains/settings/` | ✅ Sim | routes/routes.ts |
| `server/services/mailer.ts` | `server/domains/communications/` | ✅ Sim | routes/, services/ |
| `server/services/pushService.ts` | `server/domains/communications/` | ✅ Sim | routes/push.routes.ts |
| `server/services/email-scheduler.ts` | `server/domains/communications/` | ✅ Sim | routes/routes.ts |
| `server/routes/health.routes.ts` | `server/domains/platform/` | ✅ Sim | routes/routes.ts |
| `server/routes/backup.routes.ts` | `server/domains/platform/` | ✅ Sim | routes/routes.ts |
| `server/services/backup.ts` | `server/domains/platform/` | ✅ Sim | routes/backup.routes.ts |
| `server/services/cache.ts` | `server/domains/platform/` | ✅ Sim | routes/ |
| `server/infra/upload.ts` | `server/infra/` | ✅ Sim | routes/products |
| `server/infra/pdfParser.ts` | `server/infra/` | ✅ Sim | routes/fiscal-invoices |

**Total de arquivos a mover:** ~120 arquivos server + 0 client  
**Re-exports a criar:** ~120 (um por arquivo movido)  
**Importadores que não precisam ser alterados:** todos (via re-exports)

### 3.3 Tempo Estimado por Domínio

| Domínio | Arquivos server | Arquivos client | Estimativa |
|---------|----------------|----------------|------------|
| auth | 12 | 5 | 2h |
| users | 8 | 2 | 1h |
| companies | 14 | 15 | 3h |
| orders | 18 | 12 | 4h |
| products | 14 | 12 | 3h |
| logistics | 12 | 5 | 2h |
| security | 12 | 4 | 2h |
| ai | 15 | 9 | 3h |
| reports | 2 | 3 | 30min |
| planning | 4 | 3 | 1h |
| settings | 6 | 5 | 1h |
| communications | 6 | 2 | 1h |
| platform | 14 | 6 | 2h |
| **Total** | **~137** | **~83** | **~25h** |

---

## Etapa 4 — Detecção de Acoplamentos

### 4.1 Mapa Completo de Acoplamentos Identificados

#### 🔴 CRÍTICOS — Bloqueadores de migração independente

| # | Acoplamento | Origem | Destino | Impacto |
|---|-------------|--------|---------|---------|
| CR1 | **storage.ts deus-objeto** | `services/storage.ts` | Todos os 71 importadores | Impossível migrar qualquer domínio sem enfrentar a dependência em storage. Decomposição é pré-requisito para migração limpa. |
| CR2 | **routes.ts monolítico** | `routes/routes.ts` (4.496 linhas) | orders, nfe, auth, finance, billing | Contém lógica de negócio inlined para NF-e (POST /api/nfe/emitir etc.) que não pode ser simplesmente movida sem um refactor completo. |
| CR3 | **platform → orders** | `routes/observability.routes.ts` | `modules/orders/orders.outbox.worker` | Platform importa diretamente de orders — viola fronteira de domínio. |
| CR4 | **platform → finance** | `routes/master.routes.ts` | `modules/billing/subscription.middleware` | Platform importa middleware de billing — viola fronteira de domínio. |

#### 🟡 MELHORAR — Acoplamentos a resolver antes/durante migração

| # | Acoplamento | Origem | Destino | Impacto |
|---|-------------|--------|---------|---------|
| AM1 | **services → modules (alerts)** | `services/alerts.service.ts` | `modules/nfe/alerts-log.store` | Uma camada de infraestrutura (services/) importa de um domínio (nfe). Deveria ser invertido: nfe notifica alerts via interface/evento. |
| AM2 | **services → modules (alerts smart)** | `services/alerts.smart.ts` | `modules/nfe/alerts-log.store` | Mesmo problema que AM1. |
| AM3 | **services/storage → modules/billing** | `services/storage.ts` | `modules/billing/usage-cache` | O deus-objeto de infra importa de um módulo de domínio — cria dependência cíclica implícita. |
| AM4 | **nfe → billing (cross-domain)** | `modules/nfe/nfe-persist.transaction.ts` | `modules/billing/usage-cache` | NF-e (fiscal, congelado) invalida cache de billing ao persistir. Acoplamento implícito entre dois domínios congelados. |
| AM5 | **ai → auth** | `routes/assistant.routes.ts` | `modules/auth/userProvisioningService` | AI usa provisionamento de usuário diretamente. Deveria usar interface de users ou evento. |
| AM6 | **ai → db direto** | `routes/admin-intelligence.routes.ts`, `routes/executive-dashboard.routes.ts` | `database/db.ts` | Routes de domínio acessando DB diretamente sem repository/service. |
| AM7 | **platform → db direto** | `routes/system-state.routes.ts` | `database/db.ts` | Rota de plataforma acessando DB diretamente. |
| AM8 | **userController legado** | `server/controllers/userController.ts` | Potencial sobreposição com `modules/users/` | Arquivo isolado fora do módulo; risco de lógica duplicada. |

#### 🟢 ACEITÁVEIS — Dependências esperadas e corretas

| # | Acoplamento | Justificativa |
|---|-------------|---------------|
| AC1 | `services/nfe/nfeCertDynamic.ts` → `modules/companies/certificate.repository` | NF-e precisa do certificado digital da empresa — dependência funcional obrigatória |
| AC2 | `modules/orders/orders.*` → `core/security/securityLogger` | Domínio usa infra de logging — correto (domínio → core) |
| AC3 | `modules/logistics/auto-dispatch` → `core/security/securityLogger` | Mesmo caso AC2 |
| AC4 | Routes de domínio → `core/http/asyncHandler`, `core/http/requireAuth` | Correto — domínio usa infraestrutura técnica do core |
| AC5 | `jobs/faturamento.cron.ts` → `modules/nfe/*` + `modules/billing/*` | Job orquestra dois domínios congelados — acoplamento funcional necessário |
| AC6 | `routes/security-*.routes.ts` → `core/security/*` | Security usa core de segurança — correto (domínio → core) |

### 4.2 Imports Circulares Detectados

```
services/storage.ts
  → modules/billing/usage-cache
  ← modules/*/repository.ts (todos os domínios)
  
Resultado: storage é o centro de um "star pattern" com 71 arestas.
Não é circular puro, mas é um hub que cria acoplamento implícito total.

Circulares reais (potenciais):
  services/alerts.service.ts → modules/nfe/alerts-log.store
  modules/nfe/* usa services/storage.ts ← que usa modules/billing
  ↑ Ciclo: nfe → storage → billing, e nfe → billing direto
```

### 4.3 Controllers acessando outros domínios diretamente

| Controller | Acesso cross-domain | Classificação |
|-----------|---------------------|---------------|
| `routes/assistant.routes.ts` | `modules/auth/userProvisioningService` | 🟡 AM5 |
| `routes/admin-intelligence.routes.ts` | `database/db.ts` direto | 🟡 AM6 |
| `routes/executive-dashboard.routes.ts` | `database/db.ts` direto | 🟡 AM6 |
| `routes/observability.routes.ts` | `modules/orders/orders.outbox.worker` | 🔴 CR3 |
| `routes/master.routes.ts` | `modules/billing/subscription.middleware` | 🔴 CR4 |

### 4.4 Hooks client acessando APIs incorretas

| Hook | APIs consumidas | Observação |
|------|----------------|------------|
| `use-admin.ts` | `/api/companies`, `/api/users`, `/api/price-groups` | 🟡 Hook genérico agrega 3 domínios — deveria ser dividido em `use-companies`, `use-users` |
| `use-ordering.ts` | `/api/order-windows`, `/api/settings`, `/api/orders`, `/api/reports/purchasing`, `/api/reports/financial` | 🟡 Agrega orders + settings + reports — candidato a decomposição |
| `use-force-release-nfe.ts` | `/api/orders/:id/fiscal` | 🟢 Aceitável — borda orders/fiscal gerenciada intencionalmente |

---

## Etapa 5 — Matriz de Migração

| Domínio | Arquivos server | Prioridade | Complexidade | Pode migrar isolado? | Requer compatibilidade? | Necessita re-export? | Depende de |
|---------|----------------|------------|--------------|---------------------|------------------------|---------------------|------------|
| **auth** | 12 | 🔴 Alta | 🟡 Média | ✅ Sim | ✅ Sim | ✅ Sim | core/, middleware/ |
| **users** | 8 | 🔴 Alta | 🟢 Baixa | ✅ Sim | ✅ Sim | ✅ Sim | auth (provisioning) |
| **companies** | 14 | 🔴 Alta | 🟡 Média | ✅ Sim | ✅ Sim | ✅ Sim | storage.ts (partial) |
| **orders** | 18 | 🟡 Média | 🟡 Média | ✅ Sim | ✅ Sim | ✅ Sim | storage.ts, billing |
| **products** | 14 | 🟡 Média | 🟢 Baixa | ✅ Sim | ✅ Sim | ✅ Sim | storage.ts |
| **logistics** | 12 | 🟡 Média | 🟢 Baixa | ✅ Sim | ✅ Sim | ✅ Sim | storage.ts |
| **security** | 12 | 🟡 Média | 🟡 Média | ✅ Sim | ✅ Sim | ✅ Sim | core/security/ |
| **ai** | 15 | 🟢 Baixa | 🟡 Média | ⚠️ Parcial | ✅ Sim | ✅ Sim | auth (AM5), db direto (AM6) |
| **reports** | 2 | 🟢 Baixa | 🟢 Baixa | ✅ Sim | ✅ Sim | ✅ Sim | storage.ts |
| **planning** | 4 | 🟢 Baixa | 🟢 Baixa | ✅ Sim | ✅ Sim | ✅ Sim | storage.ts |
| **settings** | 6 | 🟢 Baixa | 🟢 Baixa | ✅ Sim | ✅ Sim | ✅ Sim | core/policy/, mailer |
| **communications** | 6 | 🟢 Baixa | 🟢 Baixa | ✅ Sim | ✅ Sim | ✅ Sim | pushService, mailer |
| **platform** | 14 | 🟢 Baixa | 🟡 Média | ⚠️ Parcial | ✅ Sim | ✅ Sim | orders (CR3), billing (CR4) |
| **fiscal** | ~40 | ❄️ CONGELADO | 🔴 Alta | ❌ Não | — | — | billing, companies |
| **finance** | ~20 | ❄️ CONGELADO | 🔴 Alta | ❌ Não | — | — | fiscal, orders |

### 5.1 Ordem de Migração Recomendada

```
WAVE 1 — Base independente (sem cross-domain críticos)
  1. users        — mais isolado, sem dependências entre domínios
  2. auth         — base de todo o sistema, clean module existente
  3. companies    — pré-requisito para fiscal/nfe (certificate.repository)
  4. logistics    — clean module, sem cross-domain
  5. products     — clean module, inventory embutido

WAVE 2 — Domínios com dependência em storage.ts (migrar após iniciar decomposição do storage)
  6. orders       — maior domínio, outbox worker
  7. security     — 6 route files a consolidar
  8. communications — mailer, push, email-scheduler

WAVE 3 — Domínios leves / aggregators
  9. reports      — apenas 1 route file, sem lógica própria
 10. planning     — 3 route files, sem lógica própria
 11. settings     — 5 route files, alerts.preferences

WAVE 4 — Domínios com acoplamentos a resolver antes
 12. platform     — resolver CR3 (platform→orders) e CR4 (platform→billing)
 13. ai           — resolver AM5 (ai→auth) e AM6 (ai→db direto)

WAVE 5 — Descomissionar routes.ts e modules/
 14. Migrar lógica inlined de routes.ts para os domínios correspondentes
 15. Converter server/modules/ em pasta de re-exports
 16. Converter server/routes/ em index.ts de registro apenas

FROZEN — Não migrar
 ∞. fiscal       — aguardar estabilização completa
 ∞. finance      — aguardar estabilização completa
```

### 5.2 Pré-condições Obrigatórias Antes de Qualquer Migração

| # | Pré-condição | Por quê |
|---|-------------|---------|
| P1 | Resolver acoplamentos CR3 e CR4 (platform → orders/billing) | Sem isso, platform não pode migrar isoladamente |
| P2 | Iniciar decomposição de storage.ts (extrair 5-10 repositórios por domínio) | storage.ts conecta todos os domínios; migrar domínio sem resolver storage apenas move o problema |
| P3 | Criar `server/routes/index.ts` como novo registry central | Pré-requisito para descomissionar routes.ts gradualmente |
| P4 | `npm run check:strict` passando zero erros antes de cada wave | Garantia de que nenhum re-export está quebrado |
| P5 | Smoke test de todos os endpoints após cada wave | Garantia de zero regressão |

---

## Apêndice A — Contagem de Arquivos por Destino

| Destino proposto | Arquivos vindos de modules/ | Arquivos vindos de routes/ | Arquivos vindos de services/ |
|-----------------|-----------------------------|-----------------------------|------------------------------|
| `domains/auth/` | 8 | 2 | 0 |
| `domains/users/` | 7 | 0 | 0 |
| `domains/companies/` | 8 | 4 | 1 |
| `domains/orders/` | 11 | 6 | 0 |
| `domains/products/` + `inventory/` | 15 | 3 | 0 |
| `domains/logistics/` | 8 | 2 | 2 |
| `domains/security/` | 5 | 7 | 0 |
| `domains/ai/` | 0 | 6 | 7 |
| `domains/reports/` | 0 | 1 | 0 |
| `domains/planning/` | 0 | 3 | 0 |
| `domains/settings/` | 0 | 5 | 1 |
| `domains/communications/` | 0 | 3 | 3 |
| `domains/platform/` | 0 | 12 | 3 |
| **TOTAL** | **62** | **54** | **17** |

**Total geral a migrar:** ~133 arquivos server (excluindo fiscal e finance congelados)

---

## Apêndice B — Checklist de Aprovação

Antes de iniciar qualquer wave de migração física:

- [ ] Este plano foi revisado e aprovado
- [ ] Acoplamentos CR3 e CR4 foram resolvidos
- [ ] `server/routes/index.ts` (novo registry) foi criado
- [ ] Estratégia de decomposição de `storage.ts` foi definida
- [ ] Ambiente de teste smoke-test está configurado
- [ ] `npm run check:strict` → 0 erros no baseline atual
- [ ] `npm run test:unit` → todos os testes passando no baseline atual
