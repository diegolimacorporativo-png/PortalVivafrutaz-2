/**
 * STEP FISCAL 2 — NF Draft Builder por estratégia.
 *
 * Camada PURA de construção dos `items` que serão persistidos em `nf_drafts`.
 * Não toca em `orders`, `accounts_receivable`, `nfe_emissoes`, `nf_manual` nem
 * em qualquer endpoint existente. Cada estratégia é independente:
 *
 *   - STANDARD         → copia order_items (comportamento da FASE 1)
 *   - CONTRACT_OPEN    → inicia vazio (UI/PUT preenche manualmente)
 *   - CONTRACT_AVERAGE → snapshot de contractScopes usando averageCost
 *
 * O service `nf.draft.ts` delega para `buildDraftItemsByStrategy`. Os builders
 * individuais também ficam exportados para uso direto e testes.
 */

import { and, eq } from "drizzle-orm";
import { db } from "../database/db";
import { contractScopes } from "@shared/schema";
import { storage } from "./storage";
import { tenantWhere } from "../core/tenant/scope";
import type { BillingType, DraftItem } from "./nf.draft";
// FASE 9B — fiscal hardening
import { assertValidNumber } from "../core/security/fiscalGuard";
import { logSecurity } from "../core/security/securityLogger";

const round2 = (n: number): number => Math.round(n * 100) / 100;

export interface FiscalDefaults {
  ncm: string;
  cfop: string;
  unit: string;
}

// ── STANDARD ─────────────────────────────────────────────────────────────────

/**
 * Copia `order_items` aplicando defaults fiscais. Mesma semântica da FASE 1
 * — extraída para cá apenas para deixar a estratégia explícita.
 */
export async function buildStandardDraft(
  orderItems: any[],
  defaults: FiscalDefaults,
): Promise<DraftItem[]> {
  let productMap = new Map<number, any>();
  try {
    const allProducts: any[] = (await storage.getProducts()) || [];
    productMap = new Map(allProducts.map((p) => [p.id, p]));
  } catch {
    productMap = new Map();
  }

  return (orderItems || []).map((item) => {
    const product = item.productId != null ? productMap.get(item.productId) : null;
    const description =
      item.productName ||
      product?.name ||
      `Produto #${item.productId ?? ""}`.trim() ||
      "Produto";

    // FASE 9B — bloqueia quantidade inválida antes de gerar NF-e zerada
    const quantityCheck = assertValidNumber(item.quantity, 'quantity', {
      productId: item.productId,
      description: item.productName,
    });
    if (!quantityCheck.valid) {
      logSecurity(`[SECURITY] NFE_INVALID_QUANTITY | ${JSON.stringify(quantityCheck.context)}`);
      throw new Error('Quantidade inválida na NF-e');
    }
    const quantity = quantityCheck.value;

    const unitPrice = Number(item.unitPrice || 0);
    const totalPriceRaw =
      item.totalPrice != null ? Number(item.totalPrice) : quantity * unitPrice;

    return {
      productId: item.productId ?? null,
      description,
      quantity: Number.isFinite(quantity) ? quantity : 0,
      unit: product?.unit || defaults.unit,
      unitPrice: round2(Number.isFinite(unitPrice) ? unitPrice : 0),
      totalPrice: round2(Number.isFinite(totalPriceRaw) ? totalPriceRaw : 0),
      ncm: product?.ncm || defaults.ncm,
      cfop: defaults.cfop,
    } satisfies DraftItem;
  });
}

// ── CONTRACT_OPEN ────────────────────────────────────────────────────────────

/**
 * CONTRACT_OPEN começa vazio. O fluxo correto é:
 *   1. createDraftFromOrder({ billingType: "CONTRACT_OPEN" }) → items=[]
 *   2. UI/PUT updateDraft preenche items manualmente
 *
 * Mantemos a função explícita para deixar a estratégia documentada e testável.
 */
export async function buildOpenDraft(): Promise<DraftItem[]> {
  return [];
}

// ── CONTRACT_AVERAGE ─────────────────────────────────────────────────────────

/**
 * CONTRACT_AVERAGE — snapshot dos contractScopes da empresa.
 *
 * Regras:
 *   - busca todos os contractScopes do tenant para `companyId`
 *   - usa `averageCost` como `unitPrice` do draft (custo médio é a base
 *     da NF nesse modelo, conforme regra de negócio)
 *   - quando `averageCost` for nulo, faz fallback para `unitPrice` do
 *     próprio scope (preço contratual) — assim a NF nunca sai com 0
 *   - copia os valores para o draft (snapshot): NÃO mantém referência a
 *     contractScopes. Alterações posteriores no escopo NÃO afetam o draft.
 *
 * Nunca lança por falha de lookup — devolve [] e deixa a UI corrigir.
 */
export async function buildAverageDraft(
  companyId: number,
  defaults: FiscalDefaults,
): Promise<DraftItem[]> {
  if (!companyId || !Number.isInteger(companyId) || companyId <= 0) {
    return [];
  }

  let scopes: any[] = [];
  try {
    scopes = await db
      .select()
      .from(contractScopes)
      .where(
        and(eq(contractScopes.companyId, companyId), tenantWhere(contractScopes)),
      );
  } catch {
    return [];
  }

  if (!scopes.length) return [];

  let productMap = new Map<number, any>();
  try {
    const allProducts: any[] = (await storage.getProducts()) || [];
    productMap = new Map(allProducts.map((p) => [p.id, p]));
  } catch {
    productMap = new Map();
  }

  // Snapshot: para cada scope vira 1 item de draft.
  const items: DraftItem[] = scopes.map((s) => {
    const product = s.productId != null ? productMap.get(s.productId) : null;
    const description =
      product?.name || `Produto #${s.productId ?? ""}`.trim() || "Produto";

    // FASE 9B — bloqueia quantidade inválida antes de gerar NF-e zerada
    const quantityCheck = assertValidNumber(s.quantity, 'quantity', {
      productId: s.productId,
    });
    if (!quantityCheck.valid) {
      logSecurity(`[SECURITY] NFE_INVALID_QUANTITY | ${JSON.stringify(quantityCheck.context)}`);
      throw new Error('Quantidade inválida na NF-e');
    }
    const quantity = quantityCheck.value;

    // Prioridade: averageCost (custo médio contratual) → unitPrice do scope → 0.
    const avgCost =
      s.averageCost != null && s.averageCost !== "" ? Number(s.averageCost) : NaN;
    const fallbackUnit =
      s.unitPrice != null && s.unitPrice !== "" ? Number(s.unitPrice) : 0;
    const unitPrice = Number.isFinite(avgCost) ? avgCost : fallbackUnit;

    const totalPrice = round2(
      (Number.isFinite(quantity) ? quantity : 0) *
        (Number.isFinite(unitPrice) ? unitPrice : 0),
    );

    return {
      productId: s.productId ?? null,
      description,
      quantity: Number.isFinite(quantity) ? quantity : 0,
      unit: product?.unit || defaults.unit,
      unitPrice: round2(Number.isFinite(unitPrice) ? unitPrice : 0),
      totalPrice,
      ncm: product?.ncm || defaults.ncm,
      cfop: defaults.cfop,
    } satisfies DraftItem;
  });

  return items;
}

// ── Dispatcher ───────────────────────────────────────────────────────────────

export interface BuildDraftItemsArgs {
  billingType: BillingType;
  orderRow: any;
  orderItems: any[];
  companyId: number;
  defaults: FiscalDefaults;
}

/**
 * Dispatcher único usado pelo service nf.draft.ts. Garante que toda criação
 * passe pela estratégia correta sem que o service precise importar cada
 * builder individualmente.
 */
export async function buildDraftItemsByStrategy(
  args: BuildDraftItemsArgs,
): Promise<DraftItem[]> {
  switch (args.billingType) {
    case "STANDARD":
      return buildStandardDraft(args.orderItems, args.defaults);
    case "CONTRACT_OPEN":
      return buildOpenDraft();
    case "CONTRACT_AVERAGE":
      return buildAverageDraft(args.companyId, args.defaults);
    default:
      return buildStandardDraft(args.orderItems, args.defaults);
  }
}
