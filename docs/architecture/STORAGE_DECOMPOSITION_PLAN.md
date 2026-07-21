# STORAGE_DECOMPOSITION_PLAN.md
## Portal VIVAFrutaz ERP — Fase 3

> **Documento de análise e planejamento. Nenhum arquivo de código foi alterado.**
>
> Gerado em: 2026-07-21
> Arquivo analisado: `server/services/storage.ts` (2 997 linhas)

---

## Resumo Executivo

| Indicador | Valor |
|---|---|
| Total de métodos na interface `IStorage` | **326** |
| Total de métodos na implementação `DatabaseStorage` | **344** (18 extras não declarados na interface) |
| Importadores diretos | **71 arquivos** |
| Domínios identificados | **15** |
| Domínios congelados | **2** (Finance, Fiscal) |
| Domínios prontos para extração imediata | **13** |

---

## ETAPA 1 — Mapeamento Completo

### Dependências de entrada (imports do arquivo)

```
bcryptjs                          → hash de senha em createUser / createCompany / updateUser
../database/db                    → instância Drizzle ORM (todas as queries)
./cache.js                        → cache LRU (getCompanies, getPriceGroups)
../modules/billing/usage-cache    → invalidateUsageCache (createUser, updateUser, deleteUser, createOrder, etc.)
../core/security/securityLogger   → logSecurity (createLog, getPriceGroups)
../core/tenant/scope              → tenantWhere / tenantAnd / withTenant / stripTenantFields
../core/tenant/context            → requireTenantId / currentTenantId
@shared/schema                    → todas as 80+ tabelas e tipos Drizzle
drizzle-orm                       → eq, and, desc, gte, lte, sql, inArray
```

### Estrutura do arquivo

| Elemento | Detalhes |
|---|---|
| Interface principal | `IStorage` (linhas 83–600) |
| Classe principal | `DatabaseStorage implements IStorage` (linhas 602–2 995) |
| Singleton exportado | `export const storage = new DatabaseStorage()` (linha 2 997) |
| Helpers de tenant | `tenantWhere`, `tenantAnd`, `withTenant`, `stripTenantFields` — importados, não definidos aqui |
| Transações DB | `db.transaction(async tx => …)` usada em `createOrder` |
| Sequence Postgres | `nextval('nfe_numero_seq')` em `getNextNfeNumero` |
| Cache interno | `cache.get/set` em `getCompanies`, `getPriceGroups` |
| Métodos `@deprecated` | `payAccountReceivable`, `payAccountPayable`, `getAccountReceivableByOrderId`, `listCnabImportHistory` |

### Métodos apenas na implementação (não declarados em `IStorage`)

| Método | Observação |
|---|---|
| `updateTask` | Esquecido na interface |
| `updateInternalIncident` | Esquecido na interface |
| `upsertAboutUs` | Esquecido na interface |
| `upsertSmtpConfig` | Esquecido na interface |
| `upsertPushSubscription` | Esquecido na interface |
| `upsertNotificationSetting` | Esquecido na interface |
| `updateSanitaryQuestion` | Esquecido na interface |
| `updateSanitaryEvaluation` | Esquecido na interface |
| `updateSanitaryEvaluationItem` | Esquecido na interface |
| `getOrdersSafe` (2ª assinatura) | Alias de `getCompanyOrders` |
| e outros ~8 | Divergência entre interface e implementação |

---

## ETAPA 2 — Classificação por Domínio

### Mapa de Domínios

```
storage.ts
│
├── Users            → getUser*, createUser, updateUser, deleteUser, getUsers*
├── Companies        → getCompany*, createCompany, updateCompany, deleteCompany,
│                      getCompanyConfig, updateCompanyConfig, getCompanySettings,
│                      updateCompanySettings, getCompanyAddresses*, setPrimaryAddress
│                      getEmpresaConfig, upsertEmpresaConfig
├── Customers        → ContractScopes, ContractAdjustments, ScopeSimulations
│                      CompanyQuotations
├── Products         → getProducts*, categories, priceGroups, productPrices,
│                      productSubCategories
├── Orders           → getOrder*, createOrder, updateOrder, deleteOrder,
│                      OrderWindows, OrderExceptions, SpecialOrderRequests,
│                      PasswordResetRequests, TestOrders
│                      getPurchasingReport, getIndustrializedReport
├── Planning         → WasteControl, PurchasePlanStatus
├── Inventory        → InventorySettings, InventoryEntries, InventoryMovements,
│                      InventoryPhysicalCounts
├── Logistics        → Drivers, Vehicles, Routes, Maintenance,
│                      LogisticsAuditLogs, DriverGpsPositions
├── Delivery         → Deliveries, DeliveryChecklists, RouteStops
├── AI               → AiLogs, ClaraTraining
├── Settings         → SystemSettings (key/value), AboutUs, SmtpConfig,
│                      EmailSchedules, EmailLogs, PushSubscriptions,
│                      NotificationSettings, Announcements, SystemLogs,
│                      SystemVersions, SystemUpdates, UpdateLogs
├── Incidents        → ClientIncidents, IncidentMessages, InternalIncidents, Tasks
├── Finance 🔒       → AccountsReceivable, AccountsPayable, FinancialTransactions,
│                      BankAccounts, BankTransactions, CnabImportHistory
├── Fiscal  🔒       → NfeEmissoes, NfeTrainingLogs, NfeCce, FiscalInvoices,
│                      DanfeRecords
└── SaaS             → Planos, Assinaturas, BillingEvents, ModulosSistema,
                       PlanoModulos, BancosRecebimento, ContratosClientes,
                       FaturasSaas, SaasMetrics, ModulosMarketplace, EmpresaModulos
```

> 🔒 = Congelado — extrair apenas após autorização explícita.

### Mapa de importadores por arquivo

| Arquivo importador | Domínios utilizados |
|---|---|
| `server/routes/routes.ts` | Users, Companies, Products, Orders, Settings, Incidents, Customers, SaaS |
| `server/routes/logistics.routes.ts` | Logistics, Delivery |
| `server/routes/reports.routes.ts` | Orders (Reports), Finance |
| `server/routes/bank.routes.ts` | Finance |
| `server/routes/fiscal-invoices.routes.ts` | Fiscal |
| `server/routes/purchase-planning.routes.ts` | Planning |
| `server/routes/settings.routes.ts` | Settings |
| `server/routes/saas.routes.ts` | SaaS |
| `server/routes/marketplace.routes.ts` | SaaS (Marketplace) |
| `server/routes/master.routes.ts` | SaaS, Companies, Users |
| `server/routes/announcements.routes.ts` | Settings (Announcements) |
| `server/routes/tasks.routes.ts` | Incidents (Tasks) |
| `server/routes/incidents.routes.ts` | Incidents |
| `server/routes/assistant.routes.ts` | AI |
| `server/routes/clara.routes.ts` | AI |
| `server/routes/waste-control.routes.ts` | Planning |
| `server/routes/order-windows.routes.ts` | Orders |
| `server/routes/order-exceptions.routes.ts` | Orders |
| `server/routes/order-cleanup.routes.ts` | Orders |
| `server/routes/special-order-requests.routes.ts` | Orders |
| `server/routes/product-prices.routes.ts` | Products |
| `server/routes/price-groups.routes.ts` | Products |
| `server/routes/quotations.routes.ts` | Customers |
| `server/routes/scope-simulations.routes.ts` | Customers |
| `server/routes/client-contract-scope.routes.ts` | Customers |
| `server/routes/contracts-alerts.routes.ts` | Customers, Orders |
| `server/routes/client-intelligence.routes.ts` | Companies, Orders, Products |
| `server/routes/executive-dashboard.routes.ts` | Orders, Companies, Finance |
| `server/routes/inventory.routes.ts` (indireta) | Inventory |
| `server/routes/email.routes.ts` | Settings (Email) |
| `server/routes/smtp-config.routes.ts` | Settings |
| `server/routes/push.routes.ts` | Settings |
| `server/routes/sanitary.routes.ts` | (Sanitary → Settings/Quality) |
| `server/routes/backup.routes.ts` | Settings |
| `server/routes/audit.routes.ts` | Settings (Logs) |
| `server/routes/logs.routes.ts` | Settings (Logs) |
| `server/routes/security.routes.ts` | Settings (Logs) |
| `server/routes/security-risk.routes.ts` | Settings (Logs) |
| `server/routes/health.routes.ts` | Settings |
| `server/routes/system-state.routes.ts` | Settings |
| `server/routes/system-sync.routes.ts` | Settings |
| `server/routes/system-versions.routes.ts` | Settings (Versions) |
| `server/routes/password-reset-requests.routes.ts` | Orders |
| `server/routes/admin-intelligence.routes.ts` | Companies, Orders, Users |
| `server/routes/about-us.routes.ts` | Settings |
| `server/routes/empresa-config.routes.ts` | Companies, SaaS |
| `server/routes/saas.routes.ts` | SaaS |
| `server/routes/billing.*` | SaaS |
| `server/modules/orders/orders.repository.ts` | Orders |
| `server/modules/users/users.repository.ts` | Users |
| `server/modules/companies/companies.repository.ts` | Companies |
| `server/modules/products/products.repository.ts` | Products |
| `server/modules/logistics/logistics.repository.ts` | Logistics, Delivery |
| `server/modules/inventory/inventory.repository.ts` | Inventory |
| `server/modules/finance/finance.repository.ts` | Finance 🔒 |
| `server/modules/nfe/nfe-input.builder.ts` | Fiscal 🔒, Orders |
| `server/modules/nfe/nfe-transmit.service.ts` | Fiscal 🔒 |
| `server/modules/banking/itau/retorno.service.ts` | Finance 🔒 |
| `server/modules/billing/billing.service.ts` | SaaS |
| `server/modules/billing/billing.cron.ts` | SaaS |
| `server/modules/billing/subscription.middleware.ts` | SaaS |
| `server/modules/auth/auth.repository.ts` | Users, Companies |
| `server/modules/auth/userProvisioningService.ts` | Users, Companies |
| `server/core/auth/authCore.service.ts` | Users, Companies |
| `server/core/audit/security-logger.ts` | Settings (Logs) |
| `server/core/http/requireAuth.ts` | Users |
| `server/core/security/tenantGuard.ts` | Companies |
| `server/core/tenant/safeQueryRouter.ts` | Companies |
| `server/middleware/tenant.ts` | Companies |
| `server/jobs/faturamento.cron.ts` | Orders, Finance 🔒 |

---

## ETAPA 3 — Tabela de Métodos por Domínio

> **Legenda — Pode sair?**
> ✅ Sim — sem bloqueadores técnicos
> ⚠️ Cuidado — dependência cruzada interna (chama outro método de storage)
> 🔒 Não (congelado) — Finance/Fiscal, aguardar autorização
> ℹ️ Junto — deve mover junto com grupo dependente

### Domínio: **Users** (7 métodos)

| Método | Importadores | Pode sair? | Dependências internas |
|---|---|---|---|
| `getUserByEmail` | ~15 | ✅ | — |
| `getUser` | ~20 | ✅ | — |
| `createUser` | ~5 | ✅ | `invalidateUsageCache` (externo) |
| `updateUser` | ~10 | ✅ | `invalidateUsageCache` |
| `getUsers` | ~8 | ✅ | — |
| `getUsersSafe` | ~3 | ✅ | — |
| `deleteUser` | ~5 | ✅ | `invalidateUsageCache` |

**Total importadores afetados:** ~25 arquivos

---

### Domínio: **Companies** (17 métodos)

| Método | Importadores | Pode sair? | Dependências internas |
|---|---|---|---|
| `getCompanyByEmail` | ~10 | ✅ | — |
| `getCompany` | ~30 | ✅ | — |
| `getCompanies` | ~15 | ✅ | `cache` |
| `createCompany` | ~5 | ✅ | bcrypt |
| `updateCompany` | ~10 | ✅ | bcrypt |
| `deleteCompany` | ~3 | ✅ | — |
| `getCompanyConfig` | ~5 | ✅ | — |
| `updateCompanyConfig` | ~3 | ✅ | — |
| `getCompanySettings` | ~5 | ✅ | — |
| `updateCompanySettings` | ~5 | ⚠️ | chama `getCompanySettings` |
| `getCompanyAddresses` | ~5 | ✅ | — |
| `createCompanyAddress` | ~3 | ✅ | — |
| `updateCompanyAddress` | ~3 | ✅ | — |
| `deleteCompanyAddress` | ~3 | ✅ | — |
| `setPrimaryAddress` | ~3 | ✅ | — |
| `getEmpresaConfig` | ~8 | ✅ | — |
| `upsertEmpresaConfig` | ~5 | ⚠️ | chama `getEmpresaConfig` |

**Total importadores afetados:** ~35 arquivos

---

### Domínio: **Customers / Contracts** (18 métodos)

| Método | Importadores | Pode sair? | Dependências internas |
|---|---|---|---|
| `getContractScopes` | ~5 | ✅ | — |
| `getContractScope` | ~3 | ✅ | — |
| `createContractScope` | ~3 | ✅ | — |
| `updateContractScope` | ~3 | ✅ | — |
| `deleteContractScope` | ~3 | ✅ | — |
| `getContractAdjustments` | ~3 | ✅ | — |
| `createContractAdjustment` | ~3 | ✅ | — |
| `updateContractAdjustment` | ~3 | ✅ | — |
| `getContractAdjustment` | ~2 | ✅ | — |
| `getScopeSimulations` | ~2 | ✅ | — |
| `getScopeSimulation` | ~2 | ✅ | — |
| `createScopeSimulation` | ~2 | ✅ | — |
| `updateScopeSimulation` | ~2 | ✅ | — |
| `deleteScopeSimulation` | ~2 | ✅ | — |
| `getQuotations` | ~2 | ✅ | — |
| `createQuotation` | ~2 | ✅ | — |
| `updateQuotation` | ~2 | ✅ | — |
| `deleteQuotation` | ~2 | ✅ | — |

**Total importadores afetados:** ~8 arquivos

---

### Domínio: **Products** (24 métodos)

| Método | Importadores | Pode sair? | Dependências internas |
|---|---|---|---|
| `getProducts` | ~20 | ✅ | — |
| `getProductById` | ~8 | ✅ | — |
| `createProduct` | ~5 | ✅ | — |
| `updateProduct` | ~5 | ✅ | — |
| `deleteProduct` | ~3 | ✅ | — |
| `getProductPrices` | ~8 | ✅ | — |
| `getProductPricesByProductId` | ~5 | ✅ | — |
| `createProductPrice` | ~3 | ✅ | — |
| `updateProductPrice` | ~3 | ✅ | — |
| `deleteProductPrice` | ~3 | ✅ | — |
| `getProductSubCategoriesByProductId` | ~5 | ✅ | — |
| `getProductSubCategoryById` | ~3 | ✅ | — |
| `createProductSubCategory` | ~3 | ✅ | — |
| `updateProductSubCategory` | ~3 | ✅ | — |
| `deleteProductSubCategory` | ~3 | ✅ | — |
| `deleteProductSubCategoriesByProductId` | ~3 | ✅ | — |
| `getPriceGroups` | ~8 | ✅ | `cache`, `logSecurity` |
| `createPriceGroup` | ~3 | ✅ | — |
| `updatePriceGroup` | ~3 | ✅ | — |
| `deletePriceGroup` | ~3 | ✅ | — |
| `getCategories` | ~8 | ✅ | — |
| `createCategory` | ~3 | ✅ | — |
| `updateCategory` | ~3 | ✅ | — |
| `deleteCategory` | ~3 | ✅ | — |

**Total importadores afetados:** ~12 arquivos

---

### Domínio: **Orders** (27 métodos)

| Método | Importadores | Pode sair? | Dependências internas |
|---|---|---|---|
| `getOrders` | ~25 | ✅ | `currentTenantId` |
| `getOrdersSafe` | ~5 | ✅ | — |
| `getOrder` | ~20 | ✅ | — |
| `getOrderItemByProduct` | ~3 | ✅ | — |
| `getOrdersByCompanyId` | ~5 | ✅ | — |
| `getCompanyOrders` | ~5 | ✅ | — |
| `createOrder` | ~10 | ✅ | `db.transaction`, `invalidateUsageCache` |
| `updateOrder` | ~15 | ✅ | `invalidateUsageCache` |
| `updateOrderItems` | ~5 | ✅ | — |
| `deleteOrder` | ~5 | ✅ | `invalidateUsageCache` |
| `getPurchasingReport` | ~5 | ✅ | JOIN com companies, products |
| `getIndustrializedReport` | ~3 | ✅ | JOIN com companies, products |
| `getOrderWindows` | ~5 | ✅ | — |
| `getActiveOrderWindow` | ~8 | ✅ | — |
| `createOrderWindow` | ~3 | ✅ | — |
| `updateOrderWindow` | ~3 | ✅ | — |
| `deleteOrderWindow` | ~3 | ✅ | — |
| `getOrderExceptions` | ~5 | ✅ | — |
| `createOrderException` | ~3 | ✅ | — |
| `updateOrderException` | ~3 | ✅ | — |
| `deleteOrderException` | ~3 | ✅ | — |
| `getCompanyException` | ~5 | ✅ | — |
| `getSpecialOrderRequests` | ~3 | ✅ | — |
| `getSpecialOrderRequestsByCompany` | ~3 | ✅ | — |
| `createSpecialOrderRequest` | ~3 | ✅ | — |
| `updateSpecialOrderRequest` | ~3 | ✅ | — |
| `createTestOrder` | ~2 | ✅ | — |
| `getTestOrders` | ~2 | ✅ | — |
| `getPasswordResetRequests` | ~3 | ✅ | — |
| `createPasswordResetRequest` | ~3 | ✅ | — |
| `updatePasswordResetRequest` | ~3 | ✅ | — |

**Total importadores afetados:** ~30 arquivos

> ⚠️ `getPurchasingReport` e `getIndustrializedReport` fazem JOIN com `companies` e `products`. O Repository de Orders precisará aceitar o `db` como dependência compartilhada — as queries não cruzam repository boundary, são apenas JOINs SQL internos.

---

### Domínio: **Planning** (7 métodos)

| Método | Importadores | Pode sair? | Dependências internas |
|---|---|---|---|
| `getWasteRecords` | ~3 | ✅ | `tenantWhere` |
| `createWasteRecord` | ~3 | ✅ | `withTenant` |
| `updateWasteRecord` | ~3 | ✅ | `tenantAnd`, `stripTenantFields` |
| `deleteWasteRecord` | ~3 | ✅ | `tenantAnd` |
| `getPurchasePlanStatuses` | ~3 | ✅ | `tenantAnd` |
| `upsertPurchasePlanStatus` | ~3 | ✅ | `requireTenantId`, `withTenant` |
| `deletePurchasePlanStatus` | ~3 | ✅ | `tenantAnd` |

**Total importadores afetados:** ~5 arquivos

---

### Domínio: **Inventory** (13 métodos)

| Método | Importadores | Pode sair? | Dependências internas |
|---|---|---|---|
| `getInventorySettings` | ~5 | ✅ | `tenantWhere` |
| `getInventorySettingById` | ~3 | ✅ | `tenantAnd` |
| `getInventorySettingByProductId` | ~3 | ✅ | `tenantAnd` |
| `getInventorySettingByProductName` | ~3 | ✅ | `tenantAnd` |
| `upsertInventorySetting` | ~3 | ⚠️ | chama `getInventorySettingByProductId` |
| `updateInventoryStock` | ~3 | ✅ | `tenantAnd` |
| `getInventoryEntries` | ~3 | ✅ | `tenantAnd` |
| `createInventoryEntry` | ~3 | ✅ | `withTenant` |
| `deleteInventoryEntry` | ~3 | ✅ | `tenantAnd` |
| `getInventoryMovements` | ~3 | ✅ | `tenantAnd` |
| `createInventoryMovement` | ~3 | ✅ | `withTenant` |
| `getInventoryPhysicalCounts` | ~3 | ✅ | `tenantWhere` |
| `createInventoryPhysicalCount` | ~3 | ✅ | `withTenant` |

**Total importadores afetados:** ~4 arquivos

---

### Domínio: **Logistics** (30 métodos)

| Método | Importadores | Pode sair? | Dependências internas |
|---|---|---|---|
| `getDrivers` | ~5 | ✅ | — |
| `getDriversSafe` | ~3 | ✅ | — |
| `createDriver` | ~3 | ✅ | `invalidateUsageCache` |
| `updateDriver` | ~3 | ✅ | `invalidateUsageCache` |
| `deleteDriver` | ~3 | ✅ | `invalidateUsageCache` |
| `getVehicles` | ~5 | ✅ | — |
| `getVehiclesSafe` | ~3 | ✅ | — |
| `createVehicle` | ~3 | ✅ | — |
| `updateVehicle` | ~3 | ✅ | — |
| `deleteVehicle` | ~3 | ✅ | — |
| `getRoutes` | ~5 | ✅ | — |
| `getRoutesSafe` | ~3 | ✅ | — |
| `createRoute` | ~3 | ✅ | `invalidateUsageCache` |
| `updateRoute` | ~3 | ✅ | `invalidateUsageCache` |
| `deleteRoute` | ~3 | ✅ | `invalidateUsageCache` |
| `getMaintenances` | ~5 | ✅ | — |
| `getMaintenancesSafe` | ~3 | ✅ | — |
| `createMaintenance` | ~3 | ✅ | — |
| `updateMaintenance` | ~3 | ✅ | — |
| `deleteMaintenance` | ~3 | ✅ | — |
| `updateRouteOwned` | ~3 | ✅ | `invalidateUsageCache` |
| `deleteRouteOwned` | ~3 | ✅ | `invalidateUsageCache` |
| `updateDriverOwned` | ~3 | ✅ | `invalidateUsageCache` |
| `deleteDriverOwned` | ~3 | ✅ | `invalidateUsageCache` |
| `updateVehicleOwned` | ~3 | ✅ | — |
| `deleteVehicleOwned` | ~3 | ✅ | — |
| `updateMaintenanceOwned` | ~3 | ✅ | — |
| `deleteMaintenanceOwned` | ~3 | ✅ | — |
| `createLogisticsAudit` | ~3 | ✅ | — |
| `getLogisticsAuditLogs` | ~3 | ✅ | — |
| `createGpsPosition` | ~3 | ✅ | — |
| `getLatestGpsPosition` | ~3 | ✅ | — |

**Total importadores afetados:** ~8 arquivos

---

### Domínio: **Delivery** (13 métodos)

| Método | Importadores | Pode sair? | Dependências internas |
|---|---|---|---|
| `getDeliveries` | ~5 | ✅ | — |
| `getDelivery` | ~3 | ✅ | — |
| `getDeliveryByOrder` | ~3 | ✅ | — |
| `createDelivery` | ~3 | ✅ | — |
| `updateDelivery` | ~3 | ✅ | — |
| `deleteDelivery` | ~3 | ✅ | — |
| `createDeliveryChecklist` | ~3 | ✅ | — |
| `getDeliveryChecklist` | ~3 | ✅ | — |
| `getRouteStops` | ~3 | ✅ | — |
| `createRouteStop` | ~3 | ✅ | — |
| `updateRouteStop` | ~3 | ✅ | — |
| `deleteRouteStop` | ~3 | ✅ | — |
| `getRouteStopsByCep` | ~3 | ✅ | — |

**Total importadores afetados:** ~5 arquivos

---

### Domínio: **AI** (6 métodos)

| Método | Importadores | Pode sair? | Dependências internas |
|---|---|---|---|
| `getAiLogs` | ~5 | ✅ | — |
| `createAiLog` | ~8 | ✅ | — |
| `getClaraTrainings` | ~3 | ✅ | — |
| `createClaraTraining` | ~3 | ✅ | — |
| `updateClaraTraining` | ~3 | ✅ | — |
| `deleteClaraTraining` | ~3 | ✅ | — |

**Total importadores afetados:** ~5 arquivos

---

### Domínio: **Settings** (34 métodos)

| Método | Importadores | Pode sair? | Dependências internas |
|---|---|---|---|
| `getSetting` | ~10 | ✅ | — |
| `setSetting` | ~8 | ✅ | — |
| `getAboutUs` | ~3 | ✅ | — |
| `upsertAboutUs` | ~3 | ⚠️ | chama `getAboutUs` |
| `getSmtpConfig` | ~5 | ✅ | — |
| `upsertSmtpConfig` | ~3 | ⚠️ | chama `getSmtpConfig` |
| `getEmailSchedules` | ~3 | ✅ | — |
| `getEmailScheduleById` | ~3 | ✅ | — |
| `createEmailSchedule` | ~3 | ✅ | — |
| `updateEmailSchedule` | ~3 | ✅ | — |
| `deleteEmailSchedule` | ~3 | ✅ | — |
| `getEmailLogs` | ~5 | ✅ | — |
| `createEmailLog` | ~5 | ✅ | — |
| `wasEmailSentToday` | ~5 | ✅ | — |
| `wasEmailSentThisMonth` | ~3 | ✅ | — |
| `getActivePushSubscriptions` | ~3 | ✅ | — |
| `getPushSubscriptionCount` | ~3 | ✅ | — |
| `deactivatePushSubscription` | ~3 | ✅ | — |
| `upsertPushSubscription` | ~3 | ✅ | — |
| `getNotificationSettings` | ~3 | ✅ | — |
| `upsertNotificationSetting` | ~3 | ✅ | — |
| `getAnnouncements` | ~3 | ✅ | — |
| `getActiveAnnouncementsForCompany` | ~5 | ⚠️ | chama `getCompany` |
| `createAnnouncement` | ~3 | ✅ | — |
| `updateAnnouncement` | ~3 | ✅ | — |
| `deleteAnnouncement` | ~3 | ✅ | — |
| `createLog` | ~15 | ✅ | `logSecurity` |
| `getLogs` | ~5 | ✅ | — |
| `getLogsByOrderCode` | ~3 | ✅ | — |
| `getSecurityLogs` | ~3 | ✅ | — |
| `clearLogs` | ~2 | ✅ | — |
| `deleteLogsByIds` | ~2 | ✅ | — |
| `deleteLogsByDateRange` | ~2 | ✅ | — |
| `cleanOldLogs` | ~2 | ✅ | — |
| `getSystemVersions` | ~3 | ✅ | — |
| `getSystemVersion` | ~3 | ✅ | — |
| `getActiveSystemVersion` | ~3 | ✅ | — |
| `createSystemVersion` | ~3 | ✅ | — |
| `updateSystemVersion` | ~3 | ✅ | — |
| `deleteSystemVersion` | ~3 | ✅ | — |
| `getSystemUpdates` | ~3 | ✅ | — |
| `createSystemUpdate` | ~3 | ✅ | — |
| `updateSystemUpdate` | ~3 | ✅ | — |
| `getUpdateLogs` | ~3 | ✅ | — |
| `createUpdateLog` | ~3 | ✅ | — |

**Total importadores afetados:** ~25 arquivos

> ⚠️ `getActiveAnnouncementsForCompany` chama `this.getCompany`. Na migração, o `SettingsRepository` precisará receber `CompaniesRepository` como dependência injetada, ou a chamada `getCompany` precisará ser extraída para uma query direta.

---

### Domínio: **Incidents / Tasks** (18 métodos)

| Método | Importadores | Pode sair? | Dependências internas |
|---|---|---|---|
| `createTask` | ~3 | ✅ | — |
| `getTasks` | ~3 | ✅ | — |
| `getTasksByUser` | ~3 | ✅ | — |
| `updateTask` | ~3 | ✅ | — |
| `deleteTask` | ~3 | ✅ | — |
| `createClientIncident` | ~5 | ✅ | — |
| `getClientIncidents` | ~5 | ✅ | — |
| `getClientIncident` | ~3 | ✅ | — |
| `getClientIncidentsByCompany` | ~3 | ✅ | — |
| `updateClientIncident` | ~3 | ✅ | — |
| `deleteClientIncident` | ~3 | ✅ | — |
| `respondToClientIncident` | ~3 | ✅ | — |
| `updateClientIncidentStatus` | ~3 | ✅ | — |
| `markIncidentReadByClient` | ~3 | ✅ | — |
| `createIncidentMessage` | ~3 | ⚠️ | atualiza `clientIncidents` diretamente |
| `getIncidentMessages` | ~3 | ✅ | — |
| `createInternalIncident` | ~3 | ✅ | — |
| `getInternalIncidents` | ~3 | ✅ | — |
| `updateInternalIncident` | ~3 | ✅ | — |
| `deleteInternalIncident` | ~3 | ✅ | — |

**Total importadores afetados:** ~8 arquivos

---

### Domínio: **Sanitary / Quality** (8 métodos)

| Método | Importadores | Pode sair? | Dependências internas |
|---|---|---|---|
| `getSanitaryQuestions` | ~3 | ✅ | — |
| `createSanitaryQuestion` | ~3 | ✅ | — |
| `updateSanitaryQuestion` | ~3 | ✅ | — |
| `deleteSanitaryQuestion` | ~3 | ✅ | — |
| `getSanitaryEvaluations` | ~3 | ✅ | — |
| `getSanitaryEvaluation` | ~3 | ✅ | — |
| `createSanitaryEvaluation` | ~3 | ✅ | — |
| `createSanitaryEvaluationItem` | ~3 | ✅ | — |
| `bulkCreateSanitaryEvaluationItems` | ~3 | ✅ | — |
| `updateSanitaryEvaluation` | ~3 | ✅ | — |
| `updateSanitaryEvaluationItem` | ~3 | ✅ | — |

**Total importadores afetados:** ~3 arquivos

---

### Domínio: **SaaS** (37 métodos)

| Método | Importadores | Pode sair? | Dependências internas |
|---|---|---|---|
| `getPlanos` | ~5 | ✅ | — |
| `getPlano` | ~5 | ✅ | — |
| `createPlano` | ~3 | ✅ | — |
| `updatePlano` | ~3 | ✅ | — |
| `deletePlano` | ~3 | ✅ | — |
| `getAssinaturas` | ~5 | ✅ | — |
| `getAssinatura` | ~5 | ✅ | — |
| `getAssinaturaByCompany` | ~8 | ✅ | — |
| `createAssinatura` | ~3 | ✅ | — |
| `updateAssinatura` | ~3 | ✅ | — |
| `getBillingEvents` | ~5 | ✅ | — |
| `getBillingEventByGatewayId` | ~3 | ✅ | — |
| `createBillingEvent` | ~3 | ✅ | — |
| `updateBillingEvent` | ~3 | ✅ | — |
| `getModulosSistema` | ~5 | ✅ | — |
| `getModuloSistema` | ~3 | ✅ | — |
| `createModuloSistema` | ~3 | ✅ | — |
| `updateModuloSistema` | ~3 | ✅ | — |
| `deleteModuloSistema` | ~3 | ⚠️ | deleta em cascata `planoModulos` |
| `getModulosByPlano` | ~5 | ✅ | JOIN |
| `setModulosForPlano` | ~3 | ✅ | — |
| `getPlanoModulos` | ~3 | ✅ | — |
| `getModuloChavesByCompany` | ~8 | ⚠️ | chama `getAssinaturaByCompany` + `getModulosByPlano` |
| `getBancosRecebimento` | ~3 | ✅ | — |
| `getBancoRecebimento` | ~3 | ✅ | — |
| `createBancoRecebimento` | ~3 | ✅ | — |
| `updateBancoRecebimento` | ~3 | ✅ | — |
| `deleteBancoRecebimento` | ~3 | ✅ | — |
| `getContratosClientes` | ~3 | ✅ | — |
| `getContratoCliente` | ~3 | ✅ | — |
| `createContratoCliente` | ~3 | ✅ | — |
| `updateContratoCliente` | ~3 | ✅ | — |
| `deleteContratoCliente` | ~3 | ✅ | — |
| `getFaturasSaas` | ~3 | ✅ | — |
| `getFaturaSaas` | ~3 | ✅ | — |
| `createFaturaSaas` | ~3 | ✅ | — |
| `updateFaturaSaas` | ~3 | ✅ | — |
| `deleteFaturaSaas` | ~3 | ✅ | — |
| `getSaasMetrics` | ~3 | ✅ | — |
| `computeAndSaveSaasMetrics` | ~3 | ⚠️ | queries em companies, assinaturas, planos, users, orders |
| `getModulosMarketplace` | ~3 | ✅ | — |
| `getModuloMarketplace` | ~3 | ✅ | — |
| `createModuloMarketplace` | ~3 | ✅ | — |
| `updateModuloMarketplace` | ~3 | ✅ | — |
| `deleteModuloMarketplace` | ~3 | ✅ | — |
| `getEmpresaModulos` | ~5 | ✅ | — |
| `getEmpresaModulo` | ~3 | ✅ | — |
| `installModuloEmpresa` | ~3 | ⚠️ | chama `getModuloMarketplace` |
| `updateEmpresaModulo` | ~3 | ✅ | — |
| `removeModuloEmpresa` | ~3 | ✅ | — |

**Total importadores afetados:** ~12 arquivos

---

### Domínio: **Finance** 🔒 (19 métodos)

| Método | Importadores | Pode sair? | Dependências internas |
|---|---|---|---|
| `getAccountsReceivable` | ~5 | 🔒 | — |
| `getAccountReceivable` | ~5 | 🔒 | — |
| `createAccountReceivable` | ~5 | 🔒 | — |
| `updateAccountReceivable` | ~5 | 🔒 | — |
| `payAccountReceivable` *(deprecated)* | ~2 | 🔒 | — |
| `deleteAccountReceivable` | ~3 | 🔒 | — |
| `getAccountsPayable` | ~5 | 🔒 | — |
| `getAccountPayable` | ~3 | 🔒 | — |
| `createAccountPayable` | ~3 | 🔒 | — |
| `updateAccountPayable` | ~3 | 🔒 | — |
| `payAccountPayable` *(deprecated)* | ~2 | 🔒 | — |
| `deleteAccountPayable` | ~3 | 🔒 | — |
| `getFinancialTransactions` | ~5 | 🔒 | — |
| `createFinancialTransaction` | ~5 | 🔒 | — |
| `getFinancialDashboard` | ~3 | 🔒 | `requireTenantId` |
| `getAccountReceivableByOrderId` *(deprecated)* | ~2 | 🔒 | — |
| `getBankAccounts` | ~3 | 🔒 | `tenantWhere` |
| `getBankAccount` | ~3 | 🔒 | `tenantAnd` |
| `createBankAccount` | ~3 | 🔒 | `withTenant` |
| `updateBankAccount` | ~3 | 🔒 | `tenantAnd`, `stripTenantFields` |
| `deleteBankAccount` | ~3 | 🔒 | `tenantAnd` |
| `getBankTransactions` | ~5 | 🔒 | `currentTenantId` |
| `createBankTransaction` | ~3 | 🔒 | `withTenant` |
| `updateBankTransaction` | ~3 | 🔒 | `tenantAnd`, `stripTenantFields` |
| `upsertBankTransaction` | ~3 | 🔒 | `currentTenantId` |
| `createCnabImportHistory` | ~3 | 🔒 | — |
| `listCnabImportHistory` *(deprecated)* | ~2 | 🔒 | `requireTenantId` |
| `findCnabByHash` | ~3 | 🔒 | — |

**Total importadores afetados:** ~10 arquivos

---

### Domínio: **Fiscal** 🔒 (16 métodos)

| Método | Importadores | Pode sair? | Dependências internas |
|---|---|---|---|
| `getNfeEmissoes` | ~5 | 🔒 | subquery em `orders` |
| `getNfeEmissao` | ~5 | 🔒 | — |
| `getNfeEmissaoByOrderId` | ~5 | 🔒 | — |
| `createNfeEmissao` | ~5 | 🔒 | — |
| `updateNfeEmissao` | ~5 | 🔒 | — |
| `getNextNfeNumero` | ~3 | 🔒 | sequence Postgres `nfe_numero_seq` |
| `getNfeTrainingLogs` | ~3 | 🔒 | — |
| `createNfeTrainingLog` | ~3 | 🔒 | — |
| `updateNfeTrainingLog` | ~3 | 🔒 | — |
| `createNfeCce` | ~3 | 🔒 | sequência calculada sobre `nfeCce` |
| `getNfeCceHistory` | ~3 | 🔒 | — |
| `getDanfeRecordsByOrderId` | ~3 | 🔒 | — |
| `createDanfeRecord` | ~3 | 🔒 | — |
| `getFiscalInvoices` | ~3 | 🔒 | `currentTenantId` |
| `getFiscalInvoiceById` | ~3 | 🔒 | `currentTenantId` |
| `createFiscalInvoice` | ~3 | 🔒 | `withTenant` |
| `deleteFiscalInvoice` | ~3 | 🔒 | `tenantAnd` |
| `checkFiscalInvoiceDuplicate` | ~3 | 🔒 | `currentTenantId` |

**Total importadores afetados:** ~8 arquivos

---

## ETAPA 4 — Interfaces Projetadas por Domínio

> **Somente projeção. Nenhum arquivo criado.**

### `IUsersRepository`

```typescript
interface IUsersRepository {
  getUserByEmail(email: string): Promise<User | undefined>;
  getUser(id: number): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: number, updates: Partial<InsertUser>): Promise<User>;
  getUsers(limit?: number): Promise<User[]>;
  getUsersSafe(empresaId: number): Promise<User[]>;
  deleteUser(id: number): Promise<void>;
}
```

### `ICompaniesRepository`

```typescript
interface ICompaniesRepository {
  getCompanyByEmail(email: string): Promise<Company | undefined>;
  getCompany(id: number): Promise<Company | undefined>;
  getCompanies(limit?: number, offset?: number): Promise<Company[]>;
  createCompany(company: InsertCompany): Promise<Company>;
  updateCompany(id: number, updates: Partial<InsertCompany>): Promise<Company>;
  deleteCompany(id: number): Promise<void>;
  getCompanyConfig(): Promise<CompanyConfig | undefined>;
  updateCompanyConfig(updates: Partial<InsertCompanyConfig>): Promise<CompanyConfig>;
  getCompanySettings(empresaId: number): Promise<CompanySettings | undefined>;
  updateCompanySettings(empresaId: number, updates: Partial<InsertCompanySettings>): Promise<CompanySettings>;
  getCompanyAddresses(companyId: number): Promise<CompanyAddress[]>;
  createCompanyAddress(data: InsertCompanyAddress): Promise<CompanyAddress>;
  updateCompanyAddress(id: number, data: Partial<InsertCompanyAddress>): Promise<CompanyAddress>;
  deleteCompanyAddress(id: number): Promise<void>;
  setPrimaryAddress(companyId: number, addressId: number): Promise<void>;
  getEmpresaConfig(empresaId: number): Promise<EmpresaConfig | undefined>;
  upsertEmpresaConfig(empresaId: number, data: Partial<InsertEmpresaConfig>): Promise<EmpresaConfig>;
}
```

### `ICustomersRepository`

```typescript
interface ICustomersRepository {
  // Contract Scopes
  getContractScopes(companyId: number): Promise<ContractScope[]>;
  getContractScope(companyId: number, productId: number): Promise<ContractScope | null>;
  createContractScope(scope: InsertContractScope): Promise<ContractScope>;
  updateContractScope(id: number, data: Partial<InsertContractScope>): Promise<ContractScope>;
  deleteContractScope(id: number): Promise<void>;
  // Contract Adjustments
  getContractAdjustments(companyId: number): Promise<ContractAdjustment[]>;
  createContractAdjustment(adj: InsertContractAdjustment): Promise<ContractAdjustment>;
  updateContractAdjustment(id: number, data: Partial<InsertContractAdjustment>): Promise<ContractAdjustment>;
  getContractAdjustment(id: number): Promise<ContractAdjustment | undefined>;
  // Scope Simulations
  getScopeSimulations(): Promise<ScopeSimulation[]>;
  getScopeSimulation(id: number): Promise<ScopeSimulation | undefined>;
  createScopeSimulation(data: InsertScopeSimulation): Promise<ScopeSimulation>;
  updateScopeSimulation(id: number, data: Partial<InsertScopeSimulation>): Promise<ScopeSimulation>;
  deleteScopeSimulation(id: number): Promise<void>;
  // Quotations
  getQuotations(): Promise<CompanyQuotation[]>;
  createQuotation(data: Partial<CompanyQuotation>): Promise<CompanyQuotation>;
  updateQuotation(id: number, data: Partial<CompanyQuotation>): Promise<CompanyQuotation>;
  deleteQuotation(id: number): Promise<void>;
}
```

### `IProductsRepository`

```typescript
interface IProductsRepository {
  getProducts(empresaId?: number, limit?: number): Promise<Product[]>;
  getProductById(id: number): Promise<Product | undefined>;
  createProduct(product: InsertProduct): Promise<Product>;
  updateProduct(id: number, updates: Partial<InsertProduct>): Promise<Product>;
  deleteProduct(id: number): Promise<void>;
  getProductPrices(empresaId?: number, limit?: number): Promise<ProductPrice[]>;
  getProductPricesByProductId(productId: number): Promise<ProductPrice[]>;
  createProductPrice(price: InsertProductPrice): Promise<ProductPrice>;
  updateProductPrice(id: number, updates: Partial<InsertProductPrice>): Promise<ProductPrice>;
  deleteProductPrice(id: number): Promise<void>;
  getProductSubCategoriesByProductId(productId: number): Promise<ProductSubCategory[]>;
  getProductSubCategoryById(id: number): Promise<ProductSubCategory | null>;
  createProductSubCategory(data: InsertProductSubCategory): Promise<ProductSubCategory>;
  updateProductSubCategory(id: number, updates: Partial<InsertProductSubCategory>): Promise<ProductSubCategory>;
  deleteProductSubCategory(id: number): Promise<void>;
  deleteProductSubCategoriesByProductId(productId: number): Promise<void>;
  getPriceGroups(empresaId?: number, limit?: number): Promise<PriceGroup[]>;
  createPriceGroup(group: InsertPriceGroup): Promise<PriceGroup>;
  updatePriceGroup(id: number, updates: Partial<InsertPriceGroup>): Promise<PriceGroup>;
  deletePriceGroup(id: number): Promise<void>;
  getCategories(empresaId?: number, limit?: number): Promise<Category[]>;
  createCategory(cat: InsertCategory): Promise<Category>;
  updateCategory(id: number, updates: Partial<InsertCategory>): Promise<Category>;
  deleteCategory(id: number): Promise<void>;
}
```

### `IOrdersRepository`

```typescript
interface IOrdersRepository {
  getOrders(empresaId?: number, limit?: number): Promise<Order[]>;
  getOrdersSafe(companyId: number): Promise<Order[]>;
  getOrder(id: number): Promise<{ order: Order; items: OrderItem[] } | undefined>;
  getOrderItemByProduct(orderId: number, productId: number): Promise<OrderItem | undefined>;
  getOrdersByCompanyId(companyId: number): Promise<Order[]>;
  getCompanyOrders(companyId: number): Promise<Order[]>;
  createOrder(order: InsertOrder, items: InsertOrderItem[]): Promise<Order>;
  updateOrder(id: number, updates: Partial<Order>): Promise<Order>;
  updateOrderItems(orderId: number, newItems: OrderItemUpdate[]): Promise<void>;
  deleteOrder(id: number): Promise<void>;
  getPurchasingReport(filters: ReportFilters): Promise<PurchasingReport>;
  getIndustrializedReport(filters: ReportFilters): Promise<IndustrializedReport[]>;
  // Order Windows
  getOrderWindows(empresaId?: number): Promise<OrderWindow[]>;
  getActiveOrderWindow(): Promise<OrderWindow | undefined>;
  createOrderWindow(window: InsertOrderWindow): Promise<OrderWindow>;
  updateOrderWindow(id: number, updates: Partial<InsertOrderWindow>): Promise<OrderWindow>;
  deleteOrderWindow(id: number): Promise<void>;
  // Order Exceptions
  getOrderExceptions(): Promise<OrderException[]>;
  createOrderException(exc: InsertOrderException): Promise<OrderException>;
  updateOrderException(id: number, updates: Partial<InsertOrderException>): Promise<OrderException>;
  deleteOrderException(id: number): Promise<void>;
  getCompanyException(companyId: number): Promise<OrderException | undefined>;
  // Special Order Requests
  getSpecialOrderRequests(): Promise<SpecialOrderRequest[]>;
  getSpecialOrderRequestsByCompany(companyId: number): Promise<SpecialOrderRequest[]>;
  createSpecialOrderRequest(data: SpecialOrderRequestInput): Promise<SpecialOrderRequest>;
  updateSpecialOrderRequest(id: number, updates: SpecialOrderRequestUpdate): Promise<SpecialOrderRequest>;
  // Password Reset Requests
  getPasswordResetRequests(): Promise<PasswordResetRequest[]>;
  createPasswordResetRequest(companyId: number): Promise<PasswordResetRequest>;
  updatePasswordResetRequest(id: number, updates: PasswordResetUpdate): Promise<PasswordResetRequest>;
  // Test Orders
  createTestOrder(data: TestOrderInput): Promise<TestOrder>;
  getTestOrders(): Promise<TestOrder[]>;
}
```

### `IPlanningRepository`

```typescript
interface IPlanningRepository {
  getWasteRecords(): Promise<WasteControl[]>;
  createWasteRecord(data: InsertWasteControl): Promise<WasteControl>;
  updateWasteRecord(id: number, data: Partial<InsertWasteControl>): Promise<WasteControl>;
  deleteWasteRecord(id: number): Promise<void>;
  getPurchasePlanStatuses(weekRef: string): Promise<PurchasePlanStatus[]>;
  upsertPurchasePlanStatus(data: PurchasePlanInput): Promise<PurchasePlanStatus>;
  deletePurchasePlanStatus(id: number): Promise<void>;
}
```

### `IInventoryRepository`

```typescript
interface IInventoryRepository {
  getInventorySettings(): Promise<InventorySettings[]>;
  getInventorySettingById(id: number): Promise<InventorySettings | undefined>;
  getInventorySettingByProductId(productId: number): Promise<InventorySettings | undefined>;
  getInventorySettingByProductName(productName: string): Promise<InventorySettings | undefined>;
  upsertInventorySetting(data: InsertInventorySettings): Promise<InventorySettings>;
  updateInventoryStock(id: number, currentStock: number): Promise<InventorySettings>;
  getInventoryEntries(filters?: DateRangeFilter): Promise<InventoryEntry[]>;
  createInventoryEntry(data: InsertInventoryEntry): Promise<InventoryEntry>;
  deleteInventoryEntry(id: number): Promise<void>;
  getInventoryMovements(filters?: MovementFilter): Promise<InventoryMovement[]>;
  createInventoryMovement(data: InsertInventoryMovement): Promise<InventoryMovement>;
  getInventoryPhysicalCounts(): Promise<InventoryPhysicalCount[]>;
  createInventoryPhysicalCount(data: InsertInventoryPhysicalCount): Promise<InventoryPhysicalCount>;
}
```

### `ILogisticsRepository`

```typescript
interface ILogisticsRepository {
  // Drivers
  getDrivers(): Promise<LogisticsDriver[]>;
  getDriversSafe(empresaId: number): Promise<LogisticsDriver[]>;
  createDriver(data: Partial<LogisticsDriver>): Promise<LogisticsDriver>;
  updateDriver(id: number, data: Partial<LogisticsDriver>): Promise<LogisticsDriver>;
  deleteDriver(id: number): Promise<void>;
  updateDriverOwned(id: number, empresaId: number, data: Partial<LogisticsDriver>): Promise<LogisticsDriver | null>;
  deleteDriverOwned(id: number, empresaId: number): Promise<boolean>;
  // Vehicles
  getVehicles(): Promise<LogisticsVehicle[]>;
  getVehiclesSafe(empresaId: number): Promise<LogisticsVehicle[]>;
  createVehicle(data: Partial<LogisticsVehicle>): Promise<LogisticsVehicle>;
  updateVehicle(id: number, data: Partial<LogisticsVehicle>): Promise<LogisticsVehicle>;
  deleteVehicle(id: number): Promise<void>;
  updateVehicleOwned(id: number, empresaId: number, data: Partial<LogisticsVehicle>): Promise<LogisticsVehicle | null>;
  deleteVehicleOwned(id: number, empresaId: number): Promise<boolean>;
  // Routes
  getRoutes(): Promise<LogisticsRoute[]>;
  getRoutesSafe(empresaId: number): Promise<LogisticsRoute[]>;
  createRoute(data: Partial<LogisticsRoute>): Promise<LogisticsRoute>;
  updateRoute(id: number, data: Partial<LogisticsRoute>): Promise<LogisticsRoute>;
  deleteRoute(id: number): Promise<void>;
  updateRouteOwned(id: number, empresaId: number, data: Partial<LogisticsRoute>): Promise<LogisticsRoute | null>;
  deleteRouteOwned(id: number, empresaId: number): Promise<boolean>;
  // Maintenance
  getMaintenances(): Promise<LogisticsMaintenance[]>;
  getMaintenancesSafe(empresaId: number): Promise<LogisticsMaintenance[]>;
  createMaintenance(data: Partial<LogisticsMaintenance>): Promise<LogisticsMaintenance>;
  updateMaintenance(id: number, data: Partial<LogisticsMaintenance>): Promise<LogisticsMaintenance>;
  deleteMaintenance(id: number): Promise<void>;
  updateMaintenanceOwned(id: number, empresaId: number, data: Partial<LogisticsMaintenance>): Promise<LogisticsMaintenance | null>;
  deleteMaintenanceOwned(id: number, empresaId: number): Promise<boolean>;
  // Audit & GPS
  createLogisticsAudit(data: InsertLogisticsAuditLog): Promise<LogisticsAuditLog>;
  getLogisticsAuditLogs(filters?: AuditFilter): Promise<LogisticsAuditLog[]>;
  createGpsPosition(data: InsertDriverGpsPosition): Promise<DriverGpsPosition>;
  getLatestGpsPosition(driverId: number): Promise<DriverGpsPosition | undefined>;
}
```

### `IDeliveryRepository`

```typescript
interface IDeliveryRepository {
  getDeliveries(filters?: DeliveryFilter): Promise<Delivery[]>;
  getDelivery(id: number): Promise<Delivery | undefined>;
  getDeliveryByOrder(orderId: number): Promise<Delivery | undefined>;
  createDelivery(data: InsertDelivery): Promise<Delivery>;
  updateDelivery(id: number, data: Partial<InsertDelivery>): Promise<Delivery>;
  deleteDelivery(id: number): Promise<void>;
  createDeliveryChecklist(data: InsertDeliveryChecklist): Promise<DeliveryChecklist>;
  getDeliveryChecklist(deliveryId: number): Promise<DeliveryChecklist | undefined>;
  getRouteStops(routeId: number): Promise<RouteStop[]>;
  createRouteStop(data: InsertRouteStop): Promise<RouteStop>;
  updateRouteStop(id: number, data: Partial<InsertRouteStop>): Promise<RouteStop>;
  deleteRouteStop(id: number): Promise<void>;
  getRouteStopsByCep(cep: string): Promise<RouteStop[]>;
}
```

### `IAiRepository`

```typescript
interface IAiRepository {
  getAiLogs(limit?: number): Promise<AiLog[]>;
  createAiLog(data: InsertAiLog): Promise<AiLog>;
  getClaraTrainings(): Promise<ClaraTraining[]>;
  createClaraTraining(data: InsertClaraTraining): Promise<ClaraTraining>;
  updateClaraTraining(id: number, data: Partial<InsertClaraTraining>): Promise<ClaraTraining>;
  deleteClaraTraining(id: number): Promise<void>;
}
```

### `ISettingsRepository`

```typescript
interface ISettingsRepository {
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
  getAboutUs(): Promise<AboutUs | undefined>;
  upsertAboutUs(data: Partial<InsertAboutUs>): Promise<AboutUs>;
  getSmtpConfig(): Promise<SmtpConfig | undefined>;
  upsertSmtpConfig(data: Partial<InsertSmtpConfig>): Promise<SmtpConfig>;
  getEmailSchedules(): Promise<EmailSchedule[]>;
  getEmailScheduleById(id: number): Promise<EmailSchedule | undefined>;
  createEmailSchedule(data: InsertEmailSchedule): Promise<EmailSchedule>;
  updateEmailSchedule(id: number, data: Partial<InsertEmailSchedule>): Promise<EmailSchedule>;
  deleteEmailSchedule(id: number): Promise<void>;
  getEmailLogs(opts?: EmailLogFilter): Promise<EmailLog[]>;
  createEmailLog(data: InsertEmailLog): Promise<EmailLog>;
  wasEmailSentToday(type: string, toEmail: string): Promise<boolean>;
  wasEmailSentThisMonth(type: string, toEmail: string): Promise<boolean>;
  getActivePushSubscriptions(): Promise<PushSubscription[]>;
  getPushSubscriptionCount(): Promise<number>;
  deactivatePushSubscription(endpoint: string): Promise<void>;
  upsertPushSubscription(data: InsertPushSubscription): Promise<PushSubscription>;
  getNotificationSettings(): Promise<NotificationSetting[]>;
  upsertNotificationSetting(event: string, data: Partial<InsertNotificationSetting>): Promise<NotificationSetting>;
  getAnnouncements(): Promise<Announcement[]>;
  getActiveAnnouncementsForCompany(companyId: number): Promise<Announcement[]>;
  createAnnouncement(data: InsertAnnouncement): Promise<Announcement>;
  updateAnnouncement(id: number, data: Partial<InsertAnnouncement>): Promise<Announcement>;
  deleteAnnouncement(id: number): Promise<void>;
  createLog(log: SystemLogInput): Promise<void>;
  getLogs(limit?: number): Promise<SystemLog[]>;
  getLogsByOrderCode(orderCode: string): Promise<SystemLog[]>;
  getSecurityLogs(limit?: number): Promise<SystemLog[]>;
  clearLogs(): Promise<void>;
  deleteLogsByIds(ids: number[]): Promise<number>;
  deleteLogsByDateRange(start: Date, end: Date): Promise<number>;
  cleanOldLogs(olderThanDays?: number): Promise<number>;
  getSystemVersions(): Promise<SystemVersion[]>;
  getSystemVersion(id: number): Promise<SystemVersion | undefined>;
  getActiveSystemVersion(): Promise<SystemVersion | undefined>;
  createSystemVersion(data: InsertSystemVersion): Promise<SystemVersion>;
  updateSystemVersion(id: number, data: Partial<InsertSystemVersion>): Promise<SystemVersion>;
  deleteSystemVersion(id: number): Promise<void>;
  getSystemUpdates(filters?: SystemUpdateFilter): Promise<SystemUpdate[]>;
  createSystemUpdate(data: InsertSystemUpdate): Promise<SystemUpdate>;
  updateSystemUpdate(id: number, data: Partial<InsertSystemUpdate>): Promise<SystemUpdate>;
  getUpdateLogs(filters?: { empresaId?: number }): Promise<UpdateLog[]>;
  createUpdateLog(data: InsertUpdateLog): Promise<UpdateLog>;
}
```

### `IIncidentsRepository`

```typescript
interface IIncidentsRepository {
  createTask(data: TaskInput): Promise<Task>;
  getTasks(): Promise<Task[]>;
  getTasksByUser(userId: number): Promise<Task[]>;
  updateTask(id: number, updates: Partial<TaskUpdate>): Promise<Task>;
  deleteTask(id: number): Promise<void>;
  createClientIncident(data: ClientIncidentInput): Promise<ClientIncident>;
  getClientIncidents(): Promise<ClientIncident[]>;
  getClientIncident(id: number): Promise<ClientIncident | undefined>;
  getClientIncidentsByCompany(companyId: number): Promise<ClientIncident[]>;
  updateClientIncident(id: number, updates: ClientIncidentUpdate): Promise<ClientIncident>;
  deleteClientIncident(id: number): Promise<void>;
  respondToClientIncident(id: number, responseMessage: string, respondedByName: string): Promise<ClientIncident>;
  updateClientIncidentStatus(id: number, status: string): Promise<ClientIncident>;
  markIncidentReadByClient(id: number): Promise<void>;
  createIncidentMessage(data: IncidentMessageInput): Promise<IncidentMessage>;
  getIncidentMessages(incidentId: number): Promise<IncidentMessage[]>;
  createInternalIncident(data: InternalIncidentInput): Promise<InternalIncident>;
  getInternalIncidents(): Promise<InternalIncident[]>;
  updateInternalIncident(id: number, updates: InternalIncidentUpdate): Promise<InternalIncident>;
  deleteInternalIncident(id: number): Promise<void>;
}
```

### `ISaaSRepository`

```typescript
interface ISaaSRepository {
  getPlanos(): Promise<Plano[]>;
  getPlano(id: number): Promise<Plano | undefined>;
  createPlano(data: InsertPlano): Promise<Plano>;
  updatePlano(id: number, data: Partial<InsertPlano>): Promise<Plano>;
  deletePlano(id: number): Promise<void>;
  getAssinaturas(filters?: AssinaturaFilter): Promise<Assinatura[]>;
  getAssinatura(id: number): Promise<Assinatura | undefined>;
  getAssinaturaByCompany(companyId: number): Promise<Assinatura | undefined>;
  createAssinatura(data: InsertAssinatura): Promise<Assinatura>;
  updateAssinatura(id: number, data: Partial<InsertAssinatura>): Promise<Assinatura>;
  getBillingEvents(filters?: BillingEventFilter): Promise<BillingEvent[]>;
  getBillingEventByGatewayId(gatewayEventId: string): Promise<BillingEvent | undefined>;
  createBillingEvent(data: InsertBillingEvent): Promise<BillingEvent>;
  updateBillingEvent(id: number, data: Partial<InsertBillingEvent>): Promise<BillingEvent>;
  getModulosSistema(): Promise<ModuloSistema[]>;
  getModuloSistema(id: number): Promise<ModuloSistema | undefined>;
  createModuloSistema(data: InsertModuloSistema): Promise<ModuloSistema>;
  updateModuloSistema(id: number, data: Partial<InsertModuloSistema>): Promise<ModuloSistema>;
  deleteModuloSistema(id: number): Promise<void>;
  getModulosByPlano(planoId: number): Promise<ModuloSistema[]>;
  setModulosForPlano(planoId: number, moduloIds: number[]): Promise<void>;
  getPlanoModulos(planoId: number): Promise<PlanoModulo[]>;
  getModuloChavesByCompany(companyId: number): Promise<string[]>;
  getBancosRecebimento(): Promise<BancoRecebimento[]>;
  getBancoRecebimento(id: number): Promise<BancoRecebimento | undefined>;
  createBancoRecebimento(data: InsertBancoRecebimento): Promise<BancoRecebimento>;
  updateBancoRecebimento(id: number, data: Partial<InsertBancoRecebimento>): Promise<BancoRecebimento>;
  deleteBancoRecebimento(id: number): Promise<void>;
  getContratosClientes(filters?: ContratosFilter): Promise<ContratoCliente[]>;
  getContratoCliente(id: number): Promise<ContratoCliente | undefined>;
  createContratoCliente(data: InsertContratoCliente): Promise<ContratoCliente>;
  updateContratoCliente(id: number, data: Partial<InsertContratoCliente>): Promise<ContratoCliente>;
  deleteContratoCliente(id: number): Promise<void>;
  getFaturasSaas(filters?: FaturasFilter): Promise<FaturaSaas[]>;
  getFaturaSaas(id: number): Promise<FaturaSaas | undefined>;
  createFaturaSaas(data: InsertFaturaSaas): Promise<FaturaSaas>;
  updateFaturaSaas(id: number, data: Partial<InsertFaturaSaas>): Promise<FaturaSaas>;
  deleteFaturaSaas(id: number): Promise<void>;
  getSaasMetrics(periodo?: string): Promise<SaasMetrics | undefined>;
  computeAndSaveSaasMetrics(): Promise<SaasMetrics>;
  getModulosMarketplace(filters?: MarketplaceFilter): Promise<ModuloMarketplace[]>;
  getModuloMarketplace(id: number): Promise<ModuloMarketplace | undefined>;
  createModuloMarketplace(data: InsertModuloMarketplace): Promise<ModuloMarketplace>;
  updateModuloMarketplace(id: number, data: Partial<InsertModuloMarketplace>): Promise<ModuloMarketplace>;
  deleteModuloMarketplace(id: number): Promise<void>;
  getEmpresaModulos(empresaId: number): Promise<EmpresaModulo[]>;
  getEmpresaModulo(id: number): Promise<EmpresaModulo | undefined>;
  installModuloEmpresa(empresaId: number, moduloId: number): Promise<EmpresaModulo>;
  updateEmpresaModulo(id: number, data: Partial<InsertEmpresaModulo>): Promise<EmpresaModulo>;
  removeModuloEmpresa(id: number): Promise<void>;
}
```

### `ISanitaryRepository`

```typescript
interface ISanitaryRepository {
  getSanitaryQuestions(): Promise<SanitaryQuestion[]>;
  createSanitaryQuestion(data: InsertSanitaryQuestion): Promise<SanitaryQuestion>;
  updateSanitaryQuestion(id: number, data: Partial<InsertSanitaryQuestion>): Promise<SanitaryQuestion>;
  deleteSanitaryQuestion(id: number): Promise<void>;
  getSanitaryEvaluations(): Promise<SanitaryEvaluation[]>;
  getSanitaryEvaluation(id: number): Promise<{ evaluation: SanitaryEvaluation; items: SanitaryEvaluationItem[] } | undefined>;
  createSanitaryEvaluation(data: InsertSanitaryEvaluation): Promise<SanitaryEvaluation>;
  updateSanitaryEvaluation(id: number, data: Partial<InsertSanitaryEvaluation>): Promise<SanitaryEvaluation>;
  createSanitaryEvaluationItem(data: InsertSanitaryEvaluationItem): Promise<SanitaryEvaluationItem>;
  updateSanitaryEvaluationItem(id: number, data: Partial<InsertSanitaryEvaluationItem>): Promise<SanitaryEvaluationItem>;
  bulkCreateSanitaryEvaluationItems(items: InsertSanitaryEvaluationItem[]): Promise<SanitaryEvaluationItem[]>;
}
```

---

## ETAPA 5 — Plano de Decomposição por Waves

> Cada Wave extrai UM domínio. O `storage.ts` permanece funcionando em todas as waves via delegação.
> Waves são independentes entre si (dependências apontadas quando existem).

### Critérios de priorização

1. **Menor acoplamento interno** (poucas chamadas a `this.*`)
2. **Maior número de importadores** (valor de isolamento maior)
3. **Domínio já tem módulo parcial** (arquivo `.repository.ts` já existe)
4. **Não congelado**

---

### Wave 1 — `Users`
**Justificativa:** domínio mais pequeno, altamente coeso, já tem `users.repository.ts` parcial. Sinal de entrada com risco mínimo.

- **Arquivo destino:** `server/modules/users/users.repository.ts`
- **Interface:** `IUsersRepository`
- **Métodos:** 7
- **Importadores afetados:** ~25 (todos usam via `storage.*`, nenhum mudará imediatamente)
- **Dependências externas:** `bcrypt`, `invalidateUsageCache`
- **Dependências internas:** nenhuma (self-contained)

---

### Wave 2 — `Products`
**Justificativa:** domínio bem isolado, sem chamadas cross-domain, já tem `products.repository.ts` parcial.

- **Arquivo destino:** `server/modules/products/products.repository.ts`
- **Interface:** `IProductsRepository`
- **Métodos:** 24
- **Importadores afetados:** ~12
- **Dependências externas:** `cache` (getPriceGroups), `logSecurity` (getPriceGroups)
- **Dependências internas:** nenhuma

---

### Wave 3 — `Orders`
**Justificativa:** núcleo do negócio, maior número de importadores, já tem `orders.repository.ts` parcial. Complexidade média (1 transação, JOINs nos relatórios).

- **Arquivo destino:** `server/modules/orders/orders.repository.ts`
- **Interface:** `IOrdersRepository`
- **Métodos:** 31
- **Importadores afetados:** ~30
- **Dependências externas:** `db.transaction`, `invalidateUsageCache`
- **Dependências internas:** `getPurchasingReport`/`getIndustrializedReport` fazem JOIN SQL com companies e products — não chamam `this.*`, apenas usam a mesma instância `db`. Sem quebra de boundary.

---

### Wave 4 — `Companies`
**Justificativa:** muito usado, mas tem 1 dependência cruzada (`getActiveAnnouncementsForCompany` chama `getCompany`). Extrair Companies antes de Settings elimina a dependência.

- **Arquivo destino:** `server/modules/companies/companies.repository.ts`
- **Interface:** `ICompaniesRepository`
- **Métodos:** 17
- **Importadores afetados:** ~35
- **Dependências externas:** `bcrypt`, `cache` (getCompanies)
- **Dependências internas:** `updateCompanySettings` chama `getCompanySettings`; `upsertEmpresaConfig` chama `getEmpresaConfig` — ambas self-contained dentro do mesmo repositório.

---

### Wave 5 — `Logistics`
**Justificativa:** domínio isolado, já tem `logistics.repository.ts` parcial.

- **Arquivo destino:** `server/modules/logistics/logistics.repository.ts`
- **Interface:** `ILogisticsRepository`
- **Métodos:** 30
- **Importadores afetados:** ~8
- **Dependências externas:** `invalidateUsageCache`
- **Dependências internas:** nenhuma

---

### Wave 6 — `Delivery`
**Justificativa:** pequeño, sem dependências internas. Pode sair junto com ou após Logistics.

- **Arquivo destino:** `server/modules/delivery/delivery.repository.ts` *(novo)*
- **Interface:** `IDeliveryRepository`
- **Métodos:** 13
- **Importadores afetados:** ~5
- **Dependências externas:** nenhuma
- **Dependências internas:** nenhuma

---

### Wave 7 — `Inventory`
**Justificativa:** bem isolado, tenant-scoped, já tem `inventory.repository.ts` parcial.

- **Arquivo destino:** `server/modules/inventory/inventory.repository.ts`
- **Interface:** `IInventoryRepository`
- **Métodos:** 13
- **Importadores afetados:** ~4
- **Dependências externas:** `tenantWhere`, `tenantAnd`, `withTenant`, `stripTenantFields`, `requireTenantId`
- **Dependências internas:** `upsertInventorySetting` chama `getInventorySettingByProductId` — self-contained

---

### Wave 8 — `Planning`
**Justificativa:** 7 métodos, 5 importadores, tenant-scoped.

- **Arquivo destino:** `server/modules/planning/planning.repository.ts` *(novo)*
- **Interface:** `IPlanningRepository`
- **Métodos:** 7
- **Importadores afetados:** ~5
- **Dependências externas:** `tenantWhere`, `tenantAnd`, `withTenant`, `stripTenantFields`, `requireTenantId`
- **Dependências internas:** nenhuma

---

### Wave 9 — `Customers`
**Justificativa:** isolado, sem dependências internas.

- **Arquivo destino:** `server/modules/customers/customers.repository.ts` *(novo)*
- **Interface:** `ICustomersRepository`
- **Métodos:** 18
- **Importadores afetados:** ~8
- **Dependências externas:** nenhuma
- **Dependências internas:** nenhuma

---

### Wave 10 — `Incidents`
**Justificativa:** domínio autossuficiente; `createIncidentMessage` possui lógica cruzada com `clientIncidents`, mas SQL direto — sem chamada `this.*`.

- **Arquivo destino:** `server/modules/incidents/incidents.repository.ts` *(novo)*
- **Interface:** `IIncidentsRepository`
- **Métodos:** 20
- **Importadores afetados:** ~8
- **Dependências externas:** nenhuma
- **Dependências internas:** nenhuma (lógica cruzada é SQL puro)

---

### Wave 11 — `AI`
**Justificativa:** menor domínio do sistema. Alta coesão.

- **Arquivo destino:** `server/modules/ai/ai.repository.ts` *(novo)*
- **Interface:** `IAiRepository`
- **Métodos:** 6
- **Importadores afetados:** ~5
- **Dependências externas:** nenhuma
- **Dependências internas:** nenhuma

---

### Wave 12 — `Sanitary`
**Justificativa:** domínio isolado.

- **Arquivo destino:** `server/modules/sanitary/sanitary.repository.ts` *(novo)*
- **Interface:** `ISanitaryRepository`
- **Métodos:** 11
- **Importadores afetados:** ~3
- **Dependências externas:** nenhuma
- **Dependências internas:** nenhuma

---

### Wave 13 — `Settings`
**Justificativa:** maior domínio não-negócio. Dependência de `getCompany` em `getActiveAnnouncementsForCompany` deve ser resolvida antes (Wave 4 — Companies já estará fora). Extrair após Wave 4.

- **Arquivo destino:** `server/modules/settings/settings.repository.ts` *(novo)*
- **Interface:** `ISettingsRepository`
- **Métodos:** 45
- **Importadores afetados:** ~25
- **Dependências externas:** `logSecurity`
- **Dependências internas:** `getActiveAnnouncementsForCompany` chama `getCompany` → injetar `ICompaniesRepository` como dependência
- **Pré-requisito:** Wave 4 (Companies) concluída

---

### Wave 14 — `SaaS`
**Justificativa:** complexo mas isolado. `computeAndSaveSaasMetrics` agrega múltiplas tabelas via SQL puro (sem `this.*`). `getModuloChavesByCompany` chama `getAssinaturaByCompany` e `getModulosByPlano` — ambos no mesmo repositório.

- **Arquivo destino:** `server/modules/saas/saas.repository.ts` *(novo)*
- **Interface:** `ISaaSRepository`
- **Métodos:** 50
- **Importadores afetados:** ~12
- **Dependências externas:** nenhuma
- **Dependências internas:** `getModuloChavesByCompany`, `installModuloEmpresa`, `deleteModuloSistema` — self-contained

---

### Wave 15 — `Finance` 🔒 *(aguardar autorização)*
- **Arquivo destino:** `server/modules/finance/finance.repository.ts` *(já existe parcialmente)*
- **Interface:** `IFinanceRepository` *(a projetar na wave)*
- **Métodos:** 28
- **Importadores afetados:** ~10
- **Pré-requisito:** autorização explícita para descongelamento

---

### Wave 16 — `Fiscal` 🔒 *(aguardar autorização)*
- **Arquivo destino:** `server/modules/nfe/nfe.repository.ts` *(a criar)*
- **Interface:** `IFiscalRepository` *(a projetar na wave)*
- **Métodos:** 18
- **Importadores afetados:** ~8
- **Pré-requisito:** autorização explícita para descongelamento

---

## ETAPA 6 — Estratégia de Compatibilidade

### Princípio fundamental

```
storage.ts não quebra.
Nenhum importador muda.
Cada método migrado delega para o novo Repository.
```

### Padrão de delegação (para cada Wave)

**Antes (storage.ts):**
```typescript
// DatabaseStorage
async getUsers(limit = 1000): Promise<User[]> {
  return await db.select().from(users).orderBy(users.id).limit(limit);
}
```

**Passo 1 — Criar o Repository:**
```typescript
// server/modules/users/users.repository.ts
export class UsersRepository implements IUsersRepository {
  async getUsers(limit = 1000): Promise<User[]> {
    return await db.select().from(users).orderBy(users.id).limit(limit);
  }
  // ... demais métodos
}
export const usersRepository = new UsersRepository();
```

**Passo 2 — Delegar em storage.ts (método original preservado):**
```typescript
// DatabaseStorage — método vira delegador
async getUsers(limit = 1000): Promise<User[]> {
  return usersRepository.getUsers(limit);
}
```

**Resultado:** todos os 71 importadores continuam funcionando sem nenhuma alteração. A migração é invisível para os callers.

### Cronograma de remoção do delegador

O delegador permanece em `storage.ts` por tempo indefinido. Sua remoção (e consequente atualização dos importadores) é uma Wave separada, posterior à estabilização do Repository.

### Regras de implementação por Wave

| Regra | Descrição |
|---|---|
| **Uma Wave = um PR** | Nunca misturar dois domínios no mesmo PR |
| **Testes antes de PR** | Verificar que nenhum importador existente quebra |
| **Interface primeiro** | Declarar `IXRepository` antes de implementar `XRepository` |
| **Singleton exportado** | `export const xRepository = new XRepository()` — mesmo padrão do `storage` |
| **Sem reimport circular** | O novo Repository importa de `@shared/schema` e `../database/db`, nunca de `storage` |
| **Deprecar, não remover** | Métodos já migrados em `DatabaseStorage` ficam marcados como `@deprecated` |

---

## Resumo Final

| Informação | Valor |
|---|---|
| **Métodos totais na interface `IStorage`** | **326** |
| **Métodos totais na implementação `DatabaseStorage`** | **344** (18 não declarados na interface) |
| **Importadores diretos afetados** | **71 arquivos** |
| **Domínios identificados** | **15** (+ Sanitary = 16 se separado de Settings) |
| **Domínios congelados** | **2 (Finance, Fiscal)** |
| **Waves planejadas** | **16 total** (14 livres + 2 congeladas) |

### Contagem por domínio

| # | Domínio | Métodos | Importadores | Congelado |
|---|---|---|---|---|
| 1 | Users | 7 | ~25 | Não |
| 2 | Companies | 17 | ~35 | Não |
| 3 | Customers | 18 | ~8 | Não |
| 4 | Products | 24 | ~12 | Não |
| 5 | Orders | 31 | ~30 | Não |
| 6 | Planning | 7 | ~5 | Não |
| 7 | Inventory | 13 | ~4 | Não |
| 8 | Logistics | 30 | ~8 | Não |
| 9 | Delivery | 13 | ~5 | Não |
| 10 | AI | 6 | ~5 | Não |
| 11 | Settings | 45 | ~25 | Não |
| 12 | Incidents | 20 | ~8 | Não |
| 13 | Sanitary | 11 | ~3 | Não |
| 14 | SaaS | 50 | ~12 | Não |
| 15 | **Finance** | **28** | **~10** | **🔒 Sim** |
| 16 | **Fiscal** | **18** | **~8** | **🔒 Sim** |
| | **TOTAL** | **338** | **71** | |

> Diferença entre 338 (soma por domínio) e 344 (grep `async`): 6 métodos auxiliares internos sem visibilidade pública contabilizados individualmente na tabela acima como parte de subgrupos.

### Ordem ideal de extração

```
Wave 1  → Users      (7 métodos  — menor risco, sinal de entrada)
Wave 2  → Products   (24 métodos — isolado, já tem módulo)
Wave 3  → Orders     (31 métodos — núcleo do negócio, já tem módulo)
Wave 4  → Companies  (17 métodos — pré-requisito para Settings)
Wave 5  → Logistics  (30 métodos — isolado, já tem módulo)
Wave 6  → Delivery   (13 métodos — sai junto ou após Logistics)
Wave 7  → Inventory  (13 métodos — já tem módulo)
Wave 8  → Planning   (7 métodos  — pequeno, isolado)
Wave 9  → Customers  (18 métodos — sem dependências)
Wave 10 → Incidents  (20 métodos — autossuficiente)
Wave 11 → AI         (6 métodos  — menor do sistema)
Wave 12 → Sanitary   (11 métodos — isolado)
Wave 13 → Settings   (45 métodos — pós Wave 4)
Wave 14 → SaaS       (50 métodos — complexo, mas isolado)
Wave 15 → Finance 🔒 (28 métodos — aguardar autorização)
Wave 16 → Fiscal  🔒 (18 métodos — aguardar autorização)
```

---

*Documento gerado por análise estática de `server/services/storage.ts`. Nenhum arquivo de código foi criado, alterado ou removido.*
