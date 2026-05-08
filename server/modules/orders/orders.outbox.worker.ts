/**
 * Outbox Worker — processes workflow_events written by executeWorkflowTransaction.
 *
 * ─── Why this file exists ────────────────────────────────────────────────────
 *
 * The transactional outbox pattern decouples reliable event delivery from the
 * critical transaction path.  Inside the order-transition transaction, a record
 * is written to `workflow_events` atomically alongside the order update.  If the
 * transaction rolls back the event disappears too — no orphan events.
 *
 * This worker runs as a background loop in the same Node.js process and:
 *   1. Polls `workflow_events` for unprocessed events (processedAt IS NULL).
 *   2. Uses `FOR UPDATE SKIP LOCKED` so multiple workers (or replicas) never
 *      race on the same event — each worker gets its own exclusive batch.
 *   3. Executes the side effects: push notification + audit log.
 *   4. On success: sets processedAt = NOW().
 *   5. On failure: increments retryCount and stores the errorMessage.
 *      After MAX_RETRIES failures the event is left with its last error for
 *      manual inspection — it is never silently dropped.
 *
 * ─── Horizontal scaling ──────────────────────────────────────────────────────
 *
 * `SKIP LOCKED` means any number of replicas can run this worker concurrently;
 * each will claim its own set of events without blocking the others.
 *
 * ─── Performance ─────────────────────────────────────────────────────────────
 *
 * The worker deliberately processes events OUTSIDE the critical transaction.
 * The order-transition response reaches the client as soon as the DB commits
 * the core writes — push latency does not add to API response time.
 */

import { pool } from "../../database/db";
import { type WorkflowEventPayload } from "@shared/schema";
import { ordersRepository } from "./orders.repository";
import { fireNotification } from "../../services/pushService";
// FASE 8.6J — isolamento multi-tenant: cada evento do outbox é processado
// dentro de runWithTenant(...) com um principal sintético "admin/SERVICE"
// pinado no companyId do payload. Garante que dispatchEvent (push + audit log)
// e qualquer chamada interna que dependa de currentTenantId() rode no
// contexto da empresa correta, sem mistura entre tenants.
import { runWithTenant, type TenantPrincipal } from "../../core/tenant/context";

const POLL_INTERVAL_MS = 5_000;   // check every 5 seconds
const BATCH_SIZE       = 10;      // events per tick
const MAX_RETRIES      = 5;       // give up after this many consecutive failures

const STATUS_LABELS: Record<string, string> = {
  PENDING_APPROVAL: "Aguardando aprovação",
  APPROVED:         "Aprovado",
  REJECTED:         "Rejeitado",
  INVOICED:         "Faturado",
  SHIPPED:          "Em expedição",
  DELIVERED:        "Entregue",
  CANCELLED:        "Cancelado",
};

// ─── Worker loop ──────────────────────────────────────────────────────────────

/**
 * Processes one batch of pending outbox events inside independent transactions.
 * Each event is committed (or retried) separately so one failing event does not
 * block healthy ones.
 */
async function processBatch(): Promise<void> {
  // Claim a batch of events atomically using pool.query() directly.
  // pool.query() always returns { rows: [...] } — no ambiguity with Drizzle's
  // top-level db.execute() which returns the full QueryResult outside a tx.
  //
  // FOR UPDATE SKIP LOCKED: multiple workers/replicas each get their own
  // exclusive subset of events — no duplicate processing, no blocking.
  // MT-3B M3 — STRUCTURAL RISK: workflow_events has no direct tenantId/empresaId column.
  // Tenant identity is embedded in payload.companyId (WorkflowEventPayload).
  // This SELECT is intentionally cross-tenant: the background worker must process ALL
  // pending events and extracts the tenant from each event's payload below.
  // Fail-safe: events without payload.companyId are skipped (line 97).
  // Future: add a direct tenant column to enable DB-level tenant filtering (not MT-3B scope).
  const { rows: events } = await pool.query<{
    id: number;
    order_id: number;
    event_type: string;
    payload: WorkflowEventPayload;
    retry_count: number;
  }>(
    `SELECT   id, order_id, event_type, payload, retry_count
     FROM     workflow_events
     WHERE    processed_at IS NULL
       AND    retry_count  < $1
     ORDER BY created_at
     LIMIT    $2
     FOR UPDATE SKIP LOCKED`,
    [MAX_RETRIES, BATCH_SIZE],
  );

  for (const event of events) {
    // FASE 8.6J — extrai companyId do payload do evento. O outbox grava o
    // payload tipado como WorkflowEventPayload, que sempre traz companyId
    // (ver orders.outbox no executeWorkflowTransaction). O cast defensivo
    // protege contra eventuais eventos legados.
    const companyId = (event.payload as any)?.companyId;

    // fail-safe — não processa evento sem tenant alvo seguro
    if (!companyId) {
      console.warn("[OUTBOX] Evento sem companyId — ignorado por segurança");
      continue;
    }

    const tenantPrincipal: TenantPrincipal = {
      kind: "admin",
      empresaId: companyId,
      userId: 0,
      role: "SERVICE",
    };

    await runWithTenant(
      { principal: tenantPrincipal, empresaId: companyId },
      async () => {
        try {
          await dispatchEvent(event.event_type, event.payload);

          await pool.query(
            `UPDATE workflow_events
             SET    processed_at  = NOW(),
                    error_message = NULL
             WHERE  id            = $1`,
            [event.id],
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[OUTBOX] Event #${event.id} (order ${event.order_id}) failed: ${message}`);

          await pool.query(
            `UPDATE workflow_events
             SET    retry_count   = retry_count + 1,
                    error_message = $1
             WHERE  id            = $2`,
            [message.slice(0, 1000), event.id],
          );
        }
      },
    );
  }
}

/** Dispatch a single event to its handler based on eventType. */
async function dispatchEvent(
  eventType: string,
  payload: WorkflowEventPayload,
): Promise<void> {
  if (eventType !== "TRANSITION") {
    console.warn(`[OUTBOX] Unknown event type "${eventType}" — skipping`);
    return;
  }

  await handleTransitionEvent(payload);
}

/** Handle a TRANSITION event: push notification + audit log. */
async function handleTransitionEvent(p: WorkflowEventPayload): Promise<void> {
  // ── Push notification ────────────────────────────────────────────────────
  try {
    fireNotification(
      p.to === "CANCELLED" ? "order_cancelled" : "order_updated",
      {
        code:    p.orderCode || `#${p.orderId}`,
        company: `Empresa #${p.companyId}`,
        status:  STATUS_LABELS[p.to] || p.to,
      },
      {
        url:       `/admin/orders/${p.orderId}`,
        companyId: p.companyId,
      },
    );
  } catch (pushErr) {
    // Push failures are non-fatal — log and continue to audit log.
    console.warn("[OUTBOX] Push notification failed:", pushErr);
  }

  // ── Audit log ────────────────────────────────────────────────────────────
  const parts: string[] = [
    `Pedido #${p.orderId} (${p.orderCode || p.orderId}): ${p.from} → ${p.to}`,
  ];
  if (p.result.preNotaNumber)
    parts.push(`pre-nota: ${p.result.preNotaNumber}`);
  if (p.result.inventoryLinesDeducted)
    parts.push(`estoque: ${p.result.inventoryLinesDeducted} produto(s) baixado(s)`);
  if (p.result.arCreated)
    parts.push("conta a receber criada");
  if (p.result.deliveryUpdated)
    parts.push("entrega: em_rota");

  await ordersRepository.createLog({
    action:      "WORKFLOW_TRANSITION",
    description: parts.join(" — "),
    userId:      p.actor.id,
    userEmail:   p.actor.email,
    userRole:    p.actor.role,
    level:       "INFO",
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

let workerTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the outbox worker. Safe to call multiple times — subsequent calls
 * are no-ops if the worker is already running.
 */
export function startOutboxWorker(): void {
  if (workerTimer !== null) return;

  console.log(
    `[OUTBOX] Worker started (poll=${POLL_INTERVAL_MS}ms, batch=${BATCH_SIZE}, maxRetries=${MAX_RETRIES})`,
  );

  workerTimer = setInterval(async () => {
    try {
      await processBatch();
    } catch (err) {
      // processBatch itself should not throw, but guard anyway.
      console.error("[OUTBOX] Unexpected worker error:", err);
    }
  }, POLL_INTERVAL_MS);

  // Allow Node.js to exit cleanly even if the interval is active.
  workerTimer.unref();
}

/**
 * Stop the outbox worker (used in tests and graceful shutdown).
 */
export function stopOutboxWorker(): void {
  if (workerTimer !== null) {
    clearInterval(workerTimer);
    workerTimer = null;
    console.log("[OUTBOX] Worker stopped.");
  }
}
