/**
 * FASE FISCAL 9.0 — auto-correção de totais ICMS (cStat 533).
 *
 * Função PURA, sem IO, sem efeitos colaterais. Recebe a lista de itens
 * de uma NF-e e devolve os totais consolidados de `vBC` e `vICMS`. É
 * usada APENAS no fluxo de reemissão semi-automática (`/corrigir-reenviar`)
 * quando o `nfeErrorHandler` classifica o erro como `RECALCULAR` (cStat 533
 * — divergência entre o total declarado e o somatório dos itens).
 *
 * Regras críticas (espelhadas do spec 9.0):
 *   1. NÃO altera estrutura do XML
 *   2. NÃO altera CST / CSOSN
 *   3. NÃO altera schema
 *   4. NÃO altera assinatura digital
 *   5. NÃO altera endpoints existentes
 *   6. NÃO recalcula `pICMS` por item — apenas SOMA o que já existe
 *
 * O motivo de a função ser tipada como `any[]` (em vez de `NFeProduto[]`)
 * é que diferentes shapes podem ser passados:
 *   • estrutura interna do `gerarNFeXML` (já com vBC/vICMS calculados)
 *   • um snapshot de itens vindo do pedido (com vBC/vICMS persistidos)
 *   • um array intermediário em testes
 * Mantemos o contrato genérico para facilitar reuso e auditoria.
 *
 * Comportamento determinístico — para o mesmo input devolve o mesmo output.
 * Suporta floats com `Number()` e tolera campos ausentes (assume 0).
 */

export interface IcmsTotals {
  /** Soma da base de cálculo do ICMS (vBC) de todos os itens. */
  vBC: number;
  /** Soma do ICMS apurado (vICMS) de todos os itens. */
  vICMS: number;
}

/**
 * Soma `vBC` e `vICMS` ao longo de uma lista de itens.
 *
 * @param itens lista de itens da NF-e. Cada item DEVE ter (ou pode ter)
 *              propriedades `vBC` e `vICMS`. Itens sem essas propriedades
 *              contribuem com 0 — sem erro.
 */
export function corrigirTotaisICMS(itens: any[]): IcmsTotals {
  if (!Array.isArray(itens) || itens.length === 0) {
    return { vBC: 0, vICMS: 0 };
  }
  let totalvBC = 0;
  let totalvICMS = 0;
  for (const item of itens) {
    const vBC = Number(item?.vBC) || 0;
    const vICMS = Number(item?.vICMS) || 0;
    totalvBC += vBC;
    totalvICMS += vICMS;
  }
  // Retorno arredondado a 2 casas para evitar acumulação de erro de ponto
  // flutuante (ex.: 0.1 + 0.2 = 0.30000000000000004) em totais grandes.
  return {
    vBC: Math.round(totalvBC * 100) / 100,
    vICMS: Math.round(totalvICMS * 100) / 100,
  };
}
