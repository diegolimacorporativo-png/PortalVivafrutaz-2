import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCompanies } from "@/hooks/use-admin";
import { useProducts } from "@/hooks/use-catalog";
import { Layout } from "@/components/Layout";
import { Factory, Download, Filter, X, Calendar, FileSpreadsheet, Building2, Package, TrendingUp } from "lucide-react";

type ReportRow = {
  orderId: number;
  orderCode: string;
  orderDate: string;
  companyName: string;
  productName: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
};

function buildQuery(filters: { dateFrom: string; dateTo: string; companyId: string; productId: string }) {
  const p = new URLSearchParams();
  if (filters.dateFrom) p.set('dateFrom', filters.dateFrom);
  if (filters.dateTo) p.set('dateTo', filters.dateTo);
  if (filters.companyId) p.set('companyId', filters.companyId);
  if (filters.productId) p.set('productId', filters.productId);
  return p.toString() ? `?${p.toString()}` : '';
}

function useIndustrializedData(filters: { dateFrom: string; dateTo: string; companyId: string; productId: string }) {
  const qs = buildQuery(filters);
  return useQuery({
    queryKey: ['/api/reports/industrialized', qs],
    queryFn: async () => {
      const res = await fetch(`/api/reports/industrialized${qs}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json() as Promise<ReportRow[]>;
    }
  });
}

async function exportExcel(rows: ReportRow[]) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const headers = ['Empresa', 'Pedido', 'Data', 'Produto', 'Unidade', 'Qtd.', 'Preço Unit. (R$)', 'Total (R$)'];
  const data = rows.map(r => [r.companyName, r.orderCode, r.orderDate, r.productName, r.unit, r.quantity, r.unitPrice, r.totalPrice]);
  const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
  ws['!cols'] = [{ wch: 25 }, { wch: 18 }, { wch: 14 }, { wch: 20 }, { wch: 10 }, { wch: 8 }, { wch: 16 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Industrializados');
  XLSX.writeFile(wb, `VivaFrutaz_Industrializados_${new Date().toISOString().split('T')[0]}.xlsx`);
}

export default function IndustrializedPage() {
  const { data: companies } = useCompanies();
  const { data: allProducts } = useProducts();

  const today = new Date().toISOString().split('T')[0];
  const firstOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];

  const [filters, setFilters] = useState({ dateFrom: firstOfMonth, dateTo: today, companyId: '', productId: '' });
  const { data: rows, isLoading } = useIndustrializedData(filters);
  const [exporting, setExporting] = useState(false);

  const clearFilters = () => setFilters({ dateFrom: firstOfMonth, dateTo: today, companyId: '', productId: '' });

  const industrializedProducts = useMemo(() => allProducts?.filter(p => (p as any).isIndustrialized), [allProducts]);

  const summary = useMemo(() => {
    if (!rows) return { totalQty: 0, totalValue: 0, uniqueProducts: 0, uniqueCompanies: 0 };
    return {
      totalQty: rows.reduce((s, r) => s + r.quantity, 0),
      totalValue: rows.reduce((s, r) => s + r.totalPrice, 0),
      uniqueProducts: new Set(rows.map(r => r.productName)).size,
      uniqueCompanies: new Set(rows.map(r => r.companyName)).size,
    };
  }, [rows]);

  return (
    <Layout>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Controle de Industrializados</h1>
          <p className="text-muted-foreground mt-1">Vendas de produtos industrializados por empresa e período.</p>
        </div>
        <button
          data-testid="button-export-industrialized"
          onClick={async () => { setExporting(true); await exportExcel(rows || []); setExporting(false); }}
          disabled={exporting || !rows?.length}
          className="flex items-center gap-2 px-6 py-3 bg-orange-600 text-white font-bold rounded-xl hover:bg-orange-700 transition-colors shadow-lg disabled:opacity-50"
        >
          <FileSpreadsheet className="w-4 h-4" /> {exporting ? "Gerando..." : "Exportar Excel"}
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {[
          { label: "Produtos Únicos", value: summary.uniqueProducts, icon: Package, color: "text-primary", bg: "bg-primary/10" },
          { label: "Empresas", value: summary.uniqueCompanies, icon: Building2, color: "text-secondary", bg: "bg-secondary/10" },
          { label: "Qtd. Total", value: summary.totalQty.toLocaleString('pt-BR'), icon: Factory, color: "text-orange-600", bg: "bg-orange-100" },
          { label: "Valor Total", value: `R$ ${summary.totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, icon: TrendingUp, color: "text-green-600", bg: "bg-green-100" },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="bg-card rounded-2xl p-5 border border-border/50 premium-shadow flex items-center gap-3">
            <div className={`w-11 h-11 rounded-xl ${bg} flex items-center justify-center flex-shrink-0`}>
              <Icon className={`w-6 h-6 ${color}`} />
            </div>
            <div>
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{label}</p>
              <p className="text-xl font-display font-bold text-foreground mt-0.5">{value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-card rounded-2xl border border-border/50 premium-shadow p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Filter className="w-5 h-5 text-primary" />
            <h2 className="font-bold text-foreground">Filtros</h2>
          </div>
          <button onClick={clearFilters} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground font-medium">
            <X className="w-3.5 h-3.5" /> Limpar
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase flex items-center gap-1">
              <Calendar className="w-3 h-3" /> Data Início
            </label>
            <input type="date" value={filters.dateFrom}
              onChange={e => setFilters(f => ({ ...f, dateFrom: e.target.value }))}
              className="w-full px-3 py-2 rounded-xl border-2 border-border focus:border-primary outline-none text-sm" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase flex items-center gap-1">
              <Calendar className="w-3 h-3" /> Data Fim
            </label>
            <input type="date" value={filters.dateTo}
              onChange={e => setFilters(f => ({ ...f, dateTo: e.target.value }))}
              className="w-full px-3 py-2 rounded-xl border-2 border-border focus:border-primary outline-none text-sm" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase">Empresa</label>
            <select value={filters.companyId} onChange={e => setFilters(f => ({ ...f, companyId: e.target.value }))}
              className="w-full px-3 py-2 rounded-xl border-2 border-border focus:border-primary outline-none text-sm">
              <option value="">Todas</option>
              {companies?.map(c => <option key={c.id} value={c.id}>{c.companyName}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase">Produto</label>
            <select value={filters.productId} onChange={e => setFilters(f => ({ ...f, productId: e.target.value }))}
              className="w-full px-3 py-2 rounded-xl border-2 border-border focus:border-primary outline-none text-sm">
              <option value="">Todos os industrializados</option>
              {industrializedProducts?.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-card rounded-2xl border border-border/50 premium-shadow overflow-hidden">
        <div className="p-5 border-b border-border/50 flex items-center gap-3 bg-muted/20">
          <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center">
            <Factory className="w-5 h-5 text-orange-600" />
          </div>
          <h2 className="text-lg font-bold text-foreground">Registros de Venda</h2>
          <span className="ml-auto text-sm text-muted-foreground font-medium">{rows?.length || 0} registros</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-muted/30 border-b border-border/50 text-muted-foreground text-xs uppercase tracking-wider">
                <th className="px-5 py-3 font-semibold">Empresa</th>
                <th className="px-5 py-3 font-semibold">Pedido</th>
                <th className="px-5 py-3 font-semibold">Data</th>
                <th className="px-5 py-3 font-semibold">Produto</th>
                <th className="px-5 py-3 font-semibold">Qtd.</th>
                <th className="px-5 py-3 font-semibold text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {isLoading ? (
                <tr><td colSpan={6} className="px-5 py-8 text-center text-muted-foreground">Carregando...</td></tr>
              ) : !rows?.length ? (
                <tr><td colSpan={6} className="px-5 py-8 text-center text-muted-foreground">
                  Nenhum produto industrializado vendido no período.
                  <br />
                  <span className="text-xs">Marque produtos como "Industrializado" na página de Produtos.</span>
                </td></tr>
              ) : (
                rows.map((row, idx) => (
                  <tr key={idx} className="hover:bg-muted/10 transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                          <Building2 className="w-4 h-4 text-primary" />
                        </div>
                        <p className="font-bold text-sm text-foreground">{row.companyName}</p>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <span className="font-mono text-xs font-bold text-primary bg-primary/10 px-2 py-1 rounded-lg">{row.orderCode}</span>
                    </td>
                    <td className="px-5 py-3 text-sm text-muted-foreground">{row.orderDate}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <span className="flex items-center gap-1 px-2 py-0.5 bg-orange-100 text-orange-700 rounded-md text-xs font-bold">
                          <Factory className="w-3 h-3" /> Ind.
                        </span>
                        <p className="font-medium text-sm text-foreground">{row.productName}</p>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <span className="font-bold text-foreground">{row.quantity}</span>
                      <span className="text-xs text-muted-foreground ml-1">{row.unit}</span>
                    </td>
                    <td className="px-5 py-3 text-right font-bold text-primary">
                      R$ {row.totalPrice.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  );
}
