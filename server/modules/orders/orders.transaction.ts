import { eq, sql } from "drizzle-orm";
import { db } from "../../database/db";
import {
  orders,
  inventorySettings,
  inventoryMovements,
  accountsReceivable,
  deliveries,
  workflowEvents,
  type WorkflowEventPayload,
} from "@shared/schema";
import { legacyStatusFor, OrderStatus } from "./orders.workflow";
import { BadRequestError, ConflictError } from "../../core/errors/AppError";

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
   * Used as an optimistic-lock token: if the DB row shows a different value,
   * a concurrent request already committed — we reject with 409.
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
  /** User performing the action (for movement audit trail and outbox). */
  actor: { id: number; email: string; role: string; name?: string };
  /** The workflowStatus before the transition (for outbox payload). */
  from: string;
}

// ─── Main entry-point ─────────────────────────────────────────────────────────

/**
 * Execute all critical DB writes for a workflow transition in a single
 * PostgreSQL transaction with full concurrency safety.
 *
 * ─── Concurrency model ───────────────────────────────────────────────────────
 *
 * 1. pg_try_advisory_xact_lock(orderId)  — distributed application lock
 *    Acquired as the very first statement. Returns `true` if the lock was
 *    granted, `false` if another transaction already holds it for this order.
 *    On false → throw ConflictError(409) → ROLLBACK (lock never held).
 *    This is a transaction-level lock: PostgreSQL releases it automatically
 *    at COMMIT or ROLLBACK — no cleanup code needed.
 *    Works across every Node.js process and database connection, making
 *    horizontal scaling (multiple replicas) safe with no extra infrastructure.
 *
 * 2. Optimistic-lock check (state verify after lock)
 *    After acquiring the application lock, re-read `workflow_status` from the
 *    order row. If it no longer matches `expectedWorkflowStatus` (the value
 *    the caller observed before opening this transaction), a concurrent
 *    request already committed — throw ConflictError so the caller retries
 *    with fresh state.
 *
 * 3. Strict stock validation (no silent clamping)
 *    Each inventory_settings row is locked with SELECT … FOR UPDATE to
 *    serialize concurrent stock deductions. The deduction only proceeds if
 *    `current_stock >= required_qty`. If stock is insufficient the transaction
 *    throws BadRequestError(400) and rolls back — inventory is NEVER allowed
 *    to go negative.
 *    Lock ordering: items are sorted by productId ASC before locking to
 *    guarantee a consistent lock acquisition order, preventing deadlocks when
 *    two orders share the same product set.
 *
 * 4. Inventory movement idempotency (belt-and-suspenders)
 *    Before deducting, check for an existing EXIT movement for this
 *    order+product. If found, skip — prevents double-deduction even if the
 *    state machine guard is somehow bypassed.
 *
 * 5. Transactional outbox (event reliability)
 *    The last write inside the transaction is an INSERT into `workflow_events`.
 *    Because this INSERT is inside the same transaction as the order update,
 *    the event is guaranteed to exist if and only if the transition committed.
 *    A background worker (orders.outbox.worker.ts) polls the table and
 *    executes non-critical side effects (push notification, audit log) with
 *    retry semantics and `FOR UPDATE SKIP LOCKED` so multiple workers never
 *    process the same event.
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
    from,
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

    // ── Step 1: Distributed application lock ────────────────────────────────
    //
    // pg_try_advisory_xact_lock(key) grants an exclusive lock for this
    // transaction's lifetime. Unlike SELECT … FOR UPDATE it does not block —
    // it returns false immediately if another transaction already holds it.
    // This makes the behaviour predictable (fast fail, no queue pile-up).
    const [lockResult] = await tx.execute(
      sql`SELECT pg_try_advisory_xact_lock(${orderId}::bigint) AS acquired`,
    ) as Array<{ acquired: boolean }>;

    if (!lockResult?.acquired) {
      throw new ConflictError(
        `Pedido #${orderId} já está sendo processado em outro servidor. ` +
        `Aguarde um momento e tente novamente.`,
        { orderId },
      );
    }

    // ── Step 2: Optimistic-lock check ───────────────────────────────────────
    //
    // Re-read the current workflow_status now that we hold the advisory lock.
    // If it changed, a concurrent request already committed a transition.
    const [currentRow] = await tx.execute(
      sql`SELECT workflow_status FROM orders WHERE id = ${orderId}`,
    ) as Array<{ workflow_status: string }>;

    if (!currentRow) {
      throw new ConflictError(
        "Pedido não encontrado. Pode ter sido excluído simultaneamente.",
      );
    }

    if (currentRow.workflow_status !== expectedWorkflowStatus) {
      throw new ConflictError(
        `O pedido foi modificado simultaneamente. ` +
        `Estado esperado: ${expectedWorkflowStatus}, ` +
        `estado atual: ${currentRow.workflow_status}. ` +
        `Recarregue e tente novamente.`,
        {
          expectedWorkflowStatus,
          currentWorkflowStatus: currentRow.workflow_status,
        },
      );
    }

    // ── Step 3: Commit the state transition ─────────────────────────────────
    const [updatedOrder] = await tx
      .update(orders)
      .set({ workflowStatus: to, status: newLegacyStatus })
      .where(eq(orders.id, orderId))
      .returning();

    let preNotaNumber: string | null = null;
    let inventoryLinesDeducted = 0;
    let arCreated = false;
    let deliveryUpdated = false;

    // ── Step 4a: APPROVED — pre-nota + strict stock deduction ───────────────
    if (to === OrderStatus.APPROVED) {

      // Pre-nota: idempotent — generate only if the order has none yet.
      if (!orderSnapshot.preNotaNumber) {
        preNotaNumber = `VF-NF-${orderId.toString().padStart(6, "0")}`;
        await tx
          .update(orders)
          .set({ preNotaNumber })
          .where(eq(orders.id, orderId));
      } else {
        preNotaNumber = orderSnapshot.preNotaNumber;
      }

      // Sort items by productId ASC before locking inventory rows.
      // Consistent lock ordering prevents deadlocks when two concurrent orders
      // share the same product set and both try to lock the same rows.
      const sortedItems = [...itemsSnapshot].sort(
        (a, b) => (a.productId ?? 0) - (b.productId ?? 0),
      );

      for (const item of sortedItems) {
        const qty = parseFloat(String(item.quantity || 0));
        if (qty <= 0) continue;

        // Lock the inventory_settings row with FOR UPDATE so concurrent
        // transactions queue rather than race for the same stock counter.
        // Even with the advisory lock on the ORDER, a non-order write
        // (manual adjustment, purchase receipt) might touch this row.
        const settingRows = await tx.execute(
          item.productId
            ? sql`SELECT id,
                         current_stock::numeric  AS current_stock,
                         unit,
                         product_name
                  FROM   inventory_settings
                  WHERE  product_id   = ${item.productId}
                  LIMIT  1
                  FOR UPDATE`
            : sql`SELECT id,
                         current_stock::numeric  AS current_stock,
                         unit,
                         product_name
                  FROM   inventory_settings
                  WHERE  product_name = ${item.productName}
                  LIMIT  1
                  FOR UPDATE`,
        ) as Array<{ id: number; current_stock: number; unit: string; product_name: string }>;

        if (settingRows.length === 0) continue; // non-tracked product — skip

        const setting      = settingRows[0];
        const currentStock = Number(setting.current_stock);

        // Idempotency: skip if this order already has an EXIT movement for
        // this product (belt-and-suspenders against state-machine failure).
        const existingMove = await tx.execute(
          sql`SELECT id
              FROM   inventory_movements
              WHERE  movement_type  = 'EXIT'
                AND  reference_type = 'order'
                AND  reference_id   = ${orderId}
                AND  (
                       product_id   = ${item.productId ?? null}
                    OR product_name = ${item.productName || ""}
                     )
              LIMIT 1`,
        ) as Array<{ id: number }>;

        if (existingMove.length > 0) continue;

        // ── Strict stock validation ────────────────────────────────────────
        // NEVER silently clamp to zero.  If stock is insufficient we fail the
        // entire transition with a clear user-facing error.  The caller's
        // pre-flight can optionally check stock before even entering the tx,
        // but this is the authoritative enforcement point under lock.
        if (currentStock < qty) {
          const productLabel = item.productName || setting.product_name || `#${item.productId}`;
          throw new BadRequestError(
            `Estoque insuficiente para "${productLabel}": ` +
            `disponível ${currentStock} ${setting.unit}, solicitado ${qty} ${setting.unit}. ` +
            `Reponha o estoque antes de aprovar este pedido.`,
            {
              productId:      item.productId,
              productName:    productLabel,
              currentStock,
              requiredQty:    qty,
              unit:           setting.unit,
            },
          );
        }

        // Atomic deduction — runs in the DB engine on the locked row.
        // The WHERE re-checks the stock condition to guard against a race
        // between the SELECT … FOR UPDATE read above and this UPDATE in case
        // another connection somehow updates the row (should not happen with
        // FOR UPDATE, but this is belt-and-suspenders).
        const deducted = await tx.execute(
          sql`UPDATE inventory_settings
              SET    current_stock = current_stock::numeric - ${qty}::numeric
              WHERE  id            = ${setting.id}
                AND  current_stock::numeric >= ${qty}::numeric
              RETURNING current_stock::text AS new_stock`,
        ) as Array<{ new_stock: string }>;

        if (deducted.length === 0) {
          // Race condition: someone else consumed stock between our SELECT
          // FOR UPDATE and this UPDATE — should be extremely rare.
          const productLabel = item.productName || setting.product_name;
          throw new BadRequestError(
            `Conflito de estoque para "${productLabel}": estoque alterado durante a operação. ` +
            `Tente novamente.`,
            { productId: item.productId },
          );
        }

        const newStock = deducted[0].new_stock;

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
          const toDateStr  = (d: Date) => d.toISOString().split("T")[0];

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
            companyId:      orderSnapshot.companyId,
            orderId,
            descricao:      `Pedido ${orderSnapshot.orderCode || `#${orderId}`}`,
            valor:          total.toFixed(2),
            dataEmissao:    toDateStr(emissao),
            dataVencimento: toDateStr(vencimento),
            status:         "pendente",
            formaPagamento: "pix",
            pixPayload,
          });

          arCreated = true;
        }
      }
    }

    // ── Step 4c: SHIPPED — conditional delivery row update ──────────────────
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

    // ── Step 5: Write outbox event (transactional reliability) ──────────────
    //
    // This INSERT is part of the same transaction. If the transaction rolls
    // back for any reason the event disappears too — there is no "phantom
    // event for a failed transition" problem. The background worker
    // (orders.outbox.worker.ts) reads from this table to execute push
    // notifications and audit logs with retry semantics.
    const outboxPayload: WorkflowEventPayload = {
      orderId,
      orderCode:  orderSnapshot.orderCode || null,
      companyId:  orderSnapshot.companyId,
      from,
      to,
      actor,
      result: {
        preNotaNumber,
        inventoryLinesDeducted,
        arCreated,
        deliveryUpdated,
      },
    };

    await tx.insert(workflowEvents).values({
      orderId,
      eventType: "TRANSITION",
      payload:   outboxPayload as any,
    });

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
