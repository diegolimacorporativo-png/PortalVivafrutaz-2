/**
 * Bridge middleware: populates the RequestContext ALS from each incoming
 * request. Must mount AFTER requestIdMiddleware (needs req.requestId).
 *
 * Populates at entry time: requestId, ip, userAgent, startTime.
 * Actor fields (actorId, role, tenantId) are enriched after session resolves
 * via the enrichment middleware in app.ts.
 */

import type { Request, Response, NextFunction } from "express";
import { runWithRequestContext } from "../core/context/requestContext";

export function requestContextMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const id =
    typeof req.requestId === "string" && req.requestId.length > 0
      ? req.requestId
      : "unknown";

  const ip =
    (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    "unknown";

  const userAgent = (req.headers["user-agent"] as string | undefined) ?? "unknown";

  runWithRequestContext(
    { requestId: id, ip, userAgent, startTime: Date.now() },
    () => next(),
  );
}
