/**
 * Retorno Itaú — orquestração de baixa automática (FASE BANCO.3)
 *
 * Lê o conteúdo de um arquivo CNAB 240 de retorno, identifica os títulos
 * liquidados (Segmento T + ocorrência 06/17) e dispara baixa via
 * `financeService.payAccountReceivable` — exatamente o mesmo caminho da
 * conciliação manual (FIN.3.5), o que garante:
 *
 *   • o hook `[FIN.3] handleOrderPayment` é disparado por título,
 *   • o pedido vinculado passa a refletir `isPaid:true` na FIN.2,
 *   • a UI de pedidos (FIN.4) e o filtro (FIN.5) atualizam sozinhos,
 *   • zero código duplicado de "marcar como pago".
 *
 * Restrições:
 *   • NÃO chama storage para alterar pagamento — sempre via FinanceService.
 *   • Vínculo título→AR é TEMPORÁRIO via `orderId` extraído do "PED-{id}"
 *     no Segmento P enviado na remessa BANCO.1. Será substituído por
 *     `nossoNumero` quando este for persistido em uma fase futura.
 *   • Idempotência: se a AR já estiver `pago`, contabilizamos como
 *     `jaPagas` e NÃO chamamos `payAccountReceivable` de novo.
 *   • Fail-safe por item: erro em uma linha NUNCA interrompe o lote.
 */

import crypto from "crypto";
import { storage } from "../../../services/storage";
import { financeService } from "../../finance/finance.service";
import { parseItauRetornoCnab240 } from "./retorno.parser";

export interface ProcessarRetornoResult {
  success: boolean;
  /** Mensagem opcional — populada quando `success: false` (BANCO.6). */
  message?: string;
  /** Hash SHA-256 do arquivo já existente (apenas em duplicidade). */
  duplicateOf?: { id: number; fileName: string; createdAt: Date };
  totalProcessados: number;
  pagosIdentificados: number;
  baixasRealizadas: number;
  naoEncontrados: number;
  jaPagas: number;
  erros: number;
}

export interface ProcessarRetornoOptions {
  /** Nome do arquivo enviado pelo operador (para auditoria — BANCO.5). */
  fileName?: string;
  /** companyId opcional para escopo do histórico (BANCO.5). */
  companyId?: number | null;
}

export async function processarRetornoItau(
  content: string,
  userId: number,
  opts: ProcessarRetornoOptions = {},
): Promise<ProcessarRetornoResult> {
  // BANCO.6 — verifica se este arquivo (byte-a-byte) já foi processado.
  // Hash determinístico SHA-256 do conteúdo bruto. Se já existe, abortamos
  // ANTES de qualquer parse ou chamada ao FinanceService — garantia de
  // não gerar baixa duplicada.
  const fileHash = crypto.createHash("sha256").update(content).digest("hex");
  const exists = await storage.findCnabByHash(fileHash);
  if (exists) {
    console.warn("[CNAB] Arquivo duplicado ignorado", {
      fileName: opts.fileName,
      hash: fileHash,
      previousImportId: exists.id,
      previousFileName: exists.fileName,
    });
    return {
      success: false,
      message: "Arquivo já foi importado anteriormente",
      duplicateOf: {
        id: exists.id,
        fileName: exists.fileName,
        createdAt: exists.createdAt,
      },
      totalProcessados: 0,
      pagosIdentificados: 0,
      baixasRealizadas: 0,
      naoEncontrados: 0,
      jaPagas: 0,
      erros: 0,
    };
  }

  const itens = parseItauRetornoCnab240(content);

  let pagosIdentificados = 0;
  let baixasRealizadas = 0;
  let naoEncontrados = 0;
  let jaPagas = 0;
  let erros = 0;

  for (const item of itens) {
    if (!item.isPago) continue;
    pagosIdentificados += 1;

    try {
      if (!item.orderId) {
        naoEncontrados += 1;
        console.warn("[CNAB] AR não encontrada — orderId não extraído", {
          numeroDocumento: item.numeroDocumento,
          nossoNumero: item.nossoNumero,
        });
        continue;
      }

      const ar = await storage.getAccountReceivableByOrderId(item.orderId);
      if (!ar) {
        naoEncontrados += 1;
        console.warn("[CNAB] AR não encontrada", { orderId: item.orderId });
        continue;
      }

      if (ar.status === "pago") {
        jaPagas += 1;
        continue;
      }

      // Caminho ÚNICO de baixa — dispara FIN.3 e mantém a paridade total
      // com a conciliação manual (FIN.3.5).
      await financeService.payAccountReceivable(ar.id, userId);
      baixasRealizadas += 1;

      console.log("[CNAB] AR baixada automaticamente", {
        arId: ar.id,
        orderId: item.orderId,
        valorPagoCentavos: item.valorPagoCentavos,
        dataPagamento: item.dataPagamento,
      });
    } catch (err) {
      // Fail-safe: erro em um item NUNCA quebra o restante do arquivo.
      erros += 1;
      console.warn("[CNAB] erro ao processar item de retorno (fail-safe)", {
        err: (err as Error)?.message,
        orderId: item.orderId,
        numeroDocumento: item.numeroDocumento,
      });
    }
  }

  console.log("[CNAB] Retorno Itaú processado", {
    fileName: opts.fileName,
    totalProcessados: itens.length,
    pagosIdentificados,
    baixasRealizadas,
    naoEncontrados,
    jaPagas,
    erros,
  });

  // BANCO.5 — registra auditoria do upload. Falha aqui NUNCA quebra o
  // fluxo principal: a baixa já foi feita acima e é o que importa para
  // o operador.
  try {
    await storage.createCnabImportHistory({
      fileName: opts.fileName ?? "retorno.ret",
      fileHash,
      totalProcessados: itens.length,
      pagosIdentificados,
      baixasRealizadas,
      jaPagas,
      naoEncontrados,
      erros,
      companyId: opts.companyId ?? null,
    });
  } catch (err) {
    console.warn("[CNAB] falha ao registrar histórico de importação (não crítico)", {
      err: (err as Error)?.message,
    });
  }

  return {
    success: true,
    totalProcessados: itens.length,
    pagosIdentificados,
    baixasRealizadas,
    naoEncontrados,
    jaPagas,
    erros,
  };
}
