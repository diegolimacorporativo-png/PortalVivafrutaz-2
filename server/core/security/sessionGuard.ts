/**
 * FASE 14.6 / 14.7 — Session Token Version Guard.
 * FASE 14.7.1 — Thin adapter: zero direct dependencies on storage or securityLogger.
 *
 * Validation logic is fully delegated to AuthCoreService:
 *   • validateSession()        → tokenVersion + deviceId enforcement
 *   • logSessionInvalidation() → unified logging pipeline + persistent audit log
 *
 * This file owns only Express plumbing: read session/headers, call AuthCore,
 * destroy session, and respond. Nothing else.
 *
 * Behaviour:
 *  • Only runs on /api/* (not Vite assets).
 *  • Skips /api/auth/* and /api/v1/auth/* — login/logout always reachable.
 *  • Skips unauthenticated sessions (no tokenVersion) — pass-through.
 *  • Pre-FASE-14.6 sessions (no tokenVersion field) — pass-through.
 *  • DB error → fail-closed (DB outage must not trust sessions).
 *  • Device binding: missing or mismatched X-Device-Id → SESSION_INVALIDATED.
 */

import type { Request, Response, NextFunction } from "express";
import { authCoreService, AUTH_EVENTS } from "../auth/authCore.service";

function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"] as string | undefined;
  return (forwarded ?? "").split(",")[0].trim() || req.socket?.remoteAddress || "unknown";
}

export async function sessionVersionGuard(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // Skip non-API paths (Vite assets, manifest, etc.)
  if (!req.path.startsWith("/api")) return next();
  // Skip auth routes — login / logout / force-password-change must always be reachable
  if (req.path.startsWith("/api/auth") || req.path.startsWith("/api/v1/auth")) return next();

  const session = (req as any).session as Record<string, any> | undefined;
  if (!session) return next();

  const userId: number | undefined = session.userId;
  const companyId: number | undefined = session.companyId;

  // Unauthenticated sessions (no userId, no companyId) must pass through freely.
  // They have no tokenVersion and that is expected — do NOT treat them as invalid.
  if (!userId && !companyId) return next();

  // Authenticated session missing tokenVersion → stale pre-FASE-14.6 session, reject.
  if (session.tokenVersion === undefined) {
    req.session.destroy(() => {});
    res.status(401).json({
      error: "SESSION_INVALIDATED",
      reason: "TOKEN_VERSION_MISMATCH",
      message: "Sua sessão foi encerrada por segurança. Faça login novamente.",
    });
    return;
  }

  const ip = getClientIp(req);
  const requestDeviceId = req.headers["x-device-id"] as string | undefined;

  // ETAPA 3 — log para confirmar estado da sessão em cada requisição autenticada
  // (restrito a development para evitar flood de logs em produção)
  if (process.env.NODE_ENV === "development") {
    console.debug("[SESSION_CHECK]", {
      userId,
      companyId,
      tokenVersion: session.tokenVersion,
      deviceId: session.deviceId,
      requestDeviceId,
      path: req.path,
    });
  }

  // Delegate validation to AuthCoreService
  const validation = await authCoreService.validateSession(
    { userId, companyId, tokenVersion: session.tokenVersion, deviceId: session.deviceId },
    requestDeviceId,
  );

  if (!validation.valid) {
    const reason = validation.reason ?? "UNKNOWN";
    const eventType = reason === "DEVICE_MISMATCH"
      ? AUTH_EVENTS.DEVICE_MISMATCH
      : reason === "TOKEN_VERSION_MISMATCH"
        ? AUTH_EVENTS.TOKEN_VERSION_MISMATCH
        : AUTH_EVENTS.SESSION_INVALIDATED;

    // FASE 14.7.1 — single call: buffer + console/alertEngine + persistent DB audit
    await authCoreService.logSessionInvalidation({
      eventType,
      userId,
      companyId,
      ip,
      path: req.originalUrl,
      requestId: (req as any).requestId,
      reason,
      metadata: { sessionTokenVersion: session.tokenVersion, requestDeviceId },
    });

    console.error("[SESSION_INVALIDATED]", {
      reason,
      userId,
      companyId,
      path: req.path,
    });

    req.session.destroy(() => {});
    res.status(401).json({
      error: "SESSION_INVALIDATED",
      reason,
      message: reason === "DEVICE_MISMATCH"
        ? "Dispositivo não reconhecido. Faça login novamente."
        : "Sua sessão foi encerrada por segurança. Faça login novamente.",
    });
    return;
  }

  next();
}
