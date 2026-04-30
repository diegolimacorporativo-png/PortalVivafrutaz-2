/**
 * FASE 8.5 — TIPAGEM FISCAL SEGURA
 *
 * Tipo público que descreve um item de faturamento já resolvido,
 * pronto para ser consumido pelo builder de NF-e.
 *
 * IMPORTANTE: este tipo é um CONTRATO ESTRUTURAL — não altera nada
 * em runtime. Apenas substitui `any[]` no fluxo
 *
 *   resolveBillingItems → buildNFeInput
 *
 * Campos opcionais refletem fielmente o que o builder hoje consome
 * via `safeStr`/coerções defensivas; mantê-los opcionais preserva
 * 100% do comportamento atual (zero regressão).
 */
export type BillingItemFiscal = {
  description: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;

  ncm?: string;
  cfop?: string;
  unit?: string;

  cst?: string;
  csosn?: string;
  importado?: boolean;
};
