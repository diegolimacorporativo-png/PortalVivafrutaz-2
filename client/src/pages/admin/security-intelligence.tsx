import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ShieldAlert,
  RefreshCw,
  Clock,
  AlertTriangle,
  ShieldCheck,
  Activity,
  Zap,
} from "lucide-react";

interface IPScore {
  ip: string;
  score: number;
  level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  spike: boolean;
  breakdown: {
    RATE_LIMITED?: number;
    HIGH_RISK_ACTION?: number;
    CRITICAL_ACTION?: number;
    SUSPICIOUS_PATTERN?: number;
    [key: string]: number | undefined;
  };
}

interface SecurityAnalysisData {
  ips: IPScore[];
  generatedAt: string;
  total: number;
  spike?: {
    detected: boolean;
    count?: number;
  };
}

interface ApiResponse {
  success: boolean;
  data: SecurityAnalysisData;
}

const LEVEL_CONFIG: Record<
  string,
  { label: string; className: string; badgeVariant: "destructive" | "secondary" | "default" | "outline" }
> = {
  LOW: {
    label: "BAIXO",
    className: "bg-gray-100 border-gray-200 text-gray-700 dark:bg-gray-800/40 dark:text-gray-300",
    badgeVariant: "outline",
  },
  MEDIUM: {
    label: "MÉDIO",
    className: "bg-yellow-100 border-yellow-200 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400",
    badgeVariant: "secondary",
  },
  HIGH: {
    label: "ALTO",
    className: "bg-orange-100 border-orange-200 text-orange-800 dark:bg-orange-900/20 dark:text-orange-400",
    badgeVariant: "default",
  },
  CRITICAL: {
    label: "CRÍTICO",
    className: "bg-red-100 border-red-200 text-red-800 dark:bg-red-900/20 dark:text-red-400",
    badgeVariant: "destructive",
  },
};

function LevelBadge({ level }: { level: string }) {
  const config = LEVEL_CONFIG[level] ?? LEVEL_CONFIG["LOW"];
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${config.className}`}
      data-testid={`badge-level-${level}`}
    >
      {config.label}
    </span>
  );
}

function ScoreBar({ score }: { score: number }) {
  const capped = Math.min(score, 300);
  const pct = Math.round((capped / 300) * 100);
  const color =
    score >= 200
      ? "bg-red-500"
      : score >= 100
        ? "bg-orange-500"
        : score >= 50
          ? "bg-yellow-500"
          : "bg-gray-300";

  return (
    <div className="flex items-center gap-2" data-testid="score-bar">
      <div className="w-20 h-2 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-sm font-mono font-semibold tabular-nums">{score}</span>
    </div>
  );
}

function SummaryCards({ data }: { data: SecurityAnalysisData }) {
  const criticals = data.ips.filter((ip) => ip.level === "CRITICAL").length;
  const highs = data.ips.filter((ip) => ip.level === "HIGH").length;
  const spikes = data.ips.filter((ip) => ip.spike).length;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
      <Card>
        <CardContent className="pt-5 pb-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">IPs Monitorados</p>
              <p className="text-2xl font-bold" data-testid="stat-total">{data.total}</p>
            </div>
            <Activity className="w-5 h-5 text-muted-foreground" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-5 pb-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Nível Crítico</p>
              <p className="text-2xl font-bold text-red-600" data-testid="stat-critical">{criticals}</p>
            </div>
            <ShieldAlert className="w-5 h-5 text-red-500" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-5 pb-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Nível Alto</p>
              <p className="text-2xl font-bold text-orange-600" data-testid="stat-high">{highs}</p>
            </div>
            <AlertTriangle className="w-5 h-5 text-orange-500" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-5 pb-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Spikes Ativos</p>
              <p className="text-2xl font-bold text-red-600" data-testid="stat-spikes">{spikes}</p>
            </div>
            <Zap className="w-5 h-5 text-red-500" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Skeleton className="w-10 h-10 rounded-xl" />
        <div className="space-y-1.5">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-3.5 w-72" />
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-xl" />
    </div>
  );
}

export default function SecurityIntelligencePage() {
  const { data: response, isLoading, isFetching, refetch, dataUpdatedAt } =
    useQuery<ApiResponse>({
      queryKey: ["/api/admin/security/analysis"],
      refetchInterval: 30_000,
    });

  const data = response?.data;
  const ips = data?.ips ?? [];

  if (isLoading) return <LoadingSkeleton />;

  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : null;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
            <ShieldAlert className="w-5 h-5 text-red-600 dark:text-red-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground" data-testid="page-title">
              Security Intelligence
            </h1>
            <p className="text-sm text-muted-foreground">
              Score antifraude por IP · Detecção de spikes · Análise em tempo real
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="text-last-updated">
              <Clock className="w-3.5 h-3.5" />
              Atualizado às {lastUpdated}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            data-testid="button-refresh"
          >
            <RefreshCw className={`w-4 h-4 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />
            Atualizar agora
          </Button>
        </div>
      </div>

      {data && <SummaryCards data={data} />}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-muted-foreground" />
            Score Antifraude por IP
            <span className="text-xs font-normal text-muted-foreground ml-1">
              — atualização automática a cada 30s
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {ips.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center py-16 text-center"
              data-testid="empty-state"
            >
              <ShieldCheck className="w-12 h-12 text-green-500 mb-3" />
              <p className="text-lg font-semibold text-foreground">
                Nenhuma atividade suspeita detectada
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                Todos os acessos estão dentro dos parâmetros normais.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table data-testid="table-security">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-40">IP</TableHead>
                    <TableHead className="w-36">Score</TableHead>
                    <TableHead className="w-28">Nível</TableHead>
                    <TableHead className="w-36">Spike</TableHead>
                    <TableHead className="text-right">Rate Limited</TableHead>
                    <TableHead className="text-right">High Risk</TableHead>
                    <TableHead className="text-right">Critical</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ips.map((ip) => (
                    <TableRow
                      key={ip.ip}
                      data-testid={`row-ip-${ip.ip}`}
                      className={ip.level === "CRITICAL" ? "bg-red-50/50 dark:bg-red-900/10" : ""}
                    >
                      <TableCell>
                        <code
                          className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded"
                          data-testid={`text-ip-${ip.ip}`}
                        >
                          {ip.ip}
                        </code>
                      </TableCell>

                      <TableCell>
                        <ScoreBar score={ip.score} />
                      </TableCell>

                      <TableCell>
                        <LevelBadge level={ip.level} />
                      </TableCell>

                      <TableCell>
                        {ip.spike ? (
                          <span
                            className="inline-flex items-center gap-1.5 text-red-600 font-bold text-sm"
                            data-testid={`spike-active-${ip.ip}`}
                          >
                            <Zap className="w-4 h-4" />
                            SPIKE ATIVO
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground" data-testid={`spike-none-${ip.ip}`}>
                            —
                          </span>
                        )}
                      </TableCell>

                      <TableCell className="text-right tabular-nums" data-testid={`cell-rate-limited-${ip.ip}`}>
                        {ip.breakdown.RATE_LIMITED ?? 0}
                      </TableCell>

                      <TableCell className="text-right tabular-nums" data-testid={`cell-high-risk-${ip.ip}`}>
                        {ip.breakdown.HIGH_RISK_ACTION ?? 0}
                      </TableCell>

                      <TableCell className="text-right tabular-nums font-semibold" data-testid={`cell-critical-${ip.ip}`}>
                        <span className={ip.breakdown.CRITICAL_ACTION ? "text-red-600" : ""}>
                          {ip.breakdown.CRITICAL_ACTION ?? 0}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {ips.length > 0 && (
        <p className="text-xs text-muted-foreground text-right" data-testid="text-generated-at">
          Análise gerada em:{" "}
          {data?.generatedAt
            ? new Date(data.generatedAt).toLocaleString("pt-BR")
            : "—"}
        </p>
      )}
    </div>
  );
}
