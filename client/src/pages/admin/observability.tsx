import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clock,
  Database,
  FileText,
  HardDrive,
  Lock,
  RefreshCw,
  Server,
  ShieldCheck,
  ShieldX,
  Trash2,
  Users,
  Zap,
  XCircle,
  Loader2,
  MailWarning,
  TrendingUp,
  Circle,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────

interface ErrorEntry {
  id: string;
  requestId: string;
  endpoint: string;
  method: string;
  statusCode: number;
  severity: "ERROR" | "WARN";
  message: string;
  stack?: string;
  tenantId?: number | null;
  actorId?: number;
  role?: string;
  ip?: string;
  timestamp: number;
}

interface Metrics {
  totalRequests: number;
  totalErrors: number;
  nfeFailures: number;
  jobFailures: number;
  errorsByRoute: Record<string, number>;
  requestsByTenant: Record<string, number>;
  avgLatencyByRoute: Record<string, number>;
  uptimeSince: number;
}

interface JobRecord {
  name: string;
  isRunning: boolean;
  lastStarted?: number;
  lastFinished?: number;
  lastStatus: "idle" | "running" | "ok" | "error";
  lastError?: string;
  totalRuns: number;
  totalErrors: number;
}

interface DeadLetterRow {
  id: number;
  orderId: number;
  eventType: string;
  retryCount: number;
  deadLetter: boolean;
  errorMessage?: string;
  createdAt: string;
  nextRetryAt?: string;
}

interface DbHealth {
  connections: { active_connections: string; idle_connections: string; total_connections: string };
  storage: { db_size: string; db_size_bytes: string };
  locks: { total_locks: string; waiting_locks: string };
  topTables: Array<{ table_name: string; live_rows: string; dead_rows: string; total_size: string }>;
  slowQueries: Array<{ pid: number; duration: string; state: string; queryPreview: string }>;
  pool: { totalCount: number | null; idleCount: number | null; waitingCount: number | null };
  checkedAt: string;
}

type FiscalEventKind =
  | "emission_start" | "emission_ok" | "emission_rejected" | "emission_error"
  | "cancel_ok" | "cancel_error" | "cce_ok" | "cce_error"
  | "cert_ok" | "cert_warning" | "cert_expired"
  | "xml_guard_fail" | "circuit_open" | "circuit_closed"
  | "sefaz_timeout" | "sefaz_down";

interface FiscalEvent {
  id: number;
  kind: FiscalEventKind;
  ts: number;
  requestId?: string;
  orderId?: number;
  chaveNFe?: string;
  tenantId?: number;
  uf?: string;
  ambiente?: "producao" | "homologacao";
  cStat?: string;
  xMotivo?: string;
  durationMs?: number;
  certDaysLeft?: number;
  errorMessage?: string;
}

interface FiscalCounters {
  emissionsTotal: number;
  emissionsOk: number;
  emissionsRejected: number;
  emissionsError: number;
  cancelsOk: number;
  cancelsError: number;
  cceOk: number;
  cceError: number;
  sefazTimeouts: number;
  sefazDownEvents: number;
  certWarnings: number;
  certExpiredBlocks: number;
  xmlGuardBlocks: number;
  circuitOpenings: number;
}

interface FiscalSnapshot {
  counters: FiscalCounters;
  summary: {
    lastEmissionAt?: number;
    lastAuthAt?: number;
    lastRejectionAt?: number;
    lastSefazTimeoutAt?: number;
    avgEmissionMs: number | null;
  };
  recentEvents: FiscalEvent[];
  since: string;
  circuit: {
    state: "closed" | "open" | "half-open";
    failures: number;
    isOpen: boolean;
    openedAt: number | null;
    totalOpenings: number;
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatTs(ts: number) {
  return new Date(ts).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function formatDate(d: string | number | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function uptimeFmt(since: number) {
  const ms = Date.now() - since;
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h}h ${m}m`;
}

function jobStatusBadge(status: JobRecord["lastStatus"], isRunning: boolean) {
  if (isRunning) return <Badge className="text-xs bg-blue-500 text-white">Running</Badge>;
  if (status === "ok") return <Badge className="text-xs bg-green-600 text-white">OK</Badge>;
  if (status === "error") return <Badge variant="destructive" className="text-xs">Error</Badge>;
  return <Badge variant="outline" className="text-xs text-muted-foreground">Idle</Badge>;
}

const FISCAL_KIND_META: Record<FiscalEventKind, { label: string; color: string }> = {
  emission_start:    { label: "Emissão iniciada",  color: "text-blue-600" },
  emission_ok:       { label: "Autorizada",         color: "text-green-600" },
  emission_rejected: { label: "Rejeitada",          color: "text-orange-600" },
  emission_error:    { label: "Erro de emissão",    color: "text-red-600" },
  cancel_ok:         { label: "Cancelamento OK",    color: "text-green-600" },
  cancel_error:      { label: "Erro cancelamento",  color: "text-red-600" },
  cce_ok:            { label: "CC-e OK",            color: "text-green-600" },
  cce_error:         { label: "Erro CC-e",          color: "text-red-600" },
  cert_ok:           { label: "Certificado OK",     color: "text-green-600" },
  cert_warning:      { label: "Cert expirando",     color: "text-amber-600" },
  cert_expired:      { label: "Cert expirado",      color: "text-red-600" },
  xml_guard_fail:    { label: "XML inválido",        color: "text-red-600" },
  circuit_open:      { label: "Circuito aberto",    color: "text-red-700" },
  circuit_closed:    { label: "Circuito fechado",   color: "text-green-600" },
  sefaz_timeout:     { label: "Timeout SEFAZ",      color: "text-orange-600" },
  sefaz_down:        { label: "SEFAZ indisponível", color: "text-red-700" },
};

function circuitBadge(state: "closed" | "open" | "half-open") {
  if (state === "closed")
    return <Badge className="text-xs bg-green-600 text-white flex items-center gap-1"><Circle className="w-2 h-2 fill-white" />Fechado</Badge>;
  if (state === "open")
    return <Badge variant="destructive" className="text-xs flex items-center gap-1"><Circle className="w-2 h-2 fill-white" />Aberto</Badge>;
  return <Badge className="text-xs bg-amber-500 text-white flex items-center gap-1"><Circle className="w-2 h-2 fill-white" />Half-open</Badge>;
}

// ── Main Component ─────────────────────────────────────────────────────────

export default function AdminObservability() {
  const { toast } = useToast();
  const [severityFilter, setSeverityFilter] = useState<string>("ALL");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const errorsQ = useQuery<{ data: ErrorEntry[]; meta: { total: number } }>({
    queryKey: ["/api/admin/observability/errors"],
    refetchInterval: 30000,
  });
  const metricsQ = useQuery<{ data: Metrics }>({
    queryKey: ["/api/admin/observability/metrics"],
    refetchInterval: 15000,
  });
  const jobsQ = useQuery<{ data: JobRecord[]; meta: { total: number; running: number; withErrors: number } }>({
    queryKey: ["/api/admin/observability/jobs"],
    refetchInterval: 10000,
  });
  const deadLettersQ = useQuery<{
    data: { deadLetters: DeadLetterRow[]; stuckEvents: DeadLetterRow[] };
    meta: { deadLetterCount: number; stuckCount: number };
  }>({
    queryKey: ["/api/admin/observability/dead-letters"],
    refetchInterval: 30000,
  });
  const dbHealthQ = useQuery<{ data: DbHealth }>({
    queryKey: ["/api/admin/observability/db-health"],
    refetchInterval: 60000,
  });
  const fiscalQ = useQuery<{ data: FiscalSnapshot }>({
    queryKey: ["/api/admin/observability/fiscal"],
    refetchInterval: 15000,
  });

  const clearMut = useMutation({
    mutationFn: () => apiRequest("DELETE", "/api/admin/observability/errors"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/observability/errors"] });
      toast({ title: "Error store limpo com sucesso" });
    },
  });
  const resetMetMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/observability/metrics/reset"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/observability/metrics"] });
      toast({ title: "Métricas resetadas com sucesso" });
    },
  });
  const resetFiscalMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/observability/fiscal/reset"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/observability/fiscal"] });
      toast({ title: "Store fiscal resetado" });
    },
  });

  const errors = errorsQ.data?.data ?? [];
  const meta = errorsQ.data?.meta;
  const metrics = metricsQ.data?.data;
  const jobs = jobsQ.data?.data ?? [];
  const jobsMeta = jobsQ.data?.meta;
  const deadLetters = deadLettersQ.data?.data?.deadLetters ?? [];
  const stuckEvents = deadLettersQ.data?.data?.stuckEvents ?? [];
  const dbHealth = dbHealthQ.data?.data;
  const fiscal = fiscalQ.data?.data;

  const filtered = severityFilter === "ALL" ? errors : errors.filter((e) => e.severity === severityFilter);

  const topRoutesByError = metrics
    ? Object.entries(metrics.errorsByRoute).sort((a, b) => b[1] - a[1]).slice(0, 5)
    : [];
  const topTenants = metrics
    ? Object.entries(metrics.requestsByTenant).sort((a, b) => b[1] - a[1]).slice(0, 5)
    : [];
  const topLatency = metrics
    ? Object.entries(metrics.avgLatencyByRoute).sort((a, b) => b[1] - a[1]).slice(0, 5)
    : [];

  const fiscalAlerts = fiscal
    ? (fiscal.circuit.isOpen ? 1 : 0) +
      (fiscal.counters.certExpiredBlocks > 0 ? 1 : 0) +
      (fiscal.counters.sefazDownEvents > 0 ? 1 : 0)
    : 0;

  function refreshAll() {
    errorsQ.refetch();
    metricsQ.refetch();
    jobsQ.refetch();
    deadLettersQ.refetch();
    dbHealthQ.refetch();
    fiscalQ.refetch();
  }

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Observabilidade Operacional</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Rastreabilidade de erros, métricas, jobs e saúde do sistema em tempo real
          </p>
        </div>
        <Button variant="outline" size="sm" data-testid="button-refresh-observability" onClick={refreshAll}>
          <RefreshCw className="w-4 h-4 mr-1" />Atualizar
        </Button>
      </div>

      {/* ── Metrics Cards ─────────────────────────────────────────── */}
      {metrics && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                <Activity className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Requests totais</p>
                <p className="text-2xl font-bold text-foreground" data-testid="metric-total-requests">
                  {metrics.totalRequests.toLocaleString()}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Erros totais</p>
                <p className="text-2xl font-bold text-foreground" data-testid="metric-total-errors">
                  {metrics.totalErrors.toLocaleString()}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center">
                <Zap className="w-5 h-5 text-orange-600 dark:text-orange-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Falhas NF-e</p>
                <p className="text-2xl font-bold text-foreground" data-testid="metric-nfe-failures">
                  {metrics.nfeFailures.toLocaleString()}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                <Server className="w-5 h-5 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Uptime</p>
                <p className="text-xl font-bold text-foreground" data-testid="metric-uptime">
                  {uptimeFmt(metrics.uptimeSince)}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Tabs ─────────────────────────────────────────────────── */}
      <Tabs defaultValue="errors">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="errors" data-testid="tab-errors">
            Erros
            {meta && meta.total > 0 && (
              <Badge variant="destructive" className="ml-1.5 text-xs px-1.5">{meta.total}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="metrics" data-testid="tab-metrics">Métricas</TabsTrigger>
          <TabsTrigger value="jobs" data-testid="tab-jobs">
            Jobs
            {jobsMeta && jobsMeta.withErrors > 0 && (
              <Badge variant="destructive" className="ml-1.5 text-xs px-1.5">{jobsMeta.withErrors}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="dead-letters" data-testid="tab-dead-letters">
            Dead-Letters
            {(deadLetters.length + stuckEvents.length) > 0 && (
              <Badge variant="destructive" className="ml-1.5 text-xs px-1.5">
                {deadLetters.length + stuckEvents.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="db-health" data-testid="tab-db-health">DB Health</TabsTrigger>
          <TabsTrigger value="fiscal" data-testid="tab-fiscal">
            Fiscal NF-e
            {fiscalAlerts > 0 && (
              <Badge variant="destructive" className="ml-1.5 text-xs px-1.5">{fiscalAlerts}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── Errors Tab ─────────────────────────────────────────── */}
        <TabsContent value="errors" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-500" />
                  Erros operacionais
                  {meta && <Badge variant="secondary" className="text-xs ml-1">{meta.total} no buffer</Badge>}
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Select value={severityFilter} onValueChange={setSeverityFilter}>
                    <SelectTrigger className="h-8 w-32 text-xs" data-testid="select-severity-filter">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">Todos</SelectItem>
                      <SelectItem value="ERROR">ERROR</SelectItem>
                      <SelectItem value="WARN">WARN</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline" size="sm" className="h-8 text-xs text-red-600 border-red-200 hover:bg-red-50"
                    data-testid="button-clear-errors"
                    onClick={() => clearMut.mutate()} disabled={clearMut.isPending}
                  >
                    <Trash2 className="w-3 h-3 mr-1" />Limpar
                  </Button>
                  <Button
                    variant="outline" size="sm" className="h-8 text-xs"
                    data-testid="button-reset-metrics"
                    onClick={() => resetMetMut.mutate()} disabled={resetMetMut.isPending}
                  >
                    Resetar métricas
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {errorsQ.isLoading ? (
                <div className="p-6 text-center text-sm text-muted-foreground">Carregando...</div>
              ) : filtered.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">Nenhum erro registrado</div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs w-28">Timestamp</TableHead>
                        <TableHead className="text-xs w-20">Severity</TableHead>
                        <TableHead className="text-xs w-16">Status</TableHead>
                        <TableHead className="text-xs">Endpoint</TableHead>
                        <TableHead className="text-xs">Mensagem</TableHead>
                        <TableHead className="text-xs w-24">RequestId</TableHead>
                        <TableHead className="text-xs w-20">Tenant</TableHead>
                        <TableHead className="text-xs w-20">Actor</TableHead>
                        <TableHead className="text-xs w-20">Role</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.map((err) => (
                        <>
                          <TableRow
                            key={err.id}
                            className="cursor-pointer hover:bg-muted/50"
                            data-testid={`row-error-${err.id}`}
                            onClick={() => setExpandedId(expandedId === err.id ? null : err.id)}
                          >
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatTs(err.timestamp)}</TableCell>
                            <TableCell>
                              <Badge variant={err.severity === "ERROR" ? "destructive" : "secondary"} className="text-xs">
                                {err.severity}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs font-mono">{err.statusCode}</TableCell>
                            <TableCell className="text-xs font-mono truncate max-w-[180px]">
                              <span className="text-blue-600 dark:text-blue-400">{err.method}</span> {err.endpoint}
                            </TableCell>
                            <TableCell className="text-xs truncate max-w-[220px]">{err.message}</TableCell>
                            <TableCell className="text-xs font-mono truncate max-w-[96px] text-muted-foreground">
                              {err.requestId.slice(0, 8)}…
                            </TableCell>
                            <TableCell className="text-xs">
                              {err.tenantId != null
                                ? <Badge variant="outline" className="text-xs">#{err.tenantId}</Badge>
                                : <span className="text-muted-foreground/50">—</span>}
                            </TableCell>
                            <TableCell className="text-xs">
                              {err.actorId != null
                                ? <span className="text-muted-foreground">#{err.actorId}</span>
                                : <span className="text-muted-foreground/50">—</span>}
                            </TableCell>
                            <TableCell className="text-xs">
                              {err.role
                                ? <Badge variant="secondary" className="text-xs">{err.role}</Badge>
                                : <span className="text-muted-foreground/50">—</span>}
                            </TableCell>
                          </TableRow>
                          {expandedId === err.id && err.stack && (
                            <TableRow key={`${err.id}-stack`}>
                              <TableCell colSpan={9} className="bg-muted/30 p-0">
                                <div className="p-3">
                                  <p className="text-xs font-semibold text-muted-foreground mb-1">
                                    RequestId: {err.requestId} · IP: {err.ip ?? "—"}
                                  </p>
                                  <pre className="text-xs font-mono text-red-700 dark:text-red-400 whitespace-pre-wrap break-all leading-relaxed max-h-48 overflow-y-auto">
                                    {err.stack}
                                  </pre>
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Metrics Tab ────────────────────────────────────────── */}
        <TabsContent value="metrics" className="mt-4">
          {metrics && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-red-500" />Erros por rota (top 5)
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1.5">
                  {topRoutesByError.length === 0
                    ? <p className="text-xs text-muted-foreground">Sem erros registrados</p>
                    : topRoutesByError.map(([route, count]) => (
                      <div key={route} className="flex items-center justify-between text-xs">
                        <span className="font-mono text-muted-foreground truncate max-w-[200px]">{route}</span>
                        <Badge variant="destructive" className="ml-2 text-xs">{count}</Badge>
                      </div>
                    ))}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Users className="w-4 h-4 text-blue-500" />Requests por tenant (top 5)
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1.5">
                  {topTenants.length === 0
                    ? <p className="text-xs text-muted-foreground">Sem dados de tenant</p>
                    : topTenants.map(([tenantId, count]) => (
                      <div key={tenantId} className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Tenant #{tenantId}</span>
                        <Badge variant="secondary" className="ml-2 text-xs">{count.toLocaleString()}</Badge>
                      </div>
                    ))}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Clock className="w-4 h-4 text-amber-500" />Latência média por rota (top 5)
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1.5">
                  {topLatency.length === 0
                    ? <p className="text-xs text-muted-foreground">Sem dados de latência</p>
                    : topLatency.map(([route, avg]) => (
                      <div key={route} className="flex items-center justify-between text-xs">
                        <span className="font-mono text-muted-foreground truncate max-w-[200px]">{route}</span>
                        <Badge
                          variant={avg > 1000 ? "destructive" : avg > 500 ? "secondary" : "outline"}
                          className="ml-2 text-xs"
                        >
                          {avg}ms
                        </Badge>
                      </div>
                    ))}
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        {/* ── Jobs Tab ─────────────────────────────────────────────── */}
        <TabsContent value="jobs" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Activity className="w-4 h-4 text-blue-500" />
                  Registro de Jobs
                  {jobsMeta && (
                    <div className="flex gap-1.5 ml-1">
                      <Badge variant="secondary" className="text-xs">{jobsMeta.total} jobs</Badge>
                      {jobsMeta.running > 0 && <Badge className="text-xs bg-blue-500 text-white">{jobsMeta.running} running</Badge>}
                      {jobsMeta.withErrors > 0 && <Badge variant="destructive" className="text-xs">{jobsMeta.withErrors} com erros</Badge>}
                    </div>
                  )}
                </CardTitle>
                <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => jobsQ.refetch()} data-testid="button-refresh-jobs">
                  <RefreshCw className="w-3 h-3 mr-1" />Atualizar
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {jobsQ.isLoading ? (
                <div className="p-6 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />Carregando jobs...
                </div>
              ) : jobs.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  Nenhum job registrado ainda (registros aparecem após a primeira execução)
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Job</TableHead>
                        <TableHead className="text-xs w-28">Status</TableHead>
                        <TableHead className="text-xs w-36">Última execução</TableHead>
                        <TableHead className="text-xs w-36">Concluído em</TableHead>
                        <TableHead className="text-xs w-20 text-center">Total runs</TableHead>
                        <TableHead className="text-xs w-20 text-center">Erros</TableHead>
                        <TableHead className="text-xs">Último erro</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {jobs.map((job) => (
                        <TableRow key={job.name} data-testid={`row-job-${job.name}`}>
                          <TableCell className="text-xs font-mono font-semibold">{job.name}</TableCell>
                          <TableCell>{jobStatusBadge(job.lastStatus, job.isRunning)}</TableCell>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {job.lastStarted ? formatDate(job.lastStarted) : "—"}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {job.lastFinished ? formatDate(job.lastFinished) : "—"}
                          </TableCell>
                          <TableCell className="text-xs text-center">{job.totalRuns}</TableCell>
                          <TableCell className="text-xs text-center">
                            {job.totalErrors > 0
                              ? <span className="text-red-600 font-semibold">{job.totalErrors}</span>
                              : <span className="text-muted-foreground">0</span>}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground truncate max-w-[260px]">
                            {job.lastError ?? "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Dead-Letters Tab ─────────────────────────────────────── */}
        <TabsContent value="dead-letters" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <MailWarning className="w-4 h-4 text-red-500" />
                Dead-Letters (outbox)
                {deadLettersQ.data?.meta && (
                  <Badge variant="destructive" className="text-xs ml-1">{deadLettersQ.data.meta.deadLetterCount}</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {deadLettersQ.isLoading ? (
                <div className="p-6 text-center text-sm text-muted-foreground">Carregando...</div>
              ) : deadLetters.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-500" />Sem eventos em dead-letter
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs w-16">ID</TableHead>
                        <TableHead className="text-xs w-20">Pedido</TableHead>
                        <TableHead className="text-xs w-28">Tipo</TableHead>
                        <TableHead className="text-xs w-16 text-center">Retries</TableHead>
                        <TableHead className="text-xs w-36">Criado em</TableHead>
                        <TableHead className="text-xs">Último erro</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {deadLetters.map((row) => (
                        <TableRow key={row.id} data-testid={`row-dead-letter-${row.id}`}>
                          <TableCell className="text-xs font-mono">{row.id}</TableCell>
                          <TableCell className="text-xs">#{row.orderId}</TableCell>
                          <TableCell className="text-xs font-mono">{row.eventType}</TableCell>
                          <TableCell className="text-xs text-center">
                            <Badge variant="destructive" className="text-xs">{row.retryCount}</Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {formatDate(row.createdAt)}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground truncate max-w-[260px]">
                            {row.errorMessage ?? "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
          {stuckEvents.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <XCircle className="w-4 h-4 text-amber-500" />
                  Eventos travados (retryCount &gt; 2, não processados)
                  <Badge variant="secondary" className="text-xs ml-1">{stuckEvents.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs w-16">ID</TableHead>
                        <TableHead className="text-xs w-20">Pedido</TableHead>
                        <TableHead className="text-xs w-16 text-center">Retries</TableHead>
                        <TableHead className="text-xs w-36">Criado em</TableHead>
                        <TableHead className="text-xs w-36">Próx. retry</TableHead>
                        <TableHead className="text-xs">Último erro</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {stuckEvents.map((row) => (
                        <TableRow key={row.id} data-testid={`row-stuck-${row.id}`}>
                          <TableCell className="text-xs font-mono">{row.id}</TableCell>
                          <TableCell className="text-xs">#{row.orderId}</TableCell>
                          <TableCell className="text-xs text-center">
                            <Badge variant="secondary" className="text-xs">{row.retryCount}</Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {formatDate(row.createdAt)}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {row.nextRetryAt ? formatDate(row.nextRetryAt) : "—"}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground truncate max-w-[260px]">
                            {row.errorMessage ?? "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── DB Health Tab ─────────────────────────────────────────── */}
        <TabsContent value="db-health" className="mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {dbHealth ? `Atualizado: ${formatDate(dbHealth.checkedAt)}` : ""}
            </p>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => dbHealthQ.refetch()} data-testid="button-refresh-db-health">
              <RefreshCw className="w-3 h-3 mr-1" />Atualizar
            </Button>
          </div>
          {dbHealthQ.isLoading ? (
            <div className="p-6 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />Consultando banco de dados...
            </div>
          ) : dbHealth ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card>
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                      <Database className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Tamanho do DB</p>
                      <p className="text-xl font-bold text-foreground" data-testid="db-size">{dbHealth.storage.db_size}</p>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                      <Activity className="w-5 h-5 text-green-600 dark:text-green-400" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Conexões ativas</p>
                      <p className="text-xl font-bold text-foreground" data-testid="db-active-conn">
                        {dbHealth.connections.active_connections}
                        <span className="text-sm text-muted-foreground font-normal ml-1">
                          / {dbHealth.connections.total_connections} total
                        </span>
                      </p>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                      <Lock className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Locks</p>
                      <p className="text-xl font-bold text-foreground" data-testid="db-locks">
                        {dbHealth.locks.total_locks}
                        {Number(dbHealth.locks.waiting_locks) > 0 && (
                          <span className="text-sm text-red-500 font-semibold ml-1">({dbHealth.locks.waiting_locks} wait)</span>
                        )}
                      </p>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                      <HardDrive className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Pool (idle / total)</p>
                      <p className="text-xl font-bold text-foreground" data-testid="db-pool">
                        {dbHealth.pool.idleCount ?? "—"} / {dbHealth.pool.totalCount ?? "—"}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </div>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-blue-500" />Top tabelas por linhas
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Tabela</TableHead>
                          <TableHead className="text-xs text-right w-28">Linhas vivas</TableHead>
                          <TableHead className="text-xs text-right w-28">Linhas mortas</TableHead>
                          <TableHead className="text-xs text-right w-24">Tamanho</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {dbHealth.topTables.map((t) => (
                          <TableRow key={t.table_name} data-testid={`row-table-${t.table_name}`}>
                            <TableCell className="text-xs font-mono">{t.table_name}</TableCell>
                            <TableCell className="text-xs text-right">{Number(t.live_rows).toLocaleString()}</TableCell>
                            <TableCell className="text-xs text-right">
                              {Number(t.dead_rows) > 0
                                ? <span className="text-amber-600">{Number(t.dead_rows).toLocaleString()}</span>
                                : <span className="text-muted-foreground">0</span>}
                            </TableCell>
                            <TableCell className="text-xs text-right text-muted-foreground">{t.total_size}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
              {dbHealth.slowQueries.length > 0 ? (
                <Card className="border-amber-200 dark:border-amber-800">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2 text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="w-4 h-4" />
                      Queries lentas (&gt;5s) — {dbHealth.slowQueries.length} ativa(s)
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {dbHealth.slowQueries.map((q) => (
                      <div key={q.pid} className="text-xs space-y-0.5 border rounded p-2 bg-amber-50 dark:bg-amber-900/20">
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <span>PID {q.pid}</span>
                          <Badge variant="outline" className="text-xs">{q.state}</Badge>
                          <span className="text-amber-600 font-medium">{String(q.duration).split('.')[0]}</span>
                        </div>
                        <pre className="font-mono text-xs text-foreground whitespace-pre-wrap break-all">{q.queryPreview}</pre>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardContent className="p-4 flex items-center gap-2 text-sm text-green-700 dark:text-green-400">
                    <CheckCircle2 className="w-4 h-4" />Sem queries lentas no momento
                  </CardContent>
                </Card>
              )}
            </>
          ) : (
            <div className="p-6 text-center text-sm text-muted-foreground">Erro ao carregar dados de saúde do banco</div>
          )}
        </TabsContent>

        {/* ── Fiscal NF-e Tab ── FASE NF-e 1.2 T1205 ───────────────── */}
        <TabsContent value="fiscal" className="mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {fiscal ? `Desde: ${formatDate(fiscal.since)}` : ""}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => fiscalQ.refetch()} data-testid="button-refresh-fiscal">
                <RefreshCw className="w-3 h-3 mr-1" />Atualizar
              </Button>
              <Button
                variant="outline" size="sm" className="h-8 text-xs text-red-600 border-red-200 hover:bg-red-50"
                data-testid="button-reset-fiscal"
                onClick={() => resetFiscalMut.mutate()} disabled={resetFiscalMut.isPending}
              >
                <Trash2 className="w-3 h-3 mr-1" />Resetar
              </Button>
            </div>
          </div>

          {fiscalQ.isLoading ? (
            <div className="p-6 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />Carregando dados fiscais...
            </div>
          ) : fiscal ? (
            <>
              {/* Circuit breaker alert */}
              {fiscal.circuit.isOpen && (
                <Card className="border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20">
                  <CardContent className="p-4 flex items-center gap-3">
                    <ShieldX className="w-5 h-5 text-red-600 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-red-700 dark:text-red-400">Circuit Breaker ABERTO</p>
                      <p className="text-xs text-red-600 dark:text-red-400">
                        SEFAZ bloqueada após {fiscal.circuit.failures} falhas consecutivas.
                        Aberto {fiscal.circuit.openedAt ? formatDate(fiscal.circuit.openedAt) : "agora"}.
                        Auto-reset em 60s.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Cert expired alert */}
              {fiscal.counters.certExpiredBlocks > 0 && (
                <Card className="border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20">
                  <CardContent className="p-4 flex items-center gap-3">
                    <ShieldX className="w-5 h-5 text-red-600 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-red-700 dark:text-red-400">Certificado Digital Expirado</p>
                      <p className="text-xs text-red-600 dark:text-red-400">
                        {fiscal.counters.certExpiredBlocks} emissão(ões) bloqueada(s) por certificado expirado. Renove imediatamente.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Cert warning */}
              {fiscal.counters.certWarnings > 0 && fiscal.counters.certExpiredBlocks === 0 && (
                <Card className="border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20">
                  <CardContent className="p-4 flex items-center gap-3">
                    <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">Certificado Digital Próximo do Vencimento</p>
                      <p className="text-xs text-amber-600 dark:text-amber-400">
                        {fiscal.counters.certWarnings} evento(s) de alerta detectado(s). Renove em breve.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* KPI grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground mb-1">Emissões</p>
                    <div className="flex items-end gap-1">
                      <span className="text-2xl font-bold text-foreground" data-testid="fiscal-emissions-total">{fiscal.counters.emissionsTotal}</span>
                      <span className="text-xs text-muted-foreground mb-0.5">total</span>
                    </div>
                    <div className="flex gap-1.5 mt-1 flex-wrap">
                      <Badge className="text-xs bg-green-600 text-white">{fiscal.counters.emissionsOk} OK</Badge>
                      {fiscal.counters.emissionsRejected > 0 && <Badge className="text-xs bg-orange-500 text-white">{fiscal.counters.emissionsRejected} rej</Badge>}
                      {fiscal.counters.emissionsError > 0 && <Badge variant="destructive" className="text-xs">{fiscal.counters.emissionsError} err</Badge>}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground mb-1">Latência média</p>
                    <p className="text-2xl font-bold text-foreground" data-testid="fiscal-avg-latency">
                      {fiscal.summary.avgEmissionMs != null ? `${fiscal.summary.avgEmissionMs}ms` : "—"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">SOAP SEFAZ emissão</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground mb-1">Circuit Breaker</p>
                    <div className="mt-1">{circuitBadge(fiscal.circuit.state)}</div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {fiscal.circuit.totalOpenings} abertura(s) total
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground mb-1">Timeouts SEFAZ</p>
                    <p className={`text-2xl font-bold ${fiscal.counters.sefazTimeouts > 0 ? "text-orange-600" : "text-foreground"}`} data-testid="fiscal-timeouts">
                      {fiscal.counters.sefazTimeouts}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {fiscal.counters.sefazDownEvents > 0
                        ? <span className="text-red-600">{fiscal.counters.sefazDownEvents} SEFAZ down</span>
                        : "Sem eventos down"}
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* Second row */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground mb-1">Última autorização</p>
                    <p className="text-sm font-medium text-foreground">{formatDate(fiscal.summary.lastAuthAt)}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground mb-1">Última rejeição</p>
                    <p className="text-sm font-medium text-foreground">{formatDate(fiscal.summary.lastRejectionAt)}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground mb-1">Cancelamentos</p>
                    <div className="flex gap-1.5 mt-1 flex-wrap">
                      <Badge className="text-xs bg-green-600 text-white">{fiscal.counters.cancelsOk} OK</Badge>
                      {fiscal.counters.cancelsError > 0 && <Badge variant="destructive" className="text-xs">{fiscal.counters.cancelsError} err</Badge>}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground mb-1">CC-e</p>
                    <div className="flex gap-1.5 mt-1 flex-wrap">
                      <Badge className="text-xs bg-green-600 text-white">{fiscal.counters.cceOk} OK</Badge>
                      {fiscal.counters.cceError > 0 && <Badge variant="destructive" className="text-xs">{fiscal.counters.cceError} err</Badge>}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Security counters */}
              {(fiscal.counters.xmlGuardBlocks > 0 || fiscal.counters.certExpiredBlocks > 0 || fiscal.counters.certWarnings > 0) && (
                <Card className="border-amber-200 dark:border-amber-800">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2 text-amber-700 dark:text-amber-400">
                      <ShieldCheck className="w-4 h-4" />Bloqueios de segurança fiscal
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex gap-4 flex-wrap">
                    <div className="text-xs">
                      <span className="text-muted-foreground">XML Guard (bloqueados): </span>
                      <span className={fiscal.counters.xmlGuardBlocks > 0 ? "text-red-600 font-semibold" : ""}>{fiscal.counters.xmlGuardBlocks}</span>
                    </div>
                    <div className="text-xs">
                      <span className="text-muted-foreground">Cert expirado (bloqueados): </span>
                      <span className={fiscal.counters.certExpiredBlocks > 0 ? "text-red-600 font-semibold" : ""}>{fiscal.counters.certExpiredBlocks}</span>
                    </div>
                    <div className="text-xs">
                      <span className="text-muted-foreground">Alertas de cert: </span>
                      <span className={fiscal.counters.certWarnings > 0 ? "text-amber-600 font-semibold" : ""}>{fiscal.counters.certWarnings}</span>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Recent events */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <FileText className="w-4 h-4 text-blue-500" />
                    Eventos fiscais recentes
                    <Badge variant="secondary" className="text-xs ml-1">{fiscal.recentEvents.length}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {fiscal.recentEvents.length === 0 ? (
                    <div className="p-6 text-center text-sm text-muted-foreground">Nenhum evento fiscal registrado</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs w-28">Timestamp</TableHead>
                            <TableHead className="text-xs w-36">Evento</TableHead>
                            <TableHead className="text-xs w-16">UF</TableHead>
                            <TableHead className="text-xs w-20">Ambiente</TableHead>
                            <TableHead className="text-xs w-16">cStat</TableHead>
                            <TableHead className="text-xs w-24">Duração</TableHead>
                            <TableHead className="text-xs w-24">Cert dias</TableHead>
                            <TableHead className="text-xs w-28">RequestId</TableHead>
                            <TableHead className="text-xs">Motivo / Erro</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {fiscal.recentEvents.map((ev) => {
                            const meta2 = FISCAL_KIND_META[ev.kind] ?? { label: ev.kind, color: "text-muted-foreground" };
                            return (
                              <TableRow key={ev.id} data-testid={`row-fiscal-${ev.id}`}>
                                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatTs(ev.ts)}</TableCell>
                                <TableCell className={`text-xs font-medium ${meta2.color}`}>{meta2.label}</TableCell>
                                <TableCell className="text-xs">{ev.uf ?? "—"}</TableCell>
                                <TableCell className="text-xs">
                                  {ev.ambiente
                                    ? <Badge variant={ev.ambiente === "producao" ? "default" : "outline"} className="text-xs">{ev.ambiente === "producao" ? "prod" : "hom"}</Badge>
                                    : <span className="text-muted-foreground/50">—</span>}
                                </TableCell>
                                <TableCell className="text-xs font-mono">{ev.cStat ?? "—"}</TableCell>
                                <TableCell className="text-xs">
                                  {ev.durationMs != null ? `${ev.durationMs}ms` : "—"}
                                </TableCell>
                                <TableCell className="text-xs">
                                  {ev.certDaysLeft != null
                                    ? <span className={ev.certDaysLeft <= 7 ? "text-red-600 font-semibold" : ev.certDaysLeft <= 30 ? "text-amber-600" : "text-green-600"}>
                                        {ev.certDaysLeft}d
                                      </span>
                                    : "—"}
                                </TableCell>
                                <TableCell className="text-xs font-mono text-muted-foreground">
                                  {ev.requestId ? ev.requestId.slice(0, 8) + "…" : "—"}
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground truncate max-w-[200px]">
                                  {ev.xMotivo ?? ev.errorMessage ?? "—"}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          ) : (
            <div className="p-6 text-center text-sm text-muted-foreground">Erro ao carregar dados fiscais</div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
