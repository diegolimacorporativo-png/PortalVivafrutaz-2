/**
 * InventoryRepository — thin data-access layer over the legacy storage facade.
 *
 * Architecture decision: this repository deliberately *delegates* to
 * `server/services/storage` (same pattern as `logistics.repository.ts`)
 * instead of owning its own Drizzle queries. The reason is strictly
 * behaviour preservation — the storage layer already enforces tenant
 * scoping, ordering, and the exact return shapes the legacy handlers
 * relied on. Re-implementing those queries here would risk subtle drift.
 *
 * Rules:
 *   - NO business logic
 *   - NO transformations
 *   - NO validation
 */
import { storage } from "../../services/storage";
import type {
  EntryFilters,
  InsertInventoryEntry,
  InsertInventoryMovement,
  InsertInventoryPhysicalCount,
  InsertInventorySettings,
  InventoryEntry,
  InventoryMovement,
  InventoryPhysicalCount,
  InventorySettings,
  MovementFilters,
} from "./inventory.types";

type Storage = typeof storage;

export class InventoryRepository {
  constructor(private readonly db: Storage = storage) {}

  // ── Settings ───────────────────────────────────────────────────────────
  getSettings(): Promise<InventorySettings[]> {
    return this.db.getInventorySettings();
  }
  getSettingByProductId(productId: number): Promise<InventorySettings | undefined> {
    return this.db.getInventorySettingByProductId(productId);
  }
  getSettingByProductName(productName: string): Promise<InventorySettings | undefined> {
    return this.db.getInventorySettingByProductName(productName);
  }
  upsertSetting(data: InsertInventorySettings): Promise<InventorySettings> {
    return this.db.upsertInventorySetting(data);
  }

  // ── Entries ────────────────────────────────────────────────────────────
  getEntries(filters?: EntryFilters): Promise<InventoryEntry[]> {
    return this.db.getInventoryEntries(filters);
  }
  createEntry(data: InsertInventoryEntry): Promise<InventoryEntry> {
    return this.db.createInventoryEntry(data);
  }
  deleteEntry(id: number): Promise<void> {
    return this.db.deleteInventoryEntry(id);
  }

  // ── Movements ──────────────────────────────────────────────────────────
  getMovements(filters?: MovementFilters): Promise<InventoryMovement[]> {
    return this.db.getInventoryMovements(filters);
  }
  createMovement(data: InsertInventoryMovement): Promise<InventoryMovement> {
    return this.db.createInventoryMovement(data);
  }

  // ── Physical Counts ────────────────────────────────────────────────────
  getPhysicalCounts(): Promise<InventoryPhysicalCount[]> {
    return this.db.getInventoryPhysicalCounts();
  }
  createPhysicalCount(data: InsertInventoryPhysicalCount): Promise<InventoryPhysicalCount> {
    return this.db.createInventoryPhysicalCount(data);
  }
}

export const inventoryRepository = new InventoryRepository();
