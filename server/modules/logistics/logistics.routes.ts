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
import { Router } from "express";
import { logisticsController } from "./logistics.controller";

const router = Router();

// ── Drivers ────────────────────────────────────────────────────────────
router.get("/drivers", logisticsController.listDrivers);
router.post("/drivers", logisticsController.createDriver);
router.patch("/drivers/:id", logisticsController.updateDriver);
router.delete("/drivers/:id", logisticsController.deleteDriver);

// ── Vehicles ───────────────────────────────────────────────────────────
router.get("/vehicles", logisticsController.listVehicles);
router.post("/vehicles", logisticsController.createVehicle);
router.patch("/vehicles/:id", logisticsController.updateVehicle);
router.delete("/vehicles/:id", logisticsController.deleteVehicle);

// ── Routes (static FIRST, dynamic LAST) ────────────────────────────────
router.get("/routes", logisticsController.listRoutes);
router.post("/routes", logisticsController.createRoute);
router.get("/routes/:routeId/stops", logisticsController.listRouteStops);
router.post("/routes/:routeId/stops", logisticsController.createRouteStop);
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
router.post("/maintenance", logisticsController.createMaintenance);
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

export const logisticsRouter = router;
