import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  FileText, Camera, Upload, Image, AlertTriangle, CheckCircle2,
  Loader2, X, Edit2, Plus, Trash2, Download, RefreshCw,
  Search, Building2, Hash, Calendar, DollarSign, Package, Eye,
  FileDown
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";

type InvoiceItem = {
  name: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  totalPrice: string;
  category: string;
  linkedProductId?: number | null;
  linkedProductName?: string;
};

type ParsedInvoice = {
  invoiceNumber: string;
  supplier: string;
  supplierCnpj: string;
  issueDate: string;
  totalValue: string;
  items: InvoiceItem[];
};

type FiscalInvoice = {
  id: number;
  invoiceNumber: string;
  supplier: string;
  supplierCnpj: string | null;
  issueDate: string | null;
  totalValue: string | null;
  items: InvoiceItem[];
  status: string;
  importedAt: string;
  importedBy: number | null;
  notes: string | null;
  fileType: string | null;
  fileName: string | null;
};

// ─── Brazilian NF-e Text Parser ─────────────────────────────────────────────
function parseNFeText(text: string): Partial<ParsedInvoice> {
  const result: Partial<ParsedInvoice> = {};
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // CNPJ: 14 digits formatted as XX.XXX.XXX/XXXX-XX
  const cnpjMatch = text.match(/(\d{2}[.\s]?\d{3}[.\s]?\d{3}[/\s]?\d{4}[-\s]?\d{2})/);
  if (cnpjMatch) result.supplierCnpj = cnpjMatch[1].replace(/[^\d]/g, '').replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');

  // Invoice number: look for NF, Nota Fiscal, NF-e, número patterns
  const nfMatch = text.match(/(?:N[Ff][-.\s]?e?|NOTA\s+FISCAL\s+(?:ELETR[ÔO]NICA\s+)?N[Rr°º]?\.?\s*)(\d{1,15})/i);
  if (nfMatch) result.invoiceNumber = nfMatch[1].trim();

  // Date: DD/MM/YYYY or YYYY-MM-DD patterns
  const dateMatches = text.match(/(\d{2}\/\d{2}\/\d{4})/g);
  if (dateMatches && dateMatches.length > 0) {
    const [d, m, y] = dateMatches[0].split('/');
    result.issueDate = `${y}-${m}-${d}`;
  }

  // Supplier: first company name after "EMITENTE" or "REMETENTE" or before CNPJ
  const emitenteIdx = lines.findIndex(l => /emitente|remetente|raz[aã]o\s+social/i.test(l));
  if (emitenteIdx >= 0 && lines[emitenteIdx + 1]) {
    result.supplier = lines[emitenteIdx + 1].replace(/cnpj.*$/i, '').trim();
  }

  // Total value: TOTAL patterns
  const totalMatch = text.match(/(?:valor\s+total\s+(?:da\s+nota|nf)?|total\s+geral)[:\s]+R?\$?\s*([\d.,]+)/i);
  if (totalMatch) {
    result.totalValue = totalMatch[1].replace('.', '').replace(',', '.');
  }

  // Parse product table — look for quantity + description patterns
  const items: InvoiceItem[] = [];
  const tablePattern = /(\d+[,.]?\d*)\s+(kg|un|cx|sc|bd|lt|pote|display|fardo|saco|KG|UN|CX|SC)\s+(.{3,50}?)\s+([\d.,]+)\s+([\d.,]+)/gi;
  let tableMatch;
  while ((tableMatch = tablePattern.exec(text)) !== null) {
    const qty = tableMatch[1].replace(',', '.');
    const unit = tableMatch[2].toUpperCase();
    const name = tableMatch[3].trim();
    const unitPrice = tableMatch[4].replace('.', '').replace(',', '.');
    const totalPrice = tableMatch[5].replace('.', '').replace(',', '.');
    if (name.length > 2 && parseFloat(qty) > 0) {
      items.push({ name, quantity: qty, unit, unitPrice, totalPrice, category: guessCategory(name) });
    }
  }

  // Alternative: simpler line-by-line product detection
  if (items.length === 0) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Look for lines that seem like product entries (fruit/produce names)
      if (/\b(ban|mac|lar|mor|man|uva|aba|mel|pap|pêr|kiwi|lim|coc|goi|açaí|caju)\w*/i.test(line)) {
        const qtyMatch = lines[i + 1]?.match(/(\d+[,.]?\d*)\s*(kg|un|cx|kilo)?/i);
        if (qtyMatch) {
          items.push({
            name: line.trim(),
            quantity: qtyMatch[1],
            unit: (qtyMatch[2] || 'kg').toUpperCase(),
            unitPrice: '',
            totalPrice: '',
            category: guessCategory(line),
          });
        }
      }
    }
  }

  if (items.length > 0) result.items = items;
  return result;
}

function guessCategory(name: string): string {
  const lower = name.toLowerCase();
  if (/banana|maçã|maca|laranja|limão|limao|morango|manga|uva|abacaxi|melancia|mamão|mamao|pêssego|pessego|kiwi|pera|cereja|abacate|goiaba|açaí|acai|caju|tangerina|framboesa|melão|melao|figo|pitaya|coco|ameixa|fruta/.test(lower)) return 'Frutas';
  if (/alface|espinafre|tomate|cenoura|cebola|batata|beterraba|couve|brócol|brocol|pepino|abobrinha|pimentão|pimenta|hortel|salsa|cheiro|verdura|legume/.test(lower)) return 'Hortifruti / Verduras';
  if (/suco|néctar|nectar|geléia|geleia|conserva|enlatad|industrializ|processad|embalad|yogurt|iogurte/.test(lower)) return 'Industrializados';
  return 'Frutas';
}

// ─── Export functions ────────────────────────────────────────────────────────
function exportToExcel(invoices: FiscalInvoice[]) {
  const rows: any[] = [];
  for (const inv of invoices) {
    const baseRow = {
      'Nº Nota Fiscal': inv.invoiceNumber,
      'Fornecedor': inv.supplier,
      'CNPJ': inv.supplierCnpj || '',
      'Data Emissão': inv.issueDate ? new Date(inv.issueDate + 'T12:00:00').toLocaleDateString('pt-BR') : '',
      'Valor Total': inv.totalValue ? `R$ ${parseFloat(inv.totalValue).toFixed(2)}` : '',
      'Qtd Produtos': Array.isArray(inv.items) ? inv.items.length : 0,
      'Importado em': format(new Date(inv.importedAt), 'dd/MM/yyyy HH:mm', { locale: ptBR }),
    };
    rows.push(baseRow);
  }
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Notas Fiscais');
  XLSX.writeFile(wb, `notas-fiscais-${new Date().toISOString().split('T')[0]}.xlsx`);
}

function exportReportPDF(invoices: FiscalInvoice[]) {
  const doc = new jsPDF();
  const today = format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR });
  doc.setFillColor(34, 197, 94);
  doc.rect(0, 0, 210, 20, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("VivaFrutaz — Relatório de Notas Fiscais", 14, 13);
  doc.setTextColor(30, 30, 30);
  autoTable(doc, {
    startY: 28,
    head: [['Nº NF', 'Fornecedor', 'CNPJ', 'Data Emissão', 'Valor Total', 'Produtos', 'Importado em']],
    body: invoices.map(inv => [
      inv.invoiceNumber,
      inv.supplier,
      inv.supplierCnpj || '—',
      inv.issueDate ? new Date(inv.issueDate + 'T12:00:00').toLocaleDateString('pt-BR') : '—',
      inv.totalValue ? `R$ ${parseFloat(inv.totalValue).toFixed(2)}` : '—',
      Array.isArray(inv.items) ? String(inv.items.length) : '0',
      format(new Date(inv.importedAt), 'dd/MM/yyyy', { locale: ptBR }),
    ]),
    headStyles: { fillColor: [34, 197, 94], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
    styles: { fontSize: 8, cellPadding: 2.5 },
    margin: { left: 14, right: 14 },
  });
  const ph = doc.internal.pageSize.getHeight();
  doc.setFillColor(249, 115, 22);
  doc.rect(0, ph - 12, 210, 12, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(7);
  doc.text(`VivaFrutaz  |  ${today}  |  ${invoices.length} nota(s) exportada(s)`, 14, ph - 4);
  doc.save(`relatorio-notas-fiscais-${new Date().toISOString().split('T')[0]}.pdf`);
}

// ─── Main Component ──────────────────────────────────────────────────────────
export function FiscalInvoiceOCR() {
  const { toast } = useToast();

  // ── State ──────────────────────────────────────────────────
  type Step = 'upload' | 'processing' | 'review' | 'confirmed';
  const [step, setStep] = useState<Step>('upload');
  const [processingMsg, setProcessingMsg] = useState('');
  const [processingProgress, setProcessingProgress] = useState(0);
  const [parsed, setParsed] = useState<ParsedInvoice>({
    invoiceNumber: '', supplier: '', supplierCnpj: '', issueDate: '', totalValue: '', items: [],
  });
  const [isDuplicate, setIsDuplicate] = useState(false);
  const [viewInvoice, setViewInvoice] = useState<FiscalInvoice | null>(null);
  const [historySearch, setHistorySearch] = useState('');
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [fileType, setFileType] = useState<'pdf' | 'image' | null>(null);
  const [fileName, setFileName] = useState('');
  const [rawText, setRawText] = useState('');
  const imageInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // ── Queries ────────────────────────────────────────────────
  const { data: invoices = [], isLoading: loadingInvoices } = useQuery<FiscalInvoice[]>({
    queryKey: ['/api/fiscal-invoices'],
  });

  const { data: products = [] } = useQuery<any[]>({
    queryKey: ['/api/products'],
  });

  // ── Mutations ──────────────────────────────────────────────
  const confirmInvoice = useMutation({
    mutationFn: (data: any) => apiRequest('POST', '/api/fiscal-invoices', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/fiscal-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['/api/inventory/settings'] });
      queryClient.invalidateQueries({ queryKey: ['/api/inventory/entries'] });
      queryClient.invalidateQueries({ queryKey: ['/api/inventory/movements'] });
      setStep('confirmed');
      toast({ title: 'Nota fiscal importada com sucesso! Estoque atualizado.' });
    },
    onError: (err: any) => {
      if (err?.duplicate) {
        setIsDuplicate(true);
        toast({ title: 'Nota fiscal duplicada', description: err.message, variant: 'destructive' });
      } else {
        toast({ title: 'Erro ao salvar nota fiscal', variant: 'destructive' });
      }
    },
  });

  const deleteInvoice = useMutation({
    mutationFn: (id: number) => apiRequest('DELETE', `/api/fiscal-invoices/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/fiscal-invoices'] });
      toast({ title: 'Nota fiscal removida.' });
    },
  });

  // ── Helpers ────────────────────────────────────────────────
  const tryLinkProduct = useCallback((itemName: string): { id: number | null; name: string } => {
    if (!products || products.length === 0) return { id: null, name: itemName };
    const lower = itemName.toLowerCase();
    const exact = products.find((p: any) => p.name.toLowerCase() === lower);
    if (exact) return { id: exact.id, name: exact.name };
    const partial = products.find((p: any) => lower.includes(p.name.toLowerCase().split(' ')[0]) || p.name.toLowerCase().includes(lower.split(' ')[0]));
    if (partial) return { id: partial.id, name: partial.name };
    return { id: null, name: itemName };
  }, [products]);

  // ── PDF Processing ─────────────────────────────────────────
  const processPDF = async (file: File) => {
    setStep('processing');
    setProcessingMsg('Enviando PDF para processamento...');
    setProcessingProgress(20);
    setFileName(file.name);
    setFileType('pdf');

    try {
      const formData = new FormData();
      formData.append('file', file);
      setProcessingMsg('Extraindo texto do PDF...');
      setProcessingProgress(50);
      const resp = await fetch('/api/fiscal-invoices/parse-pdf', {
        method: 'POST', credentials: 'include', body: formData,
      });
      if (!resp.ok) throw new Error('Falha ao processar PDF');
      const { text } = await resp.json();
      setRawText(text);
      setProcessingMsg('Identificando dados da nota...');
      setProcessingProgress(80);
      const extracted = parseNFeText(text);
      setProcessingProgress(100);

      // Link products
      const linkedItems = (extracted.items || []).map(item => {
        const link = tryLinkProduct(item.name);
        return { ...item, linkedProductId: link.id, linkedProductName: link.name };
      });

      setParsed({
        invoiceNumber: extracted.invoiceNumber || '',
        supplier: extracted.supplier || '',
        supplierCnpj: extracted.supplierCnpj || '',
        issueDate: extracted.issueDate || '',
        totalValue: extracted.totalValue || '',
        items: linkedItems.length > 0 ? linkedItems : [{ name: '', quantity: '', unit: 'kg', unitPrice: '', totalPrice: '', category: 'Frutas' }],
      });

      // Read file as data URL for preview
      const reader = new FileReader();
      reader.onload = e => setFilePreview(e.target?.result as string);
      reader.readAsDataURL(file);

      setStep('review');
    } catch (e: any) {
      toast({ title: 'Erro ao processar PDF', description: e.message, variant: 'destructive' });
      setStep('upload');
    }
  };

  // ── Image OCR Processing ───────────────────────────────────
  const processImage = async (file: File) => {
    setStep('processing');
    setProcessingMsg('Carregando motor de reconhecimento (OCR)...');
    setProcessingProgress(10);
    setFileName(file.name);
    setFileType('image');

    // Preview the image
    const reader = new FileReader();
    reader.onload = e => setFilePreview(e.target?.result as string);
    reader.readAsDataURL(file);

    try {
      setProcessingMsg('Inicializando Tesseract OCR...');
      setProcessingProgress(20);
      const Tesseract = (await import('tesseract.js')).default;

      setProcessingMsg('Reconhecendo texto na imagem...');
      const result = await Tesseract.recognize(file, 'por', {
        logger: (m: any) => {
          if (m.status === 'recognizing text') {
            setProcessingProgress(20 + Math.round(m.progress * 60));
            setProcessingMsg(`Reconhecendo texto: ${Math.round(m.progress * 100)}%`);
          }
        },
      });

      const text = result.data.text;
      setRawText(text);
      setProcessingMsg('Identificando dados da nota...');
      setProcessingProgress(90);

      const extracted = parseNFeText(text);
      setProcessingProgress(100);

      const linkedItems = (extracted.items || []).map(item => {
        const link = tryLinkProduct(item.name);
        return { ...item, linkedProductId: link.id, linkedProductName: link.name };
      });

      setParsed({
        invoiceNumber: extracted.invoiceNumber || '',
        supplier: extracted.supplier || '',
        supplierCnpj: extracted.supplierCnpj || '',
        issueDate: extracted.issueDate || '',
        totalValue: extracted.totalValue || '',
        items: linkedItems.length > 0 ? linkedItems : [{ name: '', quantity: '', unit: 'kg', unitPrice: '', totalPrice: '', category: 'Frutas' }],
      });

      setStep('review');
    } catch (e: any) {
      toast({ title: 'Erro no OCR', description: 'Não foi possível reconhecer o texto. Preencha os dados manualmente.', variant: 'destructive' });
      setParsed({
        invoiceNumber: '', supplier: '', supplierCnpj: '', issueDate: '', totalValue: '',
        items: [{ name: '', quantity: '', unit: 'kg', unitPrice: '', totalPrice: '', category: 'Frutas' }],
      });
      setStep('review');
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>, type: 'pdf' | 'image') => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (type === 'pdf') await processPDF(file);
    else await processImage(file);
    e.target.value = '';
  };

  const resetFlow = () => {
    setStep('upload');
    setParsed({ invoiceNumber: '', supplier: '', supplierCnpj: '', issueDate: '', totalValue: '', items: [] });
    setFilePreview(null);
    setFileType(null);
    setFileName('');
    setRawText('');
    setIsDuplicate(false);
    setProcessingProgress(0);
  };

  // ── Item helpers ───────────────────────────────────────────
  const updateItem = (idx: number, field: keyof InvoiceItem, value: string) => {
    setParsed(prev => {
      const items = [...prev.items];
      items[idx] = { ...items[idx], [field]: value };
      return { ...prev, items };
    });
  };

  const addItem = () => {
    setParsed(prev => ({
      ...prev,
      items: [...prev.items, { name: '', quantity: '', unit: 'kg', unitPrice: '', totalPrice: '', category: 'Frutas' }],
    }));
  };

  const removeItem = (idx: number) => {
    setParsed(prev => ({ ...prev, items: prev.items.filter((_, i) => i !== idx) }));
  };

  const handleConfirm = async () => {
    if (!parsed.invoiceNumber || !parsed.supplier) {
      toast({ title: 'Preencha Nº da Nota e Fornecedor', variant: 'destructive' });
      return;
    }
    const validItems = parsed.items.filter(it => it.name && it.quantity);
    if (validItems.length === 0) {
      toast({ title: 'Adicione pelo menos 1 produto', variant: 'destructive' });
      return;
    }
    confirmInvoice.mutate({
      ...parsed,
      items: validItems,
      fileType,
      fileName,
    });
  };

  // ── Filtered history ────────────────────────────────────────
  const filteredInvoices = (invoices as FiscalInvoice[]).filter(inv => {
    if (!historySearch) return true;
    const s = historySearch.toLowerCase();
    return inv.supplier.toLowerCase().includes(s) || inv.invoiceNumber.toLowerCase().includes(s) || (inv.supplierCnpj || '').includes(s);
  });

  const totalImported = invoices.length;
  const totalValue = invoices.reduce((sum, inv) => sum + (parseFloat(inv.totalValue || '0') || 0), 0);
  const totalItems = invoices.reduce((sum, inv) => sum + (Array.isArray(inv.items) ? inv.items.length : 0), 0);

  // ─── RENDER ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Notas Importadas', value: totalImported, icon: FileText, color: 'text-primary', bg: 'bg-primary/10' },
          { label: 'Valor Total', value: `R$ ${totalValue.toFixed(2).replace('.', ',')}`, icon: DollarSign, color: 'text-green-600', bg: 'bg-green-100' },
          { label: 'Total de Itens', value: totalItems, icon: Package, color: 'text-orange-600', bg: 'bg-orange-100' },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="bg-card rounded-2xl p-5 border border-border/50 premium-shadow flex items-center gap-4">
            <div className={`w-11 h-11 rounded-xl ${bg} flex items-center justify-center`}>
              <Icon className={`w-6 h-6 ${color}`} />
            </div>
            <div>
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{label}</p>
              <p className="text-xl font-display font-bold text-foreground">{value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── STEP: UPLOAD ── */}
      {step === 'upload' && (
        <div className="bg-card rounded-2xl border border-border/50 premium-shadow overflow-hidden">
          <div className="p-5 border-b border-border/50 bg-muted/20 flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center">
              <FileText className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h3 className="font-bold text-foreground">Importar Nota Fiscal</h3>
              <p className="text-xs text-muted-foreground">Faça OCR automático de PDFs ou fotos de notas fiscais</p>
            </div>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              {/* Camera */}
              <button
                data-testid="button-ocr-camera"
                onClick={() => cameraInputRef.current?.click()}
                className="group flex flex-col items-center gap-3 p-6 border-2 border-dashed border-primary/30 rounded-2xl hover:border-primary hover:bg-primary/5 transition-all"
              >
                <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                  <Camera className="w-6 h-6 text-primary" />
                </div>
                <div className="text-center">
                  <p className="font-bold text-foreground text-sm">Tirar Foto</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Abrir câmera do dispositivo</p>
                </div>
              </button>
              <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden"
                onChange={e => handleFileChange(e, 'image')} />

              {/* Image upload */}
              <button
                data-testid="button-ocr-image"
                onClick={() => imageInputRef.current?.click()}
                className="group flex flex-col items-center gap-3 p-6 border-2 border-dashed border-orange-300 rounded-2xl hover:border-orange-500 hover:bg-orange-50 transition-all"
              >
                <div className="w-12 h-12 rounded-2xl bg-orange-100 flex items-center justify-center group-hover:bg-orange-200 transition-colors">
                  <Image className="w-6 h-6 text-orange-600" />
                </div>
                <div className="text-center">
                  <p className="font-bold text-foreground text-sm">Enviar Imagem</p>
                  <p className="text-xs text-muted-foreground mt-0.5">PNG, JPG, WEBP da nota</p>
                </div>
              </button>
              <input ref={imageInputRef} type="file" accept="image/*" className="hidden"
                onChange={e => handleFileChange(e, 'image')} />

              {/* PDF upload */}
              <button
                data-testid="button-ocr-pdf"
                onClick={() => pdfInputRef.current?.click()}
                className="group flex flex-col items-center gap-3 p-6 border-2 border-dashed border-blue-300 rounded-2xl hover:border-blue-500 hover:bg-blue-50 transition-all"
              >
                <div className="w-12 h-12 rounded-2xl bg-blue-100 flex items-center justify-center group-hover:bg-blue-200 transition-colors">
                  <FileText className="w-6 h-6 text-blue-600" />
                </div>
                <div className="text-center">
                  <p className="font-bold text-foreground text-sm">Enviar PDF</p>
                  <p className="text-xs text-muted-foreground mt-0.5">PDF da nota fiscal (DANFE)</p>
                </div>
              </button>
              <input ref={pdfInputRef} type="file" accept=".pdf" className="hidden"
                onChange={e => handleFileChange(e, 'pdf')} />
            </div>

            {/* Manual entry option */}
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
              <div className="h-px flex-1 bg-border" />
              <span>ou</span>
              <div className="h-px flex-1 bg-border" />
            </div>
            <button
              data-testid="button-manual-entry"
              onClick={() => {
                setParsed({ invoiceNumber: '', supplier: '', supplierCnpj: '', issueDate: '', totalValue: '',
                  items: [{ name: '', quantity: '', unit: 'kg', unitPrice: '', totalPrice: '', category: 'Frutas' }] });
                setStep('review');
              }}
              className="w-full py-3 border-2 border-border rounded-xl text-sm font-bold text-muted-foreground hover:text-foreground hover:border-primary/40 transition-all flex items-center justify-center gap-2"
            >
              <Edit2 className="w-4 h-4" /> Preencher Manualmente
            </button>

            <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-xl">
              <p className="text-xs text-blue-700 font-medium flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                Para melhores resultados com PDF: use DANFEs digitais emitidos por ERPs. Para imagens: utilize fotos nítidas e bem iluminadas.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── STEP: PROCESSING ── */}
      {step === 'processing' && (
        <div className="bg-card rounded-2xl border border-border/50 premium-shadow p-12 flex flex-col items-center gap-5">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
          </div>
          <div className="text-center">
            <p className="font-bold text-foreground text-lg mb-1">Processando Nota Fiscal</p>
            <p className="text-sm text-muted-foreground">{processingMsg}</p>
          </div>
          <div className="w-full max-w-xs bg-muted rounded-full h-2.5">
            <div
              className="bg-primary h-2.5 rounded-full transition-all duration-500"
              style={{ width: `${processingProgress}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground font-mono">{processingProgress}%</p>
        </div>
      )}

      {/* ── STEP: REVIEW ── */}
      {step === 'review' && (
        <div className="bg-card rounded-2xl border border-border/50 premium-shadow overflow-hidden">
          <div className="p-5 border-b border-border/50 bg-muted/20 flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-amber-100 flex items-center justify-center">
              <Edit2 className="w-4 h-4 text-amber-600" />
            </div>
            <div className="flex-1">
              <h3 className="font-bold text-foreground">Conferência da Nota Fiscal</h3>
              <p className="text-xs text-muted-foreground">Verifique e corrija os dados antes de confirmar a entrada no estoque</p>
            </div>
            <button onClick={resetFlow} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
              <X className="w-3.5 h-3.5" /> Cancelar
            </button>
          </div>

          <div className="p-5 space-y-5">
            {isDuplicate && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0" />
                <p className="text-sm text-red-700 font-medium">Esta nota fiscal já foi registrada no sistema!</p>
              </div>
            )}

            {/* Preview image if available */}
            {filePreview && fileType === 'image' && (
              <div className="border border-border/50 rounded-xl overflow-hidden">
                <img src={filePreview} alt="Nota fiscal" className="w-full max-h-48 object-contain bg-muted" />
              </div>
            )}

            {/* Header fields */}
            <div className="p-4 bg-muted/20 rounded-xl border border-border/50">
              <h4 className="font-bold text-sm text-foreground mb-3 flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-primary" /> Dados da Nota Fiscal
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1">Nº da Nota Fiscal *</label>
                  <Input data-testid="input-nf-number" value={parsed.invoiceNumber}
                    onChange={e => setParsed(p => ({ ...p, invoiceNumber: e.target.value }))}
                    placeholder="Ex.: 000123456" className="h-9 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1">Data de Emissão</label>
                  <Input data-testid="input-nf-date" type="date" value={parsed.issueDate}
                    onChange={e => setParsed(p => ({ ...p, issueDate: e.target.value }))}
                    className="h-9 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1">Fornecedor *</label>
                  <Input data-testid="input-nf-supplier" value={parsed.supplier}
                    onChange={e => setParsed(p => ({ ...p, supplier: e.target.value }))}
                    placeholder="Nome do fornecedor" className="h-9 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1">CNPJ do Fornecedor</label>
                  <Input data-testid="input-nf-cnpj" value={parsed.supplierCnpj}
                    onChange={e => setParsed(p => ({ ...p, supplierCnpj: e.target.value }))}
                    placeholder="XX.XXX.XXX/XXXX-XX" className="h-9 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1">Valor Total da Nota</label>
                  <Input data-testid="input-nf-total" value={parsed.totalValue}
                    onChange={e => setParsed(p => ({ ...p, totalValue: e.target.value }))}
                    placeholder="0.00" className="h-9 text-sm" type="number" step="0.01" />
                </div>
              </div>
            </div>

            {/* Items table */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-bold text-sm text-foreground flex items-center gap-1.5">
                  <Package className="w-4 h-4 text-primary" /> Produtos Detectados
                  <Badge variant="outline" className="ml-1 text-xs">{parsed.items.length}</Badge>
                </h4>
                <button onClick={addItem} data-testid="button-add-nf-item"
                  className="flex items-center gap-1 text-xs font-bold text-primary hover:text-primary/80 transition-colors">
                  <Plus className="w-3.5 h-3.5" /> Adicionar produto
                </button>
              </div>
              <div className="border border-border/50 rounded-xl overflow-hidden">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="bg-muted/40 text-xs text-muted-foreground uppercase tracking-wider">
                      <th className="px-3 py-2.5 font-semibold">Produto</th>
                      <th className="px-3 py-2.5 font-semibold">Categoria</th>
                      <th className="px-3 py-2.5 font-semibold">Qtd</th>
                      <th className="px-3 py-2.5 font-semibold">Un</th>
                      <th className="px-3 py-2.5 font-semibold">Vl Unit</th>
                      <th className="px-3 py-2.5 font-semibold">Vl Total</th>
                      <th className="px-3 py-2.5 font-semibold">Vínculo</th>
                      <th className="px-2 py-2.5"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {parsed.items.map((item, idx) => (
                      <tr key={idx} className="hover:bg-muted/10">
                        <td className="px-2 py-1.5">
                          <Input data-testid={`input-nf-item-name-${idx}`} value={item.name}
                            onChange={e => updateItem(idx, 'name', e.target.value)}
                            placeholder="Nome do produto" className="h-8 text-xs min-w-[100px]" />
                        </td>
                        <td className="px-2 py-1.5">
                          <select value={item.category}
                            onChange={e => updateItem(idx, 'category', e.target.value)}
                            className="h-8 px-2 text-xs rounded-lg border-2 border-border focus:border-primary outline-none">
                            <option>Frutas</option>
                            <option>Hortifruti / Verduras</option>
                            <option>Industrializados</option>
                            <option>Outros</option>
                          </select>
                        </td>
                        <td className="px-2 py-1.5">
                          <Input data-testid={`input-nf-item-qty-${idx}`} value={item.quantity}
                            onChange={e => updateItem(idx, 'quantity', e.target.value)}
                            placeholder="0" className="h-8 text-xs w-20" type="number" step="0.001" />
                        </td>
                        <td className="px-2 py-1.5">
                          <select value={item.unit}
                            onChange={e => updateItem(idx, 'unit', e.target.value)}
                            className="h-8 px-2 text-xs rounded-lg border-2 border-border focus:border-primary outline-none">
                            {['kg', 'g', 'un', 'cx', 'sc', 'lt', 'pote', 'display', 'bandeja'].map(u => <option key={u}>{u}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-1.5">
                          <Input value={item.unitPrice}
                            onChange={e => updateItem(idx, 'unitPrice', e.target.value)}
                            placeholder="0.00" className="h-8 text-xs w-20" type="number" step="0.01" />
                        </td>
                        <td className="px-2 py-1.5">
                          <Input value={item.totalPrice}
                            onChange={e => updateItem(idx, 'totalPrice', e.target.value)}
                            placeholder="0.00" className="h-8 text-xs w-20" type="number" step="0.01" />
                        </td>
                        <td className="px-2 py-1.5">
                          {item.linkedProductId ? (
                            <span className="text-xs text-green-700 font-bold flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" /> {item.linkedProductName}
                            </span>
                          ) : (
                            <select
                              value={item.linkedProductId || ''}
                              onChange={e => {
                                const prod = products.find((p: any) => p.id === Number(e.target.value));
                                updateItem(idx, 'linkedProductId', e.target.value);
                                if (prod) updateItem(idx, 'linkedProductName', prod.name);
                              }}
                              className="h-8 px-2 text-xs rounded-lg border-2 border-border focus:border-primary outline-none max-w-[120px]"
                            >
                              <option value="">Sem vínculo</option>
                              {products.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                          )}
                        </td>
                        <td className="px-1 py-1.5">
                          <button onClick={() => removeItem(idx)} className="p-1 rounded text-muted-foreground hover:text-red-500 hover:bg-red-50 transition-colors">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <button onClick={resetFlow}
                className="flex-1 py-2.5 border-2 border-border rounded-xl text-sm font-bold text-muted-foreground hover:text-foreground transition-colors">
                Cancelar
              </button>
              <button
                data-testid="button-confirm-nf-import"
                onClick={handleConfirm}
                disabled={confirmInvoice.isPending}
                className="flex-1 py-2.5 bg-primary text-white font-bold rounded-xl hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2 text-sm"
              >
                {confirmInvoice.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                Confirmar Entrada no Estoque
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── STEP: CONFIRMED ── */}
      {step === 'confirmed' && (
        <div className="bg-card rounded-2xl border border-green-200 premium-shadow p-10 flex flex-col items-center gap-4 text-center">
          <div className="w-16 h-16 rounded-2xl bg-green-100 flex items-center justify-center">
            <CheckCircle2 className="w-8 h-8 text-green-600" />
          </div>
          <div>
            <p className="font-bold text-foreground text-xl mb-1">Nota Fiscal Importada!</p>
            <p className="text-sm text-muted-foreground">O estoque foi atualizado automaticamente com os produtos da nota fiscal.</p>
          </div>
          <button onClick={resetFlow} data-testid="button-import-another"
            className="px-6 py-2.5 bg-primary text-white font-bold rounded-xl hover:bg-primary/90 transition-colors flex items-center gap-2">
            <Plus className="w-4 h-4" /> Importar Outra Nota
          </button>
        </div>
      )}

      {/* ── HISTORY TABLE ── */}
      <div className="bg-card rounded-2xl border border-border/50 premium-shadow overflow-hidden">
        <div className="p-5 border-b border-border/50 bg-muted/20 flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-1">
            <FileText className="w-5 h-5 text-primary" />
            <h3 className="font-bold text-foreground">Histórico de Notas Fiscais</h3>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input value={historySearch} onChange={e => setHistorySearch(e.target.value)}
                placeholder="Buscar..." className="pl-8 h-8 w-44 text-xs" />
            </div>
            <button onClick={() => exportToExcel(invoices as FiscalInvoice[])} data-testid="button-export-nf-excel"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-xl bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 transition-colors">
              <Download className="w-3.5 h-3.5" /> Excel
            </button>
            <button onClick={() => exportReportPDF(invoices as FiscalInvoice[])} data-testid="button-export-nf-pdf"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-xl bg-orange-50 text-orange-700 border border-orange-200 hover:bg-orange-100 transition-colors">
              <FileDown className="w-3.5 h-3.5" /> PDF
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="bg-muted/30 text-xs text-muted-foreground uppercase tracking-wider">
                <th className="px-5 py-3 font-semibold">Nº Nota</th>
                <th className="px-5 py-3 font-semibold">Fornecedor</th>
                <th className="px-5 py-3 font-semibold">CNPJ</th>
                <th className="px-5 py-3 font-semibold">Data Emissão</th>
                <th className="px-5 py-3 font-semibold">Valor Total</th>
                <th className="px-5 py-3 font-semibold">Produtos</th>
                <th className="px-5 py-3 font-semibold">Importado em</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {loadingInvoices ? (
                <tr><td colSpan={8} className="px-5 py-8 text-center text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" /> Carregando...
                </td></tr>
              ) : filteredInvoices.length === 0 ? (
                <tr><td colSpan={8} className="px-5 py-10 text-center text-muted-foreground">
                  <FileText className="w-10 h-10 text-muted-foreground/30 mx-auto mb-2" />
                  <p>Nenhuma nota fiscal importada ainda.</p>
                  <p className="text-xs mt-1">Use os botões acima para importar sua primeira nota!</p>
                </td></tr>
              ) : filteredInvoices.map(inv => (
                <tr key={inv.id} data-testid={`nf-row-${inv.id}`} className="hover:bg-muted/10 transition-colors">
                  <td className="px-5 py-3">
                    <span className="font-mono font-bold text-primary text-xs">{inv.invoiceNumber}</span>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <Building2 className="w-3.5 h-3.5 text-primary" />
                      </div>
                      <span className="font-medium text-foreground text-sm">{inv.supplier}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-xs text-muted-foreground font-mono">{inv.supplierCnpj || '—'}</td>
                  <td className="px-5 py-3 text-sm">
                    {inv.issueDate ? new Date(inv.issueDate + 'T12:00:00').toLocaleDateString('pt-BR') : '—'}
                  </td>
                  <td className="px-5 py-3">
                    {inv.totalValue ? (
                      <span className="font-bold text-green-700">R$ {parseFloat(inv.totalValue).toFixed(2).replace('.', ',')}</span>
                    ) : '—'}
                  </td>
                  <td className="px-5 py-3">
                    <Badge variant="outline" className="text-xs">{Array.isArray(inv.items) ? inv.items.length : 0} item(s)</Badge>
                  </td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">
                    {format(new Date(inv.importedAt), 'dd/MM/yyyy HH:mm', { locale: ptBR })}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <button onClick={() => setViewInvoice(inv)} data-testid={`button-view-nf-${inv.id}`}
                        className="p-1.5 rounded-lg text-primary hover:bg-primary/10 transition-colors">
                        <Eye className="w-4 h-4" />
                      </button>
                      <button onClick={() => { if (confirm('Remover esta nota fiscal do histórico?')) deleteInvoice.mutate(inv.id); }}
                        data-testid={`button-delete-nf-${inv.id}`}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-50 transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail modal */}
      <Dialog open={!!viewInvoice} onOpenChange={() => setViewInvoice(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-primary" />
              Nota Fiscal {viewInvoice?.invoiceNumber}
            </DialogTitle>
          </DialogHeader>
          {viewInvoice && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                {[
                  { label: 'Fornecedor', value: viewInvoice.supplier },
                  { label: 'CNPJ', value: viewInvoice.supplierCnpj || '—' },
                  { label: 'Nº Nota', value: viewInvoice.invoiceNumber },
                  { label: 'Data Emissão', value: viewInvoice.issueDate ? new Date(viewInvoice.issueDate + 'T12:00:00').toLocaleDateString('pt-BR') : '—' },
                  { label: 'Valor Total', value: viewInvoice.totalValue ? `R$ ${parseFloat(viewInvoice.totalValue).toFixed(2)}` : '—' },
                  { label: 'Importado em', value: format(new Date(viewInvoice.importedAt), 'dd/MM/yyyy HH:mm', { locale: ptBR }) },
                ].map(({ label, value }) => (
                  <div key={label} className="p-3 bg-muted/20 rounded-xl">
                    <p className="text-xs font-bold text-muted-foreground mb-0.5">{label}</p>
                    <p className="font-semibold text-foreground">{value}</p>
                  </div>
                ))}
              </div>
              {Array.isArray(viewInvoice.items) && viewInvoice.items.length > 0 && (
                <div>
                  <h4 className="font-bold text-sm mb-2">Produtos ({viewInvoice.items.length})</h4>
                  <div className="border border-border/50 rounded-xl overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-muted/30 text-xs text-muted-foreground">
                          <th className="px-3 py-2 text-left">Produto</th>
                          <th className="px-3 py-2 text-left">Categoria</th>
                          <th className="px-3 py-2 text-right">Qtd</th>
                          <th className="px-3 py-2 text-right">Vl Unit</th>
                          <th className="px-3 py-2 text-right">Vl Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/50">
                        {viewInvoice.items.map((item, i) => (
                          <tr key={i} className="hover:bg-muted/10">
                            <td className="px-3 py-2 font-medium">{item.name}</td>
                            <td className="px-3 py-2 text-xs text-muted-foreground">{item.category}</td>
                            <td className="px-3 py-2 text-right">{item.quantity} {item.unit}</td>
                            <td className="px-3 py-2 text-right text-xs">{item.unitPrice ? `R$ ${item.unitPrice}` : '—'}</td>
                            <td className="px-3 py-2 text-right font-bold text-green-700 text-xs">{item.totalPrice ? `R$ ${item.totalPrice}` : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
