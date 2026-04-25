/**
 * Logistics module types.
 *
 * Re-exports the canonical row types from the shared schema and defines a
 * handful of view-model shapes for the more elaborate analytical endpoints
 * (route-assistant, day-orders, smart-route-plan, etc.). Every shape here
 * mirrors EXACTLY what the legacy inline handlers in `server/routes/routes.ts`
 * used to return — no field renames, no envelope, no normalisation. Behaviour
 * preservation is the only contract.
 */
import type {
  LogisticsDriver,
  LogisticsVehicle,
  LogisticsRoute,
  LogisticsMaintenance,
  RouteStop,
  LogisticsAuditLog,
} from "@shared/schema";

export type {
  LogisticsDriver,
  LogisticsVehicle,
  LogisticsRoute,
  LogisticsMaintenance,
  RouteStop,
  LogisticsAuditLog,
};

/** Canonical roles that gate the CRUD endpoints (drivers / vehicles / routes / maintenance). */
export const LOGISTICS_AUTH_ROLES = [
  "MASTER",
  "ADMIN",
  "DIRECTOR",
  "DEVELOPER",
  "OPERATIONS_MANAGER",
  "LOGISTICS",
] as const;

/** Stricter set used to gate the audit-log read endpoint. */
export const LOGISTICS_ADMIN_ROLES = [
  "MASTER",
  "ADMIN",
  "DIRECTOR",
  "LOGISTICS",
  "DEVELOPER",
] as const;

/** Auth context bag returned by service helpers when relevant. */
export interface ActorRef {
  id: number;
  email?: string | null;
  role: string;
  name?: string | null;
}

// ── Route Assistant ────────────────────────────────────────────────────────
export interface RouteAssistantWindow {
  startTime: string;
  endTime: string;
}

export interface RouteAssistantItem {
  id: number;
  companyName: string;
  addressStreet: string;
  addressNumber: string;
  addressNeighborhood: string;
  addressCity: string;
  addressZip: string;
  latitude: string | null;
  longitude: string | null;
  clientType: string;
  deliveryWindow: RouteAssistantWindow | null;
  hasOrderForDate: boolean | null;
  allowedOrderDays: unknown;
}

// ── Day Orders ─────────────────────────────────────────────────────────────
export interface DayOrderEntry {
  orderId: number;
  orderCode: string;
  orderStatus: string;
  deliveryStatus: string;
  companyId: number;
  companyName: string;
  contactName: string | null;
  address: string | null;
  addressZip: string | null;
  addressCity: string | null;
  latitude: number | null;
  longitude: number | null;
  hasCoords: boolean;
  deliveryTime: string | null;
  totalValue: unknown;
  orderNote: string | null;
  routePosition: number;
}

export interface DayOrdersResponse {
  date: string;
  total: number;
  withCoords: number;
  withoutCoords: number;
  orders: DayOrderEntry[];
  activeOrders: DayOrderEntry[];
}

// ── Suggest Route ──────────────────────────────────────────────────────────
export interface SuggestRouteInput {
  newPoint: { lat: number; lng: number; label?: string };
  date?: string;
}

// ── Calculate Distance ─────────────────────────────────────────────────────
export interface CalculateDistanceInput {
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
}

// ── Reports ────────────────────────────────────────────────────────────────
export interface DeliveriesReportFilters {
  companyId?: number;
  driverId?: number;
  startDate?: string;
  endDate?: string;
  status?: string;
}

// ── Smart Search ───────────────────────────────────────────────────────────
export interface SmartSearchResult {
  company: {
    id: number;
    name: string;
    cnpj: string | null;
    zip: string;
    city: string;
    neighborhood: string;
    street: string | null;
    state: string | null;
    deliveryWindowStart: string;
    deliveryWindowEnd: string;
  };
  suggestion: {
    bestDriver: { id: number; name: string } | null;
    suggestedRoute: { id: number; name: string } | null;
    suggestedDeliveryWindow: string;
    estimatedTimeMin: number;
    nearbyCompanies: Array<{ id: number; name: string }>;
  };
}

// ── Geo CEP ────────────────────────────────────────────────────────────────
export interface GeoCepResponse {
  cep: string;
  logradouro: string;
  bairro: string;
  cidade: string;
  estado: string;
  latitude: string | null;
  longitude: string | null;
}
