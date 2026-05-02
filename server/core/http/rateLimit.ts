import type { Request, Response, NextFunction } from "express";

const memory = new Map<string, { count: number; time: number }>();

const WINDOW = 60_000; // 1 min
const LIMIT = 60; // 60 req/min por IP

export function simpleRateLimit(req: Request, res: Response, next: NextFunction) {
  // Only apply rate limiting to API routes — static assets and Vite dev
  // server requests must never be rate-limited (all Replit traffic shares
  // the same proxy IP, so limiting non-API paths blocks the whole frontend).
  if (!req.path.startsWith("/api")) return next();

  // ETAPA 5 — bypass para sessões autenticadas (admin e empresa)
  // Não é possível checar role sem lookup assíncrono em middleware síncrono;
  // qualquer usuário autenticado (userId ou companyId) está fora do rate limit.
  const session = (req as any).session;
  if (session?.userId || session?.companyId) return next();

  const ip = req.ip || "unknown";
  const now = Date.now();

  const entry = memory.get(ip);

  if (!entry) {
    memory.set(ip, { count: 1, time: now });
    return next();
  }

  if (now - entry.time > WINDOW) {
    memory.set(ip, { count: 1, time: now });
    return next();
  }

  if (entry.count >= LIMIT) {
    res.status(429).json({ message: "Too many requests. Try again later." });
    return;
  }

  entry.count++;
  return next();
}
