/**
 * STEP 9.3F.1 — Serviço unificado de alertas operacionais.
 * STEP 9.3F.2 — Hardening: validação real de SMTP, mensagem estruturada,
 * logs explícitos, batch de email, placeholder organizado de WhatsApp.
 *
 * Fachada `emitAlert(...)` que dispara o mesmo evento por múltiplos canais:
 *   - email   → reaproveita server/services/mailer.ts (SMTP existente)
 *   - slack   → POST no incoming webhook
 *   - whatsapp → preparado, ainda não envia (apenas log [WHATSAPP_NOT_IMPLEMENTED])
 *
 * Destinatários ficam em `system_settings` (key `cron_alerts.recipients`),
 * em JSON. Sem nova tabela, sem migração.
 *
 * REGRAS:
 *   - NUNCA derruba o cron por falha de envio (try/catch por canal).
 *   - Rate-limit em memória: 10 min entre envios da mesma chave (severity).
 *   - Não toca em mailer.ts, guard, engine ou no core do cron.
 */

import { z } from "zod";
import { storage } from "./storage";
import { sendAdminBroadcast, mailerStatus } from "./mailer";
import { recordAlertLog, persistAlertLog } from "../modules/nfe/alerts-log.store";

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

/** STEP 9.3F.2 — verifica se há SMTP utilizável antes de tentar enviar. */
function isSmtpReady(): boolean {
  try {
    const s = mailerStatus();
    return Boolean(s.configured && s.smtp && s.from);
  } catch {
    return false;
  }
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

// ── Formatação ───────────────────────────────────────────────────────────────

/** STEP 9.3F.2 — corpo de email em texto estruturado e legível. */
function formatEmailMessage(args: {
  severity: AlertSeverity;
  title: string;
  message: string;
  context?: Record<string, unknown>;
}): string {
  const ctx = (args.context ?? {}) as Record<string, unknown>;
  const total = (ctx.total ?? "—") as string | number;
  const success = (ctx.success ?? "—") as string | number;
  const blocked = (ctx.blocked ?? "—") as string | number;
  const errors = (ctx.errors ?? "—") as string | number;
  const triggeredBy = (ctx.triggeredBy ?? "—") as string;
  const now = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

  return [
    `🚨 ALERTA DE FATURAMENTO (${args.severity})`,
    "",
    args.title,
    "",
    args.message,
    "",
    "-----------------------------",
    "DETALHES:",
    `Total:       ${total}`,
    `Sucesso:     ${success}`,
    `Bloqueados:  ${blocked}`,
    `Erros:       ${errors}`,
    `Disparo:     ${triggeredBy}`,
    "",
    `Data:    ${now}`,
    `Sistema: VivaFrutaz ERP`,
    "-----------------------------",
  ].join("\n");
}

// ── Envio por canal ──────────────────────────────────────────────────────────

type ChannelResult = { ok: boolean; reason?: string };

/** STEP 9.3F.2 — envio em batch. Um único broadcast com BCC para todos. */
async function sendEmailBatch(
  emails: string[],
  severity: AlertSeverity,
  title: string,
  message: string,
  context?: Record<string, unknown>,
): Promise<ChannelResult> {
  if (emails.length === 0) {
    return { ok: false, reason: "lista vazia" };
  }
  if (!isSmtpReady()) {
    console.warn("[ALERT_SMTP_NOT_CONFIGURED]", { severity, recipients: emails.length });
    return { ok: false, reason: "SMTP não configurado" };
  }
  const subjectTag = severity === "CRITICAL" ? "[CRON CRITICAL]" : "[CRON ALERT]";
  const body = formatEmailMessage({ severity, title, message, context });
  try {
    const out = await sendAdminBroadcast({
      toEmails: emails,
      subject: `${subjectTag} ${title}`,
      message: body,
      senderName: "Cron de Faturamento",
    });
    if (!out.sent) {
      return { ok: false, reason: out.reason || "envio recusado" };
    }
    console.log("[ALERT_EMAIL_SENT]", {
      severity,
      totalRecipients: emails.length,
    });
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
): Promise<ChannelResult> {
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

/** STEP 9.3F.2 — placeholder organizado. Implementação real fica para 9.3F.3+. */
async function sendWhatsAppAlert(
  target: string,
  severity: AlertSeverity,
  title: string,
): Promise<ChannelResult> {
  console.warn("[WHATSAPP_NOT_IMPLEMENTED]", { target, severity, title });
  return { ok: false, reason: "WhatsApp ainda não implementado" };
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
    // STEP 9.3F.3 — registra mesmo quando bloqueado por rate-limit.
    const rateLimitedEntry = {
      at: Date.now(),
      severity: input.severity,
      title: input.title,
      message: input.message,
      results: [],
      rateLimited: true,
    };
    recordAlertLog(rateLimitedEntry);
    // STEP 9.3F.4 — persistência durável (fire-and-forget seguro).
    void persistAlertLog(rateLimitedEntry);
    return { rateLimited: true, attempted: 0, delivered: 0, results: [] };
  }

  const all = await getAlertRecipients();
  const recipients = all.filter((r) => r.enabled);
  if (recipients.length === 0) {
    console.warn("[ALERT_NO_RECIPIENTS]", { severity: input.severity, totalConfigured: all.length });
    return { rateLimited: false, attempted: 0, delivered: 0, results: [] };
  }

  // STEP 9.3F.2 — agrupar emails para um único broadcast (anti-spam SMTP).
  const emails = recipients.filter((r) => r.channel === "email").map((r) => r.target);
  const slacks = recipients.filter((r) => r.channel === "slack");
  const whatsapps = recipients.filter((r) => r.channel === "whatsapp");

  const results: Array<{ channel: AlertChannel; target: string; ok: boolean; reason?: string }> = [];

  // Email em batch
  if (emails.length > 0) {
    const out = await sendEmailBatch(
      emails,
      input.severity,
      input.title,
      input.message,
      input.context,
    );
    for (const target of emails) {
      results.push({ channel: "email", target, ok: out.ok, reason: out.reason });
    }
  }

  // Slack (1 POST por destinatário — webhooks são por canal)
  await Promise.all(
    slacks.map(async (r) => {
      try {
        const out = await sendSlack(r.target, input.severity, input.title, input.message, input.context);
        results.push({ channel: "slack", target: r.target, ok: out.ok, reason: out.reason });
      } catch (err: any) {
        results.push({ channel: "slack", target: r.target, ok: false, reason: err?.message || "exceção" });
      }
    }),
  );

  // WhatsApp — apenas placeholder por enquanto
  for (const r of whatsapps) {
    const out = await sendWhatsAppAlert(r.target, input.severity, input.title);
    results.push({ channel: "whatsapp", target: r.target, ok: out.ok, reason: out.reason });
  }

  const delivered = results.filter((r) => r.ok).length;
  if (delivered > 0) markSent(key);

  console.log("[ALERT_SENT]", {
    severity: input.severity,
    title: input.title,
    attempted: results.length,
    delivered,
    byChannel: {
      email: emails.length,
      slack: slacks.length,
      whatsapp: whatsapps.length,
    },
  });

  // STEP 9.3F.3 — registra a execução completa para o dashboard de auditoria.
  const sentEntry = {
    at: Date.now(),
    severity: input.severity,
    title: input.title,
    message: input.message,
    results: results.map((r) => ({
      channel: r.channel,
      target: r.target,
      ok: r.ok,
      reason: r.reason,
    })),
    rateLimited: false,
  };
  recordAlertLog(sentEntry);
  // STEP 9.3F.4 — persistência durável (fire-and-forget seguro).
  void persistAlertLog(sentEntry);

  return {
    rateLimited: false,
    attempted: results.length,
    delivered,
    results,
  };
}
