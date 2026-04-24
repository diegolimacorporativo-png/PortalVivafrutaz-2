import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCompanies } from "@/hooks/use-admin";
import { useProducts } from "@/hooks/use-catalog";
import { Layout } from "@/components/Layout";
import { Modal } from "@/components/Modal";
import {
  ShoppingBasket, Download, Filter, Building2, ChevronDown, ChevronUp,
  Package, X, Calendar, FileSpreadsheet, BarChart3, TrendingUp
} from "lucide-react";

function buildQuery(filters: {
  dateFrom: string; dateTo: string; companyId: string; productId: string;
}): string {
  const p = new URLSearchParams();
  if (filters.dateFrom) p.set('dateFrom', filters.dateFrom);
  if (filters.dateTo) p.set('dateTo', filters.dateTo);
  if (filters.companyId) p.set('companyId', filters.companyId);
  if (filters.productId) p.set('productId', filters.productId);
  return p.toString() ? `?${p.toString()}` : '';
}

function usePurchasingData(filters: {
  dateFrom: string; dateTo: string; companyId: string; productId: string;
}) {
  const qs = buildQuery(filters);
  return useQuery({
    queryKey: ['/api/reports/purchasing', qs],
    queryFn: async () => {
      const res = await fetch(`/api/reports/purchasing${qs}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch purchasing data');
      return res.json() as Promise<{
        products: {
          productId: number;
          productName: string;
          unit: string;
          totalQuantity: number;
          companies: { companyId: number; companyName: string; quantity: number }[];
        }[];
        rawOrders: {
          orderCode: string; companyName: string; orderDate: string; deliveryDate: string;
          productName: string; quantity: number; unitPrice: number; totalPrice: number;
        }[];
      }>;
    },
  });
}

// ─── Excel Export ─────────────────────────────────────────────
async function exportToExcel(rawOrders: any[], filters: any) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();

  // Sheet 1: Pedidos detalhados
  const headers = ['Empresa', 'Código do Pedido', 'Data do Pedido', 'Data de Entrega', 'Produto', 'Quantidade', 'Preço Unitário (R$)', 'Total (R$)'];
  const rows = rawOrders.map(r => [
    r.companyName,
    r.orderCode,
    r.orderDate,
    r.deliveryDate,
    r.productName,
    r.quantity,
    r.unitPrice,
    { f: `F${rawOrders.indexOf(r) + 2 + 1}*G${rawOrders.indexOf(r) + 2 + 1}` }, // formula: Qty * Price
  ]);

  // Actually compute total properly
  const dataRows = rawOrders.map((r, i) => [
    r.companyName,
    r.orderCode,
    r.orderDate,
    r.deliveryDate,
    r.productName,
    r.quantity,
    r.unitPrice,
    r.totalPrice,
  ]);

  const ws1 = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);

  // Set column widths
  ws1['!cols'] = [
    { wch: 25 }, { wch: 18 }, { wch: 14 }, { wch: 14 },
    { wch: 20 }, { wch: 12 }, { wch: 18 }, { wch: 14 },
  ];

  XLSX.utils.book_append_sheet(wb, ws1, 'Pedidos Detalhados');

  // Sheet 2: Resumo por produto (shopping list)
  const summaryHeaders = ['Produto', 'Unidade', 'Quantidade Total'];
  const summaryData: any[] = [];
  const productMap = new Map<string, { unit: string; qty: number }>();
  for (const r of rawOrders) {
    const key = r.productName;
    if (!productMap.has(key)) productMap.set(key, { unit: '', qty: 0 });
    const entry = productMap.get(key)!;
    entry.qty += r.quantity;
  }
  Array.from(productMap.entries()).forEach(([name, val]) => {
    summaryData.push([name, val.unit || 'un', val.qty]);
  });
  summaryData.sort((a, b) => b[2] - a[2]);

  const ws2 = XLSX.utils.aoa_to_sheet([summaryHeaders, ...summaryData]);
  ws2['!cols'] = [{ wch: 25 }, { wch: 12 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, ws2, 'Lista de Compras');

  // Download
  const dateStr = new Date().toISOString().split('T')[0];
  XLSX.writeFile(wb, `VivaFrutaz_Compras_${dateStr}.xlsx`);
}

// ─── Product Detail Modal ─────────────────────────────────────
function ProductDetailModal({
  product, onClose
}: {
  product: { productId: number; productName: string; unit: string; totalQuantity: number; companies: { companyId: number; companyName: string; quantity: number }[] };
  onClose: () => void;
}) {
  const total = product.companies.reduce((s, c) => s + c.quantity, 0);
  return (
    <Modal isOpen onClose={onClose} title={`Detalhe: ${product.productName}`} maxWidth="max-w-xl">
      <div className="space-y-4">
        <div className="flex items-center justify-between p-4 bg-primary/5 rounded-xl">
          <div>
            <p className="text-sm font-bold text-muted-foreground uppercase tracking-wider">Total Demandado</p>
            <p className="text-3xl font-display font-bold text-primary">{total} <span className="text-base font-medium text-muted-foreground">{product.unit}</span></p>
          </div>
          <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center">
            <Package className="w-7 h-7 text-primary" />
          </div>
        </div>

        <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
          <Building2 className="w-3.5 h-3.5" /> Empresas que pediram
        </p>
        <div className="space-y-2">
          {product.companies.map(c => (
            <div key={c.companyId} className="flex items-center justify-between p-3 bg-muted/20 rounded-xl border border-border/50">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Building2 className="w-5 h-5 text-primary" />
                </div>
                <p className="font-bold text-foreground text-sm">{c.companyName}</p>
              </div>
              <div className="text-right">
                <p className="font-display font-bold text-primary">{c.quantity}</p>
                <p className="text-xs text-muted-foreground">{product.unit}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

// ─── Main Page ─────────────────────────────────────────────────
export default function PurchasingPage() {
  const { data: companies } = useCompanies();
  const { data: products } = useProducts();

  const today = new Date();
  const defaultFrom = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
  const defaultTo = today.toISOString().split('T')[0];

  const [filters, setFilters] = useState({
    dateFrom: defaultFrom,
    dateTo: defaultTo,
    companyId: '',
    productId: '',
  });

  const { data, isLoading } = usePurchasingData(filters);
  const [detailProduct, setDetailProduct] = useState<any | null>(null);
  const [expandedShoppingList, setExpandedShoppingList] = useState(true);
  const [exporting, setExporting] = useState(false);

  const totalQty = useMemo(() => data?.products.reduce((s, p) => s + p.totalQuantity, 0) || 0, [data]);
  const totalValue = useMemo(() => data?.rawOrders.reduce((s, r) => s + r.totalPrice, 0) || 0, [data]);

  const handleExport = async () => {
    if (!data?.rawOrders.length) return;
    setExporting(true);
    try {
      await exportToExcel(data.rawOrders, filters);
    } finally {
      setExporting(false);
    }
  };

  const clearFilters = () => setFilters({ dateFrom: defaultFrom, dateTo: defaultTo, companyId: '', productId: '' });

  return (
    <Layout>
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Compras</h1>
          <p className="text-muted-foreground mt-1">Volume de frutas vendidas, lista de compras e exportação.</p>
        </div>
        <button
          data-testid="button-export-excel"
          onClick={handleExport}
          disabled={exporting || !data?.rawOrders.length}
          className="flex items-center gap-2 px-6 py-3 bg-green-600 text-white font-bold rounded-xl hover:bg-green-700 transition-colors shadow-lg disabled:opacity-50"
        >
          <FileSpreadsheet className="w-4 h-4" />
          {exporting ? "Gerando..." : "Exportar Excel"}
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-card rounded-2xl p-5 border border-border/50 premium-shadow flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
            <BarChart3 className="w-6 h-6 text-primary" />
          </div>
          <div>
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Produtos Diferentes</p>
            <p className="text-2xl font-display font-bold text-foreground mt-0.5">{data?.products.length || 0}</p>
          </div>
        </div>
        <div className="bg-card rounded-2xl p-5 border border-border/50 premium-shadow flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-secondary/10 flex items-center justify-center">
            <Package className="w-6 h-6 text-secondary" />
          </div>
          <div>
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Unidades Totais</p>
            <p className="text-2xl font-display font-bold text-foreground mt-0.5">{totalQty.toLocaleString('pt-BR')}</p>
          </div>
        </div>
        <div className="bg-card rounded-2xl p-5 border border-border/50 premium-shadow flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-green-100 flex items-center justify-center">
            <TrendingUp className="w-6 h-6 text-green-600" />
          </div>
          <div>
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Valor Total</p>
            <p className="text-2xl font-display font-bold text-foreground mt-0.5">
              R$ {totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-card rounded-2xl border border-border/50 premium-shadow p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Filter className="w-5 h-5 text-primary" />
            <h2 className="font-bold text-foreground">Filtros</h2>
          </div>
          <button onClick={clearFilters} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors font-medium">
            <X className="w-3.5 h-3.5" /> Limpar filtros
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase flex items-center gap-1">
              <Calendar className="w-3 h-3" /> Data Início
            </label>
            <input
              type="date"
              data-testid="filter-date-from"
              value={filters.dateFrom}
              onChange={e => setFilters(f => ({ ...f, dateFrom: e.target.value }))}
              className="w-full px-3 py-2 rounded-xl border-2 border-border focus:border-primary outline-none text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase flex items-center gap-1">
              <Calendar className="w-3 h-3" /> Data Fim
            </label>
            <input
              type="date"
              data-testid="filter-date-to"
              value={filters.dateTo}
              onChange={e => setFilters(f => ({ ...f, dateTo: e.target.value }))}
              className="w-full px-3 py-2 rounded-xl border-2 border-border focus:border-primary outline-none text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase">Empresa</label>
            <select
              data-testid="filter-company"
              value={filters.companyId}
              onChange={e => setFilters(f => ({ ...f, companyId: e.target.value }))}
              className="w-full px-3 py-2 rounded-xl border-2 border-border focus:border-primary outline-none text-sm"
            >
              <option value="">Todas</option>
              {companies?.map(c => <option key={c.id} value={c.id}>{c.companyName}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase">Produto</label>
            <select
              data-testid="filter-product"
              value={filters.productId}
              onChange={e => setFilters(f => ({ ...f, productId: e.target.value }))}
              className="w-full px-3 py-2 rounded-xl border-2 border-border focus:border-primary outline-none text-sm"
            >
              <option value="">Todos</option>
              {products?.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Products table */}
      <div className="bg-card rounded-2xl border border-border/50 premium-shadow overflow-hidden mb-6">
        <div className="p-5 border-b border-border/50 flex items-center gap-3 bg-muted/20">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <BarChart3 className="w-5 h-5 text-primary" />
          </div>
          <h2 className="text-lg font-bold text-foreground">Produtos Vendidos</h2>
          <span className="ml-auto text-sm text-muted-foreground font-medium">Clique num produto para ver por empresa</span>
        </div>

        <table className="w-full text-left">
          <thead>
            <tr className="bg-muted/30 border-b border-border/50 text-muted-foreground text-xs uppercase tracking-wider">
              <th className="px-6 py-3 font-semibold">Produto</th>
              <th className="px-6 py-3 font-semibold">Unidade</th>
              <th className="px-6 py-3 font-semibold text-right">Qtd. Total</th>
              <th className="px-6 py-3 font-semibold text-right">% do Total</th>
              <th className="px-6 py-3 font-semibold">Empresas</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {isLoading ? (
              <tr><td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">Carregando dados reais...</td></tr>
            ) : !data?.products.length ? (
              <tr><td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">Nenhum dado para os filtros selecionados</td></tr>
            ) : (
              data.products.map(p => {
                const pct = totalQty ? Math.round((p.totalQuantity / totalQty) * 100) : 0;
                return (
                  <tr
                    key={p.productId}
                    data-testid={`row-product-${p.productId}`}
                    onClick={() => setDetailProduct(p)}
                    className="hover:bg-primary/5 cursor-pointer transition-colors"
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                          <Package className="w-5 h-5 text-primary" />
                        </div>
                        <p className="font-bold text-foreground">{p.productName}</p>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-muted-foreground font-medium text-sm uppercase tracking-wider">{p.unit}</td>
                    <td className="px-6 py-4 text-right">
                      <span className="text-2xl font-display font-bold text-primary">{p.totalQuantity}</span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="h-2 w-20 bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-sm font-bold text-muted-foreground">{pct}%</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1 flex-wrap">
                        {p.companies.slice(0, 3).map(c => (
                          <span key={c.companyId} className="px-2 py-0.5 bg-muted text-muted-foreground rounded-md text-xs font-medium">
                            {c.companyName.split(' ')[0]}
                          </span>
                        ))}
                        {p.companies.length > 3 && (
                          <span className="text-xs text-muted-foreground font-medium">+{p.companies.length - 3}</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Shopping list */}
      <div className="bg-card rounded-2xl border border-border/50 premium-shadow overflow-hidden">
        <button
          className="w-full p-5 border-b border-border/50 flex items-center gap-3 bg-muted/20 hover:bg-muted/30 transition-colors"
          onClick={() => setExpandedShoppingList(!expandedShoppingList)}
        >
          <div className="w-10 h-10 rounded-xl bg-secondary/10 flex items-center justify-center">
            <ShoppingBasket className="w-5 h-5 text-secondary" />
          </div>
          <h2 className="text-lg font-bold text-foreground">Lista de Compras</h2>
          <span className="text-sm text-muted-foreground ml-2">Para o período selecionado</span>
          <span className="ml-auto">{expandedShoppingList ? <ChevronUp className="w-5 h-5 text-muted-foreground" /> : <ChevronDown className="w-5 h-5 text-muted-foreground" />}</span>
        </button>

        {expandedShoppingList && (
          <div className="p-6">
            {!data?.products.length ? (
              <p className="text-center text-muted-foreground py-4">Nenhum produto encontrado para o período</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {data.products.map((p, idx) => (
                  <div
                    key={p.productId}
                    onClick={() => setDetailProduct(p)}
                    className="flex items-center justify-between p-4 bg-muted/10 rounded-2xl border-2 border-border/50 hover:border-primary/40 hover:bg-primary/5 cursor-pointer transition-all group"
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-7 h-7 rounded-lg bg-primary text-white flex items-center justify-center text-xs font-bold">
                        {idx + 1}
                      </span>
                      <div>
                        <p className="font-bold text-foreground group-hover:text-primary transition-colors">{p.productName}</p>
                        <p className="text-xs text-muted-foreground uppercase tracking-wider">{p.unit}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-display font-bold text-primary">{p.totalQuantity}</p>
                      <p className="text-xs text-muted-foreground">unidades</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Product detail modal */}
      {detailProduct && (
        <ProductDetailModal product={detailProduct} onClose={() => setDetailProduct(null)} />
      )}
    </Layout>
  );
}
