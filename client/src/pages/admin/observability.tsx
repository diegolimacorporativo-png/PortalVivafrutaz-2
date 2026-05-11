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
  Loader2,
  RefreshCw,
  RotateCcw,
  Server,
  Skull,
  Timer,
  Trash2,
  Users,
  Zap,
} from "lucide-react";

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

interface DeadLetterEvent {
  id: number;
  orderId: number;
  eventType: string;
  retryCount: number;
  errorMessage: string | null;
  createdAt: string;
  companyId: number | null;
}

type JobStatus = "idle" | "running" | "ok" | "error";

interface JobRecord {
  name: string;
  isRunning: boolean;
  lastStarted?: number;
  lastFinished?: number;
  lastStatus: JobStatus;
  lastError?: string;
  totalRuns: number;
  totalErrors: number;
}

interface SlowJobReport {
  jobName: string;
  avgDurationMs: number | null;
  p95DurationMs: number | null;
  slowRuns: number;
  totalRuns: number;
  lastDurationMs: number | null;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  currentlyRunning: boolean;
  lastError: string | null;
  tenantId: number | null;
  correlationId: string | null;
}

interface SlowJobsMeta {
  total: number;
  slowJobsCount: number;
  runningCount: number;
  slowThresholdMs: number;
}

function formatTs(ts: number) {
  return new Date(ts).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatDate(s: string | undefined | null) {
  if (!s) return "—";
  return new Date(s).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatEpoch(ts: number | undefined) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function uptimeFmt(since: number) {
  const ms = Date.now() - since;
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h}h ${m}m`;
}

function formatMs(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}

function SlowJobHealthBadge({ job }: { job: SlowJobReport }) {
  if (job.currentlyRunning) {
    return (
      <Badge className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 gap-1">
        <Loader2 className="w-3 h-3 animate-spin" />
        Executando
      </Badge>
    );
  }
  if (job.lastError) {
    return (
      <Badge variant="destructive" className="text-xs gap-1">
        <AlertTriangle className="w-3 h-3" />
        Erro
      </Badge>
    );
  }
  if (job.slowRuns > 0) {
    return (
      <Badge className="text-xs bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 gap-1">
        <Clock className="w-3 h-3" />
        Lento
      </Badge>
    );
  }
  if (job.totalRuns === 0) {
    return <Badge variant="secondary" className="text-xs">Aguardando</Badge>;
  }
  return (
    <Badge className="text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 gap-1">
      <CheckCircle2 className="w-3 h-3" />
      Saudável
    </Badge>
  );
}

function JobStatusBadge({ status, isRunning }: { status: JobStatus; isRunning: boolean }) {
  if (isRunning) {
    return (
      <Badge className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 gap-1">
        <Loader2 className="w-3 h-3 animate-spin" />
        Executando
      </Badge>
    );
  }
  switch (status) {
    case "ok":
      return <Badge className="text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">OK</Badge>;
    case "error":
      return <Badge variant="destructive" className="text-xs">Erro</Badge>;
    case "idle":
      return <Badge variant="secondary" className="text-xs">Aguardando</Badge>;
    default:
      return <Badge variant="outline" className="text-xs">{status}</Badge>;
  }
}

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

  const deadLetterQ = useQuery<{ data: DeadLetterEvent[]; meta: { total: number } }>({
    queryKey: ["/api/admin/observability/dead-letter"],
    refetchInterval: 20000,
  });

  const jobsQ = useQuery<{ data: JobRecord[] }>({
    queryKey: ["/api/admin/observability/jobs"],
    refetchInterval: 10000,
  });

  const slowJobsQ = useQuery<{ data: SlowJobReport[]; meta: SlowJobsMeta }>({
    queryKey: ["/api/admin/observability/slow-jobs"],
    refetchInterval: 10000,
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

  const requeueMut = useMutation({
    mutationFn: (id: number) =>
      apiRequest("POST", `/api/admin/observability/dead-letter/${id}/requeue`),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/observability/dead-letter"] });
      toast({ title: `Evento #${id} re-enfileirado`, description: "O outbox worker irá reprocessar em breve." });
    },
    onError: (err: any) => {
      toast({ title: "Erro ao re-enfileirar", description: err?.message ?? "Tente novamente.", variant: "destructive" });
    },
  });

  const errors = errorsQ.data?.data ?? [];
  const meta = errorsQ.data?.meta;
  const metrics = metricsQ.data?.data;
  const deadLetterEvents = deadLetterQ.data?.data ?? [];
  const jobs = jobsQ.data?.data ?? [];
  const slowJobs = slowJobsQ.data?.data ?? [];
  const slowJobsMeta = slowJobsQ.data?.meta;

  const filtered =
    severityFilter === "ALL"
      ? errors
      : errors.filter((e) => e.severity === severityFilter);

  const topRoutesByError = metrics
    ? Object.entries(metrics.errorsByRoute)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
    : [];

  const topTenants = metrics
    ? Object.entries(metrics.requestsByTenant)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
    : [];

  const topLatency = metrics
    ? Object.entries(metrics.avgLatencyByRoute)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
    : [];

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Observabilidade Operacional</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Rastreabilidade de erros, métricas e saúde do sistema em tempo real
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          data-testid="button-refresh-observability"
          onClick={() => {
            errorsQ.refetch();
            metricsQ.refetch();
            deadLetterQ.refetch();
            jobsQ.refetch();
            slowJobsQ.refetch();
          }}
        >
          <RefreshCw className="w-4 h-4 mr-1" />
          Atualizar
        </Button>
      </div>

      {/* ── Metrics Cards ─────────────────────────────────────────────── */}
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

      {/* ── Tabs ──────────────────────────────────────────────────────── */}
      <Tabs defaultValue="errors">
        <TabsList className="mb-4">
          <TabsTrigger value="errors" data-testid="tab-errors">
            <AlertTriangle className="w-4 h-4 mr-1.5" />
            Erros &amp; Métricas
          </TabsTrigger>
          <TabsTrigger value="dead-letter" data-testid="tab-dead-letter">
            <Skull className="w-4 h-4 mr-1.5" />
            Dead Letter
            {deadLetterEvents.length > 0 && (
              <Badge variant="destructive" className="ml-1.5 text-xs h-4 px-1.5">
                {deadLetterEvents.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="jobs" data-testid="tab-jobs">
            <Activity className="w-4 h-4 mr-1.5" />
            Jobs Registrados
            {jobs.length > 0 && (
              <Badge variant="secondary" className="ml-1.5 text-xs h-4 px-1.5">
                {jobs.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="slow-jobs" data-testid="tab-slow-jobs">
            <Timer className="w-4 h-4 mr-1.5" />
            Slow Jobs
            {slowJobsMeta && slowJobsMeta.slowJobsCount > 0 && (
              <Badge className="ml-1.5 text-xs h-4 px-1.5 bg-amber-500 text-white">
                {slowJobsMeta.slowJobsCount}
              </Badge>
            )}
            {slowJobsMeta && slowJobsMeta.runningCount > 0 && (
              <Badge className="ml-1.5 text-xs h-4 px-1.5 bg-blue-500 text-white">
                {slowJobsMeta.runningCount}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── Tab 1: Erros & Métricas ────────────────────────────────── */}
        <TabsContent value="errors" className="space-y-4">
          {metrics && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-red-500" />
                    Erros por rota (top 5)
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1.5">
                  {topRoutesByError.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Sem erros registrados</p>
                  ) : (
                    topRoutesByError.map(([route, count]) => (
                      <div key={route} className="flex items-center justify-between text-xs">
                        <span className="font-mono text-muted-foreground truncate max-w-[200px]">{route}</span>
                        <Badge variant="destructive" className="ml-2 text-xs">{count}</Badge>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Users className="w-4 h-4 text-blue-500" />
                    Requests por tenant (top 5)
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1.5">
                  {topTenants.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Sem dados de tenant</p>
                  ) : (
                    topTenants.map(([tenantId, count]) => (
                      <div key={tenantId} className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Tenant #{tenantId}</span>
                        <Badge variant="secondary" className="ml-2 text-xs">{count.toLocaleString()}</Badge>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Clock className="w-4 h-4 text-amber-500" />
                    Latência média por rota (top 5)
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1.5">
                  {topLatency.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Sem dados de latência</p>
                  ) : (
                    topLatency.map(([route, avg]) => (
                      <div key={route} className="flex items-center justify-between text-xs">
                        <span className="font-mono text-muted-foreground truncate max-w-[200px]">{route}</span>
                        <Badge
                          variant={avg > 1000 ? "destructive" : avg > 500 ? "secondary" : "outline"}
                          className="ml-2 text-xs"
                        >
                          {avg}ms
                        </Badge>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-500" />
                  Erros operacionais
                  {meta && (
                    <Badge variant="secondary" className="text-xs ml-1">
                      {meta.total} no buffer
                    </Badge>
                  )}
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
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs text-red-600 border-red-200 hover:bg-red-50"
                    data-testid="button-clear-errors"
                    onClick={() => clearMut.mutate()}
                    disabled={clearMut.isPending}
                  >
                    <Trash2 className="w-3 h-3 mr-1" />
                    Limpar
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    data-testid="button-reset-metrics"
                    onClick={() => resetMetMut.mutate()}
                    disabled={resetMetMut.isPending}
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
                <div className="p-6 text-center text-sm text-muted-foreground">
                  Nenhum erro registrado
                </div>
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
                            onClick={() =>
                              setExpandedId(expandedId === err.id ? null : err.id)
                            }
                          >
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                              {formatTs(err.timestamp)}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={err.severity === "ERROR" ? "destructive" : "secondary"}
                                className="text-xs"
                              >
                                {err.severity}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs font-mono">{err.statusCode}</TableCell>
                            <TableCell className="text-xs font-mono truncate max-w-[180px]">
                              <span className="text-blue-600 dark:text-blue-400">{err.method}</span>{" "}
                              {err.endpoint}
                            </TableCell>
                            <TableCell className="text-xs truncate max-w-[220px]">{err.message}</TableCell>
                            <TableCell className="text-xs font-mono truncate max-w-[96px] text-muted-foreground">
                              {err.requestId.slice(0, 8)}…
                            </TableCell>
                            <TableCell className="text-xs">
                              {err.tenantId != null ? (
                                <Badge variant="outline" className="text-xs">#{err.tenantId}</Badge>
                              ) : (
                                <span className="text-muted-foreground/50">—</span>
                              )}
                            </TableCell>
                            <TableCell className="text-xs">
                              {err.actorId != null ? (
                                <span className="text-muted-foreground">#{err.actorId}</span>
                              ) : (
                                <span className="text-muted-foreground/50">—</span>
                              )}
                            </TableCell>
                            <TableCell className="text-xs">
                              {err.role ? (
                                <Badge variant="secondary" className="text-xs">{err.role}</Badge>
                              ) : (
                                <span className="text-muted-foreground/50">—</span>
                              )}
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

        {/* ── Tab 2: Dead Letter ─────────────────────────────────────── */}
        <TabsContent value="dead-letter">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <Skull className="w-4 h-4 text-red-600" />
                    Fila Dead Letter — Outbox
                    {deadLetterQ.data?.meta && (
                      <Badge
                        variant={deadLetterEvents.length > 0 ? "destructive" : "secondary"}
                        className="text-xs ml-1"
                      >
                        {deadLetterQ.data.meta.total} evento{deadLetterQ.data.meta.total !== 1 ? "s" : ""}
                      </Badge>
                    )}
                  </CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">
                    Eventos do outbox que excederam o limite de retentativas e aguardam intervenção manual.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  data-testid="button-refresh-dead-letter"
                  onClick={() => deadLetterQ.refetch()}
                  disabled={deadLetterQ.isFetching}
                >
                  <RefreshCw className={`w-3 h-3 mr-1 ${deadLetterQ.isFetching ? "animate-spin" : ""}`} />
                  Atualizar
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {deadLetterQ.isLoading ? (
                <div className="p-8 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Carregando eventos...
                </div>
              ) : deadLetterEvents.length === 0 ? (
                <div className="p-8 flex flex-col items-center justify-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                    <CheckCircle2 className="w-6 h-6 text-green-600 dark:text-green-400" />
                  </div>
                  <p className="text-sm font-medium text-foreground">Fila limpa</p>
                  <p className="text-xs text-muted-foreground">Nenhum evento em dead letter. Todos os eventos do outbox estão sendo processados normalmente.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs w-16">ID</TableHead>
                        <TableHead className="text-xs w-24">Pedido</TableHead>
                        <TableHead className="text-xs">Tipo de Evento</TableHead>
                        <TableHead className="text-xs w-20">Tentativas</TableHead>
                        <TableHead className="text-xs w-20">Empresa</TableHead>
                        <TableHead className="text-xs w-36">Criado em</TableHead>
                        <TableHead className="text-xs">Último Erro</TableHead>
                        <TableHead className="text-xs w-28 text-right">Ação</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {deadLetterEvents.map((ev) => (
                        <TableRow key={ev.id} data-testid={`row-dead-letter-${ev.id}`}>
                          <TableCell className="text-xs font-mono text-muted-foreground">#{ev.id}</TableCell>
                          <TableCell className="text-xs font-mono">
                            <Badge variant="outline" className="text-xs">#{ev.orderId}</Badge>
                          </TableCell>
                          <TableCell className="text-xs">
                            <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
                              {ev.eventType}
                            </code>
                          </TableCell>
                          <TableCell className="text-xs">
                            <Badge variant="destructive" className="text-xs">
                              {ev.retryCount}x
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs">
                            {ev.companyId != null ? (
                              <Badge variant="outline" className="text-xs">#{ev.companyId}</Badge>
                            ) : (
                              <span className="text-muted-foreground/50">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {formatDate(ev.createdAt)}
                          </TableCell>
                          <TableCell className="text-xs text-red-600 dark:text-red-400 max-w-[260px] truncate">
                            {ev.errorMessage ?? <span className="text-muted-foreground/50">—</span>}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs gap-1 border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-900/20"
                              data-testid={`button-requeue-${ev.id}`}
                              onClick={() => requeueMut.mutate(ev.id)}
                              disabled={requeueMut.isPending}
                            >
                              <RotateCcw className="w-3 h-3" />
                              Re-enfileirar
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Audit note */}
          <div className="mt-3 p-3 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-xl">
            <p className="text-xs text-amber-800 dark:text-amber-300 font-medium">
              Atenção MASTER
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
              Re-enfileirar um evento zera o contador de retentativas e remove o marcador dead_letter.
              O outbox worker irá reprocessar o evento na próxima janela (até 5 segundos).
              Verifique a causa do erro antes de re-enfileirar para evitar loops infinitos.
            </p>
          </div>
        </TabsContent>

        {/* ── Tab 3: Jobs Registrados ────────────────────────────────── */}
        <TabsContent value="jobs">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <Activity className="w-4 h-4 text-blue-600" />
                    Jobs em Background
                    {jobs.length > 0 && (
                      <Badge variant="secondary" className="text-xs ml-1">
                        {jobs.length} registrado{jobs.length !== 1 ? "s" : ""}
                      </Badge>
                    )}
                  </CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">
                    Estado atual de todos os workers e crons em execução no processo Node.js.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  data-testid="button-refresh-jobs"
                  onClick={() => jobsQ.refetch()}
                  disabled={jobsQ.isFetching}
                >
                  <RefreshCw className={`w-3 h-3 mr-1 ${jobsQ.isFetching ? "animate-spin" : ""}`} />
                  Atualizar
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {jobsQ.isLoading ? (
                <div className="p-8 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Carregando jobs...
                </div>
              ) : jobs.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  Nenhum job registrado ainda. Os workers se registram automaticamente ao iniciar.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Job</TableHead>
                        <TableHead className="text-xs w-28">Status</TableHead>
                        <TableHead className="text-xs w-36">Última execução</TableHead>
                        <TableHead className="text-xs w-36">Última conclusão</TableHead>
                        <TableHead className="text-xs w-20">Total runs</TableHead>
                        <TableHead className="text-xs w-20">Erros</TableHead>
                        <TableHead className="text-xs">Último erro</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {jobs.map((job) => (
                        <TableRow key={job.name} data-testid={`row-job-${job.name}`}>
                          <TableCell className="text-xs font-mono font-medium text-foreground">
                            {job.name}
                          </TableCell>
                          <TableCell>
                            <JobStatusBadge status={job.lastStatus} isRunning={job.isRunning} />
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {formatEpoch(job.lastStarted)}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {formatEpoch(job.lastFinished)}
                          </TableCell>
                          <TableCell className="text-xs font-mono">
                            {job.totalRuns.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-xs">
                            {job.totalErrors > 0 ? (
                              <Badge variant="destructive" className="text-xs">
                                {job.totalErrors}
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="text-xs">0</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-red-600 dark:text-red-400 max-w-[260px] truncate">
                            {job.lastError ?? <span className="text-muted-foreground/50">—</span>}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="mt-3 p-3 bg-muted/50 border border-border rounded-xl">
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Nota:</span> Os contadores são em memória e resetam com cada reinicialização do processo.
              O painel é atualizado automaticamente a cada 10 segundos.
            </p>
          </div>
        </TabsContent>

        {/* ── Tab 4: Slow Jobs ───────────────────────────────────────── */}
        <TabsContent value="slow-jobs" className="space-y-4">
          {/* summary strip */}
          {slowJobsMeta && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Card>
                <CardContent className="p-3 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                    <Activity className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Total de jobs</p>
                    <p className="text-xl font-bold text-foreground" data-testid="slowjobs-total">{slowJobsMeta.total}</p>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center flex-shrink-0">
                    <Timer className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Jobs lentos</p>
                    <p className="text-xl font-bold text-foreground" data-testid="slowjobs-slow-count">{slowJobsMeta.slowJobsCount}</p>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                    <Loader2 className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Executando agora</p>
                    <p className="text-xl font-bold text-foreground" data-testid="slowjobs-running-count">{slowJobsMeta.runningCount}</p>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center flex-shrink-0">
                    <Clock className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Limite lento</p>
                    <p className="text-xl font-bold text-foreground">{formatMs(slowJobsMeta.slowThresholdMs)}</p>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <Timer className="w-4 h-4 text-amber-600" />
                    Monitoramento de Jobs
                    {slowJobsMeta && (
                      <Badge variant="secondary" className="text-xs ml-1">
                        {slowJobsMeta.total} job{slowJobsMeta.total !== 1 ? "s" : ""}
                      </Badge>
                    )}
                  </CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">
                    Latência média, p95 e histórico de execuções lentas por worker/cron.
                    Threshold: {slowJobsMeta ? formatMs(slowJobsMeta.slowThresholdMs) : "60s"}.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  data-testid="button-refresh-slow-jobs"
                  onClick={() => slowJobsQ.refetch()}
                  disabled={slowJobsQ.isFetching}
                >
                  <RefreshCw className={`w-3 h-3 mr-1 ${slowJobsQ.isFetching ? "animate-spin" : ""}`} />
                  Atualizar
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {slowJobsQ.isLoading ? (
                <div className="p-8 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Carregando jobs...
                </div>
              ) : slowJobs.length === 0 ? (
                <div className="p-8 flex flex-col items-center justify-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                    <CheckCircle2 className="w-6 h-6 text-green-600 dark:text-green-400" />
                  </div>
                  <p className="text-sm font-medium text-foreground">Nenhum job registrado</p>
                  <p className="text-xs text-muted-foreground">Os workers se registram automaticamente ao iniciar.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Job</TableHead>
                        <TableHead className="text-xs w-28">Saúde</TableHead>
                        <TableHead className="text-xs w-24">Avg</TableHead>
                        <TableHead className="text-xs w-24">p95</TableHead>
                        <TableHead className="text-xs w-24">Última dur.</TableHead>
                        <TableHead className="text-xs w-20">Lentas</TableHead>
                        <TableHead className="text-xs w-20">Total runs</TableHead>
                        <TableHead className="text-xs w-36">Iniciado em</TableHead>
                        <TableHead className="text-xs w-36">Concluído em</TableHead>
                        <TableHead className="text-xs">Último erro</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {slowJobs.map((job) => (
                        <TableRow
                          key={job.jobName}
                          data-testid={`row-slow-job-${job.jobName}`}
                          className={job.currentlyRunning ? "bg-blue-50/40 dark:bg-blue-900/10" : job.lastError ? "bg-red-50/40 dark:bg-red-900/10" : job.slowRuns > 0 ? "bg-amber-50/40 dark:bg-amber-900/10" : ""}
                        >
                          <TableCell className="text-xs font-mono font-medium text-foreground">
                            {job.jobName}
                          </TableCell>
                          <TableCell>
                            <SlowJobHealthBadge job={job} />
                          </TableCell>
                          <TableCell className="text-xs font-mono">
                            {job.avgDurationMs !== null ? (
                              <span className={job.avgDurationMs > 60000 ? "text-amber-600 dark:text-amber-400 font-semibold" : ""}>
                                {formatMs(job.avgDurationMs)}
                              </span>
                            ) : (
                              <span className="text-muted-foreground/50">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs font-mono">
                            {job.p95DurationMs !== null ? (
                              <span className={job.p95DurationMs > 60000 ? "text-red-600 dark:text-red-400 font-semibold" : ""}>
                                {formatMs(job.p95DurationMs)}
                              </span>
                            ) : (
                              <span className="text-muted-foreground/50">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs font-mono">
                            {job.lastDurationMs !== null ? formatMs(job.lastDurationMs) : <span className="text-muted-foreground/50">—</span>}
                          </TableCell>
                          <TableCell className="text-xs">
                            {job.slowRuns > 0 ? (
                              <Badge className="text-xs bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                                {job.slowRuns}
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="text-xs">0</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-xs font-mono">
                            {job.totalRuns.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {formatDate(job.lastStartedAt)}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {formatDate(job.lastFinishedAt)}
                          </TableCell>
                          <TableCell className="text-xs text-red-600 dark:text-red-400 max-w-[220px] truncate">
                            {job.lastError ?? <span className="text-muted-foreground/50">—</span>}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="mt-3 p-3 bg-muted/50 border border-border rounded-xl">
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Nota:</span> Jobs classificados como lentos
              quando excedem {slowJobsMeta ? formatMs(slowJobsMeta.slowThresholdMs) : "60s"} por execução.
              Avg e p95 são calculados sobre as últimas 100 execuções (janela deslizante).
              Painel atualiza automaticamente a cada 10 segundos.
            </p>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
