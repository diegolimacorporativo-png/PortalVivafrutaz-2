import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient as globalQueryClient } from "@/lib/queryClient";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { normalizeOne, normalizeList, normalizeError } from "@/lib/normalizeResponse";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { downloadDanfe, openDanfe, exportToExcel, exportToXML, type DanfeData } from "@/lib/danfe-generator";
import { useCanEmitNfe } from "@/hooks/use-can-emit-nfe";
import { useForceReleaseNfe } from "@/hooks/use-force-release-nfe";
import { getNFePreflight, getNFeDiagnostics } from "@/services/nfe.service";
import { handleIfPeriodoFechado } from "@/lib/periodo-fechado";
import {
  Download, Eye, History, Loader2, FileDown, FileSpreadsheet, Code2,
  FileCheck, FileX, FileClock, Tag, Send, ShieldCheck, ShieldX,
  ReceiptText, ExternalLink, Stethoscope, AlertTriangle, AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { FISCAL_LABEL, FISCAL_BADGE } from "../constants";
import type { Order } from "../types";

interface DanfePanelProps {
  order: Order;
  company: any;
  products: any[];
  queryClient: any;
}

export function DanfePanel({ order, company, products, queryClient }: DanfePanelProps) {
  const { toast } = useToast();
  const [generating, setGenerating] = useState<"download" | "view" | "excel" | "xml" | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [updatingFiscal, setUpdatingFiscal] = useState(false);
  const [genNota, setGenNota] = useState(false);

  const { data: orderNfes = [], refetch: refetchNfes } = useQuery<any[]>({
    queryKey: ["/api/nfe", "order", order.id],
    queryFn: () => fetchWithAuth(`/api/nfe?orderId=${order.id}`).then(r => r.ok ? r.json() : []),
  });

  const { allowed: canEmit, reason: blockReason, faturamento, isLoading: checkingEmit, justUnlocked } = useCanEmitNfe(order.id);
  const { canForceRelease, forceRelease, isPending: isReleasing } = useForceReleaseNfe(order.id);
  const [isShaking, setIsShaking] = useState(false);

  const [preflightOpen, setPreflightOpen] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [preflightData, setPreflightData] = useState<any>(null);
  const [diagnosticsData, setDiagnosticsData] = useState<any>(null);
  const [loadingPreflight, setLoadingPreflight] = useState(false);
  const [loadingDiagnostics, setLoadingDiagnostics] = useState(false);

  const [emitGuardOpen, setEmitGuardOpen] = useState(false);
  const [emitPreflight, setEmitPreflight] = useState<any>(null);
  const [loadingEmitGuard, setLoadingEmitGuard] = useState(false);
  const [pendingEmitOrderId, setPendingEmitOrderId] = useState<number | null>(null);

  const emitirNfeMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/nfe/emitir", { orderId: order.id }),
    onSuccess: async (res) => {
      const data = await res.json();
      if (!res.ok) { toast({ title: "Erro ao gerar NF-e", description: data.message, variant: "destructive" }); return; }
      toast({ title: "NF-e gerada com sucesso!", description: `Chave: ${(data.nfe?.chaveNFe || "").slice(0, 20)}...` });
      refetchNfes();
      globalQueryClient.invalidateQueries({ queryKey: ["/api/nfe"] });
      globalQueryClient.invalidateQueries({ queryKey: ["/api/nfe/can-emit", order.id] });
    },
    onError: (e: any) => {
      if (handleIfPeriodoFechado(e, toast)) return;
      toast({ title: "Erro ao gerar NF-e", description: e.message, variant: "destructive" });
    },
  });

  const { data: danfeLogs, refetch: refetchLogs } = useQuery({
    queryKey: ["/api/orders", order.id, "danfe-logs"],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/orders/${order.id}/danfe-logs`);
      if (!res.ok) return [];
      return normalizeList<any>(await res.json());
    },
    enabled: showHistory,
  });

  const buildDanfeData = async (): Promise<DanfeData> => {
    const [detailRaw, configRes] = await Promise.all([
      fetchWithAuth(`/api/orders/${order.id}`).then(r => r.json()),
      fetchWithAuth("/api/company-config").then(r => r.ok ? r.json() : {} as any),
    ]);
    const detail = normalizeOne<any>(detailRaw) ?? { order, items: [] };
    const items = (detail.items || []).map((item: any) => {
      const product = products.find((p: any) => p.id === Number(item.productId));
      return {
        productName: product?.name || `Produto #${item.productId}`,
        quantity: item.quantity,
        unit: product?.unit || "un",
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
        ncm: (product as any)?.ncm || null,
        cfop: (product as any)?.cfop || null,
      };
    });
    const detailOrder = detail.order || detail;
    return {
      order: {
        id: order.id,
        orderCode: order.orderCode,
        status: order.status,
        orderDate: order.orderDate || order.createdAt,
        deliveryDate: order.deliveryDate,
        weekReference: order.weekReference,
        totalValue: order.totalValue,
        orderNote: order.orderNote,
        adminNote: order.adminNote,
        companyId: order.companyId,
        preNotaNumber: detailOrder?.preNotaNumber || order.preNotaNumber || null,
        fiscalStatus: detailOrder?.fiscalStatus || order.fiscalStatus || null,
      },
      items,
      company: {
        companyName: company?.companyName || "Cliente",
        cnpj: company?.cnpj,
        contactName: company?.contactName,
        phone: company?.phone,
        addressStreet: company?.addressStreet,
        addressNumber: company?.addressNumber,
        addressNeighborhood: company?.addressNeighborhood,
        addressCity: company?.addressCity,
        addressZip: company?.addressZip,
        addressState: (company as any)?.addressState || null,
        stateRegistration: (company as any)?.stateRegistration || null,
      },
      vivaFrutaz: {
        companyName: configRes?.companyName || "VivaFrutaz",
        fantasyName: configRes?.fantasyName || null,
        cnpj: configRes?.cnpj || null,
        address: configRes?.address || null,
        city: configRes?.city || null,
        state: configRes?.state || null,
        cep: configRes?.cep || null,
        phone: configRes?.phone || null,
        email: configRes?.email || null,
        stateRegistration: configRes?.stateRegistration || null,
        defaultCfop: configRes?.defaultCfop || null,
        defaultNatureza: configRes?.defaultNatureza || null,
        logoBase64: configRes?.logoBase64 || null,
        logoType: configRes?.logoType || null,
      },
    };
  };

  const logGeneration = async () => {
    await fetchWithAuth(`/api/orders/${order.id}/danfe-log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderCode: order.orderCode }),
    });
    if (showHistory) refetchLogs();
  };

  const handleDownload = async () => {
    setGenerating("download");
    try {
      const data = await buildDanfeData();
      await downloadDanfe(data);
      toast({ title: "DANFE gerado e baixado com sucesso!" });
      logGeneration().catch(() => {});
    } catch (e: any) {
      toast({ title: "Erro ao gerar DANFE", description: e.message, variant: "destructive" });
    } finally { setGenerating(null); }
  };

  const handleView = async () => {
    setGenerating("view");
    try {
      const data = await buildDanfeData();
      await openDanfe(data);
      toast({ title: "DANFE aberto com sucesso!" });
      logGeneration().catch(() => {});
    } catch (e: any) {
      toast({ title: "Erro ao visualizar DANFE", description: e.message, variant: "destructive" });
    } finally { setGenerating(null); }
  };

  const handleExcel = async () => {
    setGenerating("excel");
    try {
      const data = await buildDanfeData();
      exportToExcel(data);
      toast({ title: "Exportado para Excel com sucesso!" });
    } catch (e: any) {
      toast({ title: "Erro ao exportar Excel", description: e.message, variant: "destructive" });
    } finally { setGenerating(null); }
  };

  const handleXML = async () => {
    setGenerating("xml");
    try {
      const data = await buildDanfeData();
      exportToXML(data);
      toast({ title: "Exportado para XML com sucesso!" });
    } catch (e: any) {
      toast({ title: "Erro ao exportar XML", description: e.message, variant: "destructive" });
    } finally { setGenerating(null); }
  };

  const handleGeneratePreNota = async () => {
    setGenNota(true);
    try {
      const res = await fetchWithAuth(`/api/orders/${order.id}/generate-prenota`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(normalizeError(body).message || "Erro ao gerar pré-nota");
      const ok = normalizeOne<{ preNotaNumber: string }>(body) ?? body;
      toast({ title: `Pré-nota gerada: ${ok.preNotaNumber}` });
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
    } catch (e: any) {
      toast({ title: "Erro ao gerar pré-nota", description: e.message, variant: "destructive" });
    } finally { setGenNota(false); }
  };

  const handleUpdateFiscal = async (fiscalStatus: string) => {
    setUpdatingFiscal(true);
    try {
      const res = await fetchWithAuth(`/api/orders/${order.id}/fiscal`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fiscalStatus }),
      });
      if (!res.ok) throw new Error("Erro ao atualizar status fiscal");
      toast({ title: `Status fiscal atualizado: ${FISCAL_LABEL[fiscalStatus] || fiscalStatus}` });
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/nfe/can-emit", order.id] });
    } catch (e: any) {
      if (handleIfPeriodoFechado(e, toast)) return;
      toast({ title: "Erro ao atualizar fiscal", description: e.message, variant: "destructive" });
    } finally { setUpdatingFiscal(false); }
  };

  const runOriginalEmit = (_orderId: number) => {
    if (isShaking) return;
    if (canEmit === false) {
      setIsShaking(true);
      setTimeout(() => setIsShaking(false), 400);
      toast({ title: "Faturamento bloqueado", description: blockReason, variant: "destructive" });
      return;
    }
    emitirNfeMutation.mutate();
  };

  const handleEmitWithGuard = async (orderId: number) => {
    try {
      setLoadingEmitGuard(true);
      const res = await getNFePreflight(orderId);
      if (!res?.error && !(res?.errors?.length)) {
        return runOriginalEmit(orderId);
      }
      setEmitPreflight(res);
      setPendingEmitOrderId(orderId);
      setEmitGuardOpen(true);
    } catch (err) {
      console.error(err);
      return runOriginalEmit(orderId);
    } finally { setLoadingEmitGuard(false); }
  };

  const handlePreflight = async () => {
    try {
      setLoadingPreflight(true);
      const res = await getNFePreflight(order.id);
      setPreflightData(res);
      setPreflightOpen(true);
    } catch (err: any) {
      toast({ title: "Erro ao validar NF-e", description: err.message, variant: "destructive" });
    } finally { setLoadingPreflight(false); }
  };

  const handleDiagnostics = async () => {
    try {
      setLoadingDiagnostics(true);
      const res = await getNFeDiagnostics(order.id);
      setDiagnosticsData(res);
      setDiagnosticsOpen(true);
    } catch (err: any) {
      console.error(err);
      toast({ title: "Erro ao carregar diagnóstico", description: err?.message || "Não foi possível carregar o diagnóstico fiscal.", variant: "destructive" });
    } finally { setLoadingDiagnostics(false); }
  };

  const currentFiscal = order.fiscalStatus || "nota_pendente";

  const activeNfe = orderNfes.find((n: any) => !["cancelada", "rejeitada"].includes(n.status));
  const NFE_STATUS_COLOR: Record<string, string> = {
    gerada: "bg-blue-100 text-blue-700", assinada: "bg-indigo-100 text-indigo-700",
    enviada: "bg-yellow-100 text-yellow-700", autorizada: "bg-green-100 text-green-700",
    rejeitada: "bg-red-100 text-red-700", cancelada: "bg-gray-100 text-gray-600", erro: "bg-orange-100 text-orange-700",
  };
  const NFE_STATUS_LABEL: Record<string, string> = {
    gerada: "Gerada", assinada: "Assinada", enviada: "Enviada SEFAZ",
    autorizada: "Autorizada", rejeitada: "Rejeitada", cancelada: "Cancelada", erro: "Erro",
  };

  return (
    <div className="space-y-3">
      {/* DANFE section */}
      <div className="p-4 bg-emerald-50/60 rounded-xl border border-emerald-200/80">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-7 h-7 bg-emerald-100 rounded-lg flex items-center justify-center">
            <FileDown className="w-4 h-4 text-emerald-700" />
          </div>
          <p className="text-sm font-bold text-emerald-800 uppercase tracking-wider">DANFE Interno</p>
          <span className="text-xs text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded-full font-medium">Documento Auxiliar de Entrega</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button data-testid={`button-danfe-download-${order.id}`} onClick={handleDownload} disabled={!!generating}
            className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white text-sm font-bold rounded-xl hover:bg-emerald-700 transition-colors disabled:opacity-50">
            {generating === "download" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {generating === "download" ? "Gerando..." : "Baixar DANFE"}
          </button>
          <button data-testid={`button-danfe-view-${order.id}`} onClick={handleView} disabled={!!generating}
            className="flex items-center gap-1.5 px-4 py-2 bg-white border-2 border-emerald-600 text-emerald-700 text-sm font-bold rounded-xl hover:bg-emerald-50 transition-colors disabled:opacity-50">
            {generating === "view" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
            {generating === "view" ? "Abrindo..." : "Visualizar DANFE"}
          </button>
          <button data-testid={`button-danfe-history-${order.id}`} onClick={() => setShowHistory(!showHistory)}
            className="flex items-center gap-1.5 px-4 py-2 bg-white border-2 border-border text-muted-foreground text-sm font-bold rounded-xl hover:bg-muted/30 transition-colors">
            <History className="w-4 h-4" /> Histórico
          </button>
        </div>
        {showHistory && (
          <div className="mt-3 pt-3 border-t border-emerald-200">
            <p className="text-xs font-bold text-emerald-700 uppercase tracking-wider mb-2">Histórico de geração</p>
            {!danfeLogs ? (
              <p className="text-xs text-muted-foreground">Carregando...</p>
            ) : danfeLogs.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">Nenhum DANFE gerado para este pedido.</p>
            ) : (
              <div className="space-y-1.5">
                {danfeLogs.map((log: any) => (
                  <div key={log.id} className="flex items-center gap-3 px-3 py-1.5 bg-white rounded-lg border border-emerald-100 text-xs">
                    <FileDown className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                    <span className="text-foreground font-medium">
                      {format(new Date(log.generatedAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                    </span>
                    {log.generatedByEmail && (
                      <span className="text-muted-foreground">por {log.generatedByEmail.replace("@vivafrutaz.com", "")}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ERP Export section */}
      <div className="p-4 bg-blue-50/60 rounded-xl border border-blue-200/80">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-7 h-7 bg-blue-100 rounded-lg flex items-center justify-center">
            <FileDown className="w-4 h-4 text-blue-700" />
          </div>
          <p className="text-sm font-bold text-blue-800 uppercase tracking-wider">Exportação ERP</p>
          <span className="text-xs text-blue-600 bg-blue-100 px-2 py-0.5 rounded-full font-medium">Excel + XML</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button data-testid={`button-erp-excel-${order.id}`} onClick={handleExcel} disabled={!!generating}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-bold rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50">
            {generating === "excel" ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
            {generating === "excel" ? "Exportando..." : "Excel (.xlsx)"}
          </button>
          <button data-testid={`button-erp-xml-${order.id}`} onClick={handleXML} disabled={!!generating}
            className="flex items-center gap-1.5 px-4 py-2 bg-white border-2 border-blue-600 text-blue-700 text-sm font-bold rounded-xl hover:bg-blue-50 transition-colors disabled:opacity-50">
            {generating === "xml" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Code2 className="w-4 h-4" />}
            {generating === "xml" ? "Exportando..." : "XML NF"}
          </button>
        </div>
      </div>

      {/* NF-e SEFAZ section */}
      <div className="p-4 bg-emerald-50/40 rounded-xl border border-emerald-200/60">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-7 h-7 bg-emerald-100 rounded-lg flex items-center justify-center">
            <ReceiptText className="w-4 h-4 text-emerald-700" />
          </div>
          <p className="text-sm font-bold text-emerald-800 uppercase tracking-wider">NF-e SEFAZ</p>
          <span className="text-xs text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded-full font-medium">Nota Fiscal Eletrônica 4.00</span>
        </div>
        {activeNfe ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold ${NFE_STATUS_COLOR[activeNfe.status] || "bg-gray-100 text-gray-600"}`}>
                {NFE_STATUS_LABEL[activeNfe.status] || activeNfe.status}
              </span>
              <span className="text-xs text-gray-500">NF-e Nº {activeNfe.numero} / Série {activeNfe.serie}</span>
              {activeNfe.chaveNFe && (
                <span className="text-xs font-mono text-gray-400 truncate max-w-[180px]">{activeNfe.chaveNFe.slice(0, 16)}...</span>
              )}
            </div>
            <a href="/admin/nfe" target="_blank" rel="noopener noreferrer">
              <button type="button" data-testid={`button-ver-nfe-${order.id}`}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white border-2 border-emerald-500 text-emerald-700 text-xs font-bold rounded-lg hover:bg-emerald-50 transition-colors">
                <ExternalLink className="w-3.5 h-3.5" /> Ver no módulo NF-e
              </button>
            </a>
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            <button type="button" id={`emit-btn-${order.id}`} data-testid={`button-emitir-nfe-${order.id}`}
              onClick={() => handleEmitWithGuard(order.id)}
              disabled={emitirNfeMutation.isPending || order.status === "CANCELLED" || checkingEmit || loadingEmitGuard}
              title={canEmit === false ? blockReason : "Emitir NF"}
              className={`flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white text-sm font-bold rounded-xl hover:bg-emerald-700 transition-colors disabled:opacity-50 ${justUnlocked ? "unlock-highlight" : ""} ${isShaking ? "shake-horizontal" : ""} ${canEmit === false ? "opacity-70 cursor-not-allowed" : ""}`}>
              {(emitirNfeMutation.isPending || loadingEmitGuard) ? <Loader2 className="w-4 h-4 animate-spin" /> : <ReceiptText className="w-4 h-4" />}
              {emitirNfeMutation.isPending ? "Gerando NF-e..." : loadingEmitGuard ? "Validando..." : "Emitir NF-e"}
            </button>
            {canEmit === false ? (
              <span data-testid={`badge-nfe-blocked-${order.id}`} className="inline-flex items-center gap-1 text-xs font-semibold text-red-600">
                <AlertCircle className="w-3.5 h-3.5" />
                {blockReason}
                {canForceRelease && (
                  <button type="button" onClick={forceRelease} disabled={isReleasing}
                    data-testid={`button-force-release-${order.id}`}
                    className="ml-2 text-xs text-blue-600 underline hover:text-blue-700 disabled:opacity-50">
                    {isReleasing ? "Liberando..." : "Liberar agora"}
                  </button>
                )}
              </span>
            ) : justUnlocked ? (
              <span data-testid={`badge-nfe-unlocked-${order.id}`} className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600">
                <CheckCircle2 className="w-3.5 h-3.5" /> Liberado
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <span className="text-xs text-gray-400">Gera o XML e envia ao SEFAZ</span>
                {faturamento?.label && (
                  <span data-testid={`badge-faturamento-${order.id}`} className="text-[11px] font-medium text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                    {faturamento.label}
                  </span>
                )}
              </span>
            )}
            <button type="button" data-testid={`btn-preflight-order-${order.id}`} onClick={handlePreflight} disabled={loadingPreflight}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white border-2 border-sky-500 text-sky-700 text-xs font-bold rounded-lg hover:bg-sky-50 transition-colors disabled:opacity-50">
              {loadingPreflight ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
              Validar NF-e
            </button>
            <button type="button" data-testid={`btn-diagnostics-order-${order.id}`} onClick={handleDiagnostics} disabled={loadingDiagnostics}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white border-2 border-gray-400 text-gray-600 text-xs font-bold rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50">
              {loadingDiagnostics ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Stethoscope className="w-3.5 h-3.5" />}
              Diagnóstico
            </button>
          </div>
        )}
      </div>

      {/* Fiscal status section */}
      <div className="p-4 bg-violet-50/60 rounded-xl border border-violet-200/80">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 bg-violet-100 rounded-lg flex items-center justify-center">
              <Tag className="w-4 h-4 text-violet-700" />
            </div>
            <p className="text-sm font-bold text-violet-800 uppercase tracking-wider">Status Fiscal</p>
          </div>
          <div className={`px-3 py-1 rounded-full text-xs font-bold border ${FISCAL_BADGE[currentFiscal] || "bg-gray-100 text-gray-600 border-gray-300"}`}>
            {FISCAL_LABEL[currentFiscal] || currentFiscal}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 mb-3">
          {Object.entries(FISCAL_LABEL).map(([key, label]) => (
            <button key={key} data-testid={`button-fiscal-${key}-${order.id}`}
              onClick={() => handleUpdateFiscal(key)}
              disabled={updatingFiscal || currentFiscal === key}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border-2 transition-colors disabled:opacity-60 ${
                currentFiscal === key
                  ? "border-violet-500 bg-violet-100 text-violet-700"
                  : "border-border bg-white text-muted-foreground hover:border-violet-400 hover:text-violet-700"
              }`}>
              {updatingFiscal ? <Loader2 className="w-3 h-3 animate-spin" /> :
                key === "nota_pendente" ? <FileClock className="w-3 h-3" /> :
                key === "nota_liberada" ? <FileCheck className="w-3 h-3" /> :
                key === "nota_exportada" ? <FileDown className="w-3 h-3" /> :
                key === "nota_emitida" ? <FileCheck className="w-3 h-3" /> :
                <FileX className="w-3 h-3" />
              }
              {label}
            </button>
          ))}
        </div>
        <div className="pt-2 border-t border-violet-200">
          <div className="flex items-center gap-3">
            <div>
              <p className="text-xs text-muted-foreground">Pré-Nota</p>
              <p className="text-sm font-bold text-foreground">{order.preNotaNumber || "—"}</p>
            </div>
            {!order.preNotaNumber && (
              <button data-testid={`button-generate-prenota-${order.id}`} onClick={handleGeneratePreNota} disabled={genNota}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 text-white text-xs font-bold rounded-lg hover:bg-violet-700 transition-colors disabled:opacity-50">
                {genNota ? <Loader2 className="w-3 h-3 animate-spin" /> : <Tag className="w-3 h-3" />}
                Gerar Pré-Nota
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Emit Guard Modal */}
      <Dialog open={emitGuardOpen} onOpenChange={setEmitGuardOpen}>
        <DialogContent className="max-w-xl" data-testid="modal-emit-guard">
          <DialogHeader><DialogTitle>⚠ Problemas na NF-e</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="text-sm text-red-600">Foram encontrados erros na validação da NF-e.</div>
            <pre className="max-h-60 overflow-auto text-xs bg-gray-100 p-2 rounded whitespace-pre-wrap break-all">
              {JSON.stringify(emitPreflight, null, 2)}
            </pre>
            <div className="flex gap-2 justify-end pt-1">
              <button type="button" data-testid="button-emit-guard-cancel" onClick={() => setEmitGuardOpen(false)}
                className="px-4 py-2 text-sm font-semibold rounded-lg border-2 border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors">
                Cancelar
              </button>
              <button type="button" data-testid="button-emit-guard-confirm"
                onClick={() => { setEmitGuardOpen(false); runOriginalEmit(pendingEmitOrderId ?? order.id); }}
                className="px-4 py-2 text-sm font-bold rounded-lg bg-orange-500 text-white hover:bg-orange-600 transition-colors">
                Emitir mesmo assim
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Preflight Modal */}
      <Dialog open={preflightOpen} onOpenChange={setPreflightOpen}>
        <DialogContent className="max-w-xl" data-testid={`modal-preflight-${order.id}`}>
          <DialogHeader><DialogTitle>Validação NF-e — Pedido #{order.id}</DialogTitle></DialogHeader>
          {preflightData ? (
            <div className="space-y-2 max-h-[70vh] overflow-y-auto">
              {preflightData.errors?.length > 0 && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                  <p className="text-xs font-bold text-red-700 uppercase mb-1">Erros ({preflightData.errors.length})</p>
                  <ul className="space-y-1">
                    {preflightData.errors.map((e: string, i: number) => (
                      <li key={i} className="text-xs text-red-700 flex items-start gap-1.5">
                        <ShieldX className="w-3.5 h-3.5 mt-0.5 shrink-0" />{e}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {preflightData.warnings?.length > 0 && (
                <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3">
                  <p className="text-xs font-bold text-yellow-700 uppercase mb-1">Avisos ({preflightData.warnings.length})</p>
                  <ul className="space-y-1">
                    {preflightData.warnings.map((w: string, i: number) => (
                      <li key={i} className="text-xs text-yellow-700 flex items-start gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />{w}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {(preflightData.errors?.length ?? 0) === 0 && (preflightData.warnings?.length ?? 0) === 0 && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  <p className="text-sm text-emerald-700 font-semibold">Sem erros ou avisos. Pronto para emitir.</p>
                </div>
              )}
            </div>
          ) : <p className="text-sm text-muted-foreground">Nenhum dado disponível.</p>}
        </DialogContent>
      </Dialog>

      {/* Diagnostics Modal */}
      <Dialog open={diagnosticsOpen} onOpenChange={setDiagnosticsOpen}>
        <DialogContent className="max-w-xl" data-testid={`modal-diagnostics-${order.id}`}>
          <DialogHeader><DialogTitle>Diagnóstico NF-e — Pedido #{order.id}</DialogTitle></DialogHeader>
          {diagnosticsData ? (
            <div className="max-h-[70vh] overflow-y-auto">
              <pre className="text-xs whitespace-pre-wrap break-all bg-gray-50 border border-gray-200 rounded-lg p-3">
                {JSON.stringify(diagnosticsData, null, 2)}
              </pre>
            </div>
          ) : <p className="text-sm text-muted-foreground">Nenhum dado disponível.</p>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
