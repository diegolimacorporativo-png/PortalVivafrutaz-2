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
import { logSecurity } from "../../core/security/securityLogger";
import { registerJob, startJobRun, finishJobRun, recoverStaleJob } from "../../core/jobs/job-registry";
import { incJobFailures } from "../../core/observability/metrics";
import {
  deliveryIsEligibleForAutoDispatch,
  eligibleRoutesForDelivery,
  nextGlobalRoutePosition,
  normalizeRouteCompanyIds,
  routeAuthorizesCompany,
} from "./auto-dispatch.policy";

const JOB_NAME = "auto-dispatch";
registerJob(JOB_NAME);

const TICK_MS = 10_000;

interface PendingDeliveryRow {
  id: number;
  order_id: number | null;
  company_id: number | null;
  route_id: number | null;
  status: string;
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
  company_ids: unknown;
  status: string;
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
  companyIds: number[];
  deliveryDate: string | null;
  status: string;
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
 * A rota é carregada como unidade operacional. A empresa efetiva de cada
 * entrega é autorizada contra company_ids antes da sugestão e novamente sob
 * lock antes da atribuição.
 */
async function loadDriverRoutesForDate(
  date: string,
): Promise<DispatchDriverRoute[]> {
  const routes = rowsOf<RouteRow>(
    await db.execute(
      sql`SELECT lr.id, lr.driver_id, lr.driver_name, lr.vehicle_id, lr.vehicle_plate,
                 lr.delivery_date::text AS delivery_date, lr.company_ids, lr.status,
                 EXISTS (
                   SELECT 1 FROM route_stops rs WHERE rs.route_id = lr.id
                 ) AS has_route_stops
          FROM   logistics_routes lr
          JOIN   logistics_drivers ld ON ld.id = lr.driver_id AND ld.active = TRUE
          WHERE  lr.delivery_date = ${date}::date
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
          JOIN   logistics_routes lr ON lr.id = d.route_id
          WHERE  d.route_id = ANY(${routeIds}::int[])
            AND  d.latitude  IS NOT NULL
            AND  d.longitude IS NOT NULL
            AND  lr.company_ids @> jsonb_build_array(COALESCE(d.company_id, o.company_id))
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
          FROM   route_stops rs
          JOIN   logistics_routes lr ON lr.id = rs.route_id
          WHERE  rs.route_id = ANY(${routeIds}::int[])
            AND  latitude IS NOT NULL
            AND  longitude IS NOT NULL
            AND  (rs.company_id IS NULL OR lr.company_ids @> jsonb_build_array(rs.company_id))
          ORDER  BY rs.route_id ASC, ordem_parada ASC NULLS LAST, rs.id ASC`,
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
      companyIds: normalizeRouteCompanyIds(r.company_ids),
      deliveryDate: r.delivery_date,
      status: r.status,
    };
  });
}

// The current optimizer ranks insertions by incremental distance. Route date,
// explicit company scope, active state, and assigned driver are hard eligibility checks above.
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
                   d.route_id,
                   d.status,
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
              AND  c.active = TRUE
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

  // A rota é a unidade operacional: carregar uma vez por data permite que
  // entregas de empresas autorizadas concorram pela mesma sequência global.
  const byDate = new Map<string, PendingDeliveryRow[]>();
  for (const row of pending) {
    const companyId = row.company_id == null ? null : Number(row.company_id);
    const hasCoordinates = row.latitude != null && row.longitude != null &&
      Number.isFinite(Number(row.latitude)) && Number.isFinite(Number(row.longitude));
    if (!deliveryIsEligibleForAutoDispatch({
      status: row.status,
      routeId: row.route_id,
      companyId,
      deliveryDate: row.delivery_date,
      hasCoordinates,
    }) || companyId == null || row.delivery_date == null) {
      console.warn(`[AUTO-DISPATCH] Delivery ${row.id} fora dos critérios de auto-dispatch — ignorada por segurança`);
      continue;
    }
    const bucket = byDate.get(row.delivery_date) ?? [];
    bucket.push(row);
    byDate.set(row.delivery_date, bucket);
  }

  for (const [date, deliveriesForDate] of byDate.entries()) {
    let driverRoutes: DispatchDriverRoute[];
    try {
      driverRoutes = await loadDriverRoutesForDate(date);
    } catch (err: any) {
      logSecurity(`[LOGISTICS_DISPATCH_FAILED] step=load_routes | date=${date} | error=${err?.message ?? "unknown"}`);
      console.error(`[AUTO-DISPATCH] Failed to load routes for ${date}:`, err);
      continue;
    }
    if (driverRoutes.length === 0) continue;

    for (const d of deliveriesForDate) {
      const companyId = d.company_id == null ? null : Number(d.company_id);
      if (!deliveryIsEligibleForAutoDispatch({
        status: d.status,
        routeId: d.route_id,
        companyId,
        deliveryDate: d.delivery_date,
        hasCoordinates: d.latitude != null && d.longitude != null &&
          Number.isFinite(Number(d.latitude)) && Number.isFinite(Number(d.longitude)),
      }) || companyId == null || d.delivery_date == null) {
        console.warn(`[AUTO-DISPATCH] Delivery ${d.id} sem empresa identificável — ignorada`);
        continue;
      }
      try {
        const lat = d.latitude ? parseFloat(d.latitude) : NaN;
        const lng = d.longitude ? parseFloat(d.longitude) : NaN;
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

        const point: GeoPoint = {
          lat,
          lng,
          deliveryId: d.id,
          companyId,
          orderId: d.order_id ?? undefined,
        };
        const eligibleRoutes = eligibleRoutesForDelivery(driverRoutes, {
          companyId,
          deliveryDate: date,
        });
        const suggestion = suggestInsertion(point, eligibleRoutes);
        if (!suggestion?.routeId) continue;

        const targetRoute = eligibleRoutes.find((route) => route.routeId === suggestion.routeId);
        if (!targetRoute) continue;

        const assignedPosition = await db.transaction(async (tx) => {
          const routeRows = rowsOf<{
            id: number;
            company_ids: unknown;
            status: string;
          }>(await tx.execute(sql`
            SELECT lr.id, lr.company_ids, lr.status
            FROM logistics_routes lr
            JOIN logistics_drivers ld ON ld.id = lr.driver_id AND ld.active = TRUE
            WHERE lr.id = ${suggestion.routeId}
              AND lr.delivery_date = ${date}::date
              AND lr.driver_id = ${suggestion.driverId}
              AND lr.status IN ('SCHEDULED', 'IN_PROGRESS')
            FOR UPDATE OF lr, ld
          `));
          const lockedRoute = routeRows[0];
          if (!lockedRoute || !routeAuthorizesCompany(lockedRoute.company_ids, companyId)) return null;

          const candidateRows = rowsOf<{ id: number }>(await tx.execute(sql`
            SELECT d.id
            FROM deliveries d
            LEFT JOIN orders o ON o.id = d.order_id
            LEFT JOIN companies c ON c.id = COALESCE(d.company_id, o.company_id)
            WHERE d.id = ${d.id}
              AND d.route_id IS NULL
              AND d.status = 'pendente'
              AND COALESCE(d.company_id, o.company_id) = ${companyId}
              AND COALESCE(d.scheduled_date, o.delivery_date::date) = ${date}::date
              AND c.active = TRUE
              AND COALESCE(d.latitude, c.latitude) IS NOT NULL
              AND COALESCE(d.longitude, c.longitude) IS NOT NULL
            FOR UPDATE OF d
          `));
          if (candidateRows.length === 0) return null;

          // The route lock serializes assignments across every authorized
          // company. Append instead of shifting an existing stop, preserving
          // the sequence of routes that may already be in progress.
          const assignedRows = rowsOf<{ route_position: number | string | null }>(await tx.execute(sql`
            SELECT route_position
            FROM deliveries
            WHERE route_id = ${suggestion.routeId}
            ORDER BY route_position NULLS LAST, id ASC
            FOR UPDATE
          `));
          const nextPosition = nextGlobalRoutePosition(assignedRows.map((row) => row.route_position));
          if (nextPosition == null) {
            logSecurity(`[LOGISTICS_DISPATCH_SKIPPED] reason=invalid_route_sequence | routeId=${suggestion.routeId}`);
            return null;
          }

          const updated = rowsOf<{ id: number }>(await tx.execute(sql`
            UPDATE deliveries
            SET route_id = ${suggestion.routeId},
                driver_id = ${suggestion.driverId},
                route_position = ${nextPosition},
                distance_from_prev = ${suggestion.extraDistance.toFixed(3)}::numeric,
                updated_at = NOW()
            WHERE deliveries.id = ${d.id}
              AND deliveries.route_id IS NULL
              AND deliveries.status = 'pendente'
              AND COALESCE(
                deliveries.company_id,
                (SELECT o.company_id FROM orders o WHERE o.id = deliveries.order_id)
              ) = ${companyId}
              AND COALESCE(
                deliveries.scheduled_date,
                (SELECT o.delivery_date::date FROM orders o WHERE o.id = deliveries.order_id)
              ) = ${date}::date
            RETURNING id
          `));
          return updated.length > 0 ? nextPosition : null;
        });

        if (assignedPosition != null) {
          assigned++;
          // Keep the in-memory route snapshot aligned with the canonical
          // global deliveries.route_position ordering for this tick.
          targetRoute.stops.push({
            lat,
            lng,
            position: assignedPosition,
            companyId,
            deliveryId: d.id,
          });
          targetRoute.totalDistance = suggestion.newTotalDistance;
        }
      } catch (err: any) {
        logSecurity(`[LOGISTICS_DISPATCH_FAILED] step=assign_delivery | deliveryId=${d.id} | orderId=${d.order_id ?? "null"} | companyId=${companyId} | error=${err?.message ?? "unknown"}`);
        console.error(`[AUTO-DISPATCH] Failed to dispatch delivery #${d.id}:`, err);
      }
    }
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
