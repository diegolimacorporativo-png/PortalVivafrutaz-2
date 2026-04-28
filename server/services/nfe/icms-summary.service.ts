/**
 * FASE NF.7.9 — Agregação ICMS (Importados 4% vs Normal 7/12/18%).
 *
 * Camada de LEITURA pura. NÃO altera:
 *   - geração de XML (server/services/nfe/nfeGenerator.ts intacto)
 *   - cálculo de alíquota (getAliquotaICMS intacto)
 *   - tabelas de banco (apenas SELECT)
 *   - endpoint atual de drafts (/api/fiscal/drafts/* intacto)
 *
 * Estratégia: parsear o XML já emitido (xmlAutorizado preferencial,
 * fallback para xmlGerado). O XML é a fonte canônica — ele carrega
 * <vBC>, <vICMS> e <pICMS> por item exatamente como foi para a SEFAZ.
 *   - pICMS == 4(.00) → grupo IMPORTADO
 *   - qualquer outro valor (ou ausência) → grupo NORMAL
 *
 * Tenant scope: o filtro acontece via JOIN orders.companyId, pois
 * nfeEmissoes não tem coluna tenantId própria. Reaproveita o mesmo
 * vínculo já usado pelo módulo fiscal.
 */
import { db } from "../../database/db";
import { nfeEmissoes, orders } from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";

export type IcmsBucket = {
  totalNFs: number;
  totalItens: number;
  totalBase: number;
  totalICMS: number;
};

export type IcmsSummary = {
  importado: IcmsBucket;
  normal: IcmsBucket;
  // Metadados para o frontend exibir contexto sem pedir nova chamada.
  meta: {
    nfsConsideradas: number;
    nfsIgnoradas: number; // sem XML legível ou status excluído
    statusConsiderados: string[];
  };
};

// Status que CONTAM no relatório. canceladas/denegadas são excluídas
// porque não geram débito de ICMS efetivo. "gerada" entra para dar
// visibilidade do pipeline (mesmo antes da autorização).
const STATUS_VALIDOS = [
  "gerada",
  "assinada",
  "enviada",
  "autorizada",
] as const;

const emptyBucket = (): IcmsBucket => ({
  totalNFs: 0,
  totalItens: 0,
  totalBase: 0,
  totalICMS: 0,
});

/**
 * Extrai todos os blocos <det> do XML e retorna pares (vBC, vICMS, pICMS)
 * por item. Regex é suficiente porque o gerador emite XML achatado, sem
 * quebras de linha, e a estrutura ICMS é fixa por CST. Não dependemos de
 * parser DOM externo (zero novas dependências).
 */
function extractItemsFromXml(xml: string): Array<{
  vBC: number;
  vICMS: number;
  pICMS: number;
}> {
  const out: Array<{ vBC: number; vICMS: number; pICMS: number }> = [];
  if (!xml) return out;

  // Cada item da NF-e fica num bloco <det nItem="N">...</det>
  const detRegex = /<det\b[^>]*>([\s\S]*?)<\/det>/g;
  let m: RegExpExecArray | null;
  while ((m = detRegex.exec(xml)) !== null) {
    const block = m[1] || "";
    // Em ICMS Simples (CSOSN) não há vBC/vICMS/pICMS — pulamos sem erro.
    const vBC = numTag(block, "vBC");
    const vICMS = numTag(block, "vICMS");
    const pICMS = numTag(block, "pICMS");
    if (vBC == null && vICMS == null && pICMS == null) continue;
    out.push({
      vBC: vBC ?? 0,
      vICMS: vICMS ?? 0,
      pICMS: pICMS ?? 0,
    });
  }
  return out;
}

function numTag(block: string, tag: string): number | null {
  const re = new RegExp(`<${tag}>([^<]+)</${tag}>`);
  const m = re.exec(block);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Decide o grupo do item. pICMS é arredondado a 2 casas para casar com
 * o formato emitido (ex.: "4.00"). Margem de 0.01 absorve qualquer
 * conversão numérica.
 */
function isImportadoByAliquota(pICMS: number): boolean {
  return Math.abs(pICMS - 4) < 0.01;
}

/**
 * Agregação principal. Lê todas as NF-es do tenant em status válido,
 * parseia cada XML e soma por bucket.
 *
 * @param empresaId — id da empresa (orders.companyId). OBRIGATÓRIO:
 *                   sem isso a função não consulta nada (proteção contra
 *                   chamada cross-tenant acidental).
 */
export async function getIcmsSummary(empresaId: number): Promise<IcmsSummary> {
  const summary: IcmsSummary = {
    importado: emptyBucket(),
    normal: emptyBucket(),
    meta: {
      nfsConsideradas: 0,
      nfsIgnoradas: 0,
      statusConsiderados: [...STATUS_VALIDOS],
    },
  };

  if (!Number.isInteger(empresaId) || empresaId <= 0) {
    return summary;
  }

  // SELECT … FROM nfe_emissoes JOIN orders ON orders.id = nfe.order_id
  // WHERE orders.company_id = :empresaId AND nfe.status IN (…)
  const rows = await db
    .select({
      nfeId: nfeEmissoes.id,
      status: nfeEmissoes.status,
      xmlAutorizado: nfeEmissoes.xmlAutorizado,
      xmlGerado: nfeEmissoes.xmlGerado,
    })
    .from(nfeEmissoes)
    .innerJoin(orders, eq(orders.id, nfeEmissoes.orderId))
    .where(
      and(
        eq(orders.companyId, empresaId),
        inArray(nfeEmissoes.status, STATUS_VALIDOS as unknown as string[]),
      ),
    );

  for (const row of rows) {
    const xml = row.xmlAutorizado || row.xmlGerado || "";
    const items = extractItemsFromXml(xml);
    if (items.length === 0) {
      summary.meta.nfsIgnoradas += 1;
      continue;
    }
    summary.meta.nfsConsideradas += 1;

    // Cada NF contribui +1 em totalNFs do bucket onde TEM pelo menos 1
    // item daquele tipo (uma NF mista entra em ambos — comportamento
    // esperado para auditoria SPED).
    let touchedImportado = false;
    let touchedNormal = false;

    for (const it of items) {
      const bucket = isImportadoByAliquota(it.pICMS)
        ? summary.importado
        : summary.normal;
      bucket.totalItens += 1;
      bucket.totalBase += it.vBC;
      bucket.totalICMS += it.vICMS;
      if (bucket === summary.importado) touchedImportado = true;
      else touchedNormal = true;
    }

    if (touchedImportado) summary.importado.totalNFs += 1;
    if (touchedNormal) summary.normal.totalNFs += 1;
  }

  // Arredonda a 2 casas no final (somatório float pode acumular ruído).
  summary.importado.totalBase = round2(summary.importado.totalBase);
  summary.importado.totalICMS = round2(summary.importado.totalICMS);
  summary.normal.totalBase = round2(summary.normal.totalBase);
  summary.normal.totalICMS = round2(summary.normal.totalICMS);

  return summary;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
