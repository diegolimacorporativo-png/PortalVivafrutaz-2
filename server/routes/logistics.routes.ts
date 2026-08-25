import type { Express } from "express";
import { storage } from "../services/storage.ts";
import { tenantContext } from "../middleware/tenant";
import { currentTenantId } from "../core/tenant/context";
import { isDriver, isDriverOrInternal, isInternal, resolveOwnDriverId } from "../modules/logistics/driver.access";
import { LOGISTICS_AUTH_ROLES } from "../modules/logistics/logistics.types";
import { requireAuth as requireAuthCore } from "../core/http/requireAuth";
import { db } from "../database/db";
import { ForbiddenError } from "../shared/errors/AppError";
import {
  logisticsDrivers as driversTable,
  users as usersTable,
  logisticsRoutes as routesTable,
  orders as ordersTable,
  deliveries as deliveriesTable,
  deliveryStopEvents,
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
      const d = await storage.getDelivery(Number(req.params.id));
      if (!d) return res.status(404).json({ message: 'Entrega não encontrada' });
      res.json(d);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post('/api/deliveries', requireAuthCore, async (req: any, res) => {
    try {
      const delivery = await storage.createDelivery(req.body);
      res.status(201).json(delivery);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.put('/api/deliveries/:id', requireAuthCore, async (req: any, res) => {
    try {
      const delivery = await storage.updateDelivery(Number(req.params.id), req.body);
      res.json(delivery);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.patch('/api/deliveries/:id/status', requireAuthCore, async (req: any, res) => {
    try {
      const { status } = req.body;
      const updates: any = { status };
      if (status === 'entregue') updates.deliveredAt = new Date();
      const delivery = await storage.updateDelivery(Number(req.params.id), updates);
      res.json(delivery);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.delete('/api/deliveries/:id', requireAuthCore, async (req: any, res) => {
    try {
      await storage.deleteDelivery(Number(req.params.id));
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
   * Internal roles keep their existing visibility; a tenant-pinned internal
   * user remains restricted to that tenant. An unscoped cross-tenant admin
   * keeps the existing support/reporting behavior.
   */
  async function getAuthorizedDelivery(deliveryId: number, actor: any): Promise<any | undefined> {
    const delivery = await storage.getDelivery(deliveryId);
    if (!delivery) return undefined;

    const tenantId = currentTenantId() ?? (actor?.empresaId ?? null);
    if (tenantId != null && Number(delivery.companyId) !== Number(tenantId)) {
      throw new ForbiddenError('Acesso negado');
    }

    if (isDriver(actor?.role)) {
      const ownDriverId = await resolveOwnDriverId(storage, actor);
      if (!ownDriverId) throw new ForbiddenError('Motorista não vinculado');

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
        throw new ForbiddenError('Entrega não pertence ao motorista');
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
      const companyMap = Object.fromEntries(allCompanies.map((c: any) => [c.id, c]));

      // FASE MT-1 — driver lookup scoped to actor's tenant in SQL (no full-table scan).
      const driverIdentity: SQL<unknown>[] = [];
      if (actor.email) driverIdentity.push(eq(driversTable.email, actor.email));
      if (actor.name) driverIdentity.push(eq(driversTable.name, actor.name));
      let myDriver: any = null;
      if (driverIdentity.length > 0) {
        const identityCond: SQL<unknown> =
          driverIdentity.length === 1 ? driverIdentity[0]! : or(...driverIdentity)!;
        const driverWhere: SQL<unknown> = actor.empresaId
          ? and(eq(driversTable.empresaId, actor.empresaId), identityCond)!
          : identityCond;
        const driverRows = await db.select().from(driversTable).where(driverWhere).limit(1);
        myDriver = driverRows[0] ?? null;
      }

      // Search the selected period. Drivers can view unassigned orders from
      // every company, while status mutations remain ownership-protected below.
      const deliveryFilters: any = { dateFrom, dateTo };
      if (selectedCompanyId && Number.isInteger(selectedCompanyId)) deliveryFilters.companyId = selectedCompanyId;
      let allDeliveries = await storage.getDeliveries(deliveryFilters);
      let source: 'deliveries' | 'orders' = 'deliveries';

      // If deliveries table is empty, bridge from today's orders.
      // FASE MT-1: Drizzle query scoped to tenant + date range in SQL — no full-table scan.
      if (allDeliveries.length === 0) {
        source = 'orders';
        const rangeStart = new Date(dateFrom + 'T00:00:00.000Z');
        const rangeEnd = new Date(dateTo + 'T00:00:00.000Z');
        rangeEnd.setUTCDate(rangeEnd.getUTCDate() + 1);
        const orderConds: SQL<unknown>[] = [
          gte(ordersTable.deliveryDate, rangeStart),
          lt(ordersTable.deliveryDate, rangeEnd),
        ];
        if (selectedCompanyId && Number.isInteger(selectedCompanyId)) {
          orderConds.push(eq(ordersTable.companyId, selectedCompanyId));
        } else if (actor.empresaId && actor.role !== 'DRIVER') {
          orderConds.push(eq(ordersTable.companyId, actor.empresaId));
        }
        const todayOrders = await db.select().from(ordersTable).where(and(...orderConds));
        const statusMap: Record<string, string> = {
          CONFIRMED: 'pendente', ACTIVE: 'pendente',
          DELIVERED: 'entregue', CANCELLED: 'cancelado', LOCKED: 'pendente',
        };
        allDeliveries = todayOrders.map((o: any, idx: number) => ({
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
      }

      // STEP 8.7 — DRIVER role gets STRICT filter to its own driverId only;
      // internal admins keep the legacy "unassigned-or-mine" semantics.
      let deliveries: any[];
      if (actor.role === 'DRIVER' && myDriver) {
        deliveries = allDeliveries.filter((d: any) => !d.driverId || d.driverId === myDriver.id);
      } else if (myDriver) {
        deliveries = allDeliveries.filter((d: any) => !d.driverId || d.driverId === myDriver.id);
      } else {
        deliveries = allDeliveries;
      }

      const enriched = deliveries.map((d: any) => ({
        ...d,
        canUpdate: actor.role !== 'DRIVER' || Boolean(myDriver && d.driverId && Number(d.driverId) === Number(myDriver.id)),
        companyName: companyMap[d.companyId]?.companyName || companyMap[d.companyId]?.name || '—',
        deliveryWindowStart: companyMap[d.companyId]?.deliveryWindowStart || null,
        deliveryWindowEnd: companyMap[d.companyId]?.deliveryWindowEnd || null,
        addressStreet: d.addressStreet || companyMap[d.companyId]?.addressStreet || null,
        addressCity: d.addressCity || companyMap[d.companyId]?.addressCity || null,
        latitude: d.latitude || companyMap[d.companyId]?.latitude || null,
        longitude: d.longitude || companyMap[d.companyId]?.longitude || null,
      }));

      res.json({
        deliveries: enriched,
        driver: myDriver || null,
        companies: allCompanies.map((c: any) => ({ id: c.id, name: c.companyName || c.name })),
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
      let driverId = requestedDriverId ? Number(requestedDriverId) : null;
      if (isDriver(actor.role)) {
        const ownDriverId = await resolveOwnDriverId(storage, actor);
        if (!ownDriverId) {
          return res.status(403).json({ message: 'Motorista sem cadastro vinculado ao usuário' });
        }
        if (driverId !== null && driverId !== ownDriverId) {
          return res.status(403).json({ message: 'Motorista não pode enviar GPS de outra conta' });
        }
        driverId = ownDriverId;
      }
      if (!driverId || !Number.isInteger(driverId) || driverId <= 0) {
        return res.status(400).json({ message: 'driverId é obrigatório para usuários internos' });
      }

      // STEP 8.7 — drivers can only post GPS for THEIR OWN driverId. This stops
      // a compromised driver account from spoofing positions for someone else.
      // Internal staff (admin / logistics) keep the legacy ability to post on
      // behalf of any driver (used by the route-assistant tooling).
      if (isDriver(actor.role)) {
        const ownDriverId = await resolveOwnDriverId(storage, actor);
        if (!ownDriverId || Number(driverId) !== ownDriverId) {
          return res.status(403).json({ message: 'Motorista não pode enviar GPS de outra conta' });
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
      if (!actor.empresaId && !(LOGISTICS_AUTH_ROLES as readonly string[]).includes(actor.role)) {
        return res.status(403).json({ message: 'Empresa não definida para este usuário' });
      }

      let driverRows = actor.empresaId
        ? await db.select().from(driversTable).where(eq(driversTable.empresaId, actor.empresaId)).orderBy(driversTable.name)
        : await db.select().from(driversTable).orderBy(driversTable.name);

      // Some legacy installations registered drivers as user accounts with
      // role MOTORISTA/DRIVER but never created the corresponding
      // logistics_drivers row. Keep the operational table as the source of
      // truth when it has data; otherwise expose those accounts as read-only
      // GPS entries so the admin can see every registered driver.
      if (driverRows.length === 0) {
        const userConditions: SQL<unknown>[] = [
          inArray(usersTable.role, ["MOTORISTA", "DRIVER"]),
          eq(usersTable.active, true),
        ];
        if (actor.empresaId) userConditions.push(eq(usersTable.empresaId, actor.empresaId));
        const driverUsers = await db
          .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, active: usersTable.active })
          .from(usersTable)
          .where(and(...userConditions))
          .orderBy(usersTable.name);
        driverRows = driverUsers.map((user: any) => ({
          id: -Number(user.id),
          name: user.name,
          email: user.email,
          phone: null,
          active: user.active,
          virtualFromUser: true,
        })) as any;
      }

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
      if (actor.role === 'DRIVER') {
        const ownDriverId = await resolveOwnDriverId(storage, actor);
        if (!ownDriverId || targetDriverId !== ownDriverId) {
          return res.status(403).json({ message: 'Motorista só pode consultar a própria posição' });
        }
      }
      const pos = await storage.getLatestGpsPosition(targetDriverId);
      res.json(pos || null);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ─── Delivery Checklist ────────────────────────────────────────────────────────
  app.get('/api/deliveries/:id/checklist', async (req: any, res) => {
    try {
      const checklist = await storage.getDeliveryChecklist(Number(req.params.id));
      res.json(checklist || null);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post('/api/deliveries/:id/checklist', requireAuthCore, async (req: any, res) => {
    try {
      const actor = await storage.getUser(req.session.userId);
      if (!actor) return res.status(401).json({ message: 'Não autenticado' });
      const deliveryId = Number(req.params.id);
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
        const delivery = await storage.getDelivery(deliveryId);
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

      const delivery = await storage.getDelivery(deliveryId);
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
      const deliveryId = Number(req.params.id);
      const events = await db
        .select()
        .from(deliveryStopEvents)
        .where(eq(deliveryStopEvents.deliveryId, deliveryId))
        .orderBy(desc(deliveryStopEvents.registeredAt));
      res.json(events);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ─── Public Customer Tracking ─────────────────────────────────────────────────
  app.get('/api/track/:deliveryId', async (req: any, res) => {
    try {
      const delivery = await storage.getDelivery(Number(req.params.deliveryId));
      if (!delivery) return res.status(404).json({ message: 'Entrega não encontrada' });

      // Get route info for position calculation
      const allDeliveries = delivery.scheduledDate
        ? await storage.getDeliveries({ date: delivery.scheduledDate })
        : [];
      const routeDeliveries = delivery.routeId
        ? allDeliveries.filter((d: any) => d.routeId === delivery.routeId).sort((a: any, b: any) => (a.routePosition || 0) - (b.routePosition || 0))
        : [];

      const completedBefore = routeDeliveries.filter((d: any) =>
        d.status === 'entregue' && (d.routePosition || 0) < (delivery.routePosition || 0)
      ).length;

      // ETA calculation: 15 min per stop
      const stopsRemaining = (delivery.routePosition || 1) - completedBefore;
      const etaMinutes = Math.max(0, stopsRemaining * 15);
      const etaTime = new Date(Date.now() + etaMinutes * 60000);

      // GPS position if available
      let driverPosition = null;
      if (delivery.driverId) {
        driverPosition = await storage.getLatestGpsPosition(delivery.driverId);
      }

      res.json({
        id: delivery.id,
        status: delivery.status,
        companyId: delivery.companyId,
        scheduledDate: delivery.scheduledDate,
        deliveredAt: delivery.deliveredAt,
        routePosition: delivery.routePosition,
        totalStopsInRoute: routeDeliveries.length,
        stopsAhead: stopsRemaining,
        etaMinutes,
        etaTime: etaTime.toISOString(),
        driverPosition: driverPosition ? {
          lat: driverPosition.latitude,
          lng: driverPosition.longitude,
          updatedAt: driverPosition.recordedAt,
        } : null,
      });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });
}
