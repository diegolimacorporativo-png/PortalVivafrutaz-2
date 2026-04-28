import { useState, useMemo, useEffect } from 'react';
import { ContextualTip } from '@/components/ContextualTip';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { normalizeList, normalizeOne } from '@/lib/normalizeResponse';
import { useToast } from '@/hooks/use-toast';
import {
  Receipt, Search, Filter, Calendar, Building2, Download, Eye,
  CheckCircle2, Clock, XCircle, Send, ChevronDown, ChevronRight, RefreshCw,
  TrendingUp, Package, Globe, Landmark, Lock, FileSpreadsheet
} from 'lucide-react';
import { downloadDanfe, openDanfe, type DanfeData } from '@/lib/danfe-generator';

const FISCAL_LABEL: Record<string, string> = {
  nota_pendente: 'Pendente',
  nota_exportada: 'Exportada',
  nota_emitida: 'Emitida',
  nota_cancelada: 'Cancelada',
};

const FISCAL_BADGE: Record<string, string> = {
  nota_pendente: 'bg-yellow-100 text-yellow-700 border-yellow-300',
  nota_exportada: 'bg-blue-100 text-blue-700 border-blue-300',
  nota_emitida: 'bg-green-100 text-green-700 border-green-300',
  nota_cancelada: 'bg-red-100 text-red-700 border-red-300',
};

const FISCAL_ICON: Record<string, any> = {
  nota_pendente: Clock,
  nota_exportada: Send,
  nota_emitida: CheckCircle2,
  nota_cancelada: XCircle,
};

function fmt(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('pt-BR');
}

export default function FiscalManagement() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('todos');
  const [filterContract, setFilterContract] = useState('todos');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [expandedCompany, setExpandedCompany] = useState<number | null>(null);
  const [selectedOrders, setSelectedOrders] = useState<Set<number>>(new Set());
  const [danfeLoading, setDanfeLoading] = useState<number | null>(null);

  const { data: ordersRaw = [], isLoading, refetch } = useQuery<any[]>({
    queryKey: ['/api/orders'],
    select: normalizeList,
    staleTime: 30000,
  });

  const { data: companies = [] } = useQuery<any[]>({
    queryKey: ['/api/companies'],
    select: normalizeList,
    staleTime: 60000,
  });

  const { data: companyConfig } = useQuery<any>({
    queryKey: ['/api/company-config'],
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const companyMap = useMemo(() => {
    const m: Record<number, any> = {};
    (companies as any[]).forEach((c: any) => { m[c.id] = c; });
    return m;
  }, [companies]);

  const orders = useMemo(() => {
    return (ordersRaw as any[]).filter((o: any) => {
      if (filterStatus !== 'todos') {
        const status = o.fiscalStatus || 'nota_pendente';
        if (filterStatus === 'faturado' && status !== 'nota_emitida') return false;
        if (filterStatus === 'pendente' && (status && status !== 'nota_pendente')) return false;
        if (!['faturado', 'pendente', 'todos'].includes(filterStatus) && status !== filterStatus) return false;
      }

      const company = companyMap[o.companyId];
      if (filterContract !== 'todos') {
        if (filterContract === 'avulso' && company?.clientType !== 'avulso') return false;
        if (filterContract === 'contratual' && company?.clientType !== 'contratual') return false;
        if (filterContract === 'mensal' && company?.clientType !== 'mensal') return false;
        if (filterContract === 'semanal' && company?.clientType !== 'semanal') return false;
      }

      const companyName = company?.companyName || '';
      if (dateFrom && o.deliveryDate && o.deliveryDate < dateFrom) return false;
      if (dateTo && o.deliveryDate && o.deliveryDate > dateTo) return false;

      if (search) {
        const q = search.toLowerCase();
        if (!companyName.toLowerCase().includes(q) && !String(o.id).includes(q)) return false;
      }
      return true;
    });
  }, [ordersRaw, filterStatus, filterContract, dateFrom, dateTo, search, companyMap]);

  const grouped = useMemo(() => {
    const g: Record<number, { company: any; orders: any[]; total: number }> = {};
    orders.forEach((o: any) => {
      const company = companyMap[o.companyId] || { companyName: `Empresa #${o.companyId}`, id: o.companyId };
      if (!g[o.companyId]) {
        g[o.companyId] = { company, orders: [], total: 0 };
      }
      g[o.companyId].orders.push(o);
      g[o.companyId].total += Number(o.totalValue || 0);
    });
    return Object.values(g).sort((a, b) => b.total - a.total);
  }, [orders, companyMap]);

  const stats = useMemo(() => {
    const pending = orders.filter((o: any) => !o.fiscalStatus || o.fiscalStatus === 'nota_pendente');
    const emitted = orders.filter((o: any) => o.fiscalStatus === 'nota_emitida');
    const exported = orders.filter((o: any) => o.fiscalStatus === 'nota_exportada');
    return {
      total: orders.length,
      pending: pending.length,
      emitted: emitted.length,
      exported: exported.length,
      totalValue: orders.reduce((s: number, o: any) => s + Number(o.totalValue || 0), 0),
      pendingValue: pending.reduce((s: number, o: any) => s + Number(o.totalValue || 0), 0),
    };
  }, [orders]);

  const fiscalMutation = useMutation({
    mutationFn: ({ orderId, fiscalStatus }: { orderId: number; fiscalStatus: string }) =>
      apiRequest('PATCH', `/api/orders/${orderId}/fiscal`, { fiscalStatus }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/orders'] });
      toast({ title: 'Status fiscal atualizado com sucesso' });
    },
    onError: () => toast({ title: 'Erro ao atualizar status', variant: 'destructive' }),
  });

  const blingMutation = useMutation({
    mutationFn: (orderId: number) =>
      apiRequest('POST', `/api/orders/${orderId}/bling-export`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/orders'] });
      toast({ title: 'Exportado para Bling com sucesso' });
    },
    onError: (err: any) => {
      const msg = err?.message || 'Erro ao exportar para Bling';
      toast({ title: msg, variant: 'destructive' });
    },
  });

  const buildDanfeData = async (order: any): Promise<DanfeData> => {
    const company = companyMap[order.companyId] || {};

    let detail: any = { order, items: [] };
    try {
      const res = await fetch(`/api/orders/${order.id}`, { credentials: 'include' });
      if (res.ok) detail = normalizeOne<any>(await res.json()) ?? detail;
    } catch { /* use fallback */ }

    const detailOrder = detail.order || detail;
    const rawItems = detail.items || detailOrder.items || [];

    const items = rawItems.map((item: any) => ({
      productName: item.productName || item.name || `Produto #${item.productId}`,
      quantity: Number(item.quantity || 1),
      unit: item.unit || 'un',
      unitPrice: Number(item.unitPrice || item.price || 0),
      totalPrice: Number(item.totalPrice || item.totalValue || (item.quantity * item.unitPrice) || 0),
      ncm: item.ncm || null,
      cfop: item.cfop || null,
    }));

    const cfg = companyConfig || {};

    return {
      order: {
        id: order.id,
        orderCode: order.orderCode || `VF-${order.id}`,
        status: order.status || 'ACTIVE',
        orderDate: order.orderDate || order.createdAt || new Date().toISOString(),
        deliveryDate: order.deliveryDate || null,
        weekReference: order.weekReference || null,
        totalValue: order.totalValue,
        orderNote: order.orderNote || null,
        adminNote: order.adminNote || null,
        companyId: order.companyId,
        preNotaNumber: detailOrder?.preNotaNumber || order.preNotaNumber || null,
        fiscalStatus: detailOrder?.fiscalStatus || order.fiscalStatus || null,
      },
      items,
      company: {
        companyName: company?.companyName || `Empresa #${order.companyId}`,
        cnpj: company?.cnpj || null,
        contactName: company?.contactName || null,
        phone: company?.phone || null,
        addressStreet: company?.addressStreet || null,
        addressNumber: company?.addressNumber || null,
        addressNeighborhood: company?.addressNeighborhood || null,
        addressCity: company?.addressCity || null,
        addressZip: company?.addressZip || null,
        addressState: company?.addressState || null,
        stateRegistration: company?.stateRegistration || null,
      },
      vivaFrutaz: {
        companyName: cfg?.companyName || 'VivaFrutaz',
        fantasyName: cfg?.fantasyName || null,
        cnpj: cfg?.cnpj || null,
        address: cfg?.address || null,
        city: cfg?.city || null,
        state: cfg?.state || null,
        cep: cfg?.cep || null,
        phone: cfg?.phone || null,
        email: cfg?.email || null,
        stateRegistration: cfg?.stateRegistration || null,
        defaultCfop: cfg?.defaultCfop || '5102',
        defaultNatureza: cfg?.defaultNatureza || 'Venda de mercadoria adquirida',
        logoBase64: cfg?.logoBase64 || null,
        logoType: cfg?.logoType || null,
      },
    };
  };

  const handleViewDanfe = async (order: any) => {
    setDanfeLoading(order.id);
    try {
      const data = await buildDanfeData(order);
      await openDanfe(data);
    } catch (e) {
      toast({ title: 'Erro ao gerar DANFE para visualização', variant: 'destructive' });
    } finally {
      setDanfeLoading(null);
    }
  };

  const handleDownloadDanfe = async (order: any) => {
    setDanfeLoading(order.id);
    try {
      const data = await buildDanfeData(order);
      await downloadDanfe(data);
      toast({ title: 'DANFE baixado com sucesso' });
    } catch (e) {
      toast({ title: 'Erro ao baixar DANFE', variant: 'destructive' });
    } finally {
      setDanfeLoading(null);
    }
  };

  const toggleOrder = (id: number) => {
    setSelectedOrders(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllInGroup = (groupOrders: any[]) => {
    const ids = groupOrders.map((o: any) => o.id);
    const allSelected = ids.every(id => selectedOrders.has(id));
    setSelectedOrders(prev => {
      const next = new Set(prev);
      if (allSelected) ids.forEach(id => next.delete(id));
      else ids.forEach(id => next.add(id));
      return next;
    });
  };

  const handleBulkStatus = (status: string) => {
    if (selectedOrders.size === 0) {
      toast({ title: 'Selecione ao menos um pedido', variant: 'destructive' });
      return;
    }
    selectedOrders.forEach(id => fiscalMutation.mutate({ orderId: id, fiscalStatus: status }));
    setSelectedOrders(new Set());
  };

  return (
    <div className="space-y-6">
      <ContextualTip
        tipId="fiscal-management-intro"
        variant="info"
        title="Gestão de Notas Fiscais"
        message="Utilize esta área para gerar e exportar notas fiscais para o Bling, visualizar DANFEs e acompanhar o faturamento. Notas de entrada também podem ser importadas via OCR para atualizar o inventário automaticamente."
        learnMoreMessage="Como funciona a gestão de notas fiscais e a exportação para o Bling?"
      />
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Receipt className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Gestão de Notas Fiscais</h1>
            <p className="text-sm text-muted-foreground">Faturamento, DANFE e exportação para Bling</p>
          </div>
        </div>
        <button
          data-testid="button-refresh-fiscal"
          onClick={() => {
            refetch();
            queryClient.invalidateQueries({ queryKey: ['/api/orders'] });
            toast({ title: 'Dados atualizados' });
          }}
          className="flex items-center gap-2 px-4 py-2 bg-muted hover:bg-muted/80 rounded-xl text-sm font-medium text-muted-foreground transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Atualizar
        </button>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total de Pedidos', value: stats.total, icon: Package, color: 'text-foreground' },
          { label: 'Pendentes', value: stats.pending, sub: fmt(stats.pendingValue), icon: Clock, color: 'text-yellow-600' },
          { label: 'Exportados (Bling)', value: stats.exported, icon: Send, color: 'text-blue-600' },
          { label: 'Emitidos', value: stats.emitted, icon: CheckCircle2, color: 'text-green-600' },
        ].map(({ label, value, sub, icon: Icon, color }) => (
          <div key={label} className="bg-card border border-border/50 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <Icon className={`w-4 h-4 ${color}`} />
              <span className="text-xs text-muted-foreground font-medium">{label}</span>
            </div>
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub} pendente</p>}
          </div>
        ))}
      </div>

      {/* FASE NF.7.9 — Resumo ICMS (Importados 4% vs Normal 7/12/18%).
          Seção 100% aditiva. Não substitui nem desloca os stats acima.
          Lê de GET /api/fiscal/icms-summary (endpoint novo, tenant-scoped). */}
      <IcmsSummarySection />

      {/* Filters */}
      <div className="bg-card border border-border/50 rounded-2xl p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground mb-1">
          <Filter className="w-4 h-4 text-primary" />
          Filtros
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="relative lg:col-span-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <input
              data-testid="input-fiscal-search"
              type="text"
              placeholder="Buscar empresa ou nº do pedido..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-border/50 rounded-xl bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <input
              data-testid="input-fiscal-date-from"
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="flex-1 px-3 py-2 text-sm border border-border/50 rounded-xl bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <input
              data-testid="input-fiscal-date-to"
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="flex-1 px-3 py-2 text-sm border border-border/50 rounded-xl bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          <select
            data-testid="select-fiscal-status"
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            className="px-3 py-2 text-sm border border-border/50 rounded-xl bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            <option value="todos">Todos os status</option>
            <option value="pendente">Pendente de faturamento</option>
            <option value="nota_exportada">Exportada (Bling)</option>
            <option value="faturado">Faturado (Emitida)</option>
            <option value="nota_cancelada">Cancelada</option>
          </select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <select
            data-testid="select-fiscal-contract"
            value={filterContract}
            onChange={e => setFilterContract(e.target.value)}
            className="px-3 py-2 text-sm border border-border/50 rounded-xl bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            <option value="todos">Todos os contratos</option>
            <option value="avulso">Cliente avulso</option>
            <option value="contratual">Cliente contratual</option>
            <option value="mensal">Faturamento mensal</option>
            <option value="semanal">Faturamento semanal</option>
          </select>

          {selectedOrders.size > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium text-foreground">{selectedOrders.size} selecionado(s)</span>
              <button
                data-testid="button-bulk-mark-emitida"
                onClick={() => handleBulkStatus('nota_emitida')}
                className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs font-bold transition-colors"
              >
                → Emitida
              </button>
              <button
                data-testid="button-bulk-mark-exportada"
                onClick={() => handleBulkStatus('nota_exportada')}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-colors"
              >
                → Exportada
              </button>
              <button
                data-testid="button-bulk-mark-pendente"
                onClick={() => handleBulkStatus('nota_pendente')}
                className="px-3 py-1.5 bg-yellow-500 hover:bg-yellow-600 text-white rounded-lg text-xs font-bold transition-colors"
              >
                → Pendente
              </button>
              <button
                onClick={() => setSelectedOrders(new Set())}
                className="px-3 py-1.5 bg-muted hover:bg-muted/80 text-muted-foreground rounded-lg text-xs font-medium transition-colors"
              >
                Limpar
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Orders grouped by company */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
          <span className="ml-3 text-muted-foreground">Carregando pedidos...</span>
        </div>
      ) : grouped.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Receipt className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">Nenhum pedido encontrado</p>
          <p className="text-sm">Tente ajustar os filtros</p>
        </div>
      ) : (
        <div className="space-y-3">
          {grouped.map(({ company, orders: compOrders, total }) => {
            const isExpanded = expandedCompany === company.id;
            const allSelected = compOrders.every(o => selectedOrders.has(o.id));
            const someSelected = compOrders.some(o => selectedOrders.has(o.id));
            const pendingCount = compOrders.filter(o => !o.fiscalStatus || o.fiscalStatus === 'nota_pendente').length;
            const emittedCount = compOrders.filter(o => o.fiscalStatus === 'nota_emitida').length;

            return (
              <div key={company.id} className="bg-card border border-border/50 rounded-2xl overflow-hidden" data-testid={`company-fiscal-group-${company.id}`}>
                <div
                  className="flex items-center gap-3 p-4 cursor-pointer hover:bg-muted/30 transition-colors"
                  onClick={() => setExpandedCompany(isExpanded ? null : company.id)}
                >
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={el => { if (el) el.indeterminate = someSelected && !allSelected; }}
                    onChange={() => toggleAllInGroup(compOrders)}
                    onClick={e => e.stopPropagation()}
                    className="w-4 h-4 rounded border-border accent-primary flex-shrink-0"
                    data-testid={`checkbox-group-${company.id}`}
                  />

                  <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Building2 className="w-4 h-4 text-primary" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-bold text-foreground truncate text-sm">{company.companyName}</h3>
                      {company.clientType && (
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                          company.clientType === 'contratual'
                            ? 'bg-purple-100 text-purple-700 border-purple-300'
                            : company.clientType === 'mensal'
                            ? 'bg-orange-100 text-orange-700 border-orange-300'
                            : 'bg-blue-100 text-blue-700 border-blue-300'
                        }`}>
                          {company.clientType === 'contratual' ? 'Contratual' : company.clientType === 'mensal' ? 'Mensal' : company.clientType === 'semanal' ? 'Semanal' : 'Avulso'}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-4 mt-0.5 text-xs text-muted-foreground">
                      <span>{compOrders.length} pedido(s)</span>
                      {pendingCount > 0 && <span className="text-yellow-600">{pendingCount} pendente(s)</span>}
                      {emittedCount > 0 && <span className="text-green-600">{emittedCount} emitida(s)</span>}
                    </div>
                  </div>

                  <div className="text-right flex-shrink-0">
                    <p className="font-bold text-foreground text-sm">{fmt(total)}</p>
                    <p className="text-xs text-muted-foreground">total período</p>
                  </div>

                  {isExpanded
                    ? <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    : <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  }
                </div>

                {isExpanded && (
                  <div className="border-t border-border/30">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-muted/30 text-xs text-muted-foreground">
                            <th className="text-left px-4 py-2 w-8"></th>
                            <th className="text-left px-4 py-2">Pedido</th>
                            <th className="text-left px-4 py-2">Entrega</th>
                            <th className="text-left px-4 py-2">Status Fiscal</th>
                            <th className="text-right px-4 py-2">Valor</th>
                            <th className="text-right px-4 py-2">Ações</th>
                          </tr>
                        </thead>
                        <tbody>
                          {compOrders.map((order: any) => {
                            const fStatus = order.fiscalStatus || 'nota_pendente';
                            const isLoadingDanfe = danfeLoading === order.id;
                            return (
                              <tr key={order.id} className={`border-t border-border/20 hover:bg-muted/20 transition-colors ${selectedOrders.has(order.id) ? 'bg-primary/5' : ''}`}>
                                <td className="px-4 py-3">
                                  <input
                                    type="checkbox"
                                    checked={selectedOrders.has(order.id)}
                                    onChange={() => toggleOrder(order.id)}
                                    className="w-4 h-4 rounded border-border accent-primary"
                                    data-testid={`checkbox-order-${order.id}`}
                                  />
                                </td>
                                <td className="px-4 py-3">
                                  <div>
                                    <span className="font-mono font-bold text-foreground">#{order.id}</span>
                                    {order.preNotaNumber && (
                                      <p className="text-[10px] text-muted-foreground mt-0.5">{order.preNotaNumber}</p>
                                    )}
                                    {order.erpId && (
                                      <p className="text-[10px] text-blue-600 mt-0.5">{order.erpId}</p>
                                    )}
                                  </div>
                                </td>
                                <td className="px-4 py-3 text-muted-foreground text-xs">{fmtDate(order.deliveryDate)}</td>
                                <td className="px-4 py-3">
                                  <select
                                    value={fStatus}
                                    onChange={e => fiscalMutation.mutate({ orderId: order.id, fiscalStatus: e.target.value })}
                                    className={`text-xs font-bold px-2 py-1 rounded-lg border cursor-pointer bg-transparent ${FISCAL_BADGE[fStatus] || 'bg-gray-100 text-gray-600 border-gray-300'}`}
                                    data-testid={`select-fiscal-status-${order.id}`}
                                  >
                                    <option value="nota_pendente">Pendente</option>
                                    <option value="nota_exportada">Exportada</option>
                                    <option value="nota_emitida">Emitida</option>
                                    <option value="nota_cancelada">Cancelada</option>
                                  </select>
                                </td>
                                <td className="px-4 py-3 text-right font-bold text-foreground">{fmt(Number(order.totalValue || 0))}</td>
                                <td className="px-4 py-3">
                                  <div className="flex items-center gap-1.5 justify-end flex-wrap">
                                    <button
                                      data-testid={`button-view-danfe-fiscal-${order.id}`}
                                      onClick={() => handleViewDanfe(order)}
                                      disabled={isLoadingDanfe}
                                      className="flex items-center gap-1 px-2.5 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-xs font-bold transition-colors border border-blue-200 disabled:opacity-50"
                                      title="Visualizar DANFE"
                                    >
                                      {isLoadingDanfe ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
                                      DANFE
                                    </button>
                                    <button
                                      data-testid={`button-download-danfe-fiscal-${order.id}`}
                                      onClick={() => handleDownloadDanfe(order)}
                                      disabled={isLoadingDanfe}
                                      className="flex items-center gap-1 px-2.5 py-1.5 bg-muted hover:bg-muted/80 text-muted-foreground rounded-lg text-xs font-bold transition-colors border border-border/50 disabled:opacity-50"
                                      title="Baixar DANFE PDF"
                                    >
                                      <Download className="w-3.5 h-3.5" />
                                      PDF
                                    </button>
                                    <button
                                      data-testid={`button-bling-fiscal-${order.id}`}
                                      onClick={() => blingMutation.mutate(order.id)}
                                      disabled={blingMutation.isPending || order.erpExportStatus === 'exportado'}
                                      className="flex items-center gap-1 px-2.5 py-1.5 bg-orange-50 hover:bg-orange-100 text-orange-700 rounded-lg text-xs font-bold transition-colors border border-orange-200 disabled:opacity-50 disabled:cursor-not-allowed"
                                      title={order.erpExportStatus === 'exportado' ? `Já exportado: ${order.erpId}` : 'Exportar para Bling'}
                                    >
                                      <Send className="w-3.5 h-3.5" />
                                      {order.erpExportStatus === 'exportado' ? 'Exportado' : 'Bling'}
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="bg-muted/20 border-t border-border/30">
                            <td colSpan={4} className="px-4 py-2 text-xs text-muted-foreground font-medium">
                              Consolidado — {compOrders.length} pedido(s) · {compOrders.filter(o => o.fiscalStatus === 'nota_emitida').length} emitida(s)
                            </td>
                            <td className="px-4 py-2 text-right font-bold text-foreground">{fmt(total)}</td>
                            <td className="px-4 py-2"></td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="pb-4 text-center text-xs text-muted-foreground">
        <TrendingUp className="w-3.5 h-3.5 inline mr-1" />
        Total geral visível: <strong>{fmt(stats.totalValue)}</strong> em {stats.total} pedidos
      </div>
    </div>
  );
}

/**
 * FASE NF.7.9 — Resumo ICMS (Importados 4% × Normal 7/12/18%).
 *
 * Componente isolado, read-only. Lê de GET /api/fiscal/icms-summary.
 * Tenant scope é garantido pelo middleware do servidor — o front não
 * envia empresaId. Mostra dois cards (laranja = importado, azul =
 * normal) seguindo o padrão visual já estabelecido em produtos
 * (NF.7.8.2/NF.7.8.3).
 */
type IcmsBucket = {
  totalNFs: number;
  totalItens: number;
  totalBase: number;
  totalICMS: number;
};
type IcmsSummary = {
  importado: IcmsBucket;
  normal: IcmsBucket;
  meta: {
    nfsConsideradas: number;
    nfsIgnoradas: number;
    statusConsiderados: string[];
  };
};

function IcmsSummarySection() {
  // FASE NF.7.9.1 — filtros opcionais de período. Estado local
  // (encapsulado nesta seção). Default vazio = histórico completo,
  // mantendo o comportamento da NF.7.9. React Query refaz a chamada
  // automaticamente quando as datas mudam (parte do queryKey).
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const { toast } = useToast();

  // FASE NF.7.9.4 — Indicador visual de "mês fechado" (UI only).
  // Heurística de SESSÃO: marca como fechado quando o usuário aciona
  // closeMutation com sucesso para o período atualmente filtrado.
  // Reseta sempre que o filtro muda. Não persiste após reload — limitação
  // aceita nesta fase (poderá ser resolvida com GET /fiscal/closures).
  const [isClosed, setIsClosed] = useState(false);
  useEffect(() => {
    setIsClosed(false);
  }, [startDate, endDate]);

  // FASE NF.7.9.9 — Badge persistente de mês fechado.
  // Consulta read-only ao endpoint NF.7.9.8 (GET /api/fiscal/closures),
  // já tenant-scoped pelo middleware. Sem mudança de backend, sem nova
  // lógica de datas (reaproveita `periodToClose` definido logo abaixo)
  // e sem substituir o badge existente — apenas evolui a fonte de
  // verdade combinando-a por OR com o estado de sessão `isClosed`.
  const { data: closuresData } = useQuery<{ success: boolean; data: Array<{ year: number; month: number; closedAt: string }> }>({
    queryKey: ['/api/fiscal/closures'],
    staleTime: 60_000,
  });

  // FASE NF.7.9.2 — mutação para fechar o mês fiscal selecionado.
  // Lê o ano/mês do filtro de "Data inicial" (preferência) ou "Data
  // final" como fallback. Sem filtro definido → botão fica desabilitado
  // (ver UI abaixo) para evitar fechamento acidental.
  const closeMutation = useMutation({
    mutationFn: async ({ year, month }: { year: number; month: number }) => {
      const res = await apiRequest('POST', '/api/fiscal/close-period', { year, month });
      return res.json();
    },
    onSuccess: (_data, vars) => {
      toast({
        title: 'Mês fechado',
        description: `Período ${String(vars.month).padStart(2, '0')}/${vars.year} consolidado. Mutações nesse mês ficam bloqueadas.`,
      });
      // FASE NF.7.9.4 — flag de sessão para o badge visual.
      setIsClosed(true);
      // Refetch do summary (a tabela `fiscal_closures` não muda os
      // valores, mas mantemos a invalidação para futuras camadas que
      // queiram exibir o status "fechado" no card).
      queryClient.invalidateQueries({ queryKey: ['/api/fiscal/icms-summary'] });
      // FASE NF.7.9.9 — invalida a lista de meses fechados para que o
      // badge persistente reflita o novo fechamento imediatamente, sem
      // depender de reload e sem alterar a chamada existente acima.
      queryClient.invalidateQueries({ queryKey: ['/api/fiscal/closures'] });
    },
    onError: (err: any) => {
      toast({
        title: 'Falha ao fechar período',
        description: err?.message || 'Erro desconhecido',
        variant: 'destructive',
      });
    },
  });

  // Deriva year/month do filtro. "YYYY-MM-DD" → year, month (1-12).
  const periodToClose = useMemo(() => {
    const src = startDate || endDate;
    if (!src) return null;
    const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(src);
    if (!m) return null;
    return { year: Number(m[1]), month: Number(m[2]) };
  }, [startDate, endDate]);

  // FASE NF.7.9.9 — derivação persistente de "mês fechado".
  // Reaproveita `periodToClose` (mesma lógica de datas, sem duplicar)
  // e cruza com a lista de fechamentos retornada pelo backend. Se o
  // período do filtro corresponde a um item em `closuresData.data`,
  // o badge deve aparecer mesmo após reload.
  const isClosedPersisted = useMemo(() => {
    if (!periodToClose) return false;
    const list = closuresData?.data ?? [];
    return list.some(
      (c) => c.year === periodToClose.year && c.month === periodToClose.month,
    );
  }, [periodToClose, closuresData]);

  // Estado efetivo: combina sessão (NF.7.9.4) com persistente (NF.7.9.9)
  // por OR. Mantém o comportamento anterior intacto e só adiciona a
  // capacidade de sobreviver ao reload.
  const isClosedEffective = isClosed || isClosedPersisted;

  const { data, isLoading, isError } = useQuery<IcmsSummary>({
    queryKey: ['/api/fiscal/icms-summary', startDate, endDate],
    // queryFn customizada porque o default faz queryKey.join("/") —
    // aqui precisamos enviar as datas como query string opcional.
    queryFn: async () => {
      const params = new URLSearchParams();
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);
      const qs = params.toString();
      const url = qs
        ? `/api/fiscal/icms-summary?${qs}`
        : '/api/fiscal/icms-summary';
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });

  const importado = data?.importado;
  const normal = data?.normal;
  const meta = data?.meta;
  const hasFilter = Boolean(startDate || endDate);

  // FASE NF.7.9.6 — Helpers inline para atalhos de período (UX).
  // Apenas formatação/cálculo de datas no fuso local; NÃO tocam queryFn,
  // endpoint nem lógica de filtro existente — só populam os mesmos
  // setStartDate/setEndDate, e o useQuery refaz a chamada via queryKey.
  function formatDate(d: Date): string {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  function getCurrentMonthRange() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { start: formatDate(start), end: formatDate(end) };
  }
  function getLastMonthRange() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    return { start: formatDate(start), end: formatDate(end) };
  }
  function getLast90Days() {
    const now = new Date();
    const start = new Date(now);
    start.setDate(now.getDate() - 90);
    return { start: formatDate(start), end: formatDate(now) };
  }

  return (
    <div
      className="bg-card border border-border/50 rounded-2xl p-4"
      data-testid="section-icms-summary"
    >
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Receipt className="w-4 h-4 text-primary" />
          Resumo ICMS — Importados (4%) vs Normal (7/12/18%)
          {/* FASE NF.7.9.4 — Badge "Fechado" (UI only).
              Aparece somente após closeMutation.onSuccess na sessão
              atual; reseta quando o usuário muda o período.
              FASE NF.7.9.9 — passou a usar `isClosedEffective` (sessão
              OR persistente via /api/fiscal/closures), o que mantém o
              comportamento anterior e adiciona persistência após reload. */}
          {isClosedEffective && (
            <span
              data-testid="badge-icms-closed"
              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-bold rounded-md bg-red-100 text-red-700 border border-red-300"
              title="Período fechado — alterações bloqueadas"
            >
              <Lock className="w-3 h-3" />
              Fechado
            </span>
          )}
        </div>
        {meta && (
          <span className="text-xs text-muted-foreground" data-testid="text-icms-meta">
            {meta.nfsConsideradas} NF-e(s) consideradas
            {meta.nfsIgnoradas > 0 && ` · ${meta.nfsIgnoradas} ignorada(s)`}
          </span>
        )}
      </div>

      {/* FASE NF.7.9.1 — Filtro de período (opcional).
          Default vazio = histórico completo. onChange dispara refetch
          automaticamente via queryKey. Botão "Limpar" só aparece quando
          há algum filtro ativo. */}
      <div
        className="flex items-end flex-wrap gap-3 mb-4 pb-3 border-b border-border/50"
        data-testid="filter-icms-period"
      >
        <div className="flex items-center gap-1 text-xs font-semibold text-muted-foreground mr-1">
          <Calendar className="w-3.5 h-3.5" />
          Período
        </div>
        {/* FASE NF.7.9.6 — Atalhos de período (UX).
            Apenas setam startDate/endDate; o useQuery refaz a chamada
            via queryKey. Não substituem os inputs — complementam. */}
        <div className="flex gap-2 flex-wrap" data-testid="period-shortcuts">
          <button
            type="button"
            data-testid="btn-period-current-month"
            onClick={() => {
              const r = getCurrentMonthRange();
              setStartDate(r.start);
              setEndDate(r.end);
            }}
            className="px-2 py-1 text-[10px] font-semibold border border-border rounded-md text-muted-foreground hover:border-blue-300 hover:text-blue-700 transition-colors"
          >
            Mês atual
          </button>
          <button
            type="button"
            data-testid="btn-period-last-month"
            onClick={() => {
              const r = getLastMonthRange();
              setStartDate(r.start);
              setEndDate(r.end);
            }}
            className="px-2 py-1 text-[10px] font-semibold border border-border rounded-md text-muted-foreground hover:border-blue-300 hover:text-blue-700 transition-colors"
          >
            Mês passado
          </button>
          <button
            type="button"
            data-testid="btn-period-90-days"
            onClick={() => {
              const r = getLast90Days();
              setStartDate(r.start);
              setEndDate(r.end);
            }}
            className="px-2 py-1 text-[10px] font-semibold border border-border rounded-md text-muted-foreground hover:border-blue-300 hover:text-blue-700 transition-colors"
          >
            90 dias
          </button>
        </div>
        <div className="flex flex-col">
          <label className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">
            Data inicial
          </label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            data-testid="input-icms-start-date"
            className="px-2 py-1.5 text-sm rounded-lg border border-border focus:border-primary outline-none bg-background"
          />
        </div>
        <div className="flex flex-col">
          <label className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">
            Data final
          </label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            data-testid="input-icms-end-date"
            className="px-2 py-1.5 text-sm rounded-lg border border-border focus:border-primary outline-none bg-background"
          />
        </div>
        {hasFilter && (
          <button
            type="button"
            onClick={() => {
              setStartDate('');
              setEndDate('');
            }}
            data-testid="button-icms-clear-filter"
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border text-muted-foreground hover:bg-muted transition-colors"
          >
            Limpar filtro
          </button>
        )}

        {/* FASE NF.7.9.3 — Botão "Exportar CSV".
            Usa o mesmo filtro de período já aplicado ao resumo. Sem
            filtro → exporta histórico inteiro. Sem dados → CSV com
            zeros (servidor já trata). Não dispara mutação — só GET. */}
        <button
          type="button"
          onClick={() => {
            const params = new URLSearchParams();
            if (startDate) params.set('startDate', startDate);
            if (endDate) params.set('endDate', endDate);
            const qs = params.toString();
            const url = qs
              ? `/api/fiscal/icms-summary/export?${qs}`
              : '/api/fiscal/icms-summary/export';
            // Anchor download — preserva o filename do header
            // Content-Disposition do servidor.
            const a = document.createElement('a');
            a.href = url;
            a.rel = 'noopener';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
          }}
          data-testid="button-icms-export-csv"
          title="Exportar resumo ICMS em CSV (uso contábil)"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-colors"
        >
          <Download className="w-3.5 h-3.5" />
          Exportar CSV
        </button>

        {/* FASE NF.7.9.5 — Botão "Exportar Excel".
            Mesmo filtro de período do CSV; sem filtro → histórico inteiro.
            Endpoint dedicado /export-xlsx (Excel nativo, não CSV disfarçado).
            Tom azul para diferenciar do verde do CSV. */}
        <a
          href={(() => {
            const params = new URLSearchParams();
            if (startDate) params.set('startDate', startDate);
            if (endDate) params.set('endDate', endDate);
            const qs = params.toString();
            return qs
              ? `/api/fiscal/icms-summary/export-xlsx?${qs}`
              : '/api/fiscal/icms-summary/export-xlsx';
          })()}
          data-testid="button-icms-export-xlsx"
          title="Exportar resumo ICMS em Excel (.xlsx)"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-blue-300 text-blue-700 bg-blue-50 hover:bg-blue-100 transition-colors"
        >
          <FileSpreadsheet className="w-3.5 h-3.5" />
          Exportar Excel
        </a>

        {/* FASE NF.7.9.2 — Botão "Fechar mês". Trava mutações em pedidos
            do mês selecionado. Habilita só quando há período válido no
            filtro; pede confirmação antes para evitar fechamento acidental. */}
        <button
          type="button"
          disabled={!periodToClose || closeMutation.isPending || isClosedEffective}
          onClick={() => {
            if (!periodToClose) return;
            const label = `${String(periodToClose.month).padStart(2, '0')}/${periodToClose.year}`;
            const ok = window.confirm(
              `Fechar definitivamente o mês ${label}?\n\nApós o fechamento, atualizações/exclusões em pedidos desse mês e novas emissões de NF-e nesse período serão BLOQUEADAS (HTTP 403 PERIODO_FECHADO).`,
            );
            if (!ok) return;
            closeMutation.mutate(periodToClose);
          }}
          data-testid="button-icms-close-period"
          title={
            periodToClose
              ? `Fechar mês ${String(periodToClose.month).padStart(2, '0')}/${periodToClose.year}`
              : 'Selecione uma data inicial ou final para escolher o mês'
          }
          className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-red-300 text-red-700 bg-red-50 hover:bg-red-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-red-50"
        >
          <Lock className="w-3.5 h-3.5" />
          {closeMutation.isPending
            ? 'Fechando...'
            : periodToClose
              ? `Fechar mês ${String(periodToClose.month).padStart(2, '0')}/${periodToClose.year}`
              : 'Fechar mês'}
        </button>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground p-4">Calculando resumo de ICMS...</div>
      ) : isError ? (
        <div className="text-sm text-red-600 p-4">
          Não foi possível carregar o resumo de ICMS no momento.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Card Importados — laranja, alinhado ao badge "Importado" do catálogo */}
          <div
            className="rounded-xl border-2 border-orange-200 bg-orange-50 p-4"
            data-testid="card-icms-importado"
          >
            <div className="flex items-center gap-2 mb-2">
              <Globe className="w-4 h-4 text-orange-700" />
              <span className="text-sm font-bold text-orange-800">
                ICMS Importados (4%)
              </span>
            </div>
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between">
                <dt className="text-orange-700/80">NF-e(s)</dt>
                <dd className="font-bold text-orange-900" data-testid="text-icms-importado-nfs">
                  {importado?.totalNFs ?? 0}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-orange-700/80">Itens</dt>
                <dd className="font-bold text-orange-900" data-testid="text-icms-importado-itens">
                  {importado?.totalItens ?? 0}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-orange-700/80">Base de cálculo</dt>
                <dd className="font-bold text-orange-900" data-testid="text-icms-importado-base">
                  {fmt(importado?.totalBase ?? 0)}
                </dd>
              </div>
              <div className="flex justify-between border-t border-orange-200 pt-1 mt-1">
                <dt className="text-orange-700">ICMS total</dt>
                <dd className="font-extrabold text-orange-900" data-testid="text-icms-importado-icms">
                  {fmt(importado?.totalICMS ?? 0)}
                </dd>
              </div>
            </dl>
          </div>

          {/* Card Normal — azul, padrão "interno" */}
          <div
            className="rounded-xl border-2 border-blue-200 bg-blue-50 p-4"
            data-testid="card-icms-normal"
          >
            <div className="flex items-center gap-2 mb-2">
              <Landmark className="w-4 h-4 text-blue-700" />
              <span className="text-sm font-bold text-blue-800">
                ICMS Normal (7/12/18%)
              </span>
            </div>
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between">
                <dt className="text-blue-700/80">NF-e(s)</dt>
                <dd className="font-bold text-blue-900" data-testid="text-icms-normal-nfs">
                  {normal?.totalNFs ?? 0}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-blue-700/80">Itens</dt>
                <dd className="font-bold text-blue-900" data-testid="text-icms-normal-itens">
                  {normal?.totalItens ?? 0}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-blue-700/80">Base de cálculo</dt>
                <dd className="font-bold text-blue-900" data-testid="text-icms-normal-base">
                  {fmt(normal?.totalBase ?? 0)}
                </dd>
              </div>
              <div className="flex justify-between border-t border-blue-200 pt-1 mt-1">
                <dt className="text-blue-700">ICMS total</dt>
                <dd className="font-extrabold text-blue-900" data-testid="text-icms-normal-icms">
                  {fmt(normal?.totalICMS ?? 0)}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      )}
    </div>
  );
}
