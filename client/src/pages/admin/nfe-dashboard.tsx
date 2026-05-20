/**
 * NF-e Dashboard — Monitoramento Operacional em Tempo Real
 * /admin/nfe/dashboard
 *
 * READ ONLY — nunca altera NF-es, nunca dispara emissão.
 * tpAmb=2 HOMOLOGAÇÃO. SEM VALOR FISCAL.
 *
 * Logs: [NFE_UI_DASHBOARD_LOAD] [NFE_UI_DASHBOARD_REFRESH]
 *       [NFE_UI_DASHBOARD_ERROR] [NFE_UI_DASHBOARD_ALERT]
 *       [NFE_UI_TIMELINE_OPEN]
 */
import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CheckCircle2, XCircle, Clock, RefreshCw, ShieldAlert, AlertTriangle,
  AlertCircle, Activity, BarChart3, TrendingUp, RotateCcw, Server,
  FileText, Shield, Send, Info, ChevronDown, ChevronUp, Zap,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

// ─── Types ────────────────────────────────────────────────────────────────────
interface Metricas {
  total_emitidas: number;
  total_autorizadas: number;
  total_rejeitadas: number;
  total_em_processamento: number;
  total_erro: number;
  taxa_autorizacao: number;
  tempo_medio_sefaz_ms: number | null;
  ultima_autorizada: string | null;
  ultima_rejeitada: string | null;
  ambiente: string;
  uptime_operacional_s: number;
  gerado_em: string;
}

interface Evento {
  nfe_id: number;
  order_id: number;
  numero: string | null;
  status: string;
  tipo: string;
  descricao: string;
  risco: "ok" | "warn" | "error" | "info";
  chave_nfe: string | null;
  protocolo: string | null;
  c_stat: string | null;
  x_motivo: string | null;
  ambiente: string;
  timestamp: string;
  created_at: string;
}

interface ErroRecente {
  id: number;
  order_id: number;
  numero: string | null;
  serie: string | null;
  status: string;
  c_stat: string | null;
  x_motivo: string | null;
  chave_nfe: string | null;
  created_at: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2, 10); }

function fmtTs(d: string | null | undefined) {
  if (!d) return "—";
  try { return format(new Date(d), "dd/MM/yyyy HH:mm:ss", { locale: ptBR }); } catch { return String(d); }
}

function fmtAgo(d: string | null | undefined) {
  if (!d) return "—";
  try { return formatDistanceToNow(new Date(d), { locale: ptBR, addSuffix: true }); } catch { return "—"; }
}

function fmtUptime(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}min` : `${m}min`;
}

function fmtMs(ms: number | null) {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ─── Status Icon ──────────────────────────────────────────────────────────────
const STATUS_ICON: Record<string, { icon: any; cls: string }> = {
  autorizada: { icon: CheckCircle2, cls: "text-green-600" },
  rejeitada:  { icon: XCircle,      cls: "text-red-600" },
  erro:       { icon: AlertCircle,  cls: "text-orange-500" },
  enviando:   { icon: Send,         cls: "text-cyan-500" },
  enviada:    { icon: Send,         cls: "text-blue-500" },
  assinada:   { icon: Shield,       cls: "text-indigo-500" },
  gerada:     { icon: FileText,     cls: "text-gray-500" },
  cancelada:  { icon: XCircle,      cls: "text-gray-400" },
};

const RISCO_LINE: Record<string, string> = {
  ok:    "border-l-4 border-green-400 bg-green-50",
  error: "border-l-4 border-red-400 bg-red-50",
  warn:  "border-l-4 border-yellow-400 bg-yellow-50",
  info:  "border-l-4 border-blue-200 bg-white",
};

// ─── Mini bar chart (CSS only) ────────────────────────────────────────────────
function MiniBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-gray-600">
        <span>{label}</span>
        <span className="font-medium">{value} ({pct}%)</span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function NfeDashboardPage() {
  const { toast } = useToast();
  const loadedRef = useRef(false);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const handler = () => setIsVisible(!document.hidden);
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, []);

  // ── Queries ───────────────────────────────────────────────────────────────
  const metricsQ = useQuery<{ ok: boolean; metricas: Metricas }>({
    queryKey: ["/api/admin/nfe/metrics"],
    refetchInterval: isVisible ? 15_000 : false,
    refetchIntervalInBackground: false,
    staleTime: 10_000,
  });

  const timelineQ = useQuery<{ ok: boolean; eventos: Evento[]; total: number }>({
    queryKey: ["/api/admin/nfe/timeline"],
    refetchInterval: isVisible ? 15_000 : false,
    refetchIntervalInBackground: false,
    staleTime: 10_000,
    enabled: timelineOpen,
  });

  const errorsQ = useQuery<{ ok: boolean; erros: ErroRecente[]; total: number }>({
    queryKey: ["/api/admin/nfe/recent-errors"],
    refetchInterval: isVisible ? 15_000 : false,
    refetchIntervalInBackground: false,
    staleTime: 10_000,
  });

  // ── Log on first load ─────────────────────────────────────────────────────
  useEffect(() => {
    if (metricsQ.data && !loadedRef.current) {
      loadedRef.current = true;
      const m = metricsQ.data.metricas;
      console.log("[NFE_UI_DASHBOARD_LOAD]", {
        corrId: uid(),
        ts: new Date().toISOString(),
        total: m.total_emitidas,
        taxa: m.taxa_autorizacao,
        ambiente: m.ambiente,
      });
    }
  }, [metricsQ.data]);

  // ── Log errors ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (metricsQ.isError) {
      console.error("[NFE_UI_DASHBOARD_ERROR]", { corrId: uid(), error: String(metricsQ.error) });
      toast({ title: "Erro ao carregar métricas", description: String(metricsQ.error), variant: "destructive" });
    }
  }, [metricsQ.isError]);

  const m = metricsQ.data?.metricas;
  const eventos = timelineQ.data?.eventos ?? [];
  const erros = errorsQ.data?.erros ?? [];

  // ── Alertas críticos ──────────────────────────────────────────────────────
  const alertas: { titulo: string; msg: string; nivel: "error" | "warn" | "info" }[] = [];

  if (m) {
    if (m.total_emitidas > 0 && m.taxa_autorizacao < 50) {
      alertas.push({ titulo: "Taxa de Autorização Crítica", msg: `Apenas ${m.taxa_autorizacao}% das NF-es foram autorizadas. Verificar configuração SEFAZ.`, nivel: "error" });
    }
    if (m.tempo_medio_sefaz_ms !== null && m.tempo_medio_sefaz_ms > 8000) {
      alertas.push({ titulo: "Latência SEFAZ Alta", msg: `Tempo médio ${fmtMs(m.tempo_medio_sefaz_ms)} — possível instabilidade no SEFAZ.`, nivel: "warn" });
    }
    if (m.total_em_processamento > 5) {
      alertas.push({ titulo: "NF-es Presas no Processamento", msg: `${m.total_em_processamento} NF-es em estado intermediário há mais de 15 min. Verificar Recovery.`, nivel: "warn" });
    }
    if (m.total_erro > 0) {
      alertas.push({ titulo: "NF-es com Erro", msg: `${m.total_erro} NF-e(s) em estado ERRO. Acesse Recovery para detalhes.`, nivel: "warn" });
    }
    if (alertas.length > 0) {
      console.log("[NFE_UI_DASHBOARD_ALERT]", { corrId: uid(), alertas: alertas.map(a => a.titulo) });
    }
  }

  function handleRefresh() {
    console.log("[NFE_UI_DASHBOARD_REFRESH]", { corrId: uid(), ts: new Date().toISOString() });
    metricsQ.refetch();
    errorsQ.refetch();
    if (timelineOpen) timelineQ.refetch();
  }

  const isFetching = metricsQ.isFetching || errorsQ.isFetching;

  return (
    <div className="space-y-5 p-1">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-blue-600" />
            Dashboard NF-e
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Monitoramento operacional em tempo real — atualização automática a cada 15s.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* HOMOLOGAÇÃO badge — sempre visível */}
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-300" data-testid="badge-homologacao">
            <Shield className="w-3 h-3" />
            HOMOLOGAÇÃO — SEM VALOR FISCAL
          </span>
          <span className="text-xs text-gray-400">
            {metricsQ.dataUpdatedAt ? fmtTs(new Date(metricsQ.dataUpdatedAt).toISOString()) : ""}
          </span>
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isFetching} data-testid="button-refresh-dashboard">
            <RefreshCw className={`w-4 h-4 mr-1 ${isFetching ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>
      </div>

      {/* Alertas críticos */}
      {alertas.length > 0 && (
        <div className="space-y-2" data-testid="section-alertas">
          {alertas.map((a, i) => (
            <Alert key={i} variant={a.nivel === "error" ? "destructive" : "default"}>
              {a.nivel === "error" ? <ShieldAlert className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
              <AlertTitle>{a.titulo}</AlertTitle>
              <AlertDescription>{a.msg}</AlertDescription>
            </Alert>
          ))}
        </div>
      )}

      {/* Metric Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <MetricCard
          label="Total Emitidas"
          value={m?.total_emitidas}
          loading={metricsQ.isLoading}
          icon={<FileText className="w-4 h-4 text-gray-500" />}
          testId="text-total-emitidas"
        />
        <MetricCard
          label="Autorizadas"
          value={m?.total_autorizadas}
          loading={metricsQ.isLoading}
          icon={<CheckCircle2 className="w-4 h-4 text-green-500" />}
          color="text-green-700"
          border="border-green-200"
          testId="text-total-autorizadas"
        />
        <MetricCard
          label="Rejeitadas"
          value={m?.total_rejeitadas}
          loading={metricsQ.isLoading}
          icon={<XCircle className="w-4 h-4 text-red-500" />}
          color={m && m.total_rejeitadas > 0 ? "text-red-700" : "text-gray-700"}
          border={m && m.total_rejeitadas > 0 ? "border-red-200" : undefined}
          testId="text-total-rejeitadas"
        />
        <MetricCard
          label="Em Processamento"
          value={m?.total_em_processamento}
          loading={metricsQ.isLoading}
          icon={<Clock className="w-4 h-4 text-yellow-500" />}
          color={m && m.total_em_processamento > 2 ? "text-yellow-700" : "text-gray-700"}
          border={m && m.total_em_processamento > 2 ? "border-yellow-200" : undefined}
          testId="text-em-processamento"
        />
        <MetricCard
          label="Taxa Autorização"
          value={m ? `${m.taxa_autorizacao}%` : undefined}
          loading={metricsQ.isLoading}
          icon={<TrendingUp className="w-4 h-4 text-blue-500" />}
          color={m && m.taxa_autorizacao >= 80 ? "text-green-700" : m && m.taxa_autorizacao >= 50 ? "text-yellow-700" : "text-red-700"}
          testId="text-taxa-autorizacao"
        />
        <MetricCard
          label="Uptime"
          value={m ? fmtUptime(m.uptime_operacional_s) : undefined}
          loading={metricsQ.isLoading}
          icon={<Server className="w-4 h-4 text-indigo-500" />}
          testId="text-uptime"
          small
        />
      </div>

      {/* Row 2: Bar chart + timing + ambiente */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Distribuição de status */}
        <Card className="md:col-span-2">
          <CardHeader className="py-3 px-4 border-b">
            <CardTitle className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <Activity className="w-4 h-4" />
              Distribuição de Status
            </CardTitle>
          </CardHeader>
          <CardContent className="py-4 px-4 space-y-3">
            {metricsQ.isLoading ? (
              <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-5 w-full" />)}</div>
            ) : m ? (
              <>
                <MiniBar label="Autorizadas" value={m.total_autorizadas} max={m.total_emitidas} color="bg-green-500" />
                <MiniBar label="Rejeitadas"  value={m.total_rejeitadas}  max={m.total_emitidas} color="bg-red-500" />
                <MiniBar label="Em processamento" value={m.total_em_processamento} max={m.total_emitidas} color="bg-yellow-400" />
                <MiniBar label="Com erro"    value={m.total_erro}        max={m.total_emitidas} color="bg-orange-400" />
              </>
            ) : (
              <p className="text-sm text-gray-400">Sem dados</p>
            )}
          </CardContent>
        </Card>

        {/* Timing + última atividade */}
        <Card>
          <CardHeader className="py-3 px-4 border-b">
            <CardTitle className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <Zap className="w-4 h-4" />
              Performance
            </CardTitle>
          </CardHeader>
          <CardContent className="py-4 px-4 space-y-4">
            {metricsQ.isLoading ? (
              <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-6 w-full" />)}</div>
            ) : m ? (
              <>
                <div>
                  <p className="text-xs text-gray-500">Tempo médio SEFAZ</p>
                  <p className={`text-xl font-bold ${m.tempo_medio_sefaz_ms && m.tempo_medio_sefaz_ms > 5000 ? "text-red-600" : "text-gray-900"}`} data-testid="text-tempo-medio">
                    {fmtMs(m.tempo_medio_sefaz_ms)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Última autorizada</p>
                  <p className="text-xs text-gray-700 font-medium" data-testid="text-ultima-autorizada">
                    {m.ultima_autorizada ? fmtAgo(m.ultima_autorizada) : "Nenhuma"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Última rejeitada</p>
                  <p className="text-xs text-gray-700 font-medium" data-testid="text-ultima-rejeitada">
                    {m.ultima_rejeitada ? fmtAgo(m.ultima_rejeitada) : "Nenhuma"}
                  </p>
                </div>
                <div className="pt-1 border-t">
                  <span className="inline-flex items-center gap-1 text-xs bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full">
                    <Shield className="w-3 h-3" />
                    {m.ambiente === "homologacao" ? "HOMOLOGAÇÃO (tpAmb=2)" : m.ambiente}
                  </span>
                </div>
              </>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {/* Últimos Erros */}
      <Card>
        <CardHeader className="py-3 px-4 border-b">
          <CardTitle className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-500" />
            Rejeições e Erros Recentes
            {!errorsQ.isLoading && (
              <Badge variant="destructive" className="ml-1 text-[10px]">
                {errorsQ.data?.total ?? 0}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {errorsQ.isLoading ? (
            <div className="p-4 space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : erros.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-gray-400" data-testid="text-no-errors">
              <CheckCircle2 className="w-8 h-8 mb-1.5 text-green-400" />
              <p className="text-sm font-medium text-gray-500">Nenhuma rejeição ou erro recente.</p>
              <p className="text-xs">Sistema operando normalmente.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50">
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-600">NF-e</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-600">Pedido</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-600">Status</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-600">cStat</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-600">Motivo SEFAZ</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-600 whitespace-nowrap">Quando</th>
                  </tr>
                </thead>
                <tbody>
                  {erros.map(e => {
                    const si = STATUS_ICON[e.status] ?? { icon: Info, cls: "text-gray-500" };
                    const Icon = si.icon;
                    return (
                      <tr key={e.id} className="border-b last:border-b-0 hover:bg-gray-50" data-testid={`row-error-${e.id}`}>
                        <td className="px-4 py-2.5 font-mono text-xs text-gray-800">#{e.id} · {e.numero ?? "—"}</td>
                        <td className="px-4 py-2.5 text-xs text-gray-600">#{e.order_id}</td>
                        <td className="px-4 py-2.5">
                          <span className={`inline-flex items-center gap-1 text-xs ${si.cls}`}>
                            <Icon className="w-3 h-3" />
                            {e.status}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs text-gray-600">{e.c_stat ?? "—"}</td>
                        <td className="px-4 py-2.5 text-xs text-gray-600 max-w-[300px] truncate" title={e.x_motivo ?? ""}>
                          {e.x_motivo ?? <span className="text-gray-300">sem motivo</span>}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">{fmtAgo(e.created_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Timeline (expansível) */}
      <Card>
        <CardHeader className="py-3 px-4 border-b">
          <button
            className="flex items-center justify-between w-full text-left"
            onClick={() => {
              const next = !timelineOpen;
              setTimelineOpen(next);
              if (next) {
                console.log("[NFE_UI_TIMELINE_OPEN]", { corrId: uid(), ts: new Date().toISOString() });
                timelineQ.refetch();
              }
            }}
            data-testid="button-toggle-timeline"
          >
            <span className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <Activity className="w-4 h-4 text-blue-500" />
              Timeline Operacional
              <span className="text-xs text-gray-400 font-normal">(últimos 100 eventos)</span>
            </span>
            {timelineOpen
              ? <ChevronUp className="w-4 h-4 text-gray-400" />
              : <ChevronDown className="w-4 h-4 text-gray-400" />
            }
          </button>
        </CardHeader>
        {timelineOpen && (
          <CardContent className="p-0">
            {timelineQ.isLoading || timelineQ.isFetching ? (
              <div className="p-4 space-y-2">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : eventos.length === 0 ? (
              <div className="py-10 flex flex-col items-center text-gray-400" data-testid="text-no-timeline">
                <Info className="w-7 h-7 mb-1.5" />
                <p className="text-sm">Nenhum evento registrado.</p>
              </div>
            ) : (
              <div className="divide-y max-h-[480px] overflow-y-auto" data-testid="list-timeline">
                {eventos.map(ev => {
                  const si = STATUS_ICON[ev.status] ?? { icon: Info, cls: "text-gray-400" };
                  const Icon = si.icon;
                  return (
                    <div
                      key={`${ev.nfe_id}-${ev.timestamp}`}
                      className={`px-4 py-2.5 flex items-start gap-3 ${RISCO_LINE[ev.risco]}`}
                      data-testid={`timeline-event-${ev.nfe_id}`}
                    >
                      <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${si.cls}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-gray-800 truncate">{ev.descricao}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <code className="text-[10px] text-gray-400 bg-gray-100 px-1 rounded">{ev.tipo}</code>
                          {ev.c_stat && (
                            <span className="text-[10px] text-gray-500">cStat {ev.c_stat}</span>
                          )}
                          {ev.protocolo && (
                            <span className="text-[10px] text-gray-400">prot: {ev.protocolo.slice(0, 12)}…</span>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-[10px] text-gray-400 whitespace-nowrap">{fmtAgo(ev.timestamp)}</p>
                        <p className="text-[10px] text-gray-300">{fmtTs(ev.timestamp).slice(0, 16)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* Footer */}
      <div className="text-xs text-gray-400 flex items-center gap-1.5">
        <RefreshCw className="w-3 h-3" />
        Atualização automática a cada 15s {!isVisible && "(pausada — aba inativa)"}
        <span className="mx-1">·</span>
        <Shield className="w-3 h-3" />
        Dashboard READ ONLY — nenhuma NF-e é alterada por esta tela
      </div>
    </div>
  );
}

// ─── MetricCard subcomponent ──────────────────────────────────────────────────
function MetricCard({
  label, value, loading, icon, color = "text-gray-900", border, testId, small = false,
}: {
  label: string;
  value?: number | string;
  loading?: boolean;
  icon?: React.ReactNode;
  color?: string;
  border?: string;
  testId?: string;
  small?: boolean;
}) {
  return (
    <Card className={border ?? ""}>
      <CardContent className="pt-4 pb-3">
        <div className="flex items-start justify-between">
          <div>
            {loading ? (
              <Skeleton className={`${small ? "h-5 w-12" : "h-8 w-14"} mb-1`} />
            ) : (
              <div className={`${small ? "text-lg" : "text-2xl"} font-bold ${color}`} data-testid={testId}>
                {value ?? "—"}
              </div>
            )}
            <div className="text-xs text-gray-500 mt-0.5">{label}</div>
          </div>
          <div className="mt-0.5">{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}
