import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Link } from 'wouter';
import { AlertTriangle, TrendingDown, ShoppingBag, Users, Lightbulb, RefreshCw, ArrowRight, Clock } from 'lucide-react';

interface ClientRisk {
  companyId: number;
  companyName: string;
  daysSinceLastOrder: number;
  lastOrderDate: string;
  avgOrderValue: number;
  totalOrders: number;
  riskLevel: 'high' | 'medium' | 'low';
}

interface Opportunity {
  type: 'volume_drop' | 'dropped_product';
  companyId: number;
  companyName: string;
  dropPercent?: number;
  recentValue?: number;
  previousValue?: number;
  productName?: string;
  daysSinceProduct?: number;
  totalOrders?: number;
  description: string;
  suggestion: string;
}

interface CommercialData {
  atRisk: ClientRisk[];
  opportunities: Opportunity[];
  generatedAt: string;
}

const riskColors = {
  high: 'bg-red-100 border-red-200 text-red-800 dark:bg-red-900/20 dark:text-red-400',
  medium: 'bg-orange-100 border-orange-200 text-orange-800 dark:bg-orange-900/20 dark:text-orange-400',
  low: 'bg-yellow-100 border-yellow-200 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400',
};

const riskBadgeVariants: Record<string, 'destructive' | 'secondary' | 'default'> = {
  high: 'destructive',
  medium: 'default',
  low: 'secondary',
};

const riskLabels = { high: 'Alto Risco', medium: 'Risco Médio', low: 'Baixo Risco' };

export default function AdminCommercialIntelligence() {
  const { data, isLoading, refetch, isFetching } = useQuery<CommercialData>({
    queryKey: ['/api/commercial-intelligence'],
    refetchInterval: 5 * 60 * 1000,
  });

  const atRisk = data?.atRisk || [];
  const opportunities = data?.opportunities || [];
  const volumeDrops = opportunities.filter(o => o.type === 'volume_drop');
  const droppedProducts = opportunities.filter(o => o.type === 'dropped_product');

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center">
            <TrendingDown className="w-5 h-5 text-orange-600 dark:text-orange-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Inteligência Comercial</h1>
            <p className="text-sm text-muted-foreground">Monitoramento de comportamento de compra dos clientes</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {data?.generatedAt && (
            <span className="text-xs text-muted-foreground">
              Atualizado às {new Date(data.generatedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} data-testid="button-refresh-commercial" className="gap-2">
            <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      {!isLoading && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-card border rounded-2xl p-4 text-center">
            <p className="text-3xl font-bold text-destructive">{atRisk.filter(c => c.riskLevel === 'high').length}</p>
            <p className="text-xs text-muted-foreground mt-1">Alto Risco</p>
          </div>
          <div className="bg-card border rounded-2xl p-4 text-center">
            <p className="text-3xl font-bold text-orange-500">{atRisk.filter(c => c.riskLevel === 'medium').length}</p>
            <p className="text-xs text-muted-foreground mt-1">Risco Médio</p>
          </div>
          <div className="bg-card border rounded-2xl p-4 text-center">
            <p className="text-3xl font-bold text-yellow-500">{volumeDrops.length}</p>
            <p className="text-xs text-muted-foreground mt-1">Quedas de Volume</p>
          </div>
          <div className="bg-card border rounded-2xl p-4 text-center">
            <p className="text-3xl font-bold text-primary">{droppedProducts.length}</p>
            <p className="text-xs text-muted-foreground mt-1">Produtos Parados</p>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-20 text-muted-foreground">
          <RefreshCw className="w-8 h-8 mx-auto mb-3 animate-spin opacity-40" />
          <p>Analisando comportamento de compra...</p>
        </div>
      ) : (
        <>
          {/* Clientes em Risco */}
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-destructive" />
              <h2 className="text-lg font-bold text-foreground">Clientes em Risco</h2>
              <Badge variant="destructive" className="ml-1">{atRisk.length}</Badge>
            </div>
            <p className="text-sm text-muted-foreground -mt-2">Clientes que costumavam comprar e estão sem pedidos há 14+ dias.</p>

            {atRisk.length === 0 ? (
              <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-2xl p-6 text-center">
                <p className="text-green-700 dark:text-green-400 font-medium">✅ Nenhum cliente em risco detectado!</p>
                <p className="text-sm text-green-600/80 dark:text-green-500/80 mt-1">Todos os clientes ativos realizaram pedidos recentemente.</p>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {atRisk.map(client => (
                  <div
                    key={client.companyId}
                    data-testid={`card-risk-${client.companyId}`}
                    className={`border rounded-2xl p-4 space-y-3 ${riskColors[client.riskLevel]}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold leading-tight">{client.companyName}</p>
                        <p className="text-xs mt-0.5 opacity-80">
                          {client.totalOrders} pedido(s) histórico · Ticket médio: R$ {client.avgOrderValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </p>
                      </div>
                      <Badge variant={riskBadgeVariants[client.riskLevel]} className="text-xs flex-shrink-0">
                        {riskLabels[client.riskLevel]}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Clock className="w-3.5 h-3.5 flex-shrink-0" />
                      <span><strong>{client.daysSinceLastOrder} dias</strong> sem pedido</span>
                    </div>
                    <p className="text-xs opacity-70">
                      Último pedido: {new Date(client.lastOrderDate).toLocaleDateString('pt-BR')}
                    </p>
                    <Link href={`/admin/companies`}>
                      <Button size="sm" variant="outline" className="w-full gap-1 text-xs" data-testid={`button-view-company-${client.companyId}`}>
                        Ver empresa <ArrowRight className="w-3 h-3" />
                      </Button>
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Quedas de Volume */}
          {volumeDrops.length > 0 && (
            <section className="space-y-4">
              <div className="flex items-center gap-2">
                <TrendingDown className="w-5 h-5 text-orange-500" />
                <h2 className="text-lg font-bold text-foreground">Alerta de Queda de Pedidos</h2>
                <Badge variant="secondary" className="ml-1">{volumeDrops.length}</Badge>
              </div>
              <p className="text-sm text-muted-foreground -mt-2">Empresas com queda significativa no volume de compras em relação às semanas anteriores.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {volumeDrops.map((op, i) => (
                  <div key={i} data-testid={`card-drop-${op.companyId}-${i}`} className="bg-card border border-orange-200 dark:border-orange-800 rounded-2xl p-4 space-y-2">
                    <div className="flex items-start justify-between">
                      <p className="font-semibold text-foreground">{op.companyName}</p>
                      <Badge className="bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400 text-xs border-0">
                        -{op.dropPercent}%
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{op.description}</p>
                    <div className="flex gap-4 text-xs text-muted-foreground">
                      <span>Período anterior: <strong>R$ {op.previousValue?.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong></span>
                      <span>Recente: <strong>R$ {op.recentValue?.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong></span>
                    </div>
                    <div className="bg-orange-50 dark:bg-orange-900/20 rounded-xl p-2.5 flex items-start gap-2">
                      <Lightbulb className="w-3.5 h-3.5 text-orange-600 flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-orange-700 dark:text-orange-400">{op.suggestion}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Oportunidades Comerciais — Produtos Parados */}
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <ShoppingBag className="w-5 h-5 text-primary" />
              <h2 className="text-lg font-bold text-foreground">Oportunidades de Venda</h2>
              <Badge variant="secondary" className="ml-1">{droppedProducts.length}</Badge>
            </div>
            <p className="text-sm text-muted-foreground -mt-2">Produtos que o cliente costumava pedir mas deixou de incluir nos pedidos recentes.</p>

            {droppedProducts.length === 0 ? (
              <div className="bg-card border rounded-2xl p-6 text-center">
                <p className="text-muted-foreground">Nenhuma oportunidade de reativação identificada.</p>
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {droppedProducts.map((op, i) => (
                  <div key={i} data-testid={`card-opportunity-${op.companyId}-${i}`} className="bg-card border rounded-xl p-3.5 space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate">{op.companyName}</p>
                        <p className="text-xs text-primary font-medium">{op.productName}</p>
                      </div>
                      <span className="text-xs text-muted-foreground flex-shrink-0">{op.daysSinceProduct}d sem pedido</span>
                    </div>
                    <div className="flex items-start gap-1.5">
                      <Lightbulb className="w-3 h-3 text-primary flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-muted-foreground">{op.suggestion}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Clara tip */}
          <div className="bg-primary/5 border border-primary/20 rounded-2xl p-4 flex gap-3">
            <Users className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
            <div className="text-sm text-foreground/80">
              <strong>Clara IA:</strong> Pergunte diretamente ao chat — "Clara, clientes em risco", "Clara, oportunidades de venda" ou "Clara, empresas que reduziram pedidos" para análise instantânea.
            </div>
          </div>
        </>
      )}
    </div>
  );
}

