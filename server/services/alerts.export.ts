/**
 * STEP 9.3F.8 — Exportação CSV dos alertas (uso externo / Excel).
 *
 * REGRAS ABSOLUTAS:
 *   - NUNCA cria nova lógica de cálculo.
 *   - NUNCA recalcula métricas — reusa 100% `buildDigest()`.
 *   - NUNCA acessa dados fora de cron_alert_logs (via buildDigest).
 *   - NUNCA modifica `emitAlert`, `persistAlertLog`, ou tabelas.
 *
 * Produz um CSV "tidy" com as seguintes colunas (cabeçalho fixo):
 *   timestamp_export, window_hours,
 *   total, sent, rate_limited, suppressed,
 *   top_channel, top_title,
 *   insight_level, insight_title,
 *   anomaly_dimension, anomaly_level
 *
 * Estratégia de linhas (uma "row" por evento):
 *   - 1 linha por insight (cols de anomalia vazias)
 *   - 1 linha por anomalia (cols de insight vazias)
 *   - Se NÃO houver nem insight nem anomalia → 1 linha só com o sumário.
 *
 * Os campos de sumário/destaque (total/sent/.../top_channel/top_title) são
 * repetidos em todas as linhas — facilita análise/pivot no Excel.
 */

import { buildDigest } from "./alerts.digest";

// ── Helpers CSV ──────────────────────────────────────────────────────────────

/** Escapa um campo CSV conforme RFC 4180:
 *   - Envolve em aspas se contém vírgula, aspas, CR ou LF.
 *   - Aspas internas viram aspas duplicadas.
 *   - null/undefined → string vazia. */
function csvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function csvRow(fields: unknown[]): string {
  return fields.map(csvField).join(",");
}

// ── Função pública ───────────────────────────────────────────────────────────

export type CsvExportResult = {
  filename: string;
  csv: string;
  windowHours: number;
  rowCount: number; // linhas de dados (sem o header)
};

/**
 * Gera o CSV da janela informada.
 *
 * NB: windowHours é normalizado dentro de `buildDigest` (1..720).
 */
export async function buildAlertsCsv(args: { windowHours: number }): Promise<CsvExportResult> {
  const digest = await buildDigest({ windowHours: args.windowHours });

  const header = [
    "timestamp_export",
    "window_hours",
    "total",
    "sent",
    "rate_limited",
    "suppressed",
    "top_channel",
    "top_title",
    "insight_level",
    "insight_title",
    "anomaly_dimension",
    "anomaly_level",
  ];

  // Campos comuns (sumário + destaques) repetidos em toda linha.
  const baseCols = [
    digest.generatedAt,
    digest.windowHours,
    digest.summary.total,
    digest.summary.sent,
    digest.summary.rate_limited,
    digest.summary.suppressed,
    digest.highlights.topChannel ?? "",
    digest.highlights.topTitle ?? "",
  ];

  const rows: string[] = [csvRow(header)];

  // Linhas por insight (anomalia vazia).
  for (const ins of digest.insights) {
    rows.push(csvRow([...baseCols, ins.level, ins.title, "", ""]));
  }

  // Linhas por anomalia (insight vazio).
  for (const a of digest.anomalies) {
    // O tipo AnomalyEntry expõe: dimension ('channel'|'title'), level, label, ...
    rows.push(csvRow([...baseCols, "", "", a.dimension, a.level]));
  }

  // Se não houver nenhum evento, ainda assim emitimos a linha de sumário.
  if (digest.insights.length === 0 && digest.anomalies.length === 0) {
    rows.push(csvRow([...baseCols, "", "", "", ""]));
  }

  const csv = rows.join("\r\n") + "\r\n";

  // Filename amigável: alerts-<windowHours>h-<YYYYMMDD-HHmm>.csv
  const ts = digest.generatedAt
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z")
    .replace("T", "-")
    .slice(0, 13); // ex: 20260426-2058
  const filename = `alerts-${digest.windowHours}h-${ts}.csv`;

  return {
    filename,
    csv,
    windowHours: digest.windowHours,
    rowCount: rows.length - 1,
  };
}
