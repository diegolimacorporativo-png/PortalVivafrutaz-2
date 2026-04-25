import { z } from "zod";
import { insertProductSchema } from "@shared/schema";

export const createProductSchema = insertProductSchema;
export const updateProductSchema = insertProductSchema.partial();

export const productIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});
