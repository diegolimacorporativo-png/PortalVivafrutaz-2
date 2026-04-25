import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { normalizeList } from "@/lib/normalizeResponse";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import NfeDiagnosticsPanel from "@/components/NfeDiagnosticsPanel";
import {
  FileText, Send, Download, XCircle, RefreshCw, CheckCircle2, Clock,
  AlertCircle, Info, ReceiptText, ArrowLeft, Search, Package, Building2,
  ChevronRight, Wifi, WifiOff, Shield, BookOpen, ChevronDown, ChevronUp,
  Settings, Award, Zap, Lock
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const STATUS_MAP: Record<string, { label: string; color: string; icon: any }> = {
  gerada:      { label: "Gerada",      color: "bg-blue-100 text-blue-800",    icon: FileText },
  assinada:    { label: "Assinada",    color: "bg-indigo-100 text-indigo-800", icon: Shield },
  enviada:     { label: "Enviada",     color: "bg-yellow-100 text-yellow-800", icon: Send },
  autorizada:  { label: "Autorizada",  color: "bg-green-100 text-green-800",  icon: CheckCircle2 },
  rejeitada:   { label: "Rejeitada",   color: "bg-red-100 text-red-800",      icon: AlertCircle },
  cancelada:   { label: "Cancelada",   color: "bg-gray-100 text-gray-600",    icon: XCircle },
  erro:        { label: "Erro",        color: "bg-orange-100 text-orange-800", icon: AlertCircle },
};

const FISCAL_STATUS_LABEL: Record<string, { label: string; color: string }> = {
  nota_pendente: { label: "Pendente",         color: "bg-yellow-100 text-yellow-700" },
  nota_liberada: { label: "Liberada p/ NF-e", color: "bg-emerald-100 text-emerald-700" },
  nota_emitida:  { label: "Emitida",          color: "bg-green-100 text-green-700" },
  nota_exportada:{ label: "Exportada",        color: "bg-blue-100 text-blue-700" },
  nota_cancelada:{ label: "Cancelada",        color: "bg-red-100 text-red-700" },
};

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  try { return format(new Date(d), "dd/MM/yyyy HH:mm", { locale: ptBR }); } catch { return d; }
}

function fmtBRL(v: string | number | null | undefined) {
  if (v == null) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v));
}

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_MAP[status] || { label: status, color: "bg-gray-100 text-gray-700", icon: Info };
  const Icon = s.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${s.color}`}>
      <Icon className="w-3 h-3" />
      {s.label}
    </span>
  );
}

function SefazStatusBar() {
  const { data, isLoading } = useQuery<any>({ queryKey: ["/api/nfe/sefaz/status"], retry: false });
  if (isLoading) return <div className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg bg-gray-50 text-gray-400"><Clock className="w-3 h-3 animate-spin" />Verificando SEFAZ...</div>;
  const online = data?.online;
  return (
    <div className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg border ${online ? "bg-green-50 text-green-700 border-green-200" : "bg-orange-50 text-orange-700 border-orange-200"}`}>
      {online ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
      <span>SEFAZ {data?.uf || ""} ({data?.ambiente === "producao" ? "Produção" : "Homologação"}): {online ? "Online" : "Offline / Não verificado"}</span>
      {data?.descricao && <span>— {data.descricao}</span>}
    </div>
  );
}

function OrderSearchPanel({ onSelect, selectedId }: { onSelect: (id: number, code: string) => void; selectedId: number | null }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("nota_liberada");

  const { data: orders = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/orders"],
    queryFn: () => fetch("/api/orders", { credentials: "include" }).then(r => r.json()),
  });

  const { data: companies = [] } = useQuery<any[]>({ queryKey: ["/api/companies"], select: normalizeList });
  const { data: nfes = [] } = useQuery<any[]>({ queryKey: ["/api/nfe"] });

  const emittedOrderIds = new Set((nfes as any[]).filter(n => ["autorizada","enviada","gerada","assinada"].includes(n.status)).map((n: any) => n.orderId));
  const companyMap = new Map((companies as any[]).map((c: any) => [c.id, c]));

  const filtered = orders.filter((o: any) => {
    if (statusFilter === "faturavel") {
      if (o.status === "CANCELLED") return false;
      if (parseFloat(o.totalValue || "0") <= 0) return false;
    } else if (statusFilter === "nota_liberada") {
      if (o.fiscalStatus !== "nota_liberada") return false;
    } else if (statusFilter !== "todos") {
      if (o.status !== statusFilter) return false;
    }
    if (!search) return true;
    const company = companyMap.get(o.companyId);
    const q = search.toLowerCase();
    return (o.orderCode || "").toLowerCase().includes(q) ||
      (company?.companyName || "").toLowerCase().includes(q) ||
      String(o.id).includes(q);
  });

  if (isLoading) return (
    <div className="space-y-2 p-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
  );

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <Input
            data-testid="input-search-orders-nfe"
            placeholder="Buscar por código, empresa ou ID..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 h-8 text-xs"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36 h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="nota_liberada">Liberadas p/ NF-e</SelectItem>
            <SelectItem value="faturavel">Faturáveis (todos)</SelectItem>
            <SelectItem value="DELIVERED">Entregues</SelectItem>
            <SelectItem value="CONFIRMED">Confirmados</SelectItem>
            <SelectItem value="ACTIVE">Ativos</SelectItem>
            <SelectItem value="todos">Todos</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <ScrollArea className="h-56 border rounded-lg">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-gray-400 text-xs gap-2">
            <Package className="w-8 h-8 opacity-30" />
            <p>Nenhum pedido encontrado</p>
          </div>
        ) : (
          <div className="divide-y">
            {filtered.map((order: any) => {
              const company = companyMap.get(order.companyId);
              const alreadyEmitted = emittedOrderIds.has(order.id);
              const isSelected = selectedId === order.id;
              const fs = FISCAL_STATUS_LABEL[order.fiscalStatus || "nota_pendente"];
              return (
                <div
                  key={order.id}
                  data-testid={`row-order-nfe-${order.id}`}
                  onClick={() => !alreadyEmitted && onSelect(order.id, order.orderCode || `#${order.id}`)}
                  className={`flex items-center gap-3 px-3 py-2.5 transition-colors ${isSelected ? "bg-emerald-50 dark:bg-emerald-900/20" : alreadyEmitted ? "opacity-50 cursor-not-allowed bg-gray-50" : "hover:bg-gray-50 dark:hover:bg-gray-800/40 cursor-pointer"}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs font-semibold text-gray-800 dark:text-gray-100">{order.orderCode || `#${order.id}`}</span>
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${fs?.color}`}>{fs?.label}</span>
                      {alreadyEmitted && <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">NF-e emitida</span>}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Building2 className="w-3 h-3 text-gray-400 shrink-0" />
                      <span className="text-xs text-gray-500 truncate">{company?.companyName || `Empresa #${order.companyId}`}</span>
                      <span className="text-xs text-emerald-600 font-medium shrink-0">{fmtBRL(order.totalValue)}</span>
                    </div>
                  </div>
                  <ChevronRight className={`w-4 h-4 shrink-0 ${isSelected ? "text-emerald-600" : "text-gray-300"}`} />
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

const TUTORIAL_STEPS = [
  {
    num: 1,
    title: "Configure os Dados Fiscais da Emissora",
    desc: "Acesse Configurações > Dados Fiscais e preencha CNPJ, Razão Social, Inscrição Estadual, endereço e certificado digital A1.",
    icon: Settings,
    color: "bg-blue-100 text-blue-700",
    link: "/admin/fiscal-config",
    linkLabel: "Ir para Config Fiscal",
    check: "Certificado configurado + CNPJ + IE preenchidos",
  },
  {
    num: 2,
    title: "Complete os Dados do Cliente (Destinatário)",
    desc: "Em Gestão > Empresas > aba Dados Fiscais, preencha CNPJ/IE, endereço completo com UF, município e código IBGE.",
    icon: Building2,
    color: "bg-purple-100 text-purple-700",
    link: "/admin/companies",
    linkLabel: "Ir para Empresas",
    check: "CNPJ + endereço completo do cliente",
  },
  {
    num: 3,
    title: "Pedido Entregue → Liberação Automática",
    desc: "Ao confirmar a entrega no checklist de logística, o sistema libera automaticamente o pedido para emissão (status: Liberada p/ NF-e).",
    icon: Zap,
    color: "bg-emerald-100 text-emerald-700",
    link: "/admin/logistics",
    linkLabel: "Ver Logística",
    check: "Pedido com status 'Liberada p/ NF-e'",
  },
  {
    num: 4,
    title: "Execute o Diagnóstico Automático",
    desc: "Selecione o pedido na lista (filtro: Liberadas p/ NF-e) e o diagnóstico valida todos os dados automaticamente. Corrija erros indicados.",
    icon: Shield,
    color: "bg-yellow-100 text-yellow-700",
    link: null,
    linkLabel: "",
    check: "Diagnóstico sem erros críticos",
  },
  {
    num: 5,
    title: "Gere o XML e Envie ao SEFAZ",
    desc: "Com todos os dados OK, clique em 'Gerar XML'. O sistema assina digitalmente e envia ao SEFAZ. Após autorização, o XML e o email são enviados automaticamente.",
    icon: Award,
    color: "bg-green-100 text-green-700",
    link: null,
    linkLabel: "",
    check: "NF-e autorizada e email enviado",
  },
];

function TutorialInteligente() {
  const [open, setOpen] = useState(false);
  return (
    <Card className="border-blue-200/60 bg-blue-50/30 dark:bg-blue-900/10">
      <CardHeader className="pb-2 pt-3 px-4">
        <button
          type="button"
          data-testid="button-toggle-tutorial"
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-2 w-full text-left"
        >
          <div className="w-8 h-8 rounded-xl bg-blue-100 flex items-center justify-center shrink-0">
            <BookOpen className="w-4 h-4 text-blue-700" />
          </div>
          <div className="flex-1">
            <CardTitle className="text-sm text-blue-800 dark:text-blue-200">Tutorial Inteligente de Emissão NF-e</CardTitle>
            <p className="text-xs text-blue-600/80 mt-0.5">Passo a passo completo do fluxo de emissão — clique para expandir</p>
          </div>
          {open ? <ChevronUp className="w-4 h-4 text-blue-600 shrink-0" /> : <ChevronDown className="w-4 h-4 text-blue-600 shrink-0" />}
        </button>
      </CardHeader>
      {open && (
        <CardContent className="px-4 pb-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 mt-1">
            {TUTORIAL_STEPS.map((step) => {
              const Icon = step.icon;
              return (
                <div key={step.num} className="relative flex flex-col gap-2 p-3 bg-white dark:bg-card rounded-xl border border-border/40 shadow-sm">
                  <div className="flex items-center gap-2">
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${step.color}`}>
                      <Icon className="w-3.5 h-3.5" />
                    </div>
                    <span className="text-[10px] font-bold text-muted-foreground uppercase">Passo {step.num}</span>
                  </div>
                  <p className="text-xs font-semibold text-foreground leading-tight">{step.title}</p>
                  <p className="text-[11px] text-muted-foreground leading-relaxed flex-1">{step.desc}</p>
                  <div className="flex items-start gap-1 mt-1">
                    <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0 mt-0.5" />
                    <span className="text-[10px] text-emerald-700 dark:text-emerald-400">{step.check}</span>
                  </div>
                  {step.link && (
                    <a href={step.link} className="mt-1 text-[11px] text-blue-600 hover:underline font-medium flex items-center gap-1">
                      <ChevronRight className="w-3 h-3" />{step.linkLabel}
                    </a>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-3 p-3 bg-amber-50 dark:bg-amber-900/10 rounded-xl border border-amber-200/50">
            <p className="text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2">
              <Lock className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span><strong>Ambiente de Homologação:</strong> Em homologação, as NF-e são aceitas pelo SEFAZ mas não têm validade fiscal. Só mude para Produção quando todos os testes estiverem ok. Configure em Dados Fiscais.</span>
            </p>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

export default function NfePage() {
  const { toast } = useToast();
  const [statusFiltro, setStatusFiltro] = useState("todos");
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  const [selectedOrderCode, setSelectedOrderCode] = useState("");
  const [selectedNfe, setSelectedNfe] = useState<any>(null);
  const [cancelMotivo, setCancelMotivo] = useState("");

  const { data: nfes = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/nfe", statusFiltro],
    queryFn: () => {
      const params = new URLSearchParams();
      if (statusFiltro !== "todos") params.set("status", statusFiltro);
      return fetch(`/api/nfe?${params}`, { credentials: "include" }).then(r => r.json());
    },
  });

  const emitirMutation = useMutation({
    mutationFn: (orderId: number) => apiRequest("POST", "/api/nfe/emitir", { orderId }),
    onSuccess: async (res) => {
      const data = await res.json();
      toast({ title: `NF-e gerada com sucesso!`, description: `Chave: ${(data.nfe?.chaveNFe || "").slice(0, 22)}...` });
      queryClient.invalidateQueries({ queryKey: ["/api/nfe"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/nfe/diagnostics", selectedOrderId] });
      setSelectedOrderId(null);
      setSelectedOrderCode("");
    },
    onError: async (e: any) => {
      toast({ title: "Erro ao gerar NF-e", description: e.message, variant: "destructive" });
      // Registrar erros de validação no treinamento
      if (selectedOrderId) {
        try {
          const body = JSON.parse(e.message || "{}");
          const errors = body?.erros || [];
          if (errors.length) {
            await fetch("/api/nfe/diagnostics/log-errors", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({ orderId: selectedOrderId, errors }),
            });
            queryClient.invalidateQueries({ queryKey: ["/api/nfe/diagnostics/training/patterns"] });
          }
        } catch {}
      }
    },
  });

  const enviarMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/nfe/${id}/enviar`, {}),
    onSuccess: async (res) => {
      const data = await res.json();
      const ok = data.retorno?.status === "autorizada";
      toast({
        title: ok ? "NF-e autorizada pelo SEFAZ!" : `SEFAZ: ${data.retorno?.xMotivo}`,
        variant: ok ? "default" : "destructive",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/nfe"] });
      if (selectedNfe) setSelectedNfe({ ...selectedNfe, ...data.nfe });
      // Registrar erros SEFAZ no treinamento
      if (!ok && data.retorno?.xMotivo && selectedNfe?.orderId) {
        try {
          await fetch("/api/nfe/diagnostics/log-error", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              orderId: selectedNfe.orderId,
              nfeId: selectedNfe.id,
              codigoErro: data.retorno?.cStat || "500",
              mensagemErro: data.retorno?.xMotivo,
            }),
          });
          queryClient.invalidateQueries({ queryKey: ["/api/nfe/diagnostics/training/patterns"] });
        } catch {}
      }
    },
    onError: (e: any) => toast({ title: e.message, variant: "destructive" }),
  });

  const cancelarMutation = useMutation({
    mutationFn: ({ id, motivo }: { id: number; motivo: string }) => apiRequest("DELETE", `/api/nfe/${id}`, { motivo }),
    onSuccess: () => {
      toast({ title: "NF-e cancelada" });
      queryClient.invalidateQueries({ queryKey: ["/api/nfe"] });
      setSelectedNfe(null);
      setCancelMotivo("");
    },
    onError: (e: any) => toast({ title: e.message, variant: "destructive" }),
  });

  function downloadFile(id: number, type: "danfe" | "xml") {
    window.open(`/api/nfe/${id}/${type}`, "_blank");
  }

  const filtered = nfes.filter(n => statusFiltro === "todos" || n.status === statusFiltro);

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <ReceiptText className="w-6 h-6 text-emerald-600" />
            Emissão de NF-e
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Nota Fiscal Eletrônica 4.00 — SEFAZ</p>
        </div>
        <SefazStatusBar />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {(["gerada","autorizada","rejeitada","cancelada"] as string[]).map(st => {
          const count = nfes.filter(n => n.status === st).length;
          const s = STATUS_MAP[st];
          const Icon = s.icon;
          return (
            <Card key={st} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setStatusFiltro(st)}>
              <CardContent className="pt-4 pb-4 flex items-center gap-3">
                <div className={`p-2 rounded-lg ${s.color}`}><Icon className="w-5 h-5" /></div>
                <div>
                  <p className="text-xs text-gray-500">{s.label}</p>
                  <p className="text-2xl font-bold">{count}</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* ── Emissão via seleção de pedido + Diagnóstico ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Seletor de pedido */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="w-4 h-4 text-emerald-600" />
              Selecionar Pedido para NF-e
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <OrderSearchPanel
              onSelect={(id, code) => { setSelectedOrderId(id); setSelectedOrderCode(code); }}
              selectedId={selectedOrderId}
            />

            {selectedOrderId && (
              <div className="flex items-center gap-3 p-3 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg border border-emerald-200">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200">
                    Pedido: <span className="font-mono">{selectedOrderCode}</span>
                  </p>
                  <p className="text-xs text-emerald-600">#{selectedOrderId}</p>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    data-testid="button-emitir-nfe"
                    onClick={() => emitirMutation.mutate(selectedOrderId)}
                    disabled={emitirMutation.isPending}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white"
                  >
                    {emitirMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <FileText className="w-4 h-4 mr-2" />}
                    Gerar XML
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => { setSelectedOrderId(null); setSelectedOrderCode(""); }}>
                    <XCircle className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}
            <p className="text-xs text-gray-400">
              Selecione um pedido acima. O diagnóstico fiscal valida automaticamente os dados antes da emissão.
            </p>
          </CardContent>
        </Card>

        {/* Diagnóstico Fiscal */}
        <NfeDiagnosticsPanel
          orderId={selectedOrderId}
          onEmitirClick={selectedOrderId ? () => emitirMutation.mutate(selectedOrderId) : undefined}
          className="h-full"
        />
      </div>

      {/* ── Tutorial Inteligente ── */}
      <TutorialInteligente />

      {/* ── Histórico de NF-e ── */}
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-base">Histórico de NF-e</CardTitle>
          <div className="flex items-center gap-2">
            {statusFiltro !== "todos" && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setStatusFiltro("todos")}>
                <ArrowLeft className="w-3 h-3 mr-1" /> Todos
              </Button>
            )}
            <Select value={statusFiltro} onValueChange={setStatusFiltro}>
              <SelectTrigger data-testid="select-status-nfe" className="w-40 h-8 text-xs">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                {Object.entries(STATUS_MAP).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="button" variant="ghost" size="sm" onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/nfe"] })}>
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <ReceiptText className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <p>Nenhuma NF-e encontrada</p>
              <p className="text-xs mt-1">Selecione um pedido acima para emitir</p>
            </div>
          ) : (
            <div className="divide-y">
              {filtered.map((nfe) => (
                <div
                  key={nfe.id}
                  data-testid={`row-nfe-${nfe.id}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer"
                  onClick={() => setSelectedNfe(nfe)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-semibold text-gray-800 dark:text-gray-100">
                        NF-e Nº {nfe.numero} / Série {nfe.serie}
                      </span>
                      <StatusBadge status={nfe.status} />
                      {nfe.ambienteFiscal === "homologacao" && (
                        <span className="text-xs px-1.5 py-0.5 bg-yellow-50 text-yellow-600 rounded border border-yellow-200">Homologação</span>
                      )}
                    </div>
                    <div className="flex items-center gap-4 mt-0.5 flex-wrap">
                      <span className="text-xs text-gray-500">Pedido #{nfe.orderId}</span>
                      <span className="text-xs text-gray-400 font-mono">{nfe.chaveNFe ? `Chave: ${nfe.chaveNFe.slice(0, 20)}...` : ""}</span>
                      <span className="text-xs text-gray-400">{fmtDate(nfe.createdAt)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {["gerada","assinada"].includes(nfe.status) && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs text-emerald-700 border-emerald-300"
                        data-testid={`button-enviar-nfe-${nfe.id}`}
                        onClick={e => { e.stopPropagation(); enviarMutation.mutate(nfe.id); }}
                        disabled={enviarMutation.isPending}
                      >
                        <Send className="w-3 h-3 mr-1" />Enviar SEFAZ
                      </Button>
                    )}
                    <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" data-testid={`button-danfe-${nfe.id}`} onClick={e => { e.stopPropagation(); downloadFile(nfe.id, "danfe"); }}>
                      <Download className="w-3 h-3 mr-1" />DANFE
                    </Button>
                    <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" data-testid={`button-xml-${nfe.id}`} onClick={e => { e.stopPropagation(); downloadFile(nfe.id, "xml"); }}>
                      <Download className="w-3 h-3 mr-1" />XML
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Detail Modal ── */}
      <Dialog open={!!selectedNfe} onOpenChange={o => !o && setSelectedNfe(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ReceiptText className="w-5 h-5 text-emerald-600" />
              Detalhes NF-e Nº {selectedNfe?.numero}
            </DialogTitle>
          </DialogHeader>
          {selectedNfe && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                  <p className="text-xs text-gray-500 mb-1">Status</p>
                  <StatusBadge status={selectedNfe.status} />
                </div>
                <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                  <p className="text-xs text-gray-500 mb-1">Pedido</p>
                  <p className="font-semibold">#{selectedNfe.orderId}</p>
                </div>
                <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                  <p className="text-xs text-gray-500 mb-1">Nº / Série</p>
                  <p className="font-mono font-semibold">{selectedNfe.numero} / {selectedNfe.serie}</p>
                </div>
                <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                  <p className="text-xs text-gray-500 mb-1">Ambiente</p>
                  <p>{selectedNfe.ambienteFiscal === "producao" ? "Produção" : "Homologação"}</p>
                </div>
              </div>

              {selectedNfe.chaveNFe && (
                <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                  <p className="text-xs text-gray-500 mb-1">Chave de Acesso</p>
                  <p className="font-mono text-xs break-all">{selectedNfe.chaveNFe}</p>
                </div>
              )}

              {selectedNfe.protocolo && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3">
                    <p className="text-xs text-gray-500 mb-1">Protocolo SEFAZ</p>
                    <p className="font-mono font-semibold text-green-700">{selectedNfe.protocolo}</p>
                  </div>
                  <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3">
                    <p className="text-xs text-gray-500 mb-1">Data Autorização</p>
                    <p className="font-semibold text-green-700">{fmtDate(selectedNfe.dataAutorizacao)}</p>
                  </div>
                </div>
              )}

              {selectedNfe.xMotivo && (
                <div className="bg-orange-50 rounded-lg p-3 flex gap-2">
                  <Info className="w-4 h-4 text-orange-500 shrink-0 mt-0.5" />
                  <p className="text-orange-700 text-xs">{selectedNfe.cStat} — {selectedNfe.xMotivo}</p>
                </div>
              )}

              {selectedNfe.motivoCancelamento && (
                <div className="bg-red-50 rounded-lg p-3">
                  <p className="text-xs text-gray-500 mb-1">Motivo Cancelamento</p>
                  <p className="text-red-700 text-xs">{selectedNfe.motivoCancelamento}</p>
                </div>
              )}

              <div className="flex gap-2 flex-wrap pt-2">
                {["gerada","assinada"].includes(selectedNfe.status) && (
                  <Button
                    type="button"
                    data-testid="button-modal-enviar"
                    onClick={() => enviarMutation.mutate(selectedNfe.id)}
                    disabled={enviarMutation.isPending}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white"
                  >
                    {enviarMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
                    Enviar ao SEFAZ
                  </Button>
                )}
                <Button type="button" variant="outline" onClick={() => downloadFile(selectedNfe.id, "danfe")} data-testid="button-modal-danfe">
                  <Download className="w-4 h-4 mr-2" />DANFE PDF
                </Button>
                <Button type="button" variant="outline" onClick={() => downloadFile(selectedNfe.id, "xml")} data-testid="button-modal-xml">
                  <Download className="w-4 h-4 mr-2" />XML
                </Button>
                {!["cancelada","rejeitada"].includes(selectedNfe.status) && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button type="button" variant="destructive" size="sm" data-testid="button-modal-cancelar">
                        <XCircle className="w-4 h-4 mr-2" />Cancelar
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Cancelar NF-e?</AlertDialogTitle>
                        <AlertDialogDescription>Informe o motivo do cancelamento (mínimo 15 caracteres):</AlertDialogDescription>
                      </AlertDialogHeader>
                      <Input
                        data-testid="input-motivo-cancelamento"
                        value={cancelMotivo}
                        onChange={e => setCancelMotivo(e.target.value)}
                        placeholder="Ex: Erro nos dados do destinatário"
                      />
                      <AlertDialogFooter>
                        <AlertDialogCancel>Voltar</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => cancelarMutation.mutate({ id: selectedNfe.id, motivo: cancelMotivo })}
                          disabled={cancelarMutation.isPending || cancelMotivo.length < 15}
                          className="bg-red-600 hover:bg-red-700"
                        >
                          Cancelar NF-e
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
