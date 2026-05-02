/**
 * FASE 14.6 / 14.7 — Session Token Version Guard.
 *
 * FASE 14.7 REFACTOR: validation logic delegated to AuthCoreService.validateSession()
 * so tokenVersion checks and device-binding enforcement live in one place.
 * This file is now a thin Express middleware adapter.
 *
 * Behaviour unchanged from FASE 14.6:
 *  • Only runs on /api/* (not Vite assets).
 *  • Skips /api/auth/* and /api/v1/auth/* — login/logout always reachable.
 *  • Skips unauthenticated sessions (no tokenVersion) — pass-through.
 *  • Pre-FASE-14.6 sessions (no tokenVersion field) — pass-through.
 *  • DB error → fail-open (DB outage must not lock everyone out).
 *
 * New in FASE 14.7:
 *  • Device binding: if client sends X-Device-Id header AND session has
 *    deviceId AND they differ → SESSION_INVALIDATED with reason DEVICE_MISMATCH.
 *  • Uses AUTH_EVENTS typed constants for security event types.
 */

import type { Request, Response, NextFunction } from "express";
import { authCoreService, AUTH_EVENTS } from "../auth/authCore.service";
import { logSecurity } from "./securityLogger";
import { storage } from "../../services/storage";

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

  // No tokenVersion in session → pre-FASE-14.6 session, pass through
  if (session.tokenVersion === undefined) return next();

  const userId: number | undefined = session.userId;
  const companyId: number | undefined = session.companyId;
  if (!userId && !companyId) return next(); // unauthenticated

  const ip = getClientIp(req);
  // FASE 14.7 — read device ID from client header for binding check
  const requestDeviceId = req.headers["x-device-id"] as string | undefined;

  // Delegate validation to AuthCoreService (FASE 14.7)
  const validation = await authCoreService.validateSession(
    { userId, companyId, tokenVersion: session.tokenVersion, deviceId: session.deviceId },
    requestDeviceId,
  );

  if (!validation.valid) {
    const reason = validation.reason ?? "UNKNOWN";
    const actorLabel = userId ? `userId=${userId}` : `companyId=${companyId}`;
    const eventType = reason === "DEVICE_MISMATCH"
      ? AUTH_EVENTS.DEVICE_MISMATCH
      : reason === "TOKEN_VERSION_MISMATCH"
        ? AUTH_EVENTS.TOKEN_VERSION_MISMATCH
        : AUTH_EVENTS.SESSION_INVALIDATED;

    logSecurity(
      `[SECURITY] ${eventType} | ${actorLabel} | ip=${ip} | reason=${reason} | path=${req.path}`,
    );
    authCoreService.logAuthEvent(eventType, {
      ip,
      path: req.originalUrl,
      requestId: (req as any).requestId,
      userId,
      companyId,
      metadata: { reason, sessionTokenVersion: session.tokenVersion, requestDeviceId },
    });

    // Best-effort DB audit log
    storage.createLog({
      action: "SESSION_INVALIDATED",
      description: `Sessão encerrada por segurança: ${reason}. Usuário forçado a re-autenticar.`,
      userId,
      companyId,
      ip,
      level: "WARN",
    }).catch(() => {});

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
