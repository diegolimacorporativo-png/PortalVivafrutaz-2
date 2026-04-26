/**
 * STEP 9.3F.6 — Wrapper de auto-supressão sobre `emitAlert`.
 *
 * REGRAS ABSOLUTAS:
 *   - NUNCA modifica `emitAlert` (apenas o invoca).
 *   - NUNCA duplica persistência: usa o mesmo `persistAlertLog` da store.
 *   - Decide com base em `cron_alert_logs` (única fonte da verdade).
 *
 * Comportamento:
 *   1. Conta quantos alertas com o mesmo `title` foram persistidos nas
 *      últimas SUPPRESSION_WINDOW_HOURS, considerando apenas `suppressed=false`
 *      (o que evita ciclo de auto-justificação).
 *   2. Se a contagem ≥ SUPPRESSION_THRESHOLD:
 *        - persiste UMA linha de "suprimido" (rate_limited=false, suppressed=true)
 *        - retorna `{ suppressed: true, ... }` sem chamar `emitAlert`.
 *   3. Caso contrário, delega 100% para `emitAlert(input)` — comportamento
 *      idêntico ao chamar `emitAlert` diretamente.
 *
 * Decisão de métrica do spec:
 *   suprimido grava `rate_limited=false` (não polui o contador de rate-limit
 *   no /analytics atual). A separação fica clara via coluna `suppressed`.
 */

import { sql } from "drizzle-orm";
import { db } from "../database/db";
import { emitAlert, type EmitAlertInput } from "./alerts.service";
import { persistAlertLog } from "../modules/nfe/alerts-log.store";
import { INTELLIGENCE_CONFIG } from "./alerts.intelligence";

export type EmitAlertResult = Awaited<ReturnType<typeof emitAlert>>;

export type SmartEmitResult =
  | {
      suppressed: true;
      reason: "title_too_frequent_24h";
      count24h: number;
      threshold: number;
      windowHours: number;
    }
  | (EmitAlertResult & { suppressed?: false });

/**
 * Drop-in replacement de `emitAlert` com camada de auto-supressão.
 * Mesma assinatura de input para facilitar migração cirúrgica.
 */
export async function emitAlertSmart(input: EmitAlertInput): Promise<SmartEmitResult> {
  const { SUPPRESSION_WINDOW_HOURS, SUPPRESSION_THRESHOLD } = INTELLIGENCE_CONFIG;

  // 1) Conta envios reais (não suprimidos) do mesmo title na janela.
  //    Falha de leitura nunca pode bloquear o alerta — em caso de erro,
  //    delega direto pro emitAlert (fail-open).
  let count24h = 0;
  try {
    const cutoff = new Date(Date.now() - SUPPRESSION_WINDOW_HOURS * 3600 * 1000);
    const rows = await db.execute(sql`
      SELECT COUNT(*)::int AS c
      FROM cron_alert_logs
      WHERE title = ${input.title}
        AND created_at >= ${cutoff}
        AND suppressed = false
    `);
    count24h = Number((rows.rows?.[0] as any)?.c ?? 0);
  } catch (err) {
    console.error("[ALERT_SMART_COUNT_ERROR]", err);
    // Fail-open: na dúvida, deixa passar pro emitAlert.
    return { ...(await emitAlert(input)), suppressed: false };
  }

  // 2) Acima do limite — suprime e persiste marcador.
  if (count24h >= SUPPRESSION_THRESHOLD) {
    console.warn("[ALERT_SUPPRESSED]", {
      title: input.title,
      count24h,
      threshold: SUPPRESSION_THRESHOLD,
      windowHours: SUPPRESSION_WINDOW_HOURS,
    });
    void persistAlertLog({
      at: Date.now(),
      severity: input.severity,
      title: input.title,
      message: input.message,
      results: [],
      rateLimited: false, // 🔥 spec: NÃO confundir métrica de rate_limited
      suppressed: true,
      context: {
        reason: "title_too_frequent_24h",
        count24h,
        threshold: SUPPRESSION_THRESHOLD,
        windowHours: SUPPRESSION_WINDOW_HOURS,
        ...(input.context ?? {}),
      },
    });
    return {
      suppressed: true,
      reason: "title_too_frequent_24h",
      count24h,
      threshold: SUPPRESSION_THRESHOLD,
      windowHours: SUPPRESSION_WINDOW_HOURS,
    };
  }

  // 3) Abaixo do limite — fluxo original 100% preservado.
  const out = await emitAlert(input);
  return { ...out, suppressed: false };
}
