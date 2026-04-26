/**
 * STEP 9.3F.11 — Preferências de notificação por usuário (BASE DE CONTROLE).
 *
 * REGRAS ABSOLUTAS:
 *   - NUNCA modifica `emitAlert`, `emitAlertSmart`, `persistAlertLog`.
 *   - NUNCA toca em endpoints de alertas existentes.
 *   - Esta camada NÃO envia nada nem filtra envio. É só persistência +
 *     leitura das preferências do usuário, e um helper de comparação de
 *     severidade que será usado em STEPs futuros (delivery layer).
 */

import { eq } from "drizzle-orm";
import { db } from "../database/db";
import {
  userNotificationPreferences,
  type UserNotificationPreference,
} from "@shared/schema";

// ── Constantes públicas ──────────────────────────────────────────────────────

/** Ordem canônica de severidade (do mais leve ao mais grave). */
export const SEVERITY_ORDER = ["INFO", "WARNING", "ALERT", "CRITICAL"] as const;
export type SeverityLevel = (typeof SEVERITY_ORDER)[number];

// ── Leitura ──────────────────────────────────────────────────────────────────

/** Lista todas as preferências de um usuário (todas as categorias). */
export async function getUserPreferences(
  userId: number,
): Promise<UserNotificationPreference[]> {
  return db
    .select()
    .from(userNotificationPreferences)
    .where(eq(userNotificationPreferences.userId, userId));
}

// ── Escrita (upsert) ─────────────────────────────────────────────────────────

export type UpsertUserPreferenceInput = {
  userId: number;
  category: string;     // será normalizada p/ UPPERCASE + trim
  minSeverity: string;  // será normalizada p/ UPPERCASE + trim
  enabled: boolean;
};

/**
 * Upsert idempotente — usa o índice único (userId, category).
 * Nunca cria linhas duplicadas para o mesmo par.
 */
export async function upsertUserPreference(
  input: UpsertUserPreferenceInput,
): Promise<UserNotificationPreference> {
  const values = {
    userId: input.userId,
    category: input.category.trim().toUpperCase(),
    minSeverity: input.minSeverity.trim().toUpperCase(),
    enabled: input.enabled,
  };

  const [row] = await db
    .insert(userNotificationPreferences)
    .values(values)
    .onConflictDoUpdate({
      target: [
        userNotificationPreferences.userId,
        userNotificationPreferences.category,
      ],
      set: {
        minSeverity: values.minSeverity,
        enabled: values.enabled,
      },
    })
    .returning();
  return row;
}

// ── Helper: comparação de severidade (usado pela futura delivery layer) ─────

/**
 * Retorna true se `alertSeverity` é >= `userMin` na ordem canônica.
 * Comparação case-insensitive. Severidades desconhecidas → fail-open
 * (deixa passar) para não bloquear silenciosamente alertas legítimos.
 */
export function isSeverityAllowed(userMin: string, alertSeverity: string): boolean {
  const minIdx   = SEVERITY_ORDER.indexOf(String(userMin).trim().toUpperCase() as SeverityLevel);
  const alertIdx = SEVERITY_ORDER.indexOf(String(alertSeverity).trim().toUpperCase() as SeverityLevel);
  if (minIdx < 0 || alertIdx < 0) return true;
  return alertIdx >= minIdx;
}
