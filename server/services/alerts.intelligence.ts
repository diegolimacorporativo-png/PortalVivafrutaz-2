/**
 * STEP 9.3F.6 — Inteligência sobre `cron_alert_logs`.
 *
 * Este arquivo é PURAMENTE de leitura/análise. Não envia alertas, não toca em
 * `emitAlert`, não duplica persistência. Apenas consulta a tabela existente e
 * monta dois tipos de saída pra UI:
 *
 *   - buildAnomalies(): comparação janela atual vs baseline diário histórico
 *   - buildInsights():  observações em linguagem natural pro dashboard
 *
 * Toda configuração (thresholds) fica em INTELLIGENCE_CONFIG abaixo, fonte
 * única da verdade. Mudar aqui propaga pra wrapper de supressão e endpoints.
 */

import { sql } from "drizzle-orm";
import { db } from "../database/db";

// ── Configuração ─────────────────────────────────────────────────────────────

export const INTELLIGENCE_CONFIG = {
  // Detecção de anomalias (spike por dimensão)
  ANOMALY_BASELINE_MIN: 3,        // baseline diário precisa ser ≥ 3 pra evitar ruído
  ANOMALY_WARNING_PCT:  50,       // delta% ≥ 50  → warning
  ANOMALY_CRITICAL_PCT: 100,      // delta% ≥ 100 → critical

  // Insights de canais (taxa de sucesso)
  CHANNEL_MIN_SAMPLES:   5,       // amostras mínimas pra avaliar canal
  CHANNEL_WARNING_RATE:  0.75,    // taxa < 75% → warning   (ajustado no spec aprovado)
  CHANNEL_CRITICAL_RATE: 0.50,    // taxa < 50% → critical

  // Insights de títulos recorrentes
  RECURRING_TITLE_MIN: 3,         // ≥ 3 ocorrências do mesmo título na janela

  // Auto-supressão (usado pelo emitAlertSmart)
  SUPPRESSION_WINDOW_HOURS: 24,
  SUPPRESSION_THRESHOLD:    8,    // ≥ 8 títulos iguais em 24h → suprime  (ajustado no spec aprovado)
} as const;

// ── Tipos públicos ───────────────────────────────────────────────────────────

export type AnomalyLevel = "ok" | "warning" | "critical";

export type AnomalyEntry = {
  dimension: "total" | "severity" | "channel";
  key: string;
  current: number;
  baselineDailyAvg: number;
  deltaPct: number;
  level: AnomalyLevel;
  label: string;
};

export type AnomalyReport = {
  currentHours: number;
  baselineDays: number;
  generatedAt: string;
  anomalies: AnomalyEntry[];
};

export type InsightLevel = "info" | "warning" | "critical";

export type InsightEntry = {
  id: string;
  level: InsightLevel;
  title: string;
  detail: string;
  metric: Record<string, unknown>;
};

export type InsightReport = {
  windowHours: number;
  generatedAt: string;
  insights: InsightEntry[];
};

// ── Utilitários ──────────────────────────────────────────────────────────────

function classifyAnomaly(current: number, baselineDailyAvg: number): {
  deltaPct: number;
  level: AnomalyLevel;
} {
  if (baselineDailyAvg < INTELLIGENCE_CONFIG.ANOMALY_BASELINE_MIN) {
    return { deltaPct: 0, level: "ok" };
  }
  const deltaPct = ((current - baselineDailyAvg) / baselineDailyAvg) * 100;
  if (deltaPct >= INTELLIGENCE_CONFIG.ANOMALY_CRITICAL_PCT) return { deltaPct, level: "critical" };
  if (deltaPct >= INTELLIGENCE_CONFIG.ANOMALY_WARNING_PCT)  return { deltaPct, level: "warning" };
  return { deltaPct, level: "ok" };
}

function fmtPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(0)}%`;
}

function fmtNum(n: number, digits = 1): string {
  return Number(n.toFixed(digits)).toString().replace(".", ",");
}

// ── Detecção de anomalias ────────────────────────────────────────────────────

/**
 * Compara contagens da janela atual (últimas N horas) vs média diária do
 * baseline (M dias anteriores, EXCLUINDO a janela atual). Retorna apenas
 * dimensões classificadas como warning/critical — itens "ok" são filtrados.
 *
 * Filtro `suppressed = false`: itens auto-suprimidos não inflam o sinal.
 */
export async function buildAnomalies(args: {
  currentHours: number;
  baselineDays: number;
}): Promise<AnomalyReport> {
  const currentHours = Math.min(168, Math.max(1, Math.floor(args.currentHours || 24)));
  const baselineDays = Math.min(90,  Math.max(1, Math.floor(args.baselineDays || 7)));

  const now = new Date();
  const currentStart  = new Date(now.getTime() - currentHours * 3600 * 1000);
  const baselineStart = new Date(currentStart.getTime() - baselineDays * 86400 * 1000);
  const baselineEnd   = currentStart; // exclusivo: não sobrepõe a janela atual

  // 1) Totais (atual + baseline) numa só ida ao banco.
  const totalsRow = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE created_at >= ${currentStart}                                  )::int AS cur_total,
      COUNT(*) FILTER (WHERE created_at >= ${baselineStart} AND created_at < ${baselineEnd})::int AS base_total
    FROM cron_alert_logs
    WHERE suppressed = false
  `);
  const tr = (totalsRow.rows?.[0] ?? {}) as Record<string, unknown>;
  const curTotal  = Number(tr.cur_total  ?? 0);
  const baseTotal = Number(tr.base_total ?? 0);
  const baseTotalDailyAvg = baseTotal / baselineDays;

  const anomalies: AnomalyEntry[] = [];

  // Dimensão: total
  {
    const { deltaPct, level } = classifyAnomaly(curTotal, baseTotalDailyAvg);
    if (level !== "ok") {
      anomalies.push({
        dimension: "total",
        key: "(total)",
        current: curTotal,
        baselineDailyAvg: Number(baseTotalDailyAvg.toFixed(2)),
        deltaPct: Number(deltaPct.toFixed(1)),
        level,
        label: `Volume total ${fmtPct(deltaPct)} vs baseline (${currentHours}h)`,
      });
    }
  }

  // 2) Por severidade.
  const sevRows = await db.execute(sql`
    SELECT severity,
      COUNT(*) FILTER (WHERE created_at >= ${currentStart}                                  )::int AS cur,
      COUNT(*) FILTER (WHERE created_at >= ${baselineStart} AND created_at < ${baselineEnd})::int AS base
    FROM cron_alert_logs
    WHERE suppressed = false
    GROUP BY severity
  `);
  for (const r of (sevRows.rows ?? []) as any[]) {
    const sev = String(r.severity ?? "");
    const cur = Number(r.cur ?? 0);
    const baseAvg = Number(r.base ?? 0) / baselineDays;
    const { deltaPct, level } = classifyAnomaly(cur, baseAvg);
    if (level !== "ok") {
      anomalies.push({
        dimension: "severity",
        key: sev,
        current: cur,
        baselineDailyAvg: Number(baseAvg.toFixed(2)),
        deltaPct: Number(deltaPct.toFixed(1)),
        level,
        label: `Severidade ${sev} ${fmtPct(deltaPct)} vs baseline (${currentHours}h)`,
      });
    }
  }

  // 3) Por canal — somente envios reais (rate_limited=false, suppressed=false).
  const chRows = await db.execute(sql`
    SELECT (elem->>'channel') AS channel,
      COUNT(*) FILTER (WHERE l.created_at >= ${currentStart}                                  )::int AS cur,
      COUNT(*) FILTER (WHERE l.created_at >= ${baselineStart} AND l.created_at < ${baselineEnd})::int AS base
    FROM cron_alert_logs l,
         LATERAL jsonb_array_elements(COALESCE(l.results, '[]'::jsonb)) AS elem
    WHERE l.rate_limited = false
      AND l.suppressed   = false
    GROUP BY channel
  `);
  for (const r of (chRows.rows ?? []) as any[]) {
    const ch = r.channel ? String(r.channel) : null;
    if (!ch) continue;
    const cur = Number(r.cur ?? 0);
    const baseAvg = Number(r.base ?? 0) / baselineDays;
    const { deltaPct, level } = classifyAnomaly(cur, baseAvg);
    if (level !== "ok") {
      anomalies.push({
        dimension: "channel",
        key: ch,
        current: cur,
        baselineDailyAvg: Number(baseAvg.toFixed(2)),
        deltaPct: Number(deltaPct.toFixed(1)),
        level,
        label: `Canal ${ch} ${fmtPct(deltaPct)} envios vs baseline (${currentHours}h)`,
      });
    }
  }

  // Ordena: critical antes de warning, depois maior delta primeiro.
  const order: Record<AnomalyLevel, number> = { critical: 0, warning: 1, ok: 2 };
  anomalies.sort((a, b) => {
    if (order[a.level] !== order[b.level]) return order[a.level] - order[b.level];
    return b.deltaPct - a.deltaPct;
  });

  return {
    currentHours,
    baselineDays,
    generatedAt: now.toISOString(),
    anomalies,
  };
}

// ── Insights automáticos ─────────────────────────────────────────────────────

/**
 * Constrói uma lista de insights legíveis para o dashboard (NUNCA dispara
 * alerta). Cada regra (R1–R5) é independente; pode haver vários insights
 * simultâneos. Vazio = sistema saudável.
 */
export async function buildInsights(args: { windowHours: number }): Promise<InsightReport> {
  const windowHours = Math.min(720, Math.max(1, Math.floor(args.windowHours || 24)));

  const now = new Date();
  const windowStart = new Date(now.getTime() - windowHours * 3600 * 1000);

  // Baseline: mesma duração da janela, deslocada 7 dias atrás (referência semanal).
  // Para windowHours=24, isso vira "mesma janela 7 dias atrás" como baseline diário.
  const baselineDays = 7;
  const baselineStart = new Date(windowStart.getTime() - baselineDays * 86400 * 1000);
  const baselineEnd   = windowStart;

  const insights: InsightEntry[] = [];

  // ── R1 / R2 — spike total e por severidade ───────────────────────────────
  // Usa o próprio buildAnomalies pra reaproveitar a lógica/thresholds.
  // currentHours = windowHours (clamp 1..168 dentro de buildAnomalies — para
  // janelas maiores que 168h, R1/R2 silenciosamente trabalham com 168h).
  const anomalies = await buildAnomalies({
    currentHours: Math.min(168, windowHours),
    baselineDays,
  });
  for (const a of anomalies.anomalies) {
    if (a.dimension === "total") {
      insights.push({
        id: "R1_spike_total",
        level: a.level === "critical" ? "critical" : "warning",
        title: `Volume de alertas ${fmtPct(a.deltaPct)}`,
        detail: `Janela atual: ${a.current} alertas vs média diária de ${fmtNum(a.baselineDailyAvg)} nos ${baselineDays} dias anteriores.`,
        metric: { current: a.current, baseline: a.baselineDailyAvg, deltaPct: a.deltaPct },
      });
    } else if (a.dimension === "severity") {
      insights.push({
        id: `R2_spike_severity_${a.key}`,
        level: a.level === "critical" ? "critical" : "warning",
        title: `Severidade ${a.key} ${fmtPct(a.deltaPct)}`,
        detail: `Janela atual: ${a.current} eventos ${a.key} vs média diária de ${fmtNum(a.baselineDailyAvg)}.`,
        metric: { severity: a.key, current: a.current, baseline: a.baselineDailyAvg, deltaPct: a.deltaPct },
      });
    }
  }

  // ── R3 — Canal com baixa taxa de sucesso ─────────────────────────────────
  const chRows = await db.execute(sql`
    SELECT (elem->>'channel') AS channel,
      COUNT(*)::int AS samples,
      COUNT(*) FILTER (WHERE (elem->>'ok')::boolean = true)::int AS oks
    FROM cron_alert_logs l,
         LATERAL jsonb_array_elements(COALESCE(l.results, '[]'::jsonb)) AS elem
    WHERE l.created_at >= ${windowStart}
      AND l.rate_limited = false
      AND l.suppressed   = false
    GROUP BY channel
  `);
  for (const r of (chRows.rows ?? []) as any[]) {
    const ch = r.channel ? String(r.channel) : null;
    if (!ch) continue;
    const samples = Number(r.samples ?? 0);
    if (samples < INTELLIGENCE_CONFIG.CHANNEL_MIN_SAMPLES) continue;
    const oks  = Number(r.oks ?? 0);
    const rate = samples > 0 ? oks / samples : 0;
    if (rate >= INTELLIGENCE_CONFIG.CHANNEL_WARNING_RATE) continue;
    const level: InsightLevel = rate < INTELLIGENCE_CONFIG.CHANNEL_CRITICAL_RATE ? "critical" : "warning";
    insights.push({
      id: `R3_channel_low_success_${ch}`,
      level,
      title: `Canal ${ch} com baixa taxa de sucesso`,
      detail: `Apenas ${(rate * 100).toFixed(0)}% dos envios por ${ch} tiveram sucesso (${oks} de ${samples}) na janela.`,
      metric: { channel: ch, successRate: Number(rate.toFixed(3)), samples, oks },
    });
  }

  // ── R4 — Título recorrente em ascensão ───────────────────────────────────
  const titleRows = await db.execute(sql`
    SELECT title,
      COUNT(*) FILTER (WHERE created_at >= ${windowStart}                                  )::int AS cur,
      COUNT(*) FILTER (WHERE created_at >= ${baselineStart} AND created_at < ${baselineEnd})::int AS base
    FROM cron_alert_logs
    WHERE suppressed = false
      AND created_at >= ${baselineStart}
    GROUP BY title
    HAVING COUNT(*) FILTER (WHERE created_at >= ${windowStart}) >= ${INTELLIGENCE_CONFIG.RECURRING_TITLE_MIN}
  `);
  for (const r of (titleRows.rows ?? []) as any[]) {
    const title = String(r.title ?? "");
    const cur = Number(r.cur ?? 0);
    const baseAvg = Number(r.base ?? 0) / baselineDays;
    const { deltaPct, level } = classifyAnomaly(cur, baseAvg);
    if (level === "ok") continue;
    insights.push({
      id: `R4_recurring_title`,
      level: level === "critical" ? "critical" : "warning",
      title: `Título recorrente: "${title}"`,
      detail: `Apareceu ${cur} vezes na janela (${fmtPct(deltaPct)} vs média diária de ${fmtNum(baseAvg)}).`,
      metric: { titleKey: title, current: cur, baseline: baseAvg, deltaPct },
    });
  }

  // ── R5 — Auto-supressão alta ─────────────────────────────────────────────
  const supRow = await db.execute(sql`
    SELECT
      COUNT(*)::int                                       AS total,
      COUNT(*) FILTER (WHERE suppressed = true)::int      AS suppressed
    FROM cron_alert_logs
    WHERE created_at >= ${windowStart}
  `);
  const sr = (supRow.rows?.[0] ?? {}) as Record<string, unknown>;
  const totalAttempts = Number(sr.total ?? 0);
  const suppressed    = Number(sr.suppressed ?? 0);
  if (totalAttempts >= 5) {
    const rate = totalAttempts > 0 ? suppressed / totalAttempts : 0;
    if (rate > 0.30) {
      insights.push({
        id: "R5_suppression_high",
        level: "info",
        title: "Auto-supressão acima do habitual",
        detail: `${(rate * 100).toFixed(0)}% das tentativas de alerta foram suprimidas (${suppressed} de ${totalAttempts}) na janela.`,
        metric: { suppressed, total: totalAttempts, rate: Number(rate.toFixed(3)) },
      });
    }
  }

  // Ordena: critical → warning → info; depois alfabético por id pra estabilidade.
  const order: Record<InsightLevel, number> = { critical: 0, warning: 1, info: 2 };
  insights.sort((a, b) => {
    if (order[a.level] !== order[b.level]) return order[a.level] - order[b.level];
    return a.id.localeCompare(b.id);
  });

  return {
    windowHours,
    generatedAt: now.toISOString(),
    insights,
  };
}
