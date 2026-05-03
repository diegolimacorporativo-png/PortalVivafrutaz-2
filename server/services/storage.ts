import bcrypt from "bcryptjs";
import { db } from "../database/db";
import { cache } from "./cache.js";
import { invalidateUsageCache } from "../modules/billing/usage-cache";
import { logSecurity } from "../core/security/securityLogger";
import {
  tenantWhere,
  tenantAnd,
  withTenant,
  stripTenantFields,
} from "../core/tenant/scope";
import { requireTenantId, currentTenantId } from "../core/tenant/context";
import {
  users, priceGroups, companies, categories, products, productPrices, productSubCategories, orderWindows, orderExceptions, orders, orderItems, systemSettings, passwordResetRequests, specialOrderRequests, systemLogs, testOrders, tasks, clientIncidents, incidentMessages, internalIncidents, logisticsDrivers, logisticsVehicles, logisticsRoutes, logisticsMaintenance, companyQuotations, contractScopes, danfeRecords, companyConfig, companySettings, announcements, wasteControl, purchasePlanStatus, inventorySettings, inventoryEntries, inventoryMovements, inventoryPhysicalCounts, fiscalInvoices, emailSchedules, emailLogs, aboutUs, smtpConfig, claraTraining, pushSubscriptions, notificationSettings, contractAdjustments, scopeSimulations, accountsReceivable, accountsPayable, financialTransactions,
  type AccountReceivable, type InsertAccountReceivable,
  type AccountPayable, type InsertAccountPayable,
  type FinancialTransaction, type InsertFinancialTransaction,
  type User, type InsertUser, type PriceGroup, type InsertPriceGroup,
  type Company, type InsertCompany, type Category, type InsertCategory,
  type Product, type InsertProduct,
  type ProductPrice, type InsertProductPrice, type ProductSubCategory, type InsertProductSubCategory, type OrderWindow, type InsertOrderWindow,
  type SpecialOrderRequest,
  type OrderException, type InsertOrderException,
  type Order, type InsertOrder, type OrderItem, type InsertOrderItem,
  type PasswordResetRequest, type SystemLog, type TestOrder,
  type Task, type ClientIncident, type IncidentMessage, type InternalIncident,
  type LogisticsDriver, type LogisticsVehicle, type LogisticsRoute, type LogisticsMaintenance, type CompanyQuotation,
  type ContractScope, type InsertContractScope,
  type ContractAdjustment, type InsertContractAdjustment,
  type DanfeRecord, type InsertDanfeRecord,
  type CompanyConfig, type InsertCompanyConfig,
  type CompanySettings, type InsertCompanySettings,
  type Announcement, type InsertAnnouncement,
  type WasteControl, type InsertWasteControl,
  type PurchasePlanStatus, type InsertPurchasePlanStatus,
  type InventorySettings, type InsertInventorySettings,
  type InventoryEntry, type InsertInventoryEntry,
  type InventoryMovement, type InsertInventoryMovement,
  type InventoryPhysicalCount, type InsertInventoryPhysicalCount,
  type FiscalInvoice, type InsertFiscalInvoice,
  type EmailSchedule, type InsertEmailSchedule,
  type EmailLog, type InsertEmailLog,
  type AboutUs, type InsertAboutUs,
  type SmtpConfig, type InsertSmtpConfig,
  type ClaraTraining, type InsertClaraTraining,
  type PushSubscription, type InsertPushSubscription,
  type NotificationSetting, type InsertNotificationSetting,
  type ScopeSimulation, type InsertScopeSimulation,
  nfeEmissoes, type NfeEmissao, type InsertNfeEmissao,
  nfeTrainingLogs, type NfeTrainingLog, type InsertNfeTrainingLog,
  nfeCce, type NfeCce, type InsertNfeCce,
  bankAccounts, type BankAccount, type InsertBankAccount,
  bankTransactions, type BankTransaction, type InsertBankTransaction,
  companyAddresses, type CompanyAddress, type InsertCompanyAddress,
  planos, type Plano, type InsertPlano,
  assinaturas, type Assinatura, type InsertAssinatura,
  billingEvents, type BillingEvent, type InsertBillingEvent,
  deliveries, type Delivery, type InsertDelivery,
  routeStops, type RouteStop, type InsertRouteStop,
  aiLogs, type AiLog, type InsertAiLog,
  logisticsAuditLogs, type LogisticsAuditLog, type InsertLogisticsAuditLog,
  driverGpsPositions, type DriverGpsPosition, type InsertDriverGpsPosition,
  deliveryChecklists, type DeliveryChecklist, type InsertDeliveryChecklist,
  bancosRecebimento, type BancoRecebimento, type InsertBancoRecebimento,
  contratosClientes, type ContratoCliente, type InsertContratoCliente,
  faturasSaas, type FaturaSaas, type InsertFaturaSaas,
  systemVersions, type SystemVersion, type InsertSystemVersion,
  systemUpdates, type SystemUpdate, type InsertSystemUpdate,
  updateLogs, type UpdateLog, type InsertUpdateLog,
  modulosSistema, type ModuloSistema, type InsertModuloSistema,
  planoModulos, type PlanoModulo, type InsertPlanoModulo,
  saasMetrics, type SaasMetrics, type InsertSaasMetrics,
  empresaConfig, type EmpresaConfig, type InsertEmpresaConfig,
  modulosMarketplace, type ModuloMarketplace, type InsertModuloMarketplace,
  empresaModulos, type EmpresaModulo, type InsertEmpresaModulo,
  sanitaryQuestions, type SanitaryQuestion, type InsertSanitaryQuestion,
  sanitaryEvaluations, type SanitaryEvaluation, type InsertSanitaryEvaluation,
  sanitaryEvaluationItems, type SanitaryEvaluationItem, type InsertSanitaryEvaluationItem,
  cnabImportHistory, type CnabImportHistory, type InsertCnabImportHistory,
} from "@shared/schema";
import { eq, and, desc, gte, lte, sql, inArray } from "drizzle-orm";

export interface IStorage {
  // BANCO.5 — CNAB import history (auditoria de uploads de retorno)
  createCnabImportHistory(data: InsertCnabImportHistory): Promise<CnabImportHistory>;
  listCnabImportHistory(limit?: number): Promise<CnabImportHistory[]>;
  // BANCO.6 — bloqueio de reimportação (hash SHA-256 do conteúdo do .ret)
  findCnabByHash(hash: string): Promise<CnabImportHistory | undefined>;

  // Auth & Users
  getUserByEmail(email: string): Promise<User | undefined>;
  getUser(id: number): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // Companies
  getCompanyByEmail(email: string): Promise<Company | undefined>;
  getCompany(id: number): Promise<Company | undefined>;
  getCompanies(limit?: number, offset?: number): Promise<Company[]>;
  createCompany(company: InsertCompany): Promise<Company>;
  updateCompany(id: number, updates: Partial<InsertCompany>): Promise<Company>;
  deleteCompany(id: number): Promise<void>;

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

  // DANFE Records
  getDanfeRecordsByOrderId(orderId: number): Promise<DanfeRecord[]>;
  createDanfeRecord(record: InsertDanfeRecord): Promise<DanfeRecord>;

  // Price Groups
  getPriceGroups(): Promise<PriceGroup[]>;
  createPriceGroup(group: InsertPriceGroup): Promise<PriceGroup>;
  updatePriceGroup(id: number, updates: Partial<InsertPriceGroup>): Promise<PriceGroup>;
  deletePriceGroup(id: number): Promise<void>;

  // Categories
  getCategories(): Promise<Category[]>;
  createCategory(cat: InsertCategory): Promise<Category>;
  updateCategory(id: number, updates: Partial<InsertCategory>): Promise<Category>;
  deleteCategory(id: number): Promise<void>;

  // Products
  getProducts(): Promise<Product[]>;
  /**
   * Direct-lookup variant of `getProducts()` for `where id = ?`. Lets callers
   * avoid the full-table scan + `.find()` pattern. Returns `undefined` when
   * no row matches — same contract as the previous `(await getProducts()).find(...)`
   * call site behaviour.
   */
  getProductById(id: number): Promise<Product | undefined>;
  createProduct(product: InsertProduct): Promise<Product>;
  updateProduct(id: number, updates: Partial<InsertProduct>): Promise<Product>;
  deleteProduct(id: number): Promise<void>;

  // Product Prices
  getProductPrices(): Promise<ProductPrice[]>;
  getProductPricesByProductId(productId: number): Promise<ProductPrice[]>;
  createProductPrice(price: InsertProductPrice): Promise<ProductPrice>;
  updateProductPrice(id: number, updates: Partial<InsertProductPrice>): Promise<ProductPrice>;
  deleteProductPrice(id: number): Promise<void>;

  // Product Sub-Categories (múltiplas categorias por produto com preços distintos)
  getProductSubCategoriesByProductId(productId: number): Promise<ProductSubCategory[]>;
  getProductSubCategoryById(id: number): Promise<ProductSubCategory | null>;
  createProductSubCategory(data: InsertProductSubCategory): Promise<ProductSubCategory>;
  updateProductSubCategory(id: number, updates: Partial<InsertProductSubCategory>): Promise<ProductSubCategory>;
  deleteProductSubCategory(id: number): Promise<void>;
  deleteProductSubCategoriesByProductId(productId: number): Promise<void>;

  // Order Windows
  getOrderWindows(): Promise<OrderWindow[]>;
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

  // Orders
  getOrders(): Promise<Order[]>;
  /**
   * Direct lookup of a single order item by (orderId, productId). Lets the
   * `safraAlerts` flow avoid loading every order's full detail just to scan
   * the items array. Returns `undefined` when the order has no item for
   * `productId`. If multiple items match (rare), the lowest-id row is
   * returned to mirror `Array.prototype.find` semantics over insertion-order
   * results from the legacy `getOrder().items` shape.
   */
  getOrderItemByProduct(orderId: number, productId: number): Promise<OrderItem | undefined>;
  getOrdersByCompanyId(companyId: number): Promise<Order[]>;
  getOrder(id: number): Promise<{ order: Order, items: OrderItem[] } | undefined>;
  getCompanyOrders(companyId: number): Promise<Order[]>;
  createOrder(order: InsertOrder, items: InsertOrderItem[]): Promise<Order>;
  updateOrder(id: number, updates: { status?: string; adminNote?: string; reopenReason?: string | null; reopenRequestedAt?: Date | null; totalValue?: string; fiscalStatus?: string | null; preNotaNumber?: string | null; nimbiExpiration?: string | null; orderNote?: string | null; deliveryDate?: string; erpExportStatus?: string | null; erpExportedAt?: Date | null; erpId?: string | null; erpExportError?: string | null; [key: string]: any }): Promise<Order>;
  updateOrderItems(orderId: number, newItems: { productId: number; quantity: number; unitPrice: string; totalPrice: string; subCategoryId?: number | null; subCategoryName?: string | null }[]): Promise<void>;
  getPurchasingReport(filters: { dateFrom?: string; dateTo?: string; companyId?: number; productId?: number }): Promise<any>;
  getIndustrializedReport(filters: { dateFrom?: string; dateTo?: string; companyId?: number; productId?: number }): Promise<any>;

  // Company Config (Support, DANFE info)
  getCompanyConfig(): Promise<CompanyConfig | undefined>;
  updateCompanyConfig(updates: Partial<InsertCompanyConfig>): Promise<CompanyConfig>;

  // System Settings
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;

  // Password Reset Requests
  getPasswordResetRequests(): Promise<PasswordResetRequest[]>;
  createPasswordResetRequest(companyId: number): Promise<PasswordResetRequest>;
  updatePasswordResetRequest(id: number, updates: { status: string; newPassword?: string; adminNote?: string; resolvedAt?: Date }): Promise<PasswordResetRequest>;

  // Special Order Requests
  getSpecialOrderRequests(): Promise<SpecialOrderRequest[]>;
  getSpecialOrderRequestsByCompany(companyId: number): Promise<SpecialOrderRequest[]>;
  createSpecialOrderRequest(data: { companyId: number; requestedDay: string; requestedDate?: string | null; description: string; quantity: string; observations?: string | null; items?: any; estimatedDeliveryDate?: string | null }): Promise<SpecialOrderRequest>;
  updateSpecialOrderRequest(id: number, updates: { status: string; adminNote?: string; resolvedAt?: Date; items?: any; estimatedDeliveryDate?: string | null }): Promise<SpecialOrderRequest>;

  // User Management
  getUsers(): Promise<User[]>;
  updateUser(id: number, updates: Partial<InsertUser>): Promise<User>;
  deleteUser(id: number): Promise<void>;

  // Test Orders
  createTestOrder(data: { orderCode: string; companyId: number; companyName: string; deliveryDate: Date; weekReference: string; totalValue: string; orderNote?: string | null; items: any[]; createdBy?: number }): Promise<TestOrder>;
  getTestOrders(): Promise<TestOrder[]>;

  // Order cleanup
  deleteOrder(id: number): Promise<void>;

  // Announcements
  getAnnouncements(): Promise<Announcement[]>;
  getActiveAnnouncementsForCompany(companyId: number): Promise<Announcement[]>;
  createAnnouncement(data: InsertAnnouncement): Promise<Announcement>;
  updateAnnouncement(id: number, data: Partial<InsertAnnouncement>): Promise<Announcement>;
  deleteAnnouncement(id: number): Promise<void>;

  // System Logs
  createLog(log: { action: string; description: string; userId?: number; companyId?: number; userEmail?: string; userRole?: string; ip?: string; level?: string }): Promise<void>;
  getLogsByOrderCode(orderCode: string): Promise<SystemLog[]>;
  getLogs(limit?: number): Promise<SystemLog[]>;
  getSecurityLogs(limit?: number): Promise<SystemLog[]>;
  clearLogs(): Promise<void>;
  deleteLogsByIds(ids: number[]): Promise<number>;
  deleteLogsByDateRange(start: Date, end: Date): Promise<number>;
  cleanOldLogs(olderThanDays?: number): Promise<number>;
  // Logistics
  getDrivers(): Promise<LogisticsDriver[]>;
  createDriver(data: Partial<LogisticsDriver>): Promise<LogisticsDriver>;
  updateDriver(id: number, data: Partial<LogisticsDriver>): Promise<LogisticsDriver>;
  deleteDriver(id: number): Promise<void>;
  getVehicles(): Promise<LogisticsVehicle[]>;
  createVehicle(data: Partial<LogisticsVehicle>): Promise<LogisticsVehicle>;
  updateVehicle(id: number, data: Partial<LogisticsVehicle>): Promise<LogisticsVehicle>;
  deleteVehicle(id: number): Promise<void>;
  getRoutes(): Promise<LogisticsRoute[]>;
  createRoute(data: Partial<LogisticsRoute>): Promise<LogisticsRoute>;
  updateRoute(id: number, data: Partial<LogisticsRoute>): Promise<LogisticsRoute>;
  deleteRoute(id: number): Promise<void>;
  getMaintenances(): Promise<LogisticsMaintenance[]>;
  createMaintenance(data: Partial<LogisticsMaintenance>): Promise<LogisticsMaintenance>;
  updateMaintenance(id: number, data: Partial<LogisticsMaintenance>): Promise<LogisticsMaintenance>;
  deleteMaintenance(id: number): Promise<void>;
  // Quotations
  getQuotations(): Promise<CompanyQuotation[]>;
  createQuotation(data: Partial<CompanyQuotation>): Promise<CompanyQuotation>;
  updateQuotation(id: number, data: Partial<CompanyQuotation>): Promise<CompanyQuotation>;
  deleteQuotation(id: number): Promise<void>;
  // Waste Control
  getWasteRecords(): Promise<WasteControl[]>;
  createWasteRecord(data: InsertWasteControl): Promise<WasteControl>;
  updateWasteRecord(id: number, data: Partial<InsertWasteControl>): Promise<WasteControl>;
  deleteWasteRecord(id: number): Promise<void>;
  // Purchase Plan Status
  getPurchasePlanStatuses(weekRef: string): Promise<PurchasePlanStatus[]>;
  upsertPurchasePlanStatus(data: Partial<InsertPurchasePlanStatus> & { weekRef: string; productName: string }): Promise<PurchasePlanStatus>;
  deletePurchasePlanStatus(id: number): Promise<void>;
  // Inventory — Settings (stock levels per product)
  getInventorySettings(): Promise<InventorySettings[]>;
  /**
   * Direct-by-id lookup for inventory_settings. Replaces the legacy
   * `(await getInventorySettings()).find(s => s.id === id)` pattern in
   * `inventoryService.updateSetting`. Tenant-scoped to mirror the rest of
   * the inventory_settings query surface.
   */
  getInventorySettingById(id: number): Promise<InventorySettings | undefined>;
  getInventorySettingByProductId(productId: number): Promise<InventorySettings | undefined>;
  getInventorySettingByProductName(productName: string): Promise<InventorySettings | undefined>;
  upsertInventorySetting(data: InsertInventorySettings): Promise<InventorySettings>;
  updateInventoryStock(id: number, currentStock: number): Promise<InventorySettings>;
  // Inventory — Entries
  getInventoryEntries(filters?: { from?: string; to?: string }): Promise<InventoryEntry[]>;
  createInventoryEntry(data: InsertInventoryEntry): Promise<InventoryEntry>;
  deleteInventoryEntry(id: number): Promise<void>;
  // Inventory — Movements
  getInventoryMovements(filters?: { from?: string; to?: string; productId?: number }): Promise<InventoryMovement[]>;
  createInventoryMovement(data: InsertInventoryMovement): Promise<InventoryMovement>;
  // Inventory — Physical Counts
  getInventoryPhysicalCounts(): Promise<InventoryPhysicalCount[]>;
  createInventoryPhysicalCount(data: InsertInventoryPhysicalCount): Promise<InventoryPhysicalCount>;

  // Fiscal Invoices (OCR import)
  getFiscalInvoices(): Promise<FiscalInvoice[]>;
  getFiscalInvoiceById(id: number): Promise<FiscalInvoice | undefined>;
  createFiscalInvoice(data: InsertFiscalInvoice): Promise<FiscalInvoice>;
  deleteFiscalInvoice(id: number): Promise<void>;
  checkFiscalInvoiceDuplicate(invoiceNumber: string, cnpj?: string): Promise<boolean>;

  // Email Schedules
  getEmailSchedules(): Promise<EmailSchedule[]>;
  getEmailScheduleById(id: number): Promise<EmailSchedule | undefined>;
  createEmailSchedule(data: InsertEmailSchedule): Promise<EmailSchedule>;
  updateEmailSchedule(id: number, data: Partial<InsertEmailSchedule>): Promise<EmailSchedule>;
  deleteEmailSchedule(id: number): Promise<void>;

  // Email Logs
  getEmailLogs(opts?: { limit?: number; type?: string; companyId?: number }): Promise<EmailLog[]>;
  createEmailLog(data: InsertEmailLog): Promise<EmailLog>;
  wasEmailSentToday(type: string, toEmail: string): Promise<boolean>;
  wasEmailSentThisMonth(type: string, toEmail: string): Promise<boolean>;

  // Clara Training
  getClaraTrainings(): Promise<ClaraTraining[]>;
  createClaraTraining(data: InsertClaraTraining): Promise<ClaraTraining>;
  updateClaraTraining(id: number, data: Partial<InsertClaraTraining>): Promise<ClaraTraining>;
  deleteClaraTraining(id: number): Promise<void>;

  // Scope Simulations
  getScopeSimulations(): Promise<ScopeSimulation[]>;
  getScopeSimulation(id: number): Promise<ScopeSimulation | undefined>;
  createScopeSimulation(data: InsertScopeSimulation): Promise<ScopeSimulation>;
  updateScopeSimulation(id: number, data: Partial<InsertScopeSimulation>): Promise<ScopeSimulation>;
  deleteScopeSimulation(id: number): Promise<void>;

  // Financial Module
  getAccountsReceivable(filters?: { status?: string; companyId?: number }): Promise<AccountReceivable[]>;
  getAccountReceivable(id: number): Promise<AccountReceivable | undefined>;
  createAccountReceivable(data: InsertAccountReceivable): Promise<AccountReceivable>;
  updateAccountReceivable(id: number, data: Partial<InsertAccountReceivable>): Promise<AccountReceivable>;
  payAccountReceivable(id: number): Promise<AccountReceivable>;
  deleteAccountReceivable(id: number): Promise<void>;

  getAccountsPayable(filters?: { status?: string }): Promise<AccountPayable[]>;
  getAccountPayable(id: number): Promise<AccountPayable | undefined>;
  createAccountPayable(data: InsertAccountPayable): Promise<AccountPayable>;
  updateAccountPayable(id: number, data: Partial<InsertAccountPayable>): Promise<AccountPayable>;
  payAccountPayable(id: number): Promise<AccountPayable>;
  deleteAccountPayable(id: number): Promise<void>;

  getFinancialTransactions(filters?: { from?: string; to?: string }): Promise<FinancialTransaction[]>;
  createFinancialTransaction(data: InsertFinancialTransaction): Promise<FinancialTransaction>;
  getFinancialDashboard(): Promise<{
    totalReceivable: number;
    totalPayable: number;
    vencidosAR: number;
    vencidosAP: number;
    recebidoMes: number;
    pagoMes: number;
    balanceMes: number;
  }>;
  getAccountReceivableByOrderId(orderId: number): Promise<AccountReceivable | undefined>;

  // NF-e Emissões
  getNfeEmissoes(filters?: { orderId?: number; status?: string }): Promise<NfeEmissao[]>;
  getNfeEmissao(id: number): Promise<NfeEmissao | undefined>;
  getNfeEmissaoByOrderId(orderId: number): Promise<NfeEmissao | undefined>;
  createNfeEmissao(data: InsertNfeEmissao): Promise<NfeEmissao>;
  updateNfeEmissao(id: number, data: Partial<InsertNfeEmissao>): Promise<NfeEmissao>;
  getNextNfeNumero(): Promise<number>;
  // NF-e Training Logs
  getNfeTrainingLogs(filters?: { orderId?: number; limit?: number }): Promise<NfeTrainingLog[]>;
  createNfeTrainingLog(data: InsertNfeTrainingLog): Promise<NfeTrainingLog>;
  updateNfeTrainingLog(id: number, data: Partial<InsertNfeTrainingLog>): Promise<NfeTrainingLog>;
  // CC-e (Carta de Correção Eletrônica) — FASE 14.2
  createNfeCce(nfeId: number, correcao: string, createdByUserId: number | null): Promise<NfeCce>;
  getNfeCceHistory(nfeId: number): Promise<NfeCce[]>;
  // Logistics Audit Logs
  createLogisticsAudit(data: InsertLogisticsAuditLog): Promise<LogisticsAuditLog>;
  getLogisticsAuditLogs(filters?: { modulo?: string; usuarioId?: number; limit?: number }): Promise<LogisticsAuditLog[]>;
  // Driver GPS Positions
  createGpsPosition(data: InsertDriverGpsPosition): Promise<DriverGpsPosition>;
  getLatestGpsPosition(driverId: number): Promise<DriverGpsPosition | undefined>;
  // Delivery Checklists
  createDeliveryChecklist(data: InsertDeliveryChecklist): Promise<DeliveryChecklist>;
  getDeliveryChecklist(deliveryId: number): Promise<DeliveryChecklist | undefined>;
  // Route Stops
  getRouteStops(routeId: number): Promise<RouteStop[]>;
  createRouteStop(data: InsertRouteStop): Promise<RouteStop>;
  updateRouteStop(id: number, data: Partial<InsertRouteStop>): Promise<RouteStop>;
  deleteRouteStop(id: number): Promise<void>;
  getRouteStopsByCep(cep: string): Promise<RouteStop[]>;
  // AI Logs
  getAiLogs(limit?: number): Promise<AiLog[]>;
  createAiLog(data: InsertAiLog): Promise<AiLog>;

  // Bank Accounts
  getBankAccounts(): Promise<BankAccount[]>;
  getBankAccount(id: number): Promise<BankAccount | undefined>;
  createBankAccount(data: InsertBankAccount): Promise<BankAccount>;
  updateBankAccount(id: number, data: Partial<InsertBankAccount>): Promise<BankAccount>;
  deleteBankAccount(id: number): Promise<void>;

  // Bank Transactions
  getBankTransactions(filters?: { bankAccountId?: number; status?: string; from?: string; to?: string }): Promise<BankTransaction[]>;
  createBankTransaction(data: InsertBankTransaction): Promise<BankTransaction>;
  updateBankTransaction(id: number, data: Partial<InsertBankTransaction>): Promise<BankTransaction>;
  upsertBankTransaction(externalId: string, bankAccountId: number, data: InsertBankTransaction): Promise<BankTransaction>;

  // Company Addresses
  getCompanyAddresses(companyId: number): Promise<CompanyAddress[]>;
  createCompanyAddress(data: InsertCompanyAddress): Promise<CompanyAddress>;
  updateCompanyAddress(id: number, data: Partial<InsertCompanyAddress>): Promise<CompanyAddress>;
  deleteCompanyAddress(id: number): Promise<void>;
  setPrimaryAddress(companyId: number, addressId: number): Promise<void>;

  // SaaS — Planos
  getPlanos(): Promise<Plano[]>;
  getPlano(id: number): Promise<Plano | undefined>;
  createPlano(data: InsertPlano): Promise<Plano>;
  updatePlano(id: number, data: Partial<InsertPlano>): Promise<Plano>;
  deletePlano(id: number): Promise<void>;

  // SaaS — Assinaturas
  getAssinaturas(filters?: { companyId?: number; status?: string }): Promise<Assinatura[]>;
  getAssinatura(id: number): Promise<Assinatura | undefined>;
  getAssinaturaByCompany(companyId: number): Promise<Assinatura | undefined>;
  createAssinatura(data: InsertAssinatura): Promise<Assinatura>;
  updateAssinatura(id: number, data: Partial<InsertAssinatura>): Promise<Assinatura>;

  // SaaS — Billing Events
  getBillingEvents(filters?: { companyId?: number; status?: string }): Promise<BillingEvent[]>;
  getBillingEventByGatewayId(gatewayEventId: string): Promise<BillingEvent | undefined>;
  createBillingEvent(data: InsertBillingEvent): Promise<BillingEvent>;
  updateBillingEvent(id: number, data: Partial<InsertBillingEvent>): Promise<BillingEvent>;

  // SaaS — Módulos do Sistema
  getModulosSistema(): Promise<ModuloSistema[]>;
  getModuloSistema(id: number): Promise<ModuloSistema | undefined>;
  createModuloSistema(data: InsertModuloSistema): Promise<ModuloSistema>;
  updateModuloSistema(id: number, data: Partial<InsertModuloSistema>): Promise<ModuloSistema>;
  deleteModuloSistema(id: number): Promise<void>;

  // SaaS — Plano × Módulos
  getModulosByPlano(planoId: number): Promise<ModuloSistema[]>;
  setModulosForPlano(planoId: number, moduloIds: number[]): Promise<void>;
  getPlanoModulos(planoId: number): Promise<PlanoModulo[]>;
  getModuloChavesByCompany(companyId: number): Promise<string[]>;

  // Deliveries
  getDeliveries(filters?: { companyId?: number; driverId?: number; routeId?: number; status?: string; date?: string }): Promise<Delivery[]>;
  getDelivery(id: number): Promise<Delivery | undefined>;
  getDeliveryByOrder(orderId: number): Promise<Delivery | undefined>;
  createDelivery(data: InsertDelivery): Promise<Delivery>;
  updateDelivery(id: number, data: Partial<InsertDelivery>): Promise<Delivery>;
  deleteDelivery(id: number): Promise<void>;

  // SaaS — Bancos de Recebimento
  getBancosRecebimento(): Promise<BancoRecebimento[]>;
  getBancoRecebimento(id: number): Promise<BancoRecebimento | undefined>;
  createBancoRecebimento(data: InsertBancoRecebimento): Promise<BancoRecebimento>;
  updateBancoRecebimento(id: number, data: Partial<InsertBancoRecebimento>): Promise<BancoRecebimento>;
  deleteBancoRecebimento(id: number): Promise<void>;

  // SaaS — Contratos de Clientes
  getContratosClientes(filters?: { empresaId?: number; status?: string }): Promise<ContratoCliente[]>;
  getContratoCliente(id: number): Promise<ContratoCliente | undefined>;
  createContratoCliente(data: InsertContratoCliente): Promise<ContratoCliente>;
  updateContratoCliente(id: number, data: Partial<InsertContratoCliente>): Promise<ContratoCliente>;
  deleteContratoCliente(id: number): Promise<void>;

  // SaaS — Faturas SaaS
  getFaturasSaas(filters?: { empresaId?: number; status?: string }): Promise<FaturaSaas[]>;
  getFaturaSaas(id: number): Promise<FaturaSaas | undefined>;
  createFaturaSaas(data: InsertFaturaSaas): Promise<FaturaSaas>;
  updateFaturaSaas(id: number, data: Partial<InsertFaturaSaas>): Promise<FaturaSaas>;
  deleteFaturaSaas(id: number): Promise<void>;

  // Versões do Sistema
  getSystemVersions(): Promise<SystemVersion[]>;
  getSystemVersion(id: number): Promise<SystemVersion | undefined>;
  getActiveSystemVersion(): Promise<SystemVersion | undefined>;
  createSystemVersion(data: InsertSystemVersion): Promise<SystemVersion>;
  updateSystemVersion(id: number, data: Partial<InsertSystemVersion>): Promise<SystemVersion>;
  deleteSystemVersion(id: number): Promise<void>;

  // Atualizações do Sistema
  getSystemUpdates(filters?: { versionId?: number; empresaId?: number; status?: string }): Promise<SystemUpdate[]>;
  createSystemUpdate(data: InsertSystemUpdate): Promise<SystemUpdate>;
  updateSystemUpdate(id: number, data: Partial<InsertSystemUpdate>): Promise<SystemUpdate>;

  // Logs de Atualização
  getUpdateLogs(filters?: { empresaId?: number }): Promise<UpdateLog[]>;
  createUpdateLog(data: InsertUpdateLog): Promise<UpdateLog>;

  // SaaS Métricas
  getSaasMetrics(periodo?: string): Promise<SaasMetrics | undefined>;
  computeAndSaveSaasMetrics(): Promise<SaasMetrics>;

  // White Label — EmpresaConfig
  getEmpresaConfig(empresaId: number): Promise<EmpresaConfig | undefined>;
  upsertEmpresaConfig(empresaId: number, data: Partial<InsertEmpresaConfig>): Promise<EmpresaConfig>;

  // Marketplace — ModulosMarketplace
  getModulosMarketplace(filters?: { categoria?: string; ativo?: boolean }): Promise<ModuloMarketplace[]>;
  getModuloMarketplace(id: number): Promise<ModuloMarketplace | undefined>;
  createModuloMarketplace(data: InsertModuloMarketplace): Promise<ModuloMarketplace>;
  updateModuloMarketplace(id: number, data: Partial<InsertModuloMarketplace>): Promise<ModuloMarketplace>;
  deleteModuloMarketplace(id: number): Promise<void>;

  // Marketplace — EmpresaModulos
  getEmpresaModulos(empresaId: number): Promise<EmpresaModulo[]>;
  getEmpresaModulo(id: number): Promise<EmpresaModulo | undefined>;
  installModuloEmpresa(empresaId: number, moduloId: number): Promise<EmpresaModulo>;
  updateEmpresaModulo(id: number, data: Partial<InsertEmpresaModulo>): Promise<EmpresaModulo>;
  removeModuloEmpresa(id: number): Promise<void>;

  // FASE 7.1 — assinaturas adicionadas para fechar contrato com DatabaseStorage.
  // Sem alteração de implementação. Apenas reconciliação interface ↔ classe.

  // Tasks
  createTask(data: { title: string; description: string; assignedToId?: number; assignedToName?: string; createdById?: number; createdByName?: string; deadline?: string; priority: string }): Promise<Task>;
  getTasks(): Promise<Task[]>;
  getTasksByUser(userId: number): Promise<Task[]>;
  deleteTask(id: number): Promise<void>;

  // Client Incidents
  createClientIncident(data: { companyId: number; companyName: string; type: string; description: string; contactPhone?: string; contactEmail?: string; photoBase64?: string; photoMime?: string; photosJson?: string }): Promise<ClientIncident>;
  getClientIncidents(): Promise<ClientIncident[]>;
  getClientIncident(id: number): Promise<ClientIncident | undefined>;
  getClientIncidentsByCompany(companyId: number): Promise<ClientIncident[]>;
  updateClientIncident(id: number, updates: { status?: string; adminNote?: string; resolvedAt?: Date | null }): Promise<ClientIncident>;
  deleteClientIncident(id: number): Promise<void>;
  respondToClientIncident(id: number, responseMessage: string, respondedByName: string): Promise<ClientIncident>;
  updateClientIncidentStatus(id: number, status: string): Promise<ClientIncident>;
  markIncidentReadByClient(id: number): Promise<void>;

  // Incident Messages
  createIncidentMessage(data: { incidentId: number; senderType: string; senderName: string; message: string; photosJson?: string }): Promise<IncidentMessage>;
  getIncidentMessages(incidentId: number): Promise<IncidentMessage[]>;

  // Internal Incidents
  createInternalIncident(data: { title: string; description: string; category: string; assignedToId?: number; assignedToName?: string; createdById?: number; createdByName?: string; priority: string }): Promise<InternalIncident>;
  getInternalIncidents(): Promise<InternalIncident[]>;
  deleteInternalIncident(id: number): Promise<void>;

  // Company Settings
  getCompanySettings(empresaId: number): Promise<CompanySettings | undefined>;
  updateCompanySettings(empresaId: number, updates: Partial<InsertCompanySettings>): Promise<CompanySettings>;

  // Other infra getters
  getAboutUs(): Promise<AboutUs | undefined>;
  getSmtpConfig(): Promise<SmtpConfig | undefined>;
  getActivePushSubscriptions(): Promise<PushSubscription[]>;
  getPushSubscriptionCount(): Promise<number>;
  deactivatePushSubscription(endpoint: string): Promise<void>;
  getNotificationSettings(): Promise<NotificationSetting[]>;

  // Sanitary
  getSanitaryQuestions(): Promise<SanitaryQuestion[]>;
  createSanitaryQuestion(data: InsertSanitaryQuestion): Promise<SanitaryQuestion>;
  deleteSanitaryQuestion(id: number): Promise<void>;
  getSanitaryEvaluations(): Promise<SanitaryEvaluation[]>;
  getSanitaryEvaluation(id: number): Promise<{ evaluation: SanitaryEvaluation; items: SanitaryEvaluationItem[] } | undefined>;
  createSanitaryEvaluation(data: InsertSanitaryEvaluation): Promise<SanitaryEvaluation>;
  createSanitaryEvaluationItem(data: InsertSanitaryEvaluationItem): Promise<SanitaryEvaluationItem>;
  bulkCreateSanitaryEvaluationItems(items: InsertSanitaryEvaluationItem[]): Promise<SanitaryEvaluationItem[]>;
}

export class DatabaseStorage implements IStorage {
  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(sql`lower(${users.email}) = ${email.toLowerCase()}`);
    return user;
  }
  
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }
  
  async createUser(user: InsertUser): Promise<User> {
    const hashedPassword = user.password ? await bcrypt.hash(user.password, 10) : undefined;
    const toInsert = { ...user, password: hashedPassword ?? user.password };
    const [newUser] = await db.insert(users).values(toInsert).returning();
    if (newUser?.empresaId) invalidateUsageCache(newUser.empresaId);
    return newUser;
  }

  async updateUser(id: number, updates: Partial<InsertUser>): Promise<User> {
    const toUpdate = { ...updates } as any;
    if (updates.password) {
      toUpdate.password = await bcrypt.hash(updates.password, 10);
    }
    const [updated] = await db.update(users).set(toUpdate).where(eq(users.id, id)).returning();
    if (updated?.empresaId) invalidateUsageCache(updated.empresaId);
    return updated;
  }

  async getCompanyByEmail(email: string): Promise<Company | undefined> {
    const [company] = await db.select().from(companies).where(sql`lower(${companies.email}) = ${email.toLowerCase()}`);
    return company;
  }

  async getCompany(id: number): Promise<Company | undefined> {
    const [company] = await db.select().from(companies).where(eq(companies.id, id));
    return company;
  }

  async getCompanies(limit?: number, offset?: number): Promise<Company[]> {
    const cacheKey = `companies_${limit || 'all'}_${offset || 0}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;
    let query: any = db.select().from(companies);
    if (limit) query = query.limit(limit);
    if (offset) query = query.offset(offset);
    const result: Company[] = await query;
    cache.set(cacheKey, result, 300000); // 5 min
    return result;
  }

  async createCompany(company: InsertCompany): Promise<Company> {
    const hashedPassword = company.password ? await bcrypt.hash(company.password, 10) : undefined;
    const toInsert = { ...company, password: hashedPassword ?? company.password };
    const [newCompany] = await db.insert(companies).values(toInsert).returning();
    return newCompany;
  }

  async updateCompany(id: number, updates: Partial<InsertCompany>): Promise<Company> {
    const toUpdate = { ...updates } as any;
    if (updates.password) {
      toUpdate.password = await bcrypt.hash(updates.password, 10);
    }
    const [updated] = await db.update(companies).set(toUpdate).where(eq(companies.id, id)).returning();
    return updated;
  }

  async deleteCompany(id: number): Promise<void> {
    await db.delete(companies).where(eq(companies.id, id));
  }

  async getContractScopes(companyId: number): Promise<ContractScope[]> {
    return await db.select().from(contractScopes).where(eq(contractScopes.companyId, companyId));
  }

  async getContractScope(companyId: number, productId: number): Promise<ContractScope | null> {
    const rows = await db
      .select()
      .from(contractScopes)
      .where(
        and(
          eq(contractScopes.companyId, companyId),
          eq(contractScopes.productId, productId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async createContractScope(scope: InsertContractScope): Promise<ContractScope> {
    const [newScope] = await db.insert(contractScopes).values(scope).returning();
    return newScope;
  }

  async updateContractScope(id: number, data: Partial<InsertContractScope>): Promise<ContractScope> {
    const [updated] = await db.update(contractScopes).set(data as any).where(eq(contractScopes.id, id)).returning();
    return updated;
  }

  async deleteContractScope(id: number): Promise<void> {
    await db.delete(contractScopes).where(eq(contractScopes.id, id));
  }

  async getContractAdjustments(companyId: number): Promise<ContractAdjustment[]> {
    return await db.select().from(contractAdjustments)
      .where(eq(contractAdjustments.companyId, companyId))
      .orderBy(desc(contractAdjustments.createdAt));
  }

  async createContractAdjustment(adj: InsertContractAdjustment): Promise<ContractAdjustment> {
    const [record] = await db.insert(contractAdjustments).values(adj).returning();
    return record;
  }

  async updateContractAdjustment(id: number, data: Partial<InsertContractAdjustment>): Promise<ContractAdjustment> {
    const [record] = await db.update(contractAdjustments).set(data as any).where(eq(contractAdjustments.id, id)).returning();
    return record;
  }

  async getContractAdjustment(id: number): Promise<ContractAdjustment | undefined> {
    const [record] = await db.select().from(contractAdjustments).where(eq(contractAdjustments.id, id));
    return record;
  }

  async getDanfeRecordsByOrderId(orderId: number): Promise<DanfeRecord[]> {
    return await db.select().from(danfeRecords).where(eq(danfeRecords.orderId, orderId)).orderBy(desc(danfeRecords.generatedAt));
  }

  async createDanfeRecord(record: InsertDanfeRecord): Promise<DanfeRecord> {
    const [newRecord] = await db.insert(danfeRecords).values(record).returning();
    return newRecord;
  }

  async getPriceGroups(empresaId?: number): Promise<PriceGroup[]> {
    try {
      const query = db.select().from(priceGroups);
      if (empresaId) {
        query.where(eq(priceGroups.empresaId, empresaId));
      }
      return await query;
    } catch (err: any) {
      logSecurity(`[STORAGE_WRITE_FAILED] step=getPriceGroups | reason=empresa_id_column_missing | error=${err?.message ?? "unknown"}`);
      console.warn('[STORAGE] getPriceGroups: coluna empresa_id pode não existir, retornando sem filtro');
      return await db.select().from(priceGroups);
    }
  }

  async createPriceGroup(group: InsertPriceGroup): Promise<PriceGroup> {
    const [newGroup] = await db.insert(priceGroups).values(group).returning();
    return newGroup;
  }

  async updatePriceGroup(id: number, updates: Partial<InsertPriceGroup>): Promise<PriceGroup> {
    const [updated] = await db.update(priceGroups).set(updates).where(eq(priceGroups.id, id)).returning();
    return updated;
  }

  async deletePriceGroup(id: number): Promise<void> {
    await db.delete(priceGroups).where(eq(priceGroups.id, id));
  }

  async getCategories(empresaId?: number): Promise<Category[]> {
    const query = db.select().from(categories).orderBy(categories.name);
    if (empresaId) {
      query.where(eq(categories.empresaId, empresaId));
    }
    return await query;
  }

  async createCategory(cat: InsertCategory): Promise<Category> {
    const [newCat] = await db.insert(categories).values(cat).returning();
    return newCat;
  }

  async updateCategory(id: number, updates: Partial<InsertCategory>): Promise<Category> {
    const [updated] = await db.update(categories).set(updates).where(eq(categories.id, id)).returning();
    return updated;
  }

  async deleteCategory(id: number): Promise<void> {
    await db.delete(categories).where(eq(categories.id, id));
  }

  async getProducts(empresaId?: number, limit = 1000): Promise<Product[]> {
    // PERF-FIX: bounded LIMIT (default 1000) prevents OOM on large catalogs.
    // All existing callers that omit `limit` get the safe default.
    const query = db.select().from(products);
    if (empresaId) {
      query.where(eq(products.empresaId, empresaId));
    }
    query.limit(limit);
    return await query;
  }

  /**
   * Direct-by-id lookup. Mirrors `getProducts()`'s lack of tenant scoping
   * (the existing call sites used `(await getProducts()).find(p => p.id === id)`
   * which is also globally scoped). Returns `undefined` when not found.
   */
  async getProductById(id: number): Promise<Product | undefined> {
    const [row] = await db.select().from(products).where(eq(products.id, id)).limit(1);
    return row;
  }

  async createProduct(product: InsertProduct): Promise<Product> {
    const [newProduct] = await db.insert(products).values(product).returning();
    return newProduct;
  }

  async updateProduct(id: number, updates: Partial<InsertProduct>): Promise<Product> {
    const [updated] = await db.update(products).set(updates).where(eq(products.id, id)).returning();
    return updated;
  }

  async deleteProduct(id: number): Promise<void> {
    await db.delete(products).where(eq(products.id, id));
  }

  async getProductPrices(empresaId?: number): Promise<ProductPrice[]> {
    const query = db.select().from(productPrices);
    if (empresaId) {
      query.where(eq(productPrices.empresaId, empresaId));
    }
    return await query;
  }

  async getProductPricesByProductId(productId: number): Promise<ProductPrice[]> {
    return await db.select().from(productPrices).where(eq(productPrices.productId, productId));
  }

  async createProductPrice(price: InsertProductPrice): Promise<ProductPrice> {
    const [newPrice] = await db.insert(productPrices).values(price).returning();
    return newPrice;
  }

  async updateProductPrice(id: number, updates: Partial<InsertProductPrice>): Promise<ProductPrice> {
    const [updated] = await db.update(productPrices).set(updates).where(eq(productPrices.id, id)).returning();
    return updated;
  }

  async deleteProductPrice(id: number): Promise<void> {
    await db.delete(productPrices).where(eq(productPrices.id, id));
  }

  async getProductSubCategoriesByProductId(productId: number): Promise<ProductSubCategory[]> {
    return await db.select().from(productSubCategories).where(eq(productSubCategories.productId, productId));
  }

  async getProductSubCategoryById(id: number): Promise<ProductSubCategory | null> {
    const rows = await db
      .select()
      .from(productSubCategories)
      .where(eq(productSubCategories.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async createProductSubCategory(data: InsertProductSubCategory): Promise<ProductSubCategory> {
    const [row] = await db.insert(productSubCategories).values(data).returning();
    return row;
  }

  async updateProductSubCategory(id: number, updates: Partial<InsertProductSubCategory>): Promise<ProductSubCategory> {
    const [row] = await db.update(productSubCategories).set(updates).where(eq(productSubCategories.id, id)).returning();
    return row;
  }

  async deleteProductSubCategory(id: number): Promise<void> {
    await db.delete(productSubCategories).where(eq(productSubCategories.id, id));
  }

  async deleteProductSubCategoriesByProductId(productId: number): Promise<void> {
    await db.delete(productSubCategories).where(eq(productSubCategories.productId, productId));
  }

  async getOrderWindows(empresaId?: number): Promise<OrderWindow[]> {
    const query = db.select().from(orderWindows).orderBy(desc(orderWindows.id));
    if (empresaId) {
      query.where(eq(orderWindows.empresaId, empresaId));
    }
    return await query;
  }

  async getActiveOrderWindow(): Promise<OrderWindow | undefined> {
    const now = new Date();
    const [active] = await db.select().from(orderWindows).where(
      and(
        eq(orderWindows.active, true),
        lte(orderWindows.orderOpenDate, now),
        gte(orderWindows.orderCloseDate, now)
      )
    ).orderBy(desc(orderWindows.id)).limit(1);
    return active;
  }

  async createOrderWindow(window: InsertOrderWindow): Promise<OrderWindow> {
    const [newWindow] = await db.insert(orderWindows).values({
      ...window,
      orderOpenDate: new Date(window.orderOpenDate),
      orderCloseDate: new Date(window.orderCloseDate),
      deliveryStartDate: new Date(window.deliveryStartDate),
      deliveryEndDate: new Date(window.deliveryEndDate),
    }).returning();
    return newWindow;
  }

  async updateOrderWindow(id: number, updates: Partial<InsertOrderWindow>): Promise<OrderWindow> {
    const updateData: any = { ...updates };
    if (updates.orderOpenDate) updateData.orderOpenDate = new Date(updates.orderOpenDate);
    if (updates.orderCloseDate) updateData.orderCloseDate = new Date(updates.orderCloseDate);
    if (updates.deliveryStartDate) updateData.deliveryStartDate = new Date(updates.deliveryStartDate);
    if (updates.deliveryEndDate) updateData.deliveryEndDate = new Date(updates.deliveryEndDate);
    
    const [updated] = await db.update(orderWindows).set(updateData).where(eq(orderWindows.id, id)).returning();
    return updated;
  }

  async deleteOrderWindow(id: number): Promise<void> {
    await db.delete(orderWindows).where(eq(orderWindows.id, id));
  }

  async getOrders(empresaId?: number, limit = 1000): Promise<Order[]> {
    // FASE 1 — Safe-guard tenant: se o caller não passa empresaId explícito,
    // tenta deduzir do TenantContext em escopo (sessão de empresa ou admin
    // pinned). Se não houver contexto (ex.: admin cross-tenant legítimo),
    // mantém o comportamento original de retornar tudo, preservando os 25+
    // call-sites em rotas administrativas que agregam entre empresas.
    // PERF-FIX: bounded LIMIT (default 1000) prevents OOM on large datasets.
    const empresa = empresaId ?? currentTenantId();
    const query = db.select().from(orders).orderBy(desc(orders.orderDate));
    if (empresa != null) {
      query.where(eq(orders.companyId, empresa));
    }
    query.limit(limit);
    return await query;
  }

  async getOrder(id: number): Promise<{ order: Order, items: OrderItem[] } | undefined> {
    const [order] = await db.select().from(orders).where(eq(orders.id, id));
    if (!order) return undefined;
    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, id));
    return { order, items };
  }

  /**
   * Direct (orderId, productId) → single OrderItem lookup. Replaces the
   * legacy `(await getOrder(orderId))?.items.find(i => i.productId === pid)`
   * pattern used by `safraAlerts`. Not tenant-scoped — matches `getOrder`'s
   * own scoping. Lowest-id ordering preserves `.find()` semantics.
   */
  async getOrderItemByProduct(orderId: number, productId: number): Promise<OrderItem | undefined> {
    const [row] = await db
      .select()
      .from(orderItems)
      .where(and(eq(orderItems.orderId, orderId), eq(orderItems.productId, productId)))
      .orderBy(orderItems.id)
      .limit(1);
    return row;
  }

  async updateOrder(id: number, updates: { status?: string; adminNote?: string; reopenReason?: string | null; reopenRequestedAt?: Date | null; totalValue?: string; fiscalStatus?: string | null; preNotaNumber?: string | null; nimbiExpiration?: string | null; orderNote?: string | null; deliveryDate?: string | Date; [key: string]: any }): Promise<Order> {
    const processedUpdates: any = { ...updates };
    if (typeof processedUpdates.deliveryDate === 'string') {
      processedUpdates.deliveryDate = new Date(processedUpdates.deliveryDate);
    }
    const [updated] = await db.update(orders).set(processedUpdates).where(eq(orders.id, id)).returning();
    if (updated?.companyId) invalidateUsageCache(updated.companyId);
    return updated;
  }

  async getOrdersByCompanyId(companyId: number): Promise<Order[]> {
    return await db.select().from(orders).where(eq(orders.companyId, companyId)).orderBy(desc(orders.orderDate));
  }

  async updateOrderItems(orderId: number, newItems: { productId: number; quantity: number; unitPrice: string; totalPrice: string; subCategoryId?: number | null; subCategoryName?: string | null }[]): Promise<void> {
    await db.delete(orderItems).where(eq(orderItems.orderId, orderId));
    if (newItems.length > 0) {
      await db.insert(orderItems).values(newItems.map(item => ({
        orderId,
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
        subCategoryId: item.subCategoryId ?? null,
        subCategoryName: item.subCategoryName ?? null,
      })));
    }
    // Recalculate total
    const total = newItems.reduce((s, i) => s + Number(i.totalPrice), 0);
    await db.update(orders).set({ totalValue: String(total) }).where(eq(orders.id, orderId));
  }

  async getPurchasingReport(filters: {
    dateFrom?: string;
    dateTo?: string;
    companyId?: number;
    productId?: number;
  }): Promise<{
    products: { productId: number; productName: string; unit: string; totalQuantity: number; companies: { companyId: number; companyName: string; quantity: number }[] }[];
    rawOrders: { orderCode: string; companyName: string; orderDate: string; deliveryDate: string; productName: string; quantity: number; unitPrice: number; totalPrice: number }[];
  }> {
    // Build conditions
    const conditions: any[] = [];
    if (filters.companyId) conditions.push(eq(orders.companyId, filters.companyId));
    if (filters.productId) conditions.push(eq(orderItems.productId, filters.productId));
    if (filters.dateFrom) conditions.push(gte(orders.orderDate, new Date(filters.dateFrom)));
    if (filters.dateTo) {
      const to = new Date(filters.dateTo);
      to.setHours(23, 59, 59, 999);
      conditions.push(lte(orders.orderDate, to));
    }

    // Only include ACTIVE orders
    conditions.push(eq(orders.status, 'ACTIVE'));

    const rows = await db
      .select({
        orderId: orders.id,
        orderCode: orders.orderCode,
        orderDate: orders.orderDate,
        deliveryDate: orders.deliveryDate,
        companyId: companies.id,
        companyName: companies.companyName,
        productId: products.id,
        productName: products.name,
        productUnit: products.unit,
        quantity: orderItems.quantity,
        unitPrice: orderItems.unitPrice,
        totalPrice: orderItems.totalPrice,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .innerJoin(companies, eq(orders.companyId, companies.id))
      .innerJoin(products, eq(orderItems.productId, products.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(orders.orderDate));

    // Aggregate by product
    const productMap = new Map<number, {
      productId: number; productName: string; unit: string; totalQuantity: number;
      companyMap: Map<number, { companyId: number; companyName: string; quantity: number }>;
    }>();

    for (const row of rows) {
      if (!productMap.has(row.productId)) {
        productMap.set(row.productId, {
          productId: row.productId,
          productName: row.productName,
          unit: row.productUnit,
          totalQuantity: 0,
          companyMap: new Map(),
        });
      }
      const p = productMap.get(row.productId)!;
      p.totalQuantity += row.quantity;
      const existing = p.companyMap.get(row.companyId);
      if (existing) existing.quantity += row.quantity;
      else p.companyMap.set(row.companyId, { companyId: row.companyId, companyName: row.companyName, quantity: row.quantity });
    }

    const productsList = Array.from(productMap.values())
      .map(p => ({
        productId: p.productId,
        productName: p.productName,
        unit: p.unit,
        totalQuantity: p.totalQuantity,
        companies: Array.from(p.companyMap.values()).sort((a, b) => b.quantity - a.quantity),
      }))
      .sort((a, b) => b.totalQuantity - a.totalQuantity);

    const rawOrders = rows.map(row => ({
      orderCode: row.orderCode || `#${row.orderId}`,
      companyName: row.companyName,
      orderDate: row.orderDate.toISOString().split('T')[0],
      deliveryDate: row.deliveryDate.toISOString().split('T')[0],
      productName: row.productName,
      quantity: row.quantity,
      unitPrice: Number(row.unitPrice),
      totalPrice: Number(row.totalPrice),
    }));

    return { products: productsList, rawOrders };
  }

  async getCompanyOrders(companyId: number): Promise<Order[]> {
    return await db.select().from(orders).where(eq(orders.companyId, companyId)).orderBy(desc(orders.orderDate));
  }

  async createOrder(order: InsertOrder, items: InsertOrderItem[]): Promise<Order> {
    return await db.transaction(async (tx) => {
      // Insert order first to get the ID
      const [newOrder] = await tx.insert(orders).values({
        ...order,
        deliveryDate: new Date(order.deliveryDate),
      }).returning();

      // Generate order code: VF-YEAR-XXXXXX using the new ID
      const year = new Date().getFullYear();
      const orderCode = `VF-${year}-${String(newOrder.id).padStart(6, '0')}`;

      // Update with the generated order code
      const [updatedOrder] = await tx.update(orders)
        .set({ orderCode })
        .where(eq(orders.id, newOrder.id))
        .returning();

      // Insert order items
      if (items.length > 0) {
        const itemsWithOrderId = items.map(item => ({
          ...item,
          orderId: updatedOrder.id
        }));
        await tx.insert(orderItems).values(itemsWithOrderId);
      }

      return updatedOrder;
    }).then((result) => {
      if (result?.companyId) invalidateUsageCache(result.companyId);
      return result;
    });
  }

  async getOrderExceptions(): Promise<OrderException[]> {
    return await db.select().from(orderExceptions).orderBy(desc(orderExceptions.createdAt));
  }

  async createOrderException(exc: InsertOrderException): Promise<OrderException> {
    const [newExc] = await db.insert(orderExceptions).values(exc).returning();
    return newExc;
  }

  async updateOrderException(id: number, updates: Partial<InsertOrderException>): Promise<OrderException> {
    const [updated] = await db.update(orderExceptions).set(updates).where(eq(orderExceptions.id, id)).returning();
    return updated;
  }

  async deleteOrderException(id: number): Promise<void> {
    await db.delete(orderExceptions).where(eq(orderExceptions.id, id));
  }

  async getCompanyException(companyId: number): Promise<OrderException | undefined> {
    const now = new Date();
    const rows = await db.select().from(orderExceptions).where(
      and(eq(orderExceptions.companyId, companyId), eq(orderExceptions.active, true))
    );
    // Filter to non-expired exceptions (expiryDate null or >= today)
    const valid = rows.filter(e => !e.expiryDate || new Date(e.expiryDate) >= now);
    return valid[0];
  }

  async getIndustrializedReport(filters: {
    dateFrom?: string;
    dateTo?: string;
    companyId?: number;
    productId?: number;
  }): Promise<any[]> {
    const conditions: any[] = [eq(products.isIndustrialized, true), eq(orders.status, 'ACTIVE')];
    if (filters.companyId) conditions.push(eq(orders.companyId, filters.companyId));
    if (filters.productId) conditions.push(eq(orderItems.productId, filters.productId));
    if (filters.dateFrom) conditions.push(gte(orders.orderDate, new Date(filters.dateFrom)));
    if (filters.dateTo) {
      const to = new Date(filters.dateTo);
      to.setHours(23, 59, 59, 999);
      conditions.push(lte(orders.orderDate, to));
    }

    const rows = await db
      .select({
        orderId: orders.id,
        orderCode: orders.orderCode,
        orderDate: orders.orderDate,
        companyName: companies.companyName,
        productName: products.name,
        productUnit: products.unit,
        quantity: orderItems.quantity,
        unitPrice: orderItems.unitPrice,
        totalPrice: orderItems.totalPrice,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .innerJoin(companies, eq(orders.companyId, companies.id))
      .innerJoin(products, eq(orderItems.productId, products.id))
      .where(and(...conditions))
      .orderBy(desc(orders.orderDate));

    return rows.map(r => ({
      orderId: r.orderId,
      orderCode: r.orderCode || `#${r.orderId}`,
      orderDate: r.orderDate.toISOString().split('T')[0],
      companyName: r.companyName,
      productName: r.productName,
      unit: r.productUnit,
      quantity: r.quantity,
      unitPrice: Number(r.unitPrice),
      totalPrice: Number(r.totalPrice),
    }));
  }

  async getSetting(key: string): Promise<string | null> {
    const [row] = await db.select().from(systemSettings).where(eq(systemSettings.key, key));
    return row?.value ?? null;
  }

  async setSetting(key: string, value: string): Promise<void> {
    await db.insert(systemSettings)
      .values({ key, value })
      .onConflictDoUpdate({ target: systemSettings.key, set: { value } });
  }

  async getCompanyConfig(): Promise<CompanyConfig | undefined> {
    const configs = await db.select().from(companyConfig);
    return configs[0];
  }

  async updateCompanyConfig(updates: Partial<InsertCompanyConfig>): Promise<CompanyConfig> {
    const configs = await db.select().from(companyConfig);
    if (configs.length === 0) {
      const [inserted] = await db.insert(companyConfig).values({ ...updates, updatedAt: new Date() } as any).returning();
      return inserted;
    }
    const [updated] = await db.update(companyConfig).set({ ...updates, updatedAt: new Date() } as any).where(eq(companyConfig.id, configs[0].id)).returning();
    return updated;
  }

  async getCompanySettings(empresaId: number): Promise<CompanySettings | undefined> {
    const [settings] = await db.select().from(companySettings).where(eq(companySettings.empresaId, empresaId));
    return settings;
  }

  async updateCompanySettings(empresaId: number, updates: Partial<InsertCompanySettings>): Promise<CompanySettings> {
    const existing = await this.getCompanySettings(empresaId);
    if (!existing) {
      const [inserted] = await db.insert(companySettings).values({ ...updates, empresaId, updatedAt: new Date() } as any).returning();
      return inserted;
    }
    const [updated] = await db.update(companySettings).set({ ...updates, updatedAt: new Date() } as any).where(eq(companySettings.id, existing.id)).returning();
    return updated;
  }

  async getPasswordResetRequests(): Promise<PasswordResetRequest[]> {
    return await db.select().from(passwordResetRequests).orderBy(desc(passwordResetRequests.createdAt));
  }

  async createPasswordResetRequest(companyId: number): Promise<PasswordResetRequest> {
    const [req] = await db.insert(passwordResetRequests).values({ companyId, status: 'PENDING' }).returning();
    return req;
  }

  async updatePasswordResetRequest(id: number, updates: { status: string; newPassword?: string; adminNote?: string; resolvedAt?: Date }): Promise<PasswordResetRequest> {
    const [updated] = await db.update(passwordResetRequests).set(updates as any).where(eq(passwordResetRequests.id, id)).returning();
    return updated;
  }

  async getSpecialOrderRequests(): Promise<SpecialOrderRequest[]> {
    return await db.select().from(specialOrderRequests).orderBy(desc(specialOrderRequests.createdAt));
  }

  async getSpecialOrderRequestsByCompany(companyId: number): Promise<SpecialOrderRequest[]> {
    return await db.select().from(specialOrderRequests).where(eq(specialOrderRequests.companyId, companyId)).orderBy(desc(specialOrderRequests.createdAt));
  }

  async createSpecialOrderRequest(data: { companyId: number; requestedDay: string; requestedDate?: string | null; description: string; quantity: string; observations?: string | null; items?: any; estimatedDeliveryDate?: string | null }): Promise<SpecialOrderRequest> {
    const [req] = await db.insert(specialOrderRequests).values({ ...data, status: 'PENDING' } as any).returning();
    return req;
  }

  async updateSpecialOrderRequest(id: number, updates: { status: string; adminNote?: string; resolvedAt?: Date; items?: any; estimatedDeliveryDate?: string | null }): Promise<SpecialOrderRequest> {
    const [updated] = await db.update(specialOrderRequests).set(updates as any).where(eq(specialOrderRequests.id, id)).returning();
    return updated;
  }

  async getUsers(limit = 1000): Promise<User[]> {
    // PERF-FIX: bounded LIMIT (default 1000) prevents OOM. All existing callers
    // that omit `limit` get the safe default without any signature change.
    return await db.select().from(users).orderBy(users.id).limit(limit);
  }

  async deleteUser(id: number): Promise<void> {
    const [deleted] = await db.delete(users).where(eq(users.id, id)).returning();
    if (deleted?.empresaId) invalidateUsageCache(deleted.empresaId);
  }

  async createTestOrder(data: { orderCode: string; companyId: number; companyName: string; deliveryDate: Date; weekReference: string; totalValue: string; orderNote?: string | null; items: any[]; createdBy?: number }): Promise<TestOrder> {
    const [order] = await db.insert(testOrders).values(data).returning();
    return order;
  }

  async getTestOrders(): Promise<TestOrder[]> {
    return await db.select().from(testOrders).orderBy(desc(testOrders.createdAt));
  }

  async deleteOrder(id: number): Promise<void> {
    await db.delete(orderItems).where(eq(orderItems.orderId, id));
    const [deleted] = await db.delete(orders).where(eq(orders.id, id)).returning();
    if (deleted?.companyId) invalidateUsageCache(deleted.companyId);
  }

  async createLog(log: { action: string; description: string; userId?: number; companyId?: number; userEmail?: string; userRole?: string; ip?: string; level?: string }): Promise<void> {
    try {
      await db.insert(systemLogs).values({ ...log, level: log.level || "INFO" });
    } catch (err: any) {
      logSecurity(`[STORAGE_WRITE_FAILED] step=createLog | action=${log.action} | error=${err?.message ?? "unknown"}`);
      console.error("[LOG] Failed to write system log:", err);
    }
  }

  async getLogs(limit = 200): Promise<SystemLog[]> {
    return db.select().from(systemLogs).orderBy(desc(systemLogs.createdAt)).limit(limit);
  }

  async getLogsByOrderCode(orderCode: string): Promise<SystemLog[]> {
    if (!orderCode) return [];
    // Match `Pedido VFR-0001`, `Pedido #123 (VFR-0001)`, or any description
    // that contains the orderCode token. Case-insensitive for safety.
    return db
      .select()
      .from(systemLogs)
      .where(sql`${systemLogs.description} ILIKE ${"%" + orderCode + "%"}`)
      .orderBy(systemLogs.createdAt);
  }

  async getSecurityLogs(limit = 300): Promise<SystemLog[]> {
    const securityActions = ['LOGIN_FAILED', 'ACCOUNT_LOCKED', 'ACCOUNT_UNLOCKED', 'LOGIN', 'LOGIN_BLOCKED', 'FRONTEND_RUNTIME_ERROR'];
    return db.select().from(systemLogs)
      .where(inArray(systemLogs.action, securityActions))
      .orderBy(desc(systemLogs.createdAt))
      .limit(limit);
  }

  // ─── Tarefas ──────────────────────────────────────────────────
  async createTask(data: { title: string; description: string; assignedToId?: number; assignedToName?: string; createdById?: number; createdByName?: string; deadline?: string; priority: string }): Promise<Task> {
    const [task] = await db.insert(tasks).values({ ...data, status: 'PENDING' }).returning();
    return task;
  }

  async getTasks(): Promise<Task[]> {
    return db.select().from(tasks).orderBy(desc(tasks.createdAt));
  }

  async getTasksByUser(userId: number): Promise<Task[]> {
    return db.select().from(tasks).where(eq(tasks.assignedToId, userId)).orderBy(desc(tasks.createdAt));
  }

  async updateTask(id: number, updates: Partial<{ title: string; description: string; assignedToId: number; assignedToName: string; deadline: string; priority: string; status: string; updatedAt: Date }>): Promise<Task> {
    const [updated] = await db.update(tasks).set({ ...updates, updatedAt: new Date() }).where(eq(tasks.id, id)).returning();
    return updated;
  }

  async deleteTask(id: number): Promise<void> {
    await db.delete(tasks).where(eq(tasks.id, id));
  }

  // ─── Ocorrências de Clientes ──────────────────────────────────
  async createClientIncident(data: { companyId: number; companyName: string; type: string; description: string; contactPhone?: string; contactEmail?: string; photoBase64?: string; photoMime?: string; photosJson?: string }): Promise<ClientIncident> {
    const [inc] = await db.insert(clientIncidents).values({ ...data, status: 'OPEN' }).returning();
    return inc;
  }

  async getClientIncidents(): Promise<ClientIncident[]> {
    return db.select().from(clientIncidents).orderBy(desc(clientIncidents.createdAt));
  }

  async getClientIncident(id: number): Promise<ClientIncident | undefined> {
    const [incident] = await db.select().from(clientIncidents).where(eq(clientIncidents.id, id));
    return incident;
  }

  async getClientIncidentsByCompany(companyId: number): Promise<ClientIncident[]> {
    return db.select().from(clientIncidents).where(eq(clientIncidents.companyId, companyId)).orderBy(desc(clientIncidents.createdAt));
  }

  async updateClientIncident(id: number, updates: { status?: string; adminNote?: string; resolvedAt?: Date | null }): Promise<ClientIncident> {
    const [updated] = await db.update(clientIncidents).set(updates as any).where(eq(clientIncidents.id, id)).returning();
    return updated;
  }

  async deleteClientIncident(id: number): Promise<void> {
    await db.delete(clientIncidents).where(eq(clientIncidents.id, id));
  }

  async respondToClientIncident(id: number, responseMessage: string, respondedByName: string): Promise<ClientIncident> {
    const [updated] = await db.update(clientIncidents)
      .set({ responseMessage, respondedByName, respondedAt: new Date(), status: 'RESPONDED', hasUnreadAdminReply: true, updatedAt: new Date() })
      .where(eq(clientIncidents.id, id))
      .returning();
    return updated;
  }

  async updateClientIncidentStatus(id: number, status: string): Promise<ClientIncident> {
    const [updated] = await db.update(clientIncidents)
      .set({ status, updatedAt: new Date() } as any)
      .where(eq(clientIncidents.id, id))
      .returning();
    return updated;
  }

  async markIncidentReadByClient(id: number): Promise<void> {
    await db.update(clientIncidents)
      .set({ hasUnreadAdminReply: false } as any)
      .where(eq(clientIncidents.id, id));
  }

  // ─── Mensagens de Ocorrências ─────────────────────────────────
  async getIncidentMessages(incidentId: number): Promise<IncidentMessage[]> {
    return db.select().from(incidentMessages).where(eq(incidentMessages.incidentId, incidentId)).orderBy(incidentMessages.createdAt);
  }

  async createIncidentMessage(data: { incidentId: number; senderType: string; senderName: string; message: string; photosJson?: string }): Promise<IncidentMessage> {
    const [msg] = await db.insert(incidentMessages).values(data).returning();
    if (data.senderType === 'ADMIN') {
      await db.update(clientIncidents)
        .set({ hasUnreadAdminReply: true, status: 'RESPONDED', updatedAt: new Date() } as any)
        .where(eq(clientIncidents.id, data.incidentId));
    } else {
      await db.update(clientIncidents)
        .set({ updatedAt: new Date() } as any)
        .where(eq(clientIncidents.id, data.incidentId));
    }
    return msg;
  }

  // ─── Ocorrências Internas ─────────────────────────────────────
  async createInternalIncident(data: { title: string; description: string; category: string; assignedToId?: number; assignedToName?: string; createdById?: number; createdByName?: string; priority: string }): Promise<InternalIncident> {
    const [inc] = await db.insert(internalIncidents).values({ ...data, status: 'OPEN' }).returning();
    return inc;
  }

  async getInternalIncidents(): Promise<InternalIncident[]> {
    return db.select().from(internalIncidents).orderBy(desc(internalIncidents.createdAt));
  }

  async updateInternalIncident(id: number, updates: { status?: string; adminNote?: string; resolvedAt?: Date | null; assignedToId?: number; assignedToName?: string }): Promise<InternalIncident> {
    const [updated] = await db.update(internalIncidents).set(updates as any).where(eq(internalIncidents.id, id)).returning();
    return updated;
  }

  async deleteInternalIncident(id: number): Promise<void> {
    await db.delete(internalIncidents).where(eq(internalIncidents.id, id));
  }

  // ─── Logística: Motoristas ────────────────────────────────────
  async getDrivers(): Promise<LogisticsDriver[]> {
    return db.select().from(logisticsDrivers).orderBy(logisticsDrivers.name);
  }
  async createDriver(data: Partial<LogisticsDriver>): Promise<LogisticsDriver> {
    const [d] = await db.insert(logisticsDrivers).values(data as any).returning();
    if ((d as any)?.empresaId) invalidateUsageCache((d as any).empresaId);
    return d;
  }
  async updateDriver(id: number, data: Partial<LogisticsDriver>): Promise<LogisticsDriver> {
    const [d] = await db.update(logisticsDrivers).set(data as any).where(eq(logisticsDrivers.id, id)).returning();
    if ((d as any)?.empresaId) invalidateUsageCache((d as any).empresaId);
    return d;
  }
  async deleteDriver(id: number): Promise<void> {
    const [deleted] = await db.delete(logisticsDrivers).where(eq(logisticsDrivers.id, id)).returning();
    if ((deleted as any)?.empresaId) invalidateUsageCache((deleted as any).empresaId);
  }

  // ─── Logística: Veículos ──────────────────────────────────────
  async getVehicles(): Promise<LogisticsVehicle[]> {
    return db.select().from(logisticsVehicles).orderBy(logisticsVehicles.plate);
  }
  async createVehicle(data: Partial<LogisticsVehicle>): Promise<LogisticsVehicle> {
    const [v] = await db.insert(logisticsVehicles).values(data as any).returning();
    return v;
  }
  async updateVehicle(id: number, data: Partial<LogisticsVehicle>): Promise<LogisticsVehicle> {
    const [v] = await db.update(logisticsVehicles).set(data as any).where(eq(logisticsVehicles.id, id)).returning();
    return v;
  }
  async deleteVehicle(id: number): Promise<void> {
    await db.delete(logisticsVehicles).where(eq(logisticsVehicles.id, id));
  }

  // ─── Logística: Rotas ─────────────────────────────────────────
  async getRoutes(): Promise<LogisticsRoute[]> {
    return db.select().from(logisticsRoutes).orderBy(desc(logisticsRoutes.createdAt));
  }
  async createRoute(data: Partial<LogisticsRoute>): Promise<LogisticsRoute> {
    const [r] = await db.insert(logisticsRoutes).values(data as any).returning();
    if ((r as any)?.empresaId) invalidateUsageCache((r as any).empresaId);
    return r;
  }
  async updateRoute(id: number, data: Partial<LogisticsRoute>): Promise<LogisticsRoute> {
    const [r] = await db.update(logisticsRoutes).set(data as any).where(eq(logisticsRoutes.id, id)).returning();
    if ((r as any)?.empresaId) invalidateUsageCache((r as any).empresaId);
    return r;
  }
  async deleteRoute(id: number): Promise<void> {
    const [deleted] = await db.delete(logisticsRoutes).where(eq(logisticsRoutes.id, id)).returning();
    if ((deleted as any)?.empresaId) invalidateUsageCache((deleted as any).empresaId);
  }

  // ─── Logística: Manutenção ────────────────────────────────────
  async getMaintenances(): Promise<LogisticsMaintenance[]> {
    return db.select().from(logisticsMaintenance).orderBy(desc(logisticsMaintenance.createdAt));
  }
  async createMaintenance(data: Partial<LogisticsMaintenance>): Promise<LogisticsMaintenance> {
    const [m] = await db.insert(logisticsMaintenance).values(data as any).returning();
    return m;
  }
  async updateMaintenance(id: number, data: Partial<LogisticsMaintenance>): Promise<LogisticsMaintenance> {
    const [m] = await db.update(logisticsMaintenance).set(data as any).where(eq(logisticsMaintenance.id, id)).returning();
    return m;
  }
  async deleteMaintenance(id: number): Promise<void> {
    await db.delete(logisticsMaintenance).where(eq(logisticsMaintenance.id, id));
  }

  // ─── Cotação de Empresas ──────────────────────────────────────
  async getQuotations(): Promise<CompanyQuotation[]> {
    return db.select().from(companyQuotations).orderBy(desc(companyQuotations.createdAt));
  }
  async createQuotation(data: Partial<CompanyQuotation>): Promise<CompanyQuotation> {
    const [q] = await db.insert(companyQuotations).values({ status: 'PENDING', ...data } as any).returning();
    return q;
  }
  async updateQuotation(id: number, data: Partial<CompanyQuotation>): Promise<CompanyQuotation> {
    const [q] = await db.update(companyQuotations).set({ ...data, updatedAt: new Date() } as any).where(eq(companyQuotations.id, id)).returning();
    return q;
  }
  async deleteQuotation(id: number): Promise<void> {
    await db.delete(companyQuotations).where(eq(companyQuotations.id, id));
  }

  // ─── Announcements ────────────────────────────────────────────
  async getAnnouncements(): Promise<Announcement[]> {
    return db.select().from(announcements).orderBy(desc(announcements.createdAt));
  }

  async getActiveAnnouncementsForCompany(companyId: number): Promise<Announcement[]> {
    const today = new Date().toISOString().split('T')[0];
    const all = await db.select().from(announcements)
      .where(and(eq(announcements.active, true), lte(announcements.startDate, today), gte(announcements.endDate, today)))
      .orderBy(desc(announcements.priority), desc(announcements.createdAt));
    const company = await this.getCompany(companyId);
    if (!company) return [];
    return all.filter(a => {
      if (a.targetAll) return true;
      if (a.targetClientTypes && a.targetClientTypes.length > 0 && company.clientType && a.targetClientTypes.includes(company.clientType)) return true;
      if (a.targetCompanyIds && a.targetCompanyIds.length > 0 && a.targetCompanyIds.includes(companyId)) return true;
      return false;
    });
  }

  async createAnnouncement(data: InsertAnnouncement): Promise<Announcement> {
    const [row] = await db.insert(announcements).values(data).returning();
    return row;
  }

  async updateAnnouncement(id: number, data: Partial<InsertAnnouncement>): Promise<Announcement> {
    const [row] = await db.update(announcements).set(data).where(eq(announcements.id, id)).returning();
    return row;
  }

  async deleteAnnouncement(id: number): Promise<void> {
    await db.delete(announcements).where(eq(announcements.id, id));
  }

  // ─── Logs: delete all ─────────────────────────────────────────
  async clearLogs(): Promise<void> {
    await db.delete(systemLogs);
  }

  async deleteLogsByIds(ids: number[]): Promise<number> {
    if (!ids.length) return 0;
    const { inArray } = await import('drizzle-orm');
    const result = await db.delete(systemLogs).where(inArray(systemLogs.id, ids));
    return ids.length;
  }

  async deleteLogsByDateRange(start: Date, end: Date): Promise<number> {
    const { and, gte: gteOp, lte: lteOp } = await import('drizzle-orm');
    const before = await db.select().from(systemLogs).where(and(gteOp(systemLogs.createdAt, start), lteOp(systemLogs.createdAt, end)));
    await db.delete(systemLogs).where(and(gteOp(systemLogs.createdAt, start), lteOp(systemLogs.createdAt, end)));
    return before.length;
  }

  async cleanOldLogs(olderThanDays = 90): Promise<number> {
    const { lt: ltOp } = await import('drizzle-orm');
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - olderThanDays);
    const before = await db.select().from(systemLogs).where(ltOp(systemLogs.createdAt, cutoff));
    await db.delete(systemLogs).where(ltOp(systemLogs.createdAt, cutoff));
    return before.length;
  }

  // ─── Waste Control ────────────────────────────────────────────
  async getWasteRecords(): Promise<WasteControl[]> {
    return db.select().from(wasteControl).orderBy(desc(wasteControl.createdAt));
  }
  async createWasteRecord(data: InsertWasteControl): Promise<WasteControl> {
    const [rec] = await db.insert(wasteControl).values(data).returning();
    return rec;
  }
  async updateWasteRecord(id: number, data: Partial<InsertWasteControl>): Promise<WasteControl> {
    const [rec] = await db.update(wasteControl).set(data).where(eq(wasteControl.id, id)).returning();
    return rec;
  }
  async deleteWasteRecord(id: number): Promise<void> {
    await db.delete(wasteControl).where(eq(wasteControl.id, id));
  }

  // ─── Purchase Plan Status ─────────────────────────────────────
  async getPurchasePlanStatuses(weekRef: string): Promise<PurchasePlanStatus[]> {
    return db.select().from(purchasePlanStatus).where(eq(purchasePlanStatus.weekRef, weekRef)).orderBy(purchasePlanStatus.productName);
  }
  async upsertPurchasePlanStatus(data: Partial<InsertPurchasePlanStatus> & { weekRef: string; productName: string }): Promise<PurchasePlanStatus> {
    const existing = await db.select().from(purchasePlanStatus)
      .where(and(eq(purchasePlanStatus.weekRef, data.weekRef), eq(purchasePlanStatus.productName, data.productName)));
    if (existing.length > 0) {
      const [rec] = await db.update(purchasePlanStatus)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(purchasePlanStatus.id, existing[0].id))
        .returning();
      return rec;
    }
    const [rec] = await db.insert(purchasePlanStatus).values({ ...data, updatedAt: new Date() } as any).returning();
    return rec;
  }
  async deletePurchasePlanStatus(id: number): Promise<void> {
    await db.delete(purchasePlanStatus).where(eq(purchasePlanStatus.id, id));
  }

  // ─── Inventory Settings ───────────────────────────────────────
  // Every method below funnels its WHERE clause through `tenantAnd(...)` and
  // every INSERT through `withTenant(table, ...)` so cross-tenant access is
  // impossible by construction. Cross-tenant admins (no tenant pinned) may
  // still read all rows — `tenantAnd` returns the current-tenant predicate
  // which throws if no context is installed; `getCurrentTenantOrSkip()` is
  // the explicit opt-out for legitimately cross-tenant background jobs.
  async getInventorySettings(): Promise<InventorySettings[]> {
    return db.select().from(inventorySettings).where(tenantWhere(inventorySettings)).orderBy(inventorySettings.productName);
  }
  /**
   * Direct-by-id lookup. Tenant-scoped to mirror the rest of the
   * inventory_settings query surface — `(await getInventorySettings()).find`
   * was implicitly tenant-scoped because `getInventorySettings()` itself is.
   */
  async getInventorySettingById(id: number): Promise<InventorySettings | undefined> {
    const [r] = await db.select().from(inventorySettings).where(tenantAnd(inventorySettings, eq(inventorySettings.id, id)));
    return r;
  }
  async getInventorySettingByProductId(productId: number): Promise<InventorySettings | undefined> {
    const [r] = await db.select().from(inventorySettings).where(tenantAnd(inventorySettings, eq(inventorySettings.productId, productId)));
    return r;
  }
  async getInventorySettingByProductName(productName: string): Promise<InventorySettings | undefined> {
    const [r] = await db.select().from(inventorySettings).where(tenantAnd(inventorySettings, eq(inventorySettings.productName, productName)));
    return r;
  }
  async upsertInventorySetting(data: InsertInventorySettings): Promise<InventorySettings> {
    if (data.productId) {
      const existing = await this.getInventorySettingByProductId(data.productId);
      if (existing) {
        const [r] = await db.update(inventorySettings).set({ ...stripTenantFields(data as any), updatedAt: new Date() }).where(tenantAnd(inventorySettings, eq(inventorySettings.id, existing.id))).returning();
        return r;
      }
    }
    const [r] = await db.insert(inventorySettings).values(withTenant(inventorySettings, { ...data, updatedAt: new Date() } as any)).returning();
    return r;
  }
  async updateInventoryStock(id: number, currentStock: number): Promise<InventorySettings> {
    const [r] = await db.update(inventorySettings).set({ currentStock: String(currentStock), updatedAt: new Date() }).where(tenantAnd(inventorySettings, eq(inventorySettings.id, id))).returning();
    return r;
  }

  // ─── Inventory Entries ────────────────────────────────────────
  async getInventoryEntries(filters?: { from?: string; to?: string }): Promise<InventoryEntry[]> {
    const conds = [];
    if (filters?.from) conds.push(gte(inventoryEntries.entryDate, filters.from));
    if (filters?.to) conds.push(lte(inventoryEntries.entryDate, filters.to));
    return db.select().from(inventoryEntries).where(tenantAnd(inventoryEntries, ...conds)).orderBy(desc(inventoryEntries.createdAt));
  }
  async createInventoryEntry(data: InsertInventoryEntry): Promise<InventoryEntry> {
    const [r] = await db.insert(inventoryEntries).values(withTenant(inventoryEntries, data as any)).returning();
    return r;
  }
  async deleteInventoryEntry(id: number): Promise<void> {
    await db.delete(inventoryEntries).where(tenantAnd(inventoryEntries, eq(inventoryEntries.id, id)));
  }

  // ─── Inventory Movements ─────────────────────────────────────
  async getInventoryMovements(filters?: { from?: string; to?: string; productId?: number }): Promise<InventoryMovement[]> {
    const conds = [];
    if (filters?.from) conds.push(gte(inventoryMovements.date, filters.from));
    if (filters?.to) conds.push(lte(inventoryMovements.date, filters.to));
    if (filters?.productId) conds.push(eq(inventoryMovements.productId, filters.productId));
    return db.select().from(inventoryMovements).where(tenantAnd(inventoryMovements, ...conds)).orderBy(desc(inventoryMovements.createdAt));
  }
  async createInventoryMovement(data: InsertInventoryMovement): Promise<InventoryMovement> {
    const [r] = await db.insert(inventoryMovements).values(withTenant(inventoryMovements, data as any)).returning();
    return r;
  }

  // ─── Inventory Physical Counts ────────────────────────────────
  async getInventoryPhysicalCounts(): Promise<InventoryPhysicalCount[]> {
    return db.select().from(inventoryPhysicalCounts).where(tenantWhere(inventoryPhysicalCounts)).orderBy(desc(inventoryPhysicalCounts.createdAt));
  }
  async createInventoryPhysicalCount(data: InsertInventoryPhysicalCount): Promise<InventoryPhysicalCount> {
    const [r] = await db.insert(inventoryPhysicalCounts).values(withTenant(inventoryPhysicalCounts, data as any)).returning();
    return r;
  }

  // ─── Fiscal Invoices ─────────────────────────────────────────────────────
  async getFiscalInvoices(): Promise<FiscalInvoice[]> {
    return db.select().from(fiscalInvoices).orderBy(desc(fiscalInvoices.importedAt));
  }
  async getFiscalInvoiceById(id: number): Promise<FiscalInvoice | undefined> {
    const [r] = await db.select().from(fiscalInvoices).where(eq(fiscalInvoices.id, id));
    return r;
  }
  async createFiscalInvoice(data: InsertFiscalInvoice): Promise<FiscalInvoice> {
    const [r] = await db.insert(fiscalInvoices).values(data as any).returning();
    return r;
  }
  async deleteFiscalInvoice(id: number): Promise<void> {
    await db.delete(fiscalInvoices).where(eq(fiscalInvoices.id, id));
  }
  async checkFiscalInvoiceDuplicate(invoiceNumber: string, cnpj?: string): Promise<boolean> {
    const key = `${invoiceNumber}_${cnpj || ''}`;
    const [r] = await db.select().from(fiscalInvoices).where(eq(fiscalInvoices.duplicateKey, key));
    return !!r;
  }

  // ─── Email Schedules ─────────────────────────────────────────────────────
  async getEmailSchedules(): Promise<EmailSchedule[]> {
    return db.select().from(emailSchedules).orderBy(emailSchedules.dayOfWeek, emailSchedules.timeOfDay);
  }
  async getEmailScheduleById(id: number): Promise<EmailSchedule | undefined> {
    const [r] = await db.select().from(emailSchedules).where(eq(emailSchedules.id, id));
    return r;
  }
  async createEmailSchedule(data: InsertEmailSchedule): Promise<EmailSchedule> {
    const [r] = await db.insert(emailSchedules).values(data).returning();
    return r;
  }
  async updateEmailSchedule(id: number, data: Partial<InsertEmailSchedule>): Promise<EmailSchedule> {
    const [r] = await db.update(emailSchedules).set({ ...data, updatedAt: new Date() }).where(eq(emailSchedules.id, id)).returning();
    return r;
  }
  async deleteEmailSchedule(id: number): Promise<void> {
    await db.delete(emailSchedules).where(eq(emailSchedules.id, id));
  }

  // ─── Email Logs ───────────────────────────────────────────────────────────
  async getEmailLogs(opts?: { limit?: number; type?: string; companyId?: number }): Promise<EmailLog[]> {
    let query = db.select().from(emailLogs) as any;
    const conditions: any[] = [];
    if (opts?.type) conditions.push(eq(emailLogs.type, opts.type));
    if (opts?.companyId) conditions.push(eq(emailLogs.companyId, opts.companyId));
    if (conditions.length) query = query.where(and(...conditions));
    query = query.orderBy(desc(emailLogs.sentAt));
    if (opts?.limit) query = query.limit(opts.limit);
    return query;
  }
  async createEmailLog(data: InsertEmailLog): Promise<EmailLog> {
    const [r] = await db.insert(emailLogs).values(data as any).returning();
    return r;
  }
  async wasEmailSentToday(type: string, toEmail: string): Promise<boolean> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const [r] = await db.select()
      .from(emailLogs)
      .where(and(
        eq(emailLogs.type, type),
        eq(emailLogs.toEmail, toEmail),
        eq(emailLogs.status, 'sent'),
        gte(emailLogs.sentAt, startOfDay)
      ));
    return !!r;
  }

  async wasEmailSentThisMonth(type: string, toEmail: string): Promise<boolean> {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const [r] = await db.select()
      .from(emailLogs)
      .where(and(
        eq(emailLogs.type, type),
        eq(emailLogs.toEmail, toEmail),
        eq(emailLogs.status, 'sent'),
        gte(emailLogs.sentAt, startOfMonth)
      ));
    return !!r;
  }

  // ─── About Us (Quem Somos Nós) ────────────────────────────────────────────
  async getAboutUs(): Promise<AboutUs | undefined> {
    const [r] = await db.select().from(aboutUs).limit(1);
    return r;
  }
  async upsertAboutUs(data: Partial<InsertAboutUs>): Promise<AboutUs> {
    const existing = await this.getAboutUs();
    if (existing) {
      const [r] = await db.update(aboutUs)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(aboutUs.id, existing.id))
        .returning();
      return r;
    } else {
      const [r] = await db.insert(aboutUs).values({ ...data } as InsertAboutUs).returning();
      return r;
    }
  }

  // ─── SMTP Config ──────────────────────────────────────────────────────────
  async getSmtpConfig(): Promise<SmtpConfig | undefined> {
    const [r] = await db.select().from(smtpConfig).limit(1);
    return r;
  }
  async upsertSmtpConfig(data: Partial<InsertSmtpConfig>): Promise<SmtpConfig> {
    const existing = await this.getSmtpConfig();
    if (existing) {
      const [r] = await db.update(smtpConfig)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(smtpConfig.id, existing.id))
        .returning();
      return r;
    } else {
      const [r] = await db.insert(smtpConfig).values({ ...data } as InsertSmtpConfig).returning();
      return r;
    }
  }

  async getClaraTrainings(): Promise<ClaraTraining[]> {
    return db.select().from(claraTraining).orderBy(desc(claraTraining.createdAt));
  }
  async createClaraTraining(data: InsertClaraTraining): Promise<ClaraTraining> {
    const [r] = await db.insert(claraTraining).values(data).returning();
    return r;
  }
  async updateClaraTraining(id: number, data: Partial<InsertClaraTraining>): Promise<ClaraTraining> {
    const [r] = await db.update(claraTraining).set({ ...data, updatedAt: new Date() }).where(eq(claraTraining.id, id)).returning();
    return r;
  }
  async deleteClaraTraining(id: number): Promise<void> {
    await db.delete(claraTraining).where(eq(claraTraining.id, id));
  }

  // ─── Push Subscriptions ──────────────────────────────────────────────────
  async upsertPushSubscription(data: InsertPushSubscription): Promise<PushSubscription> {
    const existing = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, data.endpoint))
      .limit(1);
    if (existing.length > 0) {
      const [r] = await db
        .update(pushSubscriptions)
        .set({ ...data, active: true })
        .where(eq(pushSubscriptions.endpoint, data.endpoint))
        .returning();
      return r;
    }
    const [r] = await db.insert(pushSubscriptions).values(data).returning();
    return r;
  }
  async deactivatePushSubscription(endpoint: string): Promise<void> {
    await db
      .update(pushSubscriptions)
      .set({ active: false })
      .where(eq(pushSubscriptions.endpoint, endpoint));
  }
  async getActivePushSubscriptions(): Promise<PushSubscription[]> {
    return db.select().from(pushSubscriptions).where(eq(pushSubscriptions.active, true));
  }
  async getPushSubscriptionCount(): Promise<number> {
    const rows = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.active, true));
    return rows.length;
  }

  // ─── Notification Settings ────────────────────────────────────────────────
  async getNotificationSettings(): Promise<NotificationSetting[]> {
    return db.select().from(notificationSettings).orderBy(notificationSettings.event);
  }
  async upsertNotificationSetting(event: string, data: Partial<InsertNotificationSetting>): Promise<NotificationSetting> {
    const existing = await db
      .select()
      .from(notificationSettings)
      .where(eq(notificationSettings.event, event))
      .limit(1);
    if (existing.length > 0) {
      const [r] = await db
        .update(notificationSettings)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(notificationSettings.event, event))
        .returning();
      return r;
    }
    const [r] = await db
      .insert(notificationSettings)
      .values({ event, ...data } as InsertNotificationSetting)
      .returning();
    return r;
  }

  // ─── Scope Simulations ────────────────────────────────────────────────────
  async getScopeSimulations(): Promise<ScopeSimulation[]> {
    return db.select().from(scopeSimulations).orderBy(desc(scopeSimulations.updatedAt));
  }
  async getScopeSimulation(id: number): Promise<ScopeSimulation | undefined> {
    const [r] = await db.select().from(scopeSimulations).where(eq(scopeSimulations.id, id));
    return r;
  }
  async createScopeSimulation(data: InsertScopeSimulation): Promise<ScopeSimulation> {
    const [r] = await db.insert(scopeSimulations).values(data).returning();
    return r;
  }
  async updateScopeSimulation(id: number, data: Partial<InsertScopeSimulation>): Promise<ScopeSimulation> {
    const [r] = await db
      .update(scopeSimulations)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(scopeSimulations.id, id))
      .returning();
    return r;
  }
  async deleteScopeSimulation(id: number): Promise<void> {
    await db.delete(scopeSimulations).where(eq(scopeSimulations.id, id));
  }

  // ─── Financial Module ──────────────────────────────────────────────────────

  async getAccountsReceivable(filters?: { status?: string; companyId?: number }): Promise<AccountReceivable[]> {
    let q = db.select().from(accountsReceivable);
    const conditions = [];
    if (filters?.status && filters.status !== 'todos') conditions.push(eq(accountsReceivable.status, filters.status));
    if (filters?.companyId) conditions.push(eq(accountsReceivable.companyId, filters.companyId));
    if (conditions.length > 0) q = (q as any).where(and(...conditions));
    return q.orderBy(desc(accountsReceivable.dataVencimento));
  }

  async getAccountReceivable(id: number): Promise<AccountReceivable | undefined> {
    const [r] = await db.select().from(accountsReceivable).where(eq(accountsReceivable.id, id));
    return r;
  }

  async createAccountReceivable(data: InsertAccountReceivable): Promise<AccountReceivable> {
    const [r] = await db.insert(accountsReceivable).values(data).returning();
    return r;
  }

  async updateAccountReceivable(id: number, data: Partial<InsertAccountReceivable>): Promise<AccountReceivable> {
    const [r] = await db.update(accountsReceivable).set(data).where(eq(accountsReceivable.id, id)).returning();
    return r;
  }

  /**
   * @deprecated ⚠️ NÃO USAR
   * Use financeService.payAccountReceivable (tenant-safe + idempotência + hook FIN.3)
   */
  async payAccountReceivable(id: number): Promise<AccountReceivable> {
    const [r] = await db
      .update(accountsReceivable)
      .set({ status: 'pago', pagoEm: new Date() })
      .where(eq(accountsReceivable.id, id))
      .returning();
    const today = new Date().toISOString().split('T')[0];
    await db.insert(financialTransactions).values({
      tipo: 'entrada',
      valor: r.valor,
      descricao: `Recebimento: ${r.descricao}`,
      data: today,
      referenciaTipo: 'receivable',
      referenciaId: id,
    });
    return r;
  }

  async deleteAccountReceivable(id: number): Promise<void> {
    await db.update(accountsReceivable).set({ status: 'cancelado' }).where(eq(accountsReceivable.id, id));
  }

  async getAccountsPayable(filters?: { status?: string }): Promise<AccountPayable[]> {
    let q = db.select().from(accountsPayable);
    if (filters?.status && filters.status !== 'todos') {
      q = (q as any).where(eq(accountsPayable.status, filters.status));
    }
    return q.orderBy(desc(accountsPayable.dataVencimento));
  }

  async getAccountPayable(id: number): Promise<AccountPayable | undefined> {
    const [r] = await db.select().from(accountsPayable).where(eq(accountsPayable.id, id));
    return r;
  }

  async createAccountPayable(data: InsertAccountPayable): Promise<AccountPayable> {
    const [r] = await db.insert(accountsPayable).values(data).returning();
    return r;
  }

  async updateAccountPayable(id: number, data: Partial<InsertAccountPayable>): Promise<AccountPayable> {
    const [r] = await db.update(accountsPayable).set(data).where(eq(accountsPayable.id, id)).returning();
    return r;
  }

  /**
   * @deprecated ⚠️ NÃO USAR
   * Use financeService.payAccountPayable (tenant-safe + regras)
   */
  async payAccountPayable(id: number): Promise<AccountPayable> {
    const [r] = await db
      .update(accountsPayable)
      .set({ status: 'pago', pagoEm: new Date() })
      .where(eq(accountsPayable.id, id))
      .returning();
    const today = new Date().toISOString().split('T')[0];
    await db.insert(financialTransactions).values({
      tipo: 'saida',
      valor: r.valor,
      descricao: `Pagamento: ${r.descricao} (${r.fornecedor})`,
      data: today,
      referenciaTipo: 'payable',
      referenciaId: id,
    });
    return r;
  }

  async deleteAccountPayable(id: number): Promise<void> {
    await db.update(accountsPayable).set({ status: 'cancelado' }).where(eq(accountsPayable.id, id));
  }

  async getFinancialTransactions(filters?: { from?: string; to?: string }): Promise<FinancialTransaction[]> {
    let q = db.select().from(financialTransactions);
    const conditions = [];
    if (filters?.from) conditions.push(gte(financialTransactions.data, filters.from));
    if (filters?.to) conditions.push(lte(financialTransactions.data, filters.to));
    if (conditions.length > 0) q = (q as any).where(and(...conditions));
    return q.orderBy(desc(financialTransactions.data));
  }

  async createFinancialTransaction(data: InsertFinancialTransaction): Promise<FinancialTransaction> {
    const [r] = await db.insert(financialTransactions).values(data).returning();
    return r;
  }

  /**
   * @deprecated ⚠️ NÃO USAR
   * Use financeRepository.getAccountReceivableByOrderId (tenant-safe)
   */
  async getAccountReceivableByOrderId(orderId: number): Promise<AccountReceivable | undefined> {
    const [r] = await db.select().from(accountsReceivable).where(eq(accountsReceivable.orderId, orderId));
    return r;
  }

  // BANCO.5 — Histórico de importações de retorno CNAB
  async createCnabImportHistory(data: InsertCnabImportHistory): Promise<CnabImportHistory> {
    const [r] = await db.insert(cnabImportHistory).values(data).returning();
    return r;
  }

  /**
   * @deprecated ⚠️ NÃO USAR DIRETAMENTE
   * Use `financeRepository.listCnabImportHistory` (FASE 5) que já aplica
   * `tenantWhere(cnabImportHistory)`. Mantido apenas por compat de IStorage.
   *
   * FASE 1 — defense-in-depth: bloqueia chamada sem TenantContext.
   * Filtra por `companyId` (única coluna tenant-ish da tabela; o `empresa_id`
   * não existe — vide schema). Registros legados sem companyId são excluídos
   * intencionalmente para isolar empresas.
   */
  async listCnabImportHistory(limit = 20): Promise<CnabImportHistory[]> {
    const tenantId = requireTenantId();
    return db
      .select()
      .from(cnabImportHistory)
      .where(eq(cnabImportHistory.companyId, tenantId))
      .orderBy(desc(cnabImportHistory.createdAt))
      .limit(limit);
  }

  async findCnabByHash(hash: string): Promise<CnabImportHistory | undefined> {
    const [r] = await db
      .select()
      .from(cnabImportHistory)
      .where(eq(cnabImportHistory.fileHash, hash))
      .limit(1);
    return r;
  }

  async getFinancialDashboard(): Promise<{
    totalReceivable: number;
    totalPayable: number;
    vencidosAR: number;
    vencidosAP: number;
    recebidoMes: number;
    pagoMes: number;
    balanceMes: number;
  }> {
    // FASE 1 — bloqueia vazamento entre tenants. Todas as 6 queries abaixo
    // agora exigem tenant pinned e adicionam `WHERE empresa_id = tenantId`
    // (coluna mapeada como `tenantId` em accountsReceivable / accountsPayable
    // / financialTransactions). Estrutura/tipo de retorno preservados.
    const tenantId = requireTenantId();
    const today = new Date().toISOString().split('T')[0];
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

    const [arTotal] = await db
      .select({ sum: sql<string>`coalesce(sum(valor::numeric), 0)` })
      .from(accountsReceivable)
      .where(and(eq(accountsReceivable.status, 'pendente'), eq(accountsReceivable.tenantId, tenantId)));

    const [apTotal] = await db
      .select({ sum: sql<string>`coalesce(sum(valor::numeric), 0)` })
      .from(accountsPayable)
      .where(and(eq(accountsPayable.status, 'pendente'), eq(accountsPayable.tenantId, tenantId)));

    const [arVencidos] = await db
      .select({ sum: sql<string>`coalesce(sum(valor::numeric), 0)` })
      .from(accountsReceivable)
      .where(and(eq(accountsReceivable.status, 'pendente'), lte(accountsReceivable.dataVencimento, today), eq(accountsReceivable.tenantId, tenantId)));

    const [apVencidos] = await db
      .select({ sum: sql<string>`coalesce(sum(valor::numeric), 0)` })
      .from(accountsPayable)
      .where(and(eq(accountsPayable.status, 'pendente'), lte(accountsPayable.dataVencimento, today), eq(accountsPayable.tenantId, tenantId)));

    const [entradas] = await db
      .select({ sum: sql<string>`coalesce(sum(valor::numeric), 0)` })
      .from(financialTransactions)
      .where(and(eq(financialTransactions.tipo, 'entrada'), gte(financialTransactions.data, monthStart), eq(financialTransactions.tenantId, tenantId)));

    const [saidas] = await db
      .select({ sum: sql<string>`coalesce(sum(valor::numeric), 0)` })
      .from(financialTransactions)
      .where(and(eq(financialTransactions.tipo, 'saida'), gte(financialTransactions.data, monthStart), eq(financialTransactions.tenantId, tenantId)));

    const recebidoMes = parseFloat(entradas.sum);
    const pagoMes = parseFloat(saidas.sum);

    return {
      totalReceivable: parseFloat(arTotal.sum),
      totalPayable: parseFloat(apTotal.sum),
      vencidosAR: parseFloat(arVencidos.sum),
      vencidosAP: parseFloat(apVencidos.sum),
      recebidoMes,
      pagoMes,
      balanceMes: recebidoMes - pagoMes,
    };
  }

  // ─── NF-e Emissões ──────────────────────────────────────────────────────────
  async getNfeEmissoes(filters?: { orderId?: number; status?: string }): Promise<NfeEmissao[]> {
    const conds: any[] = [];
    if (filters?.orderId) conds.push(eq(nfeEmissoes.orderId, filters.orderId));
    if (filters?.status && filters.status !== 'todos') conds.push(eq(nfeEmissoes.status, filters.status));
    return db.select().from(nfeEmissoes).where(conds.length ? and(...conds) : undefined).orderBy(desc(nfeEmissoes.createdAt));
  }

  async getNfeEmissao(id: number): Promise<NfeEmissao | undefined> {
    const [r] = await db.select().from(nfeEmissoes).where(eq(nfeEmissoes.id, id));
    return r;
  }

  async getNfeEmissaoByOrderId(orderId: number): Promise<NfeEmissao | undefined> {
    const [r] = await db.select().from(nfeEmissoes).where(eq(nfeEmissoes.orderId, orderId)).orderBy(desc(nfeEmissoes.createdAt));
    return r;
  }

  async createNfeEmissao(data: InsertNfeEmissao): Promise<NfeEmissao> {
    const [r] = await db.insert(nfeEmissoes).values(data).returning();
    return r;
  }

  async updateNfeEmissao(id: number, data: Partial<InsertNfeEmissao>): Promise<NfeEmissao> {
    const [r] = await db.update(nfeEmissoes).set(data).where(eq(nfeEmissoes.id, id)).returning();
    return r;
  }

  async getNextNfeNumero(): Promise<number> {
    const [result] = await db.select({ max: sql<string>`coalesce(max(numero::integer), 0)` }).from(nfeEmissoes);
    return parseInt(result.max) + 1;
  }

  // ─── NF-e Training Logs ─────────────────────────────────────────────────────
  async getNfeTrainingLogs(filters: { orderId?: number; limit?: number } = {}): Promise<NfeTrainingLog[]> {
    let rows = await db.select().from(nfeTrainingLogs).orderBy(desc(nfeTrainingLogs.createdAt));
    if (filters.orderId) rows = rows.filter(r => r.orderId === filters.orderId);
    if (filters.limit) rows = rows.slice(0, filters.limit);
    return rows;
  }

  async createNfeTrainingLog(data: InsertNfeTrainingLog): Promise<NfeTrainingLog> {
    const [r] = await db.insert(nfeTrainingLogs).values(data).returning();
    return r;
  }

  async updateNfeTrainingLog(id: number, data: Partial<InsertNfeTrainingLog>): Promise<NfeTrainingLog> {
    const [r] = await db.update(nfeTrainingLogs).set(data as any).where(eq(nfeTrainingLogs.id, id)).returning();
    return r;
  }

  // ─── CC-e (Carta de Correção Eletrônica) — FASE 14.2 ─────────────────────
  async createNfeCce(nfeId: number, correcao: string, createdByUserId: number | null): Promise<NfeCce> {
    const existing = await db.select().from(nfeCce).where(eq(nfeCce.nfeId, nfeId)).orderBy(desc(nfeCce.sequencia));
    const sequencia = existing.length > 0 ? existing[0].sequencia + 1 : 1;
    const [r] = await db.insert(nfeCce).values({ nfeId, sequencia, correcao, createdByUserId }).returning();
    return r;
  }

  async getNfeCceHistory(nfeId: number): Promise<NfeCce[]> {
    return db.select().from(nfeCce).where(eq(nfeCce.nfeId, nfeId)).orderBy(nfeCce.sequencia);
  }

  // ─── AI Logs ────────────────────────────────────────────────────────────────
  // ─── Logistics Audit Logs ─────────────────────────────────────────────────
  async createLogisticsAudit(data: InsertLogisticsAuditLog): Promise<LogisticsAuditLog> {
    const [r] = await db.insert(logisticsAuditLogs).values(data).returning();
    return r;
  }
  async getLogisticsAuditLogs(filters?: { modulo?: string; usuarioId?: number; limit?: number }): Promise<LogisticsAuditLog[]> {
    const conds: any[] = [];
    if (filters?.modulo) conds.push(eq(logisticsAuditLogs.modulo, filters.modulo));
    if (filters?.usuarioId) conds.push(eq(logisticsAuditLogs.usuarioId, filters.usuarioId));
    return db.select().from(logisticsAuditLogs)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(logisticsAuditLogs.dataHora))
      .limit(filters?.limit || 100);
  }

  // ─── Driver GPS Positions ─────────────────────────────────────────────────
  async createGpsPosition(data: InsertDriverGpsPosition): Promise<DriverGpsPosition> {
    const [r] = await db.insert(driverGpsPositions).values(data).returning();
    return r;
  }
  async getLatestGpsPosition(driverId: number): Promise<DriverGpsPosition | undefined> {
    const [r] = await db.select().from(driverGpsPositions)
      .where(eq(driverGpsPositions.driverId, driverId))
      .orderBy(desc(driverGpsPositions.recordedAt))
      .limit(1);
    return r;
  }

  // ─── Delivery Checklists ───────────────────────────────────────────────────
  async createDeliveryChecklist(data: InsertDeliveryChecklist): Promise<DeliveryChecklist> {
    const [r] = await db.insert(deliveryChecklists).values(data).returning();
    return r;
  }
  async getDeliveryChecklist(deliveryId: number): Promise<DeliveryChecklist | undefined> {
    const [r] = await db.select().from(deliveryChecklists)
      .where(eq(deliveryChecklists.deliveryId, deliveryId))
      .orderBy(desc(deliveryChecklists.createdAt))
      .limit(1);
    return r;
  }

  // ─── Route Stops ───────────────────────────────────────────────────────────
  async getRouteStops(routeId: number): Promise<RouteStop[]> {
    return db.select().from(routeStops).where(eq(routeStops.routeId, routeId)).orderBy(routeStops.ordemParada);
  }
  async createRouteStop(data: InsertRouteStop): Promise<RouteStop> {
    const [r] = await db.insert(routeStops).values(data).returning();
    return r;
  }
  async updateRouteStop(id: number, data: Partial<InsertRouteStop>): Promise<RouteStop> {
    const [r] = await db.update(routeStops).set(data).where(eq(routeStops.id, id)).returning();
    return r;
  }
  async deleteRouteStop(id: number): Promise<void> {
    await db.delete(routeStops).where(eq(routeStops.id, id));
  }
  async getRouteStopsByCep(cep: string): Promise<RouteStop[]> {
    const clean = cep.replace(/\D/g, '');
    return db.select().from(routeStops).where(eq(routeStops.cep, clean));
  }

  async getAiLogs(limit = 100): Promise<AiLog[]> {
    return db.select().from(aiLogs).orderBy(desc(aiLogs.createdAt)).limit(limit);
  }

  async createAiLog(data: InsertAiLog): Promise<AiLog> {
    const [r] = await db.insert(aiLogs).values(data).returning();
    return r;
  }

  // ─── Bank Accounts ──────────────────────────────────────────────────────────
  async getBankAccounts(): Promise<BankAccount[]> {
    return db.select().from(bankAccounts).orderBy(desc(bankAccounts.createdAt));
  }

  async getBankAccount(id: number): Promise<BankAccount | undefined> {
    const [r] = await db.select().from(bankAccounts).where(eq(bankAccounts.id, id));
    return r;
  }

  async createBankAccount(data: InsertBankAccount): Promise<BankAccount> {
    const [r] = await db.insert(bankAccounts).values(data).returning();
    return r;
  }

  async updateBankAccount(id: number, data: Partial<InsertBankAccount>): Promise<BankAccount> {
    const [r] = await db.update(bankAccounts).set(data).where(eq(bankAccounts.id, id)).returning();
    return r;
  }

  async deleteBankAccount(id: number): Promise<void> {
    await db.delete(bankAccounts).where(eq(bankAccounts.id, id));
  }

  // ─── Bank Transactions ──────────────────────────────────────────────────────
  async getBankTransactions(filters?: { bankAccountId?: number; status?: string; from?: string; to?: string }): Promise<BankTransaction[]> {
    const conds: any[] = [];
    if (filters?.bankAccountId) conds.push(eq(bankTransactions.bankAccountId, filters.bankAccountId));
    if (filters?.status && filters.status !== 'todos') conds.push(eq(bankTransactions.status, filters.status));
    if (filters?.from) conds.push(gte(bankTransactions.data, filters.from));
    if (filters?.to) conds.push(lte(bankTransactions.data, filters.to));
    return db.select().from(bankTransactions).where(conds.length ? and(...conds) : undefined).orderBy(desc(bankTransactions.data));
  }

  async createBankTransaction(data: InsertBankTransaction): Promise<BankTransaction> {
    const [r] = await db.insert(bankTransactions).values(data).returning();
    return r;
  }

  async updateBankTransaction(id: number, data: Partial<InsertBankTransaction>): Promise<BankTransaction> {
    const [r] = await db.update(bankTransactions).set(data).where(eq(bankTransactions.id, id)).returning();
    return r;
  }

  async upsertBankTransaction(externalId: string, bankAccountId: number, data: InsertBankTransaction): Promise<BankTransaction> {
    const [existing] = await db.select().from(bankTransactions).where(and(eq(bankTransactions.externalId, externalId), eq(bankTransactions.bankAccountId, bankAccountId)));
    if (existing) return existing;
    const [r] = await db.insert(bankTransactions).values(data).returning();
    return r;
  }

  // ─── Company Addresses ───────────────────────────────────────────────────
  async getCompanyAddresses(companyId: number): Promise<CompanyAddress[]> {
    return db.select().from(companyAddresses).where(eq(companyAddresses.companyId, companyId)).orderBy(desc(companyAddresses.isPrimary), desc(companyAddresses.createdAt));
  }

  async createCompanyAddress(data: InsertCompanyAddress): Promise<CompanyAddress> {
    const [r] = await db.insert(companyAddresses).values(data).returning();
    return r;
  }

  async updateCompanyAddress(id: number, data: Partial<InsertCompanyAddress>): Promise<CompanyAddress> {
    const [r] = await db.update(companyAddresses).set(data).where(eq(companyAddresses.id, id)).returning();
    return r;
  }

  async deleteCompanyAddress(id: number): Promise<void> {
    await db.delete(companyAddresses).where(eq(companyAddresses.id, id));
  }

  async setPrimaryAddress(companyId: number, addressId: number): Promise<void> {
    await db.update(companyAddresses).set({ isPrimary: false }).where(eq(companyAddresses.companyId, companyId));
    await db.update(companyAddresses).set({ isPrimary: true }).where(eq(companyAddresses.id, addressId));
  }

  // ─── SaaS: Planos ─────────────────────────────────────────────────────────
  async getPlanos(): Promise<Plano[]> {
    return db.select().from(planos).orderBy(planos.preco);
  }
  async getPlano(id: number): Promise<Plano | undefined> {
    const [r] = await db.select().from(planos).where(eq(planos.id, id));
    return r;
  }
  async createPlano(data: InsertPlano): Promise<Plano> {
    const [r] = await db.insert(planos).values(data).returning();
    return r;
  }
  async updatePlano(id: number, data: Partial<InsertPlano>): Promise<Plano> {
    const [r] = await db.update(planos).set(data).where(eq(planos.id, id)).returning();
    return r;
  }
  async deletePlano(id: number): Promise<void> {
    await db.delete(planos).where(eq(planos.id, id));
  }

  // ─── SaaS: Assinaturas ────────────────────────────────────────────────────
  async getAssinaturas(filters?: { companyId?: number; status?: string }): Promise<Assinatura[]> {
    const conds: any[] = [];
    if (filters?.companyId) conds.push(eq(assinaturas.companyId, filters.companyId));
    if (filters?.status) conds.push(eq(assinaturas.status, filters.status));
    return db.select().from(assinaturas).where(conds.length ? and(...conds) : undefined).orderBy(desc(assinaturas.createdAt));
  }
  async getAssinatura(id: number): Promise<Assinatura | undefined> {
    const [r] = await db.select().from(assinaturas).where(eq(assinaturas.id, id));
    return r;
  }
  async getAssinaturaByCompany(companyId: number): Promise<Assinatura | undefined> {
    const [r] = await db.select().from(assinaturas).where(eq(assinaturas.companyId, companyId)).orderBy(desc(assinaturas.createdAt));
    return r;
  }
  async createAssinatura(data: InsertAssinatura): Promise<Assinatura> {
    const [r] = await db.insert(assinaturas).values(data).returning();
    return r;
  }
  async updateAssinatura(id: number, data: Partial<InsertAssinatura>): Promise<Assinatura> {
    const [r] = await db.update(assinaturas).set({ ...data, updatedAt: new Date() }).where(eq(assinaturas.id, id)).returning();
    return r;
  }

  // ─── SaaS: Billing Events ─────────────────────────────────────────────────
  async getBillingEvents(filters?: { companyId?: number; status?: string }): Promise<BillingEvent[]> {
    const conds: any[] = [];
    if (filters?.companyId) conds.push(eq(billingEvents.companyId, filters.companyId));
    if (filters?.status) conds.push(eq(billingEvents.status, filters.status));
    return db.select().from(billingEvents).where(conds.length ? and(...conds) : undefined).orderBy(desc(billingEvents.createdAt));
  }
  async getBillingEventByGatewayId(gatewayEventId: string): Promise<BillingEvent | undefined> {
    const [r] = await db
      .select()
      .from(billingEvents)
      .where(eq(billingEvents.gatewayEventId, gatewayEventId))
      .limit(1);
    return r;
  }
  async createBillingEvent(data: InsertBillingEvent): Promise<BillingEvent> {
    const [r] = await db.insert(billingEvents).values(data).returning();
    return r;
  }
  async updateBillingEvent(id: number, data: Partial<InsertBillingEvent>): Promise<BillingEvent> {
    const [r] = await db.update(billingEvents).set(data).where(eq(billingEvents.id, id)).returning();
    return r;
  }

  // ─── SaaS: Módulos do Sistema ─────────────────────────────────────────────
  async getModulosSistema(): Promise<ModuloSistema[]> {
    return db.select().from(modulosSistema).orderBy(modulosSistema.categoria, modulosSistema.nomeModulo);
  }
  async getModuloSistema(id: number): Promise<ModuloSistema | undefined> {
    const [r] = await db.select().from(modulosSistema).where(eq(modulosSistema.id, id));
    return r;
  }
  async createModuloSistema(data: InsertModuloSistema): Promise<ModuloSistema> {
    const [r] = await db.insert(modulosSistema).values(data).returning();
    return r;
  }
  async updateModuloSistema(id: number, data: Partial<InsertModuloSistema>): Promise<ModuloSistema> {
    const [r] = await db.update(modulosSistema).set(data).where(eq(modulosSistema.id, id)).returning();
    return r;
  }
  async deleteModuloSistema(id: number): Promise<void> {
    await db.delete(planoModulos).where(eq(planoModulos.moduloId, id));
    await db.delete(modulosSistema).where(eq(modulosSistema.id, id));
  }

  // ─── SaaS: Plano × Módulos ────────────────────────────────────────────────
  async getModulosByPlano(planoId: number): Promise<ModuloSistema[]> {
    const rows = await db
      .select({ modulo: modulosSistema })
      .from(planoModulos)
      .innerJoin(modulosSistema, eq(planoModulos.moduloId, modulosSistema.id))
      .where(eq(planoModulos.planoId, planoId));
    return rows.map(r => r.modulo);
  }
  async setModulosForPlano(planoId: number, moduloIds: number[]): Promise<void> {
    await db.delete(planoModulos).where(eq(planoModulos.planoId, planoId));
    if (moduloIds.length > 0) {
      await db.insert(planoModulos).values(moduloIds.map(moduloId => ({ planoId, moduloId })));
    }
  }
  async getPlanoModulos(planoId: number): Promise<PlanoModulo[]> {
    return db.select().from(planoModulos).where(eq(planoModulos.planoId, planoId));
  }
  async getModuloChavesByCompany(companyId: number): Promise<string[]> {
    const assinatura = await this.getAssinaturaByCompany(companyId);
    if (!assinatura?.planoId) return [];
    const modulos = await this.getModulosByPlano(assinatura.planoId);
    return modulos.filter(m => m.ativo).map(m => m.chave);
  }

  // ─── Deliveries ────────────────────────────────────────────────────────────
  async getDeliveries(filters?: { companyId?: number; driverId?: number; routeId?: number; status?: string; date?: string }): Promise<Delivery[]> {
    const conds: any[] = [];
    if (filters?.companyId) conds.push(eq(deliveries.companyId, filters.companyId));
    if (filters?.driverId) conds.push(eq(deliveries.driverId, filters.driverId));
    if (filters?.routeId) conds.push(eq(deliveries.routeId, filters.routeId));
    if (filters?.status) conds.push(eq(deliveries.status, filters.status));
    if (filters?.date) conds.push(eq(deliveries.scheduledDate, filters.date));
    return db.select().from(deliveries).where(conds.length ? and(...conds) : undefined).orderBy(desc(deliveries.createdAt));
  }
  async getDelivery(id: number): Promise<Delivery | undefined> {
    const [r] = await db.select().from(deliveries).where(eq(deliveries.id, id));
    return r;
  }
  async getDeliveryByOrder(orderId: number): Promise<Delivery | undefined> {
    const [r] = await db.select().from(deliveries).where(eq(deliveries.orderId, orderId));
    return r;
  }
  async createDelivery(data: InsertDelivery): Promise<Delivery> {
    const [r] = await db.insert(deliveries).values(data).returning();
    return r;
  }
  async updateDelivery(id: number, data: Partial<InsertDelivery>): Promise<Delivery> {
    const [r] = await db.update(deliveries).set({ ...data, updatedAt: new Date() }).where(eq(deliveries.id, id)).returning();
    return r;
  }
  async deleteDelivery(id: number): Promise<void> {
    await db.delete(deliveries).where(eq(deliveries.id, id));
  }

  // ─── SaaS: Bancos de Recebimento ──────────────────────────────────────────
  async getBancosRecebimento(): Promise<BancoRecebimento[]> {
    return db.select().from(bancosRecebimento).orderBy(desc(bancosRecebimento.createdAt));
  }
  async getBancoRecebimento(id: number): Promise<BancoRecebimento | undefined> {
    const [r] = await db.select().from(bancosRecebimento).where(eq(bancosRecebimento.id, id));
    return r;
  }
  async createBancoRecebimento(data: InsertBancoRecebimento): Promise<BancoRecebimento> {
    const [r] = await db.insert(bancosRecebimento).values(data).returning();
    return r;
  }
  async updateBancoRecebimento(id: number, data: Partial<InsertBancoRecebimento>): Promise<BancoRecebimento> {
    const [r] = await db.update(bancosRecebimento).set(data).where(eq(bancosRecebimento.id, id)).returning();
    return r;
  }
  async deleteBancoRecebimento(id: number): Promise<void> {
    await db.delete(bancosRecebimento).where(eq(bancosRecebimento.id, id));
  }

  // ─── SaaS: Contratos de Clientes ──────────────────────────────────────────
  async getContratosClientes(filters?: { empresaId?: number; status?: string }): Promise<ContratoCliente[]> {
    const conds: any[] = [];
    if (filters?.empresaId) conds.push(eq(contratosClientes.empresaId, filters.empresaId));
    if (filters?.status) conds.push(eq(contratosClientes.status, filters.status));
    return db.select().from(contratosClientes).where(conds.length ? and(...conds) : undefined).orderBy(desc(contratosClientes.createdAt));
  }
  async getContratoCliente(id: number): Promise<ContratoCliente | undefined> {
    const [r] = await db.select().from(contratosClientes).where(eq(contratosClientes.id, id));
    return r;
  }
  async createContratoCliente(data: InsertContratoCliente): Promise<ContratoCliente> {
    const [r] = await db.insert(contratosClientes).values(data).returning();
    return r;
  }
  async updateContratoCliente(id: number, data: Partial<InsertContratoCliente>): Promise<ContratoCliente> {
    const [r] = await db.update(contratosClientes).set({ ...data, updatedAt: new Date() }).where(eq(contratosClientes.id, id)).returning();
    return r;
  }
  async deleteContratoCliente(id: number): Promise<void> {
    await db.delete(contratosClientes).where(eq(contratosClientes.id, id));
  }

  // ─── SaaS: Faturas SaaS ───────────────────────────────────────────────────
  async getFaturasSaas(filters?: { empresaId?: number; status?: string }): Promise<FaturaSaas[]> {
    const conds: any[] = [];
    if (filters?.empresaId) conds.push(eq(faturasSaas.empresaId, filters.empresaId));
    if (filters?.status) conds.push(eq(faturasSaas.status, filters.status));
    return db.select().from(faturasSaas).where(conds.length ? and(...conds) : undefined).orderBy(desc(faturasSaas.createdAt));
  }
  async getFaturaSaas(id: number): Promise<FaturaSaas | undefined> {
    const [r] = await db.select().from(faturasSaas).where(eq(faturasSaas.id, id));
    return r;
  }
  async createFaturaSaas(data: InsertFaturaSaas): Promise<FaturaSaas> {
    const [r] = await db.insert(faturasSaas).values(data).returning();
    return r;
  }
  async updateFaturaSaas(id: number, data: Partial<InsertFaturaSaas>): Promise<FaturaSaas> {
    const [r] = await db.update(faturasSaas).set(data).where(eq(faturasSaas.id, id)).returning();
    return r;
  }
  async deleteFaturaSaas(id: number): Promise<void> {
    await db.delete(faturasSaas).where(eq(faturasSaas.id, id));
  }

  // ─── Versões do Sistema ────────────────────────────────────────────────────
  async getSystemVersions(): Promise<SystemVersion[]> {
    return db.select().from(systemVersions).orderBy(desc(systemVersions.dataLancamento));
  }
  async getSystemVersion(id: number): Promise<SystemVersion | undefined> {
    const [r] = await db.select().from(systemVersions).where(eq(systemVersions.id, id));
    return r;
  }
  async getActiveSystemVersion(): Promise<SystemVersion | undefined> {
    const [r] = await db.select().from(systemVersions)
      .where(and(eq(systemVersions.status, 'ativa'), eq(systemVersions.tipoVersao, 'stable')))
      .orderBy(desc(systemVersions.dataLancamento))
      .limit(1);
    return r;
  }
  async createSystemVersion(data: InsertSystemVersion): Promise<SystemVersion> {
    const [r] = await db.insert(systemVersions).values(data).returning();
    return r;
  }
  async updateSystemVersion(id: number, data: Partial<InsertSystemVersion>): Promise<SystemVersion> {
    const [r] = await db.update(systemVersions).set(data).where(eq(systemVersions.id, id)).returning();
    return r;
  }
  async deleteSystemVersion(id: number): Promise<void> {
    await db.delete(systemVersions).where(eq(systemVersions.id, id));
  }

  // ─── Atualizações do Sistema ───────────────────────────────────────────────
  async getSystemUpdates(filters?: { versionId?: number; empresaId?: number; status?: string }): Promise<SystemUpdate[]> {
    const conds: any[] = [];
    if (filters?.versionId) conds.push(eq(systemUpdates.versionId, filters.versionId));
    if (filters?.empresaId) conds.push(eq(systemUpdates.empresaId, filters.empresaId));
    if (filters?.status) conds.push(eq(systemUpdates.status, filters.status));
    return db.select().from(systemUpdates).where(conds.length ? and(...conds) : undefined).orderBy(desc(systemUpdates.dataAplicacao));
  }
  async createSystemUpdate(data: InsertSystemUpdate): Promise<SystemUpdate> {
    const [r] = await db.insert(systemUpdates).values(data).returning();
    return r;
  }
  async updateSystemUpdate(id: number, data: Partial<InsertSystemUpdate>): Promise<SystemUpdate> {
    const [r] = await db.update(systemUpdates).set(data).where(eq(systemUpdates.id, id)).returning();
    return r;
  }

  // ─── Logs de Atualização ──────────────────────────────────────────────────
  async getUpdateLogs(filters?: { empresaId?: number }): Promise<UpdateLog[]> {
    const conds: any[] = [];
    if (filters?.empresaId) conds.push(eq(updateLogs.empresaId, filters.empresaId));
    return db.select().from(updateLogs).where(conds.length ? and(...conds) : undefined).orderBy(desc(updateLogs.dataAtualizacao));
  }
  async createUpdateLog(data: InsertUpdateLog): Promise<UpdateLog> {
    const [r] = await db.insert(updateLogs).values(data).returning();
    return r;
  }

  // ─── SaaS Métricas ────────────────────────────────────────────────────────
  async getSaasMetrics(periodo?: string): Promise<SaasMetrics | undefined> {
    const p = periodo ?? new Date().toISOString().slice(0, 7);
    const [r] = await db.select().from(saasMetrics).where(eq(saasMetrics.periodo, p)).limit(1);
    return r;
  }

  async computeAndSaveSaasMetrics(): Promise<SaasMetrics> {
    const periodo = new Date().toISOString().slice(0, 7);
    const [cEmp] = await db.select({ count: sql<number>`count(*)::int` }).from(companies).where(eq(companies.active, true));
    const [cAss] = await db.select({ count: sql<number>`count(*)::int` }).from(assinaturas).where(eq(assinaturas.status, 'ativa'));
    const [cTrial] = await db.select({ count: sql<number>`count(*)::int` }).from(assinaturas).where(eq(assinaturas.status, 'trial'));
    const [cPlan] = await db.select({ count: sql<number>`count(*)::int` }).from(planos).where(eq(planos.ativo, true));
    const [cUsers] = await db.select({ count: sql<number>`count(*)::int` }).from(users).where(eq(users.active, true));
    const [cOrders] = await db.select({ count: sql<number>`count(*)::int` }).from(orders);
    const [mrr] = await db.select({ total: sql<string>`coalesce(sum(valor::numeric), 0)::text` })
      .from(assinaturas).where(eq(assinaturas.status, 'ativa'));
    const mrrVal = parseFloat(mrr?.total ?? '0');
    const values = {
      periodo,
      empresasAtivas: cEmp?.count ?? 0,
      assinaturasAtivas: cAss?.count ?? 0,
      faturamentoMensal: mrrVal.toFixed(2),
      faturamentoAnual: (mrrVal * 12).toFixed(2),
      planosAtivos: cPlan?.count ?? 0,
      empresasTrial: cTrial?.count ?? 0,
      totalUsuarios: cUsers?.count ?? 0,
      totalPedidos: cOrders?.count ?? 0,
    };
    const existing = await this.getSaasMetrics(periodo);
    if (existing) {
      const [r] = await db.update(saasMetrics).set(values).where(eq(saasMetrics.id, existing.id)).returning();
      return r;
    }
    const [r] = await db.insert(saasMetrics).values(values).returning();
    return r;
  }

  // ─── White Label — EmpresaConfig ──────────────────────────────────────────
  async getEmpresaConfig(empresaId: number): Promise<EmpresaConfig | undefined> {
    const [r] = await db.select().from(empresaConfig).where(eq(empresaConfig.empresaId, empresaId));
    return r;
  }

  async upsertEmpresaConfig(empresaId: number, data: Partial<InsertEmpresaConfig>): Promise<EmpresaConfig> {
    const existing = await this.getEmpresaConfig(empresaId);
    if (existing) {
      const [r] = await db.update(empresaConfig).set({ ...data, updatedAt: new Date() }).where(eq(empresaConfig.empresaId, empresaId)).returning();
      return r;
    }
    const [r] = await db.insert(empresaConfig).values({ ...data, empresaId }).returning();
    return r;
  }

  // ─── Marketplace — ModulosMarketplace ─────────────────────────────────────
  async getModulosMarketplace(filters?: { categoria?: string; ativo?: boolean }): Promise<ModuloMarketplace[]> {
    const conds: any[] = [];
    if (filters?.categoria) conds.push(eq(modulosMarketplace.categoria, filters.categoria));
    if (filters?.ativo !== undefined) conds.push(eq(modulosMarketplace.ativo, filters.ativo));
    return db.select().from(modulosMarketplace).where(conds.length ? and(...conds) : undefined).orderBy(modulosMarketplace.nomeModulo);
  }

  async getModuloMarketplace(id: number): Promise<ModuloMarketplace | undefined> {
    const [r] = await db.select().from(modulosMarketplace).where(eq(modulosMarketplace.id, id));
    return r;
  }

  async createModuloMarketplace(data: InsertModuloMarketplace): Promise<ModuloMarketplace> {
    const [r] = await db.insert(modulosMarketplace).values(data).returning();
    return r;
  }

  async updateModuloMarketplace(id: number, data: Partial<InsertModuloMarketplace>): Promise<ModuloMarketplace> {
    const [r] = await db.update(modulosMarketplace).set(data).where(eq(modulosMarketplace.id, id)).returning();
    return r;
  }

  async deleteModuloMarketplace(id: number): Promise<void> {
    await db.delete(modulosMarketplace).where(eq(modulosMarketplace.id, id));
  }

  // ─── Marketplace — EmpresaModulos ─────────────────────────────────────────
  async getEmpresaModulos(empresaId: number): Promise<EmpresaModulo[]> {
    return db.select().from(empresaModulos).where(eq(empresaModulos.empresaId, empresaId)).orderBy(desc(empresaModulos.dataInstalacao));
  }

  async getEmpresaModulo(id: number): Promise<EmpresaModulo | undefined> {
    const [r] = await db.select().from(empresaModulos).where(eq(empresaModulos.id, id));
    return r;
  }

  async installModuloEmpresa(empresaId: number, moduloId: number): Promise<EmpresaModulo> {
    const modulo = await this.getModuloMarketplace(moduloId);
    const [r] = await db.insert(empresaModulos).values({
      empresaId,
      moduloId,
      status: 'ativo',
      versaoInstalada: modulo?.versao ?? '1.0.0',
    }).returning();
    return r;
  }

  async updateEmpresaModulo(id: number, data: Partial<InsertEmpresaModulo>): Promise<EmpresaModulo> {
    const [r] = await db.update(empresaModulos).set(data).where(eq(empresaModulos.id, id)).returning();
    return r;
  }

  async removeModuloEmpresa(id: number): Promise<void> {
    await db.delete(empresaModulos).where(eq(empresaModulos.id, id));
  }

  // ─── Vigilância Sanitária ──────────────────────────────────────────────────
  async getSanitaryQuestions(): Promise<SanitaryQuestion[]> {
    return db.select().from(sanitaryQuestions).orderBy(sanitaryQuestions.order, sanitaryQuestions.id);
  }

  async createSanitaryQuestion(data: InsertSanitaryQuestion): Promise<SanitaryQuestion> {
    const [q] = await db.insert(sanitaryQuestions).values(data).returning();
    return q;
  }

  async updateSanitaryQuestion(id: number, data: Partial<InsertSanitaryQuestion>): Promise<SanitaryQuestion> {
    const [q] = await db.update(sanitaryQuestions).set(data).where(eq(sanitaryQuestions.id, id)).returning();
    return q;
  }

  async deleteSanitaryQuestion(id: number): Promise<void> {
    await db.delete(sanitaryQuestions).where(eq(sanitaryQuestions.id, id));
  }

  async getSanitaryEvaluations(): Promise<SanitaryEvaluation[]> {
    return db.select().from(sanitaryEvaluations).orderBy(desc(sanitaryEvaluations.createdAt));
  }

  async getSanitaryEvaluation(id: number): Promise<{ evaluation: SanitaryEvaluation; items: SanitaryEvaluationItem[] } | undefined> {
    const [evaluation] = await db.select().from(sanitaryEvaluations).where(eq(sanitaryEvaluations.id, id));
    if (!evaluation) return undefined;
    const items = await db.select().from(sanitaryEvaluationItems).where(eq(sanitaryEvaluationItems.evaluationId, id)).orderBy(sanitaryEvaluationItems.id);
    return { evaluation, items };
  }

  async createSanitaryEvaluation(data: InsertSanitaryEvaluation): Promise<SanitaryEvaluation> {
    const [e] = await db.insert(sanitaryEvaluations).values(data).returning();
    return e;
  }

  async updateSanitaryEvaluation(id: number, data: Partial<InsertSanitaryEvaluation>): Promise<SanitaryEvaluation> {
    const [e] = await db.update(sanitaryEvaluations).set(data).where(eq(sanitaryEvaluations.id, id)).returning();
    return e;
  }

  async createSanitaryEvaluationItem(data: InsertSanitaryEvaluationItem): Promise<SanitaryEvaluationItem> {
    const [item] = await db.insert(sanitaryEvaluationItems).values(data).returning();
    return item;
  }

  async updateSanitaryEvaluationItem(id: number, data: Partial<InsertSanitaryEvaluationItem>): Promise<SanitaryEvaluationItem> {
    const [item] = await db.update(sanitaryEvaluationItems).set(data).where(eq(sanitaryEvaluationItems.id, id)).returning();
    return item;
  }

  async bulkCreateSanitaryEvaluationItems(items: InsertSanitaryEvaluationItem[]): Promise<SanitaryEvaluationItem[]> {
    if (items.length === 0) return [];
    return db.insert(sanitaryEvaluationItems).values(items).returning();
  }
}

export const storage = new DatabaseStorage();
