// FUTURE: substituir resolveDraftItems dentro do buildNFeInput por este service
/**
 * FASE 2 — Billing Service (camada paralela, NÃO INTEGRADA AINDA).
 *
 * Hoje, `server/modules/nfe/nfe-input.builder.ts` mistura duas
 * responsabilidades distintas:
 *
 *   1. REGRA DE NEGÓCIO (faturamento): decidir DE ONDE vêm os itens da NF
 *      — `order_items` legado, draft explícito ou draft mais recente da
 *      empresa quando `useFiscalDraft = true` — e se o agrupamento deve
 *      ser aplicado (`useGroupedItems` → "Frutas in natura").
 *
 *   2. MONTAGEM DE NF (técnico): construir o JSON `NFeInput` (emitente,
 *      destinatário, IBGE, CRT, produtos, etc.) que vai para o gerador
 *      de XML.
 *
 * Este arquivo isola a parte (1) — a regra de negócio — em um service
 * próprio, com a MESMA lógica que `resolveDraftItems` e
 * `applyItemGrouping` já implementam dentro do builder. Não otimiza,
 * não muda contratos, não substitui nada hoje.
 *
 * Quando a equipe decidir migrar, basta trocar dentro do
 * `buildNFeInput`:
 *
 *     const resolved = await resolveDraftItems({ orderId, draftId, company });
 *     // ... grouping inline ...
 *
 * por:
 *
 *     const { items: sourceItems, useGroupedItems } =
 *       await resolveBillingItems(orderId, draftId);
 *
 * mantendo todo o resto do builder intacto.
 */

import { and, desc, eq } from "drizzle-orm";
import { db } from "../../database/db";
import { nfDrafts } from "@shared/schema";
import { storage } from "../../services/storage";

// ── Tipos públicos ──────────────────────────────────────────────────────────

/**
 * Estrutura padronizada devolvida ao caller. `items` já vêm prontos para
 * uso (com agrupamento aplicado quando o draft assim definir). A flag
 * `useGroupedItems` é informativa — útil para logs/telemetria.
 */
export interface ResolvedBillingItems {
  items: any[];
  useGroupedItems: boolean;
}

// ── Helpers internos (cópias fiéis do builder) ──────────────────────────────

/**
 * Cópia idêntica de `resolveDraftItems` (server/modules/nfe/nfe-input.builder.ts:83).
 * Mesma assinatura, mesmas mensagens de erro, mesmo comportamento de fallback.
 *
 * Prioridade:
 *   1. `draftId` explícito → lê esse draft (PRIORIDADE TOTAL).
 *   2. `company.useFiscalDraft = true` → busca o draft mais recente do pedido.
 *   3. Caso nenhum draft seja resolvido → retorna `null`.
 */
async function resolveDraftItemsInternal(args: {
  orderId: number;
  draftId?: number;
  company: any;
}): Promise<{ items: any[]; useGroupedItems: boolean } | null> {
  const { orderId, draftId, company } = args;

  if (draftId) {
    if (!Number.isInteger(draftId) || draftId <= 0) {
      throw new Error(`draftId inválido: ${draftId}`);
    }
    const [row] = await db
      .select()
      .from(nfDrafts)
      .where(eq(nfDrafts.id, draftId));
    if (!row) throw new Error(`Rascunho de NF #${draftId} não encontrado`);
    if (row.orderId !== orderId) {
      throw new Error(
        `Rascunho #${draftId} não pertence ao pedido #${orderId}`,
      );
    }
    return {
      items: Array.isArray(row.items) ? (row.items as any[]) : [],
      useGroupedItems: row.useGroupedItems === true,
    };
  }

  if (company?.useFiscalDraft === true) {
    try {
      const [latest] = await db
        .select()
        .from(nfDrafts)
        .where(eq(nfDrafts.orderId, orderId))
        .orderBy(desc(nfDrafts.createdAt))
        .limit(1);
      if (latest && Array.isArray(latest.items)) {
        return {
          items: latest.items as any[],
          useGroupedItems: latest.useGroupedItems === true,
        };
      }
    } catch {
      // sem draft: cai no fluxo legado
    }
  }

  return null;
}

/**
 * Cópia idêntica de `applyItemGrouping` (server/modules/nfe/nfe-input.builder.ts:138).
 * Quando `useGroupedItems = true`, todos os produtos viram 1 única linha
 * "Frutas in natura" com qCom=1 e vUnCom=vProd=soma.
 */
function applyItemGroupingInternal(
  items: any[],
  fallbackNcm: string,
  fallbackCfop: string,
  fallbackUnit: string,
): any[] {
  if (!items.length) return items;
  const total = items.reduce((acc, it) => {
    const v =
      it.totalPrice != null
        ? Number(it.totalPrice)
        : Number(it.quantity || 0) * Number(it.unitPrice || 0);
    return acc + (Number.isFinite(v) ? v : 0);
  }, 0);
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const vTotal = round2(total);
  const first = items[0] || {};
  return [
    {
      productId: null,
      description: "Frutas in natura",
      quantity: 1,
      unit: first.unit || fallbackUnit,
      unitPrice: vTotal,
      totalPrice: vTotal,
      ncm: first.ncm || fallbackNcm,
      cfop: first.cfop || fallbackCfop,
    },
  ];
}

// ── API pública ─────────────────────────────────────────────────────────────

/**
 * Decide a origem dos itens de faturamento de um pedido e devolve a lista
 * pronta para uso pelo builder de NF.
 *
 * Regras (idênticas ao caminho atual dentro de `buildNFeInput`):
 *   1. `draftId` explícito          → usa `nf_drafts.id = draftId` (lança se
 *                                     não pertencer ao pedido).
 *   2. `company.useFiscalDraft=true`→ usa o draft mais recente do pedido
 *                                     (`order by createdAt desc limit 1`).
 *   3. Sem draft resolvido          → cai em `order_items` (legado).
 *
 * Quando o draft escolhido marca `useGroupedItems = true`, os itens são
 * consolidados numa única linha "Frutas in natura" usando os MESMOS
 * defaults que o builder atual usa: NCM `08039000`, CFOP do
 * `company.defaultCfop || config.defaultCfop || "5102"`, unidade `KG`.
 *
 * Retorna sempre `{ items, useGroupedItems }`. No caminho legado
 * (sem draft), `useGroupedItems` é `false`.
 */
export async function resolveBillingItems(
  orderId: number,
  draftId?: number,
): Promise<ResolvedBillingItems> {
  if (!orderId || isNaN(orderId) || orderId <= 0) {
    throw new Error(`orderId inválido: ${orderId}`);
  }

  // Mesma sequência de lookups que `buildNFeInput` faz hoje, na mesma ordem,
  // para garantir comportamento idêntico (inclusive nas mensagens de erro).
  const orderData = await storage.getOrder(orderId);
  if (!orderData) throw new Error(`Pedido #${orderId} não encontrado`);

  const config = await storage.getCompanyConfig();
  if (!config) throw new Error("Configurações fiscais não encontradas");

  const company = await storage.getCompany(
    (orderData.order as any).companyId,
  );
  if (!company) throw new Error("Cliente não encontrado");

  // Mesma resolução de defaultCfop que o builder usa (linha 230–231).
  const defaultCfop =
    (company as any).defaultCfop || (config as any).defaultCfop || "5102";

  const resolved = await resolveDraftItemsInternal({
    orderId,
    draftId,
    company,
  });

  // Caminho legado: sem draft → usa order_items diretamente, sem agrupamento.
  if (resolved === null) {
    return {
      items: (orderData as any).items as any[],
      useGroupedItems: false,
    };
  }

  // Caminho draft: aplica agrupamento se a flag estiver ligada (mesma
  // condição e mesmos fallbacks do builder atual).
  const items = resolved.useGroupedItems
    ? applyItemGroupingInternal(resolved.items, "08039000", defaultCfop, "KG")
    : resolved.items;

  return {
    items,
    useGroupedItems: resolved.useGroupedItems,
  };
}
