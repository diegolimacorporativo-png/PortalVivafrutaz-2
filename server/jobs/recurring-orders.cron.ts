/**
 * PEDIDO RECORRENTE — Cron Semanal
 *
 * Toda segunda-feira às 06:00, gera automaticamente pedidos com
 * workflowStatus = "PENDING_APPROVAL" para cada empresa que possui:
 *   1. Contrato ativo (status = "ativo")
 *   2. Escopos contratuais (contract_scopes) cadastrados
 *
 * Regras:
 *   - Gera apenas para contratos ativos e dentro da vigência
 *   - Respeita frequência (dayOfWeek por escopo)
 *   - Respeita weekNumber para contratos alternados (semana 1 ou 2)
 *   - Impede duplicatas via recurring_order_logs (idempotência)
 *   - Pedidos criados como isRecurring=true, workflowStatus="PENDING_APPROVAL"
 *   - Permite edição pelo Comercial antes da aprovação
 *   - Registra log completo de cada execução
 */

import cron from "node-cron";
import { db } from "../database/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import { runWithTenant } from "../core/tenant/context";
import { isUniqueOccurrenceConflict, persistContractOccurrence } from "../modules/orders/contract-occurrence-materialization";
import {
  contratosClientes,
  contractScopes,
  recurringOrderLogs,
} from "@shared/schema";
// R1: pipeline oficial de criação de pedidos — substitui db.insert(orders) direto
import { ordersService } from "../modules/orders/orders.service";

// ─── Mapeamento dia PT-BR → offset a partir de segunda-feira ─────────────────
const DAY_OFFSETS: Record<string, number> = {
  "Segunda-feira": 0,
  "Terça-feira": 1,
  "Quarta-feira": 2,
  "Quinta-feira": 3,
  "Sexta-feira": 4,
  "Sábado": 5,
  "Domingo": 6,
};

const PT_MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

/** Retorna a segunda-feira da semana corrente */
function getMondayOfCurrentWeek(ref = new Date()): Date {
  const d = new Date(ref);
  const day = d.getDay(); // 0=dom, 1=seg...
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diffToMonday);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** ISO week number (1-based) usado para calcular semana alternada */
function getISOWeekNumber(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/** Chave ISO da semana, ex: "2026-W30" */
function isoWeekKey(monday: Date): string {
  const week = getISOWeekNumber(monday);
  return `${monday.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** weekReference no formato legível, ex: "Janeiro 5–11/2026" */
function buildWeekReference(monday: Date): string {
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const month = PT_MONTHS[monday.getMonth()];
  return `${month} ${monday.getDate()}–${sunday.getDate()}/${sunday.getFullYear()}`;
}

/** Converte dia da semana PT-BR para data concreta dentro da semana */
function dateForDay(monday: Date, dayOfWeek: string): Date | null {
  const offset = DAY_OFFSETS[dayOfWeek];
  if (offset === undefined) return null;
  const d = new Date(monday);
  d.setDate(monday.getDate() + offset);
  d.setHours(8, 0, 0, 0); // Entrega às 08:00
  return d;
}

/** Verifica se a semana ISO deve ser processada para weekNumber 1 ou 2 */
function weekMatchesNumber(isoWeek: number, weekNumber: number | null): boolean {
  if (weekNumber === null || weekNumber === undefined) return true; // toda semana
  // semana 1 = ISO ímpar, semana 2 = ISO par (ciclo alternado)
  return weekNumber === 1 ? isoWeek % 2 === 1 : isoWeek % 2 === 0;
}

// ─── Core ─────────────────────────────────────────────────────────────────────

export async function runRecurringOrdersCron(options: { companyId?: number } = {}): Promise<{
  created: number;
  skipped: number;
  errors: number;
  orders: any[];
  weekLabel: string;
}> {
  const runId = `recurring-${Date.now()}`;
  const now = new Date();
  const monday = getMondayOfCurrentWeek(now);
  const weekKey = isoWeekKey(monday);
  const isoWeek = getISOWeekNumber(monday);
  const weekRef = buildWeekReference(monday);

  console.log("[RECURRING_ORDERS] Iniciando", { runId, weekKey, weekRef, ts: now.toISOString() });

  // 1. Busca contratos ativos dentro da vigência
  const contratos = await db
    .select({
      id: contratosClientes.id,
      empresaId: contratosClientes.empresaId,
      dataInicio: contratosClientes.dataInicio,
      dataFim: contratosClientes.dataFim,
    })
    .from(contratosClientes)
    .where(eq(contratosClientes.status, "ativo"));

  const contratosVigentes = contratos.filter((c) => {
    if (!c.dataFim) return true; // sem data de fim = vigente indefinidamente
    return new Date(c.dataFim) >= monday;
  });

  if (contratosVigentes.length === 0) {
    console.log("[RECURRING_ORDERS] Nenhum contrato ativo encontrado.", { runId });
    return { created: 0, skipped: 0, errors: 0, orders: [], weekLabel: weekRef };
  }

  const companyIds = [...new Set(contratosVigentes
    .filter((contract) => options.companyId == null || contract.empresaId === options.companyId)
    .map((c) => c.empresaId))];
  if (companyIds.length === 0) return { created: 0, skipped: 0, errors: 0, orders: [], weekLabel: weekRef };
  console.log("[RECURRING_ORDERS] Empresas a processar:", { count: companyIds.length, runId });

  // 2. Busca todos os escopos das empresas com contrato ativo
  const allScopes = await db
    .select()
    .from(contractScopes)
    .where(inArray(contractScopes.companyId, companyIds))
    .orderBy(asc(contractScopes.id));

  if (allScopes.length === 0) {
    console.log("[RECURRING_ORDERS] Nenhum escopo contratual encontrado.", { runId });
    return { created: 0, skipped: 0, errors: 0, orders: [], weekLabel: weekRef };
  }

  // 3. Busca logs de idempotência para esta semana (evita duplicatas)
  const existingLogs = await db
    .select({ companyId: recurringOrderLogs.companyId, dayOfWeek: recurringOrderLogs.dayOfWeek, contractId: recurringOrderLogs.contractId, orderId: recurringOrderLogs.orderId, deliveryDate: recurringOrderLogs.deliveryDate })
    .from(recurringOrderLogs)
    .where(eq(recurringOrderLogs.weekKey, weekKey));

  const processedSet = new Set(existingLogs.map((l) => `${l.companyId}:${l.dayOfWeek}`));
  for (const legacy of existingLogs) {
    if (!legacy.contractId || !legacy.orderId || !legacy.deliveryDate) {
      console.warn("[RECURRING_ORDER_OCCURRENCE_PENDING] Registro legado sem origem contratual comprovada; não será retroativamente atribuído", {
        companyId: legacy.companyId, weekKey, dayOfWeek: legacy.dayOfWeek,
      });
    }
  }

  // 4. Agrupa escopos por empresa e por dia da semana
  const byCompanyDay = new Map<string, typeof allScopes>();
  for (const scope of allScopes) {
    const key = `${scope.companyId}:${scope.dayOfWeek}`;
    if (!byCompanyDay.has(key)) byCompanyDay.set(key, []);
    byCompanyDay.get(key)!.push(scope);
  }

  let created = 0;
  let skipped = 0;
  let errors = 0;
  const createdOrders: any[] = [];

  // 5. Para cada empresa/dia, gera o pedido se ainda não foi gerado
  for (const [key, scopes] of byCompanyDay.entries()) {
    const [companyIdStr, dayOfWeek] = key.split(":");
    const companyId = parseInt(companyIdStr, 10);

    // Idempotência — já gerado nesta semana?
    if (processedSet.has(key)) {
      skipped++;
      continue;
    }

    // Data de entrega para este dia
    const deliveryDate = dateForDay(monday, dayOfWeek);
    if (!deliveryDate) {
      console.warn("[RECURRING_ORDERS] Dia inválido ignorado", { companyId, dayOfWeek });
      skipped++;
      continue;
    }

    const applicableScopes = scopes.filter((s) => weekMatchesNumber(isoWeek, s.weekNumber));
    if (applicableScopes.length === 0) { skipped++; continue; }
    const deliveryKey = deliveryDate.toISOString().slice(0, 10);
    const companyContracts = contratosVigentes.filter((c) => c.empresaId === companyId &&
      new Date(c.dataInicio) <= new Date(`${deliveryKey}T23:59:59`) &&
      (!c.dataFim || new Date(c.dataFim) >= new Date(`${deliveryKey}T00:00:00`)));
    // contract_scopes is company-scoped in the current schema, not contract-
    // scoped. Never guess which contract owns a scope when multiple contracts
    // overlap; leave the occurrence unmaterialized for human resolution.
    if (companyContracts.length !== 1) {
      errors++;
      console.error("[RECURRING_ORDER_OCCURRENCE_PENDING] Origem contratual ambígua; ocorrência não materializada", { companyId, dayOfWeek, deliveryKey, contractCount: companyContracts.length });
      continue;
    }
    const sourceContract = companyContracts[0];

    try {
      // Calcula total e monta itens
      const totalValue = applicableScopes.reduce((sum, s) => {
        const price = parseFloat(s.unitPrice ?? "0");
        const qty = s.quantity ?? 1;
        return sum + price * qty;
      }, 0);

      const items = applicableScopes.map((s) => ({
        productId: s.productId,
        quantity: s.quantity ?? 1,
        unitPrice: s.unitPrice ?? "0.00",
        totalPrice: (parseFloat(s.unitPrice ?? "0") * (s.quantity ?? 1)).toFixed(2),
      }));

      // R1: pipeline oficial — cria pedido via OrdersService.createInternal().
      // Garante: orderCode gerado pelo repo, afterCreate (audit log, auto-logistics,
      // notificações) executado para TODOS os pedidos recorrentes.
      const newOrder = await runWithTenant({
        principal: { kind: "admin", empresaId: companyId, userId: 0, role: "SERVICE" },
        empresaId: companyId,
      }, async () => db.transaction(async (tx) => {
        const [lockedContract] = await tx.select().from(contratosClientes)
          .where(and(eq(contratosClientes.id, sourceContract.id), eq(contratosClientes.empresaId, companyId), eq(contratosClientes.status, "ativo")))
          .for("share");
        if (!lockedContract || new Date(lockedContract.dataInicio) > new Date(`${deliveryKey}T23:59:59`) || (lockedContract.dataFim && new Date(lockedContract.dataFim) < new Date(`${deliveryKey}T00:00:00`))) {
          throw new Error("Contrato deixou de ser válido para a data da ocorrência.");
        }
        const currentScopes = await tx.select().from(contractScopes)
          .where(and(eq(contractScopes.companyId, companyId), eq(contractScopes.dayOfWeek, dayOfWeek)))
          .orderBy(asc(contractScopes.id));
        const currentApplicableScopes = currentScopes.filter((scope) => weekMatchesNumber(isoWeek, scope.weekNumber));
        if (currentApplicableScopes.length !== applicableScopes.length || currentApplicableScopes.some((scope, index) =>
          scope.id !== applicableScopes[index].id || Number(scope.quantity ?? 1) !== Number(applicableScopes[index].quantity ?? 1) || scope.productId !== applicableScopes[index].productId)) {
          throw new Error("Escopo contratual foi alterado durante a materialização.");
        }
        const created = await ordersService.createInternal(
          {
          companyId,
          status: "ACTIVE",
          workflowStatus: "PENDING_APPROVAL",
          isRecurring: true,
          productionOrigin: "CONTRACT_FIXED",
          weekReference: weekRef,
          deliveryDate,
          orderDate: now,
          totalValue: totalValue.toFixed(2),
          orderNote: `Programação contratual ${sourceContract.id} — ${dayOfWeek} — ${weekRef}`,
          },
          items,
          { source: "recurring-cron", tx },
        );
        const occurrence = await persistContractOccurrence(tx, {
          companyId, weekKey, dayOfWeek, orderId: created.id,
          contractId: sourceContract.id, deliveryDate: deliveryKey,
          scopes: applicableScopes, totalValue: totalValue.toFixed(2),
        });
        return { order: created, occurrence };
      }));

      ordersService.dispatchInternalOrderCreated(newOrder.order, { ...newOrder.order }, items, { source: "recurring-cron" });

      created++;
      createdOrders.push({ ...newOrder.order, dayName: dayOfWeek });
      console.log("[RECURRING_ORDERS] Pedido criado", {
        companyId, dayOfWeek, weekKey, orderId: newOrder.order.id,
        orderCode: newOrder.order.orderCode,
      });
    } catch (err: any) {
      // A unique occurrence constraint serializes concurrent runs. If another
      // transaction won, its committed occurrence is the idempotent result.
      const committedOccurrence = await db.select({ id: recurringOrderLogs.id })
        .from(recurringOrderLogs)
        .where(and(eq(recurringOrderLogs.companyId, companyId), eq(recurringOrderLogs.weekKey, weekKey), eq(recurringOrderLogs.dayOfWeek, dayOfWeek)));
      if (isUniqueOccurrenceConflict(err) && committedOccurrence.length > 0) {
        skipped++;
        continue;
      }
      errors++;
      console.error("[RECURRING_ORDER_OCCURRENCE_PENDING] Erro ao materializar ocorrência contratual", {
        companyId, dayOfWeek, weekKey, error: err?.message,
      });
    }
  }

  console.log("[RECURRING_ORDERS] Concluído", { runId, created, skipped, errors, weekKey });
  return { created, skipped, errors, orders: createdOrders, weekLabel: weekRef };
}

// ─── Agendamento ──────────────────────────────────────────────────────────────

export function startRecurringOrdersCron(): void {
  // Toda segunda-feira às 06:00
  cron.schedule("0 6 * * 1", async () => {
    try {
      await runRecurringOrdersCron();
    } catch (err: any) {
      console.error("[RECURRING_ORDERS] Falha crítica no cron", { error: err?.message });
    }
  });

  console.log("[RECURRING_ORDERS] Cron agendado: toda segunda-feira às 06:00");
}
