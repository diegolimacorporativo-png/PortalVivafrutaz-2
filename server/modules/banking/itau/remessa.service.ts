/**
 * Remessa Itaú — orquestração CNAB 240 (FASE BANCO.1)
 *
 * Responsabilidade ÚNICA: dado um conjunto de IDs de `accounts_receivable`,
 * carregar os registros pelo repositório existente, filtrar os que ainda
 * NÃO foram pagos e delegar a montagem do arquivo ao gerador puro
 * (`cnab240.generator`).
 *
 * Restrições:
 *   • LÊ accounts_receivable (não escreve, não atualiza status).
 *   • Reusa `financeRepository` que já existe — sem novos métodos no repo.
 *   • Não toca em FIN.1..FIN.5, não altera schema, não emite eventos.
 */

import { financeRepository } from "../../finance/finance.repository";
import {
  generateItauCnab240,
  type CnabRemessaItem,
  type CnabRemessaContext,
} from "./cnab240.generator";

export interface GerarRemessaResult {
  conteudo: string;
  totalTitulos: number;
  ignoradosPagos: number;
  naoEncontrados: number[];
}

/**
 * Gera a string CNAB 240 para os IDs de AR informados.
 * Retorna também totalizadores úteis para auditoria/log.
 */
export async function gerarRemessaItau(
  arIds: number[],
  ctx: CnabRemessaContext = {},
): Promise<GerarRemessaResult> {
  if (!Array.isArray(arIds) || arIds.length === 0) {
    return { conteudo: "", totalTitulos: 0, ignoradosPagos: 0, naoEncontrados: [] };
  }

  const remessas: CnabRemessaItem[] = [];
  const naoEncontrados: number[] = [];
  let ignoradosPagos = 0;

  // Busca individual via método já existente do repo — preserva tenant scope.
  for (const id of arIds) {
    const ar = await financeRepository.getAccountReceivable(id);
    if (!ar) {
      naoEncontrados.push(id);
      continue;
    }
    if (ar.status === "pago") {
      ignoradosPagos += 1;
      continue;
    }
    remessas.push({
      id: ar.id,
      valor: ar.valor,
      dataVencimento: ar.dataVencimento,
      descricao: ar.descricao,
      orderId: ar.orderId,
      // Sacado mock na fase 1 (conforme spec). Mantemos o hook aberto para
      // que a fase 2 possa enriquecer com os dados reais de `companies`.
    });
  }

  const conteudo = generateItauCnab240(remessas, ctx);

  console.log("[CNAB] Remessa Itaú gerada", {
    totalTitulos: remessas.length,
    ignoradosPagos,
    naoEncontrados: naoEncontrados.length,
  });

  return {
    conteudo,
    totalTitulos: remessas.length,
    ignoradosPagos,
    naoEncontrados,
  };
}
