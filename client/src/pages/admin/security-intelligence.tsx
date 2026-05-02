import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
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
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import {
  ShieldAlert,
  RefreshCw,
  Clock,
  AlertTriangle,
  ShieldCheck,
  Activity,
  Zap,
  Lock,
  FileText,
  ArrowRight,
  Database,
  TrendingUp,
  Users,
  Globe,
  CheckCircle2,
  XCircle,
} from "lucide-react";

// ── In-memory analysis types ──────────────────────────────────────────────────

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

// ── DB-backed overview types (FASE 14.8) ──────────────────────────────────────

interface HourBucket {
  hour: number;
  label: string;
  failures: number;
  successes: number;
}

interface AccountRisk {
  type: "admin" | "company";
  id: number;
  failures: number;
}

interface IPStat {
  ip: string;
  failures: number;
  targetsCount: number;
}

interface RecentActivity {
  userId: number | null;
  companyId: number | null;
  ip: string;
  endpoint: string | null;
  success: boolean;
  createdAt: string;
}

interface OverviewData {
  stats: {
    failures24h: number;
    successes24h: number;
    total24h: number;
    successRate24h: number;
    failures7d: number;
    failures30d: number;
  };
  hourlyTimeline: HourBucket[];
  topAttackerIPs: IPStat[];
  bruteForceCluster: IPStat[];
  topRiskyAccounts: AccountRisk[];
  recentActivity: RecentActivity[];
  generatedAt: string;
}

interface OverviewResponse {
  success: boolean;
  data: OverviewData;
}

// ── Shared UI components ───────────────────────────────────────────────────────

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

// ── In-memory summary cards ───────────────────────────────────────────────────

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

      <Card className={spikes > 0 ? "border-red-400 bg-red-50 dark:bg-red-900/10" : ""}>
        <CardContent className="pt-5 pb-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                Spikes Ativos
                {spikes > 0 && (
                  <span className="text-red-600 font-bold animate-pulse ml-1">
                    ⚠ {spikes} {spikes === 1 ? "ativo" : "ativos"}
                  </span>
                )}
              </p>
              <p className="text-2xl font-bold text-red-600" data-testid="stat-spikes">{spikes}</p>
            </div>
            <Zap className={`w-5 h-5 ${spikes > 0 ? "text-red-500 animate-pulse" : "text-red-500"}`} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── DB-backed stats row (FASE 14.8) ──────────────────────────────────────────

function DbStatsRow({ stats }: { stats: OverviewData["stats"] }) {
  const rateColor =
    stats.successRate24h >= 90 ? "text-green-600" :
    stats.successRate24h >= 70 ? "text-yellow-600" : "text-red-600";

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
      <Card>
        <CardContent className="pt-5 pb-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Falhas (24h)</p>
              <p
                className={`text-2xl font-bold ${stats.failures24h > 0 ? "text-red-600" : "text-foreground"}`}
                data-testid="db-stat-failures24h"
              >
                {stats.failures24h}
              </p>
            </div>
            <XCircle className={`w-5 h-5 ${stats.failures24h > 0 ? "text-red-500" : "text-muted-foreground"}`} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-5 pb-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Falhas (7d)</p>
              <p
                className={`text-2xl font-bold ${stats.failures7d > 5 ? "text-orange-600" : "text-foreground"}`}
                data-testid="db-stat-failures7d"
              >
                {stats.failures7d}
              </p>
            </div>
            <TrendingUp className="w-5 h-5 text-muted-foreground" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-5 pb-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Falhas (30d)</p>
              <p className="text-2xl font-bold" data-testid="db-stat-failures30d">
                {stats.failures30d}
              </p>
            </div>
            <Database className="w-5 h-5 text-muted-foreground" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-5 pb-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Taxa de sucesso (24h)</p>
              <p className={`text-2xl font-bold ${rateColor}`} data-testid="db-stat-success-rate">
                {stats.successRate24h}%
              </p>
            </div>
            <CheckCircle2 className={`w-5 h-5 ${rateColor}`} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

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

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SecurityIntelligencePage() {
  const [, navigate] = useLocation();

  const { data: response, isLoading, isFetching, refetch, dataUpdatedAt } =
    useQuery<ApiResponse>({
      queryKey: ["/api/admin/security/analysis"],
      refetchInterval: 30_000,
    });

  const { data: lockedAccounts = [] } = useQuery<any[]>({
    queryKey: ["/api/security/locked-accounts"],
    refetchInterval: 30_000,
  });

  const { data: securityEvents = [] } = useQuery<any[]>({
    queryKey: ["/api/admin/security/events"],
  });

  // FASE 14.8 — DB-backed risk intelligence
  const { data: overviewResponse, isLoading: loadingOverview } = useQuery<OverviewResponse>({
    queryKey: ["/api/admin/security/overview"],
    refetchInterval: 60_000,
  });

  const data = response?.data;
  const ips = data?.ips ?? [];
  const overview = overviewResponse?.data;

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

      {/* ── Header ───────────────────────────────────────────────────────── */}
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
              Score antifraude por IP · Detecção de spikes · Análise em tempo real · Histórico DB
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

      {/* ── In-memory summary cards ───────────────────────────────────────── */}
      {data && <SummaryCards data={data} />}

      {/* ── FASE 14.8 — DB-backed stats ──────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Database className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Histórico persistido (auth_attempts DB)
          </h2>
        </div>
        {loadingOverview ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
          </div>
        ) : overview ? (
          <DbStatsRow stats={overview.stats} />
        ) : null}
      </div>

      {/* ── FASE 14.8 — Hourly attack timeline ───────────────────────────── */}
      {overview && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-muted-foreground" />
              Timeline de Ataques — Últimas 24h (por hora)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {overview.stats.total24h === 0 ? (
              <div className="flex flex-col items-center py-10 text-center" data-testid="timeline-empty">
                <ShieldCheck className="w-10 h-10 text-green-500 mb-2" />
                <p className="text-sm text-muted-foreground">Nenhuma tentativa nas últimas 24h.</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={200} data-testid="chart-hourly-timeline">
                <BarChart data={overview.hourlyTimeline} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={2} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip
                    formatter={(value, name) => [
                      value,
                      name === "failures" ? "Falhas" : "Sucessos",
                    ]}
                    labelFormatter={(label) => `Hora: ${label}`}
                  />
                  <Legend formatter={(v) => v === "failures" ? "Falhas" : "Sucessos"} />
                  <Bar dataKey="failures" fill="#ef4444" radius={[2, 2, 0, 0]} name="failures" />
                  <Bar dataKey="successes" fill="#22c55e" radius={[2, 2, 0, 0]} name="successes" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Hub de Segurança — resumos + atalhos ──────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card
          data-testid="card-locked-accounts-hub"
          className={lockedAccounts.length > 0 ? "border-red-500 bg-red-50 dark:bg-red-900/10" : ""}
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-red-100 dark:bg-red-900/30">
                <Lock className="w-4 h-4 text-red-600 dark:text-red-400" />
              </div>
              Contas Bloqueadas
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-end justify-between gap-4">
            <div>
              <p
                className={`text-3xl font-bold ${lockedAccounts.length > 0 ? "text-red-600 dark:text-red-400" : "text-foreground"}`}
                data-testid="stat-locked-accounts"
              >
                {lockedAccounts.length}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {lockedAccounts.length === 0
                  ? "Nenhuma conta bloqueada"
                  : lockedAccounts.length === 1
                    ? "conta bloqueada por senha incorreta"
                    : "contas bloqueadas por senha incorreta"}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 flex-shrink-0"
              onClick={() => navigate("/admin/system-health?tab=locked")}
              data-testid="button-view-locked-accounts"
            >
              Ver detalhes
              <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </CardContent>
        </Card>

        <Card data-testid="card-security-events-hub">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                <FileText className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              </div>
              Eventos de Segurança
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-end justify-between gap-4">
            <div>
              <p className="text-3xl font-bold text-foreground" data-testid="stat-security-events">
                {Array.isArray(securityEvents) ? securityEvents.length : 0}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                eventos no buffer em memória
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 flex-shrink-0"
              onClick={() => navigate("/admin/security-audit")}
              data-testid="button-view-security-audit"
            >
              Ver logs
              <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* ── In-memory IP fraud scores ─────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-muted-foreground" />
            Score Antifraude por IP
            <span className="text-xs font-normal text-muted-foreground ml-1">
              — tempo real (memória) · atualização a cada 30s
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {ips.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center" data-testid="empty-state">
              <ShieldCheck className="w-12 h-12 text-green-500 mb-3" />
              <p className="text-lg font-semibold text-foreground">Nenhuma atividade suspeita detectada</p>
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
                      className={
                        ip.level === "CRITICAL"
                          ? "bg-red-50 dark:bg-red-900/10 border-l-4 border-l-red-600"
                          : ip.level === "HIGH"
                            ? "bg-orange-50 dark:bg-orange-900/10 border-l-4 border-l-orange-500"
                            : ""
                      }
                    >
                      <TableCell>
                        <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded" data-testid={`text-ip-${ip.ip}`}>
                          {ip.ip}
                        </code>
                      </TableCell>
                      <TableCell>
                        <div className={ip.level === "CRITICAL" ? "scale-105 origin-left" : ""}>
                          <ScoreBar score={ip.score} />
                        </div>
                      </TableCell>
                      <TableCell><LevelBadge level={ip.level} /></TableCell>
                      <TableCell>
                        {ip.spike ? (
                          <span className="inline-flex items-center gap-1.5 text-red-600 font-bold text-sm animate-pulse" data-testid={`spike-active-${ip.ip}`}>
                            <Zap className="w-4 h-4" />
                            ⚡ SPIKE ATIVO
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground" data-testid={`spike-none-${ip.ip}`}>—</span>
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

      {/* ── FASE 14.8 — Top attacker IPs from DB ─────────────────────────── */}
      {overview && overview.topAttackerIPs.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Globe className="w-4 h-4 text-muted-foreground" />
              Top IPs Atacantes — DB (últimos 7d)
              <span className="text-xs font-normal text-muted-foreground ml-1">
                persistido em auth_attempts
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table data-testid="table-db-top-ips">
                <TableHeader>
                  <TableRow>
                    <TableHead>IP</TableHead>
                    <TableHead className="text-right">Falhas (7d)</TableHead>
                    <TableHead className="text-right">Contas distintas</TableHead>
                    <TableHead className="w-32">Risco</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {overview.topAttackerIPs.map((ip) => {
                    const level = ip.targetsCount >= 3 ? "CRITICAL" : ip.failures >= 10 ? "HIGH" : ip.failures >= 5 ? "MEDIUM" : "LOW";
                    return (
                      <TableRow
                        key={ip.ip}
                        data-testid={`row-db-ip-${ip.ip}`}
                        className={level === "CRITICAL" ? "bg-red-50 dark:bg-red-900/10 border-l-4 border-l-red-600" : level === "HIGH" ? "bg-orange-50 dark:bg-orange-900/10 border-l-4 border-l-orange-500" : ""}
                      >
                        <TableCell>
                          <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">
                            {ip.ip}
                          </code>
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-semibold" data-testid={`text-db-ip-failures-${ip.ip}`}>
                          <span className={ip.failures >= 5 ? "text-red-600" : ""}>{ip.failures}</span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums" data-testid={`text-db-ip-targets-${ip.ip}`}>
                          {ip.targetsCount}
                        </TableCell>
                        <TableCell>
                          <LevelBadge level={level} />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── FASE 14.8 — Brute force clusters ─────────────────────────────── */}
      {overview && overview.bruteForceCluster.length > 0 && (
        <Card className="border-red-400 bg-red-50 dark:bg-red-900/10">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2 text-red-700 dark:text-red-400">
              <Zap className="w-4 h-4 animate-pulse" />
              Clusters de Brute Force — IPs atacando múltiplas contas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table data-testid="table-brute-force-clusters">
                <TableHeader>
                  <TableRow>
                    <TableHead>IP</TableHead>
                    <TableHead className="text-right">Falhas (7d)</TableHead>
                    <TableHead className="text-right">Contas visadas</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {overview.bruteForceCluster.map((cluster) => (
                    <TableRow key={cluster.ip} data-testid={`row-cluster-${cluster.ip}`} className="border-l-4 border-l-red-600">
                      <TableCell>
                        <code className="text-xs font-mono bg-red-100 dark:bg-red-900/30 px-1.5 py-0.5 rounded text-red-700 dark:text-red-300">
                          {cluster.ip}
                        </code>
                      </TableCell>
                      <TableCell className="text-right font-bold text-red-600 tabular-nums" data-testid={`text-cluster-failures-${cluster.ip}`}>
                        {cluster.failures}
                      </TableCell>
                      <TableCell className="text-right font-bold text-red-600 tabular-nums" data-testid={`text-cluster-targets-${cluster.ip}`}>
                        {cluster.targetsCount}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── FASE 14.8 — Top risky accounts ───────────────────────────────── */}
      {overview && overview.topRiskyAccounts.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="w-4 h-4 text-muted-foreground" />
              Contas com Maior Risco — DB (últimos 7d)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table data-testid="table-risky-accounts">
                <TableHeader>
                  <TableRow>
                    <TableHead>Tipo</TableHead>
                    <TableHead>ID</TableHead>
                    <TableHead className="text-right">Falhas (7d)</TableHead>
                    <TableHead className="w-32">Risco</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {overview.topRiskyAccounts.map((account) => {
                    const level = account.failures >= 10 ? "CRITICAL" : account.failures >= 5 ? "HIGH" : account.failures >= 3 ? "MEDIUM" : "LOW";
                    return (
                      <TableRow
                        key={`${account.type}-${account.id}`}
                        data-testid={`row-risky-${account.type}-${account.id}`}
                        className={level === "CRITICAL" ? "bg-red-50 dark:bg-red-900/10 border-l-4 border-l-red-600" : ""}
                      >
                        <TableCell>
                          <Badge variant={account.type === "admin" ? "default" : "secondary"} data-testid={`badge-account-type-${account.id}`}>
                            {account.type === "admin" ? "Interno" : "Empresa"}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-sm" data-testid={`text-account-id-${account.id}`}>
                          {account.id}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-semibold" data-testid={`text-account-failures-${account.id}`}>
                          <span className={account.failures >= 5 ? "text-red-600" : ""}>{account.failures}</span>
                        </TableCell>
                        <TableCell>
                          <LevelBadge level={level} />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── FASE 14.8 — Recent activity feed ─────────────────────────────── */}
      {overview && overview.recentActivity.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="w-4 h-4 text-muted-foreground" />
              Atividade Recente — Últimas {overview.recentActivity.length} tentativas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table data-testid="table-recent-activity">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">Status</TableHead>
                    <TableHead>IP</TableHead>
                    <TableHead>Conta</TableHead>
                    <TableHead>Endpoint</TableHead>
                    <TableHead className="w-44">Data/Hora</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {overview.recentActivity.map((row, idx) => (
                    <TableRow
                      key={idx}
                      data-testid={`row-activity-${idx}`}
                      className={!row.success ? "bg-red-50/50 dark:bg-red-900/5" : ""}
                    >
                      <TableCell>
                        {row.success ? (
                          <span className="inline-flex items-center gap-1 text-green-600 text-xs font-semibold">
                            <CheckCircle2 className="w-3.5 h-3.5" /> OK
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-red-600 text-xs font-semibold">
                            <XCircle className="w-3.5 h-3.5" /> FALHOU
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">{row.ip}</code>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {row.userId ? `user:${row.userId}` : row.companyId ? `company:${row.companyId}` : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground font-mono">
                        {row.endpoint ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(row.createdAt).toLocaleString("pt-BR")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {ips.length > 0 && (
        <p className="text-xs text-muted-foreground text-right" data-testid="text-generated-at">
          Análise em memória gerada em:{" "}
          {data?.generatedAt ? new Date(data.generatedAt).toLocaleString("pt-BR") : "—"}
          {overview && (
            <> · DB overview: {new Date(overview.generatedAt).toLocaleString("pt-BR")}</>
          )}
        </p>
      )}
    </div>
  );
}
