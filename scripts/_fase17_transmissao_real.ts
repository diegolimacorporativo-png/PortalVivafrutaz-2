/**
 * FASE 1.7 — PRIMEIRA TRANSMISSÃO REAL SEFAZ HOMOLOGAÇÃO
 *
 * Pedido: ID=6 (SEED-OP-005) | R$ 930,00 | 1 item (Banana)
 * Banco:  SUPABASE_DATABASE_URL (pg direto — READ/WRITE apenas em nfe_emissoes e orders)
 * tpAmb:  2 (HOMOLOGAÇÃO OBRIGATÓRIO — nunca altera)
 * SEFAZ:  endpoint real SP homologação (SOAP 1.2 direto via axios)
 *
 * ROLLBACK LÓGICO: qualquer falha para sem persistir estado parcial.
 * NÃO SIMULA. NÃO MOCKA. NÃO ESCONDE ERROS.
 */

import { Client } from 'pg';
import { createRequire } from 'module';
import * as fs from 'fs';
import * as SignedXml from 'xml-crypto';
import { validarNFeInput } from '../server/services/nfe/nfeValidator';
import { gerarNFeXML }     from '../server/services/nfe/nfeGenerator';
import type { NFeInput }   from '../server/services/nfe/nfeValidator';

// CJS modules — createRequire evita problema ESM/CJS
const _require = createRequire(import.meta.url);
const forge    = _require('node-forge') as typeof import('node-forge');
const https    = _require('https')    as typeof import('https');
const http     = _require('http')     as typeof import('http');

// ── helpers ───────────────────────────────────────────────────────────────

const TS = () => new Date().toISOString();
function ok(msg: string)        { console.log(`  ✓ [${TS()}] ${msg}`); }
function fail(msg: string)      { console.log(`  ✗ [${TS()}] ${msg}`); }
function info(msg: string)      { console.log(`  · ${msg}`); }
function section(t: string)     { console.log(`\n${'═'.repeat(62)}\n  ${t}\n${'─'.repeat(62)}`); }

function safeStr(v: any, fallback = ''): string {
  const s = (v != null ? String(v) : '').trim().replace(/\s{2,}/g, ' ');
  return s || fallback;
}
function safeOpt(v: any): string | undefined {
  const s = (v != null ? String(v) : '').trim();
  return s || undefined;
}

const IBGE_FALLBACK: Record<string, string> = {
  'sao paulo': '3550308', 'são paulo': '3550308',
  'rio de janeiro': '3304557', 'belo horizonte': '3106200',
  'curitiba': '4106902',   'porto alegre': '4314902',
};

async function fetchIbge(cep: string, city: string): Promise<string> {
  const c = cep.replace(/\D/g, '');
  if (c.length === 8) {
    try {
      const r = await fetch(`https://viacep.com.br/ws/${c}/json/`);
      if (r.ok) { const d: any = await r.json(); if (d.ibge) return String(d.ibge); }
    } catch {}
  }
  const key  = city.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const code = IBGE_FALLBACK[key] || IBGE_FALLBACK[city.toLowerCase()];
  if (!code) throw new Error(`NFE_INVALID_IBGE_CODE: cidade="${city}" cep="${cep}"`);
  return code;
}

// ── SOAP helpers (mesma lógica de nfeSender.ts) ───────────────────────────

const SEFAZ_URL_SP_HOM = 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nfeautorizacao4.asmx';

function buildSoap(xmlNFe: string, idLote: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ` +
    `xmlns:xsd="http://www.w3.org/2001/XMLSchema" ` +
    `xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">` +
    `<soap12:Header>` +
      `<nfeCabecMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4">` +
        `<cUF>35</cUF><versaoDados>4.00</versaoDados>` +
      `</nfeCabecMsg>` +
    `</soap12:Header>` +
    `<soap12:Body>` +
      `<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4">` +
        `<enviNFe versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">` +
          `<idLote>${idLote}</idLote><indSinc>1</indSinc>${xmlNFe}` +
        `</enviNFe>` +
      `</nfeDadosMsg>` +
    `</soap12:Body>` +
    `</soap12:Envelope>`;
}

interface RetornoSEFAZ {
  status: 'autorizada' | 'rejeitada' | 'denegada' | 'erro';
  cStat: string;
  xMotivo: string;
  protocolo?: string;
  chaveNFe?: string;
  dataAutorizacao?: string;
  xmlAutorizado?: string;
  soapResponse: string;
}

function parseSefaz(responseXml: string): RetornoSEFAZ {
  // Prioridade: cStat/xMotivo do <infProt> (resposta real da NF-e) antes do outer <retEnviNFe>
  // cStat=104 "Lote processado" é do outer — o cStat real da NF-e está em <infProt>
  const infProtMatch = responseXml.match(/<infProt>([\s\S]*?)<\/infProt>/);
  const infProt = infProtMatch?.[1] ?? '';

  const cStat   = (infProt.match(/<cStat>(\d+)<\/cStat>/) ?? responseXml.match(/<cStat>(\d+)<\/cStat>/))?.[1] ?? '999';
  const xMotivo = (infProt.match(/<xMotivo>([^<]+)<\/xMotivo>/) ?? responseXml.match(/<xMotivo>([^<]+)<\/xMotivo>/))?.[1] ?? 'Sem resposta';
  const protocolo  = responseXml.match(/<nProt>(\d+)<\/nProt>/)?.[1];
  const chaveNFe   = responseXml.match(/<chNFe>(\d{44})<\/chNFe>/)?.[1];
  const dataAut    = responseXml.match(/<dhRecbto>([^<]+)<\/dhRecbto>/)?.[1];
  const cStatOuter = responseXml.match(/<cStat>(\d+)<\/cStat>/)?.[1] ?? '999';

  let status: RetornoSEFAZ['status'] = 'erro';
  if (cStat === '100')                                       status = 'autorizada';
  else if (['110','301','302'].includes(cStat))              status = 'denegada';
  else if (parseInt(cStat) >= 200 && parseInt(cStat) < 300) status = 'rejeitada';

  return { status, cStat, xMotivo, protocolo, chaveNFe, dataAutorizacao: dataAut, soapResponse: responseXml,
           _cStatOuter: cStatOuter } as any;
}

// ── main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n' + '█'.repeat(62));
  console.log('  FASE 1.7 — TRANSMISSÃO REAL SEFAZ HOMOLOGAÇÃO');
  console.log('  ' + new Date().toISOString());
  console.log('█'.repeat(62));

  const ORDER_ID   = 6;
  const TPAMB: '1' | '2' = '2'; // HOMOLOGAÇÃO — NUNCA ALTERAR

  const db = new Client({
    connectionString: process.env.SUPABASE_DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await db.connect();
  info(`Supabase conectado — ${TS()}`);

  // ────────────────────────────────────────────────────────────────────
  section('ETAPA 1 — AUDITORIA READ ONLY');
  // ────────────────────────────────────────────────────────────────────

  const cfgRes = await db.query(
    `SELECT cnpj, company_name, fantasy_name, state_registration, state, city,
            cep, address, address_number, neighborhood, phone,
            regime_tributario, default_cfop, ambiente_fiscal,
            certificado_a1_base64, certificado_a1_senha, certificado_a1_nome
     FROM company_config LIMIT 1`
  );
  const cfg = cfgRes.rows[0];
  if (!cfg)                          throw new Error('[ROLLBACK] company_config não encontrada');
  if (!cfg.certificado_a1_base64)    throw new Error('[ROLLBACK] certificado_a1_base64 ausente');
  if (!cfg.certificado_a1_senha)     throw new Error('[ROLLBACK] certificado_a1_senha ausente');
  if (cfg.ambiente_fiscal !== 'homologacao') throw new Error('[ROLLBACK] ambiente_fiscal não é homologacao');

  info(`Emitente:        ${cfg.company_name} (CNPJ ${cfg.cnpj})`);
  info(`UF:              ${cfg.state} | Cidade: ${cfg.city}`);
  info(`Ambiente fiscal: ${cfg.ambiente_fiscal}`);
  info(`Cert A1:         ${cfg.certificado_a1_nome} | base64_len=${cfg.certificado_a1_base64?.length}`);
  info(`Endpoint SEFAZ:  ${SEFAZ_URL_SP_HOM}`);

  const ordRes = await db.query(
    `SELECT id, order_code, status, workflow_status, fiscal_status, company_id, total_value
     FROM orders WHERE id = $1`, [ORDER_ID]
  );
  const order = ordRes.rows[0];
  if (!order) throw new Error(`[ROLLBACK] Pedido ${ORDER_ID} não encontrado`);
  if (order.fiscal_status !== 'nota_liberada') {
    throw new Error(`[ROLLBACK] fiscal_status="${order.fiscal_status}" — esperado "nota_liberada"`);
  }

  const nfeExist = await db.query(
    `SELECT id, status FROM nfe_emissoes WHERE order_id=$1 AND status='autorizada'`, [ORDER_ID]
  );
  if (nfeExist.rows.length > 0)
    throw new Error(`[ROLLBACK] NF-e autorizada já existe: id=${nfeExist.rows[0].id}`);

  const numRes = await db.query(
    `SELECT COALESCE(MAX(numero::int), 0) + 1 AS proximo FROM nfe_emissoes`
  );
  const NUMERO_NFE = Number(numRes.rows[0].proximo);

  info(`Pedido:          ${order.order_code} | fiscal=${order.fiscal_status} | R$${order.total_value}`);
  info(`Próximo nº NF-e: ${NUMERO_NFE}`);
  ok('ETAPA 1 — Auditoria OK — sem bloqueios');

  // ────────────────────────────────────────────────────────────────────
  section('ETAPA 2 — PREPARAÇÃO DO PEDIDO CANDIDATO');
  // ────────────────────────────────────────────────────────────────────

  const compRes = await db.query(
    `SELECT id, company_name, cnpj, address_street, address_number,
            address_neighborhood, address_city, address_state, address_zip,
            state_registration
     FROM companies WHERE id=$1`, [order.company_id]
  );
  const company = compRes.rows[0];
  if (!company) throw new Error(`[ROLLBACK] Empresa company_id=${order.company_id} não encontrada`);

  const itemsRes = await db.query(
    `SELECT oi.id, oi.product_id, oi.quantity, oi.unit_price, oi.total_price,
            oi.sub_category_name,
            p.name AS product_name, p.ncm, p.cfop, p.unit, p.commercial_unit
     FROM order_items oi
     LEFT JOIN products p ON p.id = oi.product_id
     WHERE oi.order_id=$1`, [ORDER_ID]
  );
  if (itemsRes.rows.length === 0) throw new Error('[ROLLBACK] Pedido sem itens');

  info(`Destinatário: ${company.company_name} (CNPJ ${company.cnpj})`);
  info(`Endereço:     ${company.address_street}, ${company.address_number} — ${company.address_city}/${company.address_state}`);
  for (const it of itemsRes.rows) {
    info(`  Item: "${it.product_name}" ncm=${it.ncm} cfop=${it.cfop} qty=${it.quantity} total=R$${it.total_price}`);
    if (!it.ncm) throw new Error(`[ROLLBACK] Item sem NCM: "${it.product_name}"`);
  }
  ok(`ETAPA 2 — Pedido ${order.order_code} selecionado | ${itemsRes.rows.length} item(ns)`);

  // Desconectar antes das ops pesadas
  await db.end();
  info('Conexão DB pausada — iniciando pipeline...');

  // ────────────────────────────────────────────────────────────────────
  section('ETAPA 3 — PIPELINE DE GERAÇÃO E ASSINATURA');
  // ────────────────────────────────────────────────────────────────────

  const emitIbge = await fetchIbge(cfg.cep || '', cfg.city || '');
  const destIbge = await fetchIbge(company.address_zip || '', company.address_city || '');
  const regime   = cfg.regime_tributario;
  const crt      = regime === 'simples_nacional' ? '1' : regime === 'mei' ? '2' : '3';
  const emitUF   = safeStr(cfg.state);
  const destUF   = safeStr(company.address_state);
  const isSameUF = emitUF && destUF && emitUF === destUF;
  const defCfop  = cfg.default_cfop || (isSameUF ? '5102' : '6102');
  info(`CRT=${crt} | CFOP=${defCfop} | emitUF=${emitUF} destUF=${destUF}`);

  const produtos = itemsRes.rows.map((it, i) => ({
    cProd:  String(it.product_id || it.id),
    xProd:  safeStr(it.product_name || it.sub_category_name, `Produto ${i + 1}`),
    ncm:    safeStr(it.ncm, '08039000'),
    cfop:   safeStr(it.cfop, defCfop),
    uCom:   safeStr(it.commercial_unit || it.unit, 'KG'),
    qCom:   Number(it.quantity)   || 1,
    vUnCom: Number(it.unit_price) || 0,
    vProd:  Number(it.total_price)|| 0,
  }));

  const emitente = {
    cnpj: safeStr(cfg.cnpj), xNome: safeStr(cfg.company_name),
    xFant: safeOpt(cfg.fantasy_name) ?? safeStr(cfg.company_name),
    ie: safeStr(cfg.state_registration), crt,
    logradouro: safeStr(cfg.address), numero: safeStr(cfg.address_number, 'S/N'),
    bairro: safeStr(cfg.neighborhood, 'Centro'),
    xMun: safeStr(cfg.city, 'São Paulo'), cMun: emitIbge,
    uf: emitUF, cep: safeStr((cfg.cep||'00000000').replace(/\D/g,'').padEnd(8,'0')),
    fone: safeStr(cfg.phone),
  };

  const cnpjDest = safeStr(company.cnpj?.replace(/\D/g,''));
  const destinatario = {
    cnpj: cnpjDest || undefined,
    xNome: safeStr(company.company_name, 'Cliente'),
    ie: safeOpt(company.state_registration),
    logradouro: safeStr(company.address_street, 'Endereço não informado'),
    numero: safeStr(company.address_number, 'S/N'),
    bairro: safeStr(company.address_neighborhood, 'Centro'),
    xMun: safeStr(company.address_city, 'São Paulo'), cMun: destIbge,
    uf: destUF || 'SP',
    cep: safeStr((company.address_zip||'00000000').replace(/\D/g,'').padEnd(8,'0')),
  };

  const nfeInput: NFeInput = {
    emitente, destinatario, produtos,
    natOp: 'Venda de mercadoria', serie: '001',
    tpAmb: TPAMB, indPag: '0',
    orderId: ORDER_ID, orderCode: order.order_code,
  };

  // validar
  const erros = validarNFeInput(nfeInput);
  if (erros.length > 0) {
    erros.forEach(e => fail(`${e.campo}: ${e.mensagem}`));
    throw new Error(`[ROLLBACK] validarNFeInput: ${erros.length} erro(s)`);
  }
  ok('validarNFeInput() — zero erros');

  // gerar
  const gerado   = await gerarNFeXML(nfeInput, NUMERO_NFE);
  const xmlGerado = gerado.xmlGerado;
  const chaveNFe  = gerado.chaveNFe;
  if (chaveNFe.length !== 44)          throw new Error('[ROLLBACK] chaveNFe inválida');
  if (xmlGerado.includes('undefined')) throw new Error('[ROLLBACK] XML contém "undefined"');
  if (xmlGerado.includes('NaN'))       throw new Error('[ROLLBACK] XML contém "NaN"');
  if (!xmlGerado.includes('<infNFe'))  throw new Error('[ROLLBACK] <infNFe> ausente');
  ok(`gerarNFeXML() — ${Buffer.byteLength(xmlGerado,'utf8')} bytes | chaveNFe=${chaveNFe}`);

  // assinar — forge via createRequire
  const pfxDer  = forge.util.decode64(Buffer.from(cfg.certificado_a1_base64,'base64').toString('base64'));
  const pfxAsn1 = forge.asn1.fromDer(pfxDer);
  const pfx     = forge.pkcs12.pkcs12FromAsn1(pfxAsn1, cfg.certificado_a1_senha);

  const certBags = pfx.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
  const keyBag   = (pfx.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag]||[])[0];
  if (!certBags.length || !keyBag) throw new Error('[ROLLBACK] PFX inválido ou senha incorreta');

  const certObj  = certBags[0].cert!;
  const certPem  = forge.pki.certificateToPem(certObj);
  const keyPem   = forge.pki.privateKeyToPem(keyBag.key!);
  const certValFim = certObj.validity.notAfter as Date;
  const daysLeft   = Math.floor((certValFim.getTime() - Date.now()) / 86_400_000);
  const cn         = certObj.subject.getField('CN')?.value || '';

  if (new Date() > certValFim) throw new Error('[ROLLBACK] Certificado A1 VENCIDO');
  ok(`Certificado A1: "${cn}" | válido por ${daysLeft} dias`);

  const certDer = certPem.replace('-----BEGIN CERTIFICATE-----','').replace('-----END CERTIFICATE-----','').replace(/\n/g,'');
  const sig = new (SignedXml as any).SignedXml({ privateKey: keyPem, publicCert: certPem });
  sig.addReference({
    xpath: "//*[local-name(.)='infNFe']",
    transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature','http://www.w3.org/2001/10/xml-exc-c14n#'],
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
  });
  sig.canonicalizationAlgorithm = 'http://www.w3.org/2001/10/xml-exc-c14n#';
  sig.signatureAlgorithm        = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
  sig.keyInfoProvider = {
    getKeyInfo: () => `<X509Data><X509Certificate>${certDer}</X509Certificate></X509Data>`,
    getKey:     () => Buffer.from(keyPem),
  };
  // NF-e 4.00 XSD: <Signature> deve ser APÓS </infNFe> mas DENTRO de <NFe>
  // action:'after' insere depois do elemento referenciado (correto); 'append' inseria dentro (bug)
  sig.computeSignature(xmlGerado, { location: { reference: "//*[local-name(.)='infNFe']", action: 'after' } });
  const xmlAssinado    = sig.getSignedXml();
  const tamanhoAssint  = Buffer.byteLength(xmlAssinado, 'utf8');

  // Verificar posição da assinatura no XML
  const sigIdx     = xmlAssinado.indexOf('<Signature');
  const infNFeEnd  = xmlAssinado.indexOf('</infNFe>');
  const nfeEnd     = xmlAssinado.indexOf('</NFe>');
  const sigOk      = sigIdx > infNFeEnd && sigIdx < nfeEnd;
  if (!sigOk) throw new Error(`[ROLLBACK] <Signature> em posição errada: sigIdx=${sigIdx} infNFeEnd=${infNFeEnd} nfeEnd=${nfeEnd}`);

  if (!xmlAssinado.includes('<Signature'))        throw new Error('[ROLLBACK] <Signature> ausente');
  if (!xmlAssinado.includes('<DigestValue>'))     throw new Error('[ROLLBACK] <DigestValue> ausente');
  if (!xmlAssinado.includes('<X509Certificate>')) throw new Error('[ROLLBACK] <X509Certificate> ausente');
  if (xmlAssinado.includes('undefined'))          throw new Error('[ROLLBACK] XML assinado contém "undefined"');
  if (xmlAssinado.includes('NaN'))               throw new Error('[ROLLBACK] XML assinado contém "NaN"');
  ok(`assinarXML() — ${tamanhoAssint} bytes ✓`);
  ok('ETAPA 3 — Pipeline completo ✓');

  // ────────────────────────────────────────────────────────────────────
  section('ETAPA 4 — TRANSMISSÃO REAL SEFAZ HOMOLOGAÇÃO');
  // ────────────────────────────────────────────────────────────────────

  const idLote  = String(Date.now()).slice(-15);
  // CRÍTICO: remover XML declaration antes de embutir no SOAP envelope
  // <?xml...?> embutido dentro de outro XML é inválido → SEFAZ retorna HTTP 400
  const xmlParaSoap = xmlAssinado.replace(/^<\?xml[^?]*\?>\s*/i, '');
  const soap    = buildSoap(xmlParaSoap, idLote);
  info(`XML declaration removida para SOAP: ${xmlAssinado.startsWith('<?xml') ? 'SIM (corrigido)' : 'não estava presente'}`);
  info(`xmlParaSoap primeiros chars: ${xmlParaSoap.slice(0, 120)}`);

  // ── DIAGNÓSTICO: salvar SOAP e XML assinado em /tmp para inspeção ─────────
  try {
    fs.writeFileSync('/tmp/nfe_assinado.xml', xmlAssinado, 'utf8');
    fs.writeFileSync('/tmp/nfe_soap.xml', soap, 'utf8');
    info(`SOAP salvo em /tmp/nfe_soap.xml (${Buffer.byteLength(soap,'utf8')} bytes)`);
    // Imprimir estrutura do XML assinado (sem a assinatura em si)
    const xmlSemSig = xmlAssinado.replace(/<Signature[\s\S]*?<\/Signature>/g, '<Signature>[OMITIDO]</Signature>');
    info(`XML_ASSINADO_ESTRUTURA (${xmlAssinado.length} chars):`);
    for (let i = 0; i * 300 < xmlSemSig.length && i < 15; i++) {
      info(`  XML[${i}]: ${xmlSemSig.slice(i * 300, (i + 1) * 300)}`);
    }
  } catch(e: any) { info(`[WARN] Não foi possível salvar diagnóstico: ${e.message}`); }

  info(`Endpoint:      ${SEFAZ_URL_SP_HOM}`);
  info(`tpAmb no XML:  ${TPAMB} (2 = HOMOLOGAÇÃO — imutável)`);
  info(`idLote:        ${idLote}`);
  info(`SOAP payload:  ${Buffer.byteLength(soap,'utf8')} bytes`);
  info('Iniciando POST SOAP para SEFAZ...');

  const tInicio = Date.now();
  let retorno: RetornoSEFAZ | null = null;
  let erroTransmissao: string | null = null;
  let soapResponseRaw = '';

  // https.request nativo com cert/key direto nas options (provado funcionar em testes anteriores)
  await new Promise<void>((resolve) => {
    const headers: Record<string, string | number> = {
      'Content-Type': 'application/soap+xml;charset=UTF-8;action="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4/nfeAutorizacaoLote"',
      'Content-Length': Buffer.byteLength(soap, 'utf8'),
    };

    const reqOptions = {
      hostname: 'homologacao.nfe.fazenda.sp.gov.br',
      port: 443,
      path: '/ws/nfeautorizacao4.asmx',
      method: 'POST',
      headers,
      cert: certPem,              // cert direto nas options — funciona com https.request
      key: keyPem,
      rejectUnauthorized: false,
      timeout: 45_000,
    };

    const req = https.request(reqOptions, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer | string) => { body += chunk; });
      res.on('end', () => {
        soapResponseRaw = body;
        info(`HTTP status:     ${res.statusCode}`);
        info(`SOAP response (${soapResponseRaw.length} chars):`);
        // Imprimir response em blocos para auditoria completa
        for (let i = 0; i * 400 < soapResponseRaw.length && i < 10; i++) {
          info(`  [${i}] ${soapResponseRaw.slice(i * 400, (i + 1) * 400)}`);
        }

        if ((res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300) {
          retorno = parseSefaz(soapResponseRaw);
        } else {
          const tentativa = parseSefaz(soapResponseRaw);
          if (tentativa.cStat !== '999') {
            info(`Parseu do HTTP ${res.statusCode}: cStat=${tentativa.cStat}`);
            retorno = tentativa;
          } else {
            erroTransmissao = `HTTP ${res.statusCode} body="${soapResponseRaw.slice(0, 200)}"`;
            fail(`SEFAZ retornou HTTP ${res.statusCode}`);
          }
        }
        resolve();
      });
    });

    req.on('error', (err: Error) => {
      erroTransmissao = err.message;
      fail(`TRANSMISSÃO ERRO DE REDE: ${erroTransmissao}`);
      resolve();
    });

    req.setTimeout(45_000, () => {
      erroTransmissao = 'TIMEOUT 45s aguardando SEFAZ';
      fail(erroTransmissao);
      req.destroy();
      resolve();
    });

    req.write(soap);
    req.end();
  });

  const tempoMs = Date.now() - tInicio;
  info(`Tempo de resposta: ${tempoMs}ms`);

  if (retorno) {
    info(`cStat:    ${retorno.cStat}`);
    info(`xMotivo:  ${retorno.xMotivo}`);
    info(`status:   ${retorno.status}`);
    info(`protocolo:${retorno.protocolo ?? '(não retornado)'}`);
    info(`chaveNFe: ${retorno.chaveNFe ?? '(não retornada)'}`);
    info(`dataAut:  ${retorno.dataAutorizacao ?? '(não retornada)'}`);
    info(`SOAP response (${soapResponseRaw.length} chars): ${soapResponseRaw.slice(0, 300)}...`);
    retorno.status === 'autorizada'
      ? ok(`SEFAZ AUTORIZOU — cStat=${retorno.cStat}`)
      : fail(`SEFAZ ${retorno.status?.toUpperCase()} — cStat=${retorno.cStat} "${retorno.xMotivo}"`);
  }

  // ────────────────────────────────────────────────────────────────────
  section('ETAPA 5 — PERSISTÊNCIA');
  // ────────────────────────────────────────────────────────────────────

  const db2 = new Client({ connectionString: process.env.SUPABASE_DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await db2.connect();
  info('DB reconectado para persistência');

  let statusFinal: string;
  let xmlAutorizado: string | null = null;
  let protocolo: string | null     = null;
  let cStat = '999';
  let xMotivo = erroTransmissao || 'Erro de transmissão';
  let dataAutorizacao: string | null = null;

  if (erroTransmissao) {
    statusFinal = 'erro';
  } else {
    statusFinal     = retorno!.status;
    cStat           = retorno!.cStat;
    xMotivo         = retorno!.xMotivo;
    protocolo       = retorno!.protocolo ?? null;
    dataAutorizacao = retorno!.dataAutorizacao ?? null;
    if (retorno!.status === 'autorizada') {
      // O xmlAutorizado completo é o próprio soapResponse que contém o protocolo embutido
      xmlAutorizado = soapResponseRaw || xmlAssinado;
    }
  }

  // INSERT nfe_emissoes
  const nfeRow = await db2.query(
    `INSERT INTO nfe_emissoes
       (order_id, numero, serie, chave_nfe, status, xml_gerado, xml_autorizado,
        protocolo, c_stat, x_motivo, data_emissao, data_autorizacao, ambiente_fiscal)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING id`,
    [
      ORDER_ID, String(NUMERO_NFE), '001', chaveNFe, statusFinal,
      xmlAssinado, xmlAutorizado, protocolo, cStat, xMotivo,
      new Date().toISOString(), dataAutorizacao, 'homologacao',
    ]
  );
  const nfeId = nfeRow.rows[0].id;
  ok(`nfe_emissoes inserido — id=${nfeId} | status=${statusFinal}`);

  // UPDATE orders.fiscal_status
  const novoFiscal =
    statusFinal === 'autorizada' ? 'nota_emitida'   :
    statusFinal === 'rejeitada'  ? 'nota_rejeitada'  :
    'nota_liberada'; // erro de rede: mantém liberada para retry

  await db2.query(`UPDATE orders SET fiscal_status=$1 WHERE id=$2`, [novoFiscal, ORDER_ID]);
  ok(`orders.fiscal_status → "${novoFiscal}"`);

  // ────────────────────────────────────────────────────────────────────
  section('ETAPA 6 — PÓS-VALIDAÇÃO');
  // ────────────────────────────────────────────────────────────────────

  const validar: [string, boolean][] = [];

  const nfePersist = await db2.query(
    `SELECT id, numero, serie, chave_nfe, status, c_stat, x_motivo, protocolo,
            data_emissao, ambiente_fiscal,
            length(xml_gerado) AS xml_len,
            xml_autorizado IS NOT NULL AS tem_xml_autorizado
     FROM nfe_emissoes WHERE id=$1`, [nfeId]
  );
  const row = nfePersist.rows[0];
  info(`NF-e persistida: ${JSON.stringify({ ...row, xml_len: row?.xml_len })}`);

  validar.push(['nfe_emissoes inserida',              !!row]);
  validar.push(['chaveNFe 44 dígitos',                row?.chave_nfe?.length === 44]);
  validar.push(['ambiente_fiscal = homologacao',      row?.ambiente_fiscal === 'homologacao']);
  validar.push(['xml_gerado persistido (> 0 bytes)',  (row?.xml_len || 0) > 0]);
  validar.push(['c_stat persistido',                  !!row?.c_stat]);
  validar.push(['x_motivo persistido',                !!row?.x_motivo]);

  const ordCheck = await db2.query(`SELECT fiscal_status FROM orders WHERE id=$1`, [ORDER_ID]);
  validar.push(['fiscal_status do pedido atualizado', ordCheck.rows[0]?.fiscal_status === novoFiscal]);

  // Assinatura preservada
  const xmlSalvo = (await db2.query(`SELECT xml_gerado FROM nfe_emissoes WHERE id=$1`, [nfeId])).rows[0]?.xml_gerado || '';
  validar.push(['<Signature> no XML salvo',           xmlSalvo.includes('<Signature')]);
  validar.push(['<X509Certificate> no XML salvo',     xmlSalvo.includes('<X509Certificate>')]);

  if (statusFinal === 'autorizada') {
    validar.push(['protocolo persistido',             !!protocolo]);
    validar.push(['xml_autorizado presente',          !!row?.tem_xml_autorizado]);
  } else {
    validar.push(['rejeição / erro persistidos',      !!row?.c_stat]);
    validar.push(['XML não apagado',                  (row?.xml_len || 0) > 0]);
  }

  await db2.end();
  info('Conexão DB encerrada');

  for (const [label, result] of validar) result ? ok(label) : fail(label);

  // ────────────────────────────────────────────────────────────────────
  section('ETAPA 7 — RELATÓRIO FINAL');
  // ────────────────────────────────────────────────────────────────────

  const passCount = validar.filter(([,r]) => r).length;
  const failCount = validar.filter(([,r]) => !r).length;

  console.log('\n  ┌──────────────────────────────────────────────────────┐');
  console.log('  │    RESULTADO TRANSMISSÃO SEFAZ HOMOLOGAÇÃO            │');
  console.log('  ├──────────────────────────────────────────────────────┤');
  const pad = (s: string) => `  │  ${s}`.padEnd(57) + '│';
  console.log(pad(`Pedido:         ${ORDER_ID} — ${order.order_code}`));
  console.log(pad(`NF-e ID:        ${nfeId} | Nº ${NUMERO_NFE} | Série 001`));
  console.log(pad(`chaveNFe:       ${chaveNFe}`));
  console.log(pad(`XML gerado:     ${Buffer.byteLength(xmlGerado,'utf8')} bytes`));
  console.log(pad(`XML assinado:   ${tamanhoAssint} bytes (+${tamanhoAssint - Buffer.byteLength(xmlGerado,'utf8')})`));
  console.log(pad(`Tempo SEFAZ:    ${tempoMs}ms`));
  console.log(pad(`cStat:          ${cStat}`));
  console.log(pad(`xMotivo:        ${xMotivo.slice(0,40)}`));
  console.log(pad(`Protocolo:      ${protocolo ?? '(não disponível)'}`));
  console.log(pad(`Status SEFAZ:   ${statusFinal.toUpperCase()}`));
  console.log(pad(`fiscal_status:  ${novoFiscal}`));
  console.log(pad(`tpAmb:          ${TPAMB} (HOMOLOGAÇÃO — imutável)`));
  console.log(pad(`Cert validade:  ${certValFim.toISOString().slice(0,10)} (${daysLeft} dias)`));
  console.log(pad(`Pós-validações: ${passCount}/${validar.length} aprovadas`));
  console.log('  ├──────────────────────────────────────────────────────┤');

  const resultado =
    failCount === 0 && statusFinal === 'autorizada' ? 'SUCESSO — NF-e AUTORIZADA' :
    statusFinal === 'autorizada'                    ? 'AUTORIZADA (pós-val. parcial)':
    statusFinal === 'rejeitada'                     ? 'REJEITADO SEFAZ (ver cStat)' :
    erroTransmissao                                 ? 'ERRO DE TRANSMISSÃO (ver log)' :
                                                      'INCONCLUSIVO';
  console.log(pad(`RESULTADO:      ${resultado}`));
  console.log('  └──────────────────────────────────────────────────────┘\n');

  if (erroTransmissao) {
    info('RISCOS / PRÓXIMOS PASSOS:');
    info(`  • Erro: ${erroTransmissao}`);
    info('  • nfe_emissoes.status=erro — retry possível');
    info('  • orders.fiscal_status mantido em nota_liberada');
  } else if (statusFinal !== 'autorizada') {
    info('RISCOS / PRÓXIMOS PASSOS:');
    info(`  • SEFAZ retornou cStat=${cStat}: "${xMotivo}"`);
    info('  • Corrigir dado, deletar nfe_emissoes rejeitada, reemitir');
  } else {
    info('RISCOS RESIDUAIS:');
    info(`  • Certificado vence em ${daysLeft} dias (${certValFim.toISOString().slice(0,10)})`);
    info('  • DANFE disponível via /api/nfe/:id/danfe');
  }
  console.log('');
}

main().catch(err => {
  console.error('\n[ERRO FATAL — ROLLBACK LÓGICO]', err.message);
  console.error(err.stack);
  process.exit(1);
});
