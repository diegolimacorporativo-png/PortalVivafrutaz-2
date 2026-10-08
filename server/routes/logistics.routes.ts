import type { Express } from "express";
import { storage } from "../services/storage.ts";
import { tenantContext } from "../middleware/tenant";
import { currentTenantId } from "../core/tenant/context";
import {
  canAccessDriverRecord,
  ensureOwnDriverId,
  isDriver,
  isDriverOrInternal,
  isGlobalLogisticsActor,
  isInternal,
  isLogisticsTrackingRole,
  resolveDriverGpsSubmissionId,
  resolveOwnDriverId,
} from "../modules/logistics/driver.access";
import {
  isDeliveryInTenant,
  resolveDeliveryAccess,
  sanitizeDeliveryCreateBody,
  sanitizeDeliveryUpdateBody,
} from "../modules/logistics/delivery.access";
import { requireAuth as requireAuthCore } from "../core/http/requireAuth";
import {
  createPublicTrackingToken,
  verifyPublicTrackingToken,
} from "../core/security/publicTrackingToken";
import { publicTrackingLimiter } from "../core/security/rateLimit";
import { buildPublicDeliveryTrackingPayload } from "../modules/logistics/public-tracking.dto";
import { getPublicDeliveryTracking } from "../modules/logistics/delivery-tracking.service";
import { db } from "../database/db";
import {
  logisticsDrivers as driversTable,
  users as usersTable,
  logisticsRoutes as routesTable,
  orders as ordersTable,
  orderItems as orderItemsTable,
  products as productsTable,
  deliveries as deliveriesTable,
  deliveryStopEvents,
  driverJourneys, driverOdometerEntries, driverFuelEntries, deliveryProofs,
} from "@shared/schema";
import { eq, or, and, gte, lte, lt, desc, inArray, type SQL } from "drizzle-orm";

/** Canonical stop status values accepted by FASE 2. */
const VALID_STOP_STATUSES = new Set([
  "entregue",
  "cliente_ausente",
  "endereco_incorreto",
  "recusado",
  "reagendado",
  "problema",
]);

export async function register(app: Express): Promise<void> {
  app.get('/api/geo/cep/:cep', async (req: any, res) => {
    try {
      const { lookupCepWithCoords } = await import('../services/logistics/geoService');
      const result = await lookupCepWithCoords(req.params.cep);
      if (!result) return res.status(404).json({ message: 'CEP não encontrado' });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // CEP basic (without geocoding, faster)
  app.get('/api/geo/cep-basic/:cep', async (req: any, res) => {
    try {
      const { lookupCep } = await import('../services/logistics/geoService');
      const result = await lookupCep(req.params.cep);
      if (!result) return res.status(404).json({ message: 'CEP não encontrado' });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── Deliveries CRUD ─────────────────────────────────────────────────────────
  // SECURITY: tenantContext pins the principal. Pinned admins/companies are
  // FORCED to filter by their own tenant — even if they pass ?companyId=X. Only
  // unscoped MASTER may target a different companyId via ?companyId=N.
  app.get('/api/deliveries', tenantContext, async (req: any, res) => {
    try {
      const tenantId = currentTenantId();
      const filters: any = {};
      if (tenantId != null) {
        // Pinned: ignore body/query overrides; force own tenant.
        filters.companyId = tenantId;
      } else if (req.query.companyId) {
        // Cross-tenant admin (MASTER without ?empresaId): explicit target ok.
        filters.companyId = Number(req.query.companyId);
      }
      if (req.query.driverId) filters.driverId = Number(req.query.driverId);
      if (req.query.routeId) filters.routeId = Number(req.query.routeId);
      if (req.query.status) filters.status = req.query.status;
      if (req.query.date) filters.date = req.query.date;
      if (req.query.dateFrom) filters.dateFrom = String(req.query.dateFrom);
      if (req.query.dateTo) filters.dateTo = String(req.query.dateTo);
      res.json(await storage.getDeliveries(filters));
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.get('/api/deliveries/:id', requireAuthCore, async (req: any, res) => {
    try {
      const actor = await storage.getUser(req.session.userId);
      if (!actor) return res.status(401).json({ message: 'Não autenticado' });
      const d = await getAuthorizedDelivery(Number(req.params.id), actor);
      if (!d) return res.status(404).json({ message: 'Entrega não encontrada' });
      res.json(d);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post('/api/deliveries', requireAuthCore, async (req: any, res) => {
    try {
      const actor = await storage.getUser(req.session.userId);
      if (!actor) return res.status(401).json({ message: 'Não autenticado' });
      const access = resolveDeliveryAccess(actor);
      if (!access.allowed) return res.status(access.status).json({ message: access.message });
      const data = sanitizeDeliveryCreateBody(req.body, access.tenantId);
      const delivery = await storage.createDelivery(data as any);
      res.status(201).json(delivery);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.put('/api/deliveries/:id', requireAuthCore, async (req: any, res) => {
    try {
      const actor = await storage.getUser(req.session.userId);
      if (!actor) return res.status(401).json({ message: 'Não autenticado' });
      const deliveryId = Number(req.params.id);
      const current = await getAuthorizedDelivery(deliveryId, actor);
      if (!current) return res.status(404).json({ message: 'Entrega não encontrada' });
      const delivery = await storage.updateDelivery(
        deliveryId,
        sanitizeDeliveryUpdateBody(req.body) as any,
      );
      res.json(delivery);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.patch('/api/deliveries/:id/status', requireAuthCore, async (req: any, res) => {
    try {
      const actor = await storage.getUser(req.session.userId);
      if (!actor) return res.status(401).json({ message: 'Não autenticado' });
      const deliveryId = Number(req.params.id);
      const current = await getAuthorizedDelivery(deliveryId, actor);
      if (!current) return res.status(404).json({ message: 'Entrega não encontrada' });
      const { status } = req.body;
      const updates: any = { status };
      if (status === 'entregue') updates.deliveredAt = new Date();
      const delivery = await storage.updateDelivery(deliveryId, updates);
      res.json(delivery);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.delete('/api/deliveries/:id', requireAuthCore, async (req: any, res) => {
    try {
      const actor = await storage.getUser(req.session.userId);
      if (!actor) return res.status(401).json({ message: 'Não autenticado' });
      const deliveryId = Number(req.params.id);
      const current = await getAuthorizedDelivery(deliveryId, actor);
      if (!current) return res.status(404).json({ message: 'Entrega não encontrada' });
      await storage.deleteDelivery(deliveryId);
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ─── Logistics Audit Helper (kept here: still used by /api/deliveries/:id/checklist) ───
  async function logisticsAudit(req: any, acao: string, detalhes?: string, entidadeId?: number, entidadeTipo?: string) {
    try {
      const actor = req._logisticsActor || null;
      await storage.createLogisticsAudit({
        usuarioId: actor?.id || null,
        usuarioEmail: actor?.email || null,
        usuarioRole: actor?.role || null,
        acao, modulo: 'logistica', detalhes: detalhes || null,
        entidadeId: entidadeId || null, entidadeTipo: entidadeTipo || null,
      });
    } catch (_) {}
  }

  /**
   * Resolves a delivery and verifies tenant ownership plus driver ownership.
   * Cross-tenant requests intentionally return undefined so callers preserve
   * the existing not-found response and do not reveal another tenant's row.
   */
  async function getAuthorizedDelivery(deliveryId: number, actor: any): Promise<any | undefined> {
    const access = resolveDeliveryAccess(actor);
    if (!access.allowed) {
      return undefined;
    }

    const delivery = access.tenantId != null
      ? await storage.getDeliveryForCompany(deliveryId, access.tenantId)
      : await storage.getDelivery(deliveryId);
    if (!delivery) return undefined;

    if (!isDeliveryInTenant(delivery, access.tenantId)) {
      return undefined;
    }

    if (isDriver(actor?.role)) {
      const ownDriverId = await resolveOwnDriverId(storage, actor);
      if (!ownDriverId) return undefined;

      let ownsDelivery = Number(delivery.driverId) === ownDriverId;
      if (!ownsDelivery && delivery.routeId) {
        const [route] = await db
          .select({ driverId: routesTable.driverId })
          .from(routesTable)
          .where(eq(routesTable.id, Number(delivery.routeId)))
          .limit(1);
        ownsDelivery = Number(route?.driverId) === ownDriverId;
      }

      if (!ownsDelivery) {
        return undefined;
      }
    }

    return delivery;
  }

  // ─── Driver Panel — Rota do dia ───────────────────────────────────────────────
  app.get('/api/driver/route-today', requireAuthCore, async (req: any, res) => {
    try {
      const actor = await storage.getUser(req.session.userId);
      if (!actor) return res.status(401).json({ message: 'Não autenticado' });

      // STEP 8.7 — RBAC: only DRIVER + internal logistics roles may hit /api/driver/*.
      // Customers (CLIENT, etc.) are explicitly rejected so they can't enumerate
      // delivery routes by guessing this URL.
      if (!isDriverOrInternal(actor.role)) {
        return res.status(403).json({ message: 'Acesso negado' });
      }
      const today = new Date().toISOString().split('T')[0];
      const dateFrom = typeof req.query.dateFrom === 'string' ? req.query.dateFrom : today;
      const dateTo = typeof req.query.dateTo === 'string' ? req.query.dateTo : dateFrom;
      const selectedCompanyId = req.query.companyId ? Number(req.query.companyId) : undefined;

      const allCompanies = await storage.getCompanies();
      const actorCompanyId = actor.empresaId ? Number(actor.empresaId) : undefined;
      // A tenant-pinned internal user may only query its own company. Do this
      // before both delivery and order queries so a crafted companyId cannot
      // bypass the scope by taking the orders branch.
      if (actorCompanyId && selectedCompanyId && selectedCompanyId !== actorCompanyId) {
        return res.status(403).json({ message: 'Acesso negado' });
      }
      const visibleCompanies = actorCompanyId
        ? allCompanies.filter((company: any) => Number(company.id) === actorCompanyId)
        : allCompanies;
      const companyMap = Object.fromEntries(visibleCompanies.map((c: any) => [c.id, c]));

      let myDriver: any = null;
      // Use the same normalized email/name resolver as GPS POST. This keeps
      // route lookup and position lookup on exactly the same driver identity,
      // including legacy rows with casing/whitespace differences.
      const ownDriverId = await resolveOwnDriverId(storage, actor);
      if (ownDriverId) {
        const driverRows = await db
          .select()
          .from(driversTable)
          .where(eq(driversTable.id, ownDriverId))
          .limit(1);
        myDriver = driverRows[0] ?? null;
      }

      // Search the selected period. Driver accounts are filtered below by
      // the authenticated driver and assigned routes; they never receive
      // unassigned deliveries or the order-bridge fallback.
      const deliveryFilters: any = { dateFrom, dateTo };
      if (actorCompanyId) {
        deliveryFilters.companyId = actorCompanyId;
      } else if (selectedCompanyId && Number.isInteger(selectedCompanyId)) {
        deliveryFilters.companyId = selectedCompanyId;
      }
      let allDeliveries = (await storage.getDeliveries(deliveryFilters))
        .filter((delivery: any) => !['cancelado', 'cancelled'].includes(String(delivery.status ?? '').toLowerCase()));
      let source: 'deliveries' | 'orders' = 'deliveries';

      // Always bridge confirmed orders, not only when the deliveries table is
      // empty. A delivery row can exist for one company while confirmed
      // orders from other companies still have no delivery row yet.
      // FASE MT-1: Drizzle query scoped to tenant + date range in SQL — no full-table scan.
      const rangeStart = new Date(dateFrom + 'T00:00:00.000Z');
      const rangeEnd = new Date(dateTo + 'T00:00:00.000Z');
      rangeEnd.setUTCDate(rangeEnd.getUTCDate() + 1);
      const orderConds: SQL<unknown>[] = [
        gte(ordersTable.deliveryDate, rangeStart),
        lt(ordersTable.deliveryDate, rangeEnd),
      ];
      if (actorCompanyId) {
        orderConds.push(eq(ordersTable.companyId, actorCompanyId));
      } else if (selectedCompanyId && Number.isInteger(selectedCompanyId)) {
        orderConds.push(eq(ordersTable.companyId, selectedCompanyId));
      }
      const dateOrders = (await db.select().from(ordersTable).where(and(...orderConds)))
        .filter((order: any) => order.status !== 'CANCELLED');
      const statusMap: Record<string, string> = {
        CONFIRMED: 'pendente', ACTIVE: 'pendente',
        DELIVERED: 'entregue', CANCELLED: 'cancelado', LOCKED: 'pendente',
      };
      const existingOrderIds = new Set(
        allDeliveries
          .map((delivery: any) => delivery.orderId)
          .filter((orderId: unknown) => orderId != null)
          .map((orderId: unknown) => Number(orderId)),
      );
      const bridgedOrders = dateOrders
        .filter((order: any) => !existingOrderIds.has(Number(order.id)))
        .map((o: any, idx: number) => ({
          id: o.id,
          companyId: o.companyId,
          status: statusMap[o.status] || 'pendente',
          scheduledDate: o.deliveryDate ? new Date(o.deliveryDate).toISOString().slice(0, 10) : dateFrom,
          routePosition: idx + 1,
          notes: o.orderNote || null,
          totalValue: o.totalValue,
          orderCode: o.orderCode,
          addressStreet: companyMap[o.companyId]?.addressStreet || null,
          addressCity: companyMap[o.companyId]?.addressCity || null,
          addressZip: companyMap[o.companyId]?.addressZip || null,
          latitude: companyMap[o.companyId]?.latitude || null,
          longitude: companyMap[o.companyId]?.longitude || null,
          isOrderBridge: true,
        })) as any;
      if (bridgedOrders.length > 0) {
        source = allDeliveries.length > 0 ? 'deliveries' : 'orders';
        allDeliveries = [...allDeliveries, ...bridgedOrders];
      }

      // STEP 8.7 — both DRIVER and the legacy MOTORISTA alias get a strict
      // tenant/driver filter. An unlinked driver must see no deliveries,
      // rather than falling through to the internal-user visibility branch.
      // Internal staff keep the legacy "unassigned-or-mine" semantics.
      let deliveries: any[];
      if (isDriver(actor.role)) {
        const assignedRouteIds = myDriver
          ? new Set(
              (await db
                .select({ id: routesTable.id })
                .from(routesTable)
                .where(eq(routesTable.driverId, myDriver.id)))
                .map((route: any) => Number(route.id)),
            )
          : new Set<number>();
        deliveries = myDriver
          ? allDeliveries.filter((d: any) =>
              Number(d.driverId) === Number(myDriver.id) ||
              (d.routeId != null && assignedRouteIds.has(Number(d.routeId))),
            )
          : [];
      } else if (myDriver) {
        deliveries = allDeliveries.filter((d: any) => !d.driverId || d.driverId === myDriver.id);
      } else {
        deliveries = allDeliveries;
      }

      // Keep order details inside the already-authorized driver-panel payload.
      // This avoids sending a driver through the generic /api/orders/:id route,
      // whose access rules are intentionally different from route eligibility.
      const visibleOrderIds = Array.from(new Set(
        deliveries
          .map((delivery: any) => Number(delivery.orderId ?? (delivery.isOrderBridge ? delivery.id : 0)))
          .filter((orderId: number) => Number.isInteger(orderId) && orderId > 0),
      ));
      const visibleOrders = visibleOrderIds.length > 0
        ? await db.select().from(ordersTable).where(inArray(ordersTable.id, visibleOrderIds))
        : [];
      const visibleItems = visibleOrderIds.length > 0
        ? await db
          .select({
            id: orderItemsTable.id,
            orderId: orderItemsTable.orderId,
            productId: orderItemsTable.productId,
            quantity: orderItemsTable.quantity,
            unitPrice: orderItemsTable.unitPrice,
            totalPrice: orderItemsTable.totalPrice,
            productName: productsTable.name,
            productUnit: productsTable.unit,
          })
          .from(orderItemsTable)
          .leftJoin(productsTable, eq(productsTable.id, orderItemsTable.productId))
          .where(inArray(orderItemsTable.orderId, visibleOrderIds))
        : [];
      const visibleOrderMap = new Map(visibleOrders.map(order => [order.id, order]));
      const visibleItemsMap = new Map<number, any[]>();
      for (const item of visibleItems) {
        const items = visibleItemsMap.get(item.orderId) ?? [];
        items.push(item);
        visibleItemsMap.set(item.orderId, items);
      }

      const enriched = deliveries.map((d: any) => ({
        ...d,
        canUpdate: !isDriver(actor.role) || Boolean(myDriver && d.driverId && Number(d.driverId) === Number(myDriver.id)),
        companyName: companyMap[d.companyId]?.companyName || companyMap[d.companyId]?.name || '—',
        companyCnpj: companyMap[d.companyId]?.cnpj || null,
        companyPhone: companyMap[d.companyId]?.phone || null,
        deliveryWindowStart: companyMap[d.companyId]?.deliveryWindowStart || null,
        deliveryWindowEnd: companyMap[d.companyId]?.deliveryWindowEnd || null,
        addressStreet: d.addressStreet || companyMap[d.companyId]?.addressStreet || null,
        addressCity: d.addressCity || companyMap[d.companyId]?.addressCity || null,
        latitude: d.latitude || companyMap[d.companyId]?.latitude || null,
        longitude: d.longitude || companyMap[d.companyId]?.longitude || null,
        orderDetails: (() => {
          const orderId = Number(d.orderId ?? (d.isOrderBridge ? d.id : 0));
          const order = visibleOrderMap.get(orderId);
          if (!order) return null;
          return {
            order: {
              orderCode: order.orderCode,
              orderDate: order.orderDate,
              deliveryDate: order.deliveryDate,
              orderNote: order.orderNote,
              status: order.status,
              totalValue: order.totalValue,
            },
            items: visibleItemsMap.get(orderId) ?? [],
          };
        })(),
      }));

      res.json({
        deliveries: enriched,
        driver: myDriver || null,
        companies: visibleCompanies.map((c: any) => ({
          id: c.id,
          name: c.companyName || c.name,
          cnpj: c.cnpj || null,
        })),
        date: dateFrom,
        dateFrom,
        dateTo,
        source,
      });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ─── Driver GPS Position ───────────────────────────────────────────────────────
  app.post('/api/driver/gps', requireAuthCore, async (req: any, res) => {
    try {
      const actor = await storage.getUser(req.session.userId);
      if (!actor) return res.status(401).json({ message: 'Não autenticado' });
      // Tracker sessions use a long-lived cookie so the Android service can
      // operate through a full shift. The session remains revocable through
      // tokenVersion/device checks; this does not change ERP session policy.
      if (req.session.trackerSession) {
        req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000;
        req.session.touch();
      }

      // STEP 8.7 — gate the endpoint to DRIVER + internal logistics roles.
      if (!isDriverOrInternal(actor.role)) {
        return res.status(403).json({ message: 'Acesso negado' });
      }

      const { driverId: requestedDriverId, latitude, longitude, accuracy, speed, heading } = req.body ?? {};
      const lat = Number(latitude);
      const lng = Number(longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return res.status(400).json({ message: 'latitude e longitude válidas são obrigatórias' });
      }

      // A logged-in driver does not need to send an identity field. Resolve it
      // from the authenticated user so GPS works even when there is no route.
      // Legacy driver accounts may not have a logistics_drivers row yet. The
      // first real GPS update is the one read endpoint allowed to provision
      // that operational link.
      let driverId = requestedDriverId ? Number(requestedDriverId) : null;
      if (isDriver(actor.role) || isLogisticsTrackingRole(actor.role)) {
        const ownDriverId = await ensureOwnDriverId(storage, actor);
        const safeDriverId = resolveDriverGpsSubmissionId(driverId, ownDriverId);
        if (!safeDriverId) {
          if (!ownDriverId) {
            return res.status(403).json({ message: 'Usuário sem cadastro de logística vinculado' });
          }
          return res.status(403).json({ message: 'Motorista não pode enviar GPS de outra conta' });
        }
        driverId = safeDriverId;
      }
      if (!driverId || !Number.isInteger(driverId) || driverId <= 0) {
        return res.status(400).json({ message: 'driverId é obrigatório para usuários internos' });
      }

      // Internal staff may post on behalf of a driver only after validating
      // driver → empresa → tenant. Global internal roles retain their
      // existing cross-tenant operational access.
      if (!isDriver(actor.role) && !isLogisticsTrackingRole(actor.role)) {
        const [targetDriver] = await db
          .select({ id: driversTable.id, empresaId: driversTable.empresaId })
          .from(driversTable)
          .where(eq(driversTable.id, driverId))
          .limit(1);
        if (!canAccessDriverRecord(actor, targetDriver)) {
          return res.status(404).json({ message: 'Motorista não encontrado' });
        }
      }

      const pos = await storage.createGpsPosition({
        driverId,
        latitude: String(lat),
        longitude: String(lng),
        accuracy: accuracy == null ? undefined : String(Number(accuracy)),
        speed: speed == null ? undefined : String(Number(speed)),
        heading: heading == null ? undefined : String(Number(heading)),
      });
      res.json(pos);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // Latest position for every active driver visible to the authenticated
  // logistics user. This intentionally does not depend on a route assignment.
  app.get('/api/logistics/drivers/gps', requireAuthCore, async (req: any, res) => {
    try {
      const actor = await storage.getUser(req.session.userId);
      if (!actor) return res.status(401).json({ message: 'Não autenticado' });
      if (!isInternal(actor.role)) return res.status(403).json({ message: 'Acesso negado' });
      // A consulta global só é válida para perfis centrais. Para os demais
      // perfis internos, a ausência de tenant deve falhar fechado em vez de
      // expor posições de todas as empresas.
      if (!isGlobalLogisticsActor(actor) && actor.empresaId == null) {
        return res.status(403).json({ message: 'Empresa não definida para este usuário' });
      }

      let driverRows = actor.empresaId
        ? await db.select().from(driversTable).where(eq(driversTable.empresaId, actor.empresaId)).orderBy(driversTable.name)
        : await db.select().from(driversTable).orderBy(driversTable.name);

      // Some legacy installations registered drivers as user accounts with
      // role MOTORISTA/DRIVER but never created the corresponding
      // logistics_drivers row. Always include those accounts when they do not
      // match an operational record, so every registered driver is visible.
      // The read remains side-effect free: missing operational records are
      // virtual until the driver sends a real GPS position.
      const userConditions: SQL<unknown>[] = [
        // LOGISTICS accounts are supervisors. Keep them in the compatibility
        // path too, so they can monitor driver accounts even on installations
        // where the modular router is not the first matching route.
        inArray(usersTable.role, ["MOTORISTA", "DRIVER", "LOGISTICS"]),
        eq(usersTable.active, true),
      ];
      if (actor.empresaId) userConditions.push(eq(usersTable.empresaId, actor.empresaId));
      const driverUsers = await db
        .select({
          id: usersTable.id,
          name: usersTable.name,
          email: usersTable.email,
          empresaId: usersTable.empresaId,
          active: usersTable.active,
        })
        .from(usersTable)
        .where(and(...userConditions))
        .orderBy(usersTable.name);

      const normalizeIdentity = (value: unknown) =>
        String(value ?? "").trim().toLocaleLowerCase("pt-BR");
      const matchedUserIds = new Set<number>();
      for (const driver of driverRows as any[]) {
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
      driverRows = [...driverRows, ...legacyDriverRows] as any;

      const positions = await Promise.all(driverRows.map(async (driver: any) => {
        const position = driver.virtualFromUser ? null : await storage.getLatestGpsPosition(driver.id);
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

      res.json(positions);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get('/api/driver/:driverId/gps', requireAuthCore, async (req: any, res) => {
    try {
      // STEP 8.7 — endpoint was previously fully open. Now requires session +
      // role gate, and DRIVERs can only read their OWN latest position.
      const actor = await storage.getUser(req.session.userId);
      if (!actor) return res.status(401).json({ message: 'Não autenticado' });
      if (!isDriverOrInternal(actor.role)) {
        return res.status(403).json({ message: 'Acesso negado' });
      }
      const targetDriverId = Number(req.params.driverId);
      if (isDriver(actor.role)) {
        const ownDriverId = await resolveOwnDriverId(storage, actor);
        if (!ownDriverId || targetDriverId !== ownDriverId) {
          return res.status(403).json({ message: 'Motorista só pode consultar a própria posição' });
        }
      } else {
        const [targetDriver] = await db
          .select({ id: driversTable.id, empresaId: driversTable.empresaId })
          .from(driversTable)
          .where(eq(driversTable.id, targetDriverId))
          .limit(1);
        if (!canAccessDriverRecord(actor, targetDriver)) {
          return res.status(404).json({ message: 'Motorista não encontrado' });
        }
      }
      const pos = await storage.getLatestGpsPosition(targetDriverId);
      res.json(pos || null);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ─── Delivery Checklist ────────────────────────────────────────────────────────
  app.get('/api/deliveries/:id/checklist', requireAuthCore, async (req: any, res) => {
    try {
      const actor = await storage.getUser(req.session.userId);
      if (!actor) return res.status(401).json({ message: 'Não autenticado' });
      const deliveryId = Number(req.params.id);
      const delivery = await getAuthorizedDelivery(deliveryId, actor);
      if (!delivery) return res.status(404).json({ message: 'Entrega não encontrada' });
      const checklist = await storage.getDeliveryChecklist(deliveryId);
      res.json(checklist || null);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post('/api/deliveries/:id/checklist', requireAuthCore, async (req: any, res) => {
    try {
      const actor = await storage.getUser(req.session.userId);
      if (!actor) return res.status(401).json({ message: 'Não autenticado' });
      const deliveryId = Number(req.params.id);
      const delivery = await getAuthorizedDelivery(deliveryId, actor);
      if (!delivery) return res.status(404).json({ message: 'Entrega não encontrada' });
      const { observacao, driverId, entregaConfirmada } = req.body;

      // Create checklist record
      const checklist = await storage.createDeliveryChecklist({
        deliveryId,
        driverId: driverId || null,
        entregaConfirmada: entregaConfirmada !== false,
        observacao: observacao || null,
        assinaturaUrl: null,
        fotoUrl: null,
        horarioEntrega: new Date(),
      });

      // Update delivery status to 'entregue'
      if (entregaConfirmada !== false) {
        await storage.updateDelivery(deliveryId, {
          status: 'entregue',
          deliveredAt: new Date(),
        });
        // Also update the linked order: mark as DELIVERED and liberate for NF-e
        if (delivery?.orderId) {
          try {
            await storage.updateOrder(delivery.orderId, {
              status: 'DELIVERED',
              fiscalStatus: 'nota_liberada',
            });
          } catch (_) {}
        }
      }

      // Audit log
      await logisticsAudit(req, 'CHECKLIST_ENTREGA', `Entrega ${deliveryId} confirmada`, deliveryId, 'delivery');

      res.json({ checklist, message: 'Entrega confirmada com sucesso!' });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ─── FASE 2 — Stop Status ─────────────────────────────────────────────────────
  // POST /api/deliveries/:id/stop-status
  // Registra um evento de status para uma parada individual.
  app.post('/api/deliveries/:id/stop-status', requireAuthCore, async (req: any, res) => {
    try {
      const actor = await storage.getUser(req.session.userId);
      if (!actor) return res.status(401).json({ message: 'Não autenticado' });

      const deliveryId = Number(req.params.id);
      const { status, observacao } = req.body as { status: string; observacao?: string };

      if (!status || !VALID_STOP_STATUSES.has(status)) {
        return res.status(400).json({
          message: `Status inválido. Valores aceitos: ${[...VALID_STOP_STATUSES].join(', ')}`,
        });
      }

      const delivery = await getAuthorizedDelivery(deliveryId, actor);
      if (!delivery) return res.status(404).json({ message: 'Entrega não encontrada' });

      const now = new Date();

      // 1. Create history event
      await db.insert(deliveryStopEvents).values({
        deliveryId,
        status,
        observacao: observacao?.trim() || null,
        registeredById: actor.id,
        registeredBy: actor.name || actor.email || null,
        registeredByRole: actor.role || null,
      });

      // 2. Update delivery with new status + metadata
      const deliveryUpdate: any = {
        status: status === 'entregue' ? 'entregue' : status,
        stopStatusAt: now,
        stopStatusBy: actor.name || actor.email || null,
        stopStatusByRole: actor.role || null,
        stopObservacao: observacao?.trim() || null,
      };
      if (status === 'entregue') deliveryUpdate.deliveredAt = now;
      await storage.updateDelivery(deliveryId, deliveryUpdate);

      // 3. If entregue, also update the linked order
      if (status === 'entregue' && delivery.orderId) {
        try {
          await storage.updateOrder(delivery.orderId, {
            status: 'DELIVERED',
            fiscalStatus: 'nota_liberada',
          });
        } catch (_) {}
      }

      // 4. Logistics audit
      await logisticsAudit(
        req,
        `STOP_STATUS_${status.toUpperCase()}`,
        `Parada ${deliveryId} → ${status}${observacao ? ` | obs: ${observacao}` : ''}`,
        deliveryId,
        'delivery',
      );

      res.json({ success: true, status, registeredAt: now.toISOString() });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // GET /api/deliveries/:id/stop-events
  // Retorna o histórico completo de eventos de status de uma parada.
  app.get('/api/deliveries/:id/stop-events', requireAuthCore, async (req: any, res) => {
    try {
      const actor = await storage.getUser(req.session.userId);
      if (!actor) return res.status(401).json({ message: 'Não autenticado' });
      const deliveryId = Number(req.params.id);
      const delivery = await getAuthorizedDelivery(deliveryId, actor);
      if (!delivery) return res.status(404).json({ message: 'Entrega não encontrada' });
      const events = await db
        .select()
        .from(deliveryStopEvents)
        .where(eq(deliveryStopEvents.deliveryId, deliveryId))
        .orderBy(desc(deliveryStopEvents.registeredAt));
      res.json(events);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ─── Public Customer Tracking ─────────────────────────────────────────────────
  // Tokens are issued only to authenticated users who can already view the
  // delivery. The public handler verifies the signed token before any lookup.
  app.post('/api/track/token', requireAuthCore, async (req: any, res) => {
    try {
      const actor = await storage.getUser(req.session.userId);
      if (!actor) return res.status(401).json({ message: 'Não autenticado' });

      const deliveryId = Number(req.body?.deliveryId);
      if (!Number.isInteger(deliveryId) || deliveryId <= 0) {
        return res.status(400).json({ message: 'Entrega inválida' });
      }
      const delivery = await getAuthorizedDelivery(deliveryId, actor);
      if (!delivery) return res.status(404).json({ message: 'Entrega não encontrada' });
      if (!delivery.routeId || delivery.status === 'cancelado') {
        return res.status(409).json({ message: 'O link de rastreamento ficará disponível quando a entrega estiver vinculada a uma rota.' });
      }

      const issued = createPublicTrackingToken('delivery', deliveryId);
      res.json({
        token: issued.token,
        expiresAt: issued.expiresAt,
        path: `/track/${issued.token}`,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get('/api/track/:token', publicTrackingLimiter, async (req: any, res) => {
    try {
      const claims = verifyPublicTrackingToken(req.params.token, 'delivery');
      if (!claims) {
        return res.status(403).json({ message: 'Link de rastreamento inválido ou expirado' });
      }

      const payload = await getPublicDeliveryTracking(claims.resourceId);
      if (!payload) {
        return res.status(410).json({ message: 'Este link de rastreamento não está mais disponível.' });
      }
      res.json(payload);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });
  // ─── Driver Operations: journey, odometer, fuel and delivery proof ───────────
  const operationalActor = async (req: any, res: any) => {
    const actor = await storage.getUser(req.session.userId);
    if (!actor) { res.status(401).json({ message: 'Não autenticado' }); return null; }
    if (!isDriverOrInternal(actor.role)) { res.status(403).json({ message: 'Acesso negado' }); return null; }
    const ownDriverId = await resolveOwnDriverId(storage, actor);
    if (isDriver(actor.role) && !ownDriverId) { res.status(403).json({ message: 'Motorista sem cadastro operacional vinculado' }); return null; }
    return { actor, driverId: ownDriverId ?? (Number(req.body?.driverId) || null) };
  };
  const numberOrNull = (value: unknown) => value == null || value === '' ? null : Number(value);
  const validCoordinate = (lat: unknown, lng: unknown) => {
    const a = numberOrNull(lat), b = numberOrNull(lng);
    return (a == null && b == null) || (a != null && b != null && Number.isFinite(a) && Number.isFinite(b) && a >= -90 && a <= 90 && b >= -180 && b <= 180);
  };
  const idempotent = (req: any) => String(req.get('Idempotency-Key') || req.body?.idempotencyKey || '').trim();
  app.get('/api/driver/journey/today', requireAuthCore, async (req: any, res) => {
    try { const ctx = await operationalActor(req, res); if (!ctx?.driverId) return res.status(400).json({ message: 'Motorista não identificado' }); const rows = await db.select().from(driverJourneys).where(eq(driverJourneys.driverId, ctx.driverId)).orderBy(desc(driverJourneys.startedAt)).limit(10); res.json(rows); } catch (e: any) { res.status(500).json({ message: e.message }); }
  });
  app.post('/api/driver/journey/start', requireAuthCore, async (req: any, res) => {
    try { const ctx = await operationalActor(req, res); if (!ctx?.driverId) return res.status(400).json({ message: 'Motorista não identificado' }); const key = idempotent(req); if (!key) return res.status(400).json({ message: 'Idempotency-Key é obrigatório' }); const existing = await db.select().from(driverJourneys).where(eq(driverJourneys.idempotencyKey, key)).limit(1); if (existing[0]) return res.json(existing[0]); const active = await db.select().from(driverJourneys).where(and(eq(driverJourneys.driverId, ctx.driverId), eq(driverJourneys.status, 'active'))).limit(1); if (active[0]) return res.status(409).json({ message: 'Já existe uma jornada ativa', journey: active[0] }); const lat = numberOrNull(req.body?.latitude), lng = numberOrNull(req.body?.longitude), odo = numberOrNull(req.body?.odometer); if (!validCoordinate(lat, lng) || (odo != null && (!Number.isFinite(odo) || odo < 0))) return res.status(400).json({ message: 'Localização ou odômetro inválido' }); const [row] = await db.insert(driverJourneys).values({ driverId: ctx.driverId, empresaId: ctx.actor.empresaId ?? null, vehicleId: numberOrNull(req.body?.vehicleId), startLatitude: lat?.toString(), startLongitude: lng?.toString(), startOdometer: odo?.toString(), observation: String(req.body?.observation || '').trim() || null, deviceId: req.get('X-Device-Id') || null, idempotencyKey: key }).returning(); res.status(201).json(row); } catch (e: any) { res.status(500).json({ message: e.message }); }
  });
  app.post('/api/driver/journey/end', requireAuthCore, async (req: any, res) => {
    try { const ctx = await operationalActor(req, res); if (!ctx?.driverId) return res.status(400).json({ message: 'Motorista não identificado' }); const key = idempotent(req); if (!key) return res.status(400).json({ message: 'Idempotency-Key é obrigatório' }); const existing = await db.select().from(driverJourneys).where(eq(driverJourneys.idempotencyKey, key)).limit(1); if (existing[0]) return res.json(existing[0]); const active = await db.select().from(driverJourneys).where(and(eq(driverJourneys.driverId, ctx.driverId), eq(driverJourneys.status, 'active'))).orderBy(desc(driverJourneys.startedAt)).limit(1); if (!active[0]) return res.status(409).json({ message: 'Nenhuma jornada ativa' }); const odo = numberOrNull(req.body?.odometer), start = active[0].startOdometer == null ? null : Number(active[0].startOdometer); if (odo != null && (!Number.isFinite(odo) || (start != null && odo < start))) return res.status(400).json({ message: 'Odômetro final inválido' }); const lat = numberOrNull(req.body?.latitude), lng = numberOrNull(req.body?.longitude); if (!validCoordinate(lat, lng)) return res.status(400).json({ message: 'Localização inválida' }); const [row] = await db.update(driverJourneys).set({ status: 'ended', endedAt: new Date(), endLatitude: lat?.toString(), endLongitude: lng?.toString(), endOdometer: odo?.toString(), observation: String(req.body?.observation || '').trim() || active[0].observation, idempotencyKey: key }).where(eq(driverJourneys.id, active[0].id)).returning(); res.json(row); } catch (e: any) { res.status(500).json({ message: e.message }); }
  });
  app.get('/api/driver/odometer/today', requireAuthCore, async (req: any, res) => {
    try { const ctx = await operationalActor(req, res); if (!ctx?.driverId) return res.status(400).json({ message: 'Motorista não identificado' }); res.json(await db.select().from(driverOdometerEntries).where(eq(driverOdometerEntries.driverId, ctx.driverId)).orderBy(desc(driverOdometerEntries.recordedAt)).limit(100)); } catch (e: any) { res.status(500).json({ message: e.message }); }
  });
  app.post('/api/driver/odometer', requireAuthCore, async (req: any, res) => {
    try { const ctx = await operationalActor(req, res); if (!ctx?.driverId) return res.status(400).json({ message: 'Motorista não identificado' }); const key = idempotent(req); const value = numberOrNull(req.body?.odometer); if (!key || value == null || !Number.isFinite(value) || value < 0) return res.status(400).json({ message: 'Idempotency-Key e odômetro válido são obrigatórios' }); const existing = await db.select().from(driverOdometerEntries).where(eq(driverOdometerEntries.idempotencyKey, key)).limit(1); if (existing[0]) return res.json(existing[0]); const [row] = await db.insert(driverOdometerEntries).values({ driverId: ctx.driverId, empresaId: ctx.actor.empresaId ?? null, vehicleId: numberOrNull(req.body?.vehicleId), journeyId: numberOrNull(req.body?.journeyId), value: value.toString(), entryType: String(req.body?.type || 'manual'), observation: String(req.body?.observation || '').trim() || null, idempotencyKey: key }).returning(); res.status(201).json(row); } catch (e: any) { res.status(500).json({ message: e.message }); }
  });
  app.get('/api/driver/fuel', requireAuthCore, async (req: any, res) => {
    try { const ctx = await operationalActor(req, res); if (!ctx?.driverId) return res.status(400).json({ message: 'Motorista não identificado' }); res.json(await db.select().from(driverFuelEntries).where(eq(driverFuelEntries.driverId, ctx.driverId)).orderBy(desc(driverFuelEntries.recordedAt)).limit(100)); } catch (e: any) { res.status(500).json({ message: e.message }); }
  });
  app.post('/api/driver/fuel', requireAuthCore, async (req: any, res) => {
    try { const ctx = await operationalActor(req, res); if (!ctx?.driverId) return res.status(400).json({ message: 'Motorista não identificado' }); const key = idempotent(req), liters = numberOrNull(req.body?.liters), unitPrice = numberOrNull(req.body?.unitPrice), total = numberOrNull(req.body?.totalAmount); if (!key || liters == null || unitPrice == null || total == null || liters <= 0 || unitPrice < 0 || total < 0 || !req.body?.fuelType) return res.status(400).json({ message: 'Dados de abastecimento inválidos' }); if (String(req.body?.receiptBase64 || '').length > 8_000_000) return res.status(413).json({ message: 'Comprovante excede o limite de tamanho' }); const existing = await db.select().from(driverFuelEntries).where(eq(driverFuelEntries.idempotencyKey, key)).limit(1); if (existing[0]) return res.json(existing[0]); const [row] = await db.insert(driverFuelEntries).values({ driverId: ctx.driverId, empresaId: ctx.actor.empresaId ?? null, vehicleId: numberOrNull(req.body?.vehicleId), liters: liters.toString(), unitPrice: unitPrice.toString(), totalAmount: total.toString(), odometer: numberOrNull(req.body?.odometer)?.toString(), fuelType: String(req.body.fuelType).slice(0, 40), stationName: String(req.body?.stationName || '').slice(0, 160) || null, receiptBase64: req.body?.receiptBase64 || null, observation: String(req.body?.observation || '').slice(0, 1000) || null, idempotencyKey: key }).returning(); res.status(201).json(row); } catch (e: any) { res.status(500).json({ message: e.message }); }
  });
  app.post('/api/deliveries/:id/proof', requireAuthCore, async (req: any, res) => {
    try { const ctx = await operationalActor(req, res); if (!ctx?.driverId) return res.status(400).json({ message: 'Motorista não identificado' }); const delivery = await getAuthorizedDelivery(Number(req.params.id), ctx.actor); if (!delivery) return res.status(404).json({ message: 'Entrega não encontrada' }); const key = idempotent(req), signature = String(req.body?.signatureBase64 || ''), photos = Array.isArray(req.body?.photos) ? req.body.photos : []; if (!key || (!signature && photos.length === 0)) return res.status(400).json({ message: 'Idempotency-Key e assinatura ou foto são obrigatórios' }); if (signature.length > 2_000_000 || photos.length > 3 || photos.some((p: any) => String(p).length > 6_000_000)) return res.status(413).json({ message: 'Arquivos excedem os limites permitidos' }); const existing = await db.select().from(deliveryProofs).where(eq(deliveryProofs.idempotencyKey, key)).limit(1); if (existing[0]) return res.json(existing[0]); const [row] = await db.insert(deliveryProofs).values({ deliveryId: Number(req.params.id), driverId: ctx.driverId, empresaId: ctx.actor.empresaId ?? null, signatureBase64: signature || null, photosJson: photos.length ? JSON.stringify(photos) : null, observation: String(req.body?.observation || '').slice(0, 1000) || null, latitude: numberOrNull(req.body?.latitude)?.toString(), longitude: numberOrNull(req.body?.longitude)?.toString(), idempotencyKey: key }).returning(); res.status(201).json(row); } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

}
