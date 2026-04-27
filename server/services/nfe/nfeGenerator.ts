import { v4 as uuidv4 } from 'uuid';
import type { NFeInput } from './nfeValidator';
import { validarCRT } from './nfeValidator';

// UF → cUF IBGE codes
const UF_IBGE: Record<string, string> = {
  AC: '12', AL: '27', AM: '13', AP: '16', BA: '29', CE: '23', DF: '53',
  ES: '32', GO: '52', MA: '21', MG: '31', MS: '50', MT: '51', PA: '15',
  PB: '25', PE: '26', PI: '22', PR: '41', RJ: '33', RN: '24', RO: '11',
  RR: '14', RS: '43', SC: '42', SE: '28', SP: '35', TO: '17',
};

// City → IBGE municipality code (common cities)
const CIDADE_IBGE: Record<string, string> = {
  'SAO PAULO': '3550308', 'SÃO PAULO': '3550308',
  'CAMPINAS': '3509502', 'SANTOS': '3548100', 'SOROCABA': '3552205',
  'GUARULHOS': '3518800', 'OSASCO': '3534401', 'RIBEIRAO PRETO': '3543402',
  'RIBEIRÃO PRETO': '3543402', 'SAO BERNARDO DO CAMPO': '3548708',
  'RIO DE JANEIRO': '3304557', 'BELO HORIZONTE': '3106200',
  'SALVADOR': '2927408', 'FORTALEZA': '2304400', 'CURITIBA': '4106902',
  'MANAUS': '1302603', 'RECIFE': '2611606', 'PORTO ALEGRE': '4314902',
  'BELEM': '1501402', 'GOIANIA': '5208707', 'BRASILIA': '5300108',
  'FLORIANOPOLIS': '4205407', 'JOINVILLE': '4209102',
};

function getMunCode(xMun: string, uf: string): string {
  const key = xMun.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return CIDADE_IBGE[xMun.toUpperCase()] || CIDADE_IBGE[key] || `${UF_IBGE[uf] || '35'}99999`;
}

function pad(n: number | string, length: number, char = '0'): string {
  return String(n).padStart(length, char);
}

function calcCDV(chave43: string): string {
  const digits = chave43.replace(/\D/g, '');
  let weights = [2, 3, 4, 5, 6, 7, 8, 9];
  let sum = 0;
  let wi = 0;
  for (let i = digits.length - 1; i >= 0; i--) {
    sum += parseInt(digits[i]) * weights[wi % 8];
    wi++;
  }
  const rem = sum % 11;
  return rem < 2 ? '0' : String(11 - rem);
}

function gerarChaveNFe(params: {
  cUF: string; aamm: string; cnpj: string; mod: string;
  serie: string; nNF: string; tpEmis: string; cNF: string;
}): string {
  const base43 = `${params.cUF}${params.aamm}${params.cnpj}${params.mod}${params.serie}${params.nNF}${params.tpEmis}${params.cNF}`;
  return base43 + calcCDV(base43);
}

function fmtValor(v: number, dec = 2): string {
  return Number.isFinite(v) ? v.toFixed(dec) : '0.00';
}

// FASE NF.2 — ETAPA 4: formata valor monetário com proteção contra NaN/Infinity
const toMoney = (v: number): string =>
  Number.isFinite(v) ? v.toFixed(2) : '0.00';

// FASE NF.7.5 — UFs cujo destino aplica alíquota interestadual de 7%
// (Norte + Nordeste + Centro-Oeste + Espírito Santo, conforme convênio ICMS).
// Set imutável de propósito — qualquer mudança regulatória passa por aqui.
const UFS_7 = new Set([
  "AC","AL","AM","AP","BA","CE","DF","ES",
  "GO","MA","MT","MS","PA","PB","PE","PI",
  "RN","RO","RR","SE","TO",
]);

// FASE NF.7.6 — heurística inicial (NCM começa em "1"/"2") — gerava falso
// positivo para frutas/sucos (cap. 08/20).
// FASE NF.7.7 — controle real de importação:
//   1) PRIORIDADE ABSOLUTA: flag manual `item.importado === true`
//      (override do operador / cadastro de produto, no futuro);
//   2) Fallback heurístico por capítulo NCM (2 primeiros dígitos)
//      restrito a capítulos tipicamente importados (84/85/87/88/89/90).
// Capítulos 08 (frutas) e 20 (sucos/preparações de hortaliças e frutas)
// — domínio principal do app — saem da regra e seguem alíquota por UF.
// ⚠ Sem TIPI, sem API externa, sem cálculo de conteúdo de importação (%).
const NCM_CAPITULOS_IMPORTADOS_COMUNS = new Set([
  "84", // máquinas mecânicas
  "85", // máquinas elétricas / eletrônicos
  "87", // veículos
  "88", // aeronaves
  "89", // embarcações
  "90", // instrumentos óticos / médicos / precisão
]);

function isProdutoImportado(ncm?: string, item?: any): boolean {
  // 1. PRIORIDADE TOTAL: flag manual no item
  if (item?.importado === true) {
    return true;
  }

  if (!ncm) return false;

  const code = String(ncm).trim();

  // 2. evitar lixo / NCM inválido
  if (code.length < 4) return false;

  // 3. heurística por capítulo (2 primeiros dígitos)
  const capitulo = code.substring(0, 2);
  return NCM_CAPITULOS_IMPORTADOS_COMUNS.has(capitulo);
}

// FASE NF.7.3 — alíquota de ICMS encapsulada num único ponto.
// FASE NF.7.4 — diferenciação interna (mesma UF) × interestadual.
// FASE NF.7.5 — interestadual real (7% N/NE/CO+ES, 12% SE/S exceto ES).
// FASE NF.7.6 — alíquota especial de 4% para produtos importados (Resolução
// 13/2012 do Senado Federal, simplificada). Tem PRIORIDADE sobre a regra de UF
// — produto importado paga 4% mesmo em operação interna ou para UF do bloco 7%.
//
// Ordem das regras:
//   1. fallback seguro (UF origem ou destino ausente) → 18%
//   2. produto importado                             → 4%   ← PRIORIDADE
//   3. mesma UF (interna)                            → 18%
//   4. destino em UFS_7 (N/NE/CO + ES)               → 7%
//   5. demais interestaduais (SE/S exceto ES)        → 12%
//
// ⚠ Sem ST, sem DIFAL — vem nas próximas fases.
function getAliquotaICMS(
  ufOrigem?: string,
  ufDestino?: string,
  ncm?: string,
  item?: any,
): number {
  // 1. fallback seguro
  if (!ufOrigem || !ufDestino) {
    return 18;
  }

  // 2. regra de importado (PRIORIDADE MÁXIMA — vem antes da lógica de UF)
  //    NF.7.7: agora considera flag manual `item.importado` E heurística NCM.
  if (isProdutoImportado(ncm, item)) {
    return 4;
  }

  // normalização defensiva
  const origem = ufOrigem.toUpperCase();
  const destino = ufDestino.toUpperCase();

  // 3. operação interna
  if (origem === destino) {
    return 18;
  }

  // 4. interestadual com regra de 7%
  if (UFS_7.has(destino)) {
    return 7;
  }

  // 5. demais casos interestaduais
  return 12;
}

function sanitizeXml(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .slice(0, 160);
}

// FASE NF.2 — ETAPA 3: pré-normalização de strings antes do sanitizeXml.
// Remove caracteres que quebram estrutura XML, colapsa espaços, faz trim.
// NÃO remove acentos. NÃO altera conteúdo fiscal.
const xmlSafe = (v: any): string =>
  String(v ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[<>&]/g, '');

// FASE NF.2.1 → NF.2.2 — função única de escape XML (hardening defensivo).
// Trata null/undefined, escapa TODOS os 5 caracteres reservados de XML
// (incluindo apóstrofo, crítico para atributos com aspas simples), faz trim
// e colapsa espaços. NÃO remove sanitizeXml/xmlSafe (compat).
function escapeXml(value: any): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;') // FASE NF.2.2 — apóstrofo (CRÍTICO)
    .trim()
    .replace(/\s+/g, ' ');
}

// FASE NF.2.2 — proteção numérica FAIL-FAST. NÃO mascara mais com '0.00'.
// Lança NFE_XML_INVALID_NUMBER com contexto para diagnosticar a origem.
// Aceita decimais para preservar precisão fiscal (qCom=4, vUnCom=10).
function safeNumber(value: any, context: string, decimals = 2): string {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    console.error('[NFE_XML_INVALID_NUMBER]', { context, value });
    throw new Error('NFE_XML_INVALID_NUMBER');
  }
  return num.toFixed(decimals);
}

export interface NFeGerada {
  chaveNFe: string;
  numero: string;
  serie: string;
  xmlGerado: string;
  dataEmissao: string;
}

export async function gerarNFeXML(
  input: NFeInput,
  numero: number
): Promise<NFeGerada> {
  // FASE NF.2 — ETAPA 1: validação de entrada antes de qualquer processamento
  if (!input.emitente?.cnpj?.trim()) throw new Error('NFE_XML_MISSING_EMITENTE');
  if (!input.destinatario?.xNome?.trim()) throw new Error('NFE_XML_MISSING_DESTINATARIO');
  if (!Array.isArray(input.produtos) || input.produtos.length === 0) throw new Error('NFE_XML_NO_ITEMS');
  if (!Number.isFinite(numero) || numero <= 0) throw new Error('NFE_XML_INVALID_NUMBER');

  // FASE NF.2.2 — ETAPA 4: bloqueio explícito de strings vazias em campos obrigatórios.
  if (!input.emitente.xNome?.trim()) throw new Error('NFE_XML_EMPTY_EMITENTE_NOME');
  if (!input.destinatario.xNome?.trim()) throw new Error('NFE_XML_EMPTY_DESTINATARIO');

  const now = new Date();
  const tzOffset = '-03:00';
  const pad2 = (n: number) => pad(n, 2);
  const dhEmi = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}T${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}${tzOffset}`;
  const aamm = `${String(now.getFullYear()).slice(2)}${pad2(now.getMonth() + 1)}`;

  const serie = input.serie || '001';
  const tpAmb = input.tpAmb || '2'; // 2=homologação por padrão
  // FASE NF.5.1 — ETAPA 3: validação CRT sem fallback silencioso.
  // Antes: `input.emitente.crt || '1'` mascarava regime ausente/inválido como Simples.
  // Agora: validarCRT lança NFE_INVALID_CRT se crt não for '1', '2' ou '3'.
  validarCRT(input);
  const crt = input.emitente.crt;
  const uf = input.emitente.uf.toUpperCase();
  const cUF = UF_IBGE[uf] || '35';
  const cnpjEmit = input.emitente.cnpj.replace(/\D/g, '');
  const nNF = pad(numero, 9);
  const cNF = pad(String(Math.floor(Math.random() * 99999999)), 8);

  const chaveNFe = gerarChaveNFe({ cUF, aamm, cnpj: cnpjEmit, mod: '55', serie, nNF, tpEmis: '1', cNF });

  const cMunEmit = input.emitente.cMun || getMunCode(input.emitente.xMun, uf);
  const ufDest = input.destinatario.uf.toUpperCase();
  const cMunDest = input.destinatario.cMun || getMunCode(input.destinatario.xMun, ufDest);

  // Calcular totais
  const vProd = input.produtos.reduce((s, p) => s + p.vProd, 0);
  const vFrete = input.valorFrete || 0;
  const vSeg = input.valorSeguro || 0;
  const vDesc = input.valorDesconto || 0;
  const vNF = vProd + vFrete + vSeg - vDesc;

  // FASE NF.2 — ETAPA 2: validação dos produtos antes de montar o XML
  for (const p of input.produtos) {
    if (!Number.isFinite(p.qCom) || p.qCom <= 0) throw new Error('NFE_XML_INVALID_QCOM');
    if (!Number.isFinite(p.vUnCom) || p.vUnCom <= 0) throw new Error('NFE_XML_INVALID_VUNCOM');
    if (!Number.isFinite(p.vProd) || p.vProd <= 0) throw new Error('NFE_XML_INVALID_VPROD');
  }

  // Gerar itens
  // FASE NF.2 — ETAPA 3/4: xmlSafe aplicado em xProd; toMoney em valores monetários
  const itenXml = input.produtos.map((p, idx) => {
    const ncm = p.ncm.replace(/\D/g, '').slice(0, 8).padEnd(8, '0');
    // FASE NF.5.1 — ETAPA 2: CSOSN realmente dinâmico no XML.
    // HOTFIX CSOSN: separar valor bruto (nome da tag) do valor escapado (conteúdo).
    // escapeXml pode introduzir caracteres (&amp;, &apos;) que quebrariam o nome
    // da tag <ICMSSN...>. O nome da tag usa o valor bruto; o conteúdo do <CSOSN>
    // continua escapado para defesa em profundidade.
    const rawCsosn = p.csosn || '102';
    // HOTFIX CSOSN VALIDATION: bloqueia valores fora do padrão SEFAZ (3 dígitos).
    // Garante que o nome da tag <ICMSSN${rawCsosn}> seja sempre válido e
    // evita XML quebrado por letras, símbolos ou strings vazias.
    if (!/^\d{3}$/.test(rawCsosn)) {
      throw new Error('NFE_INVALID_CSOSN');
    }
    const csosn = escapeXml(rawCsosn);

    // FASE NF.6 — ETAPA 1/2/3: CST dinâmico para regime normal (CRT=3).
    // - default '00' preserva 100% do XML legado quando p.cst não vem do builder
    //   (ETAPA 6 — backward compatibility);
    // - regex /^\d{2}$/ bloqueia valores fora do padrão SEFAZ (ex.: 'A1', '1', '');
    //   alinhado ao mesmo fail-fast da NF.5.1 para CSOSN.
    // - cálculo NÃO muda (ETAPA 4): pICMS/vICMS = 0.00, modBC=3, vBC=p.vProd —
    //   apenas a TAG passa de fixa <ICMS00> para <ICMS${cst}>.
    const rawCst = (p as any).cst || '00';
    if (!/^\d{2}$/.test(rawCst)) {
      throw new Error('NFE_INVALID_CST');
    }
    const cstSafe = escapeXml(rawCst);

    // FASE NF.7.1 — estrutura de ICMS por CST.
    // - default ('00' e demais não mapeados): estrutura completa com base/imposto.
    // - '20' (redução de base): adiciona <pRedBC>0.00</pRedBC>.
    // - '40' / '41' / '50' (isento/não tributado): apenas <orig> + <CST>.
    // - '60' (ICMS ST): estrutura mínima (NF.7.x cuidará de vBCST/vICMSST reais).
    //
    // FASE NF.7.2 — cálculo real de ICMS (CRT=3 apenas):
    // - vBC = p.vProd (sem redução por enquanto);
    // - pICMS = 18% (alíquota fixa inicial — base para regra por UF na NF.7.x);
    // - vICMS = vBC * pICMS / 100.
    // CST 40/41/50/60 NÃO recebem cálculo (estrutura mínima preservada).
    // CRT 1/2 (Simples Nacional) usa o branch <ICMSSN…> abaixo e icmsContent
    // é descartado — comportamento de Simples 100% preservado.
    // ⚠ Sem função separada e sem refatorar o bloco — apenas o switch local.
    //
    // FASE NF.7.3 — alíquota encapsulada em getAliquotaICMS() (ponto único
    // de mudança futura).
    // FASE NF.7.4 — passamos as UFs de emitente e destinatário (já normalizadas
    // em uppercase no closure desta função, linhas 167/176) para diferenciar
    // operação interna × interestadual. Acesso seguro via `?.` mantém o
    // fallback 18% se algo vier ausente. Estrutura de input NÃO foi alterada.
    const vBC = Number(p.vProd) || 0;
    // FASE NF.7.6 — NCM passado como 3º argumento para detecção de importado.
    // FASE NF.7.7 — item completo (`p`) passado como 4º argumento para
    // permitir override manual via `p.importado === true` (cadastro/operador).
    const pICMS = getAliquotaICMS(
      (input as any).emitente?.uf,
      (input as any).destinatario?.uf,
      p.ncm,
      p,
    );
    const vICMS = (vBC * pICMS) / 100;

    let icmsContent: string;
    switch (rawCst) {
      case '20':
        icmsContent = `<orig>0</orig><CST>${cstSafe}</CST><modBC>3</modBC><vBC>${toMoney(vBC)}</vBC><pRedBC>0.00</pRedBC><pICMS>${toMoney(pICMS)}</pICMS><vICMS>${toMoney(vICMS)}</vICMS>`;
        break;
      case '40':
      case '41':
      case '50':
      case '60':
        icmsContent = `<orig>0</orig><CST>${cstSafe}</CST>`;
        break;
      default:
        icmsContent = `<orig>0</orig><CST>${cstSafe}</CST><modBC>3</modBC><vBC>${toMoney(vBC)}</vBC><pICMS>${toMoney(pICMS)}</pICMS><vICMS>${toMoney(vICMS)}</vICMS>`;
        break;
    }

    const icmsXml = crt === '1' || crt === '2'
      ? `<ICMS><ICMSSN${rawCsosn}><orig>0</orig><CSOSN>${csosn}</CSOSN></ICMSSN${rawCsosn}></ICMS>`
      : `<ICMS><ICMS${rawCst}>${icmsContent}</ICMS${rawCst}></ICMS>`;

    return `<det nItem="${idx + 1}"><prod><cProd>${escapeXml(p.cProd || String(idx + 1).padStart(6, '0'))}</cProd><cEAN>${p.cEAN || 'SEM GTIN'}</cEAN><xProd>${escapeXml(p.xProd)}</xProd><NCM>${ncm}</NCM><CFOP>${p.cfop}</CFOP><uCom>${escapeXml(p.uCom || 'KG')}</uCom><qCom>${fmtValor(p.qCom, 4)}</qCom><vUnCom>${fmtValor(p.vUnCom, 10)}</vUnCom><vProd>${safeNumber(p.vProd, 'item.vProd')}</vProd><cEANTrib>${p.cEAN || 'SEM GTIN'}</cEANTrib><uTrib>${escapeXml(p.uTrib || p.uCom || 'KG')}</uTrib><qTrib>${fmtValor(p.qTrib || p.qCom, 4)}</qTrib><vUnTrib>${fmtValor(p.vUnTrib || p.vUnCom, 10)}</vUnTrib><indTot>1</indTot></prod><imposto><vTotTrib>0.00</vTotTrib>${icmsXml}<PIS><PISNT><CST>07</CST></PISNT></PIS><COFINS><COFINSNT><CST>07</CST></COFINSNT></COFINS></imposto></det>`;
  }).join('');

  const cnpjDest = input.destinatario.cnpj?.replace(/\D/g, '') || '';
  const cpfDest = input.destinatario.cpf?.replace(/\D/g, '') || '';
  const docDestXml = cnpjDest
    ? `<CNPJ>${cnpjDest}</CNPJ>`
    : `<CPF>${cpfDest.padStart(11, '0')}</CPF>`;

  const idDestOp = uf === ufDest ? '1' : '2'; // 1=operação interna 2=interestadual

  // FASE NF.2.1 — escapeXml unifica trim + colapso de espaços + escape de
  // caracteres reservados. Substitui sanitizeXml(xmlSafe(...)) no template.
  const natOp = escapeXml(input.natOp || 'Venda de mercadoria adquirida');
  const xNomeEmit = escapeXml(input.emitente.xNome);
  const xFantEmit = escapeXml(input.emitente.xFant || input.emitente.xNome);
  const xNomeDest = escapeXml(input.destinatario.xNome);

  // FASE NF.2.1 — ETAPA 4: tags opcionais NUNCA são emitidas vazias.
  // Verifica string trim()-eada antes de incluir, evitando <IE></IE>, <email></email>, etc.
  const ieDestRaw = (input.destinatario.ie ?? '').toString().trim();
  const ieDest = ieDestRaw
    ? `<IE>${escapeXml(ieDestRaw)}</IE>`
    : '<indIEDest>9</indIEDest>';

  const emailDestRaw = (input.destinatario.email ?? '').toString().trim();
  const emailDest = emailDestRaw ? `<email>${escapeXml(emailDestRaw)}</email>` : '';

  const infCplRaw = (input.informacoesAdicionais ?? '').toString().trim();
  const infAdic = infCplRaw
    ? `<infAdic><infCpl>${escapeXml(infCplRaw)}</infCpl></infAdic>`
    : '';

  const xml = `<?xml version="1.0" encoding="UTF-8"?><NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe versao="4.00" Id="NFe${chaveNFe}"><ide><cUF>${cUF}</cUF><cNF>${cNF}</cNF><natOp>${natOp}</natOp><mod>55</mod><serie>${serie}</serie><nNF>${Number(nNF)}</nNF><dhEmi>${dhEmi}</dhEmi><tpNF>1</tpNF><idDest>${idDestOp}</idDest><cMunFG>${cMunEmit}</cMunFG><tpImp>1</tpImp><tpEmis>1</tpEmis><cDV>${chaveNFe.slice(-1)}</cDV><tpAmb>${tpAmb}</tpAmb><finNFe>1</finNFe><indFinal>1</indFinal><indPres>1</indPres><procEmi>0</procEmi><verProc>VivaFrutaz 1.0</verProc></ide><emit><CNPJ>${cnpjEmit}</CNPJ><xNome>${xNomeEmit}</xNome><xFant>${xFantEmit}</xFant><enderEmit><xLgr>${escapeXml(input.emitente.logradouro)}</xLgr><nro>${escapeXml(input.emitente.numero || 'S/N')}</nro><xBairro>${escapeXml(input.emitente.bairro || 'Centro')}</xBairro><cMun>${cMunEmit}</cMun><xMun>${escapeXml(input.emitente.xMun)}</xMun><UF>${uf}</UF><CEP>${input.emitente.cep.replace(/\D/g, '').padStart(8, '0')}</CEP><cPais>1058</cPais><xPais>Brasil</xPais>${input.emitente.fone ? `<fone>${input.emitente.fone.replace(/\D/g, '')}</fone>` : ''}</enderEmit><IE>${escapeXml(input.emitente.ie)}</IE><CRT>${crt}</CRT></emit><dest>${docDestXml}<xNome>${xNomeDest}</xNome><enderDest><xLgr>${escapeXml(input.destinatario.logradouro)}</xLgr><nro>${escapeXml(input.destinatario.numero || 'S/N')}</nro><xBairro>${escapeXml(input.destinatario.bairro || 'Centro')}</xBairro><cMun>${cMunDest}</cMun><xMun>${escapeXml(input.destinatario.xMun)}</xMun><UF>${ufDest}</UF><CEP>${(input.destinatario.cep || '00000000').replace(/\D/g, '').padStart(8, '0')}</CEP><cPais>1058</cPais><xPais>Brasil</xPais>${input.destinatario.fone ? `<fone>${input.destinatario.fone.replace(/\D/g, '')}</fone>` : ''}</enderDest>${ieDest}${emailDest}</dest>${itenXml}<total><ICMSTot><vBC>0.00</vBC><vICMS>0.00</vICMS><vICMSDeson>0.00</vICMSDeson><vFCP>0.00</vFCP><vBCST>0.00</vBCST><vST>0.00</vST><vFCPST>0.00</vFCPST><vFCPSTRet>0.00</vFCPSTRet><vProd>${safeNumber(vProd, 'total.vProd')}</vProd><vFrete>${safeNumber(vFrete, 'total.vFrete')}</vFrete><vSeg>${safeNumber(vSeg, 'total.vSeg')}</vSeg><vDesc>${safeNumber(vDesc, 'total.vDesc')}</vDesc><vII>0.00</vII><vIPI>0.00</vIPI><vIPIDevol>0.00</vIPIDevol><vPIS>0.00</vPIS><vCOFINS>0.00</vCOFINS><vOutro>0.00</vOutro><vNF>${safeNumber(vNF, 'total.vNF')}</vNF><vTotTrib>0.00</vTotTrib></ICMSTot></total><transp><modFrete>9</modFrete></transp><pag><detPag><tPag>99</tPag><vPag>${safeNumber(vNF, 'pag.vPag')}</vPag></detPag></pag>${infAdic}</infNFe></NFe>`;

  // FASE NF.2 — ETAPA 5: validação estrutural do XML gerado
  if (!xml || typeof xml !== 'string') throw new Error('NFE_XML_EMPTY');
  if (!xml.includes('<NFe')) throw new Error('NFE_XML_INVALID_STRUCTURE');

  // FASE NF.2.2 — ETAPA 5: validação estrutural FINAL (fail-fast).
  // Exige preâmbulo XML, tag NFe de abertura e fechamento — qualquer truncamento
  // ou montagem corrompida quebra o fluxo aqui.
  if (
    typeof xml !== 'string' ||
    !xml.startsWith('<?xml') ||
    !xml.includes('<NFe') ||
    !xml.includes('</NFe>')
  ) {
    throw new Error('NFE_XML_CORRUPTED');
  }

  // FASE NF.2.2 — ETAPA 6: detecção de conteúdo suspeito (NaN/undefined
  // que escaparam por interpolação acidental). Falha explícita.
  if (xml.includes('NaN') || xml.includes('undefined')) {
    console.error('[NFE_XML_CORRUPTED_CONTENT]', {
      orderId: input.orderId,
    });
    throw new Error('NFE_XML_CORRUPTED_CONTENT');
  }

  // FASE NF.2 — ETAPA 6: log estruturado (sem dados sensíveis, sem XML completo)
  const valorTotal = Number(
    input.produtos.reduce((t, p) => t + p.vProd, 0).toFixed(2),
  );
  console.log('[NFE_XML_GENERATED]', {
    orderId: input.orderId,
    numero,
    totalProdutos: input.produtos.length,
    valorTotal,
  });

  // FASE NF.2.1 — ETAPA 6: log adicional do hardening defensivo (sem dados sensíveis).
  console.log('[NFE_XML_SAFE]', {
    orderId: input.orderId,
    numero,
    totalProdutos: input.produtos.length,
  });

  // FASE NF.2.2 — ETAPA 7: log final (passou em TODAS as validações).
  console.log('[NFE_XML_FINAL_OK]', {
    orderId: input.orderId,
    numero,
    totalProdutos: input.produtos.length,
  });

  return {
    chaveNFe,
    numero: String(numero),
    serie,
    xmlGerado: xml,
    dataEmissao: dhEmi,
  };
}
