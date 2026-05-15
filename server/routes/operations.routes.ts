/**
 * FASE 1.5 — Timeline Operacional Correlacionada
 *
 * GET /api/admin/operations/timeline/:orderId
 *   Correlaciona: orders, workflow_events (outbox/retries/dead-letters),
 *   nfe_emissoes, nfe_training_logs, nf_drafts, accounts_receivable, event_store.
 *   Retorna timeline unificada + summary operacional.
 */

import type { Express } from "express";
import { requireAuth, requireRole } from "../core/http/requireAuth";
import { db } from "../database/db";
import {
  orders,
  workflowEvents,
  nfeEmissoes,
  nfeTrainingLogs,
  nfDrafts,
  accountsReceivable,
  eventStore,
  type WorkflowEventPayload,
} from "@shared/schema";
import { eq, asc } from "drizzle-orm";

// ─── Types ────────────────────────────────────────────────────────────────────

export type TimelineEventStatus = "success" | "error" | "warning" | "info" | "pending";
export type TimelineEventCategory = "orders" | "fiscal" | "workers" | "financial" | "errors" | "system";

export interface TimelineEvent {
  id: string;
  timestamp: string;
  tipo: string;
  status: TimelineEventStatus;
  categoria: TimelineEventCategory;
  origem: string;
  mensagem: string;
  metadata: Record<string, unknown>;
}

export interface TimelineSummary {
  totalEvents: number;
  failures: number;
  retries: number;
  lastEvent: string | null;
  firstEvent: string | null;
  totalDurationMs: number | null;
}

export interface TimelineResponse {
  order: {
    id: number;
    orderCode: string | null;
    status: string;
    workflowStatus: string;
    fiscalStatus: string | null;
    companyId: number;
    createdAt: string;
    deliveryDate: string | null;
  };
  events: TimelineEvent[];
  summary: TimelineSummary;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ts(d: Date | null | undefined): string {
  return d ? d.toISOString() : new Date(0).toISOString();
}

function nfeStatusToEventStatus(status: string): TimelineEventStatus {
  switch (status) {
    case "autorizada": return "success";
    case "cancelada":  return "warning";
    case "rejeitada":
    case "erro":
    case "denegada":   return "error";
    case "enviada":
    case "assinada":   return "info";
    default:           return "pending";
  }
}

function workflowStatusLabel(ws: string): string {
  const map: Record<string, string> = {
    CREATED:           "Criado",
    PENDING_APPROVAL:  "Aguardando aprovação",
    APPROVED:          "Aprovado",
    REJECTED:          "Rejeitado",
    INVOICED:          "Faturado",
    SHIPPED:           "Enviado",
    DELIVERED:         "Entregue",
    CANCELLED:         "Cancelado",
  };
  return map[ws] ?? ws;
}

function nfeDraftStatusLabel(s: string): string {
  return s === "finalized" ? "Rascunho NF-e finalizado" : "Rascunho NF-e criado";
}

// ─── Route registration ────────────────────────────────────────────────────────

export function register(app: Express): void {
  app.get(
    "/api/admin/operations/timeline/:orderId",
    requireAuth,
    requireRole(["MASTER", "ADMIN", "DIRECTOR", "DEVELOPER"]),
    async (req, res) => {
      const orderId = parseInt(String(req.params.orderId), 10);
      if (isNaN(orderId) || orderId <= 0) {
        return res.status(400).json({ success: false, error: "orderId inválido" });
      }

      try {
        // ── Fetch all correlated data in parallel ──────────────────────────
        const [
          orderRows,
          outboxRows,
          nfeRows,
          trainingRows,
          draftRows,
          arRows,
          storeRows,
        ] = await Promise.all([
          db.select().from(orders).where(eq(orders.id, orderId)).limit(1),
          db.select().from(workflowEvents).where(eq(workflowEvents.orderId, orderId)).orderBy(asc(workflowEvents.createdAt)),
          db.select().from(nfeEmissoes).where(eq(nfeEmissoes.orderId, orderId)).orderBy(asc(nfeEmissoes.createdAt)),
          db.select().from(nfeTrainingLogs).where(eq(nfeTrainingLogs.orderId, orderId)).orderBy(asc(nfeTrainingLogs.createdAt)),
          db.select().from(nfDrafts).where(eq(nfDrafts.orderId, orderId)).orderBy(asc(nfDrafts.createdAt)),
          db.select().from(accountsReceivable).where(eq(accountsReceivable.orderId, orderId)).orderBy(asc(accountsReceivable.createdAt)),
          db.select().from(eventStore).where(eq(eventStore.entityId, String(orderId))).orderBy(asc(eventStore.createdAt)),
        ]);

        if (orderRows.length === 0) {
          return res.status(404).json({ success: false, error: "Pedido não encontrado" });
        }

        const order = orderRows[0];
        const events: TimelineEvent[] = [];

        // ── 1. ORDER_CREATED ──────────────────────────────────────────────
        events.push({
          id: `order-created-${order.id}`,
          timestamp: ts(order.createdAt),
          tipo: "ORDER_CREATED",
          status: "success",
          categoria: "orders",
          origem: "orders",
          mensagem: `Pedido ${order.orderCode ?? `#${order.id}`} criado`,
          metadata: {
            orderId: order.id,
            orderCode: order.orderCode,
            companyId: order.companyId,
            totalValue: order.totalValue,
            weekReference: order.weekReference,
          },
        });

        // ── 2. OUTBOX / WORKFLOW EVENTS ───────────────────────────────────
        for (const ev of outboxRows) {
          const payload = ev.payload as WorkflowEventPayload | null;

          if (ev.deadLetter) {
            // Dead-letter event
            events.push({
              id: `outbox-dl-${ev.id}`,
              timestamp: ts(ev.createdAt),
              tipo: "OUTBOX_DEAD_LETTER",
              status: "error",
              categoria: "errors",
              origem: "outbox-worker",
              mensagem: `Dead-letter após ${ev.retryCount} tentativas: ${ev.errorMessage ?? "erro desconhecido"}`,
              metadata: {
                workflowEventId: ev.id,
                retryCount: ev.retryCount,
                errorMessage: ev.errorMessage,
                eventType: ev.eventType,
                from: payload?.from,
                to: payload?.to,
                actor: payload?.actor,
              },
            });
          } else if (ev.processedAt) {
            // Processed successfully — emit status-change event
            events.push({
              id: `outbox-ok-${ev.id}`,
              timestamp: ts(ev.processedAt),
              tipo: "ORDER_STATUS_CHANGED",
              status: "success",
              categoria: "orders",
              origem: "outbox-worker",
              mensagem: payload
                ? `Status: ${workflowStatusLabel(payload.from)} → ${workflowStatusLabel(payload.to)}`
                : "Transição de status processada",
              metadata: {
                workflowEventId: ev.id,
                from: payload?.from,
                to: payload?.to,
                actor: payload?.actor,
                retryCount: ev.retryCount,
                result: payload?.result,
              },
            });
            if (ev.retryCount > 0) {
              events.push({
                id: `outbox-retry-${ev.id}`,
                timestamp: ts(ev.createdAt),
                tipo: "OUTBOX_RETRY",
                status: "warning",
                categoria: "workers",
                origem: "outbox-worker",
                mensagem: `Processado após ${ev.retryCount} retentativa(s)`,
                metadata: {
                  workflowEventId: ev.id,
                  retryCount: ev.retryCount,
                  errorMessage: ev.errorMessage,
                },
              });
            }
          } else {
            // Still pending
            events.push({
              id: `outbox-pending-${ev.id}`,
              timestamp: ts(ev.createdAt),
              tipo: "OUTBOX_PENDING",
              status: "pending",
              categoria: "workers",
              origem: "outbox-worker",
              mensagem: ev.retryCount > 0
                ? `Aguardando reprocessamento (tentativa ${ev.retryCount + 1})`
                : "Aguardando processamento pelo worker",
              metadata: {
                workflowEventId: ev.id,
                retryCount: ev.retryCount,
                nextRetryAt: ev.nextRetryAt?.toISOString(),
                errorMessage: ev.errorMessage,
                eventType: ev.eventType,
              },
            });
          }
        }

        // ── 3. NF-e EMISSÕES ──────────────────────────────────────────────
        for (const nfe of nfeRows) {
          // NF-e gerada (criação)
          events.push({
            id: `nfe-created-${nfe.id}`,
            timestamp: ts(nfe.createdAt),
            tipo: "NFE_GENERATED",
            status: "info",
            categoria: "fiscal",
            origem: "fiscal",
            mensagem: `NF-e ${nfe.numero}/${nfe.serie} gerada (${nfe.ambienteFiscal ?? "homologacao"})`,
            metadata: {
              nfeId: nfe.id,
              fiscalRequestId: `NFE-${nfe.id}`,
              numero: nfe.numero,
              serie: nfe.serie,
              chaveNFe: nfe.chaveNFe,
              status: nfe.status,
              ambienteFiscal: nfe.ambienteFiscal,
            },
          });

          // NF-e autorizada
          if (nfe.dataAutorizacao) {
            events.push({
              id: `nfe-auth-${nfe.id}`,
              timestamp: ts(nfe.dataAutorizacao),
              tipo: "NFE_AUTHORIZED",
              status: "success",
              categoria: "fiscal",
              origem: "fiscal-sefaz",
              mensagem: `NF-e ${nfe.numero} autorizada pela SEFAZ (cStat: ${nfe.cStat ?? "—"})`,
              metadata: {
                nfeId: nfe.id,
                fiscalRequestId: `NFE-${nfe.id}`,
                protocolo: nfe.protocolo,
                cStat: nfe.cStat,
                xMotivo: nfe.xMotivo,
                chaveNFe: nfe.chaveNFe,
              },
            });
          }

          // NF-e cancelada
          if (nfe.canceladoEm) {
            events.push({
              id: `nfe-cancelled-${nfe.id}`,
              timestamp: ts(nfe.canceladoEm),
              tipo: "NFE_CANCELLED",
              status: "warning",
              categoria: "fiscal",
              origem: "fiscal-sefaz",
              mensagem: `NF-e ${nfe.numero} cancelada${nfe.motivoCancelamento ? `: ${nfe.motivoCancelamento}` : ""}`,
              metadata: {
                nfeId: nfe.id,
                fiscalRequestId: `NFE-${nfe.id}`,
                motivo: nfe.motivoCancelamento,
                protocolo: nfe.protocoloCancelamento,
                cStatCancelamento: nfe.cStatCancelamento,
                xMotivoCancelamento: nfe.xMotivoCancelamento,
              },
            });
          }

          // NF-e com erro/rejeição
          if (["rejeitada", "erro", "denegada"].includes(nfe.status)) {
            events.push({
              id: `nfe-error-${nfe.id}`,
              timestamp: ts(nfe.createdAt),
              tipo: "NFE_ERROR",
              status: "error",
              categoria: "errors",
              origem: "fiscal-sefaz",
              mensagem: `NF-e ${nfe.numero} com ${nfe.status}: ${nfe.xMotivo ?? "erro não especificado"}`,
              metadata: {
                nfeId: nfe.id,
                fiscalRequestId: `NFE-${nfe.id}`,
                status: nfe.status,
                cStat: nfe.cStat,
                xMotivo: nfe.xMotivo,
              },
            });
          }
        }

        // ── 4. NF-e TRAINING LOGS (erros SEFAZ) ──────────────────────────
        for (const tl of trainingRows) {
          events.push({
            id: `nfe-sefaz-err-${tl.id}`,
            timestamp: ts(tl.createdAt),
            tipo: "NFE_SEFAZ_ERROR",
            status: tl.resolvidoEm ? "warning" : "error",
            categoria: "errors",
            origem: "fiscal-diagnostics",
            mensagem: `Erro SEFAZ ${tl.codigoErro ?? ""}: ${tl.mensagemErro ?? "erro não especificado"}${tl.resolvidoEm ? " (resolvido)" : ""}`,
            metadata: {
              nfeTrainingId: tl.id,
              nfeId: tl.nfeId,
              fiscalRequestId: tl.nfeId ? `NFE-${tl.nfeId}` : null,
              codigoErro: tl.codigoErro,
              mensagemErro: tl.mensagemErro,
              campoAfetado: tl.campoAfetado,
              solucao: tl.solucao,
              telaCorrecao: tl.telaCorrecao,
              resolvidoEm: tl.resolvidoEm?.toISOString(),
            },
          });
        }

        // ── 5. NF-e DRAFTS ────────────────────────────────────────────────
        for (const draft of draftRows) {
          events.push({
            id: `nf-draft-${draft.id}`,
            timestamp: ts(draft.createdAt),
            tipo: draft.status === "finalized" ? "NFE_DRAFT_FINALIZED" : "NFE_DRAFT_CREATED",
            status: draft.status === "finalized" ? "success" : "info",
            categoria: "fiscal",
            origem: "fiscal",
            mensagem: nfeDraftStatusLabel(draft.status),
            metadata: {
              draftId: draft.id,
              status: draft.status,
              billingType: draft.billingType,
              useGroupedItems: draft.useGroupedItems,
              updatedAt: draft.updatedAt?.toISOString(),
            },
          });
        }

        // ── 6. ACCOUNTS RECEIVABLE (financeiro) ───────────────────────────
        for (const ar of arRows) {
          events.push({
            id: `ar-created-${ar.id}`,
            timestamp: ts(ar.createdAt),
            tipo: "AR_CREATED",
            status: "info",
            categoria: "financial",
            origem: "financial",
            mensagem: `Conta a receber criada: ${ar.descricao} — R$ ${parseFloat(ar.valor).toFixed(2)}`,
            metadata: {
              arId: ar.id,
              descricao: ar.descricao,
              valor: ar.valor,
              status: ar.status,
              formaPagamento: ar.formaPagamento,
              dataVencimento: ar.dataVencimento,
              dataEmissao: ar.dataEmissao,
            },
          });
          if (ar.pagoEm) {
            events.push({
              id: `ar-paid-${ar.id}`,
              timestamp: ts(ar.pagoEm),
              tipo: "AR_PAID",
              status: "success",
              categoria: "financial",
              origem: "financial",
              mensagem: `Pagamento registrado: R$ ${parseFloat(ar.valor).toFixed(2)} via ${ar.formaPagamento}`,
              metadata: {
                arId: ar.id,
                valor: ar.valor,
                formaPagamento: ar.formaPagamento,
                pagoEm: ar.pagoEm.toISOString(),
              },
            });
          }
        }

        // ── 7. EVENT STORE (genérico) ─────────────────────────────────────
        for (const ev of storeRows) {
          if (ev.entityType !== "order") continue;
          events.push({
            id: `event-store-${ev.id}`,
            timestamp: ts(ev.createdAt),
            tipo: ev.type,
            status: "info",
            categoria: "system",
            origem: "event-store",
            mensagem: `Evento do sistema: ${ev.type}`,
            metadata: (ev.metadata as Record<string, unknown>) ?? {},
          });
        }

        // ── Sort by timestamp ASC ─────────────────────────────────────────
        events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

        // ── Summary ───────────────────────────────────────────────────────
        const failures = events.filter((e) => e.status === "error").length;
        const retries  = outboxRows.reduce((acc, r) => acc + (r.retryCount ?? 0), 0);
        const timestamps = events.map((e) => e.timestamp);
        const firstEvent = timestamps.length > 0 ? timestamps[0] : null;
        const lastEvent  = timestamps.length > 0 ? timestamps[timestamps.length - 1] : null;
        const totalDurationMs =
          firstEvent && lastEvent
            ? new Date(lastEvent).getTime() - new Date(firstEvent).getTime()
            : null;

        const summary: TimelineSummary = {
          totalEvents: events.length,
          failures,
          retries,
          lastEvent,
          firstEvent,
          totalDurationMs,
        };

        const response: TimelineResponse = {
          order: {
            id: order.id,
            orderCode: order.orderCode,
            status: order.status,
            workflowStatus: order.workflowStatus,
            fiscalStatus: order.fiscalStatus,
            companyId: order.companyId,
            createdAt: ts(order.createdAt),
            deliveryDate: order.deliveryDate ? ts(order.deliveryDate) : null,
          },
          events,
          summary,
        };

        console.log(`[OPS_TIMELINE] orderId=${orderId} events=${events.length} failures=${failures} retries=${retries}`);
        return res.json({ success: true, data: response });
      } catch (err: any) {
        console.error(`[OPS_TIMELINE_ERROR] orderId=${orderId}`, err?.message ?? err);
        return res.status(500).json({ success: false, error: "Erro ao construir timeline" });
      }
    },
  );
}
