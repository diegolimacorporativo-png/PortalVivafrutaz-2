/**
 * FASE — TRANSAÇÃO ATÔMICA NF-e
 *
 * Garante que os writes internos pós-emissão NF-e sejam
 * atomicamente consistentes: zero partial write, rollback total
 * em qualquer falha.
 *
 * REGRA CRÍTICA:
 *   - getNextNfeNumero() usa nextval() — sequences NÃO fazem rollback.
 *     Gaps de numeração são normais e esperados em sistemas fiscais.
 *     Nunca colocar getNextNfeNumero() dentro de uma transação esperando
 *     que o número seja "devolvido" em caso de rollback.
 *   - gerarNFeXML() é pura (sem I/O) — fica fora da transação.
 *   - Chamada SEFAZ NUNCA pode ficar dentro de uma transação aberta.
 *
 * Dois padrões:
 *
 *   1. commitNfeCreation() — para paths SEM chamada SEFAZ intermediária:
 *      mock, /reenviar, /corrigir-reenviar, faturamento.cron.
 *      Agrupa: INSERT nfe_emissoes + UPDATE orders + INSERT system_logs.
 *
 *   2. commitNfeSefazResult() — para path COM chamada SEFAZ (/emitir real):
 *      createNfeEmissao() já feito antes do SEFAZ (precisa do nfe.id).
 *      Agrupa pós-SEFAZ: UPDATE nfe_emissoes + UPDATE orders + INSERT system_logs.
 */

import { db } from "../../database/db";
import { nfeEmissoes, orders, systemLogs } from "@shared/schema";
import { eq } from "drizzle-orm";
import { invalidateUsageCache } from "../../modules/billing/usage-cache";
import type { InsertNfeEmissao, NfeEmissao } from "@shared/schema";

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface NfePersistLog {
  action: string;
  description: string;
  userId?: number | null;
  level?: string;
}

export interface CommitNfeCreationParams {
  nfeData: InsertNfeEmissao;
  orderId: number;
  fiscalStatus: string;
  log: NfePersistLog;
}

export interface CommitNfeSefazResultParams {
  nfeId: number;
  nfeUpdates: Partial<InsertNfeEmissao>;
  orderId: number;
  /** null = não atualiza orders (path rejeitada/erro) */
  fiscalStatus: string | null;
  log: NfePersistLog;
}

export interface CommitNfeMockResultParams {
  nfeId: number;
  orderId: number;
  fiscalStatus: string;
  log: NfePersistLog;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function processOrderUpdates(updates: Record<string, any>): Record<string, any> {
  const processed = { ...updates };
  if (typeof processed.deliveryDate === "string") {
    processed.deliveryDate = new Date(processed.deliveryDate);
  }
  return processed;
}

// ─── Pattern 1: paths SEM chamada SEFAZ intermediária ─────────────────────────
//
// Uso: /emitir (mock), /reenviar, /corrigir-reenviar, faturamento.cron
//
// Agrupa atomicamente:
//   INSERT nfe_emissoes     ← cria registro da NF-e
//   UPDATE orders           ← atualiza fiscalStatus do pedido
//   INSERT system_logs      ← trilha de auditoria
//
// Se QUALQUER um falhar → rollback total → zero estado parcial.

export async function commitNfeCreation(
  params: CommitNfeCreationParams,
): Promise<NfeEmissao> {
  const { nfeData, orderId, fiscalStatus, log } = params;

  let companyId: number | undefined;

  const nfe = await db.transaction(async (tx) => {
    // 1. INSERT nfe_emissoes
    const [inserted] = await tx
      .insert(nfeEmissoes)
      .values(nfeData)
      .returning();

    // 2. UPDATE orders.fiscal_status
    const [updated] = await tx
      .update(orders)
      .set(processOrderUpdates({ fiscalStatus }))
      .where(eq(orders.id, orderId))
      .returning();
    companyId = updated?.companyId ?? undefined;

    // 3. INSERT system_logs — dentro da tx: falha aqui = rollback total
    await tx.insert(systemLogs).values({
      action: log.action,
      description: log.description,
      userId: log.userId ?? undefined,
      level: log.level ?? "INFO",
    });

    return inserted;
  });

  // Cache invalidation FORA da tx — best-effort, não crítica
  if (companyId) {
    try {
      invalidateUsageCache(companyId);
    } catch {
      // non-critical — next read will rehydrate from DB
    }
  }

  console.log("[NFE_TX_COMMIT]", {
    pattern: "creation",
    nfeId: nfe.id,
    orderId,
    fiscalStatus,
    action: log.action,
  });

  return nfe;
}

// ─── Pattern 2: path COM chamada SEFAZ (/emitir real) ─────────────────────────
//
// createNfeEmissao() é feito ANTES do SEFAZ para gerar nfe.id usado nos logs.
// Após retorno SEFAZ, agrupa atomicamente:
//   UPDATE nfe_emissoes     ← persiste resultado SEFAZ (status, protocolo, xml)
//   UPDATE orders           ← atualiza fiscalStatus do pedido
//   INSERT system_logs      ← trilha de auditoria
//
// Se QUALQUER um falhar → rollback total → nfe_emissoes fica em status
// anterior ('assinada'), order não muda. O log [NFE_PERSIST_CRITICAL_ALERT]
// existente no caller garante rastreabilidade manual.

export async function commitNfeSefazResult(
  params: CommitNfeSefazResultParams,
): Promise<NfeEmissao> {
  const { nfeId, nfeUpdates, orderId, fiscalStatus, log } = params;

  let companyId: number | undefined;

  const nfe = await db.transaction(async (tx) => {
    // 1. UPDATE nfe_emissoes com resultado SEFAZ (autorizada OU rejeitada)
    const [updatedNfe] = await tx
      .update(nfeEmissoes)
      .set(nfeUpdates as any)
      .where(eq(nfeEmissoes.id, nfeId))
      .returning();

    // 2. UPDATE orders.fiscal_status — SOMENTE se fiscalStatus fornecido (autorizada)
    //    Para rejeitada/erro, fiscalStatus é null e orders NÃO é tocado.
    if (fiscalStatus !== null) {
      const [updatedOrder] = await tx
        .update(orders)
        .set(processOrderUpdates({ fiscalStatus }))
        .where(eq(orders.id, orderId))
        .returning();
      companyId = updatedOrder?.companyId ?? undefined;
    }

    // 3. INSERT system_logs — dentro da tx: falha aqui = rollback total
    await tx.insert(systemLogs).values({
      action: log.action,
      description: log.description,
      userId: log.userId ?? undefined,
      level: log.level ?? "INFO",
    });

    return updatedNfe;
  });

  // Cache invalidation FORA da tx — best-effort, não crítica
  if (companyId) {
    try {
      invalidateUsageCache(companyId);
    } catch {
      // non-critical
    }
  }

  console.log("[NFE_TX_COMMIT]", {
    pattern: "sefaz_result",
    nfeId,
    orderId,
    fiscalStatus,
    action: log.action,
  });

  return nfe;
}

// ─── Pattern 3: /emitir MOCK — createNfeEmissao já feito (antes do split) ─────
//
// No handler /emitir, createNfeEmissao() é chamado ANTES do split SEFAZ/mock
// para que o nfe.id fique disponível nos logs de assinatura do path SEFAZ.
// Para o path mock, createNfeEmissao já persiste antes de chegar aqui.
// Agrupamos os 2 writes restantes atomicamente:
//   UPDATE orders           ← atualiza fiscalStatus do pedido
//   INSERT system_logs      ← trilha de auditoria
//
// Mantém consistência: se createLog falhar, fiscalStatus NÃO é atualizado.

export async function commitNfeMockResult(
  params: CommitNfeMockResultParams,
): Promise<void> {
  const { nfeId, orderId, fiscalStatus, log } = params;

  let companyId: number | undefined;

  await db.transaction(async (tx) => {
    // 1. UPDATE orders.fiscal_status
    const [updatedOrder] = await tx
      .update(orders)
      .set(processOrderUpdates({ fiscalStatus }))
      .where(eq(orders.id, orderId))
      .returning();
    companyId = updatedOrder?.companyId ?? undefined;

    // 2. INSERT system_logs
    await tx.insert(systemLogs).values({
      action: log.action,
      description: log.description,
      userId: log.userId ?? undefined,
      level: log.level ?? "INFO",
    });
  });

  // Cache invalidation FORA da tx — best-effort, não crítica
  if (companyId) {
    try {
      invalidateUsageCache(companyId);
    } catch {
      // non-critical
    }
  }

  console.log("[NFE_TX_COMMIT]", {
    pattern: "mock_result",
    nfeId,
    orderId,
    fiscalStatus,
    action: log.action,
  });
}
