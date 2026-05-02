/**
 * FASE 14.6 — Session Token Version Guard.
 *
 * Validates that every authenticated request carries a session whose
 * `tokenVersion` matches the value currently stored in the DB for that
 * user/company. If they diverge (because `revokeAllSessions` was called or
 * the account was reset), the session is destroyed immediately and the client
 * receives HTTP 401 with `{ error: "SESSION_INVALIDATED" }`.
 *
 * This is the session-based equivalent of "refresh token rotation":
 * incrementing `tokenVersion` in the DB is a single-operation way to
 * invalidate ALL active sessions for an account without touching the
 * session store directly.
 *
 * Design decisions:
 *  • Only runs on `/api/*` routes — static assets are untouched.
 *  • Skips `/api/auth/*` — login/logout/force-password-change must always work.
 *  • Skips unauthenticated requests — no userId or companyId in session.
 *  • Only blocks when `session.tokenVersion` is DEFINED and MISMATCHES the DB.
 *    Sessions created before FASE 14.6 (no tokenVersion) are NOT kicked out —
 *    they just don't benefit from the revocation mechanism until next login.
 *  • DB lookup is best-effort: a DB error logs a warning but lets the request
 *    through (fail-open), preventing a DB outage from locking everyone out.
 *  • Logs to securityLogger + storage.createLog so the audit trail is complete.
 */

import type { Request, Response, NextFunction } from "express";
import { storage } from "../../services/storage";
import { logSecurityEvent, logSecurity } from "./securityLogger";

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

  const sessionTokenVersion: number | undefined = session.tokenVersion;
  // No tokenVersion in session → pre-FASE-14.6 session, pass through
  if (sessionTokenVersion === undefined) return next();

  const userId: number | undefined = session.userId;
  const companyId: number | undefined = session.companyId;

  // Unauthenticated request — nothing to guard
  if (!userId && !companyId) return next();

  const ip = getClientIp(req);

  try {
    let dbTokenVersion: number | null = null;
    let actorLabel = "";

    if (userId) {
      const user = await storage.getUser(userId);
      if (!user) {
        // User deleted — destroy session
        req.session.destroy(() => {});
        res.status(401).json({ error: "SESSION_INVALIDATED", message: "Sessão inválida. Faça login novamente." });
        return;
      }
      dbTokenVersion = (user as any).tokenVersion ?? 0;
      actorLabel = `userId=${userId}`;
    } else if (companyId) {
      const company = await storage.getCompany(companyId);
      if (!company) {
        req.session.destroy(() => {});
        res.status(401).json({ error: "SESSION_INVALIDATED", message: "Sessão inválida. Faça login novamente." });
        return;
      }
      dbTokenVersion = (company as any).tokenVersion ?? 0;
      actorLabel = `companyId=${companyId}`;
    }

    if (dbTokenVersion !== null && sessionTokenVersion !== dbTokenVersion) {
      logSecurity(
        `[SECURITY] SESSION_INVALIDATED | ${actorLabel} | ip=${ip} | sessionVersion=${sessionTokenVersion} | dbVersion=${dbTokenVersion} | path=${req.path}`,
      );
      logSecurityEvent({
        type: "SESSION_INVALIDATED",
        ip,
        path: req.originalUrl,
        requestId: (req as any).requestId,
        userId,
        metadata: { companyId, sessionTokenVersion, dbTokenVersion },
      });
      // Best-effort DB audit log
      storage.createLog({
        action: "SESSION_INVALIDATED",
        description: `Sessão revogada por tokenVersion desatualizado (${sessionTokenVersion} ≠ ${dbTokenVersion}). Usuário forçado a re-autenticar.`,
        userId,
        companyId,
        ip,
        level: "WARN",
      }).catch(() => {});

      req.session.destroy(() => {});
      res.status(401).json({
        error: "SESSION_INVALIDATED",
        message: "Sua sessão foi encerrada por segurança. Faça login novamente.",
      });
      return;
    }
  } catch (err: any) {
    // Fail-open: DB error must not lock everyone out
    logSecurity(`[SECURITY] SESSION_GUARD_ERROR | path=${req.path} | error=${err?.message ?? "unknown"}`);
  }

  next();
}
