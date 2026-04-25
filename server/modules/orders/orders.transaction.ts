import { eq, sql } from "drizzle-orm";
import { db } from "../../database/db";
import {
  orders,
  inventorySettings,
  inventoryMovements,
  accountsReceivable,
  deliveries,
} from "@shared/schema";
import { legacyStatusFor, OrderStatus } from "./orders.workflow";
import { ConflictError } from "../../core/errors/AppError";

// ─── Result types ─────────────────────────────────────────────────────────────

export interface CriticalTransitionResult {
  /** The updated order row (both workflowStatus and status are already synced). */
  updatedOrder: typeof orders.$inferSelect;
  /** Pre-nota number that was generated (APPROVED only, null otherwise). */
  preNotaNumber: string | null;
  /** How many inventory product lines were deducted (APPROVED only). */
  inventoryLinesDeducted: number;
  /** Whether an accounts-receivable record was created (INVOICED only). */
  arCreated: boolean;
  /** Whether the logistics delivery row was updated (SHIPPED only). */
  deliveryUpdated: boolean;
}

// ─── Inputs ───────────────────────────────────────────────────────────────────

export interface TransactionInput {
  orderId: number;
  to: OrderStatus;
  /**
   * The workflowStatus the caller observed BEFORE entering the transaction.
   * Used as an optimistic-lock token: if the locked row shows a different
   * value, a concurrent request already committed — we reject with 409.
   */
  expectedWorkflowStatus: string;
  /** Current value of orders.status (legacy column) read pre-transaction. */
  currentLegacyStatus: string;
  /** Order row snapshot read BEFORE the transaction begins. */
  orderSnapshot: any;
  /** Order items snapshot (enriched with productName) read pre-transaction. */
  itemsSnapshot: any[];
  /** Company config snapshot (needed for PIX payload generation). */
  companyConfig: any;
  /** User performing the action (for movement audit trail). */
  actor: { id: number; email: string; role: string; name?: string };
}

// ─── Main entry-point ─────────────────────────────────────────────────────────

/**
 * Execute all critical DB writes for a workflow transition in a single
 * PostgreSQL transaction with full concurrency safety.
 *
 * ─── Concurrency model ───────────────────────────────────────────────────────
 *
 * 1. SELECT … FOR UPDATE (row-level exclusive lock)
 *    The very first statement inside the transaction acquires an exclusive
 *    lock on the order row. Any concurrent transaction that also tries to lock
 *    the same row will BLOCK at the database level until this transaction
 *    commits or rolls back. This serializes all transitions on a given order
 *    across every Node.js process and database replica.
 *
 * 2. Optimistic-lock / idempotency check (post-lock state verify)
 *    After acquiring the lock, the actual `workflow_status` is re-read from
 *    the locked row and compared to `expectedWorkflowStatus` (the state the
 *    caller read before opening this transaction). Two safe outcomes:
 *      a. Match → proceed normally (first writer wins).
 *      b. Mismatch → a concurrent request already transitioned the order;
 *         throw ConflictError(409) so the caller can retry with fresh state.
 *    This combines the guarantees of both pessimistic locking (FOR UPDATE)
 *    and optimistic locking (version check) with no extra version column.
 *
 * 3. Atomic stock deduction (GREATEST, no TOCTOU)
 *    Stock is decremented with a single SQL expression:
 *      UPDATE inventory_settings
 *         SET current_stock = GREATEST(0, current_stock::numeric - qty)
 *       WHERE id = ?
 *    The computation happens inside the DB engine under the row lock, so
 *    there is no read-compute-write window where another request could
 *    observe stale stock. Negative inventory is structurally impossible.
 *    The inventory_settings row is also locked (FOR UPDATE in the SELECT)
 *    so that concurrent orders competing for the same stock queue properly.
 *
 * 4. Inventory movement idempotency (belt-and-suspenders)
 *    Before inserting an EXIT movement for a product, the transaction checks
 *    whether an EXIT movement for the same order+product already exists.
 *    If it does, the deduction step is skipped entirely. This prevents
 *    double-deduction even if the state machine guard were to fail.
 *
 * 5. AR and delivery idempotency
 *    Accounts-receivable: only inserted if no AR row exists for the order.
 *    Delivery: only updated if its current status is 'pendente' (no-op safe).
 *
 * ─── Rollback guarantee ──────────────────────────────────────────────────────
 *    Drizzle wraps the callback in BEGIN … COMMIT / ROLLBACK. Any unhandled
 *    throw inside `db.transaction(async tx => …)` triggers automatic ROLLBACK
 *    before the error propagates to the caller. No partial state ever persists.
 */
export async function executeWorkflowTransaction(
  input: TransactionInput,
): Promise<CriticalTransitionResult> {
  const {
    orderId,
    to,
    expectedWorkflowStatus,
    currentLegacyStatus,
    orderSnapshot,
    itemsSnapshot,
    companyConfig,
    actor,
  } = input;
  const newLegacyStatus = legacyStatusFor(to, currentLegacyStatus);
  const today = new Date().toISOString().split("T")[0];

  return db.transaction(async (tx) => {

    // ── Step 1: Acquire exclusive row lock (SELECT … FOR UPDATE) ─────────────
    //
    // This is the concurrency gate. All other transactions targeting the same
    // order row will queue here until we COMMIT or ROLLBACK. Drizzle 0.39 does
    // not expose a chainable .forUpdate(), so we use a raw sql`` template.
    const lockedRows = await tx.execute(
      sql`SELECT id, workflow_status, status FROM orders WHERE id = ${orderId} FOR UPDATE`,
    ) as Array<{ id: number; workflow_status: string; status: string }>;

    if (lockedRows.length === 0) {
      // The order was deleted between the pre-flight read and now.
      throw new ConflictError("Pedido não encontrado. Pode ter sido excluído simultaneamente.");
    }

    const lockedRow = lockedRows[0];

    // ── Step 2: Optimistic-lock / idempotency check ──────────────────────────
    //
    // If `workflow_status` changed since the caller read it (another request
    // committed between the pre-flight read and now), we must NOT proceed.
    // Throwing here triggers automatic ROLLBACK — the lock is released cleanly.
    if (lockedRow.workflow_status !== expectedWorkflowStatus) {
      throw new ConflictError(
        `O pedido foi modificado simultaneamente. ` +
        `Estado esperado: ${expectedWorkflowStatus}, estado atual: ${lockedRow.workflow_status}. ` +
        `Recarregue e tente novamente.`,
        {
          expectedWorkflowStatus,
          currentWorkflowStatus: lockedRow.workflow_status,
        },
      );
    }

    // ── Step 3: Update both status columns in the same statement ─────────────
    const [updatedOrder] = await tx
      .update(orders)
      .set({ workflowStatus: to, status: newLegacyStatus })
      .where(eq(orders.id, orderId))
      .returning();

    let preNotaNumber: string | null = null;
    let inventoryLinesDeducted = 0;
    let arCreated = false;
    let deliveryUpdated = false;

    // ── Step 4a: APPROVED — pre-nota generation + atomic stock deduction ─────
    if (to === OrderStatus.APPROVED) {

      // Pre-nota: generate only if absent (idempotent).
      if (!orderSnapshot.preNotaNumber) {
        preNotaNumber = `VF-NF-${orderId.toString().padStart(6, "0")}`;
        await tx
          .update(orders)
          .set({ preNotaNumber })
          .where(eq(orders.id, orderId));
      } else {
        preNotaNumber = orderSnapshot.preNotaNumber;
      }

      // Stock reservation — one product at a time, serialized under row lock.
      for (const item of itemsSnapshot) {
        const qty = parseFloat(String(item.quantity || 0));
        if (qty <= 0) continue;

        // Lock the inventory_settings row for this product before reading or
        // updating it. This prevents two concurrent orders from both reading
        // the same stock level and over-committing it.
        const settingRows = await tx.execute(
          item.productId
            ? sql`SELECT id, current_stock::text AS current_stock, unit, product_name
                  FROM inventory_settings
                  WHERE product_id = ${item.productId}
                  LIMIT 1
                  FOR UPDATE`
            : sql`SELECT id, current_stock::text AS current_stock, unit, product_name
                  FROM inventory_settings
                  WHERE product_name = ${item.productName}
                  LIMIT 1
                  FOR UPDATE`,
        ) as Array<{ id: number; current_stock: string; unit: string; product_name: string }>;

        if (settingRows.length === 0) continue; // non-tracked product — skip

        const setting = settingRows[0];

        // Idempotency guard: skip if this order already has an EXIT movement
        // for this product (belt-and-suspenders in case state machine fails).
        const existingMove = await tx.execute(
          sql`SELECT id FROM inventory_movements
              WHERE movement_type = 'EXIT'
                AND reference_type = 'order'
                AND reference_id   = ${orderId}
                AND (product_id    = ${item.productId ?? null}
                     OR product_name = ${item.productName || ""})
              LIMIT 1`,
        ) as Array<{ id: number }>;

        if (existingMove.length > 0) continue; // already deducted — skip

        // Atomic deduction: GREATEST(0, stock - qty) prevents negative stock.
        // The computation runs inside the DB engine on the locked row.
        const deductedRows = await tx.execute(
          sql`UPDATE inventory_settings
              SET    current_stock = GREATEST(0, current_stock::numeric - ${qty}::numeric)
              WHERE  id = ${setting.id}
              RETURNING current_stock::text AS new_stock`,
        ) as Array<{ new_stock: string }>;

        const newStock = deductedRows[0]?.new_stock ?? "0";

        // Record the movement.
        await tx.insert(inventoryMovements).values({
          productId:    item.productId ?? null,
          productName:  item.productName || setting.product_name,
          movementType: "EXIT",
          quantity:     String(qty),
          balanceAfter: newStock,
          unit:         setting.unit,
          referenceType: "order",
          referenceId:  orderId,
          notes:        `Pedido aprovado: ${orderSnapshot.orderCode || `#${orderId}`}`,
          date:         today,
          createdBy:    actor.name || actor.email || "Sistema",
        });

        inventoryLinesDeducted++;
      }
    }

    // ── Step 4b: INVOICED — accounts receivable seeding ─────────────────────
    if (to === OrderStatus.INVOICED) {
      // Idempotency: only insert if no AR row exists for this order.
      const existingAR = await tx
        .select({ id: accountsReceivable.id })
        .from(accountsReceivable)
        .where(eq(accountsReceivable.orderId, orderId))
        .limit(1);

      if (existingAR.length === 0) {
        const total = itemsSnapshot.reduce(
          (sum, item) => sum + parseFloat(String(item.totalPrice || "0")),
          0,
        );

        if (total > 0) {
          const emissao    = new Date();
          const vencimento = new Date(emissao);
          vencimento.setDate(vencimento.getDate() + 30);
          const toDateStr = (d: Date) => d.toISOString().split("T")[0];

          let pixPayload: string | undefined;
          if (companyConfig?.cnpj) {
            pixPayload = buildPixPayload(
              companyConfig.cnpj,
              total,
              companyConfig.companyName,
              companyConfig.city,
            );
          }

          await tx.insert(accountsReceivable).values({
            companyId:       orderSnapshot.companyId,
            orderId,
            descricao:       `Pedido ${orderSnapshot.orderCode || `#${orderId}`}`,
            valor:           total.toFixed(2),
            dataEmissao:     toDateStr(emissao),
            dataVencimento:  toDateStr(vencimento),
            status:          "pendente",
            formaPagamento:  "pix",
            pixPayload,
          });

          arCreated = true;
        }
      }
    }

    // ── Step 4c: SHIPPED — logistics delivery row update ────────────────────
    if (to === OrderStatus.SHIPPED) {
      // Only update if currently 'pendente' — idempotent and status-safe.
      const updated = await tx.execute(
        sql`UPDATE deliveries
            SET    status     = 'em_rota',
                   updated_at = NOW()
            WHERE  order_id   = ${orderId}
              AND  status     = 'pendente'
            RETURNING id`,
      ) as Array<{ id: number }>;

      deliveryUpdated = updated.length > 0;
    }

    return {
      updatedOrder,
      preNotaNumber,
      inventoryLinesDeducted,
      arCreated,
      deliveryUpdated,
    };
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Generates a PIX Copy-and-Paste (BR Code) payload string.
 * Extracted here so the transaction body stays readable.
 */
function buildPixPayload(
  cnpj: string,
  total: number,
  companyName?: string,
  city?: string,
): string {
  const chave    = String(cnpj).replace(/\D/g, "");
  const sanitize = (s: string, max: number) =>
    (s || "").replace(/[^\w\s]/gi, "").slice(0, max).trim() || "VIVA";
  const tlv      = (idTag: string, v: string) =>
    `${idTag}${String(v.length).padStart(2, "0")}${v}`;

  const merchant = tlv("00", "br.gov.bcb.pix") + tlv("01", chave.slice(0, 77));
  const addData  = tlv("62", tlv("05", `AR${Date.now().toString().slice(-10)}`));

  let payload =
    tlv("00", "01") +
    tlv("26", merchant) +
    tlv("52", "0000") +
    tlv("53", "986") +
    tlv("54", total.toFixed(2)) +
    tlv("58", "BR") +
    tlv("59", sanitize(companyName || "VIVAFRUTAZ", 25)) +
    tlv("60", sanitize(city || "SAOPAULO", 15)) +
    addData +
    "6304";

  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++)
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return payload + (crc & 0xffff).toString(16).toUpperCase().padStart(4, "0");
}
