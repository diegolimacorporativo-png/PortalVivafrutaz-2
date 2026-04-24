import { z } from "zod";
import {
  insertAccountReceivableSchema,
  insertAccountPayableSchema,
  insertFinancialTransactionSchema,
} from "@shared/schema";

/**
 * Validation layer for the finance module.
 *
 * Architecture decision: we extend the auto-generated Drizzle insert schemas
 * (single source of truth from `@shared/schema`) and tighten them where the
 * HTTP layer needs stricter rules than the database. The controller never
 * touches Zod directly — it receives parsed, typed data via validateRequest.
 */

// ── Accounts Receivable ──────────────────────────────────────────────────
export const createAccountReceivableSchema = insertAccountReceivableSchema.extend({
  descricao: z.string().min(1, "Descrição é obrigatória"),
  valor: z.union([z.string(), z.number()]).transform(String),
});

export const updateAccountReceivableSchema =
  insertAccountReceivableSchema.partial();

export const accountsReceivableQuerySchema = z.object({
  status: z.string().optional(),
  companyId: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => (v === undefined || v === "" ? undefined : Number(v))),
});

// ── Accounts Payable ─────────────────────────────────────────────────────
export const createAccountPayableSchema = insertAccountPayableSchema.extend({
  descricao: z.string().min(1, "Descrição é obrigatória"),
  fornecedor: z.string().min(1, "Fornecedor é obrigatório"),
  valor: z.union([z.string(), z.number()]).transform(String),
});

export const updateAccountPayableSchema = insertAccountPayableSchema.partial();

export const accountsPayableQuerySchema = z.object({
  status: z.string().optional(),
});

// ── Cashflow ─────────────────────────────────────────────────────────────
export const cashflowQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});

export const createCashflowEntrySchema = insertFinancialTransactionSchema;

// ── Path params ──────────────────────────────────────────────────────────
export const idParamSchema = z.object({
  id: z
    .union([z.string(), z.number()])
    .transform((v) => Number(v))
    .refine((n) => Number.isInteger(n) && n > 0, { message: "ID inválido" }),
});
