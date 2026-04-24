import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import {
  Shield, RefreshCw, AlertTriangle, CheckCircle, Info, LogIn, ShoppingCart, Edit,
  Scan, Bug, Wrench, Zap, Play, Database, AlertCircle, Trash2, Activity, Server, Clock,
  Download, Calendar, X, ChevronDown
} from "lucide-react";
import { useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";

const LEVEL_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  INFO: { label: "INFO", color: "bg-blue-100 text-blue-700", icon: Info },
  WARN: { label: "AVISO", color: "bg-orange-100 text-orange-700", icon: AlertTriangle },
  ERROR: { label: "ERRO", color: "bg-red-100 text-red-700", icon: AlertTriangle },
};

const SEVERITY_CONFIG: Record<string, { color: string; bg: string }> = {
  INFO: { color: "text-blue-700", bg: "bg-blue-50 border-blue-200" },
  WARN: { color: "text-orange-700", bg: "bg-orange-50 border-orange-200" },
  ERROR: { color: "text-red-700", bg: "bg-red-50 border-red-200" },
  OK: { color: "text-green-700", bg: "bg-green-50 border-green-200" },
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  });
}

type AuditIssue = { severity: string; category: string; message: string };
type AuditDetails = {
  inactiveCompanies: { id: number; companyName: string; cnpj: string | null; city: string | null; email: string | null; registeredAt: string | null; responsible: string | null; lastOrderDate: string | null; daysSinceOrder: number | null; active: boolean }[];
  inactiveProducts: { id: number; name: string; category: string | null; active: boolean; basePrice: string | null; createdAt: string | null }[];
  loginFails: { id: number; email: string; createdAt: string; ip: string | null; description: string }[];
  systemErrors: { id: number; action: string; description: string; level: string; createdAt: string; userEmail: string | null }[];
};

function analyzeLogsForBugs(logs: any[]): Array<{ type: string; description: string; suggestion: string; priority: 'HIGH' | 'MEDIUM' | 'LOW' }> {
  const bugs: Array<{ type: string; description: string; suggestion: string; priority: 'HIGH' | 'MEDIUM' | 'LOW' }> = [];
  if (!logs || logs.length === 0) return bugs;

  const loginFails = logs.filter(l => l.action === 'LOGIN_FAILED');
  const recentFails = loginFails.filter(l => (Date.now() - new Date(l.createdAt).getTime()) < 60 * 60 * 1000);
  if (recentFails.length >= 3) {
    const ips = Array.from(new Set(recentFails.map(l => l.ip).filter(Boolean)));
    bugs.push({ type: 'Segurança — Brute Force Potencial', description: `${recentFails.length} tentativas de login falhas na última hora (IPs: ${ips.join(', ') || 'desconhecido'}).`, suggestion: 'Considere implementar rate limiting por IP ou bloquear temporariamente os IPs suspeitos.', priority: 'HIGH' as const });
  }

  const errors = logs.filter(l => l.level === 'ERROR');
  if (errors.length > 0) {
    const grouped: Record<string, number> = {};
    errors.forEach(l => { grouped[l.action] = (grouped[l.action] || 0) + 1; });
    Object.entries(grouped).forEach(([action, count]) => {
      bugs.push({ type: `Erro Recorrente — ${action}`, description: `${count} ocorrência(s) de erro na ação "${action}".`, suggestion: 'Verifique os detalhes nos logs abaixo e confirme se a causa raiz foi corrigida.', priority: count >= 5 ? 'HIGH' as const : 'MEDIUM' as const });
    });
  }

  const last24h = logs.filter(l => (Date.now() - new Date(l.createdAt).getTime()) < 24 * 60 * 60 * 1000);
  if (last24h.length === 0) {
    bugs.push({ type: 'Monitoramento — Logs Ausentes', description: 'Nenhuma atividade registrada nas últimas 24 horas.', suggestion: 'Verifique se o sistema de logs está funcionando corretamente.', priority: 'MEDIUM' as const });
  }

  const unauthorized = logs.filter(l => l.action === 'UNAUTHORIZED_ACCESS');
  if (unauthorized.length > 0) {
    bugs.push({ type: 'Acesso não autorizado detectado', description: `${unauthorized.length} tentativa(s) de acesso não autorizado registradas.`, suggestion: 'Revise as permissões de rotas e verifique os usuários envolvidos.', priority: 'HIGH' as const });
  }

  return bugs;
}

// ─── Health Check Tab ────────────────────────────────────────────────────────
function HealthTab() {
  const { toast } = useToast();
  const { data: health, isLoading, refetch, isFetching } = useQuery<any>({
    queryKey: ['/api/health'],
    enabled: false,
    staleTime: 0,
  });

  const run = async () => { await refetch(); };

  const statusIcon = (s: string) => {
    if (s === 'OK') return <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />;
    if (s === 'WARN') return <AlertTriangle className="w-5 h-5 text-orange-500 flex-shrink-0" />;
    return <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />;
  };

  const statusBg = (s: string) => {
    if (s === 'OK') return 'border-green-200 bg-green-50';
    if (s === 'WARN') return 'border-orange-200 bg-orange-50';
    return 'border-red-200 bg-red-50';
  };

  const statusText = (s: string) => {
    if (s === 'OK') return 'text-green-700';
    if (s === 'WARN') return 'text-orange-700';
    return 'text-red-700';
  };

  const CHECK_LABELS: Record<string, string> = {
    database: '🗄️ Banco de Dados', auth: '👤 Autenticação / Usuários', logs: '📋 Sistema de Logs',
    server: '🖥️ Servidor', session: '🔐 Sessão Atual', maintenance: '🔧 Modo Manutenção', testMode: '🧪 Modo Teste',
  };

  return (
    <div className="space-y-4">
      <div className="bg-card rounded-2xl border border-border/50 p-6 premium-shadow">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-2xl bg-green-100 flex items-center justify-center">
            <Activity className="w-6 h-6 text-green-600" />
          </div>
          <div>
            <h3 className="font-bold text-foreground text-lg">Teste de Saúde do Sistema</h3>
            <p className="text-sm text-muted-foreground">Verifica servidor, banco de dados, sessão, modos e configurações.</p>
          </div>
        </div>
        <Button onClick={run} disabled={isLoading || isFetching} data-testid="button-run-health" className="gap-2 mb-6">
          <Server className="w-4 h-4" />
          {isFetching ? 'Verificando...' : 'Executar Teste de Saúde'}
        </Button>

        {health && (
          <div className="space-y-4">
            <div className={`flex items-center gap-3 p-4 rounded-xl border-2 font-bold ${health.overall === 'HEALTHY' ? 'border-green-300 bg-green-50 text-green-700' : 'border-red-300 bg-red-50 text-red-700'}`}>
              {health.overall === 'HEALTHY' ? <CheckCircle className="w-6 h-6" /> : <AlertCircle className="w-6 h-6" />}
              Sistema: {health.overall === 'HEALTHY' ? 'SAUDÁVEL' : 'DEGRADADO'} — Resposta em {health.responseMs}ms
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {Object.entries(health.checks).map(([key, check]: [string, any]) => (
                <div key={key} className={`flex items-start gap-3 p-3 rounded-xl border ${statusBg(check.status)}`}>
                  {statusIcon(check.status)}
                  <div>
                    <p className={`font-bold text-sm ${statusText(check.status)}`}>{CHECK_LABELS[key] || key}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{check.message}</p>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Relatório gerado em {new Date(health.timestamp).toLocaleString('pt-BR')}</p>
          </div>
        )}

        {!health && !isFetching && (
          <div className="text-center py-8 text-muted-foreground">
            <Activity className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm">Clique no botão acima para executar o diagnóstico</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────
export default function DeveloperPage() {
  const [levelFilter, setLevelFilter] = useState<string>("ALL");
  const [actionFilter, setActionFilter] = useState<string>("");
  const [userFilter, setUserFilter] = useState<string>("");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [activeTab, setActiveTab] = useState<'logs' | 'audit' | 'ai' | 'health' | 'sync'>('logs');
  const [auditDetailPanel, setAuditDetailPanel] = useState<string | null>(null);
  const [inactiveFilter, setInactiveFilter] = useState<'all' | '30' | '60' | '90'>('all');
  const [bugTypeFilter, setBugTypeFilter] = useState<string>('ALL');
  const [bugStatusMap, setBugStatusMap] = useState<Record<string, 'aberto' | 'analisando' | 'resolvido'>>({});
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [selectedLogs, setSelectedLogs] = useState<Set<number>>(new Set());
  const [showDateCleanup, setShowDateCleanup] = useState(false);
  const [cleanupStart, setCleanupStart] = useState("");
  const [cleanupEnd, setCleanupEnd] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: logs, isLoading } = useQuery<any[]>({
    queryKey: ['/api/admin/logs'],
    refetchInterval: 30000,
  });

  const { data: mailerStatus } = useQuery<{ configured: boolean; smtp: string | null; from: string }>({
    queryKey: ['/api/admin/mailer-status'],
  });

  const auditMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/admin/audit', { credentials: 'include' });
      if (!res.ok) throw new Error('Falha na auditoria');
      return res.json();
    },
    onError: () => toast({ title: "Erro ao executar auditoria", variant: "destructive" }),
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/admin/system-sync', { method: 'POST', credentials: 'include' });
      if (!res.ok) throw new Error('Falha na sincronização');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/logs'] });
      toast({ title: 'Sincronização global concluída!' });
    },
    onError: () => toast({ title: 'Erro ao sincronizar sistema', variant: 'destructive' }),
  });

  const clearLogsMut = useMutation({
    mutationFn: () => apiRequest('DELETE', '/api/logs'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/logs'] });
      setSelectedLogs(new Set());
      toast({ title: 'Histórico de logs limpo com sucesso!' });
      setShowClearConfirm(false);
    },
    onError: () => toast({ title: 'Erro ao limpar logs', variant: 'destructive' }),
  });

  const deleteSelectedMut = useMutation({
    mutationFn: async (ids: number[]) => {
      const res = await fetch('/api/logs/selected', {
        method: 'DELETE', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.message); }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/logs'] });
      setSelectedLogs(new Set());
      toast({ title: `${data.removed} log(s) excluídos.` });
    },
    onError: (e: any) => toast({ title: e.message || 'Erro ao excluir logs', variant: 'destructive' }),
  });

  const cleanByDateMut = useMutation({
    mutationFn: async ({ start, end }: { start: string; end: string }) => {
      const res = await fetch('/api/logs/by-date', {
        method: 'DELETE', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startDate: start, endDate: end }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.message); }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/logs'] });
      setShowDateCleanup(false);
      setCleanupStart(""); setCleanupEnd("");
      toast({ title: `${data.removed} log(s) removidos no período.` });
    },
    onError: (e: any) => toast({ title: e.message || 'Erro ao limpar logs', variant: 'destructive' }),
  });

  const exportCSV = () => {
    window.location.href = '/api/logs/export';
  };

  const allActions = Array.from(new Set((logs || []).map((l: any) => l.action))).sort();
  const allUsers = Array.from(new Set((logs || []).map((l: any) => l.userEmail).filter(Boolean))).sort();

  const filtered = (logs || []).filter((l: any) => {
    if (levelFilter !== "ALL" && l.level !== levelFilter) return false;
    if (actionFilter && actionFilter !== 'ALL' && l.action !== actionFilter) return false;
    if (userFilter && userFilter !== 'ALL' && l.userEmail !== userFilter) return false;
    if (dateFrom) {
      const logDate = new Date(l.createdAt).toISOString().slice(0, 10);
      if (logDate < dateFrom) return false;
    }
    if (dateTo) {
      const logDate = new Date(l.createdAt).toISOString().slice(0, 10);
      if (logDate > dateTo) return false;
    }
    return true;
  });

  const counts = {
    total: logs?.length || 0,
    errors: logs?.filter((l: any) => l.level === 'ERROR').length || 0,
    warns: logs?.filter((l: any) => l.level === 'WARN').length || 0,
    logins: logs?.filter((l: any) => l.action === 'LOGIN').length || 0,
    orders: logs?.filter((l: any) => l.action === 'ORDER_CREATED').length || 0,
  };

  const aiBugs = analyzeLogsForBugs(logs || []);

  const clearFilters = () => { setLevelFilter('ALL'); setActionFilter(''); setUserFilter(''); setDateFrom(''); setDateTo(''); };
  const hasFilters = levelFilter !== 'ALL' || actionFilter || userFilter || dateFrom || dateTo;

  return (
    <Layout>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Área do Desenvolvedor</h1>
          <p className="text-muted-foreground mt-1">Logs, auditoria, saúde e detecção de bugs.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button data-testid="button-refresh-logs"
            onClick={() => queryClient.invalidateQueries({ queryKey: ['/api/admin/logs'] })}
            className="flex items-center gap-2 px-4 py-2.5 border-2 border-border rounded-xl text-sm font-bold hover:bg-muted transition-colors">
            <RefreshCw className="w-4 h-4" /> Atualizar
          </button>
          <button data-testid="button-export-logs"
            onClick={exportCSV}
            className="flex items-center gap-2 px-4 py-2.5 border-2 border-border rounded-xl text-sm font-bold hover:bg-muted transition-colors">
            <Download className="w-4 h-4" /> Exportar CSV
          </button>
          <button data-testid="button-cleanup-by-date"
            onClick={() => setShowDateCleanup(true)}
            className="flex items-center gap-2 px-4 py-2.5 border-2 border-orange-200 text-orange-600 rounded-xl text-sm font-bold hover:bg-orange-50 transition-colors">
            <Calendar className="w-4 h-4" /> Limpar por Período
          </button>
          {!showClearConfirm ? (
            <button onClick={() => setShowClearConfirm(true)} data-testid="button-clear-logs"
              className="flex items-center gap-2 px-4 py-2.5 border-2 border-red-200 text-red-600 rounded-xl text-sm font-bold hover:bg-red-50 transition-colors">
              <Trash2 className="w-4 h-4" /> Limpar Tudo
            </button>
          ) : (
            <div className="flex gap-2">
              <button onClick={() => clearLogsMut.mutate()} disabled={clearLogsMut.isPending}
                data-testid="button-confirm-clear-logs"
                className="flex items-center gap-2 px-4 py-2.5 bg-red-600 text-white rounded-xl text-sm font-bold hover:bg-red-700 transition-colors disabled:opacity-50">
                {clearLogsMut.isPending ? 'Limpando...' : 'Confirmar limpeza'}
              </button>
              <button onClick={() => setShowClearConfirm(false)}
                className="px-4 py-2.5 border-2 border-border rounded-xl text-sm font-bold hover:bg-muted transition-colors">
                Cancelar
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Status cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        {[
          { label: "Total de logs", value: counts.total, color: "text-foreground" },
          { label: "Erros", value: counts.errors, color: "text-red-600" },
          { label: "Avisos", value: counts.warns, color: "text-orange-600" },
          { label: "Logins", value: counts.logins, color: "text-blue-600" },
          { label: "Pedidos", value: counts.orders, color: "text-green-600" },
        ].map(c => (
          <div key={c.label} className="bg-card rounded-2xl p-4 border border-border/50 premium-shadow text-center">
            <p className={`text-2xl font-display font-bold ${c.color}`}>{c.value}</p>
            <p className="text-xs text-muted-foreground font-medium mt-0.5">{c.label}</p>
          </div>
        ))}
      </div>

      {/* System status */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className={`rounded-2xl p-4 border-2 flex items-center gap-3 ${mailerStatus?.configured ? 'border-green-200 bg-green-50' : 'border-orange-200 bg-orange-50'}`}>
          {mailerStatus?.configured ? <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" /> : <AlertTriangle className="w-5 h-5 text-orange-500 flex-shrink-0" />}
          <div>
            <p className="font-bold text-sm">E-mail SMTP: {mailerStatus?.configured ? "Configurado" : "Não configurado"}</p>
            {mailerStatus?.smtp && <p className="text-xs text-muted-foreground">{mailerStatus.smtp}</p>}
          </div>
        </div>
        <div className="rounded-2xl p-4 border-2 border-green-200 bg-green-50 flex items-center gap-3">
          <Shield className="w-5 h-5 text-green-600 flex-shrink-0" />
          <div>
            <p className="font-bold text-sm">Backup automático: Ativo</p>
            <p className="text-xs text-muted-foreground">Agendado diariamente às 17:00</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-muted/40 rounded-xl mb-6 w-fit flex-wrap">
        {[
          { id: 'logs', label: 'Logs do Sistema', icon: Database },
          { id: 'audit', label: 'Auditoria', icon: Scan },
          { id: 'ai', label: 'Detector de Bugs', icon: Bug },
          { id: 'health', label: 'Saúde do Sistema', icon: Activity },
          { id: 'sync', label: 'Sincronização Global', icon: RefreshCw },
        ].map(tab => {
          const Icon = tab.icon;
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id as any)}
              data-testid={`tab-${tab.id}`}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg font-bold text-sm transition-all ${activeTab === tab.id ? 'bg-white text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
              <Icon className="w-4 h-4" /> {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab: Logs */}
      {activeTab === 'logs' && (
        <>
          {/* Advanced Filters */}
          <div className="bg-muted/30 rounded-xl p-4 mb-4 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex gap-2 flex-wrap">
                {["ALL", "INFO", "WARN", "ERROR"].map(l => (
                  <button key={l} onClick={() => setLevelFilter(l)} data-testid={`filter-level-${l}`}
                    className={`px-3 py-1.5 rounded-lg font-bold text-sm border-2 transition-all ${levelFilter === l ? 'bg-primary text-white border-primary' : 'border-border hover:border-primary/50 bg-card'}`}>
                    {l === "ALL" ? "Todos" : l === "WARN" ? "Avisos" : l === "ERROR" ? "Erros" : "Info"}
                  </button>
                ))}
              </div>
              {hasFilters && (
                <button onClick={clearFilters} className="px-3 py-1.5 rounded-lg text-sm text-muted-foreground hover:text-foreground border border-dashed border-muted-foreground/30" data-testid="button-clear-filters">
                  Limpar filtros
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <Label className="text-xs mb-1 block">Tipo de evento</Label>
                <Select value={actionFilter || 'ALL'} onValueChange={v => setActionFilter(v === 'ALL' ? '' : v)}>
                  <SelectTrigger className="h-8 text-xs" data-testid="select-filter-action">
                    <SelectValue placeholder="Todos os eventos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">Todos os eventos</SelectItem>
                    {allActions.map(a => <SelectItem key={a} value={a} className="text-xs font-mono">{a}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs mb-1 block">Usuário</Label>
                <Select value={userFilter || 'ALL'} onValueChange={v => setUserFilter(v === 'ALL' ? '' : v)}>
                  <SelectTrigger className="h-8 text-xs" data-testid="select-filter-user">
                    <SelectValue placeholder="Todos os usuários" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">Todos os usuários</SelectItem>
                    {allUsers.map(u => <SelectItem key={u} value={u} className="text-xs">{u}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs mb-1 block">Data inicial</Label>
                <Input type="date" className="h-8 text-xs" value={dateFrom} onChange={e => setDateFrom(e.target.value)} data-testid="input-filter-date-from" />
              </div>
              <div>
                <Label className="text-xs mb-1 block">Data final</Label>
                <Input type="date" className="h-8 text-xs" value={dateTo} onChange={e => setDateTo(e.target.value)} data-testid="input-filter-date-to" />
              </div>
            </div>
          </div>

          {/* Bulk action toolbar */}
          {selectedLogs.size > 0 && (
            <div className="mb-3 p-3 bg-primary/10 border-2 border-primary/30 rounded-xl flex items-center gap-3 flex-wrap">
              <span className="font-bold text-sm text-primary">{selectedLogs.size} log(s) selecionado(s)</span>
              <button
                data-testid="button-delete-selected-logs"
                onClick={() => deleteSelectedMut.mutate(Array.from(selectedLogs))}
                disabled={deleteSelectedMut.isPending}
                className="flex items-center gap-2 px-3 py-1.5 bg-red-600 text-white rounded-lg text-sm font-bold hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {deleteSelectedMut.isPending ? 'Excluindo...' : 'Excluir selecionados'}
              </button>
              <button
                onClick={() => setSelectedLogs(new Set())}
                className="flex items-center gap-1 px-3 py-1.5 border border-border rounded-lg text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-3.5 h-3.5" /> Cancelar seleção
              </button>
            </div>
          )}

          <div className="bg-card rounded-2xl border border-border/50 premium-shadow overflow-hidden">
            <div className="p-5 border-b border-border/50 bg-muted/20 flex items-center gap-2">
              <Shield className="w-4 h-4 text-primary" />
              <span className="font-bold text-foreground">Logs do Sistema</span>
              <span className="ml-auto text-xs text-muted-foreground">{filtered.length} de {logs?.length || 0} registro(s)</span>
            </div>
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground">Carregando logs...</div>
            ) : filtered.length === 0 ? (
              <div className="p-12 text-center">
                <Shield className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                <p className="font-bold text-muted-foreground">Nenhum log encontrado</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/50 bg-muted/10">
                      <th className="p-3 w-8">
                        <input type="checkbox"
                          data-testid="checkbox-select-all-logs"
                          checked={filtered.length > 0 && filtered.every((l: any) => selectedLogs.has(l.id))}
                          onChange={e => {
                            if (e.target.checked) setSelectedLogs(new Set(filtered.map((l: any) => l.id)));
                            else setSelectedLogs(new Set());
                          }}
                          className="w-4 h-4 accent-primary cursor-pointer"
                        />
                      </th>
                      <th className="text-left p-3 font-semibold text-muted-foreground">Data/Hora</th>
                      <th className="text-left p-3 font-semibold text-muted-foreground">Nível</th>
                      <th className="text-left p-3 font-semibold text-muted-foreground">Ação</th>
                      <th className="text-left p-3 font-semibold text-muted-foreground">Descrição</th>
                      <th className="text-left p-3 font-semibold text-muted-foreground">Usuário</th>
                      <th className="text-left p-3 font-semibold text-muted-foreground">IP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((log: any) => {
                      const lvl = LEVEL_CONFIG[log.level] || LEVEL_CONFIG.INFO;
                      const isSelected = selectedLogs.has(log.id);
                      return (
                        <tr key={log.id} data-testid={`row-log-${log.id}`}
                          className={`border-b border-border/30 hover:bg-muted/10 transition-colors cursor-pointer ${isSelected ? 'bg-primary/5' : ''}`}
                          onClick={() => {
                            const next = new Set(selectedLogs);
                            if (next.has(log.id)) next.delete(log.id); else next.add(log.id);
                            setSelectedLogs(next);
                          }}
                        >
                          <td className="p-3 w-8" onClick={e => e.stopPropagation()}>
                            <input type="checkbox"
                              data-testid={`checkbox-log-${log.id}`}
                              checked={isSelected}
                              onChange={() => {
                                const next = new Set(selectedLogs);
                                if (next.has(log.id)) next.delete(log.id); else next.add(log.id);
                                setSelectedLogs(next);
                              }}
                              className="w-4 h-4 accent-primary cursor-pointer"
                            />
                          </td>
                          <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">{formatDate(log.createdAt)}</td>
                          <td className="p-3"><span className={`px-2 py-0.5 rounded-full text-xs font-bold ${lvl.color}`}>{lvl.label}</span></td>
                          <td className="p-3 font-mono text-xs font-bold text-foreground">{log.action}</td>
                          <td className="p-3 text-foreground max-w-xs truncate">{log.description}</td>
                          <td className="p-3 text-xs text-muted-foreground">{log.userEmail || '—'}</td>
                          <td className="p-3 text-xs text-muted-foreground">{log.ip || '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* Date cleanup modal */}
      {showDateCleanup && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl">
            <div className="flex items-start gap-3 mb-5">
              <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center flex-shrink-0">
                <Calendar className="w-5 h-5 text-orange-600" />
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-lg text-foreground">Limpar Logs por Período</h3>
                <p className="text-sm text-muted-foreground mt-1">Todos os logs no período selecionado serão excluídos permanentemente.</p>
              </div>
              <button onClick={() => setShowDateCleanup(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-4 mb-5">
              <div>
                <label className="block text-sm font-semibold mb-1">Data inicial</label>
                <input type="date" data-testid="input-cleanup-start-date"
                  value={cleanupStart} onChange={e => setCleanupStart(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border-2 border-border focus:border-primary outline-none text-sm" />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">Data final</label>
                <input type="date" data-testid="input-cleanup-end-date"
                  value={cleanupEnd} onChange={e => setCleanupEnd(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border-2 border-border focus:border-primary outline-none text-sm" />
              </div>
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowDateCleanup(false)}
                className="px-4 py-2 border-2 border-border rounded-xl font-bold text-sm hover:bg-muted transition-colors">
                Cancelar
              </button>
              <button
                data-testid="button-confirm-cleanup-by-date"
                onClick={() => cleanByDateMut.mutate({ start: cleanupStart, end: cleanupEnd })}
                disabled={cleanByDateMut.isPending || !cleanupStart || !cleanupEnd}
                className="flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-xl font-bold text-sm hover:bg-orange-700 transition-colors disabled:opacity-50"
              >
                {cleanByDateMut.isPending ? 'Limpando...' : 'Confirmar limpeza'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Audit */}
      {activeTab === 'audit' && (
        <div className="space-y-4">
          <div className="bg-card rounded-2xl border border-border/50 p-6 premium-shadow">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
                <Scan className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h3 className="font-bold text-foreground text-lg">Auditoria Completa do Sistema</h3>
                <p className="text-sm text-muted-foreground">Verifica usuários, empresas, pedidos, produtos e logs em busca de inconsistências.</p>
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => { auditMutation.mutate(); setAuditDetailPanel(null); }} disabled={auditMutation.isPending}
                data-testid="button-run-audit"
                className="flex items-center gap-2 px-6 py-3 bg-primary text-white font-bold rounded-xl hover:-translate-y-0.5 transition-all disabled:opacity-50 shadow-lg shadow-primary/20">
                <Play className="w-4 h-4" />
                {auditMutation.isPending ? "Executando auditoria..." : "Executar Auditoria"}
              </button>
              {auditMutation.data && (
                <button onClick={() => {
                  const d = auditMutation.data as any;
                  const lines = [
                    'Auditoria VivaFrutaz',
                    `Data: ${new Date(d.scannedAt).toLocaleString('pt-BR')}`,
                    '',
                    '=== RESUMO ===',
                    `Usuários: ${d.summary.activeUsers}/${d.summary.totalUsers} ativos`,
                    `Empresas: ${d.summary.activeCompanies}/${d.summary.totalCompanies} ativas`,
                    `Login Fails: ${d.summary.loginFails}`,
                    `Erros nos logs: ${d.summary.errors}`,
                    '',
                    '=== PROBLEMAS ===',
                    ...(d.issues || []).map((i: any) => `[${i.severity}] ${i.category}: ${i.message}`),
                    '',
                    '=== EMPRESAS INATIVAS ===',
                    ...(d.details?.inactiveCompanies || []).map((c: any) => `${c.companyName} | CNPJ: ${c.cnpj || '-'} | Cidade: ${c.city || '-'} | Email: ${c.email || '-'} | Último pedido: ${c.lastOrderDate ? new Date(c.lastOrderDate).toLocaleDateString('pt-BR') : 'nunca'}`),
                    '',
                    '=== PRODUTOS INATIVOS ===',
                    ...(d.details?.inactiveProducts || []).map((p: any) => `${p.name} | Categoria: ${p.category || '-'}`),
                    '',
                    '=== LOGINS FALHOS ===',
                    ...(d.details?.loginFails || []).map((l: any) => `${new Date(l.createdAt).toLocaleString('pt-BR')} | Email: ${l.email} | IP: ${l.ip || '-'}`),
                  ];
                  const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a'); a.href = url; a.download = `auditoria-${new Date().toISOString().slice(0,10)}.txt`; a.click(); URL.revokeObjectURL(url);
                }}
                data-testid="button-export-audit"
                className="flex items-center gap-2 px-5 py-2.5 border-2 border-border rounded-xl text-sm font-bold hover:bg-muted transition-colors">
                  <Download className="w-4 h-4" /> Exportar Relatório
                </button>
              )}
            </div>

            {auditMutation.data && (() => {
              const d = auditMutation.data as any;
              const details: AuditDetails = d.details || { inactiveCompanies: [], inactiveProducts: [], loginFails: [], systemErrors: [] };
              return (
                <div className="mt-6 space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[
                      { label: 'Usuários', value: `${d.summary?.activeUsers}/${d.summary?.totalUsers}`, sub: 'ativos/total', key: null },
                      { label: 'Empresas', value: `${d.summary?.activeCompanies}/${d.summary?.totalCompanies}`, sub: 'ativas/total', key: null },
                      { label: 'Erros nos Logs', value: d.summary?.errors, sub: 'clique p/ ver', color: d.summary?.errors > 0 ? 'text-red-600' : 'text-green-600', key: 'systemErrors' },
                      { label: 'Login Fails', value: d.summary?.loginFails, sub: 'clique p/ ver', color: d.summary?.loginFails > 5 ? 'text-orange-600' : 'text-foreground', key: 'loginFails' },
                    ].map(c => (
                      <div key={c.label}
                        onClick={() => c.key ? setAuditDetailPanel(auditDetailPanel === c.key ? null : c.key) : null}
                        className={`bg-muted/30 rounded-xl p-3 text-center ${c.key ? 'cursor-pointer hover:bg-muted/60 transition-colors border-2 border-transparent hover:border-primary/30' : ''}`}>
                        <p className={`text-xl font-bold ${c.color || 'text-foreground'}`}>{c.value}</p>
                        <p className="text-xs text-muted-foreground">{c.label} ({c.sub})</p>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-2">
                    <p className="text-sm font-bold text-muted-foreground">{d.issues?.length || 0} problema(s) encontrado(s) — clique para ver detalhes:</p>
                    {d.issues?.length === 0 && (
                      <div className="flex items-center gap-2 p-4 bg-green-50 border border-green-200 rounded-xl">
                        <CheckCircle className="w-5 h-5 text-green-600" />
                        <p className="text-sm text-green-700 font-medium">Sistema sem inconsistências detectadas!</p>
                      </div>
                    )}
                    {d.issues?.map((issue: any, i: number) => {
                      const cfg = SEVERITY_CONFIG[issue.severity] || SEVERITY_CONFIG.INFO;
                      const SevIcon = issue.severity === 'ERROR' ? AlertCircle : issue.severity === 'WARN' ? AlertTriangle : CheckCircle;
                      const panelKey = issue.category === 'Empresas' && details.inactiveCompanies.length > 0 ? 'inactiveCompanies'
                        : issue.category === 'Produtos' && details.inactiveProducts.length > 0 ? 'inactiveProducts'
                        : issue.category === 'Segurança' && details.loginFails.length > 0 ? 'loginFails'
                        : issue.category === 'Logs' && details.systemErrors.length > 0 ? 'systemErrors'
                        : null;
                      return (
                        <div key={i}
                          onClick={() => panelKey ? setAuditDetailPanel(auditDetailPanel === panelKey ? null : panelKey) : null}
                          data-testid={`audit-issue-${i}`}
                          className={`flex items-start gap-3 p-4 rounded-xl border ${cfg.bg} ${panelKey ? 'cursor-pointer hover:brightness-95 transition-all' : ''}`}>
                          <SevIcon className={`w-5 h-5 flex-shrink-0 mt-0.5 ${cfg.color}`} />
                          <div className="flex-1">
                            <p className="text-sm text-foreground">{issue.message}</p>
                            {panelKey && <p className="text-xs text-muted-foreground mt-0.5">↓ Clique para ver detalhes</p>}
                          </div>
                          {panelKey && <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${auditDetailPanel === panelKey ? 'rotate-180' : ''}`} />}
                        </div>
                      );
                    })}
                  </div>

                  {/* ── Inactive Companies Detail ── */}
                  {auditDetailPanel === 'inactiveCompanies' && details.inactiveCompanies.length > 0 && (
                    <div className="bg-muted/20 rounded-2xl border border-border/50 overflow-hidden">
                      <div className="px-4 py-3 border-b border-border/50 bg-muted/30 flex items-center justify-between gap-3 flex-wrap">
                        <p className="font-bold text-sm">Empresas Inativas ({details.inactiveCompanies.length})</p>
                        <div className="flex gap-1">
                          {(['all', '30', '60', '90'] as const).map(f => (
                            <button key={f} onClick={() => setInactiveFilter(f)}
                              className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors ${inactiveFilter === f ? 'bg-primary text-white' : 'bg-white border border-border text-muted-foreground hover:bg-muted/40'}`}>
                              {f === 'all' ? 'Todas' : `${f} dias`}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead><tr className="text-xs text-muted-foreground bg-muted/10 border-b border-border/50">
                            <th className="text-left px-4 py-2">Empresa</th>
                            <th className="text-left px-4 py-2">CNPJ</th>
                            <th className="text-left px-4 py-2">Cidade</th>
                            <th className="text-left px-4 py-2">E-mail</th>
                            <th className="text-left px-4 py-2">Último Pedido</th>
                            <th className="text-left px-4 py-2">Ações</th>
                          </tr></thead>
                          <tbody className="divide-y divide-border/40">
                            {details.inactiveCompanies
                              .filter(c => {
                                if (inactiveFilter === 'all') return true;
                                return c.daysSinceOrder === null || c.daysSinceOrder >= Number(inactiveFilter);
                              })
                              .map(c => (
                                <tr key={c.id} className="hover:bg-muted/20" data-testid={`audit-inactive-company-${c.id}`}>
                                  <td className="px-4 py-2.5 font-medium">{c.companyName}</td>
                                  <td className="px-4 py-2.5 text-muted-foreground">{c.cnpj || '—'}</td>
                                  <td className="px-4 py-2.5 text-muted-foreground">{c.city || '—'}</td>
                                  <td className="px-4 py-2.5 text-muted-foreground">{c.email || '—'}</td>
                                  <td className="px-4 py-2.5">
                                    {c.lastOrderDate
                                      ? <span className={`font-medium ${c.daysSinceOrder && c.daysSinceOrder > 60 ? 'text-red-600' : 'text-muted-foreground'}`}>{new Date(c.lastOrderDate).toLocaleDateString('pt-BR')} <span className="text-xs">({c.daysSinceOrder}d)</span></span>
                                      : <span className="text-orange-600 font-medium">Nunca</span>}
                                  </td>
                                  <td className="px-4 py-2.5">
                                    <a href={`/admin/companies`} data-testid={`link-open-company-${c.id}`}
                                      className="text-xs px-2 py-1 bg-primary/10 text-primary rounded-lg font-bold hover:bg-primary/20 transition-colors">
                                      Abrir Cadastro
                                    </a>
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* ── Inactive Products Detail ── */}
                  {auditDetailPanel === 'inactiveProducts' && details.inactiveProducts.length > 0 && (
                    <div className="bg-muted/20 rounded-2xl border border-border/50 overflow-hidden">
                      <div className="px-4 py-3 border-b border-border/50 bg-muted/30">
                        <p className="font-bold text-sm">Produtos Inativos ({details.inactiveProducts.length})</p>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead><tr className="text-xs text-muted-foreground bg-muted/10 border-b border-border/50">
                            <th className="text-left px-4 py-2">Produto</th>
                            <th className="text-left px-4 py-2">Categoria</th>
                            <th className="text-left px-4 py-2">Preço Base</th>
                            <th className="text-left px-4 py-2">Ações</th>
                          </tr></thead>
                          <tbody className="divide-y divide-border/40">
                            {details.inactiveProducts.map(p => (
                              <tr key={p.id} className="hover:bg-muted/20" data-testid={`audit-inactive-product-${p.id}`}>
                                <td className="px-4 py-2.5 font-medium">{p.name}</td>
                                <td className="px-4 py-2.5 text-muted-foreground">{p.category || '—'}</td>
                                <td className="px-4 py-2.5 text-muted-foreground">{p.basePrice ? `R$ ${Number(p.basePrice).toFixed(2)}` : '—'}</td>
                                <td className="px-4 py-2.5">
                                  <a href="/admin/products" data-testid={`link-edit-product-${p.id}`}
                                    className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded-lg font-bold hover:bg-blue-200 transition-colors">
                                    Editar / Reativar
                                  </a>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* ── Login Fails Detail ── */}
                  {auditDetailPanel === 'loginFails' && details.loginFails.length > 0 && (
                    <div className="bg-muted/20 rounded-2xl border border-border/50 overflow-hidden">
                      <div className="px-4 py-3 border-b border-border/50 bg-muted/30">
                        <p className="font-bold text-sm">Tentativas de Login Falhas ({details.loginFails.length})</p>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead><tr className="text-xs text-muted-foreground bg-muted/10 border-b border-border/50">
                            <th className="text-left px-4 py-2">E-mail</th>
                            <th className="text-left px-4 py-2">Data/Hora</th>
                            <th className="text-left px-4 py-2">IP</th>
                            <th className="text-left px-4 py-2">Descrição</th>
                          </tr></thead>
                          <tbody className="divide-y divide-border/40">
                            {details.loginFails.map(l => (
                              <tr key={l.id} className="hover:bg-muted/20" data-testid={`audit-login-fail-${l.id}`}>
                                <td className="px-4 py-2.5 font-medium text-red-700">{l.email}</td>
                                <td className="px-4 py-2.5 text-muted-foreground text-xs">{formatDate(l.createdAt)}</td>
                                <td className="px-4 py-2.5 font-mono text-xs">{l.ip || '—'}</td>
                                <td className="px-4 py-2.5 text-muted-foreground text-xs truncate max-w-xs">{l.description || '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* ── System Errors Detail ── */}
                  {auditDetailPanel === 'systemErrors' && details.systemErrors.length > 0 && (
                    <div className="bg-muted/20 rounded-2xl border border-border/50 overflow-hidden">
                      <div className="px-4 py-3 border-b border-border/50 bg-muted/30">
                        <p className="font-bold text-sm">Erros do Sistema ({details.systemErrors.length})</p>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead><tr className="text-xs text-muted-foreground bg-muted/10 border-b border-border/50">
                            <th className="text-left px-4 py-2">Ação</th>
                            <th className="text-left px-4 py-2">Descrição</th>
                            <th className="text-left px-4 py-2">Data/Hora</th>
                            <th className="text-left px-4 py-2">Usuário</th>
                          </tr></thead>
                          <tbody className="divide-y divide-border/40">
                            {details.systemErrors.map(e => (
                              <tr key={e.id} className="hover:bg-muted/20" data-testid={`audit-error-${e.id}`}>
                                <td className="px-4 py-2.5 font-mono text-xs font-bold text-red-700">{e.action}</td>
                                <td className="px-4 py-2.5 text-muted-foreground text-xs truncate max-w-xs">{e.description || '—'}</td>
                                <td className="px-4 py-2.5 text-muted-foreground text-xs">{formatDate(e.createdAt)}</td>
                                <td className="px-4 py-2.5 text-muted-foreground text-xs">{e.userEmail || '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Tab: AI Bug Detector */}
      {activeTab === 'ai' && (() => {
        const allBugTypes = Array.from(new Set(aiBugs.map(b => b.type)));
        const filteredBugs = aiBugs.filter(b => bugTypeFilter === 'ALL' || b.type === bugTypeFilter);
        const statusColors: Record<string, string> = { aberto: 'bg-red-100 text-red-700', analisando: 'bg-orange-100 text-orange-700', resolvido: 'bg-green-100 text-green-700' };
        return (
          <div className="space-y-4">
            <div className="bg-card rounded-2xl border border-border/50 p-6 premium-shadow">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-2xl bg-purple-100 flex items-center justify-center">
                  <Zap className="w-6 h-6 text-purple-600" />
                </div>
                <div>
                  <h3 className="font-bold text-foreground text-lg">Detector de Bugs com IA</h3>
                  <p className="text-sm text-muted-foreground">Análise dos logs para detectar padrões suspeitos e sugerir correções.</p>
                </div>
              </div>
              <div className="flex gap-2 mb-4 flex-wrap">
                <button onClick={() => queryClient.invalidateQueries({ queryKey: ['/api/admin/logs'] })} data-testid="button-detect-bugs"
                  className="flex items-center gap-2 px-5 py-2.5 bg-purple-600 text-white font-bold rounded-xl hover:bg-purple-700 transition-colors">
                  <Bug className="w-4 h-4" /> Detectar Bugs
                </button>
                <button onClick={() => queryClient.invalidateQueries({ queryKey: ['/api/admin/logs'] })} data-testid="button-suggest-fix"
                  className="flex items-center gap-2 px-5 py-2.5 border-2 border-purple-300 text-purple-700 font-bold rounded-xl hover:bg-purple-50 transition-colors">
                  <Wrench className="w-4 h-4" /> Atualizar Análise
                </button>
                {aiBugs.length > 0 && (
                  <button data-testid="button-export-bugs"
                    onClick={() => {
                      const lines = ['Relatório de Bugs — VivaFrutaz', `Gerado em: ${new Date().toLocaleString('pt-BR')}`, '', ...aiBugs.map((b, i) => `[${b.priority}] ${b.type}\nStatus: ${bugStatusMap[b.type] || 'aberto'}\nDescrição: ${b.description}\nSugestão: ${b.suggestion}\n`)];
                      const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
                      const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `bugs-${new Date().toISOString().slice(0,10)}.txt`; a.click(); URL.revokeObjectURL(url);
                    }}
                    className="flex items-center gap-2 px-5 py-2.5 border-2 border-border rounded-xl text-sm font-bold hover:bg-muted transition-colors">
                    <Download className="w-4 h-4" /> Exportar Relatório
                  </button>
                )}
              </div>

              {aiBugs.length > 0 && (
                <div className="flex items-center gap-2 mb-4 flex-wrap">
                  <span className="text-xs font-bold text-muted-foreground">Filtrar por tipo:</span>
                  <button onClick={() => setBugTypeFilter('ALL')}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors ${bugTypeFilter === 'ALL' ? 'bg-purple-600 text-white' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}>
                    Todos ({aiBugs.length})
                  </button>
                  {allBugTypes.map(t => (
                    <button key={t} onClick={() => setBugTypeFilter(t)}
                      className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors ${bugTypeFilter === t ? 'bg-purple-600 text-white' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}>
                      {t.split('—')[0].trim()}
                    </button>
                  ))}
                </div>
              )}

              {isLoading ? (
                <div className="p-8 text-center text-muted-foreground">Analisando logs...</div>
              ) : filteredBugs.length === 0 ? (
                <div className="p-8 text-center">
                  <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
                  <p className="font-bold text-green-700 text-lg">Nenhum bug detectado!</p>
                  <p className="text-sm text-muted-foreground mt-1">Análise dos logs não encontrou padrões suspeitos.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-sm font-bold text-muted-foreground">{filteredBugs.length} problema(s) {bugTypeFilter !== 'ALL' ? 'filtrado(s)' : 'detectado(s)'}:</p>
                  {filteredBugs.map((bug, i) => {
                    const colors: Record<string, string> = { HIGH: 'border-red-200 bg-red-50', MEDIUM: 'border-orange-200 bg-orange-50', LOW: 'border-blue-200 bg-blue-50' };
                    const badges: Record<string, string> = { HIGH: 'bg-red-100 text-red-700', MEDIUM: 'bg-orange-100 text-orange-700', LOW: 'bg-blue-100 text-blue-700' };
                    const bugStatus = bugStatusMap[bug.type] || 'aberto';
                    return (
                      <div key={i} className={`rounded-xl border p-5 ${colors[bug.priority]}`} data-testid={`bug-card-${i}`}>
                        <div className="flex items-center gap-3 mb-2 flex-wrap">
                          <Bug className="w-5 h-5 text-foreground/60" />
                          <span className="font-bold text-foreground">{bug.type}</span>
                          <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${badges[bug.priority]}`}>
                            {bug.priority === 'HIGH' ? 'Alta Prioridade' : bug.priority === 'MEDIUM' ? 'Média Prioridade' : 'Baixa Prioridade'}
                          </span>
                          <div className="ml-auto flex gap-1">
                            {(['aberto', 'analisando', 'resolvido'] as const).map(s => (
                              <button key={s} data-testid={`bug-status-${i}-${s}`}
                                onClick={() => setBugStatusMap(prev => ({ ...prev, [bug.type]: s }))}
                                className={`px-2 py-0.5 rounded text-xs font-bold transition-colors ${bugStatus === s ? statusColors[s] : 'bg-white/60 text-muted-foreground hover:bg-white'}`}>
                                {s === 'aberto' ? 'Aberto' : s === 'analisando' ? 'Analisando' : 'Resolvido'}
                              </button>
                            ))}
                          </div>
                        </div>
                        <p className="text-sm text-foreground mb-3">{bug.description}</p>
                        <div className="flex items-start gap-2 bg-white/70 rounded-lg p-3">
                          <Wrench className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                          <p className="text-sm text-green-800 font-medium">{bug.suggestion}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Error History Table */}
            <div className="bg-card rounded-2xl border border-border/50 overflow-hidden">
              <div className="px-5 py-4 border-b border-border/50 bg-muted/20 flex items-center justify-between">
                <h3 className="font-bold text-sm">Histórico de Erros do Sistema</h3>
                <span className="text-xs text-muted-foreground">{(logs || []).filter((l: any) => l.level === 'ERROR').length} erros registrados</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-xs text-muted-foreground bg-muted/10 border-b border-border/50">
                    <th className="text-left px-4 py-2">Ação</th>
                    <th className="text-left px-4 py-2">Descrição</th>
                    <th className="text-left px-4 py-2">Data/Hora</th>
                    <th className="text-left px-4 py-2">Usuário</th>
                  </tr></thead>
                  <tbody className="divide-y divide-border/40">
                    {(logs || []).filter((l: any) => l.level === 'ERROR').slice(0, 20).map((l: any) => (
                      <tr key={l.id} className="hover:bg-muted/10" data-testid={`error-row-${l.id}`}>
                        <td className="px-4 py-2 font-mono text-xs font-bold text-red-700">{l.action}</td>
                        <td className="px-4 py-2 text-muted-foreground text-xs truncate max-w-xs">{l.description || '—'}</td>
                        <td className="px-4 py-2 text-muted-foreground text-xs">{formatDate(l.createdAt)}</td>
                        <td className="px-4 py-2 text-muted-foreground text-xs">{l.userEmail || '—'}</td>
                      </tr>
                    ))}
                    {(logs || []).filter((l: any) => l.level === 'ERROR').length === 0 && (
                      <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground text-sm">Nenhum erro registrado.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Tab: Health */}
      {activeTab === 'health' && <HealthTab />}

      {/* Tab: Sincronização Global */}
      {activeTab === 'sync' && (
        <div className="space-y-6">
          <div className="bg-card rounded-2xl border border-border/50 p-6 premium-shadow">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-2xl bg-blue-100 flex items-center justify-center">
                <RefreshCw className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <h3 className="font-bold text-foreground text-lg">Sincronização Global do Sistema</h3>
                <p className="text-sm text-muted-foreground">
                  Verifica permissões, perfis, empresas, produtos e pedidos. Detecta inconsistências e corrige automaticamente quando possível.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
              {[
                { icon: '👤', label: 'Usuários & Perfis', desc: 'Verifica roles e senhas de todos os usuários do sistema.' },
                { icon: '🏢', label: 'Empresas Clientes', desc: 'Verifica grupos de preço e credenciais de todas as empresas.' },
                { icon: '🍎', label: 'Produtos & Preços', desc: 'Verifica preços base e disponibilidade do catálogo.' },
                { icon: '📦', label: 'Pedidos & Códigos VF', desc: 'Verifica integridade dos pedidos e status.' },
                { icon: '📋', label: 'Logs & Erros', desc: 'Analisa taxa de erros e tentativas suspeitas de acesso.' },
                { icon: '🔐', label: 'Permissões de Acesso', desc: 'Valida que ADMIN, DIRECTOR e DEVELOPER têm acesso total.' },
              ].map(item => (
                <div key={item.label} className="flex items-start gap-3 p-3 rounded-xl bg-muted/30 border border-border/40">
                  <span className="text-xl">{item.icon}</span>
                  <div>
                    <p className="font-bold text-sm text-foreground">{item.label}</p>
                    <p className="text-xs text-muted-foreground">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
              data-testid="button-run-sync"
              className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white font-bold rounded-xl hover:-translate-y-0.5 transition-all disabled:opacity-50 shadow-lg shadow-blue-600/20"
            >
              <RefreshCw className={`w-4 h-4 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
              {syncMutation.isPending ? 'Sincronizando sistema...' : 'Sincronizar Sistema Agora'}
            </button>

            {syncMutation.data && (
              <div className="mt-6 space-y-4">
                <div className={`flex items-center gap-3 p-4 rounded-xl border-2 font-bold ${
                  syncMutation.data.overall === 'OK' ? 'border-green-300 bg-green-50 text-green-700'
                  : syncMutation.data.overall === 'WARN' ? 'border-orange-300 bg-orange-50 text-orange-700'
                  : 'border-red-300 bg-red-50 text-red-700'
                }`}>
                  {syncMutation.data.overall === 'OK'
                    ? <CheckCircle className="w-6 h-6" />
                    : syncMutation.data.overall === 'WARN'
                    ? <AlertTriangle className="w-6 h-6" />
                    : <AlertCircle className="w-6 h-6" />
                  }
                  <div>
                    <p>
                      Sistema: {syncMutation.data.overall === 'OK' ? 'SINCRONIZADO — Nenhum problema encontrado' : syncMutation.data.overall === 'WARN' ? 'SINCRONIZADO COM AVISOS — Verifique os itens abaixo' : 'ERROS DETECTADOS — Ação necessária'}
                    </p>
                    <p className="text-sm font-normal opacity-80">
                      {syncMutation.data.checks.filter((c: any) => c.status === 'OK').length} verificações OK ·{' '}
                      {syncMutation.data.checks.filter((c: any) => c.status === 'WARN').length} avisos ·{' '}
                      {syncMutation.data.checks.filter((c: any) => c.status === 'ERROR').length} erros ·{' '}
                      {syncMutation.data.autoFixed} item(ns) corrigido(s) automaticamente
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  {syncMutation.data.checks.map((check: any) => {
                    const statusStyles = {
                      OK: { bg: 'border-green-200 bg-green-50', icon: <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />, label: 'text-green-700' },
                      WARN: { bg: 'border-orange-200 bg-orange-50', icon: <AlertTriangle className="w-5 h-5 text-orange-500 flex-shrink-0" />, label: 'text-orange-700' },
                      ERROR: { bg: 'border-red-200 bg-red-50', icon: <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />, label: 'text-red-700' },
                      FIXED: { bg: 'border-blue-200 bg-blue-50', icon: <CheckCircle className="w-5 h-5 text-blue-600 flex-shrink-0" />, label: 'text-blue-700' },
                    };
                    const s = statusStyles[check.status as keyof typeof statusStyles] || statusStyles.OK;
                    return (
                      <div key={check.id} className={`flex items-start gap-3 p-4 rounded-xl border ${s.bg}`}>
                        {s.icon}
                        <div className="flex-1 min-w-0">
                          <p className={`font-bold text-sm ${s.label}`}>{check.label}</p>
                          <p className="text-xs text-muted-foreground mt-0.5 break-words">{check.detail}</p>
                        </div>
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${
                          check.status === 'OK' ? 'bg-green-100 text-green-700'
                          : check.status === 'WARN' ? 'bg-orange-100 text-orange-700'
                          : check.status === 'FIXED' ? 'bg-blue-100 text-blue-700'
                          : 'bg-red-100 text-red-700'
                        }`}>
                          {check.status === 'FIXED' ? 'CORRIGIDO' : check.status}
                        </span>
                      </div>
                    );
                  })}
                </div>

                <p className="text-xs text-muted-foreground">
                  Sincronização executada em {new Date(syncMutation.data.syncedAt).toLocaleString('pt-BR')}. Registro salvo nos Logs do Sistema.
                </p>
              </div>
            )}

            {!syncMutation.data && !syncMutation.isPending && (
              <div className="mt-6 text-center py-8 text-muted-foreground">
                <RefreshCw className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">Clique no botão acima para executar a sincronização global</p>
                <p className="text-xs mt-1 opacity-70">A sincronização verifica todos os usuários, empresas, produtos, pedidos e permissões do sistema.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </Layout>
  );
}
