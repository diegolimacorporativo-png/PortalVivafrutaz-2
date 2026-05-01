import type { Express } from "express";
import { storage } from "../services/storage.ts";
import { tenantContext } from "../middleware/tenant";
import { currentTenantId } from "../core/tenant/context";
import { isDriverOrInternal, resolveOwnDriverId } from "../modules/logistics/driver.access";
import { requireAuth as requireAuthCore } from "../core/http/requireAuth";

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

      const allCompanies = await storage.getCompanies();
      const companyMap = Object.fromEntries(allCompanies.map((c: any) => [c.id, c]));

      const drivers = await storage.getDrivers();
      const myDriver = drivers.find((d: any) =>
        d.email === actor.email || d.name === actor.name
      );

      // STEP 8.7 — DRIVER must have a matching logistics_drivers row;
      // without it we can't safely determine ownership, so return empty.
      if (actor.role === 'DRIVER' && !myDriver) {
        return res.json({ deliveries: [], driver: null, date: today, source: 'deliveries' });
      }

      // Try deliveries table first
      let allDeliveries = await storage.getDeliveries({ date: today });
      let source: 'deliveries' | 'orders' = 'deliveries';

      // If deliveries table is empty, bridge from today's orders
      if (allDeliveries.length === 0) {
        source = 'orders';
        const allOrders = await storage.getOrders();
        const todayOrders = allOrders.filter((o: any) => {
          if (!o.deliveryDate) return false;
          const d = new Date(o.deliveryDate);
          return d.toISOString().split('T')[0] === today;
        });
        const statusMap: Record<string, string> = {
          CONFIRMED: 'pendente', ACTIVE: 'pendente',
          DELIVERED: 'entregue', CANCELLED: 'cancelado', LOCKED: 'pendente',
        };
        allDeliveries = todayOrders.map((o: any, idx: number) => ({
          id: o.id,
          companyId: o.companyId,
          status: statusMap[o.status] || 'pendente',
          scheduledDate: today,
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
        deliveries = allDeliveries.filter((d: any) => d.driverId === myDriver.id);
      } else if (myDriver) {
        deliveries = allDeliveries.filter((d: any) => !d.driverId || d.driverId === myDriver.id);
      } else {
        deliveries = allDeliveries;
      }

      const enriched = deliveries.map((d: any) => ({
        ...d,
        companyName: companyMap[d.companyId]?.companyName || companyMap[d.companyId]?.name || '—',
        deliveryWindowStart: companyMap[d.companyId]?.deliveryWindowStart || null,
        deliveryWindowEnd: companyMap[d.companyId]?.deliveryWindowEnd || null,
        addressStreet: d.addressStreet || companyMap[d.companyId]?.addressStreet || null,
        addressCity: d.addressCity || companyMap[d.companyId]?.addressCity || null,
        latitude: d.latitude || companyMap[d.companyId]?.latitude || null,
        longitude: d.longitude || companyMap[d.companyId]?.longitude || null,
      }));

      res.json({ deliveries: enriched, driver: myDriver || null, date: today, source });
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

      const { driverId, latitude, longitude, accuracy, speed, heading } = req.body;
      if (!driverId || !latitude || !longitude) return res.status(400).json({ message: 'driverId, latitude e longitude obrigatórios' });

      // STEP 8.7 — drivers can only post GPS for THEIR OWN driverId. This stops
      // a compromised driver account from spoofing positions for someone else.
      // Internal staff (admin / logistics) keep the legacy ability to post on
      // behalf of any driver (used by the route-assistant tooling).
      if (actor.role === 'DRIVER') {
        const ownDriverId = await resolveOwnDriverId(storage, actor);
        if (!ownDriverId || Number(driverId) !== ownDriverId) {
          return res.status(403).json({ message: 'Motorista não pode enviar GPS de outra conta' });
        }
      }

      const pos = await storage.createGpsPosition({ driverId, latitude, longitude, accuracy, speed, heading });
      res.json(pos);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
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
