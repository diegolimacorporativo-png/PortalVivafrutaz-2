/**
 * LogisticsRepository — thin data-access layer over the legacy storage facade.
 *
 * Architecture decision: this repository deliberately *delegates* to
 * `server/services/storage` instead of owning its own Drizzle queries (unlike
 * `finance.repository.ts`). The reason is strictly behaviour preservation —
 * the legacy logistics endpoints share a large surface area (routes, drivers,
 * vehicles, deliveries, audit logs, geo data) with non-logistics call sites
 * (driver panel, public tracking, checklist, etc.). Re-implementing those
 * queries here would risk subtle drift from the shared storage layer. We keep
 * this repository as a pure pass-through so the migration is a 1:1 lift-and-
 * shift; future work can incrementally pull queries down into Drizzle here.
 *
 * Rules:
 *   - NO business logic
 *   - NO transformations
 *   - NO validation
 */
import { storage } from "../../services/storage";
import type {
  LogisticsDriver,
  LogisticsVehicle,
  LogisticsRoute,
  LogisticsMaintenance,
  RouteStop,
  LogisticsAuditLog,
} from "./logistics.types";

type Storage = typeof storage;

export class LogisticsRepository {
  constructor(private readonly db: Storage = storage) {}

  // ── Drivers ────────────────────────────────────────────────────────────
  getDrivers(): Promise<LogisticsDriver[]> {
    return this.db.getDrivers();
  }
  createDriver(data: Partial<LogisticsDriver>): Promise<LogisticsDriver> {
    return this.db.createDriver(data);
  }
  updateDriver(id: number, data: Partial<LogisticsDriver>): Promise<LogisticsDriver> {
    return this.db.updateDriver(id, data);
  }
  deleteDriver(id: number): Promise<void> {
    return this.db.deleteDriver(id);
  }

  // ── Vehicles ───────────────────────────────────────────────────────────
  getVehicles(): Promise<LogisticsVehicle[]> {
    return this.db.getVehicles();
  }
  createVehicle(data: Partial<LogisticsVehicle>): Promise<LogisticsVehicle> {
    return this.db.createVehicle(data);
  }
  updateVehicle(id: number, data: Partial<LogisticsVehicle>): Promise<LogisticsVehicle> {
    return this.db.updateVehicle(id, data);
  }
  deleteVehicle(id: number): Promise<void> {
    return this.db.deleteVehicle(id);
  }

  // ── Routes ─────────────────────────────────────────────────────────────
  getRoutes(): Promise<LogisticsRoute[]> {
    return this.db.getRoutes();
  }
  createRoute(data: Partial<LogisticsRoute>): Promise<LogisticsRoute> {
    return this.db.createRoute(data);
  }
  updateRoute(id: number, data: Partial<LogisticsRoute>): Promise<LogisticsRoute> {
    return this.db.updateRoute(id, data);
  }
  deleteRoute(id: number): Promise<void> {
    return this.db.deleteRoute(id);
  }

  // ── Maintenance ────────────────────────────────────────────────────────
  getMaintenances(): Promise<LogisticsMaintenance[]> {
    return this.db.getMaintenances();
  }
  createMaintenance(
    data: Partial<LogisticsMaintenance>,
  ): Promise<LogisticsMaintenance> {
    return this.db.createMaintenance(data);
  }
  updateMaintenance(
    id: number,
    data: Partial<LogisticsMaintenance>,
  ): Promise<LogisticsMaintenance> {
    return this.db.updateMaintenance(id, data);
  }
  deleteMaintenance(id: number): Promise<void> {
    return this.db.deleteMaintenance(id);
  }

  // ── Route Stops ────────────────────────────────────────────────────────
  getRouteStops(routeId: number): Promise<RouteStop[]> {
    return this.db.getRouteStops(routeId);
  }
  createRouteStop(data: any): Promise<RouteStop> {
    return this.db.createRouteStop(data);
  }
  updateRouteStop(id: number, data: any): Promise<RouteStop> {
    return this.db.updateRouteStop(id, data);
  }
  deleteRouteStop(id: number): Promise<void> {
    return this.db.deleteRouteStop(id);
  }

  // ── Audit ──────────────────────────────────────────────────────────────
  getLogisticsAuditLogs(filters?: {
    modulo?: string;
    usuarioId?: number;
    limit?: number;
  }): Promise<LogisticsAuditLog[]> {
    return this.db.getLogisticsAuditLogs(filters);
  }

  // ── Cross-cutting reads ────────────────────────────────────────────────
  getCompanies() {
    return this.db.getCompanies();
  }
  getOrders() {
    return this.db.getOrders();
  }
  getDeliveries(filters?: {
    companyId?: number;
    driverId?: number;
    routeId?: number;
    status?: string;
    date?: string;
  }) {
    return this.db.getDeliveries(filters);
  }
  getUser(id: number) {
    return this.db.getUser(id);
  }

  // ── Logging ────────────────────────────────────────────────────────────
  log(params: {
    action: string;
    description: string;
    userId?: number;
    userEmail?: string;
    userRole?: string;
  }) {
    return this.db.createLog(params as any);
  }
}

export const logisticsRepository = new LogisticsRepository();
