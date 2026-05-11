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
  NotFoundError,
} from "../../shared/errors/AppError";
import { currentTenantId } from "../../core/tenant/context";
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

export class LogisticsService {
  constructor(private readonly repo: LogisticsRepository = logisticsRepository) {}

  // ─── DRIVERS ──────────────────────────────────────────────────────────
  listDrivers() {
    const tid = currentTenantId();
    return tid ? this.repo.getDriversSafe(tid) : this.repo.getDrivers();
  }

  async createDriver(
    body: any,
    actor: ActorRef,
  ): Promise<LogisticsDriver> {
    const { name, cpf, phone, email, licenseNumber, notes } = body || {};
    if (!name) throw new BadRequestError("Nome obrigatório");
    const d = await this.repo.createDriver({
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

  updateDriver(id: number, body: any) {
    const tid = currentTenantId();
    return tid ? this.repo.updateDriverOwned(id, tid, body) : this.repo.updateDriver(id, body);
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

  updateVehicle(id: number, body: any) {
    const tid = currentTenantId();
    return tid ? this.repo.updateVehicleOwned(id, tid, body) : this.repo.updateVehicle(id, body);
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
      startTime,
      endTime,
    } = body || {};
    if (!name) throw new BadRequestError("Nome da rota obrigatório");
    const r = await this.repo.createRoute({
      name,
      driverId: driverId || undefined,
      driverName,
      vehicleId: vehicleId || undefined,
      vehiclePlate,
      deliveryDate: deliveryDate || undefined,
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

  updateRoute(id: number, body: any) {
    const tid = currentTenantId();
    return tid ? this.repo.updateRouteOwned(id, tid, body) : this.repo.updateRoute(id, body);
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
    const m = await this.repo.createMaintenance({
      vehicleId: vehicleId || undefined,
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

  updateMaintenance(id: number, body: any) {
    const tid = currentTenantId();
    return tid ? this.repo.updateMaintenanceOwned(id, tid, body) : this.repo.updateMaintenance(id, body);
  }

  deleteMaintenance(id: number) {
    const tid = currentTenantId();
    return tid ? this.repo.deleteMaintenanceOwned(id, tid) : this.repo.deleteMaintenance(id);
  }

  // ─── ROUTE ASSISTANT ──────────────────────────────────────────────────
  async routeAssistant(query: { day?: string; date?: string }): Promise<RouteAssistantItem[]> {
    const { day, date } = query;
    const allCompanies = await this.repo.getCompanies();

    let companiesWithOrders: Set<number> = new Set();
    if (date) {
      const allOrders = await this.repo.getOrders();
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
  async suggestRoute(body: SuggestRouteInput) {
    const { newPoint, date } = body || ({} as SuggestRouteInput);
    if (!newPoint?.lat || !newPoint?.lng) {
      throw new BadRequestError("Informe lat/lng do ponto de entrega");
    }
    const { suggestInsertion } = await import(
      "../../services/logistics/routeOptimizer"
    );
    const routes = await this.repo.getRoutes();
    const filteredRoutes = date
      ? routes.filter((r: any) => r.deliveryDate === date)
      : routes;
    const drivers = await this.repo.getDrivers();

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
  async dayOrders(query: { date?: string }): Promise<DayOrdersResponse> {
    const { date } = query;
    if (!date) throw new BadRequestError("Informe a data (date)");

    const allOrders = await this.repo.getOrders();
    const allCompanies = await this.repo.getCompanies();
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
  async simulateDay(body: { date?: string; depotLat?: number; depotLng?: number }) {
    const { date, depotLat, depotLng } = body || {};
    if (!date) throw new BadRequestError("Informe a data de simulação");

    const { simulateRouteDay } = await import(
      "../../services/logistics/routeOptimizer"
    );

    let allDeliveries = await this.repo.getDeliveries({ date, status: "pendente" });
    const allDrivers = await this.repo.getDrivers();
    const drivers = (allDrivers as any[]).filter((d: any) => d.active);
    const routes = await this.repo.getRoutes();

    let deliveryPoints: any[] = [];
    let ordersBridged: any[] = [];
    if ((allDeliveries as any[]).length === 0) {
      const allOrders = await this.repo.getOrders();
      const allCompanies = await this.repo.getCompanies();
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
  async deliveriesReport(query: DeliveriesReportFilters) {
    const { companyId, driverId, startDate, endDate, status } = query || {};
    const filters: any = {};
    if (companyId) filters.companyId = Number(companyId);
    if (driverId) filters.driverId = Number(driverId);
    if (status) filters.status = String(status);

    let deliveries = (await this.repo.getDeliveries(filters)) as any[];

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
  getRouteStops(routeId: number): Promise<RouteStop[]> {
    return this.repo.getRouteStops(routeId);
  }

  async createRouteStop(routeId: number, body: any): Promise<RouteStop> {
    const payload = { ...(body || {}) };
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
    return this.repo.createRouteStop({ ...payload, routeId });
  }

  updateRouteStop(stopId: number, body: any): Promise<RouteStop> {
    return this.repo.updateRouteStop(stopId, body);
  }

  deleteRouteStop(stopId: number): Promise<void> {
    return this.repo.deleteRouteStop(stopId);
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
  async smartSearch(rawQ: string): Promise<SmartSearchResult[]> {
    const trimmed = String(rawQ || "").trim();
    const q = trimmed.replace(/\D/g, "");
    if (!trimmed) {
      throw new BadRequestError("Informe nome, CNPJ, CEP ou endereço");
    }

    const allComps = (await this.repo.getCompanies()) as any[];
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

    const [drivers, routes] = await Promise.all([
      this.repo.getDrivers(),
      this.repo.getRoutes(),
    ]);
    const activeDrivers = (drivers as any[]).filter((d: any) => d.active);

    return companies.map((company: any) => {
      const zip = company.addressZip || company.zip || "";
      const city = company.addressCity || company.city || "";
      const neighborhood = company.addressNeighborhood || "";

      const matchRoute =
        (routes as any[]).find(
          (r: any) =>
            (r.name || "").toLowerCase().includes(city.toLowerCase()) ||
            (r.name || "").toLowerCase().includes(neighborhood.toLowerCase()),
        ) || ((routes as any[]).length > 0 ? (routes as any[])[0] : null);

      const suggestedDriver =
        activeDrivers.length > 0 ? activeDrivers[0] : null;

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
          bestDriver: suggestedDriver
            ? { id: suggestedDriver.id, name: suggestedDriver.name }
            : null,
          suggestedRoute: matchRoute
            ? { id: matchRoute.id, name: matchRoute.name }
            : null,
          suggestedDeliveryWindow: `${windowStart} – ${windowEnd}`,
          estimatedTimeMin: 20,
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
  async bestDriver(date?: string) {
    const drivers = (await this.repo.getDrivers()) as any[];
    const active = drivers.filter((d: any) => d.active);
    if (!active.length) {
      return { driver: null, message: "Nenhum motorista ativo" };
    }

    const deliveries = date
      ? ((await this.repo.getDeliveries({ date })) as any[])
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
  async routeInsertion(body: { companyId?: number; date?: string }) {
    const { companyId, date } = body || {};
    if (!companyId) throw new BadRequestError("Informe companyId");

    const routes = (await this.repo.getRoutes()) as any[];
    const drivers = (await this.repo.getDrivers()) as any[];

    if (!routes.length) {
      return { suggestion: null, message: "Nenhuma rota cadastrada" };
    }

    const deliveries = date
      ? ((await this.repo.getDeliveries({ date })) as any[])
      : [];
    const routeLoad: Record<number, number> = {};
    deliveries.forEach((d: any) => {
      if (d.routeId) routeLoad[d.routeId] = (routeLoad[d.routeId] || 0) + 1;
    });

    const ranked = routes
      .map((r: any) => ({ ...r, load: routeLoad[r.id] || 0 }))
      .sort((a: any, b: any) => a.load - b.load);
    const best = ranked[0];
    const assignedDriver = drivers.find((d: any) => d.active);

    return {
      suggestion: {
        routeId: best.id,
        routeName: best.name,
        insertAtPosition: (routeLoad[best.id] || 0) + 1,
        currentLoad: routeLoad[best.id] || 0,
        driver: assignedDriver
          ? { id: assignedDriver.id, name: assignedDriver.name }
          : null,
        extraTimeEstimateMin: 15,
        reason: `Rota com menor carga atual (${routeLoad[best.id] || 0} entregas)`,
      },
    };
  }

  // ─── SMART ROUTE PLAN ─────────────────────────────────────────────────
  async smartRoutePlan(date?: string) {
    const [deliveries, drivers, routes] = await Promise.all([
      this.repo.getDeliveries(date ? { date } : {}),
      this.repo.getDrivers(),
      this.repo.getRoutes(),
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
