/**
 * FASE 8.6A — VALIDAÇÃO FISCAL RUNTIME (SHADOW MODE)
 *
 * Schemas Zod que refletem `NFeProduto` e o subset crítico de `NFeInput`
 * (server/modules/nfe/types.ts). São usados em SHADOW MODE pelo builder:
 * apenas validam e LOGAM divergências; nunca lançam, nunca bloqueiam
 * emissão.
 *
 * Regra de mínimo: validar só o que tem efeito direto na NF-e
 * (orderId + produtos[]: cProd, xProd, ncm, cfop, uCom, qCom, vUnCom,
 * vProd). `emitente`/`destinatario` continuam fora do schema (regra #5
 * da FASE 8.5).
 */
import { z } from "zod";

export const NFeProdutoSchema = z.object({
  cProd: z.string(),
  xProd: z.string(),
  ncm: z.string().min(1),
  cfop: z.string().min(1),
  uCom: z.string().min(1),
  qCom: z.number().positive(),
  vUnCom: z.number().nonnegative(),
  vProd: z.number().nonnegative(),
});

export const NFeInputSchema = z.object({
  orderId: z.number(),
  produtos: z.array(NFeProdutoSchema).min(1),
});

export type NFeProdutoParsed = z.infer<typeof NFeProdutoSchema>;
export type NFeInputParsed = z.infer<typeof NFeInputSchema>;
