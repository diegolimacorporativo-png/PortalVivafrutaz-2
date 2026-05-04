import { useQuery } from '@tanstack/react-query';
import { normalizeBIResponse } from '@/lib/biNormalizer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TrendingUp, TrendingDown, DollarSign, RefreshCw, Trophy, BarChart3, AlertTriangle } from 'lucide-react';

interface MonthlyRevenue {
  month: string;
  revenue: number;
}

interface TopClient {
  companyId: number;
  companyName: string;
  total: number;
  orderCount: number;
  avgOrder: number;
}

interface FinancialData {
  thisMonthRevenue: number;
  lastMonthRevenue: number;
  monthGrowth: number;
  forecastRevenue: number;
  avgLast3Months: number;
  revenueAlert: boolean;
  topClients: TopClient[];
  monthlyRevenue: MonthlyRevenue[];
  thisMonthOrderCount: number;
  generatedAt: string;
}

function formatCurrency(v: number) {
  return `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
}

export default function AdminFinancialIntelligence() {
  const { data, isLoading, refetch, isFetching } = useQuery<FinancialData>({
    queryKey: ['/api/financial-intelligence'],
    refetchInterval: 5 * 60 * 1000,
  });

  const norm = normalizeBIResponse(data);
  const maxRevenue = norm.monthlyRevenue.length > 0 ? Math.max(...norm.monthlyRevenue.map((m: any) => m.revenue), 1) : 1;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
            <DollarSign className="w-5 h-5 text-green-600 dark:text-green-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Inteligência Financeira</h1>
            <p className="text-sm text-muted-foreground">Análise de faturamento, previsões e ranking de clientes</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {data?.generatedAt && (
            <span className="text-xs text-muted-foreground">
              Atualizado às {new Date(data.generatedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} data-testid="button-refresh-financial" className="gap-2">
            <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-20 text-muted-foreground">
          <RefreshCw className="w-8 h-8 mx-auto mb-3 animate-spin opacity-40" />
          <p>Calculando inteligência financeira...</p>
        </div>
      ) : data ? (
        <>
          {/* Revenue Alert */}
          {data.revenueAlert && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl p-4 flex gap-3">
              <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0" />
              <div>
                <p className="font-semibold text-red-800 dark:text-red-400">Alerta de Faturamento</p>
                <p className="text-sm text-red-700 dark:text-red-500 mt-0.5">
                  Faturamento do mês atual está abaixo de 80% da média dos últimos 3 meses ({formatCurrency(data.avgLast3Months)}).
                </p>
              </div>
            </div>
          )}

          {/* KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-card border rounded-2xl p-4 space-y-1" data-testid="card-month-revenue">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Mês Atual</p>
              <p className="text-xl font-bold text-foreground">{formatCurrency(data.thisMonthRevenue)}</p>
              <p className="text-xs text-muted-foreground">{data.thisMonthOrderCount} pedido(s)</p>
            </div>
            <div className="bg-card border rounded-2xl p-4 space-y-1" data-testid="card-last-month-revenue">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Mês Anterior</p>
              <p className="text-xl font-bold text-foreground">{formatCurrency(data.lastMonthRevenue)}</p>
              <div className={`flex items-center gap-1 text-xs ${data.monthGrowth >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                {data.monthGrowth >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                {data.monthGrowth > 0 ? '+' : ''}{data.monthGrowth.toFixed(1)}% vs mês anterior
              </div>
            </div>
            <div className="bg-card border rounded-2xl p-4 space-y-1" data-testid="card-forecast-revenue">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Previsão do Mês</p>
              <p className="text-xl font-bold text-primary">{formatCurrency(data.forecastRevenue)}</p>
              <p className="text-xs text-muted-foreground">Baseado no histórico</p>
            </div>
            <div className="bg-card border rounded-2xl p-4 space-y-1" data-testid="card-avg-revenue">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Média 3 Meses</p>
              <p className="text-xl font-bold text-foreground">{formatCurrency(data.avgLast3Months)}</p>
              <p className="text-xs text-muted-foreground">Referência histórica</p>
            </div>
          </div>

          {/* Monthly Revenue Chart (Bar) */}
          <section className="bg-card border rounded-2xl p-5 space-y-4">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-primary" />
              <h2 className="font-bold text-foreground">Faturamento Mensal (últimos 6 meses)</h2>
            </div>
            <div className="flex items-end gap-3 h-36">
              {norm.monthlyRevenue.map((m: any, i: number) => {
                const heightPct = maxRevenue > 0 ? Math.max((m.revenue / maxRevenue) * 100, 2) : 2;
                const isCurrentMonth = i === norm.monthlyRevenue.length - 1;
                return (
                  <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-xs text-muted-foreground font-mono">
                      {m.revenue > 0 ? `R$${(m.revenue / 1000).toFixed(1)}k` : '—'}
                    </span>
                    <div
                      className={`w-full rounded-t-lg transition-all ${isCurrentMonth ? 'bg-primary' : 'bg-primary/30'}`}
                      style={{ height: `${heightPct}%` }}
                      data-testid={`bar-month-${i}`}
                    />
                    <span className="text-xs text-muted-foreground">{m.month}</span>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Top Clients */}
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <Trophy className="w-5 h-5 text-yellow-500" />
              <h2 className="text-lg font-bold text-foreground">Clientes Mais Rentáveis</h2>
            </div>
            <div className="bg-card border rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">#</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Empresa</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Total</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden sm:table-cell">Pedidos</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden sm:table-cell">Ticket Médio</th>
                  </tr>
                </thead>
                <tbody>
                  {norm.topClients.map((c: any, i: number) => (
                    <tr key={c.companyId} data-testid={`row-client-${c.companyId}`} className="border-t border-border/50 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3">
                        <span className={`font-bold text-sm ${i === 0 ? 'text-yellow-500' : i === 1 ? 'text-gray-400' : i === 2 ? 'text-orange-400' : 'text-muted-foreground'}`}>
                          {i + 1}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-medium text-foreground">{c.companyName}</td>
                      <td className="px-4 py-3 text-right font-semibold text-primary">{formatCurrency(c.total)}</td>
                      <td className="px-4 py-3 text-right text-muted-foreground hidden sm:table-cell">{c.orderCount}</td>
                      <td className="px-4 py-3 text-right text-muted-foreground hidden sm:table-cell">{formatCurrency(c.avgOrder)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Clara tip */}
          <div className="bg-primary/5 border border-primary/20 rounded-2xl p-4 flex gap-3">
            <DollarSign className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
            <div className="text-sm text-foreground/80">
              <strong>Clara IA:</strong> Pergunte — "Clara, prever faturamento", "Clara, ranking de clientes" ou "Clara, análise de faturamento" para insights financeiros instantâneos.
            </div>
          </div>
        </>
      ) : (
        <div className="text-center py-12 text-muted-foreground">Não foi possível carregar os dados financeiros.</div>
      )}
    </div>
  );
}

