import { eq } from "drizzle-orm";
import { db } from "../../database/db";
import {
  orders,
  inventorySettings,
  inventoryMovements,
  accountsReceivable,
  deliveries,
} from "@shared/schema";
import { legacyStatusFor, OrderStatus } from "./orders.workflow";

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
  /** Current value of orders.status (legacy column). */
  currentLegacyStatus: string;
  /** Order row snapshot read BEFORE the transaction begins. */
  orderSnapshot: any;
  /** Order items snapshot read BEFORE the transaction begins. */
  itemsSnapshot: any[];
  /** Company config snapshot (needed for PIX payload generation). */
  companyConfig: any;
  /** User performing the action (for movement audit trail). */
  actor: { id: number; email: string; role: string; name?: string };
}

// ─── Main entry-point ─────────────────────────────────────────────────────────

/**
 * Execute all critical DB writes for a workflow transition in a single
 * PostgreSQL transaction.
 *
 * Design decisions:
 *  - Uses Drizzle's `db.transaction()` so the entire block is one pg BEGIN/COMMIT.
 *  - Does NOT call the `storage` facade — that layer has no tx-context parameter.
 *    All reads and writes are done directly via `db` so they run on the same
 *    connection and respect the open transaction.
 *  - Reads that are only needed inside this function (inventory setting lookup,
 *    AR existence check) are also done inside the transaction so they hold a
 *    consistent snapshot and avoid TOCTOU races.
 *  - Pre-transaction reads (order, items, company config, company AR) are passed
 *    in via `input` so the caller can use them for validation before committing
 *    a transaction slot.
 *
 * Critical writes per transition:
 *  ALL          → update orders.workflow_status + orders.status (legacy sync)
 *  APPROVED     → set pre_nota_number (if absent), deduct inventory
 *  INVOICED     → create accounts_receivable record (if not already seeded)
 *  SHIPPED      → set deliveries.status = 'em_rota' for the order's delivery row
 *
 * If any write throws, Drizzle automatically issues ROLLBACK before re-throwing.
 */
export async function executeWorkflowTransaction(
  input: TransactionInput,
): Promise<CriticalTransitionResult> {
  const { orderId, to, currentLegacyStatus, orderSnapshot, itemsSnapshot, companyConfig, actor } = input;
  const newLegacyStatus = legacyStatusFor(to, currentLegacyStatus);
  const today = new Date().toISOString().split("T")[0];

  return db.transaction(async (tx) => {
    // ── 1. Update both status columns atomically ──────────────────────────
    const [updatedOrder] = await tx
      .update(orders)
      .set({
        workflowStatus: to,
        status: newLegacyStatus,
      })
      .where(eq(orders.id, orderId))
      .returning();

    let preNotaNumber: string | null = null;
    let inventoryLinesDeducted = 0;
    let arCreated = false;
    let deliveryUpdated = false;

    // ── 2a. APPROVED — pre-nota + inventory reservation ──────────────────
    if (to === OrderStatus.APPROVED) {
      // Generate pre-nota if the order doesn't already have one.
      if (!orderSnapshot.preNotaNumber) {
        preNotaNumber = `VF-NF-${orderId.toString().padStart(6, "0")}`;
        await tx
          .update(orders)
          .set({ preNotaNumber })
          .where(eq(orders.id, orderId));
      } else {
        preNotaNumber = orderSnapshot.preNotaNumber;
      }

      // Reserve stock for every line item.
      for (const item of itemsSnapshot) {
        const qty = parseFloat(String(item.quantity || 0));
        if (qty <= 0) continue;

        // Find the inventory setting for this product.
        let settingRows = await tx
          .select()
          .from(inventorySettings)
          .where(eq(inventorySettings.productId, item.productId))
          .limit(1);

        // Fall back to name lookup when no productId match exists.
        if (settingRows.length === 0 && item.productName) {
          settingRows = await tx
            .select()
            .from(inventorySettings)
            .where(eq(inventorySettings.productName, item.productName))
            .limit(1);
        }

        if (settingRows.length === 0) continue; // no setting = skip (non-tracked product)

        const setting = settingRows[0];
        const prev = parseFloat(String(setting.currentStock || "0"));
        const newStock = Math.max(0, prev - qty);

        // Deduct stock.
        await tx
          .update(inventorySettings)
          .set({ currentStock: String(newStock) })
          .where(eq(inventorySettings.id, setting.id));

        // Record the movement.
        await tx.insert(inventoryMovements).values({
          productId: item.productId ?? null,
          productName: item.productName || `Produto #${item.productId}`,
          movementType: "EXIT",
          quantity: String(qty),
          balanceAfter: String(newStock),
          unit: setting.unit,
          referenceType: "order",
          referenceId: orderId,
          notes: `Pedido aprovado: ${orderSnapshot.orderCode || `#${orderId}`}`,
          date: today,
          createdBy: actor.name || actor.email || "Sistema",
        });

        inventoryLinesDeducted++;
      }
    }

    // ── 2b. INVOICED — accounts receivable seeding ───────────────────────
    if (to === OrderStatus.INVOICED) {
      // Idempotency: only create if none exists for this order.
      const existing = await tx
        .select({ id: accountsReceivable.id })
        .from(accountsReceivable)
        .where(eq(accountsReceivable.orderId, orderId))
        .limit(1);

      if (existing.length === 0) {
        const total = itemsSnapshot.reduce(
          (sum, item) => sum + parseFloat(String(item.totalPrice || "0")),
          0,
        );

        if (total > 0) {
          const emissao = new Date();
          const vencimento = new Date(emissao);
          vencimento.setDate(vencimento.getDate() + 30);
          const toDate = (d: Date) => d.toISOString().split("T")[0];

          // Build PIX payload from company config.
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
            companyId: orderSnapshot.companyId,
            orderId,
            descricao: `Pedido ${orderSnapshot.orderCode || `#${orderId}`}`,
            valor: total.toFixed(2),
            dataEmissao: toDate(emissao),
            dataVencimento: toDate(vencimento),
            status: "pendente",
            formaPagamento: "pix",
            pixPayload,
          });

          arCreated = true;
        }
      }
    }

    // ── 2c. SHIPPED — logistics delivery row update ───────────────────────
    if (to === OrderStatus.SHIPPED) {
      const deliveryRows = await tx
        .select({ id: deliveries.id })
        .from(deliveries)
        .where(eq(deliveries.orderId, orderId))
        .limit(1);

      if (deliveryRows.length > 0) {
        await tx
          .update(deliveries)
          .set({ status: "em_rota", updatedAt: new Date() })
          .where(eq(deliveries.id, deliveryRows[0].id));
        deliveryUpdated = true;
      }
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
 * Identical algorithm to the one used by `seedAccountReceivableOnConfirm`.
 */
function buildPixPayload(
  cnpj: string,
  total: number,
  companyName?: string,
  city?: string,
): string {
  const chave = String(cnpj).replace(/\D/g, "");
  const sanitize = (s: string, max: number) =>
    (s || "").replace(/[^\w\s]/gi, "").slice(0, max).trim() || "VIVA";
  const tlv = (idTag: string, v: string) =>
    `${idTag}${String(v.length).padStart(2, "0")}${v}`;

  const merchant = tlv("00", "br.gov.bcb.pix") + tlv("01", chave.slice(0, 77));
  const addData = tlv("62", tlv("05", `AR${Date.now().toString().slice(-10)}`));

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
