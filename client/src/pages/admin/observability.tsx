import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  Clock,
  RefreshCw,
  Server,
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

function formatTs(ts: number) {
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

  const errors = errorsQ.data?.data ?? [];
  const meta = errorsQ.data?.meta;
  const metrics = metricsQ.data?.data;

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

      {/* ── Breakdown cards ───────────────────────────────────────────── */}
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

      {/* ── Error Store Table ─────────────────────────────────────────── */}
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
              <Select
                value={severityFilter}
                onValueChange={setSeverityFilter}
              >
                <SelectTrigger
                  className="h-8 w-32 text-xs"
                  data-testid="select-severity-filter"
                >
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
    </div>
  );
}
