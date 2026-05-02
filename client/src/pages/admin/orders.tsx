import { useState } from "react";
import { useOrders, useOrderDetail } from "@/hooks/use-ordering";
import { useCompanies } from "@/hooks/use-admin";
import { useProducts } from "@/hooks/use-catalog";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient as globalQueryClient } from "@/lib/queryClient";
import { normalizeOne, normalizeList, normalizeError } from "@/lib/normalizeResponse";
import { Layout } from "@/components/Layout";
import { Modal } from "@/components/Modal";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  Receipt, Search, ChevronDown, ChevronUp, MessageSquare, Package, FileText,
  XCircle, Edit3, AlertTriangle, CheckCircle, StickyNote, Save, Trash2, Calendar,
  Lock, Unlock, ThumbsUp, ThumbsDown, ClipboardEdit, Bell, Building2,
  Download, Eye, History, Loader2, FileDown, FileSpreadsheet, Code2,
  FileCheck, FileX, FileClock, Tag, Send, ShieldCheck, ShieldX, Clock, RefreshCw,
  ReceiptText, ExternalLink, Stethoscope
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getNFePreflight, getNFeDiagnostics } from "@/services/nfe.service";
import { api } from "@shared/routes";
// NF.7.9.7 — feedback amigável para erro 403 PERIODO_FECHADO (aditivo).
import { handleIfPeriodoFechado } from "@/lib/periodo-fechado";
import { downloadDanfe, openDanfe, exportToExcel, exportToXML, type DanfeData } from "@/lib/danfe-generator";
import { useCanEmitNfe } from "@/hooks/use-can-emit-nfe";
import { useForceReleaseNfe } from "@/hooks/use-force-release-nfe";

const FISCAL_LABEL: Record<string, string> = {
  nota_pendente: "Nota Pendente",
  nota_liberada: "Liberada p/ NF-e",
  nota_exportada: "Nota Exportada",
  nota_emitida: "Nota Emitida",
  nota_cancelada: "Nota Cancelada",
};

const FISCAL_BADGE: Record<string, string> = {
  nota_pendente: "bg-yellow-100 text-yellow-700 border-yellow-300",
  nota_liberada: "bg-emerald-100 text-emerald-700 border-emerald-300",
  nota_exportada: "bg-blue-100 text-blue-700 border-blue-300",
  nota_emitida: "bg-green-100 text-green-700 border-green-300",
  nota_cancelada: "bg-red-100 text-red-700 border-red-300",
};

const ERP_STATUS_LABEL: Record<string, string> = {
  nao_exportado: "Não exportado",
  exportando: "Exportando...",
  exportado: "Exportado",
  erro: "Erro Bling",
};

const ERP_STATUS_BADGE: Record<string, string> = {
  nao_exportado: "bg-gray-100 text-gray-500 border-gray-300",
  exportando: "bg-blue-100 text-blue-600 border-blue-300 animate-pulse",
  exportado: "bg-emerald-100 text-emerald-700 border-emerald-300",
  erro: "bg-red-100 text-red-700 border-red-300",
};

type Order = any;

const STATUS_BADGE: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-700",
  CONFIRMED: "bg-blue-100 text-blue-700",
  REOPEN_REQUESTED: "bg-orange-100 text-orange-700",
  OPEN_FOR_EDITING: "bg-yellow-100 text-yellow-700",
  CANCELLED: "bg-red-100 text-red-700",
  DELIVERED: "bg-emerald-100 text-emerald-700",
};

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Ativo",
  CONFIRMED: "Confirmado",
  REOPEN_REQUESTED: "Solicitação de Alteração",
  OPEN_FOR_EDITING: "Em Edição",
  CANCELLED: "Cancelado",
  DELIVERED: "Entregue",
};

// Operational (workflowStatus) badges — shown next to legacy status when set.
const WF_BADGE: Record<string, string> = {
  APPROVED:   "bg-blue-50 text-blue-700 border-blue-200",
  PROCESSING: "bg-amber-50 text-amber-700 border-amber-200",
  READY:      "bg-violet-50 text-violet-700 border-violet-200",
  INVOICED:   "bg-cyan-50 text-cyan-700 border-cyan-200",
  SHIPPED:    "bg-indigo-50 text-indigo-700 border-indigo-200",
  DELIVERED:  "bg-emerald-50 text-emerald-700 border-emerald-200",
};

const WF_LABEL: Record<string, string> = {
  CREATED:          "Criado",
  PENDING_APPROVAL: "Aguardando Aprovação",
  APPROVED:         "Aprovado",
  PROCESSING:       "Em Separação",
  READY:            "Pedido Pronto",
  INVOICED:         "Faturado",
  SHIPPED:          "Em Rota",
  DELIVERED:        "Entregue",
  REJECTED:         "Rejeitado",
  CANCELLED:        "Cancelado",
};

// ─── Admin Note Modal ─────────────────────────────────────────
function AdminNoteModal({
  order, onClose, onSave
}: { order: Order; onClose: () => void; onSave: (note: string) => Promise<void> }) {
  const [note, setNote] = useState(order.adminNote || "");
  const [saving, setSaving] = useState(false);
  return (
    <Modal isOpen onClose={onClose} title="Observação Administrativa" maxWidth="max-w-lg">
      <div className="space-y-4">
        <div className="p-3 bg-primary/5 rounded-xl border border-primary/20">
          <p className="text-sm font-bold text-primary">Pedido {order.orderCode || `#${order.id}`}</p>
        </div>
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          rows={5}
          placeholder="Ex: Produto enviado errado, aplicado desconto de 10%, aguardando reposição..."
          className="w-full px-4 py-3 rounded-xl border-2 border-border focus:border-primary outline-none resize-none"
        />
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-3 border-2 border-border rounded-xl font-bold text-muted-foreground hover:bg-muted transition-colors">
            Cancelar
          </button>
          <button
            onClick={async () => { setSaving(true); await onSave(note); onClose(); }}
            disabled={saving}
            className="flex-1 py-3 bg-primary text-white font-bold rounded-xl hover:-translate-y-0.5 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <Save className="w-4 h-4" /> {saving ? "Salvando..." : "Salvar Observação"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Edit Items Modal ─────────────────────────────────────────
type EditItem = { productId: number; quantity: number; unitPrice: number; subCategoryId: number | null; subCategoryName: string | null };

function EditItemsModal({
  order, products, onClose, onSave
}: { order: Order; products: any[]; onClose: () => void; onSave: (items: any[]) => Promise<void> }) {
  const { data: detail } = useOrderDetail(order.id);
  const [editItems, setEditItems] = useState<EditItem[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [saving, setSaving] = useState(false);

  if (detail && !initialized) {
    setEditItems((detail.items || []).map((i: any) => ({
      productId: i.productId,
      quantity: i.quantity,
      unitPrice: Number(i.unitPrice),
      subCategoryId: i.subCategoryId ?? null,
      subCategoryName: i.subCategoryName ?? null,
    })));
    setInitialized(true);
  }

  const total = editItems.reduce((s, i) => s + (i.quantity * i.unitPrice), 0);

  const handleQtyChange = (idx: number, qty: number) => {
    setEditItems(prev => prev.map((item, i) => i === idx ? { ...item, quantity: Math.max(0, qty) } : item));
  };

  const handlePriceChange = (idx: number, price: number) => {
    setEditItems(prev => prev.map((item, i) => i === idx ? { ...item, unitPrice: price } : item));
  };

  const handleRemove = (idx: number) => {
    setEditItems(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    setSaving(true);
    const items = editItems
      .filter(i => i.quantity > 0)
      .map(i => ({
        productId: i.productId,
        quantity: i.quantity,
        unitPrice: String(i.unitPrice),
        totalPrice: String(i.quantity * i.unitPrice),
        subCategoryId: i.subCategoryId,
        subCategoryName: i.subCategoryName,
      }));
    await onSave(items);
    onClose();
  };

  return (
    <Modal isOpen onClose={onClose} title="Editar Itens do Pedido" maxWidth="max-w-2xl">
      <div className="space-y-4">
        <div className="p-3 bg-orange-50 border border-orange-200 rounded-xl flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-orange-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-orange-800 font-medium">
            Alterações afetam quantidades e o total do pedido. Use para correções administrativas.
          </p>
        </div>

        {!initialized ? (
          <p className="text-center text-muted-foreground py-4">Carregando itens...</p>
        ) : (
          <div className="space-y-2">
            {editItems.map((item, idx) => {
              const product = products.find(p => p.id === Number(item.productId));
              return (
                <div key={idx} className="p-3 bg-muted/20 rounded-xl border border-border/50 space-y-2">
                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <p className="font-bold text-sm text-foreground">{product?.name || `Produto #${item.productId}`}</p>
                      {item.subCategoryName && (
                        <span className="inline-flex items-center gap-1 text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-bold mt-0.5">
                          <Tag className="w-2.5 h-2.5" /> {item.subCategoryName}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="number" min="0"
                        value={item.quantity}
                        onChange={e => handleQtyChange(idx, parseInt(e.target.value) || 0)}
                        className="w-20 text-center px-2 py-1.5 border-2 border-border rounded-lg font-bold outline-none focus:border-primary"
                        data-testid={`input-qty-item-${idx}`}
                      />
                      <span className="text-sm text-muted-foreground">{product?.unit}</span>
                      <div className="relative">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">R$</span>
                        <input
                          type="number" step="0.01" min="0"
                          value={item.unitPrice}
                          onChange={e => handlePriceChange(idx, parseFloat(e.target.value) || 0)}
                          className="w-24 pl-7 pr-2 py-1.5 border-2 border-border rounded-lg font-bold outline-none focus:border-primary text-sm"
                          data-testid={`input-price-item-${idx}`}
                        />
                      </div>
                      <p className="text-sm font-bold text-primary w-24 text-right">
                        R$ {(item.quantity * item.unitPrice).toFixed(2)}
                      </p>
                      <button onClick={() => handleRemove(idx)} className="p-1.5 text-muted-foreground hover:text-red-500 transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  {/* Sub-category selector for this product */}
                  <SubCategorySelector
                    productId={item.productId}
                    selectedSubCatId={item.subCategoryId}
                    onSelect={(subCat) => {
                      setEditItems(prev => prev.map((it, i) => i === idx ? {
                        ...it,
                        subCategoryId: subCat?.id ?? null,
                        subCategoryName: subCat?.categoryName ?? null,
                        unitPrice: subCat ? Number(subCat.price) : it.unitPrice,
                      } : it));
                    }}
                  />
                </div>
              );
            })}
          </div>
        )}

        <div className="border-t border-border pt-4 flex justify-between items-center">
          <div>
            <p className="text-sm text-muted-foreground">Novo Total</p>
            <p className="text-2xl font-display font-bold text-primary">R$ {total.toFixed(2)}</p>
          </div>
          <div className="flex gap-3">
            <button onClick={onClose} className="px-5 py-2.5 border-2 border-border rounded-xl font-bold text-muted-foreground hover:bg-muted transition-colors">
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !initialized}
              className="px-5 py-2.5 bg-primary text-white font-bold rounded-xl hover:-translate-y-0.5 transition-all disabled:opacity-50 flex items-center gap-2"
            >
              <Save className="w-4 h-4" /> {saving ? "Salvando..." : "Confirmar Alterações"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ── Sub-category selector widget for order items ───────────────────────────────
function SubCategorySelector({ productId, selectedSubCatId, onSelect }: {
  productId: number;
  selectedSubCatId: number | null;
  onSelect: (subCat: { id: number; categoryName: string; price: string } | null) => void;
}) {
  const { data: subCats = [] } = useQuery<any[]>({
    queryKey: ['/api/products', productId, 'sub-categories'],
    queryFn: async () => {
      const r = await fetch(`/api/products/${productId}/sub-categories`, { credentials: 'include' });
      if (!r.ok) return [];
      return r.json();
    },
    staleTime: 60000,
  });

  if (subCats.length === 0) return null;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-muted-foreground font-medium">Categoria:</span>
      <button
        type="button"
        onClick={() => onSelect(null)}
        className={`text-xs px-2 py-1 rounded-lg border transition-all ${selectedSubCatId === null ? 'bg-muted border-border font-bold text-foreground' : 'border-border/50 text-muted-foreground hover:border-border'}`}
        data-testid={`subcategory-none-${productId}`}
      >
        Sem categoria
      </button>
      {subCats.map((sc: any) => (
        <button
          key={sc.id}
          type="button"
          onClick={() => onSelect(sc)}
          className={`text-xs px-2 py-1 rounded-lg border transition-all ${selectedSubCatId === sc.id ? 'bg-indigo-600 text-white border-indigo-600 font-bold' : 'border-indigo-200 text-indigo-700 hover:bg-indigo-50'}`}
          data-testid={`subcategory-${sc.id}-${productId}`}
        >
          {sc.categoryName} — R$ {Number(sc.price).toFixed(2)}
        </button>
      ))}
    </div>
  );
}

// ─── Cancel Confirmation Modal ─────────────────────────────────
function CancelModal({ order, onClose, onConfirm }: { order: Order; onClose: () => void; onConfirm: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <Modal isOpen onClose={onClose} title="Cancelar Pedido" maxWidth="max-w-md">
      <div className="space-y-4">
        <div className="p-4 bg-red-50 rounded-xl border border-red-200 text-center">
          <XCircle className="w-12 h-12 text-red-500 mx-auto mb-2" />
          <p className="font-bold text-red-800">Tem certeza que deseja cancelar este pedido?</p>
          <p className="text-sm text-red-700 mt-1">{order.orderCode || `#${order.id}`}</p>
        </div>
        <p className="text-sm text-muted-foreground text-center">
          O pedido ficará marcado como cancelado e não será incluído nos relatórios de compras.
        </p>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-3 border-2 border-border rounded-xl font-bold text-muted-foreground hover:bg-muted transition-colors">
            Manter Pedido
          </button>
          <button
            onClick={async () => { setConfirming(true); await onConfirm(); onClose(); }}
            disabled={confirming}
            className="flex-1 py-3 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <XCircle className="w-4 h-4" /> {confirming ? "Cancelando..." : "Sim, Cancelar"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── DANFE Panel ──────────────────────────────────────────────
function DanfePanel({ order, company, products, queryClient }: { order: Order; company: any; products: any[]; queryClient: any }) {
  const { toast } = useToast();
  const [generating, setGenerating] = useState<"download" | "view" | "excel" | "xml" | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [updatingFiscal, setUpdatingFiscal] = useState(false);
  const [genNota, setGenNota] = useState(false);

  const { data: orderNfes = [], refetch: refetchNfes } = useQuery<any[]>({
    queryKey: ["/api/nfe", "order", order.id],
    queryFn: () => fetch(`/api/nfe?orderId=${order.id}`, { credentials: "include" }).then(r => r.ok ? r.json() : []),
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
      // NF.7.9.7 — intercepta PERIODO_FECHADO antes do toast genérico.
      if (handleIfPeriodoFechado(e, toast)) return;
      toast({ title: "Erro ao gerar NF-e", description: e.message, variant: "destructive" });
    },
  });

  const { data: danfeLogs, refetch: refetchLogs } = useQuery({
    queryKey: ["/api/orders", order.id, "danfe-logs"],
    queryFn: async () => {
      const res = await fetch(`/api/orders/${order.id}/danfe-logs`, { credentials: "include" });
      if (!res.ok) return [];
      // Migrated endpoint returns the standard envelope; legacy fallback
      // returns a bare array. `normalizeList` handles both transparently.
      return normalizeList<any>(await res.json());
    },
    enabled: showHistory,
  });

  const buildDanfeData = async (): Promise<DanfeData> => {
    const [detailRaw, configRes] = await Promise.all([
      fetch(`/api/orders/${order.id}`, { credentials: "include" }).then(r => r.json()),
      fetch("/api/company-config", { credentials: "include" }).then(r => r.ok ? r.json() : {} as any),
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
    await fetch(`/api/orders/${order.id}/danfe-log`, {
      method: "POST",
      credentials: "include",
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
    } finally {
      setGenerating(null);
    }
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
    } finally {
      setGenerating(null);
    }
  };

  const handleExcel = async () => {
    setGenerating("excel");
    try {
      const data = await buildDanfeData();
      exportToExcel(data);
      toast({ title: "Exportado para Excel com sucesso!" });
    } catch (e: any) {
      toast({ title: "Erro ao exportar Excel", description: e.message, variant: "destructive" });
    } finally {
      setGenerating(null);
    }
  };

  const handleXML = async () => {
    setGenerating("xml");
    try {
      const data = await buildDanfeData();
      exportToXML(data);
      toast({ title: "Exportado para XML com sucesso!" });
    } catch (e: any) {
      toast({ title: "Erro ao exportar XML", description: e.message, variant: "destructive" });
    } finally {
      setGenerating(null);
    }
  };

  const handleGeneratePreNota = async () => {
    setGenNota(true);
    try {
      const res = await fetch(`/api/orders/${order.id}/generate-prenota`, { method: "POST", credentials: "include" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(normalizeError(body).message || "Erro ao gerar pré-nota");
      const ok = normalizeOne<{ preNotaNumber: string }>(body) ?? body;
      toast({ title: `Pré-nota gerada: ${ok.preNotaNumber}` });
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
    } catch (e: any) {
      toast({ title: "Erro ao gerar pré-nota", description: e.message, variant: "destructive" });
    } finally {
      setGenNota(false);
    }
  };

  const handleUpdateFiscal = async (fiscalStatus: string) => {
    setUpdatingFiscal(true);
    try {
      const res = await fetch(`/api/orders/${order.id}/fiscal`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fiscalStatus }),
      });
      if (!res.ok) throw new Error("Erro ao atualizar status fiscal");
      toast({ title: `Status fiscal atualizado: ${FISCAL_LABEL[fiscalStatus] || fiscalStatus}` });
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/nfe/can-emit", order.id] });
    } catch (e: any) {
      // NF.7.9.7 — intercepta PERIODO_FECHADO antes do toast genérico.
      if (handleIfPeriodoFechado(e, toast)) return;
      toast({ title: "Erro ao atualizar fiscal", description: e.message, variant: "destructive" });
    } finally {
      setUpdatingFiscal(false);
    }
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
    } finally {
      setLoadingEmitGuard(false);
    }
  };

  const handlePreflight = async () => {
    try {
      setLoadingPreflight(true);
      const res = await getNFePreflight(order.id);
      setPreflightData(res);
      setPreflightOpen(true);
    } catch (err: any) {
      toast({ title: "Erro ao validar NF-e", description: err.message, variant: "destructive" });
    } finally {
      setLoadingPreflight(false);
    }
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
    } finally {
      setLoadingDiagnostics(false);
    }
  };

  const currentFiscal = order.fiscalStatus || "nota_pendente";

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
          <button
            data-testid={`button-danfe-download-${order.id}`}
            onClick={handleDownload}
            disabled={!!generating}
            className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white text-sm font-bold rounded-xl hover:bg-emerald-700 transition-colors disabled:opacity-50"
          >
            {generating === "download" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {generating === "download" ? "Gerando..." : "Baixar DANFE"}
          </button>
          <button
            data-testid={`button-danfe-view-${order.id}`}
            onClick={handleView}
            disabled={!!generating}
            className="flex items-center gap-1.5 px-4 py-2 bg-white border-2 border-emerald-600 text-emerald-700 text-sm font-bold rounded-xl hover:bg-emerald-50 transition-colors disabled:opacity-50"
          >
            {generating === "view" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
            {generating === "view" ? "Abrindo..." : "Visualizar DANFE"}
          </button>
          <button
            data-testid={`button-danfe-history-${order.id}`}
            onClick={() => setShowHistory(!showHistory)}
            className="flex items-center gap-1.5 px-4 py-2 bg-white border-2 border-border text-muted-foreground text-sm font-bold rounded-xl hover:bg-muted/30 transition-colors"
          >
            <History className="w-4 h-4" />
            Histórico
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
            <FileText className="w-4 h-4 text-blue-700" />
          </div>
          <p className="text-sm font-bold text-blue-800 uppercase tracking-wider">Exportação ERP</p>
          <span className="text-xs text-blue-600 bg-blue-100 px-2 py-0.5 rounded-full font-medium">Excel + XML</span>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            data-testid={`button-erp-excel-${order.id}`}
            onClick={handleExcel}
            disabled={!!generating}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-bold rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {generating === "excel" ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
            {generating === "excel" ? "Exportando..." : "Excel (.xlsx)"}
          </button>
          <button
            data-testid={`button-erp-xml-${order.id}`}
            onClick={handleXML}
            disabled={!!generating}
            className="flex items-center gap-1.5 px-4 py-2 bg-white border-2 border-blue-600 text-blue-700 text-sm font-bold rounded-xl hover:bg-blue-50 transition-colors disabled:opacity-50"
          >
            {generating === "xml" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Code2 className="w-4 h-4" />}
            {generating === "xml" ? "Exportando..." : "XML NF"}
          </button>
        </div>
      </div>

      {/* NF-e SEFAZ section */}
      {(() => {
        const activeNfe = orderNfes.find((n: any) => !["cancelada","rejeitada"].includes(n.status));
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
                    <span className="text-xs font-mono text-gray-400 truncate max-w-[180px]">
                      {activeNfe.chaveNFe.slice(0, 16)}...
                    </span>
                  )}
                </div>
                <a href="/admin/nfe" target="_blank" rel="noopener noreferrer">
                  <button
                    type="button"
                    data-testid={`button-ver-nfe-${order.id}`}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-white border-2 border-emerald-500 text-emerald-700 text-xs font-bold rounded-lg hover:bg-emerald-50 transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Ver no módulo NF-e
                  </button>
                </a>
              </div>
            ) : (
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  id={`emit-btn-${order.id}`}
                  data-testid={`button-emitir-nfe-${order.id}`}
                  onClick={() => handleEmitWithGuard(order.id)}
                  disabled={
                    emitirNfeMutation.isPending ||
                    order.status === "CANCELLED" ||
                    checkingEmit ||
                    loadingEmitGuard
                  }
                  title={canEmit === false ? blockReason : "Emitir NF"}
                  className={`flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white text-sm font-bold rounded-xl hover:bg-emerald-700 transition-colors disabled:opacity-50 ${justUnlocked ? "unlock-highlight" : ""} ${isShaking ? "shake-horizontal" : ""} ${canEmit === false ? "opacity-70 cursor-not-allowed" : ""}`}
                >
                  {(emitirNfeMutation.isPending || loadingEmitGuard) ? <Loader2 className="w-4 h-4 animate-spin" /> : <ReceiptText className="w-4 h-4" />}
                  {emitirNfeMutation.isPending ? "Gerando NF-e..." : loadingEmitGuard ? "Validando..." : "Emitir NF-e"}
                </button>
                {canEmit === false ? (
                  <span
                    data-testid={`badge-nfe-blocked-${order.id}`}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-red-600"
                  >
                    <AlertCircle className="w-3.5 h-3.5" />
                    {blockReason}
                    {canForceRelease && (
                      <button
                        type="button"
                        onClick={forceRelease}
                        disabled={isReleasing}
                        data-testid={`button-force-release-${order.id}`}
                        className="ml-2 text-xs text-blue-600 underline hover:text-blue-700 disabled:opacity-50"
                      >
                        {isReleasing ? "Liberando..." : "Liberar agora"}
                      </button>
                    )}
                  </span>
                ) : justUnlocked ? (
                  <span
                    data-testid={`badge-nfe-unlocked-${order.id}`}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Liberado
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-gray-400">Gera o XML e envia ao SEFAZ</span>
                    {faturamento?.label && (
                      <span
                        data-testid={`badge-faturamento-${order.id}`}
                        className="text-[11px] font-medium text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded"
                      >
                        {faturamento.label}
                      </span>
                    )}
                  </span>
                )}
                <button
                  type="button"
                  data-testid={`btn-preflight-order-${order.id}`}
                  onClick={handlePreflight}
                  disabled={loadingPreflight}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white border-2 border-sky-500 text-sky-700 text-xs font-bold rounded-lg hover:bg-sky-50 transition-colors disabled:opacity-50"
                >
                  {loadingPreflight ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                  Validar NF-e
                </button>
                <button
                  type="button"
                  data-testid={`btn-diagnostics-order-${order.id}`}
                  onClick={handleDiagnostics}
                  disabled={loadingDiagnostics}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white border-2 border-gray-400 text-gray-600 text-xs font-bold rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  {loadingDiagnostics ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Stethoscope className="w-3.5 h-3.5" />}
                  Diagnóstico
                </button>
              </div>
            )}
          </div>
        );
      })()}

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
            <button
              key={key}
              data-testid={`button-fiscal-${key}-${order.id}`}
              onClick={() => handleUpdateFiscal(key)}
              disabled={updatingFiscal || currentFiscal === key}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border-2 transition-colors disabled:opacity-60 ${
                currentFiscal === key
                  ? "border-violet-500 bg-violet-100 text-violet-700"
                  : "border-border bg-white text-muted-foreground hover:border-violet-400 hover:text-violet-700"
              }`}
            >
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
              <button
                data-testid={`button-generate-prenota-${order.id}`}
                onClick={handleGeneratePreNota}
                disabled={genNota}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 text-white text-xs font-bold rounded-lg hover:bg-violet-700 transition-colors disabled:opacity-50"
              >
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
          <DialogHeader>
            <DialogTitle>⚠ Problemas na NF-e</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm text-red-600">
              Foram encontrados erros na validação da NF-e.
            </div>
            <pre className="max-h-60 overflow-auto text-xs bg-gray-100 p-2 rounded whitespace-pre-wrap break-all">
              {JSON.stringify(emitPreflight, null, 2)}
            </pre>
            <div className="flex gap-2 justify-end pt-1">
              <button
                type="button"
                data-testid="button-emit-guard-cancel"
                onClick={() => setEmitGuardOpen(false)}
                className="px-4 py-2 text-sm font-semibold rounded-lg border-2 border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                data-testid="button-emit-guard-confirm"
                onClick={() => {
                  setEmitGuardOpen(false);
                  runOriginalEmit(pendingEmitOrderId ?? order.id);
                }}
                className="px-4 py-2 text-sm font-bold rounded-lg bg-orange-500 text-white hover:bg-orange-600 transition-colors"
              >
                Emitir mesmo assim
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Preflight Modal */}
      <Dialog open={preflightOpen} onOpenChange={setPreflightOpen}>
        <DialogContent className="max-w-xl" data-testid={`modal-preflight-${order.id}`}>
          <DialogHeader>
            <DialogTitle>Validação NF-e — Pedido #{order.id}</DialogTitle>
          </DialogHeader>
          {preflightData ? (
            <div className="space-y-2 max-h-[70vh] overflow-y-auto">
              {preflightData.errors?.length > 0 && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                  <p className="text-xs font-bold text-red-700 uppercase mb-1">Erros ({preflightData.errors.length})</p>
                  <ul className="space-y-1">
                    {preflightData.errors.map((e: string, i: number) => (
                      <li key={i} className="text-xs text-red-700 flex items-start gap-1.5">
                        <ShieldX className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                        {e}
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
                        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                        {w}
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
          ) : (
            <p className="text-sm text-muted-foreground">Nenhum dado disponível.</p>
          )}
        </DialogContent>
      </Dialog>

      {/* Diagnostics Modal */}
      <Dialog open={diagnosticsOpen} onOpenChange={setDiagnosticsOpen}>
        <DialogContent className="max-w-xl" data-testid={`modal-diagnostics-${order.id}`}>
          <DialogHeader>
            <DialogTitle>Diagnóstico NF-e — Pedido #{order.id}</DialogTitle>
          </DialogHeader>
          {diagnosticsData ? (
            <div className="max-h-[70vh] overflow-y-auto">
              <pre className="text-xs whitespace-pre-wrap break-all bg-gray-50 border border-gray-200 rounded-lg p-3">
                {JSON.stringify(diagnosticsData, null, 2)}
              </pre>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhum dado disponível.</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Order Row ────────────────────────────────────────────────
function OrderRow({
  order, company, companyName, products, onNoteEdit, onEdit, onCancel, onRestore, onPatchNimbi, onApproveReopen, onDenyReopen, onBlingExport, onTransition
}: {
  order: Order;
  company: any;
  companyName: string;
  products: any[];
  onNoteEdit: (order: Order) => void;
  onEdit: (order: Order) => void;
  onCancel: (order: Order) => void;
  onRestore: (order: Order) => void;
  onPatchNimbi: (id: number, date: string) => Promise<void>;
  onApproveReopen: (order: Order) => void;
  onDenyReopen: (order: Order) => void;
  onBlingExport: (order: Order) => Promise<void>;
  onTransition: (order: Order, to: string, label: string) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [nimbiDate, setNimbiDate] = useState(order.nimbiExpiration || '');
  const [savingNimbi, setSavingNimbi] = useState(false);
  const [blingExporting, setBlingExporting] = useState(false);
  const { data: detail } = useOrderDetail(expanded ? order.id : undefined);
  const qc = useQueryClient();
  const isCancelled = order.status === 'CANCELLED';
  const isReopenRequested = order.status === 'REOPEN_REQUESTED';
  const erpStatus = order.erpExportStatus || 'nao_exportado';

  const handleSaveNimbi = async () => {
    setSavingNimbi(true);
    try { await onPatchNimbi(order.id, nimbiDate); } finally { setSavingNimbi(false); }
  };

  const handleBlingExport = async () => {
    setBlingExporting(true);
    try { await onBlingExport(order); } finally { setBlingExporting(false); }
  };

  return (
    <>
      <tr className={`transition-colors cursor-pointer ${isCancelled ? 'opacity-60 bg-red-50/30' : 'hover:bg-muted/10'}`}
        onClick={() => setExpanded(!expanded)}>
        <td className="px-5 py-4">
          <div className="flex items-center gap-2">
            <Receipt className="w-4 h-4 text-primary flex-shrink-0" />
            <div>
              <p className="font-bold text-primary font-mono text-sm">{order.orderCode || `#${String(order.id).padStart(4,'0')}`}</p>
              <div className="flex gap-1 flex-wrap mt-0.5">
                <span className={`text-xs font-bold px-1.5 py-0.5 rounded-md ${STATUS_BADGE[order.status] || STATUS_BADGE.ACTIVE}`}>
                  {STATUS_LABEL[order.status] || order.status}
                </span>
                {order.workflowStatus && WF_BADGE[order.workflowStatus] && (
                  <span
                    data-testid={`badge-workflow-${order.id}`}
                    className={`text-xs font-bold px-1.5 py-0.5 rounded-md border ${WF_BADGE[order.workflowStatus]}`}
                    title={`Etapa operacional: ${WF_LABEL[order.workflowStatus] || order.workflowStatus}`}
                  >
                    {WF_LABEL[order.workflowStatus] || order.workflowStatus}
                  </span>
                )}
                {order.fiscalStatus && (
                  <span className={`text-xs font-bold px-1.5 py-0.5 rounded-md border ${FISCAL_BADGE[order.fiscalStatus] || "bg-gray-100 text-gray-600 border-gray-300"}`}>
                    {FISCAL_LABEL[order.fiscalStatus] || order.fiscalStatus}
                  </span>
                )}
                {order.preNotaNumber && (
                  <span className="text-xs text-violet-600 font-mono">{order.preNotaNumber}</span>
                )}
                {(order.erpExportStatus && order.erpExportStatus !== 'nao_exportado') && (
                  <span className={`text-xs font-bold px-1.5 py-0.5 rounded-md border flex items-center gap-0.5 ${ERP_STATUS_BADGE[order.erpExportStatus] || ERP_STATUS_BADGE.nao_exportado}`}>
                    <Send className="w-2.5 h-2.5" />
                    {ERP_STATUS_LABEL[order.erpExportStatus] || order.erpExportStatus}
                  </span>
                )}
                {/* FASE FIN.4 — badge "Pago" derivado da projeção exposta no FIN.2.
                    Cast `as any` local: o tipo `Order` do `@shared/schema` permanece
                    intocado (regra: NÃO alterar tipagem existente). O backend já
                    sempre devolve `isPaid` e `paidAt` em GET /api/orders e
                    GET /api/orders/:id (FIN.2 — fail-safe → false/null). */}
                {(order as any).isPaid && (
                  <span
                    className="inline-flex items-center gap-1 text-xs font-bold px-1.5 py-0.5 rounded-md bg-green-100 text-green-800 border border-green-300"
                    data-testid={`badge-paid-${order.id}`}
                    title={
                      (order as any).paidAt
                        ? `Pago em ${new Date((order as any).paidAt).toLocaleDateString('pt-BR')}`
                        : "Pago"
                    }
                  >
                    ✓ Pago
                  </span>
                )}
              </div>
            </div>
          </div>
        </td>
        <td className="px-5 py-4">
          <p className="font-bold text-sm text-foreground">{companyName}</p>
        </td>
        <td className="px-5 py-4">
          <div>
            <p className="text-sm font-medium text-foreground">{format(new Date(order.orderDate), "d MMM yyyy", { locale: ptBR })}</p>
            <p className="text-xs text-muted-foreground">{format(new Date(order.orderDate), "HH:mm")}</p>
          </div>
        </td>
        <td className="px-5 py-4">
          <span className="px-2.5 py-1 bg-orange-100 text-orange-800 rounded-lg text-xs font-bold">
            {format(new Date(order.deliveryDate), "EEE, d MMM", { locale: ptBR })}
          </span>
        </td>
        <td className="px-5 py-4">
          {order.orderNote ? (
            <span className="flex items-center gap-1 text-xs text-blue-600">
              <MessageSquare className="w-3.5 h-3.5" />
              <span className="truncate max-w-[100px]">{order.orderNote}</span>
            </span>
          ) : <span className="text-muted-foreground text-sm">—</span>}
        </td>
        <td className="px-5 py-4">
          {order.adminNote ? (
            <span className="flex items-center gap-1 text-xs text-purple-600">
              <StickyNote className="w-3.5 h-3.5" />
              <span className="truncate max-w-[100px]">{order.adminNote}</span>
            </span>
          ) : <span className="text-muted-foreground text-sm">—</span>}
        </td>
        <td className="px-5 py-4 font-bold text-sm text-foreground">
          R$ {Number(order.totalValue).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
        </td>
        <td className="px-5 py-4">
          {/* Action buttons */}
          <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
            {isReopenRequested ? (
              <>
                <button
                  data-testid={`button-approve-reopen-${order.id}`}
                  onClick={() => onApproveReopen(order)}
                  title="Aprovar reabertura"
                  className="p-1.5 text-muted-foreground hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                >
                  <ThumbsUp className="w-4 h-4" />
                </button>
                <button
                  data-testid={`button-deny-reopen-${order.id}`}
                  onClick={() => onDenyReopen(order)}
                  title="Negar reabertura"
                  className="p-1.5 text-muted-foreground hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                >
                  <ThumbsDown className="w-4 h-4" />
                </button>
              </>
            ) : !isCancelled ? (
              <>
                {(() => {
                  const wf = order.workflowStatus as string | undefined;
                  const NEXT: Record<string, { to: string; label: string; cls: string }> = {
                    APPROVED:   { to: "PROCESSING", label: "Iniciar Separação", cls: "bg-amber-50 text-amber-700 border-amber-300 hover:bg-amber-100" },
                    PROCESSING: { to: "READY",      label: "Pedido Pronto",     cls: "bg-violet-50 text-violet-700 border-violet-300 hover:bg-violet-100" },
                    READY:      { to: "INVOICED",   label: "Faturar",           cls: "bg-cyan-50 text-cyan-700 border-cyan-300 hover:bg-cyan-100" },
                    INVOICED:   { to: "SHIPPED",    label: "Saiu p/ Entrega",   cls: "bg-indigo-50 text-indigo-700 border-indigo-300 hover:bg-indigo-100" },
                    SHIPPED:    { to: "DELIVERED",  label: "Entregue",          cls: "bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-emerald-100" },
                  };
                  const step = wf ? NEXT[wf] : undefined;
                  if (!step) return null;
                  return (
                    <button
                      data-testid={`button-transition-${order.id}`}
                      onClick={() => onTransition(order, step.to, step.label)}
                      title={`Mover para: ${step.label}`}
                      className={`px-2 py-1 text-xs font-bold rounded-lg border transition-colors ${step.cls}`}
                    >
                      {step.label}
                    </button>
                  );
                })()}
                <button
                  data-testid={`button-note-${order.id}`}
                  onClick={() => onNoteEdit(order)}
                  title="Obs. Admin"
                  className="p-1.5 text-muted-foreground hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
                >
                  <StickyNote className="w-4 h-4" />
                </button>
                <button
                  data-testid={`button-edit-${order.id}`}
                  onClick={() => onEdit(order)}
                  title="Editar itens"
                  className="p-1.5 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-lg transition-colors"
                >
                  <Edit3 className="w-4 h-4" />
                </button>
                <button
                  data-testid={`button-cancel-${order.id}`}
                  onClick={() => onCancel(order)}
                  title="Cancelar"
                  className="p-1.5 text-muted-foreground hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                >
                  <XCircle className="w-4 h-4" />
                </button>
              </>
            ) : (
              <button
                data-testid={`button-restore-${order.id}`}
                onClick={() => onRestore(order)}
                title="Restaurar"
                className="p-1.5 text-muted-foreground hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"
              >
                <CheckCircle className="w-4 h-4" />
              </button>
            )}
            <button className="p-1.5 text-muted-foreground">
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>
        </td>
      </tr>

      {/* Expanded detail */}
      {expanded && (
        <tr>
          <td colSpan={8} className="px-5 py-0 bg-muted/10 border-b border-border/50">
            <div className="py-4 space-y-3">
              {/* FASE FIN.4 — confirmação visual de pagamento na expansão.
                  Renderiza apenas quando o backend (FIN.2) reportou `isPaid:true`.
                  Não substitui nenhum bloco existente — aparece como cabeçalho
                  informativo logo no topo do detalhe expandido. */}
              {(order as any).isPaid && (
                <div
                  className="flex items-center gap-2 p-3 bg-green-50 rounded-xl border border-green-200"
                  data-testid={`status-paid-${order.id}`}
                >
                  <span className="text-sm text-green-700 font-bold">
                    ✓ Pago em {(order as any).paidAt
                      ? new Date((order as any).paidAt).toLocaleDateString('pt-BR')
                      : "-"}
                  </span>
                </div>
              )}
              {/* Bling Export — data de exportação manual + status automático */}
              <div className="space-y-2">
                <div className="flex items-center gap-3 p-3 bg-orange-50 rounded-xl border border-orange-100">
                  <Calendar className="w-4 h-4 text-orange-600 flex-shrink-0" />
                  <span className="text-xs font-bold text-orange-700 uppercase tracking-wider">Exportar para Bling</span>
                  <input type="date" value={nimbiDate} onChange={e => setNimbiDate(e.target.value)}
                    data-testid={`input-nimbi-${order.id}`}
                    className="px-3 py-1.5 border-2 border-orange-200 rounded-lg text-sm focus:border-orange-400 outline-none bg-white" />
                  <button onClick={handleSaveNimbi} disabled={savingNimbi}
                    data-testid={`button-save-nimbi-${order.id}`}
                    className="px-3 py-1.5 bg-orange-500 text-white text-xs font-bold rounded-lg hover:bg-orange-600 transition-colors disabled:opacity-50">
                    {savingNimbi ? '...' : 'Salvar'}
                  </button>
                  {nimbiDate && <button onClick={() => { setNimbiDate(''); onPatchNimbi(order.id, ''); }}
                    className="px-3 py-1.5 border border-orange-300 text-orange-600 text-xs font-bold rounded-lg hover:bg-orange-100 transition-colors">
                    Limpar
                  </button>}
                </div>
                {/* ERP Bling status & export button */}
                <div className="flex items-center gap-3 p-3 bg-emerald-50 rounded-xl border border-emerald-100">
                  <Send className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                  <div className="flex-1 flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-emerald-700 uppercase tracking-wider">Status Bling:</span>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${ERP_STATUS_BADGE[erpStatus]}`}>
                      {erpStatus === 'exportando' && <Clock className="w-2.5 h-2.5 inline mr-0.5" />}
                      {erpStatus === 'exportado' && <ShieldCheck className="w-2.5 h-2.5 inline mr-0.5" />}
                      {erpStatus === 'erro' && <ShieldX className="w-2.5 h-2.5 inline mr-0.5" />}
                      {ERP_STATUS_LABEL[erpStatus] || erpStatus}
                    </span>
                    {order.erpId && (
                      <span className="text-xs text-emerald-600 font-mono">{order.erpId}</span>
                    )}
                    {order.erpExportedAt && (
                      <span className="text-xs text-emerald-600">
                        {format(new Date(order.erpExportedAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                      </span>
                    )}
                    {order.erpExportError && erpStatus === 'erro' && (
                      <span className="text-xs text-red-600">{order.erpExportError}</span>
                    )}
                  </div>
                  {erpStatus === 'exportado' ? (
                    <span className="text-xs text-emerald-600 font-medium">✓ Já exportado</span>
                  ) : (
                    <button
                      onClick={handleBlingExport}
                      disabled={blingExporting || erpStatus === 'exportando'}
                      data-testid={`button-bling-export-${order.id}`}
                      className="px-3 py-1.5 bg-emerald-500 text-white text-xs font-bold rounded-lg hover:bg-emerald-600 transition-colors disabled:opacity-50 flex items-center gap-1.5">
                      {blingExporting || erpStatus === 'exportando'
                        ? <><RefreshCw className="w-3 h-3 animate-spin" /> Exportando...</>
                        : <><Send className="w-3 h-3" /> Exportar para Bling</>}
                    </button>
                  )}
                </div>
              </div>
              {order.reopenReason && (
                <div className="flex items-start gap-2 p-3 bg-orange-50 rounded-xl border border-orange-200">
                  <ClipboardEdit className="w-4 h-4 text-orange-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-xs font-bold text-orange-700 uppercase tracking-wider mb-0.5">Motivo da solicitação de alteração</p>
                    <p className="text-sm text-orange-900 font-medium">{order.reopenReason}</p>
                    {order.reopenRequestedAt && (
                      <p className="text-xs text-orange-600 mt-0.5">{format(new Date(order.reopenRequestedAt), "d MMM yyyy 'às' HH:mm", { locale: ptBR })}</p>
                    )}
                    {isReopenRequested && (
                      <div className="flex gap-2 mt-2">
                        <button onClick={() => onApproveReopen(order)}
                          data-testid={`button-approve-expanded-${order.id}`}
                          className="px-3 py-1.5 bg-green-500 text-white text-xs font-bold rounded-lg hover:bg-green-600 transition-colors flex items-center gap-1">
                          <ThumbsUp className="w-3.5 h-3.5" /> Aprovar Reabertura
                        </button>
                        <button onClick={() => onDenyReopen(order)}
                          data-testid={`button-deny-expanded-${order.id}`}
                          className="px-3 py-1.5 bg-red-500 text-white text-xs font-bold rounded-lg hover:bg-red-600 transition-colors flex items-center gap-1">
                          <ThumbsDown className="w-3.5 h-3.5" /> Negar Reabertura
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
              {order.orderNote && (
                <div className="flex items-start gap-2 p-3 bg-blue-50 rounded-xl border border-blue-100">
                  <MessageSquare className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-xs font-bold text-blue-700 uppercase tracking-wider mb-0.5">Obs. do cliente</p>
                    <p className="text-sm text-blue-900">{order.orderNote}</p>
                  </div>
                </div>
              )}
              {order.adminNote && (
                <div className="flex items-start gap-2 p-3 bg-purple-50 rounded-xl border border-purple-100">
                  <StickyNote className="w-4 h-4 text-purple-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-xs font-bold text-purple-700 uppercase tracking-wider mb-0.5">Obs. Administrativa</p>
                    <p className="text-sm text-purple-900">{order.adminNote}</p>
                  </div>
                </div>
              )}
              {!detail ? (
                <p className="text-sm text-muted-foreground">Carregando itens...</p>
              ) : (detail.items || []).length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum item.</p>
              ) : (
                <div>
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
                    <Package className="w-3.5 h-3.5" /> Itens
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {(detail.items || []).map((item: any) => {
                      const product = products.find(p => p.id === Number(item.productId));
                      return (
                        <div key={item.id} className="bg-card rounded-xl p-3 border border-border/50 flex justify-between items-center">
                          <div>
                            <p className="font-bold text-sm text-foreground">{product?.name || `Produto #${item.productId}`}</p>
                            <p className="text-xs text-muted-foreground">{item.quantity} × R$ {Number(item.unitPrice).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                          </div>
                          <p className="font-bold text-sm text-primary">R$ {Number(item.totalPrice).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {/* DANFE Panel */}
              <DanfePanel order={order} company={company} products={products} queryClient={qc} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Export Orders Modal ──────────────────────────────────────
const ORDER_TYPE_OPTIONS = [
  { value: 'all', label: 'Todos os tipos' },
  { value: 'semanal', label: 'Semanal' },
  { value: 'mensal', label: 'Mensal' },
  { value: 'pontual', label: 'Pontual' },
  { value: 'contratual', label: 'Contratual' },
  { value: 'teste', label: 'Teste' },
];
const CLIENT_TYPE_PT: Record<string, string> = {
  semanal: 'Semanal', mensal: 'Mensal', pontual: 'Pontual', contratual: 'Contratual', quinzenal: 'Quinzenal',
};
const STATUS_PT: Record<string, string> = {
  ACTIVE: 'Ativo', CANCELLED: 'Cancelado', REOPEN_REQUESTED: 'Reabertura solicitada', CLOSED: 'Fechado',
};

function ExportOrdersModal({ companies, onClose }: { companies: any[]; onClose: () => void }) {
  const { toast } = useToast();
  const [companyId, setCompanyId] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [orderType, setOrderType] = useState('all');
  const [loading, setLoading] = useState<'excel' | 'csv' | 'pdf' | null>(null);

  const buildUrl = () => {
    const params = new URLSearchParams();
    if (companyId !== 'all') params.set('companyId', companyId);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    if (orderType !== 'all') params.set('orderType', orderType);
    return `/api/orders/export?${params.toString()}`;
  };

  const fetchData = async () => {
    const res = await fetch(buildUrl(), { credentials: 'include' });
    if (!res.ok) throw new Error('Erro ao buscar pedidos');
    return res.json() as Promise<any[]>;
  };

  const flattenRows = (data: any[]) => {
    const rows: any[] = [];
    for (const order of data) {
      const base = {
        'Empresa': order.companyName,
        'Tipo de contrato': CLIENT_TYPE_PT[order.clientType] || order.clientType || '—',
        'Data do pedido': order.orderDate ? format(new Date(order.orderDate), 'dd/MM/yyyy', { locale: ptBR }) : '—',
        'Data de entrega': order.deliveryDate ? format(new Date(order.deliveryDate), 'dd/MM/yyyy', { locale: ptBR }) : '—',
        'Código': order.orderCode || '',
        'Status': STATUS_PT[order.status] || order.status,
        'Observações': order.orderNote || order.adminNote || '',
      };
      if (order.items && order.items.length > 0) {
        for (const item of order.items) {
          rows.push({
            ...base,
            'Produto': item.productName,
            'Categoria': item.productCategory,
            'Unidade': item.productUnit,
            'Quantidade': Number(item.quantity),
            'Preço unitário (R$)': Number(item.unitPrice).toFixed(2),
            'Valor total (R$)': Number(item.totalPrice).toFixed(2),
          });
        }
      } else {
        rows.push({ ...base, 'Produto': '—', 'Categoria': '—', 'Unidade': '—', 'Quantidade': 0, 'Preço unitário (R$)': '0.00', 'Valor total (R$)': Number(order.totalValue || 0).toFixed(2) });
      }
    }
    return rows;
  };

  const handleExcel = async () => {
    setLoading('excel');
    try {
      const data = await fetchData();
      const rows = flattenRows(data);
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Pedidos');
      XLSX.writeFile(wb, `pedidos-${new Date().toISOString().split('T')[0]}.xlsx`);
      toast({ title: 'Excel exportado!', description: `${rows.length} linha(s) exportada(s)` });
    } catch (e: any) {
      toast({ title: 'Erro ao exportar', description: e.message, variant: 'destructive' });
    } finally { setLoading(null); }
  };

  const handleCsv = async () => {
    setLoading('csv');
    try {
      const data = await fetchData();
      const rows = flattenRows(data);
      if (rows.length === 0) { toast({ title: 'Nenhum pedido encontrado' }); setLoading(null); return; }
      const headers = Object.keys(rows[0]);
      const csvLines = [headers.join(';'), ...rows.map(r => headers.map(h => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(';'))];
      const blob = new Blob(['\uFEFF' + csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `pedidos-${new Date().toISOString().split('T')[0]}.csv`; a.click();
      URL.revokeObjectURL(url);
      toast({ title: 'CSV exportado!', description: `${rows.length} linha(s) exportada(s)` });
    } catch (e: any) {
      toast({ title: 'Erro ao exportar', description: e.message, variant: 'destructive' });
    } finally { setLoading(null); }
  };

  const handlePdf = async () => {
    setLoading('pdf');
    try {
      const data = await fetchData();
      const rows = flattenRows(data);
      if (rows.length === 0) { toast({ title: 'Nenhum pedido encontrado' }); setLoading(null); return; }
      const doc = new jsPDF({ orientation: 'landscape' });
      doc.setFontSize(14);
      doc.text('Exportação de Pedidos — VivaFrutaz', 14, 16);
      doc.setFontSize(9);
      doc.text(`Gerado em ${format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}`, 14, 22);
      const cols = ['Empresa', 'Tipo de contrato', 'Data do pedido', 'Data de entrega', 'Produto', 'Categoria', 'Quantidade', 'Preço unitário (R$)', 'Valor total (R$)', 'Status'];
      autoTable(doc, {
        head: [cols],
        body: rows.map(r => cols.map(c => String(r[c] ?? '—'))),
        startY: 28,
        styles: { fontSize: 7, cellPadding: 2 },
        headStyles: { fillColor: [34, 197, 94], textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [245, 253, 245] },
      });
      doc.save(`pedidos-${new Date().toISOString().split('T')[0]}.pdf`);
      toast({ title: 'PDF exportado!', description: `${rows.length} linha(s) exportada(s)` });
    } catch (e: any) {
      toast({ title: 'Erro ao exportar PDF', description: e.message, variant: 'destructive' });
    } finally { setLoading(null); }
  };

  return (
    <Modal isOpen onClose={onClose} title="Exportar Pedidos" maxWidth="max-w-lg">
      <div className="space-y-4">
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-700 font-medium">
          Exporte todos os pedidos com detalhes de produtos. Aplique filtros para refinar os resultados.
        </div>

        {/* Filtros */}
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-foreground mb-1.5">Empresa</label>
            <select value={companyId} onChange={e => setCompanyId(e.target.value)}
              data-testid="select-export-company"
              className="w-full px-3 py-2.5 rounded-xl border-2 border-border text-sm focus:border-primary outline-none">
              <option value="all">Todas as empresas</option>
              {companies.map((c: any) => <option key={c.id} value={String(c.id)}>{c.companyName}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">Data inicial</label>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                data-testid="input-export-from"
                className="w-full px-3 py-2.5 rounded-xl border-2 border-border text-sm focus:border-primary outline-none" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">Data final</label>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                data-testid="input-export-to"
                className="w-full px-3 py-2.5 rounded-xl border-2 border-border text-sm focus:border-primary outline-none" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-foreground mb-1.5">Tipo de pedido</label>
            <select value={orderType} onChange={e => setOrderType(e.target.value)}
              data-testid="select-export-type"
              className="w-full px-3 py-2.5 rounded-xl border-2 border-border text-sm focus:border-primary outline-none">
              {ORDER_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>

        {/* Export buttons */}
        <div className="border-t border-border/50 pt-4">
          <p className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wider">Formato de exportação</p>
          <div className="grid grid-cols-3 gap-2">
            <button type="button" onClick={handleExcel} disabled={loading !== null}
              data-testid="button-export-excel"
              className="flex flex-col items-center gap-1.5 p-3 bg-emerald-50 border-2 border-emerald-200 rounded-xl hover:bg-emerald-100 transition-colors disabled:opacity-50">
              {loading === 'excel' ? <Loader2 className="w-5 h-5 text-emerald-600 animate-spin" /> : <FileSpreadsheet className="w-5 h-5 text-emerald-600" />}
              <span className="text-xs font-bold text-emerald-700">Excel</span>
              <span className="text-[10px] text-emerald-600">.xlsx</span>
            </button>
            <button type="button" onClick={handleCsv} disabled={loading !== null}
              data-testid="button-export-csv"
              className="flex flex-col items-center gap-1.5 p-3 bg-blue-50 border-2 border-blue-200 rounded-xl hover:bg-blue-100 transition-colors disabled:opacity-50">
              {loading === 'csv' ? <Loader2 className="w-5 h-5 text-blue-600 animate-spin" /> : <FileDown className="w-5 h-5 text-blue-600" />}
              <span className="text-xs font-bold text-blue-700">CSV</span>
              <span className="text-[10px] text-blue-600">.csv</span>
            </button>
            <button type="button" onClick={handlePdf} disabled={loading !== null}
              data-testid="button-export-pdf"
              className="flex flex-col items-center gap-1.5 p-3 bg-red-50 border-2 border-red-200 rounded-xl hover:bg-red-100 transition-colors disabled:opacity-50">
              {loading === 'pdf' ? <Loader2 className="w-5 h-5 text-red-600 animate-spin" /> : <FileText className="w-5 h-5 text-red-600" />}
              <span className="text-xs font-bold text-red-700">PDF</span>
              <span className="text-[10px] text-red-600">.pdf</span>
            </button>
          </div>
        </div>

        <button type="button" onClick={onClose}
          className="w-full py-2.5 rounded-xl border border-border text-sm text-muted-foreground hover:bg-muted/50 transition-colors">
          Fechar
        </button>
      </div>
    </Modal>
  );
}

// ─── Delete History Modal ─────────────────────────────────────
function DeleteHistoryModal({ orders, companies, onClose, onDeleted }: {
  orders: any[];
  companies: any[];
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { toast } = useToast();
  const [tab, setTab] = useState<'especifico' | 'periodo' | 'cliente'>('especifico');
  const [motivo, setMotivo] = useState('');
  const [specificCode, setSpecificCode] = useState('');
  const [periodoInicio, setPeriodoInicio] = useState('');
  const [periodoFim, setPeriodoFim] = useState('');
  const [clienteId, setClienteId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'form' | 'review' | 'confirm-fiscal'>('form');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [fiscalConflict, setFiscalConflict] = useState<{ count: number; codes: string[] } | null>(null);

  const getTargetOrders = () => {
    if (tab === 'especifico') {
      const found = orders.filter(o =>
        (o.orderCode || '').toLowerCase().includes(specificCode.toLowerCase()) ||
        String(o.id) === specificCode
      );
      return found;
    }
    if (tab === 'periodo') {
      const inicio = periodoInicio ? new Date(periodoInicio) : null;
      const fim = periodoFim ? new Date(periodoFim + 'T23:59:59') : null;
      return orders.filter(o => {
        const d = new Date(o.deliveryDate || o.orderDate);
        if (inicio && d < inicio) return false;
        if (fim && d > fim) return false;
        return true;
      });
    }
    if (tab === 'cliente') {
      if (!clienteId) return [];
      return orders.filter(o => String(o.companyId) === clienteId);
    }
    return [];
  };

  const handleReview = () => {
    const targets = getTargetOrders();
    if (targets.length === 0) {
      toast({ title: 'Nenhum pedido encontrado com esses critérios.', variant: 'destructive' });
      return;
    }
    if (!motivo.trim()) {
      toast({ title: 'Informe o motivo da exclusão.', variant: 'destructive' });
      return;
    }
    setSelectedIds(targets.map(o => o.id));
    setStep('review');
  };

  const handleDelete = async (forceConfirm = false) => {
    setLoading(true);
    try {
      const res = await fetch('/api/orders/bulk', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ orderIds: selectedIds, motivo, confirmar: forceConfirm }),
      });
      const body = await res.json().catch(() => ({}));
      // Tolerate both shapes: standard envelope (`error.details.{...}`) AND
      // legacy raw shape (`{ message, requiresConfirmation, ... }`).
      const err = normalizeError(body);
      const conflictDetails = err.details || body;
      if (res.status === 409 && conflictDetails?.requiresConfirmation) {
        setFiscalConflict({
          count: conflictDetails.billedCount,
          codes: conflictDetails.billedCodes || [],
        });
        setStep('confirm-fiscal');
        return;
      }
      if (!res.ok) {
        // NF.7.9.7 — intercepta PERIODO_FECHADO antes do toast genérico.
        if (handleIfPeriodoFechado(err, toast)) return;
        toast({ title: err.message || 'Erro ao excluir pedidos', variant: 'destructive' });
        return;
      }
      const ok = normalizeOne<{ deleted: number }>(body) ?? body;
      toast({ title: `${ok.deleted} pedido(s) excluído(s) com sucesso!` });
      onDeleted();
      onClose();
    } catch {
      toast({ title: 'Erro de conexão. Tente novamente.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  if (step === 'review') {
    const targets = orders.filter(o => selectedIds.includes(o.id));
    return (
      <Modal isOpen onClose={() => setStep('form')} title="Confirmar Exclusão" maxWidth="max-w-lg">
        <div className="space-y-4">
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl">
            <p className="text-sm font-bold text-red-800">{targets.length} pedido(s) serão excluídos permanentemente.</p>
            <p className="text-xs text-red-600 mt-1">Motivo registrado: {motivo}</p>
          </div>
          <div className="max-h-48 overflow-y-auto space-y-1">
            {targets.map(o => {
              const co = companies.find(c => c.id === o.companyId);
              return (
                <div key={o.id} className="flex items-center justify-between px-3 py-2 bg-muted/30 rounded-lg text-sm">
                  <span className="font-mono font-bold">{o.orderCode || `#${o.id}`}</span>
                  <span className="text-muted-foreground text-xs">{co?.companyName || `Empresa #${o.companyId}`}</span>
                  {['nota_emitida', 'nota_exportada'].includes(o.fiscalStatus || '') && (
                    <span className="text-xs font-bold text-orange-600 bg-orange-100 px-2 py-0.5 rounded-full">NF</span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={() => setStep('form')} className="flex-1 py-2.5 border-2 border-border rounded-xl font-bold text-muted-foreground hover:bg-muted transition-colors">
              Voltar
            </button>
            <button type="button" onClick={() => handleDelete(false)} disabled={loading}
              className="flex-1 py-2.5 bg-red-600 text-white font-bold rounded-xl hover:-translate-y-0.5 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
              <Trash2 className="w-4 h-4" /> {loading ? 'Excluindo...' : 'Confirmar Exclusão'}
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  if (step === 'confirm-fiscal' && fiscalConflict) {
    return (
      <Modal isOpen onClose={() => setStep('review')} title="Atenção — Pedidos Faturados" maxWidth="max-w-lg">
        <div className="space-y-4">
          <div className="p-4 bg-orange-50 border-2 border-orange-300 rounded-xl">
            <AlertTriangle className="w-8 h-8 text-orange-600 mb-2" />
            <p className="font-bold text-orange-800">
              {fiscalConflict.count} pedido(s) já possuem Nota Fiscal emitida ou exportada:
            </p>
            <p className="text-xs text-orange-700 mt-1">{fiscalConflict.codes.join(', ')}</p>
            <p className="text-sm text-orange-700 mt-2">Deseja excluir mesmo assim? Esta ação é irreversível.</p>
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={() => setStep('review')} className="flex-1 py-2.5 border-2 border-border rounded-xl font-bold text-muted-foreground hover:bg-muted transition-colors">
              Cancelar
            </button>
            <button type="button" onClick={() => handleDelete(true)} disabled={loading}
              className="flex-1 py-2.5 bg-red-600 text-white font-bold rounded-xl hover:-translate-y-0.5 transition-all disabled:opacity-50">
              {loading ? 'Excluindo...' : 'Excluir mesmo assim'}
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal isOpen onClose={onClose} title="Excluir Histórico de Pedidos" maxWidth="max-w-lg">
      <div className="space-y-4">
        <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-xl flex gap-2">
          <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-yellow-800">Esta operação é permanente e irreversível. Toda exclusão é registrada no log de auditoria.</p>
        </div>

        {/* Tabs */}
        <div className="flex p-1 gap-1 bg-muted/40 rounded-xl">
          {(['especifico', 'periodo', 'cliente'] as const).map(t => (
            <button key={t} type="button" onClick={() => setTab(t)}
              data-testid={`delete-tab-${t}`}
              className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${tab === t ? 'bg-white text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
              {t === 'especifico' ? 'Pedido Específico' : t === 'periodo' ? 'Por Período' : 'Por Cliente'}
            </button>
          ))}
        </div>

        {tab === 'especifico' && (
          <div>
            <label className="block text-sm font-semibold mb-1.5">Código ou número do pedido</label>
            <input value={specificCode} onChange={e => setSpecificCode(e.target.value)}
              data-testid="input-delete-specific"
              className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none"
              placeholder="Ex: VF-2026-001234" />
            {specificCode && (
              <p className="text-xs text-muted-foreground mt-1">{getTargetOrders().length} pedido(s) encontrado(s)</p>
            )}
          </div>
        )}

        {tab === 'periodo' && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-semibold mb-1.5">Data inicial</label>
              <input type="date" value={periodoInicio} onChange={e => setPeriodoInicio(e.target.value)}
                data-testid="input-delete-inicio"
                className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none" />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1.5">Data final</label>
              <input type="date" value={periodoFim} onChange={e => setPeriodoFim(e.target.value)}
                data-testid="input-delete-fim"
                className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none" />
            </div>
            {(periodoInicio || periodoFim) && (
              <p className="col-span-2 text-xs text-muted-foreground">{getTargetOrders().length} pedido(s) no período</p>
            )}
          </div>
        )}

        {tab === 'cliente' && (
          <div>
            <label className="block text-sm font-semibold mb-1.5">Empresa</label>
            <select value={clienteId} onChange={e => setClienteId(e.target.value)}
              data-testid="select-delete-client"
              className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none bg-background">
              <option value="">Selecione a empresa...</option>
              {companies.map(c => <option key={c.id} value={String(c.id)}>{c.companyName}</option>)}
            </select>
            {clienteId && (
              <p className="text-xs text-muted-foreground mt-1">{getTargetOrders().length} pedido(s) desta empresa</p>
            )}
          </div>
        )}

        <div>
          <label className="block text-sm font-semibold mb-1.5">Motivo da exclusão *</label>
          <textarea value={motivo} onChange={e => setMotivo(e.target.value)}
            data-testid="input-delete-motivo"
            rows={2}
            placeholder="Informe o motivo para registro no log de auditoria..."
            className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none resize-none" />
        </div>

        <div className="flex gap-3">
          <button type="button" onClick={onClose} className="flex-1 py-2.5 border-2 border-border rounded-xl font-bold text-muted-foreground hover:bg-muted transition-colors">
            Cancelar
          </button>
          <button type="button" onClick={handleReview}
            data-testid="button-delete-review"
            className="flex-1 py-2.5 bg-red-600 text-white font-bold rounded-xl hover:-translate-y-0.5 transition-all flex items-center justify-center gap-2">
            <Trash2 className="w-4 h-4" /> Revisar e Excluir
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Main Page ─────────────────────────────────────────────────
export default function OrdersPage() {
  const { data: orders, isLoading } = useOrders();
  const { data: companies } = useCompanies();
  const { data: products } = useProducts();
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const canDeleteOrders = user && ['ADMIN', 'DIRECTOR', 'DEVELOPER'].includes((user as any).role);

  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("ALL");
  const [filterFiscal, setFilterFiscal] = useState("ALL");
  // FASE FIN.5 — filtro client-side por status financeiro (deriva de
  // `order.isPaid` exposto no FIN.2). 100% no frontend: nenhum endpoint
  // novo, nenhuma query nova, nenhuma mudança de cache.
  const [paymentFilter, setPaymentFilter] = useState<"all" | "paid" | "pending">("all");
  const [noteOrder, setNoteOrder] = useState<Order | null>(null);
  const [editOrder, setEditOrder] = useState<Order | null>(null);
  const [cancelOrder, setCancelOrder] = useState<Order | null>(null);
  const [showDeleteHistory, setShowDeleteHistory] = useState(false);
  const [showExport, setShowExport] = useState(false);

  const filtered = orders?.filter(o => {
    const company = companies?.find(c => c.id === o.companyId);
    const code = (o as any).orderCode || '';
    const matchSearch = !search ||
      company?.companyName.toLowerCase().includes(search.toLowerCase()) ||
      code.toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === 'ALL' || o.status === filterStatus;
    const matchFiscal = filterFiscal === 'ALL' ||
      (filterFiscal === 'nota_pendente' && !o.fiscalStatus) ||
      o.fiscalStatus === filterFiscal;
    // FASE FIN.5 — predicate aditivo de pagamento.
    // `isPaid` é exposto pelo backend (FIN.2) como boolean opcional;
    // pendente = qualquer coisa que não seja `true` (inclui ausência).
    const isPaid = (o as any).isPaid === true;
    const matchPayment =
      paymentFilter === 'all' ||
      (paymentFilter === 'paid' && isPaid) ||
      (paymentFilter === 'pending' && !isPaid);
    return matchSearch && matchStatus && matchFiscal && matchPayment;
  });

  // FASE FIN.5 — contadores informativos para os chips de pagamento.
  // Calculados sobre TODOS os pedidos retornados pelo backend (não respeitam
  // os outros filtros, intencionalmente — funcionam como contador absoluto
  // de carteira). Aditivo, sem refatorar nada.
  const paidCount = orders?.filter(o => (o as any).isPaid === true).length ?? 0;
  const pendingCount = (orders?.length ?? 0) - paidCount;
  const totalCount = orders?.length ?? 0;

  const patchOrder = async (id: number, updates: any) => {
    const res = await fetch(`/api/orders/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
      credentials: 'include',
    });
    if (!res.ok) throw new Error('Failed to update order');
    queryClient.invalidateQueries({ queryKey: [api.orders.list.path] });
  };

  const saveNote = async (note: string) => {
    await patchOrder(noteOrder!.id, { adminNote: note });
    toast({ title: "Observação salva com sucesso!" });
  };

  const cancelOrderFn = async () => {
    await patchOrder(cancelOrder!.id, { status: 'CANCELLED' });
    toast({ title: "Pedido cancelado.", variant: "destructive" });
  };

  const saveNimbi = async (id: number, date: string) => {
    await patchOrder(id, { nimbiExpiration: date || null });
    toast({ title: date ? "Data de exportação Bling salva!" : "Data de exportação Bling removida." });
  };

  const blingExport = async (order: Order) => {
    try {
      const res = await fetch(`/api/orders/${order.id}/bling-export`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: normalizeError(body).message || "Erro ao exportar para Bling", variant: "destructive" });
        return;
      }
      queryClient.invalidateQueries({ queryKey: [api.orders.list.path] });
      const ok = normalizeOne<{ erpId: string }>(body) ?? body;
      toast({ title: `Pedido exportado para Bling com sucesso! ID: ${ok.erpId}` });
    } catch (e: any) {
      toast({ title: e.message || "Erro ao exportar para Bling", variant: "destructive" });
    }
  };

  const restoreOrder = async (order: Order) => {
    await patchOrder(order.id, { status: 'ACTIVE' });
    toast({ title: "Pedido restaurado!" });
  };

  const approveReopen = async (order: Order) => {
    try {
      const res = await fetch(`/api/orders/${order.id}/approve-reopen`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(normalizeError(d).message); }
      queryClient.invalidateQueries({ queryKey: [api.orders.list.path] });
      toast({ title: "Reabertura aprovada! Pedido em edição pelo cliente." });
    } catch (e: any) { toast({ title: e.message || "Erro", variant: "destructive" }); }
  };

  const denyReopen = async (order: Order) => {
    try {
      const res = await fetch(`/api/orders/${order.id}/deny-reopen`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(normalizeError(d).message); }
      queryClient.invalidateQueries({ queryKey: [api.orders.list.path] });
      toast({ title: "Reabertura negada. Pedido confirmado." });
    } catch (e: any) { toast({ title: e.message || "Erro", variant: "destructive" }); }
  };

  const transitionOrder = async (order: Order, to: string, label: string) => {
    try {
      const res = await fetch(`/api/orders/${order.id}/transition`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(normalizeError(d).message);
      }
      queryClient.invalidateQueries({ queryKey: [api.orders.list.path] });
      toast({ title: `Pedido movido para: ${label}` });
    } catch (e: any) {
      // NF.7.9.7 — intercepta PERIODO_FECHADO antes do toast genérico.
      if (handleIfPeriodoFechado(e, toast)) return;
      toast({ title: e.message || "Erro ao atualizar etapa", variant: "destructive" });
    }
  };

  const saveItems = async (items: any[]) => {
    const res = await fetch(`/api/orders/${editOrder!.id}/items`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
      credentials: 'include',
    });
    if (!res.ok) throw new Error('Failed to update items');
    queryClient.invalidateQueries({ queryKey: [api.orders.list.path] });
    queryClient.invalidateQueries({ queryKey: [api.orders.get.path, editOrder!.id] });
    toast({ title: "Itens do pedido atualizados!" });
  };

  const counts = {
    all: orders?.length || 0,
    active: orders?.filter(o => !['CANCELLED'].includes(o.status)).length || 0,
    cancelled: orders?.filter(o => o.status === 'CANCELLED').length || 0,
    reopenRequested: orders?.filter(o => o.status === 'REOPEN_REQUESTED').length || 0,
  };

  return (
    <Layout>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Gestão de Pedidos</h1>
          <p className="text-muted-foreground mt-1">Altere, cancele e anote observações nos pedidos das empresas.</p>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <div className="px-3 py-1.5 bg-green-100 text-green-700 rounded-xl text-sm font-bold">{counts.active} ativos</div>
          {counts.reopenRequested > 0 && <div className="px-3 py-1.5 bg-orange-100 text-orange-700 rounded-xl text-sm font-bold">{counts.reopenRequested} solicitações</div>}
          {counts.cancelled > 0 && <div className="px-3 py-1.5 bg-red-100 text-red-700 rounded-xl text-sm font-bold">{counts.cancelled} cancelados</div>}
          <button type="button" onClick={() => setShowExport(true)}
            data-testid="button-export-orders"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-xl text-sm font-bold hover:bg-emerald-100 transition-colors">
            <FileSpreadsheet className="w-3.5 h-3.5" /> Exportar Pedidos
          </button>
          {canDeleteOrders && (
            <button type="button" onClick={() => setShowDeleteHistory(true)}
              data-testid="button-delete-history"
              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-600 border border-red-200 rounded-xl text-sm font-bold hover:bg-red-100 transition-colors">
              <Trash2 className="w-3.5 h-3.5" /> Excluir Histórico
            </button>
          )}
        </div>
      </div>

      {showExport && companies && (
        <ExportOrdersModal companies={companies} onClose={() => setShowExport(false)} />
      )}

      {showDeleteHistory && orders && companies && (
        <DeleteHistoryModal
          orders={orders}
          companies={companies}
          onClose={() => setShowDeleteHistory(false)}
          onDeleted={() => queryClient.invalidateQueries({ queryKey: [api.orders.list.path] })}
        />
      )}

      {/* ─── Dedicated Reopen Requests Panel ─────────────────────── */}
      {counts.reopenRequested > 0 && (() => {
        const pendingOrders = orders!.filter(o => o.status === 'REOPEN_REQUESTED');
        return (
          <div className="mb-6 bg-orange-50 border-2 border-orange-200 rounded-2xl overflow-hidden">
            <div className="p-4 border-b border-orange-200 bg-orange-100 flex items-center gap-3">
              <div className="w-9 h-9 bg-orange-500 rounded-xl flex items-center justify-center flex-shrink-0">
                <Bell className="w-4 h-4 text-white" />
              </div>
              <div className="flex-1">
                <h2 className="font-display font-bold text-orange-900 text-base">Solicitações de Alteração de Pedido</h2>
                <p className="text-xs text-orange-700 mt-0.5">
                  {counts.reopenRequested} solicitação{counts.reopenRequested !== 1 ? 'ões' : ''} aguardando análise
                </p>
              </div>
            </div>
            <div className="divide-y divide-orange-100">
              {pendingOrders.map(order => {
                const company = companies?.find((c: any) => c.id === order.companyId);
                return (
                  <div key={order.id} className="p-4 hover:bg-orange-100/50 transition-colors">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                      {/* Info */}
                      <div className="flex-1 min-w-0 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono font-bold text-sm text-orange-900">{order.orderCode || `#${order.id}`}</span>
                          <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-orange-200 text-orange-800">Solicitação de Alteração</span>
                        </div>
                        <div className="flex flex-wrap gap-3 text-xs text-orange-700 font-medium">
                          <span className="flex items-center gap-1">
                            <Building2 className="w-3.5 h-3.5" />
                            {company?.companyName || `Empresa #${order.companyId}`}
                          </span>
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3.5 h-3.5" />
                            Entrega: {order.deliveryDate ? format(new Date(order.deliveryDate), "dd/MM/yyyy", { locale: ptBR }) : '—'}
                          </span>
                          {order.reopenRequestedAt && (
                            <span className="flex items-center gap-1">
                              <ClipboardEdit className="w-3.5 h-3.5" />
                              Solicitado em: {format(new Date(order.reopenRequestedAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                            </span>
                          )}
                        </div>
                        {order.reopenReason && (
                          <div className="flex items-start gap-1.5 p-2 bg-orange-200/60 rounded-lg">
                            <MessageSquare className="w-3.5 h-3.5 text-orange-700 mt-0.5 flex-shrink-0" />
                            <p className="text-xs text-orange-900 font-medium">"{order.reopenReason}"</p>
                          </div>
                        )}
                      </div>
                      {/* Actions */}
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                          data-testid={`button-approve-panel-${order.id}`}
                          onClick={() => approveReopen(order)}
                          className="px-4 py-2 bg-green-500 text-white text-xs font-bold rounded-xl hover:bg-green-600 transition-colors flex items-center gap-1.5 shadow-sm">
                          <ThumbsUp className="w-3.5 h-3.5" /> Aprovar reabertura
                        </button>
                        <button
                          data-testid={`button-deny-panel-${order.id}`}
                          onClick={() => denyReopen(order)}
                          className="px-4 py-2 bg-red-500 text-white text-xs font-bold rounded-xl hover:bg-red-600 transition-colors flex items-center gap-1.5 shadow-sm">
                          <ThumbsDown className="w-3.5 h-3.5" /> Negar solicitação
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      <div className="bg-card rounded-2xl border border-border/50 premium-shadow overflow-hidden">
        {/* Toolbar */}
        <div className="p-4 border-b border-border/50 flex flex-wrap gap-3 bg-muted/20">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              data-testid="input-search-orders"
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Buscar empresa ou código VF-..."
              className="w-full pl-9 pr-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none text-sm"
            />
          </div>
          <div className="flex gap-2 flex-wrap items-center">
            {(['ALL', 'ACTIVE', 'CONFIRMED', 'REOPEN_REQUESTED', 'OPEN_FOR_EDITING', 'CANCELLED'] as const).map(s => (
              <button key={s}
                onClick={() => setFilterStatus(s)}
                className={`px-3 py-2 rounded-xl text-xs font-bold border-2 transition-all ${
                  filterStatus === s
                    ? 'bg-primary text-white border-primary'
                    : 'border-border text-muted-foreground hover:border-primary/50'
                }`}>
                {s === 'ALL' ? 'Todos' : STATUS_LABEL[s] || s}
              </button>
            ))}
            <div className="w-px h-6 bg-border mx-1" />
            <Tag className="w-4 h-4 text-violet-500 flex-shrink-0" />
            <select
              data-testid="select-filter-fiscal"
              value={filterFiscal}
              onChange={e => setFilterFiscal(e.target.value)}
              className="px-3 py-2 rounded-xl text-xs font-bold border-2 border-border text-muted-foreground focus:border-violet-400 outline-none bg-white"
            >
              <option value="ALL">Fiscal: Todos</option>
              {Object.entries(FISCAL_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            {/* FASE FIN.5 — chips de filtro por status financeiro.
                Reutilizam o mesmo padrão visual dos chips de `filterStatus`
                logo acima (px-3 py-2 rounded-xl text-xs font-bold border-2),
                com cor verde quando ativos para reforçar a semântica
                financeira. Filtragem 100% client-side sobre `order.isPaid`
                (FIN.2). Os contadores são absolutos (toda a carteira). */}
            <div className="w-px h-6 bg-border mx-1" />
            {([
              { key: 'all',     label: 'Todos',     count: totalCount   },
              { key: 'paid',    label: 'Pagos',     count: paidCount    },
              { key: 'pending', label: 'Pendentes', count: pendingCount },
            ] as const).map(opt => {
              const active = paymentFilter === opt.key;
              const activeColor =
                opt.key === 'paid'    ? 'bg-green-600 text-white border-green-600' :
                opt.key === 'pending' ? 'bg-amber-500 text-white border-amber-500' :
                                        'bg-primary text-white border-primary';
              return (
                <button
                  key={opt.key}
                  onClick={() => setPaymentFilter(opt.key)}
                  data-testid={`chip-payment-${opt.key}`}
                  className={`px-3 py-2 rounded-xl text-xs font-bold border-2 transition-all ${
                    active
                      ? activeColor
                      : 'border-border text-muted-foreground hover:border-primary/50'
                  }`}
                >
                  {opt.label} ({opt.count})
                </button>
              );
            })}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-muted/30 border-b border-border/50 text-muted-foreground text-xs uppercase tracking-wider">
                <th className="px-5 py-4 font-semibold">Código</th>
                <th className="px-5 py-4 font-semibold">Empresa</th>
                <th className="px-5 py-4 font-semibold">Data</th>
                <th className="px-5 py-4 font-semibold">Entrega</th>
                <th className="px-5 py-4 font-semibold">Obs. Cliente</th>
                <th className="px-5 py-4 font-semibold">Obs. Admin</th>
                <th className="px-5 py-4 font-semibold">Total</th>
                <th className="px-5 py-4 font-semibold">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {isLoading ? (
                <tr><td colSpan={8} className="px-5 py-8 text-center text-muted-foreground">Carregando pedidos...</td></tr>
              ) : filtered?.length === 0 ? (
                <tr><td colSpan={8} className="px-5 py-8 text-center text-muted-foreground">Nenhum pedido encontrado</td></tr>
              ) : (
                filtered?.map(order => {
                  const company = companies?.find(c => c.id === order.companyId);
                  return (
                    <OrderRow
                      key={order.id}
                      order={order}
                      company={company || null}
                      companyName={company?.companyName || 'Desconhecido'}
                      products={products || []}
                      onNoteEdit={setNoteOrder}
                      onEdit={setEditOrder}
                      onCancel={setCancelOrder}
                      onRestore={restoreOrder}
                      onPatchNimbi={saveNimbi}
                      onApproveReopen={approveReopen}
                      onDenyReopen={denyReopen}
                      onBlingExport={blingExport}
                      onTransition={transitionOrder}
                    />
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modals */}
      {noteOrder && <AdminNoteModal order={noteOrder} onClose={() => setNoteOrder(null)} onSave={saveNote} />}
      {editOrder && <EditItemsModal order={editOrder} products={products || []} onClose={() => setEditOrder(null)} onSave={saveItems} />}
      {cancelOrder && <CancelModal order={cancelOrder} onClose={() => setCancelOrder(null)} onConfirm={cancelOrderFn} />}
    </Layout>
  );
}
