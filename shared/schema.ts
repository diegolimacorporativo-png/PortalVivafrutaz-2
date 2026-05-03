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
  tabPermissions: jsonb("tab_permissions"),
  testMode: boolean("test_mode").default(false).notNull(),
  permissions: jsonb("permissions"),
  loginAttempts: integer("login_attempts").default(0).notNull(),
  isLocked: boolean("is_locked").default(false).notNull(),
  lastLoginAttempt: timestamp("last_login_attempt"),
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
  companyName: text("company_name").notNull(),
  contactName: text("contact_name").notNull(),
  email: text("email").notNull().unique(),
  notificationEmail: text("notification_email"),
  password: text("password").notNull(),
  phone: text("phone"),
  cnpj: text("cnpj"),
  priceGroupId: integer("price_group_id").references(() => priceGroups.id),
  allowedOrderDays: jsonb("allowed_order_days").notNull(),
  addressStreet: text("address_street"),
  addressNumber: text("address_number"),
  addressNeighborhood: text("address_neighborhood"),
  addressCity: text("address_city"),
  addressZip: text("address_zip"),
  active: boolean("active").default(true).notNull(),
  clientType: text("client_type").default("mensal"),
  contractModel: text("contract_model"),
  minWeeklyBilling: numeric("min_weekly_billing", { precision: 10, scale: 2 }),
  deliveryTime: text("delivery_time"),
  latitude: numeric("latitude", { precision: 10, scale: 7 }),
  longitude: numeric("longitude", { precision: 10, scale: 7 }),
  deliveryConfigJson: text("delivery_config_json"),
  adminFee: numeric("admin_fee", { precision: 5, scale: 2 }).default("0"),
  useNewPricing: boolean("use_new_pricing").default(false).notNull(),
  billingTerm: text("billing_term"),
  billingType: text("billing_type"),
  billingFormat: text("billing_format"),
  billingModel: text("billing_model").default("STANDARD").notNull(),
  useFiscalDraft: boolean("use_fiscal_draft").default(false).notNull(),
  paymentDates: text("payment_dates"),
  financialNotes: text("financial_notes"),
  stateRegistration: text("state_registration"),
  addressState: text("address_state"),
  addressIbge: text("address_ibge"),
  regimeTributario: text("regime_tributario"),
});

export const systemAlerts = pgTable("system_alerts", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  severity: text("severity").notNull(),
  entityType: text("entity_type"),
  entityId: text("entity_id"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at"),
  tenantId: text("tenant_id"),
});
export type SystemAlert = typeof systemAlerts.$inferSelect;
export const insertSystemAlertSchema = createInsertSchema(systemAlerts).omit({ createdAt: true });
export type InsertSystemAlert = z.infer<typeof insertSystemAlertSchema>;

export const systemPolicies = pgTable("system_policies", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  condition: jsonb("condition").notNull(),
  action: jsonb("action").notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  priority: integer("priority").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  tenantId: text("tenant_id"),
});
export type SystemPolicy = typeof systemPolicies.$inferSelect;
export const insertSystemPolicySchema = createInsertSchema(systemPolicies).omit({ id: true, createdAt: true });
export type InsertSystemPolicy = z.infer<typeof insertSystemPolicySchema>;

export const auditLogs = pgTable("audit_logs", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  tenantId: text("tenant_id").notNull(),
  action: text("action").notNull(),
  resource: text("resource").notNull(),
  queryHash: text("query_hash").notNull(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
});
export type AuditLog = typeof auditLogs.$inferSelect;
export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({ timestamp: true });
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;

export const insertSystemLogSchema = createInsertSchema(systemLogs).omit({ id: true, createdAt: true });
export type SystemLog = typeof systemLogs.$inferSelect;
export type InsertSystemLog = z.infer<typeof insertSystemLogSchema>;

export const insertOrderSchema = createInsertSchema(orders).omit({ id: true, createdAt: true, orderCode: true });
export const insertOrderItemSchema = createInsertSchema(orderItems).omit({ id: true });
export const insertSpecialOrderRequestSchema = createInsertSchema(specialOrderRequests).omit({ id: true, createdAt: true, resolvedAt: true });
export const insertContractScopeSchema = createInsertSchema(contractScopes).omit({ id: true });
export const insertPasswordResetRequestSchema = createInsertSchema(passwordResetRequests).omit({ id: true, createdAt: true, resolvedAt: true });
