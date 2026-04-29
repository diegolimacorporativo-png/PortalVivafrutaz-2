import axios from 'axios';

export type NFeStatus = 'autorizada' | 'rejeitada' | 'denegada' | 'pendente' | 'erro';

export interface NFeRetornoSEFAZ {
  status: NFeStatus;
  cStat: string;
  xMotivo: string;
  protocolo?: string;
  chaveNFe?: string;
  dataAutorizacao?: string;
  xmlAutorizado?: string;
}

// SEFAZ URLs por UF (webservice NFeAutorizacao 4.00)
// FASE NF.7.4 — expansão multi-UF incremental. SP + default mantidos intactos.
// Estados não mapeados continuam caindo no `default` (GO/SVRS-like).
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

function getSefazUrl(uf: string, ambiente: '1' | '2'): string {
  const urls = SEFAZ_URL[uf.toUpperCase()] || SEFAZ_URL.default;
  return ambiente === '1' ? urls.producao : urls.homologacao;
}

/**
 * FASE NF.7.2 — leitura defensiva do tpAmb a partir do XML assinado.
 * O XML é a fonte da verdade (já assinado); se o caller passar um ambiente
 * divergente, prevalece o que está no XML para evitar enviar para o ambiente
 * errado (ex.: XML tpAmb=2 indo para URL de produção).
 * Retorna null quando o XML não traz <tpAmb> reconhecível.
 */
function detectarAmbienteFromXml(xml: string): '1' | '2' | null {
  const m = xml.match(/<tpAmb>\s*([12])\s*<\/tpAmb>/);
  if (!m) return null;
  return m[1] === '1' ? '1' : '2';
}

/**
 * FASE NF.7.3 — leitura da UF do EMITENTE direto do XML assinado.
 * Olha apenas dentro do bloco <emit>...</emit> para evitar pegar a UF do
 * destinatário por engano. O XML é a fonte da verdade — a URL do webservice
 * SEFAZ é por estado do EMITENTE. Retorna null quando o bloco não existir
 * ou não contiver <UF> reconhecível (2 letras maiúsculas).
 */
function detectarUfFromXml(xml: string): string | null {
  const match = xml.match(/<emit>[\s\S]*?<UF>\s*([A-Z]{2})\s*<\/UF>/);
  return match ? match[1] : null;
}

/**
 * FASE NF.7.2 — resposta MOCK padronizada nesta camada.
 * Mantém o fallback seguro mesmo se a rota legada for chamada
 * com NFE_SEFAZ_MODE=mock (preserva o comportamento atual).
 */
function mockResponse(): NFeRetornoSEFAZ {
  return {
    status: 'autorizada',
    cStat: '100',
    xMotivo: 'Autorizado o uso da NF-e [MOCK]',
    protocolo: `MOCK-${Date.now()}`,
    dataAutorizacao: new Date().toISOString(),
  };
}

function buildSoap(xmlNFe: string, idLote: string): string {
  return `<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Header><nfeCabecMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4"><cUF>35</cUF><versaoDados>4.00</versaoDados></nfeCabecMsg></soap12:Header><soap12:Body><nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4"><enviNFe versao="1.00" xmlns="http://www.portalfiscal.inf.br/nfe"><idLote>${idLote}</idLote><indSinc>1</indSinc>${xmlNFe}</enviNFe></nfeDadosMsg></soap12:Body></soap12:Envelope>`;
}

function parseSefazResponse(responseXml: string): NFeRetornoSEFAZ {
  // Extract cStat
  const cStatMatch = responseXml.match(/<cStat>(\d+)<\/cStat>/);
  const xMotivoMatch = responseXml.match(/<xMotivo>([^<]+)<\/xMotivo>/);
  const nProtoMatch = responseXml.match(/<nProt>(\d+)<\/nProt>/);
  const chNFeMatch = responseXml.match(/<chNFe>(\d{44})<\/chNFe>/);
  const dhReciMatch = responseXml.match(/<dhRecbto>([^<]+)<\/dhRecbto>/);

  const cStat = cStatMatch?.[1] || '999';
  const xMotivo = xMotivoMatch?.[1] || 'Sem resposta';
  const protocolo = nProtoMatch?.[1];
  const chaveNFe = chNFeMatch?.[1];
  const dataAutorizacao = dhReciMatch?.[1];

  let status: NFeStatus = 'erro';
  if (cStat === '100') status = 'autorizada';
  else if (['110', '301', '302'].includes(cStat)) status = 'denegada';
  else if (parseInt(cStat) >= 200 && parseInt(cStat) < 300) status = 'rejeitada';

  return { status, cStat, xMotivo, protocolo, chaveNFe, dataAutorizacao };
}

export async function enviarNFeSEFAZ(
  xmlAssinado: string,
  uf: string,
  ambiente: '1' | '2',
  certPem?: string,
  certKey?: string
): Promise<NFeRetornoSEFAZ> {
  // FASE NF.7.2 — fallback MOCK preservado nesta camada.
  // Quando NFE_SEFAZ_MODE=mock, NÃO chama SEFAZ real, retorna autorização
  // simulada. Mantém o comportamento atual mesmo se chamado pela rota legada.
  const sefazMode = (process.env.NFE_SEFAZ_MODE ?? 'mock').toLowerCase();
  if (sefazMode === 'mock') {
    console.info('[NFE_SEFAZ_MOCK]', { uf, ambienteRequest: ambiente });
    return mockResponse();
  }

  // FASE NF.7.2 — reconciliação de ambiente: o XML é a fonte da verdade
  // (já assinado). Se vier divergente do parâmetro, usa o do XML e loga.
  const ambienteXml = detectarAmbienteFromXml(xmlAssinado);
  const ambienteFinal: '1' | '2' = ambienteXml ?? ambiente;
  if (ambienteXml && ambienteXml !== ambiente) {
    console.warn('[NFE_SEFAZ_AMBIENTE_DIVERGENTE]', {
      ambienteParametro: ambiente,
      ambienteXml,
      decisao: `usando tpAmb do XML (${ambienteFinal})`,
    });
  }

  // FASE NF.7.3 — reconciliação da UF do EMITENTE: o XML é a fonte da verdade.
  // Permite multi-UF sem mudar a assinatura da função nem os callers atuais.
  // Fallback triplo garante zero regressão: XML → parâmetro → "SP".
  const ufXml = detectarUfFromXml(xmlAssinado);
  // Usa `||` (não `??`) para tratar também string vazia como ausência:
  // garante o fallback "SP" mesmo se o caller passar `uf=""`.
  const ufFinal = (ufXml || uf || 'SP').toUpperCase();
  if (ufXml && uf && ufXml.toUpperCase() !== uf.toUpperCase()) {
    console.warn('[NFE_SEFAZ_UF_DIVERGENTE]', {
      ufParametro: uf,
      ufXml,
      decisao: `usando UF do XML (${ufXml})`,
    });
  }

  // FASE NF.7.4 — log de monitoramento quando a UF cai no fallback `default`.
  // Útil para detectar emitentes em estados ainda não mapeados em SEFAZ_URL
  // e priorizar a próxima leva de URLs oficiais.
  if (!SEFAZ_URL[ufFinal]) {
    console.warn('[NFE_SEFAZ_FALLBACK_UF]', {
      uf: ufFinal,
      usando: 'default (GO)',
    });
  }

  // FASE NF.7.2/7.3 — resolução estrita da URL por UF + ambiente.
  const url = getSefazUrl(ufFinal, ambienteFinal);
  if (!url) {
    throw new Error(`SEFAZ não configurada para UF: ${ufFinal}`);
  }
  console.info('[NFE_SEFAZ_DISPATCH]', {
    uf: ufFinal,
    ambiente: ambienteFinal === '1' ? 'producao' : 'homologacao',
    url,
  });

  const idLote = String(Date.now()).slice(-15);
  const soap = buildSoap(xmlAssinado, idLote);

  // FASE 3 / FASE 3.2 — cadeia de resolução do certificado A1, em ordem:
  //   1. Manual: certPem/certKey passados pelo caller (mantém comportamento legado).
  //   2. Banco (FASE 3.2): tabela `company_certificates` para o tenant ativo
  //      (resolvido via AsyncLocalStorage). Multi-tenant real.
  //   3. Env (FASE 3): NFE_CERT_PATH / NFE_CERT_BASE64 / CERT_PATH (legacy).
  // Se nenhuma das três fontes resolver, mantém o comportamento atual: tenta
  // POST sem mTLS (a SEFAZ recusará — comportamento inalterado).
  let pem = certPem;
  let key = certKey;

  // 2. Cert do banco (per-tenant)
  if (!pem || !key) {
    try {
      const { getCertificadoDinamico } = await import('./nfeCertDynamic');
      const dynamic = await getCertificadoDinamico();
      if (dynamic) {
        const { getCertificado } = await import('./nfeCert');
        const bundle = getCertificado({
          pfxBuffer: dynamic.pfx,
          password: dynamic.passphrase,
          source: 'database',
        });
        pem = bundle.certPem;
        key = bundle.keyPem;
        console.info('[NFE_CERT_FROM_DB]', { tenantId: dynamic.tenantId });
      }
    } catch (e: any) {
      console.warn('[NFE_CERT_DB_LOAD_FAIL]', { error: e?.message });
    }
  }

  // 3. Cert do env (fallback)
  if ((!pem || !key) && (process.env.NFE_CERT_PATH || process.env.NFE_CERT_BASE64 || process.env.CERT_PATH)) {
    try {
      const { getCertificado } = await import('./nfeCert');
      const bundle = getCertificado();
      pem = bundle.certPem;
      key = bundle.keyPem;
      console.info('[NFE_SEFAZ_CERT_FROM_ENV]', { source: bundle.source });
    } catch (e: any) {
      console.warn('[NFE_SEFAZ_CERT_LOAD_FAIL]', { error: e?.message });
    }
  }

  const httpsAgent = pem && key
    ? new (require('https').Agent)({ cert: pem, key, rejectUnauthorized: false })
    : undefined;

  const response = await axios.post(url, soap, {
    headers: {
      'Content-Type': 'application/soap+xml;charset=UTF-8;action="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4/nfeAutorizacaoLote"',
    },
    httpsAgent,
    timeout: 30000,
  });

  return parseSefazResponse(response.data);
}

export async function consultarStatusSEFAZ(uf: string, ambiente: '1' | '2'): Promise<{ online: boolean; xMotivo: string }> {
  const urlBase = (SEFAZ_URL[uf.toUpperCase()] || SEFAZ_URL.default);
  const statusUrl = ambiente === '1' ? urlBase.producao.replace('NfeAutorizacao4', 'NfeStatusServico4') : urlBase.homologacao.replace('NfeAutorizacao4', 'NfeStatusServico4');

  const soap = `<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body><nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4"><consStatServ versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><tpAmb>${ambiente}</tpAmb><cUF>${(SEFAZ_URL[uf.toUpperCase()] ? uf.toUpperCase() : 'SP')}</cUF><xServ>STATUS</xServ></consStatServ></nfeDadosMsg></soap12:Body></soap12:Envelope>`;

  try {
    const response = await axios.post(statusUrl, soap, {
      headers: { 'Content-Type': 'application/soap+xml;charset=UTF-8' },
      timeout: 10000,
    });
    const cStat = response.data.match(/<cStat>(\d+)<\/cStat>/)?.[1] || '999';
    const xMotivo = response.data.match(/<xMotivo>([^<]+)<\/xMotivo>/)?.[1] || 'Desconhecido';
    return { online: cStat === '107', xMotivo };
  } catch (e: any) {
    return { online: false, xMotivo: e.message };
  }
}

export async function cancelarNFe(
  chaveNFe: string,
  protocolo: string,
  xJust: string,
  uf: string,
  cnpjEmit: string,
  ambiente: '1' | '2'
): Promise<NFeRetornoSEFAZ> {
  const url = getSefazUrl(uf, ambiente);
  const now = new Date().toISOString().replace('Z', '-03:00');
  const xml = `<cancNFe versao="1.00" xmlns="http://www.portalfiscal.inf.br/nfe"><infCancNFe Id="ID${chaveNFe}"><tpAmb>${ambiente}</tpAmb><xServ>CANCELAR</xServ><chNFe>${chaveNFe}</chNFe><dhEvento>${now}</dhEvento><nSeqEvento>1</nSeqEvento><verEvento>1.00</verEvento><detEvento versao="1.00"><descEvento>Cancelamento</descEvento><nProt>${protocolo}</nProt><xJust>${xJust.slice(0, 255)}</xJust></detEvento></infCancNFe></cancNFe>`;
  const soap = `<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body><nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4">${xml}</nfeDadosMsg></soap12:Body></soap12:Envelope>`;

  const response = await axios.post(url, soap, {
    headers: { 'Content-Type': 'application/soap+xml;charset=UTF-8' },
    timeout: 30000,
  });
  return parseSefazResponse(response.data);
}
