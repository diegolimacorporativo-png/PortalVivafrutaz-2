/**
 * FASE 8.1 — Resolver Central de Configuração de Faturamento.
 *
 * Fonte ÚNICA de verdade para a configuração de faturamento de uma
 * empresa. Hoje a decisão estava espalhada entre:
 *
 *   - companies.billingType   (text livre, legado)
 *   - companies.billingModel  (enum real: STANDARD | CONTRACT_OPEN | CONTRACT_AVERAGE)
 *   - nfDraft.billingType     (override por rascunho)
 *   - nfDraft.useGroupedItems (override por rascunho)
 *
 * Este resolver concentra apenas a leitura da EMPRESA. Não toca em
 * banco, não altera dados, não substitui o draft: quando existir um
 * rascunho, ele continua tendo prioridade total. O resolver só dá o
 * default da empresa para usar como FALLBACK quando o draft estiver
 * ausente.
 *
 * Regra de mapeamento (Fase 8.1 — fechada):
 *   - billingModel = "CONTRACT_AVERAGE" → useGroupedItemsDefault = true
 *     (faturamento contratual com média mensal naturalmente consolida
 *      os itens em "Frutas in natura").
 *   - billingModel = "STANDARD" | "CONTRACT_OPEN" | undefined | null
 *                                        → useGroupedItemsDefault = false
 *     (mantém comportamento legado: sem agrupamento por padrão).
 *
 * IMPORTANTE: zero leitura de banco, zero side-effect. Recebe um
 * `company` já carregado e devolve o objeto de configuração.
 */

export interface CompanyBillingConfig {
  /** Modelo fiscal da empresa, normalizado para enum. */
  billingModel: "STANDARD" | "CONTRACT_OPEN" | "CONTRACT_AVERAGE";
  /**
   * Default de agrupamento da EMPRESA. Usado APENAS como fallback
   * quando não houver draft com `useGroupedItems` explícito.
   */
  useGroupedItemsDefault: boolean;
}

export function resolveCompanyBillingConfig(
  company: any,
): CompanyBillingConfig {
  const raw =
    (company?.billingModel as string | undefined | null) ?? "STANDARD";
  const billingModel: CompanyBillingConfig["billingModel"] =
    raw === "CONTRACT_OPEN" || raw === "CONTRACT_AVERAGE"
      ? raw
      : "STANDARD";

  return {
    billingModel,
    useGroupedItemsDefault: billingModel === "CONTRACT_AVERAGE",
  };
}
