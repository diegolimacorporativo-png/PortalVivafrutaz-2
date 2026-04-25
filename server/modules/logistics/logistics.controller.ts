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
 */
import type { Request, Response } from "express";
import { LogisticsService, logisticsService } from "./logistics.service";
import {
  LOGISTICS_ADMIN_ROLES,
  LOGISTICS_AUTH_ROLES,
  type ActorRef,
} from "./logistics.types";

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
    } catch {
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
    } catch {
      res.status(500).json({ message: "Erro" });
    }
  };

  deleteDriver = async (req: Request, res: Response) => {
    const user = await this.logAuth(req, res);
    if (!user) return;
    try {
      await this.service.deleteDriver(parseInt(req.params.id as string));
      res.json({ ok: true });
    } catch {
      res.status(500).json({ message: "Erro" });
    }
  };

  // ── VEHICLES ───────────────────────────────────────────────────────────
  listVehicles = async (req: Request, res: Response) => {
    const user = await this.logAuth(req, res);
    if (!user) return;
    try {
      res.json(await this.service.listVehicles());
    } catch {
      res.status(500).json({ message: "Erro" });
    }
  };

  createVehicle = async (req: Request, res: Response) => {
    const user = await this.logAuth(req, res);
    if (!user) return;
    try {
      res.json(await this.service.createVehicle(req.body, user));
    } catch (e: any) {
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
    } catch {
      res.status(500).json({ message: "Erro" });
    }
  };

  deleteVehicle = async (req: Request, res: Response) => {
    const user = await this.logAuth(req, res);
    if (!user) return;
    try {
      await this.service.deleteVehicle(parseInt(req.params.id as string));
      res.json({ ok: true });
    } catch {
      res.status(500).json({ message: "Erro" });
    }
  };

  // ── ROUTES ─────────────────────────────────────────────────────────────
  listRoutes = async (req: Request, res: Response) => {
    const user = await this.logAuth(req, res);
    if (!user) return;
    try {
      res.json(await this.service.listRoutes());
    } catch {
      res.status(500).json({ message: "Erro" });
    }
  };

  createRoute = async (req: Request, res: Response) => {
    const user = await this.logAuth(req, res);
    if (!user) return;
    try {
      res.json(await this.service.createRoute(req.body, user));
    } catch (e: any) {
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
    } catch {
      res.status(500).json({ message: "Erro" });
    }
  };

  deleteRoute = async (req: Request, res: Response) => {
    const user = await this.logAuth(req, res);
    if (!user) return;
    try {
      await this.service.deleteRoute(parseInt(req.params.id as string));
      res.json({ ok: true });
    } catch {
      res.status(500).json({ message: "Erro" });
    }
  };

  // ── MAINTENANCE ────────────────────────────────────────────────────────
  listMaintenance = async (req: Request, res: Response) => {
    const user = await this.logAuth(req, res);
    if (!user) return;
    try {
      res.json(await this.service.listMaintenance());
    } catch {
      res.status(500).json({ message: "Erro" });
    }
  };

  createMaintenance = async (req: Request, res: Response) => {
    const user = await this.logAuth(req, res);
    if (!user) return;
    try {
      res.json(await this.service.createMaintenance(req.body, user));
    } catch (e: any) {
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
    } catch {
      res.status(500).json({ message: "Erro" });
    }
  };

  deleteMaintenance = async (req: Request, res: Response) => {
    const user = await this.logAuth(req, res);
    if (!user) return;
    try {
      await this.service.deleteMaintenance(parseInt(req.params.id as string));
      res.json({ ok: true });
    } catch {
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
      console.error("Route assistant error:", e);
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
      res.status(500).json({ message: e.message });
    }
  };

  deleteRouteStop = async (req: Request, res: Response) => {
    try {
      await this.service.deleteRouteStop(Number(req.params.stopId as string));
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  };

  // ── GEO CEP (no auth) ──────────────────────────────────────────────────
  geoCep = async (req: Request, res: Response) => {
    try {
      const result = await this.service.geoCep(req.params.cep as string);
      res.json(result);
    } catch (e: any) {
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
      res.status(500).json({ message: e.message });
    }
  };

  // ── ROUTE INSERTION (no auth) ──────────────────────────────────────────
  routeInsertion = async (req: Request, res: Response) => {
    try {
      const result = await this.service.routeInsertion(req.body);
      res.json(result);
    } catch (e: any) {
      if (e?.status === 400) {
        return res.status(400).json({ message: e.message });
      }
      res.status(500).json({ message: e.message });
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
      res.status(500).json({ message: e.message });
    }
  };
}

export const logisticsController = new LogisticsController();
