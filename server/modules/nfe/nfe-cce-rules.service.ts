/**
 * FASE 14.3 — CC-e Rules Service
 *
 * Centralises all enterprise-grade business rules for Carta de Correção
 * Eletrônica. Each rule is a focused async function that throws a typed
 * error object when the rule is violated, keeping the route handler thin.
 *
 * Rules enforced:
 *   1. Limit — maximum 20 CC-e per NF-e (SEFAZ regulation)
 *   2. Time window — NF-e must have been authorised within the last 30 days
 *   3. Status — NF-e must be in status "autorizada"
 *   4. Motivo — correction text must be at least 10 characters
 *
 * None of these functions write anything; they are pure validation gates.
 */

import { db } from "../../database/db";
import { nfeCce } from "@shared/schema";
import type { NfeEmissao } from "@shared/schema";
import { eq, count } from "drizzle-orm";

export const CCE_MAX_COUNT = 20;
export const CCE_MAX_DAYS = 30;
export const CCE_MIN_LENGTH = 10;

export interface CceRuleViolation {
  status: 422 | 423 | 403 | 400;
  code: string;
  message: string;
}

// ── Rule 1 — Limit ────────────────────────────────────────────────────────────

export async function validateCceLimit(nfeId: number): Promise<void> {
  const [row] = await db
    .select({ total: count() })
    .from(nfeCce)
    .where(eq(nfeCce.nfeId, nfeId));

  const total = Number(row?.total ?? 0);
  if (total >= CCE_MAX_COUNT) {
    const violation: CceRuleViolation = {
      status: 422,
      code: "CCE_LIMIT_REACHED",
      message: `Limite de CC-e atingido para esta NF-e (máximo ${CCE_MAX_COUNT})`,
    };
    throw violation;
  }
}

// ── Rule 2 — Time window ──────────────────────────────────────────────────────

export function validateCceTimeWindow(nfe: NfeEmissao): void {
  const referenceDate: Date | null = nfe.dataAutorizacao ?? null;

  if (!referenceDate) {
    return;
  }

  const diffMs = Date.now() - new Date(referenceDate).getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  if (diffDays > CCE_MAX_DAYS) {
    const violation: CceRuleViolation = {
      status: 423,
      code: "CCE_TIME_EXPIRED",
      message: `CC-e bloqueada por tempo de emissão (limite de ${CCE_MAX_DAYS} dias após autorização)`,
    };
    throw violation;
  }
}

// ── Rule 3 — Status ───────────────────────────────────────────────────────────

export function validateCceStatus(nfe: NfeEmissao): void {
  if (nfe.status !== "autorizada") {
    const violation: CceRuleViolation = {
      status: 403,
      code: "CCE_INVALID_STATUS",
      message: "CC-e só pode ser emitida para NF-e com status AUTORIZADA",
    };
    throw violation;
  }
}

// ── Rule 4 — Motivo length ────────────────────────────────────────────────────

export function validateCceMotivo(correcao: string): void {
  if (!correcao || correcao.trim().length < CCE_MIN_LENGTH) {
    const violation: CceRuleViolation = {
      status: 422,
      code: "CCE_MOTIVO_INVALIDO",
      message: `Motivo de CC-e inválido (mínimo ${CCE_MIN_LENGTH} caracteres)`,
    };
    throw violation;
  }
}

// ── Type guard ────────────────────────────────────────────────────────────────

export function isCceRuleViolation(err: unknown): err is CceRuleViolation {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    "status" in err &&
    "message" in err
  );
}
