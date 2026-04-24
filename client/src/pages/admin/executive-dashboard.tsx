import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Layout } from '@/components/Layout';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, Legend
} from 'recharts';
import { TrendingUp, ShoppingCart, Building2, Package, AlertTriangle, Download, Users, Clock } from 'lucide-react';

const PERIOD_LABELS: Record<string, string> = { day: 'Hoje', week: 'Esta Semana', month: 'Este Mês', year: 'Este Ano' };
const COLORS = ['#16a34a', '#f97316', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f59e0b', '#ef4444', '#6366f1', '#84cc16'];

function fmtBRL(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function exportToCSV(data: any[], filename: string) {
  if (!data.length) return;
  const headers = Object.keys(data[0]);
  const csv = [headers.join(';'), ...data.map(r => headers.map(h => `"${r[h] ?? ''}"`).join(';'))].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
}

export default function ExecutiveDashboard() {
  const [period, setPeriod] = useState('month');

  const { data, isLoading, refetch } = useQuery<any>({
    queryKey: ['/api/executive-dashboard', period],
    queryFn: async () => {
      const res = await fetch(`/api/executive-dashboard?period=${period}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Erro ao carregar dashboard');
      return res.json();
    },
    staleTime: 60000,
  });

  if (isLoading) {
    return (
      <Layout>
        <div className="space-y-4 animate-pulse">
          <div className="h-8 w-64 bg-muted rounded-xl" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[1,2,3,4].map(i => <div key={i} className="h-24 bg-muted rounded-2xl" />)}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[1,2].map(i => <div key={i} className="h-64 bg-muted rounded-2xl" />)}
          </div>
        </div>
      </Layout>
    );
  }

  const kpis = data?.kpis || {};
  const alerts = data?.alerts || [];
  const topCompanies = data?.topCompanies || [];
  const topProducts = data?.topProducts || [];
  const ordByDay = (data?.ordByDay || []).filter((d: any) => d.day !== 'Domingo' && d.day !== 'Sábado');
  const inactiveCompanies = data?.inactiveCompanies || [];
  const forecast = data?.forecast || [];
  const revenueTimeline = data?.revenueTimeline || [];

  const handleExport = () => {
    exportToCSV(
      topCompanies.map((c: any) => ({ Empresa: c.companyName, 'Valor Total': c.total.toFixed(2), Pedidos: c.count, 'Ticket Médio': (c.total/c.count).toFixed(2) })),
      `dashboard-${period}.csv`
    );
  };

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Dashboard Executivo</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Visão completa de vendas, clientes e previsões</p>
          </div>
          <div className="flex gap-2">
            <Select value={period} onValueChange={v => { setPeriod(v); }}>
              <SelectTrigger className="w-36" data-testid="select-period">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(PERIOD_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={handleExport} data-testid="button-export-dashboard">
              <Download className="w-4 h-4 mr-1" /> Exportar
            </Button>
          </div>
        </div>

        {/* Alerts */}
        {alerts.length > 0 && (
          <div className="space-y-2">
            {alerts.map((a: any, i: number) => (
              <div key={i} className={`flex items-center gap-2 p-3 rounded-xl text-sm font-medium ${a.type === 'WARN' ? 'bg-orange-50 border border-orange-200 text-orange-800' : 'bg-blue-50 border border-blue-200 text-blue-800'}`}>
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                {a.message}
              </div>
            ))}
          </div>
        )}

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Faturamento Hoje', value: fmtBRL(kpis.revenueDay || 0), icon: TrendingUp, color: 'text-green-600', bg: 'bg-green-50' },
            { label: 'Faturamento Semana', value: fmtBRL(kpis.revenueWeek || 0), icon: TrendingUp, color: 'text-blue-600', bg: 'bg-blue-50' },
            { label: 'Faturamento Mês', value: fmtBRL(kpis.revenueMonth || 0), icon: TrendingUp, color: 'text-purple-600', bg: 'bg-purple-50' },
            { label: 'Ticket Médio (Mês)', value: fmtBRL(kpis.avgTicketMonth || 0), icon: ShoppingCart, color: 'text-orange-600', bg: 'bg-orange-50' },
          ].map(({ label, value, icon: Icon, color, bg }) => (
            <Card key={label} className="premium-shadow" data-testid={`kpi-${label.replace(/\s/g,'-').toLowerCase()}`}>
              <CardContent className="p-4 flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl ${bg} flex items-center justify-center`}>
                  <Icon className={`w-5 h-5 ${color}`} />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="text-base font-bold">{value}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Orders KPIs */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Pedidos Hoje', value: kpis.ordersDay || 0 },
            { label: 'Pedidos Semana', value: kpis.ordersWeek || 0 },
            { label: 'Pedidos Mês', value: kpis.ordersMonth || 0 },
          ].map(({ label, value }) => (
            <Card key={label} className="premium-shadow">
              <CardContent className="p-4 text-center">
                <p className="text-3xl font-bold text-primary">{value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Charts Row 1: Revenue Timeline + Orders by Day */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="premium-shadow">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Faturamento — Últimos 30 dias</CardTitle></CardHeader>
            <CardContent>
              {revenueTimeline.length === 0 ? (
                <div className="h-40 flex items-center justify-center text-muted-foreground text-sm">Sem dados</div>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={revenueTimeline}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={v => v.slice(5)} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `R$${(v/1000).toFixed(0)}k`} />
                    <Tooltip formatter={(v: any) => fmtBRL(v)} labelFormatter={l => `Data: ${l}`} />
                    <Line type="monotone" dataKey="revenue" stroke="#16a34a" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card className="premium-shadow">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Pedidos por Dia da Semana (últimos 90 dias)</CardTitle></CardHeader>
            <CardContent>
              {ordByDay.length === 0 ? (
                <div className="h-40 flex items-center justify-center text-muted-foreground text-sm">Sem dados</div>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={ordByDay}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip />
                    <Bar dataKey="count" name="Pedidos" fill="#f97316" radius={[4,4,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Charts Row 2: Top Companies + Top Products */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="premium-shadow">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold flex items-center gap-2"><Building2 className="w-4 h-4 text-primary" /> Top Empresas — {PERIOD_LABELS[period]}</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {topCompanies.length === 0 ? (
                <div className="h-40 flex items-center justify-center text-muted-foreground text-sm">Sem dados</div>
              ) : (
                <div className="space-y-2">
                  {topCompanies.slice(0, 8).map((c: any, i: number) => (
                    <div key={c.companyId} className="flex items-center gap-2" data-testid={`top-company-${i}`}>
                      <span className="w-5 text-xs text-muted-foreground font-bold">{i+1}</span>
                      <div className="flex-1">
                        <div className="flex justify-between mb-0.5">
                          <span className="text-xs font-medium truncate max-w-[160px]">{c.companyName}</span>
                          <span className="text-xs font-bold text-primary">{fmtBRL(c.total)}</span>
                        </div>
                        <div className="w-full bg-muted rounded-full h-1.5">
                          <div className="h-1.5 rounded-full" style={{ width: `${(c.total / topCompanies[0].total * 100).toFixed(0)}%`, backgroundColor: COLORS[i % COLORS.length] }} />
                        </div>
                      </div>
                      <span className="text-xs text-muted-foreground w-12 text-right">{c.count} ped.</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="premium-shadow">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold flex items-center gap-2"><Package className="w-4 h-4 text-primary" /> Produtos Mais Vendidos — {PERIOD_LABELS[period]}</CardTitle></CardHeader>
            <CardContent>
              {topProducts.length === 0 ? (
                <div className="h-40 flex items-center justify-center text-muted-foreground text-sm">Sem dados</div>
              ) : (
                <div className="space-y-2">
                  {topProducts.slice(0, 8).map((p: any, i: number) => (
                    <div key={p.productId} className="flex items-center gap-2" data-testid={`top-product-${i}`}>
                      <span className="w-5 text-xs text-muted-foreground font-bold">{i+1}</span>
                      <div className="flex-1">
                        <div className="flex justify-between mb-0.5">
                          <span className="text-xs font-medium truncate max-w-[160px]">{p.productName}</span>
                          <span className="text-xs font-bold text-orange-600">{fmtBRL(p.total)}</span>
                        </div>
                        <div className="w-full bg-muted rounded-full h-1.5">
                          <div className="h-1.5 rounded-full bg-orange-400" style={{ width: `${(p.qty / topProducts[0].qty * 100).toFixed(0)}%` }} />
                        </div>
                      </div>
                      <span className="text-xs text-muted-foreground w-14 text-right">{p.qty} un.</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Row 3: Inactive Clients + Forecast */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="premium-shadow">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Clock className="w-4 h-4 text-red-500" /> Clientes Sem Pedido
                {inactiveCompanies.filter((c: any) => c.daysSince >= 10).length > 0 && (
                  <span className="ml-auto text-xs font-bold px-2 py-0.5 bg-red-100 text-red-700 rounded-full">
                    {inactiveCompanies.filter((c: any) => c.daysSince >= 10).length} críticos
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {inactiveCompanies.length === 0 ? (
                <div className="text-center py-6 text-green-600 font-medium text-sm">Todas as empresas compraram recentemente!</div>
              ) : (
                <div className="space-y-1.5 max-h-56 overflow-y-auto">
                  {inactiveCompanies.map((c: any) => (
                    <div key={c.id} className={`flex items-center justify-between p-2 rounded-lg text-xs ${c.daysSince >= 10 ? 'bg-red-50 border border-red-100' : 'bg-orange-50 border border-orange-100'}`} data-testid={`inactive-company-${c.id}`}>
                      <span className="font-medium truncate max-w-[180px]">{c.name}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-muted-foreground">{c.lastOrder ? new Date(c.lastOrder).toLocaleDateString('pt-BR') : 'Nunca'}</span>
                        <span className={`font-bold px-1.5 py-0.5 rounded ${c.daysSince >= 10 ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}`}>
                          {c.daysSince >= 9999 ? '∞' : c.daysSince}d
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="premium-shadow">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold flex items-center gap-2"><Package className="w-4 h-4 text-blue-500" /> Previsão de Compra de Frutas</CardTitle></CardHeader>
            <CardContent>
              {forecast.length === 0 ? (
                <div className="text-center py-6 text-muted-foreground text-sm">Sem histórico para calcular previsão</div>
              ) : (
                <div className="space-y-0 max-h-56 overflow-y-auto">
                  <div className="grid grid-cols-4 text-xs text-muted-foreground font-medium pb-1.5 border-b mb-1.5 sticky top-0 bg-card">
                    <span>Produto</span><span className="text-center">Méd. Sem.</span><span className="text-center">Méd. Mês</span><span className="text-center">Sugestão</span>
                  </div>
                  {forecast.map((f: any) => (
                    <div key={f.productId} className="grid grid-cols-4 text-xs py-1 border-b border-muted/30">
                      <span className="font-medium truncate">{f.productName}</span>
                      <span className="text-center text-muted-foreground">{f.avgWeekly}</span>
                      <span className="text-center text-muted-foreground">{f.avgMonthly}</span>
                      <span className="text-center font-bold text-blue-700">{f.suggestion}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </Layout>
  );
}
