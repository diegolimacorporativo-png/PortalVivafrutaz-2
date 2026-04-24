import { useState, useMemo } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useCompanyOrders, useOrderDetail } from "@/hooks/use-ordering";
import { useProducts } from "@/hooks/use-catalog";
import { Layout } from "@/components/Layout";
import { Modal } from "@/components/Modal";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { format, getYear, subDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Receipt, Calendar, Plus, Filter, X, Clock, Lock, Unlock,
  ClipboardEdit, Pencil, AlertCircle, Search, Info, Eye,
  Package, ChevronRight, ShoppingCart, FileText
} from "lucide-react";
import { Link } from "wouter";
import { api } from "@shared/routes";

const SIXTY_DAYS_AGO = subDays(new Date(), 60);

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  ACTIVE: { label: "Ativo", color: "bg-green-100 text-green-700" },
  CONFIRMED: { label: "Pedido Confirmado", color: "bg-blue-100 text-blue-700" },
  REOPEN_REQUESTED: { label: "Solicitação de Alteração", color: "bg-orange-100 text-orange-700" },
  OPEN_FOR_EDITING: { label: "Em Edição", color: "bg-yellow-100 text-yellow-700" },
  CANCELLED: { label: "Cancelado", color: "bg-red-100 text-red-700" },
  DELIVERED: { label: "Entregue", color: "bg-purple-100 text-purple-700" },
  PENDING: { label: "Pendente", color: "bg-yellow-100 text-yellow-700" },
};

const MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
];

const REOPEN_REASON_EXAMPLES = [
  "Adicionar produto", "Remover item", "Corrigir quantidade",
  "Trocar produto", "Outro motivo",
];

function fmtBRL(n: number) {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function CompanyMissing() {
  return (
    <Layout>
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="w-16 h-16 rounded-2xl bg-orange-100 flex items-center justify-center mb-4 mx-auto text-3xl">⚠️</div>
        <h2 className="text-xl font-bold text-foreground mb-2">Dados da empresa não encontrados.</h2>
        <p className="text-muted-foreground text-sm max-w-sm">Entre em contato com a equipe VivaFrutaz.</p>
      </div>
    </Layout>
  );
}

/* ── Order Detail Modal ─────────────────────────────────────── */
function OrderDetailModal({ order, onClose, onReopen }: {
  order: any;
  onClose: () => void;
  onReopen: () => void;
}) {
  const { data: detail, isLoading } = useOrderDetail(order.id);
  const { data: allProducts } = useProducts();

  const items = useMemo(() => {
    if (!detail?.items) return [];
    return detail.items.map((item: any) => {
      const product = allProducts?.find(p => p.id === item.productId);
      return {
        ...item,
        productName: product?.name || `Produto #${item.productId}`,
        unit: product?.unit || 'un',
      };
    });
  }, [detail, allProducts]);

  const status = STATUS_LABELS[order.status] || { label: order.status, color: 'bg-muted text-muted-foreground' };
  const canRequestReopen = ['CONFIRMED', 'ACTIVE'].includes(order.status);
  const isOpenForEditing = order.status === 'OPEN_FOR_EDITING';

  return (
    <Modal isOpen onClose={onClose} title="Detalhes do Pedido" maxWidth="max-w-2xl">
      <div className="space-y-5">
        {/* Header summary */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="p-4 rounded-xl bg-primary/5 border border-primary/15 space-y-2">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Código</p>
            <p className="font-mono font-bold text-xl text-primary">{order.orderCode || `#${order.id}`}</p>
            <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-bold ${status.color}`}>
              {status.label}
            </span>
          </div>
          <div className="p-4 rounded-xl bg-muted/40 border border-border/50 space-y-1.5 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Calendar className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="font-semibold">Pedido realizado:</span>
              <span>{format(new Date(order.orderDate), "d 'de' MMM yyyy", { locale: ptBR })}</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Clock className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="font-semibold">Entrega:</span>
              <span className="capitalize">{format(new Date(order.deliveryDate), "EEEE, d 'de' MMM", { locale: ptBR })}</span>
            </div>
            {order.weekReference && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <FileText className="w-3.5 h-3.5 flex-shrink-0" />
                <span>{order.weekReference}</span>
              </div>
            )}
          </div>
        </div>

        {/* Admin note */}
        {order.adminNote && (
          <div className="p-3.5 bg-blue-50 rounded-xl border border-blue-200 flex items-start gap-2">
            <Info className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-bold text-blue-700 uppercase tracking-wider mb-0.5">Nota da VivaFrutaz</p>
              <p className="text-sm text-blue-700">{order.adminNote}</p>
            </div>
          </div>
        )}

        {/* Reopen requested notice */}
        {order.status === 'REOPEN_REQUESTED' && order.reopenReason && (
          <div className="p-3.5 bg-orange-50 rounded-xl border border-orange-200 flex items-start gap-2">
            <ClipboardEdit className="w-4 h-4 text-orange-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-bold text-orange-700 uppercase tracking-wider mb-0.5">Solicitação pendente de análise</p>
              <p className="text-sm text-orange-700">{order.reopenReason}</p>
            </div>
          </div>
        )}

        {/* Items table */}
        <div>
          <h3 className="text-sm font-bold text-foreground mb-3 flex items-center gap-2">
            <ShoppingCart className="w-4 h-4 text-primary" />
            Itens do Pedido
          </h3>

          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground text-sm">Carregando itens...</div>
          ) : items.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-sm">
              <Package className="w-8 h-8 mx-auto mb-2 opacity-40" />
              Nenhum item encontrado.
            </div>
          ) : (
            <div className="rounded-xl border border-border/50 overflow-hidden">
              {/* Table header */}
              <div className="bg-muted/40 px-4 py-2.5 grid grid-cols-12 gap-2 text-xs font-bold text-muted-foreground uppercase tracking-wider border-b border-border/50">
                <div className="col-span-5">Produto</div>
                <div className="col-span-2 text-center">Qtd</div>
                <div className="col-span-2 text-right">Unitário</div>
                <div className="col-span-3 text-right">Subtotal</div>
              </div>
              {/* Table rows */}
              <div className="divide-y divide-border/40">
                {items.map((item: any, idx: number) => (
                  <div key={idx} className="px-4 py-3 grid grid-cols-12 gap-2 items-center hover:bg-muted/10 transition-colors">
                    <div className="col-span-5 flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <Package className="w-4 h-4 text-primary" />
                      </div>
                      <div>
                        <p className="font-semibold text-sm text-foreground leading-tight">{item.productName}</p>
                        <p className="text-xs text-muted-foreground">{item.unit}</p>
                      </div>
                    </div>
                    <div className="col-span-2 text-center">
                      <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-muted font-bold text-sm text-foreground">
                        {item.quantity}
                      </span>
                    </div>
                    <div className="col-span-2 text-right">
                      <span className="text-sm font-semibold text-foreground">R$ {fmtBRL(Number(item.unitPrice))}</span>
                    </div>
                    <div className="col-span-3 text-right">
                      <span className="text-sm font-bold text-primary">R$ {fmtBRL(Number(item.totalPrice))}</span>
                    </div>
                  </div>
                ))}
              </div>
              {/* Total row */}
              <div className="px-4 py-3.5 bg-primary/5 border-t-2 border-primary/20 flex justify-between items-center">
                <span className="font-bold text-sm text-foreground uppercase tracking-wide">Total do Pedido</span>
                <span className="text-xl font-display font-bold text-primary">R$ {fmtBRL(Number(order.totalValue))}</span>
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-3 pt-1 border-t border-border/50">
          <button onClick={onClose}
            className="flex-1 py-2.5 border-2 border-border rounded-xl font-bold text-muted-foreground hover:bg-muted transition-colors text-sm">
            Fechar
          </button>

          {isOpenForEditing && (
            <Link href={`/client/order/edit/${order.id}`}
              data-testid={`button-edit-order-detail-${order.id}`}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-yellow-500 text-white font-bold rounded-xl hover:bg-yellow-600 transition-colors text-sm">
              <Pencil className="w-4 h-4" /> Editar Pedido
            </Link>
          )}

          {canRequestReopen && (
            <button onClick={() => { onClose(); onReopen(); }}
              data-testid={`button-reopen-from-detail-${order.id}`}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-orange-100 text-orange-700 border-2 border-orange-200 font-bold rounded-xl hover:bg-orange-200 transition-colors text-sm">
              <ClipboardEdit className="w-4 h-4" /> Solicitar Alteração
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

/* ── Reopen request modal ───────────────────────────────────── */
function ReopenRequestModal({ order, onClose, onSuccess }: {
  order: any;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async () => {
    if (!reason.trim() || reason.trim().length < 3) {
      toast({ title: "Informe o motivo da alteração.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/orders/${order.id}/request-reopen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
        credentials: 'include',
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.message || 'Erro ao enviar solicitação.');
      }
      toast({ title: "Solicitação enviada! Aguarde análise do time VivaFrutaz." });
      onSuccess();
    } catch (e: any) {
      toast({ title: e.message || "Erro", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="Solicitar Alteração do Pedido" maxWidth="max-w-lg">
      <div className="space-y-4">
        <div className="p-3 bg-primary/5 rounded-xl border border-primary/20">
          <p className="text-sm font-bold text-primary">{order.orderCode || `#${order.id}`}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Entrega: {format(new Date(order.deliveryDate), "EEEE, d 'de' MMM", { locale: ptBR })}</p>
        </div>
        <div>
          <label className="block text-sm font-semibold mb-1.5">Motivo da alteração *</label>
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            rows={4}
            placeholder="Descreva o que precisa ser alterado no pedido..."
            data-testid="input-reopen-reason"
            className="w-full px-4 py-3 rounded-xl border-2 border-border focus:border-primary outline-none resize-none text-sm"
          />
          <div className="flex flex-wrap gap-2 mt-2">
            {REOPEN_REASON_EXAMPLES.map(ex => (
              <button key={ex} type="button" onClick={() => setReason(ex)}
                className="text-xs px-2.5 py-1 rounded-lg bg-muted hover:bg-muted/80 border border-border text-muted-foreground transition-colors">
                {ex}
              </button>
            ))}
          </div>
        </div>
        <div className="p-3 bg-yellow-50 rounded-xl border border-yellow-200 text-xs text-yellow-800 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <p>Sua solicitação será analisada pela equipe VivaFrutaz. O pedido só poderá ser editado após aprovação.</p>
        </div>
        <div className="flex gap-3">
          <button onClick={onClose}
            className="flex-1 py-3 border-2 border-border rounded-xl font-bold text-muted-foreground hover:bg-muted transition-colors">
            Cancelar
          </button>
          <button onClick={handleSubmit} disabled={submitting || reason.trim().length < 3}
            data-testid="button-submit-reopen"
            className="flex-1 py-3 bg-primary text-white font-bold rounded-xl hover:-translate-y-0.5 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
            <ClipboardEdit className="w-4 h-4" />
            {submitting ? "Enviando..." : "Enviar Solicitação"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ── Main history page ──────────────────────────────────────── */
export default function OrderHistoryPage() {
  const { company, isLoading: authLoading } = useAuth();
  const { data: orders, isLoading } = useCompanyOrders(company?.id);
  const queryClient = useQueryClient();

  const today = new Date();
  const [filterMonth, setFilterMonth] = useState<string>("");
  const [filterYear, setFilterYear] = useState<string>("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [filterCode, setFilterCode] = useState("");
  const [viewOrder, setViewOrder] = useState<any | null>(null);
  const [reopenOrder, setReopenOrder] = useState<any | null>(null);

  const years = useMemo(() => {
    const yrs = new Set<number>();
    orders?.forEach(o => yrs.add(getYear(new Date(o.orderDate))));
    if (yrs.size === 0) yrs.add(today.getFullYear());
    return Array.from(yrs).sort((a, b) => b - a);
  }, [orders]);

  const hasDateFilter = filterDateFrom || filterDateTo || filterYear || filterMonth;

  const filtered = useMemo(() => {
    const sorted = [...(orders || [])].sort((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime());
    return sorted.filter(o => {
      const d = new Date(o.orderDate);
      if (!hasDateFilter && d < SIXTY_DAYS_AGO) return false;
      if (filterYear && getYear(d) !== Number(filterYear)) return false;
      if (filterMonth && d.getMonth() !== Number(filterMonth)) return false;
      if (filterDateFrom && d < new Date(filterDateFrom)) return false;
      if (filterDateTo && d > new Date(filterDateTo + 'T23:59:59')) return false;
      if (filterStatus && o.status !== filterStatus) return false;
      if (filterCode && !(o.orderCode || '').toLowerCase().includes(filterCode.toLowerCase())) return false;
      return true;
    });
  }, [orders, filterYear, filterMonth, filterDateFrom, filterDateTo, filterStatus, filterCode, hasDateFilter]);

  const clearFilters = () => {
    setFilterMonth(""); setFilterYear(""); setFilterDateFrom(""); setFilterDateTo("");
    setFilterStatus(""); setFilterCode("");
  };
  const hasFilters = filterMonth || filterYear || filterDateFrom || filterDateTo || filterStatus || filterCode;

  if (!authLoading && !company) return <CompanyMissing />;

  const canRequestReopen = (status: string) => ['CONFIRMED', 'ACTIVE'].includes(status);
  const isLocked = (status: string) => ['CONFIRMED', 'ACTIVE', 'REOPEN_REQUESTED'].includes(status);

  return (
    <Layout>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Meus Pedidos</h1>
          <p className="text-muted-foreground mt-1">Histórico completo de entregas e pedidos.</p>
        </div>
        {company?.clientType !== 'contratual' && (
          <Link href="/client/order" className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground font-bold rounded-xl hover:bg-primary/90 transition-colors shadow-lg shadow-primary/25">
            <Plus className="w-4 h-4" /> Novo Pedido
          </Link>
        )}
        {company?.clientType === 'contratual' && (
          <Link href="/client/contract-scope" className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground font-bold rounded-xl hover:bg-primary/90 transition-colors shadow-lg shadow-primary/25">
            <FileText className="w-4 h-4" /> Meu Escopo Contratual
          </Link>
        )}
      </div>

      {/* Filters */}
      <div className="bg-card rounded-2xl border border-border/50 premium-shadow p-4 mb-4 space-y-3">
        <div className="flex flex-wrap gap-3 items-center">
          <Filter className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <div className="relative flex-1 min-w-[160px] max-w-[220px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              data-testid="input-filter-code"
              type="text" value={filterCode} onChange={e => setFilterCode(e.target.value)}
              placeholder="Nº do pedido (VF-...)"
              className="w-full pl-8 pr-3 py-2 rounded-xl border-2 border-border text-sm focus:border-primary outline-none" />
          </div>
          <select
            data-testid="select-filter-status"
            value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
            className="px-3 py-2 rounded-xl border-2 border-border text-sm focus:border-primary outline-none">
            <option value="">Todos os status</option>
            <option value="CONFIRMED">Pedido Confirmado</option>
            <option value="ACTIVE">Ativo</option>
            <option value="REOPEN_REQUESTED">Solicitação de Alteração</option>
            <option value="OPEN_FOR_EDITING">Em Edição</option>
            <option value="DELIVERED">Entregue</option>
            <option value="CANCELLED">Cancelado</option>
          </select>
          <select value={filterYear} onChange={e => setFilterYear(e.target.value)}
            className="px-3 py-2 rounded-xl border-2 border-border text-sm focus:border-primary outline-none">
            <option value="">Todos os anos</option>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)}
            className="px-3 py-2 rounded-xl border-2 border-border text-sm focus:border-primary outline-none">
            <option value="">Todos os meses</option>
            {MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}
          </select>
          <div className="flex items-center gap-2 flex-wrap">
            <Calendar className="w-4 h-4 text-muted-foreground" />
            <input type="date" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)}
              className="px-3 py-2 rounded-xl border-2 border-border text-sm focus:border-primary outline-none" />
            <span className="text-muted-foreground text-sm">até</span>
            <input type="date" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)}
              className="px-3 py-2 rounded-xl border-2 border-border text-sm focus:border-primary outline-none" />
          </div>
          <div className="flex items-center gap-3 ml-auto">
            {hasFilters && (
              <button onClick={clearFilters} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground font-medium">
                <X className="w-3 h-3" /> Limpar
              </button>
            )}
            <span className="text-xs text-muted-foreground font-medium">
              {filtered.length} pedido{filtered.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
        {!hasDateFilter && (
          <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 rounded-xl border border-blue-100">
            <Info className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
            <p className="text-xs text-blue-700">Exibindo pedidos dos últimos 60 dias. Use o filtro de datas para ver pedidos mais antigos.</p>
          </div>
        )}
      </div>

      {/* Order cards */}
      <div className="grid gap-5">
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground">Carregando histórico...</div>
        ) : orders?.length === 0 ? (
          <div className="bg-card rounded-2xl p-12 text-center border border-border/50">
            <Receipt className="w-16 h-16 text-muted-foreground/30 mx-auto mb-4" />
            <h3 className="text-xl font-bold text-foreground">Nenhum Pedido</h3>
            <p className="text-muted-foreground mt-2">Você ainda não realizou nenhum pedido.</p>
            <Link href="/client/order" className="inline-flex items-center gap-2 mt-6 px-6 py-3 bg-primary text-primary-foreground font-bold rounded-xl hover:bg-primary/90 transition-colors">
              Fazer Primeiro Pedido
            </Link>
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-card rounded-2xl p-8 text-center border border-border/50">
            <p className="text-muted-foreground">Nenhum pedido no período selecionado.</p>
            <button onClick={clearFilters} className="text-primary font-bold text-sm hover:underline mt-2">Limpar filtros</button>
          </div>
        ) : (
          filtered.map(order => {
            const status = STATUS_LABELS[order.status] || { label: order.status, color: 'bg-muted text-muted-foreground' };
            return (
              <div key={order.id} data-testid={`order-card-${order.id}`}
                className="bg-card rounded-2xl border border-border/50 premium-shadow p-6 hover:border-primary/30 transition-colors">
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                  {/* Left side */}
                  <div className="flex items-start gap-4 flex-1 min-w-0">
                    <div className="w-14 h-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center font-mono font-bold text-base flex-shrink-0">
                      <Receipt className="w-6 h-6" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center flex-wrap gap-2 mb-1">
                        <h3 className="text-lg font-bold text-foreground font-mono">{order.orderCode || `#${String(order.id).padStart(4, '0')}`}</h3>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${status.color}`}>{status.label}</span>
                        {isLocked(order.status) && <Lock className="w-3.5 h-3.5 text-muted-foreground" />}
                        {order.status === 'OPEN_FOR_EDITING' && <Unlock className="w-3.5 h-3.5 text-yellow-600" />}
                      </div>
                      <p className="text-sm font-semibold text-muted-foreground">{order.weekReference}</p>
                      <div className="flex flex-wrap items-center gap-3 text-sm font-medium text-muted-foreground mt-1">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5" />
                          Pedido: {format(new Date(order.orderDate), "d 'de' MMM yyyy", { locale: ptBR })}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5" />
                          Entrega: {format(new Date(order.deliveryDate), "EEEE, d 'de' MMM", { locale: ptBR })}
                        </span>
                      </div>
                      {order.adminNote && (
                        <p className="text-xs text-blue-600 mt-1 font-medium italic">📋 {order.adminNote}</p>
                      )}
                      {order.status === 'REOPEN_REQUESTED' && order.reopenReason && (
                        <div className="mt-2 p-2.5 bg-orange-50 rounded-xl border border-orange-200 flex items-start gap-2">
                          <ClipboardEdit className="w-3.5 h-3.5 text-orange-500 mt-0.5 flex-shrink-0" />
                          <div>
                            <p className="text-xs font-bold text-orange-700">Solicitação pendente de análise</p>
                            <p className="text-xs text-orange-600 mt-0.5">{order.reopenReason}</p>
                          </div>
                        </div>
                      )}
                      {order.status === 'OPEN_FOR_EDITING' && (
                        <div className="mt-2 p-2.5 bg-yellow-50 rounded-xl border border-yellow-200 flex items-center gap-2">
                          <Unlock className="w-3.5 h-3.5 text-yellow-600 flex-shrink-0" />
                          <p className="text-xs font-bold text-yellow-700">Pedido aprovado para edição</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right side — total + actions */}
                  <div className="flex items-center gap-4 flex-shrink-0">
                    <div className="text-right">
                      <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Total</p>
                      <p className="text-2xl font-display font-bold text-primary">R$ {Number(order.totalValue).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                    </div>

                    <div className="flex flex-col gap-2">
                      {/* View detail button — always available */}
                      <button
                        data-testid={`button-view-order-${order.id}`}
                        onClick={() => setViewOrder(order)}
                        className="flex items-center gap-1.5 px-4 py-2 bg-primary/10 text-primary border border-primary/20 rounded-xl hover:bg-primary/20 transition-colors font-bold text-sm">
                        <Eye className="w-3.5 h-3.5" /> Visualizar
                      </button>

                      {/* Edit button — only when OPEN_FOR_EDITING */}
                      {order.status === 'OPEN_FOR_EDITING' && (
                        <Link href={`/client/order/edit/${order.id}`}
                          data-testid={`button-edit-order-${order.id}`}
                          className="flex items-center gap-1.5 px-4 py-2 bg-yellow-500 text-white rounded-xl hover:bg-yellow-600 transition-colors font-bold text-sm">
                          <Pencil className="w-3.5 h-3.5" /> Editar
                        </Link>
                      )}

                      {/* Reopen request */}
                      {canRequestReopen(order.status) && (
                        <button
                          data-testid={`button-reopen-${order.id}`}
                          onClick={() => setReopenOrder(order)}
                          className="flex items-center gap-1.5 px-4 py-2 bg-orange-100 text-orange-700 border border-orange-200 rounded-xl hover:bg-orange-200 transition-colors font-bold text-sm">
                          <ClipboardEdit className="w-3.5 h-3.5" /> Solicitar alteração
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Order detail modal */}
      {viewOrder && (
        <OrderDetailModal
          order={viewOrder}
          onClose={() => setViewOrder(null)}
          onReopen={() => setReopenOrder(viewOrder)}
        />
      )}

      {/* Reopen modal */}
      {reopenOrder && (
        <ReopenRequestModal
          order={reopenOrder}
          onClose={() => setReopenOrder(null)}
          onSuccess={() => {
            setReopenOrder(null);
            queryClient.invalidateQueries({ queryKey: [api.orders.companyOrders.path] });
          }}
        />
      )}
    </Layout>
  );
}
