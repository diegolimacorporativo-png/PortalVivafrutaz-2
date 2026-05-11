/**
 * FASE 2 — Centralised structured logger.
 *
 * All log lines automatically carry the current requestId, tenantId,
 * actorId, and role from their respective AsyncLocalStorage contexts.
 * Fields that are unavailable (workers, cron, unauthenticated requests)
 * are omitted from the output — never logged as "undefined".
 *
 * Categories: INFO | WARN | ERROR | SECURITY | AUDIT
 *
 * Output format (single JSON line per entry):
 *   [LEVEL] [reqId] [tenant=N] [actor=N role=R] message {extra}
 *
 * The format stays grep-friendly and consistent with the existing
 * requestLogger / errorHandler lines already in production.
 */

import { getRequestContext } from "../context/requestContext";
import { getTenantContext } from "../tenant/context";

export type LogLevel = "INFO" | "WARN" | "ERROR" | "SECURITY" | "AUDIT";

interface LogEntry {
  level: LogLevel;
  message: string;
  requestId?: string;
  tenantId?: number | null;
  actorId?: number;
  role?: string;
  endpoint?: string;
  extra?: Record<string, unknown>;
  timestamp: string;
}

function buildEntry(
  level: LogLevel,
  message: string,
  extra?: Record<string, unknown>,
): LogEntry {
  const reqCtx = getRequestContext();
  const tenantCtx = getTenantContext();

  const entry: LogEntry = {
    level,
    message,
    timestamp: new Date().toISOString(),
  };

  if (reqCtx) {
    entry.requestId = reqCtx.requestId;
    if (reqCtx.actorId !== undefined) entry.actorId = reqCtx.actorId;
    if (reqCtx.role !== undefined) entry.role = reqCtx.role;
    if (reqCtx.tenantId !== undefined) entry.tenantId = reqCtx.tenantId;
  }

  // Prefer tenantContext if requestContext didn't have it yet
  if (entry.tenantId === undefined && tenantCtx?.empresaId !== undefined) {
    entry.tenantId = tenantCtx.empresaId;
  }
  if (entry.role === undefined && tenantCtx?.principal?.kind === "admin") {
    entry.role = tenantCtx.principal.role;
  }
  if (entry.actorId === undefined) {
    const p = tenantCtx?.principal;
    if (p?.kind === "admin" && p.userId) entry.actorId = p.userId;
    else if (p?.kind === "company" && p.userId) entry.actorId = p.userId;
  }

  if (extra && Object.keys(extra).length > 0) entry.extra = extra;

  return entry;
}

function emit(entry: LogEntry): void {
  const parts: string[] = [`[${entry.level}]`];
  if (entry.requestId) parts.push(`[${entry.requestId}]`);
  if (entry.tenantId != null) parts.push(`[tenant=${entry.tenantId}]`);
  if (entry.actorId != null) parts.push(`[actor=${entry.actorId}${entry.role ? ` role=${entry.role}` : ""}]`);
  parts.push(entry.message);
  if (entry.extra) parts.push(JSON.stringify(entry.extra));

  const line = parts.join(" ");

  switch (entry.level) {
    case "ERROR":
    case "SECURITY":
      console.error(line);
      break;
    case "WARN":
      console.warn(line);
      break;
    default:
      console.log(line);
  }
}

export const logger = {
  info(message: string, extra?: Record<string, unknown>): void {
    emit(buildEntry("INFO", message, extra));
  },
  warn(message: string, extra?: Record<string, unknown>): void {
    emit(buildEntry("WARN", message, extra));
  },
  error(message: string, extra?: Record<string, unknown>): void {
    emit(buildEntry("ERROR", message, extra));
  },
  security(message: string, extra?: Record<string, unknown>): void {
    emit(buildEntry("SECURITY", message, extra));
  },
  audit(message: string, extra?: Record<string, unknown>): void {
    emit(buildEntry("AUDIT", message, extra));
  },
};
