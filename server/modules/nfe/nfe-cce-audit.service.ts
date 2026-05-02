/**
 * FASE 14.3 — CC-e Audit Service
 *
 * Persists a structured audit record for every CC-e operation. The audit log
 * captures a full before/after snapshot so the fiscal trail is reconstructible
 * at any point for SEFAZ or internal compliance review.
 *
 * Architecture decision: audit writes are fire-and-forget — they never block
 * the main response path. If the insert fails, the error is logged but the
 * CC-e itself is NOT rolled back, because losing an audit record is less
 * harmful than failing to persist the correction.
 */

import { db } from "../../database/db";
import { nfeCceAuditLogs } from "@shared/schema";
import type { NfeEmissao, NfeCce } from "@shared/schema";

export interface CceAuditParams {
  nfeId: number;
  sequencia: number;
  userId: number | null;
  empresaId: number | null;
  correcao: string;
  nfeSnapshot: NfeEmissao;
  cceSnapshot: NfeCce;
}

export async function recordCceAudit(params: CceAuditParams): Promise<void> {
  const {
    nfeId,
    sequencia,
    userId,
    empresaId,
    correcao,
    nfeSnapshot,
    cceSnapshot,
  } = params;

  const payloadAnterior = {
    nfe: {
      id: nfeSnapshot.id,
      numero: nfeSnapshot.numero,
      serie: nfeSnapshot.serie,
      status: nfeSnapshot.status,
      chaveNFe: nfeSnapshot.chaveNFe,
      dataAutorizacao: nfeSnapshot.dataAutorizacao,
      protocolo: nfeSnapshot.protocolo,
    },
  };

  const payloadNovo = {
    cce: {
      id: cceSnapshot.id,
      sequencia: cceSnapshot.sequencia,
      correcao: cceSnapshot.correcao,
      createdAt: cceSnapshot.createdAt,
    },
  };

  try {
    await db.insert(nfeCceAuditLogs).values({
      nfeId,
      sequencia,
      userId: userId ?? null,
      empresaId: empresaId ?? null,
      correcao,
      payloadAnterior,
      payloadNovo,
    });
  } catch (err) {
    console.error(
      `[CCE_AUDIT] Falha ao registrar auditoria | nfeId=${nfeId} sequencia=${sequencia}`,
      err,
    );
  }
}
