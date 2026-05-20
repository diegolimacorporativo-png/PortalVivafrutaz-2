/**
 * NF-e SEFAZ Sender
 *
 * FASE NF-e 1.2 hardening (T1202–T1206):
 *  T1202 — XML Guard: valida XML assinado antes de cada transmissão
 *  T1203 — Cert Guard: verifica expiração do certificado antes de usar
 *  T1204 — SOAP: [SEFAZ_TIMEOUT] / [SEFAZ_DOWN] labels + circuit breaker
 *  T1205 — Fiscal Store: todos os eventos fiscais registrados em memória
 *  T1206 — Correlação: fiscalRequestId gerado por chamada, propagado em todos os logs
 */
import axios from 'axios';
import https from 'https';
import { randomUUID } from 'node:crypto';
import { recordNfeEmissionDuration, incNfeFailures } from '../../core/observability/metrics';
import { validateXmlBeforeSend } from './nfeXmlGuard';
import {
  checkCircuit,
  recordCircuitFailure,
  recordCircuitSuccess,
  classifyAxiosError,
} from './sefazCircuitBreaker';
import { emitFiscalEvent } from '../../core/nfe/fiscal-store';
import { validateCertExpiry } from './nfeCertGuard';

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

export interface EventoRetornoSEFAZ {
  cStat: string;
  xMotivo: string;
  protocolo: string;
  xmlEvento: string;
}

// SEFAZ URLs por UF (webservice NFeAutorizacao 4.00)
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

// T1102/T1103 — URLs para NFeRecepcaoEvento4 (cancelamento + CC-e)
const SEFAZ_EVENTO_URL: Record<string, { homologacao: string; producao: string }> = {
  SP: {
    homologacao: 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nferecepcaoevento4.asmx',
    producao: 'https://nfe.fazenda.sp.gov.br/ws/nferecepcaoevento4.asmx',
  },
  MG: {
    homologacao: 'https://hnfe.fazenda.mg.gov.br/nfe2/services/NFeRecepcaoEvento4',
    producao: 'https://nfe.fazenda.mg.gov.br/nfe2/services/NFeRecepcaoEvento4',
  },
  RJ: {
    homologacao: 'https://homologacao.nfe.fazenda.rj.gov.br/ws/NFeRecepcaoEvento4',
    producao: 'https://nfe.fazenda.rj.gov.br/ws/NFeRecepcaoEvento4',
  },
  RS: {
    homologacao: 'https://hom.svrs.rs.gov.br/ws/recepcaoEvento/recepcaoEvento.asmx',
    producao: 'https://nfe.svrs.rs.gov.br/ws/recepcaoEvento/recepcaoEvento.asmx',
  },
  PR: {
    homologacao: 'https://homologacao.nfe.sefa.pr.gov.br/nfe/NFeRecepcaoEvento4',
    producao: 'https://nfe.sefa.pr.gov.br/nfe/NFeRecepcaoEvento4',
  },
  SC: {
    homologacao: 'https://homologacao.nfe.svrs.rs.gov.br/ws/recepcaoEvento/recepcaoEvento.asmx',
    producao: 'https://nfe.svrs.rs.gov.br/ws/recepcaoEvento/recepcaoEvento.asmx',
  },
  default: {
    homologacao: 'https://hom.svrs.rs.gov.br/ws/recepcaoEvento/recepcaoEvento.asmx',
    producao: 'https://nfe.svrs.rs.gov.br/ws/recepcaoEvento/recepcaoEvento.asmx',
  },
};

function getSefazUrl(uf: string, ambiente: '1' | '2'): string {
  const urls = SEFAZ_URL[uf.toUpperCase()] || SEFAZ_URL.default;
  return ambiente === '1' ? urls.producao : urls.homologacao;
}

function getEventoUrl(uf: string, ambiente: '1' | '2'): string {
  const urls = SEFAZ_EVENTO_URL[uf.toUpperCase()] || SEFAZ_EVENTO_URL.default;
  return ambiente === '1' ? urls.producao : urls.homologacao;
}

function detectarAmbienteFromXml(xml: string): '1' | '2' | null {
  const m = xml.match(/<tpAmb>\s*([12])\s*<\/tpAmb>/);
  if (!m) return null;
  return m[1] === '1' ? '1' : '2';
}

function detectarUfFromXml(xml: string): string | null {
  const match = xml.match(/<emit>[\s\S]*?<UF>\s*([A-Z]{2})\s*<\/UF>/);
  return match ? match[1] : null;
}

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
  // FIX: Declaração XML NÃO pode aparecer dentro de elemento SOAP.
  // O envelope SOAP já tem sua própria <?xml?> na raiz.
  // Remover antes de embedar em <enviNFe>.
  const nfeBody = xmlNFe.replace(/^<\?xml[^?]*\?>\s*/i, '');

  // FIX: cUF dinâmico — extraído do próprio XML em vez de hardcoded (35/SP).
  const cUFMatch = nfeBody.match(/<cUF>(\d+)<\/cUF>/);
  const cUF = cUFMatch?.[1] ?? '35';

  return `<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Header><nfeCabecMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4"><cUF>${cUF}</cUF><versaoDados>4.00</versaoDados></nfeCabecMsg></soap12:Header><soap12:Body><nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4"><enviNFe versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><idLote>${idLote}</idLote><indSinc>1</indSinc>${nfeBody}</enviNFe></nfeDadosMsg></soap12:Body></soap12:Envelope>`;
}

function buildEventoSoap(xmlEvento: string): string {
  // FIX: Remover declaração XML do evento antes de embedar em SOAP.
  const eventoBody = xmlEvento.replace(/^<\?xml[^?]*\?>\s*/i, '');
  return `<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body><nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4">${eventoBody}</nfeDadosMsg></soap12:Body></soap12:Envelope>`;
}

function parseSefazResponse(responseXml: string): NFeRetornoSEFAZ {
  // A resposta SEFAZ tem dois níveis de cStat:
  //   1) <retEnviNFe><cStat>104</cStat>  — código do LOTE (104=processado, 106=rejeitado, etc.)
  //   2) <protNFe><infProt><cStat>100</cStat>  — código da NF-e individual (100=autorizada)
  // Regex simples captura o PRIMEIRO match (nível lote), ignorando o resultado real da NF-e.
  // Fix: extrair infProt primeiro e ler cStat/xMotivo/nProt de dentro dele.
  const infProtMatch = responseXml.match(/<infProt[\s\S]*?<\/infProt>/);
  const infProtXml = infProtMatch?.[0] ?? responseXml;

  const cStatMatch = infProtXml.match(/<cStat>(\d+)<\/cStat>/);
  const xMotivoMatch = infProtXml.match(/<xMotivo>([^<]+)<\/xMotivo>/);
  const nProtoMatch = infProtXml.match(/<nProt>(\d+)<\/nProt>/);
  const chNFeMatch = infProtXml.match(/<chNFe>(\d{44})<\/chNFe>/);
  const dhReciMatch = infProtXml.match(/<dhRecbto>([^<]+)<\/dhRecbto>/);

  // Se não há infProt (ex: rejeição de lote), ler nível raiz como fallback
  const cStat = cStatMatch?.[1] || responseXml.match(/<cStat>(\d+)<\/cStat>/)?.[1] || '999';
  const xMotivo = xMotivoMatch?.[1] || responseXml.match(/<xMotivo>([^<]+)<\/xMotivo>/)?.[1] || 'Sem resposta';
  const protocolo = nProtoMatch?.[1];
  const chaveNFe = chNFeMatch?.[1];
  const dataAutorizacao = dhReciMatch?.[1];

  let status: NFeStatus = 'erro';
  if (cStat === '100') status = 'autorizada';
  else if (['110', '301', '302'].includes(cStat)) status = 'denegada';
  else if (parseInt(cStat) >= 200 && parseInt(cStat) < 300) status = 'rejeitada';

  return { status, cStat, xMotivo, protocolo, chaveNFe, dataAutorizacao };
}

function parseEventoResponse(responseXml: string): EventoRetornoSEFAZ {
  const infEventoMatch = responseXml.match(/<infEvento[\s\S]*?<\/infEvento>/);
  const infEventoXml = infEventoMatch?.[0] ?? responseXml;

  const cStat = infEventoXml.match(/<cStat>(\d+)<\/cStat>/)?.[1] ?? '999';
  const xMotivo = infEventoXml.match(/<xMotivo>([^<]+)<\/xMotivo>/)?.[1] ?? 'Sem resposta';
  const protocolo = infEventoXml.match(/<nProt>(\d+)<\/nProt>/)?.[1] ?? '';

  return { cStat, xMotivo, protocolo, xmlEvento: responseXml };
}

// T1102/T1103 — carrega certificado para mTLS
async function resolverHttpsAgent(): Promise<any> {
  const nfeTlsStrict = process.env.NFE_TLS_STRICT === 'true';
  try {
    const { getCertificadoDinamico } = await import('./nfeCertDynamic');
    const dynamic = await getCertificadoDinamico();
    if (dynamic) {
      const { getCertificado } = await import('./nfeCert');
      const bundle = getCertificado({ pfxBuffer: dynamic.pfx, password: dynamic.passphrase, source: 'database' });
      return new (require('https').Agent)({ cert: bundle.certPem, key: bundle.keyPem, rejectUnauthorized: nfeTlsStrict });
    }
  } catch (e: any) {
    console.warn('[NFE_EVENTO_CERT_DB_FAIL]', e?.message);
  }
  const certPath = process.env.NFE_CERT_PATH || process.env.CERT_PATH;
  const certPwd = process.env.NFE_CERT_PASSWORD || process.env.CERT_PASSWORD;
  if (certPath && certPwd) {
    try {
      const { getCertificado } = await import('./nfeCert');
      const bundle = getCertificado();
      return new (require('https').Agent)({ cert: bundle.certPem, key: bundle.keyPem, rejectUnauthorized: nfeTlsStrict });
    } catch (e: any) {
      console.warn('[NFE_EVENTO_CERT_ENV_FAIL]', e?.message);
    }
  }
  return undefined;
}

// T1102/T1103 — assina XML de evento
async function assinarEventoXml(xmlEvento: string): Promise<string> {
  const { assinarEvento } = await import('./nfeSignature');
  try {
    const { getCertificadoDinamico } = await import('./nfeCertDynamic');
    const dynamic = await getCertificadoDinamico();
    if (dynamic) {
      const pfxB64 = dynamic.pfx.toString('base64');
      const { xmlAssinado } = await assinarEvento(xmlEvento, pfxB64, dynamic.passphrase);
      return xmlAssinado;
    }
  } catch (e: any) {
    console.warn('[NFE_EVENTO_SIGN_DB_FAIL]', e?.message);
  }
  const certPath = process.env.NFE_CERT_PATH || process.env.CERT_PATH;
  const certPwd = process.env.NFE_CERT_PASSWORD || process.env.CERT_PASSWORD;
  if (certPath && certPwd) {
    const { xmlAssinado } = await assinarEvento(xmlEvento, certPath, certPwd);
    return xmlAssinado;
  }
  throw new Error('Certificado digital não configurado. Configure CERT_PATH e CERT_PASSWORD.');
}

// ── T1204: Classify + log structured error ─────────────────────────────────

function logSefazError(
  err: unknown,
  label: string,
  fiscalRequestId: string,
  context: Record<string, unknown>,
): void {
  const errType = classifyAxiosError(err);
  const msg = err instanceof Error ? err.message : String(err);

  if (errType === 'timeout') {
    console.error('[SEFAZ_TIMEOUT]', { fiscalRequestId, label, error: msg, ...context });
    emitFiscalEvent({ kind: 'sefaz_timeout', requestId: fiscalRequestId, errorMessage: msg, ...context as any });
  } else if (errType === 'connection') {
    console.error('[SEFAZ_DOWN]', { fiscalRequestId, label, errorType: errType, error: msg, ...context });
    emitFiscalEvent({ kind: 'sefaz_down', requestId: fiscalRequestId, errorMessage: msg, ...context as any });
  } else {
    console.error(`[${label}_ERROR]`, { fiscalRequestId, errorType: errType, error: msg, ...context });
  }

  recordCircuitFailure(err);
}

// ── enviarNFeSEFAZ ─────────────────────────────────────────────────────────

export async function enviarNFeSEFAZ(
  xmlAssinado: string,
  uf: string,
  ambiente: '1' | '2',
  certPem?: string,
  certKey?: string
): Promise<NFeRetornoSEFAZ> {
  // HOMOLOGATION GUARD — bloqueia qualquer tentativa de transmissão real ao SEFAZ.
  // Deve ser a PRIMEIRA verificação antes de qualquer lógica de transmissão.
  const { validateFiscalHomologationLock } = await import('../../core/fiscal/homologation.guard');
  validateFiscalHomologationLock(ambiente, undefined, 'enviarNFeSEFAZ');

  // T1206 — fiscal correlation ID for all logs in this call
  const fiscalRequestId = randomUUID();

  const sefazMode = (process.env.NFE_SEFAZ_MODE ?? 'mock').toLowerCase();
  if (sefazMode === 'mock') {
    console.info('[NFE_SEFAZ_MOCK]', { fiscalRequestId, uf, ambienteRequest: ambiente });
    const mock = mockResponse();
    emitFiscalEvent({ kind: 'emission_ok', requestId: fiscalRequestId, uf, ambiente: ambiente === '1' ? 'producao' : 'homologacao', cStat: mock.cStat, xMotivo: mock.xMotivo, durationMs: 0 });
    return mock;
  }

  // T1204 — circuit breaker check
  checkCircuit();

  // T1202 — validate XML before transmission (guard #1: signed XML must be valid)
  validateXmlBeforeSend(xmlAssinado, {
    kind: 'nfe',
    requestId: fiscalRequestId,
    context: `uf=${uf} amb=${ambiente}`,
  });

  // FASE 1.8 — Validação XSD LOCAL contra schema NF-e 4.00 oficial.
  // Roda ANTES do SOAP e da transmissão — evita usar SEFAZ como validador.
  // Se inválido: salva artifacts, loga erros, lança erro estruturado (não transmite).
  console.info('[NFE_XSD_VALIDATION_START]', { fiscalRequestId });
  try {
    const { validateNFeSchema, saveNFeDebugArtifacts } = await import('./nfeXsdValidator');
    const xsdResult = validateNFeSchema(xmlAssinado);

    // Salvar signed-nfe.xml e xsd-errors.json independente do resultado
    void saveNFeDebugArtifacts({ signedXml: xmlAssinado, xsdResult });

    if (xsdResult.valid) {
      console.info('[NFE_XSD_VALIDATION_OK]', {
        fiscalRequestId,
        durationMs: xsdResult.durationMs,
        xmlLength: xmlAssinado.length,
      });
    } else {
      console.error('[NFE_XSD_VALIDATION_FAILED]', {
        fiscalRequestId,
        durationMs: xsdResult.durationMs,
        errorCount: xsdResult.errors.length,
        errors: xsdResult.errors.map(e => ({
          msg: e.message.substring(0, 200),
          line: e.line,
          col: e.column,
        })),
      });
      // NÃO transmite — lança erro estruturado que a rota captura
      const firstError = xsdResult.errors[0];
      const err = new Error(
        `NFE_XSD_INVALID: ${firstError?.message ?? 'Schema NF-e 4.00 inválido'} (${xsdResult.errors.length} erro(s))`,
      );
      (err as any).code = 'NFE_XSD_INVALID';
      (err as any).xsdErrors = xsdResult.errors;
      throw err;
    }
  } catch (xsdErr: any) {
    if (xsdErr?.code === 'NFE_XSD_INVALID') throw xsdErr;
    // Falha na inicialização do validator — logar e continuar (fail-open)
    console.warn('[NFE_XSD_VALIDATOR_UNAVAILABLE]', {
      fiscalRequestId,
      error: xsdErr?.message,
    });
  }

  const ambienteXml = detectarAmbienteFromXml(xmlAssinado);
  const ambienteFinal: '1' | '2' = ambienteXml ?? ambiente;
  if (ambienteXml && ambienteXml !== ambiente) {
    console.warn('[NFE_SEFAZ_AMBIENTE_DIVERGENTE]', {
      fiscalRequestId,
      ambienteParametro: ambiente,
      ambienteXml,
      decisao: `usando tpAmb do XML (${ambienteFinal})`,
    });
  }

  const ufXml = detectarUfFromXml(xmlAssinado);
  const ufFinal = (ufXml || uf || 'SP').toUpperCase();
  if (ufXml && uf && ufXml.toUpperCase() !== uf.toUpperCase()) {
    console.warn('[NFE_SEFAZ_UF_DIVERGENTE]', {
      fiscalRequestId,
      ufParametro: uf,
      ufXml,
      decisao: `usando UF do XML (${ufXml})`,
    });
  }

  if (!SEFAZ_URL[ufFinal]) {
    console.warn('[NFE_SEFAZ_FALLBACK_UF]', { fiscalRequestId, uf: ufFinal, usando: 'default (GO)' });
  }

  const url = getSefazUrl(ufFinal, ambienteFinal);
  if (!url) throw new Error(`SEFAZ não configurada para UF: ${ufFinal}`);

  console.info('[NFE_SEFAZ_DISPATCH]', {
    fiscalRequestId,
    uf: ufFinal,
    ambiente: ambienteFinal === '1' ? 'producao' : 'homologacao',
    url,
  });

  emitFiscalEvent({
    kind: 'emission_start',
    requestId: fiscalRequestId,
    uf: ufFinal,
    ambiente: ambienteFinal === '1' ? 'producao' : 'homologacao',
  });

  const idLote = String(Date.now()).slice(-15);
  const soap = buildSoap(xmlAssinado, idLote);

  // LOG: preview do SOAP enviado (sem certificado/chave — apenas estrutura XML)
  // Essencial para diagnosticar cStat=225 (falha schema). Log truncado para
  // não expor dados fiscais completos em produção.
  console.info('[NFE_SOAP_PREVIEW]', {
    fiscalRequestId,
    soapLength: soap.length,
    soapHead: soap.substring(0, 600),
  });

  // FASE 1.8 — Salvar artifact soap-request.xml para debug
  try {
    const { saveNFeDebugArtifacts } = await import('./nfeXsdValidator');
    void saveNFeDebugArtifacts({ soapRequest: soap });
  } catch { /* best-effort */ }

  let pem = certPem;
  let key = certKey;

  if (!pem || !key) {
    try {
      const { getCertificadoDinamico } = await import('./nfeCertDynamic');
      const dynamic = await getCertificadoDinamico();
      if (dynamic) {
        const { getCertificado } = await import('./nfeCert');
        const bundle = getCertificado({ pfxBuffer: dynamic.pfx, password: dynamic.passphrase, source: 'database' });
        pem = bundle.certPem;
        key = bundle.keyPem;
        console.info('[NFE_CERT_FROM_DB]', { fiscalRequestId, tenantId: dynamic.tenantId });
      }
    } catch (e: any) {
      console.warn('[NFE_CERT_DB_LOAD_FAIL]', { fiscalRequestId, error: e?.message });
    }
  }

  if ((!pem || !key) && (process.env.NFE_CERT_PATH || process.env.NFE_CERT_BASE64 || process.env.CERT_PATH)) {
    try {
      const { getCertificado } = await import('./nfeCert');
      const bundle = getCertificado();
      pem = bundle.certPem;
      key = bundle.keyPem;
      console.info('[NFE_SEFAZ_CERT_FROM_ENV]', { fiscalRequestId, source: bundle.source });
    } catch (e: any) {
      console.warn('[NFE_SEFAZ_CERT_LOAD_FAIL]', { fiscalRequestId, error: e?.message });
    }
  }

  // T1203 — cert expiry check before using the cert
  if (pem) {
    try {
      const certInfo = validateCertExpiry(pem, fiscalRequestId, `uf=${ufFinal}`);
      if (certInfo.willExpireSoon) {
        emitFiscalEvent({
          kind: 'cert_warning',
          requestId: fiscalRequestId,
          uf: ufFinal,
          certDaysLeft: certInfo.daysLeft,
        });
      } else {
        emitFiscalEvent({
          kind: 'cert_ok',
          requestId: fiscalRequestId,
          uf: ufFinal,
          certDaysLeft: certInfo.daysLeft,
        });
      }
    } catch (certErr: any) {
      if (certErr?.message === 'NFE_CERT_EXPIRED') {
        emitFiscalEvent({
          kind: 'cert_expired',
          requestId: fiscalRequestId,
          uf: ufFinal,
          errorMessage: certErr.message,
        });
      }
      throw certErr;
    }
  }

  const nfeTlsStrict = process.env.NFE_TLS_STRICT === 'true';
  const httpsAgent = pem && key
    ? new https.Agent({ cert: pem, key, rejectUnauthorized: nfeTlsStrict })
    : undefined;

  const { withRetry } = await import('../../core/retry/withRetry');

  const _emissionStart = Date.now();
  let responseData: any;
  try {
    const { result } = await withRetry(
      async () => {
        const res = await axios.post(url, soap, {
          headers: {
            'Content-Type': 'application/soap+xml;charset=UTF-8;action="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4/nfeAutorizacaoLote"',
          },
          httpsAgent,
          timeout: 30000,
        });
        return res.data;
      },
      {
        maxAttempts: 3,
        baseDelayMs: 2_000,
        maxDelayMs: 15_000,
        retryable: (err: unknown) => {
          if (axios.isAxiosError(err) && err.response) return false;
          return true;
        },
        onRetry: (attempt, err, delayMs) => {
          const msg = err instanceof Error ? err.message : String(err);
          const errType = classifyAxiosError(err);
          if (errType === 'timeout') {
            console.warn(`[SEFAZ_TIMEOUT]`, { fiscalRequestId, attempt, delayMs, error: msg });
            emitFiscalEvent({ kind: 'sefaz_timeout', requestId: fiscalRequestId, uf: ufFinal, errorMessage: msg });
          } else {
            console.warn(`[NFE_SEFAZ_RETRY]`, { fiscalRequestId, attempt, delayMs, errorType: errType, error: msg });
          }
        },
      },
    );
    responseData = result;
  } catch (err) {
    const durationMs = Date.now() - _emissionStart;
    incNfeFailures();
    logSefazError(err, 'NFE_SEFAZ_DISPATCH', fiscalRequestId, { uf: ufFinal, durationMs });
    emitFiscalEvent({
      kind: 'emission_error',
      requestId: fiscalRequestId,
      uf: ufFinal,
      ambiente: ambienteFinal === '1' ? 'producao' : 'homologacao',
      durationMs,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  const emissionMs = Date.now() - _emissionStart;

  // LOG: resposta bruta do SEFAZ — indispensável para diagnosticar cStat=225.
  // Truncado em 2000 chars para não poluir logs em respostas longas.
  const rawStr = typeof responseData === 'string'
    ? responseData
    : JSON.stringify(responseData);
  console.info('[NFE_SEFAZ_RAW_RESPONSE]', {
    fiscalRequestId,
    responseLength: rawStr.length,
    responsePreview: rawStr.substring(0, 2000),
  });

  // FASE 1.8 — Salvar artifact soap-response.xml para debug
  try {
    const { saveNFeDebugArtifacts } = await import('./nfeXsdValidator');
    void saveNFeDebugArtifacts({ soapResponse: rawStr });
  } catch { /* best-effort */ }

  const parsed = parseSefazResponse(responseData);
  recordNfeEmissionDuration(emissionMs);
  recordCircuitSuccess();

  if (parsed.status !== 'autorizada') {
    incNfeFailures();
    emitFiscalEvent({
      kind: 'emission_rejected',
      requestId: fiscalRequestId,
      uf: ufFinal,
      ambiente: ambienteFinal === '1' ? 'producao' : 'homologacao',
      cStat: parsed.cStat,
      xMotivo: parsed.xMotivo,
      chaveNFe: parsed.chaveNFe,
      durationMs: emissionMs,
    });
  } else {
    emitFiscalEvent({
      kind: 'emission_ok',
      requestId: fiscalRequestId,
      uf: ufFinal,
      ambiente: ambienteFinal === '1' ? 'producao' : 'homologacao',
      cStat: parsed.cStat,
      xMotivo: parsed.xMotivo,
      chaveNFe: parsed.chaveNFe,
      durationMs: emissionMs,
    });
  }

  console.info('[NFE_SEFAZ_TIMING]', {
    fiscalRequestId,
    status: parsed.status,
    cStat: parsed.cStat,
    durationMs: emissionMs,
  });
  return parsed;
}

export async function consultarStatusSEFAZ(uf: string, ambiente: '1' | '2'): Promise<{ online: boolean; xMotivo: string }> {
  const urlBase = (SEFAZ_URL[uf.toUpperCase()] || SEFAZ_URL.default);
  const statusUrl = ambiente === '1'
    ? urlBase.producao.replace('NfeAutorizacao4', 'NfeStatusServico4')
    : urlBase.homologacao.replace('NfeAutorizacao4', 'NfeStatusServico4');

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

/**
 * T1102 — Cancelamento REAL na SEFAZ (NFeRecepcaoEvento4, tpEvento=110111).
 */
export async function cancelarNFe(
  chaveNFe: string,
  protocolo: string,
  xJust: string,
  uf: string,
  cnpjEmit: string,
  ambiente: '1' | '2',
): Promise<EventoRetornoSEFAZ> {
  const fiscalRequestId = randomUUID();

  const sefazMode = (process.env.NFE_SEFAZ_MODE ?? 'mock').toLowerCase();
  if (sefazMode !== 'production') {
    console.info('[NFE_CANCEL_MOCK]', { fiscalRequestId, chaveNFe: chaveNFe.slice(0, 8) + '...', uf, ambiente });
    emitFiscalEvent({ kind: 'cancel_ok', requestId: fiscalRequestId, chaveNFe, uf, ambiente: ambiente === '1' ? 'producao' : 'homologacao', cStat: '135' });
    return {
      cStat: '135',
      xMotivo: 'Evento registrado e vinculado a NF-e [MOCK]',
      protocolo: `MOCK-CAN-${Date.now()}`,
      xmlEvento: '',
    };
  }

  // T1204 — circuit breaker
  checkCircuit();

  const now = new Date().toISOString().replace('Z', '-03:00').slice(0, 25);
  const nSeqEvento = '01';
  const tpEvento = '110111';
  const cOrgao = chaveNFe.slice(0, 2);
  const infEventoId = `ID${tpEvento}${chaveNFe}${nSeqEvento}`;
  const cnpjLimpo = cnpjEmit.replace(/\D/g, '');

  const infEventoXml =
    `<infEvento Id="${infEventoId}">` +
    `<cOrgao>${cOrgao}</cOrgao>` +
    `<tpAmb>${ambiente}</tpAmb>` +
    `<CNPJ>${cnpjLimpo}</CNPJ>` +
    `<chNFe>${chaveNFe}</chNFe>` +
    `<dhEvento>${now}</dhEvento>` +
    `<tpEvento>${tpEvento}</tpEvento>` +
    `<nSeqEvento>${nSeqEvento}</nSeqEvento>` +
    `<verEvento>1.00</verEvento>` +
    `<detEvento versao="1.00">` +
    `<descEvento>Cancelamento</descEvento>` +
    `<nProt>${protocolo}</nProt>` +
    `<xJust>${xJust.slice(0, 255)}</xJust>` +
    `</detEvento>` +
    `</infEvento>`;

  const idLote = String(Date.now()).slice(-15);
  const xmlEvento =
    `<envEvento versao="1.00" xmlns="http://www.portalfiscal.inf.br/nfe">` +
    `<idLote>${idLote}</idLote>` +
    `<evento versao="1.00">${infEventoXml}</evento>` +
    `</envEvento>`;

  let xmlAssinado: string;
  try {
    xmlAssinado = await assinarEventoXml(xmlEvento);
  } catch (e: any) {
    throw new Error(`NFE_CANCEL_SIGN_FAIL: ${e.message}`);
  }

  // T1202 — validate signed event XML before transmission
  validateXmlBeforeSend(xmlAssinado, {
    kind: 'evento',
    requestId: fiscalRequestId,
    context: `chaveNFe=${chaveNFe.slice(0, 8)}... cancel`,
  });

  const url = getEventoUrl(uf, ambiente);
  const soap = buildEventoSoap(xmlAssinado);
  const httpsAgent = await resolverHttpsAgent();

  console.info('[NFE_CANCEL_DISPATCH]', {
    fiscalRequestId,
    uf,
    ambiente: ambiente === '1' ? 'producao' : 'homologacao',
    url,
  });

  const { withRetry } = await import('../../core/retry/withRetry');
  const _start = Date.now();
  try {
    const { result } = await withRetry(
      async () => {
        const res = await axios.post(url, soap, {
          headers: {
            'Content-Type': 'application/soap+xml;charset=UTF-8;action="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEvento"',
          },
          httpsAgent,
          timeout: 30000,
        });
        return res.data;
      },
      {
        maxAttempts: 3,
        baseDelayMs: 2_000,
        maxDelayMs: 15_000,
        retryable: (err: unknown) => !(axios.isAxiosError(err) && err.response),
        onRetry: (attempt, err, delayMs) => {
          const msg = err instanceof Error ? err.message : String(err);
          const errType = classifyAxiosError(err);
          if (errType === 'timeout') {
            console.warn('[SEFAZ_TIMEOUT]', { fiscalRequestId, label: 'cancel', attempt, delayMs, error: msg });
          } else {
            console.warn('[NFE_CANCEL_RETRY]', { fiscalRequestId, attempt, delayMs, error: msg });
          }
        },
      },
    );
    const durationMs = Date.now() - _start;
    const parsed = parseEventoResponse(result as string);
    recordCircuitSuccess();
    emitFiscalEvent({
      kind: 'cancel_ok',
      requestId: fiscalRequestId,
      chaveNFe,
      uf,
      ambiente: ambiente === '1' ? 'producao' : 'homologacao',
      cStat: parsed.cStat,
      xMotivo: parsed.xMotivo,
      durationMs,
    });
    return parsed;
  } catch (err) {
    const durationMs = Date.now() - _start;
    logSefazError(err, 'NFE_CANCEL_DISPATCH', fiscalRequestId, { uf, durationMs });
    emitFiscalEvent({
      kind: 'cancel_error',
      requestId: fiscalRequestId,
      chaveNFe,
      uf,
      durationMs,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * T1103 — CC-e REAL na SEFAZ (NFeRecepcaoEvento4, tpEvento=110110).
 */
export async function enviarCCe(
  chaveNFe: string,
  correcao: string,
  sequencia: number,
  uf: string,
  cnpjEmit: string,
  ambiente: '1' | '2',
): Promise<EventoRetornoSEFAZ> {
  const fiscalRequestId = randomUUID();

  const sefazMode = (process.env.NFE_SEFAZ_MODE ?? 'mock').toLowerCase();
  if (sefazMode !== 'production') {
    console.info('[NFE_CCE_MOCK]', { fiscalRequestId, chaveNFe: chaveNFe.slice(0, 8) + '...', uf, sequencia });
    emitFiscalEvent({ kind: 'cce_ok', requestId: fiscalRequestId, chaveNFe, uf, cStat: '135' });
    return {
      cStat: '135',
      xMotivo: 'Evento registrado e vinculado a NF-e [MOCK]',
      protocolo: `MOCK-CCE-${Date.now()}`,
      xmlEvento: '',
    };
  }

  // T1204 — circuit breaker
  checkCircuit();

  const now = new Date().toISOString().replace('Z', '-03:00').slice(0, 25);
  const nSeqEvento = String(sequencia).padStart(2, '0');
  const tpEvento = '110110';
  const cOrgao = chaveNFe.slice(0, 2);
  const infEventoId = `ID${tpEvento}${chaveNFe}${nSeqEvento}`;
  const cnpjLimpo = cnpjEmit.replace(/\D/g, '');

  const xCondUso =
    'A Carta de Correcao e disciplinada pelo paragrafo 1o-A do art. 7o do Convenio S/N, de 15 de dezembro de 1970 e pode ser utilizada para regularizacao de erro ocorrido na emissao de documento fiscal, desde que o erro nao esteja relacionado com: I - as variaveis que determinam o valor do imposto tais como: base de calculo, aliquota, diferenca de preco, quantidade, valor da operacao ou da prestacao; II - a correcao de dados cadastrais que implique mudanca do remetente ou do destinatario; III - a data de emissao ou de saida.';

  const infEventoXml =
    `<infEvento Id="${infEventoId}">` +
    `<cOrgao>${cOrgao}</cOrgao>` +
    `<tpAmb>${ambiente}</tpAmb>` +
    `<CNPJ>${cnpjLimpo}</CNPJ>` +
    `<chNFe>${chaveNFe}</chNFe>` +
    `<dhEvento>${now}</dhEvento>` +
    `<tpEvento>${tpEvento}</tpEvento>` +
    `<nSeqEvento>${nSeqEvento}</nSeqEvento>` +
    `<verEvento>1.00</verEvento>` +
    `<detEvento versao="1.00">` +
    `<descEvento>Carta de Correcao</descEvento>` +
    `<xCorrecao>${correcao.slice(0, 1000)}</xCorrecao>` +
    `<xCondUso>${xCondUso}</xCondUso>` +
    `</detEvento>` +
    `</infEvento>`;

  const idLote = String(Date.now()).slice(-15);
  const xmlEvento =
    `<envEvento versao="1.00" xmlns="http://www.portalfiscal.inf.br/nfe">` +
    `<idLote>${idLote}</idLote>` +
    `<evento versao="1.00">${infEventoXml}</evento>` +
    `</envEvento>`;

  let xmlAssinado: string;
  try {
    xmlAssinado = await assinarEventoXml(xmlEvento);
  } catch (e: any) {
    throw new Error(`NFE_CCE_SIGN_FAIL: ${e.message}`);
  }

  // T1202 — validate signed event XML before transmission
  validateXmlBeforeSend(xmlAssinado, {
    kind: 'evento',
    requestId: fiscalRequestId,
    context: `chaveNFe=${chaveNFe.slice(0, 8)}... cce seq=${sequencia}`,
  });

  const url = getEventoUrl(uf, ambiente);
  const soap = buildEventoSoap(xmlAssinado);
  const httpsAgent = await resolverHttpsAgent();

  console.info('[NFE_CCE_DISPATCH]', {
    fiscalRequestId,
    uf,
    ambiente: ambiente === '1' ? 'producao' : 'homologacao',
    url,
    sequencia,
  });

  const { withRetry } = await import('../../core/retry/withRetry');
  const _start = Date.now();
  try {
    const { result } = await withRetry(
      async () => {
        const res = await axios.post(url, soap, {
          headers: {
            'Content-Type': 'application/soap+xml;charset=UTF-8;action="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEvento"',
          },
          httpsAgent,
          timeout: 30000,
        });
        return res.data;
      },
      {
        maxAttempts: 3,
        baseDelayMs: 2_000,
        maxDelayMs: 15_000,
        retryable: (err: unknown) => !(axios.isAxiosError(err) && err.response),
        onRetry: (attempt, err, delayMs) => {
          const msg = err instanceof Error ? err.message : String(err);
          const errType = classifyAxiosError(err);
          if (errType === 'timeout') {
            console.warn('[SEFAZ_TIMEOUT]', { fiscalRequestId, label: 'cce', attempt, delayMs, error: msg });
          } else {
            console.warn('[NFE_CCE_RETRY]', { fiscalRequestId, attempt, delayMs, error: msg });
          }
        },
      },
    );
    const durationMs = Date.now() - _start;
    const parsed = parseEventoResponse(result as string);
    recordCircuitSuccess();
    emitFiscalEvent({
      kind: 'cce_ok',
      requestId: fiscalRequestId,
      chaveNFe,
      uf,
      ambiente: ambiente === '1' ? 'producao' : 'homologacao',
      cStat: parsed.cStat,
      xMotivo: parsed.xMotivo,
      durationMs,
    });
    return parsed;
  } catch (err) {
    const durationMs = Date.now() - _start;
    logSefazError(err, 'NFE_CCE_DISPATCH', fiscalRequestId, { uf, sequencia, durationMs });
    emitFiscalEvent({
      kind: 'cce_error',
      requestId: fiscalRequestId,
      chaveNFe,
      uf,
      durationMs,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
