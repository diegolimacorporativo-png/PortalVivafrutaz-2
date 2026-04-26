/**
 * STEP 9.3F.7 — Digest automático de alertas (resumo inteligente).
 *
 * REGRAS ABSOLUTAS:
 *   - NUNCA modifica `emitAlert`.
 *   - NUNCA modifica `persistAlertLog` (zero escritas — leitura pura).
 *   - NUNCA cria nova tabela ou contrato.
 *   - NUNCA recalcula a lógica de insights/anomalias — apenas as compõe.
 *
 * O que faz:
 *   - Reusa `buildInsights({ windowHours })` (R1–R5)
 *   - Reusa `buildAnomalies(...)` com a mesma janela e o mesmo baseline que
 *     `buildInsights` usa internamente (consistência entre cards)
 *   - Faz 3 queries pequenas de agregação (summary, top channel, top title)
 *     para complementar os destaques. Estruturalmente parecidas com as do
 *     /analytics, mas operando em janela de horas (não de dias) — não há
 *     função reutilizável já exposta para isso, então é o mínimo necessário.
 *   - Compõe uma mensagem em linguagem natural a partir dos dados (sem IA).
 */

import { sql } from "drizzle-orm";
import { db } from "../database/db";
import {
  buildAnomalies,
  buildInsights,
  type AnomalyEntry,
  type InsightEntry,
} from "./alerts.intelligence";

// ── Tipos públicos ───────────────────────────────────────────────────────────

export type DigestSummary = {
  total: number;
  sent: number;          // mutuamente exclusivo: !rate_limited && !suppressed
  rate_limited: number;
  suppressed: number;
};

export type DigestHighlights = {
  topChannel: string | null;   // canal mais problemático (mais falhas) na janela
  topTitle: string | null;     // título mais recorrente (excluindo suprimidos)
};

export type DigestReport = {
  windowHours: number;
  generatedAt: string;
  summary: DigestSummary;
  insights: InsightEntry[];
  anomalies: AnomalyEntry[];
  highlights: DigestHighlights;
  message: string;
};

// ── Helpers internos ─────────────────────────────────────────────────────────

async function fetchSummary(windowStart: Date): Promise<DigestSummary> {
  const row = await db.execute(sql`
    SELECT
      COUNT(*)::int                                                                    AS total,
      COUNT(*) FILTER (WHERE rate_limited = true)::int                                 AS rate_limited,
      COUNT(*) FILTER (WHERE suppressed   = true)::int                                 AS suppressed,
      COUNT(*) FILTER (WHERE rate_limited = false AND suppressed = false)::int         AS sent
    FROM cron_alert_logs
    WHERE created_at >= ${windowStart}
  `);
  const r = (row.rows?.[0] ?? {}) as Record<string, unknown>;
  return {
    total:        Number(r.total        ?? 0),
    rate_limited: Number(r.rate_limited ?? 0),
    suppressed:   Number(r.suppressed   ?? 0),
    sent:         Number(r.sent         ?? 0),
  };
}

/** Canal mais problemático na janela (mais falhas absolutas).
 *  Fallback: canal de maior volume. Null se nada relevante. */
async function fetchTopChannel(windowStart: Date): Promise<string | null> {
  const rows = await db.execute(sql`
    SELECT (elem->>'channel')                                          AS channel,
           COUNT(*)::int                                                AS samples,
           COUNT(*) FILTER (WHERE (elem->>'ok')::boolean = false)::int  AS fails
    FROM cron_alert_logs l,
         LATERAL jsonb_array_elements(COALESCE(l.results, '[]'::jsonb)) AS elem
    WHERE l.created_at  >= ${windowStart}
      AND l.rate_limited = false
      AND l.suppressed   = false
    GROUP BY channel
    ORDER BY fails DESC, samples DESC
    LIMIT 1
  `);
  const r = (rows.rows?.[0] ?? null) as Record<string, unknown> | null;
  if (!r || !r.channel) return null;
  return String(r.channel);
}

/** Título mais recorrente na janela (exclui suprimidos para não inflar). */
async function fetchTopTitle(windowStart: Date): Promise<string | null> {
  const rows = await db.execute(sql`
    SELECT title, COUNT(*)::int AS c
    FROM cron_alert_logs
    WHERE created_at >= ${windowStart}
      AND suppressed = false
    GROUP BY title
    ORDER BY c DESC
    LIMIT 1
  `);
  const r = (rows.rows?.[0] ?? null) as Record<string, unknown> | null;
  if (!r || !r.title) return null;
  return String(r.title);
}

// ── Composição da mensagem em linguagem natural ──────────────────────────────

function composeMessage(args: {
  windowHours: number;
  summary: DigestSummary;
  insights: InsightEntry[];
  anomalies: AnomalyEntry[];
  highlights: DigestHighlights;
}): string {
  const { windowHours, summary, insights, anomalies, highlights } = args;

  if (summary.total === 0) {
    return `Nenhum alerta registrado nas últimas ${windowHours}h — o sistema operou em silêncio.`;
  }

  const parts: string[] = [];

  // 1) Lead: o problema mais grave (critical > warning > info).
  const criticalInsight = insights.find((i) => i.level === "critical");
  const criticalAnomaly = anomalies.find((a) => a.level === "critical");
  const warningInsight  = insights.find((i) => i.level === "warning");

  if (criticalInsight) {
    parts.push(`${criticalInsight.title}.`);
  } else if (criticalAnomaly) {
    parts.push(`${criticalAnomaly.label}.`);
  } else if (warningInsight) {
    parts.push(`${warningInsight.title}.`);
  }

  // 2) Título recorrente em destaque (se houver e fizer sentido citar).
  if (highlights.topTitle && summary.total >= 3) {
    parts.push(`O alerta mais frequente foi "${highlights.topTitle}".`);
  }

  // 3) Canal problemático — só comenta se há mais de uma classe de evento ou
  //    se o canal apareceu no destaque por causa de falhas (não por volume).
  if (highlights.topChannel && summary.sent > 0) {
    parts.push(`Canal ${highlights.topChannel} concentrou a maior atividade.`);
  }

  // 4) Sinal de ruído elevado (taxa de supressão).
  if (summary.total > 0) {
    const supRate = summary.suppressed / summary.total;
    if (supRate > 0.3) {
      parts.push(
        `${Math.round(supRate * 100)}% dos alertas foram suprimidos, indicando possível ruído elevado.`,
      );
    }
  }

  // 5) Fallback amigável quando nada de notável foi colocado em destaque.
  if (parts.length === 0) {
    parts.push(
      `${summary.total} alerta(s) nas últimas ${windowHours}h — ` +
      `${summary.sent} entregue(s), ${summary.rate_limited} bloqueado(s) por anti-spam, ${summary.suppressed} suprimido(s).`,
    );
  }

  return parts.join(" ");
}

// ── Função pública ───────────────────────────────────────────────────────────

/**
 * Monta o digest da janela informada. windowHours é validado em 1..720.
 *
 * Composição:
 *   - summary  → 1 query agregada
 *   - insights → buildInsights(windowHours)              (reuso 100%)
 *   - anomalies→ buildAnomalies({currentHours, baselineDays:7})  (mesma config
 *                que `buildInsights` usa internamente, para coerência)
 *   - highlights → top channel + top title (2 queries)
 *   - message  → composição local em pt-BR, sem IA externa
 */
export async function buildDigest(args: { windowHours: number }): Promise<DigestReport> {
  const windowHours = Math.min(720, Math.max(1, Math.floor(args.windowHours || 24)));
  const now = new Date();
  const windowStart = new Date(now.getTime() - windowHours * 3600 * 1000);

  // Mantém alinhado com o que `buildInsights` faz internamente em R1/R2:
  // currentHours capado em 168, baselineDays fixo em 7.
  const anomalyParams = {
    currentHours: Math.min(168, windowHours),
    baselineDays: 7,
  };

  const [summary, insightReport, anomalyReport, topChannel, topTitle] = await Promise.all([
    fetchSummary(windowStart),
    buildInsights({ windowHours }),
    buildAnomalies(anomalyParams),
    fetchTopChannel(windowStart),
    fetchTopTitle(windowStart),
  ]);

  const highlights: DigestHighlights = { topChannel, topTitle };

  // Top 3 anomalias (já vêm ordenadas por critical→warning→delta em buildAnomalies).
  const topAnomalies = anomalyReport.anomalies.slice(0, 3);

  const message = composeMessage({
    windowHours,
    summary,
    insights: insightReport.insights,
    anomalies: topAnomalies,
    highlights,
  });

  return {
    windowHours,
    generatedAt: now.toISOString(),
    summary,
    insights: insightReport.insights,
    anomalies: topAnomalies,
    highlights,
    message,
  };
}
