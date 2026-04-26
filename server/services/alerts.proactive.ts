/**
 * STEP 9.3F.9 — Alertas proativos (automatizados).
 *
 * REGRAS ABSOLUTAS:
 *   - NUNCA modifica `emitAlert` nem `buildInsights`.
 *   - NUNCA cria nova tabela / endpoint / persistência paralela.
 *   - SEMPRE usa `emitAlertSmart` para garantir rate-limit + supressão.
 *
 * O que faz:
 *   1. Chama `buildInsights({ windowHours: 24 })` (reuso 100%).
 *   2. Filtra apenas insights com level === "critical".
 *   3. Para cada insight crítico, monta payload e delega para
 *      `emitAlertSmart()` — que herda toda a proteção anti-spam existente.
 *   4. Loga o resultado (não persiste nada extra; quem persiste é o emitAlert).
 *
 * Scheduler:
 *   - `startProactiveAlertsScheduler()` é iniciado uma vez no boot, igual
 *     `startAutoDispatchWorker`/`startBillingCron`.
 *   - Intervalo padrão: 10 minutos. Sobrescrevível via PROACTIVE_ALERTS_INTERVAL_MS.
 *   - O timer é unref() pra não segurar shutdown gracioso.
 *   - Reentrância protegida por flag `running` — se o tick anterior atrasar,
 *     o próximo é pulado (evita pile-up).
 */

import { buildInsights, type InsightEntry } from "./alerts.intelligence";
import { emitAlertSmart, type SmartEmitResult } from "./alerts.smart";
// STEP 9.3F.10 — roteamento (apenas deriva roles; não envia, não persiste).
import { resolveRecipients } from "./alerts.routing";

// ── Configuração ─────────────────────────────────────────────────────────────

/** Janela de análise alimentada para buildInsights (horas). */
const PROACTIVE_WINDOW_HOURS = 24;

/** Intervalo entre execuções (ms). Default: 10 min. */
const PROACTIVE_INTERVAL_MS = (() => {
  const raw = Number(process.env.PROACTIVE_ALERTS_INTERVAL_MS);
  if (Number.isFinite(raw) && raw >= 60_000) return raw; // mínimo 1 min
  return 10 * 60 * 1000;
})();

// ── Tipos públicos ───────────────────────────────────────────────────────────

export type ProactiveDispatchSummary = {
  considered: number;        // total de insights retornados
  critical:   number;        // quantos eram critical
  dispatched: number;        // quantos foram entregues a emitAlertSmart sem suprimir
  suppressed: number;        // suprimidos pelo emitAlertSmart
  rateLimited: number;       // bloqueados pelo rate-limit do emitAlert
  errors:     number;        // exceções por insight (não derruba o tick)
  generatedAt: string;
};

// ── Helpers internos ─────────────────────────────────────────────────────────

/**
 * Deriva a categoria de roteamento a partir do insight.
 * Hoje todos os insights existentes (channel:*, recurring_title:*, anomaly:*)
 * são técnicos/observabilidade — categoria padrão "TECH". Mantido como
 * função para facilitar evolução sem mexer no payload builder.
 */
function categoryForInsight(_insight: InsightEntry): string {
  return "TECH";
}

/** Converte um InsightEntry em payload para emitAlertSmart, já com roteamento. */
function buildAlertPayload(insight: InsightEntry) {
  const category = categoryForInsight(insight);
  const baseContext = {
    source: "proactive_v1",
    insightId: insight.id,
    windowHours: PROACTIVE_WINDOW_HOURS,
    category,
    ...insight.metric,
  };
  // STEP 9.3F.10 — resolve roles ANTES de enviar; apenas enriquece o payload
  // (auditoria + futura entrega dirigida). Não altera comportamento de envio.
  const recipientsRoles = resolveRecipients({ context: baseContext });

  return {
    severity: "CRITICAL" as const,
    title:    `ALERTA AUTOMÁTICO: ${insight.title}`,
    message:  insight.detail,
    context: {
      ...baseContext,
      recipientsRoles,
    },
    // Chave estável por insight para que o rate-limit do emitAlert não
    // confunda alertas distintos do mesmo tick.
    rateLimitKey: `proactive:${insight.id}`,
  };
}

/** Type-guards p/ ler o resultado do emitAlertSmart sem atrito. */
function isSuppressed(r: SmartEmitResult): r is Extract<SmartEmitResult, { suppressed: true }> {
  return (r as any).suppressed === true;
}
function isRateLimited(r: SmartEmitResult): boolean {
  return !isSuppressed(r) && (r as any).rateLimited === true;
}

// ── Função pública: 1 execução ───────────────────────────────────────────────

/**
 * Roda uma passada do detector proativo e retorna o resumo.
 * Pode ser chamado manualmente (testes) ou pelo scheduler.
 */
export async function runProactiveAlerts(): Promise<ProactiveDispatchSummary> {
  const summary: ProactiveDispatchSummary = {
    considered: 0,
    critical: 0,
    dispatched: 0,
    suppressed: 0,
    rateLimited: 0,
    errors: 0,
    generatedAt: new Date().toISOString(),
  };

  let report;
  try {
    report = await buildInsights({ windowHours: PROACTIVE_WINDOW_HOURS });
  } catch (err) {
    console.error("[PROACTIVE_ALERTS_INSIGHTS_ERROR]", err);
    summary.errors = 1;
    return summary;
  }

  summary.considered = report.insights.length;

  const criticals = report.insights.filter((i) => i.level === "critical");
  summary.critical = criticals.length;

  for (const insight of criticals) {
    const payload = buildAlertPayload(insight);
    try {
      const result = await emitAlertSmart(payload);
      if (isSuppressed(result)) {
        summary.suppressed += 1;
        console.log("[PROACTIVE_ALERT_SUPPRESSED]", {
          insightId: insight.id,
          reason: (result as any).reason,
        });
      } else if (isRateLimited(result)) {
        summary.rateLimited += 1;
        console.log("[PROACTIVE_ALERT_RATE_LIMITED]", { insightId: insight.id });
      } else {
        summary.dispatched += 1;
        console.log("[PROACTIVE_ALERT_DISPATCHED]", {
          insightId: insight.id,
          title: payload.title,
        });
      }
    } catch (err) {
      summary.errors += 1;
      console.error("[PROACTIVE_ALERT_DISPATCH_ERROR]", { insightId: insight.id, err });
    }
  }

  return summary;
}

// ── Scheduler ────────────────────────────────────────────────────────────────

let started = false;
let running = false;

/**
 * Inicia o scheduler proativo. Idempotente — chamar duas vezes não duplica.
 * Padrão idêntico a startBillingCron / startAutoDispatchWorker.
 */
export function startProactiveAlertsScheduler(): void {
  if (started) return;
  started = true;

  const tick = async () => {
    if (running) {
      console.warn("[PROACTIVE_ALERTS_SKIP] tick anterior ainda rodando");
      return;
    }
    running = true;
    try {
      const summary = await runProactiveAlerts();
      if (summary.critical > 0 || summary.errors > 0) {
        console.log("[PROACTIVE_ALERTS_TICK]", summary);
      }
    } catch (err) {
      // Salvaguarda final: nada deve derrubar o timer.
      console.error("[PROACTIVE_ALERTS_TICK_FATAL]", err);
    } finally {
      running = false;
    }
  };

  const handle = setInterval(tick, PROACTIVE_INTERVAL_MS);
  // Não segurar event loop em shutdown.
  if (typeof handle.unref === "function") handle.unref();

  console.log("[PROACTIVE_ALERTS_SCHEDULED]", {
    everyMs: PROACTIVE_INTERVAL_MS,
    windowHours: PROACTIVE_WINDOW_HOURS,
  });
}
