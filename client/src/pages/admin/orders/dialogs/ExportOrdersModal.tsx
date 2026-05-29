import { useState } from "react";
import { Modal } from "@/components/Modal";
import { useToast } from "@/hooks/use-toast";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { Loader2, FileSpreadsheet, FileDown, FileText } from "lucide-react";
import { ORDER_TYPE_OPTIONS, CLIENT_TYPE_PT, STATUS_PT } from "../constants";

interface ExportOrdersModalProps {
  companies: any[];
  onClose: () => void;
}

export function ExportOrdersModal({ companies, onClose }: ExportOrdersModalProps) {
  const { toast } = useToast();
  const [companyId, setCompanyId] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [orderType, setOrderType] = useState('all');
  const [loading, setLoading] = useState<'excel' | 'csv' | 'pdf' | null>(null);

  const buildUrl = () => {
    const params = new URLSearchParams();
    if (companyId !== 'all') params.set('companyId', companyId);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    if (orderType !== 'all') params.set('orderType', orderType);
    return `/api/orders/export?${params.toString()}`;
  };

  const fetchData = async () => {
    const res = await fetchWithAuth(buildUrl());
    if (!res.ok) throw new Error('Erro ao buscar pedidos');
    return res.json() as Promise<any[]>;
  };

  const flattenRows = (data: any[]) => {
    const rows: any[] = [];
    for (const order of data) {
      const base = {
        'Empresa': order.companyName,
        'Tipo de contrato': CLIENT_TYPE_PT[order.clientType] || order.clientType || '—',
        'Data do pedido': order.orderDate ? format(new Date(order.orderDate), 'dd/MM/yyyy', { locale: ptBR }) : '—',
        'Data de entrega': order.deliveryDate ? format(new Date(order.deliveryDate), 'dd/MM/yyyy', { locale: ptBR }) : '—',
        'Código': order.orderCode || '',
        'Status': STATUS_PT[order.status] || order.status,
        'Observações': order.orderNote || order.adminNote || '',
      };
      if (order.items && order.items.length > 0) {
        for (const item of order.items) {
          rows.push({
            ...base,
            'Produto': item.productName,
            'Categoria': item.productCategory,
            'Unidade': item.productUnit,
            'Quantidade': Number(item.quantity),
            'Preço unitário (R$)': Number(item.unitPrice).toFixed(2),
            'Valor total (R$)': Number(item.totalPrice).toFixed(2),
          });
        }
      } else {
        rows.push({ ...base, 'Produto': '—', 'Categoria': '—', 'Unidade': '—', 'Quantidade': 0, 'Preço unitário (R$)': '0.00', 'Valor total (R$)': Number(order.totalValue || 0).toFixed(2) });
      }
    }
    return rows;
  };

  const handleExcel = async () => {
    setLoading('excel');
    try {
      const data = await fetchData();
      const rows = flattenRows(data);
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Pedidos');
      XLSX.writeFile(wb, `pedidos-${new Date().toISOString().split('T')[0]}.xlsx`);
      toast({ title: 'Excel exportado!', description: `${rows.length} linha(s) exportada(s)` });
    } catch (e: any) {
      toast({ title: 'Erro ao exportar', description: e.message, variant: 'destructive' });
    } finally { setLoading(null); }
  };

  const handleCsv = async () => {
    setLoading('csv');
    try {
      const data = await fetchData();
      const rows = flattenRows(data);
      if (rows.length === 0) { toast({ title: 'Nenhum pedido encontrado' }); setLoading(null); return; }
      const headers = Object.keys(rows[0]);
      const csvLines = [headers.join(';'), ...rows.map(r => headers.map(h => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(';'))];
      const blob = new Blob(['\uFEFF' + csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `pedidos-${new Date().toISOString().split('T')[0]}.csv`; a.click();
      URL.revokeObjectURL(url);
      toast({ title: 'CSV exportado!', description: `${rows.length} linha(s) exportada(s)` });
    } catch (e: any) {
      toast({ title: 'Erro ao exportar', description: e.message, variant: 'destructive' });
    } finally { setLoading(null); }
  };

  const handlePdf = async () => {
    setLoading('pdf');
    try {
      const data = await fetchData();
      const rows = flattenRows(data);
      if (rows.length === 0) { toast({ title: 'Nenhum pedido encontrado' }); setLoading(null); return; }
      const doc = new jsPDF({ orientation: 'landscape' });
      doc.setFontSize(14);
      doc.text('Exportação de Pedidos — VivaFrutaz', 14, 16);
      doc.setFontSize(9);
      doc.text(`Gerado em ${format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}`, 14, 22);
      const cols = ['Empresa', 'Tipo de contrato', 'Data do pedido', 'Data de entrega', 'Produto', 'Categoria', 'Quantidade', 'Preço unitário (R$)', 'Valor total (R$)', 'Status'];
      autoTable(doc, {
        head: [cols],
        body: rows.map(r => cols.map(c => String(r[c] ?? '—'))),
        startY: 28,
        styles: { fontSize: 7, cellPadding: 2 },
        headStyles: { fillColor: [34, 197, 94], textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [245, 253, 245] },
      });
      doc.save(`pedidos-${new Date().toISOString().split('T')[0]}.pdf`);
      toast({ title: 'PDF exportado!', description: `${rows.length} linha(s) exportada(s)` });
    } catch (e: any) {
      toast({ title: 'Erro ao exportar PDF', description: e.message, variant: 'destructive' });
    } finally { setLoading(null); }
  };

  return (
    <Modal isOpen onClose={onClose} title="Exportar Pedidos" maxWidth="max-w-lg">
      <div className="space-y-4">
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-700 font-medium">
          Exporte todos os pedidos com detalhes de produtos. Aplique filtros para refinar os resultados.
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-foreground mb-1.5">Empresa</label>
            <select value={companyId} onChange={e => setCompanyId(e.target.value)}
              data-testid="select-export-company"
              className="w-full px-3 py-2.5 rounded-xl border-2 border-border text-sm focus:border-primary outline-none">
              <option value="all">Todas as empresas</option>
              {companies.map((c: any) => <option key={c.id} value={String(c.id)}>{c.companyName}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">Data inicial</label>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                data-testid="input-export-from"
                className="w-full px-3 py-2.5 rounded-xl border-2 border-border text-sm focus:border-primary outline-none" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">Data final</label>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                data-testid="input-export-to"
                className="w-full px-3 py-2.5 rounded-xl border-2 border-border text-sm focus:border-primary outline-none" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-foreground mb-1.5">Tipo de pedido</label>
            <select value={orderType} onChange={e => setOrderType(e.target.value)}
              data-testid="select-export-type"
              className="w-full px-3 py-2.5 rounded-xl border-2 border-border text-sm focus:border-primary outline-none">
              {ORDER_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>

        <div className="border-t border-border/50 pt-4">
          <p className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wider">Formato de exportação</p>
          <div className="grid grid-cols-3 gap-2">
            <button type="button" onClick={handleExcel} disabled={loading !== null}
              data-testid="button-export-excel"
              className="flex flex-col items-center gap-1.5 p-3 bg-emerald-50 border-2 border-emerald-200 rounded-xl hover:bg-emerald-100 transition-colors disabled:opacity-50">
              {loading === 'excel' ? <Loader2 className="w-5 h-5 text-emerald-600 animate-spin" /> : <FileSpreadsheet className="w-5 h-5 text-emerald-600" />}
              <span className="text-xs font-bold text-emerald-700">Excel</span>
              <span className="text-[10px] text-emerald-600">.xlsx</span>
            </button>
            <button type="button" onClick={handleCsv} disabled={loading !== null}
              data-testid="button-export-csv"
              className="flex flex-col items-center gap-1.5 p-3 bg-blue-50 border-2 border-blue-200 rounded-xl hover:bg-blue-100 transition-colors disabled:opacity-50">
              {loading === 'csv' ? <Loader2 className="w-5 h-5 text-blue-600 animate-spin" /> : <FileDown className="w-5 h-5 text-blue-600" />}
              <span className="text-xs font-bold text-blue-700">CSV</span>
              <span className="text-[10px] text-blue-600">.csv</span>
            </button>
            <button type="button" onClick={handlePdf} disabled={loading !== null}
              data-testid="button-export-pdf"
              className="flex flex-col items-center gap-1.5 p-3 bg-red-50 border-2 border-red-200 rounded-xl hover:bg-red-100 transition-colors disabled:opacity-50">
              {loading === 'pdf' ? <Loader2 className="w-5 h-5 text-red-600 animate-spin" /> : <FileText className="w-5 h-5 text-red-600" />}
              <span className="text-xs font-bold text-red-700">PDF</span>
              <span className="text-[10px] text-red-600">.pdf</span>
            </button>
          </div>
        </div>

        <button type="button" onClick={onClose}
          className="w-full py-2.5 rounded-xl border border-border text-sm text-muted-foreground hover:bg-muted/50 transition-colors">
          Fechar
        </button>
      </div>
    </Modal>
  );
}
