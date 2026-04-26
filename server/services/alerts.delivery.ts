/**
 * STEP 9.3F.12 — Camada de Entrega (Email / WhatsApp / etc.)
 * STEP 9.3F.13 — Integração completa: Roteamento (F.10) + Preferências (F.11)
 *                + Canais (F.12). Tudo encapsulado AQUI dentro.
 *
 * REGRAS ABSOLUTAS:
 *   - NUNCA modifica `emitAlert` (apenas é invocado por ele de forma plugada).
 *   - NUNCA modifica `emitAlertSmart`.
 *   - NUNCA modifica `persistAlertLog`.
 *   - NUNCA altera o `results` que o emitAlert retorna / persiste.
 *   - NUNCA cria tabela nova nem endpoint paralelo.
 *   - Falha desta camada NUNCA pode quebrar o fluxo principal de alertas.
 *
 * O que esta camada faz (STEP 9.3F.13):
 *   1. Lê `context.recipientsRoles` (vem do STEP 9.3F.10).
 *   2. Busca usuários cujo `role` está nessa lista (tabela `users` existente).
 *   3. Para cada usuário, lê suas `userNotificationPreferences` (STEP 9.3F.11)
 *      e filtra por:
 *        - `enabled === true`
 *        - severidade compatível via `isSeverityAllowed(pref.minSeverity, alert.severity)`
 *        - categoria compatível com `context.category` (quando o usuário
 *          tem preferência explícita para essa categoria).
 *      Se o usuário NÃO tem preferência para a categoria do alerta,
 *      assume opt-in por padrão (envia) — coerente com o comportamento atual
 *      de "ADMIN recebe tudo".
 *   4. Devolve `results` no padrão `[{ channel, success, userId }]`.
 *      Mock por enquanto — envio real em STEP 9.3F.14.
 *
 * Failure modes:
 *   - Falha de DB → log + retorna `[]` (sem entrega), NUNCA propaga.
 *   - Sem `recipientsRoles` ou lista vazia → retorna `[]`.
 *   - Sem usuários encontrados → retorna `[]`.
 */

import { inArray } from "drizzle-orm";
import { db } from "../database/db";
import { users, type UserNotificationPreference } from "@shared/schema";
import {
  getUserPreferences,
  isSeverityAllowed,
} from "./alerts.preferences";

export type DeliveryChannel = "email" | "whatsapp";

export interface DeliverAlertInput {
  title: string;
  message: string;
  severity: string;
  context?: Record<string, unknown>;
}

export interface DeliveryResult {
  channel: DeliveryChannel;
  success: boolean;
  userId: number;
}

// ── Helpers internos ─────────────────────────────────────────────────────────

/** Normaliza string de role/categoria/severidade. */
function norm(s: unknown): string {
  return typeof s === "string" ? s.trim().toUpperCase() : "";
}

/** Lê `context.recipientsRoles` defensivamente. */
function readRecipientsRoles(ctx: Record<string, unknown> | undefined): string[] {
  if (!ctx || !Array.isArray(ctx.recipientsRoles)) return [];
  return (ctx.recipientsRoles as unknown[])
    .filter((r): r is string => typeof r === "string")
    .map(norm)
    .filter(Boolean);
}

/** Lê `context.category` defensivamente. */
function readCategory(ctx: Record<string, unknown> | undefined): string | null {
  const raw = ctx?.category;
  if (typeof raw !== "string") return null;
  const c = norm(raw);
  return c || null;
}

/** STEP 9.3F.13 — Fase 2: usuários cujo role bate com `roles`. */
async function getUsersByRoles(roles: string[]): Promise<
  Array<{ id: number; role: string }>
> {
  if (roles.length === 0) return [];
  try {
    const rows = await db
      .select({ id: users.id, role: users.role, active: users.active })
      .from(users)
      .where(inArray(users.role, roles));
    // Apenas usuários ativos podem receber.
    return rows.filter((u) => u.active).map((u) => ({ id: u.id, role: u.role }));
  } catch (err) {
    console.error("[ALERT_DELIVERY_USERS_QUERY_ERROR]", err);
    return [];
  }
}

/**
 * STEP 9.3F.13 — Fase 3: decide se um usuário deve receber o alerta
 * com base em suas preferências.
 *
 * Regras:
 *   - Sem categoria no alerta → considerar apenas severidade global do usuário?
 *     Não temos preferência "global" — então passa por padrão.
 *   - Com categoria no alerta:
 *       * Se o usuário tem preferência explícita para a categoria:
 *           - `enabled` precisa ser true
 *           - `isSeverityAllowed(pref.minSeverity, severity)` precisa ser true
 *       * Se o usuário NÃO tem preferência para a categoria → opt-in (passa).
 */
function shouldUserReceive(
  prefs: UserNotificationPreference[],
  alertCategory: string | null,
  alertSeverity: string,
): boolean {
  if (!alertCategory) return true;
  const match = prefs.find((p) => norm(p.category) === alertCategory);
  if (!match) return true; // sem preferência explícita → recebe (opt-in default)
  if (!match.enabled) return false;
  return isSeverityAllowed(match.minSeverity, alertSeverity);
}

// ── Função pública ──────────────────────────────────────────────────────────

/**
 * Entrega o alerta (mock) para os usuários efetivamente elegíveis após:
 *   roteamento (roles) ∩ preferências (enabled + categoria + severidade).
 */
export async function deliverAlert(
  input: DeliverAlertInput,
): Promise<DeliveryResult[]> {
  const ctx = (input.context ?? {}) as Record<string, unknown>;
  const recipientsRoles = readRecipientsRoles(ctx);
  const alertCategory = readCategory(ctx);
  const severity = norm(input.severity);

  // Sem roles resolvidos → nada a entregar (fail-safe).
  if (recipientsRoles.length === 0) {
    try {
      console.log("[ALERT_DELIVERY]", {
        title: input.title,
        severity: input.severity,
        recipientsRoles,
        resolvedUsers: 0,
        results: [],
        reason: "no_recipients_roles",
      });
    } catch {
      /* no-op */
    }
    return [];
  }

  // Fase 2 — usuários com role compatível.
  const candidates = await getUsersByRoles(recipientsRoles);

  // Fase 3 — aplicar preferências por usuário (em paralelo).
  const filtered: Array<{ id: number; role: string }> = [];
  await Promise.all(
    candidates.map(async (u) => {
      try {
        const prefs = await getUserPreferences(u.id);
        if (shouldUserReceive(prefs, alertCategory, severity)) {
          filtered.push(u);
        }
      } catch (err) {
        // Falha lendo prefs → não bloqueia o sistema. Decide opt-in
        // (envia) para não perder alertas legítimos por bug isolado.
        console.error("[ALERT_DELIVERY_PREFS_ERROR]", { userId: u.id, err });
        filtered.push(u);
      }
    }),
  );

  // Fase 5 — montar results por usuário (mock por canal).
  const results: DeliveryResult[] = [];
  for (const u of filtered) {
    results.push({ channel: "email", success: true, userId: u.id });
    results.push({ channel: "whatsapp", success: true, userId: u.id });
  }

  // Fase 6 — log informativo (NÃO altera persistência existente).
  try {
    console.log("[ALERT_DELIVERY]", {
      title: input.title,
      severity: input.severity,
      category: alertCategory,
      recipientsRoles,
      candidates: candidates.length,
      resolvedUsers: filtered.length,
      results,
    });
  } catch {
    /* no-op */
  }

  return results;
}
