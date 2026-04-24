import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import QRCode from "qrcode";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import * as XLSX from "xlsx";

export interface DanfeOrder {
  id: number;
  orderCode?: string | null;
  status: string;
  orderDate: string;
  deliveryDate: string;
  weekReference: string;
  totalValue: string;
  orderNote?: string | null;
  adminNote?: string | null;
  companyId: number;
  preNotaNumber?: string | null;
  fiscalStatus?: string | null;
}

export interface DanfeItem {
  productName: string;
  quantity: number;
  unit: string;
  unitPrice: string;
  totalPrice: string;
  ncm?: string | null;
  cfop?: string | null;
}

export interface DanfeCompany {
  companyName: string;
  cnpj?: string | null;
  contactName?: string | null;
  phone?: string | null;
  addressStreet?: string | null;
  addressNumber?: string | null;
  addressNeighborhood?: string | null;
  addressCity?: string | null;
  addressZip?: string | null;
  addressState?: string | null;
  stateRegistration?: string | null;
}

export interface DanfeLogistics {
  routeName?: string | null;
  driverName?: string | null;
  deliveryWindow?: string | null;
}

export interface DanfeData {
  order: DanfeOrder;
  items: DanfeItem[];
  company: DanfeCompany;
  logistics?: DanfeLogistics;
  vivaFrutaz: {
    cnpj?: string | null;
    address?: string | null;
    phone?: string | null;
    companyName?: string | null;
    fantasyName?: string | null;
    city?: string | null;
    state?: string | null;
    cep?: string | null;
    email?: string | null;
    stateRegistration?: string | null;
    defaultCfop?: string | null;
    defaultNatureza?: string | null;
    logoBase64?: string | null;
    logoType?: string | null;
  };
}

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Ativo",
  CONFIRMED: "Confirmado",
  REOPEN_REQUESTED: "Solicitação de Alteração",
  OPEN_FOR_EDITING: "Em Edição",
  CANCELLED: "Cancelado",
  DELIVERED: "Entregue",
};

const FISCAL_STATUS_LABEL: Record<string, string> = {
  nota_pendente: "Nota Pendente",
  nota_exportada: "Nota Exportada",
  nota_emitida: "Nota Emitida",
  nota_cancelada: "Nota Cancelada",
};

function safeText(val: unknown): string {
  if (val === undefined || val === null) return "";
  return String(val);
}

function formatMoney(val: string | number): string {
  const n = typeof val === "string" ? parseFloat(val) : val;
  return isNaN(n) ? "R$ 0,00" : `R$ ${n.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
}

function formatDate(d: string | Date): string {
  try {
    const dt = typeof d === "string" ? new Date(d) : d;
    return format(dt, "dd/MM/yyyy", { locale: ptBR });
  } catch {
    return safeText(d);
  }
}

function buildAddress(c: DanfeCompany): string {
  const parts = [
    c.addressStreet,
    c.addressNumber && `nº ${c.addressNumber}`,
    c.addressNeighborhood,
    c.addressCity,
    c.addressState,
    c.addressZip,
  ].filter(Boolean);
  return parts.join(", ") || "—";
}

export async function generateDanfePdf(data: DanfeData): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 14;

  const GREEN = [34, 139, 80] as [number, number, number];
  const ORANGE = [234, 100, 22] as [number, number, number];
  const LIGHT_GRAY = [245, 246, 248] as [number, number, number];
  const DARK = [30, 40, 50] as [number, number, number];
  const WHITE: [number, number, number] = [255, 255, 255];
  const BLUE = [37, 99, 235] as [number, number, number];

  const cfop = data.vivaFrutaz.defaultCfop || "5102";
  const natureza = data.vivaFrutaz.defaultNatureza || "Venda de mercadoria adquirida";

  let y = 0;

  // ── Header band ────────────────────────────────────────────
  doc.setFillColor(...GREEN);
  doc.rect(0, 0, pageW, 28, "F");

  doc.setTextColor(...WHITE);
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("DANFE INTERNO", margin, 11);

  doc.setFontSize(8.5);
  doc.setFont("helvetica", "normal");
  doc.text("DOCUMENTO AUXILIAR DE ENTREGA", margin, 17);

  doc.setFontSize(7.5);
  doc.setFont("helvetica", "italic");
  doc.text("Este documento não substitui a Nota Fiscal Eletrônica.", margin, 23);

  // VivaFrutaz brand block (right side of header)
  if (data.vivaFrutaz.logoBase64) {
    try {
      const imgType = (data.vivaFrutaz.logoType || "image/png").replace("image/", "").toUpperCase() as any;
      const logoX = pageW - margin - 22;
      doc.addImage(data.vivaFrutaz.logoBase64, imgType, logoX, 3, 20, 20);
    } catch {
      // fallback: render text only
    }
  }
  const brandTextX = data.vivaFrutaz.logoBase64 ? pageW - margin - 26 : pageW - margin - 2;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(safeText(data.vivaFrutaz.companyName) || "VivaFrutaz", brandTextX, 12, { align: "right" });
  if (data.vivaFrutaz.fantasyName && data.vivaFrutaz.fantasyName !== data.vivaFrutaz.companyName) {
    doc.setFontSize(7.5);
    doc.setFont("helvetica", "italic");
    doc.text(safeText(data.vivaFrutaz.fantasyName), brandTextX, 17, { align: "right" });
  }
  doc.setFontSize(7);
  doc.setFont("helvetica", "normal");
  if (data.vivaFrutaz.cnpj) doc.text(`CNPJ: ${safeText(data.vivaFrutaz.cnpj)}`, brandTextX, 20, { align: "right" });
  if (data.vivaFrutaz.phone) doc.text(`Tel: ${safeText(data.vivaFrutaz.phone)}`, brandTextX, 24, { align: "right" });

  y = 32;

  // ── QR Code ────────────────────────────────────────────────
  try {
    const qrContent = JSON.stringify({
      id: data.order.id,
      url: `${window.location.origin}/admin/orders?order=${data.order.id}`,
      entrega: formatDate(data.order.deliveryDate),
      preNota: data.order.preNotaNumber || "",
    });
    const qrDataUrl = await QRCode.toDataURL(qrContent, { width: 120, margin: 1 });
    doc.addImage(qrDataUrl, "PNG", pageW - margin - 24, y, 24, 24);
  } catch (_) {}

  // ── Order info band ────────────────────────────────────────
  doc.setFillColor(...LIGHT_GRAY);
  doc.roundedRect(margin, y, pageW - margin * 2 - 28, 32, 2, 2, "F");

  doc.setTextColor(...DARK);
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  const orderLabel = safeText(data.order.orderCode) || `#${data.order.id}`;
  doc.text(`Pedido: ${orderLabel}`, margin + 4, y + 7);

  if (data.order.preNotaNumber) {
    doc.setFontSize(8);
    doc.setTextColor(...BLUE);
    doc.text(`Pré-Nota: ${safeText(data.order.preNotaNumber)}`, margin + 4, y + 13);
    doc.setTextColor(...DARK);
  }

  doc.setFontSize(7.5);
  doc.setFont("helvetica", "normal");
  const row1y = y + (data.order.preNotaNumber ? 19 : 14);
  const row2y = row1y + 6;
  const row3y = row2y + 6;

  const col1x = margin + 4;
  const col2x = margin + 65;
  const col3x = margin + 120;

  doc.text(`Data do pedido: ${formatDate(data.order.orderDate)}`, col1x, row1y);
  doc.text(`Data de entrega: ${formatDate(data.order.deliveryDate)}`, col2x, row1y);
  doc.text(`Semana ref.: ${safeText(data.order.weekReference)}`, col3x, row1y);

  doc.text(`Natureza: ${natureza}`, col1x, row2y);
  doc.text(`CFOP: ${cfop}`, col2x, row2y);

  doc.setFont("helvetica", "bold");
  doc.setTextColor(...GREEN);
  doc.text(`Status: ${safeText(STATUS_LABEL[data.order.status] || data.order.status)}`, col1x, row3y);
  if (data.order.fiscalStatus) {
    doc.setTextColor(100, 60, 200);
    doc.text(`Fiscal: ${safeText(FISCAL_STATUS_LABEL[data.order.fiscalStatus] || data.order.fiscalStatus)}`, col2x, row3y);
  }
  doc.setTextColor(...DARK);
  doc.setFont("helvetica", "normal");

  y += 36;

  // ── Two-column info section ─────────────────────────────
  const halfW = (pageW - margin * 2 - 4) / 2;
  const colRx = margin + halfW + 4;

  // Remetente header
  doc.setFillColor(...GREEN);
  doc.rect(margin, y, halfW, 6, "F");
  doc.setTextColor(...WHITE);
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "bold");
  doc.text("REMETENTE (VivaFrutaz)", margin + 3, y + 4.2);

  // Destinatário header
  doc.setFillColor(...ORANGE);
  doc.rect(colRx, y, halfW, 6, "F");
  doc.text("DESTINATÁRIO (Cliente)", colRx + 3, y + 4.2);
  y += 6;

  const infoBoxH = 42;
  doc.setFillColor(...LIGHT_GRAY);
  doc.rect(margin, y, halfW, infoBoxH, "F");
  doc.rect(colRx, y, halfW, infoBoxH, "F");

  doc.setTextColor(...DARK);
  doc.setFontSize(7.5);

  // Remetente info
  let ry = y + 5;
  doc.setFont("helvetica", "bold");
  doc.text(safeText(data.vivaFrutaz.companyName) || "VivaFrutaz", margin + 3, ry);
  doc.setFont("helvetica", "normal");
  ry += 5;
  if (data.vivaFrutaz.cnpj) { doc.text(`CNPJ: ${safeText(data.vivaFrutaz.cnpj)}`, margin + 3, ry); ry += 4.5; }
  if (data.vivaFrutaz.stateRegistration) { doc.text(`IE: ${safeText(data.vivaFrutaz.stateRegistration)}`, margin + 3, ry); ry += 4.5; }
  if (data.vivaFrutaz.address) {
    const lines = doc.splitTextToSize(safeText(data.vivaFrutaz.address), halfW - 6);
    doc.text(lines, margin + 3, ry);
    ry += lines.length * 4;
  }
  const cityStateSender = [data.vivaFrutaz.city, data.vivaFrutaz.state].filter(Boolean).join(" – ");
  if (cityStateSender) { doc.text(cityStateSender, margin + 3, ry); ry += 4.5; }
  if (data.vivaFrutaz.cep) { doc.text(`CEP: ${safeText(data.vivaFrutaz.cep)}`, margin + 3, ry); ry += 4.5; }
  if (data.vivaFrutaz.phone) { doc.text(`Tel: ${safeText(data.vivaFrutaz.phone)}`, margin + 3, ry); ry += 4.5; }
  if (data.vivaFrutaz.email) { doc.text(`Email: ${safeText(data.vivaFrutaz.email)}`, margin + 3, ry); }

  // Destinatário info
  let cy = y + 5;
  doc.setFont("helvetica", "bold");
  doc.text(safeText(data.company.companyName), colRx + 3, cy);
  doc.setFont("helvetica", "normal");
  cy += 5;
  if (data.company.cnpj) { doc.text(`CNPJ: ${safeText(data.company.cnpj)}`, colRx + 3, cy); cy += 4.5; }
  if (data.company.stateRegistration) { doc.text(`IE: ${safeText(data.company.stateRegistration)}`, colRx + 3, cy); cy += 4.5; }
  const clientAddr = buildAddress(data.company);
  if (clientAddr && clientAddr !== "—") {
    const addrLines = doc.splitTextToSize(clientAddr, halfW - 6);
    doc.text(addrLines, colRx + 3, cy);
    cy += addrLines.length * 4;
  }
  if (data.company.contactName) { doc.text(`Contato: ${safeText(data.company.contactName)}`, colRx + 3, cy); cy += 4.5; }
  if (data.company.phone) { doc.text(`Tel: ${safeText(data.company.phone)}`, colRx + 3, cy); }

  y += infoBoxH + 6;

  // ── Products table ────────────────────────────────────────
  doc.setFillColor(...GREEN);
  doc.rect(margin, y, pageW - margin * 2, 6, "F");
  doc.setTextColor(...WHITE);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("ITENS DO PEDIDO", margin + 3, y + 4.2);
  y += 6;

  const hasNcm = data.items.some(i => i.ncm);
  const hasCfop = data.items.some(i => i.cfop);

  const tableHead = hasNcm
    ? [["Produto", "NCM", "CFOP", "Qtd", "Un.", "Preço Unit.", "Subtotal"]]
    : [["Produto", "Qtd", "Un.", "Preço Unit.", "Subtotal"]];

  const tableBody = data.items.map(item =>
    hasNcm
      ? [
          safeText(item.productName),
          safeText(item.ncm) || "—",
          safeText(item.cfop) || cfop,
          String(item.quantity ?? 0),
          safeText(item.unit) || "un",
          formatMoney(item.unitPrice),
          formatMoney(item.totalPrice),
        ]
      : [
          safeText(item.productName),
          String(item.quantity ?? 0),
          safeText(item.unit) || "un",
          formatMoney(item.unitPrice),
          formatMoney(item.totalPrice),
        ]
  );

  const columnStyles: any = hasNcm
    ? {
        0: { cellWidth: "auto" },
        1: { cellWidth: 20, halign: "center" as const },
        2: { cellWidth: 14, halign: "center" as const },
        3: { cellWidth: 12, halign: "center" as const },
        4: { cellWidth: 12, halign: "center" as const },
        5: { cellWidth: 26, halign: "right" as const },
        6: { cellWidth: 26, halign: "right" as const },
      }
    : {
        0: { cellWidth: "auto" },
        1: { cellWidth: 14, halign: "center" as const },
        2: { cellWidth: 14, halign: "center" as const },
        3: { cellWidth: 28, halign: "right" as const },
        4: { cellWidth: 28, halign: "right" as const },
      };

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: tableHead,
    body: tableBody,
    headStyles: {
      fillColor: DARK,
      textColor: WHITE,
      fontStyle: "bold",
      fontSize: 7.5,
    },
    bodyStyles: { fontSize: 7.5, textColor: DARK },
    alternateRowStyles: { fillColor: [250, 250, 252] },
    columnStyles,
    tableLineColor: [220, 220, 224],
    tableLineWidth: 0.1,
  });

  y = (doc as any).lastAutoTable.finalY + 4;

  // ── Totals ─────────────────────────────────────────────────
  const totalItems = data.items.reduce((s, i) => s + (i.quantity ?? 0), 0);
  const totalVal = parseFloat(data.order.totalValue) || 0;
  const totalsX = pageW - margin - 64;

  doc.setFillColor(...LIGHT_GRAY);
  doc.rect(totalsX, y, 64, 22, "F");
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...DARK);
  doc.text(`Total de itens: ${totalItems} un.`, totalsX + 3, y + 6);
  doc.text(`Qtd produtos: ${data.items.length}`, totalsX + 3, y + 11);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(...GREEN);
  doc.text(`TOTAL: ${formatMoney(totalVal)}`, totalsX + 3, y + 19);

  y += 26;

  // ── Logistics info ─────────────────────────────────────────
  const logi = data.logistics;
  if (logi && (logi.routeName || logi.driverName || logi.deliveryWindow)) {
    doc.setFillColor(...ORANGE);
    doc.rect(margin, y, pageW - margin * 2, 6, "F");
    doc.setTextColor(...WHITE);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("INFORMAÇÕES LOGÍSTICAS", margin + 3, y + 4.2);
    y += 6;

    doc.setFillColor(...LIGHT_GRAY);
    doc.rect(margin, y, pageW - margin * 2, 18, "F");
    doc.setTextColor(...DARK);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);

    const lx = margin + 4;
    const ly = y + 6;
    if (logi.routeName) doc.text(`Rota: ${safeText(logi.routeName)}`, lx, ly);
    if (logi.driverName) doc.text(`Motorista: ${safeText(logi.driverName)}`, lx + 60, ly);
    if (logi.deliveryWindow) doc.text(`Janela de entrega: ${safeText(logi.deliveryWindow)}`, lx, ly + 8);

    y += 22;
  }

  // ── Notes ──────────────────────────────────────────────────
  if (data.order.orderNote || data.order.adminNote) {
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...DARK);
    doc.text("Observações da Nota:", margin, y);
    y += 5;
    doc.setFontSize(7.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(80, 80, 90);
    if (data.order.orderNote) {
      const lines = doc.splitTextToSize(`Obs. do pedido: ${safeText(data.order.orderNote)}`, pageW - margin * 2);
      doc.text(lines, margin, y);
      y += lines.length * 5;
    }
    if (data.order.adminNote) {
      doc.setFont("helvetica", "italic");
      doc.setTextColor(180, 60, 60);
      const alines = doc.splitTextToSize(`Obs. administrativa: ${safeText(data.order.adminNote)}`, pageW - margin * 2);
      doc.text(alines, margin, y);
      y += alines.length * 5;
    }
  }

  // ── Footer ─────────────────────────────────────────────────
  const pageH = doc.internal.pageSize.getHeight();
  doc.setFillColor(...GREEN);
  doc.rect(0, pageH - 12, pageW, 12, "F");
  doc.setTextColor(...WHITE);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  const now = new Date();
  doc.text(
    `Gerado em ${format(now, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })} — VivaFrutaz • DANFE Interno • Documento não fiscal`,
    pageW / 2,
    pageH - 5,
    { align: "center" }
  );

  return doc;
}

export async function downloadDanfe(data: DanfeData): Promise<void> {
  const doc = await generateDanfePdf(data);
  const code = safeText(data.order.orderCode) || `pedido-${data.order.id}`;
  doc.save(`DANFE-${code}.pdf`);
}

export async function openDanfe(data: DanfeData): Promise<void> {
  const doc = await generateDanfePdf(data);
  const blob = doc.output("blob");
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank");
}

// ── Exportação ERP — Excel ────────────────────────────────────────
export function exportToExcel(data: DanfeData): void {
  const cfop = data.vivaFrutaz.defaultCfop || "5102";
  const rows = data.items.map(item => ({
    numero_pedido: data.order.orderCode || `#${data.order.id}`,
    numero_pre_nota: data.order.preNotaNumber || "",
    data_pedido: formatDate(data.order.orderDate),
    data_entrega: formatDate(data.order.deliveryDate),
    semana_referencia: data.order.weekReference || "",
    cliente_nome: data.company.companyName || "",
    cliente_cnpj: data.company.cnpj || "",
    cliente_ie: data.company.stateRegistration || "",
    cliente_endereco: [data.company.addressStreet, data.company.addressNumber].filter(Boolean).join(", "),
    cidade: data.company.addressCity || "",
    estado: data.company.addressState || "",
    cep: data.company.addressZip || "",
    contato: data.company.contactName || "",
    natureza_operacao: data.vivaFrutaz.defaultNatureza || "Venda de mercadoria adquirida",
    remetente_nome: data.vivaFrutaz.companyName || "VivaFrutaz",
    remetente_cnpj: data.vivaFrutaz.cnpj || "",
    remetente_ie: data.vivaFrutaz.stateRegistration || "",
    remetente_cidade: data.vivaFrutaz.city || "",
    remetente_estado: data.vivaFrutaz.state || "",
    produto: item.productName,
    ncm: item.ncm || "",
    cfop: item.cfop || cfop,
    quantidade: item.quantity,
    unidade: item.unit,
    valor_unitario: parseFloat(item.unitPrice || "0"),
    valor_total_item: parseFloat(item.totalPrice || "0"),
    valor_total_nota: parseFloat(data.order.totalValue || "0"),
    observacoes: [data.order.orderNote, data.order.adminNote].filter(Boolean).join(" | "),
    status_fiscal: data.order.fiscalStatus || "nota_pendente",
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Nota Fiscal");

  const colWidths = Object.keys(rows[0] || {}).map(k => ({ wch: Math.max(k.length + 4, 18) }));
  ws["!cols"] = colWidths;

  const code = safeText(data.order.orderCode) || `pedido-${data.order.id}`;
  XLSX.writeFile(wb, `NF-${code}.xlsx`);
}

// ── Exportação ERP — XML ──────────────────────────────────────────
export function exportToXML(data: DanfeData): void {
  const cfop = data.vivaFrutaz.defaultCfop || "5102";
  const natureza = data.vivaFrutaz.defaultNatureza || "Venda de mercadoria adquirida";
  const e = (s: string | null | undefined) => (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const totalVal = parseFloat(data.order.totalValue || "0").toFixed(2);

  const itensXml = data.items.map(item => `
    <item>
      <produto>${e(item.productName)}</produto>
      <ncm>${e(item.ncm)}</ncm>
      <cfop>${e(item.cfop || cfop)}</cfop>
      <quantidade>${item.quantity}</quantidade>
      <unidade>${e(item.unit)}</unidade>
      <valor_unitario>${parseFloat(item.unitPrice || "0").toFixed(2)}</valor_unitario>
      <valor_total>${parseFloat(item.totalPrice || "0").toFixed(2)}</valor_total>
    </item>`).join("");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<nota_fiscal>
  <pedido>
    <numero>${e(data.order.orderCode)}</numero>
    <pre_nota>${e(data.order.preNotaNumber)}</pre_nota>
    <data_pedido>${formatDate(data.order.orderDate)}</data_pedido>
    <data_entrega>${formatDate(data.order.deliveryDate)}</data_entrega>
    <semana_referencia>${e(data.order.weekReference)}</semana_referencia>
    <natureza_operacao>${e(natureza)}</natureza_operacao>
    <cfop>${e(cfop)}</cfop>
    <valor_total>${totalVal}</valor_total>
    <status_fiscal>${e(data.order.fiscalStatus)}</status_fiscal>
    <observacoes>${e([data.order.orderNote, data.order.adminNote].filter(Boolean).join(" | "))}</observacoes>
  </pedido>
  <remetente>
    <razao_social>${e(data.vivaFrutaz.companyName)}</razao_social>
    <cnpj>${e(data.vivaFrutaz.cnpj)}</cnpj>
    <ie>${e(data.vivaFrutaz.stateRegistration)}</ie>
    <endereco>${e(data.vivaFrutaz.address)}</endereco>
    <cidade>${e(data.vivaFrutaz.city)}</cidade>
    <estado>${e(data.vivaFrutaz.state)}</estado>
    <cep>${e(data.vivaFrutaz.cep)}</cep>
    <telefone>${e(data.vivaFrutaz.phone)}</telefone>
    <email>${e(data.vivaFrutaz.email)}</email>
  </remetente>
  <destinatario>
    <razao_social>${e(data.company.companyName)}</razao_social>
    <cnpj>${e(data.company.cnpj)}</cnpj>
    <ie>${e(data.company.stateRegistration)}</ie>
    <endereco>${e([data.company.addressStreet, data.company.addressNumber].filter(Boolean).join(", "))}</endereco>
    <cidade>${e(data.company.addressCity)}</cidade>
    <estado>${e(data.company.addressState)}</estado>
    <cep>${e(data.company.addressZip)}</cep>
    <contato>${e(data.company.contactName)}</contato>
    <telefone>${e(data.company.phone)}</telefone>
  </destinatario>
  <itens>${itensXml}
  </itens>
</nota_fiscal>`;

  const blob = new Blob([xml], { type: "application/xml;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `NF-${safeText(data.order.orderCode) || data.order.id}.xml`;
  a.click();
  URL.revokeObjectURL(url);
}
