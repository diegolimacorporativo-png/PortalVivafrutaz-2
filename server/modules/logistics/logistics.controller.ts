/**
 * LogisticsController — thin HTTP adapter over LogisticsService.
 *
 * BACKWARD-COMPAT NOTE — auth model:
 * The legacy logistics endpoints in `server/routes/routes.ts` use FOUR
 * different auth strategies and we preserve each one EXACTLY:
 *
 *   1. logAuth          → 401 "Not authenticated" / 403 "Sem permissão"
 *      (gates the CRUD endpoints for drivers, vehicles, routes, maintenance).
 *      Allowed roles: MASTER, ADMIN, DIRECTOR, DEVELOPER,
 *                     OPERATIONS_MANAGER, LOGISTICS.
 *
 *   2. analytical logistics → authenticated logistics roles only. The
 *      route-assistant legacy message remains "Não autorizado"; the other
 *      analytical endpoints use "Não autenticado".
 *
 *   3. admin-only       → 401 "Não autenticado" / 403 "Acesso negado.
 *      Apenas administradores logísticos." (audit-logs).
 *      Allowed roles: MASTER, ADMIN, DIRECTOR, LOGISTICS, DEVELOPER.
 *
 *   4. no auth at all   → calculate-distance and geo/cep.
 *
 * Because of (4), we DO NOT mount `requireAuth` on the router; each handler
 * enforces its own gate (or none) to mirror legacy verbatim. Error response
 * shapes are also preserved bit-for-bit (raw `{ message }`, not the v2
 * envelope) because there are existing frontend callers that read these
 * fields directly.
 *
 * ERROR-FLOW NOTE — every catch in this file responds manually because the
 * legacy wire contract (status code + Portuguese `{ message }`) is observable
 * and there are existing frontend callers reading these exact strings. We
 * therefore PRESERVE each manual response and add a single
 * `console.warn('[logistics.controller] <method> failed', err)` line so the
 * standardized log makes the failure visible in production.
 */
import type { Request, Response } from "express";
import { sql } from "drizzle-orm";
import { db } from "../../database/db";
import { calculateDistance } from "../../services/logistics/routeOptimizer";
import { calculateETA, summariseETA } from "./eta.service";
import {
  getEffectiveDeliveryWindow,
  hasValidTrackingCoordinates,
  isFreshTrackingGps,
  localDateTimeToInstant,
  normalizeTrackingStatus,
} from "./delivery-tracking.logic";
import { LogisticsService, logisticsService } from "./logistics.service";
import { resolveOwnDriverId } from "./driver.access";
import {
  LOGISTICS_ADMIN_ROLES,
  LOGISTICS_AUTH_ROLES,
  type ActorRef,
} from "./logistics.types";
import {
  verifyPublicTrackingToken,
} from "../../core/security/publicTrackingToken";
import { buildPublicRouteTrackingPayload } from "./public-tracking.dto";

/** Drizzle's `db.execute` returns either { rows } or an array depending on driver. */
function rowsOf<T = any>(r: any): T[] {
  return Array.isArray(r) ? r : (r?.rows ?? []);
}

function dateOnly(value: unknown): string | null {
  const text = value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function etaWindowInstants(
  config: unknown,
  scheduledDate: string | null,
  start?: unknown,
  end?: unknown,
) {
  const window = getEffectiveDeliveryWindow(
    typeof config === "string" ||
      (config != null && typeof config === "object" && !Array.isArray(config))
      ? config as Record<string, unknown> | string
      : null,
    scheduledDate,
    start == null ? null : String(start),
    end == null ? null : String(end),
  );
  return {
    windowStartAt: window && scheduledDate
      ? localDateTimeToInstant(scheduledDate, window.startTime)
      : null,
    windowEndAt: window && scheduledDate
      ? localDateTimeToInstant(scheduledDate, window.endTime)
      : null,
  };
}

function closestDeliveryForRouteStop(stop: any, candidates: any[]): any | undefined {
  if (candidates.length === 0) return undefined;
  if (!hasValidTrackingCoordinates(stop.latitude, stop.longitude)) return candidates[0];
  const withCoordinates = candidates.filter((candidate) =>
    hasValidTrackingCoordinates(candidate.latitude, candidate.longitude),
  );
  if (withCoordinates.length === 0) return candidates[0];
  const point = { lat: Number(stop.latitude), lng: Number(stop.longitude) };
  return withCoordinates.reduce((best, candidate) => {
    const distance = calculateDistance(point, {
      lat: Number(candidate.latitude),
      lng: Number(candidate.longitude),
    });
    const bestDistance = calculateDistance(point, {
      lat: Number(best.latitude),
      lng: Number(best.longitude),
    });
    return distance < bestDistance ? candidate : best;
  });
}

function closestRouteStopIndex(
  delivery: any,
  stops: any[],
  candidateIndexes: number[],
): number | null {
  if (candidateIndexes.length === 0) return null;
  if (!hasValidTrackingCoordinates(delivery.latitude, delivery.longitude)) {
    return candidateIndexes[0];
  }
  const withCoordinates = candidateIndexes.filter((index) =>
    hasValidTrackingCoordinates(stops[index].latitude, stops[index].longitude),
  );
  if (withCoordinates.length === 0) return candidateIndexes[0];
  const point = { lat: Number(delivery.latitude), lng: Number(delivery.longitude) };
  return withCoordinates.reduce((bestIndex, index) => {
    const stop = stops[index];
    const bestStop = stops[bestIndex];
    const distance = calculateDistance(point, {
      lat: Number(stop.latitude),
      lng: Number(stop.longitude),
    });
    const bestDistance = calculateDistance(point, {
      lat: Number(bestStop.latitude),
      lng: Number(bestStop.longitude),
    });
    return distance < bestDistance ? index : bestIndex;
  });
}

export class LogisticsController {
  constructor(
    private readonly service: LogisticsService = logisticsService,
  ) {}

  // ── Auth helpers (mirror legacy behaviour exactly) ─────────────────────

  /**
   * logAuth — gates CRUD endpoints. Returns the actor or null after sending
   * the appropriate 401/403 response. Exact ports of the inline `logAuth`
   * helper that lived in routes.ts (line ~2482).
   */
  private async logAuth(req: Request, res: Response): Promise<ActorRef | null> {
    const session = (req as any).session;
    if (!session?.userId) {
      res.status(401).json({ message: "Not authenticated" });
      return null;
    }
    const user = await (this.service as any).repo.getUser(session.userId);
    if (
      !user ||
      !LOGISTICS_AUTH_ROLES.includes(user.role as any)
    ) {
      res.status(403).json({ message: "Sem permissão" });
      return null;
    }
    return user;
  }

  /** Bare session check; returns userId or null after sending 401. */
  private requireSession(
    req: Request,
    res: Response,
    message = "Não autenticado",
  ): number | null {
    const session = (req as any).session;
    if (!session?.userId) {
      res.status(401).json({ message });
      return null;
    }
    return session.userId;
  }

  /** Stricter admin gate for the audit-log endpoint. */
  private async requireLogisticsAdmin(
    req: Request,
    res: Response,
  ): Promise<ActorRef | null> {
    const session = (req as any).session;
    if (!session?.userId) {
      res.status(401).json({ message: "Não autenticado" });
      return null;
    }
    const actor = await (this.service as any).repo.getUser(session.userId);
    if (!actor || !LOGISTICS_ADMIN_ROLES.includes(actor.role as any)) {
      res
        .status(403)
        .json({ message: "Acesso negado. Apenas administradores logísticos." });
      return null;
    }
    return actor;
  }

  /** Auth gate for analytics/planning endpoints plus their tenant scope. */
  private async requireAnalyticsAuth(
    req: Request,
    res: Response,
    unauthenticatedMessage = "Não autenticado",
  ): Promise<ActorRef | null> {
    const session = (req as any).session;
    if (!session?.userId) {
      res.status(401).json({ message: unauthenticatedMessage });
      return null;
    }
    const actor = await (this.service as any).repo.getUser(session.userId);
    if (!actor || !LOGISTICS_AUTH_ROLES.includes(actor.role as any)) {
      res.status(403).json({ message: "Sem permissão" });
      return null;
    }
    return actor;
  }

  // ── DRIVERS ────────────────────────────────────────────────────────────
  listDrivers = async (req: Request, res: Response) => {
    const user = await this.logAuth(req, res);
    if (!user) return;
    try {
      res.json(await this.service.listDrivers());
    } catch (err) {
      console.warn(`[${req.requestId}] [logistics.controller] listDrivers failed`, err);
      res.status(500).json({ message: "Erro" });
    }
  };

  listLiveDriverLocations = async (req: Request, res: Response) => {
    const user = await this.logAuth(req, res);
    if (!user) return;
    try {
      res.json(await this.service.listLiveDriverLocations(user));
    } catch (err: any) {
      console.warn(`[${req.requestId}] [logistics.controller] listLiveDriverLocations failed`, err);
      const status =
        typeof err?.status === "number" && err.status >= 400 && err.status < 500
          ? err.status
          : 500;
      res.status(status).json({
        message: err?.message || "Erro",
      });
    }
  };

  createDriver = async (req: Request, res: Response) => {
    const user = await this.logAuth(req, res);
    if (!user) return;
    try {
      const driver = await this.service.createDriver(req.body, user);
      res.json(driver);
    } catch (e: any) {
      console.warn(`[${req.requestId}] [logistics.controller] createDriver failed`, e);
      // Preserve legacy: BadRequestError → 400; everything else → 500.
      if ([400, 403, 404].includes(e?.status)) {
        return res.status(e.status).json({ message: e.message });
      }
      res.status(500).json({ message: e?.message || "Erro" });
    }
  };

  updateDriver = async (req: Request, res: Response) => {
    const user = await this.logAuth(req, res);
    if (!user) return;
    try {
      res.json(
        await this.service.updateDriver(parseInt(req.params.id as string), req.body, user),
      );
    } catch (err: any) {
      console.warn(`[${req.requestId}] [logistics.controller] updateDriver failed`, err);
      if ([400, 403, 404].includes(err?.status)) {
        return res.status(err.status).json({ message: err.message });
      }
      res.status(500).json({ message: "Erro" });
    }
  };

  deleteDriver = async (req: Request, res: Response) => {
    const user = await this.logAuth(req, res);
    if (!user) return;
    try {
      await this.service.deleteDriver(parseInt(req.params.id as string));
      res.json({ ok: true });
    } catch (err) {
      console.warn(`[${req.requestId}] [logistics.controller] deleteDriver failed`, err);
      res.status(500).json({ message: "Erro" });
    }
  };

  // ── VEHICLES ───────────────────────────────────────────────────────────
  listVehicles = async (req: Request, res: Response) => {
    const user = await this.logAuth(req, res);
    if (!user) return;
    try {
      res.json(await this.service.listVehicles());
    } catch (err) {
      console.warn(`[${req.requestId}] [logistics.controller] listVehicles failed`, err);
      res.status(500).json({ message: "Erro" });
    }
  };

  createVehicle = async (req: Request, res: Response) => {
    const user = await this.logAuth(req, res);
    if (!user) return;
    try {
      res.json(await this.service.createVehicle(req.body, user));
    } catch (e: any) {
      console.warn(`[${req.requestId}] [logistics.controller] createVehicle failed`, e);
      if ([400, 403, 404].includes(e?.status)) {
        return res.status(e.status).json({ message: e.message });
      }
      res.status(500).json({ message: e?.message || "Erro" });
    }
  };

  updateVehicle = async (req: Request, res: Response) => {
    const user = await this.logAuth(req, res);
    if (!user) return;
    try {
      res.json(
        await this.service.updateVehicle(parseInt(req.params.id as string), req.body, user),
      );
    } catch (err: any) {
      console.warn(`[${req.requestId}] [logistics.controller] updateVehicle failed`, err);
      if ([400, 403, 404].includes(err?.status)) {
        return res.status(err.status).json({ message: err.message });
      }
      res.status(500).json({ message: "Erro" });
    }
  };

  deleteVehicle = async (req: Request, res: Response) => {
    const user = await this.logAuth(req, res);
    if (!user) return;
    try {
      await this.service.deleteVehicle(parseInt(req.params.id as string));
      res.json({ ok: true });
    } catch (err) {
      console.warn(`[${req.requestId}] [logistics.controller] deleteVehicle failed`, err);
      res.status(500).json({ message: "Erro" });
    }
  };

  // ── ROUTES ─────────────────────────────────────────────────────────────
  listRoutes = async (req: Request, res: Response) => {
    const user = await this.logAuth(req, res);
    if (!user) return;
    try {
      res.json(await this.service.listRoutes());
    } catch (err) {
      console.warn(`[${req.requestId}] [logistics.controller] listRoutes failed`, err);
      res.status(500).json({ message: "Erro" });
    }
  };

  createRoute = async (req: Request, res: Response) => {
    const user = await this.logAuth(req, res);
    if (!user) return;
    try {
      res.json(await this.service.createRoute(req.body, user));
    } catch (e: any) {
      console.warn(`[${req.requestId}] [logistics.controller] createRoute failed`, e);
      if ([400, 403, 404].includes(e?.status)) {
        return res.status(e.status).json({ message: e.message });
      }
      res.status(500).json({ message: e?.message || "Erro" });
    }
  };

  updateRoute = async (req: Request, res: Response) => {
    const user = await this.logAuth(req, res);
    if (!user) return;
    try {
      res.json(
        await this.service.updateRoute(parseInt(req.params.id as string), req.body, user),
      );
    } catch (err: any) {
      console.warn(`[${req.requestId}] [logistics.controller] updateRoute failed`, err);
      if ([400, 403, 404].includes(err?.status)) {
        return res.status(err.status).json({ message: err.message });
      }
      res.status(500).json({ message: "Erro" });
    }
  };

  deleteRoute = async (req: Request, res: Response) => {
    const user = await this.logAuth(req, res);
    if (!user) return;
    try {
      await this.service.deleteRoute(parseInt(req.params.id as string));
      res.json({ ok: true });
    } catch (err) {
      console.warn(`[${req.requestId}] [logistics.controller] deleteRoute failed`, err);
      res.status(500).json({ message: "Erro" });
    }
  };

  // ── MAINTENANCE ────────────────────────────────────────────────────────
  listMaintenance = async (req: Request, res: Response) => {
    const user = await this.logAuth(req, res);
    if (!user) return;
    try {
      res.json(await this.service.listMaintenance());
    } catch (err) {
      console.warn(`[${req.requestId}] [logistics.controller] listMaintenance failed`, err);
      res.status(500).json({ message: "Erro" });
    }
  };

  createMaintenance = async (req: Request, res: Response) => {
    const user = await this.logAuth(req, res);
    if (!user) return;
    try {
      res.json(await this.service.createMaintenance(req.body, user));
    } catch (e: any) {
      console.warn(`[${req.requestId}] [logistics.controller] createMaintenance failed`, e);
      if ([400, 403, 404].includes(e?.status)) {
        return res.status(e.status).json({ message: e.message });
      }
      res.status(500).json({ message: e?.message || "Erro" });
    }
  };

  updateMaintenance = async (req: Request, res: Response) => {
    const user = await this.logAuth(req, res);
    if (!user) return;
    try {
      res.json(
        await this.service.updateMaintenance(parseInt(req.params.id as string), req.body, user),
      );
    } catch (err: any) {
      console.warn(`[${req.requestId}] [logistics.controller] updateMaintenance failed`, err);
      if ([400, 403, 404].includes(err?.status)) {
        return res.status(err.status).json({ message: err.message });
      }
      res.status(500).json({ message: "Erro" });
    }
  };

  deleteMaintenance = async (req: Request, res: Response) => {
    const user = await this.logAuth(req, res);
    if (!user) return;
    try {
      await this.service.deleteMaintenance(parseInt(req.params.id as string));
      res.json({ ok: true });
    } catch (err) {
      console.warn(`[${req.requestId}] [logistics.controller] deleteMaintenance failed`, err);
      res.status(500).json({ message: "Erro" });
    }
  };

  // ── ROUTE ASSISTANT (uses "Não autorizado") ───────────────────────────
  routeAssistant = async (req: Request, res: Response) => {
    const actor = await this.requireAnalyticsAuth(req, res, "Não autorizado");
    if (!actor) return;
    try {
      const result = await this.service.routeAssistant(
        req.query as { day?: string; date?: string },
        actor,
      );
      res.json(result);
    } catch (e: any) {
      console.warn(`[${req.requestId}] [logistics.controller] routeAssistant failed`, e);
      res.status(500).json({ message: e.message });
    }
  };

  // ── SUGGEST ROUTE ──────────────────────────────────────────────────────
  suggestRoute = async (req: Request, res: Response) => {
    try {
      const actor = await this.requireAnalyticsAuth(req, res);
      if (!actor) return;
      const result = await this.service.suggestRoute(req.body, actor);
      res.json(result);
    } catch (e: any) {
      console.warn(`[${req.requestId}] [logistics.controller] suggestRoute failed`, e);
      if ([400, 403, 404].includes(e?.status)) {
        return res.status(e.status).json({ message: e.message });
      }
      res.status(500).json({ message: e.message });
    }
  };

  // ── DAY ORDERS ─────────────────────────────────────────────────────────
  dayOrders = async (req: Request, res: Response) => {
    try {
      const actor = await this.requireAnalyticsAuth(req, res);
      if (!actor) return;
      const result = await this.service.dayOrders(
        req.query as { date?: string },
        actor,
      );
      res.json(result);
    } catch (e: any) {
      console.warn(`[${req.requestId}] [logistics.controller] dayOrders failed`, e);
      if ([400, 403, 404].includes(e?.status)) {
        return res.status(e.status).json({ message: e.message });
      }
      res.status(500).json({ message: e.message });
    }
  };

  // ── SIMULATE DAY ───────────────────────────────────────────────────────
  simulateDay = async (req: Request, res: Response) => {
    try {
      const actor = await this.requireAnalyticsAuth(req, res);
      if (!actor) return;
      const result = await this.service.simulateDay(req.body, actor);
      res.json(result);
    } catch (e: any) {
      console.warn(`[${req.requestId}] [logistics.controller] simulateDay failed`, e);
      if ([400, 403, 404].includes(e?.status)) {
        return res.status(e.status).json({ message: e.message });
      }
      res.status(500).json({ message: e.message });
    }
  };

  // ── CALCULATE DISTANCE (no auth) ──────────────────────────────────────
  calculateDistance = async (req: Request, res: Response) => {
    try {
      const result = await this.service.calculateDistance(req.body);
      res.json(result);
    } catch (e: any) {
      console.warn(`[${req.requestId}] [logistics.controller] calculateDistance failed`, e);
      if (e?.status === 400) {
        return res.status(400).json({ message: e.message });
      }
      res.status(500).json({ message: e.message });
    }
  };

  // ── AUDIT LOGS ─────────────────────────────────────────────────────────
  auditLogs = async (req: Request, res: Response) => {
    try {
      const actor = await this.requireLogisticsAdmin(req, res);
      if (!actor) return;
      const logs = await this.service.getAuditLogs();
      res.json(logs);
    } catch (e: any) {
      console.warn(`[${req.requestId}] [logistics.controller] auditLogs failed`, e);
      res.status(500).json({ message: e.message });
    }
  };

  // ── REPORTS / DELIVERIES ───────────────────────────────────────────────
  deliveriesReport = async (req: Request, res: Response) => {
    try {
      const actor = await this.requireAnalyticsAuth(req, res);
      if (!actor) return;
      const result = await this.service.deliveriesReport(
        req.query as any,
        actor,
      );
      res.json(result);
    } catch (e: any) {
      console.warn(`[${req.requestId}] [logistics.controller] deliveriesReport failed`, e);
      if ([400, 403, 404].includes(e?.status)) {
        return res.status(e.status).json({ message: e.message });
      }
      res.status(500).json({ message: e.message });
    }
  };

  // ── ROUTE STOPS (authenticated + route-tenant scoped) ────────────────
  listRouteStops = async (req: Request, res: Response) => {
    const actor = await this.logAuth(req, res);
    if (!actor) return;
    try {
      const stops = await this.service.getRouteStops(
        Number(req.params.routeId as string),
        actor,
      );
      res.json(stops);
    } catch (e: any) {
      console.warn(`[${req.requestId}] [logistics.controller] listRouteStops failed`, e);
      if ([400, 403, 404].includes(e?.status)) {
        return res.status(e.status).json({ message: e.message });
      }
      res.status(500).json({ message: e.message });
    }
  };

  createRouteStop = async (req: Request, res: Response) => {
    const actor = await this.logAuth(req, res);
    if (!actor) return;
    try {
      const stop = await this.service.createRouteStop(
        Number(req.params.routeId as string),
        req.body,
        actor,
      );
      res.json(stop);
    } catch (e: any) {
      console.warn(`[${req.requestId}] [logistics.controller] createRouteStop failed`, e);
      if ([400, 403, 404].includes(e?.status)) {
        return res.status(e.status).json({ message: e.message });
      }
      res.status(500).json({ message: e.message });
    }
  };

  updateRouteStop = async (req: Request, res: Response) => {
    const actor = await this.logAuth(req, res);
    if (!actor) return;
    try {
      const stop = await this.service.updateRouteStop(
        Number(req.params.routeId as string),
        Number(req.params.stopId as string),
        req.body,
        actor,
      );
      res.json(stop);
    } catch (e: any) {
      console.warn(`[${req.requestId}] [logistics.controller] updateRouteStop failed`, e);
      if ([400, 403, 404].includes(e?.status)) {
        return res.status(e.status).json({ message: e.message });
      }
      res.status(500).json({ message: e.message });
    }
  };

  deleteRouteStop = async (req: Request, res: Response) => {
    const actor = await this.logAuth(req, res);
    if (!actor) return;
    try {
      await this.service.deleteRouteStop(
        Number(req.params.routeId as string),
        Number(req.params.stopId as string),
        actor,
      );
      res.json({ ok: true });
    } catch (e: any) {
      console.warn(`[${req.requestId}] [logistics.controller] deleteRouteStop failed`, e);
      if ([400, 403, 404].includes(e?.status)) {
        return res.status(e.status).json({ message: e.message });
      }
      res.status(500).json({ message: e.message });
    }
  };

  // ── GEO CEP (no auth) ──────────────────────────────────────────────────
  geoCep = async (req: Request, res: Response) => {
    try {
      const result = await this.service.geoCep(req.params.cep as string);
      res.json(result);
    } catch (e: any) {
      console.warn(`[${req.requestId}] [logistics.controller] geoCep failed`, e);
      if (e?.status === 404) {
        return res.status(404).json({ message: e.message });
      }
      res.status(500).json({ message: e.message });
    }
  };

  // ── SMART SEARCH ──────────────────────────────────────────────────────
  smartSearch = async (req: Request, res: Response) => {
    try {
      const actor = await this.requireAnalyticsAuth(req, res);
      if (!actor) return;
      const q = String(req.query.q || "");
      const result = await this.service.smartSearch(q, actor);
      res.json(result);
    } catch (e: any) {
      console.warn(`[${req.requestId}] [logistics.controller] smartSearch failed`, e);
      if ([400, 403, 404].includes(e?.status)) {
        return res.status(e.status).json({ message: e.message });
      }
      res.status(500).json({ message: e.message });
    }
  };

  // ── BEST DRIVER ────────────────────────────────────────────────────────
  bestDriver = async (req: Request, res: Response) => {
    try {
      const actor = await this.requireAnalyticsAuth(req, res);
      if (!actor) return;
      const result = await this.service.bestDriver(
        req.query.date as string | undefined,
        actor,
      );
      res.json(result);
    } catch (e: any) {
      console.warn(`[${req.requestId}] [logistics.controller] bestDriver failed`, e);
      if ([400, 403, 404].includes(e?.status)) {
        return res.status(e.status).json({ message: e.message });
      }
      res.status(500).json({ message: e.message });
    }
  };

  // ── ROUTE INSERTION ────────────────────────────────────────────────────
  routeInsertion = async (req: Request, res: Response) => {
    try {
      const actor = await this.requireAnalyticsAuth(req, res);
      if (!actor) return;
      const result = await this.service.routeInsertion(req.body, actor);
      res.json(result);
    } catch (e: any) {
      console.warn(`[${req.requestId}] [logistics.controller] routeInsertion failed`, e);
      if ([400, 403, 404].includes(e?.status)) {
        return res.status(e.status).json({ message: e.message });
      }
      res.status(500).json({ message: e.message });
    }
  };

  // ── ROUTE TRACKING (signed public token or authenticated internal session) ─
  /**
   * GET /api/logistics/track/:token — route maps are internal-only, even when
   * the caller holds a signed route capability. Customer links use delivery
   * capabilities from /api/track/:token instead.
   *   • logistics_routes  → route header + driver assignment
   *   • logistics_drivers → driver name/phone (LEFT JOIN, may be null)
   *   • route_stops       → ordered sequence (by ordem_parada)
   *   • deliveries        → status overlay per stop (route_position order)
   *   • driver_gps_positions → latest GPS ping for the assigned driver
   *
    * The signed route token is only an opaque identifier, not authorization:
    * this endpoint still requires an authenticated, authorized session.
    * Customer delivery links use the separate public delivery tracking DTO.
   */
  routeTracking = async (req: Request, res: Response) => {
    try {
      const rawResource = String(req.params.token ?? "");
      const publicClaims = verifyPublicTrackingToken(rawResource, "route");
      const sessionUserId: number | undefined = (req as any).session?.userId;
      let numericActor: ActorRef | null = null;

      // A route token is not a customer tracking link: require a session for
      // both token and numeric paths before querying any route details.
      if (!sessionUserId || (!publicClaims && !/^[1-9]\d*$/.test(rawResource))) {
        return res.status(403).json({
          error: "Autenticação necessária para visualizar a rota",
        });
      }

      // Resolve role and tenant ownership before querying stops, deliveries,
      // or GPS. Signed capabilities do not bypass the internal route scope.
      numericActor = await (this.service as any).repo.getUser(sessionUserId);
      const isInternalRole =
        numericActor &&
        (LOGISTICS_AUTH_ROLES as readonly string[]).includes(numericActor.role);
      const isDriverRole =
        numericActor?.role === "DRIVER" || numericActor?.role === "MOTORISTA";
      const isGlobalActor =
        numericActor &&
        numericActor.empresaId == null &&
        (numericActor.role === "MASTER" || numericActor.role === "DIRECTOR");

      if (!numericActor || (!isInternalRole && !isDriverRole)) {
        return res.status(403).json({ error: "Sem permissão para rastrear esta rota" });
      }
      if (numericActor.empresaId == null && !isGlobalActor) {
        return res.status(403).json({ error: "Empresa não definida" });
      }

      const routeId = publicClaims?.resourceId ?? Number(rawResource);
      const ownedRoute = numericActor.empresaId == null
        ? await (this.service as any).repo.getRoute(routeId)
        : await (this.service as any).repo.getRouteForCompany(
            routeId,
            numericActor.empresaId,
          );
      if (!ownedRoute) {
        return res.status(404).json({ error: "Route not found" });
      }

      const tenantRoutePredicate =
        numericActor.empresaId != null
          ? sql`AND lr.empresa_id = ${numericActor.empresaId}`
          : sql``;

      // 1. Route header + driver (LEFT JOIN — route may have no driver yet)
      const routeRows = rowsOf<any>(await db.execute(sql`
        SELECT lr.id,
                lr.empresa_id AS route_company_id,
               lr.driver_id,
               lr.vehicle_id,
               lr.status,
               lr.delivery_date,
               lr.name           AS route_name,
               ld.name           AS driver_name,
               ld.phone          AS driver_phone
        FROM logistics_routes lr
        LEFT JOIN logistics_drivers ld ON ld.id = lr.driver_id
        WHERE lr.id = ${routeId} ${tenantRoutePredicate}
        LIMIT 1
      `));
      const route = routeRows[0];
      if (!route) return res.status(404).json({ error: "Route not found" });

      // Driver accounts are restricted to their own operational route before
      // any private route details are queried. Internal tenant users were
      // already constrained by empresa_id above.
      if (
        numericActor &&
        (numericActor.role === "DRIVER" || numericActor.role === "MOTORISTA")
      ) {
        const ownDriverId = await resolveOwnDriverId(
          { getDrivers: () => (this.service as any).repo.getDrivers() },
          numericActor,
        );
        if (!ownDriverId || Number(route.driver_id) !== ownDriverId) {
          return res.status(403).json({ error: "Rota não pertence ao motorista" });
        }
      }

      // 2. Stops in route order
      const stops = rowsOf<any>(await db.execute(sql`
        SELECT id, route_id, cep, endereco, numero, cidade, estado,
               latitude, longitude, ordem_parada, company_id,
               janela_inicio, janela_fim, tempo_estimado_min
        FROM route_stops
        WHERE route_id = ${routeId}
        ORDER BY ordem_parada ASC, id ASC
      `));

      // 3. Deliveries on this route — adds order/status/company name overlay
      const deliveries = rowsOf<any>(await db.execute(sql`
        SELECT d.id,
               d.order_id,
               d.company_id,
               d.status,
               d.route_position,
               d.latitude,
               d.longitude,
               d.scheduled_date,
               d.delivered_at,
               c.delivery_config_json AS company_delivery_config_json,
               c.company_name AS company_name
        FROM deliveries d
        LEFT JOIN companies c ON c.id = d.company_id
        WHERE d.route_id = ${routeId}
        ORDER BY d.route_position ASC NULLS LAST, d.id ASC
      `));

      const now = new Date();
      const routeIsActive = normalizeTrackingStatus(route.status) === "in_progress";
      let journeyStartedAtMs: number | null = null;
      if (route.driver_id && routeIsActive) {
        const journeyRows = rowsOf<any>(await db.execute(sql`
          SELECT started_at
          FROM driver_journeys
          WHERE driver_id = ${route.driver_id}
            AND status = 'active'
            AND (empresa_id = ${route.route_company_id} OR empresa_id IS NULL)
          ORDER BY started_at DESC, id DESC
          LIMIT 1
        `));
        const startedAt = journeyRows[0]?.started_at == null
          ? Number.NaN
          : new Date(journeyRows[0].started_at).getTime();
        if (Number.isFinite(startedAt)) journeyStartedAtMs = startedAt;
      }

      // 4. Latest GPS ping (keep its timestamp visible, but only use a fresh
      // post-journey position for ETA calculations).
      let driverPosition: any = null;
      let gpsStatus:
        | "no_position"
        | "invalid_position"
        | "stale"
        | "route_not_active"
        | "journey_inactive"
        | "before_journey"
        | "fresh" = "no_position";
      let gpsFreshForEta = false;
      if (route.driver_id) {
        const gpsRows = rowsOf<any>(await db.execute(sql`
          SELECT latitude::text AS latitude,
                 longitude::text AS longitude,
                 accuracy::text AS accuracy,
                 speed::text AS speed,
                 heading::text AS heading,
                 recorded_at
          FROM driver_gps_positions
          WHERE driver_id = ${route.driver_id}
          ORDER BY recorded_at DESC, id DESC
          LIMIT 1
        `));
        const g = gpsRows[0];
        if (g) {
          if (!hasValidTrackingCoordinates(g.latitude, g.longitude)) {
            gpsStatus = "invalid_position";
          } else {
            driverPosition = {
              lat: g.latitude,
              lng: g.longitude,
              accuracy: g.accuracy,
              speed: g.speed,
              heading: g.heading,
              updatedAt: g.recorded_at,
            };
            if (!isFreshTrackingGps(g.recorded_at, now)) {
              gpsStatus = "stale";
            } else if (!routeIsActive) {
              gpsStatus = "route_not_active";
            } else if (journeyStartedAtMs == null) {
              gpsStatus = "journey_inactive";
            } else if (new Date(g.recorded_at).getTime() < journeyStartedAtMs) {
              gpsStatus = "before_journey";
            } else {
              gpsStatus = "fresh";
              gpsFreshForEta = true;
            }
          }
        }
      }

      // 5. Compute ETA per stop in memory.
      // Prefer route_stops for the sequence (richer, ordemParada-based);
      // if there are none, fall back to deliveries ordered by route_position
      // so the customer ETA still works on routes that don't yet have
      // route_stops materialised.
      const deliveryStopIndexById = new Map<number, number>();
      const usedDeliveryIds = new Set<number>();
      const routeStopCountByCompany = new Map<number, number>();
      for (const stop of stops) {
        if (stop.company_id == null) continue;
        const companyId = Number(stop.company_id);
        routeStopCountByCompany.set(
          companyId,
          (routeStopCountByCompany.get(companyId) ?? 0) + 1,
        );
      }
      const etaSourceFromStops = stops.map((s, stopIndex) => {
        const sameCompanyDeliveries = s.company_id == null
          ? []
          : deliveries.filter((d) => Number(d.company_id) === Number(s.company_id));
        const stopCount = s.company_id == null
          ? 0
          : routeStopCountByCompany.get(Number(s.company_id)) ?? 0;
        const availableDeliveries = sameCompanyDeliveries.filter(
          (d) => !usedDeliveryIds.has(Number(d.id)),
        );
        let delivery = stopCount === 1
          ? closestDeliveryForRouteStop(s, sameCompanyDeliveries)
          : closestDeliveryForRouteStop(s, availableDeliveries);
        if (stopCount === 1) {
          // A single route stop can represent multiple orders to one destination.
          for (const candidate of sameCompanyDeliveries) {
            deliveryStopIndexById.set(Number(candidate.id), stopIndex);
          }
          delivery = sameCompanyDeliveries.find(
            (candidate) =>
              !["delivered", "cancelled"].includes(
                normalizeTrackingStatus(candidate.status),
              ),
          ) ?? delivery;
        } else if (delivery) {
          usedDeliveryIds.add(Number(delivery.id));
          deliveryStopIndexById.set(Number(delivery.id), stopIndex);
        }
        const scheduledDate = dateOnly(delivery?.scheduled_date ?? route.delivery_date);
        return {
          ...s,
          status: delivery?.status,
          tempoEstimadoMin: s.tempo_estimado_min,
          ...etaWindowInstants(
            delivery?.company_delivery_config_json,
            scheduledDate,
            s.janela_inicio,
            s.janela_fim,
          ),
        };
      });
      for (const delivery of deliveries) {
        if (deliveryStopIndexById.has(Number(delivery.id))) continue;
        const companyStopIndexes = stops.flatMap((stop, index) =>
          stop.company_id != null &&
          Number(stop.company_id) === Number(delivery.company_id)
            ? [index]
            : [],
        );
        const nearestIndex = closestRouteStopIndex(
          delivery,
          stops,
          companyStopIndexes,
        );
        if (nearestIndex != null) {
          deliveryStopIndexById.set(Number(delivery.id), nearestIndex);
        }
      }
      const etaSourceFromDeliveries = deliveries.map((d) => ({
        ...d,
        tempoEstimadoMin: null,
        ...etaWindowInstants(
          d.company_delivery_config_json,
          dateOnly(d.scheduled_date ?? route.delivery_date),
        ),
      }));
      const useStops = etaSourceFromStops.length > 0;
      const etaSource = useStops ? etaSourceFromStops : etaSourceFromDeliveries;
      const activeEtaStops = etaSource.filter(
        (stop) => !["delivered", "cancelled"].includes(normalizeTrackingStatus(stop.status)),
      );
      const hasCoordinatesForEta = activeEtaStops.length > 0 &&
        activeEtaStops.every((stop) =>
          hasValidTrackingCoordinates(stop.latitude, stop.longitude),
        );
      const speedMetersPerSecond = Number(driverPosition?.speed);
      const speedKmh = Number.isFinite(speedMetersPerSecond) && speedMetersPerSecond > 0
        ? speedMetersPerSecond * 3.6
        : null;
      const etaAvailable = routeIsActive &&
        gpsFreshForEta &&
        hasCoordinatesForEta;
      const etaResults = etaAvailable
        ? calculateETA(etaSource, driverPosition, now, { speedKmh })
        : [];
      const etaSummary = etaResults.length > 0
        ? summariseETA(etaResults, now, speedKmh)
        : null;
      const etaUnavailableReason = etaAvailable
        ? null
        : !routeIsActive
          ? "route_not_active"
          : !route.driver_id
            ? "driver_unassigned"
            : !driverPosition
              ? "gps_unavailable"
              : gpsStatus === "stale"
                ? "gps_stale"
                : gpsStatus === "before_journey" || gpsStatus === "journey_inactive"
                  ? "journey_inactive"
                  : !hasCoordinatesForEta
                    ? "stop_coordinates_missing"
                    : "gps_unavailable";

      // Build the output stops array (always derived from route_stops when
      // available so legacy callers see the same shape).
      const stopsOut = useStops
        ? stops.map((s, i) => ({
            id: s.id,
            ordem: s.ordem_parada,
            companyId: s.company_id,
            cep: s.cep,
            endereco: s.endereco,
            numero: s.numero,
            cidade: s.cidade,
            estado: s.estado,
            latitude: s.latitude,
            longitude: s.longitude,
            janelaInicio: s.janela_inicio,
            janelaFim: s.janela_fim,
            tempoEstimadoMin: s.tempo_estimado_min,
            distanceKm: etaResults[i]?.distanceKm ?? null,
            legMinutes: etaResults[i]?.legMinutes ?? null,
            etaMinutes: etaResults[i]?.etaMinutes ?? null,
            etaTime: etaResults[i]?.etaTime ?? null,
            status: etaSourceFromStops[i]?.status ?? null,
          }))
        : [];

      const deliveriesOut = deliveries.map((d, i) => {
        const mappedStopIndex = deliveryStopIndexById.get(Number(d.id));
        const etaRow = !useStops
          ? etaResults[i]
          : mappedStopIndex == null
            ? undefined
            : etaResults[mappedStopIndex];
        return {
          id: d.id,
          orderId: d.order_id,
          companyId: d.company_id,
          companyName: d.company_name,
          status: d.status,
          routePosition: d.route_position,
          latitude: d.latitude,
          longitude: d.longitude,
          scheduledDate: d.scheduled_date,
          deliveredAt: d.delivered_at,
          etaMinutes: etaRow?.etaMinutes ?? null,
          etaTime: etaRow?.etaTime ?? null,
        };
      });

      // ── STEP 8.5B — gate ETA detail by role ─────────────────────────────
      // Only the internal logistics roles and drivers who passed the session,
      // tenant, and own-route checks above reach this point. The route token
      // never turns the authenticated map endpoint into a public capability.
      let isInternal = false;
      if (numericActor) {
        try {
          const actor = numericActor;
          if (LOGISTICS_AUTH_ROLES.includes(actor.role as any)) {
            isInternal = true;
          } else if (
            actor &&
            (actor.role === "DRIVER" || actor.role === "MOTORISTA")
          ) {
            // STEP 8.7 — DRIVER ownership gate. A driver may only see THEIR
            // own route; any other route id returns 403 instead of leaking
            // the redacted public payload (which would still confirm the
            // route's existence and a couple of customer names). When the
            // route IS theirs, we treat them as "internal" for ETA purposes
            // — they need the timing/distance to actually do the deliveries.
            const ownDriverId = await resolveOwnDriverId(
              { getDrivers: () => (this.service as any).repo.getDrivers() },
              actor,
            );
            if (!ownDriverId || Number(route.driver_id) !== ownDriverId) {
              return res.status(403).json({ error: "Rota não pertence ao motorista" });
            }
            isInternal = true;
          }
        } catch (lookupErr) {
          // Fail closed — if we can't confirm internal status, treat as customer.
          console.warn(`[${(req as any).requestId}] [logistics.controller] routeTracking actor lookup failed`, lookupErr);
        }
      }

      const internalPayload: any = {
        route: {
          id: route.id,
          name: route.route_name,
          status: route.status,
          deliveryDate: route.delivery_date,
          driverId: route.driver_id,
          vehicleId: route.vehicle_id,
        },
        driver: route.driver_id
          ? {
              id: route.driver_id,
              name: route.driver_name,
              phone: route.driver_phone,
            }
          : null,
         stops: stopsOut,
         deliveries: deliveriesOut,
        driverPosition,
        gpsStatus,
        etaAvailable,
        etaUnavailableReason,
        viewerScope: "internal",
      };
      if (isInternal) internalPayload.eta = etaSummary;

      if (isInternal) {
        return res.json(internalPayload);
      }

      return res.json(buildPublicRouteTrackingPayload({
        route: {
          name: route.route_name,
          status: route.status,
          deliveryDate: route.delivery_date,
        },
        stops: stopsOut.map((stop) => ({
          ordem: stop.ordem,
          cidade: stop.cidade,
          estado: stop.estado,
          latitude: stop.latitude,
          longitude: stop.longitude,
          status: stop.status,
        })),
        deliveries: deliveriesOut.map((delivery) => ({
          status: delivery.status,
          routePosition: delivery.routePosition,
          latitude: delivery.latitude,
          longitude: delivery.longitude,
          scheduledDate: delivery.scheduledDate,
          deliveredAt: delivery.deliveredAt,
        })),
        driverPosition: driverPosition
          ? {
              lat: driverPosition.lat,
              lng: driverPosition.lng,
              recordedAt: driverPosition.updatedAt,
            }
          : null,
      }));
    } catch (e: any) {
      console.warn(`[${(req as any).requestId}] [logistics.controller] routeTracking failed`, e);
      res.status(500).json({ error: e?.message || "Erro" });
    }
  };

  // ── SMART ROUTE PLAN ───────────────────────────────────────────────────
  smartRoutePlan = async (req: Request, res: Response) => {
    const actor = await this.requireAnalyticsAuth(req, res);
    if (!actor) return;
    try {
      const result = await this.service.smartRoutePlan(
        req.query.date as string | undefined,
        actor,
      );
      res.json(result);
    } catch (e: any) {
      console.warn(`[${req.requestId}] [logistics.controller] smartRoutePlan failed`, e);
      res.status(500).json({ message: e.message });
    }
  };
}

export const logisticsController = new LogisticsController();
