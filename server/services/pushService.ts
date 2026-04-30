import webpush from "web-push";
import { db } from "../database/db";
import { pushSubscriptions, notificationSettings } from "@shared/schema";
import { eq, and } from "drizzle-orm";

export const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";

const PUSH_ENABLED = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);

if (PUSH_ENABLED) {
  webpush.setVapidDetails(
    "mailto:admin@vivafrutaz.com",
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );
} else {
  console.warn(
    "[PUSH] VAPID keys not configured. Push notifications are disabled."
  );
}

// Default notification event configurations
export const DEFAULT_NOTIFICATION_SETTINGS = [
  {
    event: "order_created",
    enabled: true,
    title: "🛒 Novo pedido recebido",
    body: "Empresa: {company} | Itens: {items} | Valor: R$ {value}",
    targetAudience: "staff",
  },
  {
    event: "order_cancelled",
    enabled: true,
    title: "❌ Pedido cancelado",
    body: "Pedido {code} da empresa {company} foi cancelado.",
    targetAudience: "staff",
  },
  {
    event: "order_updated",
    enabled: true,
    title: "📝 Pedido atualizado",
    body: "Pedido {code} foi atualizado para status: {status}",
    targetAudience: "staff",
  },
  {
    event: "client_inactive",
    enabled: true,
    title: "⚠️ Cliente inativo",
    body: "{company} está sem pedidos há {days} dias.",
    targetAudience: "staff",
  },
  {
    event: "low_stock",
    enabled: true,
    title: "📦 Estoque baixo",
    body: "{product} está com estoque crítico: {quantity} unidades.",
    targetAudience: "staff",
  },
  {
    event: "clara_task",
    enabled: true,
    title: "🌿 Clara criou uma tarefa",
    body: "{task}",
    targetAudience: "staff",
  },
  {
    event: "clara_alert",
    enabled: true,
    title: "🤖 Alerta da Clara IA",
    body: "{message}",
    targetAudience: "staff",
  },
];

// Ensure default settings exist in DB
export async function ensureDefaultNotificationSettings() {
  try {
    for (const setting of DEFAULT_NOTIFICATION_SETTINGS) {
      const existing = await db
        .select()
        .from(notificationSettings)
        .where(eq(notificationSettings.event, setting.event))
        .limit(1);
      if (existing.length === 0) {
        await db.insert(notificationSettings).values(setting);
      }
    }
  } catch (err) {
    console.error("[PUSH] Failed to seed notification settings:", err);
  }
}

// Get notification setting by event
async function getNotifSetting(event: string) {
  try {
    const rows = await db
      .select()
      .from(notificationSettings)
      .where(eq(notificationSettings.event, event))
      .limit(1);
    return rows[0] || null;
  } catch {
    return null;
  }
}

// Get all active subscriptions
async function getActiveSubscriptions(audience: "staff" | "all" | "company", companyId?: number) {
  try {
    if (audience === "company" && companyId) {
      return db
        .select()
        .from(pushSubscriptions)
        .where(and(eq(pushSubscriptions.active, true), eq(pushSubscriptions.companyId, companyId)));
    }
    if (audience === "staff") {
      // FASE 8.6N — staff isolado por tenant: companyId obrigatório
      if (!companyId) {
        console.warn("[PUSH] staff audience sem companyId — bloqueado por segurança");
        return [];
      }
      return db
        .select()
        .from(pushSubscriptions)
        .where(
          and(
            eq(pushSubscriptions.active, true),
            eq(pushSubscriptions.companyId, companyId)
          )
        );
    }
    return db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.active, true));
  } catch {
    return [];
  }
}

// Send a push notification to a single subscription
async function sendPushToSubscription(
  sub: { endpoint: string; p256dh: string; auth: string },
  payload: { title: string; body: string; url?: string; icon?: string }
) {
  try {
    await webpush.sendNotification(
      {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      },
      JSON.stringify({
        title: payload.title,
        body: payload.body,
        url: payload.url || "/",
        icon: "/icon-192.png",
        badge: "/icon-96.png",
      }),
      { TTL: 3600 }
    );
  } catch (err: any) {
    if (err?.statusCode === 410 || err?.statusCode === 404) {
      // Subscription expired — deactivate it
      try {
        await db
          .update(pushSubscriptions)
          .set({ active: false })
          .where(eq(pushSubscriptions.endpoint, sub.endpoint));
      } catch {}
    }
  }
}

// Send a push notification directly to a specific company's subscriptions (client-side push)
export async function sendClientPush(
  companyId: number,
  payload: { title: string; body: string; url?: string }
) {
  try {
    const subs = await getActiveSubscriptions("company", companyId);
    for (const sub of subs) {
      sendPushToSubscription(sub, payload);
    }
  } catch (err) {
    console.error(`[PUSH] Error sending client push to company ${companyId}:`, err);
  }
}

// Main: fire a push event to all relevant subscribers
export async function fireNotification(
  event: string,
  variables: Record<string, string> = {},
  options: { url?: string; companyId?: number } = {}
) {
  try {
    const setting = await getNotifSetting(event);
    if (!setting || !setting.enabled) return;

    // Replace template variables
    let title = setting.title;
    let body = setting.body;
    for (const [key, val] of Object.entries(variables)) {
      title = title.replace(new RegExp(`\\{${key}\\}`, "g"), val);
      body = body.replace(new RegExp(`\\{${key}\\}`, "g"), val);
    }

    const subs = await getActiveSubscriptions(setting.targetAudience as any, options.companyId);
    for (const sub of subs) {
      sendPushToSubscription(sub, { title, body, url: options.url });
    }
  } catch (err) {
    console.error(`[PUSH] Error firing event ${event}:`, err);
  }
}
