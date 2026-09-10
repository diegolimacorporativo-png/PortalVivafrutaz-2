/**
 * Logistics router — wires HTTP method+path → controller methods.
 *
 * Architecture decision: NO router-wide `requireAuth`. The legacy logistics
 * surface uses four different auth strategies (admin-only, role-based,
 * session-only, none) and each controller method enforces its own gate so
 * behaviour is preserved EXACTLY. See `logistics.controller.ts` for the
 * detailed per-endpoint mapping.
 *
 * Static routes are listed before dynamic ones (`/routes` before
 * `/routes/:id`, `/routes/:routeId/stops` before `/routes/:routeId/stops/:stopId`).
 * Express will match the most specific route first regardless of order, but
 * keeping the file readable matters for the next maintainer.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { logisticsController } from "./logistics.controller";
import {
  requireActiveSubscription,
  checkPlanLimit,
} from "../billing/subscription.middleware";
import { tenantContext } from "../../middleware/tenant";
import { currentTenantId } from "../../core/tenant/context";
import { requireAuth as requireAuthCore } from "../../core/http/requireAuth";
import {
  createPublicTrackingToken,
} from "../../core/security/publicTrackingToken";
import { publicTrackingLimiter } from "../../core/security/rateLimit";
import { storage } from "../../services/storage";
import { LOGISTICS_AUTH_ROLES } from "./logistics.types";

const router = Router();

// FASE 1 — defesa em camadas. Instala TenantContext (AsyncLocalStorage)
// quando há sessão, sem alterar respostas existentes: se a sessão estiver
// ausente, cai direto nos controllers (que respondem com as mensagens
// legadas "Não autenticado"/"Não autorizado" exatamente como antes).
router.use((req: Request, res: Response, next: NextFunction) => {
  const session = (req as any).session;
  if (!session?.userId && !session?.companyId) return next();
  return tenantContext(req, res, next);
});

// ── Drivers ────────────────────────────────────────────────────────────
router.get("/drivers", logisticsController.listDrivers);
router.get("/drivers/gps", logisticsController.listLiveDriverLocations);
router.post(
  "/drivers",
  requireActiveSubscription,
  checkPlanLimit("motoristas"),
  logisticsController.createDriver,
);
router.patch("/drivers/:id", logisticsController.updateDriver);
router.delete("/drivers/:id", logisticsController.deleteDriver);

// ── Vehicles ───────────────────────────────────────────────────────────
router.get("/vehicles", logisticsController.listVehicles);
router.post(
  "/vehicles",
  requireActiveSubscription,
  logisticsController.createVehicle,
);
router.patch("/vehicles/:id", logisticsController.updateVehicle);
router.delete("/vehicles/:id", logisticsController.deleteVehicle);

// ── Routes (static FIRST, dynamic LAST) ────────────────────────────────
router.get("/routes", logisticsController.listRoutes);
router.post(
  "/routes",
  requireActiveSubscription,
  checkPlanLimit("rotas"),
  logisticsController.createRoute,
);
router.get("/routes/:routeId/stops", logisticsController.listRouteStops);
router.post(
  "/routes/:routeId/stops",
  requireActiveSubscription,
  logisticsController.createRouteStop,
);
router.patch(
  "/routes/:routeId/stops/:stopId",
  logisticsController.updateRouteStop,
);
router.delete(
  "/routes/:routeId/stops/:stopId",
  logisticsController.deleteRouteStop,
);
router.patch("/routes/:id", logisticsController.updateRoute);
router.delete("/routes/:id", logisticsController.deleteRoute);

// ── Maintenance ────────────────────────────────────────────────────────
router.get("/maintenance", logisticsController.listMaintenance);
router.post(
  "/maintenance",
  requireActiveSubscription,
  logisticsController.createMaintenance,
);
router.patch("/maintenance/:id", logisticsController.updateMaintenance);
router.delete("/maintenance/:id", logisticsController.deleteMaintenance);

// ── Analytical / planning endpoints ────────────────────────────────────
router.get("/route-assistant", logisticsController.routeAssistant);
router.post("/suggest-route", logisticsController.suggestRoute);
router.get("/day-orders", logisticsController.dayOrders);
router.post("/simulate-day", logisticsController.simulateDay);
router.post("/calculate-distance", logisticsController.calculateDistance);
router.get("/audit-logs", logisticsController.auditLogs);
router.get("/reports/deliveries", logisticsController.deliveriesReport);
router.get("/geo/cep/:cep", logisticsController.geoCep);
router.get("/smart-search", logisticsController.smartSearch);
router.get("/best-driver", logisticsController.bestDriver);
router.post("/route-insertion", logisticsController.routeInsertion);
router.get("/smart-route-plan", logisticsController.smartRoutePlan);

// ── Real-time tracking aggregator (admin / driver / customer share) ────
router.post("/track/token", requireAuthCore, async (req: Request, res: Response) => {
  try {
    const actor = await storage.getUser((req as any).session.userId);
    if (!actor || !(LOGISTICS_AUTH_ROLES as readonly string[]).includes(actor.role)) {
      return res.status(403).json({ message: "Sem permissão" });
    }

    const routeId = Number((req as any).body?.routeId);
    if (!Number.isInteger(routeId) || routeId <= 0) {
      return res.status(400).json({ message: "Rota inválida" });
    }

    const tenantId = currentTenantId();
    const route = tenantId != null
      ? await storage.getRouteForCompany(routeId, tenantId)
      : await storage.getRoute(routeId);
    if (!route) return res.status(404).json({ message: "Rota não encontrada" });

    const issued = createPublicTrackingToken("route", routeId);
    return res.json({
      token: issued.token,
      expiresAt: issued.expiresAt,
      path: `/driver-map/${issued.token}`,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error?.message || "Erro" });
  }
});

router.get(
  "/track/:token",
  publicTrackingLimiter,
  logisticsController.routeTracking,
);

export const logisticsRouter = router;
