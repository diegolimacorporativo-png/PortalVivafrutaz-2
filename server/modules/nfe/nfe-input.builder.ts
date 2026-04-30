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

import { storage } from "../../services/storage";
// FASE 8.4 — DESACOPLAMENTO CONTROLADO.
// O builder NÃO importa mais `resolveBillingItems`. A origem dos itens
// é responsabilidade dos call-sites, que passam `sourceItems` pronto.
// Inversão de dependência: agora `billing → builder` (antes `builder → billing`).

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
  // FASE NF.4.2 — ETAPA 4: sem fallback fixo "3550308". Falhar explicitamente
  // evita que município errado contamine a NF-e (SEFAZ rejeita por divergência UF×cMun).
  const codigo =
    IBGE_FALLBACK[cityKey] || IBGE_FALLBACK[(cityName || "").toLowerCase()];
  if (!codigo) {
    throw new Error("NFE_INVALID_IBGE_CODE");
  }
  return codigo;
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

import type { BillingItemFiscal } from "../billing/types";
import type { NFeInput } from "./types";
export type { NFeInput, NFeProduto } from "./types";
// FASE 8.6A — schema Zod usado em SHADOW MODE (apenas loga, nunca lança).
import { NFeInputSchema } from "./schema";

export interface BuildNFeInputOpts {
  orderId: number;
  draftId?: number;
  /**
   * FASE 8.4 — Itens já resolvidos pelo caller (via `resolveBillingItems`
   * em `server/modules/billing/billing.service.ts`). O builder NÃO mais
   * decide a origem dos itens: ele apenas monta o NFeInput a partir do
   * que recebe. `draftId` é mantido como metadado para logs/auditoria.
   *
   * FASE 8.5 — tipado como `BillingItemFiscal[]` (era `any[]`). Apenas
   * reforço de contrato; o corpo do builder NÃO foi alterado.
   */
  sourceItems: BillingItemFiscal[];
}

/**
 * FASE 8.4 — DESACOPLAMENTO CONTROLADO.
 *
 * O builder agora recebe `sourceItems` PRONTO. A resolução de itens
 * (drafts, agrupamento "Frutas in natura", fallback `order_items`)
 * permanece como responsabilidade ÚNICA de `resolveBillingItems`,
 * mas é executada pelo CALL-SITE, não mais pelo builder.
 *
 * Direção de dependência:
 *   ANTES:  buildNFeInput → resolveBillingItems (acoplamento invertido)
 *   AGORA:  resolveBillingItems → buildNFeInput (call-site orquestra)
 *
 * Validações fiscais (NCM obrigatório, CFOP UF-aware, safeStr,
 * normalização vProd, fail-fast em emitente) permanecem INTOCADAS.
 */

export async function buildNFeInput(args: BuildNFeInputOpts): Promise<NFeInput> {
  if (!args || typeof args !== "object") {
    throw new Error("buildNFeInput: args obrigatório (objeto)");
  }
  const { orderId, sourceItems } = args;

  if (!orderId || isNaN(orderId) || orderId <= 0)
    throw new Error(`orderId inválido: ${orderId}`);

  if (!Array.isArray(sourceItems)) {
    throw new Error("buildNFeInput: sourceItems obrigatório (array)");
  }

  const orderData = await storage.getOrder(orderId);
  if (!orderData) throw new Error(`Pedido #${orderId} não encontrado`);

  const config = await storage.getCompanyConfig();
  if (!config) throw new Error("Configurações fiscais não encontradas");

  const company = await storage.getCompany((orderData.order as any).companyId);
  if (!company) throw new Error("Cliente não encontrado");

  // FASE NF.5.1 — ETAPA 1: regime tributário com override por cliente.
  // Prioridade: companies.regimeTributario → fallback config.regimeTributario.
  // Mantém mesma semântica de mapeamento para CRT (simples_nacional=1, mei=2, demais=3).
  const regime =
    (company as any)?.regimeTributario ||
    config?.regimeTributario;

  const crt =
    regime === "simples_nacional"
      ? "1"
      : regime === "mei"
        ? "2"
        : "3";

  // FASE NF.4.2 — ETAPA 5: emitente sem placeholder. Falha-rápido ANTES de
  // chamar fetchIbgeCode, evitando ruído de IBGE quando o cadastro está incompleto.
  if (!config.companyName?.trim()) throw new Error("NFE_MISSING_COMPANY_NAME");
  if (!config.address?.trim()) throw new Error("NFE_MISSING_EMITENTE_ADDRESS");
  if (!config.stateRegistration?.trim()) throw new Error("NFE_MISSING_EMITENTE_IE");

  const [emitIbge, destIbge] = await Promise.all([
    fetchIbgeCode(config.cep || "", config.city || ""),
    fetchIbgeCode(company.addressZip || "", company.addressCity || ""),
  ]);

  // ETAPA 5 — campos do emitente. FASE NF.4.2: sem fallbacks "VivaFrutaz" / "0" /
  // "Rua não configurada" — campos obrigatórios já foram validados acima.
  const emitente = {
    cnpj: safeStr(config.cnpj),
    xNome: safeStr(config.companyName),
    xFant: safeOptional(config.fantasyName) ?? safeStr(config.companyName),
    ie: safeStr(config.stateRegistration),
    crt,
    logradouro: safeStr(config.address),
    numero: safeStr(config.addressNumber, "S/N"),
    bairro: safeStr(config.neighborhood, "Centro"),
    xMun: safeStr(config.city, "São Paulo"),
    cMun: safeStr(emitIbge),
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
    cMun: safeStr((company as any).addressIbge || destIbge),
    uf: safeStr(company.addressState, "SP"),
    cep: safeStr((company.addressZip || "00000000").replace(/\D/g, "").padEnd(8, "0"), "00000000"),
  };

  // FASE NF.4.2 — ETAPA 1: CFOP automático por UF (5102 interno × 6102 interestadual).
  // Mantém prioridade do defaultCfop explícito (company > config). Só usa o fallback
  // inteligente quando não há CFOP configurado, e loga quando isso acontece.
  const emitUF = safeStr(config.state);
  const destUF = safeStr(company.addressState);
  const isSameUF = !!(emitUF && destUF && emitUF === destUF);
  const explicitDefaultCfop =
    (company as any).defaultCfop || config.defaultCfop;
  const defaultCfop =
    explicitDefaultCfop || (isSameUF ? "5102" : "6102");

  if (!explicitDefaultCfop) {
    // FASE NF.4.2 — ETAPA 6: log estruturado de fallback inteligente.
    console.warn("[NFE_FISCAL_ALERT]", {
      orderId,
      issue: "CFOP_AUTO_ADJUSTED",
      emitUF,
      destUF,
      chosenCfop: defaultCfop,
    });
  }

  // FASE 8.4 — `sourceItems` chega PRONTO via `args` (resolveBillingItems
  // foi movido para o call-site). Esta linha intencionalmente usa o array
  // já resolvido, sem nenhuma transformação adicional, garantindo XML
  // idêntico ao caminho anterior (validado em test-billing-equivalence.ts).

  // ETAPA 2 — normalização sem mutação: recalcula vProd a partir de qCom × vUnCom
  // FASE NF.4.2 — ETAPA 3: NCM obrigatório (sem fallback "08039000" de banana).
  // FASE NF.4.2 — ETAPA 2: CSOSN dinâmico por item (default 102 quando não vier no draft).
  const rawProdutos = sourceItems.map((item: any, idx: number) => {
    const ncmRaw = (item.ncm ?? "").toString().trim();
    if (!ncmRaw) {
      throw new Error("NFE_MISSING_NCM");
    }
    return {
      cProd: String(item.productId || idx + 1).padStart(6, "0"),
      xProd: safeStr(
        item.description || item.name || item.productName,
        "Produto",
      ),
      ncm: ncmRaw,
      cfop: safeStr(item.cfop, defaultCfop),
      uCom: safeStr(item.unit, "KG"),
      qCom: Number(item.quantity ?? 1),
      vUnCom: Number(item.unitPrice ?? item.finalPrice ?? 0),
      vProd: Number(item.totalPrice ?? 0),
      csosn: safeStr(item.csosn, "102"),
      // FASE NF.6.2 — CST por item (Lucro Presumido / Lucro Real, CRT=3).
      // Default '00' preserva backward-compat: se o draft/billing item não
      // trouxer cst, o XML continua sendo idêntico ao gerado antes da NF.6.2.
      // No Simples Nacional (CRT=1/2), o generator IGNORA este campo e segue
      // usando csosn — comportamento garantido pelo branch da NF.5.1/NF.6 em
      // server/services/nfe/nfeGenerator.ts (linhas 206-208).
      cst: (item as any).cst || "00",
      // FASE NF.7.8 — propaga flag de produto importado.
      // Origem: products.importado (cadastro) → resolveBillingItems → aqui.
      // Comparação === true evita falso positivo de "true"/1/"yes"/etc.
      // Default false: produto antigo sem o campo segue regra normal de UF.
      importado: (item as any).importado === true,
    };
  });

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
  const nfeInput: NFeInput = {
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

  // FASE 8.6A — VALIDAÇÃO RUNTIME EM SHADOW MODE.
  //
  // Ativada apenas com `NFE_VALIDATE_INPUT=1`. NUNCA lança e NUNCA bloqueia
  // a emissão (regra crítica #1/#5 da fase). Apenas observa: se o objeto
  // construído divergir do contrato `NFeInputSchema` (orderId + produtos[]
  // com cProd/xProd/ncm/cfop/uCom/qCom/vUnCom/vProd válidos), emite um log
  // estruturado `[NFE_SCHEMA_INVALID]` para diagnóstico, mantendo o fluxo
  // intacto. Telemetria pura — base para enforcement futuro.
  if (process.env.NFE_VALIDATE_INPUT === "1") {
    const result = NFeInputSchema.safeParse(nfeInput);
    if (!result.success) {
      console.error("[NFE_SCHEMA_INVALID]", {
        orderId: nfeInput.orderId,
        issues: result.error.issues,
      });
    }
  }

  return nfeInput;
}
