import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

export interface IncidentPdfData {
  id: number;
  companyName: string;
  type: string;
  status: string;
  description: string;
  createdAt: string;
  responseMessage?: string;
  respondedByName?: string;
  respondedAt?: string;
  adminNote?: string;
}

function safeText(val: unknown): string {
  if (val === undefined || val === null) return "";
  return String(val);
}

export async function generateIncidentPdf(data: IncidentPdfData): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 14;

  const GREEN = [34, 139, 80] as [number, number, number];
  const DARK = [30, 40, 50] as [number, number, number];
  const LIGHT_GRAY = [245, 246, 248] as [number, number, number];
  const WHITE: [number, number, number] = [255, 255, 255];

  // Header
  doc.setFillColor(...GREEN);
  doc.rect(0, 0, pageW, 20, "F");
  doc.setTextColor(...WHITE);
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("VivaFrutaz", margin, 10);
  doc.text("Relatório de Ocorrência", pageW - margin - 2, 10, { align: "right" });

  let y = 24;

  // Incident info box
  doc.setFillColor(...LIGHT_GRAY);
  doc.roundedRect(margin, y, pageW - margin * 2, 28, 2, 2, "F");

  doc.setTextColor(...DARK);
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.text(`Código: #${data.id}`, margin + 4, y + 6);
  doc.text(`Empresa: ${safeText(data.companyName)}`, margin + 4, y + 12);

  const TYPE_LABELS: Record<string, string> = {
    DELIVERY_PROBLEM: "Problema de Entrega",
    DEFECTIVE_PRODUCT: "Produto com Defeito",
    MISSING_PRODUCT: "Produto Faltando",
    QUALITY: "Qualidade do Produto",
    COMPLAINT: "Reclamação Geral",
    OTHER: "Outro",
  };

  const STATUS_LABELS: Record<string, string> = {
    OPEN: "Aberta",
    ANALYZING: "Em Análise",
    RESPONDED: "Respondida",
    RESOLVED: "Resolvida",
  };

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(`Tipo: ${safeText(TYPE_LABELS[data.type] || data.type)}`, margin + 4, y + 18);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(220, 100, 50);
  doc.text(`Status: ${safeText(STATUS_LABELS[data.status] || data.status)}`, margin + 4, y + 24);

  y += 32;

  // Dates
  doc.setTextColor(...DARK);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  try {
    doc.text(`Data da Ocorrência: ${format(new Date(data.createdAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}`, margin, y);
  } catch {
    doc.text(`Data da Ocorrência: ${safeText(data.createdAt)}`, margin, y);
  }
  if (data.respondedAt) {
    try {
      doc.text(`Respondida em: ${format(new Date(data.respondedAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}`, margin, y + 6);
    } catch {
      doc.text(`Respondida em: ${safeText(data.respondedAt)}`, margin, y + 6);
    }
    if (data.respondedByName) doc.text(`Por: ${safeText(data.respondedByName)}`, margin, y + 12);
  }

  y += 18;

  // Description section
  doc.setFillColor(...GREEN);
  doc.rect(margin, y, pageW - margin * 2, 6, "F");
  doc.setTextColor(...WHITE);
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.text("DESCRIÇÃO DA OCORRÊNCIA", margin + 3, y + 4.2);

  y += 6;

  doc.setTextColor(...DARK);
  doc.setFont("helvetica", "normal");
  const descLines = doc.splitTextToSize(safeText(data.description), pageW - margin * 2 - 4);
  doc.text(descLines, margin + 2, y + 2);
  y += (descLines.length * 3.5) + 4;

  // Response section
  if (data.responseMessage) {
    doc.setFillColor(...LIGHT_GRAY);
    doc.rect(margin, y, pageW - margin * 2, 6, "F");
    doc.setTextColor(...DARK);
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.text("RESPOSTA VIVAFRUTAZ", margin + 3, y + 4.2);

    y += 6;

    doc.setFont("helvetica", "normal");
    const respLines = doc.splitTextToSize(safeText(data.responseMessage), pageW - margin * 2 - 4);
    doc.text(respLines, margin + 2, y + 2);
    y += (respLines.length * 3.5) + 4;
  }

  // Admin notes section (internal)
  if (data.adminNote) {
    doc.setFillColor(255, 235, 205);
    doc.rect(margin, y, pageW - margin * 2, 6, "F");
    doc.setTextColor(...DARK);
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.text("OBSERVAÇÕES INTERNAS", margin + 3, y + 4.2);

    y += 6;

    doc.setFont("helvetica", "italic");
    const noteLines = doc.splitTextToSize(safeText(data.adminNote), pageW - margin * 2 - 4);
    doc.text(noteLines, margin + 2, y + 2);
    y += (noteLines.length * 3.5) + 4;
  }

  // Footer
  const pageH = doc.internal.pageSize.getHeight();
  doc.setFillColor(...GREEN);
  doc.rect(0, pageH - 10, pageW, 10, "F");
  doc.setTextColor(...WHITE);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.text(
    `Gerado em ${format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })} • VivaFrutaz • Relatório Automático`,
    pageW / 2,
    pageH - 4,
    { align: "center" }
  );

  return doc;
}

export async function downloadIncidentPdf(data: IncidentPdfData): Promise<void> {
  const doc = await generateIncidentPdf(data);
  doc.save(`Ocorrencia_${data.id}.pdf`);
}
