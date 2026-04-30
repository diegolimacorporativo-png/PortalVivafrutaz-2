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
// FASE 8.1 — fonte única para o default de agrupamento da empresa.
// O resolver não toca banco; recebe o `company` já carregado e devolve
// `{ billingModel, useGroupedItemsDefault }`. Aqui é usado APENAS como
// FALLBACK do draft (draft mantém prioridade absoluta).
import { resolveCompanyBillingConfig } from "./billing.resolver";

// ── Constantes fiscais ──────────────────────────────────────────────────────

/**
 * FASE 8.3 — Defaults fiscais do agrupamento "Frutas in natura".
 *
 * Centraliza APENAS os literais que são duplicados nos dois IIFEs de
 * agrupamento (caminho legado e caminho draft). NÃO inclui CFOP — esse
 * permanece resolvido por `defaultCfop` no escopo (company > config >
 * "5102"), pois CFOP depende de UF no builder e tem cadeia de fallback
 * própria. NCM e unidade são fixos para o agrupamento "Frutas in natura"
 * por design (item consolidado único, não vai para o builder via map).
 *
 * ⚠️ Esta constante é EXCLUSIVA do agrupamento dentro deste service.
 * Não usar no builder — lá NCM é fail-fast (FASE NF.4.2 ETAPA 3) e
 * unidade vem do item via `safeStr(item.unit, "KG")`.
 */
const FRUTAS_IN_NATURA_DEFAULTS = {
  ncm: "08039000",
  unit: "KG",
} as const;

// ── Tipos públicos ──────────────────────────────────────────────────────────

import type { BillingItemFiscal } from "./types";
export type { BillingItemFiscal } from "./types";

/**
 * Estrutura padronizada devolvida ao caller. `items` já vêm prontos para
 * uso (com agrupamento aplicado quando o draft assim definir). A flag
 * `useGroupedItems` é informativa — útil para logs/telemetria.
 *
 * FASE 8.5 — `items` agora é `BillingItemFiscal[]` (era `any[]`).
 * Apenas reforço de contrato; corpo da função NÃO foi alterado.
 */
export interface ResolvedBillingItems {
  items: BillingItemFiscal[];
  useGroupedItems: boolean;
}

/**
 * FASE 8.5 — Alias público pedido pela ETAPA 2 da fase. É exatamente
 * `ResolvedBillingItems`; existe para que novos consumidores possam
 * referenciar o nome solicitado sem quebrar imports legados.
 */
export type ResolveBillingResult = ResolvedBillingItems;

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

  // FASE 8.1 — config de faturamento da empresa, lida ANTES de qualquer
  // decisão de origem/agrupamento. Não substitui o draft: serve apenas
  // como FALLBACK quando o draft for ausente. Para empresas STANDARD
  // (incluindo billingModel undefined/null), `useGroupedItemsDefault`
  // resolve para `false` — exatamente o comportamento legado.
  const billingConfig = resolveCompanyBillingConfig(company);

  // Mesma resolução de defaultCfop que o builder usa (linha 230–231).
  const defaultCfop =
    (company as any).defaultCfop || (config as any).defaultCfop || "5102";

  const resolved = await (async (): Promise<{ items: any[]; useGroupedItems: boolean } | null> => {
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
  })();

  // FASE 8.1 — decisão única de agrupamento.
  //   • Draft presente com `useGroupedItems` (true OU false) → DRAFT MANDA.
  //     `??` só faz fallback em null/undefined, então `false` do draft é
  //     respeitado integralmente.
  //   • Sem draft (`resolved === null`) → cai no default da empresa
  //     (`useGroupedItemsDefault`). Para STANDARD/CONTRACT_OPEN isso é
  //     `false` → comportamento idêntico ao legado. Para CONTRACT_AVERAGE
  //     passa a ser `true` automaticamente — expansão controlada de Fase 8.1.
  const shouldGroup =
    resolved?.useGroupedItems ?? billingConfig.useGroupedItemsDefault;

  // Caminho legado: sem draft → usa order_items diretamente. Aplica
  // agrupamento somente se o default da empresa pedir (CONTRACT_AVERAGE).
  if (resolved === null) {
    const sourceItems = (orderData as any).items as any[];
    const items = shouldGroup
      ? ((items: any[], fallbackNcm: string, fallbackCfop: string, fallbackUnit: string): any[] => {
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
              cst: (first as any).cst || '00',
              // FASE NF.7.8 — preserva flag de importado através do agrupamento.
              // Critério: se QUALQUER item agrupado for importado, o item consolidado
              // herda true (lado seguro fiscalmente — evita esconder importação).
              // Comparação === true evita falso positivo de strings/numbers truthy.
              importado: items.some((it: any) => it?.importado === true),
            },
          ];
        })(sourceItems, FRUTAS_IN_NATURA_DEFAULTS.ncm, defaultCfop, FRUTAS_IN_NATURA_DEFAULTS.unit)
      : sourceItems;
    return {
      items,
      useGroupedItems: shouldGroup,
    };
  }

  // Caminho draft: aplica agrupamento conforme decisão acima (mesmos
  // fallbacks do builder atual: NCM 08039000, CFOP defaultCfop, KG).
  const items = shouldGroup
    ? ((items: any[], fallbackNcm: string, fallbackCfop: string, fallbackUnit: string): any[] => {
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
            cst: (first as any).cst || '00',
            // FASE NF.7.8 — preserva flag de importado através do agrupamento.
            // Critério: se QUALQUER item agrupado for importado, o item consolidado
            // herda true (lado seguro fiscalmente — evita esconder importação).
            // Comparação === true evita falso positivo de strings/numbers truthy.
            importado: items.some((it: any) => it?.importado === true),
          },
        ];
      })(resolved.items, FRUTAS_IN_NATURA_DEFAULTS.ncm, defaultCfop, FRUTAS_IN_NATURA_DEFAULTS.unit)
    : resolved.items;

  return {
    items,
    useGroupedItems: shouldGroup,
  };
}
