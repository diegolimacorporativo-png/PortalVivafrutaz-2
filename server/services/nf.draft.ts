/**
 * STEP FISCAL 1 — NF Draft Engine.
 *
 * Camada fiscal isolada que NÃO toca em:
 *   - orders / order_items
 *   - finance (accounts_receivable / accounts_payable / financial_transactions)
 *   - nfe_emissoes / nf_manual / fiscal_invoices
 *   - emitAlert / emitAlertSmart / persistAlertLog
 *   - nenhum endpoint existente
 *
 * Persistência: tabela nova `nf_drafts` (shared/schema.ts).
 *
 * Funções:
 *   - createDraftFromOrder(orderId, opts)  → cria rascunho a partir de pedido
 *   - getDraft(id)                          → leitura por id
 *   - listDraftsByOrder(orderId)            → lista rascunhos de um pedido
 *   - updateDraft(id, payload)              → edição total (items/totals/status)
 *
 * Observações:
 *   - Para STANDARD: copia os items do pedido aplicando defaults fiscais
 *     (NCM, CFOP, unidade) — defaults são derivados de companyConfig/company
 *     quando disponíveis, sem reusar nenhuma função do orders.service.
 *   - Para CONTRACT: cria com items=[] (a UI/PUT preenche os itens contratuais).
 *   - Totais são uma fotografia do JSON de items: totalProducts = Σ totalPrice.
 *     totalDiscount/totalFreight são 0 por padrão; totalNF = totalProducts -
 *     totalDiscount + totalFreight. NÃO existe nenhuma "centralização" do
 *     cálculo de pedido — esse cálculo serve EXCLUSIVAMENTE ao draft.
 *   - Multi-tenant: usa withTenant/tenantWhere (mesmo padrão do finance).
 */

import { and, desc, eq } from "drizzle-orm";
import { db } from "../database/db";
import {
  nfDrafts,
  type NfDraft,
  type InsertNfDraft,
} from "@shared/schema";
import { storage } from "./storage";
import {
  tenantWhere,
  withTenant,
  stripTenantFields,
} from "../core/tenant/scope";
import { NotFoundError, BadRequestError } from "../shared/errors/AppError";
// FASE 9B — fiscal hardening
import { assertNonEmptyArray } from "../core/security/fiscalGuard";
import { logSecurity } from "../core/security/securityLogger";

// ── Public types ──────────────────────────────────────────────────────────────

// STEP FISCAL 2 — enum estendido. "CONTRACT" (legado da FASE 1) é aceito como
// alias de leitura/escrita e mapeado para "CONTRACT_OPEN" via normalizeBillingType.
export type BillingType =
  | "STANDARD"
  | "CONTRACT_OPEN"
  | "CONTRACT_AVERAGE";
export type LegacyBillingType = BillingType | "CONTRACT";
export type DraftStatus = "draft" | "finalized";

const VALID_BILLING_TYPES: ReadonlySet<string> = new Set([
  "STANDARD",
  "CONTRACT_OPEN",
  "CONTRACT_AVERAGE",
  "CONTRACT", // legado — convertido para CONTRACT_OPEN
]);

/**
 * STEP FISCAL 2 — Normaliza qualquer valor recebido (incluindo o legado
 * "CONTRACT" da FASE 1) para o enum atual. Retorna `null` quando o valor
 * for inválido. Não lança — quem chama decide a política de erro.
 */
export function normalizeBillingType(raw: unknown): BillingType | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toUpperCase();
  if (!VALID_BILLING_TYPES.has(v)) return null;
  if (v === "CONTRACT") return "CONTRACT_OPEN";
  return v as BillingType;
}

export interface DraftItem {
  productId?: number | null;
  description: string;
  quantity: number;       // decimal permitido
  unit: string;           // "kg" | "un" | etc.
  unitPrice: number;
  totalPrice: number;
  ncm?: string | null;
  cfop?: string | null;
}

export interface DraftTotals {
  totalProducts: number;
  totalDiscount: number;
  totalFreight: number;
  totalNF: number;
}

export interface CreateDraftOpts {
  orderId: number;
  billingType?: LegacyBillingType;
  useGroupedItems?: boolean;
}

export interface UpdateDraftPayload {
  items?: DraftItem[];
  totals?: Partial<DraftTotals>;
  status?: DraftStatus;
  billingType?: LegacyBillingType;
  useGroupedItems?: boolean;
}

// ── Helpers (puros) ──────────────────────────────────────────────────────────

const round2 = (n: number): number => Math.round(n * 100) / 100;

function computeTotals(items: DraftItem[], overrides?: Partial<DraftTotals>): DraftTotals {
  const totalProducts = round2(
    (items || []).reduce((sum, it) => {
      const v = Number(it.totalPrice);
      return sum + (Number.isFinite(v) ? v : 0);
    }, 0),
  );
  const totalDiscount = round2(Number(overrides?.totalDiscount ?? 0) || 0);
  const totalFreight  = round2(Number(overrides?.totalFreight ?? 0) || 0);
  const totalNF       = round2(totalProducts - totalDiscount + totalFreight);
  return { totalProducts, totalDiscount, totalFreight, totalNF };
}

// ── Service functions ────────────────────────────────────────────────────────

/**
 * Cria um rascunho a partir de um pedido.
 *
 * STANDARD: copia order_items aplicando defaults fiscais derivados do
 * companyConfig/company (ncm 08039000, cfop default da empresa, uCom KG).
 *
 * CONTRACT: cria com items=[] — a UI deve preencher via updateDraft.
 *
 * NÃO altera o pedido nem o estado fiscal dele.
 */
export async function createDraftFromOrder(opts: CreateDraftOpts): Promise<NfDraft> {
  const { orderId } = opts;
  const billingType: BillingType =
    normalizeBillingType(opts.billingType) || "STANDARD";

  if (!orderId || !Number.isInteger(orderId) || orderId <= 0) {
    throw new BadRequestError(`orderId inválido: ${orderId}`);
  }
  if (opts.billingType && !normalizeBillingType(opts.billingType)) {
    throw new BadRequestError(`billingType inválido: ${opts.billingType}`);
  }

  const orderData = await storage.getOrder(orderId);
  if (!orderData) throw new NotFoundError(`Pedido #${orderId} não encontrado`);

  const orderRow: any = (orderData as any).order;
  const orderItems: any[] = ((orderData as any).items as any[]) || [];
  const companyId: number = orderRow.companyId;

  // Defaults fiscais — derivados de companyConfig/company já existentes.
  // Mesmos valores que `buildNFeInput` usa, sem reaproveitar a função
  // (mantém isolamento; se buildNFeInput evoluir, este draft não quebra).
  let defaultCfop = "5102";
  try {
    const cfg: any = await storage.getCompanyConfig();
    if (cfg?.defaultCfop) defaultCfop = String(cfg.defaultCfop);
    const customer: any = await storage.getCompany(companyId);
    if (customer?.defaultCfop) defaultCfop = String(customer.defaultCfop);
  } catch {
    // defensivo: se o lookup falhar, mantém fallback "5102"
  }

  // STEP FISCAL 2 — delegação por estratégia. O builder é a fonte única
  // de itens; este service apenas persiste/edita. Para CONTRACT_AVERAGE,
  // o builder consulta contractScopes e tira snapshot de averageCost.
  const { buildDraftItemsByStrategy } = await import("./nf.draft.builder");
  const items: DraftItem[] = await buildDraftItemsByStrategy({
    billingType,
    orderRow,
    orderItems,
    companyId,
    defaults: { ncm: "08039000", cfop: defaultCfop, unit: "KG" },
  });

  // FASE 9B — bloqueia NF-e sem itens para STANDARD (CONTRACT_OPEN começa vazio por design)
  if (billingType === "STANDARD") {
    const itemsCheck = assertNonEmptyArray<DraftItem>(items, "items", { orderId });
    if (!itemsCheck.valid) {
      logSecurity(`[SECURITY] NFE_EMPTY_ITEMS | orderId=${orderId}`);
      throw new Error("NF-e sem itens");
    }
  }

  const totals = computeTotals(items);

  const payload: InsertNfDraft = {
    orderId,
    companyId,
    billingType,
    status: "draft",
    useGroupedItems: opts.useGroupedItems === true,
    items: items as unknown as InsertNfDraft["items"],
    totals: totals as unknown as InsertNfDraft["totals"],
  };

  const [row] = await db
    .insert(nfDrafts)
    .values(withTenant(payload))
    .returning();

  if (!row) throw new NotFoundError("Falha ao criar rascunho de NF.");
  return row;
}

/** Leitura por id, isolada por tenant. */
export async function getDraft(id: number): Promise<NfDraft> {
  if (!id || !Number.isInteger(id) || id <= 0) {
    throw new BadRequestError(`id inválido: ${id}`);
  }
  const [row] = await db
    .select()
    .from(nfDrafts)
    .where(and(eq(nfDrafts.id, id), tenantWhere(nfDrafts)));
  if (!row) throw new NotFoundError(`Rascunho de NF #${id} não encontrado.`);
  return row;
}

/** Lista todos os rascunhos de um pedido (mais recentes primeiro). */
export async function listDraftsByOrder(orderId: number): Promise<NfDraft[]> {
  if (!orderId || !Number.isInteger(orderId) || orderId <= 0) {
    throw new BadRequestError(`orderId inválido: ${orderId}`);
  }
  return db
    .select()
    .from(nfDrafts)
    .where(and(eq(nfDrafts.orderId, orderId), tenantWhere(nfDrafts)))
    .orderBy(desc(nfDrafts.createdAt));
}

/**
 * Edição total: aceita atualização parcial de items, totals, status,
 * billingType. Quando `items` vier no payload, totals são RECOMPUTADOS
 * automaticamente (preservando overrides explícitos de discount/freight
 * caso enviados juntos).
 *
 * Tenant-safe: stripTenantFields garante que um payload malicioso não
 * remapeia o tenant.
 */
export async function updateDraft(
  id: number,
  payload: UpdateDraftPayload,
): Promise<NfDraft> {
  if (!id || !Number.isInteger(id) || id <= 0) {
    throw new BadRequestError(`id inválido: ${id}`);
  }
  if (!payload || typeof payload !== "object") {
    throw new BadRequestError("Payload inválido.");
  }

  // Carrega o draft atual (também valida tenant via getDraft).
  const current = await getDraft(id);

  const nextItems: DraftItem[] | undefined = Array.isArray(payload.items)
    ? (payload.items as DraftItem[])
    : undefined;

  const itemsForTotals: DraftItem[] =
    nextItems ?? ((current.items as unknown as DraftItem[]) || []);

  const overridesFromPayload: Partial<DraftTotals> = payload.totals || {};
  const overridesFromCurrent: Partial<DraftTotals> = (current.totals as any) || {};
  const totalsOverrides: Partial<DraftTotals> = {
    totalDiscount:
      overridesFromPayload.totalDiscount ?? overridesFromCurrent.totalDiscount ?? 0,
    totalFreight:
      overridesFromPayload.totalFreight ?? overridesFromCurrent.totalFreight ?? 0,
  };

  const recomputedTotals = computeTotals(itemsForTotals, totalsOverrides);

  const patch: Record<string, unknown> = {
    updatedAt: new Date(),
    totals: recomputedTotals as unknown as InsertNfDraft["totals"],
  };
  if (nextItems !== undefined) {
    patch.items = nextItems as unknown as InsertNfDraft["items"];
  }
  if (payload.status) {
    if (payload.status !== "draft" && payload.status !== "finalized") {
      throw new BadRequestError(`status inválido: ${payload.status}`);
    }
    patch.status = payload.status;
  }
  if (payload.billingType !== undefined) {
    const normalized = normalizeBillingType(payload.billingType);
    if (!normalized) {
      throw new BadRequestError(`billingType inválido: ${payload.billingType}`);
    }
    patch.billingType = normalized;
  }
  if (payload.useGroupedItems !== undefined) {
    patch.useGroupedItems = payload.useGroupedItems === true;
  }

  const safe = stripTenantFields(patch);

  const [row] = await db
    .update(nfDrafts)
    .set(safe)
    .where(and(eq(nfDrafts.id, id), tenantWhere(nfDrafts)))
    .returning();
  if (!row) throw new NotFoundError(`Rascunho de NF #${id} não encontrado.`);
  return row;
}
