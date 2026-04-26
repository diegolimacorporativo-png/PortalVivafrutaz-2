import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { storage } from "../../services/storage";

const BYPASS_ROLES = new Set([
  "MASTER",
  "ADMIN",
  "DIRECTOR",
  "DEVELOPER",
  "GESTOR_CONTRATOS",
  "FINANCEIRO",
]);

const INACTIVE_STATUSES = new Set([
  "cancelada",
  "suspensa",
  "inadimplente",
]);

export type LimitTipo = "pedidos" | "usuarios" | "motoristas" | "rotas";

async function resolveCompanyId(req: any): Promise<{ companyId: number | null; bypass: boolean }> {
  if (req.session?.companyId) {
    return { companyId: Number(req.session.companyId), bypass: false };
  }
  if (req.session?.userId) {
    const actor = await storage.getUser(req.session.userId);
    if (!actor) return { companyId: null, bypass: false };
    if (BYPASS_ROLES.has(actor.role)) return { companyId: null, bypass: true };
    const cid = (actor as any).companyId;
    return { companyId: cid ? Number(cid) : null, bypass: false };
  }
  return { companyId: null, bypass: false };
}

export async function requireActiveSubscription(
  req: any,
  res: Response,
  next: NextFunction,
) {
  try {
    const { companyId, bypass } = await resolveCompanyId(req);
    if (bypass) return next();
    if (!companyId) {
      return res.status(401).json({ error: "Não autenticado" });
    }
    const assinatura = await storage.getAssinaturaByCompany(companyId);
    if (!assinatura) {
      return res.status(403).json({ error: "Empresa sem assinatura" });
    }
    if (INACTIVE_STATUSES.has(assinatura.status)) {
      return res.status(403).json({
        error: "Assinatura inativa",
        status: assinatura.status,
      });
    }
    (req as any).assinatura = assinatura;
    next();
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function computeUsageAndLimits(companyId: number) {
  const [allAssinaturas, allPlanos, usuarios, pedidos, motoristas, rotas] =
    await Promise.all([
      storage.getAssinaturas(),
      storage.getPlanos(),
      storage.getUsers(),
      storage.getOrders(),
      storage.getDrivers(),
      storage.getRoutes(),
    ]);

  const assinatura = allAssinaturas.find((a) => a.companyId === companyId);
  const plano = assinatura?.planoId
    ? allPlanos.find((p) => p.id === assinatura.planoId)
    : null;

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const uso = {
    usuarios: usuarios.filter((u: any) => u.companyId === companyId).length,
    pedidosMes: pedidos.filter(
      (p: any) =>
        p.companyId === companyId && new Date(p.createdAt) >= startOfMonth,
    ).length,
    motoristas: motoristas.filter((m: any) => m.companyId === companyId).length,
    rotas: rotas.filter((r: any) => r.companyId === companyId).length,
  };

  const limites = {
    usuarios: plano?.limiteUsuarios ?? 999,
    pedidos: plano?.limitePedidosMes ?? plano?.limitePedidos ?? 999,
    motoristas: plano?.limiteMotoristas ?? 999,
    rotas: plano?.limiteRotas ?? 999,
  };

  return { uso, limites, plano, assinatura };
}

export function checkPlanLimit(tipo: LimitTipo) {
  return async (req: any, res: Response, next: NextFunction) => {
    try {
      const { companyId, bypass } = await resolveCompanyId(req);
      if (bypass) return next();
      if (!companyId) return next();

      const { uso, limites } = await computeUsageAndLimits(companyId);

      const usedMap: Record<LimitTipo, number> = {
        pedidos: uso.pedidosMes,
        usuarios: uso.usuarios,
        motoristas: uso.motoristas,
        rotas: uso.rotas,
      };
      const limitMap: Record<LimitTipo, number> = {
        pedidos: limites.pedidos,
        usuarios: limites.usuarios,
        motoristas: limites.motoristas,
        rotas: limites.rotas,
      };

      const used = usedMap[tipo];
      const max = limitMap[tipo];

      if (typeof max === "number" && max > 0 && used >= max) {
        return res.status(403).json({
          error: `Limite de ${tipo} atingido`,
          uso: used,
          limite: max,
        });
      }
      next();
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };
}

const WEBHOOK_HEADERS = [
  "x-signature",
  "x-hub-signature-256",
  "stripe-signature",
];

function getSignatureHeader(req: any): string | null {
  for (const h of WEBHOOK_HEADERS) {
    const v = req.headers[h];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

function timingSafeEq(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export function validateWebhookSignature(
  req: any,
  res: Response,
  next: NextFunction,
) {
  const signature = getSignatureHeader(req);
  if (!signature) {
    return res.status(401).json({ error: "Assinatura inválida" });
  }

  const secret = process.env.BILLING_WEBHOOK_SECRET;
  if (!secret) {
    return res.status(503).json({
      error:
        "Webhook secret não configurado (defina BILLING_WEBHOOK_SECRET)",
    });
  }

  const rawBody: Buffer | undefined = (req as any).rawBody;
  if (!rawBody || !Buffer.isBuffer(rawBody)) {
    return res.status(400).json({ error: "Corpo da requisição inválido" });
  }

  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  const provided = signature.replace(/^sha256=/, "").trim();

  if (!timingSafeEq(expected, provided)) {
    return res.status(401).json({ error: "Assinatura inválida" });
  }

  next();
}

export async function checkWebhookIdempotency(
  req: any,
  res: Response,
  next: NextFunction,
) {
  try {
    const eventId =
      req.body?.gatewayEventId || req.body?.eventId || req.body?.id;
    if (!eventId) return next();
    const existing = await storage.getBillingEventByGatewayId(String(eventId));
    if (existing) {
      return res.status(200).json({ received: true, deduplicated: true });
    }
    next();
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}
