import { z } from "zod";

export const PRODUCTION_INCLUDE_STATUSES = [
  "APPROVED",
] as const;

export const generateBatchBodySchema = z.object({
  productionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida (YYYY-MM-DD)")
    .refine((value) => {
      const date = new Date(`${value}T00:00:00.000Z`);
      return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
    }, "Data de produção inexistente"),
  previewFingerprint: z.string().regex(/^[a-f0-9]{64}$/, "Prévia inválida ou desatualizada"),
});

export const batchIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const productionExportParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
  kind: z.enum(["in-natura", "processed"]),
});

export const productionExportQuerySchema = z.object({
  shift: z.enum(["morning", "afternoon"]).optional(),
});

export const updateBatchStatusBodySchema = z.object({
  status: z.enum(["PENDENTE", "EM_PRODUCAO", "CONFERIDO", "FINALIZADO"]),
  notes: z.string().optional(),
});

export const updateItemCheckBodySchema = z.object({
  checkedQuantity: z.coerce.number().min(0),
  notes: z.string().optional(),
});

export const listBatchesQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.string().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export const productionConsolidationQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida (YYYY-MM-DD)")
    .refine((value) => {
      const date = new Date(`${value}T00:00:00.000Z`);
      return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
    }, "Data de produção inexistente"),
});

export type GenerateBatchBody = z.infer<typeof generateBatchBodySchema>;
export type UpdateBatchStatusBody = z.infer<typeof updateBatchStatusBodySchema>;
export type UpdateItemCheckBody = z.infer<typeof updateItemCheckBodySchema>;
export type ListBatchesQuery = z.infer<typeof listBatchesQuerySchema>;
export type ProductionConsolidationQuery = z.infer<typeof productionConsolidationQuerySchema>;
