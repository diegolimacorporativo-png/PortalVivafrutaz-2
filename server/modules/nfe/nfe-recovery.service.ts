/**
 * NF-e Recovery Service — ETAPA 1–7
 *
 * Identifica e recupera NF-es em estados inconsistentes:
 *   RECOVERABLE          — assinada/enviando > 10 min, XML disponível
 *   MANUAL_ACTION_REQUIRED — gerada órfã, enviada sem retorno, sem XML
 *   CRITICAL             — autorizada sem protocolo/chave
 *
 * Invariantes de segurança:
 *  • NUNCA sobrescreve NF-e autorizada ou cancelada
 *  • NUNCA reenviar se já existe autorização para o pedido
 *  • SEMPRE adquire advisory lock antes de qualquer escrita
 *  • SEMPRE preserva xml_gerado, xml_autorizado, protocolo, c_stat
 *  • tpAmb = 2 (homologação) — nunca altera ambiente
 */

import { pool } from "../../database/db";

export type RecoveryRisk = "RECOVERABLE" | "MANUAL_ACTION_REQUIRED" | "CRITICAL";

export interface RecoveryItem {
  order_id: number;
  nfe_id: number;
  numero: string;
  serie: string;
  status: string;
  chave: string | null;
  protocolo: string | null;
  c_stat: string | null;
  x_motivo: string | null;
  idade_min: number;
  ultimo_update: string;
  ambiente: string;
  recovery_type: string;
  risco: RecoveryRisk;
  recomendacao: string;
  has_xml: boolean;
  has_xml_autorizado: boolean;
}

export interface RecoveryScanResult {
  items: RecoveryItem[];
  scanned_at: string;
  total: number;
  by_risco: { RECOVERABLE: number; MANUAL_ACTION_REQUIRED: number; CRITICAL: number };
}

/**
 * Scan read-only. Nenhuma escrita. Retorna todos os casos identificados.
 */
export async function scanForRecovery(): Promise<RecoveryScanResult> {
  const items: RecoveryItem[] = [];
  const scanned_at = new Date().toISOString();

  // ── 1. STUCK: non-terminal > 10 min ──────────────────────────────────────
  const stuck = await pool.query<{
    id: number; order_id: number; numero: string; serie: string;
    status: string; chave_nfe: string | null; protocolo: string | null;
    c_stat: string | null; x_motivo: string | null;
    created_at: Date; ambiente_fiscal: string | null;
    has_xml: boolean; has_xml_autorizado: boolean; idade_min: number;
  }>(`
    SELECT id, order_id, numero, serie, status, chave_nfe, protocolo, c_stat, x_motivo,
      created_at, ambiente_fiscal,
      (xml_gerado   IS NOT NULL) AS has_xml,
      (xml_autorizado IS NOT NULL) AS has_xml_autorizado,
      EXTRACT(EPOCH FROM (NOW() - created_at))/60 AS idade_min
    FROM nfe_emissoes
    WHERE status IN ('gerada','assinada','enviando','enviada')
      AND created_at < NOW() - INTERVAL '10 minutes'
    ORDER BY created_at ASC
  `);

  for (const row of stuck.rows) {
    let recovery_type: string;
    let risco: RecoveryRisk;
    let recomendacao: string;

    if (row.status === "enviada") {
      recovery_type = "ENVIADA_PENDENTE";
      risco = "MANUAL_ACTION_REQUIRED";
      recomendacao =
        "NF-e enviada ao SEFAZ sem retorno persistido. Consultar status SEFAZ manualmente antes de reprocessar para evitar duplicidade.";
    } else if (row.has_xml && (row.status === "assinada" || row.status === "enviando")) {
      recovery_type = "ASSINADA_ORFAO";
      risco = "RECOVERABLE";
      recomendacao =
        "XML assinado disponível. Reenviar via POST /api/admin/nfe/recovery/:id/reprocess (com lock + idempotência).";
    } else if (!row.has_xml && row.status === "gerada") {
      recovery_type = "GERADA_SEM_ASSINATURA";
      risco = "MANUAL_ACTION_REQUIRED";
      recomendacao =
        "NF-e gerada mas sem assinatura. Marcar como erro via /mark-error e re-emitir pelo fluxo normal.";
    } else {
      recovery_type = "STUCK_SEM_XML";
      risco = "MANUAL_ACTION_REQUIRED";
      recomendacao =
        "XML ausente. Marcar como erro via /mark-error e reemitir pelo fluxo normal (/api/nfe/emitir).";
    }

    items.push({
      order_id: row.order_id,
      nfe_id: row.id,
      numero: row.numero,
      serie: row.serie,
      status: row.status,
      chave: row.chave_nfe,
      protocolo: row.protocolo,
      c_stat: row.c_stat,
      x_motivo: row.x_motivo,
      idade_min: Math.round(Number(row.idade_min)),
      ultimo_update: row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
      ambiente: row.ambiente_fiscal ?? "homologacao",
      recovery_type,
      risco,
      recomendacao,
      has_xml: Boolean(row.has_xml),
      has_xml_autorizado: Boolean(row.has_xml_autorizado),
    });
  }

  // ── 2. AUTORIZADA SEM PROTOCOLO OU SEM CHAVE (CRITICAL) ──────────────────
  const authIncomplete = await pool.query<{
    id: number; order_id: number; numero: string; serie: string;
    status: string; chave_nfe: string | null; protocolo: string | null;
    c_stat: string | null; x_motivo: string | null;
    created_at: Date; ambiente_fiscal: string | null;
    has_xml: boolean; has_xml_autorizado: boolean; idade_min: number;
  }>(`
    SELECT id, order_id, numero, serie, status, chave_nfe, protocolo, c_stat, x_motivo,
      created_at, ambiente_fiscal,
      (xml_gerado   IS NOT NULL) AS has_xml,
      (xml_autorizado IS NOT NULL) AS has_xml_autorizado,
      EXTRACT(EPOCH FROM (NOW() - created_at))/60 AS idade_min
    FROM nfe_emissoes
    WHERE status = 'autorizada'
      AND (protocolo IS NULL OR chave_nfe IS NULL)
  `);

  for (const row of authIncomplete.rows) {
    items.push({
      order_id: row.order_id,
      nfe_id: row.id,
      numero: row.numero,
      serie: row.serie,
      status: row.status,
      chave: row.chave_nfe,
      protocolo: row.protocolo,
      c_stat: row.c_stat,
      x_motivo: row.x_motivo,
      idade_min: Math.round(Number(row.idade_min)),
      ultimo_update: row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
      ambiente: row.ambiente_fiscal ?? "homologacao",
      recovery_type: "AUTORIZADA_INCOMPLETA",
      risco: "CRITICAL",
      recomendacao:
        "NF-e autorizada sem protocolo ou chave fiscal. Recuperação manual obrigatória — acionar suporte técnico imediatamente.",
      has_xml: Boolean(row.has_xml),
      has_xml_autorizado: Boolean(row.has_xml_autorizado),
    });
  }

  // ── 3. AUTORIZADA SEM XML ALGUM (falha de persistência pós-auth ou mock) ─
  const authNoXml = await pool.query<{
    id: number; order_id: number; numero: string; serie: string;
    status: string; chave_nfe: string | null; protocolo: string | null;
    c_stat: string | null; x_motivo: string | null;
    created_at: Date; ambiente_fiscal: string | null; idade_min: number;
  }>(`
    SELECT id, order_id, numero, serie, status, chave_nfe, protocolo, c_stat, x_motivo,
      created_at, ambiente_fiscal,
      EXTRACT(EPOCH FROM (NOW() - created_at))/60 AS idade_min
    FROM nfe_emissoes
    WHERE status = 'autorizada'
      AND xml_gerado    IS NULL
      AND xml_autorizado IS NULL
      AND protocolo IS NOT NULL
      AND chave_nfe IS NOT NULL
  `);

  for (const row of authNoXml.rows) {
    items.push({
      order_id: row.order_id,
      nfe_id: row.id,
      numero: row.numero,
      serie: row.serie,
      status: row.status,
      chave: row.chave_nfe,
      protocolo: row.protocolo,
      c_stat: row.c_stat,
      x_motivo: row.x_motivo,
      idade_min: Math.round(Number(row.idade_min)),
      ultimo_update: row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
      ambiente: row.ambiente_fiscal ?? "homologacao",
      recovery_type: "AUTORIZADA_SEM_XML",
      risco: "MANUAL_ACTION_REQUIRED",
      recomendacao:
        "NF-e autorizada sem XML armazenado. Verificar se emitida em modo mock. Protocolo e chave presentes — nota tem validade fiscal.",
      has_xml: false,
      has_xml_autorizado: false,
    });
  }

  // ── 4. REJEITADA SEM MOTIVO ───────────────────────────────────────────────
  const rejNoReason = await pool.query<{
    id: number; order_id: number; numero: string; serie: string;
    status: string; chave_nfe: string | null; protocolo: string | null;
    c_stat: string | null; x_motivo: string | null;
    created_at: Date; ambiente_fiscal: string | null;
    has_xml: boolean; has_xml_autorizado: boolean; idade_min: number;
  }>(`
    SELECT id, order_id, numero, serie, status, chave_nfe, protocolo, c_stat, x_motivo,
      created_at, ambiente_fiscal,
      (xml_gerado   IS NOT NULL) AS has_xml,
      (xml_autorizado IS NOT NULL) AS has_xml_autorizado,
      EXTRACT(EPOCH FROM (NOW() - created_at))/60 AS idade_min
    FROM nfe_emissoes
    WHERE status = 'rejeitada'
      AND (c_stat IS NULL OR x_motivo IS NULL)
  `);

  for (const row of rejNoReason.rows) {
    items.push({
      order_id: row.order_id,
      nfe_id: row.id,
      numero: row.numero,
      serie: row.serie,
      status: row.status,
      chave: row.chave_nfe,
      protocolo: row.protocolo,
      c_stat: row.c_stat,
      x_motivo: row.x_motivo,
      idade_min: Math.round(Number(row.idade_min)),
      ultimo_update: row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
      ambiente: row.ambiente_fiscal ?? "homologacao",
      recovery_type: "REJEITADA_INCOMPLETA",
      risco: "MANUAL_ACTION_REQUIRED",
      recomendacao:
        "Rejeição sem cStat ou xMotivo registrado. Corrigir dados cadastrais e reemitir via /api/nfe/emitir.",
      has_xml: Boolean(row.has_xml),
      has_xml_autorizado: Boolean(row.has_xml_autorizado),
    });
  }

  // ── Contagem por risco ────────────────────────────────────────────────────
  const by_risco = {
    RECOVERABLE: items.filter((i) => i.risco === "RECOVERABLE").length,
    MANUAL_ACTION_REQUIRED: items.filter((i) => i.risco === "MANUAL_ACTION_REQUIRED").length,
    CRITICAL: items.filter((i) => i.risco === "CRITICAL").length,
  };

  return { items, scanned_at, total: items.length, by_risco };
}
