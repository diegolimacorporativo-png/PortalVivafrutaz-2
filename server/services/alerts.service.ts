/**
 * STEP 9.3F.1 — Serviço unificado de alertas operacionais.
 *
 * Fachada `emitAlert(...)` que dispara o mesmo evento por múltiplos canais:
 *   - email   → reaproveita server/services/mailer.ts (SMTP existente)
 *   - slack   → POST no incoming webhook
 *   - whatsapp → ainda não implementado (apenas log [WHATSAPP_PENDING])
 *
 * Destinatários ficam em `system_settings` na key `cron_alerts.recipients`,
 * como JSON. Sem nova tabela, sem migração.
 *
 * REGRAS:
 *   - NUNCA derruba o cron por falha de envio (try/catch por canal).
 *   - Rate-limit em memória: 10 min entre envios da mesma chave (severity).
 *   - Não toca em mailer.ts, guard, engine ou no core do cron.
 */

import { z } from "zod";
import { storage } from "./storage";
import { sendAdminBroadcast, isMailerConfigured } from "./mailer";

const RECIPIENTS_KEY = "cron_alerts.recipients";
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutos

export const alertChannelSchema = z.enum(["email", "slack", "whatsapp"]);
export type AlertChannel = z.infer<typeof alertChannelSchema>;

export const alertRecipientSchema = z.object({
  channel: alertChannelSchema,
  target: z.string().trim().min(1, "Destino obrigatório"),
  enabled: z.boolean().default(true),
  label: z.string().trim().max(80).optional(),
});
export type AlertRecipient = z.infer<typeof alertRecipientSchema>;

export const alertRecipientsArraySchema = z.array(alertRecipientSchema).max(50);

export type AlertSeverity = "ALERT" | "CRITICAL";

export interface EmitAlertInput {
  severity: AlertSeverity;
  title: string;
  message: string;
  context?: Record<string, unknown>;
  /** Sobrescreve a chave usada no rate-limit. Default: `cron:${severity.toLowerCase()}`. */
  rateLimitKey?: string;
}

const lastSent = new Map<string, number>();

function isRateLimited(key: string): boolean {
  const last = lastSent.get(key);
  if (!last) return false;
  return Date.now() - last < RATE_LIMIT_WINDOW_MS;
}

function markSent(key: string): void {
  lastSent.set(key, Date.now());
}

/** Lê os destinatários do system_settings. Tolerante a JSON inválido. */
export async function getAlertRecipients(): Promise<AlertRecipient[]> {
  try {
    const raw = await storage.getSetting(RECIPIENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const result = alertRecipientsArraySchema.safeParse(parsed);
    if (!result.success) {
      console.warn("[ALERT_RECIPIENTS_INVALID]", result.error.flatten());
      return [];
    }
    return result.data;
  } catch (err) {
    console.error("[ALERT_RECIPIENTS_READ_ERROR]", err);
    return [];
  }
}

/** Substitui a lista completa de destinatários (PUT). */
export async function setAlertRecipients(
  list: AlertRecipient[],
): Promise<AlertRecipient[]> {
  const validated = alertRecipientsArraySchema.parse(list);
  await storage.setSetting(RECIPIENTS_KEY, JSON.stringify(validated));
  return validated;
}

// ── Envio por canal ──────────────────────────────────────────────────────────

async function sendEmail(
  target: string,
  severity: AlertSeverity,
  title: string,
  message: string,
  context?: Record<string, unknown>,
): Promise<{ ok: boolean; reason?: string }> {
  if (!isMailerConfigured()) {
    return { ok: false, reason: "SMTP não configurado" };
  }
  const subjectTag = severity === "CRITICAL" ? "[CRON CRITICAL]" : "[CRON ALERT]";
  const ctxBlock = context ? `\n\n${JSON.stringify(context, null, 2)}` : "";
  const body = `${title}\n\n${message}${ctxBlock}\n\nAlerta automático do cron de faturamento — VivaFrutaz ERP.`;
  try {
    const out = await sendAdminBroadcast({
      toEmails: [target],
      subject: `${subjectTag} ${title}`,
      message: body,
      senderName: "Cron de Faturamento",
    });
    if (!out.sent) {
      return { ok: false, reason: out.reason || "envio recusado" };
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, reason: err?.message || "erro desconhecido" };
  }
}

async function sendSlack(
  webhookUrl: string,
  severity: AlertSeverity,
  title: string,
  message: string,
  context?: Record<string, unknown>,
): Promise<{ ok: boolean; reason?: string }> {
  const tag = severity === "CRITICAL" ? ":rotating_light: *CRON CRITICAL*" : ":warning: *CRON ALERT*";
  const ctxBlock = context
    ? "\n```" + JSON.stringify(context, null, 2) + "```"
    : "";
  const text = `${tag}\n*${title}*\n${message}${ctxBlock}`;
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      return { ok: false, reason: `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, reason: err?.message || "fetch falhou" };
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── Função pública ───────────────────────────────────────────────────────────

export async function emitAlert(input: EmitAlertInput): Promise<{
  rateLimited: boolean;
  attempted: number;
  delivered: number;
  results: Array<{ channel: AlertChannel; target: string; ok: boolean; reason?: string }>;
}> {
  const key = input.rateLimitKey ?? `cron:${input.severity.toLowerCase()}`;
  if (isRateLimited(key)) {
    console.warn("[ALERT_RATE_LIMIT]", { key, severity: input.severity });
    return { rateLimited: true, attempted: 0, delivered: 0, results: [] };
  }

  const recipients = (await getAlertRecipients()).filter((r) => r.enabled);
  if (recipients.length === 0) {
    return { rateLimited: false, attempted: 0, delivered: 0, results: [] };
  }

  const results: Array<{ channel: AlertChannel; target: string; ok: boolean; reason?: string }> = [];

  await Promise.all(
    recipients.map(async (r) => {
      try {
        if (r.channel === "email") {
          const out = await sendEmail(r.target, input.severity, input.title, input.message, input.context);
          results.push({ channel: r.channel, target: r.target, ok: out.ok, reason: out.reason });
        } else if (r.channel === "slack") {
          const out = await sendSlack(r.target, input.severity, input.title, input.message, input.context);
          results.push({ channel: r.channel, target: r.target, ok: out.ok, reason: out.reason });
        } else if (r.channel === "whatsapp") {
          console.log("[WHATSAPP_PENDING]", {
            target: r.target,
            severity: input.severity,
            title: input.title,
          });
          results.push({
            channel: r.channel,
            target: r.target,
            ok: false,
            reason: "WhatsApp ainda não implementado (STEP 9.3F.2)",
          });
        }
      } catch (err: any) {
        results.push({
          channel: r.channel,
          target: r.target,
          ok: false,
          reason: err?.message || "exceção no envio",
        });
      }
    }),
  );

  const delivered = results.filter((r) => r.ok).length;
  if (delivered > 0) markSent(key);

  console.log("[ALERT_SENT]", {
    severity: input.severity,
    title: input.title,
    attempted: results.length,
    delivered,
    targets: results.map((r) => ({ channel: r.channel, ok: r.ok })),
  });

  return {
    rateLimited: false,
    attempted: results.length,
    delivered,
    results,
  };
}
