import PDFDocument from 'pdfkit';
import * as fs from 'fs';
import * as path from 'path';

export interface DanfeData {
  chaveNFe: string;
  numero: string;
  serie: string;
  dataEmissao: string;
  protocolo?: string;
  dataAutorizacao?: string;
  emitente: {
    cnpj: string;
    xNome: string;
    xFant?: string;
    logradouro: string;
    numero?: string;
    bairro?: string;
    xMun: string;
    uf: string;
    cep: string;
    ie: string;
    fone?: string;
  };
  destinatario: {
    cnpj?: string;
    cpf?: string;
    xNome: string;
    logradouro: string;
    numero?: string;
    bairro?: string;
    xMun: string;
    uf: string;
    cep: string;
    ie?: string;
  };
  produtos: Array<{
    cProd: string;
    xProd: string;
    ncm: string;
    cfop: string;
    uCom: string;
    qCom: number;
    vUnCom: number;
    vProd: number;
  }>;
  total: {
    vProd: number;
    vFrete: number;
    vDesc: number;
    vNF: number;
  };
  natOp: string;
  tpAmb: '1' | '2';
  informacoesAdicionais?: string;
}

/**
 * T1104 — Extrai DanfeData a partir do XML NF-e autorizado (xmlAutorizado ou xmlGerado).
 * Fonte da verdade é sempre o XML persistido — nunca reconstrói do estado atual do pedido.
 * Usa regex determinístico (mesmo padrão de parseSefazResponse em nfeSender.ts).
 */
export function parseXmlToDanfeData(xml: string): DanfeData {
  const tag = (name: string, src: string): string =>
    src.match(new RegExp(`<${name}[^>]*>([^<]*)</${name}>`))?.[1]?.trim() ?? '';

  const block = (name: string, src: string): string =>
    src.match(new RegExp(`<${name}[\\s\\S]*?</${name}>`))?.[0] ?? '';

  // Protocolo — vem do nfeProc wrapper (quando xmlAutorizado da SEFAZ)
  const protNFe = block('protNFe', xml);
  const protocolo = tag('nProt', protNFe) || undefined;
  const dhRegistro = tag('dhRecbto', protNFe) || undefined;

  // Blocos principais
  const infNFe = block('infNFe', xml);
  const ide = block('ide', infNFe);
  const emit = block('emit', infNFe);
  const dest = block('dest', infNFe);
  const icmsTot = block('ICMSTot', infNFe);
  const infAdic = block('infAdic', infNFe);

  // Chave de acesso — extraída do atributo Id="NFe..." do infNFe
  const chaveMatch = xml.match(/Id="NFe(\d{44})"/);
  const chaveNFe = chaveMatch?.[1] ?? '';

  // Emitente + endereço
  const emitEnder = block('enderEmit', emit);

  // Destinatário + endereço
  const destEnder = block('enderDest', dest);

  // Produtos — cada bloco <det>
  const detBlocks = xml.match(/<det[\s\S]*?<\/det>/g) ?? [];
  const produtos = detBlocks.map((det) => {
    const prod = block('prod', det);
    return {
      cProd: tag('cProd', prod),
      xProd: tag('xProd', prod),
      ncm: tag('NCM', prod),
      cfop: tag('CFOP', prod),
      uCom: tag('uCom', prod),
      qCom: parseFloat(tag('qCom', prod)) || 0,
      vUnCom: parseFloat(tag('vUnCom', prod)) || 0,
      vProd: parseFloat(tag('vProd', prod)) || 0,
    };
  });

  const vProd = parseFloat(tag('vProd', icmsTot)) || produtos.reduce((s, p) => s + p.vProd, 0);
  const vFrete = parseFloat(tag('vFrete', icmsTot)) || 0;
  const vDesc = parseFloat(tag('vDesc', icmsTot)) || 0;
  const vNF = parseFloat(tag('vNF', icmsTot)) || vProd;

  const tpAmb = tag('tpAmb', ide) === '1' ? '1' : '2';

  return {
    chaveNFe,
    numero: tag('nNF', ide),
    serie: tag('serie', ide),
    dataEmissao: tag('dhEmi', ide) || tag('dEmi', ide),
    protocolo,
    dataAutorizacao: dhRegistro,
    emitente: {
      cnpj: tag('CNPJ', emit),
      xNome: tag('xNome', emit),
      xFant: tag('xFant', emit) || undefined,
      logradouro: tag('xLgr', emitEnder),
      numero: tag('nro', emitEnder) || undefined,
      bairro: tag('xBairro', emitEnder) || undefined,
      xMun: tag('xMun', emitEnder),
      uf: tag('UF', emitEnder),
      cep: tag('CEP', emitEnder),
      ie: tag('IE', emit),
      fone: tag('fone', emit) || undefined,
    },
    destinatario: {
      cnpj: tag('CNPJ', dest) || undefined,
      cpf: tag('CPF', dest) || undefined,
      xNome: tag('xNome', dest),
      logradouro: tag('xLgr', destEnder),
      numero: tag('nro', destEnder) || undefined,
      bairro: tag('xBairro', destEnder) || undefined,
      xMun: tag('xMun', destEnder),
      uf: tag('UF', destEnder),
      cep: tag('CEP', destEnder),
      ie: tag('IE', dest) || undefined,
    },
    produtos,
    total: { vProd, vFrete, vDesc, vNF },
    natOp: tag('natOp', ide),
    tpAmb: tpAmb as '1' | '2',
    informacoesAdicionais: tag('infCpl', infAdic) || undefined,
  };
}

function fmtBrl(v: number): string {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtCNPJ(cnpj: string): string {
  const c = cnpj.replace(/\D/g, '');
  return c.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
}

function fmtCEP(cep: string): string {
  const c = cep.replace(/\D/g, '');
  return c.replace(/(\d{5})(\d{3})/, '$1-$2');
}

function fmtChave(chave: string): string {
  return chave.replace(/(\d{4})/g, '$1 ').trim();
}

export async function gerarDANFE(data: DanfeData, outputPath?: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ size: 'A4', margin: 20, info: { Title: `DANFE - NF-e ${data.numero}` } });

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const PAGE_W = 595.28;
    const MARGIN = 20;
    const W = PAGE_W - MARGIN * 2;
    let y = MARGIN;

    const box = (x: number, vy: number, w: number, h: number) => doc.rect(x, vy, w, h).stroke();
    const label = (text: string, x: number, vy: number, size = 6) =>
      doc.fontSize(size).font('Helvetica').fillColor('#555').text(text, x, vy, { lineBreak: false });
    const value = (text: string, x: number, vy: number, size = 8, opts: any = {}) =>
      doc.fontSize(size).font('Helvetica-Bold').fillColor('#000').text(text, x, vy, { lineBreak: false, ...opts });

    // ─── Header ───────────────────────────────────────────────────────────────
    if (data.tpAmb === '2') {
      doc.fontSize(8).font('Helvetica-Bold').fillColor('red')
        .text('SEM VALOR FISCAL — AMBIENTE DE HOMOLOGAÇÃO', MARGIN, y, { width: W, align: 'center' });
      y += 14;
    }

    const headerH = 70;
    box(MARGIN, y, W * 0.4, headerH);
    box(MARGIN + W * 0.4, y, W * 0.25, headerH);
    box(MARGIN + W * 0.65, y, W * 0.35, headerH);

    // Emitente block
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#000')
      .text(data.emitente.xFant || data.emitente.xNome, MARGIN + 3, y + 4, { width: W * 0.4 - 6 });
    doc.fontSize(7).font('Helvetica').fillColor('#333')
      .text(`${data.emitente.logradouro}, ${data.emitente.numero || 'S/N'}`, MARGIN + 3, y + 22, { width: W * 0.4 - 6 })
      .text(`${data.emitente.xMun} - ${data.emitente.uf}  CEP: ${fmtCEP(data.emitente.cep)}`, MARGIN + 3, y + 33, { width: W * 0.4 - 6 })
      .text(`CNPJ: ${fmtCNPJ(data.emitente.cnpj)}  IE: ${data.emitente.ie}`, MARGIN + 3, y + 44, { width: W * 0.4 - 6 })
      .text(data.emitente.fone ? `Tel: ${data.emitente.fone}` : '', MARGIN + 3, y + 55, { width: W * 0.4 - 6 });

    // DANFE center
    const cx = MARGIN + W * 0.4 + 3;
    doc.fontSize(14).font('Helvetica-Bold').fillColor('#000')
      .text('DANFE', cx, y + 5, { width: W * 0.25 - 6, align: 'center' });
    doc.fontSize(6).font('Helvetica').fillColor('#333')
      .text('Documento Auxiliar da\nNota Fiscal Eletrônica', cx, y + 22, { width: W * 0.25 - 6, align: 'center' });
    doc.fontSize(7).font('Helvetica-Bold').fillColor('#000')
      .text(`Nº: ${data.numero.padStart(9, '0')}`, cx, y + 42, { width: W * 0.25 - 6, align: 'center' })
      .text(`Série: ${data.serie}`, cx, y + 53, { width: W * 0.25 - 6, align: 'center' });

    // Chave NF-e right block
    const rx = MARGIN + W * 0.65 + 3;
    label('CHAVE DE ACESSO', rx, y + 4);
    doc.fontSize(6).font('Helvetica').fillColor('#000')
      .text(fmtChave(data.chaveNFe), rx, y + 13, { width: W * 0.35 - 6 });
    if (data.protocolo) {
      label('PROTOCOLO DE AUTORIZAÇÃO', rx, y + 42);
      value(data.protocolo, rx, y + 50, 7);
    }
    if (data.dataAutorizacao) {
      label('DATA/HORA AUTORIZAÇÃO', rx, y + 58, 6);
      value(data.dataAutorizacao.slice(0, 19), rx, y + 66, 6);
    }

    y += headerH + 4;

    // ─── Natureza da Operação ──────────────────────────────────────────────────
    const natH = 18;
    box(MARGIN, y, W * 0.65, natH);
    box(MARGIN + W * 0.65, y, W * 0.35, natH);
    label('NATUREZA DA OPERAÇÃO', MARGIN + 2, y + 2);
    value(data.natOp, MARGIN + 2, y + 9, 8);
    label('NF-e Nº / SÉRIE', MARGIN + W * 0.65 + 2, y + 2);
    value(`${data.numero.padStart(9, '0')} / ${data.serie}`, MARGIN + W * 0.65 + 2, y + 9, 8);

    y += natH + 2;

    // ─── Destinatário ──────────────────────────────────────────────────────────
    const destH = 36;
    box(MARGIN, y, W, 14);
    doc.fontSize(7).font('Helvetica-Bold').fillColor('#444')
      .text('DESTINATÁRIO / REMETENTE', MARGIN + 2, y + 4);
    y += 14;

    box(MARGIN, y, W * 0.6, destH);
    box(MARGIN + W * 0.6, y, W * 0.2, destH);
    box(MARGIN + W * 0.8, y, W * 0.2, destH);

    const dest = data.destinatario;
    label('NOME / RAZÃO SOCIAL', MARGIN + 2, y + 2);
    value(dest.xNome.slice(0, 50), MARGIN + 2, y + 10, 8);
    label('CNPJ/CPF', MARGIN + W * 0.6 + 2, y + 2);
    value(dest.cnpj ? fmtCNPJ(dest.cnpj) : (dest.cpf || ''), MARGIN + W * 0.6 + 2, y + 10, 7);
    label('DATA DE EMISSÃO', MARGIN + W * 0.8 + 2, y + 2);
    value(data.dataEmissao.slice(0, 10), MARGIN + W * 0.8 + 2, y + 10, 7);

    label('ENDEREÇO', MARGIN + 2, y + 22);
    value(`${dest.logradouro}, ${dest.numero || 'S/N'}, ${dest.xMun} - ${dest.uf}`, MARGIN + 2, y + 30, 7);
    label('IE', MARGIN + W * 0.6 + 2, y + 22);
    value(dest.ie || 'Não contribuinte', MARGIN + W * 0.6 + 2, y + 30, 7);

    y += destH + 4;

    // ─── Tabela de Produtos ────────────────────────────────────────────────────
    const colHeaders = ['Cód.', 'Descrição', 'NCM', 'CFOP', 'Un', 'Qtd', 'V.Unit', 'V.Total'];
    const colW = [35, W - 35 - 45 - 40 - 25 - 35 - 50 - 45, 45, 40, 25, 35, 50, 45];
    const rowH = 15;
    const tableH = 14;

    // Header
    box(MARGIN, y, W, tableH);
    let cx2 = MARGIN;
    colHeaders.forEach((h, i) => {
      doc.fontSize(6).font('Helvetica-Bold').fillColor('#555')
        .text(h, cx2 + 2, y + 4, { width: colW[i] - 4, align: i > 4 ? 'right' : 'left' });
      cx2 += colW[i];
    });
    y += tableH;

    data.produtos.slice(0, 15).forEach((p) => {
      box(MARGIN, y, W, rowH);
      let px = MARGIN;
      const cols = [
        p.cProd.slice(0, 8),
        p.xProd.slice(0, 60),
        p.ncm.slice(0, 8),
        p.cfop,
        p.uCom.slice(0, 4),
        fmtBrl(p.qCom),
        fmtBrl(p.vUnCom),
        fmtBrl(p.vProd),
      ];
      cols.forEach((c, i) => {
        doc.fontSize(7).font('Helvetica').fillColor('#000')
          .text(c, px + 2, y + 4, { width: colW[i] - 4, lineBreak: false, align: i > 4 ? 'right' : 'left' });
        px += colW[i];
      });
      y += rowH;
    });

    y += 4;

    // ─── Totais ────────────────────────────────────────────────────────────────
    const totW = 160;
    const totX = MARGIN + W - totW;
    const totH = 14;
    const totals = [
      ['TOTAL PRODUTOS', fmtBrl(data.total.vProd)],
      ['FRETE', fmtBrl(data.total.vFrete)],
      ['DESCONTO', fmtBrl(data.total.vDesc)],
      ['TOTAL NF-e', fmtBrl(data.total.vNF)],
    ];
    totals.forEach(([lbl, val]) => {
      box(totX, y, totW / 2, totH);
      box(totX + totW / 2, y, totW / 2, totH);
      label(lbl, totX + 3, y + 3, 6);
      value(val, totX + totW / 2 + 3, y + 3, 8);
      y += totH;
    });

    y += 6;

    // ─── Informações Adicionais ───────────────────────────────────────────────
    if (data.informacoesAdicionais) {
      box(MARGIN, y, W, 30);
      label('INFORMAÇÕES COMPLEMENTARES', MARGIN + 3, y + 2, 6);
      doc.fontSize(7).font('Helvetica').fillColor('#333')
        .text(data.informacoesAdicionais.slice(0, 300), MARGIN + 3, y + 10, { width: W - 6 });
      y += 34;
    }

    // ─── Rodapé ───────────────────────────────────────────────────────────────
    doc.fontSize(6).font('Helvetica').fillColor('#888')
      .text(`Emitido por VivaFrutaz ERP • ${new Date().toLocaleDateString('pt-BR')}`, MARGIN, y + 5, { width: W, align: 'center' });

    doc.end();

    if (outputPath) {
      const dir = path.dirname(outputPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(outputPath, Buffer.concat(chunks));
    }
  });
}
