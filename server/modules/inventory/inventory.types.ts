/**
 * Inventory module types.
 *
 * Re-exports the canonical row + insert types from the shared schema. The
 * legacy inline handlers in `server/routes/routes.ts` returned the raw
 * Drizzle row shapes directly (no envelope, no normalisation) so we mirror
 * that here verbatim — behaviour preservation is the only contract.
 */
import type {
  InventorySettings,
  InsertInventorySettings,
  InventoryEntry,
  InsertInventoryEntry,
  InventoryMovement,
  InsertInventoryMovement,
  InventoryPhysicalCount,
  InsertInventoryPhysicalCount,
} from "@shared/schema";

export type {
  InventorySettings,
  InsertInventorySettings,
  InventoryEntry,
  InsertInventoryEntry,
  InventoryMovement,
  InsertInventoryMovement,
  InventoryPhysicalCount,
  InsertInventoryPhysicalCount,
};

/** Session payload needed by the controller — matches the shape used in the legacy handlers. */
export interface InventorySession {
  userId: number;
  userName?: string;
}

/** Filters accepted by the entries listing endpoint. */
export interface EntryFilters {
  from?: string;
  to?: string;
}

/** Filters accepted by the movements listing endpoint. */
export interface MovementFilters {
  from?: string;
  to?: string;
  productId?: number;
}

/**
 * Body shapes — kept loose (`unknown`) at the controller boundary so we can
 * preserve the legacy validation behaviour exactly: every legacy handler
 * destructures from `req.body` without strict typing, accepts missing fields
 * silently, and only rejects on the small handful of explicit checks below.
 */
export interface UpdateSettingBody {
  minStock?: unknown;
  avgPurchasePrice?: unknown;
  category?: string | null;
}

export interface CreateSettingBody {
  productId?: number | null;
  productName?: string;
  unit?: string;
  minStock?: unknown;
  category?: string | null;
}

export interface CreateEntryBody {
  productId?: number | null;
  productName?: string;
  category?: string | null;
  supplier?: string | null;
  quantity?: unknown;
  unit?: string;
  purchasePrice?: unknown;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  entryDate?: string;
  expiryDate?: string | null;
  notes?: string | null;
}

export interface CreatePhysicalCountBody {
  productId?: number | null;
  productName?: string;
  unit?: string;
  physicalStock?: unknown;
  notes?: string | null;
  date?: string;
}
