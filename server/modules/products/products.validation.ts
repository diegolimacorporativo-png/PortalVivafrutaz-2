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
});

export const updateProductSchema = createProductSchema.partial();

export const productIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});
