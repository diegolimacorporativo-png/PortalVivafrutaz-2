import { z } from "zod";
import {
  insertCompanySchema,
  insertContractScopeSchema,
  insertContractAdjustmentSchema,
  insertCompanyAddressSchema,
} from "@shared/schema";

/**
 * Validation layer for the companies module.
 *
 * Architecture decision: we extend the auto-generated Drizzle insert schemas
 * (single source of truth from `@shared/schema`) and tighten them where the
 * HTTP layer needs stricter rules than the database. Controllers never touch
 * Zod directly — they receive parsed, typed data via validateRequest.
 */

// ── Path params ──────────────────────────────────────────────────────────
const numericId = z
  .union([z.string(), z.number()])
  .transform((v) => Number(v))
  .refine((n) => Number.isInteger(n) && n > 0, { message: "ID inválido" });

export const idParamSchema = z.object({ id: numericId });

export const scopeParamSchema = z.object({
  id: numericId,
  scopeId: numericId,
});

export const adjParamSchema = z.object({
  id: numericId,
  adjId: numericId,
});

export const addressParamSchema = z.object({
  companyId: numericId,
  addrId: numericId,
});

// ── Companies CRUD ──────────────────────────────────────────────────────
export const createCompanySchema = insertCompanySchema;
export const updateCompanySchema = insertCompanySchema.partial();

// ── /my/preferred-order-type (company portal self-service) ──────────────
export const updatePreferredOrderTypeSchema = z.object({
  preferredOrderType: z.enum(["semanal", "mensal", "pontual"], {
    errorMap: () => ({ message: "Tipo inválido" }),
  }),
});

// ── /delivery-suggestions ───────────────────────────────────────────────
export const deliverySuggestionsQuerySchema = z.object({
  city: z.string().optional(),
});

// ── Contract scopes ─────────────────────────────────────────────────────
export const createContractScopeBodySchema = z.object({
  dayOfWeek: z.string().min(1, "Dia da semana obrigatório"),
  weekNumber: z.number().int().nullable().optional(),
  scopeCategory: z.string().nullable().optional(),
  productId: z.union([z.string(), z.number()]).transform((v) => Number(v)),
  quantity: z
    .union([z.string(), z.number()])
    .transform((v) => Number(v) || 1)
    .optional(),
  unitPrice: z
    .union([z.string(), z.number(), z.null()])
    .optional()
    .transform((v) => (v == null || v === "" ? null : String(v))),
  averageCost: z
    .union([z.string(), z.number(), z.null()])
    .optional()
    .transform((v) => (v == null || v === "" ? null : String(v))),
  observation: z.string().nullable().optional(),
});

export const updateContractScopeBodySchema = createContractScopeBodySchema
  .partial()
  .extend({
    productId: z
      .union([z.string(), z.number()])
      .transform((v) => Number(v))
      .optional(),
  });

// ── Contract management ─────────────────────────────────────────────────
export const updateContractInfoSchema = z.object({
  contractStartDate: z.string().nullable().optional(),
  contractEndDate: z.string().nullable().optional(),
  contractVigencia: z
    .enum(["prazo_indefinido", "prazo_determinado"])
    .nullable()
    .optional(),
});

export const createContractAdjustmentBodySchema = insertContractAdjustmentSchema
  .omit({ companyId: true, responsibleUserId: true, responsibleEmail: true });

export const updateContractAdjustmentBodySchema = insertContractAdjustmentSchema
  .partial()
  .omit({ companyId: true, responsibleUserId: true, responsibleEmail: true });

export const sendAdjustmentEmailBodySchema = z.object({
  emailSubject: z.string().optional(),
  emailBody: z.string().optional(),
});

// ── Company addresses ───────────────────────────────────────────────────
export const createCompanyAddressBodySchema = insertCompanyAddressSchema.omit({
  companyId: true,
});
export const updateCompanyAddressBodySchema =
  insertCompanyAddressSchema.partial();

// ── GPS ─────────────────────────────────────────────────────────────────
export const gpsToggleSchema = z.object({
  enabled: z.boolean(),
});
