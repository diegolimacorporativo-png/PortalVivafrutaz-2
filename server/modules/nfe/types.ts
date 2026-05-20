/**
 * FASE 8.5 — TIPAGEM FISCAL COMPLETA (OUTPUT BUILDER)
 *
 * Tipos públicos do retorno de `buildNFeInput`. ZERO mudança de
 * comportamento, ZERO mudança de XML — este arquivo apenas formaliza
 * o contrato estrutural já existente.
 *
 * NOMENCLATURA (decisão crítica de fidelidade ao XML):
 *
 *   O spec original da FASE 8.5 sugeriu campos com nomes
 *   `description/quantity/unitPrice/totalPrice` para `NFeProduto`.
 *   Porém o builder retorna — e o gerador de XML/consumidores leem —
 *   os nomes ALINHADOS AO LAYOUT NF-e:
 *
 *     xProd   ← description
 *     qCom    ← quantity
 *     vUnCom  ← unitPrice
 *     vProd   ← totalPrice
 *     uCom    ← unit
 *
 *   Como a regra #2 da fase é "NÃO alterar estrutura do XML" e a #3 é
 *   "NÃO refatorar consumo do builder", manter os nomes XML é a única
 *   opção que preserva a sentinela 8.4.3 e os 7+ call-sites em
 *   `routes.ts`/`faturamento.cron.ts` que leem `p.vProd`, `input.tpAmb`,
 *   etc. O contrato semântico é idêntico ao do spec — apenas os nomes
 *   refletem a realidade do builder.
 */

/**
 * Item de produto no NFeInput, na forma exata produzida pelo builder
 * (alinhada ao layout XML da NF-e).
 */
export type NFeProduto = {
  /** Código do produto (string padded p/ 6, ex.: "000001"). */
  cProd: string;
  /** Descrição do produto (== description do spec). */
  xProd: string;
  /** NCM — obrigatório, validado no builder (NFE_MISSING_NCM). */
  ncm: string;
  /** CFOP resolvido (item.cfop || defaultCfop). */
  cfop: string;
  /** Unidade comercial (default "KG"). */
  uCom: string;
  /** Quantidade comercial (== quantity do spec). */
  qCom: number;
  /** Valor unitário comercial (== unitPrice do spec). */
  vUnCom: number;
  /** Valor total do produto (== totalPrice do spec). */
  vProd: number;
  /** CSOSN (Simples Nacional) — default "102". */
  csosn: string;
  /** CST (Lucro Presumido/Real, CRT=3) — default "00". */
  cst: string;
  /** Flag de produto importado (FASE NF.7.8). */
  importado: boolean;
};

/**
 * Retorno completo de `buildNFeInput`.
 *
 * `emitente` e `destinatario` ficam como `any` por decisão da própria
 * FASE 8.5 (regra #5: "NÃO tipar emitente/destinatario ainda").
 */
export type NFeInput = {
  emitente: any;
  destinatario: any;
  produtos: NFeProduto[];

  /** Natureza da operação (default "Venda de mercadoria adquirida"). */
  natOp: string;
  /** Ambiente fiscal: "1"=produção, "2"=homologação. */
  tpAmb: "1" | "2";

  /** ID do pedido de origem. */
  orderId: number;
  /** Código humano do pedido (quando disponível). */
  orderCode?: string;

  /** Texto livre ("informacoesAdicionais" + "Pedido: <code>"). */
  informacoesAdicionais?: string;

  /** Itens de pagamento (NT 2014.002 + NF-e 4.00). Se ausente, gerador usa tPag=99 (Outros). */
  pagamentos?: Array<{ tPag: string; xPag?: string; vPag: number }>;
};
