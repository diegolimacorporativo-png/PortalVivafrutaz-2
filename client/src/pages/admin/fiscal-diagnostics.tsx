import { useQuery } from "@tanstack/react-query";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  RefreshCw, CheckCircle2, XCircle, AlertTriangle, ShieldCheck,
  KeyRound, Building2, Package, Zap, Cpu, Server, GitBranch,
  FileText, Activity, Clock, ChevronDown, ChevronUp,
  TrendingUp, TrendingDown, BarChart3, ArrowRight, Boxes
} from "lucide-react";
import { useState } from "react";

type DiagStatus = "ok" | "warning" | "error";

interface DiagCheck {
  status: DiagStatus;
  message: string;
  details?: Record<string, unknown>;
}

interface FiscalDiagnostics {
  generatedAt: string;
  sefazMode: DiagCheck;
  ambienteFiscal: DiagCheck;
  certificado: DiagCheck & {
    source?: string;
    cn?: string;
    cnpj?: string;
    razaoSocial?: string;
    validTo?: string;
    daysLeft?: number;
  };
  emitente: DiagCheck & {
    fields?: Record<string, { value: string | null; ok: boolean; label: string }>;
  };
  produtos: DiagCheck & {
    total?: number;
    semNcm?: number;
    semCfop?: number;
    semUnidade?: number;
    semEmpresaId?: number;
    exemplos?: string[];
  };
  subscriptions: DiagCheck & { total?: number };
  sequenciaNFe: DiagCheck & { lastValue?: number; nextValue?: number };
  circuitBreaker: DiagCheck & {
    state?: string;
    failures?: number;
    totalOpenings?: number;
    openedAt?: string | null;
  };
  xmlGuards: DiagCheck;
  operationalMetrics: {
    status: DiagStatus;
    message: string;
    orderPipeline: Array<{ status: string; count: number }>;
    nfePipeline: Array<{ status: string; count: number }>;
    arSummary: Array<{ status: string; count: number; total: string }>;
    apSummary: Array<{ status: string; count: number; total: string }>;
    inventoryMovements30d: number;
    totalOrderValue30d: string;
    totalARPendente: string;
    totalAPPendente: string;
  };
  workers: DiagCheck & {
    jobs?: Array<{
      name: string;
      lastStatus: string;
      totalRuns: number;
      totalErrors: number;
      lastError?: string;
      lastFinished?: string;
    }>;
  };
  pendingIssues: Array<{ severity: DiagStatus; campo: string; mensagem: string }>;
  readyForProduction: boolean;
}

// ── Status helpers ────────────────────────────────────────────────────────────

function StatusIcon({ status, size = 18 }: { status: DiagStatus; size?: number }) {
  if (status === "ok") return <CheckCircle2 size={size} className="text-emerald-500 flex-shrink-0" />;
  if (status === "warning") return <AlertTriangle size={size} className="text-amber-500 flex-shrink-0" />;
  return <XCircle size={size} className="text-red-500 flex-shrink-0" />;
}

function statusBg(status: DiagStatus) {
  if (status === "ok") return "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-800";
  if (status === "warning") return "bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-800";
  return "bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-800";
}

function statusText(status: DiagStatus) {
  if (status === "ok") return "text-emerald-700 dark:text-emerald-400";
  if (status === "warning") return "text-amber-700 dark:text-amber-400";
  return "text-red-700 dark:text-red-400";
}

function StatusBadge({ status }: { status: DiagStatus }) {
  const labels = { ok: "OK", warning: "Atenção", error: "Erro" };
  const cls = {
    ok: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
    warning: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
    error: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
  }[status];
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${cls}`}>{labels[status]}</span>;
}

// ── Section card ─────────────────────────────────────────────────────────────

function DiagCard({
  icon: Icon,
  title,
  check,
  children,
}: {
  icon: React.ElementType;
  title: string;
  check: DiagCheck;
  children?: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(check.status !== "ok");

  return (
    <div className={`border rounded-xl overflow-hidden ${statusBg(check.status)}`} data-testid={`card-diag-${title.toLowerCase().replace(/\s+/g, "-")}`}>
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
        onClick={() => setExpanded(v => !v)}
        data-testid={`button-expand-${title.toLowerCase().replace(/\s+/g, "-")}`}
      >
        <Icon size={18} className={statusText(check.status)} />
        <span className={`font-semibold text-sm flex-1 ${statusText(check.status)}`}>{title}</span>
        <StatusBadge status={check.status} />
        {expanded ? <ChevronUp size={14} className="text-muted-foreground ml-1" /> : <ChevronDown size={14} className="text-muted-foreground ml-1" />}
      </button>
      {expanded && (
        <div className="px-4 pb-4 border-t border-current/10 pt-3 space-y-2">
          <div className="flex items-start gap-2">
            <StatusIcon status={check.status} size={16} />
            <p className={`text-sm ${statusText(check.status)}`}>{check.message}</p>
          </div>
          {children}
        </div>
      )}
    </div>
  );
}

function FieldRow({ label, value, ok }: { label: string; value: string | null; ok: boolean }) {
  return (
    <div className="flex items-center justify-between py-1 border-b border-current/10 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono text-foreground max-w-[200px] truncate">{value || "—"}</span>
        {ok
          ? <CheckCircle2 size={12} className="text-emerald-500 flex-shrink-0" />
          : <XCircle size={12} className="text-red-500 flex-shrink-0" />}
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function AdminFiscalDiagnostics() {
  const { data, isLoading, isFetching, refetch, dataUpdatedAt } = useQuery<{ success: boolean; data: FiscalDiagnostics }>({
    queryKey: ["/api/admin/fiscal/diagnostics"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin/fiscal/diagnostics");
      if (!res.ok) throw new Error("Falha ao carregar diagnóstico");
      return res.json();
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const diag = data?.data;
  const errorCount = diag?.pendingIssues.filter(i => i.severity === "error").length ?? 0;
  const warnCount = diag?.pendingIssues.filter(i => i.severity === "warning").length ?? 0;
  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString("pt-BR") : null;

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground flex items-center gap-2">
            <Activity className="w-6 h-6 text-primary" />
            Diagnóstico Fiscal
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Verificação completa de todos os pré-requisitos para emissão real de NF-e no SEFAZ
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          data-testid="button-refresh-diagnostics"
          className="flex-shrink-0"
        >
          <RefreshCw size={14} className={`mr-2 ${isFetching ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      {/* Status geral */}
      {diag && (
        <div className={`rounded-xl border p-4 flex items-center gap-4 ${diag.readyForProduction ? "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-800" : "bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-800"}`} data-testid="card-overall-status">
          <div className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 ${diag.readyForProduction ? "bg-emerald-100 dark:bg-emerald-900/40" : "bg-amber-100 dark:bg-amber-900/40"}`}>
            {diag.readyForProduction
              ? <CheckCircle2 className="text-emerald-600" size={24} />
              : <AlertTriangle className="text-amber-600" size={24} />}
          </div>
          <div className="flex-1">
            <p className={`font-bold text-base ${diag.readyForProduction ? "text-emerald-800 dark:text-emerald-300" : "text-amber-800 dark:text-amber-300"}`}>
              {diag.readyForProduction ? "Sistema pronto para produção SEFAZ" : "Pendências antes de ativar produção"}
            </p>
            <p className="text-sm text-muted-foreground mt-0.5">
              {errorCount > 0 && <span className="text-red-600 font-medium">{errorCount} erro(s) crítico(s)</span>}
              {errorCount > 0 && warnCount > 0 && " · "}
              {warnCount > 0 && <span className="text-amber-600 font-medium">{warnCount} aviso(s)</span>}
              {errorCount === 0 && warnCount === 0 && <span className="text-emerald-600">Todos os checks passaram</span>}
              {lastUpdated && <span className="ml-2 text-xs text-muted-foreground">· Atualizado às {lastUpdated}</span>}
            </p>
          </div>
        </div>
      )}

      {isLoading && (
        <div className="flex items-center justify-center py-16 text-muted-foreground gap-3">
          <RefreshCw size={20} className="animate-spin" />
          <span>Verificando pré-requisitos fiscais...</span>
        </div>
      )}

      {diag && (
        <div className="space-y-3">
          {/* Ambiente */}
          <DiagCard icon={Server} title="Ambiente SEFAZ" check={diag.sefazMode}>
            <div className="mt-2 space-y-1">
              <FieldRow label="NFE_SEFAZ_MODE" value={(diag.sefazMode.details?.valor as string) ?? (diag.readyForProduction ? "production" : "mock")} ok={diag.sefazMode.status === "ok"} />
              <FieldRow label="Ambiente fiscal" value={(diag.ambienteFiscal.details?.ambienteFiscal as string) ?? "homologacao"} ok={diag.ambienteFiscal.status !== "error"} />
              <FieldRow label="tpAmb" value={(diag.ambienteFiscal.details?.ambienteFiscal as string) === "producao" ? "1 (Produção)" : "2 (Homologação)"} ok />
            </div>
          </DiagCard>

          {/* Certificado */}
          <DiagCard icon={KeyRound} title="Certificado Digital A1" check={diag.certificado}>
            <div className="mt-2 space-y-1">
              <FieldRow label="Fonte" value={diag.certificado.source ?? "—"} ok={diag.certificado.status !== "error"} />
              {diag.certificado.razaoSocial && <FieldRow label="Razão Social" value={diag.certificado.razaoSocial} ok />}
              {diag.certificado.cnpj && <FieldRow label="CNPJ do cert" value={diag.certificado.cnpj} ok />}
              {diag.certificado.validTo && (
                <FieldRow
                  label="Válido até"
                  value={new Date(diag.certificado.validTo).toLocaleDateString("pt-BR")}
                  ok={(diag.certificado.daysLeft ?? 0) > 0}
                />
              )}
              {diag.certificado.daysLeft !== undefined && (
                <FieldRow
                  label="Dias restantes"
                  value={`${diag.certificado.daysLeft} dia(s)`}
                  ok={(diag.certificado.daysLeft ?? 0) > 30}
                />
              )}
            </div>
            {diag.certificado.status === "error" && (
              <div className="mt-2 p-2 bg-red-100 dark:bg-red-950/30 rounded-lg">
                <p className="text-xs text-red-700 dark:text-red-400">
                  Faça o upload do certificado A1 (.pfx) em <strong>Configurações Fiscais → Certificado Digital</strong>
                </p>
              </div>
            )}
          </DiagCard>

          {/* Emitente */}
          <DiagCard icon={Building2} title="Emitente (Dados Fiscais)" check={diag.emitente}>
            {diag.emitente.fields && (
              <div className="mt-2 space-y-1">
                {Object.entries(diag.emitente.fields).map(([key, f]) => (
                  <FieldRow key={key} label={f.label} value={f.value} ok={f.ok} />
                ))}
              </div>
            )}
            {diag.emitente.status === "error" && (
              <div className="mt-2 p-2 bg-red-100 dark:bg-red-950/30 rounded-lg">
                <p className="text-xs text-red-700 dark:text-red-400">
                  Corrija os campos em <strong>Configurações Fiscais</strong>
                </p>
              </div>
            )}
          </DiagCard>

          {/* Produtos */}
          <DiagCard icon={Package} title="Produtos (NCM / CFOP / Unidade)" check={diag.produtos}>
            <div className="mt-2 space-y-1">
              <FieldRow label="Total de produtos" value={String(diag.produtos.total ?? 0)} ok={(diag.produtos.total ?? 0) > 0} />
              <FieldRow label="Sem NCM" value={String(diag.produtos.semNcm ?? 0)} ok={(diag.produtos.semNcm ?? 0) === 0} />
              <FieldRow label="Sem CFOP" value={String(diag.produtos.semCfop ?? 0)} ok={(diag.produtos.semCfop ?? 0) === 0} />
              <FieldRow label="Sem unidade comercial" value={String(diag.produtos.semUnidade ?? 0)} ok={(diag.produtos.semUnidade ?? 0) === 0} />
              <FieldRow label="Sem empresa_id" value={String(diag.produtos.semEmpresaId ?? 0)} ok={(diag.produtos.semEmpresaId ?? 0) === 0} />
            </div>
            {diag.produtos.exemplos && diag.produtos.exemplos.length > 0 && (
              <div className="mt-2 p-2 bg-amber-100 dark:bg-amber-950/30 rounded-lg">
                <p className="text-xs text-amber-700 dark:text-amber-400 font-medium mb-1">Exemplos com pendência:</p>
                <ul className="text-xs text-amber-700 dark:text-amber-400 space-y-0.5">
                  {diag.produtos.exemplos.map((e, i) => <li key={i}>· {e}</li>)}
                </ul>
              </div>
            )}
          </DiagCard>

          {/* Assinaturas */}
          <DiagCard icon={ShieldCheck} title="Assinaturas" check={diag.subscriptions}>
            <div className="mt-2 space-y-1">
              <FieldRow label="Assinaturas ativas" value={String(diag.subscriptions.total ?? 0)} ok={(diag.subscriptions.total ?? 0) > 0} />
            </div>
          </DiagCard>

          {/* Sequência NF-e */}
          <DiagCard icon={FileText} title="Sequência NF-e" check={diag.sequenciaNFe}>
            <div className="mt-2 space-y-1">
              <FieldRow label="Último número emitido" value={String(diag.sequenciaNFe.lastValue ?? "—")} ok={diag.sequenciaNFe.status !== "error"} />
              <FieldRow label="Próximo número" value={String(diag.sequenciaNFe.nextValue ?? "—")} ok={diag.sequenciaNFe.status !== "error"} />
            </div>
          </DiagCard>

          {/* Circuit Breaker */}
          <DiagCard icon={GitBranch} title="Circuit Breaker SEFAZ" check={diag.circuitBreaker}>
            <div className="mt-2 space-y-1">
              <FieldRow label="Estado" value={diag.circuitBreaker.state ?? "—"} ok={diag.circuitBreaker.state === "closed"} />
              <FieldRow label="Falhas consecutivas" value={String(diag.circuitBreaker.failures ?? 0)} ok={(diag.circuitBreaker.failures ?? 0) === 0} />
              <FieldRow label="Total de aberturas" value={String(diag.circuitBreaker.totalOpenings ?? 0)} ok />
              {diag.circuitBreaker.openedAt && (
                <FieldRow label="Aberto em" value={new Date(diag.circuitBreaker.openedAt).toLocaleString("pt-BR")} ok={false} />
              )}
            </div>
          </DiagCard>

          {/* XML Guards */}
          <DiagCard icon={Zap} title="Validadores XML" check={diag.xmlGuards}>
            {Array.isArray(diag.xmlGuards.details?.guards) && (
              <div className="mt-2 flex flex-wrap gap-1">
                {(diag.xmlGuards.details!.guards as string[]).map(g => (
                  <span key={g} className="text-xs bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 rounded-full font-mono">
                    {g}
                  </span>
                ))}
              </div>
            )}
          </DiagCard>

          {/* Métricas Operacionais */}
          {diag.operationalMetrics && (
            <div className="border border-border rounded-xl overflow-hidden bg-card" data-testid="card-operational-metrics">
              <div className="px-4 py-3 border-b border-border bg-muted/30">
                <div className="flex items-center gap-2">
                  <BarChart3 size={16} className="text-primary" />
                  <span className="font-semibold text-sm text-foreground">Operação em Tempo Real</span>
                </div>
              </div>
              <div className="p-4 space-y-4">
                {/* KPIs em linha */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-muted/40 rounded-lg p-3 text-center" data-testid="kpi-order-value">
                    <p className="text-xs text-muted-foreground mb-1">Volume 30 dias</p>
                    <p className="text-lg font-bold text-foreground">
                      {parseFloat(diag.operationalMetrics.totalOrderValue30d).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                    </p>
                  </div>
                  <div className={`rounded-lg p-3 text-center ${parseFloat(diag.operationalMetrics.totalARPendente) > 0 ? "bg-amber-50 dark:bg-amber-950/20" : "bg-muted/40"}`} data-testid="kpi-ar-pendente">
                    <p className="text-xs text-muted-foreground mb-1 flex items-center justify-center gap-1">
                      <TrendingUp size={10} className="text-emerald-500" /> A Receber
                    </p>
                    <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                      {parseFloat(diag.operationalMetrics.totalARPendente).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                    </p>
                  </div>
                  <div className={`rounded-lg p-3 text-center ${parseFloat(diag.operationalMetrics.totalAPPendente) > 0 ? "bg-red-50 dark:bg-red-950/20" : "bg-muted/40"}`} data-testid="kpi-ap-pendente">
                    <p className="text-xs text-muted-foreground mb-1 flex items-center justify-center gap-1">
                      <TrendingDown size={10} className="text-red-500" /> A Pagar
                    </p>
                    <p className="text-lg font-bold text-red-600 dark:text-red-400">
                      {parseFloat(diag.operationalMetrics.totalAPPendente).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                    </p>
                  </div>
                  <div className="bg-muted/40 rounded-lg p-3 text-center" data-testid="kpi-inventory-movements">
                    <p className="text-xs text-muted-foreground mb-1 flex items-center justify-center gap-1">
                      <Boxes size={10} /> Mov. Estoque 30d
                    </p>
                    <p className="text-lg font-bold text-foreground">{diag.operationalMetrics.inventoryMovements30d}</p>
                  </div>
                </div>

                {/* Pipeline de Pedidos */}
                {diag.operationalMetrics.orderPipeline.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Pipeline de Pedidos</p>
                    <div className="flex flex-wrap gap-2">
                      {diag.operationalMetrics.orderPipeline.map(p => {
                        const colors: Record<string, string> = {
                          CREATED: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
                          APPROVED: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400",
                          INVOICED: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
                          DELIVERED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
                          CANCELLED: "bg-gray-100 text-gray-600 dark:bg-gray-900/30 dark:text-gray-400",
                          SHIPPED: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400",
                          PENDING_APPROVAL: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
                        };
                        const cls = colors[p.status] ?? "bg-muted text-muted-foreground";
                        return (
                          <div key={p.status} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${cls}`} data-testid={`badge-order-status-${p.status}`}>
                            <span>{p.status}</span>
                            <span className="font-bold">{p.count}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Pipeline NF-e */}
                {diag.operationalMetrics.nfePipeline.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Pipeline NF-e</p>
                    <div className="flex flex-wrap gap-2">
                      {diag.operationalMetrics.nfePipeline.map(p => {
                        const colors: Record<string, string> = {
                          autorizada: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
                          gerada: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
                          rejeitada: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
                          cancelada: "bg-gray-100 text-gray-600 dark:bg-gray-900/30 dark:text-gray-400",
                          erro: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
                          enviada: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
                        };
                        const cls = colors[p.status] ?? "bg-muted text-muted-foreground";
                        return (
                          <div key={p.status} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${cls}`} data-testid={`badge-nfe-status-${p.status}`}>
                            <FileText size={10} />
                            <span>{p.status}</span>
                            <span className="font-bold">{p.count}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* AR Summary */}
                {diag.operationalMetrics.arSummary.length > 0 && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Contas a Receber</p>
                      <div className="space-y-1">
                        {diag.operationalMetrics.arSummary.map(s => (
                          <div key={s.status} className="flex items-center justify-between text-xs" data-testid={`row-ar-${s.status}`}>
                            <span className="text-muted-foreground capitalize">{s.status}</span>
                            <div className="flex items-center gap-2">
                              <span className="text-muted-foreground text-[10px]">({s.count}x)</span>
                              <span className={`font-semibold ${s.status === "vencido" ? "text-red-600" : s.status === "pago" ? "text-emerald-600" : "text-foreground"}`}>
                                {parseFloat(s.total).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    {diag.operationalMetrics.apSummary.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Contas a Pagar</p>
                        <div className="space-y-1">
                          {diag.operationalMetrics.apSummary.map(s => (
                            <div key={s.status} className="flex items-center justify-between text-xs" data-testid={`row-ap-${s.status}`}>
                              <span className="text-muted-foreground capitalize">{s.status}</span>
                              <div className="flex items-center gap-2">
                                <span className="text-muted-foreground text-[10px]">({s.count}x)</span>
                                <span className={`font-semibold ${s.status === "vencido" ? "text-red-600" : s.status === "pago" ? "text-emerald-600" : "text-foreground"}`}>
                                  {parseFloat(s.total).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Workers */}
          <DiagCard icon={Cpu} title="Workers / Background Jobs" check={diag.workers}>
            {diag.workers.jobs && diag.workers.jobs.length > 0 && (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-xs" data-testid="table-workers">
                  <thead>
                    <tr className="border-b border-current/10">
                      <th className="text-left py-1 pr-3 font-medium text-muted-foreground">Worker</th>
                      <th className="text-left py-1 pr-3 font-medium text-muted-foreground">Status</th>
                      <th className="text-left py-1 pr-3 font-medium text-muted-foreground">Execuções</th>
                      <th className="text-left py-1 font-medium text-muted-foreground">Erros</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diag.workers.jobs.map((j, i) => (
                      <tr key={i} className="border-b border-current/5 last:border-0" data-testid={`row-worker-${j.name}`}>
                        <td className="py-1 pr-3 font-mono text-foreground">{j.name}</td>
                        <td className="py-1 pr-3">
                          <span className={`inline-flex items-center gap-1 ${j.lastStatus === "ok" ? "text-emerald-600" : j.lastStatus === "error" ? "text-red-600" : j.lastStatus === "running" ? "text-blue-600" : "text-muted-foreground"}`}>
                            {j.lastStatus === "ok" && <CheckCircle2 size={10} />}
                            {j.lastStatus === "error" && <XCircle size={10} />}
                            {j.lastStatus === "idle" && <Clock size={10} />}
                            {j.lastStatus}
                          </span>
                        </td>
                        <td className="py-1 pr-3 text-muted-foreground">{j.totalRuns}</td>
                        <td className="py-1 text-muted-foreground">{j.totalErrors > 0 ? <span className="text-red-600 font-semibold">{j.totalErrors}</span> : 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {diag.workers.jobs?.length === 0 && (
              <p className="text-xs text-muted-foreground mt-2">Nenhum worker registrado ainda — os jobs aparecem aqui após a primeira execução.</p>
            )}
          </DiagCard>
        </div>
      )}

      {/* Tabela de pendências */}
      {diag && diag.pendingIssues.length > 0 && (
        <Card data-testid="card-pending-issues">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle size={16} className="text-amber-500" />
              Pendências ({diag.pendingIssues.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {diag.pendingIssues.map((issue, i) => (
                <div key={i} className={`flex items-start gap-3 p-3 rounded-lg border ${statusBg(issue.severity)}`} data-testid={`row-issue-${i}`}>
                  <StatusIcon status={issue.severity} size={14} />
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-semibold ${statusText(issue.severity)}`}>{issue.campo}</p>
                    <p className={`text-xs mt-0.5 ${statusText(issue.severity)}`}>{issue.mensagem}</p>
                  </div>
                  <StatusBadge status={issue.severity} />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Próximos passos */}
      {diag && !diag.readyForProduction && (
        <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-800" data-testid="card-next-steps">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-blue-700 dark:text-blue-400 flex items-center gap-2">
              <ShieldCheck size={15} />
              Para ativar produção SEFAZ
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-blue-700 dark:text-blue-400 space-y-2">
            {diag.certificado.status === "error" && (
              <p>1. Faça o upload do certificado A1 (.pfx) em <strong>Configurações Fiscais → Certificado Digital A1</strong></p>
            )}
            {diag.emitente.status === "error" && (
              <p>{diag.certificado.status === "error" ? "2" : "1"}. Preencha todos os dados do emitente em <strong>Configurações Fiscais</strong></p>
            )}
            {diag.sefazMode.status !== "ok" && (
              <p>Adicione <strong>NFE_SEFAZ_MODE = production</strong> nos Secrets do Replit para ativar a transmissão real</p>
            )}
            <p className="text-blue-600 dark:text-blue-500 font-medium">O ambiente está configurado como homologação (tpAmb=2) — seguro para testes sem impacto fiscal real.</p>
          </CardContent>
        </Card>
      )}

      {/* Rodapé */}
      {diag && (
        <p className="text-xs text-muted-foreground text-center" data-testid="text-generated-at">
          Diagnóstico gerado em {new Date(diag.generatedAt).toLocaleString("pt-BR")} · NÃO altera nenhuma configuração
        </p>
      )}
    </div>
  );
}
