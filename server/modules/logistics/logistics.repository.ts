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
  getDriversSafe(empresaId: number): Promise<LogisticsDriver[]> {
    return this.db.getDriversSafe(empresaId);
  }
  createDriver(data: Partial<LogisticsDriver>): Promise<LogisticsDriver> {
    return this.db.createDriver(data);
  }
  updateDriver(id: number, data: Partial<LogisticsDriver>): Promise<LogisticsDriver> {
    return this.db.updateDriver(id, data);
  }
  updateDriverOwned(id: number, empresaId: number, data: Partial<LogisticsDriver>): Promise<LogisticsDriver | null> {
    return this.db.updateDriverOwned(id, empresaId, data);
  }
  deleteDriver(id: number): Promise<void> {
    return this.db.deleteDriver(id);
  }
  deleteDriverOwned(id: number, empresaId: number): Promise<boolean> {
    return this.db.deleteDriverOwned(id, empresaId);
  }

  // ── Vehicles ───────────────────────────────────────────────────────────
  getVehicles(): Promise<LogisticsVehicle[]> {
    return this.db.getVehicles();
  }
  getVehiclesSafe(empresaId: number): Promise<LogisticsVehicle[]> {
    return this.db.getVehiclesSafe(empresaId);
  }
  createVehicle(data: Partial<LogisticsVehicle>): Promise<LogisticsVehicle> {
    return this.db.createVehicle(data);
  }
  updateVehicle(id: number, data: Partial<LogisticsVehicle>): Promise<LogisticsVehicle> {
    return this.db.updateVehicle(id, data);
  }
  updateVehicleOwned(id: number, empresaId: number, data: Partial<LogisticsVehicle>): Promise<LogisticsVehicle | null> {
    return this.db.updateVehicleOwned(id, empresaId, data);
  }
  deleteVehicle(id: number): Promise<void> {
    return this.db.deleteVehicle(id);
  }
  deleteVehicleOwned(id: number, empresaId: number): Promise<boolean> {
    return this.db.deleteVehicleOwned(id, empresaId);
  }

  // ── Routes ─────────────────────────────────────────────────────────────
  getRoutes(): Promise<LogisticsRoute[]> {
    return this.db.getRoutes();
  }
  getRoutesSafe(empresaId: number): Promise<LogisticsRoute[]> {
    return this.db.getRoutesSafe(empresaId);
  }
  createRoute(data: Partial<LogisticsRoute>): Promise<LogisticsRoute> {
    return this.db.createRoute(data);
  }
  updateRoute(id: number, data: Partial<LogisticsRoute>): Promise<LogisticsRoute> {
    return this.db.updateRoute(id, data);
  }
  updateRouteOwned(id: number, empresaId: number, data: Partial<LogisticsRoute>): Promise<LogisticsRoute | null> {
    return this.db.updateRouteOwned(id, empresaId, data);
  }
  deleteRoute(id: number): Promise<void> {
    return this.db.deleteRoute(id);
  }
  deleteRouteOwned(id: number, empresaId: number): Promise<boolean> {
    return this.db.deleteRouteOwned(id, empresaId);
  }

  // ── Maintenance ────────────────────────────────────────────────────────
  getMaintenances(): Promise<LogisticsMaintenance[]> {
    return this.db.getMaintenances();
  }
  getMaintenancesSafe(empresaId: number): Promise<LogisticsMaintenance[]> {
    return this.db.getMaintenancesSafe(empresaId);
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
  updateMaintenanceOwned(id: number, empresaId: number, data: Partial<LogisticsMaintenance>): Promise<LogisticsMaintenance | null> {
    return this.db.updateMaintenanceOwned(id, empresaId, data);
  }
  deleteMaintenance(id: number): Promise<void> {
    return this.db.deleteMaintenance(id);
  }
  deleteMaintenanceOwned(id: number, empresaId: number): Promise<boolean> {
    return this.db.deleteMaintenanceOwned(id, empresaId);
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
