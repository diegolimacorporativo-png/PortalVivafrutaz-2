/**
 * STEP 9.3C — Serviço de construção do NFeInput.
 *
 * Extração da função `buildNFeInput` (antes inline em routes.ts) para que
 * o cron de faturamento possa reutilizá-la sem duplicar lógica.
 * A lógica interna está 100% preservada.
 */

import { storage } from "../../services/storage";

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

// ── buildNFeInput ─────────────────────────────────────────────────────────────

export async function buildNFeInput(orderId: number) {
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

  const emitente = {
    cnpj: config.cnpj || "",
    xNome: config.companyName || "VivaFrutaz",
    xFant: config.fantasyName || config.companyName,
    ie: config.stateRegistration || "0",
    crt,
    logradouro: config.address || "Rua não configurada",
    numero: config.addressNumber || "S/N",
    bairro: config.neighborhood || "Centro",
    xMun: config.city || "São Paulo",
    cMun: emitIbge,
    uf: config.state || "SP",
    cep: (config.cep || "00000000").replace(/\D/g, "").padEnd(8, "0"),
    fone: config.phone || "",
  };

  const destinatario = {
    cnpj: company.cnpj?.replace(/\D/g, "") ? company.cnpj : undefined,
    xNome: company.companyName,
    ie: company.stateRegistration || undefined,
    logradouro: company.addressStreet || "Endereço não informado",
    numero: company.addressNumber || "S/N",
    bairro: company.addressNeighborhood || "Centro",
    xMun: company.addressCity || "São Paulo",
    cMun: (company as any).addressIbge || destIbge,
    uf: company.addressState || "SP",
    cep: (company.addressZip || "00000000").replace(/\D/g, "").padEnd(8, "0"),
  };

  const defaultCfop =
    (company as any).defaultCfop || config.defaultCfop || "5102";

  const produtos = orderData.items.map((item: any, idx: number) => ({
    cProd: String(item.productId || idx + 1).padStart(6, "0"),
    xProd: item.name || item.productName || "Produto",
    ncm: item.ncm || "08039000",
    cfop: item.cfop || defaultCfop,
    uCom: item.unit || "KG",
    qCom: parseFloat(item.quantity || 1),
    vUnCom: parseFloat(item.unitPrice || item.finalPrice || 0),
    vProd: parseFloat(item.totalPrice || 0),
  }));

  return {
    emitente,
    destinatario,
    produtos,
    natOp: config.defaultNatureza || "Venda de mercadoria adquirida",
    tpAmb: (config.ambienteFiscal === "producao" ? "1" : "2") as "1" | "2",
    orderId,
    orderCode: (orderData.order as any).orderCode,
    informacoesAdicionais: config.informacoesAdicionais
      ? `${config.informacoesAdicionais}\nPedido: ${(orderData.order as any).orderCode || `#${orderId}`}`
      : `Pedido: ${(orderData.order as any).orderCode || `#${orderId}`}`,
  };
}
