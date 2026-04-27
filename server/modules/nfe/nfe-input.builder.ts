/**
 * STEP 9.3C — Serviço de construção do NFeInput.
 * STEP FISCAL 2 — passou a aceitar `draftId` opcional. Quando informado,
 * os `produtos` da NF vêm de `nf_drafts.items` (prioridade total). Caso
 * contrário, mantém o comportamento legado: copia `order_items`.
 *
 * FASE NF.1 — Hardening: sanitização, normalização e validação estruturada
 * aplicadas DENTRO do builder, sem alterar assinatura nem fluxo externo.
 *
 * Regras explícitas (sem regressão):
 *   - assinatura legada `buildNFeInput(orderId)` continua válida.
 *   - assinatura nova `buildNFeInput({ orderId, draftId? })` ativa a camada
 *     fiscal. Se `draftId` vier, lê desse draft. Se não, e a empresa tiver
 *     `useFiscalDraft = true`, busca o draft mais recente do pedido. Caso
 *     nenhum draft seja resolvido, cai no comportamento legado.
 */

import { and, desc, eq } from "drizzle-orm";
import { db } from "../../database/db";
import { nfDrafts } from "@shared/schema";
import { storage } from "../../services/storage";
// FASE 4 — novo motor de faturamento (equivalência 100% validada
// em scripts/test-billing-equivalence.ts antes da troca).
import { resolveBillingItems } from "../billing/billing.service";

// ── Helper: busca código IBGE via ViaCEP ─────────────────────────────────────

const IBGE_FALLBACK: Record<string, string> = {
  "são paulo": "3550308",
  "sao paulo": "3550308",
  "rio de janeiro": "3304557",
  "belo horizonte": "3106200",
  "curitiba": "4106902",
  "porto alegre": "4314902",
  "salvador": "2927408",
  "fortaleza": "2304400",
  "manaus": "1302603",
  "recife": "2611606",
  "goiania": "5208707",
  "goiânia": "5208707",
  "belém": "1501402",
  "belem": "1501402",
};

export async function fetchIbgeCode(cep: string, cityName?: string): Promise<string> {
  const cleaned = (cep || "").replace(/\D/g, "");
  if (cleaned.length === 8) {
    try {
      const resp = await fetch(`https://viacep.com.br/ws/${cleaned}/json/`);
      if (resp.ok) {
        const data = await resp.json();
        if (data.ibge) return String(data.ibge);
      }
    } catch {}
  }
  const cityKey = (cityName || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return (
    IBGE_FALLBACK[cityKey] ||
    IBGE_FALLBACK[(cityName || "").toLowerCase()] ||
    "3550308"
  );
}

// ── FASE NF.1 — Helpers de sanitização ───────────────────────────────────────

/**
 * Normaliza campo obrigatório: trim, colapsa espaços múltiplos, aplica fallback
 * quando o valor for ausente ou vazio. Nunca retorna undefined.
 */
function safeStr(v: any, fallback = ""): string {
  const s = (v != null ? String(v) : "").trim().replace(/\s{2,}/g, " ");
  return s || fallback;
}

/**
 * ETAPA 1 — Para campos opcionais: retorna undefined quando ausente/vazio,
 * string limpa quando presente. Nunca força string vazia onde undefined é válido.
 */
function safeOptional(v: any): string | undefined {
  const s = (v != null ? String(v) : "").trim().replace(/\s{2,}/g, " ");
  return s || undefined;
}

// ── buildNFeInput ─────────────────────────────────────────────────────────────

export interface BuildNFeInputOpts {
  orderId: number;
  draftId?: number;
}

/**
 * STEP FISCAL 2 — resolve qual fonte de itens usar:
 *   1. `draftId` explícito → lê esse draft (PRIORIDADE TOTAL).
 *   2. `company.useFiscalDraft = true` → busca o draft mais recente do pedido.
 *   3. Caso nenhum draft seja resolvido → retorna `null` (comportamento legado).
 *
 * Não lança em caso de "draft não encontrado" para `draftId`: validamos antes
 * para dar mensagem clara. Para a busca automática (caso 2), tratamos a
 * ausência como "sem draft" e seguimos legado, sem falhar.
 */
interface ResolvedDraft {
  items: any[];
  useGroupedItems: boolean;
}

async function resolveDraftItems(args: {
  orderId: number;
  draftId?: number;
  company: any;
}): Promise<ResolvedDraft | null> {
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
 * STEP FISCAL 2 — agrupamento opcional de itens.
 * Quando o draft marca `useGroupedItems = true`, todos os produtos viram
 * 1 única linha "Frutas in natura" com qCom=1 e vUnCom=vProd=soma.
 * Mantém NCM/CFOP do primeiro item ou cai nos defaults da empresa/config.
 */
function applyItemGrouping(
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

export async function buildNFeInput(
  arg: number | BuildNFeInputOpts,
) {
  // Compatibilidade: aceita tanto o número (assinatura legada) quanto o objeto.
  const opts: BuildNFeInputOpts =
    typeof arg === "number" ? { orderId: arg } : arg || ({} as any);
  const { orderId, draftId } = opts;

  if (!orderId || isNaN(orderId) || orderId <= 0)
    throw new Error(`orderId inválido: ${orderId}`);

  const orderData = await storage.getOrder(orderId);
  if (!orderData) throw new Error(`Pedido #${orderId} não encontrado`);

  const config = await storage.getCompanyConfig();
  if (!config) throw new Error("Configurações fiscais não encontradas");

  const company = await storage.getCompany((orderData.order as any).companyId);
  if (!company) throw new Error("Cliente não encontrado");

  const crt =
    config.regimeTributario === "simples_nacional"
      ? "1"
      : config.regimeTributario === "mei"
        ? "2"
        : "3";

  const [emitIbge, destIbge] = await Promise.all([
    fetchIbgeCode(config.cep || "", config.city || ""),
    fetchIbgeCode(company.addressZip || "", company.addressCity || ""),
  ]);

  // ETAPA 5 — campos do emitente com safeStr (obrigatórios) e safeOptional (opcionais)
  const emitente = {
    cnpj: safeStr(config.cnpj),
    xNome: safeStr(config.companyName, "VivaFrutaz"),
    xFant: safeOptional(config.fantasyName) ?? safeStr(config.companyName, "VivaFrutaz"),
    ie: safeStr(config.stateRegistration, "0"),
    crt,
    logradouro: safeStr(config.address, "Rua não configurada"),
    numero: safeStr(config.addressNumber, "S/N"),
    bairro: safeStr(config.neighborhood, "Centro"),
    xMun: safeStr(config.city, "São Paulo"),
    cMun: safeStr(emitIbge, "3550308"),
    uf: safeStr(config.state, "SP"),
    cep: safeStr((config.cep || "00000000").replace(/\D/g, "").padEnd(8, "0"), "00000000"),
    fone: safeStr(config.phone),
  };

  // ETAPA 5 — campos do destinatário com safeStr/safeOptional
  const destinatario = {
    cnpj: safeOptional(company.cnpj?.replace(/\D/g, "") ? company.cnpj : undefined),
    xNome: safeStr(company.companyName),
    ie: safeOptional(company.stateRegistration),
    logradouro: safeStr(company.addressStreet, "Endereço não informado"),
    numero: safeStr(company.addressNumber, "S/N"),
    bairro: safeStr(company.addressNeighborhood, "Centro"),
    xMun: safeStr(company.addressCity, "São Paulo"),
    cMun: safeStr((company as any).addressIbge || destIbge, "3550308"),
    uf: safeStr(company.addressState, "SP"),
    cep: safeStr((company.addressZip || "00000000").replace(/\D/g, "").padEnd(8, "0"), "00000000"),
  };

  const defaultCfop =
    (company as any).defaultCfop || config.defaultCfop || "5102";

  // FASE 4: usando billing.service (equivalência já validada)
  // lógica antiga mantida para rollback futuro
  const { items: sourceItems } = await resolveBillingItems(orderId, draftId);

  // ETAPA 2 — normalização sem mutação: recalcula vProd a partir de qCom × vUnCom
  const rawProdutos = sourceItems.map((item: any, idx: number) => ({
    cProd: String(item.productId || idx + 1).padStart(6, "0"),
    xProd: safeStr(
      item.description || item.name || item.productName,
      "Produto",
    ),
    ncm: safeStr(item.ncm, "08039000"),
    cfop: safeStr(item.cfop, defaultCfop),
    uCom: safeStr(item.unit, "KG"),
    qCom: Number(item.quantity ?? 1),
    vUnCom: Number(item.unitPrice ?? item.finalPrice ?? 0),
    vProd: Number(item.totalPrice ?? 0),
  }));

  // ETAPA 2 — normalização: garante qCom/vUnCom numéricos e recalcula vProd
  // PATCH NF.1 — vProd só é calculado quando ambos os operandos são finitos,
  // evitando NaN silencioso no XML.
  const normalizedProdutos = rawProdutos.map((item) => {
    const qCom = Number(item.qCom);
    const vUnCom = Number(item.vUnCom);
    const vProd =
      Number.isFinite(qCom) && Number.isFinite(vUnCom)
        ? Number((qCom * vUnCom).toFixed(2))
        : 0;
    return {
      ...item,
      qCom,
      vUnCom,
      vProd,
    };
  });

  // ETAPA 3 — validação estruturada
  // PATCH NF.1 — valida valores originais (antes do safeStr) para evitar
  // que fallbacks mascarem ausência de dado crítico.
  const criticalErrors: string[] = [];
  const itemErrors: string[] = [];

  if (!config.cnpj?.trim()) criticalErrors.push("MISSING_EMITENTE_CNPJ");
  if (!company.companyName?.trim()) criticalErrors.push("MISSING_DESTINATARIO");
  if (!normalizedProdutos.length) criticalErrors.push("NO_ITEMS");

  // PATCH NF.1 — usa Number.isFinite para detectar NaN explicitamente
  for (const item of normalizedProdutos) {
    if (!Number.isFinite(item.qCom) || item.qCom <= 0) itemErrors.push("INVALID_QCOM");
    if (!Number.isFinite(item.vUnCom) || item.vUnCom <= 0) itemErrors.push("INVALID_VUNCOM");
  }

  // ETAPA 4 — fail controlado: lança erro único com log detalhado
  if (criticalErrors.length || itemErrors.length) {
    console.error("[NFE_BUILD_INVALID]", {
      orderId,
      criticalErrors,
      itemErrors,
    });
    throw new Error("NFE_BUILD_VALIDATION_FAILED");
  }

  // ETAPA 6 — log estruturado compatível com HTTP e cron (sem global)
  console.log("[NFE_BUILD_INPUT]", {
    orderId,
    totalItens: normalizedProdutos.length,
    valorTotal: Number(
      normalizedProdutos.reduce((t, p) => t + p.vProd, 0).toFixed(2),
    ),
  });

  // ETAPA 7 — retorno consistente: usa normalizedProdutos, sem campos undefined desnecessários
  return {
    emitente,
    destinatario,
    produtos: normalizedProdutos,
    natOp: safeStr(config.defaultNatureza, "Venda de mercadoria adquirida"),
    tpAmb: (config.ambienteFiscal === "producao" ? "1" : "2") as "1" | "2",
    orderId,
    orderCode: safeOptional((orderData.order as any).orderCode),
    informacoesAdicionais: config.informacoesAdicionais
      ? `${safeStr(config.informacoesAdicionais)}\nPedido: ${safeStr((orderData.order as any).orderCode, `#${orderId}`)}`
      : `Pedido: ${safeStr((orderData.order as any).orderCode, `#${orderId}`)}`,
  };
}
