import type { Express } from "express";
import type { IStorage } from "../services/storage.ts";
import { storage } from "../services/storage.ts";
import { fireNotification, VAPID_PUBLIC_KEY } from "../services/pushService";
import {
  requireAuth as requireAuthCore,
  requireRole,
  requireSession,
} from "../core/http/requireAuth";
import { z } from "zod";

const PUSH_ADMIN_ROLES = ["MASTER", "ADMIN", "DIRECTOR", "DEVELOPER"] as const;
const PUSH_SETTING_EVENTS = new Set([
  "order_created",
  "order_cancelled",
  "order_updated",
  "client_inactive",
  "low_stock",
  "clara_task",
  "clara_alert",
]);

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().min(1).max(512),
    auth: z.string().min(1).max(512),
  }).strict(),
}).strict();

const unsubscribeSchema = z.object({
  endpoint: z.string().url().max(2048),
}).strict();

const settingPatchSchema = z.object({
  enabled: z.boolean(),
}).strict();

const emptyTestBodySchema = z.object({}).strict();

type PushAdminUser = {
  role?: string | null;
  empresaId?: number | null;
};

export type PushRouteDependencies = {
  storage: Pick<
    IStorage,
    | "getUser"
    | "upsertPushSubscriptionOwned"
    | "deactivatePushSubscriptionOwned"
    | "getNotificationSettings"
    | "getPushSubscriptionCount"
    | "upsertNotificationSetting"
  >;
  fireNotification: typeof fireNotification;
};

const defaultDependencies: PushRouteDependencies = {
  storage,
  fireNotification,
};

/**
 * Notification settings are a global table (there is no companyId column).
 * Only unbound administrative accounts may therefore access this surface.
 * A tenant-bound administrator must not be treated as global by role alone.
 */
export function canManageGlobalPush(user: PushAdminUser | undefined): boolean {
  return Boolean(
    user &&
    user.empresaId == null &&
    typeof user.role === "string" &&
    PUSH_ADMIN_ROLES.includes(user.role as (typeof PUSH_ADMIN_ROLES)[number]),
  );
}

async function resolveSubscriptionOwner(
  req: any,
  pushStorage: PushRouteDependencies["storage"],
): Promise<{ userId: number | null; companyId: number } | null> {
  const session = req.session;

  if (typeof session?.userId === "number") {
    const user = await pushStorage.getUser(session.userId);
    if (!user?.empresaId) return null;
    return { userId: session.userId, companyId: user.empresaId };
  }

  if (typeof session?.companyId === "number" && session.companyId > 0) {
    return { userId: null, companyId: session.companyId };
  }

  return null;
}

function parsedBody<T>(
  schema: z.ZodType<T>,
  body: unknown,
): { value: T } | { error: string } {
  const result = schema.safeParse(body);
  return result.success
    ? { value: result.data }
    : { error: "Dados de Push inválidos" };
}

export async function register(
  app: Express,
  dependencies: PushRouteDependencies = defaultDependencies,
): Promise<void> {
  app.get('/api/push/vapid-public-key', (_req, res) => {
    res.json({ publicKey: VAPID_PUBLIC_KEY });
  });

  // A subscription belongs to the authenticated user or company session.
  app.post('/api/push/subscribe', requireSession, async (req: any, res) => {
    try {
      const parsed = parsedBody(subscriptionSchema, req.body);
      if ("error" in parsed) {
        return res.status(400).json({ message: parsed.error });
      }

      const owner = await resolveSubscriptionOwner(req, dependencies.storage);
      if (!owner) {
        return res.status(403).json({ message: "Empresa não resolvida para esta sessão" });
      }

      const sub = await dependencies.storage.upsertPushSubscriptionOwned({
        endpoint: parsed.value.endpoint,
        p256dh: parsed.value.keys.p256dh,
        auth: parsed.value.keys.auth,
        userAgent: req.headers['user-agent'] || null,
        userId: owner.userId,
        companyId: owner.companyId,
        active: true,
      });
      if (!sub) {
        return res.status(403).json({ message: "Subscription não pertence a esta sessão" });
      }
      res.json({ success: true, id: sub.id });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Deactivation is scoped to the same owner used during registration.
  app.post('/api/push/unsubscribe', requireSession, async (req: any, res) => {
    try {
      const parsed = parsedBody(unsubscribeSchema, req.body);
      if ("error" in parsed) {
        return res.status(400).json({ message: parsed.error });
      }
      const owner = await resolveSubscriptionOwner(req, dependencies.storage);
      if (!owner) {
        return res.status(403).json({ message: "Empresa não resolvida para esta sessão" });
      }
      const deactivated = await dependencies.storage.deactivatePushSubscriptionOwned(
        parsed.value.endpoint,
        owner,
      );
      if (!deactivated) {
        return res.status(403).json({ message: "Subscription não pertence a esta sessão" });
      }
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Global settings: role and lack of tenant are both required.
  app.get(
    '/api/push/settings',
    requireAuthCore,
    requireRole([...PUSH_ADMIN_ROLES], { strict: true }),
    async (req: any, res) => {
    try {
      const user = await dependencies.storage.getUser(req.session.userId);
      if (!canManageGlobalPush(user)) {
        return res.status(403).json({ message: 'Sem permissão para configurações globais' });
      }
      const settings = await dependencies.storage.getNotificationSettings();
      const count = await dependencies.storage.getPushSubscriptionCount();
      res.json({ settings, subscriberCount: count });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
    },
  );

  app.patch(
    '/api/push/settings/:event',
    requireAuthCore,
    requireRole([...PUSH_ADMIN_ROLES], { strict: true }),
    async (req: any, res) => {
    try {
      const user = await dependencies.storage.getUser(req.session.userId);
      if (!canManageGlobalPush(user)) {
        return res.status(403).json({ message: 'Sem permissão para configurações globais' });
      }
      if (!PUSH_SETTING_EVENTS.has(req.params.event)) {
        return res.status(400).json({ message: "Evento de Push inválido" });
      }
      const parsed = parsedBody(settingPatchSchema, req.body);
      if ("error" in parsed) {
        return res.status(400).json({ message: parsed.error });
      }
      const setting = await dependencies.storage.upsertNotificationSetting(
        req.params.event,
        parsed.value,
      );
      res.json(setting);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
    },
  );

  // Fixed-payload global test. The route remains a real operational action;
  // tests inject fireNotification so no notification is sent during testing.
  app.post(
    '/api/push/test',
    requireAuthCore,
    requireRole([...PUSH_ADMIN_ROLES], { strict: true }),
    async (req: any, res) => {
    try {
      const user = await dependencies.storage.getUser(req.session.userId);
      if (!canManageGlobalPush(user)) {
        return res.status(403).json({ message: 'Sem permissão para teste global' });
      }
      const parsed = parsedBody(emptyTestBodySchema, req.body);
      if ("error" in parsed) {
        return res.status(400).json({ message: "O teste de Push não aceita dados personalizados" });
      }
      await dependencies.fireNotification('clara_alert', {
        message: '✅ Notificações push funcionando corretamente no VivaFrutaz!',
      }, { url: '/admin' });
      res.json({ success: true, message: 'Notificação de teste enviada!' });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
    },
  );
}
