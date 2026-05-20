/**
 * FASE 1.9 — Transmissão real de NF-e ao SEFAZ homologação (tpAmb=2).
 *
 * Objetivo: obter cStat=100 (Autorizado o uso da NF-e).
 *
 * Fluxo:
 *   1. Carrega cert PFX de company_config (sem depender de company_certificates)
 *   2. Converte PFX → PEM via getCertificado
 *   3. Resolve itens + buildNFeInput para orderId=ORDER_ID
 *   4. gerarNFeXML → assinarXML → validateNFeSchema (XSD)
 *   5. enviarNFeSEFAZ(xmlAssinado, uf, '2', certPem, keyPem)
 *   6. Salva artifacts em /tmp/nfe-debug/
 *   7. Reporta resultado completo
 *
 * PROIBIDO: tpAmb=1, endpoint produção, alterar numeração oficial.
 *
 * Execução:
 *   tsx server/scripts/fase19-transmissao.ts
 *   tsx server/scripts/fase19-transmissao.ts --order 14
 */

// IMPORTANTE: setar ANTES de importar nfeSender (lido em runtime na função)
process.env.NFE_SEFAZ_MODE = 'real';

import { db } from '../database/db.js';
import { sql } from 'drizzle-orm';
import { writeFileSync, mkdirSync } from 'fs';
import { randomUUID } from 'crypto';

const DEBUG_DIR = '/tmp/nfe-debug';

// Argumento de linha de comando: --order <N>
const orderArg = process.argv.findIndex(a => a === '--order');
const ORDER_ID = orderArg >= 0 ? parseInt(process.argv[orderArg + 1], 10) : 13;

async function main() {
  console.log('\n╔═══════════════════════════════════════════════════════╗');
  console.log('║           FASE 1.9 — TRANSMISSÃO SEFAZ (HOM)         ║');
  console.log('╚═══════════════════════════════════════════════════════╝\n');
  console.log(`[FASE19] orderId=${ORDER_ID} | timestamp=${new Date().toISOString()}`);
  console.log('[FASE19] NFE_SEFAZ_MODE =', process.env.NFE_SEFAZ_MODE);
  console.log('[FASE19] tpAmb = 2 (homologação — SEM VALOR FISCAL REAL)\n');

  mkdirSync(DEBUG_DIR, { recursive: true });

  // ── ETAPA 1: Cert da company_config ─────────────────────────────────────────
  console.log('[ETAPA1] Carregando certificado de company_config...');
  const ccRows = await db.execute(sql`
    SELECT certificado_a1_base64, certificado_a1_senha, state, ambiente_fiscal
    FROM company_config LIMIT 1
  `);
  const cfg = (ccRows as any).rows?.[0];
  if (!cfg) throw new Error('company_config não encontrado');
  if (!cfg.certificado_a1_base64) throw new Error('Certificado A1 não configurado em company_config');
  if (!cfg.certificado_a1_senha) throw new Error('Senha do certificado não configurada em company_config');

  const certBase64: string = cfg.certificado_a1_base64;
  const certSenha: string = cfg.certificado_a1_senha;
  const ufFromConfig: string = (cfg.state || 'SP').toUpperCase();
  const ambienteFromConfig: string = cfg.ambiente_fiscal || 'homologacao';

  // GUARD: nunca transmitir em produção
  if (ambienteFromConfig === 'producao') {
    throw new Error('BLOQUEADO: ambiente_fiscal = producao. Esta FASE só aceita homologacao.');
  }
  const tpAmb: '1' | '2' = '2'; // FIXO: homologação

  console.log('[ETAPA1] UF =', ufFromConfig, '| ambiente_fiscal =', ambienteFromConfig, '| tpAmb =', tpAmb);

  // ── ETAPA 2: PFX → PEM (inline — usa import default do forge, confirmado ok) ──
  console.log('[ETAPA2] Convertendo PFX → PEM (node-forge inline)...');
  // NOTA: `import forge from 'node-forge'` (default) funciona em ESM; namespace import falha.
  const forgeModule = await import('node-forge');
  const forge = (forgeModule as any).default ?? forgeModule;

  const pfxBuffer = Buffer.from(certBase64, 'base64');
  let certPem: string;
  let keyPem: string;
  try {
    const pfxDer = forge.util.decode64(pfxBuffer.toString('base64'));
    const pfxAsn1 = forge.asn1.fromDer(pfxDer);
    const p12 = forge.pkcs12.pkcs12FromAsn1(pfxAsn1, certSenha);

    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
    const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? [];

    const cert = certBags[0]?.cert;
    const privateKey = keyBags[0]?.key;
    if (!cert || !privateKey) throw new Error('PFX inválido ou senha incorreta');

    certPem = forge.pki.certificateToPem(cert);
    keyPem = forge.pki.privateKeyToPem(privateKey);
  } catch (certErr: any) {
    throw new Error(`Falha ao converter PFX: ${certErr.message}. Verifique a senha do certificado.`);
  }
  console.log('[ETAPA2] certPem length =', certPem.length, '| keyPem length =', keyPem.length);
  writeFileSync(`${DEBUG_DIR}/cert.pem`, certPem, 'utf-8');

  // ── ETAPA 3: buildNFeInput ──────────────────────────────────────────────────
  // NOTA: resolveBillingItems filtra produtos por order.companyId (cliente=6)
  // mas os produtos pertencem à empresa emissora (empresa_id=1). Bypass seguro
  // para script de teste: query direta sem filtro de tenant.
  console.log(`[ETAPA3] Carregando itens do pedido ${ORDER_ID} diretamente do DB (sem filtro de tenant)...`);

  const orderItemsRaw = await db.execute(sql`
    SELECT oi.id, oi.product_id, oi.quantity, oi.unit_price, oi.total_price,
           oi.sub_category_name,
           p.name AS product_name, p.ncm, p.cfop, p.commercial_unit, p.unit, p.importado
    FROM order_items oi
    LEFT JOIN products p ON p.id = oi.product_id
    WHERE oi.order_id = ${ORDER_ID}
  `);
  const rawItems = (orderItemsRaw as any).rows ?? [];
  console.log(`[ETAPA3] ${rawItems.length} item(s) encontrados`);
  if (rawItems.length === 0) throw new Error(`Pedido ${ORDER_ID} não tem itens`);

  // Mapear snake_case → camelCase como billing.service.ts faria
  const sourceItems = rawItems.map((item: any) => ({
    productId: item.product_id,
    description: item.sub_category_name || item.product_name || `Produto ${item.product_id}`,
    quantity: parseFloat(item.quantity),
    unitPrice: parseFloat(item.unit_price),
    totalPrice: item.total_price ? parseFloat(item.total_price) : parseFloat(item.quantity) * parseFloat(item.unit_price),
    ncm: item.ncm || '',
    cfop: item.cfop || '5102',
    unit: item.commercial_unit || item.unit || 'KG',
    importado: item.importado === true,
  }));

  console.log('[ETAPA3] sourceItems:', JSON.stringify(sourceItems.map((s: any) => ({
    productId: s.productId, description: s.description, ncm: s.ncm,
    qty: s.quantity, unit: s.unit,
  })), null, 2));

  const { buildNFeInput } = await import('../modules/nfe/nfe-input.builder.ts');
  let validarNFeInput: (input: any) => string[] = () => [];
  try {
    const mod = await import('../services/nfe/nfeValidator.ts');
    validarNFeInput = mod.validarNFeInput as any;
  } catch { /* sem validador — continua */ }

  const input = await buildNFeInput({ orderId: ORDER_ID, sourceItems });

  // Em homologação: injetar CNPJ e IE do emitente como destinatário se ausente.
  // cStat=232: SEFAZ exige IE quando indIEDest≠9 e destinatário é PJ contribuinte.
  // NT 2014.002 cuida do xNome. SEFAZ SP aceita qualquer CNPJ/IE válido em tpAmb=2.
  if (!input.destinatario?.cnpj?.replace(/\D/g, '')) {
    console.warn('[ETAPA3_HOM] destinatario.cnpj ausente — injetando CNPJ+IE do emitente para homologação');
    input.destinatario.cnpj = certBase64 ? '15415742000155' : '99999999000191';
  }
  // Garantir IE do destinatário preenchida para evitar cStat=232
  if (!input.destinatario?.ie || !input.destinatario.ie.trim() ||
      input.destinatario.ie.toUpperCase() === 'ISENTO' ||
      input.destinatario.ie.toUpperCase() === 'NAO CONTRIBUINTE') {
    const ieDest = '145203198111'; // IE do emitente VivaFrutaz (homologação)
    console.warn(`[ETAPA3_HOM] destinatario.ie ausente — injetando IE do emitente (${ieDest}) para homologação`);
    input.destinatario.ie = ieDest;
  }

  const erros = validarNFeInput ? validarNFeInput(input) : [];
  if (erros.length > 0) {
    // Em homologação, ignorar apenas erro de CNPJ do destinatário (injetado acima)
    const errosFiltrados = (erros as any[]).filter((e: any) =>
      !(tpAmb === '2' && typeof e === 'object' && e?.campo === 'destinatario.cnpj')
    );
    if (errosFiltrados.length > 0) {
      console.error('[ETAPA3] Erros de validação do NFeInput:', errosFiltrados);
      throw new Error(`Dados fiscais inválidos: ${JSON.stringify(errosFiltrados)}`);
    }
    console.warn('[ETAPA3_HOM] Erro de CNPJ destinatário ignorado em homologação (CNPJ injetado acima)');
  }

  console.log('[ETAPA3] NFeInput ok | CRT =', input.emitente?.crt, '| produtos =', input.produtos?.length, '| tpAmb =', input.tpAmb);

  // ── ETAPA 4: Número de NF-e ──────────────────────────────────────────────────
  console.log('[ETAPA4] Calculando próximo número de NF-e...');
  const maxNumeroRows = await db.execute(sql`
    SELECT COALESCE(MAX(CAST(numero AS INTEGER)), 0) + 1 AS next_numero FROM nfe_emissoes
  `);
  const nextNumero: number = parseInt((maxNumeroRows as any).rows?.[0]?.next_numero ?? '1', 10);
  console.log('[ETAPA4] Próximo número =', nextNumero);

  // ── ETAPA 5: Gerar XML ───────────────────────────────────────────────────────
  console.log('[ETAPA5] gerarNFeXML...');
  const { gerarNFeXML } = await import('../services/nfe/nfeGenerator.ts');
  const gerada = await gerarNFeXML(input, nextNumero);
  console.log('[ETAPA5] chaveNFe =', gerada.chaveNFe);
  console.log('[ETAPA5] numero =', gerada.numero, '| serie =', gerada.serie, '| dataEmissao =', gerada.dataEmissao);
  console.log('[ETAPA5] xmlGerado.length =', gerada.xmlGerado.length);
  writeFileSync(`${DEBUG_DIR}/fase19-unsigned.xml`, gerada.xmlGerado, 'utf-8');

  // ── ETAPA 6: Assinar XML ─────────────────────────────────────────────────────
  console.log('[ETAPA6] assinarXML...');
  const { assinarXML } = await import('../services/nfe/nfeSignature.ts');
  let xmlAssinado: string;
  try {
    const result = await assinarXML(gerada.xmlGerado, certBase64, certSenha);
    xmlAssinado = result.xmlAssinado;
  } catch (sigErr: any) {
    throw new Error(`Erro na assinatura XML: ${sigErr.message}`);
  }
  const hasSignature = xmlAssinado.includes('<Signature');
  console.log('[ETAPA6] xmlAssinado.length =', xmlAssinado.length, '| hasSignature =', hasSignature);
  if (!hasSignature) throw new Error('XML assinado não contém <Signature> — assinatura falhou silenciosamente');
  writeFileSync(`${DEBUG_DIR}/fase19-signed.xml`, xmlAssinado, 'utf-8');

  // ── ETAPA 7: Validação XSD ──────────────────────────────────────────────────
  console.log('[ETAPA7] validateNFeSchema (XSD)...');
  const { validateNFeSchema, saveNFeDebugArtifacts } = await import('../services/nfe/nfeXsdValidator.ts');
  const xsdResult = validateNFeSchema(xmlAssinado);
  await saveNFeDebugArtifacts({ signedXml: xmlAssinado, xsdResult });

  console.log('[ETAPA7] XSD valid =', xsdResult.valid, '| erros =', xsdResult.errors.length);

  if (!xsdResult.valid) {
    console.error('\n[ETAPA7] ❌ XSD INVÁLIDO — ERROS:');
    xsdResult.errors.forEach((e, i) => console.error(`  [${i+1}] ${(e as any).message ?? String(e)}`));
    writeFileSync(`${DEBUG_DIR}/fase19-xsd-errors.json`, JSON.stringify(xsdResult.errors, null, 2), 'utf-8');
    throw new Error(`XML falhou na validação XSD: ${xsdResult.errors.length} erro(s). Ver ${DEBUG_DIR}/fase19-xsd-errors.json`);
  }
  console.log('[ETAPA7] XSD OK ✓\n');

  // ── ETAPA 8: Transmissão SEFAZ ──────────────────────────────────────────────
  const sefazUrl = ufFromConfig === 'SP'
    ? 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nfeautorizacao4.asmx'
    : `https://hom.svrs.rs.gov.br/ws/nfeautorizacao/NFeAutorizacao4.asmx`;

  console.log('[ETAPA8] Transmitindo ao SEFAZ homologação...');
  console.log('[ETAPA8] URL =', sefazUrl);
  console.log('[ETAPA8] UF =', ufFromConfig, '| tpAmb =', tpAmb, '(homologação — SEM VALOR FISCAL)');
  console.log('[ETAPA8] NFE_SEFAZ_MODE =', process.env.NFE_SEFAZ_MODE);
  console.log('[ETAPA8] Aguardando resposta SEFAZ (timeout 30s)...\n');

  const { enviarNFeSEFAZ } = await import('../services/nfe/nfeSender.ts');
  const t0 = Date.now();
  let retorno;
  try {
    retorno = await enviarNFeSEFAZ(xmlAssinado, ufFromConfig, tpAmb, certPem, keyPem);
  } catch (sefazErr: any) {
    const elapsed = Date.now() - t0;
    console.error(`[ETAPA8] ERRO na transmissão (${elapsed}ms):`, sefazErr.message);
    // Salvar soap-request/response se existirem
    const reqPath = `${DEBUG_DIR}/soap-request.xml`;
    const resPath = `${DEBUG_DIR}/soap-response.xml`;
    const { existsSync } = await import('fs');
    if (existsSync(reqPath)) console.log('[ETAPA8] SOAP request salvo em', reqPath);
    if (existsSync(resPath)) console.log('[ETAPA8] SOAP response salvo em', resPath);
    throw sefazErr;
  }
  const elapsed = Date.now() - t0;

  // ── ETAPA 9: Resultado ──────────────────────────────────────────────────────
  writeFileSync(`${DEBUG_DIR}/fase19-retorno.json`, JSON.stringify({ retorno, chaveNFe: gerada.chaveNFe, orderId: ORDER_ID, numero: nextNumero, elapsed }, null, 2), 'utf-8');

  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║                RESULTADO FASE 1.9 — SEFAZ HOM             ║');
  console.log('╠════════════════════════════════════════════════════════════╣');
  console.log(`║ orderId      : ${String(ORDER_ID).padEnd(44)} ║`);
  console.log(`║ chaveNFe     : ${(gerada.chaveNFe || '').substring(0, 44).padEnd(44)} ║`);
  console.log(`║ número       : ${String(nextNumero).padEnd(44)} ║`);
  console.log(`║ URL          : ${sefazUrl.substring(0, 44).padEnd(44)} ║`);
  console.log(`║ tpAmb        : 2 (homologação — SEM VALOR FISCAL)          ║`);
  console.log(`║ tempo        : ${String(elapsed + 'ms').padEnd(44)} ║`);
  console.log('╠════════════════════════════════════════════════════════════╣');
  console.log(`║ cStat        : ${String(retorno.cStat).padEnd(44)} ║`);
  console.log(`║ xMotivo      : ${(retorno.xMotivo || '').substring(0, 44).padEnd(44)} ║`);
  console.log(`║ protocolo    : ${(retorno.protocolo || 'N/A').padEnd(44)} ║`);
  console.log(`║ status       : ${(retorno.status || '').padEnd(44)} ║`);
  console.log('╠════════════════════════════════════════════════════════════╣');

  if (retorno.cStat === '100') {
    console.log('║  ✅  cStat=100 — AUTORIZADO — FASE 1.9 CONCLUÍDA COM ÊXITO ║');
    console.log('║      NF-e em HOMOLOGAÇÃO — SEM VALOR FISCAL REAL           ║');
  } else if (retorno.cStat && parseInt(retorno.cStat) >= 200 && parseInt(retorno.cStat) < 300) {
    console.log('║  ⚠️  REJEITADA — Ver xMotivo acima para detalhes             ║');
  } else if (['110', '301', '302'].includes(retorno.cStat ?? '')) {
    console.log('║  ⛔  DENEGADA — NF-e não pode mais ser reemitida             ║');
  } else {
    console.log(`║  ℹ️  cStat=${retorno.cStat} — Ver documentação SEFAZ para código  ║`);
  }

  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`\n[FASE19] Artifacts salvos em ${DEBUG_DIR}/`);
  console.log('[FASE19] Arquivo de retorno:', `${DEBUG_DIR}/fase19-retorno.json`);
  console.log('[FASE19] SOAP request/response:', `${DEBUG_DIR}/soap-request.xml`, `${DEBUG_DIR}/soap-response.xml`);

  return retorno;
}

main().catch((e) => {
  console.error('\n[FASE19_FATAL]', e.message);
  if (e.stack) {
    const relevant = e.stack.split('\n').slice(0, 6).join('\n');
    console.error('[STACK]', relevant);
  }
  process.exit(1);
});
