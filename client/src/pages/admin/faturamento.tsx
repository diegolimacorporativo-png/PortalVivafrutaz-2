import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useEmitirLoteNfe, type LoteResponse } from "@/hooks/use-emitir-lote-nfe";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  CheckCircle2,
  XCircle,
  AlertCircle,
  RefreshCw,
  Zap,
  FileText,
  Building2,
  Clock,
  SkipForward,
  PlayCircle,
  Activity,
  Mail,
  MessageSquare,
  Phone,
  Plus,
  Trash2,
  Save,
  BellRing,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

type EligibleOrder = {
  orderId: number;
  companyId: number;
  faturamento: {
    tipo: string;
    prazoDias: number;
  };
};

type CronStatus = {
  lastRunAt: string | null;
  lastFinishedAt: string | null;
  lastTriggeredBy: "schedule" | "manual" | null;
  running: boolean;
  summary: {
    total: number;
    success: number;
    blocked: number;
    errors: number;
  } | null;
};

type CronHistoryRow = {
  id: number;
  executedAt: string;
  triggeredBy: "schedule" | "manual";
  triggeredByUserId: number | null;
  total: number;
  success: number;
  blocked: number;
  errors: number;
};

type AlertChannel = "email" | "slack" | "whatsapp";

type AlertRecipient = {
  channel: AlertChannel;
  target: string;
  enabled: boolean;
  label?: string;
};

type AlertLogEntry = {
  at: number;
  severity: "ALERT" | "CRITICAL";
  title: string;
  message: string;
  results: Array<{
    channel: AlertChannel;
    target?: string;
    ok: boolean;
    reason?: string;
  }>;
  rateLimited?: boolean;
  // STEP 9.3F.6 — campo opcional adicionado pelo backend.
  suppressed?: boolean;
};

// STEP 9.3F.6 — payloads dos endpoints de inteligência.
type AnomalyEntry = {
  dimension: "total" | "severity" | "channel";
  key: string;
  current: number;
  baselineDailyAvg: number;
  deltaPct: number;
  level: "ok" | "warning" | "critical";
  label: string;
};
type AnomalyReport = {
  currentHours: number;
  baselineDays: number;
  generatedAt: string;
  anomalies: AnomalyEntry[];
};
type InsightEntry = {
  id: string;
  level: "info" | "warning" | "critical";
  title: string;
  detail: string;
  metric: Record<string, unknown>;
};
type InsightReport = {
  windowHours: number;
  generatedAt: string;
  insights: InsightEntry[];
};

// STEP 9.3F.7 — digest automático (resumo inteligente).
type DigestReport = {
  windowHours: number;
  generatedAt: string;
  summary: {
    total: number;
    sent: number;
    rate_limited: number;
    suppressed: number;
  };
  insights: InsightEntry[];
  anomalies: AnomalyEntry[];
  highlights: {
    topChannel: string | null;
    topTitle: string | null;
  };
  message: string;
};

// STEP 9.3F.5 — analytics dos alertas persistidos (já normalizados como number).
type AlertAnalytics = {
  days: number;
  since: string;
  totals: { total: number; rate_limited: number; sent: number };
  bySeverity: Array<{ severity: string; count: number }>;
  byChannel: Array<{ channel: string; count: number }>;
  topTitles: Array<{ title: string; count: number }>;
};

function ChannelStat({
  icon,
  label,
  results,
}: {
  icon: React.ReactNode;
  label: string;
  results: Array<{ ok: boolean; reason?: string }>;
}) {
  const ok = results.filter((r) => r.ok).length;
  const fail = results.length - ok;
  const allOk = fail === 0;
  const allFail = ok === 0;
  const cls = allOk
    ? "bg-green-100 text-green-800"
    : allFail
    ? "bg-red-100 text-red-800"
    : "bg-amber-100 text-amber-800";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded ${cls}`}>
      {icon} {label} {allOk ? "✅" : allFail ? "❌" : `${ok}/${results.length}`}
    </span>
  );
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

const TIPO_BADGE: Record<string, string> = {
  semanal:    "bg-blue-100 text-blue-800",
  mensal:     "bg-purple-100 text-purple-800",
  imediato:   "bg-green-100 text-green-800",
  contratual: "bg-orange-100 text-orange-800",
  pontual:    "bg-gray-100 text-gray-700",
};

function StatusIcon({ status }: { status: string }) {
  if (status === "success") return <CheckCircle2 className="w-4 h-4 text-green-600" />;
  if (status === "blocked") return <XCircle className="w-4 h-4 text-orange-500" />;
  if (status === "skipped") return <SkipForward className="w-4 h-4 text-gray-400" />;
  return <AlertCircle className="w-4 h-4 text-red-500" />;
}

export default function CentralFaturamento() {
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loteResult, setLoteResult] = useState<LoteResponse | null>(null);

  const { data: eligible = [], isLoading, refetch } = useQuery<EligibleOrder[]>({
    queryKey: ["/api/nfe/eligible"],
  });

  // STEP 9.3D — status do cron (poll a cada 10s; mais rápido enquanto rodando).
  const { data: cronStatus } = useQuery<CronStatus>({
    queryKey: ["/api/nfe/cron/status"],
    refetchInterval: (query) => (query.state.data?.running ? 2000 : 10000),
  });

  // STEP 9.3E — histórico persistente das últimas execuções.
  const { data: cronHistory = [], isLoading: historyLoading } = useQuery<CronHistoryRow[]>({
    queryKey: ["/api/nfe/cron/history"],
    refetchInterval: 15000,
  });

  // STEP 9.3F.1 — destinatários de alerta (email / slack / whatsapp).
  const { data: serverRecipients = [], isLoading: recipientsLoading } = useQuery<AlertRecipient[]>({
    queryKey: ["/api/cron/alerts/recipients"],
  });
  const [recipients, setRecipients] = useState<AlertRecipient[] | null>(null);
  const recipientsList = recipients ?? serverRecipients;
  const recipientsDirty =
    recipients !== null &&
    JSON.stringify(recipients) !== JSON.stringify(serverRecipients);

  const saveRecipients = useMutation({
    mutationFn: async (list: AlertRecipient[]) => {
      const res = await apiRequest("PUT", "/api/cron/alerts/recipients", list);
      return (await res.json()) as AlertRecipient[];
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(["/api/cron/alerts/recipients"], saved);
      setRecipients(null);
      toast({ title: "Destinatários atualizados", description: `${saved.length} destinatário(s) salvos.` });
    },
    onError: (err: any) => {
      toast({
        variant: "destructive",
        title: "Falha ao salvar",
        description: err?.message ?? "Erro desconhecido",
      });
    },
  });

  function updateRecipient(idx: number, patch: Partial<AlertRecipient>) {
    const base = recipients ?? serverRecipients;
    const next = base.map((r, i) => (i === idx ? { ...r, ...patch } : r));
    setRecipients(next);
  }

  function addRecipient() {
    const base = recipients ?? serverRecipients;
    setRecipients([...base, { channel: "email", target: "", enabled: true }]);
  }

  function removeRecipient(idx: number) {
    const base = recipients ?? serverRecipients;
    setRecipients(base.filter((_, i) => i !== idx));
  }

  // STEP 9.3F.3 — auditoria de alertas disparados (poll a cada 12s).
  const { data: alertLogs = [], isLoading: alertLogsLoading } = useQuery<AlertLogEntry[]>({
    queryKey: ["/api/cron/alerts/logs"],
    refetchInterval: 12000,
  });

  // STEP 9.3F.5 — janela analítica selecionável + query de analytics.
  const [analyticsDays, setAnalyticsDays] = useState<7 | 30 | 90>(7);
  const { data: analytics, isLoading: analyticsLoading } = useQuery<AlertAnalytics>({
    queryKey: ["/api/cron/alerts/analytics", analyticsDays],
    queryFn: async () => {
      const res = await fetch(`/api/cron/alerts/analytics?days=${analyticsDays}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return (await res.json()) as AlertAnalytics;
    },
    refetchInterval: 15000,
  });

  // STEP 9.3F.6 — janela de inteligência (24h / 7d / 30d) + queries paralelas.
  // Mapeia para horas/dias compatíveis com os endpoints (/anomalies clamp 1..168h).
  type IntelWindow = "24h" | "7d" | "30d";
  const [intelWindow, setIntelWindow] = useState<IntelWindow>("24h");
  const intelParams = (() => {
    switch (intelWindow) {
      case "7d":  return { currentHours: 168, baselineDays: 30, windowHours: 168 };
      case "30d": return { currentHours: 168, baselineDays: 90, windowHours: 720 }; // anomalias capadas em 168h
      default:    return { currentHours: 24,  baselineDays: 7,  windowHours: 24  };
    }
  })();

  const { data: anomalies, isLoading: anomaliesLoading } = useQuery<AnomalyReport>({
    queryKey: ["/api/cron/alerts/anomalies", intelParams.currentHours, intelParams.baselineDays],
    queryFn: async () => {
      const res = await fetch(
        `/api/cron/alerts/anomalies?currentHours=${intelParams.currentHours}&baselineDays=${intelParams.baselineDays}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return (await res.json()) as AnomalyReport;
    },
    refetchInterval: 30000,
  });

  // STEP 9.3F.7 — digest com resumo, KPIs e mensagem em linguagem natural.
  const { data: digest, isLoading: digestLoading } = useQuery<DigestReport>({
    queryKey: ["/api/cron/alerts/digest", intelParams.windowHours],
    queryFn: async () => {
      const res = await fetch(`/api/cron/alerts/digest?windowHours=${intelParams.windowHours}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return (await res.json()) as DigestReport;
    },
    refetchInterval: 30000,
  });

  const { data: insightsData, isLoading: insightsLoading } = useQuery<InsightReport>({
    queryKey: ["/api/cron/alerts/insights", intelParams.windowHours],
    queryFn: async () => {
      const res = await fetch(`/api/cron/alerts/insights?windowHours=${intelParams.windowHours}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return (await res.json()) as InsightReport;
    },
    refetchInterval: 30000,
  });

  const runCron = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/nfe/cron/run");
      return res.json();
    },
    onSuccess: (data) => {
      const summary = data?.result;
      toast({
        title: "Cron executado",
        description: summary
          ? `${summary.emitidas ?? 0} emitidas · ${summary.bloqueadas ?? 0} bloqueadas · ${summary.erros ?? 0} erros`
          : "Execução concluída",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/nfe/cron/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/nfe/eligible"] });
    },
    onError: (e: any) => {
      toast({
        title: "Erro ao executar cron",
        description: e?.message ?? "Tente novamente.",
        variant: "destructive",
      });
    },
  });

  const emitirLote = useEmitirLoteNfe();

  function toggleAll() {
    if (selected.size === eligible.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(eligible.map((o) => o.orderId)));
    }
  }

  function toggleOne(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleEmitir() {
    const orderIds = Array.from(selected);
    try {
      const result = await emitirLote.mutateAsync(orderIds);
      setLoteResult(result);
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ["/api/nfe/eligible"] });
      toast({
        title: "Lote processado",
        description: `${result.summary.success} emitidas · ${result.summary.blocked} bloqueadas · ${result.summary.errors} erros`,
      });
    } catch (e: any) {
      toast({ title: "Erro ao emitir lote", description: e.message, variant: "destructive" });
    }
  }

  const allSelected = eligible.length > 0 && selected.size === eligible.length;
  const someSelected = selected.size > 0;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Central de Faturamento</h1>
          <p className="text-sm text-gray-500 mt-1">
            Pedidos elegíveis para emissão de NF-e agora
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isLoading}
          data-testid="button-refresh-eligible"
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      {/* Cron Status — STEP 9.3D */}
      <Card data-testid="card-cron-status">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-600" />
              Cron de Faturamento
              {cronStatus?.running ? (
                <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100" data-testid="badge-cron-running">
                  Rodando agora…
                </Badge>
              ) : (
                <Badge variant="secondary" data-testid="badge-cron-idle">
                  Em espera
                </Badge>
              )}
            </CardTitle>
            <Button
              size="sm"
              onClick={() => runCron.mutate()}
              disabled={runCron.isPending || cronStatus?.running}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              data-testid="button-run-cron"
            >
              <PlayCircle className={`w-4 h-4 mr-2 ${runCron.isPending ? "animate-pulse" : ""}`} />
              {runCron.isPending || cronStatus?.running ? "Executando…" : "Executar agora"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-4 text-sm">
            <div className="col-span-2 md:col-span-2">
              <div className="text-xs text-gray-500 mb-1">Última execução</div>
              <div className="font-medium text-gray-900" data-testid="text-cron-last-run">
                {formatDateTime(cronStatus?.lastRunAt ?? null)}
              </div>
              {cronStatus?.lastTriggeredBy && (
                <div className="text-xs text-gray-400 mt-0.5">
                  Disparado por: {cronStatus.lastTriggeredBy === "manual" ? "manual" : "agendamento (08:00)"}
                </div>
              )}
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-1">Total</div>
              <div className="font-semibold text-gray-900" data-testid="text-cron-total">
                {cronStatus?.summary?.total ?? "—"}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-1">Sucesso</div>
              <div className="font-semibold text-green-700" data-testid="text-cron-success">
                {cronStatus?.summary?.success ?? "—"}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-1">Bloqueados</div>
              <div className="font-semibold text-orange-600" data-testid="text-cron-blocked">
                {cronStatus?.summary?.blocked ?? "—"}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-1">Erros</div>
              <div className="font-semibold text-red-600" data-testid="text-cron-errors">
                {cronStatus?.summary?.errors ?? "—"}
              </div>
            </div>
          </div>
          {!cronStatus?.lastRunAt && (
            <p className="text-xs text-gray-400 mt-3">
              O cron ainda não rodou nesta sessão do servidor. Use "Executar agora" para disparar manualmente.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Histórico de execuções — STEP 9.3E */}
      <Card data-testid="card-cron-history">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Clock className="w-4 h-4 text-emerald-600" />
            Histórico do cron
            {!historyLoading && (
              <Badge variant="secondary" className="ml-1" data-testid="badge-history-count">
                {cronHistory.length}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {historyLoading ? (
            <div className="p-4 space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-10 w-full rounded" />
              ))}
            </div>
          ) : cronHistory.length === 0 ? (
            <div className="px-4 py-6 text-sm text-gray-400 text-center">
              Nenhuma execução registrada ainda. As próximas execuções (agendadas ou manuais) aparecerão aqui.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium">Quando</th>
                    <th className="text-left px-4 py-2 font-medium">Disparo</th>
                    <th className="text-right px-4 py-2 font-medium">Total</th>
                    <th className="text-right px-4 py-2 font-medium">Sucesso</th>
                    <th className="text-right px-4 py-2 font-medium">Bloq.</th>
                    <th className="text-right px-4 py-2 font-medium">Erros</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {cronHistory.map((run) => {
                    const hasErrors = run.errors > 0;
                    const allFailed = run.success === 0 && run.total > 0;
                    return (
                      <tr
                        key={run.id}
                        className={`hover:bg-gray-50 ${allFailed ? "bg-red-50/40" : hasErrors ? "bg-amber-50/40" : ""}`}
                        data-testid={`row-history-${run.id}`}
                      >
                        <td className="px-4 py-2 text-gray-700">{formatDateTime(run.executedAt)}</td>
                        <td className="px-4 py-2">
                          <Badge
                            variant="secondary"
                            className={
                              run.triggeredBy === "manual"
                                ? "bg-blue-100 text-blue-800 hover:bg-blue-100"
                                : "bg-gray-100 text-gray-700 hover:bg-gray-100"
                            }
                          >
                            {run.triggeredBy === "manual" ? "manual" : "agendado"}
                          </Badge>
                        </td>
                        <td className="px-4 py-2 text-right font-medium text-gray-900" data-testid={`text-history-total-${run.id}`}>
                          {run.total}
                        </td>
                        <td className="px-4 py-2 text-right font-medium text-green-700" data-testid={`text-history-success-${run.id}`}>
                          {run.success}
                        </td>
                        <td className="px-4 py-2 text-right font-medium text-orange-600">{run.blocked}</td>
                        <td className={`px-4 py-2 text-right font-medium ${hasErrors ? "text-red-600" : "text-gray-400"}`} data-testid={`text-history-errors-${run.id}`}>
                          {run.errors}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Destinatários de alerta — STEP 9.3F.1 */}
      <Card data-testid="card-alert-recipients">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <BellRing className="w-4 h-4 text-pink-600" />
              Destinatários de alerta do cron
              {!recipientsLoading && (
                <Badge variant="secondary" className="ml-1" data-testid="badge-recipients-count">
                  {recipientsList.length}
                </Badge>
              )}
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={addRecipient}
                data-testid="button-add-recipient"
              >
                <Plus className="w-4 h-4 mr-1" />
                Adicionar
              </Button>
              <Button
                size="sm"
                onClick={() => saveRecipients.mutate(recipientsList)}
                disabled={!recipientsDirty || saveRecipients.isPending}
                data-testid="button-save-recipients"
              >
                <Save className="w-4 h-4 mr-1" />
                {saveRecipients.isPending ? "Salvando..." : "Salvar"}
              </Button>
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Quem recebe os alertas <code className="text-[11px]">[CRON_ALERT]</code> e{" "}
            <code className="text-[11px]">[CRON_CRITICAL]</code>. Limite anti-spam: 10 min entre envios. WhatsApp aparecerá nos logs como
            pendente até a integração final (STEP 9.3F.2).
          </p>
        </CardHeader>
        <CardContent className="p-0">
          {recipientsLoading ? (
            <div className="p-4 space-y-2">
              <Skeleton className="h-10 w-full rounded" />
              <Skeleton className="h-10 w-full rounded" />
            </div>
          ) : recipientsList.length === 0 ? (
            <div className="px-4 py-6 text-sm text-gray-400 text-center">
              Nenhum destinatário configurado. Clique em <strong>Adicionar</strong> para receber alertas por email, Slack ou WhatsApp.
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {recipientsList.map((r, idx) => {
                const ChannelIcon = r.channel === "email" ? Mail : r.channel === "slack" ? MessageSquare : Phone;
                const placeholder =
                  r.channel === "email"
                    ? "ops@empresa.com"
                    : r.channel === "slack"
                    ? "https://hooks.slack.com/services/..."
                    : "+55 11 99999-9999";
                return (
                  <li
                    key={idx}
                    className="flex items-center gap-3 px-4 py-3 flex-wrap md:flex-nowrap"
                    data-testid={`row-recipient-${idx}`}
                  >
                    <ChannelIcon className="w-4 h-4 text-gray-500 shrink-0" />
                    <Select
                      value={r.channel}
                      onValueChange={(value) => updateRecipient(idx, { channel: value as AlertChannel })}
                    >
                      <SelectTrigger className="w-32" data-testid={`select-channel-${idx}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="email">Email</SelectItem>
                        <SelectItem value="slack">Slack</SelectItem>
                        <SelectItem value="whatsapp">WhatsApp</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      value={r.target}
                      onChange={(e) => updateRecipient(idx, { target: e.target.value })}
                      placeholder={placeholder}
                      className="flex-1 min-w-[180px]"
                      data-testid={`input-target-${idx}`}
                    />
                    <div className="flex items-center gap-2 shrink-0">
                      <Switch
                        checked={r.enabled}
                        onCheckedChange={(checked) => updateRecipient(idx, { enabled: checked })}
                        data-testid={`switch-enabled-${idx}`}
                      />
                      <span className="text-xs text-gray-500 w-14">
                        {r.enabled ? "Ativo" : "Pausado"}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeRecipient(idx)}
                      className="text-red-500 hover:text-red-700 shrink-0"
                      data-testid={`button-remove-${idx}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Resumo Inteligente — STEP 9.3F.7 */}
      <Card data-testid="card-alert-digest">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <BellRing className="w-4 h-4 text-emerald-600" />
              Resumo inteligente
              <Badge variant="secondary" className="ml-1" data-testid="badge-digest-window">
                Janela: {intelWindow}
              </Badge>
            </CardTitle>
            <span className="text-xs text-gray-400">Atualiza a cada 30s</span>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Composição automática a partir dos insights, anomalias e métricas já calculados.
          </p>
        </CardHeader>
        <CardContent>
          {digestLoading && !digest ? (
            <div className="space-y-3">
              <Skeleton className="h-12 rounded" />
              <div className="grid grid-cols-4 gap-2">
                <Skeleton className="h-16 rounded" />
                <Skeleton className="h-16 rounded" />
                <Skeleton className="h-16 rounded" />
                <Skeleton className="h-16 rounded" />
              </div>
            </div>
          ) : !digest ? (
            <div className="px-2 py-6 text-sm text-gray-400 text-center" data-testid="text-digest-empty">
              Sem dados para gerar resumo.
            </div>
          ) : (
            <div className="space-y-4">
              {/* Mensagem em linguagem natural */}
              <div
                className="rounded border bg-emerald-50/50 px-3 py-3 text-sm text-emerald-900"
                data-testid="text-digest-message"
              >
                {digest.message}
              </div>

              {/* KPIs */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div className="rounded border bg-gray-50 px-3 py-2" data-testid="card-digest-total">
                  <div className="text-[11px] text-gray-500">Total</div>
                  <div className="text-xl font-semibold text-gray-800">{digest.summary.total}</div>
                </div>
                <div className="rounded border bg-green-50 px-3 py-2" data-testid="card-digest-sent">
                  <div className="text-[11px] text-green-700">Enviados</div>
                  <div className="text-xl font-semibold text-green-800">{digest.summary.sent}</div>
                </div>
                <div className="rounded border bg-amber-50 px-3 py-2" data-testid="card-digest-rate-limited">
                  <div className="text-[11px] text-amber-700">Rate-limited</div>
                  <div className="text-xl font-semibold text-amber-800">{digest.summary.rate_limited}</div>
                </div>
                <div className="rounded border bg-purple-50 px-3 py-2" data-testid="card-digest-suppressed">
                  <div className="text-[11px] text-purple-700">Suprimidos</div>
                  <div className="text-xl font-semibold text-purple-800">{digest.summary.suppressed}</div>
                </div>
              </div>

              {/* Destaques */}
              {(digest.highlights.topChannel || digest.highlights.topTitle) && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  {digest.highlights.topTitle && (
                    <div
                      className="flex items-center gap-2 rounded border px-3 py-2"
                      data-testid="text-digest-top-title"
                    >
                      <span className="text-gray-500 shrink-0">Título mais recorrente:</span>
                      <span className="font-medium text-gray-800 truncate">{digest.highlights.topTitle}</span>
                    </div>
                  )}
                  {digest.highlights.topChannel && (
                    <div
                      className="flex items-center gap-2 rounded border px-3 py-2"
                      data-testid="text-digest-top-channel"
                    >
                      <span className="text-gray-500 shrink-0">Canal em destaque:</span>
                      <Badge variant="secondary" className="capitalize">
                        {digest.highlights.topChannel}
                      </Badge>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Insights Inteligentes — STEP 9.3F.6 */}
      <Card data-testid="card-alert-intelligence">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Activity className="w-4 h-4 text-purple-600" />
              Insights inteligentes
              <Badge variant="secondary" className="ml-1" data-testid="badge-intel-window">
                Janela: {intelWindow}
              </Badge>
            </CardTitle>
            <div className="flex items-center gap-1" role="group" aria-label="Janela de inteligência">
              {(["24h", "7d", "30d"] as const).map((w) => (
                <Button
                  key={w}
                  size="sm"
                  variant={intelWindow === w ? "default" : "outline"}
                  className="h-7 px-2 text-xs"
                  onClick={() => setIntelWindow(w)}
                  data-testid={`button-intel-window-${w}`}
                >
                  {w}
                </Button>
              ))}
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Detecção automática de anomalias e observações em linguagem natural. Não dispara alertas — apenas leitura. Atualiza a cada 30s.
          </p>
        </CardHeader>
        <CardContent>
          {(insightsLoading && !insightsData) || (anomaliesLoading && !anomalies) ? (
            <div className="space-y-3">
              <Skeleton className="h-16 rounded" />
              <Skeleton className="h-16 rounded" />
              <Skeleton className="h-24 rounded" />
            </div>
          ) : (insightsData?.insights.length ?? 0) === 0 && (anomalies?.anomalies.length ?? 0) === 0 ? (
            <div
              className="px-2 py-6 text-sm text-emerald-700 text-center flex items-center justify-center gap-2"
              data-testid="text-intel-empty"
            >
              <CheckCircle2 className="w-4 h-4" />
              Sistema saudável — nenhuma anomalia detectada na janela.
            </div>
          ) : (
            <div className="space-y-5">
              {/* Insights */}
              {(insightsData?.insights.length ?? 0) > 0 && (
                <div>
                  <div className="text-xs font-medium text-gray-600 mb-2">Observações</div>
                  <ul className="space-y-2">
                    {insightsData!.insights.map((it, idx) => {
                      const cls =
                        it.level === "critical"
                          ? "bg-red-100 text-red-800"
                          : it.level === "warning"
                          ? "bg-amber-100 text-amber-800"
                          : "bg-slate-100 text-slate-700";
                      return (
                        <li
                          key={`${it.id}-${idx}`}
                          className="border rounded p-3"
                          data-testid={`row-intel-insight-${idx}`}
                        >
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge className={`${cls} hover:${cls} uppercase text-[10px]`}>
                              {it.level}
                            </Badge>
                            <span className="text-sm font-medium text-gray-800">{it.title}</span>
                          </div>
                          <p className="text-xs text-gray-600 mt-1">{it.detail}</p>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {/* Anomalias (resumo compacto) */}
              {(anomalies?.anomalies.length ?? 0) > 0 && (
                <div>
                  <div className="text-xs font-medium text-gray-600 mb-2">
                    Anomalias detectadas (atual vs baseline {anomalies!.baselineDays}d)
                  </div>
                  <ul className="divide-y divide-gray-100 border rounded">
                    {anomalies!.anomalies.map((a, idx) => {
                      const cls =
                        a.level === "critical"
                          ? "bg-red-100 text-red-800"
                          : "bg-amber-100 text-amber-800";
                      return (
                        <li
                          key={`${a.dimension}-${a.key}-${idx}`}
                          className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                          data-testid={`row-intel-anomaly-${idx}`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <Badge className={`${cls} hover:${cls} uppercase text-[10px] shrink-0`}>
                              {a.level}
                            </Badge>
                            <span className="text-gray-700 truncate">{a.label}</span>
                          </div>
                          <span className="text-xs text-gray-500 whitespace-nowrap">
                            {a.current} vs {a.baselineDailyAvg}/dia
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Analytics de alertas — STEP 9.3F.5 */}
      <Card data-testid="card-alert-analytics">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Activity className="w-4 h-4 text-indigo-600" />
              Analytics de alertas
              <Badge variant="secondary" className="ml-1" data-testid="badge-analytics-window">
                Últimos {analyticsDays} {analyticsDays === 1 ? "dia" : "dias"}
              </Badge>
            </CardTitle>
            <div className="flex items-center gap-1" role="group" aria-label="Janela de análise">
              {[7, 30, 90].map((d) => (
                <Button
                  key={d}
                  size="sm"
                  variant={analyticsDays === d ? "default" : "outline"}
                  className="h-7 px-2 text-xs"
                  onClick={() => setAnalyticsDays(d as 7 | 30 | 90)}
                  data-testid={`button-analytics-window-${d}`}
                >
                  {d}d
                </Button>
              ))}
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Métricas agregadas dos alertas persistidos no banco. Atualiza a cada 15s.
          </p>
        </CardHeader>
        <CardContent>
          {analyticsLoading && !analytics ? (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <Skeleton className="h-20 rounded" />
                <Skeleton className="h-20 rounded" />
                <Skeleton className="h-20 rounded" />
              </div>
              <Skeleton className="h-24 rounded" />
            </div>
          ) : !analytics || analytics.totals.total === 0 ? (
            <div className="px-2 py-6 text-sm text-gray-400 text-center" data-testid="text-analytics-empty">
              Sem alertas no período selecionado.
            </div>
          ) : (
            <div className="space-y-5">
              {/* Totais */}
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded border bg-gray-50 px-3 py-3" data-testid="card-analytics-total">
                  <div className="text-xs text-gray-500">Total</div>
                  <div className="text-2xl font-semibold text-gray-800">{analytics.totals.total}</div>
                </div>
                <div className="rounded border bg-green-50 px-3 py-3" data-testid="card-analytics-sent">
                  <div className="text-xs text-green-700">Enviados</div>
                  <div className="text-2xl font-semibold text-green-800">{analytics.totals.sent}</div>
                </div>
                <div className="rounded border bg-amber-50 px-3 py-3" data-testid="card-analytics-rate-limited">
                  <div className="text-xs text-amber-700">Rate-limited</div>
                  <div className="text-2xl font-semibold text-amber-800">{analytics.totals.rate_limited}</div>
                </div>
              </div>

              {/* Severidade + Canais lado-a-lado */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <div className="text-xs font-medium text-gray-600 mb-2">Por severidade</div>
                  {analytics.bySeverity.length === 0 ? (
                    <div className="text-xs text-gray-400">—</div>
                  ) : (
                    <ul className="space-y-1">
                      {analytics.bySeverity.map((s) => {
                        const cls =
                          s.severity === "CRITICAL"
                            ? "bg-red-100 text-red-800"
                            : "bg-orange-100 text-orange-800";
                        return (
                          <li
                            key={s.severity}
                            className="flex items-center justify-between text-sm"
                            data-testid={`row-analytics-severity-${s.severity}`}
                          >
                            <Badge className={`${cls} hover:${cls}`}>{s.severity}</Badge>
                            <span className="font-medium text-gray-700">{s.count}</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                <div>
                  <div className="text-xs font-medium text-gray-600 mb-2">Por canal (envios)</div>
                  {analytics.byChannel.length === 0 ? (
                    <div className="text-xs text-gray-400">—</div>
                  ) : (
                    <ul className="space-y-1">
                      {analytics.byChannel.map((c) => (
                        <li
                          key={c.channel}
                          className="flex items-center justify-between text-sm"
                          data-testid={`row-analytics-channel-${c.channel}`}
                        >
                          <span className="inline-flex items-center gap-1 text-gray-700 capitalize">
                            {c.channel === "email" && <Mail className="w-3.5 h-3.5" />}
                            {c.channel === "slack" && <MessageSquare className="w-3.5 h-3.5" />}
                            {c.channel === "whatsapp" && <Phone className="w-3.5 h-3.5" />}
                            {c.channel}
                          </span>
                          <span className="font-medium text-gray-700">{c.count}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              {/* Top alertas recorrentes */}
              <div>
                <div className="text-xs font-medium text-gray-600 mb-2">Top alertas recorrentes</div>
                {analytics.topTitles.length === 0 ? (
                  <div className="text-xs text-gray-400">—</div>
                ) : (
                  <ul className="divide-y divide-gray-100 border rounded">
                    {analytics.topTitles.map((t, idx) => (
                      <li
                        key={`${t.title}-${idx}`}
                        className="flex items-center justify-between px-3 py-2 text-sm"
                        data-testid={`row-analytics-title-${idx}`}
                      >
                        <span className="truncate text-gray-700 mr-3">{t.title}</span>
                        <Badge variant="secondary" className="shrink-0">{t.count}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Auditoria de alertas — STEP 9.3F.3 */}
      <Card data-testid="card-alert-logs">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Activity className="w-4 h-4 text-violet-600" />
            Auditoria de alertas
            {!alertLogsLoading && (
              <Badge variant="secondary" className="ml-1" data-testid="badge-alert-logs-count">
                {alertLogs.length}
              </Badge>
            )}
          </CardTitle>
          <p className="text-xs text-gray-500 mt-1">
            Últimos {alertLogs.length} eventos do sistema de alertas (volátil — limpa em cada restart). Atualiza a cada 12s.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          {alertLogsLoading ? (
            <div className="p-4 space-y-2">
              <Skeleton className="h-12 w-full rounded" />
              <Skeleton className="h-12 w-full rounded" />
            </div>
          ) : alertLogs.length === 0 ? (
            <div className="px-4 py-6 text-sm text-gray-400 text-center">
              Nenhum alerta disparado ainda.
            </div>
          ) : (
            <ul className="divide-y divide-gray-100 max-h-[480px] overflow-y-auto">
              {alertLogs.map((log, idx) => {
                const dt = new Date(log.at).toLocaleString("pt-BR", {
                  timeZone: "America/Sao_Paulo",
                });
                const sevColor =
                  log.severity === "CRITICAL"
                    ? "bg-red-100 text-red-800"
                    : "bg-orange-100 text-orange-800";
                const sevDot = log.severity === "CRITICAL" ? "🔴" : "🟠";
                const channelStats = {
                  email: log.results.filter((r) => r.channel === "email"),
                  slack: log.results.filter((r) => r.channel === "slack"),
                  whatsapp: log.results.filter((r) => r.channel === "whatsapp"),
                };
                return (
                  <li
                    key={`${log.at}-${idx}`}
                    className={`px-4 py-3 ${
                      log.suppressed ? "bg-purple-50/40" : log.rateLimited ? "bg-amber-50/40" : ""
                    }`}
                    data-testid={`row-alert-log-${idx}`}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-gray-500 w-40 shrink-0">{dt}</span>
                      <Badge className={`${sevColor} hover:${sevColor}`}>
                        {sevDot} {log.severity}
                      </Badge>
                      <span
                        className="text-sm font-medium text-gray-800 truncate"
                        data-testid={`text-alert-title-${idx}`}
                      >
                        {log.title}
                      </span>
                      {log.suppressed && (
                        <Badge
                          variant="secondary"
                          className="bg-purple-100 text-purple-800 hover:bg-purple-100 ml-auto"
                          data-testid={`badge-suppressed-${idx}`}
                        >
                          🛑 Suprimido
                        </Badge>
                      )}
                      {!log.suppressed && log.rateLimited && (
                        <Badge
                          variant="secondary"
                          className="bg-amber-100 text-amber-800 hover:bg-amber-100 ml-auto"
                          data-testid={`badge-rate-limited-${idx}`}
                        >
                          ⚠️ Bloqueado por anti-spam
                        </Badge>
                      )}
                    </div>
                    {!log.rateLimited && log.results.length > 0 && (
                      <div className="flex items-center gap-3 mt-2 ml-40 text-xs flex-wrap">
                        {channelStats.email.length > 0 && (
                          <ChannelStat
                            icon={<Mail className="w-3.5 h-3.5" />}
                            label="Email"
                            results={channelStats.email}
                          />
                        )}
                        {channelStats.slack.length > 0 && (
                          <ChannelStat
                            icon={<MessageSquare className="w-3.5 h-3.5" />}
                            label="Slack"
                            results={channelStats.slack}
                          />
                        )}
                        {channelStats.whatsapp.length > 0 && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-gray-100 text-gray-600">
                            <Phone className="w-3.5 h-3.5" /> WhatsApp ⚠️ não implementado
                          </span>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Lista de elegíveis */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <FileText className="w-4 h-4 text-emerald-600" />
              Pedidos prontos para NF-e
              {!isLoading && (
                <Badge variant="secondary" className="ml-1" data-testid="badge-eligible-count">
                  {eligible.length}
                </Badge>
              )}
            </CardTitle>
            {eligible.length > 0 && (
              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="w-4 h-4 rounded"
                  data-testid="checkbox-select-all"
                />
                Selecionar todos
              </label>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-14 w-full rounded-lg" />
              ))}
            </div>
          ) : eligible.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 text-gray-400">
              <CheckCircle2 className="w-10 h-10 mb-3 text-emerald-300" />
              <p className="font-medium">Nenhum pedido elegível no momento</p>
              <p className="text-xs mt-1">Todos os pedidos liberados já foram faturados ou aguardam ciclo.</p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {eligible.map((order) => (
                <li
                  key={order.orderId}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 cursor-pointer transition-colors"
                  onClick={() => toggleOne(order.orderId)}
                  data-testid={`row-eligible-${order.orderId}`}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(order.orderId)}
                    onChange={() => toggleOne(order.orderId)}
                    onClick={(e) => e.stopPropagation()}
                    className="w-4 h-4 rounded flex-shrink-0"
                    data-testid={`checkbox-order-${order.orderId}`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-gray-900" data-testid={`text-order-id-${order.orderId}`}>
                        Pedido #{order.orderId}
                      </span>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${TIPO_BADGE[order.faturamento.tipo] ?? "bg-gray-100 text-gray-700"}`}
                        data-testid={`badge-tipo-${order.orderId}`}
                      >
                        {order.faturamento.tipo}
                      </span>
                      {order.faturamento.prazoDias > 0 && (
                        <span className="flex items-center gap-1 text-xs text-gray-500">
                          <Clock className="w-3 h-3" />
                          {order.faturamento.prazoDias}d
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 mt-0.5 text-xs text-gray-400">
                      <Building2 className="w-3 h-3" />
                      Empresa #{order.companyId}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Ação de emissão em lote */}
      {someSelected && (
        <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3">
          <span className="text-sm font-medium text-emerald-800">
            {selected.size} pedido{selected.size > 1 ? "s" : ""} selecionado{selected.size > 1 ? "s" : ""}
          </span>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                data-testid="button-emitir-lote"
              >
                <Zap className="w-4 h-4 mr-2" />
                Emitir {selected.size} NF{selected.size > 1 ? "s" : ""}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Confirmar emissão em lote</AlertDialogTitle>
                <AlertDialogDescription>
                  Você está prestes a emitir <strong>{selected.size} NF-e{selected.size > 1 ? "s" : ""}</strong>.
                  Cada pedido passará pelo guard de faturamento antes da emissão.
                  <br /><br />
                  Esta ação não pode ser desfeita.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel data-testid="button-cancel-lote">Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleEmitir}
                  disabled={emitirLote.isPending}
                  className="bg-emerald-600 hover:bg-emerald-700"
                  data-testid="button-confirm-lote"
                >
                  {emitirLote.isPending ? "Emitindo..." : "Confirmar emissão"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}

      {/* Resultado do lote */}
      {loteResult && (
        <Card data-testid="card-lote-result">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Resultado da emissão</CardTitle>
            <div className="flex flex-wrap gap-2 mt-2">
              <span className="flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 px-2 py-1 rounded-full">
                <CheckCircle2 className="w-3 h-3" />
                {loteResult.summary.success} emitidas
              </span>
              {loteResult.summary.blocked > 0 && (
                <span className="flex items-center gap-1 text-xs font-medium text-orange-700 bg-orange-50 px-2 py-1 rounded-full">
                  <XCircle className="w-3 h-3" />
                  {loteResult.summary.blocked} bloqueadas
                </span>
              )}
              {loteResult.summary.errors > 0 && (
                <span className="flex items-center gap-1 text-xs font-medium text-red-700 bg-red-50 px-2 py-1 rounded-full">
                  <AlertCircle className="w-3 h-3" />
                  {loteResult.summary.errors} erros
                </span>
              )}
              {loteResult.summary.skipped > 0 && (
                <span className="flex items-center gap-1 text-xs font-medium text-gray-600 bg-gray-100 px-2 py-1 rounded-full">
                  <SkipForward className="w-3 h-3" />
                  {loteResult.summary.skipped} puladas
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y divide-gray-100">
              {loteResult.results.map((r) => (
                <li
                  key={r.orderId}
                  className="flex items-center gap-3 px-4 py-3"
                  data-testid={`row-result-${r.orderId}`}
                >
                  <StatusIcon status={r.status} />
                  <span className="text-sm font-medium text-gray-800 w-28">
                    Pedido #{r.orderId}
                  </span>
                  <span className="text-xs text-gray-500 flex-1 truncate">
                    {r.reason ?? (r.status === "success" ? `NF-e ${r.nfe?.numero ?? "gerada"}` : "")}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
