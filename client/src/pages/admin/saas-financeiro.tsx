import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  TrendingUp, TrendingDown, Building2, Users, ShoppingCart,
  DollarSign, RefreshCw, BarChart3, Star, Package, AlertTriangle,
  CheckCircle2, Activity,
} from 'lucide-react';

function MetricCard({
  title, value, subtitle, icon: Icon, color, trend,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: any;
  color: string;
  trend?: 'up' | 'down' | 'neutral';
}) {
  return (
    <Card className="relative overflow-hidden">
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-1">{title}</p>
            <p className="text-3xl font-bold text-foreground">{value}</p>
            {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
          </div>
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${color}`}>
            <Icon className="w-6 h-6 text-white" />
          </div>
        </div>
        {trend && (
          <div className={`flex items-center gap-1 mt-3 text-xs font-medium ${
            trend === 'up' ? 'text-green-600' : trend === 'down' ? 'text-red-500' : 'text-muted-foreground'
          }`}>
            {trend === 'up' ? <TrendingUp className="w-3 h-3" /> : trend === 'down' ? <TrendingDown className="w-3 h-3" /> : <Activity className="w-3 h-3" />}
            {trend === 'up' ? 'Crescendo' : trend === 'down' ? 'Reduzindo' : 'Estável'}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MiniBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="text-sm text-muted-foreground w-32 truncate">{label}</span>
      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-sm font-medium w-12 text-right">{value}</span>
    </div>
  );
}

export default function SaasFinanceiro() {
  const { toast } = useToast();
  const [refreshing, setRefreshing] = useState(false);

  const { data: metrics, isLoading, refetch } = useQuery<any>({
    queryKey: ['/api/saas/financeiro'],
  });

  const { data: historico } = useQuery<any[]>({
    queryKey: ['/api/saas/financeiro/historico'],
  });

  const { data: planos } = useQuery<any[]>({
    queryKey: ['/api/master/planos'],
  });

  const { data: assinaturas } = useQuery<any[]>({
    queryKey: ['/api/master/assinaturas'],
  });

  const { data: stats } = useQuery<any>({
    queryKey: ['/api/master/stats'],
  });

  const handleRefresh = async () => {
    setRefreshing(true);
    await refetch();
    queryClient.invalidateQueries({ queryKey: ['/api/saas/financeiro/historico'] });
    setRefreshing(false);
    toast({ title: 'Métricas atualizadas', description: 'Dados do painel financeiro foram recalculados.' });
  };

  const fmt = (v: string | number | undefined) => {
    const n = parseFloat(String(v ?? '0'));
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  };

  // Compute plano distribution from assinaturas
  const planoCounts = (planos ?? []).map((p: any) => ({
    nome: p.nome,
    count: (assinaturas ?? []).filter((a: any) => a.planoId === p.id).length,
  }));
  const maxCount = Math.max(1, ...planoCounts.map(p => p.count));

  // Historico chart (last 6 periods)
  const hist = (historico ?? []).slice(0, 6).reverse();

  if (isLoading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-96">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-3 text-primary" />
          <p className="text-muted-foreground">Carregando métricas financeiras...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <BarChart3 className="w-7 h-7 text-primary" />
            Painel Financeiro SaaS
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Métricas de receita e crescimento do período {metrics?.periodo ?? '--'}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={handleRefresh}
          disabled={refreshing}
          data-testid="button-refresh-metrics"
          className="gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          Atualizar
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="MRR (Receita Mensal)"
          value={fmt(metrics?.faturamentoMensal)}
          subtitle="Receita recorrente do mês"
          icon={DollarSign}
          color="bg-green-500"
          trend="up"
        />
        <MetricCard
          title="ARR (Receita Anual)"
          value={fmt(metrics?.faturamentoAnual)}
          subtitle="Projeção anual (MRR × 12)"
          icon={TrendingUp}
          color="bg-blue-500"
          trend="up"
        />
        <MetricCard
          title="Empresas Ativas"
          value={metrics?.empresasAtivas ?? 0}
          subtitle={`${metrics?.empresasTrial ?? 0} em trial`}
          icon={Building2}
          color="bg-purple-500"
          trend="neutral"
        />
        <MetricCard
          title="Assinaturas Ativas"
          value={metrics?.assinaturasAtivas ?? 0}
          subtitle={`${metrics?.planosAtivos ?? 0} planos ativos`}
          icon={Star}
          color="bg-orange-500"
          trend="neutral"
        />
      </div>

      {/* Secondary KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-11 h-11 rounded-xl bg-indigo-100 flex items-center justify-center">
              <Users className="w-6 h-6 text-indigo-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{metrics?.totalUsuarios ?? 0}</p>
              <p className="text-xs text-muted-foreground">Usuários ativos</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-11 h-11 rounded-xl bg-teal-100 flex items-center justify-center">
              <ShoppingCart className="w-6 h-6 text-teal-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{metrics?.totalPedidos ?? 0}</p>
              <p className="text-xs text-muted-foreground">Pedidos no sistema</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-11 h-11 rounded-xl bg-rose-100 flex items-center justify-center">
              <AlertTriangle className="w-6 h-6 text-rose-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats?.assinaturasInadimplentes ?? 0}</p>
              <p className="text-xs text-muted-foreground">Inadimplentes</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Planos Distribution */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Package className="w-4 h-4 text-primary" />
              Empresas por Plano
            </CardTitle>
          </CardHeader>
          <CardContent>
            {planoCounts.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">Nenhum plano cadastrado</p>
            ) : (
              <div className="space-y-1">
                {planoCounts.map((p, i) => (
                  <MiniBar
                    key={i}
                    label={p.nome}
                    value={p.count}
                    max={maxCount}
                    color={['bg-blue-500','bg-green-500','bg-purple-500','bg-orange-500'][i % 4]}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Status Assinaturas */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" />
              Status das Assinaturas
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(assinaturas ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">Nenhuma assinatura cadastrada</p>
            ) : (
              <div className="space-y-3">
                {(['ativa','trial','inadimplente','cancelada','suspensa'] as const).map(status => {
                  const count = (assinaturas ?? []).filter((a: any) => a.status === status).length;
                  if (count === 0) return null;
                  const cfg: Record<string, { label: string; color: string; icon: any }> = {
                    ativa: { label: 'Ativas', color: 'text-green-600 bg-green-50 border-green-200', icon: CheckCircle2 },
                    trial: { label: 'Trial', color: 'text-blue-600 bg-blue-50 border-blue-200', icon: Star },
                    inadimplente: { label: 'Inadimplentes', color: 'text-red-600 bg-red-50 border-red-200', icon: AlertTriangle },
                    cancelada: { label: 'Canceladas', color: 'text-gray-600 bg-gray-50 border-gray-200', icon: AlertTriangle },
                    suspensa: { label: 'Suspensas', color: 'text-yellow-600 bg-yellow-50 border-yellow-200', icon: AlertTriangle },
                  };
                  const c = cfg[status];
                  return (
                    <div key={status} className={`flex items-center justify-between p-3 rounded-lg border ${c.color}`}>
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <c.icon className="w-4 h-4" />
                        {c.label}
                      </div>
                      <span className="text-lg font-bold">{count}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Histórico MRR */}
      {hist.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" />
              Histórico de Receita (MRR)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-3 h-32">
              {hist.map((h: any, i: number) => {
                const val = parseFloat(h.faturamentoMensal ?? '0');
                const maxVal = Math.max(1, ...hist.map((x: any) => parseFloat(x.faturamentoMensal ?? '0')));
                const pct = Math.round((val / maxVal) * 100);
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-xs text-muted-foreground">{fmt(h.faturamentoMensal)}</span>
                    <div className="w-full flex items-end justify-center">
                      <div
                        className="w-full bg-primary/20 rounded-t transition-all hover:bg-primary/40"
                        style={{ height: `${Math.max(8, pct)}px`, maxHeight: '80px' }}
                        title={h.periodo}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground truncate">{h.periodo}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabela de Assinaturas */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Star className="w-4 h-4 text-primary" />
            Assinaturas ({(assinaturas ?? []).length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {(assinaturas ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">Nenhuma assinatura cadastrada</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50">
                    <th className="text-left py-2 pr-4 text-muted-foreground font-medium">Empresa ID</th>
                    <th className="text-left py-2 pr-4 text-muted-foreground font-medium">Plano</th>
                    <th className="text-left py-2 pr-4 text-muted-foreground font-medium">Status</th>
                    <th className="text-right py-2 text-muted-foreground font-medium">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {(assinaturas ?? []).map((a: any) => {
                    const plano = (planos ?? []).find((p: any) => p.id === a.planoId);
                    return (
                      <tr key={a.id} className="border-b border-border/30 hover:bg-muted/30 transition-colors">
                        <td className="py-2 pr-4 font-mono text-xs"># {a.empresaId}</td>
                        <td className="py-2 pr-4">{plano?.nome ?? `Plano #${a.planoId}`}</td>
                        <td className="py-2 pr-4">
                          <Badge className={`text-xs border ${
                            a.status === 'ativa' ? 'bg-green-100 text-green-800 border-green-200' :
                            a.status === 'trial' ? 'bg-blue-100 text-blue-800 border-blue-200' :
                            'bg-red-100 text-red-800 border-red-200'
                          }`}>{a.status}</Badge>
                        </td>
                        <td className="py-2 text-right font-medium">{a.valor ? fmt(a.valor) : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
