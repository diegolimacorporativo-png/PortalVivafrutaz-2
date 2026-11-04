import { z } from "zod";
import { insertProductSchema } from "@shared/schema";

const basePriceField = z
  .union([z.number(), z.string()])
  .nullable()
  .optional()
  .refine(
    (v) => v == null || v === "" || (Number(v) >= 0 && !isNaN(Number(v))),
    { message: "Preço base é obrigatório e deve ser maior ou igual a zero" },
  )
  .transform((v) => {
    if (v == null || v === "") return null;
    return String(Number(v));
  });

export const createProductSchema = insertProductSchema.extend({
  basePrice: basePriceField,
  productionClassification: z.enum(["IN_NATURA", "PROCESSADOS"]).nullable().optional(),
});

export const updateProductSchema = createProductSchema.partial();

export const productIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const createProductAliasBodySchema = z.object({
  alias: z.string().trim().min(1).max(200),
  companyId: z.coerce.number().int().positive().nullable().optional(),
  global: z.boolean().optional().default(false),
  globalJustification: z.string().trim().max(500).optional(),
});

export const resolveProductIdentityBodySchema = z.object({
  description: z.string().trim().min(1).max(200),
  companyId: z.coerce.number().int().positive(),
  category: z.string().trim().max(100).nullable().optional(),
  unit: z.string().trim().max(50).nullable().optional(),
});

export const productAliasIdParamSchema = z.object({
  aliasId: z.coerce.number().int().positive(),
});

export const revokeProductAliasBodySchema = z.object({
  reason: z.string().trim().min(10).max(500),
});
