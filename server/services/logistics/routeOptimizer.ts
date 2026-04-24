/**
 * Route Optimizer — VivaFrutaz Smart Logistics
 * Provides distance calculation, route insertion suggestion, and day simulation.
 */

export interface GeoPoint {
  lat: number;
  lng: number;
  label?: string;
  companyId?: number;
  orderId?: number;
  deliveryId?: number;
}

export interface RouteStop extends GeoPoint {
  position: number;
  distanceFromPrev?: number;
  cumulativeDistance?: number;
}

export interface DriverRoute {
  driverId: number;
  driverName: string;
  vehicleId?: number;
  vehiclePlate?: string;
  routeId?: number;
  stops: RouteStop[];
  totalDistance: number;
  estimatedMinutes: number;
}

export interface InsertionSuggestion {
  driverId: number;
  driverName: string;
  routeId?: number;
  insertAtPosition: number;
  extraDistance: number;
  newTotalDistance: number;
  reason: string;
}

export interface SimulationResult {
  date: string;
  drivers: DriverRoute[];
  unassigned: GeoPoint[];
  totalDeliveries: number;
  totalDistance: number;
  estimatedTotalTime: number;
  efficiency: number;
}

const AVERAGE_SPEED_KMH = 35;
const STOP_TIME_MINUTES = 8;

/**
 * Haversine formula: calculates distance between two lat/lng points in km.
 */
export function calculateDistance(from: GeoPoint, to: GeoPoint): number {
  const R = 6371;
  const dLat = toRad(to.lat - from.lat);
  const dLng = toRad(to.lng - from.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Calculates total route distance for an ordered list of stops.
 */
export function routeDistance(stops: GeoPoint[]): number {
  let total = 0;
  for (let i = 1; i < stops.length; i++) {
    total += calculateDistance(stops[i - 1], stops[i]);
  }
  return parseFloat(total.toFixed(3));
}

/**
 * Nearest-neighbour heuristic: given a start point and a list of deliveries,
 * returns an ordered route that minimizes travel distance.
 */
export function nearestNeighbour(start: GeoPoint, points: GeoPoint[]): GeoPoint[] {
  if (points.length === 0) return [];
  const remaining = [...points];
  const route: GeoPoint[] = [];
  let current = start;

  while (remaining.length > 0) {
    let best = 0;
    let bestDist = calculateDistance(current, remaining[0]);
    for (let i = 1; i < remaining.length; i++) {
      const d = calculateDistance(current, remaining[i]);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    route.push(remaining[best]);
    current = remaining[best];
    remaining.splice(best, 1);
  }
  return route;
}

/**
 * suggestInsertion: Given existing driver routes and a new delivery point,
 * finds the cheapest insertion position across all routes.
 */
export function suggestInsertion(
  newPoint: GeoPoint,
  routes: DriverRoute[],
): InsertionSuggestion | null {
  if (routes.length === 0) return null;

  let best: InsertionSuggestion | null = null;

  for (const dr of routes) {
    const stops = dr.stops;
    if (stops.length === 0) {
      const extra = 0;
      if (!best || extra < best.extraDistance) {
        best = {
          driverId: dr.driverId,
          driverName: dr.driverName,
          routeId: dr.routeId,
          insertAtPosition: 0,
          extraDistance: 0,
          newTotalDistance: calculateDistance(newPoint, newPoint),
          reason: `Rota do ${dr.driverName} está vazia — primeiro ponto ideal`,
        };
      }
      continue;
    }

    for (let i = 0; i <= stops.length; i++) {
      const prev = i === 0 ? null : stops[i - 1];
      const next = i === stops.length ? null : stops[i];

      let extra = 0;
      if (prev && next) {
        extra = calculateDistance(prev, newPoint) + calculateDistance(newPoint, next) - calculateDistance(prev, next);
      } else if (prev) {
        extra = calculateDistance(prev, newPoint);
      } else if (next) {
        extra = calculateDistance(newPoint, next);
      }

      if (!best || extra < best.extraDistance) {
        best = {
          driverId: dr.driverId,
          driverName: dr.driverName,
          routeId: dr.routeId,
          insertAtPosition: i,
          extraDistance: parseFloat(extra.toFixed(3)),
          newTotalDistance: parseFloat((dr.totalDistance + extra).toFixed(3)),
          reason: `Inserção na posição ${i + 1} da rota de ${dr.driverName} adiciona apenas ${extra.toFixed(1)} km`,
        };
      }
    }
  }

  return best;
}

/**
 * simulateRouteDay: Given a set of delivery points and driver routes,
 * assigns deliveries to drivers using nearest-neighbour heuristic per driver.
 */
export function simulateRouteDay(
  date: string,
  deliveryPoints: GeoPoint[],
  drivers: Array<{ id: number; name: string; vehicleId?: number; vehiclePlate?: string; routeId?: number; startLat?: number; startLng?: number }>,
  depotLat = -23.55052,
  depotLng = -46.633309,
): SimulationResult {
  if (drivers.length === 0 || deliveryPoints.length === 0) {
    return {
      date,
      drivers: [],
      unassigned: deliveryPoints,
      totalDeliveries: deliveryPoints.length,
      totalDistance: 0,
      estimatedTotalTime: 0,
      efficiency: 0,
    };
  }

  const depot: GeoPoint = { lat: depotLat, lng: depotLng, label: 'Depósito' };
  const points = [...deliveryPoints];
  const driverRoutes: DriverRoute[] = drivers.map(d => ({
    driverId: d.id,
    driverName: d.name,
    vehicleId: d.vehicleId,
    vehiclePlate: d.vehiclePlate,
    routeId: d.routeId,
    stops: [],
    totalDistance: 0,
    estimatedMinutes: 0,
  }));

  const perDriver = Math.ceil(points.length / drivers.length);

  for (let i = 0; i < drivers.length && points.length > 0; i++) {
    const dr = driverRoutes[i];
    const start: GeoPoint = drivers[i].startLat
      ? { lat: drivers[i].startLat!, lng: drivers[i].startLng! }
      : depot;

    const take = points.splice(0, perDriver);
    const ordered = nearestNeighbour(start, take);

    let cumDist = 0;
    let prev = start;
    const stops: RouteStop[] = ordered.map((p, idx) => {
      const d = calculateDistance(prev, p);
      cumDist += d;
      prev = p;
      return { ...p, position: idx, distanceFromPrev: parseFloat(d.toFixed(3)), cumulativeDistance: parseFloat(cumDist.toFixed(3)) };
    });

    const returnDist = calculateDistance(prev, depot);
    const total = cumDist + returnDist;
    const travelMins = (total / AVERAGE_SPEED_KMH) * 60;
    const stopMins = stops.length * STOP_TIME_MINUTES;

    dr.stops = stops;
    dr.totalDistance = parseFloat(total.toFixed(3));
    dr.estimatedMinutes = Math.round(travelMins + stopMins);
  }

  const totalDist = driverRoutes.reduce((s, d) => s + d.totalDistance, 0);
  const totalMins = driverRoutes.reduce((s, d) => s + d.estimatedMinutes, 0);
  const totalDeliveries = deliveryPoints.length;
  const efficiency = totalDeliveries > 0
    ? parseFloat(((totalDeliveries / Math.max(totalDist, 0.1)) * 10).toFixed(1))
    : 0;

  return {
    date,
    drivers: driverRoutes,
    unassigned: points,
    totalDeliveries,
    totalDistance: parseFloat(totalDist.toFixed(3)),
    estimatedTotalTime: totalMins,
    efficiency,
  };
}
