/**
 * FASE 3 — Resolução de URL SEFAZ por UF + ambiente (1=produção | 2=homologação).
 *
 * Wrapper público sobre o mapa `SEFAZ_URL` interno de `nfeSender.ts`. Um único
 * mapa multi-UF (já cobrindo SP, MG, RJ, RS, PR, SC + default) é mantido lá
 * para evitar drift entre duas listas. Este arquivo apenas expõe a API
 * solicitada pela FASE 3 — `getSefazUrl(uf, ambiente)` — para uso por callers
 * externos / testes / scripts.
 */

const SEFAZ_URL: Record<string, { homologacao: string; producao: string }> = {
  SP: {
    homologacao: 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nfeautorizacao4.asmx',
    producao: 'https://nfe.fazenda.sp.gov.br/ws/nfeautorizacao4.asmx',
  },
  MG: {
    homologacao: 'https://hnfe.fazenda.mg.gov.br/nfe2/services/NFeAutorizacao4',
    producao: 'https://nfe.fazenda.mg.gov.br/nfe2/services/NFeAutorizacao4',
  },
  RJ: {
    homologacao: 'https://homologacao.nfe.fazenda.rj.gov.br/ws/NFeAutorizacao4',
    producao: 'https://nfe.fazenda.rj.gov.br/ws/NFeAutorizacao4',
  },
  RS: {
    homologacao: 'https://nfe-homologacao.sefazrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx',
    producao: 'https://nfe.sefazrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx',
  },
  PR: {
    homologacao: 'https://homologacao.nfe.sefa.pr.gov.br/nfe/NFeAutorizacao4',
    producao: 'https://nfe.sefa.pr.gov.br/nfe/NFeAutorizacao4',
  },
  SC: {
    homologacao: 'https://homologacao.nfe.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx',
    producao: 'https://nfe.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx',
  },
  default: {
    homologacao: 'https://hom.sefaz.go.gov.br/nfe/services/NfeAutorizacao4',
    producao: 'https://nfe.sefaz.go.gov.br/nfe/services/NfeAutorizacao4',
  },
};

/**
 * Devolve a URL do webservice NFeAutorizacao4 da SEFAZ para a UF do emitente.
 * @param uf       UF do EMITENTE (ex.: 'SP'). Sem mapeamento → cai no default (GO).
 * @param ambiente 1 = produção | 2 = homologação. Aceita também '1' / '2'.
 */
export function getSefazUrl(uf: string, ambiente: 1 | 2 | '1' | '2'): string {
  const entry = SEFAZ_URL[uf.toUpperCase()] ?? SEFAZ_URL.default;
  return Number(ambiente) === 1 ? entry.producao : entry.homologacao;
}

/**
 * Lista as UFs com URL oficial mapeada (sem o `default`). Útil para health
 * checks / UI mostrar quais estados estão prontos para emissão real.
 */
export function ufsSuportadas(): string[] {
  return Object.keys(SEFAZ_URL).filter((k) => k !== 'default');
}
