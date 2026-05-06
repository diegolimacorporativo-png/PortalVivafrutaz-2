import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  Activity,
  AlertTriangle,
  Lock,
  TrendingUp,
  Eye,
  Brain,
  Clock,
  Users,
  Zap,
  ExternalLink,
} from "lucide-react";

interface SecurityOverview {
  stats: {
    failures24h: number;
    successes24h: number;
    total24h: number;
    successRate24h: number;
    failures7d: number;
    failures30d: number;
  };
  topAttackerIPs: Array<{ ip: string; failures: number; targetsCount: number }>;
  anomalies: Array<{ type: string; severity: string; description: string }>;
  recentActivity: Array<{ createdAt: string; action: string; ip?: string; userEmail?: string; level?: string }>;
  generatedAt: string;
}

interface AlertsData {
  data: Array<{ type: string; message: string; severity: string; timestamp: string }>;
  total: number;
}

interface SecurityEventsData {
  events: Array<{ type: string; ip: string; path: string; timestamp: string }>;
  total: number;
  topIPs: Array<[string, number]>;
}

function severityBadge(severity: string) {
  const map: Record<string, string> = {
    CRITICAL: "bg-red-100 text-red-700 border-red-200",
    HIGH: "bg-orange-100 text-orange-700 border-orange-200",
    MEDIUM: "bg-yellow-100 text-yellow-700 border-yellow-200",
    LOW: "bg-blue-100 text-blue-700 border-blue-200",
    ALERT: "bg-red-100 text-red-700 border-red-200",
    WARN: "bg-yellow-100 text-yellow-700 border-yellow-200",
    INFO: "bg-green-100 text-green-700 border-green-200",
  };
  return map[severity?.toUpperCase()] ?? "bg-gray-100 text-gray-700 border-gray-200";
}

export default function SecurityDashboard() {
  const { data: overview, isLoading: loadingOverview } = useQuery<{ success: boolean; data: SecurityOverview }>({
    queryKey: ["/api/admin/security/overview"],
    staleTime: 30000,
    refetchInterval: 60000,
  });

  const { data: alerts, isLoading: loadingAlerts } = useQuery<AlertsData>({
    queryKey: ["/api/admin/security/alerts"],
    staleTime: 15000,
    refetchInterval: 30000,
  });

  const { data: events } = useQuery<SecurityEventsData>({
    queryKey: ["/api/admin/security/events"],
    staleTime: 15000,
    refetchInterval: 30000,
  });

  const stats = overview?.data?.stats;
  const anomalies = overview?.data?.anomalies ?? [];
  const topIPs = overview?.data?.topAttackerIPs ?? [];
  const activeAlerts = alerts?.data ?? [];
  const criticalAlerts = activeAlerts.filter((a) => a.severity === "CRITICAL" || a.severity === "HIGH");
  const successRate = stats ? Math.round(stats.successRate24h ?? 0) : 0;

  const systemStatus =
    criticalAlerts.length > 0
      ? { label: "ATENÇÃO", color: "text-orange-600 bg-orange-50 border-orange-200", icon: ShieldAlert }
      : anomalies.length > 0
        ? { label: "MONITORANDO", color: "text-yellow-600 bg-yellow-50 border-yellow-200", icon: Activity }
        : { label: "SEGURO", color: "text-green-700 bg-green-50 border-green-200", icon: ShieldCheck };

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center">
            <Shield className="w-5 h-5 text-green-700" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Central de Segurança</h1>
            <p className="text-sm text-muted-foreground">
              Monitoramento unificado • Atualizado às {overview?.data?.generatedAt ? new Date(overview.data.generatedAt).toLocaleTimeString("pt-BR") : "—"}
            </p>
          </div>
        </div>
        <div className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-semibold ${systemStatus.color}`}>
          <systemStatus.icon className="w-4 h-4" />
          {systemStatus.label}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border">
          <CardContent className="pt-5">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted-foreground">Logins (24h)</span>
              <Users className="w-4 h-4 text-green-600" />
            </div>
            <p className="text-2xl font-bold text-foreground" data-testid="kpi-total-24h">
              {loadingOverview ? "—" : (stats?.total24h ?? 0)}
            </p>
            <p className="text-xs text-green-600 mt-1">{successRate}% sucesso</p>
          </CardContent>
        </Card>

        <Card className="border">
          <CardContent className="pt-5">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted-foreground">Falhas (24h)</span>
              <Lock className="w-4 h-4 text-red-500" />
            </div>
            <p className="text-2xl font-bold text-foreground" data-testid="kpi-failures-24h">
              {loadingOverview ? "—" : (stats?.failures24h ?? 0)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">{stats?.failures7d ?? 0} em 7 dias</p>
          </CardContent>
        </Card>

        <Card className="border">
          <CardContent className="pt-5">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted-foreground">Alertas ativos</span>
              <Zap className="w-4 h-4 text-orange-500" />
            </div>
            <p className="text-2xl font-bold text-foreground" data-testid="kpi-alerts">
              {loadingAlerts ? "—" : (alerts?.total ?? 0)}
            </p>
            <p className="text-xs text-red-600 mt-1">{criticalAlerts.length} críticos/altos</p>
          </CardContent>
        </Card>

        <Card className="border">
          <CardContent className="pt-5">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted-foreground">Anomalias</span>
              <TrendingUp className="w-4 h-4 text-yellow-500" />
            </div>
            <p className="text-2xl font-bold text-foreground" data-testid="kpi-anomalies">
              {loadingOverview ? "—" : anomalies.length}
            </p>
            <p className="text-xs text-muted-foreground mt-1">detectadas</p>
          </CardContent>
        </Card>
      </div>

      {/* Alertas + IPs suspeitos */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* Alertas recentes */}
        <Card className="border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-orange-500" />
              Alertas recentes
            </CardTitle>
          </CardHeader>
          <CardContent>
            {activeAlerts.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Nenhum alerta ativo</p>
            ) : (
              <div className="space-y-2 max-h-52 overflow-y-auto">
                {activeAlerts.slice(0, 8).map((alert, i) => (
                  <div key={i} className="flex items-start gap-2 py-1.5 border-b last:border-0" data-testid={`alert-item-${i}`}>
                    <Badge className={`text-xs border ${severityBadge(alert.severity)} shrink-0 mt-0.5`}>
                      {alert.severity}
                    </Badge>
                    <p className="text-xs text-foreground leading-snug">{alert.message}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* IPs com mais tentativas */}
        <Card className="border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Eye className="w-4 h-4 text-red-500" />
              IPs com mais falhas
            </CardTitle>
          </CardHeader>
          <CardContent>
            {topIPs.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Nenhum IP suspeito</p>
            ) : (
              <div className="space-y-2">
                {topIPs.slice(0, 6).map((ip, i) => (
                  <div key={i} className="flex items-center justify-between py-1.5 border-b last:border-0" data-testid={`attacker-ip-${i}`}>
                    <span className="text-xs font-mono text-foreground">{ip.ip}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{ip.targetsCount} alvos</span>
                      <Badge className="text-xs bg-red-50 text-red-700 border border-red-200">{ip.failures} falhas</Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Atividade recente */}
      <Card className="border">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Clock className="w-4 h-4 text-blue-500" />
            Atividade recente de autenticação
          </CardTitle>
        </CardHeader>
        <CardContent>
          {(overview?.data?.recentActivity ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Sem atividade recente</p>
          ) : (
            <div className="space-y-1.5 max-h-56 overflow-y-auto">
              {(overview?.data?.recentActivity ?? []).slice(0, 10).map((evt, i) => (
                <div key={i} className="flex items-center gap-3 py-1.5 border-b last:border-0 text-xs" data-testid={`activity-item-${i}`}>
                  <Badge className={`border shrink-0 ${severityBadge(evt.level ?? "INFO")}`}>{evt.level ?? "INFO"}</Badge>
                  <span className="font-mono text-muted-foreground shrink-0">{evt.action}</span>
                  <span className="text-foreground truncate">{evt.userEmail ?? evt.ip ?? "—"}</span>
                  <span className="text-muted-foreground shrink-0 ml-auto">
                    {new Date(evt.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Links para módulos especializados */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card className="border hover:border-primary/30 transition-colors">
          <CardContent className="pt-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-red-50 flex items-center justify-center">
                  <ShieldAlert className="w-4 h-4 text-red-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">Auditoria de Segurança</p>
                  <p className="text-xs text-muted-foreground">Eventos, IPs, tentativas por período</p>
                </div>
              </div>
              <Link href="/admin/security-audit">
                <Button variant="outline" size="sm" className="gap-1.5" data-testid="link-security-audit">
                  <ExternalLink className="w-3.5 h-3.5" />
                  Abrir
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        <Card className="border hover:border-primary/30 transition-colors">
          <CardContent className="pt-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-purple-50 flex items-center justify-center">
                  <Brain className="w-4 h-4 text-purple-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">Inteligência de Segurança</p>
                  <p className="text-xs text-muted-foreground">Análise de risco, clusters, anomalias</p>
                </div>
              </div>
              <Link href="/admin/security-intelligence">
                <Button variant="outline" size="sm" className="gap-1.5" data-testid="link-security-intelligence">
                  <ExternalLink className="w-3.5 h-3.5" />
                  Abrir
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
