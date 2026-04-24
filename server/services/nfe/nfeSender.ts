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
const SEFAZ_URL: Record<string, { homologacao: string; producao: string }> = {
  SP: {
    homologacao: 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nfeautorizacao4.asmx',
    producao: 'https://nfe.fazenda.sp.gov.br/ws/nfeautorizacao4.asmx',
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
  const url = getSefazUrl(uf, ambiente);
  const idLote = String(Date.now()).slice(-15);
  const soap = buildSoap(xmlAssinado, idLote);

  const httpsAgent = certPem && certKey
    ? new (require('https').Agent)({ cert: certPem, key: certKey, rejectUnauthorized: false })
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
