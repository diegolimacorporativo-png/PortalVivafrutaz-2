/**
 * Price Adjustment Engine — STEP 6.
 *
 * Allows controlled percentage-based price adjustments on product base
 * prices and sub-category prices. Highlights:
 *
 *   • dryRun preview — never touches the database, returns the exact
 *     before/after diff so an admin can validate impact first.
 *   • transactional apply — every UPDATE happens inside a single
 *     `db.transaction(...)` so any failure rolls back the whole batch.
 *   • snapshot-per-row — every applied change is recorded in
 *     `priceAdjustmentSnapshots`, enabling per-batch rollback later.
 *   • contract isolation — `contractScopes.unitPrice` is NEVER touched.
 *     Negotiated per-company prices remain authoritative; only the
 *     catalog defaults move.
 *
 * Out of scope (intentionally untouched): orderItems history, fiscal
 * invoices, financial records.
 */
import { randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";
import { db } from "../../database/db";
import {
  products,
  productSubCategories,
  priceAdjustmentSnapshots,
  type PriceAdjustmentSnapshot,
} from "@shared/schema";
// MT-3B H2 — products and productSubCategories both carry empresaId; all catalog reads
// must be scoped to the current tenant via tenantWhere (AsyncLocalStorage).
import { tenantWhere } from "../../core/tenant/scope";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AdjustmentTarget = "base" | "subcategory" | "all";

export interface AdjustPricesParams {
  percentage: number;
  target: AdjustmentTarget;
  productIds?: number[];
  categoryIds?: number[]; // currently unused: products table stores `category` as text — kept here so the public contract matches the spec and is forward-compatible if a real categoryId column is added.
  dryRun: boolean;
  appliedBy?: number;
}

export interface PriceChange {
  type: "product" | "subcategory";
  id: number;
  name: string;
  oldPrice: number;
  newPrice: number;
  diff: number;
}

export interface AdjustPricesResult {
  batchId: string | null; // null on dry-run
  summary: {
    totalItems: number;
    avgIncrease: number;
    percentage: number;
    target: AdjustmentTarget;
    dryRun: boolean;
  };
  changes: PriceChange[];
}

// ─── Pure calculation ─────────────────────────────────────────────────────────

/**
 * Apply a percentage adjustment to a price, rounded to 2 decimals.
 * Defensive: NaN/Infinity → original price; negative results → 0.
 */
export function applyAdjustment(price: number, percentage: number): number {
  const adjusted = price * (1 + percentage / 100);
  if (!isFinite(adjusted) || isNaN(adjusted)) return price;
  if (adjusted < 0) return 0;
  return Number(adjusted.toFixed(2));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return isNaN(n) ? null : n;
}

// ─── Core engine ──────────────────────────────────────────────────────────────

/**
 * Compute (and optionally apply) a price adjustment batch.
 *
 * Always fetches the affected rows in two bulk queries (no per-row IO),
 * filters them in-memory, runs the pure `applyAdjustment` over each, and
 * either returns the diff (dryRun=true) or persists every UPDATE inside a
 * single transaction along with one snapshot row per change.
 */
export async function adjustPrices(
  params: AdjustPricesParams,
): Promise<AdjustPricesResult> {
  const { percentage, target, productIds, dryRun, appliedBy } = params;

  if (!isFinite(percentage) || isNaN(percentage)) {
    throw new Error("percentage must be a finite number");
  }

  // ── Fetch in bulk (no queries inside loops) ────────────────────────────────
  // MT-3B H2 — tenantWhere scopes both reads to the current tenant's catalog.
  // Auto-detects the empresaId column on each table via AsyncLocalStorage.
  const [allProducts, allSubs] = await Promise.all([
    target === "subcategory" ? Promise.resolve([]) : db.select().from(products).where(tenantWhere(products)),
    target === "base" ? Promise.resolve([]) : db.select().from(productSubCategories).where(tenantWhere(productSubCategories)),
  ]);

  const idFilter = productIds && productIds.length > 0 ? new Set(productIds) : null;
  const changes: PriceChange[] = [];

  // ── Products (basePrice) ───────────────────────────────────────────────────
  if (target === "base" || target === "all") {
    for (const p of allProducts) {
      if (idFilter && !idFilter.has(p.id)) continue;
      const old = toNumber(p.basePrice);
      if (old === null) continue; // product without a base price is ignored
      const next = applyAdjustment(old, percentage);
      if (next === old) continue;
      changes.push({
        type: "product",
        id: p.id,
        name: p.name,
        oldPrice: old,
        newPrice: next,
        diff: Number((next - old).toFixed(2)),
      });
    }
  }

  // ── Sub-categories (price) ─────────────────────────────────────────────────
  if (target === "subcategory" || target === "all") {
    // Build product-name lookup so the change row is human-readable.
    const productNameById = new Map<number, string>();
    for (const p of allProducts) productNameById.set(p.id, p.name);

    for (const s of allSubs) {
      if (idFilter && !idFilter.has(s.productId)) continue;
      const old = toNumber(s.price);
      if (old === null) continue;
      const next = applyAdjustment(old, percentage);
      if (next === old) continue;
      const productName = productNameById.get(s.productId) ?? `Produto #${s.productId}`;
      changes.push({
        type: "subcategory",
        id: s.id,
        name: `${productName} — ${s.categoryName}`,
        oldPrice: old,
        newPrice: next,
        diff: Number((next - old).toFixed(2)),
      });
    }
  }

  const totalItems = changes.length;
  const avgIncrease =
    totalItems === 0
      ? 0
      : Number(
          (changes.reduce((sum, c) => sum + c.diff, 0) / totalItems).toFixed(2),
        );

  // ── Dry-run: return diff, persist nothing ──────────────────────────────────
  if (dryRun || totalItems === 0) {
    return {
      batchId: null,
      summary: { totalItems, avgIncrease, percentage, target, dryRun },
      changes,
    };
  }

  // ── Apply: single transaction, one snapshot row per change ─────────────────
  const batchId = randomUUID();

  await db.transaction(async (tx) => {
    for (const c of changes) {
      if (c.type === "product") {
        await tx
          .update(products)
          .set({ basePrice: c.newPrice.toFixed(2) })
          .where(eq(products.id, c.id));
      } else {
        await tx
          .update(productSubCategories)
          .set({ price: c.newPrice.toFixed(2) })
          .where(eq(productSubCategories.id, c.id));
      }
    }

    await tx.insert(priceAdjustmentSnapshots).values(
      changes.map((c) => ({
        batchId,
        entityType: c.type,
        entityId: c.id,
        oldPrice: c.oldPrice.toFixed(2),
        newPrice: c.newPrice.toFixed(2),
        percentage: percentage.toFixed(4),
        appliedBy: appliedBy ?? null,
      })),
    );
  });

  console.info("[pricing] adjustment applied", {
    batchId,
    percentage,
    target,
    totalAffected: totalItems,
  });

  return {
    batchId,
    summary: { totalItems, avgIncrease, percentage, target, dryRun: false },
    changes,
  };
}

// ─── Rollback ─────────────────────────────────────────────────────────────────

export interface RollbackResult {
  batchId: string;
  reverted: number;
}

/**
 * Reverts every change recorded under the given batchId by writing the
 * stored `oldPrice` back. Idempotent: rows already rolled back are skipped.
 * Runs in a single transaction so the catalogue is never left half-restored.
 */
export async function rollbackBatch(batchId: string): Promise<RollbackResult> {
  const rows = await db
    .select()
    .from(priceAdjustmentSnapshots)
    .where(eq(priceAdjustmentSnapshots.batchId, batchId));

  const active = rows.filter((r: PriceAdjustmentSnapshot) => r.rolledBackAt === null);
  if (active.length === 0) {
    return { batchId, reverted: 0 };
  }

  await db.transaction(async (tx) => {
    for (const r of active) {
      if (r.entityType === "product") {
        await tx
          .update(products)
          .set({ basePrice: r.oldPrice })
          .where(eq(products.id, r.entityId));
      } else if (r.entityType === "subcategory") {
        await tx
          .update(productSubCategories)
          .set({ price: r.oldPrice })
          .where(eq(productSubCategories.id, r.entityId));
      }
    }

    await tx
      .update(priceAdjustmentSnapshots)
      .set({ rolledBackAt: new Date() })
      .where(
        inArray(
          priceAdjustmentSnapshots.id,
          active.map((r) => r.id),
        ),
      );
  });

  console.info("[pricing] adjustment rolled back", {
    batchId,
    reverted: active.length,
  });

  return { batchId, reverted: active.length };
}
