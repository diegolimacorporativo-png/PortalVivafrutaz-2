import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import {
  ShieldCheck, ShieldAlert, ShieldOff, Server, Database, Wifi, Clock,
  RefreshCw, Unlock, AlertTriangle, CheckCircle2, XCircle, Info,
  Lock, User, Building2, Eye, EyeOff, Search,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

// ── Types ────────────────────────────────────────────────────────────────────
interface HealthCheck {
  status: "OK" | "WARN" | "ERROR";
  message: string;
}
interface HealthReport {
  timestamp: string;
  checks: Record<string, HealthCheck>;
  overall: "HEALTHY" | "DEGRADED";
  responseMs: number;
}
interface SecurityLog {
  id: number;
  action: string;
  description: string;
  userEmail?: string;
  userRole?: string;
  ip?: string;
  level: string;
  createdAt: string;
}
interface LockedAccount {
  id: number;
  type: "user" | "company";
  name: string;
  email: string;
  role: string;
  loginAttempts: number;
  lastLoginAttempt?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const CHECK_LABELS: Record<string, { label: string; icon: typeof Server }> = {
  database: { label: "Banco de Dados", icon: Database },
  auth: { label: "Autenticação", icon: ShieldCheck },
  server: { label: "Servidor", icon: Server },
  logs: { label: "Logs", icon: Info },
  session: { label: "Sessão", icon: User },
  maintenance: { label: "Manutenção", icon: AlertTriangle },
  testMode: { label: "Modo de Operação", icon: CheckCircle2 },
};

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  LOGIN: { label: "Login OK", color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" },
  LOGIN_FAILED: { label: "Tentativa Falha", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400" },
  LOGIN_BLOCKED: { label: "Acesso Bloqueado", color: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400" },
  ACCOUNT_LOCKED: { label: "Conta Bloqueada", color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400" },
  ACCOUNT_UNLOCKED: { label: "Conta Desbloqueada", color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400" },
  FRONTEND_RUNTIME_ERROR: { label: "Erro de Sistema", color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400" },
};

function StatusIcon({ status }: { status: string }) {
  if (status === "OK") return <CheckCircle2 className="w-5 h-5 text-green-500" />;
  if (status === "WARN") return <AlertTriangle className="w-5 h-5 text-yellow-500" />;
  return <XCircle className="w-5 h-5 text-red-500" />;
}

function fmtDate(d: string) {
  try { return format(new Date(d), "dd/MM/yyyy HH:mm:ss", { locale: ptBR }); } catch { return d; }
}
function fmtRelative(d: string) {
  try { return formatDistanceToNow(new Date(d), { locale: ptBR, addSuffix: true }); } catch { return d; }
}

// ── Main Page ────────────────────────────────────────────────────────────────
export default function SystemHealth() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [secFilter, setSecFilter] = useState("");
  const [showPasswords, setShowPasswords] = useState<Record<number, boolean>>({});

  // ── Health query (auto-refresh every 30 s) ──────────────────────
  const { data: health, isFetching: healthLoading, refetch: refetchHealth } = useQuery<HealthReport>({
    queryKey: ["/api/health"],
    refetchInterval: 30_000,
  });

  // ── Security logs ───────────────────────────────────────────────
  const { data: secLogs = [], isLoading: secLoading, refetch: refetchSec } = useQuery<SecurityLog[]>({
    queryKey: ["/api/security-logs"],
  });

  // ── Locked accounts ─────────────────────────────────────────────
  const { data: locked = [], isLoading: lockedLoading, refetch: refetchLocked } = useQuery<LockedAccount[]>({
    queryKey: ["/api/security/locked-accounts"],
  });

  // ── Unlock user mutation ────────────────────────────────────────
  const unlockUser = useMutation({
    mutationFn: (acc: LockedAccount) =>
      apiRequest(acc.type === "user" ? "POST" : "POST",
        acc.type === "user" ? `/api/admin/users/${acc.id}/unlock` : `/api/admin/companies/${acc.id}/unlock`),
    onSuccess: (_, acc) => {
      toast({ title: "Conta desbloqueada", description: `${acc.name} foi desbloqueado com sucesso.` });
      qc.invalidateQueries({ queryKey: ["/api/security/locked-accounts"] });
      qc.invalidateQueries({ queryKey: ["/api/security-logs"] });
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  // ── Derived stats ───────────────────────────────────────────────
  const loginFails = secLogs.filter(l => l.action === "LOGIN_FAILED").length;
  const accountsLocked = secLogs.filter(l => l.action === "ACCOUNT_LOCKED").length;
  const logins = secLogs.filter(l => l.action === "LOGIN").length;
  const unlocks = secLogs.filter(l => l.action === "ACCOUNT_UNLOCKED").length;

  const filteredSec = secLogs.filter(l =>
    !secFilter ||
    l.description?.toLowerCase().includes(secFilter.toLowerCase()) ||
    l.userEmail?.toLowerCase().includes(secFilter.toLowerCase()) ||
    l.ip?.includes(secFilter) ||
    l.action?.toLowerCase().includes(secFilter.toLowerCase())
  );

  const isHealthy = health?.overall === "HEALTHY";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`p-2.5 rounded-xl ${isHealthy ? "bg-green-100 dark:bg-green-900/30" : "bg-red-100 dark:bg-red-900/30"}`}>
            {isHealthy ? <ShieldCheck className="w-6 h-6 text-green-600 dark:text-green-400" /> : <ShieldAlert className="w-6 h-6 text-red-600 dark:text-red-400" />}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Saúde do Sistema</h1>
            <p className="text-sm text-muted-foreground">Monitoramento, segurança e controle de acesso</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {health && (
            <Badge variant="outline" className={`text-xs ${isHealthy ? "text-green-600 border-green-300" : "text-red-600 border-red-300"}`}>
              {isHealthy ? "Sistema Operacional" : "Sistema com Problemas"} — {health.responseMs}ms
            </Badge>
          )}
          <Button type="button" variant="outline" size="sm" onClick={() => { refetchHealth(); refetchSec(); refetchLocked(); }} disabled={healthLoading} className="gap-2">
            <RefreshCw className={`w-4 h-4 ${healthLoading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>
      </div>

      <Tabs defaultValue="health">
        <TabsList className="grid grid-cols-3 w-full max-w-lg">
          <TabsTrigger value="health" className="gap-1.5">
            <Server className="w-4 h-4" />
            Saúde
          </TabsTrigger>
          <TabsTrigger value="security" className="gap-1.5">
            <ShieldAlert className="w-4 h-4" />
            Logs de Segurança
            {loginFails > 0 && <Badge className="ml-1 bg-yellow-500 text-white text-[10px] px-1.5 py-0">{loginFails}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="locked" className="gap-1.5">
            <Lock className="w-4 h-4" />
            Contas Bloqueadas
            {locked.length > 0 && <Badge className="ml-1 bg-red-500 text-white text-[10px] px-1.5 py-0">{locked.length}</Badge>}
          </TabsTrigger>
        </TabsList>

        {/* ── TAB: Saúde ─────────────────────────────────────────── */}
        <TabsContent value="health" className="space-y-4 mt-4">
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Logins Bem-sucedidos", value: logins, icon: CheckCircle2, color: "text-green-600", bg: "bg-green-50 dark:bg-green-900/20" },
              { label: "Tentativas Falhas", value: loginFails, icon: AlertTriangle, color: "text-yellow-600", bg: "bg-yellow-50 dark:bg-yellow-900/20" },
              { label: "Contas Bloqueadas", value: accountsLocked, icon: ShieldOff, color: "text-red-600", bg: "bg-red-50 dark:bg-red-900/20" },
              { label: "Desbloqueios", value: unlocks, icon: Unlock, color: "text-blue-600", bg: "bg-blue-50 dark:bg-blue-900/20" },
            ].map(item => (
              <Card key={item.label} className={`border-border/50 ${item.bg}`}>
                <CardContent className="p-4 flex items-center gap-3">
                  <item.icon className={`w-7 h-7 ${item.color} flex-shrink-0`} />
                  <div>
                    <p className={`text-2xl font-bold ${item.color}`}>{item.value}</p>
                    <p className="text-xs text-muted-foreground leading-tight">{item.label}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Health checks */}
          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Server className="w-4 h-4 text-primary" />
                Verificações do Sistema
                {health && (
                  <span className="text-xs text-muted-foreground font-normal ml-auto">
                    Última verificação: {fmtDate(health.timestamp)}
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!health ? (
                <div className="flex items-center gap-2 text-muted-foreground py-4">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Carregando status do sistema...
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {Object.entries(health.checks).map(([key, check]) => {
                    const meta = CHECK_LABELS[key] || { label: key, icon: Info };
                    const Icon = meta.icon;
                    return (
                      <div key={key} className={`flex items-center gap-3 p-3 rounded-xl border ${
                        check.status === "OK" ? "bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-800"
                        : check.status === "WARN" ? "bg-yellow-50 dark:bg-yellow-900/10 border-yellow-200 dark:border-yellow-800"
                        : "bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800"
                      }`} data-testid={`health-check-${key}`}>
                        <StatusIcon status={check.status} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-foreground">{meta.label}</p>
                          <p className="text-xs text-muted-foreground truncate">{check.message}</p>
                        </div>
                        <Badge variant="outline" className={`text-[10px] flex-shrink-0 ${
                          check.status === "OK" ? "text-green-600 border-green-300"
                          : check.status === "WARN" ? "text-yellow-600 border-yellow-300"
                          : "text-red-600 border-red-300"
                        }`}>
                          {check.status}
                        </Badge>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Failover / Infrastructure section */}
          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Wifi className="w-4 h-4 text-primary" />
                Infraestrutura & Failover
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="flex items-center gap-3 p-3 rounded-xl border bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-800">
                  <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-foreground">Servidor Principal</p>
                    <p className="text-xs text-muted-foreground">Replit Hosted — Ativo e Respondendo</p>
                  </div>
                  <Badge variant="outline" className="text-[10px] text-green-600 border-green-300">ATIVO</Badge>
                </div>
                <div className="flex items-center gap-3 p-3 rounded-xl border bg-muted/30 border-border/50">
                  <Info className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-foreground">Servidor de Backup</p>
                    <p className="text-xs text-muted-foreground">Failover automático — Standby</p>
                  </div>
                  <Badge variant="outline" className="text-[10px] text-muted-foreground">STANDBY</Badge>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5 flex-shrink-0" />
                Em caso de falha do servidor principal, o sistema de failover registra o evento e mantém os dados protegidos.
                Todos os incidentes são automaticamente registrados nos logs de segurança.
              </p>
            </CardContent>
          </Card>

          {/* Response time */}
          {health && (
            <Card className="border-border/50">
              <CardContent className="p-4 flex items-center gap-3">
                <Clock className="w-5 h-5 text-primary flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-foreground">Tempo de Resposta Médio</p>
                  <p className="text-xs text-muted-foreground">Última verificação</p>
                </div>
                <div className="ml-auto text-right">
                  <p className={`text-2xl font-bold ${health.responseMs < 100 ? "text-green-600" : health.responseMs < 300 ? "text-yellow-600" : "text-red-600"}`}>
                    {health.responseMs}ms
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {health.responseMs < 100 ? "Excelente" : health.responseMs < 300 ? "Adequado" : "Lento"}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── TAB: Logs de Segurança ──────────────────────────────── */}
        <TabsContent value="security" className="space-y-4 mt-4">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Filtrar por e-mail, IP, evento..."
                value={secFilter}
                onChange={e => setSecFilter(e.target.value)}
                className="pl-9"
                data-testid="input-security-filter"
              />
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => refetchSec()} className="gap-2">
              <RefreshCw className="w-4 h-4" />
              Atualizar
            </Button>
            <span className="text-xs text-muted-foreground">{filteredSec.length} eventos</span>
          </div>

          {secLoading ? (
            <div className="text-center py-12 text-muted-foreground">Carregando logs...</div>
          ) : filteredSec.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <ShieldCheck className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <p className="text-sm">Nenhum evento de segurança encontrado.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredSec.map(log => {
                const meta = ACTION_LABELS[log.action] || { label: log.action, color: "bg-muted text-muted-foreground" };
                return (
                  <div key={log.id} className="flex items-start gap-3 p-3 rounded-xl border border-border/50 bg-card hover:bg-muted/30 transition-colors" data-testid={`security-log-${log.id}`}>
                    <div className="flex-shrink-0 mt-0.5">
                      {log.action === "LOGIN" && <CheckCircle2 className="w-4 h-4 text-green-500" />}
                      {log.action === "LOGIN_FAILED" && <AlertTriangle className="w-4 h-4 text-yellow-500" />}
                      {(log.action === "ACCOUNT_LOCKED" || log.action === "LOGIN_BLOCKED") && <ShieldOff className="w-4 h-4 text-red-500" />}
                      {log.action === "ACCOUNT_UNLOCKED" && <Unlock className="w-4 h-4 text-blue-500" />}
                      {log.action === "FRONTEND_RUNTIME_ERROR" && <XCircle className="w-4 h-4 text-red-500" />}
                      {!ACTION_LABELS[log.action] && <Info className="w-4 h-4 text-muted-foreground" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge className={`text-[10px] px-1.5 py-0 ${meta.color}`}>{meta.label}</Badge>
                        {log.userEmail && <span className="text-xs text-muted-foreground truncate">{log.userEmail}</span>}
                        {log.ip && <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded font-mono">{log.ip}</span>}
                      </div>
                      <p className="text-xs text-foreground mt-0.5 line-clamp-2">{log.description}</p>
                    </div>
                    <div className="flex-shrink-0 text-right">
                      <p className="text-[10px] text-muted-foreground">{fmtDate(log.createdAt)}</p>
                      <p className="text-[10px] text-muted-foreground/60">{fmtRelative(log.createdAt)}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ── TAB: Contas Bloqueadas ──────────────────────────────── */}
        <TabsContent value="locked" className="space-y-4 mt-4">
          {lockedLoading ? (
            <div className="text-center py-12 text-muted-foreground">Carregando...</div>
          ) : locked.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <ShieldCheck className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-base font-medium">Nenhuma conta bloqueada</p>
              <p className="text-sm mt-1">Todas as contas estão com acesso liberado.</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800">
                <ShieldAlert className="w-5 h-5 text-red-500 flex-shrink-0" />
                <p className="text-sm text-red-700 dark:text-red-400 font-medium">
                  {locked.length} {locked.length === 1 ? "conta bloqueada" : "contas bloqueadas"} por tentativas de senha incorreta. Verifique e desbloqueie se necessário.
                </p>
              </div>
              {locked.map(acc => (
                <Card key={`${acc.type}-${acc.id}`} className="border-border/50" data-testid={`locked-account-${acc.type}-${acc.id}`}>
                  <CardContent className="p-4 flex items-center gap-4">
                    <div className={`p-2 rounded-xl flex-shrink-0 ${acc.type === "user" ? "bg-blue-100 dark:bg-blue-900/30" : "bg-orange-100 dark:bg-orange-900/30"}`}>
                      {acc.type === "user" ? <User className="w-5 h-5 text-blue-600 dark:text-blue-400" /> : <Building2 className="w-5 h-5 text-orange-600 dark:text-orange-400" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-foreground truncate">{acc.name}</p>
                        <Badge variant="outline" className="text-[10px] flex-shrink-0">
                          {acc.type === "user" ? acc.role : "Cliente"}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground truncate">{acc.email}</p>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-xs text-red-600 dark:text-red-400 font-medium flex items-center gap-1">
                          <Lock className="w-3 h-3" />
                          {acc.loginAttempts} tentativas erradas
                        </span>
                        {acc.lastLoginAttempt && (
                          <span className="text-xs text-muted-foreground">
                            Última tentativa: {fmtRelative(acc.lastLoginAttempt)}
                          </span>
                        )}
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => unlockUser.mutate(acc)}
                      disabled={unlockUser.isPending}
                      className="gap-2 flex-shrink-0"
                      data-testid={`button-unlock-${acc.type}-${acc.id}`}
                    >
                      <Unlock className="w-4 h-4" />
                      Desbloquear
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
