/**
 * FASE 3 — Wrapper de assinatura ENV-driven.
 *
 * Delegação intencional: a lógica real de assinatura PKCS#12/XMLDSig já
 * existe em `./nfeSignature.ts` (usa `node-forge` + `xml-crypto`). Este
 * arquivo só expõe um helper sem-argumentos — recebe o XML, lê o cert das
 * variáveis de ambiente via `nfeCert.getCertificado()` e devolve o XML
 * assinado. Mantemos uma única implementação de assinatura para evitar
 * drift entre dois algoritmos divergentes.
 *
 * Não altera contratos — `nfeSignature.assinarXML` continua intacto e em uso.
 */

import { assinarXML as assinarComPfx } from './nfeSignature';
import { getCertificado } from './nfeCert';

/**
 * Assina um XML NF-e usando o certificado A1 configurado em variáveis de
 * ambiente (NFE_CERT_PATH/NFE_CERT_PASSWORD ou NFE_CERT_BASE64).
 *
 * @throws Erro descritivo se o cert/senha não estiverem configurados.
 */
export async function assinarXML(xml: string): Promise<string> {
  const { pfx, passphrase } = getCertificado();
  // `assinarComPfx` aceita Buffer→base64 string ou caminho. Usamos base64
  // direto — evita gravar PFX em disco temporário e funciona com NFE_CERT_BASE64.
  const { xmlAssinado } = await assinarComPfx(xml, pfx.toString('base64'), passphrase);
  return xmlAssinado;
}
