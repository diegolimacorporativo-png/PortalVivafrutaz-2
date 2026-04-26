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
 *   2. session-only     → 401 "Não autenticado" or "Não autorizado"
 *      (route-assistant uses "Não autorizado", others use "Não autenticado").
 *
 *   3. admin-only       → 401 "Não autenticado" / 403 "Acesso negado.
 *      Apenas administradores logísticos." (audit-logs).
 *      Allowed roles: MASTER, ADMIN, DIRECTOR, LOGISTICS, DEVELOPER.
 *
 *   4. no auth at all   → calculate-distance, route-stops CRUD, geo/cep,
 *      smart-search, best-driver, route-insertion.
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
import { calculateETA, summariseETA } from "./eta.service";
import { LogisticsService, logisticsService } from "./logistics.service";
import {
  LOGISTICS_ADMIN_ROLES,
  LOGISTICS_AUTH_ROLES,
  type ActorRef,
} from "./logistics.types";

/** Drizzle's `db.execute` returns either { rows } or an array depending on driver. */
function rowsOf<T = any>(r: any): T[] {
  return Array.isArray(r) ? r : (r?.rows ?? []);
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

  createDriver = async (req: Request, res: Response) => {
    const user = await this.logAuth(req, res);
    if (!user) return;
    try {
      const driver = await this.service.createDriver(req.body, user);
      res.json(driver);
    } catch (e: any) {
      console.warn(`[${req.requestId}] [logistics.controller] createDriver failed`, e);
      // Preserve legacy: BadRequestError → 400; everything else → 500.
      if (e?.status === 400) {
        return res.status(400).json({ message: e.message });
      }
      res.status(500).json({ message: e?.message || "Erro" });
    }
  };

  updateDriver = async (req: Request, res: Response) => {
    const user = await this.logAuth(req, res);
    if (!user) return;
    try {
      res.json(
        await this.service.updateDriver(parseInt(req.params.id as string), req.body),
      );
    } catch (err) {
      console.warn(`[${req.requestId}] [logistics.controller] updateDriver failed`, err);
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
      if (e?.status === 400) {
        return res.status(400).json({ message: e.message });
      }
      res.status(500).json({ message: e?.message || "Erro" });
    }
  };

  updateVehicle = async (req: Request, res: Response) => {
    const user = await this.logAuth(req, res);
    if (!user) return;
    try {
      res.json(
        await this.service.updateVehicle(parseInt(req.params.id as string), req.body),
      );
    } catch (err) {
      console.warn(`[${req.requestId}] [logistics.controller] updateVehicle failed`, err);
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
      if (e?.status === 400) {
        return res.status(400).json({ message: e.message });
      }
      res.status(500).json({ message: e?.message || "Erro" });
    }
  };

  updateRoute = async (req: Request, res: Response) => {
    const user = await this.logAuth(req, res);
    if (!user) return;
    try {
      res.json(
        await this.service.updateRoute(parseInt(req.params.id as string), req.body),
      );
    } catch (err) {
      console.warn(`[${req.requestId}] [logistics.controller] updateRoute failed`, err);
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
      if (e?.status === 400) {
        return res.status(400).json({ message: e.message });
      }
      res.status(500).json({ message: e?.message || "Erro" });
    }
  };

  updateMaintenance = async (req: Request, res: Response) => {
    const user = await this.logAuth(req, res);
    if (!user) return;
    try {
      res.json(
        await this.service.updateMaintenance(parseInt(req.params.id as string), req.body),
      );
    } catch (err) {
      console.warn(`[${req.requestId}] [logistics.controller] updateMaintenance failed`, err);
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
    if (this.requireSession(req, res, "Não autorizado") === null) return;
    try {
      const result = await this.service.routeAssistant(
        req.query as { day?: string; date?: string },
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
      if (this.requireSession(req, res) === null) return;
      const result = await this.service.suggestRoute(req.body);
      res.json(result);
    } catch (e: any) {
      console.warn(`[${req.requestId}] [logistics.controller] suggestRoute failed`, e);
      if (e?.status === 400) {
        return res.status(400).json({ message: e.message });
      }
      res.status(500).json({ message: e.message });
    }
  };

  // ── DAY ORDERS ─────────────────────────────────────────────────────────
  dayOrders = async (req: Request, res: Response) => {
    try {
      if (this.requireSession(req, res) === null) return;
      const result = await this.service.dayOrders(
        req.query as { date?: string },
      );
      res.json(result);
    } catch (e: any) {
      console.warn(`[${req.requestId}] [logistics.controller] dayOrders failed`, e);
      if (e?.status === 400) {
        return res.status(400).json({ message: e.message });
      }
      res.status(500).json({ message: e.message });
    }
  };

  // ── SIMULATE DAY ───────────────────────────────────────────────────────
  simulateDay = async (req: Request, res: Response) => {
    try {
      if (this.requireSession(req, res) === null) return;
      const result = await this.service.simulateDay(req.body);
      res.json(result);
    } catch (e: any) {
      console.warn(`[${req.requestId}] [logistics.controller] simulateDay failed`, e);
      if (e?.status === 400) {
        return res.status(400).json({ message: e.message });
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
      if (this.requireSession(req, res) === null) return;
      // Legacy additionally re-resolved the actor and 401s if missing.
      const actor = await (this.service as any).repo.getUser(
        (req as any).session.userId,
      );
      if (!actor) {
        return res.status(401).json({ message: "Não autenticado" });
      }
      const result = await this.service.deliveriesReport(
        req.query as any,
      );
      res.json(result);
    } catch (e: any) {
      console.warn(`[${req.requestId}] [logistics.controller] deliveriesReport failed`, e);
      res.status(500).json({ message: e.message });
    }
  };

  // ── ROUTE STOPS (no auth) ──────────────────────────────────────────────
  listRouteStops = async (req: Request, res: Response) => {
    try {
      const stops = await this.service.getRouteStops(
        Number(req.params.routeId as string),
      );
      res.json(stops);
    } catch (e: any) {
      console.warn(`[${req.requestId}] [logistics.controller] listRouteStops failed`, e);
      res.status(500).json({ message: e.message });
    }
  };

  createRouteStop = async (req: Request, res: Response) => {
    try {
      const stop = await this.service.createRouteStop(
        Number(req.params.routeId as string),
        req.body,
      );
      res.json(stop);
    } catch (e: any) {
      console.warn(`[${req.requestId}] [logistics.controller] createRouteStop failed`, e);
      res.status(500).json({ message: e.message });
    }
  };

  updateRouteStop = async (req: Request, res: Response) => {
    try {
      const stop = await this.service.updateRouteStop(
        Number(req.params.stopId as string),
        req.body,
      );
      res.json(stop);
    } catch (e: any) {
      console.warn(`[${req.requestId}] [logistics.controller] updateRouteStop failed`, e);
      res.status(500).json({ message: e.message });
    }
  };

  deleteRouteStop = async (req: Request, res: Response) => {
    try {
      await this.service.deleteRouteStop(Number(req.params.stopId as string));
      res.json({ ok: true });
    } catch (e: any) {
      console.warn(`[${req.requestId}] [logistics.controller] deleteRouteStop failed`, e);
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

  // ── SMART SEARCH (no auth) ─────────────────────────────────────────────
  smartSearch = async (req: Request, res: Response) => {
    try {
      const q = String(req.query.q || "");
      const result = await this.service.smartSearch(q);
      res.json(result);
    } catch (e: any) {
      console.warn(`[${req.requestId}] [logistics.controller] smartSearch failed`, e);
      if (e?.status === 400) {
        return res.status(400).json({ message: e.message });
      }
      res.status(500).json({ message: e.message });
    }
  };

  // ── BEST DRIVER (no auth) ──────────────────────────────────────────────
  bestDriver = async (req: Request, res: Response) => {
    try {
      const result = await this.service.bestDriver(
        req.query.date as string | undefined,
      );
      res.json(result);
    } catch (e: any) {
      console.warn(`[${req.requestId}] [logistics.controller] bestDriver failed`, e);
      res.status(500).json({ message: e.message });
    }
  };

  // ── ROUTE INSERTION (no auth) ──────────────────────────────────────────
  routeInsertion = async (req: Request, res: Response) => {
    try {
      const result = await this.service.routeInsertion(req.body);
      res.json(result);
    } catch (e: any) {
      console.warn(`[${req.requestId}] [logistics.controller] routeInsertion failed`, e);
      if (e?.status === 400) {
        return res.status(400).json({ message: e.message });
      }
      res.status(500).json({ message: e.message });
    }
  };

  // ── ROUTE TRACKING (no auth — admin / driver / customer share this) ───
  /**
   * GET /api/logistics/track/:routeId — read-only aggregator that joins:
   *   • logistics_routes  → route header + driver assignment
   *   • logistics_drivers → driver name/phone (LEFT JOIN, may be null)
   *   • route_stops       → ordered sequence (by ordem_parada)
   *   • deliveries        → status overlay per stop (route_position order)
   *   • driver_gps_positions → latest GPS ping for the assigned driver
   *
   * No new tables, no new schema. Public endpoint by design — the same URL
   * is consumed by the admin map, the driver app, and the customer tracking
   * page. See STEP 8.4 spec: "✔ cliente usa delivery.route_id; chama mesmo
   * endpoint".
   */
  routeTracking = async (req: Request, res: Response) => {
    try {
      const routeId = Number(req.params.routeId);
      if (!Number.isFinite(routeId) || routeId <= 0) {
        return res.status(400).json({ error: "Invalid routeId" });
      }

      // 1. Route header + driver (LEFT JOIN — route may have no driver yet)
      const routeRows = rowsOf<any>(await db.execute(sql`
        SELECT lr.id,
               lr.driver_id,
               lr.vehicle_id,
               lr.status,
               lr.delivery_date,
               lr.name           AS route_name,
               ld.name           AS driver_name,
               ld.phone          AS driver_phone
        FROM logistics_routes lr
        LEFT JOIN logistics_drivers ld ON ld.id = lr.driver_id
        WHERE lr.id = ${routeId}
        LIMIT 1
      `));
      const route = routeRows[0];
      if (!route) return res.status(404).json({ error: "Route not found" });

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
               c.company_name AS company_name
        FROM deliveries d
        LEFT JOIN companies c ON c.id = d.company_id
        WHERE d.route_id = ${routeId}
        ORDER BY d.route_position ASC NULLS LAST, d.id ASC
      `));

      // 4. Latest GPS ping (only if driver assigned)
      let driverPosition: any = null;
      if (route.driver_id) {
        const gpsRows = rowsOf<any>(await db.execute(sql`
          SELECT latitude, longitude, accuracy, speed, heading, recorded_at
          FROM driver_gps_positions
          WHERE driver_id = ${route.driver_id}
          ORDER BY recorded_at DESC
          LIMIT 1
        `));
        const g = gpsRows[0];
        if (g) {
          driverPosition = {
            lat: g.latitude,
            lng: g.longitude,
            accuracy: g.accuracy,
            speed: g.speed,
            heading: g.heading,
            updatedAt: g.recorded_at,
          };
        }
      }

      // 5. Compute ETA per stop in memory.
      // Prefer route_stops for the sequence (richer, ordemParada-based);
      // if there are none, fall back to deliveries ordered by route_position
      // so the customer ETA still works on routes that don't yet have
      // route_stops materialised.
      const now = new Date();
      const etaSourceFromStops = stops.map((s) => ({
        ...s,
        // Match a delivery by company so dwell time is skipped for delivered ones.
        status: deliveries.find((d) => d.company_id === s.company_id)?.status,
        tempoEstimadoMin: s.tempo_estimado_min,
      }));
      const etaSourceFromDeliveries = deliveries.map((d) => ({
        ...d,
        tempoEstimadoMin: null,
      }));
      const useStops = etaSourceFromStops.length > 0;
      const etaSource = useStops ? etaSourceFromStops : etaSourceFromDeliveries;
      const etaResults = calculateETA(etaSource, driverPosition, now);
      const etaSummary = summariseETA(etaResults, now);

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
            distanceKm: etaResults[i]?.distanceKm ?? 0,
            legMinutes: etaResults[i]?.legMinutes ?? 0,
            etaMinutes: etaResults[i]?.etaMinutes ?? 0,
            etaTime: etaResults[i]?.etaTime ?? null,
          }))
        : [];

      const deliveriesOut = deliveries.map((d, i) => {
        // When ETA was computed off the deliveries array, attach per-row.
        const etaRow = !useStops ? etaResults[i] : undefined;
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
          // ETA — when stops drove the calc, mirror the matching stop's ETA
          // so the customer page gets a number even when there are no
          // route_stops rows enriched on this delivery.
          etaMinutes: etaRow
            ? etaRow.etaMinutes
            : (() => {
                const matched = etaResults.find(
                  (r: any) => r.company_id === d.company_id,
                );
                return matched?.etaMinutes ?? null;
              })(),
          etaTime: etaRow
            ? etaRow.etaTime
            : (() => {
                const matched = etaResults.find(
                  (r: any) => r.company_id === d.company_id,
                );
                return matched?.etaTime ?? null;
              })(),
        };
      });

      res.json({
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
        eta: etaSummary,
      });
    } catch (e: any) {
      console.warn(`[${(req as any).requestId}] [logistics.controller] routeTracking failed`, e);
      res.status(500).json({ error: e?.message || "Erro" });
    }
  };

  // ── SMART ROUTE PLAN ───────────────────────────────────────────────────
  smartRoutePlan = async (req: Request, res: Response) => {
    if (this.requireSession(req, res) === null) return;
    try {
      const result = await this.service.smartRoutePlan(
        req.query.date as string | undefined,
      );
      res.json(result);
    } catch (e: any) {
      console.warn(`[${req.requestId}] [logistics.controller] smartRoutePlan failed`, e);
      res.status(500).json({ message: e.message });
    }
  };
}

export const logisticsController = new LogisticsController();
