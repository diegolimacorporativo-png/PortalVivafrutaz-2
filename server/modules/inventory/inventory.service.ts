/**
 * InventoryService — pure business logic (no Express).
 *
 * Every method here is a verbatim port of the corresponding inline handler in
 * `server/routes/routes.ts` (lines ~3246-3416). Behaviour, response shape,
 * error messages and field names are preserved EXACTLY. The two POST
 * endpoints with side effects (createEntry, createPhysicalCount) keep the
 * same call ordering, the same `String(...)` numeric coercion, the same
 * average-price weighting formula, and the same movement-record contents
 * the legacy code emitted.
 *
 * Validation errors are signalled via `BadRequestError` so the controller
 * can map them to the legacy `400 { message }` shape verbatim.
 */
import { BadRequestError, NotFoundError } from "../../shared/errors/AppError";
import {
  InventoryRepository,
  inventoryRepository,
} from "./inventory.repository";
import type {
  CreateEntryBody,
  CreatePhysicalCountBody,
  CreateSettingBody,
  EntryFilters,
  InventoryEntry,
  InventoryMovement,
  InventoryPhysicalCount,
  InventorySession,
  InventorySettings,
  MovementFilters,
  UpdateSettingBody,
} from "./inventory.types";

export class InventoryService {
  constructor(
    private readonly repo: InventoryRepository = inventoryRepository,
  ) {}

  // ── Settings ───────────────────────────────────────────────────────────
  listSettings(): Promise<InventorySettings[]> {
    return this.repo.getSettings();
  }

  async updateSetting(
    id: number,
    body: UpdateSettingBody,
  ): Promise<InventorySettings> {
    const { minStock, avgPurchasePrice, category } = body || {};
    const existing = await this.repo.getSettingById(id);
    if (!existing) {
      throw new NotFoundError("Configuração não encontrada");
    }
    return this.repo.upsertSetting({
      ...existing,
      minStock: String(minStock ?? existing.minStock),
      avgPurchasePrice:
        avgPurchasePrice != null
          ? String(avgPurchasePrice)
          : existing.avgPurchasePrice,
      category: category ?? existing.category,
    } as any);
  }

  async createSetting(body: CreateSettingBody): Promise<InventorySettings> {
    const { productId, productName, unit, minStock, category } = body || {};
    if (!productName || !unit) {
      throw new BadRequestError("productName e unit são obrigatórios");
    }
    return this.repo.upsertSetting({
      productId,
      productName,
      unit,
      minStock: String(minStock ?? 0),
      currentStock: "0",
      category,
    } as any);
  }

  // ── Entries ────────────────────────────────────────────────────────────
  listEntries(filters: EntryFilters): Promise<InventoryEntry[]> {
    return this.repo.getEntries(filters);
  }

  /**
   * Verbatim port of POST /api/inventory/entries.
   *
   * Side effects (in order):
   *   1. insert inventory_entries row
   *   2. find-or-create inventory_settings row
   *   3. recompute weighted-average purchase price
   *   4. upsert inventory_settings with new currentStock + avgPurchasePrice
   *   5. insert inventory_movements row (type=ENTRY)
   *
   * The legacy handler wraps this whole sequence in a try/catch that
   * returns 500 `{ message: "Erro ao registrar entrada" }`. We let the
   * service throw and have the controller mirror that exact behaviour so
   * non-validation errors keep going through the legacy path.
   */
  async createEntry(
    body: CreateEntryBody,
    session: InventorySession,
  ): Promise<InventoryEntry> {
    const {
      productId,
      productName,
      category,
      supplier,
      quantity,
      unit,
      purchasePrice,
      invoiceNumber,
      invoiceDate,
      entryDate,
      expiryDate,
      notes,
    } = body || {};
    if (!productName || !quantity || !unit || !entryDate) {
      throw new BadRequestError(
        "Campos obrigatórios: productName, quantity, unit, entryDate",
      );
    }

    const entry = await this.repo.createEntry({
      productId: productId || null,
      productName,
      category: category || null,
      supplier: supplier || null,
      quantity: String(quantity),
      unit,
      purchasePrice: purchasePrice ? String(purchasePrice) : null,
      invoiceNumber: invoiceNumber || null,
      invoiceDate: invoiceDate || null,
      entryDate,
      expiryDate: expiryDate || null,
      notes: notes || null,
      createdBy: session.userName || "Admin",
      createdById: session.userId,
    } as any);

    // Find-or-create the inventory_settings row for this product.
    let setting = productId
      ? await this.repo.getSettingByProductId(productId)
      : await this.repo.getSettingByProductName(productName);
    if (!setting) {
      setting = await this.repo.upsertSetting({
        productId,
        productName,
        unit,
        currentStock: "0",
        minStock: "0",
        category: category || null,
        avgPurchasePrice: purchasePrice ? String(purchasePrice) : null,
      } as any);
    }

    const newStock =
      parseFloat(setting.currentStock || "0") + parseFloat(String(quantity));

    // Weighted-average purchase price recomputation (verbatim).
    let newAvg = setting.avgPurchasePrice
      ? parseFloat(setting.avgPurchasePrice)
      : 0;
    if (purchasePrice) {
      const oldStock = parseFloat(setting.currentStock || "0");
      const oldAvg = parseFloat(setting.avgPurchasePrice || "0");
      const totalOld = oldStock * oldAvg;
      const totalNew =
        parseFloat(String(quantity)) * parseFloat(String(purchasePrice));
      newAvg =
        oldStock + parseFloat(String(quantity)) > 0
          ? (totalOld + totalNew) /
            (oldStock + parseFloat(String(quantity)))
          : parseFloat(String(purchasePrice));
    }

    await this.repo.upsertSetting({
      ...setting,
      currentStock: String(newStock),
      avgPurchasePrice: String(newAvg),
    } as any);

    await this.repo.createMovement({
      productId: productId || null,
      productName,
      movementType: "ENTRY",
      quantity: String(quantity),
      balanceAfter: String(newStock),
      unit,
      referenceType: "entry",
      referenceId: entry.id,
      notes: invoiceNumber ? `NF ${invoiceNumber}` : notes || null,
      date: entryDate,
      createdBy: session.userName || "Admin",
    } as any);

    return entry;
  }

  async deleteEntry(id: number): Promise<void> {
    await this.repo.deleteEntry(id);
  }

  // ── Movements ──────────────────────────────────────────────────────────
  listMovements(filters: MovementFilters): Promise<InventoryMovement[]> {
    return this.repo.getMovements(filters);
  }

  // ── Physical Counts ────────────────────────────────────────────────────
  listPhysicalCounts(): Promise<InventoryPhysicalCount[]> {
    return this.repo.getPhysicalCounts();
  }

  /**
   * Verbatim port of POST /api/inventory/physical-counts.
   *
   * Side effects (in order):
   *   1. find inventory_settings row (best-effort)
   *   2. insert inventory_physical_counts row
   *   3. IF a setting row was found: upsert with new currentStock AND
   *      insert an ADJUSTMENT movement
   *
   * Note: when no setting row exists for the product, the legacy code does
   * NOT create one — it simply persists the count and skips the adjustment
   * movement. We preserve that exact behaviour.
   */
  async createPhysicalCount(
    body: CreatePhysicalCountBody,
    session: InventorySession,
  ): Promise<InventoryPhysicalCount> {
    const { productId, productName, unit, physicalStock, notes, date } =
      body || {};
    if (!productName || physicalStock == null || !date) {
      throw new BadRequestError(
        "productName, physicalStock e date são obrigatórios",
      );
    }

    const setting = productId
      ? await this.repo.getSettingByProductId(productId)
      : await this.repo.getSettingByProductName(productName);

    const systemStockVal = setting
      ? parseFloat(setting.currentStock || "0")
      : 0;
    const physicalVal = parseFloat(String(physicalStock));
    const diff = physicalVal - systemStockVal;

    const count = await this.repo.createPhysicalCount({
      productId: productId || null,
      productName,
      unit: unit || (setting?.unit ?? "kg"),
      systemStock: String(systemStockVal),
      physicalStock: String(physicalVal),
      difference: String(diff),
      notes: notes || null,
      date,
      createdBy: session.userName || "Admin",
      createdById: session.userId,
    } as any);

    if (setting) {
      await this.repo.upsertSetting({
        ...setting,
        currentStock: String(physicalVal),
      } as any);
      await this.repo.createMovement({
        productId: productId || null,
        productName,
        movementType: "ADJUSTMENT",
        quantity: String(Math.abs(diff)),
        balanceAfter: String(physicalVal),
        unit: unit || setting.unit,
        referenceType: "adjustment",
        referenceId: count.id,
        notes:
          diff >= 0
            ? `Ajuste +${diff.toFixed(3)} (contagem física)`
            : `Ajuste ${diff.toFixed(3)} (contagem física)`,
        date,
        createdBy: session.userName || "Admin",
      } as any);
    }

    return count;
  }
}

export const inventoryService = new InventoryService();
