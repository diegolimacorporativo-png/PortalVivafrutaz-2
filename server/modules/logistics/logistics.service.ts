/**
 * LogisticsService — pure business logic (no Express).
 *
 * Every method here is a verbatim port of the corresponding inline handler in
 * `server/routes/routes.ts`. Behaviour, response shape, error messages and
 * field names are preserved exactly. Errors that map to HTTP semantics are
 * thrown as `AppError` subclasses and let the controller / global error
 * middleware translate them.
 *
 * External integrations (viacep, nominatim, routeOptimizer) are imported
 * dynamically — same pattern as the legacy code — so test runs that don't
 * exercise those paths don't pay the import cost.
 */
import { LogisticsRepository, logisticsRepository } from "./logistics.repository";
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from "../../shared/errors/AppError";
import { currentTenantId } from "../../core/tenant/context";
import { GLOBAL_SCOPE_ROLES, roleCanViewGps } from "@shared/user-roles";
import { LOGISTICS_AUTH_ROLES } from "./logistics.types";
import { dateInTimeZone } from "./local-date";
import type {
  ActorRef,
  CalculateDistanceInput,
  DayOrderEntry,
  DayOrdersResponse,
  DeliveriesReportFilters,
  GeoCepResponse,
  LogisticsAuditLog,
  LogisticsDriver,
  LogisticsMaintenance,
  LogisticsRoute,
  LogisticsVehicle,
  RouteAssistantItem,
  RouteStop,
  SmartSearchResult,
  SuggestRouteInput,
} from "./logistics.types";

const ROUTE_STOP_FIELDS = [
  "cep",
  "endereco",
  "numero",
  "cidade",
  "estado",
  "latitude",
  "longitude",
  "ordemParada",
  "janelainicio",
  "janelaFim",
  "tempoEstimadoMin",
] as const;

function pickRouteStopFields(body: any): Record<string, unknown> {
  const source = body && typeof body === "object" ? body : {};
  return Object.fromEntries(
    ROUTE_STOP_FIELDS
      .filter((field) => Object.prototype.hasOwnProperty.call(source, field))
      .map((field) => [field, source[field]]),
  );
}

const DRIVER_EDITABLE_FIELDS = [
  "name",
  "cpf",
  "phone",
  "email",
  "licenseNumber",
  "active",
  "notes",
] as const;

const VEHICLE_EDITABLE_FIELDS = [
  "plate",
  "model",
  "brand",
  "year",
  "type",
  "capacity",
  "active",
  "notes",
] as const;

const ROUTE_EDITABLE_FIELDS = [
  "name",
  "driverId",
  "driverName",
  "vehicleId",
  "vehiclePlate",
  "deliveryDate",
  "status",
  "companyIds",
  "companyNames",
  "notes",
  "startTime",
  "endTime",
] as const;

const MAINTENANCE_EDITABLE_FIELDS = [
  "vehicleId",
  "vehiclePlate",
  "type",
  "description",
  "cost",
  "scheduledDate",
  "completedDate",
  "status",
  "notes",
] as const;

function pickEditableFields(
  body: unknown,
  fields: readonly string[],
): Record<string, unknown> {
  const source = body && typeof body === "object" && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {};

  return Object.fromEntries(
    fields
      .filter((field) => Object.prototype.hasOwnProperty.call(source, field))
      .map((field) => [field, source[field]])
      .filter(([, value]) => value !== undefined),
  );
}

function normalizeOptionalId(
  value: unknown,
  label: string,
): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "" || value === "none") return null;
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new BadRequestError(`${label} inválido`);
  }
  return id;
}

export class LogisticsService {
  constructor(private readonly repo: LogisticsRepository = logisticsRepository) {}

  private actorTenant(actor?: ActorRef): number | null {
    const contextTenant = currentTenantId();
    if (contextTenant != null) return contextTenant;
    return actor?.empresaId == null ? null : Number(actor.empresaId);
  }

  private async validateDriverReference(
    driverId: number | null | undefined,
    tenantId: number | null,
  ): Promise<void> {
    if (driverId == null) return;
    const drivers = tenantId == null
      ? await this.repo.getDrivers()
      : await this.repo.getDriversSafe(tenantId);
    const driver = (drivers as any[]).find((item) => Number(item.id) === driverId);
    if (!driver || (tenantId != null && Number(driver.empresaId) !== tenantId)) {
      throw new ForbiddenError("Motorista não pertence ao tenant autorizado.");
    }
  }

  private async validateVehicleReference(
    vehicleId: number | null | undefined,
    tenantId: number | null,
  ): Promise<void> {
    if (vehicleId == null) return;
    const vehicles = tenantId == null
      ? await this.repo.getVehicles()
      : await this.repo.getVehiclesSafe(tenantId);
    const vehicle = (vehicles as any[]).find((item) => Number(item.id) === vehicleId);
    if (!vehicle || (tenantId != null && Number(vehicle.empresaId) !== tenantId)) {
      throw new ForbiddenError("Veículo não pertence ao tenant autorizado.");
    }
  }

  private async validateCompanyReferences(
    companyIds: unknown,
    tenantId: number | null,
  ): Promise<number[] | undefined> {
    if (companyIds === undefined) return undefined;
    if (!Array.isArray(companyIds)) {
      throw new BadRequestError("companyIds inválido");
    }

    const ids = companyIds.map((value) => {
      const id = Number(value);
      if (!Number.isInteger(id) || id <= 0) {
        throw new BadRequestError("companyIds inválido");
      }
      return id;
    });
    const companies = tenantId == null
      ? await this.repo.getCompanies()
      : [await this.repo.getCompany(tenantId)];
    const allowedIds = new Set(
      (companies as any[]).filter(Boolean).map((company) => Number(company.id)),
    );
    if (ids.some((id) => !allowedIds.has(id))) {
      throw new ForbiddenError("Empresa não pertence ao tenant autorizado.");
    }
    return ids;
  }

  private analyticsScope(
    actor: ActorRef,
    allowMultiCompanyRead = false,
  ): { tenantId: number | null; global: boolean } {
    const contextTenant = currentTenantId();
    const actorTenant =
      actor.empresaId == null ? null : Number(actor.empresaId);

    if (contextTenant != null) {
      if (
        actorTenant != null &&
        (!Number.isInteger(contextTenant) || actorTenant !== contextTenant)
      ) {
        throw new ForbiddenError("O tenant da sessão não corresponde ao usuário.");
      }
      return { tenantId: contextTenant, global: false };
    }

    if (actorTenant != null) {
      if (!Number.isInteger(actorTenant) || actorTenant <= 0) {
        throw new ForbiddenError("Empresa do usuário inválida.");
      }
      return { tenantId: actorTenant, global: false };
    }

    // The existing explicit global-admin policy applies here. ADMIN can still
    // use a validated selected tenant; being unbound alone does not grant a
    // cross-company analytics scope. Individual write paths stay tenant-bound.
      if ((GLOBAL_SCOPE_ROLES as readonly string[]).includes(actor.role)) {
      return { tenantId: null, global: true };
    }

      if (allowMultiCompanyRead && roleCanViewGps(actor.role)) {
      return { tenantId: null, global: true };
    }

    throw new ForbiddenError(
      "Este perfil precisa estar vinculado a uma empresa.",
    );
  }

  private async visibleCompanies(scope: { tenantId: number | null; global: boolean }) {
    if (scope.global) return (await this.repo.getCompanies()) as any[];
    const company = await this.repo.getCompany(scope.tenantId!);
    return company ? [company] : [];
  }

  private visibleOrders(scope: { tenantId: number | null; global: boolean }) {
    return scope.global
      ? this.repo.getOrders()
      : this.repo.getOrdersSafe(scope.tenantId!);
  }

  private visibleDrivers(scope: { tenantId: number | null; global: boolean }) {
    return scope.global
      ? this.repo.getDrivers()
      : this.repo.getDriversSafe(scope.tenantId!);
  }

  private visibleRoutes(scope: { tenantId: number | null; global: boolean }) {
    return scope.global
      ? this.repo.getRoutes()
      : this.repo.getRoutesSafe(scope.tenantId!);
  }

  private visibleDeliveries(
    scope: { tenantId: number | null; global: boolean },
    filters: Record<string, unknown> = {},
  ) {
    return this.repo.getDeliveries(
      scope.global
        ? (filters as any)
        : ({ ...filters, companyId: scope.tenantId } as any),
    );
  }

  // ─── DRIVERS ──────────────────────────────────────────────────────────
  async listDrivers() {
    const tid = currentTenantId();
    const drivers = (await (tid
      ? this.repo.getDriversSafe(tid)
      : this.repo.getDrivers())) as any[];

    // Some installations created driver access accounts before the
    // logistics_drivers row. Keep the operational rows authoritative and add
    // read-only virtual entries for the missing accounts. They receive a
    // stable negative id so the UI cannot confuse them with a real FK.
    const getDriverAccounts = (this.repo as any).getDriverAccounts;
    if (typeof getDriverAccounts !== "function") return drivers;
    const accounts = (await getDriverAccounts.call(this.repo, tid ?? undefined)) as any[];
    const normalize = (value: unknown) =>
      String(value ?? "").trim().toLocaleLowerCase("pt-BR");
    const missingAccounts = accounts.filter((account: any) => {
      const accountEmail = normalize(account.email);
      const accountName = normalize(account.name);
      return !drivers.some((driver: any) => {
        const driverEmail = normalize(driver.email);
        const driverName = normalize(driver.name);
        return (
          (accountEmail && driverEmail === accountEmail) ||
          (accountName && driverName === accountName)
        );
      });
    });

    return [
      ...drivers,
      ...missingAccounts.map((account: any) => ({
        id: -Number(account.id),
        empresaId: account.empresaId ?? null,
        name: account.name,
        email: account.email,
        phone: null,
        cpf: null,
        licenseNumber: null,
        active: account.active !== false,
        notes: "Conta de motorista aguardando vínculo operacional",
        virtualFromUser: true,
      })),
    ];
  }

  /**
   * Lists the latest GPS position for every visible driver.
   * MASTER, ADMIN and DIRECTOR are global profiles and must not be reduced
   * to actor.empresaId. Other internal roles keep their tenant scope.
   */
  async listLiveDriverLocations(actor: ActorRef) {
    const scope = this.analyticsScope(actor, true);
    const scopedEmpresaId = scope.global ? undefined : scope.tenantId!;
    let driverRows = (await (scopedEmpresaId
      ? this.repo.getDriversSafe(scopedEmpresaId)
      : this.repo.getDrivers())) as any[];
    // Removed/deactivated drivers remain in route history but are not current
    // live-tracking targets. Keep this filtering at the API boundary as well
    // as the UI so stale records cannot reappear in a GPS client.
    driverRows = driverRows.filter((driver: any) => driver.active !== false);

    const driverUsers = ((await this.repo.getDriverAccounts(scopedEmpresaId)) as any[])
      .filter((user: any) => user.active !== false);
    const normalizeIdentity = (value: unknown) =>
      String(value ?? "").trim().toLocaleLowerCase("pt-BR");
    const matchedUserIds = new Set<number>();

    for (const driver of driverRows) {
      const operationalEmail = normalizeIdentity(driver.email);
      const operationalName = normalizeIdentity(driver.name);
      const matchedUser = driverUsers.find((user: any) =>
        (operationalEmail && normalizeIdentity(user.email) === operationalEmail) ||
        (operationalName && normalizeIdentity(user.name) === operationalName),
      );
      if (matchedUser) matchedUserIds.add(Number(matchedUser.id));
    }

    const legacyDriverRows = driverUsers
      .filter((user: any) => !matchedUserIds.has(Number(user.id)))
      .map((user: any) => ({
        id: -Number(user.id),
        name: user.name,
        email: user.email,
        phone: null,
        active: user.active,
        empresaId: user.empresaId,
        virtualFromUser: true,
      }));
    driverRows = [...driverRows, ...legacyDriverRows];

    return Promise.all(driverRows.map(async (driver: any) => {
      const position = driver.virtualFromUser
        ? null
        : await this.repo.getLatestGpsPosition(driver.id);
      return {
        driverId: driver.id,
        driverName: driver.name,
        phone: driver.phone ?? null,
        active: driver.active,
        latitude: position?.latitude ?? null,
        longitude: position?.longitude ?? null,
        accuracy: position?.accuracy ?? null,
        speed: position?.speed ?? null,
        heading: position?.heading ?? null,
        updatedAt: position?.recordedAt ?? null,
        gpsReady: !driver.virtualFromUser,
        source: driver.virtualFromUser ? "user-account" : "logistics-driver",
      };
    }));
  }

  async createDriver(
    body: any,
    actor: ActorRef,
  ): Promise<LogisticsDriver> {
    const { name, cpf, phone, email, licenseNumber, notes } = body || {};
    if (!name) throw new BadRequestError("Nome obrigatório");
    const d = await this.repo.createDriver({
      empresaId: currentTenantId() ?? actor.empresaId ?? undefined,
      name,
      cpf,
      phone,
      email,
      licenseNumber,
      notes,
      active: true,
    } as Partial<LogisticsDriver>);
    await this.repo.log({
      action: "DRIVER_CREATED",
      description: `Motorista criado: ${name}`,
      userId: actor.id,
      userEmail: actor.email ?? undefined,
      userRole: actor.role,
    });
    return d;
  }

  updateDriver(id: number, body: any, actor?: ActorRef) {
    const tid = this.actorTenant(actor);
    const payload = pickEditableFields(body, DRIVER_EDITABLE_FIELDS);
    return tid
      ? this.repo.updateDriverOwned(id, tid, payload)
      : this.repo.updateDriver(id, payload);
  }

  deleteDriver(id: number) {
    const tid = currentTenantId();
    return tid ? this.repo.deleteDriverOwned(id, tid) : this.repo.deleteDriver(id);
  }

  // ─── VEHICLES ─────────────────────────────────────────────────────────
  listVehicles() {
    const tid = currentTenantId();
    return tid ? this.repo.getVehiclesSafe(tid) : this.repo.getVehicles();
  }

  async createVehicle(
    body: any,
    actor: ActorRef,
  ): Promise<LogisticsVehicle> {
    const { plate, model, brand, year, type, capacity, notes } = body || {};
    if (!plate || !model || !brand) {
      throw new BadRequestError("Placa, modelo e marca obrigatórios");
    }
    const v = await this.repo.createVehicle({
      empresaId: currentTenantId() ?? actor.empresaId ?? undefined,
      plate: String(plate).toUpperCase(),
      model,
      brand,
      year: year ? parseInt(year) : undefined,
      type,
      capacity,
      notes,
      active: true,
    } as Partial<LogisticsVehicle>);
    await this.repo.log({
      action: "VEHICLE_CREATED",
      description: `Veículo criado: ${plate}`,
      userId: actor.id,
      userEmail: actor.email ?? undefined,
      userRole: actor.role,
    });
    return v;
  }

  updateVehicle(id: number, body: any, actor?: ActorRef) {
    const tid = this.actorTenant(actor);
    const payload = pickEditableFields(body, VEHICLE_EDITABLE_FIELDS);
    if (Object.prototype.hasOwnProperty.call(payload, "plate")) {
      payload.plate = String(payload.plate).toUpperCase();
    }
    return tid
      ? this.repo.updateVehicleOwned(id, tid, payload)
      : this.repo.updateVehicle(id, payload);
  }

  deleteVehicle(id: number) {
    const tid = currentTenantId();
    return tid ? this.repo.deleteVehicleOwned(id, tid) : this.repo.deleteVehicle(id);
  }

  // ─── ROUTES ───────────────────────────────────────────────────────────
  listRoutes() {
    const tid = currentTenantId();
    return tid ? this.repo.getRoutesSafe(tid) : this.repo.getRoutes();
  }

  async createRoute(body: any, actor: ActorRef): Promise<LogisticsRoute> {
    const {
      name,
      driverId,
      driverName,
      vehicleId,
      vehiclePlate,
      deliveryDate,
      notes,
      companyNames,
      companyIds,
      startTime,
      endTime,
    } = body || {};
    if (!name) throw new BadRequestError("Nome da rota obrigatório");
    const tenantId = this.actorTenant(actor);
    const normalizedVehicleId = normalizeOptionalId(vehicleId, "Veículo");
    await this.validateVehicleReference(normalizedVehicleId, tenantId);
    const normalizedCompanyIds = await this.validateCompanyReferences(companyIds, tenantId);
    let operationalDriverId = driverId || undefined;
    if (operationalDriverId && Number(operationalDriverId) < 0) {
      // Virtual driver entries come from user accounts that predate the
      // logistics_drivers table. Assigning a route is an explicit write, so
      // this is the safe point to materialize the operational link.
      const accountId = Math.abs(Number(operationalDriverId));
      const account = await this.repo.getUser(accountId);
      const driverTenantId = tenantId;
      if (
        !account ||
        account.active === false ||
        !["MOTORISTA", "DRIVER"].includes(account.role) ||
        (driverTenantId != null && Number(account.empresaId) !== Number(driverTenantId))
      ) {
        throw new BadRequestError("Conta de motorista inválida");
      }
      const existingDrivers = (await (driverTenantId != null
        ? this.repo.getDriversSafe(Number(driverTenantId))
        : this.repo.getDrivers())) as any[];
      const normalize = (value: unknown) =>
        String(value ?? "").trim().toLocaleLowerCase("pt-BR");
      const existing = existingDrivers.find(
        (driver: any) =>
          (account.email &&
            normalize(driver.email) === normalize(account.email)) ||
          (account.name && normalize(driver.name) === normalize(account.name)),
      );
      const linked = existing ?? (await this.repo.createDriver({
        empresaId: driverTenantId ?? account.empresaId ?? undefined,
        name: account.name,
        email: account.email,
        active: true,
        notes: "Vínculo criado ao atribuir rota à conta de motorista",
      } as Partial<LogisticsDriver>));
      operationalDriverId = linked.id;
    }

    const normalizedDriverId = normalizeOptionalId(operationalDriverId, "Motorista");
    await this.validateDriverReference(normalizedDriverId, tenantId);
    const r = await this.repo.createRoute({
      empresaId: tenantId ?? undefined,
      name,
      driverId: normalizedDriverId ?? undefined,
      driverName,
      vehicleId: normalizedVehicleId ?? undefined,
      vehiclePlate,
      deliveryDate: deliveryDate || undefined,
      companyIds: normalizedCompanyIds,
      notes,
      companyNames,
      startTime,
      endTime,
    } as Partial<LogisticsRoute>);
    await this.repo.log({
      action: "ROUTE_CREATED",
      description: `Rota criada: ${name}`,
      userId: actor.id,
      userEmail: actor.email ?? undefined,
      userRole: actor.role,
    });
    return r;
  }

  async updateRoute(id: number, body: any, actor?: ActorRef) {
    const tid = this.actorTenant(actor);
    const payload = pickEditableFields(body, ROUTE_EDITABLE_FIELDS);
    if (Object.prototype.hasOwnProperty.call(payload, "driverId")) {
      payload.driverId = normalizeOptionalId(payload.driverId, "Motorista");
      await this.validateDriverReference(payload.driverId as number | null, tid);
    }
    if (Object.prototype.hasOwnProperty.call(payload, "vehicleId")) {
      payload.vehicleId = normalizeOptionalId(payload.vehicleId, "Veículo");
      await this.validateVehicleReference(payload.vehicleId as number | null, tid);
    }
    if (Object.prototype.hasOwnProperty.call(payload, "companyIds")) {
      payload.companyIds = await this.validateCompanyReferences(payload.companyIds, tid);
    }
    return tid
      ? this.repo.updateRouteOwned(id, tid, payload)
      : this.repo.updateRoute(id, payload);
  }

  deleteRoute(id: number) {
    const tid = currentTenantId();
    return tid ? this.repo.deleteRouteOwned(id, tid) : this.repo.deleteRoute(id);
  }

  // ─── MAINTENANCE ──────────────────────────────────────────────────────
  listMaintenance() {
    const tid = currentTenantId();
    return tid ? this.repo.getMaintenancesSafe(tid) : this.repo.getMaintenances();
  }

  async createMaintenance(
    body: any,
    actor: ActorRef,
  ): Promise<LogisticsMaintenance> {
    const {
      vehicleId,
      vehiclePlate,
      type,
      description,
      cost,
      scheduledDate,
      notes,
    } = body || {};
    if (!type || !description) {
      throw new BadRequestError("Tipo e descrição obrigatórios");
    }
    const tenantId = this.actorTenant(actor);
    const normalizedVehicleId = normalizeOptionalId(vehicleId, "Veículo");
    await this.validateVehicleReference(normalizedVehicleId, tenantId);
    const m = await this.repo.createMaintenance({
      empresaId: tenantId ?? undefined,
      vehicleId: normalizedVehicleId ?? undefined,
      vehiclePlate,
      type,
      description,
      cost: cost || undefined,
      scheduledDate: scheduledDate || undefined,
      notes,
    } as Partial<LogisticsMaintenance>);
    await this.repo.log({
      action: "MAINTENANCE_CREATED",
      description: `Manutenção criada: ${type} — ${vehiclePlate}`,
      userId: actor.id,
      userEmail: actor.email ?? undefined,
      userRole: actor.role,
    });
    return m;
  }

  async updateMaintenance(id: number, body: any, actor?: ActorRef) {
    const tid = this.actorTenant(actor);
    const payload = pickEditableFields(body, MAINTENANCE_EDITABLE_FIELDS);
    if (Object.prototype.hasOwnProperty.call(payload, "vehicleId")) {
      payload.vehicleId = normalizeOptionalId(payload.vehicleId, "Veículo");
      await this.validateVehicleReference(payload.vehicleId as number | null, tid);
    }
    return tid
      ? this.repo.updateMaintenanceOwned(id, tid, payload)
      : this.repo.updateMaintenance(id, payload);
  }

  deleteMaintenance(id: number) {
    const tid = currentTenantId();
    return tid ? this.repo.deleteMaintenanceOwned(id, tid) : this.repo.deleteMaintenance(id);
  }

  // ─── ROUTE ASSISTANT ──────────────────────────────────────────────────
  async routeAssistant(
    query: { day?: string; date?: string },
    actor: ActorRef,
  ): Promise<RouteAssistantItem[]> {
    const { day, date } = query;
    const scope = this.analyticsScope(actor, true);
    const allCompanies = await this.visibleCompanies(scope);

    let companiesWithOrders: Set<number> = new Set();
    if (date) {
      const allOrders = await this.visibleOrders(scope);
      const dateStr = String(date);
      allOrders.forEach((o: any) => {
        const od = new Date(o.deliveryDate).toISOString().split("T")[0];
        if (od === dateStr && !["CANCELLED"].includes(o.status)) {
          companiesWithOrders.add(o.companyId);
        }
      });
    }

    const result: RouteAssistantItem[] = [];
    for (const c of allCompanies as any[]) {
      if (!c.active) continue;
      const ca = c as any;
      let deliveryConfig: any = {};
      try {
        if (ca.deliveryConfigJson) deliveryConfig = JSON.parse(ca.deliveryConfigJson);
      } catch {}

      let windowForDay: { startTime: string; endTime: string } | null = null;

      if (day) {
        const dayData = deliveryConfig[day as string];
        if (!dayData?.enabled) continue;
        windowForDay = {
          startTime: dayData.startTime || "08:00",
          endTime: dayData.endTime || "09:00",
        };
      } else {
        const enabledDays = Object.entries(deliveryConfig).filter(
          ([, v]: any) => v?.enabled,
        );
        if (enabledDays.length === 0) continue;
      }

      result.push({
        id: c.id,
        companyName: c.companyName,
        addressStreet: ca.addressStreet || "",
        addressNumber: ca.addressNumber || "",
        addressNeighborhood: ca.addressNeighborhood || "",
        addressCity: ca.addressCity || "",
        addressZip: ca.addressZip || "",
        latitude: ca.latitude || null,
        longitude: ca.longitude || null,
        clientType: c.clientType || "mensal",
        deliveryWindow: windowForDay,
        hasOrderForDate: date ? companiesWithOrders.has(c.id) : null,
        allowedOrderDays: c.allowedOrderDays,
      });
    }

    result.sort((a, b) => {
      const ta = a.deliveryWindow?.startTime || "99:99";
      const tb = b.deliveryWindow?.startTime || "99:99";
      return ta.localeCompare(tb);
    });

    return result;
  }

  // ─── SUGGEST ROUTE ────────────────────────────────────────────────────
  async suggestRoute(body: SuggestRouteInput, actor: ActorRef) {
    const { newPoint, date } = body || ({} as SuggestRouteInput);
    if (!newPoint?.lat || !newPoint?.lng) {
      throw new BadRequestError("Informe lat/lng do ponto de entrega");
    }
    const { suggestInsertion } = await import(
      "../../services/logistics/routeOptimizer"
    );
    const scope = this.analyticsScope(actor, true);
    const routes = await this.visibleRoutes(scope);
    const filteredRoutes = date
      ? routes.filter((r: any) => r.deliveryDate === date)
      : routes;
    const drivers = await this.visibleDrivers(scope);

    const driverRoutesMap = filteredRoutes.map((r: any) => {
      return {
        driverId: r.driverId || 0,
        driverName:
          r.driverName ||
          drivers.find((d: any) => d.id === r.driverId)?.name ||
          "Motorista",
        vehicleId: r.vehicleId || undefined,
        vehiclePlate: r.vehiclePlate || undefined,
        routeId: r.id,
        stops: [],
        totalDistance: 0,
        estimatedMinutes: 0,
      };
    });

    const suggestion = suggestInsertion(newPoint, driverRoutesMap as any);
    return { suggestion, routesAnalyzed: driverRoutesMap.length };
  }

  // ─── DAY ORDERS ───────────────────────────────────────────────────────
  async dayOrders(
    query: { date?: string },
    actor: ActorRef,
  ): Promise<DayOrdersResponse> {
    const { date } = query;
    if (!date) throw new BadRequestError("Informe a data (date)");

    const scope = this.analyticsScope(actor, true);
    const allOrders = await this.visibleOrders(scope);
    const allCompanies = await this.visibleCompanies(scope);
    const companyMap = Object.fromEntries(
      (allCompanies as any[]).map((c: any) => [c.id, c]),
    );

    const dayOrders = (allOrders as any[]).filter((o: any) => {
      if (!o.deliveryDate) return false;
      const d = new Date(o.deliveryDate);
      return d.toISOString().split("T")[0] === date;
    });

    const enriched: DayOrderEntry[] = dayOrders.map((o: any, idx: number) => {
      const company = companyMap[o.companyId] || {};
      const hasCoords = !!(company.latitude && company.longitude);
      const statusMap: Record<string, string> = {
        CONFIRMED: "pendente",
        ACTIVE: "pendente",
        LOCKED: "pendente",
        DELIVERED: "entregue",
        CANCELLED: "cancelado",
      };
      const fullAddress =
        [
          company.addressStreet,
          company.addressNumber,
          company.addressNeighborhood,
          company.addressCity,
        ]
          .filter(Boolean)
          .join(", ") || null;

      return {
        orderId: o.id,
        orderCode: o.orderCode,
        orderStatus: o.status,
        deliveryStatus: statusMap[o.status] || "pendente",
        companyId: o.companyId,
        companyName: company.companyName || `Empresa #${o.companyId}`,
        contactName: company.contactName || null,
        address: fullAddress,
        addressZip: company.addressZip || null,
        addressCity: company.addressCity || null,
        latitude: company.latitude ? parseFloat(company.latitude) : null,
        longitude: company.longitude ? parseFloat(company.longitude) : null,
        hasCoords,
        deliveryTime: company.deliveryTime || null,
        totalValue: o.totalValue,
        orderNote: o.orderNote || null,
        routePosition: idx + 1,
      };
    });

    const withCoords = enriched.filter((o) => o.hasCoords);
    const withoutCoords = enriched.filter((o) => !o.hasCoords);

    return {
      date,
      total: enriched.length,
      withCoords: withCoords.length,
      withoutCoords: withoutCoords.length,
      orders: enriched,
      activeOrders: enriched.filter((o) => o.deliveryStatus !== "cancelado"),
    };
  }

  // ─── SIMULATE DAY ─────────────────────────────────────────────────────
  async simulateDay(
    body: { date?: string; depotLat?: number; depotLng?: number },
    actor: ActorRef,
  ) {
    const { date, depotLat, depotLng } = body || {};
    if (!date) throw new BadRequestError("Informe a data de simulação");
    const scope = this.analyticsScope(actor, true);

    const { simulateRouteDay } = await import(
      "../../services/logistics/routeOptimizer"
    );

    let allDeliveries = await this.visibleDeliveries(scope, {
      date,
      status: "pendente",
    });
    const allDrivers = await this.visibleDrivers(scope);
    const drivers = (allDrivers as any[]).filter((d: any) => d.active);
    const routes = await this.visibleRoutes(scope);

    let deliveryPoints: any[] = [];
    let ordersBridged: any[] = [];
    if ((allDeliveries as any[]).length === 0) {
      const allOrders = await this.visibleOrders(scope);
      const allCompanies = await this.visibleCompanies(scope);
      const companyMap = Object.fromEntries(
        (allCompanies as any[]).map((c: any) => [c.id, c]),
      );

      const dayOrders = (allOrders as any[]).filter((o: any) => {
        if (!o.deliveryDate) return false;
        const d = new Date(o.deliveryDate);
        return (
          d.toISOString().split("T")[0] === date &&
          !["CANCELLED"].includes(o.status)
        );
      });

      dayOrders.forEach((o: any) => {
        const company = companyMap[o.companyId] || {};
        const fullAddr = [
          company.addressStreet,
          company.addressNumber,
          company.addressCity,
        ]
          .filter(Boolean)
          .join(", ");
        const entry = {
          orderId: o.id,
          orderCode: o.orderCode,
          companyId: o.companyId,
          companyName: company.companyName || `Empresa #${o.companyId}`,
          address: fullAddr || company.addressCity || `Empresa #${o.companyId}`,
          addressZip: company.addressZip,
          lat: company.latitude ? parseFloat(company.latitude) : null,
          lng: company.longitude ? parseFloat(company.longitude) : null,
          deliveryTime: company.deliveryTime || null,
          totalValue: o.totalValue,
        };
        ordersBridged.push(entry);
        if (entry.lat && entry.lng) {
          deliveryPoints.push({
            lat: entry.lat,
            lng: entry.lng,
            label: `${entry.companyName} (${o.orderCode})`,
            companyId: o.companyId,
            deliveryId: o.id,
            address: entry.address,
          });
        }
      });
    } else {
      deliveryPoints = (allDeliveries as any[])
        .filter((d: any) => d.latitude && d.longitude)
        .map((d: any) => ({
          lat: parseFloat(d.latitude),
          lng: parseFloat(d.longitude),
          label: d.addressCity || `Entrega #${d.id}`,
          companyId: d.companyId || undefined,
          deliveryId: d.id,
        }));
    }

    const driverList = drivers.map((d: any) => {
      const driverRoute = (routes as any[]).find(
        (r: any) => r.driverId === d.id && r.deliveryDate === date,
      );
      return { id: d.id, name: d.name, routeId: driverRoute?.id };
    });

    const simulation = simulateRouteDay(
      date,
      deliveryPoints,
      driverList as any,
      depotLat,
      depotLng,
    );

    const withoutCoords = ordersBridged.filter((o) => !o.lat || !o.lng);
    const noOrdersMsg =
      ordersBridged.length === 0 && (allDeliveries as any[]).length === 0;

    return {
      ...simulation,
      ordersBridged,
      withoutCoords,
      message: noOrdersMsg
        ? "Nenhum pedido encontrado para essa data."
        : deliveryPoints.length === 0 && ordersBridged.length > 0
        ? `${ordersBridged.length} pedido(s) encontrado(s), mas nenhum possui coordenadas cadastradas. Cadastre o endereço das empresas para simular a rota.`
        : undefined,
    };
  }

  // ─── CALCULATE DISTANCE ───────────────────────────────────────────────
  async calculateDistance(body: CalculateDistanceInput) {
    const { from, to } = body || ({} as CalculateDistanceInput);
    if (!from?.lat || !to?.lat) {
      throw new BadRequestError("Informe from {lat, lng} e to {lat, lng}");
    }
    const { calculateDistance } = await import(
      "../../services/logistics/routeOptimizer"
    );
    const km = calculateDistance(from, to);
    return {
      distanceKm: parseFloat(km.toFixed(3)),
      distanceM: Math.round(km * 1000),
    };
  }

  // ─── AUDIT LOGS ───────────────────────────────────────────────────────
  getAuditLogs(): Promise<LogisticsAuditLog[]> {
    return this.repo.getLogisticsAuditLogs({ limit: 200 });
  }

  // ─── REPORTS / DELIVERIES ─────────────────────────────────────────────
  async deliveriesReport(query: DeliveriesReportFilters, actor: ActorRef) {
    const { companyId, driverId, startDate, endDate, status } = query || {};
    const scope = this.analyticsScope(actor, true);
    const filters: any = {};
    if (scope.global && companyId) filters.companyId = Number(companyId);
    if (driverId) filters.driverId = Number(driverId);
    if (status) filters.status = String(status);

    let deliveries = (await this.visibleDeliveries(scope, filters)) as any[];

    if (startDate) {
      deliveries = deliveries.filter(
        (d: any) => d.scheduledDate && d.scheduledDate >= startDate,
      );
    }
    if (endDate) {
      deliveries = deliveries.filter(
        (d: any) => d.scheduledDate && d.scheduledDate <= endDate,
      );
    }

    const total = deliveries.length;
    const entregues = deliveries.filter((d: any) => d.status === "entregue").length;
    const pendentes = deliveries.filter((d: any) => d.status === "pendente").length;
    const emRota = deliveries.filter((d: any) => d.status === "em_rota").length;
    const cancelados = deliveries.filter((d: any) => d.status === "cancelado").length;

    const driverStats: Record<number, { count: number; entregues: number }> = {};
    deliveries.forEach((d: any) => {
      if (!d.driverId) return;
      if (!driverStats[d.driverId]) {
        driverStats[d.driverId] = { count: 0, entregues: 0 };
      }
      driverStats[d.driverId]!.count++;
      if (d.status === "entregue") driverStats[d.driverId]!.entregues++;
    });

    return {
      summary: { total, entregues, pendentes, emRota, cancelados },
      deliveries,
      driverStats,
      taxaEntrega: total > 0 ? Math.round((entregues / total) * 100) : 0,
    };
  }

  // ─── ROUTE STOPS ──────────────────────────────────────────────────────
  private async routeStopScope(routeId: number, actor: ActorRef, allowMultiCompanyRead = false) {
    if (!Number.isInteger(routeId) || routeId <= 0) {
      throw new BadRequestError("Rota inválida");
    }
    const scope = this.analyticsScope(actor, allowMultiCompanyRead);
    const route = scope.global
      ? await this.repo.getRoute(routeId)
      : await this.repo.getRouteForCompany(routeId, scope.tenantId!);
    if (!route) throw new NotFoundError("Rota não encontrada");
    return { scope, route };
  }

  async getRouteStops(routeId: number, actor: ActorRef): Promise<RouteStop[]> {
    const { scope } = await this.routeStopScope(routeId, actor, true);
    return scope.global
      ? this.repo.getRouteStops(routeId)
      : this.repo.getRouteStopsForCompany(routeId, scope.tenantId!);
  }

  async createRouteStop(
    routeId: number,
    body: any,
    actor: ActorRef,
  ): Promise<RouteStop> {
    const { scope } = await this.routeStopScope(routeId, actor);
    const payload = pickRouteStopFields(body);
    // Auto-fetch geo from CEP if coordinates not provided
    if (payload.cep && (!payload.latitude || !payload.longitude)) {
      try {
        const cepClean = String(payload.cep).replace(/\D/g, "");
        const viacep = await fetch(
          `https://viacep.com.br/ws/${cepClean}/json/`,
        );
        const cepData = (await viacep.json()) as any;
        if (!cepData.erro) {
          payload.endereco = payload.endereco || cepData.logradouro;
          payload.cidade = payload.cidade || cepData.localidade;
          payload.estado = payload.estado || cepData.uf;
        }
      } catch (_) {}
    }
    const stop = await this.repo.createRouteStopForRoute(
      routeId,
      payload,
      scope.global ? undefined : scope.tenantId!,
    );
    if (!stop) throw new NotFoundError("Rota não encontrada");
    return stop;
  }

  async updateRouteStop(
    routeId: number,
    stopId: number,
    body: any,
    actor: ActorRef,
  ): Promise<RouteStop> {
    await this.routeStopScope(routeId, actor);
    if (!Number.isInteger(stopId) || stopId <= 0) {
      throw new BadRequestError("Parada inválida");
    }
    const scope = this.analyticsScope(actor);
    const stop = await this.repo.updateRouteStopForRoute(
      stopId,
      routeId,
      pickRouteStopFields(body),
      scope.global ? undefined : scope.tenantId!,
    );
    if (!stop) throw new NotFoundError("Parada não encontrada");
    return stop;
  }

  async deleteRouteStop(
    routeId: number,
    stopId: number,
    actor: ActorRef,
  ): Promise<void> {
    await this.routeStopScope(routeId, actor);
    if (!Number.isInteger(stopId) || stopId <= 0) {
      throw new BadRequestError("Parada inválida");
    }
    const scope = this.analyticsScope(actor);
    const deleted = await this.repo.deleteRouteStopForRoute(
      stopId,
      routeId,
      scope.global ? undefined : scope.tenantId!,
    );
    if (!deleted) throw new NotFoundError("Parada não encontrada");
  }

  // ─── GEO CEP ──────────────────────────────────────────────────────────
  async geoCep(rawCep: string): Promise<GeoCepResponse> {
    const cep = String(rawCep).replace(/\D/g, "");
    const resp = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
    const data = (await resp.json()) as any;
    if (data.erro) throw new NotFoundError("CEP não encontrado");

    const query = encodeURIComponent(
      `${data.logradouro}, ${data.localidade}, ${data.uf}, Brasil`,
    );
    let lat: string | null = null;
    let lng: string | null = null;
    try {
      const geo = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=1`,
        { headers: { "User-Agent": "VivaFrutaz-ERP/1.0" } },
      );
      const geoData = (await geo.json()) as any[];
      if (geoData.length > 0) {
        lat = geoData[0].lat;
        lng = geoData[0].lon;
      }
    } catch (_) {}
    return {
      cep,
      logradouro: data.logradouro,
      bairro: data.bairro,
      cidade: data.localidade,
      estado: data.uf,
      latitude: lat,
      longitude: lng,
    };
  }

  // ─── SMART SEARCH ─────────────────────────────────────────────────────
  async smartSearch(rawQ: string, actor: ActorRef): Promise<SmartSearchResult[]> {
    const trimmed = String(rawQ || "").trim();
    const q = trimmed.replace(/\D/g, "");
    if (!trimmed) {
      throw new BadRequestError("Informe nome, CNPJ, CEP ou endereço");
    }

    const scope = this.analyticsScope(actor, true);
    const allComps = await this.visibleCompanies(scope);
    let companies: any[] = [];

    if (q.length === 8) {
      companies = allComps.filter(
        (c: any) => (c.addressZip || c.zip || "").replace(/\D/g, "") === q,
      );
    } else if (q.length >= 11) {
      companies = allComps.filter(
        (c: any) => (c.cnpj || "").replace(/\D/g, "") === q,
      );
    } else {
      const ql = trimmed.toLowerCase();
      companies = allComps
        .filter(
          (c: any) =>
            (c.companyName || c.name || "").toLowerCase().includes(ql) ||
            (c.addressCity || c.city || "").toLowerCase().includes(ql) ||
            (c.addressNeighborhood || "").toLowerCase().includes(ql) ||
            (c.addressStreet || "").toLowerCase().includes(ql) ||
            (c.addressZip || c.zip || "").replace(/\D/g, "").startsWith(q),
        )
        .slice(0, 15);
    }

    return companies.map((company: any) => {
      const zip = company.addressZip || company.zip || "";
      const city = company.addressCity || company.city || "";
      const neighborhood = company.addressNeighborhood || "";

      let deliveryConfig: any = {};
      try {
        deliveryConfig = JSON.parse(company.deliveryConfigJson || "{}");
      } catch {}
      const windowStart =
        company.deliveryTime?.split("-")[0]?.trim() || "08:00";
      const windowEnd =
        company.deliveryTime?.split("-")[1]?.trim() || "18:00";

      return {
        company: {
          id: company.id,
          name: company.companyName || company.name,
          cnpj: company.cnpj,
          zip,
          city,
          neighborhood,
          street: company.addressStreet,
          state: company.addressState,
          deliveryWindowStart: windowStart,
          deliveryWindowEnd: windowEnd,
        },
        suggestion: {
          // Route and driver recommendations are loaded separately from the
          // date-aware route-insertion endpoint. Do not imply a match based
          // only on city-name substring or array order.
          bestDriver: null,
          suggestedRoute: null,
          suggestedDeliveryWindow: `${windowStart} – ${windowEnd}`,
          nearbyCompanies: companies
            .filter(
              (cc: any) =>
                cc.id !== company.id &&
                (cc.addressCity || cc.city || "") === city,
            )
            .slice(0, 3)
            .map((cc: any) => ({
              id: cc.id,
              name: cc.companyName || cc.name,
            })),
        },
      };
    });
  }

  // ─── BEST DRIVER ──────────────────────────────────────────────────────
  async bestDriver(date: string | undefined, actor: ActorRef) {
    const scope = this.analyticsScope(actor, true);
    const drivers = (await this.visibleDrivers(scope)) as any[];
    const active = drivers.filter((d: any) => d.active);
    if (!active.length) {
      return { driver: null, message: "Nenhum motorista ativo" };
    }

    const deliveries = date
      ? ((await this.visibleDeliveries(scope, { date })) as any[])
      : [];
    const loadMap: Record<number, number> = {};
    deliveries.forEach((d: any) => {
      if (d.driverId) loadMap[d.driverId] = (loadMap[d.driverId] || 0) + 1;
    });

    const ranked = active
      .map((d: any) => ({ ...d, load: loadMap[d.id] || 0 }))
      .sort((a: any, b: any) => a.load - b.load);

    return { driver: ranked[0], allDrivers: ranked };
  }

  // ─── ROUTE INSERTION ──────────────────────────────────────────────────
  async routeInsertion(body: { companyId?: number; date?: string }, actor: ActorRef) {
    const { companyId, date } = body || {};
    if (!Number.isInteger(Number(companyId)) || Number(companyId) <= 0) {
      throw new BadRequestError("Informe companyId válido");
    }
    if (date != null) {
      const parsedDate = typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)
        ? new Date(`${date}T00:00:00.000Z`)
        : null;
      if (!parsedDate || !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
        throw new BadRequestError("Informe uma data válida (AAAA-MM-DD)");
      }
    }

    const scope = this.analyticsScope(actor);
    const companies = await this.visibleCompanies(scope);
    const company = (companies as any[]).find((item) => Number(item.id) === Number(companyId));
    if (!company) {
      throw new ForbiddenError("Empresa não pertence ao tenant autorizado.");
    }

    const latitude = company.latitude == null || String(company.latitude).trim() === ""
      ? NaN
      : Number(company.latitude);
    const longitude = company.longitude == null || String(company.longitude).trim() === ""
      ? NaN
      : Number(company.longitude);
    if (
      !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
      (latitude === 0 && longitude === 0)
    ) {
      return {
        date: date ?? dateInTimeZone(new Date(), "America/Sao_Paulo"),
        suggestion: null,
        routesAnalyzed: 0,
        message: "A empresa não possui coordenadas válidas para sugerir uma rota.",
      };
    }

    const targetDate = date ?? dateInTimeZone(new Date(), "America/Sao_Paulo");
    const [{ suggestInsertion, routeDistance }, routes, drivers, deliveries] = await Promise.all([
      import("../../services/logistics/routeOptimizer"),
      this.visibleRoutes(scope),
      this.visibleDrivers(scope),
      this.visibleDeliveries(scope, { date: targetDate }),
    ]);
    const activeDrivers = new Map(
      (drivers as any[])
        .filter((driver) => driver.active !== false)
        .map((driver) => [Number(driver.id), driver]),
    );
    const sameDayRoutes = (routes as any[]).filter((route) =>
      String(route.deliveryDate ?? "").slice(0, 10) === targetDate &&
      ["SCHEDULED", "IN_PROGRESS"].includes(String(route.status ?? "SCHEDULED").toUpperCase()) &&
      route.driverId != null && activeDrivers.has(Number(route.driverId)),
    );
    const eligibleRoutes: any[] = [];
    const driverRoutes: any[] = [];

    for (const route of sameDayRoutes) {
      const routeDeliveries = (deliveries as any[]).filter(
        (delivery) => Number(delivery.routeId) === Number(route.id) &&
          !["entregue", "cancelado"].includes(String(delivery.status ?? "").toLowerCase()),
      );
      const officialStops = await this.getRouteStops(Number(route.id), actor);
      let orderedPoints: Array<{ lat: number; lng: number; companyId?: number }> = [];

      if (officialStops.length > 0) {
        const points = officialStops.map((stop: any) => ({
          lat: stop.latitude == null || String(stop.latitude).trim() === "" ? NaN : Number(stop.latitude),
          lng: stop.longitude == null || String(stop.longitude).trim() === "" ? NaN : Number(stop.longitude),
          companyId: stop.companyId == null ? undefined : Number(stop.companyId),
        }));
        // Official stops are authoritative; do not silently route around a
        // stop whose coordinates are missing or malformed.
        if (points.some((point) =>
          !Number.isFinite(point.lat) || point.lat < -90 || point.lat > 90 ||
          !Number.isFinite(point.lng) || point.lng < -180 || point.lng > 180
        )) continue;
        orderedPoints = points;
      } else {
        const points = routeDeliveries.map((delivery: any) => ({
          lat: delivery.latitude == null || String(delivery.latitude).trim() === "" ? NaN : Number(delivery.latitude),
          lng: delivery.longitude == null || String(delivery.longitude).trim() === "" ? NaN : Number(delivery.longitude),
          companyId: delivery.companyId == null ? undefined : Number(delivery.companyId),
        }));
        if (points.some((point) =>
          !Number.isFinite(point.lat) || point.lat < -90 || point.lat > 90 ||
          !Number.isFinite(point.lng) || point.lng < -180 || point.lng > 180
        )) continue;
        orderedPoints = points;
      }

      const driver = activeDrivers.get(Number(route.driverId));
      if (!driver) continue;
      const routeStops = orderedPoints.map((point, index) => ({ ...point, position: index }));
      eligibleRoutes.push(route);
      driverRoutes.push({
        driverId: Number(driver.id),
        driverName: driver.name || route.driverName || "Motorista",
        vehicleId: route.vehicleId ?? undefined,
        vehiclePlate: route.vehiclePlate ?? undefined,
        routeId: Number(route.id),
        stops: routeStops,
        totalDistance: routeDistance(routeStops),
        estimatedMinutes: 0,
      });
    }

    if (driverRoutes.length === 0) {
      return {
        date: targetDate,
        suggestion: null,
        routesAnalyzed: 0,
        message: sameDayRoutes.length === 0
          ? "Não há rota agendada para esta data com motorista ativo atribuído."
          : "As rotas desta data não têm paradas com coordenadas suficientes para estimar a inserção.",
      };
    }

    const loadByRoute = new Map<number, number>();
    for (const delivery of deliveries as any[]) {
      const routeId = Number(delivery.routeId);
      if (Number.isFinite(routeId) && !["entregue", "cancelado"].includes(String(delivery.status ?? "").toLowerCase())) {
        loadByRoute.set(routeId, (loadByRoute.get(routeId) ?? 0) + 1);
      }
    }
    // Tie-break empty/equal-distance routes by the current number of open
    // deliveries. This does not change the driver assignment of a route.
    driverRoutes.sort((left, right) =>
      (loadByRoute.get(left.routeId) ?? 0) - (loadByRoute.get(right.routeId) ?? 0),
    );
    const result = suggestInsertion({ lat: latitude, lng: longitude, companyId: Number(companyId) }, driverRoutes);
    if (!result) {
      return { date: targetDate, suggestion: null, routesAnalyzed: 0, message: "Nenhuma rota elegível encontrada." };
    }
    const selectedRoute = eligibleRoutes.find((route) => Number(route.id) === Number(result.routeId));
    const selectedDriver = activeDrivers.get(Number(result.driverId));

    return {
      date: targetDate,
      routesAnalyzed: driverRoutes.length,
      estimation: "Distância em linha reta; não considera ruas, trânsito ou restrições do veículo.",
      suggestion: {
        routeId: selectedRoute?.id,
        routeName: selectedRoute?.name,
        driver: selectedDriver ? { id: selectedDriver.id, name: selectedDriver.name } : null,
        insertAtPosition: result.insertAtPosition + 1,
        currentLoad: loadByRoute.get(Number(result.routeId)) ?? 0,
        extraDistanceKm: result.extraDistance,
        newTotalDistanceKm: result.newTotalDistance,
        reason: result.reason,
      },
    };
  }

  // ─── SMART ROUTE PLAN ─────────────────────────────────────────────────
  async smartRoutePlan(date: string | undefined, actor: ActorRef) {
    const scope = this.analyticsScope(actor, true);
    const [deliveries, drivers, routes] = await Promise.all([
      this.visibleDeliveries(scope, date ? { date } : {}),
      this.visibleDrivers(scope),
      this.visibleRoutes(scope),
    ]);

    const haversineKm = (
      lat1: number,
      lon1: number,
      lat2: number,
      lon2: number,
    ) => {
      const R = 6371;
      const dLat = ((lat2 - lat1) * Math.PI) / 180;
      const dLon = ((lon2 - lon1) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((lat1 * Math.PI) / 180) *
          Math.cos((lat2 * Math.PI) / 180) *
          Math.sin(dLon / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    const driverLoad: Record<number, number> = {};
    (deliveries as any[]).forEach((d: any) => {
      if (d.driverId) driverLoad[d.driverId] = (driverLoad[d.driverId] || 0) + 1;
    });

    const OVERLOAD_THRESHOLD = 8;
    const overloadedDrivers = (drivers as any[])
      .filter((d: any) => (driverLoad[d.id] || 0) >= OVERLOAD_THRESHOLD)
      .map((d: any) => ({
        id: d.id,
        name: d.name,
        deliveryCount: driverLoad[d.id] || 0,
        excess: (driverLoad[d.id] || 0) - OVERLOAD_THRESHOLD,
      }));

    const withCoords = (deliveries as any[]).filter(
      (d: any) => d.latitude && d.longitude,
    );
    const clusters: Array<{
      center: { lat: number; lon: number };
      deliveries: any[];
      label: string;
    }> = [];
    withCoords.forEach((d: any) => {
      const lat = parseFloat(d.latitude);
      const lon = parseFloat(d.longitude);
      const existing = clusters.find(
        (c) => haversineKm(c.center.lat, c.center.lon, lat, lon) < 30,
      );
      if (existing) {
        existing.deliveries.push(d);
        existing.center.lat =
          (existing.center.lat * (existing.deliveries.length - 1) + lat) /
          existing.deliveries.length;
        existing.center.lon =
          (existing.center.lon * (existing.deliveries.length - 1) + lon) /
          existing.deliveries.length;
      } else {
        clusters.push({
          center: { lat, lon },
          deliveries: [d],
          label: d.addressCity || "Região",
        });
      }
    });

    const activeDrivers = (drivers as any[]).filter((d: any) => d.active !== false);
    const suggestions: any[] = [];
    clusters.forEach((cluster) => {
      const unassigned = cluster.deliveries.filter((d: any) => !d.driverId);
      if (!unassigned.length) return;
      const bestDriver = activeDrivers
        .map((d: any) => ({ ...d, load: driverLoad[d.id] || 0 }))
        .sort((a: any, b: any) => a.load - b.load)[0];
      if (bestDriver) {
        suggestions.push({
          region: cluster.label,
          deliveryCount: unassigned.length,
          suggestedDriver: {
            id: bestDriver.id,
            name: bestDriver.name,
            currentLoad: bestDriver.load,
          },
          estimatedKm: cluster.deliveries
            .reduce((acc: number, d: any, i: number) => {
              if (i === 0) return acc;
              const prev = cluster.deliveries[i - 1];
              return (
                acc +
                haversineKm(
                  parseFloat(prev.latitude || 0),
                  parseFloat(prev.longitude || 0),
                  parseFloat(d.latitude || 0),
                  parseFloat(d.longitude || 0),
                )
              );
            }, 0)
            .toFixed(1),
        });
      }
    });

    const totalKm = withCoords.reduce(
      (acc: number, d: any, i: number, arr: any[]) => {
        if (i === 0) return acc;
        const prev = arr[i - 1];
        return (
          acc +
          haversineKm(
            parseFloat(prev.latitude || 0),
            parseFloat(prev.longitude || 0),
            parseFloat(d.latitude || 0),
            parseFloat(d.longitude || 0),
          )
        );
      },
      0,
    );

    return {
      date: date || "todos",
      totalDeliveries: (deliveries as any[]).length,
      deliveriesWithCoords: withCoords.length,
      clusters: clusters.map((c) => ({
        label: c.label,
        count: c.deliveries.length,
        center: c.center,
        assignedDrivers: [
          ...new Set(
            c.deliveries
              .filter((d: any) => d.driverId)
              .map((d: any) => d.driverId),
          ),
        ].length,
      })),
      overloadedDrivers,
      suggestions,
      estimatedTotalKm: totalKm.toFixed(1),
      driverLoad: Object.entries(driverLoad).map(([driverId, count]) => {
        const driver = (drivers as any[]).find(
          (d: any) => d.id === Number(driverId),
        );
        return {
          driverId: Number(driverId),
          name: driver?.name || `#${driverId}`,
          count,
          overloaded: count >= OVERLOAD_THRESHOLD,
        };
      }),
    };
  }
}

export const logisticsService = new LogisticsService();
