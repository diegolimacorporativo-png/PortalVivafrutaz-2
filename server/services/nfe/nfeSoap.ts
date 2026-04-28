/**
 * FASE 3 — Helper de envelope SOAP para NFeAutorizacao 4.00.
 *
 * Versão pública/simplificada, mantida em paralelo ao `buildSoap` interno
 * de `nfeSender.ts` (que já cobre o caso de produção com cabeçalho cUF +
 * idLote + indSinc). Este export existe para permitir que callers externos
 * (testes, scripts, integrações futuras) montem o envelope sem importar o
 * sender inteiro.
 *
 * NÃO altera o comportamento do sender — `nfeSender.buildSoap` continua a
 * fonte usada na transmissão real.
 */

const SOAP_ENV_NS = 'http://www.w3.org/2003/05/soap-envelope';
const NFE_AUT_NS = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4';

/**
 * Empacota um XML NF-e já assinado em um envelope SOAP 1.2 mínimo, pronto
 * para `POST` no webservice NFeAutorizacao4 da SEFAZ.
 */
export function montarEnvelope(xmlAssinado: string): string {
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap:Envelope xmlns:soap="${SOAP_ENV_NS}">` +
    `<soap:Body>` +
    `<nfeDadosMsg xmlns="${NFE_AUT_NS}">` +
    xmlAssinado +
    `</nfeDadosMsg>` +
    `</soap:Body>` +
    `</soap:Envelope>`
  );
}
