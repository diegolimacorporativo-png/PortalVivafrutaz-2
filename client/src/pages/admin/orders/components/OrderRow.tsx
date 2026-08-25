import { memo, useState } from "react";
import { useOrderDetail } from "@/hooks/use-ordering";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Receipt, MessageSquare, Package, XCircle, Edit3, StickyNote,
  ThumbsUp, ThumbsDown, ClipboardEdit, ChevronDown, ChevronUp, CheckCircle,
} from "lucide-react";
import {
  STATUS_BADGE, STATUS_LABEL, WF_BADGE, WF_LABEL,
} from "../constants";
import type { Order } from "../types";

interface OrderRowProps {
  order: Order;
  companyName: string;
  products: any[];
  onNoteEdit: (order: Order) => void;
  onEdit: (order: Order) => void;
  onCancel: (order: Order) => void;
  onRestore: (order: Order) => void;
  onApproveReopen: (order: Order) => void;
  onDenyReopen: (order: Order) => void;
  onTransition: (order: Order, to: string, label: string) => Promise<void>;
}

export const OrderRow = memo(function OrderRow({
  order, companyName, products,
  onNoteEdit, onEdit, onCancel, onRestore,
  onApproveReopen, onDenyReopen, onTransition,
}: OrderRowProps) {
  const [expanded, setExpanded] = useState(false);
  const { data: detail } = useOrderDetail(expanded ? order.id : undefined);
  const isCancelled = order.status === 'CANCELLED';
  const isReopenRequested = order.status === 'REOPEN_REQUESTED';

  const NEXT: Record<string, { to: string; label: string; cls: string }> = {
    APPROVED:   { to: "PROCESSING", label: "Iniciar Separação", cls: "bg-amber-50 text-amber-700 border-amber-300 hover:bg-amber-100" },
    PROCESSING: { to: "READY",      label: "Pedido Pronto",     cls: "bg-violet-50 text-violet-700 border-violet-300 hover:bg-violet-100" },
    READY:      { to: "INVOICED",   label: "Liberar para entrega", cls: "bg-cyan-50 text-cyan-700 border-cyan-300 hover:bg-cyan-100" },
    INVOICED:   { to: "SHIPPED",    label: "Saiu p/ Entrega",   cls: "bg-indigo-50 text-indigo-700 border-indigo-300 hover:bg-indigo-100" },
    SHIPPED:    { to: "DELIVERED",  label: "Entregue",          cls: "bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-emerald-100" },
  };

  return (
    <>
      <tr
        className={`transition-colors cursor-pointer ${isCancelled ? 'opacity-60 bg-red-50/30' : 'hover:bg-muted/10'}`}
        onClick={() => setExpanded(!expanded)}
      >
        <td className="px-5 py-4">
          <div className="flex items-center gap-2">
            <Receipt className="w-4 h-4 text-primary flex-shrink-0" />
            <div>
              <p className="font-bold text-primary font-mono text-sm">{order.orderCode || `#${String(order.id).padStart(4, '0')}`}</p>
              <div className="flex gap-1 flex-wrap mt-0.5">
                <span className={`text-xs font-bold px-1.5 py-0.5 rounded-md ${STATUS_BADGE[order.status] || STATUS_BADGE.ACTIVE}`}>
                  {STATUS_LABEL[order.status] || order.status}
                </span>
                {order.workflowStatus && WF_BADGE[order.workflowStatus] && (
                  <span data-testid={`badge-workflow-${order.id}`}
                    className={`text-xs font-bold px-1.5 py-0.5 rounded-md border ${WF_BADGE[order.workflowStatus]}`}
                    title={`Etapa operacional: ${WF_LABEL[order.workflowStatus] || order.workflowStatus}`}>
                    {WF_LABEL[order.workflowStatus] || order.workflowStatus}
                  </span>
                )}
                {(order as any).isPaid && (
                  <span className="inline-flex items-center gap-1 text-xs font-bold px-1.5 py-0.5 rounded-md bg-green-100 text-green-800 border border-green-300"
                    data-testid={`badge-paid-${order.id}`}
                    title={(order as any).paidAt ? `Pago em ${new Date((order as any).paidAt).toLocaleDateString('pt-BR')}` : "Pago"}>
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
          <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
            {isReopenRequested ? (
              <>
                <button data-testid={`button-approve-reopen-${order.id}`} onClick={() => onApproveReopen(order)}
                  title="Aprovar reabertura"
                  className="p-1.5 text-muted-foreground hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors">
                  <ThumbsUp className="w-4 h-4" />
                </button>
                <button data-testid={`button-deny-reopen-${order.id}`} onClick={() => onDenyReopen(order)}
                  title="Negar reabertura"
                  className="p-1.5 text-muted-foreground hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                  <ThumbsDown className="w-4 h-4" />
                </button>
              </>
            ) : !isCancelled ? (
              <>
                {(() => {
                  const wf = order.workflowStatus as string | undefined;
                  const step = wf ? NEXT[wf] : undefined;
                  if (!step) return null;
                  return (
                    <button data-testid={`button-transition-${order.id}`}
                      onClick={() => onTransition(order, step.to, step.label)}
                      title={`Mover para: ${step.label}`}
                      className={`px-2 py-1 text-xs font-bold rounded-lg border transition-colors ${step.cls}`}>
                      {step.label}
                    </button>
                  );
                })()}
                <button data-testid={`button-note-${order.id}`} onClick={() => onNoteEdit(order)}
                  title="Obs. Admin"
                  className="p-1.5 text-muted-foreground hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors">
                  <StickyNote className="w-4 h-4" />
                </button>
                <button data-testid={`button-edit-${order.id}`} onClick={() => onEdit(order)}
                  title="Editar itens"
                  className="p-1.5 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-lg transition-colors">
                  <Edit3 className="w-4 h-4" />
                </button>
                <button data-testid={`button-cancel-${order.id}`} onClick={() => onCancel(order)}
                  title="Cancelar"
                  className="p-1.5 text-muted-foreground hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                  <XCircle className="w-4 h-4" />
                </button>
              </>
            ) : (
              <button data-testid={`button-restore-${order.id}`} onClick={() => onRestore(order)}
                title="Restaurar"
                className="p-1.5 text-muted-foreground hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors">
                <CheckCircle className="w-4 h-4" />
              </button>
            )}
            <button className="p-1.5 text-muted-foreground">
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>
        </td>
      </tr>

      {expanded && (
        <tr>
          <td colSpan={8} className="px-5 py-0 bg-muted/10 border-b border-border/50">
            <div className="py-4 space-y-3">
              {(order as any).isPaid && (
                <div className="flex items-center gap-2 p-3 bg-green-50 rounded-xl border border-green-200"
                  data-testid={`status-paid-${order.id}`}>
                  <span className="text-sm text-green-700 font-bold">
                    ✓ Pago em {(order as any).paidAt
                      ? new Date((order as any).paidAt).toLocaleDateString('pt-BR')
                      : "-"}
                  </span>
                </div>
              )}

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
                        <button onClick={() => onApproveReopen(order)} data-testid={`button-approve-expanded-${order.id}`}
                          className="px-3 py-1.5 bg-green-500 text-white text-xs font-bold rounded-lg hover:bg-green-600 transition-colors flex items-center gap-1">
                          <ThumbsUp className="w-3.5 h-3.5" /> Aprovar Reabertura
                        </button>
                        <button onClick={() => onDenyReopen(order)} data-testid={`button-deny-expanded-${order.id}`}
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

            </div>
          </td>
        </tr>
      )}
    </>
  );
});
