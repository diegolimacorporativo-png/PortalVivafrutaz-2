/**
 * STEP 9.3F.12 — Camada de Entrega (Email / WhatsApp / etc.)
 * STEP 9.3F.13 — Integração: Roteamento (F.10) + Preferências (F.11) + Canais (F.12).
 * STEP 9.3F.14 — Canal EMAIL real, reusando exclusivamente `mailer.ts`.
 *                WhatsApp permanece mock até step próprio.
 *
 * REGRAS ABSOLUTAS:
 *   - NUNCA modifica `emitAlert` (apenas é invocado por ele de forma plugada).
 *   - NUNCA modifica `emitAlertSmart`.
 *   - NUNCA modifica `persistAlertLog`.
 *   - NUNCA altera o `results` que o emitAlert retorna / persiste.
 *   - NUNCA cria tabela nova nem endpoint paralelo.
 *   - NUNCA usa nodemailer direto, nunca cria transporter, nunca duplica mailer.
 *   - Falha desta camada NUNCA pode quebrar o fluxo principal de alertas.
 *
 * F.14 — Envio real:
 *   - Usa `sendMail(to, subject, html)` de `./mailer` (1:1 por usuário).
 *   - Sem broadcast, sem agrupamento, sem nova função de envio.
 *   - SMTP não configurado → success:false, reason:"SMTP_NOT_CONFIGURED".
 *   - Erro de envio       → success:false, reason normalizado.
 *
 * Failure modes:
 *   - Falha de DB → log + retorna `[]` (sem entrega), NUNCA propaga.
 *   - Sem `recipientsRoles` ou lista vazia → retorna `[]`.
 *   - Sem usuários encontrados → retorna `[]`.
 *   - Usuário sem email → pula silenciosamente (não vira result de email).
 */

import { inArray } from "drizzle-orm";
import { db } from "../database/db";
import { users, type UserNotificationPreference } from "@shared/schema";
import {
  getUserPreferences,
  isSeverityAllowed,
} from "./alerts.preferences";
import { sendMail, isMailerConfigured } from "./mailer";

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
  /** Motivo opcional quando success=false. Aditivo, não-obrigatório. */
  reason?: string;
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

/** STEP 9.3F.13 — Fase 2: usuários cujo role bate com `roles`.
 *  STEP 9.3F.14 — Inclui `email` no retorno para envio 1:1. */
async function getUsersByRoles(roles: string[]): Promise<
  Array<{ id: number; role: string; email: string | null }>
> {
  if (roles.length === 0) return [];
  try {
    const rows = await db
      .select({
        id: users.id,
        role: users.role,
        active: users.active,
        email: users.email,
      })
      .from(users)
      .where(inArray(users.role, roles));
    // Apenas usuários ativos podem receber.
    return rows
      .filter((u) => u.active)
      .map((u) => ({ id: u.id, role: u.role, email: u.email ?? null }));
  } catch (err) {
    console.error("[ALERT_DELIVERY_USERS_QUERY_ERROR]", err);
    return [];
  }
}

// ── Helpers de envio (canal email) ──────────────────────────────────────────

/** Escapa HTML básico para impedir injeção em title/message. */
function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Monta corpo HTML simples para o alerta. Não usa template privado do mailer. */
function buildAlertHtml(input: DeliverAlertInput): string {
  const sev = escapeHtml(input.severity || "INFO");
  const title = escapeHtml(input.title || "Alerta");
  const message = escapeHtml(input.message || "").replace(/\n/g, "<br>");
  return `
<div style="font-family:Arial,sans-serif;color:#111;line-height:1.55">
  <p style="margin:0 0 8px;font-size:12px;color:#6b7280;letter-spacing:.5px;">VIVAFRUTAZ — ALERTA · ${sev}</p>
  <h2 style="margin:0 0 12px;font-size:18px;color:#111">${title}</h2>
  <p style="margin:0;color:#374151;font-size:14px">${message}</p>
</div>`.trim();
}

/** Normaliza o `reason` retornado pelo mailer para o formato do contrato. */
function normalizeMailerReason(reason: string | undefined): string {
  if (!reason) return "EMAIL_SEND_FAILED";
  if (reason === "SMTP não configurado") return "SMTP_NOT_CONFIGURED";
  return reason;
}

/**
 * STEP 9.3F.14 — Envio real via mailer existente. 1:1 por usuário.
 * Sempre captura exceções: o canal email NUNCA pode quebrar deliverAlert.
 */
async function deliverEmailToUser(
  userId: number,
  toEmail: string,
  input: DeliverAlertInput,
): Promise<DeliveryResult> {
  // Gating leve: short-circuit quando cache do mailer já indica não-configurado.
  // (Se o cache estiver frio, sendMail() abaixo faz a checagem definitiva.)
  if (!isMailerConfigured()) {
    // Não devolve imediatamente: ainda pode estar configurado e cache frio.
    // sendMail() trata o caso e retorna {sent:false, reason:"SMTP não configurado"}.
  }
  try {
    const subject = input.title || "Alerta VivaFrutaz";
    const html = buildAlertHtml(input);
    const r = await sendMail(toEmail, subject, html);
    if (r.sent) {
      return { channel: "email", success: true, userId };
    }
    return {
      channel: "email",
      success: false,
      userId,
      reason: normalizeMailerReason(r.reason),
    };
  } catch (err: any) {
    console.error("[ALERT_DELIVERY_EMAIL_ERROR]", { userId, err: err?.message });
    return {
      channel: "email",
      success: false,
      userId,
      reason: "EMAIL_SEND_EXCEPTION",
    };
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
  const filtered: Array<{ id: number; role: string; email: string | null }> = [];
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

  // Fase 5 — montar results por usuário.
  //   - email   : envio REAL via mailer.ts (1:1, sequencial, com gating).
  //   - whatsapp: ainda mock (fora do escopo desta etapa).
  const results: DeliveryResult[] = [];
  let emailsSkippedNoAddress = 0;
  for (const u of filtered) {
    if (u.email && u.email.trim()) {
      // 1:1: uma chamada a sendMail por usuário, awaitada.
      const r = await deliverEmailToUser(u.id, u.email.trim(), input);
      results.push(r);
    } else {
      // Sem email cadastrado → não emite result de email (não é falha real
      // de entrega; é falta de canal). WhatsApp mock segue abaixo.
      emailsSkippedNoAddress += 1;
    }
    results.push({ channel: "whatsapp", success: true, userId: u.id });
  }

  // Fase 6 — log informativo (NÃO altera persistência existente).
  try {
    const emailSent = results.filter(
      (r) => r.channel === "email" && r.success,
    ).length;
    const emailFailed = results.filter(
      (r) => r.channel === "email" && !r.success,
    ).length;
    console.log("[ALERT_DELIVERY]", {
      title: input.title,
      severity: input.severity,
      category: alertCategory,
      recipientsRoles,
      candidates: candidates.length,
      resolvedUsers: filtered.length,
      emailSent,
      emailFailed,
      emailsSkippedNoAddress,
      results,
    });
  } catch {
    /* no-op */
  }

  return results;
}
