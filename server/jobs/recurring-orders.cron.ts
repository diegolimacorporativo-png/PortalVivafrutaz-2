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
import { eq, inArray } from "drizzle-orm";
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

export async function runRecurringOrdersCron(): Promise<void> {
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
    return;
  }

  const companyIds = [...new Set(contratosVigentes.map((c) => c.empresaId))];
  console.log("[RECURRING_ORDERS] Empresas a processar:", { count: companyIds.length, runId });

  // 2. Busca todos os escopos das empresas com contrato ativo
  const allScopes = await db
    .select()
    .from(contractScopes)
    .where(inArray(contractScopes.companyId, companyIds));

  if (allScopes.length === 0) {
    console.log("[RECURRING_ORDERS] Nenhum escopo contratual encontrado.", { runId });
    return;
  }

  // 3. Busca logs de idempotência para esta semana (evita duplicatas)
  const existingLogs = await db
    .select({ companyId: recurringOrderLogs.companyId, dayOfWeek: recurringOrderLogs.dayOfWeek })
    .from(recurringOrderLogs)
    .where(eq(recurringOrderLogs.weekKey, weekKey));

  const processedSet = new Set(existingLogs.map((l) => `${l.companyId}:${l.dayOfWeek}`));

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

  // 5. Para cada empresa/dia, gera o pedido se ainda não foi gerado
  for (const [key, scopes] of byCompanyDay.entries()) {
    const [companyIdStr, dayOfWeek] = key.split(":");
    const companyId = parseInt(companyIdStr, 10);

    // Idempotência — já gerado nesta semana?
    if (processedSet.has(key)) {
      skipped++;
      continue;
    }

    // Respeita weekNumber (alternado): se algum escopo tem weekNumber, verifica
    const firstWithWeek = scopes.find((s) => s.weekNumber !== null && s.weekNumber !== undefined);
    if (firstWithWeek) {
      if (!weekMatchesNumber(isoWeek, firstWithWeek.weekNumber)) {
        console.log("[RECURRING_ORDERS] Semana não corresponde a alternância — pulando", {
          companyId, dayOfWeek, weekNumber: firstWithWeek.weekNumber, isoWeek,
        });
        skipped++;
        continue;
      }
    }

    // Data de entrega para este dia
    const deliveryDate = dateForDay(monday, dayOfWeek);
    if (!deliveryDate) {
      console.warn("[RECURRING_ORDERS] Dia inválido ignorado", { companyId, dayOfWeek });
      skipped++;
      continue;
    }

    try {
      // Calcula total e monta itens
      const totalValue = scopes.reduce((sum, s) => {
        const price = parseFloat(s.unitPrice ?? "0");
        const qty = s.quantity ?? 1;
        return sum + price * qty;
      }, 0);

      const items = scopes.map((s) => ({
        productId: s.productId,
        quantity: s.quantity ?? 1,
        unitPrice: s.unitPrice ?? "0.00",
        totalPrice: (parseFloat(s.unitPrice ?? "0") * (s.quantity ?? 1)).toFixed(2),
      }));

      // R1: pipeline oficial — cria pedido via OrdersService.createInternal().
      // Garante: orderCode gerado pelo repo, afterCreate (audit log, auto-logistics,
      // notificações) executado para TODOS os pedidos recorrentes.
      const newOrder = await ordersService.createInternal(
        {
          companyId,
          status: "ACTIVE",
          workflowStatus: "PENDING_APPROVAL",
          isRecurring: true,
          weekReference: weekRef,
          deliveryDate,
          orderDate: now,
          totalValue: totalValue.toFixed(2),
          orderNote: `Pedido gerado automaticamente via escopo contratual — ${dayOfWeek} — ${weekRef}`,
        },
        items,
        { source: "recurring-cron" },
      );

      // Log de idempotência — inserido após criação bem-sucedida.
      // Nota: não atômico com o insert do pedido por design — a separação é
      // intencional para usar o pipeline oficial. A falha do log de idempotência
      // é capturada no catch abaixo e registrada em `errors`; o pedido já criado
      // permanece válido.
      await db.insert(recurringOrderLogs).values({
        companyId,
        weekKey,
        dayOfWeek,
        orderId: newOrder.id,
        scopeCount: scopes.length,
        totalValue: totalValue.toFixed(2),
      });

      created++;
      console.log("[RECURRING_ORDERS] Pedido criado", {
        companyId, dayOfWeek, weekKey, orderId: newOrder.id,
        orderCode: newOrder.orderCode,
      });
    } catch (err: any) {
      errors++;
      console.error("[RECURRING_ORDERS] Erro ao criar pedido", {
        companyId, dayOfWeek, weekKey, error: err?.message,
      });
    }
  }

  console.log("[RECURRING_ORDERS] Concluído", { runId, created, skipped, errors, weekKey });
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
