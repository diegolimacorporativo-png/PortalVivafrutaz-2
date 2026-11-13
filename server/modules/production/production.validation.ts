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

export const manualBatchItemBodySchema = z.object({
  companyId: z.coerce.number().int().positive(),
  productId: z.coerce.number().int().positive(),
  subCategoryId: z.coerce.number().int().positive().nullable().optional(),
  quantity: z.coerce.number().finite().positive(),
  classification: z.enum(["IN_NATURA", "PROCESSADOS"]),
  manualReference: z.string().trim().max(100).optional(),
  justification: z.string().trim().min(5).max(500),
  requestId: z.string().uuid(),
});

export const manualExportMappingBodySchema = z.object({
  batchItemId: z.coerce.number().int().positive(),
  sourceKey: z.string().trim().min(1).max(100),
  destination: z.enum(["IN_NATURA", "PROCESSADOS"]),
  excelHeader: z.string().trim().min(1).max(120).optional(),
  packaging: z.enum(["BIO_100G", "P07_PLASTIC_100G", "POT_200G", "PET", "KG"]).optional(),
  justification: z.string().trim().min(5).max(500),
}).superRefine((value, ctx) => {
  if (value.destination === "IN_NATURA" && !value.excelHeader) ctx.addIssue({ code: "custom", path: ["excelHeader"], message: "Informe o cabeçalho exato do modelo In Natura" });
  if (value.destination === "PROCESSADOS" && !value.packaging) ctx.addIssue({ code: "custom", path: ["packaging"], message: "Selecione o bloco de embalagem do modelo Processados" });
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
export type ManualBatchItemBody = z.infer<typeof manualBatchItemBodySchema>;
export type ManualExportMappingBody = z.infer<typeof manualExportMappingBodySchema>;
