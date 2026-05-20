/**
 * NF-e Recovery — Monitoramento Operacional
 * GET /api/admin/nfe/recovery
 * POST /api/admin/nfe/recovery/:id/reprocess
 * POST /api/admin/nfe/recovery/:id/mark-error
 *
 * Logs: [NFE_UI_RECOVERY_LOAD] [NFE_UI_REPROCESS_CLICK] [NFE_UI_REPROCESS_SUCCESS]
 *       [NFE_UI_REPROCESS_FAILED] [NFE_UI_MARK_ERROR] [NFE_UI_REFRESH]
 */
import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  RotateCcw, AlertTriangle, CheckCircle2, XCircle, AlertCircle,
  RefreshCw, Search, FileText, Shield, Send, Clock, Info, ShieldAlert,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

// ─── Types ────────────────────────────────────────────────────────────────────
type RecoveryRisk = "RECOVERABLE" | "MANUAL_ACTION_REQUIRED" | "CRITICAL";

interface RecoveryItem {
  order_id: number;
  nfe_id: number;
  numero: string;
  serie: string;
  status: string;
  chave: string | null;
  protocolo: string | null;
  c_stat: string | null;
  x_motivo: string | null;
  idade_min: number;
  ultimo_update: string;
  ambiente: string;
  recovery_type: string;
  risco: RecoveryRisk;
  recomendacao: string;
  has_xml: boolean;
  has_xml_autorizado: boolean;
}

interface RecoveryScanResult {
  ok: boolean;
  items: RecoveryItem[];
  total: number;
  scanned_at: string;
  by_risco: { RECOVERABLE: number; MANUAL_ACTION_REQUIRED: number; CRITICAL: number };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  try { return format(new Date(d), "dd/MM/yyyy HH:mm", { locale: ptBR }); } catch { return String(d); }
}

function fmtIdade(min: number) {
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

// ─── Badge components ─────────────────────────────────────────────────────────
const RISCO_MAP: Record<RecoveryRisk, { label: string; cls: string; icon: any }> = {
  RECOVERABLE: { label: "Recuperável", cls: "bg-blue-100 text-blue-800 border-blue-200", icon: RotateCcw },
  MANUAL_ACTION_REQUIRED: { label: "Ação Manual", cls: "bg-yellow-100 text-yellow-800 border-yellow-200", icon: AlertTriangle },
  CRITICAL: { label: "CRÍTICO", cls: "bg-red-100 text-red-900 border-red-300 font-bold", icon: ShieldAlert },
};

const STATUS_MAP: Record<string, { label: string; cls: string; icon: any }> = {
  gerada:     { label: "Gerada",    cls: "bg-blue-50 text-blue-700",   icon: FileText },
  assinada:   { label: "Assinada",  cls: "bg-indigo-50 text-indigo-700", icon: Shield },
  enviando:   { label: "Enviando",  cls: "bg-cyan-50 text-cyan-700",   icon: Send },
  enviada:    { label: "Enviada",   cls: "bg-yellow-50 text-yellow-700", icon: Send },
  autorizada: { label: "Autorizada",cls: "bg-green-50 text-green-700", icon: CheckCircle2 },
  rejeitada:  { label: "Rejeitada", cls: "bg-red-50 text-red-700",     icon: AlertCircle },
  erro:       { label: "Erro",      cls: "bg-orange-50 text-orange-700", icon: AlertCircle },
  cancelada:  { label: "Cancelada", cls: "bg-gray-50 text-gray-600",   icon: XCircle },
};

function RiscoBadge({ risco }: { risco: RecoveryRisk }) {
  const r = RISCO_MAP[risco] ?? { label: risco, cls: "bg-gray-100 text-gray-700", icon: Info };
  const Icon = r.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border ${r.cls}`}>
      <Icon className="w-3 h-3" />
      {r.label}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_MAP[status] ?? { label: status, cls: "bg-gray-50 text-gray-700", icon: Info };
  const Icon = s.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${s.cls}`}>
      <Icon className="w-3 h-3" />
      {s.label}
    </span>
  );
}

function AmbienteBadge() {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-amber-50 text-amber-700 border border-amber-200">
      <Shield className="w-3 h-3" />
      HOMOLOGAÇÃO
    </span>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function NfeRecoveryPage() {
  const { toast } = useToast();

  // Tab visibility — pause auto-refresh when hidden (ETAPA 6)
  const [isVisible, setIsVisible] = useState(true);
  useEffect(() => {
    const handler = () => setIsVisible(!document.hidden);
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, []);

  // Filters
  const [search, setSearch] = useState("");
  const [filterRisco, setFilterRisco] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");

  // Reprocess confirm dialog
  const [reprocessTarget, setReprocessTarget] = useState<RecoveryItem | null>(null);
  const [reprocessResult, setReprocessResult] = useState<any>(null);

  // Mark-error dialog
  const [markErrorTarget, setMarkErrorTarget] = useState<RecoveryItem | null>(null);
  const [markErrorMotivo, setMarkErrorMotivo] = useState("");

  const loadedRef = useRef(false);

  // ── Query: scan recovery ────────────────────────────────────────────────────
  const { data, isLoading, isFetching, refetch, dataUpdatedAt } = useQuery<RecoveryScanResult>({
    queryKey: ["/api/admin/nfe/recovery"],
    refetchInterval: isVisible ? 30_000 : false,
    refetchIntervalInBackground: false,
    staleTime: 20_000,
  });

  useEffect(() => {
    if (data && !loadedRef.current) {
      loadedRef.current = true;
      console.log("[NFE_UI_RECOVERY_LOAD]", {
        corrId: uid(),
        total: data.total,
        by_risco: data.by_risco,
        scanned_at: data.scanned_at,
      });
    }
  }, [data]);

  // ── Mutation: reprocess ─────────────────────────────────────────────────────
  const reprocessMutation = useMutation({
    mutationFn: (nfeId: number) =>
      apiRequest("POST", `/api/admin/nfe/recovery/${nfeId}/reprocess`),
    onSuccess: (result: any, nfeId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/nfe/recovery"] });
      setReprocessResult(result);
      if (result?.retorno?.persistWarning) {
        console.error("[NFE_UI_REPROCESS_PERSIST_WARNING]", { corrId: uid(), nfe_id: nfeId, result });
      }
      console.log("[NFE_UI_REPROCESS_SUCCESS]", {
        corrId: uid(), nfe_id: nfeId,
        status: result?.retorno?.status, cStat: result?.retorno?.cStat,
      });
      const success = result?.success;
      toast({
        title: success ? "NF-e Autorizada" : "Reprocessamento Concluído",
        description: result?.mensagem ?? (success ? "NF-e autorizada com sucesso." : "Verifique o status da NF-e."),
        variant: success ? "default" : "destructive",
      });
    },
    onError: (err: any, nfeId) => {
      console.error("[NFE_UI_REPROCESS_FAILED]", { corrId: uid(), nfe_id: nfeId, error: err?.message });
      const msg = err?.message ?? "Erro ao reprocessar NF-e.";
      toast({ title: "Falha no Reprocessamento", description: msg, variant: "destructive" });
    },
  });

  // ── Mutation: mark-error ────────────────────────────────────────────────────
  const markErrorMutation = useMutation({
    mutationFn: ({ nfeId, motivo }: { nfeId: number; motivo: string }) =>
      apiRequest("POST", `/api/admin/nfe/recovery/${nfeId}/mark-error`, { motivo }),
    onSuccess: (_: any, { nfeId }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/nfe/recovery"] });
      setMarkErrorTarget(null);
      setMarkErrorMotivo("");
      console.log("[NFE_UI_MARK_ERROR]", { corrId: uid(), nfe_id: nfeId });
      toast({ title: "NF-e Marcada como Erro", description: "Status atualizado. Dados preservados." });
    },
    onError: (err: any) => {
      toast({ title: "Falha", description: err?.message ?? "Erro ao marcar NF-e.", variant: "destructive" });
    },
  });

  // ── Filtered items ──────────────────────────────────────────────────────────
  const items: RecoveryItem[] = data?.items ?? [];
  const filtered = items.filter((it) => {
    if (filterRisco !== "all" && it.risco !== filterRisco) return false;
    if (filterStatus !== "all" && it.status !== filterStatus) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        String(it.nfe_id).includes(q) ||
        String(it.order_id).includes(q) ||
        (it.chave ?? "").toLowerCase().includes(q) ||
        it.recovery_type.toLowerCase().includes(q) ||
        it.status.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const criticalCount = data?.by_risco?.CRITICAL ?? 0;
  const recoverableCount = data?.by_risco?.RECOVERABLE ?? 0;
  const manualCount = data?.by_risco?.MANUAL_ACTION_REQUIRED ?? 0;

  // ── Can reprocess: RECOVERABLE with xml ─────────────────────────────────────
  function canReprocess(item: RecoveryItem) {
    return item.risco === "RECOVERABLE" && item.has_xml && ["assinada", "enviando"].includes(item.status);
  }

  // ── Can mark-error: not autorizada/cancelada/denegada ───────────────────────
  function canMarkError(item: RecoveryItem) {
    return !["autorizada", "cancelada", "denegada"].includes(item.status);
  }

  return (
    <div className="space-y-5 p-1">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <RotateCcw className="w-6 h-6 text-blue-600" />
            Recovery NF-e
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Monitoramento operacional de NF-es travadas, órfãs ou com inconsistências.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">
            {dataUpdatedAt ? `Atualizado ${format(new Date(dataUpdatedAt), "HH:mm:ss")}` : ""}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              console.log("[NFE_UI_REFRESH]", { corrId: uid(), ts: new Date().toISOString() });
              refetch();
            }}
            disabled={isFetching}
            data-testid="button-refresh-recovery"
          >
            <RefreshCw className={`w-4 h-4 mr-1 ${isFetching ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>
      </div>

      {/* CRITICAL alert */}
      {criticalCount > 0 && (
        <Alert variant="destructive" data-testid="alert-critical-recovery">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Situação Crítica Detectada</AlertTitle>
          <AlertDescription>
            {criticalCount} NF-e(s) em estado CRÍTICO — NF-e autorizada sem protocolo ou chave fiscal.
            Acionar suporte técnico imediatamente.
          </AlertDescription>
        </Alert>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-2xl font-bold text-gray-900" data-testid="text-total-recovery">
              {isLoading ? <Skeleton className="h-7 w-12" /> : data?.total ?? 0}
            </div>
            <div className="text-xs text-gray-500 mt-0.5">Total identificados</div>
          </CardContent>
        </Card>
        <Card className="border-red-200">
          <CardContent className="pt-4 pb-3">
            <div className="text-2xl font-bold text-red-700" data-testid="text-critical-count">
              {isLoading ? <Skeleton className="h-7 w-8" /> : criticalCount}
            </div>
            <div className="text-xs text-red-500 mt-0.5">Críticos</div>
          </CardContent>
        </Card>
        <Card className="border-blue-200">
          <CardContent className="pt-4 pb-3">
            <div className="text-2xl font-bold text-blue-700" data-testid="text-recoverable-count">
              {isLoading ? <Skeleton className="h-7 w-8" /> : recoverableCount}
            </div>
            <div className="text-xs text-blue-500 mt-0.5">Recuperáveis</div>
          </CardContent>
        </Card>
        <Card className="border-yellow-200">
          <CardContent className="pt-4 pb-3">
            <div className="text-2xl font-bold text-yellow-700" data-testid="text-manual-count">
              {isLoading ? <Skeleton className="h-7 w-8" /> : manualCount}
            </div>
            <div className="text-xs text-yellow-600 mt-0.5">Ação Manual</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Buscar por NF-e ID, pedido, chave ou tipo..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9 text-sm"
            data-testid="input-search-recovery"
          />
        </div>
        <Select value={filterRisco} onValueChange={setFilterRisco}>
          <SelectTrigger className="w-44 h-9 text-sm" data-testid="select-filter-risco">
            <SelectValue placeholder="Filtrar por risco" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os riscos</SelectItem>
            <SelectItem value="RECOVERABLE">Recuperável</SelectItem>
            <SelectItem value="MANUAL_ACTION_REQUIRED">Ação Manual</SelectItem>
            <SelectItem value="CRITICAL">Crítico</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-40 h-9 text-sm" data-testid="select-filter-status">
            <SelectValue placeholder="Filtrar por status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            <SelectItem value="gerada">Gerada</SelectItem>
            <SelectItem value="assinada">Assinada</SelectItem>
            <SelectItem value="enviando">Enviando</SelectItem>
            <SelectItem value="enviada">Enviada</SelectItem>
            <SelectItem value="autorizada">Autorizada</SelectItem>
            <SelectItem value="rejeitada">Rejeitada</SelectItem>
            <SelectItem value="erro">Erro</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardHeader className="py-3 px-4 border-b">
          <CardTitle className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            {isLoading ? "Carregando..." : `${filtered.length} ocorrência(s)${filtered.length !== items.length ? ` de ${items.length}` : ""}`}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[1,2,3].map(i => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 text-gray-400" data-testid="text-empty-recovery">
              <CheckCircle2 className="w-10 h-10 mb-2 text-green-400" />
              <p className="text-sm font-medium text-gray-500">
                {items.length === 0 ? "Nenhuma NF-e com problemas detectada." : "Nenhum resultado para os filtros aplicados."}
              </p>
              <p className="text-xs mt-1">
                {items.length === 0 ? "Sistema operando normalmente." : "Limpe os filtros para ver todos os itens."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50">
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-600 whitespace-nowrap">Risco</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-600">NF-e / Pedido</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-600">Status</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-600">Tipo Recovery</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-600">Chave / Protocolo</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-600 whitespace-nowrap">cStat</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-600 whitespace-nowrap">Idade</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-600 whitespace-nowrap">Ambiente</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-600 whitespace-nowrap">Último update</th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-600">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item) => (
                    <tr
                      key={item.nfe_id}
                      className={`border-b last:border-b-0 hover:bg-gray-50 transition-colors ${item.risco === "CRITICAL" ? "bg-red-50/40" : ""}`}
                      data-testid={`row-recovery-${item.nfe_id}`}
                    >
                      <td className="px-4 py-3">
                        <RiscoBadge risco={item.risco} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-mono text-xs text-gray-900">NF-e #{item.nfe_id}</div>
                        <div className="text-xs text-gray-500">Pedido #{item.order_id} · Série {item.serie} · Nº {item.numero}</div>
                        <div
                          className="text-xs mt-0.5 text-gray-400 max-w-[260px] truncate"
                          title={item.recomendacao}
                        >
                          {item.recomendacao}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={item.status} />
                        {item.has_xml && (
                          <div className="text-[10px] text-blue-500 mt-0.5">XML disponível</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded text-gray-700 whitespace-nowrap">
                          {item.recovery_type}
                        </code>
                      </td>
                      <td className="px-4 py-3 max-w-[180px]">
                        {item.chave ? (
                          <div className="font-mono text-[10px] text-gray-600 truncate" title={item.chave}>
                            {item.chave.slice(0, 20)}…
                          </div>
                        ) : (
                          <span className="text-gray-300 text-xs">sem chave</span>
                        )}
                        {item.protocolo && (
                          <div className="text-[10px] text-gray-400 mt-0.5">prot: {item.protocolo}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {item.c_stat ? (
                          <span className="font-mono text-xs text-gray-700">{item.c_stat}</span>
                        ) : (
                          <span className="text-gray-300 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`text-xs flex items-center gap-1 ${item.idade_min > 60 ? "text-red-600 font-medium" : "text-gray-600"}`}>
                          <Clock className="w-3 h-3" />
                          {fmtIdade(item.idade_min)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <AmbienteBadge />
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                        {fmtDate(item.ultimo_update)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 justify-end flex-wrap">
                          {canReprocess(item) && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs border-blue-300 text-blue-700 hover:bg-blue-50"
                              disabled={reprocessMutation.isPending}
                              onClick={() => {
                                console.log("[NFE_UI_REPROCESS_CLICK]", { corrId: uid(), nfe_id: item.nfe_id, order_id: item.order_id });
                                setReprocessTarget(item);
                                setReprocessResult(null);
                              }}
                              data-testid={`button-reprocess-${item.nfe_id}`}
                            >
                              <RotateCcw className="w-3 h-3 mr-1" />
                              Reprocessar
                            </Button>
                          )}
                          {canMarkError(item) && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs border-orange-300 text-orange-700 hover:bg-orange-50"
                              disabled={markErrorMutation.isPending}
                              onClick={() => {
                                setMarkErrorTarget(item);
                                setMarkErrorMotivo("");
                              }}
                              data-testid={`button-mark-error-${item.nfe_id}`}
                            >
                              <XCircle className="w-3 h-3 mr-1" />
                              Marcar Erro
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Auto-refresh indicator */}
      <div className="text-xs text-gray-400 flex items-center gap-1">
        <RefreshCw className="w-3 h-3" />
        Atualização automática a cada 30s {!isVisible && "(pausada — aba inativa)"}
      </div>

      {/* ── Reprocess Confirm Dialog ──────────────────────────────────────── */}
      <AlertDialog open={!!reprocessTarget && !reprocessResult} onOpenChange={(o) => { if (!o) setReprocessTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <RotateCcw className="w-5 h-5 text-blue-600" />
              Confirmar Reprocessamento
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                <p>
                  Reenviar NF-e <strong>#{reprocessTarget?.nfe_id}</strong> (Pedido #{reprocessTarget?.order_id}) ao SEFAZ?
                </p>
                <div className="bg-blue-50 border border-blue-200 rounded p-3 text-xs space-y-1">
                  <div><span className="font-medium">Status atual:</span> {reprocessTarget?.status}</div>
                  <div><span className="font-medium">Tipo:</span> {reprocessTarget?.recovery_type}</div>
                  <div><span className="font-medium">Tempo parado:</span> {reprocessTarget ? fmtIdade(reprocessTarget.idade_min) : ""}</div>
                  {reprocessTarget?.chave && (
                    <div className="font-mono text-[10px] break-all text-gray-500">Chave: {reprocessTarget.chave}</div>
                  )}
                </div>
                <div className="bg-amber-50 border border-amber-200 rounded p-2.5 text-xs text-amber-800 flex gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    Ambiente: <strong>HOMOLOGAÇÃO</strong> — sem valor fiscal.
                    O sistema verificará idempotência e bloqueará duplicatas automaticamente.
                  </span>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setReprocessTarget(null)}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-blue-600 hover:bg-blue-700"
              disabled={reprocessMutation.isPending}
              onClick={() => {
                if (!reprocessTarget) return;
                reprocessMutation.mutate(reprocessTarget.nfe_id);
                setReprocessTarget(null);
              }}
              data-testid="button-confirm-reprocess"
            >
              {reprocessMutation.isPending ? (
                <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Processando…</>
              ) : "Confirmar Reprocessamento"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Reprocess Result Dialog (success/fail details) ────────────────── */}
      <Dialog open={!!reprocessResult} onOpenChange={(o) => { if (!o) { setReprocessResult(null); setReprocessTarget(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {reprocessResult?.success
                ? <><CheckCircle2 className="w-5 h-5 text-green-600" /> NF-e Autorizada</>
                : <><AlertCircle className="w-5 h-5 text-orange-500" /> Resultado do Reprocessamento</>
              }
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-3 text-sm mt-2">
                {/* ETAPA 5: persistWarning alert */}
                {reprocessResult?.persistWarning && (
                  <div className="bg-red-50 border border-red-300 rounded p-3 text-xs text-red-800 flex gap-2" data-testid="alert-persist-warning">
                    <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                    <div>
                      <strong>ATENÇÃO CRÍTICA:</strong> NF-e autorizada pelo SEFAZ, mas a persistência no banco falhou.
                      O protocolo foi logado no servidor. Verifique os logs com <code>[NFE_RECOVERY_PERSIST_CRITICAL]</code>.
                    </div>
                  </div>
                )}
                <div className="bg-gray-50 rounded p-3 space-y-1.5 text-xs">
                  <div><span className="text-gray-500">Mensagem:</span> <span className="font-medium">{reprocessResult?.mensagem}</span></div>
                  {reprocessResult?.retorno?.cStat && (
                    <div><span className="text-gray-500">cStat:</span> <span className="font-mono">{reprocessResult.retorno.cStat}</span></div>
                  )}
                  {reprocessResult?.retorno?.xMotivo && (
                    <div><span className="text-gray-500">Motivo SEFAZ:</span> {reprocessResult.retorno.xMotivo}</div>
                  )}
                  {reprocessResult?.retorno?.protocolo && (
                    <div><span className="text-gray-500">Protocolo:</span> <span className="font-mono">{reprocessResult.retorno.protocolo}</span></div>
                  )}
                  {reprocessResult?.retorno?.chaveNFe && (
                    <div className="font-mono text-[10px] break-all text-gray-400">
                      Chave: {reprocessResult.retorno.chaveNFe}
                    </div>
                  )}
                </div>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => { setReprocessResult(null); setReprocessTarget(null); }} data-testid="button-close-result">
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Mark-Error Dialog ─────────────────────────────────────────────── */}
      <Dialog open={!!markErrorTarget} onOpenChange={(o) => { if (!o) { setMarkErrorTarget(null); setMarkErrorMotivo(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <XCircle className="w-5 h-5 text-orange-600" />
              Marcar NF-e como Erro
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-3 text-sm mt-2">
                <div className="bg-orange-50 border border-orange-200 rounded p-3 text-xs space-y-1">
                  <div><span className="font-medium">NF-e:</span> #{markErrorTarget?.nfe_id} · Pedido #{markErrorTarget?.order_id}</div>
                  <div><span className="font-medium">Status atual:</span> {markErrorTarget?.status}</div>
                  <div><span className="font-medium">Tipo:</span> {markErrorTarget?.recovery_type}</div>
                </div>
                <div className="bg-gray-50 border rounded p-2.5 text-xs text-gray-600">
                  <strong>Dados preservados:</strong> XML gerado, XML autorizado, protocolo, chave fiscal e logs SOAP serão mantidos intactos.
                  Somente o status e o motivo serão atualizados.
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-gray-700">
                    Motivo <span className="text-red-500">*</span>
                  </label>
                  <Textarea
                    placeholder="Descreva o motivo para marcar como erro..."
                    value={markErrorMotivo}
                    onChange={(e) => setMarkErrorMotivo(e.target.value)}
                    rows={3}
                    className="text-sm"
                    data-testid="input-mark-error-motivo"
                  />
                </div>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setMarkErrorTarget(null); setMarkErrorMotivo(""); }}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={!markErrorMotivo.trim() || markErrorMutation.isPending}
              onClick={() => {
                if (!markErrorTarget || !markErrorMotivo.trim()) return;
                console.log("[NFE_UI_MARK_ERROR]", { corrId: uid(), nfe_id: markErrorTarget.nfe_id, order_id: markErrorTarget.order_id });
                markErrorMutation.mutate({ nfeId: markErrorTarget.nfe_id, motivo: markErrorMotivo.trim() });
              }}
              data-testid="button-confirm-mark-error"
            >
              {markErrorMutation.isPending ? (
                <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Processando…</>
              ) : "Confirmar — Marcar como Erro"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
