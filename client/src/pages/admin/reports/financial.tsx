import { useState, useMemo } from "react";
import { useFinancialReport } from "@/hooks/use-ordering";
import { Layout } from "@/components/Layout";
import { PieChart, TrendingUp, Award, FileDown, Calendar, Filter } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

type DateFilter = 'today' | 'week' | 'month' | 'custom';

function getFilterDates(filter: DateFilter, customFrom: string, customTo: string): { from: Date; to: Date } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (filter === 'today') {
    return { from: today, to: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59) };
  } else if (filter === 'week') {
    const day = today.getDay();
    const mon = new Date(today); mon.setDate(today.getDate() - (day === 0 ? 6 : day - 1));
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    return { from: mon, to: sun };
  } else if (filter === 'month') {
    return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59) };
  } else {
    return {
      from: customFrom ? new Date(customFrom) : new Date(0),
      to: customTo ? new Date(customTo + 'T23:59:59') : new Date(8640000000000000),
    };
  }
}

function fmtBRL(n: number) {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const FILTER_LABELS: Record<DateFilter, string> = {
  today: 'Hoje',
  week: 'Esta Semana',
  month: 'Este Mês',
  custom: 'Período Personalizado',
};

export default function FinancialReportPage() {
  const { data: report, isLoading } = useFinancialReport();
  const { data: orders } = useQuery<any[]>({ queryKey: ['/api/orders'] });
  const [dateFilter, setDateFilter] = useState<DateFilter>('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [nimbiExpFilter, setNimbiExpFilter] = useState('');

  const { from, to } = getFilterDates(dateFilter, customFrom, customTo);

  const filteredOrders = useMemo(() => {
    if (!orders) return [];
    return orders.filter((o: any) => {
      const d = new Date(o.deliveryDate);
      const inRange = d >= from && d <= to;
      if (!inRange) return false;
      if (nimbiExpFilter && o.nimbiExpiration) {
        const exp = new Date(o.nimbiExpiration);
        const filterDate = new Date(nimbiExpFilter);
        if (exp > filterDate) return false;
      }
      return true;
    });
  }, [orders, from, to, nimbiExpFilter]);

  const exportCSV = (format: 'nf' | 'nimbi') => {
    if (!filteredOrders || filteredOrders.length === 0) return;
    const statusFmt = (s: string) => {
      const m: Record<string, string> = { ACTIVE: 'Ativo', CONFIRMED: 'Confirmado', DELIVERED: 'Entregue', CANCELLED: 'Cancelado' };
      return m[s] || s;
    };

    let csv = "";
    if (format === 'nf') {
      csv = "Código VF;Empresa;CNPJ;Endereço;Valor Total;Status;Data de Entrega;Tipo Faturamento;Prazo Pagamento;Expiração Bling\n";
      filteredOrders.forEach((o: any) => {
        const total = (o.items || []).reduce((s: number, i: any) => s + (parseFloat(i.finalPrice || 0) * (i.quantity || 0)), 0);
        const addr = [o.addressStreet, o.addressNumber, o.addressNeighborhood, o.addressCity].filter(Boolean).join(', ');
        csv += `${o.vfCode || ''};${o.companyName || ''};${o.cnpj || ''};${addr};${total.toFixed(2)};${statusFmt(o.status)};${o.deliveryDate?.slice(0,10) || ''};${o.billingType || ''};${o.billingTerm || ''};${o.nimbiExpiration || ''}\n`;
      });
    } else {
      csv = "Empresa;CNPJ;Produto;Descrição;Quantidade;Unidade;Valor Unitário;Valor Total;Observação do Cliente;Tipo Faturamento;Prazo Pagamento;Expiração Bling\n";
      filteredOrders.forEach((o: any) => {
        (o.items || []).forEach((item: any) => {
          const unitPrice = parseFloat(item.finalPrice || 0);
          const total = unitPrice * (item.quantity || 0);
          const obs = (o.orderNote || '').replace(/;/g, ',');
          csv += `${o.companyName || ''};${o.cnpj || ''};${item.productName || ''};${item.productObservation || ''};${item.quantity};${item.unit || ''};${unitPrice.toFixed(2)};${total.toFixed(2)};${obs};${o.billingType || ''};${o.billingTerm || ''};${o.nimbiExpiration || ''}\n`;
        });
      });
    }

    const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const period = `${from.toISOString().slice(0,10)}_a_${to.toISOString().slice(0,10)}`;
    a.download = `vivafrutaz_${format === 'nf' ? 'NF' : 'Bling'}_${period}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totalFiltered = filteredOrders.reduce((sum: number, o: any) => {
    return sum + (o.items || []).reduce((s: number, i: any) => s + (parseFloat(i.finalPrice || 0) * (i.quantity || 0)), 0);
  }, 0);

  return (
    <Layout>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Painel Financeiro</h1>
          <p className="text-muted-foreground mt-1">Métricas de receita e exportação de faturamento.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button data-testid="button-export-nf" onClick={() => exportCSV('nf')}
            className="flex items-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground font-bold rounded-xl text-sm hover:-translate-y-0.5 transition-transform shadow-lg shadow-primary/20">
            <FileDown className="w-4 h-4" /> Exportar NF
          </button>
          <button data-testid="button-export-bling" onClick={() => exportCSV('nimbi')}
            className="flex items-center gap-2 px-4 py-2.5 bg-secondary text-secondary-foreground font-bold rounded-xl text-sm hover:-translate-y-0.5 transition-transform shadow-lg shadow-secondary/20">
            <FileDown className="w-4 h-4" /> Exportar Bling
          </button>
        </div>
      </div>

      {/* Date filters */}
      <div className="bg-card rounded-2xl border border-border/50 premium-shadow p-5 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Filter className="w-4 h-4 text-primary" />
          <h2 className="font-bold text-foreground">Filtro de Período</h2>
        </div>
        <div className="flex flex-wrap gap-2 mb-4">
          {(Object.keys(FILTER_LABELS) as DateFilter[]).map(f => (
            <button key={f} onClick={() => setDateFilter(f)} data-testid={`filter-${f}`}
              className={`px-4 py-2 rounded-xl font-bold text-sm border-2 transition-all ${dateFilter === f ? 'bg-primary text-white border-primary' : 'border-border hover:border-primary/50'}`}>
              {FILTER_LABELS[f]}
            </button>
          ))}
        </div>
        {dateFilter === 'custom' && (
          <div className="flex flex-wrap gap-4 mt-2">
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1">Data Inicial</label>
              <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
                data-testid="input-date-from"
                className="px-3 py-2 rounded-xl border-2 border-border focus:border-primary outline-none text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1">Data Final</label>
              <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
                data-testid="input-date-to"
                className="px-3 py-2 rounded-xl border-2 border-border focus:border-primary outline-none text-sm" />
            </div>
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-4 items-center">
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1">Expiração Bling (mostrar até)</label>
            <input type="date" value={nimbiExpFilter} onChange={e => setNimbiExpFilter(e.target.value)}
              data-testid="input-bling-exp-filter"
              className="px-3 py-2 rounded-xl border-2 border-border focus:border-primary outline-none text-sm" />
          </div>
          <div className="ml-auto text-right">
            <p className="text-xs text-muted-foreground">Pedidos no período</p>
            <p className="text-2xl font-display font-bold text-primary">{filteredOrders.length}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Total do período</p>
            <p className="text-2xl font-display font-bold text-foreground">R$ {fmtBRL(totalFiltered)}</p>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center p-8 text-muted-foreground font-medium">Carregando dados financeiros...</div>
      ) : (
        <div className="space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-card rounded-2xl p-8 border border-border/50 premium-shadow flex items-center gap-6">
              <div className="w-16 h-16 rounded-2xl bg-green-500/10 text-green-600 flex items-center justify-center">
                <TrendingUp className="w-8 h-8" />
              </div>
              <div>
                <p className="text-sm font-bold text-muted-foreground uppercase tracking-widest">Receita Semanal</p>
                <p className="text-4xl font-display font-bold text-foreground mt-1">
                  R$ {report?.weeklyRevenue?.toFixed(2).replace('.', ',') || '0,00'}
                </p>
              </div>
            </div>
            <div className="bg-card rounded-2xl p-8 border border-border/50 premium-shadow flex items-center gap-6">
              <div className="w-16 h-16 rounded-2xl bg-blue-500/10 text-blue-600 flex items-center justify-center">
                <TrendingUp className="w-8 h-8" />
              </div>
              <div>
                <p className="text-sm font-bold text-muted-foreground uppercase tracking-widest">Receita Mensal</p>
                <p className="text-4xl font-display font-bold text-foreground mt-1">
                  R$ {report?.monthlyRevenue?.toFixed(2).replace('.', ',') || '0,00'}
                </p>
              </div>
            </div>
          </div>

          {/* Pedidos filtrados */}
          <div className="bg-card rounded-2xl border border-border/50 premium-shadow overflow-hidden">
            <div className="p-5 border-b border-border/50 bg-muted/20 flex items-center gap-3">
              <Calendar className="w-5 h-5 text-primary" />
              <h3 className="font-bold text-foreground">Pedidos do Período — {FILTER_LABELS[dateFilter]}</h3>
              <span className="ml-auto text-sm text-muted-foreground">{filteredOrders.length} pedido(s)</span>
            </div>
            {filteredOrders.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">Nenhum pedido no período selecionado.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/50 bg-muted/10 text-muted-foreground text-xs uppercase tracking-wider">
                      <th className="p-4 text-left font-semibold">Código</th>
                      <th className="p-4 text-left font-semibold">Empresa</th>
                      <th className="p-4 text-left font-semibold">CNPJ</th>
                      <th className="p-4 text-left font-semibold">Entrega</th>
                      <th className="p-4 text-left font-semibold">Tipo Fat.</th>
                      <th className="p-4 text-left font-semibold">Prazo</th>
                      <th className="p-4 text-left font-semibold">Exp. Bling</th>
                      <th className="p-4 text-right font-semibold">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/30">
                    {filteredOrders.map((o: any) => {
                      const total = (o.items || []).reduce((s: number, i: any) => s + (parseFloat(i.finalPrice || 0) * (i.quantity || 0)), 0);
                      const isExpiring = o.nimbiExpiration && new Date(o.nimbiExpiration) <= new Date();
                      return (
                        <tr key={o.id} className="hover:bg-muted/10 transition-colors">
                          <td className="p-4 font-mono text-xs font-bold text-primary">{o.vfCode || `#${o.id}`}</td>
                          <td className="p-4 font-medium text-foreground">{o.companyName}</td>
                          <td className="p-4 text-xs text-muted-foreground">{o.cnpj || '—'}</td>
                          <td className="p-4 text-xs text-muted-foreground">{o.deliveryDate?.slice(0,10) || '—'}</td>
                          <td className="p-4 text-xs">{o.billingType || '—'}</td>
                          <td className="p-4 text-xs">{o.billingTerm || '—'}</td>
                          <td className="p-4">
                            {o.nimbiExpiration ? (
                              <span className={`px-2 py-1 rounded-full text-xs font-bold ${isExpiring ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}`}>
                                {o.nimbiExpiration}
                              </span>
                            ) : <span className="text-xs text-muted-foreground">—</span>}
                          </td>
                          <td className="p-4 text-right font-bold text-foreground">R$ {fmtBRL(total)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="bg-card rounded-2xl border border-border/50 premium-shadow overflow-hidden">
              <div className="p-6 border-b border-border/50 bg-muted/20 flex items-center gap-3">
                <Award className="w-5 h-5 text-secondary" />
                <h3 className="text-lg font-bold text-foreground">Maiores Clientes</h3>
              </div>
              <ul className="divide-y divide-border/50">
                {report?.topCompanies?.map((c: any, i: number) => (
                  <li key={i} className="p-4 flex items-center justify-between hover:bg-muted/10 transition-colors">
                    <span className="font-bold text-foreground flex items-center gap-3">
                      <span className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-xs">{i+1}</span>
                      {c.companyName}
                    </span>
                    <span className="font-bold text-primary">R$ {c.totalSpent.toFixed(2).replace('.', ',')}</span>
                  </li>
                ))}
                {(!report?.topCompanies || report.topCompanies.length === 0) && (
                  <li className="p-8 text-center text-muted-foreground">Sem dados suficientes</li>
                )}
              </ul>
            </div>

            <div className="bg-card rounded-2xl border border-border/50 premium-shadow overflow-hidden">
              <div className="p-6 border-b border-border/50 bg-muted/20 flex items-center gap-3">
                <PieChart className="w-5 h-5 text-secondary" />
                <h3 className="text-lg font-bold text-foreground">Frutas Mais Vendidas</h3>
              </div>
              <ul className="divide-y divide-border/50">
                {report?.topSellingFruits?.map((f: any, i: number) => (
                  <li key={i} className="p-4 flex items-center justify-between hover:bg-muted/10 transition-colors">
                    <span className="font-bold text-foreground flex items-center gap-3">
                      <span className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-xs">{i+1}</span>
                      {f.productName}
                    </span>
                    <span className="font-bold text-primary">{f.totalSold} un</span>
                  </li>
                ))}
                {(!report?.topSellingFruits || report.topSellingFruits.length === 0) && (
                  <li className="p-8 text-center text-muted-foreground">Sem dados suficientes</li>
                )}
              </ul>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
