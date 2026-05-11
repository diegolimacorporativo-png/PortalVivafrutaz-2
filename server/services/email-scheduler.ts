/**
 * email-scheduler.ts
 * Runs every minute to dispatch automated emails and push notifications based on clientType.
 *
 * Rules by clientType:
 *   semanal    → window_open_reminder (email + push) + unfinalised_reminder (email + push, weekly)
 *   mensal     → window_open_reminder (email + push) + unfinalised_reminder (email + push, once per month)
 *   pontual    → no reminders; order-confirmation emails only (handled in routes.ts)
 *   contratual → no reminders at all
 */

import { storage } from "./storage";
import { logSecurity } from "../core/security/securityLogger";
import {
  sendWindowOpenReminder,
  sendUnfinalisedReminder,
} from "./mailer";
import { sendClientPush } from "./pushService";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import * as cron from "node-cron";
import { registerJob, startJobRun, finishJobRun } from "../core/jobs/job-registry";
import { incJobFailures } from "../core/observability/metrics";

const EMAIL_JOB = "email-scheduler";
registerJob(EMAIL_JOB);

const sentWindowReminders = new Set<number>();

function fmtDate(d: Date | string | null | undefined) {
  if (!d) return "—";
  try { return format(new Date(d as string), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR }); }
  catch { return String(d); }
}

/** Returns true if the clientType should receive order-window reminder emails/push. */
function receivesWindowReminder(clientType: string | null | undefined): boolean {
  const ct = clientType || 'mensal';
  return ct === 'semanal' || ct === 'mensal';
}

/** Returns true if the clientType should receive unfinalised-order reminder emails/push. */
function receivesUnfinalisedReminder(clientType: string | null | undefined): boolean {
  const ct = clientType || 'mensal';
  return ct === 'semanal' || ct === 'mensal';
}

/** For mensal clients, unfinalised reminders should only fire once per calendar month. */
function requiresMonthlyThrottle(clientType: string | null | undefined): boolean {
  return (clientType || 'mensal') === 'mensal';
}

async function runSchedulerTick() {
  // FASE 3.1 — anti-overlap guard: skip if previous tick still running
  if (!startJobRun(EMAIL_JOB)) {
    console.warn("[EMAIL-SCHEDULER] Tick skipped — previous run still in progress");
    return;
  }
  try {
    const now = new Date();
    const currentDow = now.getDay();
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    // ── 1. Get active order window ─────────────────────────────────────────
    const activeWindow = await storage.getActiveOrderWindow();

    // ── 2. Window-Open Reminder ────────────────────────────────────────────
    if (activeWindow && !sentWindowReminders.has(activeWindow.id)) {
      sentWindowReminders.add(activeWindow.id);

      const allUsers = await storage.getUsers();
      const clientUsers = allUsers.filter(u => u.role === 'CLIENT' && u.email && u.active);

      for (const user of clientUsers) {
        if (!user.email) continue;

        const company = (user as any).companyId ? await storage.getCompany((user as any).companyId) : null;
        const clientType = company?.clientType || 'mensal';

        // Skip contratual and pontual — they do not receive window reminders
        if (!receivesWindowReminder(clientType)) {
          console.log(`[EMAIL-SCHEDULER] Skipping window_open_reminder for ${user.email} (clientType: ${clientType})`);
          continue;
        }

        const alreadySent = await storage.wasEmailSentToday('window_open_reminder', user.email);
        if (alreadySent) continue;

        const companyName = company?.companyName || user.email;

        const result = await sendWindowOpenReminder({
          toEmail: user.email,
          companyName,
          weekReference: activeWindow.weekReference,
          orderCloseDate: fmtDate(activeWindow.orderCloseDate),
          deliveryDate: fmtDate(activeWindow.deliveryStartDate),
        });

        await storage.createEmailLog({
          type: 'window_open_reminder',
          toEmail: user.email,
          toName: companyName,
          companyId: (user as any).companyId || null,
          orderId: null,
          subject: `Janela de pedidos aberta — ${activeWindow.weekReference}`,
          status: result.sent ? 'sent' : 'failed',
          errorMessage: result.sent ? null : (result.reason || null),
          metadata: { windowId: activeWindow.id, weekReference: activeWindow.weekReference, clientType },
        });

        // Push notification for clients (semanal/mensal only)
        if (result.sent && (user as any).companyId) {
          await sendClientPush((user as any).companyId, {
            title: "🛒 Janela de pedidos aberta",
            body: `${companyName} — ${activeWindow.weekReference}. Envie seu pedido!`,
            url: "/create-order",
          });
        }
      }
    }

    // ── 3. Unfinalised Order Reminders ─────────────────────────────────────
    const schedules = await storage.getEmailSchedules();
    const unfinalisedSchedules = schedules.filter(s =>
      s.enabled &&
      s.type === 'unfinalised_reminder' &&
      s.timeOfDay === currentTime &&
      (s.dayOfWeek === null || s.dayOfWeek === currentDow)
    );

    if (activeWindow && unfinalisedSchedules.length > 0) {
      const allUsers = await storage.getUsers();
      const clientUsers = allUsers.filter(u => u.role === 'CLIENT' && u.email && u.active);

      for (const user of clientUsers) {
        if (!user.email || !(user as any).companyId) continue;

        const company = await storage.getCompany((user as any).companyId);
        const clientType = company?.clientType || 'mensal';

        // Skip contratual and pontual
        if (!receivesUnfinalisedReminder(clientType)) {
          console.log(`[EMAIL-SCHEDULER] Skipping unfinalised_reminder for ${user.email} (clientType: ${clientType})`);
          continue;
        }

        // Mensal clients: only send once per calendar month
        if (requiresMonthlyThrottle(clientType)) {
          const alreadySentThisMonth = await storage.wasEmailSentThisMonth('unfinalised_reminder', user.email);
          if (alreadySentThisMonth) continue;
        } else {
          // Semanal clients: only send once per day
          const alreadySentToday = await storage.wasEmailSentToday('unfinalised_reminder', user.email);
          if (alreadySentToday) continue;
        }

        const companyOrders = await storage.getOrdersByCompanyId((user as any).companyId);
        const hasActiveOrder = companyOrders.some(o =>
          ['CONFIRMED', 'ACTIVE', 'OPEN_FOR_EDITING'].includes(o.status) &&
          o.weekReference === activeWindow.weekReference
        );

        if (hasActiveOrder) continue;

        const companyName = company?.companyName || user.email;

        const result = await sendUnfinalisedReminder({
          toEmail: user.email,
          companyName,
          weekReference: activeWindow.weekReference,
          orderCloseDate: fmtDate(activeWindow.orderCloseDate),
        });

        await storage.createEmailLog({
          type: 'unfinalised_reminder',
          toEmail: user.email,
          toName: companyName,
          companyId: (user as any).companyId,
          orderId: null,
          subject: `Lembrete: finalize seu pedido — ${activeWindow.weekReference}`,
          status: result.sent ? 'sent' : 'failed',
          errorMessage: result.sent ? null : (result.reason || null),
          metadata: { windowId: activeWindow.id, weekReference: activeWindow.weekReference, clientType },
        });

        // Push notification for unfinalised reminder
        if (result.sent && (user as any).companyId) {
          await sendClientPush((user as any).companyId, {
            title: clientType === 'mensal' ? "📅 Lembrete mensal de pedido" : "⏰ Lembrete semanal de pedido",
            body: `${companyName} — Finalize seu pedido antes do encerramento da janela.`,
            url: "/create-order",
          });
        }
      }
    }
  } catch (err: any) {
    logSecurity(`[EMAIL_SCHEDULER_TICK_FAILED] job=emailScheduler | error=${err?.message ?? "unknown"}`);
    console.error('[EMAIL-SCHEDULER] Error during tick:', err);
  }
}

export function startEmailScheduler() {
  console.log('[EMAIL-SCHEDULER] Iniciado. Verificação a cada minuto.');
  runSchedulerTick();
  // Run every minute
  cron.schedule('* * * * *', runSchedulerTick);
}
