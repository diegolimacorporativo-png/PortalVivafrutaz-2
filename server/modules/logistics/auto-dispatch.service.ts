/**
 * Auto-Dispatch Service — VivaFrutaz Smart Logistics
 *
 * Orchestrator that periodically picks up pending deliveries (route_id IS NULL,
 * status = 'pendente') and assigns each one to the cheapest existing driver
 * route using the SAME route-optimisation function the manual "suggest route"
 * endpoint already uses (`suggestInsertion` from
 * `server/services/logistics/routeOptimizer.ts`).
 *
 * ─── Why we reuse `suggestInsertion` ─────────────────────────────────────────
 * The discovery audit (STEP 0) confirmed:
 *   • `routeOptimizer.ts` is the ONLY low-level optimiser in the codebase.
 *   • Both `logisticsService.suggestRoute()` and the manual UI flow already call
 *     `suggestInsertion(newPoint, driverRoutes)`.
 *   • There is no other "smart-route-plan" / "suggest-route" file — those names
 *     refer to wrapper methods on `logisticsService` that ultimately delegate
 *     to `suggestInsertion`.
 * Reusing it guarantees identical behaviour between automatic and manual
 * dispatch and avoids any duplicated optimisation logic.
 *
 * ─── Idempotency ─────────────────────────────────────────────────────────────
 * The selector filters on `route_id IS NULL`. As soon as we successfully set
 * `route_id` the delivery row drops out of the candidate set, so re-running the
 * worker (every 10 s) is a no-op for already-dispatched deliveries.
 *
 * ─── Fail-safe ───────────────────────────────────────────────────────────────
 * Every per-delivery branch is wrapped in try/catch and any thrown error is
 * logged but never propagated, so a single bad row can never poison the loop.
 */

import { sql } from "drizzle-orm";
import { db } from "../../database/db";
import {
  suggestInsertion,
  type DriverRoute,
  type GeoPoint,
} from "../../services/logistics/routeOptimizer";
// FASE 8.6I — isolamento multi-tenant: cada grupo (company_id, date) executa
// dentro de runWithTenant(...) com um principal sintético "admin/SERVICE"
// pinado no companyId do grupo. Necessário para que storage/services tenant
// scoped não vazem dados entre empresas durante o dispatch automático.
import { runWithTenant, type TenantPrincipal } from "../../core/tenant/context";
import { logSecurity } from "../../core/security/securityLogger";
import { registerJob, startJobRun, finishJobRun, recoverStaleJob } from "../../core/jobs/job-registry";
import { incJobFailures } from "../../core/observability/metrics";

const JOB_NAME = "auto-dispatch";
registerJob(JOB_NAME);

const TICK_MS = 10_000;

interface PendingDeliveryRow {
  id: number;
  order_id: number | null;
  company_id: number | null;
  delivery_date: string | null;
  latitude: string | null;
  longitude: string | null;
}

interface RouteRow {
  id: number;
  driver_id: number | null;
  driver_name: string | null;
  vehicle_id: number | null;
  vehicle_plate: string | null;
  delivery_date: string | null;
  has_route_stops?: boolean | string;
}

interface AssignedStopRow {
  route_id: number;
  company_id: number | null;
  latitude: string | null;
  longitude: string | null;
  route_position: number | null;
  ordem_parada?: number | null;
}

type DispatchDriverRoute = DriverRoute & {
  sequenceSource: "route_stops" | "deliveries";
};

function rowsOf<T = any>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: T[] } | null)?.rows;
  return Array.isArray(rows) ? rows : [];
}

/**
 * Build a `DriverRoute[]` snapshot for the routes scheduled on `date`,
 * pre-populated with the deliveries already attached to each route so
 * `suggestInsertion` can compute a realistic insertion cost.
 *
 * FASE 8.6I — `companyId` é OBRIGATÓRIO: o filtro `empresa_id = $companyId`
 * garante que apenas rotas da própria empresa sejam consideradas pelo
 * `suggestInsertion`. Sem isso, deliveries da Empresa A poderiam ser
 * fisicamente atribuídas a rotas/motoristas da Empresa B.
 */
async function loadDriverRoutesForDate(
  date: string | null,
  companyId: number,
): Promise<DispatchDriverRoute[]> {
  const routes = rowsOf<RouteRow>(
    await db.execute(
      date
        ? sql`SELECT lr.id, lr.driver_id, lr.driver_name, lr.vehicle_id, lr.vehicle_plate,
                     lr.delivery_date::text AS delivery_date,
                     EXISTS (
                       SELECT 1 FROM route_stops rs WHERE rs.route_id = lr.id
                     ) AS has_route_stops
              FROM   logistics_routes lr
              WHERE  lr.delivery_date = ${date}::date
                AND  lr.empresa_id    = ${companyId}
                AND  lr.driver_id IS NOT NULL
                AND  lr.status IN ('SCHEDULED', 'IN_PROGRESS')`
        : sql`SELECT lr.id, lr.driver_id, lr.driver_name, lr.vehicle_id, lr.vehicle_plate,
                     lr.delivery_date::text AS delivery_date,
                     EXISTS (
                       SELECT 1 FROM route_stops rs WHERE rs.route_id = lr.id
                     ) AS has_route_stops
              FROM   logistics_routes lr
              WHERE  lr.empresa_id = ${companyId}
                AND  lr.driver_id IS NOT NULL
                AND  lr.status IN ('SCHEDULED', 'IN_PROGRESS')`,
    ),
  );

  if (routes.length === 0) return [];

  const routeIds = routes.map((r) => r.id);
  const assignedDeliveries = rowsOf<AssignedStopRow>(
    await db.execute(
      sql`SELECT route_id,
                 COALESCE(d.company_id, o.company_id) AS company_id,
                 latitude::text  AS latitude,
                 longitude::text AS longitude,
                 route_position
          FROM   deliveries d
          LEFT   JOIN orders o ON o.id = d.order_id
          WHERE  d.route_id = ANY(${routeIds}::int[])
            AND  COALESCE(d.company_id, o.company_id) = ${companyId}
            AND  d.latitude  IS NOT NULL
            AND  d.longitude IS NOT NULL
          ORDER  BY d.route_position NULLS LAST, d.id ASC`,
    ),
  );
  const routeStops = rowsOf<AssignedStopRow>(
    await db.execute(
      sql`SELECT route_id,
                 company_id,
                 latitude::text  AS latitude,
                 longitude::text AS longitude,
                 ordem_parada
          FROM   route_stops
          WHERE  route_id = ANY(${routeIds}::int[])
            AND  company_id = ${companyId}
            AND  latitude IS NOT NULL
            AND  longitude IS NOT NULL
          ORDER  BY route_id ASC, ordem_parada ASC NULLS LAST, id ASC`,
    ),
  );

  const deliveryStopsByRoute = new Map<number, GeoPoint[]>();
  for (const s of assignedDeliveries) {
    const lat = s.latitude ? parseFloat(s.latitude) : NaN;
    const lng = s.longitude ? parseFloat(s.longitude) : NaN;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const arr = deliveryStopsByRoute.get(s.route_id) ?? [];
    arr.push({ lat, lng, companyId: s.company_id ?? undefined });
    deliveryStopsByRoute.set(s.route_id, arr);
  }
  const routeStopsByRoute = new Map<number, GeoPoint[]>();
  for (const s of routeStops) {
    const lat = s.latitude ? parseFloat(s.latitude) : NaN;
    const lng = s.longitude ? parseFloat(s.longitude) : NaN;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const arr = routeStopsByRoute.get(s.route_id) ?? [];
    arr.push({ lat, lng, companyId: s.company_id ?? undefined });
    routeStopsByRoute.set(s.route_id, arr);
  }

  return routes.map<DispatchDriverRoute>((r) => {
    const canonicalStops = routeStopsByRoute.get(r.id);
    const hasOfficialStops = r.has_route_stops === true || r.has_route_stops === "true" || r.has_route_stops === "t";
    const points = hasOfficialStops
      ? canonicalStops ?? []
      : deliveryStopsByRoute.get(r.id) ?? [];
    let totalDistance = 0;
    return {
      driverId:    r.driver_id ?? 0,
      driverName:  r.driver_name ?? "Motorista",
      vehicleId:   r.vehicle_id ?? undefined,
      vehiclePlate: r.vehicle_plate ?? undefined,
      routeId:     r.id,
      stops: points.map((p, idx) => ({
        ...p,
        position: idx,
      })),
      totalDistance,
      estimatedMinutes: 0,
      sequenceSource: hasOfficialStops ? "route_stops" : "deliveries",
    };
  });
}

// The current optimizer ranks insertions by incremental distance. Route date,
// tenant, active state, and assigned driver are hard eligibility checks above.
// Delivery windows and vehicle capacity are not yet safe optimizer constraints:
// route windows are per-stop text fields and vehicle capacity has no normalized
// unit/load contract, so inferring either here could reject valid work or
// overfill a vehicle without a defensible measurement.

/**
 * Single tick of the auto-dispatcher.
 *
 * Steps:
 *   1. Fetch pending deliveries that have geo coordinates and no route yet.
 *   2. Group them by `delivery_date` so we only consult routes for the
 *      relevant day.
 *   3. For each delivery, ask `suggestInsertion` for the best slot in any
 *      existing route on that date.
 *   4. If a suggestion comes back, atomically attach the delivery to the
 *      suggested route/driver — but ONLY if it is still un-routed (the
 *      `route_id IS NULL` guard preserves idempotency under concurrent ticks).
 *
 * Returns the number of deliveries that were assigned in this tick.
 */
export async function autoDispatchReadyOrders(): Promise<number> {
  let assigned = 0;

  let pending: PendingDeliveryRow[];
  try {
    pending = rowsOf<PendingDeliveryRow>(
      await db.execute(
        sql`SELECT d.id,
                   d.order_id,
                    COALESCE(d.company_id, o.company_id) AS company_id,
                   COALESCE(d.scheduled_date::text,
                            o.delivery_date::date::text) AS delivery_date,
                   COALESCE(d.latitude, c.latitude)::text  AS latitude,
                   COALESCE(d.longitude, c.longitude)::text AS longitude
            FROM   deliveries d
            LEFT   JOIN orders     o ON o.id = d.order_id
            LEFT   JOIN companies  c ON c.id = COALESCE(d.company_id, o.company_id)
            WHERE  d.route_id IS NULL
              AND  d.status   = 'pendente'
              AND  COALESCE(d.company_id, o.company_id) IS NOT NULL
              AND  COALESCE(d.latitude,  c.latitude)  IS NOT NULL
              AND  COALESCE(d.longitude, c.longitude) IS NOT NULL
            ORDER  BY d.id ASC
            LIMIT  50`,
      ),
    );
  } catch (err: any) {
    logSecurity(`[LOGISTICS_DISPATCH_FAILED] step=load_pending | error=${err?.message ?? "unknown"}`);
    console.error("[AUTO-DISPATCH] Failed to load pending deliveries:", err);
    return 0;
  }

  if (pending.length === 0) return 0;

  // FASE 8.6I — agrupamento por (company_id, delivery_date) garante que
  // suggestInsertion NUNCA receba rotas/motoristas de outra empresa no mesmo
  // array, eliminando o risco de cross-tenant write. Deliveries sem
  // company_id ficam num grupo próprio e são puladas (não há tenant alvo
  // seguro para atribuir).
  type GroupKey = string;
  const byTenantAndDate = new Map<
    GroupKey,
    {
      companyId: number | null;
      date: string | null;
      deliveries: PendingDeliveryRow[];
    }
  >();
  for (const row of pending) {
    const datePart = row.delivery_date ?? "__no_date__";
    const companyPart = row.company_id ?? "__no_company__";
    const key = `${companyPart}__${datePart}`;
    const bucket = byTenantAndDate.get(key) ?? {
      companyId: row.company_id ?? null,
      date: row.delivery_date ?? null,
      deliveries: [] as PendingDeliveryRow[],
    };
    bucket.deliveries.push(row);
    byTenantAndDate.set(key, bucket);
  }

  for (const [groupKey, group] of byTenantAndDate.entries()) {
    // FASE 8.6I — sanity check: sem company_id não há tenant alvo seguro,
    // portanto não dá para isolar a decisão. Loga e pula o grupo inteiro.
    if (group.companyId == null) {
      console.warn(
        `[AUTO-DISPATCH] Grupo ${groupKey} sem company_id — ${group.deliveries.length} delivery(ies) ignorada(s) por segurança multi-tenant`,
      );
      continue;
    }
    if (!group.date) {
      console.warn(
        `[AUTO-DISPATCH] Grupo ${groupKey} sem data de entrega — ${group.deliveries.length} delivery(ies) ignorada(s) para evitar atribuição em data incorreta`,
      );
      continue;
    }

    const tenantPrincipal: TenantPrincipal = {
      kind: "admin",
      empresaId: group.companyId,
      userId: 0,
      role: "SERVICE",
    };

    await runWithTenant(
      { principal: tenantPrincipal, empresaId: group.companyId },
      async () => {
        let driverRoutes: DispatchDriverRoute[];
        try {
          // FASE 8.6I — sempre passa o companyId para o loader de rotas.
          driverRoutes = await loadDriverRoutesForDate(
            group.date,
            group.companyId as number,
          );
        } catch (err: any) {
          logSecurity(`[LOGISTICS_DISPATCH_FAILED] step=load_routes | group=${groupKey} | error=${err?.message ?? "unknown"}`);
          console.error(
            `[AUTO-DISPATCH] Failed to load routes for ${groupKey}:`,
            err,
          );
          return;
        }

        if (driverRoutes.length === 0) return; // nothing to dispatch into

        for (const d of group.deliveries) {
          try {
            const lat = d.latitude ? parseFloat(d.latitude) : NaN;
            const lng = d.longitude ? parseFloat(d.longitude) : NaN;
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

            const point: GeoPoint = {
              lat,
              lng,
              deliveryId: d.id,
              companyId: group.companyId ?? undefined,
              orderId:    d.order_id ?? undefined,
            };

            const suggestion = suggestInsertion(point, driverRoutes);
            if (!suggestion || !suggestion.routeId) continue;

            const targetRoute = driverRoutes.find((r) => r.routeId === suggestion.routeId);
            if (!targetRoute) continue;
            // Route_stop sequences owned by a different tenant are never
            // mutated or silently replaced with delivery.route_position.
            if (targetRoute.sequenceSource === "route_stops" && targetRoute.stops.length === 0) continue;
            const existingOfficialStop = targetRoute.sequenceSource === "route_stops"
              ? targetRoute.stops.findIndex((stop) => stop.companyId === group.companyId)
              : -1;
            const insertAtPosition = existingOfficialStop >= 0
              ? existingOfficialStop
              : suggestion.insertAtPosition;

            const wasAssigned = await db.transaction(async (tx) => {
              const routeRows = rowsOf<{ id: number }>(
                await tx.execute(sql`
                  SELECT id
                  FROM logistics_routes
                  WHERE id = ${suggestion.routeId}
                    AND empresa_id = ${group.companyId}
                    AND delivery_date = ${group.date}::date
                    AND driver_id = ${suggestion.driverId}
                    AND status IN ('SCHEDULED', 'IN_PROGRESS')
                  FOR UPDATE
                `),
              );
              if (routeRows.length === 0) return false;

              const candidateRows = rowsOf<{ id: number }>(
                await tx.execute(sql`
                  SELECT d.id
                  FROM deliveries d
                  LEFT JOIN orders o ON o.id = d.order_id
                  WHERE d.id = ${d.id}
                    AND d.route_id IS NULL
                    AND d.status = 'pendente'
                    AND COALESCE(d.company_id, o.company_id) = ${group.companyId}
                  FOR UPDATE OF d
                `),
              );
              if (candidateRows.length === 0) return false;

              await tx.execute(sql`
                UPDATE deliveries existing
                SET route_position = existing.route_position + 1,
                    updated_at = NOW()
                WHERE existing.route_id = ${suggestion.routeId}
                  AND existing.route_position >= ${insertAtPosition}
                  AND COALESCE(
                    existing.company_id,
                    (SELECT o.company_id FROM orders o WHERE o.id = existing.order_id)
                  ) = ${group.companyId}
              `);

              if (
                targetRoute.sequenceSource === "route_stops" &&
                existingOfficialStop < 0
              ) {
                const existingStopRows = rowsOf<{ ordem_parada: number | null }>(
                  await tx.execute(sql`
                    SELECT ordem_parada
                    FROM route_stops
                    WHERE route_id = ${suggestion.routeId}
                      AND company_id = ${group.companyId}
                    ORDER BY ordem_parada ASC NULLS LAST, id ASC
                    FOR UPDATE
                  `),
                );
                const firstOrder = existingStopRows
                  .map((stop) => Number(stop.ordem_parada))
                  .find(Number.isFinite);
                const orderOffset = firstOrder != null && firstOrder >= 1 ? 1 : 0;
                const officialOrder = insertAtPosition + orderOffset;

                await tx.execute(sql`
                  UPDATE route_stops
                  SET ordem_parada = ordem_parada + 1
                  WHERE route_id = ${suggestion.routeId}
                    AND company_id = ${group.companyId}
                    AND ordem_parada >= ${officialOrder}
                `);
                await tx.execute(sql`
                  INSERT INTO route_stops (
                    route_id, company_id, latitude, longitude,
                    ordem_parada, tempo_estimado_min
                  )
                  VALUES (
                    ${suggestion.routeId}, ${group.companyId},
                    ${lat}, ${lng}, ${officialOrder}, 8
                  )
                `);
              }

              const assignedRows = rowsOf<{ id: number }>(
                await tx.execute(sql`
                  UPDATE deliveries
                  SET route_id = ${suggestion.routeId},
                      driver_id = ${suggestion.driverId},
                      route_position = ${insertAtPosition},
                      distance_from_prev = ${suggestion.extraDistance.toFixed(3)}::numeric,
                      updated_at = NOW()
                  WHERE id = ${d.id}
                    AND route_id IS NULL
                    AND status = 'pendente'
                  RETURNING id
                `),
              );
              return assignedRows.length > 0;
            });

            if (wasAssigned) {
              assigned++;
              // Reflect the new stop in our in-memory snapshot so subsequent
              // suggestions in this same tick account for it.
              if (existingOfficialStop < 0 || targetRoute.sequenceSource === "deliveries") {
                targetRoute.stops.splice(suggestion.insertAtPosition, 0, {
                  lat,
                  lng,
                  position: suggestion.insertAtPosition,
                  companyId: group.companyId ?? undefined,
                  deliveryId: d.id,
                });
                targetRoute.stops.forEach((s, i) => (s.position = i));
                targetRoute.totalDistance = suggestion.newTotalDistance;
              }
            }
          } catch (err: any) {
            logSecurity(`[LOGISTICS_DISPATCH_FAILED] step=assign_delivery | deliveryId=${d.id} | orderId=${d.order_id ?? "null"} | companyId=${d.company_id ?? "null"} | error=${err?.message ?? "unknown"}`);
            console.error(
              `[AUTO-DISPATCH] Failed to dispatch delivery #${d.id}:`,
              err,
            );
          }
        }
      },
    );
  }

  if (assigned > 0) {
    console.log(
      `[AUTO-DISPATCH] Attached ${assigned} pending delivery(ies) to existing routes`,
    );
  }

  return assigned;
}

// ─── Background worker ────────────────────────────────────────────────────────

let workerTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the auto-dispatch worker. Safe to call multiple times — subsequent
 * calls are no-ops if it is already running. Mirrors the lifecycle helpers
 * on the orders outbox worker.
 */
export function startAutoDispatchWorker(): void {
  if (workerTimer !== null) return;

  console.log(`[AUTO-DISPATCH] Worker started (poll=${TICK_MS}ms)`);

  workerTimer = setInterval(async () => {
    // FASE 3.1 — stale lock recovery (defensive, in case of prior crash)
    recoverStaleJob(JOB_NAME, 5 * 60_000); // 5 min max for a dispatch tick
    if (!startJobRun(JOB_NAME)) {
      console.warn("[AUTO-DISPATCH] Tick skipped — previous run still in progress");
      return;
    }
    try {
      await autoDispatchReadyOrders();
      finishJobRun(JOB_NAME, true);
    } catch (err: any) {
      logSecurity(`[LOGISTICS_DISPATCH_FAILED] step=worker_tick | error=${err?.message ?? "unknown"}`);
      console.error("[AUTO-DISPATCH] Unexpected worker error:", err);
      finishJobRun(JOB_NAME, false, err?.message);
      incJobFailures();
    }
  }, TICK_MS);

  workerTimer.unref();
}

export function stopAutoDispatchWorker(): void {
  if (workerTimer !== null) {
    clearInterval(workerTimer);
    workerTimer = null;
    console.log("[AUTO-DISPATCH] Worker stopped.");
  }
}
