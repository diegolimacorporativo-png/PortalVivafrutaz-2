import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ClipboardList, Plus, Edit2, Trash2, CheckCircle2, XCircle, ChevronRight,
  ArrowLeft, BarChart3, Clock, ShieldCheck, RefreshCw, Lock, Eye, AlertTriangle,
  FileText, Printer, Loader2,
} from "lucide-react";

// ─── PDF Generator ─────────────────────────────────────────────────────────────
const CATEGORY_LABELS_PDF: Record<string, string> = {
  higiene: "Higiene", temperatura: "Temperatura", armazenamento: "Armazenamento",
  pessoal: "Pessoal", equipamentos: "Equipamentos", geral: "Geral",
};

async function generateSanitaryPDF(evaluation: any, items: any[], companyConfig: any) {
  const { default: jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 15;
  let y = margin;

  const score = evaluation.score !== null && evaluation.score !== undefined ? Number(evaluation.score) : null;
  const scoreColor = score === null ? '#6b7280' : score >= 90 ? '#16a34a' : score >= 70 ? '#d97706' : '#dc2626';
  const scoreLabel = score === null ? '—' : score >= 90 ? 'ÓTIMO' : score >= 70 ? 'MÉDIO' : 'CRÍTICO';

  // ─── CABEÇALHO ─────────────────────────────────────────
  // Logo (se disponível)
  let logoH = 0;
  if (companyConfig?.logoBase64) {
    try {
      const logoType = companyConfig.logoType || 'image/png';
      const ext = logoType.includes('png') ? 'PNG' : 'JPEG';
      doc.addImage(companyConfig.logoBase64, ext, margin, y, 30, 15);
      logoH = 18;
    } catch (_) {}
  }

  // Nome da empresa
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor('#1e293b');
  const companyName = companyConfig?.companyName || 'VivaFrutaz';
  doc.text(companyName, logoH > 0 ? margin + 34 : pageW / 2, y + 8, { align: logoH > 0 ? 'left' : 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor('#64748b');
  doc.text('Relatório de Vigilância Sanitária', logoH > 0 ? margin + 34 : pageW / 2, y + 15, { align: logoH > 0 ? 'left' : 'center' });
  y += Math.max(logoH, 22) + 4;

  // Linha separadora
  doc.setDrawColor('#e2e8f0');
  doc.setLineWidth(0.5);
  doc.line(margin, y, pageW - margin, y);
  y += 8;

  // ─── INFORMAÇÕES DA AVALIAÇÃO ───────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor('#1e293b');
  doc.text(evaluation.title || 'Avaliação Sanitária', margin, y);
  y += 7;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor('#475569');

  const evalDate = evaluation.evaluationDate
    ? new Date(evaluation.evaluationDate).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '—';

  const infoRows = [
    ['Data/Hora:', evalDate],
    ['Responsável:', evaluation.evaluatorName || '—'],
    ['Status:', evaluation.status === 'concluida' ? 'Concluída' : 'Em andamento'],
  ];
  if (companyConfig?.address) infoRows.push(['Local:', companyConfig.address + (companyConfig.city ? `, ${companyConfig.city}` : '')]);

  infoRows.forEach(([label, value]) => {
    doc.setFont('helvetica', 'bold');
    doc.text(label, margin, y);
    doc.setFont('helvetica', 'normal');
    doc.text(String(value), margin + 32, y);
    y += 5.5;
  });
  y += 4;

  // ─── SCORE BOX ─────────────────────────────────────────
  if (score !== null) {
    const boxW = 60, boxH = 22;
    const boxX = pageW - margin - boxW;
    const boxY = y - (infoRows.length * 5.5) - 16;
    doc.setFillColor(score >= 90 ? '#f0fdf4' : score >= 70 ? '#fffbeb' : '#fef2f2');
    doc.setDrawColor(scoreColor);
    doc.setLineWidth(1);
    doc.roundedRect(boxX, boxY, boxW, boxH, 3, 3, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.setTextColor(scoreColor);
    doc.text(`${score.toFixed(1)}%`, boxX + boxW / 2, boxY + 10, { align: 'center' });
    doc.setFontSize(9);
    doc.text(scoreLabel, boxX + boxW / 2, boxY + 17, { align: 'center' });
  }

  // Linha separadora
  doc.setDrawColor('#e2e8f0');
  doc.setLineWidth(0.3);
  doc.line(margin, y, pageW - margin, y);
  y += 8;

  // ─── RESUMO ESTATÍSTICO ─────────────────────────────────
  const totalItems = items.length;
  const okItems = items.filter(i => i.result === 'ok').length;
  const nokItems = items.filter(i => i.result === 'nok').length;
  const naItems = totalItems - okItems - nokItems;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor('#1e293b');
  doc.text('Resumo', margin, y);
  y += 6;

  const sumCols = ['Total de Itens', 'Conformes ✓', 'Não Conformes ✗', 'Não Respondidos'];
  const sumVals = [String(totalItems), String(okItems), String(nokItems), String(naItems)];
  const colW = (pageW - margin * 2) / 4;
  sumCols.forEach((col, i) => {
    const cx = margin + i * colW + colW / 2;
    doc.setFillColor(i === 1 ? '#f0fdf4' : i === 2 ? '#fef2f2' : '#f8fafc');
    doc.setDrawColor('#e2e8f0');
    doc.roundedRect(margin + i * colW, y, colW - 2, 14, 2, 2, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(i === 1 ? '#16a34a' : i === 2 ? '#dc2626' : '#475569');
    doc.text(sumVals[i], cx, y + 7, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor('#64748b');
    doc.text(col, cx, y + 12, { align: 'center' });
  });
  y += 20;

  // ─── TABELA DE ITENS POR CATEGORIA ─────────────────────
  const categories = Array.from(new Set(items.map(i => i.questionCategory || 'geral')));
  for (const cat of categories) {
    const catItems = items.filter(i => (i.questionCategory || 'geral') === cat);
    const catLabel = CATEGORY_LABELS_PDF[cat] || cat.charAt(0).toUpperCase() + cat.slice(1);

    autoTable(doc, {
      startY: y,
      head: [[{ content: catLabel, colSpan: 3, styles: { fillColor: '#1e40af', textColor: '#ffffff', fontStyle: 'bold', fontSize: 10 } }],
             ['Pergunta', 'Status', 'Observação']],
      body: catItems.map(item => [
        item.questionText || '—',
        item.result === 'ok' ? '✓ Conforme' : item.result === 'nok' ? '✗ Não Conforme' : '— N/A',
        item.observation || '',
      ]),
      theme: 'grid',
      headStyles: { fillColor: '#334155', textColor: '#ffffff', fontStyle: 'bold', fontSize: 9, cellPadding: 3 },
      bodyStyles: { fontSize: 9, cellPadding: 3 },
      columnStyles: {
        0: { cellWidth: 100 },
        1: { cellWidth: 35, halign: 'center' },
        2: { cellWidth: 'auto' },
      },
      didParseCell: (data: any) => {
        if (data.section === 'body' && data.column.index === 1) {
          const val = String(data.cell.raw || '');
          if (val.includes('Conforme') && !val.includes('Não')) {
            data.cell.styles.textColor = '#16a34a';
            data.cell.styles.fillColor = '#f0fdf4';
          } else if (val.includes('Não Conforme')) {
            data.cell.styles.textColor = '#dc2626';
            data.cell.styles.fillColor = '#fef2f2';
          }
        }
      },
      margin: { left: margin, right: margin },
      pageBreak: 'auto',
    });

    y = (doc as any).lastAutoTable.finalY + 6;
  }

  // ─── OBSERVAÇÕES GERAIS ─────────────────────────────────
  if (evaluation.notes) {
    if (y > pageH - 40) { doc.addPage(); y = margin; }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor('#1e293b');
    doc.text('Observações Gerais:', margin, y);
    y += 5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor('#475569');
    const obsLines = doc.splitTextToSize(evaluation.notes, pageW - margin * 2);
    doc.text(obsLines, margin, y);
    y += obsLines.length * 4.5 + 6;
  }

  // ─── RODAPÉ COM ASSINATURA ─────────────────────────────
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setDrawColor('#e2e8f0');
    doc.line(margin, pageH - 20, pageW - margin, pageH - 20);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor('#94a3b8');
    doc.text(`${companyName} — Relatório de Vigilância Sanitária`, margin, pageH - 14);
    doc.text(`Página ${p} de ${totalPages}`, pageW - margin, pageH - 14, { align: 'right' });
    // Linha de assinatura na última página
    if (p === totalPages) {
      const sigY = pageH - 35;
      doc.line(margin, sigY, margin + 70, sigY);
      doc.setFontSize(8);
      doc.text(evaluation.evaluatorName || 'Responsável', margin + 35, sigY + 4, { align: 'center' });
      doc.text('Assinatura do Responsável', margin + 35, sigY + 8, { align: 'center' });
      doc.line(pageW - margin - 70, sigY, pageW - margin, sigY);
      doc.text(evalDate, pageW - margin - 35, sigY + 4, { align: 'center' });
      doc.text('Data', pageW - margin - 35, sigY + 8, { align: 'center' });
    }
  }

  return doc;
}

// ─── Print HTML ────────────────────────────────────────────────────────────────
function buildPrintHTML(evaluation: any, items: any[], companyConfig: any): string {
  const score = evaluation.score !== null && evaluation.score !== undefined ? Number(evaluation.score) : null;
  const scoreColor = score === null ? '#6b7280' : score >= 90 ? '#16a34a' : score >= 70 ? '#d97706' : '#dc2626';
  const scoreLabel = score === null ? '—' : score >= 90 ? 'ÓTIMO' : score >= 70 ? 'MÉDIO' : 'CRÍTICO';
  const evalDate = evaluation.evaluationDate
    ? new Date(evaluation.evaluationDate).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '—';
  const companyName = companyConfig?.companyName || 'VivaFrutaz';
  const okCount = items.filter(i => i.result === 'ok').length;
  const nokCount = items.filter(i => i.result === 'nok').length;
  const categories = Array.from(new Set(items.map(i => i.questionCategory || 'geral')));

  const logoHtml = companyConfig?.logoBase64
    ? `<img src="data:${companyConfig.logoType || 'image/png'};base64,${companyConfig.logoBase64}" alt="Logo" style="height:48px;object-fit:contain;">`
    : `<div style="width:48px;height:48px;background:#1e40af;border-radius:8px;display:flex;align-items:center;justify-content:center;color:white;font-size:20px;font-weight:bold;">${companyName.charAt(0)}</div>`;

  const categorySections = categories.map(cat => {
    const catItems = items.filter(i => (i.questionCategory || 'geral') === cat);
    const catLabel = CATEGORY_LABELS_PDF[cat] || cat.charAt(0).toUpperCase() + cat.slice(1);
    const rows = catItems.map(item => `
      <tr>
        <td>${item.questionText || '—'}</td>
        <td style="text-align:center;font-weight:600;color:${item.result === 'ok' ? '#16a34a' : item.result === 'nok' ? '#dc2626' : '#6b7280'};background:${item.result === 'ok' ? '#f0fdf4' : item.result === 'nok' ? '#fef2f2' : 'transparent'}">
          ${item.result === 'ok' ? '✓ Conforme' : item.result === 'nok' ? '✗ Não Conforme' : '— N/A'}
        </td>
        <td>${item.observation || ''}</td>
      </tr>`).join('');
    return `
      <div class="category-section">
        <h3 class="category-title">${catLabel}</h3>
        <table>
          <thead><tr><th style="width:55%">Pergunta</th><th style="width:20%;text-align:center">Status</th><th>Observação</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Relatório de Vigilância Sanitária — ${companyName}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #1e293b; background: white; }
    @page { margin: 15mm; }
    .header { display: flex; align-items: center; gap: 16px; border-bottom: 2px solid #e2e8f0; padding-bottom: 14px; margin-bottom: 14px; }
    .header-text h1 { font-size: 20px; font-weight: 700; color: #1e293b; }
    .header-text p { font-size: 12px; color: #64748b; margin-top: 2px; }
    .info-score { display: flex; gap: 20px; margin-bottom: 14px; }
    .info-table { flex: 1; border-collapse: collapse; }
    .info-table td { padding: 4px 8px 4px 0; font-size: 11px; }
    .info-table td:first-child { font-weight: 700; width: 110px; color: #475569; }
    .score-box { min-width: 120px; border-radius: 10px; border: 2px solid ${scoreColor}; background: ${score !== null && score >= 90 ? '#f0fdf4' : score !== null && score >= 70 ? '#fffbeb' : score !== null ? '#fef2f2' : '#f8fafc'}; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 12px; text-align: center; }
    .score-pct { font-size: 28px; font-weight: 800; color: ${scoreColor}; line-height: 1; }
    .score-label { font-size: 11px; font-weight: 700; color: ${scoreColor}; margin-top: 4px; }
    .summary { display: flex; gap: 8px; margin-bottom: 16px; }
    .summary-item { flex: 1; border-radius: 8px; padding: 10px; text-align: center; border: 1px solid #e2e8f0; }
    .summary-item.ok { background: #f0fdf4; border-color: #bbf7d0; }
    .summary-item.nok { background: #fef2f2; border-color: #fecaca; }
    .summary-val { font-size: 22px; font-weight: 800; }
    .summary-item .summary-val { color: #475569; }
    .summary-item.ok .summary-val { color: #16a34a; }
    .summary-item.nok .summary-val { color: #dc2626; }
    .summary-lbl { font-size: 10px; color: #64748b; margin-top: 2px; }
    .category-section { margin-bottom: 16px; page-break-inside: avoid; }
    .category-title { font-size: 13px; font-weight: 700; color: #1e40af; background: #eff6ff; padding: 6px 10px; border-left: 4px solid #1e40af; margin-bottom: 6px; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    th { background: #334155; color: white; padding: 6px 8px; text-align: left; font-size: 11px; }
    td { padding: 5px 8px; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
    tr:nth-child(even) td { background: #f8fafc; }
    .footer { margin-top: 24px; border-top: 1px solid #e2e8f0; padding-top: 12px; display: flex; justify-content: space-between; font-size: 10px; color: #94a3b8; }
    .sig-line { margin-top: 20px; display: flex; justify-content: space-between; }
    .sig-item { text-align: center; width: 45%; }
    .sig-item .line { border-top: 1px solid #475569; padding-top: 6px; margin-top: 30px; font-size: 10px; color: #64748b; }
    @media print { .no-print { display: none !important; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  </style>
</head>
<body>
  <div class="header">
    ${logoHtml}
    <div class="header-text">
      <h1>${companyName}</h1>
      <p>Relatório de Vigilância Sanitária</p>
    </div>
  </div>

  <div class="info-score">
    <table class="info-table">
      <tr><td>Avaliação:</td><td><strong>${evaluation.title || 'Avaliação Sanitária'}</strong></td></tr>
      <tr><td>Data/Hora:</td><td>${evalDate}</td></tr>
      <tr><td>Responsável:</td><td>${evaluation.evaluatorName || '—'}</td></tr>
      <tr><td>Status:</td><td>${evaluation.status === 'concluida' ? '✅ Concluída' : '⏳ Em andamento'}</td></tr>
      ${companyConfig?.address ? `<tr><td>Local:</td><td>${companyConfig.address}${companyConfig.city ? ', ' + companyConfig.city : ''}</td></tr>` : ''}
    </table>
    ${score !== null ? `<div class="score-box"><div class="score-pct">${score.toFixed(1)}%</div><div class="score-label">${scoreLabel}</div></div>` : ''}
  </div>

  <div class="summary">
    <div class="summary-item"><div class="summary-val">${items.length}</div><div class="summary-lbl">Total de Itens</div></div>
    <div class="summary-item ok"><div class="summary-val">${okCount}</div><div class="summary-lbl">Conformes ✓</div></div>
    <div class="summary-item nok"><div class="summary-val">${nokCount}</div><div class="summary-lbl">Não Conformes ✗</div></div>
    <div class="summary-item"><div class="summary-val">${items.length - okCount - nokCount}</div><div class="summary-lbl">Não Respondidos</div></div>
  </div>

  ${categorySections}

  ${evaluation.notes ? `<div style="margin-top:16px;padding:12px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;"><strong style="font-size:11px;">Observações Gerais:</strong><p style="font-size:11px;color:#475569;margin-top:4px;">${evaluation.notes}</p></div>` : ''}

  <div class="sig-line">
    <div class="sig-item"><div class="line">${evaluation.evaluatorName || 'Responsável'}<br>Assinatura do Responsável</div></div>
    <div class="sig-item"><div class="line">${evalDate}<br>Data</div></div>
  </div>

  <div class="footer">
    <span>${companyName} — Relatório de Vigilância Sanitária</span>
    <span>Gerado em ${new Date().toLocaleDateString('pt-BR')}</span>
  </div>
</body>
</html>`;
}

const CATEGORY_LABELS: Record<string, string> = {
  higiene: "🧼 Higiene",
  temperatura: "🌡️ Temperatura",
  armazenamento: "📦 Armazenamento",
  pessoal: "👤 Pessoal",
  equipamentos: "🔧 Equipamentos",
  geral: "📋 Geral",
};

const CATEGORY_OPTIONS = Object.entries(CATEGORY_LABELS);

// Default checklist questions to seed on first load
const DEFAULT_QUESTIONS = [
  { question: "As mãos dos manipuladores estão lavadas e higienizadas?", category: "pessoal", order: 1 },
  { question: "Os uniformes e EPIs estão limpos e em bom estado?", category: "pessoal", order: 2 },
  { question: "Há presença de adornos (anéis, pulseiras, relógio) nos manipuladores?", category: "pessoal", order: 3 },
  { question: "As superfícies de manipulação estão higienizadas?", category: "higiene", order: 4 },
  { question: "Os utensílios estão limpos e sanitizados?", category: "higiene", order: 5 },
  { question: "O ambiente está livre de pragas e vetores?", category: "higiene", order: 6 },
  { question: "A temperatura da câmara fria está dentro do padrão (0–8°C)?", category: "temperatura", order: 7 },
  { question: "Os termômetros estão calibrados e aferidos?", category: "temperatura", order: 8 },
  { question: "Os produtos estão armazenados corretamente (data, lote, PVPS)?", category: "armazenamento", order: 9 },
  { question: "Não há produtos vencidos ou em condições impróprias?", category: "armazenamento", order: 10 },
  { question: "Os equipamentos de frio estão funcionando corretamente?", category: "equipamentos", order: 11 },
  { question: "Os registros de controle de temperatura estão sendo preenchidos?", category: "equipamentos", order: 12 },
  { question: "O local está organizado e com boa iluminação?", category: "geral", order: 13 },
  { question: "Os lixos estão devidamente acondicionados e identificados?", category: "geral", order: 14 },
];

function ScoreDisplay({ score }: { score: number | null }) {
  if (score === null) return null;
  const pct = Number(score);
  let emoji = "🙂", label = "Ótimo", color = "text-green-600", bg = "bg-green-50 border-green-200";
  if (pct < 70) { emoji = "🚨"; label = "Crítico"; color = "text-red-600"; bg = "bg-red-50 border-red-200"; }
  else if (pct < 90) { emoji = "😐"; label = "Médio"; color = "text-yellow-600"; bg = "bg-yellow-50 border-yellow-200"; }
  return (
    <div className={`rounded-xl border-2 p-6 text-center ${bg}`}>
      <div className="text-6xl mb-2">{emoji}</div>
      <div className={`text-4xl font-bold ${color}`}>{pct.toFixed(1)}%</div>
      <div className={`text-lg font-semibold mt-1 ${color}`}>{label}</div>
    </div>
  );
}

export default function SanitaryPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("checklist");
  const [selectedEvalId, setSelectedEvalId] = useState<number | null>(null);
  const [showNewEvalDialog, setShowNewEvalDialog] = useState(false);
  const [newEvalTitle, setNewEvalTitle] = useState("");
  const [showQuestionDialog, setShowQuestionDialog] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<any>(null);
  const [questionForm, setQuestionForm] = useState({ question: "", category: "geral", order: 0 });
  const [pdfLoadingId, setPdfLoadingId] = useState<number | null>(null);
  const [printLoadingId, setPrintLoadingId] = useState<number | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [previewHtml, setPreviewHtml] = useState("");

  const { data: planStatus, isLoading: planLoading } = useQuery<{ enabled: boolean; level: 'none' | 'readonly' | 'full' }>({
    queryKey: ['/api/sanitary/plan-status'],
  });
  const { data: companyConfig } = useQuery<any>({ queryKey: ['/api/company-config'] });

  // Acesso baseado em role + plano
  const planLevel = planStatus?.level ?? 'full'; // fallback full enquanto carrega
  const planEnabled = planStatus?.enabled !== false;

  const isNutri = planEnabled && user && ['ADMIN', 'DIRECTOR', 'DEVELOPER', 'NUTRICIONISTA', 'OPERATIONS_MANAGER'].includes(user.role);
  const canEdit = planEnabled && planLevel === 'full' && user && ['ADMIN', 'DIRECTOR', 'DEVELOPER', 'NUTRICIONISTA'].includes(user.role);

  const { data: questions = [], isLoading: qLoading } = useQuery<any[]>({ queryKey: ['/api/sanitary/questions'], enabled: planEnabled });
  const { data: evaluations = [], isLoading: evLoading } = useQuery<any[]>({ queryKey: ['/api/sanitary/evaluations'] });
  const { data: evalDetail, isLoading: detailLoading } = useQuery<any>({
    queryKey: ['/api/sanitary/evaluations', selectedEvalId],
    enabled: !!selectedEvalId,
  });

  // Seed default questions if none exist
  const seedMutation = useMutation({
    mutationFn: async () => {
      for (const q of DEFAULT_QUESTIONS) {
        await apiRequest('POST', '/api/sanitary/questions', q);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/sanitary/questions'] });
      toast({ title: "Checklist padrão carregado com sucesso!" });
    },
  });

  const createQuestionMutation = useMutation({
    mutationFn: (data: any) => apiRequest('POST', '/api/sanitary/questions', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/sanitary/questions'] });
      setShowQuestionDialog(false);
      toast({ title: "Pergunta salva!" });
    },
  });

  const updateQuestionMutation = useMutation({
    mutationFn: ({ id, data }: any) => apiRequest('PATCH', `/api/sanitary/questions/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/sanitary/questions'] });
      setShowQuestionDialog(false);
      toast({ title: "Pergunta atualizada!" });
    },
  });

  const deleteQuestionMutation = useMutation({
    mutationFn: (id: number) => apiRequest('DELETE', `/api/sanitary/questions/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/sanitary/questions'] });
      toast({ title: "Pergunta removida!" });
    },
  });

  const createEvalMutation = useMutation({
    mutationFn: (data: any) => apiRequest('POST', '/api/sanitary/evaluations', data),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/sanitary/evaluations'] });
      setShowNewEvalDialog(false);
      setNewEvalTitle("");
      setSelectedEvalId(data.evaluation?.id || data.id);
      setActiveTab("avaliacao");
      toast({ title: "Avaliação criada! Responda o checklist." });
    },
  });

  const updateItemMutation = useMutation({
    mutationFn: ({ evalId, itemId, data }: any) =>
      apiRequest('PATCH', `/api/sanitary/evaluations/${evalId}/items/${itemId}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/sanitary/evaluations', selectedEvalId] });
    },
  });

  const finalizeEvalMutation = useMutation({
    mutationFn: ({ id, score }: any) =>
      apiRequest('PATCH', `/api/sanitary/evaluations/${id}`, { status: 'concluida', score: score.toFixed(2) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/sanitary/evaluations'] });
      queryClient.invalidateQueries({ queryKey: ['/api/sanitary/evaluations', selectedEvalId] });
      toast({ title: "Avaliação finalizada!", description: "Resultado salvo com sucesso." });
    },
  });

  // Calculate score from items
  const calcScore = (items: any[]) => {
    const answered = items.filter(i => i.result === 'ok' || i.result === 'nok');
    if (answered.length === 0) return null;
    const ok = items.filter(i => i.result === 'ok').length;
    return (ok / answered.length) * 100;
  };

  // Group questions by category
  const groupedQuestions = useMemo(() => {
    const groups: Record<string, any[]> = {};
    for (const q of questions) {
      if (!groups[q.category]) groups[q.category] = [];
      groups[q.category].push(q);
    }
    return groups;
  }, [questions]);

  // Group eval items by category
  const groupedItems = useMemo(() => {
    if (!evalDetail?.items) return {};
    const groups: Record<string, any[]> = {};
    for (const item of evalDetail.items) {
      const cat = item.questionCategory || 'geral';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(item);
    }
    return groups;
  }, [evalDetail]);

  const currentScore = evalDetail?.items ? calcScore(evalDetail.items) : null;
  const totalAnswered = evalDetail?.items ? evalDetail.items.filter((i: any) => i.result === 'ok' || i.result === 'nok').length : 0;
  const totalItems = evalDetail?.items?.length || 0;

  function openEditQuestion(q: any) {
    setEditingQuestion(q);
    setQuestionForm({ question: q.question, category: q.category, order: q.order });
    setShowQuestionDialog(true);
  }

  function openNewQuestion() {
    setEditingQuestion(null);
    setQuestionForm({ question: "", category: "geral", order: (questions.length + 1) * 10 });
    setShowQuestionDialog(true);
  }

  function saveQuestion() {
    if (!questionForm.question.trim()) return;
    if (editingQuestion) {
      updateQuestionMutation.mutate({ id: editingQuestion.id, data: questionForm });
    } else {
      createQuestionMutation.mutate(questionForm);
    }
  }

  function handleItemResult(item: any, result: string) {
    if (!selectedEvalId) return;
    if (evalDetail?.evaluation?.status === 'concluida') return;
    updateItemMutation.mutate({
      evalId: selectedEvalId,
      itemId: item.id,
      data: { result, observation: item.observation || null },
    });
  }

  function handleItemObservation(item: any, observation: string) {
    if (!selectedEvalId) return;
    if (evalDetail?.evaluation?.status === 'concluida') return;
    updateItemMutation.mutate({
      evalId: selectedEvalId,
      itemId: item.id,
      data: { result: item.result || null, observation },
    });
  }

  function handleFinalize() {
    if (!selectedEvalId || currentScore === null) return;
    finalizeEvalMutation.mutate({ id: selectedEvalId, score: currentScore });
  }

  async function fetchEvalDetail(evalId: number): Promise<{ evaluation: any; items: any[] }> {
    const res = await fetch(`/api/sanitary/evaluations/${evalId}`, { credentials: 'include' });
    return res.json();
  }

  async function handleGeneratePDF(ev: any) {
    if (!ev?.id) return;
    if (!ev.score && ev.status !== 'concluida') {
      toast({ title: "Relatório vazio", description: "Finalize a avaliação antes de gerar o PDF.", variant: "destructive" });
      return;
    }
    setPdfLoadingId(ev.id);
    try {
      let detail: any;
      if (selectedEvalId === ev.id && evalDetail) {
        detail = evalDetail;
      } else {
        detail = await fetchEvalDetail(ev.id);
      }
      if (!detail?.items?.length) {
        toast({ title: "Relatório vazio", description: "Nenhum item encontrado nesta avaliação.", variant: "destructive" });
        return;
      }
      const doc = await generateSanitaryPDF(detail.evaluation, detail.items, companyConfig);
      const fname = `relatorio-vigilancia-${ev.id}-${new Date().toISOString().slice(0, 10)}.pdf`;
      doc.save(fname);
      toast({ title: "PDF gerado com sucesso!", description: fname });
    } catch (err: any) {
      toast({ title: "Erro ao gerar PDF", description: String(err?.message || err), variant: "destructive" });
    } finally {
      setPdfLoadingId(null);
    }
  }

  async function handlePrint(ev: any) {
    if (!ev?.id) return;
    setPrintLoadingId(ev.id);
    try {
      let detail: any;
      if (selectedEvalId === ev.id && evalDetail) {
        detail = evalDetail;
      } else {
        detail = await fetchEvalDetail(ev.id);
      }
      if (!detail?.items?.length) {
        toast({ title: "Relatório vazio", description: "Nenhum item encontrado nesta avaliação.", variant: "destructive" });
        return;
      }
      const html = buildPrintHTML(detail.evaluation, detail.items, companyConfig);
      setPreviewHtml(html);
      setShowPreview(true);
    } catch (err: any) {
      toast({ title: "Erro ao preparar impressão", description: String(err?.message || err), variant: "destructive" });
    } finally {
      setPrintLoadingId(null);
    }
  }

  function doPrint() {
    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) return;
    win.document.write(previewHtml);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); }, 500);
  }

  const progressPct = totalItems > 0 ? (totalAnswered / totalItems) * 100 : 0;

  // ─── Tela de bloqueio por plano ──────────────────────────────
  if (!planLoading && !planEnabled) {
    return (
      <Layout>
        <div className="p-6 max-w-2xl mx-auto flex flex-col items-center justify-center min-h-[60vh] text-center gap-6">
          <div className="w-20 h-20 rounded-2xl bg-red-100 flex items-center justify-center">
            <Lock className="w-10 h-10 text-red-500" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground mb-2">Módulo não disponível</h1>
            <p className="text-muted-foreground">
              O módulo de <strong>Vigilância Sanitária</strong> não está incluído no plano atual.
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              Faça upgrade para o <strong>Plano Intermediário</strong> (visualização de relatórios) ou
              <strong> Plano Completo</strong> (acesso total com Nutricionista).
            </p>
          </div>
          <div className="flex gap-3 flex-wrap justify-center">
            <Badge variant="outline" className="text-yellow-700 border-yellow-300 bg-yellow-50 px-3 py-1.5 text-sm">
              📊 Plano Intermediário → Apenas Relatórios
            </Badge>
            <Badge variant="outline" className="text-green-700 border-green-300 bg-green-50 px-3 py-1.5 text-sm">
              ✅ Plano Completo → Acesso Total (Nutricionista)
            </Badge>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="p-6 max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
            <ShieldCheck className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Vigilância Sanitária</h1>
            <p className="text-sm text-muted-foreground">Checklist e avaliações de conformidade sanitária</p>
          </div>
          {planLevel === 'readonly' && (
            <div className="ml-auto flex items-center gap-2 px-3 py-1.5 rounded-lg bg-yellow-50 border border-yellow-200 text-yellow-700 text-xs font-semibold">
              <Eye className="w-3.5 h-3.5" />
              Somente Leitura — seu plano permite apenas visualizar relatórios
            </div>
          )}
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-6">
            <TabsTrigger value="checklist" data-testid="tab-checklist">
              <ClipboardList className="w-4 h-4 mr-2" />
              Checklist
            </TabsTrigger>
            <TabsTrigger value="avaliacao" data-testid="tab-avaliacao">
              <CheckCircle2 className="w-4 h-4 mr-2" />
              Avaliação
            </TabsTrigger>
            <TabsTrigger value="relatorios" data-testid="tab-relatorios">
              <BarChart3 className="w-4 h-4 mr-2" />
              Relatórios
            </TabsTrigger>
          </TabsList>

          {/* ─── ABA CHECKLIST ─────────────────────────────── */}
          <TabsContent value="checklist">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Perguntas do Checklist</h2>
              <div className="flex gap-2">
                {canEdit && questions.length === 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => seedMutation.mutate()}
                    disabled={seedMutation.isPending}
                    data-testid="button-seed-questions"
                  >
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Carregar Padrão
                  </Button>
                )}
                {canEdit && (
                  <Button type="button" onClick={openNewQuestion} data-testid="button-add-question">
                    <Plus className="w-4 h-4 mr-2" />
                    Nova Pergunta
                  </Button>
                )}
              </div>
            </div>

            {qLoading ? (
              <div className="text-center py-12 text-muted-foreground">Carregando perguntas...</div>
            ) : questions.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="py-12 text-center">
                  <ClipboardList className="w-12 h-12 mx-auto mb-3 text-muted-foreground/40" />
                  <p className="font-medium text-muted-foreground">Nenhuma pergunta cadastrada</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Clique em <strong>Carregar Padrão</strong> para usar o checklist pré-pronto ou adicione manualmente.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-6">
                {Object.entries(groupedQuestions).map(([cat, qs]) => (
                  <div key={cat}>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                        {CATEGORY_LABELS[cat] || cat}
                      </span>
                      <div className="flex-1 h-px bg-border" />
                      <Badge variant="outline">{qs.length}</Badge>
                    </div>
                    <div className="space-y-2">
                      {qs.map((q) => (
                        <div
                          key={q.id}
                          className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-accent/30 transition-colors"
                          data-testid={`question-row-${q.id}`}
                        >
                          <div className="flex-1 text-sm">{q.question}</div>
                          {!q.active && (
                            <Badge variant="secondary" className="text-xs">Inativa</Badge>
                          )}
                          {canEdit && (
                            <div className="flex gap-1 shrink-0">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => openEditQuestion(q)}
                                data-testid={`button-edit-question-${q.id}`}
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="text-destructive hover:text-destructive"
                                onClick={() => {
                                  if (confirm('Remover esta pergunta?')) deleteQuestionMutation.mutate(q.id);
                                }}
                                data-testid={`button-delete-question-${q.id}`}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* ─── ABA AVALIAÇÃO ─────────────────────────────── */}
          <TabsContent value="avaliacao">
            {!selectedEvalId ? (
              <div className="text-center py-16">
                <ShieldCheck className="w-16 h-16 mx-auto mb-4 text-muted-foreground/30" />
                <h3 className="text-lg font-semibold mb-2">Nenhuma avaliação selecionada</h3>
                <p className="text-muted-foreground mb-6">Inicie uma nova avaliação ou selecione uma existente nos Relatórios.</p>
                {isNutri && (
                  <Button
                    type="button"
                    onClick={() => setShowNewEvalDialog(true)}
                    disabled={questions.length === 0}
                    data-testid="button-new-evaluation"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Nova Avaliação
                  </Button>
                )}
                {questions.length === 0 && (
                  <p className="text-sm text-orange-500 mt-3">⚠️ Adicione perguntas ao checklist primeiro.</p>
                )}
              </div>
            ) : detailLoading ? (
              <div className="text-center py-12 text-muted-foreground">Carregando avaliação...</div>
            ) : evalDetail ? (
              <div>
                {/* Header */}
                <div className="flex items-center gap-3 mb-6">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setSelectedEvalId(null)}
                    data-testid="button-back-evaluations"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </Button>
                  <div className="flex-1">
                    <h2 className="text-lg font-bold">{evalDetail.evaluation.title}</h2>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Clock className="w-3.5 h-3.5" />
                      {new Date(evalDetail.evaluation.evaluationDate).toLocaleDateString('pt-BR')}
                      {evalDetail.evaluation.evaluatorName && (
                        <span>• {evalDetail.evaluation.evaluatorName}</span>
                      )}
                      {evalDetail.evaluation.status === 'concluida' ? (
                        <Badge className="bg-green-100 text-green-700 border-green-200">Concluída</Badge>
                      ) : (
                        <Badge variant="outline" className="border-yellow-300 text-yellow-700">Em andamento</Badge>
                      )}
                    </div>
                  </div>
                  {evalDetail.evaluation.status === 'em_andamento' && isNutri && (
                    <Button
                      type="button"
                      onClick={handleFinalize}
                      disabled={totalAnswered === 0 || finalizeEvalMutation.isPending}
                      className="bg-green-600 hover:bg-green-700"
                      data-testid="button-finalize-evaluation"
                    >
                      <CheckCircle2 className="w-4 h-4 mr-2" />
                      Finalizar
                    </Button>
                  )}
                  {evalDetail.evaluation.status === 'concluida' && (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleGeneratePDF(evalDetail.evaluation)}
                        disabled={pdfLoadingId === evalDetail.evaluation.id}
                        data-testid="button-generate-pdf"
                      >
                        {pdfLoadingId === evalDetail.evaluation.id ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <FileText className="w-4 h-4 mr-1" />}
                        Gerar PDF
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handlePrint(evalDetail.evaluation)}
                        disabled={printLoadingId === evalDetail.evaluation.id}
                        data-testid="button-print-evaluation"
                      >
                        {printLoadingId === evalDetail.evaluation.id ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Printer className="w-4 h-4 mr-1" />}
                        Imprimir
                      </Button>
                    </>
                  )}
                </div>

                {/* Score + Progress */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                  <div className="md:col-span-2 space-y-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Progresso da avaliação</span>
                      <span className="font-medium">{totalAnswered}/{totalItems} respondidas</span>
                    </div>
                    <Progress value={progressPct} className="h-3" data-testid="progress-evaluation" />
                    {currentScore !== null && (
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-muted-foreground">Score atual:</span>
                        <span className={`font-bold text-base ${currentScore >= 90 ? 'text-green-600' : currentScore >= 70 ? 'text-yellow-600' : 'text-red-600'}`}>
                          {currentScore.toFixed(1)}%
                        </span>
                      </div>
                    )}
                  </div>
                  <ScoreDisplay score={evalDetail.evaluation.status === 'concluida' ? evalDetail.evaluation.score : currentScore} />
                </div>

                {/* Items by category */}
                <div className="space-y-6">
                  {Object.entries(groupedItems).map(([cat, items]) => (
                    <div key={cat}>
                      <div className="flex items-center gap-2 mb-3">
                        <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                          {CATEGORY_LABELS[cat] || cat}
                        </span>
                        <div className="flex-1 h-px bg-border" />
                        <Badge variant="outline" className="text-xs">
                          {(items as any[]).filter(i => i.result === 'ok').length}/{(items as any[]).length} OK
                        </Badge>
                      </div>
                      <div className="space-y-3">
                        {(items as any[]).map((item) => (
                          <div
                            key={item.id}
                            className={`rounded-lg border p-4 transition-colors ${
                              item.result === 'ok'
                                ? 'bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-800'
                                : item.result === 'nok'
                                ? 'bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-800'
                                : 'bg-card'
                            }`}
                            data-testid={`eval-item-${item.id}`}
                          >
                            <div className="flex items-start gap-4">
                              <div className="flex-1">
                                <p className="text-sm font-medium">{item.questionText}</p>
                              </div>
                              {evalDetail.evaluation.status !== 'concluida' ? (
                                <div className="flex gap-2 shrink-0">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant={item.result === 'ok' ? 'default' : 'outline'}
                                    className={item.result === 'ok' ? 'bg-green-600 hover:bg-green-700 text-white' : 'border-green-300 text-green-700 hover:bg-green-50'}
                                    onClick={() => handleItemResult(item, 'ok')}
                                    data-testid={`button-ok-${item.id}`}
                                  >
                                    <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                                    OK
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant={item.result === 'nok' ? 'destructive' : 'outline'}
                                    className={item.result !== 'nok' ? 'border-red-300 text-red-700 hover:bg-red-50' : ''}
                                    onClick={() => handleItemResult(item, 'nok')}
                                    data-testid={`button-nok-${item.id}`}
                                  >
                                    <XCircle className="w-3.5 h-3.5 mr-1" />
                                    NÃO OK
                                  </Button>
                                </div>
                              ) : (
                                <div className="shrink-0">
                                  {item.result === 'ok' ? (
                                    <CheckCircle2 className="w-5 h-5 text-green-600" />
                                  ) : item.result === 'nok' ? (
                                    <XCircle className="w-5 h-5 text-red-600" />
                                  ) : (
                                    <span className="text-xs text-muted-foreground">—</span>
                                  )}
                                </div>
                              )}
                            </div>
                            {(item.result === 'nok' || item.observation) && evalDetail.evaluation.status !== 'concluida' && (
                              <div className="mt-3">
                                <Textarea
                                  placeholder="Observação (opcional)..."
                                  className="text-sm min-h-[60px]"
                                  defaultValue={item.observation || ""}
                                  onBlur={(e) => handleItemObservation(item, e.target.value)}
                                  data-testid={`textarea-obs-${item.id}`}
                                />
                              </div>
                            )}
                            {item.observation && evalDetail.evaluation.status === 'concluida' && (
                              <p className="text-xs text-muted-foreground mt-2 italic">📝 {item.observation}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {!selectedEvalId && isNutri && (
              <div className="mt-4 text-center">
                <Button
                  type="button"
                  onClick={() => setShowNewEvalDialog(true)}
                  disabled={questions.length === 0}
                  data-testid="button-new-evaluation-bottom"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Nova Avaliação
                </Button>
              </div>
            )}
          </TabsContent>

          {/* ─── ABA RELATÓRIOS ─────────────────────────────── */}
          <TabsContent value="relatorios">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Histórico de Avaliações</h2>
              {isNutri && (
                <Button
                  type="button"
                  onClick={() => setShowNewEvalDialog(true)}
                  disabled={questions.length === 0}
                  data-testid="button-new-evaluation-relatorios"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Nova Avaliação
                </Button>
              )}
            </div>

            {evLoading ? (
              <div className="text-center py-12 text-muted-foreground">Carregando...</div>
            ) : evaluations.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="py-12 text-center">
                  <BarChart3 className="w-12 h-12 mx-auto mb-3 text-muted-foreground/40" />
                  <p className="font-medium text-muted-foreground">Nenhuma avaliação realizada ainda</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {evaluations.map((ev: any) => {
                  const score = ev.score !== null ? Number(ev.score) : null;
                  let emoji = "⏳", badgeClass = "bg-gray-100 text-gray-600";
                  if (score !== null) {
                    if (score >= 90) { emoji = "🙂"; badgeClass = "bg-green-100 text-green-700"; }
                    else if (score >= 70) { emoji = "😐"; badgeClass = "bg-yellow-100 text-yellow-700"; }
                    else { emoji = "🚨"; badgeClass = "bg-red-100 text-red-700"; }
                  }
                  return (
                    <div
                      key={ev.id}
                      className="flex items-center gap-4 p-4 rounded-lg border bg-card hover:bg-accent/30 cursor-pointer transition-colors"
                      onClick={() => {
                        setSelectedEvalId(ev.id);
                        setActiveTab("avaliacao");
                      }}
                      data-testid={`evaluation-row-${ev.id}`}
                    >
                      <div className="text-2xl">{emoji}</div>
                      <div className="flex-1">
                        <p className="font-medium">{ev.title}</p>
                        <p className="text-sm text-muted-foreground">
                          {new Date(ev.evaluationDate).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                          {ev.evaluatorName && ` • ${ev.evaluatorName}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {score !== null ? (
                          <span className={`text-sm font-bold px-2 py-1 rounded-full ${badgeClass}`}>
                            {score.toFixed(1)}%
                          </span>
                        ) : (
                          <Badge variant="outline" className="text-yellow-600 border-yellow-300">Em andamento</Badge>
                        )}
                        {ev.status === 'concluida' && (
                          <>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={(e) => { e.stopPropagation(); handleGeneratePDF(ev); }}
                              disabled={pdfLoadingId === ev.id}
                              data-testid={`button-pdf-${ev.id}`}
                            >
                              {pdfLoadingId === ev.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />}
                              <span className="ml-1">PDF</span>
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={(e) => { e.stopPropagation(); handlePrint(ev); }}
                              disabled={printLoadingId === ev.id}
                              data-testid={`button-print-${ev.id}`}
                            >
                              {printLoadingId === ev.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Printer className="w-3 h-3" />}
                              <span className="ml-1">Imprimir</span>
                            </Button>
                          </>
                        )}
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* ─── DIALOG: Nova Pergunta ─────────────────────── */}
      <Dialog open={showQuestionDialog} onOpenChange={setShowQuestionDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingQuestion ? 'Editar Pergunta' : 'Nova Pergunta'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium mb-1 block">Pergunta *</label>
              <Textarea
                value={questionForm.question}
                onChange={(e) => setQuestionForm(p => ({ ...p, question: e.target.value }))}
                placeholder="Ex: As mãos estão higienizadas?"
                className="min-h-[80px]"
                data-testid="input-question-text"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Categoria</label>
              <Select
                value={questionForm.category}
                onValueChange={(v) => setQuestionForm(p => ({ ...p, category: v }))}
              >
                <SelectTrigger data-testid="select-question-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORY_OPTIONS.map(([key, label]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Ordem</label>
              <Input
                type="number"
                value={questionForm.order}
                onChange={(e) => setQuestionForm(p => ({ ...p, order: Number(e.target.value) }))}
                data-testid="input-question-order"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setShowQuestionDialog(false)}>Cancelar</Button>
            <Button
              type="button"
              onClick={saveQuestion}
              disabled={!questionForm.question.trim() || createQuestionMutation.isPending || updateQuestionMutation.isPending}
              data-testid="button-save-question"
            >
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── DIALOG: Nova Avaliação ─────────────────────── */}
      <Dialog open={showNewEvalDialog} onOpenChange={setShowNewEvalDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova Avaliação Sanitária</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium mb-1 block">Título da Avaliação</label>
              <Input
                value={newEvalTitle}
                onChange={(e) => setNewEvalTitle(e.target.value)}
                placeholder="Ex: Avaliação Mensal - Março 2026"
                data-testid="input-eval-title"
              />
            </div>
            <p className="text-sm text-muted-foreground">
              O checklist será gerado automaticamente com as {questions.filter(q => q.active).length} perguntas ativas.
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setShowNewEvalDialog(false)}>Cancelar</Button>
            <Button
              type="button"
              onClick={() => createEvalMutation.mutate({ title: newEvalTitle || 'Nova Avaliação Sanitária' })}
              disabled={createEvalMutation.isPending}
              data-testid="button-create-evaluation"
            >
              {createEvalMutation.isPending ? 'Criando...' : 'Iniciar Avaliação'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── DIALOG: Pré-visualização de Impressão ──────── */}
      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent className="max-w-4xl w-full max-h-[90vh] flex flex-col p-0">
          <DialogHeader className="px-6 py-4 border-b">
            <DialogTitle className="flex items-center gap-2">
              <Printer className="w-5 h-5" />
              Pré-visualização do Relatório
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-hidden">
            <iframe
              srcDoc={previewHtml}
              className="w-full h-[60vh] border-0"
              title="Preview do Relatório"
              data-testid="iframe-print-preview"
            />
          </div>
          <DialogFooter className="px-6 py-4 border-t gap-2">
            <Button type="button" variant="outline" onClick={() => setShowPreview(false)}>
              Fechar
            </Button>
            <Button
              type="button"
              onClick={doPrint}
              className="bg-blue-600 hover:bg-blue-700"
              data-testid="button-confirm-print"
            >
              <Printer className="w-4 h-4 mr-2" />
              Imprimir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
