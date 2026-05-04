import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { safeObjectArray } from "@/lib/safeArray";
import { Layout } from "@/components/Layout";
import { Link } from "wouter";
import {
  Brain, RefreshCw, AlertTriangle, AlertCircle, CheckCircle, Info,
  Package, Users, ShoppingBag, Truck, Shield, ChevronRight,
  TrendingDown, Clock, Zap, Activity, Filter, Wrench, X,
  Wifi, WifiOff, Sparkles, Crown, Building2, UserCheck, ChevronDown, ChevronUp
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
type Category = 'estoque' | 'clientes' | 'produtos' | 'logistica' | 'sistema';

interface IntelAlert {
  id: string;
  category: Category;
  severity: Severity;
  title: string;
  description: string;
  actionLabel?: string;
  actionHref?: string;
  data?: Record<string, unknown>;
}

interface IntelligenceResponse {
  alerts: IntelAlert[];
  summary: {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    byCategory: Record<Category, number>;
  };
  generatedAt: string;
}

const SEV_CONFIG: Record<Severity, { label: string; color: string; bg: string; border: string; icon: typeof AlertCircle }> = {
  CRITICAL: { label: 'Crítico', color: 'text-red-700', bg: 'bg-red-50', border: 'border-red-200', icon: AlertCircle },
  HIGH:     { label: 'Alto',    color: 'text-orange-700', bg: 'bg-orange-50', border: 'border-orange-200', icon: AlertTriangle },
  MEDIUM:   { label: 'Médio',   color: 'text-yellow-700', bg: 'bg-yellow-50', border: 'border-yellow-200', icon: Info },
  LOW:      { label: 'Baixo',   color: 'text-green-700', bg: 'bg-green-50', border: 'border-green-200', icon: CheckCircle },
};

const CAT_CONFIG: Record<Category, { label: string; icon: typeof Package; color: string }> = {
  estoque:  { label: 'Estoque',    icon: Package,       color: 'text-blue-600' },
  clientes: { label: 'Clientes',   icon: Users,         color: 'text-purple-600' },
  produtos: { label: 'Produtos',   icon: ShoppingBag,   color: 'text-orange-600' },
  logistica:{ label: 'Logística',  icon: Truck,         color: 'text-teal-600' },
  sistema:  { label: 'Sistema',    icon: Shield,        color: 'text-red-600' },
};

type TabKey = 'all' | Category;

interface AutoFixResult {
  actions: Array<{ id: string; category: string; title: string; result: string; status: 'FIXED' | 'WARN' | 'SKIP' }>;
  summary: { total: number; fixed: number; warn: number; skip: number };
  executedAt: string;
  executedBy: string;
}

interface AiSyncResult {
  success: boolean;
  syncedAt: string;
  syncedBy: string;
  version: string;
  totalModulos: number;
  results: Array<{ modulo: string; acao: string; status: string; detalhes: string }>;
}

export default function IntelligencePage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<TabKey>('all');
  const [sevFilter, setSevFilter] = useState<Severity | 'all'>('all');
  const [autoFixResult, setAutoFixResult] = useState<AutoFixResult | null>(null);
  const [aiSyncResult, setAiSyncResult] = useState<AiSyncResult | null>(null);
  const [showAiControl, setShowAiControl] = useState(false);

  const { data, isLoading, error, dataUpdatedAt } = useQuery<IntelligenceResponse>({
    queryKey: ['/api/admin/intelligence'],
    queryFn: async () => {
      const res = await fetchWithAuth('/api/admin/intelligence');
      if (!res.ok) throw new Error('Erro ao carregar análise');
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const handleRefresh = () => {
    qc.invalidateQueries({ queryKey: ['/api/admin/intelligence'] });
  };

  const autoFixMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/admin/intelligence/auto-fix');
      return res.json() as Promise<AutoFixResult>;
    },
    onSuccess: (result) => {
      setAutoFixResult(result);
      qc.invalidateQueries({ queryKey: ['/api/admin/intelligence'] });
      toast({ title: `Auto-Fix concluído: ${result.summary.fixed} correção(ões) aplicada(s)` });
    },
    onError: (e: any) => toast({ title: 'Erro no Auto-Fix', description: e.message, variant: 'destructive' }),
  });

  const aiSyncMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/admin/intelligence/ai-sync');
      return res.json() as Promise<AiSyncResult>;
    },
    onSuccess: (result) => {
      setAiSyncResult(result);
      toast({ title: `IA Sincronizada!`, description: `${result.totalModulos} módulos atualizados para ${result.version}` });
    },
    onError: (e: any) => toast({ title: 'Erro na sincronização', description: e.message, variant: 'destructive' }),
  });

  const alerts = safeObjectArray(data, "alerts");
  const summary = data?.summary;

  const filtered = alerts.filter(a => {
    if (activeTab !== 'all' && a.category !== activeTab) return false;
    if (sevFilter !== 'all' && a.severity !== sevFilter) return false;
    return true;
  }).sort((a, b) => {
    const order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    return order[a.severity] - order[b.severity];
  });

  const generatedLabel = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : null;

  const tabs: { key: TabKey; label: string; icon: typeof Package; count: number }[] = [
    { key: 'all', label: 'Todos', icon: Activity, count: alerts.length },
    { key: 'estoque', label: 'Estoque', icon: Package, count: summary?.byCategory.estoque ?? 0 },
    { key: 'clientes', label: 'Clientes', icon: Users, count: summary?.byCategory.clientes ?? 0 },
    { key: 'produtos', label: 'Produtos', icon: ShoppingBag, count: summary?.byCategory.produtos ?? 0 },
    { key: 'logistica', label: 'Logística', icon: Truck, count: summary?.byCategory.logistica ?? 0 },
    { key: 'sistema', label: 'Sistema', icon: Shield, count: summary?.byCategory.sistema ?? 0 },
  ];

  return (
    <Layout>
      <div className="space-y-6">
        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-display font-bold text-foreground flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg shadow-violet-500/25">
                <Brain className="w-6 h-6 text-white" />
              </div>
              Central de Inteligência
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Análise preditiva automática — detecta riscos antes que se tornem problemas.
              {generatedLabel && (
                <span className="ml-2 text-xs text-muted-foreground/70 flex items-center gap-1 inline-flex">
                  <Clock className="w-3 h-3" /> Última análise: {generatedLabel}
                </span>
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={isLoading}
              data-testid="button-intelligence-refresh"
              className="gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              {isLoading ? 'Analisando...' : 'Atualizar'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowAiControl(v => !v)}
              data-testid="button-ai-control-toggle"
              className="gap-2"
            >
              <Crown className="w-4 h-4 text-amber-500" />
              Controle de IA
              {showAiControl ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </Button>
            <Button
              size="sm"
              onClick={() => aiSyncMutation.mutate()}
              disabled={aiSyncMutation.isPending}
              data-testid="button-ai-sync"
              className="gap-2 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 text-white border-0"
            >
              <Wifi className={`w-4 h-4 ${aiSyncMutation.isPending ? 'animate-pulse' : ''}`} />
              {aiSyncMutation.isPending ? 'Sincronizando...' : 'Atualizar IA do Sistema'}
            </Button>
            <Button
              size="sm"
              onClick={() => autoFixMutation.mutate()}
              disabled={autoFixMutation.isPending}
              data-testid="button-intelligence-autofix"
              className="gap-2 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white border-0"
            >
              <Wrench className={`w-4 h-4 ${autoFixMutation.isPending ? 'animate-spin' : ''}`} />
              {autoFixMutation.isPending ? 'Corrigindo...' : 'Corrigir Automaticamente'}
            </Button>
          </div>
        </div>

        {/* ── Auto-Fix Results Panel ── */}
        {autoFixResult && (
          <div className="border border-violet-200 dark:border-violet-800 rounded-2xl bg-violet-50 dark:bg-violet-950/20 p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center">
                  <Wrench className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h3 className="font-bold text-violet-900 dark:text-violet-200 text-sm">Resultado do Auto-Fix</h3>
                  <p className="text-xs text-violet-600 dark:text-violet-400">
                    {autoFixResult.summary.fixed} corrigido(s) · {autoFixResult.summary.warn} aviso(s) · {autoFixResult.summary.skip} ignorado(s) — por {autoFixResult.executedBy}
                  </p>
                </div>
              </div>
              <button type="button" onClick={() => setAutoFixResult(null)} className="w-7 h-7 rounded-lg flex items-center justify-center text-violet-400 hover:text-violet-600 hover:bg-violet-100 dark:hover:bg-violet-900 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2">
              {autoFixResult.actions.map(action => (
                <div key={action.id} className="flex items-start gap-3 p-3 bg-white dark:bg-violet-950/40 rounded-xl border border-violet-100 dark:border-violet-800">
                  {action.status === 'FIXED' && <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />}
                  {action.status === 'WARN' && <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />}
                  {action.status === 'SKIP' && <Info className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{action.title}</p>
                    <p className="text-xs text-muted-foreground">{action.result}</p>
                  </div>
                  <Badge variant="outline" className={`text-[10px] flex-shrink-0 ${action.status === 'FIXED' ? 'border-green-300 text-green-700' : action.status === 'WARN' ? 'border-amber-300 text-amber-700' : 'border-border text-muted-foreground'}`}>
                    {action.status === 'FIXED' ? 'Corrigido' : action.status === 'WARN' ? 'Aviso' : 'OK'}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── AI Sync Results Panel ── */}
        {aiSyncResult && (
          <div className="border border-blue-200 dark:border-blue-800 rounded-2xl bg-blue-50 dark:bg-blue-950/20 p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
                  <Wifi className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h3 className="font-bold text-blue-900 dark:text-blue-200 text-sm">IA Sincronizada — {aiSyncResult.version}</h3>
                  <p className="text-xs text-blue-600 dark:text-blue-400">
                    {aiSyncResult.totalModulos} módulos atualizados · por {aiSyncResult.syncedBy} · {new Date(aiSyncResult.syncedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
              <button type="button" onClick={() => setAiSyncResult(null)} className="w-7 h-7 rounded-lg flex items-center justify-center text-blue-400 hover:text-blue-600 hover:bg-blue-100 dark:hover:bg-blue-900 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {aiSyncResult.results.map((r, i) => (
                <div key={i} className="flex items-start gap-3 p-3 bg-white dark:bg-blue-950/40 rounded-xl border border-blue-100 dark:border-blue-800">
                  <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-foreground">{r.modulo}</p>
                    <p className="text-[11px] text-muted-foreground">{r.detalhes}</p>
                  </div>
                  <Badge variant="outline" className="text-[10px] border-green-300 text-green-700 flex-shrink-0">SYNC</Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── AI Control by Profile ── */}
        {showAiControl && (
          <div className="border border-amber-200 dark:border-amber-800 rounded-2xl bg-amber-50 dark:bg-amber-950/20 p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-lg bg-amber-500 flex items-center justify-center">
                <Crown className="w-4 h-4 text-white" />
              </div>
              <div>
                <h3 className="font-bold text-amber-900 dark:text-amber-200 text-sm">Controle de IA por Perfil</h3>
                <p className="text-xs text-amber-600 dark:text-amber-400">Visão geral do acesso às IAs por tipo de usuário e plano</p>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {[
                {
                  icon: Crown, color: 'violet', label: 'Administrador Master',
                  nivel: 'Ilimitado',
                  ias: ['Central de Inteligência', 'Clara IA', 'Auto-Fix', 'NF-e Diagnóstico', 'IA Developer', 'Logística IA'],
                  limiteMsg: 'Sem restrições',
                },
                {
                  icon: Building2, color: 'blue', label: 'Empresa Cliente',
                  nivel: 'Depende do Plano',
                  ias: ['Clara IA (básica)', 'Alertas de estoque', 'Auto-Fix (limitado)'],
                  limiteMsg: 'Definido no plano',
                },
                {
                  icon: UserCheck, color: 'green', label: 'Usuário Comum',
                  nivel: 'Limitado',
                  ias: ['Clara IA (consultas)', 'Alertas básicos'],
                  limiteMsg: '50 interações/mês',
                },
              ].map(p => {
                const Icon = p.icon;
                return (
                  <div key={p.label} className={`bg-white dark:bg-card rounded-xl border border-${p.color}-200 p-4`}>
                    <div className={`flex items-center gap-2 mb-3`}>
                      <Icon className={`w-4 h-4 text-${p.color}-600`} />
                      <span className="text-xs font-semibold text-foreground">{p.label}</span>
                    </div>
                    <div className={`text-[11px] font-bold text-${p.color}-700 mb-2 bg-${p.color}-50 px-2 py-1 rounded`}>
                      <Sparkles className="w-3 h-3 inline mr-1" />{p.nivel}
                    </div>
                    <ul className="space-y-1">
                      {p.ias.map(ia => (
                        <li key={ia} className="text-[11px] text-muted-foreground flex items-center gap-1">
                          <CheckCircle className="w-2.5 h-2.5 text-green-500" />{ia}
                        </li>
                      ))}
                    </ul>
                    <p className={`text-[10px] text-${p.color}-600 mt-2 pt-2 border-t border-${p.color}-100`}>{p.limiteMsg}</p>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
              {[
                { tipo: 'Free',       nivel: 'limitada',  cor: 'gray'   },
                { tipo: 'Starter',    nivel: 'básica',    cor: 'green'  },
                { tipo: 'Pro',        nivel: 'completa',  cor: 'blue'   },
                { tipo: 'Enterprise', nivel: 'ilimitada', cor: 'violet' },
              ].map(p => (
                <div key={p.tipo} className={`p-2.5 rounded-lg border border-${p.cor}-200 bg-${p.cor}-50/50 text-center`}>
                  <p className="text-xs font-bold text-foreground">{p.tipo}</p>
                  <p className={`text-[11px] text-${p.cor}-700 font-medium capitalize`}>{p.nivel}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Summary Cards ── */}
        {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="bg-card border border-border/50 rounded-2xl p-4 animate-pulse h-20" />
            ))}
          </div>
        ) : summary ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div
              data-testid="card-intelligence-critical"
              className={`bg-red-50 border border-red-100 rounded-2xl p-4 cursor-pointer transition-all ${sevFilter === 'CRITICAL' ? 'ring-2 ring-red-400' : 'hover:border-red-200'}`}
              onClick={() => setSevFilter(sevFilter === 'CRITICAL' ? 'all' : 'CRITICAL')}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-red-600 uppercase tracking-wide">Crítico</span>
                <AlertCircle className="w-4 h-4 text-red-500" />
              </div>
              <p className="text-3xl font-bold text-red-700 mt-1">{summary.critical}</p>
              <p className="text-xs text-red-500 mt-0.5">{summary.critical === 0 ? 'Nenhum' : 'alerta(s)'}</p>
            </div>
            <div
              data-testid="card-intelligence-high"
              className={`bg-orange-50 border border-orange-100 rounded-2xl p-4 cursor-pointer transition-all ${sevFilter === 'HIGH' ? 'ring-2 ring-orange-400' : 'hover:border-orange-200'}`}
              onClick={() => setSevFilter(sevFilter === 'HIGH' ? 'all' : 'HIGH')}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-orange-600 uppercase tracking-wide">Alto</span>
                <AlertTriangle className="w-4 h-4 text-orange-500" />
              </div>
              <p className="text-3xl font-bold text-orange-700 mt-1">{summary.high}</p>
              <p className="text-xs text-orange-500 mt-0.5">{summary.high === 0 ? 'Nenhum' : 'alerta(s)'}</p>
            </div>
            <div
              data-testid="card-intelligence-medium"
              className={`bg-yellow-50 border border-yellow-100 rounded-2xl p-4 cursor-pointer transition-all ${sevFilter === 'MEDIUM' ? 'ring-2 ring-yellow-400' : 'hover:border-yellow-200'}`}
              onClick={() => setSevFilter(sevFilter === 'MEDIUM' ? 'all' : 'MEDIUM')}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-yellow-700 uppercase tracking-wide">Médio</span>
                <Info className="w-4 h-4 text-yellow-600" />
              </div>
              <p className="text-3xl font-bold text-yellow-700 mt-1">{summary.medium}</p>
              <p className="text-xs text-yellow-600 mt-0.5">{summary.medium === 0 ? 'Nenhum' : 'alerta(s)'}</p>
            </div>
            <div
              data-testid="card-intelligence-low"
              className={`bg-green-50 border border-green-100 rounded-2xl p-4 cursor-pointer transition-all ${sevFilter === 'LOW' ? 'ring-2 ring-green-400' : 'hover:border-green-200'}`}
              onClick={() => setSevFilter(sevFilter === 'LOW' ? 'all' : 'LOW')}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-green-600 uppercase tracking-wide">Baixo</span>
                <CheckCircle className="w-4 h-4 text-green-500" />
              </div>
              <p className="text-3xl font-bold text-green-700 mt-1">{summary.low}</p>
              <p className="text-xs text-green-500 mt-0.5">{summary.low === 0 ? 'Nenhum' : 'alerta(s)'}</p>
            </div>
          </div>
        ) : null}

        {/* ── Overall health banner ── */}
        {!isLoading && summary && (
          <div className={`rounded-2xl p-4 flex items-center gap-3 ${
            summary.critical > 0 ? 'bg-red-50 border border-red-200' :
            summary.high > 0 ? 'bg-orange-50 border border-orange-200' :
            summary.medium > 0 ? 'bg-yellow-50 border border-yellow-200' :
            'bg-green-50 border border-green-200'
          }`}>
            {summary.critical > 0 ? <AlertCircle className="w-5 h-5 text-red-600 shrink-0" /> :
             summary.high > 0 ? <AlertTriangle className="w-5 h-5 text-orange-600 shrink-0" /> :
             summary.medium > 0 ? <Zap className="w-5 h-5 text-yellow-600 shrink-0" /> :
             <CheckCircle className="w-5 h-5 text-green-600 shrink-0" />}
            <div className="flex-1">
              <p className={`font-semibold text-sm ${
                summary.critical > 0 ? 'text-red-800' :
                summary.high > 0 ? 'text-orange-800' :
                summary.medium > 0 ? 'text-yellow-800' : 'text-green-800'
              }`}>
                {summary.critical > 0 ? `⚠️ ${summary.critical} problema(s) crítico(s) detectado(s) — ação imediata necessária.` :
                 summary.high > 0 ? `${summary.high} alerta(s) de alta prioridade requerem atenção.` :
                 summary.medium > 0 ? `${summary.medium} item(ns) de atenção moderada.` :
                 '✅ Sistema operando normalmente — nenhum problema crítico detectado.'}
              </p>
              <p className="text-xs opacity-70 mt-0.5">{summary.total} análise(s) concluída(s) em 5 categorias.</p>
            </div>
            {sevFilter !== 'all' && (
              <button onClick={() => setSevFilter('all')} className="text-xs underline opacity-70 hover:opacity-100 shrink-0">
                Limpar filtro
              </button>
            )}
          </div>
        )}

        {/* ── Tabs + Filter Bar ── */}
        <div className="flex flex-col gap-3">
          <div className="flex gap-1 flex-wrap">
            {tabs.map(tab => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  data-testid={`tab-intelligence-${tab.key}`}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-all ${
                    isActive
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'bg-card border border-border/50 text-muted-foreground hover:text-foreground hover:border-border'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {tab.label}
                  {tab.count > 0 && (
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${
                      isActive ? 'bg-white/20 text-white' : 'bg-muted text-muted-foreground'
                    }`}>{tab.count}</span>
                  )}
                </button>
              );
            })}
          </div>
          {sevFilter !== 'all' && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Filter className="w-3 h-3" />
              Filtrando por: <Badge variant="outline">{SEV_CONFIG[sevFilter].label}</Badge>
              <button onClick={() => setSevFilter('all')} className="text-primary hover:underline">Limpar</button>
            </div>
          )}
        </div>

        {/* ── Alert List ── */}
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="bg-card border border-border/50 rounded-2xl p-5 animate-pulse h-24" />
            ))}
          </div>
        ) : error ? (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center">
            <AlertCircle className="w-10 h-10 text-red-400 mx-auto mb-2" />
            <p className="text-red-700 font-semibold">Erro ao carregar análise</p>
            <p className="text-sm text-red-500 mt-1">Tente atualizar novamente.</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-card border border-border/50 rounded-2xl p-10 text-center">
            <CheckCircle className="w-12 h-12 text-green-400 mx-auto mb-3" />
            <p className="font-semibold text-foreground">Nenhum alerta encontrado</p>
            <p className="text-sm text-muted-foreground mt-1">
              {sevFilter !== 'all' || activeTab !== 'all' ? 'Sem resultados para os filtros aplicados.' : 'Tudo certo nesta categoria!'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(alert => {
              const sev = SEV_CONFIG[alert.severity];
              const cat = CAT_CONFIG[alert.category];
              const SevIcon = sev.icon;
              const CatIcon = cat.icon;
              return (
                <div
                  key={alert.id}
                  data-testid={`alert-card-${alert.id}`}
                  className={`${sev.bg} ${sev.border} border rounded-2xl p-5 flex gap-4 transition-all hover:shadow-sm`}
                >
                  <div className="shrink-0 mt-0.5">
                    <SevIcon className={`w-5 h-5 ${sev.color}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start gap-2 flex-wrap">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${sev.bg} ${sev.border} ${sev.color}`}>
                        {sev.label}
                      </span>
                      <span className={`text-xs font-medium flex items-center gap-1 ${cat.color}`}>
                        <CatIcon className="w-3 h-3" /> {cat.label}
                      </span>
                    </div>
                    <p className={`font-semibold mt-1.5 ${sev.color} text-sm`}>{alert.title}</p>
                    <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{alert.description}</p>

                    {/* Extra data chips */}
                    {alert.data && Object.keys(alert.data).length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {alert.category === 'estoque' && alert.data.currentStock !== undefined && (
                          <>
                            <span className="text-xs bg-white/80 border border-border/40 px-2 py-0.5 rounded-lg text-foreground">
                              Estoque atual: <strong>{String(alert.data.currentStock)}</strong>
                            </span>
                            {alert.data.minStock !== undefined && (
                              <span className="text-xs bg-white/80 border border-border/40 px-2 py-0.5 rounded-lg text-foreground">
                                Mínimo: <strong>{String(alert.data.minStock)}</strong>
                              </span>
                            )}
                            {alert.data.daysLeft !== undefined && (
                              <span className="text-xs bg-white/80 border border-border/40 px-2 py-0.5 rounded-lg text-foreground">
                                Estimativa: <strong>{String(alert.data.daysLeft)} dia(s)</strong>
                              </span>
                            )}
                          </>
                        )}
                        {alert.category === 'clientes' && alert.data.daysSince !== undefined && (
                          <>
                            <span className="text-xs bg-white/80 border border-border/40 px-2 py-0.5 rounded-lg text-foreground">
                              Sem pedido há: <strong>{String(alert.data.daysSince)} dias</strong>
                            </span>
                            {alert.data.avgGapDays !== undefined && (
                              <span className="text-xs bg-white/80 border border-border/40 px-2 py-0.5 rounded-lg text-foreground">
                                Frequência histórica: <strong>~{String(alert.data.avgGapDays)} dias</strong>
                              </span>
                            )}
                          </>
                        )}
                        {alert.category === 'produtos' && alert.data.dropPct !== undefined && (
                          <>
                            <span className="text-xs bg-white/80 border border-border/40 px-2 py-0.5 rounded-lg text-foreground flex items-center gap-1">
                              <TrendingDown className="w-3 h-3 text-red-500" />
                              Queda: <strong>{String(alert.data.dropPct)}%</strong>
                            </span>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  {alert.actionLabel && alert.actionHref && (
                    <div className="shrink-0 self-center">
                      <Link href={alert.actionHref}>
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1 text-xs h-8"
                          data-testid={`button-alert-action-${alert.id}`}
                        >
                          {alert.actionLabel} <ChevronRight className="w-3 h-3" />
                        </Button>
                      </Link>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── Footer note ── */}
        {!isLoading && filtered.length > 0 && (
          <p className="text-xs text-center text-muted-foreground pb-4">
            Mostrando {filtered.length} de {alerts.length} alerta(s) · Análise gerada em {data?.generatedAt ? new Date(data.generatedAt).toLocaleString('pt-BR') : '—'}
          </p>
        )}
      </div>
    </Layout>
  );
}

