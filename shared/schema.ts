import { pgTable, text, serial, integer, boolean, timestamp, numeric, jsonb, date, index, uniqueIndex, check, type AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  empresaId: integer("empresa_id").references(() => companies.id),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  role: text("role").notNull(),
  active: boolean("active").default(true).notNull(),
  tabPermissions: jsonb("tab_permissions"), // string[] | null — null means no restriction (use role defaults)
  testMode: boolean("test_mode").default(false).notNull(),
  permissions: jsonb("permissions"), // { verPedidos, criarPedidos, editarPedidos, excluirPedidos, verCompras, criarCompras, verFinanceiro, editarFinanceiro, gerarNotaFiscal, exportarBling, editarClientes, excluirClientes, acessarInventario, editarInventario, verRelatorios } | null
  // Security
  loginAttempts: integer("login_attempts").default(0).notNull(),
  isLocked: boolean("is_locked").default(false).notNull(),
  lastLoginAttempt: timestamp("last_login_attempt"),
  // FASE 14.6 — session invalidation: increment to kick all active sessions
  tokenVersion: integer("token_version").default(0).notNull(),
}, (table) => ({
  empresaIdIdx: index("users_empresa_id_idx").on(table.empresaId),
}));

export const priceGroups = pgTable("price_groups", {
  id: serial("id").primaryKey(),
  empresaId: integer("empresa_id").references((): AnyPgColumn => companies.id),
  groupName: text("group_name").notNull(),
  description: text("description"),
});

export const companies = pgTable("companies", {
  id: serial("id").primaryKey(),
  // Dados Básicos
  companyName: text("company_name").notNull(),
  contactName: text("contact_name").notNull(),
  email: text("email").notNull().unique(),
  notificationEmail: text("notification_email"),
  password: text("password").notNull(),
  phone: text("phone"),
  cnpj: text("cnpj"),
  priceGroupId: integer("price_group_id").references(() => priceGroups.id),
  allowedOrderDays: jsonb("allowed_order_days").notNull(),
  // Endereço
  addressStreet: text("address_street"),
  addressNumber: text("address_number"),
  addressNeighborhood: text("address_neighborhood"),
  addressCity: text("address_city"),
  addressZip: text("address_zip"),
  // Configurações
  active: boolean("active").default(true).notNull(),
  clientType: text("client_type").default("mensal"),
  contractModel: text("contract_model"), // "fixo" | "variavel" | "alternado" — only for clientType "contratual"
  minWeeklyBilling: numeric("min_weekly_billing", { precision: 10, scale: 2 }),
  deliveryTime: text("delivery_time"),
  // Coordenadas geográficas (para cálculo de rota)
  latitude: numeric("latitude", { precision: 10, scale: 7 }),
  longitude: numeric("longitude", { precision: 10, scale: 7 }),
  // Configuração de janela de entrega por dia da semana
  // JSON: { "Segunda-feira": { enabled: boolean, startTime: string, endTime: string }, ... }
  deliveryConfigJson: text("delivery_config_json"),
  // Taxa administrativa (%)
  adminFee: numeric("admin_fee", { precision: 5, scale: 2 }).default("0"),
  // Feature flag — quando true, o pedido desta empresa passa a calcular
  // unitPrice via Price Resolver (basePrice + adminFee). Default false:
  // nenhuma empresa muda comportamento automaticamente. Rollback imediato
  // basta UPDATE companies SET use_new_pricing = false WHERE id = X.
  useNewPricing: boolean("use_new_pricing").default(false).notNull(),
  // Financeiro
  billingTerm: text("billing_term"),
  billingType: text("billing_type"),
  billingFormat: text("billing_format"),
  // STEP FISCAL 2 — modelo fiscal de faturamento, independente do método
  // de pagamento acima (boleto/pix/depósito). Default STANDARD garante
  // zero regressão para empresas legadas. Valores: STANDARD | CONTRACT_OPEN
  // | CONTRACT_AVERAGE.
  billingModel: text("billing_model").default("STANDARD").notNull(),
  // STEP FISCAL 2 — feature flag por empresa: quando true, buildNFeInput
  // procura automaticamente um nf_draft do pedido. Default false: mantém
  // comportamento legado (NF copia order_items diretamente).
  useFiscalDraft: boolean("use_fiscal_draft").default(false).notNull(),
  paymentDates: text("payment_dates"),
  financialNotes: text("financial_notes"),
  // Dados fiscais do cliente (destinatário NF-e)
  stateRegistration: text("state_registration"), // Inscrição Estadual
  addressState: text("address_state"), // UF, ex: "SP"
  addressIbge: text("address_ibge"), // Código IBGE do município (7 dígitos)
  regimeTributario: text("regime_tributario"), // Override per-empresa: simples_nacional | lucro_presumido | lucro_real
  defaultCfop: text("default_cfop"), // CFOP padrão override por empresa
  // Flags do escopo contratual
  autoCalcCost: boolean("auto_calc_cost").default(true).notNull(),
  autoPriceFromCatalog: boolean("auto_price_from_catalog").default(false).notNull(),
  manualAvgCost: numeric("manual_avg_cost", { precision: 10, scale: 2 }),
  // Preferência de frequência de pedido do cliente: 'semanal' | 'mensal' | 'pontual'
  preferredOrderType: text("preferred_order_type"),
  // Gestão de vigência contratual
  contractStartDate: date("contract_start_date"), // Data de início do contrato
  contractEndDate: date("contract_end_date"), // Data de fim (só para prazo_determinado)
  contractVigencia: text("contract_vigencia"), // 'prazo_indefinido' | 'prazo_determinado'
  // Security
  loginAttempts: integer("login_attempts").default(0).notNull(),
  isLocked: boolean("is_locked").default(false).notNull(),
  lastLoginAttempt: timestamp("last_login_attempt"),
  betaTester: boolean("beta_tester").default(false).notNull(),
  currentVersion: text("current_version"),
  // FASE 14.5 — Secure provisioning flags
  mustChangePassword: boolean("must_change_password").default(false).notNull(),
  passwordTemporary: boolean("password_temporary").default(false).notNull(),
  createdBySource: text("created_by_source"), // "CLARA_AI" | "MANUAL" | null
  // FASE 14.6 — session invalidation: increment to kick all active sessions
  tokenVersion: integer("token_version").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Contract scopes: define the product list per day for contractual companies
export const contractScopes = pgTable("contract_scopes", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companies.id).notNull(),
  dayOfWeek: text("day_of_week").notNull(), // "Segunda-feira", "Terça-feira", etc.
  weekNumber: integer("week_number"), // null = all weeks; 1 or 2 for "alternado" contracts
  scopeCategory: text("scope_category"), // category label (from categories table name)
  productId: integer("product_id").notNull(),
  quantity: integer("quantity").notNull().default(1),
  unitPrice: numeric("unit_price", { precision: 10, scale: 2 }), // per-company price override
  averageCost: numeric("average_cost", { precision: 10, scale: 2 }), // optional, for margin analysis
  observation: text("observation"),
}, (table) => ({
  companyIdIdx: index("contract_scopes_company_id_idx").on(table.companyId),
}));

export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  empresaId: integer("empresa_id").references(() => companies.id),
  name: text("name").notNull().unique(),
  description: text("description"),
  active: boolean("active").default(true).notNull(),
});

export const products = pgTable("products", {
  id: serial("id").primaryKey(),
  empresaId: integer("empresa_id").references(() => companies.id),
  name: text("name").notNull(),
  category: text("category").notNull(),
  unit: text("unit").notNull(),
  active: boolean("active").default(true).notNull(),
  // Preço base interno da VivaFrutaz
  basePrice: numeric("base_price", { precision: 10, scale: 2 }),
  // Flags
  isIndustrialized: boolean("is_industrialized").default(false).notNull(),
  isSeasonal: boolean("is_seasonal").default(false).notNull(),
  // Observação exibida ao cliente no catálogo e nos relatórios
  observation: text("observation"),
  // Dias da semana em que o produto está disponível (null = todos os dias)
  // ex: ["Segunda-feira","Quarta-feira","Sexta-feira"]
  availableDays: jsonb("available_days"),
  // Dados fiscais
  ncm: text("ncm"), // Nomenclatura Comum do Mercosul, ex: "08039000"
  cfop: text("cfop"), // Código Fiscal de Operações, ex: "5102"
  commercialUnit: text("commercial_unit"), // Unidade comercial para NF, ex: "KG"
  // FASE NF.7.8 — flag fiscal de produto importado.
  // Quando true → ICMS calculado a 4% (Resolução 13/2012 do Senado), com
  // PRIORIDADE sobre regra de UF. Default false garante zero quebra para
  // todo o catálogo nacional. Sem .notNull() de propósito — campo opcional
  // no insertProductSchema (admite payloads antigos sem este campo).
  importado: boolean("importado").default(false),
  // Curiosidade educativa do produto
  curiosity: text("curiosity"),
  // Safra: indica se o produto está atualmente fora de safra/indisponível
  outOfSeason: boolean("out_of_season").default(false).notNull(),
  // ID do produto base (ex: "001", "002") — identifica produtos derivados do mesmo item base
  productCode: text("product_code"),
  // Disponibilidade de categorias: 'all' = todas; 'specific' = apenas as listadas em allowedCategories
  categoryAvailability: text("category_availability").notNull().default("all"),
  // Lista de categorias permitidas quando categoryAvailability = 'specific'
  allowedCategories: jsonb("allowed_categories"),
  // URL da imagem do produto. Pode ser:
  //   - URL externa (https://...) — informada pelo admin
  //   - Caminho interno (/uploads/products/<arquivo>) — gerado pelo upload
  // Detectamos a origem pelo prefixo "/uploads" no frontend.
  imageUrl: text("image_url"),
}, (table) => ({
  productCodeIdx: index("products_product_code_idx").on(table.productCode),
}));

export const productPrices = pgTable("product_prices", {
  id: serial("id").primaryKey(),
  empresaId: integer("empresa_id").references(() => companies.id),
  productId: integer("product_id").references(() => products.id).notNull(),
  priceGroupId: integer("price_group_id").references(() => priceGroups.id).notNull(),
  price: numeric("price", { precision: 10, scale: 2 }).notNull(),
});

// Subcategorias de produto: permite que um mesmo produto tenha múltiplas categorias com preços distintos
// Ex: Banana Nanica - "In natura higienizada" = R$ 2.30 / "In natura não higienizada" = R$ 1.10
export const productSubCategories = pgTable("product_sub_categories", {
  id: serial("id").primaryKey(),
  empresaId: integer("empresa_id").references(() => companies.id),
  productId: integer("product_id").references(() => products.id).notNull(),
  categoryName: text("category_name").notNull(),
  price: numeric("price", { precision: 10, scale: 2 }).notNull(),
  active: boolean("active").default(true).notNull(),
});

export type ProductSubCategory = typeof productSubCategories.$inferSelect;
export const insertProductSubCategorySchema = createInsertSchema(productSubCategories).omit({ id: true });
export type InsertProductSubCategory = z.infer<typeof insertProductSubCategorySchema>;

export const orderWindows = pgTable("order_windows", {
  id: serial("id").primaryKey(),
  empresaId: integer("empresa_id").references(() => companies.id),
  weekReference: text("week_reference").notNull(),
  orderOpenDate: timestamp("order_open_date").notNull(),
  orderCloseDate: timestamp("order_close_date").notNull(),
  deliveryStartDate: timestamp("delivery_start_date").notNull(),
  deliveryEndDate: timestamp("delivery_end_date").notNull(),
  active: boolean("active").default(true).notNull(),
  forceOpen: boolean("force_open").default(false).notNull(),
});

// Empresas com exceção de pedidos (podem pedir mesmo com a janela fechada)
export const orderExceptions = pgTable("order_exceptions", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companies.id).notNull(),
  reason: text("reason").notNull(),
  expiryDate: date("expiry_date"),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const orders = pgTable("orders", {
  id: serial("id").primaryKey(),
  orderCode: text("order_code").unique(),
  status: text("status").default("ACTIVE").notNull(),
  // status values: ACTIVE (legacy), CONFIRMED, REOPEN_REQUESTED, OPEN_FOR_EDITING, CANCELLED, DELIVERED
  workflowStatus: text("workflow_status").default("CREATED").notNull(),
  // workflowStatus values: CREATED, PENDING_APPROVAL, APPROVED, REJECTED, INVOICED, SHIPPED, DELIVERED, CANCELLED
  adminNote: text("admin_note"),
  companyId: integer("company_id").references(() => companies.id).notNull(),
  orderDate: timestamp("order_date").defaultNow().notNull(),
  deliveryDate: timestamp("delivery_date").notNull(),
  weekReference: text("week_reference").notNull(),
  totalValue: numeric("total_value", { precision: 10, scale: 2 }).notNull(),
  orderNote: text("order_note"),
  allowReplication: boolean("allow_replication").default(false).notNull(),
  nimbiExpiration: date("nimbi_expiration"),
  reopenReason: text("reopen_reason"),
  reopenRequestedAt: timestamp("reopen_requested_at"),
  // Dados fiscais
  fiscalStatus: text("fiscal_status").default("nota_pendente"), // nota_pendente | nota_exportada | nota_emitida | nota_cancelada
  preNotaNumber: text("pre_nota_number"), // VF-NF-000001
  // Exportação ERP Bling
  erpExportStatus: text("status_exportacao_erp").default("nao_exportado"), // nao_exportado | exportando | exportado | erro
  erpExportedAt: timestamp("data_exportacao_erp"),
  erpId: text("id_erp"),
  erpExportError: text("erro_exportacao_erp"),
  // Endereço de entrega (opcional — referencia company_addresses)
  deliveryAddressId: integer("delivery_address_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  companyIdIdx: index("orders_company_id_idx").on(table.companyId),
  orderDateIdx: index("orders_order_date_idx").on(table.orderDate),
}));

export const orderItems = pgTable("order_items", {
  id: serial("id").primaryKey(),
  empresaId: integer("empresa_id").references(() => companies.id),
  orderId: integer("order_id").references(() => orders.id).notNull(),
  productId: integer("product_id").references(() => products.id).notNull(),
  quantity: integer("quantity").notNull(),
  unitPrice: numeric("unit_price", { precision: 10, scale: 2 }).notNull(),
  totalPrice: numeric("total_price", { precision: 10, scale: 2 }).notNull(),
  subCategoryId: integer("sub_category_id").references(() => productSubCategories.id),
  subCategoryName: text("sub_category_name"),
}, (table) => ({
  orderProductIdx: index("order_items_order_product_idx").on(table.orderId, table.productId),
}));

export const systemSettings = pgTable("system_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

// Solicitações de pedidos pontuais (clientes)
export const specialOrderRequests = pgTable("special_order_requests", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companies.id).notNull(),
  requestedDay: text("requested_day").notNull(),
  requestedDate: text("requested_date"),
  description: text("description").notNull(),
  quantity: text("quantity").notNull(),
  observations: text("observations"),
  status: text("status").default("PENDING").notNull(), // PENDING, APPROVED, REJECTED
  adminNote: text("admin_note"),
  // Multi-item support: JSON array of {productName, quantity, brand?, category, productType, approvedQuantity?}
  items: jsonb("items"),
  estimatedDeliveryDate: text("estimated_delivery_date"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at"),
});

// Solicitações de recuperação de senha (clientes)
export const passwordResetRequests = pgTable("password_reset_requests", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companies.id).notNull(),
  status: text("status").default("PENDING").notNull(), // PENDING, APPROVED, REJECTED
  newPassword: text("new_password"),
  adminNote: text("admin_note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at"),
});

// ─── Pedidos de Teste (modo teste) ────────────────────────────
export const testOrders = pgTable("test_orders", {
  id: serial("id").primaryKey(),
  orderCode: text("order_code").unique(),
  companyId: integer("company_id").references(() => companies.id).notNull(),
  companyName: text("company_name").notNull(),
  deliveryDate: timestamp("delivery_date").notNull(),
  weekReference: text("week_reference").notNull(),
  totalValue: numeric("total_value", { precision: 10, scale: 2 }).notNull(),
  orderNote: text("order_note"),
  items: jsonb("items").notNull(),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Tarefas da Diretoria ──────────────────────────────────────
export const tasks = pgTable("tasks", {
  id: serial("id").primaryKey(),
  empresaId: integer("empresa_id").references(() => companies.id),
  title: text("title").notNull(),
  description: text("description").notNull(),
  assignedToId: integer("assigned_to_id").references(() => users.id),
  assignedToName: text("assigned_to_name"),
  createdById: integer("created_by_id").references(() => users.id),
  createdByName: text("created_by_name"),
  deadline: date("deadline"),
  priority: text("priority").notNull().default("MEDIUM"), // LOW, MEDIUM, HIGH
  status: text("status").notNull().default("PENDING"),    // PENDING, IN_PROGRESS, DONE
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── Ocorrências de Clientes ───────────────────────────────────
export const clientIncidents = pgTable("client_incidents", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companies.id).notNull(),
  companyName: text("company_name").notNull(),
  type: text("type").notNull(), // DELIVERY_PROBLEM, DEFECTIVE_PRODUCT, MISSING_PRODUCT, QUALITY, COMPLAINT, OTHER
  description: text("description").notNull(),
  contactPhone: text("contact_phone"),
  contactEmail: text("contact_email"),
  photoBase64: text("photo_base64"), // base64 encoded image (legacy single)
  photoMime: text("photo_mime"),
  photosJson: text("photos_json"), // JSON array of {base64, mime, name} for multiple photos
  status: text("status").notNull().default("OPEN"), // OPEN, ANALYZING, RESPONDED, RESOLVED
  adminNote: text("admin_note"),
  responseMessage: text("response_message"),   // official response visible to client
  respondedByName: text("responded_by_name"),   // staff member who responded
  respondedAt: timestamp("responded_at"),        // when response was sent
  resolvedAt: timestamp("resolved_at"),
  hasUnreadAdminReply: boolean("has_unread_admin_reply").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── Mensagens de Ocorrências de Clientes ─────────────────────
export const incidentMessages = pgTable("incident_messages", {
  id: serial("id").primaryKey(),
  empresaId: integer("empresa_id").references(() => companies.id),
  incidentId: integer("incident_id").references(() => clientIncidents.id).notNull(),
  senderType: text("sender_type").notNull(), // ADMIN | CLIENT
  senderName: text("sender_name").notNull(),
  message: text("message").notNull(),
  photosJson: text("photos_json"), // JSON array of {base64, mime, name}
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type IncidentMessage = typeof incidentMessages.$inferSelect;

// ─── Ocorrências Internas ──────────────────────────────────────
export const internalIncidents = pgTable("internal_incidents", {
  id: serial("id").primaryKey(),
  empresaId: integer("empresa_id").references(() => companies.id),
  title: text("title").notNull(),
  description: text("description").notNull(),
  category: text("category").notNull(), // LOGISTICS, QUALITY, FINANCIAL, SYSTEM, OTHER
  assignedToId: integer("assigned_to_id").references(() => users.id),
  assignedToName: text("assigned_to_name"),
  createdById: integer("created_by_id").references(() => users.id),
  createdByName: text("created_by_name"),
  priority: text("priority").notNull().default("MEDIUM"), // LOW, MEDIUM, HIGH
  status: text("status").notNull().default("OPEN"),       // OPEN, ANALYZING, RESOLVED
  adminNote: text("admin_note"),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Logística ────────────────────────────────────────────────
export const logisticsDrivers = pgTable("logistics_drivers", {
  id: serial("id").primaryKey(),
  empresaId: integer("empresa_id").references(() => companies.id),
  name: text("name").notNull(),
  cpf: text("cpf"),
  phone: text("phone"),
  email: text("email"),
  licenseNumber: text("license_number"),
  active: boolean("active").notNull().default(true),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const logisticsVehicles = pgTable("logistics_vehicles", {
  id: serial("id").primaryKey(),
  empresaId: integer("empresa_id").references(() => companies.id),
  plate: text("plate").notNull().unique(),
  model: text("model").notNull(),
  brand: text("brand").notNull(),
  year: integer("year"),
  type: text("type").notNull().default("VAN"), // VAN, TRUCK, MOTORCYCLE, CAR
  capacity: text("capacity"),
  active: boolean("active").notNull().default(true),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const logisticsRoutes = pgTable("logistics_routes", {
  id: serial("id").primaryKey(),
  empresaId: integer("empresa_id").references(() => companies.id),
  name: text("name").notNull(),
  driverId: integer("driver_id").references(() => logisticsDrivers.id),
  driverName: text("driver_name"),
  vehicleId: integer("vehicle_id").references(() => logisticsVehicles.id),
  vehiclePlate: text("vehicle_plate"),
  deliveryDate: date("delivery_date"),
  status: text("status").notNull().default("SCHEDULED"), // SCHEDULED, IN_PROGRESS, COMPLETED, CANCELLED
  companyIds: jsonb("company_ids").default([]),
  companyNames: text("company_names"),
  notes: text("notes"),
  startTime: text("start_time"),
  endTime: text("end_time"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const logisticsMaintenance = pgTable("logistics_maintenance", {
  id: serial("id").primaryKey(),
  empresaId: integer("empresa_id").references(() => companies.id),
  vehicleId: integer("vehicle_id").references(() => logisticsVehicles.id),
  vehiclePlate: text("vehicle_plate"),
  type: text("type").notNull(), // PREVENTIVE, CORRECTIVE, INSPECTION
  description: text("description").notNull(),
  cost: numeric("cost", { precision: 10, scale: 2 }),
  scheduledDate: date("scheduled_date"),
  completedDate: date("completed_date"),
  status: text("status").notNull().default("SCHEDULED"), // SCHEDULED, IN_PROGRESS, COMPLETED
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Cotação de Empresas ───────────────────────────────────────
export const companyQuotations = pgTable("company_quotations", {
  id: serial("id").primaryKey(),
  empresaId: integer("empresa_id").references(() => companies.id),
  companyName: text("company_name").notNull(),
  contactName: text("contact_name").notNull(),
  contactPhone: text("contact_phone"),
  email: text("email"),
  cnpj: text("cnpj"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  estimatedVolume: text("estimated_volume"),
  productInterest: text("product_interest"),
  logisticsNote: text("logistics_note"),
  orderWindowIds: jsonb("order_window_ids").default([]),
  priceGroupId: integer("price_group_id").references(() => priceGroups.id),
  priceGroupName: text("price_group_name"),
  status: text("status").notNull().default("PENDING"), // PENDING, IN_ANALYSIS, APPROVED, REJECTED, HORARIOS_DISPONIVEIS
  adminNote: text("admin_note"),
  deliveryWindowsJson: text("delivery_windows_json"), // JSON array of {startTime, endTime}
  deliveryWindowsRespondedBy: text("delivery_windows_responded_by"),
  deliveryWindowsRespondedAt: timestamp("delivery_windows_responded_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── Company Certificates (NF-e A1) — FASE 3.2 ────────────────
// Certificado digital A1 por empresa (multi-tenant). 1:1 com `companies`.
// O `cert_password` está em texto plano nesta fase — criptografia at-rest
// vem na FASE 3.3. NÃO logar este campo, NÃO retornar em GET.
export const companyCertificates = pgTable("company_certificates", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id")
    .notNull()
    .unique()
    .references(() => companies.id, { onDelete: "cascade" }),
  certBase64: text("cert_base64").notNull(),
  certPassword: text("cert_password").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── Insert Schemas ───────────────────────────────────────────
export const insertUserSchema = createInsertSchema(users).omit({ id: true });
export const insertPriceGroupSchema = createInsertSchema(priceGroups).omit({ id: true });
export const insertCompanySchema = createInsertSchema(companies).omit({ id: true, createdAt: true });
export const insertCompanyCertificateSchema = createInsertSchema(companyCertificates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCompanyCertificate = z.infer<typeof insertCompanyCertificateSchema>;
export type CompanyCertificate = typeof companyCertificates.$inferSelect;
export const insertCategorySchema = createInsertSchema(categories).omit({ id: true });
export const insertProductSchema = createInsertSchema(products).omit({ id: true });
export const insertProductPriceSchema = createInsertSchema(productPrices).omit({ id: true });
export const insertOrderWindowSchema = createInsertSchema(orderWindows).omit({ id: true });
export const insertOrderExceptionSchema = createInsertSchema(orderExceptions).omit({ id: true, createdAt: true });
// ─── System Logs ─────────────────────────────────────────────
export const systemLogs = pgTable("system_logs", {
  id: serial("id").primaryKey(),
  action: text("action").notNull(),
  description: text("description").notNull(),
  userId: integer("user_id"),
  companyId: integer("company_id"),
  userEmail: text("user_email"),
  userRole: text("user_role"),
  ip: text("ip"),
  level: text("level").notNull().default("INFO"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertSystemLogSchema = createInsertSchema(systemLogs).omit({ id: true, createdAt: true });
export type SystemLog = typeof systemLogs.$inferSelect;
export type InsertSystemLog = z.infer<typeof insertSystemLogSchema>;

export const insertOrderSchema = createInsertSchema(orders).omit({ id: true, createdAt: true, orderCode: true });
export const insertOrderItemSchema = createInsertSchema(orderItems).omit({ id: true });
export const insertSpecialOrderRequestSchema = createInsertSchema(specialOrderRequests).omit({ id: true, createdAt: true, resolvedAt: true });
export const insertContractScopeSchema = createInsertSchema(contractScopes).omit({ id: true });
export const insertPasswordResetRequestSchema = createInsertSchema(passwordResetRequests).omit({ id: true, createdAt: true, resolvedAt: true });

// ─── Contract Adjustments (Histórico de Reajustes Contratuais) ───────────────
export const contractAdjustments = pgTable("contract_adjustments", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companies.id).notNull(),
  adjustmentPercentage: numeric("adjustment_percentage", { precision: 5, scale: 2 }).notNull(),
  reason: text("reason").notNull(),
  appliedAt: date("applied_at").notNull(),
  newWeeklyValue: numeric("new_weekly_value", { precision: 10, scale: 2 }),
  responsibleUserId: integer("responsible_user_id"),
  responsibleEmail: text("responsible_email"),
  documentContent: jsonb("document_content"), // { headerText, bodyText, footerText, signatureName, signatureRole, signatureDate, signatureImage }
  emailSentAt: timestamp("email_sent_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertContractAdjustmentSchema = createInsertSchema(contractAdjustments).omit({ id: true, createdAt: true });
export type ContractAdjustment = typeof contractAdjustments.$inferSelect;
export type InsertContractAdjustment = z.infer<typeof insertContractAdjustmentSchema>;

// ─── DANFE Records ───────────────────────────────────────────
export const danfeRecords = pgTable("danfe_records", {
  id: serial("id").primaryKey(),
  empresaId: integer("empresa_id").references(() => companies.id),
  orderId: integer("order_id").references(() => orders.id).notNull(),
  orderCode: text("order_code"),
  generatedAt: timestamp("generated_at").defaultNow().notNull(),
  generatedByUserId: integer("generated_by_user_id"),
  generatedByEmail: text("generated_by_email"),
});

export const insertDanfeRecordSchema = createInsertSchema(danfeRecords).omit({ id: true, generatedAt: true });
export type DanfeRecord = typeof danfeRecords.$inferSelect;
export type InsertDanfeRecord = z.infer<typeof insertDanfeRecordSchema>;

// ─── Types ────────────────────────────────────────────────────
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type PriceGroup = typeof priceGroups.$inferSelect;
export type InsertPriceGroup = z.infer<typeof insertPriceGroupSchema>;
export type Company = typeof companies.$inferSelect;
export type InsertCompany = z.infer<typeof insertCompanySchema>;
export type Category = typeof categories.$inferSelect;
export type InsertCategory = z.infer<typeof insertCategorySchema>;
export type Product = typeof products.$inferSelect;
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type ProductPrice = typeof productPrices.$inferSelect;
export type InsertProductPrice = z.infer<typeof insertProductPriceSchema>;
export type OrderWindow = typeof orderWindows.$inferSelect;
export type InsertOrderWindow = z.infer<typeof insertOrderWindowSchema>;
export type OrderException = typeof orderExceptions.$inferSelect;
export type InsertOrderException = z.infer<typeof insertOrderExceptionSchema>;
export type Order = typeof orders.$inferSelect;
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type OrderItem = typeof orderItems.$inferSelect;
export type InsertOrderItem = z.infer<typeof insertOrderItemSchema>;
export type SpecialOrderRequest = typeof specialOrderRequests.$inferSelect;
export type InsertSpecialOrderRequest = z.infer<typeof insertSpecialOrderRequestSchema>;
export type PasswordResetRequest = typeof passwordResetRequests.$inferSelect;
export type InsertPasswordResetRequest = z.infer<typeof insertPasswordResetRequestSchema>;
export type TestOrder = typeof testOrders.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type ClientIncident = typeof clientIncidents.$inferSelect;
export type InternalIncident = typeof internalIncidents.$inferSelect;
export type LogisticsDriver = typeof logisticsDrivers.$inferSelect;
export type LogisticsVehicle = typeof logisticsVehicles.$inferSelect;
export type LogisticsRoute = typeof logisticsRoutes.$inferSelect;
export type LogisticsMaintenance = typeof logisticsMaintenance.$inferSelect;
export type CompanyQuotation = typeof companyQuotations.$inferSelect;
export type ContractScope = typeof contractScopes.$inferSelect;
export type InsertContractScope = z.infer<typeof insertContractScopeSchema>;

// ─── Painel de Avisos ──────────────────────────────────────────
export const announcements = pgTable("announcements", {
  id: serial("id").primaryKey(),
  empresaId: integer("empresa_id").references(() => companies.id),
  title: text("title").notNull(),
  message: text("message").notNull(),
  type: text("type").notNull().default("info"), // "info" | "important" | "maintenance" | "logistics"
  priority: text("priority").notNull().default("normal"), // "normal" | "high"
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  active: boolean("active").default(true).notNull(),
  targetAll: boolean("target_all").default(true).notNull(),
  targetClientTypes: text("target_client_types").array(), // e.g. ["mensal","sodexo","grsa"]
  targetCompanyIds: integer("target_company_ids").array(),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertAnnouncementSchema = createInsertSchema(announcements).omit({ id: true, createdAt: true });
export type Announcement = typeof announcements.$inferSelect;
export type InsertAnnouncement = z.infer<typeof insertAnnouncementSchema>;

// ─── Configuração da Empresa ───────────────────────────────────
export const companyConfig = pgTable("company_config", {
  id: serial("id").primaryKey(),
  empresaId: integer("empresa_id").references(() => companies.id),
  companyName: text("company_name").notNull().default("VivaFrutaz"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  cep: text("cep"),
  phone: text("phone"),
  email: text("email"),
  cnpj: text("cnpj"),
  stateRegistration: text("state_registration"), // Inscrição Estadual
  fantasyName: text("fantasy_name"), // Nome Fantasia
  supportPhone: text("support_phone"),
  supportEmail: text("support_email"),
  supportMessage: text("support_message"),
  addressNumber: text("address_number"),
  neighborhood: text("neighborhood"),
  // Dados fiscais padrão
  defaultCfop: text("default_cfop").default("5102"),
  defaultNatureza: text("default_natureza").default("Venda de mercadoria adquirida"),
  regimeTributario: text("regime_tributario").default("simples_nacional"),
  aliquotaPadrao: text("aliquota_padrao").default("0"),
  ambienteFiscal: text("ambiente_fiscal").default("homologacao"),
  informacoesAdicionais: text("informacoes_adicionais"),
  // Logo da empresa
  logoBase64: text("logo_base64"),
  logoType: text("logo_type").default("image/png"),
  // White-label
  corPrimaria: text("cor_primaria").default("#16a34a"), // Verde padrão
  corSecundaria: text("cor_secundaria").default("#ea580c"), // Laranja padrão
  nomeEmpresa: text("nome_empresa").default("VivaFrutaz"),
  // Certificado Digital A1 (placeholder — preencher depois)
  certificadoA1Base64: text("certificado_a1_base64"), // Conteúdo do .pfx em base64
  certificadoA1Senha: text("certificado_a1_senha"),   // Senha do certificado
  certificadoA1Nome: text("certificado_a1_nome"),     // Nome do arquivo original
  certificadoA1Validade: text("certificado_a1_validade"), // Data de validade (ISO)
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type CompanyConfig = typeof companyConfig.$inferSelect;
export const insertCompanyConfigSchema = createInsertSchema(companyConfig).omit({ id: true, updatedAt: true });
export type InsertCompanyConfig = z.infer<typeof insertCompanyConfigSchema>;

// ─── Configurações White-label por Empresa ─────────────────────
export const companySettings = pgTable("company_settings", {
  id: serial("id").primaryKey(),
  empresaId: integer("empresa_id").notNull().references(() => companies.id),
  corPrimaria: text("cor_primaria").default("#16a34a"),
  corSecundaria: text("cor_secundaria").default("#ea580c"),
  logoBase64: text("logo_base64"),
  logoType: text("logo_type").default("image/png"),
  nomeEmpresa: text("nome_empresa").default("VivaFrutaz"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type CompanySettings = typeof companySettings.$inferSelect;
export const insertCompanySettingsSchema = createInsertSchema(companySettings).omit({ id: true, updatedAt: true });
export type InsertCompanySettings = z.infer<typeof insertCompanySettingsSchema>;

// ─── Controle de Desperdício ───────────────────────────────────
export const wasteControl = pgTable("waste_control", {
  id: serial("id").primaryKey(),
  productId: integer("product_id"),
  productName: text("product_name").notNull(),
  quantity: numeric("quantity", { precision: 10, scale: 3 }).notNull(),
  unit: text("unit").notNull().default("kg"),
  reason: text("reason").notNull(), // expired | damaged | overripe | separation_error | logistics_error | other
  notes: text("notes"),
  date: date("date").notNull(),
  registeredBy: text("registered_by").notNull(),
  registeredById: integer("registered_by_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertWasteControlSchema = createInsertSchema(wasteControl).omit({ id: true, createdAt: true });
export type WasteControl = typeof wasteControl.$inferSelect;
export type InsertWasteControl = z.infer<typeof insertWasteControlSchema>;

// ─── Planejamento de Compras — Status de Item ──────────────────
export const purchasePlanStatus = pgTable("purchase_plan_status", {
  id: serial("id").primaryKey(),
  weekRef: text("week_ref").notNull(), // e.g. "2026-W12"
  productId: integer("product_id"),
  productName: text("product_name").notNull(),
  status: text("status").notNull().default("PENDING"), // PENDING | BUYING | BOUGHT | UNAVAILABLE
  supplier: text("supplier"),
  expectedArrival: date("expected_arrival"),
  notes: text("notes"),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertPurchasePlanStatusSchema = createInsertSchema(purchasePlanStatus).omit({ id: true, createdAt: true, updatedAt: true });
export type PurchasePlanStatus = typeof purchasePlanStatus.$inferSelect;
export type InsertPurchasePlanStatus = z.infer<typeof insertPurchasePlanStatusSchema>;

// ─── Estoque / Inventário ────────────────────────────────────────

// Configuração de estoque por produto (estoque atual + mínimo)
export const inventorySettings = pgTable("inventory_settings", {
  id: serial("id").primaryKey(),
  tenantId: integer("empresa_id").references(() => companies.id),
  productId: integer("product_id"),
  productName: text("product_name").notNull(),
  unit: text("unit").notNull().default("kg"),
  currentStock: numeric("current_stock", { precision: 10, scale: 3 }).notNull().default("0"),
  minStock: numeric("min_stock", { precision: 10, scale: 3 }).notNull().default("0"),
  avgPurchasePrice: numeric("avg_purchase_price", { precision: 10, scale: 2 }).default("0"),
  category: text("category"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  tenantIdIdx: index("inventory_settings_empresa_id_idx").on(table.tenantId),
  productIdIdx: index("inventory_settings_product_id_idx").on(table.productId),
}));
export const insertInventorySettingsSchema = createInsertSchema(inventorySettings).omit({ id: true, updatedAt: true });
export type InventorySettings = typeof inventorySettings.$inferSelect;
export type InsertInventorySettings = z.infer<typeof insertInventorySettingsSchema>;

// Entradas de estoque (NF ou manual)
export const inventoryEntries = pgTable("inventory_entries", {
  id: serial("id").primaryKey(),
  tenantId: integer("empresa_id").references(() => companies.id),
  productId: integer("product_id"),
  productName: text("product_name").notNull(),
  category: text("category"),
  supplier: text("supplier"),
  quantity: numeric("quantity", { precision: 10, scale: 3 }).notNull(),
  unit: text("unit").notNull().default("kg"),
  purchasePrice: numeric("purchase_price", { precision: 10, scale: 2 }),
  invoiceNumber: text("invoice_number"),
  invoiceDate: date("invoice_date"),
  entryDate: date("entry_date").notNull(),
  expiryDate: date("expiry_date"),
  notes: text("notes"),
  createdBy: text("created_by").notNull(),
  createdById: integer("created_by_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  tenantIdIdx: index("inventory_entries_empresa_id_idx").on(table.tenantId),
}));
export const insertInventoryEntrySchema = createInsertSchema(inventoryEntries).omit({ id: true, createdAt: true });
export type InventoryEntry = typeof inventoryEntries.$inferSelect;
export type InsertInventoryEntry = z.infer<typeof insertInventoryEntrySchema>;

// Movimentações de estoque (entradas, saídas, ajustes, desperdícios)
export const inventoryMovements = pgTable("inventory_movements", {
  id: serial("id").primaryKey(),
  tenantId: integer("empresa_id").references(() => companies.id),
  productId: integer("product_id"),
  productName: text("product_name").notNull(),
  movementType: text("movement_type").notNull(), // ENTRY | EXIT | ADJUSTMENT | WASTE
  quantity: numeric("quantity", { precision: 10, scale: 3 }).notNull(),
  balanceAfter: numeric("balance_after", { precision: 10, scale: 3 }),
  unit: text("unit").notNull().default("kg"),
  referenceType: text("reference_type"), // order | entry | waste | adjustment
  referenceId: integer("reference_id"),
  notes: text("notes"),
  date: date("date").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  tenantIdIdx: index("inventory_movements_empresa_id_idx").on(table.tenantId),
}));
export const insertInventoryMovementSchema = createInsertSchema(inventoryMovements).omit({ id: true, createdAt: true });
export type InventoryMovement = typeof inventoryMovements.$inferSelect;
export type InsertInventoryMovement = z.infer<typeof insertInventoryMovementSchema>;

// Inventário Físico (conferência manual)
export const inventoryPhysicalCounts = pgTable("inventory_physical_counts", {
  id: serial("id").primaryKey(),
  tenantId: integer("empresa_id").references(() => companies.id),
  productId: integer("product_id"),
  productName: text("product_name").notNull(),
  unit: text("unit").notNull().default("kg"),
  systemStock: numeric("system_stock", { precision: 10, scale: 3 }).notNull(),
  physicalStock: numeric("physical_stock", { precision: 10, scale: 3 }).notNull(),
  difference: numeric("difference", { precision: 10, scale: 3 }).notNull(),
  notes: text("notes"),
  date: date("date").notNull(),
  createdBy: text("created_by").notNull(),
  createdById: integer("created_by_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  tenantIdIdx: index("inventory_physical_counts_empresa_id_idx").on(table.tenantId),
}));
export const insertInventoryPhysicalCountSchema = createInsertSchema(inventoryPhysicalCounts).omit({ id: true, createdAt: true });
export type InventoryPhysicalCount = typeof inventoryPhysicalCounts.$inferSelect;
export type InsertInventoryPhysicalCount = z.infer<typeof insertInventoryPhysicalCountSchema>;

// ─── Notas Fiscais Importadas (OCR) ─────────────────────────────────────────
export const fiscalInvoices = pgTable("fiscal_invoices", {
  id: serial("id").primaryKey(),
  // NF-e header info
  invoiceNumber: text("invoice_number").notNull(),
  supplier: text("supplier").notNull(),
  supplierCnpj: text("supplier_cnpj"),
  issueDate: text("issue_date"),
  totalValue: numeric("total_value", { precision: 12, scale: 2 }),
  // Items as JSONB: [{name, quantity, unit, unitPrice, totalPrice, linkedProductId?, linkedProductName?}]
  items: jsonb("items").notNull().default([]),
  // Status: PENDING (review), CONFIRMED (imported to stock)
  status: text("status").notNull().default("CONFIRMED"),
  // Audit
  importedBy: integer("imported_by").references(() => users.id),
  importedAt: timestamp("imported_at").defaultNow().notNull(),
  notes: text("notes"),
  // Original file stored as base64 for display
  fileType: text("file_type"), // 'pdf' | 'image'
  fileName: text("file_name"),
  // Check duplicate key
  duplicateKey: text("duplicate_key"), // `${invoiceNumber}_${cnpj}`
});

export const insertFiscalInvoiceSchema = createInsertSchema(fiscalInvoices).omit({ id: true, importedAt: true });
export type FiscalInvoice = typeof fiscalInvoices.$inferSelect;
export type InsertFiscalInvoice = z.infer<typeof insertFiscalInvoiceSchema>;

// ─── Email Schedules ─────────────────────────────────────────────────────────
// Configurable schedules for automated email dispatch
export const emailSchedules = pgTable("email_schedules", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(),
  // "window_open_reminder" | "unfinalised_reminder" | "confirmed_notification" | "cancelled_notification"
  label: text("label").notNull(),
  dayOfWeek: integer("day_of_week"), // 0=Sun..6=Sat; null = every day
  timeOfDay: text("time_of_day").notNull(), // "15:00" 24h format
  enabled: boolean("enabled").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export const insertEmailScheduleSchema = createInsertSchema(emailSchedules).omit({ id: true, createdAt: true, updatedAt: true });
export type EmailSchedule = typeof emailSchedules.$inferSelect;
export type InsertEmailSchedule = z.infer<typeof insertEmailScheduleSchema>;

// ─── Email Logs ──────────────────────────────────────────────────────────────
// Historical record of all emails sent / attempted
export const emailLogs = pgTable("email_logs", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(),
  // "window_open_reminder" | "unfinalised_reminder" | "order_confirmed" | "order_rejected" | "admin_broadcast" | "test"
  toEmail: text("to_email").notNull(),
  toName: text("to_name"),
  companyId: integer("company_id").references(() => companies.id),
  orderId: integer("order_id"),
  subject: text("subject").notNull(),
  status: text("status").notNull(), // "sent" | "failed" | "skipped"
  errorMessage: text("error_message"),
  sentAt: timestamp("sent_at").defaultNow().notNull(),
  metadata: jsonb("metadata"), // extra context
});
export const insertEmailLogSchema = createInsertSchema(emailLogs).omit({ id: true, sentAt: true });
export type EmailLog = typeof emailLogs.$inferSelect;
export type InsertEmailLog = z.infer<typeof insertEmailLogSchema>;

// ─── Quem Somos Nós (Institutional Info) ─────────────────────────────────────
export const aboutUs = pgTable("about_us", {
  id: serial("id").primaryKey(),
  title: text("title").notNull().default("Quem Somos Nós"),
  content: text("content").notNull().default(""),
  foundingYear: text("founding_year"),
  mission: text("mission"),
  vision: text("vision"),
  values: text("values"),
  imageBase64: text("image_base64"), // uploaded logo/photo as base64
  imageType: text("image_type"),     // e.g. "image/png"
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export const insertAboutUsSchema = createInsertSchema(aboutUs).omit({ id: true, updatedAt: true });
export type AboutUs = typeof aboutUs.$inferSelect;
export type InsertAboutUs = z.infer<typeof insertAboutUsSchema>;

// ─── SMTP Configuration ───────────────────────────────────────────────────────
export const smtpConfig = pgTable("smtp_config", {
  id: serial("id").primaryKey(),
  host: text("host").notNull().default(""),
  port: integer("port").notNull().default(587),
  user: text("user").notNull().default(""),
  password: text("password").notNull().default(""), // stored plain; masked in API response
  senderEmail: text("sender_email").notNull().default(""),
  senderName: text("sender_name").notNull().default("VivaFrutaz"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export const insertSmtpConfigSchema = createInsertSchema(smtpConfig).omit({ id: true, updatedAt: true });
export type SmtpConfig = typeof smtpConfig.$inferSelect;
export type InsertSmtpConfig = z.infer<typeof insertSmtpConfigSchema>;

// ─── Clara Training (IA Treinamento) ────────────────────────────────────────
export const claraTraining = pgTable("clara_training", {
  id: serial("id").primaryKey(),
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  userId: integer("user_id"),
  userName: text("user_name"),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type ClaraTraining = typeof claraTraining.$inferSelect;
export const insertClaraTrainingSchema = createInsertSchema(claraTraining).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertClaraTraining = z.infer<typeof insertClaraTrainingSchema>;

// ─── Push Subscriptions ─────────────────────────────────────────────────────
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  companyId: integer("company_id"),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  userAgent: text("user_agent"),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export const insertPushSubscriptionSchema = createInsertSchema(pushSubscriptions).omit({ id: true, createdAt: true });
export type InsertPushSubscription = z.infer<typeof insertPushSubscriptionSchema>;

// ─── Notification Settings ──────────────────────────────────────────────────
export const notificationSettings = pgTable("notification_settings", {
  id: serial("id").primaryKey(),
  event: text("event").notNull().unique(),
  enabled: boolean("enabled").default(true).notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  targetAudience: text("target_audience").default("staff").notNull(), // 'staff' | 'all'
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type NotificationSetting = typeof notificationSettings.$inferSelect;
export const insertNotificationSettingSchema = createInsertSchema(notificationSettings).omit({ id: true });
export type InsertNotificationSetting = z.infer<typeof insertNotificationSettingSchema>;

// ─── Simulação de Escopo Comercial ────────────────────────────────────────────
export const scopeSimulations = pgTable("scope_simulations", {
  id: serial("id").primaryKey(),
  // Dados da empresa prospectada
  companyName: text("company_name").notNull(),
  cnpj: text("cnpj"),
  city: text("city"),
  contactName: text("contact_name"),
  phone: text("phone"),
  email: text("email"),
  // Modelo pretendido
  modelType: text("model_type").notNull().default("a_definir"), // 'semanal' | 'mensal' | 'contratual' | 'a_definir'
  // Limites de faturamento configuráveis
  minWeeklyBilling: numeric("min_weekly_billing", { precision: 10, scale: 2 }).default("350"),
  minMonthlyBilling: numeric("min_monthly_billing", { precision: 10, scale: 2 }).default("1400"),
  // Rota
  route: text("route"), // 'manha' | 'tarde' | null
  routeMinManha: numeric("route_min_manha", { precision: 10, scale: 2 }).default("350"),
  routeMinTarde: numeric("route_min_tarde", { precision: 10, scale: 2 }).default("450"),
  // Itens do escopo simulado (JSONB)
  // [{productId, productName, category, quantity, unit, dayOfWeek, frequency, unitPrice, avgCost, weeklyValue}]
  items: jsonb("items"),
  // Totais calculados (denormalizados para performance)
  totalWeekly: numeric("total_weekly", { precision: 10, scale: 2 }).default("0"),
  totalMonthly: numeric("total_monthly", { precision: 10, scale: 2 }).default("0"),
  totalCost: numeric("total_cost", { precision: 10, scale: 2 }).default("0"),
  // Status
  status: text("status").notNull().default("draft"), // 'draft' | 'saved' | 'converted'
  convertedToCompanyId: integer("converted_to_company_id"),
  convertedAt: timestamp("converted_at"),
  // Metadados
  createdByUserId: integer("created_by_user_id"),
  createdByName: text("created_by_name"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertScopeSimulationSchema = createInsertSchema(scopeSimulations).omit({ id: true, createdAt: true, updatedAt: true });
export type ScopeSimulation = typeof scopeSimulations.$inferSelect;
export type InsertScopeSimulation = z.infer<typeof insertScopeSimulationSchema>;

// ─── Módulo Financeiro ─────────────────────────────────────────────────────

export const accountsReceivable = pgTable("accounts_receivable", {
  id: serial("id").primaryKey(),
  tenantId: integer("empresa_id").references(() => companies.id),
  companyId: integer("company_id"),
  orderId: integer("order_id"),
  descricao: text("descricao").notNull(),
  valor: numeric("valor", { precision: 12, scale: 2 }).notNull(),
  dataEmissao: date("data_emissao").notNull(),
  dataVencimento: date("data_vencimento").notNull(),
  status: text("status").notNull().default("pendente"), // pendente | pago | vencido | cancelado
  formaPagamento: text("forma_pagamento").notNull().default("pix"), // pix | boleto | transferencia | dinheiro
  pagoEm: timestamp("pago_em"),
  pixPayload: text("pix_payload"),
  observacoes: text("observacoes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  tenantIdIdx: index("accounts_receivable_empresa_id_idx").on(table.tenantId),
}));
export const insertAccountReceivableSchema = createInsertSchema(accountsReceivable).omit({ id: true, createdAt: true });
export type AccountReceivable = typeof accountsReceivable.$inferSelect;
export type InsertAccountReceivable = z.infer<typeof insertAccountReceivableSchema>;

export const accountsPayable = pgTable("accounts_payable", {
  id: serial("id").primaryKey(),
  tenantId: integer("empresa_id").references(() => companies.id),
  fornecedor: text("fornecedor").notNull(),
  descricao: text("descricao").notNull(),
  valor: numeric("valor", { precision: 12, scale: 2 }).notNull(),
  dataVencimento: date("data_vencimento").notNull(),
  status: text("status").notNull().default("pendente"), // pendente | pago | vencido | cancelado
  categoria: text("categoria").notNull().default("outros"), // fornecedor | logistica | operacional | outros
  pagoEm: timestamp("pago_em"),
  observacoes: text("observacoes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  tenantIdIdx: index("accounts_payable_empresa_id_idx").on(table.tenantId),
}));
export const insertAccountPayableSchema = createInsertSchema(accountsPayable).omit({ id: true, createdAt: true });
export type AccountPayable = typeof accountsPayable.$inferSelect;
export type InsertAccountPayable = z.infer<typeof insertAccountPayableSchema>;

export const financialTransactions = pgTable("financial_transactions", {
  id: serial("id").primaryKey(),
  tenantId: integer("empresa_id").references(() => companies.id),
  tipo: text("tipo").notNull(), // entrada | saida
  valor: numeric("valor", { precision: 12, scale: 2 }).notNull(),
  descricao: text("descricao").notNull(),
  data: date("data").notNull(),
  referenciaTipo: text("referencia_tipo"), // receivable | payable | manual
  referenciaId: integer("referencia_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  tenantIdIdx: index("financial_transactions_empresa_id_idx").on(table.tenantId),
}));
export const insertFinancialTransactionSchema = createInsertSchema(financialTransactions).omit({ id: true, createdAt: true });
export type FinancialTransaction = typeof financialTransactions.$inferSelect;
export type InsertFinancialTransaction = z.infer<typeof insertFinancialTransactionSchema>;

// ─── NF-e Emissões ─────────────────────────────────────────────────────────
export const nfeEmissoes = pgTable("nfe_emissoes", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").references(() => orders.id).notNull(),
  numero: text("numero").notNull(),
  serie: text("serie").default("001").notNull(),
  chaveNFe: text("chave_nfe"),
  status: text("status").default("gerada").notNull(), // gerada | assinada | enviada | autorizada | rejeitada | erro | cancelada | denegada
  xmlGerado: text("xml_gerado"),
  xmlAutorizado: text("xml_autorizado"),
  protocolo: text("protocolo"),
  cStat: text("c_stat"),
  xMotivo: text("x_motivo"),
  dataEmissao: text("data_emissao"),
  dataAutorizacao: timestamp("data_autorizacao"),
  ambienteFiscal: text("ambiente_fiscal").default("homologacao"),
  danfePath: text("danfe_path"),
  motivoCancelamento: text("motivo_cancelamento"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
},
(t) => ({
  serieNumeroUnique: uniqueIndex("idx_nfe_serie_numero_unique")
    .on(t.serie, t.numero),
  checkStatus: check("check_nfe_status",
    sql`status IN (
      'gerada',
      'assinada',
      'enviada',
      'autorizada',
      'rejeitada',
      'erro',
      'cancelada',
      'denegada'
    )`
  ),
}));
export const insertNfeEmissaoSchema = createInsertSchema(nfeEmissoes).omit({ id: true, createdAt: true });
export type NfeEmissao = typeof nfeEmissoes.$inferSelect;
export type InsertNfeEmissao = z.infer<typeof insertNfeEmissaoSchema>;

// ─── NF-e Training Logs (diagnóstico + aprendizado de erros) ──────────────────
export const nfeTrainingLogs = pgTable("nfe_training_logs", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").references(() => orders.id),
  nfeId: integer("nfe_id").references(() => nfeEmissoes.id),
  codigoErro: text("codigo_erro"),       // ex: "422", "539"
  mensagemErro: text("mensagem_erro"),   // mensagem retornada pelo SEFAZ ou validação
  campoAfetado: text("campo_afetado"),   // ex: "emitente.cMun"
  solucao: text("solucao"),              // solução registrada
  telaCorrecao: text("tela_correcao"),   // rota de correção ex: "/admin/company-config"
  resolvidoEm: timestamp("resolvido_em"),
  userId: integer("user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type NfeTrainingLog = typeof nfeTrainingLogs.$inferSelect;
export const insertNfeTrainingLogSchema = createInsertSchema(nfeTrainingLogs).omit({ id: true, createdAt: true });
export type InsertNfeTrainingLog = z.infer<typeof insertNfeTrainingLogSchema>;

// ─── CC-e (Carta de Correção Eletrônica) — FASE 14.2 ─────────────────────────
export const nfeCce = pgTable("nfe_cce", {
  id: serial("id").primaryKey(),
  nfeId: integer("nfe_id").references(() => nfeEmissoes.id).notNull(),
  sequencia: integer("sequencia").notNull(),
  correcao: text("correcao").notNull(),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type NfeCce = typeof nfeCce.$inferSelect;
export const insertNfeCceSchema = createInsertSchema(nfeCce).omit({ id: true, createdAt: true });
export type InsertNfeCce = z.infer<typeof insertNfeCceSchema>;

// ─── NF-e CC-e Audit Log — FASE 14.3 ────────────────────────────────────────
export const nfeCceAuditLogs = pgTable("nfe_cce_audit_logs", {
  id: serial("id").primaryKey(),
  nfeId: integer("nfe_id").notNull(),
  sequencia: integer("sequencia").notNull(),
  userId: integer("user_id"),
  empresaId: integer("empresa_id"),
  correcao: text("correcao").notNull(),
  payloadAnterior: jsonb("payload_anterior"),
  payloadNovo: jsonb("payload_novo"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type NfeCceAuditLog = typeof nfeCceAuditLogs.$inferSelect;
export type InsertNfeCceAuditLog = typeof nfeCceAuditLogs.$inferInsert;

// ─── NF Manual ──────────────────────────────────────────────────────────────
export const nfManual = pgTable("nf_manual", {
  id: serial("id").primaryKey(),
  numeroNf: text("numero_nf").notNull(),
  dataEmissao: text("data_emissao").notNull(),
  clienteFornecedor: text("cliente_fornecedor").notNull(),
  produtos: jsonb("produtos").notNull(), // array de {nome, quantidade, preco, unidade}
  impostos: jsonb("impostos"), // objeto com impostos
  observacoes: text("observacoes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  userId: integer("user_id").references(() => users.id),
  tenantId: integer("empresa_id").references(() => companies.id),
});
export const insertNfManualSchema = createInsertSchema(nfManual).omit({ id: true, createdAt: true });
export type NfManual = typeof nfManual.$inferSelect;
export type InsertNfManual = z.infer<typeof insertNfManualSchema>;

// ─── NF Drafts (STEP FISCAL 1 — camada editável isolada) ────────────────────
// Tabela 100% aditiva. Não substitui orders/order_items/nfe_emissoes/nf_manual.
// Contém uma "nota em rascunho" totalmente editável (itens + totais) antes
// da emissão real. items/totals usam JSONB para permitir evolução do shape
// fiscal (NCM, CFOP, desconto, frete) sem novas migrações.
export const nfDrafts = pgTable("nf_drafts", {
  id: serial("id").primaryKey(),
  tenantId: integer("empresa_id").references(() => companies.id),
  orderId: integer("order_id").references(() => orders.id),
  companyId: integer("company_id").references(() => companies.id).notNull(),
  // STEP FISCAL 2 — enum estendido: STANDARD | CONTRACT_OPEN | CONTRACT_AVERAGE.
  // Valores legados "CONTRACT" são lidos pelo service como CONTRACT_OPEN.
  billingType: text("billing_type").notNull().default("STANDARD"),
  status: text("status").notNull().default("draft"),               // draft | finalized
  // STEP FISCAL 2 — agrupamento de itens. Quando true, a NF gerada do draft
  // consolida todos os itens em uma única linha (ex.: "Frutas in natura").
  // Quando false, cada item vai como linha separada na NF.
  useGroupedItems: boolean("use_grouped_items").notNull().default(false),
  items: jsonb("items").notNull().default([]),
  totals: jsonb("totals").notNull().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  tenantIdx: index("nf_drafts_empresa_id_idx").on(table.tenantId),
  orderIdIdx: index("nf_drafts_order_id_idx").on(table.orderId),
  companyIdIdx: index("nf_drafts_company_id_idx").on(table.companyId),
}));
export const insertNfDraftSchema = createInsertSchema(nfDrafts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type NfDraft = typeof nfDrafts.$inferSelect;
export type InsertNfDraft = z.infer<typeof insertNfDraftSchema>;

// ─── Contas Bancárias ───────────────────────────────────────────────────────
export const bankAccounts = pgTable("bank_accounts", {
  id: serial("id").primaryKey(),
  banco: text("banco").notNull(), // "itau" | "bradesco" | "bb" | "santander"
  nome: text("nome").notNull(),
  agencia: text("agencia"),
  conta: text("conta"),
  clientId: text("client_id"),
  clientSecret: text("client_secret"),
  ambiente: text("ambiente").default("sandbox"), // sandbox | producao
  status: text("status").default("desconectado"), // conectado | desconectado | erro
  ultimaSincronizacao: timestamp("ultima_sincronizacao"),
  saldoAtual: numeric("saldo_atual", { precision: 15, scale: 2 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export const insertBankAccountSchema = createInsertSchema(bankAccounts).omit({ id: true, createdAt: true });
export type BankAccount = typeof bankAccounts.$inferSelect;
export type InsertBankAccount = z.infer<typeof insertBankAccountSchema>;

// ─── Transações Bancárias ───────────────────────────────────────────────────
export const bankTransactions = pgTable("bank_transactions", {
  id: serial("id").primaryKey(),
  bankAccountId: integer("bank_account_id").references(() => bankAccounts.id),
  externalId: text("external_id"),
  tipo: text("tipo").notNull(), // credito | debito
  valor: numeric("valor", { precision: 15, scale: 2 }).notNull(),
  data: date("data").notNull(),
  descricao: text("descricao"),
  documento: text("documento"),
  status: text("status").default("pendente"), // pendente | conciliado | ignorado
  contaReceivableId: integer("conta_receivable_id").references(() => accountsReceivable.id),
  contaPayableId: integer("conta_payable_id").references(() => accountsPayable.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export const insertBankTransactionSchema = createInsertSchema(bankTransactions).omit({ id: true, createdAt: true });
export type BankTransaction = typeof bankTransactions.$inferSelect;
export type InsertBankTransaction = z.infer<typeof insertBankTransactionSchema>;

// ─── IA Interações ─────────────────────────────────────────────────────────
export const aiInteractions = pgTable("ai_interactions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  companyId: integer("company_id"),
  userRole: text("user_role"),
  userName: text("user_name"),
  message: text("message").notNull(),
  response: text("response").notNull(),
  intent: text("intent"),
  actionExecuted: text("action_executed"),
  actionData: jsonb("action_data"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  tenantId: integer("empresa_id").references(() => companies.id),
});
export type AiInteraction = typeof aiInteractions.$inferSelect;
export const insertAiInteractionSchema = createInsertSchema(aiInteractions).omit({ id: true, createdAt: true });
export type InsertAiInteraction = z.infer<typeof insertAiInteractionSchema>;

// ─── Múltiplos Endereços por Cliente ────────────────────────────────────────
// ─── SaaS: Planos e Assinaturas ──────────────────────────────────────────────
export const planos = pgTable("planos", {
  id: serial("id").primaryKey(),
  nome: text("nome").notNull(),
  descricao: text("descricao"),
  tipoPlano: text("tipo_plano").default("premium").notNull(), // free | starter | premium | enterprise
  preco: numeric("preco", { precision: 10, scale: 2 }).notNull().default("0"),
  valorAnual: numeric("valor_anual", { precision: 10, scale: 2 }),
  tipoCobranca: text("tipo_cobranca").default("mensal"), // mensal | anual
  limiteUsuarios: integer("limite_usuarios").default(10),
  limiteProdutos: integer("limite_produtos").default(100),
  limitePedidos: integer("limite_pedidos").default(500),
  limitePedidosMes: integer("limite_pedidos_mes").default(500),
  limiteMotoristas: integer("limite_motoristas").default(5),
  limiteRotas: integer("limite_rotas").default(10),
  limiteEmissoesNf: integer("limite_emissoes_nf").default(100),
  limiteEmpresasFiliais: integer("limite_empresas_filiais").default(1),
  gpsHabilitado: boolean("gps_habilitado").default(false),
  logisticaAvancada: boolean("logistica_avancada").default(false),
  suportePrioritario: boolean("suporte_prioritario").default(false),
  apiIntegracao: boolean("api_integracao").default(false),
  nivelIA: text("nivel_ia").default("basica"), // limitada | basica | completa | ilimitada
  limiteIA: integer("limite_ia").default(100),
  modulosHabilitados: text("modulos_habilitados").array(), // ['dashboard','pedidos','logistica',...]
  destaque: boolean("destaque").default(false).notNull(),
  ativo: boolean("ativo").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type Plano = typeof planos.$inferSelect;
export const insertPlanoSchema = createInsertSchema(planos).omit({ id: true, createdAt: true });
export type InsertPlano = z.infer<typeof insertPlanoSchema>;

export const assinaturas = pgTable("assinaturas", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companies.id).notNull(),
  planoId: integer("plano_id").references(() => planos.id),
  status: text("status").notNull().default("trial"), // trial | ativa | atrasada | inadimplente | cancelada | suspensa
  dataInicio: timestamp("data_inicio").defaultNow().notNull(),
  dataExpiracao: timestamp("data_expiracao"),
  dataVencimento: timestamp("data_vencimento"),
  dataPagamento: timestamp("data_pagamento"),
  metodoPagamento: text("metodo_pagamento"), // pix | cartao | boleto | manual
  linhaDigitavel: text("linha_digitavel"),
  pixChave: text("pix_chave"),
  pixQrCode: text("pix_qr_code"),
  gatewayPagamento: text("gateway_pagamento"), // mercadopago | stripe | pix | manual
  subscriptionGatewayId: text("subscription_gateway_id"),
  valor: numeric("valor", { precision: 10, scale: 2 }),
  observacoes: text("observacoes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type Assinatura = typeof assinaturas.$inferSelect;
export const insertAssinaturaSchema = createInsertSchema(assinaturas).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAssinatura = z.infer<typeof insertAssinaturaSchema>;

export const billingEvents = pgTable("billing_events", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companies.id),
  assinaturaId: integer("assinatura_id").references(() => assinaturas.id),
  tipo: text("tipo").notNull(), // pagamento | reembolso | cancelamento | vencimento | upgrade | downgrade
  valor: numeric("valor", { precision: 10, scale: 2 }),
  status: text("status").notNull().default("pendente"), // pendente | pago | falhou | estornado
  gateway: text("gateway"),
  gatewayEventId: text("gateway_event_id"),
  payload: jsonb("payload"),
  descricao: text("descricao"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type BillingEvent = typeof billingEvents.$inferSelect;
export const insertBillingEventSchema = createInsertSchema(billingEvents).omit({ id: true, createdAt: true });
export type InsertBillingEvent = z.infer<typeof insertBillingEventSchema>;

export const companyAddresses = pgTable("company_addresses", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companies.id).notNull(),
  label: text("label").notNull(), // ex: "Sede", "Filial Centro"
  logradouro: text("logradouro").notNull(),
  numero: text("numero"),
  complemento: text("complemento"),
  bairro: text("bairro"),
  cidade: text("cidade").notNull(),
  estado: text("estado"),
  cep: text("cep"),
  isPrimary: boolean("is_primary").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type CompanyAddress = typeof companyAddresses.$inferSelect;
export const insertCompanyAddressSchema = createInsertSchema(companyAddresses).omit({ id: true, createdAt: true });
export type InsertCompanyAddress = z.infer<typeof insertCompanyAddressSchema>;

// ─── Entregas (Deliveries) ────────────────────────────────────────────────────
export const deliveries = pgTable("deliveries", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").references(() => orders.id),
  companyId: integer("company_id").references(() => companies.id),
  driverId: integer("driver_id").references(() => logisticsDrivers.id),
  routeId: integer("route_id").references(() => logisticsRoutes.id),
  // Status: pendente | em_rota | entregue | cancelado
  status: text("status").notNull().default("pendente"),
  scheduledDate: date("scheduled_date"),
  deliveredAt: timestamp("delivered_at"),
  // Address snapshot at delivery time
  addressStreet: text("address_street"),
  addressNumber: text("address_number"),
  addressCity: text("address_city"),
  addressState: text("address_state"),
  addressZip: text("address_zip"),
  latitude: numeric("latitude", { precision: 10, scale: 7 }),
  longitude: numeric("longitude", { precision: 10, scale: 7 }),
  // Route position (order in the route)
  routePosition: integer("route_position"),
  // Estimated km from previous stop
  distanceFromPrev: numeric("distance_from_prev", { precision: 8, scale: 3 }),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type Delivery = typeof deliveries.$inferSelect;
export const insertDeliverySchema = createInsertSchema(deliveries).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDelivery = z.infer<typeof insertDeliverySchema>;

// ─── Route Stops (múltiplos CEPs por rota) ────────────────────────────────────
export const routeStops = pgTable("route_stops", {
  id: serial("id").primaryKey(),
  routeId: integer("route_id").references(() => logisticsRoutes.id).notNull(),
  cep: text("cep"),
  endereco: text("endereco"),
  numero: text("numero"),
  cidade: text("cidade"),
  estado: text("estado"),
  latitude: numeric("latitude", { precision: 10, scale: 7 }),
  longitude: numeric("longitude", { precision: 10, scale: 7 }),
  ordemParada: integer("ordem_parada").default(0),
  companyId: integer("company_id").references(() => companies.id),
  janelainicio: text("janela_inicio"),
  janelaFim: text("janela_fim"),
  tempoEstimadoMin: integer("tempo_estimado_min").default(8),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type RouteStop = typeof routeStops.$inferSelect;
export const insertRouteStopSchema = createInsertSchema(routeStops).omit({ id: true, createdAt: true });
export type InsertRouteStop = z.infer<typeof insertRouteStopSchema>;

// ─── AI Logs ─────────────────────────────────────────────────────────────────
export const aiLogs = pgTable("ai_logs", {
  id: serial("id").primaryKey(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  acao: text("acao").notNull(),
  arquivoAfetado: text("arquivo_afetado"),
  status: text("status").notNull().default("ok"),
  detalhes: text("detalhes"),
  userId: integer("user_id"),
  duracao: integer("duracao"),
});
export type AiLog = typeof aiLogs.$inferSelect;
export const insertAiLogSchema = createInsertSchema(aiLogs).omit({ id: true, createdAt: true });
export type InsertAiLog = z.infer<typeof insertAiLogSchema>;

// ─── Logistics Audit Logs ────────────────────────────────────────────────────
export const logisticsAuditLogs = pgTable("logistics_audit_logs", {
  id: serial("id").primaryKey(),
  usuarioId: integer("usuario_id"),
  usuarioEmail: text("usuario_email"),
  usuarioRole: text("usuario_role"),
  acao: text("acao").notNull(),
  modulo: text("modulo").notNull().default("logistica"),
  dataHora: timestamp("data_hora").defaultNow().notNull(),
  detalhes: text("detalhes"),
  entidadeId: integer("entidade_id"),
  entidadeTipo: text("entidade_tipo"),
});
export type LogisticsAuditLog = typeof logisticsAuditLogs.$inferSelect;
export const insertLogisticsAuditLogSchema = createInsertSchema(logisticsAuditLogs).omit({ id: true, dataHora: true });
export type InsertLogisticsAuditLog = z.infer<typeof insertLogisticsAuditLogSchema>;

// ─── Driver GPS Positions ─────────────────────────────────────────────────────
export const driverGpsPositions = pgTable("driver_gps_positions", {
  id: serial("id").primaryKey(),
  driverId: integer("driver_id").references(() => logisticsDrivers.id),
  latitude: numeric("latitude", { precision: 10, scale: 7 }).notNull(),
  longitude: numeric("longitude", { precision: 10, scale: 7 }).notNull(),
  accuracy: numeric("accuracy", { precision: 8, scale: 2 }),
  speed: numeric("speed", { precision: 8, scale: 2 }),
  heading: numeric("heading", { precision: 5, scale: 2 }),
  recordedAt: timestamp("recorded_at").defaultNow().notNull(),
});
export type DriverGpsPosition = typeof driverGpsPositions.$inferSelect;
export const insertDriverGpsPositionSchema = createInsertSchema(driverGpsPositions).omit({ id: true, recordedAt: true });
export type InsertDriverGpsPosition = z.infer<typeof insertDriverGpsPositionSchema>;

// ─── Delivery Checklists ──────────────────────────────────────────────────────
export const deliveryChecklists = pgTable("delivery_checklists", {
  id: serial("id").primaryKey(),
  deliveryId: integer("delivery_id").references(() => deliveries.id).notNull(),
  driverId: integer("driver_id").references(() => logisticsDrivers.id),
  entregaConfirmada: boolean("entrega_confirmada").default(false),
  observacao: text("observacao"),
  assinaturaUrl: text("assinatura_url"),
  fotoUrl: text("foto_url"),
  horarioEntrega: timestamp("horario_entrega").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type DeliveryChecklist = typeof deliveryChecklists.$inferSelect;
export const insertDeliveryChecklistSchema = createInsertSchema(deliveryChecklists).omit({ id: true, createdAt: true });
export type InsertDeliveryChecklist = z.infer<typeof insertDeliveryChecklistSchema>;

// ─── SaaS: Bancos de Recebimento ─────────────────────────────────────────────
export const bancosRecebimento = pgTable("bancos_recebimento", {
  id: serial("id").primaryKey(),
  nomeBanco: text("nome_banco").notNull(),
  tipoIntegracao: text("tipo_integracao").notNull().default("manual"), // manual | itau | bradesco | pix
  agencia: text("agencia"),
  conta: text("conta"),
  chavePix: text("chave_pix"),
  status: text("status").notNull().default("ativo"), // ativo | inativo
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type BancoRecebimento = typeof bancosRecebimento.$inferSelect;
export const insertBancoRecebimentoSchema = createInsertSchema(bancosRecebimento).omit({ id: true, createdAt: true });
export type InsertBancoRecebimento = z.infer<typeof insertBancoRecebimentoSchema>;

// ─── SaaS: Contratos de Clientes ─────────────────────────────────────────────
export const contratosClientes = pgTable("contratos_clientes", {
  id: serial("id").primaryKey(),
  empresaId: integer("empresa_id").references(() => companies.id).notNull(),
  planoId: integer("plano_id").references(() => planos.id),
  dataInicio: timestamp("data_inicio").defaultNow().notNull(),
  dataFim: timestamp("data_fim"),
  valorContrato: numeric("valor_contrato", { precision: 10, scale: 2 }).notNull(),
  tipoContrato: text("tipo_contrato").notNull().default("mensal"), // mensal | anual
  status: text("status").notNull().default("ativo"), // ativo | suspenso | cancelado
  arquivoContrato: text("arquivo_contrato"), // URL do PDF
  indiceReajuste: numeric("indice_reajuste", { precision: 5, scale: 2 }).default("0"),
  bancoDestinoId: integer("banco_destino_id").references(() => bancosRecebimento.id),
  observacoes: text("observacoes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type ContratoCliente = typeof contratosClientes.$inferSelect;
export const insertContratoClienteSchema = createInsertSchema(contratosClientes).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertContratoCliente = z.infer<typeof insertContratoClienteSchema>;

// ─── SaaS: Faturas SaaS ───────────────────────────────────────────────────────
export const faturasSaas = pgTable("faturas_saas", {
  id: serial("id").primaryKey(),
  empresaId: integer("empresa_id").references(() => companies.id).notNull(),
  contratoId: integer("contrato_id").references(() => contratosClientes.id),
  valor: numeric("valor", { precision: 10, scale: 2 }).notNull(),
  dataVencimento: timestamp("data_vencimento").notNull(),
  dataPagamento: timestamp("data_pagamento"),
  status: text("status").notNull().default("pendente"), // pendente | pago | atrasado | cancelado
  metodoPagamento: text("metodo_pagamento"), // pix | boleto | cartao | transferencia
  bancoDestino: text("banco_destino"),
  linkPagamento: text("link_pagamento"),
  observacoes: text("observacoes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type FaturaSaas = typeof faturasSaas.$inferSelect;
export const insertFaturaSaasSchema = createInsertSchema(faturasSaas).omit({ id: true, createdAt: true });
export type InsertFaturaSaas = z.infer<typeof insertFaturaSaasSchema>;

// ─── Gestão de Versões e Atualizações do Sistema ─────────────────────────────
export const systemVersions = pgTable("system_versions", {
  id: serial("id").primaryKey(),
  versionName: text("version_name").notNull(),
  descricao: text("descricao"),
  changelog: text("changelog"),
  dataLancamento: timestamp("data_lancamento").defaultNow().notNull(),
  tipoVersao: text("tipo_versao").notNull().default("stable"), // stable | beta | hotfix
  status: text("status").notNull().default("ativa"), // ativa | inativa
  criadoPor: text("criado_por"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type SystemVersion = typeof systemVersions.$inferSelect;
export const insertSystemVersionSchema = createInsertSchema(systemVersions).omit({ id: true, createdAt: true });
export type InsertSystemVersion = z.infer<typeof insertSystemVersionSchema>;

export const systemUpdates = pgTable("system_updates", {
  id: serial("id").primaryKey(),
  versionId: integer("version_id").references(() => systemVersions.id).notNull(),
  empresaId: integer("empresa_id").references(() => companies.id).notNull(),
  dataAplicacao: timestamp("data_aplicacao").defaultNow().notNull(),
  status: text("status").notNull().default("pendente"), // pendente | aplicado | erro | rollback
  detalhes: text("detalhes"),
  aplicadoPor: text("aplicado_por"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type SystemUpdate = typeof systemUpdates.$inferSelect;
export const insertSystemUpdateSchema = createInsertSchema(systemUpdates).omit({ id: true, createdAt: true });
export type InsertSystemUpdate = z.infer<typeof insertSystemUpdateSchema>;

export const updateLogs = pgTable("update_logs", {
  id: serial("id").primaryKey(),
  empresaId: integer("empresa_id").references(() => companies.id),
  versao: text("versao").notNull(),
  dataAtualizacao: timestamp("data_atualizacao").defaultNow().notNull(),
  status: text("status").notNull(), // aplicado | erro | rollback
  detalhes: text("detalhes"),
  operador: text("operador"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type UpdateLog = typeof updateLogs.$inferSelect;
export const insertUpdateLogSchema = createInsertSchema(updateLogs).omit({ id: true, createdAt: true });
export type InsertUpdateLog = z.infer<typeof insertUpdateLogSchema>;

// ─── SaaS: Módulos do Sistema ─────────────────────────────────────────────────
export const modulosSistema = pgTable("modulos_sistema", {
  id: serial("id").primaryKey(),
  chave: text("chave").notNull().unique(), // ex: 'dashboard', 'logistica', 'gps', 'ia'
  nomeModulo: text("nome_modulo").notNull(),
  rota: text("rota"), // rota no frontend ex: '/admin/logistics'
  descricao: text("descricao"),
  icone: text("icone"),
  categoria: text("categoria").default("geral"), // geral | logistica | financeiro | admin
  ativo: boolean("ativo").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type ModuloSistema = typeof modulosSistema.$inferSelect;
export const insertModuloSistemaSchema = createInsertSchema(modulosSistema).omit({ id: true, createdAt: true });
export type InsertModuloSistema = z.infer<typeof insertModuloSistemaSchema>;

// ─── SaaS: Plano × Módulos ───────────────────────────────────────────────────
export const planoModulos = pgTable("plano_modulos", {
  id: serial("id").primaryKey(),
  planoId: integer("plano_id").references(() => planos.id).notNull(),
  moduloId: integer("modulo_id").references(() => modulosSistema.id).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type PlanoModulo = typeof planoModulos.$inferSelect;
export const insertPlanoModuloSchema = createInsertSchema(planoModulos).omit({ id: true, createdAt: true });
export type InsertPlanoModulo = z.infer<typeof insertPlanoModuloSchema>;

// ─── SaaS: Métricas Financeiras ──────────────────────────────────────────────
export const saasMetrics = pgTable("saas_metrics", {
  id: serial("id").primaryKey(),
  empresasAtivas: integer("empresas_ativas").default(0).notNull(),
  assinaturasAtivas: integer("assinaturas_ativas").default(0).notNull(),
  faturamentoMensal: numeric("faturamento_mensal", { precision: 12, scale: 2 }).default("0").notNull(),
  faturamentoAnual: numeric("faturamento_anual", { precision: 12, scale: 2 }).default("0").notNull(),
  planosAtivos: integer("planos_ativos").default(0).notNull(),
  empresasTrial: integer("empresas_trial").default(0).notNull(),
  totalUsuarios: integer("total_usuarios").default(0).notNull(),
  totalPedidos: integer("total_pedidos").default(0).notNull(),
  periodo: text("periodo").notNull(), // ex: '2026-03'
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type SaasMetrics = typeof saasMetrics.$inferSelect;
export const insertSaasMetricsSchema = createInsertSchema(saasMetrics).omit({ id: true, createdAt: true });
export type InsertSaasMetrics = z.infer<typeof insertSaasMetricsSchema>;

// ─── White Label: Configuração por Empresa ────────────────────────────────────
export const empresaConfig = pgTable("empresa_config", {
  id: serial("id").primaryKey(),
  empresaId: integer("empresa_id").references(() => companies.id).notNull().unique(),
  logoEmpresa: text("logo_empresa"), // base64
  logoType: text("logo_type").default("image/png"),
  corPrimaria: text("cor_primaria").default("#22c55e"),
  corSecundaria: text("cor_secundaria").default("#16a34a"),
  dominioPersonalizado: text("dominio_personalizado"),
  nomePersonalizado: text("nome_personalizado"),
  sloganPersonalizado: text("slogan_personalizado"),
  gpsManualOverride: boolean("gps_manual_override").default(false), // liberar GPS mesmo fora do plano
  ativo: boolean("ativo").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type EmpresaConfig = typeof empresaConfig.$inferSelect;
export const insertEmpresaConfigSchema = createInsertSchema(empresaConfig).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEmpresaConfig = z.infer<typeof insertEmpresaConfigSchema>;

// ─── Marketplace: Módulos Disponíveis ────────────────────────────────────────
export const modulosMarketplace = pgTable("modulos_marketplace", {
  id: serial("id").primaryKey(),
  nomeModulo: text("nome_modulo").notNull(),
  descricao: text("descricao"),
  preco: numeric("preco", { precision: 10, scale: 2 }).default("0").notNull(),
  categoria: text("categoria").notNull().default("geral"), // geral | logistica | financeiro | ia | integracao
  icone: text("icone").default("Package"),
  versao: text("versao").default("1.0.0"),
  changelog: text("changelog"),
  destaque: boolean("destaque").default(false).notNull(),
  ativo: boolean("ativo").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type ModuloMarketplace = typeof modulosMarketplace.$inferSelect;
export const insertModuloMarketplaceSchema = createInsertSchema(modulosMarketplace).omit({ id: true, createdAt: true });
export type InsertModuloMarketplace = z.infer<typeof insertModuloMarketplaceSchema>;

// ─── Marketplace: Módulos Instalados por Empresa ──────────────────────────────
export const empresaModulos = pgTable("empresa_modulos", {
  id: serial("id").primaryKey(),
  empresaId: integer("empresa_id").references(() => companies.id).notNull(),
  moduloId: integer("modulo_id").references(() => modulosMarketplace.id).notNull(),
  status: text("status").notNull().default("ativo"), // ativo | inativo | pendente
  dataInstalacao: timestamp("data_instalacao").defaultNow().notNull(),
  versaoInstalada: text("versao_instalada").default("1.0.0"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type EmpresaModulo = typeof empresaModulos.$inferSelect;
export const insertEmpresaModuloSchema = createInsertSchema(empresaModulos).omit({ id: true, createdAt: true, dataInstalacao: true });
export type InsertEmpresaModulo = z.infer<typeof insertEmpresaModuloSchema>;

// ─── Vigilância Sanitária: Perguntas do Checklist ────────────────────────────
export const sanitaryQuestions = pgTable("sanitary_questions", {
  id: serial("id").primaryKey(),
  question: text("question").notNull(),
  category: text("category").notNull().default("geral"), // higiene | temperatura | armazenamento | pessoal | equipamentos | geral
  order: integer("order").default(0).notNull(),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type SanitaryQuestion = typeof sanitaryQuestions.$inferSelect;
export const insertSanitaryQuestionSchema = createInsertSchema(sanitaryQuestions).omit({ id: true, createdAt: true });
export type InsertSanitaryQuestion = z.infer<typeof insertSanitaryQuestionSchema>;

// ─── Vigilância Sanitária: Avaliações ────────────────────────────────────────
export const sanitaryEvaluations = pgTable("sanitary_evaluations", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  evaluatorId: integer("evaluator_id"),
  evaluatorName: text("evaluator_name"),
  companyId: integer("company_id").references(() => companies.id),
  status: text("status").notNull().default("em_andamento"), // em_andamento | concluida
  score: numeric("score", { precision: 5, scale: 2 }), // % calculado
  notes: text("notes"),
  evaluationDate: timestamp("evaluation_date").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type SanitaryEvaluation = typeof sanitaryEvaluations.$inferSelect;
export const insertSanitaryEvaluationSchema = createInsertSchema(sanitaryEvaluations).omit({ id: true, createdAt: true });
export type InsertSanitaryEvaluation = z.infer<typeof insertSanitaryEvaluationSchema>;

// ─── Vigilância Sanitária: Itens da Avaliação ────────────────────────────────
export const sanitaryEvaluationItems = pgTable("sanitary_evaluation_items", {
  id: serial("id").primaryKey(),
  evaluationId: integer("evaluation_id").references(() => sanitaryEvaluations.id).notNull(),
  questionId: integer("question_id").references(() => sanitaryQuestions.id).notNull(),
  questionText: text("question_text").notNull(), // snapshot da pergunta no momento da avaliação
  questionCategory: text("question_category").notNull().default("geral"),
  result: text("result"), // 'ok' | 'nok' | null (não respondido)
  observation: text("observation"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type SanitaryEvaluationItem = typeof sanitaryEvaluationItems.$inferSelect;
export const insertSanitaryEvaluationItemSchema = createInsertSchema(sanitaryEvaluationItems).omit({ id: true, createdAt: true });
export type InsertSanitaryEvaluationItem = z.infer<typeof insertSanitaryEvaluationItemSchema>;

// ─── Price Adjustment Snapshots ───────────────────────────────────────────────
// Records every applied price adjustment so an admin can review history and,
// when needed, roll back a specific batch. Each row captures one entity
// (product or sub-category) participating in a batch identified by `batchId`.
export const priceAdjustmentSnapshots = pgTable("price_adjustment_snapshots", {
  id: serial("id").primaryKey(),
  batchId: text("batch_id").notNull(),               // groups all rows of one apply call
  entityType: text("entity_type").notNull(),         // 'product' | 'subcategory'
  entityId: integer("entity_id").notNull(),
  oldPrice: numeric("old_price", { precision: 10, scale: 2 }).notNull(),
  newPrice: numeric("new_price", { precision: 10, scale: 2 }).notNull(),
  percentage: numeric("percentage", { precision: 10, scale: 4 }).notNull(),
  appliedBy: integer("applied_by"),                  // user id of the admin who applied
  appliedAt: timestamp("applied_at").defaultNow().notNull(),
  rolledBackAt: timestamp("rolled_back_at"),         // null = still active
}, (table) => ({
  batchIdIdx: index("price_adjustment_snapshots_batch_id_idx").on(table.batchId),
}));
export type PriceAdjustmentSnapshot = typeof priceAdjustmentSnapshots.$inferSelect;

// ─── Workflow Event Outbox ─────────────────────────────────────────────────────
// Transactional outbox for workflow side-effects (push notifications, audit logs).
// Events are written atomically inside the order transition transaction so they
// are guaranteed to exist if and only if the transition committed.
// A background worker processes them asynchronously with retry semantics.
export const workflowEvents = pgTable("workflow_events", {
  id:           serial("id").primaryKey(),
  orderId:      integer("order_id").notNull(),
  eventType:    text("event_type").notNull(),      // always 'TRANSITION' for now
  payload:      jsonb("payload").notNull(),         // WorkflowEventPayload (see below)
  processedAt:  timestamp("processed_at"),          // NULL = pending
  errorMessage: text("error_message"),              // last error (if any)
  retryCount:   integer("retry_count").default(0).notNull(),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
});
export type WorkflowEvent = typeof workflowEvents.$inferSelect;

/** Strongly-typed payload stored as JSONB in workflow_events.payload */
export interface WorkflowEventPayload {
  orderId:     number;
  orderCode:   string | null;
  companyId:   number;
  from:        string;
  to:          string;
  actor:       { id: number; email: string; role: string; name?: string };
  result: {
    preNotaNumber?:          string | null;
    inventoryLinesDeducted?: number;
    arCreated?:              boolean;
    deliveryUpdated?:        boolean;
  };
}

// ─── STEP 9.3E — Histórico persistente do Cron de Faturamento ────────────────
// Cada execução do cron de faturamento (agendada às 08:00 ou disparada manualmente)
// grava uma linha aqui com o resumo. Sem PII; apenas contadores agregados.
export const cronFaturamentoRuns = pgTable("cron_faturamento_runs", {
  id:           serial("id").primaryKey(),
  executedAt:   timestamp("executed_at").defaultNow().notNull(),
  triggeredBy:  text("triggered_by").notNull(),  // 'schedule' | 'manual'
  total:        integer("total").notNull().default(0),
  success:      integer("success").notNull().default(0),
  blocked:      integer("blocked").notNull().default(0),
  errors:       integer("errors").notNull().default(0),
  triggeredByUserId: integer("triggered_by_user_id"), // nullable: schedule não tem user
});
export type CronFaturamentoRun = typeof cronFaturamentoRuns.$inferSelect;

// ─── STEP 9.3F.4 — Persistência durável dos alertas operacionais ─────────────
// Cada disparo (ou bloqueio por rate-limit) do emitAlert(...) grava uma linha
// aqui para auditoria histórica. A store em memória continua existindo como
// cache rápido — esta tabela é a fonte da verdade após restart.
export const cronAlertLogs = pgTable(
  "cron_alert_logs",
  {
    id:          serial("id").primaryKey(),
    createdAt:   timestamp("created_at").defaultNow().notNull(),
    severity:    text("severity").notNull(),       // 'ALERT' | 'CRITICAL'
    title:       text("title").notNull(),
    message:     text("message").notNull(),
    results:     jsonb("results").notNull(),       // Array<{ channel, target?, ok, reason? }>
    rateLimited: boolean("rate_limited").notNull().default(false),
    // STEP 9.3F.6 — flag adicional pra auto-supressão inteligente.
    // Importante: NÃO compartilha métrica com rate_limited. Linhas suprimidas
    // são gravadas com rate_limited=false + suppressed=true (decisão do spec).
    suppressed:  boolean("suppressed").notNull().default(false),
    context:     jsonb("context"),                 // opcional: payload bruto do alerta
  },
  // STEP 9.3F.4.A — índice em created_at para acelerar orderBy/desc + prune por janela.
  (table) => ({
    createdAtIdx: index("cron_alert_logs_created_at_idx").on(table.createdAt),
  }),
);
export type CronAlertLog = typeof cronAlertLogs.$inferSelect;

// ─── STEP 9.3F.11 — Preferências de notificação por usuário ──────────────────
// Cada linha = preferência de UM usuário para UMA categoria.
// (userId, category) é único — usado para upsert idempotente.
// Esta tabela é só ESTRUTURA: nenhum endpoint de envio a consulta ainda.
export const userNotificationPreferences = pgTable(
  "user_notification_preferences",
  {
    id:          serial("id").primaryKey(),
    userId:      integer("user_id")
                   .notNull()
                   .references(() => users.id, { onDelete: "cascade" }),
    category:    text("category").notNull(),                // ex: TECH, FINANCE, OPERATIONS
    minSeverity: text("min_severity").notNull().default("WARNING"), // INFO|WARNING|ALERT|CRITICAL
    enabled:     boolean("enabled").notNull().default(true),
  },
  (table) => ({
    userIdx: index("user_notification_preferences_user_idx").on(table.userId),
    userCategoryUnique: uniqueIndex("user_notification_preferences_user_category_uniq")
      .on(table.userId, table.category),
  }),
);
export const insertUserNotificationPreferenceSchema =
  createInsertSchema(userNotificationPreferences).omit({ id: true });
export type InsertUserNotificationPreference =
  z.infer<typeof insertUserNotificationPreferenceSchema>;
export type UserNotificationPreference =
  typeof userNotificationPreferences.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// FASE NF.7.9.2 — Fechamento mensal fiscal (TRAVAR PERÍODO).
//
// Mecanismo aditivo — bloqueia mutações em períodos já consolidados (SPED,
// contabilidade fechada). Sem unique constraint nesta fase para evitar
// migration complexa; duplicidade é tolerada (isPeriodClosed faz EXISTS,
// não count). Comportamento atual permanece intacto se a tabela estiver
// vazia para o tenant.
// ─────────────────────────────────────────────────────────────────────────────
export const fiscalClosures = pgTable("fiscal_closures", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  year: integer("year").notNull(),
  month: integer("month").notNull(),
  closedAt: timestamp("closed_at").defaultNow(),
});
export const insertFiscalClosureSchema = createInsertSchema(fiscalClosures).omit({
  id: true,
  closedAt: true,
});
export type InsertFiscalClosure = z.infer<typeof insertFiscalClosureSchema>;
export type FiscalClosure = typeof fiscalClosures.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// BANCO.5 — Histórico de importações de retorno CNAB (Itaú)
//
// Tabela puramente aditiva: registra cada upload processado pelo endpoint
// POST /api/bank/retorno/itau (BANCO.3). Não interfere em nenhuma rotina
// existente; apenas guarda metadata + contadores devolvidos pelo serviço
// para fins de auditoria operacional. companyId é opcional porque o
// fluxo financeiro atual ainda não escopa AR por tenant.
// ─────────────────────────────────────────────────────────────────────────────
export const cnabImportHistory = pgTable("cnab_import_history", {
  id: serial("id").primaryKey(),
  fileName: text("file_name").notNull(),
  // BANCO.6 — hash SHA-256 do conteúdo do arquivo. UNIQUE bloqueia
  // reprocessamento exato do mesmo .ret. Nullable apenas para coexistir
  // com registros legados pré-BANCO.6 (não é populado neles).
  fileHash: text("file_hash").unique(),
  totalProcessados: integer("total_processados").notNull().default(0),
  pagosIdentificados: integer("pagos_identificados").notNull().default(0),
  baixasRealizadas: integer("baixas_realizadas").notNull().default(0),
  jaPagas: integer("ja_pagas").notNull().default(0),
  naoEncontrados: integer("nao_encontrados").notNull().default(0),
  erros: integer("erros").notNull().default(0),
  companyId: integer("company_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export const insertCnabImportHistorySchema = createInsertSchema(cnabImportHistory).omit({
  id: true,
  createdAt: true,
});
export type InsertCnabImportHistory = z.infer<typeof insertCnabImportHistorySchema>;
export type CnabImportHistory = typeof cnabImportHistory.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// FASE 6.2 — Persistência de eventos de tenant mismatch (auditoria real)
//
// Tabela puramente aditiva. Cada vez que `validateOrderTenant` detecta
// uma tentativa de acesso cruzado entre tenants, um registro é gravado
// aqui em paralelo ao log `[SECURITY] TENANT_MISMATCH`. O log original
// continua existindo — esta tabela é apenas a base persistente para o
// endpoint admin de auditoria (FASE 6.1).
//
// Todos os campos são opcionais (exceto id/createdAt) para garantir que
// uma falha de coleta de contexto (ex.: req ausente) nunca bloqueie a
// gravação do evento — auditoria fail-open por design.
// ─────────────────────────────────────────────────────────────────────────────
export const tenantMismatchEvents = pgTable("tenant_mismatch_events", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id"),
  orderId: integer("order_id"),
  userId: integer("user_id"),
  email: text("email"),
  path: text("path"),
  method: text("method"),
  createdAt: timestamp("created_at").defaultNow(),
});
export type TenantMismatchEvent = typeof tenantMismatchEvents.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// FASE 6.9 — Bloqueio persistente (DB + cache em memória).
// Cada bloqueio gerado por `blockUser` em memória é replicado aqui,
// com `blocked_until` = now + BLOCK_TIME_MS. Após restart do processo,
// `safeGetOrder` consulta esta tabela para re-hidratar a memória e
// continuar honrando bloqueios ativos. NÃO substitui o blocker
// in-memory — apenas o complementa como camada de durabilidade.
// ─────────────────────────────────────────────────────────────────────────────
export const securityBlockedUsers = pgTable("security_blocked_users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  blockedUntil: timestamp("blocked_until").notNull(),
  reason: text("reason"),
  createdAt: timestamp("created_at").defaultNow(),
});
export type SecurityBlockedUser = typeof securityBlockedUsers.$inferSelect;
