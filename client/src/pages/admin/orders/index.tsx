import { useState, useMemo, useEffect, useCallback } from "react";
import { useOrders, useOrdersPaginated } from "@/hooks/use-ordering";
import { PaginationBar } from "@/components/ui/PaginationBar";
import { useCompanies } from "@/hooks/use-admin";
import { useProducts } from "@/hooks/use-catalog";
import { useQueryClient } from "@tanstack/react-query";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { normalizeError } from "@/lib/normalizeResponse";
import { Layout } from "@/components/Layout";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { api } from "@shared/routes";
import { handleIfPeriodoFechado } from "@/lib/periodo-fechado";
import {
  Search, FileSpreadsheet, Trash2, Bell, Building2, Calendar,
  MessageSquare, ClipboardEdit, ThumbsUp, ThumbsDown,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

import { STATUS_LABEL } from "./constants";
import { OrderRow } from "./components/OrderRow";
import { AdminNoteModal } from "./dialogs/AdminNoteModal";
import { EditItemsModal } from "./dialogs/EditItemsModal";
import { CancelModal } from "./dialogs/CancelModal";
import { ExportOrdersModal } from "./dialogs/ExportOrdersModal";
import { DeleteHistoryModal } from "./dialogs/DeleteHistoryModal";
import type { Order } from "./types";
import { BackHeader } from "@/components/navigation/BackHeader";

export default function OrdersPage() {
  const { data: orders, isLoading: isAllOrdersLoading } = useOrders();
  const { data: companies } = useCompanies();
  const { data: products } = useProducts();
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const canDeleteOrders = user && ['ADMIN', 'DIRECTOR', 'DEVELOPER'].includes((user as any).role);

  // ── Filter state ──────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("ALL");
  const [paymentFilter, setPaymentFilter] = useState<"all" | "paid" | "pending">("all");

  // ── Dialog state ──────────────────────────────────────────────
  const [noteOrder, setNoteOrder] = useState<Order | null>(null);
  const [editOrder, setEditOrder] = useState<Order | null>(null);
  const [cancelOrder, setCancelOrder] = useState<Order | null>(null);
  const [showDeleteHistory, setShowDeleteHistory] = useState(false);
  const [showExport, setShowExport] = useState(false);

  // ── Pagination ────────────────────────────────────────────────
  const [page, setPage] = useState(1);
  const limit = 25;
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => { setPage(1); }, [filterStatus]);

  const { data: pagedOrders, isLoading } = useOrdersPaginated({
    page, limit, search: debouncedSearch, status: filterStatus,
  });

  // ── Client-side payment filter (isPaid already in paginated payload) ──
  const filtered = useMemo(() => {
    const rows = pagedOrders?.data ?? [];
    if (paymentFilter === 'all') return rows;
    return rows.filter(o => {
      const isPaid = (o as any).isPaid === true;
      return paymentFilter === 'paid' ? isPaid : !isPaid;
    });
  }, [pagedOrders, paymentFilter]);

  const paidCount = useMemo(() => orders?.filter(o => (o as any).isPaid === true).length ?? 0, [orders]);
  const pendingCount = useMemo(() => (orders?.length ?? 0) - paidCount, [orders, paidCount]);
  const totalCount = orders?.length ?? 0;

  const counts = {
    all: orders?.length || 0,
    active: orders?.filter(o => !['CANCELLED'].includes(o.status)).length || 0,
    cancelled: orders?.filter(o => o.status === 'CANCELLED').length || 0,
    reopenRequested: orders?.filter(o => o.status === 'REOPEN_REQUESTED').length || 0,
  };

  // ── Actions ───────────────────────────────────────────────────
  const patchOrder = async (id: number, updates: any) => {
    const res = await fetchWithAuth(`/api/orders/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!res.ok) throw new Error('Failed to update order');
    queryClient.invalidateQueries({ queryKey: [api.orders.list.path] });
  };

  const saveNote = async (note: string) => {
    if (!noteOrder) return;
    await patchOrder(noteOrder.id, { adminNote: note });
    toast({ title: "Observação salva com sucesso!" });
  };

  const cancelOrderFn = async () => {
    if (!cancelOrder) return;
    await patchOrder(cancelOrder.id, { status: 'CANCELLED' });
    toast({ title: "Pedido cancelado.", variant: "destructive" });
  };

  const restoreOrder = useCallback(async (order: Order) => {
    await patchOrder(order.id, { status: 'ACTIVE' });
    toast({ title: "Pedido restaurado!" });
  }, []);

  const approveReopen = useCallback(async (order: Order) => {
    try {
      const res = await fetchWithAuth(`/api/orders/${order.id}/approve-reopen`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(normalizeError(d).message); }
      queryClient.invalidateQueries({ queryKey: [api.orders.list.path] });
      toast({ title: "Reabertura aprovada! Pedido em edição pelo cliente." });
    } catch (e: any) { toast({ title: e.message || "Erro", variant: "destructive" }); }
  }, [toast, queryClient]);

  const denyReopen = useCallback(async (order: Order) => {
    try {
      const res = await fetchWithAuth(`/api/orders/${order.id}/deny-reopen`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(normalizeError(d).message); }
      queryClient.invalidateQueries({ queryKey: [api.orders.list.path] });
      toast({ title: "Reabertura negada. Pedido confirmado." });
    } catch (e: any) { toast({ title: e.message || "Erro", variant: "destructive" }); }
  }, [toast, queryClient]);

  const transitionOrder = useCallback(async (order: Order, to: string, label: string) => {
    try {
      const res = await fetchWithAuth(`/api/orders/${order.id}/transition`, {
        method: 'POST',
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
      if (handleIfPeriodoFechado(e, toast)) return;
      toast({ title: e.message || "Erro ao atualizar etapa", variant: "destructive" });
    }
  }, [toast, queryClient]);

  const saveItems = async (items: any[]) => {
    if (!editOrder) return;
    const res = await fetchWithAuth(`/api/orders/${editOrder.id}/items`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });
    if (!res.ok) throw new Error('Failed to update items');
    queryClient.invalidateQueries({ queryKey: [api.orders.list.path] });
    queryClient.invalidateQueries({ queryKey: [api.orders.get.path, editOrder.id] });
    toast({ title: "Itens do pedido atualizados!" });
  };

  return (
    <Layout>
      <BackHeader
        fallback="/admin"
        breadcrumb={[{ label: "Painel", href: "/admin" }, { label: "Gestão de Pedidos" }]}
      />
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Gestão de Pedidos</h1>
          <p className="text-muted-foreground mt-1">Altere, cancele e anote observações nos pedidos das empresas.</p>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <div className="px-3 py-1.5 bg-green-100 text-green-700 rounded-xl text-sm font-bold">{counts.active} ativos</div>
          {counts.reopenRequested > 0 && <div className="px-3 py-1.5 bg-orange-100 text-orange-700 rounded-xl text-sm font-bold">{counts.reopenRequested} solicitações</div>}
          {counts.cancelled > 0 && <div className="px-3 py-1.5 bg-red-100 text-red-700 rounded-xl text-sm font-bold">{counts.cancelled} cancelados</div>}
          <button type="button" onClick={() => setShowExport(true)} data-testid="button-export-orders"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-xl text-sm font-bold hover:bg-emerald-100 transition-colors">
            <FileSpreadsheet className="w-3.5 h-3.5" /> Exportar Pedidos
          </button>
          {canDeleteOrders && (
            <button type="button" onClick={() => setShowDeleteHistory(true)} data-testid="button-delete-history"
              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-600 border border-red-200 rounded-xl text-sm font-bold hover:bg-red-100 transition-colors">
              <Trash2 className="w-3.5 h-3.5" /> Excluir Histórico
            </button>
          )}
        </div>
      </div>

      {/* ── Modals ── */}
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

      {/* ── Reopen Requests Panel ── */}
      {counts.reopenRequested > 0 && (() => {
        const pendingOrders = (orders ?? []).filter(o => o.status === 'REOPEN_REQUESTED');
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
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button data-testid={`button-approve-panel-${order.id}`} onClick={() => approveReopen(order)}
                          className="px-4 py-2 bg-green-500 text-white text-xs font-bold rounded-xl hover:bg-green-600 transition-colors flex items-center gap-1.5 shadow-sm">
                          <ThumbsUp className="w-3.5 h-3.5" /> Aprovar reabertura
                        </button>
                        <button data-testid={`button-deny-panel-${order.id}`} onClick={() => denyReopen(order)}
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

      {/* ── Orders Table ── */}
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
              <button key={s} onClick={() => setFilterStatus(s)}
                className={`px-3 py-2 rounded-xl text-xs font-bold border-2 transition-all ${
                  filterStatus === s
                    ? 'bg-primary text-white border-primary'
                    : 'border-border text-muted-foreground hover:border-primary/50'
                }`}>
                {s === 'ALL' ? 'Todos' : STATUS_LABEL[s] || s}
              </button>
            ))}
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
                <button key={opt.key} onClick={() => setPaymentFilter(opt.key)}
                  data-testid={`chip-payment-${opt.key}`}
                  className={`px-3 py-2 rounded-xl text-xs font-bold border-2 transition-all ${
                    active ? activeColor : 'border-border text-muted-foreground hover:border-primary/50'
                  }`}>
                  {opt.label} ({opt.count})
                </button>
              );
            })}
          </div>
        </div>

        {/* Table */}
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
                      companyName={company?.companyName || 'Desconhecido'}
                      products={products || []}
                      onNoteEdit={setNoteOrder}
                      onEdit={setEditOrder}
                      onCancel={setCancelOrder}
                      onRestore={restoreOrder}
                      onApproveReopen={approveReopen}
                      onDenyReopen={denyReopen}
                      onTransition={transitionOrder}
                    />
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {pagedOrders && (
          <PaginationBar
            page={page}
            totalPages={pagedOrders.totalPages}
            total={pagedOrders.total}
            limit={limit}
            onPageChange={setPage}
            onLimitChange={() => { setPage(1); }}
          />
        )}
      </div>

      {/* ── Row-level modals ── */}
      {noteOrder && <AdminNoteModal order={noteOrder} onClose={() => setNoteOrder(null)} onSave={saveNote} />}
      {editOrder && <EditItemsModal order={editOrder} products={products || []} onClose={() => setEditOrder(null)} onSave={saveItems} />}
      {cancelOrder && <CancelModal order={cancelOrder} onClose={() => setCancelOrder(null)} onConfirm={cancelOrderFn} />}
    </Layout>
  );
}
