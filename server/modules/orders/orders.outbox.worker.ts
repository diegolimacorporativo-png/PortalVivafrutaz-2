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
 *   5. On failure: increments retryCount, computes next_retry_at with exponential
 *      backoff, stores the errorMessage.
 *      After MAX_RETRIES failures the event is marked dead_letter = true for
 *      manual inspection — it is never silently dropped.
 *
 * ─── FASE 3.2 — Retry + Resiliência ─────────────────────────────────────────
 *
 * - Exponential backoff via next_retry_at: events are not retried immediately
 *   after failure — the worker skips them until their next_retry_at window opens.
 * - Dead-letter: after MAX_RETRIES consecutive failures, dead_letter = true.
 *   Dead-letter events are excluded from normal polling and exposed via the
 *   observability panel for manual inspection or re-queue.
 * - observability: incJobFailures() on batch-level errors.
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
import { runWithTenant, type TenantPrincipal } from "../../core/tenant/context";
import { incJobFailures, incDeadLetterCount } from "../../core/observability/metrics";
import { computeNextRetryAt } from "../../core/retry/withRetry";

const POLL_INTERVAL_MS = 5_000;
const BATCH_SIZE       = 10;
const MAX_RETRIES      = 5;

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

async function processBatch(): Promise<void> {
  // FASE 3.2 — filtra por:
  //   1. processedAt IS NULL (pendente)
  //   2. dead_letter = false (não esgotou retries)
  //   3. next_retry_at IS NULL OR next_retry_at <= NOW() (janela de retry aberta)
  // Isso evita flood ao banco: eventos falhos só são reprocessados após backoff.
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
       AND    dead_letter   = false
       AND    (next_retry_at IS NULL OR next_retry_at <= NOW())
     ORDER BY created_at
     LIMIT    $1
     FOR UPDATE SKIP LOCKED`,
    [BATCH_SIZE],
  );

  for (const event of events) {
    const companyId = (event.payload as any)?.companyId;

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
                    error_message = NULL,
                    next_retry_at = NULL
             WHERE  id            = $1`,
            [event.id],
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const newRetryCount = event.retry_count + 1;
          const isDeadLetter = newRetryCount >= MAX_RETRIES;

          if (isDeadLetter) {
            // FASE 3.2 — DEAD LETTER: esgotou MAX_RETRIES, marcar permanentemente
            console.error(
              `[OUTBOX_DEAD_LETTER] Event #${event.id} (order ${event.order_id}) permanently failed after ${newRetryCount} attempts. Reason: ${message}`,
            );
            await pool.query(
              `UPDATE workflow_events
               SET    retry_count   = $1,
                      error_message = $2,
                      dead_letter   = true,
                      next_retry_at = NULL
               WHERE  id            = $3`,
              [newRetryCount, message.slice(0, 1000), event.id],
            );
            incJobFailures();
            incDeadLetterCount();
          } else {
            // FASE 3.2 — RETRY com backoff exponencial
            const nextRetryAt = computeNextRetryAt(newRetryCount);
            console.error(
              `[OUTBOX] Event #${event.id} (order ${event.order_id}) failed (attempt ${newRetryCount}/${MAX_RETRIES}). Next retry: ${nextRetryAt.toISOString()}. Error: ${message}`,
            );
            await pool.query(
              `UPDATE workflow_events
               SET    retry_count   = $1,
                      error_message = $2,
                      next_retry_at = $3
               WHERE  id            = $4`,
              [newRetryCount, message.slice(0, 1000), nextRetryAt, event.id],
            );
          }
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

export function startOutboxWorker(): void {
  if (workerTimer !== null) return;

  console.log(
    `[OUTBOX] Worker started (poll=${POLL_INTERVAL_MS}ms, batch=${BATCH_SIZE}, maxRetries=${MAX_RETRIES}, backoff=exponencial)`,
  );

  workerTimer = setInterval(async () => {
    try {
      await processBatch();
    } catch (err) {
      console.error("[OUTBOX] Unexpected worker error:", err);
      incJobFailures();
    }
  }, POLL_INTERVAL_MS);

  workerTimer.unref();
}

export function stopOutboxWorker(): void {
  if (workerTimer !== null) {
    clearInterval(workerTimer);
    workerTimer = null;
    console.log("[OUTBOX] Worker stopped.");
  }
}

/**
 * FASE 3.2 — Re-enfileira um evento dead-letter para reprocessamento.
 * Limpa dead_letter, zerando retry_count e next_retry_at.
 * Deve ser chamado apenas por rota administrativa (MASTER).
 */
export async function requeueDeadLetterEvent(eventId: number): Promise<void> {
  await pool.query(
    `UPDATE workflow_events
     SET    dead_letter   = false,
            retry_count   = 0,
            error_message = NULL,
            next_retry_at = NULL
     WHERE  id            = $1
       AND  dead_letter   = true
       AND  processed_at  IS NULL`,
    [eventId],
  );
}

/**
 * FASE 3.2 — Lista todos os eventos em dead-letter (para o painel operacional).
 */
export async function getDeadLetterEvents(): Promise<Array<{
  id: number;
  orderId: number;
  eventType: string;
  retryCount: number;
  errorMessage: string | null;
  createdAt: Date;
  companyId: number | null;
}>> {
  const { rows } = await pool.query<{
    id: number;
    order_id: number;
    event_type: string;
    retry_count: number;
    error_message: string | null;
    created_at: Date;
    company_id: number | null;
  }>(
    `SELECT id,
            order_id,
            event_type,
            retry_count,
            error_message,
            created_at,
            (payload->>'companyId')::int AS company_id
     FROM   workflow_events
     WHERE  dead_letter  = true
       AND  processed_at IS NULL
     ORDER BY created_at DESC
     LIMIT 200`,
  );

  return rows.map((r) => ({
    id:           r.id,
    orderId:      r.order_id,
    eventType:    r.event_type,
    retryCount:   r.retry_count,
    errorMessage: r.error_message,
    createdAt:    r.created_at,
    companyId:    r.company_id,
  }));
}
