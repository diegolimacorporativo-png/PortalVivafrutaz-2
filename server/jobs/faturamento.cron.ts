/**
 * STEP 9.3C — Cron Inteligente de Faturamento.
 *
 * Roda todo dia às 08:00 e emite automaticamente as NF-es dos pedidos
 * elegíveis — passando pelo guard (canEmitNFe) antes de qualquer emissão.
 *
 * CONTROLADO POR FLAG:
 *   AUTO_FATURAMENTO = false  → modo observação: loga o que SERIA emitido
 *   AUTO_FATURAMENTO = true   → emite de fato
 *
 * NUNCA emite fora do guard. NUNCA altera schema. NUNCA duplica lógica.
 */

import cron from "node-cron";
import { randomUUID } from "crypto";
import { db } from "../database/db";
import { sql } from "drizzle-orm";
import { storage } from "../services/storage";
import { canEmitNFe } from "../modules/nfe/faturamento.guard";
import { hasBlockingNFe } from "../modules/nfe/nfe-idempotency.guard";
import {
  incrementBlocked as incNfeIdemBlocked,
  incrementDryRun as incNfeIdemDryRun,
} from "../modules/nfe/nfe-idempotency.metrics";
import { buildNFeInput } from "../modules/nfe/nfe-input.builder";
import { AUTO_FATURAMENTO, ENABLE_NFE_IDEMPOTENCY_GUARD } from "../config/flags";
import {
  setCronRunning,
  setCronResult,
} from "../modules/nfe/cron-status.store";
import { cronFaturamentoRuns } from "@shared/schema";
// FASE 14 — correlação fora do HTTP: wrap do cron com requestContext (ALS).
// Reutiliza a infra da FASE 12 (server/core/context/requestContext.ts) sem
// alterar nenhum comportamento da execução.
import {
  runWithRequestContext,
  getRequestIdForLog,
} from "../core/context/requestContext";
// STEP 9.3F.6 — migrado de emitAlert → emitAlertSmart (camada de auto-supressão).
// O emitAlert continua existindo e intocado; só este cron chama o wrapper.
import { emitAlertSmart } from "../services/alerts.smart";

const CONCURRENCY_LIMIT = 5;

export type CronFaturamentoResult = {
  executadoEm: Date;
  autoMode: boolean;
  total: number;
  emitidas: number;
  bloqueadas: number;
  erros: number;
  detalhes: Array<{ orderId: number; status: string; reason?: string }>;
};

// ── Processa em batches para não sobrecarregar o banco ───────────────────────

async function processInBatches<T>(
  items: T[],
  handler: (item: T) => Promise<any>,
): Promise<any[]> {
  const results: any[] = [];
  for (let i = 0; i < items.length; i += CONCURRENCY_LIMIT) {
    const batch = items.slice(i, i + CONCURRENCY_LIMIT);
    const batchResults = await Promise.all(batch.map(handler));
    results.push(...batchResults);
  }
  return results;
}

// ── Lógica principal ─────────────────────────────────────────────────────────

// STEP 9.3E — registra a execução no histórico persistente.
// Mantém um try/catch local para nunca derrubar o cron se o INSERT falhar.
async function persistCronRun(args: {
  triggeredBy: "schedule" | "manual";
  triggeredByUserId: number | null;
  total: number;
  success: number;
  blocked: number;
  errors: number;
}): Promise<void> {
  try {
    await db.insert(cronFaturamentoRuns).values({
      triggeredBy: args.triggeredBy,
      triggeredByUserId: args.triggeredByUserId ?? null,
      total: args.total,
      success: args.success,
      blocked: args.blocked,
      errors: args.errors,
    });
  } catch (e: any) {
    console.error("[CRON_HISTORY_PERSIST_ERROR]", e?.message ?? e);
  }
}

// STEP 9.3E — alertas baseados no resultado.
// STEP 9.3F.1 — também dispara emitAlert (email/slack/whatsapp) sem nunca
// quebrar o cron por falha de envio.
async function emitCronAlerts(args: {
  total: number;
  success: number;
  blocked: number;
  errors: number;
  triggeredBy: "schedule" | "manual";
}): Promise<void> {
  if (args.errors > 0) {
    console.error("[CRON_ALERT]", {
      message: "Erros no faturamento automático",
      total: args.total,
      errors: args.errors,
      triggeredBy: args.triggeredBy,
    });
    try {
      await emitAlertSmart({
        severity: "ALERT",
        title: "Erros no cron de faturamento",
        message: `Foram detectados ${args.errors} erro(s) em ${args.total} pedido(s) elegível(is).`,
        context: {
          total: args.total,
          success: args.success,
          blocked: args.blocked,
          errors: args.errors,
          triggeredBy: args.triggeredBy,
        },
      });
    } catch (err) {
      console.error("[ALERT_DISPATCH_ERROR]", err);
    }
  }
  if (args.success === 0 && args.total > 0) {
    console.error("[CRON_CRITICAL]", {
      message: "Nenhuma NF emitida",
      total: args.total,
      triggeredBy: args.triggeredBy,
    });
    try {
      await emitAlertSmart({
        severity: "CRITICAL",
        title: "Falha total no cron de faturamento",
        message: "Nenhuma NF foi emitida nesta execução, apesar de existirem pedidos elegíveis.",
        context: {
          total: args.total,
          blocked: args.blocked,
          errors: args.errors,
          triggeredBy: args.triggeredBy,
        },
      });
    } catch (err) {
      console.error("[ALERT_DISPATCH_ERROR]", err);
    }
  }
}

export async function runFaturamentoCron(
  triggeredBy: "schedule" | "manual" = "schedule",
  triggeredByUserId: number | null = null,
): Promise<CronFaturamentoResult> {
  // FASE 14 — gera requestId próprio do cron e propaga via ALS.
  // Prefixo `cron-` permite distinguir de requests HTTP nos logs.
  const requestId = `cron-${randomUUID()}`;

  return runWithRequestContext(requestId, async () => {
  const executadoEm = new Date();
  const autoMode = AUTO_FATURAMENTO;

  // STEP 9.3D — marca início (também grava lastRunAt + triggeredBy).
  setCronRunning(true, triggeredBy);

  try {
  if (!autoMode) {
    console.log("[CRON_FATURAMENTO_DESATIVADO] AUTO_FATURAMENTO=false — rodando em modo observação");
  }

  // 1. Pre-filtro de candidatos (mesma lógica do GET /api/nfe/eligible)
  const raw = await db.execute(sql`
    SELECT o.id, o.company_id
    FROM orders o
    WHERE o.status != 'CANCELLED'
      AND o.fiscal_status = 'nota_liberada'
      AND o.delivery_date IS NOT NULL
    LIMIT 500
  `);

  const candidates = (raw as any).rows as Array<{ id: number; company_id: number }>;

  if (candidates.length === 0) {
    console.log("[CRON_FATURAMENTO] Nenhum pedido candidato encontrado.");
    setCronResult({ total: 0, success: 0, blocked: 0, errors: 0 });
    await persistCronRun({
      triggeredBy,
      triggeredByUserId,
      total: 0,
      success: 0,
      blocked: 0,
      errors: 0,
    });
    return { executadoEm, autoMode, total: 0, emitidas: 0, bloqueadas: 0, erros: 0, detalhes: [] };
  }

  console.log(`[CRON_FATURAMENTO] ${candidates.length} candidatos encontrados. autoMode=${autoMode}`);

  // 2. Processar em batches de CONCURRENCY_LIMIT
  const detalhes = await processInBatches(candidates, async (row) => {
    const orderId = row.id;
    try {
      // FASE 3 — sanity check: cron não tem contexto de tenant, então
      // não usamos validateOrderTenant aqui. Apenas garantimos que o row
      // veio com company_id (qualquer ausência é um sinal de corrupção
      // upstream e bloqueia a emissão por segurança).
      if (!row.company_id) {
        // FASE 14 — log padronizado [SECURITY] com requestId do cron.
        console.error(
          `[SECURITY] CRON_INCONSISTENCY | requestId=${getRequestIdForLog()} | orderId=${orderId} | details=order sem companyId`,
        );
        return {
          orderId,
          status: "error",
          reason: "Order sem companyId (sanity check)",
        };
      }

      // FASE 18 — Guard de idempotência (GAP 2). Roda ANTES de canEmitNFe,
      // ANTES de getNextNfeNumero e ANTES de qualquer escrita. Em modo
      // dry-run (flag false) apenas loga; em modo ativo, bloqueia a emissão.
      const idem = await hasBlockingNFe(orderId);
      if (idem.blocked) {
        if (ENABLE_NFE_IDEMPOTENCY_GUARD) {
          console.warn(
            `[NFE_IDEMPOTENCY_BLOCKED] requestId=${getRequestIdForLog()} | source=cron | orderId=${orderId} | blockingStatus=${idem.blockingStatus} | blockingNfeId=${idem.blockingNfeId}`,
          );
          // FASE 19 — métrica agregada (sem dados sensíveis).
          incNfeIdemBlocked(idem.blockingStatus ?? "unknown", "cron");
          return {
            orderId,
            status: "blocked",
            reason: `Pedido já possui NF-e em status bloqueante: ${idem.blockingStatus}`,
          };
        } else {
          console.warn(
            `[NFE_IDEMPOTENCY_DRY_RUN] requestId=${getRequestIdForLog()} | source=cron | orderId=${orderId} | wouldBlockStatus=${idem.blockingStatus} | blockingNfeId=${idem.blockingNfeId}`,
          );
          // FASE 19 — métrica agregada (sem dados sensíveis).
          incNfeIdemDryRun(idem.blockingStatus ?? "unknown", "cron");
          // segue o fluxo — só observa
        }
      }

      // Guard — nunca emite sem passar aqui
      const check = await canEmitNFe(orderId);

      if (!check.allowed) {
        console.log(`[CRON_FATURAMENTO_DRY] pedido #${orderId} bloqueado: ${check.reason}`);
        return { orderId, status: "blocked", reason: check.reason };
      }

      // Modo observação: loga mas não emite
      if (!autoMode) {
        console.log(`[CRON_FATURAMENTO_DRY] pedido #${orderId} SERIA emitido (tipo=${check.faturamento?.tipo})`);
        return { orderId, status: "would_emit", reason: `tipo=${check.faturamento?.tipo}` };
      }

      // Modo automático: emite de fato
      // (FASE 18 — checagem antiga `getNfeEmissaoByOrderId + ['autorizada','enviada']`
      // removida; substituída pelo `hasBlockingNFe` acima, que cobre EXISTÊNCIA
      // sobre todo o histórico, sem ORDER BY DESC LIMIT 1.)

      const { gerarNFeXML } = await import("../services/nfe/nfeGenerator.ts");
      const { validarNFeInput } = await import("../services/nfe/nfeValidator.ts");

      const input = await buildNFeInput(orderId);
      const erros = validarNFeInput(input);
      if (erros.length > 0) {
        return { orderId, status: "error", reason: `Dados incompletos: ${erros.join(", ")}` };
      }

      const numero = await storage.getNextNfeNumero();
      const gerada = await gerarNFeXML(input, numero);

      await storage.createNfeEmissao({
        orderId,
        numero: gerada.numero,
        serie: gerada.serie,
        chaveNFe: gerada.chaveNFe,
        status: "gerada",
        xmlGerado: gerada.xmlGerado,
        dataEmissao: gerada.dataEmissao,
        ambienteFiscal: input.tpAmb === "1" ? "producao" : "homologacao",
      });

      await storage.updateOrder(orderId, { fiscalStatus: "nota_emitida" });
      await storage.createLog({
        action: "NF-E_CRON_GERADA",
        description: `NF-e nº ${numero} gerada automaticamente pelo cron para pedido #${orderId}.`,
        level: "INFO",
        userId: null as any,
      });

      console.log(`[CRON_FATURAMENTO] pedido #${orderId} emitido (NF nº ${numero})`);
      return { orderId, status: "success" };
    } catch (e: any) {
      console.error(`[CRON_FATURAMENTO_ERROR] pedido #${orderId}:`, e.message);
      return { orderId, status: "error", reason: e.message };
    }
  });

  const emitidas = detalhes.filter((d) => d.status === "success").length;
  const bloqueadas = detalhes.filter((d) => ["blocked", "would_emit"].includes(d.status)).length;
  const erros = detalhes.filter((d) => d.status === "error").length;

  console.log(
    `[CRON_FATURAMENTO] concluído — emitidas=${emitidas} bloqueadas=${bloqueadas} erros=${erros} autoMode=${autoMode}`,
  );

  // STEP 9.3D — grava resumo final (também marca running=false).
  setCronResult({
    total: candidates.length,
    success: emitidas,
    blocked: bloqueadas,
    errors: erros,
  });

  // STEP 9.3E — histórico persistente + alertas.
  await persistCronRun({
    triggeredBy,
    triggeredByUserId,
    total: candidates.length,
    success: emitidas,
    blocked: bloqueadas,
    errors: erros,
  });
  await emitCronAlerts({ total: candidates.length, success: emitidas, blocked: bloqueadas, errors: erros, triggeredBy });

  return { executadoEm, autoMode, total: candidates.length, emitidas, bloqueadas, erros, detalhes };
  } catch (err) {
    // STEP 9.3D — em caso de exceção fatal, registra resumo zerado e relança.
    setCronResult({ total: 0, success: 0, blocked: 0, errors: 1 });
    await persistCronRun({
      triggeredBy,
      triggeredByUserId,
      total: 0,
      success: 0,
      blocked: 0,
      errors: 1,
    });
    console.error("[CRON_CRITICAL]", {
      message: "Execução abortada por exceção",
      triggeredBy,
      error: (err as any)?.message,
    });
    throw err;
  }
  });
}

// ── Scheduler ────────────────────────────────────────────────────────────────

let cronStarted = false;

export function startFaturamentoCron(): void {
  if (cronStarted) return;
  cronStarted = true;

  // Roda todo dia às 08:00
  cron.schedule("0 8 * * *", async () => {
    try {
      const result = await runFaturamentoCron();
      console.log(
        `[CRON_FATURAMENTO] executado em ${result.executadoEm.toISOString()} — emitidas=${result.emitidas} bloqueadas=${result.bloqueadas} erros=${result.erros}`,
      );
    } catch (err: any) {
      console.error("[CRON_FATURAMENTO] erro fatal:", err.message);
    }
  });

  console.log(`[CRON_FATURAMENTO] agendado para 08:00 diário — AUTO_FATURAMENTO=${AUTO_FATURAMENTO}`);
}
