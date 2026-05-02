/**
 * STEP 9.3F.3 — Store em memória dos alertas disparados.
 * STEP 9.3F.4 — Adicionada persistência em banco (cron_alert_logs) sem
 * alterar a store em memória. A função `persistAlertLog` roda em paralelo
 * com `recordAlertLog` e nunca lança (try/catch interno).
 *
 * REGRA: este arquivo é só observabilidade. Não decide, não envia, não
 * influencia o fluxo do cron.
 */

import { lt } from "drizzle-orm";
import { db } from "../../database/db";
import { cronAlertLogs } from "@shared/schema";
import { logSecurity } from "../../core/security/securityLogger";

export type AlertLogChannelResult = {
  channel: "email" | "slack" | "whatsapp";
  target?: string;
  ok: boolean;
  reason?: string;
};

export type AlertLog = {
  at: number;
  severity: "ALERT" | "CRITICAL";
  title: string;
  message: string;
  results: AlertLogChannelResult[];
  rateLimited?: boolean;
  /** STEP 9.3F.6 — marcado quando o emitAlertSmart bloqueia o envio
   *  por excesso de repetição na janela de 24h. NUNCA é setado pelo emitAlert. */
  suppressed?: boolean;
  /** STEP 9.3F.6 — payload livre (motivo, contadores, etc.) gravado no jsonb context. */
  context?: Record<string, unknown> | null;
};

const MAX_LOGS = 200;
const logs: AlertLog[] = [];

export function recordAlertLog(entry: AlertLog): void {
  logs.unshift(entry);
  if (logs.length > MAX_LOGS) logs.length = MAX_LOGS;
}

/** Retorna cópia defensiva (mais recente primeiro). */
export function getAlertLogs(): AlertLog[] {
  return logs.slice();
}

/** Limpa o store (uso em testes ou ação admin futura). */
export function clearAlertLogs(): void {
  logs.length = 0;
}

/**
 * STEP 9.3F.4 — Persiste o alerta no banco (cron_alert_logs).
 * Sempre dentro de try/catch: nunca derruba o cron por falha de I/O.
 * O campo `at` da entry é ignorado — usamos `defaultNow()` no banco.
 */
export async function persistAlertLog(entry: AlertLog): Promise<void> {
  try {
    await db.insert(cronAlertLogs).values({
      severity:    entry.severity,
      title:       entry.title,
      message:     entry.message,
      results:     entry.results ?? [],
      rateLimited: entry.rateLimited ?? false,
      // STEP 9.3F.6 — flag opcional, default false. Mantém compatibilidade total
      // com chamadas antigas (emitAlert continua não passando este campo).
      suppressed:  entry.suppressed ?? false,
      context:     entry.context ?? null,
    });
  } catch (err: any) {
    logSecurity(`[NFE_ALERT_LOG_FAILED] step=persist | error=${err?.message ?? "unknown"}`);
    console.error("[ALERT_PERSIST_ERROR]", err);
  }
}

/**
 * STEP 9.3F.4.A — Remove logs mais antigos que `days` dias.
 * Sempre dentro de try/catch: falha aqui não pode quebrar nada.
 * Usado tanto pelo job diário quanto pelo endpoint admin DELETE.
 */
export async function pruneOldAlertLogs(days = 90): Promise<void> {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const result = await db
      .delete(cronAlertLogs)
      .where(lt(cronAlertLogs.createdAt, cutoff));

    console.log("[ALERT_LOGS_PRUNED]", {
      days,
      deleted: (result as any)?.rowCount ?? "unknown",
      cutoff: cutoff.toISOString(),
    });
  } catch (err: any) {
    logSecurity(`[NFE_ALERT_LOG_FAILED] step=prune | error=${err?.message ?? "unknown"}`);
    console.error("[ALERT_PRUNE_ERROR]", err);
  }
}
